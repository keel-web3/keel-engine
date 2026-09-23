// What a building wears on top: its roof (flat, gable, a factory's sawtooth),
// a crown for the skyline (a stepped top, a spire, a mast with its red
// beacon, lit fins, a pyramid, a helipad, a slanted glass top), the trim at its
// edge (cornice, belt courses), and the rooftop kit -- water towers on the old
// roofs, HVAC fields, stair bulkheads, antennas, chimneys.

import type { Build, Mass } from "./frame.ts";
import { addBox, addCapsule, count, pick, topMass, within } from "./frame.ts";
import { gable } from "./massing.ts";
import type { CrownKind, MassOp, RoofRule } from "./types.ts";

type Top = Mass;

/** The roof slab and its parapet: every flat top has one. */
function flat(b: Build, m: Top): void {
  addBox(b, 2, m.x, m.y1 + 0.15, m.z, m.hw - 0.3, 0.15, m.hd - 0.3, "roof");
  addBox(b, 1, m.x, m.y1 + 0.45, m.z + m.hd - 0.15, m.hw, 0.45, 0.15, "trim");
  addBox(b, 1, m.x, m.y1 + 0.45, m.z - m.hd + 0.15, m.hw, 0.45, 0.15, "trim");
}

export function roof(b: Build, op: Extract<MassOp, { op: "roof" }>): void {
  const m = topMass(b);
  if (!m) return;
  const kind = pick(b.D, "roof", op.kinds) ?? "flat";
  if (kind === "gable") { gable(b, m.x, m.z, m.hw + 0.3, m.hd + 0.3, m.y1, Math.min(m.hd, m.hw) * within(b.D, "pitch", [0.5, 0.8]), "roof"); b.masses.push({ ...m, y0: m.y1, y1: m.y1 + 0.01 }); return; }
  if (kind === "sawtooth") {
    // (Teeth across the depth, each rising to the back: the north lights of a mill.)
    const n = Math.max(2, Math.round(m.hd / 4)), d = m.hd / n;
    for (let k = 0; k < n; k += 1) addBox(b, 1, m.x, m.y1 + 1.2, m.z - m.hd + d * (2 * k + 1), m.hw, 1.2, d, "corrugated", { wedge: true, turn: Math.PI });
    return;
  }
  flat(b, m);
}

export function crown(b: Build, op: Extract<MassOp, { op: "crown" }>): void {
  const m = topMass(b);
  if (!m) return;
  const kind: CrownKind = pick(b.D, "crown", op.kinds) ?? "flat";
  const y = m.y1, lit = !b.derelict;
  switch (kind) {
    case "parapet": addBox(b, 2, m.x, y + 0.6, m.z, m.hw + 0.25, 0.6, m.hd + 0.25, "trim"); break;
    case "stepped": {
      // (Two or three shrinking tiers, each a storey or two: a deco top.)
      let hw = m.hw, hd = m.hd, at = y;
      for (let t = 0; t < 2 + count(b.D, "steps", [0, 1]); t += 1) {
        hw *= 0.72; hd *= 0.72;
        const h = b.storey * (1 + (t === 0 ? 1 : 0));
        addBox(b, 1, m.x, at + h / 2, m.z, hw, h / 2, hd, b.wall, { grid: true });
        if (lit) addBox(b, 1, m.x, at + h - 0.1, m.z, hw + 0.05, 0.1, hd + 0.05, "led");
        at += h;
      }
      addCapsule(b, 1, [m.x, at, m.z], [m.x, at + within(b.D, "needle", [6, 16]), m.z], 0.35, "metal");
      break;
    }
    case "spire": addCapsule(b, 1, [m.x, y, m.z], [m.x, y + within(b.D, "spire", [14, 34]), m.z], Math.min(1.4, m.hw * 0.15), "metal"); break;
    case "mast": {
      const h = within(b.D, "mast", [12, 30]);
      addBox(b, 1, m.x, y + 1.5, m.z, 2, 1.5, 2, "concreteDark");
      addBox(b, 1, m.x, y + 3 + h / 2, m.z, 0.3, h / 2, 0.3, "metal");
      addBox(b, 1, m.x, y + 3 + h + 0.4, m.z, 0.5, 0.4, 0.5, "beacon");
      break;
    }
    case "fins": {
      // (Lit fins along the front edge: a glass tower's crown at night.)
      const n = 3 + count(b.D, "fins", [0, 3]), h = within(b.D, "finH", [5, 12]);
      for (let k = 0; k < n; k += 1) addBox(b, 1, m.x - m.hw + (2 * m.hw * (k + 0.5)) / n, y + h / 2, m.z + m.hd - 0.3, 0.25, h / 2, 0.25, lit ? "led" : "metal");
      addBox(b, 1, m.x, y + 0.5, m.z, m.hw - 0.4, 0.5, m.hd - 0.4, "roof");
      break;
    }
    case "pyramid": {
      const rise = Math.min(m.hw, m.hd) * within(b.D, "pyramid", [0.6, 1.1]);
      gable(b, m.x, m.z, m.hw, m.hd, y, rise, "metal");
      break;
    }
    case "helipad": {
      addBox(b, 1, m.x, y + 0.8, m.z, Math.min(m.hw, 9), 0.2, Math.min(m.hd, 9), "concreteDark");
      if (lit) for (const s of [-1, 1]) addBox(b, 1, m.x + s * (Math.min(m.hw, 9) - 0.2), y + 1.05, m.z, 0.15, 0.08, Math.min(m.hd, 9), "led");
      addBox(b, 0, m.x + m.hw - 0.6, y + 1.6, m.z + m.hd - 0.6, 0.3, 0.3, 0.3, "beacon");
      break;
    }
    case "slant": {
      // (A sloped glass top, falling to the front.)
      const rise = within(b.D, "slant", [6, 14]);
      addBox(b, 1, m.x, y + rise / 2, m.z, m.hw, rise / 2, m.hd, b.wall, { wedge: true });
      break;
    }
    default: flat(b, m);
  }
  if (kind !== "flat" && kind !== "slant" && kind !== "pyramid") addBox(b, 2, m.x, y + 0.1, m.z, m.hw - 0.2, 0.1, m.hd - 0.2, "roof");
}

/** A cornice round the top of the main mass. */
export function cornice(b: Build): void {
  const m = b.masses[0];
  if (!m || (b.derelict && b.D.u("brokenCornice") < 0.5)) return;
  addBox(b, 1, m.x, m.y1 - 0.3, m.z, m.hw + 0.45, 0.3, m.hd + 0.45, "trim");
}

/** Belt courses every few floors up the main mass (at most four). */
export function bands(b: Build, op: Extract<MassOp, { op: "bands" }>): void {
  const m = b.masses[0];
  if (!m) return;
  const every = count(b.D, "bandEvery", op.every) * b.storey;
  for (let y = m.y0 + every, n = 0; y < m.y1 - 1 && n < 4; y += every, n += 1) addBox(b, 1, m.x, y, m.z, m.hw + 0.15, 0.18, m.hd + 0.15, "trim");
}

/** A spot on the roof, clear of its edges (the building's frame). */
const spot = (b: Build, m: Top, tag: string, i: number, margin: number): [number, number] => [
  m.x + b.D.flat(`${tag}X`, i) * Math.max(0, m.hw - margin), m.z + b.D.flat(`${tag}Z`, i) * Math.max(0, m.hd - margin),
];

/** The rooftop kit, by the archetype's rules. */
export function rooftop(b: Build, rules: readonly RoofRule[]): void {
  const m = topMass(b);
  if (!m || m.hw < 3 || m.hd < 3) return;
  // (The kit stands on the roof slab; the building's top -- a ridge, a spire -- only decides the beacons and chimneys.)
  const y = m.y1 + 0.3, top = b.top;
  rules.forEach((r, ri) => {
    if (b.D.u("roofKit", ri) >= r.chance) return;
    const n = r.count ? count(b.D, "roofN", r.count, ri) : 1;
    for (let k = 0; k < n; k += 1) {
      const i = ri * 16 + k;
      switch (r.kind) {
        case "waterTower": {
          // (Legs, a timber tank, a conical cap: the old roofs' signature.)
          const [x, z] = spot(b, m, "tank", i, 3.2), ly = m.y1 + 1.6;
          for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) addBox(b, 0, x + px * 1.3, m.y1 + 0.8 + 0.8, z + pz * 1.3, 0.12, 1.6, 0.12, "metal");
          addCapsule(b, 1, [x, ly + 2, z], [x, ly + 3.8, z], 1.8, "timber");
          addBox(b, 1, x, ly + 5.9, z, 1.9, 0.5, 1.9, "roof", { wedge: true, lo: 0.2 });
          break;
        }
        case "hvac": { const [x, z] = spot(b, m, "hvac", i, 2); addBox(b, 0, x, y + 0.7, z, within(b.D, "hvacW", [0.8, 1.8], i), 0.7, within(b.D, "hvacD", [0.8, 1.5], i), "metal"); break; }
        case "bulkhead": { const [x, z] = spot(b, m, "bulk", i, 3); addBox(b, 0, x, y + 1.5, z, 1.6, 1.5, 2.2, "trim"); break; }
        case "antenna": {
          const [x, z] = spot(b, m, "ant", i, 1.5), h = within(b.D, "antH", [4, 12], i) + (top > 80 ? 10 : 0);
          addBox(b, 0, x, y + h / 2, z, 0.1, h / 2, 0.1, "metal");
          if (top > 60) addBox(b, 0, x, y + h + 0.2, z, 0.25, 0.25, 0.25, "beacon");
          break;
        }
        case "chimney": { const [x, z] = spot(b, m, "chim", i, 1); addBox(b, 0, x, (m.y1 + top + 1.2) / 2, z, 0.45, (top + 1.2 - m.y1) / 2, 0.45, b.wall === "siding" || b.wall === "stucco" ? "redBrick" : b.wall); break; }
      }
    }
  });
}
