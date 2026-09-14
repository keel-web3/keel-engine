// A weapon rack against a wall: two posts and their crossbars, swords point
// down, spears up, axes, a shield leant at its foot. Its back is the wall.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "weapon-rack",
  title: "Weapon rack",
  tags: ["weapons", "armoury", "wall", "block"],
  tier: "foreground",
  instancing: "many",
  variants: 4,
  choices: { width: { range: [1.1, 1.8] }, load: ["swords", "spears", "axes", "mixed"], shield: [true, false] },
  look: { roles: roles("wood", "metal", "gold", "leather", "cloth", "accent"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const W = num(v["width"]), load = str(v["load"]);
    const solids: DesignSolid[] = [];
    const z = 0.18;
    for (const s of [-1, 1]) solids.push(solid.box("wood", [s * W / 2, 0.9, z], [0.05, 0.9, 0.05], 0, { name: "post" }));
    for (const y of [0.35, 1.3]) solids.push(solid.box("wood", [0, y, z], [W / 2, 0.035, 0.04], 0, { name: "bar", collide: false }));
    const n = Math.max(3, Math.round(W / 0.26));
    for (let i = 0; i < n; i += 1) {
      const x = -W / 2 + 0.15 + (i * (W - 0.3)) / (n - 1);
      const kind = load === "mixed" ? ["swords", "spears", "axes"][i % 3]! : load;
      if (kind === "swords") {
        solids.push(solid.box("metal", [x, 0.75, z + 0.06], [0.03, 0.55, 0.008], 0, { name: "blade", collide: false }));
        solids.push(solid.box("gold", [x, 1.32, z + 0.06], [0.1, 0.02, 0.02], 0, { name: "guard", collide: false }));
        solids.push(solid.box("leather", [x, 1.45, z + 0.06], [0.022, 0.11, 0.022], 0, { name: "grip", collide: false }));
        solids.push(solid.ball("gold", [x, 1.58, z + 0.06], 0.035, { name: "pommel", collide: false }));
      } else if (kind === "spears") {
        solids.push(solid.capsule("wood", [x, 0.05, z + 0.06], [x, 2.0, z + 0.06], 0.022, { name: "shaft", collide: false }));
        solids.push(solid.cone("metal", [x, 2.0, z + 0.06], 0.05, 0.26, 0, { name: "head", collide: false, sides: 4 }));
        solids.push(solid.box("cloth", [x, 1.92, z + 0.06], [0.04, 0.06, 0.01], 0, { name: "pennant", collide: false }));
      } else {
        solids.push(solid.capsule("wood", [x, 0.05, z + 0.06], [x, 1.5, z + 0.06], 0.024, { name: "haft", collide: false }));
        solids.push(solid.box("metal", [x + 0.09, 1.38, z + 0.06], [0.1, 0.12, 0.012], 0, { name: "axehead", collide: false }));
      }
    }
    if (v["shield"] === true) {
      const x = J.between(-W / 3, W / 3);
      solids.push(solid.ball("accent", [x, 0.42, z + 0.28], [0.32, 0.38, 0.05], { name: "shield", collide: false }));
      solids.push(solid.ball("gold", [x, 0.44, z + 0.33], [0.08, 0.08, 0.03], { name: "boss", collide: false }));
    }
    return { solids, front: "+z" };
  },
});
