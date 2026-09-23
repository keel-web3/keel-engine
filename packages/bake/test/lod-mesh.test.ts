// Levels of detail as one mesh, and the planes a far pass needs: every level a
// prefix of one index buffer (no index copied, body space shared), the hardware
// planes moved without moving the depth contract, and an orthographic span deep
// enough for a tall tower.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPTH_RANGE, frustumOf, layeredMesh, lookMesh, orthoDepthRange, pixelView, prefixMesh, projectionOf, shotOfView, solidSize, visible, worldError } from "../src/index.ts";
import type { BakeWorld, PerspShot } from "../src/index.ts";
import { MESH_GFS, MESH_VS } from "../src/mesh.ts";

const mass: BakeWorld = { boxes: [{ c: [0, 30, 0], h: [10, 30, 10], mat: 1, grid: [3, 3.5] }] };
const crown: BakeWorld = { boxes: [{ c: [0, 61, 0], h: [6, 1, 6], mat: 2 }, { c: [0, 45, 10.2], h: [8, 0.2, 0.2], mat: 3 }] };
const kit: BakeWorld = { boxes: [{ c: [3, 61.5, 2], h: [1, 0.8, 1.5], mat: 4 }], capsules: [{ a: [-4, 60, -4], b: [-4, 63, -4], r: 0.6, mat: 5 }] };

test("lod mesh: each level is a prefix of one buffer -- the runs in order, nothing copied", () => {
  const m = layeredMesh([mass, crown, kit]);
  const parts = [lookMesh(mass), lookMesh(crown), lookMesh(kit)];
  assert.deepEqual(m.layers.map((l) => l.indices), [parts[0]!.indices.length, parts[0]!.indices.length + parts[1]!.indices.length, parts.reduce((a, p) => a + p.indices.length, 0)]);
  assert.equal(m.layers.at(-1)!.vertices, m.positions.length / 3);
  assert.equal(m.layers.at(-1)!.indices, m.indices.length);
  // (A prefix only ever points at its own vertices: a level can be drawn -- or uploaded -- on its own.)
  for (const l of m.layers) for (let i = 0; i < l.indices; i += 1) assert.ok(m.indices[i]! < l.vertices);
  // The coarsest level is the masses exactly, the same triangles and positions as the mass alone.
  const c2 = prefixMesh(m, 1);
  assert.deepEqual([...c2.positions], [...parts[0]!.positions]);
  assert.deepEqual([...c2.indices], [...parts[0]!.indices]);
  // Body space is the whole chain's: a coarse level paints as the fine one does.
  assert.deepEqual([...c2.bodies], [...m.bodies.subarray(0, c2.bodies.length)]);
  assert.equal(prefixMesh(m, 0).indices.length, 0);
});

test("lod mesh: a solid's size is the middle of its extents; a world's error is its biggest", () => {
  assert.equal(solidSize({ c: [0, 0, 0], h: [8, 0.2, 0.2] }), 0.4);
  assert.equal(solidSize({ c: [0, 0, 0], h: [1, 0.8, 1.5] }), 2);
  assert.equal(solidSize({ a: [0, 0, 0], b: [0, 3, 0], r: 0.6 }), 1.2);
  assert.equal(worldError(kit), 2);
  assert.equal(worldError({}), 0);
});

test("projection: clip planes move the hardware's cut, never the depth contract", () => {
  const shot: PerspShot = { kind: "persp", eye: [0, 2, 0], target: [0, 1, 10], fov: 1.1 };
  const whole = projectionOf(shot, 320, 180, 440);
  const near = projectionOf(shot, 320, 180, 440, undefined, { far: 230 });
  const far = projectionOf(shot, 320, 180, 440, undefined, { near: 210, far: 3000 });
  assert.equal(whole.clipFar, undefined);
  assert.equal(near.clipFar, 230); assert.equal(far.clipNear, 210);
  for (const p of [[0, 1, 50], [30, 80, 300], [-400, 250, 1500]] as const) assert.deepEqual(near.project(p), whole.project(p));
  assert.deepEqual(far.project([30, 80, 300]), whole.project([30, 80, 300]));
  const box = (z: number): [[number, number, number], [number, number, number]] => [[-5, 0, z - 5], [5, 200, z + 5]];
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const seen = (p: typeof whole, z: number): boolean => visible(frustumOf(p), ...box(z), id);
  // A tower 1.2 km out: cut by the old single frustum, drawn by the far pass; the near pass stops at its plane.
  assert.equal(seen(whole, 1200), false);
  assert.equal(seen(far, 1200), true);
  assert.equal(seen(near, 1200), false);
  assert.equal(seen(near, 100), true);
  assert.equal(seen(far, 100), false);
  // (The two overlap round the split, so a tower standing across it is one tower.)
  assert.equal(seen(near, 222), true);
  assert.equal(seen(far, 222), true);
});

test("projection: an orthographic view deep enough for the tallest tower", () => {
  const view = pixelView({ center: [0, 0, 0], yaw: 0, pitch: 0.62, pixelsPerMetre: 16, width: 320, height: 180 });
  assert.equal(orthoDepthRange(view, 0) >= 80, true);
  const range = orthoDepthRange(view, 268);
  // (The top of a 268 m tower over the centre must land inside the span, not clamp to its front.)
  const p = projectionOf(shotOfView(view), 320, 180, 80, undefined, { far: range });
  const top = [0, 268, 0] as const;
  const fd = (top[0] - p.origin[0]) * p.forward[0] + (top[1] - p.origin[1]) * p.forward[1] + (top[2] - p.origin[2]) * p.forward[2];
  assert.ok(0.5 + fd / range > 0.02, `${0.5 + fd / range}`);
  assert.ok(0.5 + fd / 80 < 0, "the old span clamped it");
  // The contract (what composites) is untouched: the same depth as the plain view's.
  assert.deepEqual(p.project([3, 0, 4]), projectionOf(shotOfView(view), 320, 180, 80).project([3, 0, 4]));
  assert.equal(p.clipFar, range);
  assert.equal(projectionOf(shotOfView(view), 320, 180).depthRange, DEPTH_RANGE);
});

test("mesh pass: the orthographic sort span and the complementary fade are in the shaders", () => {
  assert.ok(MESH_VS.includes("fd / uClipRange"));
  assert.ok(MESH_GFS.includes("if (uFx.z < 0.0) { if (bayer4(ivec2(gl_FragCoord.xy)) < 1.0 + uFx.z) discard; }"));
});

test("shared mesh detail prepares a pose once and delegates both levels' lifetime to its owner", async () => {
  const { prepareMeshDetail } = await import("../src/lod-mesh.ts");
  const { lookMesh } = await import("../src/mesh.ts");
  const world = { capsules: [{ a: [0,0,0], b: [0,1,0], r: .02, mat: 4 }] };
  let poses = 0, builds = 0;
  const cache = new Map<string, ReturnType<typeof lookMesh>>();
  const hold = (key: string, make: () => ReturnType<typeof lookMesh>) => { if (!cache.has(key)) { builds++; cache.set(key, make()); } return key; };
  const a = prepareMeshDetail("test:shape:v1", () => { poses++; return world; }, hold, .01);
  const b = prepareMeshDetail("test:shape:v1", () => { poses++; return world; }, hold, .01);
  assert.deepEqual(a, b); assert.equal(poses, 1); assert.equal(builds, 2);
  assert.equal(cache.size, 2);
  assert.ok(cache.get(a.lod.mesh)!.indices.length < cache.get(a.mesh)!.indices.length);
  assert.throws(() => prepareMeshDetail("bad", () => world, hold, Infinity), RangeError);
  assert.throws(() => prepareMeshDetail("bad", () => world, hold, 0), RangeError);
});
