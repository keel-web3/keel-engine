import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaLampSignal } from "../src/effects.ts";
import { arenaGrateGrowth, arenaGrateGrowthPose } from "../src/growth.ts";
import { captureWorld } from "../../pinball-arena/test/capture-fixtures.ts";
import { createArenaMatch, createArenaRoster } from "@keel-engine/pinball-arena";
import type { ArenaSurface } from "@keel-engine/pinball-arena";

test("arcade lamp rhythms vary by stable seed and identity without draw-order state", () => {
  const signals = ["a", "b", "c", "d"].map(id => arenaLampSignal("cabinet", id, 2000));
  assert.equal(new Set(signals).size, 4);
  for (const id of ["d", "a", "c", "b"]) assert.equal(arenaLampSignal("cabinet", id, 2000), signals[["a", "b", "c", "d"].indexOf(id)]);
  assert.notEqual(arenaLampSignal("cabinet", "a", 2000), arenaLampSignal("cabinet", "a", 3000));
  assert.equal(arenaLampSignal("cabinet", "a", 3000, true), arenaLampSignal("another", "b", 999999, true));
  for (const time of [-1, 0, 1000, Number.NaN]) assert.ok(Number.isFinite(arenaLampSignal("cabinet", "a", time)));
});

test("seeded growth uses actual grate margins and responds only with bounded cosmetic leaf pose", () => {
  const surface: ArenaSurface = { id: "grate", kind: "ramp", polygon: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 164 }, { x: 100, y: 164 }], vertexElevations: [0, 100, 100, 0], layer: 0, height: 0, material: "wireform-track", biome: { forge: 0, neon: 0, garden: 1, glacier: 0, ruins: 0 } };
  const growth = arenaGrateGrowth(surface, .025, "0x2026", 1)!;
  assert.ok(growth); assert.deepEqual(growth, arenaGrateGrowth(surface, .025, "0x2026", 1));
  assert.equal(arenaGrateGrowth(surface, .025, "0x2026", 0), null);
  for (const point of growth.anchors) assert.ok(point.y < 107 || point.y > 157, "growth remains outside the central body corridor");
  const frame = createArenaMatch(captureWorld(), { players: createArenaRoster({ players: 1 }) }).readFrame(), ball = { ...frame.balls[0]!, x: growth.anchors[0]!.x, y: growth.anchors[0]!.y, active: true };
  const before = JSON.stringify(ball), wind = arenaGrateGrowthPose(growth, .025, 2, []), reaction = arenaGrateGrowthPose(growth, .025, 2, [ball]);
  assert.ok(wind && reaction); assert.notDeepEqual(wind, reaction); assert.equal(JSON.stringify(ball), before);
  assert.equal(arenaGrateGrowthPose(growth, .025, 2, [ball], true), undefined);
  for (let i = 13; i < reaction!.length; i += 16) assert.ok(Math.abs(reaction![i]!) < .038, "leaf travel stays inside its reserved render envelope");
});
