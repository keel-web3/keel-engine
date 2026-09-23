import { defineManifest } from "@keel-engine/runtime";

// (Road data on core's deterministic maths alone: a generator and a sim both read it; a renderer draws from it.)
export const manifest = defineManifest({
  id: "keel/road",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/runtime@^0.1"],
  title: "KEEL Engine road",
  description: "Roads as data: sampled paths, a road graph with width rules, and a sparse per-chunk road field.",
});
