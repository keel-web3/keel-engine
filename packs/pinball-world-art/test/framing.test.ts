import { test } from "node:test";
import assert from "node:assert/strict";
import { planPinballFraming, pinballFrameClear, pinballEnvironmentClear, pinballFrameMaterial, pinballConstructionMountRadius, biomeLookKey, worldArtAsset, type PinballFrameTheme } from "../src/index.ts";
import { compilePinballMachine } from "../../../packages/pinball-arena-gen/src/machine.ts";
import { projectionOf } from "@keel-engine/bake";
import { builtArtMesh } from "../../../packages/pinball-arena-view/src/geometry.ts";

const themes: readonly PinballFrameTheme[] = ["cyber", "gold", "vapor", "nature", "crypto", "nightshift"];
const fixture = () => compilePinballMachine({ id: "framing-fixture", seed: "0x2026", attempt: 0, origin: { x: 3000, y: 2000 }, ownerId: 0, teamId: 0, variation: false });

test("framing follows real mechanical edges without changing physical geometry or exceeding record budgets", () => {
  const field = fixture(), before = JSON.stringify(field);
  const plans = themes.map(theme => planPinballFraming(field, { family: "fork-basin", theme, unitScale: .025, maxInstances: 48 }));
  assert.equal(JSON.stringify(field), before);
  for (const p of plans) {
    assert.equal(p.state, "unadmitted-framing"); assert.ok(p.placements.length > 0 && p.placements.length <= 48);
    assert.deepEqual(p, planPinballFraming(field, { family: "fork-basin", theme: p.theme!, unitScale: .025, maxInstances: 48 }));
    const ids = p.chunks.flatMap(c => c.instances.map(i => i.id));
    assert.equal(new Set(ids).size, ids.length); assert.equal(ids.length, p.placements.length);
    for (const chunk of p.chunks) { assert.ok(chunk.instances.length <= 64); assert.ok(chunk.bounds.every(n => n >= 0 && n <= 65535)); }
    for (const placement of p.placements) assert.ok(field.surfaces.some(s => s.id === placement.sourceSurfaceId));
  }
  const frameIds = plans.map(p => [...new Set(p.chunks.flatMap(c => c.instances).filter(i => p.placements.find(m => m.instanceId === i.id)?.band === "mechanical-frame").map(i => i.assetId))].sort().join("/"));
  assert.equal(new Set(frameIds).size, themes.length, "cabinet families require different silhouettes, beyond recolouring one object");
  assert.equal(new Set(themes.map(t => biomeLookKey(pinballFrameMaterial(t)))).size, themes.length);
});

test("art placement rejects catch, shot, hazard and unsupported-mouth intrusion", () => {
  const field = fixture(), bank = field.stations[0]!, port = field.pinball!.ports.find(p => p.role === "shot-entry")!, hazard = field.hazards![0]!;
  for (const p of [bank, port, hazard, field.surfaces[0]!.polygon[0]!]) assert.equal(pinballFrameClear(field, p, 20), false);
  assert.equal(pinballFrameClear({ ...field, surfaces: [] }, bank, 20), false, "removing art support cannot remove the catch reservation");
  assert.equal(pinballFrameClear({ ...field, surfaces: [], rails: [], gates: [], ramps: [], stations: [], pinball: { paths: [], ports: [port] } }, port, 20), false, "a declared mouth remains protected even without bed art");
  assert.throws(() => planPinballFraming(field, { family: "loop-gallery", theme: "gold", unitScale: .025, structuralSurfaceIds: ["missing-bed"] }), /absent/);
  assert.throws(() => planPinballFraming(field, { family: "loop-gallery", theme: "gold", unitScale: .025, transitionPortId: "missing-exit" }), /absent/);
  assert.throws(() => planPinballFraming(field, { family: "loop-gallery", theme: "gold", unitScale: .025, maxInstances: 1000 }), /budget/);
});

test("environment clusters bind actual native layer and stay within their declared rise", () => {
  const original = fixture(), lower = original.surfaces.find(s => s.kind === "playfield" || s.material === "pinball-inlay")!, raised = { ...lower, id: "upper-bed", layer: 2, height: 600, polygon: lower.polygon.map(p => ({ x: p.x + 2500, y: p.y })) };
  const field = { ...original, surfaces: [...original.surfaces, raised] }, before = JSON.stringify(field);
  const plan = planPinballFraming(field, { family: "terrace-switchback", theme: "cyber", unitScale: .025, maxInstances: 48 });
  assert.equal(JSON.stringify(field), before);
  const environment = plan.placements.filter(p => p.band.startsWith("environment-")); assert.ok(environment.length > 0);
  assert.ok(environment.some(p => p.sourceSurfaceId === raised.id), "upper chamber receives its own surrounding structure");
  for (const placement of environment) {
    const chunk = plan.chunks.find(c => c.instances.some(i => i.id === placement.instanceId))!, item = chunk.instances.find(i => i.id === placement.instanceId)!, source = field.surfaces.find(s => s.id === placement.sourceSurfaceId)!;
    assert.equal(chunk.layer, source.layer);
    assert.ok(placement.protectedRadius >= pinballConstructionMountRadius(plan.genome.environment, item.assetId), "complete native mounting footprint is reserved before admission");
    for (let variant = 0; variant < 4; variant++) { const built = worldArtAsset(item.assetId).build({ seed: `pinball-circuit/${item.assetId}/${variant}`, pins: { variant }, style: "pixel" }); assert.ok(item.z + built.def.bounds[4] * item.scale / .025 <= source.height + 240 + .001); }
    assert.ok(pinballEnvironmentClear(field, item, placement.protectedRadius));
  }
});

test("canonical frame meshes remain outside projected playable polygons at the declared pitch floor", () => {
  const field = fixture(), point = field.surfaces.find(s => s.material === "pinball-inlay")!.polygon[0]!;
  for (const theme of themes) {
    const plan = planPinballFraming(field, { family: "terrace-switchback", theme, unitScale: .025, maxInstances: 32 });
    const item = plan.chunks.flatMap(c => c.instances).find(i => plan.placements.find(p => p.instanceId === i.id)?.band === "mechanical-frame")!;
    assert.ok(item);
    // Measure the real built geometry against the generator's conservative
    // ground-plane sightline radius, using the canonical KEEL projection.
    const placement = plan.placements.find(p => p.instanceId === item.id)!;
    for (let variant = 0; variant < 4; variant++) {
      const built = worldArtAsset(item.assetId).build({ seed: `pinball-circuit/${item.assetId}/${variant}`, pins: { variant }, style: "pixel" }), mesh = builtArtMesh(built);
      for (const yaw of [0, .35, Math.PI / 2]) {
        const view = projectionOf({ kind: "ortho", center: [point.x * .025, 0, point.y * .025], yaw, pitch: plan.minimumCameraPitch, k: 1 }, 320, 320, 400), foot = view.project([item.x * .025, item.z * .025, item.y * .025]);
        for (let i = 0; i < mesh.positions.length; i += 3) {
          const co = Math.cos(item.yaw), si = Math.sin(item.yaw), x = mesh.positions[i]! * item.scale, y = mesh.positions[i + 1]! * item.scale, z = mesh.positions[i + 2]! * item.scale;
          const pixel = view.project([item.x * .025 + co * x + si * z, item.z * .025 + y, item.y * .025 - si * x + co * z]);
          assert.ok(Math.hypot(pixel[0] - foot[0], pixel[1] - foot[1]) <= placement.protectedRadius * .025 + .001);
        }
      }
    }
  }
});
