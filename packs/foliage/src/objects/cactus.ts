// A cactus: a saguaro (a column, zero to three elbowed arms), a barrel (a
// ribbed squat ball) or a prickly pear (flat pads stacked edge on edge); a
// flower on top or not.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { bool, num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "cactus",
  title: "Cactus",
  tags: ["cactus", "desert"],
  tier: "background",
  instancing: "many",
  variants: 6,
  choices: { height: { range: [0.6, 4] }, form: ["saguaro", "barrel", "prickly"], arms: [0, 1, 2, 3], flower: [false, true] },
  look: { roles: roles("leaf", "blossom", "fruit"), profiles: ["desert", "dry", "summer", "alien"] },
  sway: null,
  design(J, v) {
    const H = num(v["height"]);
    const form = str(v["form"]);
    const solids: DesignSolid[] = [];
    let top: Vec3 = [0, H, 0];
    if (form === "saguaro") {
      const r = 0.12 + H * 0.05;
      solids.push(solid.capsule("leaf", [0, r, 0], [0, H - r, 0], r, { name: "column" }));
      const n = num(v["arms"]);
      const yaw0 = J.between(0, Math.PI * 2);
      for (let i = 0; i < n; i += 1) {
        const yaw = yaw0 + (i / Math.max(1, n)) * Math.PI * 2 * (n === 2 ? 0.5 : 1) + J.between(-0.3, 0.3);
        const y = H * J.between(0.35, 0.6);
        const out = r * 2.6;
        const elbow: Vec3 = [dsin(yaw) * out, y, dcos(yaw) * out];
        solids.push(solid.capsule("leaf", [0, y, 0], elbow, r * 0.7, { name: "arm", collide: false }));
        solids.push(solid.capsule("leaf", elbow, [elbow[0], y + H * J.between(0.2, 0.35), elbow[2]], r * 0.7, { name: "arm", collide: false }));
      }
      top = [0, H - r * 0.3, 0];
    } else if (form === "barrel") {
      const R = Math.min(H, 1.2) * 0.45;
      const h = Math.min(H, 1.4) * 0.5;
      solids.push(solid.ball("leaf", [0, h, 0], [R, h, R], { name: "barrel" }));
      // (Ribs: vertical ridges round it.)
      for (let k = 0; k < 8; k += 1) {
        const a = (k / 8) * Math.PI * 2;
        solids.push(solid.capsule("leaf", [dsin(a) * R * 0.82, h * 0.45, dcos(a) * R * 0.82], [dsin(a) * R * 0.72, h * 1.45, dcos(a) * R * 0.72], R * 0.22, { name: "rib", collide: false, styles: ["pixel"] }));
      }
      top = [0, h * 2, 0];
    } else {
      // Prickly pear: pads edge on edge, each turned a little.
      const pad = Math.min(H, 2) * 0.28;
      let p: Vec3 = [0, pad, 0];
      let yaw = J.between(0, Math.PI * 2);
      const n = 3 + Math.round(H);
      for (let i = 0; i < n; i += 1) {
        solids.push({ ...solid.ball("leaf", p, [Math.abs(dsin(yaw)) * pad * 0.8 + pad * 0.2, pad, Math.abs(dcos(yaw)) * pad * 0.8 + pad * 0.2], { name: "pad", collide: i === 0 }) });
        const side = i % 2 ? 1 : -1;
        p = [p[0] + dcos(yaw) * pad * 0.7 * side, p[1] + pad * 1.35, p[2] - dsin(yaw) * pad * 0.7 * side];
        yaw += J.between(0.4, 1.2);
        if (p[1] > H) break;
      }
      // (Its fruit: red knobs along the top pads' rims.)
      for (let i = 0; i < 3; i += 1) solids.push(solid.ball("fruit", [p[0] + (i - 1) * pad * 0.5, Math.min(p[1], H) - pad * 0.3, p[2]], pad * 0.16, { name: "fruit", collide: false }));
      top = [p[0], Math.min(p[1], H), p[2]];
    }
    if (bool(v["flower"])) solids.push(solid.ball("blossom", top, 0.12 + H * 0.03, { name: "flower", collide: false }));
    return { solids, front: null };
  },
});
