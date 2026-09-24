// A car's lights, as the renderer lights them: what burns on the car itself
// (keel/bake MeshDraw.glow, per slot -- headlights, tail lamps, neon tubes, lit
// rims), the light that spills off them (MeshDraw.bloom: brake lamps in their
// own colour round their own shape), and where on the car they sit (what a
// ground pass throws their light from). One policy for every game that uses
// these cars: lamps dim by day, lit at night; tail lamps a dim lens until the
// brakes light them right up; a service vehicle's beacons dark until the game
// gives them a phase, then flashing half against half.

import { oklch } from "@keel-engine/core";
import type { Car, Colour } from "./car.ts";
import { BODY_SLOT as S } from "./slots.ts";
import { WHEEL_SLOT } from "./shapes.ts";

/** A bus's destination sign: amber LEDs. */
export const SIGN_AMBER: Colour = { light: 0.8, chroma: 0.16, hue: 72 };

/** A car colour as sRGB 0..1. */
export const colourRgb = (c: Colour): [number, number, number] => { const [r, g, b] = oklch(c.light, c.chroma, c.hue); return [r / 255, g / 255, b / 255]; };

/** Its lamps' own colours (what they put on the road) and its glow colour (neon, underglow, trails). */
export function lampColours(car: Car): { head: [number, number, number]; tail: [number, number, number]; glow: [number, number, number] } {
  return { head: colourRgb(car.paints.head), tail: colourRgb(car.paints.tail), glow: colourRgb(car.paints.glow) };
}

/** How far out from the middle its head lights and tail lights sit (m), by their forms. */
export function lampSpots(car: Car): { headX: number; tailX: number } {
  const hw = car.body.width / 2;
  const head = { strip: 0.55, slit: 0.72, pair: 0.76, round: 0.68, quad: 0.64, frog: 0.62, popup: 0.68 }[car.parts.head];
  const tail = { bar: 0.6, slim: 0.6, blocks: 0.76, round: 0.7, quad: 0.68, split: 0.58 }[car.parts.tail];
  return { headX: hw * head, tailX: hw * tail };
}

/** What a car's lights are doing: night or day, braking (0..1), its neon on (0..1), its beacons' flash. */
export interface LightState {
  readonly night: boolean;
  readonly braking: number;
  readonly neon: number;
  /**
   * The beacons' flash, on a car that has them (`car.parts.beacons`): a phase counted in flash cycles -- its fraction is
   * where in the cycle it is (A double-flashes in the first half, B in the second), so a game passes `seconds * rate`
   * (~1.5 cycles a second reads right) and it keeps running. Absent: the beacons are dark. No other car's lights move.
   */
  readonly beacon?: number | undefined;
}

/** How lit each half of the beacons is at a phase (1 on, 0 off): A double-flashes in the cycle's first half, B in its second. */
export function beaconFlash(phase: number): [number, number] {
  const p = phase - Math.floor(phase);
  const flash = (q: number): number => (q < 0.13 || (q >= 0.2 && q < 0.33) ? 1 : 0);
  return p < 0.5 ? [flash(p), 0] : [0, flash(p - 0.5)];
}

/** Where a car's beacons sit (car frame), which half each is, and the colour it throws: what a ground pass lights from. Empty without. */
export function beaconLamps(car: Car): Array<{ x: number; y: number; z: number; slot: 30 | 31; rgb: [number, number, number] }> {
  const b = car.paints.beacon, lamps = car.parts.service?.beacons;
  if (!b || !lamps) return [];
  const a = colourRgb(b.a), c = colourRgb(b.b);
  return lamps.map((l) => ({ x: l.x, y: l.y, z: l.z, slot: l.slot, rgb: l.slot === S.beaconA ? a : c }));
}

/** Whether a car has glowing neon at all (a kit, or an effect that glows). */
export const hasNeon = (car: Car): boolean => !!car.paints.neon || car.paints.effect === "neon" || car.paints.effect === "underglow" || car.paints.effect === "glowrims";

/**
 * A car's lights this frame: `glow` per body slot (added to how lit a part is -- a tail lamp is held DOWN when off, so
 * the brakes lifting it show the whole range), `bloom` per body slot (r, g, b, strength: light off the lamp), and `rims`
 * per wheel slot (glowing rims), or undefined.
 */
export function carLights(car: Car, s: LightState): { glow: Float32Array; bloom: Float32Array; rims: Float32Array | undefined } {
  const braking = Math.max(0, Math.min(1, s.braking));
  const head = s.night ? 0.85 : 0.25;
  const tailOff = s.night ? -0.18 : -0.32, tailOn = s.night ? 0.5 : 0.36;
  const glow = new Float32Array(32);
  glow[S.light] = head; glow[S.tail] = tailOff + (tailOn - tailOff) * braking;
  // Its neon burns on the parts that carry the tubes: the sills and arches, the trim, the cabin.
  const kit = car.paints.neon, neon = s.neon;
  if (neon > 0) {
    if (kit?.under || car.paints.effect === "underglow") { glow[S.neon] = neon; if (car.paints.effect === "underglow") glow[S.arch] = neon * 0.8; }
    if (kit?.trim || car.paints.effect === "neon") glow[S.trim] = neon * 0.9;
    if (kit?.cabin) glow[S.interior] = neon * 0.8;
  }
  const bloom = new Float32Array(32 * 4);
  const put = (slot: number, rgb: readonly [number, number, number], k: number): void => { if (k > 0) bloom.set([rgb[0], rgb[1], rgb[2], Math.min(1, k)], slot * 4); };
  // (A brake lamp burns in the colour the car was built with -- rich, never washed out; a white LED stays white.)
  const t = car.paints.tail;
  put(S.tail, colourRgb({ light: 0.62, chroma: t.chroma < 0.04 ? t.chroma : Math.max(0.16, t.chroma), hue: t.hue }), braking);
  put(S.light, colourRgb(car.paints.head), s.night ? 0.45 : 0);
  if (neon > 0 && (kit?.under || car.paints.effect === "underglow")) put(S.neon, colourRgb(car.paints.glow), neon * 0.6);
  // Glowing rims: lit enough to read, not so much they burn to white.
  let rims: Float32Array | undefined;
  // A service vehicle's beacons: dark lenses, each half lit when its flash is (and throwing its colour round it); a bus's
  // destination sign, lit in amber (it is the neon slot on a vehicle that has no kit).
  const beacon = car.paints.beacon;
  if (car.parts.beacons && beacon) {
    const [a, b] = s.beacon !== undefined && Number.isFinite(s.beacon) ? beaconFlash(s.beacon) : [0, 0];
    const off = s.night ? -0.22 : -0.32, on = s.night ? 0.8 : 0.62;
    glow[S.beaconA] = off + (on - off) * a; glow[S.beaconB] = off + (on - off) * b;
    put(S.beaconA, colourRgb(beacon.a), a * (s.night ? 1 : 0.7));
    put(S.beaconB, colourRgb(beacon.b), b * (s.night ? 1 : 0.7));
  }
  if (car.parts.service?.kind === "bus") { glow[S.neon] = s.night ? 0.3 : 0.1; put(S.neon, colourRgb(SIGN_AMBER), s.night ? 0.4 : 0); }
  if ((kit?.rims || car.paints.effect === "glowrims") && neon > 0) {
    rims = new Float32Array(32);
    rims[WHEEL_SLOT.rim] = neon * 0.55; rims[WHEEL_SLOT.hub] = neon * 0.4; rims[WHEEL_SLOT.barrel] = neon * 0.35;
  }
  return { glow, bloom, rims };
}
