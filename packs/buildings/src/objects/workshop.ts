// A workshop: a barn door, a tall single floor (or two), a gable or a flat
// roof, a stack or a chimney, vents: a smithy, a mill, a machine shop.
import { num, roles, str } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { Footprint, Roof } from "../generator.ts";

export default buildingObject({
  id: "workshop",
  title: "Workshop",
  tags: ["workshop", "production", "village"],
  choices: { footprint: ["rect", "L"], width: { range: [7, 11] }, depth: { range: [5, 7] }, floors: [1, 2], roof: ["gable", "flat"], pitch: { range: [0.5, 0.8] }, stacks: [0, 1], chimneys: [1, 0] },
  look: { roles: roles("wall", "roof", "wood", "trim", "stone", "metal", "glass", "door", "dark"), profiles: ["village", "stone", "machine", "nordic"] },
  params: (v) => ({ footprint: str(v["footprint"]) as Footprint, width: num(v["width"]), depth: num(v["depth"]), floors: num(v["floors"]), floorH: 3.4, roof: str(v["roof"]) as Roof, pitch: num(v["pitch"]), door: "barn", windows: "few", frame: "timber", stacks: num(v["stacks"]), chimneys: num(v["chimneys"]), vents: true, doorAt: -0.4 }),
});
