// Glowing crystals: a cluster of prisms breaking out of a rock -- a cave's
// cyan light, a forge's molten obsidian, a crypt's pale wraith-glass. A light
// source (meta.flames holds where its glow sits; the renderer draws no
// flame for it, only its light).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { ACTS, num, roles } from "../kit.ts";

export default defineStyledObject({
  id: "crystals",
  title: "Glowing crystals",
  tags: ["crystal", "light", "cave", "light:crystal"],
  tier: "foreground",
  instancing: "many",
  variants: 6,
  choices: { height: { range: [0.5, 1.2] }, count: [4, 5, 7] },
  look: { roles: roles("accent", "glow", "stone"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const H = num(v["height"]), n = num(v["count"]);
    const solids: DesignSolid[] = [];
    solids.push(solid.ball("stone", [0, H * 0.12, 0], [H * 0.38, H * 0.12, H * 0.32], { name: "rock" }));
    for (let i = 0; i < n; i += 1) {
      const main = i === 0, yaw = (i / n) * Math.PI * 2 + J.between(-0.3, 0.3);
      const h = H * (main ? 0.9 : J.between(0.45, 0.8)), r = (0.06 + H * 0.07) * (main ? 1.2 : 0.85);
      const lean = main ? 0.05 : J.between(0.25, 0.5);
      const foot: Vec3 = main ? [0, H * 0.05, 0] : [Math.sin(yaw) * H * 0.2, H * 0.05, Math.cos(yaw) * H * 0.2];
      const steps = Math.max(2, Math.round(h / (r * 1.8)));
      for (let s = 0; s < steps; s += 1) {
        const off = lean * (h / steps) * s;
        const c: Vec3 = [foot[0] + Math.sin(yaw) * off, foot[1] + (h / steps) * (s + 0.5), foot[2] + Math.cos(yaw) * off];
        solids.push(solid.box(s === Math.floor(steps / 2) ? "glow" : "accent", c, [r, h / steps / 2, r * 0.8], yaw + Math.PI / 4, { name: "prism", group: `p${i}` }));
      }
      const off = lean * h;
      solids.push(solid.cone("accent", [foot[0] + Math.sin(yaw) * off, foot[1] + h, foot[2] + Math.cos(yaw) * off], r * 1.1, r * 2.4, 0, { name: "tip", group: `p${i}`, collide: false, sides: 4 }));
    }
    return { solids, front: null, meta: { flames: [[0, H * 0.6, 0]], light: "crystal" } };
  },
});
