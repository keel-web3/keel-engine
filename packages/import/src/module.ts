import { defineManifest } from "@keel-engine/runtime";

// (Import is editor-time work -- parsers, a voxeliser, clustering, segmentation -- that no game ships: it hands the
// builder plain builder data and an op list, so it depends on the builder and never the other way round.)
export const manifest = defineManifest({
  id: "keel/import",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/runtime@^0.1", "keel/entity@^0.1", "keel/object@^0.1", "keel/builder@^0.1"],
  title: "KEEL Engine 3D model import",
  description: "glTF/GLB, OBJ+MTL, STL and MagicaVoxel .vox into voxels, roles, parts, a rigged body with socket attributes and fitted primitives -- builder data and a replayable op list.",
});
