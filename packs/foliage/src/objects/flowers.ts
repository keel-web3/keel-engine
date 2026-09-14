// Flowers -- a clump for the thousand-flower meadow: one, three or five stems
// with daisies (a flat ring of petals round a heart), tulips (a cup), bells
// (drooping) or wild sprays (tiny heads on a branching stem).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { WIND, num, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "flowers",
  title: "Flowers",
  tags: ["flower", "ground-cover", "massive"],
  tier: "background",
  instancing: "massive",
  billboard: true,
  variants: 4,
  choices: { height: { range: [0.2, 0.6] }, kind: ["daisy", "tulip", "bell", "wild"], count: [1, 3, 5] },
  look: { roles: roles("leaf", "blossom", "fruit"), profiles: ["spring", "summer", "autumn", "tropical", "alien", "desert"] },
  sway: WIND.flower,
  design(J, v) {
    const H = num(v["height"]);
    const kind = str(v["kind"]);
    const n = num(v["count"]);
    const r = Math.max(0.008, H * 0.03);
    const solids: DesignSolid[] = [];
    for (let i = 0; i < n; i += 1) {
      const yaw = (i / n) * Math.PI * 2 + J.between(-0.4, 0.4);
      const h = H * (i === 0 ? 1 : J.between(0.65, 0.9));
      const out = n === 1 ? 0 : h * J.between(0.12, 0.3);
      const foot: Vec3 = [Math.sin(yaw) * r, r, Math.cos(yaw) * r];
      const head: Vec3 = [Math.sin(yaw) * out, h, Math.cos(yaw) * out];
      solids.push(solid.capsule("leaf", foot, head, r, { name: "stem", collide: false }));
      // (A leaf off the stem, low down.)
      solids.push(solid.ball("leaf", [head[0] * 0.3 + Math.sin(yaw + 1.6) * h * 0.08, h * 0.25, head[2] * 0.3 + Math.cos(yaw + 1.6) * h * 0.08], [h * 0.09, h * 0.03, h * 0.09], { name: "leaf", collide: false }));
      const s = H * 0.09;
      if (kind === "daisy") {
        solids.push(solid.ball("blossom", head, [s * 1.5, s * 0.35, s * 1.5], { name: "petals", collide: false }));
        solids.push(solid.ball("fruit", [head[0], head[1] + s * 0.25, head[2]], s * 0.5, { name: "heart", collide: false }));
      } else if (kind === "tulip") solids.push(solid.ball("blossom", [head[0], head[1] + s * 0.6, head[2]], [s * 0.8, s * 1.3, s * 0.8], { name: "cup", collide: false }));
      else if (kind === "bell") {
        const hang: Vec3 = [head[0] + Math.sin(yaw) * s * 1.4, head[1] - s * 0.4, head[2] + Math.cos(yaw) * s * 1.4];
        solids.push(solid.capsule("leaf", head, [hang[0], hang[1] + s * 0.8, hang[2]], r * 0.8, { name: "stem", collide: false }));
        solids.push(solid.cone("blossom", [hang[0], hang[1] - s * 0.2, hang[2]], s * 0.9, s * 1.2, s * 0.35, { name: "bell", collide: false, sides: 4 }));
      } else for (let k = 0; k < 4; k += 1) {
        const a = yaw + (k / 4) * Math.PI * 2;
        solids.push(solid.ball("blossom", [head[0] + Math.sin(a) * s * 1.1, head[1] + J.between(-0.5, 0.8) * s, head[2] + Math.cos(a) * s * 1.1], s * 0.5, { name: "spray", collide: false }));
      }
    }
    return { solids, front: null, colliders: [], voxel: { unit: Math.max(0.015, Math.round(H * 0.06 * 200) / 200) } };
  },
});
