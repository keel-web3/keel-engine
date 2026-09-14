// The buildings pack: the modular building and its variants, bridges,
// ramps and stairs, walls, fences and gates, path pieces, a dock -- styled
// objects, one file each -- and the cultures they wear.
import { defineContentPack } from "@keel-engine/object";
import bridge from "./objects/bridge.ts";
import building from "./objects/building.ts";
import cliffSteps from "./objects/cliff-steps.ts";
import cottage from "./objects/cottage.ts";
import dock from "./objects/dock.ts";
import dome from "./objects/dome.ts";
import factory from "./objects/factory.ts";
import fence from "./objects/fence.ts";
import gate from "./objects/gate.ts";
import hab from "./objects/hab.ts";
import hall from "./objects/hall.ts";
import hive from "./objects/hive.ts";
import pathStones from "./objects/path-stones.ts";
import pylon from "./objects/pylon.ts";
import ramp from "./objects/ramp.ts";
import shop from "./objects/shop.ts";
import stairs from "./objects/stairs.ts";
import tower from "./objects/tower.ts";
import wall from "./objects/wall.ts";
import workshop from "./objects/workshop.ts";
import { PROFILES } from "./profiles.ts";

export const PACK_ID = "packs/buildings";
export const PACK_VERSION = "1.0.0";

export const pack = defineContentPack({
  id: PACK_ID,
  version: PACK_VERSION,
  objects: [building, cottage, tower, hall, workshop, shop, hab, dome, pylon, hive, factory, bridge, ramp, stairs, cliffSteps, wall, fence, gate, pathStones, dock],
  profiles: PROFILES,
});
