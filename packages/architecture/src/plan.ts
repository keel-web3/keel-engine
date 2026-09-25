// A lot's building, planned: which archetype stands there (the district's
// weights, times whether the lot can hold it, re-rolled once if it would
// repeat its left neighbour), its condition, storeys, facade and walls; then
// the envelope its setbacks leave, the massing ops, the roof, crown, trim,
// rooftop kit and signs, in the archetype's order. A pure function of the
// catalogue, the city's seed and the lot's key.

import { dcos, dsin } from "@keel-engine/core";
import type { CityHeight, Draws, Lot, Obb } from "@keel-engine/city";
import { createBuild, count, frameOf, mainFront, pick, toWorld, within } from "./frame.ts";
import type { Build, Frame } from "./frame.ts";
import { DOOR_LIFT, floorOf, groundMasses, plinths, settle, stoopSteps } from "./foundations.ts";
import { lakeLevel } from "./commons.ts";
import { mass } from "./massing.ts";
import { bands, cornice, crown, rooftop, roof } from "./roofs.ts";
import { signs } from "./signs.ts";
import { mural } from "./street/parks.ts";
import { NEON_SLOTS } from "./slots.ts";
import type { SlotName } from "./slots.ts";
import type { Archetype, BuildingPlan, Catalogue, CityLike, Condition, Door } from "./types.ts";
import { drawsOf, fits, zoningOf } from "./zoning.ts";
import type { Blend, CommonsSite } from "./zoning.ts";

export { frameOf };

/** Whether an archetype is open space (a park, a plaza) rather than a building. */
const open = (a: Archetype): boolean => a.massing.some((m) => m.op === "park" || m.op === "plaza" || m.op === "commons");

/** How much likelier an archetype is on this lot: the road it faces, a corner. */
function affinity(a: Archetype, lot: Lot): number {
  if (!a.affinity) return 1;
  const cls = mainFront(lot)?.cls ?? "street";
  return (a.affinity.roads?.[cls] ?? 1) * (lot.fronts.length >= 2 ? a.affinity.corner ?? 1 : 1);
}

/** The first roll for a lot: its archetype and walls (what the anti-repeat rule compares). */
function roll(cat: Catalogue, city: CityLike, lot: Lot, D: Draws, again: number): { a: Archetype; wall: SlotName } | null {
  const kind = city.districts[lot.district]?.kind ?? "suburb", f = frameOf(lot);
  const blend = zoningOf(cat, city).blend.get(lot.key);
  // (Each kind's weights as shares, so a border lot leans to its neighbour's mix by the blend, not by whose table sums
  // higher. With no blend and no affinity, the same proportions as the district's own table.)
  const shares = (k: string): { w: Readonly<Record<string, number>>; sum: number } => {
    const w = cat.weights[k as keyof Catalogue["weights"]] ?? {};
    let sum = 0;
    for (const id in w) sum += Math.max(0, w[id] ?? 0);
    return { w, sum: sum || 1 };
  };
  const own = shares(kind), nb = blend ? shares(blend.kind) : null, t = blend?.t ?? 0;
  const weightsOf = (strict: boolean): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const a of cat.archetypes) {
      const w = ((own.w[a.id] ?? 0) / own.sum) * (1 - t) + (nb ? ((nb.w[a.id] ?? 0) / nb.sum) * t : 0);
      if (w > 0 && (strict ? fits(a, f, lot) : !open(a))) out[a.id] = w * affinity(a, lot);
    }
    return out;
  };
  // (A lot too small for anything the district builds takes a building it'd build anyway, small -- never a sliver of park.)
  let weights = weightsOf(true);
  if (!Object.keys(weights).length) weights = weightsOf(false);
  const id = pick(D, "archetype", weights, again);
  const a = cat.archetypes.find((x) => x.id === id);
  if (!a) return null;
  return { a, wall: pick(D, "walls", a.materials, again) ?? "concreteLight" };
}

/** What a lot's first choice is before the anti-repeat rule: the zoning's (a landmark, a unique), a corner's, or its roll. */
function choose(cat: Catalogue, city: CityLike, lot: Lot, D: Draws, again: number): { a: Archetype; wall: SlotName; fixed: boolean } | null {
  const z = zoningOf(cat, city), byId = (id: string | undefined) => (id ? cat.archetypes.find((x) => x.id === id) : undefined);
  const landmark = byId(cat.landmark);
  if (landmark && z.landmarks.get(lot.district) === lot.key) return { a: landmark, wall: "concreteLight", fixed: true };
  const unique = byId(z.assigned.get(lot.key));
  if (unique) return { a: unique, wall: pick(D, "walls", unique.materials) ?? "concreteLight", fixed: true };
  // (The corner on an arterial out of downtown: often the gas station, when it fits.)
  const corner = byId(cat.corners?.archetype), kind = city.districts[lot.district]?.kind ?? "suburb";
  if (again === 0 && corner && lot.fronts.length >= 2 && lot.fronts.some((f) => f.cls === "arterial" || f.cls === "highway")
    && fits(corner, frameOf(lot), lot) && D.u("cornerLot") < (cat.corners!.chance[kind] ?? 0)) return { a: corner, wall: pick(D, "walls", corner.materials) ?? "concreteLight", fixed: false };
  const r = roll(cat, city, lot, D, again);
  return r ? { ...r, fixed: false } : null;
}

/** A lot's storeys band: its own, leaning to its neighbouring district's at a border (a garage's or a yard's stays). */
function bandOf(lot: Lot, blend: Blend | undefined): readonly [number, number] {
  if (!blend || lot.use === "garage" || lot.use === "yard") return lot.height;
  const lo = Math.max(1, Math.round(lot.height[0] + (blend.band[0] - lot.height[0]) * blend.t));
  return [lo, Math.max(lo, Math.round(lot.height[1] + (blend.band[1] - lot.height[1]) * blend.t))];
}

const lotIndex = new WeakMap<readonly Lot[], Map<string, Lot>>();
const byKey = (city: CityLike, key: string): Lot | undefined => {
  let m = lotIndex.get(city.lots);
  if (!m) { m = new Map(city.lots.map((l) => [l.key, l])); lotIndex.set(city.lots, m); }
  return m.get(key);
};

const GLASS: ReadonlySet<SlotName> = new Set(["glassBlue", "glassGreen", "glassBronze", "darkGlass", "officeGrid"]);

/** Which side of a building (its frame's +x: 1, -x: -1) looks onto a road besides its front, if one does. */
function sideOnRoad(lot: Lot): 1 | -1 | null {
  const main = mainFront(lot)?.face ?? 0;
  for (const f of lot.fronts) { const r = (f.face - main + 4) % 4; if (r === 1) return 1; if (r === 3) return -1; }
  return null;
}

/** Where a lot's building's footprint (the envelope after setbacks) sits in its frame. */
function envelope(a: Archetype, f: Frame): Build["site"] {
  const [front, side, rear] = a.setbacks;
  // (Setbacks never leave less than a 4 m half-width or half-depth: a small lot builds small, not nothing.)
  const hw = Math.max(Math.min(4, f.hw), f.hw - side), total = Math.min(front + rear, Math.max(0, 2 * f.hd - 8));
  const k = front + rear > 0 ? total / (front + rear) : 0;
  return { x: 0, z: (rear * k - front * k) / 2, hw, hd: f.hd - total / 2 };
}

/**
 * The plan for a lot's building. With the city's height (keel/city cityHeight) it stands on its lot's pad, a plinth
 * stepping down to the land where it falls away; without, on flat ground at 0.
 */
export function planLot(cat: Catalogue, city: CityLike, lot: Lot, height?: CityHeight): BuildingPlan {
  const D = drawsOf(city, lot), empty = { key: lot.key, archetype: "none", condition: "pristine" as Condition, wall: "concreteLight" as SlotName, solids: [], footprint: [], height: 0 };
  if (lot.height[1] <= 0) return empty;
  const z = zoningOf(cat, city), commons = z.commons.get(lot.block), common = commons ? cat.archetypes.find((x) => x.id === cat.commons?.archetype) : undefined;
  let first = common ? { a: common, wall: "concreteLight" as SlotName, fixed: true } : choose(cat, city, lot, D, 0);
  // (Anti-repeat: the same archetype in the same walls as its left neighbour's first choice -- or, for a business that
  // never stands next door to its own kind, the same archetype at all -- choose again, twice at most.)
  const left = lot.left ? byKey(city, lot.left) : undefined;
  if (first && left && !first.fixed) {
    const l = choose(cat, city, left, drawsOf(city, left), 0);
    for (let again = 1; again <= 2 && first && l && l.a.id === first.a.id && (first.a.solo || l.wall === first.wall); again += 1) first = choose(cat, city, lot, D, again) ?? first;
  }
  if (!first) return empty;
  const { a, wall } = first, district = city.districts[lot.district];
  const decay = district?.decay ?? 0, u = D.u("condition");
  const condition: Condition = u < decay ? "derelict" : u < decay * 2.5 ? "worn" : "pristine";
  const facade = cat.facades[a.facades[Math.floor(D.u("facade") * a.facades.length)] ?? ""] ?? { id: "", bay: [3, 3], storey: [3.3, 3.3], groundH: [4, 4] };
  // Storeys: the archetype's range inside the lot's band, skewed low (the odd hero tower gets the top of it).
  const band = bandOf(lot, z.blend.get(lot.key));
  const lo = Math.min(Math.max(a.storeys[0], band[0]), a.storeys[1]), hi = Math.max(lo, Math.min(a.storeys[1], band[1]));
  const r = D.u("storeys"), s = D.u("hero") < 0.12 ? 0.9 + 0.1 * r : r * r;
  const storeys = Math.round(lo + (hi - lo) * s);
  // On a city's ground (its blocks graded to their pavements, keel/city terraces.ts): the floor set by the door --
  // level with the pavement abreast of it, or up the archetype's stoop -- the building standing level on the sloped
  // terrace (foundations.ts). Open space stands on the ground at its middle; all it lays is set on the ground after.
  // (A commons lot is laid out in its block's axes, not turned to its road: its block is one park.)
  const f0: Frame = commons ? { x: lot.obb.x, z: lot.obb.z, yaw: lot.obb.yaw, hw: lot.obb.hw, hd: lot.obb.hd } : frameOf(lot), site = envelope(a, f0);
  let base = 0, rise = 0, door: Door | undefined;
  if (height) {
    if (commons || open(a)) base = height.pad(lot) + DOOR_LIFT;
    else ({ base, rise, door } = floorOf(height, { frame: f0, site }, D, a.stoop, mainFront(lot)?.edge));
  }
  const storey = within(D, "storey", facade.storey), f = { ...f0, y: base };
  let site2: CommonsSite | undefined;
  if (commons) {
    const r = commons.lots.get(lot.key)!;
    // (The lake stands level across its block, a hand over the highest ground under it; its basin reaches the lowest.)
    let level = 0.1, floor = -0.2;
    if (height && commons.water) { const [lo, hi] = lakeLevel(commons, height); level = hi - base; floor = lo - base; }
    site2 = { info: commons, u: (r.x0 + r.x1) / 2, v: (r.z0 + r.z1) / 2, level, floor };
  }
  const hues = district?.hues.length ?? 1;
  const b = createBuild({
    key: lot.key, D, frame: f, site, bay: within(D, "bay", facade.bay), storey, groundH: within(D, "groundH", facade.groundH),
    storeys, height: Math.max(storey, storeys * storey), wall, derelict: condition === "derelict",
    neon: NEON_SLOTS[count(D, "neon", [0, Math.min(3, hues - 1)])]!,
    ...(site2 ? { commons: site2 } : {}),
  });
  for (const op of a.massing) {
    if (mass(b, op)) continue;
    if (op.op === "roof") roof(b, op);
    else if (op.op === "crown") crown(b, op);
    else if (op.op === "cornice") cornice(b);
    else if (op.op === "bands") bands(b, op);
  }
  rooftop(b, a.roof);
  signs(b, a.signs);
  // A mural on a blank side wall where the building turns onto a road (not on glass, not on a wreck).
  const muralChance = district ? cat.murals?.[district.kind] ?? 0 : 0;
  const turn = sideOnRoad(lot);
  const main = b.masses[0];
  if (turn && main && main.hw >= 3 && main.hd >= 3 && !b.derelict && !GLASS.has(wall) && D.u("muralRoll") < muralChance) mural(b, turn);
  // On the ground: what stands free on the lot set down on the terrace; a plinth under each building mass down past
  // the lowest ground round it; the stoop's steps down from the door.
  let foot = base;
  if (height) { settle(b, height); foot = plinths(b, height); stoopSteps(b, height, rise); }
  // Collision: the masses standing on the ground (a tower on its podium is inside it) -- within the envelope, the
  // ground its floor was levelled for (what a mass overhangs past it -- a canopy's post, a boathouse over the water --
  // stands on its foundation's edge, not on the ground beyond).
  const footprint: Obb[] = [];
  for (const m of b.masses) {
    if (m.y0 >= 0.01) continue;
    if (Math.abs(m.x - site.x) + m.hw <= site.hw && Math.abs(m.z - site.z) + m.hd <= site.hd) {
      const [x, , z] = toWorld(b, m.x, 0, m.z);
      footprint.push({ x, z, hw: m.hw, hd: m.hd, yaw: f.yaw });
      continue;
    }
    const x0 = Math.max(m.x - m.hw, site.x - site.hw), x1 = Math.min(m.x + m.hw, site.x + site.hw);
    const z0 = Math.max(m.z - m.hd, site.z - site.hd), z1 = Math.min(m.z + m.hd, site.z + site.hd);
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
    const [x, , z] = toWorld(b, (x0 + x1) / 2, 0, (z0 + z1) / 2);
    footprint.push({ x, z, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, yaw: f.yaw });
  }
  return { key: lot.key, archetype: a.id, condition, wall, solids: b.solids, footprint, height: b.top, ...(height ? { base, foot } : {}), ...(door ? { door } : {}), lights: b.lights, props: b.props, plants: b.plants, ads: b.ads, ...(b.water.length ? { water: b.water } : {}), ...(b.anchors.length ? { anchors: b.anchors } : {}) };
}
