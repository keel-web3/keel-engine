import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { ArenaField } from "@keel-engine/pinball-arena";
import { slotOf } from "@keel-engine/object";
import { PINBALL_SCENE_BLUEPRINTS, planPinballSceneGenome, pinballEnvironmentClear, worldArtPaint } from "@keel-engine/pinball-world-art";
import { arenaSubstrateVolume, arenaSubstrateSections } from "../src/substrate.ts";
import { ARENA_STRUCTURE_ROLES, arenaFoundationHeight } from "../src/structural-art.ts";
import { arenaFoundationPaint, arenaBoundaryPaint, arenaSceneryPriority } from "../src/scenery.ts";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/native-substrate-19.json", import.meta.url), "utf8"));
const field = fixture.field as ArenaField;
const material = (role: string) => slotOf(ARENA_STRUCTURE_ROLES, role);

test("native four-bay recessed boundary construction leaves complete actual beds and narrow routes clear", () => {
  assert.equal(field.stations.length, 4); assert.ok(field.pinball!.paths.some(p => p.vertices.some(v => v.elevation === 400)));
  const before = JSON.stringify(field), signatures = new Set<string>();
  for (const blueprint of Object.values(PINBALL_SCENE_BLUEPRINTS)) {
    const scene = planPinballSceneGenome("cafe", 0, blueprint), sections = arenaSubstrateSections(field, scene), bottom = arenaFoundationHeight(field, scene), mesh = arenaSubstrateVolume(field, 1, scene, [0, 0, 65535, 65535], bottom, material);
    assert.ok(Math.abs(Math.min(...Array.from(mesh.positions).filter((_, i) => i % 3 === 1)) - bottom) < .001, "native-bound volumes meet their actual recessed floor rather than float above it");
    assert.ok(sections.length > 0 && sections.length <= 72); assert.equal(new Set(sections.map(p => p.id)).size, sections.length);
    assert.ok(sections.every(p => field.surfaces.some(s => s.id === p.sourceSurfaceId)), "every cluster is bound to actual native bay geometry");
    const area = sections.reduce((sum, p) => sum + (p.high - p.low) * p.cross * 2, 0), mapArea = (field.bounds[2] - field.bounds[0]) * (field.bounds[3] - field.bounds[1]);
    assert.ok(area < mapArea * .12, "boundary construction leaves most surrounding space calm rather than a full-map tablet carpet");
    for (let i = 0; i < mesh.positions.length; i += 3) {
      assert.ok(mesh.positions[i + 1]! <= -32 + .0001, "no decorative support or fake upper floor enters native height");
      assert.ok(pinballEnvironmentClear(field, { x: mesh.positions[i]!, y: mesh.positions[i + 2]! }, 0, 24), "complete emitted corner/radius remains outside native playable footprints");
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i]! * 3, b = mesh.indices[i + 1]! * 3, c = mesh.indices[i + 2]! * 3;
      const x = (mesh.positions[a]! + mesh.positions[b]! + mesh.positions[c]!) / 3, y = (mesh.positions[a + 2]! + mesh.positions[b + 2]! + mesh.positions[c + 2]!) / 3;
      assert.ok(pinballEnvironmentClear(field, { x, y }, 0, 24), "surface interiors also avoid native decks and paths");
    }
    const reversed = { ...field, stations: [...field.stations].reverse(), surfaces: [...field.surfaces].reverse() };
    assert.deepEqual(arenaSubstrateSections(reversed, scene), sections, "native source IDs keep placement independent of enumeration");
    signatures.add(JSON.stringify([...mesh.positions]));
  }
  assert.equal(signatures.size, Object.keys(PINBALL_SCENE_BLUEPRINTS).length, "six authored material volumes retain different shapes");
  assert.equal(JSON.stringify(field), before);
});

test("regional rendering patches partition the same native boundary without duplicate or drifting volumes", () => {
  const scene = planPinballSceneGenome("cafe", 0, PINBALL_SCENE_BLUEPRINTS.cyber), bottom = arenaFoundationHeight(field, scene), bounds = [0, 0, 65535, 65535] as const, whole = arenaSubstrateVolume(field, 1, scene, bounds, bottom, material);
  const split = 5500, parts = [[0, 0, split, 65535], [split, 0, 65535, 65535]].map(p => arenaSubstrateVolume(field, 1, scene, p as [number, number, number, number], bottom, material));
  const triples = (positions: Float32Array) => Array.from({ length: positions.length / 3 }, (_, i) => `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`).sort();
  assert.deepEqual(parts.flatMap(p => triples(p.positions)).sort(), triples(whole.positions));
  const { layout: _layout, ...vocabulary } = scene.environment!.substrate!;
  const legacy = { ...scene, environment: { ...scene.environment!, substrate: vocabulary } }, lattice = { ...legacy, environment: { ...legacy.environment, substrate: { ...vocabulary, layout: "lattice" as const } } };
  assert.deepEqual(arenaSubstrateVolume(field, 1, legacy, bounds, bottom, material).positions, arenaSubstrateVolume(field, 1, lattice, bounds, bottom, material).positions, "absent layout preserves archived vocabulary behavior");
});

test("opaque recessed scenery and distant signal budgets stay below actual physical rail contrast", () => {
  for (const blueprint of Object.values(PINBALL_SCENE_BLUEPRINTS)) {
    const scene = planPinballSceneGenome("cafe", 0, blueprint), foundation = arenaFoundationPaint(ARENA_STRUCTURE_ROLES, "budget", scene.biome, scene), boundary = arenaBoundaryPaint(ARENA_STRUCTURE_ROLES, "budget", scene.biome, scene), physical = worldArtPaint(ARENA_STRUCTURE_ROLES, "budget", scene.biome, scene.material.tones);
    for (const part of foundation) if (part) { assert.equal(part.look.finish, "matte"); assert.equal(part.sheen, "none"); assert.equal(part.mirror, 0); assert.ok(part.look.light <= .34 && part.look.chroma <= .075); }
    for (const part of boundary) if (part) { assert.equal(part.look.finish, "matte"); assert.ok(part.look.light <= .49); }
    assert.ok(foundation[material("rail")]!.look.light < physical[material("rail")]!.look.light - .15);
    assert.ok(foundation[material("core")]!.look.light < physical[material("core")]!.look.light - .15);
  }
  const near = arenaSceneryPriority(0, false), far = arenaSceneryPriority(50, false), overview = arenaSceneryPriority(0, true);
  assert.ok(near.light > far.light && near.signal > far.signal); assert.deepEqual(far, overview);
});
