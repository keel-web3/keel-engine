// Candles: an iron stand with three or five candles on its arms, a cluster
// of candles melted onto the floor, or a gilt wall candelabrum. Each
// candle's flame is in meta.flames (small lights).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { ACTS, candle, num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "candelabra",
  title: "Candles",
  tags: ["candles", "light", "light:candle"],
  tier: "foreground",
  instancing: "many",
  variants: 6,
  choices: { form: ["stand", "cluster", "cluster"], count: [3, 5] },
  look: { roles: roles("metal", "gold", "wax", "glow", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const form = str(v["form"]), n = num(v["count"]);
    const solids: DesignSolid[] = [];
    const flames: Vec3[] = [];
    if (form === "stand") {
      solids.push(solid.cone("metal", [0, 0, 0], 0.22, 0.12, 0.04, { name: "foot", sides: 8 }));
      solids.push(solid.capsule("metal", [0, 0.1, 0], [0, 1.35, 0], 0.028, { name: "pole" }));
      for (let i = 0; i < n; i += 1) {
        const off = n === 3 ? (i - 1) * 0.22 : (i - 2) * 0.13;
        const y = 1.35 + (Math.abs(off) < 0.01 ? 0.12 : 0);
        if (Math.abs(off) > 0.01) solids.push(solid.capsule("metal", [0, 1.22, 0], [off, y, 0], 0.018, { name: "arm", collide: false }));
        solids.push(solid.cylinder("gold", [off, y - 0.02, 0], 0.045, 0.03, { name: "cup", collide: false, sides: 8 }));
        flames.push(candle(solids, [off, y, 0], 0.16, 0.03));
      }
    } else {
      solids.push(solid.ball("wax", [0, 0.012, 0], [0.26, 0.012, 0.2], { name: "drips", collide: false }));
      for (let i = 0; i < n + 2; i += 1) {
        const a = J.between(0, 6.28), d = J.between(0, 0.2);
        flames.push(candle(solids, [dsin(a) * d, 0, dcos(a) * d], J.between(0.08, 0.3), J.between(0.03, 0.045)));
      }
      solids.push(solid.box("dark", [0.1, 0.005, 0.12], [0.05, 0.005, 0.04], 0, { name: "soot", collide: false }));
    }
    return { solids, front: null, meta: { flames, light: "candle" } };
  },
});
