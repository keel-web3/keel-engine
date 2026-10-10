import { defineManifest } from "@keel-engine/runtime";

export const manifest = defineManifest({
  id: "keel/bake", version: "0.1.2", kind: "runtime", needs: ["keel/render@^0.1", "keel/runtime@^0.1", "keel/core@^0.1", "keel/entity@^0.1", "keel/particles@^0.1", "keel/codec@^0.1"],
  title: "Bake and draw", description: "Cached procedural geometry, automatic error-bounded shader LOD, shared mesh pooling and optional compatible instancing; indexed sprite atlases, spatial culling and streamed preparation. Agent guide: docs/OPTIMIZED_GAMES.md in keel-engine.",
});
