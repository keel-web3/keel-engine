// @keel-engine/view: how a game is seen -- an overview that zooms from the
// whole map down to one unit's buttons (continuous, landing on baked scales,
// tilting in pitch buckets), a chase camera behind a possessed unit and a
// first-person view from its eyes (perspective, over keel/render's raster
// mode), and the eased moves between them. Possession goes through a command
// stream a lockstep game can send; the terrain becomes meshes; LOD is by what
// a thing shows at on screen, solids and sprites dissolving into each other.

export { createZoom, nearestRung, zoomLadder } from "./zoom.ts";
export type { PitchBucket, Zoom, ZoomOptions } from "./zoom.ts";

export { DOT_PX, NEAR_PX, bakedScale, orthoPixels, perspectiveScale, solidBandFor, solidShare, spriteLod } from "./lod.ts";
export type { SolidBand, SpriteLod } from "./lod.ts";

export { ACT, COMMAND_BYTES, commandOf, createCommandStream, decodeCommands, encodeCommands, faceOf, moveOf, newDriven, sampleCommand, stepPossessed } from "./possess.ts";
export type { CommandStream, DriveRules, Driven, PossessCommand, PossessInput } from "./possess.ts";

export { VIEW_TIMING, createViewModes, dollyShot, matchingPersp } from "./modes.ts";
export type { OrthoShot, PerspShot, Shot, Vec3, ViewFrame, ViewMode, ViewModes, ViewModesOptions, ViewPhase, ViewTiming } from "./modes.ts";

export { lowestLevel, terrainChunkMesh, terrainDistance, terrainId, terrainRectMesh } from "./terrain-mesh.ts";
export type { TerrainMesh, TerrainMeshOptions } from "./terrain-mesh.ts";

export { pushWorld, worldExtent } from "./solids.ts";
export type { Placement } from "./solids.ts";
