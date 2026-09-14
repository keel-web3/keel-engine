// fx.ts: the declarative list, resolved for a target size (every pixel-sized
// param scales with the picture), turned into the pixel pass's uniforms.
// (The proof of concept's tests/fx.test.mjs, ported.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCREENS, SCREEN_IDS, screenForTarget } from "@keel-engine/core";
import { ALL_FX, FX, FX_NAMES, FX_ORDER, fxUniforms, resolveFx, screenTile, toggleFx } from "../src/fx.ts";
import type { FxEntry, FxLook, FxName, FxResolved, FxResolvedParams, FxTarget, RenderStyle } from "../src/fx.ts";

const SIZES = [32, 48, 64, 96, 128, 192, 256];
const get = <K extends FxName>(list: FxResolved[], name: K): Extract<FxResolved, { name: K }> => {
  const p = list.find((q) => q.name === name);
  assert.ok(p, `${name} resolved`);
  return p as Extract<FxResolved, { name: K }>;
};
/** The params of a pass that resolved on. */
const params = <K extends FxName>(list: FxResolved[], name: K): FxResolvedParams[K] => {
  const p = get(list, name);
  assert.equal(p.on, true, `${name} on`);
  return p.params as unknown as FxResolvedParams[K];
};
// A palette as the renderer knows it: ramp names -> index, index -> [base, len].
const RAMPS: Record<string, [number, number]> = { stone: [0, 8], water: [8, 8], sky: [16, 6], neon: [22, 6], stoneNight: [28, 8], dark: [36, 3] };
const NAMES = Object.keys(RAMPS);
const look = (style?: RenderStyle): FxLook => ({ ramp: (n) => NAMES.indexOf(n), rampOf: (i) => RAMPS[NAMES[i] ?? ""] ?? [0, 1], style, far: 140 });

test("every pass is known, ordered and has defaults; unknown names throw", () => {
  assert.deepEqual([...FX_NAMES].sort(), [...FX_ORDER].sort());
  for (const n of FX_NAMES) assert.equal(typeof FX[n].resolve, "function");
  assert.throws(() => resolveFx([{ name: "bloomy" } as unknown as FxEntry], 128), /Unknown fx pass/);
  assert.throws(() => toggleFx([], "nope" as FxName, true), /Unknown fx pass/);
});

test("resolveFx is pure and deterministic, in FX_ORDER, one entry per pass (later entries merge)", () => {
  const list: FxEntry[] = [{ name: "vignette", steps: 1 }, { name: "glow" }, { name: "vignette", inner: 0.3 }];
  const a = resolveFx(list, 128);
  assert.deepEqual(a, resolveFx(list, 128));
  assert.deepEqual(list, [{ name: "vignette", steps: 1 }, { name: "glow" }, { name: "vignette", inner: 0.3 }], "the list is untouched");
  assert.deepEqual(a.map((p) => p.name), ["glow", "vignette"]);
  assert.deepEqual(get(a, "vignette").params, { inner: 0.3, outer: 1.1, steps: 1 });
});

test("pixel params scale with the target: the glow's halo radius, the rim's width, scanlines' period", () => {
  const r = (s: FxTarget) => params(resolveFx([{ name: "glow", radius: 3 }], s), "glow").radius;
  assert.deepEqual(SIZES.map(r), [1, 1, 2, 2, 3, 5, 6]);
  const w = (s: number) => params(resolveFx([{ name: "rim" }], s), "rim").width;
  assert.deepEqual([32, 128, 256].map(w), [1, 1, 2]);
  const sc = (s: number) => get(resolveFx([{ name: "scanlines" }], s), "scanlines");
  const off = sc(64);
  assert.equal(off.on, false);
  assert.match(off.on ? "" : off.note, /96/);
  assert.equal(sc(96).on, true);
  assert.deepEqual([96, 128, 256].map((s) => params(resolveFx([{ name: "scanlines" }], s), "scanlines").period), [2, 2, 4]);
  assert.deepEqual([96, 128, 256].map((s) => params(resolveFx([{ name: "scanlines" }], s), "scanlines").dark), [1, 1, 2]);
  // (Non-square: the short side rules.)
  assert.equal(r({ width: 256, height: 64 }), 2);
  assert.equal(r([256, 64]), 2);
});

test("crt only from 64 px; fog, vignette and grade are resolution-free", () => {
  assert.equal(get(resolveFx([{ name: "crt" }], 48), "crt").on, false);
  assert.equal(get(resolveFx([{ name: "crt" }], 64), "crt").on, true);
  for (const n of ["fog", "vignette", "grade"] as const) assert.deepEqual(get(resolveFx([{ name: n }], 32), n).params, get(resolveFx([{ name: n }], 256), n).params);
  assert.equal(params(resolveFx([{ name: "grade", preset: "night" }], 64), "grade").shift, -1.4);
  assert.equal(params(resolveFx([{ name: "grade", preset: "night", shift: -2 }], 64), "grade").shift, -2);
});

test("the dither pass picks its screen for the target through core's screenForTarget", () => {
  for (const s of SIZES) {
    for (const pref of ["auto", "noise", "dot", "line", "stipple", "halftone", "bayer8"]) {
      const got = params(resolveFx([{ name: "dither", screen: pref }], s), "dither").screen;
      assert.equal(got, screenForTarget(s, s, pref === "auto" ? "ordered" : pref).id, `${pref} at ${s}`);
    }
  }
  assert.equal(params(resolveFx([{ name: "dither", screen: "none" }], 64), "dither").screen, "none");
});

test("toggleFx turns a pass off or on by name (adding it when it wasn't listed), purely", () => {
  const list: FxEntry[] = [{ name: "glow" }];
  const off = toggleFx(list, "glow", false);
  assert.deepEqual(list, [{ name: "glow" }]);
  const g = get(resolveFx(off, 128), "glow");
  assert.equal(g.on, false);
  assert.equal(g.on ? "" : g.note, "turned off");
  const added = toggleFx(list, "vignette", true);
  assert.deepEqual(added.map((e) => e.name), ["glow", "vignette"]);
});

test("no list, no change: the uniforms reproduce the classic style (screen, dither, outline 3 darker at 0.56 m)", () => {
  const { u, ramps, screen } = fxUniforms(resolveFx([], 128), look({ screen: 4, dither: 0.9, outline: 1 }));
  assert.equal(u.uScreen, 4);
  assert.equal(u.uDither, 0.9);
  assert.deepEqual(u.uOutline, [1, 3, 0.004]);
  assert.equal(u.uOutlineInk, -1);
  for (const k of ["uFog", "uGlow", "uVig", "uScan", "uCrt", "uRim", "uGrade"] as const) assert.equal(u[k][0], 0, `${k} off`);
  assert.equal(u.uFlash[0], 0);
  assert.equal(u.uCycle, 0);
  assert.deepEqual(ramps, { cycle: [], grade: [] });
  assert.equal(screen, null);
  assert.deepEqual(fxUniforms(resolveFx([], 64), look({ screen: 2, dither: 0.9, outline: 0 })).u.uOutline, [0, 3, 0.004]);
});

test("uniforms: named ramps become indices; cycling, grading, the outline's ink and the flash's materials", () => {
  const list: FxEntry[] = [
    { name: "cycle", ramps: { water: { speed: 4, from: 0.5 }, nothing: {} } },
    { name: "grade", preset: "night", map: { stone: "stoneNight" } },
    { name: "outline", mode: "outer", gap: 2.8, color: { ramp: "dark", index: -1 } },
    { name: "fog", ramp: "sky", near: 10, far: 40 },
    { name: "flash", amount: 0.7, mats: [6, 7] },
    { name: "dither", screen: "stipple" },
    { name: "crt", border: { ramp: "dark", index: 0 } },
  ];
  const { u, ramps, screen } = fxUniforms(resolveFx(list, 128), look({ screen: 4, dither: 0.9, outline: 1 }));
  assert.deepEqual(ramps.cycle, [[1, 4, 4]], "water: from entry 4 of 8, 4 entries/s (an unknown ramp is skipped)");
  assert.deepEqual(ramps.grade, [[0, 4]]);
  assert.equal(u.uCycle, 1);
  assert.deepEqual(u.uGrade, [1, -1.4]);
  assert.deepEqual(u.uOutline, [1, 3, 2.8 / 140]);
  assert.equal(u.uOutlineInk, 36 + 2, "the dark ramp's last entry");
  assert.deepEqual(u.uFog, [1, 10, 40, 1]);
  assert.deepEqual(u.uFogLook, [2, 0.3]);
  assert.deepEqual(u.uFlash, [0.7, -1, 1, 0]);
  assert.deepEqual(u.uFlashMats, [6, 7, -1, -1, -1, -1, -1, -1]);
  assert.equal(u.uScreen, -1);
  assert.equal(screen, "stipple");
  assert.deepEqual(u.uCrt, [1, 0.08, 36, 0]);
  // (Bayer screens by name go to the shader's own code, not the texture.)
  assert.equal(fxUniforms(resolveFx([{ name: "dither", screen: "bayer8" }], 256), look()).u.uScreen, 8);
  // (A dither pass turned off means no screen: flat steps.)
  assert.equal(fxUniforms(resolveFx([{ name: "dither", on: false }], 256), look({ screen: 8, dither: 0.9, outline: 1 })).u.uScreen, 0);
});

test("ALL_FX resolves at every size, and its uniforms are finite numbers", () => {
  for (const s of SIZES) {
    const r = resolveFx(ALL_FX(), s);
    const { u } = fxUniforms(r, look({ screen: 4, dither: 0.9, outline: 1 }));
    for (const [k, v] of Object.entries(u)) if (v !== null) for (const x of [v].flat()) assert.ok(Number.isFinite(x), `${k} at ${s}: ${String(v)}`);
    assert.equal(get(r, "scanlines").on, s >= 96);
  }
});

test("screen tiles: each core screen's thresholds, sampled, repeat within the 192 px tile (ign excepted: noise)", () => {
  for (const id of SCREEN_IDS) {
    const t = screenTile(id, 192);
    assert.equal(t.length, 192 * 192);
    assert.ok(t.some((v) => v > 128) && t.some((v) => v < 128), `${id} spans the range`);
    if (id === "ign") continue;
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
      const v = Math.round(SCREENS[id].at(x + 192, y + 192) * 255);
      assert.ok(Math.abs((t[y * 192 + x] ?? -9) - v) <= 1, `${id} repeats at 192 (${x}, ${y})`);
    }
  }
});
