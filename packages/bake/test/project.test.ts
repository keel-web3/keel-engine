// The projection contract (project.ts) and the culling that rides on it (cull.ts).
// The orthographic branch must reproduce pixelView to the bit: turning it on moves no pixel of an existing game.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pixelView } from "../src/view.ts";
import { DEPTH_RANGE, axesOf, projectionOf, shotOfView } from "../src/project.ts";
import { boundsOf, frustumOf, visible } from "../src/cull.ts";
import { meshMatrix } from "../src/mesh.ts";
import type { Vec3 } from "../src/view.ts";

const VIEWS = [
  { center: [0, 0, 0] as Vec3, yaw: 0, pitch: 0.62, pixelsPerMetre: 24, width: 480, height: 270 },
  { center: [13.5, 0, -7.25] as Vec3, yaw: 0.9, pitch: 0.5, pixelsPerMetre: 42.1, width: 421, height: 511 },
  { center: [-100, 0, 250] as Vec3, yaw: -2.2, pitch: 0.8, pixelsPerMetre: 8, width: 160, height: 120 },
];
const POINTS: Vec3[] = [[0, 0, 0], [1, 0.5, -2], [-7, 2, 11], [120, 0.2, -60], [3.25, 1.75, 4.5]];

test("project: the orthographic shot is pixelView, pixel for pixel", () => {
  for (const spec of VIEWS) {
    const view = pixelView(spec);
    const p = projectionOf(shotOfView(view), spec.width, spec.height);
    assert.equal(p.k, spec.pixelsPerMetre);
    for (const axis of ["right", "up", "forward"] as const) {
      for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(p[axis][i]! - view.axes[axis][i]!) < 1e-12, `${axis}[${i}]`);
    }
    for (const q of POINTS) {
      const [vx, vy] = view.project(q);
      const [px, py] = p.project(q);
      assert.ok(Math.abs(px - vx) < 1e-9 && Math.abs(py - vy) < 1e-9, `${q} -> ${px},${py} vs ${vx},${vy}`);
    }
  }
});

test("project: the clip matrix agrees with project(), under both shots", () => {
  const apply = (m: Float32Array, q: Vec3): [number, number, number, number] => [0, 1, 2, 3].map((r) =>
    m[r]! * q[0]! + m[4 + r]! * q[1]! + m[8 + r]! * q[2]! + m[12 + r]!) as [number, number, number, number];
  const shots = [
    shotOfView(pixelView(VIEWS[1]!)),
    { kind: "persp", eye: [4, 2.5, -8] as Vec3, target: [0, 0.8, 0] as Vec3, fov: 1.1 } as const,
  ];
  for (const shot of shots) {
    const p = projectionOf(shot, 640, 360);
    for (const q of POINTS) {
      // (A point behind a perspective camera has no picture position at all: both sides are free to say anything.)
      const fd = (q[0] - p.origin[0]) * p.forward[0] + (q[1] - p.origin[1]) * p.forward[1] + (q[2] - p.origin[2]) * p.forward[2];
      if (p.kind === "persp" && fd < 0.5) continue;
      const [cx, cy, cz, cw] = apply(p.clip, q);
      const w = cw || 1;
      const [px, py, depth] = p.project(q);
      // Clip -> picture pixels, the usual way.
      const sx = (cx / w * 0.5 + 0.5) * 640, sy = (0.5 - cy / w * 0.5) * 360;
      // (The matrix is float32 -- what the GPU is handed -- so it agrees to well under a thousandth of a pixel, not to the bit.)
      assert.ok(Math.abs(sx - px) < 1e-3 && Math.abs(sy - py) < 1e-3, `${shot.kind} ${q}: ${sx},${sy} vs ${px},${py}`);
      // Clip z is the HARDWARE depth: under ortho it IS the contract (0.5 + fd / far, after the viewport); under
      // perspective it only has to sort the same way, because the pass writes the contract itself to gl_FragDepth.
      const hw = cz / w * 0.5 + 0.5;
      if (shot.kind === "ortho") assert.ok(Math.abs(hw - depth) < 1e-6, `ortho ${q}: hardware ${hw} vs contract ${depth}`);
      else assert.ok(hw > 0 && hw < 1 && (hw - 0.5) * (depth - 0.5) >= 0, `persp ${q}: hardware ${hw}, contract ${depth}`);
    }
  }
});

test("project: a perspective camera looking the way a pixel view looks has the SAME axes (right way up, not mirrored)", () => {
  for (const [yaw, pitch] of [[0, 0.62], [0.9, 0.5], [-2.2, 0.3], [Math.PI, 0.7]] as const) {
    const ortho = axesOf({ kind: "ortho", center: [0, 0, 0], yaw, pitch, k: 20 });
    const f = ortho.forward;
    const persp = axesOf({ kind: "persp", eye: [0, 5, 0], target: [f[0] * 10, 5 + f[1] * 10, f[2] * 10], fov: 1 });
    for (const axis of ["right", "up", "forward"] as const) for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(persp[axis][i]! - ortho[axis][i]!) < 1e-9, `yaw ${yaw} pitch ${pitch}: ${axis}[${i}] ${persp[axis][i]} vs ${ortho[axis][i]}`);
    }
    // And up points up the world, as a camera's should.
    assert.ok(persp.up[1] > 0, "up has a positive y");
  }
});

test("project: the hardware depth sorts the way the contract does (perspective)", () => {
  const p = projectionOf({ kind: "persp", eye: [0, 2, -10], target: [0, 1, 0], fov: 1.1 }, 320, 180);
  const apply = (q: Vec3): number => {
    const m = p.clip;
    const z = m[2]! * q[0]! + m[6]! * q[1]! + m[10]! * q[2]! + m[14]!;
    const w = m[3]! * q[0]! + m[7]! * q[1]! + m[11]! * q[2]! + m[15]!;
    return z / w;
  };
  let last = -Infinity;
  for (let d = 1; d < 90; d += 7) {
    const z = apply([0, 1, -10 + d]);
    assert.ok(z > last, `depth must grow with distance at ${d} m`);
    last = z;
  }
});

test("project: depth is linear forward distance, the same under either shot", () => {
  const eye: Vec3 = [0, 3, -10];
  const persp = projectionOf({ kind: "persp", eye, target: [0, 1, 0], fov: 1 }, 320, 180);
  // A point twice as far along the view is twice as deep from the origin (a radial measure would not be).
  const near: Vec3 = [0, 1, 0], far: Vec3 = [0, 1, 10];
  const dNear = persp.project(near)[2] - 0.5, dFar = persp.project(far)[2] - 0.5;
  const along = (q: Vec3) => (q[0] - eye[0]) * persp.forward[0] + (q[1] - eye[1]) * persp.forward[1] + (q[2] - eye[2]) * persp.forward[2];
  assert.ok(Math.abs(dNear - along(near) / DEPTH_RANGE) < 1e-6);
  assert.ok(Math.abs(dFar - along(far) / DEPTH_RANGE) < 1e-6);
  // Off to one side, depth is the forward distance -- not the distance to the eye.
  const side: Vec3 = [8, 1, 0];
  assert.ok(Math.abs((persp.project(side)[2] - 0.5) - along(side) / DEPTH_RANGE) < 1e-6);
});

test("cull: a box behind the camera is skipped, one in front is kept, both ways round", () => {
  const lo = [-1, 0, -2], hi = [1, 1.4, 2];
  for (const shot of [
    shotOfView(pixelView(VIEWS[0]!)),
    { kind: "persp", eye: [0, 2, -12] as Vec3, target: [0, 1, 0] as Vec3, fov: 1.2 } as const,
  ]) {
    const planes = frustumOf(projectionOf(shot, 480, 270));
    assert.equal(visible(planes, lo, hi, meshMatrix({ x: 0, z: 0 })), true, `${shot.kind}: at the centre`);
    assert.equal(visible(planes, lo, hi, meshMatrix({ x: 0, z: -400 })), false, `${shot.kind}: far behind`);
    assert.equal(visible(planes, lo, hi, meshMatrix({ x: 900, z: 0 })), false, `${shot.kind}: far to the side`);
  }
});

test("cull: what is IN the picture is kept -- including everything nearer than the view's centre", () => {
  // (The near plane is the one that is easy to get wrong: clip z runs -w..w, so half the picture sits at z < 0.)
  const view = pixelView({ center: [0, 0, 0], yaw: 0, pitch: 0.62, pixelsPerMetre: 21, width: 420, height: 510 });
  const planes = frustumOf(projectionOf(shotOfView(view), 420, 510, (510 / 21) * 4));
  const lo = [-0.9, 0, -2.2], hi = [0.9, 1.3, 2.2];
  for (let py = 20; py < 500; py += 60) {
    const g = view.ground(210, py);                       // a car on the ground under that row of the picture
    assert.equal(visible(planes, lo, hi, meshMatrix({ x: g[0], z: g[2] })), true, `row ${py} (${g[0].toFixed(1)}, ${g[2].toFixed(1)}) must be drawn`);
  }
});

test("cull: bounds cover every placed corner", () => {
  const lo = [-1, 0, -2], hi = [1, 1.4, 2];
  const b = boundsOf([
    { lo, hi, m: meshMatrix({ x: 10, z: 0 }) },
    { lo, hi, m: meshMatrix({ x: -4, z: 30, yaw: Math.PI / 4 }) },
  ]);
  assert.ok(b[0]! <= -4 - 2 && b[3]! >= 10 + 1, `x ${b[0]}..${b[3]}`);
  assert.ok(b[1]! <= 0 && b[4]! >= 1.4 - 1e-6, `y ${b[1]}..${b[4]}`);
  assert.ok(b[2]! <= -2 && b[5]! >= 30 + 2, `z ${b[2]}..${b[5]}`);
});
