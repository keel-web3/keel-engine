// Reeds: a clump of tall thin stalks at a water's edge, leaning out, with
// cattail heads or feathery tips. Drawn by the hundred along a bank.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { WIND, bool, num, roles } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "reeds",
  title: "Reeds",
  tags: ["reeds", "water", "swamp", "massive"],
  tier: "background",
  instancing: "massive",
  billboard: true,
  variants: 4,
  choices: { height: { range: [0.6, 1.8] }, stalks: [4, 6, 8], cattails: [true, false] },
  look: { roles: roles("leaf", "fruit", "blossom"), profiles: ["summer", "autumn", "winter", "dry", "alien"] },
  sway: WIND.reed,
  design(J, v) {
    const H = num(v["height"]);
    const n = num(v["stalks"]);
    const r = Math.max(0.01, H * 0.012);
    const solids: DesignSolid[] = [];
    for (let i = 0; i < n; i += 1) {
      const yaw = (i / n) * Math.PI * 2 + J.between(-0.5, 0.5);
      const h = H * J.between(0.65, 1);
      const out = h * J.between(0.05, 0.22);
      const foot: Vec3 = [dsin(yaw) * H * 0.05, r, dcos(yaw) * H * 0.05];
      const tip: Vec3 = [dsin(yaw) * out, h, dcos(yaw) * out];
      solids.push(solid.capsule("leaf", foot, tip, r, { name: "stalk", collide: false }));
      if (bool(v["cattails"]) && i % 2 === 0) {
        const t = 0.78;
        const c: Vec3 = [foot[0] + (tip[0] - foot[0]) * t, foot[1] + (tip[1] - foot[1]) * t, foot[2] + (tip[2] - foot[2]) * t];
        solids.push(solid.capsule("fruit", c, [c[0] + (tip[0] - foot[0]) * 0.12, c[1] + (tip[1] - foot[1]) * 0.12, c[2] + (tip[2] - foot[2]) * 0.12], r * 2.6, { name: "cattail", collide: false }));
      } else if (i % 3 === 1) solids.push(solid.ball("blossom", tip, [r * 3, H * 0.06, r * 3], { name: "plume", collide: false }));
      // (A blade leaf curling off low.)
      if (i % 2 === 1) solids.push(solid.capsule("leaf", foot, [dsin(yaw + 0.8) * h * 0.25, h * 0.45, dcos(yaw + 0.8) * h * 0.25], r, { name: "blade", collide: false }));
    }
    return { solids, front: null, colliders: [] };
  },
});
