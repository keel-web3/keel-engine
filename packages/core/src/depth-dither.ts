// Depth-and-material dithering: which screen each pixel wears follows from
// WHAT it shows and WHERE it is, not from one roll for the whole picture.
//
// A pixel has a role: its depth band (near: the things; mid: the room, its
// frame and sill; far: the sky and the view), its material family (glass,
// metal, wood, stone, cloth, organic, smooth, glow, sky, fog) and its side (lit,
// shade, or the edge of a near thing's silhouette). Each role has rules --
// the screens that suit it, how fine, how much contrast -- and a scene's
// seed picks among the good ones, so two scenes differ while every choice
// still makes sense for its role:
//
//   far    fine, soft screens (bayer8, blue-noise stipple) in flat fills --
//          its light snaps toward its steps, so the pattern lives only in
//          a thin band between tones: the far world reads as calm shapes
//          behind the busy, textured near things (aerial perspective
//          without lifting a night's dark into dither);
//   mid    medium, quiet screens: the room holds still behind the things;
//   near   crisp, structured screens chosen by material: glass and liquid an
//          ordered matrix, metal a tight ordered one with a step more, wood
//          lines with the grain, stone a clustered dot, cloth and organic
//          blue noise, smooth things (plastic, ceramic, porcelain) only a
//          fine ordered matrix -- never a grain -- and glow a clustered dot
//          that blooms;
//   shade  the side turned from the light wears its lit pattern denser, so
//          the terminator draws the form as a change of tone, with no seam
//          (`shade: "hatch"`: an engraver's directional screen instead);
//   edge   a near thing's silhouette is a solid run of tone, never broken
//          speckle, so it stands off the ground behind it;
//   fog    its own soft screen, in softer flat fills.
//
// Everything is overridable: per scene (`all`), per band, per family, per
// side, per object and per part, in that order (the later wins). The plan is a
// pure function of its spec, and every screen still a pure function of the
// pixel -- plus an optional per-pixel phase, so a moved thing carries its
// pattern with it (an object-locked dither: NOCTURNES' lockDither).
//
//   const plan = planDepthDither({ seed: "scene-7", steps: { near: 7, mid: 6, far: 5 } });
//   const role = plan.index({ band: "near", family: familyOfMaterial("brass"), side: "lit" });
//   const quantize = createDepthQuantizer({ width, height, ramps, lums, plan });
//   quantize(buf, null, out, t, roleMap);            // roleMap[k] = a plan.index(...)

import { SCREENS, screenIndex, screenPair } from "./dither.ts";
import type { LayerScreen, ScreenId } from "./dither.ts";
import { BAYER4Q, HALO_SCREEN } from "./quantize.ts";
import type { QuantizeInput, QuantizeRamps, Region } from "./quantize.ts";
import { createMulberry32 } from "./random.ts";
import { fnv1a32 } from "./hash.ts";

export type DepthBand = "near" | "mid" | "far";
export type MaterialFamily = "glass" | "metal" | "wood" | "stone" | "cloth" | "organic" | "smooth" | "glow" | "sky" | "fog";
export type LightSide = "lit" | "shade" | "edge";

export const DEPTH_BANDS: readonly DepthBand[] = ["near", "mid", "far"];
export const MATERIAL_FAMILIES: readonly MaterialFamily[] = ["glass", "metal", "wood", "stone", "cloth", "organic", "smooth", "glow", "sky", "fog"];

/** A role's screen: a layer screen plus how it is read. */
export interface RoleScreen extends LayerScreen {
  /** The screen read at (x / scale, y / scale): 2 draws its pattern in 2x2 blocks (coarser). */
  readonly scale: number;
  /** Tone pulled toward `pivot` by this much (1 = as lit; 0.8 = a fifth flatter: far things recede). */
  readonly contrast: number;
  readonly pivot: number;
  /** The density curve: light ** gamma before the screen (over 1 darker, under 1 lighter). */
  readonly gamma: number;
  /** Where the pattern starts [x, y]: a scene's own place in a noise tile or a line's phase. */
  readonly phase: readonly [number, number];
  /** A solid run: the nearest step, no pattern (a silhouette's edge). */
  readonly solid: boolean;
  /** Flat fills: how hard light snaps to the nearest step before the screen (0 = none; 3 = the pattern only in a band a third as wide between tones): far things read as calm, flat shapes. */
  readonly flat: number;
  /** Why: the role, and the rule or override that set it. */
  readonly why: string;
}

/** What can be set on any role by an override (all optional). */
export interface RoleOverride {
  id?: ScreenId;
  steps?: number;
  bias?: number;
  scale?: number;
  contrast?: number;
  pivot?: number;
  gamma?: number;
  phase?: readonly [number, number];
  solid?: boolean;
  flat?: number;
}

/** Overrides, applied in order: all, band, family, side, object, part. */
export interface DepthDitherOverrides {
  all?: RoleOverride;
  bands?: Partial<Record<DepthBand, RoleOverride>>;
  families?: Partial<Record<MaterialFamily, RoleOverride>>;
  sides?: Partial<Record<LightSide, RoleOverride>>;
  objects?: Record<string, RoleOverride>;
  /** Keyed "object/part" (an object's key, a part's name). */
  parts?: Record<string, RoleOverride>;
}

export interface DepthDitherSpec {
  /** The scene's seed: which of each role's good screens it wears. */
  seed: string | number;
  /** Tone steps per band (the far band's default one fewer than the mid). */
  steps?: Partial<Record<DepthBand | "fx", number>>;
  /** Where each band's steps sit on the ramp (a layer screen's `bias`; default 0). */
  bias?: Partial<Record<DepthBand, number>>;
  /** 0: every role its first rule; 1: the full spread of good variants (default 1). */
  variety?: number;
  /** Turn rules off: `shade: false` (one pattern both sides), `edge: false`, `aerial: false` (no far flat fills, no rule's contrast). */
  /** The shade side: true (default) its lit screen, denser; "hatch" a directional screen of its own (SHADE_SCREENS); false as lit. */
  shade?: boolean | "hatch";
  edge?: boolean;
  aerial?: boolean;
  overrides?: DepthDitherOverrides;
}

export interface RoleKey {
  band: DepthBand;
  family: MaterialFamily;
  side?: LightSide | undefined;
  /** An object's key (a recipe index, a name) -- only matters when an override names it. */
  object?: string | number | undefined;
  part?: string | undefined;
}

export interface DepthDitherPlan {
  /** The role's index in `table` (made on first ask; at most 255 roles). */
  index(key: RoleKey): number;
  readonly table: RoleScreen[];
  /** The roles made so far, by key, with their screens: for a sheet or a log. */
  describe(): Record<string, RoleScreen>;
  /** The key a role index was made from (as named: an object or part only when an override names it). */
  keyOf(index: number): RoleKey | undefined;
  readonly spec: DepthDitherSpec;
}

/** A material's family, by its name (NOCTURNES' materials and the usual words). Unknown: organic. */
export function familyOfMaterial(mat: string | null | undefined, hints: { glass?: boolean; liquid?: boolean; glow?: boolean } = {}): MaterialFamily {
  if (hints.glow) return "glow";
  if (hints.glass || hints.liquid) return "glass";
  const m = (mat ?? "").toLowerCase();
  if (FAMILY_OF[m]) return FAMILY_OF[m]!;
  if (/glass|crystal|ice|liquid|water|clear|frost/.test(m)) return "glass";
  if (/chrome|brass|steel|iron|metal|copper|gold|silver|alumin|tin/.test(m)) return "metal";
  if (/wood|oak|walnut|pine|bamboo|cork|bark/.test(m)) return "wood";
  if (/plastic|ceramic|porcelain/.test(m)) return "smooth";
  if (/stone|marble|brick|clay|terracotta|soil|sand|bone/.test(m)) return "stone";
  if (/cloth|linen|velvet|wool|felt|silk|cotton|fur|foam/.test(m)) return "cloth";
  if (/glow|led|ember|neon|flame|fire|lamp|screen|lcd/.test(m)) return "glow";
  return "organic";
}
const FAMILY_OF: Record<string, MaterialFamily> = {
  glass: "glass", crystal: "glass", smoked: "glass", ice: "glass", liquid: "glass", clear: "glass", frosted: "glass",
  chrome: "metal", brass: "metal", steel: "metal", aluminium: "metal", copper: "metal", gunmetal: "metal", disc: "metal",
  wood: "wood", walnut: "wood", oak: "wood", bamboo: "wood", cork: "wood",
  plastic: "smooth", ceramic: "smooth", porcelain: "smooth", // (moulded or glazed: a grain on it read as speckled, textured stuff)
  stone: "stone", marble: "stone", terracotta: "stone", obsidian: "stone", enamel: "stone", soil: "stone", sand: "stone",
  cloth: "cloth", linen: "cloth", velvet: "cloth", litcloth: "cloth", foam: "cloth", memfoam: "cloth", blackfur: "cloth", feathers: "cloth",
  glow: "glow", led: "glow", ember: "glow", neon: "glow", glowlinen: "glow", screen: "glow", lcd: "glow",
  wax: "organic", plant: "organic", leather: "organic", maw: "organic", gum: "organic", rubber: "organic", paper: "organic", pcb: "organic",
};

/** A rule: the screens that suit a role (weighted), and how it is read. */
interface Rule { screens: ReadonlyArray<readonly [ScreenId, number]>; steps?: number; contrast?: number; gamma?: readonly [number, number]; flat?: number }

// The rules. `steps` is added to the band's steps; contrast and gamma are the
// role's own (gamma a range the seed picks in).
const NEAR: Record<MaterialFamily, Rule> = {
  glass: { screens: [["bayer8", 3], ["bayer4", 2], ["ign", 1]] },
  metal: { screens: [["bayer4", 3], ["bayer8", 2]], steps: 1, contrast: 1.08 },
  wood: { screens: [["lines", 2], ["diagonal", 2], ["bayer4", 1]] },
  stone: { screens: [["bayer4", 2], ["bayer8", 2], ["halftone", 1]] }, // (a console or a gravestone all in halftone read as a tiled "+" textile)
  cloth: { screens: [["stipple", 3], ["ign", 1], ["bayer8", 1]] },
  organic: { screens: [["bayer8", 2], ["bayer4", 2]], gamma: [0.95, 1.05] }, // (a big round pumpkin in halftone read as a grid of dashes, a pot's shade as diamonds; in stipple, as noise)
  smooth: { screens: [["bayer8", 2], ["bayer4", 1]] }, // (ordered only, never a grain: a console's ceramic body in stone's dots read as speckle, its plastic buttons as spots)
  glow: { screens: [["halftone", 3], ["bayer4", 1]] },
  sky: { screens: [["bayer8", 1]] },
  fog: { screens: [["stipple", 1]] },
};
const MID: Record<MaterialFamily, Rule> = {
  glass: { screens: [["bayer8", 2], ["bayer4", 1]] },
  metal: { screens: [["bayer4", 2], ["bayer8", 1]] },
  wood: { screens: [["bayer4", 3], ["lines", 1]] }, // (a floor or a sill in diagonals or many lines read as banding and hatching)
  stone: { screens: [["bayer4", 2], ["bayer8", 3]] }, // (the wall, the room's biggest surface: ordered, never halftone -- a big surface in clustered dots read as a zigzag wallpaper -- nor blue noise: on a near-black wall its few dots read as an even dot grid. Halftone's old share went to bayer8, so a wall that took bayer4 or bayer8 keeps it)
  cloth: { screens: [["stipple", 2], ["bayer8", 1], ["ign", 1]] },
  organic: { screens: [["bayer4", 2], ["stipple", 1]] },
  smooth: { screens: [["bayer8", 2], ["bayer4", 1]] },
  glow: { screens: [["halftone", 2], ["bayer4", 1]] },
  sky: { screens: [["bayer8", 2], ["stipple", 1]] },
  fog: { screens: [["stipple", 2], ["bayer8", 1]] },
};
const FAR: Record<MaterialFamily, Rule> = {
  glass: { screens: [["bayer8", 1]], flat: 2 },
  metal: { screens: [["bayer8", 1]], flat: 2 },
  wood: { screens: [["bayer8", 2], ["stipple", 1]], flat: 2 },
  stone: { screens: [["bayer8", 2], ["stipple", 1]], flat: 2 },
  cloth: { screens: [["stipple", 2], ["bayer8", 1]], flat: 2 },
  organic: { screens: [["bayer8", 2], ["stipple", 1]], flat: 2 },
  smooth: { screens: [["bayer8", 1]], flat: 2 },
  glow: { screens: [["bayer8", 2], ["halftone", 1]], flat: 2 },
  sky: { screens: [["bayer8", 4], ["stipple", 1], ["ign", 1]], flat: 1 }, // (gentler: a moon's disc, a sky's glow keep their gradient)
  fog: { screens: [["bayer8", 3], ["stipple", 1]] }, // (no flat fill: fog is soft already, and even a gentle snap posterized a foggy view into blotches; all stipple, it speckled)
};
/** The rules, by band then family (read-only: the defaults the overrides start from). */
export const DEPTH_RULES: Readonly<Record<DepthBand, Readonly<Record<MaterialFamily, Rule>>>> = { near: NEAR, mid: MID, far: FAR };
/** The shade side's screens: denser, directional -- never the lit side's own. */
export const SHADE_SCREENS: ReadonlyArray<readonly [ScreenId, number]> = [["diagonal", 3], ["hatch", 1]]; // (directional: hatching reads as shade; an ordered 50% on a shade half read as a checkerboard patch)
/** The shade side's density: its light ** this before the screen (over 1: fewer lit dots). */
export const SHADE_GAMMA = 1.15;
/** Families whose shade side keeps the lit side's screen (a glow has no shade side; glass shows what's behind it). */
const SHADE_SAME = new Set<MaterialFamily>(["glow", "glass", "metal", "smooth", "sky", "fog"]); // (metal: its dark side is a reflection; made denser, a cleaver's shade half read as a hole; smooth: denser, a console's body went dark and muddy)
const BAND_STEPS: Record<DepthBand | "fx", number> = { near: 7, mid: 6, far: 5, fx: 4 };

/**
 * A scene's dither plan: each role's screen, from the rules, picked by the
 * seed and set by the overrides. Roles are made on first ask (`index`), each
 * from its own hash of the seed and the role -- so a role's pick never
 * depends on which roles were asked for first, or in what order.
 */
export function planDepthDither(spec: DepthDitherSpec): DepthDitherPlan {
  const variety = Math.max(0, Math.min(1, spec.variety ?? 1));
  const steps = { ...BAND_STEPS, ...(spec.steps ?? {}) };
  if (spec.steps?.far === undefined) steps.far = Math.max(3, steps.mid - 1);
  const ov = spec.overrides ?? {};
  const seed = String(spec.seed);
  const table: RoleScreen[] = [];
  const keys = new Map<string, number>();
  const made: RoleKey[] = [];
  const rngFor = (tag: string) => createMulberry32(fnv1a32(`${seed}|${tag}`));
  const pick = (list: ReadonlyArray<readonly [ScreenId, number]>, r: () => number, avoid: ScreenId[] = []): ScreenId => {
    // (Variety 0: the first rule. Else weighted, never a screen that fights one it must sit beside.)
    const ok = list.filter(([id]) => avoid.every((a) => a === id || screenPair(a, id) > 0));
    const pool = ok.length ? ok : list;
    if (variety === 0 || pool.length === 1) return pool[0]![0];
    const w = pool.map(([id, x], i) => [id, i === 0 ? x : x * variety] as const);
    let t = r() * w.reduce((a, [, x]) => a + x, 0);
    for (const [id, x] of w) { if (t < x) return id; t -= x; }
    return w[w.length - 1]![0];
  };
  // (The scene's sky and its near things' lead screen, picked first: the others keep the peace with them.)
  const skyId = pick(FAR.sky.screens, rngFor("far/sky"));
  const make = (k: RoleKey): RoleScreen => {
    const side = k.side ?? "lit";
    const rule = DEPTH_RULES[k.band][k.family];
    const r = rngFor(`${k.band}/${k.family}`);
    const why: string[] = [`${k.band} ${k.family} ${side}`];
    let id = k.band === "far" && k.family === "sky" ? skyId : pick(rule.screens, r, k.band === "far" ? [] : [skyId]);
    const g = rule.gamma ? rule.gamma[0] + (rule.gamma[1] - rule.gamma[0]) * (variety ? r() : 0.5) : 1;
    // (A noise tile or a line starts at the scene's own place in it.)
    const kind = SCREENS[id] ? id : "bayer4";
    const ph: [number, number] = ["stipple", "ign", "lines", "diagonal", "hatch", "weave"].includes(kind) && variety ? [Math.floor(r() * 64), Math.floor(r() * 64)] : [0, 0];
    let out: RoleScreen = {
      id, steps: Math.max(2, steps[k.band] + (rule.steps ?? 0)), bias: spec.bias?.[k.band] ?? 0, scale: 1,
      contrast: spec.aerial === false ? 1 : rule.contrast ?? 1, pivot: 0.45, gamma: g, phase: ph, solid: false, flat: spec.aerial === false ? 0 : rule.flat ?? 0, why: "",
    };
    if (side === "shade" && spec.shade !== false && k.band !== "far" && !SHADE_SAME.has(k.family)) {
      // (By default the same pattern, denser: the terminator is a change of tone, never a seam where one pattern
      // meets another on a smooth surface -- a blind critic read hatched shade halves on a mask, a pot, a console
      // as wrong-material stripes. `shade: "hatch"` asks for the engraver's directional shade screen.)
      if (spec.shade === "hatch") {
        const rs = rngFor(`${k.band}/${k.family}/shade`);
        id = pick(SHADE_SCREENS.filter(([s]) => s !== out.id), rs, [out.id, skyId]);
        out = { ...out, id };
        why.push("shade hatch");
      } else {
        out = { ...out, gamma: out.gamma * SHADE_GAMMA };
        why.push("shade denser");
      }
    }
    if (side === "edge" && spec.edge !== false && k.band === "near") { out = { ...out, solid: true }; why.push("solid edge"); }
    const apply = (o: RoleOverride | undefined, tag: string) => { if (!o) return; out = { ...out, ...o, phase: o.phase ?? out.phase }; why.push(tag); };
    apply(ov.all, "all");
    apply(ov.bands?.[k.band], `bands.${k.band}`);
    apply(ov.families?.[k.family], `families.${k.family}`);
    apply(ov.sides?.[side], `sides.${side}`);
    if (k.object !== undefined) apply(ov.objects?.[String(k.object)], `objects.${k.object}`);
    if (k.object !== undefined && k.part !== undefined) apply(ov.parts?.[`${k.object}/${k.part}`], `parts.${k.object}/${k.part}`);
    if (!SCREENS[out.id]) out = { ...out, id: "bayer4" };
    return { ...out, steps: Math.max(2, Math.round(out.steps)), scale: Math.max(1, Math.round(out.scale)), why: why.join(", ") };
  };
  const named = (k: RoleKey) => {
    // (An object or a part is part of the key only when an override names it: else it is its family's role.)
    const o = k.object !== undefined && ov.objects?.[String(k.object)] ? k.object : undefined;
    const p = k.object !== undefined && k.part !== undefined && ov.parts?.[`${k.object}/${k.part}`] ? k.part : undefined;
    return { ...k, side: k.side ?? "lit", object: o ?? (p !== undefined ? k.object : undefined), part: p };
  };
  return {
    spec,
    table,
    index(key) {
      const k = named(key);
      const s = `${k.band}|${k.family}|${k.side}|${k.object ?? ""}|${k.part ?? ""}`;
      let i = keys.get(s);
      if (i === undefined) {
        if (table.length >= 255) return 0;
        i = table.length;
        table.push(make(k));
        made.push(k);
        keys.set(s, i);
      }
      return i;
    },
    describe() { return Object.fromEntries([...keys].map(([s, i]) => [s, table[i]!])); },
    keyOf(i) { return made[i]; },
  };
}

export interface DepthQuantizerSpec {
  width: number;
  height: number;
  ramps: QuantizeRamps;
  lums: Float32Array;
  plan: DepthDitherPlan;
  halo?: LayerScreen;
}

/**
 * The quantizer for a plan: as the core quantizer (createQuantizer), but each
 * pixel wears its role's screen (`role[k]`, a plan index), read at its
 * scale and phase, through its contrast and density curve -- and, given
 * `phx`/`phy`, where that point of a moved thing stood at rest. A glow's
 * halo still wears the halo screen; buf.layer still picks the outside ramp.
 */
export function createDepthQuantizer({ width, height, ramps, lums, plan, halo = HALO_SCREEN }: DepthQuantizerSpec) {
  const n = width * height;
  return function quantize(buf: QuantizeInput, region: Region | null = null, out = new Uint8Array(n), t = 0, role: Uint8Array, phx: Int8Array | null = null, phy: Int8Array | null = null): Uint8Array {
    const cycOf = (i: number, len: number, x: number, y: number): number => {
      const w = Math.sin(2 * Math.PI * (t + x * 0.09 + y * 0.05));
      const j = i + (w > 0.5 ? 1 : w < -0.5 ? -1 : 0);
      return j < 0 ? 0 : j >= len ? len - 1 : j;
    };
    const [x0, y0, x1, y1] = region ?? [0, 0, width - 1, height - 1];
    for (let y = y0; y <= y1; y += 1) {
      for (let xs = x0; xs <= x1; xs += 1) {
        const k = y * width + xs;
        const R = plan.table[role[k]!] ?? plan.table[0]!;
        // (The point of the thing this pixel shows, where it stood at rest, in the role's own pattern.)
        const bx = xs - (phx ? phx[k]! : 0);
        const by = y - (phy ? phy[k]! : 0);
        const x = Math.floor((bx + R.phase[0]) / R.scale);
        const yy = Math.floor((by + R.phase[1]) / R.scale);
        const raw = buf.L[k]!;
        let L = raw < 0.035 ? 0 : ((raw - 0.035) / 0.965) ** 1.15;
        const L0 = L; // (whether a light's ink shows is the light's say, not the role's curve: a pulled-up dark must not catch an ink it never had)
        if (R.contrast !== 1 && L > 0) L = Math.max(0, R.pivot + (L - R.pivot) * R.contrast);
        if (R.gamma !== 1 && L > 0) L = Math.min(1, L) ** R.gamma;
        // (Flat fills on the surface's own tones only: a light's ink -- a moon, a lit window, a candle's pool -- keeps its gradient.)
        let Lf = L;
        if (R.flat > 0 && !buf.halo[k] && L > 0) { const v = Math.min(1, L) * (R.steps - 1); const b = Math.floor(v); Lf = (b + Math.min(1, Math.max(0, (v - b - 0.5) * (1 + R.flat) + 0.5))) / (R.steps - 1); }
        const layer = buf.layer[k]!;
        const screen: LayerScreen = buf.halo[k] ? halo : R;
        const at = (light: number, len: number, lum: Float32Array) => (R.solid && !buf.halo[k] ? solidIndex(light, R, len) : screenIndex(light, x, yy, screen, len, lum));
        const a = buf.accent[k]!;
        if ((a & 3) && L0 > 0.14 && L > 0.14 && (a < 4 || (a >> 2) / 16 > BAYER4Q[(by & 3) * 4 + (bx & 3)]!)) {
          const ar = (a & 3) === 2 ? ramps.accent2 : ramps.accent;
          const i = at((L - 0.14) / 0.86, ar.len, lums.subarray(ar.base, ar.base + ar.len));
          out[k] = ar.base + (buf.cyc[k] || (layer === 4 && a) ? cycOf(i, ar.len, bx, by) : i);
        } else {
          const ramp = layer === 0 ? ramps.outside : ramps.key;
          const i = at(Lf, ramp.len, lums.subarray(ramp.base, ramp.base + ramp.len));
          out[k] = ramp.base + (buf.cyc[k] ? cycOf(i, ramp.len, bx, by) : i);
        }
      }
    }
    return out;
  };
}

/** A solid run: the step nearest the light, on the ramp as screenIndex lays steps on it -- no pattern. */
export function solidIndex(light: number, screen: LayerScreen, rampLen: number): number {
  const steps = screen.steps;
  const q = Math.round((light < 0 ? 0 : light > 1 ? 1 : light) * (steps - 1));
  const at = Math.round((q / (steps - 1)) * (rampLen - 1 - screen.bias)) + (q > 0 ? screen.bias : 0);
  return at < 0 ? 0 : at >= rampLen ? rampLen - 1 : at;
}

/** Every style a role can wear, with what it is for (the documentation's table, as data). */
export const DEPTH_STYLES: Readonly<Record<ScreenId, string>> = {
  bayer2: "2x2 ordered: the densest checker-like mix; by override only (a large patch of it reads as a checkerboard)",
  bayer4: "4x4 ordered: the all-rounder; metal, glass, rooms",
  bayer8: "8x8 ordered: fine, smooth gradients; the sky, far things, glass",
  chunky: "4x4 ordered in 2x2 blocks: a coarse, deliberate ordered look",
  halftone: "clustered dots at 45 degrees: stone, glow (the dot blooms)",
  coarseDot: "big clustered dots: a print-like glow or a poster sky",
  lines: "horizontal line screen: wood along a sill's grain",
  diagonal: "diagonal lines: wood across, and the shade side's hatching",
  hatch: "crossed lines: an engraved shade side",
  stipple: "blue noise (64x64 void-and-cluster): cloth, skin and organic things, fog",
  ign: "interleaved gradient noise: a structured grain for organic things and glass",
  checker: "two-level checker: a flat 50% fill",
  weave: "a woven pattern: cloth that shows its weave",
};
