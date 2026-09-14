// A ramp: one wedge you walk up -- physics' and the renderer's own ramp
// solid, not a stair of slabs -- rising from its foot at +z to its top at
// -z; curbs along its sides, or handrails, or neither.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { num, post, rail, roles, str } from "../kit.ts";
import { datan2 } from "@keel-engine/core";

export default defineStyledObject({
  id: "ramp",
  title: "Ramp",
  tags: ["ramp", "level", "floor", "wedge"],
  tier: "main",
  instancing: "many",
  variants: 1,
  choices: { width: { range: [1.2, 6] }, length: { range: [2, 10] }, height: { range: [0.3, 3] }, sides: ["none", "curbs", "rails"], build: ["stone", "plank", "metal"] },
  look: { roles: roles("stone", "plank", "metal", "trim", "wood"), profiles: ["village", "stone", "scifi", "machine"] },
  sway: null,
  design(_J, v) {
    const W = num(v["width"]), L = num(v["length"]), H = num(v["height"]), sides = str(v["sides"]), role = str(v["build"]);
    const solids: DesignSolid[] = [solid.wedge(role, [0, H / 2, 0], [W / 2, H / 2, L / 2], 0, 0, { name: "slope" })];
    if (sides === "curbs") for (const s of [-1, 1]) solids.push(solid.wedge("trim", [s * (W / 2 + 0.1), (H + 0.15) / 2, 0], [0.1, (H + 0.15) / 2, L / 2], 0, 0.15 / (H + 0.15), { name: "curb", collide: false }));
    if (sides === "rails") for (const s of [-1, 1]) {
      const at = (t: number): Vec3 => [s * (W / 2 - 0.05), H * t + 0.95, L / 2 - L * t];
      for (const t of [0.05, 0.5, 0.95]) { const p = at(t); solids.push(post("metal", p[0], p[2], H * t, p[1], 0.04)); }
      solids.push(rail("metal", at(0.05), at(0.95), 0.04, "handrail"));
    }
    return {
      // (Voxels a sixth of its rise: a shallow ramp stays a ramp, not a slab.)
      solids, front: "+z", voxel: { unit: Math.max(0.05, Math.min(0.25, H / 6)) },
      sockets: { foot: { kind: "anchor", pos: [0, 0, L / 2], yaw: Math.PI, extent: [W / 2, 0] }, top: { kind: "anchor", pos: [0, H, -L / 2], yaw: Math.PI, extent: [W / 2, 0] } },
      meta: { slope: { rise: H, run: L, degrees: (datan2(H, L) * 180) / Math.PI } },
    };
  },
});
