import { BitError, BitReader, BitWriter, bitsFor, fromHalf, toHalf } from "./bits.ts";
import { SchemaError, categoryOf } from "./schema.ts";
import type { Category, Field, Infer, Json, Node, Type } from "./schema.ts";
import { CodecError, NUM_KINDS, SCRATCH, Tables, compiled as compileCached, createTables, describe, fail, fresh, fromUtf8, gridOf, intCheck, lastOf, meta, placesOf, put, rd, readNum, same, under, unzig, utf8, wellFormed, wr, writeNum, zig } from "./codec-primitives.ts";
import type { C, Ctx, Grid, Tracer } from "./codec-primitives.ts";
export { CodecError, Tables, createTables, gridOf, pathText, put, same, under, wellFormed } from "./codec-primitives.ts";
export type { Grid, Tracer } from "./codec-primitives.ts";
function compiled(root: Node): C { return compileCached(root, compile); }

function compile(n: Node, recs: C[]): C {
  switch (n.kind) {
    case "uint": {
      const max = 2 ** n.bits;
      const what = `uint(${n.bits})`;
      return {
        node: n,
        w(o, v) {
          const k = intCheck(v, what);
          if (k < 0 || k >= max) fail(`${k} is outside ${what}'s 0..${max - 1}.`);
          o.wide(k, n.bits);
        },
        r: (i) => i.bits(n.bits),
      };
    }
    case "int": {
      const half = 2 ** (n.bits - 1);
      const what = `int(${n.bits})`;
      return {
        node: n,
        w(o, v) {
          const k = intCheck(v, what);
          if (k < -half || k >= half) fail(`${k} is outside ${what}'s ${-half}..${half - 1}.`);
          o.wide(zig(k), n.bits);
        },
        r: (i) => unzig(i.bits(n.bits)),
      };
    }
    case "bool":
      return {
        node: n,
        w(o, v) { if (typeof v !== "boolean") fail(`${describe(v)} is not a boolean.`); o.bool(v as boolean); },
        r: (i) => i.bool(),
      };
    case "fixed": {
      const g = gridOf(n);
      const what = `fixed(${n.min}, ${n.max}, ${n.step})`;
      const exact = n.off === "exact";
      // (Golomb coding: the step count from zero, zigzagged when the range goes below zero.)
      const signed = g.lo < 0;
      // (Delta: the difference from this field's last value in the document -- kept per place in the schema: `self`.)
      const self = {};
      const put = n.delta
        ? (o: BitWriter, k: number, x: Ctx): void => { const m = lastOf(x); const d = k - (m.get(self) ?? 0); if (d === 0) o.bool(false); else { o.bool(true); o.golomb(zig(d) - 1, n.k); } m.set(self, k); }
        : n.k >= 0
          ? (o: BitWriter, k: number): void => o.golomb(signed ? zig(k) : k, n.k)
          : (o: BitWriter, k: number): void => o.wide(k - g.lo, g.bits);
      const get = n.delta
        ? (i: BitReader, x: Ctx): number => { const m = lastOf(x); const k = (m.get(self) ?? 0) + (i.bool() ? unzig(i.golomb(n.k) + 1) : 0); if (k < g.lo || k > g.hi) fail(`${g.value(k)} is outside ${what} (corrupt data).`); m.set(self, k); return k; }
        : n.k >= 0
          ? (i: BitReader): number => { const u = i.golomb(n.k); const k = signed ? unzig(u) : u; if (k < g.lo || k > g.hi) fail(`${g.value(k)} is outside ${what} (corrupt data).`); return k; }
          : (i: BitReader): number => i.wide(g.bits) + g.lo;
      return {
        node: n,
        w(o, v, ctx) {
          if (typeof v !== "number") fail(`${describe(v)} is not a number (${what}).`);
          const x = v as number;
          if (exact) {
            // (On the grid and in range: the step count. Anything else -- off the grid, out of range, -0, NaN -- whole.)
            const k = Number.isFinite(x) ? g.units(x) : NaN;
            if (k >= g.lo && k <= g.hi && Object.is(g.value(k) === 0 ? 0 : g.value(k), x)) { o.bool(false); put(o, k, ctx); return; }
            o.bool(true);
            o.f64(x);
            return;
          }
          if (!Number.isFinite(x)) fail(`${x} is not a finite number (${what}).`);
          const k = g.units(x);
          if (k < g.lo) fail(`${x} is below ${what}'s min ${n.min}.`);
          if (k > g.hi) fail(`${x} is above ${what}'s max ${n.max}.`);
          if (n.off === "strict" && g.value(k) !== x) fail(`${x} is not on ${what}'s grid (nearest ${g.value(k)}).`);
          put(o, k, ctx);
        },
        r(i, x) {
          if (exact) {
            const s = i.at;
            const whole = i.bool();
            if (x.trace) meta(x, "exact", s, i, whole, whole ? "off the grid: a float64" : "on the grid");
            if (whole) return i.f64();
          }
          const v = g.value(get(i, x));
          return v === 0 ? 0 : v;
        },
      };
    }
    case "float": {
      const bits = n.bits;
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "number") fail(`${describe(v)} is not a number.`);
          const x = v as number;
          if (bits === 32) { if (!Number.isNaN(x) && !Object.is(Math.fround(x), x)) fail(`${x} is not exactly a float32 (use float64 or fixed()).`); o.f32(x); }
          else if (bits === 16) { if (!Number.isNaN(x) && !Object.is(fromHalf(toHalf(x)), x)) fail(`${x} is not exactly a float16 (use float32, float64 or fixed()).`); o.f16(x); }
          else o.f64(x);
        },
        r: (i) => (bits === 32 ? i.f32() : bits === 16 ? i.f16() : i.f64()),
      };
    }
    case "varuint": case "varint": {
      const signed = n.kind === "varint";
      const put = n.group ? (o: BitWriter, u: number): void => o.groups(u, n.group) : (o: BitWriter, u: number): void => o.golomb(u, n.k);
      const get = n.group ? (i: BitReader): number => i.groups(n.group) : (i: BitReader): number => i.golomb(n.k);
      return {
        node: n,
        w(o, v) {
          const k = intCheck(v, n.kind);
          if (!Number.isSafeInteger(k)) fail(`${k} is beyond a safe integer.`);
          if (!signed && k < 0) fail(`${k} is negative (a varuint).`);
          if (signed && Math.abs(k) > 2 ** 51) fail(`${k} is beyond a varint's ±2^51.`);
          put(o, signed ? zig(k) : k);
        },
        r: (i) => (signed ? unzig(get(i)) : get(i)),
      };
    }
    case "num":
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "number") fail(`${describe(v)} is not a number.`);
          writeNum(o, v as number, 2);
        },
        r(i, x) {
          const s = i.at;
          const tag = i.bits(2);
          if (x.trace) meta(x, "kind", s, i, NUM_KINDS[tag], "");
          return readNum(i, tag);
        },
      };
    case "biguint": {
      const lim = 1n << BigInt(n.bits);
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "bigint") fail(`${describe(v)} is not a bigint (biguint(${n.bits})).`);
          if ((v as bigint) < 0n || (v as bigint) >= lim) fail(`${v}n is outside biguint(${n.bits}).`);
          o.big(v as bigint, n.bits);
        },
        r: (i) => i.big(n.bits),
      };
    }
    case "enum": {
      // (A Map's keys compare by SameValueZero: 1 and "1" and true stay apart.)
      const index = new Map<unknown, number>(n.values.map((v, k) => [v, k]));
      const limit = n.capacity || n.values.length;
      const width = bitsFor(limit + (n.other ? 1 : 0));
      const str = n.other ? compile({ kind: "string", max: 0 } as Node, []) : null;
      return {
        node: n,
        w(o, v, x) {
          const k = index.get(v);
          if (k === undefined) {
            if (str && typeof v === "string") { if (n.open) o.golomb(limit, 0); else o.bits(limit, width); str.w(o, v, x); return; }
            fail(`${describe(v)} is not one of ${JSON.stringify(n.values.length > 12 ? [...n.values.slice(0, 12), "..."] : n.values)}.`);
          }
          if (n.open) o.golomb(k!, 0); else o.bits(k!, width);
        },
        r(i, x) {
          const s = i.at;
          const k = n.open ? i.golomb(0) : i.bits(width);
          if (str && k === limit) { if (x.trace) meta(x, "other", s, i, k, "not in the list: written out"); return str.r(i, x); }
          if (k >= n.values.length) fail(`Enum index ${k} is not a value this reader knows (it knows ${n.values.length}: data from a newer schema?).`);
          return n.values[k];
        },
      };
    }
    case "string": {
      const lw = n.max ? bitsFor(n.max + 1) : -1;
      const HEX = /^0x(?:[0-9a-f]{2})+$/;
      // (The length goes in the bits; the bytes in the body's text section, where gzip can read them as text.)
      return {
        node: n,
        w(o, v, x) {
          if (typeof v !== "string") fail(`${describe(v)} is not a string.`);
          const s = v as string;
          const text = x.text!;
          if (n.packHex) {
            const packed = HEX.test(s);
            o.bool(packed);
            if (packed) { const len = (s.length - 2) / 2; o.golomb(len - 1, 0); for (let k = 0; k < len; k += 1) text.bits(parseInt(s.slice(2 + k * 2, 4 + k * 2), 16), 8); return; }
          }
          if (!wellFormed(s)) fail("The string has a lone surrogate (not UTF-8 encodable).");
          const b = utf8(s);
          if (n.max && b.length > n.max) fail(`The string is ${b.length} bytes; the max is ${n.max}.`);
          if (lw >= 0) o.bits(b.length, lw); else o.golomb(b.length, 0);
          text.bytes(b);
        },
        r(i, x) {
          const tr = x.tr!;
          if (n.packHex) {
            const s0 = i.at;
            const packed = i.bool();
            if (x.trace) meta(x, "hex", s0, i, packed, packed ? "0x hex, packed as bytes" : "text");
            if (packed) {
              const s1 = i.at;
              const len = i.golomb(0) + 1;
              if (x.trace) meta(x, "length", s1, i, len, `${len} bytes`);
              const t0 = tr.at;
              let out = "0x";
              for (let k = 0; k < len; k += 1) out += tr.bits(8).toString(16).padStart(2, "0");
              if (x.trace) x.trace.meta("text", t0, len * 8, out, `${len} bytes in the text section`);
              return out;
            }
          }
          const s = i.at;
          const len = lw >= 0 ? i.bits(lw) : i.golomb(0);
          if (x.trace) meta(x, "length", s, i, len, `${len} bytes`);
          if (n.max && len > n.max) fail(`The string is ${len} bytes; the max is ${n.max}.`);
          const t0 = tr.at;
          const out = fromUtf8(tr, len);
          if (x.trace) x.trace.meta("text", t0, len * 8, out, `${len} bytes in the text section`);
          return out;
        },
      };
    }
    case "ref": {
      // (A new string is written as a string() would be: packHex packs a "0x" one to its bytes.)
      const text = compile({ kind: "string", max: 0, packHex: n.packHex } as Node, []);
      return {
        node: n,
        w(o, v, x) {
          if (typeof v !== "string") fail(`${describe(v)} is not a string (ref "${n.table}").`);
          const s = v as string;
          const t = x.tables.table(n.table);
          const k = t.index.get(s);
          const size = t.list.length;
          if (k !== undefined) { o.bits(k, bitsFor(size + 1)); return; }
          o.bits(size, bitsFor(size + 1));
          text.w(o, s, x);
          t.list.push(s);
          t.index.set(s, size);
        },
        r(i, x) {
          const t = x.tables.table(n.table);
          const size = t.list.length;
          const s0 = i.at;
          const k = i.bits(bitsFor(size + 1));
          if (k < size) { if (x.trace) meta(x, "index", s0, i, k, `table ${n.table} #${k} of ${size}`); return t.list[k]!; }
          if (k > size) fail(`Table ${n.table} has ${size} strings; the data names #${k}.`);
          if (x.trace) meta(x, "index", s0, i, k, `new: table ${n.table} #${k}`);
          const s = text.r(i, x) as string;
          if (t.index.has(s)) fail(`${JSON.stringify(s)} written again in full (not canonical: it's table ${n.table} #${t.index.get(s)}).`);
          t.list.push(s);
          t.index.set(s, size);
          return s;
        },
      };
    }
    case "bytes":
      return {
        node: n,
        w(o, v) {
          if (!(v instanceof Uint8Array)) fail(`${describe(v)} is not a Uint8Array.`);
          const b = v as Uint8Array;
          if (n.length) { if (b.length !== n.length) fail(`${b.length} bytes; this is exactly ${n.length}.`); } else o.golomb(b.length, 0);
          o.bytes(b);
        },
        r(i, x) {
          const s = i.at;
          const len = n.length || i.golomb(0);
          if (!n.length) if (x.trace) meta(x, "length", s, i, len, `${len} bytes`);
          return i.bytes(len);
        },
      };
    case "hex": {
      const re = /^0x(?:[0-9a-f]{2})*$/;
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "string" || !re.test(v)) fail(`${describe(v)} is not "0x" + lower-case hex byte pairs.`);
          const s = v as string;
          const len = (s.length - 2) / 2;
          if (n.bytes) { if (len !== n.bytes) fail(`${len} bytes of hex; this is exactly ${n.bytes}.`); } else o.golomb(len, 0);
          for (let k = 0; k < len; k += 1) o.bits(parseInt(s.slice(2 + k * 2, 4 + k * 2), 16), 8);
        },
        r(i, x) {
          const s = i.at;
          const len = n.bytes || i.golomb(0);
          if (!n.bytes) if (x.trace) meta(x, "length", s, i, len, `${len} bytes`);
          let out = "0x";
          for (let k = 0; k < len; k += 1) out += i.bits(8).toString(16).padStart(2, "0");
          return out;
        },
      };
    }
    case "const":
      return {
        node: n,
        w(_o, v) { if (!same(v, n.value)) fail(`${describe(v)} is not the constant ${JSON.stringify(n.value)}.`); },
        r: () => structuredClone(n.value),
      };
    case "dyn": return dynCodec(n);
    case "array": {
      const of = compile(n.of, recs);
      const lw = n.max ? bitsFor(n.max + 1) : -1;
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v) && !(ArrayBuffer.isView(v) && !(v instanceof DataView))) fail(`${describe(v)} is not an array.`);
          const a = v as ArrayLike<unknown>;
          if (n.length) { if (a.length !== n.length) fail(`${a.length} items; this is exactly ${n.length}.`); }
          else if (lw >= 0) { if (a.length > n.max) fail(`${a.length} items; the max is ${n.max}.`); o.bits(a.length, lw); }
          else o.golomb(a.length, 0);
          let k = 0;
          try { for (; k < a.length; k += 1) of.w(o, a[k], x); } catch (e) { throw under(e, k, null); }
        },
        r(i, x) {
          const s = i.at;
          const len = n.length || (lw >= 0 ? i.bits(lw) : i.golomb(0));
          if (!n.length) if (x.trace) meta(x, "length", s, i, len, `${len} items`);
          if (n.max && len > n.max) fail(`${len} items; the max is ${n.max}.`);
          // (Items can take no bits at all -- a constant, a one-value enum -- so only an absurd length is refused outright.)
          if (len > 2 ** 28) fail(`${len} items: corrupt data.`);
          const out = new Array<unknown>(len);
          if (x.trace !== null) { for (let k = 0; k < len; k += 1) out[k] = rd(of, i, x, k); return out; }
          let k = 0;
          try { for (; k < len; k += 1) out[k] = of.r(i, x); } catch (e) { throw under(e, k, null); }
          return out;
        },
      };
    }
    case "optional": case "nullable": {
      const of = compile(n.of, recs);
      const none = n.kind === "optional" ? undefined : null;
      return {
        node: n,
        w(o, v, x) {
          const has = n.kind === "optional" ? v !== undefined : v !== null;
          if (n.kind === "nullable" && v === undefined && n.of.kind !== "optional" && n.of.kind !== "default") fail("undefined is not a value here (nullable: give null).");
          o.bool(has);
          if (has) of.w(o, v, x);
        },
        r(i, x) {
          const s = i.at;
          const has = i.bool();
          if (x.trace) meta(x, "present", s, i, has, has ? "present" : n.kind === "optional" ? "absent" : "null");
          return has ? of.r(i, x) : none;
        },
      };
    }
    case "default": {
      const of = compile(n.of, recs);
      // (The default must itself be a value of its type.)
      try { of.w(new BitWriter(16), n.value, fresh()); } catch (e) { throw new SchemaError(`withDefault(): the default isn't a value of its type: ${(e as Error).message}`); }
      return {
        node: n,
        w(o, v, x) {
          if (v === undefined || same(v, n.value)) { o.bool(false); return; }
          o.bool(true);
          of.w(o, v, x);
        },
        r(i, x) {
          const s = i.at;
          const given = i.bool();
          if (x.trace) meta(x, "given", s, i, given, given ? "not the default" : "the default");
          return given ? of.r(i, x) : structuredClone(n.value);
        },
      };
    }
    case "struct": return structCodec(n.fields, n.open, n.ext, recs, n, null);
    case "tuple": {
      const items = n.items.map((it) => compile(it, recs));
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v)) fail(`${describe(v)} is not a tuple (an array of ${items.length}).`);
          const a = v as unknown[];
          if (a.length !== items.length) fail(`A tuple of ${items.length}; got ${a.length} items.`);
          for (let k = 0; k < items.length; k += 1) wr(items[k]!, o, a[k], x, k);
        },
        r(i, x) {
          const out = new Array<unknown>(items.length);
          for (let k = 0; k < items.length; k += 1) out[k] = rd(items[k]!, i, x, k);
          return out;
        },
      };
    }
    case "union": {
      const variants = n.variants.map((f) => {
        const s = f.type as Extract<Node, { kind: "struct" }>;
        return { name: f.name, c: structCodec(s.fields, s.open, s.ext, recs, s, n.tag) };
      });
      const index = new Map(variants.map((v, k) => [v.name, k]));
      const width = bitsFor(n.capacity || variants.length);
      return {
        node: n,
        w(o, v, x) {
          if (typeof v !== "object" || v === null) fail(`${describe(v)} is not an object (a union by "${n.tag}").`);
          const tag = (v as Record<string, unknown>)[n.tag];
          const k = typeof tag === "string" ? index.get(tag) : undefined;
          if (k === undefined) fail(`${n.tag} ${describe(tag)} is not one of ${variants.map((x) => x.name).join(", ")}.`);
          o.bits(k!, width);
          wr(variants[k!]!.c, o, v, x, `${n.tag}(${String(tag)})`);
        },
        r(i, x) {
          const s = i.at;
          const k = i.bits(width);
          const vt = variants[k];
          if (!vt) fail(`Union tag ${k} is not a variant this reader knows (it knows ${variants.length}: data from a newer schema?).`);
          if (x.trace) meta(x, n.tag, s, i, vt!.name, `variant ${k}: ${vt!.name}`);
          const body = rd(vt!.c, i, x, `${n.tag}(${vt!.name})`) as Record<string, unknown>;
          const out: Record<string, unknown> = { [n.tag]: vt!.name };
          for (const key in body) put(out, key, body[key]);
          return out;
        },
      };
    }
    case "alt": {
      const branches = n.of.map((b) => ({ cat: categoryOf(b), c: compile(b, recs) }));
      const width = bitsFor(branches.length);
      return {
        node: n,
        w(o, v, x) {
          const cat = valueCategory(v);
          const k = branches.findIndex((b) => b.cat === cat);
          if (k < 0) fail(`${describe(v)} (${cat}) matches none of ${branches.map((b) => b.cat).join(", ")}.`);
          o.bits(k, width);
          wr(branches[k]!.c, o, v, x, `(${cat})`);
        },
        r(i, x) {
          const s = i.at;
          const k = i.bits(width);
          const b = branches[k];
          if (!b) fail(`Alt branch ${k} doesn't exist.`);
          if (x.trace) meta(x, "branch", s, i, b!.cat, `branch ${k}: ${b!.cat}`);
          return rd(b!.c, i, x, `(${b!.cat})`);
        },
      };
    }
    case "map": {
      const kc = compile(n.key, recs);
      const vc = compile(n.value, recs);
      return {
        node: n,
        w(o, v, x) {
          if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`${describe(v)} is not a record.`);
          const rec = v as Record<string, unknown>;
          const keys = Object.keys(rec).filter((k) => rec[k] !== undefined);
          if (n.order === "sorted") keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          o.golomb(keys.length, 0);
          for (const k of keys) { wr(kc, o, k, x, `${k}(key)`); wr(vc, o, rec[k], x, k); }
        },
        r(i, x) {
          const s = i.at;
          const count = i.golomb(0);
          if (x.trace) meta(x, "count", s, i, count, `${count} entries`);
          const out: Record<string, unknown> = {};
          let last: string | null = null;
          for (let k = 0; k < count; k += 1) {
            const key = rd(kc, i, x, `#${k}(key)`) as string;
            if (Object.hasOwn(out, key)) fail(`The key ${JSON.stringify(key)} is in the map twice.`);
            if (n.order === "sorted" && last !== null && !(last < key)) fail(`Map keys out of order (${JSON.stringify(last)} before ${JSON.stringify(key)}): not canonical.`);
            last = key;
            put(out, key, rd(vc, i, x, key));
          }
          return out;
        },
      };
    }
    case "delta": {
      const first = compile(n.of, recs);
      const of = n.of;
      const g = of.kind === "fixed" ? gridOf(of) : null;
      const toUnits = g ? (v: number): number => g.units(v) : (v: number): number => v;
      const fromUnits = g ? (k: number): number => { const v = g.value(k); return v === 0 ? 0 : v; } : (k: number): number => k;
      const lo = g ? g.lo : of.kind === "uint" || of.kind === "varuint" ? 0 : -Infinity;
      const hi = g ? g.hi : of.kind === "uint" ? 2 ** of.bits - 1 : of.kind === "int" ? 2 ** (of.bits - 1) - 1 : Infinity;
      const lo2 = of.kind === "int" ? -(2 ** (of.bits - 1)) : lo;
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v) && !ArrayBuffer.isView(v)) fail(`${describe(v)} is not an array.`);
          const a = v as ArrayLike<number>;
          o.golomb(a.length, 0);
          if (!a.length) return;
          wr(first, o, a[0], x, 0);
          let prev = toUnits(a[0]!);
          for (let k = 1; k < a.length; k += 1) {
            const e = a[k];
            SCRATCH.reset();
            try { first.w(SCRATCH, e, x); } catch (err) { throw under(err, k, null); }
            const u = toUnits(e!);
            o.golomb(zig(u - prev), n.k);
            prev = u;
          }
        },
        r(i, x) {
          const s = i.at;
          const len = i.golomb(0);
          if (x.trace) meta(x, "length", s, i, len, `${len} items`);
          const out = new Array<number>(len);
          if (!len) return out;
          out[0] = rd(first, i, x, 0) as number;
          let prev = toUnits(out[0]);
          for (let k = 1; k < len; k += 1) {
            const s1 = i.at;
            const d = unzig(i.golomb(n.k));
            prev += d;
            if (prev < lo2 || prev > hi) throw under(new CodecError(`A delta walks out of range (${prev}).`), k, s1);
            out[k] = fromUnits(prev);
            if (x.trace) meta(x, `[${k}]`, s1, i, out[k], `${d >= 0 ? "+" : ""}${d}`);
          }
          return out;
        },
      };
    }
    case "runs": {
      const of = compile(n.of, recs);
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v) && !ArrayBuffer.isView(v)) fail(`${describe(v)} is not an array.`);
          const a = v as ArrayLike<unknown>;
          o.golomb(a.length, 0);
          let k = 0;
          while (k < a.length) {
            let j = k + 1;
            while (j < a.length && same(a[j], a[k])) j += 1;
            wr(of, o, a[k], x, k);
            o.golomb(j - k - 1, 0);
            k = j;
          }
        },
        r(i, x) {
          const s = i.at;
          const len = i.golomb(0);
          if (x.trace) meta(x, "length", s, i, len, `${len} items`);
          const out = new Array<unknown>(len);
          let k = 0;
          let prev: unknown = undefined;
          while (k < len) {
            const v = rd(of, i, x, k);
            if (k > 0 && same(v, prev)) fail(`Two runs of the same value at ${k}: not canonical.`);
            const s1 = i.at;
            const run = i.golomb(0) + 1;
            if (x.trace) meta(x, "run", s1, i, run, `x${run}`);
            if (k + run > len) fail(`A run of ${run} overruns the ${len} items.`);
            for (let j = 0; j < run; j += 1) out[k + j] = j === 0 ? v : structuredClone(v);
            k += run;
            prev = v;
          }
          return out;
        },
      };
    }
    case "lz": {
      const of = compile(n.of, recs);
      const MIN = n.min;
      const WINDOW = 1 << 16;
      const CHAIN = 48;
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v) && !ArrayBuffer.isView(v)) fail(`${describe(v)} is not an array.`);
          const a = v as ArrayLike<number | string | boolean>;
          const L = a.length;
          o.golomb(L, 0);
          // (Hash chains over MIN-item windows; greedy: the longest match, the nearest of equals.)
          const heads = new Map<string, number[]>();
          const keyAt = (p: number): string => { let key = ""; for (let q = 0; q < MIN; q += 1) key += `${typeof a[p + q] === "string" ? "s" : ""}${String(a[p + q])}\u0000`; return key; };
          const insert = (p: number): void => { if (p + MIN > L) return; const key = keyAt(p); let c = heads.get(key); if (!c) { c = []; heads.set(key, c); } c.push(p); if (c.length > CHAIN * 2) c.splice(0, c.length - CHAIN); };
          let i = 0;
          while (i < L) {
            let bestLen = 0, bestDist = 0;
            if (i + MIN <= L) {
              const c = heads.get(keyAt(i));
              if (c) for (let q = c.length - 1, tries = 0; q >= 0 && tries < CHAIN; q -= 1, tries += 1) {
                const j = c[q]!;
                if (i - j > WINDOW) break;
                let len = 0;
                while (i + len < L && a[j + len] === a[i + len]) len += 1;
                if (len > bestLen) { bestLen = len; bestDist = i - j; if (i + len === L) break; }
              }
            }
            if (bestLen >= MIN) {
              o.bool(true);
              o.golomb(bestDist - 1, 0);
              o.golomb(bestLen - MIN, 0);
              for (let q = 0; q < bestLen; q += 1) insert(i + q);
              i += bestLen;
            } else {
              o.bool(false);
              wr(of, o, a[i], x, i);
              insert(i);
              i += 1;
            }
          }
        },
        r(i, x) {
          const s = i.at;
          const L = i.golomb(0);
          if (x.trace) meta(x, "length", s, i, L, `${L} items`);
          const out = new Array<unknown>(L);
          let k = 0;
          while (k < L) {
            const s1 = i.at;
            if (i.bool()) {
              const dist = i.golomb(0) + 1;
              const len = i.golomb(0) + MIN;
              if (x.trace) meta(x, "copy", s1, i, len, `${len} items from ${dist} back`);
              if (dist > k) fail(`A copy from ${dist} back at item ${k} reaches before the start.`);
              if (k + len > L) fail(`A copy of ${len} at item ${k} overruns the ${L} items.`);
              for (let q = 0; q < len; q += 1) out[k + q] = out[k + q - dist];
              k += len;
            } else {
              if (x.trace) meta(x, "literal", s1, i, null, "a literal item");
              out[k] = rd(of, i, x, k);
              k += 1;
            }
          }
          return out;
        },
      };
    }
    case "planes": {
      const lim = 2 ** n.bits;
      return {
        node: n,
        w(o, v) {
          if (!Array.isArray(v) && !ArrayBuffer.isView(v)) fail(`${describe(v)} is not an array.`);
          const a = v as ArrayLike<number>;
          for (let k = 0; k < a.length; k += 1) { const e = a[k]; if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e >= lim) throw under(new CodecError(`${describe(e)} is outside planes(${n.bits})'s 0..${lim - 1}.`), k, null); }
          o.golomb(a.length, 0);
          for (let b = n.bits - 1; b >= 0; b -= 1) { const m = 2 ** b; for (let k = 0; k < a.length; k += 1) o.bits(Math.floor(a[k]! / m) % 2, 1); }
        },
        r(i, x) {
          const s = i.at;
          const len = i.golomb(0);
          if (x.trace) meta(x, "length", s, i, len, `${len} items`);
          const out = new Array<number>(len).fill(0);
          for (let b = n.bits - 1; b >= 0; b -= 1) {
            const s1 = i.at;
            const m = 2 ** b;
            for (let k = 0; k < len; k += 1) if (i.bool()) out[k] = out[k]! + m;
            if (x.trace) meta(x, `plane ${b}`, s1, i, null, `bit ${b} of every value`);
          }
          return out;
        },
      };
    }
    case "named": {
      const of = compile(n.of, recs);
      return { node: n, w: (o, v, x) => of.w(o, v, x), r: (i, x) => of.r(i, x) };
    }
    case "rec": {
      // (A forward: the body is compiled with this on the stack, so a self inside reaches it.)
      const fwd: { c: C | null } = { c: null };
      const self: C = { node: n, w: (o, v, x) => fwd.c!.w(o, v, x), r: (i, x) => fwd.c!.r(i, x) };
      fwd.c = compile(n.of, [...recs, self]);
      return self;
    }
    case "self": {
      const target = recs[recs.length - 1 - n.depth];
      if (!target) throw new SchemaError(`A self node (depth ${n.depth}) outside its recursive().`);
      return { node: n, w: (o, v, x) => target.w(o, v, x), r: (i, x) => target.r(i, x) };
    }
  }
}

/** A value's category (what alt() branches on). */
export function valueCategory(v: unknown): Category {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (v instanceof Uint8Array) return "bytes";
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean" || t === "bigint") return t;
  return "object";
}

function structCodec(fields: readonly Field[], open: boolean, ext: readonly (readonly Field[])[], recs: C[], node: Node, tagKey: string | null): C {
  const fs = fields.map((f) => ({ name: f.name, c: compile(f.type, recs), optional: f.type.kind === "optional" }));
  const groups = ext.map((g) => g.map((f) => ({ name: f.name, c: compile(f.type, recs), optional: f.type.kind === "optional", node: f.type })));
  const known = new Set([...fields, ...ext.flat()].map((f) => f.name));
  if (tagKey !== null) known.add(tagKey);
  // (A field called "__proto__" takes the careful path: an own property, never the prototype.)
  const proto = known.has("__proto__");
  const scratch: BitWriter[] = [];
  const empty = (g: (typeof groups)[number], v: Record<string, unknown>): boolean =>
    g.every((f) => v[f.name] === undefined || (f.node.kind === "default" && same(v[f.name], f.node.value)));
  return {
    node,
    w(o, v, x) {
      if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`${describe(v)} is not an object.`);
      const rec = v as Record<string, unknown>;
      let k = 0;
      let given = tagKey !== null && rec[tagKey] !== undefined ? 1 : 0;
      try {
        for (; k < fs.length; k += 1) { const f = fs[k]!; const fv = rec[f.name]; if (fv !== undefined) given += 1; f.c.w(o, fv, x); }
      } catch (e) { throw under(e, fs[k]!.name, null); }
      if (x.strict) {
        // (Strict: no fields it doesn't have. Counting is cheaper than looking each key up; the slow path names the stranger.)
        let all = 0;
        for (const key in rec) if (rec[key] !== undefined) all += 1;
        if (all > given) {
          for (const g of groups) for (const f of g) if (rec[f.name] !== undefined) given += 1;
          if (all > given) for (const key in rec) if (!known.has(key) && rec[key] !== undefined) fail(`Unknown field ${JSON.stringify(key)} (the fields are ${[...known].join(", ")}).`);
        }
      }
      if (!open) return;
      let count = groups.length;
      while (count > 0 && empty(groups[count - 1]!, rec)) count -= 1;
      o.golomb(count, 0);
      for (let g = 0; g < count; g += 1) {
        const s = scratch.pop() ?? new BitWriter(64);
        s.reset();
        const t0 = x.text!.length;
        for (const f of groups[g]!) wr(f.c, s, rec[f.name], x, f.name);
        // (Its bits' length and its text's: an old reader skips both.)
        o.golomb(s.length, 0);
        o.golomb((x.text!.length - t0) / 8, 0);
        o.append(s);
        scratch.push(s);
      }
    },
    r(i, x) {
      const out: Record<string, unknown> = {};
      if (x.trace !== null || proto) {
        for (let k = 0; k < fs.length; k += 1) {
          const f = fs[k]!;
          const v = rd(f.c, i, x, f.name);
          if (v !== undefined || !f.optional) put(out, f.name, v);
        }
      } else {
        let k = 0;
        try {
          for (; k < fs.length; k += 1) { const f = fs[k]!; const v = f.c.r(i, x); if (v !== undefined || !f.optional) out[f.name] = v; }
        } catch (e) { throw under(e, fs[k]!.name, null); }
      }
      if (!open) return out;
      const s0 = i.at;
      const count = i.golomb(0);
      if (x.trace) meta(x, "groups", s0, i, count, `${count} extension group${count === 1 ? "" : "s"}`);
      for (let g = 0; g < Math.max(count, groups.length); g += 1) {
        const group = groups[g];
        if (g >= count) {
          // (Old data: the fields this group added take their defaults.)
          for (const f of group!) if (f.node.kind === "default") out[f.name] = structuredClone(f.node.value);
          continue;
        }
        const s1 = i.at;
        const len = i.golomb(0);
        const textLen = i.golomb(0);
        if (x.trace) meta(x, `group ${g + 1}`, s1, i, len, `${len} bits, ${textLen} bytes of text`);
        const start = i.at;
        const t0 = x.tr!.at;
        if (!group) {
          i.skip(len);
          x.tr!.skip(textLen * 8);
          if (x.trace) { meta(x, `group ${g + 1} (unknown)`, start, i, null, "skipped: a newer schema's fields"); if (textLen) x.trace.meta(`group ${g + 1} text (unknown)`, t0, textLen * 8, null, "skipped"); }
          continue;
        }
        for (const f of group) {
          const v = rd(f.c, i, x, f.name);
          if (v !== undefined || !f.optional) out[f.name] = v;
        }
        if (i.at - start !== len) fail(`Extension group ${g + 1} is ${len} bits long but its fields read ${i.at - start}.`);
        if (x.tr!.at - t0 !== textLen * 8) fail(`Extension group ${g + 1} has ${textLen} bytes of text but its fields read ${(x.tr!.at - t0) / 8}.`);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- dyn

// (dyn()'s strings and keys share the default table with every ref(): a seed typed in one place and
// carried as free JSON in another is written once.)
const DYN_TABLE = "str";
const DYN_NUMS = "$dyn";
function dynCodec(n: Node): C {
  const str = compile({ kind: "ref", table: DYN_TABLE, packHex: false } as Node, []);
  const w = (o: BitWriter, v: unknown, x: Ctx): void => {
    if (v === null) { o.bits(0, 3); return; }
    switch (typeof v) {
      case "boolean": o.bits(v ? 2 : 1, 3); return;
      case "number":
        if (Number.isSafeInteger(v) && !Object.is(v, -0) && Math.abs(v) <= 2 ** 51) { o.bits(3, 3); o.golomb(zig(v), 0); return; }
        // (Not a whole number: 2 bits more say which kind -- one seen before in this document (its index),
        // a decimal, a float32, a float64. A snapshot repeats its positions and times: each once.)
        o.bits(4, 3);
        {
          const t = x.tables.numbers(DYN_NUMS);
          const at = t.index.get(v);
          if (at !== undefined) { o.bits(0, 2); o.bits(at, bitsFor(t.list.length)); return; }
          writeNum(o, v, 2);
          t.index.set(v, t.list.length);
          t.list.push(v);
        }
        return;
      case "string": o.bits(5, 3); str.w(o, v, x); return;
      case "object": {
        if (Array.isArray(v)) {
          o.bits(6, 3);
          o.golomb(v.length, 0);
          for (let k = 0; k < v.length; k += 1) { try { w(o, v[k], x); } catch (e) { throw under(e, k, null); } }
          return;
        }
        if (ArrayBuffer.isView(v)) fail("A typed array isn't JSON-like (dyn): give an array, or a typed schema.");
        const rec = v as Record<string, unknown>;
        const keys = Object.keys(rec).filter((k) => rec[k] !== undefined);
        o.bits(7, 3);
        // (Its shape: the same keys in the same order as an object before -- that shape's index; else the keys, and it joins the shapes.)
        const t = x.tables.shapes(DYN_NUMS);
        const sig = JSON.stringify(keys);
        const at = keys.length ? t.index.get(sig) : undefined;
        if (at !== undefined) { o.bool(true); o.bits(at, bitsFor(t.list.length)); }
        else {
          o.bool(false);
          o.golomb(keys.length, 0);
          for (const k of keys) str.w(o, k, x);
          if (keys.length) { t.index.set(sig, t.list.length); t.list.push(keys); }
        }
        for (const k of keys) { try { w(o, rec[k], x); } catch (e) { throw under(e, k, null); } }
        return;
      }
      default: fail(`${typeof v} isn't JSON-like (dyn).`);
    }
  };
  const TAGS = ["null", "false", "true", "int", "number", "string", "array", "object"];
  const r = (i: BitReader, x: Ctx): unknown => {
    const s = i.at;
    const tag = i.bits(3);
    if (x.trace) meta(x, "type", s, i, TAGS[tag], TAGS[tag]!);
    switch (tag) {
      case 0: return null;
      case 1: return false;
      case 2: return true;
      case 3: return unzig(i.golomb(0));
      case 4: {
        const s1 = i.at;
        const k = i.bits(2);
        const t = x.tables.numbers(DYN_NUMS);
        if (k === 0) {
          const at = i.bits(bitsFor(t.list.length));
          if (x.trace) meta(x, "repeat", s1, i, at, `the number #${at} again`);
          if (at >= t.list.length) fail(`The number #${at} again, of ${t.list.length}.`);
          return t.list[at];
        }
        if (x.trace) meta(x, "kind", s1, i, NUM_KINDS[k], "");
        const v = readNum(i, k);
        if (t.index.has(v)) fail("A number written again in full (not canonical: it repeats by index).");
        t.index.set(v, t.list.length);
        t.list.push(v);
        return v;
      }
      case 5: return str.r(i, x);
      case 6: {
        const s1 = i.at;
        const len = i.golomb(0);
        if (x.trace) meta(x, "length", s1, i, len, `${len} items`);
        const out = new Array<unknown>(len);
        for (let k = 0; k < len; k += 1) out[k] = x.trace ? rd(self, i, x, k) : r(i, x);
        return out;
      }
      default: {
        const t = x.tables.shapes(DYN_NUMS);
        const s1 = i.at;
        let keys: string[];
        if (i.bool()) {
          const at = i.bits(bitsFor(t.list.length));
          if (at >= t.list.length) fail(`Object shape #${at} of ${t.list.length}.`);
          keys = t.list[at]!;
          if (x.trace) meta(x, "shape", s1, i, at, `shaped like object #${at}: ${keys.length} keys`);
        } else {
          const count = i.golomb(0);
          if (x.trace) meta(x, "keys", s1, i, count, `${count} keys, a new shape`);
          keys = [];
          for (let k = 0; k < count; k += 1) {
            const key = str.r(i, x) as string;
            if (keys.includes(key)) fail(`The key ${JSON.stringify(key)} is in the object twice.`);
            keys.push(key);
          }
          if (count) {
            const sig = JSON.stringify(keys);
            if (t.index.has(sig)) fail("An object's keys written again in full (not canonical: its shape repeats by index).");
            t.index.set(sig, t.list.length);
            t.list.push(keys);
          }
        }
        const out: Record<string, unknown> = {};
        for (const key of keys) put(out, key, x.trace ? rd(self, i, x, key) : r(i, x));
        return out;
      }
    }
  };
  const self: C = { node: n, w, r };
  return self;
}

// ---------------------------------------------------------------- the API

export interface EncodeOptions {
  /** Shared string tables (see createTables): documents encoded with one share their strings. */
  readonly tables?: Tables;
  /** Refuse fields a struct doesn't have (default true). */
  readonly strict?: boolean;
}
export interface DecodeOptions {
  readonly tables?: Tables;
}

const WRITER = new BitWriter(4096);
const TEXT = new BitWriter(1024);
const OUT = new BitWriter(4096);
let writerBusy = false;

// A body: LEB128 of its text section's length, its bits, zero padding to a byte, then the text section
// (every string's UTF-8, in order) -- so the bits stay packed and the text stays text for gzip.
function writeBody(o: BitWriter, c: C, value: unknown, x: Ctx, bits: BitWriter): void {
  c.w(bits, value, x);
  const text = x.text!;
  let n = text.length / 8;
  o.align();
  do { const b = n % 128; n = Math.floor(n / 128); o.bits(b | (n > 0 ? 128 : 0), 8); } while (n > 0);
  o.append(bits);
  o.align();
  o.append(text);
}

/** The value's body (no header: document.ts's encode() adds one): bits, then its text. */
export function encodeRaw<S extends Type<unknown>>(schema: S, value: Infer<S>, opts: EncodeOptions = {}): Uint8Array {
  const reuse = !writerBusy;
  const bits = reuse ? WRITER : new BitWriter(256);
  const text = reuse ? TEXT : new BitWriter(64);
  const out = reuse ? OUT : new BitWriter(256);
  if (reuse) { writerBusy = true; bits.reset(); text.reset(); out.reset(); }
  try {
    writeBody(out, compiled(schema as unknown as Node), value, { tables: opts.tables ?? new Tables(), trace: null, strict: opts.strict ?? true, text, tr: null, last: null }, bits);
    return out.finish();
  } finally {
    if (reuse) writerBusy = false;
  }
}

/** Write a value's body into a writer you hold (it starts on a byte: the writer is aligned first). */
export function writeValue<S extends Type<unknown>>(o: BitWriter, schema: S, value: Infer<S>, opts: EncodeOptions = {}): void {
  writeBody(o, compiled(schema as unknown as Node), value, { tables: opts.tables ?? new Tables(), trace: null, strict: opts.strict ?? true, text: new BitWriter(256), tr: null, last: null }, new BitWriter(1024));
}

/** Read a value's body from a reader you hold: it starts on a byte, and its text section ends where the reader does. */
export function readValue<S extends Type<unknown>>(i: BitReader, schema: S, opts: DecodeOptions & { readonly trace?: Tracer | null } = {}): Infer<S> {
  const c = compiled(schema as unknown as Node);
  try {
    i.align();
    const s0 = i.at;
    let textLen = 0, scale = 1;
    for (;;) { const b = i.bits(8); textLen += (b & 127) * scale; if (!(b & 128)) break; scale *= 128; if (scale > 2 ** 42) throw new CodecError("The text length is too long."); }
    const end = i.endByte;
    if (textLen > end - i.at / 8) throw new CodecError(`The text section is ${textLen} bytes; only ${end - i.at / 8} follow.`, [], s0);
    const tr = new BitReader(i.buf, end - textLen, end);
    i.limit(end - textLen);
    opts.trace?.meta("text length", s0, i.at - s0, textLen, `${textLen} bytes of text at the end`);
    const v = c.r(i, { tables: opts.tables ?? new Tables(), trace: opts.trace ?? null, strict: true, text: null, tr, last: null }) as Infer<S>;
    if (tr.left > 0) throw new CodecError(`${tr.left / 8} bytes of text are left unread (not canonical data).`, [], tr.at);
    return v;
  } catch (e) {
    if (e instanceof BitError) throw new CodecError(e.message.replace(/ at bit \d+/, ""), [], e.bit);
    throw e;
  }
}

/** A value back from encodeRaw()'s bytes: every bit used, the padding zero. */
export function decodeRaw<S extends Type<unknown>>(schema: S, bytes: Uint8Array, opts: DecodeOptions = {}): Infer<S> {
  const i = new BitReader(bytes);
  const v = readValue(i, schema, opts);
  finishReading(i);
  return v;
}

/** Check a reader ended where the data does: zero padding to the byte, nothing after. */
export function finishReading(i: BitReader): void {
  try { i.align(); } catch (e) { throw new CodecError((e as Error).message.replace(/ at bit \d+/, ""), [], (e as BitError).bit ?? null); }
  if (i.left > 0) throw new CodecError(`${i.left / 8} bytes are left after the value (not canonical data).`, [], i.at);
}

/** Check a value against a schema without keeping the bytes (the error says which field and why). */
export function validate<S extends Type<unknown>>(schema: S, value: unknown): value is Infer<S> {
  encodeRaw(schema, value as Infer<S>);
  return true;
}

/** The size of a value's encoding in bits: its bits and its text (no header, no text length, no padding). */
export function sizeOf<S extends Type<unknown>>(schema: S, value: Infer<S>, opts: EncodeOptions = {}): number {
  const bits = new BitWriter(256);
  const text = new BitWriter(64);
  compiled(schema as unknown as Node).w(bits, value, { tables: opts.tables ?? new Tables(), trace: null, strict: opts.strict ?? true, text, tr: null, last: null });
  return bits.length + text.length;
}

/** Re-exported for the JSON view and explain. */
export type { Json };
