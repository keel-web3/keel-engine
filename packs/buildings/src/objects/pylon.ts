// A pylon (sci-fi / gravitic): a slim tapering mast of stacked blocks on a
// broad foot, fins, an energy core on top -- a crystal or an orb -- and a
// ring (or two) floating round it. The RTS's power node and ward tower.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "pylon",
  title: "Pylon",
  tags: ["building", "scifi", "gravitic", "rts", "tower", "power"],
  tier: "main",
  instancing: "few",
  variants: 4,
  choices: { height: { range: [5, 10] }, base: { range: [1.6, 3] }, core: ["crystal", "orb"], rings: [1, 2, 0], fins: [3, 4] },
  look: { roles: roles("wall", "metal", "glow", "trim", "stone"), profiles: ["scifi", "machine", "biotic"] },
  sway: null,
  design(_J, v) {
    const H = num(v["height"]);
    const B = num(v["base"]);
    const solids: DesignSolid[] = [];
    solids.push(solid.box("stone", [0, 0.2, 0], [B * 0.75, 0.2, B * 0.75], 0, { name: "plinth" }));
    const steps = 5;
    let y = 0.4;
    const mastH = H * 0.72;
    for (let i = 0; i < steps; i += 1) {
      const k = 1 - i / steps;
      const h = mastH / steps;
      const r = B * (0.18 + 0.32 * k);
      solids.push(solid.box(i % 2 ? "metal" : "wall", [0, y + h / 2, 0], [r, h / 2, r], (i * Math.PI) / 16, { name: "mast" }));
      y += h;
    }
    const fins = num(v["fins"]);
    for (let i = 0; i < fins; i += 1) {
      const a = (i / fins) * Math.PI * 2;
      solids.push(solid.wedge("trim", [dsin(a) * B * 0.55, H * 0.2, dcos(a) * B * 0.55], [0.08, H * 0.2 - 0.02, B * 0.3], a, 0.1, { name: "fin", collide: false }));
    }
    const coreY = y + H * 0.1;
    if (str(v["core"]) === "crystal") {
      // (An octahedron: a cone standing on its point under one standing on its base.)
      solids.push(solid.cone("glow", [0, coreY - H * 0.1, 0], 0.03, H * 0.1, B * 0.3, { name: "core", collide: false, sides: 4 }));
      solids.push(solid.cone("glow", [0, coreY, 0], B * 0.3, H * 0.14, 0, { name: "core", collide: false, sides: 4 }));
    } else solids.push(solid.ball("glow", [0, coreY, 0], B * 0.34, { name: "core", collide: false }));
    // (Rings: eight capsules round the core, floating -- the gravitic flavour's halo.)
    const rings = num(v["rings"]);
    for (let k = 0; k < rings; k += 1) {
      const R = B * (0.62 + k * 0.28);
      const ry = coreY - H * 0.02 + k * H * 0.08;
      const n = 10;
      for (let i = 0; i < n; i += 1) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        solids.push(solid.capsule("metal", [dsin(a0) * R, ry, dcos(a0) * R], [dsin(a1) * R, ry, dcos(a1) * R], 0.07 + B * 0.02, { name: "ring", group: `ring${k}`, collide: false }));
      }
    }
    return {
      solids, front: "+z",
      sockets: { core: { kind: "anchor", pos: [0, coreY, 0] }, entrance: { kind: "spawn", pos: [0, 0, B + 0.8], yaw: 0 } },
      tags: ["building", "scifi"],
      meta: { building: { footprint: { kind: "rect", wings: [{ x: 0, z: 0, w: B * 1.5, d: B * 1.5 }] }, floors: 0, height: coreY + H * 0.14, walkable: false, entrances: [] } },
    };
  },
});
