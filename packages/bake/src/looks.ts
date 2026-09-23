// The look table: every look a scene draws, as the sprite shader reads them.
// A LAYER's look (a body's, a hat's) says what each of its slots wears -- a
// PAINT: a role's ramp, its finish, its pattern and the ramp the pattern's
// marks wear. Paints and ramps are shared by value, looks by their paints:
//
//   palette  RGBA8, PALETTE_ROW colours a row: every ramp once (cached by
//            core's rampKey).
//   paints   RGBA32UI, PAINTS_PER_ROW paints a row, 2 texels each:
//              texel 0  ramp base, ramp length | finish << 8, pattern kind |
//                       freq << 4 | angle << 8 | width << 12 | wall detail << 16
//                       (WALL_DETAILS' packing: 0 none -- see wallDetailBits), shift + 8
//              texel 1  ink ramp base, ink ramp length, screen | dither << 8,
//                       1 | sheen << 1 | (decal placement + 1) << 4
//                       (the paint's own dither screen, PAINT_SCREENS' index -- 0: the draw
//                       call's -- and its reach, 32nds + 1 -- 0: the draw call's; its SHEEN,
//                       PAINT_SHEENS' index; and the DECAL stamped on it, if any)
//   places   RGBA32UI, PLACES_PER_ROW placements a row, 4 texels each: a decal's
//            atlas rect (x, y, w, h); its rect on the part's surface (u0, v0, u1, v1
//            in 65535ths); its four inks' ramp bases; flags (flip u | flip v << 1)
//   decals   RGBA8: every decal's texels -- ink (0 clear, 1..4), tone (128 + 16ths
//            of an entry), how much the part's light shows through it (0..255)
//
// DECALS are the Pixel Marine's sprays, on a baked shape: a small picture whose
// texels are INKS (up to four ramps, never raw colours) and tones, with alpha
// already dithered (a texel is ink or it isn't), stamped on a slot at a rect of
// its surface coordinate -- so a number rides a door through every direction and
// every frame, lit by the door's own shade, for a row of texels and no bake.
//   looks    RGBA32UI, LOOKS_PER_ROW looks a row, LOOK_TEXELS each: per slot
//            the paint's index + 1 (0: nothing's painted there), four a texel.
//
// add(paint) returns the look's index -- the same paint twice is one look --
// and an instance of the layer renderer names it. Drawing a new look costs a
// row of texels (and a paint or ramp only when it's new), never a bake. (A
// population of ten thousand has ~100k distinct ramps: the palette runs to
// hundreds of thousands of colours, which is why every index is 32-bit.)

import { finishIndex, patternIndex, rampColours, rampKey, roleIndex } from "@keel-engine/core";
import type { Look, LookRole, RoleLook } from "@keel-engine/core";
import type { Role } from "@keel-engine/entity";
import { SLOTS } from "./indexed.ts";

export const PALETTE_ROW = 4096;
export const LOOK_TEXELS = SLOTS / 4;
export const LOOKS_PER_ROW = 512;
export const PAINTS_PER_ROW = 2048;

/**
 * Dither screens a paint may wear (the layer shader's ports of core's SCREENS). "style" is the draw call's own screen.
 * One layer's slots can each wear another: a car's paint a fine interleaved flake, its tyres a coarse checker, its
 * glass lines, its carbon a weave -- all on the same ramps, so they still agree.
 */
export const PAINT_SCREENS = ["style", "none", "bayer2", "bayer4", "bayer8", "chunky", "lines", "diagonal", "hatch", "ign", "checker", "weave", "halftone", "coarseDot"] as const;
export type PaintScreen = (typeof PAINT_SCREENS)[number];

/**
 * A clear coat's reflection (the layer shader's): "side" a horizon across a side panel (sky above, ground below,
 * a dark line where they meet, waving along the part), "top" the sky on a roof or bonnet, "glass" a tint lighter toward its top and a crisp reflection band.
 */
export const PAINT_SHEENS = ["none", "side", "top", "glass"] as const;
export type PaintSheen = (typeof PAINT_SHEENS)[number];

/** A decal's texels: w x h x 4 -- ink (0 clear, 1..4), tone (128 is the part's own; 16ths of a ramp entry), lit (0 flat .. 255 the part's shade), 255. */
export interface Decal {
  readonly width: number;
  readonly height: number;
  readonly texels: Uint8Array;
}
/** A decal on a slot: where on the part's surface (u0, v0, u1, v1 in 0..1; v up), mirrored or not, and its inks' ramps. */
export interface SlotDecal {
  readonly decal: Decal;
  readonly rect: readonly [number, number, number, number];
  readonly flipU?: boolean | undefined;
  readonly flipV?: boolean | undefined;
  readonly inks: readonly RoleLook[];
}

export const PLACES_PER_ROW = 1024;
export const DECAL_ATLAS = 1024;

/**
 * A wall's surface material (drawMeshes only, on a box with a facade grid -- BakeBox.grid): pixel-art detail painted
 * between its windows, measured in the facade's own metric cells so it never swims. "brick" running-bond courses and
 * head joints, "panel" precast concrete seams and form-tie dots, "corrugated" vertical ribs and sheet laps, "siding"
 * lap boards, "stucco" a blotchy render, "glass" curtain-wall mullions and transoms, "stone" big ashlar blocks.
 */
export const WALL_DETAILS = ["none", "brick", "panel", "corrugated", "siding", "stucco", "glass", "stone"] as const;
export type WallMaterial = (typeof WALL_DETAILS)[number];
/**
 * A slot's wall detail (SlotPaint.detail). Every line is one picture pixel wide wherever it lands (it is drawn where
 * the lattice index changes between a pixel and its neighbour), and a lattice finer than three pixels a line halves
 * until it isn't -- so a far tower reads as a quiet texture, a near wall as bricks.
 */
export interface WallDetail {
  readonly material: WallMaterial;
  /** Rain streaks run down from every sill, and the wall darkens toward its foot (0..1, default 0.4). */
  readonly grime?: number | undefined;
  /** A dark contact band where the wall meets whatever it stands on (0..1, default 0.6). */
  readonly foot?: number | undefined;
  /** A one-pixel lit coping where the wall turns onto its roof (default true). */
  readonly edge?: boolean | undefined;
  /** The lattice's size: 0.5 (bigger bricks), 1 (default), 2 or 4 (finer). */
  readonly scale?: 0.5 | 1 | 2 | 4 | undefined;
}
/** A wall detail's sixteen bits (the high half of a paint's pattern word): material | grime << 4 | foot << 8 | edge << 12 | scale << 13. */
export function wallDetailBits(d: WallDetail | null | undefined): number {
  const m = d ? Math.max(0, WALL_DETAILS.indexOf(d.material)) : 0;
  if (!d || m === 0) return 0;
  const q = (v: number | undefined, dflt: number) => Math.max(0, Math.min(15, Math.round((v ?? dflt) * 15)));
  const scale = Math.max(0, [1, 2, 0.5, 4].indexOf(d.scale ?? 1));
  return m | (q(d.grime, 0.4) << 4) | (q(d.foot, 0.6) << 8) | ((d.edge ?? true) ? 1 << 12 : 0) | (scale << 13);
}

/** What one slot wears: a role's look, and the look its pattern's marks wear (if they wear another role's ramp). */
export interface SlotPaint {
  readonly look: RoleLook;
  readonly ink: RoleLook | null;
  /** Its own dither screen (default "style": the draw call's). */
  readonly screen?: PaintScreen | undefined;
  /** How far its screen reaches between two entries, 0..2 (default: the draw call's `dither`). */
  readonly dither?: number | undefined;
  /** Its clear coat's reflection (default "none"). */
  readonly sheen?: PaintSheen | undefined;
  /** A decal stamped on it. */
  readonly decal?: SlotDecal | null | undefined;
  /**
   * Where its pattern is measured: "part" (default -- the part's own surface, so a mark sits on that panel) or "body"
   * (the whole thing's, so a stripe runs down every panel it crosses, centred on its middle: drawMeshes only).
   */
  readonly space?: "part" | "body" | undefined;
  /** How much it mirrors what is around it, 0..1 (glass, chrome, a gloss flank): drawMeshes' reflections. */
  readonly mirror?: number | undefined;
  /** A wall's surface material between its windows (drawMeshes, facade-grid faces only; default none). */
  readonly detail?: WallDetail | null | undefined;
}
/** A layer's paint: what each slot wears (null: nothing's baked there). */
export type LayerPaint = readonly (SlotPaint | null)[];

// When a look hasn't got the role a slot wants, the nearest it has (as keel/entity's material fallback).
const FALLBACK: Readonly<Partial<Record<LookRole, LookRole>>> = {
  furAlt: "fur", skin: "fur", fur: "skin", clothAlt: "cloth", cloth: "primary", primary: "cloth", secondary: "clothAlt", accent: "trim", trim: "accent",
  detail: "dark", metal: "detail", glow: "accent", hair: "dark", blush: "fur", eye: "dark", dark: "eye",
};
function roleIn(look: Look, role: LookRole): RoleLook | null {
  let r: LookRole | undefined = role;
  for (let i = 0; i < 6 && r; i += 1) { const x = look.roles[r]; if (x) return x; r = FALLBACK[r]; }
  const first = look.order[0];
  return first ? look.roles[first]! : null;
}
const paintOf = (look: Look, role: LookRole): SlotPaint | null => {
  const x = roleIn(look, role);
  if (!x) return null;
  const ink = x.pattern.kind !== "none" && x.pattern.ink ? roleIn(look, x.pattern.ink) : null;
  return { look: x, ink };
};

/**
 * A body layer's paint: each slot wears its role (bodyShape().slotRoles(coverage)) from the body's look; the
 * worn slots (things baked into the body: boots) wear theirs from the worn thing's look.
 */
export function paintSlots(look: Look, slotRoles: readonly (Role | null)[], worn?: Look | null, wornFrom = SLOTS): LayerPaint {
  return Array.from({ length: SLOTS }, (_, s) => {
    const role = slotRoles[s];
    if (!role) return null;
    return paintOf(s >= wornFrom && worn ? worn : look, role as LookRole);
  });
}

/** An attribute layer's paint: its slots are look roles (slot = core's roleIndex). */
export function paintRoles(look: Look): LayerPaint {
  const out: (SlotPaint | null)[] = new Array<SlotPaint | null>(SLOTS).fill(null);
  for (const role of look.order) out[roleIndex(role)] = paintOf(look, role);
  return out;
}

export interface LookTable {
  /** A layer's look: its index (the same paint is the same look). */
  add(paint: LayerPaint): number;
  readonly count: number;
  /** Colours in the palette, ramps and paints cached. */
  readonly colours: number;
  readonly ramps: number;
  readonly paints: number;
  readonly rampLength: number;
  /** Bumped by every add that made something new (a renderer re-uploads when it changes). */
  readonly version: number;
  /** Bytes the three textures take. */
  readonly bytes: number;
  palette(): { width: number; height: number; rgba: Uint8Array };
  texture(): { width: number; height: number; data: Uint32Array };
  paintTexture(): { width: number; height: number; data: Uint32Array };
  /** Decal placements (RGBA32UI) and the decals' atlas (RGBA8). */
  placeTexture(): { width: number; height: number; data: Uint32Array };
  decalTexture(): { width: number; height: number; rgba: Uint8Array };
  /** The palette index a role's ramp starts at (added if new): a light's tint ramp for a live mesh draw. */
  ramp(role: RoleLook): number;
  /** Decals and placements kept. */
  readonly decals: number;
  readonly placements: number;
}

export function createLookTable({ rampLength = 5 }: { rampLength?: number } = {}): LookTable {
  const colours: number[] = []; // (r, g, b triples)
  const ramps = new Map<string, number>();
  const paints = new Map<string, number>();
  const paintRows: number[] = []; // (8 per paint)
  const looks = new Map<string, number>();
  const rows: Uint32Array[] = [];
  let version = 0;
  // Decals: shelf-packed into one atlas, kept by content; placements by value.
  const decalAt = new Map<string, readonly [number, number]>();
  let atlas = new Uint8Array(DECAL_ATLAS * 16 * 4), atlasRows = 16, shelfX = 0, shelfY = 0, shelfH = 0;
  const placeRows: number[] = [];
  const places = new Map<string, number>();
  const decalOf = (d: Decal): readonly [number, number] => {
    let h = 0x811c9dc5;
    for (let i = 0; i < d.texels.length; i += 1) h = Math.imul(h ^ d.texels[i]!, 0x01000193);
    const key = `${d.width}x${d.height}:${h >>> 0}`;
    const had = decalAt.get(key);
    if (had) return had;
    const w = Math.min(DECAL_ATLAS, d.width);
    if (shelfX + w > DECAL_ATLAS) { shelfX = 0; shelfY += shelfH; shelfH = 0; }
    while (shelfY + d.height > atlasRows) {
      const grown = new Uint8Array(DECAL_ATLAS * atlasRows * 2 * 4);
      grown.set(atlas); atlas = grown; atlasRows *= 2;
    }
    for (let y = 0; y < d.height; y += 1) atlas.set(d.texels.subarray(y * d.width * 4, (y * d.width + w) * 4), ((shelfY + y) * DECAL_ATLAS + shelfX) * 4);
    const at = [shelfX, shelfY] as const;
    shelfX += w; shelfH = Math.max(shelfH, d.height);
    decalAt.set(key, at);
    return at;
  };
  const placeOf = (sd: SlotDecal): number => {
    const [ax, ay] = decalOf(sd.decal);
    const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 65535);
    const inks = [0, 1, 2, 3].map((i) => { const r = sd.inks[i] ?? sd.inks[0]; return r ? rampOf(r) : 0; });
    const row = [ax, ay, Math.min(DECAL_ATLAS, sd.decal.width), sd.decal.height, q(sd.rect[0]), q(sd.rect[1]), q(sd.rect[2]), q(sd.rect[3]), ...inks, (sd.flipU ? 1 : 0) | (sd.flipV ? 2 : 0), 0, 0, 0];
    const key = row.join(",");
    let i = places.get(key);
    if (i === undefined) { i = placeRows.length / 16; placeRows.push(...row); places.set(key, i); }
    return i;
  };
  const rampOf = (r: RoleLook): number => {
    const key = rampKey(r, rampLength);
    let base = ramps.get(key);
    if (base === undefined) {
      base = colours.length / 3;
      for (const c of rampColours(r, rampLength)) colours.push(c[0], c[1], c[2]);
      ramps.set(key, base);
    }
    return base;
  };
  const paintOfSlot = (p: SlotPaint): number => {
    const x = p.look;
    const pt = x.pattern;
    const screen = Math.max(0, PAINT_SCREENS.indexOf(p.screen ?? "style"));
    const reach = p.dither === undefined ? 0 : Math.round(Math.max(0, Math.min(2, p.dither)) * 32) + 1;
    const sheen = Math.max(0, PAINT_SHEENS.indexOf(p.sheen ?? "none"));
    const place = p.decal ? placeOf(p.decal) + 1 : 0;
    const mirror = Math.max(0, Math.min(15, Math.round((p.mirror ?? 0) * 15)));
  const body = p.space === "body" ? 1 : 0;
  const detail = wallDetailBits(p.detail);
  const key = `${rampKey(x, rampLength)}|${pt.kind}.${pt.freq}.${pt.angle}.${pt.width}.${pt.shift}|${p.ink ? rampKey(p.ink, rampLength) : ""}|${screen}.${reach}|${sheen}.${place}|${mirror}.${body}${detail ? `|${detail}` : ""}`;
    let i = paints.get(key);
    if (i === undefined) {
      i = paintRows.length / 8;
      paintRows.push(rampOf(x), rampLength | (finishIndex(x.finish) << 8), (patternIndex(pt.kind) | (pt.freq << 4) | (pt.angle << 8) | (pt.width << 12) | (detail << 16)) >>> 0, pt.shift + 8, p.ink ? rampOf(p.ink) : 0, p.ink ? rampLength : 0, screen | (reach << 8) | (body << 16) | (mirror << 17), 1 | (sheen << 1) | (place << 4));
      paints.set(key, i);
    }
    return i;
  };
  const table: LookTable = {
    add(paint) {
      if (paint.length > SLOTS) throw new RangeError(`${paint.length} slots: at most ${SLOTS}.`);
      const row = new Uint32Array(SLOTS);
      paint.forEach((p, s) => { if (p) row[s] = paintOfSlot(p) + 1; });
      const key = row.join(",");
      const had = looks.get(key);
      if (had !== undefined) return had;
      const index = rows.length;
      rows.push(row);
      looks.set(key, index);
      version += 1;
      return index;
    },
    get count() { return rows.length; },
    get colours() { return colours.length / 3; },
    ramp: (role) => rampOf(role),
    get ramps() { return ramps.size; },
    get paints() { return paintRows.length / 8; },
    rampLength,
    get version() { return version; },
    get bytes() { return colours.length / 3 * 4 + paintRows.length * 4 + rows.length * SLOTS * 4 + placeRows.length * 4 + (shelfY + shelfH) * DECAL_ATLAS * 4; },
    get decals() { return decalAt.size; },
    get placements() { return placeRows.length / 16; },
    placeTexture() {
      const n = Math.max(1, placeRows.length / 16);
      const width = PLACES_PER_ROW * 4;
      const height = Math.ceil(n / PLACES_PER_ROW);
      const data = new Uint32Array(width * height * 4);
      data.set(placeRows);
      return { width, height, data };
    },
    decalTexture() {
      const height = Math.max(1, shelfY + shelfH);
      return { width: DECAL_ATLAS, height, rgba: atlas.slice(0, DECAL_ATLAS * height * 4) };
    },
    palette() {
      const n = Math.max(1, colours.length / 3);
      // (One row while it fits; past that, full rows -- the shader indexes i % PALETTE_ROW, i / PALETTE_ROW.)
      const width = n <= PALETTE_ROW ? n : PALETTE_ROW;
      const height = Math.ceil(n / PALETTE_ROW);
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < colours.length / 3; i += 1) { rgba[i * 4] = colours[i * 3]!; rgba[i * 4 + 1] = colours[i * 3 + 1]!; rgba[i * 4 + 2] = colours[i * 3 + 2]!; rgba[i * 4 + 3] = 255; }
      return { width, height, rgba };
    },
    texture() {
      const width = LOOKS_PER_ROW * LOOK_TEXELS;
      const height = Math.max(1, Math.ceil(rows.length / LOOKS_PER_ROW));
      const data = new Uint32Array(width * height * 4);
      rows.forEach((row, i) => data.set(row, ((Math.floor(i / LOOKS_PER_ROW) * width) + (i % LOOKS_PER_ROW) * LOOK_TEXELS) * 4));
      return { width, height, data };
    },
    paintTexture() {
      const n = Math.max(1, paintRows.length / 8);
      const width = PAINTS_PER_ROW * 2;
      const height = Math.ceil(n / PAINTS_PER_ROW);
      const data = new Uint32Array(width * height * 4);
      data.set(paintRows);
      return { width, height, data };
    },
  };
  return table;
}
