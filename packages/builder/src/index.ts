// @keel-engine/builder: build things block by block, the way a voxel builder does,
// and get the engine's own things back. Voxel models palette-indexed by role
// (looks come later), edited by ops with symmetry and undo; greedy-merged
// into as few boxes as the shape allows; converted into objects, attributes
// fitted by socket, and creatures rigged onto the engine's body contracts;
// animated (flags wave, doors swing, windmills turn); varied by seed; baked
// like any entity; exported as one pack file; driven by a JSON op list agents
// can emit.

export { ROLES, ROLE_NAME, createVoxels, inRegion, regionOf, roleCounts, sameVoxels } from "./voxels.ts";
export type { Dense, Region, StandardRole, V3, Vec3i, VoxelModel, VoxelOptions } from "./voxels.ts";

export { createEditor, imagesOf, replayOps } from "./edit.ts";
export type { BrushOp, EditOp, Editor, EditorOptions, HistoryEntry, Symmetry, SymmetryMode, SymmetryOp } from "./edit.ts";

export { decodeVoxels, encodeVoxels, fromBase64, toBase64, voxelStats, voxelsToText } from "./codec.ts";
export { STORE_FORMAT, loadData, loadOps, loadVoxels, storeData, storeOps, storeVoxels, storeVoxelsText } from "./store.ts";

export { AXIS_ORDERS, byGroupAndRole, greedyBoxes, greedyGrid, labelGrid, meshStats, rasterize, rowRuns } from "./mesh.ts";
export type { AxisOrder, GreedyOptions, VoxelBox } from "./mesh.ts";

export { DEFAULT_COLOURS, ENTITY_ROLE_OF, builderLook, entityRoleOf, materialOf } from "./look.ts";
export type { Look, LookMaterial, Oklch } from "./look.ts";

export {
  anchorFor, attributeFromVoxels, capsuleOfBox, fitToSocket, labelNames, metreBoxes, objectFromVoxels, partsFromVoxels, renderSolids, smoothed, voxelAttribute,
} from "./convert.ts";
export type {
  Anchor, AttributeOptions, FitMode, MetreBox, MetreCapsule, ObjectOptions, PartOptions, SmoothOptions, VoxelAttributeShape, VoxelObjectMeta, VoxelPart,
} from "./convert.ts";

export { analyseShape, autoRig, jointError, markSocket, moveJoint, poseVoxels, reassign, regionsOf } from "./rig.ts";
export type { BoundBox, BoundCapsule, LegColumn, PosedSolids, RigAnalysis, RigEdits, SocketMark, VoxelExtras, VoxelRig, VoxelSkin, VoxelSpec } from "./rig.ts";

export { entityFromVoxels, voxelEntity, voxelSockets } from "./entity.ts";
export type { EntityOptions } from "./entity.ts";

export { MOTION_KINDS, checkAnimation, objectRig } from "./animate.ts";
export type { Axis, Motion, MotionKind, ObjectAnimation, ObjectClip, ObjectRig, ObjectSolids } from "./animate.ts";

export { HUMANOID_CLIPS, QUADRUPED_CLIPS, characterBakeDesign, contentHash, creatureDesign, entityMaterials, objectDesign } from "./design.ts";
export type { BuilderDesign, DesignClip, DesignClipInfo, DesignOptions, WornAttribute } from "./design.ts";

export { applyVariation, checkVariation, removeGroup, scaleRegion, variantsOf, variationChoices } from "./variation.ts";
export type { ScaleAnchor, ScaleRule, VariationRules } from "./variation.ts";

export { GENERATOR_KINDS, generate } from "./generate.ts";
export type { GenerateOptions, Generated, GeneratorKind } from "./generate.ts";

export { exportPackFile, literal } from "./export.ts";
export type { AssetSpec, ExportOptions } from "./export.ts";

export { OPS, applyOp, assetOf, attachedAttributes, attachmentModel, bodyOf, buildSession, createSession, opReference, opSchema, opsOf, runOps, streamOps, validateOps } from "./ops.ts";
export type { AgentOp, Attachment, Built, ChangeEvent, ChangeKind, OpError, OpResult, RunResult, Session, Target, TargetKind, WornGroup } from "./ops.ts";

export {
  CHARACTER_MATERIALS, characterDesign, characterEntity, characterLook, characterSolids, characterSpec, checkPart, choiceNames, proportionNames,
} from "./character.ts";
export type { AttributeRegistry, CharacterDesign, CharacterSolids, CharacterSpec, PartDesign, Proportion } from "./character.ts";

export { livePreview } from "./live.ts";

// A voxel model as a population's explicit body (bake's ExplicitBody): a hand-built hero that still wears seeded things and walks.
export { voxelBody, voxelBodyReader } from "./body.ts";
export type { VoxelBody, VoxelBodySkin } from "./body.ts";
export type { LivePreview } from "./live.ts";

// The voxel style (style/voxel@1.0.0): a styled object's design as a VoxelModel and its greedy boxes. Loading the
// builder registers it with the page's styles, so any styled object can be drawn in voxels once keel/builder is in.
export { VOXEL_BOX_LIMIT, designVoxels, voxelParts, voxelStyle, voxelUnitFor } from "./style.ts";
import { registerStyle } from "@keel-engine/object";
import { voxelStyle } from "./style.ts";
registerStyle(voxelStyle);
