import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createPacker, createReader, defineStepped, jobsOf, proveJob, runStepped, windowsOf, type JobOutput } from "../src/index.ts";

// A toy field: movers on a line; each moves toward the one ahead but never passes it (reads only t-1).
interface M { readonly x: number; readonly v: number }
const TOY = defineStepped<{ n: number }, { goal: number }, M>({
  init: ({ n }) => ({ ctx: { goal: 500 }, entities: Array.from({ length: n }, (_, i) => ({ x: -i * 10, v: 3 + (i % 3) })) }),
  step: (ctx, prev, i) => {
    const me = prev[i]!;
    const ahead = prev.filter((o) => o.x > me.x).sort((a, b) => a.x - b.x)[0];
    let x = me.x + me.v;
    if (ahead && ahead.x < ctx.goal && x > ahead.x - 2) x = Math.max(me.x, ahead.x - 2);
    return { x: Math.min(ctx.goal, x), v: me.v };
  },
  done: (ctx, field) => field.every((m) => m.x >= ctx.goal),
  encode: (m) => createPacker().u32(m.x + 1000).u8(m.v).finish(),
  decode: (b) => { const r = createReader(b); return { x: r.u32() - 1000, v: r.u8() }; },
});

test("a stepped run splits into (entity, window) jobs that aggregate back to the run", () => {
  const run = runStepped(TOY, { n: 5 });
  const last = run.trajectory.length - 1;
  assert.deepEqual(windowsOf(10, 4).map((w) => [w.from, w.to]), [[1, 4], [5, 8], [9, 10]]);
  const outs = jobsOf(run, 37).map((j) => proveJob(TOY, run.ctx, j));
  const { field, lastTick } = aggregate(TOY, { n: 5 }, run.ctx, outs);
  assert.equal(lastTick, last);
  assert.deepEqual(field, run.trajectory[last]);
});

test("the aggregator refuses a lie in any job, a missing job, and a short run", () => {
  const run = runStepped(TOY, { n: 4 });
  const jobs = jobsOf(run, 30);
  // A witness that moved entity 2 further than the rules allow: its own job's computed trace disagrees.
  const bad = jobs.map((j) => (j.window.index === 1 ? { ...j, traces: j.traces.map((tr, i) => (i === 2 ? tr.map((m) => ({ ...m, x: m.x + 1 })) : tr)) } : j));
  assert.throws(() => aggregate(TOY, { n: 4 }, run.ctx, bad.map((j) => proveJob(TOY, run.ctx, j))), /rules produce|different traces|another field/);
  const outs: JobOutput<M>[] = jobs.map((j) => proveJob(TOY, run.ctx, j));
  assert.throws(() => aggregate(TOY, { n: 4 }, run.ctx, outs.filter((o) => !(o.window.index === 0 && o.entity === 1))), /exactly one job/);
  const lastW = Math.max(...outs.map((o) => o.window.index));
  assert.throws(() => aggregate(TOY, { n: 4 }, run.ctx, outs.filter((o) => o.window.index !== lastW)), /before it is done/);
});
