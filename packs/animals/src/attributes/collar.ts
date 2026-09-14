// A collar: a ring round the neck, thin or wide, snug or loose, with a bell,
// a tag, a spike ring or nothing at the throat, and studs or none (not with
// spikes). This pack's
// own: it targets body/quadruped@^1 from packs/animals only.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { amount, axisOf, choose, ring } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "collar",
  slot: "neck",
  title: "Collar",
  tags: ["collar", "pet"],
  targets: [{ body: "body/quadruped@^1", packs: ["packs/animals@^1"] }],
  choices: { charm: ["bell", "tag", "spikes", "none"], band: ["thin", "wide"], studs: [true, false], snug: { range: [1.02, 1.12] } },
  look: { roles: { primary: { stuff: "leather", finishes: ["leather", "matte"], patterns: ["none", "none", "checks", "stripes", "trim"] }, metal: { stuff: "metal" }, detail: { stuff: "metal" } } },
  build(S, fit, pins) {
    const charm = choose(S, pins, "charm", ["bell", "tag", "spikes", "none"] as const);
    const band = choose(S, pins, "band", ["thin", "wide"] as const);
    const studs = choose(S, pins, "studs", [true, false]);
    const snug = amount(S, pins, "snug", [1.02, 1.12]);
    const n = fit.size[0] / 2; // (the neck's radius)
    const axis = axisOf(fit);
    const ringOf = ring(axis, n * snug, n * (band === "wide" ? 0.24 : 0.15), 6, "primary", "collar");
    const capsules: AttributeCapsule[] = [...ringOf.capsules];
    const f = ringOf.front;
    const out = (k: number): [number, number, number] => [f[0] * k, f[1] * k, f[2] * k];
    if (charm === "bell") { const c = out(1 + 0.42 / snug); capsules.push({ a: c, b: c, r: n * 0.22, role: "metal", part: "collar.bell" }); }
    // (A spike ring takes the studs' place: three spikes round the front and sides.)
    if (charm === "spikes") for (let k = 0; k < 6; k += 2) { const p = ringOf.capsules[k]!.a as [number, number, number]; const l = Math.hypot(...p) || 1; capsules.push({ a: p, b: [p[0] * (1 + 0.35 / l * n), p[1] * (1 + 0.35 / l * n), p[2] * (1 + 0.35 / l * n)], r: n * 0.06, role: "metal", part: "collar.spike" }); }
    if (studs && charm !== "spikes") for (const x of [-0.7, 0.7]) { const c: [number, number, number] = [x * n * snug, f[1] * 0.7, f[2] * 0.7]; capsules.push({ a: c, b: c, r: n * 0.1, role: "detail", part: "collar.stud" }); }
    const boxes = charm === "tag" ? [{ c: out(1 + 0.3 / snug), h: [n * 0.14, n * 0.18, n * 0.04] as [number, number, number], role: "metal" as const, part: "collar.tag" }] : [];
    return { capsules, boxes };
  },
});
