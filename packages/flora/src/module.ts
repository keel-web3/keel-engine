import { defineManifest } from "@keel-engine/runtime";

// (The plants are keel/lit instances and materials; sprites and placements are plain data.)
export const manifest = defineManifest({
  id: "keel/flora",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/lit@^0.1"],
  title: "KEEL Engine flora",
  description: "Foliage for keel/lit: crossed pixel-art sprite cards and 3D blades, instanced by the thousand, lit as the ground under them, bent by gusting wind and parted by pushers.",
});
