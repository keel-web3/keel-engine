// The foliage pack: styled objects, one file each, and the profiles
// (seasons, biomes) they wear.
import { defineContentPack } from "@keel-engine/object";
import alienTree from "./objects/alien-tree.ts";
import birch from "./objects/birch.ts";
import bush from "./objects/bush.ts";
import cactus from "./objects/cactus.ts";
import crystal from "./objects/crystal.ts";
import deadTree from "./objects/dead-tree.ts";
import flowers from "./objects/flowers.ts";
import grass from "./objects/grass.ts";
import log from "./objects/log.ts";
import mushroom from "./objects/mushroom.ts";
import oak from "./objects/oak.ts";
import palm from "./objects/palm.ts";
import pine from "./objects/pine.ts";
import reeds from "./objects/reeds.ts";
import rock from "./objects/rock.ts";
import stump from "./objects/stump.ts";
import { PROFILES } from "./profiles.ts";

export const PACK_ID = "packs/foliage";
export const PACK_VERSION = "1.0.0";

export const pack = defineContentPack({
  id: PACK_ID,
  version: PACK_VERSION,
  objects: [oak, pine, birch, palm, deadTree, mushroom, alienTree, bush, grass, flowers, reeds, cactus, rock, log, stump, crystal],
  profiles: PROFILES,
});
