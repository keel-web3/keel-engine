// Action clips (actions.ts): the engine's addition beside the proof of
// concept's clip tables, which stay exactly as they were. An attack winds up,
// strikes in FRONT of the body and recovers; its feet stay on the ground; it
// works for every kind; clipOf finds gaits, idles and actions alike.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_CLIPS, ACTION_PERIOD, HUMANOID_CLIPS, QUADRUPED_CLIPS, actionPose, clipOf, clipsFor, entityOf, isAction, lowestY, poseSkeleton, skinOf } from "../src/index.ts";
import type { EntitySpec } from "../src/index.ts";

const kinds = ["humanoid", "anthro", "animal"] as const;
const skinAt = (spec: EntitySpec, phase: number) => skinOf(spec, poseSkeleton(spec.rig, actionPose(spec, "attack", phase), { pos: [0, 0, 0], yaw: 0 }));

test("the proof of concept's clip tables are untouched: actions live beside them", () => {
  assert.ok(!("attack" in HUMANOID_CLIPS) && !("attack" in QUADRUPED_CLIPS));
  for (const kind of kinds) {
    const spec = entityOf("7", { kind });
    assert.ok(!("attack" in clipsFor(spec)));
    assert.equal(clipOf(spec, "walk"), clipsFor(spec)["walk"], "a gait: the table's own");
    assert.equal(clipOf(spec, "attack"), ACTION_CLIPS[spec.plan].attack);
    assert.equal(clipOf(spec, "use"), ACTION_CLIPS[spec.plan].use);
    assert.equal(clipOf(spec, "nope"), undefined);
  }
  assert.ok(isAction("attack") && isAction("use") && !isAction("walk"));
  assert.equal(ACTION_PERIOD.attack, 0.62);
});

test("an attack strikes in front of the body, feet on the ground, for every kind over many seeds", () => {
  for (const kind of kinds) for (let seed = 0; seed < 40; seed += 1) {
    const spec = entityOf(`atk${seed}`, { kind });
    const where = `${kind} ${spec.species} #${seed}`;
    const rest = skinAt(spec, 0), strike = skinAt(spec, 0.5);
    // Feet: never below the ground, never far off it, through the whole cycle.
    for (let p = 0; p <= 1.0001; p += 0.125) {
      const caps = skinAt(spec, Math.min(0.999, p));
      assert.ok(lowestY(caps) > -0.03 * (spec.plan === "quadruped" ? spec.body.shoulderH : spec.body.H) - 0.01, `${where}: not in the ground at ${p}`);
    }
    // It moves: the strike isn't the rest.
    const moved = rest.reduce((m, c, i) => Math.max(m, Math.hypot(c.b[0] - strike[i]!.b[0], c.b[1] - strike[i]!.b[1], c.b[2] - strike[i]!.b[2])), 0);
    const size = spec.plan === "quadruped" ? spec.body.shoulderH : spec.body.H;
    assert.ok(moved > 0.05 * size, `${where}: the strike moves it (${moved.toFixed(3)} m, ${(moved / size).toFixed(2)} of its size)`);
    if (spec.plan === "humanoid") {
      // The striking hand ends up in front (+z, the frame's front) and below where it was raised.
      const hand = (caps: ReturnType<typeof skinAt>) => caps.find((c) => c.part === "hand.R")!;
      const wound = skinAt(spec, 0.36), hit = skinAt(spec, 0.55);
      assert.ok(hand(wound).a[1] > hand(rest).a[1], `${where}: wound up, the hand is raised`);
      assert.ok(hand(hit).a[2] > hand(rest).a[2], `${where}: the strike lands in front`);
      assert.ok(hand(hit).a[1] < hand(wound).a[1], `${where}: and comes down`);
    } else {
      // Four legs: the lunge carries the head forward.
      const head = (caps: ReturnType<typeof skinAt>) => caps.find((c) => c.part === "head") ?? caps[0]!;
      assert.ok(head(skinAt(spec, 0.56)).a[2] > head(rest).a[2], `${where}: the lunge reaches forward`);
    }
  }
});
