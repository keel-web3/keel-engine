// keel/replay: tapes round-trip, checksums see every bit, a recorded run
// verifies, and every kind of tampering is caught -- a changed input names the
// tick it changed at.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHasher, createRecorder, createTape, decodeTape, encodeTape, fromBase64url, toBase64url, verifyRun } from "../src/index.ts";
import type { RunPayload, RunSim } from "../src/index.ts";

// A toy simulation: a ball that a held button pushes up, falling otherwise; done when it lands after tick 50.
interface Toy { y: number; v: number; best: number }
type ToyResult = { best: number; ticks: number };
function toy(header: { seed: number }): RunSim<ToyResult> {
  const s: Toy = { y: header.seed, v: 0, best: header.seed };
  let tick = 0;
  let done = false;
  return {
    get tick() { return tick; },
    get done() { return done; },
    step(word) {
      s.v += ((word & 1) ? 14 : -9.8) / 120;
      s.y += s.v / 120;
      if (s.y > s.best) s.best = s.y;
      tick += 1;
      if (s.y < 0 && tick > 50) done = true;
    },
    checksum: () => createHasher().f64(s.y).f64(s.v).f64(s.best).int(tick).value,
    result: () => ({ best: Math.floor(s.best * 1000), ticks: tick }),
  };
}
function play(pattern: (t: number) => number, seed = 3): RunPayload<{ seed: number }, ToyResult> {
  const header = { seed };
  const rec = createRecorder(toy(header), { header, every: 30 });
  for (let t = 0; t < 2000 && rec.step(pattern(t)); t += 1);
  return rec.finish();
}
const hopper = (t: number): number => (t % 90 < 40 ? 1 : 0);

test("a tape round-trips through its text, run-length coded", () => {
  const tape = createTape();
  const words = Array.from({ length: 5000 }, (_, t) => (t % 300 < 120 ? 1 : t % 777 === 0 ? 0xfffffff0 : 0));
  for (const w of words) tape.push(w);
  const back = decodeTape(encodeTape(tape));
  assert.equal(back.ticks, words.length);
  assert.deepEqual(back.words(), words.map((w) => w >>> 0));
  assert.ok(encodeTape(tape).length < 200, "runs, not words");
  for (const t of [4999, 0, 2500, 10, 3000]) assert.equal(back.at(t), words[t]);
  assert.equal(back.slice(130).words().length, 130);
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 7]);
  assert.deepEqual([...fromBase64url(toBase64url(bytes))], [...bytes]);
});

test("a checksum sees the last bit of a double, and tells -0 from 0", () => {
  const a = createHasher().f64(0.1 + 0.2).value;
  const b = createHasher().f64(0.3).value;
  assert.notEqual(a, b);
  assert.notEqual(createHasher().f64(0).value, createHasher().f64(-0).value);
  assert.equal(createHasher().f64(Number.NaN).value, createHasher().f64(0 / 0).value);
  assert.equal(createHasher().str("run").int(2 ** 40).value, createHasher().str("run").int(2 ** 40).value);
});

test("a recorded run verifies, and its result is derived, not taken", () => {
  const p = play(hopper);
  assert.ok(p.ticks > 50);
  const v = verifyRun(p, toy);
  assert.equal(v.ok, true, v.reason);
  assert.deepEqual(v.result, p.result);
  assert.equal(v.transcript, p.transcript);
});

test("tampering is caught: the result, a checkpoint, the header, the transcript, the length", () => {
  const p = play(hopper);
  assert.match(verifyRun({ ...p, result: { ...p.result, best: p.result.best + 1 } }, toy).reason, /claimed result/);
  const checks = [...p.checks];
  checks[2] = (checks[2]! ^ 1) >>> 0;
  assert.equal(verifyRun({ ...p, checks }, toy).mismatchTick, 90);
  assert.equal(verifyRun({ ...p, header: { seed: 4 } }, toy).ok, false);
  assert.match(verifyRun({ ...p, transcript: "00".repeat(32) }, toy).reason, /transcript/);
  assert.match(verifyRun({ ...p, ticks: p.ticks + 1 }, toy).reason, /tape holds/);
});

test("a changed input names the first checkpoint after it", () => {
  const p = play(hopper);
  const words = decodeTape(p.tape).words();
  words[100] = words[100] ? 0 : 1; // (one tick's button, flipped)
  const tape = createTape();
  for (const w of words) tape.push(w);
  const v = verifyRun({ ...p, tape: encodeTape(tape) }, toy);
  assert.equal(v.ok, false);
  assert.equal(v.mismatchTick, 120);
});

test("the recorder streams its checkpoints and stops when the run is done", () => {
  const header = { seed: 3 };
  const seen: number[] = [];
  const rec = createRecorder(toy(header), { header, every: 60, onCheckpoint: (c) => seen.push(c.tick) });
  let t = 0;
  while (rec.step(0)) t += 1;
  assert.equal(rec.step(1), false);
  const p = rec.finish();
  assert.deepEqual(seen.slice(0, 1), [60]);
  assert.equal(seen[seen.length - 1], p.ticks);
  assert.equal(p.checks.length, seen.length);
  assert.equal(verifyRun(p, toy).ok, true);
});
