// Crossed cards (cards.ts) and wall material detail (looks.ts WallDetail): both
// opt-in -- a mesh or a paint without them is byte-for-byte what it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_KINDS, cardsMesh } from "../src/cards.ts";
import { lookMesh, mergeMeshes, MESH_GFS, MESH_SHADOW_FS } from "../src/mesh.ts";
import { layeredMesh, prefixMesh } from "../src/lod-mesh.ts";
import { WALL_DETAILS, createLookTable, wallDetailBits } from "../src/looks.ts";
import type { SlotPaint } from "../src/looks.ts";

test("cardsMesh: a spot is three crossed upright quads, its cutout packed in the surface coordinate", () => {
  const m = cardsMesh([{ x: 2, y: 1, z: -3, height: 0.6, kind: "bush", seed: 37, slot: 5 }, { x: 0, y: 0, z: 0, height: 0.4 }]);
  assert.equal(m.positions.length / 3, 2 * 3 * 4);
  assert.equal(m.indices.length, 2 * 3 * 6);
  for (let v = 0; v < 12; v += 1) {
    const [slot, u, vv, part] = [m.attrs[v * 4]!, m.attrs[v * 4 + 1]!, m.attrs[v * 4 + 2]!, m.attrs[v * 4 + 3]!];
    assert.equal(slot, 5); assert.equal(part, 0);
    // (u: across + 2 (seed x 4 + kind), v: -(1 + up) -- as CARD_GLSL unpacks it.)
    const id = Math.floor((u + 0.5) * 0.5);
    assert.equal(id, 37 * 4 + CARD_KINDS.indexOf("bush"));
    assert.ok(u - 2 * id === 0 || u - 2 * id === 1);
    assert.ok(vv === -1 || vv === -2);
    const y = m.positions[v * 3 + 1]!;
    assert.ok(Math.abs(y - (vv === -1 ? 1 : 1.6)) < 1e-6);
    assert.ok(m.normals[v * 3 + 1]! > 0.5, "normals lean up: a tuft shades round, not as boards");
  }
  assert.equal(m.attrs[12 * 4 + 3], 1, "each spot its own part");
  assert.equal(m.facade, undefined);
  assert.equal(cardsMesh([{ x: 0, y: 0, z: 0, height: 1 }], { cards: 2 }).positions.length / 3, 8);
  // (The same spot is the same tuft: its seed comes from where it stands.)
  assert.deepEqual(cardsMesh([{ x: 4.2, y: 0, z: 1.1, height: 0.5 }]).attrs, cardsMesh([{ x: 4.2, y: 0, z: 1.1, height: 0.5 }]).attrs);
});

test("the G-buffer and the sun's pass both cut a card; nothing else reaches the cutout", () => {
  assert.ok(MESH_GFS.includes("if (cardCut(vAttr)) discard;"));
  assert.ok(MESH_SHADOW_FS.includes("if (cardCut(vAttr)) discard;"));
  // (A card is flagged by v below 0; a box face's v never is, a facade grid flags u instead.)
  assert.ok(MESH_GFS.includes("if (attr.z >= -0.5) return false;"));
});

test("lookMesh: a facade grid's faces carry metres above their foot; a mesh without a grid carries nothing new", () => {
  const plain = lookMesh({ boxes: [{ c: [0, 1, 0], h: [1, 1, 1] }] });
  assert.equal(plain.facade, undefined);
  const wall = lookMesh({ boxes: [{ c: [0, 5, 0], h: [4, 5, 3], grid: [3, 3.5, 0, 0] }] });
  const feet: Float32Array | undefined = wall.facade;
  assert.ok(feet);
  for (let v = 0; v < wall.positions.length / 3; v += 1) {
    const f: number = feet[v]!, y: number = wall.positions[v * 3 + 1]!;
    if (wall.attrs[v * 4 + 1]! < -0.5) assert.ok(Math.abs(f - y) < 1e-6, "a side face: metres over its foot");
    else assert.equal(f, -1, "top and bottom: no grid");
  }
  const merged = mergeMeshes([plain, wall]);
  assert.equal(merged.facade!.length, merged.positions.length / 3);
  assert.equal(merged.facade![0], -1);
  const lm = layeredMesh([{ boxes: [{ c: [0, 1, 0], h: [1, 1, 1] }] }, { boxes: [{ c: [0, 5, 0], h: [4, 5, 3], grid: [3, 3.5, 0, 0] }] }]);
  assert.equal(prefixMesh(lm, 1).facade!.length, 24);
});

test("wall detail: packed in the pattern word's high half; a paint without it is the same paint as before", () => {
  assert.equal(wallDetailBits(null), 0);
  assert.equal(wallDetailBits({ material: "none" }), 0);
  const b = wallDetailBits({ material: "brick", grime: 1, foot: 0, edge: false, scale: 2 });
  assert.equal(b & 15, WALL_DETAILS.indexOf("brick"));
  assert.equal((b >> 4) & 15, 15); assert.equal((b >> 8) & 15, 0); assert.equal((b >> 12) & 1, 0); assert.equal((b >> 13) & 3, 1);
  const role = { hue: 30, chroma: 0.1, light: 0.4, span: 0.4, finish: "matte" as const, pattern: { kind: "windows" as const, freq: 5, angle: 0, width: 8, shift: 0, ink: null } };
  const plain: SlotPaint = { look: role, ink: null, screen: "bayer4", dither: 0.9 };
  const t = createLookTable();
  t.add([plain]);
  const before = t.paintTexture().data.slice(0, 8);
  t.add([{ ...plain, detail: { material: "brick" } }]);
  assert.equal(t.paints, 2, "a detail is a new paint");
  const data = t.paintTexture().data;
  assert.deepEqual(Array.from(data.slice(0, 8)), Array.from(before), "the plain paint's texels are untouched");
  assert.equal(data[2]! & 0xffff, before[2]! & 0xffff, "the pattern's own bits agree");
  assert.equal(data[8 + 2]! >>> 16, wallDetailBits({ material: "brick" }));
  assert.equal(before[2]! >>> 16, 0);
});
