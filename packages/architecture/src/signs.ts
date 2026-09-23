// Signage and light, the loudest thing a district says at night: a lit
// storefront band, neon blades off old brick, awnings, a sign or a billboard
// on the roof, a pole sign out at the kerb, a hotel's marquee, LED lines round a
// glass tower's crown and up its corners, sodium floodlights on a warehouse.
// A derelict building's signs are dark (its storefront boarded).

import type { Build } from "./frame.ts";
import { addAd, addBox, count, topMass, within } from "./frame.ts";
import type { SignKind, SignRule } from "./types.ts";

type Sign = (b: Build, i: number) => void;

/** The front face's line (building frame z) and its main mass. */
const front = (b: Build) => { const m = b.masses[0]!; return { m, z: m.z + m.hd }; };

const SIGNS: Readonly<Record<SignKind, Sign>> = {
  storefront: (b) => {
    const { m, z } = front(b), h = Math.max(2.4, b.groundH * 0.62);
    addBox(b, 1, m.x, h / 2 + 0.3, z + 0.12, m.hw - 0.4, h / 2, 0.12, b.derelict ? "boarded" : b.D.u("shopTone") < 0.6 ? "shopWarm" : "shopCool");
    if (!b.derelict) addBox(b, 0, m.x, h + 0.75, z + 0.2, m.hw - 0.2, 0.3, 0.2, "trim");
  },
  fascia: (b) => {
    // (A strip mall: a backlit box a unit along its fascia.)
    const { m, z } = front(b), units = Math.max(2, Math.round((m.hw * 2) / 9)), w = (m.hw * 2) / units;
    for (let k = 0; k < units; k += 1) {
      if (b.derelict && b.D.u("dark", k) < 0.6) continue;
      addBox(b, 1, m.x - m.hw + w * (k + 0.5), m.y1 - 0.9, z + 0.3, w * 0.36, 0.55, 0.3, b.D.u("fascia", k) < 0.7 ? "backlit" : b.neon);
    }
  },
  blade: (b, i) => {
    if (b.derelict) return;
    // (A tall neon blade on a bracket off one front corner, clear of the shopfront.)
    const { m, z } = front(b), side = b.D.u("bladeSide", i) < 0.5 ? -1 : 1;
    const len = Math.min(m.y1 - 4.5, within(b.D, "blade", [3, 9], i));
    if (len < 2) return;
    const x = m.x + side * (m.hw - 1.2), y = 4.2 + len / 2;
    addBox(b, 1, x, y, z + 1, 0.14, len / 2, 0.75, b.neon);
    addBox(b, 0, x, y + len / 2 + 0.15, z + 0.5, 0.1, 0.1, 0.5, "metal");
  },
  awning: (b) => {
    const { m, z } = front(b);
    addBox(b, 0, m.x, b.groundH * 0.72 + 0.5, z + 0.9, m.hw - 0.6, 0.5, 0.9, b.derelict ? "derelict" : "trim", { wedge: true, lo: 0.1 });
  },
  rooftop: (b) => {
    if (b.derelict) return;
    // (A sign on the roof: two posts and a lit box facing the street.)
    const m = topMass(b)!, w = Math.min(m.hw * 0.8, within(b.D, "roofSign", [3, 8])), h = within(b.D, "roofSignH", [1, 2.4]);
    for (const s of [-1, 1]) addBox(b, 0, m.x + s * w * 0.8, m.y1 + 1, m.z + m.hd - 1, 0.1, 1, 0.1, "metal");
    addBox(b, 1, m.x, m.y1 + 2 + h, m.z + m.hd - 1, w, h, 0.2, b.D.u("roofSignKind") < 0.5 ? b.neon : "backlit");
    addAd(b, `${b.key}:roof`, "backlit", m.x, m.y1 + 2 + h, m.z + m.hd - 0.78, 2 * w, 2 * h);
  },
  billboard: (b) => {
    const m = topMass(b)!, w = Math.min(m.hw, 7), h = 2.6, y = m.y1 + 2.4 + h;
    addBox(b, 0, m.x, m.y1 + 1.2, m.z, 0.2, 1.2 + h / 2, 0.2, "metal");
    addBox(b, 1, m.x, y, m.z, w, h, 0.15, b.derelict ? "derelict" : "billboard");
    if (!b.derelict) addAd(b, `${b.key}:billboard`, "billboard", m.x, y, m.z + 0.16, 2 * w, 2 * h);
    if (!b.derelict) addBox(b, 0, m.x, y - h - 0.2, m.z + 0.6, w * 0.8, 0.08, 0.08, "led");
  },
  pole: (b) => {
    // (Out at the kerb, one front corner: a post and a big lit box.)
    const x = (b.D.u("poleSide") < 0.5 ? -1 : 1) * (b.frame.hw - 1), z = b.frame.hd - 1;
    const h = within(b.D, "poleH", [7, 15]), w = within(b.D, "poleW", [1.5, 3]);
    addBox(b, 1, x, h / 2, z, 0.2, h / 2, 0.2, "metal");
    addBox(b, 1, x, h + 1, z, w, 1.1, 0.35, b.derelict ? "derelict" : b.D.u("poleKind") < 0.5 ? b.neon : "backlit");
  },
  marquee: (b) => {
    if (b.derelict) return;
    const { m, z } = front(b), w = Math.min(m.hw * 0.5, 6);
    addBox(b, 1, m.x, b.groundH + 0.5, z + 1.6, w, 0.6, 1.6, "backlit");
    addBox(b, 1, m.x, b.groundH + 1.2, z + 1.6, w + 0.1, 0.08, 1.7, b.neon);
  },
  ledCrown: (b) => {
    if (b.derelict) return;
    const m = topMass(b)!, y = m.y1 - 0.2;
    for (const s of [-1, 1]) {
      addBox(b, 1, m.x, y, m.z + s * (m.hd + 0.05), m.hw + 0.05, 0.12, 0.06, "led");
      addBox(b, 1, m.x + s * (m.hw + 0.05), y, m.z, 0.06, 0.12, m.hd + 0.05, "led");
    }
  },
  ledEdges: (b) => {
    if (b.derelict) return;
    // (Up the corners of the tower, from its base to its top.)
    const m = topMass(b)!, h = (m.y1 - m.y0) / 2, y = (m.y1 + m.y0) / 2;
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) addBox(b, 1, m.x + sx * (m.hw + 0.04), y, m.z + sz * (m.hd + 0.04), 0.08, h, 0.08, b.D.u("edgeTone") < 0.5 ? "led" : b.neon);
  },
  cross: (b) => {
    // (A hospital's lit cross, high on the front of its tallest mass.)
    if (b.derelict) return;
    const m = topMass(b)!, y = m.y1 - 3.2, z = m.z + m.hd + 0.25, k = Math.min(2.4, m.hw * 0.3);
    addBox(b, 1, m.x, y, z, k * 0.3, k, 0.2, "beacon");
    addBox(b, 1, m.x, y, z, k, k * 0.3, 0.2, "beacon");
  },
  flags: (b) => {
    // (Three flagpoles out front, one to a side of the door: a civic building's, a dealer's.)
    const z = b.frame.hd - 1.5, h = within(b.D, "flagH", [7, 10]);
    for (let k = -1; k <= 1; k += 1) {
      const x = Math.min(b.frame.hw - 1.5, 5) * k * 0.6 + (b.D.u("flagAt") - 0.5) * b.frame.hw;
      addBox(b, 1, x, h / 2, z, 0.07, h / 2, 0.07, "metal");
      if (!b.derelict) addBox(b, 0, x + 0.75, h - 0.55, z, 0.7, 0.45, 0.03, k === 0 ? "trim" : b.neon);
    }
  },
  floodlight: (b) => {
    const { m, z } = front(b), n = 1 + count(b.D, "floods", [1, 3]);
    for (let k = 0; k < n; k += 1) addBox(b, 0, m.x - m.hw + (2 * m.hw * (k + 0.5)) / n, m.y1 - 0.8, z + 0.35, 0.35, 0.2, 0.35, "sodium");
  },
};

/** Its signs, by the archetype's rules (each its own draw). */
export function signs(b: Build, rules: readonly SignRule[]): void {
  if (!b.masses.length) return;
  rules.forEach((r, i) => { if (b.D.u("sign", i) < r.chance) SIGNS[r.kind](b, i); });
}
