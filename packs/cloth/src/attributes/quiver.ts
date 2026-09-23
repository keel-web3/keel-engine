// A quiver on the back: a leather tube slung over a shoulder, its arrows'
// fletching showing at the top -- a few or a full one. Built to the back socket.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { HUMANS, LEATHER, PAINT, WOOD, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "quiver",
  slot: "back",
  title: "Quiver",
  tags: ["quiver", "archer"],
  targets: [HUMANS],
  choices: { arrows: [3, 6], side: ["left", "right"] },
  look: { roles: { secondary: LEATHER, detail: WOOD, trim: PAINT } },
  build(S, fit, pins) {
    const arrows = choose(S, pins, "arrows", [3, 6] as const);
    const side = choose(S, pins, "side", ["left", "right"] as const) === "left" ? -1 : 1;
    const [W, U] = fit.size;
    const tr = W / 2;
    // (Slung diagonally: its mouth over one shoulder, its foot at the other hip.)
    const top: [number, number, number] = [side * tr * 0.7, U * 1.1, -0.25 * tr];
    const foot: [number, number, number] = [-side * tr * 0.4, -U * 1.1, -0.35 * tr];
    const capsules: AttributeCapsule[] = [{ a: foot, b: top, r: tr * 0.32, role: "secondary", part: "quiver" }];
    for (let i = 0; i < Math.min(arrows, 4); i += 1) {
      const o = (i - 1.5) * tr * 0.12;
      capsules.push({ a: [top[0] + o, top[1], top[2]], b: [top[0] + o + side * tr * 0.12, top[1] + U * 0.45, top[2] - 0.05 * tr], r: tr * 0.05, role: "detail", part: "quiver.arrow" });
      capsules.push({ a: [top[0] + o + side * tr * 0.12, top[1] + U * 0.35, top[2] - 0.05 * tr], b: [top[0] + o + side * tr * 0.14, top[1] + U * 0.5, top[2] - 0.05 * tr], r: tr * 0.09, role: "trim", part: "quiver.fletching" });
    }
    return { capsules };
  },
});
