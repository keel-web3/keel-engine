import { defineManifest } from "@keel-engine/runtime";

// (The view's modes and moves: core's frame, camera's rigs for the chase and first person, terrain's heights for its
// meshes, render's raster types for the solids it fills.)
export const manifest = defineManifest({
  id: "keel/view",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/camera@^0.1", "keel/terrain@^0.1", "keel/render@^0.1"],
  title: "KEEL Engine view modes",
  description: "Deep zoom with pitch buckets, possession (chase and first person) through a command stream, terrain meshes for perspective views, LOD by on-screen size and dithered sprite/solid switching.",
});
