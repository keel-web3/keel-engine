// @keel-engine/lod: level of detail for generated worlds. Pure and GL-free.
// A node's levels are NESTED prefixes of one index buffer (coarse first), so a
// level is an index count and a transition dithers only the delta; selection is
// screen-space error from the true distance, weighted by view angle, with
// hysteresis, dwell and fades; tiles gather the coarsest level for a far pass;
// and the work queue feeds a loader by real progress. keel/bake draws the
// ranges (MeshDraw.range) and the two passes (projectionOf's clip planes).
// Design: docs/LOD_SYSTEM.md.

export { boxDistance, coarsestUnder, facingVisibility, nearestPoint, pixelError, pixelsPerMetre, rangesOf, termError, viewOf } from "./error.ts";
export { createLodSelector, pickTriangles } from "./select.ts";
export type { LodSelector } from "./select.ts";
export { gridTiles } from "./grid.ts";
export type { Tile } from "./grid.ts";
export { createWorkQueue } from "./queue.ts";
export type { WorkJob, WorkQueue } from "./queue.ts";
export type { Facing, LodNode, LodPick, LodPolicy, LodRange, LodStep, LodTerm, LodView, Vec3 } from "./types.ts";
