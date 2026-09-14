// A tombstone: an upright slab with a rounded head, a cross, or a broken
// stub, leaning a little, moss at its foot. A ruin's graveyard, a crypt's.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "tombstone",
  title: "Tombstone",
  tags: ["tombstone", "grave", "block"],
  tier: "foreground",
  instancing: "many",
  variants: 6,
  choices: { form: ["round", "cross", "broken"], height: { range: [0.7, 1.2] }, moss: [true, false] },
  look: { roles: roles("stone", "moss", "dark"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const form = str(v["form"]), H = num(v["height"]);
    const solids: DesignSolid[] = [];
    const lean = J.between(-0.06, 0.06);
    if (form === "cross") {
      solids.push(solid.box("stone", [lean, H * 0.5, 0], [0.07, H * 0.5, 0.07], 0, { name: "shaft" }));
      solids.push(solid.box("stone", [lean * 1.4, H * 0.72, 0], [0.28, 0.07, 0.07], 0, { name: "arm" }));
    } else {
      const h = form === "broken" ? H * 0.55 : H;
      solids.push(solid.box("stone", [lean * 0.5, h * 0.45, 0], [0.3, h * 0.45, 0.08], lean, { name: "slab" }));
      if (form === "round") solids.push(solid.capsule("stone", [-0.18 + lean, h * 0.9, 0], [0.18 + lean, h * 0.9, 0], 0.12, { name: "head" }));
      solids.push(solid.box("dark", [lean * 0.5, h * 0.55, 0.085], [0.14, 0.02, 0.005], 0, { name: "epitaph", collide: false }));
      solids.push(solid.box("dark", [lean * 0.5, h * 0.45, 0.085], [0.1, 0.015, 0.005], 0, { name: "epitaph", collide: false }));
    }
    solids.push(solid.box("stone", [0, 0.04, 0.2], [0.34, 0.04, 0.4], 0, { name: "grave" }));
    if (v["moss"] === true) solids.push(solid.ball("moss", [0, 0.06, 0.1], [0.34, 0.05, 0.25], { name: "moss", collide: false }));
    return { solids, front: "+z" };
  },
});
