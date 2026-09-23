import assert from "node:assert/strict";
import { test } from "node:test";
import { CHUNK, CHUNK_TEXELS, FAR, ROAD_CLASS, fieldWindow, locate, loopGraph, pathThrough, pointAt, roadField, roadGraph, straight, tightest } from "../src/index.ts";

const circle = (r: number, n = 12): { x: number[]; z: number[] } => {
  const x: number[] = [], z: number[] = [];
  for (let i = 0; i < n; i += 1) { const a = (i / n) * Math.PI * 2; x.push(Math.sin(a) * r); z.push(Math.cos(a) * r); }
  return { x, z };
};

test("path: a spline through points is sampled a metre apart and its curvature is the circle's", () => {
  const c = circle(80);
  const p = pathThrough(c.x, c.z, { closed: true });
  assert.ok(Math.abs(p.length - 2 * Math.PI * 80) < 3, `length ${p.length}`);
  for (let i = 0; i < p.length; i += 1) {
    const j = (i + 1) % p.length;
    assert.ok(Math.abs(Math.hypot(p.x[j]! - p.x[i]!, p.z[j]! - p.z[i]!) - 1) < 0.05);
  }
  // (Round clockwise from +z toward +x: a right-hander all the way, 1/80.)
  assert.ok(Math.abs(p.curve[100]! - 1 / 80) < 0.002, `curve ${p.curve[100]}`);
  assert.ok(Math.abs(tightest(p) - 1 / 80) < 0.003);
});

test("path: an open path runs exactly end to end", () => {
  const p = pathThrough([0, 40, 90], [0, 30, 20]);
  assert.ok(Math.hypot(p.x[0]!, p.z[0]!) < 1e-9);
  assert.ok(Math.hypot(p.x[p.length - 1]! - 90, p.z[p.length - 1]! - 20) < 1e-9);
});

test("path: locate is pointAt's inverse, on and off the line, round a loop's seam", () => {
  const c = circle(60);
  const p = pathThrough(c.x, c.z, { closed: true });
  for (const s of [3.5, 120.25, p.length - 0.75]) for (const d of [-4, 0, 5.5]) {
    const q = pointAt(p, s, d);
    const l = locate(p, q.x, q.z);
    const ds = Math.abs(l.s - s), wrap = Math.min(ds, p.length - ds);
    assert.ok(wrap < 0.15 && Math.abs(l.d - d) < 0.15, `s ${s} d ${d} -> ${l.s} ${l.d}`);
  }
});

test("graph: every class holds its width -- an arterial narrower than a four-abreast road is refused", () => {
  const nodes = [{ id: 0, x: 0, z: 0 }, { id: 1, x: 100, z: 0 }];
  assert.throws(() => roadGraph(nodes, [{ a: 0, b: 1, cls: "arterial", path: straight(0, 0, 100, 0), half: 6 }]), /arterial/);
  const g = roadGraph(nodes, [{ a: 0, b: 1, cls: "arterial", path: straight(0, 0, 100, 0) }]);
  assert.equal(g.edges[0]!.half, ROAD_CLASS.arterial.minHalf);
  assert.ok(ROAD_CLASS.arterial.minHalf * 2 >= 14.6 && ROAD_CLASS.highway.minHalf >= ROAD_CLASS.arterial.minHalf);
  assert.deepEqual(g.at, [[0], [0]]);
});

test("field: a texel says where the road is -- distance, width, along, and 'no road' past its reach", () => {
  const g = roadGraph([{ id: 0, x: 0, z: 10 }, { id: 1, x: 120, z: 10 }], [{ a: 0, b: 1, cls: "street", path: straight(0, 10, 120, 10) }]);
  const f = roadField(g);
  const c = f.chunk(0, 0);
  assert.equal(c.data.length, CHUNK_TEXELS * CHUNK_TEXELS * 4);
  // (Texel at x = 20.25, z = 12.25: 2.25 m off a road running +x; its right is -z, so this side is negative.)
  const k = (12 * 2) * CHUNK_TEXELS + 20 * 2;
  assert.ok(Math.abs(c.data[k * 4]! + 2.25) < 1e-4, `d ${c.data[k * 4]}`);
  assert.equal(c.data[k * 4 + 1], ROAD_CLASS.street.minHalf);
  assert.ok(Math.abs(c.data[k * 4 + 2]! - 20.25) < 0.05);
  assert.equal(c.edge[k], 0);
  // Far from it: nothing.
  const far = f.chunk(0, 3);
  assert.equal(far.data[0], FAR);
  assert.equal(far.edge[0], -1);
  // The exact query agrees with the texel.
  const at = f.at(20.25, 12.25)!;
  assert.ok(Math.abs(at.d + 2.25) < 1e-6 && at.edge === 0);
  assert.equal(f.at(20, 10 + CHUNK * 2), null);
});

test("field: a chunk is the same bytes whatever order the chunks are made in", () => {
  const c = circle(70);
  const g = loopGraph(pathThrough(c.x, c.z, { closed: true }), "arterial");
  const a = roadField(g), b = roadField(g);
  const order = [[-2, -2], [1, 0], [-1, 1], [0, -1]] as const;
  for (const [x, z] of order) a.chunk(x, z);
  for (const [x, z] of [...order].reverse()) b.chunk(x, z);
  for (const [x, z] of order) {
    assert.deepEqual(a.chunk(x, z).data, b.chunk(x, z).data);
    assert.deepEqual(a.chunk(x, z).edge, b.chunk(x, z).edge);
  }
});

test("field: where three roads meet is a junction -- tarmac without lines", () => {
  const nodes = [{ id: 0, x: 0, z: 0 }, { id: 1, x: 80, z: 0 }, { id: 2, x: -80, z: 0 }, { id: 3, x: 0, z: 80 }];
  const g = roadGraph(nodes, [
    { a: 0, b: 1, cls: "arterial", path: straight(0, 0, 80, 0) },
    { a: 0, b: 2, cls: "arterial", path: straight(0, 0, -80, 0) },
    { a: 0, b: 3, cls: "street", path: straight(0, 0, 0, 80) },
  ]);
  const f = roadField(g);
  assert.equal(f.at(1, 1)!.junction, true);
  assert.equal(f.at(40, 1)!.junction, false);
});

test("field: a window rasterised all at once agrees with the chunked field texel for texel", () => {
  const c = circle(70);
  const g = loopGraph(pathThrough(c.x, c.z, { closed: true }), "arterial");
  const w = fieldWindow(g, 0, 0, CHUNK_TEXELS, CHUNK_TEXELS, 2), ch = roadField(g).chunk(0, 0);
  for (let k = 0; k < CHUNK_TEXELS * CHUNK_TEXELS; k += 97) {
    assert.equal(w.edge[k], ch.edge[k]);
    for (let q = 0; q < 4; q += 1) assert.ok(Math.abs(w.data[k * 4 + q]! - ch.data[k * 4 + q]!) < 1e-6, `texel ${k} channel ${q}`);
  }
});
