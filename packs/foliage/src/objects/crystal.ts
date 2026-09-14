// Crystals: a cluster of prisms leaning out of a rock, a single spire, or a
// geode (a split rock with crystals inside); they glow or not. An advanced
// resource site's dressing, an alien world's flower.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { bool, num, roles, str } from "../kit.ts";

/** A prism: stepped segments along its lean (boxes turn about y only: a stair of them leans), a pointed tip. */
function prism(out: DesignSolid[], foot: Vec3, yaw: number, lean: number, h: number, r: number, group: string, glow: boolean): void {
  const steps = Math.max(2, Math.round(h / (r * 1.6)));
  const dy = h / steps;
  for (let i = 0; i < steps; i += 1) {
    const off = lean * dy * i;
    const c: Vec3 = [foot[0] + Math.sin(yaw) * off, foot[1] + dy * (i + 0.5), foot[2] + Math.cos(yaw) * off];
    out.push(solid.box("crystal", c, [r, dy / 2, r * 0.8], yaw + Math.PI / 4, { name: "crystal", group }));
    if (glow && i === Math.floor(steps / 2)) out.push(solid.box("glow", c, [r * 0.55, dy / 2 * 0.8, r * 0.95], yaw + Math.PI / 4, { name: "core", group, collide: false }));
  }
  const offTop = lean * dy * steps;
  out.push(solid.cone("crystal", [foot[0] + Math.sin(yaw) * offTop, foot[1] + h, foot[2] + Math.cos(yaw) * offTop], r * 1.1, r * 2.2, 0, { name: "tip", group, collide: false, sides: 4 }));
}

export default defineStyledObject({
  id: "crystal",
  title: "Crystals",
  tags: ["crystal", "resource", "alien", "glow"],
  tier: "background",
  instancing: "many",
  variants: 6,
  choices: { height: { range: [0.5, 3] }, form: ["cluster", "spire", "geode"], count: [3, 5, 7], glow: [true, false] },
  look: { roles: roles("crystal", "stone", "glow"), profiles: ["alien", "ice", "summer", "ash", "fungal"] },
  sway: null,
  design(J, v) {
    const H = num(v["height"]);
    const form = str(v["form"]);
    const glow = bool(v["glow"]);
    const solids: DesignSolid[] = [];
    if (form === "spire") {
      prism(solids, [0, 0, 0], J.between(0, Math.PI), 0, H, 0.08 + H * 0.08, "spire", glow);
      solids.push(solid.ball("stone", [0, H * 0.1, 0], [H * 0.22, H * 0.1, H * 0.2], { name: "base" }));
    } else if (form === "cluster") {
      solids.push(solid.ball("stone", [0, H * 0.14, 0], [H * 0.4, H * 0.14, H * 0.34], { name: "base" }));
      const n = num(v["count"]);
      for (let i = 0; i < n; i += 1) {
        const yaw = (i / n) * Math.PI * 2 + J.between(-0.3, 0.3);
        const main = i === 0;
        const h = H * (main ? 1 : J.between(0.35, 0.7));
        const foot: Vec3 = main ? [0, H * 0.05, 0] : [Math.sin(yaw) * H * 0.18, H * 0.05, Math.cos(yaw) * H * 0.18];
        prism(solids, foot, yaw, main ? 0.05 : J.between(0.25, 0.55), h, (0.05 + H * 0.06) * (main ? 1.2 : 0.8), `c${i}`, glow && (main || i % 2 === 0));
      }
    } else {
      // A geode: two halves of a rock, open to the front, crystals inside.
      const R = H * 0.5;
      solids.push(solid.ball("stone", [-R * 0.55, R * 0.7, 0], [R * 0.5, R * 0.7, R * 0.8], { name: "shell" }));
      solids.push(solid.ball("stone", [R * 0.55, R * 0.7, 0], [R * 0.5, R * 0.7, R * 0.8], { name: "shell" }));
      solids.push(solid.box("stone", [0, R * 0.12, 0], [R, R * 0.12, R * 0.7], 0, { name: "floor" }));
      const n = num(v["count"]);
      for (let i = 0; i < n; i += 1) {
        const x = (i / Math.max(1, n - 1) - 0.5) * R * 0.9;
        prism(solids, [x, R * 0.2, J.between(-0.2, 0.2) * R], J.between(0, Math.PI), 0.15, R * J.between(0.4, 0.9), R * 0.1, `g${i}`, glow);
      }
    }
    return { solids, front: form === "geode" ? "+z" : null };
  },
});
