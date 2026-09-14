// Saddlebags: a pair of bags hung on the flanks from a strap over the back --
// small, big, or two to a side -- a flap over each or none, buckles or none,
// how full a choice. Sized to the back socket (its width is the body's, its
// depth a stretch of the body's length). Canvas or leather is the look's (the
// primary role's finish). This pack's own: body/quadruped@^1 from packs/animals.
import type { AttributeBox, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { amount, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "saddlebag",
  slot: "back",
  title: "Saddlebags",
  tags: ["saddlebag", "pack", "working"],
  targets: [{ body: "body/quadruped@^1", packs: ["packs/animals@^1"] }],
  choices: { bags: ["small", "big", "double"], flap: [true, false], buckles: [true, false], fill: { range: [0.75, 1.15] } },
  look: { roles: { primary: { stuff: "cloth", finishes: ["cloth", "leather"], patterns: ["none", "none", "checks", "stripes", "camo"] }, secondary: { stuff: "leather" }, detail: { stuff: "dark" }, metal: { stuff: "metal" } } },
  build(S, fit, pins) {
    const bags = choose(S, pins, "bags", ["small", "big", "double"] as const);
    const flap = choose(S, pins, "flap", [true, false]);
    const buckles = choose(S, pins, "buckles", [true, false]);
    const fill = amount(S, pins, "fill", [0.75, 1.15]);
    const [w, h, d] = fit.size; // (w = 1.8 bodyR, h = bodyR, d = 0.6 bodyLen: the back socket sits on top of the body)
    const bx = w * 0.16 * fill;
    const tall = bags === "big" ? 0.52 : 0.4;
    const boxes: AttributeBox[] = [{ c: [0, h * 0.03, 0], h: [w * 0.6, h * 0.05, d * 0.18], role: "detail", part: "saddlebag.strap" }];
    for (const side of [-1, 1]) {
      const x = side * (w * 0.56 + bx);
      const zs = bags === "double" ? [-d * 0.2, d * 0.2] : [0];
      for (const z of zs) boxes.push({ c: [x, -h * 0.72, z], h: [bx, h * tall * fill, bags === "double" ? d * 0.18 : d * 0.32], role: "primary", part: "saddlebag.bag" });
      // (One flap and one buckle a side, over however many bags hang there.)
      if (flap) boxes.push({ c: [x + side * bx * 0.3, -h * (0.72 - tall * fill * 0.7), 0], h: [bx * 0.8, h * tall * fill * 0.3, d * (bags === "double" ? 0.4 : 0.33)], role: "secondary", part: "saddlebag.flap" });
      if (buckles) boxes.push({ c: [x + side * bx, -h * 0.5, 0], h: [w * 0.02, h * 0.08, d * 0.06], role: "metal", part: "saddlebag.buckle" });
    }
    return { boxes };
  },
});
