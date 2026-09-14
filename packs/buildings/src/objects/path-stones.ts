// Path pieces, where a path wants geometry the terrain's surface doesn't
// give: stepping stones, flagstones set in the ground, or a boardwalk on low
// posts (over a marsh). Along x like a wall's segments (endA -x, endB +x);
// nothing collides but the boardwalk (the ground is the terrain's).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { ColliderSpec, DesignSolid } from "@keel-engine/object";
import { num, post, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "path-stones",
  title: "Path stones",
  tags: ["path", "road", "segment", "ground"],
  tier: "foreground",
  instancing: "many",
  variants: 6,
  choices: { length: { range: [0.3, 6] }, width: { range: [0.6, 2.4] }, kind: ["stepping", "flags", "boardwalk"] },
  look: { roles: roles("stone", "plank", "wood", "dark"), profiles: ["village", "stone", "desert", "nordic", "scifi"] },
  sway: null,
  design(J, v) {
    const L = num(v["length"]), W = num(v["width"]), kind = str(v["kind"]);
    const solids: DesignSolid[] = [];
    const colliders: ColliderSpec[] = [];
    if (kind === "boardwalk") {
      const n = Math.max(3, Math.round(L / 0.3));
      for (let i = 0; i < n; i += 1) solids.push(solid.box("plank", [-L / 2 + (L * (i + 0.5)) / n, 0.34, 0], [L / n / 2 * 0.86, 0.04, W / 2], J.between(-0.03, 0.03), { name: "board", collide: false }));
      for (let i = 0; i <= Math.round(L / 1.5); i += 1) for (const s of [-1, 1]) solids.push(post("wood", -L / 2 + (L * i) / Math.round(L / 1.5), s * (W / 2 - 0.08), 0, 0.3, 0.06));
      colliders.push({ c: [0, 0.19, 0], h: [L / 2, 0.19, W / 2], yaw: 0, mat: "plank", part: "boardwalk" });
    } else {
      const n = kind === "stepping" ? Math.max(2, Math.round(L / 0.7)) : Math.max(2, Math.round(L / 0.55)) * Math.max(1, Math.round(W / 0.6));
      const cols = kind === "stepping" ? 1 : Math.max(1, Math.round(W / 0.6));
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < rows; i += 1) for (let k = 0; k < cols; k += 1) {
        const x = -L / 2 + (L * (i + 0.5)) / rows + J.between(-0.06, 0.06);
        const z = cols === 1 ? J.between(-0.15, 0.15) * W : -W / 2 + (W * (k + 0.5)) / cols;
        const s = kind === "stepping" ? J.between(0.22, 0.32) : Math.min(L / rows, W / cols) / 2 * 0.9;
        solids.push(kind === "stepping"
          ? solid.box("stone", [x, 0.04, z], [s, 0.04, s * J.between(0.7, 0.95)], J.between(0, 1.5), { name: "stone", collide: false })
          : solid.box("stone", [x, 0.03, z], [s, 0.03, s], J.between(-0.08, 0.08), { name: "flag", collide: false }));
      }
    }
    return {
      solids, colliders, front: "+z",
      sockets: { endA: { kind: "anchor", pos: [-L / 2, 0, 0], yaw: -Math.PI / 2, meta: { end: "A" } }, endB: { kind: "anchor", pos: [L / 2, 0, 0], yaw: Math.PI / 2, meta: { end: "B" } } },
      meta: { segment: { length: L, width: W, kind } },
    };
  },
});
