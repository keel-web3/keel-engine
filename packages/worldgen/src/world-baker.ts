// The ground of an INFINITE world, streamed: chunks generated on demand
// (createWorldStream), each baked from its own small terrain -- the chunk and
// a 2-tile apron -- at its world origin, so it lands on the world's global
// pixels exactly where one big terrain's chunk would (terrain's ground.ts:
// `origin`, `rect`); the surface blends materials and biomes across chunk
// borders because the apron carries the neighbours' tiles.
//
//   plan(view)   which chunks the view needs (visible first, nearest the
//                middle first, then a prefetch ring); far chunks are dropped
//   bake(ms)     generate and bake for up to `ms` (a chunk's bake is sliced)
//   layers()     what to draw (ground-gl's LayerToDraw)
//   paint()      runtime edits (a biome swap, creep): an overlay of tiles
//                every chunk that holds them (aprons too) takes, and only
//                those chunks rebake
//
// The palette is a surfacePalette over the stream's biome table: a season's
// palette has the same layout, so setting one rebakes nothing.

import { dhypot } from "@keel-engine/core";
import { autoTile, bakeChunk, chunkBakeJob, groundRectFor, groundSurface, groundStyleKey, surfacePalette } from "@keel-engine/terrain";
import type { ChunkBakeJob, GroundLayer, GroundPalette, GroundStyle, GroundView, LayerToDraw, Terrain } from "@keel-engine/terrain";
import type { TileLayers, WorldThing } from "./map.ts";
import { hashLayers, toTerrain } from "./map.ts";
import type { WorldStream } from "./pipeline.ts";
import { groundTypeAt } from "./swap.ts";
import { seedOf } from "./noise.ts";

export interface WorldBakerOptions {
  readonly stream: WorldStream;
  /** Default: a surfacePalette over the stream's biomes. */
  readonly palette?: GroundPalette;
  readonly style?: GroundStyle;
  /** Chunks round the view to generate and bake ahead (default 1). */
  readonly prefetch?: number;
  /** Chunks (data and layers) kept beyond what a view needs (default 96). */
  readonly keep?: number;
  readonly seed?: number;
  /**
   * A floor scale (px/m, e.g. 2): a visible chunk with no layer at all is generated and baked at it on the spot (a few
   * ms at 2 px/m), so a fast zoom out or a pan never shows a chunk with nothing -- only coarser, until its own scale
   * lands. Default none.
   */
  readonly floor?: number | null;
}

export interface WorldChunkState {
  readonly cx: number;
  readonly cz: number;
  readonly layers: TileLayers;
  readonly terrain: Terrain;
  readonly things: readonly WorldThing[];
  /** Bumped when paint() changes it. */
  version: number;
  /** A hash of its tiles (what its bake key carries). */
  hash: number;
  readonly genMs: number;
}

export interface WorldBaker {
  palette: GroundPalette;
  style: GroundStyle;
  /** The floor scale (null: none) -- off while another ground (the GPU's) draws and only the chunks are wanted. */
  floor: number | null;
  readonly stream: WorldStream;
  plan(view: GroundView & { readonly center: readonly [number, number, number]; readonly width: number; readonly height: number }): Array<[number, number]>;
  bake(ms: number): number;
  layers(): LayerToDraw[];
  /** A chunk's data, generated now if it isn't yet. */
  chunk(cx: number, cz: number): WorldChunkState;
  /** Chunks generated (cached). */
  readonly chunks: ReadonlyMap<string, WorldChunkState>;
  /** Paint world tiles as a biome (its ground at each): every chunk holding one of them rebakes. Returns those chunks. */
  paint(tiles: ReadonlyArray<readonly [number, number]>, biome: string): Array<[number, number]>;
  /** The biome index at a world tile (the overlay's, or the generated one's). */
  biomeAt(i: number, j: number): number;
  readonly ready: boolean;
  readonly stats: { readonly generated: number; readonly genMs: number; readonly baked: number; readonly bakeMs: number; readonly lastBakeMs: number; readonly queued: number; readonly layers: number; readonly painted: number };
}

const key = (cx: number, cz: number): string => `${cx},${cz}`;
const APRON = 2;

export function createWorldBaker({ stream, palette: pal0, style: style0 = { name: "pixel" }, prefetch = 1, keep = 96, seed = 1, floor = null }: WorldBakerOptions): WorldBaker {
  const C = stream.chunkSize;
  const table = stream.table, types = stream.types;
  const biomes = table.surfaceBiomes();
  let palette = pal0 ?? surfacePalette(types, biomes);
  let style = style0;
  const chunks = new Map<string, WorldChunkState>();
  const baked = new Map<string, { bakeKey: string; layer: GroundLayer; k: number }>(); // chunk key -> its layer
  const overlay = new Map<string, { type: number; biome: number }>(); // "i,j" -> painted tile
  let view: (GroundView & { center: readonly [number, number, number]; width: number; height: number }) | null = null;
  let wanted: Array<{ cx: number; cz: number; ring: number; dist: number }> = [];
  let job: { cx: number; cz: number; bakeKey: string; work: ChunkBakeJob; k: number } | null = null;
  let generated = 0, genMs = 0, bakedN = 0, bakeMs = 0, lastBakeMs = 0, painted = 0;
  const groundSeed = seedOf(stream.recipe.seed, "paint:ground");

  const applyOverlay = (L: TileLayers): void => {
    if (!overlay.size) return;
    for (let j = 0; j < L.d; j += 1) for (let i = 0; i < L.w; i += 1) {
      const o = overlay.get(`${L.i0 + i},${L.j0 + j}`);
      if (!o) continue;
      const k = j * L.w + i;
      L.type[k] = o.type; L.biome[k] = o.biome;
    }
  };
  const chunk = (cx: number, cz: number): WorldChunkState => {
    const kk = key(cx, cz);
    let s = chunks.get(kk);
    if (s) return s;
    const t0 = performance.now();
    const c = stream.chunk(cx, cz, APRON);
    applyOverlay(c.layers);
    const terrain = toTerrain(c.layers, { types, chunk: C + 2 * APRON, id: `world:${kk}` });
    const ms = performance.now() - t0;
    const L = c.layers;
    s = { cx, cz, layers: L, terrain, things: c.things, version: 0, genMs: ms, hash: hashLayers(L, L.i0, L.j0, L.i0 + L.w, L.j0 + L.d) };
    chunks.set(kk, s);
    generated += 1; genMs += ms;
    return s;
  };
  const bakeKeyOf = (s: WorldChunkState, v: GroundView): string =>
    `wg|${s.cx},${s.cz}|${s.hash.toString(36)}|k${v.pixelsPerMetre}|p${v.pitch.toFixed(4)}|y${v.yaw.toFixed(4)}|${groundStyleKey(style)}|${palette.key}`;

  const api: WorldBaker = {
    stream,
    get palette() { return palette; },
    set palette(p) { palette = p; },
    get style() { return style; },
    set style(s) { style = s; },
    get floor() { return floor; },
    set floor(f) { floor = f; },
    chunks,
    chunk,
    plan(v) {
      view = v;
      // (The ground a picture can show, allowing for heights from the sea floor to the peaks.)
      const rect = groundRectFor(v, -6, 24);
      const cs = C * (stream.recipe.tileSize ?? 2);
      const a0 = Math.floor(rect[0] / cs), a1 = Math.floor(rect[2] / cs), b0 = Math.floor(rect[1] / cs), b1 = Math.floor(rect[3] / cs);
      wanted = [];
      for (let cz = b0 - prefetch; cz <= b1 + prefetch; cz += 1) for (let cx = a0 - prefetch; cx <= a1 + prefetch; cx += 1) {
        const ring = Math.max(0, a0 - cx, cx - a1, b0 - cz, cz - b1);
        wanted.push({ cx, cz, ring, dist: dhypot((cx + 0.5) * cs - v.center[0], (cz + 0.5) * cs - v.center[2]) });
      }
      wanted.sort((x, y) => x.ring - y.ring || x.dist - y.dist);
      // Forget what's far (beyond `keep` chunks, the farthest first).
      if (chunks.size > wanted.length + keep) {
        const near = new Set(wanted.map((w) => key(w.cx, w.cz)));
        const far = [...chunks.values()].filter((s) => !near.has(key(s.cx, s.cz))).sort((x, y) => dhypot((y.cx + 0.5) * cs - v.center[0], (y.cz + 0.5) * cs - v.center[2]) - dhypot((x.cx + 0.5) * cs - v.center[0], (x.cz + 0.5) * cs - v.center[2]));
        for (const s of far.slice(0, chunks.size - wanted.length - keep)) { chunks.delete(key(s.cx, s.cz)); baked.delete(key(s.cx, s.cz)); }
      }
      if (job && !wanted.some((w) => w.cx === job!.cx && w.cz === job!.cz)) job = null;
      // (The floor: a visible chunk with nothing to draw gets its floor-scale layer now -- never a hole in the picture.)
      if (floor !== null) for (const w of wanted) {
        if (w.ring > 0 || baked.has(key(w.cx, w.cz))) continue;
        const s = chunk(w.cx, w.cz);
        const fv: GroundView = { yaw: v.yaw, pitch: v.pitch, pixelsPerMetre: floor };
        const lit = s.layers.light.some((x) => x !== 255);
        const surface = groundSurface({ biomes, biome: s.layers.biome, ...(lit ? { light: s.layers.light } : {}) });
        const L = bakeChunk({ terrain: s.terrain, auto: autoTile(s.terrain), chunk: 0, rect: [APRON, APRON, APRON + C, APRON + C], origin: [s.layers.i0, s.layers.j0], view: fv, palette, style, surface, seed });
        baked.set(key(w.cx, w.cz), { bakeKey: bakeKeyOf(s, fv), layer: L, k: floor });
        bakedN += 1; bakeMs += L.stats.ms;
      }
      return wanted.filter((w) => w.ring === 0).map((w) => [w.cx, w.cz] as [number, number]);
    },
    bake(ms) {
      if (!view) return 0;
      const until = performance.now() + ms;
      let done = 0;
      for (let first = true; first || performance.now() < until; first = false) {
        if (!job) {
          // The next chunk whose layer is missing or stale, visible ones first.
          let next: { cx: number; cz: number } | null = null, nextKey = "";
          for (const w of wanted) {
            const s = chunks.get(key(w.cx, w.cz));
            if (!s) { next = w; break; }
            const bk = bakeKeyOf(s, view);
            const have = baked.get(key(w.cx, w.cz));
            if (!have || have.bakeKey !== bk) { next = w; nextKey = bk; break; }
          }
          if (!next) break;
          const s = chunk(next.cx, next.cz);
          if (!nextKey) nextKey = bakeKeyOf(s, view);
          const lit = s.layers.light.some((v) => v !== 255);
          const surface = groundSurface({ biomes, biome: s.layers.biome, ...(lit ? { light: s.layers.light } : {}) });
          job = { cx: next.cx, cz: next.cz, bakeKey: nextKey, k: view.pixelsPerMetre, work: chunkBakeJob({ terrain: s.terrain, auto: autoTile(s.terrain), chunk: 0, rect: [APRON, APRON, APRON + C, APRON + C], origin: [s.layers.i0, s.layers.j0], view: { yaw: view.yaw, pitch: view.pitch, pixelsPerMetre: view.pixelsPerMetre }, palette, style, surface, seed }) };
          if (performance.now() >= until) break;
        }
        const left = until - performance.now();
        if (!job.work.step(Math.max(0.5, left))) break;
        const L = job.work.result();
        baked.set(key(job.cx, job.cz), { bakeKey: job.bakeKey, layer: L, k: job.k });
        bakedN += 1; bakeMs += L.stats.ms; lastBakeMs = L.stats.ms;
        done += 1;
        job = null;
      }
      return done;
    },
    layers() {
      if (!view) return [];
      const out: LayerToDraw[] = [];
      for (const w of wanted) {
        if (w.ring > 0) continue;
        const b = baked.get(key(w.cx, w.cz));
        // (A stale layer -- another scale, an old paint -- stands in until its rebake lands.)
        if (b) out.push({ key: b.bakeKey, layer: b.layer, chunk: w.cx * 65536 + w.cz, k: b.k });
      }
      return out;
    },
    paint(tiles, name) {
      const b = table.index(name);
      const touched = new Map<string, [number, number]>();
      for (const [i, j] of tiles) {
        const ty = groundTypeAt(table, types, b, i, j, groundSeed);
        // (The chunks holding the tile: its own and, within the apron, its neighbours.)
        for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const cx = Math.floor((i + dx * APRON) / C), cz = Math.floor((j + dz * APRON) / C);
          const s = chunks.get(key(cx, cz));
          if (!s) continue;
          const L = s.layers;
          const li = i - L.i0, lj = j - L.j0;
          if (li < 0 || lj < 0 || li >= L.w || lj >= L.d) continue;
          const k = lj * L.w + li;
          // (Water, walls and paving keep theirs: creep crawls over the land.)
          if (L.water[k] !== -32768 && L.water[k]! > L.height[k]!) continue;
          if (types.get(L.type[k]!).cost === 0 || ["road", "path", "flagstone"].includes(types.get(L.type[k]!).name)) continue;
          L.type[k] = ty; L.biome[k] = b;
          s.terrain.type[k] = ty;
          s.version += 1;
          touched.set(key(cx, cz), [cx, cz]);
        }
        overlay.set(`${i},${j}`, { type: ty, biome: b });
        painted += 1;
      }
      // (Each touched chunk's hash once, after all its tiles: its bake key moves, and it rebakes.)
      for (const kk of touched.keys()) { const s = chunks.get(kk)!; const L = s.layers; s.hash = hashLayers(L, L.i0, L.j0, L.i0 + L.w, L.j0 + L.d); }
      return [...touched.values()];
    },
    biomeAt(i, j) {
      const o = overlay.get(`${i},${j}`);
      if (o) return o.biome;
      const s = chunks.get(key(Math.floor(i / C), Math.floor(j / C)));
      if (s) { const L = s.layers; return L.biome[(j - L.j0) * L.w + (i - L.i0)]!; }
      return stream.overworld ? stream.overworld.column(i, j).biome : 0;
    },
    get ready() { return !!view && wanted.every((w) => w.ring > 0 || (chunks.has(key(w.cx, w.cz)) && baked.get(key(w.cx, w.cz))?.bakeKey === bakeKeyOf(chunks.get(key(w.cx, w.cz))!, view!))); },
    get stats() { return { generated, genMs, baked: bakedN, bakeMs, lastBakeMs, queued: wanted.filter((w) => { const s = chunks.get(key(w.cx, w.cz)); return !s || !view || baked.get(key(w.cx, w.cz))?.bakeKey !== bakeKeyOf(s, view); }).length, layers: baked.size, painted }; },
  };
  return api;
}
