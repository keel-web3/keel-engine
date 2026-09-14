// Boots, a pair: a boot on each foot, the same design on both (give both the
// same stream and pins). An attribute sits in one socket, so the pair is two
// attributes, boots-l on foot.L and boots-r on foot.R, from one design. Built
// to the foot socket: its origin mid-foot on the axis, heel to toe along +z.
// Two legs only. They bend with the foot through every step, so they're baked
// into the wearer's body (layer "body"), not drawn as a layer of their own.
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import type { AttributeDef } from "@keel-engine/runtime";
import { HUMANS, LEATHER, PAINT, choose } from "../kit.ts";

const SHAFT = { ankle: 1.2, mid: 2.2, tall: 3.2 } as const;

function boot(side: "L" | "R"): AttributeDef<AttributeShape> {
  return defineAttribute<AttributeShape>({
    id: `boots-${side.toLowerCase()}`,
    slot: `foot.${side}`,
    title: `Boots (${side === "L" ? "left" : "right"})`,
    tags: ["boots", "shoes", "pair"],
    targets: [HUMANS],
    layer: "body",
    choices: { shaft: ["ankle", "mid", "tall"], cuff: ["none", "fold", "fur"], sole: ["flat", "thick"], laces: [true, false] },
    look: { roles: { primary: LEATHER, secondary: { stuff: "cloth" }, dark: { stuff: "dark" }, trim: PAINT } },
    build(S, fit, pins) {
      const shaft = choose(S, pins, "shaft", ["ankle", "mid", "tall"] as const);
      const cuff = choose(S, pins, "cuff", ["none", "fold", "fur"] as const);
      const sole = choose(S, pins, "sole", ["flat", "thick"] as const);
      const laces = choose(S, pins, "laces", [true, false]);
      const [w, h, d] = fit.size; // (w = h = 2 footR; d = 0.96 footLen + 2 footR)
      const foot = Math.max(d - w, 0) / 0.96;
      const heel = -0.3 * foot; // (the ankle is over the heel: the socket sits 0.3 of a foot ahead of it)
      const soleH = sole === "thick" ? 0.18 : 0.1;
      const boxes: AttributeBox[] = [
        { c: [0, 0, 0], h: [0.62 * w, 0.6 * h, 0.52 * d], role: "primary", part: "boot" },
        { c: [0, -(0.5 + soleH) * h, 0], h: [0.64 * w, soleH * h, 0.54 * d], role: "dark", part: "boot.sole" },
      ];
      if (laces) for (const t of [0.15, 0.3]) boxes.push({ c: [0, 0.5 * h, t * d], h: [0.3 * w, 0.06 * h, 0.05 * d], role: "trim", part: "boot.lace" });
      const top = SHAFT[shaft] * h;
      const capsules: AttributeCapsule[] = [{ a: [0, 0, heel], b: [0, top, heel], r: 0.6 * w, role: "primary", part: "boot.shaft" }];
      if (cuff !== "none") capsules.push({ a: [0, top - 0.25 * h, heel], b: [0, top + 0.05 * h, heel], r: (cuff === "fur" ? 0.78 : 0.68) * w, role: "secondary", part: "boot.cuff" });
      return { boxes, capsules };
    },
  });
}

export const bootsLeft = boot("L");
export const bootsRight = boot("R");
export default bootsLeft;
