// Idle acts (idles.ts): standing about, built on the idle clip. Every act, for every humanoid over many seeds and
// through its whole loop: a whole body, feet on the ground; the hands where the act says (a phone in front of the
// chest, a call at the ear, arms folded in front, a wave over the shoulder); the picks deterministic and varied.

import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_ACTS, IDLE_PERIOD, HUMANOID_CLIPS, entityOf, idleActFor, idleActPose, lowestY, posedIdle, skinOf } from "../src/index.ts";
import type { HumanoidSpec, IdleAct } from "../src/index.ts";

const specs = Array.from({ length: 24 }, (_, i) => entityOf(`idle${i}`, { kind: i % 3 === 2 ? "anthro" : "humanoid" }) as HumanoidSpec);
const at = (spec: HumanoidSpec, act: IdleAct, u: number) => posedIdle(spec, act, u * IDLE_PERIOD[act]).bones;

test("every act, every body, the whole loop: finite, feet on the ground", () => {
  for (const spec of specs) for (const act of IDLE_ACTS) for (let u = 0; u < 1; u += 0.0625) {
    const sk = posedIdle(spec, act, u * IDLE_PERIOD[act]), caps = skinOf(spec, sk);
    for (const [name, b] of Object.entries(sk.bones)) assert.ok(b.p.every(Number.isFinite), `${act} ${name}`);
    const low = lowestY(caps), H = spec.body.H;
    assert.ok(low > -0.03 * H - 0.01 && low < 0.06 * H, `${spec.species} ${act} @${u}: feet at ${low}`);
  }
});

test("the hands go where the act says", () => {
  for (const spec of specs) {
    const b = spec.body, H = b.H, chest = b.hipH + b.torso * 0.62;
    const phone = at(spec, "phone", 0.2);
    for (const s of ["L", "R"]) {
      const h = phone[`hand.${s}`]!.p;
      assert.ok(h[2] > b.torsoR * 0.6, `phone: ${s} hand in front (${h[2]})`);
      assert.ok(Math.abs(h[1] - chest) < H * 0.15, `phone: ${s} hand at the chest`);
    }
    const call = at(spec, "call", 0.3)["hand.R"]!.p, neck = at(spec, "call", 0.3)["head"]!.p;
    assert.ok(Math.hypot(call[0] - neck[0], call[1] - neck[1] - b.headR, call[2] - neck[2]) < b.headR * 2.2, "call: the phone at the ear");
    const arms = at(spec, "arms", 0.3);
    // (People's arms cross over; a mouse's short arms only meet.)
    if (spec.species === "human") assert.ok(arms["hand.L"]!.p[0] > arms["hand.R"]!.p[0], "arms: folded, each hand over the other side");
    assert.ok(arms["hand.L"]!.p[2] > 0 && arms["hand.R"]!.p[2] > 0, "arms: in front");
    const wave = at(spec, "wave", 0.4)["hand.R"]!.p, stand = at(spec, "stand", 0.4)["hand.R"]!.p;
    assert.ok(wave[1] > stand[1] + H * 0.3, "wave: the hand up");
    const up = at(spec, "stretch", 0.35)["hand.L"]!.p;
    assert.ok(up[1] > b.hipH + b.torso + b.neck, "stretch: over the head");
    const idleHand = posedIdle(spec, "stand", 1).bones["hand.L"]!.p, watch = at(spec, "watch", 0.3)["hand.L"]!.p;
    assert.ok(watch[1] > idleHand[1] + (b.upperArm + b.forearm) * 0.45 && watch[2] > idleHand[2], "watch: the wrist up in front (as far as its arms reach)");
  }
});

test("standing is the idle clip itself, and an act moves through its loop", () => {
  const spec = specs[0]!;
  assert.deepEqual(idleActPose(spec, "stand", 0.3, 1.7), HUMANOID_CLIPS.idle(spec, 1.7, { phase: 0, landT: 99 }));
  for (const act of IDLE_ACTS.filter((a) => a !== "stand")) {
    // (By its skin, not its joints: a head turning moves the face, not the neck.)
    const skin = (u: number) => skinOf(spec, posedIdle(spec, act, u * IDLE_PERIOD[act]));
    const a = skin(0.05), moved = [0.25, 0.5, 0.75].some((u) => skin(u).some((c, i) => Math.hypot(c.b[0] - a[i]!.b[0], c.b[1] - a[i]!.b[1], c.b[2] - a[i]!.b[2]) > 0.03));
    assert.ok(moved, `${act} moves`);
  }
});

test("who does what: deterministic, every act somebody's, waiting looks up the road more", () => {
  const count = (waiting: boolean) => {
    const n: Partial<Record<IdleAct, number>> = {};
    for (let i = 0; i < 4000; i += 1) { const a = idleActFor(i * 7919, i % 5, waiting); n[a] = (n[a] ?? 0) + 1; }
    return n;
  };
  assert.equal(idleActFor(12345, 2), idleActFor(12345, 2));
  assert.notEqual(new Set(Array.from({ length: 12 }, (_, v) => idleActFor(12345, v))).size, 1, "a person does different things at different stops");
  const free = count(false), waiting = count(true);
  for (const act of IDLE_ACTS) assert.ok((free[act] ?? 0) > 0, `${act} picked`);
  assert.ok((waiting.look ?? 0) > (free.look ?? 0) * 1.8 && (waiting.wave ?? 0) === 0);
});
