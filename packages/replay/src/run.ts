// Runs that prove themselves: record a deterministic simulation's input tape
// with checksums along the way, and verify a run by replaying it from its
// header -- so a score is DERIVED from seed + rules + inputs, never trusted.
//
// A simulation takes part by keeping this contract (RunSim):
//
//   const sim = make(header);  // header: plain JSON -- ruleset, seed, whatever else fixes the run
//   sim.tick;                  // ticks stepped so far
//   sim.step(word);            // one tick with that input word (tape.ts)
//   sim.checksum();            // uint32 over the whole state now (hash.ts)
//   sim.done;                  // true once nothing more can happen
//   sim.result();              // plain JSON the run claims (score, distance...), derived from state
//
// The payload (keel-run@1):
//
//   { format, header, ticks, every, tape, checks: [uint32 at every `every` ticks and at the end],
//     transcript: sha256 hex, result }
//
// `checks` are keel-rts's desync checksums: a verifier names the FIRST tick a
// replay leaves the recording, so a suspicious run can be reproduced up to the
// moment it went wrong. `transcript` is a hash chain (the vault referee's
// transcript digest): each checkpoint hashes the one before, the tick, the
// checksum and the inputs since -- so a run streamed checkpoint by checkpoint
// to a server can't be rewritten after the fact, and the last link commits
// to all of it.

import { sha256, toHex } from "@keel-engine/codec";
import { createTape, decodeTape, encodeTape } from "./tape.ts";
import type { Tape } from "./tape.ts";

export const RUN_FORMAT = "keel-run@1";
const DOMAIN = "keel.run.transcript.v1";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined }; // (an undefined field is left out, as JSON does)

export interface RunSim<R extends Json = Json> {
  readonly tick: number;
  readonly done: boolean;
  step(word: number): void;
  checksum(): number;
  result(): R;
}

export interface RunPayload<H extends Json = Json, R extends Json = Json> {
  format: typeof RUN_FORMAT;
  header: H;
  ticks: number;
  every: number;
  tape: string;
  checks: number[];
  transcript: string;
  result: R;
}

export interface Checkpoint { tick: number; checksum: number; transcript: string }

/** JSON with every object's keys sorted: the one text a value has. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("canonicalJson: a number that isn't finite");
    if (v === undefined || typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") throw new Error(`canonicalJson: ${typeof v} is not JSON`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

const utf8 = (t: string): Uint8Array => new TextEncoder().encode(t);
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const u32be = (n: number): Uint8Array => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** The chain's first link: the domain and the header. */
export const transcriptStart = (header: Json): Uint8Array => sha256(cat(utf8(DOMAIN), utf8(canonicalJson(header))));
/** The next link: the last, the tick, the checksum there, and the input words since the last link. */
export function transcriptNext(prev: Uint8Array, tick: number, checksum: number, words: readonly number[]): Uint8Array {
  const w = new Uint8Array(words.length * 4);
  words.forEach((x, i) => w.set(u32be(x), i * 4));
  return sha256(cat(prev, u32be(tick), u32be(checksum), w));
}

export interface Recorder<H extends Json, R extends Json> {
  readonly sim: RunSim<R>;
  readonly tape: Tape;
  readonly checks: readonly number[];
  readonly transcript: string;
  /** Step the simulation with this tick's input (ignored once the run is done or finished). */
  step(word: number): boolean;
  /** Close the run (a checkpoint at its last tick) and hand back the payload. */
  finish(): RunPayload<H, R>;
}

export interface RecorderOptions<H extends Json> {
  header: H;
  every?: number;
  maxTicks?: number;
  /** Each checkpoint as it's made: what a client streams to a server as it goes. */
  onCheckpoint?: (c: Checkpoint) => void;
}

/** Record a run as it is played. */
export function createRecorder<H extends Json, R extends Json>(sim: RunSim<R>, { header, every = 120, maxTicks = Infinity, onCheckpoint }: RecorderOptions<H>): Recorder<H, R> {
  if (!Number.isInteger(every) || every < 1) throw new Error("recorder: `every` must be a whole number of ticks");
  const tape = createTape();
  const checks: number[] = [];
  let link = transcriptStart(header);
  let since: number[] = [];
  let closed = false;
  const mark = (): void => {
    const checksum = sim.checksum();
    checks.push(checksum);
    link = transcriptNext(link, sim.tick, checksum, since);
    since = [];
    onCheckpoint?.({ tick: sim.tick, checksum, transcript: toHex(link) });
  };
  return {
    sim,
    tape,
    get checks() { return checks; },
    get transcript() { return toHex(link); },
    step(word) {
      if (closed || sim.done || sim.tick >= maxTicks) return false;
      const w = word >>> 0;
      sim.step(w);
      tape.push(w);
      since.push(w);
      if (sim.tick % every === 0) mark();
      return true;
    },
    finish() {
      if (!closed) { if (since.length || checks.length === 0) mark(); closed = true; }
      return { format: RUN_FORMAT, header, ticks: sim.tick, every, tape: encodeTape(tape), checks: [...checks], transcript: toHex(link), result: sim.result() };
    },
  };
}

export interface Verdict<R extends Json = Json> {
  ok: boolean;
  /** Why not, in words ("" when it holds). */
  reason: string;
  /** The first tick the replay left the recording (-1 when none, or when the failure isn't a tick's). */
  mismatchTick: number;
  ticks: number;
  result: R | null;
  transcript: string;
  /** The replayed simulation, where it stopped (a viewer can show the moment it went wrong). */
  sim: RunSim<R> | null;
}

export interface VerifyOptions<R extends Json> {
  maxTicks?: number;
  /** Sees every tick (a replay viewer steps through the same way). */
  onStep?: (sim: RunSim<R>) => void;
}

/** Replay a payload against a fresh simulation and say whether it holds. */
export function verifyRun<H extends Json, R extends Json>(payload: RunPayload<H, R>, make: (header: H) => RunSim<R>, { maxTicks = 10_000_000, onStep }: VerifyOptions<R> = {}): Verdict<R> {
  const fail = (reason: string, extra: Partial<Verdict<R>> = {}): Verdict<R> => ({ ok: false, reason, mismatchTick: -1, ticks: 0, result: null, transcript: "", sim: null, ...extra });
  if (payload?.format !== RUN_FORMAT) return fail(`not a ${RUN_FORMAT} payload`);
  const { header, ticks, every } = payload;
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > maxTicks) return fail("bad tick count");
  if (!Number.isInteger(every) || every < 1) return fail("bad checkpoint spacing");
  if (!Array.isArray(payload.checks)) return fail("no checkpoints");
  let tape: Tape;
  try { tape = decodeTape(payload.tape); } catch (e) { return fail(`bad tape: ${(e as Error).message}`); }
  if (tape.ticks !== ticks) return fail(`the tape holds ${tape.ticks} ticks, the payload says ${ticks}`);
  let sim: RunSim<R>;
  try { sim = make(header); } catch (e) { return fail(`bad header: ${(e as Error).message}`); }
  let link = transcriptStart(header);
  let since: number[] = [];
  let k = 0;
  const check = (): boolean => {
    const c = sim.checksum();
    if (payload.checks[k] !== c) return false;
    link = transcriptNext(link, sim.tick, c, since);
    since = [];
    k += 1;
    return true;
  };
  for (let t = 0; t < ticks; t += 1) {
    if (sim.done) return fail(`the run ended at tick ${sim.tick}; the tape goes on to ${ticks}`, { mismatchTick: sim.tick, sim });
    const w = tape.at(t);
    sim.step(w);
    since.push(w);
    onStep?.(sim);
    if (sim.tick % every === 0 && !check()) return fail(`the checksum differs at tick ${sim.tick}`, { mismatchTick: sim.tick, sim });
  }
  if ((since.length || k === 0) && !check()) return fail(`the checksum differs at the last tick (${sim.tick})`, { mismatchTick: sim.tick, sim });
  if (k !== payload.checks.length) return fail(`${payload.checks.length} checkpoints recorded, ${k} replayed`, { sim });
  const transcript = toHex(link);
  if (transcript !== payload.transcript) return fail("the transcript digest differs", { sim });
  const result = sim.result();
  if (canonicalJson(result) !== canonicalJson(payload.result)) return fail("the claimed result is not the replayed one", { result, sim });
  return { ok: true, reason: "", mismatchTick: -1, ticks, result, transcript, sim };
}
