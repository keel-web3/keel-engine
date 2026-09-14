// A barrel: bellied staves in three courses, two or three iron hoops, a lid,
// an open top (dark inside) or lying on its side. Destructible: a hit
// breaks it (the game's call; the tag says it may).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, band, bool, num, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "barrel",
  title: "Barrel",
  tags: ["barrel", "storage", "destructible", "block"],
  tier: "foreground",
  instancing: "many",
  variants: 4,
  choices: { height: { range: [0.75, 1.1] }, hoops: [2, 3], top: ["lid", "lid", "open"], lying: [false, false, false, true] },
  look: { roles: roles("wood", "metal", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const H = num(v["height"]), r = H * 0.34;
    const solids: DesignSolid[] = [];
    if (bool(v["lying"])) {
      const L = H * 0.5;
      solids.push(solid.capsule("wood", [-L * 0.55, r, 0], [L * 0.55, r, 0], r, { name: "staves" }));
      for (const x of num(v["hoops"]) === 3 ? [-0.6, 0, 0.6] : [-0.55, 0.55]) {
        solids.push(solid.capsule("metal", [x * L - 0.025, r, 0], [x * L + 0.025, r, 0], r * 1.04, { name: "hoop", collide: false }));
      }
      solids.push(solid.ball("dark", [L * 0.55 + r * 0.72, r, 0], [r * 0.12, r * 0.7, r * 0.7], { name: "end", collide: false }));
      return { solids, front: null };
    }
    solids.push(solid.cylinder("wood", [0, 0, 0], r * 0.9, H * 0.2, { name: "staves", sides: 8 }));
    solids.push(solid.cylinder("wood", [0, H * 0.18, 0], r, H * 0.64, { name: "staves", sides: 8 }));
    solids.push(solid.cylinder("wood", [0, H * 0.8, 0], r * 0.9, H * 0.2, { name: "staves", sides: 8 }));
    const ys = num(v["hoops"]) === 3 ? [0.12, 0.5, 0.86] : [0.16, 0.82];
    for (const y of ys) solids.push(band("metal", H * y - 0.025, (y > 0.3 && y < 0.7 ? r : r * 0.91) + 0.018, 0.05));
    if (str(v["top"]) === "open") solids.push(solid.cylinder("dark", [0, H - 0.015, 0], r * 0.78, 0.02, { name: "inside", collide: false, sides: 8 }));
    else solids.push(solid.cylinder("wood", [0, H - 0.01, 0], r * 0.82, 0.03, { name: "lid", collide: false, sides: 8 }));
    void J;
    return { solids, front: null };
  },
});
