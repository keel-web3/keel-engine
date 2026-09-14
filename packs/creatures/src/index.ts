// packs/creatures: body plans a roster reads apart by -- crawler, walker,
// strider, floater, flyer, rider, serpent -- each its own geometry (capsules
// and boxes by part and role) over a keel/entity rig, so it animates with the
// rig's idle, gaits and actions. See the README for the plans, their choices,
// the part-name convention and the portrait rule.
export { CREATURE_CHOICES, CREATURE_PLANS, CREATURE_RIGS, CREATURE_SIZE, creatureOf } from "./creature.ts";
export type { Creature, CreatureOptions, CreaturePlan } from "./creature.ts";
export { FLOATER_LIFT } from "./plans/floater.ts";
export { groupOf } from "./kit.ts";
export type { ChoiceSpec, CreatureSkin, SkinBox, SkinCapsule, SlotRoles } from "./kit.ts";
export { pack } from "./pack.ts";
