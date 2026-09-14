// The rule, enforced: simulation and generation use core's dmath; presentation
// may use Math (docs/CONVENTIONS.md, "Deterministic math").
//
// Math's transcendental functions give different last bits on different CPUs
// and engines (an arm64 Mac's V8 against x64's, Firefox's against Chrome's),
// and `**` with anything but a 2 is pow. On a path whose results are stored,
// compared, replayed or hashed -- a body's step, a unit's recipe, a level's
// layout, a codec's numbers -- one bit is a desync. So in the files below, no
// Math.sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/exp/expm1/log/log1p/
// log2/log10/pow/cbrt/hypot, no Math.random (runs are replayed: draw from a
// seeded stream), and no `**` except `2 ** n` and `x ** 2` (exact everywhere).
// And no clock -- performance.now, Date.now, new Date: a result that depends on
// how long something took (WFC once stopped on a 250 ms budget) is a different
// result on a slower or busier machine. Budgets are counted in steps.
//
// A new file under a SIM directory is covered the moment it exists. A file that
// really is presentation goes in PRESENTATION with the reason; anything else
// that fails here wants the d-function (dsin, dcos, datan2, dhypot, dlen, dpow...).
// A file that only TIMES itself or paces work by the clock goes in CLOCK, with
// the reason: never for a clock that decides what is made.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

/** Simulation and generation: every .ts under these (recursively). */
const SIM = [
  "packages/physics/src", // the character body, solids
  "packages/world/src", // the world step: entities, bodies, streams, rules
  "packages/entity/src", // rigs, bodies, clips, the animator (state from a body), fronts, species
  "packages/level/src", // generation, scatter, roads, fairness, ops
  "packages/object/src", // designs, styles, the catalogue (what shape a thing is), colliders
  "packages/scene/src", // the kit, front detection, bounds
  "packages/builder/src", // generated voxel things, rigs, conversions
  "packages/codec/src", // the canonical bytes: fixed-point and decimal numbers
  "packages/terrain/src", // flow fields, paths, colliders, the palette, the view axes the ground and sprites share
  "packages/worldgen/src", // noise and climate, overworlds, WFC, dungeons and their dressing, structures, the pipeline
  "packages/bake/src", // what a bake is keyed and sized by, populations, atlases, the pixel view, depth and picking
  "packs", // every pack's generators (src/ only: see below)
  "ai", // brains and steering
  "systems",
];
/** Single files that are simulation or generation in an otherwise mixed package. */
const SIM_FILES = [
  "packages/core/src/frame.ts", // the frame convention: yaws, local <-> world
  "packages/core/src/rng.ts", // seeded streams
  "packages/core/src/look.ts", // looks: which look a unit wears (pools decide by distance)
  "packages/core/src/dmath.ts",
  "packages/audio/src/score.ts", // a music plan is data
  "packages/audio/src/nocturnes.ts",
  "packages/audio/src/store.ts",
];
/** In a SIM directory, but allowed Math -- with the reason. */
const PRESENTATION: Record<string, string> = {
  "packages/object/src/sway.ts": "wind: a sprite's per-frame bend, drawn and never stored",
  // (Generation, really: rotations and placement. But NOCTURNES builds its still lifes with this kit
  // (src/kit.js, src/parts.js) and its published output must not move -- dmath here moved genome #13 in
  // the guard. The kit's rotations stay on Math until the owner re-captures NOCTURNES or it keeps a copy.)
  "packages/scene/src/kit.ts": "NOCTURNES renders with it: guard-pinned published art",
  // (Baked PIXELS are presentation: a bake is a local cache keyed by its design, and the GPU bakes the same
  // sprites with the driver's own sin and cos anyway. What decides a bake's key, size, atlas place, depth or a
  // pick is dmath -- plan, shapes, entity-design, stages, atlas, view, depth, raycast, grid stay in SIM.
  // docs/CONVENTIONS.md, "Baked pixels".)
  "packages/bake/src/bake.ts": "the raster: the bake camera's lens and turn (its pixels a local cache), and the bake's timings",
  "packages/bake/src/soft.ts": "the software raster: a ray per pixel, the normals' shades",
  "packages/bake/src/portrait.ts": "a portrait's pixels and animation (blinks, talk, signal noise, pulsing lights), and its timings",
  "packages/bake/src/sprites.ts": "WebGL: the sprite renderer's uniforms (the lens, the wind)",
  "packages/bake/src/sway.ts": "wind in the sprite shader: a per-frame bend, drawn and never stored",
  "packages/terrain/src/ground.ts": "the ground's raster: per-texel relief, sun and normals, a bake sliced by the clock over frames (its view axes and footprints are dmath, as bake's pixelView)",
  "packages/terrain/src/ground-bake.ts": "streams the ground's baked layers: which chunk next, a frame's slice, the nearest baked scale",
  "packages/terrain/src/ground-gl.ts": "WebGL: the ground layers' draw",
  "packages/terrain/src/ground-gpu.ts": "WebGL: the GPU ground's camera, lights, culling and uploads inside a frame's budget",
  "packages/terrain/src/ground-gpu-data.ts": "the GPU ground's textures: normals and extras' turns for the shader",
  "packages/worldgen/src/dungeon-gl.ts": "WebGL: the dungeon renderer's camera, hero light, cutaway and fog",
};
/** In SIM, allowed the clock -- it only times or paces the work, never decides what is made. */
const CLOCK: Record<string, string> = {
  "packages/level/src/generate.ts": "report.ms: the steps' laps, returned beside the level, never read by generation",
  "packages/terrain/src/hpa.ts": "stats.ms: how long the graph took to build, reported only",
  "packages/worldgen/src/world-baker.ts": "paces bakes to a frame's slice and reports genMs; a chunk's tiles are the same whenever it is made (chunk independence)",
  "packages/bake/src/indexed.ts": "the bake's timings (ms, trimMs), reported only",
  "packages/bake/src/population.ts": "ms: timings reported with the population, never read by it",
  "packages/bake/src/worker.ts": "worker scheduling, timeouts and timings; a job bakes the same whenever it runs",
};
// (Everything else is presentation or tooling and may use Math and the clock: camera, view,
// render, particles, ui, input, capture, import, keel, runtime; audio's
// synthesis; and core's math, palette, dither, sdf, quantize and gif, which
// NOCTURNES renders with and whose published bytes must not move.)

const CLOCK_CALLS = /\b(performance\.now|Date\.now|new Date)\b/g;
const FORBIDDEN = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|random)\b/g;

function tsFiles(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === "dist" || name === "test" || name === "tools" || name === "keel") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(relative(root, p));
    }
  };
  walk(abs);
  // (packs/ai/systems: only their src/ -- tools and tests are neither.)
  return out.filter((f) => !/^(packs|ai|systems)\//.test(f) || /^(packs|ai|systems)\/[^/]+\/src\//.test(f));
}

/** Code only: comments and string contents blanked (template literals' ${...} kept; newlines kept, so lines stay true). */
function codeOf(src: string): string {
  const nl = (from: number, to: number): string => "\n".repeat(src.slice(from, to).split("\n").length - 1);
  let out = "";
  let i = 0;
  const depth: number[] = []; // template nesting: brace depth at each ${
  let braces = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e + 2; out += " " + nl(i, end); i = end; continue; }
    if (c === "\"" || c === "'") {
      i += 1;
      while (i < src.length && src[i] !== c) { if (src[i] === "\\") i += 1; i += 1; }
      i += 1;
      out += "\"\"";
      continue;
    }
    if (c === "`" || (c === "}" && depth.length && depth[depth.length - 1] === braces)) {
      if (c === "}") depth.pop();
      const from = i;
      i += 1;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") { depth.push(braces); i += 2; break; }
        i += 1;
      }
      if (src[i] === "`") i += 1;
      out += " " + nl(from, i);
      continue;
    }
    if (c === "{") braces += 1;
    if (c === "}") braces -= 1;
    out += c;
    i += 1;
  }
  return out;
}

/** The forbidden uses in a file's code: `line: text`. */
function offences(file: string): string[] {
  const src = readFileSync(join(root, file), "utf8");
  const code = codeOf(src);
  const lineOf = (at: number): number => code.slice(0, at).split("\n").length;
  const found: string[] = [];
  for (const m of code.matchAll(FORBIDDEN)) found.push(`${lineOf(m.index)}: Math.${m[1]}`);
  if (!(file in CLOCK)) for (const m of code.matchAll(CLOCK_CALLS)) found.push(`${lineOf(m.index)}: ${m[1]} (the clock)`);
  for (const m of code.matchAll(/\*\*(?!=)/g)) {
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    const after = code.slice(m.index + 2, m.index + 14);
    const base2 = /(^|[^\w.])2\s*$/.test(before);
    const square = /^\s*2(?![\w.])/.test(after);
    if (!base2 && !square) found.push(`${lineOf(m.index)}: ** (pow)`);
  }
  return found;
}

const sim = [...new Set([...SIM.flatMap(tsFiles), ...SIM_FILES])].filter((f) => !(f in PRESENTATION)).sort();

test("sim-math: the rule's own scanner sees what it must and nothing in comments or strings", () => {
  assert.deepEqual(offences("packages/core/test/sim-math.test.ts").length > 0, true); // (this file names them all, in code, below)
  const probe = codeOf("a = Math.sin(t) // Math.cos(t)\n/* Math.exp(1) */ s = \"Math.log(2)\"; u = `x ${Math.hypot(1, 2)} y`; v = x ** 2 + 2 ** k + y ** 3;");
  assert.ok(probe.includes("Math.sin(t)") && probe.includes("Math.hypot(1, 2)") && probe.includes("y ** 3"));
  assert.ok(!probe.includes("Math.cos") && !probe.includes("Math.exp") && !probe.includes("Math.log"));
  void [Math.sin, Math.cos, Math.tan, Math.atan2, Math.hypot, Math.exp, Math.log, Math.pow];
  // The clock, in code only; and lines stay true past multi-line templates and comments (a GLSL source, a doc block).
  const clock = codeOf("t = performance.now(); s = \"Date.now()\"; d = new Date(); e = Date.now();");
  assert.deepEqual([...clock.matchAll(CLOCK_CALLS)].map((m) => m[1]), ["performance.now", "new Date", "Date.now"]);
  assert.equal(codeOf("`a\n${1}\nb`\n/* c\nd */\nMath.sin(1)").split("\n").length, 6);
});

test("sim-math: simulation and generation files call no platform-dependent Math", () => {
  assert.ok(sim.length > 150, `${sim.length} files in scope`);
  const bad: string[] = [];
  for (const f of sim) for (const o of offences(f)) bad.push(`${f}:${o}`);
  assert.deepEqual(bad, [], `platform-dependent math on a sim/generation path (use core's dmath):\n  ${bad.join("\n  ")}`);
});

test("sim-math: every exemption names a file that exists and still needs it", () => {
  for (const [f, why] of [...Object.entries(PRESENTATION), ...Object.entries(CLOCK)]) {
    assert.ok(existsSync(join(root, f)), `${f} is listed but gone`);
    assert.ok(why.length > 20, `${f}: say why`);
  }
  // (A file converted since it was listed must leave the list, or it hides the next mistake.)
  const all = (f: string): string[] => { const saved = CLOCK[f]; delete CLOCK[f]; try { return offences(f); } finally { if (saved !== undefined) CLOCK[f] = saved; } };
  for (const f of Object.keys(PRESENTATION)) assert.ok(all(f).length > 0, `${f} is in PRESENTATION but calls nothing it would need it for`);
  for (const f of Object.keys(CLOCK)) assert.ok(all(f).some((o) => o.endsWith("(the clock)")), `${f} is in CLOCK but reads no clock`);
});
