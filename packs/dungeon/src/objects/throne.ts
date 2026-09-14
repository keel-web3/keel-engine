// A throne on its dais: a stone seat (or one of bone, or black iron), a tall
// back crowned with spikes or skulls, arms, a cushion, gold trim. The boss's
// chair. Its front faces +z.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { ACTS, roles, skull, str } from "../kit.ts";

export default defineStyledObject({
  id: "throne",
  title: "Throne",
  tags: ["throne", "boss", "block"],
  tier: "main",
  instancing: "few",
  variants: 2,
  choices: { build: ["stone", "bone", "iron"], crown: ["spikes", "skulls", "arch"] },
  look: { roles: roles("stone", "metal", "bone", "gold", "cushion", "cloth", "dark"), profiles: [...ACTS] },
  sway: null,
  design(J, v) {
    const build = str(v["build"]), crown = str(v["crown"]);
    const m = build === "iron" ? "metal" : build === "bone" ? "bone" : "stone";
    const solids: DesignSolid[] = [];
    // The dais: two steps.
    solids.push(solid.box("stone", [0, 0.1, 0], [1.1, 0.1, 1.0], 0, { name: "dais" }));
    solids.push(solid.box("stone", [0, 0.28, -0.1], [0.85, 0.08, 0.75], 0, { name: "dais" }));
    const y = 0.36;
    solids.push(solid.box(m, [0, y + 0.25, -0.05], [0.5, 0.25, 0.42], 0, { name: "seat" }));
    solids.push(solid.box("cushion", [0, y + 0.53, 0.02], [0.36, 0.035, 0.3], 0, { name: "cushion", collide: false }));
    // The back: two tall posts, a low panel, a rail at the top, a drape hung between -- a frame, not a slab.
    for (const s of [-1, 1]) solids.push(solid.box(m, [s * 0.44, y + 1.15, -0.42], [0.09, 1.0, 0.1], 0, { name: "post" }));
    solids.push(solid.box(m, [0, y + 0.75, -0.44], [0.36, 0.22, 0.07], 0, { name: "back" }));
    solids.push(solid.box(m, [0, y + 2.05, -0.42], [0.54, 0.09, 0.11], 0, { name: "rail" }));
    solids.push(solid.box("cloth", [0, y + 1.42, -0.4], [0.34, 0.52, 0.012], 0, { name: "drape", collide: false }));
    solids.push(solid.box("gold", [0, y + 1.42, -0.385], [0.05, 0.4, 0.008], 0, { name: "drape.band", collide: false }));
    for (const s of [-1, 1]) {
      solids.push(solid.box(m, [s * 0.55, y + 0.62, -0.05], [0.07, 0.14, 0.42], 0, { name: "arm" }));
      solids.push(solid.ball("gold", [s * 0.55, y + 0.78, 0.35], 0.07, { name: "knob", collide: false }));
      solids.push(solid.box("gold", [s * 0.44, y + 1.15, -0.315], [0.025, 0.95, 0.012], 0, { name: "trim", collide: false }));
    }
    const top = y + 2.15;
    if (crown === "spikes") for (let i = -2; i <= 2; i += 1) solids.push(solid.cone(build === "bone" ? "bone" : "metal", [i * 0.2, top, -0.42], 0.07, 0.35 - Math.abs(i) * 0.08, 0, { name: "spike", collide: false, sides: 4 }));
    else if (crown === "skulls") for (let i = -1; i <= 1; i += 1) skull(solids, [i * 0.34, top - 0.02, -0.38], 0.24, 0);
    else { solids.push(solid.capsule("gold", [-0.45, top, -0.42], [0, top + 0.3, -0.42], 0.05, { name: "arch", collide: false })); solids.push(solid.capsule("gold", [0, top + 0.3, -0.42], [0.45, top, -0.42], 0.05, { name: "arch", collide: false })); solids.push(solid.ball("dark", [0, top + 0.12, -0.36], 0.08, { name: "gem", collide: false })); }
    void J;
    // (A throne is bigger than a man: everything half again as big.)
    const k2 = 1.35;
    const big = solids.map((q) => ({ ...q, ...("c" in q ? { c: [q.c[0] * k2, q.c[1] * k2, q.c[2] * k2] as const } : {}), ...("h" in q && Array.isArray(q.h) ? { h: [q.h[0] * k2, q.h[1] * k2, q.h[2] * k2] as const } : {}), ...("a" in q ? { a: [q.a[0] * k2, q.a[1] * k2, q.a[2] * k2] as const, b: [q.b[0] * k2, q.b[1] * k2, q.b[2] * k2] as const } : {}), ...("r" in q ? { r: Array.isArray(q.r) ? ([q.r[0] * k2, q.r[1] * k2, q.r[2] * k2] as const) : (q.r as number) * k2 } : {}), ...("kind" in q && q.kind === "cone" ? { h: (q.h as number) * k2, top: ((q as { top?: number }).top ?? 0) * k2 } : {}) })) as DesignSolid[];
    return { solids: big, front: "+z" };
  },
});
