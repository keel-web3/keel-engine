// @keel-engine/scene: transforms, bounds, the shape kit, primitives as parts,
// asset registries and front detection. Names as in the proof of concept's
// src/scene (and src/object/prims.js, which front detection needs).

export {
  U, angleOf, ball, box, capsule, cut, cyl, ellipsoid, inter, lathePart, lowest, mat3mul, mk, part, placed, rotateBounds, rotateOnto, rotatedSdf, rotation,
  sphere, torus, turned, unionBounds,
} from "./kit.ts";
export type {
  Axis, Bounds, BoundsLike, LatheSpec, Mat3, Mat3Like, MaterialKnobs, Materials, Part, PartCore, PartFields, PartId, PartOf, PartSpec, Sdf, SdfPart, Shape,
} from "./kit.ts";

export {
  byTag, createEntity, dirToLocal, dirToWorld, entitySdf, hasTag, makeTransform, rotationOf, toLocal, toWorld, withComponent, withTransform, worldSdf,
} from "./entity.ts";
export type { Body, Entity, EntityId, EntityPart, EntitySpec, Oriented, Placed, Transform, TransformInput, Turned } from "./entity.ts";

export {
  aabbOf, containsPoint, distance, localAabbOf, mergeAabb, nearestPart, normalAt, overlaps, partAabbOf, rayAabb, raycast, sphereOf, touching, transformAabb,
} from "./bounds.ts";
export type { BoxOrBody, RayHit, RaycastOptions, Sphere, TouchingOptions } from "./bounds.ts";

export { ASSET_SLOTS, createRegistry, defaultRegistry, defineRealm, makeAsset, roleMatches } from "./registry.ts";
export type { Asset, BuildContext, BuildInfo, Builder, BuilderEntry, BuilderSpec, MakeAssetOptions, PickedBuilder, Realm, Registry, Role } from "./registry.ts";

export { boxBounds, boxPart, boxSdf, capsuleBounds, capsulePart, capsuleSdf, overTop, toPart } from "./prims.ts";
export type { BoxSpec, CapsuleSpec, PartExtras, PartLike, Prim, PrimPart } from "./prims.ts";

export {
  FEATURES, USE_CASES, angleBetween, defineFeature, defineUseCase, detectFront, featureOf, frontEvidence, frontOffFrom, parseFront, wordsOf,
} from "./front.ts";
export type {
  Feature, FeatureHit, FeatureSide, FrontEvidence, FrontLayers, FrontOptions, FrontResult, FrontSource, FrontSpec, FrontThing, Symmetry, UseCase,
} from "./front.ts";
