// An altar: a stone block on a step with a slab on top (or a pedestal, or a
// sacrificial slab, stained), a cloth runner down its front, candles at its
// corners (their flames in meta.flames).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { ACTS, bool, candle, num, roles, skull, str } from "../kit.ts";

export default defineStyledObject({
  id: "altar",
  title: "Altar",
  tags: ["altar", "shrine", "block", "light:candle"],
  tier: "main",
  instancing: "many",
  variants: 3,
  choices: { form: ["block", "pedestal", "sacrificial"], candles: [0, 2, 4], runner: [true, false], width: { range: [1.2, 1.8] } },
  look: { roles: roles("stone", "cloth", "gold", "wax", "glow", "ichor", "bone", "dark"), profiles: [...ACTS] },
  sway: null,
  design(_J, v) {
    const form = str(v["form"]), W = num(v["width"]);
    const solids: DesignSolid[] = [];
    const flames: Vec3[] = [];
    let top = 0.95, hw = W / 2, hd = 0.45;
    if (form === "pedestal") {
      hw = 0.3; hd = 0.3; top = 1.05;
      solids.push(solid.box("stone", [0, 0.08, 0], [0.4, 0.08, 0.4], 0, { name: "step" }));
      solids.push(solid.cylinder("stone", [0, 0.16, 0], 0.22, 0.8, { name: "column", sides: 8 }));
      solids.push(solid.box("stone", [0, top - 0.05, 0], [hw + 0.05, 0.05, hd + 0.05], 0, { name: "top" }));
    } else {
      solids.push(solid.box("stone", [0, 0.07, 0], [hw + 0.15, 0.07, hd + 0.15], 0, { name: "step" }));
      solids.push(solid.box("stone", [0, 0.5, 0], [hw, 0.36, hd], 0, { name: "block" }));
      solids.push(solid.box("stone", [0, top - 0.05, 0], [hw + 0.06, 0.05, hd + 0.06], 0, { name: "slab" }));
      // (A carved band round the block: a hair proud of it, a gold inlay.)
      solids.push(solid.box("gold", [0, 0.72, hd + 0.005], [hw * 0.8, 0.03, 0.012], 0, { name: "inlay", collide: false }));
    }
    if (bool(v["runner"]) && form !== "sacrificial") {
      solids.push(solid.box("cloth", [0, top + 0.012, 0], [Math.min(0.24, hw * 0.6), 0.012, hd + 0.07], 0, { name: "runner", collide: false }));
      solids.push(solid.box("cloth", [0, top - 0.22, hd + 0.075], [Math.min(0.24, hw * 0.6), 0.23, 0.012], 0, { name: "runner", collide: false }));
    }
    if (form === "sacrificial") {
      solids.push(solid.ball("ichor", [0.1, top + 0.005, 0.05], [hw * 0.5, 0.012, hd * 0.6], { name: "stain", collide: false }));
      solids.push(solid.box("ichor", [hw * 0.3, top - 0.3, hd + 0.01], [0.04, 0.3, 0.01], 0, { name: "drip", collide: false }));
      skull(solids, [-hw * 0.5, top, 0], 0.2, 0.3);
    }
    const n = num(v["candles"]);
    const spots: Array<[number, number]> = n === 4 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : n === 2 ? [[-1, 0], [1, 0]] : [];
    for (const [sx, sz] of spots) flames.push(candle(solids, [sx * (hw - 0.08), top, sz * (hd - 0.08)], 0.16 + (sx + sz + 2) * 0.02, 0.035));
    if (!n) solids.push(solid.box("dark", [0, top + 0.03, 0], [0.08, 0.03, 0.08], 0, { name: "bowl", collide: false }));
    return { solids, front: "+z", meta: { flames } };
  },
});
