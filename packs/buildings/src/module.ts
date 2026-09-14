import { defineManifest } from "@keel-engine/runtime";
import { PACK_ID, PACK_VERSION, pack } from "./pack.ts";

// (Styled objects need only keel/object; voxel style comes with keel/builder, else a voxel request draws pixel.)
export const manifest = defineManifest({
  id: PACK_ID,
  version: PACK_VERSION,
  kind: "pack",
  needs: ["keel/object@^0.1"],
  provides: ["objects/buildings@1.0.0"],
  contents: pack.contents(),
  title: "Buildings",
  description: "A modular building generator (rect/L/T/round footprints, floors, gable/hip/flat/dome/spire/vault/saucer/shell roofs, doors, windows, chimneys, balconies, awnings) and its variants -- cottage, tower, hall, workshop, shop, hab, dome, pylon, hive, factory -- with bridges (beam, arch, rope, plank), wedge ramps, stairs and cliff steps, wall/fence/gate segments along paths, path stones and a dock; styled objects in pixel or voxel style with the design's colliders, sockets and fronts, cultures as look profiles.",
});
