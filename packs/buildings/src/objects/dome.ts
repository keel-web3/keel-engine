// A dome (sci-fi): a round base under a dome or a saucer, a lit band of
// windows round it, an airlock, a beacon.
import { num, roles, str } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { Roof } from "../generator.ts";

export default buildingObject({
  id: "dome",
  title: "Dome",
  tags: ["scifi", "dome", "rts"],
  choices: { width: { range: [6, 12] }, floors: [1, 2], roof: ["dome", "saucer"], antennas: [0, 1] },
  look: { roles: roles("wall", "roof", "metal", "glow", "glass", "door", "trim", "stone"), profiles: ["scifi", "machine", "biotic"] },
  params: (v) => ({ footprint: "round", width: num(v["width"]), depth: num(v["width"]), floors: num(v["floors"]), floorH: 2.8, roof: str(v["roof"]) as Roof, door: "airlock", windows: "band", antennas: num(v["antennas"]), chimneys: 0, plinth: true }),
});
