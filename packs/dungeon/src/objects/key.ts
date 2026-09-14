// The key to the boss's door: a great gilt key with a glowing gem in its bow,
// lying on a small stone plinth (or a cushion). Walk over it to take it.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "key",
  title: "Great key",
  tags: ["key", "quest", "pickup", "light:key"],
  tier: "main",
  instancing: "few",
  variants: 1,
  choices: { rest: ["plinth", "cushion"] },
  look: { roles: roles("gold", "glow", "stone", "cushion"), profiles: [...ACTS] },
  sway: null,
  design(_J, v) {
    const solids: DesignSolid[] = [];
    let y = 0;
    if (str(v["rest"]) === "plinth") { solids.push(solid.box("stone", [0, 0.3, 0], [0.24, 0.3, 0.24], 0, { name: "plinth" })); solids.push(solid.box("stone", [0, 0.62, 0], [0.3, 0.04, 0.3], 0, { name: "cap" })); y = 0.66; }
    else { solids.push(solid.ball("cushion", [0, 0.12, 0], [0.3, 0.12, 0.26], { name: "cushion" })); y = 0.22; }
    // The key lying along x: bow, shaft, bit.
    solids.push(solid.capsule("gold", [-0.14, y + 0.04, 0], [0.26, y + 0.04, 0], 0.03, { name: "shaft", collide: false }));
    solids.push(solid.ball("gold", [-0.22, y + 0.04, 0], [0.1, 0.035, 0.1], { name: "bow", collide: false }));
    solids.push(solid.ball("glow", [-0.22, y + 0.08, 0], 0.045, { name: "gem", collide: false }));
    solids.push(solid.box("gold", [0.22, y + 0.04, 0.07], [0.04, 0.025, 0.06], 0, { name: "bit", collide: false }));
    return { solids, front: null, meta: { flames: [[0, y + 0.1, 0]], light: "key" } };
  },
});
