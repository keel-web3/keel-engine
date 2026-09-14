// Themes from a seed. A theme is a RECIPE -- the generator (keel/ui/theme@1),
// a seed, a culture and sparse pins -- and everything the UI draws with is
// derived from it: a palette of OKLCH ramps (surface, ink, accent, the
// good/warn/bad semantics, team colours), a frame style (corners, border,
// bevel, fill, dither screen, shadow, glow), a type scale and a font family,
// spacing, icon style and motion. The stored theme is the recipe (a few bytes,
// UI_THEME in schemas.ts); the same recipe always gives the same theme.
//
// Cultures are coherent starting points -- an RTS race's flavour picks one and
// its seed does the rest -- so an industrial race gets riveted steel and amber
// warning lights, a crystalline one notched glass, and no two seeds match.
//
// Every decision draws from its own named stream, a fixed number of draws, so
// a pin changes what it pins and nothing else.

import { SCREEN_IDS, createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { ScreenId, Stream, Weighted } from "@keel-engine/core";
import { contrast, fromOklch } from "./color.ts";
import type { Rgba } from "./color.ts";
import { DEFAULT_FONT_RANGES, fontParamsOf } from "./genfont.ts";
import type { FontParams, FontRanges } from "./genfont.ts";

export const THEME_GENERATOR = "keel/ui/theme@1";

export const CULTURES = ["industrial", "organic", "crystalline", "arcane", "brutal", "clean"] as const;
export type Culture = (typeof CULTURES)[number];
export const CORNERS = ["flat", "bevel", "inset", "notched", "rivets", "glow", "round"] as const;
export type Corner = (typeof CORNERS)[number];
export const FILLS = ["solid", "dither", "gradient", "scan"] as const;
export type Fill = (typeof FILLS)[number];
export const MOTIONS = ["snappy", "bouncy", "none"] as const;
export type MotionKind = (typeof MOTIONS)[number];
export const ICON_STYLES = ["solid", "outline", "duotone"] as const;
export type IconStyle = (typeof ICON_STYLES)[number];
export const TONES = ["dark", "light"] as const;
export type Tone = (typeof TONES)[number];

/** Five (surface: six) colours, dark to light. */
export type Ramp = readonly Rgba[];

export interface ThemePalette {
  readonly tone: Tone;
  /** 0 deepest (outlines, wells) · 1 shade · 2 panel · 3 raised · 4 highlight · 5 edge light. */
  readonly surface: Ramp;
  /** 0 dim · 1 text · 2 bright (on the panel colour, contrast-checked). */
  readonly ink: Ramp;
  readonly accent: Ramp;
  readonly good: Ramp;
  readonly warn: Ramp;
  readonly bad: Ramp;
  /** Team colour ramps, spaced round the wheel (the first ones farthest apart). */
  readonly team: readonly Ramp[];
  /** What an outline is drawn in (surface 0, or the accent's darkest for glowing cultures). */
  readonly outline: Rgba;
  /** Ink drawn on the accent (a primary button's label). */
  readonly onAccent: Rgba;
  /** Hues, for anyone generating more colours in key. */
  readonly hues: { readonly surface: number; readonly accent: number };
}

export interface FrameStyle {
  readonly corner: Corner;
  /** Corner size for round/notched/glow (px). */
  readonly radius: number;
  /** Border band inside the outline (px, 1..3). */
  readonly border: number;
  /** Bevel light/shade inside the border (0..2). */
  readonly bevel: number;
  /** A dark line inside the border. */
  readonly inner: boolean;
  /** Drop shadow (px, 0..2). */
  readonly shadow: number;
  /** Outer glow (px, 0..2). */
  readonly glow: number;
  readonly fill: Fill;
  readonly screen: ScreenId;
  /** Rivet spacing along long edges (px; 0 none). */
  readonly rivets: number;
}

export interface TypeScale {
  /** Cap heights in px (5..16). */
  readonly small: number;
  readonly body: number;
  readonly title: number;
  readonly display: number;
  readonly font: FontParams;
  /** Titles and buttons in capitals. */
  readonly caps: boolean;
}

export interface Spacing { readonly unit: number; readonly pad: number; readonly gap: number }
export interface IconTheme { readonly style: IconStyle; readonly stroke: number }
export interface Motion {
  readonly kind: MotionKind;
  /** How far a pressed button sinks (px). */
  readonly press: number;
  /** A transition's length (ms). */
  readonly ms: number;
  /** Overshoot for bouncy (0..0.4). */
  readonly overshoot: number;
}

/** Sparse pins: anything here overrides what the seed would draw. */
export interface ThemePins {
  readonly tone?: Tone;
  readonly hue?: number;
  readonly accentHue?: number;
  readonly chroma?: number;
  readonly corner?: Corner;
  readonly radius?: number;
  readonly border?: number;
  readonly bevel?: number;
  readonly fill?: Fill;
  readonly screen?: ScreenId;
  readonly shadow?: number;
  readonly glow?: number;
  readonly motion?: MotionKind;
  readonly body?: number;
  readonly caps?: boolean;
  readonly font?: Partial<FontParams>;
  readonly icon?: IconStyle;
  readonly unit?: number;
  /** How many team colours (1..24, default 8). */
  readonly teams?: number;
  /** Team hues, by slot (the rest are spaced round what's left). */
  readonly teamHues?: readonly number[];
}

export interface ThemeRecipe {
  readonly generator: typeof THEME_GENERATOR;
  readonly seed: string;
  readonly culture: Culture;
  readonly pins: ThemePins;
}

export interface Theme {
  readonly recipe: ThemeRecipe;
  readonly culture: Culture;
  readonly palette: ThemePalette;
  readonly frame: FrameStyle;
  readonly type: TypeScale;
  readonly space: Spacing;
  readonly icon: IconTheme;
  readonly motion: Motion;
  /** Names this theme exactly (its recipe): atlas entries drawn in it are keyed by it. */
  readonly key: string;
}

type Range = readonly [number, number];
interface CultureSpec {
  readonly surfaceHue: ReadonlyArray<readonly [Range, number]>;
  readonly surfaceChroma: Range;
  readonly surfaceL: Range;
  readonly accentHue: ReadonlyArray<readonly [Range, number]>;
  readonly accentChroma: Range;
  /** Hue drift across a ramp (degrees from shade to light): pixel art's warm highlights, cool shadows. */
  readonly shift: number;
  readonly light: number;
  readonly corners: Weighted<Corner>;
  readonly border: readonly number[];
  readonly bevel: readonly number[];
  readonly inner: number;
  readonly fills: Weighted<Fill>;
  readonly screens: readonly ScreenId[];
  readonly shadow: readonly number[];
  readonly font: FontRanges;
  readonly caps: number;
  readonly body: readonly number[];
  readonly ratio: Range;
  readonly unit: readonly number[];
  readonly motion: Weighted<MotionKind>;
  readonly icon: Weighted<IconStyle>;
  readonly iconStroke: readonly number[];
}

const F = DEFAULT_FONT_RANGES;

/** The cultures: coherent ranges, not fixed looks. */
export const CULTURE_SPECS: Readonly<Record<Culture, CultureSpec>> = {
  industrial: {
    surfaceHue: [[[200, 245], 4], [[30, 60], 1]], surfaceChroma: [0.012, 0.035], surfaceL: [0.27, 0.35],
    accentHue: [[[55, 88], 4], [[25, 45], 2]], accentChroma: [0.13, 0.18], shift: 8, light: 0,
    corners: [["rivets", 4], ["bevel", 3], ["notched", 1]], border: [2, 2, 3], bevel: [1, 1, 2], inner: 0.5,
    fills: [["dither", 3], ["scan", 2], ["gradient", 2], ["solid", 1]], screens: ["diagonal", "lines", "bayer4", "hatch"], shadow: [1, 1, 2],
    font: { ...F, width: [0.62, 0.85], xHeight: [0.66, 0.78], round: [0, 0, 1], stroke: [0.1, 0.2], serif: [["none", 5], ["slab", 1]], slant: 0 },
    caps: 0.75, body: [7, 7, 8], ratio: [1.25, 1.5], unit: [2, 3], motion: [["snappy", 5], ["none", 1]], icon: [["solid", 3], ["duotone", 2]], iconStroke: [1, 2],
  },
  organic: {
    surfaceHue: [[[95, 155], 4], [[35, 70], 2]], surfaceChroma: [0.03, 0.065], surfaceL: [0.25, 0.33],
    accentHue: [[[65, 105], 3], [[130, 170], 2], [[330, 360], 1]], accentChroma: [0.12, 0.17], shift: 14, light: 0.05,
    corners: [["round", 6], ["glow", 1], ["inset", 1]], border: [1, 2], bevel: [0, 1], inner: 0.3,
    fills: [["dither", 3], ["gradient", 2], ["solid", 1]], screens: ["stipple", "halftone", "weave", "coarseDot"], shadow: [0, 1, 1],
    font: { ...F, width: [0.7, 0.86], round: [2, 2, 3], stroke: [0.08, 0.15], serif: [["none", 3], ["foot", 2]], slant: 0.05, tracking: [1] },
    caps: 0.2, body: [8, 8, 9], ratio: [1.3, 1.5], unit: [3, 4], motion: [["bouncy", 5], ["snappy", 2]], icon: [["duotone", 3], ["solid", 2]], iconStroke: [1],
  },
  crystalline: {
    surfaceHue: [[[190, 235], 3], [[260, 305], 2]], surfaceChroma: [0.035, 0.075], surfaceL: [0.2, 0.28],
    accentHue: [[[165, 205], 3], [[290, 330], 2]], accentChroma: [0.13, 0.19], shift: -12, light: 0.05,
    corners: [["notched", 6], ["glow", 2], ["bevel", 1]], border: [1, 1, 2], bevel: [1], inner: 0.6,
    fills: [["gradient", 3], ["dither", 2], ["solid", 1]], screens: ["bayer4", "bayer8", "checker", "diagonal"], shadow: [0, 1],
    font: { ...F, width: [0.5, 0.66], round: [0], stroke: [0.08, 0.14], serif: [["none", 1]], slant: 0.35 },
    caps: 0.6, body: [7, 8], ratio: [1.3, 1.6], unit: [2, 3], motion: [["snappy", 5], ["bouncy", 1]], icon: [["outline", 3], ["duotone", 2]], iconStroke: [1],
  },
  arcane: {
    surfaceHue: [[[270, 325], 4], [[230, 265], 2]], surfaceChroma: [0.045, 0.085], surfaceL: [0.2, 0.28],
    accentHue: [[[70, 98], 4], [[160, 195], 2]], accentChroma: [0.12, 0.17], shift: 16, light: 0,
    corners: [["glow", 4], ["round", 2], ["notched", 1], ["inset", 1]], border: [1, 2], bevel: [0, 1], inner: 0.7,
    fills: [["dither", 3], ["gradient", 2]], screens: ["halftone", "weave", "hatch", "coarseDot"], shadow: [1],
    font: { ...F, round: [1, 2], serif: [["slab", 4], ["foot", 2], ["none", 1]], slant: 0.2 },
    caps: 0.5, body: [7, 8], ratio: [1.35, 1.6], unit: [3, 4], motion: [["bouncy", 4], ["snappy", 2]], icon: [["duotone", 4], ["outline", 1]], iconStroke: [1],
  },
  brutal: {
    surfaceHue: [[[0, 35], 3], [[340, 360], 2], [[90, 120], 1]], surfaceChroma: [0.008, 0.04], surfaceL: [0.16, 0.24],
    accentHue: [[[20, 40], 4], [[92, 112], 2]], accentChroma: [0.16, 0.22], shift: 4, light: 0,
    corners: [["flat", 6], ["inset", 2], ["notched", 1]], border: [2, 3, 3], bevel: [0], inner: 0.2,
    fills: [["solid", 3], ["scan", 2], ["dither", 1]], screens: ["chunky", "hatch", "lines"], shadow: [2, 2, 1],
    font: { ...F, width: [0.7, 0.9], stroke: [0.16, 0.25], round: [0], serif: [["none", 5], ["slab", 2]], slant: 0.1, tracking: [1] },
    caps: 0.9, body: [7, 8, 9], ratio: [1.3, 1.7], unit: [2, 3], motion: [["none", 3], ["snappy", 3]], icon: [["solid", 5]], iconStroke: [2],
  },
  clean: {
    surfaceHue: [[[215, 262], 3], [[175, 215], 2], [[0, 360], 1]], surfaceChroma: [0.008, 0.03], surfaceL: [0.27, 0.36],
    accentHue: [[[200, 262], 3], [[140, 180], 2], [[15, 45], 1]], accentChroma: [0.11, 0.16], shift: 3, light: 0.2,
    corners: [["round", 4], ["flat", 3], ["bevel", 1]], border: [1], bevel: [0, 1], inner: 0.1,
    fills: [["solid", 5], ["gradient", 2]], screens: ["bayer4", "ign", "bayer8"], shadow: [0, 1],
    font: { ...F, width: [0.55, 0.7], round: [1], stroke: [0.08, 0.13], serif: [["none", 1]], slant: 0 },
    caps: 0.15, body: [7, 7, 8], ratio: [1.25, 1.45], unit: [3, 4], motion: [["snappy", 5], ["bouncy", 1]], icon: [["outline", 3], ["solid", 2]], iconStroke: [1],
  },
};

/** An RTS race's tech flavour (keel-rts RTS.md 2.1) as a UI culture. */
export const FLAVOUR_CULTURE: Readonly<Record<string, Culture>> = {
  Machine: "industrial", Biotic: "organic", Crystalline: "crystalline", Resonant: "arcane", Thermal: "brutal", Gravitic: "clean",
};
export const cultureOf = (flavour: string): Culture =>
  (CULTURES as readonly string[]).includes(flavour) ? (flavour as Culture) : FLAVOUR_CULTURE[flavour] ?? FLAVOUR_CULTURE[flavour[0]?.toUpperCase() + flavour.slice(1).toLowerCase()] ?? "clean";

const wrapHue = (h: number): number => ((h % 360) + 360) % 360;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const pickRange = (S: Stream, ranges: ReadonlyArray<readonly [Range, number]>): number => { const [a, b] = S.weighted(ranges); return S.between(a, b); };

/** A ramp of n colours: lightness from lo to hi, hue drifting by `shift` across it, chroma easing off at both ends. */
export function ramp(n: number, hue: number, chroma: number, lo: number, hi: number, shift: number): Rgba[] {
  const out: Rgba[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const L = lo + (hi - lo) * t;
    const C = chroma * (1 - 0.45 * Math.abs(t - 0.5) * 2 * (t > 0.5 ? 1 : 0.5));
    out.push(fromOklch(L, C, wrapHue(hue + shift * (t - 0.5) * 2)));
  }
  return out;
}

// (Ink lightened -- or, on a light theme, darkened -- until it reads on every surface it sits on.)
function readable(L: number, chroma: number, hue: number, on: readonly Rgba[], min: number, dir: 1 | -1): Rgba {
  let c = fromOklch(L, chroma, hue);
  for (let step = 0; step < 60 && on.some((s) => contrast(c, s) < min); step += 1) {
    L = Math.max(0, Math.min(1, L + dir * 0.012));
    c = fromOklch(L, chroma * (step > 30 ? 0.5 : 1), hue);
  }
  return c;
}

/** The recipe's key: stable, short, content-derived. */
export function recipeKey(r: ThemeRecipe): string {
  const text = JSON.stringify([r.generator, r.seed, r.culture, sortPins(r.pins)]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `theme:${h.toString(16).padStart(8, "0")}`;
}
function sortPins(p: ThemePins): unknown {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(p).sort()) {
    const v = (p as Record<string, unknown>)[k];
    if (v === undefined) continue;
    o[k] = v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v;
  }
  return o;
}

export interface ThemeOptions {
  readonly seed?: string | number;
  readonly culture?: Culture | string;
  readonly pins?: ThemePins;
}

/** A theme from a seed, a culture (or an RTS flavour) and pins. */
export function generateTheme({ seed = 1, culture = "clean", pins = {} }: ThemeOptions = {}): Theme {
  return themeOf({ generator: THEME_GENERATOR, seed: String(seed), culture: cultureOf(String(culture)), pins });
}

/** A theme from its recipe (what a stored UI_THEME decodes to). */
export function themeOf(recipe: ThemeRecipe): Theme {
  if (recipe.generator !== THEME_GENERATOR) throw new RangeError(`This is ${THEME_GENERATOR}; the recipe names ${recipe.generator}.`);
  const spec = CULTURE_SPECS[recipe.culture];
  if (!spec) throw new RangeError(`"${recipe.culture}" isn't a culture (${CULTURES.join(", ")}).`);
  const P = recipe.pins;
  const S = (name: string): Stream => stream(createRoll(deriveSeed(`${recipe.seed}/${recipe.culture}`, `ui/theme/${name}`)), 0);

  // Palette.
  const sp = S("palette");
  const drawnTone: Tone = sp.chance(spec.light) ? "light" : "dark";
  const drawnHue = pickRange(sp, spec.surfaceHue);
  const drawnChroma = sp.between(spec.surfaceChroma[0], spec.surfaceChroma[1]);
  const drawnL = sp.between(spec.surfaceL[0], spec.surfaceL[1]);
  const drawnAccent = pickRange(sp, spec.accentHue);
  const accentChroma = sp.between(spec.accentChroma[0], spec.accentChroma[1]);
  const semanticNudge = sp.between(-8, 8);
  const teamStart = sp.between(0, 360);
  const tone = P.tone ?? drawnTone;
  const hue = wrapHue(P.hue ?? drawnHue);
  const chroma = P.chroma ?? drawnChroma;
  const accentHue = wrapHue(P.accentHue ?? drawnAccent);
  const shift = spec.shift;
  const dark = tone === "dark";
  const base = dark ? drawnL : 0.9 - (drawnL - 0.25) * 0.4;
  const surface = dark
    ? ramp(6, hue, chroma, Math.max(0.06, base - 0.15), Math.min(0.72, base + 0.27), shift).map((c, i) => (i === 2 ? fromOklch(base, chroma, hue) : c))
    : ramp(6, hue, chroma * 0.8, 0.58, 0.99, shift).map((c, i) => (i === 2 ? fromOklch(base, chroma * 0.6, hue) : c));
  const panels = [surface[1]!, surface[2]!, surface[3]!];
  const ink: Rgba[] = dark
    // (Dim ink -- descriptions, secondary lines -- still 4.5:1 on every panel surface: dimmer than the text, never faint.)
    ? [readable(0.74, 0.025, hue, panels, 4.6, 1), readable(0.9, 0.02, hue, panels, 5.5, 1), readable(0.97, 0.015, hue, panels, 7, 1)]
    : [readable(0.46, 0.03, hue, panels, 4.6, -1), readable(0.28, 0.03, hue, panels, 6, -1), readable(0.16, 0.03, hue, panels, 8, -1)];
  const accent = ramp(5, accentHue, accentChroma, 0.36, 0.9, shift * 0.6);
  const semantic = (h: number, c: number) => ramp(5, h + semanticNudge, c, 0.36, 0.9, shift * 0.4);
  const teams = Math.max(1, Math.min(24, P.teams ?? 8));
  const team: Rgba[][] = [];
  for (let i = 0; i < teams; i += 1) {
    const th = P.teamHues?.[i] ?? wrapHue(teamStart + i * 137.508);
    const lift = teams > 12 && i % 2 ? 0.08 : 0;
    team.push(ramp(5, th, 0.16, 0.38 + lift, 0.9, 6));
  }
  // (A primary button's label: whichever of the inks, or near-white or near-black, reads best on its fill.)
  const labels = [ink[2]!, surface[0]!, fromOklch(0.99, 0.01, accentHue), fromOklch(0.14, 0.02, accentHue)];
  const accentText = labels.reduce((b, c) => (contrast(c, accent[1]!) > contrast(b, accent[1]!) ? c : b));

  // Frame.
  const fr = S("frame");
  const drawn = {
    corner: fr.weighted(spec.corners), border: fr.pick(spec.border), bevel: fr.pick(spec.bevel), inner: fr.chance(spec.inner),
    fill: fr.weighted(spec.fills), screen: fr.pick(spec.screens), shadow: fr.pick(spec.shadow), radius: fr.int(2, 4), rivets: fr.pick([0, 12, 16, 24]),
  };
  const corner = P.corner ?? drawn.corner;
  const frame: FrameStyle = {
    corner,
    radius: P.radius ?? (corner === "notched" ? Math.min(drawn.radius, 3) : drawn.radius),
    border: Math.max(1, Math.min(3, P.border ?? drawn.border)),
    bevel: P.bevel ?? (corner === "bevel" || corner === "rivets" ? Math.max(1, drawn.bevel) : drawn.bevel),
    inner: drawn.inner,
    shadow: P.shadow ?? drawn.shadow,
    glow: P.glow ?? (corner === "glow" ? 2 : 0),
    fill: P.fill ?? drawn.fill,
    screen: P.screen && (SCREEN_IDS as readonly string[]).includes(P.screen) ? P.screen : drawn.screen,
    rivets: corner === "rivets" ? drawn.rivets || 16 : 0,
  };
  const outline = corner === "glow" ? accent[0]! : dark ? surface[0]! : fromOklch(0.3, chroma, hue);

  // Type, spacing, icons, motion.
  const ty = S("type");
  const font = fontParamsOf(ty, spec.font, P.font);
  const drawnBody = ty.pick(spec.body);
  const ratio = ty.between(spec.ratio[0], spec.ratio[1]);
  const drawnCaps = ty.chance(spec.caps);
  const body = Math.max(5, Math.min(12, P.body ?? drawnBody));
  const title = Math.min(16, Math.max(body + 2, Math.round(body * ratio)));
  const type: TypeScale = { small: Math.max(5, body - 2), body, title, display: Math.min(16, Math.max(title + 2, Math.round(title * ratio))), font, caps: P.caps ?? drawnCaps };
  const mo = S("motion");
  const drawnUnit = mo.pick(spec.unit);
  const drawnMotion = mo.weighted(spec.motion);
  const drawnIcon = mo.weighted(spec.icon);
  const iconStroke = mo.pick(spec.iconStroke);
  const overshoot = r3(mo.between(0.15, 0.35));
  const unit = P.unit ?? drawnUnit;
  const kind = P.motion ?? drawnMotion;

  return {
    recipe, culture: recipe.culture,
    palette: {
      tone, surface, ink, accent, good: semantic(145, 0.15), warn: semantic(82, 0.15), bad: semantic(27, 0.18), team, outline, onAccent: accentText,
      hues: { surface: r3(hue), accent: r3(accentHue) },
    },
    frame,
    type,
    space: { unit, pad: unit + frame.border + (frame.bevel ? 1 : 0), gap: unit },
    icon: { style: P.icon ?? drawnIcon, stroke: iconStroke },
    motion: { kind, press: kind === "none" ? 0 : 1, ms: kind === "snappy" ? 90 : kind === "bouncy" ? 180 : 0, overshoot: kind === "bouncy" ? overshoot : 0 },
    key: recipeKey(recipe),
  };
}

/** Motion's easing at t (0..1): snappy eases out, bouncy overshoots and settles, none jumps. */
export function ease(m: Motion, t: number): number {
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  if (m.kind === "none") return 1;
  if (m.kind === "snappy") return 1 - (1 - t) ** 3;
  const s = 1.70158 * (1 + m.overshoot * 2);
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

/** A theme's feature vector (for distinctness metrics). */
export function themeFeatures(t: Theme): number[] {
  const p = t.palette;
  return [
    p.hues.surface / 360, p.hues.accent / 360, CORNERS.indexOf(t.frame.corner) / CORNERS.length, t.frame.border / 3, FILLS.indexOf(t.frame.fill) / FILLS.length,
    SCREEN_IDS.indexOf(t.frame.screen) / SCREEN_IDS.length, t.type.font.width, t.type.font.xHeight, t.type.font.round / 3, t.type.font.stroke * 4,
    MOTIONS.indexOf(t.motion.kind) / 3, t.type.body / 12, t.type.caps ? 1 : 0, t.frame.shadow / 2,
  ];
}
