// Rubble: a heap of broken stone, fallen ashlar blocks, or a toppled column
// broken into drums. Where a wall gave way, a ceiling fell, a room ruined.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "rubble",
  title: "Rubble",
  tags: ["rubble", "stone", "litter"],
  tier: "background",
  instancing: "many",
  variants: 8,
  choices: { size: { range: [0.5, 1.4] }, form: ["heap", "heap", "blocks", "column"], moss: [false, false, true] },
  look: { roles: roles("stone", "moss", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const s = num(v["size"]), form = str(v["form"]);
    const solids: DesignSolid[] = [];
    if (form === "heap") {
      solids.push(solid.ball("dark", [0, 0.02, 0], [s * 0.55, 0.02, s * 0.5], { name: "dust", collide: false }));
      for (let i = 0; i < 9; i += 1) {
        const a = J.between(0, 6.28), d = J.between(0, s * 0.45), r = s * J.between(0.08, 0.2);
        if (i % 3 === 0) solids.push(solid.box("stone", [dsin(a) * d, r * 0.8 + (d < s * 0.2 ? s * 0.12 : 0), dcos(a) * d], [r, r * 0.8, r * 0.9], J.between(0, 3.14), { name: "chunk" }));
        else solids.push(solid.ball("stone", [dsin(a) * d, r * 0.7, dcos(a) * d], [r, r * 0.7, r * 0.9], { name: "stone" }));
      }
    } else if (form === "blocks") {
      for (let i = 0; i < 3; i += 1) { const a = J.between(0, 6.28), d = J.between(0.1, s * 0.5); solids.push(solid.box("stone", [dsin(a) * d, s * 0.14 + (i === 2 ? s * 0.28 : 0), dcos(a) * d], [s * 0.3, s * 0.14, s * 0.18], J.between(0, 3.14), { name: "block" })); }
      for (let i = 0; i < 5; i += 1) { const a = J.between(0, 6.28); solids.push(solid.ball("stone", [dsin(a) * s * 0.5, 0.04, dcos(a) * s * 0.5], [0.06, 0.04, 0.06], { name: "chip", collide: false })); }
    } else {
      const yaw = J.between(0, 3.14), r = s * 0.22;
      for (let i = 0; i < 3; i += 1) {
        const t = (i - 1) * s * 0.55;
        solids.push(solid.capsule("stone", [dsin(yaw) * (t - s * 0.22) + J.between(-0.04, 0.04), r, dcos(yaw) * (t - s * 0.22)], [dsin(yaw) * (t + s * 0.22), r, dcos(yaw) * (t + s * 0.22)], r, { name: "drum" }));
      }
      solids.push(solid.box("stone", [0, s * 0.12, 0], [s * 0.3, s * 0.12, s * 0.3], yaw + 0.4, { name: "capital" }));
    }
    if (v["moss"] === true) solids.push(solid.ball("moss", [0, s * 0.25, 0], [s * 0.35, s * 0.06, s * 0.3], { name: "moss", collide: false }));
    return { solids, front: null };
  },
});
