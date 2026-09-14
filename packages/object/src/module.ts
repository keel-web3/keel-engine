import { defineManifest } from "@keel-engine/runtime";

// (Objects are scene entities with parts; their colliders are the physics' boxes.)
export const manifest = defineManifest({
  id: "keel/object",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/scene@^0.1", "keel/physics@^0.1"],
  // (The style contract lives here, with its one always-there style: the engine's own primitives.)
  provides: ["style/pixel@1.0.0"],
  title: "KEEL Engine objects",
  description: "Things that don't move: definitions, placement, colliders, sockets, settling, baking for physics and the renderer; the seeded catalogue of pieces; wedge parts; the style contract (one design, drawn in pixel, voxel or any module's style) and styled objects, world looks, profiles and wind.",
});
