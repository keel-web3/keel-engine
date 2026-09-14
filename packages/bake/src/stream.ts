// The streaming bake: what the game shows is baked first, the rest while it
// plays, and the game never waits for a whole scale. A sprite stream holds
// every sprite a game's designs can show -- each (design, clip, frame,
// direction) a SLOT, at every scale on the zoom ladder -- which of them are
// baked, where they sit in a live atlas, and what to bake next.
//
// Each frame the game marks the slots it draws (`seen[slot] = stream.stamp`,
// one typed-array write a layer) and, now and then, the slots of units just
// outside the view (`near`). The stream turns those marks into an order, fresh
// every frame (sooner first):
//
//   visible now          the exact frames and directions on screen (mains, then foreground, then background)
//   preload, mains       the preload set (preload()); every clip, frame and direction of a MAIN design
//   mains, neighbours    the same, one zoom step in and out
//   foreground (background a step and a half behind, each by weight):
//     a  the visible units' other frames of the clip they're in
//     b  their other directions
//     c  units just outside the view (the game widens toward where the camera is going)
//     d  the clips they'll likely play next (a clip's neighbours in its design's list: idle, walk, run)
//     e  the neighbouring zoom levels, for what's on screen
//     f  everything else in the population at this scale, the least recently seen last
//     g  the rest of the neighbouring levels (only while memory allows)
//
// A scale change is debounced: wheel through five levels and only the one you
// settle on (after `dwell` ms) is baked; the old target keeps baking meanwhile.
// While a sprite isn't baked, `resolve()` picks a stand-in -- the nearest
// frame of the same clip and direction at this scale, else the same sprite at
// the nearest LARGER scale (drawn smaller), else a smaller one no more than
// `upscale` times (a hat blown up four times is a box: better no hat than a
// box), else nothing -- into a lookup the game draws from.
//
// Memory: sprites go into a shelf atlas (shelf.ts) the moment they're baked;
// when it's full, whole (scale, design) groups are evicted -- background first,
// mains last, the least recently drawn first, never anything drawn in the last
// frames.
//
//   const stream = createSpriteStream({ designs, ladder: [8, 12, 16, 24, 32], onPages, onWrite });
//   stream.setScale(24, now);
//   each frame:  stream.begin(now);  ...draw: stream.seen[slot] = stream.stamp; stream.lut[slot * STREAM_LUT + ...]...
//                stream.update(now); for (const job of stream.take(n)) ...bake...; stream.put(job, sprite);

import type { BakedSprite } from "./bake.ts";
import type { DesignSpec, SpriteJob } from "./plan.ts";
import { spriteBox, spriteKey } from "./plan.ts";
import { createShelfAtlas } from "./shelf.ts";
import type { ShelfAtlas, ShelfRect } from "./shelf.ts";

// ---------------------------------------------------------------- tiers

/** How much a design matters to the picture: mains are always ready, background may wait. */
export type BakeTier = "main" | "foreground" | "background";
export const BAKE_TIERS: readonly BakeTier[] = ["main", "foreground", "background"];

/** What the stream can infer a design's tier from when nobody said. */
export interface TierHints {
  /** A player controls it (their hero, their units): main. */
  readonly player?: boolean;
  /** How many of it the game shows (1: a hero, a boss, a landmark -- main). */
  readonly count?: number;
  /** What it is: a unit (foreground), a worn thing (as its wearers), a prop or ambient scenery (background). */
  readonly kind?: "entity" | "attribute" | "prop" | "ambient";
  /** Its id and tags, for settings by id and by tag. */
  readonly id?: string;
  readonly tags?: readonly string[];
}

/**
 * Anything that resolves a setting for a thing -- @keel-engine/world's Settings fits as it is, so a tier can be set
 * (and locked) per scene, per tag or per id: "bake.tier" ("main" | "foreground" | "background") and "bake.weight".
 */
export interface TierSettings {
  get(key: string, thing?: { readonly id: string; readonly tags?: readonly string[] | undefined } | null): unknown;
  locked?(key: string, thing?: { readonly id: string; readonly tags?: readonly string[] | undefined } | null): boolean;
}

export interface StreamDesign {
  readonly spec: DesignSpec;
  /** Its tier, if the game says (else settings, else inferred). */
  readonly tier?: BakeTier;
  /** Its weight within its tier, 0..1 (default 0.5): higher bakes sooner. */
  readonly weight?: number;
  readonly hints?: TierHints;
  /** How far a smaller scale's bake may be blown up to stand in for it (default: the stream's `upscale`). */
  readonly upscale?: number;
  /**
   * The largest scale it's baked at (px/m; default: any). Closer than that it's drawn from that bake, blown up --
   * background things (trees, props) needn't cost a close zoom's bakes, and a thing too big to bake that close still
   * shows.
   */
  readonly maxScale?: number;
}

export interface ResolvedTier { readonly tier: BakeTier; readonly weight: number; readonly from: "design" | "settings" | "inferred" }

const isTier = (v: unknown): v is BakeTier => v === "main" || v === "foreground" || v === "background";

/**
 * A design's tier and weight. A LOCKED setting wins; then the design's own field; then a setting; then what the
 * hints say -- a player's or a one-of-a-kind unit is main, props and scenery are background (so is anything that
 * stands still: one frame of one clip, the same from every side), everything else foreground.
 */
export function inferTier(d: StreamDesign, settings?: TierSettings): ResolvedTier {
  const thing = { id: d.hints?.id ?? d.spec.key, tags: d.hints?.tags ?? [] };
  const setTier = settings?.get("bake.tier", thing);
  const setWeight = settings?.get("bake.weight", thing);
  const weightOf = (w: unknown) => (typeof w === "number" && Number.isFinite(w) ? Math.max(0, Math.min(1, w)) : undefined);
  const w = weightOf(setWeight) ?? d.weight ?? 0.5;
  if (isTier(setTier) && settings?.locked?.("bake.tier", thing)) return { tier: setTier, weight: weightOf(setWeight) ?? d.weight ?? 0.5, from: "settings" };
  if (d.tier) return { tier: d.tier, weight: d.weight ?? weightOf(setWeight) ?? 0.5, from: "design" };
  if (isTier(setTier)) return { tier: setTier, weight: w, from: "settings" };
  const h = d.hints ?? {};
  const still = !!d.spec.symmetric && d.spec.clips.every((c) => c.frames <= 1);
  const tier: BakeTier = h.player || (h.count === 1 && h.kind !== "prop" && h.kind !== "ambient") ? "main"
    : h.kind === "prop" || h.kind === "ambient" || still ? "background" : "foreground";
  return { tier, weight: w, from: "inferred" };
}

// ---------------------------------------------------------------- the stream

/**
 * Floats a slot takes in the lookup: x, y, w, h (atlas texels), ax, ay (anchor), page, the scale it was baked at
 * (0: nothing to draw), and the frame it shows (a stand-in may be another frame of the clip: what's worn on the body
 * goes where that frame's sockets are).
 */
export const STREAM_LUT = 9;

/** A job the stream hands out: a sprite job, and where it goes back to. */
export interface StreamJob extends SpriteJob {
  readonly slot: number;
  /** Its place in the order when it was taken (lower: wanted sooner). */
  readonly rank: number;
  readonly epoch: number;
}

/** What to bake before play (loading screen): see preload(). */
export interface PreloadSpec {
  /** Tiers baked completely -- every clip, frame and direction (default ["main"]). */
  readonly full?: readonly BakeTier[];
  /** Which designs get the opening set: every design (default) or only those the opening view shows. */
  readonly designs?: "all" | "visible";
  /** Frames of each clip: the first of each, in every direction (default), or all of them. */
  readonly frames?: "first" | "all";
  /** Clips: all (default) or these names. */
  readonly clips?: "all" | readonly string[];
  /** Scales: the starting one (default), or it and one step either side. */
  readonly scales?: "start" | "neighbours";
  /** Every frame of each clip and direction the opening view shows (default true): what's on screen animates at once. */
  readonly visibleClips?: boolean;
}

export interface SpriteStreamOptions {
  readonly designs: readonly StreamDesign[];
  /** The zoom ladder: pixels per metre, ascending. */
  readonly ladder: readonly number[];
  readonly directions?: number;
  readonly pitch?: number;
  /** A design's style string at a scale (part of its keys; default ""). */
  readonly style?: (spec: DesignSpec, pixelsPerMetre: number) => string;
  /** How long a new scale must hold before it's baked (ms; default 90). */
  readonly dwell?: number;
  readonly settings?: TierSettings;
  /** Clips a design is likely to play next after clip `c` (default: its neighbours in the design's list). */
  readonly soonClips?: (spec: DesignSpec, clip: number) => readonly number[];
  /** How far a smaller scale may be blown up to stand in (default 2). */
  readonly upscale?: number;
  /** Texture memory for sprites, bytes (default 256 MB), and the atlas page side (default 2048). */
  readonly memory?: number;
  readonly pageSize?: number;
  /** The atlas opened pages: the texture array needs this many layers of `size`². */
  readonly onPages?: (pages: number, size: number) => void;
  /** A sprite's texels go here (upload them). */
  readonly onWrite?: (rect: ShelfRect, rgba: Uint8Array) => void;
}

export interface StreamStats {
  readonly view: number;
  readonly target: number;
  readonly pending: number;
  readonly slots: number;
  /** Sprites baked, per scale. */
  readonly baked: Readonly<Record<number, number>>;
  readonly inFlight: number;
  /** Jobs waiting in the order, and how many of them are for what's visible now. */
  readonly queued: number;
  readonly visibleMissing: number;
  readonly pages: number;
  readonly bytes: number;
  readonly used: number;
  readonly evictions: number;
  readonly full: boolean;
  readonly preload: { readonly done: number; readonly total: number };
}

export interface SpriteStream {
  readonly slots: number;
  readonly designs: number;
  readonly ladder: readonly number[];
  /** Write `stamp` at a slot the frame draws. */
  readonly seen: Uint32Array;
  /** Write `stamp` at a slot of a unit just outside the view. */
  readonly near: Uint32Array;
  /** This frame's stamp (begin() moves it on). */
  readonly stamp: number;
  /** Per slot: STREAM_LUT floats (see there); and 1 where it's the exact sprite at the view's scale. */
  readonly lut: Float32Array;
  readonly exact: Uint8Array;
  /** The first slot of each design, and of each of its clips (clipBase(d, c) + frame * directions(d) + direction). */
  readonly base: Int32Array;
  clipBase(design: number, clip: number): number;
  directions(design: number): number;
  slotOf(design: number, clip: number, frame: number, direction: number): number;
  tierOf(design: number): ResolvedTier;
  /** The view's scale (pixels per metre) and the one being baked for. */
  readonly scale: number;
  readonly target: number;
  setScale(pixelsPerMetre: number, now: number): void;
  /** A new frame: moves the stamp on, and resolves the lookup if anything changed. */
  begin(now: number): number;
  /** Re-order: settle the scale, read the marks, sort what's missing. */
  update(now: number): void;
  /** Up to `n` jobs, the most wanted first (and in flight until put or cancelled). `maxRank`: take nothing ranked above it. */
  take(n: number, maxRank?: number): StreamJob[];
  /** Waiting jobs ranked at or below `maxRank` (all by default). */
  waiting(maxRank?: number): number;
  /** A baked sprite for a job: into the atlas (evicting if it must). False if it was no longer wanted or didn't fit. */
  put(job: StreamJob, sprite: BakedSprite): boolean;
  /** A job that won't be baked after all. */
  cancel(job: StreamJob): void;
  /** Is this in-flight job still wanted (its scale still the target or next to it, its epoch current)? */
  wanted(job: StreamJob): boolean;
  /** Fill the lookup now (begin() does it when something changed). True if it changed. */
  resolve(): boolean;
  /** Mark the preload set (after a frame's marks: the opening view): its size. */
  preload(spec?: PreloadSpec): number;
  readonly preloading: { readonly done: number; readonly total: number };
  /** Is this slot baked at this scale? */
  has(slot: number, pixelsPerMetre: number): boolean;
  /** Cheap, every frame: slots the last frame drew that aren't baked at the target yet, and jobs left in the order. */
  readonly missingVisible: number;
  readonly backlog: number;
  stats(): StreamStats;
}

let streams = 0;
const RANKS = 23;
const SUBS = 16;
/** Ranks: visible now 0-2 (by tier), preload + mains 3, mains at the neighbours 4, then signals (see the top). */
export const RANK = { visible: 0, preload: 3, mainNeighbour: 4, signals: 5, prefetchFrom: 17 } as const;

export function createSpriteStream(options: SpriteStreamOptions): SpriteStream {
  const { designs: list, ladder, directions = 8, pitch = 0.6, style = () => "", dwell = 90, settings, upscale = 2, memory = 256 * 1048576, pageSize = 2048, onPages, onWrite } = options;
  if (!ladder.length || ladder.some((k, i) => !(k > 0) || (i > 0 && k <= ladder[i - 1]!))) throw new RangeError("The ladder: positive scales, ascending.");
  const L = ladder.length;
  const D = list.length;
  const specs = list.map((d) => d.spec);
  const tiers = list.map((d) => inferTier(d, settings));
  const tier = Uint8Array.from(tiers, (t) => BAKE_TIERS.indexOf(t.tier));
  const wsub = Uint8Array.from(tiers, (t) => 3 - Math.round(t.weight * 3));
  const up = Float32Array.from(list, (d) => d.upscale ?? upscale);
  // (Per design, the highest ladder index it's baked at: past it, nothing is queued and that bake stands in however far it's blown up.)
  const topScale = Int16Array.from(list, (d) => { if (d.maxScale === undefined) return 32767; let t = -1; ladder.forEach((k, i) => { if (k <= d.maxScale! + 1e-9) t = i; }); return Math.max(0, t); });
  const capped = list.map((d) => d.maxScale !== undefined);
  const dirs = Uint8Array.from(specs, (d) => (d.symmetric ? 1 : directions));

  // The layout: design -> clips -> frames -> directions.
  const base = new Int32Array(D + 1);
  const clipStart = new Int32Array(D + 1);
  let S = 0, C = 0;
  specs.forEach((d, i) => { base[i] = S; clipStart[i] = C; S += d.clips.reduce((n, c) => n + c.frames, 0) * dirs[i]!; C += d.clips.length; });
  base[D] = S; clipStart[D] = C;
  const clipOff = new Int32Array(C), clipFrames = new Uint16Array(C);
  const slotDesign = new Int32Array(S), slotClip = new Int32Array(S), slotFrame = new Uint16Array(S), slotDir = new Uint8Array(S), slotGroup = new Int32Array(S);
  let G = 0;
  const groupFirst: number[] = [], groupFrames: number[] = [], groupStride: number[] = [];
  specs.forEach((d, i) => {
    let o = base[i]!;
    d.clips.forEach((c, ci) => {
      const cid = clipStart[i]! + ci;
      clipOff[cid] = o; clipFrames[cid] = c.frames;
      for (let dir = 0; dir < dirs[i]!; dir += 1) { groupFirst.push(o + dir); groupFrames.push(c.frames); groupStride.push(dirs[i]!); }
      for (let f = 0; f < c.frames; f += 1) for (let dir = 0; dir < dirs[i]!; dir += 1) {
        const s = o + f * dirs[i]! + dir;
        slotDesign[s] = i; slotClip[s] = cid; slotFrame[s] = f; slotDir[s] = dir; slotGroup[s] = G + dir;
      }
      G += dirs[i]!;
      o += c.frames * dirs[i]!;
    });
  });
  // Clips likely next: per clip id, a list of clip ids.
  const soon: number[][] = [];
  specs.forEach((d, i) => d.clips.forEach((_, ci) => {
    const next = options.soonClips ? options.soonClips(d, ci) : [ci - 1, ci + 1];
    soon.push(next.filter((c) => c >= 0 && c < d.clips.length && c !== ci).map((c) => clipStart[i]! + c));
  }));

  // Per scale: state (0 missing, 1 in flight, 2 baked), where each baked sprite is, frames baked per group, bytes and last use per design, the preload set.
  const state = Array.from({ length: L }, () => new Uint8Array(S));
  const rects = Array.from({ length: L }, () => new Float32Array(S * 7));
  const groupBaked = Array.from({ length: L }, () => new Uint16Array(G));
  const bytesOf = Array.from({ length: L }, () => new Float64Array(D));
  const usedAt = Array.from({ length: L }, () => new Uint32Array(D));
  const pre = Array.from({ length: L }, () => new Uint8Array(S));
  const bakedCount = new Int32Array(L);
  let preTotal = 0, preDone = 0;
  const boxes = Array.from({ length: L }, (_, si) => specs.map((d) => spriteBox(d, ladder[si]!, pitch)));
  const styles = Array.from({ length: L }, (_, si) => specs.map((d) => style(d, ladder[si]!)));

  const seen = new Uint32Array(S), near = new Uint32Array(S);
  const lut = new Float32Array(S * STREAM_LUT);
  const exact = new Uint8Array(S);
  const lutSrc = new Int8Array(S).fill(-1);
  const groupVis = new Uint32Array(G), nearGroup = new Uint32Array(G), clipVis = new Uint32Array(C), soonVis = new Uint32Array(C);
  // (Stand-in order per view scale: the larger scales nearest first, then the smaller ones nearest first.)
  const pref = ladder.map((k, v) => [...ladder.keys()].filter((i) => i > v).concat([...ladder.keys()].filter((i) => i < v).reverse()));

  const pageBytes = pageSize * pageSize * 4;
  const atlas: ShelfAtlas = createShelfAtlas({ size: pageSize, pages: Math.max(1, Math.floor(memory / pageBytes)) });
  let pagesSeen = 0;
  const epoch = ++streams; // (a job from another stream -- one the game replaced -- is never put into this one)

  const idx = (k: number) => { const i = ladder.indexOf(k); if (i < 0) throw new RangeError(`${k} px/m isn't on the ladder (${ladder.join(", ")}).`); return i; };
  let stamp = 1, view = 0, target = 0, pending = 0, changedAt = -Infinity, started = false;
  let dirty = true, full = false, inFlight = 0, evictions = 0, visibleMissing = 0;
  // (What the lookup must re-resolve: everything -- the view's scale moved -- or only the groups a bake or an eviction
  // touched. A slot's stand-in is always from its own group -- the same clip and direction, at some scale -- so a new
  // sprite can only change the lookup for the slots of its group.)
  let dirtyAll = true;
  const groupDirty = new Uint8Array(G);
  // (The slots of designs with a largest scale: update() queues their top bakes when the view is past it.)
  const capSlots = Int32Array.from({ length: S }, (_, q) => q).filter((q) => capped[slotDesign[q]!]!);
  const dirtyGroups: number[] = [];
  const touch = (g: number): void => { if (!groupDirty[g]) { groupDirty[g] = 1; dirtyGroups.push(g); } dirty = true; };
  const touchAll = (): void => { dirtyAll = true; dirty = true; };
  // The order: pairs (scale * S + slot) by bucket.
  let order = new Int32Array(0), orderRank = new Uint8Array(0), orderLen = 0, cursor = 0;
  const counts = new Int32Array(RANKS * SUBS + 1);
  let tmpBucket = new Uint16Array(0), tmpPair = new Int32Array(0);

  // (`asTarget`: rank it as the target scale is ranked -- a capped design's top bake, when the view is past it.)
  const bucketOf = (si: number, s: number, asTarget = si === target): number => {
    const d = slotDesign[s]!, tr = tier[d]!;
    if (si > topScale[d]!) return -1;
    const bg = tr === 2 ? 3 : 0;
    if (asTarget) {
      if (seen[s] === stamp) return tr * SUBS + wsub[d]! * 4;
      if (pre[si]![s] || tr === 0) return 3 * SUBS + wsub[d]! * 4;
      const g = slotGroup[s]!, c = slotClip[s]!;
      let sig: number;
      if (groupVis[g] === stamp) sig = 0;
      else if (clipVis[c] === stamp) sig = 1;
      else if (nearGroup[g] === stamp) sig = 2;
      else if (soonVis[c] === stamp) sig = 3;
      else {
        if (full) return -1;
        const age = seen[s] ? stamp - seen[s]! : Infinity;
        return (5 + 12 + bg) * SUBS + wsub[d]! * 4 + (age < 120 ? 0 : age < 1200 ? 1 : age === Infinity ? 3 : 2);
      }
      return (5 + 2 * sig + bg) * SUBS + wsub[d]! * 4;
    }
    // A neighbouring scale.
    if (pre[si]![s] || tr === 0) return 4 * SUBS + wsub[d]! * 4;
    if (seen[s] === stamp) return (5 + 8 + bg) * SUBS + wsub[d]! * 4;
    if (groupVis[slotGroup[s]!] === stamp) return (5 + 10 + bg) * SUBS + wsub[d]! * 4;
    if (full) return -1;
    return (5 + 14 + bg) * SUBS + wsub[d]! * 4;
  };

  function evictFor(rank: number): boolean {
    // (Background first, mains last; scales nobody's looking at before the view's and the target's; the least recently drawn first.)
    let best = -1, bestScore = Infinity;
    const onlyOthers = rank >= RANK.signals + 8; // (prefetch never evicts what the view or the target holds)
    for (let si = 0; si < L; si += 1) {
      const wantedScale = si === target || si === view;
      if (onlyOthers && wantedScale) continue;
      for (let d = 0; d < D; d += 1) {
        if (!bytesOf[si]![d]) continue;
        if (usedAt[si]![d]! + 2 >= stamp) continue; // (drawn in the last frames: never)
        const tr = tier[d]!;
        const score = (2 - tr) * 4e9 + (wantedScale ? 2e9 : 0) + usedAt[si]![d]!;
        if (score < bestScore) { bestScore = score; best = si * D + d; }
      }
    }
    if (best < 0) return false;
    const si = Math.floor(best / D), d = best % D;
    const st = state[si]!, r = rects[si]!;
    for (let s = base[d]!; s < base[d + 1]!; s += 1) {
      if (st[s] !== 2) continue;
      atlas.free({ page: r[s * 7 + 6]!, x: r[s * 7]!, y: r[s * 7 + 1]!, w: r[s * 7 + 2]!, h: r[s * 7 + 3]! });
      st[s] = 0; groupBaked[si]![slotGroup[s]!]! -= 1; bakedCount[si]! -= 1;
      if (pre[si]![s]) preDone -= 1;
      touch(slotGroup[s]!);
    }
    bytesOf[si]![d] = 0;
    evictions += 1;
    return true;
  }

  const nearestFrame = (si: number, s: number): number => {
    const g = slotGroup[s]!;
    if (!groupBaked[si]![g]) return -1;
    const n = groupFrames[g]!, first = groupFirst[g]!, stride = groupStride[g]!, f0 = slotFrame[s]!, st = state[si]!;
    for (let o = 1; o < n; o += 1) {
      const a = first + ((f0 + o) % n) * stride; if (st[a] === 2) return a;
      const b = first + ((f0 - o + n * 8) % n) * stride; if (st[b] === 2) return b;
    }
    return -1;
  };

  /** One slot's lookup entry: its own sprite at the view's scale, else a stand-in from its group (see the top). */
  function resolveSlot(s: number): void {
    const k = ladder[view]!;
    const st0 = state[view]!;
    let si = -1, src = -1;
    if (st0[s] === 2) { si = view; src = s; }
    else {
      src = nearestFrame(view, s);
      if (src >= 0) si = view;
      else {
        const d = slotDesign[s]!;
        const p = pref[view]!;
        // (Past its largest scale, its top bake stands in however far it's blown up.)
        const u = view > topScale[d]! ? Math.max(up[d]!, k / ladder[topScale[d]!]!) : up[d]!;
        for (const c of p) { if (ladder[c]! < k && k / ladder[c]! > u + 1e-6) continue; if (state[c]![s] === 2) { si = c; src = s; break; } }
        if (si < 0) for (const c of p) { if (ladder[c]! < k && k / ladder[c]! > u + 1e-6) continue; const f = nearestFrame(c, s); if (f >= 0) { si = c; src = f; break; } }
      }
    }
    const o = s * STREAM_LUT;
    lutSrc[s] = si;
    exact[s] = si === view && src === s ? 1 : 0;
    if (si < 0) { lut[o + 2] = 0; lut[o + 7] = 0; return; }
    const r = rects[si]!, q = src * 7;
    lut[o] = r[q]!; lut[o + 1] = r[q + 1]!; lut[o + 2] = r[q + 2]!; lut[o + 3] = r[q + 3]!; lut[o + 4] = r[q + 4]!; lut[o + 5] = r[q + 5]!; lut[o + 6] = r[q + 6]!; lut[o + 7] = ladder[si]!; lut[o + 8] = slotFrame[src]!;
  }

  const api: SpriteStream = {
    slots: S, designs: D, ladder, seen, near, lut, exact, base,
    get stamp() { return stamp; },
    clipBase: (d, c) => clipOff[clipStart[d]! + c]!,
    directions: (d) => dirs[d]!,
    slotOf: (d, c, f, dir) => clipOff[clipStart[d]! + c]! + f * dirs[d]! + dir,
    tierOf: (d) => tiers[d]!,
    get scale() { return ladder[view]!; },
    get target() { return ladder[target]!; },
    setScale(k, now) {
      const v = idx(k);
      if (!started) { view = target = pending = v; started = true; touchAll(); return; }
      if (v === view) return;
      view = v; touchAll();
      if (v !== pending) { pending = v; changedAt = now; }
    },
    begin(now) {
      stamp += 1;
      if (pending !== target && now - changedAt >= dwell) { target = pending; full = false; }
      if (dirty) api.resolve();
      return stamp;
    },
    update(now) {
      if (pending !== target && now - changedAt >= dwell) { target = pending; full = false; touchAll(); }
      // The marks: visible groups and clips, the clips likely next, groups near the view; and what each drew from.
      visibleMissing = 0;
      for (let s = 0; s < S; s += 1) {
        if (seen[s] === stamp) {
          const g = slotGroup[s]!, c = slotClip[s]!;
          groupVis[g] = stamp;
          if (clipVis[c] !== stamp) { clipVis[c] = stamp; for (const n of soon[c]!) soonVis[n] = stamp; }
          const src = lutSrc[s]!;
          const d = slotDesign[s]!;
          if (src >= 0) usedAt[src]![d] = stamp;
          usedAt[target]![d] = stamp;
          if (state[Math.min(target, topScale[d]!)]![s] !== 2) visibleMissing += 1;
        } else if (near[s] && near[s]! + 8 >= stamp) nearGroup[slotGroup[s]!] = stamp;
      }
      // The order: every missing (scale, slot) at the target and its neighbours, by bucket (a counting sort).
      const scales = [target, target - 1, target + 1].filter((i) => i >= 0 && i < L);
      const n = scales.length * S + capSlots.length;
      if (tmpBucket.length < n) { tmpBucket = new Uint16Array(n); tmpPair = new Int32Array(n); order = new Int32Array(n); orderRank = new Uint8Array(n); }
      counts.fill(0);
      let m = 0;
      for (const si of scales) {
        const st = state[si]!;
        for (let s = 0; s < S; s += 1) {
          if (st[s] !== 0) continue;
          const b = bucketOf(si, s);
          if (b < 0) continue;
          tmpBucket[m] = b; tmpPair[m] = si * S + s; m += 1;
          counts[b + 1]! += 1;
        }
      }
      // (A design capped below the scales above: its top bake, ranked as if it were the target's.)
      for (let q = 0; q < capSlots.length; q += 1) {
        const s = capSlots[q]!, ts = topScale[slotDesign[s]!]!;
        if (ts >= target - 1 || state[ts]![s] !== 0) continue;
        const b = bucketOf(ts, s, true);
        if (b < 0) continue;
        tmpBucket[m] = b; tmpPair[m] = ts * S + s; m += 1;
        counts[b + 1]! += 1;
      }
      for (let b = 0; b < RANKS * SUBS; b += 1) counts[b + 1]! += counts[b]!;
      for (let i = 0; i < m; i += 1) { const b = tmpBucket[i]!; const at = counts[b]!; order[at] = tmpPair[i]!; orderRank[at] = Math.floor(b / SUBS); counts[b] = at + 1; }
      orderLen = m; cursor = 0;
    },
    take(n, maxRank = RANKS) {
      const out: StreamJob[] = [];
      while (out.length < n && cursor < orderLen) {
        const pair = order[cursor]!, rank = orderRank[cursor]!;
        if (rank > maxRank) break;
        cursor += 1;
        const si = Math.floor(pair / S), s = pair - si * S;
        if (state[si]![s] !== 0) continue;
        state[si]![s] = 1; inFlight += 1;
        const d = slotDesign[s]!, spec = specs[d]!, k = ladder[si]!, dir = slotDir[s]!, nd = dirs[d]!;
        const clip = spec.clips[slotClip[s]! - clipStart[d]!]!.name, frame = slotFrame[s]!, st = styles[si]![d]!, box = boxes[si]![d]!;
        out.push({ key: spriteKey(spec.key, clip, frame, dir, nd, k, pitch, st), design: spec.key, clip, frame, direction: dir, angle: (dir / nd) * Math.PI * 2, w: box.w, h: box.h, pixelsPerMetre: k, pitch, style: st, slot: s, rank, epoch });
      }
      return out;
    },
    waiting(maxRank = RANKS) {
      let n = 0;
      for (let i = cursor; i < orderLen && orderRank[i]! <= maxRank; i += 1) { const p = order[i]!; const si = Math.floor(p / S); if (state[si]![p - si * S] === 0) n += 1; }
      return n;
    },
    put(job, sprite) {
      if (job.epoch !== epoch) return false;
      const si = ladder.indexOf(job.pixelsPerMetre), s = job.slot;
      if (si < 0 || s < 0 || s >= S) return false;
      const st = state[si]!;
      if (st[s] === 1) inFlight -= 1;
      if (st[s] === 2) return false;
      let at = atlas.alloc(sprite.w, sprite.h);
      // (What it's for NOW: a sprite taken as prefetch whose unit has since come on screen may evict like a visible one.)
      const rank = seen[s] === stamp || seen[s] === stamp - 1 ? 0 : job.rank;
      while (!at && evictFor(rank)) at = atlas.alloc(sprite.w, sprite.h);
      if (!at) { st[s] = 0; full = true; return false; }
      if (atlas.pages > pagesSeen) { pagesSeen = atlas.pages; onPages?.(pagesSeen, pageSize); }
      onWrite?.(at, sprite.rgba);
      const r = rects[si]!;
      r[s * 7] = at.x; r[s * 7 + 1] = at.y; r[s * 7 + 2] = sprite.w; r[s * 7 + 3] = sprite.h; r[s * 7 + 4] = sprite.ax; r[s * 7 + 5] = sprite.ay; r[s * 7 + 6] = at.page;
      st[s] = 2; groupBaked[si]![slotGroup[s]!]! += 1; bakedCount[si]! += 1;
      bytesOf[si]![slotDesign[s]!]! += sprite.w * sprite.h * 4;
      if (pre[si]![s]) preDone += 1;
      touch(slotGroup[s]!);
      return true;
    },
    cancel(job) {
      if (job.epoch !== epoch) return;
      const si = ladder.indexOf(job.pixelsPerMetre);
      if (si >= 0 && state[si]![job.slot] === 1) { state[si]![job.slot] = 0; inFlight -= 1; }
    },
    wanted(job) {
      if (job.epoch !== epoch) return false;
      const si = ladder.indexOf(job.pixelsPerMetre);
      const top = topScale[slotDesign[job.slot]!]!;
      return si >= 0 && (Math.abs(si - target) <= 1 || pre[si]![job.slot] === 1 || tier[slotDesign[job.slot]!] === 0 || (si === top && target > top));
    },
    resolve() {
      if (!dirty) return false;
      dirty = false;
      if (dirtyAll) { dirtyAll = false; for (let s = 0; s < S; s += 1) resolveSlot(s); }
      else for (const g of dirtyGroups) { const first = groupFirst[g]!, stride = groupStride[g]!; for (let f = 0; f < groupFrames[g]!; f += 1) resolveSlot(first + f * stride); }
      for (const g of dirtyGroups) groupDirty[g] = 0;
      dirtyGroups.length = 0;
      return true;
    },
    preload(spec = {}) {
      const { full: fullTiers = ["main"], designs: which = "all", frames = "first", clips = "all", scales = "start", visibleClips = true } = spec;
      const fullSet = new Set(fullTiers.map((t) => BAKE_TIERS.indexOf(t)));
      const at = scales === "neighbours" ? [target - 1, target, target + 1].filter((i) => i >= 0 && i < L) : [target];
      const shown = new Uint8Array(D);
      for (let s = 0; s < S; s += 1) if (seen[s] === stamp) shown[slotDesign[s]!] = 1;
      let added = 0;
      const mark = (si: number, s: number) => { if (pre[si]![s] || si > topScale[slotDesign[s]!]!) return; pre[si]![s] = 1; preTotal += 1; added += 1; if (state[si]![s] === 2) preDone += 1; };
      for (const si of at) {
        for (let s = 0; s < S; s += 1) {
          if (seen[s] !== stamp) continue;
          mark(si, s); // (the opening view, exactly)
          if (visibleClips) { const g = slotGroup[s]!; for (let f = 0; f < groupFrames[g]!; f += 1) mark(si, groupFirst[g]! + f * groupStride[g]!); }
        }
        for (let d = 0; d < D; d += 1) {
          const complete = fullSet.has(tier[d]!);
          if (!complete && which === "visible" && !shown[d]) continue;
          specs[d]!.clips.forEach((c, ci) => {
            if (!complete && clips !== "all" && !clips.includes(c.name)) return;
            const o = clipOff[clipStart[d]! + ci]!;
            const nf = complete || frames === "all" ? c.frames : 1;
            for (let f = 0; f < nf; f += 1) for (let dir = 0; dir < dirs[d]!; dir += 1) mark(si, o + f * dirs[d]! + dir);
          });
        }
      }
      return added;
    },
    get preloading() { return { done: preDone, total: preTotal }; },
    has: (slot, k) => state[idx(k)]![slot] === 2,
    get missingVisible() { return visibleMissing; },
    get backlog() { return orderLen - cursor; },
    stats() {
      const baked: Record<number, number> = {};
      ladder.forEach((k, i) => { if (bakedCount[i]) baked[k] = bakedCount[i]!; });
      let queued = 0;
      for (let i = cursor; i < orderLen; i += 1) { const p = order[i]!; const si = Math.floor(p / S); if (state[si]![p - si * S] === 0) queued += 1; }
      return {
        view: ladder[view]!, target: ladder[target]!, pending: ladder[pending]!, slots: S, baked, inFlight, queued, visibleMissing,
        pages: atlas.pages, bytes: atlas.bytes, used: atlas.used, evictions, full, preload: { done: preDone, total: preTotal },
      };
    },
  };
  return api;
}
