// A pile of skulls: a pyramid of them on a heap of long bones -- a catacomb's
// offering, a warning at a boss's door.
import { defineStyledObject } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, bone, num, roles, skull } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "skull-pile",
  title: "Pile of skulls",
  tags: ["skulls", "bones", "litter"],
  tier: "foreground",
  instancing: "many",
  variants: 6,
  choices: { count: [4, 7, 10], size: { range: [0.18, 0.26] }, form: ["heap", "heap", "pyramid"] },
  look: { roles: roles("bone", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const n = num(v["count"]), s = num(v["size"]);
    const solids: DesignSolid[] = [];
    for (let i = 0; i < 5; i += 1) { const a = J.between(0, 6.28), L = J.between(0.3, 0.5); bone(solids, [dsin(a) * 0.3, 0.03, dcos(a) * 0.3], [dsin(a + 2) * 0.3 + dsin(a) * L * 0.2, 0.05, dcos(a + 2) * 0.3], 0.024); }
    if (v["form"] === "heap") {
      // (A heap: skulls tumbled over a mound of bones, some on their sides, one rolled off.)
      for (let i = 0; i < n; i += 1) {
        const a = J.between(0, 6.28), d = J.between(0, 0.42) * (i === n - 1 ? 1.6 : 1), up = Math.max(0, 0.34 - d) * s * 2.2;
        skull(solids, [dsin(a) * d, up, dcos(a) * d * 0.85], s * J.between(0.85, 1.1), J.between(-3.1, 3.1));
      }
      return { solids, front: null };
    }
    // (Rows of skulls, each row fewer and higher.)
    let placed = 0, row = 0;
    while (placed < n && row < 4) {
      const inRow = Math.max(1, 4 - row);
      for (let k = 0; k < inRow && placed < n; k += 1, placed += 1) {
        const a = (k / inRow) * Math.PI * 2 + row * 0.7 + J.between(-0.2, 0.2);
        const d = (3 - row) * s * 0.42;
        skull(solids, [dsin(a) * d, row * s * 0.62, dcos(a) * d * 0.8], s, J.between(-0.6, 0.6));
      }
      row += 1;
    }
    return { solids, front: null };
  },
});
