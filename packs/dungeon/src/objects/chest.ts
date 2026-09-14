// A chest: wooden (or iron-clad) with bands, a lock and a rounded lid --
// closed, or OPEN (the lid thrown back, coin and a glint inside). Openable:
// a game swaps the closed shape for the open one (pin state: "open").
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "chest",
  title: "Chest",
  tags: ["chest", "treasure", "openable", "block"],
  tier: "main",
  instancing: "many",
  variants: 2,
  choices: { size: ["small", "large"], state: ["closed", "open"], build: ["wood", "iron"] },
  look: { roles: roles("wood", "metal", "gold", "glow", "dark"), profiles: [...ACTS] },
  sway: null,
  design(_J, v) {
    const big = str(v["size"]) === "large", open = str(v["state"]) === "open", iron = str(v["build"]) === "iron";
    const hw = big ? 0.55 : 0.4, hd = big ? 0.36 : 0.28, h = big ? 0.5 : 0.38;
    const body = iron ? "metal" : "wood", straps = iron ? "gold" : "metal";
    const solids: DesignSolid[] = [];
    solids.push(solid.box(body, [0, h / 2, 0], [hw, h / 2, hd], 0, { name: "body" }));
    for (const x of [-hw * 0.6, hw * 0.6]) solids.push(solid.box(straps, [x, h / 2, 0], [0.04, h / 2 + 0.005, hd + 0.01], 0, { name: "strap", collide: false }));
    solids.push(solid.box(straps, [0, h * 0.2, 0], [hw + 0.01, 0.025, hd + 0.01], 0, { name: "rim", collide: false }));
    if (!open) {
      solids.push(solid.capsule(body, [-hw, h, 0], [hw, h, 0], hd, { name: "lid" }));
      for (const x of [-hw * 0.6, hw * 0.6]) solids.push(solid.capsule(straps, [x - 0.04, h, 0], [x + 0.04, h, 0], hd + 0.012, { name: "strap", collide: false }));
      solids.push(solid.box("gold", [0, h - 0.02, hd + 0.02], [0.06, 0.07, 0.025], 0, { name: "lock", collide: false }));
      solids.push(solid.box("dark", [0, h - 0.04, hd + 0.045], [0.015, 0.025, 0.006], 0, { name: "keyhole", collide: false }));
    } else {
      // (The lid thrown back: stood up behind, its inside showing.)
      solids.push(solid.box(body, [0, h + hd * 0.9, -hd - 0.04], [hw, hd * 0.9, 0.05], 0, { name: "lid" }));
      solids.push(solid.box("dark", [0, h - 0.02, 0], [hw - 0.05, 0.02, hd - 0.05], 0, { name: "inside", collide: false }));
      for (let i = 0; i < 7; i += 1) solids.push(solid.ball("gold", [(i / 6 - 0.5) * hw * 1.4, h + 0.02 + (i % 2) * 0.03, ((i * 37) % 5 / 4 - 0.5) * hd], [0.06, 0.035, 0.06], { name: "coin", collide: false }));
      solids.push(solid.ball("glow", [0.05, h + 0.06, 0], [0.05, 0.05, 0.05], { name: "gem", collide: false }));
    }
    return { solids, front: "+z" };
  },
});
