// A shop: a striped awning over its front, a sign board over the door (a
// socket for the shop's own sign), one or two floors (living over the shop),
// a gable, a hip or a flat roof.
import { num, roles, str } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { Roof } from "../generator.ts";

export default buildingObject({
  id: "shop",
  title: "Shop",
  tags: ["shop", "market", "village"],
  choices: { width: { range: [5, 8] }, depth: { range: [4, 6] }, floors: [1, 2], roof: ["gable", "flat", "hip"], pitch: { range: [0.6, 0.9] } },
  look: { roles: roles("wall", "roof", "cloth", "sign", "trim", "wood", "stone", "glass", "door"), profiles: ["village", "desert", "stone", "scifi"] },
  params: (v) => ({ footprint: "rect", width: num(v["width"]), depth: num(v["depth"]), floors: num(v["floors"]), floorH: 2.8, roof: str(v["roof"]) as Roof, pitch: num(v["pitch"]), door: "double", windows: "few", awning: true, sign: true, chimneys: 1, shutters: true, balcony: num(v["floors"]) > 1 }),
});
