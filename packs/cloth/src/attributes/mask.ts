// A mask over the face: a bone skull, a plague doctor's beak, or a plain
// half-mask with glowing eye slits. Built to the face socket.
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { BONE, HUMANS, LEATHER, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "mask",
  slot: "face",
  title: "Mask",
  tags: ["mask", "face", "sinister"],
  targets: [HUMANS],
  choices: { form: ["skull", "beak", "half"] },
  look: { roles: { primary: LEATHER, secondary: BONE, glow: { stuff: "glow" } } },
  build(S, fit, pins) {
    const form = choose(S, pins, "form", ["skull", "beak", "half"] as const);
    const w = fit.size[0] / 2, h = fit.size[1];
    const capsules: AttributeCapsule[] = [];
    const boxes: AttributeBox[] = [];
    if (form === "beak") capsules.push({ a: [0, -0.15 * h, 0.1 * w], b: [0, -0.7 * h, 1.3 * w], r: 0.28 * w, role: "primary", part: "mask.beak" });
    boxes.push({ c: [0, form === "half" ? 0.05 * h : -0.15 * h, 0.12 * w], h: [w * 0.95, form === "half" ? 0.35 * h : 0.75 * h, 0.12 * w], role: form === "skull" ? "secondary" : "primary", part: "mask" });
    for (const s of [-1, 1]) capsules.push({ a: [s * 0.4 * w, 0.05 * h, 0.28 * w], b: [s * 0.4 * w, 0.05 * h, 0.28 * w], r: 0.14 * w, role: "glow", part: "mask.eye" });
    return { capsules, boxes };
  },
});
