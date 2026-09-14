// A crate: a box of planks in a frame (or slatted), alone or stacked two or
// three high with a small one on top. Destructible.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Stream, Vec3 } from "@keel-engine/core";
import { ACTS, num, roles, str } from "../kit.ts";
import { dcos, dsin } from "@keel-engine/core";

function box(out: DesignSolid[], c: Vec3, s: number, yaw: number, framed: boolean, J: Stream): void {
  const h = s / 2;
  out.push(solid.box("wood", [c[0], c[1] + h, c[2]], [h * 0.94, h * 0.94, h * 0.94], yaw, { name: "crate" }));
  const co = dcos(yaw), si = dsin(yaw);
  const at = (x: number, y: number, z: number): Vec3 => [c[0] + x * co + z * si, c[1] + y, c[2] - x * si + z * co];
  if (framed) {
    // (The frame: posts at the corners and rims top and bottom.)
    for (const x of [-1, 1]) for (const z of [-1, 1]) out.push(solid.box("metal", at(x * h * 0.94, h, z * h * 0.94), [0.035, h, 0.035], yaw, { name: "post", collide: false }));
    for (const y of [0.04, s - 0.04]) for (const [x, z, hx, hz] of [[0, h * 0.95, h, 0.03], [0, -h * 0.95, h, 0.03], [h * 0.95, 0, 0.03, h], [-h * 0.95, 0, 0.03, h]] as const) out.push(solid.box("wood", at(x, y, z), [hx, 0.04, hz], yaw, { name: "rim", collide: false }));
    // (A diagonal brace on the front: a run of short boxes.)
    for (let i = 0; i < 5; i += 1) { const t = (i + 0.5) / 5 - 0.5; out.push(solid.box("wood", at(t * s * 0.8, h + t * s * 0.8, h * 0.97), [0.05, 0.05, 0.02], yaw, { name: "brace", collide: false })); }
  } else {
    // (Slats: planks proud of every side, a gap between.)
    const n = 3;
    for (let i = 0; i < n; i += 1) {
      const y = (i + 0.5) * (s / n);
      const jy = J.between(-0.01, 0.01);
      for (const [x, z, hx, hz] of [[0, h, h, 0.025], [0, -h, h, 0.025], [h, 0, 0.025, h], [-h, 0, 0.025, h]] as const) out.push(solid.box("wood", at(x, y + jy, z), [hx, s / n / 2 * 0.8, hz], yaw, { name: "slat", collide: false }));
    }
  }
}

export default defineStyledObject({
  id: "crate",
  title: "Crate",
  tags: ["crate", "storage", "destructible", "block"],
  tier: "foreground",
  instancing: "many",
  variants: 4,
  choices: { size: { range: [0.55, 0.95] }, stack: [1, 1, 2, 3], build: ["framed", "slatted"] },
  look: { roles: roles("wood", "metal"), profiles: [...ACTS] },
  sway: null,
  billboard: true,
  design(J, v) {
    const s = num(v["size"]), framed = str(v["build"]) === "framed", n = num(v["stack"]);
    const solids: DesignSolid[] = [];
    box(solids, [0, 0, 0], s, J.between(-0.15, 0.15), framed, J);
    if (n >= 2) box(solids, [J.between(-0.06, 0.06), s, J.between(-0.06, 0.06)], s * 0.72, J.between(-0.5, 0.5), !framed, J);
    if (n >= 3) box(solids, [s * 0.85, 0, J.between(-0.2, 0.2)], s * 0.8, J.between(-0.4, 0.4), framed, J);
    return { solids, front: null };
  },
});
