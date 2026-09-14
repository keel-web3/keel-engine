// A TrueType font wrapped as WOFF 1.0, for the import test (Node: zlib compresses the tables).
import { deflateSync } from "node:zlib";
import { u16, u32 } from "./ttf-builder.ts";

/** The same font wrapped as WOFF 1.0 (each table zlib-compressed when that's smaller). */
export function buildWoff(ttf: Uint8Array): Uint8Array {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const n = dv.getUint16(4);
  const entries: Array<{ tag: number[]; data: Uint8Array; orig: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const e = 12 + i * 16;
    const off = dv.getUint32(e + 8), len = dv.getUint32(e + 12);
    const raw = ttf.subarray(off, off + len);
    const z = deflateSync(raw);
    entries.push({ tag: [...ttf.subarray(e, e + 4)], data: z.length < raw.length ? new Uint8Array(z) : raw, orig: len });
  }
  const head = 44 + n * 20;
  const dir: number[] = [];
  const body: number[] = [];
  for (const t of entries) {
    dir.push(...t.tag, ...u32(head + body.length), ...u32(t.data.length), ...u32(t.orig), ...u32(0));
    body.push(...t.data);
    while (body.length % 4) body.push(0);
  }
  const total = head + body.length;
  return Uint8Array.from([...[..."wOFF"].map((c) => c.charCodeAt(0)), ...u32(0x00010000), ...u32(total), ...u16(n), ...u16(0), ...u32(ttf.length), ...u16(1), ...u16(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...dir, ...body]);
}
