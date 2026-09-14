// explainBits: a document taken apart, field by field, with the bits each one
// occupies -- what the KEEL desktop editor's bit inspector draws: a tree on
// the left (fields, their types, values and sizes), the hex/bit view on the
// right with each field's range highlighted, hovering either side finds the
// other (nodeAtBit), and a size breakdown (which fields cost the most).
//
//   const x = explainBits(bytes)                // schema from the header (carried or registered)
//   const x = explainBits(bytes, { schema })    // or say which
//   x.root        the value's tree (BitNode: label, path, kind, type, bit, bits, value, note, children)
//   x.header      the header's bytes as a node (null for a bare body)
//   x.spans       every leaf range in bit order: the hex view's colouring, gaps impossible
//   nodeAtBit(x, 1234) -> the deepest node covering bit 1234 (and its ancestors)
//   costs(x)      bits per field path, summed over array items ("parts[].shape(box).c": 4608)

import { BitReader } from "./bits.ts";
import { schemaId, schemaName } from "./canonical.ts";
import { CodecError, pathText, readValue } from "./codec.ts";
import type { Tracer } from "./codec.ts";
import { defaultRegistry, readHeader } from "./document.ts";
import type { Registry } from "./document.ts";
import { gridOf } from "./codec.ts";
import { leafJSON } from "./json.ts";
import type { Json, Node, Type } from "./schema.ts";

/** What a node is, for colouring: a field's value, a container's overhead (lengths, presence bits, tags, table indices), a string's bytes in the text section, the header, the padding. */
export type BitRole = "value" | "overhead" | "text" | "header" | "padding" | "container";

export interface BitNode {
  /** Its name in its parent: a field name, "[3]", "shape(box)", or an overhead's ("length", "present", "index"...). */
  readonly label: string;
  /** From the root: "parts[3].shape(box).c[0]" (overheads: their field's path + "#length"). */
  readonly path: string;
  /** The schema node's kind ("fixed", "struct"...) or, for overheads, "meta". */
  readonly kind: string;
  /** A short type description: "fixed(-8192..8192 step 0.001)", "array of struct", "ref(tags)". */
  readonly type: string;
  readonly role: BitRole;
  /** First bit, from the start of the whole buffer (header included), and how many. */
  readonly bit: number;
  readonly bits: number;
  /** Scalars and overheads: the value, in its JSON view. */
  readonly value?: Json;
  /** What the bits mean when it isn't obvious: "new: table tags #3", "the default", "12 items", "variant 1: capsule". */
  readonly note?: string;
  readonly children?: readonly BitNode[];
}

export interface BitExplanation {
  readonly schema: { readonly id: string; readonly short: string; readonly name: string | null; readonly version: number | null };
  readonly bytes: number;
  readonly totalBits: number;
  readonly header: BitNode | null;
  readonly root: BitNode;
  readonly padding: BitNode | null;
  /** Where the text section starts (bits): every string's bytes, in order, after the padding. */
  readonly textBit: number;
  /** Every leaf range (values, overheads, header, padding, text) in bit order: they tile the buffer. */
  readonly spans: readonly BitNode[];
  /** The decoded value. */
  readonly value: unknown;
}

/** A short description of a schema node. */
export function typeText(n: Node): string {
  switch (n.kind) {
    case "uint": case "int": return `${n.kind}(${n.bits})`;
    case "biguint": return `biguint(${n.bits})`;
    case "planes": return `planes(${n.bits})`;
    case "fixed": { const g = gridOf(n); return `fixed(${n.min}..${n.max} step ${n.step}${n.off === "round" ? "" : `, ${n.off}`}) ${n.k >= 0 ? `${n.delta ? "delta " : ""}golomb k=${n.k}` : `${g.bits}b`}`; }
    case "float": return `float${n.bits}`;
    case "enum": return `enum(${n.values.length}${n.capacity ? ` of ${n.capacity}` : ""}${n.open ? ", open" : ""}${n.other ? ", other" : ""})`;
    case "varuint": case "varint": return n.group ? `${n.kind}(groups of ${n.group})` : `${n.kind}(k=${n.k})`;
    case "string": return n.max ? `string(max ${n.max})` : "string";
    case "ref": return `ref(${n.table})`;
    case "bytes": return n.length ? `bytes(${n.length})` : "bytes";
    case "hex": return n.bytes ? `hex(${n.bytes} bytes)` : "hex";
    case "array": return `array${n.length ? `[${n.length}]` : n.max ? `(max ${n.max})` : ""} of ${typeText(n.of)}`;
    case "optional": case "nullable": return `${n.kind} ${typeText(n.of)}`;
    case "default": return `${typeText(n.of)} = ${JSON.stringify(leafJSON(n.of, n.value))?.slice(0, 24)}`;
    case "struct": return `struct(${n.fields.length + n.ext.flat().length} fields${n.open ? ", open" : ""})`;
    case "tuple": return `tuple(${n.items.length})`;
    case "union": return `union by ${n.tag} (${n.variants.map((v) => v.name).join("|")})`;
    case "alt": return `alt(${n.of.map(typeText).join(" | ")})`;
    case "map": return `map of ${typeText(n.value)}`;
    case "delta": return `delta of ${typeText(n.of)}`;
    case "runs": return `runs of ${typeText(n.of)}`;
    case "lz": return `lz of ${typeText(n.of)}`;
    case "named": return `${n.name}@${n.version}`;
    case "rec": return "recursive";
    case "self": return "(recursion)";
    default: return n.kind;
  }
}

interface Open { label: string; path: string; node: Node; bit: number; children: BitNode[] }

/** Take a document apart (see the top of this file). */
export function explainBits(bytes: Uint8Array, opts: { readonly schema?: Type<unknown>; readonly registry?: Registry; readonly raw?: boolean } = {}): BitExplanation {
  const h = opts.raw ? { mode: "none" as const, id: null, schema: null, bodyByte: 0 } : readHeader(bytes);
  const schema = (opts.schema ?? h.schema ?? (h.id ? (opts.registry ?? defaultRegistry).get(h.id)?.schema : undefined)) as Type<unknown> | undefined;
  if (!schema) throw new CodecError(h.mode === "none" ? "No header: give explainBits a schema." : `Schema ${h.id} isn't in the registry: give explainBits a schema.`);
  const root: Open = { label: "", path: "", node: schema as Node, bit: h.bodyByte * 8, children: [] };
  const stack: Open[] = [root];
  const pathOf = (parent: Open, label: string | number): string => pathText(parent.path ? [parent.path, label] : [label]);
  const tracer: Tracer = {
    open(label, node, bit) {
      const parent = stack[stack.length - 1]!;
      stack.push({ label: typeof label === "number" ? `[${label}]` : label, path: pathOf(parent, label), node, bit, children: [] });
    },
    close(value, bit) {
      const o = stack.pop()!;
      stack[stack.length - 1]!.children.push(finish(o, value, bit));
    },
    meta(label, bit, bits, value, note) {
      const parent = stack[stack.length - 1]!;
      parent.children.push({
        label, path: `${parent.path}#${label}`, kind: "meta", type: label, role: label === "text" ? "text" : "overhead", bit, bits,
        ...(value !== undefined && value !== null ? { value: value as Json } : {}), ...(note ? { note } : {}),
      });
    },
  };
  const finish = (o: Open, value: unknown, end: number): BitNode => {
    let n = o.node;
    while (n.kind === "named" || n.kind === "optional" || n.kind === "nullable" || n.kind === "default") {
      if ((n.kind === "optional" && value === undefined) || (n.kind === "nullable" && value === null)) break;
      n = n.of;
    }
    // (A value node: nothing but overheads under it -- a scalar, an empty list, a dyn number. Else a container.)
    const leaf = !o.children.some((c) => c.role !== "overhead" && c.role !== "text");
    const count = Array.isArray(value) ? `${value.length} items` : "";
    return {
      label: o.label, path: o.path, kind: o.node.kind, type: typeText(o.node), role: leaf ? "value" : "container",
      bit: o.bit, bits: end - o.bit,
      ...(leaf ? { value: value === undefined ? null : leafJSON(n, value) } : {}),
      ...(count ? { note: count } : {}),
      ...(o.children.length ? { children: o.children } : {}),
    };
  };
  const i = new BitReader(bytes, h.bodyByte);
  const value = readValue(i, schema, { trace: tracer });
  const top = finish(root, value, i.at);
  const header: BitNode | null = h.bodyByte ? { label: "header", path: "#header", kind: "meta", type: h.mode === "id" ? "0xB1 + schema id" : "0xB2 + length + schema", role: "header", bit: 0, bits: h.bodyByte * 8, value: h.id ?? null, note: h.mode === "id" ? `schema ${h.id}` : "carries its schema" } : null;
  // (The bits end where the text section begins: the gap between is padding.)
  const textStart = i.endByte * 8;
  const padBits = textStart - i.at;
  const padding: BitNode | null = padBits > 0 ? { label: "padding", path: "#padding", kind: "meta", type: "zero bits", role: "padding", bit: i.at, bits: padBits } : null;
  const spans: BitNode[] = [];
  if (header) spans.push(header);
  const walk = (n: BitNode): void => {
    if (!n.children?.length) { if (n.bits > 0) spans.push(n); return; }
    // (A node's own bits not covered by its children -- a scalar with an overhead child, like a ref's index -- are
    // its own span. Children outside its range -- a string's bytes in the text section -- are walked on their own.)
    let at = n.bit;
    const end = n.bit + n.bits;
    for (const c of n.children) {
      const inside = c.bit >= n.bit && c.bit < end;
      if (inside && c.bit > at && n.role === "value") spans.push({ ...n, bit: at, bits: c.bit - at, children: [] });
      walk(c);
      if (inside) at = Math.max(at, c.bit + c.bits);
    }
    if (at < end && n.role === "value") spans.push({ ...n, bit: at, bits: end - at, children: [] });
  };
  walk(top);
  if (padding) spans.push(padding);
  spans.sort((a, b) => a.bit - b.bit);
  const named = schemaName(schema);
  const id = schemaId(schema);
  return { schema: { id, short: id.slice(0, 8), name: named?.name ?? null, version: named?.version ?? null }, bytes: bytes.length, totalBits: bytes.length * 8, header, root: top, padding, textBit: textStart, spans, value };
}

/** The nodes covering a bit, outermost first (the last is the deepest): hover in the hex view -> the tree. */
export function nodeAtBit(x: BitExplanation, bit: number): BitNode[] {
  const out: BitNode[] = [];
  if (x.header && bit < x.header.bit + x.header.bits) return [x.header];
  if (x.padding && bit >= x.padding.bit && bit < x.padding.bit + x.padding.bits) return [x.padding];
  if (bit >= x.textBit) {
    // (In the text section: the string whose bytes these are.)
    const path: BitNode[] = [];
    const find = (n: BitNode, trail: BitNode[]): boolean => {
      if (n.kind === "meta" && n.label === "text" && bit >= n.bit && bit < n.bit + n.bits) { path.push(...trail, n); return true; }
      return (n.children ?? []).some((c) => find(c, [...trail, n]));
    };
    find(x.root, []);
    return path;
  }
  let n: BitNode | undefined = x.root;
  while (n) {
    out.push(n);
    n = n.children?.find((c) => bit >= c.bit && bit < c.bit + c.bits);
  }
  return out;
}

/** Bits per field path with array indices folded ("parts[].shape(box).c"), overheads under "#": where a document's size goes. */
export function costs(x: BitExplanation): { readonly path: string; readonly bits: number; readonly count: number }[] {
  const m = new Map<string, { bits: number; count: number }>();
  for (const s of x.spans) {
    const key = s.path.replace(/\[\d+\]/g, "[]");
    const e = m.get(key) ?? { bits: 0, count: 0 };
    e.bits += s.bits;
    e.count += 1;
    m.set(key, e);
  }
  return [...m.entries()].map(([path, e]) => ({ path, ...e })).sort((a, b) => b.bits - a.bits);
}
