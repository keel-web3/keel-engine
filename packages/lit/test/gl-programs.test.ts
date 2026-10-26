// keel/lit's program layer (src/gl: programs, program, shader-cache,
// uniforms, materials, lights, render-lists, render-states, clipping,
// background) against Three.js r180's, string- and call-exact.
// fixtures/gl-programs.json holds what r180's own WebGLRenderer did with
// gl-programs-cases.ts's stages on the recording WebGL2 stand-in (made outside
// this repo by make-gl-programs-fixtures.mjs: Three is never a dependency
// here): per program its cache key and the sha256 of the exact source
// gl.shaderSource got; per onCompile call the program parameters; and the
// uniform upload sequence of two frames, shadow pass included. Here the same
// stages are drawn by gl-programs-driver.ts (r180's frame, wired to keel/lit's
// modules) and must match.
//
// Where keel/lit's values are its own names for r180's (shaderID "lit" for
// "physical", tone mapping and shadow types as strings, the default custom
// cache key's text), they are mapped to r180's before comparing; nothing else
// is.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// (the fixture was recorded with Math's transcendental functions swapped for
// core's dmath, so it holds on every CPU: swap them here too, before any case runs.
// A test-only reach into core's source: lit's runtime never imports it.)
import { DMATH } from "../../core/src/dmath.ts";
import * as lit from "../src/index.ts";
import { captureValue, runScene, scenes } from "./gl-programs-cases.ts";
import type { Lib, SceneRecord } from "./gl-programs-cases.ts";
import { createDriver } from "./gl-programs-driver.ts";
import { R180_MATERIAL_TYPE } from "../src/gl/programs.ts";
import { standIn } from "./gl-stand-in.ts";
import { decode, encode } from "./math-cases.ts";

interface Fixture {
  three: string;
  portableMath: readonly (keyof typeof DMATH)[];
  defaultCustomKey: string;
  scenes: Record<string, SceneRecord>;
}

const fixture = decode(readFileSync(new URL("./fixtures/gl-programs.json", import.meta.url), "utf8")) as Fixture;

const math = Math as unknown as Record<string, unknown>;
for (const k of fixture.portableMath) math[k] = DMATH[k];

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const lib = {
  ...lit,
  k: (_table: string, value: string) => value,
  patch(material: { onCompile: unknown; customProgramCacheKey: () => string }, fn: (shader: unknown, renderer: unknown) => void) {
    material.onCompile = fn;
    material.customProgramCacheKey = () => fn.toString();
  },
} as unknown as Lib;

// (keel/lit's names for r180's values, by parameter)
const SHADER_ID: Record<string, string> = { lit: "physical", flat: "basic", billboard: "sprite", distance: "distanceRGBA", toon: "toon", depth: "depth" };
const KEEL_DEFAULT_KEY = new lit.Material().customProgramCacheKey();
const TABLES: Record<string, Record<string, unknown>> = {
  shaderID: SHADER_ID,
  toneMapping: lit.R180.toneMapping,
  shadowMapType: lit.R180.shadowMapType,
  combine: lit.R180.combine,
  envMapMode: lit.R180.mapping,
  outputColorSpace: lit.COLOR_SPACE,
};

function toR180(key: string, value: unknown): unknown {
  if (key === "customProgramCacheKey" && value === captureValue(KEEL_DEFAULT_KEY, sha)) return captureValue(fixture.defaultCustomKey, sha);
  const table = TABLES[key];
  if (table !== undefined && typeof value === "string" && value in table) return table[value];
  return value;
}

// (a cache key: r180's leading shaderID and trailing custom key)
function keyToR180(key: string): string {
  let k = key;
  if (k.endsWith(KEEL_DEFAULT_KEY)) k = k.slice(0, k.length - KEEL_DEFAULT_KEY.length) + fixture.defaultCustomKey;
  const first = k.split(",", 1)[0]!;
  if (first in SHADER_ID) k = SHADER_ID[first] + k.slice(first.length);
  return k;
}

// (r180's physical library has the physical extras' uniforms too: LitMaterial is r180's MeshStandardMaterial,
// whose program uses none of them, so the lit library leaves them out)
function uniformKeysMatch(keel: string[], r180: string[]): boolean {
  let j = 0;
  for (const k of keel) {
    while (j < r180.length && r180[j] !== k) j++;
    if (j === r180.length) return false;
    j++;
  }
  return true;
}

const keelRuns: Record<string, ReturnType<typeof runScene>> = {};
const makeRenderer = (canvas: unknown, capture: (material: unknown, parameters: unknown) => void) => createDriver(canvas, { capture });

// (every stage drawn once, in the fixture's order: shader cache ids and material ids count up across them, as in r180)
for (const name of Object.keys(fixture.scenes)) {
  keelRuns[name] = runScene(name, lib, makeRenderer, standIn, sha, encode);
}

test("the fixture's stages are the cases'", () => {
  assert.deepEqual(Object.keys(fixture.scenes), Object.keys(scenes));
});

for (const name of Object.keys(fixture.scenes)) {
  const want = fixture.scenes[name]!;

  test(`${name}: program parameters`, () => {
    const got = keelRuns[name]!.record;
    assert.deepEqual(got.keys, want.keys, "parameter keys");
    assert.equal(got.captures.length, want.captures.length, "onCompile calls");
    for (let i = 0; i < want.captures.length; i++) {
      const g = got.captures[i]!, w = want.captures[i]!;
      const role = String(w[0]);
      assert.equal(R180_MATERIAL_TYPE[g[0] as string] ?? g[0], w[0], `capture ${i}: role`);
      assert.equal(g[1], w[1], `${role}: created program`);
      const isLit = g[2 + want.keys.indexOf("shaderID")] === "lit";
      want.keys.forEach((key, j) => {
        const gv = toR180(key, g[2 + j]), wv = w[2 + j];
        if (key === "uniforms" && isLit) {
          assert.ok(uniformKeysMatch(gv as string[], wv as string[]), `${role}: lit uniforms ${String(gv)} not within r180's ${String(wv)}`);
          return;
        }
        assert.deepEqual(gv, wv, `${role}: parameter ${key}`);
      });
    }
  });

  test(`${name}: programs (cache keys, final GLSL)`, () => {
    const got = keelRuns[name]!.record;
    assert.equal(got.programs.length, want.programs.length, "programs");
    for (let i = 0; i < want.programs.length; i++) {
      const [gk, gv, gf] = got.programs[i]!, [wk, wv, wf] = want.programs[i]!;
      assert.equal(keyToR180(gk), wk, `program ${i}: cache key`);
      assert.equal(gv, wv, `program ${i} (${wk.slice(0, 40)}...): vertex source`);
      assert.equal(gf, wf, `program ${i} (${wk.slice(0, 40)}...): fragment source`);
    }
  });

  test(`${name}: uniform uploads`, () => {
    const run = keelRuns[name]!;
    const got = run.record.uniforms;
    const n = Math.min(got.length, want.uniforms.length);
    for (let i = 0; i < n; i++) {
      if (encode(got[i]) !== encode(want.uniforms[i])) {
        const around = run.uniformCalls.slice(Math.max(0, i - 3), i + 2).map((c) => encode(c).slice(0, 200));
        assert.fail(`call ${i}: ${encode(got[i]).slice(0, 300)} !== ${encode(want.uniforms[i]).slice(0, 300)} (r180)\n  keel/lit around it:\n    ${around.join("\n    ")}`);
      }
    }
    assert.equal(got.length, want.uniforms.length, "uniform calls");
  });
}
