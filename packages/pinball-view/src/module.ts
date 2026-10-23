import { defineManifest } from "@keel-engine/runtime";

export const manifest = defineManifest({
  id: "keel/pinball-view",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/runtime@^0.1"],
  title: "KEEL Engine pinball view",
  description: "Optional Canvas2D pinball presentation driven by canonical table geometry and frames, with cached layers and bounded cosmetic effects.",
});
