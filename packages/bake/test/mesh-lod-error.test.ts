import { test } from "node:test";
import assert from "node:assert/strict";
import { meshMatrix } from "../src/mesh.ts";
import { projectedMeshError } from "../src/mesh-lod.ts";
import { projectionOf } from "../src/project.ts";

test("projected replacement error bounds actual pixel displacement across FOVs, aspect ratios, transforms and screen edges", () => {
  const lo = [-.2, -.4, -.3], hi = [.2, .4, .3], error = .02;
  for (const [width, height] of [[640, 360], [390, 844]]) for (const fov of [.45, 1.05, 1.9]) for (const z of [1, 8, 70]) for (const x of [0, 4]) {
    const view = projectionOf({ kind: "persp", eye: [0, 0, 0], target: [0, 0, 1], fov }, width!, height!);
    const m = meshMatrix({ x, z, yaw: .31, roll: .2, scale: 1.7 }); m[4]! += .2; m[10]! *= .7; // shear and non-uniform scale
    const bound = projectedMeshError(view, lo, hi, m, error);
    const world = (p: number[]): [number, number, number] => [0, 1, 2].map(a => m[a]! * p[0]! + m[a + 4]! * p[1]! + m[a + 8]! * p[2]! + m[a + 12]!) as [number, number, number];
    for (let corner = 0; corner < 8; corner++) for (let direction = 0; direction < 40; direction++) {
      const p = lo.map((v, i) => corner & (1 << i) ? hi[i]! : v);
      const yaw = direction * 2.399963229728653, y = 2 * direction / 39 - 1, r = Math.sqrt(1 - y * y);
      const q = [p[0]! + error * r * Math.cos(yaw), p[1]! + error * y, p[2]! + error * r * Math.sin(yaw)];
      const a = view.project(world(p)), b = view.project(world(q));
      assert.ok(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= bound + 1e-5);
    }
  }
});

test("close and near-plane crossings retain detail; zoom and portrait resolution increase error; ortho has no distance switch", () => {
  const lo = [-.3, 0, -.3], hi = [.3, .6, .3], m = meshMatrix({ z: 5 });
  const view = (fov = 1.05, height = 360) => projectionOf({ kind: "persp" as const, eye: [0, 0, 0], target: [0, 0, 1], fov }, 640, height);
  const err = (v: ReturnType<typeof view>, model = m) => projectedMeshError(v, lo, hi, model, .02);
  assert.ok(err(view()) > .25);
  assert.ok(err(view(), meshMatrix({ z: 100 })) < .25);
  assert.ok(err(view(.5)) > err(view()));
  assert.ok(err(view(1.05, 844)) > err(view()));
  assert.equal(err(view(), meshMatrix({ z: .1 })), Infinity);
  const ortho = projectionOf({ kind: "ortho", center: [0, 0, 0], yaw: 0, pitch: .5, k: 30 }, 640, 360);
  assert.ok(Math.abs(err(ortho) - .6) < 1e-6);
  assert.equal(err(ortho), err(ortho, meshMatrix({ z: 100 })));
});
