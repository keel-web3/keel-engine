// The humans pack: a person and the catalogue's anthro animals, one file each.
import { definePack } from "@keel-engine/runtime";
import anthroBear from "./entities/anthro-bear.ts";
import anthroBunny from "./entities/anthro-bunny.ts";
import anthroCat from "./entities/anthro-cat.ts";
import anthroDog from "./entities/anthro-dog.ts";
import anthroFox from "./entities/anthro-fox.ts";
import anthroFrog from "./entities/anthro-frog.ts";
import anthroMouse from "./entities/anthro-mouse.ts";
import human from "./entities/human.ts";

export const pack = definePack({
  entities: [human, anthroCat, anthroFox, anthroBunny, anthroBear, anthroMouse, anthroFrog, anthroDog],
  attributes: [],
});
