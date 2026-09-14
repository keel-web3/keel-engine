// A top hat: a flat brim (narrow, wide, or curled up at the sides), a tall
// crown -- straight or tapered, how tall a choice -- and a band round it
// (none, thin or wide). Built to the head socket.
import type { AttributeBox, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, CLOTH, HUMANS, PAINT, amount, choose } from "../kit.ts";

export default defineAttribute<AttributeShape>({
  id: "top-hat",
  slot: "head",
  title: "Top hat",
  tags: ["hat", "formal"],
  targets: [HUMANS, ANIMALS],
  choices: { height: { range: [0.9, 1.6] }, brim: ["narrow", "wide", "curled"], crown: ["straight", "tapered"], band: ["none", "thin", "wide"] },
  look: { roles: { primary: { ...CLOTH, finishes: ["matte", "cloth"], patterns: ["none", "none", "none", "stripes", "checks"] }, secondary: { ...PAINT, patterns: ["none", "stripes", "checks"] }, trim: PAINT } },
  build(S, fit, pins) {
    const height = amount(S, pins, "height", [0.9, 1.6]);
    const brim = choose(S, pins, "brim", ["narrow", "wide", "curled"] as const);
    const crown = choose(S, pins, "crown", ["straight", "tapered"] as const);
    const band = choose(S, pins, "band", ["none", "thin", "wide"] as const);
    const hr = fit.size[1];
    const H = height * hr;
    const bw = brim === "narrow" ? 0.75 : 0.95;
    const boxes: AttributeBox[] = [{ c: [0, -0.08 * hr, 0], h: [bw * hr, 0.05 * hr, bw * hr], role: "primary", part: "top-hat.brim" }];
    if (brim === "curled") for (const x of [-1, 1]) boxes.push({ c: [x * bw * hr, 0.02 * hr, 0], h: [0.06 * hr, 0.1 * hr, bw * 0.8 * hr], role: "trim", part: "top-hat.curl" });
    if (crown === "straight") boxes.push({ c: [0, -0.04 * hr + H / 2, 0], h: [0.55 * hr, H / 2, 0.55 * hr], role: "primary", part: "top-hat" });
    else {
      boxes.push({ c: [0, -0.04 * hr + H * 0.3, 0], h: [0.52 * hr, H * 0.3, 0.52 * hr], role: "primary", part: "top-hat" });
      boxes.push({ c: [0, -0.04 * hr + H * 0.8, 0], h: [0.6 * hr, H * 0.2, 0.6 * hr], role: "primary", part: "top-hat.top" });
    }
    const bandH = band === "wide" ? 0.2 : 0.09;
    if (band !== "none") boxes.push({ c: [0, (0.02 + bandH) * hr, 0], h: [(crown === "straight" ? 0.57 : 0.54) * hr, bandH * hr, (crown === "straight" ? 0.57 : 0.54) * hr], role: "secondary", part: "top-hat.band" });
    return { boxes };
  },
});
