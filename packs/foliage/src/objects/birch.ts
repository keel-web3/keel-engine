// A birch: one to three slim pale trunks from one foot, banded dark (the
// look's bands on paperbark), a light crown -- an oval, or drooping like a
// weeping birch -- on each.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { WIND, canopy, num, roles, str, trunk } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "birch",
  title: "Birch",
  tags: ["tree", "deciduous", "temperate", "cold"],
  tier: "background",
  instancing: "many",
  choices: { height: { range: [6, 10] }, trunks: [1, 2, 3], crown: ["oval", "drooping"], lean: { range: [0.02, 0.2] }, season: ["summer", "spring", "autumn", "winter"] },
  look: { roles: roles("leaf", "paperbark", "dark"), choices: ["season"], profiles: ["summer", "spring", "autumn", "winter", "alien"] },
  sway: WIND.tree,
  design(J, v) {
    const H = num(v["height"]);
    const n = num(v["trunks"]);
    const drooping = str(v["crown"]) === "drooping";
    const solids: DesignSolid[] = [];
    const base = J.between(0, Math.PI * 2);
    for (let i = 0; i < n; i += 1) {
      const yaw = base + (i / n) * Math.PI * 2;
      const h = H * (i === 0 ? 1 : J.between(0.72, 0.9));
      const r0 = 0.09 + h * 0.012;
      const lean = n === 1 ? num(v["lean"]) * 0.5 : num(v["lean"]) + 0.08;
      const t = trunk("paperbark", h * 0.82, r0, r0 * 0.55, { lean, leanYaw: yaw, segments: 4, flare: i === 0, from: [dsin(yaw) * r0 * (n > 1 ? 0.8 : 0), 0, dcos(yaw) * r0 * (n > 1 ? 0.8 : 0)] });
      solids.push(...t.solids);
      // (The dark marks a birch's bark is known by: two knots on its trunk, the bands are the look's.)
      for (const k of [0.3, 0.55]) { const p = t.at(k); const r = t.radiusAt(k); solids.push(solid.ball("dark", [p[0] + dsin(yaw + 1) * r * 0.8, p[1], p[2] + dcos(yaw + 1) * r * 0.8], [r * 0.45, r * 0.3, r * 0.45], { name: "knot", collide: false })); }
      const R: Vec3 = drooping ? [h * 0.2, h * 0.3, h * 0.2] : [h * 0.17, h * 0.26, h * 0.17];
      const c: Vec3 = [t.top[0], h - R[1] * (drooping ? 1.15 : 0.95), t.top[2]];
      solids.push(...canopy("leaf", J, c, R, drooping ? 6 : 4, { flat: drooping ? 1.1 : 0.9, group: `crown${i}` }));
    }
    return { solids, front: null, sockets: { base: { kind: "anchor", pos: [0, 0, 0] } } };
  },
});
