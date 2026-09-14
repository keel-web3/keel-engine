// A stain on the floor: a pool, a splatter with its droplets, or a dragged
// trail -- blood in a crypt, slime in a cave, molten spill in a forge (the
// act's ichor role). Flat: nothing collides.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "stain",
  title: "Stain",
  tags: ["stain", "blood", "decal"],
  tier: "background",
  instancing: "many",
  variants: 8,
  choices: { size: { range: [0.5, 1.3] }, form: ["pool", "splatter", "trail"] },
  look: { roles: roles("ichor"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const s = num(v["size"]), form = str(v["form"]);
    const solids: DesignSolid[] = [];
    const flat = (x: number, z: number, rx: number, rz: number) => solids.push(solid.ball("ichor", [x, 0.008, z], [rx, 0.008, rz], { name: "stain", collide: false }));
    if (form === "pool") { flat(0, 0, s * 0.45, s * 0.35); for (let i = 0; i < 4; i += 1) { const a = J.between(0, 6.28); flat(Math.sin(a) * s * 0.35, Math.cos(a) * s * 0.3, s * 0.18, s * 0.14); } }
    else if (form === "splatter") { flat(0, 0, s * 0.22, s * 0.2); for (let i = 0; i < 9; i += 1) { const a = J.between(0, 6.28), d = J.between(0.2, 0.6) * s; const r = J.between(0.03, 0.07); flat(Math.sin(a) * d, Math.cos(a) * d, r, r); } }
    else {
      // (A dragged trail: smears that wander side to side, a pool at its start, drops along it.)
      const yaw = J.between(0, 3.14), sx = Math.sin(yaw), cz = Math.cos(yaw);
      flat(-sx * s * 0.7, -cz * s * 0.7, s * 0.24, s * 0.2);
      for (let i = 0; i < 7; i += 1) { const t = (i / 6 - 0.5) * s * 1.4, side = J.between(-0.08, 0.08) * s; flat(sx * t + cz * side, cz * t - sx * side, s * J.between(0.05, 0.11), s * J.between(0.05, 0.1)); }
      for (let i = 0; i < 4; i += 1) { const t = J.between(-0.6, 0.8) * s, side = J.between(-0.25, 0.25) * s; flat(sx * t + cz * side, cz * t - sx * side, 0.03, 0.03); }
    }
    return { solids, front: null };
  },
});
