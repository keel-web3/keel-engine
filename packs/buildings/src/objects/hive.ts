// A hive (the biotic flavour): swollen organic chambers heaped round a
// central mound, dark openings at their feet (the front one the way in),
// glowing pods, a crown of spines or a spore bulb.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { num, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "hive",
  title: "Hive",
  tags: ["building", "biotic", "alien", "rts"],
  tier: "main",
  instancing: "few",
  variants: 6,
  choices: { size: { range: [4, 9] }, chambers: [3, 4, 5, 6], crown: ["spines", "bulb"], pods: [2, 4, 6] },
  look: { roles: roles("organic", "roof", "glow", "dark", "stone"), profiles: ["biotic", "scifi", "machine"] },
  sway: { amp: 0.015, hz: 0.2, bend: 2, from: 1 },
  design(J, v) {
    const S = num(v["size"]);
    const solids: DesignSolid[] = [];
    solids.push(solid.ball("organic", [0, S * 0.42, 0], [S * 0.38, S * 0.42, S * 0.38], { name: "mound" }));
    const n = num(v["chambers"]);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + J.between(-0.25, 0.25);
      const r = S * J.between(0.17, 0.24);
      const d = S * 0.34;
      solids.push(solid.ball("roof", [Math.sin(a) * d, r * 0.95, Math.cos(a) * d], [r, r * 0.95, r], { name: "chamber" }));
      solids.push(solid.ball("dark", [Math.sin(a) * (d + r * 0.72), r * 0.45, Math.cos(a) * (d + r * 0.72)], [r * 0.38, r * 0.34, r * 0.38], { name: "opening", collide: false }));
    }
    // The way in: the biggest opening, on the front.
    solids.push(solid.ball("organic", [0, S * 0.18, S * 0.36], [S * 0.2, S * 0.18, S * 0.14], { name: "lip" }));
    solids.push(solid.ball("dark", [0, S * 0.13, S * 0.46], [S * 0.12, S * 0.12, S * 0.06], { name: "door", collide: false }));
    const pods = num(v["pods"]);
    for (let i = 0; i < pods; i += 1) {
      const a = (i / pods) * Math.PI * 2 + 0.4;
      solids.push(solid.ball("glow", [Math.sin(a) * S * 0.3, S * J.between(0.5, 0.7), Math.cos(a) * S * 0.3], S * 0.06, { name: "pod", collide: false }));
    }
    const top = S * 0.74;
    if (str(v["crown"]) === "spines") for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      solids.push(solid.capsule("stone", [Math.sin(a) * S * 0.1, top - S * 0.08, Math.cos(a) * S * 0.1], [Math.sin(a) * S * 0.2, top + S * 0.22, Math.cos(a) * S * 0.2], S * 0.03, { name: "spine", group: "crown", collide: false }));
    }
    else {
      solids.push(solid.capsule("organic", [0, top - S * 0.05, 0], [0, top + S * 0.12, 0], S * 0.05, { name: "stalk", group: "crown", collide: false }));
      solids.push(solid.ball("glow", [0, top + S * 0.18, 0], S * 0.1, { name: "bulb", group: "crown", collide: false }));
    }
    return {
      solids, front: "+z",
      sockets: { door: { kind: "anchor", pos: [0, 0, S * 0.5], yaw: 0 }, entrance: { kind: "spawn", pos: [0, 0, S * 0.5 + 1.2], yaw: 0 } },
      tags: ["building", "biotic"],
      meta: { building: { footprint: { kind: "round", r: S * 0.55 }, floors: 1, height: top + S * 0.3, walkable: false, entrances: ["door"] } },
    };
  },
});
