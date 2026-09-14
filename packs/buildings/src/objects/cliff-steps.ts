// Cliff steps: a stair cut into a cliff face, so a level's cliff edge (the
// terrain's) has a way up -- straight, with a landing half way, or a dogleg
// (the second flight stepped sideways off the landing). Its foot at +z on the
// low ground, its top at -z on the high ground `height` up; rock cheeks either
// side and the rock behind fill to the high ground's edge.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { ColliderSpec, DesignSolid } from "@keel-engine/object";
import { num, roles, str } from "../kit.ts";

const RISE = 0.2, TREAD = 0.32;

export default defineStyledObject({
  id: "cliff-steps",
  title: "Cliff steps",
  tags: ["stairs", "cliff", "level", "terrain"],
  tier: "main",
  instancing: "few",
  variants: 4,
  choices: { height: { range: [1.5, 8] }, width: { range: [1.2, 3] }, form: ["straight", "landing", "dogleg"] },
  look: { roles: roles("stone", "trim", "dark"), profiles: ["stone", "desert", "village", "nordic", "scifi"] },
  sway: null,
  design(J, v) {
    const H = num(v["height"]), W = num(v["width"]), form = str(v["form"]);
    const solids: DesignSolid[] = [];
    const colliders: ColliderSpec[] = [];
    // A flight at x from z0 climbing toward -z from y0 by h: masonry to the ground under every step. Returns its end.
    const flight = (x: number, z0: number, y0: number, h: number): number => {
      const n = Math.max(1, Math.round(h / RISE));
      const rise = h / n;
      for (let i = 0; i < n; i += 1) {
        const top = y0 + rise * (i + 1);
        solids.push(solid.box("stone", [x, top / 2, z0 - TREAD * (i + 0.5)], [W / 2, top / 2, TREAD / 2], 0, { name: "step", collide: false }));
      }
      const run = n * TREAD;
      colliders.push({ c: [x, y0 + h / 2, z0 - run / 2], h: [W / 2, h / 2, run / 2], yaw: 0, mat: "stone", part: "flight", kind: "wedge", lo: 0 });
      if (y0 > 0) colliders.push({ c: [x, y0 / 2, z0 - run / 2], h: [W / 2, y0 / 2, run / 2], yaw: 0, mat: "stone", part: "flight" });
      return z0 - run;
    };
    const land = (x0: number, x1: number, z0: number, y: number, depth: number): void => {
      const c: [number, number, number] = [(x0 + x1) / 2, y / 2, z0 - depth / 2];
      const h: [number, number, number] = [(x1 - x0) / 2, y / 2, depth / 2];
      solids.push(solid.box("stone", c, h, 0, { name: "landing", collide: false }));
      colliders.push({ c, h, yaw: 0, mat: "stone", part: "landing" });
    };
    let run: number, topX = 0, lo = -W / 2, hi = W / 2;
    if (form === "straight") run = -flight(0, 0, 0, H);
    else {
      const h1 = Math.round(H / 2 / RISE) * RISE || RISE;
      const z1 = flight(0, 0, 0, h1);
      const shift = form === "dogleg" ? W : 0;
      land(-W / 2, W / 2 + shift, z1, h1, 1);
      topX = shift;
      hi = W / 2 + shift;
      run = -flight(shift, z1 - 1, h1, H - h1);
    }
    // Rock: cheeks either side (jagged blocks, stepping up with the stair), the cliff behind.
    const blocks = 4;
    for (const [x, s] of [[lo, -1], [hi, 1]] as const) for (let i = 0; i < blocks; i += 1) {
      const z = -(run * (i + 0.5)) / blocks;
      const top = H * Math.min(1, (i + 1.3) / blocks) + J.between(0.1, 0.5);
      solids.push(solid.box("stone", [x + s * 0.5, top / 2, z], [0.5 + J.between(0, 0.12), top / 2, run / blocks / 2 + 0.05], J.between(-0.08, 0.08), { name: "rock" }));
    }
    solids.push(solid.box("stone", [(lo + hi) / 2, H / 2, -run - 0.5], [(hi - lo) / 2 + 1, H / 2, 0.5], 0, { name: "cliff" }));
    const rocks = solids.filter((s) => s.kind === "box" && (s.name === "rock" || s.name === "cliff")) as Array<Extract<DesignSolid, { kind: "box" }>>;
    for (const r of rocks) colliders.push({ c: [r.c[0], r.c[1], r.c[2]], h: [r.h[0], r.h[1], r.h[2]], yaw: r.yaw ?? 0, mat: "stone", part: r.name ?? "rock" });
    return {
      solids, colliders, front: "+z",
      sockets: {
        foot: { kind: "anchor", pos: [0, 0, 0.3], yaw: Math.PI, extent: [W / 2, 0] },
        top: { kind: "anchor", pos: [topX, H, -run], yaw: Math.PI, extent: [W / 2, 0] },
      },
      meta: { cliff: { height: H, run } },
    };
  },
});
