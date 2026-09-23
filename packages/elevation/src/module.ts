import { defineManifest } from "@keel-engine/runtime";

// (Heights and the shaping of them -- no renderer, no physics: those read it.)
export const manifest = defineManifest({
  id: "keel/elevation",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/runtime@^0.1"],
  title: "KEEL Engine elevation",
  description: "Continuous ground elevation: hills from a seed, graded roads, level junctions and pads, a raycast, and the GLSL to march it.",
});
