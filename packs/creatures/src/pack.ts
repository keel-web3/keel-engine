// The creatures pack: one entity per body plan. build(S, pins) takes the
// creature's seed from the stream (or pins.seed), its size from pins.size
// (else the plan's usual size) and any of its plan's choices as pins; its
// sockets are the rig's contract's (so it keeps body/humanoid or
// body/quadruped) with the creature's own over them.

import { seedFromStream, socketsOf } from "@keel-engine/entity";
import { defineEntity, definePack } from "@keel-engine/runtime";
import type { Choice, EntityDef, Pins } from "@keel-engine/runtime";
import { CREATURE_CHOICES, CREATURE_PLANS, CREATURE_RIGS, CREATURE_SIZE, creatureOf } from "./creature.ts";
import type { Creature, CreaturePlan } from "./creature.ts";

/** The size each plan's entity takes unpinned (metres): its usual height class. */
const USUAL: Readonly<Record<CreaturePlan, number>> = { crawler: 1.4, walker: 2, strider: 2.2, floater: 1.6, flyer: 1.6, rider: 1.8, serpent: 1.8 };
const TITLE: Readonly<Record<CreaturePlan, string>> = {
  crawler: "Crawler (six or eight legs, low and wide)",
  walker: "Walker (a four-legged machine)",
  strider: "Strider (a two-legged walker on bird legs)",
  floater: "Floater (hovers; tentacles)",
  flyer: "Flyer (wings)",
  rider: "Rider (a rider on a beast)",
  serpent: "Serpent (legless, its front raised)",
};

function creatureEntity(plan: CreaturePlan): EntityDef<Creature> {
  const choices: Record<string, Choice> = { ...(CREATURE_CHOICES[plan] as Record<string, Choice>), size: { range: CREATURE_SIZE } };
  const shapes = Object.keys(choices);
  return defineEntity<Creature>({
    id: plan,
    body: CREATURE_RIGS[plan] === "quadruped" ? "body/quadruped@1.0.0" : "body/humanoid@1.0.0",
    title: TITLE[plan],
    tags: ["creature", plan],
    choices,
    shape: shapes,
    look: { roles: plan === "rider" ? { fur: { stuff: "fur" }, cloth: { stuff: "cloth" }, accent: { stuff: "paint" }, furAlt: { stuff: "leather" }, clothAlt: { stuff: "cloth" }, skin: { stuff: "skin" }, dark: { stuff: "dark" }, eye: { stuff: "glow" } } : { fur: { stuff: "fur" }, furAlt: { stuff: "fur" }, accent: { stuff: "paint" }, dark: { stuff: "dark" }, eye: { stuff: "glow" } }, choices: [] },
    build(S, pins: Pins) {
      const { seed, size, ...rest } = pins as Record<string, unknown>;
      const s = typeof seed === "string" ? seed : seedFromStream(S);
      return creatureOf(s, plan, { size: typeof size === "number" ? size : USUAL[plan], pins: rest });
    },
    sockets: (c) => ({ ...socketsOf(c.spec), ...c.sockets }),
  });
}

export const pack = definePack({ entities: CREATURE_PLANS.map(creatureEntity), attributes: [] });
