// A Solidity decoder for the fixed-layout subset: structs, tuples and
// fixed-length arrays of uint, int, bool, enum and width-coded fixed() fields.
// Every field then sits at a bit offset known when the code is generated, so
// the decoder is straight-line code: one mload and two shifts a field, no
// loops, no bounds but one length check.
//
//   const sol = solidityDecoder(named("keel/tile", t.struct({ x: t.uint(10), kind: t.enum(["grass", "rock"]) })), { name: "TileCodec" });
//   // library TileCodec { struct Value { uint16 x; Kind kind; } enum Kind { grass, rock }
//   //   function decode(bytes memory data) internal pure returns (Value memory v) { ... }       a body (encodeRaw)
//   //   function decodeDocument(bytes memory data) internal pure returns (Value memory v) { ... }  an "id" document }
//
// fixed() comes back as its step count (int256): the value is count x step
// (the comment on the field says the step). Anything else -- strings, arrays
// of any length, optional fields, Golomb-coded numbers -- has no fixed
// offset; generating for it throws, naming the field.

import { schemaName, shortId } from "./canonical.ts";
import { gridOf } from "./codec.ts";
import { bitsFor } from "./bits.ts";
import { SchemaError } from "./schema.ts";
import type { Node, Type } from "./schema.ts";

export interface SolidityOptions {
  /** The library's name (default: from the schema's name, else "Codec"). */
  readonly name?: string;
  /** The pragma (default ^0.8.20). */
  readonly pragma?: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(["address", "bool", "bytes", "string", "mapping", "struct", "enum", "function", "return", "returns", "if", "else", "for", "while", "do", "break", "continue", "contract", "library", "interface", "event", "emit", "public", "private", "internal", "external", "pure", "view", "payable", "memory", "storage", "calldata", "true", "false", "new", "delete", "this", "super", "type", "var", "uint", "int", "fixed", "ufixed", "byte"]);
const pascal = (s: string): string => s.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_m, _a, c: string) => c.toUpperCase()).replace(/^[0-9]/, "_$&");
const sized = (bits: number, signed: boolean): string => `${signed ? "int" : "uint"}${Math.min(256, Math.max(8, Math.ceil(bits / 8) * 8))}`;

/** A Solidity library that decodes a fixed-layout schema's bodies and "id" documents. */
export function solidityDecoder(schema: Type<unknown>, opts: SolidityOptions = {}): string {
  const named = schemaName(schema);
  const lib = opts.name ?? (named ? `${pascal(named.name.split("/").pop()!)}Codec` : "Codec");
  const types: string[] = [];
  const typeNames = new Set<string>();
  const enums = new Map<string, string>();
  const fresh = (base: string): string => { let name = base; for (let k = 2; typeNames.has(name) || enums.has(name); k += 1) name = `${base}${k}`; typeNames.add(name); return name; };
  let total = 0;

  // (Each node: its Solidity type, and the statements that read it at offset `at` into `target`.)
  const walk = (n: Node, path: string, typeHint: string): { type: string; bits: number; read: (at: number, target: string) => string[] } => {
    switch (n.kind) {
      case "named": return walk(n.of, path, typeHint);
      case "uint": return { type: sized(n.bits, false), bits: n.bits, read: (at, target) => [`${target} = ${sized(n.bits, false)}(_bits(data, ${at}, ${n.bits}));`] };
      case "int": return { type: sized(n.bits, true), bits: n.bits, read: (at, target) => [`{ uint256 u = _bits(data, ${at}, ${n.bits}); ${target} = ${sized(n.bits, true)}(int256(u >> 1) ^ -int256(u & 1)); }`] };
      case "bool": return { type: "bool", bits: 1, read: (at, target) => [`${target} = _bits(data, ${at}, 1) == 1;`] };
      case "enum": {
        if (n.open || n.other) throw new SchemaError(`${path || "(root)"}: an open enum, or one with "other", has no fixed width.`);
        const width = bitsFor(n.capacity || n.values.length);
        const idents = n.values.every((v) => typeof v === "string" && IDENT.test(v) && !RESERVED.has(v));
        if (idents && !n.capacity) {
          const name = pascal(typeHint || path || "Kind");
          if (!enums.has(name)) enums.set(name, `  enum ${name} { ${(n.values as string[]).join(", ")} }`);
          return { type: name, bits: width, read: (at, target) => [`{ uint256 e = _bits(data, ${at}, ${width}); require(e < ${n.values.length}, "${lib}: ${path} out of range"); ${target} = ${name}(e); }`] };
        }
        // (Values that aren't identifiers, or room for more: the index.)
        return { type: "uint8", bits: width, read: (at, target) => [`${target} = uint8(_bits(data, ${at}, ${width})); // ${JSON.stringify(n.values)}`] };
      }
      case "fixed": {
        if (n.k >= 0 || n.off === "exact") throw new SchemaError(`${path || "(root)"}: a Golomb-coded or exact fixed() has no fixed width.`);
        const g = gridOf(n);
        return { type: "int256", bits: g.bits, read: (at, target) => [`${target} = int256(_bits(data, ${at}, ${g.bits})) + (${g.lo}); // x ${n.step}`] };
      }
      case "tuple": case "array": {
        const items = n.kind === "tuple" ? n.items : n.length ? Array.from({ length: n.length }, () => n.of) : null;
        if (!items) throw new SchemaError(`${path || "(root)"}: an array of any length has no fixed layout (give it a length).`);
        const parts = items.map((it, i) => walk(it, `${path}[${i}]`, typeHint));
        const t0 = parts[0]!.type;
        if (!parts.every((p) => p.type === t0)) throw new SchemaError(`${path || "(root)"}: a tuple of mixed types (use a struct).`);
        return {
          type: `${t0}[${items.length}]`,
          bits: parts.reduce((a, p) => a + p.bits, 0),
          read: (at, target) => { const out: string[] = []; let o = at; parts.forEach((p, i) => { out.push(...p.read(o, `${target}[${i}]`)); o += p.bits; }); return out; },
        };
      }
      case "struct": {
        if (n.open || n.ext.length) throw new SchemaError(`${path || "(root)"}: an open struct has no fixed layout.`);
        const name = fresh(pascal(typeHint || path.split(".").pop() || "Value"));
        const fields = n.fields.map((f) => {
          if (!IDENT.test(f.name) || RESERVED.has(f.name)) throw new SchemaError(`${path}.${f.name}: not a Solidity identifier.`);
          return { name: f.name, ...walk(f.type, path ? `${path}.${f.name}` : f.name, f.name) };
        });
        types.push(`  struct ${name} {\n${fields.map((f) => `    ${f.type} ${f.name};`).join("\n")}\n  }`);
        return {
          type: name,
          bits: fields.reduce((a, f) => a + f.bits, 0),
          read: (at, target) => { const out: string[] = []; let o = at; for (const f of fields) { out.push(...f.read(o, `${target}.${f.name}`)); o += f.bits; } return out; },
        };
      }
      default:
        throw new SchemaError(`${path || "(root)"}: ${n.kind} has no fixed width (the Solidity decoder takes uint, int, bool, enum and width-coded fixed, in structs, tuples and fixed-length arrays).`);
    }
  };

  let top = schema as Node;
  while (top.kind === "named") top = top.of;
  if (top.kind !== "struct") throw new SchemaError("The Solidity decoder takes a struct at the root.");
  const root = walk(top, "", "Value");
  total = root.bits;
  // (A body is its text length -- 0: a byte -- then the bits: they start at bit 8.)
  const bodyBytes = 1 + Math.ceil(total / 8);
  const id = shortId(schema);
  return `// SPDX-License-Identifier: MIT
// Generated by @keel-engine/codec solidityDecoder from ${named ? `${named.name}@${named.version}` : "a schema"} (id ${id}). Do not edit.
pragma solidity ${opts.pragma ?? "^0.8.20"};

library ${lib} {
  /// The schema's short id: an "id" document's bytes 1..4.
  bytes4 internal constant SCHEMA_ID = 0x${id};
  /// A body's length in bytes (a text length byte, then ${total} bits).
  uint256 internal constant BODY_BYTES = ${bodyBytes};

${[...enums.values(), ...types].join("\n\n")}

  /// Read \`width\` bits (MSB first) at bit \`off\` of \`data\`'s contents.
  function _bits(bytes memory data, uint256 off, uint256 width) private pure returns (uint256 v) {
    uint256 word;
    assembly { word := mload(add(add(data, 32), shr(3, off))) }
    v = (word << (off & 7)) >> (256 - width);
  }

  /// A body, as encodeRaw() writes it.
  function decode(bytes memory data) internal pure returns (${root.type} memory v) {
    return _decodeAt(data, 0);
  }

  /// A document with an "id" header (0xB1 and the schema id), as encode() writes it.
  function decodeDocument(bytes memory data) internal pure returns (${root.type} memory v) {
    require(data.length >= 5 && uint8(data[0]) == 0xB1 && bytes4(uint32(uint8(data[1])) << 24 | uint32(uint8(data[2])) << 16 | uint32(uint8(data[3])) << 8 | uint32(uint8(data[4]))) == SCHEMA_ID, "${lib}: not this schema's document");
    return _decodeAt(data, 5);
  }

  function _decodeAt(bytes memory data, uint256 start) private pure returns (${root.type} memory v) {
    require(data.length == start + BODY_BYTES && uint8(data[start]) == 0, "${lib}: not a body of this schema");
    uint256 b = (start + 1) * 8;
${root.read(0, "v").map((l) => `    ${l.replace(/_bits\(data, (\d+),/g, (_m, o: string) => `_bits(data, b + ${o},`)}`).join("\n")}
  }
}
`;
}
