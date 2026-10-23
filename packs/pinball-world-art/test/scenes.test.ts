import { test } from "node:test";
import assert from "node:assert/strict";
import { defineStyledObject, solid } from "@keel-engine/object";
import { PINBALL_SCENE_BLUEPRINTS, definePinballSceneBlueprint, planPinballSceneGenome, validatePinballSceneGenome, planPinballFraming, type PinballSceneBlueprint } from "../src/index.ts";
import { compilePinballMachine } from "../../../packages/pinball-arena-gen/src/machine.ts";

test("stage variation retains cabinet identity, uses semantic vocabularies and admits an additional content pack", () => {
  const sail = defineStyledObject({ id: "storm-sail", variants: 4, look: { roles: { canvas: { as: "primary", stuff: "cloth" } } }, design(J) { return { solids: [solid.box("canvas", [0, J.between(.8, 1.4), 0], [.7, .8, .12], J.between(-.2, .2), { collide: false })], colliders: [], front: null }; } });
  const base = PINBALL_SCENE_BLUEPRINTS.gold;
  const blueprint = definePinballSceneBlueprint({ ...base, id: "external/desert-storm", revision: "1", cabinetFamily: "desert-storm", props: [{ assetId: sail.id, semantic: "wind-carved-sail", band: "mechanical-frame", weight: 1, scale: [.5, .7] }], lighting: { semantic: "reflected-dune-light", fixtureAssetIds: [], tintRoles: ["core", "trim"], gain: .2 }, material: { ...base.material, tones: { ...base.material.tones, canvas: [70, .06, .7] } }, print: { spacing: 300, primitives: [{ a: [-60, 60], b: [0, -60], width: 5, role: "trim" }, { a: [0, -60], b: [60, 60], width: 5, role: "trim" }] } }, [sail]);
  const scenes = Array.from({ length: 8 }, (_, stage) => planPinballSceneGenome("0x2026", stage, blueprint, [sail]));
  assert.equal(new Set(scenes.map(s => s.cabinetFamily)).size, 1); assert.equal(new Set(scenes.map(s => s.cabinetSeed)).size, 1);
  assert.equal(new Set(scenes.map(s => s.seed)).size, 8); assert.ok(new Set(scenes.map(s => JSON.stringify(s.material))).size > 1);
  for (const scene of scenes) { assert.deepEqual(scene, validatePinballSceneGenome(scene, [sail])); assert.deepEqual(scene, planPinballSceneGenome("0x2026", scene.stage, blueprint, [sail])); assert.equal(scene.props[0]!.assetId, "storm-sail"); assert.equal(scene.growth.kind, "none"); }
  const field = compilePinballMachine({ id: "scenery-fixture", seed: "0x2026", attempt: 0, origin: { x: 3000, y: 2000 }, ownerId: 0, teamId: 0, variation: false });
  const framing = planPinballFraming(field, { family: "loop-gallery", sceneBlueprint: blueprint, assets: [sail], unitScale: .025 });
  assert.equal(framing.theme, null); assert.equal(framing.genome.cabinetFamily, "desert-storm"); assert.ok(framing.chunks.flatMap(c => c.instances).some(i => i.assetId === "storm-sail"));
  assert.ok(!PINBALL_SCENE_BLUEPRINTS.gold.props.some(p => p.assetId === "neon-swing-lamp"));
  assert.ok(!PINBALL_SCENE_BLUEPRINTS.crypto.props.some(p => p.assetId === "palm"));
});

test("blueprint admission rejects malformed tuples, roles, bands and unbounded scene behavior", () => {
  const base = PINBALL_SCENE_BLUEPRINTS.cyber;
  const forged = (change: (b: any) => void): void => { const b = JSON.parse(JSON.stringify(base)); change(b); assert.throws(() => definePinballSceneBlueprint(b as PinballSceneBlueprint)); };
  forged(b => b.environment.substrate.spacing = 159); forged(b => b.environment.substrate.rise = 161);
  forged(b => b.environment.substrate.layout = "carpet"); forged(b => b.environment.substrate.layout = null);
  forged(b => { b.environment.floor.depth = 120; b.environment.substrate.rise = 100; });
  forged(b => b.environment.floor = null); forged(b => b.environment.substrate.parts[0].role = "unbound");
  forged(b => b.environment.substrate.parts[0].a = []); forged(b => b.environment.substrate.parts[0].size = [1, 1, 1]);
  forged(b => b.environment.substrate.parts = Array(17).fill(b.environment.substrate.parts[0]));
  forged(b => { b.environment.substrate.parts = [{ role: "bark", kind: "capsule", a: [0, .95, 0], b: [.2, .95, .2], size: [.1, .1, .1], motion: "static" }]; });
  forged(b => b.props[0].band = "world-blocker"); forged(b => b.props[0].scale = []);
  forged(b => b.print.primitives[0].a = []); forged(b => b.print.primitives[0].b = [0]); forged(b => b.print.primitives[0].role = "arbitrary");
  forged(b=>b.print.layout="world");forged(b=>b.print.semantic=0);
  forged(b=>b.print={layout:"field",spacing:300,primitives:[{a:[-20,-20],b:[20,20],width:2,role:"trim"},{a:[20,20],b:[-20,20],width:2,role:"trim"},{a:[-20,20],b:[20,-20],width:2,role:"trim"},{a:[20,-20],b:[-20,-20],width:2,role:"trim"}]});
  forged(b => b.lighting.tintRoles = []); forged(b => b.lighting.tintRoles = ["missing", "core"]); forged(b => b.lighting.fixtureAssetIds = Array(25).fill("circuit-rib"));
  forged(b => delete b.material.tones.ground); forged(b => b.material.tones.core = [180, Number.NaN, .7]); forged(b => b.biome.neon = -1);
  forged(b => b.motion.windGain = 3); forged(b => b.ambient.voices = []);
  forged(b => b.props[0].socket = "above-blades");
  forged(b => b.structure.rim[0].drop = 0); forged(b => b.structure.hubs[0].a = []); forged(b => b.structure.hubs[0].size = [1]); forged(b => b.structure.hubs[0].a[1] = 2);
  forged(b => b.environment.clear = []); forged(b => b.environment.floor.depth = 0); forged(b => b.environment.floor.role = "missing");
  forged(b => b.environment.tiers[0].rise = 241); forged(b => b.environment.tiers[0].band = "foreground"); forged(b => b.environment.tiers[0].scale = [0, 100]); forged(b => b.environment.tiers[0].assetId = "unregistered");
  forged(b => b.environment.construction.boundary.parts[0].a = []); forged(b => b.environment.construction.boundary.parts[0].role = "missing"); forged(b => b.environment.construction.boundary.parts[0].a[1] = 2);
  forged(b => b.environment.construction.boundary.width = 241); forged(b => b.environment.construction.boundary.spacing = 1); forged(b => b.environment.construction.mounts[0].assetId = "missing"); forged(b => b.environment.construction.mounts[0].from = "invisible"); forged(b => b.environment.construction.mounts[0].parts = []);
  forged(b => b.environment.construction.mounts[0].parts.forEach((p: any) => p.motion = "pulse"));
  const scene = planPinballSceneGenome("0x2026", 0, base);
  assert.throws(() => validatePinballSceneGenome({ ...scene, stage: 1 }), /identity/);
});

test("environment grammar remains distinct and preserves admitted recessed recipes across stages", () => {
  const blueprints = Object.values(PINBALL_SCENE_BLUEPRINTS);
  assert.equal(new Set(blueprints.map(b => b.environment!.semantic)).size, blueprints.length);
  assert.equal(new Set(blueprints.map(b => b.environment!.tiers.map(t => t.assetId).join("/"))).size, blueprints.length);
  assert.equal(new Set(blueprints.map(b => JSON.stringify(b.environment!.construction))).size, blueprints.length);
  for (const blueprint of blueprints) for (const stage of [0, 7]) {
    const scene = planPinballSceneGenome("0xcafe", stage, blueprint);
    assert.deepEqual(validatePinballSceneGenome(scene).environment, blueprint.environment);
    assert.deepEqual(scene.structure, blueprint.structure);
  }
});

test("maximum admitted motion stays bounded across stages and preserves serialized cabinet music", () => {
  const base = PINBALL_SCENE_BLUEPRINTS.cyber;
  const music = { id: "external/storm-wind", bpm: 86, root: 45, scale: [0, 2, 4, 7, 9], shape: "tri" as const, chordShape: "sine" as const, wear: "soft" as const, bass: .08, lead: .04, drum: .12, chordGain: .05, leadEvery: 4 as const, leadOffset: 1, bassEvery: 4 as const, leadBeats: .55, kick: [0, 8], snare: [4, 12], hat: [], partials: [{ interval: 0, gain: 1 }], air: .7, airHz: 950 };
  const blueprint = definePinballSceneBlueprint({ ...base, music, motion: { ...base.motion, windRate: 3, blinkPeriodMs: 20000 } });
  for (let stage = 0; stage < 32; stage++) {
    const scene = planPinballSceneGenome("0x2026", stage, blueprint);
    assert.ok(scene.motion.windRate >= .1 && scene.motion.windRate <= 3);
    assert.ok(scene.motion.blinkPeriodMs >= 800 && scene.motion.blinkPeriodMs <= 20000);
    assert.deepEqual(validatePinballSceneGenome(scene).music, music);
    assert.equal(scene.cabinetSeed, planPinballSceneGenome("0x2026", 0, blueprint).cabinetSeed);
  }
});
