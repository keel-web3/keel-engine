// A tower: narrow and tall -- three to five floors, square or round, a spire,
// a stepped hip or a flat top with its parapet (a lookout); few windows.
import { num, roles, str } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { Footprint, Roof } from "../generator.ts";

export default buildingObject({
  id: "tower",
  title: "Tower",
  tags: ["tower", "defence", "medieval", "tall"],
  choices: { footprint: ["round", "rect"], width: { range: [3.5, 5.5] }, floors: [3, 4, 5], roof: ["spire", "flat", "hip"], pitch: { range: [0.8, 1.3] } },
  look: { roles: roles("wall", "roof", "trim", "stone", "glass", "door", "metal", "dark"), profiles: ["stone", "village", "nordic", "desert", "scifi"] },
  params: (v) => ({ footprint: str(v["footprint"]) as Footprint, width: num(v["width"]), depth: num(v["width"]), floors: num(v["floors"]), floorH: 2.8, roof: str(v["roof"]) as Roof, pitch: num(v["pitch"]), door: "arch", windows: "few", chimneys: 0, frame: "none" }),
});
