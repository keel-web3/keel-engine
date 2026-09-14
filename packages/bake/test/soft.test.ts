// The software indexed baker as the package exports it: softBake makes exactly
// the texels a full per-pixel scan makes (its footprint culling changes nothing),
// and softMask is softBake's sprite reduced to a silhouette, at the job planBake
// would plan -- so a game can measure its roster's shapes without a GPU.
import { test } from "node:test";
import assert from "node:assert/strict";
import { entityOf } from "@keel-engine/entity";
import { bodyShape, planBake, softBake, softMask, spriteBox } from "../src/index.ts";
import type { BakeWorld, DesignSpec, IndexedSource, SpriteJob } from "../src/index.ts";

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V, s = 1): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const v3 = (p: ArrayLike<number>): V => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];

// The fixture's original full scan (every primitive at every pixel), kept here as the reference.
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
function fullScan(src: IndexedSource & DesignSpec, job: SpriteJob) {
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
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const P0 = add(add([0, 0, 0], right, (x + 0.5 - ax) / k), up, (ay - y - 0.5) / k);
    const ro = add(P0, d, 60), rd: V = [-d[0], -d[1], -d[2]];
    let best = Infinity, n: V = [0, 1, 0], mat = -1;
    for (const c of world.capsules ?? []) {
      const t = capsule(ro, rd, v3(c.a), v3(c.b), c.r);
      if (t > 0 && t < best) {
        best = t; mat = c.mat ?? 0;
        const hit = add(ro, rd, t), pa = v3(c.a), ba = sub(v3(c.b), pa);
        const h = Math.max(0, Math.min(1, dot(sub(hit, pa), ba) / Math.max(1e-9, dot(ba, ba))));
        n = norm(sub(hit, add(pa, ba, h)));
      }
    }
    for (const b of [...(world.boxes ?? []), ...(world.wedges ?? [])]) {
      const r = box(ro, rd, v3(b.c), v3(b.h), b.yaw ?? 0);
      if (r && r.t > 0 && r.t < best) { best = r.t; mat = b.mat ?? 0; n = r.n; }
    }
    if (mat < 0) continue;
    slotAt[y * W + x] = mat;
    shade[y * W + x] = Math.round(Math.max(0.05, Math.min(1, 0.35 + 0.65 * dot(n, light))) * 255);
  }
  return { slotAt, shade, W, H };
}

const props: IndexedSource & DesignSpec = {
  key: "props", clips: [{ name: "still", frames: 1 }], height: 2.4, radius: 1.8,
  pose: () => ({
    capsules: [{ a: [-0.6, 0.4, 0], b: [0.7, 1.4, 0.3], r: 0.3, mat: 2 }, { a: [0, 1.8, -0.4], b: [0, 1.8, -0.4], r: 0.35, mat: 5 }],
    boxes: [{ c: [0.4, 0.5, -0.6], h: [0.5, 0.5, 0.3], yaw: 0.6, mat: 7 }, { c: [-0.9, 0.2, 0.8], h: [0.2, 0.2, 0.6], yaw: 0, mat: 9 }],
  }),
};

test("softBake: exactly the full scan's texels (slot, edge, shade), for bodies and props, every direction", () => {
  const dog = bodyShape(entityOf("5", { kind: "animal", species: "dog" }), { clips: [{ name: "idle", frames: 2 }] });
  const person = bodyShape(entityOf("9", { kind: "humanoid" }), { clips: [{ name: "idle", frames: 2 }] });
  for (const src of [props, dog, person] as (IndexedSource & DesignSpec)[]) {
    const plan = planBake([src], { directions: 4, pixelsPerMetre: 20, pitch: 0.7 });
    for (const job of plan.sprites.filter((j) => j.frame === 0)) {
      const s = softBake(src, job);
      const ref = fullScan(src, job);
      // The reference, trimmed the same way.
      let x0 = ref.W, y0 = ref.H, n = 0;
      for (let y = 0; y < ref.H; y += 1) for (let x = 0; x < ref.W; x += 1) if (ref.slotAt[y * ref.W + x]! >= 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); n += 1; }
      let hits = 0;
      for (let y = 0; y < s.h; y += 1) for (let x = 0; x < s.w; x += 1) {
        const i = (y * s.w + x) * 4, j = (y + y0) * ref.W + (x + x0);
        const slot = ref.slotAt[j]!;
        assert.equal(s.rgba[i]! & 63, slot < 0 ? 0 : slot + 1, `${src.key} ${job.direction} slot at ${x},${y}`);
        if (slot >= 0) { hits += 1; assert.equal(s.rgba[i + 1], ref.shade[j], "shade"); }
      }
      assert.equal(hits, n, `${src.key}: every hit is in the trimmed sprite`);
    }
  }
});

test("softMask: the planned job's silhouette -- solid where hit, the slot kept, the anchor on the ground point", () => {
  const src = props;
  const opts = { pixelsPerMetre: 12, pitch: (55 * Math.PI) / 180 };
  const m = softMask(src, "still", 0, opts);
  const job = planBake([src], { directions: 8, ...opts, style: "indexed" }).sprites[0]!;
  const s = softBake(src, job);
  assert.equal(m.w, s.w); assert.equal(m.h, s.h); assert.equal(m.ax, s.ax); assert.equal(m.ay, s.ay);
  let solid = 0;
  for (let i = 0; i < m.w * m.h; i += 1) {
    assert.equal(m.solid[i], s.rgba[i * 4]! & 63 ? 1 : 0);
    assert.equal(m.slots[i], s.rgba[i * 4]! & 63);
    solid += m.solid[i]!;
  }
  assert.ok(solid > 40, `a real silhouette (${solid} texels)`);
  assert.deepEqual([...new Set(m.slots)].sort((a, b) => a - b), [0, 3, 6, 8, 10], "its four materials, as slot + 1");
  // Direction turns it: a quarter turn is another silhouette; the same one twice is the same.
  const q = softMask(src, "still", 0, { ...opts, direction: 2 });
  assert.notDeepEqual([...q.solid], [...m.solid]);
  assert.deepEqual([...softMask(src, "still", 0, opts).solid], [...m.solid]);
  // The anchor is the ground point below the origin: a ball at the origin's column sits over it.
  const ball: IndexedSource & DesignSpec = { key: "ball", clips: [{ name: "still", frames: 1 }], height: 1, radius: 0.5, pose: () => ({ capsules: [{ a: [0, 0.5, 0], b: [0, 0.5, 0], r: 0.5, mat: 1 }] }) };
  const b = softMask(ball, "still", 0, opts);
  let lo = -1, cx = 0, cn = 0;
  for (let y = 0; y < b.h; y += 1) for (let x = 0; x < b.w; x += 1) if (b.solid[y * b.w + x]) { lo = Math.max(lo, y); cx += x + 0.5; cn += 1; }
  assert.ok(Math.abs(cx / cn - b.ax) <= 1, `centred on the anchor (${(cx / cn).toFixed(1)} vs ${b.ax})`);
  assert.ok(Math.abs(lo - b.ay) <= 4, `its bottom near the anchor (${lo} vs ${b.ay})`);
});
