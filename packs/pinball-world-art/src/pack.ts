import { defineContentPack } from "@keel-engine/object";
import { PROFILES as FOLIAGE_PROFILES } from "@keel-engine/foliage";
import { WORLD_ART_ASSETS } from "./assets.ts";
import { blendedWorldProfile } from "./looks.ts";
export const PACK_ID = "packs/pinball-world-art", PACK_VERSION = "0.1.0";
export const pack = defineContentPack({ id: PACK_ID, version: PACK_VERSION, objects: Object.values(WORLD_ART_ASSETS), profiles: [...FOLIAGE_PROFILES, blendedWorldProfile({ forge: 0, neon: 0, garden: 1, glacier: 0, ruins: 0 })] });
