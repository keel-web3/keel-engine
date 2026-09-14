// WALKER (quadruped rig): a four-legged war machine -- a hull (box, stepped
// wedge or dome) on four legs (thick or thin, stamping on flat pads), a
// cockpit head in front (a visor slit, a turret or a single lamp), weapon
// hardpoints on the hull (cannon, twin guns, a mortar, a launcher pod, or
// none), skirts or plates, and a team chevron over the top. Heavy and blocky:
// the rig's walk makes it stomp, its attack a lunge that rocks the hull.

import type { Skeleton } from "@keel-engine/entity";
import { add, bones, lerp } from "../kit.ts";
import type { Pen, V3 } from "../kit.ts";
import type { PlanDef } from "./common.ts";
import { quadBody, quadSpec } from "./common.ts";

export const walker: PlanDef = {
  rig: "quadruped",
  choices: {
    hull: ["box", "wedge", "dome"],
    head: ["visor", "turret", "lamp"],
    legs: ["thick", "thin"],
    weapon: ["cannon", "twin", "mortar", "launcher", "none"],
    armour: ["none", "skirts", "plates"],
    bulk: { range: [0.9, 1.12] },
  },
  weights: { weapon: [3, 3, 2, 2, 1] },
  build(seed, S, c) {
    const bulk = c["bulk"] as number;
    const hull = c["hull"] as string, head = c["head"] as string, weapon = c["weapon"] as string, armour = c["armour"] as string;
    const thick = c["legs"] === "thick";
    const legR = (thick ? 0.055 : 0.034) * S;
    const hw = 0.44 * S * bulk, hh = 0.12 * S * bulk, hd = 0.3 * S; // hull half extents
    const hr = 0.12 * S;
    // (Legs set out past the hull's sides: a wide, planted stance.)
    const body = quadBody({ sh: 0.46 * S, hip: 0.46 * S, ankle: 0.06 * S, bodyR: hh * 1.6, legR, len: 0.48 * S, w: hw + legR * 1.6, neck: 0.1 * S, rise: 0.15, headR: hr, pawR: legR * 1.3, pawLen: 0.12 * S, tail: 0.15 * S, tailRise: 0 });
    const spec = quadSpec(seed, "bear", body);

    const skin = (skel: Skeleton, P: Pen): void => {
      const B = bones(skel);
      // The hull rides the spine, over the legs' hips.
      const hc = lerp(B.W("pelvis", [0, 0.1 * S, 0]), B.W("chest", [0, 0.1 * S, 0]), 0.5);
      const top = hc[1] + hh;
      if (hull === "box") P.box("body", hc, [hw, hh, hd]);
      else if (hull === "wedge") {
        P.box("body", add(hc, [0, -hh * 0.35, 0.02 * S]), [hw, hh * 0.65, hd * 1.08]);
        P.box("body.upper", add(hc, [0, hh * 0.55, -hd * 0.18]), [hw * 0.86, hh * 0.45, hd * 0.8]);
      } else {
        P.box("body", add(hc, [0, -hh * 0.45, 0]), [hw, hh * 0.55, hd]);
        P.cap("body.dome", add(hc, [0, hh * 0.25, -hd * 0.35]), add(hc, [0, hh * 0.25, hd * 0.35]), hw * 0.78);
      }
      const roof = hull === "dome" ? hc[1] + hh * 0.25 + hw * 0.78 : top;
      // The team chevron over the top (two stripes meeting at the front) and a band round the hull's waist.
      const ch = hull === "dome" ? roof - 0.01 * S : top + 0.004 * S;
      for (const x of [-1, 1]) P.box(`collar.chevron${x}`, add(hc, [x * hw * 0.3, ch - hc[1], hd * 0.1]), [0.07 * S, 0.012 * S, hd * 0.8], x * 0.55);
      P.box("collar.band", add(hc, [0, -hh * 0.45, 0]), [hw * 1.03, hh * 0.18, hd * 1.03]);

      // The cockpit on its short neck, in front of the hull.
      const H = (x: number, y: number, z: number): V3 => B.W("head", [x * hr, y * hr, z * hr]);
      P.cap("neck", B.W("neck", [0, 0, 0]), H(0, 0, 0.2), hr * 0.55);
      // (Each box head holds a capsule of its own slot, filling it: bake's headOf measures a head by its capsules.)
      if (head === "visor") {
        P.box("head", H(0, 0.1, 0.7), [hr * 1.15, hr * 0.7, hr * 0.95]);
        P.cap("head.core", H(-0.45, 0.1, 0.7), H(0.45, 0.1, 0.7), hr * 0.7);
        P.box("eye.visor", H(0, 0.3, 1.66), [hr * 0.9, hr * 0.16, hr * 0.02]);
        P.box("brow", H(0, 0.9, 0.9), [hr * 1.25, hr * 0.12, hr * 0.95]);
      } else if (head === "turret") {
        P.box("head", H(0, 0.2, 0.55), [hr * 1.0, hr * 0.62, hr * 1.0]);
        P.cap("head.core", H(-0.38, 0.2, 0.55), H(0.38, 0.2, 0.55), hr * 0.62);
        P.cap("nose.barrel", H(0.35, 0.25, 1.4), H(0.35, 0.3, 2.9), hr * 0.18);
        for (const x of [-1, 1]) P.ball(`eye.${x}`, H(x * 0.55 - 0.1, 0.45, 1.5), hr * 0.17);
        P.box("brow", H(0, 0.88, 0.55), [hr * 1.08, hr * 0.12, hr * 1.08]);
      } else {
        P.box("head", H(0, 0.1, 0.7), [hr * 0.95, hr * 0.85, hr * 0.9]);
        P.cap("head.core", H(-0.1, 0.1, 0.7), H(0.1, 0.1, 0.7), hr * 0.85);
        P.ball("eye.lamp", H(0, 0.15, 1.55), hr * 0.5);
        P.box("brow", H(0, 0.98, 0.85), [hr * 1.05, hr * 0.14, hr * 1.0]);
      }

      // Hardpoints.
      const side = (x: number, y: number, z: number): V3 => add(hc, [x * hw, y * hh, z * hd]);
      if (weapon === "cannon") { P.box("hand.mount", side(1.08, 0.2, 0.55), [0.06 * S, 0.06 * S, 0.1 * S]); P.cap("forearm.gun", side(1.08, 0.25, 0.7), side(1.08, 0.3, 1.9), 0.045 * S); }
      if (weapon === "twin") for (const x of [-1, 1]) { P.box(`hand.mount${x}`, side(x * 1.06, 0.2, 0.55), [0.05 * S, 0.05 * S, 0.09 * S]); P.cap(`forearm.gun${x}`, side(x * 1.06, 0.25, 0.7), side(x * 1.06, 0.25, 1.55), 0.03 * S); }
      if (weapon === "mortar") { P.box("hand.mount", [hc[0], roof + 0.03 * S, hc[2] - hd * 0.3], [0.09 * S, 0.04 * S, 0.09 * S]); P.cap("forearm.mortar", [hc[0], roof + 0.06 * S, hc[2] - hd * 0.35], [hc[0], roof + 0.2 * S, hc[2] - hd * 0.1], 0.065 * S); }
      if (weapon === "launcher") { const pc: V3 = [hc[0] + hw * 0.4, roof + 0.07 * S, hc[2] - hd * 0.15]; P.box("pack", pc, [0.1 * S, 0.07 * S, 0.14 * S]); P.box("forearm.cells", add(pc, [0, 0, 0.14 * S]), [0.075 * S, 0.05 * S, 0.006 * S]); }

      // Armour.
      if (armour === "skirts") for (const x of [-1, 1]) P.box(`hips.skirt${x}`, add(hc, [x * hw * 1.04, -hh * 0.9, 0]), [0.015 * S, hh * 0.6, hd * 0.92]);
      if (armour === "plates") for (const k of ["FL", "FR", "HL", "HR"]) { const x = k[1] === "L" ? -1 : 1; P.box(`hips.plate${k}`, add(B.P(`upper.${k}`), [x * legR * 1.6, 0.02 * S, 0]), [legR * 0.9, 0.08 * S, legR * 2.4]); }

      // Legs: a hip joint, the two bones, a knee, a flat pad.
      for (const k of ["FL", "FR", "HL", "HR"]) {
        const x = k[1] === "L" ? -1 : 1;
        const hip = B.P(`upper.${k}`);
        P.ball(`upper.${k}hip`, hip, legR * 1.55);
        P.cap(`upper.${k}strut`, add(hip, [-x * legR * 2, 0.02 * S, 0]), hip, legR * 1.1);
        P.cap(`upper.${k}`, hip, B.P(`lower.${k}`), legR * 1.15);
        P.cap(`lower.${k}`, B.P(`lower.${k}`), B.P(`paw.${k}`), legR);
        P.ball(`lower.${k}knee`, B.P(`lower.${k}`), legR * 1.3);
        const f = B.P(`paw.${k}`);
        P.box(`paw.${k}`, [f[0], Math.max(0.03 * S, f[1] - body.ankleH + 0.03 * S), f[2] + 0.02 * S], [legR * 1.5, 0.03 * S, 0.08 * S]);
      }
    };

    return {
      spec,
      roles: { body: "fur", head: "furAlt", neck: "dark", eye: "eye", brow: "dark", nose: "dark", collar: "accent", hand: "furAlt", forearm: "dark", pack: "furAlt", hips: "furAlt", upper: "dark", lower: "furAlt", paw: "dark" },
      skin,
      sites: {
        head: { bone: "head", at: [0, hr * 0.95, hr * 0.7], size: [2 * hr, hr, 2 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        crown: { bone: "head", at: [0, hr * 1.2, hr * 0.7], size: [1.6 * hr, 0.6 * hr, 1.6 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        face: { bone: "head", at: [0, hr * 0.3, hr * 1.66], size: [1.8 * hr, 0.9 * hr, 0.6 * hr], out: [0, 0, 1], part: "head", sits: "surface" },
        back: { bone: "spine", at: [0, 0.1 * S + hh, -hd * 0.4], size: [2 * hw, hh, hd], out: [0, 1, 0], part: "body", sits: "surface" },
        mount: { bone: "spine", at: [0, 0.1 * S + hh, hd * 0.2], size: [hw, hh, hw], out: [0, 1, 0], part: "body", sits: "surface" },
        "hand.R": { bone: "spine", at: [hw * 1.08, 0.1 * S + hh * 0.25, hd * 0.7], size: [0.1 * S, 0.1 * S, 0.1 * S], out: [0, 0, 1], part: "hand", sits: "around" },
      },
    };
  },
};
