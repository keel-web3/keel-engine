// Ported from Three.js r180's math/MathUtils.js (MIT, see packages/lit/NOTICE).

// r180's random helpers call Math.random. Here they draw from a stream of
// their own (r180's seededRandom algorithm, with a separate state, so calls to
// seededRandom keep r180's sequence), which reseedRandom restarts. A piece that
// needs the same numbers twice gets them.
let _stream = 0x2f6b9a1d;
function random(): number {
  let t = (_stream += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Restart the stream behind generateUUID, randInt, randFloat and the vectors' random(). */
function reseedRandom(seed: number): void {
  _stream = seed | 0;
}

const _lut: readonly string[] = Array.from({ length: 256 }, (_, i) => (i < 16 ? "0" : "") + i.toString(16));

let _seed = 1234567;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function generateUUID(): string {
  const d0 = (random() * 0xffffffff) | 0;
  const d1 = (random() * 0xffffffff) | 0;
  const d2 = (random() * 0xffffffff) | 0;
  const d3 = (random() * 0xffffffff) | 0;
  const uuid =
    _lut[d0 & 0xff]! + _lut[(d0 >> 8) & 0xff]! + _lut[(d0 >> 16) & 0xff]! + _lut[(d0 >> 24) & 0xff]! + "-" +
    _lut[d1 & 0xff]! + _lut[(d1 >> 8) & 0xff]! + "-" + _lut[((d1 >> 16) & 0x0f) | 0x40]! + _lut[(d1 >> 24) & 0xff]! + "-" +
    _lut[(d2 & 0x3f) | 0x80]! + _lut[(d2 >> 8) & 0xff]! + "-" + _lut[(d2 >> 16) & 0xff]! + _lut[(d2 >> 24) & 0xff]! +
    _lut[d3 & 0xff]! + _lut[(d3 >> 8) & 0xff]! + _lut[(d3 >> 16) & 0xff]! + _lut[(d3 >> 24) & 0xff]!;
  return uuid.toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function euclideanModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number {
  return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
}

function inverseLerp(x: number, y: number, value: number): number {
  if (x !== y) {
    return (value - x) / (y - x);
  } else {
    return 0;
  }
}

function lerp(x: number, y: number, t: number): number {
  return (1 - t) * x + t * y;
}

function damp(x: number, y: number, lambda: number, dt: number): number {
  return lerp(x, y, 1 - Math.exp(-lambda * dt));
}

function pingpong(x: number, length = 1): number {
  return length - Math.abs(euclideanModulo(x, length * 2) - length);
}

function smoothstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  x = (x - min) / (max - min);
  return x * x * (3 - 2 * x);
}

function smootherstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  x = (x - min) / (max - min);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function randInt(low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

function randFloat(low: number, high: number): number {
  return low + random() * (high - low);
}

function randFloatSpread(range: number): number {
  return range * (0.5 - random());
}

// Mulberry32, as r180 (its own module-wide seed).
function seededRandom(s?: number): number {
  if (s !== undefined) _seed = s;
  let t = (_seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function degToRad(degrees: number): number {
  return degrees * DEG2RAD;
}

function radToDeg(radians: number): number {
  return radians * RAD2DEG;
}

function isPowerOfTwo(value: number): boolean {
  return (value & (value - 1)) === 0 && value !== 0;
}

function ceilPowerOfTwo(value: number): number {
  return Math.pow(2, Math.ceil(Math.log(value) / Math.LN2));
}

function floorPowerOfTwo(value: number): number {
  return Math.pow(2, Math.floor(Math.log(value) / Math.LN2));
}

/** What setQuaternionFromProperEuler writes into (a Quaternion fits). */
interface QuaternionSink {
  set(x: number, y: number, z: number, w: number): unknown;
}

function setQuaternionFromProperEuler(q: QuaternionSink, a: number, b: number, c: number, order: string): void {
  const cos = Math.cos;
  const sin = Math.sin;

  const c2 = cos(b / 2);
  const s2 = sin(b / 2);

  const c13 = cos((a + c) / 2);
  const s13 = sin((a + c) / 2);

  const c1_3 = cos((a - c) / 2);
  const s1_3 = sin((a - c) / 2);

  const c3_1 = cos((c - a) / 2);
  const s3_1 = sin((c - a) / 2);

  switch (order) {
    case "XYX":
      q.set(c2 * s13, s2 * c1_3, s2 * s1_3, c2 * c13);
      break;
    case "YZY":
      q.set(s2 * s1_3, c2 * s13, s2 * c1_3, c2 * c13);
      break;
    case "ZXZ":
      q.set(s2 * c1_3, s2 * s1_3, c2 * s13, c2 * c13);
      break;
    case "XZX":
      q.set(c2 * s13, s2 * s3_1, s2 * c3_1, c2 * c13);
      break;
    case "YXY":
      q.set(s2 * c3_1, c2 * s13, s2 * s3_1, c2 * c13);
      break;
    case "ZYZ":
      q.set(s2 * s3_1, s2 * c3_1, c2 * s13, c2 * c13);
      break;
    default:
      console.warn("keel/lit mathUtils: setQuaternionFromProperEuler() met an unknown order: " + order);
  }
}

type ComponentArray = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array;

function denormalize(value: number, array: ComponentArray): number {
  switch (array.constructor) {
    case Float32Array:
      return value;
    case Uint32Array:
      return value / 4294967295.0;
    case Uint16Array:
      return value / 65535.0;
    case Uint8Array:
      return value / 255.0;
    case Int32Array:
      return Math.max(value / 2147483647.0, -1.0);
    case Int16Array:
      return Math.max(value / 32767.0, -1.0);
    case Int8Array:
      return Math.max(value / 127.0, -1.0);
    default:
      throw new Error("Invalid component type.");
  }
}

function normalize(value: number, array: ComponentArray): number {
  switch (array.constructor) {
    case Float32Array:
      return value;
    case Uint32Array:
      return Math.round(value * 4294967295.0);
    case Uint16Array:
      return Math.round(value * 65535.0);
    case Uint8Array:
      return Math.round(value * 255.0);
    case Int32Array:
      return Math.round(value * 2147483647.0);
    case Int16Array:
      return Math.round(value * 32767.0);
    case Int8Array:
      return Math.round(value * 127.0);
    default:
      throw new Error("Invalid component type.");
  }
}

export const mathUtils = {
  DEG2RAD,
  RAD2DEG,
  generateUUID,
  clamp,
  euclideanModulo,
  mapLinear,
  inverseLerp,
  lerp,
  damp,
  pingpong,
  smoothstep,
  smootherstep,
  randInt,
  randFloat,
  randFloatSpread,
  seededRandom,
  degToRad,
  radToDeg,
  isPowerOfTwo,
  ceilPowerOfTwo,
  floorPowerOfTwo,
  setQuaternionFromProperEuler,
  normalize,
  denormalize,
  reseedRandom,
};

export {
  DEG2RAD,
  RAD2DEG,
  generateUUID,
  clamp,
  euclideanModulo,
  mapLinear,
  inverseLerp,
  lerp,
  damp,
  pingpong,
  smoothstep,
  smootherstep,
  randInt,
  randFloat,
  randFloatSpread,
  seededRandom,
  degToRad,
  radToDeg,
  isPowerOfTwo,
  ceilPowerOfTwo,
  floorPowerOfTwo,
  setQuaternionFromProperEuler,
  normalize,
  denormalize,
  random,
  reseedRandom,
};
