import { test } from "node:test";
import assert from "node:assert/strict";
import { standIn } from "../../render/test/gl-stand-in.ts";
import { createMeshPass } from "../src/draw-mesh.ts";
import { meshMatrix } from "../src/mesh.ts";
import { projectionOf } from "../src/project.ts";

test("the mesh pass releases resized canvas attachments and reacquires a deleted same-sized offscreen target", () => {
  const fake = standIn({ width: 390, height: 844 });
  const gl = fake.gl as unknown as WebGL2RenderingContext, texture = {} as WebGLTexture;
  let width = 390, height = 844, primaryWidth = width, primaryHeight = height;
  const pass = createMeshPass({ gl, link: () => gl.createProgram()!,
    looks: () => ({ palette: texture, looks: texture, paints: texture, places: texture, decals: texture }),
    size: () => [width, height], primarySize: () => [primaryWidth, primaryHeight], pages: () => [null, null] });
  pass.setMesh("triangle", { positions: new Float32Array([-1, 0, 10, 1, 0, 10, 0, 1, 10]), normals: new Float32Array(9),
    attrs: new Float32Array(12), bodies: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) });
  const draw = () => pass.draw(projectionOf({ kind: "persp", eye: [0, 0, 0], target: [0, 0, 10], fov: 1 }, width, height, 100),
    [{ mesh: "triangle", matrix: meshMatrix({}), look: 0 }], { cull: false, shadows: false, bloom: 0, mirror: 0 });
  draw();
  assert.equal(pass.stats.targetWorkspaces, 1);
  assert.equal(pass.stats.targetColourBytes, 390 * 844 * 32);
  fake.calls.length = 0;
  primaryHeight = 760;
  // Same active dimensions, but a new canvas resolution: the old primary is now an offscreen picture.
  draw();
  assert.equal(fake.calls.filter(([name]) => name === "deleteTexture").length, 4);
  assert.equal(fake.calls.filter(([name]) => name === "deleteRenderbuffer").length, 1);
  assert.equal(fake.calls.filter(([name]) => name === "deleteFramebuffer").length, 1);
  const deleted = fake.calls.findIndex(([name]) => name === "deleteTexture");
  const created = fake.calls.findIndex(([name]) => name === "createTexture");
  assert.ok(deleted >= 0 && created > deleted, "release superseded targets before allocation");
  assert.equal(fake.calls.filter(([name]) => name === "texImage2D").length, 4, "same-sized deleted targets are reacquired, never used stale");
  fake.calls.length = 0;
  height = 760; draw();
  assert.equal(pass.stats.targetWorkspaces, 2);
  assert.equal(pass.stats.targetColourBytes, (390 * 844 + 390 * 760) * 32);
  // Current primary is reused for every pass; the explicit offscreen size alone owns the other buffer.
  fake.calls.length = 0;
  draw();
  assert.equal(fake.calls.filter(([name]) => name === "texImage2D").length, 0);
  assert.equal(pass.stats.triangles, 1);
  assert.equal(pass.stats.meshBytes, 168);
  pass.setMesh("triangle", { positions: new Float32Array(9), normals: new Float32Array(9), attrs: new Float32Array(12),
    bodies: new Float32Array(9), indices: new Uint32Array(3), facade: new Float32Array(3) });
  assert.equal(pass.stats.meshBytes, 180, "replacement removes the old payload rather than accumulating");
  pass.setMesh("triangle", null); assert.equal(pass.stats.meshBytes, 0); assert.equal(pass.stats.meshes, 0);
});
