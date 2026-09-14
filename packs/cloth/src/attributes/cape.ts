// A cape: on two legs it hangs from the shoulders down the back -- short,
// long or trailing, its hem straight, tattered or trimmed, a high collar or a
// mantle over the shoulders or neither; on four legs the same choices make a
// caparison, a cloth over the back draping down both flanks. Built to the back
// socket (out -z behind a person, +y on top of an animal).
import type { AttributeBox, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, CLOTH, HUMANS, PAINT, choose, outOf } from "../kit.ts";

const LENGTH = { short: 1.2, long: 2, trailing: 2.6 } as const;

export default defineAttribute<AttributeShape>({
  id: "cape",
  slot: "back",
  title: "Cape",
  tags: ["cape", "cloth", "hero"],
  targets: [HUMANS, ANIMALS],
  choices: { length: ["short", "long", "trailing"], hem: ["straight", "tattered", "trimmed"], collar: ["none", "high", "mantle"] },
  look: { roles: { primary: { ...CLOTH, patterns: ["none", "none", "trim", "stripes", "checks", "gradient"] }, secondary: CLOTH, trim: PAINT } },
  build(S, fit, pins) {
    const length = choose(S, pins, "length", ["short", "long", "trailing"] as const);
    const hem = choose(S, pins, "hem", ["straight", "tattered", "trimmed"] as const);
    const collar = choose(S, pins, "collar", ["none", "high", "mantle"] as const);
    const [W, U, D] = fit.size;
    const boxes: AttributeBox[] = [];
    if (outOf(fit)[1] > 0.5) {
      // A caparison: over the back (y up, z along the body), down both flanks.
      const drop = LENGTH[length] * U * 0.45;
      const long = D * 0.55;
      boxes.push({ c: [0, 0.1 * U, 0], h: [W * 0.56, 0.08 * U, long], role: "primary", part: "cape" });
      for (const x of [-1, 1]) {
        const sideC: [number, number, number] = [x * W * 0.58, -drop / 2, 0];
        if (hem === "tattered") for (const k of [-1, 0, 1]) boxes.push({ c: [sideC[0], -drop * (k === 0 ? 0.55 : 0.45), (k * long * 2) / 3], h: [0.04 * U, drop * (k === 0 ? 0.55 : 0.45), long / 3], role: "primary", part: "cape.side" });
        else boxes.push({ c: sideC, h: [0.04 * U, drop / 2, long], role: "primary", part: "cape.side" });
        if (hem === "trimmed") boxes.push({ c: [x * W * 0.6, -drop, 0], h: [0.05 * U, 0.08 * U, long], role: "trim", part: "cape.hem" });
      }
      if (collar !== "none") boxes.push({ c: [0, 0.12 * U, long * 0.9], h: [W * 0.6, (collar === "high" ? 0.14 : 0.08) * U, D * 0.08], role: "secondary", part: "cape.collar" });
      return { boxes };
    }
    // A cape: from the shoulders (up the socket's y) down the back, a hair behind it (-z), flaring as it falls.
    const top = U * 0.55;
    const L = LENGTH[length] * U;
    const back = -D * 0.12;
    boxes.push({ c: [0, top - L * 0.18, back], h: [W * 0.56, L * 0.18, D * 0.05], role: "primary", part: "cape.yoke" });
    const lowTop = top - L * 0.34;
    const lowH = L * 0.66;
    if (hem === "tattered") for (const k of [-1, 0, 1]) { const h = lowH * (k === 0 ? 1 : 0.84); boxes.push({ c: [(k * W * 0.72) / 1.5, lowTop - h / 2, back - D * 0.12], h: [W * 0.24, h / 2, D * 0.05], role: "primary", part: "cape" }); }
    else boxes.push({ c: [0, lowTop - lowH / 2, back - D * 0.12], h: [W * 0.72, lowH / 2, D * 0.05], role: "primary", part: "cape" });
    if (hem === "trimmed") boxes.push({ c: [0, lowTop - lowH + 0.05 * U, back - D * 0.13], h: [W * 0.74, 0.06 * U, D * 0.055], role: "trim", part: "cape.hem" });
    if (collar === "high") boxes.push({ c: [0, top + 0.14 * U, back + D * 0.05], h: [W * 0.4, 0.16 * U, D * 0.05], role: "secondary", part: "cape.collar" });
    if (collar === "mantle") boxes.push({ c: [0, top - 0.02 * U, back + D * 0.25], h: [W * 0.62, 0.12 * U, D * 0.34], role: "secondary", part: "cape.mantle" });
    return { boxes };
  },
});
