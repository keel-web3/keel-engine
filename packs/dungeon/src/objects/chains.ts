// Chains on a wall: an iron plate and hook high up, one to three strands
// hanging from it, shackles (or a hook) at the ends. Its back is the wall
// (z = 0); it hangs into the room (+z).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, bool, chain, num, roles } from "../kit.ts";

export default defineStyledObject({
  id: "chains",
  title: "Wall chains",
  tags: ["chains", "wall", "prison"],
  tier: "background",
  instancing: "many",
  variants: 6,
  choices: { strands: [1, 2, 3], length: { range: [0.7, 1.5] }, shackles: [true, false] },
  look: { roles: roles("metal", "dark"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const n = num(v["strands"]), L = num(v["length"]);
    const solids: DesignSolid[] = [];
    const top = 2.35;
    const span = (n - 1) * 0.28;
    solids.push(solid.box("dark", [0, top + 0.04, 0.02], [span / 2 + 0.12, 0.08, 0.02], 0, { name: "plate", collide: false }));
    for (let i = 0; i < n; i += 1) {
      const x = -span / 2 + i * 0.28;
      const len = L * J.between(0.75, 1.1);
      solids.push(solid.box("metal", [x, top, 0.05], [0.04, 0.04, 0.04], 0, { name: "ring", collide: false }));
      chain(solids, [x, top - 0.04, 0.07], [x + J.between(-0.04, 0.04), top - len, 0.08], Math.max(4, Math.round(len / 0.08)), 0.045);
      if (bool(v["shackles"])) solids.push(solid.ball("metal", [x, top - len - 0.07, 0.08], [0.09, 0.05, 0.03], { name: "shackle", collide: false }));
      else solids.push(solid.capsule("metal", [x, top - len - 0.02, 0.08], [x + 0.06, top - len - 0.1, 0.1], 0.02, { name: "hook", collide: false }));
    }
    return { solids, front: "+z" };
  },
});
