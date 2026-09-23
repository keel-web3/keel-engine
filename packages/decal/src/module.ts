import { defineManifest } from "@keel-engine/runtime";

// (Pictures and words people put on things, stored on-chain as a small doc a contract can check, drawn in the engine's own pixel alphabet.)
export const manifest = defineManifest({
  id: "keel/decal",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/proof@^0.1"],
  title: "KEEL Engine decal",
  description: "On-chain decals: the KEEL alphabet and text conversion, the KDCL doc (four-ink pixel images, styled text) a contract validates, and the rasterizer to bake decal texels.",
});
