import { test } from "node:test";
import assert from "node:assert/strict";
import { standIn } from "../../render/test/gl-stand-in.ts";
import { createMeshPass } from "../src/draw-mesh.ts";
import { meshMatrix } from "../src/mesh.ts";
import { projectionOf } from "../src/project.ts";
import type { LookMesh } from "../src/mesh.ts";
import type { MeshDraw, MeshStyle } from "../src/sprites.ts";

const identity = meshMatrix({});
const bloom = new Float32Array(4);
const packed: LookMesh = {
  positions: new Float32Array([
    0, 0, 20, 1, 0, 20, 0, 1, 20,
    0, 0, -20, 1, 0, -20, 0, 1, -20,
    0, 0, 21, 1, 0, 21, 0, 1, 21,
    0, 0, 22, 1, 0, 22, 0, 1, 22,
  ]),
  normals: new Float32Array(36).fill(1),
  attrs: new Float32Array(48),
  bodies: new Float32Array(36),
  indices: new Uint32Array(Array.from({ length: 12 }, (_, i) => i)),
};
const bounds = (z: number): readonly [number, number, number, number, number, number] => [0, 0, z, 1, 1, z];
const region = (i: number, z: number): MeshDraw => ({ mesh: "pack", matrix: identity, look: 2, bloom, seam: 0x1a4d, chunk: 2,
  range: [i * 3, 3], rangeBounds: bounds(z), regionLandBatch: true });
const draws = [region(0, 20), region(1, -20), region(2, 21), region(3, 22)];
const view = projectionOf({ kind: "persp", eye: [0, 0, 0], target: [0, 0, 10], fov: 1.05 }, 640, 360, 100);

function render(input: readonly MeshDraw[], style: MeshStyle = {}, shot = view, geometry = packed) {
  const fake = standIn({ width: 640, height: 360 });
  const gl = fake.gl as unknown as WebGL2RenderingContext;
  const texture = {} as WebGLTexture;
  const pass = createMeshPass({ gl, link: () => gl.createProgram()!, looks: () => ({ palette: texture, looks: texture, paints: texture, places: texture, decals: texture }), size: () => [640, 360], pages: () => [null, null] });
  pass.setMesh("pack", geometry);
  fake.calls.length = 0;
  pass.draw(shot, input, { shadows: false, bloom: 0, ...style });
  return { calls: fake.calls, stats: pass.stats };
}
const submissions = (calls: ReturnType<typeof render>["calls"]) => calls.filter(([name]) => name === "drawElements").map(([, args]) => [args[1], args[3]]);

test("real mesh pass culls each shared range, then submits only adjacent visible ranges", () => {
  const batched = render(draws);
  const reference = render(draws, { regionLandBatch: false });
  assert.deepEqual(submissions(batched.calls), [[3, 0], [6, 24]], "hidden middle range must never be spanned");
  assert.deepEqual(submissions(reference.calls), [[3, 0], [3, 24], [3, 36]]);
  assert.equal(batched.stats.drawn, 3);
  assert.equal(batched.stats.culled, 1);
  assert.equal(batched.stats.triangles, reference.stats.triangles);
  const ids = batched.calls.filter(([name, args]) => name === "uniform1i" && String(args[0]).endsWith(":uDraw")).map(([, args]) => args[1]);
  assert.deepEqual(ids, [0], "land seam keeps the same first logical draw ID");
});

test("look and unmarked range boundaries stay separate; unrelated draws keep their IDs", () => {
  const input: MeshDraw[] = [region(0, 20), { ...region(1, 20), look: 3 }, { ...region(2, 21), regionLandBatch: undefined }, { ...region(3, 22), seam: undefined, regionLandBatch: undefined }];
  const result = render(input, { cull: false });
  assert.deepEqual(submissions(result.calls), [[3, 0], [3, 12], [3, 24], [3, 36]]);
  const ids = result.calls.filter(([name, args]) => name === "uniform1i" && String(args[0]).endsWith(":uDraw")).map(([, args]) => args[1]);
  assert.deepEqual(ids, [0, 3], "seam retains its first logical ID and a separate draw retains its own");
});

test("a reverse-looking view has the same visible triangles and logical IDs with batching on and off", () => {
  const reverse = projectionOf({ kind: "persp", eye: [0, 0, 40], target: [0, 0, 0], fov: 1.05 }, 640, 360, 100);
  const batched = render(draws, {}, reverse), reference = render(draws, { regionLandBatch: false }, reverse);
  assert.deepEqual(submissions(batched.calls), [[12, 0]]);
  assert.deepEqual(submissions(reference.calls), [[3, 0], [3, 12], [3, 24], [3, 36]]);
  assert.equal(batched.stats.triangles, reference.stats.triangles);
  assert.equal(batched.stats.drawn, reference.stats.drawn);
  const ids = batched.calls.filter(([name, args]) => name === "uniform1i" && String(args[0]).endsWith(":uDraw")).map(([, args]) => args[1]);
  assert.deepEqual(ids, [0]);
});

test("shadow-enabled pass keeps an off-camera upstream range as a caster", () => {
  const shadowMesh: LookMesh = { ...packed, positions: new Float32Array([
    0, 0, 20, 1, 0, 20, 0, 1, 20,
    0, 30, 20, 1, 30, 20, 0, 31, 20,
  ]), normals: new Float32Array(18), attrs: new Float32Array(24), bodies: new Float32Array(18), indices: new Uint32Array([0, 1, 2, 3, 4, 5]) };
  const input = [region(0, 20), { ...region(1, 20), rangeBounds: [0, 30, 20, 1, 31, 20] as const }];
  const result = render(input, { shadows: true, sun: [0, 1, 0] }, view, shadowMesh);
  const reference = render(input, { shadows: true, sun: [0, 1, 0], regionLandBatch: false }, view, shadowMesh);
  assert.equal(result.stats.drawn, 1, "the high tile is outside the camera");
  assert.equal(result.stats.shadowDrawn, 2, "the high tile still casts onto the visible receiver");
  assert.deepEqual(submissions(result.calls), [[3, 0], [3, 12], [3, 0]], "shadow submits both exact ranges; camera submits the visible one");
  assert.deepEqual(submissions(result.calls), submissions(reference.calls));
  assert.equal(result.stats.shadowTriangles, reference.stats.shadowTriangles);
  assert.equal(result.stats.triangles, reference.stats.triangles);
});
