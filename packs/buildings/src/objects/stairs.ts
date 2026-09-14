// Stairs: steps you see, a wedge you walk -- each tread a box for the
// picture, one wedge along their nosings for the collider (so a body climbs
// smoothly and the physics has one solid, not twelve). Side walls, handrails
// or open; stone or wood.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { ColliderSpec, DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { num, post, rail, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "stairs",
  title: "Stairs",
  tags: ["stairs", "level", "floor"],
  tier: "main",
  instancing: "many",
  variants: 1,
  choices: { width: { range: [1, 4] }, steps: [4, 6, 8, 10, 12, 16], rise: { range: [0.15, 0.22] }, tread: { range: [0.26, 0.36] }, sides: ["walls", "rails", "open"], build: ["stone", "plank"] },
  look: { roles: roles("stone", "plank", "trim", "wood", "metal"), profiles: ["stone", "village", "scifi", "nordic"] },
  sway: null,
  design(_J, v) {
    const W = num(v["width"]), n = num(v["steps"]), r = num(v["rise"]), t = num(v["tread"]), role = str(v["build"]), sides = str(v["sides"]);
    const L = n * t, H = n * r;
    const solids: DesignSolid[] = [];
    for (let i = 0; i < n; i += 1) {
      const top = r * (i + 1);
      solids.push(solid.box(role, [0, top / 2, L / 2 - t * (i + 0.5)], [W / 2, top / 2, t / 2], 0, { name: "step", collide: false }));
    }
    if (sides === "walls") for (const s of [-1, 1]) solids.push(solid.wedge("trim", [s * (W / 2 + 0.12), (H + 0.4) / 2, 0], [0.12, (H + 0.4) / 2, L / 2], 0, 0.4 / (H + 0.4), { name: "wall" }));
    if (sides === "rails") for (const s of [-1, 1]) {
      const at = (k: number): Vec3 => [s * (W / 2 - 0.05), H * k + 0.9, L / 2 - L * k];
      for (const k of [0.05, 0.5, 0.95]) { const p = at(k); solids.push(post("wood", p[0], p[2], H * k, p[1], 0.04)); }
      solids.push(rail("wood", at(0.05), at(0.95), 0.04, "handrail"));
    }
    // One wedge along the nosings: the walking surface.
    const colliders: ColliderSpec[] = [{ c: [0, H / 2, 0], h: [W / 2, H / 2, L / 2], yaw: 0, mat: role, part: "flight", kind: "wedge", lo: 0 }];
    if (sides === "walls") for (const s of [-1, 1]) colliders.push({ c: [s * (W / 2 + 0.12), (H + 0.4) / 2, 0], h: [0.12, (H + 0.4) / 2, L / 2], yaw: 0, mat: "trim", part: "wall", kind: "wedge", lo: 0.4 / (H + 0.4) });
    return {
      solids, colliders, front: "+z",
      sockets: { foot: { kind: "anchor", pos: [0, 0, L / 2 + 0.2], yaw: Math.PI, extent: [W / 2, 0] }, top: { kind: "anchor", pos: [0, H, -L / 2], yaw: Math.PI, extent: [W / 2, 0] } },
      meta: { flight: { steps: n, rise: r, tread: t, height: H, run: L } },
    };
  },
});
