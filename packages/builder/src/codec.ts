// The compact form a KEEL module carries: bytes, run-length encoded and
// gzip-friendly (every field byte-aligned, runs of the same byte where the
// model is plain), and as base64 text for a TypeScript file.
//
//   const bytes = encodeVoxels(model);    // Uint8Array
//   const text = voxelsToText(model);     // "KV1:" + base64 -- what exported pack code embeds
//   decodeVoxels(text)                    // the same model back (cells, roles, groups, unit, origin, name)
//
// Layout (all integers LEB128 varints; signed ones zigzagged):
//   "KV" 1                       magic and version
//   flags                        1 origin · 2 groups · 4 name
//   unit                         in tenths of a millimetre
//   roles                        count, then each: length, ASCII
//   origin                       (flag 1) x, y, z as signed half-voxels
//   min, size                    the bounding box (signed min, unsigned size)
//   runs                         over the box, x fastest then y then z: [index byte, length - 1]
//                                until the box is covered
//   groups                       (flag 2) count; each: name, region count, regions (6 signed)
//   name                         (flag 4) length, UTF-8

import { createVoxels } from "./voxels.ts";
import type { V3, VoxelModel } from "./voxels.ts";

const MAGIC = [0x4b, 0x56, 0x01];

class Out {
  bytes: number[] = [];
  u(v: number): void {
    if (!Number.isInteger(v) || v < 0) throw new RangeError(`varint ${v}`);
    while (v >= 0x80) { this.bytes.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    this.bytes.push(v);
  }
  s(v: number): void { this.u(v >= 0 ? v * 2 : -v * 2 - 1); }
  str(t: string): void { const b = new TextEncoder().encode(t); this.u(b.length); for (const x of b) this.bytes.push(x); }
}
class In {
  i = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  u(): number {
    let v = 0, mul = 1, byte: number;
    do {
      if (this.i >= this.b.length) throw new RangeError("Voxel data ends early.");
      byte = this.b[this.i++]!;
      v += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte & 0x80);
    return v;
  }
  s(): number { const v = this.u(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  str(): string { const n = this.u(); const t = new TextDecoder().decode(this.b.subarray(this.i, this.i + n)); this.i += n; return t; }
}

/** The model as bytes (see the layout above). */
export function encodeVoxels(m: VoxelModel): Uint8Array {
  const o = new Out();
  o.bytes.push(...MAGIC);
  const groups = [...m.groups].filter(([, rs]) => rs.length);
  const flags = (m.origin ? 1 : 0) | (groups.length ? 2 : 0) | (m.name && m.name !== "model" ? 4 : 0);
  o.u(flags);
  o.u(Math.round(m.unit * 10000));
  // (Only roles something uses, in first-use order over the box: a model that dropped a role doesn't carry it.)
  const d = m.dense();
  const used: number[] = [];
  const remap = new Uint8Array(256);
  for (const v of d.data) if (v && !remap[v]) { used.push(v); remap[v] = used.length; }
  o.u(used.length);
  for (const v of used) o.str(m.roles[v - 1]!);
  if (m.origin) for (const c of m.origin) o.s(Math.round(c * 2));
  for (const c of d.min) o.s(c);
  for (const c of d.size) o.u(c);
  // (The dense box is x fastest, then y, then z -- runs along rows.)
  let i = 0;
  while (i < d.data.length) {
    const v = remap[d.data[i]!]!;
    let j = i + 1;
    while (j < d.data.length && remap[d.data[j]!] === v) j += 1;
    o.bytes.push(v);
    o.u(j - i - 1);
    i = j;
  }
  if (flags & 2) {
    o.u(groups.length);
    for (const [name, rs] of groups) {
      o.str(name);
      o.u(rs.length);
      for (const r of rs) for (const c of [...r.min, ...r.max]) o.s(c);
    }
  }
  if (flags & 4) o.str(m.name);
  return Uint8Array.from(o.bytes);
}

/** Bytes (or text from voxelsToText) back to a model. */
export function decodeVoxels(data: Uint8Array | string): VoxelModel {
  const bytes = typeof data === "string" ? textToBytes(data) : data;
  const r = new In(bytes);
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) throw new TypeError("Not voxel data (no KV header).");
  if (bytes[2] !== MAGIC[2]) throw new TypeError(`Voxel data version ${bytes[2]}: this builder reads version ${MAGIC[2]}.`);
  r.i = 3;
  const flags = r.u();
  const unit = r.u() / 10000;
  const n = r.u();
  const roles: string[] = [];
  for (let k = 0; k < n; k += 1) roles.push(r.str());
  const origin: V3 | null = flags & 1 ? [r.s() / 2, r.s() / 2, r.s() / 2] : null;
  const min: V3 = [r.s(), r.s(), r.s()];
  const size: V3 = [r.u(), r.u(), r.u()];
  const m = createVoxels({ unit, roles, origin });
  const total = size[0] * size[1] * size[2];
  let i = 0;
  while (i < total) {
    const v = bytes[r.i++]!;
    const len = r.u() + 1;
    if (v > roles.length) throw new RangeError(`Voxel data names role ${v} of ${roles.length}.`);
    if (v) for (let k = i; k < i + len; k += 1) {
      const x = k % size[0];
      const y = Math.floor(k / size[0]) % size[1];
      const z = Math.floor(k / (size[0] * size[1]));
      m.setIndex(min[0] + x, min[1] + y, min[2] + z, v);
    }
    i += len;
  }
  if (i !== total) throw new RangeError("Voxel runs overrun the box.");
  if (flags & 2) {
    const g = r.u();
    for (let k = 0; k < g; k += 1) {
      const name = r.str();
      const c = r.u();
      const rs = [];
      for (let q = 0; q < c; q += 1) rs.push({ min: [r.s(), r.s(), r.s()] as V3, max: [r.s(), r.s(), r.s()] as V3 });
      m.groups.set(name, rs);
    }
  }
  if (flags & 4) m.name = r.str();
  return m;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** base64url, no padding (no globals: the same on every page and in Node). */
export function toBase64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    const k = Math.min(3, b.length - i) + 1;
    for (let j = 0; j < k; j += 1) out += B64[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}
export function fromBase64(t: string): Uint8Array {
  const clean = t.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j += 1) {
      const c = j < chunk.length ? B64.indexOf(chunk[j]!) : 0;
      if (c < 0) throw new TypeError(`Not base64url: "${chunk[j]}".`);
      n = (n << 6) | c;
    }
    const k = chunk.length - 1;
    for (let j = 0; j < k; j += 1) out.push((n >> (16 - 8 * j)) & 255);
  }
  return Uint8Array.from(out);
}

/** The model as text: "KV1:" + base64url of its bytes. */
export const voxelsToText = (m: VoxelModel): string => `KV1:${toBase64(encodeVoxels(m))}`;
function textToBytes(t: string): Uint8Array {
  const s = t.trim();
  if (!s.startsWith("KV1:")) throw new TypeError('Voxel text starts "KV1:".');
  return fromBase64(s.slice(4));
}

/** How big a model is: raw cells, dense box bytes, encoded bytes, text characters. */
export function voxelStats(m: VoxelModel): { cells: number; box: number; bytes: number; text: number } {
  const d = m.dense();
  const bytes = encodeVoxels(m).length;
  return { cells: m.count, box: d.data.length, bytes, text: 4 + Math.ceil((bytes * 4) / 3) };
}
