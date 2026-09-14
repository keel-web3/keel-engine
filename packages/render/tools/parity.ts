// Pixel parity on a real GPU: the fx sheet's scene (the proof of concept's
// tools/fx-sheet.html -- boxes, wedge ramps, water, capsule figures, an
// emissive rail and lamp, sparks, a 64-entry ramp), drawn by the proof of
// concept's renderer and by this one, at 32 / 64 / 128 / 256, through every
// fx row; each pair of frames compared pixel for pixel, each checked
// palette-true. Bundled for the page by tools/build.mjs (the browser can't
// load .ts); tools/parity.html runs it.

import { ALL_FX, createPixelRenderer } from "../src/index.ts";
import type { FxEntry, Material, PixelRenderer, RenderBox, RenderCapsule, RenderOptions, RenderParticle, RenderWedge } from "../src/index.ts";

export const SIZES = [32, 64, 128, 256];

function oklchToRgb(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const [r, g, bb] = lin.map((v) => { const c = Math.max(0, Math.min(1, v)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); });
  return [r!, g!, bb!];
}
const ramp = (n: number, h: number, C: number, L0: number, L1: number, turn = 0) => Array.from({ length: n }, (_, i) => { const k = i / (n - 1); return oklchToRgb(L0 + (L1 - L0) * k, C * Math.sin(Math.PI * (0.15 + 0.7 * k)), h + turn * (k - 0.5)); });
const LIST: Record<string, [number, number, number][]> = {
  stone: ramp(8, 250, 0.018, 0.16, 0.86, 10), rail: ramp(5, 230, 0.03, 0.3, 0.92), dark: ramp(3, 280, 0.02, 0.08, 0.3),
  water: ramp(8, 172, 0.13, 0.12, 0.93, -20), sky: ramp(6, 45, 0.035, 0.08, 0.7, 20), fur: ramp(5, 80, 0.03, 0.55, 0.98),
  jacket: ramp(5, 180, 0.12, 0.3, 0.8, 15), spark: ramp(5, 40, 0.19, 0.55, 0.97, 60), glow: ramp(5, 70, 0.14, 0.55, 0.98, 20),
  neon: ramp(6, 330, 0.2, 0.35, 0.92, 30), ramp: ramp(6, 30, 0.06, 0.25, 0.8, 10), white: ramp(3, 90, 0.01, 0.9, 1),
  stoneNight: ramp(8, 265, 0.03, 0.08, 0.55, 10), waterNight: ramp(8, 220, 0.09, 0.08, 0.6, -20), skyNight: ramp(6, 270, 0.05, 0.05, 0.4, 10),
  smooth: ramp(64, 300, 0.12, 0.2, 0.9, 80),
};
export const colours: [number, number, number][] = [];
export const ramps: Record<string, [number, number]> = {};
for (const [name, r] of Object.entries(LIST)) { ramps[name] = [colours.length, r.length]; colours.push(...r); }
export const MATERIALS: Material[] = [
  { ramp: "stone", light: 1, pattern: 1 }, { ramp: "stone", light: 0.9, pattern: 1 }, { ramp: "rail", light: 1, glow: 0.35 }, { ramp: "dark", light: 0.8 },
  { ramp: "water" }, { ramp: "sky" }, { ramp: "fur", light: 1.1 }, { ramp: "jacket", light: 1 }, { ramp: "ramp", light: 1 }, { ramp: "glow", light: 0.6, glow: 0.6 },
  { ramp: "neon", light: 0.7, glow: 0.4 }, { ramp: "smooth", light: 1.2 },
];

export const boxes: RenderBox[] = [];
const slab = (x0: number, x1: number, z0: number, z1: number, top: number, mat = 1) => boxes.push({ c: [(x0 + x1) / 2, top - 1.5, (z0 + z1) / 2], h: [(x1 - x0) / 2, 1.5, (z1 - z0) / 2], mat });
slab(-4, 4, -3, 6, 0.35);
slab(-4, 4, 11, 16, 1.95);
boxes.push({ c: [-3.8, 2.5, 7], h: [0.25, 4, 5], mat: 0 }, { c: [4.5, 3, 9], h: [0.3, 4.5, 2.5], yaw: 0.35, mat: 0 }, { c: [2.4, 0.95, 3.2], h: [0.3, 0.6, 0.3], yaw: 0.6, mat: 10 });
export const wedges: RenderWedge[] = [
  { c: [0, 0.35 + 0.8, 8.5], h: [1.6, 0.8, 2.5], yaw: Math.PI, lo: 0, mat: 8 },
  { c: [-2.2, 0.35 + 0.9, 3.8], h: [0.8, 0.9, 0.9], yaw: Math.PI / 2, mat: 0 },
];
export const capsules: RenderCapsule[] = [];
const fig = (x: number, z: number, mat: number, head: number) => {
  capsules.push({ a: [x - 0.12, 0.45, z], b: [x - 0.12, 0.85, z], r: 0.09, mat: 3 }, { a: [x + 0.12, 0.45, z], b: [x + 0.12, 0.85, z], r: 0.09, mat: 3 });
  capsules.push({ a: [x, 1.0, z], b: [x, 1.35, z], r: 0.2, mat }, { a: [x - 0.28, 1.3, z], b: [x - 0.35, 0.95, z + 0.1], r: 0.07, mat }, { a: [x + 0.28, 1.3, z], b: [x + 0.4, 1.0, z - 0.1], r: 0.07, mat });
  capsules.push({ a: [x, 1.62, z], b: [x, 1.64, z], r: 0.19, mat: head });
};
fig(0.6, 1.2, 7, 6);
fig(-1.4, 5.8, 10, 6);
for (let k = 0; k < 8; k += 1) capsules.push({ a: [4.2, 1.1 + 0.08 * k, -1 + k * 1.6], b: [4.2, 1.1 + 0.08 * (k + 1), -1 + (k + 1) * 1.6], r: 0.07, mat: 2 });
capsules.push({ a: [-2.2, 0.35, 1.5], b: [-2.2, 2.3, 1.5], r: 0.06, mat: 3 }, { a: [-2.2, 2.45, 1.5], b: [-2.2, 2.46, 1.5], r: 0.18, mat: 9 });
capsules.push({ a: [1.8, 2.5, 13], b: [1.8, 2.52, 13], r: 0.5, mat: 11 });
export const particles: RenderParticle[] = Array.from({ length: 24 }, (_, i) => ({ p: [4.2 + Math.sin(i * 2.1) * 0.3, 1.3 + ((i * 37) % 10) * 0.05, 2 + (i % 8) * 0.25], size: 0.7, light: 0.9, ramp: "spark", glow: 0.8 }));
export const VIEW: RenderOptions = { eye: [2.6, 3.6, -6.5], target: [0.2, 1.2, 4.5], fov: 1.1, sun: [0.45, 0.8, 0.35], waterY: 0, fogNear: 30, fogFar: 120 };

/** The fx sheet's rows: each an fx list. */
export const ROWS: [string, FxEntry[]][] = [
  ["base", []],
  ["fog", [{ name: "fog", ramp: "sky", near: 6, far: 22, light: 0.35 }]],
  ["glow", [{ name: "glow" }]],
  ["glow tint", [{ name: "glow", tint: true, radius: 4 }]],
  ["rim", [{ name: "rim", steps: 2 }]],
  ["flash", [{ name: "flash", amount: 0.8, mats: [6, 7] }]],
  ["vignette", [{ name: "vignette", steps: 2.5 }]],
  ["scanlines", [{ name: "scanlines" }]],
  ["crt", [{ name: "crt", curve: 0.12, border: { ramp: "dark", index: 0 } }]],
  ["grade dusk", [{ name: "grade", preset: "dusk" }]],
  ["grade night", [{ name: "grade", preset: "night", map: { stone: "stoneNight", water: "waterNight", sky: "skyNight" } }]],
  ["cycle", [{ name: "cycle", ramps: { water: { speed: 4, from: 0.4 }, neon: { speed: 6, from: 0.3 } } }]],
  ["dither stipple", [{ name: "dither", screen: "stipple" }]],
  ["dither halftone", [{ name: "dither", screen: "dot" }]],
  ["dither lines", [{ name: "dither", screen: "line" }]],
  ["dither none", [{ name: "dither", screen: "none" }]],
  ["outline outer", [{ name: "outline", mode: "outer" }]],
  ["outline ink", [{ name: "outline", color: { ramp: "neon", index: 1 } }]],
  ["outline none", [{ name: "outline", mode: "none" }]],
  ["all fx", ALL_FX()],
];
const styleFor = (size: number) => ({ screen: size <= 48 ? 2 : size <= 128 ? 4 : 8, dither: 0.9, outline: 1 });

/** The renderer's interface, as both implementations offer it (the POC's is the same, untyped). */
type Renderer = Pick<PixelRenderer, "setPalette" | "setMaterials" | "setStyle" | "setFx" | "setWorld" | "setTarget" | "render" | "read" | "offPalette" | "width" | "height">;
type Make = (canvas: HTMLCanvasElement, size: { width: number; height: number }) => Renderer;

function setUp(make: Make): Renderer {
  const px = make(document.createElement("canvas"), { width: 128, height: 128 });
  px.setPalette(colours, ramps);
  px.setMaterials(MATERIALS);
  return px;
}
function draw(px: Renderer, fx: FxEntry[], size: number, time: number): Uint8Array {
  if (px.width !== size) px.setTarget(size, size);
  px.setStyle(styleFor(size));
  px.setFx(fx);
  px.setWorld({ boxes, wedges, capsules });
  px.render({ ...VIEW, time, particles });
  return px.read();
}

export interface Cell { row: string; size: number; time: number; differing: number; offTs: number; offPoc: number; ts: Uint8Array; poc: Uint8Array }

/** Every row at every size (and a second time, for cycling and water), both renderers; the pixels that differ. */
export function run(pocMake: Make, times: readonly number[] = [0.6, 2.35]): Cell[] {
  const ts = setUp(createPixelRenderer as unknown as Make);
  const poc = setUp(pocMake);
  const out: Cell[] = [];
  for (const time of times) {
    for (const [row, fx] of ROWS) {
      for (const size of SIZES) {
        const a = draw(ts, fx, size, time);
        const b = draw(poc, fx, size, time);
        let differing = 0;
        for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) differing += 1;
        out.push({ row, size, time, differing, offTs: ts.offPalette(a), offPoc: poc.offPalette(b), ts: a, poc: b });
      }
    }
  }
  return out;
}

export { createPixelRenderer };
