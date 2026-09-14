// A cobweb: strands radiating from a corner high up, rings of silk across
// them -- in a corner (a quarter fan), a sheet between two walls, or a web
// hanging in the open with its spider. Nothing collides.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { ACTS, num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "cobweb",
  title: "Cobweb",
  tags: ["cobweb", "corner", "decal"],
  tier: "background",
  instancing: "many",
  variants: 6,
  choices: { size: { range: [0.5, 0.9] }, form: ["corner", "corner", "sheet", "hanging"], spider: [false, false, true] },
  look: { roles: roles("web", "dark"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const R = num(v["size"]), form = str(v["form"]);
    const solids: DesignSolid[] = [];
    const apex: Vec3 = form === "hanging" ? [0, 2.2, 0.3] : [0, 2.75, 0.05];
    const a0 = form === "corner" ? -Math.PI * 0.38 : form === "sheet" ? -Math.PI * 0.7 : -Math.PI;
    const a1 = form === "corner" ? Math.PI * 0.38 : form === "sheet" ? Math.PI * 0.7 : Math.PI;
    const spokes = 7;
    // (Spokes: in the plane facing the room, hanging down from the apex.)
    const tip = (a: number, r: number): Vec3 => [apex[0] + dsin(a) * r, apex[1] - dcos(a) * r * 0.9, apex[2] + 0.02];
    const ends: number[] = [];
    for (let i = 0; i < spokes; i += 1) { const a = a0 + ((a1 - a0) * i) / (spokes - 1) + J.between(-0.08, 0.08); ends.push(a); solids.push(solid.capsule("web", apex, tip(a, R * J.between(0.85, 1)), 0.012, { name: "spoke", collide: false })); }
    for (const k of [0.35, 0.6, 0.85]) for (let i = 0; i + 1 < ends.length; i += 1) solids.push(solid.capsule("web", tip(ends[i]!, R * k), tip(ends[i + 1]!, R * k * J.between(0.95, 1.05)), 0.011, { name: "ring", collide: false }));
    if (v["spider"] === true) { const p = tip(ends[3]!, R * 0.6); solids.push(solid.ball("dark", p, [0.05, 0.04, 0.04], { name: "spider", collide: false })); }
    return { solids, front: "+z" };
  },
});
