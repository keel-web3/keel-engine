import { defineManifest } from "@keel-engine/runtime";
import { PACK_ID, PACK_VERSION, pack } from "./pack.ts";

// (Styled objects need only keel/object: the style contract, the pixel style, looks. The voxel style comes
// from keel/builder when a game loads it -- without it, a voxel request falls back to pixel.)
export const manifest = defineManifest({
  id: PACK_ID,
  version: PACK_VERSION,
  kind: "pack",
  needs: ["keel/core@^0.1", "keel/object@^0.1"],
  provides: ["objects/foliage@1.0.0"],
  contents: pack.contents(),
  title: "Foliage",
  description: "Trees (oak, pine, birch, palm, dead, giant mushroom, alien), bushes, grass tufts and flowers for massive instancing, reeds, cacti, rocks and boulders, logs, stumps and crystals -- styled objects drawn in pixel or voxel style, with wind, seasons and biomes as look profiles, background tier by default.",
});
