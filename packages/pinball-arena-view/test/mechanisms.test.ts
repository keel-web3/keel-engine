import { test } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import type { LookMesh } from "@keel-engine/bake";
import type { ArenaField, ArenaSurface } from "@keel-engine/pinball-arena";
import { PINBALL_SCENE_BLUEPRINTS, planPinballSceneGenome, pinballPrintContours } from "@keel-engine/pinball-world-art";
import { arenaTrackDetailMesh, arenaWireApronMesh, arenaCoasterTrackMesh, arenaCatchPlateMesh, arenaShooterMesh, arenaShooterPose } from "../src/mechanisms.ts";
import { arenaBedPanelMesh } from "../src/bed-art.ts";
import { field as fixtureField } from "../../pinball-arena/test/fixtures.ts";
import { compilePinballMachine } from "../../pinball-arena-gen/src/machine.ts";

const biome = { forge: 1, neon: 0, garden: 0, glacier: 0, ruins: 0 };
const bed: ArenaSurface = { id: "support", kind: "ramp", polygon: [{ x: 0, y: -38 }, { x: 200, y: -38 }, { x: 200, y: 38 }, { x: 0, y: 38 }], vertexElevations: [0, 100, 100, 0], layer: 0, height: 0, material: "shot-track", biome };
function area(mesh: LookMesh): number {
  let sum = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]! * 3, b = mesh.indices[i + 1]! * 3, c = mesh.indices[i + 2]! * 3;
    const cross = (mesh.positions[b]! - mesh.positions[a]!) * (mesh.positions[c + 2]! - mesh.positions[a + 2]!) - (mesh.positions[b + 2]! - mesh.positions[a + 2]!) * (mesh.positions[c]! - mesh.positions[a]!);
    assert.ok(cross < 0, "mechanical top patches face upward"); sum += -cross * .5;
  }
  return sum;
}

test("actual three-bank catch edging cannot cover authored central matte panels", () => {
  const source = JSON.parse(fs.readFileSync(new URL("./fixtures/native-catch-bed-14.json", import.meta.url), "utf8")) as { unitScale: number; field: Partial<ArenaField> };
  const field = fixtureField(source.field), before = JSON.stringify(field);
  const triangles = (mesh: LookMesh) => Array.from({ length: mesh.indices.length / 3 }, (_, i) => ({ points: [0, 1, 2].map(k => { const j = mesh.indices[i * 3 + k]! * 3; return [mesh.positions[j]!, mesh.positions[j + 2]!] as const; }), heights: [0, 1, 2].map(k => mesh.positions[mesh.indices[i * 3 + k]! * 3 + 1]!) }));
  const overlap = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) => {
    for (const triangle of [a, b]) for (let i = 0; i < 3; i++) {
      const p = triangle[i]!, q = triangle[(i + 1) % 3]!, x = -(q[1]! - p[1]!), y = q[0]! - p[0]!, length = Math.hypot(x, y);
      if (length < 1e-8) return false;
      const project = (points: readonly (readonly number[])[]) => points.map(p => (p[0]! * x + p[1]! * y) / length), aa = project(a), bb = project(b);
      if (Math.max(...aa) <= Math.min(...bb) + 1e-5 || Math.max(...bb) <= Math.min(...aa) + 1e-5) return false;
    }
    return true;
  };
  assert.equal(field.stations.length, 3);
  for (const bank of field.stations) {
    const edging = arenaCatchPlateMesh(field, bank, source.unitScale)!;
    assert.ok(edging && edging.indices.length, "real guide-derived perimeter construction remains");
    for (const blueprint of Object.values(PINBALL_SCENE_BLUEPRINTS)) {
      const scene = planPinballSceneGenome("cafe", 0, blueprint), contours = pinballPrintContours(scene.print.primitives).filter(c => c.points.every(p => Math.abs(p[0]) <= 120));
      assert.ok(contours.length, "every recipe supplies actual local central artwork");
      const primitives = contours.flatMap(c => c.points.map((a, i) => ({ a, b: c.points[(i + 1) % c.points.length]!, role: c.role, width: 3 })));
      const fan = field.surfaces.find(s => s.id === `${bank.id}.fan`)!;
      const panels = arenaBedPanelMesh(fan, source.unitScale, { ...scene, print: { ...scene.print, primitives } }, field);
      assert.ok(panels.indices.length);
      const fanArea = Math.abs(fan.polygon.reduce((sum, p, i) => { const q = fan.polygon[(i + 1) % fan.polygon.length]!; return sum + p.x * q.y - q.x * p.y; }, 0)) * .5 * source.unitScale ** 2;
      assert.ok(area(edging) < fanArea * .25, "guide-derived edging leaves the broad native fan open");
      for (const a of triangles(edging)) for (const b of triangles(panels)) if (overlap(a.points, b.points)) assert.ok(Math.max(...a.heights) < Math.min(...b.heights) - .001, `${blueprint.id}/${bank.id} edge cannot depth-cover authored central ink`);
    }
  }
  assert.equal(JSON.stringify(field), before);
});

test("deck inlays and wireforms stay on supplied support planes with a bounded open framework", () => {
  const detailed = arenaTrackDetailMesh(bed, .025, "cross-return"), wire = arenaTrackDetailMesh(bed, .025, "shooter", true);
  for (const mesh of [detailed, wire]) {
    assert.ok(Array.from(mesh.positions).every(Number.isFinite)); assert.ok(Array.from(mesh.normals).every(Number.isFinite));
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!, h = mesh.positions[i + 1]!, y = mesh.positions[i + 2]!;
      assert.ok(x >= 0 && x <= 5 && y >= -.95 && y <= .95);
      assert.ok(h - x * .5 >= .0219 && h - x * .5 <= .0351);
    }
    assert.ok(mesh.indices.length <= 1024, "one compiled segment has a bounded mechanical detail budget");
  }
  assert.ok(area(wire) < 5 * 1.9 * .4, "wireforms expose the space below their actual footprint");
  assert.ok(area(detailed) > 0);
});

test("coaster rails and slim ties follow real narrow corridor widths and native sloped support", () => {
  for (const width of [32, 44, 64]) {
    const source = { ...bed, polygon: bed.polygon.map(p => ({ x: p.x, y: Math.sign(p.y) * width * .5 })), material: "wireform-track" }, before = JSON.stringify(source), mesh = arenaCoasterTrackMesh(source, .025);
    assert.ok(mesh.indices.length > 0 && mesh.indices.length < 2000); assert.ok([...mesh.positions, ...mesh.normals].every(Number.isFinite));
    for (let i = 0; i < mesh.positions.length; i += 3) { assert.ok(Math.abs(mesh.positions[i + 2]!) <= width * .025 * .5 + .001); const lift = mesh.positions[i + 1]! - mesh.positions[i]! * .5; assert.ok(lift <= .04 && lift >= -.30); }
    assert.equal(JSON.stringify(source), before);
  }
});

test("catch plating derives from real funnel guides, while the shooter spring has a bounded mouth footprint", () => {
  const field = compilePinballMachine({ id: "mechanism-fixture", seed: "0x2026", attempt: 0, origin: { x: 800, y: 300 }, ownerId: 0, teamId: 0, variation: false });
  const plate = arenaCatchPlateMesh(field, field.stations[0]!, .025);
  assert.ok(plate); assert.ok(area(plate) > 0); assert.ok(Array.from(plate.positions).every(Number.isFinite));
  assert.equal(arenaCatchPlateMesh({ ...field, rails: [] }, field.stations[0]!, .025), null, "an invented rectangular bowl cannot replace missing funnel structure");
  assert.equal(arenaCatchPlateMesh({ ...field, rails: field.rails.map(r => ({ ...r, layer: 1 })) }, field.stations[0]!, .025), null, "a guide from another collision layer cannot define a ground catch");
  assert.equal(arenaCatchPlateMesh({ ...field, rails: field.rails.map(r => ({ ...r, elevationB: r.elevation + 100 })) }, field.stations[0]!, .025), null, "sloped guides cannot invent a flat catch apron");
  const shooter = arenaShooterMesh(64 * .025);
  assert.ok(shooter.indices.length > 0); assert.ok(shooter.indices.length < 6000);
  assert.ok(Array.from(shooter.positions).every(Number.isFinite));
  for (let i = 0; i < shooter.positions.length; i += 3) { assert.ok(shooter.positions[i]! <= 0 && shooter.positions[i]! >= -.72); assert.ok(Math.abs(shooter.positions[i + 2]!) <= .67); }
});

test("an explicitly open native landing keeps its octagonal support footprint without an opaque plate", () => {
  const polygon = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos(i * Math.PI / 4) * 38, y: Math.sin(i * Math.PI / 4) * 38 }));
  const landing = { ...bed, kind: "bridge" as const, polygon, height: 180, vertexElevations: polygon.map(() => 180), material: "wireform-track", layer: 2 };
  const mesh = arenaWireApronMesh(landing, .025);
  assert.ok(mesh.indices.length > 0 && mesh.indices.length < 1024);
  const originalArea = Math.abs(polygon.reduce((sum, p, i) => { const next = polygon[(i + 1) % polygon.length]!; return sum + p.x * next.y - p.y * next.x; }, 0)) * .5 * .025 ** 2;
  assert.ok(area(mesh) < originalArea * .4);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    assert.ok(Math.abs(mesh.positions[i + 1]! - 4.522) < 1e-5);
    for (let edge = 0; edge < polygon.length; edge++) { const a = polygon[edge]!, b = polygon[(edge + 1) % polygon.length]!; assert.ok((b.x - a.x) * (mesh.positions[i + 2]! / .025 - a.y) - (b.y - a.y) * (mesh.positions[i]! / .025 - a.x) >= -1e-3); }
  }
});

test("admitted plunger recoil moves only the inner head and spring inside its stationary housing", () => {
  for (const recoil of [0, .25, .5, 1, 10, -10, Number.NaN]) {
    const matrices = arenaShooterPose(1.6, recoil);
    assert.equal(matrices.length, 34 * 16); assert.ok(Array.from(matrices).every(Number.isFinite));
    for (let i = 0; i < 4; i++) assert.deepEqual(Array.from(matrices.subarray(i * 16, (i + 1) * 16)), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "outer frame and slide bed are stationary");
    const head = matrices.subarray(4 * 16, 5 * 16);
    assert.ok(head[12]! >= -.18001 && head[12]! <= 0, "inner head travel cannot exceed the visible fixed housing");
    assert.equal(head[13], 0); assert.equal(head[14], 0);
  }
});
