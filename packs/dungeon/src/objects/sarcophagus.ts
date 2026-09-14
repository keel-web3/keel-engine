// A sarcophagus: a stone coffin on a plinth, its lid closed (an effigy of
// the dead carved on it, a cross, or plain), pushed ajar, or off and lying
// beside it with the bones showing. Its feet are its front (+z).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, bone, num, roles, skull, str } from "../kit.ts";

export default defineStyledObject({
  id: "sarcophagus",
  title: "Sarcophagus",
  tags: ["sarcophagus", "tomb", "crypt", "block"],
  tier: "foreground",
  instancing: "many",
  variants: 3,
  choices: { length: { range: [1.9, 2.3] }, lid: ["closed", "closed", "ajar", "open"], carving: ["effigy", "plain", "cross"] },
  look: { roles: roles("stone", "gold", "bone", "dark"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const L = num(v["length"]), lid = str(v["lid"]), carving = str(v["carving"]);
    const hw = 0.46, hl = L / 2, h = 0.7;
    const solids: DesignSolid[] = [];
    solids.push(solid.box("stone", [0, 0.06, 0], [hw + 0.08, 0.06, hl + 0.08], 0, { name: "plinth" }));
    solids.push(solid.box("stone", [0, 0.12 + (h - 0.12) / 2, 0], [hw, (h - 0.12) / 2, hl], 0, { name: "coffin" }));
    // (Carved panels down each long side, a gold-inlaid band over them, a moulded foot.)
    // (Raised panels, each with a boss in its middle: carved, not holes -- the outline draws their edges.)
    for (const s of [-1, 1]) for (let q = 0; q < 3; q += 1) {
      solids.push(solid.box("stone", [s * (hw + 0.012), 0.38, (q - 1) * hl * 0.6], [0.014, 0.13, hl * 0.23], 0, { name: "panel", collide: false }));
      solids.push(solid.ball(q === 1 ? "gold" : "stone", [s * (hw + 0.028), 0.38, (q - 1) * hl * 0.6], [0.02, 0.05, 0.05], { name: "boss", collide: false }));
    }
    for (const s of [-1, 1]) solids.push(solid.box("stone", [0, 0.38, s * (hl + 0.012)], [hw * 0.7, 0.13, 0.014], 0, { name: "panel", collide: false }));
    solids.push(solid.box("gold", [hw + 0.005, h * 0.66, 0], [0.01, 0.025, hl * 0.86], 0, { name: "inlay", collide: false }));
    solids.push(solid.box("stone", [0, 0.15, 0], [hw + 0.04, 0.03, hl + 0.04], 0, { name: "foot", collide: false }));
    // (The lid: a slab and a narrower one on it -- a moulded, stepped top; a dark seam under it.)
    const lidAt = (dx: number, dz: number, yaw: number, y = h + 0.06) => {
      solids.push(solid.box("stone", [dx, y, dz], [hw + 0.04, 0.05, hl + 0.04], yaw, { name: "lid" }));
      solids.push(solid.box("stone", [dx, y + 0.07, dz], [hw - 0.06, 0.025, hl - 0.08], yaw, { name: "lid.top", collide: false }));
    };
    solids.push(solid.box("dark", [0, h + 0.003, 0], [hw + 0.006, 0.008, hl + 0.006], 0, { name: "seam", collide: false }));
    if (lid === "closed") {
      lidAt(0, 0, 0);
      if (carving === "effigy") {
        const y = h + 0.15;
        solids.push(solid.ball("stone", [0, y + 0.06, -hl + 0.3], [0.13, 0.08, 0.14], { name: "head", collide: false }));
        solids.push(solid.box("stone", [0, y + 0.05, 0.05], [0.2, 0.05, hl * 0.62], 0, { name: "body", collide: false }));
        solids.push(solid.ball("stone", [0, y + 0.1, -0.15], [0.11, 0.05, 0.1], { name: "hands", collide: false }));
        solids.push(solid.box("gold", [0, y + 0.12, 0.2], [0.03, 0.02, 0.35], 0, { name: "sword", collide: false }));
      } else if (carving === "cross") {
        solids.push(solid.box("gold", [0, h + 0.16, 0.05], [0.04, 0.012, hl * 0.6], 0, { name: "cross", collide: false }));
        solids.push(solid.box("gold", [0, h + 0.16, -hl * 0.25], [0.24, 0.012, 0.04], 0, { name: "cross", collide: false }));
      }
    } else {
      solids.push(solid.box("dark", [0, h - 0.01, 0], [hw - 0.07, 0.02, hl - 0.07], 0, { name: "inside", collide: false }));
      skull(solids, [0, h - 0.12, -hl + 0.3], 0.2, 0);
      bone(solids, [-0.12, h - 0.02, -0.2], [0.1, h - 0.02, 0.4], 0.024);
      if (lid === "ajar") lidAt(0.22, 0.3, 0.32, h + 0.07);
      else solids.push(solid.box("stone", [hw + 0.55, 0.06, J.between(-0.2, 0.2)], [hw + 0.04, 0.06, hl + 0.04], J.between(-0.3, 0.3), { name: "lid" }));
    }
    return { solids, front: "+z" };
  },
});
