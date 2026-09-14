// The cloth pack: wearables only, one file each -- hats (beanie, cap, top hat,
// hood, a horned helmet), backpacks (round, tall), a flag and a cape for the
// back, a scarf, glasses and boots.
import { definePack } from "@keel-engine/runtime";
import backpackRound from "./attributes/backpack-round.ts";
import backpackTall from "./attributes/backpack-tall.ts";
import beanie from "./attributes/beanie.ts";
import { bootsLeft, bootsRight } from "./attributes/boots.ts";
import cap from "./attributes/cap.ts";
import cape from "./attributes/cape.ts";
import flag from "./attributes/flag.ts";
import glasses from "./attributes/glasses.ts";
import hood from "./attributes/hood.ts";
import hornedHelmet from "./attributes/horned-helmet.ts";
import scarf from "./attributes/scarf.ts";
import topHat from "./attributes/top-hat.ts";

export const pack = definePack({
  entities: [],
  attributes: [beanie, cap, topHat, hood, hornedHelmet, backpackRound, backpackTall, flag, cape, scarf, glasses, bootsLeft, bootsRight],
});
