// An oak: a stout trunk that forks low or high into two to four limbs, a
// crown of blobs over their tips -- round, wide or tall -- leaning a little
// or not at all; acorns now and then, moss at its foot. The
// canopy never collides (units walk under it); the trunk does.
import { defineStyledObject } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { solid } from "@keel-engine/object";
import { WIND, bool, branch, canopy, dirOf, num, roles, scatter, str, trunk } from "../kit.ts";

const CROWN = { round: [1, 0.85, 1], wide: [1.3, 0.7, 1.25], tall: [0.8, 1.15, 0.8] } as const;

export default defineStyledObject({
  id: "oak",
  title: "Oak",
  tags: ["tree", "deciduous", "temperate"],
  tier: "background",
  instancing: "many",
  choices: { height: { range: [5, 9] }, crown: ["round", "wide", "tall"], fork: ["low", "high"], limbs: [2, 3, 4], lean: { range: [0, 0.25] }, acorns: [false, true], moss: [true, false], season: ["summer", "spring", "autumn", "winter"] },
  look: { roles: roles("leaf", "bark", "fruit", "moss"), choices: ["season"], profiles: ["summer", "spring", "autumn", "winter", "dry", "alien"] },
  sway: WIND.tree,
  design(J, v) {
    const H = num(v["height"]);
    const shape = CROWN[str(v["crown"]) as keyof typeof CROWN];
    const leanYaw = J.between(0, Math.PI * 2);
    const forkAt = str(v["fork"]) === "low" ? 0.32 : 0.5;
    const r0 = 0.16 + H * 0.028;
    const t = trunk("bark", H * forkAt, r0, r0 * 0.78, { lean: num(v["lean"]) * 0.6, leanYaw, segments: 3 });
    const solids: DesignSolid[] = [...t.solids];
    const R: Vec3 = [H * 0.36 * shape[0], H * 0.3 * shape[1], H * 0.36 * shape[2]];
    const crownC: Vec3 = [t.top[0], H - R[1] * 0.95, t.top[2]];
    const n = num(v["limbs"]);
    for (let i = 0; i < n; i += 1) {
      const yaw = leanYaw + (i / n) * Math.PI * 2 + J.between(-0.3, 0.3);
      const target: Vec3 = [crownC[0] + Math.sin(yaw) * R[0] * 0.45, crownC[1] - R[1] * 0.1, crownC[2] + Math.cos(yaw) * R[2] * 0.45];
      const d: Vec3 = [target[0] - t.top[0], target[1] - t.top[1], target[2] - t.top[2]];
      const L = Math.hypot(...d);
      solids.push(branch("bark", t.top, [d[0] / L, d[1] / L, d[2] / L], L, r0 * 0.5, "limb").solid);
    }
    // (A low twig or two below the crown: the silhouette's broken edge.)
    const tw = branch("bark", t.at(0.85), dirOf(leanYaw + 2.2, 0.5), R[0] * 0.55, r0 * 0.25, "twig");
    solids.push(tw.solid, ...canopy("leaf", J, tw.tip, [R[0] * 0.3, R[1] * 0.25, R[2] * 0.3], 2, { group: "canopy" }));
    solids.push(...canopy("leaf", J, crownC, R, 5 + n));
    if (bool(v["acorns"])) solids.push(...scatter("fruit", J, crownC, R, 8, H * 0.018, { below: -0.6 }));
    // (Moss on the trunk's shaded side, at its foot.)
    if (bool(v["moss"])) solids.push(solid.ball("moss", [-Math.sin(leanYaw) * r0 * 0.8, r0 * 1.2, -Math.cos(leanYaw) * r0 * 0.8], [r0 * 0.75, r0 * 1.1, r0 * 0.75], { name: "moss", collide: false }));
    return {
      solids,
      front: null,
      sockets: {
        base: { kind: "anchor", pos: [0, 0, 0] },
        // (Where a lantern, a swing or a bird's nest hangs: under the crown on the lean side.)
        bough: { kind: "hang", pos: [crownC[0] + Math.sin(leanYaw) * R[0] * 0.5, crownC[1] - R[1] * 0.7, crownC[2] + Math.cos(leanYaw) * R[2] * 0.5] },
      },
      sway: WIND.tree,
    };
  },
});
