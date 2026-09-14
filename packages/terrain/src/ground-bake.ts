// The ground's bake plan: which chunk layers a view needs, their keys, their
// priorities, and a baker that works through them a slice a frame -- through
// @keel-engine/bake's sprite cache (a layer is a BakedSprite: its texels are
// the ground's indexed texels, its anchor the world origin's pixel) and bake
// queue, as the BACKGROUND tier: visible chunks first, nearest the view's
// middle first, then a ring round the view (prefetch).
//
//   key  ground|<terrain>|<chunk>|<hash of the chunk and two tiles round>|k<px/m>|p<pitch>|y<yaw>|<style>|<palette>|<extras>
//
// Everything that changes a layer's texels is in its key, so an edited
// chunk gets a new key (and its old layer is dropped), an untouched one keeps
// its bake, and a layer at another scale stands in -- drawn scaled -- while
// the new scale bakes (multi-scale, as examples/army does for units).

import { createBakeQueue, createSpriteCache } from "@keel-engine/bake";
import type { BakeQueue, BakeTier, BakedSprite, SpriteCache, SpriteJob } from "@keel-engine/bake";
import { hashTiles } from "./grid.ts";
import type { Terrain } from "./grid.ts";
import { autoTile } from "./autotile.ts";
import type { AutoTiles } from "./autotile.ts";
import { chunkBakeJob, depthRefOf, depthStepOf, groundStyleKey, viewAxes } from "./ground.ts";
import type { ChunkBakeJob, GroundExtra, GroundLayer, GroundStyle, GroundView } from "./ground.ts";
import type { GroundPalette } from "./palette.ts";
import { hashText } from "./palette.ts";
import { hashBiome } from "./surface.ts";
import type { GroundSurface } from "./surface.ts";

/**
 * The streaming loader's tiers (@keel-engine/bake's BakeTier: main, what the
 * player needs now; foreground, units and props on screen; background -- the
 * ground). The sprite stream orders sprite slots by tier; the ground's layers
 * are chunk bitmaps, not sprite slots, so they go through the bake queue with
 * the tier as a band of its numeric priority (tierPriority), and take the
 * frame budget's slice (createFrameBudget) after the sprite stream's.
 */
export const TIERS: Readonly<Record<BakeTier, number>> = { main: 2, foreground: 1, background: 0 };
export type Tier = BakeTier;
const TIER_SPAN = 1e9;
export const tierPriority = (tier: Tier, p: number): number => TIERS[tier] * TIER_SPAN + Math.max(-TIER_SPAN / 2 + 1, Math.min(TIER_SPAN / 2 - 1, p));

/** A chunk layer to bake: a sprite job (so the bake queue and cache take it) with its chunk. */
export interface GroundJob extends SpriteJob {
  readonly tier: BakeTier & "background";
  readonly chunk: number;
  readonly hash: number;
  readonly yaw: number;
}

const f4 = (v: number): string => v.toFixed(4);

/** A chunk layer's key (a surface adds its key and the chunk's biome hash: `surfaceChunkKey`). */
export function groundKey(t: Terrain, chunk: number, view: GroundView, style: GroundStyle, paletteKey: string, extrasKey = "", surfaceKey = ""): string {
  const [i0, j0, i1, j1] = t.chunkRect(chunk);
  const h = hashTiles(t, i0 - 2, j0 - 2, i1 + 2, j1 + 2);
  return `ground|${t.id}|${chunk}|${h.toString(36)}|k${view.pixelsPerMetre}|p${f4(view.pitch)}|y${f4(view.yaw)}|${groundStyleKey(style)}|${paletteKey}|${extrasKey}${surfaceKey ? `|${surfaceKey}` : ""}`;
}

/** The part of a chunk's key a surface makes: its key and the biome map round the chunk. */
export function surfaceChunkKey(t: Terrain, chunk: number, surface: GroundSurface | null): string {
  if (!surface) return "";
  const [i0, j0, i1, j1] = t.chunkRect(chunk);
  return `${surface.key}.${hashBiome(t, surface.biome, i0 - 2, j0 - 2, i1 + 2, j1 + 2, surface.light ?? null).toString(36)}`;
}

/** A chunk layer's job. */
export function groundJob(t: Terrain, chunk: number, view: GroundView, style: GroundStyle, paletteKey: string, extrasKey = "", surfaceKey = ""): GroundJob {
  const [i0, j0, i1, j1] = t.chunkRect(chunk);
  const key = groundKey(t, chunk, view, style, paletteKey, extrasKey, surfaceKey);
  const hash = hashTiles(t, i0 - 2, j0 - 2, i1 + 2, j1 + 2);
  const size = (i1 - i0) * t.tileSize * view.pixelsPerMetre;
  return {
    key, design: `ground:${t.id}:${chunk}`, clip: "ground", frame: 0, direction: 0, angle: 0, w: Math.ceil(size), h: Math.ceil(size * Math.sin(view.pitch)),
    pixelsPerMetre: view.pixelsPerMetre, pitch: view.pitch, style: groundStyleKey(style), tier: "background", chunk, hash, yaw: view.yaw,
  };
}

/** The chunks a ground rectangle [x0, z0, x1, z1] (metres) touches, padded by `pad` chunks; each with its distance (metres) from a point. */
export function chunksIn(t: Terrain, rect: readonly [number, number, number, number], pad = 0, from: readonly [number, number] = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2]): Array<{ chunk: number; dist: number; ring: number }> {
  const cs = t.chunk * t.tileSize;
  const out: Array<{ chunk: number; dist: number; ring: number }> = [];
  const a0 = Math.floor(rect[0] / cs), a1 = Math.floor(rect[2] / cs), b0 = Math.floor(rect[1] / cs), b1 = Math.floor(rect[3] / cs);
  for (let cj = Math.max(0, b0 - pad); cj <= Math.min(t.chunksZ - 1, b1 + pad); cj += 1) for (let ci = Math.max(0, a0 - pad); ci <= Math.min(t.chunksX - 1, a1 + pad); ci += 1) {
    const ring = Math.max(0, a0 - ci, ci - a1, b0 - cj, cj - b1);
    out.push({ chunk: cj * t.chunksX + ci, dist: Math.hypot((ci + 0.5) * cs - from[0], (cj + 0.5) * cs - from[1]), ring });
  }
  return out.sort((x, y) => x.ring - y.ring || x.dist - y.dist || x.chunk - y.chunk);
}

/** A chunk's priority in the background tier: visible ones by nearness, then the prefetch ring. */
export const groundPriority = (dist: number, ring: number): number => tierPriority("background", ring === 0 ? 1e6 - dist : 1e3 - ring * 100 - dist * 0.01);

/**
 * The ground rectangle (metres) a picture shows, allowing for the terrain's
 * height: a cliff below the picture's bottom edge rises into it, and ground
 * above its top edge can be lower (and so show). `lo`, `hi`: the terrain's
 * lowest and highest ground (metres).
 */
export function groundRectFor(view: { readonly center: readonly [number, number, number]; readonly yaw: number; readonly pitch: number; readonly pixelsPerMetre: number; readonly width: number; readonly height: number }, lo: number, hi: number): [number, number, number, number] {
  const a = viewAxes(view);
  const cs: Array<[number, number]> = [];
  for (const [px, py] of [[0, 0], [view.width, 0], [0, view.height], [view.width, view.height]] as const) {
    for (const y of [lo, hi]) {
      // (The pixel's ray meets the plane at height y.)
      const u = (px - view.width / 2) / view.pixelsPerMetre, v = (view.height / 2 - py) / view.pixelsPerMetre;
      const o = [view.center[0] + a.right[0] * u + a.up[0] * v, view.center[1] + a.up[1] * v, view.center[2] + a.right[2] * u + a.up[2] * v];
      const tt = (y - o[1]!) / a.forward[1];
      cs.push([o[0]! + a.forward[0] * tt, o[2]! + a.forward[2] * tt]);
    }
  }
  return [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))];
}

/** A layer as the bake cache holds it (and back). */
export const spriteOfLayer = (key: string, L: GroundLayer): BakedSprite => ({ key, w: L.w, h: L.h, ax: -L.gx0, ay: -L.gy0, rgba: L.data });
export function layerOfSprite(t: Terrain, s: BakedSprite, chunk: number, view: GroundView): GroundLayer {
  return { chunk, w: s.w, h: s.h, gx0: -s.ax, gy0: -s.ay, data: s.rgba, depthRef: depthRefOf(t, chunk, viewAxes(view)), depthStep: depthStepOf(t), stats: { faces: 0, texels: s.w * s.h, covered: 0, ms: 0 } };
}

/** A layer to draw: its bytes and the scale it was baked at (draw it at view k / that). */
export interface LayerToDraw {
  readonly key: string;
  readonly layer: GroundLayer;
  readonly chunk: number;
  /** Pixels a metre it was baked at. */
  readonly k: number;
}

export interface GroundBakerOptions {
  readonly terrain: Terrain;
  readonly palette: GroundPalette;
  readonly style: GroundStyle;
  /** Boxes and wedges baked into a chunk's layer (bridges, buildings), and a key that changes when they do. */
  readonly extras?: ((chunk: number) => readonly GroundExtra[]) | null;
  readonly extrasKey?: (chunk: number) => string;
  /** Share a sprite cache (default: a new one). */
  readonly cache?: SpriteCache;
  /** Chunks round the view to bake ahead (default 1). */
  readonly prefetch?: number;
  /** Scales kept besides the one shown (default 2). */
  readonly keepScales?: number;
  readonly seed?: number;
  /** The surface (surface.ts): blended materials, biomes, decals. Its palette must be a surfacePalette. */
  readonly surface?: GroundSurface | null;
  /**
   * A floor scale (px/m, e.g. 2): every chunk's layer at it, baked before anything else (bakeFloor() at load, or the
   * queue's first jobs) and never dropped -- the stand-in of last resort, so no zoom, pan or pitch change ever shows a
   * chunk with nothing (only coarser). Default none.
   */
  readonly floor?: number | null;
}

export interface GroundBaker {
  readonly cache: SpriteCache;
  readonly queue: BakeQueue<GroundJob>;
  readonly auto: AutoTiles;
  style: GroundStyle;
  /** The surface: set a new one (a biome swap's, a re-skin) and the chunks whose keys change rebake. */
  surface: GroundSurface | null;
  /** The palette: a season's colours for the same layout need no bake (the renderer's setPalette); a new layout rebakes. */
  palette: GroundPalette;
  /** Plan for a view: enqueue what's missing, prioritise what's visible. Returns the visible chunks. */
  plan(view: GroundView & { readonly center: readonly [number, number, number]; readonly width: number; readonly height: number }): number[];
  /** Bake for up to `ms` milliseconds: layers finished. */
  bake(ms: number): number;
  /** What to draw for the planned view: each visible chunk's layer at its scale, or the nearest scale baked. */
  layers(): LayerToDraw[];
  /** Is every visible chunk baked at the view's own scale? */
  readonly ready: boolean;
  readonly stats: { readonly baked: number; readonly ms: number; readonly queued: number; readonly layers: number; readonly bytes: number; readonly lastMs: number };
  /** Take in a terrain change (auto-tiles refreshed; keys follow the tiles, so stale layers go on the next plan). */
  refresh(rect?: readonly [number, number, number, number]): void;
  /** Bake the floor scale's layer of every chunk now, for `view`'s pitch and yaw (load time): layers baked. */
  bakeFloor(view: GroundView): number;
  /** Every visible chunk has SOME layer to draw (its own scale, a stand-in, the floor)? */
  readonly covered: boolean;
}

export function createGroundBaker({ terrain: t, palette: palette0, style: style0, extras = null, extrasKey = () => "", cache = createSpriteCache(), prefetch = 1, keepScales = 2, seed = 0, surface: surface0 = null, floor = null }: GroundBakerOptions): GroundBaker {
  let surface = surface0;
  let palette = palette0;
  const queue = createBakeQueue<GroundJob>();
  const auto = autoTile(t, { seed });
  let style = style0;
  const layers = new Map<string, GroundLayer>(); // key -> layer
  const current = new Map<string, string>(); // `${chunk}|${k}` -> the key baked for it (a later one drops it)
  let view: (GroundView & { readonly center: readonly [number, number, number]; readonly width: number; readonly height: number }) | null = null;
  let visible: number[] = [];
  let wanted = new Map<number, GroundJob>();
  let job: { job: GroundJob; work: ChunkBakeJob } | null = null;
  let baked = 0, total = 0, lastMs = 0;
  const recentScales: number[] = [];
  let lo = 0, hi = 0;
  const bounds = (): void => { let a = Infinity, b = -Infinity; for (let k = 0; k < t.height.length; k += 1) { const h = t.height[k]!; if (h < a) a = h; if (h > b) b = h; } lo = (a - 2) * t.stepHeight; hi = (b + 2) * t.stepHeight + 12; };
  bounds();
  let seenVersion = t.version;
  let pending: [number, number, number, number] | null = null;

  const viewOf = (j: GroundJob): GroundView => ({ yaw: j.yaw, pitch: j.pitch, pixelsPerMetre: j.pixelsPerMetre });
  const bakedAt = new Map<string, number>();
  let bakeSeq = 0;
  const store = (key: string, L: GroundLayer, chunk: number, k: number): void => {
    layers.set(key, L);
    cache.add([spriteOfLayer(key, L)]);
    bakedAt.set(key, ++bakeSeq);
    const slot = `${chunk}|${k}`;
    const old = current.get(slot);
    if (old && old !== key) { layers.delete(old); cache.drop((kk) => kk === old); bakedAt.delete(old); }
    current.set(slot, key);
  };
  const api: GroundBaker = {
    cache, queue, auto,
    get style() { return style; },
    set style(s) { style = s; },
    get surface() { return surface; },
    set surface(s) { surface = s; },
    get palette() { return palette; },
    set palette(p) { palette = p; },
    plan(v) {
      if (pending) { const p = pending; pending = null; api.refresh(p); }
      else if (t.version !== seenVersion) api.refresh();
      view = v;
      if (!recentScales.includes(v.pixelsPerMetre)) { recentScales.push(v.pixelsPerMetre); if (recentScales.length > keepScales + 1) recentScales.shift(); }
      const rect = groundRectFor(v, lo, hi);
      const list = chunksIn(t, rect, prefetch, [v.center[0], v.center[2]]);
      visible = list.filter((c) => c.ring === 0).map((c) => c.chunk);
      wanted = new Map();
      queue.clear((j) => j.pixelsPerMetre !== v.pixelsPerMetre || j.yaw !== v.yaw || j.pitch !== v.pitch || j.style !== groundStyleKey(style));
      for (const { chunk, dist, ring } of list) {
        const j = groundJob(t, chunk, v, style, palette.key, extrasKey(chunk), surfaceChunkKey(t, chunk, surface));
        wanted.set(chunk, j);
        if (layers.has(j.key) || (job && job.job.key === j.key)) continue;
        if (!queue.has(j.key)) queue.enqueue([j], groundPriority(dist, ring));
        queue.prioritise(j.design, groundPriority(dist, ring));
      }
      // (Queued layers of chunks the view has left, or of old tiles, go.)
      queue.clear((j) => wanted.get(j.chunk)?.key !== j.key);
      // Scales nobody looks at any more go -- but never the floor's, nor a chunk's last layer at this pitch (a fast zoom
      // through five rungs must not leave a chunk with nothing while its new scale bakes: the last complete layer stays).
      const lastOf = new Map<number, { key: string; at: number }>();
      for (const [key, L] of layers) {
        if (!key.includes(`|p${f4(v.pitch)}|y${f4(v.yaw)}|`)) continue;
        const at = bakedAt.get(key) ?? 0;
        const have = lastOf.get(L.chunk);
        if (!have || at > have.at) lastOf.set(L.chunk, { key, at });
      }
      for (const [key, L] of layers) {
        const k = Number(/\|k([\d.]+)\|/.exec(key)?.[1] ?? 0);
        if (recentScales.includes(k) || k === floor || lastOf.get(L.chunk)?.key === key) continue;
        layers.delete(key); cache.drop((kk) => kk === key); current.delete(`${L.chunk}|${k}`); bakedAt.delete(key);
      }
      return visible;
    },
    bake(ms) {
      const until = performance.now() + ms;
      let finished = 0;
      // (At least one slice, however short the budget.)
      for (let first = true; first || performance.now() < until; first = false) {
        if (!job) {
          const next = queue.take(1)[0];
          if (!next) break;
          job = { job: next, work: chunkBakeJob({ terrain: t, auto, chunk: next.chunk, view: viewOf(next), palette, style, extras: extras ? extras(next.chunk) : [], seed, ...(surface ? { surface } : {}) }) };
        }
        const left = until - performance.now();
        if (!job.work.step(Math.max(0.5, left))) break;
        const L = job.work.result();
        const key = job.job.key;
        store(key, L, job.job.chunk, job.job.pixelsPerMetre);
        baked += 1; total += L.stats.ms; lastMs = L.stats.ms;
        finished += 1;
        job = null;
      }
      return finished;
    },
    layers() {
      if (!view) return [];
      const out: LayerToDraw[] = [];
      for (const chunk of visible) {
        const want = wanted.get(chunk);
        if (want && layers.has(want.key)) { out.push({ key: want.key, layer: layers.get(want.key)!, chunk, k: view.pixelsPerMetre }); continue; }
        // (Another scale of this chunk stands in -- the nearest one, the newest bake for it.)
        let best: { key: string; k: number } | null = null;
        for (const [slot, key] of current) {
          const [c, kk] = slot.split("|");
          if (Number(c) !== chunk || !layers.has(key)) continue;
          const k = Number(kk);
          if (!best || Math.abs(Math.log(k / view.pixelsPerMetre)) < Math.abs(Math.log(best.k / view.pixelsPerMetre))) best = { key, k };
        }
        if (best && best.key.includes(`|p${f4(view.pitch)}|y${f4(view.yaw)}|`)) out.push({ key: best.key, layer: layers.get(best.key)!, chunk, k: best.k });
      }
      return out;
    },
    get ready() { return visible.every((c) => { const w = wanted.get(c); return !!w && layers.has(w.key); }); },
    get covered() { const n = api.layers().length; return n >= visible.length; },
    bakeFloor(v) {
      if (floor === null) return 0;
      let n = 0;
      const fv: GroundView = { yaw: v.yaw, pitch: v.pitch, pixelsPerMetre: floor };
      for (let c = 0; c < t.chunksX * t.chunksZ; c += 1) {
        const j = groundJob(t, c, fv, style, palette.key, extrasKey(c), surfaceChunkKey(t, c, surface));
        if (layers.has(j.key)) continue;
        const L = chunkBakeJob({ terrain: t, auto, chunk: c, view: fv, palette, style, extras: extras ? extras(c) : [], seed, ...(surface ? { surface } : {}) });
        while (!L.step(Infinity));
        store(j.key, L.result(), c, floor);
        n += 1;
      }
      return n;
    },
    get stats() { return { baked, ms: total, queued: queue.size(), layers: layers.size, bytes: cache.bytes, lastMs }; },
    refresh(rect) {
      const r = rect ?? [0, 0, t.width, t.depth];
      autoTile(t, { rect: [r[0] - 2, r[1] - 2, r[2] + 3, r[3] + 3], into: auto, seed });
      bounds();
      seenVersion = t.version;
    },
  };
  // (Edits refresh the auto-tiles round what changed, on the next plan: a burst of edits is one refresh.)
  t.onChange((c) => { pending = pending ? [Math.min(pending[0], c.rect[0]), Math.min(pending[1], c.rect[1]), Math.max(pending[2], c.rect[2]), Math.max(pending[3], c.rect[3])] : [...c.rect]; });
  return api;
}

/** A hash of a chunk's extras (what extrasKey should return when they're computed). */
export const extrasHash = (list: readonly GroundExtra[]): string => (list.length ? hashText(JSON.stringify(list)) : "");
