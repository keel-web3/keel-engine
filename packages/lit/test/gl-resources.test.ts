// The GL resource layer against Three.js r180, call for call.
// fixtures/gl-resources.json holds the WebGL2 call logs r180's own WebGLState,
// Attributes, BindingStates, Geometries, Objects, buffer renderers, Info,
// Extensions, Capabilities, Utils, Properties and Animation leave on a
// recording stand-in (gl-stand-in.ts), driven by gl-resources-cases.ts (made
// outside this repo by make-gl-resources-fixtures.mjs: Three is never a
// dependency here). Ours, driven the same way, must leave the same logs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as lit from "../src/index.ts";
import { createAnimation } from "../src/gl/animation.ts";
import { createAttributes } from "../src/gl/attributes.ts";
import { createBindingStates } from "../src/gl/binding-states.ts";
import { createBufferRenderer } from "../src/gl/buffer-renderer.ts";
import { createCapabilities } from "../src/gl/capabilities.ts";
import { createExtensions } from "../src/gl/extensions.ts";
import { createGeometries } from "../src/gl/geometries.ts";
import { createIndexedBufferRenderer } from "../src/gl/indexed-buffer-renderer.ts";
import { createInfo } from "../src/gl/info.ts";
import { createObjects } from "../src/gl/objects.ts";
import { createProperties } from "../src/gl/properties.ts";
import { createState } from "../src/gl/state.ts";
import { createUtils } from "../src/gl/utils.ts";
import { cases, runCase } from "./gl-resources-cases.ts";
import type { GLLib } from "./gl-resources-cases.ts";
import { standIn } from "./gl-stand-in.ts";
import type { Call } from "./gl-stand-in.ts";
import { decode, encode, rng } from "./math-cases.ts";

interface Fixture {
  three: string;
  cases: Record<string, Call[]>;
}

const fixture = decode(readFileSync(new URL("./fixtures/gl-resources.json", import.meta.url), "utf8")) as Fixture;

const lib: GLLib = {
  createExtensions, createCapabilities, createUtils, createInfo, createProperties, createState, createAttributes,
  createBindingStates, createGeometries, createObjects, createBufferRenderer, createIndexedBufferRenderer, createAnimation,
  Geometry: lit.Geometry, Attribute: lit.Attribute, InstanceAttribute: lit.InstanceAttribute, Mesh: lit.Mesh, Instances: lit.Instances,
  FlatMaterial: lit.FlatMaterial, LitMaterial: lit.LitMaterial, CustomMaterial: lit.CustomMaterial,
  Color: lit.Color, Vector4: lit.Vector4, Matrix4: lit.Matrix4, Vector3: lit.Vector3, Quaternion: lit.Quaternion,
  k: (_table: string, value: string) => value,
};

/** A call as one line, for the failure message. */
const line = (c: Call | undefined): string => (c === undefined ? "(nothing)" : encode(c));

test(`the fixture is r180's`, () => {
  assert.equal(fixture.three, "180");
  assert.deepEqual(Object.keys(fixture.cases).sort(), Object.keys(cases).sort(), "the fixture's scripts are gl-resources-cases.ts's (regenerate it)");
});

for (const [name, c] of Object.entries(cases)) {
  test(`${name}: the same GL calls as r180`, () => {
    const want = fixture.cases[name];
    assert.ok(want !== undefined, `no fixture for ${name}`);
    const got = runCase(name, c, lib, standIn, rng);
    // (the first difference, with the calls just before it, reads better than a whole-log diff)
    const n = Math.max(got.length, want.length);
    for (let i = 0; i < n; i++) {
      const a = encode(decode(encode(got[i])) ?? null), b = encode(want[i] ?? null);
      if (a !== b) {
        const before = got.slice(Math.max(0, i - 4), i).map(line).join("\n  ");
        assert.fail(`${name}: call ${i} differs\n  ...\n  ${before}\n  ours: ${line(got[i])}\n  r180: ${line(want[i])}`);
      }
    }
    assert.equal(got.length, want.length);
  });
}
