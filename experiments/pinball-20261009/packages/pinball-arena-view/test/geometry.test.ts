import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaSurfaceMesh, arenaRampMesh, arenaPhysicalMesh, triangulateArenaPolygon } from "../src/geometry.ts";
import type { ArenaSurface, ArenaRamp, ArenaField } from "@keel-engine/pinball-arena";

const biome = { forge: 0, neon: 0, garden: 1, glacier: 0, ruins: 0 };
const surface: ArenaSurface = { id: "concave", kind: "ground", polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }], layer: 2, height: 70, material: "stone", biome };
function triangleNormal(mesh: ReturnType<typeof arenaSurfaceMesh>, offset: number): [number, number, number] {
  const [a, b, c] = [0, 1, 2].map(i => Array.from(mesh.positions.slice(mesh.indices[offset + i]! * 3, mesh.indices[offset + i]! * 3 + 3)));
  const u = b!.map((n, i) => n - a![i]!), v = c!.map((n, i) => n - a![i]!);
  return [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
}

test("concave world surfaces preserve their actual area, elevation and upward face winding", () => {
  const mesh = arenaSurfaceMesh(surface, .025);
  assert.equal(mesh.indices.length, 48);
  let area = 0;
  for (let i = 0; i < 12; i += 3) {
    const n = triangleNormal(mesh, i); assert.ok(n[1] > 0); area += n[1] / 2 / (.025 ** 2);
  }
  assert.ok(Math.abs(area - 7) < 1e-5);
  assert.ok(Array.from(mesh.positions.slice(0, surface.polygon.length * 3)).filter((_, i) => i % 3 === 1).every(h => h === 1.75));
  assert.deepEqual(new Set(Array.from(mesh.positions).filter((_, i) => i % 3 === 0)), new Set([0, Math.fround(.025), Math.fround(.1)]));
  assert.throws(() => triangulateArenaPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), /zero area/);
});

test("sloped ramps share the physics endpoints, width and elevation, with matching normals", () => {
  const ramp: ArenaRamp = { id: "slope", ax: 10, ay: 20, bx: 210, by: 20, width: 80, fromLayer: 0, toLayer: 1, fromElevation: 0, toElevation: 100, bidirectional: true };
  const mesh = arenaRampMesh(ramp, .025);
  assert.deepEqual(Array.from(mesh.positions), [.25, 0, 1.5, 5.25, 2.5, 1.5, 5.25, 2.5, -.5, .25, 0, -.5]);
  const n = triangleNormal(mesh, 0), normal = Array.from(mesh.normals.slice(0, 3));
  assert.ok(n[1] > 0);
  assert.ok(Math.abs(n[0] / n[1] - normal[0]! / normal[1]!) < 1e-6);
  assert.throws(() => arenaRampMesh({ ...ramp, bx: ramp.ax }, .025), /positive length/);
});

test("mitered support beds keep supplied axial-plane corner heights and matching face normals", () => {
  // Tilted end cross-sections need distinct corner heights. The native ramp
  // rises one unit per two x units, regardless of how its track seams turn.
  const bed: ArenaSurface = { ...surface, id: "miter-slope", kind: "ramp", material: "shot-track", rampId: "native-ramp", polygon: [{ x: 0, y: 10 }, { x: 210, y: 20 }, { x: 190, y: -20 }, { x: 0, y: -10 }], vertexElevations: [0, 105, 95, 0] };
  const mesh = arenaSurfaceMesh(bed, .025);
  for (let i = 0; i < bed.polygon.length; i++) {
    assert.ok(Math.abs(mesh.positions[i * 3 + 1]! - mesh.positions[i * 3]! * .5) < 1e-6);
    assert.ok(Math.abs(mesh.normals[i * 3]! / mesh.normals[i * 3 + 1]! + .5) < 1e-6);
    assert.ok(Math.abs(mesh.normals[i * 3 + 2]!) < 1e-6);
  }
  for (let i = 0; i < 6; i += 3) assert.ok(triangleNormal(mesh, i)[1] > 0);
  assert.ok(Array.from(mesh.positions).every(Number.isFinite));
  assert.ok(Array.from(mesh.normals).every(Number.isFinite));
  assert.throws(() => arenaSurfaceMesh({ ...bed, vertexElevations: [0, 1] }, .025), /heights must match/);
  assert.throws(() => arenaSurfaceMesh({ ...bed, vertexElevations: [0, 105, NaN, 0] }, .025), /finite polygon/);
});

test("static wireforms retain their end elevation and are admitted once across chunk seams", () => {
  const rail = { id: "inclined", ax: 0, ay: 30, bx: 200, by: 30, radius: 3, restitution: .9, layer: 0, elevation: 0, elevationB: 100, material: "steel" as const };
  const field: Pick<ArenaField, "bounds" | "rails" | "bumpers"> = { bounds: [0, 0, 200, 100], rails: [rail, { ...rail, id: "outer-edge", ax: 200, bx: 200, ay: 50, by: 70, elevationB: 0 }], bumpers: [] };
  const all = arenaPhysicalMesh(field, .025), left = arenaPhysicalMesh(field, .025, [0, 0, 100, 100]), right = arenaPhysicalMesh(field, .025, [100, 0, 200, 100]);
  assert.equal(left.indices.length + right.indices.length, all.indices.length);
  assert.equal(left.indices.length, 0);
  assert.ok(Array.from(all.positions).filter((_, i) => i % 3 === 1).some(y => y > 2.5), "raised rail endpoint must remain above the native ramp crest");
  assert.ok(Array.from(all.positions).filter((_, i) => i % 3 === 1).some(y => y < .2), "ground endpoint must stay at its own height");
  assert.ok(Array.from(all.positions).every(Number.isFinite));
});
