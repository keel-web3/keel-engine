// A belt round the hips: a plain strap, one with pouches, or a sash with its
// ends hanging. Built to the waist socket ("around": a ring at the hips).
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { dsin, dcos } from "@keel-engine/core";
import { CLOTH, HUMANS, LEATHER, METAL, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "belt",
  slot: "waist",
  title: "Belt",
  tags: ["belt", "waist"],
  targets: [HUMANS],
  choices: { form: ["strap", "pouches", "sash"] },
  look: { roles: { secondary: LEATHER, trim: { ...METAL, finishes: ["metal"] }, primary: CLOTH } },
  build(S, fit, pins) {
    const form = choose(S, pins, "form", ["strap", "pouches", "sash"] as const);
    const R = fit.size[0] / 2, U = fit.size[1];
    const capsules: AttributeCapsule[] = [];
    const boxes: AttributeBox[] = [];
    const role = form === "sash" ? "primary" : "secondary";
    const n = 6;
    for (let i = 0; i < n; i += 1) {
      const a0 = (i / n) * 6.283185307179586, a1 = ((i + 1) / n) * 6.283185307179586;
      capsules.push({ a: [dsin(a0) * R * 1.05, 0, dcos(a0) * R * 1.05], b: [dsin(a1) * R * 1.05, 0, dcos(a1) * R * 1.05], r: U * 0.28, role, part: "belt" });
    }
    boxes.push({ c: [0, 0, R * 1.12], h: [R * 0.22, U * 0.3, R * 0.06], role: "trim", part: "belt.buckle" });
    if (form === "pouches") for (const s of [-1, 1]) boxes.push({ c: [s * R * 0.75, -U * 0.4, R * 0.85], h: [R * 0.2, U * 0.45, R * 0.16], role: "secondary", part: "belt.pouch" });
    if (form === "sash") capsules.push({ a: [R * 0.6, 0, R * 0.9], b: [R * 0.75, -U * 3.2, R * 0.8], r: U * 0.2, role: "primary", part: "belt.sash" });
    return { capsules, boxes };
  },
});
