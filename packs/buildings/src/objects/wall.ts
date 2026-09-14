// A wall segment -- the piece walls are made of along a path (alongPath in
// ../paths.ts): it runs along x from its first end (endA, -x) to its second
// (endB, +x), `length` long, faces +z. Stone (a coping, crenels or not),
// brick (bands), a log palisade (pointed tops) or sci-fi panels (a glowing
// strip). A thick wall's top is a walkway (its auto top socket).
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { bool, num, roles, str } from "../kit.ts";

export default defineStyledObject({
  id: "wall",
  title: "Wall segment",
  tags: ["wall", "segment", "defence", "path"],
  tier: "main",
  instancing: "many",
  variants: 2,
  choices: { length: { range: [0.3, 12] }, height: { range: [1.2, 6] }, thick: { range: [0.4, 1.6] }, kind: ["stone", "brick", "palisade", "scifi"], crenels: [false, true] },
  look: { roles: roles("stone", "trim", "wood", "metal", "glow", "wall"), profiles: ["stone", "village", "nordic", "desert", "scifi", "machine"] },
  sway: null,
  design(_J, v) {
    const L = num(v["length"]), H = num(v["height"]), T = num(v["thick"]), kind = str(v["kind"]);
    const solids: DesignSolid[] = [];
    if (kind === "palisade") {
      const n = Math.max(2, Math.round(L / 0.32));
      const r = L / n / 2;
      for (let i = 0; i < n; i += 1) {
        const x = -L / 2 + r * (2 * i + 1);
        const h = H * (0.92 + ((i * 7) % 5) * 0.02);
        solids.push(solid.capsule("wood", [x, r, 0], [x, h - r * 2, 0], r, { name: "log", collide: false }));
        solids.push(solid.cone("wood", [x, h - r * 2.2, 0], r, r * 2.4, 0, { name: "point", collide: false, sides: 4, steps: 2 }));
      }
      solids.push(solid.box("wood", [0, H * 0.7, -r - 0.05], [L / 2, 0.08, 0.06], 0, { name: "brace", collide: false }));
    } else {
      const role = kind === "scifi" ? "wall" : "stone";
      solids.push(solid.box(role, [0, H / 2, 0], [L / 2, H / 2, T / 2], 0, { name: "wall" }));
      if (kind === "brick") for (let y = 0.5; y < H - 0.3; y += 0.9) solids.push(solid.box("trim", [0, y, 0], [L / 2 + 0.01, 0.04, T / 2 + 0.02], 0, { name: "band", collide: false }));
      if (kind === "scifi") {
        solids.push(solid.box("glow", [0, H * 0.62, T / 2 + 0.03], [L / 2 - 0.1, 0.06, 0.03], 0, { name: "strip", collide: false }));
        solids.push(solid.box("glow", [0, H * 0.62, -T / 2 - 0.03], [L / 2 - 0.1, 0.06, 0.03], 0, { name: "strip", collide: false }));
        solids.push(solid.box("metal", [0, H + 0.08, 0], [L / 2, 0.08, T / 2 + 0.06], 0, { name: "cap", collide: false }));
      } else solids.push(solid.box("trim", [0, H + 0.07, 0], [L / 2 + 0.02, 0.07, T / 2 + 0.06], 0, { name: "coping", collide: false }));
      if (bool(v["crenels"])) {
        const n = Math.max(1, Math.floor(L / 1.1));
        for (let i = 0; i < n; i += 1) {
          const x = -L / 2 + (L * (i + 0.5)) / n;
          solids.push(solid.box(kind === "scifi" ? "metal" : "stone", [x, H + 0.14 + 0.3, T / 2 - 0.15], [Math.min(0.3, L / n / 3), 0.3, 0.15], 0, { name: "merlon", collide: false }));
        }
      }
    }
    return {
      solids, front: "+z",
      voxel: { unit: Math.max(0.08, Math.min(0.3, H / 14)) },
      colliders: [{ c: [0, H / 2, 0], h: [L / 2, H / 2, kind === "palisade" ? L / Math.max(2, Math.round(L / 0.32)) / 2 : T / 2], yaw: 0, mat: "stone", part: "wall" }],
      sockets: {
        endA: { kind: "anchor", pos: [-L / 2, 0, 0], yaw: -Math.PI / 2, meta: { end: "A" } },
        endB: { kind: "anchor", pos: [L / 2, 0, 0], yaw: Math.PI / 2, meta: { end: "B" } },
        ...(T >= 0.9 && kind !== "palisade" ? { walk: { kind: "top", pos: [0, H + 0.14, 0], yaw: 0, extent: [L / 2, T / 2 - 0.1] } } : {}),
      },
      meta: { segment: { length: L, height: H, kind } },
    };
  },
});
