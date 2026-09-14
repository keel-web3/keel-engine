// The animals pack: the catalogue's four-legged species, one file each, and
// this pack's own attributes (a collar, saddlebags).
import { definePack } from "@keel-engine/runtime";
import collar from "./attributes/collar.ts";
import saddlebag from "./attributes/saddlebag.ts";
import bear from "./entities/bear.ts";
import cat from "./entities/cat.ts";
import deer from "./entities/deer.ts";
import dog from "./entities/dog.ts";
import fox from "./entities/fox.ts";
import mouse from "./entities/mouse.ts";
import rabbit from "./entities/rabbit.ts";

export const pack = definePack({
  entities: [dog, cat, fox, bear, rabbit, mouse, deer],
  attributes: [collar, saddlebag],
});
