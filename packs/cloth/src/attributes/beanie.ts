// A beanie: a knitted dome hugging the crown, snug or tall, a fold-up cuff
// (none, low or high), a pompom (none, small, big), sitting straight or
// slouched back. Built to the head socket: the crown at the origin, the head
// ball a head radius (size[1]) below it. Its knit ribs are the look's (a
// bands pattern on the primary), not geometry.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, HUMANS, KNIT, amount, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "beanie",
  slot: "head",
  title: "Beanie",
  tags: ["hat", "knit", "winter"],
  targets: [HUMANS, ANIMALS],
  choices: { pompom: ["none", "small", "big"], fold: ["none", "low", "high"], crown: ["snug", "tall"], slouch: { range: [0, 1] } },
  look: { roles: { primary: { ...KNIT, patterns: ["none", "bands", "bands", "stripes", "checks"] }, secondary: { ...KNIT, patterns: ["none", "bands"] }, trim: KNIT } },
  build(S, fit, pins) {
    const pompom = choose(S, pins, "pompom", ["none", "small", "big"] as const);
    const fold = choose(S, pins, "fold", ["none", "low", "high"] as const);
    const crown = choose(S, pins, "crown", ["snug", "tall"] as const);
    const slouch = amount(S, pins, "slouch", [0, 1]);
    const hr = fit.size[1];
    const capsules: AttributeCapsule[] = [
      { a: [-0.42 * hr, -0.28 * hr, -0.05 * hr], b: [0.42 * hr, -0.28 * hr, -0.05 * hr], r: 0.72 * hr, role: "primary", part: "beanie" },
    ];
    const tall = crown === "tall";
    if (tall) capsules.push({ a: [0, 0, -0.08 * hr], b: [0, 0.32 * hr, -0.12 * hr], r: 0.5 * hr, role: "primary", part: "beanie.crown" });
    const slouched = slouch > 0.15;
    if (slouched) capsules.push({ a: [0, -0.1 * hr, -0.2 * hr], b: [0, (tall ? 0.34 : 0.18) * hr, -(0.35 + 0.45 * slouch) * hr], r: 0.46 * hr, role: "primary", part: "beanie.slouch" });
    const top: [number, number, number] = slouched ? [0, (tall ? 0.64 : 0.46) * hr, -(0.35 + 0.45 * slouch) * hr] : [0, (tall ? 0.8 : 0.5) * hr, -0.08 * hr];
    if (pompom !== "none") capsules.push({ a: top, b: top, r: (pompom === "big" ? 0.3 : 0.17) * hr, role: "trim", part: "beanie.pompom" });
    const cuff = fold === "none" ? [] : [{ c: [0, (fold === "high" ? -0.52 : -0.62) * hr, -0.05 * hr] as [number, number, number], h: [0.98 * hr, (fold === "high" ? 0.22 : 0.12) * hr, 0.9 * hr] as [number, number, number], role: "secondary" as const, part: "beanie.cuff" }];
    return { capsules, boxes: cuff };
  },
});
