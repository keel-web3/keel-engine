// Stalagmites: one to three stepped cones of dripstone rising from a puddle
// of their own rock -- a cave's floor. They block the way.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "stalagmite",
  title: "Stalagmites",
  tags: ["stalagmite", "cave", "rock", "block"],
  tier: "background",
  instancing: "many",
  variants: 8,
  choices: { height: { range: [0.6, 1.7] }, count: [1, 2, 3], wet: [false, true] },
  look: { roles: roles("stone", "moss", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const H = num(v["height"]), n = num(v["count"]);
    const solids: DesignSolid[] = [];
    solids.push(solid.ball("stone", [0, 0.04, 0], [H * 0.32, 0.06, H * 0.28], { name: "foot" }));
    for (let i = 0; i < n; i += 1) {
      const a = J.between(0, 6.28), d = i ? H * J.between(0.18, 0.3) : 0, h = H * (i ? J.between(0.35, 0.65) : 1);
      const r = h * J.between(0.26, 0.34);
      // (A lumpy foot, a cone above it: dripstone, not a fir tree.)
      solids.push(solid.ball("stone", [dsin(a) * d, h * 0.16, dcos(a) * d], [r * 1.1, h * 0.16, r], { name: "foot", collide: false }));
      solids.push(solid.cone("stone", [dsin(a) * d, h * 0.1, dcos(a) * d], r * 0.85, h * 0.9, r * 0.12, { name: "spike", sides: 8, steps: 2 }));
    }
    if (v["wet"] === true) solids.push(solid.ball("moss", [0, 0.02, H * 0.2], [H * 0.25, 0.02, H * 0.2], { name: "slime", collide: false }));
    else solids.push(solid.ball("dark", [H * 0.15, 0.01, 0], [H * 0.2, 0.01, H * 0.18], { name: "shade", collide: false }));
    return { solids, front: null };
  },
});
