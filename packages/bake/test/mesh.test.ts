import { test } from "node:test";
import assert from "node:assert/strict";
import { lookMesh, mergeMeshes, meshMatrix, mulMatrix, poseMatrices } from "../src/mesh.ts";

test("lookMesh: a box is 6 faces with slot, surface coordinate and part per vertex", () => {
  const m = lookMesh({ boxes: [{ c: [0, 1, 0], h: [1, 0.5, 2], mat: 7 }] });
  assert.equal(m.positions.length / 3, 24);
  assert.equal(m.indices.length, 36);
  for (let v = 0; v < 24; v += 1) {
    assert.equal(m.attrs[v * 4], 7);
    assert.ok(m.attrs[v * 4 + 1]! >= 0 && m.attrs[v * 4 + 1]! <= 1 && m.attrs[v * 4 + 2]! >= 0 && m.attrs[v * 4 + 2]! <= 1);
    assert.equal(m.attrs[v * 4 + 3], 0);
  }
  const ys = Array.from({ length: 24 }, (_, v) => m.positions[v * 3 + 1]!);
  assert.equal(Math.min(...ys), 0.5); assert.equal(Math.max(...ys), 1.5);
});

test("lookMesh: parts count up across solids; mergeMeshes keeps them apart", () => {
  const a = lookMesh({ boxes: [{ c: [0, 0, 0], h: [1, 1, 1] }], capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: 0.2, mat: 3 }] });
  const parts = new Set(Array.from({ length: a.attrs.length / 4 }, (_, v) => a.attrs[v * 4 + 3]));
  assert.deepEqual([...parts].sort(), [0, 1]);
  const m = mergeMeshes([a, a]);
  assert.equal(new Set(Array.from({ length: m.attrs.length / 4 }, (_, v) => m.attrs[v * 4 + 3])).size, 4);
  assert.equal(Math.max(...m.indices), m.positions.length / 3 - 1);
});

test("meshMatrix: yaw turns local +z to the heading (frame convention), mulMatrix composes", () => {
  const m = meshMatrix({ x: 1, z: 2, yaw: Math.PI / 2 });
  // local (0,0,1) -> (sin yaw, 0, cos yaw) + translation
  assert.ok(Math.abs(m[8]! + m[12]! - 2) < 1e-6 && Math.abs(m[10]! + m[14]! - 2) < 1e-6);
  const spin = mulMatrix(meshMatrix({ y: 0.3 }), mulMatrix(meshMatrix({ pitch: 1 }), meshMatrix({ y: -0.3 })));
  // (the axle's centre stays put)
  const y = spin[5]! * 0.3 + spin[13]!, z = spin[6]! * 0.3 + spin[14]!;
  assert.ok(Math.abs(y - 0.3) < 1e-6 && Math.abs(z) < 1e-6);
});

test("poseMatrices: a part's rest solid lands exactly where the posed frame puts it", () => {
  const rest = {
    boxes: [{ c: [0, 1, 0], h: [0.5, 0.5, 0.5], yaw: 0, mat: 1 }],
    capsules: [{ a: [0, 1, 0], b: [0, 2, 0], r: 0.2, mat: 2 }],
  };
  const posed = {
    // (the box turned and stretched; the limb swung out and a little fatter and longer)
    boxes: [{ c: [1, 1.2, -0.5], h: [0.5, 0.75, 0.5], yaw: Math.PI / 3, mat: 1 }],
    capsules: [{ a: [0, 1, 0], b: [1.2, 1.6, 0.4], r: 0.26, mat: 2 }],
  };
  const m = poseMatrices(rest, posed);
  assert.equal(m.length, 32);
  const at = (i: number, p: readonly number[]): number[] => {
    const o = i * 16;
    return [0, 1, 2].map((r) => m[o + r]! * p[0]! + m[o + 4 + r]! * p[1]! + m[o + 8 + r]! * p[2]! + m[o + 12 + r]!);
  };
  const near = (a: readonly number[], b: readonly number[], what: string) => { for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(a[i]! - b[i]!) < 1e-5, `${what}: ${a} vs ${b}`); };
  // The box's centre, and its +x corner turned with it.
  near(at(0, [0, 1, 0]), [1, 1.2, -0.5], "box centre");
  const c = Math.cos(Math.PI / 3), s = Math.sin(Math.PI / 3);
  near(at(0, [0.5, 1.5, 0]), [1 + 0.5 * c, 1.2 + 0.75, -0.5 - 0.5 * s], "box corner");
  // The limb's ends, and a point on its surface out at the rest radius.
  near(at(1, [0, 1, 0]), [0, 1, 0], "limb root");
  near(at(1, [0, 2, 0]), [1.2, 1.6, 0.4], "limb tip");
  const r = at(1, [0.2, 1, 0]);
  assert.ok(Math.abs(Math.hypot(r[0]! - 0, r[1]! - 1, r[2]! - 0) - 0.26) < 1e-5, `limb girth: ${r}`);
});

test("lookMesh: a facade grid measures side faces in storeys and bays -- 40 rows on a 40-storey box, 4 on a 4-storey one", () => {
  const rows = (storeys: number): { rows: number; bays: number; tops: boolean } => {
    const m = lookMesh({ boxes: [{ c: [0, storeys * 1.75, 0], h: [9, storeys * 1.75, 6], grid: [3, 3.5, 2, 0], mat: 0 }] });
    let vMax = 0, uMax = 0, tops = true;
    for (let v = 0; v < m.attrs.length / 4; v += 1) {
      const u = m.attrs[v * 4 + 1]!, w = m.attrs[v * 4 + 2]!, ny = m.normals[v * 3 + 1]!;
      if (Math.abs(ny) > 0.5) { tops &&= u >= 0 && u <= 1 && w >= 0 && w <= 1; continue; }
      assert.ok(u <= -1, "a grid face's u is flagged below zero");
      vMax = Math.max(vMax, w); uMax = Math.max(uMax, -u - 1);
    }
    return { rows: Math.round(vMax), bays: Math.round(uMax - 2), tops };
  };
  assert.deepEqual(rows(40), { rows: 40, bays: 6, tops: true });
  assert.deepEqual(rows(4), { rows: 4, bays: 6, tops: true });
});
