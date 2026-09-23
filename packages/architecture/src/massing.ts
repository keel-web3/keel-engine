// Massing: what a building's silhouette is made of, the first thing a racer
// reads at speed. Each op is a few lines on the Build: the lot's box
// extruded, a podium with a slimmer tower on it (tapering in tiers, the odd
// one slightly turned), the 1916 wedding cake stepping back above its street
// wall, L and U wings round a court, a brutalist block cantilevered over its
// base, a row of narrow houses, a church's nave and tower, a gas station's
// canopy, a parking garage's open decks, a diner's rounded ends. (The
// roadside's and the city's own -- dealerships to stadiums -- are business.ts's
// and civic.ts's; a block kept whole as a park or a lake is commons.ts's.)

import type { Build, Mass } from "./frame.ts";
import { addBox, addCapsule, addMass, count, pick, within } from "./frame.ts";
import type { SlotName } from "./slots.ts";
import type { MassOp } from "./types.ts";
import { park, plaza } from "./street/parks.ts";
import { BUSINESS_OPS } from "./business.ts";
import { CIVIC_OPS } from "./civic.ts";
import { commons } from "./commons.ts";

type Op<K extends MassOp["op"]> = (b: Build, op: Extract<MassOp, { op: K }>) => void;

/** Snap a height to whole storeys (at least one). */
const storeysOf = (b: Build, h: number): number => Math.max(b.storey, Math.round(h / b.storey) * b.storey);

const extrude: Op<"extrude"> = (b) => {
  const s = b.site;
  if (!b.derelict) { addMass(b, { ...s, y0: 0, y1: b.height, slot: b.wall }); return; }
  // (Derelict: the lower floors boarded up, the rest dark.)
  const low = Math.min(b.height, b.storey * (2 + count(b.D, "boardedFloors", [0, 1])));
  addMass(b, { ...s, y0: 0, y1: low, slot: "boarded" });
  if (b.height > low + 0.5) addMass(b, { ...s, y0: low, y1: b.height, slot: "derelict" });
};

const podium: Op<"podium"> = (b, op) => {
  const n = Math.min(b.storeys - 1, count(b.D, "podium", op.storeys));
  const weights: Partial<Record<SlotName, number>> = { concreteDark: 1, limestone: 1 };
  weights[b.wall] = 3;
  const slot: SlotName = b.derelict ? "boarded" : pick(b.D, "podiumSlot", weights) ?? b.wall;
  addMass(b, { ...b.site, y0: 0, y1: Math.max(b.storey, n * b.storey), slot });
};

const tower: Op<"tower"> = (b, op) => {
  const base = b.masses.reduce((t, m) => Math.max(t, m.y1), 0), s = b.site;
  const inset = within(b.D, "towerInset", op.inset);
  // (A slab: thin front to back, broad across -- a hotel or an office slab.)
  let hw = Math.max(5, s.hw - inset), hd = Math.max(5, (op.slab ? s.hd * 0.55 : s.hd) - inset);
  const tiers = op.tiers ? count(b.D, "tiers", op.tiers) : 1;
  const span = b.height - base;
  if (span < b.storey) return;
  const twist = b.D.u("twist") < 0.2 ? b.D.flat("twistBy") * 0.05 : 0;
  let y = base;
  for (let t = 0; t < tiers; t += 1) {
    const top = t === tiers - 1 ? b.height : storeysOf(b, base + (span * (t + 1)) / tiers);
    if (top <= y) continue;
    const m: Mass = { x: s.x, z: s.z + (op.slab ? -s.hd * 0.2 : 0), hw, hd, y0: y, y1: top, slot: b.wall };
    b.masses.push(m);
    addBox(b, 2, m.x, (y + top) / 2, m.z, hw, (top - y) / 2, hd, b.wall, { grid: true, turn: twist * t });
    y = top; hw = Math.max(4, hw - within(b.D, "taper", [0.6, 1.8], t)); hd = Math.max(4, hd - within(b.D, "taperD", [0.6, 1.8], t));
  }
};

/** The wedding cake: a street wall, then tiers stepping back to a slim top (NYC 1916). */
const setbacks: Op<"setbacks"> = (b, op) => {
  const s = b.site, n = count(b.D, "tiers", op.tiers);
  const wall = Math.min(b.height * 0.55, storeysOf(b, within(b.D, "streetWall", [22, 38])));
  addMass(b, { ...s, y0: 0, y1: wall, slot: b.wall });
  let hw = s.hw, hd = s.hd, y = wall;
  for (let t = 0; t < n && y < b.height - b.storey; t += 1) {
    const step = within(b.D, "step", op.step, t);
    hw = Math.max(4, hw - step); hd = Math.max(4, hd - step);
    // (Each tier shorter than the last, the last reaching the top.)
    const top = t === n - 1 ? b.height : storeysOf(b, y + (b.height - y) * (0.45 + 0.1 * b.D.u("tierH", t)));
    addMass(b, { x: s.x, z: s.z, hw, hd, y0: y, y1: top, slot: b.wall });
    y = top;
  }
};

/** L or U wings round a court at the front (a motel's parking, a loft's yard). */
const wings: Op<"wings"> = (b, op) => {
  const s = b.site, shape = op.shapes[Math.floor(b.D.u("wings") * op.shapes.length)] ?? "L";
  const d = Math.min(Math.max(5, within(b.D, "wingDepth", op.depth)), s.hd, s.hw * 0.66);
  const slot = b.wall, y1 = b.height;
  // (The back bar, full width; then one wing, or two, down the sides to the front.)
  addMass(b, { x: s.x, z: s.z - s.hd + d, hw: s.hw, hd: d, y0: 0, y1, slot });
  const side = b.D.u("wingSide") < 0.5 ? -1 : 1;
  for (const sx of shape === "U" ? [-1, 1] : [side]) addMass(b, { x: s.x + sx * (s.hw - d / 2), z: s.z + d, hw: d / 2, hd: s.hd - d, y0: 0, y1, slot });
};

/** Brutalism: the upper floors pushed out over the base. */
const cantilever: Op<"cantilever"> = (b, op) => {
  const s = b.site, split = storeysOf(b, b.height * (0.3 + 0.25 * b.D.u("split")));
  const out = within(b.D, "out", op.out);
  addMass(b, { x: s.x, z: s.z - out / 2, hw: s.hw - 1.5, hd: s.hd - out / 2, y0: 0, y1: split, slot: b.wall });
  addMass(b, { x: s.x, z: s.z + out / 2, hw: s.hw, hd: s.hd, y0: split, y1: b.height, slot: b.wall });
};

/** Row houses: the lot split into narrow attached houses, each its own height and brick, stoops at their doors. */
const rows: Op<"rows"> = (b, op) => {
  const s = b.site, n = count(b.D, "units", op.units), w = s.hw / n;
  const bricks: SlotName[] = ["redBrick", "brownBrick", "buffBrick", b.wall];
  for (let k = 0; k < n; k += 1) {
    const h = Math.max(b.storey * 2, b.height + b.storey * (count(b.D, "unitH", [0, 2], k) - 1));
    const slot = b.derelict && k % 2 === 0 ? "boarded" : bricks[Math.floor(b.D.u("unitSlot", k) * bricks.length)]!;
    const x = s.x - s.hw + w * (2 * k + 1);
    addMass(b, { x, z: s.z, hw: w - 0.05, hd: s.hd, y0: 0, y1: h, slot });
    addBox(b, 2, x, h + 0.35, s.z, w + 0.1, 0.35, s.hd + 0.3, "trim");
    addBox(b, 0, x + w * 0.4, 0.6, s.z + s.hd + 1, 0.9, 0.6, 1, "concreteLight");
  }
};

/** A church: a nave under a steep gable, a tower at its front with a spire. */
const nave: Op<"nave"> = (b) => {
  const s = b.site, hw = Math.min(s.hw * 0.7, 9), hd = s.hd * 0.8, h = Math.min(16, Math.max(10, b.height));
  addMass(b, { x: s.x, z: s.z - s.hd * 0.1, hw, hd, y0: 0, y1: h, slot: b.wall });
  gable(b, s.x, s.z - s.hd * 0.1, hw + 0.4, hd + 0.2, h, hw * 0.9, "roof");
  const tw = Math.min(3.5, hw * 0.5), th = h + within(b.D, "towerH", [8, 18]), tz = s.z + s.hd - tw;
  addMass(b, { x: s.x, z: tz, hw: tw, hd: tw, y0: 0, y1: th, slot: b.wall });
  addBox(b, 1, s.x, th + 1.2, tz, tw * 0.75, 1.2, tw * 0.75, b.wall);
  addCapsule(b, 1, [s.x, th + 2.4, tz], [s.x, th + 2.4 + within(b.D, "spire", [7, 14]), tz], 0.7, "roof");
};

/** A gas station: a kiosk at the back, a canopy on four posts over the pumps. */
const canopy: Op<"canopy"> = (b) => {
  const s = b.site, kw = Math.min(6, s.hw * 0.5), kd = 4;
  addMass(b, { x: s.x + s.hw - kw, z: s.z - s.hd + kd, hw: kw, hd: kd, y0: 0, y1: 3.6, slot: b.wall });
  const cw = Math.min(s.hw - 1, 12), cd = Math.min(s.hd * 0.45, 7), cz = s.z + s.hd * 0.3, ch = 5.2;
  addBox(b, 2, s.x, ch, cz, cw, 0.45, cd, "metal");
  addBox(b, 1, s.x, ch - 0.5, cz, cw - 0.2, 0.06, cd - 0.2, "shopCool");
  addBox(b, 1, s.x, ch, cz + cd + 0.05, cw, 0.25, 0.05, b.neon);
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) addBox(b, 1, s.x + px * (cw - 1), ch / 2, cz + pz * (cd - 1), 0.25, ch / 2, 0.25, "metal");
  for (const px of [-0.5, 0.5]) addBox(b, 0, s.x + px * cw, 0.8, cz, 0.4, 0.8, 0.9, "backlit");
};

/** A parking garage: open decks on a column grid, sodium-lit, a stair tower at one corner. */
const decks: Op<"decks"> = (b) => {
  const s = b.site, n = Math.max(2, b.storeys), deck = 3;
  for (let k = 1; k <= n; k += 1) {
    addBox(b, 2, s.x, k * deck, s.z, s.hw, 0.25, s.hd, "concreteLight");
    addBox(b, 1, s.x, k * deck - 0.35, s.z, s.hw - 0.6, 0.06, s.hd - 0.6, "sodium");
    // (The parapet: a low band round the deck's edge.)
    addBox(b, 1, s.x, k * deck + 0.75, s.z + s.hd - 0.1, s.hw, 0.5, 0.1, "concreteLight");
  }
  for (let cx = -1; cx <= 1; cx += 1) for (const cz of [-1, 1]) addBox(b, 1, s.x + cx * (s.hw - 0.5), (n * deck) / 2, s.z + cz * (s.hd - 0.5), 0.35, (n * deck) / 2, 0.35, "concreteLight");
  b.masses.push({ ...s, y0: 0, y1: n * deck + 0.25, slot: "concreteLight" });
  addBox(b, 1, s.x - s.hw + 2.5, (n * deck + 3) / 2, s.z - s.hd + 2.5, 2.5, (n * deck + 3) / 2, 2.5, b.wall, { grid: true });
};

/** A diner: a low box with rounded ends, glass all round, chrome. */
const diner: Op<"diner"> = (b) => {
  const s = b.site, hw = Math.min(s.hw - 2, 9), hd = Math.min(s.hd - 2, 4), h = 3.6;
  addMass(b, { x: s.x, z: s.z, hw, hd, y0: 0, y1: h, slot: "metal" });
  for (const sx of [-1, 1]) addCapsule(b, 2, [s.x + sx * hw, 0, s.z], [s.x + sx * hw, h - hd, s.z], hd, "metal");
  addBox(b, 1, s.x, 1.9, s.z, hw + 0.05, 0.8, hd + 0.05, "shopWarm");
};

/** A gable across the building: two wedges back to back, the ridge running across its front. */
export function gable(b: Build, x: number, z: number, hw: number, hd: number, y: number, rise: number, slot: SlotName): void {
  for (const side of [1, -1]) addBox(b, 1, x, y + rise / 2, z + (side * hd) / 2, hw, rise / 2, hd / 2, slot, { wedge: true, turn: side > 0 ? 0 : Math.PI });
}

const OPS: { [K in MassOp["op"]]?: Op<K> } = { extrude, podium, tower, setbacks, wings, cantilever, rows, nave, canopy, decks, diner, park, plaza, commons, ...BUSINESS_OPS, ...CIVIC_OPS };

/** Run a massing op (roofs, crowns and trim are details.ts's). */
export function mass(b: Build, op: MassOp): boolean {
  const f = OPS[op.op] as Op<typeof op.op> | undefined;
  if (!f) return false;
  f(b, op as never);
  return true;
}
