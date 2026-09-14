// Stages: new clips made from a design's own solids, so what a strategy game
// shows between "ordered" and "done" -- and between "alive" and "gone" -- is a
// BAKED sprite like everything else, keyed and cached with its design:
//
//   withFall(body)        a "fall" clip: the design's idle pose tipping over
//                         onto the ground in n frames (forward, or onto its
//                         side for a four-legged thing), lifted so nothing
//                         sinks below the ground. A unit's death, then its
//                         corpse or wreck (the last frame, left lying).
//   withStages(building)  a "stage" clip: the design rising -- a footprint
//                         slab, then a frame, then most of it -- each stage
//                         the design's solids cut at a height, plus what the
//                         build mechanic puts round it: scaffold poles and
//                         rails ("scaffold"), a membrane cocoon ("grow"), a
//                         ring of pylons on the ground ("warp").
//
// Both wrap an IndexedSource & DesignSpec (a body shape, a building) without
// touching it: the wrapper inherits everything (a BodyShape keeps its clip(),
// records(), slotRoles()...) and adds one clip, under a new key. Materials are
// the design's own slots: the caller names which slot a scaffold or membrane
// wears (one its look paints).

import { dcos, dsin } from "@keel-engine/core";
import type { BakeBox, BakeCapsule, BakeWorld } from "./bake.ts";
import type { IndexedSource } from "./indexed.ts";
import type { ClipSpec, DesignSpec } from "./plan.ts";

type Source = IndexedSource & DesignSpec;
type V3 = [number, number, number];

const v3 = (p: ArrayLike<number>): V3 => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];

/** A design with one more clip: everything else inherited (methods included), a new key, a bigger footprint if asked. */
function extend<T extends Source>(source: T, key: string, clip: ClipSpec, pose: (frame: number) => BakeWorld, radius = source.radius): T {
  const out = Object.create(source) as T;
  const cache = new Map<number, BakeWorld>();
  const clips = [...source.clips, clip];
  const own = (frame: number): BakeWorld => { let w = cache.get(frame); if (!w) { w = pose(frame); cache.set(frame, w); } return w; };
  Object.defineProperties(out, {
    key: { value: key, enumerable: true },
    clips: { value: clips, enumerable: true },
    radius: { value: radius, enumerable: true },
    pose: { value: (name: string, frame: number): BakeWorld => (name === clip.name ? own(Math.max(0, Math.min(clip.frames - 1, frame))) : source.pose(name, frame)), enumerable: true },
  });
  return out;
}

/** The lowest point of a world (metres): capsule ends less their radius, boxes' bottoms. */
export function worldFloor(w: BakeWorld): number {
  let lo = Infinity;
  for (const c of w.capsules ?? []) lo = Math.min(lo, (c.a[1] ?? 0) - c.r, (c.b[1] ?? 0) - c.r);
  for (const b of [...(w.boxes ?? []), ...(w.wedges ?? [])]) lo = Math.min(lo, (b.c[1] ?? 0) - (b.h[1] ?? 0));
  return Number.isFinite(lo) ? lo : 0;
}
/** A world's bounds: [minX, minY, minZ, maxX, maxY, maxZ] (metres). */
export function worldBounds(w: BakeWorld): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (p: ArrayLike<number>, r: number) => { for (let i = 0; i < 3; i += 1) { b[i] = Math.min(b[i]!, (p[i] ?? 0) - r); b[i + 3] = Math.max(b[i + 3]!, (p[i] ?? 0) + r); } };
  for (const c of w.capsules ?? []) { add(c.a, c.r); add(c.b, c.r); }
  for (const x of [...(w.boxes ?? []), ...(w.wedges ?? [])]) {
    // (A box turned about y: its footprint's reach along each axis, turned.)
    const cs = Math.abs(dcos(x.yaw ?? 0)), sn = Math.abs(dsin(x.yaw ?? 0));
    const ex = (x.h[0] ?? 0) * cs + (x.h[2] ?? 0) * sn, ez = (x.h[0] ?? 0) * sn + (x.h[2] ?? 0) * cs;
    b[0] = Math.min(b[0], (x.c[0] ?? 0) - ex); b[3] = Math.max(b[3], (x.c[0] ?? 0) + ex);
    b[2] = Math.min(b[2], (x.c[2] ?? 0) - ez); b[5] = Math.max(b[5], (x.c[2] ?? 0) + ez);
    b[1] = Math.min(b[1], (x.c[1] ?? 0) - (x.h[1] ?? 0)); b[4] = Math.max(b[4], (x.c[1] ?? 0) + (x.h[1] ?? 0));
  }
  if (!Number.isFinite(b[0])) return [0, 0, 0, 0, 0, 0];
  return b;
}

// ---------------------------------------------------------------- the fall

export interface FallOptions {
  /** The clip's name (default "fall"). */
  readonly clip?: string;
  /** Frames (default 4): the last one is the thing lying there. */
  readonly frames?: number;
  /** The pose it falls from (default "idle", else its first clip), frame 0. */
  readonly from?: string;
  /** Which way: "forward" (about x: a biped on its face) or "side" (about z: a quadruped on its flank). Default forward. */
  readonly way?: "forward" | "side";
  /** How far over it ends (radians, default 1.4: nearly flat). */
  readonly lie?: number;
}

/** A design with a "fall" clip: its pose tipping over, frame by frame, never below the ground. */
export function withFall<T extends Source>(source: T, { clip = "fall", frames = 4, from, way = "forward", lie = 1.4 }: FallOptions = {}): T {
  const base = from ?? (source.clips.some((c) => c.name === "idle") ? "idle" : source.clips[0]?.name ?? "idle");
  const n = Math.max(1, Math.round(frames));
  const pose = (frame: number): BakeWorld => {
    const t = (frame + 1) / n;
    const a = lie * (t * t * (3 - 2 * t)); // (eased: slow to go, quick to land)
    const w = source.pose(base, 0);
    const cs = dcos(a), sn = dsin(a);
    // Forward: about x (+y toward +z). Side: about z (+y toward +x).
    const rot = (p: ArrayLike<number>): V3 => {
      const [x, y, z] = v3(p);
      return way === "side" ? [x * cs + y * sn, y * cs - x * sn, z] : [x, y * cs - z * sn, y * sn + z * cs];
    };
    const box = (b: BakeBox): BakeBox => {
      const [hx, hy, hz] = v3(b.h);
      // (A box only turns about y: fallen, it's the rotated box's bounding box -- an approximation the capsules don't need.)
      const h: V3 = way === "side" ? [Math.abs(hx * cs) + Math.abs(hy * sn), Math.abs(hx * sn) + Math.abs(hy * cs), hz] : [hx, Math.abs(hy * cs) + Math.abs(hz * sn), Math.abs(hy * sn) + Math.abs(hz * cs)];
      return { ...b, c: rot(b.c), h };
    };
    const tipped: BakeWorld = { capsules: (w.capsules ?? []).map((c): BakeCapsule => ({ ...c, a: rot(c.a), b: rot(c.b) })), boxes: (w.boxes ?? []).map(box), wedges: (w.wedges ?? []).map(box) };
    const lift = Math.max(0, -worldFloor(tipped));
    if (lift <= 0) return tipped;
    const up = (p: ArrayLike<number>): V3 => { const q = v3(p); return [q[0], q[1] + lift, q[2]]; };
    return { capsules: tipped.capsules!.map((c) => ({ ...c, a: up(c.a), b: up(c.b) })), boxes: tipped.boxes!.map((b) => ({ ...b, c: up(b.c) })), wedges: tipped.wedges!.map((b) => ({ ...b, c: up(b.c) })) };
  };
  // (Lying down it reaches as far as it was tall: the footprint grows so the sprite's box holds it.)
  return extend(source, `${source.key}+${clip}${n}${way === "side" ? "s" : ""}`, { name: clip, frames: n, loop: false }, pose, Math.max(source.radius, source.height * 1.05));
}

// ---------------------------------------------------------------- construction stages

export type BuildMechanic = "scaffold" | "grow" | "warp";

export interface StageOptions {
  /** The clip's name (default "stage"). */
  readonly clip?: string;
  /** How it goes up: scaffold (poles and rails round it), grow (a membrane cocoon), warp (a ring of pylons on the ground). */
  readonly mechanic: BuildMechanic;
  /** The slot (material) the slab, poles and rails wear. */
  readonly scaffold: number;
  /** The slot the cocoon or the warp ring wears (default: `scaffold`). */
  readonly accent?: number;
  /** The complete pose (default the design's first clip), frame 0. */
  readonly from?: string;
  /** How far up each stage has risen (0..1 of its height; default [0.06, 0.42, 0.78]: footprint, frame, most of it). */
  readonly fractions?: readonly number[];
}

/** Cut a world at height `cut`: what's wholly above goes, what spans it is cut down to it. */
export function cutWorld(w: BakeWorld, cut: number): BakeWorld {
  const capsules: BakeCapsule[] = [];
  for (const c of w.capsules ?? []) {
    const a = v3(c.a), b = v3(c.b);
    if (a[1] - c.r > cut && b[1] - c.r > cut) continue;
    const clip = (p: V3, q: V3): V3 => {
      if (p[1] <= cut) return p;
      const t = (cut - q[1]) / (p[1] - q[1] || 1);
      return [q[0] + (p[0] - q[0]) * t, cut, q[2] + (p[2] - q[2]) * t];
    };
    capsules.push({ ...c, a: clip(a, b), b: clip(b, a), r: Math.min(c.r, Math.max(0.02, cut)) });
  }
  const boxes = (list: readonly BakeBox[] | undefined): BakeBox[] => {
    const out: BakeBox[] = [];
    for (const x of list ?? []) {
      const c = v3(x.c), h = v3(x.h);
      const bottom = c[1] - h[1], top = c[1] + h[1];
      if (bottom >= cut) continue;
      if (top <= cut) { out.push(x); continue; }
      const hy = Math.max(0.01, (cut - bottom) / 2);
      out.push({ ...x, c: [c[0], bottom + hy, c[2]], h: [h[0], hy, h[2]] });
    }
    return out;
  };
  return { capsules, boxes: boxes(w.boxes), wedges: boxes(w.wedges) };
}

/** A design with a "stage" clip: frame i is the design risen to fractions[i] of its height, dressed by its build mechanic. */
export function withStages<T extends Source>(source: T, options: StageOptions): T {
  const { clip = "stage", mechanic, scaffold, accent = scaffold, from, fractions = [0, 0.3, 0.58, 0.84] } = options;
  const base = from ?? source.clips[0]?.name ?? "still";
  const whole = source.pose(base, 0);
  const [x0, , z0, x1, y1, z1] = worldBounds(whole);
  const height = Math.max(0.2, y1);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const hx = Math.max(0.2, (x1 - x0) / 2), hz = Math.max(0.2, (z1 - z0) / 2);
  const pose = (frame: number): BakeWorld => {
    const f = fractions[Math.max(0, Math.min(fractions.length - 1, frame))]!;
    const cut = height * f;
    // (A zero fraction is the bare footprint: nothing of the building yet.)
    const inner = f > 0 ? cutWorld(whole, cut) : { capsules: [], boxes: [], wedges: [] };
    const caps: BakeCapsule[] = [...(inner.capsules ?? [])];
    const bx: BakeBox[] = [...(inner.boxes ?? [])];
    const pole = (x: number, z: number, top: number, r: number, mat: number) => caps.push({ a: [x, 0.02, z], b: [x, top, z], r, mat });
    const rail = (a: V3, b: V3, r: number, mat: number) => caps.push({ a, b, r, mat });
    // A site stands on its footprint: a low slab the size of its base (a grown one on a round bed of lobes instead).
    if (mechanic !== "grow") bx.push({ c: [cx, 0.05, cz], h: [hx * 0.98, 0.05, hz * 0.98], yaw: 0, mat: scaffold });
    if (f <= 0) {
      // The bare footprint: the slab and its corner stakes (scaffold), a seed mound (grow), the ring alone (warp).
      if (mechanic === "scaffold") for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) pole(cx + sx * hx, cz + sz * hz, 0.45, Math.max(0.04, Math.min(hx, hz) * 0.04), scaffold);
      if (mechanic === "grow") {
        // A creep stain over the footprint (thin turned slabs: a ragged edge) and a seed bud swelling in its middle.
        for (let i = 0; i < 5; i += 1) { const a = (i / 5) * Math.PI * 2; bx.push({ c: [cx + dcos(a) * hx * 0.35, 0.02, cz + dsin(a) * hz * 0.35], h: [hx * 0.55, 0.02, hz * 0.32], yaw: a, mat: scaffold }); }
        const R = Math.min(hx, hz) * 0.5;
        caps.push({ a: [cx, R * 0.45, cz], b: [cx, R * 0.6, cz], r: R, mat: accent });
        for (let i = 0; i < 6; i += 1) { const a = (i / 6) * Math.PI * 2; caps.push({ a: [cx + dcos(a) * hx * 0.72, 0.1, cz + dsin(a) * hz * 0.72], b: [cx + dcos(a) * hx * 0.55, 0.14, cz + dsin(a) * hz * 0.55], r: R * 0.3, mat: accent }); }
      }
    }
    if (mechanic === "scaffold" && f > 0) {
      // Poles at the corners and along each side (every ~1.6 m), rails round the outside every ~1.1 m up to just over the cut.
      const top = Math.min(height * 1.02, cut + Math.max(0.5, height * 0.18));
      const pr = Math.max(0.035, Math.min(hx, hz) * 0.035);
      const ex = hx + pr * 2, ez = hz + pr * 2;
      const nx = Math.max(1, Math.round((2 * ex) / 1.6)), nz = Math.max(1, Math.round((2 * ez) / 1.6));
      for (let i = 0; i <= nx; i += 1) { const x = cx - ex + (2 * ex * i) / nx; pole(x, cz - ez, top, pr, scaffold); pole(x, cz + ez, top, pr, scaffold); }
      for (let j = 1; j < nz; j += 1) { const z = cz - ez + (2 * ez * j) / nz; pole(cx - ex, z, top, pr, scaffold); pole(cx + ex, z, top, pr, scaffold); }
      for (let y = Math.min(1.1, top * 0.5); y <= top + 1e-6; y += 1.1) {
        rail([cx - ex, y, cz - ez], [cx + ex, y, cz - ez], pr * 0.8, scaffold); rail([cx - ex, y, cz + ez], [cx + ex, y, cz + ez], pr * 0.8, scaffold);
        rail([cx - ex, y, cz - ez], [cx - ex, y, cz + ez], pr * 0.8, scaffold); rail([cx + ex, y, cz - ez], [cx + ex, y, cz + ez], pr * 0.8, scaffold);
      }
      // (A diagonal brace on the front face: a frame, not a fence.)
      if (frame > 0) rail([cx - ex, 0.1, cz + ez], [cx - ex + Math.min(2 * ex, top), top, cz + ez], pr * 0.8, scaffold);
    } else if (mechanic === "grow" && f > 0) {
      // A cocoon: lobes over the footprint that swell (a mound, then a hump taller than what's inside) and then split
      // open, sinking round the base as the building shows through them.
      const g = Math.max(0, Math.min(2, frame - (fractions[0]! <= 0 ? 1 : 0)));
      const lobes = g === 2 ? 5 : 7;
      const R = Math.min(hx, hz) * [0.62, 0.66, 0.46][g]!;
      const rise = height * [0.3, 0.62, 0.34][g]!;
      for (let i = 0; i < lobes; i += 1) {
        const a = (i / lobes) * Math.PI * 2 + g * 0.4;
        const out = g === 2 ? 0.82 : 0.6;
        const rx = dcos(a) * hx * out, rz = dsin(a) * hz * out;
        caps.push({ a: [cx + rx, R * 0.6, cz + rz], b: [cx + rx * 0.8, Math.max(R * 0.6, rise - R * 0.4), cz + rz * 0.8], r: R * 0.55, mat: accent });
      }
      if (g < 2) caps.push({ a: [cx, R * 0.5, cz], b: [cx, Math.max(R * 0.5, rise), cz], r: R * (g === 0 ? 0.85 : 0.7), mat: accent });
    } else if (mechanic === "warp") {
      // A warp: a ring of pylons round the footprint, a band on the ground joining them; the design grows inside.
      const n = 6;
      const ring = 1.04;
      const tall = Math.max(0.35, Math.min(1.4, height * 0.3));
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2 + Math.PI / n;
        const x = cx + dcos(a) * hx * ring, z = cz + dsin(a) * hz * ring;
        pole(x, z, tall, Math.max(0.05, Math.min(hx, hz) * 0.06), accent);
        const b = ((i + 1) / n) * Math.PI * 2 + Math.PI / n;
        rail([x, 0.05, z], [cx + dcos(b) * hx * ring, 0.05, cz + dsin(b) * hz * ring], 0.05, accent);
      }
    }
    return { capsules: caps, boxes: bx, wedges: inner.wedges ?? [] };
  };
  return extend(source, `${source.key}+${clip}${fractions.length}${mechanic[0]}${scaffold}.${accent}`, { name: clip, frames: fractions.length, loop: false }, pose, source.radius * 1.08);
}
