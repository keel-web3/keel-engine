// Random schemas and values for the property tests, from core's seeded
// streams (never Math.random: a failure replays from its case number).

import { createRoll, stream } from "@keel-engine/core";
import type { Stream } from "@keel-engine/core";
import {
  alt, array, biguint, bool, bytes, constant, delta, dyn, enumOf, fixed, float16, float32, float64, fromHalf, gridOf, hex, int, lz, map, named, nullable, num, optional,
  planes, recursive, ref, runs, string, struct, tuple, uint, union, varint, varuint, withDefault,
} from "../src/index.ts";
import type { Json, Node, Type } from "../src/index.ts";

export const rng = (seed: string | number, slot = 0): Stream => stream(createRoll(`0x${(typeof seed === "number" ? seed : [...seed].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261)).toString(16)}`), slot);
const u32 = (S: Stream): number => (Math.floor(S.f() * 65536) * 65536 + Math.floor(S.f() * 65536)) >>> 0;
const int53 = (S: Stream, bits: number): number => (bits <= 16 ? Math.floor(S.f() * 2 ** bits) : bits <= 32 ? u32(S) % 2 ** bits : (u32(S) % 2 ** (bits - 32)) * 2 ** 32 + u32(S));

const WORDS = ["", "a", "wall", "floor", "héllo", "日本", "🦊 fox", "x".repeat(40), "0x", "0xab", "0xdeadbeef", "__proto__", "$float"];

export function randomString(S: Stream): string {
  if (S.chance(0.5)) return S.pick(WORDS);
  let s = "";
  const n = S.int(0, 12);
  for (let k = 0; k < n; k += 1) {
    const r = S.f();
    s += r < 0.7 ? String.fromCharCode(32 + S.int(0, 94)) : r < 0.85 ? String.fromCharCode(0xa0 + S.int(0, 0x2000)) : String.fromCodePoint(0x1f300 + S.int(0, 500));
  }
  return s;
}

function randomNumber(S: Stream): number {
  const r = S.f();
  if (r < 0.25) return S.int(-1000, 1000);
  if (r < 0.4) return Math.round((S.f() - 0.5) * 2000 * 1000) / 1000;
  if (r < 0.55) return Math.fround((S.f() - 0.5) * 100);
  if (r < 0.9) return (S.f() - 0.5) * 1e6 + S.f() / 3;
  return S.pick([0, -0, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 60), 1e-300, 5e-324, 0.1, 0.3]);
}

export function randomJson(S: Stream, depth: number): Json {
  const r = S.f();
  if (depth <= 0 || r < 0.55) {
    const q = S.f();
    return q < 0.1 ? null : q < 0.25 ? S.chance(0.5) : q < 0.6 ? randomNumber(S) : randomString(S);
  }
  if (r < 0.78) return Array.from({ length: S.int(0, 5) }, () => randomJson(S, depth - 1));
  const o: Record<string, Json> = {};
  for (let k = S.int(0, 5); k > 0; k -= 1) {
    const key = randomString(S);
    if (key === "__proto__") Object.defineProperty(o, key, { value: randomJson(S, depth - 1), enumerable: true, writable: true, configurable: true });
    else o[key] = randomJson(S, depth - 1);
  }
  return o;
}

export interface Case { readonly schema: Type<unknown>; readonly value: (S: Stream) => unknown }

/** A random schema (depth-limited) with a generator of its values. */
export function randomCase(S: Stream, depth = 3): Case {
  const leaf = depth <= 0 || S.chance(0.45);
  const kinds = leaf
    ? ["uint", "int", "bool", "fixed", "fixedk", "fixedx", "fixedd", "float", "enum", "varuint", "varint", "string", "ref", "bytes", "hex", "biguint", "dyn", "num", "const", "planes", "delta", "runs", "lz"]
    : ["array", "optional", "nullable", "default", "struct", "tuple", "union", "alt", "map", "named", "rec", "runs"];
  const kind = S.pick(kinds);
  switch (kind) {
    case "uint": { const b = S.int(1, 53); return { schema: uint(b), value: (R) => int53(R, b) }; }
    case "int": { const b = S.int(2, 53); return { schema: int(b), value: (R) => int53(R, b - 1) * (R.chance(0.5) ? -1 : 1) - (R.chance(0.1) ? 1 : 0) || 0 }; }
    case "bool": return { schema: bool(), value: (R) => R.chance(0.5) };
    case "fixed": case "fixedk": case "fixedx": case "fixedd": {
      const step = S.pick([1, 0.5, 0.1, 0.01, 0.001, 0.25, Math.PI / 32768, 5, 0.02]);
      const min = S.pick([0, -10, -8192, 0.08, -Math.PI]);
      const max = min + step * S.int(1, 200000);
      const n = fixed(min, max, step, kind === "fixedx" ? { off: "exact", ...(S.chance(0.5) ? { k: S.int(0, 9) } : {}) } : kind === "fixedk" ? { k: S.int(0, 12) } : kind === "fixedd" ? { k: S.int(0, 9), delta: true } : {});
      const g = gridOf(n);
      return { schema: n, value: (R) => (kind === "fixedx" && R.chance(0.3) ? randomNumber(R) : g.value(R.int(g.lo, g.hi)) || 0) };
    }
    case "float": {
      const bits = S.pick([16, 32, 64] as const);
      return { schema: bits === 16 ? float16() : bits === 32 ? float32() : float64(), value: (R) => (bits === 16 ? fromHalf(Math.floor(R.f() * 65536)) : bits === 32 ? Math.fround(randomNumber(R)) : randomNumber(R)) };
    }
    case "enum": {
      const values = [...new Set(Array.from({ length: S.int(1, 20) }, (_, i) => (S.chance(0.8) ? `v${i}` : i)))];
      const other = S.chance(0.3);
      const cap = S.chance(0.3) ? values.length + S.int(0, 10) : 0;
      const schema = other ? enumOf(values, { capacity: cap, other: true, open: S.chance(0.2) }) : enumOf(values, { capacity: cap, open: S.chance(0.2) });
      return { schema, value: (R) => (other && R.chance(0.2) ? `other:${randomString(R)}` : R.pick(values)) };
    }
    case "varuint": { const opts = S.chance(0.5) ? { k: S.int(0, 8) } : { group: S.int(1, 8) }; return { schema: varuint(opts), value: (R) => (R.chance(0.5) ? R.int(0, 20) : int53(R, R.int(1, 50))) }; }
    case "varint": { const opts = S.chance(0.5) ? { k: S.int(0, 8) } : { group: S.int(1, 8) }; return { schema: varint(opts), value: (R) => (R.chance(0.5) ? R.int(-20, 20) : int53(R, R.int(1, 50)) * (R.chance(0.5) ? -1 : 1)) || 0 }; }
    case "string": { const packHex = S.chance(0.4); return { schema: string({ packHex }), value: randomString }; }
    case "ref": { const pool = Array.from({ length: S.int(1, 6) }, () => (S.chance(0.3) ? `0x${S.int(0, 65535).toString(16).padStart(4, "0")}` : randomString(S))); return { schema: ref(S.pick(["str", "b", "tags"]), { packHex: S.chance(0.5) }), value: (R) => R.pick(pool) }; }
    case "bytes": { const len = S.chance(0.5) ? S.int(1, 8) : 0; return { schema: bytes({ length: len }), value: (R) => Uint8Array.from({ length: len || R.int(0, 9) }, () => R.int(0, 255)) }; }
    case "hex": { const len = S.chance(0.5) ? S.int(1, 8) : 0; return { schema: hex({ bytes: len }), value: (R) => `0x${Array.from({ length: len || R.int(0, 9) }, () => R.int(0, 255).toString(16).padStart(2, "0")).join("")}` }; }
    case "biguint": { const b = S.int(1, 256); return { schema: biguint(b), value: (R) => { let v = 0n; for (let k = 0; k < b; k += 16) v = (v << 16n) | BigInt(R.int(0, 65535)); return v & ((1n << BigInt(b)) - 1n); } }; }
    case "dyn": return { schema: dyn(), value: (R) => randomJson(R, 3) };
    case "num": return { schema: num(), value: randomNumber };
    case "const": { const v = randomJson(S, 2); return { schema: constant(v), value: () => structuredClone(v) }; }
    case "planes": { const b = S.int(1, 12); return { schema: planes(b), value: (R) => Array.from({ length: R.int(0, 30) }, () => R.int(0, 2 ** b - 1)) }; }
    case "delta": {
      const which = S.int(0, 2);
      const of = which === 0 ? uint(16) : which === 1 ? int(20) : fixed(-100, 100, 0.01);
      return { schema: delta(of as Type<number>, { k: S.int(0, 6) }), value: (R) => Array.from({ length: R.int(0, 20) }, () => (which === 0 ? R.int(0, 65535) : which === 1 ? R.int(-500000, 500000) : Math.round((R.f() - 0.5) * 20000) / 100)) };
    }
    case "lz": {
      const of = S.pick([uint(8), string(), bool()]);
      const alphabet = Array.from({ length: S.int(1, 5) }, (_, i) => (of.kind === "uint" ? i * 7 : of.kind === "bool" ? i % 2 === 0 : `s${i}`));
      return {
        schema: lz(of as Type<number>, { min: S.int(2, 5) }),
        value: (R) => { const out: unknown[] = []; const n = R.int(0, 200); while (out.length < n) { if (out.length > 3 && R.chance(0.4)) { const d = R.int(1, out.length); const l = R.int(1, 20); for (let q = 0; q < l; q += 1) out.push(out[out.length - d]); } else out.push(R.pick(alphabet)); } return out; },
      };
    }
    case "runs": {
      const c = leaf ? { schema: uint(3), value: (R: Stream) => R.int(0, 7) } : randomCase(S, depth - 1);
      return { schema: runs(c.schema), value: (R) => { const out: unknown[] = []; for (let k = R.int(0, 8); k > 0; k -= 1) { const v = c.value(R); for (let q = R.int(1, 5); q > 0; q -= 1) out.push(structuredClone(v)); } return out; } };
    }
    case "array": {
      const c = randomCase(S, depth - 1);
      const mode = S.int(0, 2);
      const len = S.int(1, 5);
      return { schema: array(c.schema, mode === 0 ? {} : mode === 1 ? { length: len } : { max: 7 }), value: (R) => Array.from({ length: mode === 1 ? len : R.int(0, mode === 2 ? 7 : 6) }, () => c.value(R)) };
    }
    case "optional": { const c = randomCase(S, depth - 1); return { schema: optional(c.schema), value: (R) => (R.chance(0.5) ? undefined : c.value(R)) }; }
    case "nullable": { const c = randomCase(S, depth - 1); return { schema: nullable(c.schema), value: (R) => (R.chance(0.5) ? null : c.value(R)) }; }
    case "default": {
      const c = randomCase(S, Math.min(1, depth - 1));
      const d = c.value(S);
      // (An absent value is the default: a default over an optional never sees "absent".)
      if (d === undefined || c.schema.kind === "const" || c.schema.kind === "optional") return c;
      return { schema: withDefault(c.schema, d as never), value: (R) => (R.chance(0.5) ? structuredClone(d) : c.value(R) ?? structuredClone(d)) };
    }
    case "struct": {
      const fields: Record<string, Case> = {};
      for (let k = S.int(0, 5); k > 0; k -= 1) fields[S.pick(["a", "b", "c", "type", "kind", "x", "déjà", "__x"]) + k] = randomCase(S, depth - 1);
      const schema = struct(Object.fromEntries(Object.entries(fields).map(([k, c]) => [k, c.schema])));
      return { schema, value: (R) => { const o: Record<string, unknown> = {}; for (const [k, c] of Object.entries(fields)) { const v = c.value(R); if (v !== undefined) o[k] = v; } return o; } };
    }
    case "tuple": { const items = Array.from({ length: S.int(1, 4) }, () => randomCase(S, depth - 1)); return { schema: tuple(items.map((c) => c.schema)), value: (R) => items.map((c) => c.value(R)) }; }
    case "union": {
      const vs: Record<string, Record<string, Case>> = {};
      for (let k = S.int(1, 4); k > 0; k -= 1) {
        const f: Record<string, Case> = {};
        for (let q = S.int(0, 3); q > 0; q -= 1) f[`f${q}`] = randomCase(S, depth - 1);
        vs[`v${k}`] = f;
      }
      const schema = union("t", Object.fromEntries(Object.entries(vs).map(([k, f]) => [k, struct(Object.fromEntries(Object.entries(f).map(([n, c]) => [n, c.schema])))])), { capacity: S.chance(0.3) ? 16 : 0 });
      return { schema, value: (R) => { const name = R.pick(Object.keys(vs)); const o: Record<string, unknown> = { t: name }; for (const [n, c] of Object.entries(vs[name]!)) { const v = c.value(R); if (v !== undefined) o[n] = v; } return o; } };
    }
    case "alt": return { schema: alt([uint(8), string(), bool()]), value: (R) => (R.chance(0.33) ? R.int(0, 255) : R.chance(0.5) ? randomString(R) : R.chance(0.5)) };
    case "map": {
      const c = randomCase(S, depth - 1);
      const order = S.chance(0.5) ? "sorted" as const : "kept" as const;
      return { schema: map(S.chance(0.5) ? string() : ref("keys"), c.schema, { order }), value: (R) => { const o: Record<string, unknown> = {}; for (let k = R.int(0, 5); k > 0; k -= 1) { const key = randomString(R); const v = c.value(R); if (v !== undefined) { if (key === "__proto__") Object.defineProperty(o, key, { value: v, enumerable: true, writable: true, configurable: true }); else o[key] = v; } } return o; } };
    }
    case "named": { const c = randomCase(S, depth - 1); return { schema: named(`test/${S.int(0, 99)}`, c.schema, { version: S.int(1, 3), doc: "x" }), value: c.value }; }
    default: {
      // A tree: { v, kids: [tree] }.
      const c = randomCase(S, 0);
      type T = { v: unknown; kids: T[] };
      const schema = recursive<T>((self) => struct({ v: c.schema, kids: array(self, { max: 3 }) }) as unknown as Type<T>);
      const make = (R: Stream, d: number): T => ({ v: c.value(R), kids: d > 0 ? Array.from({ length: R.int(0, 3) }, () => make(R, d - 1)) : [] });
      return { schema, value: (R) => make(R, 3) };
    }
  }
}

/** The node a case's schema is (for tests that look inside). */
export const nodeOf = (t: Type<unknown>): Node => t as Node;
