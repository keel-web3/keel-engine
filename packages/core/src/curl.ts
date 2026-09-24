// Curl noise: a divergence-free flow field, so particles carried by it swirl round each other in eddies instead
// of jittering apart or bunching up (Bridson et al., "Curl-Noise for Procedural Fluid Flow"). The field is
// ∇n1 × ∇n2 -- the curl of n1∇n2 -- for two 3D value noises with analytic gradients (quintic, so the gradient is
// smooth), two octaves. Presentation only: the pool draws with it, nothing is simulated or stored from it, so it
// uses plain Math (presentation: see core/test/sim-math.test.ts). CURL_GLSL is the same field in GLSL, to the
// float -- the particle pool's VS and bake's volume smoke draw with it.
//
// Time moves the field by sliding its domain round a circle (FLOW_PERIOD seconds a lap), so it flows without a
// seam wherever a renderer's clock wraps: pass time modulo FLOW_PERIOD.

/** Seconds the field's flow takes to come round again (renderers pass time modulo this). */
export const FLOW_PERIOD = 4096;
const FLOW_SPEED = 0.35; // domain units a second
const FLOW_R = (FLOW_PERIOD * FLOW_SPEED) / (2 * Math.PI);

// (Doubles travel through typed arrays, never as arguments or results: the pool calls this every step, and
// V8 boxes a double crossing a call it doesn't inline -- see pool.ts. Lattice coordinates are small integers.)
const W = new Float64Array(8); // 0..2 a noise's sample point, 4..7 its value and gradient

// A lattice point's value in -1..1 (a lowbias32-style integer hash, the GLSL's uint twin).
function lat(x: number, y: number, z: number, s: number): number {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ s) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 2147483647.5 - 1;
}

// Value noise and its gradient at W[0..2], into W[4] (value), W[5..7] (gradient).
function noised(s: number): void {
  const x = W[0]!, y = W[1]!, z = W[2]!;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const dx = 30 * fx * fx * (fx * (fx - 2) + 1), dy = 30 * fy * fy * (fy * (fy - 2) + 1), dz = 30 * fz * fz * (fz * (fz - 2) + 1);
  const a = lat(ix, iy, iz, s), b = lat(ix + 1, iy, iz, s), c = lat(ix, iy + 1, iz, s), d = lat(ix + 1, iy + 1, iz, s);
  const e = lat(ix, iy, iz + 1, s), f = lat(ix + 1, iy, iz + 1, s), g = lat(ix, iy + 1, iz + 1, s), h = lat(ix + 1, iy + 1, iz + 1, s);
  const k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f, k7 = -a + b + c - d + e - f - g + h;
  W[4] = a + k1 * ux + k2 * uy + k3 * uz + k4 * ux * uy + k5 * uy * uz + k6 * uz * ux + k7 * ux * uy * uz;
  W[5] = dx * (k1 + k4 * uy + k6 * uz + k7 * uy * uz);
  W[6] = dy * (k2 + k5 * uz + k4 * ux + k7 * uz * ux);
  W[7] = dz * (k3 + k6 * ux + k5 * uy + k7 * ux * uy);
}

/** curlNoise over a typed array: (x, y, z, t) at A[i..i+3], the field into A[o..o+2]. (The pool's own call.) */
export function curlCore(A: Float64Array, i: number, o: number): void {
  const t = A[i + 3]!;
  const th = (t / FLOW_PERIOD) * 2 * Math.PI;
  const x = A[i]! + FLOW_R * Math.cos(th), y = A[i + 1]!, z = A[i + 2]! + FLOW_R * Math.sin(th);
  let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
  for (let k = 0, f = 1, w = 1; k < 2; k += 1, f *= 2.03, w *= 0.5) {
    W[0] = x * f; W[1] = y * f; W[2] = z * f;
    noised(0x2545f491 + k);
    ax += W[5]! * f * w; ay += W[6]! * f * w; az += W[7]! * f * w;
    W[0] = x * f + 31.4; W[1] = y * f + 17.7; W[2] = z * f + 5.9;
    noised(0x68e31da4 + k);
    bx += W[5]! * f * w; by += W[6]! * f * w; bz += W[7]! * f * w;
  }
  // (∇n1 × ∇n2 runs to about 4 at its strongest: brought to about 1.)
  A[o] = (ay * bz - az * by) * 0.25;
  A[o + 1] = (az * bx - ax * bz) * 0.25;
  A[o + 2] = (ax * by - ay * bx) * 0.25;
}

const IO = new Float64Array(7);
/**
 * The curl field at (x, y, z) (in the field's own units: scale positions first) and time t (seconds, modulo
 * FLOW_PERIOD), into out[o..o+2]. Each component is roughly -1..1.
 */
export function curlNoise(x: number, y: number, z: number, t: number, out: Float64Array | number[], o = 0): void {
  IO[0] = x; IO[1] = y; IO[2] = z; IO[3] = t;
  curlCore(IO, 0, 4);
  out[o] = IO[4]!; out[o + 1] = IO[5]!; out[o + 2] = IO[6]!;
}

/**
 * curlNoise in GLSL ES 3.00: `vec3 curlNoise(vec3 p, float t)`, and `curlNoiseN(p, t, octaves)` -- one octave
 * for a caller that samples it per pixel and only wants the big eddies.
 */
export const CURL_GLSL = `
float curlLat(ivec3 i, uint s) {
  uint h = (uint(i.x) * 0x8da6b343u) ^ (uint(i.y) * 0xd8163841u) ^ (uint(i.z) * 0xcb1ab31fu) ^ s;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h) / 2147483647.5 - 1.0;
}
vec3 curlGrad(vec3 x, uint s) {
  vec3 fi = floor(x); ivec3 i = ivec3(fi); vec3 f = x - fi;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = curlLat(i, s), b = curlLat(i + ivec3(1, 0, 0), s), c = curlLat(i + ivec3(0, 1, 0), s), d = curlLat(i + ivec3(1, 1, 0), s);
  float e = curlLat(i + ivec3(0, 0, 1), s), ff = curlLat(i + ivec3(1, 0, 1), s), g = curlLat(i + ivec3(0, 1, 1), s), h = curlLat(i + ivec3(1, 1, 1), s);
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + ff, k7 = -a + b + c - d + e - ff - g + h;
  return du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
}
vec3 curlNoiseN(vec3 p, float t, int octaves) {
  float th = t / ${FLOW_PERIOD.toFixed(1)} * 6.283185307;
  p += vec3(${FLOW_R.toFixed(4)} * cos(th), 0.0, ${FLOW_R.toFixed(4)} * sin(th));
  vec3 a = vec3(0.0), b = vec3(0.0);
  float f = 1.0, w = 1.0;
  for (int k = 0; k < 2; k++) {
    if (k >= octaves) break;
    a += curlGrad(p * f, 0x2545f491u + uint(k)) * f * w;
    b += curlGrad(p * f + vec3(31.4, 17.7, 5.9), 0x68e31da4u + uint(k)) * f * w;
    f *= 2.03; w *= 0.5;
  }
  return cross(a, b) * 0.25;
}
vec3 curlNoise(vec3 p, float t) { return curlNoiseN(p, t, 2); }`;
