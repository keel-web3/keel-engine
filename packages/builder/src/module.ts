import { defineManifest } from "@keel-engine/runtime";

// (The builder turns voxels into what the rest of the engine already knows: scene parts, objects, attributes
// fitted by socket, entities on the standard body contracts. It runs in the editor and at load, when a pack's
// voxel asset converts itself.)
export const manifest = defineManifest({
  id: "keel/builder",
  version: "0.1.1",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/runtime@^0.1", "keel/scene@^0.1", "keel/object@^0.1", "keel/entity@^0.1", "keel/codec@^0.1"],
  // (The voxel style for styled objects: registered with keel/object's styles when it loads.)
  provides: ["style/voxel@1.0.0"],
  title: "KEEL Engine builder",
  description: "Voxel models palette-indexed by role, edited by ops, converted to objects, attributes and rigged entities, animated, varied by seed and exported as pack code.",
});
