// Bones on the floor: long bones every which way, a rib cage now and then,
// a skull. Underfoot (nothing collides): the dungeon's litter.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { ACTS, bone, bool, num, roles, skull } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "bones",
  title: "Bones",
  tags: ["bones", "litter", "decal"],
  tier: "background",
  instancing: "many",
  variants: 8,
  choices: { count: [3, 5, 8], skull: [true, true, false], ribs: [false, true], spread: { range: [0.4, 0.9] } },
  look: { roles: roles("bone", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const n = num(v["count"]), R = num(v["spread"]);
    const solids: DesignSolid[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = J.between(0, Math.PI * 2), d = J.between(0, R), yaw = J.between(0, Math.PI), L = J.between(0.25, 0.45);
      const c: Vec3 = [dsin(a) * d, 0.03, dcos(a) * d];
      bone(solids, [c[0] - dsin(yaw) * L / 2, 0.03, c[2] - dcos(yaw) * L / 2], [c[0] + dsin(yaw) * L / 2, 0.03 + J.between(0, 0.04), c[2] + dcos(yaw) * L / 2], 0.022);
    }
    if (bool(v["ribs"])) {
      const cx = J.between(-R, R) * 0.5, cz = J.between(-R, R) * 0.5;
      solids.push(solid.capsule("bone", [cx - 0.22, 0.04, cz], [cx + 0.22, 0.04, cz], 0.025, { name: "spine", collide: false }));
      for (let k = 0; k < 5; k += 1) {
        const x = cx - 0.16 + k * 0.08;
        for (const s of [-1, 1]) solids.push(solid.capsule("bone", [x, 0.05, cz], [x + 0.02, 0.12, cz + s * 0.16], 0.016, { name: "rib", collide: false }));
      }
    }
    if (bool(v["skull"])) { const a = J.between(0, 6.28); skull(solids, [dsin(a) * R * 0.5, 0, dcos(a) * R * 0.5], 0.2, J.between(-0.8, 0.8)); }
    return { solids, front: null };
  },
});
