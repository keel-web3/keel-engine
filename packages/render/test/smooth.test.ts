// Smooth edges (smooth.ts): the pass-2 shader's reaches scaled to art pixels, the buffers k times the target each way,
// the resolve down to the canvas -- and crisp, and a hardware target, untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPTH_OUT_FS, DIRECT_PIXEL_FS, PIXEL_FS, createPixelRenderer } from "../src/index.ts";
import type { RenderCanvas, RenderOptions } from "../src/index.ts";
import { RESOLVE_FS, smoothDepthOutFs, smoothPixelFs, supersampleFor } from "../src/smooth.ts";
import { standIn } from "./gl-stand-in.ts";

const frame: RenderOptions = { eye: [0, 2, -5], target: [0, 1, 0], fov: 1.1, time: 0.5 };

test("the smooth pass is the pixel pass with its reaches in art pixels", () => {
  for (const fs of [PIXEL_FS, DIRECT_PIXEL_FS]) {
    const s = smoothPixelFs(fs);
    assert.match(s, /uniform int uSS;/);
    assert.ok(s.includes("screenAt(ivec2(gl_FragCoord.xy) / uSS)"), "one threshold an art pixel");
    assert.ok(s.includes("px + o * uSS"), "the outline looks an art pixel over");
    assert.ok(s.includes("uRim.y * float(uSS)") && s.includes("rr * float(uSS)"), "rim and glow reach in art pixels");
    assert.equal(s.replace(/\nuniform int uSS;[^\n]*/, "").replaceAll(" / uSS", "").replaceAll(" * uSS", "").replaceAll(" * float(uSS)", "").replace("(int(gl_FragCoord.y))", "int(gl_FragCoord.y)"), fs, "nothing else changed");
  }
  assert.ok(smoothDepthOutFs(DEPTH_OUT_FS).includes("ivec2(gl_FragCoord.xy) * uSS + uSS / 2"));
  assert.ok(RESOLVE_FS.includes("acc / float(uSS * uSS)"));
  assert.throws(() => smoothPixelFs("void main() {}"), /changed under its edit/);
});

test("samples to an art pixel: 3, fewer on a big target, as asked", () => {
  assert.equal(supersampleFor(224, 224), 3);
  assert.equal(supersampleFor(480, 270), 2);
  assert.equal(supersampleFor(1280, 720), 1);
  assert.equal(supersampleFor(1280, 720, 2), 2);
  assert.equal(supersampleFor(64, 64, 9), 4);
});

function session(style: Parameters<ReturnType<typeof createPixelRenderer>["setStyle"]>[0], profile?: "game-boy") {
  const A = standIn();
  const px = createPixelRenderer(A.canvas as unknown as RenderCanvas, profile ? { profile } : { width: 48, height: 40 });
  if (style) px.setStyle(style);
  px.setPalette([[10, 10, 10], [200, 200, 200], [90, 40, 20]], { a: [0, 2], b: [2, 1] });
  px.setMaterials([{ ramp: "a" }, { ramp: "b", light: 1.1 }]);
  px.setWorld({ boxes: [{ c: [0.5, 0.5, 0], h: [0.1, 0.2, 0.3], mat: 0 }] });
  const before = A.calls.length;
  px.render({ ...frame, depthOut: true });
  return { px, calls: A.calls.slice(before) };
}

test("smooth (the default): fine buffers, pass 2 into them, the resolve onto the canvas", () => {
  const { px, calls } = session(undefined);
  assert.equal(px.supersample, 3);
  const views = calls.filter(([n]) => n === "viewport").map(([, a]) => a.slice(2));
  assert.deepEqual(views[0], [144, 120], "pass 1 at three samples a pixel each way");
  assert.ok(views.some((v) => v[0] === 48 && v[1] === 40), "the resolve at the target");
  assert.ok(calls.some(([n, a]) => n === "texImage2D" && a[3] === 144 && a[4] === 120), "the fine buffers");
  assert.ok(calls.some(([n, a]) => n === "uniform1i" && String(a[0]).endsWith(":uSS") && a[1] === 3), "uSS set");
  // the canvas stays the target's size
  assert.equal(px.width, 48);
});

test("crisp: no fine buffers, no resolve -- the classic frame", () => {
  const { px, calls } = session({ edges: "crisp" });
  assert.equal(px.supersample, 1);
  assert.ok(calls.filter(([n]) => n === "viewport").every(([, a]) => a[2] === 48 && a[3] === 40));
  assert.ok(!calls.some(([n, a]) => n === "uniform1i" && String(a[0]).endsWith(":uSS")));
});

test("a hardware target is always crisp, whatever the style asks", () => {
  const { px } = session({ edges: "smooth" }, "game-boy");
  assert.equal(px.supersample, 1);
});
