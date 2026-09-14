// A giant mushroom -- the fungal jungle's tree: one to three pale stems, a
// cap (a dome, a flat plate, a bell or a witch's cone) with spots or none,
// a glowing rim of gills under it. Small ones are shrubs; big ones shade a
// squad.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { bool, num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "mushroom",
  title: "Giant mushroom",
  tags: ["fungal", "alien", "tree"],
  tier: "background",
  instancing: "many",
  choices: { height: { range: [1.2, 6] }, cap: ["dome", "flat", "bell", "cone"], stems: [1, 2, 3], spots: [true, false], glow: [true, false] },
  look: { roles: roles("cap", "stem", "spot", "glow"), profiles: ["fungal", "summer", "autumn", "alien"] },
  sway: { amp: 0.02, hz: 0.25, bend: 2, from: 0.5 },
  design(J, v) {
    const H0 = num(v["height"]);
    const n = num(v["stems"]);
    const solids: DesignSolid[] = [];
    const base = J.between(0, Math.PI * 2);
    for (let i = 0; i < n; i += 1) {
      const H = H0 * (i === 0 ? 1 : J.between(0.45, 0.7));
      const yaw = base + (i / n) * Math.PI * 2;
      const off = i === 0 ? 0 : H0 * 0.28;
      const foot: Vec3 = [dsin(yaw) * off, 0, dcos(yaw) * off];
      const lean = J.between(0.02, 0.1) * H;
      const top: Vec3 = [foot[0] + dsin(yaw) * lean, H * 0.8, foot[2] + dcos(yaw) * lean];
      const r = 0.06 + H * 0.06;
      solids.push(solid.cylinder("stem", foot, r * 1.35, r * 1.2, { name: "foot", collide: false }));
      solids.push(solid.capsule("stem", [foot[0], r, foot[2]], top, r, { name: "stem", collide: i === 0 }));
      const R = H * (str(v["cap"]) === "flat" ? 0.5 : str(v["cap"]) === "cone" ? 0.28 : 0.4);
      const g = `cap${i}`;
      const c = str(v["cap"]);
      // (A glowing ring of gills under the rim.)
      if (bool(v["glow"])) solids.push(solid.ball("glow", [top[0], top[1] - R * 0.08, top[2]], [R * 0.8, R * 0.12, R * 0.8], { name: "gills", group: g, collide: false }));
      if (c === "dome") solids.push(solid.ball("cap", [top[0], top[1] + R * 0.1, top[2]], [R, R * 0.6, R], { name: "cap", group: g, collide: false }));
      else if (c === "flat") solids.push(solid.ball("cap", [top[0], top[1] + R * 0.08, top[2]], [R, R * 0.22, R], { name: "cap", group: g, collide: false }));
      else if (c === "bell") {
        solids.push(solid.ball("cap", [top[0], top[1] + R * 0.35, top[2]], [R * 0.8, R * 0.75, R * 0.8], { name: "cap", group: g, collide: false }));
        solids.push(solid.ball("cap", [top[0], top[1], top[2]], [R, R * 0.28, R], { name: "cap", group: g, collide: false }));
      } else solids.push(solid.cone("cap", [top[0], top[1] - R * 0.15, top[2]], R, R * 1.9, R * 0.06, { name: "cap", group: g, collide: false }));
      if (bool(v["spots"])) {
        const k = c === "cone" ? 4 : 6;
        for (let s = 0; s < k; s += 1) {
          const a = (s / k) * Math.PI * 2 + J.between(-0.3, 0.3);
          const up = c === "flat" ? R * 0.2 : c === "cone" ? R * 0.5 : R * 0.45;
          const out = c === "flat" ? R * 0.6 : c === "cone" ? R * 0.55 : R * 0.62;
          solids.push(solid.ball("spot", [top[0] + dsin(a) * out, top[1] + up, top[2] + dcos(a) * out], R * 0.14, { name: "spot", group: g, collide: false }));
        }
      }
    }
    return { solids, front: null, sockets: { base: { kind: "anchor", pos: [0, 0, 0] } } };
  },
});
