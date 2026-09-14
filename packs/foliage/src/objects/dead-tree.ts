// A dead tree: a bare, twisted trunk, two to five crooked branches (each in
// two kinks), a broken snag of a top or not, a hollow knot. Ash worlds,
// swamps, the edge of the map.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { bool, dirOf, num, roles, trunk } from "../kit.ts";

export default defineStyledObject({
  id: "dead-tree",
  title: "Dead tree",
  tags: ["tree", "dead", "swamp", "ash"],
  tier: "background",
  instancing: "many",
  choices: { height: { range: [4, 8] }, branches: [2, 3, 4, 5], snag: [false, true], lean: { range: [0, 0.35] } },
  look: { roles: roles("bark", "dark", "moss"), profiles: ["ash", "summer", "winter", "autumn", "alien"] },
  sway: null,
  design(J, v) {
    const H = num(v["height"]);
    const leanYaw = J.between(0, Math.PI * 2);
    const r0 = 0.14 + H * 0.022;
    const top = bool(v["snag"]) ? 0.72 : 1;
    const t = trunk("bark", H * top, r0, r0 * (bool(v["snag"]) ? 0.8 : 0.3), { lean: num(v["lean"]), leanYaw, segments: 4, bendPow: 1.2 });
    const solids: DesignSolid[] = [...t.solids];
    const n = num(v["branches"]);
    for (let i = 0; i < n; i += 1) {
      const at = J.between(0.4, 0.92);
      let p = t.at(at);
      let yaw = leanYaw + (i / n) * Math.PI * 2 + J.between(-0.5, 0.5);
      let pitch = J.between(0.2, 0.8);
      let r = t.radiusAt(at) * 0.55;
      for (let k = 0; k < 2; k += 1) {
        const L = H * J.between(0.12, 0.2) * (k === 0 ? 1.2 : 0.8);
        const d = dirOf(yaw, pitch);
        const q: Vec3 = [p[0] + d[0] * L, p[1] + d[1] * L, p[2] + d[2] * L];
        solids.push(solid.capsule("bark", p, q, r, { name: "branch", collide: false }));
        p = q; r *= 0.62; yaw += J.between(-0.7, 0.7); pitch += J.between(-0.2, 0.5);
      }
    }
    // (A hollow knot facing out on the lean side, and a scrap of moss at the foot.)
    const knot = t.at(0.3);
    const kr = t.radiusAt(0.3);
    solids.push(solid.ball("dark", [knot[0] + Math.sin(leanYaw) * kr * 0.75, knot[1], knot[2] + Math.cos(leanYaw) * kr * 0.75], kr * 0.45, { name: "hollow", collide: false }));
    solids.push(solid.ball("moss", [Math.sin(leanYaw + 2) * r0 * 0.9, r0 * 0.36, Math.cos(leanYaw + 2) * r0 * 0.9], [r0 * 0.9, r0 * 0.35, r0 * 0.9], { name: "moss", collide: false }));
    return { solids, front: null, sockets: { base: { kind: "anchor", pos: [0, 0, 0] }, perch: { kind: "anchor", pos: t.top } } };
  },
});
