// A car as bake shapes: the BODY and each WHEEL shape, indexed (keel/bake: no
// colours baked, every solid carrying its SLOT), so one baked shape wears any
// paint, any decal, any condition -- and the wheels are their own layers:
//
//   - a wheel is baked with a "spin" clip: SPIN_FRAMES frames over one spoke's
//     turn (the spokes and tread blocks turn; the tyre's ring and the caliper
//     don't), so a wheel rolls by its frame, whatever its speed;
//   - a wheel is drawn in its OWN direction: a steered wheel's is the car's
//     yaw plus the steering angle, so front wheels visibly turn;
//   - a wheel is placed at its own ground point, and baked with heights (depth
//     sprites), so the body hides the far wheels and a wheel's face stands
//     proud of the body's side exactly where it does in 3D -- per pixel.
//
// The body is PARTED OUT like a real car: bonnet, boot, each door, each front
// wing, each rear quarter, both bumpers, the roof -- every panel ONE solid with
// a slot of its own. So a panel can wear a paint of its own (a primer bonnet, a
// door off another car) and a decal lands once, on that panel's own surface
// coordinate (a solid's u, v run 0..1 over each face).
//
// The frame convention: +z is the car's front, +x its right, +y up; the body's
// origin is the ground under its middle, a wheel's the ground under its hub.

import { dcos, dhypot, dsin } from "@keel-engine/core";
import type { BakeWorld, ClipSpec, DesignSpec, IndexedSource } from "@keel-engine/bake";
import type { Car, Panel, WheelSpec } from "./car.ts";
import { both, box, cap, component, sheet, solids, wedge, wedgeX } from "./solids.ts";
import type { Solids, V3 } from "./solids.ts";
import { bumperSolids } from "./bumpers.ts";
import { mechanicalSolids, mechanicsOf, componentBounds } from "./mechanics.ts";
import { BODY_SLOT } from "./slots.ts";
import { semiFace, semiSolids, semiStacks } from "./semi.ts";

export { BODY_SLOT } from "./slots.ts";
/** A panel's slot. */
export const panelSlot = (p: Panel): number => BODY_SLOT[p];
/** A wheel's slots. */
export const WHEEL_SLOT = { tyre: 0, tread: 1, rim: 2, hub: 3, caliper: 4, barrel: 5, wall: 6, spinner: 7 } as const;

/** Frames a wheel's spin clip bakes over one spoke's turn. */
export const SPIN_FRAMES = 6;

export interface VehicleDesign extends DesignSpec, IndexedSource { readonly components?: readonly (string | null)[] }

const TAU = 6.283185307179586;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------- the body

/** A point along the tail's rounded end: its z, half width, bottom and top. */
interface TailAt { readonly z: number; readonly half: number; readonly bottom: number; readonly top: number }

/**
 * The tail's last stretch, rounded (BodyGeometry's tailRound, tailRoll, tailTuck): how deep it runs from the very back,
 * and its section at a point along it -- t = 0 where it leaves the body, 1 at the very end. Each rounding is a quarter
 * circle over its own reach, so a car can have soft corners from above and a square top edge, or the other way about.
 * Depth 0 is a square tail (a pickup's tailgate, a buggy's frame).
 */
export function tailEndOf(car: Car): { depth: number; at(t: number): TailAt } {
  const g = car.body, L2 = g.length / 2, hull = g.belt - g.ride;
  const hw = car.archetype === "buggy" ? (g.width / 2) * 0.62 : g.width / 2;
  const deckTop = (z: number): number => (z >= g.cabRear ? g.belt : g.ride + hull * (g.tailLo + (1 - g.tailLo) * Math.max(0, Math.min(1, (z + L2) / Math.max(0.1, L2 + g.cabRear)))));
  // (It never reaches past the rear well: the wheel's arch is the body's, not the bumper's.)
  const room = Math.max(0, wellsOf(car).rear.z0 + L2 - 0.04);
  const depth = Math.min(room, Math.max(g.tailRound, g.tailRoll, g.tailTuck * 0.8));
  // (A quarter circle over the last `reach` metres: 0 until then, 1 at the very end.)
  const bend = (t: number, reach: number): number => {
    const r = Math.min(reach, depth);
    if (r <= 1e-3) return 0;
    const u = Math.max(0, Math.min(1, (t * depth - (depth - r)) / r));
    return 1 - Math.sqrt(1 - u * u);
  };
  return {
    depth,
    at: (t) => {
      const z = -L2 + depth * (1 - t);
      return { z, half: hw - Math.min(g.tailRound, depth) * bend(t, g.tailRound), bottom: g.ride + g.tailTuck * bend(t, g.tailTuck * 0.8), top: deckTop(z) - g.tailRoll * bend(t, g.tailRoll) };
    },
  };
}
/** Slices the tail's rounded end is built in. */
const TAIL_SLICES = 6;

/**
 * The back panel -- the face the tail lamps, the plate and the bumper's details sit on: its half width and how high it
 * runs (a rounded tail's end slice, or the square tail's whole back), and the height its lamps sit at (under its rolled
 * top, over its tucked bottom).
 */
export function backPanelOf(car: Car): { half: number; bottom: number; top: number; lampY: number } {
  const g = car.body, hull = g.belt - g.ride;
  const hw = car.archetype === "buggy" ? (g.width / 2) * 0.62 : g.width / 2;
  const TE = car.parts.bed ? null : tailEndOf(car);
  const end = TE && TE.depth > 0.02 ? TE.at((TAIL_SLICES - 0.5) / TAIL_SLICES) : null;
  const half = end ? end.half : hw, bottom = end ? end.bottom : g.ride;
  const top = end && TE ? TE.at(1).top : g.ride + hull * g.tailLo;
  const lampY = Math.max(bottom + 0.1, Math.min(g.ride + hull * Math.max(0.45, g.tailLo) - 0.04, top - 0.05));
  return { half, bottom, top, lampY };
}

/**
 * The tail lamps' spread across the back (m, from the middle): where each side's lens is centred and how far it runs
 * either side of that -- or, for a light bar, one lens across the middle (`single`). What the light they throw on the
 * road is shaped by: a full-width bar lays one wide band, twin rounds two narrow fans. The same figures the lamps are
 * built with (bodySolids' tail lights).
 */
export function tailSpan(car: Car): { centre: number; half: number; single: boolean } {
  const bh = backPanelOf(car).half;
  switch (car.parts.tail) {
    case "bar": return { centre: 0, half: bh * 0.95, single: true };
    case "slim": return { centre: 0, half: bh * 0.9, single: true };
    case "blocks": return { centre: bh * 0.765, half: bh * 0.185, single: false };
    case "round": return { centre: bh * 0.7, half: 0.075, single: false };
    case "quad": return { centre: bh * 0.685, half: bh * 0.135 + 0.06, single: false };
    case "split": return { centre: bh * 0.575, half: bh * 0.375, single: false };
  }
}

/** Where a car's tail lamps glow from (car frame; one a side, at the middle of each lamp group). */
export function tailLamps(car: Car): Array<{ x: number; y: number; z: number }> {
  const b = backPanelOf(car), k = { bar: 0.62, slim: 0.62, blocks: 0.76, round: 0.7, quad: 0.68, split: 0.58 }[car.parts.tail];
  return [-1, 1].map((s) => ({ x: s * b.half * k, y: b.lampY - 0.01, z: -car.body.length / 2 - 0.02 }));
}

/** The wheel wells: each axle's opening along z and how high it reaches (the band of panel above it). */
export function wellsOf(car: Car): { front: { z0: number; z1: number; top: number }; rear: { z0: number; z1: number; top: number } } {
  const g = car.body, L2 = g.length / 2, hull = g.belt - g.ride;
  // (A well's top: over the tyre, under the belt, and under the bonnet's or deck's line at the axle -- never below the hub.)
  const hoodAt = (z: number) => g.ride + hull * (g.noseLo + (1 - g.noseLo) * Math.max(0, Math.min(1, (L2 - z) / Math.max(0.1, L2 - g.cabFront))));
  const deckAt = (z: number) => g.ride + hull * (g.tailLo + (1 - g.tailLo) * Math.max(0, Math.min(1, (z + L2) / Math.max(0.1, L2 + g.cabRear))));
  const well = (z: number, R: number, line: number) => ({ z0: z - R * 1.45, z1: z + R * 1.45, top: Math.max(g.ride + R * 1.05, Math.min(g.belt - 0.03, 2 * R + 0.05)) });
  return { front: well(g.frontAxle, car.wheels[0].radius, hoodAt(g.frontAxle)), rear: well(g.rearAxle, car.wheels[1].radius, deckAt(g.rearAxle)) };
}

/** Where the doors run (z): between the wheel wells and under the cabin. */
export function doorsOf(car: Car): { front: number; rear: number } {
  const g = car.body, W = wellsOf(car);
  const front = Math.min(g.cabFront, W.front.z0);
  const rear = Math.min(front - 0.45, Math.max(g.cabRear + 0.05, Math.min(g.doorRear, front - 0.5), W.rear.z1));
  return { front, rear };
}

function bodySolids(car: Car): Solids {
  // (A semi tractor is built its own way: semi.ts.)
  if (car.parts.semi) { const S = semiSolids(car); fitMechanics(S, car); return S; }
  const S = solids();
  const g = car.body, p = car.parts, P = BODY_SLOT;
  const L2 = g.length / 2, W2 = g.width / 2;
  const hull = g.belt - g.ride;
  const buggy = car.archetype === "buggy";
  const hw = buggy ? W2 * 0.62 : W2; // (the hull's half width: a buggy's tub is narrow)
  // (The side strips hold the wheels: the hull's middle stays inboard of the tyres' inner faces.)
  const inner = Math.min(car.body.track[0] - car.wheels[0].width / 2, car.body.track[1] - car.wheels[1].width / 2);
  const st = buggy ? Math.min(g.strip, hw * 0.4) : Math.max(Math.min(g.strip, hw * 0.4), hw - inner + 0.03);
  const cabF = g.cabFront, cabR = g.cabRear;
  const doors = doorsOf(car);
  const doorF = doors.front, doorR = doors.rear;
  const noseLo = g.noseLo, tailLo = g.tailLo;
  const WL = wellsOf(car);
  const wf = WL.front, wr = WL.rear;
  // (The tail's rounded end, and where the body proper stops ahead of it: -L2 on a square tail.)
  const TE = p.bed ? { depth: 0, at: tailEndOf(car).at } : tailEndOf(car);
  const tailZ = -L2 + TE.depth;
  const { half: backHalf, bottom: backBottom, top: backTop, lampY: tailY } = backPanelOf(car);
  // (The bonnet's and the boot's top lines: the height of the hull's top at z.)
  const noseTop = g.ride + hull * noseLo, tailTop = g.ride + hull * tailLo;
  const hoodTop = (z: number): number => (z <= cabF ? g.belt : g.ride + hull * (noseLo + (1 - noseLo) * Math.max(0, Math.min(1, (L2 - z) / Math.max(0.1, L2 - cabF)))));
  const deckTop = (z: number): number => (z >= cabR ? g.belt : g.ride + hull * (tailLo + (1 - tailLo) * Math.max(0, Math.min(1, (z + L2) / Math.max(0.1, L2 + cabR)))));
  /** A wedge's lo for a slope from yFull down to yFoot over a base at y0. */
  const loOf = (y0: number, yFull: number, yFoot: number): number => Math.max(0, Math.min(0.98, (yFoot - y0) / Math.max(0.01, yFull - y0)));

  // ---- the hull, parted out; the wheels in open wells. A front wing is three pieces (behind its well, over it,
  // ahead of it), each following the bonnet's line; a door one box.
  both((s) => {
    const slot = s > 0 ? P.fenderFR : P.fenderFL;
    const x0 = s * hw, x1 = s * (hw - st);
    if (wf.z0 - doorF > 0.02) wedge(S, slot, x0, g.ride, doorF, x1, hoodTop(doorF), wf.z0, loOf(g.ride, hoodTop(doorF), hoodTop(wf.z0)), "front");
    if (hoodTop(wf.z0) - wf.top > 0.01) wedge(S, slot, x0, wf.top, wf.z0, x1, hoodTop(wf.z0), wf.z1, loOf(wf.top, hoodTop(wf.z0), Math.max(wf.top, hoodTop(wf.z1))), "front");
    if (L2 - wf.z1 > 0.02) wedge(S, slot, x0, g.ride, wf.z1, x1, hoodTop(wf.z1), L2, loOf(g.ride, hoodTop(wf.z1), noseTop), "front");
  });
  // The bonnet: a wedge between the wings from the windscreen to the nose.
  enginePanel(S, car, "hood", hw - st, cabF, L2, hoodTop);
  // Doors: a box each side between the wells.
  both((s) => box(S, s > 0 ? P.doorR : P.doorL, s * hw, g.ride, doorR, s * (hw - st), g.belt, doorF));
  // (Under the cabin, between the doors; ahead of a short door, under the windscreen's foot: the body's own paint.)
  // An OPEN car is hollow there: the body is carved out down to the tub's floor, with a rail each side and a wall at
  // each end, so the cabin is a real cavity -- nothing of the outside stands inside where a person sits.
  const openTub = g.belt - 0.26;
  if ((p.open || buggy) && openTub > g.ride + 0.06) {
    const inner = Math.max(0.05, Math.min(hw - st - 0.04, g.cabWidth / 2 * 0.92));
    box(S, P.paint, -(hw - st), g.ride, cabR, hw - st, openTub, cabF);
    both((s2) => box(S, P.paint, s2 * (hw - st), openTub, cabR, s2 * inner, g.belt, cabF));
    box(S, P.paint, -inner, openTub, cabR, inner, g.belt, Math.min(cabF, cabR + 0.1));
    box(S, P.paint, -inner, openTub, Math.max(cabR, cabF - 0.12), inner, g.belt, cabF);
  } else box(S, P.paint, -(hw - st), g.ride, cabR, hw - st, g.belt, cabF);
  const quarterEnd = p.bed ? cabR - 0.04 : cabR;
  if (doorR > quarterEnd) both((s) => box(S, P.paint, s * hw, g.ride, quarterEnd, s * (hw - st), g.belt, doorR));
  if (p.bed) {
    // A pickup's rear quarters are its bed's sides over the rear well; the boot its tailgate; a dark floor.
    const bedTop = g.belt + 0.34;
    both((s) => {
      box(S, s > 0 ? P.quarterR : P.quarterL, s * hw, wr.top, -L2, s * (hw - 0.07), bedTop, quarterEnd);
      if (wr.z0 + L2 > 0.03) box(S, s > 0 ? P.quarterR : P.quarterL, s * hw, g.ride, -L2, s * (hw - st), wr.top, wr.z0);
      if (quarterEnd - wr.z1 > 0.03) box(S, s > 0 ? P.quarterR : P.quarterL, s * hw, g.ride, wr.z1, s * (hw - st), wr.top, quarterEnd);
    });
    box(S, P.paint, -(hw - 0.07), g.ride, -L2, hw - 0.07, g.belt, cabR);
    box(S, P.dark, -(hw - 0.07), g.belt, -L2 + 0.08, hw - 0.07, g.belt + 0.03, cabR - 0.04);
    box(S, P.trunk, -(hw - 0.07), g.ride + 0.05, -L2 - 0.01, hw - 0.07, bedTop, -L2 + 0.07);
  } else {
    // Rear quarters: three pieces round the rear well, following the deck's line; the boot between them.
    both((s) => {
      const slot = s > 0 ? P.quarterR : P.quarterL;
      const x0 = s * hw, x1 = s * (hw - st), end = Math.min(quarterEnd, doorR);
      if (end - wr.z1 > 0.02) wedge(S, slot, x0, g.ride, wr.z1, x1, deckTop(end), end, loOf(g.ride, deckTop(end), deckTop(wr.z1)), "rear");
      if (deckTop(Math.min(wr.z1, end)) - wr.top > 0.01) wedge(S, slot, x0, wr.top, wr.z0, x1, deckTop(Math.min(wr.z1, end)), Math.min(wr.z1, end), loOf(wr.top, deckTop(Math.min(wr.z1, end)), Math.max(wr.top, deckTop(wr.z0))), "rear");
      if (wr.z0 - tailZ > 0.02) wedge(S, slot, x0, g.ride, tailZ, x1, deckTop(wr.z0), wr.z0, loOf(g.ride, deckTop(wr.z0), deckTop(tailZ)), "rear");
    });
    enginePanel(S, car, "trunk", hw - st, tailZ, cabR, deckTop);
    // The tail's rounded end: slices, each a little narrower, its top rolled a little lower and its bottom tucked a
    // little higher than the last -- the bumper wrapping the corners, the boot lid rolling over into the back panel.
    for (let i = 0; i < TAIL_SLICES && TE.depth > 0.02; i += 1) {
      const A = TE.at(i / TAIL_SLICES), B = TE.at((i + 1) / TAIL_SLICES), M = TE.at((i + 0.5) / TAIL_SLICES);
      wedge(S, P.bumperR, -M.half, M.bottom, A.z, M.half, A.top, B.z, loOf(M.bottom, A.top, B.top), "rear");
    }
  }
  // ---- how ROUND it is: a boxy car keeps its edges; a round one wears rails along its shoulder, its sill and its
  // corners (the `shoulder` radius its round dial sets -- so a muscle car or a pickup stays square and a GT, a kei or a
  // prototype is soft). They sit inside the panel's own face, each in its own panel's slot, so the paint still breaks
  // panel by panel.
  const sh = buggy ? 0 : Math.min(g.shoulder, hull * 0.32, st * 0.9);
  if (sh > 0.015) {
    // (`pair`: the right side's slot and the left side's -- a panel's own, or one slot for both.)
    const rail = (pair: readonly [number, number], y: number, z0: number, z1: number, r: number, inset: number): void => {
      if (z1 - z0 < r * 1.2) return;
      both((s2) => cap(S, s2 > 0 ? pair[0] : pair[1], [s2 * (hw - r + inset), y, z0 + r * 0.5], [s2 * (hw - r + inset), y, z1 - r * 0.5], r));
    };
    // The shoulder: along the belt line, over the doors and the quarters (a fender's line follows the bonnet).
    // (Over a door it wears the body's own paint, not the door's: a door is one solid, so a decal lands on it once.)
    rail([P.paint, P.paint], g.belt - sh, doorR, doorF, sh, 0.004);
    const qEnd = Math.min(quarterEnd, doorR);
    if (!p.bed && qEnd - wr.z1 > sh * 1.4) rail([P.quarterR, P.quarterL], Math.min(g.belt, deckTop(qEnd)) - sh, wr.z1, qEnd, sh * 0.9, 0.004);
    if (wf.z1 < cabF - 0.05) rail([P.fenderFR, P.fenderFL], Math.min(g.belt, hoodTop(wf.z1)) - sh, wf.z1, Math.min(cabF, doorF), sh * 0.85, 0.004);
    // The sill: the bottom edge along the doors.
    rail([P.dark, P.dark], g.ride + sh * 0.8, wr.z1 + 0.02, wf.z0 - 0.02, sh * 0.8, 0.0);
    // The corners, in plan: the nose's and the tail's, so it isn't a brick from above.
    const cr = sh * 0.95;
    both((s2) => {
      cap(S, P.bumperF, [s2 * (hw - cr + 0.004), g.ride + cr, L2 - cr], [s2 * (hw - cr + 0.004), Math.max(g.ride + cr, noseTop - cr), L2 - cr], cr);
      if (TE.depth <= 0.02) cap(S, P.bumperR, [s2 * (hw - cr + 0.004), g.ride + cr, -L2 + cr], [s2 * (hw - cr + 0.004), Math.max(g.ride + cr, tailTop - cr), -L2 + cr], cr);
    });
  }
  // ---- a neon kit's tubes: UNDER it, along the sills (and round the ends when the kit runs all round). They are
  // their own slot, so they are only there on a car that has the kit -- and they sit at the very bottom, under the
  // sill, where an underglow's light comes from.
  const kit = car.paints.neon;
  if (kit?.under) {
    const ty = g.ride + 0.015, tr = 0.022;
    const z0 = kit.run === "rear" ? -L2 + 0.1 : kit.run === "front" ? 0.1 : wr.z1 + 0.05;
    const z1 = kit.run === "front" ? L2 - 0.1 : kit.run === "rear" ? -0.1 : wf.z0 - 0.05;
    if (z1 - z0 > 0.1) both((s2) => cap(S, P.neon, [s2 * (hw - 0.02), ty, z0], [s2 * (hw - 0.02), ty, z1], tr));
    if (kit.run === "ring" || kit.run === "front") cap(S, P.neon, [-(hw - 0.12), ty, L2 - 0.12], [hw - 0.12, ty, L2 - 0.12], tr);
    if (kit.run === "ring" || kit.run === "rear") cap(S, P.neon, [-(hw - 0.12), ty, -L2 + 0.12], [hw - 0.12, ty, -L2 + 0.12], tr);
  }
  // The wells' liners: dark behind each wheel, so an opening reads as an opening.
  // (The liner is the dark slot's, not the arch's: the arch carries the trim and the flares -- what a neon kit lights.)
  if (!buggy) for (const w of [wf, wr]) both((s) => box(S, P.dark, s * (inner - 0.05), g.ride - 0.02, w.z0 + 0.01, s * (inner - 0.012), w.top + 0.005, w.z1 - 0.01));
  // The lower band: the second colour (two-tone) along the doors, or a dark sill.
  if (p.twoTone) box(S, P.alt, -hw - 0.008, g.ride, doorR, hw + 0.008, g.ride + hull * 0.38, doorF);
  else both((s) => box(S, P.dark, s * (hw + 0.006), g.ride, wr.z1 + 0.02, s * (hw - 0.03), g.ride + 0.06, wf.z0 - 0.02));
  // Bumpers: their own pieces, in the car's own form (bumpers.ts).
  const bumperH = Math.min(0.2, hull * 0.42);
  bumperSolids(S, car, { hw, L2, bumperH, rounded: TE.depth > 0.02, backHalf, backBottom, backTop });
  // The grille.
  const gs = p.grilleScale;
  const gTop = Math.max(g.ride + bumperH + 0.03, noseTop - 0.04);
  switch (p.grille) {
    case "smooth": box(S, P.grille, -hw * 0.28 * gs, g.ride + 0.03, L2 + 0.02, hw * 0.28 * gs, g.ride + 0.08, L2 + 0.05); break;
    case "split": both((s) => box(S, P.grille, s * hw * 0.06, g.ride + bumperH * 0.5, L2 + 0.02, s * hw * 0.34 * gs, gTop, L2 + 0.05)); break;
    case "shark": box(S, P.grille, -hw * 0.9, g.ride + bumperH, L2 - 0.02, hw * 0.9, gTop + 0.02, L2 + 0.03); break;
    case "chrome":
      box(S, P.grille, -hw * 0.55 * gs, g.ride + bumperH * 0.6, L2 + 0.01, hw * 0.55 * gs, gTop, L2 + 0.045);
      for (const k of [0.3, 0.65]) box(S, P.trim, -hw * 0.57 * gs, g.ride + bumperH * 0.6 + (gTop - g.ride - bumperH * 0.6) * k - 0.012, L2 + 0.04, hw * 0.57 * gs, g.ride + bumperH * 0.6 + (gTop - g.ride - bumperH * 0.6) * k + 0.012, L2 + 0.06);
      break;
    default: box(S, P.grille, -hw * 0.5 * gs, g.ride + bumperH * 0.55, L2 + 0.01, hw * 0.5 * gs, gTop, L2 + 0.05);
  }

  // ---- the wells' company: flares, arch trim, cladding, mudflaps, struts.
  for (const m of car.mounts) {
    const w = car.wheels[m.shape];
    const well = m.shape === 0 ? wf : wr;
    const x = m.side * hw;
    // The arch over each wheel, as a car has one: a CURVE that follows the tyre from the front of the opening, over
    // the top, to the back of it -- not a flat plate laid over the wheel. Every piece of it (the wing's lip, the
    // trim, a flare) is the same curve at its own radius, so they nest the way a real wing, lip and flare do.
    const hubY = w.radius;
    // One CONTINUOUS lip that follows the arch, laid along the curve (each piece joins the last), not a row of lumps
    // sitting on the panel: what you see is an unbroken line round the opening, the way a wing's edge reads.
    const arc = (slot: number, xAt: number, Ra: number, capR: number, steps: number): void => {
      const span = 1.3; // (radians either side of straight up: the opening's mouth, down past the hub's height)
      let py = 0, pz = 0, have = false;
      for (let i = 0; i <= steps; i += 1) {
        const a = -span + (2 * span * i) / steps;
        const y = hubY + Ra * dcos(a), z = m.z + Ra * dsin(a);
        if (y > g.ride + capR) { if (have) cap(S, slot, [xAt, py, pz], [xAt, y, z], capR); py = y; pz = z; have = true; }
        else have = false;
      }
    };
    if (!buggy) {
      const outer = Math.abs(m.x) + w.width / 2 + 0.012;
      const lipSlot = m.shape === 0 ? (m.side > 0 ? P.fenderFR : P.fenderFL) : (m.side > 0 ? P.quarterR : P.quarterL);
      // The OPENING itself, arched: the panel is cut square, so fill it back in down to the curve -- slice by slice
      // from the front of the well to the back, each slice reaching from the arch up to the cut's top. A boxy car
      // shows this most: without it you see a square hole with a curve floating over it.
      const Rf = w.radius + 0.028;
      const slices = 7;
      for (let i = 0; i < slices; i += 1) {
        const za = well.z0 + ((well.z1 - well.z0) * i) / slices, zb = well.z0 + ((well.z1 - well.z0) * (i + 1)) / slices;
        // (the arch's height across this slice: its highest point, so the fill never cuts into the opening)
        const dz = Math.max(Math.abs(za - m.z), Math.abs(zb - m.z));
        const y = dz >= Rf ? g.ride : m.shape >= 0 ? w.radius + Math.sqrt(Math.max(0, Rf * Rf - dz * dz)) : g.ride;
        if (well.top - y > 0.012) box(S, lipSlot, m.side * hw, y, za, m.side * (hw - st), well.top, zb);
      }
      // (Its thickness is the gap between the panel and the tyre's face, so a proud tyre still sits under its arch;
      // it runs at the middle of that gap, and the panel's own face hides where it meets it.)
      const lipR = Math.max(0.022, Math.min(0.055, (outer - hw) / 2 + 0.022));
      arc(lipSlot, m.side * Math.min(outer, hw + lipR * 0.5), w.radius + 0.03 + lipR * 0.5, lipR, 9);
    }
    if (!buggy && p.widebody === "box") box(S, P.paint, x - m.side * 0.02, well.top, well.z0 - 0.06, x + m.side * (0.06 + g.flare * 0.6), Math.min(g.belt - 0.02, well.top + 0.14), well.z1 + 0.06);
    else if (!buggy && (p.widebody === "bolt" || g.flare > 0.03)) {
      // (A flare: the same arch, standing proud of the panel -- black plastic when it's bolted on.)
      const fr = Math.max(0.03, g.flare * 0.8);
      arc(p.widebody === "bolt" ? P.arch : P.paint, x + m.side * fr * 0.4, w.radius + 0.035 + fr * 0.6, fr, 9);
    }
    if (p.arches !== "none" && !buggy) {
      // (The trim: a thin band round the opening's edge, just proud of the panel.)
      const t = p.arches === "cladding" ? 0.026 : 0.015;
      arc(P.arch, x + m.side * 0.006, w.radius + 0.052 + t, t, 9);
    }
    if (p.mudflaps && m.shape === 1) box(S, P.dark, m.side * (Math.abs(m.x) - w.width / 2), g.ride - 0.02, well.z0 - 0.06, m.side * (Math.abs(m.x) + w.width / 2), g.ride + 0.3, well.z0 - 0.02);
    if (buggy) {
      cap(S, P.metal, [m.side * hw, g.ride + 0.12, m.z], [m.side * (Math.abs(m.x) - w.width * 0.5), w.radius, m.z], 0.035);
      cap(S, P.metal, [m.side * hw, g.ride + 0.3, m.z - 0.15 * Math.sign(m.z || 1)], [m.side * (Math.abs(m.x) - w.width * 0.5), w.radius + 0.05, m.z], 0.03);
    }
  }
  if (p.arches === "cladding") both((s) => box(S, P.arch, s * (hw + 0.012), g.ride, wr.z1, s * (hw - 0.01), g.ride + 0.12, wf.z0));
  if (buggy) {
    box(S, P.metal, -hw * 0.7, g.ride + 0.05, -L2 - 0.12, hw * 0.7, g.belt + 0.12, -L2 + 0.5);
    box(S, P.dark, -hw * 0.5, g.belt + 0.12, -L2 + 0.02, hw * 0.5, g.belt + 0.2, -L2 + 0.45);
  }

  // ---- the cabin: a greenhouse -- sloped side glass leaning in to a narrower roof, the screens, pillars.
  const C2 = g.cabWidth / 2;
  const roofT = 0.05;
  const zs = cabF - g.screenRun, zr = cabR + g.rearRun;
  const roofSlot = p.roof === "glass" ? P.glass : P.roof;
  const tumble = Math.min(C2 * 0.3, (g.roof - g.belt) * (0.22 + 0.25 * Math.max(0, car.dials.round)));
  const Ci = C2 - tumble;
  const Cm = (C2 + Ci) / 2;
  if (p.open || buggy) {
    // An open top: a short screen, seats, a dash -- the interior shows.
    // An open top: a short screen, and a cabin you see straight into -- so it is a real one. A floor pan down in the
    // tub, a console up the middle, a dash across the front with its binnacle, a steering wheel on the driver's side,
    // a lever on the console, two seats with headrests, and a hoop behind them.
    const screenH = buggy ? 0.3 : Math.min(0.32, g.roof - g.belt);
    wedge(S, P.screen, -C2, g.belt - 0.01, cabF - screenH * 0.9, C2, g.belt + screenH, cabF, 0.02, "front");
    both((s) => cap(S, P.trim, [s * C2, g.belt, cabF], [s * C2, g.belt + screenH, cabF - screenH * 0.9], 0.025));
    const tub = Math.max(g.ride + 0.05, openTub);    // (the floor of the cavity the body was carved down to)
    const seatF = cabR + 0.46, seatB = cabR + 0.08;  // (where the seats sit, front and back)
    box(S, P.dark, -C2 * 0.92, tub, cabR + 0.02, C2 * 0.92, tub + 0.04, cabF - 0.08);
    // (The tub's walls: a cabin you can see into is a box, not a hole through the car.)
    both((sd) => box(S, P.interior, sd * C2 * 0.92, tub, cabR + 0.02, sd * C2 * 0.86, g.belt, cabF - 0.08));
    box(S, P.interior, -C2 * 0.92, tub, cabR + 0.02, C2 * 0.92, g.belt, cabR + 0.08);
    box(S, P.interior, -C2 * 0.92, tub, cabF - 0.14, C2 * 0.92, g.belt, cabF - 0.08);
    box(S, P.interior, -C2 * 0.92, tub + 0.04, cabR + 0.02, C2 * 0.92, g.belt - 0.2, cabF - 0.08);
    // The console up the middle, and the lever on it.
    box(S, P.interior, -C2 * 0.16, tub + 0.04, seatB, C2 * 0.16, g.belt - 0.08, cabF - 0.3);
    cap(S, P.dark, [0, g.belt - 0.08, seatF - 0.12], [0, g.belt + 0.04, seatF - 0.16], 0.022);
    // The dash across the front, its binnacle over the wheel.
    box(S, P.dark, -C2 * 0.88, g.belt - 0.2, cabF - 0.36, C2 * 0.88, g.belt + 0.02, cabF - 0.12);
    const wx = -Math.max(0.2, C2 * 0.46);            // (the driver sits on the left)
    box(S, P.dark, wx - 0.16, g.belt - 0.02, cabF - 0.34, wx + 0.16, g.belt + 0.08, cabF - 0.18);
    // The steering wheel: a ring of short capsules on a raked column, so it reads as a wheel from above.
    const wr2 = Math.min(0.13, C2 * 0.3), wy = g.belt + 0.02, wz = cabF - 0.52;
    cap(S, P.dark, [wx, g.belt - 0.12, cabF - 0.26], [wx, wy, wz], 0.022);
    for (let i = 0; i < 8; i += 1) {
      const a0 = (i / 8) * TAU, a1 = ((i + 1) / 8) * TAU;
      cap(S, P.dark, [wx + wr2 * dsin(a0), wy + wr2 * dcos(a0) * 0.42, wz + wr2 * dcos(a0) * 0.9],
        [wx + wr2 * dsin(a1), wy + wr2 * dcos(a1) * 0.42, wz + wr2 * dcos(a1) * 0.9], 0.016);
    }
    // The seats: a cushion in the tub, a back, and a headrest over it.
    both((s) => {
      const x0 = s * 0.1, x1 = s * Math.max(0.22, C2 * 0.82);
      box(S, P.interior, x0, tub + 0.04, seatB + 0.06, x1, tub + 0.16, seatF);
      box(S, P.interior, x0, tub + 0.1, seatB, x1, g.belt + 0.06, seatB + 0.12);
      box(S, P.interior, s * 0.14, g.belt + 0.06, seatB + 0.01, s * Math.max(0.2, C2 * 0.5), g.belt + 0.2, seatB + 0.11);
      // (The hoop behind each seat, as a roadster wears them.)
      if (!buggy) cap(S, P.metal, [s * Math.max(0.16, C2 * 0.44), g.belt + 0.02, cabR + 0.02], [s * Math.max(0.16, C2 * 0.44), g.belt + 0.26, cabR + 0.04], 0.035);
    });
  } else {
    const gTop = g.roof - roofT;
    // The cabin inside, seen through the glass: a floor, a dash, two seats, a steering wheel, a helmeted driver.
    // It's laid out round a PERSON, not a helmet: the driver's head goes where the roof is highest (just behind the
    // windscreen's top edge), the seat back stands behind their head -- no taller than the glass over it -- the
    // cushion low enough for them to sit in, and the dash and the wheel in front of them, not under them. A short roof
    // (a fastback's) lends the seat back the rear glass's slope. (The game's driver is fitted into this: seat-fit.ts.)
    const zLo = Math.min(zr, zs), zHi = Math.max(zr, zs);
    // (The glass over any z: the roof's flat between the screens, falling to the belt at each end.)
    const ceilingAt = (z: number): number => z > zHi ? g.belt + (gTop - g.belt) * Math.max(0, Math.min(1, (cabF - z) / Math.max(0.05, cabF - zHi)))
      : z < zLo ? g.belt + (gTop - g.belt) * Math.max(0, Math.min(1, (z - cabR) / Math.max(0.05, zLo - cabR))) : gTop;
    const zHead = Math.max(cabR + 0.42, zHi - Math.max(0.06, Math.min(0.14, (zHi - zLo) * 0.3)));
    box(S, P.interior, -Ci * 0.95, g.belt - 0.08, Math.min(zr, zs) - 0.05, Ci * 0.95, g.belt + 0.01, Math.max(zr, zs) + 0.25);
    // A firewall at the screen's foot and a bulkhead behind the seats: the cabin is a CLOSED box, so looking in
    // through the glass shows the cabin -- never the bonnet, the boot or the exhaust on the car's far side.
    box(S, P.interior, -Ci, g.belt - 0.06, Math.max(zr, zs) - 0.04, Ci, gTop, Math.max(zr, zs));
    box(S, P.interior, -Ci, g.belt - 0.06, Math.min(zr, zs), Ci, gTop, Math.min(zr, zs) + 0.04);
    both((sd) => box(S, P.interior, sd * Ci, g.belt - 0.06, Math.min(zr, zs), sd * (Ci - 0.03), gTop, Math.max(zr, zs)));
    // The dash: in front of the driver, under the windscreen.
    const dashZ = Math.max(zHead + 0.24, zs - 0.08);
    box(S, P.dark, -Ci * 0.9, g.belt, dashZ, Ci * 0.9, g.belt + 0.13, Math.max(dashZ + 0.12, Math.min(cabF - 0.12, zHead + 0.56)));
    both((sd) => {
      const x0 = sd * 0.07, x1 = sd * Math.max(0.2, Ci * 0.82);
      // (The cushion, low: the driver's sitting in it, and the back, its top under the glass where it stands.)
      box(S, P.interior, x0, g.belt, zHead - 0.2, x1, g.belt + Math.min(0.05, (gTop - g.belt) * 0.15), zHead + 0.14);
      const backTop = Math.min(gTop - 0.04, g.belt + 0.42, ceilingAt(zHead - 0.27) - 0.03, ceilingAt(zHead - 0.16) - 0.03);
      box(S, P.interior, x0, g.belt + 0.03, zHead - 0.27, x1, Math.max(g.belt + 0.12, backTop), zHead - 0.16);
    });
    const dx = -Math.max(0.2, Ci * 0.45);
    // The wheel's hub, ahead of the driver; the stand-in's torso and helmet (the game puts its own driver there).
    cap(S, P.dark, [dx, g.belt + 0.2, zHead + 0.34], [dx, g.belt + 0.24, zHead + 0.3], 0.055);
    box(S, P.dark, dx - 0.14, g.belt + 0.06, zHead - 0.12, dx + 0.14, Math.min(gTop - 0.2, g.belt + 0.3), zHead + 0.06);
    cap(S, P.accent, [dx, Math.min(gTop - 0.1, g.belt + 0.36), zHead], [dx, Math.min(gTop - 0.1, g.belt + 0.36), zHead], Math.min(0.11, (gTop - g.belt) * 0.3));
    box(S, P.glass, -Ci, g.belt - 0.01, Math.min(zr, zs), Ci, gTop, Math.max(zr, zs));
    both((s) => wedgeX(S, P.glass, s * Ci, s * C2, g.belt - 0.01, gTop, Math.min(zr, zs), Math.max(zr, zs), 0.04));
    wedge(S, P.screen, -Cm, g.belt - 0.01, zs, Cm, g.roof - 0.01, cabF, 0.02, "front");
    wedge(S, P.glass, -Cm, g.belt - 0.01, cabR, Cm, g.roof - 0.01, zr, 0.02, "rear");
    box(S, roofSlot, -Ci - 0.02, gTop, Math.min(zr, zs) - 0.02, Ci + 0.02, g.roof, Math.max(zr, zs) + 0.02);
    // Pillars: A along the windscreen's edges, C along the rear glass's, B leaning with the side glass on a long cabin.
    const pillar = car.archetype === "proto" ? P.glass : P.roof;
    both((s) => {
      cap(S, pillar, [s * C2, g.belt, cabF - 0.03], [s * (Ci + 0.01), gTop, zs], 0.03);
      cap(S, pillar, [s * C2, g.belt, cabR + 0.03], [s * (Ci + 0.01), gTop, zr], 0.042);
      if (zs - zr > 0.9) cap(S, pillar, [s * C2, g.belt, (zs + zr) / 2], [s * (Ci + 0.01), gTop, (zs + zr) / 2], 0.035);
      // (The glass's lower edge: a trim strip along the belt.)
      box(S, P.trim, s * (C2 - 0.012), g.belt - 0.015, cabR + 0.04, s * (C2 + 0.014), g.belt + 0.02, cabF - 0.04);
    });
  }
  if (p.mirrors !== "none" && !buggy) both((s) => {
    const y = g.belt + 0.08, z = cabF - 0.12;
    if (p.mirrors === "aero") { cap(S, P.carbon, [s * C2, y, z], [s * (C2 + 0.1), y + 0.04, z + 0.02], 0.012); box(S, P.paint, s * (C2 + 0.08), y + 0.02, z - 0.02, s * (C2 + 0.16), y + 0.07, z + 0.06); }
    else box(S, P.paint, s * C2, y, z - 0.06, s * (C2 + 0.15), y + 0.09, z + 0.04);
  });

  // ---- lights: lenses set into the nose's FRONT face (never lying on the bonnet), a dark bezel round each, glowing.
  const hs = p.headScale;
  const faceTop = noseTop - 0.025, faceBottom = g.ride + bumperH + 0.015;
  const faceH = Math.max(0.03, faceTop - faceBottom);
  // (The bezel sits BEHIND the lens and barely wider: a 12 mm black frame in front reads as a black lamp once a
  // lamp is only a few pixels across -- what you should see lit is the lens, with the dark just showing round it.)
  const lens = (x0: number, x1: number, h: number): void => {
    const y1 = faceTop, y0 = Math.max(faceBottom, y1 - Math.min(faceH, h));
    box(S, P.grille, x0 + Math.sign(x1 - x0 || 1) * -0.006, y0 - 0.006, L2 - 0.03, x1 + Math.sign(x1 - x0 || 1) * 0.006, y1 + 0.006, L2 + 0.006);
    box(S, P.light, x0, y0, L2 - 0.02, x1, y1, L2 + 0.03);
  };
  const faceLamp = (x: number, y: number, r: number): void => {
    cap(S, P.trim, [x, y, L2 - 0.03], [x, y, L2 - 0.002], r * 1.12);
    cap(S, P.light, [x, y, L2 - 0.02], [x, y, L2 + 0.028], r);
  };
  const faceY = (r: number): number => Math.max(faceBottom + r, faceTop - r);
  switch (p.head) {
    case "strip": lens(-hw * 0.9, hw * 0.9, 0.04 * hs); break;
    case "slit": both((s) => lens(s * hw * (0.93 - 0.4 * hs), s * hw * 0.93, 0.035)); break;
    case "pair": both((s) => lens(s * hw * (0.93 - 0.32 * hs), s * hw * 0.93, 0.09 * hs)); break;
    case "round": both((s) => { const r = Math.min(0.08 * hs, faceH / 2 + 0.02); faceLamp(s * hw * 0.68, faceY(r), r); }); break;
    case "quad": both((s) => { const r = Math.min(0.055 * hs, faceH / 2 + 0.015); for (const k of [0.5, 0.78]) faceLamp(s * hw * k, faceY(r), r); }); break;
    case "frog": both((s) => { const z = L2 - 0.4, y = hoodTop(z); cap(S, P.paint, [s * hw * 0.62, y - 0.08, z], [s * hw * 0.62, y + 0.02, z], 0.1 * hs); cap(S, P.trim, [s * hw * 0.62, y + 0.03, z + 0.05], [s * hw * 0.62, y + 0.03, z + 0.07], 0.07 * hs); cap(S, P.light, [s * hw * 0.62, y + 0.03, z + 0.07], [s * hw * 0.62, y + 0.03, z + 0.11], 0.065 * hs); }); break;
    case "popup": both((s) => { const z = L2 - 0.28; box(S, P.paint, s * hw * 0.5, hoodTop(z) - 0.02, z - 0.14, s * hw * 0.86, hoodTop(z) + 0.015, z + 0.14); lens(s * hw * 0.52, s * hw * 0.84, 0.03); }); break;
  }
  if (p.lightPod) {
    const y = g.ride + bumperH + 0.08, z = L2 + 0.03;
    // (The pods stand proud of their bar, not level with it: a lamp reads lit, not as a black dot.)
    for (const k of [-0.6, -0.2, 0.2, 0.6]) cap(S, P.light, [k * C2 * 1.2, y, z - 0.01], [k * C2 * 1.2, y, z + 0.05], 0.062);
    box(S, P.dark, -C2 * 1.05, y - 0.09, z - 0.08, C2 * 1.05, y - 0.05, z - 0.03);
  }
  if (p.bullbar) {
    both((s) => cap(S, P.metal, [s * hw * 0.7, g.ride, L2 + 0.14], [s * hw * 0.6, g.ride + hull * 0.9, L2 + 0.12], 0.035));
    cap(S, P.metal, [-hw * 0.7, g.ride + hull * 0.5, L2 + 0.15], [hw * 0.7, g.ride + hull * 0.5, L2 + 0.15], 0.035);
  }
  const zT = -L2 + 0.02;
  const bh = backHalf;
  switch (p.tail) {
    case "bar": box(S, P.tail, -bh * 0.95, tailY - 0.04, zT - 0.05, bh * 0.95, tailY + 0.02, zT + 0.04); break;
    case "slim": box(S, P.tail, -bh * 0.9, tailY - 0.015, zT - 0.05, bh * 0.9, tailY + 0.01, zT + 0.04); break;
    case "blocks": both((s) => box(S, P.tail, s * bh * 0.58, tailY - 0.1, zT - 0.05, s * bh * 0.95, tailY + 0.02, zT + 0.05)); break;
    case "round": both((s) => cap(S, P.tail, [s * bh * 0.7, tailY - 0.04, zT - 0.03], [s * bh * 0.7, tailY - 0.04, zT + 0.02], 0.075)); break;
    case "quad": both((s) => { for (const k of [0.55, 0.82]) cap(S, P.tail, [s * bh * k, tailY - 0.04, zT - 0.03], [s * bh * k, tailY - 0.04, zT + 0.02], 0.06); }); break;
    case "split": both((s) => box(S, P.tail, s * bh * 0.2, tailY - 0.03, zT - 0.05, s * bh * 0.95, tailY + 0.01, zT + 0.04)); break;
  }

  // ---- aero.
  if (p.splitter !== "none") { const race = p.splitter === "race"; box(S, P.carbon, -hw * (race ? 1.04 : 1), g.ride - 0.03, L2 - 0.3, hw * (race ? 1.04 : 1), g.ride + 0.01, L2 + (race ? 0.16 : 0.08)); }
  if (p.diffuser) {
    box(S, P.carbon, -Math.min(hw * 0.8, backHalf - 0.04), g.ride - 0.02, -L2 - 0.08, Math.min(hw * 0.8, backHalf - 0.04), g.ride + 0.1, -L2 + 0.25);
    for (const k of [-0.5, 0, 0.5]) box(S, P.carbon, k * hw - 0.015, g.ride - 0.02, -L2 - 0.1, k * hw + 0.015, g.ride + 0.16, -L2 + 0.05);
  }
  if (p.skirts) both((s) => box(S, P.carbon, s * (hw - 0.02), g.ride - 0.04, g.rearAxle + car.wheels[1].radius + 0.05, s * (hw + 0.045), g.ride + 0.04, g.frontAxle - car.wheels[0].radius - 0.05));
  if (p.intakes !== "none") {
    const deep = p.intakes === "deep";
    both((s) => wedge(S, P.grille, s * (hw - 0.02), g.ride + hull * (deep ? 0.18 : 0.3), cabR - 0.1, s * (hw + 0.014), g.belt - 0.04, cabR + (deep ? 0.7 : 0.45), deep ? 0.1 : 0.25, "rear"));
  }
  const hoodY = (z: number): number => g.ride + hull * (noseLo + (1 - noseLo) * Math.max(0, Math.min(1, (L2 - z) / Math.max(0.1, L2 - cabF))));
  component(S, "hood", () => {
  switch (mechanicsOf(car).bay !== "closed" && mechanicsOf(car).location === "front" ? "none" : p.hood) {
    case "scoop": { const z0 = cabF + 0.1, z1 = Math.min(L2 - 0.3, z0 + 0.7); wedge(S, P.paint, -hw * 0.26, hoodY(z0) - 0.03, z0, hw * 0.26, hoodY(z0) + 0.12, z1, 0.1, "front"); box(S, P.grille, -hw * 0.19, hoodY(z0) + 0.01, z0 - 0.015, hw * 0.19, hoodY(z0) + 0.1, z0 + 0.01); break; }
    case "twin": both((s) => { const z0 = cabF + 0.15, z1 = Math.min(L2 - 0.3, z0 + 0.5); wedge(S, P.paint, s * hw * 0.12, hoodY(z0) - 0.03, z0, s * hw * 0.34, hoodY(z0) + 0.09, z1, 0.1, "front"); box(S, P.grille, s * hw * 0.15, hoodY(z0), z0 - 0.015, s * hw * 0.31, hoodY(z0) + 0.07, z0 + 0.01); }); break;
    case "shaker": { const z = cabF + Math.min(0.6, (L2 - cabF) * 0.35); box(S, P.dark, -hw * 0.22, hoodY(z) - 0.05, z - 0.18, hw * 0.22, hoodY(z) + 0.16, z + 0.18); box(S, P.grille, -hw * 0.18, hoodY(z) + 0.02, z + 0.17, hw * 0.18, hoodY(z) + 0.13, z + 0.2); break; }
    case "naca": both((s) => { const z = cabF + 0.35; box(S, P.grille, s * hw * 0.12, hoodY(z) - 0.02, z - 0.2, s * hw * 0.24, hoodY(z) + 0.012, z + 0.15); }); break;
  }
  });
  // (Stacks: pipes up from the chassis to their tops, where stackTops says -- the same place the smoke comes out.)
  // Exhaust stacks belong to the connected exhaust assembly below.
  if (p.roofScoop !== "none" && !p.open) {
    if (p.roofScoop === "airbox") { box(S, P.carbon, -0.1, g.roof - 0.01, zs - 0.6, 0.1, g.roof + 0.2, zs - 0.05); box(S, P.grille, -0.07, g.roof + 0.04, zs - 0.06, 0.07, g.roof + 0.17, zs - 0.03); }
    else { box(S, roofSlot, -0.14, g.roof - 0.01, zs - 0.35, 0.14, g.roof + 0.09, zs - 0.05); box(S, P.grille, -0.1, g.roof + 0.01, zs - 0.06, 0.1, g.roof + 0.07, zs - 0.035); }
  }
  if (p.roofRack && !p.open) {
    both((s) => cap(S, P.trim, [s * C2 * 0.85, g.roof + 0.06, zr + 0.05], [s * C2 * 0.85, g.roof + 0.06, zs - 0.05], 0.018));
    for (const t of [0.25, 0.5, 0.75]) { const z = zr + (zs - zr) * t; cap(S, P.trim, [-C2 * 0.85, g.roof + 0.07, z], [C2 * 0.85, g.roof + 0.07, z], 0.016); }
  }
  if (p.lightBar) {
    const y = (p.open || buggy ? g.belt + 0.7 : g.roof) + 0.07, z = p.open || buggy ? cabR + 0.1 : zs - 0.05;
    box(S, P.dark, -C2 * 0.9, y - 0.05, z - 0.06, C2 * 0.9, y + 0.03, z + 0.02);
    for (let i = 0; i < 5; i += 1) cap(S, P.light, [-C2 * 0.72 + (C2 * 1.44 * i) / 4, y, z + 0.02], [-C2 * 0.72 + (C2 * 1.44 * i) / 4, y, z + 0.05], 0.045);
  }
  if (p.cage !== "none") {
    const cy = g.belt + 0.62;
    const z0 = buggy ? cabR : p.bed ? cabR - 0.25 : cabR + 0.05, z1 = buggy ? cabF - 0.15 : z0;
    both((s) => cap(S, P.trim, [s * C2 * 0.95, g.belt, z0], [s * C2 * 0.85, cy, z0 + 0.1], 0.03));
    cap(S, P.trim, [-C2 * 0.85, cy, z0 + 0.1], [C2 * 0.85, cy, z0 + 0.1], 0.03);
    if (p.cage === "cage") {
      both((s) => { cap(S, P.trim, [s * C2 * 0.85, cy, z0 + 0.1], [s * C2 * 0.85, cy, z1 - 0.1], 0.03); cap(S, P.trim, [s * C2 * 0.85, cy, z1 - 0.1], [s * C2 * 0.95, g.belt, z1 + 0.15], 0.03); });
      cap(S, P.trim, [-C2 * 0.85, cy, z1 - 0.1], [C2 * 0.85, cy, z1 - 0.1], 0.03);
      cap(S, P.trim, [-C2 * 0.85, cy, z0 + 0.1], [C2 * 0.85, cy, z1 - 0.1], 0.022);
    }
  }
  if (p.fin) box(S, P.paint, -0.025, g.belt, -L2 + 0.05, 0.025, Math.max(g.roof, g.belt + 0.3), cabR - 0.1);
  if (p.snorkel && !buggy) { cap(S, P.dark, [C2 + 0.06, g.ride + hull * 0.6, cabF + 0.05], [C2 + 0.03, g.roof + 0.05, zs + 0.02], 0.045); cap(S, P.dark, [C2 + 0.03, g.roof + 0.05, zs + 0.02], [C2 + 0.03, g.roof + 0.08, zs + 0.15], 0.05); }

  // ---- spoilers.
  const deckY = g.ride + hull * Math.max(tailLo, 0.7);
  const wg = p.wing;
  switch (p.spoiler) {
    case "lip": box(S, P.wing, -backHalf * 0.9, backTop, -L2 + 0.02, backHalf * 0.9, backTop + 0.06, -L2 + 0.16); break;
    case "ducktail": wedge(S, P.wing, -backHalf * 0.95, backTop - 0.02, -L2 + 0.02, backHalf * 0.95, backTop + 0.16, -L2 + 0.42, 0.2, "front"); break;
    case "whale": wedge(S, P.wing, -backHalf * 0.98, backTop - 0.02, -L2 - 0.06, backHalf * 0.98, backTop + 0.2, -L2 + 0.55, 0.1, "front"); box(S, P.grille, -backHalf * 0.5, backTop + 0.05, -L2 + 0.35, backHalf * 0.5, backTop + 0.2, -L2 + 0.5); break;
    case "roof": if (!p.open) wedge(S, P.wing, -C2 - 0.01, g.roof - 0.04, zr - 0.3, C2 + 0.01, g.roof + 0.02, zr + 0.05, 0.2, "rear"); break;
    case "wing": case "bigwing": case "swan": {
      const big = p.spoiler !== "wing";
      const wy = Math.max(deckY + wg.height * (big ? 1.5 : 1), big ? g.roof - 0.05 : 0);
      const ww = hw * wg.span * (big ? 1.06 : 0.92);
      const wz0 = -L2 + 0.02, wz1 = wz0 + wg.chord * (big ? 1.2 : 1);
      if (p.spoiler === "swan") both((s) => { cap(S, P.carbon, [s * ww * 0.45, deckY, wz1 + 0.05], [s * ww * 0.45, wy + 0.2, wz1 - 0.05], 0.022); cap(S, P.carbon, [s * ww * 0.45, wy + 0.2, wz1 - 0.05], [s * ww * 0.45, wy + 0.05, wz0 + 0.1], 0.022); });
      else both((s) => cap(S, P.carbon, [s * ww * 0.55, deckY, wz1 - 0.06], [s * ww * 0.55, wy, wz1 - 0.12], 0.025));
      box(S, P.wing, -ww, wy, wz0, ww, wy + 0.045, wz1);
      if (car.paints.wingAccent) box(S, P.accent, -ww, wy + 0.045, wz1 - 0.07, ww, wy + 0.062, wz1);
      both((s) => box(S, P.carbon, s * ww, wy - wg.plate * 0.6, wz0 - 0.02, s * (ww + 0.025), wy + wg.plate * 0.5, wz1 + 0.02));
      break;
    }
  }

  fitMechanics(S, car);
  // The underside, dark: hides the ground seen between the wheels from low angles.
  box(S, P.dark, -hw * 0.9, Math.max(0.02, g.ride - 0.04), wr.z1, hw * 0.9, g.ride + 0.02, wf.z0);
  return S;
}

/** Cut real coachwork around the generated engine, keeping four painted rails and a rolled metal lip. */
function enginePanel(S: Solids, car: Car, panel: "hood" | "trunk", half: number, start: number, end: number, top: (z: number) => number): void {
  const m = mechanicsOf(car), slot = BODY_SLOT[panel];
  component(S, panel, () => {
    if (m.bay === "closed" || panel !== (m.location === "front" ? "hood" : "trunk")) { sheet(S, slot, half, start, end, top); return; }
    const hole = Math.min(half - .06, m.engine.width / 2 + .095), a = Math.max(start + .04, m.engine.z - m.engine.length / 2 - .065), b = Math.min(end - .04, m.engine.z + m.engine.length / 2 + .075);
    sheet(S, slot, half, start, a, top); sheet(S, slot, half, b, end, top);
    for (const side of [-1, 1]) {
      const strip = solids(); sheet(strip, slot, (half - hole) / 2, a, b, top);
      for (const w of strip.wedges) S.wedges.push({ ...w, c: [side * (half + hole) / 2, w.c[1]!, w.c[2]!] });
      cap(S, BODY_SLOT.metal, [side * hole, top(a), a], [side * hole, top(b), b], .014);
    }
    for (const z of [a, b]) cap(S, BODY_SLOT.metal, [-hole, top(z), z], [hole, top(z), z], .014);
  });
}

/** The damage layout reads the same solids the body owns. */
export const mechanicalBounds = (car: Car) => componentBounds(car.parts.semi ? bodySolids(car) : mechanicalSolids(car, exhaustTips(car)));
function fitMechanics(S: Solids, car: Car): void {
  const assembly = mechanicalSolids(car, exhaustTips(car));
  S.boxes.push(...assembly.boxes); S.wedges.push(...assembly.wedges); S.capsules.push(...assembly.capsules);
  const names = S.components ??= new Map();
  for (const [solid, name] of assembly.components ?? []) names.set(solid, name);
}

/** An FNV hash of a string, as base-36 (a design key's compact tail). */
const fnv = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36); };

/** Everything that shapes a body (its measurements and part forms), as a key: bodies that land on the same values share a bake. */
export function geometryKey(car: Car): string {
  return `${car.archetype}.${fnv(JSON.stringify([car.body, car.parts, car.wheels.map((w) => [w.radius, w.width]), mechanicsOf(car), car.paints.wingAccent, car.paints.neon?.under ? car.paints.neon.run : ""]))}`;
}

/**
 * The car's body as a bake shape (one still clip; keyed by its geometry and parts, never its colours or decals) --
 * everything but the glass, which is its own layer (glassDesign), drawn over the body see-through, so the cabin shows.
 */
export function bodyDesign(car: Car): VehicleDesign {
  return partDesign(car, "body", (mat) => mat !== BODY_SLOT.glass && mat !== BODY_SLOT.screen);
}
/** The car's glass as a bake shape: the windscreen, side and rear glass (a glass roof), drawn after the body, see-through. */
export function glassDesign(car: Car): VehicleDesign {
  return partDesign(car, "glass", (mat) => mat === BODY_SLOT.glass || mat === BODY_SLOT.screen);
}
function partDesign(car: Car, part: string, keep: (mat: number) => boolean): VehicleDesign {
  const all = bodySolids(car);
  const S: Solids = { boxes: all.boxes.filter((b) => keep(b.mat ?? 0)), wedges: all.wedges.filter((b) => keep(b.mat ?? 0)), capsules: all.capsules.filter((c) => keep(c.mat ?? 0)) };
  const world: BakeWorld = { boxes: S.boxes, wedges: S.wedges, capsules: S.capsules };
  let height = 0, radius = 0;
  for (const b of [...S.boxes, ...S.wedges]) {
    height = Math.max(height, (b.c[1] ?? 0) + (b.h[1] ?? 0));
    radius = Math.max(radius, dhypot(Math.abs(b.c[0] ?? 0) + (b.h[0] ?? 0), Math.abs(b.c[2] ?? 0) + (b.h[2] ?? 0)));
  }
  for (const c of S.capsules) for (const q of [c.a, c.b]) { height = Math.max(height, (q[1] ?? 0) + c.r); radius = Math.max(radius, dhypot(q[0] ?? 0, q[2] ?? 0) + c.r); }
  const components = [...S.boxes, ...S.wedges, ...S.capsules].map(s => all.components?.get(s) ?? null);
  return { components, key: `packs/vehicles:${part}:cabin-v3:${geometryKey(car)}`, clips: [{ name: "still", frames: 1 }], height: r3(Math.max(0.2, height) + 0.05), radius: r3(Math.max(0.2, radius) + 0.05), pose: () => world };
}

/**
 * A panel's face as a decal sees it: which face of its solid the decal reads on, the face's size in metres along its
 * u and v, which side of the car it's on, whether its u runs toward the car's front (a side face), and the flips that
 * make a picture READ from outside (text not mirrored; on a top face, read from behind). decals.ts sizes, flips and
 * orients decals by it -- a directional one (flames, teeth) runs toward the front on both sides instead.
 */
export interface PanelFace { readonly face: "side" | "top" | "front" | "back"; readonly u: number; readonly v: number; readonly side: -1 | 0 | 1; readonly uFront: boolean; readonly readU: boolean; readonly readV: boolean }

export function panelFace(car: Car, panel: Panel): PanelFace {
  const f = carPanelFace(car, panel);
  return car.parts.semi ? { ...f, ...semiFace(car, panel) } : f;
}
function carPanelFace(car: Car, panel: Panel): PanelFace {
  // (A box's side face runs u along +z; a wedge turned for the rear runs it along -z. Seen from the right, the front
  // is on the right of the picture; seen from the left, on the left.)
  const g = car.body;
  const L2 = g.length / 2, hull = g.belt - g.ride;
  const hw = car.archetype === "buggy" ? g.width * 0.31 : g.width / 2;
  const st = Math.min(g.strip, hw * 0.4);
  const W = wellsOf(car), doors = doorsOf(car);
  const bed = car.parts.bed;
  const sideFace = (u: number, v: number, side: -1 | 1, uFront: boolean): PanelFace => ({ face: "side", u, v, side, uFront, readU: side > 0 ? !uFront : uFront, readV: false });
  switch (panel) {
    case "doorL": return sideFace(doors.front - doors.rear, hull, -1, true);
    case "doorR": return sideFace(doors.front - doors.rear, hull, 1, true);
    case "fenderFL": return sideFace(L2 - doors.front, g.belt - W.front.top, -1, true);
    case "fenderFR": return sideFace(L2 - doors.front, g.belt - W.front.top, 1, true);
    case "quarterL": return sideFace(L2 + g.cabRear, (bed ? g.belt + 0.34 : g.belt) - W.rear.top, -1, bed);
    case "quarterR": return sideFace(L2 + g.cabRear, (bed ? g.belt + 0.34 : g.belt) - W.rear.top, 1, bed);
    case "hood": return { face: "top", u: 2 * (hw - st), v: L2 - g.cabFront, side: 0, uFront: false, readU: false, readV: false };
    case "trunk": return bed ? { face: "back", u: 2 * (hw - 0.07), v: hull + 0.34, side: 0, uFront: false, readU: false, readV: false } : { face: "top", u: 2 * (hw - st), v: L2 + g.cabRear, side: 0, uFront: false, readU: true, readV: true };
    case "roof": return { face: "top", u: g.cabWidth * 0.8, v: Math.max(0.2, g.cabFront - g.screenRun - g.cabRear - g.rearRun), side: 0, uFront: false, readU: false, readV: false };
    case "bumperF": return { face: "front", u: hw * 1.9, v: Math.min(0.2, hull * 0.42) + 0.03, side: 0, uFront: false, readU: true, readV: false };
    case "bumperR": return { face: "back", u: hw * 1.9, v: Math.min(0.2, hull * 0.42) + 0.03, side: 0, uFront: false, readU: false, readV: false };
  }
}

// ---------------------------------------------------------------- wheels

/**
 * A wheel's solids at a spin phase (radians the spokes have turned, rolling forward). What reads at pixel scale: a
 * dark tyre ring, a bright rim FACE, and dark WINDOWS in it between the spokes -- the windows turn, so the wheel rolls.
 * Each rim style is its windows' shape and count (thin between five spokes, a split pair, a star's triangles, a
 * mesh's dots, a turbofan's curves, a dish's small holes, a wire wheel's many slits); a deep dish sets its face back
 * behind a wide lip; a steelie is a plain disc with holes and a big cap.
 */
function wheelSolids(w: WheelSpec, phase: number): Solids {
  const S = solids();
  const Wl = WHEEL_SLOT;
  const R = w.radius;
  const th = Math.max(0.062, R * w.sidewall); // (the sidewall: tyre from rim to tread -- never a band round a bare rim)
  const rimR = R - th;
  const half = w.width / 2;
  // (A point at radius r and angle a from the top, rolling toward +z; x across the axle.)
  const at = (x: number, r: number, a: number): [number, number, number] => [x, R + r * dcos(a), r * dsin(a)];
  const ring = (slot: number, x: number, r: number, cr: number, seg: number, turn = 0): void => {
    for (let i = 0; i < seg; i += 1) cap(S, slot, at(x, r, turn + (i / seg) * TAU), at(x, r, turn + ((i + 1) / seg) * TAU), cr);
  };

  // The tyre: rings of capsules round the axle, as many across as its width takes (static: a tyre looks the same turned).
  const ringR = th / 2;
  const rings = Math.max(2, Math.min(3, Math.ceil(w.width / (ringR * 1.5))));
  for (let k = 0; k < rings; k += 1) ring(Wl.tyre, -half + ringR + ((w.width - 2 * ringR) * k) / (rings - 1), R - ringR, ringR, 20);
  // Tread: blocks turning with it -- chunky on a knobby, fine on a street tyre, none on a slick.
  if (w.tyre === "knobby") for (let i = 0; i < w.lugs; i += 1) { const a = phase + (i / w.lugs) * TAU; cap(S, Wl.tread, at(-half * 0.55, R - 0.012, a), at(half * 0.55, R - 0.012, a), R * 0.07); }
  else if (w.lugs > 0) for (let i = 0; i < w.lugs; i += 1) { const a = phase + (i / w.lugs) * TAU; cap(S, Wl.tread, at(-half * 0.7, R - 0.02, a), at(half * 0.7, R - 0.02, a + 0.05), R * 0.035); }
  // The sidewall's white ring or raised letters (static).
  if (w.tyre === "whitewall") both((s) => ring(Wl.wall, s * (half - 0.006), rimR + th * 0.42, th * 0.2, 16));
  if (w.tyre === "letters") both((s) => { for (let i = 0; i < 10; i += 1) { const a = (i / 10) * TAU; cap(S, Wl.wall, at(s * (half - 0.004), rimR + th * 0.5, a), at(s * (half - 0.004), rimR + th * 0.5, a + 0.14), th * 0.1); } });

  const deep = w.rim === "deepdish";
  both((s) => {
    // The rim's lip, and its face (a disc of rings) set back by the dish.
    const lipR = Math.max(0.014, rimR * (deep ? 0.14 : 0.08));
    ring(Wl.rim, s * (half - lipR), rimR - lipR * 0.3, lipR, 16);
    const xf = s * (half - Math.max(w.dish, lipR * 1.4));
    const cr = rimR * 0.2;
    ring(Wl.rim, xf, rimR * 0.78, cr, 14);
    ring(Wl.rim, xf, rimR * 0.4, cr, 8);
    // The windows, a hair proud of the face, turning.
    const xw = xf + s * (cr + 0.004);
    const n = w.spokes;
    const gap = (TAU * rimR * 0.6) / n; // (the arc between two spokes at 60 % out)
    for (let i = 0; i < n; i += 1) {
      const a = phase + ((i + 0.5) / n) * TAU;
      switch (w.rim) {
        case "spoke": case "deepdish": cap(S, Wl.barrel, at(xw, rimR * 0.4, a), at(xw, rimR * 0.76, a), Math.min(rimR * 0.13, gap * 0.28)); break;
        case "split": cap(S, Wl.barrel, at(xw, rimR * 0.42, a), at(xw, rimR * 0.76, a), Math.min(rimR * 0.1, gap * 0.2)); cap(S, Wl.barrel, at(xw, rimR * 0.55, a + Math.PI / n), at(xw, rimR * 0.76, a + Math.PI / n), rimR * 0.035); break;
        case "star": cap(S, Wl.barrel, at(xw, rimR * 0.36, a), at(xw, rimR * 0.78, a - gap * 0.35 / rimR), rimR * 0.08); cap(S, Wl.barrel, at(xw, rimR * 0.36, a), at(xw, rimR * 0.78, a + gap * 0.35 / rimR), rimR * 0.08); break;
        case "monoblock": cap(S, Wl.barrel, at(xw, rimR * 0.5, a), at(xw, rimR * 0.68, a), Math.min(rimR * 0.2, gap * 0.36)); break;
        case "turbofan": cap(S, Wl.barrel, at(xw, rimR * 0.34, a), at(xw, rimR * 0.78, a + 0.55), rimR * 0.07); break;
        case "mesh": for (const r of [0.45, 0.72]) cap(S, Wl.barrel, at(xw, rimR * r, a), at(xw, rimR * r, a), rimR * 0.075); break;
        case "wire": cap(S, Wl.barrel, at(xw, rimR * 0.34, a), at(xw, rimR * 0.8, a + 0.3), rimR * 0.028); break;
        case "dish": case "steelie": cap(S, Wl.barrel, at(xw, rimR * 0.6, a), at(xw, rimR * 0.6, a), rimR * (w.rim === "steelie" ? 0.09 : 0.11)); break;
      }
    }
    // The hub: a cap, bigger on a steelie; a centre that catches the light.
    const hubR = rimR * (w.rim === "steelie" ? 0.34 : 0.18);
    cap(S, Wl.hub, [xw - s * 0.008, R, 0], [xw + s * 0.004, R, 0], hubR);
    cap(S, Wl.caliper, at(xw + s * 0.006, hubR * 0.45, phase), at(xw + s * 0.006, hubR * 0.45, phase), hubR * 0.28);
  });
  return S;
}

/**
 * A spinner: the blades that sit over the hub and keep turning after the car stops (the Spinner site). Its own design,
 * so the game can turn it at its own rate -- drawn at the wheel's hub, on the wheel's own paint.
 */
export function spinnerDesign(w: WheelSpec): VehicleDesign | null {
  if (w.spinner === "none") return null;
  const key = `packs/vehicles:spinner:${w.spinner}.${w.spokes}.${Math.round(w.radius * 100)}.${Math.round(w.width * 100)}.${w.size}`;
  const R = w.radius, rimR = R - Math.max(0.045, R * w.sidewall);
  const blades = w.spinner === "knockoffs" ? 3 : w.spinner === "floaters" ? Math.max(3, Math.min(6, w.spokes)) : Math.max(3, Math.min(8, w.spokes));
  const reach = w.spinner === "knockoffs" ? rimR * 0.5 : rimR * 0.82;
  const x = w.width / 2 - Math.max(w.dish, 0.02) + 0.01;
  const world: BakeWorld = (() => {
    const S = solids();
    const at = (r: number, a: number): V3 => [x, R + r * dcos(a), r * dsin(a)];
    both((sd) => {
      for (let i = 0; i < blades; i += 1) {
        const a = (i / blades) * TAU;
        cap(S, WHEEL_SLOT.spinner, [sd * x, R, 0], at(reach, a).map((v, k) => (k === 0 ? sd * x : v)) as unknown as V3, Math.min(rimR * 0.1, 0.035));
      }
      cap(S, WHEEL_SLOT.spinner, [sd * x, R, 0], [sd * (x + 0.02), R, 0], rimR * 0.18);
    });
    return { boxes: S.boxes, wedges: S.wedges, capsules: S.capsules };
  })();
  return { key, clips: [{ name: "still", frames: 1 }], height: r3(2 * R), radius: r3(dhypot(R, w.width / 2)), pose: () => world };
}

/**
 * Where a nitrous shot's flame leaves a car (car frame: +z front, +x right), and which way it blows (dx, dy, dz). At the
 * tail's pipes, in one stream or two; side pipes keep their side, blowing from their tail end; a truck's stacks fire
 * straight up out of their tops, where the pipes visibly end.
 */
export function exhaustTips(car: Car): Array<{ x: number; y: number; z: number; dz: number; dx: number; dy: number; r: number }> {
  const g = car.body, p = car.parts, L2 = g.length / 2, hull = g.belt - g.ride;
  // (Inside the back panel's corners, wherever the tail is rounded.)
  const TE = tailEndOf(car), hw = TE.depth > 0.02 && !p.bed ? Math.min(g.width / 2, TE.at((TAIL_SLICES - 0.5) / TAIL_SLICES).half + 0.06) : g.width / 2;
  const zBack = -L2 - 0.04;
  const tip = (x: number, y: number, r: number, z = zBack, dx = 0, dz = -1, dy = 0) => ({ x, y, z, dz, dx, dy, r });
  const low = g.ride + 0.06;
  switch (p.exhaust) {
    case "single": return [tip(p.exhaustSide * hw * 0.6, low, p.pipe)];
    case "twin": return [tip(-hw * 0.6, low, p.pipe), tip(hw * 0.6, low, p.pipe)];
    // (Four pipes are two pairs: two streams, one a side, or they read as noise.)
    case "quad": return [tip(-hw * 0.61, low, p.pipe), tip(hw * 0.61, low, p.pipe)];
    case "center": return [tip(0, g.ride + hull * 0.35, p.pipe * 1.2)];
    // (Side pipes keep their side, but blow from the tail end of them, back and a little out.)
    case "side": return [-1, 1].map((s) => tip(s * (g.width / 2 + 0.06), g.ride + 0.05, p.pipe, -L2 + 0.3, s * 0.5, -0.86));
    // (Stacks fire straight up out of their tops -- a truck on nitrous is two pillars of flame over the cab.)
    case "stacks": return stackTops(car).map((t) => tip(t.x, t.y + 0.02, t.r, t.z, 0, -0.25, 1));
    default: return [tip(p.exhaustSide * hw * 0.55, low, Math.max(0.03, p.pipe))];
  }
}

/**
 * The tops of a truck's exhaust stacks (car frame), and their radius -- what they're drawn up to and where their smoke
 * comes out. Empty for a car without stacks.
 */
export function stackTops(car: Car): Array<{ x: number; y: number; z: number; r: number }> {
  const g = car.body, p = car.parts;
  if (p.semi) return semiStacks(car);
  if (p.exhaust !== "stacks") return [];
  const hw = car.archetype === "buggy" ? (g.width / 2) * 0.62 : g.width / 2;
  const z = p.bed ? g.cabRear - 0.12 : g.cabFront + 0.25, x = p.bed ? hw * 0.8 : hw * 0.25, y = (p.bed ? g.roof : g.belt) + 0.25;
  return [-1, 1].map((s) => ({ x: s * x, y, z, r: p.pipe * 1.2 }));
}

/** The spin clip: SPIN_FRAMES frames over one spoke's turn. */
export const WHEEL_CLIPS: readonly ClipSpec[] = [{ name: "spin", frames: SPIN_FRAMES, loop: true }];

/** The angle one spin clip covers (a spoke's turn). */
export const spinPeriod = (w: WheelSpec): number => TAU / w.spokes;

/** A wheel shape as a bake design: the spin clip, keyed by its shape alone (cars with the same wheels share it). */
export function wheelDesign(w: WheelSpec): VehicleDesign {
  const key = `packs/vehicles:wheel:${w.rim}.${w.tyre}.${w.spokes}.${w.lugs}.${Math.round(w.radius * 100)}.${Math.round(w.width * 100)}.${Math.round(w.sidewall * 100)}.${Math.round(w.dish * 100)}`;
  const period = spinPeriod(w);
  const cache = new Map<number, BakeWorld>();
  return {
    key, clips: WHEEL_CLIPS, height: r3(2 * w.radius + 0.04), radius: r3(dhypot(w.radius, w.width / 2) + 0.04),
    pose: (_clip, frame) => {
      let world = cache.get(frame);
      if (!world) { const S = wheelSolids(w, (frame / SPIN_FRAMES) * period); world = { boxes: S.boxes, wedges: S.wedges, capsules: S.capsules }; cache.set(frame, world); }
      return world;
    },
  };
}

/** The spin frame a wheel shows after rolling `turn` radians. */
export function spinFrame(w: WheelSpec, turn: number): number {
  const period = spinPeriod(w);
  const f = Math.floor((((turn % period) + period) % period) / period * SPIN_FRAMES);
  return Math.min(SPIN_FRAMES - 1, f);
}
