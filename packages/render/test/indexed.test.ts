// Bake mode: the programs a bake draws with (indexed.ts), added beside the
// proof of concept's -- never instead of them. A normal frame's GL calls stay
// exactly what they were (poc-equality.test.ts compares them with the proof of
// concept's), bake mode compiles only when it's first asked for, and a frame
// after a bake makes the same calls as a frame from a renderer that never baked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BAKE_WORLD_FS, DEPTH_FS, INDEX_FS, WORLD_FS, createPixelRenderer, readIndexedPixel, unpackDepth } from "../src/index.ts";
import type { RenderCanvas, RenderOptions } from "../src/index.ts";
import { standIn } from "./gl-stand-in.ts";

const uniforms = (src: string): string[] => [...src.matchAll(/^uniform\s+\w+\s+(\w+)/gm)].map((m) => m[1]!).sort();

test("BAKE_WORLD_FS is WORLD_FS plus the surface coordinate, the split and the orthographic rays: the same march, data2's .zw filled", () => {
  assert.deepEqual(uniforms(BAKE_WORLD_FS), [...uniforms(WORLD_FS), "uOrthoH", "uSplit"].sort());
  assert.ok(BAKE_WORLD_FS.includes("vec2 surfaceUv(vec3 p, int k)"));
  assert.ok(BAKE_WORLD_FS.includes("outData2 = vec4(glow, facing, surf);"));
  assert.ok(!BAKE_WORLD_FS.includes("outData2 = vec4(glow, facing, 0.0, 0.0);"));
  // Everything else is WORLD_FS's: take the additions out and the rest is character for character.
  const back = BAKE_WORLD_FS
    .replace(/uniform vec4 uSplit;[^\n]*\nuniform float uOrthoH;[^\n]*\n\/\/ Where on its part[\s\S]*?\n}\n\nvoid main\(\) \{/, "void main() {")
    .replace("vec3 rd = uOrthoH > 0.0 ? uFwd : normalize(", "vec3 rd = normalize(").replace("vec3 ro = uOrthoH > 0.0 ? uEye + (uv.x * aspect * uRight + uv.y * uUp) * uOrthoH : uEye;", "vec3 ro = uEye;")
    .replace(" vec2 surf = vec2(0.0);", "").replace(" surf = surfaceUv(p, int(hit.z + 0.5)); ramp = uSplit.w > 0.5 && dot(p - uSplit.xyz, uFwd) > 0.0 ? 1.0 : 0.0;", "")
    .replace("vec4(glow, facing, surf)", "vec4(glow, facing, 0.0, 0.0)");
  assert.equal(back, WORLD_FS);
  for (const src of [INDEX_FS, DEPTH_FS]) assert.ok(src.startsWith("#version 300 es") && src.includes("out vec4 outColor;"));
});

test("an index pixel and a packed depth, taken apart", () => {
  assert.deepEqual(readIndexedPixel(128 + 64 + 21, 200, 17, 250), { covered: true, edge: true, behind: false, material: 21, shade: 200, u: 17, v: 250 });
  assert.deepEqual(readIndexedPixel(128 + 32 + 5, 0, 0, 0), { covered: true, edge: false, behind: true, material: 5, shade: 0, u: 0, v: 0 });
  assert.equal(readIndexedPixel(0, 0, 0, 0).covered, false);
  for (const z of [0, 1, 0.5, 0.123456, 0.999999]) {
    const v = Math.round(z * 16777215);
    assert.ok(Math.abs(unpackDepth(v >> 16, (v >> 8) & 255, v & 255) - z) < 1e-7);
  }
});

const frame: RenderOptions = { eye: [0, 1, 5], target: [0, 0.5, 0], fov: 0.8, time: 1.5, sun: [0.3, 0.8, 0.4] };
function session(bake: boolean) {
  const A = standIn();
  const px = createPixelRenderer(A.canvas as unknown as RenderCanvas, { width: 48, height: 40 });
  px.setPalette([[10, 10, 10], [200, 200, 200], [90, 40, 20]], { a: [0, 2], b: [2, 1] });
  px.setMaterials([{ ramp: "a" }, { ramp: "b", light: 1.1 }]);
  px.setWorld({ capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: 0.3, mat: 1 }], boxes: [{ c: [0.5, 0.5, 0], h: [0.1, 0.2, 0.3], mat: 0 }] });
  const created = A.calls.length;
  if (bake) {
    px.renderIndexed({ ...frame, gap: 0.3, split: [0, 0.5, 0] });
    const data = px.readData();
    assert.equal(data.data.length, 48 * 40 * 4);
    assert.equal(data.depth.length, 48 * 40);
    assert.equal(px.readIndexed().length, 48 * 40 * 4);
  }
  const before = A.calls.length;
  px.render(frame);
  return { A, created, before, calls: A.calls.slice(before) };
}

test("bake mode compiles only when asked, and a frame after it makes the same calls as a frame from a renderer that never baked", () => {
  const plain = session(false);
  const baked = session(true);
  assert.deepEqual(plain.A.calls.slice(0, plain.created), baked.A.calls.slice(0, baked.created), "creating a renderer: the same calls (no bake programs)");
  const shaders = (calls: typeof plain.A.calls) => calls.filter(([n]) => n === "createShader").length;
  assert.equal(shaders(plain.A.calls), 6, "three programs, as ever");
  assert.equal(shaders(baked.A.calls), 12, "bake mode added three programs of its own");
  assert.deepEqual(baked.calls, plain.calls, "render() after a bake: argument for argument the same");
  // The index pass draws into its own framebuffer, and hands it back.
  const idx = baked.A.calls.slice(baked.created, baked.before);
  assert.ok(idx.some(([n, a]) => n === "uniform1f" && String(a[0]).endsWith(":uGap") && Math.abs((a[1] as number) - 0.3 / 140) < 1e-9), "the gap, in depth units");
  assert.ok(idx.filter(([n]) => n === "drawArrays").length >= 3, "world, index, depth passes");
  assert.ok(idx.some(([n, a]) => n === "uniform4f" && String(a[0]).endsWith(":uSplit") && a[2] === 0.5 && a[4] === 1), "the split point, on");
});
