// A cage: iron bars round a ring, a domed top -- standing on the floor, or
// hung from a chain with its floor off the ground; empty, or someone's bones.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, bone, chain, num, roles, skull, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "cage",
  title: "Cage",
  tags: ["cage", "prison", "block"],
  tier: "foreground",
  instancing: "many",
  variants: 3,
  choices: { form: ["floor", "hanging"], size: { range: [0.9, 1.3] }, inside: ["none", "bones", "skull"] },
  look: { roles: roles("metal", "bone", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const R = num(v["size"]) * 0.45, hang = str(v["form"]) === "hanging";
    const y0 = hang ? 0.7 : 0, H = num(v["size"]) * 1.5;
    const solids: DesignSolid[] = [];
    solids.push(solid.cylinder("dark", [0, y0, 0], R, 0.06, { name: "floor", sides: 8 }));
    solids.push(solid.cylinder("metal", [0, y0 + H - 0.04, 0], R + 0.02, 0.05, { name: "ring", collide: false, sides: 8 }));
    solids.push(solid.cone("metal", [0, y0 + H, 0], R * 0.9, R * 0.7, 0.05, { name: "dome", collide: false, sides: 8 }));
    const bars = 10;
    for (let i = 0; i < bars; i += 1) { const a = (i / bars) * Math.PI * 2; solids.push(solid.capsule("metal", [dsin(a) * R, y0 + 0.04, dcos(a) * R], [dsin(a) * R, y0 + H - 0.02, dcos(a) * R], 0.022, { name: "bar", collide: false })); }
    if (hang) chain(solids, [0, y0 + H + R * 0.7, 0], [0, 3.3, 0], 10, 0.05);
    const inside = str(v["inside"]);
    if (inside !== "none") skull(solids, [J.between(-0.1, 0.1), y0 + 0.05, J.between(-0.1, 0.1)], 0.2, J.between(-0.8, 0.8));
    if (inside === "bones") { bone(solids, [-R * 0.5, y0 + 0.08, 0], [R * 0.4, y0 + 0.1, R * 0.3], 0.024); bone(solids, [-R * 0.3, y0 + 0.08, -R * 0.5], [R * 0.2, y0 + 0.08, R * 0.1], 0.02); }
    return { solids, front: null };
  },
});
