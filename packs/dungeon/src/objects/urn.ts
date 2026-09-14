// An urn: a round pot, a tall amphora with handles, a squat jar, or one
// broken open; painted bands, a lid or an open mouth. Destructible.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, bool, num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "urn",
  title: "Urn",
  tags: ["urn", "pottery", "destructible", "block"],
  tier: "foreground",
  instancing: "many",
  variants: 4,
  choices: { height: { range: [0.45, 0.95] }, form: ["round", "amphora", "jar", "broken"], lid: [true, false] },
  look: { roles: roles("stone", "gold", "accent", "dark"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const H = num(v["height"]), form = str(v["form"]);
    const solids: DesignSolid[] = [];
    const r = H * (form === "jar" ? 0.42 : form === "amphora" ? 0.3 : 0.36);
    if (form === "broken") {
      solids.push(solid.ball("stone", [0, H * 0.22, 0], [r, H * 0.22, r], { name: "belly" }));
      solids.push(solid.cylinder("dark", [0, H * 0.4, 0], r * 0.7, 0.02, { name: "inside", collide: false, sides: 8 }));
      for (let i = 0; i < 4; i += 1) { const a = J.between(0, 6.28); solids.push(solid.box("stone", [dsin(a) * r * 1.6, 0.03, dcos(a) * r * 1.6], [r * 0.3, 0.03, r * 0.22], a, { name: "shard", collide: false })); }
      return { solids, front: null };
    }
    solids.push(solid.cylinder("stone", [0, 0, 0], r * 0.5, H * 0.08, { name: "foot", sides: 8 }));
    solids.push(solid.ball("stone", [0, H * 0.42, 0], [r, H * 0.36, r], { name: "belly" }));
    solids.push(solid.cylinder("stone", [0, H * 0.72, 0], r * 0.42, H * 0.22, { name: "neck", sides: 8 }));
    solids.push(solid.cylinder("stone", [0, H * 0.92, 0], r * 0.55, H * 0.06, { name: "lip", sides: 8 }));
    solids.push(band("gold", H * 0.46, r * 1.0));
    solids.push(band("accent", H * 0.3, r * 0.93, 0.04));
    if (form === "amphora") for (const s of [-1, 1]) solids.push(solid.capsule("stone", [s * r * 0.45, H * 0.88, 0], [s * r * 0.95, H * 0.6, 0], 0.03, { name: "handle", collide: false }));
    if (bool(v["lid"])) { solids.push(solid.ball("stone", [0, H * 0.98, 0], [r * 0.5, H * 0.06, r * 0.5], { name: "lid", collide: false })); solids.push(solid.ball("gold", [0, H * 1.04, 0], 0.03, { name: "knob", collide: false })); }
    else solids.push(solid.cylinder("dark", [0, H * 0.97, 0], r * 0.38, 0.015, { name: "mouth", collide: false, sides: 8 }));
    return { solids, front: null };
  },
});

function band(role: string, y: number, r: number, h = 0.05): DesignSolid { return solid.cylinder(role, [0, y, 0], r, h, { name: "band", collide: false, sides: 8 }); }
