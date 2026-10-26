// The geometry against Three.js r180, to the bit. fixtures/geometry.json holds
// r180's outputs on seeded inputs (made outside this repo by
// make-geometry-fixtures.mjs: Three is never a dependency here);
// geometry-cases.ts says how each case builds its geometry or curve and reads
// it back (attribute bytes hashed), and runs the same on r180 and on ours.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// (the fixture was recorded with Math's transcendental functions swapped for
// core's dmath, so it holds on every CPU: swap them here too, before any case runs.
// A test-only reach into core's source: lit's runtime never imports it.)
import { DMATH } from "../../core/src/dmath.ts";
import * as lit from "../src/index.ts";
import { cases } from "./geometry-cases.ts";
import { decode, encode } from "./math-cases.ts";

interface Fixture {
  three: string;
  portableMath: readonly (keyof typeof DMATH)[];
  cases: Record<string, [unknown, unknown][]>;
}

const fixture = decode(readFileSync(new URL("./fixtures/geometry.json", import.meta.url), "utf8")) as Fixture;

const math = Math as unknown as Record<string, unknown>;
for (const k of fixture.portableMath) math[k] = DMATH[k];

// (r180's type strings, as KEEL names them)
const TYPES: Record<string, string> = {
  BoxGeometry: "box", CylinderGeometry: "cylinder", ConeGeometry: "cone", SphereGeometry: "sphere",
  PolyhedronGeometry: "polyhedron", IcosahedronGeometry: "icosahedron", OctahedronGeometry: "octahedron",
  DodecahedronGeometry: "dodecahedron", TetrahedronGeometry: "tetrahedron", PlaneGeometry: "plane",
  RingGeometry: "ring", TorusGeometry: "torus", TubeGeometry: "tube", LatheGeometry: "lathe",
  ExtrudeGeometry: "extrude", ShapeGeometry: "shape",
};

/** r180's output with its geometry types renamed to KEEL's. */
function renamed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renamed);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === "type" && typeof v === "string" && v in TYPES ? TYPES[v] : renamed(v);
    return out;
  }
  return value;
}

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
    const quiet = console.error;
    console.error = () => {};
    try {
      for (let i = 0; i < rows.length; i++) {
        const [input, expected] = rows[i]!;
        // (through the fixture's encoding, as r180's output went)
        const got = decode(encode(c.run(lit, structuredClone(input))));
        const d = diff(got, renamed(expected));
        if (d) assert.fail(`${name} #${i}${d}\n  input: ${JSON.stringify(input)}`);
      }
    } finally {
      console.error = quiet;
    }
  });
}

test("generators carry KEEL's type and r180's parameters", () => {
  const b = lit.box(2, 3, 4, 1.5);
  assert.equal(b.type, "box");
  assert.ok(b instanceof lit.Geometry);
  assert.deepEqual(b.parameters, { width: 2, height: 3, depth: 4, widthSegments: 1.5, heightSegments: 1, depthSegments: 1 });
  const c = lit.cone();
  assert.equal(c.type, "cone");
  assert.deepEqual(Object.keys(c.parameters), ["radius", "height", "radialSegments", "heightSegments", "openEnded", "thetaStart", "thetaLength"]);
  const ico = lit.icosahedron(2, 1);
  assert.deepEqual([ico.type, ico.parameters], ["icosahedron", { radius: 2, detail: 1 }]);
  const t = lit.tube();
  assert.equal(t.type, "tube");
  assert.equal(t.tangents.length, 65);
  assert.ok(t.parameters.path instanceof lit.QuadraticBezierCurve3);
  const s = new lit.Shape();
  const options = { depth: 2 };
  const e = lit.extrude(s, options);
  assert.equal(e.parameters.shapes, s);
  assert.equal(e.parameters.options, options);
});

test("curves keep r180's names and flags", () => {
  const curves = [
    [new lit.LineCurve(), "LineCurve", "isLineCurve"], [new lit.LineCurve3(), "LineCurve3", "isLineCurve3"],
    [new lit.QuadraticBezierCurve(), "QuadraticBezierCurve", "isQuadraticBezierCurve"], [new lit.QuadraticBezierCurve3(), "QuadraticBezierCurve3", "isQuadraticBezierCurve3"],
    [new lit.CubicBezierCurve(), "CubicBezierCurve", "isCubicBezierCurve"], [new lit.CubicBezierCurve3(), "CubicBezierCurve3", "isCubicBezierCurve3"],
    [new lit.EllipseCurve(), "EllipseCurve", "isEllipseCurve"], [new lit.ArcCurve(), "ArcCurve", "isArcCurve"],
    [new lit.SplineCurve(), "SplineCurve", "isSplineCurve"], [new lit.CatmullRomCurve3(), "CatmullRomCurve3", "isCatmullRomCurve3"],
  ] as const;
  for (const [c, type, flag] of curves) {
    assert.equal(c.type, type);
    assert.equal((c as unknown as Record<string, unknown>)[flag], true);
    assert.ok(c instanceof lit.Curve);
  }
  assert.equal(new lit.ArcCurve().isEllipseCurve, true);
  assert.equal(new lit.Path().type, "Path");
  assert.equal(new lit.Shape().type, "Shape");
  assert.equal(new lit.CurvePath().type, "CurvePath");
  assert.equal(lit.interpolations.CatmullRom(0.5, 0, 1, 2, 3), 1.5);
});
