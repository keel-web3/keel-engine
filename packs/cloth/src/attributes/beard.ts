// A beard, a wizard's pride: full and tapering, long to the belt, forked in
// two (a bead on each point), or a short scruff. Built to the face socket: hanging from the chin,
// down and a little out.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { HUMANS, KNIT, METAL, amount, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "beard",
  slot: "face",
  title: "Beard",
  tags: ["beard", "face", "wizard"],
  targets: [HUMANS],
  choices: { form: ["full", "long", "forked", "scruff"], bush: { range: [0.8, 1.3] } },
  look: { roles: { secondary: KNIT, trim: METAL } },
  build(S, fit, pins) {
    const form = choose(S, pins, "form", ["full", "long", "forked", "scruff"] as const);
    const bush = amount(S, pins, "bush", [0.8, 1.3]);
    const w = (fit.size[0] / 2) * bush, h = fit.size[1];
    const capsules: AttributeCapsule[] = [];
    const part = "beard";
    // (The chin under the mouth, and a strap of whisker up each cheek.)
    const chin: [number, number, number] = [0, -0.45 * h, 0.2 * w];
    for (const s of [-1, 1]) capsules.push({ a: [s * 0.75 * w, 0, 0.05 * w], b: [s * 0.4 * w, -0.4 * h, 0.2 * w], r: 0.22 * w, role: "secondary", part });
    if (form === "scruff") {
      capsules.push({ a: [-0.35 * w, -0.45 * h, 0.2 * w], b: [0.35 * w, -0.45 * h, 0.2 * w], r: 0.3 * w, role: "secondary", part });
      return { capsules };
    }
    const len = form === "long" ? 1.9 : form === "forked" ? 1.5 : 1.15;
    const down = (t: number): number => -0.45 * h - len * h * t;
    const out = (t: number): number => 0.2 * w + 0.35 * w * t;
    if (form === "forked") {
      capsules.push({ a: [-0.35 * w, -0.45 * h, 0.2 * w], b: [0.35 * w, -0.45 * h, 0.2 * w], r: 0.42 * w, role: "secondary", part });
      for (const s of [-1, 1]) {
        capsules.push({ a: [s * 0.25 * w, down(0.15), out(0.15)], b: [s * 0.4 * w, down(1), out(1)], r: 0.22 * w, role: "secondary", part });
        capsules.push({ a: [s * 0.38 * w, down(0.8), out(0.8)], b: [s * 0.38 * w, down(0.8), out(0.8)], r: 0.2 * w, role: "trim", part: "beard.bead" });
      }
    } else {
      // (A taper: wide at the chin, a point at the end.)
      let prev = chin;
      for (let i = 1; i <= 3; i += 1) {
        const t = i / 3;
        const p: [number, number, number] = [0, down(t), out(t)];
        capsules.push({ a: prev, b: p, r: (0.62 - 0.42 * t) * w, role: "secondary", part });
        prev = p;
      }
      if (form === "long") capsules.push({ a: [0, down(0.7), out(0.7)], b: [0, down(0.7), out(0.7)], r: 0.26 * w, role: "trim", part: "beard.bead" });
    }
    return { capsules };
  },
});
