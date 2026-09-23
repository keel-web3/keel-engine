// A breastplate: a cuirass over the chest and belly -- plain, ridged down the
// middle, or with a sigil on it -- and a skirt of tassets over the hips or not.
// Built to the chest socket (its front surface: out +z).
import type { AttributeBox, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { HUMANS, METAL, PAINT, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "breastplate",
  slot: "chest",
  title: "Breastplate",
  tags: ["armour", "chest"],
  targets: [HUMANS],
  choices: { face: ["plain", "ridged", "sigil"], tassets: [true, false] },
  look: { roles: { primary: { ...METAL, patterns: ["none", "none", "bands"] }, trim: { ...METAL, finishes: ["metal"] }, glow: PAINT } },
  build(S, fit, pins) {
    const face = choose(S, pins, "face", ["plain", "ridged", "sigil"] as const);
    const tassets = choose(S, pins, "tassets", [true, false]);
    const [W, U, D] = fit.size;
    const boxes: AttributeBox[] = [
      { c: [0, 0, -D * 0.35], h: [W * 0.56, U * 0.62, D * 0.62], role: "primary", part: "breastplate" },
      { c: [0, -U * 0.9, -D * 0.45], h: [W * 0.5, U * 0.32, D * 0.55], role: "primary", part: "breastplate.belly" },
      { c: [0, U * 0.58, -D * 0.4], h: [W * 0.58, U * 0.08, D * 0.62], role: "trim", part: "breastplate.rim" },
    ];
    if (face === "ridged") boxes.push({ c: [0, -U * 0.2, D * 0.3], h: [W * 0.06, U * 0.7, D * 0.08], role: "trim", part: "breastplate.ridge" });
    if (face === "sigil") boxes.push({ c: [0, 0, D * 0.3], h: [W * 0.18, U * 0.22, D * 0.06], role: "glow", part: "breastplate.sigil" });
    if (tassets) for (const s of [-1, 0, 1]) boxes.push({ c: [s * W * 0.34, -U * 1.45, -D * 0.4], h: [W * 0.17, U * 0.3, D * 0.5], role: "trim", part: "breastplate.tasset" });
    return { boxes };
  },
});
