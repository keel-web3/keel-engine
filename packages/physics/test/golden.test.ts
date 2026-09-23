// The port of the proof of concept's tests/physics-golden.test.mjs, pins and
// all: recorded input sequences through fixed worlds of boxes, a rail and
// water, fingerprinted step by step (position, velocity, mode and events, to
// the last bit). The pins were the proof of concept's own hashes until the
// body moved to core's dmath (fixtures.ts says why): now they are the same on
// every CPU and engine, which is what a replay or a lockstep peer needs. If
// one of these moves, the body's feel moved -- WALLRUN's autopilot and every
// project's tuning with it. (Re-pin only on purpose, with the reason.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { COURSE, PINS, SKIM, YARD, coursePilot, skimDrive, trace, wanderInputs } from "./fixtures.ts";

test("golden: the course run is the recorded one, to the bit", () => {
  const r = trace(COURSE, coursePilot, { steps: 120 * 16 });
  for (const m of ["ground", "air", "wall", "grind"]) assert.ok(r.modes[m]! > 0, `the run visits ${m}: ${JSON.stringify(r.modes)}`);
  for (const e of ["jumped", "wallStart", "wallJump", "railStart", "railEnd", "landed"]) assert.ok(r.events[e]! > 0, `the run has ${e}: ${JSON.stringify(r.events)}`);
  assert.equal(r.hash, PINS.course, JSON.stringify({ modes: r.modes, events: r.events, pos: r.body.pos }));
});

for (const seed of [1, 2, 3] as const) {
  test(`golden: wandering the yard (seed ${seed}) is the recorded walk, to the bit`, () => {
    const next = wanderInputs(seed);
    const r = trace(YARD, () => next(), { steps: 120 * 20 });
    assert.equal(r.hash, PINS[`yard${seed}`], JSON.stringify({ modes: r.modes, events: r.events, pos: r.body.pos }));
  });
}

test("golden: a skim and a sink are the recorded ones", () => {
  // Fast off a pad over open water: it skims, slows, sinks, respawns.
  const r = trace(SKIM, skimDrive, { steps: 120 * 8 });
  for (const e of ["skimStart", "splashIn", "respawn"]) assert.ok(r.events[e]! > 0, `${e}: ${JSON.stringify(r.events)}`);
  assert.equal(r.hash, PINS.skim, JSON.stringify({ modes: r.modes, events: r.events }));
});
