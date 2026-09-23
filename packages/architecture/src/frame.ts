// A building under construction: its frame on the lot (+z out of its front,
// onto its main road), its facade grid, the masses stacked so far and every
// solid made -- in the building's own metres, turned into the world as they're
// added. Every op and detail writes through this, so none of them do trig.

import { dcos, dsin } from "@keel-engine/core";
import type { Draws, Lot, LotFront } from "@keel-engine/city";
import type { AdSlotSpec, AnchorSpot, LightSpot, Lod, PlantKind, PlantSpot, PropSpot, Solid, WaterSpec } from "./types.ts";
import type { CommonsSite } from "./zoning.ts";
import { layerOf, slotIndex } from "./slots.ts";
import type { AnySlot, SlotName } from "./slots.ts";

/** A mass: a box in the building's frame (centre x, z; half extents; from y0 up to y1), and its walls' slot. */
export interface Mass { readonly x: number; readonly z: number; readonly hw: number; readonly hd: number; readonly y0: number; readonly y1: number; readonly slot: SlotName }

export interface Frame {
  /** The lot's middle (world) and the building's heading (its front faces this way). */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Half its width across the front, and half its depth (m). */
  readonly hw: number;
  readonly hd: number;
  /** The ground it stands on (m): its lot's pad, the pavement under a lamp. 0 on a flat city. */
  readonly y?: number;
}

/** What places solids: a frame to place them in, and where they go (buildings, street furniture, parks). */
export interface Placer {
  readonly D: Draws;
  readonly frame: Frame;
  readonly solids: Solid[];
  /** Plants (foliage sprites) and advertising faces it puts down. */
  readonly plants: PlantSpot[];
  readonly ads: AdSlotSpec[];
  /** The highest point so far. */
  top: number;
}

export interface Build extends Placer {
  /** Its lot's key (what its ad slots are named by). */
  readonly key: string;
  /** The envelope left after setbacks, in the building's frame. */
  readonly site: { readonly x: number; readonly z: number; readonly hw: number; readonly hd: number };
  readonly bay: number;
  readonly storey: number;
  readonly groundH: number;
  /** Storeys and its height (m) as drawn. */
  readonly storeys: number;
  readonly height: number;
  readonly wall: SlotName;
  readonly derelict: boolean;
  /** Which of the district's neons its signs use. */
  readonly neon: SlotName;
  readonly masses: Mass[];
  /** Lamps and small things it puts on its lot (parks and plazas). */
  readonly lights: LightSpot[];
  readonly props: PropSpot[];
  /** Water it lays and the points it offers other systems (a substation's gantries). */
  readonly water: WaterSpec[];
  readonly anchors: AnchorSpot[];
  /** On a block given over whole to a park or a lake: the block, and this lot's place in it. */
  readonly commons?: CommonsSite;
}

export function createBuild(init: Omit<Build, "masses" | "solids" | "top" | "lights" | "props" | "plants" | "ads" | "water" | "anchors">): Build {
  return { ...init, masses: [], solids: [], top: 0, lights: [], props: [], plants: [], ads: [], water: [], anchors: [] };
}

const RANK: Readonly<Record<LotFront["cls"], number>> = { highway: 3, arterial: 2, street: 1, alley: 0, ramp: 3, freeway: 4 };

/** The most important road a lot faces (its class and its face): what its building turns to. */
export const mainFront = (lot: Lot): LotFront | undefined => [...lot.fronts].sort((a, b) => RANK[b.cls] - RANK[a.cls] || a.face - b.face)[0];

/** The building's frame on its lot: facing its most important road (+z out of its front). */
export function frameOf(lot: Lot): Frame {
  const face = mainFront(lot)?.face ?? 0, { x, z, hw, hd, yaw } = lot.obb;
  // (Faces 0..3 are +z, +x, -z, -x of the lot's box: turning a quarter each. Odd faces swap width and depth.)
  const odd = face % 2 === 1;
  return { x, z, yaw: yaw + (face * Math.PI) / 2, hw: odd ? hd : hw, hd: odd ? hw : hd };
}

/** A point of the world in a placer's frame (toWorld's inverse, on the ground plane). */
export function toFrame(b: Placer, wx: number, wz: number): [number, number] {
  const c = dcos(b.frame.yaw), s = dsin(b.frame.yaw), dx = wx - b.frame.x, dz = wz - b.frame.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** A point in the building's frame, in the world. */
export function toWorld(b: Placer, x: number, y: number, z: number): [number, number, number] {
  const c = dcos(b.frame.yaw), s = dsin(b.frame.yaw);
  return [b.frame.x + x * c + z * s, y + (b.frame.y ?? 0), b.frame.z - x * s + z * c];
}

export interface BoxOptions { readonly grid?: boolean; readonly wedge?: boolean; readonly lo?: number; readonly turn?: number }

const isBuild = (b: Placer): b is Build => "bay" in b;

/** A box in the placer's frame: centre (x, y, z), half extents (w, h, d), its slot. `grid` gives it the facade grid. */
export function addBox(b: Placer, lod: Lod, x: number, y: number, z: number, w: number, h: number, d: number, slot: AnySlot, o: BoxOptions = {}): void {
  if (w <= 0 || h <= 0 || d <= 0) return;
  const c = toWorld(b, x, y, z), yaw = b.frame.yaw + (o.turn ?? 0);
  // (The grid lines up across stacked masses: cells counted from the envelope's left edge and from the ground,
  // offset by a seeded whole number so two buildings in one look never light alike.)
  const grid = o.grid && isBuild(b) ? [b.bay, b.storey, gridU(b) + (x - w - (b.site.x - b.site.hw)) / b.bay, gridV(b) + (y - h) / b.storey] as const : undefined;
  b.solids.push({ lod, layer: layerOf(slot), box: { c, h: [w, h, d], yaw, mat: slotIndex(slot), ...(o.wedge ? { kind: "wedge", lo: o.lo ?? 0 } : {}), ...(grid ? { grid } : {}) } });
  if (layerOf(slot) === 0) b.top = Math.max(b.top, y + h);
}

/** A capsule between two points of the placer's frame. */
export function addCapsule(b: Placer, lod: Lod, a: readonly [number, number, number], e: readonly [number, number, number], r: number, slot: AnySlot): void {
  b.solids.push({ lod, layer: layerOf(slot), capsule: { a: toWorld(b, a[0], a[1], a[2]), b: toWorld(b, e[0], e[1], e[2]), r, mat: slotIndex(slot) } });
  if (layerOf(slot) === 0) b.top = Math.max(b.top, a[1] + r, e[1] + r);
}

/** A placer at a point of another's frame, turned from it (a bench in a park), writing to the same solids. */
export function subPlacer(p: Placer, x: number, z: number, turn = 0): Placer {
  const [wx, wy, wz] = toWorld(p, x, 0, z);
  return { D: p.D, frame: { x: wx, z: wz, y: wy, yaw: p.frame.yaw + turn, hw: 0, hd: 0 }, solids: p.solids, plants: p.plants, ads: p.ads, top: 0 };
}

/** A placer at a point of the world, turned to a heading (street furniture: its +z faces the way it faces). */
export function placerAt(D: Draws, x: number, z: number, yaw: number, solids: Solid[], plants: PlantSpot[] = [], ads: AdSlotSpec[] = [], y = 0): Placer {
  return { D, frame: { x, z, y, yaw, hw: 0, hd: 0 }, solids, plants, ads, top: 0 };
}

/** A plant at a point of the placer's frame (its foot at height y). */
export function addPlant(p: Placer, kind: PlantKind, x: number, y: number, z: number, scale: number, seed: number): void {
  const [wx, wy, wz] = toWorld(p, x, y, z);
  p.plants.push({ kind, x: wx, y: wy, z: wz, scale, seed });
}

/** An advertising face in the placer's frame, facing its +z: centre (x, y, z), width and height (m). */
export function addAd(p: Placer, id: string, kind: AdSlotSpec["kind"], x: number, y: number, z: number, w: number, h: number): void {
  const pos = toWorld(p, x, y, z), ahead = toWorld(p, x, y, z + 1);
  p.ads.push({ id, kind, size: [w, h], pos, normal: [ahead[0] - pos[0], ahead[2] - pos[2]] });
}

/** A mass: its box (with the facade grid) and its record, for roofs, crowns and footprints. */
export function addMass(b: Build, m: Mass, lod: Lod = 2): void {
  b.masses.push(m);
  addBox(b, lod, m.x, (m.y0 + m.y1) / 2, m.z, m.hw, (m.y1 - m.y0) / 2, m.hd, m.slot, { grid: true });
}

const gridU = (b: Build): number => 8 + Math.floor(b.D.u("gridU") * 900);
const gridV = (b: Build): number => Math.floor(b.D.u("gridV") * 900);

/** The mass the roof sits on: the highest one. */
export const topMass = (b: Build): Mass | undefined => b.masses.reduce<Mass | undefined>((t, m) => (!t || m.y1 > t.y1 ? m : t), undefined);

/** A value in a range, by a named draw. */
export const within = (D: Draws, tag: string, [lo, hi]: readonly [number, number], i = 0): number => lo + (hi - lo) * D.u(tag, i);
/** A whole number in a range (both ends in), by a named draw. */
export const count = (D: Draws, tag: string, [lo, hi]: readonly [number, number], i = 0): number => Math.min(hi, lo + Math.floor((hi - lo + 1) * D.u(tag, i)));
/** A name by weight, by a named draw (walked in the weights' own order). */
export function pick<K extends string>(D: Draws, tag: string, weights: Readonly<Partial<Record<K, number>>>, i = 0): K | undefined {
  let total = 0;
  for (const k in weights) total += Math.max(0, weights[k] ?? 0);
  if (total <= 0) return undefined;
  let at = D.u(tag, i) * total;
  let last: K | undefined;
  for (const k in weights) { const w = Math.max(0, weights[k] ?? 0); if (w <= 0) continue; last = k; if (at < w) return k; at -= w; }
  return last;
}
