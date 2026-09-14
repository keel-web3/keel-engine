// A rock, from a pebble pile to a boulder: round, flat (a slab), jagged
// (turned blocks jutting) or a balanced stack; moss on top, in patches or not;
// a crystal vein breaking its surface now and then.
// Its top is a place to stand things (an auto socket where it's flat).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "rock",
  title: "Rock",
  tags: ["rock", "boulder", "stone"],
  tier: "background",
  instancing: "many",
  variants: 8,
  choices: { size: { range: [0.4, 3] }, form: ["round", "flat", "jagged", "stack"], moss: ["none", "top", "patchy"], vein: [false, false, true] },
  look: { roles: roles("stone", "moss", "crystal"), profiles: ["summer", "winter", "desert", "ash", "alien", "ice"] },
  sway: null,
  design(J, v) {
    const s = num(v["size"]);
    const form = str(v["form"]);
    const solids: DesignSolid[] = [];
    let topY = s * 0.6;
    if (form === "round") {
      solids.push(solid.ball("stone", [0, s * 0.42, 0], [s * 0.55, s * 0.42, s * 0.48], { name: "rock" }));
      solids.push(solid.ball("stone", [s * 0.28, s * 0.24, s * 0.12], [s * 0.3, s * 0.24, s * 0.3], { name: "rock" }));
      topY = s * 0.84;
    } else if (form === "flat") {
      solids.push(solid.box("stone", [0, s * 0.14, 0], [s * 0.6, s * 0.14, s * 0.45], J.between(0, 1.5), { name: "slab" }));
      solids.push(solid.box("stone", [s * 0.1, s * 0.3, -s * 0.05], [s * 0.42, s * 0.05, s * 0.32], J.between(0, 1.5), { name: "slab" }));
      topY = s * 0.35;
    } else if (form === "jagged") {
      const n = 4;
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2 + J.between(-0.4, 0.4);
        const h = s * J.between(0.25, 0.6);
        solids.push(solid.box("stone", [dsin(a) * s * 0.22, h / 2, dcos(a) * s * 0.22], [s * J.between(0.18, 0.3), h / 2, s * J.between(0.14, 0.24)], J.between(0, Math.PI), { name: "shard" }));
        solids.push(solid.cone("stone", [dsin(a) * s * 0.22, h, dcos(a) * s * 0.22], s * 0.16, s * 0.2, 0, { name: "shard", collide: false, sides: 4 }));
      }
      solids.push(solid.ball("stone", [0, s * 0.22, 0], [s * 0.42, s * 0.22, s * 0.38], { name: "rock" }));
      topY = s * 0.5;
    } else {
      let y = 0;
      for (let i = 0; i < 3; i += 1) {
        const k = 1 - i * 0.25;
        const h = s * 0.18 * k;
        solids.push(solid.ball("stone", [J.between(-0.05, 0.05) * s, y + h, J.between(-0.05, 0.05) * s], [s * 0.34 * k, h, s * 0.3 * k], { name: "stone" }));
        y += h * 1.85;
      }
      topY = y;
    }
    const moss = str(v["moss"]);
    if (moss === "top") solids.push(solid.ball("moss", [0, topY * 0.92, 0], [s * 0.36, s * 0.07, s * 0.32], { name: "moss", collide: false }));
    if (moss === "patchy") for (let i = 0; i < 3; i += 1) {
      const a = J.between(0, Math.PI * 2);
      solids.push(solid.ball("moss", [dsin(a) * s * 0.3, topY * J.between(0.4, 0.8), dcos(a) * s * 0.3], [s * 0.14, s * 0.06, s * 0.14], { name: "moss", collide: false }));
    }
    // (A crystal vein breaking the surface: an advanced resource's tell.)
    if (v["vein"] === true) for (let i = 0; i < 3; i += 1) {
      const a = 0.6 + i * 0.5;
      solids.push(solid.cone("crystal", [dsin(a) * s * 0.3, topY * 0.35, dcos(a) * s * 0.3], s * 0.07, s * (0.25 + i * 0.08), 0, { name: "vein", collide: false, sides: 4, steps: 3 }));
    }
    return { solids, front: null };
  },
});
