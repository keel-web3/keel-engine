import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STUDIO, boundsOf, box, compose, createFloat, createKey, createSpin, createSpring, cylinder, invert, lathe, mergeMeshes, multiply,
  perspective, roundedRect, rotationY, slab, studioGlsl, studioRadiance, transformMesh, transformPoint, translation, triangulate, outline,
  insetPolygon, signedArea, type MeshData,
} from "../src/index.ts";
import { manifest } from "../src/module.ts";

/** Signed volume by the divergence theorem: positive when every face points out. */
function volume(m: MeshData): number {
  let v = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i]! * 3, b = m.indices[i + 1]! * 3, c = m.indices[i + 2]! * 3, p = m.positions;
    v += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
  }
  return v;
}

test("the manifest is an opt-in presentation module", () => {
  assert.equal(manifest.id, "keel/studio");
  assert.ok(manifest.needs.some((n) => n.startsWith("keel/runtime")));
});

test("matrices compose and invert", () => {
  const m = compose(translation(1, 2, 3), rotationY(0.7));
  const p = transformPoint(multiply(invert(m), m), [0.3, -1, 2]);
  for (const [a, b] of [[p[0], 0.3], [p[1], -1], [p[2], 2]] as const) assert.ok(Math.abs(a - b) < 1e-9);
  const pr = perspective({ fovy: 0.5, aspect: 1.5, near: 0.1, far: 10, shiftX: 0.2 });
  assert.ok(Math.abs(pr[8]! + 0.2) < 1e-6);
});

test("solids are closed, point outward and have the right volume", () => {
  const b = box([0, 0, 0], [1, 2, 3]);
  assert.ok(Math.abs(volume(b) - 48) < 1e-6);
  const c = cylinder(1, 0, 2, 64);
  assert.ok(Math.abs(volume(c) - Math.PI * 2) / (Math.PI * 2) < 0.01);
  const s = slab(roundedRect(0, 0, 10, 6, 1), -1, 1, { size: 0.3, kind: "chamfer" }, { size: 0.3, kind: "round", steps: 4 }, { seg: 6 });
  const v = volume(s);
  assert.ok(v > 0, "outward");
  assert.ok(v < 10 * 6 * 2 && v > (10 * 6 - (4 - Math.PI)) * 2 * 0.9, `volume ${v}`);
  const l = lathe([[0, 0], [1, 0], [1, 1], [0, 1]], 48, [1, 2]);
  assert.ok(volume(l) > 0);
  // A mirror keeps faces outward.
  assert.ok(volume(transformMesh(b, compose(new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])))) > 0);
  const bb = boundsOf(mergeMeshes(b, transformMesh(b, translation(5, 0, 0))));
  assert.deepEqual([bb.min[0], bb.max[0]], [-1, 6]);
});

test("outlines keep a constant point count and insets shrink them", () => {
  const p = roundedRect(0, 0, 10, 6, [1, 2, 3, 0.5]);
  assert.equal(outline(p, 5).length, 4 * 6);
  assert.equal(outline(insetPolygon(p, 0.4), 5).length, 4 * 6);
  assert.ok(signedArea(outline(insetPolygon(p, 0.4), 5)) < signedArea(outline(p, 5)));
  const tri = triangulate(outline(p, 5));
  assert.equal(tri.length, (4 * 6 - 2) * 3);
});

test("the studio's GLSL and TypeScript agree on the key light", () => {
  const key = studioRadiance(STUDIO, STUDIO.boxes[0]!.dir);
  assert.ok(key[0] > 3, "the key is bright");
  const down = studioRadiance(STUDIO, [0, -1, 0.0001]);
  assert.ok(down[0] < 0.1, "the floor is dark");
  const g = studioGlsl(STUDIO);
  assert.match(g, /vec3 studio\(vec3 d\)/);
  assert.equal((g.match(/softBox\(d,/g) ?? []).length, STUDIO.boxes.length);
});

test("a spin flings, slows and springs back to the hero angle", () => {
  const s = createSpin({ heroYaw: 0.3, settleAfter: 0.5 });
  s.grab(0, 0, 0);
  for (let i = 1; i <= 6; i += 1) s.drag(i * 20, 0, i * 16);
  s.release(6 * 16 + 1);
  assert.ok(s.state.vyaw > 0, "flung");
  let t = 0;
  for (let i = 0; i < 600; i += 1) { s.step(1 / 60); t += 1 / 60; }
  const off = ((s.state.yaw - 0.3) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  assert.ok(Math.abs(off) < 1e-2, `home ${s.state.yaw}`);
});

test("a key travels down and back, a float bobs, a spring arrives", () => {
  const k = createKey();
  k.press();
  for (let i = 0; i < 30; i += 1) k.step(1 / 120);
  assert.ok(k.travel > 0.95);
  k.release();
  for (let i = 0; i < 240; i += 1) k.step(1 / 120);
  assert.equal(k.travel, 0);
  const f = createFloat();
  for (let i = 0; i < 180; i += 1) f.step(1 / 60);
  assert.ok(f.amount > 0.9);
  f.on = false;
  for (let i = 0; i < 600; i += 1) f.step(1 / 60);
  assert.equal(f.amount, 0);
  assert.equal(f.pose().y, 0);
  const sp = createSpring(0, 10, 1);
  sp.set(2);
  for (let i = 0; i < 300; i += 1) sp.step(1 / 60);
  assert.equal(sp.value, 2);
});

/** A stand-in WebGL2 context: every call answers something plausible, and programs report done only when told. */
function fakeGl() {
  const consts = new Map<string, number>();
  const calls = { link: 0, linkStatus: 0 };
  let compiled = false;
  const ext = { COMPLETION_STATUS_KHR: 0x91b1 };
  const gl: Record<string | symbol, unknown> = {
    getExtension: (n: string) => (n === "KHR_parallel_shader_compile" ? ext : {}),
    getParameter: () => 4,
    isContextLost: () => false,
    linkProgram: () => { calls.link += 1; },
    getProgramParameter: (_p: unknown, k: number) => {
      if (k === ext.COMPLETION_STATUS_KHR) return compiled;
      if (k === consts.get("ACTIVE_UNIFORMS")) return 0;
      calls.linkStatus += 1; return true;
    },
    getShaderParameter: () => true,
    checkFramebufferStatus: () => consts.get("FRAMEBUFFER_COMPLETE"),
  };
  const proxy: unknown = new Proxy(gl, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "string" && /^[A-Z0-9_]+$/.test(k)) { if (!consts.has(k)) consts.set(k, 0x1000 + consts.size); return consts.get(k); }
      return () => ({});
    },
  });
  const canvas = { width: 2, height: 2, getContext: () => proxy, addEventListener: () => {} };
  return { canvas, calls, finishCompiling: () => { compiled = true; } };
}

test("prepare() compiles every program ahead of time, waiting on the GPU instead of blocking a frame", async () => {
  const { createStudioRenderer } = await import("../src/renderer.ts");
  const f = fakeGl();
  const r = createStudioRenderer(f.canvas as unknown as HTMLCanvasElement, { shareCanvas: true });
  const linked = f.calls.link, statusReads = f.calls.linkStatus;
  const ready = r.prepare({ width: 1000, height: 700 });
  assert.ok(f.calls.link >= linked + 12, "every program's link is requested at once");
  assert.ok(f.canvas.width >= 1000 && f.canvas.height >= 700, "the shared canvas is grown to the size asked");
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(f.calls.linkStatus, statusReads, "no status is read (a wait) before the GPU says it's done");
  f.finishCompiling();
  await ready;
  assert.ok(f.calls.linkStatus >= statusReads + 12, "each is finished once it's done");
  const after = f.calls.link;
  await r.prepare();
  assert.equal(f.calls.link, after, "a second prepare compiles nothing again");
});
