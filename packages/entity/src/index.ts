// @keel-engine/entity: things that move -- people, anthro animals and animals
// on four legs. A seed makes a spec; its rig is posed by clips (or an animator
// driven by a physics body); a skin turns the posed skeleton into capsules;
// fronts say which way it faces. And the engine's standard body contracts
// (body/humanoid@1.0.0, body/quadruped@1.0.0): their sockets, sockets from a
// spec, the catalogue's species as runtime entities, and attribute fitting.
// Names as in the proof of concept's src/entity.

export {
  IDENTITY, apply, boneFront, boneToWorld, declaredFront, euler, humanoidRig, measuredLengths, mul, poseSkeleton, quadrupedRig, restJoints, restLengths,
  rotX, rotY, rotZ, rotateOnto, solveTwoBone, transpose,
} from "./rig.ts";
export type {
  AnyRig, Bone, Chain, ChainInput, HumanoidBody, HumanoidRig, IkGoal, Place, Plan, Pose, PosedBone, QuadrupedBody, QuadrupedRig, Rig, RootPose, Skeleton, TwoBone,
} from "./rig.ts";

export { ANTHRO_H, CHOICES, EARS, KINDS, LOOK, QUAD, SPECIES, choiceStream, entityOf, optionsOf, readsOf } from "./species.ts";
export type {
  Accessory, ChoiceDef, ChoiceName, ChoiceValues, Coat, Colours, DeclaredFront, EarShape, Ears, EntityOptions, EntityPins, EntitySpec, Features, Hair,
  HumanoidSpec, Kind, Look, Oklch, Outfit, OutfitColour, PackStyle, Pants, QuadLook, QuadrupedSpec, Shoes, Species, TailShape, Top,
} from "./species.ts";

export { DEFAULT_MATERIALS, MAX_CAPSULES, lowestY, materialFor, partsOf, skinOf } from "./skin.ts";
export type { Capsule, MaterialTable, Role, SkinOptions } from "./skin.ts";

export {
  FADES, GAITS, HUMANOID_CLIPS, LAND_TIME, LOCOMOTION, QUADRUPED_CLIPS, QUAD_GAIT_AT, RUN_FROM, WALK, blankPose, blendPoses, clipsFor, footCycle, gaitAt, posed,
  runCfg, seatOf,
} from "./clips.ts";
export type {
  AnyClip, BipedGait, Clip, ClipName, ClipParams, ClipPhase, ClipPose, Foot, HumanoidClipName, PosedOptions, QuadGait, QuadrupedClipName,
} from "./clips.ts";

export { ACTION_CLIPS, ACTION_PERIOD, actionPose, clipOf, isAction } from "./actions.ts";
export type { ActionClipName } from "./actions.ts";

export { animator } from "./animator.ts";
export type { Animator, AnimatorBody, AnimatorOptions, AnimatorSave, AnimatorState, BodyMode, Layer, StepOptions } from "./animator.ts";

export { featurePoints, frontOfEntity } from "./front.ts";
export type { EntityFront, EntityFrontSource, FrontCue, PartCapsule } from "./front.ts";

export { BODY_CONTRACTS, HUMANOID_BODY, QUADRUPED_BODY, contractOf, missingSockets, socketsOf } from "./bodies.ts";
export type { BodyContract, EntitySocket, SocketConvention, SocketSits } from "./bodies.ts";

export { LOOK_CHOICES, choicesFor, groupsFor, rolesFor, seedFromStream, speciesEntities, speciesEntity, speciesId } from "./define.ts";
export type { SpeciesEntityOptions } from "./define.ts";

export { fittedParts, placeAttribute, socketFrame, socketToWorld, wear, worldToSocket } from "./fit.ts";
export type { AttributeBox, AttributeCapsule, AttributeShape, Fitted, FittedBox, PlaceOptions, SocketFrame, Worn } from "./fit.ts";
