// An alien tree for the RTS's strange worlds: a bulb tree (a twisting stalk,
// arms ending in glowing bulbs), a coral (branching twice, glowing tips) or a
// spire (swollen segments stacked, glowing rings between them).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { dirOf, num, roles, str, trunk } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "alien-tree",
  title: "Alien tree",
  tags: ["alien", "tree", "glow"],
  tier: "background",
  instancing: "many",
  choices: { height: { range: [3, 7] }, form: ["bulb", "coral", "spire"], arms: [3, 4, 5, 6] },
  look: { roles: roles("bark", "leaf", "glow"), profiles: ["alien", "fungal", "ash", "summer"] },
  sway: { amp: 0.04, hz: 0.3, bend: 2, from: 0.6 },
  design(J, v) {
    const H = num(v["height"]);
    const form = str(v["form"]);
    const arms = num(v["arms"]);
    const yaw0 = J.between(0, Math.PI * 2);
    const solids: DesignSolid[] = [];
    if (form === "spire") {
      let y = 0;
      const segs = 3 + Math.round(H / 2.5);
      for (let i = 0; i < segs; i += 1) {
        const k = 1 - i / segs;
        const h = (H / segs) * 1.05;
        const r = (0.25 + H * 0.07) * (0.45 + 0.55 * k);
        solids.push(solid.ball("bark", [0, i === 0 ? h * 0.62 : y + h * 0.5, 0], [r, h * 0.62, r], { name: "segment", collide: i === 0, group: "spire" }));
        if (i > 0) solids.push(solid.ball("glow", [0, y, 0], [r * 1.02, h * 0.1, r * 1.02], { name: "ring", collide: false, group: "spire" }));
        y += h;
      }
      solids.push(solid.ball("leaf", [0, y + 0.1, 0], 0.18 + H * 0.02, { name: "bud", collide: false, group: "spire" }));
      return { solids, front: null, sockets: { base: { kind: "anchor", pos: [0, 0, 0] } } };
    }
    const r0 = 0.12 + H * 0.025;
    const t = trunk("bark", H * (form === "bulb" ? 0.62 : 0.4), r0, r0 * 0.6, { lean: J.between(0.05, 0.2), leanYaw: yaw0, segments: 4, bendPow: 2.4 });
    solids.push(...t.solids);
    for (let i = 0; i < arms; i += 1) {
      const yaw = yaw0 + (i / arms) * Math.PI * 2 + J.between(-0.3, 0.3);
      if (form === "bulb") {
        const L = H * J.between(0.2, 0.34);
        const p = t.at(J.between(0.75, 1));
        const mid: Vec3 = [p[0] + dsin(yaw) * L * 0.6, p[1] + L * 0.2, p[2] + dcos(yaw) * L * 0.6];
        const tip: Vec3 = [p[0] + dsin(yaw) * L, p[1] + L * 0.75, p[2] + dcos(yaw) * L];
        solids.push(solid.capsule("bark", p, mid, r0 * 0.4, { name: "arm", collide: false, group: "arms" }));
        solids.push(solid.capsule("bark", mid, tip, r0 * 0.3, { name: "arm", collide: false, group: "arms" }));
        solids.push(solid.ball("glow", tip, [H * 0.07, H * 0.09, H * 0.07], { name: "bulb", collide: false, group: "arms" }));
        solids.push(solid.ball("leaf", [tip[0], tip[1] - H * 0.06, tip[2]], [H * 0.05, H * 0.03, H * 0.05], { name: "calyx", collide: false, group: "arms" }));
      } else {
        // (A coral: an arm, then two twigs off its end, glowing at the tips.)
        const p = t.top;
        const d = dirOf(yaw, J.between(0.5, 0.9));
        const L = H * J.between(0.22, 0.32);
        const q: Vec3 = [p[0] + d[0] * L, p[1] + d[1] * L, p[2] + d[2] * L];
        solids.push(solid.capsule("leaf", p, q, r0 * 0.45, { name: "arm", collide: false, group: "arms" }));
        for (const s of [-0.5, 0.5]) {
          const d2 = dirOf(yaw + s, J.between(0.7, 1.2));
          const L2 = L * J.between(0.5, 0.75);
          const tip: Vec3 = [q[0] + d2[0] * L2, q[1] + d2[1] * L2, q[2] + d2[2] * L2];
          solids.push(solid.capsule("leaf", q, tip, r0 * 0.28, { name: "twig", collide: false, group: "arms" }));
          solids.push(solid.ball("glow", tip, r0 * 0.42, { name: "tip", collide: false, group: "arms" }));
        }
      }
    }
    return { solids, front: null, sockets: { base: { kind: "anchor", pos: [0, 0, 0] } } };
  },
});
