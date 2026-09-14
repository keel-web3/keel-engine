// A wall torch: an iron plate, an arm, a pitch-wrapped stick (or a sconce's
// bowl of coals, or a torch in a little iron cage). The renderer draws the
// flame at meta.flames[0] and lights the room from it. Its back is the wall.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { ACTS, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "torch",
  title: "Wall torch",
  tags: ["torch", "light", "wall", "light:torch"],
  tier: "main",
  instancing: "many",
  variants: 1,
  choices: { form: ["bracket", "bracket", "sconce", "cage"] },
  look: { roles: roles("metal", "wood", "glow", "dark"), profiles: [...ACTS] },
  sway: null,
  design(_J, v) {
    const form = str(v["form"]);
    const solids: DesignSolid[] = [];
    solids.push(solid.box("dark", [0, 1.85, 0.02], [0.07, 0.12, 0.02], 0, { name: "plate", collide: false }));
    solids.push(solid.ball("metal", [0, 1.85, 0.05], 0.03, { name: "rivet", collide: false }));
    let flame: Vec3;
    if (form === "sconce") {
      solids.push(solid.capsule("metal", [0, 1.8, 0.04], [0, 1.92, 0.22], 0.025, { name: "arm", collide: false }));
      solids.push(solid.cone("metal", [0, 1.92, 0.24], 0.05, 0.1, 0.14, { name: "bowl", collide: false, sides: 8 }));
      solids.push(solid.ball("glow", [0, 2.03, 0.24], [0.1, 0.03, 0.1], { name: "coals", collide: false }));
      flame = [0, 2.1, 0.24];
    } else {
      solids.push(solid.capsule("metal", [0, 1.78, 0.04], [0, 1.9, 0.26], 0.022, { name: "arm", collide: false }));
      solids.push(solid.cylinder("metal", [0, 1.86, 0.28], 0.05, 0.06, { name: "cup", collide: false, sides: 8 }));
      solids.push(solid.capsule("wood", [0, 1.8, 0.28], [0, 2.14, 0.31], 0.028, { name: "stick", collide: false }));
      solids.push(solid.ball("dark", [0, 2.16, 0.31], [0.05, 0.06, 0.05], { name: "pitch", collide: false }));
      if (form === "cage") for (let i = 0; i < 4; i += 1) { const a = (i / 4) * Math.PI * 2 + 0.4; solids.push(solid.capsule("metal", [dsin(a) * 0.08, 2.1, 0.31 + dcos(a) * 0.08], [dsin(a) * 0.1, 2.34, 0.31 + dcos(a) * 0.1], 0.012, { name: "cage", collide: false })); }
      flame = [0, 2.26, 0.31];
    }
    return { solids, front: "+z", meta: { flames: [flame], light: form === "sconce" ? "sconce" : "torch" } };
  },
});
