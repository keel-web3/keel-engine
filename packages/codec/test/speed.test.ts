// Speed: a few MB of engine data through the codec, reported (and held to a
// floor well under what it does, so a slow machine doesn't fail it).

import { test } from "node:test";
import assert from "node:assert/strict";
import { lookOf } from "@keel-engine/core";
import { buildPiece, PIECE_KEYS } from "@keel-engine/object";
import { LOOK, OBJECT, array, decodeRaw, encodeRaw, lookRecordOf, objectRecordOf, BitReader, BitWriter } from "../src/index.ts";
import type { ObjectDefLike } from "../src/index.ts";

const time = (f: () => void, rounds: number): number => { f(); const t = performance.now(); for (let k = 0; k < rounds; k += 1) f(); return (performance.now() - t) / rounds; };
const mbs = (bytes: number, ms: number): number => bytes / 1e6 / (ms / 1000);

// (Speeds are reported always, enforced only with KEEL_PERF=1: a shared machine's load isn't the codec's fault.)
const STRICT = process.env["KEEL_PERF"] === "1";

test("speed: the bit stream, and engine documents, in MB/s", () => {
  // The raw stream: 4 M fields of mixed widths.
  const w = new BitWriter(1 << 20);
  const widths = [3, 17, 1, 9, 24, 5, 12, 31];
  const tw = time(() => { w.reset(); for (let k = 0; k < 1 << 22; k += 1) w.bits(k & ((1 << widths[k & 7]!) - 1), widths[k & 7]!); }, 2);
  const bytes = w.finish();
  const tr = time(() => { const r = new BitReader(bytes); for (let k = 0; k < 1 << 22; k += 1) r.bits(widths[k & 7]!); }, 2);
  // Looks: 20,000 of them in one document.
  const looks = Array.from({ length: 20000 }, (_, i) => lookRecordOf(lookOf(`0x${i.toString(16)}`, { cloth: {}, clothAlt: {}, skin: {}, hair: {}, accent: {} })));
  const L = array(LOOK);
  const lb = encodeRaw(L, looks);
  const le = time(() => encodeRaw(L, looks), 5);
  const ld = time(() => decodeRaw(L, lb), 5);
  const json = JSON.stringify(looks).length;
  // Objects: the catalogue.
  const pieces = PIECE_KEYS.flatMap((key) => Array.from({ length: 40 }, (_, i) => objectRecordOf(buildPiece(key, `0x${(i + 1).toString(16)}`) as unknown as ObjectDefLike)));
  const O = array(OBJECT);
  const ob = encodeRaw(O, pieces);
  const oe = time(() => encodeRaw(O, pieces), 5);
  const od = time(() => decodeRaw(O, ob), 5);
  const report = [
    `bit stream: write ${mbs(bytes.length, tw).toFixed(0)} MB/s, read ${mbs(bytes.length, tr).toFixed(0)} MB/s (${(bytes.length / 1e6).toFixed(1)} MB)`,
    `20,000 looks: ${(lb.length / 1024).toFixed(0)} KB (JSON ${(json / 1024).toFixed(0)} KB); encode ${le.toFixed(1)} ms = ${mbs(lb.length, le).toFixed(1)} MB/s (${mbs(json, le).toFixed(0)} MB/s of JSON), decode ${ld.toFixed(1)} ms = ${mbs(lb.length, ld).toFixed(1)} MB/s`,
    `480 catalogue pieces: ${(ob.length / 1024).toFixed(0)} KB; encode ${oe.toFixed(1)} ms = ${mbs(ob.length, oe).toFixed(1)} MB/s, decode ${od.toFixed(1)} ms = ${mbs(ob.length, od).toFixed(1)} MB/s`,
  ];
  console.log(report.map((r) => `  ${r}`).join("\n"));
  if (STRICT) assert.ok(mbs(bytes.length, tw) > 20 && mbs(bytes.length, tr) > 20);
  if (STRICT) assert.ok(mbs(lb.length, le) > 1 && mbs(lb.length, ld) > 1);
  if (STRICT) assert.ok(mbs(ob.length, oe) > 1 && mbs(ob.length, od) > 1);
});
