// A scarf: a ring round the neck -- thin or chunky -- a knot at the throat,
// no tail, one or two hanging down, long or short, with tassels or without.
// Built to the neck socket (an "around" socket: its origin on the neck's axis),
// the ring square to the neck -- upright on two legs, tilted forward on four.
// Its stripes are the look's (a bands pattern), not geometry.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, HUMANS, KNIT, amount, axisOf, choose, ring } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "scarf",
  slot: "neck",
  title: "Scarf",
  tags: ["scarf", "knit", "winter"],
  targets: [HUMANS, ANIMALS],
  choices: { tails: [0, 1, 2], knit: ["thin", "chunky"], tassels: [false, true], length: { range: [1, 1.6] } },
  look: { roles: { primary: { ...KNIT, patterns: ["none", "bands", "bands", "stripes", "checks"] }, secondary: KNIT } },
  build(S, fit, pins) {
    const tails = choose(S, pins, "tails", [0, 1, 2]);
    const knit = choose(S, pins, "knit", ["thin", "chunky"] as const);
    const tassels = choose(S, pins, "tassels", [false, true]);
    const length = amount(S, pins, "length", [1, 1.6]);
    const n = fit.size[0] / 2; // (the neck's radius)
    const t = knit === "chunky" ? 0.44 : 0.3;
    // (Five pieces round: two tails with tassels still keep the whole scarf to ten parts.)
    const band = ring(axisOf(fit), n * (1.05 + t * 0.3), n * t, tails === 2 && tassels ? 5 : 6, "primary", "scarf");
    const capsules: AttributeCapsule[] = [...band.capsules];
    const f = band.front;
    const knot: [number, number, number] = [f[0] * 1.15, f[1] * 1.15, f[2] * 1.15];
    capsules.push({ a: knot, b: knot, r: n * (t + 0.04), role: "secondary", part: "scarf.knot" });
    for (let k = 0; k < tails; k += 1) {
      const side = tails === 1 ? 0.25 : k === 0 ? -0.3 : 0.3;
      const end: [number, number, number] = [knot[0] + side * n, knot[1] - length * n, knot[2] + 0.2 * n];
      capsules.push({ a: knot, b: end, r: n * t * 0.7, role: "primary", part: "scarf.tail" });
      if (tassels) capsules.push({ a: end, b: [end[0], end[1] - 0.12 * n, end[2]], r: n * 0.12, role: "secondary", part: "scarf.tassel" });
    }
    return { capsules };
  },
});
