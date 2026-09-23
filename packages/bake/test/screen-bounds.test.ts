import { test } from "node:test";
import assert from "node:assert/strict";
import { screenBounds } from "../src/screen-bounds.ts";
import { meshMatrix } from "../src/mesh.ts";
import { projectionOf } from "../src/project.ts";

test("bloom rectangle contains projected box interiors plus kernel padding under perspective and ortho", () => {
  for (const kind of ["persp", "ortho"] as const) for (const [width, height] of [[640, 360], [390, 844]]) for (const x of [-6, 0, 7]) {
    const view = projectionOf(kind === "persp" ? { kind, eye: [1, 2, -2], target: [0, 0, 6], fov: 1.3 } : { kind, center: [0, 0, 6], yaw: .2, pitch: .5, k: 25 }, width!, height!);
    const m = meshMatrix({ x, z: 12, yaw: .3, scale: 1.3 }), lo = [-2, 0, -1], hi = [2, 3, 1], pad = 7;
    const [l, b, w, h] = screenBounds(view, lo, hi, m, pad);
    assert.ok(l >= 0 && b >= 0 && l + w <= width! && b + h <= height!);
    for (let ix = 0; ix <= 4; ix++) for (let iy = 0; iy <= 4; iy++) for (let iz = 0; iz <= 4; iz++) {
      const p = [ix, iy, iz].map((v, a) => lo[a]! + (hi[a]! - lo[a]!) * v / 4);
      const world = [0,1,2].map(a => m[a]! * p[0]! + m[a+4]! * p[1]! + m[a+8]! * p[2]! + m[a+12]!) as [number,number,number];
      const q = view.project(world);
      for (const dx of [-pad, pad]) for (const dy of [-pad, pad]) {
        const px = Math.max(0, Math.min(width!, q[0] + dx)), py = Math.max(0, Math.min(height!, height! - q[1] + dy));
        assert.ok(px >= l - 1e-4 && px <= l + w + 1e-4 && py >= b - 1e-4 && py <= b + h + 1e-4);
      }
    }
  }
});
test("a box crossing the eye plane conservatively keeps the full bloom target", () => {
  const p = projectionOf({kind:"persp",eye:[0,0,0],target:[0,0,1],fov:1},640,360);
  assert.deepEqual(screenBounds(p,[-1,-1,-1],[1,1,1],meshMatrix()),[0,0,640,360]);
  const r = screenBounds(p,[-1,-1,-1],[1,1,1],meshMatrix({x:100,z:5}),7);
  assert.equal(r[2],0);
});
