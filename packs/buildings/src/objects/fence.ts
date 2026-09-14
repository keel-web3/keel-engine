// A fence segment, along x from endA (-x) to endB (+x) like a wall's: a
// picket fence, a post-and-rail, wattle (woven) or a sci-fi wire fence
// (glowing strands); posts at both ends and every ~2 m.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { num, post, rail, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "fence",
  title: "Fence segment",
  tags: ["fence", "segment", "path"],
  tier: "main",
  instancing: "many",
  variants: 2,
  choices: { length: { range: [0.3, 6] }, height: { range: [0.7, 1.6] }, kind: ["picket", "rail", "wattle", "wire"] },
  look: { roles: roles("wood", "trim", "metal", "glow"), profiles: ["village", "nordic", "desert", "scifi", "machine"] },
  sway: null,
  design(_J, v) {
    const L = num(v["length"]), H = num(v["height"]), kind = str(v["kind"]);
    const solids: DesignSolid[] = [];
    const postRole = kind === "wire" ? "metal" : "wood";
    const m = Math.max(1, Math.round(L / 2));
    for (let i = 0; i <= m; i += 1) solids.push(post(postRole, -L / 2 + (L * i) / m, 0, 0, H + 0.08, kind === "wire" ? 0.05 : 0.07, { name: "post" }));
    if (kind === "picket") {
      for (const y of [H * 0.3, H * 0.75]) solids.push(solid.box("wood", [0, y, 0.08], [L / 2, 0.04, 0.02], 0, { name: "rail", collide: false }));
      const n = Math.max(2, Math.round(L / 0.16));
      for (let i = 0; i < n; i += 1) {
        const x = -L / 2 + (L * (i + 0.5)) / n;
        solids.push(solid.box("trim", [x, H * 0.45, 0.11], [0.045, H * 0.45, 0.015], 0, { name: "picket", collide: false }));
        solids.push(solid.cone("trim", [x, H * 0.9, 0.11], 0.06, 0.1, 0, { name: "picket", collide: false, sides: 4, steps: 1 }));
      }
    } else if (kind === "rail") {
      for (const y of [H * 0.35, H * 0.7, H]) solids.push(rail("wood", [-L / 2, y, 0], [L / 2, y, 0], 0.045));
    } else if (kind === "wattle") {
      for (let k = 0; k < 5; k += 1) solids.push(solid.box("wood", [0, H * (0.15 + k * 0.17), (k % 2 ? 0.04 : -0.04)], [L / 2, H * 0.08, 0.05], 0, { name: "weave", collide: false }));
    } else {
      for (const y of [H * 0.3, H * 0.6, H * 0.9]) solids.push(rail("glow", [-L / 2, y, 0], [L / 2, y, 0], 0.018, "wire"));
    }
    return {
      solids, front: "+z",
      voxel: { unit: Math.max(0.05, Math.min(0.12, H / 16)) },
      colliders: [{ c: [0, H / 2, 0], h: [L / 2, H / 2, 0.08], yaw: 0, mat: "wood", part: "fence" }],
      sockets: { endA: { kind: "anchor", pos: [-L / 2, 0, 0], yaw: -Math.PI / 2, meta: { end: "A" } }, endB: { kind: "anchor", pos: [L / 2, 0, 0], yaw: Math.PI / 2, meta: { end: "B" } } },
      meta: { segment: { length: L, height: H, kind } },
    };
  },
});
