// A factory (the machine flavour's production building): an L or a
// rectangle under flat roofs, smokestacks, a roller door, a band of windows,
// vents, panel ribs.
import { num, roles, str } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { Footprint } from "../generator.ts";

export default buildingObject({
  id: "factory",
  title: "Factory",
  tags: ["factory", "machine", "production", "rts", "scifi"],
  choices: { footprint: ["L", "rect", "T"], width: { range: [9, 14] }, depth: { range: [6, 9] }, floors: [1, 2], stacks: [1, 2] },
  look: { roles: roles("wall", "roof", "metal", "trim", "glass", "door", "glow", "dark"), profiles: ["machine", "scifi", "stone"] },
  params: (v) => ({ footprint: str(v["footprint"]) as Footprint, width: num(v["width"]), depth: num(v["depth"]), floors: num(v["floors"]), floorH: 3.4, roof: "flat", door: "barn", windows: "band", frame: "panels", stacks: num(v["stacks"]), vents: true, chimneys: 0 }),
});
