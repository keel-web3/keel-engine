// A bush: a clump of leafy blobs -- round, wide or tall -- bare, with berries
// or in blossom. Knee to head high.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { WIND, canopy, num, roles, scatter, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

const FORM = { round: [1, 0.85, 1], wide: [1.35, 0.7, 1.1], tall: [0.8, 1.3, 0.8] } as const;

export default defineStyledObject({
  id: "bush",
  title: "Bush",
  tags: ["bush", "shrub", "temperate"],
  tier: "background",
  instancing: "many",
  variants: 6,
  choices: { size: { range: [0.6, 1.8] }, form: ["round", "wide", "tall"], bloom: ["none", "berries", "blossom"], season: ["summer", "spring", "autumn", "winter"] },
  look: { roles: roles("leaf", "blossom", "fruit", "bark"), choices: ["season"], profiles: ["summer", "spring", "autumn", "winter", "dry", "tropical", "alien"] },
  sway: WIND.bush,
  design(J, v) {
    const s = num(v["size"]);
    const f = FORM[str(v["form"]) as keyof typeof FORM];
    const R: [number, number, number] = [s * 0.55 * f[0], s * 0.5 * f[1], s * 0.55 * f[2]];
    const c: [number, number, number] = [0, R[1] * 0.9, 0];
    const solids: DesignSolid[] = canopy("leaf", J, c, R, 5, { flat: 0.85, group: "bush" });
    // (The middle collides as a low box: you walk round a bush, not through it.)
    solids[0] = { ...solids[0]!, collide: true };
    // (Stems at its foot, under the leaves.)
    for (let i = 0; i < 3; i += 1) { const a = (i / 3) * Math.PI * 2 + 0.4; solids.push(solid.capsule("bark", [dsin(a) * s * 0.06, s * 0.04, dcos(a) * s * 0.06], [dsin(a) * R[0] * 0.5, R[1] * 0.7, dcos(a) * R[2] * 0.5], s * 0.035, { name: "stem", collide: false })); }
    const bloom = str(v["bloom"]);
    if (bloom === "berries") solids.push(...scatter("fruit", J, c, R, 7, s * 0.06, { group: "bush" }));
    if (bloom === "blossom") solids.push(...scatter("blossom", J, c, R, 9, s * 0.075, { below: 0.1, group: "bush" }));
    return { solids, front: null };
  },
});
