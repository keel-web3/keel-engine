// A gate: an opening in a wall or a fence, along x like their segments
// (endA and endB where they join on). A wooden gate (posts, a lintel, two
// leaves standing open), an arch gate (two stone towers, an arch, a
// portcullis half up) or a sci-fi gate (two pylons, a force field). The
// opening itself never collides: `entry` and `exit` are either side of it.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { num, post, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "gate",
  title: "Gate",
  tags: ["gate", "segment", "defence", "path", "entrance"],
  tier: "main",
  instancing: "few",
  variants: 2,
  choices: { width: { range: [2, 6] }, height: { range: [2.2, 6] }, kind: ["wooden", "arch", "scifi"] },
  look: { roles: roles("stone", "wood", "trim", "metal", "glow", "roof", "dark"), profiles: ["stone", "village", "nordic", "desert", "scifi", "machine"] },
  sway: null,
  design(_J, v) {
    const W = num(v["width"]), H = num(v["height"]), kind = str(v["kind"]);
    const solids: DesignSolid[] = [];
    const P = kind === "arch" ? Math.max(1, W * 0.3) : kind === "scifi" ? 0.6 : 0.3;
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + P / 2);
      if (kind === "wooden") {
        solids.push(post("wood", x, 0, 0, H, P / 2, { name: "post", collide: true }));
        // (A leaf: hinged on the post's inner edge, swung open into the yard by 1 radian.)
        const leafW = W / 2 - 0.05, th = 1;
        const dir = [-s * Math.cos(th), -Math.sin(th)] as const;
        solids.push(solid.box("wood", [s * W / 2 + dir[0] * leafW / 2, H * 0.4, dir[1] * leafW / 2], [leafW / 2, H * 0.36, 0.05], s > 0 ? Math.PI - th : th, { name: "leaf", collide: false }));
      } else if (kind === "arch") {
        solids.push(solid.box("stone", [x, (H + 1.2) / 2, 0], [P / 2, (H + 1.2) / 2, P * 0.6], 0, { name: "tower" }));
        solids.push(solid.cone("roof", [x, H + 1.2, 0], P * 0.8, P * 1.6, 0, { name: "spire", collide: false, sides: 4 }));
      } else {
        solids.push(solid.box("metal", [x, H / 2, 0], [P / 2, H / 2, P / 2], 0, { name: "pylon" }));
        solids.push(solid.box("glow", [x, H + 0.1, 0], [P / 2 + 0.05, 0.1, P / 2 + 0.05], 0, { name: "emitter", collide: false }));
      }
    }
    if (kind === "wooden") solids.push(solid.box("wood", [0, H + 0.12, 0], [W / 2 + P, 0.12, P / 2 * 0.8], 0, { name: "lintel", collide: false }));
    if (kind === "arch") {
      solids.push(solid.box("stone", [0, H + 0.6, 0], [W / 2 + P, 0.6, P * 0.55], 0, { name: "arch" }));
      solids.push(solid.ball("dark", [0, H, 0], [W / 2, W * 0.3, P * 0.58], { name: "archway", collide: false }));
      for (let i = 0; i < 5; i += 1) solids.push(solid.box("metal", [-W / 2 + (W * (i + 0.5)) / 5, H * 0.82, 0], [0.04, H * 0.18, 0.04], 0, { name: "portcullis", collide: false }));
    }
    if (kind === "scifi") solids.push(solid.box("glow", [0, H / 2, 0], [W / 2, H / 2 - 0.1, 0.02], 0, { name: "field", collide: false }));
    const half = W / 2 + P;
    return {
      solids, front: "+z",
      sockets: {
        endA: { kind: "anchor", pos: [-half, 0, 0], yaw: -Math.PI / 2, meta: { end: "A" } },
        endB: { kind: "anchor", pos: [half, 0, 0], yaw: Math.PI / 2, meta: { end: "B" } },
        entry: { kind: "anchor", pos: [0, 0, 1], yaw: Math.PI },
        exit: { kind: "anchor", pos: [0, 0, -1], yaw: 0 },
      },
      meta: { segment: { length: half * 2, opening: W, kind } },
    };
  },
});
