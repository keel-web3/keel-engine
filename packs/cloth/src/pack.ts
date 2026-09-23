// The cloth pack: wearables only, one file each -- hats (beanie, cap, top hat,
// hood, a horned helmet, a wizard's hat, a circlet, horns), backpacks (round,
// tall), a flag, a cape and a quiver for the back, a scarf, glasses, a mask, a beard,
// boots, and armour and trappings (pauldrons, a breastplate, a belt).
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
import wizardHat from "./attributes/wizard-hat.ts";
import circlet from "./attributes/circlet.ts";
import horns from "./attributes/horns.ts";
import mask from "./attributes/mask.ts";
import pauldrons from "./attributes/pauldrons.ts";
import breastplate from "./attributes/breastplate.ts";
import belt from "./attributes/belt.ts";
import quiver from "./attributes/quiver.ts";
import beard from "./attributes/beard.ts";

export const pack = definePack({
  entities: [],
  attributes: [beanie, cap, topHat, hood, hornedHelmet, backpackRound, backpackTall, flag, cape, scarf, glasses, bootsLeft, bootsRight, wizardHat, circlet, horns, mask, pauldrons, breastplate, belt, quiver, beard],
});
