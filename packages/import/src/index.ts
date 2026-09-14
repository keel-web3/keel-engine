// @keel-engine/import: 3D models into the engine's own things. glTF/GLB, OBJ
// (+MTL), STL and MagicaVoxel .vox parsed with no dependencies; meshes
// voxelised (surface by triangle-box overlap, solid by flood or parity);
// colours clustered into roles with the source colours kept as a look;
// segmented into parts by every cue (meshes, pieces, materials, narrowing,
// skin weights); a creature split into its rigged body and the attributes it
// wears, each proposed for a socket and sized to it; primitive fits for a
// generative base -- all as builder data, with the op list that replays it.

export { importModel, parseModel, replayImport } from "./pipeline.ts";
export type { AttributeProposal, CreatureReading, ImportInput, ImportOptions, ImportProposal, ImportResult, ProposalPart } from "./pipeline.ts";

export { ImportError, bindPosition, emptyScene, jointPosition, linearToSrgb, sampleTexture, soupOf, srgbToLinear, worldTransforms } from "./scene.ts";
export type { Format, ImportImage, ImportMaterial, ImportMesh, ImportNode, ImportPrimitive, ImportScene, ImportSkin, ImportTexture, Soup, SoupOptions, VoxelSource } from "./scene.ts";

export { GLTF_AXES, Z_UP_AXES, applyPoint, axesToEngine, fromTRS, identity, invert4, mul4 } from "./math.ts";
export type { Axes, Mat4 } from "./math.ts";

export { isGlb, parseGltf, readGlb } from "./gltf.ts";
export type { GltfOptions } from "./gltf.ts";
export { parseMtl, parseObj } from "./obj.ts";
export type { ObjOptions } from "./obj.ts";
export { isBinaryStl, parseStl } from "./stl.ts";
export type { StlOptions } from "./stl.ts";
export { defaultVoxPalette, isVox, parseVox } from "./vox.ts";
export { adler32, crc32, decodePng, encodePng, inflateRaw, inflateZlib, isPng } from "./png.ts";

export { cellIndex, cellOf, voxelize } from "./voxelize.ts";
export type { VoxelGrid, VoxelizeOptions } from "./voxelize.ts";

export { labDistance, linearToOklab, oklabToOklch, oklchToOklab } from "./color.ts";
export type { Lab } from "./color.ts";
export { clusterRoles } from "./roles.ts";
export type { Oklch, RoleCluster, RoleOptions, Roles } from "./roles.ts";

export { idOf, measure, narrowingCut, segmentSource, uniqueIds } from "./segment.ts";
export type { PartEdge, PartKind, PartNode, Segmentation } from "./segment.ts";
export { mapSkeleton, readName, regionOfBone } from "./skeleton.ts";
export type { SkeletonMap } from "./skeleton.ts";
export { ATTRIBUTE_WORDS, boneOfJoint, chooseSocket, classify, featuresOf, socketsByName, socketsInGrid } from "./body.ts";
export type { Classified, PartFeatures, SocketChoice } from "./body.ts";

export { fitCells, fitPart, fittedSkin, insidePrim, rasterPrim, rasterPrims } from "./fit.ts";
export type { FitOptions, PartFit, Prim } from "./fit.ts";

export {
  addBall, addBox, addCapsule, addCylinder, addSheet, addTorus, buildGltf, buildWorlds, meshData, mergeMesh, writeGlb, writeGltfJson, writeObj, writeStl, writeVox,
} from "./write.ts";
export type { GltfBuild, GltfBuildMaterial, GltfBuildNode, GltfBuildPrimitive, MeshData, VertexExtras } from "./write.ts";

export { KNIGHT_JOINTS, SAMPLES, chestBuild, chestSample, crateSample, dogBuild, dogSample, knightBuild, knightSample, robotSample, robotVox, statueMesh, statueSample, woodTexture } from "./samples.ts";
export type { Sample } from "./samples.ts";
