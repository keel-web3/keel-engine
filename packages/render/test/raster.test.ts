// Raster mode (raster.ts): solids and meshes drawn as triangles into pass 1's
// own buffers, added beside the proof of concept's programs -- never instead of
// them. Creating a renderer and a normal frame make exactly the calls they
// always did (poc-equality.test.ts); raster mode compiles only when a frame or
// a mesh first asks; a frame after a raster frame is argument for argument the
// frame a renderer that never rasterised makes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPTH_OUT_FS, FAR, RASTER_FLOATS, RASTER_FS, RASTER_VS, RasterSolids, WORLD_FS, boxTemplate, capsuleTemplate, createPixelRenderer } from "../src/index.ts";
import type { RenderCanvas, RenderOptions } from "../src/index.ts";
import { standIn } from "./gl-stand-in.ts";

const frame: RenderOptions = { eye: [0, 2, -5], target: [0, 1, 0], fov: 1.1, time: 0.5 };

test("the box template: six faces of two triangles, each wound counter-clockwise from outside, flat normals", () => {
  const t = boxTemplate();
  assert.equal(t.verts.length, 24 * 3);
  assert.equal(t.index.length, 36);
  for (let i = 0; i < 36; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(t.verts.slice(t.index[i + k]! * 3, t.index[i + k]! * 3 + 3)));
    const n = Array.from(t.norms.slice(t.index[i]! * 3, t.index[i]! * 3 + 3));
    const u = [v[1]![0]! - v[0]![0]!, v[1]![1]! - v[0]![1]!, v[1]![2]! - v[0]![2]!], w = [v[2]![0]! - v[0]![0]!, v[2]![1]! - v[0]![1]!, v[2]![2]! - v[0]![2]!];
    const c = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    assert.ok(c[0]! * n[0]! + c[1]! * n[1]! + c[2]! * n[2]! > 0, `triangle ${i / 3} faces its normal`);
    for (const p of v) assert.ok(Math.abs(p[0]! * n[0]! + p[1]! * n[1]! + p[2]! * n[2]! - 1) < 1e-9, "on its face of the unit box");
  }
});

test("the capsule template: rings from a's pole to b's, every vertex a unit direction", () => {
  const t = capsuleTemplate(8, 2);
  const rows = 2 * (2 + 1), row = 9;
  assert.equal(t.verts.length / 3, rows * row);
  assert.equal(t.index.length, (rows - 1) * 8 * 6);
  for (let v = 0; v < t.verts.length / 3; v += 1) {
    const [c, s, sp] = [t.verts[v * 3]!, t.verts[v * 3 + 1]!, t.verts[v * 3 + 2]!];
    const cp = t.norms[v * 3]!;
    // (cos theta, sin theta) round, (cos phi, sin phi) along: the direction the shader builds is a unit vector.
    assert.ok(Math.abs(c * c + s * s - 1) < 1e-5 && Math.abs(cp * cp + sp * sp - 1) < 1e-5);
    assert.ok(t.norms[v * 3 + 1] === 0 || t.norms[v * 3 + 1] === 1, "which end");
  }
});

test("RasterSolids: the documented layout, growing past its capacity; blocks appended whole", () => {
  const s = new RasterSolids(2);
  s.box([1, 2, 3], [0.5, 0.6, 0.7], 0.3, 9, { id: 12, fade: 0.5, ramp: 40, light: 1.2, glow: 0.1 });
  s.wedge([4, 5, 6], [1, 1, 1], -0.2, 1.4, 3);
  s.capsule([0, 0, 0], [0, 1, 0], 0.25, 7);
  assert.deepEqual(Array.from(s.boxes.data.slice(0, RASTER_FLOATS)).map((x) => +x.toFixed(4)), [1, 2, 3, 9, 0.5, 0.6, 0.7, 0.3, 0, 40, 1.2, 12, 0.5, 0.1, 0, 0]);
  assert.equal(s.wedges.data[8], Math.fround(0.98), "a wedge's lo is clamped to 0.98");
  assert.deepEqual(Array.from(s.capsules.data.slice(0, 12)), [0, 0, 0, 7, 0, 1, 0, 0.25, 0, -1, 1, 0]);
  for (let i = 0; i < 100; i += 1) s.capsule([i, 0, 0], [i, 1, 0], 0.1, 1);
  assert.equal(s.capsules.count, 101);
  assert.equal(s.capsules.data[100 * RASTER_FLOATS], 99);
  const block = s.capsules.snapshot();
  const t = new RasterSolids(1);
  const at = t.capsules.append(block);
  t.capsules.append(block);
  assert.equal(at, 0);
  assert.equal(t.capsules.count, 202);
  assert.deepEqual(Array.from(t.capsules.data.slice(101 * RASTER_FLOATS, 102 * RASTER_FLOATS)), Array.from(block.slice(0, RASTER_FLOATS)));
  assert.equal(s.count, 103);
});

test("the raster shader lights as WORLD_FS does, and writes depth as the ray's length over FAR", () => {
  assert.ok(WORLD_FS.includes("L = (0.16 + 0.1 * n.y + 0.5 * diff) * mr.y + wglow + mr.w;"));
  assert.ok(RASTER_FS.includes("(0.16 + 0.1 * n.y + 0.5 * diff) * mr.y"), "the same sun, sky light and material scale");
  assert.ok(RASTER_FS.includes(`gl_FragDepth = clamp(dist / ${FAR.toFixed(1)}, 0.0, 1.0);`));
  assert.ok(RASTER_FS.includes("float wglow = clamp(1.0 - (vPos.y - uWaterY) / 1.6, 0.0, 1.0) * max(0.0, -n.y * 0.2 + 0.8) * 0.35;"), "the water's glow, as WORLD_FS has it");
  // (Own frame -> world, the inverse of WORLD_FS's `q.xz = mat2(c, s, -s, c) * q.xz`: x' = c x - s z, z' = s x + c z.)
  assert.ok(WORLD_FS.includes("q.xz = mat2(c, s, -s, c) * q.xz;"));
  assert.ok(RASTER_VS.includes("return vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);"));
  const yaw = 0.7, c = Math.cos(yaw), s = Math.sin(yaw);
  const toWorld = ([x, z]: [number, number]): [number, number] => [c * x + s * z, -s * x + c * z];
  const toBox = ([x, z]: [number, number]): [number, number] => [c * x - s * z, s * x + c * z];
  const back = toBox(toWorld([0.3, -1.2]));
  assert.ok(Math.abs(back[0] - 0.3) < 1e-12 && Math.abs(back[1] + 1.2) < 1e-12, "round trip");
  assert.ok(DEPTH_OUT_FS.includes("gl_FragDepth"));
});

function session(raster: boolean) {
  const A = standIn();
  const px = createPixelRenderer(A.canvas as unknown as RenderCanvas, { width: 48, height: 40 });
  px.setPalette([[10, 10, 10], [200, 200, 200], [90, 40, 20]], { a: [0, 2], b: [2, 1] });
  px.setMaterials([{ ramp: "a" }, { ramp: "b", light: 1.1 }]);
  px.setWorld({ capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: 0.3, mat: 1 }], boxes: [{ c: [0.5, 0.5, 0], h: [0.1, 0.2, 0.3], mat: 0 }] });
  const created = A.calls.length;
  if (raster) {
    const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    px.setMesh("ground", { positions: tri, normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), looks: new Float32Array(12) });
    const solids = new RasterSolids();
    solids.box([0, 0, 0], [1, 1, 1], 0, 0);
    solids.capsule([0, 0, 0], [0, 1, 0], 0.2, 1, { fade: 0.5 });
    solids.capsule([1, 0, 0], [1, 1, 0], 0.2, 1);
    px.render({ ...frame, raster: { solids, meshes: ["ground", "missing"] }, depthOut: true });
    assert.deepEqual(px.rasterStats.meshes, 1);
    assert.equal(px.rasterStats.instances, 3);
    px.setMesh("ground", null);
    assert.equal(px.rasterStats.meshBytes, 0);
  } else px.render(frame); // (the same first frame without raster: its fx refresh, as the raster frame had)
  const before = A.calls.length;
  px.render(frame);
  return { A, created, before, calls: A.calls.slice(before) };
}

test("raster mode compiles only when asked, and a frame after it makes the same calls as a frame from a renderer that never rasterised", () => {
  const plain = session(false);
  const drawn = session(true);
  assert.deepEqual(plain.A.calls.slice(0, plain.created), drawn.A.calls.slice(0, drawn.created), "creating a renderer: the same calls");
  // (A first frame with raster is the first frame without it, plus the raster draws and the depth copy.)
  const first = drawn.A.calls.slice(drawn.created, drawn.before).filter(([n]) => !/^(drawElements|drawElementsInstanced|bindVertexArray|colorMask|depthMask)$/.test(n)).length;
  assert.ok(first > plain.before - plain.created);
  const shaders = (calls: typeof plain.A.calls) => calls.filter(([n]) => n === "createShader").length;
  assert.equal(shaders(plain.A.calls), 6, "three programs, as ever");
  assert.equal(shaders(drawn.A.calls), 10, "raster mode added two of its own (the raster program, the depth copy)");
  assert.deepEqual(drawn.calls, plain.calls, "render() after a raster frame: argument for argument the same");
  // The raster frame itself: the mesh drawn, boxes and capsules each one instanced draw, then pass 2, then the depth copy.
  const r = drawn.A.calls.slice(drawn.created, drawn.before);
  const names = r.map(([n]) => n);
  assert.equal(names.filter((n) => n === "drawArrays" && true).length >= 2, true);
  const inst = r.filter(([n]) => n === "drawElementsInstanced");
  assert.deepEqual(inst.map(([, a]) => a[4]), [1, 2], "one box, two capsules: one draw each");
  const mask = r.filter(([n]) => n === "colorMask").map(([, a]) => a.join(","));
  assert.deepEqual(mask, ["false,false,false,false", "true,true,true,true"], "the depth copy writes depth only");
  assert.ok(names.lastIndexOf("drawElementsInstanced") < names.lastIndexOf("colorMask"), "solids before the depth copy");
});
