// A fallen log: lying along x, long or short, thick or thin, hollow at one
// end or not, branch stubs, moss along its back, bracket fungus shelves.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { bool, num, roles } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

export default defineStyledObject({
  id: "log",
  title: "Log",
  tags: ["log", "wood", "forest"],
  tier: "background",
  instancing: "many",
  variants: 6,
  choices: { length: { range: [1.5, 5] }, radius: { range: [0.18, 0.5] }, hollow: [false, true], fungus: [false, true], moss: [true, false] },
  look: { roles: roles("bark", "wood", "moss", "cap", "dark"), profiles: ["summer", "autumn", "winter", "fungal", "alien"] },
  sway: null,
  design(J, v) {
    const L = num(v["length"]);
    const r = num(v["radius"]);
    const solids: DesignSolid[] = [];
    const yaw = J.between(-0.2, 0.2);
    const half = L / 2 - r;
    const a: [number, number, number] = [-dcos(yaw) * half, r * 1.06, dsin(yaw) * half];
    const b: [number, number, number] = [dcos(yaw) * half, r, -dsin(yaw) * half];
    solids.push(solid.capsule("bark", a, b, r, { name: "log" }));
    // (The cut end: pale wood; hollow, a dark mouth in it.)
    solids.push(solid.ball("wood", [b[0] + dcos(yaw) * r * 0.55, b[1], b[2] - dsin(yaw) * r * 0.55], [r * 0.5, r * 0.86, r * 0.86], { name: "end", collide: false }));
    if (bool(v["hollow"])) solids.push(solid.ball("dark", [b[0] + dcos(yaw) * r * 0.8, b[1], b[2] - dsin(yaw) * r * 0.8], [r * 0.4, r * 0.55, r * 0.55], { name: "hollow", collide: false }));
    for (let i = 0; i < 2; i += 1) {
      const t = J.between(-0.6, 0.6);
      const p: [number, number, number] = [a[0] + (b[0] - a[0]) * (t + 1) / 2, r * 1.2, a[2] + (b[2] - a[2]) * (t + 1) / 2];
      const side = i ? 1 : -1;
      solids.push(solid.capsule("bark", p, [p[0] + J.between(-0.2, 0.2), p[1] + r * 0.7, p[2] + side * r * 1.3], r * 0.28, { name: "stub", collide: false }));
    }
    if (bool(v["moss"])) solids.push(solid.capsule("moss", [a[0] * 0.6, r * 1.85, a[2] * 0.6], [b[0] * 0.4, r * 1.8, b[2] * 0.4], r * 0.28, { name: "moss", collide: false }));
    if (bool(v["fungus"])) for (let i = 0; i < 3; i += 1) {
      const t = -0.5 + i * 0.4;
      solids.push(solid.ball("cap", [a[0] + (b[0] - a[0]) * (t + 1) / 2, r * (0.9 + i * 0.2), r * 1.02], [r * 0.35, r * 0.1, r * 0.3], { name: "shelf", collide: false }));
    }
    return { solids, front: null, sockets: { seat: { kind: "seat", pos: [0, r * 1.95, 0], yaw: 0 } } };
  },
});
