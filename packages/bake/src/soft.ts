// A software indexed baker: an orthographic ray per pixel against a design's
// capsules and boxes -- what the renderer's bake mode does on the GPU, in plain
// code, so indexed sprites can be made (and measured) headlessly: in Node, in a
// test, in a tool that checks a roster's silhouettes before anything is drawn.
// Each hit texel carries the INDEX bytes -- slot + 1 (| 128 on an outline
// edge), a shade from the surface normal, a surface coordinate -- exactly as a
// GPU bake's, so portraits and painting work on its sprites too.
//
//   const sprite = softBake(design, job);                     // a SpriteJob from planBake / portraitPlan
//   const m = softMask(design, "idle", 0, { pixelsPerMetre: 12, pitch: 0.96 });
//   m.solid[y * m.w + x]                                        // 1 where the design was hit
//
// (Promoted from the bake package's test fixture. Each primitive is tested
// only against the pixels its screen footprint can cover -- the same hits as
// testing every primitive at every pixel, a good deal faster.)

import type { BakeWorld } from "./bake.ts";
import type { IndexedSource } from "./indexed.ts";
import type { DesignSpec, SpriteJob } from "./plan.ts";
import { spriteBox, spriteKey } from "./plan.ts";

type V = [number, number, number];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V, s = 1): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const v3 = (p: ArrayLike<number>): V => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];

/** Ray (ro, rd) against a capsule: the distance, or -1. */
function capsule(ro: V, rd: V, pa: V, pb: V, r: number): number {
  const ba = sub(pb, pa), oa = sub(ro, pa);
  const baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0 && a > 1e-9) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
    const oc = y <= 0 ? oa : sub(ro, pb);
    b = dot(rd, oc); c = dot(oc, oc) - r * r; h = b * b - c;
    if (h > 0) return -b - Math.sqrt(h);
  } else {
    for (const p of [pa, pb]) { const oc = sub(ro, p); b = dot(rd, oc); c = dot(oc, oc) - r * r; h = b * b - c; if (h > 0) return -b - Math.sqrt(h); }
  }
  return -1;
}
/** Ray against a box turned about y: the distance and the normal, or null. */
function box(ro: V, rd: V, c: V, hh: V, yaw: number): { t: number; n: V } | null {
  const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
  const rot = (p: V): V => [p[0] * cs + p[2] * sn, p[1], -p[0] * sn + p[2] * cs];
  const o = rot(sub(ro, c)), d = rot(rd);
  let t0 = -Infinity, t1 = Infinity, axis = 0, sign = 1;
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]!) < 1e-9) { if (Math.abs(o[i]!) > hh[i]!) return null; continue; }
    let a = (-hh[i]! - o[i]!) / d[i]!, b = (hh[i]! - o[i]!) / d[i]!;
    let s = -1;
    if (a > b) { const x = a; a = b; b = x; s = 1; }
    if (a > t0) { t0 = a; axis = i; sign = s; }
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  const nl: V = [0, 0, 0]; nl[axis] = sign;
  const back = (p: V): V => [p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), p[1], -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw)];
  return { t: t0, n: back(nl) };
}

/** A baked sprite, trimmed: w x h texels of INDEX bytes (slot + 1 | 128 at an edge, shade, u, v), its anchor at (ax, ay). */
export interface SoftSprite { readonly key: string; readonly w: number; readonly h: number; readonly ax: number; readonly ay: number; readonly rgba: Uint8Array }

/** Bake one job of an indexed design in software: a trimmed sprite { key, w, h, ax, ay, rgba } (an empty design: 1 x 1). */
export function softBake(src: IndexedSource & Pick<DesignSpec, "height" | "radius">, job: Pick<SpriteJob, "key" | "clip" | "frame" | "angle" | "pixelsPerMetre" | "pitch">): SoftSprite {
  const k = job.pixelsPerMetre, p = job.pitch, a = job.angle;
  const { w: bw, h: bh } = spriteBox(src, k, p);
  const W = bw + 8, H = bh + 8;
  const d: V = [Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)];
  const right: V = [Math.cos(a), 0, -Math.sin(a)];
  const up: V = [-Math.sin(a) * Math.sin(p), Math.cos(p), -Math.cos(a) * Math.sin(p)];
  const ax = W / 2, ay = H - 4 - src.radius * Math.sin(p) * k;
  const world: BakeWorld = src.pose(job.clip, job.frame);
  const light = norm(add(add(d, up, 0.8), right, -0.5));
  const slotAt = new Int16Array(W * H).fill(-1);
  const shade = new Uint8Array(W * H);
  // Every primitive with the pixel rectangle its projection can reach (the ray is orthographic: a primitive can
  // only be hit inside its screen footprint), in the order the full scan would test them.
  interface Prim { kind: 0 | 1; i: number; x0: number; x1: number; y0: number; y1: number }
  const px = (q: V): number => ax + dot(q, right) * k - 0.5;
  const py = (q: V): number => ay - dot(q, up) * k - 0.5;
  const caps = world.capsules ?? [];
  const boxes = [...(world.boxes ?? []), ...(world.wedges ?? [])];
  const prims: Prim[] = [];
  caps.forEach((c, i) => {
    const A = v3(c.a), B = v3(c.b), e = c.r * k + 1;
    prims.push({ kind: 0, i, x0: Math.min(px(A), px(B)) - e, x1: Math.max(px(A), px(B)) + e, y0: Math.min(py(A), py(B)) - e, y1: Math.max(py(A), py(B)) + e });
  });
  boxes.forEach((b, i) => {
    const C = v3(b.c), e = Math.hypot(b.h[0] ?? 0, b.h[1] ?? 0, b.h[2] ?? 0) * k + 1;
    prims.push({ kind: 1, i, x0: px(C) - e, x1: px(C) + e, y0: py(C) - e, y1: py(C) + e });
  });
  const capList = prims.filter((q) => q.kind === 0), boxList = prims.filter((q) => q.kind === 1);
  for (let y = 0; y < H; y += 1) {
    const rowCaps = capList.filter((q) => y >= q.y0 && y <= q.y1);
    const rowBoxes = boxList.filter((q) => y >= q.y0 && y <= q.y1);
    if (!rowCaps.length && !rowBoxes.length) continue;
    for (let x = 0; x < W; x += 1) {
      const P0 = add(add([0, 0, 0], right, (x + 0.5 - ax) / k), up, (ay - y - 0.5) / k);
      const ro = add(P0, d, 60), rd: V = [-d[0], -d[1], -d[2]];
      let best = Infinity, n: V = [0, 1, 0], mat = -1;
      for (const q of rowCaps) {
        if (x < q.x0 || x > q.x1) continue;
        const c = caps[q.i]!;
        const t = capsule(ro, rd, v3(c.a), v3(c.b), c.r);
        if (t > 0 && t < best) {
          best = t; mat = c.mat ?? 0;
          const hit = add(ro, rd, t), pa = v3(c.a), ba = sub(v3(c.b), pa);
          const h = Math.max(0, Math.min(1, dot(sub(hit, pa), ba) / Math.max(1e-9, dot(ba, ba))));
          n = norm(sub(hit, add(pa, ba, h)));
        }
      }
      for (const q of rowBoxes) {
        if (x < q.x0 || x > q.x1) continue;
        const b = boxes[q.i]!;
        const r = box(ro, rd, v3(b.c), v3(b.h), b.yaw ?? 0);
        if (r && r.t > 0 && r.t < best) { best = r.t; mat = b.mat ?? 0; n = r.n; }
      }
      if (mat < 0) continue;
      slotAt[y * W + x] = mat;
      shade[y * W + x] = Math.round(Math.max(0.05, Math.min(1, 0.35 + 0.65 * dot(n, light))) * 255);
    }
  }
  // Trim, with the edge flag where a neighbour is another slot or nothing.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (slotAt[y * W + x]! >= 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { key: job.key, w: 1, h: 1, ax: 0, ay: 0, rgba: new Uint8Array(4) };
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const rgba = new Uint8Array(tw * th * 4);
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    const s = slotAt[y * W + x]!;
    if (s < 0) continue;
    const nb = [slotAt[y * W + x - 1], slotAt[y * W + x + 1], slotAt[(y - 1) * W + x], slotAt[(y + 1) * W + x]];
    const edge = nb.some((q) => q === undefined || q < 0);
    const o = ((y - y0) * tw + (x - x0)) * 4;
    rgba[o] = (s + 1) | (edge ? 128 : 0); rgba[o + 1] = shade[y * W + x]!; rgba[o + 2] = (x * 7) & 255; rgba[o + 3] = (y * 5) & 255;
  }
  return { key: job.key, w: tw, h: th, ax: Math.round(ax - x0), ay: Math.round(ay - y0), rgba };
}

/** How softMask looks at a design: the game's scale and camera pitch, and which of `directions` faces the camera. */
export interface SoftMaskOptions {
  readonly pixelsPerMetre: number;
  /** Radians down from horizontal. */
  readonly pitch: number;
  /** 0 (default): its front toward the camera. */
  readonly direction?: number;
  /** Directions round (default 8). */
  readonly directions?: number;
  /** The style string in the job's key (default "indexed"): only the key, never the pixels. */
  readonly style?: string;
}

/** A design's silhouette: w x h, its ground anchor at (ax, ay), solid 1 where a texel was hit; slots the slot + 1 there (0: nothing). */
export interface SoftMask { readonly w: number; readonly h: number; readonly ax: number; readonly ay: number; readonly solid: Uint8Array; readonly slots: Uint8Array }

/**
 * A design's silhouette at a clip's frame, as the game's camera sees it: softBake of the job planBake would make
 * (same key, angle and scale), reduced to which texels were hit. Measures a roster's shapes headlessly.
 */
export function softMask(src: IndexedSource & DesignSpec, clip: string, frame: number, { pixelsPerMetre, pitch, direction = 0, directions = 8, style = "indexed" }: SoftMaskOptions): SoftMask {
  const angle = (direction / directions) * Math.PI * 2;
  const sprite = softBake(src, { key: spriteKey(src.key, clip, frame, direction, directions, pixelsPerMetre, pitch, style), clip, frame, angle, pixelsPerMetre, pitch });
  const n = sprite.w * sprite.h;
  const solid = new Uint8Array(n), slots = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) { const s = sprite.rgba[i * 4]! & 63; if (s) { solid[i] = 1; slots[i] = s; } }
  return { w: sprite.w, h: sprite.h, ax: sprite.ax, ay: sprite.ay, solid, slots };
}
