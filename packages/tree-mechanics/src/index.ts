// @keel-engine/tree-mechanics: a tree's wood as it really carries itself.
// Per-branch stiffness from the beam law, hierarchical wind sway (trunk,
// limbs and twigs each at their own frequency, each riding the one it grows
// from), sag under snow and animals, storm breaks with falling limbs, and the
// climbable wood as capsules with the weight each piece can bear.

export { createTreeMechanics, gustAt } from "./mechanics.ts";
export type {
  BreakCause, BreakOptions, MechanicsOptions, MovedPose, StormStrike, TreeBreak, TreeForces, TreeLoad, TreeMechanics, TreePose, TreeShape, WoodCapsule, WoodPoint, WoodSpec,
} from "./mechanics.ts";
