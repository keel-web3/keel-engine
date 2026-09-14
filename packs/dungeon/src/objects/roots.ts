// Roots and vines coming down a wall: gnarled roots from the top, ivy blobs
// along them, a few trailing across the floor. An overgrown ruin's (or a
// cave's) wall dressing. Its back is the wall.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { ACTS, num, roles } from "../kit.ts";

export default defineStyledObject({
  id: "roots",
  title: "Roots and vines",
  tags: ["roots", "vines", "wall", "ruin"],
  tier: "background",
  instancing: "many",
  variants: 8,
  choices: { strands: [2, 3, 5], width: { range: [0.6, 1.6] }, leaves: [true, true, false] },
  look: { roles: roles("wood", "moss"), profiles: [...ACTS] },
  sway: { amp: 0.02, hz: 0.3, bend: 2, from: 1 },
  design(J, v) {
    const n = num(v["strands"]), W = num(v["width"]);
    const solids: DesignSolid[] = [];
    for (let i = 0; i < n; i += 1) {
      let p: Vec3 = [(i / Math.max(1, n - 1) - 0.5) * W, 2.8, 0.06];
      const segs = 6, r0 = J.between(0.035, 0.06);
      for (let s = 0; s < segs; s += 1) {
        const q: Vec3 = [p[0] + J.between(-0.12, 0.12), p[1] - J.between(0.3, 0.5), 0.06 + J.between(0, 0.05) + (s === segs - 1 ? 0.2 : 0)];
        if (q[1] < 0.05) q[1] = 0.05;
        solids.push(solid.capsule("wood", p, q, r0 * (1 - s * 0.1), { name: "root", collide: false }));
        if (v["leaves"] === true && J.f() < 0.6) solids.push(solid.ball("moss", q, [0.1, 0.08, 0.05], { name: "leaves", collide: false }));
        p = q;
      }
    }
    solids.push(solid.ball("moss", [0, 2.75, 0.05], [W * 0.55, 0.12, 0.06], { name: "ivy", collide: false }));
    return { solids, front: "+z" };
  },
});
