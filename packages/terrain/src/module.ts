import { defineManifest } from "@keel-engine/runtime";

// (The ground's bake goes through keel/bake's cache and queue; colliders are keel/physics' boxes and wedges.)
export const manifest = defineManifest({
  id: "keel/terrain",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/physics@^0.1", "keel/bake@^0.1"],
  title: "KEEL Engine terrain",
  description: "Tile terrain: a chunked grid of integer heights, terrain types and flags; auto-tiling by a rules table; cliffs, ramps, water and bridge spans; merged colliders; walkability, flow fields and HPA* for thousands of units; the ground baked per chunk into palette-true, depth-carrying layers.",
});
