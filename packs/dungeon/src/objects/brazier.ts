// A brazier: an iron bowl of coals on a tripod, a squat bowl on the floor,
// or a fire basket on a stone pillar. The flame (meta.flames) and the light
// are the renderer's; the coals glow on their own.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "brazier",
  title: "Brazier",
  tags: ["brazier", "fire", "light", "block", "light:brazier"],
  tier: "main",
  instancing: "many",
  variants: 2,
  choices: { height: { range: [0.8, 1.25] }, form: ["tripod", "bowl", "pillar"] },
  look: { roles: roles("metal", "stone", "glow", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(_J, v) {
    const form = str(v["form"]);
    const H = form === "bowl" ? 0.45 : num(v["height"]);
    const solids: DesignSolid[] = [];
    const R = form === "bowl" ? 0.42 : 0.36;
    if (form === "tripod") for (let i = 0; i < 3; i += 1) { const a = (i / 3) * Math.PI * 2 + 0.5; solids.push(solid.capsule("metal", [Math.sin(a) * 0.32, 0.02, Math.cos(a) * 0.32], [Math.sin(a) * 0.12, H - 0.2, Math.cos(a) * 0.12], 0.03, { name: "leg" })); }
    if (form === "pillar") { solids.push(solid.box("stone", [0, 0.06, 0], [0.32, 0.06, 0.32], 0, { name: "base" })); solids.push(solid.cylinder("stone", [0, 0.12, 0], 0.2, H - 0.34, { name: "pillar", sides: 8 })); }
    const b0 = H - 0.26;
    solids.push(solid.cone("metal", [0, b0, 0], R * 0.35, 0.26, R, { name: "bowl", sides: 8 }));
    solids.push(solid.cylinder("dark", [0, H - 0.02, 0], R * 0.9, 0.03, { name: "rim", collide: false, sides: 8 }));
    for (let i = 0; i < 5; i += 1) { const a = i * 1.3; solids.push(solid.ball("glow", [Math.sin(a) * R * 0.45, H + 0.02, Math.cos(a) * R * 0.45], [0.09, 0.05, 0.09], { name: "coal", collide: false })); }
    return { solids, front: null, meta: { flames: [[0, H + 0.08, 0]], light: "brazier" } };
  },
});
