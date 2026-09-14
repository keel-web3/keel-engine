// Generation: a level from a seed, where every choice is a SETTING. Each
// choice is drawn from its own stream (named by the thing and the key: the
// world's convention, "choose:<id>:<key>") and handed to settings.propose, so
//
//   - a LOCK anywhere (the project, the scene, a tag, one thing's id) wins,
//     and the generator builds with the locked value;
//   - a choice's draw happens whether or not it is locked, and no two choices
//     share a stream, so locking one never reshuffles another;
//   - the same seed and locks build the same level, to the tile.
//
// The choices (global keys, or per thing -- locked as "id:lake-0/radius=6"):
//   level.template   island | valley | highlands | archipelago
//   level.biome      temperate | desert | tundra | volcanic | alien
//   level.symmetry   none | mirror | rot2 | rot4 | wedges     (N players)
//   level.relief, level.sea, level.baseRadius, level.rivers, level.lakes,
//   level.towns, level.foliage, style
//   lake-<n>: at, radius     river-<n>: on     town-<n>: at, houses
//   building-<n>: object, yaw     spawn-<p>: (placed by symmetry)
//
// Layout draws nothing locks (noise offsets, the ramp order, scatter) come
// from "gen:<label>" streams. The steps, in order: height (a template over
// fbm noise, folded by the symmetry so every player's wedge is the same
// field), smoothing, types by biome and height, the sea, bases (flattened,
// with graded aprons so they're reachable), lakes, rivers, ramps joining
// every plateau the ground can't reach, resources per base, roads between
// the bases, towns and the middle (bridges where they cross water), houses
// along the roads, foliage regions, trigger regions and markers.

import { datan2, dcos, dhypot, dsin, fbm2 } from "@keel-engine/core";
import { createSettings, namedStream, parseLocks } from "@keel-engine/world";
import type { NamedStream, SettingValue, Settings, Thing as SettingsThing } from "@keel-engine/world";
import {
  DX4, DZ4, FLAG, applyBridge, buildPathGrid, canRamp, carveRiver, cornerLevels, floodWater, layRamp, rampSites, regions,
} from "@keel-engine/terrain";
import type { BridgeSpan, Terrain } from "@keel-engine/terrain";
import { BIOMES, BIOME_NAMES } from "./biomes.ts";
import type { Biome } from "./biomes.ts";
import { CONTENT_IDS, placeholderContent } from "./content.ts";
import type { ContentResolver } from "./content.ts";
import { createLevel } from "./document.ts";
import type { Level, Region, Resource, ResourceKind, Spawn, Thing, Tile, WaterFeature } from "./document.ts";
import { canonical, symmetricPositions } from "./fairness.ts";
import type { Symmetry } from "./fairness.ts";
import { roadNetwork, roadPath } from "./roads.ts";
import { MinHeap } from "./heap.ts";

export type Template = "island" | "valley" | "highlands" | "archipelago";
export const TEMPLATES: readonly Template[] = ["island", "valley", "highlands", "archipelago"];

export interface GenerateOptions {
  readonly seed: string;
  readonly width: number;
  readonly depth: number;
  /** Players (spawns). Default 2. */
  readonly players?: number;
  /** Teams: players per team (default 1: free for all). */
  readonly teamSize?: number;
  readonly tileSize?: number;
  readonly stepHeight?: number;
  readonly chunk?: number;
  /** Settings with locks (a Settings, or lock text "scene/level.biome=desert;id:lake-0/radius=6"). */
  readonly settings?: Settings | string;
  /** What buildings may be (default: the placeholder content's list for packs/buildings). */
  readonly content?: ContentResolver;
  readonly id?: string;
  readonly name?: string;
  /** A fairness reroll's attempt number (streams are suffixed by it; 0: none). */
  readonly attempt?: number;
  /**
   * A world generator in place of the template's height and types
   * (keel/worldgen's levelWorld(recipe)): it fills the terrain, then the
   * level's own steps -- bases, lakes, rivers, ramps, resources, roads,
   * towns, foliage -- run over it as ever. Exact symmetries don't apply to a
   * world's ground (fairness measures it, generateFair rerolls).
   */
  readonly world?: LevelWorld;
}

/** A world generator a level can run (keel/worldgen implements it; the level knows only this). */
export interface LevelWorld {
  /** Names it in reports (and meta). */
  readonly key: string;
  /** Fill the terrain's heights, types and water (and ramps, flags). */
  fill(terrain: Terrain, ctx: { readonly seed: string; readonly sea: number }): void;
  /** The type a graded apron tile wears at a height (null: the level's own rule). */
  typeAt?(i: number, j: number, height: number): string | null;
  /** After everything: things, markers, meta the world adds. */
  finish?(level: Level): void;
}

/** What generation did, for the editor and tests: each step's time, warnings. */
export interface GenerateReport {
  readonly ms: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

/** The chooser: lockable choices, each on its own stream. */
export interface Chooser {
  choose<T extends SettingValue>(key: string, options: readonly T[], opts?: { readonly thing?: SettingsThing | null; readonly weights?: readonly number[] | null }): T;
  int(key: string, a: number, b: number, thing?: SettingsThing | null): number;
  between(key: string, a: number, b: number, thing?: SettingsThing | null): number;
  chance(key: string, p: number, thing?: SettingsThing | null): boolean;
  /** Any value, proposed as rolled (a position): the setting's if locked. */
  propose<T extends SettingValue>(key: string, rolled: T, thing?: SettingsThing | null): T;
  /** A raw stream for layout draws nothing locks. */
  stream(label: string): NamedStream;
}

export function chooser(seed: string, settings: Settings, attempt = 0): Chooser {
  const suffix = attempt ? `#${attempt}` : "";
  const idOf = (thing: SettingsThing | null | undefined): string => (thing == null ? "" : typeof thing === "string" ? thing : thing.id);
  const S = (key: string, thing: SettingsThing | null | undefined): NamedStream => namedStream(seed, `choose:${idOf(thing)}:${key}${suffix}`);
  return {
    choose(key, options, { thing = null, weights = null } = {}) {
      const s = S(key, thing);
      const rolled = weights ? s.weighted(options.map((o, i) => [o, weights[i]!] as const)) : s.pick(options);
      return settings.propose(key, rolled, thing) as typeof rolled;
    },
    int: (key, a, b, thing = null) => settings.propose(key, S(key, thing).int(a, b), thing) as number,
    between: (key, a, b, thing = null) => settings.propose(key, S(key, thing).between(a, b), thing) as number,
    chance: (key, p, thing = null) => settings.propose(key, S(key, thing).chance(p), thing) as boolean,
    propose: (key, rolled, thing = null) => settings.propose(key, rolled, thing) as typeof rolled,
    stream: (label) => namedStream(seed, `gen:${label}${suffix}`),
  };
}

const clampI = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Generate a level. */
export function generateLevel(opts: GenerateOptions): { level: Level; report: GenerateReport } {
  const { seed, width: W, depth: D, players = 2, teamSize = 1, attempt = 0 } = opts;
  const settings = typeof opts.settings === "object" ? opts.settings : createSettings();
  if (typeof opts.settings === "string") for (const l of parseLocks(opts.settings)) (l.lock ? settings.lock(l.scope, l.key, l.value) : settings.set(l.scope, l.key, l.value));
  settings.clearSeed();
  const level = createLevel({ id: opts.id ?? "level", name: opts.name ?? `level ${seed}`, seed, width: W, depth: D, tileSize: opts.tileSize ?? 2, stepHeight: opts.stepHeight ?? 1, chunk: opts.chunk ?? 32, settings });
  const t = level.terrain;
  const C = chooser(seed, settings, attempt);
  const content = opts.content ?? placeholderContent();
  const warnings: string[] = [];
  const ms: Record<string, number> = {};
  let clock = performance.now();
  const lap = (name: string): void => { const now = performance.now(); ms[name] = now - clock; clock = now; };

  // ------------------------------------------------ the level's choices
  const template = C.choose<Template>("level.template", TEMPLATES, { weights: [3, 3, 2, 1] });
  const biomeName = C.choose("level.biome", BIOME_NAMES, { weights: [4, 2, 2, 1.5, 1] });
  const biome: Biome = BIOMES[biomeName] ?? BIOMES["temperate"]!;
  const symOptions: readonly Symmetry[] = players <= 1 ? ["none"] : players === 2 ? ["mirror", "rot2"] : players === 4 && W === D ? ["rot4", "wedges"] : ["wedges"];
  const symmetry = C.choose<Symmetry>("level.symmetry", symOptions);
  const relief = C.int("level.relief", 3, 6);
  const sea = template === "valley" || template === "highlands" ? C.int("level.sea", -2, 0) : C.int("level.sea", 1, 2);
  const baseRadius = C.between("level.baseRadius", 0.55, 0.72);
  const rivers = symmetry === "none" || symmetry === "mirror" ? C.int("level.rivers", template === "valley" ? 1 : 0, template === "valley" ? 1 : 2) : C.int("level.rivers", 0, 0);
  const lakes = symmetry === "none" ? C.int("level.lakes", 0, 3) : C.int("level.lakes", 0, 0);
  // (Exact symmetries: mirror and rot2 for two players, rot4 for four on a square map. Their maps are built for
  // player 0 and copied to the others by the symmetry, tile for tile: ramps, resources, roads.)
  const exact = (players === 2 && (symmetry === "mirror" || symmetry === "rot2")) || (players === 4 && symmetry === "rot4" && W === D);
  const towns = exact ? C.int("level.towns", 0, 0) : C.int("level.towns", players <= 2 ? 2 : 1, 3);
  const foliage = C.between("level.foliage", 0.7, 1.2);
  // (Style is never rolled: "pixel" unless a setting says otherwise -- the level's, a tag's, a region's, a thing's.)
  level.meta = { template, biome: biomeName, symmetry, players, palette: { hue: biome.tint.hue, chroma: biome.tint.chroma, light: biome.tint.light, waterHue: biome.water.hue, waterChroma: biome.water.chroma } };
  lap("choices");

  // ------------------------------------------------ height
  const N = W * D;
  const cx = W / 2, cz = D / 2;
  const noiseS = C.stream("noise");
  const ox = noiseS.between(0, 1000), oz = noiseS.between(0, 1000), ph = noiseS.between(0, Math.PI * 2), ns = noiseS.int(0, 1 << 20);
  const lv = new Int16Array(N);
  const moist = new Float32Array(N);
  const canX = new Float32Array(N), canZ = new Float32Array(N);
  const nSym = symmetry === "rot4" ? 4 : players;
  for (let j = 0; j < D; j += 1) for (let i = 0; i < W; i += 1) {
    const [x, z] = canonical(i + 0.5, j + 0.5, cx, cz, symmetry, nSym);
    canX[j * W + i] = x; canZ[j * W + i] = z;
    const r = dhypot(x - cx, z - cz) / Math.min(cx, cz);
    const n1 = fbm2(x * 0.045 + ox, z * 0.045 + oz, ns, 4);
    let e: number;
    switch (template) {
      case "island": e = n1 * 1.1 + 0.62 - r * r * 1.15; break;
      case "archipelago": e = fbm2(x * 0.075 + ox, z * 0.075 + oz, ns + 9, 4) * 1.35 + 0.1 - r * r * 0.55; break;
      case "valley": { const line = cz + dsin(x * 0.045 + ph) * D * 0.1; e = 0.12 + (Math.abs(z - line) / (D * 0.5)) * 1.25 + (n1 - 0.5) * 0.8; break; }
      default: e = n1 * 1.5 - 0.25;
    }
    lv[j * W + i] = clampI(Math.floor(e * relief), -1, relief + 1);
    moist[j * W + i] = fbm2(x * 0.03 + oz, z * 0.03 + ox, ns + 5, 3);
  }
  // Smoothing: a tile that few neighbours share takes the commonest level round it (no spikes, no one-tile pits).
  for (let pass = 0; pass < 3; pass += 1) {
    const next = lv.slice();
    for (let j = 0; j < D; j += 1) for (let i = 0; i < W; i += 1) {
      const k = j * W + i;
      const counts = new Map<number, number>();
      let same = 0;
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
        if (!di && !dj) continue;
        const a = clampI(i + di, 0, W - 1), b = clampI(j + dj, 0, D - 1);
        const v = lv[b * W + a]!;
        if (v === lv[k]) same += 1;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      if (same < 3) { let best = lv[k]!, bc = -1; for (const [v, c] of [...counts].sort((x, y) => x[0] - y[0])) if (c > bc) { best = v; bc = c; } next[k] = best; }
    }
    lv.set(next);
  }
  t.batch(() => { for (let k = 0; k < N; k += 1) t.setHeight(k % W, Math.floor(k / W), lv[k]!); });
  lap("height");

  // ------------------------------------------------ types by biome and height; the sea
  const accentS = ns + 21;
  const typeAt = (k: number, h: number): string => {
    if (opts.world?.typeAt) { const w = opts.world.typeAt(k % W, Math.floor(k / W), h); if (w) return w; }
    if (h < sea) return biome.bed;
    if (h === sea) return biome.shore;
    if (h >= relief) return biome.peak;
    if (h >= Math.ceil(relief * 0.7)) return biome.high;
    if (biome.accent && fbm2(canX[k]! * 0.09 + ox, canZ[k]! * 0.09 + oz, accentS, 2) > 0.7) return biome.accent;
    return moist[k]! > 0.4 ? biome.low[0] : biome.low[1];
  };
  t.batch(() => {
    for (let k = 0; k < N; k += 1) {
      const i = k % W, j = (k - i) / W;
      t.setType(i, j, typeAt(k, lv[k]!));
      if (lv[k]! < sea) t.setWater(i, j, sea);
    }
  });
  const water: WaterFeature[] = [];
  if (sea > -1 && lv.some((h) => h < sea)) water.push({ id: "sea", kind: "sea", level: sea, at: null, path: null });
  lap("types");

  // ------------------------------------------------ a world generator's ground, in place of the template's
  if (opts.world) {
    const world = opts.world;
    t.batch(() => world.fill(t, { seed, sea }));
    for (let k = 0; k < N; k += 1) lv[k] = t.height[k]!;
    water.length = 0;
    level.meta = { ...level.meta, world: world.key };
    lap("world");
  }

  // ------------------------------------------------ bases: symmetric spots, flattened, with graded aprons
  const spots = players > 0 ? symmetricPositions(players, symmetry, W, D, { radius: baseRadius, turn: symmetry === "wedges" ? C.stream("turn").between(0, Math.PI * 2) : 0 }) : [];
  const R0 = 5;
  const spawns: Spawn[] = [];
  // (A disk round a point -- a tile's middle, or the map's -- flattened to a level, its apron graded a step a ring.)
  const flatten = (fx: number, fz: number, r: number, level: number, type: string): void => {
    const ci = Math.floor(fx), cj = Math.floor(fz);
    for (let dj = -r - 5; dj <= r + 5; dj += 1) for (let di = -r - 5; di <= r + 5; di += 1) {
      const i = ci + di, j = cj + dj;
      if (!t.inside(i, j)) continue;
      const d = Math.max(0, Math.ceil(dhypot(i + 0.5 - fx, j + 0.5 - fz) - 0.5) - r);
      const k = t.index(i, j);
      const h = d === 0 ? level : clampI(t.height[k]!, level - d, level + d);
      t.setHeight(i, j, h);
      t.setRamp(i, j, null);
      if (d === 0) { t.setWater(i, j, null); t.setType(i, j, type); }
      else if (h >= sea) { t.setWater(i, j, null); if (t.types.id(typeAt(k, h)) !== t.type[k]) t.setType(i, j, typeAt(k, h)); }
    }
  };
  const baseLevel = Math.max(sea + 1, Math.round(relief * 0.4));
  const middleT: Tile = [Math.floor(cx), Math.floor(cz)];
  // Player p's image of a tile and a direction: exact for mirror, rot2 and rot4; for N wedges the tile turned
  // round the middle and rounded (near, not exact: fairness then measures it).
  const imaged = exact || symmetry === "wedges";
  const image = (i: number, j: number, p: number): Tile => {
    if (!p || !imaged) return [i, j];
    if (symmetry === "mirror") return [W - 1 - i, j];
    if (symmetry === "rot2") return [W - 1 - i, D - 1 - j];
    if (symmetry === "rot4") { let a = i, b = j; for (let q = 0; q < p; q += 1) [a, b] = [b, W - 1 - a]; return [a, b]; }
    const al = (Math.PI * 2 * p) / players, ca = dcos(al), sa = dsin(al);
    const dx = i + 0.5 - cx, dz = j + 0.5 - cz;
    return [clampI(Math.floor(cx + dx * ca + dz * sa), 0, W - 1), clampI(Math.floor(cz - dx * sa + dz * ca), 0, D - 1)];
  };
  const imageDir = (d: number, p: number): number => {
    if (!p || !imaged) return d;
    if (symmetry === "mirror") return d === 1 ? 3 : d === 3 ? 1 : d;
    if (symmetry === "rot2") return (d + 2) & 3;
    if (symmetry === "rot4") return (d + p) & 3;
    const al = (Math.PI * 2 * p) / players, x = DX4[d]!, z = DZ4[d]!;
    const rx = x * dcos(al) + z * dsin(al), rz = -x * dsin(al) + z * dcos(al);
    return Math.abs(rx) > Math.abs(rz) ? (rx > 0 ? 1 : 3) : (rz > 0 ? 0 : 2);
  };
  let order = imaged ? players : 1;
  t.batch(() => {
    spots.forEach(([x, z], p) => {
      const at: Tile = [clampI(Math.floor(x), R0 + 2, W - R0 - 3), clampI(Math.floor(z), R0 + 2, D - R0 - 3)];
      // (The natural: a third of the way to the middle, turned a little -- the same for every player, by the symmetry.)
      const ax = x - cx, az = z - cz;
      const rot = symmetry === "mirror" ? (x < cx ? 0.45 : -0.45) : 0.45;
      const nx = cx + (ax * dcos(rot) - az * dsin(rot)) * 0.62, nz = cz + (ax * dsin(rot) + az * dcos(rot)) * 0.62;
      const natural: Tile = [clampI(Math.round(nx), 5, W - 6), clampI(Math.round(nz), 5, D - 6)];
      // (Exact symmetries: every player's base is player 0's, turned or mirrored, to the tile.)
      const s0 = spawns[0];
      if (exact && p > 0 && s0) spawns.push({ id: `spawn-${p}`, player: p, team: Math.floor(p / teamSize), at: image(s0.at[0], s0.at[1], p), natural: s0.natural ? image(s0.natural[0], s0.natural[1], p) : null });
      else spawns.push({ id: `spawn-${p}`, player: p, team: Math.floor(p / teamSize), at, natural });
    });
    for (const s of spawns) flatten(s.at[0] + 0.5, s.at[1] + 0.5, R0, baseLevel, biome.base);
    for (const s of spawns) if (s.natural) flatten(s.natural[0] + 0.5, s.natural[1] + 0.5, 3, baseLevel, biome.low[0]);
    if (players > 1) flatten(cx, cz, 3, baseLevel, biome.base);
  });
  level.spawns = spawns;
  lap("bases");

  // ------------------------------------------------ lakes
  const nearBase = (i: number, j: number, r: number): boolean => spawns.some((s) => dhypot(s.at[0] - i, s.at[1] - j) < r || (s.natural && dhypot(s.natural[0] - i, s.natural[1] - j) < r - 2)) || (players > 1 && dhypot(middleT[0] - i, middleT[1] - j) < r - 2);
  for (let n = 0; n < lakes; n += 1) {
    const id = `lake-${n}`;
    const thing = { id, tags: ["lake"] };
    const radius = C.int("radius", 3, 7, thing);
    const at = C.propose<SettingValue>("at", [C.int("x", radius + 2, W - radius - 3, thing), C.int("z", radius + 2, D - radius - 3, thing)], thing) as unknown as [number, number];
    if (nearBase(at[0], at[1], R0 + radius + 6)) { warnings.push(`${id}: too near a base, left out`); continue; }
    let rim = Infinity;
    for (let dj = -radius - 1; dj <= radius + 1; dj += 1) for (let di = -radius - 1; di <= radius + 1; di += 1) if (Math.abs(dhypot(di, dj) - radius - 0.5) < 0.8 && t.inside(at[0] + di, at[1] + dj)) rim = Math.min(rim, t.height[t.index(at[0] + di, at[1] + dj)]!);
    const levelW = Math.max(sea, rim === Infinity ? baseLevel : rim);
    t.batch(() => {
      for (let dj = -radius; dj <= radius; dj += 1) for (let di = -radius; di <= radius; di += 1) {
        const i = at[0] + di, j = at[1] + dj, d = dhypot(di, dj);
        if (!t.inside(i, j) || d > radius) continue;
        t.setHeight(i, j, Math.min(t.height[t.index(i, j)]!, levelW - (d < radius * 0.55 ? 2 : 1)));
        t.setRamp(i, j, null);
        t.setType(i, j, biome.bed);
      }
    });
    floodWater(t, at[0], at[1], levelW, { max: (radius * 2 + 3) ** 2 * 2 });
    water.push({ id, kind: "lake", level: levelW, at, path: null });
  }
  lap("lakes");

  // ------------------------------------------------ rivers
  for (let n = 0; n < rivers; n += 1) {
    const id = `river-${n}`;
    if (!C.chance("on", 0.9, { id, tags: ["river"] })) continue;
    const RS = C.stream(id);
    let path: Tile[] | null = null;
    if (symmetry === "mirror") {
      // (Down the middle line: the one river a mirrored map can have.)
      path = Array.from({ length: D }, (_, j) => [Math.floor(cx) - 1, j] as Tile);
    } else {
      // From a high inland tile (or, in a valley, one end of it) down to the sea, a lake or the map's far side.
      const src: Tile = template === "valley" ? [0, clampI(Math.round(cz + dsin(ph) * D * 0.1), 1, D - 2)] : (() => {
        let best: Tile = [Math.floor(cx), Math.floor(cz)], bh = -Infinity;
        for (let tries = 0; tries < 60; tries += 1) { const i = RS.int(4, W - 5), j = RS.int(4, D - 5); const h = t.height[t.index(i, j)]!; if (h > bh && !nearBase(i, j, R0 + 6)) { bh = h; best = [i, j]; } }
        return best;
      })();
      path = riverPath(t, src, template === "valley" ? (i) => i === W - 1 : null);
    }
    if (!path || path.length < 6) { warnings.push(`${id}: no way down`); continue; }
    const kept = path.filter(([i, j]) => !nearBase(i, j, R0 + 2));
    if (kept.length < path.length * 0.8) { warnings.push(`${id}: runs through a base, left out`); continue; }
    carveRiver(t, path, { width: symmetry === "mirror" ? 2 : template === "valley" ? RS.int(2, 3) : RS.int(1, 2), depth: RS.chance(0.4) ? 2 : 1, flag: FLAG.RIVER });
    water.push({ id, kind: "river", level: t.water[t.index(path[0]![0], path[0]![1])]!, at: null, path });
  }
  level.water = water;
  lap("rivers");

  // ------------------------------------------------ ramps: join every plateau the ground can't reach
  const rampS = C.stream("ramps");
  const joinPlateaus = (): number => {
    const g = buildPathGrid(t);
    const reg = regions(g);
    const parent = Array.from({ length: reg.count }, (_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
    const sites = rampSites(t);
    // (A shuffled order from the ramps' stream: the same seed, the same ramps.)
    for (let s = sites.length - 1; s > 0; s -= 1) { const r = rampS.int(0, s); [sites[s], sites[r]] = [sites[r]!, sites[s]!]; }
    let laid = 0;
    const placed: Tile[] = [];
    for (const site of sites) {
      const a = reg.label[t.index(site.i, site.j)]!, top = reg.label[t.index(site.i + DX4[site.dir]!, site.j + DZ4[site.dir]!)]!;
      if (a < 0 || top < 0) continue;
      const ra = find(a), rb = find(top);
      const joins = ra !== rb;
      const spare = !joins && rampS.chance(0.06) && placed.every(([i, j]) => dhypot(i - site.i, j - site.j) > 14);
      if (!joins && !spare) continue;
      if (!canRamp(t, site.i, site.j, site.dir)) continue;
      // (On an exactly symmetric map a ramp goes in with its images, or not at all.)
      const copies = Array.from({ length: order }, (_, p) => ({ at: image(site.i, site.j, p), dir: imageDir(site.dir, p) }));
      if (!copies.every((c) => canRamp(t, c.at[0], c.at[1], c.dir))) continue;
      let any = false;
      for (const c of copies) if (layRamp(t, c.at[0], c.at[1], c.dir, 2).length) any = true;
      if (any) {
        for (const c of copies) { const la = reg.label[t.index(c.at[0], c.at[1])]!, lb = reg.label[t.index(c.at[0] + DX4[c.dir]!, c.at[1] + DZ4[c.dir]!)]!; if (la >= 0 && lb >= 0 && find(la) !== find(lb)) parent[find(la)] = find(lb); }
        laid += 1; placed.push([site.i, site.j]);
      }
    }
    return laid;
  };
  let ramps = 0;
  for (let pass = 0; pass < 3; pass += 1) { const n = joinPlateaus(); ramps += n; if (!n) break; }
  // (A symmetry can leave a plateau whose ramp's images don't all fit: if a base or the middle is still cut off,
  // join what's left one ramp at a time -- connected beats symmetric.)
  const cutOff = (): boolean => {
    const reg = regions(buildPathGrid(t));
    const keys = [...spawns.map((s) => reg.label[t.index(s.at[0], s.at[1])]), ...(players > 1 ? [reg.label[t.index(middleT[0], middleT[1])]] : [])];
    return new Set(keys).size > 1;
  };
  if (order > 1 && cutOff()) { const keep = order; order = 1; for (let pass = 0; pass < 2; pass += 1) { const n = joinPlateaus(); ramps += n; if (!n) break; } order = keep; warnings.push("a plateau needed ramps its images couldn't take"); }
  lap("ramps");

  // ------------------------------------------------ resources per base
  const resources: Resource[] = [];
  const free = (i: number, j: number): boolean => t.inside(i, j) && t.waterDepth(i, j) === 0 && !(t.flags[t.index(i, j)]! & (FLAG.RAMP | FLAG.BRIDGE)) && !resources.some((r) => r.at[0] === i && r.at[1] === j);
  const nudge = (i: number, j: number): Tile | null => {
    for (let r = 0; r < 4; r += 1) for (let dj = -r; dj <= r; dj += 1) for (let di = -r; di <= r; di += 1) if (free(i + di, j + dj)) return [i + di, j + dj];
    return null;
  };
  const ADV: readonly ResourceKind[] = ["crystal", "flux", "fertile", "wreck"];
  const addBase = (owner: number, at: Tile, mass: number, adv: boolean, tag: string): void => {
    // (Laid out facing away from the middle: the same shape for every player, turned with it.)
    const away = datan2(at[0] - cx, at[1] - cz);
    for (let m = 0; m < mass; m += 1) {
      const a = away + ((m - (mass - 1) / 2) / mass) * 2.2;
      const p = nudge(Math.round(at[0] + dsin(a) * 4.5), Math.round(at[1] + dcos(a) * 4.5));
      if (p) resources.push({ id: `${tag}-mass-${m}`, kind: "mass", at: p, amount: 1500, owner });
    }
    if (adv) ADV.forEach((kind, q) => {
      const a = away + Math.PI / 2 + ((q - 1.5) / 4) * 2.8 + (q >= 2 ? Math.PI * 0.35 : -Math.PI * 0.35);
      const p = nudge(Math.round(at[0] + dsin(a) * 6.5), Math.round(at[1] + dcos(a) * 6.5));
      if (p) resources.push({ id: `${tag}-${kind}`, kind, at: p, amount: kind === "wreck" ? 1500 : 3000, owner });
    });
  };
  if (imaged) {
    // Player 0's resources, and every player's images of them; the middle's with all their images.
    const s0 = spawns[0]!;
    addBase(0, s0.at, 8, true, "base-0");
    if (s0.natural) addBase(0, s0.natural, 6, false, "natural-0");
    addBase(-1, middleT, 4, true, "middle");
    const mine = resources.slice();
    resources.length = 0;
    for (let p = 0; p < order; p += 1) for (const r of mine) {
      const at = image(r.at[0], r.at[1], p);
      if (resources.some((x) => x.at[0] === at[0] && x.at[1] === at[1])) continue;
      resources.push({ ...r, id: r.owner === -1 ? `${r.id}-${p}` : r.id.replace(/-0(-|$)/, `-${p}$1`), at, owner: r.owner === -1 ? -1 : p });
    }
  } else {
    for (const s of spawns) { addBase(s.player, s.at, 8, true, `base-${s.player}`); if (s.natural) addBase(s.player, s.natural, 6, false, `natural-${s.player}`); }
    if (players > 1) addBase(-1, middleT, 4, true, "middle");
  }
  level.resources = resources.map((r) => (r.owner === -1 ? { ...r, owner: null } : r));
  lap("resources");

  // ------------------------------------------------ towns, roads, bridges
  const avoid = new Uint8Array(N);
  for (const r of level.resources) avoid[t.index(r.at[0], r.at[1])] = 1;
  const townAt: Tile[] = [];
  for (let n = 0; n < towns; n += 1) {
    const thing = { id: `town-${n}`, tags: ["town"] };
    const TS = C.stream(`town-${n}`);
    let best: Tile | null = null;
    for (let tries = 0; tries < 80 && !best; tries += 1) {
      const i = TS.int(8, W - 9), j = TS.int(8, D - 9);
      if (nearBase(i, j, R0 + 10) || townAt.some(([a, b]) => dhypot(a - i, b - j) < 18)) continue;
      let ok = true;
      const h0 = t.height[t.index(i, j)]!;
      for (let dj = -3; dj <= 3 && ok; dj += 1) for (let di = -3; di <= 3; di += 1) { const k = t.index(i + di, j + dj); if (t.height[k] !== h0 || t.waterDepth(i + di, j + dj) > 0 || !t.types.get(t.type[k]!).buildable) { ok = false; break; } }
      if (ok) best = [i, j];
    }
    const at = C.propose<SettingValue>("at", best ?? [-1, -1], thing) as unknown as Tile;
    if (at[0] >= 0) townAt.push(at);
  }
  const hubs: Tile[] = [...spawns.map((s) => s.at), ...(players > 1 ? [middleT] : []), ...townAt];
  const roads: Level["roads"] = [];
  const bridges: BridgeSpan[] = [];
  const road = t.types.id("road");
  const pairs = players > 1 ? spawns.map((_, p) => [p, spawns.length] as [number, number]) : [];
  if (!exact) for (const e of roadNetwork(hubs, 1)) if (!pairs.some(([a, b]) => (a === e[0] && b === e[1]) || (a === e[1] && b === e[0]))) pairs.push(e);
  const road0 = exact ? roadPath(t, hubs[0]!, middleT, { avoid, maxSpan: 8 }) : null;
  for (const [a, b] of pairs) {
    // (Exact symmetries: player 0's road, copied. Near ones: each player's own, the same way.)
    const path = exact ? road0?.map(([i, j]) => image(i, j, a)) ?? null : roadPath(t, hubs[a]!, hubs[b]!, { avoid, maxSpan: 8 });
    if (!path) { warnings.push(`road ${a}-${b}: no way`); continue; }
    t.batch(() => {
      let inWater = -1;
      path.forEach(([i, j], n) => {
        const wet = t.waterDepth(i, j) > 0;
        if (wet && inWater < 0) inWater = n - 1;
        if (!wet && inWater >= 0) {
          const from = path[inWater]!, to: Tile = [i, j];
          const axis: 0 | 1 = from[0] === to[0] ? 0 : 1;
          const lo = axis === 0 ? (from[1] < to[1] ? from : to) : (from[0] < to[0] ? from : to), hi = lo === from ? to : from;
          const span: BridgeSpan = { from: lo, to: hi, axis, length: Math.abs(axis === 0 ? to[1] - from[1] : to[0] - from[0]) - 1, level: t.height[t.index(from[0], from[1])]!, over: "water", deep: 0, joins: true, score: 0 };
          if (!bridges.some((s) => s.from[0] === span.from[0] && s.from[1] === span.from[1] && s.axis === span.axis)) { applyBridge(t, span); bridges.push(span); }
          inWater = -1;
        }
        if (!wet && !(t.flags[t.index(i, j)]! & FLAG.BRIDGE)) t.setType(i, j, road);
      });
    });
    roads.push({ id: `road-${roads.length}`, kind: "road", path });
  }
  level.roads = roads;
  bridges.forEach((s, n) => {
    const ts = t.tileSize;
    const mi = (s.from[0] + s.to[0]) / 2 + 0.5, mj = (s.from[1] + s.to[1]) / 2 + 0.5;
    const thing: Thing = {
      id: `bridge-${n}`, layer: "bridges", pack: CONTENT_IDS.buildings, object: CONTENT_IDS.bridge, pins: { length: (s.length + 1) * ts, width: ts }, look: null, tier: "ground",
      pos: [mi * ts, s.level * t.stepHeight, mj * ts], yaw: s.axis === 0 ? 0 : Math.PI / 2, scale: 1, tags: ["bridge"], footprint: null,
    };
    level.things.set(thing.id, thing);
  });
  lap("roads");

  // ------------------------------------------------ houses along the roads, by the towns
  const houses = (content.list?.(CONTENT_IDS.buildings) ?? CONTENT_IDS.houses).filter((o) => o !== CONTENT_IDS.bridge);
  const taken = new Uint8Array(N);
  let built = 0;
  const isRoad = (i: number, j: number): boolean => t.inside(i, j) && (t.type[t.index(i, j)] === road || t.isBridge(i, j));
  townAt.forEach((at, n) => {
    const count = C.int("houses", 3, 6, { id: `town-${n}`, tags: ["town"] });
    const HS = C.stream(`houses-${n}`);
    for (let h = 0, tries = 0; h < count && tries < 120; tries += 1) {
      const i = at[0] + HS.int(-7, 7), j = at[1] + HS.int(-7, 7);
      // A lot: 3 x 3 tiles, flat, buildable, free, dry, next to a road (not on it).
      let ok = t.inside(i - 1, j - 1) && t.inside(i + 1, j + 1);
      const h0 = ok ? t.height[t.index(i, j)]! : 0;
      for (let dj = -1; dj <= 1 && ok; dj += 1) for (let di = -1; di <= 1; di += 1) {
        const k = t.index(i + di, j + dj);
        if (taken[k] || t.height[k] !== h0 || t.waterDepth(i + di, j + dj) > 0 || t.flags[k]! & (FLAG.RAMP | FLAG.BRIDGE) || t.type[k] === road || !t.types.get(t.type[k]!).buildable || avoid[k]) { ok = false; break; }
      }
      if (!ok) continue;
      let face = -1;
      for (let d = 0; d < 4 && face < 0; d += 1) if (isRoad(i + DX4[d]! * 2, j + DZ4[d]! * 2)) face = d;
      if (face < 0) continue;
      const id = `building-${built}`;
      const thing = { id, tags: ["building", `town:${n}`] };
      const object = C.choose("object", houses, { thing });
      const yaw = C.propose("yaw", [0, Math.PI / 2, Math.PI, -Math.PI / 2][face]!, thing);
      for (let dj = -2; dj <= 2; dj += 1) for (let di = -2; di <= 2; di += 1) if (t.inside(i + di, j + dj)) taken[t.index(i + di, j + dj)] = 1;
      const ts = t.tileSize;
      level.things.set(id, { id, layer: "buildings", pack: CONTENT_IDS.buildings, object, pins: {}, look: null, tier: "ground", pos: [(i + 0.5) * ts, h0 * t.stepHeight, (j + 0.5) * ts], yaw, scale: 1, tags: ["building", `town:${n}`], footprint: [i - 1, j - 1, i + 2, j + 2] });
      built += 1; h += 1;
    }
  });
  lap("buildings");

  // ------------------------------------------------ foliage, regions, markers
  level.scatter = [
    { id: "flora", rect: [0, 0, W, D], rules: biome.flora, density: C.propose("density", foliage, { id: "flora", tags: ["scatter"] }), clear: 1 },
    { id: "undergrowth", rect: [0, 0, W, D], rules: biome.undergrowth, density: C.propose("density", foliage * 0.35, { id: "undergrowth", tags: ["scatter"] }), clear: 0 },
  ];
  const regionsList: Region[] = spawns.map((s) => ({ id: `base-${s.player}`, kind: "trigger", rect: [s.at[0] - R0, s.at[1] - R0, s.at[0] + R0 + 1, s.at[1] + R0 + 1], tags: ["base", `player:${s.player}`], script: null }));
  if (players > 1) regionsList.push({ id: "middle", kind: "trigger", rect: [middleT[0] - 4, middleT[1] - 4, middleT[0] + 5, middleT[1] + 5], tags: ["contested"], script: null });
  level.regions = regionsList;
  const ts = t.tileSize;
  level.markers = [
    ...(spawns[0] ? [{ id: "camera-start", kind: "camera", pos: [(spawns[0].at[0] + 0.5) * ts, baseLevel * t.stepHeight, (spawns[0].at[1] + 0.5) * ts] as const, tags: ["camera"], data: null }] : []),
    ...(players > 1 ? [{ id: "relic", kind: "relic", pos: [(middleT[0] + 0.5) * ts, baseLevel * t.stepHeight, (middleT[1] + 0.5) * ts] as const, tags: ["objective"], data: null }] : []),
  ];
  level.meta = { ...level.meta, ramps, bridges: bridges.length, buildings: built, towns: townAt.length };
  opts.world?.finish?.(level);
  lap("finish");
  return { level, report: { ms, warnings } };
}

// A river's way down: Dijkstra over heights (downhill cheap, uphill dear) from a source to the nearest water or a goal edge.
function riverPath(t: Terrain, src: Tile, goal: ((i: number, j: number) => boolean) | null): Tile[] | null {
  const W = t.width, N = W * t.depth;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const s = t.index(src[0], src[1]);
  dist[s] = 0;
  const heap = new MinHeap();
  heap.push(0, s);
  let end = -1;
  while (heap.size) {
    const [dk, k] = heap.pop();
    if (dk > dist[k]!) continue;
    const i = k % W, j = (k - i) / W;
    if (k !== s && (goal ? goal(i, j) : t.waterDepth(i, j) > 0 || i === 0 || j === 0 || i === W - 1 || j === t.depth - 1)) { end = k; break; }
    const here = Math.max(...cornerLevels(t, i, j));
    for (let d = 0; d < 4; d += 1) {
      const ni = i + DX4[d]!, nj = j + DZ4[d]!;
      if (!t.inside(ni, nj)) continue;
      const nk = nj * W + ni;
      const up = Math.max(...cornerLevels(t, ni, nj)) - here;
      const c = 1 + (up > 0 ? up * 30 : up < 0 ? 0 : 0.5) + t.height[nk]! * 0.5;
      if (dk + c < dist[nk]!) { dist[nk] = dk + c; prev[nk] = k; heap.push(dk + c, nk); }
    }
  }
  if (end < 0) return null;
  const out: Tile[] = [];
  for (let k = end; k >= 0; k = prev[k]!) out.push([k % W, Math.floor(k / W)]);
  return out.reverse();
}

/**
 * Generate, measure fairness, and reroll (the next attempt's streams) until
 * it passes or `tries` run out; the fairest one comes back either way.
 */
export function generateFair(opts: GenerateOptions & { readonly tries?: number; readonly tolerance?: number }, measure: (level: Level) => { pass: boolean; worst: { spread: number } }): { level: Level; report: GenerateReport; attempt: number; fair: ReturnType<typeof measure> } {
  let best: { level: Level; report: GenerateReport; attempt: number; fair: ReturnType<typeof measure> } | null = null;
  const locks = typeof opts.settings === "object" ? opts.settings.toJSON() : null;
  for (let attempt = 0; attempt < (opts.tries ?? 8); attempt += 1) {
    const settings = typeof opts.settings === "object" ? createSettings().load(locks!) : opts.settings;
    const r = generateLevel({ ...opts, ...(settings !== undefined ? { settings } : {}), attempt });
    const fair = measure(r.level);
    if (!best || fair.worst.spread < best.fair.worst.spread) best = { ...r, attempt, fair };
    if (fair.pass) break;
  }
  return best!;
}
