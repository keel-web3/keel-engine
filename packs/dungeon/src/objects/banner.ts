// A banner hung on a wall: a pole across the top, a long cloth (flat,
// swallow-tailed or pointed at the foot), a device on it -- a disc, a bar,
// a skull. Its back is the wall (z = 0).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles, skull, str } from "../kit.ts";

export default defineStyledObject({
  id: "banner",
  title: "Banner",
  tags: ["banner", "wall", "cloth"],
  tier: "background",
  instancing: "many",
  variants: 4,
  choices: { width: { range: [0.6, 1] }, length: { range: [1.2, 1.9] }, tail: ["flat", "notched", "pointed"], device: ["none", "disc", "bar", "skull"] },
  look: { roles: roles("cloth", "gold", "wood", "accent", "bone", "dark"), profiles: [...ACTS] },
  sway: null,
  design(_J, v) {
    const w = num(v["width"]), L = num(v["length"]), tail = str(v["tail"]), device = str(v["device"]);
    const solids: DesignSolid[] = [];
    const top = 2.6, z = 0.06;
    solids.push(solid.capsule("wood", [-w / 2 - 0.1, top, z + 0.02], [w / 2 + 0.1, top, z + 0.02], 0.03, { name: "pole", collide: false }));
    for (const s of [-1, 1]) solids.push(solid.ball("gold", [s * (w / 2 + 0.12), top, z + 0.02], 0.045, { name: "finial", collide: false }));
    const body = tail === "flat" ? L : L * 0.82;
    solids.push(solid.box("cloth", [0, top - body / 2, z], [w / 2, body / 2, 0.015], 0, { name: "cloth", collide: false }));
    // (A gold hem along the top.)
    solids.push(solid.box("gold", [0, top - 0.06, z + 0.012], [w / 2, 0.035, 0.012], 0, { name: "hem", collide: false }));
    const foot = top - body;
    if (tail === "notched") for (const s of [-1, 1]) solids.push(solid.box("cloth", [s * w / 4, foot - L * 0.09, z], [w / 4 * 0.9, L * 0.09, 0.015], 0, { name: "tail", collide: false }));
    if (tail === "pointed") for (let k = 0; k < 4; k += 1) { const hw = (w / 2) * (1 - (k + 1) / 5); solids.push(solid.box("cloth", [0, foot - (k + 0.5) * (L * 0.045), z], [hw, L * 0.0225, 0.015], 0, { name: "tail", collide: false })); }
    const cy = top - body * 0.45;
    if (device === "disc") { solids.push(solid.ball("accent", [0, cy, z + 0.02], [w * 0.22, w * 0.22, 0.02], { name: "device", collide: false })); solids.push(solid.ball("gold", [0, cy, z + 0.03], [w * 0.1, w * 0.1, 0.015], { name: "device", collide: false })); }
    if (device === "bar") { solids.push(solid.box("accent", [0, cy, z + 0.02], [w * 0.36, 0.06, 0.012], 0, { name: "device", collide: false })); solids.push(solid.box("accent", [0, cy, z + 0.02], [0.06, body * 0.3, 0.012], 0, { name: "device", collide: false })); }
    if (device === "skull") { skull(solids, [0, cy - 0.12, z + 0.02], w * 0.34, 0); solids.push(solid.box("dark", [0, cy - 0.2, z + 0.005], [w * 0.2, w * 0.2, 0.01], 0, { name: "field", collide: false })); }
    return { solids, front: "+z" };
  },
});
