// A wizard's hat: a brim (wide, narrow or none), a crown that rises tall or
// taller and bends back (or droops) at its tip, a band. Built to the head
// socket: the crown at the origin, the head ball a radius below.
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { CLOTH, HUMANS, PAINT, amount, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "wizard-hat",
  slot: "head",
  title: "Wizard's hat",
  tags: ["hat", "wizard", "magic"],
  targets: [HUMANS],
  choices: { brim: ["wide", "narrow", "none"], crown: { range: [0.6, 1.8] }, tip: ["bent", "droop", "straight"], band: [true, false] },
  look: { roles: { primary: { ...CLOTH, patterns: ["none", "none", "trim", "stripes", "gradient"] }, secondary: CLOTH, trim: PAINT } },
  build(S, fit, pins) {
    const brim = choose(S, pins, "brim", ["wide", "narrow", "none"] as const);
    const crown = amount(S, pins, "crown", [0.6, 1.8]);
    const tip = choose(S, pins, "tip", ["bent", "droop", "straight"] as const);
    const band = choose(S, pins, "band", [true, false]);
    const hr = fit.size[1];
    const capsules: AttributeCapsule[] = [];
    const boxes: AttributeBox[] = [];
    if (brim !== "none") {
      const R = (brim === "wide" ? 1.75 : 1.25) * hr;
      // (A disc: three flat boards turned a sixth of a turn apart -- a twelve-sided brim, a little down over the head.)
      for (let i = 0; i < 3; i += 1) boxes.push({ c: [0, -0.18 * hr, 0], h: [R, 0.05 * hr, R * 0.58], yaw: (i * Math.PI) / 3, role: "primary", part: "hat.brim" });
    }
    // The crown: a cone of shrinking capsules up from the head, leaning back as it goes.
    const H = crown * 1.6 * hr;
    const steps = 4;
    let prev: [number, number, number] = [0, -0.1 * hr, 0];
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const lean = tip === "straight" ? 0.1 * t : tip === "bent" ? 0.35 * t * t : 0.15 * t;
      const p: [number, number, number] = [0, -0.1 * hr + H * t, -lean * H];
      capsules.push({ a: prev, b: p, r: (0.78 - 0.62 * t) * hr, role: "primary", part: "hat.crown" });
      prev = p;
    }
    if (tip === "bent") capsules.push({ a: prev, b: [0, prev[1] - 0.05 * hr, prev[2] - 0.55 * hr], r: 0.1 * hr, role: "primary", part: "hat.tip" });
    if (tip === "droop") capsules.push({ a: prev, b: [0.1 * hr, prev[1] - 0.5 * hr, prev[2] - 0.45 * hr], r: 0.1 * hr, role: "primary", part: "hat.tip" });
    if (band) capsules.push({ a: [-0.66 * hr, 0.02 * hr, 0], b: [0.66 * hr, 0.02 * hr, 0], r: 0.14 * hr, role: "trim", part: "hat.band" });
    return { capsules, boxes };
  },
});
