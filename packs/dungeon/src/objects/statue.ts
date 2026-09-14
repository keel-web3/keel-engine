// A statue on a plinth: an armoured knight leaning on his sword, a hunched
// horned idol, or a plain obelisk with a gilt band. Stone through and
// through; they stand guard in halls and boss rooms.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, bool, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "statue",
  title: "Statue",
  tags: ["statue", "hall", "block"],
  tier: "foreground",
  instancing: "few",
  variants: 2,
  choices: { form: ["knight", "idol", "obelisk"], broken: [false, false, true], moss: [false, true] },
  look: { roles: roles("stone", "gold", "moss", "dark"), profiles: [...ACTS] },
  sway: null,
  design(_J, v) {
    const form = str(v["form"]);
    const solids: DesignSolid[] = [];
    solids.push(solid.box("stone", [0, 0.2, 0], [0.45, 0.2, 0.45], 0, { name: "plinth" }));
    solids.push(solid.box("gold", [0, 0.36, 0.455], [0.35, 0.025, 0.008], 0, { name: "plaque", collide: false }));
    const y = 0.4;
    if (form === "knight") {
      for (const s of [-1, 1]) solids.push(solid.capsule("stone", [s * 0.12, y + 0.05, 0], [s * 0.12, y + 0.8, 0], 0.09, { name: "leg" }));
      solids.push(solid.box("stone", [0, y + 1.15, 0], [0.27, 0.35, 0.16], 0, { name: "torso" }));
      for (const s of [-1, 1]) solids.push(solid.ball("stone", [s * 0.3, y + 1.45, 0], [0.13, 0.1, 0.12], { name: "pauldron" }));
      if (!bool(v["broken"])) { solids.push(solid.ball("stone", [0, y + 1.7, 0], [0.14, 0.16, 0.14], { name: "helm" })); solids.push(solid.box("dark", [0, y + 1.7, 0.13], [0.08, 0.018, 0.01], 0, { name: "visor", collide: false })); }
      solids.push(solid.box("stone", [0, y + 0.55, 0.28], [0.03, 0.55, 0.012], 0, { name: "blade", collide: false }));
      solids.push(solid.box("stone", [0, y + 1.1, 0.28], [0.13, 0.025, 0.03], 0, { name: "guard", collide: false }));
      for (const s of [-1, 1]) solids.push(solid.capsule("stone", [s * 0.3, y + 1.35, 0.02], [s * 0.05, y + 1.12, 0.26], 0.06, { name: "arm" }));
    } else if (form === "idol") {
      solids.push(solid.ball("stone", [0, y + 0.55, 0], [0.38, 0.5, 0.34], { name: "body" }));
      solids.push(solid.ball("stone", [0, y + 1.1, 0.08], [0.22, 0.2, 0.2], { name: "head" }));
      for (const s of [-1, 1]) { solids.push(solid.capsule("stone", [s * 0.16, y + 1.25, 0.05], [s * 0.34, y + 1.55, -0.05], 0.05, { name: "horn", collide: false })); solids.push(solid.ball("gold", [s * 0.08, y + 1.14, 0.26], 0.035, { name: "eye", collide: false })); }
    } else {
      solids.push(solid.cone("stone", [0, y, 0], 0.3, bool(v["broken"]) ? 1.3 : 2.2, 0.12, { name: "obelisk", sides: 4, steps: 6 }));
      solids.push(solid.box("gold", [0, y + 0.6, 0], [0.29, 0.04, 0.29], 0, { name: "band", collide: false }));
    }
    if (bool(v["broken"])) solids.push(solid.ball("stone", [0.55, 0.1, 0.3], [0.16, 0.1, 0.14], { name: "fallen", collide: false }));
    if (bool(v["moss"])) solids.push(solid.ball("moss", [0, 0.42, 0], [0.47, 0.05, 0.47], { name: "moss", collide: false }));
    else solids.push(solid.box("dark", [0, 0.01, 0], [0.5, 0.01, 0.5], 0, { name: "shadow", collide: false }));
    return { solids, front: "+z" };
  },
});
