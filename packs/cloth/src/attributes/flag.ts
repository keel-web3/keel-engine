// A flag on a pole, carried in the back socket: the pole short, tall or very
// tall (a finial on top: a ball, a spike or none), the cloth a streaming
// banner, a pennant, a swallowtail or a square, how long a choice, a canton in
// its upper corner or none. The pole always stands up (y), off a person's back
// or up from an animal's; the cloth streams back and to the right of the
// carrier, so it reads from every side but one. Its stripes, checks and bands
// are the look's (on the cloth's own face coordinates).
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import { ANIMALS, CLOTH, HUMANS, METAL, WOOD, amount, bigOf, choose, outOf } from "../kit.ts";
import type { V3 } from "../kit.ts";

const POLE = { short: 2.8, tall: 3.6, towering: 4.4 } as const;
// (Back and to the right: its heading, as a yaw -- the frame convention: 0 is +z, the carrier's front. Half-way
// between two of the eight baked directions, so no direction ever sees it edge-on.)
const STREAM = (112.5 * Math.PI) / 180;

export default defineAttribute<AttributeShape>({
  id: "flag",
  slot: "back",
  title: "Flag",
  tags: ["flag", "banner", "tall"],
  targets: [HUMANS, ANIMALS],
  choices: { pole: ["short", "tall", "towering"], cloth: ["banner", "pennant", "swallowtail", "square"], finial: ["ball", "spike", "none"], canton: [false, true], length: { range: [0.8, 1.4] } },
  look: {
    roles: {
      primary: { ...CLOTH, patterns: ["none", "stripes", "stripes", "bands", "checks", "trim"] },
      secondary: { stuff: "paint", patterns: ["none", "none", "stripes", "checks"] },
      detail: { ...WOOD, finishes: ["matte"] },
      metal: METAL,
    },
  },
  build(S, fit, pins) {
    const pole = choose(S, pins, "pole", ["short", "tall", "towering"] as const);
    const cloth = choose(S, pins, "cloth", ["banner", "pennant", "swallowtail", "square"] as const);
    const finial = choose(S, pins, "finial", ["ball", "spike", "none"] as const);
    const canton = choose(S, pins, "canton", [false, true]);
    const length = amount(S, pins, "length", [0.8, 1.4]);
    const u = bigOf(fit);
    const out = outOf(fit);
    const base: V3 = [out[0] * 0.25 * u, out[1] * 0.25 * u - (out[1] > 0.5 ? 0 : 0.6 * u), out[2] * 0.25 * u];
    const H = POLE[pole] * u;
    const top: V3 = [base[0], base[1] + H, base[2]];
    const pr = 0.035 * u;
    const capsules: AttributeCapsule[] = [{ a: base, b: top, r: pr, role: "detail", part: "flag.pole" }];
    if (finial === "ball") capsules.push({ a: [top[0], top[1] + 0.06 * u, top[2]], b: [top[0], top[1] + 0.06 * u, top[2]], r: 0.07 * u, role: "metal", part: "flag.finial" });
    if (finial === "spike") capsules.push({ a: top, b: [top[0], top[1] + 0.22 * u, top[2]], r: 0.03 * u, role: "metal", part: "flag.finial" });
    // The cloth: boxes along its heading d, hung from the pole's top.
    const d: V3 = [Math.sin(STREAM), 0, Math.cos(STREAM)];
    const fl = (cloth === "square" ? 0.9 : 1.2) * u * length;
    const fh = cloth === "square" ? fl : cloth === "banner" ? 0.62 * u : 0.8 * u;
    const thick = 0.02 * u;
    const y0 = top[1] - 0.04 * u; // (the cloth's top edge)
    const boxes: AttributeBox[] = [];
    const piece = (s0: number, s1: number, yTop: number, h: number, role: "primary" | "secondary" = "primary", t = thick, part = "flag"): void => {
      const s = pr + ((s0 + s1) / 2) * fl;
      boxes.push({ c: [top[0] + d[0] * s, yTop - h / 2, top[2] + d[2] * s], h: [t, h / 2, ((s1 - s0) * fl) / 2], yaw: STREAM, role, part });
    };
    if (cloth === "pennant") { piece(0, 0.34, y0, fh); piece(0.34, 0.67, y0 - fh * 0.14, fh * 0.72); piece(0.67, 1, y0 - fh * 0.3, fh * 0.4); }
    else if (cloth === "swallowtail") { piece(0, 0.66, y0, fh); piece(0.66, 1, y0, fh * 0.38); piece(0.66, 1, y0 - fh * 0.62, fh * 0.38); }
    else piece(0, 1, y0, fh);
    if (canton) piece(0, 0.42, y0, fh * 0.5, "secondary", thick * 1.8, "flag.canton");
    return { capsules, boxes };
  },
});
