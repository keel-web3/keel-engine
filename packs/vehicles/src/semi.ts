// A semi tractor: the "Semi Truck" style (traits.ts SPECIAL_STYLES), never drawn
// for a seed -- built when a game asks for it by name, to pull something down
// the road (a billboard trailer). Its own measurements (semiRig: a long bonnet
// over a set-forward front axle, a tall cab and maybe a sleeper, a tandem of
// drive axles under a fifth wheel) and its own body (semiSolids), parted out the
// way a car's is -- bonnet, front wings, doors, roof, the sleeper's sides and
// back, each its panel's slot -- so it wears any paint, finish, livery or decal
// a car can, and everything else about it (paint, lamps, rims) is drawn as for
// any car. Car frame as everywhere: +z the nose, +x right, y up, the origin on
// the ground under its middle.

import type { BodyGeometry, Car, Dial, Handling, Panel, SemiParts, WheelMount, WheelSpec } from "./car.ts";
import { at, snap } from "./draws.ts";
import type { Draws } from "./draws.ts";
import { both, box, cap, component, sheet, solids, wedge } from "./solids.ts";
import type { Solids } from "./solids.ts";
import type { PanelFace } from "./shapes.ts";
import { BODY_SLOT } from "./slots.ts";

/** Its wheels' radius (a 22.5" rim on a truck tyre), and the rear duals' width as one tyre. */
const WHEEL_R = 0.52;
const FRONT_W = 0.3, DUAL_W = 0.6;
/** The cab: its skin's half width, floor, belt (the side glass's sill) and roof; the frame rails' top and half spacing. */
const CAB_W = 1.22, FLOOR = 1.08, BELT = 2.2, ROOF = 3.02, RAIL_TOP = 1.1, RAIL_X = 0.43;
/** The bumper's depth ahead of the grille, the cab's length (cowl to back wall), the drive axles' spacing. */
const BUMPER = 0.3, CAB = 1.45, TANDEM = 1.32;

export interface SemiRig {
  readonly body: BodyGeometry;
  readonly wheels: readonly [WheelSpec, WheelSpec];
  readonly mounts: WheelMount[];
  readonly handling: Handling;
  readonly semi: SemiParts;
}

/** A semi's measurements, wheels and handling, from its own draws (tags of its own: no car's draw moves). */
export function semiRig(D: Draws, d: Readonly<Record<Dial, number>>, wheel: WheelSpec): SemiRig {
  const sleeper = D.u("semi.sleeper") < 0.6 ? snap(at(D.flat("semi.sleeperLen"), 1.2, 2.0), 0.05) : 0;
  const raised = sleeper > 0 && D.u("semi.raised") < 0.55;
  const fairing = !raised && D.u("semi.fairing") < (sleeper ? 0.45 : 0.6);
  const hood = snap(at(D.tri("semi.hood") + 0.4 * d.hood, 1.55, 1.95), 0.01);
  const frame = snap(at(D.flat("semi.frame"), 2.95, 3.35), 0.01);
  const length = snap(BUMPER + hood + CAB + sleeper + frame, 0.01);
  const L2 = length / 2;
  const cabFront = snap(L2 - BUMPER - hood, 0.01), cabRear = snap(cabFront - CAB, 0.01);
  const frontAxle = snap(L2 - 1.2, 0.01);
  const drive: readonly [number, number] = [snap(-L2 + 0.8 + TANDEM, 0.01), snap(-L2 + 0.8, 0.01)];
  const rearAxle = snap((drive[0] + drive[1]) / 2, 0.01);
  const fifth = snap(rearAxle + 0.2, 0.01);
  const track: [number, number] = [1.03, 0.93];
  const ride = 0.45, hull = BELT - ride;
  const body: BodyGeometry = {
    length, width: 2 * CAB_W + 0.04, ride, belt: BELT, roof: ROOF, cabRear, cabFront, cabWidth: 2 * CAB_W - 0.12,
    screenRun: 0.22, rearRun: 0.02, nose: snap(BUMPER + hood, 0.01), noseLo: snap((1.93 - ride) / hull, 0.02), tail: frame, tailLo: snap((RAIL_TOP - ride) / hull, 0.02),
    tailRound: 0, tailRoll: 0, tailTuck: 0, shoulder: 0.02, flare: 0, strip: 0.2,
    doorFront: snap(cabFront - 0.06, 0.01), doorRear: snap(cabRear + 0.28, 0.01), wheelbase: snap(frontAxle - rearAxle, 0.01), frontAxle, rearAxle, track,
  };
  const front: WheelSpec = { ...wheel, radius: WHEEL_R, width: FRONT_W, sidewall: 0.44, dish: 0.03, spinner: "none", tyre: "street" };
  const rear: WheelSpec = { ...front, width: DUAL_W };
  const mounts: WheelMount[] = [];
  for (const s of [-1, 1] as const) mounts.push({ x: s * track[0], z: frontAxle, steers: true, shape: 0, side: s });
  for (const z of drive) for (const s of [-1, 1] as const) mounts.push({ x: s * track[1], z, steers: false, shape: 1, side: s });
  // (Seven to nine tonnes on its own -- a sleeper is most of a tonne -- 300 to 410 kW, governed near 105 km/h; it
  // brakes and turns like the lorry it is.)
  const power01 = (d.power + 1) / 2, mass01 = (d.mass + 1) / 2;
  const massT = snap(7.2 + 0.9 * (sleeper > 0 ? 1 : 0) + 0.6 * mass01, 0.01);
  const handling: Handling = {
    massKg: Math.round(massT * 1000),
    power: Math.round((300 + 110 * power01) * 1000),
    drag: snap(0.5 * 1.225 * (fairing || raised ? 0.62 : 0.78) * (body.width * (ROOF - 0.3)), 0.001),
    roll: 0.007,
    brakeG: 0.55,
    topSpeed: snap(28 + 2 * power01, 0.1),
    accel: snap(1.1 + 0.6 * power01, 0.1),
    brake: 5.5,
    grip: 6.5,
    steer: 0.62,
    wheelbase: body.wheelbase,
    mass: massT,
    radius: snap(Math.max(CAB_W, length * 0.3), 0.01),
    halfLength: snap(L2, 0.01),
    halfWidth: snap(CAB_W + 0.03, 0.01),
  };
  return { body, wheels: [front, rear], mounts, handling, semi: { sleeper, raised, fairing, fifth, drive } };
}

/** The top of its sleeper (or its cab, a day cab's). */
const topOf = (sp: SemiParts): number => (sp.raised ? ROOF + 0.62 : ROOF);
/** The back of its cab or its sleeper (z). */
const backOf = (car: Car, sp: SemiParts): number => car.body.cabRear - sp.sleeper;

/** Its exhaust stacks' tops: up the back corners of the cab (or the sleeper), well over the roof. */
export function semiStacks(car: Car): Array<{ x: number; y: number; z: number; r: number }> {
  const sp = car.parts.semi!;
  return [-1, 1].map((s) => ({ x: s * (CAB_W - 0.12), y: topOf(sp) + 0.78, z: backOf(car, sp) - 0.2, r: 0.085 }));
}

/**
 * A panel's face as a decal sees it, where the semi's differs from a car's (shapes.ts panelFace): its panels' own
 * sizes; the sleeper's sides are boxes running forward (a car's rear quarter is a wedge turned for the rear); its boot
 * is the back wall, read from behind.
 */
export function semiFace(car: Car, panel: Panel): Partial<PanelFace> {
  const g = car.body, sp = car.parts.semi!, L2 = g.length / 2;
  switch (panel) {
    case "doorL": case "doorR": return { u: g.doorFront - g.doorRear, v: BELT - FLOOR + 0.05 };
    case "fenderFL": case "fenderFR": return { u: L2 - BUMPER - (g.frontAxle - WHEEL_R - 0.22), v: 0.3 };
    case "quarterL": return { u: Math.max(0.2, sp.sleeper), v: topOf(sp) - FLOOR - 0.06, uFront: true, readU: true };
    case "quarterR": return { u: Math.max(0.2, sp.sleeper), v: topOf(sp) - FLOOR - 0.06, uFront: true, readU: false };
    case "hood": return { u: 1.2, v: L2 - BUMPER - g.cabFront };
    case "trunk": return { face: "back", u: 2 * CAB_W, v: topOf(sp) - FLOOR, readU: false, readV: false };
    case "roof": return { u: 2 * CAB_W, v: sp.sleeper ? sp.sleeper : CAB - 0.2 };
    case "bumperF": case "bumperR": return { u: 2 * CAB_W, v: 0.4 };
  }
}

/** The semi's body, solid by solid. */
export function semiSolids(car: Car): Solids {
  const S = solids();
  const g = car.body, p = car.parts, sp = p.semi!, P = BODY_SLOT;
  const L2 = g.length / 2, R = WHEEL_R, W = CAB_W;
  const nose = L2 - BUMPER; // (the grille's face)
  const zc = g.cabFront, zB = g.cabRear, zS = backOf(car, sp), zF = g.frontAxle;
  const [d1, d2] = sp.drive;
  const top = topOf(sp), roofT = 0.06, gTop = ROOF - roofT;

  // ---- the chassis: two rails nose to tail, crossmembers, the dark underside between them, the engine under the bonnet.
  both((s) => box(S, P.dark, s * (RAIL_X - 0.05), 0.8, -L2 + 0.02, s * (RAIL_X + 0.05), RAIL_TOP, nose - 0.1));
  for (const z of [-L2 + 0.08, d2 + 0.66, zS - 0.1, zc - 0.3, zF + 0.1]) box(S, P.dark, -RAIL_X, 0.86, z - 0.05, RAIL_X, 1.02, z + 0.05);
  box(S, P.dark, -(RAIL_X - 0.05), 0.8, -L2 + 0.1, RAIL_X - 0.05, 0.84, nose - 0.2);


  // ---- the front: a chrome bumper, the grille in its chrome shell, the bonnet over them.
  box(S, P.metal, -(W + 0.02), 0.42, nose + 0.04, W + 0.02, 0.86, L2);
  box(S, P.dark, -(W - 0.1), 0.34, nose + 0.02, W - 0.1, 0.43, L2 - 0.04);
  box(S, P.metal, -0.57, 0.86, nose - 0.1, 0.57, 1.95, nose + 0.02);
  box(S, P.grille, -0.48, 0.93, nose - 0.02, 0.48, 1.87, nose + 0.035);
  if (p.grille === "chrome" || p.grille === "slat") for (const k of [0.3, 0.55, 0.8]) box(S, P.metal, -0.49, 0.93 + 0.94 * k - 0.012, nose + 0.03, 0.49, 0.93 + 0.94 * k + 0.012, nose + 0.05);
  box(S, P.accent, -0.09, 1.96, nose - 0.04, 0.09, 2.02, nose + 0.02);
  // (The bonnet: a long wedge from the cowl down to the grille's top, between the wings.)
  sheet(S, P.hood, 0.6, zc, nose - 0.06, z => 2.06 - 0.13 * (z - zc) / (nose - 0.06 - zc));

  // ---- the front wings: swept over each wheel -- slice by slice, the arch cut round the tyre -- low at the nose.
  const Rf = R + 0.1;
  const wingTop = (z: number): number => 1.42 - 0.22 * Math.max(0, Math.min(1, (z - zF) / Math.max(0.1, nose - zF)));
  const wingRear = zF - Rf - 0.12;
  both((s) => {
    const slot = s > 0 ? P.fenderFR : P.fenderFL;
    const steps = Math.max(8, Math.ceil((nose - wingRear) / 0.09));
    for (let i = 0; i < steps; i += 1) {
      const za = wingRear + ((nose - wingRear) * i) / steps, zb = wingRear + ((nose - wingRear) * (i + 1)) / steps;
      const dz = Math.min(Math.abs(za - zF), Math.abs(zb - zF)) * (Math.sign(za - zF) === Math.sign(zb - zF) ? 1 : 0);
      const lo = dz < Rf ? R + Math.sqrt(Rf * Rf - dz * dz) : za > zF ? 0.9 : 1.02;
      box(S, slot, s * 0.6, Math.min(lo, wingTop(zb) - 0.06), za, s * (W + 0.02), wingTop((za + zb) / 2), zb);
    }
    // (Between the wing's back and the cab: the cowl's side, and the round air cleaner a long-nose wears on it.)
    if (wingRear - zc > 0.02) box(S, P.paint, s * 0.6, 1.02, zc, s * (W - 0.04), 1.42, wingRear);
    cap(S, P.metal, [s * (W - 0.02), 1.46, zc + 0.2], [s * (W - 0.02), 2.2, zc + 0.2], 0.19);
    // Its headlamps, on the wing's crown at the front.
    const hz = nose - 0.14, hy = wingTop(hz) + 0.1;
    if (p.head === "round" || p.head === "quad" || p.head === "frog" || p.head === "popup") {
      const lamps = p.head === "quad" ? [0.8, 1.04] : [0.92];
      const r = p.head === "quad" ? 0.075 : 0.11;
      for (const k of lamps) { cap(S, P.metal, [s * k, hy, hz - 0.1], [s * k, hy, hz + 0.02], r * 1.15); cap(S, P.light, [s * k, hy, hz - 0.02], [s * k, hy, hz + 0.05], r); }
    } else {
      box(S, P.metal, s * 0.7, hy - 0.08, hz - 0.14, s * 1.14, hy + 0.08, hz + 0.02);
      box(S, P.light, s * 0.73, hy - 0.06, hz - 0.1, s * 1.11, hy + 0.06, hz + 0.045);
    }
    // A hood mirror on each wing.
    cap(S, P.metal, [s * 1.12, wingTop(nose - 0.5), nose - 0.5], [s * 1.2, wingTop(nose - 0.5) + 0.26, nose - 0.52], 0.018);
    box(S, P.dark, s * 1.15, wingTop(nose - 0.5) + 0.2, nose - 0.58, s * 1.27, wingTop(nose - 0.5) + 0.34, nose - 0.5);
  });

  // ---- the cab: the lower cab and its doors, pillars, glass, the roof and a visor, marker lamps and air horns.
  box(S, P.paint, -(W - 0.04), FLOOR, zB, W - 0.04, BELT, zc);
  both((s) => {
    box(S, s > 0 ? P.doorR : P.doorL, s * (W - 0.04), FLOOR - 0.05, g.doorRear, s * W, BELT, g.doorFront);
    box(S, P.paint, s * (W - 0.04), FLOOR, zB, s * W, BELT, g.doorRear);
    box(S, P.paint, s * (W - 0.04), FLOOR, g.doorFront, s * W, BELT, zc);
    box(S, P.metal, s * W, BELT - 0.3, g.doorRear + 0.12, s * (W + 0.02), BELT - 0.26, g.doorRear + 0.3);
    // (Pillars: A along the screen's edge, B behind the door's glass, and the cab's back corner.)
    cap(S, P.paint, [s * (W - 0.03), BELT, zc - 0.03], [s * (W - 0.03), gTop, zc - 0.22], 0.04);
    box(S, P.paint, s * (W - 0.06), BELT, g.doorRear - 0.04, s * W, gTop, g.doorRear + 0.05);
    box(S, P.paint, s * (W - 0.06), BELT, zB, s * W, gTop, g.doorRear - 0.04);
    // The side glass, and the dark cab wall just inside it.
    box(S, P.glass, s * (W - 0.05), BELT, g.doorRear + 0.05, s * (W - 0.012), gTop, zc - 0.12);
    box(S, P.interior, s * (W - 0.1), BELT - 0.04, zB + 0.06, s * (W - 0.07), gTop, zc - 0.2);
    // West-coast mirrors on the doors.
    cap(S, P.metal, [s * W, BELT + 0.05, zc - 0.14], [s * (W + 0.2), BELT + 0.05, zc - 0.1], 0.02);
    cap(S, P.metal, [s * W, BELT + 0.5, zc - 0.14], [s * (W + 0.2), BELT + 0.5, zc - 0.1], 0.02);
    box(S, P.dark, s * (W + 0.17), BELT - 0.04, zc - 0.15, s * (W + 0.25), BELT + 0.58, zc - 0.05);
  });
  // The back wall (a day cab's, with its little window), the screen and its centre post, the roof, a visor.
  box(S, P.trunk, -W, BELT, zB, W, gTop, zB + 0.06);
  if (!sp.sleeper) box(S, P.glass, -0.42, BELT + 0.14, zB - 0.012, 0.42, gTop - 0.16, zB + 0.07);
  wedge(S, P.screen, -(W - 0.08), BELT - 0.01, zc - 0.22, W - 0.08, gTop, zc, 0.02, "front");
  cap(S, P.paint, [0, BELT, zc - 0.01], [0, gTop, zc - 0.21], 0.028);
  box(S, P.roof, -W, gTop, zB, W, ROOF, zc - 0.17);
  box(S, P.paint, -(W - 0.04), gTop - 0.1, zc - 0.22, W - 0.04, gTop - 0.02, zc + 0.08);
  for (const x of [-0.62, -0.31, 0, 0.31, 0.62]) cap(S, P.light, [x, ROOF + 0.015, zc - 0.2], [x, ROOF + 0.015, zc - 0.16], 0.035);
  both((s) => cap(S, P.metal, [s * 0.34, ROOF + 0.07, zc - 0.42], [s * 0.34, ROOF + 0.07, zc - 0.95], 0.05));
  // The cab inside, through the screen: the dash, two seats, the wheel, a driver.
  box(S, P.interior, -(W - 0.08), BELT - 0.14, zB + 0.06, W - 0.08, BELT - 0.06, zc - 0.2);
  box(S, P.interior, -(W - 0.08), BELT - 0.1, zB + 0.06, W - 0.08, gTop, zB + 0.12);
  box(S, P.dark, -(W - 0.1), BELT - 0.1, zc - 0.52, W - 0.1, BELT + 0.12, zc - 0.22);
  both((s) => {
    box(S, P.interior, s * 0.32, BELT - 0.06, zB + 0.18, s * 0.78, BELT + 0.12, zB + 0.62);
    box(S, P.interior, s * 0.32, BELT + 0.1, zB + 0.14, s * 0.78, BELT + 0.66, zB + 0.28);
  });
  box(S, P.dark, -0.78, BELT + 0.18, zc - 0.66, -0.32, BELT + 0.24, zc - 0.56);
  box(S, P.dark, -0.72, BELT + 0.1, zB + 0.36, -0.38, BELT + 0.55, zB + 0.56);
  cap(S, P.accent, [-0.55, BELT + 0.68, zB + 0.46], [-0.55, BELT + 0.68, zB + 0.46], 0.13);

  // ---- the sleeper (its sides are the rear quarters, its back the boot, as a car's), or a fairing on a day cab's roof.
  if (sp.sleeper > 0) {
    box(S, P.paint, -(W - 0.05), FLOOR, zS, W - 0.05, top - 0.06, zB);
    both((s) => {
      box(S, s > 0 ? P.quarterR : P.quarterL, s * (W - 0.05), FLOOR, zS + 0.04, s * W, top - 0.06, zB);
      box(S, P.glass, s * (W - 0.02), BELT - 0.1, zS + 0.35, s * (W + 0.006), BELT + 0.22, zS + 0.8);
    });
    box(S, P.trunk, -W, FLOOR, zS - 0.02, W, top - 0.06, zS + 0.04);
    box(S, P.roof, -W, top - 0.06, zS - 0.02, W, top, zB);
    // (A raised roof steps up from the cab's: a fairing ramps the cab's roof up to it.)
    if (sp.raised) wedge(S, P.roof, -(W - 0.02), ROOF - 0.01, zB, W - 0.02, top, zB + 1.0, 0.03, "front");
    // A battery and tool box under the sleeper.
    both((s) => { box(S, P.dark, s * 0.7, 0.56, zS + 0.12, s * 1.18, 1.04, zB - 0.12); box(S, P.metal, s * 0.7, 1.02, zS + 0.1, s * 1.2, 1.06, zB - 0.1); });
  }
  if (sp.fairing) wedge(S, P.paint, -(W - 0.08), ROOF - 0.01, zB, W - 0.08, top + 0.72, zc - 0.55, 0.04, "front");

  // ---- the fuel tanks under the doors (chrome), a step on each.
  both((s) => {
    cap(S, P.metal, [s * 0.98, 0.78, zc - 0.14], [s * 0.98, 0.78, zB + 0.16], 0.27);
    box(S, P.dark, s * 0.96, 0.42, g.doorRear + 0.2, s * (W + 0.02), 0.46, g.doorFront - 0.2);
  });

  // ---- the stacks up the back corners, their heat shields, and the air lines to the trailer.
  component(S, "exhaust", () => {
    for (const t of semiStacks(car)) cap(S, P.metal, [t.x, 1.9, t.z], [t.x, 2.7, t.z], t.r + 0.03);
  });
  cap(S, P.tail, [0.22, 1.5, zS - 0.04], [0.3, 1.18, zS - 0.5], 0.022);
  cap(S, P.accent, [-0.22, 1.5, zS - 0.04], [-0.3, 1.18, zS - 0.5], 0.022);

  // ---- behind the cab: a catwalk, the fifth wheel (its plate and the ramp a trailer backs up), the drive axles'
  // quarter fenders, mudflaps, and the frame's end with its lamps.
  box(S, P.dark, -0.6, RAIL_TOP, sp.fifth + 0.62, 0.6, RAIL_TOP + 0.03, zS - 0.06);
  box(S, P.dark, -0.66, RAIL_TOP + 0.02, sp.fifth - 0.45, 0.66, 1.25, sp.fifth + 0.44);
  wedge(S, P.dark, -0.66, RAIL_TOP + 0.02, sp.fifth - 0.95, 0.66, 1.25, sp.fifth - 0.45, 0.15, "rear");
  box(S, P.metal, -0.1, 1.2, sp.fifth - 0.3, 0.1, 1.27, sp.fifth);
  both((s) => {
    for (const z of [d1, d2]) box(S, P.metal, s * 0.62, 2 * R + 0.05, z - 0.04, s * (W + 0.04), 2 * R + 0.09, z + R + 0.1);
    box(S, P.dark, s * 0.62, 0.22, d2 - R - 0.16, s * (W + 0.04), 1.02, d2 - R - 0.12);
    box(S, P.metal, s * 0.62, 1.0, d2 - R - 0.17, s * (W + 0.04), 1.06, d2 - R - 0.11);
    box(S, P.tail, s * 0.55, 0.95, -L2 - 0.015, s * 0.85, 1.07, -L2 + 0.02);
    box(S, P.reflector, s * 0.9, 0.97, -L2 - 0.012, s * 1.02, 1.05, -L2 + 0.02);
  });
  box(S, P.dark, -0.92, 0.88, -L2, 0.92, 1.1, -L2 + 0.12);

  // ---- a neon kit's tubes: along under the cab and the tanks, where an underglow's light comes from.
  const kit = car.paints.neon;
  if (kit?.under) both((s) => cap(S, P.neon, [s * (W - 0.04), 0.5, d1 + R + 0.2], [s * (W - 0.04), 0.5, zF - R - 0.12], 0.024));
  return S;
}
