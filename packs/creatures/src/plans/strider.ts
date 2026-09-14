// STRIDER (humanoid rig): a two-legged walker, tall on thin bird legs and
// top-heavy -- a hull (a pod, a box or a keeled box) where a person's chest
// is, a sensor head low on its front (a lens, a slit or a lens with a dish), and
// either gun pods on its arms, blades, or one long barrel over the top.
//
// Its legs bend BACK at the knee (digitigrade): the rig's knee is mirrored
// through the hip-ankle line, so the leg keeps the rig's bone lengths and the
// rig's footfalls, and a long three-toed foot runs forward from a high ankle.
// Its arms' swing (walk, attack) is taken down to a third, so gun pods pitch and
// recoil rather than windmill.

import type { Skeleton } from "@keel-engine/entity";
import { add, bones, clamp, lerp, scale, sub, unit } from "../kit.ts";
import type { Pen, V3 } from "../kit.ts";
import type { PlanDef } from "./common.ts";
import { humanBody, humanSpec } from "./common.ts";

export const strider: PlanDef = {
  rig: "humanoid",
  choices: {
    hull: ["pod", "box", "keel"],
    head: ["lens", "twin", "dish"],
    weapon: ["guns", "barrel", "blades"],
    feet: ["talon", "pad"],
    legs: { range: [0.95, 1.1] },
  },
  build(seed, S, c) {
    const legs = c["legs"] as number;
    const hull = c["hull"] as string, head = c["head"] as string, weapon = c["weapon"] as string, feet = c["feet"] as string;
    const H = S * 1.1;
    const body = humanBody(H, { hip: 0.64 * legs, ankle: 0.1, headR: 0.06, torsoR: 0.12, neck: 0.02, hipW: 0.12, shoulderW: 0.2, arm: 0.26, legR: 0.024, armR: 0.03, footLen: 0.16 });
    const spec = humanSpec(seed, body);
    const hw = 0.26 * S, hh = 0.1 * S, hd = 0.17 * S, hr = 0.07 * S;
    const legR = 0.024 * S;
    const bone = 0.62 * (body.hipH - body.ankleH);

    const skin = (skel: Skeleton, P: Pen): void => {
      const B = bones(skel);
      // The hull, over the spine and chest.
      const hc = lerp(B.P("spine"), B.W("chest", [0, 0.05 * S, 0]), 0.6);
      if (hull === "pod") {
        for (const x of [-1, 1]) P.cap(`chest.${x}`, add(hc, [x * hw * 0.42, 0, -hd * 0.3]), add(hc, [x * hw * 0.42, 0, hd * 0.35]), hh * 1.15);
      } else if (hull === "box") P.box("chest", hc, [hw, hh, hd]);
      else {
        P.box("chest", hc, [hw * 0.92, hh, hd]);
        P.box("chest.keel", add(hc, [0, -hh * 1.25, 0]), [hw * 0.3, hh * 0.45, hd * 0.8]);
        P.box("chest.ridge", add(hc, [0, hh * 1.2, -hd * 0.1]), [hw * 0.18, hh * 0.3, hd * 0.85]);
      }
      const roof = hc[1] + (hull === "pod" ? hh * 1.15 : hh);
      // Team colour: a band across the hull's front and two stripes over its roof.
      if (hull === "pod") for (const x of [-1, 1]) {
        P.cap(`collar.${x}`, add(hc, [x * hw * 0.42, 0, hd * 0.02]), add(hc, [x * hw * 0.42, 0, hd * 0.16]), hh * 1.18);
        P.cap(`collar.top${x}`, add(hc, [x * hw * 0.42, hh * 0.88, -hd * 0.35]), add(hc, [x * hw * 0.42, hh * 0.88, hd * 0.35]), hh * 0.42);
      }
      else {
        P.box("collar.band", add(hc, [0, -hh * 0.2, hd]), [hw * 0.8, hh * 0.3, 0.012 * S]);
        for (const x of [-1, 1]) P.box(`collar.stripe${x}`, add(hc, [x * hw * 0.52, hh, 0]), [hw * 0.14, 0.012 * S, hd * 0.95]);
      }
      P.cap("hips", B.P("hips"), add(hc, [0, -hh * 0.6, 0]), 0.07 * S);

      // The sensor head, up on the hull's front on a short neck.
      const hp = add(hc, [0, hh + hr * 0.85, hd * 0.55]);
      P.cap("neck", add(hc, [0, hh * 0.5, hd * 0.4]), hp, hr * 0.45);
      if (head === "lens") {
        P.ball("head", hp, hr);
        P.ball("eye", add(hp, [0, 0.05 * hr, hr * 0.85]), hr * 0.45);
        P.cap("brow", add(hp, [-hr * 0.8, hr * 0.7, hr * 0.3]), add(hp, [hr * 0.8, hr * 0.7, hr * 0.3]), hr * 0.25);
      } else if (head === "twin") {
        P.cap("head", add(hp, [-hr * 0.45, 0, 0]), add(hp, [hr * 0.45, 0, 0]), hr * 0.8);
        for (const x of [-1, 1]) P.ball(`eye.${x}`, add(hp, [x * hr * 0.5, 0.05 * hr, hr * 0.7]), hr * 0.32);
        P.cap("brow", add(hp, [-hr * 1.1, hr * 0.55, hr * 0.2]), add(hp, [hr * 1.1, hr * 0.55, hr * 0.2]), hr * 0.2);
      } else {
        P.ball("head", hp, hr * 0.95);
        P.ball("eye", add(hp, [0, 0, hr * 0.8]), hr * 0.36);
        P.cap("ear.mast", add(hp, [hr * 0.6, hr * 0.5, -hr * 0.3]), add(hp, [hr * 0.9, hr * 1.5, -hr * 0.5]), hr * 0.12);
        P.cap("ear.dish", add(hp, [hr * 0.35, hr * 1.9, -hr * 0.45]), add(hp, [hr * 1.45, hr * 1.9, -hr * 0.55]), hr * 0.42);
      }

      // Weapons, out on the hull's sides (a strider is widest at the top): gun pods, blade arms, or a long barrel
      // over the roof with a missile rack either side.
      for (const [s, x] of [["L", -1], ["R", 1]] as const) {
        // The arm's swing forward (radians, in the chest's frame), damped.
        const d = B.into("chest", sub(B.P(`forearm.${s}`), B.P(`upperArm.${s}`)));
        const swing = clamp(Math.atan2(d[2], -d[1]) * 0.33, -0.35, 0.6);
        const sh = add(hc, [x * (hw + 0.03 * S), 0, hd * 0.1]);
        const fwd: V3 = [0, Math.sin(swing), Math.cos(swing)];
        P.ball(`upperArm.${s}`, sh, 0.05 * S);
        if (weapon === "guns") {
          const pod = add(sh, [x * 0.1 * S, -0.01 * S, 0]);
          P.cap(`upperArm.${s}strut`, sh, pod, 0.03 * S);
          P.cap(`forearm.${s}`, add(pod, scale(fwd, -0.12 * S)), add(pod, scale(fwd, 0.14 * S)), 0.062 * S);
          P.cap(`hand.${s}`, add(pod, scale(fwd, 0.14 * S)), add(pod, scale(fwd, 0.36 * S)), 0.022 * S);
        } else if (weapon === "blades") {
          const elbow = add(sh, [x * 0.16 * S, 0.02 * S, 0.04 * S]);
          const tip = add(elbow, [x * 0.06 * S, -0.16 * S + 0.2 * S * Math.max(0, swing), 0.26 * S]);
          P.cap(`forearm.${s}`, sh, elbow, 0.035 * S);
          P.cap(`hand.${s}`, elbow, tip, 0.022 * S);
        } else {
          const rack = add(sh, [x * 0.07 * S, 0.02 * S, -0.02 * S]);
          P.box(`forearm.${s}rack`, rack, [0.05 * S, 0.05 * S, 0.1 * S]);
          if (x > 0) {
            P.box("forearm.mount", [hc[0], roof + 0.03 * S, hc[2] - hd * 0.4], [0.05 * S, 0.03 * S, 0.07 * S]);
            P.cap("hand.barrel", [hc[0], roof + 0.05 * S, hc[2] - hd * 0.6], add([hc[0], roof + 0.05 * S, hc[2] - hd * 0.2], scale(fwd, 0.5 * S)), 0.026 * S);
          }
        }
      }

      // Bird legs: the knee bent BACK off the hip-ankle line (thigh and shin each 0.62 of the rest hip-ankle span,
      // so the bend deepens as the rig's step shortens the leg); a long foot forward from the high ankle.
      for (const s of ["L", "R"] as const) {
        const hip = B.P(`thigh.${s}`), ankle = B.P(`foot.${s}`);
        const d = sub(ankle, hip), dl = Math.hypot(...d);
        const bend = Math.sqrt(Math.max(0, bone * bone - (dl / 2) ** 2));
        const backDir = unit(sub(B.D("hips", [0, 0, -1]), scale(unit(d), (B.D("hips", [0, 0, -1])[0] * d[0] + B.D("hips", [0, 0, -1])[1] * d[1] + B.D("hips", [0, 0, -1])[2] * d[2]) / Math.max(1e-9, dl))));
        const knee = add(lerp(hip, ankle, 0.5), backDir, bend);
        P.cap(`thigh.${s}`, hip, knee, legR * 1.5);
        P.ball(`thigh.${s}knee`, knee, legR * 1.7);
        P.cap(`shin.${s}`, knee, ankle, legR);
        const toe = B.W(`foot.${s}`, [0, -(body.ankleH - legR), body.footLen * 0.9]);
        P.cap(`foot.${s}`, ankle, toe, legR * 0.9);
        if (feet === "talon") for (const t of [-1, 1]) P.cap(`foot.${s}${t}`, lerp(ankle, toe, 0.85), add(toe, B.D(`foot.${s}`, [t * body.footLen * 0.35, 0, -body.footLen * 0.15])), legR * 0.6);
        else P.box(`foot.${s}pad`, [toe[0], legR * 0.8, toe[2] - body.footLen * 0.25], [legR * 2.2, legR * 0.8, body.footLen * 0.4]);
        P.cap(`foot.${s}spur`, ankle, B.W(`foot.${s}`, [0, -(body.ankleH - legR), -body.footLen * 0.28]), legR * 0.7);
      }
    };

    // Where the hull sits in the chest bone's frame (the own frame at rest): 60% of the way from the spine joint.
    const y0 = -0.4 * body.torso * 0.3 + 0.6 * 0.05 * S;
    return {
      spec,
      roles: { chest: "furAlt", collar: "accent", hips: "dark", neck: "dark", head: "fur", eye: "eye", brow: "dark", ear: "fur", upperArm: "dark", forearm: "furAlt", hand: "dark", thigh: "furAlt", shin: "dark", foot: "dark" },
      skin,
      sites: {
        head: { bone: "chest", at: [0, y0 + hh + hr * 1.85, hd * 0.55], size: [2 * hr, hr, 2 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        crown: { bone: "chest", at: [0, y0 + hh + hr * 2.1, hd * 0.55], size: [1.6 * hr, 0.6 * hr, 1.6 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        back: { bone: "chest", at: [0, y0, -hd], size: [2 * hw, 2 * hh, 0.1 * S], out: [0, 0, -1], part: "chest", sits: "surface" },
        "hand.R": { bone: "chest", at: [hw + 0.13 * S, y0, hd * 0.1 + 0.2 * S], size: [0.1 * S, 0.1 * S, 0.1 * S], out: [0, 0, 1], part: "hand", sits: "around" },
        mount: { bone: "chest", at: [0, y0 + hh, hd * 0.1], size: [hw, 0.1 * S, hw], out: [0, 1, 0], part: "chest", sits: "surface" },
      },
    };
  },
};
