import { defineManifest } from "@keel-engine/runtime";

// (Opt-in and separate from keel/render: the pixel renderer's output is untouched. This draws smooth, lit product
// shots -- a handheld on a card, a thing on a turntable -- with physically based materials.)
export const manifest = defineManifest({
  id: "keel/studio",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/runtime@^0.1"],
  title: "KEEL Engine studio",
  description: "The studio renderer: GGX materials, a procedural studio environment, clear plastic, contact shadow, baked AO, MSAA, screen bloom and models built from parts, at two quality tiers.",
});
