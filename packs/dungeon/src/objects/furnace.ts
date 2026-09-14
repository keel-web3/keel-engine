// A forge's furnace against a wall: a squat kiln of stone blocks, its arched
// mouth glowing, a chimney hood above, a pair of leather bellows at its side,
// a coal heap in front. A light source (meta.flames: the mouth).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, bool, num, roles } from "../kit.ts";

export default defineStyledObject({
  id: "furnace",
  title: "Furnace",
  tags: ["furnace", "forge", "fire", "wall", "block", "light:brazier"],
  tier: "main",
  instancing: "few",
  variants: 2,
  choices: { width: { range: [1.5, 1.9] }, bellows: [true, false], hood: [true, true, false] },
  look: { roles: roles("stone", "metal", "leather", "wood", "glow", "dark"), profiles: [...ACTS] },
  sway: null,
  design(_J, v) {
    const W = num(v["width"]), D = 1.0, H = 1.15;
    const solids: DesignSolid[] = [];
    // (Its back on the wall: the kiln from z = 0 to D.)
    // (Three courses of big blocks, each course set a little in and its joints staggered: the outline draws the masonry.)
    for (let c = 0; c < 3; c += 1) {
      const n = c % 2 === 0 ? 3 : 2, y0 = (c * H) / 3, inset = c * 0.03;
      for (let b = 0; b < n; b += 1) {
        const bw = (W - inset * 2) / n;
        solids.push(solid.box("stone", [-W / 2 + inset + bw * (b + 0.5), y0 + H / 6, D / 2], [bw / 2 - 0.006, H / 6 - 0.006, D / 2 - inset], 0, { name: "kiln" }));
      }
    }
    solids.push(solid.box("stone", [0, H + 0.06, D / 2], [W / 2 + 0.06, 0.06, D / 2 + 0.06], 0, { name: "lip" }));
    // The mouth: a dark recess with the fire in it, an iron lintel over it.
    solids.push(solid.box("dark", [0, 0.45, D + 0.005], [W * 0.3, 0.3, 0.02], 0, { name: "mouth", collide: false }));
    solids.push(solid.ball("glow", [0, 0.38, D + 0.01], [W * 0.26, 0.24, 0.06], { name: "fire", collide: false }));
    solids.push(solid.box("metal", [0, 0.8, D + 0.02], [W * 0.38, 0.05, 0.03], 0, { name: "lintel", collide: false }));
    if (bool(v["hood"])) solids.push(solid.cone("metal", [0, H + 0.12, D * 0.4], W * 0.4, 0.45, 0.12, { name: "hood", sides: 4 }));
    if (bool(v["bellows"])) {
      const x = W / 2 + 0.35;
      solids.push(solid.wedge("leather", [x, 0.3, D * 0.6], [0.25, 0.14, 0.4], 0, 0.3, { name: "bellows" }));
      solids.push(solid.capsule("wood", [x, 0.46, D * 0.2], [x, 0.62, D * 1.05], 0.03, { name: "handle", collide: false }));
    }
    for (let i = 0; i < 4; i += 1) solids.push(solid.ball("dark", [(i - 1.5) * 0.18, 0.06, D + 0.3 + (i % 2) * 0.1], [0.12, 0.06, 0.1], { name: "coal", collide: false }));
    return { solids, front: "+z", meta: { flames: [[0, 0.45, D + 0.08]], light: "brazier" } };
  },
});
