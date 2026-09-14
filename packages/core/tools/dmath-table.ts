// Writes test/dmath-table.txt: input and output bit patterns of the reference
// fdlibm, which test/dmath.test.ts holds dmath to, bit for bit, on every
// machine CI runs on.
//
//   FDLIBM=path/to/SDL3/src/libm node packages/core/tools/dmath-table.ts
//
// The reference is Sun's fdlibm 5.3 as uClibc keeps it (the copy SDL3
// vendors in src/libm), compiled here by the system C compiler with
// -ffp-contract=off -- no fused multiply-adds, which is the whole point: the
// same sources with contraction on are what an arm64 Mac's V8 runs, and they
// disagree with this table in about 1 sin in 150.
//
// Lines are `<fn> <input hex>[,<input hex>] <output hex>`. hypot has no
// fdlibm source here: its lines are V8's Math.hypot, whose algorithm dhypot
// is (exact IEEE operations, so V8 gives the same bits on every CPU).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env["FDLIBM"];
if (!src) throw new Error("FDLIBM=<SDL3's src/libm> (the uClibc fdlibm sources)");

// ---- inputs: deterministic, spread over every range the engine meets and the edges
const dv = new DataView(new ArrayBuffer(8));
const hex = (x: number): string => { dv.setFloat64(0, x); return dv.getBigUint64(0).toString(16).padStart(16, "0"); };
let s = 0x2545f491;
const u32 = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
const unit = (): number => (u32() * 2 ** 21 + (u32() >>> 11)) / 2 ** 53;
const logU = (lo: number, hi: number): number => (unit() < 0.5 ? -1 : 1) * 2 ** (lo + (hi - lo) * unit());
const anyBits = (): number => { dv.setUint32(0, u32()); dv.setUint32(4, u32()); return dv.getFloat64(0); };
const range = (a: number, b: number): (() => number) => () => a + (b - a) * unit();
const special = [0, -0, 1, -1, 0.5, -0.5, 2, 3, 10, Math.PI, -Math.PI, Math.PI / 2, Math.PI / 4, 2 * Math.PI, 1e-300, 5e-324, 2.2250738585072014e-308, 1e22, 1e300, Number.MAX_VALUE, Infinity, -Infinity, NaN, 709.78, 710, -745, -708.4];
const lines: string[] = [];
const one = (fn: string, n: number, gen: () => number): void => { for (let i = 0; i < n; i += 1) lines.push(`${fn} ${hex(gen())}`); };
const two = (fn: string, n: number, gen: () => [number, number]): void => { for (let i = 0; i < n; i += 1) { const [a, b] = gen(); lines.push(`${fn} ${hex(a)},${hex(b)}`); } };
for (const fn of ["sin", "cos", "tan", "atan", "exp", "log", "log10"]) for (const x of special) lines.push(`${fn} ${hex(x)}`);
for (const fn of ["atan2", "pow"]) for (const a of special.slice(0, 12)) for (const b of special.slice(0, 12)) lines.push(`${fn} ${hex(a)},${hex(b)}`);
for (const fn of ["sin", "cos", "tan"]) {
  one(fn, 250, range(-Math.PI, Math.PI)); // headings
  one(fn, 120, range(-40, 40)); // phases
  one(fn, 60, () => logU(-40, 30));
  one(fn, 40, () => Math.round((unit() - 0.5) * 2000) * (Math.PI / 2) * (1 + (unit() - 0.5) * 1e-15)); // near multiples of pi/2
  one(fn, 30, () => logU(30, 1023)); // huge: Payne-Hanek
}
one("atan", 150, () => logU(-40, 70));
one("exp", 150, range(-50, 50));
one("exp", 50, range(-745, 710));
for (const fn of ["log", "log10"]) { one(fn, 120, () => Math.abs(logU(-1074, 1023))); one(fn, 80, range(0.5, 1.5)); }
two("atan2", 300, () => [(unit() - 0.5) * 200, (unit() - 0.5) * 200]);
two("atan2", 100, () => [logU(-30, 30), logU(-30, 30)]);
two("atan2", 40, () => [anyBits(), anyBits()]);
two("pow", 200, () => [Math.abs(logU(-20, 20)), (unit() - 0.5) * 40]);
two("pow", 80, () => [(unit() - 0.5) * 20, Math.round((unit() - 0.5) * 60)]);
two("pow", 60, () => [unit() * 2, 2.2]);
two("pow", 40, () => [1 + (unit() - 0.5) * 1e-6, logU(10, 40)]);
two("pow", 40, () => [anyBits(), anyBits()]);

// ---- the reference, compiled without contraction
const dir = mkdtempSync(join(tmpdir(), "fdlibm-"));
writeFileSync(join(dir, "SDL_internal.h"), `#include <stdint.h>
#include <string.h>
#include <math.h>
#define SDL_BIG_ENDIAN 4321
#define SDL_LIL_ENDIAN 1234
#define SDL_FLOATWORDORDER SDL_LIL_ENDIAN
#define SDL_BYTEORDER SDL_LIL_ENDIAN
#define SDL_UINT64_C(c) c ## ULL
#define SDL_arraysize(a) (sizeof(a)/sizeof((a)[0]))
#define SDL_memset memset
#define SDL_zero(x) memset(&(x), 0, sizeof(x))
#define SDL_assert(x)
typedef uint64_t Uint64;
`);
writeFileSync(join(dir, "driver.c"), `#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "math_libm.h"
static double d(uint64_t u) { double x; memcpy(&x, &u, 8); return x; }
static unsigned long long u(double x) { uint64_t v; memcpy(&v, &x, 8); return v; }
int main(void) {
  char fn[32], ins[64];
  while (scanf("%31s %63s", fn, ins) == 2) {
    unsigned long long a = 0, b = 0; double r;
    sscanf(ins, "%llx,%llx", &a, &b);
    double x = d(a), y = d(b);
    if (!strcmp(fn, "sin")) r = SDL_uclibc_sin(x);
    else if (!strcmp(fn, "cos")) r = SDL_uclibc_cos(x);
    else if (!strcmp(fn, "tan")) r = SDL_uclibc_tan(x);
    else if (!strcmp(fn, "atan")) r = SDL_uclibc_atan(x);
    else if (!strcmp(fn, "atan2")) r = SDL_uclibc_atan2(x, y);
    else if (!strcmp(fn, "exp")) r = SDL_uclibc_exp(x);
    else if (!strcmp(fn, "log")) r = SDL_uclibc_log(x);
    else if (!strcmp(fn, "log10")) r = SDL_uclibc_log10(x);
    else if (!strcmp(fn, "pow")) r = SDL_uclibc_pow(x, y);
    else continue;
    printf("%s %s %016llx\\n", fn, ins, u(r));
  }
  return 0;
}
`);
const sources = readdirSync(src).filter((f) => f.endsWith(".c")).map((f) => join(src, f));
const bin = join(dir, "fdlibm");
execFileSync(process.env["CC"] ?? "cc", ["-O2", "-ffp-contract=off", "-fno-fast-math", "-w", `-I${dir}`, `-I${src}`, "-o", bin, join(dir, "driver.c"), ...sources]);
const ref = execFileSync(bin, { input: `${lines.join("\n")}\n`, maxBuffer: 1 << 26 }).toString().trim().split("\n");

// ---- hypot: V8's Math.hypot
const hyp: string[] = [];
const hypIn: number[][] = [
  ...special.slice(0, 12).flatMap((a) => special.slice(0, 12).map((b) => [a, b])),
  ...Array.from({ length: 300 }, () => [(unit() - 0.5) * 200, (unit() - 0.5) * 200]),
  ...Array.from({ length: 300 }, () => [(unit() - 0.5) * 200, (unit() - 0.5) * 200, (unit() - 0.5) * 200]),
  ...Array.from({ length: 60 }, () => [logU(-500, 500), logU(-500, 500), logU(-500, 500)]),
  [Infinity, NaN], [NaN, 1], [0, 0, 0], [-0, -0], [3, 4], [1e308, 1e308], [5e-324, 5e-324, 5e-324],
];
for (const v of hypIn) hyp.push(`hypot ${v.map(hex).join(",")} ${hex((Math.hypot as (...a: number[]) => number)(...v))}`);

const out = resolve(here, "../test/dmath-table.txt");
writeFileSync(out, `# fdlibm 5.3 (uClibc, as SDL3 vendors it), cc -O2 -ffp-contract=off; hypot: V8 Math.hypot. packages/core/tools/dmath-table.ts\n${[...ref, ...hyp].join("\n")}\n`);
console.log(`${ref.length + hyp.length} lines -> ${out}`);
