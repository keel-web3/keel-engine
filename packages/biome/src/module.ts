import { defineManifest } from "@keel-engine/runtime";

// (A composition: the ground is keel/tiles, everything on it keel/flora, and the biomes plain data.)
export const manifest = defineManifest({
  id: "keel/biome",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/lit@^0.1", "keel/tiles@^0.1", "keel/flora@^0.1"],
  title: "KEEL Engine biome",
  description: "Any biome on Earth as data for keel/lit: relief, ground painted by height and slope with 3D shell layers, plants, vines, water, light and wind, all sharing one spring field.",
});
