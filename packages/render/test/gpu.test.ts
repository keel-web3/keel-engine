// The renderer without a GPU: the shaders' contracts (limits, uniform budget,
// the uniforms the renderer sets exist), the wedge the shader draws is the
// wedge physics collides with, and the renderer's bookkeeping through a
// recording stand-in for WebGL2. (The proof of concept's tests/gpu.test.mjs,
// ported. Pixels are checked in the browser: tools/parity.html.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as SH from "../src/shaders.ts";
import { createPixelRenderer, paletteRamps } from "../src/pixel-renderer.ts";
import type { RenderCanvas } from "../src/pixel-renderer.ts";
import { ALL_FX } from "../src/fx.ts";
import { buildPalette, createRoll, makePalette, stream } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { standIn } from "./gl-stand-in.ts";
import { poc, skip } from "./reference.ts";

test("limits a full game won't hit: 256 ramps, 255 materials, thousands of colours, hundreds of solids", () => {
  assert.ok(SH.MAX_RAMPS >= 64 && SH.MAX_MATERIALS >= 64);
  assert.ok(SH.MAX_COLOURS >= 1024 && SH.PALETTE_WIDTH >= 1024);
  assert.ok(SH.MAX_BOXES >= 96 && SH.MAX_CAPS >= 64 && SH.MAX_WEDGES >= 32, "never fewer than before");
  // (The raised limits stay: 256 boxes, 128 wedges, 256 capsules, 256 ramps, 255 materials, 65,536 colours.)
  assert.deepEqual([SH.MAX_BOXES, SH.MAX_WEDGES, SH.MAX_CAPS, SH.MAX_RAMPS, SH.MAX_MATERIALS, SH.MAX_COLOURS], [256, 128, 256, 256, 255, 65536]);
  // (Each solid block within WebGL2's baseline 16 KB uniform block.)
  for (const [n, per] of [[SH.MAX_BOXES, 2], [SH.MAX_WEDGES, 3], [SH.MAX_CAPS, 2]] as const) assert.ok(n * per * 16 <= 16384);
});

// The plain (non-block) uniforms a shader declares, in vec4-equivalents (a rough upper bound: one slot each, arrays by length).
function plainUniformSlots(src: string): number {
  const body = src.replace(/layout\(std140\) uniform \w+ \{[^}]*\};/g, "");
  let n = 0;
  for (const m of body.matchAll(/^uniform\s+\w+\s+([^;]+);/gm)) for (const part of (m[1] ?? "").split(",")) { const a = /\[(\d+)\]/.exec(part); n += a ? Number(a[1]) : 1; }
  return n;
}
test("the fragment shaders stay inside WebGL2's baseline uniform budget (224 vectors)", () => {
  for (const [name, src] of [["WORLD_FS", SH.WORLD_FS], ["PIXEL_FS", SH.PIXEL_FS]] as const) {
    const n = plainUniformSlots(src);
    assert.ok(n < 224, `${name}: ${n} slots`);
  }
});

test("every uniform the renderer sets is declared by its shader", async () => {
  const ts = await readFile(new URL("../src/pixel-renderer.ts", import.meta.url), "utf8");
  for (const [prog, src] of [["U", SH.WORLD_FS], ["X", SH.PIXEL_FS], ["P", SH.POINTS_VS]] as const) {
    const used = new Set([...ts.matchAll(new RegExp(`\\b${prog}\\.(u\\w+)`, "g"))].map((m) => m[1] ?? ""));
    assert.ok(used.size > 0);
    for (const u of used) assert.match(src, new RegExp(`uniform [^;]*\\b${u}\\b`), `${u} declared`);
  }
  for (const name of ["uData", "uData2", "uDepth", "uPalette", "uRamps", "uScreenTex"]) assert.match(SH.PIXEL_FS, new RegExp(`uniform sampler2D ${name};`));
  for (const block of ["Boxes", "Wedges", "Capsules"]) assert.match(SH.WORLD_FS, new RegExp(`uniform ${block} \\{`));
});

// The shader's wedge, line for line in TS (sdSection + sdWedge in WORLD_FS).
function shaderWedge(q: Vec3Like, h: Vec3Like, lo: number): number {
  const v = [[-h[2], -h[1]], [h[2], -h[1]], [h[2], -h[1] + 2 * h[1] * lo], [-h[2], h[1]]] as const;
  const p = [q[2], q[1]] as const;
  let out2 = 1e18;
  let far = -1e9;
  let inside = true;
  for (let i = 0; i < 4; i += 1) {
    const a = v[i]!;
    const b = v[(i + 1) & 3]!;
    const e = [b[0] - a[0], b[1] - a[1]] as const;
    const L2 = e[0] * e[0] + e[1] * e[1];
    if (L2 < 1e-12) continue;
    const w = [p[0] - a[0], p[1] - a[1]] as const;
    const t = Math.max(0, Math.min(1, (w[0] * e[0] + w[1] * e[1]) / L2));
    const r = [w[0] - e[0] * t, w[1] - e[1] * t] as const;
    out2 = Math.min(out2, r[0] * r[0] + r[1] * r[1]);
    const s = (w[0] * e[1] - w[1] * e[0]) / Math.sqrt(L2);
    if (s > 0) inside = false;
    far = Math.max(far, s);
  }
  const b = inside ? far : Math.sqrt(out2);
  const ax = Math.abs(q[0]) - h[0];
  return Math.hypot(Math.max(ax, 0), Math.max(b, 0)) + Math.min(Math.max(ax, b), 0);
}
// (Physics is ported beside this; until then the wedge is checked against the proof of concept's physics/character.js.)
type WedgeDistance = (p: Vec3Like, w: { c: Vec3Like; h: Vec3Like; yaw: number; lo: number }) => { d: number };
test("the wedge the shader draws is the wedge physics collides with (same turn, same solid)", { skip }, async () => {
  const { wedgeDistance } = await poc<{ wedgeDistance: WedgeDistance }>("src/physics/character.js");
  assert.match(SH.WORLD_FS, /vec2\(-h\.x, -h\.y\), vec2\(h\.x, -h\.y\), vec2\(h\.x, -h\.y \+ 2\.0 \* h\.y \* lo\), vec2\(-h\.x, h\.y\)/);
  for (const yaw of [0, 0.7, -2.2, Math.PI]) {
    for (const lo of [0, 0.4]) {
      const w = { c: [1, 0.5, -2] as Vec3, h: [0.9, 0.7, 1.6] as Vec3, yaw, lo };
      for (let k = 0; k < 80; k += 1) {
        const p: Vec3 = [1 + Math.sin(k * 1.3) * 2.4, 0.5 + Math.cos(k * 0.7) * 1.4, -2 + Math.sin(k * 2.1 + 0.4) * 2.6];
        // (The shader's turn: q.xz = mat2(c, s, -s, c) * q.xz.)
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const x = p[0] - w.c[0];
        const z = p[2] - w.c[2];
        const q: Vec3 = [c * x - s * z, p[1] - w.c[1], s * x + c * z];
        assert.ok(Math.abs(shaderWedge(q, w.h, lo) - wedgeDistance(p, w).d) < 1e-9, `yaw ${yaw} lo ${lo} at ${p.join(",")}`);
      }
    }
  }
});

test("the renderer (on a stand-in GL): big palettes, many materials, wedges by list or by kind, fx resolved per target", () => {
  const { canvas, calls } = standIn();
  const px = createPixelRenderer(canvas as unknown as RenderCanvas, { width: 64, height: 64 });
  // 3000 colours in 120 ramps of 25.
  const colours = Array.from({ length: 3000 }, (_, i): [number, number, number] => [i % 256, (i >> 8) & 255, 7]);
  const ramps = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`r${i}`, [i * 25, 25] as const]));
  px.setPalette(colours, ramps);
  const pal = calls.filter(([k, a]) => k === "texImage2D" && a[2] === "RGBA8" && a[3] === SH.PALETTE_WIDTH);
  assert.equal(pal.at(-1)?.[1][4], 3, "3000 colours on three rows of 1024");
  assert.equal(px.ramp("r119"), 119);
  px.setMaterials(Array.from({ length: 200 }, (_, i) => ({ ramp: `r${i % 120}` })));
  assert.throws(() => px.setMaterials(Array<{ ramp: string }>(256).fill({ ramp: "r0" })), /at most 255/);
  assert.throws(() => px.setPalette(colours, Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`x${i}`, [0, 1] as const]))), /at most 256/);
  const got = px.setWorld({
    boxes: [{ c: [0, 0, 0], h: [1, 1, 1] }, { c: [0, 2, 0], h: [1, 1, 1], kind: "wedge", lo: 0.2 }],
    wedges: [{ c: [3, 0, 0], h: [1, 1, 2], yaw: 1 }],
    capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: 0.1 }],
  });
  assert.deepEqual(got, { boxes: 1, wedges: 2, capsules: 1, dropped: 0 });
  const over = px.setWorld({ boxes: Array.from({ length: SH.MAX_BOXES + 5 }, () => ({ c: [0, 0, 0] as Vec3, h: [1, 1, 1] as Vec3 })) });
  assert.equal(over.dropped, 5, "past the limit is reported, not silent");
  px.setFx(ALL_FX());
  assert.equal(px.fxResolved.find((p) => p.name === "scanlines")?.on, false, "no scanlines at 64");
  px.setTarget(128, 128);
  assert.equal(px.fxResolved.find((p) => p.name === "scanlines")?.on, true, "re-resolved for the new target");
  px.toggleFx("scanlines", false);
  assert.equal(px.fxResolved.find((p) => p.name === "scanlines")?.on, false);
  assert.throws(() => px.setFx([{ name: "sparkle" } as never]), /Unknown fx pass/);
  px.render({ eye: [0, 2, -5], target: [0, 0, 0] });
  assert.ok(calls.some(([k]) => k === "drawArrays"));
  assert.equal(px.offPalette(new Uint8Array([0, 0, 7, 255, 1, 2, 3, 255])), 1, "one pixel off the palette");
});

test("a core palette goes straight in: paletteRamps turns its slots into setPalette's ramps", () => {
  const pal = buildPalette(makePalette(stream(createRoll("0x1234"), 0), { scheme: "Duotone" }));
  const ramps = paletteRamps(pal);
  assert.deepEqual(Object.keys(ramps), Object.keys(pal.ramps));
  for (const [name, [base, len]] of Object.entries(ramps)) assert.deepEqual({ base, len }, pal.ramps[name as keyof typeof pal.ramps]);
  const { canvas } = standIn();
  const px = createPixelRenderer(canvas as unknown as RenderCanvas);
  px.setPalette(pal.colours, ramps);
  assert.equal(px.ramp("accent"), Object.keys(ramps).indexOf("accent"));
  assert.deepEqual(px.palette, pal.colours);
});
