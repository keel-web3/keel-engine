// The scene core against Three.js r180, to the bit. fixtures/core.json holds
// r180's outputs on seeded inputs (made outside this repo by
// make-core-fixtures.mjs: Three is never a dependency here); core-cases.ts
// says how each case builds its objects and reads them back, and runs the
// same on r180 and on ours.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// (the fixture was recorded with Math's transcendental functions swapped for
// core's dmath, so it holds on every CPU: swap them here too, before any case runs.
// A test-only reach into core's source: lit's runtime never imports it.)
import { DMATH } from "../../core/src/dmath.ts";
import * as lit from "../src/index.ts";
import { cases, compact } from "./core-cases.ts";
import type { Lib } from "./core-cases.ts";
import { decode, encode } from "./math-cases.ts";

interface Fixture {
  three: string;
  perCase: number;
  portableMath: readonly (keyof typeof DMATH)[];
  constants: Record<string, Record<string, number | string>>;
  cases: Record<string, [unknown, unknown][]>;
}

const fixture = decode(readFileSync(new URL("./fixtures/core.json", import.meta.url), "utf8")) as Fixture;

const math = Math as unknown as Record<string, unknown>;
for (const k of fixture.portableMath) math[k] = DMATH[k];

const tables = { ...lit.R180, colorSpace: lit.COLOR_SPACE } as unknown as Record<string, Record<string, number | string>>;

const lib = {
  ...lit,
  k: (_table: string, value: string) => value,
  n(table: string, value: unknown) {
    const t = tables[table];
    const v = t === undefined ? undefined : t[value as string];
    return v === undefined ? `<unmapped ${table} ${String(value)}>` : v;
  },
} as unknown as Lib;

/** Where two outputs first differ (Object.is on every number: -0 is not 0, NaN is NaN), or null. */
function diff(a: unknown, b: unknown, path = ""): string | null {
  if (typeof a === "number" && typeof b === "number") {
    return Object.is(a, b) ? null : `${path}: ${a} !== ${b} (r180)`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} !== ${b.length} (r180)`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join() !== kb.join()) return `${path}: keys ${ka.join()} !== ${kb.join()} (r180)`;
    for (const k of ka) {
      const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${path}: ${String(a)} !== ${String(b)} (r180)`;
}

test("the fixture is r180's and covers every case", () => {
  assert.equal(fixture.three, "180");
  assert.deepEqual(Object.keys(fixture.cases).sort(), Object.keys(cases).sort());
});

test("every constant table maps to r180's numbers", () => {
  for (const [table, values] of Object.entries(fixture.constants)) {
    assert.deepEqual(tables[table], values, table);
  }
  assert.deepEqual(Object.keys(fixture.constants).sort(), Object.keys(tables).sort());
});

for (const [name, rows] of Object.entries(fixture.cases)) {
  test(`${name} matches r180 bit for bit (${rows.length} cases)`, () => {
    const c = cases[name];
    assert.ok(c, `no case ${name}`);
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (let i = 0; i < rows.length; i++) {
        const [input, expected] = rows[i]!;
        // (compacted and through the fixture's encoding, as r180's output went)
        const got = decode(encode(compact(c.run(lib, structuredClone(input)))));
        const d = diff(got, expected);
        if (d) assert.fail(`${name} #${i}${d}\n  input: ${JSON.stringify(input)}`);
      }
    } finally {
      console.warn = warn;
    }
  });
}

test("the is* flags: r180's, and KEEL's beside them", () => {
  const flags = (o: object) => Object.keys(o).filter((k) => k.startsWith("is"));
  assert.deepEqual(flags(new lit.Node()), ["isObject3D", "isNode"]);
  assert.deepEqual(flags(new lit.Stage()), ["isObject3D", "isNode", "isScene", "isStage"]);
  assert.deepEqual(flags(new lit.Instances(undefined, undefined, 1)), ["isObject3D", "isNode", "isMesh", "isInstancedMesh", "isInstances"]);
  assert.deepEqual(flags(new lit.Billboard()), ["isObject3D", "isNode", "isSprite", "isBillboard"]);
  assert.deepEqual(flags(new lit.SunLight()), ["isObject3D", "isNode", "isLight", "isDirectionalLight", "isSunLight"]);
  assert.deepEqual(flags(new lit.SkyLight()), ["isObject3D", "isNode", "isLight", "isHemisphereLight", "isSkyLight"]);
  assert.deepEqual(flags(new lit.OrthoCamera()), ["isObject3D", "isNode", "isCamera", "isOrthographicCamera", "isOrthoCamera"]);
  assert.deepEqual(flags(new lit.PerspectiveCamera()), ["isObject3D", "isNode", "isCamera", "isPerspectiveCamera"]);
  assert.deepEqual(flags(new lit.Geometry()), ["isBufferGeometry", "isGeometry"]);
  assert.deepEqual(flags(new lit.InstanceAttribute(new Float32Array(3), 3)), ["isBufferAttribute", "isAttribute", "isInstancedBufferAttribute", "isInstanceAttribute"]);
  assert.deepEqual(flags(new lit.LitMaterial()), ["isMaterial", "isMeshStandardMaterial", "isLitMaterial"]);
  assert.deepEqual(flags(new lit.CustomMaterial()), ["isMaterial", "isShaderMaterial", "isCustomMaterial"]);
  assert.deepEqual(flags(new lit.SunLight().shadow), ["isDirectionalLightShadow", "isSunShadow"]);
  assert.equal(new lit.RenderTarget().isWebGLRenderTarget, true);
});

test("type strings are KEEL's names", () => {
  const types = [
    new lit.Node(), new lit.Group(), new lit.Stage(), new lit.Mesh(), new lit.Instances(undefined, undefined, 0), new lit.Billboard(),
    new lit.Camera(), new lit.PerspectiveCamera(), new lit.OrthoCamera(), new lit.AmbientLight(), new lit.SunLight(), new lit.SkyLight(),
    new lit.Geometry(), new lit.Material(), new lit.LitMaterial(), new lit.ToonMaterial(), new lit.FlatMaterial(), new lit.BillboardMaterial(),
    new lit.CustomMaterial(), new lit.DepthMaterial(), new lit.DistanceMaterial(),
  ].map((o) => o.type);
  assert.deepEqual(types, [
    "Node", "Group", "Stage", "Mesh", "Instances", "Billboard", "Camera", "PerspectiveCamera", "OrthoCamera", "AmbientLight", "SunLight", "SkyLight",
    "Geometry", "Material", "LitMaterial", "ToonMaterial", "FlatMaterial", "BillboardMaterial", "CustomMaterial", "DepthMaterial", "DistanceMaterial",
  ]);
});

test("transform fields are r180's: own, enumerable, not writable", () => {
  const node = new lit.Node();
  for (const key of ["position", "rotation", "quaternion", "scale"]) {
    const d = Object.getOwnPropertyDescriptor(node, key)!;
    assert.equal(d.enumerable, true);
    assert.equal(d.writable, false);
  }
  assert.equal(Object.keys(node).includes("modelViewMatrix"), false);
  assert.equal(Object.keys(node).includes("id"), false);
  assert.throws(() => {
    (node as unknown as Record<string, unknown>)["position"] = new lit.Vector3();
  });
  // (rotation and quaternion stay in step)
  node.rotation.set(0.3, -1.2, 2.0, "YXZ");
  const q = new lit.Quaternion().setFromEuler(node.rotation);
  assert.deepEqual([...q], [...node.quaternion]);
});

test("the emitter copies its listeners before calling them, and clears target", () => {
  const e = new lit.Emitter();
  const seen: unknown[] = [];
  const a = (ev: lit.EmitterEvent) => {
    seen.push(["a", ev.target === e]);
    e.removeEventListener("x", b);
  };
  const b = () => seen.push(["b"]);
  e.addEventListener("x", a);
  e.addEventListener("x", a);
  e.addEventListener("x", b);
  const ev: lit.EmitterEvent = { type: "x" };
  e.dispatchEvent(ev);
  e.dispatchEvent(ev);
  assert.deepEqual(seen, [["a", true], ["b"], ["a", true]]);
  assert.equal(ev.target, null);
  assert.equal(e.hasEventListener("x", a), true);
  assert.equal(e.hasEventListener("x", b), false);
});

test("the renderer hooks are there to replace", () => {
  const mesh = new lit.Mesh();
  let called = 0;
  mesh.onBeforeRender = () => void called++;
  mesh.onBeforeRender(null, new lit.Stage(), new lit.Camera(), mesh.geometry, new lit.LitMaterial(), null);
  assert.equal(called, 1);
  const m = new lit.LitMaterial();
  const key = m.customProgramCacheKey();
  m.onCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("a", "b");
  };
  assert.notEqual(m.customProgramCacheKey(), key);
});
