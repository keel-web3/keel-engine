import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaPhysicalPartitions, arenaPresentationBounds } from "../src/physical-partitions.ts";
import { arenaPhysicalMesh } from "../src/geometry.ts";
import type { ArenaField } from "@keel-engine/pinball-arena";

test("physical partitions preserve each collider exactly once independent of sparse exterior scenery", () => {
  const field: Pick<ArenaField, "bounds" | "rails" | "bumpers" | "chunks"> = { bounds: [0, 0, 4000, 2000],
    rails: Array.from({ length: 259 }, (_, i) => ({ id: `rail.${i}`, ax: i % 2 ? 10 : 765, ay: 20 + i, bx: i % 2 ? 30 : 769, by: 30 + i, radius: 3, restitution: .9, layer: 0, elevation: 0, elevationB: i, material: "steel" as const })),
    bumpers: [{ id: "bumper", x: 2500, y: 600, radius: 20, layer: 0, elevation: 0, kind: "fungus", impulse: 1 }],
    chunks: [{ id: "exterior-only", bounds: [4200, 500, 4500, 1000], layer: 0, height: 0, biome: { forge: 1, neon: 0, garden: 0, glacier: 0, ruins: 0 }, seed: "0x2026", instances: [] }],
  };
  const before = JSON.stringify(field), partitions = arenaPhysicalPartitions(field);
  const ids = partitions.flatMap(p => [...p.rails, ...p.bumpers].map(c => c.id));
  assert.equal(ids.length, field.rails.length + field.bumpers.length); assert.equal(new Set(ids).size, ids.length);
  assert.ok(partitions.every(p => p.rails.length + p.bumpers.length <= 128));
  const noScenery = { ...field, chunks: [] };
  assert.deepEqual(partitions, arenaPhysicalPartitions(noScenery));
  assert.equal(partitions.reduce((n, p) => n + arenaPhysicalMesh(p, .025).indices.length, 0), arenaPhysicalMesh(field, .025).indices.length);
  for (const partition of partitions) {
    for (const rail of partition.rails) for (const [x, y] of [[rail.ax, rail.ay], [rail.bx, rail.by]]) { assert.ok(partition.bounds[0] <= x! - rail.radius && partition.bounds[2] >= x! + rail.radius); assert.ok(partition.bounds[1] <= y! - rail.radius && partition.bounds[3] >= y! + rail.radius); }
  }
  assert.deepEqual(arenaPresentationBounds(field), [0, 0, 4500, 2000]); assert.equal(JSON.stringify(field), before);
});
