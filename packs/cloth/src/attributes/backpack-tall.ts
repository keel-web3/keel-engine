// A tall backpack: a long box standing off the back, a lid flat or domed,
// pockets on its face (0, 1 or 2), a bedroll across its top, its foot or none,
// a metal frame up its sides or none. Built to the back socket, whichever way
// it faces (see backpack-round).
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, CLOTH, HUMANS, METAL, choose, halves, standOff } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "backpack-tall",
  slot: "back",
  title: "Tall backpack",
  tags: ["backpack", "pack", "hiking"],
  targets: [HUMANS, ANIMALS],
  choices: { bedroll: ["none", "top", "bottom"], pockets: [0, 1, 2], lid: ["flat", "domed"], frame: [false, true] },
  look: { roles: { primary: { ...CLOTH, patterns: ["none", "none", "camo", "bands", "checks"] }, secondary: { ...CLOTH, like: "primary" }, trim: CLOTH, metal: METAL } },
  build(S, fit, pins) {
    const bedroll = choose(S, pins, "bedroll", ["none", "top", "bottom"] as const);
    const pockets = choose(S, pins, "pockets", [0, 1, 2]);
    const lid = choose(S, pins, "lid", ["flat", "domed"] as const);
    const frame = choose(S, pins, "frame", [false, true]);
    const { across: W, along: U, off: D, v } = standOff(fit);
    const d = D * 0.34;
    const boxes: AttributeBox[] = [{ c: v(0, 0, d), h: halves(fit, W * 0.32, U * 0.5, d), role: "primary", part: "backpack" }];
    for (let k = 0; k < pockets; k += 1) {
      const x = pockets === 1 ? 0 : (k === 0 ? -1 : 1) * W * 0.15;
      boxes.push({ c: v(x, -U * 0.2, d * 2.1), h: halves(fit, W * 0.12, U * 0.14, d * 0.12), role: "secondary", part: "backpack.pocket" });
    }
    if (lid === "flat") boxes.push({ c: v(0, U * 0.5, d * 1.1), h: halves(fit, W * 0.34, U * 0.06, d * 1.1), role: "secondary", part: "backpack.lid" });
    const capsules: AttributeCapsule[] = [];
    if (lid === "domed") capsules.push({ a: v(-W * 0.18, U * 0.5, d), b: v(W * 0.18, U * 0.5, d), r: d * 0.95, role: "secondary", part: "backpack.lid" });
    if (bedroll !== "none") { const y = bedroll === "top" ? U * 0.62 : -U * 0.56; capsules.push({ a: v(-W * 0.38, y, d), b: v(W * 0.38, y, d), r: Math.min(d * 0.8, U * 0.14), role: "trim", part: "backpack.bedroll" }); }
    if (frame) for (const x of [-1, 1]) capsules.push({ a: v(x * W * 0.34, -U * 0.55, d * 0.4), b: v(x * W * 0.34, U * 0.68, d * 0.4), r: W * 0.025, role: "metal", part: "backpack.frame" });
    return { boxes, capsules };
  },
});
