// A car's paints as layer looks (keel/bake looks.ts): what each slot of the
// body and of the wheels wears -- a ramp (OKLCH hue, chroma, lightness, span),
// a finish that bends the shade onto it, a livery pattern, its OWN dither
// screen, a clear coat's SHEEN, and a DECAL. The screen is part of the
// material: flake paint glitters on an interleaved screen, pearl on a halftone,
// matte on a soft Bayer; glass wears lines and a streak, carbon a weave, a
// grille a crosshatch, rubber a checker, lamps none.
//
// Every PANEL is painted on its own: the body's paint, unless the car's
// condition says a door came off another car, the bonnet is in primer, the
// quarters are rusting through or the roof has faded in the sun. A livery
// knows which faces it belongs on (racing stripes over the bonnet, roof and
// boot; side bands and slashes down the doors), and a rare TYPE (gold, chrome,
// full carbon, a rust bucket, a hologram, stealth) repaints the lot.
//
//   const table = createLookTable();
//   const body = table.add(bodyPaint(car));      // an instance's look index
//   const wheel = table.add(wheelPaint(car));

import type { Finish as RoleFinish, LookRole, Pattern, RoleLook } from "@keel-engine/core";
import type { LayerPaint, PaintScreen, PaintSheen, SlotDecal, SlotPaint } from "@keel-engine/bake";
import { clamp, snap } from "./draws.ts";
import type { Car, Colour, Finish, Panel } from "./car.ts";
import { PANELS } from "./car.ts";
import { carDecals, signDecal } from "./decals.ts";
import { SIGN_AMBER } from "./lights.ts";
import { convertibleOf } from "./roof.ts";
import { mechanicsOf } from "./mechanics.ts";
import type { PlacedDecal } from "./decals.ts";
import type { PlatePaint } from "./plate.ts";
import { BODY_SLOT, WHEEL_SLOT, panelSlot } from "./shapes.ts";

export interface PaintOptions {
  /** How much light there is: 1 day, ~0.6 dusk, ~0.4 night (lamps and glows keep theirs). */
  readonly light?: number;
  /** The camera's pitch (decal placement weighs top faces by it). */
  readonly pitch?: number;
  /** Decals already placed (carDecals), to share them between looks. */
  readonly decals?: readonly PlacedDecal[];
  /** The licence plate's picture and inks (plate.ts plateDecal), for the plate layer (plateDesign) to wear. */
  readonly plate?: PlatePaint | null;
}

type PatternLook = RoleLook["pattern"];
const NONE: PatternLook = { kind: "none", freq: 1, angle: 0, width: 4, shift: 0, ink: null };
const pattern = (kind: Pattern, freq: number, angle: number, width: number, ink: LookRole | null, shift = 0): PatternLook => ({ kind, freq, angle, width, shift, ink });

/** What each paint finish is on the ramp, on the screen, and under the clear coat. */
export const FINISH_LOOK: Readonly<Record<Finish, { finish: RoleFinish; span: number; screen: PaintScreen; dither: number; gloss: boolean }>> = {
  gloss: { finish: "leather", span: 0.56, screen: "bayer4", dither: 0.8, gloss: true },
  pearl: { finish: "leather", span: 0.5, screen: "halftone", dither: 1.1, gloss: true },
  matte: { finish: "matte", span: 0.4, screen: "bayer2", dither: 0.5, gloss: false },
  satin: { finish: "leather", span: 0.5, screen: "diagonal", dither: 0.8, gloss: false },
  flake: { finish: "metal", span: 0.62, screen: "ign", dither: 1.25, gloss: true },
  candy: { finish: "cloth", span: 0.56, screen: "bayer8", dither: 1, gloss: true },
  chameleon: { finish: "leather", span: 0.56, screen: "halftone", dither: 1.2, gloss: true },
};

/** Where the city's buses say they're going. */
const DESTINATIONS = ["DOWNTOWN", "HARBOR", "UPTOWN", "AIRPORT", "STADIUM", "DEPOT", "MIDTOWN", "BEACH"] as const;

const SIDE_PANELS: readonly Panel[] = ["doorL", "doorR", "fenderFL", "fenderFR", "quarterL", "quarterR"];
const TOP_PANELS: readonly Panel[] = ["hood", "trunk", "roof"];

/** The body layer's paint. */
export function bodyPaint(car: Car, options: PaintOptions = {}): LayerPaint {
  const light = options.light ?? 1;
  const P = car.paints, F = FINISH_LOOK[P.finish];
  // (A colour as a role's ramp, under the scene's light: lamps and glows keep theirs.)
  const role = (c: Colour, finish: RoleFinish, span: number, pat: PatternLook = NONE): RoleLook => ({
    hue: snap(c.hue, 5) % 360, chroma: snap(clamp(c.chroma * (finish === "glow" ? 1 : 0.6 + 0.4 * light), 0, 0.32), 0.01),
    light: snap(clamp(finish === "glow" ? c.light : c.light * (0.35 + 0.65 * light), 0.08, 0.96), 0.02), span: snap(clamp(span, 0.2, 0.8), 0.02), finish, pattern: pat,
  });
  const slot = (look: RoleLook, screen: PaintScreen, dither: number, extra: { ink?: RoleLook | null; sheen?: PaintSheen; decal?: SlotDecal | null; space?: "part" | "body"; mirror?: number } = {}): SlotPaint => ({
    look, ink: extra.ink ?? null, screen, dither, sheen: extra.sheen ?? "none", decal: extra.decal ?? null,
    ...(extra.space ? { space: extra.space } : {}), ...(extra.mirror ? { mirror: extra.mirror } : {}),
  });
  const out: (SlotPaint | null)[] = new Array<SlotPaint | null>(32).fill(null);
  const white: Colour = { light: 0.94, chroma: 0.01, hue: 90 }, black: Colour = { light: 0.16, chroma: 0.01, hue: 260 };

  // The paint every panel starts from: a type's, or the family's in its finish.
  const T = P.type;
  const base: { colour: Colour; finish: RoleFinish; span: number; screen: PaintScreen; dither: number; gloss: boolean; pat: PatternLook; ink: Colour | null } =
    T === "gold" ? { colour: { light: 0.72, chroma: 0.13, hue: 85 }, finish: "metal", span: 0.66, screen: "ign", dither: 1.1, gloss: true, pat: NONE, ink: null }
    : T === "chrome" ? { colour: { light: 0.78, chroma: 0.01, hue: 245 }, finish: "metal", span: 0.72, screen: "bayer8", dither: 1.2, gloss: true, pat: NONE, ink: null }
    : T === "carbon" ? { colour: { light: 0.22, chroma: 0.01, hue: 250 }, finish: "leather", span: 0.34, screen: "weave", dither: 1.5, gloss: true, pat: NONE, ink: null }
    : T === "rust" ? { colour: { light: 0.42, chroma: 0.1, hue: 45 }, finish: "matte", span: 0.4, screen: "chunky", dither: 0.8, gloss: false, pat: pattern("camo", 3, 0, 5, "secondary"), ink: { light: 0.3, chroma: 0.06, hue: 35 } }
    : T === "hologram" ? { colour: { light: 0.7, chroma: 0.16, hue: (P.body.hue + 180) % 360 }, finish: "glow", span: 0.5, screen: "ign", dither: 1.4, gloss: true, pat: pattern("bands", 4, 0, 4, "secondary"), ink: { light: 0.7, chroma: 0.18, hue: (P.body.hue + 300) % 360 } }
    : T === "stealth" ? { colour: { light: 0.17, chroma: 0.01, hue: 260 }, finish: "matte", span: 0.3, screen: "bayer2", dither: 0.4, gloss: false, pat: NONE, ink: null }
    : { colour: P.body, finish: F.finish, span: F.span, screen: F.screen, dither: F.dither, gloss: F.gloss, pat: P.finish === "chameleon" ? pattern("camo", 1, 0, 4, "secondary") : NONE, ink: P.finish === "chameleon" ? { ...P.body, hue: (P.body.hue + 140) % 360 } : null };

  // Livery: which faces it belongs on, and what its marks wear.
  const accentInk = role(P.accent, base.finish, base.span);
  const altInk = role(P.alt, base.finish, base.span);
  const liveryFor = (panel: Panel | "paint"): { pat: PatternLook; ink: RoleLook | null; space?: "body" } => {
    if (T) return { pat: base.pat, ink: base.ink ? role(base.ink, base.finish, base.span) : null };
    if (P.finish === "chameleon") return { pat: base.pat, ink: role(base.ink!, base.finish, base.span) };
    const top = panel === "paint" || TOP_PANELS.includes(panel as Panel), sideP = SIDE_PANELS.includes(panel as Panel);
    switch (P.livery) {
      // (Body space: measured across the whole car from its centreline, so a stripe is centred and runs nose to tail
      // over every panel it crosses -- one stripe down the middle, or a pair with the flanks.)
      case "stripes": return top ? { pat: pattern("stripes", 1, 0, P.liveryWidth, "accent"), ink: accentInk, space: "body" } : { pat: NONE, ink: null };
      case "twin": return top ? { pat: pattern("stripes", 2, 0, Math.max(2, P.liveryWidth - 1), "accent"), ink: accentInk, space: "body" } : { pat: NONE, ink: null };
      case "bands": return sideP ? { pat: pattern("bands", 1, 0, P.liveryWidth, "accent"), ink: accentInk, space: "body" } : { pat: NONE, ink: null };
      case "slash": return sideP ? { pat: pattern("stripes", 1, P.liveryAngle, P.liveryWidth, "accent"), ink: accentInk, space: "body" } : { pat: NONE, ink: null };
      case "pinstripe": return sideP ? { pat: pattern("trim", 1, 0, 3, "accent"), ink: accentInk } : { pat: NONE, ink: null };
      case "checks": return { pat: pattern("checks", P.liveryFreq, 0, 4, "secondary"), ink: altInk };
      case "camo": return { pat: pattern("camo", P.liveryFreq + 1, 0, 5, "secondary"), ink: altInk };
      case "spots": return { pat: pattern("spots", P.liveryFreq + 1, 0, 4, "accent"), ink: accentInk };
      case "fade": return { pat: pattern("gradient", 1, 0, 4, null, 3), ink: null };
      default: return { pat: NONE, ink: null };
    }
  };

  // Decals, by panel.
  const placed = options.decals ?? carDecals(car, options.pitch !== undefined ? { pitch: options.pitch } : {});
  const decalOf = (panel: Panel): SlotDecal | null => {
    const d = placed.find((x) => x.panel === panel);
    return d ? { decal: d.decal, rect: d.rect, flipU: d.flipU, flipV: d.flipV, inks: d.inks.map((k) => role(k, "matte", 0.42)) } : null;
  };

  // The panels: the base paint, or the panel's condition.
  const panelPaint = (panel: Panel | "paint"): SlotPaint => {
    const cond = panel === "paint" ? undefined : P.panels.find((x) => x.panel === panel);
    const sheen: PaintSheen = !base.gloss ? "none" : panel === "paint" || TOP_PANELS.includes(panel as Panel) ? "top" : "side";
    const decal = panel === "paint" ? null : decalOf(panel);
    if (cond) {
      switch (cond.kind) {
        case "primer": return slot(role(cond.colour, "matte", 0.36), "bayer2", 0.5, { decal });
        case "odd": return slot(role(cond.colour, base.finish, base.span), base.screen, base.dither, { sheen, decal });
        case "faded": return slot(role(cond.colour, "matte", base.span * 0.8), "bayer4", 0.7, { decal });
        case "rust": return slot(role(base.colour, "matte", base.span, pattern("camo", 3, 0, 5, "secondary")), "chunky", 0.8, { ink: role(cond.colour, "matte", 0.4), decal });
        // (A fleet's second colour on a panel -- a cruiser's white doors, a steel dump bed: the body's own finish.)
        case "livery": return slot(role(cond.colour, base.finish, base.span), base.screen, base.dither, { sheen, decal, mirror: base.gloss ? 0.16 : 0.05 });
      }
    }
    const l = liveryFor(panel);
    return slot(role(base.colour, base.finish, base.span, l.pat), base.screen, base.dither, { ink: l.ink, sheen, decal, ...(l.space ? { space: l.space } : {}), mirror: base.gloss ? 0.16 : 0.05 });
  };
  out[BODY_SLOT.paint] = panelPaint("paint");
  for (const panel of PANELS) out[panelSlot(panel)] = panelPaint(panel);
  // The roof: contrast, vinyl, carbon -- or a livery of its own.
  const roofKind = car.parts.roof;
  if (!T && (roofKind === "contrast" || roofKind === "vinyl" || roofKind === "carbon" || P.roofLivery !== "none")) {
    const roofPat = P.roofLivery === "checks" ? pattern("checks", 3, 0, 4, "accent") : P.roofLivery === "stripes" ? pattern("stripes", 1, 0, 3, "accent") : NONE;
    const roofSpace: { space?: "body" } = P.roofLivery === "stripes" ? { space: "body" } : {};
    const roofInk = P.roofLivery !== "none" ? role(P.roofLivery === "checks" ? white : P.accent, "matte", 0.4) : null;
    const decal = decalOf("roof");
    out[BODY_SLOT.roof] = roofKind === "carbon" ? slot(role({ light: 0.22, chroma: 0.01, hue: 250 }, "leather", 0.34, roofPat), "weave", 1.5, { ink: roofInk, sheen: "top", decal, ...roofSpace, mirror: 0.12 })
      : roofKind === "vinyl" ? slot(role({ light: 0.2, chroma: 0.02, hue: 40 }, "cloth", 0.3, roofPat), "hatch", 0.6, { ink: roofInk, decal, ...roofSpace })
      : roofKind === "contrast" ? slot(role(P.alt, base.finish, base.span, roofPat), base.screen, base.dither, { ink: roofInk, sheen: base.gloss ? "top" : "none", decal, ...roofSpace, mirror: base.gloss ? 0.16 : 0.05 })
      : slot(role(base.colour, base.finish, base.span, roofPat), base.screen, base.dither, { ink: roofInk, sheen: base.gloss ? "top" : "none", decal, ...roofSpace, mirror: base.gloss ? 0.16 : 0.05 });
  }
  const convertible = convertibleOf(car);
  if (convertible) out[BODY_SLOT.roof] = convertible.kind === "soft"
    ? slot(role(convertible.colour, "cloth", 0.28), "hatch", 0.5)
    : slot(role(convertible.finish === "body" ? base.colour : convertible.colour, base.finish, base.span), base.screen, base.dither, { sheen: "top", mirror: base.gloss ? 0.16 : 0.05 });
  out[BODY_SLOT.alt] = slot(role(T ? base.colour : P.alt, base.finish, base.span), base.screen, base.dither, { sheen: base.gloss ? "side" : "none" });
  out[BODY_SLOT.wing] = car.parts.spoiler === "bigwing" || car.parts.spoiler === "swan" ? slot(role({ light: 0.22, chroma: 0.01, hue: 250 }, "leather", 0.34), "weave", 1.5, { sheen: "top" }) : panelPaint("paint");
  out[BODY_SLOT.accent] = slot(role(P.accent, "matte", 0.42), "bayer2", 0.5);
  out[BODY_SLOT.engine] = slot(role(mechanicsOf(car).colour, "leather", .42), "bayer4", .7, { sheen: "top" });
  const tintLook = T === "stealth" ? { light: 0.34, chroma: 0.02, hue: 250 } : P.glass;
  // Glass: a dark tint, a soft screen, one reflection streak; a mirror tint brighter and harder.
  // (No dither on glass: a flat tint the reflection band reads on.)
  out[BODY_SLOT.glass] = P.mirrorGlass
    ? slot(role(tintLook, "metal", 0.72), "none", 0, { sheen: "glass", mirror: 0.8 })
    : slot(role({ ...tintLook, light: tintLook.light * 0.75 + 0.04 }, "leather", 0.62), "none", 0, { sheen: "glass", mirror: 0.55 });
  // The neon kit (and the old "Neon Trim" effect): tubes along the trim, under the sills, in the cabin.
  const kit = P.neon;
  const neon = P.effect === "neon" || !!kit?.trim;
  const trimC = T === "gold" ? { light: 0.7, chroma: 0.12, hue: 85 } : T === "stealth" ? black : P.trimChrome ? { light: 0.74, chroma: 0.01, hue: 250 } : { light: 0.2, chroma: 0.01, hue: 260 };
  out[BODY_SLOT.screen] = out[BODY_SLOT.glass] ?? null;
  out[BODY_SLOT.trim] = neon ? slot(role(P.glow, "glow", 0.36), "none", 0) : P.trimChrome || T === "gold" ? slot(role(trimC, "metal", 0.66), "bayer8", 1.1, { mirror: 0.45 }) : slot(role(trimC, "leather", 0.3), "bayer2", 0.4, { mirror: 0.15 });
  out[BODY_SLOT.dark] = slot(role({ ...base.colour, light: clamp(base.colour.light - 0.3, 0.08, 0.3), chroma: base.colour.chroma * 0.5 }, "matte", 0.24), "bayer2", 0.4);
  // (The grille's screen is its kind: a mesh crosshatch, slats in lines, an egg crate in a checker.)
  const grilleScreen: PaintScreen = car.parts.grille === "slat" || car.parts.grille === "chrome" ? "lines" : car.parts.grille === "egg" ? "checker" : "hatch";
  out[BODY_SLOT.grille] = slot(role({ light: 0.14, chroma: 0.01, hue: 260 }, "matte", 0.26), grilleScreen, 0.9);
  out[BODY_SLOT.arch] = neon ? slot(role(P.glow, "glow", 0.36), "none", 0) : slot(role({ light: 0.12, chroma: 0.01, hue: 260 }, "matte", 0.2), "none", 0);
  // The kit's tubes themselves (shapes.ts puts them under the sills): they only exist on a car that has them.
  if (kit?.under) out[BODY_SLOT.neon] = slot(role(P.glow, "glow", 0.3), "none", 0);
  // Lamps glow, day and night (a clean emissive lens, no dither); tail lights a deep red that still reads as lit.
  out[BODY_SLOT.light] = slot(role({ ...P.head, light: Math.max(0.86, P.head.light) }, "glow", 0.3), "none", 0);
  out[BODY_SLOT.tail] = slot(role({ ...P.tail, light: Math.max(0.58, P.tail.light), chroma: Math.max(0.18, P.tail.chroma) }, "glow", 0.36), "none", 0);
  out[BODY_SLOT.reflector] = out[BODY_SLOT.tail] ?? null;
  // A service vehicle's beacons: each half a clean lens in its own colour (lights.ts holds them dark until they flash).
  const beacon = P.beacon;
  if (car.parts.beacons && beacon) {
    out[BODY_SLOT.beaconA] = slot(role(beacon.a, "glow", 0.3), "none", 0);
    out[BODY_SLOT.beaconB] = slot(role(beacon.b, "glow", 0.3), "none", 0);
  }
  // A bus's destination sign (the neon slot on a vehicle with no kit): black glass, its route and destination in amber.
  const sv = car.parts.service;
  if (sv?.kind === "bus") {
    const sign = signDecal(`${sv.number} ${DESTINATIONS[Number(sv.number) % DESTINATIONS.length]}`);
    out[BODY_SLOT.neon] = slot(role({ light: 0.12, chroma: 0.01, hue: 260 }, "matte", 0.2), "none", 0, { decal: { decal: sign, rect: [0, 0, 1, 1], flipU: true, flipV: false, inks: [role(SIGN_AMBER, "glow", 0.3)] } });
  }
  out[BODY_SLOT.carbon] = slot(role({ light: 0.22, chroma: 0.01, hue: 250 }, "leather", 0.34), "weave", 1.5);
  out[BODY_SLOT.metal] = slot(role({ light: 0.62, chroma: 0.02, hue: 70 }, "metal", 0.6), "bayer4", 1);
  // The licence plate (only when there is one): its first ink the plate, its picture and text the decal over all of it.
  const pl = options.plate;
  if (pl) out[BODY_SLOT.plate] = slot(role(pl.inks[0]!, "matte", 0.4), "bayer2", 0.3, { decal: { decal: pl.decal, rect: [0, 0, 1, 1], flipU: false, flipV: false, inks: pl.inks.map((k) => role(k, "matte", 0.42)) } });
  out[BODY_SLOT.interior] = kit?.cabin
    ? slot(role({ ...P.glow, light: Math.min(0.72, P.glow.light) }, "glow", 0.34), "none", 0)
    : slot(role(car.paints.alt.light > 0.5 ? { light: 0.3, chroma: 0.04, hue: 40 } : { light: 0.2, chroma: 0.02, hue: 20 }, "leather", 0.3), "bayer2", 0.5);
  return out;
}

/** The rim's look: its paint as a ramp, a finish and a screen -- or a glow. */
function rimPaint(car: Car, role: (c: Colour, f: RoleFinish, span: number) => RoleLook): SlotPaint {
  const P = car.paints;
  const slot = (look: RoleLook, screen: PaintScreen, dither: number): SlotPaint => ({ look, ink: null, screen, dither });
  if (P.effect === "glowrims" || P.neon?.rims) return slot(role(P.glow, "glow", 0.36), "none", 0);
  if (P.type === "gold") return slot(role({ light: 0.74, chroma: 0.12, hue: 85 }, "metal", 0.6), "ign", 1.1);
  if (P.type === "stealth") return slot(role({ light: 0.2, chroma: 0.01, hue: 260 }, "leather", 0.3), "bayer2", 0.4);
  switch (P.rim) {
    case "chrome": return slot(role({ light: 0.76, chroma: 0.01, hue: 250 }, "metal", 0.68), "bayer8", 1.2);
    case "gold": return slot(role({ light: 0.74, chroma: 0.12, hue: 85 }, "metal", 0.6), "ign", 1.1);
    case "black": return slot(role({ light: 0.24, chroma: 0.01, hue: 260 }, "leather", 0.4), "bayer4", 0.6);
    case "gunmetal": return slot(role({ light: 0.46, chroma: 0.01, hue: 240 }, "metal", 0.56), "halftone", 1);
    case "white": return slot(role({ light: 0.9, chroma: 0.01, hue: 90 }, "matte", 0.36), "bayer2", 0.5);
    case "bronze": return slot(role({ light: 0.56, chroma: 0.09, hue: 60 }, "metal", 0.58), "diagonal", 1);
    case "body": return slot(role(P.body, "metal", 0.56), FINISH_LOOK[P.finish].screen, FINISH_LOOK[P.finish].dither);
  }
}

/** A wheel layer's paint (both of a car's wheel shapes wear it). */
export function wheelPaint(car: Car, options: PaintOptions = {}): LayerPaint {
  const light = options.light ?? 1;
  const role = (c: Colour, finish: RoleFinish, span: number): RoleLook => ({
    hue: snap(c.hue, 5) % 360, chroma: snap(clamp(c.chroma * (finish === "glow" ? 1 : 0.6 + 0.4 * light), 0, 0.32), 0.01),
    light: snap(clamp(finish === "glow" ? c.light : c.light * (0.35 + 0.65 * light), 0.08, 0.96), 0.02), span: snap(clamp(span, 0.2, 0.8), 0.02), finish, pattern: NONE,
  });
  const P = car.paints;
  const tyreScreen: PaintScreen = car.wheels[0].tyre === "slick" ? "bayer2" : "checker";
  const out: (SlotPaint | null)[] = new Array<SlotPaint | null>(32).fill(null);
  out[WHEEL_SLOT.tyre] = { look: role(P.tyre, "matte", 0.3), ink: null, screen: tyreScreen, dither: 0.6 };
  out[WHEEL_SLOT.tread] = { look: role({ ...P.tyre, light: clamp(P.tyre.light - 0.04, 0.08, 1) }, "matte", 0.24), ink: null, screen: "hatch", dither: 0.7 };
  out[WHEEL_SLOT.wall] = { look: role({ light: 0.9, chroma: 0.01, hue: 90 }, "matte", 0.3), ink: null, screen: "bayer2", dither: 0.4 };
  out[WHEEL_SLOT.rim] = rimPaint(car, role);
  out[WHEEL_SLOT.hub] = { look: role(P.accent, "metal", 0.5), ink: null, screen: "bayer2", dither: 0.6 };
  out[WHEEL_SLOT.caliper] = { look: role(P.caliper, "matte", 0.4), ink: null, screen: "none", dither: 0 };
  out[WHEEL_SLOT.barrel] = { look: role({ light: 0.12, chroma: 0.01, hue: 260 }, "matte", 0.2), ink: null, screen: "checker", dither: 0.4 };
  // A spinner's blades: the rim's own finish, a touch brighter (it is the thing the eye follows as it turns).
  out[WHEEL_SLOT.spinner] = car.wheels[0]!.spinner === "none" ? null : rimPaint(car, (c, f, span) => role({ ...c, light: Math.min(0.96, c.light + 0.06) }, f, span));
  return out;
}
