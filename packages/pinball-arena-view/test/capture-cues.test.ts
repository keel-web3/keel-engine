import { test } from "node:test";
import assert from "node:assert/strict";
import { ArenaInput, createArenaMatch, createArenaRoster } from "@keel-engine/pinball-arena";
import { captureWorld } from "../../pinball-arena/test/capture-fixtures.ts";
import { worldFrom } from "../../pinball-arena/test/fixtures.ts";
import { arenaCaptureCue } from "../src/capture-cues.ts";
import { arenaCaptureReadoutMesh, arenaCaptureLocatorMesh } from "../src/mechanisms.ts";

test("accepted capture, transit and blocked frames have static distinct phase words and exact destination bearings", () => {
  const world = captureWorld(true), field = world.arenas[0]!, capture = field.captures![0]!;
  const match = createArenaMatch(world, { players: createArenaRoster({ players: 3 }), mode: "expedition" });
  assert.equal(arenaCaptureCue(world, field, capture, match.readFrame()), null);
  const phases = new Set<string>();
  for (let tick = 1; tick <= 72; tick++) {
    const frame = match.step(tick === 1 ? [0, 1, 2].map(ownerId => ({ ownerId, bits: ArenaInput.LAUNCH })) : []);
    const cue = arenaCaptureCue(world, field, capture, frame);
    if (!cue) { assert.equal(frame.balls[0]!.transport, null); continue; }
    phases.add(cue.label);
    assert.equal(cue.phase, frame.balls[0]!.transport!.phase);
    assert.equal(cue.destination.id, frame.balls[0]!.transport!.exitPortId);
    assert.equal(cue.destinationArenaId, frame.balls[0]!.transport!.exitArenaId);
    assert.equal(cue.bearing, Math.atan2(100, 700)); assert.equal(cue.distance, Math.hypot(700, 100));
    assert.equal(cue.locationLabel, "707U L0");
    assert.ok(cue.progress >= 0 && cue.progress <= 1);
  }
  assert.deepEqual([...phases].sort(), ["BLOCKED", "HOLD", "TRANSIT"]);
  const meshes = ["HOLD", "TRANSIT", "BLOCKED"].map(label => arenaCaptureReadoutMesh(label, "707U L0"));
  assert.equal(new Set(meshes.map(m => JSON.stringify(Array.from(m.positions)))).size, 3, "equal progress must still give recognizably different static geometry");
  for (const mesh of [...meshes, arenaCaptureLocatorMesh(), arenaCaptureLocatorMesh(true)]) {
    assert.ok(mesh.indices.length > 0 && mesh.indices.length < 12000);
    assert.ok(Array.from(mesh.positions).every(Number.isFinite));
  }
});

test("qualification timeout displays the selected fallback and cue resolution cannot hide an ordinary body", () => {
  const base = captureWorld(), original = base.arenas[0]!, definition = original.captures![0]!;
  const field = { ...original, captures: [{ ...definition, release: { kind: "qualification" as const, id: "unearned", maxHoldTicks: 12 } }], requirements: [{ id: "unearned", name: "Unearned", routeIds: ["never-a", "never-b"], gateIds: ["busy"], scope: "owner" as const, holdTicks: 120, persistent: true }], challenges: ["never-a", "never-b"].map((id, i) => ({ id, name: "Never", checkpoints: [{ x: 1700, y: 1200 + i * 100, layer: 0, elevation: 0, radius: 24 }, { x: 1750, y: 1200 + i * 100, layer: 0, elevation: 0, radius: 24 }] })) };
  const world = worldFrom([field]), match = createArenaMatch(world, { players: createArenaRoster({ players: 1 }), mode: "expedition" });
  let fallbackSeen = false;
  for (let tick = 1; tick <= 72; tick++) {
    const frame = match.step(tick === 1 ? [{ ownerId: 0, bits: ArenaInput.LAUNCH }] : []), before = JSON.stringify(frame);
    const cue = arenaCaptureCue(world, field, field.captures[0]!, frame);
    assert.equal(JSON.stringify(frame), before);
    if (cue?.phase === "transit") { fallbackSeen = true; assert.equal(cue.destination.id, "fallback"); assert.equal(cue.bearing, Math.atan2(200, 600)); }
    if (frame.balls[0]!.transport === null) assert.equal(cue, null);
  }
  assert.ok(fallbackSeen);
});
