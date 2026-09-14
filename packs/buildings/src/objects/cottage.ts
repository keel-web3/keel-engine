// A cottage: one or two floors, a rectangle or an L, a steep gable or a
// stepped hip, timber frame or plain plaster, a chimney, shutters, a porch
// now and then.
import { bool, num, roles, str } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { Footprint, Frame, Roof } from "../generator.ts";

export default buildingObject({
  id: "cottage",
  title: "Cottage",
  tags: ["house", "village", "medieval"],
  choices: { footprint: ["rect", "L"], width: { range: [5, 8] }, depth: { range: [4, 6] }, floors: [1, 2], roof: ["gable", "hip"], pitch: { range: [0.7, 1.1] }, frame: ["timber", "none"], chimneys: [1, 2, 0], porch: [false, true], shutters: [true, false], doorAt: { range: [-0.8, 0.8] } },
  look: { roles: roles("wall", "roof", "wood", "trim", "stone", "glass", "door", "dark"), profiles: ["village", "stone", "nordic", "desert"] },
  params: (v) => ({
    footprint: str(v["footprint"]) as Footprint, width: num(v["width"]), depth: num(v["depth"]), floors: num(v["floors"]), floorH: 2.6,
    roof: str(v["roof"]) as Roof, pitch: num(v["pitch"]), frame: str(v["frame"]) as Frame, chimneys: num(v["chimneys"]), porch: bool(v["porch"]),
    shutters: bool(v["shutters"]), balcony: num(v["floors"]) > 1 && !bool(v["porch"]), door: "single", windows: "few", doorAt: num(v["doorAt"]),
  }),
});
