// A round backpack: a rounded body standing off the back, a pocket on its
// face (none, one on the front, or one each side), straps thin or wide, a
// bedroll across its top or none. Built to the back socket, whichever way it
// faces: off a person's back (out -z, standing up y) or on top of an animal's
// (out +y, lying along the body).
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, CLOTH, HUMANS, LEATHER, amount, choose, halves, standOff } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "backpack-round",
  slot: "back",
  title: "Round backpack",
  tags: ["backpack", "pack"],
  targets: [HUMANS, ANIMALS],
  choices: { pocket: ["none", "front", "sides"], straps: ["thin", "wide"], roll: [false, true], fill: { range: [0.8, 1.1] } },
  look: { roles: { primary: { ...CLOTH, finishes: ["cloth", "leather"], patterns: ["none", "none", "camo", "checks", "stripes"] }, secondary: { ...CLOTH, like: "primary" }, detail: LEATHER, trim: CLOTH } },
  build(S, fit, pins) {
    const pocket = choose(S, pins, "pocket", ["none", "front", "sides"] as const);
    const straps = choose(S, pins, "straps", ["thin", "wide"] as const);
    const roll = choose(S, pins, "roll", [false, true]);
    const fill = amount(S, pins, "fill", [0.8, 1.1]);
    const { across: W, along: U, off: D, v } = standOff(fit);
    const r = Math.min(W * 0.34, D * 0.55) * fill;
    const boxes: AttributeBox[] = [{ c: v(0, 0, r * 0.2), h: halves(fit, W * 0.42, U * (straps === "wide" ? 0.1 : 0.05), r * 0.2), role: "detail", part: "backpack.strap" }];
    if (pocket === "front") boxes.push({ c: v(0, -U * 0.14, r * 1.95), h: halves(fit, W * 0.2, U * 0.12, r * 0.14), role: "secondary", part: "backpack.pocket" });
    if (pocket === "sides") for (const x of [-1, 1]) boxes.push({ c: v(x * r * 1.05, -U * 0.1, r), h: halves(fit, r * 0.16, U * 0.12, r * 0.4), role: "secondary", part: "backpack.pocket" });
    const capsules: AttributeCapsule[] = [{ a: v(0, -U * 0.22, r), b: v(0, U * 0.22, r), r, role: "primary", part: "backpack" }];
    if (roll) capsules.push({ a: v(-r * 1.1, U * 0.22 + r * 0.8, r), b: v(r * 1.1, U * 0.22 + r * 0.8, r), r: r * 0.36, role: "trim", part: "backpack.roll" });
    return { capsules, boxes };
  },
});
