// A hood: a shell round the back of the head that leaves the face clear, a
// drape down the neck, ears on top (none, a cat's points, a bear's rounds),
// and a pixie point at the back or none -- or a deep cowl, pulled forward over
// a face lost in shadow but for two glowing eyes (a cartoon wizard's; no ears
// or point on a cowl). Two legs only: it's built to the head
// socket of a person or an anthro.
import type { AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { CLOTH, HUMANS, amount, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "hood",
  slot: "head",
  title: "Hood",
  tags: ["hood", "cloth"],
  targets: [HUMANS],
  choices: { ears: ["none", "cat", "bear"], point: [false, true], drape: { range: [0.5, 1] }, deep: [false, true], tip: ["auto", "flop"] },
  look: { roles: { primary: { ...CLOTH, patterns: ["none", "none", "stripes", "camo", "checks", "trim"] }, secondary: CLOTH, detail: { stuff: "dark" }, glow: { stuff: "glow" } } },
  build(S, fit, pins) {
    const ears = choose(S, pins, "ears", ["none", "cat", "bear"] as const);
    const point = choose(S, pins, "point", [false, true]);
    const drape = amount(S, pins, "drape", [0.5, 1]);
    const deep = choose(S, pins, "deep", [false, true]);
    // (A cowl's tip: "auto" as ever -- the pixie point, never on a deep cowl -- or "flop", a long tip flopping down the back, on any hood.)
    const tip = choose(S, pins, "tip", ["auto", "flop"] as const);
    const hr = fit.size[1];
    // (The head ball's centre is a radius below the crown; the shell sits back of it, so its front stays behind the face.)
    const capsules: AttributeCapsule[] = [
      { a: [0, -0.92 * hr, -0.28 * hr], b: [0, -0.92 * hr, -0.28 * hr], r: 1.12 * hr, role: "primary", part: "hood" },
      { a: [0, -1.5 * hr, -0.75 * hr], b: [0, -(1.5 + 0.7 * drape) * hr, -0.8 * hr], r: 0.55 * hr, role: "primary", part: "hood.drape" },
    ];
    if (tip === "flop") capsules.push({ a: [0, -0.1 * hr, -0.9 * hr], b: [0, -0.35 * hr, -1.95 * hr], r: 0.26 * hr, role: "primary", part: "hood.point" });
    else if (point && !deep) capsules.push({ a: [0, -0.2 * hr, -0.9 * hr], b: [0, 0.1 * hr, -1.55 * hr], r: 0.22 * hr, role: "primary", part: "hood.point" });
    if (ears === "cat" && !deep) for (const x of [-0.5, 0.5]) capsules.push({ a: [x * hr, 0, -0.2 * hr], b: [x * 1.2 * hr, 0.42 * hr, -0.25 * hr], r: 0.16 * hr, role: "secondary", part: "hood.ear" });
    if (ears === "bear" && !deep) for (const x of [-0.62, 0.62]) capsules.push({ a: [x * hr, 0.02 * hr, -0.25 * hr], b: [x * hr, 0.02 * hr, -0.25 * hr], r: 0.24 * hr, role: "secondary", part: "hood.ear" });
    if (deep) {
      // (The cowl's brow forward over the face, its sides down past the cheeks; the shadow inside; the eyes.)
      capsules.push({ a: [-0.55 * hr, -0.25 * hr, 0.35 * hr], b: [0.55 * hr, -0.25 * hr, 0.35 * hr], r: 0.42 * hr, role: "primary", part: "hood.cowl" });
      for (const x of [-1, 1]) capsules.push({ a: [x * 0.78 * hr, -0.45 * hr, 0.25 * hr], b: [x * 0.72 * hr, -1.35 * hr, 0.3 * hr], r: 0.3 * hr, role: "primary", part: "hood.cowl" });
      capsules.push({ a: [-0.3 * hr, -0.95 * hr, 0.55 * hr], b: [0.3 * hr, -0.95 * hr, 0.55 * hr], r: 0.46 * hr, role: "detail", part: "hood.shadow" });
      for (const x of [-1, 1]) capsules.push({ a: [x * 0.3 * hr, -0.82 * hr, 0.98 * hr], b: [x * 0.3 * hr, -0.82 * hr, 0.98 * hr], r: 0.12 * hr, role: "glow", part: "hood.eye" });
    }
    return { capsules };
  },
});
