// Deterministic math: the transcendental functions the simulation and the
// generators use, the same to the last bit on every JavaScript engine and
// every CPU.
//
// WHY. `Math.sin` and friends are not specified to the bit: ECMAScript leaves
// them "implementation-approximated". V8 ships fdlibm for them, but compiles
// it with the platform's C compiler, and on arm64 that compiler fuses a*b+c
// into one FMA instruction (clang's -ffp-contract=on, GCC's =fast), which
// rounds once instead of twice. So the SAME Node version gives different bits
// for sin, cos, tan, atan2, log, asin, acos... on an arm64 Mac, an arm64 Linux
// box and an x64 machine (the diagnostic that proved it: docs/CONVENTIONS.md,
// "Deterministic math"). Firefox and Safari use other libraries again. One ulp
// is enough: a body's facing drifts, a replay forks, a lockstep peer desyncs,
// a recipe rebuilds a different unit.
//
// WHAT. Plain-JavaScript ports of Sun's fdlibm 5.3 (the uClibc copy SDL3
// vendors: k_sin, k_cos, k_tan, e_rem_pio2, k_rem_pio2, s_atan, e_atan2,
// e_exp, e_log, e_log10, e_pow, s_scalbn), made of + - * / and bit moves on
// IEEE doubles only. JavaScript never fuses, never reassociates and rounds
// every operation to double, so each function below is one fixed sequence of
// correctly rounded operations: the same result everywhere. Math.sqrt,
// Math.abs, floor, min, max, sign, round, fround and imul are exact by the
// spec and stay native.
//
// The bits are pinned: test/dmath.test.ts checks every function against a
// table made by the fdlibm C sources compiled with -ffp-contract=off (the
// reference fdlibm), and CI runs that table on x64 Linux. On x64 these ARE
// what V8's own Math functions return (V8 is fdlibm, and x64 has no FMA to
// fuse); an arm64 Mac's Math.sin differs from them in about 1 call in 150.
//
// dhypot is V8's own Math.hypot algorithm (normalise by the largest, Kahan-sum
// the squares, sqrt, rescale): exact IEEE operations, so V8's Math.hypot is
// already the same on every CPU -- but not on other engines, so it is here.
// dasin, dacos and dlog2 are built from the ports above.
//
// RULE (docs/CONVENTIONS.md): simulation and generation -- anything stored,
// compared, replayed or hashed, anything that decides WHICH unit or shape --
// use these. Presentation (a sprite's screen position, a shader, a particle's
// sparkle) may use Math.

// ---------------------------------------------------------------- words

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
F64[0] = 1;
/** Index of the high (sign, exponent, top of mantissa) word: 1 on little-endian. */
const HI = U32[1] === 0x3ff00000 ? 1 : 0;
const LO = 1 - HI;

/** The high word, signed (C's int32_t). */
const hiWord = (x: number): number => { F64[0] = x; return U32[HI]! | 0; };
/** The low word, unsigned (C's u_int32_t). */
const loWord = (x: number): number => { F64[0] = x; return U32[LO]!; };
const fromWords = (hi: number, lo: number): number => { U32[HI] = hi; U32[LO] = lo; return F64[0]!; };
const withHi = (x: number, hi: number): number => { F64[0] = x; U32[HI] = hi; return F64[0]!; };
const withLo = (x: number, lo: number): number => { F64[0] = x; U32[LO] = lo; return F64[0]!; };
const copysign = (x: number, y: number): number => withHi(x, (hiWord(x) & 0x7fffffff) | (hiWord(y) & 0x80000000));

// ---------------------------------------------------------------- scalbn

const TWO54 = 1.80143985094819840000e+16;
const TWOM54 = 5.55111512312578270212e-17;
const HUGE = 1.0e+300;
const TINY = 1.0e-300;

/** x * 2^n, exactly (s_scalbn.c). */
export function dscalbn(x: number, n: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = (hx & 0x7ff00000) >> 20;
  if (k === 0) {
    if ((lx | (hx & 0x7fffffff)) === 0) return x;
    x *= TWO54;
    hx = hiWord(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
  }
  if (k === 0x7ff) return x + x;
  k = k + n;
  if (k > 0x7fe) return HUGE * copysign(HUGE, x);
  if (n < -50000) return TINY * copysign(TINY, x);
  if (k > 0) return withHi(x, (hx & 0x800fffff) | (k << 20));
  if (k <= -54) {
    if (n > 50000) return HUGE * copysign(HUGE, x);
    return TINY * copysign(TINY, x);
  }
  k += 54;
  return withHi(x, (hx & 0x800fffff) | (k << 20)) * TWOM54;
}

// ---------------------------------------------------------------- kernels (|x| <= pi/4)

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;

/** sin(x + y), |x| <= pi/4, y the tail of x; iy 0 when y is 0 (k_sin.c). */
function kSin(x: number, y: number, iy: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return x; // |x| < 2^-27
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

/** cos(x + y), |x| <= pi/4 (k_cos.c). */
function kCos(x: number, y: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1; // |x| < 2^-27
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y)); // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0); // x/4
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const PIO4 = 7.85398163397448278999e-01;
const PIO4LO = 3.06161699786838301793e-17;
const T = [
  3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02, 2.18694882948595424599e-02,
  8.86323982359930005737e-03, 3.59207910759131235356e-03, 1.45620945432529025516e-03, 5.88041240820264096874e-04,
  2.46463134818469906812e-04, 7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05,
  2.59073051863633712884e-05,
] as const;

/** tan(x + y) (iy 1) or -1/tan (iy -1), |x| <= pi/4 (k_tan.c). */
function kTan(x: number, y: number, iy: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000) { // |x| < 2^-28
    if (((ix | loWord(x)) | (iy + 1)) === 0) return 1 / Math.abs(x);
    return iy === 1 ? x : -1 / x;
  }
  if (ix >= 0x3fe59428) { // |x| >= 0.6744
    if (hx < 0) { x = -x; y = -y; }
    const z0 = PIO4 - x;
    const w0 = PIO4LO - y;
    x = z0 + w0;
    y = 0;
  }
  let z = x * x;
  let w = z * z;
  let r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  let v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  let s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  w = x + r;
  if (ix >= 0x3fe59428) {
    v = iy;
    return (1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - (w * w / (w + v) - r)));
  }
  if (iy === 1) return w;
  // -1/(x+r), accurately
  z = withLo(w, 0);
  v = r - (z - x);
  const a = -1.0 / w;
  const t = withLo(a, 0);
  s = 1.0 + t * z;
  return t + a * (s + t * v);
}

// ---------------------------------------------------------------- argument reduction

const TWO_OVER_PI = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7, 0x246e3a,
  0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129, 0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c, 0x7026b4, 0x5f7e41,
  0x3991d6, 0x398353, 0x39f49c, 0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11, 0x8b5a0a, 0x6d1f6d, 0x367ecf,
  0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7, 0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08,
  0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3, 0x91615e, 0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880,
  0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
] as const;
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c,
  0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c,
  0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
] as const;
const TWO24 = 1.67772160000000000000e+07;
const TWON24 = 5.96046447753906250000e-08;
const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const PIO2 = [
  1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15, 3.28200341580791294123e-22,
  1.27065575308067607349e-29, 1.22933308981111328932e-36, 2.73370053816464559624e-44, 2.16741683877804819444e-51,
] as const;

/** x reduced by pi/2: the result's head and tail (rem_pio2's y[0], y[1]). */
const Y = [0, 0];

/** Payne-Hanek for huge arguments, prec 2 (k_rem_pio2.c). */
function kRemPio2(x: readonly number[], e0: number, nx: number): number {
  if (nx < 1) return 0;
  const jk = 4; // init_jk[prec = 2]
  const jp = jk;
  const f = new Array<number>(20).fill(0);
  const fq = new Array<number>(20).fill(0);
  const q = new Array<number>(20).fill(0);
  const iq = new Array<number>(20).fill(0);
  const jx = nx - 1;
  let jv = Math.trunc((e0 - 3) / 24);
  if (jv < 0) jv = 0;
  let q0 = e0 - 24 * (jv + 1);
  let j = jv - jx;
  const m = jx + jk;
  for (let i = 0; i <= m; i += 1, j += 1) f[i] = j < 0 ? 0 : TWO_OVER_PI[j]!;
  for (let i = 0; i <= jk; i += 1) {
    let fw = 0.0;
    for (j = 0; j <= jx; j += 1) fw += x[j]! * f[jx + i - j]!;
    q[i] = fw;
  }
  let jz = jk;
  let z: number;
  let n: number;
  let ih: number;
  for (;;) { // recompute:
    let i = 0;
    z = q[jz]!;
    for (j = jz; j > 0; i += 1, j -= 1) {
      const fw = (TWON24 * z) | 0;
      iq[i] = (z - TWO24 * fw) | 0;
      z = q[j - 1]! + fw;
    }
    for (let k = jz; k < 20; k += 1) iq[k] = 0;
    z = dscalbn(z, q0);
    z -= 8.0 * Math.floor(z * 0.125);
    n = z | 0;
    z -= n;
    ih = 0;
    if (q0 > 0) {
      i = iq[jz - 1]! >> (24 - q0);
      n += i;
      iq[jz - 1] = iq[jz - 1]! - (i << (24 - q0));
      ih = iq[jz - 1]! >> (23 - q0);
    } else if (q0 === 0) ih = iq[jz - 1]! >> 23;
    else if (z >= 0.5) ih = 2;
    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (i = 0; i < jz; i += 1) {
        const v = iq[i]!;
        if (carry === 0) {
          if (v !== 0) { carry = 1; iq[i] = 0x1000000 - v; }
        } else iq[i] = 0xffffff - v;
      }
      if (q0 > 0) {
        if (q0 === 1) iq[jz - 1] = iq[jz - 1]! & 0x7fffff;
        else if (q0 === 2) iq[jz - 1] = iq[jz - 1]! & 0x3fffff;
      }
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= dscalbn(1, q0);
      }
    }
    if (z === 0) {
      j = 0;
      for (i = jz - 1; i >= jk; i -= 1) j |= iq[i]!;
      if (j === 0) { // need recomputation
        let k = 1;
        while (iq[jk - k] === 0) k += 1;
        for (i = jz + 1; i <= jz + k; i += 1) {
          f[jx + i] = TWO_OVER_PI[jv + i]!;
          let fw = 0.0;
          for (j = 0; j <= jx; j += 1) fw += x[j]! * f[jx + i - j]!;
          q[i] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }
  if (z === 0.0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] === 0) { jz -= 1; q0 -= 24; }
  } else {
    z = dscalbn(z, -q0);
    if (z >= TWO24) {
      const fw = (TWON24 * z) | 0;
      iq[jz] = (z - TWO24 * fw) | 0;
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else iq[jz] = z | 0;
  }
  let fw = dscalbn(1, q0);
  for (let i = jz; i >= 0; i -= 1) { q[i] = fw * iq[i]!; fw *= TWON24; }
  for (let i = jz; i >= 0; i -= 1) {
    fw = 0.0;
    for (let k = 0; k <= jp && k <= jz - i; k += 1) fw += PIO2[k]! * q[i + k]!;
    fq[jz - i] = fw;
  }
  fw = 0.0;
  for (let i = jz; i >= 0; i -= 1) fw += fq[i]!;
  Y[0] = ih === 0 ? fw : -fw;
  fw = fq[0]! - fw;
  for (let i = 1; i <= jz; i += 1) fw += fq[i]!;
  Y[1] = ih === 0 ? fw : -fw;
  return n & 7;
}

/** x = n*(pi/2) + Y[0] + Y[1]; returns n (e_rem_pio2.c). */
function remPio2(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { Y[0] = x; Y[1] = 0; return 0; }
  if (ix < 0x4002d97c) { // |x| < 3pi/4
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        Y[0] = z - PIO2_1T;
        Y[1] = (z - Y[0]!) - PIO2_1T;
      } else {
        z -= PIO2_2;
        Y[0] = z - PIO2_2T;
        Y[1] = (z - Y[0]!) - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      Y[0] = z + PIO2_1T;
      Y[1] = (z - Y[0]!) + PIO2_1T;
    } else {
      z += PIO2_2;
      Y[0] = z + PIO2_2T;
      Y[1] = (z - Y[0]!) + PIO2_2T;
    }
    return -1;
  }
  if (ix <= 0x413921fb) { // |x| <= 2^19 (pi/2)
    let t = Math.abs(x);
    const n = (t * INVPIO2 + 0.5) | 0;
    const fn = n;
    let r = t - fn * PIO2_1;
    let w = fn * PIO2_1T;
    if (n < 32 && ix !== NPIO2_HW[n - 1]) {
      Y[0] = r - w;
    } else {
      const j = ix >> 20;
      Y[0] = r - w;
      let i = j - ((hiWord(Y[0]!) >> 20) & 0x7ff);
      if (i > 16) { // 2nd iteration, good to 118 bits
        t = r;
        w = fn * PIO2_2;
        r = t - w;
        w = fn * PIO2_2T - ((t - r) - w);
        Y[0] = r - w;
        i = j - ((hiWord(Y[0]!) >> 20) & 0x7ff);
        if (i > 49) { // 3rd iteration, 151 bits
          t = r;
          w = fn * PIO2_3;
          r = t - w;
          w = fn * PIO2_3T - ((t - r) - w);
          Y[0] = r - w;
        }
      }
    }
    Y[1] = (r - Y[0]!) - w;
    if (hx < 0) { Y[0] = -Y[0]!; Y[1] = -Y[1]!; return -n; }
    return n;
  }
  if (ix >= 0x7ff00000) { Y[0] = Y[1] = x - x; return 0; }
  // Huge: z = scalbn(|x|, ilogb(x) - 23), cut into 24-bit pieces.
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), loWord(x));
  const tx = [0, 0, 0];
  for (let i = 0; i < 2; i += 1) {
    tx[i] = z | 0;
    z = (z - tx[i]!) * TWO24;
  }
  tx[2] = z;
  let nx = 3;
  while (nx > 0 && tx[nx - 1] === 0) nx -= 1;
  const n = kRemPio2(tx, e0, nx);
  if (hx < 0) { Y[0] = -Y[0]!; Y[1] = -Y[1]!; return -n; }
  return n;
}

// ---------------------------------------------------------------- sin, cos, tan

/** Deterministic Math.sin (s_sin.c). */
export function dsin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kSin(Y[0]!, Y[1]!, 1);
    case 1: return kCos(Y[0]!, Y[1]!);
    case 2: return -kSin(Y[0]!, Y[1]!, 1);
    default: return -kCos(Y[0]!, Y[1]!);
  }
}

/** Deterministic Math.cos (s_cos.c). */
export function dcos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kCos(Y[0]!, Y[1]!);
    case 1: return -kSin(Y[0]!, Y[1]!, 1);
    case 2: return -kCos(Y[0]!, Y[1]!);
    default: return kSin(Y[0]!, Y[1]!, 1);
  }
}

/** Deterministic Math.tan (s_tan.c). */
export function dtan(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kTan(x, 0, 1);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  return kTan(Y[0]!, Y[1]!, 1 - ((n & 1) << 1));
}

// ---------------------------------------------------------------- atan, atan2

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00] as const;
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17] as const;
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
] as const;

/** Deterministic Math.atan (s_atan.c). */
export function datan(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) { // |x| >= 2^66
    if (x !== x) return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e200000) return x; // |x| < 2^-29
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) { // |x| < 1.1875
      if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1) / (2.0 + x); } // 7/16 <= |x| < 11/16
      else { id = 1; x = (x - 1) / (x + 1); } // 11/16 <= |x| < 19/16
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } // |x| < 2.4375
    else { id = 3; x = -1.0 / x; } // 2.4375 <= |x| < 2^66
  }
  let z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  z = ATANHI[id]! - ((x * (s1 + s2) - ATANLO[id]!) - x);
  return hx < 0 ? -z : z;
}

const PI_O_4 = 7.8539816339744827900E-01;
const PI_O_2 = 1.5707963267948965580E+00;
const PI = 3.1415926535897931160E+00;
const PI_LO = 1.2246467991473531772E-16;

/** Deterministic Math.atan2 (e_atan2.c). */
export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  const lx = loWord(x);
  const hy = hiWord(y);
  const iy = hy & 0x7fffffff;
  const ly = loWord(y);
  if (((hx - 0x3ff00000) | lx) === 0) return datan(y); // x = 1
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2*sign(x) + sign(y)
  if ((iy | ly) === 0) { // y = 0
    switch (m) {
      case 0: case 1: return y;
      case 2: return PI + TINY;
      default: return -PI - TINY;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY; // x = 0
  if (ix === 0x7ff00000) { // x = inf
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0: return PI_O_4 + TINY;
        case 1: return -PI_O_4 - TINY;
        case 2: return 3.0 * PI_O_4 + TINY;
        default: return -3.0 * PI_O_4 - TINY;
      }
    }
    switch (m) {
      case 0: return 0;
      case 1: return -0;
      case 2: return PI + TINY;
      default: return -PI - TINY;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY; // y = inf
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) z = PI_O_2 + 0.5 * PI_LO; // |y/x| > 2^60
  else if (hx < 0 && k < -60) z = 0.0; // |y|/x < -2^60
  else z = datan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// ---------------------------------------------------------------- exp, log

const HALF = [0.5, -0.5] as const;
const TWOM1000 = 9.33263618503218878990e-302;
const O_THRESHOLD = 7.09782712893383973096e+02;
const U_THRESHOLD = -7.45133219101941108420e+02;
const LN2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01] as const;
const LN2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10] as const;
const INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;

/** Deterministic Math.exp (e_exp.c). */
export function dexp(x: number): number {
  let hx = hiWord(x);
  const xsb = (hx >> 31) & 1;
  hx &= 0x7fffffff;
  let hi = 0.0;
  let lo = 0.0;
  let k = 0;
  if (hx >= 0x40862e42) { // |x| >= 709.78...
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | loWord(x)) !== 0) return x + x; // NaN
      return xsb === 0 ? x : 0.0; // exp(+-inf) = {inf, 0}
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return TWOM1000 * TWOM1000;
  }
  if (hx > 0x3fd62e42) { // |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) { // and |x| < 1.5 ln2
      hi = x - LN2HI[xsb]!;
      lo = LN2LO[xsb]!;
      k = 1 - xsb - xsb;
    } else {
      k = (INVLN2 * x + HALF[xsb]!) | 0;
      const t = k;
      hi = x - t * LN2HI[0];
      lo = t * LN2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) { // |x| < 2^-28
    return 1 + x;
  } else k = 0;
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
  const y = 1 - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) return withHi(y, hiWord(y) + (k << 20));
  return withHi(y, hiWord(y) + ((k + 1000) << 20)) * TWOM1000;
}

const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const LG1 = 6.666666666666735130e-01;
const LG2 = 3.999999999940941908e-01;
const LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01;
const LG5 = 1.818357216161805012e-01;
const LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;

/** Deterministic Math.log (e_log.c). */
export function dlog(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) { // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity; // log(+-0)
    if (hx < 0) return NaN; // log(-#)
    k -= 54;
    x *= TWO54; // subnormal: scale up
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000)); // normalise x or x/2
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) { // |f| < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      const dk = k;
      return dk * LN2_HI + dk * LN2_LO;
    }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    const dk = k;
    return dk * LN2_HI - ((R - dk * LN2_LO) - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f);
}

const IVLN10 = 4.34294481903251816668e-01;
const LOG10_2HI = 3.01029995663611771306e-01;
const LOG10_2LO = 3.69423907715893078616e-13;

/** Deterministic Math.log10 (e_log10.c). */
export function dlog10(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  const i = (k & 0x80000000) >>> 31;
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  const y = k + i;
  x = withHi(x, hx);
  const z = y * LOG10_2LO + IVLN10 * dlog(x);
  return z + y * LOG10_2HI;
}

/**
 * log2(x): the exponent exactly, plus dlog of the mantissa over ln 2 -- so a
 * power of two is its exact integer. (Not fdlibm's; built from dlog.)
 */
export function dlog2(x: number): number {
  if (!(x > 0) || x === Infinity) return dlog(x);
  let hx = hiWord(x);
  let k = 0;
  if (hx < 0x00100000) { x *= TWO54; k -= 54; hx = hiWord(x); }
  k += (hx >> 20) - 1023;
  const m = withHi(x, (hx & 0x000fffff) | 0x3ff00000); // [1, 2)
  return k + dlog(m) * INVLN2;
}

// ---------------------------------------------------------------- pow

const BP = [1.0, 1.5] as const;
const DP_H = [0.0, 5.84962487220764160156e-01] as const;
const DP_L = [0.0, 1.35003920212974897128e-08] as const;
const TWO53 = 9007199254740992.0;
const L1 = 5.99999999999994648725e-01;
const L2 = 4.28571428578550184252e-01;
const L3 = 3.33333329818377432918e-01;
const L4 = 2.72728123808534006489e-01;
const L5 = 2.30660745775561754067e-01;
const L6 = 2.06975017800338417784e-01;
const LG2F = 6.93147180559945286227e-01;
const LG2_H = 6.93147182464599609375e-01;
const LG2_L = -1.90465429995776804525e-09;
const OVT = 8.0085662595372944372e-0017;
const CP = 9.61796693925975554329e-01;
const CP_H = 9.61796700954437255859e-01;
const CP_L = -7.02846165095275826516e-09;
const IVLN2 = 1.44269504088896338700e+00;
const IVLN2_H = 1.44269502162933349609e+00;
const IVLN2_L = 1.92596299112661746887e-08;

/** Deterministic Math.pow and `**` (e_pow.c; ECMAScript's NaN for (+-1) ** +-Infinity). */
export function dpow(x: number, y: number): number {
  const hx = hiWord(x);
  const lx = loWord(x);
  const hy = hiWord(y);
  const ly = loWord(y);
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  if ((iy | ly) === 0) return 1; // x ** 0 = 1
  if (y !== y) return NaN; // (ECMAScript: 1 ** NaN is NaN)
  if (hx === 0x3ff00000 && lx === 0) return iy === 0x7ff00000 && ly === 0 ? NaN : x; // 1 ** y (ECMAScript: 1 ** Infinity is NaN)
  if (x !== x) return x + y;
  // yisint: 0 not an integer, 1 an odd one, 2 an even one (only matters for x < 0)
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        const j = ly >>> (52 - k);
        if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        const j = iy >> (20 - k);
        if ((j << (20 - k)) === iy) yisint = 2 - (j & 1);
      }
    }
  }
  if (ly === 0) {
    if (iy === 0x7ff00000) { // y = +-inf
      if (((ix - 0x3ff00000) | lx) === 0) return NaN; // (-1) ** +-inf (ECMAScript: NaN)
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0; // (|x|>1) ** +-inf = inf, 0
      return hy < 0 ? -y : 0; // (|x|<1) ** -,+inf = inf, 0
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x; // y = +-1
    if (hy === 0x40000000) return x * x; // y = 2
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x); // y = 0.5, x >= +0
  }
  let ax = Math.abs(x);
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) { // x = +-0, +-inf, +-1
    let z = ax;
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = NaN; // (-1) ** non-int
      else if (yisint === 1) z = -z;
    }
    return z;
  }
  if ((((hx >>> 31) - 1) | yisint) === 0) return NaN; // (x<0) ** non-int
  let t1: number;
  let t2: number;
  if (iy > 0x41e00000) { // |y| > 2^31
    if (iy > 0x43f00000) { // |y| > 2^64: must over/underflow
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY;
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY;
    }
    if (ix < 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY;
    if (ix > 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY;
    // |1-x| <= 2^-20: log(x) by x - x^2/2 + x^3/3 - x^4/4
    const t = x - 1;
    const w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    const u = IVLN2_H * t;
    const v = t * IVLN2_L - w * IVLN2;
    t1 = withLo(u + v, 0);
    t2 = v - (t1 - u);
  } else {
    let n = 0;
    if (ix < 0x00100000) { ax *= TWO53; n -= 53; ix = hiWord(ax); } // subnormal
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    ix = j | 0x3ff00000;
    let k: number;
    if (j <= 0x3988e) k = 0; // |x| < sqrt(3/2)
    else if (j < 0xbb67a) k = 1; // |x| < sqrt(3)
    else { k = 0; n += 1; ix -= 0x00100000; }
    ax = withHi(ax, ix);
    // s = s_h + s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5)
    let u = ax - BP[k]!;
    let v = 1 / (ax + BP[k]!);
    const s = u * v;
    const s_h = withLo(s, 0);
    let t_h = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let t_l = ax - (t_h - BP[k]!);
    const s_l = v * ((u - s_h * t_h) - s_h * t_l);
    // log(ax)
    let s2 = s * s;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + s);
    s2 = s_h * s_h;
    t_h = withLo(3.0 + s2 + r, 0);
    t_l = r - ((t_h - 3.0) - s2);
    u = s_h * t_h;
    v = s_l * t_h + t_l * s;
    const p_h = withLo(u + v, 0);
    const p_l = v - (p_h - u);
    const z_h = CP_H * p_h;
    const z_l = CP_L * p_h + p_l * CP + DP_L[k]!;
    const t = n;
    t1 = withLo(((z_h + z_l) + DP_H[k]!) + t, 0);
    t2 = z_l - (((t1 - t) - DP_H[k]!) - z_h);
  }
  let s = 1;
  if ((((hx >>> 31) - 1) | (yisint - 1)) === 0) s = -1; // (-ve) ** (odd int)
  // (y1 + y2) * (t1 + t2)
  const y1 = withLo(y, 0);
  const p_l = (y - y1) * t1 + y * t2;
  let p_h = y1 * t1;
  let z = p_l + p_h;
  let j = hiWord(z);
  let i = loWord(z);
  if (j >= 0x40900000) { // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE;
    if (p_l + OVT > z - p_h) return s * HUGE * HUGE;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) { // z <= -1075
    if (((j - 0xc090cc00) | i) !== 0) return s * TINY * TINY;
    if (p_l <= z - p_h) return s * TINY * TINY;
  }
  // 2 ** (p_h + p_l)
  i = j & 0x7fffffff;
  let k = (i >> 20) - 0x3ff;
  let n = 0;
  if (i > 0x3fe00000) { // |z| > 0.5: n = [z + 0.5]
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  const t = withLo(p_l + p_h, 0);
  const u = t * LG2_H;
  const v = (p_l - (t - p_h)) * LG2F + t * LG2_L;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  t1 = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * t1) / (t1 - 2) - (w + z * w);
  z = 1 - (r - z);
  j = (hiWord(z) + (n << 20)) | 0;
  if ((j >> 20) <= 0) z = dscalbn(z, n); // subnormal output
  else z = withHi(z, j);
  return s * z;
}

// ---------------------------------------------------------------- cbrt

const B1 = 715094163; // (1023 - 1023/3 - 0.03306235651) * 2^20
const B2 = 696219795; // (1023 - 1023/3 - 54/3 - 0.03306235651) * 2^20
const CB0 = 1.87595182427177009643;
const CB1 = -1.88497979543377169875;
const CB2 = 1.621429720105354466140;
const CB3 = -0.758397934778766047437;
const CB4 = 0.145996192886612446982;

/** Deterministic Math.cbrt (FreeBSD's s_cbrt.c, fdlibm's successor: V8's own). */
export function dcbrt(x: number): number {
  let hx = hiWord(x);
  const low = loWord(x);
  const sign = hx & 0x80000000;
  hx ^= sign;
  if (hx >= 0x7ff00000) return x + x; // NaN, inf
  let t: number;
  if (hx < 0x00100000) { // zero or subnormal
    if ((hx | low) === 0) return x;
    t = fromWords(0x43500000, 0) * x; // 2^54 x
    t = fromWords(sign | (Math.floor((hiWord(t) & 0x7fffffff) / 3) + B2), 0);
  } else t = fromWords(sign | (Math.floor(hx / 3) + B1), 0);
  // to 23 bits: cbrt(x) = t cbrt(x/t^3) ~= t P(t^3/x)
  let r = (t * t) * (t / x);
  t = t * ((CB0 + r * (CB1 + r * CB2)) + ((r * r) * r) * (CB3 + r * CB4));
  // round t away from zero to 23 bits
  let lo = loWord(t) + 0x80000000;
  let hi = hiWord(t);
  if (lo >= 0x100000000) { lo -= 0x100000000; hi = (hi + 1) | 0; }
  t = fromWords(hi, lo & 0xc0000000);
  // one Newton step to 53 bits
  const s = t * t;
  r = x / s;
  const w = t + t;
  r = (r - t) / (w + r);
  return t + t * r;
}

// ---------------------------------------------------------------- built from the above

/** Deterministic Math.asin: atan2(x, sqrt((1-x)(1+x))). */
export const dasin = (x: number): number => (x !== x || x > 1 || x < -1 ? NaN : datan2(x, Math.sqrt((1 - x) * (1 + x))));
/** Deterministic Math.acos: 2 atan2(sqrt(1-x), sqrt(1+x)). */
export const dacos = (x: number): number => (x !== x || x > 1 || x < -1 ? NaN : 2 * datan2(Math.sqrt(1 - x), Math.sqrt(1 + x)));

/**
 * Deterministic Math.hypot for two or three values: V8's own algorithm
 * (builtins/math.tq) -- the largest magnitude normalises, the squares are
 * Kahan-summed in argument order, then sqrt and rescale -- so on V8 it is
 * Math.hypot to the bit, and on any engine it is the same.
 */
export function dhypot(a: number, b: number, c?: number): number {
  const x = Math.abs(a);
  const y = Math.abs(b);
  const three = c !== undefined;
  const z = three ? Math.abs(c) : 0;
  if (x === Infinity || y === Infinity || z === Infinity) return Infinity;
  if (x !== x || y !== y || z !== z) return NaN;
  let max = x > y ? x : y;
  if (z > max) max = z;
  if (max === 0) return 0;
  let n = x / max;
  let sum = n * n; // (0 + (n*n - 0): exact)
  let comp = 0;
  n = y / max;
  let summand = n * n - comp;
  let pre = sum + summand;
  comp = (pre - sum) - summand;
  sum = pre;
  if (three) {
    n = z / max;
    summand = n * n - comp;
    pre = sum + summand;
    sum = pre;
  }
  return Math.sqrt(sum) * max;
}

/** Deterministic |v| of a vec3 (core's len, on dhypot). */
export const dlen = (v: readonly [number, number, number] | readonly number[]): number => dhypot(v[0]!, v[1]!, v[2]!);

/** Every deterministic function by its Math name: for tests, and for running a reference with them. */
export const DMATH = {
  sin: dsin, cos: dcos, tan: dtan, asin: dasin, acos: dacos, atan: datan, atan2: datan2,
  exp: dexp, log: dlog, log10: dlog10, log2: dlog2, pow: dpow, cbrt: dcbrt, hypot: dhypot,
} as const;
