import { defineManifest } from "@keel-engine/runtime";

// (The atlas is plain data: RGBA bytes any renderer can upload.)
export const manifest = defineManifest({
  id: "keel/materials",
  version: "0.1.0",
  kind: "runtime",
  needs: [],
  title: "KEEL Engine materials",
  description: "Generative pixel-art materials: an exact sheet distilled by a rulebook into layered exemplars (albedo, light, recipes, a dithered pixel-art finish), recombined by seed and checked by a gauntlet; or bark, leaves and snow painted procedurally.",
});
