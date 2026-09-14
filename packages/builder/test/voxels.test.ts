// The voxel model, editing (ops, symmetry, undo/redo, the replayable log),
// the compact serialisation and greedy box merging.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  AXIS_ORDERS, createEditor, createVoxels, decodeVoxels, encodeVoxels, fromBase64, generate, greedyBoxes, greedyGrid, imagesOf, labelGrid, meshStats, rasterize,
  replayOps, roleCounts, sameVoxels, toBase64, voxelStats, voxelsToText,
} from "../src/index.ts";
import type { VoxelModel } from "../src/index.ts";
import { dog, doorway, flag, blockPerson, topHat } from "./models.ts";

const cells = (m: VoxelModel): string[] => { const out: string[] = []; m.forEach((x, y, z, v) => out.push(`${x},${y},${z}:${m.roles[v - 1]}`)); return out.sort(); };

test("cells hold roles, not colours; chunks come and go; bounds and pivot follow", () => {
  const m = createVoxels({ unit: 0.1 });
  assert.equal(m.set(0, 0, 0, "primary"), 0);
  m.set(-17, 3, 40, "glow");
  m.set(2047, -2048, 5, "trim");
  assert.equal(m.count, 3);
  assert.equal(m.roleAt(-17, 3, 40), "glow");
  assert.equal(m.get(1, 1, 1), 0);
  assert.deepEqual(m.bounds(), { min: [-17, -2048, 0], max: [2047, 3, 40] });
  m.set(2047, -2048, 5, null);
  assert.equal(m.count, 2);
  assert.deepEqual(m.bounds(), { min: [-17, 0, 0], max: [0, 3, 40] });
  assert.deepEqual(m.pivot(), [-8, 0, 20.5]);
  assert.throws(() => m.set(2048, 0, 0, "primary"), /-2048..2047/);
  assert.throws(() => m.set(0, 0, 0, "Bad Role"), /lower-case/);
  assert.throws(() => m.set(0.5, 0, 0, "primary"), /whole numbers/);
  const c = m.clone();
  assert.ok(sameVoxels(m, c));
  c.set(0, 0, 0, "dark");
  assert.ok(!sameVoxels(m, c));
});

test("brush ops: box (and hollow), fill only over a role, sphere, line, erase, recolour", () => {
  const ed = createEditor();
  assert.equal(ed.box([0, 0, 0], [3, 3, 3], "primary"), 64);
  assert.equal(ed.box([10, 0, 0], [13, 3, 3], "trim", { hollow: true }), 64 - 8);
  assert.equal(ed.fill([0, 0, 0], [3, 0, 3], "dark", "primary"), 16);
  assert.equal(ed.fill([0, 0, 0], [5, 0, 5], "skin", null), 36 - 16);
  const n = ed.sphere([20.5, 5.5, 0.5], 2, "glow");
  assert.equal(n, 33);  // (centres within 2 of the middle of voxel 20,5,0)
  assert.equal(ed.line([0, 10, 0], [6, 13, 0], "accent"), 7);
  assert.equal(ed.recolour("dark", "secondary"), 16);
  assert.equal(roleCounts(ed.model)["secondary"], 16);
  assert.equal(ed.erase([10, 0, 0], [13, 3, 3]), 56);
  assert.equal(ed.model.count, 64 + 20 + 33 + 7);
});

test("symmetry: x, xz and four turns write every image once; the plane through a voxel keeps its middle column", () => {
  assert.deepEqual(imagesOf(2, 0, 0, { mode: "x" }), [[2, 0, 0], [-3, 0, 0]]);
  assert.deepEqual(imagesOf(0, 0, 0, { mode: "x", center: [0.5, 0] }), [[0, 0, 0]]);
  assert.equal(imagesOf(3, 0, 1, { mode: "xz" }).length, 4);
  assert.equal(new Set(imagesOf(3, 0, 1, { mode: "radial4" }).map(String)).size, 4);
  const ed = createEditor(createVoxels(), { symmetry: { mode: "x" } });
  ed.box([1, 0, 0], [2, 1, 0], "primary");
  assert.equal(ed.model.count, 8);
  for (const x of [1, 2, -2, -3]) assert.equal(ed.model.roleAt(x, 0, 0), "primary");
  // Mirror copies the kept side over the other and clears what the copy doesn't cover.
  const e2 = createEditor();
  e2.box([0, 0, 0], [2, 0, 0], "primary");
  e2.set([-5, 0, 0], "dark");
  e2.mirror("x");
  assert.deepEqual(cells(e2.model), ["-1,0,0:primary", "-2,0,0:primary", "-3,0,0:primary", "0,0,0:primary", "1,0,0:primary", "2,0,0:primary"].sort());
});

test("undo and redo are exact, history stores diffs, the log rebuilds the model", () => {
  const ed = createEditor(createVoxels(), { symmetry: { mode: "x" } });
  const states: string[][] = [cells(ed.model)];
  ed.box([0, 0, -2], [3, 5, 1], "primary"); states.push(cells(ed.model));
  ed.sphere([0, 8, 0], 3, "skin"); states.push(cells(ed.model));
  ed.symmetry = { mode: "none" };
  ed.set([5, 5, 5], "glow"); states.push(cells(ed.model));
  ed.box([-2, 0, -2], [1, 2, 1], null); states.push(cells(ed.model));
  for (let i = states.length - 2; i >= 0; i -= 1) { assert.ok(ed.undo()); assert.deepEqual(cells(ed.model), states[i]); }
  assert.ok(!ed.undo());
  for (let i = 1; i < states.length; i += 1) { assert.ok(ed.redo()); assert.deepEqual(cells(ed.model), states[i]); }
  assert.ok(!ed.redo());
  // (Undo then a new op drops the redo branch.)
  ed.undo(); ed.set([9, 9, 9], "dark");
  assert.ok(!ed.canRedo);
  const h = ed.history();
  assert.equal(h.entries, 4);
  assert.ok(h.bytes <= h.cells * 8);
  // The log (symmetry ops where it changed) replays to the same model.
  const log = ed.log();
  assert.deepEqual(log.filter((o) => o.op === "symmetry").map((o) => (o as { mode: string }).mode), ["x", "none"]);
  assert.deepEqual(cells(replayOps(JSON.parse(JSON.stringify(log)))), cells(ed.model));
});

const SAMPLES: Array<[string, () => VoxelModel]> = [
  ["block-person", blockPerson], ["dog", dog], ["top hat", topHat], ["flag", flag], ["doorway", doorway],
  ...(["crate", "banner", "tree", "lamp", "windmill"] as const).map((k): [string, () => VoxelModel] => [k, () => generate(k, "1").model]),
  ["critter (4 legs)", () => generate("critter", "5", { plan: "quadruped" }).model], ["critter (2 legs)", () => generate("critter", "5", { plan: "humanoid" }).model],
];

test("serialisation round-trips (bytes and text) with roles, groups, unit, origin and name; sizes", () => {
  const rows: string[] = [];
  for (const [name, make] of SAMPLES) {
    const m = make();
    m.origin = [0.5, 0, -1];
    const bytes = encodeVoxels(m);
    const back = decodeVoxels(bytes);
    assert.ok(sameVoxels(m, back), `${name}: bytes round-trip`);
    assert.equal(back.name, m.name);
    const text = voxelsToText(m);
    assert.ok(sameVoxels(m, decodeVoxels(text)), `${name}: text round-trip`);
    const st = voxelStats(m);
    assert.equal(st.bytes, bytes.length);
    // (A KEEL module is gzip'd per leaf: what the bytes cost there.)
    const gz = gzipSync(bytes, { level: 9 }).length;
    assert.ok(bytes.length < st.box, `${name}: smaller than its dense box (${bytes.length} vs ${st.box})`);
    rows.push(`${name.padEnd(18)} ${String(m.count).padStart(5)} voxels  box ${String(st.box).padStart(5)}  ${String(bytes.length).padStart(4)} B  gzip ${String(gz).padStart(4)} B  text ${String(text.length).padStart(4)} ch`);
  }
  console.log(`\n${rows.join("\n")}`);
  assert.throws(() => decodeVoxels("KV1:AAAA"), /header|Not voxel/);
  assert.throws(() => decodeVoxels("nope"), /KV1/);
  for (let n = 0; n < 40; n += 1) { const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255); assert.deepEqual(fromBase64(toBase64(b)), b); }
});

test("greedy boxes: the union is the voxel set exactly, every box one label, far fewer than voxels", () => {
  const rows: string[] = [];
  for (const [name, make] of SAMPLES) {
    const m = make();
    const boxes = greedyBoxes(m);
    const cover = rasterize(boxes);  // (throws on overlap)
    assert.equal(cover.size, m.count, `${name}: covers every voxel once`);
    m.forEach((x, y, z, v) => assert.equal(cover.get(`${x},${y},${z}`), v, `${name}: ${x},${y},${z} has its role's box`));
    const st = meshStats(m);
    assert.ok(st.boxes <= st.runs && st.runs <= st.voxels);
    // "best" is never worse than any single axis order.
    const d = m.dense();
    const labels = labelGrid(d);
    for (const o of AXIS_ORDERS) assert.ok(boxes.length <= greedyGrid(labels, d.size, d.min, o).length);
    rows.push(`${name.padEnd(18)} ${String(st.voxels).padStart(5)} voxels -> ${String(st.runs).padStart(4)} row runs -> ${String(st.boxes).padStart(3)} boxes (${(st.voxels / st.boxes).toFixed(1)}x)`);
  }
  console.log(`\n${rows.join("\n")}`);
  // Random clouds: still exact.
  for (let seed = 1; seed <= 20; seed += 1) {
    const m = createVoxels();
    let s = seed;
    const r = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 300; i += 1) m.set(Math.floor(r() * 12) - 6, Math.floor(r() * 8), Math.floor(r() * 10) - 5, ["primary", "trim", "dark"][Math.floor(r() * 3)]!);
    const cover = rasterize(greedyBoxes(m));
    assert.equal(cover.size, m.count);
    m.forEach((x, y, z, v) => assert.equal(cover.get(`${x},${y},${z}`), v));
  }
  // A solid 12x8 flag is one box.
  const f = createVoxels();
  createEditor(f).box([0, 0, 0], [11, 7, 0], "primary");
  assert.equal(greedyBoxes(f).length, 1);
});
