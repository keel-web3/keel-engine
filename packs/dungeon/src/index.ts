// packs/dungeon: an action-RPG dungeon's dressing as styled objects -- one
// design each, drawn in any style (pixel by default), with world roles an
// act's look profile paints (crypt, cave, forge, ruin), tags a game reads
// (destructible, openable, block, wall, corner, decal, light:<kind>) and,
// on light sources, where their flames sit (meta.flames).
export { PACK_ID, PACK_VERSION, pack } from "./pack.ts";
export { PROFILES } from "./profiles.ts";
export { ACTS, ROLES } from "./kit.ts";
export type { DungeonRole } from "./kit.ts";
export { PROPS, propInfo } from "./props.ts";
export { ROOMS } from "./rooms.ts";
export type { DungeonRoomTemplate } from "./rooms.ts";
export type { PropInfo, PropPlacement } from "./props.ts";
export { default as torch } from "./objects/torch.ts";
export { default as brazier } from "./objects/brazier.ts";
export { default as candelabra } from "./objects/candelabra.ts";
export { default as crystals } from "./objects/crystals.ts";
export { default as mushrooms } from "./objects/mushrooms.ts";
export { default as barrel } from "./objects/barrel.ts";
export { default as crate } from "./objects/crate.ts";
export { default as urn } from "./objects/urn.ts";
export { default as chest } from "./objects/chest.ts";
export { default as bones } from "./objects/bones.ts";
export { default as skullPile } from "./objects/skull-pile.ts";
export { default as stain } from "./objects/stain.ts";
export { default as rubble } from "./objects/rubble.ts";
export { default as cobweb } from "./objects/cobweb.ts";
export { default as chains } from "./objects/chains.ts";
export { default as banner } from "./objects/banner.ts";
export { default as roots } from "./objects/roots.ts";
export { default as bookshelf } from "./objects/bookshelf.ts";
export { default as table } from "./objects/table.ts";
export { default as weaponRack } from "./objects/weapon-rack.ts";
export { default as cage } from "./objects/cage.ts";
export { default as altar } from "./objects/altar.ts";
export { default as sarcophagus } from "./objects/sarcophagus.ts";
export { default as tombstone } from "./objects/tombstone.ts";
export { default as throne } from "./objects/throne.ts";
export { default as statue } from "./objects/statue.ts";
export { default as stalagmite } from "./objects/stalagmite.ts";
export { default as anvil } from "./objects/anvil.ts";
export { default as furnace } from "./objects/furnace.ts";
export { default as oreCart } from "./objects/ore-cart.ts";
export { default as key } from "./objects/key.ts";
// A hero's gear: a sword and a shield for the hand sockets (runtime attributes). One entry per verified
// module, so it rides here rather than on a subpath; it reaches keel/runtime, which every page loads first.
export { bow, club, focus, gear, shield, staff, sword } from "./gear.ts";
