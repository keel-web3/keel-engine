// Voxelisation against analytic shapes (a box exactly, a ball within half a
// cell of its surface), flood and parity fills agreeing on closed meshes, a
// hollow shell staying hollow, an open sheet staying a sheet, each node
// keeping its own cells where meshes overlap, texture colours sampled at the
// cells, skin joints carried, sizes and guards, determinism.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addBall, addBox, addSheet, chestBuild, knightBuild, meshData, parseGltf, parseVox, robotVox, voxelize, writeGlb } from "../src/index.ts";
import type { MeshData, VoxelGrid } from "../src/index.ts";

const one = (mesh: MeshData, name = "thing") => parseGltf(writeGlb({ nodes: [{ name, mesh: 0 }], meshes: [{ name, primitives: [{ mesh, material: 0 }] }], materials: [{ name: "m", colour: [1, 0, 0, 1] }] }));
const filled = (g: VoxelGrid): number => g.stats.surface + g.stats.interior;

test("a box voxelises exactly: every cell, the shell one cell deep", () => {
  const m = meshData(); addBox(m, [0, 0.5, 0], [0.5, 0.5, 0.5]);
  const g = voxelize(one(m), { voxels: 32 });
  assert.deepEqual(g.size, [32, 32, 32]);
  assert.equal(filled(g), 32 ** 3);
  assert.equal(g.stats.surface, 32 ** 3 - 30 ** 3);
  assert.ok(Math.abs(filled(g) * g.unit ** 3 - 1) < 1e-9, "volume 1 m3");
});

test("a ball: the volume between its interior and its outer skin, the skin half a cell thick, as parity says too", () => {
  const m = meshData(); addBall(m, [0, 0.5, 0], [0.5, 0.5, 0.5], {}, 64);
  const s = one(m);
  for (const n of [24, 40]) {
    const g = voxelize(s, { voxels: n });
    const u = g.unit;
    const V = (r: number): number => (4 / 3) * Math.PI * r ** 3;
    const inner = g.stats.interior * u ** 3, total = filled(g) * u ** 3;
    assert.ok(inner < V(0.5) && V(0.5) < total, `${n}: ${inner} < ${V(0.5)} < ${total}`);
    // (The thin skin keeps cells whose centres are within half a cell of the surface: the ball grows by about u/2.)
    assert.ok(Math.abs(total / V(0.5 + u / 2) - 1) < 0.04, `${n}: ${total} vs ${V(0.5 + u / 2)}`);
    // Surface cells against the sphere's area: one to one and a half cells per unit of area.
    const perArea = g.stats.surface / (4 * Math.PI * 0.25 / u ** 2);
    assert.ok(perArea > 1 && perArea < 1.5, `${n}: ${perArea} surface cells per cell of area`);
    const p = voxelize(s, { voxels: n, fill: "parity" });
    assert.deepEqual([...p.occ].map((v) => (v ? 1 : 0)), [...g.occ].map((v) => (v ? 1 : 0)), "flood and parity agree on a closed ball");
    // Conservative keeps every touched cell: more.
    const c = voxelize(s, { voxels: n, surface: "conservative" });
    assert.ok(filled(c) > filled(g));
  }
});

test("a hollow shell stays hollow, an open sheet stays a sheet, nothing is filled with fill: none", () => {
  // The knight's helmet alone: a closed dome shell, hollow inside.
  const k = parseGltf(writeGlb(knightBuild()));
  const helmetOnly = { ...k, nodes: k.nodes.map((n) => (n.name === "Helmet" || n.mesh === undefined ? n : { ...n, mesh: undefined })) } as typeof k;
  const hg = voxelize(helmetOnly as never, { unit: 0.01 });
  const [sx, sy, sz] = hg.size;
  const mid = Math.floor(sx / 2) + sx * (Math.floor(sy * 0.45) + sy * Math.floor(sz / 2));
  assert.equal(hg.occ[mid], 0, "the middle of the helmet is air");
  assert.ok(hg.stats.interior > 0, "the shell has an inside of its own");
  const sheet = meshData(); addSheet(sheet, [-0.5, 0, 0], [0.5, 0, 0], [-0.5, 1, 0], 0.001);
  const sg = voxelize(one(sheet), { voxels: 20 });
  assert.equal(sg.stats.interior, 0);
  assert.ok(sg.size[2] <= 2 && sg.stats.surface >= 20 * 20 * 0.9);
  const m = meshData(); addBox(m, [0, 0.5, 0], [0.5, 0.5, 0.5]);
  assert.equal(voxelize(one(m), { voxels: 10, fill: "none" }).stats.interior, 0);
});

test("overlapping meshes keep their own cells: the sword's grip in the hand, the helmet over the head; joints ride along", () => {
  const s = parseGltf(writeGlb(knightBuild()));
  const g = voxelize(s, { voxels: 64 });
  const nodeOf = (name: string): number => g.nodeNames.indexOf(name);
  const count = new Map<number, number>();
  for (let i = 0; i < g.occ.length; i += 1) if (g.occ[i]) count.set(g.node[i]!, (count.get(g.node[i]!) ?? 0) + 1);
  for (const n of ["Body", "Helmet", "Shield", "Cape", "Sword", "Belt"]) assert.ok((count.get(nodeOf(n)) ?? 0) > 20, `${n} has cells`);
  // Every Helmet cell is skinned to the Head joint, every Sword cell to the RightHand.
  const joint = (name: string): number => s.nodes.findIndex((n) => n.name === name);
  for (let i = 0; i < g.occ.length; i += 1) {
    if (g.node[i] === nodeOf("Helmet")) assert.equal(g.joint[i], joint("Head"));
    if (g.node[i] === nodeOf("Sword")) assert.equal(g.joint[i], joint("RightHand"));
  }
  // The grip runs through the hand: the sword owns cells between the hand's cells.
  let gripInHand = 0;
  const [sx, sy] = g.size;
  for (let i = 0; i < g.occ.length; i += 1) {
    if (g.node[i] !== nodeOf("Sword")) continue;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    const at = (dx: number, dz: number): number => g.node[x + dx + sx * (y + sy * (z + dz))]!;
    if (at(1, 0) === nodeOf("Body") && at(-1, 0) === nodeOf("Body")) gripInHand += 1;
  }
  assert.ok(gripInHand > 0, "the grip is inside the hand, and still the sword's");
  // Surface colours are the material's (linear): the helmet steel, the tunic blue.
  for (let i = 0; i < g.occ.length; i += 1) if (g.node[i] === nodeOf("Helmet") && g.occ[i] === 1) { assert.ok(g.colour[i * 3 + 2]! > g.colour[i * 3]!, "steel is bluish grey"); break; }
});

test("texture colours are sampled at the cells (the chest's wood: planks and seams), deterministically", () => {
  const s = parseGltf(writeGlb(chestBuild()));
  const a = voxelize(s, { voxels: 40 }), b = voxelize(s, { voxels: 40 });
  assert.deepEqual([...a.colour], [...b.colour]);
  assert.deepEqual([...a.node], [...b.node]);
  const wood = a.materialNames.indexOf("Wood");
  const lum = new Set<number>();
  for (let i = 0; i < a.occ.length; i += 1) if (a.occ[i] === 1 && a.material[i] === wood) lum.add(Math.round((a.colour[i * 3]! + a.colour[i * 3 + 1]! + a.colour[i * 3 + 2]!) * 50));
  assert.ok(lum.size >= 6, `the wood's cells carry the texture's shades (${lum.size})`);
  assert.ok(Math.min(...lum) < Math.max(...lum) * 0.6, "seams darker than planks");
});

test("sizes: cells along the longest side, a unit, a height to size it to; a guard against too many cells; .vox as it is", () => {
  const m = meshData(); addBox(m, [0, 1, 0], [0.5, 1, 0.25]);
  const s = one(m);
  assert.deepEqual(voxelize(s, { voxels: 20 }).size, [10, 20, 5]);
  assert.deepEqual(voxelize(s, { tall: 8 }).size, [4, 8, 2]);
  assert.deepEqual(voxelize(s, { unit: 0.25 }).size, [4, 8, 2]);
  const h = voxelize(s, { height: 4, unit: 0.5 });
  assert.deepEqual(h.size, [4, 8, 2]);
  assert.equal(h.scale, 2);
  assert.throws(() => voxelize(s, { unit: 0.001 }), /too many/);
  const v = voxelize(parseVox(robotVox()));
  assert.equal(filled(v), [...parseVox(robotVox()).voxels!.cells].filter((c) => c).length);
  assert.ok(v.stats.interior > 0 && v.stats.surface > v.stats.interior);
});
