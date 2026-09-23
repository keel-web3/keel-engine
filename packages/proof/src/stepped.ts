// Stepped sims: provable simulations that split into small jobs -- one per (entity, window) --
// so a race of twenty cars over five laps is a hundred proofs a GPU clears in seconds, then
// one aggregation, instead of one proof of everything.
//
// The rule that makes it sound: a tick is SIMULTANEOUS. Every entity's state at tick t is a pure
// function of the whole field at t-1 (`step(ctx, prev, i, t)` may read any entity's previous
// state, never a current one). Then a job for entity i over a window re-derives i's states from
// the witnessed field and checks them against the witness; the aggregation checks every job of
// a window witnessed the SAME field, that each entity's computed trace equals the trace everyone
// witnessed for it, and that windows chain. The TypeScript here is the reference both guest
// programs (the job, the aggregator) are ported from.
//
//   const S = defineStepped({ init, step, done, encode, decode });
//   const run = runStepped(S, input);                 // the whole trajectory, fast
//   const jobs = jobsOf(S, run, span);                // (entity, window) witnesses
//   const outs = jobs.map((j) => proveJob(S, run.ctx, j));   // what each job commits (reference)
//   aggregate(S, input, run.ctx, outs);               // what the aggregator checks and derives

import { sha256 } from "@keel-engine/codec";
import { createPacker, equalBytes } from "./bytes.ts";

export interface SteppedSpec<I, C, E> {
  /** The immutable per-match context (track, stats, keys...) derived from the input. */
  init(input: I): { ctx: C; entities: E[] };
  /** Entity i at `tick`, from the whole field at tick - 1. Must not read `prev` beyond what it passes in. */
  step(ctx: C, prev: readonly E[], i: number, tick: number): E;
  /** Is the run over after `tick`? A function of the field at that tick only. */
  done(ctx: C, field: readonly E[], tick: number): boolean;
  encode(e: E): Uint8Array;
  decode(b: Uint8Array): E;
}

export interface SteppedRun<C, E> {
  readonly ctx: C;
  /** trajectory[t][i]: entity i after tick t (t = 0 is the initial field). */
  readonly trajectory: E[][];
}

export const defineStepped = <I, C, E>(spec: SteppedSpec<I, C, E>): SteppedSpec<I, C, E> => spec;

export function runStepped<I, C, E>(s: SteppedSpec<I, C, E>, input: I, maxTicks = 1_000_000): SteppedRun<C, E> {
  const { ctx, entities } = s.init(input);
  const trajectory: E[][] = [entities];
  for (let t = 1; t <= maxTicks; t += 1) {
    const prev = trajectory[t - 1]!;
    const next = prev.map((_, i) => s.step(ctx, prev, i, t));
    trajectory.push(next);
    if (s.done(ctx, next, t)) return { ctx, trajectory };
  }
  throw new RangeError(`the run did not finish in ${maxTicks} ticks`);
}

/** sha256 of the field at one tick: every entity's encoding, in order. */
export function fieldHash<E>(s: Pick<SteppedSpec<unknown, unknown, E>, "encode">, field: readonly E[]): Uint8Array {
  const p = createPacker();
  for (const e of field) p.raw(s.encode(e));
  return sha256(p.finish());
}

/** One entity's states across ticks, hashed flat: sha256(encode(s1) || encode(s2) || ...). Encodings are fixed-size, so
 *  the concatenation is unambiguous -- and one pass costs half the blocks of a per-state chain (it's most of a job's work). */
export function traceHash<E>(s: Pick<SteppedSpec<unknown, unknown, E>, "encode">, states: readonly E[]): Uint8Array {
  const p = createPacker();
  for (const e of states) p.raw(s.encode(e));
  return sha256(p.finish());
}

export interface Window { readonly index: number; readonly from: number; readonly to: number }

/** Ticks 1..T cut into windows of `span` ticks ([from, to] inclusive). */
export function windowsOf(lastTick: number, span: number): Window[] {
  const out: Window[] = [];
  for (let from = 1, w = 0; from <= lastTick; from += span, w += 1) out.push({ index: w, from, to: Math.min(lastTick, from + span - 1) });
  return out;
}

/** What a job is handed: the field at from - 1 and every entity's states across the window. */
export interface JobWitness<E> {
  readonly window: Window;
  readonly entity: number;
  readonly boundary: readonly E[];
  /** traces[i][k]: entity i at tick window.from + k. */
  readonly traces: readonly (readonly E[])[];
}

export function jobsOf<C, E>(run: SteppedRun<C, E>, span: number): JobWitness<E>[] {
  return jobsIn(run, windowsOf(run.trajectory.length - 1, span));
}

/**
 * The jobs for windows given outright -- a race cut at its checkpoints, say, rather than every so many ticks. They
 * must tile the run: the first starts at tick 1, each begins where the last ended, and the last ends at the last tick.
 */
export function jobsIn<C, E>(run: SteppedRun<C, E>, windows: readonly Window[]): JobWitness<E>[] {
  const last = run.trajectory.length - 1;
  const n = run.trajectory[0]!.length;
  const jobs: JobWitness<E>[] = [];
  windows.forEach((w, k) => {
    const before = k === 0 ? 1 : windows[k - 1]!.to + 1;
    if (w.index !== k || w.from !== before || w.to < w.from || w.to > last) throw new RangeError("the windows must tile the run, in order");
  });
  if (windows.length && windows[windows.length - 1]!.to !== last) throw new RangeError("the windows must tile the run, in order");
  for (const w of windows) {
    const boundary = run.trajectory[w.from - 1]!;
    const traces = Array.from({ length: n }, (_, i) => run.trajectory.slice(w.from, w.to + 1).map((f) => f[i]!));
    for (let i = 0; i < n; i += 1) jobs.push({ window: w, entity: i, boundary, traces });
  }
  return jobs;
}

/** What a job commits (its public values, beside the program id and the input digest). */
export interface JobOutput<E> {
  readonly window: Window;
  readonly entity: number;
  /** Hash of the witnessed field at from - 1. */
  readonly boundary: Uint8Array;
  /** Hash of every entity's witnessed trace. */
  readonly traces: readonly Uint8Array[];
  /** Hash of this entity's COMPUTED trace. */
  readonly computed: Uint8Array;
  /** This entity's state at the window's last tick (computed). */
  readonly last: E;
}

/** The job program: re-derive entity i across the window from the witnessed field. */
export function proveJob<C, E>(s: SteppedSpec<unknown, C, E>, ctx: C, j: JobWitness<E>): JobOutput<E> {
  const n = j.boundary.length;
  const computed: E[] = [];
  for (let k = 0, t = j.window.from; t <= j.window.to; k += 1, t += 1) {
    const prev = k === 0 ? j.boundary : j.traces.map((tr) => tr[k - 1]!);
    if (prev.length !== n) throw new RangeError("the witness is missing an entity");
    computed.push(s.step(ctx, prev, j.entity, t));
  }
  return {
    window: j.window, entity: j.entity, boundary: fieldHash(s, j.boundary), traces: j.traces.map((tr) => traceHash(s, tr)),
    computed: traceHash(s, computed), last: computed[computed.length - 1]!,
  };
}

/**
 * The aggregator: given every job's output (already proof-verified), check they tile the run and
 * agree, and return the final field. Throws on the first inconsistency.
 */
export function aggregate<I, C, E>(s: SteppedSpec<I, C, E>, input: I, ctx: C, outs: readonly JobOutput<E>[]): { field: E[]; lastTick: number } {
  let field = s.init(input).entities;
  const n = field.length;
  const byWindow = new Map<number, JobOutput<E>[]>();
  for (const o of outs) byWindow.set(o.window.index, [...(byWindow.get(o.window.index) ?? []), o]);
  let expectFrom = 1, lastTick = 0;
  for (let w = 0; byWindow.has(w); w += 1) {
    const jobs = byWindow.get(w)!.slice().sort((a, b) => a.entity - b.entity);
    if (jobs.length !== n || jobs.some((o, i) => o.entity !== i)) throw new RangeError(`window ${w} needs exactly one job per entity`);
    const win = jobs[0]!.window;
    if (win.from !== expectFrom || jobs.some((o) => o.window.from !== win.from || o.window.to !== win.to)) throw new RangeError(`window ${w} does not continue the run`);
    const boundary = fieldHash(s, field);
    for (const o of jobs) {
      if (!equalBytes(o.boundary, boundary)) throw new RangeError(`window ${w}: job ${o.entity} started from another field`);
      if (o.traces.length !== n || o.traces.some((t, i) => !equalBytes(t, jobs[0]!.traces[i]!))) throw new RangeError(`window ${w}: jobs witnessed different traces`);
    }
    jobs.forEach((o, i) => { if (!equalBytes(o.computed, o.traces[i]!)) throw new RangeError(`window ${w}: entity ${i}'s witnessed trace is not what the rules produce`); });
    field = jobs.map((o) => o.last);
    expectFrom = win.to + 1;
    lastTick = win.to;
    const isLast = !byWindow.has(w + 1);
    if (isLast !== s.done(ctx, field, lastTick)) throw new RangeError(isLast ? "the run ends before it is done" : "the run continues after it was done");
  }
  if (lastTick === 0) throw new RangeError("no windows");
  return { field, lastTick };
}

// ---------------------------------------------------------------- the bytes the guests read and commit

/** "HSJW" v1: u32 window · u32 from · u32 to · u32 entity · u32 n · the boundary field · every trace, entity-major. */
export function encodeWitness<E>(s: Pick<SteppedSpec<unknown, unknown, E>, "encode">, j: JobWitness<E>): Uint8Array {
  const p = createPacker().bytes4("HSJW").u8(1).u32(j.window.index).u32(j.window.from).u32(j.window.to).u32(j.entity).u32(j.boundary.length);
  for (const e of j.boundary) p.raw(s.encode(e));
  for (const tr of j.traces) for (const e of tr) p.raw(s.encode(e));
  return p.finish();
}

/** "HSJO" v1: what a job commits; the job's public value is sha256 of these bytes (32 bytes, a Fray chunk statement). */
export function encodeOutput<E>(s: Pick<SteppedSpec<unknown, unknown, E>, "encode">, o: JobOutput<E>): Uint8Array {
  const p = createPacker().bytes4("HSJO").u8(1).u32(o.window.index).u32(o.window.from).u32(o.window.to).u32(o.entity).bytes32(o.boundary).u32(o.traces.length);
  for (const t of o.traces) p.bytes32(t);
  return p.bytes32(o.computed).raw(s.encode(o.last)).finish();
}
