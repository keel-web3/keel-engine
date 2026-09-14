// An anvil on its stump, a hammer across it, tongs leant against it -- a
// forge's work floor.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, roles } from "../kit.ts";

export default defineStyledObject({
  id: "anvil",
  title: "Anvil",
  tags: ["anvil", "forge", "block"],
  tier: "foreground",
  instancing: "few",
  variants: 2,
  choices: { stump: [true, false] },
  look: { roles: roles("metal", "wood", "glow", "dark"), profiles: [...ACTS] },
  sway: null,
  design(_J, v) {
    const solids: DesignSolid[] = [];
    const y = v["stump"] === true ? 0.5 : 0.25;
    if (v["stump"] === true) solids.push(solid.cylinder("wood", [0, 0, 0], 0.3, 0.5, { name: "stump", sides: 8 }));
    else solids.push(solid.box("dark", [0, 0.12, 0], [0.25, 0.12, 0.2], 0, { name: "block" }));
    solids.push(solid.box("metal", [0, y + 0.08, 0], [0.18, 0.08, 0.14], 0, { name: "waist" }));
    solids.push(solid.box("metal", [0, y + 0.22, 0], [0.34, 0.07, 0.16], 0, { name: "face" }));
    solids.push(solid.cone("metal", [0.34, y + 0.18, 0], 0.08, 0.1, 0.02, { name: "horn", sides: 4, collide: false }));
    solids.push(solid.capsule("wood", [-0.2, y + 0.31, -0.1], [0.12, y + 0.31, 0.12], 0.025, { name: "hammer", collide: false }));
    solids.push(solid.box("metal", [-0.22, y + 0.33, -0.12], [0.05, 0.04, 0.08], 0.6, { name: "head", collide: false }));
    solids.push(solid.ball("glow", [0.1, y + 0.3, 0], [0.08, 0.02, 0.05], { name: "hot", collide: false }));
    return { solids, front: null };
  },
});
