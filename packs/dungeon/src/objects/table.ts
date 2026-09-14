// A table: long, square or round, on legs, with what's on it -- books and a
// candle (a scholar's), a feast gone cold, an alchemist's bottles, or nothing;
// a stool or two drawn up.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { ACTS, candle, num, roles, skull, str } from "../kit.ts";

export default defineStyledObject({
  id: "table",
  title: "Table",
  tags: ["table", "furniture", "block", "light:candle"],
  tier: "foreground",
  instancing: "many",
  variants: 6,
  choices: { form: ["long", "square", "round"], clutter: ["books", "feast", "alchemy", "none", "candles"], stools: [0, 1, 2] },
  look: { roles: roles("wood", "paper", "leather", "gold", "accent", "wax", "glow", "bone", "metal", "dark"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const form = str(v["form"]), clutter = str(v["clutter"]);
    const solids: DesignSolid[] = [];
    const flames: Vec3[] = [];
    const top = 0.78;
    const hw = form === "long" ? 0.95 : 0.55, hd = form === "long" ? 0.45 : 0.55;
    if (form === "round") {
      solids.push(solid.cylinder("wood", [0, top - 0.06, 0], 0.6, 0.06, { name: "top", sides: 8 }));
      solids.push(solid.cylinder("wood", [0, 0, 0], 0.09, top - 0.06, { name: "leg", sides: 8 }));
      solids.push(solid.cylinder("wood", [0, 0, 0], 0.3, 0.05, { name: "foot", sides: 8 }));
    } else {
      solids.push(solid.box("wood", [0, top - 0.05, 0], [hw, 0.05, hd], 0, { name: "top" }));
      solids.push(solid.box("dark", [0, top - 0.12, 0], [hw - 0.06, 0.02, hd - 0.06], 0, { name: "apron", collide: false }));
      for (const x of [-1, 1]) for (const z of [-1, 1]) solids.push(solid.box("wood", [x * (hw - 0.09), (top - 0.1) / 2, z * (hd - 0.09)], [0.065, (top - 0.1) / 2, 0.065], 0, { name: "leg" }));
      solids.push(solid.box("wood", [0, 0.2, 0], [hw - 0.09, 0.035, 0.035], 0, { name: "stretcher", collide: false }));
    }
    const on = (x: number, z: number): Vec3 => [x * hw * 0.7, top, z * hd * 0.6];
    if (clutter === "books") {
      for (let i = 0; i < 3; i += 1) { const p = on(J.between(-1, 0), J.between(-1, 1)); solids.push(solid.box(i % 2 ? "leather" : "accent", [p[0], top + 0.03 + i * 0.05, p[2]], [0.13, 0.025, 0.1], J.between(-0.4, 0.4), { name: "book", collide: false })); }
      solids.push(solid.box("paper", [hw * 0.3, top + 0.006, 0], [0.16, 0.006, 0.12], J.between(-0.3, 0.3), { name: "page", collide: false }));
      flames.push(candle(solids, on(0.8, 0.3), 0.2, 0.035));
    }
    if (clutter === "feast") {
      for (let i = 0; i < 3; i += 1) { const p = on(-0.7 + i * 0.7, J.between(-0.4, 0.4)); solids.push(solid.cylinder("metal", p, 0.13, 0.02, { name: "plate", collide: false, sides: 8 })); solids.push(solid.ball(i === 1 ? "bone" : "leather", [p[0], top + 0.06, p[2]], [0.08, 0.05, 0.07], { name: "food", collide: false })); }
      for (const s of [-1, 1]) solids.push(solid.cylinder("gold", on(s * 0.4, 0.8), 0.035, 0.14, { name: "goblet", collide: false, sides: 8 }));
      if (form === "long") skull(solids, on(0.95, -0.5), 0.15, 0.5);
    }
    if (clutter === "alchemy") {
      for (let i = 0; i < 5; i += 1) { const p = on(J.between(-1, 1), J.between(-1, 1)); const h = J.between(0.12, 0.26); solids.push(solid.cylinder("accent", p, J.between(0.035, 0.06), h, { name: "bottle", collide: false, sides: 8 })); solids.push(solid.ball("glow", [p[0], top + h * 0.45, p[2]], 0.035, { name: "brew", collide: false })); }
      solids.push(solid.ball("bone", [hw * 0.5, top + 0.08, -hd * 0.3], 0.08, { name: "skull", collide: false }));
    }
    if (clutter === "candles") for (let i = 0; i < 3; i += 1) flames.push(candle(solids, on(-0.6 + i * 0.6, J.between(-0.5, 0.5)), J.between(0.1, 0.24), 0.035));
    if (clutter === "none") solids.push(solid.box("dark", [0, top + 0.004, 0], [hw * 0.5, 0.004, hd * 0.4], 0, { name: "stain", collide: false }));
    const n = num(v["stools"]);
    for (let i = 0; i < n; i += 1) { const s = i ? -1 : 1; solids.push(solid.cylinder("wood", [s * (hw * 0.5), 0, hd + 0.35], 0.18, 0.44, { name: "stool", sides: 8 })); }
    return { solids, front: null, meta: { flames } };
  },
});
