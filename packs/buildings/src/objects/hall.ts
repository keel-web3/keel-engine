// A hall: long and high -- a rectangle or a T, one or two tall floors, a big
// double door, many windows, a long gable or a stepped hip, a chimney at
// each end.
import { num, roles, str } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { Footprint, Frame, Roof } from "../generator.ts";

export default buildingObject({
  id: "hall",
  title: "Hall",
  tags: ["hall", "civic", "village", "large"],
  choices: { footprint: ["rect", "T"], width: { range: [10, 16] }, depth: { range: [6, 9] }, floors: [1, 2], roof: ["gable", "hip"], pitch: { range: [0.6, 0.9] }, frame: ["none", "timber"] },
  look: { roles: roles("wall", "roof", "trim", "wood", "stone", "glass", "door", "dark"), profiles: ["stone", "village", "nordic", "desert"] },
  params: (v) => ({ footprint: str(v["footprint"]) as Footprint, width: num(v["width"]), depth: num(v["depth"]), floors: num(v["floors"]), floorH: 3.6, roof: str(v["roof"]) as Roof, pitch: num(v["pitch"]), frame: str(v["frame"]) as Frame, door: "double", windows: "many", chimneys: 2, porch: true }),
});
