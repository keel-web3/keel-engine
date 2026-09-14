// The modular building itself: every generator parameter a choice -- what
// an editor's building tool and an agent's "make me a building" reach for.
// The named variants (cottage, tower, hall...) are this with a personality.
import { roles } from "../kit.ts";
import { buildingObject } from "../building-object.ts";
import type { BuildingParams } from "../generator.ts";

export default buildingObject({
  id: "building",
  title: "Building (modular)",
  tags: ["modular"],
  choices: {
    footprint: ["rect", "L", "T", "round"], width: { range: [4, 14] }, depth: { range: [4, 10] }, floors: [1, 2, 3, 4], floorH: { range: [2.6, 3.4] },
    roof: ["gable", "hip", "flat", "dome", "spire", "vault", "saucer", "shell"], pitch: { range: [0.4, 1.1] },
    door: ["single", "double", "barn", "arch", "airlock"], windows: ["few", "many", "band", "porthole", "none"], frame: ["none", "timber", "panels"],
    plinth: [true, false], chimneys: [0, 1, 2], porch: [false, true], balcony: [false, true], shutters: [false, true],
    awning: [false, true], sign: [false, true], antennas: [0, 1, 2], stacks: [0, 1, 2], vents: [false, true], doorAt: { range: [-1, 1] },
  },
  look: { roles: roles("wall", "roof", "trim", "wood", "stone", "glass", "door", "metal", "glow", "cloth", "sign", "dark"), profiles: ["village", "stone", "desert", "nordic", "scifi", "machine", "biotic"] },
  params: (v) => v as unknown as Partial<BuildingParams>,
});
