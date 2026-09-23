// Pauldrons over the shoulders: leather caps, steel plates in layers, or great
// spiked plates. Built to the chest socket (its front surface): the shoulders
// lie out either side of it, up and back.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { HUMANS, LEATHER, METAL, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "pauldrons",
  slot: "chest",
  title: "Pauldrons",
  tags: ["armour", "shoulders"],
  targets: [HUMANS],
  choices: { form: ["leather", "plate", "spiked"], layers: [1, 2] },
  look: { roles: { primary: { ...METAL, patterns: ["none", "bands"] }, secondary: LEATHER, trim: { ...METAL, finishes: ["metal"] } } },
  build(S, fit, pins) {
    const form = choose(S, pins, "form", ["leather", "plate", "spiked"] as const);
    const layers = choose(S, pins, "layers", [1, 2] as const);
    const [W, U, D] = fit.size;
    const tr = W / 2;
    const capsules: AttributeCapsule[] = [];
    const role = form === "leather" ? "secondary" : "primary";
    for (const s of [-1, 1]) {
      const at: [number, number, number] = [s * tr * 1.25, U * 0.55, -D * 0.3];
      const big = (form === "spiked" ? 0.75 : 0.62) * tr;
      capsules.push({ a: [at[0] - s * 0.15 * tr, at[1], at[2]], b: [at[0] + s * 0.2 * tr, at[1] - 0.1 * tr, at[2]], r: big, role, part: "pauldron" });
      if (layers === 2) capsules.push({ a: [at[0] + s * 0.25 * tr, at[1] - 0.45 * tr, at[2]], b: [at[0] + s * 0.35 * tr, at[1] - 0.55 * tr, at[2]], r: big * 0.7, role: "trim", part: "pauldron.lame" });
      if (form === "spiked") capsules.push({ a: [at[0] + s * 0.1 * tr, at[1] + big * 0.7, at[2]], b: [at[0] + s * 0.35 * tr, at[1] + big * 1.6, at[2] - 0.1 * tr], r: 0.1 * tr, role: "trim", part: "pauldron.spike" });
    }
    return { capsules };
  },
});
