// The ground's SURFACE: how tile materials meet, pixel-art style -- the
// tileset tricks an artist does by hand, done analytically by the ground
// baker, palette-true, per texel, anchored to the world (so chunks meet
// without a seam and nothing crawls when the camera pans).
//
//   CORNER BLENDING   every top texel looks at the four tiles round its
//                     corner (the Wang corner idea) and weighs each tile's
//                     material bilinearly: up to four materials meet at a
//                     corner, every combination has a transition, and no
//                     rule table has to list them.
//   PRECEDENCE        a material's priority (types.ts) biases its score: the
//                     higher one's shapes lie over the lower (grass over dirt
//                     over sand); a crisp material (cobbled road) keeps a
//                     straight kerb and wears its neighbours ("path wear").
//   NOISE-JITTERED    each material has its own edge character (tufty grass,
//                     smooth sand, blocky stone, soft snow), so borders are
//                     never the grid's straight lines.
//   DITHERED          the last pixel or two of a border is an ordered-Bayer
//                     mix of both materials: the hand-dithered transition of
//                     16-bit ground tiles.
//   BIOMES            a tile's biome picks its ramps (the same grass, a
//                     biome's tint), blended across biome borders the same
//                     way with a wider ragged, dithered band.
//   MACRO VARIATION   low-frequency brightness and a second ("lush") ramp
//                     over big areas: no field is one flat colour.
//   VARIANTS          per tile a variant (weighted, never the same as the
//                     tile west or south of it) offsets its texture: no grid.
//   DECALS            grass tufts, flowers in grass, pebbles, cracks, fallen
//                     leaves, bones: pixel-sized marks on a grid of global
//                     pixels (seamless).
//   AO                contact shade at the foot of any higher neighbour, and
//                     a little height shading (higher ground reads lighter).
//
// Everything is a palette index (surfacePalette lays out a ramp per type per
// biome, and a lush variant); a season is the same layout in other colours
// (seasonPalette), so a season swap is a palette upload and bakes nothing.

import { fbm2, hash2, vnoise2 } from "@keel-engine/core";
import type { RGB } from "@keel-engine/core";
import { FLAG } from "./types.ts";
import type { TerrainTable, TextureKind } from "./types.ts";
import type { Terrain } from "./grid.ts";
import { GROUND_MATERIALS, groundPalette, groundRamp, hashText } from "./palette.ts";
import type { GroundPalette, GroundPaletteOptions, RampColour } from "./palette.ts";

// ---------------------------------------------------------------- the data

export type DecalKind = "tufts" | "flowers" | "pebbles" | "cracks" | "leaves" | "bones";
export const DECAL_KINDS: readonly DecalKind[] = ["tufts", "flowers", "pebbles", "cracks", "leaves", "bones"];

/** A biome as the ground sees it: its tint, its own colours for some types, its decals, its flowers. */
export interface SurfaceBiome {
  readonly name: string;
  /** Over every land ramp: hue turned (degrees), chroma and lightness scaled. */
  readonly tint?: { readonly hue?: number; readonly chroma?: number; readonly light?: number };
  /** A type's colour in this biome (replaces the type's own before the tint: dry grass on a savanna). */
  readonly colours?: Readonly<Record<string, Partial<RampColour>>>;
  /** Decal densities by kind (a scale on each type's own: 0 none, 1 as the type says). */
  readonly decals?: Readonly<Partial<Record<DecalKind, number>>>;
  /** The flowers' hues (degrees; three are laid out). */
  readonly petals?: readonly number[];
}

/** A season: a shift on vegetation's ramps (grass, moss, litter, leaf) -- colours only, the same layout. */
export interface SurfaceSeason {
  readonly name: string;
  readonly hue?: number;
  readonly chroma?: number;
  readonly light?: number;
  /** 0..1: vegetation pulled toward frost (winter). */
  readonly frost?: number;
  /** Flowers' chroma scale (none in winter). */
  readonly bloom?: number;
}

export const SEASONS: Readonly<Record<string, SurfaceSeason>> = {
  spring: { name: "spring", hue: 6, chroma: 1.12, light: 1.04, bloom: 1.2 },
  summer: { name: "summer" },
  autumn: { name: "autumn", hue: -50, chroma: 0.95, light: 0.98, bloom: 0.5 },
  winter: { name: "winter", hue: 40, chroma: 0.35, light: 1.1, frost: 0.62, bloom: 0 },
};

/** Blending knobs (all optional). */
export interface SurfaceBlend {
  /** How ragged a material border is (score units: a tile is 1; default 0.34). */
  readonly jitter?: number;
  /** How far a higher-priority material reaches over a lower one (tiles, default 0.09). */
  readonly precedence?: number;
  /** The dithered band at a material border (pixels, default 1; 0 hard). */
  readonly dither?: number;
  /** Domain warp of the tile lattice (tiles, default 0.42): borders wander off the grid's lines. */
  readonly warp?: number;
  /** The rim where a higher material meets a lower one: its lit lip and the shadow it drops (default 0.16; 0 off). */
  readonly rim?: number;
  /** Biome borders: jitter (default 0.8) and their dithered band (pixels, default 4). */
  readonly biomeJitter?: number;
  readonly biomeDither?: number;
}

export interface GroundSurface {
  /** Part of every bake key: changes when anything here but the per-tile biome does (that is hashed per chunk). */
  readonly key: string;
  readonly biomes: readonly SurfaceBiome[];
  /** Per terrain tile (terrain.index), its biome's index; null: all biome 0. */
  readonly biome: Uint8Array | null;
  /** Per terrain tile, how lit it is (0 dark .. 255 full): a dungeon's torch pools, baked in, smooth across tiles. */
  readonly light?: Uint8Array | null;
  readonly blend?: SurfaceBlend;
  /** Macro variation: feature size (metres, default 55) and brightness amount (default 0.2); lush: share of ground on the lush ramp (default 0.3). */
  readonly macro?: { readonly size?: number; readonly amount?: number; readonly lush?: number };
  /** Contact shade at the foot of a higher neighbour (default 0.3; 0 off) and its reach (tiles, default 0.3). */
  readonly ao?: number;
  readonly aoReach?: number;
  /** Lightness per height step (default 0.022). */
  readonly heightShade?: number;
  /** Decals on (default true). */
  readonly decals?: boolean;
  /** Tile variants (default 4) and the texture offset a variant makes. */
  readonly variants?: number;
}

/** A surface's key (what bake keys carry). */
export function surfaceKey(s: Omit<GroundSurface, "key" | "biome">): string {
  return `sf${hashText(JSON.stringify([s.biomes, s.blend ?? {}, s.macro ?? {}, s.ao ?? null, s.aoReach ?? null, s.heightShade ?? null, s.decals ?? true, s.variants ?? 4]))}`;
}

/** A surface over a biome list (key filled in). */
export function groundSurface(spec: Omit<GroundSurface, "key">): GroundSurface {
  return { ...spec, key: surfaceKey(spec) };
}

/** A 32-bit hash of the biome map over a rectangle (clamped): what a chunk's key adds for the surface. */
export function hashBiome(t: Terrain, biome: Uint8Array | null, i0: number, j0: number, i1: number, j1: number, light: Uint8Array | null = null): number {
  if (!biome && !light) return 0;
  let h = 0x811c9dc5;
  for (let j = Math.max(0, j0); j < Math.min(t.depth, j1); j += 1) for (let i = Math.max(0, i0); i < Math.min(t.width, i1); i += 1) {
    const k = j * t.width + i;
    h = Math.imul(h ^ (biome ? biome[k]! : 0), 0x01000193);
    if (light) h = Math.imul(h ^ light[k]!, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- the palette

/** Types whose ramps a season recolours. */
const VEGETATION = new Set<TextureKind>(["grass", "moss", "litter"]);

export interface SurfacePaletteOptions extends GroundPaletteOptions {
  /** The season (default summer). Seasons never change the layout: swap palettes, keep bakes. */
  readonly season?: SurfaceSeason;
}

/**
 * The ground palette for a surface: everything groundPalette lays out, then
 * per biome a ramp per terrain type (`<type>@<biome>`) and its lush variant
 * (`<type>@<biome>+`), three petal ramps (`petal@<biome>.<n>`), and the
 * decals' ramps (`leaf.fall`, `bone`). The layout depends only on the types
 * and the biome count, never on colours or the season -- seasonPalette gives
 * another season's colours for the same indices.
 */
export function surfacePalette(types: TerrainTable, biomes: readonly SurfaceBiome[], opts: SurfacePaletteOptions = {}): GroundPalette {
  const base = groundPalette(types, { ...opts, materials: { ...GROUND_MATERIALS, ...(opts.materials ?? {}) } });
  const n = opts.rampLength ?? 8;
  const season = opts.season ?? SEASONS["summer"]!;
  const colours: RGB[] = base.colours.slice();
  const ramps: Record<string, readonly [number, number]> = { ...base.ramps };
  const add = (name: string, list: RGB[]): void => { ramps[name] = [colours.length, list.length]; colours.push(...list); };
  const fr = season.frost ?? 0;
  biomes.forEach((b, bi) => {
    const tint = { hue: b.tint?.hue ?? 0, chroma: b.tint?.chroma ?? 1, light: b.tint?.light ?? 1 };
    for (const ty of types.list) {
      const own = b.colours?.[ty.name];
      const c: RampColour = { L: own?.L ?? ty.colour.L, C: own?.C ?? ty.colour.C, h: own?.h ?? ty.colour.h };
      let t = ty.glow ? { ...tint, light: 1 } : tint;
      let col = c;
      if (VEGETATION.has(ty.texture)) {
        t = { hue: t.hue + (season.hue ?? 0), chroma: t.chroma * (season.chroma ?? 1), light: t.light * (season.light ?? 1) };
        // (Frost: lightness toward snow's, chroma down.)
        if (fr) col = { L: [c.L[0] + (0.6 - c.L[0]) * fr, c.L[1] + (0.97 - c.L[1]) * fr], C: c.C * (1 - fr * 0.8), h: c.h + (225 - c.h) * fr * 0.5 };
      }
      add(`${ty.name}@${bi}`, groundRamp(n, col, t));
      // (The lush variant: a little warmer or greener and brighter -- macro patches.)
      add(`${ty.name}@${bi}+`, groundRamp(n, { L: [col.L[0] + 0.02, Math.min(0.98, col.L[1] + 0.03)], C: col.C * 1.12, h: col.h + (VEGETATION.has(ty.texture) ? 10 : 6) }, t));
    }
    const petals = b.petals ?? [350, 52, 280];
    for (let p = 0; p < 3; p += 1) {
      const hue = petals[p % petals.length]!;
      add(`petal@${bi}.${p}`, groundRamp(5, { L: [0.5, 0.95], C: 0.16 * (season.bloom ?? 1), h: hue }, { hue: 0, chroma: 1, light: 1 }));
    }
  });
  add("leaf.fall", groundRamp(5, { L: [0.35, 0.78], C: 0.14, h: 50 }, { hue: 0, chroma: 1, light: 1 }));
  add("bone", groundRamp(4, { L: [0.55, 0.93], C: 0.025, h: 80 }, { hue: 0, chroma: 1, light: 1 }));
  // (The key is the LAYOUT's: bakes hold indices, so a season -- or a biome's new tint -- keeps every bake.)
  const key = surfaceLayoutKey(types, biomes, opts);
  return {
    colours, ramps, cycles: base.cycles, key,
    ramp(name) { const r = ramps[name]; if (!r) throw new RangeError(`No ground ramp "${name}".`); return r; },
  };
}

/** The layout's key alone (what a bake depends on): the same for every season of one surface palette. */
export const surfaceLayoutKey = (types: TerrainTable, biomes: readonly SurfaceBiome[], opts: GroundPaletteOptions = {}): string =>
  `sl${hashText(JSON.stringify([types.list.map((t) => t.name), biomes.length, opts.rampLength ?? 8, Object.keys({ ...GROUND_MATERIALS, ...(opts.materials ?? {}) })]))}`;

/** Another season's colours for the same layout: upload it (GroundRenderer.setPalette), rebake nothing. */
export function seasonPalette(types: TerrainTable, biomes: readonly SurfaceBiome[], season: SurfaceSeason, opts: GroundPaletteOptions = {}): GroundPalette {
  return surfacePalette(types, biomes, { ...opts, season });
}

// ---------------------------------------------------------------- variants

/**
 * A tile's variant (0..n-1): weighted by `weights` (default even), never the
 * same as the variant the tile to its west or south would have drawn (a
 * pure function of the place: any chunk computes the same answer).
 */
export function tileVariant(i: number, j: number, seed: number, n = 4, weights: readonly number[] | null = null): number {
  const draw = (a: number, b: number, salt: number): number => {
    const r = hash2(a, b, seed + 0x7a11 + salt);
    if (!weights) return Math.min(n - 1, Math.floor(r * n));
    let total = 0;
    for (let v = 0; v < n; v += 1) total += weights[v] ?? 1;
    let x = r * total;
    for (let v = 0; v < n; v += 1) { x -= weights[v] ?? 1; if (x < 0) return v; }
    return n - 1;
  };
  if (n <= 1) return 0;
  if (!weights) {
    // Even odds: exact. v = (a(i) + b(j)) mod n where a and b never repeat their neighbour -- a step of 1 or 1 + 2
    // (hashed) -- so a tile differs from the one west of it (a differs) and south of it (b differs), always, and
    // any chunk computes it alone.
    const step = (x: number, s: number): number => (n >= 4 ? x + 2 * (hash2(x, 0, s) < 0.5 ? 0 : 1) : x);
    return (((step(i, seed + 0x7a12) + step(j, seed + 0x7a13) + Math.floor(hash2(0, 0, seed) * n)) % n) + n) % n;
  }
  // Weighted: a draw that repeats the draw west or south of it is drawn once more (the weights still rule: a
  // common variant stays common, just rarely twice in a row).
  const v0 = draw(i, j, 0);
  return v0 === draw(i - 1, j, 0) || v0 === draw(i, j - 1, 0) ? draw(i, j, 1) : v0;
}

// ---------------------------------------------------------------- the shader

/** Each texture kind's edge character, its default decals, and whether it keeps a straight edge. */
interface Trait { readonly freq: number; readonly octaves: number; readonly blocky: number; readonly amp: number; readonly decals: Readonly<Partial<Record<DecalKind, number>>>; readonly crisp?: boolean; readonly wear?: string }
const TRAITS: Readonly<Record<TextureKind, Trait>> = {
  grass: { freq: 2.1, octaves: 2, blocky: 0, amp: 1.1, decals: { tufts: 0.5, flowers: 0.1 } },
  dirt: { freq: 1.2, octaves: 2, blocky: 0, amp: 0.9, decals: { pebbles: 0.28 } },
  sand: { freq: 0.55, octaves: 2, blocky: 0, amp: 0.8, decals: { pebbles: 0.05 } },
  rock: { freq: 0.9, octaves: 1, blocky: 0.6, amp: 1, decals: { pebbles: 0.14, cracks: 1 } },
  snow: { freq: 0.7, octaves: 2, blocky: 0, amp: 0.9, decals: { pebbles: 0.03 } },
  crystal: { freq: 1.4, octaves: 1, blocky: 0.8, amp: 1, decals: {} },
  lava: { freq: 0.8, octaves: 2, blocky: 0, amp: 0.8, decals: {} },
  ash: { freq: 1.1, octaves: 2, blocky: 0, amp: 0.9, decals: { pebbles: 0.22 } },
  mud: { freq: 0.9, octaves: 2, blocky: 0, amp: 0.8, decals: { pebbles: 0.08 } },
  cobble: { freq: 2, octaves: 1, blocky: 1, amp: 0, decals: {}, crisp: true, wear: "path" },
  path: { freq: 1.3, octaves: 2, blocky: 0, amp: 0.8, decals: { pebbles: 0.22 } },
  ice: { freq: 0.8, octaves: 1, blocky: 0.4, amp: 0.8, decals: { cracks: 0.7 } },
  plain: { freq: 1, octaves: 1, blocky: 0, amp: 0.6, decals: {} },
  flagstone: { freq: 1.6, octaves: 1, blocky: 1, amp: 0.8, decals: { cracks: 0.7, bones: 0.02, pebbles: 0.05 } },
  gravel: { freq: 1.8, octaves: 2, blocky: 0.2, amp: 0.9, decals: { pebbles: 0.75 } },
  moss: { freq: 1.6, octaves: 2, blocky: 0, amp: 1.1, decals: { tufts: 0.3 } },
  clay: { freq: 1, octaves: 2, blocky: 0, amp: 0.8, decals: { cracks: 1.6, pebbles: 0.05 } },
  litter: { freq: 1.5, octaves: 2, blocky: 0, amp: 1, decals: { leaves: 0.65, tufts: 0.08, pebbles: 0.05 } },
  brick: { freq: 1.6, octaves: 1, blocky: 1, amp: 0.6, decals: { cracks: 0.4 } },
  creep: { freq: 1.9, octaves: 2, blocky: 0, amp: 1.2, decals: { pebbles: 0.18 } },
};
export const TEXTURE_TRAITS = TRAITS;

// Decal shapes: [dx, dy, role] in global pixels round the decal's centre (role 1 the bright part, 2 the other).
const SHAPES: Readonly<Record<DecalKind, ReadonlyArray<readonly (readonly [number, number, number])[]>>> = {
  tufts: [[[0, 0, 2], [0, -1, 1], [-1, 0, 2]], [[0, 0, 2], [0, -1, 1], [1, -1, 1], [-1, 0, 2]], [[0, 0, 1], [0, -1, 1], [1, 0, 2]]],
  flowers: [[[0, 0, 1], [0, 1, 3]], [[0, 0, 1], [-1, 0, 2], [1, 0, 2], [0, -1, 2], [0, 1, 2]], [[0, 0, 2], [1, -1, 2], [0, 1, 3]]],
  pebbles: [[[0, 0, 1], [1, 0, 2]], [[0, 0, 1], [0, 1, 2], [1, 1, 2]], [[0, 0, 2]]],
  cracks: [[]],
  leaves: [[[0, 0, 1]], [[0, 0, 1], [1, 0, 2]], [[0, 0, 2], [-1, 1, 1]]],
  bones: [[[0, 0, 1], [1, 0, 1], [2, -1, 1], [-1, 1, 1]], [[0, 0, 1], [0, -1, 2], [1, 1, 1]]],
};
const CELL = 6; // (decal cells, in global pixels)

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer4 = (gx: number, gy: number): number => (BAYER4[(gy & 3) * 4 + (gx & 3)]! + 0.5) / 16;

export interface SurfaceShaderInput {
  readonly terrain: Terrain;
  readonly surface: GroundSurface;
  readonly palette: GroundPalette;
  /** The world tile of the terrain's (0, 0) (a world chunk's own small terrain). */
  readonly origin: readonly [number, number];
  readonly seed: number;
  /** Pixels a metre (decal cells are in pixels). */
  readonly k: number;
  /** The texture kinds' micro texture (the ground baker's). */
  readonly texture: (tex: TextureKind, x: number, z: number, y: number) => number;
  /** A tile's highest corner (local tile coordinates). */
  readonly topOf: (i: number, j: number) => number;
}

/** What the shader answers for a texel: a ramp (palette [base, length]), a position on it, and whether to dither it. */
export interface SurfaceTexel { base: number; len: number; tv: number; exact: boolean; material: number; biome: number }

export interface SurfaceShader {
  /** A top texel at world (X, Y, Z) on local tile kk, global pixel (gx, gy), lit `light`. */
  top(kk: number, X: number, Y: number, Z: number, gx: number, gy: number, light: number, out: SurfaceTexel): SurfaceTexel;
  /** A cliff face's ramp for a tile (its face type, in its biome). */
  side(kk: number, faceType: number, X: number, Z: number, gx: number, gy: number): readonly [number, number];
  /** How lit a world point is, 0..1 (1 without a light layer): the tiles' light, bilinear between their middles. */
  lightAt(X: number, Z: number): number;
  /** The winning material at a world point (tests, tools): type id and biome. */
  materialAt(X: number, Z: number, gx: number, gy: number): { type: number; biome: number };
}

export function createSurfaceShader(input: SurfaceShaderInput): SurfaceShader {
  const { terrain: t, surface: S, palette: pal, origin, seed, k, texture, topOf } = input;
  const [oi, oj] = origin;
  const ts = t.tileSize;
  const types = t.types.list;
  const nT = types.length;
  const nB = Math.max(1, S.biomes.length);
  const biome = S.biome;
  const lightL = S.light ?? null;
  const blend = S.blend ?? {};
  const jitter = blend.jitter ?? 0.34, precedence = blend.precedence ?? 0.09;
  // (Score units per pixel: a tile's weight changes by 1 across ts x k pixels.)
  const perPx = 1 / (ts * k);
  const band = (blend.dither ?? 1) * perPx;
  const warp = blend.warp ?? 0.42, rim = blend.rim ?? 0.16, rimW = 1.6 * perPx;
  const bJitter = blend.biomeJitter ?? 0.8, bBand = (blend.biomeDither ?? 4) * perPx;
  const macroF = 1 / (S.macro?.size ?? 55), macroAmt = S.macro?.amount ?? 0.2, lush = S.macro?.lush ?? 0.3;
  const aoS = S.ao ?? 0.3, aoR = S.aoReach ?? 0.3, hShade = S.heightShade ?? 0.022;
  const decalsOn = S.decals ?? true;
  const nVar = Math.max(1, S.variants ?? 4);
  const trait = types.map((ty) => TRAITS[ty.texture] ?? TRAITS.plain);
  const prio = types.map((ty) => ty.priority);
  const crisp = trait.map((tr) => tr.crisp === true);
  const wear = types.map((ty, id) => { const w = trait[id]!.wear; return w && t.types.has(w) ? t.types.id(w) : id; });
  const glow = types.map((ty) => ty.glow);
  const sd = (seed * 7919 + 101) | 0;
  // Ramps per type x biome x variant, looked up once.
  const rampTB: Array<readonly [number, number]> = [];
  const fallback = (name: string): readonly [number, number] => pal.ramps[name] ?? pal.ramps["stone"]!;
  for (let b = 0; b < nB; b += 1) for (let ty = 0; ty < nT; ty += 1) {
    const name = types[ty]!.name;
    rampTB[(b * nT + ty) * 2] = pal.ramps[`${name}@${b}`] ?? fallback(name);
    rampTB[(b * nT + ty) * 2 + 1] = pal.ramps[`${name}@${b}+`] ?? fallback(name);
  }
  const petal = (b: number, p: number): readonly [number, number] => pal.ramps[`petal@${b}.${p}`] ?? fallback("glass");
  const leafFall = fallback("leaf.fall"), bone = fallback("bone");
  const decalScale = S.biomes.map((b) => b.decals ?? {});

  // A material's edge noise at a point: 0..1.
  const edgeNoise = (ty: number, X: number, Z: number): number => {
    const tr = trait[ty]!;
    const s = sd + ty * 131;
    if (tr.blocky >= 1) { const c = 0.5 * tr.freq; return hash2(Math.floor(X * c), Math.floor(Z * c), s); }
    const n = tr.octaves > 1 ? fbm2(X * tr.freq, Z * tr.freq, s, tr.octaves) : vnoise2(X * tr.freq, Z * tr.freq, s);
    if (!tr.blocky) return n;
    const c = tr.freq;
    return n * (1 - tr.blocky) + hash2(Math.floor(X * c), Math.floor(Z * c), s + 7) * tr.blocky;
  };
  const inside = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < t.width && j < t.depth;
  const ramp = (k0: number): boolean => (t.flags[k0]! & FLAG.RAMP) !== 0;
  // Do two tiles' tops blend? The same level, both flat (a ramp keeps its own).
  const joins = (a: number, b: number): boolean => t.height[a] === t.height[b] && !ramp(a) && !ramp(b);

  const mId = [0, 0, 0, 0], mW = [0, 0, 0, 0];
  // (The warped lattice cell corner() last found a texel in: which tile centres it lies between, and where.)
  let latI = 0, latJ = 0, latX = 0, latZ = 0;
  const bId = [0, 0, 0, 0], bW = [0, 0, 0, 0];
  // The four tiles round a texel's corner, and what each material weighs there: returns how many materials.
  const corner = (X: number, Z: number, kk: number): number => {
    // (The lattice warped: two noise fields about two tiles across push the sample point up to `warp` tiles.)
    const wf = 0.2 / ts * 2;
    const fx = X / ts - oi - 0.5 + (warp ? (vnoise2(X * wf, Z * wf, sd + 3) - 0.5) * 2 * warp : 0);
    const fz = Z / ts - oj - 0.5 + (warp ? (vnoise2(X * wf + 17.3, Z * wf, sd + 4) - 0.5) * 2 * warp : 0);
    const ia = Math.floor(fx), ja = Math.floor(fz), ax = fx - ia, az = fz - ja;
    latI = ia; latJ = ja; latX = ax; latZ = az;
    const own = t.type[kk]!;
    let nm = 0;
    for (let q = 0; q < 4; q += 1) {
      const ii = ia + (q & 1), jj = ja + (q >> 1);
      const w0 = ((q & 1) ? ax : 1 - ax) * ((q >> 1) ? az : 1 - az);
      let ty = own, wv = 1;
      if (ii >= 0 && jj >= 0 && ii < t.width && jj < t.depth) {
        const n = jj * t.width + ii;
        if (n !== kk && t.height[n] === t.height[kk] && !((t.flags[n]! | t.flags[kk]!) & FLAG.RAMP)) { ty = t.type[n]!; if (crisp[ty]) { ty = wear[ty]!; wv = 1.7; } }
      }
      // (A crisp material's wear reaches a little further into its neighbours than a plain border would.)
      const w = w0 * wv;
      if (nm > 0 && mId[0] === ty) { mW[0] = mW[0]! + w; continue; }
      let m = 1;
      while (m < nm && mId[m] !== ty) m += 1;
      if (m >= nm) { m = nm; mId[m] = ty; mW[m] = w; nm += 1; } else mW[m] = mW[m]! + w;
    }
    return nm;
  };
  // The winner among scored candidates, with a dithered band at the border.
  let margin = Infinity, runner = -1;
  const pick = (ids: number[], ws: number[], n: number, score: (id: number, w: number) => number, bandW: number, gx: number, gy: number): number => {
    margin = Infinity; runner = -1;
    if (n === 1) return ids[0]!;
    let b1 = -1, s1 = -Infinity, b2 = -1, s2 = -Infinity;
    for (let m = 0; m < n; m += 1) {
      const s = score(ids[m]!, ws[m]!);
      if (s > s1) { b2 = b1; s2 = s1; b1 = m; s1 = s; } else if (s > s2) { b2 = m; s2 = s; }
    }
    margin = s1 - s2; runner = b2 >= 0 ? ids[b2]! : -1;
    if (bandW > 0 && b2 >= 0 && s1 - s2 < bandW && bayer4(gx, gy) < 0.5 * (1 - (s1 - s2) / bandW)) { runner = ids[b1]!; return ids[b2]!; }
    return ids[b1]!;
  };
  const tileOf = (X: number, Z: number): [number, number] => [Math.floor(X / ts) - oi, Math.floor(Z / ts) - oj];
  // (Variants by tile, drawn once.)
  const variantOf = new Int8Array(t.width * t.depth).fill(-1);
  const tileVar = (i: number, j: number): number => {
    const q = j * t.width + i;
    let v = variantOf[q]!;
    if (v < 0) { v = tileVariant(i + oi, j + oj, sd, nVar); variantOf[q] = v; }
    return v;
  };

  const chooseMaterial = (kk: number, X: number, Z: number, gx: number, gy: number, nm: number): number => {
    const own = t.type[kk]!;
    // (No border here: the rim must not read the last texel's -- a pure function of the texel, as the GPU ground has it.)
    if (crisp[own] || nm === 1) { margin = Infinity; runner = -1; return nm === 1 && !crisp[own] ? mId[0]! : own; }
    let top = 0;
    for (let m = 1; m < nm; m += 1) if (prio[mId[m]!]! > prio[mId[top]!]!) top = m;
    const topId = mId[top]!;
    return pick(mId, mW, nm, (id, w) => w + jitter * trait[id]!.amp * (edgeNoise(id, X, Z) - 0.5) + (id === topId ? precedence : 0), band, gx, gy);
  };
  // Biome borders are WIDE: each tile corner holds the share of every biome in the 2R x 2R tiles round it (R = 2,
  // what the apron allows), a texel mixes its four corners bilinearly, and an ordered dither with a little noise
  // picks one -- a hand-dithered gradient across four tiles, ragged by the noise, not a line.
  const R = 2;
  const cw = t.width + 1;
  const cornerB = biome ? new Uint8Array(cw * (t.depth + 1) * 3).fill(255) : null;
  const cornerW = biome ? new Float32Array(cw * (t.depth + 1) * 3) : null;
  const cornerDone = biome ? new Uint8Array(cw * (t.depth + 1)) : null;
  const cornerOf = (ci: number, cj: number): number => {
    const q = cj * cw + ci;
    if (cornerDone![q]) return q;
    cornerDone![q] = 1;
    const ids: number[] = [], ws: number[] = [];
    let total = 0;
    for (let jj = cj - R; jj < cj + R; jj += 1) for (let ii = ci - R; ii < ci + R; ii += 1) {
      const a = Math.max(0, Math.min(t.width - 1, ii)), b = Math.max(0, Math.min(t.depth - 1, jj));
      const bi = biome![b * t.width + a]!;
      // (Nearer tiles count more: a tent over the box.)
      const w = (R + 0.5 - Math.abs(ii + 0.5 - ci)) * (R + 0.5 - Math.abs(jj + 0.5 - cj));
      const m = ids.indexOf(bi);
      if (m < 0) { ids.push(bi); ws.push(w); } else ws[m] = ws[m]! + w;
      total += w;
    }
    const order = ids.map((_, n) => n).sort((x, y) => ws[y]! - ws[x]!).slice(0, 3);
    order.forEach((n, s0) => { cornerB![q * 3 + s0] = ids[n]!; cornerW![q * 3 + s0] = ws[n]! / total; });
    return q;
  };
  const chooseBiome = (X: number, Z: number, gx: number, gy: number): number => {
    const fx = X / ts - oi, fz = Z / ts - oj;
    const ia = Math.max(0, Math.min(t.width - 1, Math.floor(fx))), ja = Math.max(0, Math.min(t.depth - 1, Math.floor(fz)));
    const ax = fx - ia, az = fz - ja;
    let nb = 0;
    for (let q = 0; q < 4; q += 1) {
      const c = cornerOf(ia + (q & 1), ja + (q >> 1));
      const w = ((q & 1) ? ax : 1 - ax) * ((q >> 1) ? az : 1 - az);
      for (let s0 = 0; s0 < 3; s0 += 1) {
        const id = cornerB![c * 3 + s0]!;
        if (id === 255) break;
        let m = 0;
        while (m < nb && bId[m] !== id) m += 1;
        if (m === nb) { bId[m] = id; bW[m] = 0; nb += 1; if (nb > 3) { nb = 3; continue; } }
        bW[m] = bW[m]! + w * cornerW![c * 3 + s0]!;
      }
    }
    if (nb === 1) return bId[0]!;
    // (Ordered dither: the biomes' shares stacked against a Bayer threshold, jittered by noise so it isn't a pattern.)
    const th = bayer4(gx, gy) * (1 - bJitter * 0.5) + bJitter * 0.5 * fbm2(X * 0.35, Z * 0.35, sd + 900, 2);
    let acc = 0;
    let best = 0;
    for (let m = 1; m < nb; m += 1) if (bW[m]! > bW[best]!) best = m;
    // (A share under the band's floor never shows: the gradient ends clean.)
    for (let m = 0; m < nb; m += 1) { acc += bW[m]!; if (th < acc) return bW[m]! < bBand ? bId[best]! : bId[m]!; }
    return bId[best]!;
  };

  // Decals over a texel: the kind and role painting it (role 0: none). A cell of CELL x CELL global pixels holds
  // one decal or none, wholly inside it (shapes reach -1..2 across, -1..1 down), so a texel reads its own cell only.
  // Per material and biome, the cumulative densities (kinds in DECAL_KINDS order).
  const dOut = { kind: -1, role: 0, hue: 0 };
  const cum = new Float32Array(nT * nB * DECAL_KINDS.length);
  for (let b = 0; b < nB; b += 1) for (let ty = 0; ty < nT; ty += 1) {
    let acc = 0;
    DECAL_KINDS.forEach((name, d) => {
      if (name !== "cracks") acc += (trait[ty]!.decals[name] ?? 0) * ((decalScale[b] ?? {})[name] ?? 1) * 0.5;
      cum[(b * nT + ty) * DECAL_KINDS.length + d] = acc;
    });
  }
  const decalAt = (gx: number, gy: number, ty: number, b: number): typeof dOut => {
    dOut.kind = -1; dOut.role = 0;
    const o = (b * nT + ty) * DECAL_KINDS.length;
    if (cum[o + DECAL_KINDS.length - 1]! <= 0) return dOut;
    const cx = Math.floor(gx / CELL), cy = Math.floor(gy / CELL);
    const h = hash2(cx, cy, sd + 1300);
    let kind = -1;
    for (let d = 0; d < DECAL_KINDS.length; d += 1) if (h < cum[o + d]!) { kind = d; break; }
    if (kind < 0) return dOut;
    const hx = hash2(cx, cy, sd + 1301);
    const px = cx * CELL + 1 + Math.floor(hx * (CELL - 3)), py = cy * CELL + 1 + Math.floor(((hx * 997) % 1) * (CELL - 2));
    const rx = gx - px, ry = gy - py;
    if (rx < -1 || rx > 2 || ry < -1 || ry > 1) return dOut;
    const shapes = SHAPES[DECAL_KINDS[kind]!]!;
    const shape = shapes[Math.floor(((hx * 7919) % 1) * shapes.length)]!;
    for (const [dx, dy, role] of shape) if (dx === rx && dy === ry) { dOut.kind = kind; dOut.role = role; dOut.hue = Math.floor(((hx * 104729) % 1) * 3); return dOut; }
    return dOut;
  };

  // Per tile: which neighbours stand higher (bits N E S W, then the corners SW SE NW NE) and by how much.
  const aoBits = new Int16Array(t.width * t.depth).fill(-1);
  const aoUp = new Uint8Array(t.width * t.depth * 4);
  const aoMask = (i: number, j: number): number => {
    const q = j * t.width + i;
    let m = aoBits[q]!;
    if (m >= 0) return m;
    m = 0;
    const here = topOf(i, j);
    const DI = [0, 1, 0, -1, -1, 1, -1, 1], DJ = [1, 0, -1, 0, -1, -1, 1, 1];
    for (let d = 0; d < 8; d += 1) {
      const ni = i + DI[d]!, nj = j + DJ[d]!;
      if (!inside(ni, nj)) continue;
      const up = topOf(ni, nj) - here;
      if (up > 0) { m |= 1 << d; if (d < 4) aoUp[q * 4 + d] = Math.min(255, up); }
    }
    aoBits[q] = m;
    return m;
  };
  const aoOf = (e: number, up: number): number => (e < aoR ? (1 - e / aoR) ** 2 * Math.min(1.4, 0.7 + up * 0.3) : 0);

  const api: SurfaceShader = {
    top(kk, X, Y, Z, gx, gy, light, out) {
      const counts = corner(X, Z, kk);
      const ty = chooseMaterial(kk, X, Z, gx, gy, counts);
      const edgeM = margin, edgeR = runner;
      const b = biome ? chooseBiome(X, Z, gx, gy) : 0;
      const i = kk % t.width, j = (kk - i) / t.width;
      const u = X / ts - oi - i, v = Z / ts - oj - j;
      // Variant: the texture sampled somewhere else, a nudge of light. Whose: the tile whose centre is nearest in the
      // warped lattice, dithered across the midline -- a variant's border wanders and dithers like a material's, never
      // a straight seam on the tile grid -- and only a tile this one joins (the same level, no ramps) lends its own.
      let vr = 0;
      if (nVar > 1) {
        const th = (bayer4(gx, gy) - 0.5) * 3 * perPx;
        const qi = latI + (latX + th >= 0.5 ? 1 : 0), qj = latJ + (latZ + th >= 0.5 ? 1 : 0);
        let vi = i, vj = j;
        if (inside(qi, qj)) { const n = qj * t.width + qi; if (n !== kk && joins(n, kk)) { vi = qi; vj = qj; } }
        vr = tileVar(vi, vj);
      }
      const vx = X + vr * 13.37, vz = Z + vr * 7.91;
      const tex = types[ty]!.texture;
      let tv = 0.12 + light * 0.7 + texture(tex, vx, vz, Y) + glow[ty]! + (vr - (nVar - 1) / 2) * 0.012;
      // Macro: big soft areas lighter or darker, and patches on the lush ramp.
      const m1 = vnoise2(X * macroF, Z * macroF, sd + 40) * 0.65 + vnoise2(X * macroF * 2.3, Z * macroF * 2.3, sd + 41) * 0.35;
      tv += (m1 - 0.5) * macroAmt * 2;
      const m2 = vnoise2(X * macroF * 1.6 + 31, Z * macroF * 1.6, sd + 42);
      let variant = m2 + (bayer4(gx, gy) - 0.5) * 0.1 > 1 - lush ? 1 : 0;
      // Height: higher ground a little lighter.
      const h0 = t.height[kk]!;
      tv += Math.max(-0.12, Math.min(0.12, (h0 - 2) * hShade));
      // AO: contact shade at the foot of a higher neighbour (edges and corners).
      if (aoS > 0) {
        const m = aoMask(i, j);
        if (m) {
          let ao = 0;
          const jit = (vnoise2(X * 3.1, Z * 3.1, sd + 60) - 0.5) * 0.08;
          if (m & 1) ao = Math.max(ao, aoOf(1 - v + jit, aoUp[kk * 4]!));
          if (m & 2) ao = Math.max(ao, aoOf(1 - u + jit, aoUp[kk * 4 + 1]!));
          if (m & 4) ao = Math.max(ao, aoOf(v + jit, aoUp[kk * 4 + 2]!));
          if (m & 8) ao = Math.max(ao, aoOf(u + jit, aoUp[kk * 4 + 3]!));
          if (m & 16) ao = Math.max(ao, aoOf(Math.max(u, v), 1) * 0.8);
          if (m & 32) ao = Math.max(ao, aoOf(Math.max(1 - u, v), 1) * 0.8);
          if (m & 64) ao = Math.max(ao, aoOf(Math.max(u, 1 - v), 1) * 0.8);
          if (m & 128) ao = Math.max(ao, aoOf(Math.max(1 - u, 1 - v), 1) * 0.8);
          tv -= ao * aoS;
        }
      }
      // The rim: the higher material's lit lip along its edge, and the shade it drops on the lower one beside it.
      if (rim && edgeR >= 0 && edgeM < rimW + band) {
        if (prio[ty]! > prio[edgeR]!) tv += rim * 0.7;
        else if (prio[ty]! < prio[edgeR]!) tv -= rim;
      }
      let r = rampTB[(b * nT + ty) * 2 + variant]!;
      out.exact = false;
      // Decals: cracks along a noise ridge; the rest on the pixel grid.
      if (decalsOn) {
        const tr = trait[ty]!.decals;
        const cr = (tr.cracks ?? 0) * ((decalScale[b] ?? {}).cracks ?? 1);
        if (cr > 0) {
          const ridge = Math.abs(vnoise2(X * 1.1 + 5, Z * 1.1, sd + 70) - 0.5);
          if (ridge < 0.012 * cr && vnoise2(X * 0.3, Z * 0.3, sd + 71) > 0.45) tv -= 0.32;
        }
        const d = decalAt(gx, gy, ty, b);
        if (d.role) {
          const kind = DECAL_KINDS[d.kind]!;
          if (kind === "tufts") tv += d.role === 1 ? 0.3 : 0.14;
          else if (kind === "pebbles") tv += d.role === 1 ? 0.22 : -0.26;
          else if (kind === "flowers") {
            if (d.role === 3) tv -= 0.1;
            else { r = petal(b, d.hue); tv = d.role === 1 ? 0.95 : 0.62; out.exact = true; }
          } else if (kind === "leaves") { r = leafFall; tv = d.role === 1 ? 0.7 : 0.4; out.exact = true; }
          else if (kind === "bones") { r = bone; tv = d.role === 1 ? 0.85 : 0.5; out.exact = true; }
        }
      }
      if (lightL) { const lt = api.lightAt(X, Z); tv = tv * (0.25 + 0.75 * lt) - (1 - lt) * 0.18; }
      out.base = r[0]; out.len = r[1]; out.tv = tv; out.material = ty; out.biome = b;
      return out;
    },
    side(kk, faceType, X, Z, gx, gy) {
      let b = biome ? biome[kk]! : 0;
      if (biome) b = chooseBiome(X, Z, gx, gy);
      return rampTB[(b * nT + faceType) * 2]!;
    },
    lightAt(X, Z) {
      if (!lightL) return 1;
      const fx = X / ts - oi - 0.5, fz = Z / ts - oj - 0.5;
      const ia = Math.floor(fx), ja = Math.floor(fz), ax = fx - ia, az = fz - ja;
      const L = (i: number, j: number): number => lightL[Math.max(0, Math.min(t.depth - 1, j)) * t.width + Math.max(0, Math.min(t.width - 1, i))]! / 255;
      return (L(ia, ja) * (1 - ax) + L(ia + 1, ja) * ax) * (1 - az) + (L(ia, ja + 1) * (1 - ax) + L(ia + 1, ja + 1) * ax) * az;
    },
    materialAt(X, Z, gx, gy) {
      const [i, j] = tileOf(X, Z);
      if (!inside(i, j)) return { type: -1, biome: -1 };
      const kk = j * t.width + i;
      const counts = corner(X, Z, kk);
      return { type: chooseMaterial(kk, X, Z, gx, gy, counts), biome: biome ? chooseBiome(X, Z, gx, gy) : 0 };
    },
  };
  return api;
}
