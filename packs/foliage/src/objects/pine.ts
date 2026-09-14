// A pine: a straight thin trunk and three to six tiers of needles, each a
// cone narrowing to a spike -- classic, narrow (a spruce) or sparse (tiers
// apart, trunk between them) -- the tallest thing in a forest.
import { defineStyledObject, solid } from "@keel-engine/object";
import type { DesignSolid } from "@keel-engine/object";
import { WIND, num, roles, str, trunk } from "../kit.ts";

const FORM = { classic: { w: 0.3, gap: 0.62 }, narrow: { w: 0.2, gap: 0.55 }, sparse: { w: 0.28, gap: 0.85 } } as const;

export default defineStyledObject({
  id: "pine",
  title: "Pine",
  tags: ["tree", "conifer", "temperate", "cold"],
  tier: "background",
  instancing: "many",
  choices: { height: { range: [6, 12] }, tiers: [3, 4, 5, 6], form: ["classic", "narrow", "sparse"], lean: { range: [0, 0.12] }, season: ["summer", "winter"] },
  look: { roles: roles("needle", "bark", "leaf"), choices: ["season"], profiles: ["summer", "winter", "spring", "autumn", "alien"] },
  sway: WIND.conifer,
  design(J, v) {
    const H = num(v["height"]);
    const f = FORM[str(v["form"]) as keyof typeof FORM];
    const tiers = num(v["tiers"]);
    const leanYaw = J.between(0, Math.PI * 2);
    const r0 = 0.1 + H * 0.016;
    const t = trunk("bark", H * 0.94, r0, r0 * 0.45, { lean: num(v["lean"]), leanYaw, segments: 3 });
    const solids: DesignSolid[] = [...t.solids];
    const foot = H * (f === FORM.sparse ? 0.28 : 0.18);
    const span = H - foot;
    const step = span / tiers;
    for (let i = 0; i < tiers; i += 1) {
      const k = i / tiers;
      const y = foot + step * i;
      const c = t.at(y / H);
      const R = H * f.w * (1 - k * 0.72) * J.between(0.92, 1.06);
      const h = step * (1 + f.gap) * (i === tiers - 1 ? 1.35 : 1);
      solids.push(solid.cone("needle", [c[0], y, c[2]], R, h, R * 0.12, { name: "tier", group: "crown", collide: false }));
    }
    // (A pale tip: the new growth -- the leaf role, which a winter look turns to snow.)
    const top = t.at(1);
    solids.push(solid.cone("leaf", [top[0], H * 0.93, top[2]], H * 0.035, H * 0.08, 0, { name: "tip", group: "crown", collide: false, sides: 4 }));
    return { solids, front: null, sockets: { base: { kind: "anchor", pos: [0, 0, 0] } } };
  },
});
