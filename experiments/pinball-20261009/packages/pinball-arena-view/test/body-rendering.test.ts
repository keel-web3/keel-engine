import { test } from "node:test";
import assert from "node:assert/strict";
import { ArenaInput, createArenaMatch } from "@keel-engine/pinball-arena";
import type { MeshGBuffer } from "@keel-engine/bake";
import { createRobotGenome, createRobotDesign, robotPaint } from "../../../packs/pinball-robots/src/index.ts";
import { player, field, worldFrom } from "../../pinball-arena/test/fixtures.ts";
import { captureWorld } from "../../pinball-arena/test/capture-fixtures.ts";
import { standIn } from "../../render/test/gl-stand-in.ts";
import { ARENA_BODY_MESH_ID, createPinballArenaView } from "../src/view.ts";

function visual(ownerId: number) {
  const genome = createRobotGenome("cafe", { family: "iris-scout" }), design = createRobotDesign(genome);
  return { ownerId, identity: design.identity, mesh: design.mesh("rolled"), paint: robotPaint(genome) };
}

test("admitted owner art and default spheres use the exact real native body transform", () => {
  const base = field(), world = worldFrom([field({ stations: base.stations.map((s, i) => i ? { ...s, ownerId: 1, teamId: 1 } : s) })]);
  const match = createArenaMatch(world, { players: [player(), player(1)], mode: "expedition" }), frame = match.step([{ ownerId: 0, bits: ArenaInput.LAUNCH }, { ownerId: 1, bits: ArenaInput.LAUNCH }]);
  const fake = standIn({ width: 800, height: 600 }), buffers: MeshGBuffer[] = [], art = visual(0), before = match.snapshot().slice();
  const view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { bodyVisuals: [art], onMeshFrame: buffer => buffers.push(buffer) });
  const expectedId = `body:owner/0/${art.identity}`;
  assert.equal(view.bodyMeshId(0), expectedId); assert.equal(view.bodyMeshId(1), ARENA_BODY_MESH_ID);
  // The factory keeps its admitted copy even if a content producer reuses its buffers.
  art.mesh.positions.fill(NaN);
  for (let reset = 0; reset < 2; reset++) {
    view.setWorld(reset ? { ...world } : world); view.render(frame, { timeMs: 100, camera: { mode: "overview" } });
    for (const body of frame.balls) {
      const draws = buffers.at(-1)!.draws!.filter(d => d.mesh === view.bodyMeshId(body.ownerId) && d.owner === body.ownerId);
      assert.equal(draws.length, 1);
      const matrix = draws[0]!.matrix;
      assert.ok(Math.abs(matrix[0]! - body.radius * world.unitScale) < 1e-6);
      assert.ok(Math.abs(matrix[5]! - body.radius * world.unitScale) < 1e-6);
      assert.ok(Math.abs(matrix[10]! - body.radius * world.unitScale) < 1e-6);
      assert.ok(Math.abs(matrix[12]! - body.x * world.unitScale) < 1e-5);
      assert.ok(Math.abs(matrix[13]! - (body.elevation + body.radius) * world.unitScale) < 1e-5);
      assert.ok(Math.abs(matrix[14]! - body.y * world.unitScale) < 1e-5);
    }
    assert.deepEqual(match.snapshot(), before);
  }
  view.dispose();
});

test("robot presentation follows real capture hold/transit/release without authority writes", () => {
  const world = captureWorld(), match = createArenaMatch(world, { players: [player()], mode: "expedition" });
  const fake = standIn({ width: 800, height: 600 }), buffers: MeshGBuffer[] = [], view = createPinballArenaView(fake.canvas as unknown as HTMLCanvasElement, { bodyVisuals: [visual(0)], onMeshFrame: buffer => buffers.push(buffer) });
  view.setWorld(world); const phases = new Set<string>(); let released = false;
  for (let tick = 1; tick <= 70; tick++) {
    const frame = match.step([{ ownerId: 0, bits: tick === 1 ? ArenaInput.LAUNCH : 0 }]), body = frame.balls[0]!, snapshot = match.snapshot().slice();
    view.render(frame, { timeMs: tick * 1000 / 120, camera: { mode: "overview" } });
    const draws = buffers.at(-1)!.draws!.filter(d => d.mesh === view.bodyMeshId(0) && d.owner === 0);
    if (body.transport) { phases.add(body.transport.phase); assert.equal(draws.length, 0, "only actual transport suppresses the ordinary rolled mesh"); }
    else { assert.equal(draws.length, 1); if (phases.size) released = true; }
    assert.deepEqual(match.snapshot(), snapshot);
  }
  assert.ok(phases.has("captured") && phases.has("transit") && released);
  view.dispose();
});
