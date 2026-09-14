// The dungeon pack: styled objects, one file each, and the act profiles
// (crypt, cave, forge, ruin) they wear.
import { defineContentPack } from "@keel-engine/object";
import altar from "./objects/altar.ts";
import anvil from "./objects/anvil.ts";
import banner from "./objects/banner.ts";
import barrel from "./objects/barrel.ts";
import bones from "./objects/bones.ts";
import bookshelf from "./objects/bookshelf.ts";
import brazier from "./objects/brazier.ts";
import cage from "./objects/cage.ts";
import candelabra from "./objects/candelabra.ts";
import chains from "./objects/chains.ts";
import chest from "./objects/chest.ts";
import cobweb from "./objects/cobweb.ts";
import crate from "./objects/crate.ts";
import crystals from "./objects/crystals.ts";
import key from "./objects/key.ts";
import mushrooms from "./objects/mushrooms.ts";
import roots from "./objects/roots.ts";
import rubble from "./objects/rubble.ts";
import sarcophagus from "./objects/sarcophagus.ts";
import skullPile from "./objects/skull-pile.ts";
import stain from "./objects/stain.ts";
import stalagmite from "./objects/stalagmite.ts";
import statue from "./objects/statue.ts";
import table from "./objects/table.ts";
import throne from "./objects/throne.ts";
import tombstone from "./objects/tombstone.ts";
import torch from "./objects/torch.ts";
import urn from "./objects/urn.ts";
import weaponRack from "./objects/weapon-rack.ts";
import furnace from "./objects/furnace.ts";
import oreCart from "./objects/ore-cart.ts";
import { PROFILES } from "./profiles.ts";

export const PACK_ID = "packs/dungeon";
export const PACK_VERSION = "1.0.0";

export const pack = defineContentPack({
  id: PACK_ID,
  version: PACK_VERSION,
  objects: [torch, brazier, candelabra, crystals, mushrooms, barrel, crate, urn, chest, bones, skullPile, stain, rubble, cobweb, chains, banner, roots, bookshelf, table, weaponRack, cage, altar, sarcophagus, tombstone, throne, statue, stalagmite, anvil, furnace, oreCart, key],
  profiles: PROFILES,
});
