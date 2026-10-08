import assert from "node:assert/strict";
import { test } from "node:test";
import { drawsFor } from "@keel-engine/city";
import { addBox } from "../src/frame.ts";
import type { Placer } from "../src/frame.ts";
import { wallPanel } from "../src/street/roadside.ts";
import { streetPaint } from "../src/paint.ts";
import { STREET_SLOT } from "../src/slots.ts";
import type { DistrictLook, StreetCatalogue } from "../src/types.ts";
import { createLookTable, lookMesh, wallDetailBits } from "@keel-engine/bake";

const placer = (x = 0, seed = "wall-fixture"): Placer => ({ D: drawsFor(seed, "roadside"), frame: { x, z: 12, y: 2, yaw: .4, hw: 1, hd: 4 }, solids: [], plants: [], ads: [], top: 0 });
const stripGrid = (p: Placer) => p.solids.map(s => ({ ...s, box: s.box && Object.fromEntries(Object.entries(s.box).filter(([key]) => key !== "grid")) }));

test("wall weathering preserves all solids, dimensions, placement and LOD geometry", () => {
  for (const len of [4, 8, 13]) for (const h of [2, 4, 6]) {
    const before = placer(), after = placer();
    addBox(before, 2, 0, h / 2 - .3, 0, .14, h / 2 + .3, len / 2, "plinth");
    addBox(before, 1, .1, h / 2, -len / 2 + .1, .18, h / 2 + .1, .12, "frame");
    addBox(before, 0, 0, h + .05, 0, .2, .06, len / 2, "paving");
    wallPanel(after, len, h);
    assert.deepEqual(stripGrid(after), stripGrid(before));
    for (const lod of [0, 1, 2]) {
      const mesh = (p: Placer) => lookMesh({ boxes: p.solids.filter(s => s.lod >= lod).flatMap(s => s.box ? [s.box] : []) });
      const a = mesh(before), b = mesh(after);
      assert.deepEqual(b.positions, a.positions);
      assert.deepEqual(b.normals, a.normals);
      assert.deepEqual(b.indices, a.indices);
      assert.ok(b.facade?.some(v => v >= 0), `LOD ${lod} retains its wall surface`);
    }
  }
});

test("wall surface seeds repeat exactly and vary between panels without adding per-panel materials", () => {
  const seeds = new Set<string>();
  for (let i = 0; i < 64; i++) {
    const a = placer(i * 8), b = placer(i * 8); wallPanel(a, 8, 4); wallPanel(b, 8, 4);
    assert.deepEqual(a.solids, b.solids); seeds.add(JSON.stringify(a.solids[0]!.box!.grid));
    assert.equal(a.solids.length, 3);
    assert.equal(a.plants.length, 0);
  }
  assert.ok(seeds.size > 60);
});

test("non-window wall paint carries a cached vegetation ramp and dirt; ordinary surfaces stay plain", () => {
  const look: DistrictLook = { key: "test", kind: "industrial", hues: [140, 210], share: .5, warm: .5, dirt: .5, wealth: .5 };
  const concrete = { hue: 75, chroma: .015, light: .58, span: .4, finish: "matte" as const };
  const catalogue = { materials: { plinth: { ...concrete, detail: { material: "barrier", grime: .4, foot: .7 }, detailInk: { ...concrete, hue: 138, chroma: .085 } }, frame: concrete } } as StreetCatalogue;
  const table = createLookTable();
  for (const night of [false, true]) {
    const { paint } = streetPaint(catalogue, look, night), wall = paint[STREET_SLOT.plinth]!;
    assert.equal(wall.look.pattern.kind, "none");
    assert.equal(wall.detail?.material, "barrier");
    assert.equal(wall.detail?.grime, .625);
    assert.equal(wall.ink?.hue, 138);
    assert.equal(paint[STREET_SLOT.frame]!.ink, null);
    assert.equal(paint[STREET_SLOT.frame]!.detail, undefined);
    const id = table.add(paint), bytes = table.bytes, ramps = table.ramps;
    for (let i = 0; i < 1000; i++) assert.equal(table.add(paint), id);
    assert.equal(table.bytes, bytes); assert.equal(table.ramps, ramps);
  }
  assert.equal(wallDetailBits({ material: "barrier" }) & 15, 8);
  assert.equal(wallDetailBits({ material: "stone" }) & 15, 7);
  assert.equal(wallDetailBits({ material: "none" }), 0);
});
