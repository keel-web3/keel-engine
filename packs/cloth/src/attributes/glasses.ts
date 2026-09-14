// Glasses: frames round, square, aviator, cat-eye or a visor -- a bridge
// between the lenses, arms back to the ears. Built to the face socket: its
// origin on the face at eye height, +z out of the face. Whether the lenses are
// clear, shaded or glowing is the look's (the lens role's finish).
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, HUMANS, amount, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "glasses",
  slot: "face",
  title: "Glasses",
  tags: ["glasses", "face"],
  targets: [HUMANS, ANIMALS],
  choices: { frame: ["round", "square", "aviator", "cat-eye", "visor"], size: { range: [0.85, 1.15] } },
  look: { roles: { detail: { stuff: "metal", finishes: ["metal", "matte"] }, secondary: { stuff: "glow", finishes: ["glow", "metal", "matte"] } } },
  build(S, fit, pins) {
    const frame = choose(S, pins, "frame", ["round", "square", "aviator", "cat-eye", "visor"] as const);
    const k = amount(S, pins, "size", [0.85, 1.15]);
    const W = fit.size[0]; // (1.8 head radii)
    const z = fit.size[2] * 0.12;
    const x = W * 0.26;
    const lr = W * 0.15 * k;
    const capsules: AttributeCapsule[] = [];
    const boxes: AttributeBox[] = [];
    if (frame === "visor") {
      boxes.push({ c: [0, 0, z], h: [W * 0.46 * k, lr * 0.6, W * 0.03], role: "secondary", part: "glasses.lens" });
    } else {
      capsules.push({ a: [-x + lr * 0.9, frame === "aviator" ? lr * 0.3 : 0, z], b: [x - lr * 0.9, frame === "aviator" ? lr * 0.3 : 0, z], r: W * 0.02, role: "detail", part: "glasses.bridge" });
      for (const s of [-1, 1]) {
        if (frame === "round") capsules.push({ a: [s * x, 0, z], b: [s * x, 0, z + W * 0.01], r: lr, role: "secondary", part: "glasses.lens" });
        else if (frame === "aviator") capsules.push({ a: [s * x, lr * 0.15, z], b: [s * x * 0.94, -lr * 0.35, z], r: lr * 0.82, role: "secondary", part: "glasses.lens" });
        else boxes.push({ c: [s * x, 0, z], h: [lr, lr * 0.75, W * 0.02], role: "secondary", part: "glasses.lens" });
        if (frame === "cat-eye") boxes.push({ c: [s * (x + lr * 0.95), lr * 0.72, z], h: [lr * 0.35, lr * 0.16, W * 0.02], role: "detail", part: "glasses.flick" });
      }
    }
    for (const s of [-1, 1]) capsules.push({ a: [s * (x + lr), 0, z], b: [s * W * 0.56, 0, -W * 0.55], r: W * 0.018, role: "detail", part: "glasses.arm" });
    return { capsules, boxes };
  },
});
