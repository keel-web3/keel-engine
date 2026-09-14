// A grass tuft -- made to be drawn by the thousand: a handful of blades
// fanning out of one spot, tight or wide, seed heads or not. Few shapes (a
// coarse grid of choices and four variants: a meadow bakes a dozen sprites),
// one baked direction, no colliders, and a strong wind.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { WIND, bool, num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "grass",
  title: "Grass tuft",
  tags: ["grass", "ground-cover", "massive"],
  tier: "background",
  instancing: "massive",
  billboard: true,
  variants: 4,
  choices: { height: { range: [0.15, 0.55] }, blades: [5, 7, 9], spread: ["tight", "fan"], seeds: [false, true], season: ["summer", "spring", "autumn", "winter"] },
  look: { roles: roles("leaf", "blossom"), choices: ["season"], profiles: ["summer", "spring", "autumn", "winter", "dry", "desert", "tropical", "alien", "ash"] },
  sway: WIND.grass,
  design(J, v) {
    const H = num(v["height"]);
    const n = num(v["blades"]);
    const fan = str(v["spread"]) === "fan" ? 0.55 : 0.28;
    const r = Math.max(0.008, H * 0.035);
    const solids: DesignSolid[] = [];
    for (let i = 0; i < n; i += 1) {
      const yaw = (i / n) * Math.PI * 2 + J.between(-0.4, 0.4);
      const h = H * J.between(0.6, 1);
      const out = h * fan * J.between(0.5, 1);
      const foot: Vec3 = [dsin(yaw) * r * 1.5, r, dcos(yaw) * r * 1.5];
      const mid: Vec3 = [dsin(yaw) * out * 0.35, h * 0.55, dcos(yaw) * out * 0.35];
      const tip: Vec3 = [dsin(yaw) * out, h, dcos(yaw) * out];
      solids.push(solid.capsule("leaf", foot, mid, r, { name: "blade", collide: false }));
      solids.push(solid.capsule("leaf", mid, tip, r * 0.7, { name: "blade", collide: false }));
      if (bool(v["seeds"]) && i % 2 === 0) solids.push(solid.capsule("blossom", tip, [tip[0] * 1.05, tip[1] + H * 0.12, tip[2] * 1.05], r * 1.3, { name: "seed", collide: false }));
    }
    return { solids, front: null, colliders: [], voxel: { unit: Math.max(0.015, Math.round(H * 0.07 * 200) / 200) } };
  },
});
