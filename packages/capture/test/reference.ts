// Where the reference lives, for the equality tests: the JavaScript proof of
// concept (KEEL_POC=path, default ../keel-pixel-engine beside this repo). It
// is only read. A test whose reference isn't on this machine is skipped, not failed.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DMATH } from "@keel-engine/core";

const here = dirname(fileURLToPath(import.meta.url));
export const POC = resolve(process.env["KEEL_POC"] ?? resolve(here, "../../../../keel-pixel-engine"));
export const hasPoc = existsSync(`${POC}/src/core/rng.js`);
export const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;

// The proof of concept calls Math.sin, cos, atan2...; the engine's simulation
// and generators call core's dmath instead (docs/CONVENTIONS.md: bit-identical
// on every CPU and engine, where this machine's Math is not -- an arm64 Mac's
// V8 fuses multiply-adds inside fdlibm). So that these tests compare the PORTS,
// operation for operation and still to the bit, rather than this machine's
// libm against fdlibm, the reference runs with Math's transcendental functions
// swapped for dmath's: installed before its first module loads, for the whole
// test process (node --test runs each test file in its own). Math.hypot stays:
// dhypot is V8's own algorithm, the same bits.
const PORTABLE = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "log", "log10", "log2", "pow"] as const;
let portable = false;
function usePortableMath(): void {
  if (portable) return;
  portable = true;
  const m = Math as unknown as Record<string, unknown>;
  for (const k of PORTABLE) m[k] = DMATH[k];
}

/** A module of the proof of concept ("src/fx/fx.js"), typed as its TypeScript port. */
export const poc = async <T>(path: string): Promise<T> => (usePortableMath(), (await import(pathToFileURL(`${POC}/${path}`).href)) as T);

/** A local generator for test inputs (not under test): mulberry32. */
export function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counted comparisons: deep-equal (strict: -0 is not 0), and bit-exact numbers (Object.is). */
export function counter() {
  const counts: Record<string, number> = {};
  const count = (k: string, n = 1): void => { counts[k] = (counts[k] ?? 0) + n; };
  return {
    counts,
    same(k: string, a: unknown, b: unknown, msg?: string): void { assert.deepStrictEqual(a, b, msg); count(k); },
    exact(k: string, a: unknown, b: unknown, msg = ""): void { if (!Object.is(a, b)) assert.fail(`${msg}: ${String(a)} !== ${String(b)}`); count(k); },
    summary(title: string): string { return `${title}:\n${Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`; },
  };
}

/** Run f, and say what came out: the value, or the error's type and message (so throws compare too). */
export function outcome<T>(f: () => T): { ok: T } | { err: string } {
  try { return { ok: f() }; } catch (e) { return { err: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) }; }
}
