// Deterministic math, held to the bit: against the reference fdlibm's own
// outputs (test/dmath-table.txt, made by tools/dmath-table.ts from the C
// sources compiled without FMA contraction), and against a fingerprint of a
// few hundred thousand more calls. Both pins are the same on every machine
// CI runs on -- that is the point of the module -- so a failure here on one
// platform only means the platform changed what + - * / sqrt do, or a port
// line moved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DMATH, dacos, dasin, dhypot, dlen, dlog2, dpow, dsin } from "../src/dmath.ts";

const dv = new DataView(new ArrayBuffer(8));
const hex = (x: number): string => { dv.setFloat64(0, x); return dv.getBigUint64(0).toString(16).padStart(16, "0"); };
const fromHex = (h: string): number => { dv.setBigUint64(0, BigInt(`0x${h}`)); return dv.getFloat64(0); };
const ulps = (a: number, b: number): number => {
  dv.setFloat64(0, a); const x = dv.getBigInt64(0);
  dv.setFloat64(0, b); const y = dv.getBigInt64(0);
  return Number(x > y ? x - y : y - x);
};

test("dmath: the reference fdlibm's table, every line to the bit", () => {
  const lines = readFileSync(new URL("./dmath-table.txt", import.meta.url), "utf8").trim().split("\n").filter((l) => !l.startsWith("#"));
  assert.ok(lines.length > 4000, `${lines.length} lines`);
  const fns = new Map<string, number>();
  for (const line of lines) {
    const [fn, ins, out] = line.split(" ") as [keyof typeof DMATH, string, string];
    const args = ins.split(",").map(fromHex);
    const got = (DMATH[fn] as (...a: number[]) => number)(...args);
    let want = fromHex(out);
    // (ECMAScript, not C: 1 ** NaN, (+-1) ** (+-Infinity) are NaN.)
    if (fn === "pow" && Math.abs(args[0]!) === 1 && !Number.isFinite(args[1]!)) want = NaN;
    if (Number.isNaN(want)) assert.ok(Number.isNaN(got), `${fn}(${args.join(", ")}) = ${got}, want NaN`);
    else assert.equal(hex(got), hex(want), `${fn}(${args.join(", ")}) = ${got}, want ${want}`);
    fns.set(fn, (fns.get(fn) ?? 0) + 1);
  }
  for (const fn of ["sin", "cos", "tan", "atan", "atan2", "exp", "log", "log10", "pow", "hypot"]) assert.ok((fns.get(fn) ?? 0) >= 100, `${fn}: ${fns.get(fn)} lines`);
});

test("dmath: 350,000 more calls fingerprint the same everywhere", () => {
  let s = 0x6a09e667;
  const u32 = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const unit = (): number => (u32() * 2 ** 21 + (u32() >>> 11)) / 2 ** 53;
  const h = createHash("sha256");
  const buf = new Float64Array(1);
  const put = (x: number): void => { buf[0] = Number.isNaN(x) ? NaN : x; h.update(new Uint8Array(buf.buffer)); };
  const N = 25000;
  for (let i = 0; i < N; i += 1) {
    const a = (unit() - 0.5) * 64;
    const b = (unit() - 0.5) * 64;
    const t = unit() * 2 - 1;
    const p = dpow(2, (unit() - 0.5) * 80); // (dpow: even the inputs are the same everywhere)
    put(DMATH.sin(a)); put(DMATH.cos(a)); put(DMATH.tan(a)); put(DMATH.atan(a)); put(DMATH.atan2(a, b));
    put(DMATH.exp(a)); put(DMATH.log(p)); put(DMATH.log10(p)); put(DMATH.log2(p)); put(DMATH.pow(p, b / 8));
    put(DMATH.asin(t)); put(DMATH.acos(t)); put(DMATH.hypot(a, b)); put(dhypot(a, b, t));
  }
  // (Re-pin only with a reason: this is every sim and generator's arithmetic.)
  assert.equal(h.digest("hex"), "ce79f657999aab5b8285700240285317c7d3b9e0be3bfdcb2c6f36cab483fd76");
});

test("dmath: dhypot is V8's Math.hypot, two and three values, and dlen is |v|", () => {
  let s = 7;
  const r = (): number => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s / 2 ** 32 - 0.5) * 2 ** ((s % 40) - 20); };
  for (let i = 0; i < 50000; i += 1) {
    const a = r(), b = r(), c = r();
    assert.equal(hex(dhypot(a, b)), hex(Math.hypot(a, b)));
    assert.equal(hex(dhypot(a, b, c)), hex(Math.hypot(a, b, c)));
  }
  assert.equal(dhypot(Infinity, NaN), Infinity);
  assert.ok(Number.isNaN(dhypot(1, NaN)));
  assert.ok(Object.is(dhypot(-0, -0), 0));
  assert.equal(dlen([3, 4, 12]), 13);
});

test("dmath: the built ones -- dlog2 exact on powers of two, dasin/dacos within 2 ulp and odd/complementary", () => {
  for (let k = -1074; k <= 1023; k += 1) assert.equal(dlog2(2 ** k), k);
  for (let i = 0; i <= 4000; i += 1) {
    const x = -1 + i / 2000;
    assert.ok(ulps(dasin(x), Math.asin(x)) <= 2, `asin ${x}`);
    assert.ok(ulps(dacos(x), Math.acos(x)) <= 2, `acos ${x}`);
    assert.equal(dasin(-x), -dasin(x));
  }
  assert.equal(dacos(1), 0);
  assert.equal(dasin(1), Math.PI / 2);
  assert.ok(Number.isNaN(dasin(1.5)) && Number.isNaN(dacos(-2)));
});

test("dmath: ECMAScript's edge cases of pow and the trig functions", () => {
  assert.equal(dpow(Number.NaN, 0), 1);
  assert.ok(Number.isNaN(dpow(1, Infinity)) && Number.isNaN(dpow(-1, -Infinity)) && Number.isNaN(dpow(1, NaN)));
  assert.equal(dpow(-8, 1 / 3) !== dpow(-8, 1 / 3), true); // (x<0) ** non-int is NaN
  assert.equal(dpow(-2, 3), -8);
  assert.equal(dpow(2, -1074), 5e-324);
  assert.ok(Object.is(dsin(-0), -0));
  assert.ok(Number.isNaN(dsin(Infinity)));
  assert.equal(dsin(1e22), Math.sin(1e22)); // Payne-Hanek (famous value, every libm agrees)
});
