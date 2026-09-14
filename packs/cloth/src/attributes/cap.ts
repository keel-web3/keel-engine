// A cap: a crown on the head (low or high), a peak -- short, long or flat --
// turned to the front, the side or the back, a button on top or none. Built to
// the head socket: the crown at the origin, +z the face.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, CLOTH, HUMANS, PAINT, amount, choose, turnY } from "../kit.ts";

const PEAK = { short: [0.26, 0.05], long: [0.46, 0.05], flat: [0.4, 0.035] } as const;
const TURN = { front: 0, side: 1.15, back: Math.PI } as const;

export default defineAttribute<AttributeShape>({
  id: "cap",
  slot: "head",
  title: "Cap",
  tags: ["hat", "cap", "sport"],
  targets: [HUMANS, ANIMALS],
  choices: { brim: ["short", "long", "flat"], turn: ["front", "side", "back"], crown: ["low", "high"], button: [true, false], reach: { range: [0.8, 1.2] } },
  look: { roles: { primary: { ...CLOTH, patterns: ["none", "none", "trim", "stripes", "checks", "camo"] }, secondary: CLOTH, trim: PAINT } },
  build(S, fit, pins) {
    const brim = choose(S, pins, "brim", ["short", "long", "flat"] as const);
    const turn = choose(S, pins, "turn", ["front", "side", "back"] as const);
    const crown = choose(S, pins, "crown", ["low", "high"] as const);
    const button = choose(S, pins, "button", [true, false]);
    const reach = amount(S, pins, "reach", [0.8, 1.2]);
    const hr = fit.size[1];
    const up = crown === "high" ? 0.14 : 0;
    const capsules: AttributeCapsule[] = [
      { a: [-0.38 * hr, (-0.35 + up) * hr, -0.08 * hr], b: [0.38 * hr, (-0.35 + up) * hr, -0.08 * hr], r: 0.68 * hr, role: "primary", part: "cap" },
    ];
    if (crown === "high") capsules.push({ a: [-0.3 * hr, -0.3 * hr, -0.08 * hr], b: [0.3 * hr, -0.3 * hr, -0.08 * hr], r: 0.7 * hr, role: "primary", part: "cap.band" });
    if (button) capsules.push({ a: [0, (0.34 + up) * hr, -0.08 * hr], b: [0, (0.34 + up) * hr, -0.08 * hr], r: 0.1 * hr, role: "trim", part: "cap.button" });
    const [len, thick] = PEAK[brim];
    const yaw = TURN[turn];
    const along = (0.62 + len * reach) * hr;
    return {
      capsules,
      boxes: [{ c: turnY([0, (brim === "flat" ? -0.46 : -0.52) * hr, along], yaw), h: [0.55 * hr, thick * hr, len * reach * hr], yaw, role: "secondary", part: "cap.peak" }],
    };
  },
});
