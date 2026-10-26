// The maths parity cases: what to feed r180 and the port, and what to read
// back. The same code drives both: the fixture generator (outside this repo,
// where Three lives) runs each case's `run` on r180's classes and records the
// inputs and outputs; math.test.ts runs it on ours and wants the same bits.
//
// `make` draws a case's inputs from a seeded stream. `run` builds fresh objects
// from them through `lib` (r180's classes under KEEL's names, or ours) and
// returns plain data: numbers, strings, booleans and nulls, in arrays.

import type * as M from "../src/math/index.ts";
import type { ColorSpace, CoordinateSystem, EulerOrder } from "../src/math/index.ts";

/** The classes under test: ours, or r180's under the same names. */
export type Lib = typeof M & {
  /** The linear sRGB colour space's name ("linear" here, "srgb-linear" in r180). */
  LINEAR: ColorSpace;
  WEBGL: CoordinateSystem;
  WEBGPU: CoordinateSystem;
};

export type Rng = () => number;

// (inputs come back from JSON: plain data, read by the case that made them)
type In = any;

export interface Case {
  make(r: Rng): In;
  run(lib: Lib, input: In): unknown;
}

/** mulberry32: the inputs' stream (not under test). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- input makers

const SPECIALS = [0, -0, 1, -1, 0.5, -0.5, 2, 1e-9, -1e-9, 1e9, 3];
const ORDERS: readonly EulerOrder[] = ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"];

const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
/** A number in [-s, s], now and then a special one (0, -0, 1, tiny, huge...). */
const num = (r: Rng, s = 10): number => (r() < 0.06 ? pick(r, SPECIALS) : (r() * 2 - 1) * s);
const pos = (r: Rng, lo: number, hi: number): number => lo + r() * (hi - lo);
const vec = (r: Rng, n: number, s = 10): number[] => Array.from({ length: n }, () => num(r, s));
/** An angle, now and then a multiple of pi/2 (gimbal lock, branch edges). */
const angle = (r: Rng): number => (r() < 0.15 ? (Math.floor(r() * 9) - 4) * (Math.PI / 2) : (r() * 2 - 1) * 2 * Math.PI);
const order = (r: Rng): EulerOrder => pick(r, ORDERS);

function unitQuat(r: Rng): number[] {
  if (r() < 0.1) {
    // (axis-aligned turns: branch edges in setFromRotationMatrix and slerp)
    const q = [0, 0, 0, 0];
    q[Math.floor(r() * 4)] = r() < 0.5 ? 1 : -1;
    if (r() < 0.5) q[Math.floor(r() * 4)] = Math.SQRT1_2, q[3] = Math.SQRT1_2;
    return q;
  }
  const q = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
  const l = Math.sqrt(q[0]! * q[0]! + q[1]! * q[1]! + q[2]! * q[2]! + q[3]! * q[3]!) || 1;
  return q.map((v) => v / l);
}

function unitVec(r: Rng): number[] {
  if (r() < 0.1) return pick(r, [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]);
  const v = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
  const l = Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!) || 1;
  return v.map((x) => x / l);
}

/** A matrix's 16 elements: a TRS, a general one, or a singular one. */
function mat4(r: Rng): { kind: string; p?: number[]; q?: number[]; s?: number[]; e?: number[] } {
  const k = r();
  if (k < 0.55) return { kind: "trs", p: vec(r, 3, 50), q: unitQuat(r), s: [pos(r, 0.1, 4) * (r() < 0.15 ? -1 : 1), pos(r, 0.1, 4), pos(r, 0.1, 4)] };
  if (k < 0.9) return { kind: "raw", e: vec(r, 16, 5) };
  // (singular: a repeated column)
  const e = vec(r, 16, 5);
  for (let i = 0; i < 4; i++) e[4 + i] = e[i]!;
  return { kind: "raw", e };
}

function mat3(r: Rng): number[] {
  const e = vec(r, 9, 5);
  if (r() < 0.1) for (let i = 0; i < 3; i++) e[3 + i] = e[i]!;
  return e;
}

// ---- builders and readers

const V2 = (lib: Lib, a: number[]) => new lib.Vector2(a[0], a[1]);
const V3 = (lib: Lib, a: number[]) => new lib.Vector3(a[0], a[1], a[2]);
const V4 = (lib: Lib, a: number[]) => new lib.Vector4(a[0], a[1], a[2], a[3]);
const Q = (lib: Lib, a: number[]) => new lib.Quaternion(a[0], a[1], a[2], a[3]);
const M3 = (lib: Lib, e: number[]) => new lib.Matrix3().fromArray(e);
function M4(lib: Lib, m: ReturnType<typeof mat4>): M.Matrix4 {
  if (m.kind === "trs") return new lib.Matrix4().compose(V3(lib, m.p!), Q(lib, m.q!), V3(lib, m.s!));
  return new lib.Matrix4().fromArray(m.e!);
}

const v2 = (v: M.Vector2) => [v.x, v.y];
const v3 = (v: M.Vector3) => [v.x, v.y, v.z];
const v4 = (v: M.Vector4) => [v.x, v.y, v.z, v.w];
const q4 = (q: M.Quaternion) => [q.x, q.y, q.z, q.w];
const eu = (e: M.Euler) => [e.x, e.y, e.z, e.order];
const el = (m: M.Matrix3 | M.Matrix4) => Array.from(m.elements);
const rgb = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b];
const box = (b: M.Box3) => [...v3(b.min), ...v3(b.max)];
const sph = (s: M.Sphere) => [...v3(s.center), s.radius];
const pl = (p: M.Plane) => [...v3(p.normal), p.constant];
const nul = <T>(x: T | null, f: (x: T) => unknown) => (x === null ? null : f(x));

/** A camera's four matrices, from a perspective or orthographic projection and a TRS world matrix. */
function camera(lib: Lib, input: In) {
  const matrixWorld = M4(lib, input.world);
  const matrixWorldInverse = matrixWorld.clone().invert();
  const projectionMatrix = new lib.Matrix4();
  const [l, rt, t, b, n, f] = input.frustum as number[];
  if (input.ortho) projectionMatrix.makeOrthographic(l!, rt!, t!, b!, n!, f!);
  else projectionMatrix.makePerspective(l!, rt!, t!, b!, n!, f!);
  const projectionMatrixInverse = projectionMatrix.clone().invert();
  return { matrixWorld, matrixWorldInverse, projectionMatrix, projectionMatrixInverse };
}

function frustumArgs(r: Rng): number[] {
  const n = pos(r, 0.01, 5);
  const w = pos(r, 0.1, 5), h = pos(r, 0.1, 5);
  const cx = num(r, 1), cy = num(r, 1);
  return [cx - w, cx + w, cy + h, cy - h, n, n + pos(r, 1, 500)];
}

/** A fake geometry (what Box3 and Frustum read off one), over a flat position array. */
function geometry(lib: Lib, positions: number[]) {
  const attr = {
    count: positions.length / 3,
    getX: (i: number) => positions[i * 3]!,
    getY: (i: number) => positions[i * 3 + 1]!,
    getZ: (i: number) => positions[i * 3 + 2]!,
    getW: () => 1,
  };
  const g = {
    getAttribute: (name: string) => (name === "position" ? attr : undefined),
    boundingBox: null as M.Box3 | null,
    boundingSphere: null as M.Sphere | null,
    computeBoundingBox() { g.boundingBox = new lib.Box3().setFromBufferAttribute(attr); },
    computeBoundingSphere() { g.boundingSphere = new lib.Sphere().setFromPoints(points(lib, positions)); },
  };
  return g;
}

const points = (lib: Lib, flat: number[]) => Array.from({ length: flat.length / 3 }, (_, i) => new lib.Vector3(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]));

// ---- the cases

export const cases: Record<string, Case> = {
  // -- mathUtils

  "mathUtils.scalar": {
    make: (r) => ({ a: num(r, 100), b: num(r, 100), c: num(r, 100), t: num(r, 2), d: pos(r, 0, 1), l: pos(r, 0, 10) }),
    run: (lib, { a, b, c, t, d, l }) => {
      const u = lib.mathUtils;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return [
        u.clamp(c, lo, hi), u.euclideanModulo(a, b), u.mapLinear(c, a, b, 1, -3), u.inverseLerp(a, b, c), u.inverseLerp(a, a, c),
        u.lerp(a, b, t), u.damp(a, b, l, d), u.pingpong(c, l), u.pingpong(c),
        u.smoothstep(t, lo / 100, hi / 100), u.smootherstep(t, lo / 100, hi / 100),
        u.degToRad(c), u.radToDeg(c), u.DEG2RAD, u.RAD2DEG,
        u.isPowerOfTwo(Math.round(Math.abs(c))), u.ceilPowerOfTwo(Math.abs(c) + 1), u.floorPowerOfTwo(Math.abs(c) + 1),
      ];
    },
  },

  "mathUtils.seededRandom": {
    make: (r) => ({ seed: Math.floor(r() * 2 ** 32) - 2 ** 31 }),
    run: (lib, { seed }) => [lib.mathUtils.seededRandom(seed), lib.mathUtils.seededRandom(), lib.mathUtils.seededRandom(), lib.mathUtils.seededRandom()],
  },

  "mathUtils.properEuler": {
    make: (r) => ({ a: angle(r), b: angle(r), c: angle(r), order: pick(r, ["XYX", "YZY", "ZXZ", "XZX", "YXY", "ZYZ"]) }),
    run: (lib, { a, b, c, order }) => {
      const q = new lib.Quaternion();
      lib.mathUtils.setQuaternionFromProperEuler(q, a, b, c, order);
      return q4(q);
    },
  },

  "mathUtils.normalize": {
    make: (r) => ({ v: pos(r, -1, 1), raw: Math.floor(r() * 70000) - 35000 }),
    run: (lib, { v, raw }) => {
      const u = lib.mathUtils;
      const arrays = [new Float32Array(1), new Uint32Array(1), new Uint16Array(1), new Uint8Array(1), new Int32Array(1), new Int16Array(1), new Int8Array(1)];
      return arrays.flatMap((a) => [u.normalize(v, a), u.denormalize(raw, a)]);
    },
  },

  // -- Vector2

  "Vector2.ops": {
    make: (r) => ({ a: vec(r, 2), b: vec(r, 2), c: vec(r, 2), s: num(r, 3), t: num(r, 1.5), ang: angle(r), m: mat3(r), lo: pos(r, 0, 2), hi: pos(r, 2, 6) }),
    run: (lib, { a, b, c, s, t, ang, m, lo, hi }) => {
      const A = () => V2(lib, a), B = V2(lib, b), C = V2(lib, c);
      const mn = new lib.Vector2(Math.min(b[0], c[0]), Math.min(b[1], c[1])), mx = new lib.Vector2(Math.max(b[0], c[0]), Math.max(b[1], c[1]));
      return [
        v2(A().add(B)), v2(A().addScalar(s)), v2(A().addScaledVector(B, s)), v2(A().sub(B)), v2(A().multiply(B)), v2(A().multiplyScalar(s)),
        v2(A().divide(B)), v2(A().divideScalar(s)), v2(A().applyMatrix3(M3(lib, m))), v2(A().min(B)), v2(A().max(B)),
        v2(A().clamp(mn, mx)), v2(A().clampScalar(-1, 1)), v2(A().clampLength(lo, hi)), v2(A().floor()), v2(A().ceil()), v2(A().round()),
        v2(A().roundToZero()), v2(A().negate()), A().dot(B), A().cross(B), A().lengthSq(), A().length(), A().manhattanLength(),
        v2(A().normalize()), A().angle(), A().angleTo(B), A().distanceTo(B), A().distanceToSquared(B), A().manhattanDistanceTo(B),
        v2(A().setLength(s)), v2(A().lerp(B, t)), v2(new lib.Vector2().lerpVectors(B, C, t)), v2(A().rotateAround(B, ang)),
        A().equals(B), A().equals(A()), [...A()],
      ];
    },
  },

  // -- Vector3

  "Vector3.arith": {
    make: (r) => ({ a: vec(r, 3), b: vec(r, 3), c: vec(r, 3), s: num(r, 3), t: num(r, 1.5), lo: pos(r, 0, 2), hi: pos(r, 2, 6) }),
    run: (lib, { a, b, c, s, t, lo, hi }) => {
      const A = () => V3(lib, a), B = V3(lib, b), C = V3(lib, c);
      const mn = new lib.Vector3().copy(B).min(C), mx = new lib.Vector3().copy(B).max(C);
      return [
        v3(A().add(B)), v3(A().addScalar(s)), v3(A().addVectors(B, C)), v3(A().addScaledVector(B, s)), v3(A().sub(B)), v3(A().subScalar(s)),
        v3(A().subVectors(B, C)), v3(A().multiply(B)), v3(A().multiplyScalar(s)), v3(A().multiplyVectors(B, C)), v3(A().divide(B)),
        v3(A().divideScalar(s)), v3(A().min(B)), v3(A().max(B)), v3(A().clamp(mn, mx)), v3(A().clampScalar(-1, 1)), v3(A().clampLength(lo, hi)),
        v3(A().floor()), v3(A().ceil()), v3(A().round()), v3(A().roundToZero()), v3(A().negate()),
        A().dot(B), A().lengthSq(), A().length(), A().manhattanLength(), v3(A().normalize()), v3(A().setLength(s)),
        v3(A().lerp(B, t)), v3(new lib.Vector3().lerpVectors(B, C, t)), v3(A().cross(B)), v3(new lib.Vector3().crossVectors(B, C)),
        v3(A().projectOnVector(B)), v3(A().projectOnPlane(B.clone().normalize())), v3(A().reflect(B.clone().normalize())),
        A().angleTo(B), A().distanceTo(B), A().distanceToSquared(B), A().manhattanDistanceTo(B),
        v3(A().setFromSphericalCoords(s, a[1], a[2])), v3(A().setFromCylindricalCoords(s, a[1], a[2])),
        v3(A().set(b[0], b[1])), A().equals(B), A().equals(A()), [...A()], A().toArray([9, 9, 9, 9], 1),
      ];
    },
  },

  "Vector3.transform": {
    make: (r) => ({ a: vec(r, 3), m: mat4(r), m3: mat3(r), q: unitQuat(r), e: [angle(r), angle(r), angle(r)], order: order(r), axis: unitVec(r), ang: angle(r), i: Math.floor(r() * 3) }),
    run: (lib, { a, m, m3, q, e, order, axis, ang, i }) => {
      const A = () => V3(lib, a);
      const mat = M4(lib, m);
      return [
        v3(A().applyMatrix4(mat)), v3(A().applyMatrix3(M3(lib, m3))), v3(A().applyNormalMatrix(new lib.Matrix3().getNormalMatrix(mat))),
        v3(A().applyQuaternion(Q(lib, q))), v3(A().applyEuler(new lib.Euler(e[0], e[1], e[2], order))), v3(A().applyAxisAngle(V3(lib, axis), ang)),
        v3(A().transformDirection(mat)), v3(A().setFromMatrixPosition(mat)), v3(A().setFromMatrixScale(mat)), v3(A().setFromMatrixColumn(mat, i)),
        v3(A().setFromMatrix3Column(M3(lib, m3), i)), v3(A().setFromEuler(new lib.Euler(e[0], e[1], e[2], order))),
      ];
    },
  },

  "Vector3.project": {
    make: (r) => ({ a: vec(r, 3, 20), world: mat4(r), frustum: frustumArgs(r), ortho: r() < 0.3 }),
    run: (lib, input) => {
      const cam = camera(lib, input);
      const p = V3(lib, input.a).project(cam);
      return [v3(p), v3(p.clone().unproject(cam))];
    },
  },

  // -- Vector4

  "Vector4.ops": {
    make: (r) => ({ a: vec(r, 4), b: vec(r, 4), s: num(r, 3), t: num(r, 1.5), m: mat4(r), lo: pos(r, 0, 2), hi: pos(r, 2, 6) }),
    run: (lib, { a, b, s, t, m, lo, hi }) => {
      const A = () => V4(lib, a), B = V4(lib, b);
      return [
        v4(A().add(B)), v4(A().addScalar(s)), v4(A().addScaledVector(B, s)), v4(A().sub(B)), v4(A().multiply(B)), v4(A().multiplyScalar(s)),
        v4(A().divide(B)), v4(A().divideScalar(s)), v4(A().applyMatrix4(M4(lib, m))), v4(A().min(B)), v4(A().max(B)),
        v4(A().clampScalar(-1, 1)), v4(A().clampLength(lo, hi)), v4(A().floor()), v4(A().ceil()), v4(A().round()), v4(A().roundToZero()), v4(A().negate()),
        A().dot(B), A().lengthSq(), A().length(), A().manhattanLength(), v4(A().normalize()), v4(A().setLength(s)), v4(A().lerp(B, t)),
        v4(new lib.Vector4().lerpVectors(A(), B, t)), v4(A().setFromMatrixPosition(M4(lib, m))), v4(A().copy(V3(lib, b))), A().equals(B), [...A()],
      ];
    },
  },

  "Vector4.axisAngle": {
    make: (r) => {
      const k = r();
      // (0 and 180 degree turns hit the symmetric branches)
      const ang = k < 0.15 ? 0 : k < 0.35 ? Math.PI : angle(r);
      return { axis: unitVec(r), ang, q: unitQuat(r) };
    },
    run: (lib, { axis, ang, q }) => {
      const rot = new lib.Matrix4().makeRotationAxis(V3(lib, axis), ang);
      return [v4(new lib.Vector4().setAxisAngleFromRotationMatrix(rot)), v4(new lib.Vector4().setAxisAngleFromQuaternion(Q(lib, q)))];
    },
  },

  // -- Matrix3

  "Matrix3.ops": {
    make: (r) => ({ a: mat3(r), b: mat3(r), m: mat4(r), s: num(r, 3), uv: [num(r, 2), num(r, 2), num(r, 3), num(r, 3), angle(r), num(r, 1), num(r, 1)], ang: angle(r) }),
    run: (lib, { a, b, m, s, uv, ang }) => {
      const A = () => M3(lib, a), B = M3(lib, b);
      const into: number[] = [];
      A().transposeIntoArray(into);
      return [
        el(A().multiply(B)), el(A().premultiply(B)), el(A().multiplyScalar(s)), A().determinant(), el(A().invert()), el(A().transpose()),
        el(A().getNormalMatrix(M4(lib, m))), el(A().setFromMatrix4(M4(lib, m))), el(A().setUvTransform(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6])),
        el(A().scale(uv[2], uv[3])), el(A().rotate(ang)), el(A().translate(uv[0], uv[1])), el(A().makeRotation(ang)),
        el(A().makeTranslation(uv[0], uv[1])), el(A().makeTranslation(new lib.Vector2(uv[0], uv[1]))), el(A().makeScale(uv[2], uv[3])),
        into, A().equals(B), A().equals(A()), A().toArray([], 2),
        el(new lib.Matrix3(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8])),
      ];
    },
  },

  // -- Matrix4

  "Matrix4.multiply": {
    make: (r) => ({ a: mat4(r), b: mat4(r), s: num(r, 3) }),
    run: (lib, { a, b, s }) => {
      const A = () => M4(lib, a), B = M4(lib, b);
      return [el(A().multiply(B)), el(A().premultiply(B)), el(new lib.Matrix4().multiplyMatrices(B, A())), el(A().multiplyScalar(s))];
    },
  },

  "Matrix4.invert": {
    make: (r) => ({ a: mat4(r) }),
    run: (lib, { a }) => {
      const A = () => M4(lib, a);
      return [A().determinant(), el(A().invert()), el(A().transpose()), A().getMaxScaleOnAxis(), el(new lib.Matrix3().getNormalMatrix(A())), el(A().extractRotation(A()))];
    },
  },

  "Matrix4.compose": {
    make: (r) => ({ p: vec(r, 3, 50), q: unitQuat(r), s: [num(r, 4), num(r, 4), num(r, 4)], raw: mat4(r) }),
    run: (lib, { p, q, s, raw }) => {
      const m = new lib.Matrix4().compose(V3(lib, p), Q(lib, q), V3(lib, s));
      const out = (mat: M.Matrix4) => {
        const P = new lib.Vector3(), R = new lib.Quaternion(), S = new lib.Vector3();
        mat.decompose(P, R, S);
        return [v3(P), q4(R), v3(S)];
      };
      return [el(m), out(m), out(M4(lib, raw)), el(new lib.Matrix4().makeRotationFromQuaternion(Q(lib, q)))];
    },
  },

  "Matrix4.euler": {
    make: (r) => ({ e: [angle(r), angle(r), angle(r)], order: order(r) }),
    run: (lib, { e, order }) => el(new lib.Matrix4().makeRotationFromEuler(new lib.Euler(e[0], e[1], e[2], order))),
  },

  "Matrix4.make": {
    make: (r) => ({ v: vec(r, 3), axis: unitVec(r), ang: angle(r), sh: vec(r, 6, 2), b: [vec(r, 3), vec(r, 3), vec(r, 3)], m: mat4(r), m3: mat3(r) }),
    run: (lib, { v, axis, ang, sh, b, m, m3 }) => {
      const N = () => new lib.Matrix4();
      const X = new lib.Vector3(), Y = new lib.Vector3(), Z = new lib.Vector3();
      M4(lib, m).extractBasis(X, Y, Z);
      return [
        el(N().makeTranslation(v[0], v[1], v[2])), el(N().makeTranslation(V3(lib, v))), el(N().makeRotationX(ang)), el(N().makeRotationY(ang)),
        el(N().makeRotationZ(ang)), el(N().makeRotationAxis(V3(lib, axis), ang)), el(N().makeScale(v[0], v[1], v[2])),
        el(N().makeShear(sh[0], sh[1], sh[2], sh[3], sh[4], sh[5])), el(N().makeBasis(V3(lib, b[0]), V3(lib, b[1]), V3(lib, b[2]))),
        [v3(X), v3(Y), v3(Z)], el(M4(lib, m).scale(V3(lib, v))), el(M4(lib, m).setPosition(v[0], v[1], v[2])), el(M4(lib, m).setPosition(V3(lib, v))),
        el(N().setFromMatrix3(M3(lib, m3))), el(N().copyPosition(M4(lib, m))), M4(lib, m).equals(M4(lib, m)), M4(lib, m).toArray([], 1),
      ];
    },
  },

  "Matrix4.lookAt": {
    make: (r) => {
      const k = r();
      const eye = vec(r, 3, 20);
      // (degenerate: eye on target, and up along the view)
      const target = k < 0.1 ? eye.slice() : vec(r, 3, 20);
      const up = k > 0.9 ? unitVec(r) : k > 0.8 ? [0, 0, r() < 0.5 ? 1 : -1] : [0, 1, 0];
      if (k > 0.8) for (let i = 0; i < 3; i++) target[i] = eye[i]! - up[i]! * 3;
      return { eye, target, up };
    },
    run: (lib, { eye, target, up }) => el(new lib.Matrix4().lookAt(V3(lib, eye), V3(lib, target), V3(lib, up))),
  },

  "Matrix4.projection": {
    make: (r) => ({ f: frustumArgs(r), cs: r() < 0.7 ? "webgl" : "webgpu", reversed: r() < 0.2 }),
    run: (lib, { f, cs, reversed }) => {
      const sys = cs === "webgl" ? lib.WEBGL : lib.WEBGPU;
      return [
        el(new lib.Matrix4().makePerspective(f[0], f[1], f[2], f[3], f[4], f[5])),
        el(new lib.Matrix4().makePerspective(f[0], f[1], f[2], f[3], f[4], f[5], sys, reversed)),
        el(new lib.Matrix4().makeOrthographic(f[0], f[1], f[2], f[3], f[4], f[5])),
        el(new lib.Matrix4().makeOrthographic(f[0], f[1], f[2], f[3], f[4], f[5], sys, reversed)),
      ];
    },
  },

  // -- Quaternion

  "Quaternion.euler": {
    make: (r) => ({ e: [angle(r), angle(r), angle(r)], order: order(r), other: order(r) }),
    run: (lib, { e, order, other }) => {
      const E = new lib.Euler(e[0], e[1], e[2], order);
      const q = new lib.Quaternion().setFromEuler(E);
      // (round trips: Euler -> quaternion -> Euler, in its own order and in another)
      const back = new lib.Euler().setFromQuaternion(q, order);
      const re = E.clone().reorder(other);
      return [q4(q), eu(back), eu(re), eu(new lib.Euler().setFromQuaternion(q)), q4(new lib.Quaternion().setFromEuler(back))];
    },
  },

  "Quaternion.matrix": {
    make: (r) => ({ q: unitQuat(r), axis: unitVec(r), ang: angle(r), m: mat4(r) }),
    run: (lib, { q, axis, ang, m }) => {
      const rot = new lib.Matrix4().makeRotationFromQuaternion(Q(lib, q));
      const raw = M4(lib, m);
      return [
        q4(new lib.Quaternion().setFromRotationMatrix(rot)), q4(new lib.Quaternion().setFromRotationMatrix(raw)),
        q4(new lib.Quaternion().setFromAxisAngle(V3(lib, axis), ang)),
        q4(new lib.Quaternion().setFromRotationMatrix(new lib.Matrix4().makeRotationAxis(V3(lib, axis), ang))),
      ];
    },
  },

  "Quaternion.unitVectors": {
    make: (r) => {
      const a = unitVec(r);
      const k = r();
      // (opposite and equal vectors: the branch at r < 1e-8)
      const b = k < 0.15 ? a.map((x) => -x) : k < 0.25 ? a.slice() : unitVec(r);
      return { a, b };
    },
    run: (lib, { a, b }) => q4(new lib.Quaternion().setFromUnitVectors(V3(lib, a), V3(lib, b))),
  },

  "Quaternion.ops": {
    make: (r) => {
      const a = unitQuat(r);
      const k = r();
      // (near and equal quaternions: slerp's lerp branch and its early outs)
      const b = k < 0.1 ? a.slice() : k < 0.2 ? a.map((x) => x + (r() - 0.5) * 1e-9) : k < 0.3 ? a.map((x) => -x) : unitQuat(r);
      return { a, b, raw: vec(r, 4, 3), t: r() < 0.1 ? pick(r, [0, 1]) : pos(r, -0.2, 1.2), step: pos(r, 0, 2) };
    },
    run: (lib, { a, b, raw, t, step }) => {
      const A = () => Q(lib, a), B = Q(lib, b);
      const flat = [0, 0, 0, 0, 0];
      lib.Quaternion.slerpFlat(flat, 1, a, 0, [9, ...b], 1, t);
      const mul = lib.Quaternion.multiplyQuaternionsFlat([0, 0, 0, 0], 0, a, 0, b, 0);
      return [
        q4(A().multiply(B)), q4(A().premultiply(B)), q4(A().slerp(B, t)), q4(new lib.Quaternion().slerpQuaternions(A(), B, t)), flat, mul,
        A().angleTo(B), q4(A().rotateTowards(B, step)), q4(A().invert()), q4(A().conjugate()), A().dot(B),
        Q(lib, raw).lengthSq(), Q(lib, raw).length(), q4(Q(lib, raw).normalize()), q4(new lib.Quaternion(0, 0, 0, 0).normalize()),
        q4(A().identity()), A().equals(B), A().equals(A()), [...A()], A().toArray([], 1), q4(new lib.Quaternion().fromArray([7, ...raw], 1)),
      ];
    },
  },

  // -- Euler

  "Euler.matrix": {
    make: (r) => {
      const k = r();
      // (gimbal lock: a middle angle of +-pi/2, so the |m| < 0.9999999 test fails)
      const e = [angle(r), k < 0.25 ? pick(r, [Math.PI / 2, -Math.PI / 2]) : angle(r), angle(r)];
      return { e, order: order(r), read: order(r), m: mat4(r) };
    },
    run: (lib, { e, order, read, m }) => {
      const rot = new lib.Matrix4().makeRotationFromEuler(new lib.Euler(e[0], e[1], e[2], order));
      // (every order, on the same rotation, and on a raw matrix)
      return [
        ...["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"].map((o) => eu(new lib.Euler().setFromRotationMatrix(rot, o as EulerOrder))),
        eu(new lib.Euler(0, 0, 0, read).setFromRotationMatrix(M4(lib, m))),
        eu(new lib.Euler().setFromVector3(new lib.Vector3(e[0], e[1], e[2]), read)),
        new lib.Euler(e[0], e[1], e[2], order).toArray(), [...new lib.Euler(e[0], e[1], e[2], order)],
        eu(new lib.Euler().fromArray([e[0], e[1], e[2], read])), new lib.Euler(e[0], e[1], e[2], order).equals(new lib.Euler(e[0], e[1], e[2], read)),
      ];
    },
  },

  // -- Color

  "Color.hex": {
    make: (r) => ({ hex: r() < 0.1 ? pick(r, [0, 0xffffff, 0x808080, 0x010101]) : Math.floor(r() * 0x1000000) + (r() < 0.1 ? r() : 0) }),
    run: (lib, { hex }) => {
      const c = new lib.Color(hex);
      const l = new lib.Color().setHex(hex, lib.LINEAR);
      return [
        rgb(c), c.getHex(), c.getHexString(), c.getHex(lib.LINEAR), c.getHexString(lib.LINEAR), c.getStyle(), c.getStyle(lib.LINEAR),
        rgb(l), l.getHex(), l.getStyle(), c.toJSON(), rgb(c.clone().convertLinearToSRGB()), rgb(c.clone().convertSRGBToLinear()),
        rgb(new lib.Color().copySRGBToLinear(c)), rgb(new lib.Color().copyLinearToSRGB(c)), rgb(new lib.Color().setHex(hex, "")),
      ];
    },
  },

  "Color.rgb": {
    make: (r) => ({ a: [pos(r, -0.1, 1.2), pos(r, -0.1, 1.2), pos(r, -0.1, 1.2)], b: [pos(r, 0, 1), pos(r, 0, 1), pos(r, 0, 1)], t: num(r, 1.2), s: num(r, 3), m: mat3(r) }),
    run: (lib, { a, b, t, s, m }) => {
      const A = () => new lib.Color(a[0], a[1], a[2]);
      const B = new lib.Color().setRGB(b[0], b[1], b[2], "srgb");
      const target = { r: 0, g: 0, b: 0 };
      return [
        rgb(A()), rgb(B), rgb(new lib.Color().setRGB(a[0], a[1], a[2], lib.LINEAR)), rgb(A().getRGB(target, "srgb")), rgb(A().getRGB({ r: 0, g: 0, b: 0 })),
        rgb(A().add(B)), rgb(A().addColors(A(), B)), rgb(A().addScalar(s)), rgb(A().sub(B)), rgb(A().multiply(B)), rgb(A().multiplyScalar(s)),
        rgb(A().lerp(B, t)), rgb(new lib.Color().lerpColors(A(), B, t)), rgb(A().lerpHSL(B, t)), rgb(A().applyMatrix3(M3(lib, m))),
        rgb(A().setScalar(s)), rgb(A().setFromVector3(new lib.Vector3(b[0], b[1], b[2]))), A().equals(B), A().equals(A()), [...A()],
        A().getHex(), A().getStyle(), A().getHexString(), rgb(new lib.Color(B)), A().toArray([], 1),
        lib.srgbToLinear(a[0]), lib.linearToSrgb(a[1]),
      ];
    },
  },

  "Color.hsl": {
    make: (r) => ({ h: num(r, 2), s: pos(r, -0.2, 1.2), l: pos(r, -0.2, 1.2), d: vec(r, 3, 0.5), c: [pos(r, 0, 1), pos(r, 0, 1), pos(r, 0, 1)] }),
    run: (lib, { h, s, l, d, c }) => {
      const hsl = (x: M.HSL) => [x.h, x.s, x.l];
      const C = () => new lib.Color(c[0], c[1], c[2]);
      return [
        rgb(new lib.Color().setHSL(h, s, l)), rgb(new lib.Color().setHSL(h, s, l, "srgb")),
        hsl(C().getHSL({ h: 0, s: 0, l: 0 })), hsl(C().getHSL({ h: 0, s: 0, l: 0 }, "srgb")),
        rgb(C().offsetHSL(d[0], d[1], d[2])), hsl(new lib.Color().setHSL(h, s, l).getHSL({ h: 0, s: 0, l: 0 })),
        hsl(new lib.Color(c[0], c[0], c[0]).getHSL({ h: 0, s: 0, l: 0 })),
      ];
    },
  },

  "Color.style": {
    make: (r) => {
      const i = () => Math.floor(r() * 300);
      const p = () => Math.floor(r() * 120);
      const f = () => (r() * 1.5).toFixed(Math.floor(r() * 3));
      const hex = (n: number) => Math.floor(r() * 16 ** n).toString(16).padStart(n, "0");
      const names = ["red", "AliceBlue", "rebeccapurple", "darkolivegreen", "WHITE", "nosuchcolour", "transparent"];
      const forms = [
        () => `rgb(${i()},${i()},${i()})`, () => `rgba( ${i()} , ${i()},${i()}, ${f()} )`, () => `rgb(${p()}%,${p()}%,${p()}%)`,
        () => `rgba(${p()}%, ${p()}%, ${p()}%, ${f()})`, () => `hsl(${(r() * 720).toFixed(1)},${p()}%,${p()}%)`,
        () => `hsla(${i()}, ${(r() * 100).toFixed(2)}%, ${p()}%, ${f()})`, () => `#${hex(3)}`, () => `#${hex(6)}`, () => `#${hex(6).toUpperCase()}`,
        () => `#${hex(4)}`, () => pick(r, names), () => `cmyk(1,2,3)`, () => `rgb(1,2)`,
      ];
      return { style: pick(r, forms)(), cs: r() < 0.3 ? "linear" : "srgb" };
    },
    run: (lib, { style, cs }) => {
      // (r180 warns on bad styles: hush it while the case runs)
      const warn = console.warn;
      console.warn = () => {};
      try {
        const space = cs === "linear" ? lib.LINEAR : "srgb";
        return [rgb(new lib.Color(style)), rgb(new lib.Color().setStyle(style, space)), rgb(new lib.Color().setColorName(style))];
      } finally {
        console.warn = warn;
      }
    },
  },

  "Color.management": {
    make: (r) => ({ c: [pos(r, -0.1, 1.2), pos(r, -0.1, 1.2), pos(r, -0.1, 1.2)], hex: Math.floor(r() * 0x1000000) }),
    run: (lib, { c, hex }) => {
      const cm = lib.colorManagement;
      const C = () => new lib.Color(c[0], c[1], c[2]);
      const lum = new lib.Vector3();
      cm.getLuminanceCoefficients(lum);
      const out: unknown[] = [
        rgb(cm.convert(C(), "srgb", lib.LINEAR)), rgb(cm.convert(C(), lib.LINEAR, "srgb")), rgb(cm.convert(C(), "srgb", "")),
        rgb(cm.workingToColorSpace(C(), "srgb")), rgb(cm.colorSpaceToWorking(C(), "srgb")), cm.getTransfer("srgb"), cm.getTransfer(lib.LINEAR),
        cm.getTransfer(""), cm.getPrimaries("srgb"), v3(lum), el(cm._getMatrix(new lib.Matrix3(), "srgb", lib.LINEAR)),
        cm._getDrawingBufferColorSpace(lib.LINEAR) === "srgb", cm._getUnpackColorSpace() === "srgb", cm.getToneMappingMode("srgb"),
      ];
      // (with colour management off, nothing converts)
      cm.enabled = false;
      try {
        out.push(rgb(new lib.Color(hex)), new lib.Color(c[0], c[1], c[2]).getHex(), rgb(new lib.Color().setHSL(c[0], c[1], c[2], "srgb")));
      } finally {
        cm.enabled = true;
      }
      return out;
    },
  },

  // -- Box3

  "Box3.ops": {
    make: (r) => {
      const n = 1 + Math.floor(r() * 8);
      return {
        pts: vec(r, n * 3, 10), pts2: vec(r, 6, 10), p: vec(r, 3, 12), s: num(r, 2), m: mat4(r), center: vec(r, 3), size: vec(r, 3, 5).map(Math.abs),
        sphere: [...vec(r, 3, 10), pos(r, -1, 6)], plane: [...unitVec(r), num(r, 8)], tri: vec(r, 9, 10),
      };
    },
    run: (lib, { pts, pts2, p, s, m, center, size, sphere, plane, tri }) => {
      const A = () => new lib.Box3().setFromPoints(points(lib, pts));
      const B = new lib.Box3().setFromArray(pts2);
      const P = V3(lib, p);
      const S = new lib.Sphere(V3(lib, sphere), sphere[3]);
      const PL = new lib.Plane(V3(lib, plane), plane[3]);
      const T = { a: V3(lib, tri.slice(0, 3)), b: V3(lib, tri.slice(3, 6)), c: V3(lib, tri.slice(6, 9)) };
      const E = new lib.Box3();
      return [
        box(A()), box(B), box(new lib.Box3().setFromCenterAndSize(V3(lib, center), V3(lib, size))), box(A().applyMatrix4(M4(lib, m))),
        box(A().union(B)), box(A().intersect(B)), A().isEmpty(), E.isEmpty(), box(E.clone().applyMatrix4(M4(lib, m))),
        v3(A().getCenter(new lib.Vector3())), v3(A().getSize(new lib.Vector3())), v3(E.getCenter(new lib.Vector3(1, 1, 1))),
        box(A().expandByPoint(P)), box(A().expandByVector(P)), box(A().expandByScalar(s)), A().containsPoint(P), A().containsBox(B),
        v3(A().getParameter(P, new lib.Vector3())), A().intersectsBox(B), A().intersectsSphere(S), A().intersectsPlane(PL),
        A().intersectsTriangle(T), E.intersectsTriangle(T), v3(A().clampPoint(P, new lib.Vector3())), A().distanceToPoint(P),
        sph(A().getBoundingSphere(new lib.Sphere())), sph(E.getBoundingSphere(new lib.Sphere())), box(A().translate(P)), A().equals(A()), A().toJSON(),
      ];
    },
  },

  "Box3.object": {
    make: (r) => ({ a: vec(r, 3 * (1 + Math.floor(r() * 6)), 5), b: vec(r, 3 * (1 + Math.floor(r() * 6)), 5), wa: mat4(r), wb: mat4(r), own: r() < 0.3 }),
    run: (lib, { a, b, wa, wb, own }) => {
      // (a two-node tree: a parent with a geometry, a child with another; the matrices are world matrices)
      let updates = 0;
      const node = (positions: number[], world: In, children: unknown[], ownBox: boolean) => {
        const g = geometry(lib, positions);
        const n: Record<string, unknown> = {
          updateWorldMatrix: () => { updates++; },
          matrixWorld: M4(lib, world),
          geometry: g,
          children,
        };
        if (ownBox) {
          n["boundingBox"] = null;
          n["computeBoundingBox"] = () => { n["boundingBox"] = new lib.Box3().setFromBufferAttribute(g.getAttribute("position")!).expandByScalar(0.25); };
        }
        return n;
      };
      const child = node(b, wb, [], false);
      const root = node(a, wa, [child], own);
      const loose = new lib.Box3().setFromObject(root as unknown as M.BoundsSource);
      const precise = new lib.Box3().setFromObject(root as unknown as M.BoundsSource, true);
      return [box(loose), box(precise), updates];
    },
  },

  // -- Sphere

  "Sphere.ops": {
    make: (r) => {
      const n = 1 + Math.floor(r() * 8);
      return { pts: vec(r, n * 3, 10), c: vec(r, 3), rad: r() < 0.1 ? -1 : pos(r, 0, 8), o: [...vec(r, 3), r() < 0.1 ? -1 : pos(r, 0, 8)], p: vec(r, 3, 15), m: mat4(r), plane: [...unitVec(r), num(r, 8)], box: vec(r, 6, 10), useCenter: r() < 0.3 };
    },
    run: (lib, { pts, c, rad, o, p, m, plane, box: bx, useCenter }) => {
      const A = () => new lib.Sphere(V3(lib, c), rad);
      const O = () => new lib.Sphere(V3(lib, o), o[3]);
      const P = V3(lib, p);
      const B = new lib.Box3().setFromArray(bx);
      return [
        sph(new lib.Sphere().setFromPoints(points(lib, pts), useCenter ? V3(lib, c) : undefined)), A().isEmpty(), A().containsPoint(P), A().distanceToPoint(P),
        A().intersectsSphere(O()), A().intersectsBox(B), A().intersectsPlane(new lib.Plane(V3(lib, plane), plane[3])),
        v3(A().clampPoint(P, new lib.Vector3())), box(A().getBoundingBox(new lib.Box3())), sph(A().applyMatrix4(M4(lib, m))), sph(A().translate(P)),
        sph(A().expandByPoint(P)), sph(A().union(O())), sph(O().union(A())), sph(A().union(A())), A().equals(O()), A().toJSON(), sph(A().makeEmpty()),
      ];
    },
  },

  // -- Plane

  "Plane.ops": {
    make: (r) => ({ n: vec(r, 3, 3), c: num(r, 8), pts: vec(r, 9, 10), p: vec(r, 3, 15), m: mat4(r), sphere: [...vec(r, 3, 10), pos(r, 0, 6)], line: vec(r, 6, 15), box: vec(r, 6, 10) }),
    run: (lib, { n, c, pts, p, m, sphere, line, box: bx }) => {
      const A = () => new lib.Plane(V3(lib, n), c).normalize();
      const P = V3(lib, p);
      const mat = M4(lib, m);
      const start = V3(lib, line.slice(0, 3)), end = V3(lib, line.slice(3, 6));
      const L = { start, end, delta: (t: M.Vector3) => t.subVectors(end, start) };
      // (a segment lying in the plane, for intersectLine's parallel branch)
      const onPlane = A().coplanarPoint(new lib.Vector3());
      const flat = { start: onPlane, end: onPlane, delta: (t: M.Vector3) => t.set(0, 0, 0) };
      const S = new lib.Sphere(V3(lib, sphere), sphere[3]);
      return [
        pl(A()), pl(new lib.Plane(V3(lib, n), c)), pl(new lib.Plane().setFromCoplanarPoints(V3(lib, pts.slice(0, 3)), V3(lib, pts.slice(3, 6)), V3(lib, pts.slice(6, 9)))),
        pl(new lib.Plane().setFromNormalAndCoplanarPoint(V3(lib, n), P)), pl(new lib.Plane().setComponents(n[0], n[1], n[2], c)), pl(A().negate()),
        A().distanceToPoint(P), A().distanceToSphere(S), v3(A().projectPoint(P, new lib.Vector3())), v3(A().coplanarPoint(new lib.Vector3())),
        pl(A().applyMatrix4(mat)), pl(A().applyMatrix4(mat, new lib.Matrix3().getNormalMatrix(mat))), pl(A().translate(P)),
        nul(A().intersectLine(L, new lib.Vector3()), v3), nul(A().intersectLine(flat, new lib.Vector3()), v3), A().intersectsLine(L),
        A().intersectsBox(new lib.Box3().setFromArray(bx)), A().intersectsSphere(S), A().equals(A()),
      ];
    },
  },

  // -- Frustum

  "Frustum.ops": {
    make: (r) => ({ world: mat4(r), frustum: frustumArgs(r), ortho: r() < 0.3, cs: r() < 0.7 ? "webgl" : "webgpu", reversed: r() < 0.15, p: vec(r, 3, 60), sphere: [...vec(r, 3, 60), pos(r, 0, 20)], box: vec(r, 6, 60), obj: mat4(r), own: r() < 0.3, center: [pos(r, 0, 1), pos(r, 0, 1)] }),
    run: (lib, input) => {
      const cam = camera(lib, input);
      const sys = input.cs === "webgl" ? lib.WEBGL : lib.WEBGPU;
      const viewProj = new lib.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const F = new lib.Frustum().setFromProjectionMatrix(viewProj, sys, input.reversed);
      const G = new lib.Frustum().setFromProjectionMatrix(viewProj);
      const S = new lib.Sphere(V3(lib, input.sphere), input.sphere[3]);
      const geo = geometry(lib, input.box);
      const obj: Record<string, unknown> = { matrixWorld: M4(lib, input.obj), geometry: geo };
      if (input.own) {
        obj["boundingSphere"] = null;
        obj["computeBoundingSphere"] = () => { obj["boundingSphere"] = new lib.Sphere(new lib.Vector3(1, 2, 3), 4); };
      }
      const sprite = { matrixWorld: M4(lib, input.obj), center: new lib.Vector2(input.center[0], input.center[1]) };
      return [
        F.planes.map(pl), G.planes.map(pl), F.intersectsSphere(S), F.intersectsBox(new lib.Box3().setFromArray(input.box)), F.containsPoint(V3(lib, input.p)),
        F.intersectsObject(obj as unknown as M.CullObject), F.intersectsSprite(sprite), F.clone().planes.map(pl),
      ];
    },
  },

  // -- Ray

  "Ray.ops": {
    make: (r) => ({
      o: vec(r, 3, 10), d: r() < 0.08 ? pick(r, [[1, 0, 0], [0, -1, 0], [0, 0, 1]]) : unitVec(r), p: vec(r, 3, 10), t: num(r, 10), seg: vec(r, 6, 10),
      sphere: [...vec(r, 3, 10), r() < 0.1 ? -1 : pos(r, 0, 6)], plane: [...unitVec(r), num(r, 8)], box: vec(r, 6, 10), tri: vec(r, 9, 10), m: mat4(r), cull: r() < 0.5,
    }),
    run: (lib, { o, d, p, t, seg, sphere, plane, box: bx, tri, m, cull }) => {
      const A = () => new lib.Ray(V3(lib, o), V3(lib, d));
      const P = V3(lib, p);
      const S = new lib.Sphere(V3(lib, sphere), sphere[3]);
      const PL = new lib.Plane(V3(lib, plane), plane[3]);
      const B = new lib.Box3().setFromArray(bx);
      // (the parallel plane, for distanceToPlane's zero denominator)
      const par = new lib.Plane().setFromNormalAndCoplanarPoint(new lib.Vector3(d[1], -d[0], 0).normalize(), V3(lib, o));
      const apart = par.clone();
      apart.constant += 1;
      // (a segment along the ray: distanceSqToSegment's parallel branch)
      const along = A().distanceSqToSegment(V3(lib, seg.slice(0, 3)), V3(lib, seg.slice(0, 3)).addScaledVector(V3(lib, d), t));
      const onRay = new lib.Vector3(), onSeg = new lib.Vector3();
      const sq = A().distanceSqToSegment(V3(lib, seg.slice(0, 3)), V3(lib, seg.slice(3, 6)), onRay, onSeg);
      const [ta, tb, tc] = [V3(lib, tri.slice(0, 3)), V3(lib, tri.slice(3, 6)), V3(lib, tri.slice(6, 9))];
      // (a triangle the ray surely crosses)
      const hitA = A().at(5, new lib.Vector3()).add(new lib.Vector3(1, 0, 0)), hitB = A().at(5, new lib.Vector3()).add(new lib.Vector3(-1, 1, 0)), hitC = A().at(5, new lib.Vector3()).add(new lib.Vector3(0, -1, 1));
      return [
        v3(A().at(t, new lib.Vector3())), v3(A().recast(t).origin), v3(A().lookAt(P).direction), v3(A().closestPointToPoint(P, new lib.Vector3())),
        A().distanceToPoint(P), A().distanceSqToPoint(P), sq, v3(onRay), v3(onSeg), nul(A().intersectSphere(S, new lib.Vector3()), v3), A().intersectsSphere(S),
        A().distanceToPlane(PL), A().distanceToPlane(par), A().distanceToPlane(apart), A().intersectsPlane(par), along, nul(A().intersectPlane(PL, new lib.Vector3()), v3), A().intersectsPlane(PL),
        nul(A().intersectBox(B, new lib.Vector3()), v3), A().intersectsBox(B), nul(A().intersectTriangle(ta, tb, tc, cull, new lib.Vector3()), v3),
        nul(A().intersectTriangle(hitA, hitB, hitC, cull, new lib.Vector3()), v3), nul(A().intersectTriangle(hitA, hitC, hitB, cull, new lib.Vector3()), v3),
        ((ray) => [...v3(ray.origin), ...v3(ray.direction)])(A().applyMatrix4(M4(lib, m))), A().equals(A()),
      ];
    },
  },
};

// ---- the fixture file's number encoding

// (JSON keeps a double's exact bits through its shortest round-trip text, but
// not -0, NaN or the infinities: those go as tagged strings)
export function encode(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v !== "number") return v;
    if (Object.is(v, -0)) return { $: "-0" };
    if (Number.isNaN(v)) return { $: "NaN" };
    if (v === Infinity) return { $: "Infinity" };
    if (v === -Infinity) return { $: "-Infinity" };
    return v;
  });
}

export function decode(text: string): unknown {
  return JSON.parse(text, (_k, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && "$" in v && Object.keys(v).length === 1) {
      return Number((v as { $: string }).$);
    }
    return v;
  });
}
