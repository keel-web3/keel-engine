// A stump: a short cut trunk with its rings on top (a seat, a table, a place
// for an axe), roots gripping the ground, mushrooms at its foot or not.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { bool, num, roles } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "stump",
  title: "Stump",
  tags: ["stump", "wood", "forest"],
  tier: "background",
  instancing: "many",
  variants: 6,
  choices: { height: { range: [0.3, 1] }, radius: { range: [0.25, 0.6] }, roots: [3, 4, 5], mushrooms: [false, true], moss: [true, false] },
  look: { roles: roles("bark", "wood", "cap", "stem", "moss"), profiles: ["summer", "autumn", "winter", "fungal"] },
  sway: null,
  design(J, v) {
    const H = num(v["height"]);
    const r = num(v["radius"]);
    const solids: DesignSolid[] = [solid.cylinder("bark", [0, 0, 0], r, H * 0.96, { name: "stump" }), solid.cylinder("wood", [0, H * 0.96, 0], r * 0.9, H * 0.04, { name: "rings", collide: false })];
    const n = num(v["roots"]);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + J.between(-0.3, 0.3);
      solids.push(solid.capsule("bark", [dsin(a) * r * 0.7, H * 0.35, dcos(a) * r * 0.7], [dsin(a) * r * 1.6, r * 0.2, dcos(a) * r * 1.6], r * 0.2, { name: "root", collide: false }));
    }
    if (bool(v["mushrooms"])) for (let i = 0; i < 3; i += 1) {
      const a = J.between(0, Math.PI * 2);
      const p: [number, number, number] = [dsin(a) * r * 1.2, 0, dcos(a) * r * 1.2];
      const h = r * J.between(0.3, 0.55);
      solids.push(solid.capsule("stem", [p[0], r * 0.05, p[2]], [p[0], h, p[2]], r * 0.05, { name: "mushroom", collide: false }));
      solids.push(solid.ball("cap", [p[0], h, p[2]], [r * 0.16, r * 0.1, r * 0.16], { name: "mushroom", collide: false }));
    }
    if (v["moss"] === true) solids.push(solid.ball("moss", [r * 0.55, H * 0.6, -r * 0.55], [r * 0.5, H * 0.3, r * 0.5], { name: "moss", collide: false }));
    return { solids, front: null, sockets: { seat: { kind: "seat", pos: [0, H, 0], yaw: 0 } } };
  },
});
