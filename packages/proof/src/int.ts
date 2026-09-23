// Integer arithmetic a zkVM guest reproduces exactly. A provable sim keeps its
// state in safe integers (|n| < 2^53) and only uses these for division and
// roots: JS numbers and Rust i64 agree on +, -, * of safe integers, and these
// define the rest the way Rust's integer ops do (division truncates to zero).

const safe = (n: number, what: string): number => {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what}: ${n} is not a safe integer`);
  return n;
};

/** a / b truncated toward zero (Rust's i64 `/`). Exact for safe integers. */
export function idiv(a: number, b: number): number {
  safe(a, "idiv"); safe(b, "idiv");
  if (b === 0) throw new RangeError("idiv by zero");
  // For |a| < 2^53 the float quotient can never round across an integer, so trunc is exact.
  return Math.trunc(a / b);
}

/** a * b / d truncated, with the product checked to stay exact. */
export function mulDiv(a: number, b: number, d: number): number {
  return idiv(safe(a * b, "mulDiv product"), d);
}

/** floor(sqrt(n)) for 0 <= n < 2^53, by Newton's method on integers only. */
export function isqrt(n: number): number {
  safe(n, "isqrt");
  if (n < 0) throw new RangeError("isqrt of a negative");
  if (n < 2) return n;
  // Start above the root: 2^ceil(bits/2) (bit length from a loop, not Math.log2).
  let bits = 0;
  for (let m = n; m > 0; m = Math.floor(m / 2)) bits += 1;
  let x = 2 ** Math.ceil(bits / 2);
  for (;;) {
    const y = Math.floor((x + Math.floor(n / x)) / 2);
    if (y >= x) return x;
    x = y;
  }
}

export const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Throws unless every number reachable in `value` is a safe integer (bigints pass). A test helper for sim state. */
export function assertIntegers(value: unknown, path = "state"): void {
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) throw new RangeError(`${path} = ${value} is not a safe integer`); return; }
  if (typeof value === "bigint" || typeof value !== "object" || value === null) return;
  if (ArrayBuffer.isView(value)) {
    if (value instanceof Float32Array || value instanceof Float64Array) throw new RangeError(`${path} is a float array`);
    return;
  }
  for (const [k, v] of Object.entries(value)) assertIntegers(v, `${path}.${k}`);
}
