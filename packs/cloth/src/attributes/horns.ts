// Horns grown from the head: short stubs, a ram's curls, or long sweeping
// ones -- a warlock's pact, a tiefling's blood. Built to the head socket.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { BONE, HUMANS, choose } from "../kit.ts";
import type { V3 } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "horns",
  slot: "head",
  title: "Horns",
  tags: ["horns", "demonic"],
  targets: [HUMANS],
  choices: { form: ["stubs", "ram", "sweep"] },
  look: { roles: { secondary: BONE, dark: { stuff: "dark" } } },
  build(S, fit, pins) {
    const form = choose(S, pins, "form", ["stubs", "ram", "sweep"] as const);
    const hr = fit.size[1];
    const capsules: AttributeCapsule[] = [];
    for (const s of [-1, 1]) {
      const root: V3 = [s * 0.55 * hr, -0.25 * hr, 0.15 * hr];
      if (form === "stubs") { capsules.push({ a: root, b: [s * 0.75 * hr, 0.2 * hr, 0.05 * hr], r: 0.16 * hr, role: "secondary", part: "horn" }); continue; }
      if (form === "ram") {
        const pts: V3[] = [root, [s * 1.0 * hr, 0.05 * hr, -0.2 * hr], [s * 1.15 * hr, -0.45 * hr, -0.35 * hr], [s * 1.0 * hr, -0.7 * hr, 0.05 * hr]];
        for (let i = 1; i < pts.length; i += 1) capsules.push({ a: pts[i - 1]!, b: pts[i]!, r: (0.2 - i * 0.04) * hr, role: "secondary", part: "horn" });
        continue;
      }
      const pts: V3[] = [root, [s * 0.9 * hr, 0.35 * hr, -0.25 * hr], [s * 1.05 * hr, 1.0 * hr, -0.55 * hr]];
      for (let i = 1; i < pts.length; i += 1) capsules.push({ a: pts[i - 1]!, b: pts[i]!, r: (0.17 - i * 0.05) * hr, role: i === 2 ? "dark" : "secondary", part: "horn" });
    }
    return { capsules };
  },
});
