// The TypeScript renderer against the JavaScript proof of concept it was
// ported from (src/gpu/*.js and src/fx/fx.js, imported from its repo, never
// written to): the same shader source, character for character; the same
// resolved fx and uniforms over thousands of random lists and targets; and
// the same WebGL2 calls, argument for argument, from both renderers driven
// through random palettes, materials, worlds, styles, fx and frames on a
// recording stand-in. (Same calls + same shaders = the same pixels; the
// pixels are compared on a real GPU by tools/parity.html.)

import { test } from "node:test";
import * as tSh from "../src/shaders.ts";
import * as tFx from "../src/fx.ts";
import * as tPx from "../src/pixel-renderer.ts";
import type { FxEntry, FxLook, FxTarget, RenderStyle } from "../src/fx.ts";
import type { Material, RenderCanvas, RenderOptions, RenderWorld, StyleInput } from "../src/pixel-renderer.ts";
import { standIn } from "./gl-stand-in.ts";
import { counter, hasPoc, outcome, poc, rand, skip } from "./reference.ts";

const ref = hasPoc
  ? await Promise.all([poc<typeof tSh>("src/gpu/shaders.js"), poc<typeof tFx>("src/fx/fx.js"), poc<typeof tPx>("src/gpu/pixel-renderer.js")])
  : null;
const [jSh, jFx, jPx] = ref ?? ([] as unknown as NonNullable<typeof ref>);
const { same, summary } = counter();
let calls = 0;

type R = () => number;
const pick = <T>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const maybe = (r: R, p = 0.5): boolean => r() < p;
const num = (r: R, a: number, b: number): number => a + (b - a) * r();
const RAMP_NAMES = ["stone", "water", "sky", "neon", "stoneNight", "dark", "glow", "spark"];
const SCREEN_PREFS = ["auto", "none", "ordered", "dot", "line", "noise", "pattern", "bayer2", "bayer4", "bayer8", "stipple", "halftone", "hatch", "weave", "ign", "checker", "chunky", "coarseDot", "lines", "diagonal", "nope"];

// A random fx list: every pass, odd params, duplicates, passes turned off, names by ramp or by index.
function fxList(r: R): FxEntry[] {
  const ramp = (): string | number => (maybe(r, 0.8) ? pick(r, [...RAMP_NAMES, "missing"]) : Math.floor(num(r, -1, 6)));
  const entry = () => (maybe(r, 0.7) ? { ramp: ramp(), index: Math.floor(num(r, -6, 8)) } : Math.floor(num(r, -2, 40)));
  const on = (): { on?: boolean } => (maybe(r, 0.15) ? { on: maybe(r) } : {});
  const make: Record<string, () => Record<string, unknown>> = {
    crt: () => ({ ...(maybe(r) ? { curve: num(r, 0, 0.3) } : {}), ...(maybe(r) ? { border: entry() } : {}), ...(maybe(r, 0.3) ? { minSize: pick(r, [0, 48, 64, 200]) } : {}) }),
    grade: () => ({ ...(maybe(r) ? { preset: pick(r, ["day", "dusk", "night", "noon"]) } : {}), ...(maybe(r, 0.3) ? { shift: num(r, -3, 2) } : {}), ...(maybe(r) ? { map: { [pick(r, RAMP_NAMES)]: pick(r, [...RAMP_NAMES, "gone"]), stone: "stoneNight" } } : {}) }),
    fog: () => ({ ...(maybe(r) ? { ramp: ramp() } : {}), ...(maybe(r) ? { near: num(r, 0, 40), far: num(r, 10, 140) } : {}), ...(maybe(r, 0.3) ? { amount: num(r, 0, 1), light: num(r, 0, 1) } : {}) }),
    glow: () => ({ ...(maybe(r) ? { radius: num(r, 0, 24) } : {}), ...(maybe(r) ? { halo: num(r, 0, 4), self: num(r, 0, 3) } : {}), ...(maybe(r, 0.3) ? { threshold: num(r, 0, 1), tint: maybe(r) } : {}) }),
    rim: () => ({ ...(maybe(r) ? { width: num(r, 0, 9) } : {}), ...(maybe(r) ? { steps: num(r, 0, 3) } : {}), ...(maybe(r, 0.4) ? { dir: maybe(r) ? "sun" : [num(r, -1, 1), num(r, -1, 1)] } : {}) }),
    flash: () => ({ amount: num(r, -0.5, 1.5), ...(maybe(r) ? { mats: Array.from({ length: Math.floor(num(r, 0, 12)) }, () => Math.floor(num(r, 0, 20))) } : {}), ...(maybe(r, 0.3) ? { ids: [Math.floor(num(r, 0, 100)), Math.floor(num(r, 100, 250))] } : {}), ...(maybe(r, 0.3) ? { ramp: ramp() } : {}) }),
    vignette: () => ({ ...(maybe(r) ? { inner: num(r, 0, 1), outer: num(r, 0.5, 2) } : {}), ...(maybe(r) ? { steps: num(r, 0, 4) } : {}) }),
    scanlines: () => ({ ...(maybe(r) ? { period: num(r, 0, 12) } : {}), ...(maybe(r) ? { steps: num(r, 0, 3) } : {}), ...(maybe(r, 0.3) ? { minSize: pick(r, [0, 64, 96, 300]) } : {}) }),
    dither: () => ({ ...(maybe(r, 0.8) ? { screen: pick(r, SCREEN_PREFS) } : {}), ...(maybe(r, 0.4) ? { amount: num(r, -0.2, 1) } : {}) }),
    outline: () => ({ ...(maybe(r, 0.8) ? { mode: pick(r, ["all", "outer", "none"]) } : {}), ...(maybe(r) ? { steps: Math.floor(num(r, 0, 5)) } : {}), ...(maybe(r) ? { gap: num(r, 0, 4) } : {}), ...(maybe(r, 0.4) ? { color: maybe(r, 0.2) ? null : entry() } : {}) }),
    cycle: () => ({
      ramps: maybe(r) ? RAMP_NAMES.filter(() => maybe(r, 0.3)).concat(maybe(r, 0.2) ? ["missing"] : [])
        : Object.fromEntries([...RAMP_NAMES, "missing"].filter(() => maybe(r, 0.3)).map((n) => [n, { ...(maybe(r) ? { speed: num(r, 0, 8) } : {}), ...(maybe(r) ? { from: num(r, -0.2, 1.2) } : {}) }])),
      ...(maybe(r, 0.3) ? { speed: num(r, 0, 6) } : {}), ...(maybe(r, 0.3) ? { from: num(r, 0, 1) } : {}),
    }),
  };
  const names = Object.keys(make);
  return Array.from({ length: Math.floor(num(r, 0, 9)) }, () => { const name = pick(r, names); return { name, ...on(), ...make[name]!() } as unknown as FxEntry; });
}
const target = (r: R): FxTarget => {
  const s = pick(r, [8, 24, 32, 47, 48, 49, 64, 95, 96, 127, 128, 129, 192, 256, 320]);
  const t = pick(r, [8, 32, 64, 96, 128, 200, 256]);
  return pick(r, [s, { width: s, height: t }, [t, s] as const]);
};
const RAMPS: Record<string, [number, number]> = { stone: [0, 8], water: [8, 8], sky: [16, 6], neon: [22, 6], stoneNight: [28, 8], dark: [36, 3], glow: [39, 5], spark: [44, 1] };
const look = (style: RenderStyle | undefined): FxLook => ({ ramp: (n) => RAMP_NAMES.indexOf(n), rampOf: (i) => RAMPS[RAMP_NAMES[i] ?? ""] ?? [0, 1], style, far: 140 });
const styles: (RenderStyle | undefined)[] = [undefined, { screen: 4, dither: 0.9, outline: 1 }, { screen: 0, dither: 0, outline: 0 }, { screen: 8, dither: 0.5, outline: 1 }, { screen: "stipple", dither: 0.9, outline: 1 }, { screen: "bayer2", dither: 1, outline: 0 }, { screen: "none", dither: 0.9, outline: 1 }, { screen: "zigzag" as never, dither: 0.9, outline: 1 }];

test("shaders: every limit and every GLSL string, character for character", { skip }, () => {
  for (const k of Object.keys(jSh).sort()) same("shader exports", (tSh as Record<string, unknown>)[k], (jSh as Record<string, unknown>)[k], k);
  same("shader exports", Object.keys(tSh).sort(), Object.keys(jSh).sort());
});

test("fx: the tables, and resolveFx / fxUniforms / toggleFx over thousands of random lists and targets", { skip }, () => {
  same("fx tables", tFx.FX_ORDER, jFx.FX_ORDER);
  same("fx tables", tFx.FX_NAMES, jFx.FX_NAMES);
  same("fx tables", tFx.GRADE_PRESETS, jFx.GRADE_PRESETS);
  same("fx tables", tFx.ALL_FX(), jFx.ALL_FX());
  for (const n of tFx.FX_NAMES) same("fx tables", tFx.FX[n].defaults, jFx.FX[n].defaults, n);
  const r = rand(2026);
  for (let i = 0; i < 6000; i += 1) {
    const list = fxList(r);
    const t = target(r);
    const a = outcome(() => tFx.resolveFx(list, t));
    const b = outcome(() => jFx.resolveFx(list, t));
    same("fx resolveFx", a, b, JSON.stringify({ list, t }));
    if ("ok" in a && "ok" in b) {
      for (const style of [pick(r, styles), pick(r, styles)]) same("fx fxUniforms", outcome(() => tFx.fxUniforms(a.ok, look(style))), outcome(() => jFx.fxUniforms(b.ok, look(style))));
    }
    const name = pick(r, tFx.FX_NAMES);
    const on = maybe(r);
    same("fx toggleFx", outcome(() => tFx.toggleFx(list, name, on)), outcome(() => jFx.toggleFx(list, name, on)));
  }
  same("fx toggleFx", outcome(() => tFx.toggleFx([], "zap" as never, true)), outcome(() => jFx.toggleFx([], "zap" as never, true)));
  for (const s of [32, 64, 128, 256]) same("fx ALL_FX", tFx.resolveFx(tFx.ALL_FX(), s), jFx.resolveFx(jFx.ALL_FX(), s));
});

test("fx: screen tiles, every core screen at several tile sizes, byte for byte", { skip }, () => {
  for (const id of ["bayer2", "bayer4", "bayer8", "chunky", "halftone", "coarseDot", "lines", "diagonal", "hatch", "stipple", "ign", "checker", "weave"] as const) {
    for (const tile of [8, 64, 192]) same("fx screen tiles", tFx.screenTile(id, tile), jFx.screenTile(id, tile));
  }
});

// ---------------------------------------------------------------- the renderer, call for call

const v3 = (r: R, s = 10): [number, number, number] => [num(r, -s, s), num(r, -s, s), num(r, -s, s)];
function world(r: R): RenderWorld {
  const big = maybe(r, 0.1);
  const n = (m: number): number => Math.floor(num(r, 0, big ? m + 12 : 12));
  const mat = (): { mat?: number } => (maybe(r, 0.8) ? { mat: Math.floor(num(r, 0, 12)) } : {});
  const yaw = (): { yaw?: number } => (maybe(r, 0.7) ? { yaw: num(r, -4, 4) } : {});
  return {
    ...(maybe(r, 0.9) ? { boxes: Array.from({ length: n(tSh.MAX_BOXES) }, () => ({ c: v3(r), h: v3(r, 2).map(Math.abs) as [number, number, number], ...yaw(), ...mat(), ...(maybe(r, 0.15) ? { kind: "wedge", lo: num(r, -0.5, 1.5) } : {}) })) } : {}),
    ...(maybe(r, 0.7) ? { wedges: Array.from({ length: n(tSh.MAX_WEDGES) }, () => ({ c: v3(r), h: v3(r, 2).map(Math.abs) as [number, number, number], ...yaw(), ...mat(), ...(maybe(r) ? { lo: num(r, -0.5, 1.5) } : {}) })) } : {}),
    ...(maybe(r, 0.8) ? { capsules: Array.from({ length: n(tSh.MAX_CAPS) }, () => ({ a: v3(r), b: v3(r), r: num(r, 0.01, 1), ...mat() })) } : {}),
  };
}
function frame(r: R): RenderOptions {
  const o: Record<string, unknown> = { eye: v3(r), target: maybe(r, 0.05) ? [0, 0, 0] : v3(r) };
  if (maybe(r)) o["fov"] = num(r, 0.3, 2);
  if (maybe(r)) o["time"] = num(r, 0, 20);
  if (maybe(r)) o["sun"] = maybe(r, 0.1) ? [0, 0, 1] : v3(r, 1);
  if (maybe(r)) o["waterY"] = num(r, -1, 1);
  if (maybe(r)) { o["fogNear"] = num(r, 5, 30); o["fogFar"] = num(r, 40, 140); }
  if (maybe(r)) o["particles"] = Array.from({ length: Math.floor(num(r, 0, 30)) }, () => ({ p: v3(r), ...(maybe(r) ? { size: num(r, 0.2, 2) } : {}), ...(maybe(r) ? { light: num(r, 0, 1) } : {}), ...(maybe(r) ? { ramp: pick(r, [...RAMP_NAMES, "missing"]) } : {}), ...(maybe(r) ? { glow: num(r, 0, 1) } : {}) }));
  return o as unknown as RenderOptions;
}

test("the renderer: the same GL calls, argument for argument, over random sessions (with and without the timer query)", { skip }, () => {
  for (let seed = 1; seed <= 160; seed += 1) {
    const timer = seed % 3 === 0;
    const size = { width: Math.floor(num(rand(seed), 8, 300)), height: Math.floor(num(rand(seed * 7), 8, 300)) };
    const A = standIn({ timer });
    const B = standIn({ timer });
    const ta = tPx.createPixelRenderer(A.canvas as unknown as RenderCanvas, size);
    const tb = jPx.createPixelRenderer(B.canvas as unknown as RenderCanvas, size);
    same("renderer limits", ta.limits, tb.limits);
    const r = rand(seed * 101);
    // A session: a random run of calls, the same on both.
    for (let step = 0; step < 40; step += 1) {
      const op = Math.floor(r() * 10);
      let a: unknown;
      let b: unknown;
      if (op === 0) {
        const n = Math.floor(num(r, 1, maybe(r, 0.1) ? 5000 : 60));
        const colours = Array.from({ length: n }, () => [Math.floor(num(r, 0, 256)), Math.floor(num(r, 0, 256)), Math.floor(num(r, 0, 256))] as [number, number, number]);
        const names = [...RAMP_NAMES, ...Array.from({ length: maybe(r, 0.05) ? 260 : Math.floor(num(r, 0, 20)) }, (_, i) => `r${i}`)];
        const ramps = Object.fromEntries(names.filter(() => maybe(r, 0.8)).map((k) => [k, [Math.floor(num(r, 0, n)), Math.floor(num(r, 1, 30))] as const]));
        a = outcome(() => ta.setPalette(colours, ramps)); b = outcome(() => tb.setPalette(colours, ramps));
      } else if (op === 1) {
        const list: Material[] = Array.from({ length: Math.floor(num(r, 0, maybe(r, 0.05) ? 300 : 16)) }, () => ({ ramp: pick(r, [...RAMP_NAMES, "missing"]), ...(maybe(r) ? { light: num(r, 0, 2) } : {}), ...(maybe(r) ? { pattern: Math.floor(num(r, 0, 2)) } : {}), ...(maybe(r) ? { glow: num(r, 0, 1) } : {}) }));
        a = outcome(() => ta.setMaterials(list)); b = outcome(() => tb.setMaterials(list));
      } else if (op === 2) {
        const s: StyleInput = { ...(maybe(r) ? { screen: pick(r, [0, 2, 4, 8, "stipple", "halftone", "bayer4", "none"] as const) } : {}), ...(maybe(r) ? { dither: num(r, 0, 1) } : {}), ...(maybe(r) ? { outline: pick(r, [0, 1, true, false]) } : {}) };
        const none = maybe(r, 0.1);
        a = outcome(() => (none ? ta.setStyle() : ta.setStyle(s))); b = outcome(() => (none ? tb.setStyle() : tb.setStyle(s)));
      } else if (op === 3) {
        const w = world(r);
        a = outcome(() => ta.setWorld(w)); b = outcome(() => tb.setWorld(w));
      } else if (op === 4) {
        const list = fxList(r);
        a = outcome(() => ta.setFx(list)); b = outcome(() => tb.setFx(list));
      } else if (op === 5) {
        const name = pick(r, tFx.FX_NAMES);
        const on = maybe(r);
        a = outcome(() => ta.toggleFx(name, on)); b = outcome(() => tb.toggleFx(name, on));
      } else if (op === 6) {
        const w = Math.floor(num(r, -10, 300));
        const h = Math.floor(num(r, -10, 300));
        a = outcome(() => ta.setTarget(w, h)); b = outcome(() => tb.setTarget(w, h));
        same("renderer state", [ta.width, ta.height, A.canvas.width, A.canvas.height], [tb.width, tb.height, B.canvas.width, B.canvas.height]);
      } else if (op === 7) {
        a = outcome(() => ({ resolved: ta.fxResolved, fx: ta.fx, palette: ta.palette, ramps: RAMP_NAMES.map((n) => ta.ramp(n)), gpuMs: ta.gpuMs }));
        b = outcome(() => ({ resolved: tb.fxResolved, fx: tb.fx, palette: tb.palette, ramps: RAMP_NAMES.map((n) => tb.ramp(n)), gpuMs: tb.gpuMs }));
      } else if (op === 8) {
        a = outcome(() => [ta.read(), ta.offPalette()]); b = outcome(() => [tb.read(), tb.offPalette()]);
      } else {
        const f = frame(r);
        a = outcome(() => ta.render(f)); b = outcome(() => tb.render(f));
      }
      same("renderer results", a, b, `seed ${seed} step ${step} op ${op}`);
    }
    // And one more frame, whatever state it ended in.
    const f = frame(r);
    same("renderer results", outcome(() => ta.render(f)), outcome(() => tb.render(f)));
    same("renderer sessions (GL call logs)", A.calls, B.calls, `seed ${seed}`);
    calls += A.calls.length;
  }
});

test("summary", { skip }, () => {
  console.log(`${summary("render vs the proof of concept (all identical)")}\n  GL calls compared, argument for argument: ${calls}`);
});
