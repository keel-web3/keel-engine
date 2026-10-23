import assert from "node:assert/strict";
import test from "node:test";
import { PinballEffects } from "../src/effects.ts";
import type { HitPosition } from "../src/effects.ts";
import type { PinballViewEvent } from "../src/types.ts";

const position: HitPosition = { x: 242, y: 300, layer: 0, kind: "emerald" };
const event = (id: string): PinballViewEvent => ({ id, tick: 20, type: "bumper", colliderId: "coil-a" });

test("repeated event delivery produces one deterministic contact", () => {
  const a = new PinballEffects(), b = new PinballEffects();
  a.ingest([event("20:bumper:coil-a"), event("20:bumper:coil-a")]);
  b.ingest([event("20:bumper:coil-a")]);
  a.advance(0, () => position, 42); b.advance(0, () => position, 42);
  assert.equal(a.pulses.length, 1);
  assert.deepEqual(a.particles, b.particles);
  a.ingest([event("20:bumper:coil-a")]); a.advance(0, () => position, 42);
  assert.equal(a.pulses.length, 1);
  assert.equal(a.particles.length, 5);
});

test("an adversarial event burst keeps every presentation collection bounded", () => {
  const effects = new PinballEffects(12);
  effects.ingest(Array.from({ length: 10_000 }, (_, i) => event(String(i))));
  assert.equal(effects.queuedEvents, 64);
  assert.equal(effects.rememberedEvents, 512);
  effects.advance(0, () => position, 7);
  assert.equal(effects.queuedEvents, 0);
  assert.equal(effects.particles.length, 12);
  assert.equal(effects.pulses.length, 32);
  for (let i = 0; i < 20; i++) effects.advance(50, () => position, 7);
  assert.equal(effects.particles.length, 0);
  assert.equal(effects.pulses.length, 0);
  effects.clear();
  assert.equal(effects.rememberedEvents, 0);
  effects.ingest([event("0")]); effects.advance(0, () => position, 7);
  assert.equal(effects.pulses.length, 1);
});

test("reduced motion retains immediate contact while removing sparks", () => {
  const effects = new PinballEffects(256, true);
  effects.ingest([event("first")]); effects.advance(0, () => position, 7);
  assert.equal(effects.particles.length, 0);
  assert.equal(effects.pulses.length, 1);
  effects.advance(50, () => position, 7); effects.advance(50, () => position, 7);
  assert.equal(effects.pulses.length, 0);
});

test("events without a canonical contact location cannot invent effects", () => {
  const effects = new PinballEffects();
  effects.ingest([event("missing")]); effects.advance(0, () => undefined, 7);
  assert.equal(effects.particles.length, 0);
  assert.equal(effects.pulses.length, 0);
});
