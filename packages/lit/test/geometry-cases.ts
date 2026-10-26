// The geometry parity cases: what to feed r180 and the port, and what to read
// back. As math-cases.ts: the fixture generator (outside this repo, where Three
// lives) runs each case's `run` on r180 under KEEL's names (box() is
// `new BoxGeometry()` there) and records the outputs; geometry.test.ts runs the
// same code on ours and wants the same bits.
//
// A geometry reads back as its attributes and index (typed array kind, item
// size, count and a sha256 of the bytes, so -0, NaN and every last bit count),
// its groups, draw range and parameters. Curves read back as their samples:
// short lists as numbers, long ones hashed as Float64Array bytes.

import { createHash } from "node:crypto";

import type * as K from "../src/index.ts";

/** The generators and curves under test: ours, or r180's under the same names. */
export type Lib = typeof K;

export type Rng = () => number;

// (inputs come back from JSON: plain data, read by the case that made them)
type In = any;
type Any = any;

export interface Case {
  /** How many rows the fixture holds. */
  rows: number;
  make(r: Rng): In;
  run(lib: Lib, input: In): unknown;
}

// ---- input makers

const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const pos = (r: Rng, lo: number, hi: number): number => lo + r() * (hi - lo);
const num = (r: Rng, s = 3): number => (r() * 2 - 1) * s;
/** An angle, now and then a whole multiple of pi/2 (the generators branch on 0, pi and 2 pi). */
const angle = (r: Rng): number => (r() < 0.3 ? pick(r, [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) : (r() * 2 - 1) * 2 * Math.PI);
/** A segment count, now and then fractional (r180 floors most, not all). */
const segs = (r: Rng, lo: number, hi: number): number => (r() < 0.12 ? pos(r, lo, hi) : int(r, lo, hi));
/** The first n of args (r180's defaults fill the rest). */
const some = (r: Rng, args: unknown[]): unknown[] => (r() < 0.2 ? args.slice(0, int(r, 0, args.length)) : args);
const p2 = (r: Rng, s = 3): number[] => [num(r, s), num(r, s)];
const p3 = (r: Rng, s = 3): number[] => [num(r, s), num(r, s), num(r, s)];

// ---- read-back

const hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 20);
const hashView = (a: ArrayBufferView): string => hex(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

/** A list of numbers: as is when short, else its length and a hash of its Float64Array bytes. */
function nums(list: readonly number[]): unknown {
  return list.length <= 12 ? list.slice() : { n: list.length, h: hashView(new Float64Array(list)) };
}

const flat = (points: readonly Any[]): number[] => points.flatMap((p: Any) => (p === null ? [NaN] : p.isVector3 ? [p.x, p.y, p.z] : [p.x, p.y]));

/** Parameters and options read generically: numbers as numbers, vectors as lists, curves by type. */
function plain(v: Any, depth = 0): unknown {
  if (v === undefined) return { undef: true };
  if (v === null || typeof v !== "object") return typeof v === "function" ? { fn: true } : v;
  if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
  if (v.isVector2) return { v2: [v.x, v.y] };
  if (v.isVector3) return { v3: [v.x, v.y, v.z] };
  if (typeof v.getPoint === "function") return { curve: v.type };
  if (depth > 3) return { deep: true };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = plain(v[k], depth + 1);
  return out;
}

/** A geometry as the fixture holds it. */
export function summarize(g: Any): unknown {
  const attributes: unknown[] = [];
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    attributes.push([name, a.array.constructor.name, a.itemSize, a.count, a.normalized, hashView(a.array)]);
  }
  const index = g.index ? [g.index.array.constructor.name, g.index.count, hashView(g.index.array)] : null;
  return {
    type: g.type,
    attributes,
    index,
    groups: g.groups.map((gr: Any) => [gr.start, gr.count, gr.materialIndex]),
    drawRange: [g.drawRange.start, g.drawRange.count],
    morph: Object.keys(g.morphAttributes),
    parameters: plain(g.parameters),
  };
}

function frames(f: Any): unknown {
  return { t: nums(flat(f.tangents)), n: nums(flat(f.normals)), b: nums(flat(f.binormals)) };
}

// ---- curves

const CURVE2 = ["line", "quad", "cubic", "ellipse", "arc", "spline"] as const;
const CURVE3 = ["line3", "quad3", "cubic3", "catmull", "catmull", "catmull", "curvepath3"] as const;
const CATMULL_TYPES = ["centripetal", "chordal", "catmullrom"] as const;

function makeCurve(r: Rng, kind: string): In {
  switch (kind) {
    case "line": return { kind, v: [p2(r), r() < 0.1 ? [0, 0] : p2(r)] };
    case "quad": return { kind, v: [p2(r), p2(r), p2(r)] };
    case "cubic": return { kind, v: [p2(r), p2(r), p2(r), p2(r)] };
    case "ellipse": return { kind, a: some(r, [num(r), num(r), pos(r, 0.1, 3), pos(r, 0.1, 3), angle(r), angle(r), r() < 0.5, r() < 0.4 ? 0 : angle(r)]) };
    case "arc": return { kind, a: some(r, [num(r), num(r), pos(r, 0.1, 3), angle(r), angle(r), r() < 0.5]) };
    case "spline": return { kind, v: Array.from({ length: int(r, 2, 9) }, () => p2(r)) };
    case "line3": return { kind, v: [p3(r), p3(r)] };
    case "quad3": return { kind, v: [p3(r), p3(r), p3(r)] };
    case "cubic3": return { kind, v: [p3(r), p3(r), p3(r), p3(r)] };
    case "catmull": {
      const n = int(r, 2, 10);
      const v = Array.from({ length: n }, () => p3(r));
      // (now and then a repeated point: the safety check for dt < 1e-4)
      if (n > 2 && r() < 0.15) v[1] = v[0]!.slice();
      return { kind, v, closed: r() < 0.4, type: pick(r, CATMULL_TYPES), tension: r() < 0.5 ? 0.5 : pos(r, -0.5, 1.5) };
    }
    case "curvepath3": return { kind, parts: Array.from({ length: int(r, 1, 3) }, () => makeCurve(r, pick(r, ["line3", "quad3", "cubic3"]))) };
    default: throw new Error(`no curve ${kind}`);
  }
}

function buildCurve(lib: Lib, c: In): Any {
  const V2 = (p: number[]) => new lib.Vector2(p[0], p[1]);
  const V3 = (p: number[]) => new lib.Vector3(p[0], p[1], p[2]);
  const L: Any = lib;
  switch (c.kind) {
    case "line": return new lib.LineCurve(...(c.v.map(V2) as [K.Vector2, K.Vector2]));
    case "quad": return new lib.QuadraticBezierCurve(...(c.v.map(V2) as [K.Vector2, K.Vector2, K.Vector2]));
    case "cubic": return new lib.CubicBezierCurve(...(c.v.map(V2) as [K.Vector2, K.Vector2, K.Vector2, K.Vector2]));
    case "ellipse": return new L.EllipseCurve(...c.a);
    case "arc": return new L.ArcCurve(...c.a);
    case "spline": return new lib.SplineCurve(c.v.map(V2));
    case "line3": return new lib.LineCurve3(...(c.v.map(V3) as [K.Vector3, K.Vector3]));
    case "quad3": return new lib.QuadraticBezierCurve3(...(c.v.map(V3) as [K.Vector3, K.Vector3, K.Vector3]));
    case "cubic3": return new lib.CubicBezierCurve3(...(c.v.map(V3) as [K.Vector3, K.Vector3, K.Vector3, K.Vector3]));
    case "catmull": return new lib.CatmullRomCurve3(c.v.map(V3), c.closed, c.type, c.tension);
    case "curvepath3": {
      const path = new lib.CurvePath<K.Vector3>();
      for (const part of c.parts) path.add(buildCurve(lib, part));
      return path;
    }
    default: throw new Error(`no curve ${c.kind}`);
  }
}

/** A curve's samples, the way the generators and a piece read them. */
function sampleCurve(curve: Any, input: In): unknown {
  if (input.divisions !== undefined) curve.arcLengthDivisions = input.divisions;
  const out: Record<string, unknown> = {};
  out["type"] = curve.type;
  out["points"] = nums(flat(input.n === null ? curve.getPoints() : curve.getPoints(input.n)));
  out["spaced"] = nums(flat(input.m === null ? curve.getSpacedPoints() : curve.getSpacedPoints(input.m)));
  out["length"] = curve.getLength();
  out["lengths"] = nums(curve.getLengths(input.k));
  out["lengthsDefault"] = nums(curve.getLengths());
  out["uToT"] = input.us.map((u: number) => curve.getUtoTmapping(u));
  out["uToTd"] = input.ds.map((d: number) => curve.getUtoTmapping(0, d));
  out["at"] = flat(input.us.map((u: number) => curve.getPointAt(u)));
  out["tangent"] = flat(input.ts.map((t: number) => curve.getTangent(t)));
  out["tangentAt"] = flat(input.us.map((u: number) => curve.getTangentAt(u)));
  out["clone"] = flat([curve.clone().getPoint(0.37)]);
  if (input.frames) out["frames"] = frames(curve.computeFrenetFrames(input.segments, input.closed));
  curve.updateArcLengths();
  out["after"] = curve.getLength();
  return out;
}

function makeSampling(r: Rng, curve: In, is3: boolean): In {
  return {
    curve,
    divisions: r() < 0.3 ? int(r, 4, 400) : undefined,
    n: r() < 0.2 ? null : int(r, 1, 30),
    m: r() < 0.2 ? null : int(r, 1, 30),
    k: int(r, 1, 300),
    us: Array.from({ length: 4 }, () => (r() < 0.3 ? pick(r, [0, 1, 0.5]) : r())),
    ds: Array.from({ length: 2 }, () => pos(r, 0, 4)),
    ts: Array.from({ length: 4 }, () => (r() < 0.3 ? pick(r, [0, 1, 0.00005, 0.99995]) : r())),
    frames: is3,
    segments: int(r, 1, 80),
    closed: r() < 0.4,
  };
}

// ---- paths and shapes

/** A path's drawing commands (r180's Path methods). */
type Cmd = [string, ...unknown[]];

function polygon(r: Rng, cx: number, cy: number, rmin: number, rmax: number, n: number, curvy: number, clockwise: boolean): Cmd[] {
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((clockwise ? -i : i) / n) * Math.PI * 2 + pos(r, -0.2, 0.2) / n;
    const rad = pos(r, rmin, rmax);
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  const cmds: Cmd[] = [["moveTo", pts[0]![0], pts[0]![1]]];
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n]!, q = pts[i - 1]!;
    const k = r();
    if (i === n && r() < 0.5) break; // (left open: extractPoints' points don't close it)
    const mx = (p[0]! + q[0]!) / 2, my = (p[1]! + q[1]!) / 2;
    if (k < curvy * 0.4) cmds.push(["quadraticCurveTo", mx * pos(r, 1, 1.15), my * pos(r, 1, 1.15), p[0], p[1]]);
    else if (k < curvy * 0.8) cmds.push(["bezierCurveTo", q[0]! * 0.7 + p[0]! * 0.3, q[1]! * 0.7 + p[1]! * 0.3, q[0]! * 0.3 + p[0]! * 0.7, q[1]! * 0.3 + p[1]! * 0.7, p[0], p[1]]);
    else if (k < curvy) cmds.push(["splineThru", [[mx * 1.05, my * 1.05], [p[0], p[1]]]]);
    else cmds.push(["lineTo", p[0], p[1]]);
  }
  return cmds;
}

function makeOutline(r: Rng, cx = 0, cy = 0, scale = 1): Cmd[] {
  const k = r();
  const cw = r() < 0.3;
  if (k < 0.15) return [["absarc", cx, cy, pos(r, 2, 3) * scale, 0, Math.PI * 2, cw]];
  if (k < 0.25) return [["absellipse", cx, cy, pos(r, 2, 3) * scale, pos(r, 2, 3) * scale, 0, Math.PI * 2, cw, r() < 0.5 ? 0 : angle(r)]];
  if (k < 0.32) {
    // (a rounded rectangle, the grove's planter outline)
    const w = pos(r, 2, 3) * scale, h = pos(r, 2, 3) * scale, rr = pos(r, 0.2, 0.8) * scale;
    return [
      ["moveTo", cx - w + rr, cy - h], ["lineTo", cx + w - rr, cy - h], ["absarc", cx + w - rr, cy - h + rr, rr, -Math.PI / 2, 0, false],
      ["lineTo", cx + w, cy + h - rr], ["absarc", cx + w - rr, cy + h - rr, rr, 0, Math.PI / 2, false],
      ["lineTo", cx - w + rr, cy + h], ["absarc", cx - w + rr, cy + h - rr, rr, Math.PI / 2, Math.PI, false],
      ["lineTo", cx - w, cy - h + rr], ["absarc", cx - w + rr, cy - h + rr, rr, Math.PI, Math.PI * 1.5, false],
    ];
  }
  if (k < 0.4) return [["points", Array.from({ length: int(r, 3, 9) }, (_, i, ) => [cx + Math.cos(i) * 2.5 * scale, cy + Math.sin(i * 1.3) * 2.5 * scale])]];
  return polygon(r, cx, cy, 2 * scale, 3 * scale, int(r, 3, 12), r() < 0.5 ? 0 : pos(r, 0, 0.6), cw);
}

function makeHole(r: Rng, cx: number, cy: number, scale = 1): Cmd[] {
  const k = r();
  const rad = pos(r, 0.15, 0.45) * scale;
  const cw = r() < 0.5;
  if (k < 0.4) return [["absarc", cx, cy, rad, 0, Math.PI * 2, cw]];
  if (k < 0.5) return [["moveTo", cx, cy], ["arc", 0, 0, rad, 0, Math.PI * 2, cw]];
  return polygon(r, cx, cy, rad * 0.6, rad, int(r, 3, 7), r() < 0.5 ? 0 : 0.5, cw);
}

function makeShape(r: Rng, cx = 0, cy = 0, scale = 1): In {
  const nHoles = r() < 0.35 ? 0 : int(r, 1, 3);
  const holes: Cmd[][] = [];
  const turn = r() * Math.PI * 2;
  for (let h = 0; h < nHoles; h++) {
    const a = turn + (h / 3) * Math.PI * 2;
    const d = nHoles === 1 && r() < 0.5 ? 0 : 1.0 * scale;
    holes.push(makeHole(r, cx + d * Math.cos(a), cy + d * Math.sin(a), scale));
  }
  return { outline: makeOutline(r, cx, cy, scale), holes };
}

function draw(lib: Lib, path: Any, cmds: Cmd[]): Any {
  for (const [op, ...a] of cmds) {
    if (op === "points") path.setFromPoints((a[0] as number[][]).map((p) => new lib.Vector2(p[0], p[1])));
    else if (op === "splineThru") path.splineThru((a[0] as number[][]).map((p) => new lib.Vector2(p[0], p[1])));
    else path[op](...a);
  }
  return path;
}

function buildShape(lib: Lib, s: In): K.Shape {
  const shape = draw(lib, new lib.Shape(), s.outline);
  for (const h of s.holes) shape.holes.push(draw(lib, new lib.Path(), h));
  return shape;
}

const buildShapes = (lib: Lib, list: In[], single: boolean): K.Shape | K.Shape[] => (single ? buildShape(lib, list[0]) : list.map((s) => buildShape(lib, s)));

function makeShapes(r: Rng, scale = 1): In[] {
  const n = r() < 0.7 ? 1 : int(r, 2, 3);
  return Array.from({ length: n }, (_, i) => makeShape(r, i * 7 * scale, 0, scale));
}

/** A UV generator of the case's own (r180 calls it through the same hooks). */
function customUV(lib: Lib): K.UVGenerator {
  return {
    generateTopUV(_g, v, a, b, c) {
      return [a, b, c].map((i) => new lib.Vector2(v[i * 3]! * 0.5 + v[i * 3 + 2]!, v[i * 3 + 1]! * 0.25));
    },
    generateSideWallUV(_g, v, a, b, c, d) {
      return [a, b, c, d].map((i) => new lib.Vector2(v[i * 3]! - v[i * 3 + 1]!, v[i * 3 + 2]! * 2));
    },
  };
}

// ---- the cases

const call = (fn: unknown, args: unknown[]): Any => (fn as (...a: unknown[]) => unknown)(...args);

function geometryCase(rows: number, make: (r: Rng) => unknown[], name: keyof Lib): Case {
  return {
    rows,
    make: (r) => ({ args: make(r) }),
    run: (lib, input) => summarize(call(lib[name], input.args)),
  };
}

export const cases: Record<string, Case> = {
  box: geometryCase(40, (r) => some(r, [pos(r, 0.1, 5), r() < 0.1 ? -pos(r, 0.1, 5) : pos(r, 0.1, 5), r() < 0.1 ? 0 : pos(r, 0.1, 5), segs(r, 1, 6), segs(r, 1, 6), segs(r, 1, 6)]), "box"),

  cylinder: geometryCase(50, (r) => {
    const t = r();
    return some(r, [t < 0.15 ? 0 : pos(r, 0.1, 3), t > 0.85 ? 0 : pos(r, 0.1, 3), pos(r, 0.1, 5), segs(r, 3, 40), segs(r, 1, 6), r() < 0.25, r() < 0.5 ? 0 : angle(r), r() < 0.5 ? Math.PI * 2 : pos(r, 0.1, 6.3)]);
  }, "cylinder"),

  cone: geometryCase(30, (r) => some(r, [pos(r, 0.1, 3), pos(r, 0.1, 5), segs(r, 3, 40), segs(r, 1, 6), r() < 0.25, r() < 0.5 ? 0 : angle(r), r() < 0.5 ? Math.PI * 2 : pos(r, 0.1, 6.3)]), "cone"),

  sphere: geometryCase(50, (r) => {
    const thetaStart = r() < 0.5 ? 0 : pos(r, 0, Math.PI);
    const thetaLength = r() < 0.4 ? Math.PI : r() < 0.3 ? Math.PI - thetaStart : pos(r, 0.1, Math.PI);
    return some(r, [pos(r, 0.1, 5), segs(r, 1, 40), segs(r, 1, 24), r() < 0.5 ? 0 : angle(r), r() < 0.5 ? Math.PI * 2 : pos(r, 0.1, 6.3), thetaStart, thetaLength]);
  }, "sphere"),

  plane: geometryCase(30, (r) => some(r, [pos(r, 0.1, 10), pos(r, 0.1, 10), segs(r, 1, 12), segs(r, 1, 12)]), "plane"),

  ring: geometryCase(30, (r) => some(r, [pos(r, 0, 1), pos(r, 1, 3), segs(r, 1, 40), segs(r, 1, 6), r() < 0.5 ? 0 : angle(r), r() < 0.5 ? Math.PI * 2 : pos(r, 0.1, 6.3)]), "ring"),

  torus: geometryCase(30, (r) => some(r, [pos(r, 0.5, 3), pos(r, 0.05, 1), segs(r, 2, 24), segs(r, 3, 64), r() < 0.5 ? Math.PI * 2 : pos(r, 0.1, 6.3)]), "torus"),

  icosahedron: geometryCase(12, (r) => some(r, [pos(r, 0.1, 5), int(r, 0, 4)]), "icosahedron"),
  octahedron: geometryCase(12, (r) => some(r, [pos(r, 0.1, 5), int(r, 0, 4)]), "octahedron"),
  dodecahedron: geometryCase(12, (r) => some(r, [pos(r, 0.1, 5), int(r, 0, 3)]), "dodecahedron"),
  tetrahedron: geometryCase(12, (r) => some(r, [pos(r, 0.1, 5), int(r, 0, 5)]), "tetrahedron"),

  polyhedron: geometryCase(16, (r) => {
    // (a cube, as r180's docs build one, now and then squashed)
    const s = r() < 0.5 ? 1 : pos(r, 0.3, 2);
    const vertices = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1].map((x, i) => (i % 3 === 1 ? x * s : x));
    const indices = [2, 1, 0, 0, 3, 2, 0, 4, 7, 7, 3, 0, 0, 1, 5, 5, 4, 0, 1, 2, 6, 6, 5, 1, 2, 3, 7, 7, 6, 2, 4, 5, 6, 6, 7, 4];
    return some(r, [vertices, indices, pos(r, 0.1, 5), int(r, 0, 3)]);
  }, "polyhedron"),

  lathe: {
    rows: 40,
    make: (r) => {
      const n = int(r, 2, 12);
      const points = r() < 0.15 ? null : Array.from({ length: n }, (_, i) => [r() < 0.15 ? 0 : pos(r, 0, 2), -1 + (2 * i) / (n - 1) + (r() < 0.2 ? pos(r, -0.3, 0.3) : 0)]);
      const phiLength = r() < 0.4 ? Math.PI * 2 : r() < 0.2 ? pos(r, 6.3, 9) : pos(r, 0.1, 6.3);
      return { points, rest: some(r, [segs(r, 1, 30), r() < 0.5 ? 0 : angle(r), phiLength]) };
    },
    run: (lib, input) => {
      const points = input.points === null ? undefined : input.points.map((p: number[]) => new lib.Vector2(p[0], p[1]));
      return summarize(call(lib.lathe, [points, ...input.rest]));
    },
  },

  tube: {
    rows: 50,
    make: (r) => ({ path: r() < 0.1 ? null : makeCurve(r, pick(r, CURVE3)), rest: some(r, [int(r, 1, 80), pos(r, 0.05, 1), int(r, 1, 16), r() < 0.4]) }),
    run: (lib, input) => {
      const g = call(lib.tube, [input.path === null ? undefined : buildCurve(lib, input.path), ...input.rest]);
      return { geometry: summarize(g), frames: frames(g) };
    },
  },

  shape: {
    rows: 50,
    make: (r) => {
      const single = r() < 0.6;
      return { shapes: r() < 0.08 ? null : single ? [makeShape(r)] : makeShapes(r), single, rest: some(r, [int(r, 1, 16)]) };
    },
    run: (lib, input) => summarize(call(lib.shape, [input.shapes === null ? undefined : buildShapes(lib, input.shapes, input.single), ...input.rest])),
  },

  extrude: {
    rows: 70,
    make: (r) => {
      const single = r() < 0.6;
      const options: Record<string, unknown> = {};
      const set = (k: string, v: unknown) => { if (r() < 0.6) options[k] = v; };
      set("curveSegments", int(r, 1, 16));
      set("steps", int(r, 1, 5));
      set("depth", pos(r, 0.1, 4));
      set("bevelEnabled", r() < 0.6);
      set("bevelThickness", pos(r, 0.01, 0.5));
      set("bevelSize", pos(r, 0.01, 0.4));
      set("bevelOffset", r() < 0.5 ? 0 : pos(r, -0.1, 0.1));
      set("bevelSegments", int(r, 1, 6));
      const path = r() < 0.2 ? makeCurve(r, pick(r, ["catmull", "line3", "cubic3", "quad3"])) : null;
      const scale = path ? 0.2 : 1;
      return { shapes: r() < 0.05 ? null : single ? [makeShape(r, 0, 0, scale)] : makeShapes(r, scale), single, options: r() < 0.05 ? null : options, path, uv: r() < 0.15 };
    },
    run: (lib, input) => {
      const shapes = input.shapes === null ? undefined : buildShapes(lib, input.shapes, input.single);
      if (input.options === null) return summarize(call(lib.extrude, [shapes]));
      const options = { ...input.options };
      if (input.path) options.extrudePath = buildCurve(lib, input.path);
      if (input.uv) options.UVGenerator = customUV(lib);
      return summarize(call(lib.extrude, [shapes, options]));
    },
  },

  defaults: {
    rows: 1,
    make: () => ({}),
    run: (lib) => {
      const L: Any = lib;
      return ["box", "cylinder", "cone", "sphere", "polyhedron", "icosahedron", "octahedron", "dodecahedron", "tetrahedron", "plane", "ring", "torus", "tube", "lathe", "extrude", "shape"].map((n) => summarize(L[n]()));
    },
  },

  "curve.2d": {
    rows: 70,
    make: (r) => makeSampling(r, makeCurve(r, pick(r, CURVE2)), false),
    run: (lib, input) => sampleCurve(buildCurve(lib, input.curve), input),
  },

  "curve.3d": {
    rows: 80,
    make: (r) => makeSampling(r, makeCurve(r, pick(r, CURVE3)), true),
    run: (lib, input) => sampleCurve(buildCurve(lib, input.curve), input),
  },

  "curve.defaults": {
    rows: 1,
    make: () => ({}),
    run: (lib) => {
      const L: Any = lib;
      const kinds = ["LineCurve", "LineCurve3", "QuadraticBezierCurve", "QuadraticBezierCurve3", "CubicBezierCurve", "CubicBezierCurve3", "EllipseCurve", "ArcCurve"];
      return kinds.map((k) => {
        const c = new L[k]();
        return [c.type, c.arcLengthDivisions, flat(c.getPoints(4)), plain(Object.keys(c).filter((key) => key !== "uuid"))];
      });
    },
  },

  path: {
    rows: 60,
    make: (r) => {
      const s = makeShape(r);
      return { s, shapeClass: r() < 0.5, autoClose: r() < 0.3, closePath: r() < 0.3, n: r() < 0.2 ? null : int(r, 1, 24), m: r() < 0.2 ? null : int(r, 1, 60) };
    },
    run: (lib, input) => {
      const path: Any = input.shapeClass ? buildShape(lib, input.s) : draw(lib, new lib.Path(), input.s.outline);
      if (input.closePath && path.curves.length > 0) path.closePath();
      path.autoClose = input.autoClose;
      const out: Record<string, unknown> = {
        type: path.type,
        curves: path.curves.map((c: Any) => c.type),
        current: [path.currentPoint.x, path.currentPoint.y],
        points: nums(flat(input.n === null ? path.getPoints() : path.getPoints(input.n))),
        spaced: nums(flat(input.m === null ? path.getSpacedPoints() : path.getSpacedPoints(input.m))),
        length: path.getLength(),
        curveLengths: nums(path.getCurveLengths()),
        at: flat([0, 0.25, 0.5, 0.999, 1].map((t) => path.getPoint(t))),
      };
      if (input.shapeClass) {
        const ex = path.extractPoints(input.n === null ? undefined : input.n);
        out["extract"] = [nums(flat(ex.shape)), ex.holes.map((h: Any) => nums(flat(h)))];
      }
      const copy = path.clone();
      out["clone"] = [copy.type, copy.curves.length, nums(flat(copy.getPoints(5)))];
      return out;
    },
  },

  shapeUtils: {
    rows: 50,
    make: (r) => ({ s: makeShape(r), n: int(r, 1, 16) }),
    run: (lib, input) => {
      const ex = buildShape(lib, input.s).extractPoints(input.n);
      const area = lib.shapeUtils.area(ex.shape);
      const cw = lib.shapeUtils.isClockWise(ex.shape);
      const faces = lib.shapeUtils.triangulateShape(ex.shape, ex.holes);
      return { area, cw, holeAreas: ex.holes.map((h) => lib.shapeUtils.area(h)), faces: nums(faces.flat()), left: [ex.shape.length, ex.holes.map((h) => h.length)] };
    },
  },

  earcut: {
    rows: 60,
    make: (r) => {
      // (rings of points: the outline, then holes; big ones take the z-order path)
      const big = r() < 0.4;
      const n = big ? int(r, 81, 300) : int(r, 3, 40);
      const data: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rad = pos(r, 5, 10);
        data.push(r() < 0.05 && i > 0 ? data[data.length - 2]! : Math.round(rad * Math.cos(a) * 1000) / 1000, r() < 0.05 && i > 0 ? data[data.length - 2]! : Math.round(rad * Math.sin(a) * 1000) / 1000);
      }
      const holeIndices: number[] = [];
      const nHoles = r() < 0.4 ? 0 : int(r, 1, 4);
      for (let h = 0; h < nHoles; h++) {
        holeIndices.push(data.length / 2);
        const cx = h === 0 && r() < 0.3 ? 0 : num(r, 2.5), cy = num(r, 2.5);
        const m = int(r, 1, big ? 30 : 6);
        for (let i = 0; i < m; i++) {
          const a = (i / m) * Math.PI * 2;
          data.push(Math.round((cx + 1.2 * Math.cos(a)) * 1000) / 1000, Math.round((cy + 1.2 * Math.sin(a)) * 1000) / 1000);
        }
      }
      // (now and then a self-intersecting mess: the cure and split passes)
      if (r() < 0.15) for (let i = 0; i < 6; i++) data.splice(int(r, 0, data.length / 2 - 1) * 2, 0, num(r, 10), num(r, 10));
      return { data, holeIndices };
    },
    run: (lib, input) => {
      const tris = lib.earcut(input.data, input.holeIndices.length ? input.holeIndices : null);
      return { tris: nums(tris), dev: lib.earcutDeviation(input.data, input.holeIndices, 2, tris) };
    },
  },
};
