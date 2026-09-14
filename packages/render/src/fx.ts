// Post fx for the pixel renderer -- ported from the proof of concept's
// src/fx/fx.js. A declarative list, resolved for a target size, turned into
// the pixel pass's uniforms. Every pass works ON THE RAMPS -- it moves a pixel
// up or down its palette ramp, or onto another ramp -- before the dither
// screen picks the entry, so what comes out is still palette entries: pixel
// art stays pixel art.
//
//   renderer.setFx([
//     { name: "glow", radius: 3 },            // emissive things climb their ramps, with a dithered halo
//     { name: "fog", ramp: "sky", near: 20, far: 80 },
//     { name: "vignette" }, { name: "scanlines" },
//     { name: "cycle", ramps: { water: { speed: 3, from: 0.5 } } },
//   ]);
//   renderer.toggleFx("scanlines", false);
//
// Pure and deterministic: resolveFx(list, target) adapts every pixel-sized
// param to the target (a halo's radius in pixels grows with the picture;
// scanlines only from 96 px; the dither screen from core's screenForTarget),
// so the same list reads at 32 x 32 and at 256 x 256. The world runtime puts
// the list under config locks by pass name.

import { SCREENS, screenForTarget } from "@keel-engine/core";
import type { ScreenId, ScreenPreference } from "@keel-engine/core";

/** A ramp by name (as setPalette named it) or by index. */
export type RampRef = string | number;
/** One palette entry: a ramp and an index on it (negative counts from the top), or a raw palette index. */
export type EntryRef = number | { readonly ramp: RampRef; readonly index: number };
export type GradePreset = "day" | "dusk" | "night";
export type OutlineMode = "all" | "outer" | "none";
/** A cycled ramp's own speed (entries a second) and start (a fraction of the ramp); unset ones take the pass's. */
export interface CycleRamp {
  readonly speed?: number | undefined;
  readonly from?: number | undefined;
}

/** Every pass's params, as given (the defaults fill what isn't). */
export interface FxParams {
  crt: { curve: number; border: EntryRef; minSize: number };
  grade: { preset: GradePreset | (string & {}); shift: number | null; map: Readonly<Record<string, string>> };
  fog: { ramp: RampRef; near: number; far: number; amount: number; light: number };
  glow: { radius: number; halo: number; self: number; threshold: number; tint: boolean };
  rim: { width: number; steps: number; dir: "sun" | readonly [number, number] };
  flash: { amount: number; mats: readonly number[]; ids: readonly [number, number] | null; ramp: RampRef | null };
  vignette: { inner: number; outer: number; steps: number };
  scanlines: { period: number; steps: number; minSize: number };
  dither: { screen: "auto" | "none" | ScreenPreference; amount: number };
  outline: { mode: OutlineMode; steps: number; gap: number; color: EntryRef | null };
  cycle: { ramps: Readonly<Record<string, CycleRamp>> | readonly string[]; speed: number; from: number };
}

/** Every pass's params once resolved for a target (what fxUniforms reads). */
export interface FxResolvedParams {
  crt: { curve: number; border: EntryRef };
  grade: { shift: number; map: Record<string, string> };
  fog: FxParams["fog"];
  glow: FxParams["glow"];
  rim: FxParams["rim"];
  flash: FxParams["flash"];
  vignette: FxParams["vignette"];
  scanlines: { period: number; dark: number; steps: number };
  dither: { screen: ScreenId | "none"; amount: number };
  outline: { mode: OutlineMode; steps: number; gap: number; color: EntryRef | null };
  cycle: { ramps: Record<string, { speed: number; from: number }> };
}

export type FxName = keyof FxParams;

/** One entry of an fx list: a pass by name, on unless `on: false`, with any of its params. */
export type FxEntry = { [K in FxName]: { readonly name: K; readonly on?: boolean | undefined } & Partial<FxParams[K]> }[FxName];
export type FxList = readonly FxEntry[];

/** One pass as resolved for a target: on with its resolved params, or off with its params as given and why. */
export type FxResolved = {
  [K in FxName]: { name: K; on: true; params: FxResolvedParams[K] } | { name: K; on: false; params: FxParams[K]; note: string };
}[FxName];

/** A pass: its params' defaults, and how they meet a target (the short side, then W and H). */
export interface FxDef<K extends FxName> {
  readonly defaults: FxParams[K];
  readonly resolve: (p: FxParams[K], side: number, width: number, height: number) => FxResolvedParams[K] | { readonly off: string };
}

/** A target: a number (square), `{ width, height }` or `[width, height]`. */
export type FxTarget = number | { readonly width: number; readonly height: number } | readonly [number, number];

/** The passes, in the order the pixel pass applies them (each is on when listed, unless `on: false`). */
export const FX_ORDER: readonly FxName[] = ["crt", "grade", "fog", "glow", "rim", "flash", "vignette", "scanlines", "dither", "outline", "cycle"];

// Each pass: its params' defaults, and how they meet a target (W x H, pixels).
// (`ref` sizes are "at 128 px": a param in pixels scales with the short side from there.)
const scalePx = (v: number, side: number, min = 1, max = 64): number => Math.max(min, Math.min(max, Math.round((v * side) / 128)));
export const GRADE_PRESETS: Readonly<Record<GradePreset, { readonly shift: number }>> = { day: { shift: 0 }, dusk: { shift: -0.6 }, night: { shift: -1.4 } };

export const FX: { readonly [K in FxName]: FxDef<K> } = {
  // A tube's bend: whole pixels moved outward from the middle, the corners gone to a border entry. (From 64 px.)
  crt: { defaults: { curve: 0.08, border: { ramp: 0, index: 0 }, minSize: 64 }, resolve: (p, side) => (side < p.minSize ? { off: `below ${p.minSize} px` } : { curve: p.curve, border: p.border }) },
  // Colour grading by ramps: each ramp swapped for its graded twin (map: { stone: "stoneNight" }), then shifted along it.
  grade: {
    defaults: { preset: "day", shift: null, map: {} },
    resolve: (p) => ({ shift: p.shift ?? (Object.hasOwn(GRADE_PRESETS, p.preset) ? GRADE_PRESETS[p.preset as GradePreset] : GRADE_PRESETS.day).shift, map: { ...p.map } }),
  },
  // Fog by distance: past `near`, pixels go over to the fog ramp -- dithered, by the screen -- all of them by `far`.
  fog: { defaults: { ramp: "sky", near: 25, far: 90, amount: 1, light: 0.3 }, resolve: (p) => ({ ...p }) },
  // Glow: emissive materials (glow >= threshold) climb `self` entries; round them a halo `radius` px (at 128) climbs `halo`.
  glow: {
    defaults: { radius: 3, halo: 2.5, self: 1, threshold: 0.2, tint: false },
    resolve: (p, side) => ({ ...p, radius: scalePx(p.radius, side, 1, 16) }),
  },
  // Rim light: an edge on the light's side (`dir`: "sun" or a screen direction [x, y]) climbs `steps`; `width` px at 128.
  rim: { defaults: { width: 1, steps: 1.5, dir: "sun" }, resolve: (p, side) => ({ ...p, width: scalePx(p.width, side, 1, 4) }) },
  // Hit flash: the struck thing -- by material (`mats`) or id range (`ids: [from, to]`) -- goes up by `amount` (0..1), or onto `ramp`.
  flash: { defaults: { amount: 0, mats: [], ids: null, ramp: null }, resolve: (p) => ({ ...p, amount: Math.max(0, Math.min(1, p.amount)), mats: p.mats.slice(0, 8) }) },
  // Vignette: from `inner` to `outer` (fractions of the half-diagonal), `steps` down the ramps, dithered.
  vignette: { defaults: { inner: 0.55, outer: 1.1, steps: 2 }, resolve: (p) => ({ ...p }) },
  // Scanlines: `dark` rows of every `period` (px at 128) a step down. Only from `minSize` px: below it they are the picture.
  scanlines: {
    defaults: { period: 2, steps: 1, minSize: 96 },
    resolve: (p, side) => {
      if (side < p.minSize) return { off: `below ${p.minSize} px` };
      const period = Math.max(2, scalePx(p.period, side, 2, 16));
      return { period, dark: Math.max(1, Math.floor(period / 2)), steps: p.steps };
    },
  },
  // The dither screen: a core screen id or family ("ordered", "dot", "line", "noise", "pattern"), or "auto"; `amount` 0..1.
  dither: {
    defaults: { screen: "auto", amount: 0.9 },
    resolve: (p, _side, W, H) => {
      if (p.screen === "none" || p.amount <= 0) return { screen: "none", amount: 0 };
      const pref = p.screen === "auto" ? "ordered" : p.screen;
      return { screen: screenForTarget(W, H, pref).id, amount: p.amount };
    },
  },
  // The outline: "all" (a thing against anything behind it -- the classic), "outer" (only across `gap` metres:
  // silhouettes, not the parts inside them), "none"; `steps` darker, or in one `color` { ramp, index }.
  outline: {
    defaults: { mode: "all", steps: 3, gap: 1.5, color: null },
    resolve: (p) => (p.mode === "none" ? { off: "mode none" } : { mode: p.mode, steps: p.steps, gap: p.mode === "outer" ? p.gap : 0.56, color: p.color }),
  },
  // Palette cycling: named ramps' upper entries (from `from`, a fraction of the ramp) turn over at `speed` entries a second.
  cycle: {
    defaults: { ramps: {}, speed: 3, from: 0.5 },
    resolve: (p) => {
      const list: Readonly<Record<string, CycleRamp>> = isList(p.ramps) ? Object.fromEntries(p.ramps.map((r) => [r, {}])) : p.ramps;
      return { ramps: Object.fromEntries(Object.entries(list).map(([r, o]) => [r, { speed: o.speed ?? p.speed, from: o.from ?? p.from }])) };
    },
  },
};
// (Array.isArray doesn't narrow a readonly array out of a union.)
const isList = (v: unknown): v is readonly string[] => Array.isArray(v);

export const FX_NAMES = Object.keys(FX) as FxName[];

const known = (name: unknown): name is FxName => typeof name === "string" && Object.hasOwn(FX, name);

/** The target's width and height (a number is square). */
const dims = (target: FxTarget): [number, number] => {
  if (typeof target === "number") return [target, target];
  if ("width" in target) return [target.width, target.height];
  return [target[0], target[1]];
};

/**
 * Resolve a list for a target size: [{ name, on, params, note }] in FX_ORDER,
 * one per named pass (a later entry of a name merges over an earlier one).
 * Passes not listed are absent; a pass the target can't carry is `on: false`
 * with a `note`. Unknown names throw (a typo is not an effect).
 */
export function resolveFx(list: FxList = [], target: FxTarget = 128): FxResolved[] {
  const [W, H] = dims(target);
  const side = Math.min(W, H); // (the short side: every pixel param is measured against it)
  const byName = new Map<FxName, Record<string, unknown>>();
  for (const e of list as readonly (FxEntry | null | undefined)[]) {
    if (!e || !known(e.name)) throw new RangeError(`Unknown fx pass: ${String(e?.name)}`);
    byName.set(e.name, { ...(byName.get(e.name) ?? {}), ...e });
  }
  const out: FxResolved[] = [];
  for (const name of FX_ORDER) {
    const entry = byName.get(name);
    if (!entry) continue;
    const { name: _, on = true, ...given } = entry;
    out.push(resolveOne(name, Boolean(on), given, side, W, H));
  }
  return out;
}

function resolveOne<K extends FxName>(name: K, on: boolean, given: Record<string, unknown>, side: number, W: number, H: number): FxResolved {
  const def = FX[name] as FxDef<K>;
  const params = { ...def.defaults, ...given } as FxParams[K];
  if (!on) return { name, on: false, params, note: "turned off" } as FxResolved;
  const r = def.resolve(params, side, W, H);
  if ("off" in r && r.off) return { name, on: false, params, note: r.off } as FxResolved;
  return { name, on: true, params: r } as FxResolved;
}

/** A list with one pass turned on or off (added with its defaults when it wasn't listed). Pure. */
export function toggleFx(list: FxList, name: FxName, on: boolean): FxEntry[] {
  if (!known(name)) throw new RangeError(`Unknown fx pass: ${String(name)}`);
  const has = list.some((e) => e.name === name);
  return has ? list.map((e) => (e.name === name ? { ...e, on } : e)) : [...list, { name, on }];
}

/** Every pass, all on, with its defaults (the sheet's "all fx"). */
export const ALL_FX = (): FxEntry[] => [
  { name: "grade", preset: "dusk" }, { name: "fog" }, { name: "glow" }, { name: "rim" }, { name: "vignette" },
  { name: "scanlines" }, { name: "dither", screen: "auto" }, { name: "outline", mode: "all" }, { name: "cycle", ramps: ["water"] },
];

/** The style the pixel pass falls back to where no fx pass says otherwise. */
export interface RenderStyle {
  /** 0 none, 2 / 4 / 8 Bayer, or a core screen id ("stipple", "halftone", ...; "bayer4" and "none" work too). */
  readonly screen: number | ScreenId | "none";
  /** How far the screen reaches between two entries (0..1). */
  readonly dither: number;
  /** The classic outline on (1) or off (0). */
  readonly outline: number;
}

/** What fxUniforms knows of the palette: ramp(name) -> index (-1 unknown), rampOf(index) -> [base, len]. */
export interface FxLook {
  readonly ramp: (name: string) => number;
  readonly rampOf: (index: number) => readonly [number, number];
  readonly style?: RenderStyle | undefined;
  /** The far plane depth is measured against (the shader's FAR). */
  readonly far: number;
}

type V2 = [number, number];
type V3 = [number, number, number];
type V4 = [number, number, number, number];

/** The pixel pass's uniform values. */
export interface PixelUniforms {
  uScreen: number;
  uDither: number;
  uOutline: V3;
  uOutlineInk: number;
  uCrt: V4;
  uGrade: V2;
  uFog: V4;
  uFogLook: V2;
  uGlow: V4;
  uGlowK: V2;
  uRim: V4;
  /** null: the renderer aims it at the sun. */
  uRimDir: readonly [number, number] | null;
  uFlash: V4;
  uFlashMats: number[];
  uVig: V4;
  uScan: V4;
  uCycle: number;
}

export interface FxUniforms {
  u: PixelUniforms;
  /** Per-ramp rows: cycled ramps [ramp, fromEntry, speed], graded ramps [ramp, toRamp]. */
  ramps: { cycle: V3[]; grade: V2[] };
  /** The core screen to load into the screen texture, or null (a Bayer screen or none: the shader's own). */
  screen: ScreenId | null;
}

/**
 * The pixel pass's uniform values for a resolved list. `look` knows the
 * palette: ramp(name) -> index (-1 unknown), rampOf(index) -> [base, len], and
 * the style's defaults (screen, dither, outline) that apply when a pass isn't
 * listed. Pure: the renderer only copies these into GL.
 */
export function fxUniforms(resolved: readonly FxResolved[], look: FxLook): FxUniforms {
  const on: { [K in FxName]?: FxResolvedParams[K] } = {};
  for (const p of resolved) if (p.on) (on as Record<string, unknown>)[p.name] = p.params;
  const ramp = (r: RampRef): number => (typeof r === "number" ? r : look.ramp(r));
  const entry = (c: EntryRef | null | undefined): number => {
    if (c == null) return -1;
    if (typeof c === "number") return c;
    const r = ramp(c.ramp);
    if (r < 0) return -1;
    const [base, len] = look.rampOf(r);
    return base + Math.max(0, Math.min(len - 1, c.index < 0 ? len + c.index : c.index));
  };
  // Dither: the fx pass, or the style's own.
  const style = look.style ?? { screen: 4, dither: 0.9, outline: 1 };
  let screen: number | string = style.screen;
  let dither = style.dither;
  if (on.dither) { screen = on.dither.screen; dither = on.dither.amount; }
  else if (resolved.some((p) => p.name === "dither")) { screen = 0; dither = 0; }
  const bayer: Readonly<Record<string, number>> = { bayer2: 2, bayer4: 4, bayer8: 8, none: 0 };
  // (A Bayer screen or none is the shader's own code; any other core screen goes to the screen texture.)
  let uScreen: number;
  let tile: ScreenId | null = null;
  if (typeof screen === "string") {
    const b = Object.hasOwn(bayer, screen) ? bayer[screen] : undefined;
    if (b !== undefined) uScreen = b;
    else if (Object.hasOwn(SCREENS, screen)) { uScreen = -1; tile = screen as ScreenId; }
    else throw new RangeError(`Unknown screen: ${screen}`);
  } else uScreen = screen | 0;
  // Outline: the pass, or the style's (the classic: 3 darker against anything behind).
  const ol = resolved.find((p) => p.name === "outline");
  let uOutline: V3;
  let uOutlineInk: number;
  if (ol) {
    uOutline = ol.on ? [1, ol.params.steps, ol.params.gap / look.far] : [0, 3, 0.004];
    uOutlineInk = ol.on ? entry(ol.params.color) : -1;
  } else { uOutline = [style.outline ? 1 : 0, 3, 0.004]; uOutlineInk = -1; }
  const { crt, fog, glow, rim, flash: fl, vignette: vig, scanlines: sc, cycle: cy } = on;
  const mats = fl ? [...fl.mats, -1, -1, -1, -1, -1, -1, -1, -1].slice(0, 8) : Array<number>(8).fill(-1);
  const cycle: V3[] = [];
  if (cy) {
    for (const [name, o] of Object.entries(cy.ramps)) {
      const r = ramp(name);
      if (r < 0) continue;
      const len = look.rampOf(r)[1];
      cycle.push([r, Math.min(len - 1, Math.max(0, Math.round(o.from * len))), o.speed]);
    }
  }
  const grade: V2[] = [];
  if (on.grade) for (const [from, to] of Object.entries(on.grade.map)) { const a = ramp(from); const b = ramp(to); if (a >= 0 && b >= 0) grade.push([a, b]); }
  const u: PixelUniforms = {
    uScreen,
    uDither: dither,
    uOutline,
    uOutlineInk,
    uCrt: crt ? [1, crt.curve, Math.max(0, entry(crt.border)), 0] : [0, 0, 0, 0],
    uGrade: on.grade ? [1, on.grade.shift] : [0, 0],
    uFog: fog ? [ramp(fog.ramp) >= 0 ? 1 : 0, fog.near, fog.far, fog.amount] : [0, 0, 1, 0],
    uFogLook: fog ? [Math.max(0, ramp(fog.ramp)), fog.light] : [0, 0],
    uGlow: glow ? [1, glow.radius, glow.halo, glow.self] : [0, 1, 0, 0],
    uGlowK: glow ? [glow.threshold, glow.tint ? 1 : 0] : [1, 0],
    uRim: rim ? [1, rim.width, rim.steps, 0] : [0, 1, 0, 0],
    uRimDir: rim && isPair(rim.dir) ? rim.dir : null, // (null: the renderer aims it at the sun)
    uFlash: fl ? [fl.amount, fl.ramp == null ? -1 : ramp(fl.ramp), fl.ids ? fl.ids[0] : 1, fl.ids ? fl.ids[1] : 0] : [0, -1, 1, 0],
    uFlashMats: mats,
    uVig: vig ? [1, vig.inner, vig.outer, vig.steps] : [0, 0, 1, 0],
    uScan: sc ? [1, sc.period, sc.dark, sc.steps] : [0, 2, 0, 0],
    uCycle: cycle.length ? 1 : 0,
  };
  return { u, ramps: { cycle, grade }, screen: tile };
}
const isPair = (v: unknown): v is readonly [number, number] => Array.isArray(v);

/**
 * A screen's thresholds as a tile of bytes (SCREEN_TILE square), for the pixel
 * pass's screen texture: the core map sampled at every pixel.
 */
export function screenTile(id: ScreenId, tile = 192): Uint8Array {
  const at = SCREENS[id].at;
  const out = new Uint8Array(tile * tile);
  for (let y = 0; y < tile; y += 1) for (let x = 0; x < tile; x += 1) out[y * tile + x] = Math.max(0, Math.min(255, Math.round(at(x, y) * 255)));
  return out;
}
