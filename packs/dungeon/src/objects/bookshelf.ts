// A bookshelf against a wall: a frame, three to five shelves and their books
// -- leather, cloth and gilt spines of every height, full, sparse, or ruined
// (half of them on the floor). Its back is the wall (z = 0), 0.36 deep.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, num, roles, str } from "../kit.ts";

const SPINES = ["leather", "cloth", "accent", "leather", "paper"] as const;

export default defineStyledObject({
  id: "bookshelf",
  title: "Bookshelf",
  tags: ["bookshelf", "library", "wall", "block"],
  tier: "foreground",
  instancing: "many",
  variants: 6,
  choices: { width: { range: [1.2, 1.9] }, shelves: [3, 4, 5], fill: ["full", "full", "sparse", "ruined"] },
  look: { roles: roles("wood", "leather", "cloth", "accent", "paper", "gold", "dark"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const W = num(v["width"]), n = num(v["shelves"]), fill = str(v["fill"]);
    const H = 0.5 + n * 0.42, D = 0.36, t = 0.05;
    const solids: DesignSolid[] = [];
    solids.push(solid.box("dark", [0, H / 2, 0.03], [W / 2, H / 2, 0.03], 0, { name: "back" }));
    for (const s of [-1, 1]) solids.push(solid.box("wood", [s * (W / 2 - t / 2), H / 2, D / 2], [t / 2, H / 2, D / 2], 0, { name: "side" }));
    solids.push(solid.box("wood", [0, H - t / 2, D / 2], [W / 2 + 0.03, t / 2, D / 2 + 0.02], 0, { name: "top" }));
    solids.push(solid.box("wood", [0, 0.06, D / 2], [W / 2, 0.06, D / 2], 0, { name: "plinth" }));
    const gap = (H - 0.12 - t) / n;
    for (let i = 0; i < n; i += 1) {
      const y0 = 0.12 + i * gap;
      if (i > 0) solids.push(solid.box("wood", [0, y0, D / 2], [W / 2 - t, 0.02, D / 2], 0, { name: "shelf", collide: false }));
      // Books along the shelf: widths and heights drawn, gaps where the fill says.
      let x = -W / 2 + t + 0.02;
      const keep = fill === "full" ? 0.92 : fill === "sparse" ? 0.55 : 0.4;
      while (x < W / 2 - t - 0.06) {
        const bw = J.between(0.04, 0.09), bh = gap * J.between(0.5, 0.85);
        if (J.f() < keep) {
          const role = SPINES[Math.floor(J.f() * SPINES.length)]!;
          solids.push(solid.box(role, [x + bw / 2, y0 + 0.02 + bh / 2, D * 0.55], [bw / 2 * 0.9, bh / 2, D * 0.36], 0, { name: "book", collide: false }));
          if (J.f() < 0.3) solids.push(solid.box("gold", [x + bw / 2, y0 + 0.02 + bh * 0.8, D * 0.91], [bw / 2 * 0.7, 0.012, 0.006], 0, { name: "gilt", collide: false }));
        }
        x += bw;
      }
    }
    if (fill === "ruined") for (let k = 0; k < 5; k += 1) solids.push(solid.box(SPINES[k % SPINES.length]!, [J.between(-W / 2, W / 2), 0.03, D + J.between(0.1, 0.5)], [0.1, 0.03, 0.07], J.between(0, 3.14), { name: "fallen", collide: false }));
    return { solids, front: "+z" };
  },
});
