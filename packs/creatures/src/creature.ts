// creatureOf: a seed, a body plan and a size -> a creature: the keel/entity
// spec whose rig it rides (so it animates with the rig's idle, gaits and
// actions), its resolved choices, its height, its own skin over the posed
// skeleton (bake's ExplicitSkin: capsules and boxes by part and role) and its
// sockets.
//
//   const c = creatureOf("7", "crawler", { size: 1.4, pins: { legs: 8 } });
//   const body = bodyShape(c.spec, { pack: "packs/creatures", clips, skin: (s) => c.skin(s), sockets: c.sockets });

import { clipOf, poseSkeleton } from "@keel-engine/entity";
import type { EntitySocket, EntitySpec, Skeleton } from "@keel-engine/entity";
import { pen, resolveChoices, socketsFrom } from "./kit.ts";
import type { ChoiceSpec, CreatureSkin, SlotRoles } from "./kit.ts";
import type { PlanDef } from "./plans/common.ts";
import { crawler } from "./plans/crawler.ts";
import { floater } from "./plans/floater.ts";
import { flyer } from "./plans/flyer.ts";
import { rider } from "./plans/rider.ts";
import { serpent } from "./plans/serpent.ts";
import { strider } from "./plans/strider.ts";
import { walker } from "./plans/walker.ts";

export const CREATURE_PLANS = ["crawler", "walker", "strider", "floater", "flyer", "rider", "serpent"] as const;
export type CreaturePlan = (typeof CREATURE_PLANS)[number];

/** The sizes a creature comes in: its height class, metres. */
export const CREATURE_SIZE: readonly [number, number] = [0.8, 7];

const PLANS: Readonly<Record<CreaturePlan, PlanDef>> = { crawler, walker, strider, floater, flyer, rider, serpent };

/** Every plan's choices: a list of values or a numeric range, each drawn from its own stream off the seed. */
export const CREATURE_CHOICES: Readonly<Record<CreaturePlan, Readonly<Record<string, ChoiceSpec>>>> = Object.freeze(
  Object.fromEntries(CREATURE_PLANS.map((p) => [p, Object.freeze({ ...PLANS[p].choices })])) as Record<CreaturePlan, Readonly<Record<string, ChoiceSpec>>>,
);
/** Which keel/entity rig each plan rides. */
export const CREATURE_RIGS: Readonly<Record<CreaturePlan, "humanoid" | "quadruped">> = Object.freeze(
  Object.fromEntries(CREATURE_PLANS.map((p) => [p, PLANS[p].rig])) as Record<CreaturePlan, "humanoid" | "quadruped">,
);

export interface Creature {
  readonly plan: CreaturePlan;
  readonly seed: string;
  /** The keel/entity spec whose rig it rides: pass it to bodyShape. */
  readonly spec: EntitySpec;
  /** Every choice, resolved (pinned or drawn). */
  readonly pins: Readonly<Record<string, unknown>>;
  /** Metres: its standing top at idle (a flyer's: its own body's, not an altitude). */
  readonly height: number;
  /** The role each part group wears (a part up to its first dot, or "tail.tip"): one role a slot. */
  readonly roles: SlotRoles;
  /** Its own geometry over a posed skeleton (bake's ExplicitSkin). */
  skin(skel: Skeleton): CreatureSkin;
  /** Where held and worn things go: at least head, crown, back, and hand.R or mount. */
  readonly sockets: Readonly<Record<string, EntitySocket>>;
}

export interface CreatureOptions {
  /** Its height class, metres (0.8 .. 7). */
  readonly size: number;
  /** Any of the plan's CREATURE_CHOICES, locked. */
  readonly pins?: Readonly<Record<string, unknown>>;
}

export function creatureOf(seed: string, plan: CreaturePlan, { size, pins = {} }: CreatureOptions): Creature {
  const def = PLANS[plan];
  if (!def) throw new RangeError(`No creature plan "${String(plan)}" (plans: ${CREATURE_PLANS.join(", ")}).`);
  if (typeof size !== "number" || !(size >= CREATURE_SIZE[0] && size <= CREATURE_SIZE[1])) throw new RangeError(`A creature's size is ${CREATURE_SIZE[0]}..${CREATURE_SIZE[1]} m (got ${String(size)}).`);
  const s = String(seed);
  const choices = Object.freeze(resolveChoices(s, plan, def.choices, pins, def.weights));
  const b = def.build(s, size, choices);
  const skin = (skel: Skeleton): CreatureSkin => { const P = pen(b.roles); b.skin(skel, P); return P.done(); };
  const sockets = Object.freeze(socketsFrom(b.spec.rig, b.sites));
  // Its height: the top of its idle pose's first frame (as a bake's idle frame 0 poses it).
  const idle = clipOf(b.spec, "idle")!;
  const k = skin(poseSkeleton(b.spec.rig, idle(b.spec, 0, { phase: 0, landT: 0 }, { speed: 0 }), { pos: [0, 0, 0], yaw: 0 }));
  let height = 0;
  for (const c of k.capsules) height = Math.max(height, c.a[1] + c.r, c.b[1] + c.r);
  for (const x of k.boxes) height = Math.max(height, x.c[1] + x.h[1]);
  return Object.freeze({ plan, seed: s, spec: b.spec, pins: choices, height, roles: b.roles, skin, sockets });
}
