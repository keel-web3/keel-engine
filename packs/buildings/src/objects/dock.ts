// A dock (a pier): planks on posts running out over water from the shore at
// +z (endA, on the ground) to its end at -z, the deck `height` over the
// water; bollards to moor to (sockets), a ladder down at the end or not.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid, SocketSpec } from "@keel-engine/object";
import { bool, num, post, roles } from "../kit.ts";

export default defineStyledObject({
  id: "dock",
  title: "Dock",
  tags: ["dock", "pier", "water", "coast"],
  tier: "main",
  instancing: "few",
  variants: 4,
  choices: { length: { range: [3, 14] }, width: { range: [1.5, 4] }, depth: { range: [1, 3] }, ladder: [true, false] },
  look: { roles: roles("plank", "wood", "rope", "metal"), profiles: ["village", "nordic", "desert", "scifi"] },
  sway: null,
  design(J, v) {
    const L = num(v["length"]), W = num(v["width"]), D = num(v["depth"]);
    const solids: DesignSolid[] = [];
    const n = Math.max(4, Math.min(40, Math.round(L / 0.36)));
    for (let i = 0; i < n; i += 1) solids.push(solid.box("plank", [J.between(-0.02, 0.02), -0.05, L / 2 - (L * (i + 0.5)) / n], [W / 2, 0.05, (L / n / 2) * 0.88], 0, { name: "deck", collide: false }));
    const m = Math.max(1, Math.round(L / 2));
    for (let i = 0; i <= m; i += 1) for (const s of [-1, 1]) {
      const z = L / 2 - 0.2 - ((L - 0.4) * i) / m;
      solids.push(post("wood", s * (W / 2 - 0.1), z, -D, i === 0 ? -0.1 : 0.3, 0.1, { name: "pile" }));
    }
    for (const s of [-1, 1]) solids.push(solid.box("wood", [s * (W / 2 - 0.1), -0.18, 0], [0.08, 0.08, L / 2], 0, { name: "stringer", collide: false }));
    const sockets: Record<string, SocketSpec> = {
      endA: { kind: "anchor", pos: [0, 0, L / 2], yaw: 0, extent: [W / 2, 0], meta: { end: "A" } },
      end: { kind: "anchor", pos: [0, 0, -L / 2], yaw: Math.PI },
    };
    for (const s of [-1, 1]) {
      const z = -L / 2 + 0.4;
      solids.push(solid.cylinder("metal", [s * (W / 2 - 0.25), 0, z], 0.12, 0.35, { name: "bollard" }));
      sockets[s < 0 ? "moorLeft" : "moorRight"] = { kind: "anchor", pos: [s * (W / 2 - 0.25), 0.3, z], yaw: s * Math.PI / 2 };
    }
    if (bool(v["ladder"])) for (let k = 0; k < 4; k += 1) solids.push(solid.box("metal", [0, -0.3 - k * 0.3, -L / 2 - 0.06], [0.25, 0.02, 0.03], 0, { name: "ladder", collide: false }));
    return {
      solids, front: "+z", rest: "hang", voxel: { unit: Math.max(0.1, Math.min(0.25, W / 10)) },
      colliders: [{ c: [0, -0.05, 0], h: [W / 2, 0.05, L / 2], yaw: 0, mat: "plank", part: "deck" }],
      sockets,
      meta: { span: { length: L, width: W } },
    };
  },
});
