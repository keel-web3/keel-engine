// The city's street catalogue for keel/architecture: lamp styles and which
// district lights its streets with which (old-town lanterns, downtown LED
// arms, sodium cobras out in the industry, high masts on the highway), lamp
// spacing by road class, each district's pavement furniture, and the street
// look's materials (neon slots take the district's hues).

import type { FurnitureRule, LampStyle, MaterialSpec, PlantKind, StreetCatalogue, StreetSlotName } from "@keel-engine/architecture";
import { PLANT_CROWNS } from "./trees.ts";

/**
 * The widest crown each kind of plant is drawn with (m): what keeps a street tree's crown over the pavement. The same
 * in every climate (trees.ts treeFit draws a wider species down to it), so where a plant stands never depends on it.
 */
function crownsOf(): Partial<Record<PlantKind, number>> { return { ...PLANT_CROWNS }; }

const lampStyle = (kind: LampStyle["kind"], height: number, arm: number, heads: number, head: LampStyle["head"], reach: number): LampStyle => ({ kind, height, arm, heads, head, reach });
const rule = (kind: FurnitureRule["kind"], every: number, chance: number, roads: FurnitureRule["roads"] = ["arterial", "street"], plant?: FurnitureRule["plant"]): FurnitureRule => ({ kind, every, chance, roads, ...(plant ? { plant } : {}) });
const m = (hue: number, chroma: number, light: number, finish: MaterialSpec["finish"] = "matte", extra: Partial<MaterialSpec> = {}): MaterialSpec => ({ hue, chroma, light, span: 0.3, finish, ...extra });
const glow = (hue: number, chroma: number, light: number, bloom: number, neon = false): MaterialSpec => m(hue, chroma, light, "glow", { bloom, ...(neon ? { neon } : {}) });

const MATERIALS: Readonly<Partial<Record<StreetSlotName, MaterialSpec>>> = {
  pole: m(240, 0.015, 0.3, "metal"), lampWarm: glow(62, 0.12, 0.8, 0.75), lampCool: glow(205, 0.04, 0.9, 0.7), lampSodium: glow(55, 0.17, 0.72, 0.7),
  wood: m(45, 0.07, 0.42), binGreen: m(150, 0.05, 0.3, "metal"), hydrant: m(25, 0.17, 0.5, "leather"), shelterGlass: m(210, 0.03, 0.55, "leather", { mirror: 0.4 }),
  frame: m(240, 0.01, 0.45, "metal"), adPanel: glow(90, 0.04, 0.86, 0.45), newsBox: m(250, 0.12, 0.4, "leather"), planter: m(70, 0.015, 0.5),
  foliage: m(140, 0.08, 0.3), foliageAlt: m(115, 0.09, 0.38), trunk: m(45, 0.05, 0.28), grass: m(135, 0.07, 0.34, "matte", { span: 0.45, screen: "chunky", dither: 1.3 }),
  paving: m(70, 0.012, 0.5, "matte", { span: 0.4, screen: "checker", dither: 0.8 }), water: m(225, 0.08, 0.34, "leather", { mirror: 0.5 }), jet: glow(200, 0.05, 0.9, 0.55), plinth: m(75, 0.015, 0.58),
  bronze: m(165, 0.05, 0.4, "metal"), sculpture: m(230, 0.01, 0.62, "metal"), housing: m(240, 0.01, 0.16), signalRed: glow(25, 0.22, 0.58, 0.9),
  signalAmber: glow(70, 0.17, 0.75, 0.9), signalGreen: glow(160, 0.17, 0.72, 0.9), signBlue: m(245, 0.12, 0.42, "leather"), bollard: m(80, 0.14, 0.65, "leather"),
  muralA: m(0, 0.15, 0.5, "matte", { neon: true, pattern: { kind: "stripes", freq: 5, angle: 3, width: 4 } }),
  muralB: m(0, 0.14, 0.45, "matte", { neon: true, pattern: { kind: "camo", freq: 3, angle: 0, width: 6 } }),
  gravel: m(60, 0.025, 0.45, "matte", { screen: "ign", dither: 1.2 }), artNeon: glow(0, 0.22, 0.7, 0.9, true),
};

export const CITY_STREETS: StreetCatalogue = {
  version: "streets@4-signs",
  lampStyles: {
    lantern: lampStyle("lantern", 3.8, 0, 1, "lampWarm", 10),
    led: lampStyle("arm", 8.5, 2, 1, "lampCool", 15),
    cobra: lampStyle("arm", 8, 2.2, 1, "lampSodium", 14),
    suburban: lampStyle("arm", 6.5, 1.4, 1, "lampWarm", 11),
    mast: lampStyle("mast", 16, 2.4, 3, "lampSodium", 22),
    globe: lampStyle("globe", 4.6, 0, 1, "lampWarm", 11),
  },
  lamps: { core: "led", midtown: "led", oldtown: "lantern", industrial: "cobra", docks: "cobra", strip: "cobra", suburb: "suburban", highway: "mast" },
  // (Each district's side streets and arterials lit differently: globes on midtown's and downtown's side streets, cobras
  // on the suburbs' arterials, the strip's side streets a softer arm, the old town's arterials LED.)
  lampsBy: { midtown: { street: "globe" }, core: { street: "globe" }, suburb: { arterial: "cobra" }, strip: { street: "suburban" }, oldtown: { arterial: "led" } },
  // (Staggered side to side: an arterial has a lamp every 60 m, one side then the other.)
  spacing: { highway: 150, arterial: 60, street: 66, alley: 0, ramp: 90, freeway: 90 },
  signEvery: { arterial: 95, street: 75, alley: 60, highway: 180, freeway: 220, ramp: 80 },
  // Sparse, the way a street reads from a car at speed: trees every 40-70 m where the district plants them (few
  // downtown), the small things every couple of hundred metres, a bus stop a long block or two apart.
  furniture: {
    core: [rule("busStop", 400, 0.9, ["arterial"]), rule("tree", 60, 0.5, ["arterial"]), rule("planter", 300, 0.3, ["arterial"]), rule("bench", 260, 0.4, ["arterial"]), rule("newsBoxes", 300, 0.3, ["arterial"]), rule("bin", 220, 0.5), rule("hydrant", 280, 0.8)],
    midtown: [rule("busStop", 440, 0.8, ["arterial"]), rule("tree", 44, 0.8), rule("bench", 300, 0.4, ["arterial"]), rule("bin", 260, 0.5), rule("hydrant", 280, 0.8)],
    oldtown: [rule("busStop", 460, 0.6, ["arterial"]), rule("tree", 50, 0.5), rule("bench", 260, 0.5), rule("bollards", 300, 0.3, ["street"]), rule("bin", 240, 0.5), rule("hydrant", 260, 0.8)],
    industrial: [rule("busStop", 640, 0.5, ["arterial"]), rule("bollards", 360, 0.3), rule("hydrant", 300, 0.8)],
    docks: [rule("tree", 70, 0.6, ["arterial"], "palm"), rule("bollards", 300, 0.5), rule("hydrant", 320, 0.7)],
    strip: [rule("busStop", 540, 0.7, ["arterial"]), rule("tree", 60, 0.8, ["arterial"], "palm"), rule("bin", 320, 0.4), rule("hydrant", 300, 0.8)],
    suburb: [rule("busStop", 640, 0.5, ["arterial"]), rule("tree", 62, 0.85, ["arterial", "street"], "tree"), rule("hydrant", 400, 0.8)],
  },
  crowns: crownsOf(),
  // The roadside's infrastructure: the high-voltage line out round the ring, wooden poles down the side streets of the
  // older and outer districts, the highway's gantries, walls, billboards, signs and rails, and a mast or two up high.
  infra: {
    power: { spacing: [72, 88], offset: 18, height: 32, sag: 0.035, whole: 0.45, radial: 0.6 },
    poles: { districts: ["suburb", "strip", "industrial", "oldtown"], roads: ["street"], every: 42, height: 9, transformer: 0.2 },
    highway: { railCurve: 1 / 400, gantryMin: 260, soundWalls: ["suburb"], wallHeight: 4, billboards: [240, 380], cameras: 0.35 },
    masts: { count: [1, 3], height: [38, 52] },
    cover: { density: { suburb: 1, oldtown: 0.55, midtown: 0.4, docks: 0.35, industrial: 0.6, strip: 0.55, core: 0.05, highway: 0.6 }, lush: ["suburb", "oldtown", "midtown"] },
  },
  materials: MATERIALS,
};
