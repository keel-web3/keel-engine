// Cave fungi: a clump of pale stems and caps, their gills glowing -- a faint
// light of their own (meta.flames: where it sits). Underfoot.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles } from "../kit.ts";

export default defineStyledObject({
  id: "mushrooms",
  title: "Glowing fungi",
  tags: ["fungi", "cave", "light:fungus"],
  tier: "background",
  instancing: "many",
  variants: 8,
  choices: { count: [3, 5, 7], height: { range: [0.2, 0.6] } },
  look: { roles: roles("bone", "accent", "glow"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const n = num(v["count"]), H = num(v["height"]);
    const solids: DesignSolid[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = J.between(0, 6.28), d = i ? J.between(0.08, 0.3) : 0, h = H * (i ? J.between(0.4, 0.9) : 1);
      const x = Math.sin(a) * d, z = Math.cos(a) * d, R = h * J.between(0.35, 0.55);
      const r = Math.max(0.025, h * 0.1);
      solids.push(solid.capsule("bone", [x, r, z], [x + J.between(-0.03, 0.03), Math.max(r * 1.5, h), z], r, { name: "stem", collide: false }));
      solids.push(solid.ball("glow", [x, h - R * 0.12, z], [R * 0.8, R * 0.14, R * 0.8], { name: "gills", collide: false }));
      solids.push(solid.ball("accent", [x, h + R * 0.12, z], [R, R * 0.45, R], { name: "cap", collide: false }));
    }
    return { solids, front: null, meta: { flames: [[0, H * 0.6, 0]], light: "fungus" } };
  },
});
