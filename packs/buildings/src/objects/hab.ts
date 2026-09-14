// A hab module (sci-fi, the RTS's +supply building): a vaulted capsule of a
// roof on a plinth, ribbed; portholes or a lit band; an airlock; antennas and
// vents. One or two modules long (an L joins a second).
import { num, roles, str } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { Footprint, Windows } from "../generator.ts";

export default buildingObject({
  id: "hab",
  title: "Hab module",
  tags: ["scifi", "habitat", "rts", "supply"],
  choices: { footprint: ["rect", "L"], width: { range: [6, 10] }, depth: { range: [3.5, 5] }, windows: ["porthole", "band"], antennas: [1, 2, 0] },
  look: { roles: roles("wall", "roof", "metal", "glow", "glass", "door", "trim", "dark"), profiles: ["scifi", "machine", "biotic"] },
  params: (v) => ({ footprint: str(v["footprint"]) as Footprint, width: num(v["width"]), depth: num(v["depth"]), floors: 1, floorH: 2.6, roof: "vault", door: "airlock", windows: str(v["windows"]) as Windows, frame: "panels", antennas: num(v["antennas"]), vents: true, chimneys: 0 }),
});
