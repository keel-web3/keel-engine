// A circlet: a thin band round the brow, a gem at the front (or three), and a
// spire rising over the brow -- short or tall. Built to the head socket.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { dsin, dcos } from "@keel-engine/core";
import { HUMANS, METAL, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "circlet",
  slot: "head",
  title: "Circlet",
  tags: ["crown", "circlet", "holy", "magic"],
  targets: [HUMANS],
  choices: { gems: [1, 3], spire: ["short", "tall"] },
  look: { roles: { trim: { ...METAL, finishes: ["metal"] }, glow: { stuff: "glow" } } },
  build(S, fit, pins) {
    const gems = choose(S, pins, "gems", [1, 3] as const);
    const spire = choose(S, pins, "spire", ["short", "tall"] as const);
    const hr = fit.size[1];
    const capsules: AttributeCapsule[] = [];
    const y = -0.42 * hr, R = 0.9 * hr;
    // (The band: a ring of short capsules round the brow.)
    const n = 6;
    for (let i = 0; i < n; i += 1) {
      const a0 = (i / n) * 6.283185307179586, a1 = ((i + 1) / n) * 6.283185307179586;
      capsules.push({ a: [dsin(a0) * R, y, dcos(a0) * R], b: [dsin(a1) * R, y, dcos(a1) * R], r: 0.06 * hr, role: "trim", part: "circlet" });
    }
    for (let g = 0; g < gems; g += 1) {
      const a = (g - (gems - 1) / 2) * 0.45;
      capsules.push({ a: [dsin(a) * R * 1.02, y + 0.05 * hr, dcos(a) * R * 1.02], b: [dsin(a) * R * 1.02, y + 0.05 * hr, dcos(a) * R * 1.02], r: (g === (gems - 1) / 2 ? 0.14 : 0.1) * hr, role: "glow", part: "circlet.gem" });
    }
    capsules.push({ a: [0, y, R], b: [0, y + (spire === "tall" ? 0.75 : 0.55) * hr, R * 0.9], r: 0.07 * hr, role: "trim", part: "circlet.spire" });
    return { capsules };
  },
});
