import { test } from "node:test";
import assert from "node:assert/strict";
import { boxCorners, frustumOf, visible } from "../src/cull.ts";
import { meshMatrix } from "../src/mesh.ts";
import { projectionOf } from "../src/project.ts";

test("support culling retains every box retained by the corner reference, including scale, shear and padding", () => {
  let seed = 8317;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const corners = new Float32Array(24);
  for (const [width, height] of [[1280, 720], [390, 844]] as const) {
    const planes = frustumOf(projectionOf({ kind: "persp", eye: [4, 3, -8], target: [0, 2, 100], fov: 1.05 }, width, height, 440));
    let falseKeeps = 0;
    for (let i = 0; i < 10000; i++) {
      const lo = [-rand() * 20, -rand() * 20, -rand() * 20], hi = [rand() * 20, rand() * 100, rand() * 20];
      const m = meshMatrix({ x: rand() * 1000 - 500, y: rand() * 50, z: rand() * 700 - 200, yaw: rand() * 6, pitch: rand(), roll: rand(), scale: rand() * 4 - 2 });
      m[4]! += rand() * .4; m[10]! *= .3; // shear and nonuniform scale
      const pad = i % 3, c = boxCorners(lo, hi, m, corners);
      let reference = true;
      for (let p = 0; p < 24; p += 4) {
        let outside = 0;
        for (let v = 0; v < 24; v += 3) if (planes[p]! * c[v]! + planes[p + 1]! * c[v + 1]! + planes[p + 2]! * c[v + 2]! + planes[p + 3]! + pad < 0) outside++;
        if (outside === 8) { reference = false; break; }
      }
      const result = visible(planes, lo, hi, m, pad);
      if (reference) assert.ok(result, `false rejection ${width}x${height} box ${i}`);
      else if (result) falseKeeps++;
    }
    assert.ok(falseKeeps < 5, `culling must remain tight: ${falseKeeps} extra boxes`);
  }
});

test("vertical FOV is invariant across aspect ratios, and near/far passes project the same pixels", () => {
  const fov = 1.05, shot = { kind: "persp" as const, eye: [0, 0, 0] as [number, number, number], target: [0, 0, 1] as [number, number, number], fov };
  for (const [width, height] of [[1280, 720], [390, 844]] as const) {
    const near = projectionOf(shot, width, height, 440, undefined, { near: .05, far: 230 });
    const far = projectionOf(shot, width, height, 440, undefined, { near: 210, far: 6000 });
    const top = near.project([0, 100 * Math.tan(fov / 2), 100]);
    assert.ok(Math.abs(top[1]) < 1e-8);
    for (const z of [210, 220, 230]) for (const x of [-20, 0, 20]) assert.deepEqual(near.project([x, 4, z]), far.project([x, 4, z]));
  }
});
