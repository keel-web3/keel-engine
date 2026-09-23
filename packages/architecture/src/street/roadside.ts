// The roadside's infrastructure, piece by piece, each in its own frame (+z the
// way it faces, or -- for a line's pylons and poles -- along the line): lattice
// transmission pylons and the steel poles that carry a line in along the roads,
// wooden utility poles with their crossarms and transformer cans, a highway
// sign gantry, a guard rail's run, a sound wall's panel, a billboard on its
// monopole (a V of two faces, each an ad slot), a radio mast with its beacons, a
// speed sign and a traffic camera. Mostly boxes (twelve triangles each); the
// lattice's slanting members and the wires are thin capsules. Each returns its
// collision radius and, for what carries wires, where the wires hang (its frame).

import { dcos, dsin } from "@keel-engine/core";
import { addAd, addBox, addCapsule, subPlacer, toWorld, placerAt } from "../frame.ts";
import { drawsFor } from "@keel-engine/city";
import type { Placer } from "../frame.ts";
import type { Lod, Solid } from "../types.ts";
import type { StreetSlotName } from "../slots.ts";

export type Hook = readonly [number, number, number];

/**
 * A lattice transmission pylon `H` m tall: four legs spread at the foot drawing in to a waist, the body on up to the
 * peak, zig-zag bracing on every face, two cross-arms (the lower wider) with an insulator string hanging at each end,
 * and the earth wire's little arm on top. +x across the line (the arms), +z along it.
 */
export function pylon(p: Placer, H: number): { r: number; hooks: Hook[] } {
  const b0 = H * 0.1, yW = H * 0.62, b1 = 1.05, yT = H - 2, b2 = 0.5;
  /** Half the body's width at a height (the taper: foot to waist, waist to top). */
  const hw = (y: number): number => (y <= yW ? b0 + ((b1 - b0) * (y + 0.6)) / (yW + 0.6) : b1 + ((b2 - b1) * (y - yW)) / (yT - yW));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addCapsule(p, 2, [sx * (b0 + 0.06), -0.6, sz * (b0 + 0.06)], [sx * b1, yW, sz * b1], 0.2, "pole");
    addCapsule(p, 2, [sx * b1, yW, sz * b1], [sx * b2, yT, sz * b2], 0.15, "pole");
  }
  // (Bracing: a zig-zag down each face, a square of struts at the waist.)
  const levels = [0.4, yW / 2, yW, yT];
  for (let k = 0; k + 1 < levels.length; k += 1) {
    const y0 = levels[k]!, y1 = levels[k + 1]!, h0 = hw(y0), h1 = hw(y1), z = k % 2 ? 1 : -1;
    for (const f of [-1, 1]) {
      addCapsule(p, 1, [f * h0, y0, -z * h0], [f * h1, y1, z * h1], 0.07, "pole");
      addCapsule(p, 1, [-z * h0, y0, f * h0], [z * h1, y1, f * h1], 0.07, "pole");
    }
  }
  for (const f of [-1, 1]) {
    addBox(p, 1, 0, yW, f * b1, b1, 0.07, 0.07, "pole");
    addBox(p, 1, f * b1, yW, 0, 0.07, 0.07, b1, "pole");
  }
  // The cross-arms, each with its ties back to the body and an insulator string at each end.
  const hooks: Hook[] = [];
  const arms: [number, number][] = [[yW + 0.8, H * 0.23], [H * 0.83, H * 0.16]];
  for (const [y, L] of arms) {
    addBox(p, 2, 0, y, 0, L, 0.28, 0.55, "pole");
    for (const f of [-1, 1]) {
      addCapsule(p, 1, [f * hw(y + 2.6), y + 2.6, 0], [f * (L - 0.3), y + 0.2, 0], 0.07, "pole");
      addBox(p, 1, f * (L - 0.3), y - 1.35, 0, 0.13, 1.05, 0.13, "shelterGlass");
      hooks.push([f * (L - 0.3), y - 2.45, 0]);
    }
  }
  addBox(p, 2, 0, yT + 1, 0, 0.45, 1, 0.45, "pole");
  addBox(p, 1, 0, yT + 1.8, 0, 1.6, 0.12, 0.25, "pole");
  return { r: b0 + 0.25, hooks };
}

/**
 * A tubular steel transmission pole (what carries a line in along the city's roads, where a pylon's foot won't fit):
 * the tapering pole and three davit arms, all out over the pavement (+x, toward the road -- never over the lots behind),
 * each with its insulator. +z along the line.
 */
export function steelPole(p: Placer, H: number): { r: number; hooks: Hook[] } {
  addBox(p, 2, 0, H * 0.3, 0, 0.36, H * 0.3, 0.36, "pole");
  addBox(p, 2, 0, H * 0.8, 0, 0.26, H * 0.2, 0.26, "pole");
  const hooks: Hook[] = [];
  ([[H - 1, 2.4], [H - 3.6, 1.5], [H - 6.2, 2.4]] as const).forEach(([y, x]) => {
    addBox(p, 1, x / 2 + 0.1, y, 0, x / 2 + 0.1, 0.12, 0.12, "pole");
    addBox(p, 1, x, y - 0.8, 0, 0.1, 0.7, 0.1, "shelterGlass");
    hooks.push([x, y - 1.5, 0]);
  });
  return { r: 0.45, hooks };
}

/**
 * A wooden utility pole `H` m tall, its frame's +z toward the road: the pole, a crossarm across the pavement with its
 * three pins, and (if `can`) a transformer can hung on the back. The wires hang from the pins.
 */
export function utilityPole(p: Placer, H: number, can: boolean): { r: number; hooks: Hook[] } {
  addBox(p, 1, 0, H / 2 - 0.3, 0, 0.13, H / 2 + 0.3, 0.13, "wood");
  addBox(p, 1, 0, H - 0.55, 0.2, 0.07, 0.07, 1.1, "wood");
  const hooks: Hook[] = [];
  for (const z of [-0.75, 0.35, 1.2]) {
    addBox(p, 0, 0, H - 0.38, z, 0.06, 0.1, 0.06, "shelterGlass");
    hooks.push([0, H - 0.3, z]);
  }
  if (can) {
    addBox(p, 0, 0, H - 2.3, -0.42, 0.3, 0.48, 0.3, "frame");
    addBox(p, 0, 0, H - 1.75, -0.42, 0.33, 0.05, 0.33, "housing");
  }
  return { r: 0.2, hooks };
}

/** Wire between two points (world): a catenary as `segs` thin capsules, sagging `sag` m at its middle. */
export function wire(p: Placer, lod: Lod, a: Hook, b: Hook, sag: number, segs: number, r: number, slot: StreetSlotName = "housing"): void {
  let prev: Hook = a;
  for (let k = 1; k <= segs; k += 1) {
    const t = k / segs, drop = 4 * sag * t * (1 - t);
    const q: Hook = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - drop, a[2] + (b[2] - a[2]) * t];
    addCapsule(p, lod, prev, q, r, slot);
    prev = q;
  }
}

/** A hook of a piece (its frame) in the world. */
export const hookAt = (p: Placer, h: Hook): Hook => toWorld(p, h[0], h[1], h[2]);

/**
 * A sign gantry across a highway, its frame on the centre line (+z along the road): a leg `reach` m out on either
 * side, a box truss across at 6.5-7.9 m, and a green direction board over each carriageway -- the right one facing the
 * traffic coming up the road (-z), the left facing the traffic coming down it. Returns the boards' faces (frame).
 */
export function gantry(p: Placer, reach: number, half: number): { boards: { x: number; y: number; z: number; w: number; h: number; facing: 1 | -1 }[] } {
  for (const f of [-1, 1]) {
    addBox(p, 1, f * reach, 3.95, 0.4, 0.22, 3.95, 0.22, "frame");
    addBox(p, 0, f * reach, 0.25, 0.4, 0.5, 0.25, 0.6, "plinth");
  }
  for (const y of [6.55, 7.85]) for (const z of [0, 0.8]) addBox(p, 1, 0, y, z, reach + 0.2, 0.07, 0.07, "frame");
  // (The truss's web: a zig-zag down each face, as thin rods.)
  const n = Math.max(4, Math.round((2 * reach) / 2.4));
  for (let k = 0; k < n; k += 1) {
    const x0 = -reach + (2 * reach * k) / n, x1 = -reach + (2 * reach * (k + 1)) / n, lo = k % 2 ? 7.85 : 6.55, hi = k % 2 ? 6.55 : 7.85;
    for (const z of [0, 0.8]) addCapsule(p, 0, [x0, lo, z], [x1, hi, z], 0.04, "frame");
  }
  const w = Math.min(3.6, half * 0.47), boards: { x: number; y: number; z: number; w: number; h: number; facing: 1 | -1 }[] = [];
  for (const f of [-1, 1] as const) {
    // (The right half's board faces up the road (-z), hung on the truss's near face; the left's faces down it.)
    const x = f * (half / 2), z = f > 0 ? -0.2 : 1.0, face = f > 0 ? -1 : 1;
    addBox(p, 1, x, 7.2, z, w, 0.8, 0.06, "binGreen");
    addBox(p, 0, x, 7.2, z + face * 0.07, w - 0.12, 0.72, 0.01, "frame");
    addBox(p, 0, x, 7.2, z + face * 0.08, w - 0.2, 0.64, 0.01, "binGreen");
    // (The lettering: two lines, lit by the gantry's lamps at night.)
    for (const [dy, len] of [[0.22, 0.75], [-0.18, 0.5]] as const) addBox(p, 0, x - w * (1 - len) * 0.6, 7.2 + dy, z + face * 0.1, w * len * 0.8, 0.09, 0.01, "adPanel");
    // (The exit's tab on top.)
    addBox(p, 1, x + w - 0.8, 8.25, z, 0.7, 0.25, 0.05, "binGreen");
    boards.push({ x, y: 7.2, z: z + face * 0.11, w: 2 * w, h: 1.6, facing: face as 1 | -1 });
  }
  return { boards };
}

/** A guard rail's length (its frame at the middle, +z along it, +x toward the road): the W-beam and a post behind it at each end. */
export function railRun(p: Placer, len: number): void {
  addBox(p, 1, 0, 0.62, 0, 0.08, 0.17, len / 2, "frame");
  for (const z of [-len / 2 + 0.1, len / 2 - 0.1]) addBox(p, 0, -0.14, 0.4, z, 0.07, 0.4, 0.07, "pole");
}

/** A sound wall's panel (its frame at the middle, +z along it, +x toward the road): the panel, an H-pile, the coping. */
export function wallPanel(p: Placer, len: number, h: number): void {
  addBox(p, 2, 0, h / 2 - 0.3, 0, 0.14, h / 2 + 0.3, len / 2, "plinth");
  addBox(p, 1, 0.1, h / 2, -len / 2 + 0.1, 0.18, h / 2 + 0.1, 0.12, "frame");
  addBox(p, 0, 0, h + 0.05, 0, 0.2, 0.06, len / 2, "paving");
}

/**
 * A billboard on its monopole, its frame's +z toward the road: two lit faces in a V, the apex toward the road, each
 * turned to the traffic from one way and each an ad slot; a catwalk under each. Returns the pole's radius.
 */
export function billboard(p: Placer, id: string, pole: number, w: number, h: number): number {
  addBox(p, 2, 0, pole / 2, -1.2, 0.4, pole / 2, 0.4, "pole");
  const turn = 0.32, y = pole + h / 2 + 0.3;
  addBox(p, 1, 0, pole + 0.15, -1.2, 0.5, 0.15, 0.5, "frame");
  for (const f of [-1, 1]) {
    const cx = f * (w / 2) * dcos(turn), cz = -(w / 2) * dsin(turn);
    const face = subPlacer(p, cx, cz, -f * turn);
    addBox(face, 2, 0, y, 0, w / 2, h / 2, 0.12, "adPanel");
    addBox(face, 1, 0, y, -0.18, w / 2 + 0.1, h / 2 + 0.1, 0.06, "frame");
    addBox(face, 0, 0, pole + 0.22, 0.4, w / 2, 0.04, 0.4, "frame");
    addAd(face, `${id}:${f < 0 ? "a" : "b"}`, "billboard", 0, y, 0.14, w, h);
  }
  return 0.45;
}

/**
 * A radio mast `H` m tall on its three-legged lattice, tapering to the top: bracing, a platform with its antenna
 * panels and a dish, and red aircraft beacons at the top and halfway up (they burn at night).
 */
export function radioMast(p: Placer, H: number): number {
  const r0 = 2.4, r1 = 0.55, at = (k: number, rad: number, y: number): Hook => [rad * dsin((k * 2 * Math.PI) / 3), y, rad * dcos((k * 2 * Math.PI) / 3)];
  const rad = (y: number): number => r0 + ((r1 - r0) * y) / H;
  for (let k = 0; k < 3; k += 1) addCapsule(p, 2, at(k, r0, -0.5), at(k, r1, H), 0.16, "pole");
  const n = 6;
  for (let i = 0; i < n; i += 1) {
    const y0 = (H * i) / n, y1 = (H * (i + 1)) / n;
    for (let k = 0; k < 3; k += 1) addCapsule(p, 1, at(k, rad(y0), y0), at((k + 1) % 3, rad(y1), y1), 0.06, "pole");
  }
  addBox(p, 1, 0, H * 0.72, 0, rad(H * 0.72) + 0.5, 0.08, rad(H * 0.72) + 0.5, "frame");
  for (let k = 0; k < 3; k += 1) {
    const [x, , z] = at(k, rad(H * 0.8) + 0.35, 0);
    addBox(p, 1, x, H * 0.8, z, 0.3, 1.2, 0.3, "frame", { turn: (k * 2 * Math.PI) / 3 });
  }
  addBox(p, 0, 0, H * 0.62, rad(H * 0.62) + 0.4, 0.7, 0.7, 0.15, "sculpture");
  addBox(p, 2, 0, H + 1.6, 0, 0.12, 1.6, 0.12, "pole");
  addBox(p, 2, 0, H + 3.3, 0, 0.3, 0.25, 0.3, "signalRed");
  addBox(p, 1, 0, H * 0.5, 0, rad(H * 0.5) + 0.2, 0.2, 0.2, "signalRed");
  return r0 + 0.25;
}

/** A speed-limit sign on its post, its frame's +z toward the traffic that reads it. */
export function speedSign(p: Placer, limit = 90): number { return trafficSign(p, "speed", limit); }

export type TrafficSignKind = "speed" | "stop" | "yield" | "no-entry" | "one-way" | "crossing" | "bend" | "parking" | "no-parking" | "merge" | "chevron";
export interface TrafficSignOptions { readonly variant?: number; readonly direction?: -1 | 1 }
/** A reproducible sign recipe, retained on generated props for editors and destruction inspection. */
export interface TrafficSignSpec { readonly kind: TrafficSignKind; readonly limit: number; readonly variant: number; readonly direction: -1 | 1; readonly road?: number }
export function trafficSignSolids(kind: TrafficSignKind, limit = 50, x = 0, y = 0, z = 0, yaw = 0, options: TrafficSignOptions = {}): Solid[] {
  const solids: Solid[] = [];
  trafficSign(placerAt(drawsFor("traffic", `${kind}:${x}:${z}`), x, z, yaw, solids, [], [], y), kind, limit, options);
  return solids;
}
const GLYPHS: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
  "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
  S: "111100111001111", T: "111010010010010", O: "111101101101111", P: "110101110100100",
};
const signVariant = (v: number): number => Math.abs(Math.trunc(Number.isFinite(v) ? v : 0)) % 24;
export const trafficSignRadius = (kind: TrafficSignKind, variant: number): number => (kind === "one-way" || kind === "parking") && signVariant(variant) % 4 === 3 ? .44 : .12;
/** The same small boxes as the street kit: shaped plates, physical lettering, bolts, brackets and seeded posts. */
export function trafficSign(p: Placer, kind: TrafficSignKind, limit = 50, options: TrafficSignOptions = {}): number {
  const variant = signVariant(options.variant ?? Math.floor(p.D.u("signVariant", p.frame.x, p.frame.z) * 24));
  const scale = .86 + (variant % 4) * .075, y = 2.15 + (Math.floor(variant / 4) % 3) * .19;
  const direction = options.direction ?? (variant % 2 ? -1 : 1), twin = trafficSignRadius(kind, variant) > .2;
  const post: StreetSlotName = variant >= 16 ? "wood" : variant >= 8 ? "frame" : "pole";
  for (const x of twin ? [-.33, .33] : [0]) {
    addBox(p, 1, x, y / 2, 0, variant % 3 === 0 ? .055 : .04, y / 2 + .25, .045, post);
    addBox(p, 0, x, .055, 0, .1, .055, .1, "frame");
  }
  for (const dy of [-.26, .26]) addBox(p, 0, 0, y + dy * scale, .025, twin ? .43 : .15, .035, .06, "frame");
  type Shape = "rect" | "circle" | "octagon" | "triangle" | "diamond";
  const shape: Shape = kind === "stop" ? "octagon" : kind === "yield" ? "triangle" : kind === "no-entry" || kind === "no-parking" || (kind === "speed" && variant % 2 === 1) ? "circle" : kind === "crossing" || kind === "bend" || kind === "merge" ? "diamond" : "rect";
  const warning = kind === "crossing" || kind === "bend" || kind === "merge" || kind === "chevron";
  const blue = kind === "one-way" || kind === "parking";
  const red = kind === "stop" || kind === "yield" || kind === "no-entry" || kind === "no-parking" || (kind === "speed" && shape === "circle");
  const hw = (kind === "one-way" || kind === "chevron" ? .77 : .55) * scale, hh = (kind === "one-way" || kind === "chevron" ? .36 : .56) * scale;
  const plate = (size: number, z: number, depth: number, slot: StreetSlotName): void => {
    if (shape === "rect") { addBox(p, 1, 0, y, z, hw * size, hh * size, depth, slot); return; }
    // Horizontal bands give the familiar silhouettes without a separate asset or renderer.
    const bands = 12;
    for (let k = 0; k < bands; k++) {
      const a = -1 + k * 2 / bands, b = a + 2 / bands, t = Math.min(Math.abs(a), Math.abs(b));
      const width = shape === "circle" ? Math.sqrt(Math.max(0, 1 - t * t)) : shape === "octagon" ? Math.min(1, 1.41421356237 - t) : shape === "diamond" ? 1 - t : (b + 1) / 2;
      addBox(p, 1, 0, y + (a + b) / 2 * hh * size, z, Math.max(.03, width) * hw * size, hh * size / bands, depth, slot);
    }
  };
  plate(1, .07, .033, red ? "signalRed" : "housing");
  plate(.87, .112, .012, kind === "stop" || kind === "no-entry" ? "signalRed" : blue ? "signBlue" : warning ? "bollard" : "adPanel");
  // A reader faces the sign's +z face, so their right is local -x.
  const mark = (x: number, dy: number, w: number, h: number, slot: StreetSlotName = kind === "stop" || kind === "no-entry" || blue ? "adPanel" : "housing") => addBox(p, 1, -x * scale, y + dy * scale, .137, w * scale, h * scale, .008, slot);
  const letters = (word: string) => {
    const cell = Math.min(.115, .82 / (word.length * 4 - 1)), start = -(word.length * 4 - 2) * cell / 2;
    [...word].forEach((ch, i) => { const bits = GLYPHS[ch]; if (!bits) return; for (let n = 0; n < 15; n++) if (bits[n] === "1") mark(start + (i * 4 + n % 3) * cell, (2 - Math.floor(n / 3)) * cell, cell * .46, cell * .46); });
  };
  if (kind === "speed") letters(String(Math.max(10, Math.min(130, Math.round(limit / 10) * 10))));
  else if (kind === "stop") letters("STOP");
  else if (kind === "no-entry") mark(0, 0, .37, .075);
  else if (kind === "parking" || kind === "no-parking") {
    letters("P");
    if (kind === "no-parking") for (let k = 0; k < 12; k++) mark(-.31 + k * .056, -.31 + k * .056, .035, .035, "signalRed");
  } else if (kind === "yield") {
    // The red triangular border is the symbol; a small black stem adds a warning variant.
    if (variant % 3 === 0) { mark(0, .11, .025, .12); mark(0, -.07, .025, .025); }
  } else if (kind === "merge") {
    mark(direction * .08, 0, .035, .3);
    for (let k = 0; k < 6; k++) mark(direction * (-.2 + k * .05), -.18 + k * .05, .035, .04);
    for (let k = 0; k < 3; k++) mark(direction * .08, .23 + k * .04, .11 - k * .035, .025);
  } else if (kind === "chevron") {
    for (const x of [-.24, .14]) for (let k = 0; k < 6; k++) {
      mark(direction * (x + k * .045), -.21 + k * .042, .035, .035);
      mark(direction * (x + k * .045), .21 - k * .042, .035, .035);
    }
  } else if (kind === "one-way" || kind === "bend") {
    mark(direction * -.11, 0, .23, .045);
    if (kind === "bend") mark(direction * -.3, -.1, .045, .13);
    for (let k = 0; k < 5; k++) mark(direction * (.1 + k * .045), 0, .028, .2 - k * .036);
  } else {
    mark(0, .22, .055, .055); mark(0, .055, .035, .1);
    for (let k = 0; k < 4; k++) { mark(-.045 * k, -.055 - k * .052, .028, .032); mark(.045 * k, -.055 - k * .052, .028, .032); }
    mark(-.1, .045, .1, .025); mark(.1, 0, .1, .025);
    for (let k = -1; k <= 1; k++) mark(k * .14, -.31, .045, .02);
  }
  // Fitted bolts and an optional supplementary distance/arrow plate travel with the same destructible assembly.
  for (const dy of [-.36, .36]) if (shape !== "triangle" && shape !== "diamond" && hh > .42) addBox(p, 0, 0, y + dy * scale, .152, .017, .017, .012, "frame");
  if (variant % 3 === 1 && kind !== "stop" && kind !== "yield") {
    addBox(p, 1, 0, y - hh - .2, .08, .28 * scale, .11, .025, "adPanel");
    addBox(p, 1, 0, y - hh - .2, .11, .18 * scale, .023, .01, "housing");
    for (let k = 0; k < 3; k++) addBox(p, 1, -direction * (.12 + k * .035) * scale, y - hh - .2, .112, .023, .075 - k * .023, .009, "housing");
  }
  return trafficSignRadius(kind, variant);
}

/** A traffic camera: a pole, its arm out over the verge toward the road (+x), the housing looking along the road (+z). */
export function trafficCamera(p: Placer): number {
  addBox(p, 1, 0, 3.2, 0, 0.1, 3.2, 0.1, "pole");
  addBox(p, 1, 0.75, 6.3, 0, 0.75, 0.06, 0.06, "pole");
  addBox(p, 0, 1.4, 6.05, 0.15, 0.17, 0.17, 0.42, "housing");
  addBox(p, 0, 1.4, 6.05, 0.58, 0.1, 0.1, 0.02, "lampCool");
  addBox(p, 0, 0, 1.2, -0.15, 0.25, 0.35, 0.12, "frame");
  return 0.15;
}
