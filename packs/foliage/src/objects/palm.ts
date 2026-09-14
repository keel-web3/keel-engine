// A palm: a ringed trunk curving up and over, a head of five to eight fronds
// arching out and down, coconuts (or none) under them.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { WIND, bool, num, roles } from "../kit.ts";

export default defineStyledObject({
  id: "palm",
  title: "Palm",
  tags: ["tree", "tropical", "desert", "coast"],
  tier: "background",
  instancing: "many",
  choices: { height: { range: [5, 10] }, curve: { range: [0.05, 0.5] }, fronds: [5, 6, 7, 8], coconuts: [true, false] },
  look: { roles: roles("leaf", "bark", "fruit"), profiles: ["tropical", "summer", "dry", "desert", "alien"] },
  sway: WIND.palm,
  design(J, v) {
    const H = num(v["height"]);
    const curve = num(v["curve"]);
    const yaw = J.between(0, Math.PI * 2);
    const solids: DesignSolid[] = [];
    const segs = 7;
    const at = (t: number): Vec3 => { const off = curve * H * t * t; return [Math.sin(yaw) * off, t * H, Math.cos(yaw) * off]; };
    const r0 = 0.14 + H * 0.012;
    solids.push(solid.cylinder("bark", [0, 0, 0], r0 * 1.5, r0 * 1.2, { name: "roots", collide: false }));
    for (let i = 0; i < segs; i += 1) {
      const a = at(i / segs), b = at((i + 1) / segs);
      const r = r0 * (1 - (i / segs) * 0.35);
      // (Rings: every segment a little fatter at its foot -- the palm's banded trunk, in silhouette.)
      solids.push(solid.capsule("bark", [a[0], Math.max(a[1], r), a[2]], b, r, { name: "trunk", collide: i === 0 }));
      solids.push(solid.ball("bark", [a[0], Math.max(a[1], r) + r * 0.3, a[2]], [r * 1.2, r * 0.55, r * 1.2], { name: "ring", collide: false, styles: ["pixel"] }));
    }
    const top = at(1);
    const n = num(v["fronds"]);
    for (let i = 0; i < n; i += 1) {
      const fy = (i / n) * Math.PI * 2 + J.between(-0.25, 0.25);
      const L = H * J.between(0.34, 0.44);
      // (A frond: three capsules, rising then drooping.)
      let p: Vec3 = [top[0], top[1] + 0.1, top[2]];
      const pitches = [0.45, -0.1, -0.75];
      pitches.forEach((pitch, k) => {
        const len = (L / 3) * (k === 0 ? 1.1 : 1);
        const d: Vec3 = [Math.sin(fy) * Math.cos(pitch), Math.sin(pitch), Math.cos(fy) * Math.cos(pitch)];
        const q: Vec3 = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
        solids.push(solid.capsule("leaf", p, q, H * (0.034 - k * 0.007), { name: "frond", group: "head", collide: false }));
        p = q;
      });
    }
    solids.push(solid.ball("leaf", top, H * 0.05, { name: "heart", group: "head", collide: false }));
    if (bool(v["coconuts"])) for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + yaw;
      solids.push(solid.ball("fruit", [top[0] + Math.sin(a) * r0 * 0.9, top[1] - r0 * 0.9, top[2] + Math.cos(a) * r0 * 0.9], r0 * 0.7, { name: "coconut", group: "head", collide: false }));
    }
    return { solids, front: null, sockets: { base: { kind: "anchor", pos: [0, 0, 0] } } };
  },
});
