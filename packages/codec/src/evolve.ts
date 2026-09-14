// Schema evolution: can a reader built from one schema read data written with
// another? The rules (README "Evolution") are what the layout allows:
//
//   - an OPEN struct may gain extension groups (extend()): an old reader skips
//     groups it doesn't know (each carries its bit length), a new reader fills
//     in the fields of groups old data lacks (defaults, or absent);
//   - an enum or union may gain values/variants at the END while its width
//     stays the same (declare `capacity` up front); a reader meeting a value it
//     doesn't know fails at that field, saying so;
//   - names, versions and docs may change freely (named() is only a label here);
//   - everything else must match exactly: bit widths, grids, table names,
//     field order, defaults.

import { same } from "./codec.ts";
import { bitsFor } from "./bits.ts";
import type { Field, Node, Type } from "./schema.ts";

export interface Compatibility {
  /** Data written with `writer` decodes with `reader`. */
  readonly ok: boolean;
  /** Why not (each with its path). */
  readonly problems: readonly string[];
  /** It reads, but some values may be ones the reader doesn't know (a grown enum). */
  readonly warnings: readonly string[];
}

const width = (n: { readonly capacity: number }, count: number): number => bitsFor(n.capacity || count);

/** Can data written with `writer` be read with `reader`? */
export function compatibility(writer: Type<unknown>, reader: Type<unknown>): Compatibility {
  const problems: string[] = [];
  const warnings: string[] = [];
  const at = (p: string): string => p || "(root)";
  const unwrap = (n: Node): Node => (n.kind === "named" ? unwrap(n.of) : n);
  const walk = (w0: Node, r0: Node, p: string): void => {
    const w = unwrap(w0);
    const r = unwrap(r0);
    if (w.kind !== r.kind) { problems.push(`${at(p)}: written as ${w.kind}, read as ${r.kind}.`); return; }
    const eq = (what: string, a: unknown, b: unknown): boolean => {
      if (same(a, b)) return true;
      problems.push(`${at(p)}: ${what} ${JSON.stringify(a)} written, ${JSON.stringify(b)} read.`);
      return false;
    };
    const fields = (wf: readonly Field[], rf: readonly Field[], where: string): void => {
      if (!eq(`${where} fields`, wf.map((f) => f.name), rf.map((f) => f.name))) return;
      wf.forEach((f, i) => walk(f.type, rf[i]!.type, `${p}${p ? "." : ""}${f.name}`));
    };
    switch (w.kind) {
      case "uint": case "int": case "biguint": case "planes": eq("bits", w.bits, (r as typeof w).bits); return;
      case "fixed": { const q = r as typeof w; eq("grid", [w.min, w.max, w.step], [q.min, q.max, q.step]); eq("exactness", w.off === "exact", q.off === "exact"); eq("coding (k, delta)", [w.k, w.delta], [q.k, q.delta]); return; }
      case "float": eq("float bits", w.bits, (r as typeof w).bits); return;
      case "varuint": case "varint": { const q = r as typeof w; eq("varint coding", [w.k, w.group], [q.k, q.group]); return; }
      case "string": eq("max", w.max, (r as typeof w).max); return;
      case "ref": eq("table", [w.table, w.packHex], [(r as typeof w).table, (r as typeof w).packHex]); return;
      case "bytes": eq("length", w.length, (r as typeof w).length); return;
      case "hex": eq("bytes", w.bytes, (r as typeof w).bytes); return;
      case "bool": case "dyn": case "num": return;
      case "const": eq("constant", w.value, (r as typeof w).value); return;
      case "enum": {
        const q = r as typeof w;
        if (!eq("open", w.open, q.open) || !eq("other", w.other, q.other)) return;
        if (!w.open) eq("enum width (bits)", bitsFor((w.capacity || w.values.length) + (w.other ? 1 : 0)), bitsFor((q.capacity || q.values.length) + (q.other ? 1 : 0)));
        if (w.other && (w.capacity || w.values.length) !== (q.capacity || q.values.length)) problems.push(`${at(p)}: an enum with other: grow it only within a capacity (the "other" code moves otherwise).`);
        const common = Math.min(w.values.length, q.values.length);
        eq("enum values", w.values.slice(0, common), q.values.slice(0, common));
        if (w.values.length > q.values.length) warnings.push(`${at(p)}: the writer's enum has ${w.values.length - q.values.length} value(s) this reader doesn't know (${w.values.slice(common).map((v) => JSON.stringify(v)).join(", ")}).`);
        return;
      }
      case "array": { const q = r as typeof w; eq("length", [w.length, w.max], [q.length, q.max]); walk(w.of, q.of, `${p}[]`); return; }
      case "optional": case "nullable": case "runs": case "rec": walk(w.of, (r as typeof w).of, p); return;
      case "lz": { const q = r as typeof w; eq("lz min", w.min, q.min); walk(w.of, q.of, `${p}[]`); return; }
      case "default": { const q = r as typeof w; eq("default", w.value, q.value); walk(w.of, q.of, p); return; }
      case "delta": { const q = r as typeof w; eq("delta k", w.k, q.k); walk(w.of, q.of, p); return; }
      case "self": eq("recursion depth", w.depth, (r as typeof w).depth); return;
      case "tuple": { const q = r as typeof w; if (eq("tuple length", w.items.length, q.items.length)) w.items.forEach((x, i) => walk(x, q.items[i]!, `${p}[${i}]`)); return; }
      case "alt": { const q = r as typeof w; if (eq("alt branches", w.of.length, q.of.length)) w.of.forEach((x, i) => walk(x, q.of[i]!, `${p}(${i})`)); return; }
      case "map": { const q = r as typeof w; eq("order", w.order, q.order); walk(w.key, q.key, `${p}{key}`); walk(w.value, q.value, `${p}{}`); return; }
      case "union": {
        const q = r as typeof w;
        eq("tag field", w.tag, q.tag);
        eq("union width (bits)", width(w, w.variants.length), width(q, q.variants.length));
        const common = Math.min(w.variants.length, q.variants.length);
        for (let i = 0; i < common; i += 1) {
          const a = w.variants[i]!, b = q.variants[i]!;
          if (eq(`variant ${i}`, a.name, b.name)) walk(a.type, b.type, `${p}(${a.name})`);
        }
        if (w.variants.length > q.variants.length) warnings.push(`${at(p)}: the writer has variant(s) this reader doesn't know (${w.variants.slice(common).map((v) => v.name).join(", ")}).`);
        return;
      }
      case "struct": {
        const q = r as typeof w;
        if (!eq("open", w.open, q.open)) return;
        fields(w.fields, q.fields, "base");
        const common = Math.min(w.ext.length, q.ext.length);
        for (let g = 0; g < common; g += 1) fields(w.ext[g]!, q.ext[g]!, `extension group ${g + 1}`);
        // (More groups on either side is what extension groups are for.)
        return;
      }
    }
  };
  walk(writer as Node, reader as Node, "");
  return { ok: problems.length === 0, problems, warnings };
}
