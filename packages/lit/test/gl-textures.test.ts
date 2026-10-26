// The textures and shadow-map layer against Three.js r180, call for call.
// fixtures/gl-textures.json holds r180's logs on the scripts in
// gl-textures-cases.ts (made outside this repo by make-gl-textures-fixtures.mjs:
// Three is never a dependency here): the GL calls on the stand-in, and the
// calls into WebGLState, the renderer and WebGLObjects. Ours, on the same
// scripts, must leave the same logs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { installFakeDom, shadowCases, textureCases } from "./gl-textures-cases.ts";
import type { Lib } from "./gl-textures-cases.ts";

// (before the textures module is made: it tests for these by typeof)
installFakeDom();

import * as lit from "../src/index.ts";
import { createExtensions } from "../src/gl/extensions.ts";
import { createUtils } from "../src/gl/utils.ts";
import { createCapabilities } from "../src/gl/capabilities.ts";
import { createProperties } from "../src/gl/properties.ts";
import { createInfo } from "../src/gl/info.ts";
import { createTextures } from "../src/gl/textures.ts";
import { createShadowMap } from "../src/gl/shadow-map.ts";
import { createCubeMaps } from "../src/gl/cube-maps.ts";
import { createCubeUVMaps } from "../src/gl/cube-uv-maps.ts";

interface Fixture {
  three: string;
  textures: Record<string, unknown[]>;
  shadows: Record<string, unknown[]>;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/gl-textures.json", import.meta.url), "utf8")) as Fixture;

const tables = { ...lit.R180, colorSpace: lit.COLOR_SPACE } as unknown as Record<string, Record<string, number | string>>;

const lib = {
  ...lit,
  k: (_table: string, value: string) => value,
  n(table: string, value: unknown) {
    const t = tables[table];
    const v = t === undefined ? undefined : t[value as string];
    return v === undefined ? `<unmapped ${table} ${String(value)}>` : v;
  },
  createExtensions, createUtils, createCapabilities, createProperties, createInfo, createTextures, createShadowMap,
} as unknown as Lib;

/** The first call that differs, with a little context, or null. */
function firstDifference(got: unknown[], want: unknown[]): string | null {
  const n = Math.max(got.length, want.length);
  for (let i = 0; i < n; i++) {
    const a = JSON.stringify(got[i]), b = JSON.stringify(want[i]);
    if (a !== b) {
      const around = (list: unknown[]) => list.slice(Math.max(0, i - 3), i + 2).map((c, j) => `    ${i - Math.min(i, 3) + j}: ${JSON.stringify(c)?.slice(0, 300)}`).join("\n");
      return `call ${i} differs (ours ${got.length} calls, r180 ${want.length})\n  ours:\n${around(got)}\n  r180:\n${around(want)}`;
    }
  }
  return null;
}

function quietly<T>(f: () => T): T {
  const warn = console.warn, error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    return f();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

test("the fixture is r180's and covers every script", () => {
  assert.equal(fixture.three, "180");
  assert.deepEqual(Object.keys(fixture.textures).sort(), Object.keys(textureCases).sort());
  assert.deepEqual(Object.keys(fixture.shadows).sort(), Object.keys(shadowCases).sort());
});

for (const [kind, cases] of [["textures", textureCases], ["shadows", shadowCases]] as const) {
  for (const [name, run] of Object.entries(cases)) {
    test(`${kind}: ${name} makes r180's calls`, () => {
      const want = fixture[kind][name];
      assert.ok(want, `no fixture for ${name}`);
      const got = JSON.parse(JSON.stringify(quietly(() => run(lib)))) as unknown[];
      const d = firstDifference(got, want);
      if (d) assert.fail(d);
    });
  }
}

test("cube maps and cube-UV maps pass textures through, and refuse environment maps", () => {
  const cubemaps = createCubeMaps(null);
  const cubeuvmaps = createCubeUVMaps(null);
  const t = new lit.Texture();
  assert.equal(cubemaps.get(t), t);
  assert.equal(cubeuvmaps.get(t), t);
  assert.equal(cubemaps.get(null), null);
  assert.equal(cubeuvmaps.get(undefined), undefined);
  t.mapping = "equirect-reflection";
  assert.throws(() => cubemaps.get(t));
  assert.throws(() => cubeuvmaps.get(t));
  t.mapping = "cube-reflection";
  assert.equal(cubemaps.get(t), t);
  assert.throws(() => cubeuvmaps.get(t));
  cubemaps.dispose();
  cubeuvmaps.dispose();
});
