// The maths against Three.js r180, to the bit. fixtures/math.json holds r180's
// outputs on seeded inputs (made outside this repo by make-math-fixtures.mjs:
// Three is never a dependency here); math-cases.ts says how each case builds
// its objects and reads them back, and runs the same on r180 and on ours.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// (the fixture was recorded with Math's transcendental functions swapped for
// core's dmath, so it holds on every CPU: swap them here too, before any case runs.
// A test-only reach into core's source: lit's runtime never imports it.)
import { DMATH } from "../../core/src/dmath.ts";
import * as lit from "../src/math/index.ts";
import { cases, decode, encode } from "./math-cases.ts";
import type { Lib } from "./math-cases.ts";

interface Fixture {
  three: string;
  perCase: number;
  portableMath: readonly (keyof typeof DMATH)[];
  cases: Record<string, [unknown, unknown][]>;
}

const fixture = decode(readFileSync(new URL("./fixtures/math.json", import.meta.url), "utf8")) as Fixture;

const math = Math as unknown as Record<string, unknown>;
for (const k of fixture.portableMath) math[k] = DMATH[k];

const lib: Lib = { ...lit, LINEAR: "linear", WEBGL: "webgl", WEBGPU: "webgpu" };

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

for (const [name, rows] of Object.entries(fixture.cases)) {
  test(`${name} matches r180 bit for bit (${rows.length} cases)`, () => {
    const c = cases[name];
    assert.ok(c, `no case ${name}`);
    for (let i = 0; i < rows.length; i++) {
      const [input, expected] = rows[i]!;
      // (through the fixture's encoding, as r180's output went: array holes become nulls)
      const got = decode(encode(c.run(lib, structuredClone(input))));
      const d = diff(got, expected);
      if (d) assert.fail(`${name} #${i}${d}\n  input: ${JSON.stringify(input)}`);
    }
  });
}

test("the is* flags sit where r180 puts them", () => {
  // (the vectors' and matrices' on the prototype, the rest own properties)
  for (const [C, flag] of [[lit.Vector2, "isVector2"], [lit.Vector3, "isVector3"], [lit.Vector4, "isVector4"], [lit.Matrix3, "isMatrix3"], [lit.Matrix4, "isMatrix4"]] as const) {
    const v = new C();
    assert.equal((v as unknown as Record<string, unknown>)[flag], true);
    assert.equal(Object.hasOwn(v, flag), false, `${flag} is on the prototype`);
  }
  for (const [v, flag] of [[new lit.Quaternion(), "isQuaternion"], [new lit.Euler(), "isEuler"], [new lit.Color(), "isColor"], [new lit.Box3(), "isBox3"], [new lit.Sphere(), "isSphere"], [new lit.Plane(), "isPlane"]] as const) {
    assert.equal((v as unknown as Record<string, unknown>)[flag], true);
    assert.equal(Object.hasOwn(v, flag), true, `${flag} is an own property`);
  }
  assert.deepEqual(Object.keys(new lit.Vector3()), ["x", "y", "z"]);
  assert.deepEqual(Object.keys(new lit.Quaternion()), ["isQuaternion", "_x", "_y", "_z", "_w"]);
  assert.deepEqual(Object.keys(new lit.Euler()), ["isEuler", "_x", "_y", "_z", "_order"]);
  assert.deepEqual(Object.keys(new lit.Color()), ["isColor", "r", "g", "b"]);
});

test("defaults are r180's", () => {
  assert.deepEqual([...new lit.Vector4()], [0, 0, 0, 1]);
  assert.deepEqual([...new lit.Quaternion()], [0, 0, 0, 1]);
  assert.deepEqual([...new lit.Euler()], [0, 0, 0, "XYZ"]);
  assert.deepEqual([...new lit.Color()], [1, 1, 1]);
  assert.deepEqual(new lit.Matrix4().elements, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual(new lit.Matrix3().elements, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const b = new lit.Box3();
  assert.ok(b.isEmpty() && b.min.x === Infinity && b.max.z === -Infinity);
  assert.equal(new lit.Sphere().radius, -1);
  assert.deepEqual([...new lit.Plane().normal, new lit.Plane().constant], [1, 0, 0, 0]);
  assert.deepEqual([...new lit.Ray().direction], [0, 0, -1]);
  assert.equal(lit.colorManagement.workingColorSpace, "linear");
  assert.equal(lit.Euler.DEFAULT_ORDER, "XYZ");
  assert.equal(lit.Color.NAMES["rebeccapurple"], 0x663399);
  // (r180's makePerspective defaults to WebGL's clip space: depth -1 to 1)
  const p = new lit.Matrix4().makePerspective(-1, 1, 1, -1, 1, 3);
  assert.deepEqual([p.elements[10], p.elements[14]], [-2, -3]);
});

test("change callbacks fire as r180's do", () => {
  let n = 0;
  const q = new lit.Quaternion()._onChange(() => n++);
  q.x = 1; q.set(0, 0, 0, 1); q.normalize(); q.setFromEuler(new lit.Euler(1, 2, 3), false); q.slerp(new lit.Quaternion(0, 1, 0, 0), 0);
  assert.equal(n, 3);
  let m = 0;
  const e = new lit.Euler()._onChange(() => m++);
  e.order = "ZYX"; e.set(1, 2, 3); e.setFromRotationMatrix(new lit.Matrix4(), "XYZ", false); e.setFromQuaternion(q);
  assert.equal(m, 3);
});

test("mathUtils keeps r180's API, on a seeded stream", () => {
  const u = lit.mathUtils;
  u.reseedRandom(42);
  const first = [u.generateUUID(), u.randInt(1, 6), u.randFloat(0, 1), u.randFloatSpread(2)];
  u.reseedRandom(42);
  assert.deepEqual([u.generateUUID(), u.randInt(1, 6), u.randFloat(0, 1), u.randFloatSpread(2)], first);
  assert.match(first[0] as string, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
