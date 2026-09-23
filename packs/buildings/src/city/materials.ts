// The city's materials: what each of keel/architecture's 32 slots is painted
// as. Walls carry their windows -- the type (punched, tall, ribbon, curtain,
// arched, boarded), how much of a cell is glass, how many are lit at night and
// whether their light is warm (homes) or cool (offices). Neon slots take their
// hue from the district.

import type { MaterialSpec, SlotName } from "@keel-engine/architecture";

type Win = NonNullable<MaterialSpec["windows"]>;
const win = (type: Win["type"], fill: number, share: number, warm: boolean): Win => ({ type, fill, share, warm });
// (Walls wear a wide ramp and a visible screen, as the cars do: a big face falls through its ramp -- lit from the
// street, darker up high -- and reads as dithered pixels, not a flat fill.)
type Screen = MaterialSpec["screen"];
const matte = (hue: number, chroma: number, light: number, windows?: Win, span = 0.45, screen: Screen = "bayer4", dither = 1): MaterialSpec => ({ hue, chroma, light, span, finish: "matte", screen, dither, ...(windows ? { windows } : {}) });
const glass = (hue: number, chroma: number, light: number, windows: Win): MaterialSpec => ({ hue, chroma, light, span: 0.5, finish: "leather", windows, mirror: 0.3, screen: "diagonal", dither: 1 });
// (A wall's surface between its windows -- keel/bake WallDetail: brick coursing, panel seams, ribs, laps, render --
// with its sill streaks and foot grime. The district's dirt deepens the grime: keel/architecture paint.ts.)
type Detail = NonNullable<MaterialSpec["detail"]>;
const dressed = (m: MaterialSpec, detail: Detail): MaterialSpec => ({ ...m, detail });
const glow = (hue: number, chroma: number, light: number, bloom: number, neon = false): MaterialSpec => ({ hue, chroma, light, span: 0.3, finish: "glow", bloom, ...(neon ? { neon } : {}) });

export const CITY_MATERIALS: Readonly<Partial<Record<SlotName, MaterialSpec>>> = {
  redBrick: dressed(matte(32, 0.09, 0.4, win("punched", 0.55, 0.38, true)), { material: "brick", grime: 0.35 }),
  brownBrick: dressed(matte(48, 0.06, 0.33, win("tall", 0.5, 0.34, true)), { material: "brick", grime: 0.4 }),
  limestone: dressed(matte(82, 0.03, 0.62, win("tall", 0.45, 0.4, true), 0.45, "bayer8", 1.1), { material: "stone", grime: 0.45 }),
  buffBrick: dressed(matte(75, 0.06, 0.55, win("punched", 0.6, 0.35, true)), { material: "brick", grime: 0.4 }),
  concreteLight: dressed(matte(250, 0.012, 0.56, win("ribbon", 0.6, 0.45, false), 0.45, "bayer8", 1.1), { material: "panel", grime: 0.45 }),
  concreteDark: dressed(matte(250, 0.02, 0.3, win("punched", 0.42, 0.3, false), 0.45, "ign", 1.1), { material: "panel", grime: 0.3 }),
  glassBlue: dressed(glass(235, 0.08, 0.32, win("curtain", 0.85, 0.45, false)), { material: "glass", grime: 0, foot: 0.4 }),
  glassGreen: dressed(glass(172, 0.06, 0.3, win("curtain", 0.85, 0.4, false)), { material: "glass", grime: 0, foot: 0.4 }),
  glassBronze: dressed(glass(55, 0.06, 0.28, win("curtain", 0.8, 0.4, true)), { material: "glass", grime: 0, foot: 0.4 }),
  stucco: dressed(matte(62, 0.035, 0.64, win("punched", 0.45, 0.35, true), 0.45, "bayer2", 0.9), { material: "stucco", grime: 0.5 }),
  siding: dressed(matte(205, 0.03, 0.58, win("punched", 0.45, 0.3, true), 0.45, "lines", 1), { material: "siding", grime: 0.3 }),
  trim: matte(70, 0.02, 0.6),
  roof: matte(250, 0.01, 0.18, undefined, 0.35, "chunky", 1),
  metal: { hue: 230, chroma: 0.02, light: 0.5, span: 0.4, finish: "metal" },
  shopWarm: glow(55, 0.12, 0.72, 0.35),
  shopCool: glow(200, 0.06, 0.8, 0.3),
  neonA: glow(322, 0.24, 0.68, 0.9, true),
  neonB: glow(192, 0.2, 0.7, 0.9, true),
  neonC: glow(45, 0.2, 0.72, 0.9, true),
  neonD: glow(290, 0.22, 0.66, 0.9, true),
  led: glow(195, 0.06, 0.9, 0.6),
  backlit: glow(90, 0.03, 0.88, 0.5),
  billboard: glow(20, 0.16, 0.62, 0.3),
  beacon: glow(25, 0.22, 0.6, 0.95),
  boarded: dressed(matte(32, 0.04, 0.3, win("boarded", 0.55, 0, true)), { material: "brick", grime: 0.8, foot: 0.8 }),
  derelict: dressed(matte(40, 0.02, 0.28, win("punched", 0.5, 0.04, true), 0.45, "ign", 1.2), { material: "stucco", grime: 0.9, foot: 0.9 }),
  sodium: glow(62, 0.16, 0.7, 0.5),
  corrugated: { hue: 215, chroma: 0.03, light: 0.42, span: 0.45, finish: "metal", windows: win("ribbon", 0.25, 0.12, false), screen: "lines", dither: 1, detail: { material: "corrugated", grime: 0.55 } },
  officeGrid: dressed(matte(240, 0.02, 0.45, win("curtain", 0.55, 0.5, false)), { material: "panel", grime: 0.2, scale: 2 }),
  stoneArched: dressed(matte(70, 0.02, 0.5, win("arched", 0.5, 0.3, true)), { material: "stone", grime: 0.5 }),
  timber: matte(40, 0.07, 0.35),
  darkGlass: dressed(glass(250, 0.03, 0.16, win("curtain", 0.9, 0.22, false)), { material: "glass", grime: 0, foot: 0.3 }),
};
