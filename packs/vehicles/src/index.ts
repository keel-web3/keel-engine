// packs/vehicles: generative cars. Traits the Pixel Marine's way (traits.ts: named bases at integer odds, several per
// site, the rarest takes the chip), dials and variance (car.ts), bake shapes parted out panel by panel with wheels that
// spin and steer as their own layers (shapes.ts), paints with a finish, a dither screen, a sheen and a decal per panel
// (paint.ts, decals.ts), the token's attributes and papers (metadata.ts), and driving (drive.ts).

export { ARCHETYPES, ARCHETYPE_DIALS, DIALS, PANELS, generateCar } from "./car.ts";
export type {
  Archetype, BodyGeometry, Bumper, Car, CarDecal, CarOptions, CarPaints, CarParts, CarType, Colour, Dial, Effect, Exhaust, Finish, Grille, Handling, HeadLights, Livery, Panel, PanelPaint,
  RimPaint, RimStyle, RoofKind, SemiParts, Spoiler, TailLights, Tyre, WheelMount, WheelSpec,
} from "./car.ts";
export { BODY_STYLES, SPECIAL_STYLES, CATEGORIES, EFFECT_TABLE, LIGHT_TABLE, NEON_TABLE, ONE_PPM, RIM_SIZE_TABLE, SPINNER_TABLE, PAINT_FAMILIES, SITES, TIER_LADDER, TYPE_TABLE, chipsOf, points, possibleCars, scoreOf, tierOf, traitPpm } from "./traits.ts";
export type { BodyStyle, Category, Site, Table, Tier, Trait } from "./traits.ts";
export { BODY_SLOT, SPIN_FRAMES, WHEEL_CLIPS, WHEEL_SLOT, bodyDesign, geometryKey, glassDesign, panelFace, panelSlot, exhaustTips, spinFrame, stackTops, tailLamps, tailSpan, backPanelOf, spinPeriod, spinnerDesign, wheelDesign } from "./shapes.ts";
export type { PanelFace, VehicleDesign } from "./shapes.ts";
export { FINISH_LOOK, bodyPaint, wheelPaint } from "./paint.ts";
export type { PaintOptions } from "./paint.ts";
export { carDecals, sprayDecal } from "./decals.ts";
export { PLATE_HALF, PLATE_HEIGHT, carPlate, isVanity, plateCard, plateDecal, plateDesign, plateFit, platePrints, plateText, vanityMax } from "./plate.ts";
export type { PlateFit, PlatePaint, PlateTexture } from "./plate.ts";
// How a car sits on its springs and axles as it drives (dive, squat, lean; solid rear axles).
export { carStance, springsOf, stepStance } from "./stance.ts";
export type { SpringSpec, Stance, StanceInput } from "./stance.ts";
export type { ExtraDecal, PlacedDecal } from "./decals.ts";
export { onchainAttributes, papers } from "./metadata.ts";
export type { Attribute } from "./metadata.ts";
export { carState, separateCars, stepCar } from "./drive.ts";
export type { CarState, DriveInput, Impact } from "./drive.ts";
export { at, clamp, drawsOf, hash32, snap } from "./draws.ts";
export type { Draws } from "./draws.ts";

import { dcos, dsin } from "@keel-engine/core";
import type { Car, WheelMount } from "./car.ts";
import { bodyDesign, glassDesign, spinFrame, spinnerDesign, wheelDesign } from "./shapes.ts";
import type { VehicleDesign } from "./shapes.ts";

/** A car's bake shapes: its body, its glass (a see-through layer over it), and its front and rear wheel shapes (the same design twice when they match). */
export function carDesigns(car: Car): { body: VehicleDesign; glass: VehicleDesign; wheels: readonly [VehicleDesign, VehicleDesign]; spinner: VehicleDesign | null } {
  const front = wheelDesign(car.wheels[0]);
  const rear = wheelDesign(car.wheels[1]);
  // (A spinner is its own design: the game turns it at its own rate, over the wheel's hub.)
  return { body: bodyDesign(car), glass: glassDesign(car), wheels: [front, rear.key === front.key ? front : rear], spinner: spinnerDesign(car.wheels[0]) };
}

/** A wheel as it's drawn this frame: where (world ground point), which way it faces (yaw), which spin frame. */
export interface PlacedWheel { readonly x: number; readonly z: number; readonly yaw: number; readonly frame: number; readonly mount: WheelMount }

/** Where a car's wheels are drawn: each mount turned by the car's yaw, the front ones facing yaw + steer, rolled by `rolled` metres. */
export function placeWheels(car: Car, x: number, z: number, yaw: number, steer: number, rolled: number): PlacedWheel[] {
  const c = dcos(yaw), s = dsin(yaw);
  return car.mounts.map((m) => {
    const w = car.wheels[m.shape];
    // (Car frame to world: right = [cos, 0, -sin], front = [sin, 0, cos].)
    return { x: x + m.x * c + m.z * s, z: z - m.x * s + m.z * c, yaw: yaw + (m.steers ? steer : 0), frame: spinFrame(w, rolled / w.radius), mount: m };
  });
}
export type { CarPhysics } from "./physics.ts";
export { physicsOf } from "./physics.ts";
export type { LightState } from "./lights.ts";
export { carLights, colourRgb, hasNeon, lampColours, lampSpots } from "./lights.ts";

export { mechanicsOf, MECHANICAL_PARTS } from "./mechanics.ts";
export type { MechanicalSpec, MechanicalUpgrades, MechanicalPart } from "./mechanics.ts";
export { engineAccess, enginePanelPose, engineMotion, enginePivot } from "./engine-access.ts";
export { mechanicalBounds } from "./shapes.ts";
export { convertibleOf, convertiblePose } from "./roof.ts";
export type { ConvertibleSpec, RoofPiece } from "./roof.ts";
// The glasshouse: each pane's corners and the room inside them -- what cracks, wipers, cockpits and seated drivers fit to.
export { GLASS_THICKNESS, cabinMargin, ceilingAt, glasshouse, keepInside, reachAt, standIn } from "./glass.ts";
export type { CabinPlane, GlassCar, GlassPane, Glasshouse, PaneName, StandIn } from "./glass.ts";
