// The city's SERVICE VEHICLES: a low-floor city bus, a fire engine (a pumper or an aerial ladder), a Type III
// ambulance, a police cruiser and a three-axle dump truck -- the special styles (traits.ts SPECIAL_STYLES) a game asks
// for by name to fill its streets, never drawn for a seed and never minted.
//
// Four of them are built their own way, as the semi tractor is (semi.ts): their own measurements (serviceRig -- honest
// sizes, axles where the real ones are, duals as one wide tyre), their own handling, and their own body
// (serviceSolids), parted into panels -- doors, wings, the sides behind them, the back -- each its panel's slot, so
// they wear paint, livery panels and decals as a car does. The police cruiser is the sedan it is, with its kit on
// (policeKit: a light bar, a push bar, a spot lamp).
//
// BEACONS: slots 30 and 31 (BODY_SLOT.beaconA/B) are the two halves of a vehicle's flashing lights -- red and blue on
// the cruiser, red and white on the fire engine and the ambulance, amber on the dump truck, none on the bus. Where
// each lamp sits is `parts.service.beacons`; lights.ts flashes them (carLights' `beacon` phase).
//
// Deterministic: every draw is a tag of its own (no car's draw moves), dmath for every angle.

import { datan2, dcos, dhypot, dsin } from "@keel-engine/core";
import { meshMatrix, mulMatrix } from "@keel-engine/bake";
import type { BodyGeometry, Car, CarDecal, Colour, Dial, Handling, Panel, PanelPaint, WheelMount, WheelSpec } from "./car.ts";
import { at, snap } from "./draws.ts";
import type { Draws } from "./draws.ts";
import { glasshouse } from "./glass.ts";
import { both, box, cap, component, pane, solids, wedge } from "./solids.ts";
import type { Solids } from "./solids.ts";
import type { PanelFace } from "./shapes.ts";
import { BODY_SLOT } from "./slots.ts";

export type ServiceKind = "bus" | "fire" | "ambulance" | "police" | "dump";

/** Each service vehicle's style name (what `generateCar(seed, { style })` takes). */
export const SERVICE_STYLES: Readonly<Record<ServiceKind, string>> = { bus: "City Bus", fire: "Fire Engine", ambulance: "Ambulance", police: "Police Cruiser", dump: "Dump Truck" };

/** A beacon lamp: where it sits (car frame) and which half of the flash it is (slot 30 A, 31 B). */
export interface BeaconLamp { readonly x: number; readonly y: number; readonly z: number; readonly slot: 30 | 31 }

/**
 * A dump truck's bed, inside (car frame, lowered): its floor's top `y`, its inside walls x0..x1 and z0 (the tailgate)
 * ..z1 (the front wall), the sides' top; and the hinge it tips about (y, z; across the car).
 */
export interface DumpBed {
  readonly x0: number; readonly x1: number; readonly y: number; readonly z0: number; readonly z1: number; readonly top: number;
  readonly hingeY: number; readonly hingeZ: number;
}

/**
 * A service vehicle's own forms: its kind, its form within the kind (a bus's power -- diesel, hybrid, cng; a fire
 * engine's -- pumper, aerial), its livery scheme, its unit or route number and the name on its sides, its axles (z,
 * front first), its beacons, and the measurements its body is built from (`m`, metres in the car frame).
 */
export interface ServiceParts {
  readonly kind: ServiceKind;
  readonly form: string;
  readonly livery: string;
  readonly number: string;
  readonly title: string;
  readonly axles: readonly number[];
  readonly beacons: readonly BeaconLamp[];
  readonly m: Readonly<Record<string, number>>;
}

const A = BODY_SLOT.beaconA, B = BODY_SLOT.beaconB, P = BODY_SLOT;

// ---------------------------------------------------------------- measurements

type BusM = { readonly floor: number; readonly winTop: number; readonly fd0: number; readonly fd1: number; readonly cd0: number; readonly cd1: number; readonly bike: number };
type FireM = {
  readonly face: number; readonly cabRoof: number; readonly crewRoof: number; readonly roofStep: number; readonly bodyFront: number; readonly bodyRear: number;
  readonly top: number; readonly ly: number; readonly tt: number;
};
/** An ambulance box's kerb-side door, from the box's front (m): its panel stops there. */
const SIDE_DOOR = 0.95;
type AmbM = { readonly boxHw: number; readonly cabHw: number; readonly nose: number; readonly cowl: number; readonly screenTop: number; readonly boxFront: number; readonly boxRear: number; readonly cabRoof: number; readonly boxBottom: number; readonly twin: number };
type PoliceM = { readonly barZ: number; readonly barW: number; readonly barY: number; readonly noseTop: number };
type DumpM = { readonly face: number; readonly cabBottom: number; readonly floor: number; readonly sideTop: number; readonly frontTop: number; readonly lipZ: number; readonly z0: number; readonly z1: number; readonly bedAlt: number };

export interface ServiceRig {
  readonly body: BodyGeometry;
  readonly wheels: readonly [WheelSpec, WheelSpec];
  readonly mounts: WheelMount[];
  readonly handling: Handling;
  readonly service: ServiceParts;
  readonly bed?: DumpBed;
}

/** A truck's wheels: a single steered tyre in front, the rear ones duals (one tyre, twice as wide, as the semi's). */
function truckWheels(wheel: WheelSpec, R: number, front: number, rear: number): readonly [WheelSpec, WheelSpec] {
  const f: WheelSpec = { ...wheel, radius: R, width: front, sidewall: 0.4, dish: 0.04, spinner: "none", tyre: "street" };
  return [f, { ...f, width: rear }];
}
function truckMounts(axles: readonly number[], track: readonly [number, number]): WheelMount[] {
  const out: WheelMount[] = [];
  axles.forEach((z, i) => { for (const s of [-1, 1] as const) out.push({ x: s * track[i ? 1 : 0], z, steers: i === 0, shape: i ? 1 : 0, side: s }); });
  return out;
}
/** A truck's handling: its weight and power, air from its face, and the brakes, grip and lock of a lorry. */
function truckHandling(o: { massT: number; kw: number; cd: number; face: number; top: number; accel: number; brake: number; grip: number; steer: number; body: BodyGeometry }): Handling {
  const g = o.body;
  return {
    massKg: Math.round(o.massT * 1000), power: Math.round(o.kw * 1000), drag: snap(0.5 * 1.225 * o.cd * o.face, 0.001), roll: 0.008,
    brakeG: snap(Math.min(0.75, o.brake / 9.81), 0.01), topSpeed: snap(o.top, 0.1), accel: snap(o.accel, 0.1), brake: snap(o.brake, 0.1), grip: snap(o.grip, 0.1), steer: o.steer,
    wheelbase: g.wheelbase, mass: o.massT, radius: snap(Math.max(g.width / 2, g.length * 0.3), 0.01), halfLength: snap(g.length / 2, 0.01), halfWidth: snap(g.width / 2 + 0.03, 0.01),
  };
}
const geometry = (o: Omit<BodyGeometry, "tailRound" | "tailRoll" | "tailTuck" | "shoulder" | "flare" | "strip" | "wheelbase">): BodyGeometry =>
  ({ ...o, tailRound: 0, tailRoll: 0, tailTuck: 0, shoulder: 0.02, flare: 0, strip: 0.2, wheelbase: snap(o.frontAxle - o.rearAxle, 0.01) });

/** A service vehicle's measurements, wheels, handling and forms, from its own draws (the cruiser's body is the car's). */
export function serviceRig(kind: Exclude<ServiceKind, "police">, D: Draws, d: Readonly<Record<Dial, number>>, wheel: WheelSpec): ServiceRig {
  const power01 = (d.power + 1) / 2, mass01 = (d.mass + 1) / 2;
  switch (kind) {
    case "bus": {
      // A 12 m low-floor bus: a long front overhang with the door ahead of the wheels, a longer rear one over the engine.
      const L = snap(at(D.flat("bus.len"), 11.6, 12.4), 0.05), L2 = L / 2, hw = 1.275, R = 0.5;
      const frontAxle = snap(L2 - at(D.flat("bus.fo"), 2.55, 2.8), 0.01);
      const rearAxle = snap(frontAxle - at(D.flat("bus.wb"), 5.8, 6.25), 0.01);
      const roof = snap(at(D.flat("bus.roof"), 2.92, 3.04), 0.01), ride = 0.26, belt = 1.18;
      const fd1 = snap(L2 - 0.32, 0.01), fd0 = snap(fd1 - 1.22, 0.01), cd0 = snap(rearAxle + R + 0.42, 0.01), cd1 = snap(cd0 + 1.22, 0.01);
      const m: BusM = { floor: 0.36, winTop: 2.4, fd0, fd1, cd0, cd1, bike: D.u("bus.bike") < 0.55 ? 1 : 0 };
      const body = geometry({
        length: L, width: 2 * hw, ride, belt, roof, cabRear: snap(-L2 + 0.25, 0.01), cabFront: snap(L2 - 0.12, 0.01), cabWidth: 2 * hw - 0.1, screenRun: 0.1, rearRun: 0.05,
        nose: 0.12, noseLo: snap((0.95 - ride) / (belt - ride), 0.02), tail: 0.25, tailLo: 0.8, doorFront: snap(frontAxle - R - 0.14, 0.01), doorRear: snap(rearAxle + R + 0.14, 0.01),
        frontAxle, rearAxle, track: [snap(hw - 0.04 - 0.15, 0.01), snap(hw - 0.04 - 0.3, 0.01)],
      });
      const form = D.pick<string>("bus.form", [["diesel", 5], ["hybrid", 3], ["cng", 2]]);
      const service: ServiceParts = {
        kind, form, livery: D.pick<string>("bus.livery", [["metro", 5], ["solid", 3], ["heritage", 2]]), number: String(2 + Math.floor(D.u("bus.route") * 97)),
        title: D.pick<string>("bus.title", [["METRO", 3], ["TRANSIT", 2], ["CITYLINK", 2], ["RAPID", 1]]), axles: [frontAxle, rearAxle], beacons: [], m,
      };
      // (Eleven to thirteen tonnes empty -- batteries or gas tanks on the roof are most of another -- 200 to 260 kW.)
      const massT = snap(10.9 + 1.4 * mass01 + (form === "hybrid" ? 0.9 : form === "cng" ? 0.6 : 0), 0.01);
      return {
        body, wheels: truckWheels(wheel, R, 0.3, 0.6), mounts: truckMounts(service.axles, body.track), service,
        handling: truckHandling({ massT, kw: 200 + 60 * power01, cd: 0.62, face: 2 * hw * (roof - 0.3), top: 24 + 2 * power01, accel: 1.0 + 0.4 * power01, brake: 5, grip: 6.2, steer: 0.66, body }),
      };
    }
    case "fire": {
      // A custom cab set forward over a set-back front axle, a crew cab behind the driver, lockers behind that. An
      // aerial is longer, on a tandem, with its ladder over the cab.
      const aerial = D.u("fire.form") < 0.42, hw = 1.25, R = 0.53;
      const L = snap(aerial ? at(D.flat("fire.len"), 11.4, 12.2) : at(D.flat("fire.len"), 9.8, 10.5), 0.05), L2 = L / 2;
      const face = snap(L2 - 0.42, 0.01), frontAxle = snap(face - 1.2, 0.01), cabRear = snap(face - 3.05, 0.01);
      const raised = D.u("fire.raised") < 0.5, crewRoof = raised ? 3.22 : 2.95;
      const top = aerial ? 2.2 : 2.32, bodyRear = snap(-L2 + 0.4, 0.01);
      const axles = aerial ? [frontAxle, snap(-L2 + 3.5, 0.01), snap(-L2 + 2.08, 0.01)] : [frontAxle, snap(-L2 + 2.75, 0.01)];
      const rearAxle = aerial ? snap((axles[1]! + axles[2]!) / 2, 0.01) : axles[1]!;
      const m: FireM = {
        face, cabRoof: 2.95, crewRoof, roofStep: raised ? snap(face - 1.4, 0.01) : cabRear, bodyFront: snap(cabRear - 0.78, 0.01), bodyRear, top,
        ly: snap(Math.max(top + 0.72, crewRoof + 0.3), 0.01), tt: snap(bodyRear + 1.2, 0.01),
      };
      const ride = 0.55, belt = 1.72;
      const body = geometry({
        length: L, width: 2 * hw, ride, belt, roof: crewRoof, cabRear, cabFront: face, cabWidth: 2 * hw - 0.1, screenRun: 0.1, rearRun: 0.05,
        nose: 0.42, noseLo: snap((0.84 - ride) / (belt - ride), 0.02), tail: 0.4, tailLo: 0.4, doorFront: snap(face - 0.55, 0.01), doorRear: snap(face - 1.5, 0.01),
        frontAxle, rearAxle, track: [snap(hw - 0.03 - 0.16, 0.01), snap(hw - 0.03 - 0.31, 0.01)],
      });
      const bodyTop = top + (aerial ? 0 : 0.05);
      const beacons: BeaconLamp[] = [
        ...([[-0.78, A], [-0.26, B], [0.26, B], [0.78, A]] as const).map(([x, slot]) => ({ x, y: 3.06, z: snap(face - 0.35, 0.01), slot })),
        { x: -0.92, y: 1.23, z: face + 0.01, slot: A }, { x: 0.92, y: 1.23, z: face + 0.01, slot: B },
        { x: -(hw - 0.2), y: bodyTop - 0.15, z: bodyRear - 0.03, slot: A }, { x: hw - 0.2, y: bodyTop - 0.15, z: bodyRear - 0.03, slot: B },
        { x: -(hw + 0.01), y: top - 0.15, z: snap(m.bodyFront - 0.25, 0.01), slot: A }, { x: hw + 0.01, y: top - 0.15, z: snap(m.bodyFront - 0.25, 0.01), slot: B },
      ];
      const service: ServiceParts = { kind, form: aerial ? "aerial" : "pumper", livery: "fleet", number: String(1 + Math.floor(D.u("fire.unit") * 60)), title: aerial ? "LADDER" : "ENGINE", axles, beacons, m };
      // (A pumper is sixteen to eighteen tonnes with its water, an aerial twenty-five and more; 300 to 420 kW.)
      const massT = snap(aerial ? 24.5 + 3 * mass01 : 16.2 + 2 * mass01, 0.01);
      return {
        body, wheels: truckWheels(wheel, R, 0.32, 0.62), mounts: truckMounts(axles, body.track), service,
        handling: truckHandling({ massT, kw: (aerial ? 350 : 300) + 70 * power01, cd: 0.78, face: 2 * hw * (crewRoof - 0.4), top: aerial ? 27 : 29, accel: aerial ? 1.0 : 1.3 + 0.2 * power01, brake: 5.5, grip: 6.6, steer: aerial ? 0.58 : 0.6, body }),
      };
    }
    case "ambulance": {
      // A Type III: a cutaway van's cab and bonnet, a square box behind it on a dually rear axle.
      const L = snap(at(D.flat("amb.len"), 6.8, 7.3), 0.05), L2 = L / 2, boxHw = 1.15, cabHw = 1.0, R = 0.4;
      const nose = snap(L2 - 0.1, 0.01), frontAxle = snap(L2 - 0.92, 0.01), cowl = snap(L2 - 1.58, 0.01);
      const boxFront = snap(cowl - 0.98, 0.01), boxRear = snap(-L2 + 0.2, 0.01);
      const rearAxle = snap(frontAxle - at(D.flat("amb.wb"), 3.9, 4.2), 0.01);
      const boxTop = snap(at(D.flat("amb.box"), 2.8, 2.95), 0.01), ride = 0.45, belt = 1.28;
      const m: AmbM = { boxHw, cabHw, nose, cowl, screenTop: snap(cowl - 0.62, 0.01), boxFront, boxRear, cabRoof: 2.28, boxBottom: 0.88, twin: D.u("amb.twin") < 0.5 ? 1 : 0 };
      const body = geometry({
        length: L, width: 2 * boxHw, ride, belt, roof: boxTop, cabRear: boxRear, cabFront: cowl, cabWidth: 2 * boxHw - 0.04, screenRun: snap(cowl - boxFront, 0.01), rearRun: 0.05,
        nose: snap(L2 - cowl, 0.01), noseLo: snap((1.02 - ride) / (belt - ride), 0.02), tail: 0.2, tailLo: 0.8, doorFront: cowl, doorRear: snap(boxFront + 0.05, 0.01),
        frontAxle, rearAxle, track: [snap(cabHw - 0.02 - 0.12, 0.01), snap(boxHw - 0.1 - 0.23, 0.01)],
      });
      const bz = snap((boxFront + m.screenTop) / 2, 0.01), c = boxHw - 0.17;
      const beacons: BeaconLamp[] = [
        { x: -0.4, y: 2.38, z: bz, slot: A }, { x: 0.4, y: 2.38, z: bz, slot: B }, { x: -0.45, y: 0.76, z: nose + 0.02, slot: A }, { x: 0.45, y: 0.76, z: nose + 0.02, slot: B },
        { x: -c, y: boxTop - 0.15, z: boxFront + 0.03, slot: A }, { x: c, y: boxTop - 0.15, z: boxFront + 0.03, slot: B },
        { x: -c, y: boxTop - 0.15, z: boxRear - 0.03, slot: A }, { x: c, y: boxTop - 0.15, z: boxRear - 0.03, slot: B },
      ];
      const service: ServiceParts = { kind, form: "type3", livery: "stripe", number: String(10 + Math.floor(D.u("amb.unit") * 89)), title: "AMBULANCE", axles: [frontAxle, rearAxle], beacons, m };
      const massT = snap(5.6 + 1.0 * mass01, 0.01);
      return {
        body, wheels: truckWheels(wheel, R, 0.24, 0.46), mounts: truckMounts(service.axles, body.track), service,
        handling: truckHandling({ massT, kw: 210 + 50 * power01, cd: 0.6, face: 2 * boxHw * (boxTop - 0.45), top: 36 + 3 * power01, accel: 2.0 + 0.6 * power01, brake: 7, grip: 7.4, steer: 0.62, body }),
      };
    }
    case "dump": {
      // A cab over the front axle, a tandem of drive axles under a steel bed, the ram between them.
      const L = snap(at(D.flat("dump.len"), 8.2, 8.9), 0.05), L2 = L / 2, hw = 1.25, R = 0.53;
      const face = snap(L2 - 0.18, 0.01), frontAxle = snap(L2 - 1.35, 0.01), cabRear = snap(face - 1.95, 0.01);
      const roof = D.u("dump.roof") < 0.4 ? 3.32 : 3.05;
      const d2 = snap(-L2 + 1.3, 0.01), d1 = snap(d2 + 1.36, 0.01), rearAxle = snap((d1 + d2) / 2, 0.01);
      // (The bed's sides: a low aggregate body to a tall one -- the seed's.)
      const floor = 1.42, sideTop = snap(floor + snap(at(D.flat("dump.bed"), 0.9, 1.35), 0.05), 0.01);
      const z0 = snap(-L2 + 0.08, 0.01), z1 = snap(cabRear - 0.45, 0.01);
      const m: DumpM = { face, cabBottom: 1.12, floor, sideTop, frontTop: snap(Math.max(sideTop + 0.25, roof + 0.12), 0.01), lipZ: snap(cabRear + 0.55, 0.01), z0, z1, bedAlt: D.u("dump.bedPaint") < 0.45 ? 1 : 0 };
      const ride = 0.45, belt = 1.95;
      const body = geometry({
        length: L, width: 2 * hw, ride, belt, roof, cabRear, cabFront: face, cabWidth: 2 * hw - 0.1, screenRun: 0.1, rearRun: 0.05,
        nose: 0.18, noseLo: snap((0.82 - ride) / (belt - ride), 0.02), tail: 0.1, tailLo: 0.28, doorFront: snap(face - 0.28, 0.01), doorRear: snap(face - 1.55, 0.01),
        frontAxle, rearAxle, track: [snap(hw - 0.03 - 0.16, 0.01), snap(hw - 0.03 - 0.31, 0.01)],
      });
      const beacons: BeaconLamp[] = [{ x: -0.35, y: roof + 0.1, z: snap(face - 0.35, 0.01), slot: A }, { x: 0.35, y: roof + 0.1, z: snap(face - 0.35, 0.01), slot: B }];
      const service: ServiceParts = {
        kind, form: "tipper", livery: m.bedAlt ? "steel bed" : "fleet", number: String(1 + Math.floor(D.u("dump.unit") * 98)),
        title: D.pick<string>("dump.title", [["CITY WORKS", 3], ["PUBLIC WORKS", 2], ["ROADS DEPT", 2], ["HAULAGE", 1]]), axles: [frontAxle, d1, d2], beacons, m,
      };
      const bed: DumpBed = { x0: -(hw - 0.07), x1: hw - 0.07, y: floor, z0, z1, top: sideTop, hingeY: 1.16, hingeZ: snap(z0 + 0.1, 0.01) };
      const massT = snap(12.8 + 2.2 * mass01, 0.01);
      return {
        body, bed, wheels: truckWheels(wheel, R, 0.32, 0.62), mounts: truckMounts(service.axles, body.track), service,
        handling: truckHandling({ massT, kw: 290 + 60 * power01, cd: 0.8, face: 2 * hw * (roof - 0.4), top: 25 + 2 * power01, accel: 1.0 + 0.3 * power01, brake: 5.2, grip: 6.6, steer: 0.6, body }),
      };
    }
  }
}

/** The cruiser's kit, measured off its own sedan: where the light bar stands on its roof, and its nose's height. */
export function policeParts(D: Draws, car: Pick<Car, "archetype" | "body" | "dials">): ServiceParts {
  const g = car.body, house = glasshouse({ archetype: car.archetype, body: g, parts: { open: false }, dials: car.dials });
  const zs = house ? house.zs : g.cabFront - g.screenRun, zr = house ? house.zr : g.cabRear + g.rearRun, Ci = house ? house.Ci : g.cabWidth / 2;
  const barZ = snap(zs - Math.min(0.3, (zs - zr) * 0.35), 0.01), barW = snap(Math.min(Ci - 0.04, 0.62), 0.01), barY = g.roof;
  const m: PoliceM = { barZ, barW, barY, noseTop: snap(g.ride + (g.belt - g.ride) * g.noseLo, 0.01) };
  return {
    kind: "police", form: "cruiser", livery: "black and white", number: String(10 + Math.floor(D.u("police.unit") * 89)), title: "POLICE", axles: [g.frontAxle, g.rearAxle],
    beacons: [{ x: -barW / 2, y: barY + 0.09, z: barZ, slot: A }, { x: barW / 2, y: barY + 0.09, z: barZ, slot: B }], m,
  };
}

// ---------------------------------------------------------------- paint, decals, faces

const WHITE: Colour = { light: 0.94, chroma: 0.01, hue: 90 }, CREAM: Colour = { light: 0.9, chroma: 0.04, hue: 85 }, BLACK: Colour = { light: 0.18, chroma: 0.01, hue: 260 };
const GOLD: Colour = { light: 0.78, chroma: 0.13, hue: 85 };
/** The beacons' lenses: what each flashes. */
const LAMP = {
  red: { light: 0.6, chroma: 0.24, hue: 25 }, white: { light: 0.95, chroma: 0.02, hue: 240 }, blue: { light: 0.55, chroma: 0.22, hue: 262 }, amber: { light: 0.8, chroma: 0.18, hue: 65 },
} as const satisfies Record<string, Colour>;
const BANDS: ReadonlyArray<readonly [Colour, number]> = [
  [{ light: 0.5, chroma: 0.16, hue: 255 }, 4], [{ light: 0.52, chroma: 0.2, hue: 25 }, 3], [{ light: 0.56, chroma: 0.15, hue: 150 }, 3],
  [{ light: 0.66, chroma: 0.17, hue: 50 }, 2], [{ light: 0.58, chroma: 0.11, hue: 190 }, 2], [{ light: 0.42, chroma: 0.16, hue: 305 }, 1],
];

/** The paint a service vehicle wears over its family: its second colour and stripe, its livery panels, its beacons. */
export interface ServiceLook { readonly alt: Colour; readonly accent: Colour; readonly panels: readonly PanelPaint[]; readonly beacon: { readonly a: Colour; readonly b: Colour } | null; readonly trimChrome: boolean }
/** A fleet's tail lamps: plain red, whatever a car's table would have drawn. */
export const FLEET_TAIL: Colour = { light: 0.56, chroma: 0.2, hue: 25 };

export function serviceLook(sv: ServiceParts, D: Draws, body: Colour): ServiceLook {
  switch (sv.kind) {
    case "bus": {
      // Metro: a band along the skirt and a stripe under the glass; heritage: a cream band over the windows and a gold
      // line; solid: one colour and a white roof.
      if (sv.livery === "heritage") return { alt: CREAM, accent: GOLD, panels: [], beacon: null, trimChrome: false };
      if (sv.livery === "solid") return { alt: WHITE, accent: WHITE, panels: [], beacon: null, trimChrome: false };
      const alt = body.light > 0.7 ? D.pick("bus.band", BANDS) : WHITE;
      return { alt, accent: D.pick("bus.stripe", [...BANDS.filter(([c]) => c !== alt), [GOLD, 2]]), panels: [], beacon: null, trimChrome: false };
    }
    case "fire":
      return { alt: WHITE, accent: D.pick<Colour>("fire.stripe", [[GOLD, 3], [WHITE, 2], [{ light: 0.86, chroma: 0.17, hue: 100 }, 1]]), panels: [], beacon: { a: LAMP.red, b: LAMP.white }, trimChrome: true };
    case "ambulance": {
      const alt = D.pick<Colour>("amb.stripe", [[BANDS[1]![0], 4], [BANDS[3]![0], 2], [BANDS[0]![0], 3], [BANDS[2]![0], 2], [{ light: 0.8, chroma: 0.2, hue: 125 }, 1]]);
      return { alt, accent: D.pick<Colour>("amb.mark", [[{ light: 0.48, chroma: 0.17, hue: 258 }, 2], [alt, 1]]), panels: [], beacon: { a: LAMP.red, b: LAMP.white }, trimChrome: true };
    }
    case "police":
      return { alt: WHITE, accent: { light: 0.76, chroma: 0.01, hue: 250 }, panels: (["doorL", "doorR"] as const).map((panel) => ({ panel, kind: "livery" as const, colour: WHITE })), beacon: { a: LAMP.red, b: LAMP.blue }, trimChrome: false };
    case "dump": {
      // (Its bed in the cab's colour, or bare steel: the bed's sides and tailgate are panels, painted as the bed is.)
      const alt = sv.m.bedAlt ? D.pick<Colour>("dump.bed", [[{ light: 0.44, chroma: 0.01, hue: 250 }, 3], [BLACK, 2], [{ light: 0.3, chroma: 0.01, hue: 250 }, 1]]) : body;
      const panels: PanelPaint[] = sv.m.bedAlt ? (["quarterL", "quarterR", "trunk"] as const).map((panel) => ({ panel, kind: "livery" as const, colour: alt })) : [];
      return { alt, accent: BLACK, panels, beacon: { a: LAMP.amber, b: LAMP.amber }, trimChrome: false };
    }
  }
}

/** The lettering and markings a service vehicle wears (decals.ts paints them). */
export function serviceDecals(sv: ServiceParts, seed: string, body: Colour): CarDecal[] {
  const dark = body.light < 0.5, ink = dark ? "white" : "black";
  const d = (kind: CarDecal["kind"], text: string, panels: readonly Panel[], inks: CarDecal["inks"], emblem?: CarDecal["emblem"]): CarDecal =>
    ({ kind, seed: `${seed}|${sv.kind}|${kind}`, text, panels, inks, ...(emblem ? { emblem } : {}) });
  switch (sv.kind) {
    case "bus": return [d("lettering", sv.title, ["doorL", "doorR"], [sv.livery === "metro" && !dark ? "alt" : ink])];
    case "fire": return [d("lettering", `${sv.title}|${sv.number}`, ["doorL", "doorR"], ["gold", "gold", "white"], "cross"), d("chevrons", "", ["trunk"], ["gold", "body"])];
    case "ambulance": return [d("lettering", sv.title, ["quarterL", "quarterR"], ["accent", "accent", "white"], "star")];
    case "police": return [d("lettering", sv.title, ["doorL", "doorR"], ["black", "gold", "black"], "shield")];
    case "dump": return [d("lettering", `${sv.title.replace(" ", "|")} ${sv.number}`, ["doorL", "doorR"], [ink])];
  }
}

/** A service vehicle with a body of its own (every one but the cruiser, which is a sedan's). */
export const ownBody = (car: Pick<Car, "parts">): boolean => !!car.parts.service && car.parts.service.kind !== "police";

/** A panel's face as a decal sees it, where a service vehicle's differs from a car's: its panels' own sizes (all boxes). */
export function serviceFace(car: Car, panel: Panel): Partial<PanelFace> {
  const g = car.body, sv = car.parts.service!, L2 = g.length / 2, R = car.wheels[0].radius;
  const side = (u: number, v: number): Partial<PanelFace> => ({ u, v, uFront: true, readU: panel.endsWith("L") });
  const back = (u: number, v: number): Partial<PanelFace> => ({ face: "back", u, v, readU: false, readV: false });
  switch (sv.kind) {
    case "bus": {
      const m = sv.m as BusM, wf0 = g.frontAxle - R - 0.14, wr1 = g.rearAxle + R + 0.14;
      if (panel === "doorL") return side(wf0 - wr1, g.belt - g.ride);
      if (panel === "doorR") return side(wf0 - m.cd1, g.belt - g.ride);
      if (panel === "quarterL" || panel === "quarterR") return side(g.rearAxle - R - 0.14 + L2 - 0.04, g.belt - g.ride);
      if (panel === "trunk") return back(2 * (g.width / 2 - 0.12), 1.02);
      return {};
    }
    case "fire": {
      const m = sv.m as FireM;
      if (panel === "doorL" || panel === "doorR") return side(0.95, g.belt - (2 * R + 0.12));
      if (panel === "quarterL" || panel === "quarterR") return side(m.bodyFront - m.bodyRear, m.top - (2 * R + 0.14));
      if (panel === "trunk") return back(2 * (g.width / 2 - 0.07), m.top - 0.62);
      return {};
    }
    case "ambulance": {
      const m = sv.m as AmbM;
      if (panel === "doorL" || panel === "doorR") return side(m.cowl - m.boxFront - 0.05, g.belt - g.ride - 0.12);
      if (panel === "quarterL" || panel === "quarterR") return side(m.boxFront - m.boxRear - (panel === "quarterR" ? SIDE_DOOR : 0), g.roof - 0.02 - m.boxBottom);
      if (panel === "trunk") return back(1.56, g.roof - 0.28 - 0.95);
      return {};
    }
    case "dump": {
      const m = sv.m as DumpM;
      if (panel === "doorL" || panel === "doorR") return side(1.27, g.belt - m.cabBottom);
      if (panel === "quarterL" || panel === "quarterR") return side(m.z1 - m.z0 + 0.12, m.sideTop - m.floor + 0.12);
      if (panel === "trunk") return back(2 * (g.width / 2 - 0.02), m.sideTop - m.floor + 0.14);
      return {};
    }
    case "police": return {};
  }
}

/** Where its exhaust comes out (shapes.ts exhaustTips' shape): under a bus's tail, out of a truck's side ahead of its drive wheels. */
export function serviceExhaust(car: Car): Array<{ x: number; y: number; z: number; dz: number; dx: number; dy: number; r: number }> {
  const g = car.body, sv = car.parts.service!, L2 = g.length / 2, hw = g.width / 2, R = car.wheels[1].radius;
  const firstDrive = sv.axles[1]!;
  switch (sv.kind) {
    case "bus": return [{ x: -hw * 0.55, y: g.ride + 0.02, z: -L2 + 0.35, dx: 0, dy: -0.3, dz: -0.95, r: 0.05 }];
    case "ambulance": return [{ x: 0.55, y: 0.4, z: -L2 + 0.3, dx: 0, dy: -0.2, dz: -0.98, r: 0.04 }];
    default: return [{ x: hw - 0.04, y: 0.48, z: firstDrive + R + 0.35, dx: 0.9, dy: -0.25, dz: -0.35, r: 0.06 }];
  }
}

/**
 * A dump truck's bed tipped `tip` (0 down, 1 fully up: ~52 degrees) about its hinge: the matrix for its "dumpBed"
 * component, and the ram's ("dumpRam") -- turned about its foot and drawn out to meet the bed. Identity for anything else.
 */
export function dumpTipPose(car: Car, tip: number): { bed: Float32Array; ram: Float32Array } {
  const bed = typeof car.parts.bed === "object" ? car.parts.bed : null;
  if (!bed) return { bed: meshMatrix(), ram: meshMatrix() };
  const t = Math.max(0, Math.min(1, tip)), angle = -0.9 * t * t * (3 - 2 * t);
  const about = (y: number, z: number, pitch: number): Float32Array => mulMatrix(meshMatrix({ y, z, pitch }), meshMatrix({ y: -y, z: -z }));
  const bedM = about(bed.hingeY, bed.hingeZ, angle);
  // The ram: its foot on the frame, its head on the bed's front wall -- where the head goes, the ram points and reaches.
  const m = car.parts.service!.m as DumpM, zr = snap(car.body.cabRear - 0.2, 0.01), y0 = 1.0, y1 = m.floor + 0.45;
  const c = dcos(angle), s = dsin(angle), dy = y1 - bed.hingeY, dz = zr - bed.hingeZ;
  const hy = bed.hingeY + c * dy - s * dz, hz = bed.hingeZ + s * dy + c * dz;
  const len0 = y1 - y0, len1 = dhypot(hy - y0, hz - zr), lean = datan2(hz - zr, hy - y0);
  // (Up the ram's own axis: stretched along it, then leant -- a positive lean tips its head toward +z.)
  const stretch = new Float32Array([1, 0, 0, 0, 0, len1 / len0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const ram = mulMatrix(meshMatrix({ y: y0, z: zr, pitch: lean }), mulMatrix(stretch, meshMatrix({ y: -y0, z: -zr })));
  return { bed: bedM, ram };
}

// ---------------------------------------------------------------- the bodies

/** Where a service truck's engine sits (car frame, a box): a bus's behind its rear axle, a lorry's under its cab, the ambulance's under its bonnet. */
export function serviceEngine(car: Car): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null {
  const g = car.body, sv = car.parts.service, L2 = g.length / 2;
  if (!sv) return null;
  switch (sv.kind) {
    case "bus": return { x0: -0.5, y0: g.ride + 0.12, z0: -L2 + 0.32, x1: 0.5, y1: 1.0, z1: -L2 + 1.52 };
    case "fire": return { x0: -0.35, y0: 0.72, z0: g.frontAxle - 0.9, x1: 0.35, y1: 1.4, z1: g.frontAxle + 0.3 };
    case "dump": return { x0: -0.35, y0: 0.8, z0: g.frontAxle - 1.0, x1: 0.35, y1: 1.4, z1: g.frontAxle + 0.3 };
    case "ambulance": { const m = sv.m as AmbM; return { x0: -0.35, y0: 0.6, z0: m.cowl + 0.05, x1: 0.35, y1: 0.98, z1: m.nose - 0.3 }; }
    case "police": return null;
  }
}
const engineBlock = (S: Solids, car: Car): void => { const e = serviceEngine(car)!; component(S, "engineBlock", () => box(S, P.dark, e.x0, e.y0, e.z0, e.x1, e.y1, e.z1)); };

/** An arch over a wheel: capsules round the tyre from the front of its opening, over the top, to the back. */
function arch(S: Solids, slot: number, x: number, z: number, R: number, gap: number, r: number): void {
  let py = 0, pz = 0;
  for (let i = 0; i <= 7; i += 1) {
    const a = -1.35 + (2.7 * i) / 7, y = R + (R + gap) * dcos(a), zz = z + (R + gap) * dsin(a);
    if (i) cap(S, slot, [x, py, pz], [x, y, zz], r);
    py = y; pz = zz;
  }
}
/** What's left of [z0, z1] with the gaps taken out (pieces shorter than 4 cm dropped). */
function spans(z0: number, z1: number, gaps: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  let out: Array<[number, number]> = [[z0, z1]];
  for (const [a, b] of gaps) out = out.flatMap(([p, q]): Array<[number, number]> => (b <= p || a >= q ? [[p, q]] : ([[p, a], [b, q]] as Array<[number, number]>).filter(([u, v]) => v - u > 0.04)));
  return out;
}
/** A seated driver: a torso, a helmet (the accent's), the wheel ahead of them. */
function driver(S: Solids, x: number, seat: number, z: number): void {
  box(S, P.interior, x - 0.24, seat - 0.04, z - 0.16, x + 0.24, seat + 0.08, z + 0.3);
  box(S, P.interior, x - 0.24, seat, z - 0.24, x + 0.24, seat + 0.66, z - 0.14);
  box(S, P.dark, x - 0.17, seat + 0.08, z - 0.12, x + 0.17, seat + 0.56, z + 0.06);
  cap(S, P.accent, [x, seat + 0.7, z - 0.03], [x, seat + 0.7, z - 0.03], 0.13);
  cap(S, P.dark, [x, seat + 0.36, z + 0.42], [x, seat + 0.42, z + 0.36], 0.17);
}
/** A beacon lens: a small box at a lamp's spot, in its half's slot (its dark base behind it). */
function lens(S: Solids, b: BeaconLamp, hx: number, hy: number, hz: number): void { box(S, b.slot, b.x - hx, b.y - hy, b.z - hz, b.x + hx, b.y + hy, b.z + hz); }

export function serviceSolids(car: Car): Solids {
  switch (car.parts.service!.kind) {
    case "bus": return busSolids(car);
    case "fire": return fireSolids(car);
    case "ambulance": return ambulanceSolids(car);
    case "dump": return dumpSolids(car);
    case "police": return solids();
  }
}

function busSolids(car: Car): Solids {
  const S = solids(), g = car.body, sv = car.parts.service!, m = sv.m as BusM;
  const L2 = g.length / 2, hw = g.width / 2, R = car.wheels[0].radius, { ride, belt, roof } = g, winTop = m.winTop;
  const front = L2 - 0.02, back = -L2 + 0.02;
  const wf = { z0: g.frontAxle - R - 0.14, z1: g.frontAxle + R + 0.14 }, wr = { z0: g.rearAxle - R - 0.14, z1: g.rearAxle + R + 0.14 }, wellTop = 2 * R + 0.12;
  const upper = sv.livery === "heritage" ? P.alt : P.paint, roofSlot = sv.livery === "solid" ? P.alt : P.roof;

  // ---- the core: under the floor and over the windows, narrowed where the wheels are.
  for (const [z0, z1] of spans(back, front - 0.08, [[wf.z0, wf.z1], [wr.z0, wr.z1]])) box(S, P.paint, -(hw - 0.07), ride, z0, hw - 0.07, belt, z1);
  for (const w of [wf, wr]) {
    box(S, P.paint, -(hw - 0.7), ride, w.z0, hw - 0.7, belt, w.z1);
    both((s) => { box(S, P.dark, s * (hw - 0.72), ride, w.z0, s * (hw - 0.68), wellTop, w.z1); box(S, P.dark, s * (hw - 0.72), wellTop - 0.03, w.z0, s * (hw - 0.02), wellTop, w.z1); });
  }
  box(S, upper, -(hw - 0.02), winTop, back + 0.02, hw - 0.02, roof - 0.06, front - 0.1);
  box(S, roofSlot, -(hw - 0.03), roof - 0.07, back + 0.03, hw - 0.03, roof, front - 0.12);
  // Inside, through the glass: the saloon's dark wall, and the cockpit up front.
  box(S, P.interior, -(hw - 0.1), belt - 0.02, back + 0.1, hw - 0.1, winTop, front - 1.55);
  box(S, P.dark, -(hw - 0.08), belt - 0.06, front - 1.6, hw - 0.08, belt, front - 0.12);

  // ---- the lower sides, parted: a wing ahead of the front wheel, the long side (the door panel) between the wheels,
  // the quarter behind the rear. The kerb side (+x) has its two doors in it.
  both((s) => {
    const x0 = s * hw, x1 = s * (hw - 0.07), right = s > 0;
    const piece = (slot: number, z0: number, z1: number, y0 = ride): void => { if (z1 - z0 > 0.04) box(S, slot, x0, y0, z0, x1, belt, z1); };
    if (right) { piece(P.fenderFR, wf.z1, m.fd0); piece(P.paint, m.fd1, front - 0.06); piece(P.doorR, m.cd1, wf.z0); piece(P.paint, wr.z1, m.cd0); }
    else { piece(P.fenderFL, wf.z1, front - 0.06); piece(P.doorL, wr.z1, wf.z0); }
    piece(right ? P.quarterR : P.quarterL, back + 0.04, wr.z0);
    for (const w of [wf, wr]) piece(P.paint, w.z0, w.z1, wellTop);
    // The sill under the glass, and the wheel arches' rubber.
    box(S, P.dark, s * (hw + 0.006), belt - 0.02, back + 0.2, s * (hw - 0.1), belt + 0.03, front - 0.08);
    for (const z of sv.axles) arch(S, P.dark, s * (hw + 0.004), z, R, 0.1, 0.03);
    // Livery bands: the skirt, and a stripe under the glass (metro), a gold line (heritage).
    const gaps: Array<[number, number]> = [[wf.z0, wf.z1], [wr.z0, wr.z1], ...(right ? [[m.fd0, m.fd1], [m.cd0, m.cd1]] as Array<[number, number]> : [])];
    const band = (slot: number, y0: number, y1: number): void => { for (const [z0, z1] of spans(back + 0.04, front - 0.06, gaps)) box(S, slot, s * (hw + 0.008), y0, z0, s * (hw - 0.02), y1, z1); };
    if (sv.livery === "metro") { band(P.alt, ride, ride + 0.28); band(P.accent, 1.06, 1.12); }
    else if (sv.livery === "heritage") { band(P.dark, ride, ride + 0.2); band(P.accent, belt - 0.1, belt - 0.05); }
    else band(P.dark, ride, ride + 0.24);
    // The glass band, one pane each side -- the kerb side's broken by its doors -- and black mullions over it.
    const glassGaps: Array<[number, number]> = right ? [[m.fd0 - 0.04, m.fd1 + 0.04], [m.cd0 - 0.04, m.cd1 + 0.04]] : [];
    for (const [z0, z1] of spans(back + 0.35, front - 0.1, glassGaps)) box(S, P.glass, s * (hw - 0.035), belt + 0.02, z0, s * (hw - 0.01), winTop - 0.02, z1);
    const step = (front - 0.3 - (back + 0.4)) / 8;
    for (let k = 0; k <= 8; k += 1) {
      const z = back + 0.4 + k * step;
      if (glassGaps.some(([a, b]) => z > a - 0.1 && z < b + 0.1)) continue;
      box(S, P.dark, s * (hw - 0.012), belt, z - 0.045, s * (hw + 0.004), winTop, z + 0.045);
    }
  });
  // The kerb side's doors: glazed leaves in black frames, the stairwell behind.
  for (const [z0, z1] of [[m.fd0, m.fd1], [m.cd0, m.cd1]] as const) {
    box(S, P.glass, hw - 0.03, m.floor, z0, hw - 0.005, winTop, z1);
    for (const z of [z0 + 0.03, (z0 + z1) / 2, z1 - 0.03]) box(S, P.dark, hw - 0.03, m.floor, z - 0.03, hw + 0.006, winTop, z + 0.03);
    for (const y of [m.floor + 0.03, belt - 0.08, winTop - 0.03]) box(S, P.dark, hw - 0.03, y - 0.03, z0, hw + 0.006, y + 0.03, z1);
    box(S, P.dark, hw - 0.068, m.floor - 0.1, z0, hw - 0.04, belt, z1);
  }

  // ---- the front: a bumper and the mask under a tall screen, the lit sign over it, mirrors on long arms.
  component(S, "frontShield", () => {
    box(S, P.bumperF, -hw, ride, front - 0.12, hw, ride + 0.3, L2 + 0.03);
    box(S, P.dark, -(hw + 0.005), ride + 0.12, front, hw + 0.005, ride + 0.18, L2 + 0.045);
  });
  box(S, P.hood, -(hw - 0.02), ride + 0.28, front - 0.1, hw - 0.02, 0.95, front);
  both((s) => box(S, P.light, s * 0.8, 0.62, front - 0.01, s * 1.12, 0.76, front + 0.02));
  box(S, P.screen, -(hw - 0.09), 0.95, front - 0.09, hw - 0.09, winTop + 0.08, front - 0.03);
  both((s) => cap(S, P.dark, [s * (hw - 0.05), 0.95, front - 0.06], [s * (hw - 0.05), roof - 0.1, front - 0.06], 0.05));
  box(S, upper, -(hw - 0.02), winTop + 0.08, front - 0.12, hw - 0.02, roof - 0.02, front - 0.01);
  box(S, P.dark, -1.02, winTop + 0.13, front - 0.02, 1.02, roof - 0.09, front + 0.004);
  box(S, P.neon, -0.96, winTop + 0.16, front - 0.01, 0.96, roof - 0.12, front + 0.012);
  box(S, P.dark, -(hw - 0.12), 0.9, front - 0.55, hw - 0.12, 1.1, front - 0.1);
  driver(S, -0.72, 1.0, front - 1.1);
  both((s) => {
    cap(S, P.dark, [s * (hw - 0.08), roof - 0.12, front - 0.06], [s * (hw + 0.12), roof - 0.32, front + 0.32], 0.025);
    cap(S, P.dark, [s * (hw + 0.12), roof - 0.32, front + 0.32], [s * (hw + 0.14), 2.0, front + 0.4], 0.022);
    box(S, P.dark, s * (hw + 0.05), 1.62, front + 0.36, s * (hw + 0.24), 2.0, front + 0.44);
    box(S, P.metal, s * (hw + 0.06), 1.65, front + 0.35, s * (hw + 0.23), 1.97, front + 0.362);
  });
  if (m.bike) {
    both((s) => cap(S, P.metal, [s * 0.55, ride + 0.1, front + 0.05], [s * 0.55, ride + 0.44, front + 0.3], 0.022));
    cap(S, P.metal, [-0.8, ride + 0.44, front + 0.3], [0.8, ride + 0.44, front + 0.3], 0.022);
    cap(S, P.metal, [-0.8, ride + 0.2, front + 0.18], [0.8, ride + 0.2, front + 0.18], 0.018);
  }

  // ---- the back: the engine door, its louvres, the lamps, the rear window with the route lit in it.
  box(S, P.trunk, -(hw - 0.12), ride + 0.32, back - 0.02, hw - 0.12, 1.34, back + 0.04);
  component(S, "radiator", () => {
    box(S, P.grille, -0.6, 0.75, back - 0.035, 0.6, 1.2, back - 0.015);
    box(S, P.grille, -(hw + 0.006), 0.6, back + 0.25, -(hw - 0.01), 1.05, back + 1.1);
  });
  engineBlock(S, car);
  box(S, P.bumperR, -hw, ride, back - 0.06, hw, ride + 0.3, back + 0.08);
  both((s) => { box(S, P.tail, s * 0.9, 0.55, back - 0.03, s * 1.2, 1.3, back + 0.02); box(S, P.reflector, s * 0.4, ride + 0.2, back - 0.075, s * 0.55, ride + 0.26, back - 0.05); });
  box(S, P.glass, -(hw - 0.15), 1.5, back - 0.01, hw - 0.15, winTop, back + 0.05);
  // (The rear sign turned half round: its face reads from behind as the front one does from ahead.)
  S.boxes.push({ c: [0, winTop - 0.155, back - 0.001], h: [0.35, 0.095, 0.011], mat: P.neon, yaw: Math.PI });
  component(S, "exhaust", () => { for (const t of serviceExhaust(car)) cap(S, P.metal, [t.x, t.y + 0.04, t.z + 0.5], [t.x, t.y, t.z], t.r); });
  both((s) => box(S, P.dark, s * (hw - 0.68), ride - 0.12, wr.z0 - 0.06, s * (hw - 0.04), ride + 0.3, wr.z0 - 0.03));

  // ---- the roof: an air-conditioning pod, and what the bus runs on -- a diesel's engine tower at the back, a hybrid's
  // battery pod, the long gas tank fairing of a CNG bus.
  const pod = (z0: number, z1: number, h: number, half: number): void => {
    box(S, roofSlot, -half, roof - 0.02, z0 + 0.25, half, roof + h, z1 - 0.25);
    wedge(S, roofSlot, -half, roof - 0.02, z1 - 0.25, half, roof + h, z1, 0.05, "front");
    wedge(S, roofSlot, -half, roof - 0.02, z0, half, roof + h, z0 + 0.25, 0.05, "rear");
  };
  const ac = sv.form === "diesel" ? [back + 0.7, back + 2.5] : [g.frontAxle - 1.9, g.frontAxle - 0.1];
  pod(ac[0]!, ac[1]!, 0.26, 0.95);
  box(S, P.grille, -0.7, roof + 0.25, ac[0]! + 0.35, 0.7, roof + 0.28, ac[1]! - 0.35);
  if (sv.form === "diesel") { box(S, P.paint, -(hw - 0.02), roof - 0.07, back + 0.04, -(hw - 0.62), roof + 0.34, back + 0.62); box(S, P.grille, -(hw - 0.05), roof + 0.05, back + 0.02, -(hw - 0.6), roof + 0.3, back + 0.05); }
  else if (sv.form === "hybrid") pod(g.rearAxle - 0.2, ac[0]! - 0.3, 0.3, 0.85);
  else pod(g.rearAxle - 0.6, ac[0]! - 0.3, 0.38, 1.0);
  for (const z of [g.rearAxle + 0.6, g.frontAxle - 2.6]) box(S, P.dark, -0.4, roof - 0.01, z - 0.35, 0.4, roof + 0.03, z + 0.35);
  return S;
}

function fireSolids(car: Car): Solids {
  const S = solids(), g = car.body, sv = car.parts.service!, m = sv.m as FireM, aerial = sv.form === "aerial";
  const L2 = g.length / 2, hw = g.width / 2, R = car.wheels[0].radius, { belt } = g, face = m.face, cabRear = g.cabRear, top = m.top;
  const wells = sv.axles.map((z) => ({ z0: z - R - 0.12, z1: z + R + 0.12 })), wf = wells[0]!, wellTop = 2 * R + 0.12;
  const wr = { z0: Math.min(...wells.slice(1).map((w) => w.z0)), z1: Math.max(...wells.slice(1).map((w) => w.z1)) };
  const beacon = (i: number): BeaconLamp => sv.beacons[i]!;

  // ---- the chassis.
  both((s) => box(S, P.dark, s * 0.38, 0.72, -L2 + 0.15, s * 0.5, 1.0, face - 0.1));
  box(S, P.dark, -0.38, 0.72, -L2 + 0.15, 0.38, 0.76, face - 0.1);
  engineBlock(S, car);

  // ---- the front: a chrome bumper deck with a siren and horns, the cab's face, its grille, lamps and warning lights.
  component(S, "frontShield", () => {
    box(S, P.metal, -(hw + 0.03), 0.5, face, hw + 0.03, 0.84, L2);
    box(S, P.dark, -(hw - 0.25), 0.84, face + 0.06, hw - 0.25, 0.86, L2 - 0.06);
    cap(S, P.metal, [0.62, 0.97, L2 - 0.24], [0.62, 0.97, L2 - 0.05], 0.13);
    for (const [x, r] of [[-0.55, 0.07], [-0.75, 0.06]] as const) cap(S, P.metal, [x, 0.93, L2 - 0.32], [x, 0.93, L2 - 0.02], r);
  });
  box(S, P.hood, -(hw - 0.03), 0.84, face - 0.05, hw - 0.03, 1.62, face);
  component(S, "radiator", () => {
    box(S, P.grille, -0.56, 0.9, face - 0.01, 0.56, 1.52, face + 0.025);
    for (let i = 1; i <= 4; i += 1) { const y = 0.9 + (0.62 * i) / 5; box(S, P.metal, -0.58, y - 0.015, face + 0.015, 0.58, y + 0.015, face + 0.04); }
  });
  both((s) => {
    box(S, P.metal, s * 0.68, 0.88, face - 0.005, s * 1.16, 1.34, face + 0.015);
    box(S, P.light, s * 0.72, 0.92, face, s * 1.12, 1.08, face + 0.03);
  });
  lens(S, beacon(4), 0.2, 0.07, 0.02); lens(S, beacon(5), 0.2, 0.07, 0.02);
  box(S, P.screen, -(hw - 0.1), 1.62, face - 0.09, hw - 0.1, m.cabRoof - 0.14, face - 0.03);
  cap(S, P.dark, [0, 1.62, face - 0.04], [0, m.cabRoof - 0.14, face - 0.04], 0.03);
  box(S, P.paint, -(hw - 0.03), m.cabRoof - 0.14, face - 0.1, hw - 0.03, m.cabRoof - 0.03, face);

  // ---- the cab: its lower body, a front door over the wheel, a crew door behind, their glass and pillars; the roof
  // (a crew roof raised over the back, or not) and the light bar on it; inside, a driver in a helmet.
  box(S, P.paint, -(hw - 0.42), 0.62, cabRear, hw - 0.42, belt, face - 0.05);
  both((s) => {
    const x0 = s * hw, x1 = s * (hw - 0.42), right = s > 0;
    box(S, right ? P.doorR : P.doorL, x0, wellTop, face - 1.5, s * (hw - 0.06), belt, face - 0.55);
    box(S, P.paint, s * (hw - 0.06), wellTop, face - 1.5, x1, belt, face - 0.55);
    box(S, right ? P.fenderFR : P.fenderFL, x0, 0.84, face - 0.55, x1, belt, face - 0.05);
    box(S, right ? P.fenderFR : P.fenderFL, x0, wellTop, wf.z0, x1, belt, face - 1.5);
    box(S, P.paint, x0, 0.62, cabRear, x1, belt, wf.z0 - 0.05);
    box(S, P.dark, s * (hw - 0.44), 0.62, wf.z0, s * (hw - 0.4), wellTop, wf.z1);
    for (const y of [0.52, 0.88]) box(S, P.metal, s * (hw - 0.3), y, cabRear + 0.1, s * (hw + 0.02), y + 0.05, wf.z0 - 0.1);
    const roofAt = (z: number): number => (z < m.roofStep ? m.crewRoof : m.cabRoof);
    box(S, P.glass, s * (hw - 0.035), belt, face - 1.42, s * (hw - 0.01), m.cabRoof - 0.16, face - 0.66);
    box(S, P.glass, s * (hw - 0.035), belt, cabRear + 0.16, s * (hw - 0.01), roofAt(cabRear + 0.2) - 0.16, wf.z0 - 0.12);
    box(S, P.paint, s * (hw - 0.05), belt, face - 0.66, x0, m.cabRoof - 0.06, face - 0.05);
    box(S, P.paint, s * (hw - 0.05), belt, wf.z0 - 0.12, x0, roofAt(face - 1.45) - 0.06, face - 1.42);
    box(S, P.paint, s * (hw - 0.05), belt, cabRear, x0, roofAt(cabRear) - 0.06, cabRear + 0.16);
    for (const z of [face - 1.47, cabRear + 0.06]) cap(S, P.metal, [s * (hw + 0.04), 1.25, z], [s * (hw + 0.04), 2.35, z], 0.022);
    cap(S, P.metal, [x0, belt + 0.1, face - 0.7], [s * (hw + 0.22), belt + 0.1, face - 0.62], 0.02);
    box(S, P.dark, s * (hw + 0.18), belt - 0.1, face - 0.7, s * (hw + 0.26), belt + 0.52, face - 0.6);
    // A reflective stripe along the cab, and on round the body under its lockers.
    box(S, P.accent, s * (hw + 0.008), 0.98, face - 0.55, s * (hw - 0.02), 1.08, face - 0.05);
    box(S, P.accent, s * (hw + 0.008), 0.98, cabRear, s * (hw - 0.02), 1.08, wf.z0 - 0.05);
  });
  // (Behind the glass: the crew's dark cabin, the cockpit's floor, the dash, the driver.)
  box(S, P.interior, -(hw - 0.14), belt - 0.05, cabRear + 0.05, hw - 0.14, m.crewRoof - 0.1, face - 1.25);
  box(S, P.dark, -(hw - 0.08), belt - 0.08, face - 1.3, hw - 0.08, belt - 0.02, face - 0.1);
  box(S, P.dark, -(hw - 0.14), belt - 0.05, face - 0.45, hw - 0.14, belt + 0.18, face - 0.12);
  driver(S, -0.55, belt, face - 1.05);
  box(S, P.paint, -(hw - 0.03), belt, cabRear, hw - 0.03, m.crewRoof - 0.06, cabRear + 0.05);
  box(S, P.roof, -(hw - 0.03), m.cabRoof - 0.06, m.roofStep, hw - 0.03, m.cabRoof, face - 0.05);
  if (m.crewRoof > m.cabRoof) {
    box(S, P.roof, -(hw - 0.03), m.crewRoof - 0.06, cabRear, hw - 0.03, m.crewRoof, m.roofStep + 0.02);
    box(S, P.paint, -(hw - 0.03), m.cabRoof - 0.06, m.roofStep, hw - 0.03, m.crewRoof - 0.06, m.roofStep + 0.08);
  }
  component(S, "lightbar", () => {
    box(S, P.dark, -1.05, m.cabRoof, face - 0.5, 1.05, m.cabRoof + 0.05, face - 0.2);
    for (let i = 0; i < 4; i += 1) lens(S, beacon(i), 0.25, 0.055, 0.13);
  });

  // ---- the pump panel between the cab and the body: brushed metal, gauges, the discharges' coloured caps.
  box(S, P.paint, -(hw - 0.06), 0.62, m.bodyFront, hw - 0.06, top, cabRear);
  both((s) => {
    box(S, P.metal, s * (hw - 0.06), 0.72, m.bodyFront + 0.02, s * (hw - 0.01), top - 0.04, cabRear - 0.02);
    for (const z of [m.bodyFront + 0.2, cabRear - 0.2]) cap(S, P.alt, [s * (hw - 0.02), 1.9, z], [s * (hw + 0.01), 1.9, z], 0.07);
    for (const z of [m.bodyFront + 0.18, (m.bodyFront + cabRear) / 2, cabRear - 0.18]) cap(S, P.accent, [s * (hw - 0.02), 1.12, z], [s * (hw + 0.08), 1.12, z], 0.06);
    box(S, P.light, s * (hw - 0.02), top - 0.08, m.bodyFront + 0.1, s * (hw + 0.03), top - 0.02, cabRear - 0.1);
    box(S, P.metal, s * (hw - 0.3), 0.5, m.bodyFront, s * (hw + 0.02), 0.56, cabRear);
  });

  // ---- the body: lockers down both sides behind roller doors (over the wheels and either side of them), a rub rail,
  // the rear with its chevrons, lamps, beacons and a step.
  box(S, P.paint, -(hw - 0.07), wellTop, m.bodyRear, hw - 0.07, top, m.bodyFront);
  box(S, P.paint, -0.58, 0.62, m.bodyRear, 0.58, wellTop, m.bodyFront);
  both((s) => {
    const right = s > 0;
    box(S, right ? P.quarterR : P.quarterL, s * (hw - 0.07), wellTop, m.bodyRear, s * hw, top, m.bodyFront);
    for (const [z0, z1] of [[wr.z1, m.bodyFront], [m.bodyRear, wr.z0]] as const) box(S, P.paint, s * hw, 0.62, z0, s * 0.58, wellTop, z1);
    const doors = aerial ? 2 : 3, run = (m.bodyFront - m.bodyRear - 0.1) / doors;
    const door = (z0: number, z1: number, y0: number, y1: number): void => {
      if (z1 - z0 < 0.3) return;
      box(S, P.metal, s * hw, y0, z0, s * (hw + 0.015), y1, z1);
      box(S, P.trim, s * (hw + 0.012), y0 + 0.02, z0 + 0.04, s * (hw + 0.03), y0 + 0.07, z1 - 0.04);
    };
    for (let k = 0; k < doors; k += 1) door(m.bodyRear + 0.05 + k * run + 0.04, m.bodyRear + 0.05 + (k + 1) * run - 0.04, wellTop + 0.08, top - 0.08);
    door(wr.z1 + 0.06, m.bodyFront - 0.06, 0.7, wellTop - 0.04);
    door(m.bodyRear + 0.06, wr.z0 - 0.06, 0.7, wellTop - 0.04);
    for (const [z0, z1] of [[wr.z1, m.bodyFront], [m.bodyRear, wr.z0]] as const) box(S, P.metal, s * hw, 0.62, z0, s * (hw + 0.03), 0.68, z1);
    box(S, P.accent, s * (hw + 0.006), wellTop, m.bodyRear, s * (hw - 0.02), wellTop + 0.06, m.bodyFront);
    for (const w of wells) arch(S, P.metal, s * (hw + 0.01), (w.z0 + w.z1) / 2, R, 0.1, 0.03);
    box(S, P.dark, s * (hw - 0.7), 0.62, wr.z0, s * (hw - 0.66), wellTop, wr.z1);
    box(S, P.dark, s * (hw - 0.66), wellTop - 0.03, wr.z0, s * (hw - 0.07), wellTop, wr.z1);
    box(S, P.dark, s * (hw - 0.66), 0.2, wr.z0 - 0.08, s * (hw - 0.04), 0.62, wr.z0 - 0.05);
    for (const z of [m.bodyRear + 0.1, m.bodyFront - 0.4]) box(S, P.light, s * hw, top - 0.22, z, s * (hw + 0.02), top - 0.1, z + 0.3);
    cap(S, P.metal, [s * (hw - 0.04), top + 0.1, m.bodyRear + 0.2], [s * (hw - 0.04), top + 0.1, m.bodyFront - 0.2], 0.02);
    cap(S, P.metal, [s * (hw - 0.12), 1.0, m.bodyRear - 0.04], [s * (hw - 0.12), 2.0, m.bodyRear - 0.04], 0.022);
  });
  lens(S, beacon(8), 0.02, 0.07, 0.16); lens(S, beacon(9), 0.02, 0.07, 0.16);
  box(S, P.trunk, -(hw - 0.07), 0.62, m.bodyRear - 0.03, hw - 0.07, top, m.bodyRear);
  both((s) => { for (const y of [0.84, 0.98, 1.12]) cap(S, P.tail, [s * 0.86, y, m.bodyRear - 0.01], [s * 0.86, y, m.bodyRear - 0.05], 0.06); });
  lens(S, beacon(6), 0.12, 0.09, 0.03); lens(S, beacon(7), 0.12, 0.09, 0.03);
  box(S, P.metal, -(hw - 0.05), 0.5, -L2, hw - 0.05, 0.58, m.bodyRear);
  component(S, "exhaust", () => { for (const t of serviceExhaust(car)) cap(S, P.metal, [0.5, t.y, t.z], [t.x, t.y, t.z], t.r); });

  if (!aerial) {
    // A pumper: the hose bed at the back of the top, a deck gun over the pump, two ladders racked along the top.
    const hz = m.bodyRear + 2.3;
    component(S, "hosebed", () => {
      both((s) => box(S, P.paint, s * (hw - 0.1), top, m.bodyRear, s * hw, top + 0.26, hz));
      box(S, P.dark, -(hw - 0.1), top, m.bodyRear, hw - 0.1, top + 0.03, hz);
      for (let i = 0; i < 3; i += 1) { const x = -(hw - 0.18) + ((2 * hw - 0.36) * (i + 0.5)) / 3; box(S, P.alt, x - 0.32, top + 0.03, m.bodyRear + 0.05, x + 0.32, top + 0.2, hz - 0.05); }
    });
    const pz = (m.bodyFront + cabRear) / 2;
    cap(S, P.metal, [0, top, pz], [0, top + 0.3, pz], 0.08);
    cap(S, P.dark, [0, top + 0.3, pz], [0, top + 0.44, pz + 0.45], 0.05);
    component(S, "ladders", () => {
      for (const [x0, x1, y, z0, z1] of [[0.2, 0.72, top + 0.34, m.bodyRear + 0.25, m.bodyFront - 0.15], [-0.72, -0.2, top + 0.3, m.bodyRear + 1.0, m.bodyFront - 0.15]] as const) {
        for (const x of [x0, x1 - 0.05]) box(S, P.metal, x, y, z0, x + 0.05, y + 0.07, z1);
        for (let z = z0 + 0.15; z < z1 - 0.1; z += 0.34) box(S, P.metal, x0 + 0.05, y + 0.02, z - 0.02, x1 - 0.05, y + 0.05, z + 0.02);
      }
      for (const z of [m.bodyRear + 0.3, m.bodyFront - 0.3]) box(S, P.dark, -0.8, top, z - 0.04, 0.8, top + 0.3, z + 0.04);
    });
  } else {
    // An aerial: a turntable over the tandem, the ladder's three sections nested along the top and out over the cab,
    // resting on a cradle behind the cab; outrigger feet stowed under the body.
    const tt = m.tt, ly = m.ly;
    component(S, "aerial", () => {
      box(S, P.dark, -0.85, top, tt - 0.85, 0.85, top + 0.1, tt + 0.85);
      box(S, P.metal, -0.7, top + 0.1, tt - 0.7, 0.7, top + 0.18, tt + 0.7);
      box(S, P.paint, -0.45, top + 0.18, tt - 0.45, 0.45, ly, tt + 0.35);
      box(S, P.metal, 0.5, top + 0.18, tt - 0.35, 0.8, top + 0.9, tt - 0.05);
      const sections = [[0.46, tt - 0.35, cabRear + 0.2, 0.32], [0.4, tt + 0.3, face - 0.4, 0.28], [0.34, tt + 0.9, L2 + 0.3, 0.24]] as const;
      sections.forEach(([w, z0, z1, h], i) => { for (const s of [-1, 1]) box(S, P.metal, s * w - 0.025, ly + 0.03 * i, z0, s * w + 0.025, ly + 0.03 * i + h, z1); });
      const [fw, f0, f1] = sections[2];
      for (let z = f0 + 0.2; z < f1; z += 0.45) box(S, P.metal, -fw, ly + 0.06, z - 0.02, fw, ly + 0.09, z + 0.02);
      box(S, P.light, -fw, ly + 0.1, f1 - 0.04, -fw + 0.08, ly + 0.18, f1); box(S, P.light, fw - 0.08, ly + 0.1, f1 - 0.04, fw, ly + 0.18, f1);
      box(S, P.dark, -0.5, m.crewRoof, cabRear + 0.1, 0.5, ly, cabRear + 0.3);
    });
    both((s) => { for (const z of [m.bodyFront - 0.25, m.bodyRear + 0.25]) box(S, P.dark, s * (hw - 0.1), 0.34, z - 0.14, s * (hw + 0.05), 0.62, z + 0.14); });
  }
  return S;
}

function ambulanceSolids(car: Car): Solids {
  const S = solids(), g = car.body, sv = car.parts.service!, m = sv.m as AmbM;
  const L2 = g.length / 2, hw = m.boxHw, cw = m.cabHw, R = car.wheels[0].radius, { ride, belt } = g, boxTop = g.roof;
  const nose = m.nose, cowl = m.cowl, st = m.screenTop, bf = m.boxFront, br = m.boxRear, bb = m.boxBottom;
  const wf = { z0: g.frontAxle - R - 0.1, z1: g.frontAxle + R + 0.1, top: 2 * R + 0.1 }, wr = { z0: g.rearAxle - R - 0.12, z1: g.rearAxle + R + 0.12 };
  const hoodAt = (z: number): number => 1.02 + (0.2 * (nose - z)) / (nose - cowl);
  const beacon = (i: number): BeaconLamp => sv.beacons[i]!;

  // ---- the chassis, and the van's front: bumper, grille, lamps, warning lights, the bonnet between its wings.
  both((s) => box(S, P.dark, s * 0.38, 0.5, -L2 + 0.2, s * 0.46, 0.72, nose - 0.1));
  component(S, "frontShield", () => box(S, P.dark, -(cw + 0.02), 0.42, nose - 0.02, cw + 0.02, 0.66, L2));
  component(S, "radiator", () => {
    box(S, P.grille, -0.62, 0.66, nose - 0.03, 0.62, 0.98, nose + 0.02);
    for (const y of [0.76, 0.88]) box(S, P.metal, -0.64, y - 0.012, nose + 0.01, 0.64, y + 0.012, nose + 0.035);
  });
  engineBlock(S, car);
  both((s) => box(S, P.light, s * 0.66, 0.7, nose - 0.02, s * 0.95, 0.9, nose + 0.03));
  lens(S, beacon(2), 0.09, 0.04, 0.02); lens(S, beacon(3), 0.09, 0.04, 0.02);
  wedge(S, P.hood, -(cw - 0.28), 0.66, cowl, cw - 0.28, hoodAt(cowl), nose, (hoodAt(nose) - 0.66) / (hoodAt(cowl) - 0.66), "front");
  both((s) => {
    const slot = s > 0 ? P.fenderFR : P.fenderFL, x0 = s * cw, x1 = s * (cw - 0.28);
    wedge(S, slot, x0, 0.5, wf.z1, x1, hoodAt(wf.z1), nose, (hoodAt(nose) - 0.5) / (hoodAt(wf.z1) - 0.5), "front");
    wedge(S, slot, x0, wf.top, wf.z0, x1, hoodAt(wf.z0), wf.z1, (hoodAt(wf.z1) - wf.top) / (hoodAt(wf.z0) - wf.top), "front");
    box(S, slot, x0, 0.5, cowl, x1, hoodAt(wf.z0), wf.z0);
    arch(S, P.dark, s * (cw + 0.004), g.frontAxle, R, 0.08, 0.025);
    box(S, P.dark, s * (cw - 0.3), 0.4, wf.z0, s * (cw - 0.26), wf.top, wf.z1);
  });

  // ---- the cab: its doors, their glass under a raked screen, the roof and the light bar on it, a driver inside.
  box(S, P.paint, -(cw - 0.06), 0.5, bf, cw - 0.06, belt, cowl);
  both((s) => {
    box(S, s > 0 ? P.doorR : P.doorL, s * cw, ride + 0.12, bf + 0.05, s * (cw - 0.06), belt, cowl);
    box(S, P.dark, s * (cw - 0.2), 0.45, bf + 0.1, s * (cw + 0.02), 0.52, cowl - 0.1);
    box(S, P.glass, s * (cw - 0.03), belt, bf + 0.08, s * (cw - 0.005), m.cabRoof - 0.08, st + 0.05);
    box(S, P.glass, s * (cw - 0.03), belt, st + 0.05, s * (cw - 0.005), belt + 0.35, cowl - 0.15);
    cap(S, P.paint, [s * (cw - 0.03), belt, cowl], [s * (cw - 0.05), m.cabRoof - 0.05, st], 0.045);
    cap(S, P.dark, [s * cw, belt + 0.12, cowl - 0.1], [s * (cw + 0.2), belt + 0.16, cowl - 0.05], 0.02);
    box(S, P.dark, s * (cw + 0.16), belt + 0.02, cowl - 0.12, s * (cw + 0.24), belt + 0.4, cowl - 0.02);
  });
  pane(S, P.screen, { name: "screen", corners: [[-(cw - 0.08), 1.2, cowl], [cw - 0.08, 1.2, cowl], [cw - 0.08, m.cabRoof - 0.04, st], [-(cw - 0.08), m.cabRoof - 0.04, st]], thickness: 0.012 });
  box(S, P.roof, -(cw - 0.02), m.cabRoof - 0.06, bf, cw - 0.02, m.cabRoof, st + 0.04);
  box(S, P.dark, -(cw - 0.08), belt - 0.06, bf, cw - 0.08, belt, cowl - 0.1);
  box(S, P.dark, -(cw - 0.1), belt - 0.05, cowl - 0.45, cw - 0.1, belt + 0.14, cowl - 0.12);
  driver(S, -0.45, belt, cowl - 0.85);
  component(S, "lightbar", () => {
    const z = beacon(0).z;
    box(S, P.dark, -0.78, m.cabRoof, z - 0.14, 0.78, m.cabRoof + 0.05, z + 0.14);
    lens(S, beacon(0), 0.36, 0.05, 0.12); lens(S, beacon(1), 0.36, 0.05, 0.12);
  });

  // ---- the box: its core and sides, a roof, corner posts, the stripe (and a pin-stripe over it), the kerb-side door,
  // lockers on the other side, scene lights, beacons at its corners, markers, the lit rear doors and the step.
  box(S, P.paint, -(hw - 0.04), bb, br, hw - 0.04, boxTop - 0.05, bf);
  box(S, P.roof, -(hw - 0.02), boxTop - 0.05, br, hw - 0.02, boxTop, bf);
  both((s) => {
    const right = s > 0;
    // (The kerb side's panel stops at its door, so what's written on it sits clear of the door.)
    box(S, right ? P.quarterR : P.quarterL, s * (hw - 0.04), bb, br, s * hw, boxTop - 0.02, right ? bf - SIDE_DOOR : bf);
    if (right) box(S, P.paint, hw - 0.04, bb, bf - SIDE_DOOR, hw, boxTop - 0.02, bf);
    for (const z of [br, bf]) cap(S, P.metal, [s * (hw - 0.01), bb, z], [s * (hw - 0.01), boxTop - 0.01, z], 0.03);
    cap(S, P.metal, [s * (hw - 0.01), boxTop - 0.01, br], [s * (hw - 0.01), boxTop - 0.01, bf], 0.03);
    for (const [z0, z1] of [[wr.z1, bf - 0.02], [br + 0.02, wr.z0]] as const) box(S, P.paint, s * hw, 0.56, z0, s * (hw - 0.55), bb, z1);
    box(S, P.dark, s * (hw - 0.62), 0.4, wr.z0, s * (hw - 0.58), bb, wr.z1);
    arch(S, P.dark, s * (hw + 0.004), g.rearAxle, car.wheels[1].radius, 0.08, 0.025);
    box(S, P.dark, s * (hw - 0.55), 0.18, wr.z0 - 0.08, s * (hw - 0.04), 0.56, wr.z0 - 0.05);
    box(S, P.alt, s * (hw + 0.014), 1.12, br, s * (hw - 0.02), 1.4, bf);
    box(S, P.alt, s * (cw + 0.01), 1.0, bf, s * (cw - 0.02), 1.18, cowl + 0.3);
    if (m.twin) box(S, P.accent, s * (hw + 0.014), 1.46, br, s * (hw - 0.02), 1.5, bf);
    if (right) {
      const z0 = bf - 0.9, z1 = bf - 0.08;
      for (const [a, b] of [[z0, z0 + 0.03], [z1 - 0.03, z1]] as const) box(S, P.dark, hw - 0.01, 0.95, a, hw + 0.02, 2.45, b);
      box(S, P.dark, hw - 0.01, 2.42, z0, hw + 0.02, 2.45, z1);
      box(S, P.light, hw - 0.01, 1.72, z0 + 0.1, hw + 0.008, 2.28, z1 - 0.1);
      box(S, P.glass, hw + 0.008, 1.72, z0 + 0.1, hw + 0.016, 2.28, z1 - 0.1);
      box(S, P.metal, hw, 1.55, z1 - 0.2, hw + 0.03, 1.6, z1 - 0.1);
    } else for (const [z0, z1] of [[br + 0.15, wr.z0 - 0.1], [wr.z1 + 0.1, bf - 0.2]] as const) {
      // (Lockers down the other side: their doors' seams and handles, so the lettering reads across them.)
      for (const [a, b] of [[z0, z0 + 0.025], [z1 - 0.025, z1]] as const) box(S, P.dark, -hw, bb + 0.1, a, -(hw + 0.008), 2.3, b);
      for (const y of [bb + 0.1, 2.28]) box(S, P.dark, -hw, y, z0, -(hw + 0.008), y + 0.02, z1);
      box(S, P.metal, -(hw + 0.008), 1.6, z1 - 0.2, -(hw + 0.03), 1.64, z1 - 0.08);
    }
    for (const z of [bf - 0.5, br + 0.25]) box(S, P.light, s * hw, boxTop - 0.3, z, s * (hw + 0.02), boxTop - 0.18, z + 0.25);
  });
  for (let i = 4; i < 8; i += 1) lens(S, beacon(i), 0.13, 0.09, 0.03);
  for (const x of [-0.25, 0, 0.25]) { cap(S, P.tail, [x, boxTop - 0.12, br - 0.01], [x, boxTop - 0.12, br - 0.04], 0.03); cap(S, P.light, [x, boxTop - 0.12, bf + 0.01], [x, boxTop - 0.12, bf + 0.04], 0.03); }
  box(S, P.trunk, -0.78, 0.95, br - 0.025, 0.78, boxTop - 0.28, br);
  both((s) => {
    box(S, P.light, s * 0.1, 1.75, br - 0.032, s * 0.66, boxTop - 0.45, br - 0.024);
    box(S, P.glass, s * 0.1, 1.75, br - 0.04, s * 0.66, boxTop - 0.45, br - 0.032);
    box(S, P.dark, s * 0.8, 0.9, br - 0.02, s * 1.12, 1.4, br + 0.01);
    box(S, P.tail, s * 0.84, 0.95, br - 0.03, s * 1.08, 1.35, br - 0.01);
    cap(S, P.metal, [s * 0.74, 1.2, br - 0.06], [s * 0.74, 2.2, br - 0.06], 0.02);
  });
  box(S, P.dark, -0.012, 0.95, br - 0.03, 0.012, boxTop - 0.28, br - 0.02);
  box(S, P.metal, -(hw - 0.1), 0.5, -L2, hw - 0.1, 0.62, br);
  component(S, "exhaust", () => { for (const t of serviceExhaust(car)) cap(S, P.metal, [t.x, t.y, t.z + 0.6], [t.x, t.y, t.z], t.r); });
  return S;
}

function dumpSolids(car: Car): Solids {
  const S = solids(), g = car.body, sv = car.parts.service!, m = sv.m as DumpM;
  const L2 = g.length / 2, hw = g.width / 2, R = car.wheels[0].radius, { belt, roof } = g, face = m.face, cabRear = g.cabRear, cb = m.cabBottom;
  const wf = { z0: g.frontAxle - R - 0.12, z1: g.frontAxle + R + 0.12 };
  const d1 = sv.axles[1]!, d2 = sv.axles[2]!, bedSlot = m.bedAlt ? P.alt : P.paint;
  const { floor, sideTop, frontTop, z0, z1 } = m;
  const beacon = (i: number): BeaconLamp => sv.beacons[i]!;

  // ---- the chassis, the bumper and its lamps, the fuel tank and battery box, the exhaust out of the side.
  both((s) => box(S, P.dark, s * 0.38, 0.78, -L2 + 0.05, s * 0.48, 1.08, face - 0.1));
  component(S, "frontShield", () => {
    box(S, P.dark, -(hw + 0.02), 0.42, L2 - 0.22, hw + 0.02, 0.82, L2);
    box(S, P.metal, -0.7, 0.32, L2 - 0.35, 0.7, 0.42, L2 - 0.05);
  });
  both((s) => { cap(S, P.trim, [s * 0.85, 0.66, L2 - 0.02], [s * 0.85, 0.66, L2 + 0.005], 0.1); cap(S, P.light, [s * 0.85, 0.66, L2 - 0.01], [s * 0.85, 0.66, L2 + 0.02], 0.085); });
  engineBlock(S, car);
  cap(S, P.metal, [-(hw - 0.24), 0.72, cabRear - 0.3], [-(hw - 0.24), 0.72, cabRear - 1.05], 0.2);
  box(S, P.dark, hw - 0.55, 0.55, cabRear - 1.0, hw - 0.1, 1.0, cabRear - 0.05);
  component(S, "exhaust", () => { for (const t of serviceExhaust(car)) cap(S, P.metal, [0.5, t.y, t.z], [t.x, t.y, t.z], t.r); });

  // ---- the cab, over the front axle: its face and grille, doors with steps behind the wheel, glass, a visor, a
  // beacon bar on the roof, mirrors, a driver.
  box(S, P.paint, -(hw - 0.05), cb, cabRear, hw - 0.05, belt, face - 0.05);
  box(S, P.paint, -(hw - 0.05), belt, cabRear, hw - 0.05, roof - 0.06, cabRear + 0.05);
  box(S, P.hood, -(hw - 0.03), cb, face - 0.05, hw - 0.03, 1.85, face);
  component(S, "radiator", () => {
    box(S, P.grille, -0.75, 1.2, face - 0.01, 0.75, 1.7, face + 0.02);
    for (let i = 1; i <= 3; i += 1) { const y = 1.2 + (0.5 * i) / 4; box(S, P.metal, -0.77, y - 0.012, face + 0.01, 0.77, y + 0.012, face + 0.035); }
  });
  box(S, P.dark, -(hw - 0.1), 0.82, face - 0.25, hw - 0.1, cb, face - 0.05);
  box(S, P.screen, -(hw - 0.12), 1.85, face - 0.08, hw - 0.12, roof - 0.16, face - 0.02);
  box(S, P.paint, -(hw - 0.05), roof - 0.16, face - 0.1, hw - 0.05, roof - 0.06, face - 0.02);
  box(S, P.dark, -(hw - 0.1), roof - 0.1, face - 0.02, hw - 0.1, roof - 0.05, face + 0.18);
  box(S, P.roof, -(hw - 0.04), roof - 0.06, cabRear, hw - 0.04, roof, face - 0.06);
  box(S, P.interior, -(hw - 0.14), belt, cabRear + 0.05, hw - 0.14, roof - 0.08, face - 0.95);
  box(S, P.dark, -(hw - 0.14), belt - 0.05, face - 0.4, hw - 0.14, belt + 0.16, face - 0.1);
  driver(S, -0.55, belt - 0.1, face - 0.75);
  both((s) => {
    const right = s > 0, x0 = s * hw, x1 = s * (hw - 0.05);
    box(S, right ? P.doorR : P.doorL, x0, cb, face - 1.55, x1, belt, face - 0.28);
    box(S, P.paint, x0, cb, face - 0.28, x1, belt, face - 0.05);
    box(S, P.paint, x0, cb, cabRear, x1, belt, face - 1.55);
    box(S, P.glass, s * (hw - 0.035), belt, face - 1.45, s * (hw - 0.01), roof - 0.18, face - 0.36);
    box(S, P.paint, x1, belt, face - 0.36, x0, roof - 0.06, face - 0.05);
    box(S, P.paint, x1, belt, cabRear, x0, roof - 0.06, face - 1.45);
    for (const y of [0.55, 0.85]) box(S, P.metal, s * (hw - 0.35), y, wf.z0 - 0.32, x0, y + 0.05, wf.z0 - 0.04);
    arch(S, P.dark, s * (hw - 0.02), g.frontAxle, R, 0.06, 0.04);
    cap(S, P.dark, [x0, belt + 0.25, face - 0.25], [s * (hw + 0.25), belt + 0.3, face - 0.15], 0.022);
    box(S, P.dark, s * (hw + 0.2), belt - 0.15, face - 0.2, s * (hw + 0.3), belt + 0.45, face - 0.1);
  });
  component(S, "lightbar", () => {
    box(S, P.dark, -0.72, roof, face - 0.5, 0.72, roof + 0.05, face - 0.2);
    lens(S, beacon(0), 0.33, 0.05, 0.12); lens(S, beacon(1), 0.33, 0.05, 0.12);
  });

  // ---- the ram, between the cab and the bed: a three-stage cylinder from the frame up to the bed's front wall.
  const zr = snap(cabRear - 0.2, 0.01);
  component(S, "dumpRam", () => {
    box(S, P.dark, -0.2, 0.95, zr - 0.12, 0.2, 1.1, zr + 0.12);
    cap(S, P.dark, [0, 1.0, zr], [0, floor + 0.05, zr], 0.12);
    cap(S, P.metal, [0, floor + 0.05, zr], [0, floor + 0.3, zr], 0.09);
    cap(S, P.metal, [0, floor + 0.3, zr], [0, floor + 0.45, zr], 0.07);
  });

  // ---- the bed: floor, long members under it, ribbed sides (its rear quarters), a front wall rising to a lip over the
  // cab, a tailgate (its boot) hung from the top; and the hinge it tips about.
  component(S, "dumpBed", () => {
    box(S, P.dark, -(hw - 0.07), floor - 0.1, z0, hw - 0.07, floor, z1);
    both((s) => {
      const right = s > 0;
      box(S, P.dark, s * 0.35, floor - 0.26, z0, s * 0.5, floor - 0.1, z1);
      box(S, right ? P.quarterR : P.quarterL, s * (hw - 0.07), floor - 0.12, z0 - 0.06, s * hw, sideTop, z1 + 0.06);
      box(S, bedSlot, s * (hw - 0.1), sideTop, z0 - 0.06, s * (hw + 0.04), sideTop + 0.07, z1 + 0.07);
      box(S, bedSlot, s * (hw - 0.02), floor - 0.16, z0 - 0.06, s * (hw + 0.05), floor - 0.06, z1 + 0.06);
      for (let k = 1; k <= 4; k += 1) { const z = z0 + ((z1 - z0) * k) / 5; box(S, bedSlot, s * hw, floor - 0.1, z - 0.04, s * (hw + 0.05), sideTop - 0.02, z + 0.04); }
      wedge(S, bedSlot, s * (hw - 0.07), sideTop, z1 - 0.5, s * hw, frontTop, z1 + 0.07, 0.02, "rear");
    });
    box(S, bedSlot, -hw, floor - 0.12, z1, hw, frontTop, z1 + 0.07);
    box(S, bedSlot, -(hw - 0.05), frontTop - 0.07, z1, hw - 0.05, frontTop, m.lipZ);
    box(S, P.dark, -0.15, floor + 0.38, zr - 0.05, 0.15, floor + 0.55, z1 + 0.07);
    box(S, P.trunk, -(hw - 0.02), floor - 0.12, z0 - 0.08, hw - 0.02, sideTop + 0.02, z0);
    cap(S, P.dark, [-hw, sideTop + 0.03, z0 - 0.04], [hw, sideTop + 0.03, z0 - 0.04], 0.04);
    both((s) => box(S, P.dark, s * (hw - 0.2), floor - 0.1, z0 - 0.1, s * (hw - 0.05), floor + 0.05, z0 - 0.02));
  });
  box(S, P.dark, -0.5, 1.08, z0, 0.5, floor - 0.26, z0 + 0.25);

  // ---- behind the wheels: mudguards over the tandem, flaps, the under-run bar, the lamps on it.
  both((s) => {
    box(S, P.dark, s * (hw - 0.7), 2 * R + 0.06, d2 - R - 0.1, s * (hw + 0.03), 2 * R + 0.1, d1 + R + 0.1);
    box(S, P.dark, s * (hw - 0.62), 0.3, d2 - R - 0.16, s * (hw - 0.02), 2 * R + 0.06, d2 - R - 0.13);
    box(S, P.dark, s * (hw - 0.72), 0.8, d2 - R - 0.12, s * (hw - 0.68), 2 * R + 0.1, d1 + R + 0.1);
    box(S, P.tail, s * 0.8, 0.75, -L2 + 0.01, s * 1.1, 0.9, -L2 + 0.05);
    box(S, P.reflector, s * 0.55, 0.78, -L2 + 0.01, s * 0.7, 0.87, -L2 + 0.05);
  });
  box(S, P.dark, -(hw - 0.1), 0.72, -L2 + 0.03, hw - 0.1, 0.92, -L2 + 0.14);
  box(S, P.dark, -(hw - 0.12), 0.42, -L2, hw - 0.12, 0.56, -L2 + 0.1);
  return S;
}

/** The cruiser's kit on its sedan's body: the light bar on the roof, the push bar on the nose, the spot lamp on the pillar. */
export function policeKit(S: Solids, car: Car): void {
  const g = car.body, sv = car.parts.service!, m = sv.m as PoliceM, L2 = g.length / 2, C2 = g.cabWidth / 2;
  const [a, b] = sv.beacons as [BeaconLamp, BeaconLamp];
  component(S, "lightbar", () => {
    box(S, P.dark, -m.barW, m.barY - 0.01, m.barZ - 0.11, m.barW, m.barY + 0.045, m.barZ + 0.11);
    box(S, a.slot, -m.barW + 0.02, m.barY + 0.045, m.barZ - 0.09, -0.03, m.barY + 0.13, m.barZ + 0.09);
    box(S, b.slot, 0.03, m.barY + 0.045, m.barZ - 0.09, m.barW - 0.02, m.barY + 0.13, m.barZ + 0.09);
    box(S, P.dark, -0.03, m.barY + 0.045, m.barZ - 0.09, 0.03, m.barY + 0.14, m.barZ + 0.09);
  });
  component(S, "pushbar", () => {
    const z = L2 + 0.12, y1 = m.noseTop + 0.08;
    both((s) => { cap(S, P.dark, [s * 0.32, g.ride + 0.1, z], [s * 0.32, y1, z - 0.02], 0.035); cap(S, P.dark, [s * 0.32, g.ride + 0.22, z], [s * 0.32, g.ride + 0.22, L2 - 0.06], 0.03); });
    for (const y of [y1 - 0.02, (g.ride + y1) / 2]) cap(S, P.dark, [-0.34, y, z - 0.01], [0.34, y, z - 0.01], 0.03);
    box(S, a.slot, -0.24, y1 - 0.07, z + 0.01, -0.08, y1 - 0.02, z + 0.04);
    box(S, b.slot, 0.08, y1 - 0.07, z + 0.01, 0.24, y1 - 0.02, z + 0.04);
  });
  const x = -(C2 + 0.04), y = g.belt + 0.12, z = g.cabFront - 0.1;
  cap(S, P.metal, [x + 0.03, y - 0.04, z - 0.1], [x, y, z - 0.12], 0.012);
  cap(S, P.metal, [x, y, z - 0.14], [x, y, z], 0.055);
  cap(S, P.light, [x, y, z], [x, y, z + 0.02], 0.045);
  const deck = g.ride + (g.belt - g.ride) * (g.tailLo + (1 - g.tailLo) * Math.min(1, 0.35 / Math.max(0.1, L2 + g.cabRear)));
  cap(S, P.dark, [0.3, deck - 0.01, -L2 + 0.35], [0.3, deck + 0.52, -L2 + 0.33], 0.006);
}

