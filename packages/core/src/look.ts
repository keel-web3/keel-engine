// Looks: what a thing's ROLES wear when it's drawn -- each role a ramp (a hue,
// a chroma, a lightness and its span in OKLCH), a pattern and a finish -- drawn
// from a seed through a colour PROFILE (a harmony: analogous, complementary,
// triad, team colours, earthy, neon, pastel, metallic). The engine's model
// stays palette ramps + dither + outline: a look is only which ramps, which
// pattern moves a pixel onto which ramp, and how the finish bends the shade
// onto the ramp. Nothing here is geometry: a baked shape wears any look for
// free (bake's indexed sprites resolve role -> ramp in the sprite shader).
//
//   const look = lookOf(seed, { primary: { stuff: "knit" }, secondary: { stuff: "knit" }, trim: {} });
//   look.roles.primary -> { hue, chroma, light, span, finish, pattern: { kind, freq, angle, width, shift, ink } }
//   rampColours(look.roles.primary!, 5) -> 5 sRGB entries, dark to light
//
// Deterministic: every role draws from its own stream (named "look/role/<role>"
// off the seed), a fixed number of draws whatever it is made of, so
// pinning one role (or one field of it) never moves another. Values are
// quantised (hue 5°, chroma 0.01, lightness 0.02) so a look has a stable
// SIGNATURE, and ramps built from it are shared (a cache hit) by every look
// that lands on the same values.
//
// DISTINCT: lookDistance() is a perceptual distance (OKLab ΔE over a thing's
// leading roles, plus a step for a different pattern); createLookPool() hands
// out looks at least a threshold apart within a group (re-rolling a seed's
// look until it's clear of every look already given), so N characters in one
// scene are N different characters.

import { clamp } from "./math.ts";
import { cmax, oklch, wrap } from "./palette.ts";
import type { RGB } from "./palette.ts";
import { deriveSeed } from "./rng.ts";
import type { Stream } from "./rng.ts";

// ---------------------------------------------------------------- vocabulary

/** Every role a part can carry (a skin's, and a wearable's). A look fills in the ones a thing uses. */
export const LOOK_ROLES = ["skin", "fur", "furAlt", "hair", "cloth", "clothAlt", "accent", "dark", "blush", "eye", "primary", "secondary", "trim", "detail", "glow", "metal"] as const;
export type LookRole = (typeof LOOK_ROLES)[number];
/** Colour profiles: how a look's roles relate. */
export const PROFILES = ["analogous", "complementary", "triad", "team", "earthy", "neon", "pastel", "metallic"] as const;
export type LookProfile = (typeof PROFILES)[number];
/** Patterns a role may wear (on the part's own surface coordinates). */
export const PATTERNS = ["none", "stripes", "bands", "spots", "checks", "camo", "gradient", "trim"] as const;
export type Pattern = (typeof PATTERNS)[number];
/** Finishes: how the shade lands on the ramp, and how the ramp is built. */
export const FINISHES = ["matte", "cloth", "leather", "metal", "glow"] as const;
export type Finish = (typeof FINISHES)[number];

/** A role as a thing declares it (runtime's RoleSpec). */
export interface RoleSpecLike {
  readonly stuff?: string | undefined;
  readonly patterns?: readonly string[] | undefined;
  readonly finishes?: readonly string[] | undefined;
  readonly like?: string | undefined;
}
/** A thing's roles, in order of how much of it they cover (the first leads the harmony). */
export type LookRoles = Readonly<Record<string, RoleSpecLike>>;

export interface PatternLook {
  readonly kind: Pattern;
  /** Repeats across the part (1..8). */
  readonly freq: number;
  /** Stripe angle in eighths of a half turn (0..7). */
  readonly angle: number;
  /** How much of a repeat the marks take, in eighths (1..7). */
  readonly width: number;
  /** Entries the marks move along the role's own ramp (-3..3; 0 when they wear `ink`). */
  readonly shift: number;
  /** The role whose ramp the marks wear (null: their own, shifted). */
  readonly ink: LookRole | null;
}

/** One role's look: its ramp (hue, chroma, mid lightness, lightness span), finish and pattern. Quantised. */
export interface RoleLook {
  readonly hue: number;
  readonly chroma: number;
  readonly light: number;
  readonly span: number;
  readonly finish: Finish;
  readonly pattern: PatternLook;
}

export interface Look {
  readonly profile: LookProfile;
  /** The harmony's base hue (degrees). */
  readonly hue: number;
  readonly roles: Readonly<Partial<Record<LookRole, RoleLook>>>;
  /** The roles in the thing's order (the first leads). */
  readonly order: readonly LookRole[];
  /** Everything above, as a compact stable string: equal signatures, equal looks. */
  readonly signature: string;
}

export interface LookOptions {
  /** Draw in this profile (else the seed picks, by PROFILE_WEIGHTS). */
  readonly profile?: LookProfile | undefined;
  /** A team's hue: the base hue (and the profile "team" unless one is given). */
  readonly team?: number | undefined;
  /**
   * Pins: "profile", "hue" (the base hue), and per role "<role>.hue" | ".chroma" | ".light" | ".span" |
   * ".finish" | ".pattern" | ".ink". A pin replaces what was drawn; nothing else moves.
   */
  readonly pins?: Readonly<Record<string, unknown>> | undefined;
}

export const PROFILE_WEIGHTS: ReadonlyArray<readonly [LookProfile, number]> = [
  ["analogous", 4], ["complementary", 4], ["triad", 3], ["team", 2], ["earthy", 3], ["neon", 1.5], ["pastel", 2], ["metallic", 1],
];

const isRole = (r: string): r is LookRole => (LOOK_ROLES as readonly string[]).includes(r);
const isPattern = (p: string): p is Pattern => (PATTERNS as readonly string[]).includes(p);
const isFinish = (f: string): f is Finish => (FINISHES as readonly string[]).includes(f);

// What each stuff defaults to: its finishes and its patterns (repeats weight the pick).
const STUFF: Readonly<Record<string, { finishes: readonly Finish[]; patterns: readonly Pattern[] }>> = {
  cloth: { finishes: ["cloth", "cloth", "matte"], patterns: ["none", "none", "none", "stripes", "bands", "checks", "camo", "gradient", "trim"] },
  knit: { finishes: ["cloth"], patterns: ["none", "bands", "bands", "stripes", "checks"] },
  paint: { finishes: ["matte", "metal"], patterns: ["none", "none", "stripes", "bands", "checks", "spots", "gradient", "trim"] },
  leather: { finishes: ["leather"], patterns: ["none", "none", "none", "trim"] },
  metal: { finishes: ["metal"], patterns: ["none", "none", "none", "bands", "trim"] },
  wood: { finishes: ["matte"], patterns: ["none", "bands"] },
  bone: { finishes: ["matte"], patterns: ["none", "none", "bands"] },
  skin: { finishes: ["matte"], patterns: ["none"] },
  fur: { finishes: ["matte"], patterns: ["none", "none", "none", "spots", "stripes", "gradient"] },
  hair: { finishes: ["matte"], patterns: ["none", "none", "gradient"] },
  dark: { finishes: ["matte"], patterns: ["none"] },
  eye: { finishes: ["matte"], patterns: ["none"] },
  blush: { finishes: ["matte"], patterns: ["none"] },
  glow: { finishes: ["glow"], patterns: ["none", "none", "gradient"] },
};
// A role's stuff when it doesn't say.
const ROLE_STUFF: Readonly<Record<LookRole, string>> = {
  skin: "skin", fur: "fur", furAlt: "fur", hair: "hair", cloth: "cloth", clothAlt: "cloth", accent: "paint", dark: "dark", blush: "blush", eye: "eye",
  primary: "cloth", secondary: "cloth", trim: "paint", detail: "dark", glow: "glow", metal: "metal",
};

// Natural tones [L, C, hue]: skins, furs, hair, metals.
const SKIN: ReadonlyArray<readonly [number, number, number]> = [[0.9, 0.035, 70], [0.84, 0.05, 62], [0.76, 0.07, 58], [0.68, 0.08, 52], [0.58, 0.085, 48], [0.48, 0.07, 45], [0.4, 0.06, 42], [0.33, 0.045, 40]];
const FUR: ReadonlyArray<readonly [number, number, number]> = [[0.94, 0.012, 85], [0.86, 0.04, 80], [0.74, 0.1, 62], [0.66, 0.14, 50], [0.56, 0.12, 45], [0.5, 0.07, 55], [0.4, 0.05, 50], [0.62, 0.02, 250], [0.45, 0.015, 260], [0.3, 0.02, 280], [0.22, 0.012, 270], [0.78, 0.06, 75]];
const HAIR: ReadonlyArray<readonly [number, number, number]> = [[0.22, 0.02, 50], [0.32, 0.05, 50], [0.42, 0.08, 55], [0.55, 0.13, 45], [0.72, 0.1, 85], [0.85, 0.05, 90], [0.18, 0.01, 280], [0.8, 0.01, 250], [0.45, 0.14, 35]];
const METALS: ReadonlyArray<readonly [number, number, number]> = [[0.78, 0.12, 88], [0.8, 0.02, 250], [0.62, 0.09, 58], [0.64, 0.12, 42], [0.66, 0.03, 235], [0.5, 0.015, 260], [0.72, 0.06, 150]];

// Harmony offsets: the hue each place in the role order leans to, per profile.
const HARMONY: Readonly<Record<LookProfile, readonly (readonly number[])[]>> = {
  analogous: [[0], [-30, 30], [-55, 55, -20, 20], [15, -15, 40]],
  complementary: [[0], [180, 165, 195], [20, -20, 180], [180, 0]],
  triad: [[0], [120, -120], [-120, 120], [60, 180]],
  team: [[0], [0], [0, 180], [180]],
  earthy: [[0], [15, -15, 30], [-30, 40], [10]],
  neon: [[0], [0], [150, 180, 210, -60], [90, -90]],
  pastel: [[0], [40, -40, 180], [120, -120, 60], [180, 90]],
  metallic: [[0], [180, 0], [0, 30], [180]],
};
const offsetAt = (profile: LookProfile, i: number): readonly number[] => HARMONY[profile][Math.min(i, 3)]!;

const q = (v: number, step: number): number => Math.round(v / step) * step;
const qh = (h: number): number => Math.round(wrap(h) / 5) * 5 % 360;
const q2 = (v: number): number => Math.round(v * 100) / 100;

function stuffOf(role: LookRole, spec: RoleSpecLike): string {
  const s = spec.stuff ?? ROLE_STUFF[role];
  return STUFF[s] ? s : "cloth";
}

/**
 * A named stream off a seed, for looks: FNV-1a over "seed:label" seeds a small 32-bit generator (mulberry32).
 * (Core's slot streams hash the whole seed per draw -- right for a token's traits, a hundred times the cost a
 * look needs: a look draws a hundred numbers, and a population wants tens of thousands of looks.) Exact integer
 * maths, the same on every machine.
 */
function streamOf(seed: string, label: string): Stream {
  const text = `${seed}:${label}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  let a = h;
  const f = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const totalOf = (e: ReadonlyArray<readonly [unknown, number]>): number => e.reduce((n, [, w]) => n + w, 0);
  return {
    f,
    between: (x, y) => x + (y - x) * f(),
    int: (x, y) => x + Math.floor(f() * (y - x + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(f() * list.length)] as T,
    chance: (p) => f() < p,
    weighted: <T>(entries: ReadonlyArray<readonly [T, number]>): T => {
      let ticket = f() * totalOf(entries);
      for (const [v, w] of entries) { if (ticket < w) return v; ticket -= w; }
      return entries[entries.length - 1]![0];
    },
  };
}

// A role's colour before quantising: [L, C, hue], from its stuff, the profile, its place in the order.
function colourOf(stuff: string, profile: LookProfile, base: number, place: number, u: ArrayLike<number>, team: boolean): [number, number, number] {
  const pick = <T>(list: readonly T[], x: number): T => list[Math.min(list.length - 1, Math.floor(x * list.length))]!;
  const off = pick(offsetAt(profile, place), u[1]!);
  const h = base + off + (u[2]! - 0.5) * 16;
  // The profile's colour at this place.
  const profiled = (): [number, number, number] => {
    switch (profile) {
      case "earthy": return [0.3 + u[3]! * 0.38, 0.03 + u[4]! * 0.06, pick([35, 50, 65, 80, 120, 140, 25], u[5]!) + (u[2]! - 0.5) * 20];
      case "pastel": return [0.78 + u[3]! * 0.12, 0.04 + u[4]! * 0.06, h];
      case "neon": return place === 1 ? [0.18 + u[3]! * 0.1, 0.01 + u[4]! * 0.02, h] : [0.68 + u[3]! * 0.14, 0.2 + u[4]! * 0.08, h];
      case "metallic": return [0.45 + u[3]! * 0.35, 0.01 + u[4]! * 0.05, h];
      case "team":
        if (place === 0) return [0.46 + u[3]! * 0.16, 0.14 + u[4]! * 0.07, base];
        if (place === 1) return u[6]! < 0.5 ? [0.2 + u[3]! * 0.1, 0.01 + u[4]! * 0.02, base] : [0.8 + u[3]! * 0.08, 0.01 + u[4]! * 0.02, base];
        return [0.7 + u[3]! * 0.12, 0.08 + u[4]! * 0.06, h];
      default: return [0.34 + u[3]! * 0.38, 0.08 + u[4]! * 0.09, h];
    }
  };
  switch (stuff) {
    case "skin": {
      // (A fantasy skin now and then -- green, blue, lilac -- under the loud profiles.)
      if ((profile === "neon" || profile === "pastel" || profile === "triad") && u[6]! < 0.12) return [0.55 + u[3]! * 0.25, 0.06 + u[4]! * 0.05, h];
      const t = pick(SKIN, u[5]!);
      return [t[0] + (u[3]! - 0.5) * 0.06, t[1], t[2] + (u[2]! - 0.5) * 10];
    }
    case "fur": {
      if (u[6]! < (team ? 0.15 : 0.35)) { const p = profiled(); return [clamp(p[0], 0.3, 0.9), Math.min(p[1], 0.14), p[2]]; }
      const t = pick(FUR, u[5]!);
      return [clamp(t[0] + (u[3]! - 0.5) * 0.1, 0.15, 0.96), t[1] * (0.7 + u[4]! * 0.6), t[2] + (u[2]! - 0.5) * 16];
    }
    case "hair": {
      if (u[6]! < 0.45) { const p = profiled(); return [clamp(p[0], 0.3, 0.85), clamp(p[1], 0.06, 0.2), p[2]]; }
      const t = pick(HAIR, u[5]!);
      return [t[0] + (u[3]! - 0.5) * 0.06, t[1], t[2] + (u[2]! - 0.5) * 10];
    }
    case "dark": return [0.16 + u[3]! * 0.12, 0.01 + u[4]! * 0.03, base + (u[2]! - 0.5) * 40];
    case "eye": return [0.13 + u[3]! * 0.06, 0.01 + u[4]! * 0.02, base];
    case "blush": return [0.68 + u[3]! * 0.1, 0.08 + u[4]! * 0.05, 5 + u[2]! * 20];
    case "glow": return [0.7 + u[3]! * 0.12, 0.16 + u[4]! * 0.08, h];
    case "metal": {
      if (profile === "metallic" || u[6]! < 0.8) { const t = pick(METALS, u[5]!); return [t[0] + (u[3]! - 0.5) * 0.08, t[1], t[2]]; }
      return [0.55 + u[3]! * 0.2, 0.05 + u[4]! * 0.05, h];
    }
    case "wood": return [0.34 + u[3]! * 0.22, 0.05 + u[4]! * 0.05, 45 + u[5]! * 25];
    case "bone": return [0.8 + u[3]! * 0.1, 0.02 + u[4]! * 0.03, 80 + u[5]! * 15];
    case "leather": {
      if (u[6]! < 0.3) { const p = profiled(); return [clamp(p[0], 0.25, 0.6), clamp(p[1], 0.05, 0.14), p[2]]; }
      return [0.28 + u[3]! * 0.28, 0.06 + u[4]! * 0.06, 35 + u[5]! * 30];
    }
    default: return profiled();
  }
}

// (One role's sixteen draws, reused: lookOf runs tens of thousands of times for a population.)
const DRAWS = new Float64Array(16);

const SPAN: Readonly<Record<Finish, number>> = { matte: 0.5, cloth: 0.44, leather: 0.48, metal: 0.62, glow: 0.4 };

/**
 * A look for a thing's roles, from a seed. `roles`' order is the thing's (the first leads the harmony); every role
 * must be one of LOOK_ROLES. Deterministic; each role on its own stream, so pins never move anything else.
 */
export function lookOf(seed: string, roles: LookRoles, options: LookOptions = {}): Look {
  const pins = options.pins ?? {};
  const names = Object.keys(roles);
  for (const r of names) if (!isRole(r)) throw new RangeError(`"${r}" isn't a look role (${LOOK_ROLES.join(", ")}).`);
  const order = names as LookRole[];
  // The profile and the base hue: their own streams (both always draw).
  const PS = streamOf(seed, "look/profile");
  const drawnProfile = PS.weighted(PROFILE_WEIGHTS);
  const HS = streamOf(seed, "look/hue");
  const drawnHue = HS.between(0, 360);
  const pinnedProfile = pins["profile"];
  if (pinnedProfile !== undefined && !(PROFILES as readonly unknown[]).includes(pinnedProfile)) throw new RangeError(`profile ${JSON.stringify(pinnedProfile)} isn't one of ${PROFILES.join(", ")}.`);
  const profile: LookProfile = (pinnedProfile as LookProfile | undefined) ?? options.profile ?? (options.team !== undefined ? "team" : drawnProfile);
  const hue = typeof pins["hue"] === "number" ? (pins["hue"] as number) : options.team ?? drawnHue;
  const team = profile === "team";

  const out: Partial<Record<LookRole, RoleLook>> = {};
  const u = DRAWS;
  const pinned = Object.keys(pins).length > 0;
  order.forEach((role, place) => {
    const spec = roles[role]!;
    const S = streamOf(seed, `look/role/${role}`);
    for (let k = 0; k < 16; k += 1) u[k] = S.f(); // (a fixed count: what it's made of never changes how much it draws)
    const stuff = stuffOf(role, spec);
    const finishes = (spec.finishes ?? STUFF[stuff]!.finishes).filter(isFinish);
    const patterns = (spec.patterns ?? STUFF[stuff]!.patterns).filter(isPattern);
    let [L, C, H] = colourOf(stuff, profile, hue, place, u, team);
    const like = spec.like !== undefined && isRole(spec.like) ? out[spec.like] : undefined;
    if (like) { H = like.hue + (u[2]! - 0.5) * 10; C = like.chroma * 0.9; L = like.light > 0.5 ? like.light - 0.14 : like.light + 0.14; }
    let finish: Finish = finishes.length ? finishes[Math.floor(u[7]! * finishes.length)]! : "matte";
    if (profile === "metallic" && place === 0 && finishes.includes("metal")) finish = "metal";
    if (profile === "neon" && stuff === "paint" && finishes.includes("glow") && u[8]! < 0.5) finish = "glow";
    const kind: Pattern = patterns.length ? patterns[Math.floor(u[9]! * patterns.length)]! : "none";
    // Pattern marks wear another role's ramp (the next one along, most often) or step along their own.
    const others = order.filter((r) => r !== role && r !== "eye" && r !== "blush");
    // (A gradient isn't marks: it leans the whole part along its ramp, so it never wears another's.)
    const inkRole = kind !== "gradient" && others.length && u[10]! < 0.6 ? others[(order.indexOf(role) + 1 + Math.floor(u[11]! * 2)) % others.length] ?? null : null;
    let pattern: PatternLook = {
      kind,
      freq: 1 + Math.floor(u[12]! * 6),
      angle: Math.floor(u[13]! * 8),
      width: 2 + Math.floor(u[14]! * 4),
      shift: kind === "none" || inkRole ? 0 : [-2, -1, 1, 2][Math.floor(u[15]! * 4)]!,
      ink: kind === "none" ? null : inkRole,
    };
    let span = SPAN[finish] + (u[8]! - 0.5) * 0.08;
    // Pins, field by field.
    const pin = (f: string): unknown => (pinned ? pins[`${role}.${f}`] : undefined);
    if (typeof pin("hue") === "number") H = pin("hue") as number;
    if (typeof pin("chroma") === "number") C = pin("chroma") as number;
    if (typeof pin("light") === "number") L = pin("light") as number;
    if (typeof pin("span") === "number") span = pin("span") as number;
    if (pin("finish") !== undefined) { if (!isFinish(String(pin("finish")))) throw new RangeError(`${role}.finish ${JSON.stringify(pin("finish"))} isn't one of ${FINISHES.join(", ")}.`); finish = pin("finish") as Finish; }
    if (pin("pattern") !== undefined) {
      const p = String(pin("pattern"));
      if (!isPattern(p)) throw new RangeError(`${role}.pattern ${JSON.stringify(p)} isn't one of ${PATTERNS.join(", ")}.`);
      const ink = p === "none" || p === "gradient" ? null : pattern.ink;
      pattern = { ...pattern, kind: p, ink, shift: p === "none" || ink ? 0 : pattern.shift || [-2, -1, 1, 2][Math.floor(u[15]! * 4)]! };
    }
    if (pin("ink") !== undefined) { const i = pin("ink"); pattern = { ...pattern, ink: i === null ? null : isRole(String(i)) ? (String(i) as LookRole) : pattern.ink, shift: i === null ? pattern.shift || 1 : 0 }; }
    out[role] = { hue: qh(H), chroma: q2(clamp(q(C, 0.01), 0, 0.32)), light: q2(clamp(q(L, 0.02), 0.08, 0.96)), span: q2(clamp(q(span, 0.02), 0.2, 0.8)), finish, pattern };
  });
  const look = { profile, hue: qh(hue), roles: out, order };
  return { ...look, signature: signatureOf(look) };
}

const FIN_CODE: Readonly<Record<Finish, string>> = { matte: "m", cloth: "c", leather: "l", metal: "M", glow: "g" };
function signatureOf(look: Pick<Look, "profile" | "hue" | "roles" | "order">): string {
  return look.order.map((r) => {
    const x = look.roles[r]!;
    const p = x.pattern;
    return `${r}:${x.hue}/${Math.round(x.chroma * 100)}/${Math.round(x.light * 100)}/${Math.round(x.span * 100)}${FIN_CODE[x.finish]}${p.kind === "none" ? "" : `~${p.kind}${p.freq}.${p.angle}.${p.width}.${p.shift}${p.ink ? `.${p.ink}` : ""}`}`;
  }).join(",");
}

/** A look's signature (what lookOf puts in `signature`). */
export const lookSignature = (look: Look): string => signatureOf(look);

// ---------------------------------------------------------------- distance

/** A role's middle colour in OKLab (in gamut: the chroma sRGB can hold there). */
export function roleLab(r: Pick<RoleLook, "hue" | "chroma" | "light">): [number, number, number] {
  const C = Math.min(r.chroma, 0.97 * cmax(r.light, r.hue));
  const h = (r.hue * Math.PI) / 180;
  return [r.light, C * Math.cos(h), C * Math.sin(h)];
}

// (The leading roles weigh most: a coat is what you see first, its trim last.)
const WEIGHTS = [1, 0.8, 0.5];
const W_NORM = Math.sqrt(WEIGHTS.reduce((a, b) => a + b, 0));
/** How a different pattern on the leading role counts: about one clear colour step. */
export const PATTERN_STEP = 0.06;

/**
 * Perceptual distance between two looks: ΔE (OKLab) over `a`'s leading roles (up to three, weighted 1, 0.8, 0.5,
 * normalised), plus PATTERN_STEP when the leading role's pattern differs. 0.02 is barely there side by side; 0.08 is
 * plainly another colour.
 */
const VECTORS = new WeakMap<Look, Float64Array>();
// (A look's leading colours as one vector, kept: a pool asks for the same look's distance thousands of times.)
function vectorOf(look: Look): Float64Array {
  let v = VECTORS.get(look);
  if (v) return v;
  v = new Float64Array(10);
  look.order.slice(0, 3).forEach((r, i) => { const w = Math.sqrt(WEIGHTS[i]!); const [L, A, B] = roleLab(look.roles[r]!); v![i * 3] = L * w; v![i * 3 + 1] = A * w; v![i * 3 + 2] = B * w; });
  v[9] = look.order[0] ? PATTERNS.indexOf(look.roles[look.order[0]]!.pattern.kind) : 0;
  VECTORS.set(look, v);
  return v;
}
const sameLead = (a: Look, b: Look): boolean => a.order.length >= 3 && b.order.length >= 3 && a.order[0] === b.order[0] && a.order[1] === b.order[1] && a.order[2] === b.order[2];

export function lookDistance(a: Look, b: Look): number {
  if (sameLead(a, b)) {
    const x = vectorOf(a), y = vectorOf(b);
    let sum = 0;
    for (let i = 0; i < 9; i += 1) { const d = x[i]! - y[i]!; sum += d * d; }
    return Math.sqrt(sum) / W_NORM + (x[9] !== y[9] ? PATTERN_STEP : 0);
  }
  const roles = a.order.filter((r) => b.roles[r]).slice(0, 3);
  let sum = 0;
  roles.forEach((r, i) => {
    const x = roleLab(a.roles[r]!), y = roleLab(b.roles[r]!);
    sum += WEIGHTS[i]! * ((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
  });
  const lead = roles[0];
  const pat = lead && a.roles[lead]!.pattern.kind !== b.roles[lead]!.pattern.kind ? PATTERN_STEP : 0;
  return Math.sqrt(sum) / W_NORM + pat;
}

export interface LookPool {
  /** The looks given out so far, by group. */
  readonly size: number;
  /** Is this look at least the threshold from every look in its group? */
  clear(look: Look, group?: string): boolean;
  /** Take a look into its group (without checking). */
  add(look: Look, group?: string): void;
  /**
   * A look for this seed that's clear of its group: the seed's own look if it is, else re-rolled
   * (deriveSeed(seed, "reroll/n")) until one is -- `tries` at most, then the farthest found. Pins hold through re-rolls.
   */
  draw(seed: string, roles: LookRoles, options?: LookOptions, group?: string): Look;
  /** How many draws re-rolled, and how many gave up (took the farthest). */
  readonly rerolls: number;
  readonly failures: number;
  /**
   * Which candidate the last draw took: 0 the seed's own look, n the n-th re-roll (deriveSeed(seed, "reroll/n")).
   * With it a look is drawn again ALONE, no pool: candidateLook(seed, n, ...) -- what a stored population keeps.
   */
  readonly lastTry: number;
}

/** A pool's n-th candidate for a seed (0: the seed's own look), as draw() makes it. */
export const candidateLook = (seed: string, n: number, roles: LookRoles, options: LookOptions = {}): Look =>
  lookOf(n === 0 ? seed : deriveSeed(seed, `reroll/${n}`), roles, options);

/**
 * Looks kept at least `threshold` apart within each group (a group: things that could be taken for each other --
 * the same species, the same hat). Neighbours are found through a hash on the leading role's OKLab colour, so
 * a pool of tens of thousands stays fast.
 */
export function createLookPool({ threshold = 0.08, tries = 32 }: { threshold?: number; tries?: number } = {}): LookPool {
  // (Any look within `threshold` has its leading colour within threshold x W_NORM / sqrt(w0) of this one's.)
  const cell = threshold * W_NORM;
  const groups = new Map<string, Map<number, Look[]>>();
  let size = 0, rerolls = 0, failures = 0, lastTry = 0;
  // (A cell as one number: OKLab L 0..1, a and b within +-0.4 -- 2^10 cells each way is room to spare.)
  const cellOf = (look: Look): number => {
    const v = vectorOf(look);
    const w = Math.sqrt(WEIGHTS[0]!);
    return ((Math.floor(v[0]! / w / cell) + 512) * 1024 + (Math.floor(v[1]! / w / cell) + 512)) * 1024 + (Math.floor(v[2]! / w / cell) + 512);
  };
  const nearest = (look: Look, group: string, stop: number): number => {
    const g = groups.get(group);
    if (!g) return Infinity;
    const c = cellOf(look);
    let best = Infinity;
    for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) for (let k = -1; k <= 1; k += 1) {
      const list = g.get(c + (i * 1024 + j) * 1024 + k);
      if (!list) continue;
      for (const o of list) { const d = lookDistance(look, o); if (d < best) { best = d; if (best < stop) return best; } }
    }
    return best;
  };
  const add = (look: Look, group = ""): void => {
    const g = groups.get(group) ?? groups.set(group, new Map()).get(group)!;
    const key = cellOf(look);
    (g.get(key) ?? g.set(key, []).get(key)!).push(look);
    size += 1;
  };
  return {
    get size() { return size; },
    get rerolls() { return rerolls; },
    get failures() { return failures; },
    get lastTry() { return lastTry; },
    clear: (look, group = "") => nearest(look, group, 0) >= threshold,
    add,
    draw(seed, roles, options = {}, group = "") {
      let best: Look | null = null;
      let bestD = -1, bestN = 0;
      for (let n = 0; n < tries; n += 1) {
        const look = candidateLook(seed, n, roles, options);
        // (Stop at the first look too close: it's re-rolled whatever the rest are -- unless it's the last try.)
        const d = nearest(look, group, n === tries - 1 ? 0 : threshold);
        if (d >= threshold) { if (n > 0) rerolls += 1; lastTry = n; add(look, group); return look; }
        if (d > bestD) { bestD = d; best = look; bestN = n; }
      }
      failures += 1;
      rerolls += 1;
      lastTry = bestN;
      add(best!, group);
      return best!;
    },
  };
}

// ---------------------------------------------------------------- ramps

/**
 * A role's ramp: `len` sRGB entries, dark to light, built in OKLCH from its hue, chroma, lightness and span, bent
 * by its finish -- the pixel artist's hue shift (shadows cool, lights warm), a metal's deep darks and near-white
 * glint, a glow's lifted foot. The renderer's lit shades land mostly in the ramp's lower three quarters (a lit face
 * stays under the top, as in the pixel pass), so the middle colour sits a little past halfway.
 */
export function rampColours(r: RoleLook, len: number): RGB[] {
  const n = Math.max(1, Math.round(len));
  const { hue: H, chroma: C, light: L, span, finish } = r;
  let L0 = L - span * 0.55, L1 = L + span * 0.45;
  if (finish === "metal") { L0 = L - span * 0.7; L1 = Math.max(L1, 0.93); }
  if (finish === "glow") { L0 = L - span * 0.35; L1 = 0.97; }
  L0 = clamp(L0, 0.06, 0.9);
  L1 = clamp(L1, L0 + 0.08, 0.98);
  // (Hue shift: toward violet in the shadows, toward gold in the lights -- the way that doesn't cross the far side.)
  const turn = finish === "metal" ? 18 : finish === "leather" ? 12 : 9;
  const toward = (h: number, anchor: number): number => { const d = ((((anchor - h) % 360) + 540) % 360) - 180; return Math.sign(d) * Math.min(Math.abs(d), turn); };
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.55 : i / (n - 1);
    const Lt = L0 + (L1 - L0) * t;
    let Ct = C * Math.sin(Math.PI * (0.12 + 0.76 * t));
    if (finish === "metal") Ct = C * (1 - t * t * 0.8) + 0.004;
    if (finish === "glow") Ct = C * (t < 0.85 ? 1 : 1 - (t - 0.85) * 4);
    if (finish === "cloth") Ct *= 0.92;
    const Ht = H + (t < 0.5 ? toward(H, 285) * (0.5 - t) * 2 : toward(H, 85) * (t - 0.5) * 2);
    return oklch(Lt, Math.max(0, Ct), Ht);
  });
}

/** A ramp's cache key: looks that land on the same values share one ramp. */
export const rampKey = (r: RoleLook, len: number): string => `${r.hue}/${Math.round(r.chroma * 100)}/${Math.round(r.light * 100)}/${Math.round(r.span * 100)}/${r.finish}/${len}`;

/** The finish's index (the sprite shader's code for how a shade lands on the ramp). */
export const finishIndex = (f: Finish): number => FINISHES.indexOf(f);
/** The pattern's index (the sprite shader's code). */
export const patternIndex = (p: Pattern): number => PATTERNS.indexOf(p);
/** A role's index in LOOK_ROLES. */
export const roleIndex = (r: LookRole): number => LOOK_ROLES.indexOf(r);
