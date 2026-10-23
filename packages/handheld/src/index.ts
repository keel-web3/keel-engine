// @keel-engine/handheld: the Chromatic, built from parts for keel/studio. Measured geometry at two detail levels
// (the grid's and the solo page's), its prints drawn crisp at load, per-vertex AO baked once, the inside of a clear
// shell as real parts (solo) or a baked impostor (grid), hit testing on the face and key travel with squash.

export { MM, UNIT, SEGMENTS, toPlan, fromPlan } from "./spec.ts";
export type { Detail } from "./spec.ts";
export { BODY, backPoly, buildParts, domeKey, insides } from "./parts.ts";
export type { HandheldParts, KeyId, Part, Role } from "./parts.ts";
export { CART_LAYOUT, backHeight, boardMasks, cartFace, cartKindOf, defaultSurface, faceHeight, faceMasks, glassPrint } from "./prints.ts";
export type { CartArt, CartKind, Ctx2D, PrintOptions, Surface, SurfaceFactory } from "./prints.ts";
export { KEYS, hitFace, keyTransform } from "./keys.ts";
export type { Hit, KeyMotion, KeyState } from "./keys.ts";
export { SIZE, cartTexture, createHandheldKit, handheldDraw, hexRgb, roleMaterials } from "./scene.ts";
export type { HandheldDraw, HandheldKit, HandheldState, KitOptions, Look } from "./scene.ts";
