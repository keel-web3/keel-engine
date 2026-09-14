// A horned helmet: a metal dome (round, pointed or flat-topped) with a rim,
// a pair of horns -- short, long, or long and curling forward -- a nasal
// guard or none, and a crest along the top: none, a ridge or a plume. Built to
// the head socket: the crown at the origin, the head ball a radius below.
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, BONE, CLOTH, HUMANS, METAL, choose } from "../kit.ts";
import type { V3 } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "horned-helmet",
  slot: "head",
  title: "Horned helmet",
  tags: ["hat", "helmet", "horns", "armour"],
  targets: [HUMANS, ANIMALS],
  choices: { horns: ["short", "long", "curled"], dome: ["round", "pointed", "flat"], nasal: [false, true], crest: ["none", "ridge", "plume"] },
  look: { roles: { primary: { ...METAL, patterns: ["none", "none", "bands", "trim"] }, secondary: BONE, trim: { ...METAL, finishes: ["metal"] }, accent: CLOTH } },
  build(S, fit, pins) {
    const horns = choose(S, pins, "horns", ["short", "long", "curled"] as const);
    const dome = choose(S, pins, "dome", ["round", "pointed", "flat"] as const);
    const nasal = choose(S, pins, "nasal", [false, true]);
    const crest = choose(S, pins, "crest", ["none", "ridge", "plume"] as const);
    const hr = fit.size[1];
    const capsules: AttributeCapsule[] = [];
    const boxes: AttributeBox[] = [];
    if (dome === "flat") boxes.push({ c: [0, -0.2 * hr, -0.05 * hr], h: [0.84 * hr, 0.34 * hr, 0.8 * hr], role: "primary", part: "helmet" });
    else capsules.push({ a: [-0.4 * hr, -0.3 * hr, -0.05 * hr], b: [0.4 * hr, -0.3 * hr, -0.05 * hr], r: 0.74 * hr, role: "primary", part: "helmet" });
    if (dome === "pointed") capsules.push({ a: [0, 0.1 * hr, -0.05 * hr], b: [0, 0.7 * hr, -0.1 * hr], r: 0.26 * hr, role: "primary", part: "helmet.point" });
    boxes.push({ c: [0, -0.62 * hr, -0.05 * hr], h: [0.98 * hr, 0.08 * hr, 0.92 * hr], role: "trim", part: "helmet.rim" });
    if (nasal) boxes.push({ c: [0, -0.84 * hr, 0.82 * hr], h: [0.07 * hr, 0.26 * hr, 0.05 * hr], role: "trim", part: "helmet.nasal" });
    for (const s of [-1, 1]) {
      const root: V3 = [s * 0.72 * hr, -0.35 * hr, -0.05 * hr];
      const mid: V3 = horns === "short" ? [s * 1.1 * hr, 0.1 * hr, 0] : [s * 1.25 * hr, -0.05 * hr, 0];
      capsules.push({ a: root, b: mid, r: 0.16 * hr, role: "secondary", part: "helmet.horn" });
      // (Long horns rise out and up; curled ones sweep forward over the brow at their tips.)
      if (horns === "long") capsules.push({ a: mid, b: [s * 1.5 * hr, 0.6 * hr, 0.05 * hr], r: 0.1 * hr, role: "secondary", part: "helmet.horn" });
      if (horns === "curled") capsules.push({ a: mid, b: [s * 1.4 * hr, 0.75 * hr, 0.45 * hr], r: 0.1 * hr, role: "secondary", part: "helmet.horn" });
    }
    if (crest === "ridge") boxes.push({ c: [0, (dome === "flat" ? 0.16 : 0.4) * hr, -0.05 * hr], h: [0.06 * hr, 0.1 * hr, 0.62 * hr], role: "trim", part: "helmet.crest" });
    if (crest === "plume") capsules.push({ a: [0, (dome === "pointed" ? 0.7 : 0.38) * hr, -0.05 * hr], b: [0, (dome === "pointed" ? 1.05 : 0.8) * hr, -0.6 * hr], r: 0.14 * hr, role: "accent", part: "helmet.plume" });
    return { capsules, boxes };
  },
});
