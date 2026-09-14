import { contentsOf, defineManifest } from "@keel-engine/runtime";
import { gear } from "./gear.ts";
import { PACK_ID, PACK_VERSION, pack } from "./pack.ts";

// (Styled objects need only keel/object; a voxel request draws pixel unless keel/builder is loaded -- and the
// owner's worlds are pixel. The hero's gear is runtime attributes, so keel/runtime too.)
export const manifest = defineManifest({
  id: PACK_ID,
  version: PACK_VERSION,
  kind: "pack",
  needs: ["keel/runtime@^0.1", "keel/object@^0.1"],
  provides: ["objects/dungeon@1.0.0", "attributes/dungeon-gear@1.0.0"],
  // (And a hero's gear: a sword and a shield, attributes for two-legged characters' hands.)
  contents: { ...pack.contents(), attributes: contentsOf(gear).attributes },
  title: "Dungeon",
  description: "An action-RPG dungeon's dressing: torches, braziers, candles, glowing crystals and fungi (light sources with flame sockets), barrels, crates, urns and chests (destructible, openable), bones, skull piles, stains, rubble, cobwebs, chains, banners, roots, bookshelves, tables, weapon racks, cages, altars, sarcophagi, tombstones, a throne, statues, stalagmites, an anvil, a furnace, an ore cart and the great key -- styled objects in pixel style with look profiles per act (crypt, cave, forge, ruin); and a hero's sword and shield for the hand sockets.",
});
