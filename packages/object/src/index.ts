// @keel-engine/object: things that don't move -- definitions, placement,
// colliders, sockets, settling, baking for physics and the renderer -- and the
// seeded catalogue of level pieces and props. Names as in the proof of
// concept's src/object. (Its prims.js lives in @keel-engine/scene, which front
// detection needs; it is re-exported here, not ported twice.)

export {
  SOCKET_KINDS, bakeForPhysics, bakeForRenderer, bottomOf, colliderToWorld, collidersFromParts, defineObject, footprint, frontOfObject, localAabb, movedObject,
  onSocket, placeObject, restsOn, settle, socketOf, socketsOfKind, topsOf, worldAabb, worldColliders, worldRails, worldSockets, yawToShow,
} from "./object.ts";
export type {
  Collider, ColliderSpec, Footprint, Mat, MatTable, ObjectDef, ObjectInstance, ObjectPart, ObjectSpec, PhysicsBake, Placement, RendererBake, RendererBox,
  RendererCapsule, RestMode, SettleOptions, SettleResult, Socket, SocketKind, SocketSpec, Support, Top, WorldBox, WorldSocket,
} from "./object.ts";

export { PIECES, PIECE_KEYS, buildPiece, buildPieceFrom, pieceStream, registerCatalogue } from "./catalogue.ts";
export type { BuiltPiece, Piece, PieceBuilder, PieceContexts, PieceDef, PieceKey, PieceMetas } from "./catalogue.ts";

// (The proof of concept's src/object/prims.js, from its one home.)
export { boxBounds, boxPart, boxSdf, capsuleBounds, capsulePart, capsuleSdf, overTop, toPart } from "@keel-engine/scene";
export type { BoxSpec, CapsuleSpec, PartExtras, PartLike, Prim, PrimPart } from "@keel-engine/scene";

// Wedges as parts: the physics' and renderer's ramp solid (wedge.ts).
export { isWedgeLike, wedgeFromLike, wedgePart } from "./wedge.ts";
export type { WedgePartLike, WedgePrim, WedgeSpec } from "./wedge.ts";

// The style contract: one design, drawn in any style (design.ts, style.ts, pixel.ts, styled.ts, world-look.ts, sway.ts).
export { canonical, collidersOfDesign, designBounds, drawnIn, hashText, solid, solidBounds, solidSdf, thicknessOf } from "./design.ts";
export type { BallSolid, BoxSolid, CapsuleSolid, ConeSolid, CylinderSolid, Design, DesignSolid, SolidKind, SwaySpec, WedgeSolid } from "./design.ts";
export { checkStyle, createStyleRegistry, defaultStyles, registerStyle, resolveStyle, styleChain, styleSetting } from "./style.ts";
export type {
  ObjectStyle, ResolveInput, ResolvedStyle, StyleBuilder, StyleCandidate, StyleChain, StyleParams, StyleRegistry, StyleSetting, StyledPart, StyledParts,
} from "./style.ts";
export { ballPrims, conePrims, cylinderPrims, pixelParts, pixelStyle } from "./pixel.ts";
export {
  TIERS, bakeDesignOf, defineContentPack, defineStyledObject, drawChoices, gridOf, lookFor, placeContent, shapeCount, shapeGrid, solidsDrawn,
} from "./styled.ts";
export type {
  BuildOptions, BuiltObject, ChoiceValue, ContentPack, ContentRecord, Instancing, PlacedContent, StyledBakeDesign, StyledLook, StyledMeta, StyledObjectDef,
  StyledObjectSpec, Tier, Values,
} from "./styled.ts";
export { checkWorldRoles, defineProfile, lookRolesOf, rendererLook, slotOf, worldLook } from "./world-look.ts";
export type { ProfileRole, WorldLookOptions, WorldMaterial, WorldProfile, WorldRoleSpec, WorldRoles } from "./world-look.ts";
export { phaseAt, swayPose, swayShift, swaySignal, swayWeight } from "./sway.ts";
