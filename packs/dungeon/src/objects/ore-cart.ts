// An ore cart: a wooden tub on an iron frame and four wheels, heaped with ore
// -- plain rock, or the glowing kind a forge feeds on.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "ore-cart",
  title: "Ore cart",
  tags: ["cart", "mine", "forge", "block", "destructible"],
  tier: "foreground",
  instancing: "many",
  variants: 4,
  choices: { load: ["ore", "glowing", "empty"] },
  look: { roles: roles("wood", "metal", "stone", "glow", "dark"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const solids: DesignSolid[] = [];
    const hw = 0.42, hd = 0.62, y0 = 0.28, h = 0.42;
    for (const x of [-1, 1]) for (const z of [-1, 1]) solids.push(solid.ball("metal", [x * (hw + 0.04), 0.16, z * hd * 0.62], [0.05, 0.16, 0.16], { name: "wheel", collide: false }));
    solids.push(solid.box("metal", [0, y0 - 0.04, 0], [hw * 0.8, 0.04, hd * 0.9], 0, { name: "frame" }));
    solids.push(solid.box("wood", [0, y0 + h / 2, 0], [hw, h / 2, hd], 0, { name: "tub" }));
    for (const z of [-0.5, 0.5]) solids.push(solid.box("metal", [0, y0 + h / 2, z * hd * 1.6], [hw + 0.012, h / 2 + 0.01, 0.03], 0, { name: "band", collide: false }));
    solids.push(solid.box("dark", [0, y0 + h - 0.01, 0], [hw - 0.05, 0.01, hd - 0.05], 0, { name: "inside", collide: false }));
    const load = str(v["load"]);
    if (load !== "empty") for (let i = 0; i < 6; i += 1) solids.push(solid.ball(load === "glowing" && i % 2 === 0 ? "glow" : "stone", [J.between(-0.25, 0.25), y0 + h + 0.05, J.between(-0.4, 0.4)], [0.12, 0.09, 0.11], { name: "ore", collide: false }));
    return { solids, front: "+z" };
  },
});
