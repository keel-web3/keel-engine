// The look table: every look a scene draws, as the sprite shader reads them.
// A LAYER's look (a body's, a hat's) says what each of its slots wears -- a
// PAINT: a role's ramp, its finish, its pattern and the ramp the pattern's
// marks wear. Paints and ramps are shared by value, looks by their paints:
//
//   palette  RGBA8, PALETTE_ROW colours a row: every ramp once (cached by
//            core's rampKey).
//   paints   RGBA32UI, PAINTS_PER_ROW paints a row, 2 texels each:
//              texel 0  ramp base, ramp length | finish << 8, pattern kind |
//                       freq << 4 | angle << 8 | width << 12, shift + 8
//              texel 1  ink ramp base, ink ramp length, 0, 1
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

/** What one slot wears: a role's look, and the look its pattern's marks wear (if they wear another role's ramp). */
export interface SlotPaint {
  readonly look: RoleLook;
  readonly ink: RoleLook | null;
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
}

export function createLookTable({ rampLength = 5 }: { rampLength?: number } = {}): LookTable {
  const colours: number[] = []; // (r, g, b triples)
  const ramps = new Map<string, number>();
  const paints = new Map<string, number>();
  const paintRows: number[] = []; // (8 per paint)
  const looks = new Map<string, number>();
  const rows: Uint32Array[] = [];
  let version = 0;
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
    const key = `${rampKey(x, rampLength)}|${pt.kind}.${pt.freq}.${pt.angle}.${pt.width}.${pt.shift}|${p.ink ? rampKey(p.ink, rampLength) : ""}`;
    let i = paints.get(key);
    if (i === undefined) {
      i = paintRows.length / 8;
      paintRows.push(rampOf(x), rampLength | (finishIndex(x.finish) << 8), patternIndex(pt.kind) | (pt.freq << 4) | (pt.angle << 8) | (pt.width << 12), pt.shift + 8, p.ink ? rampOf(p.ink) : 0, p.ink ? rampLength : 0, 0, 1);
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
    get ramps() { return ramps.size; },
    get paints() { return paintRows.length / 8; },
    rampLength,
    get version() { return version; },
    get bytes() { return colours.length / 3 * 4 + paintRows.length * 4 + rows.length * SLOTS * 4; },
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
