// CRAWLER (quadruped rig): an arthropod, low and wide. A broad thorax under a
// carapace (smooth, ridged or spiked, a team-coloured rim round it), six legs
// (or eight) arching out wide, a short banded abdomen behind riding the rig's
// tail (it sways a third as far as the tail does), a head with mandibles,
// pincers or tusks, an optional load on its back (a sac, a turret, a pod) and
// horns.
//
// Its legs are its own, drawn from the rig's four paws: each foot is set out
// wide of the body and moved as a paw moves. The rig's diagonals (FL with HR,
// FR with HL -- a trot's pairs) make the two tripods: the front legs keep their
// own paws, every middle leg takes the diagonal pair's motion (the average of
// FL and HR, or of FR and HL) and the hind legs cross over (hind left moves
// with HR, hind right with HL) -- so under a trot L1 R2 L3 lift together and
// R1 L2 R3 together: a tripod gait. (Eight legs alternate the same way.) Under
// the rig's walk the same rule makes a ripple down each side.

import { restJoints } from "@keel-engine/entity";
import type { Skeleton } from "@keel-engine/entity";
import { add, bones, lerp, sub, v } from "../kit.ts";
import type { Pen, V3 } from "../kit.ts";
import type { PlanDef } from "./common.ts";
import { quadBody, quadSpec } from "./common.ts";
import { dcos, dhypot, dlen, dsin } from "@keel-engine/core";

export const crawler: PlanDef = {
  rig: "quadruped",
  choices: {
    legs: [6, 8],
    head: ["mandibles", "pincers", "tusks"],
    carapace: ["smooth", "ridged", "spiked"],
    load: ["none", "sac", "turret", "pod"],
    horn: ["none", "single", "triple"],
    bulk: { range: [0.88, 1.12] },
    span: { range: [0.9, 1.2] },
  },
  weights: { legs: [3, 1], load: [3, 1, 1, 1], horn: [2, 1, 1] },
  build(seed, S, c) {
    const bulk = c["bulk"] as number, span = c["span"] as number;
    const legs = c["legs"] as number;
    const head = c["head"] as string, carapace = c["carapace"] as string, load = c["load"] as string, horn = c["horn"] as string;
    const R = 0.13 * S * bulk; // the thorax's radius
    const hw = 0.15 * S * bulk; // its half-width past that (a broad thorax: a capsule across)
    const hr = 0.11 * S * Math.sqrt(bulk);
    const body = quadBody({ sh: 0.28 * S, hip: 0.27 * S, ankle: 0.04 * S, bodyR: R, legR: 0.03 * S, len: 0.34 * S, w: 0.12 * S, neck: 0.13 * S, rise: 0.55, headR: hr, pawR: 0.03 * S, pawLen: 0.05 * S, tail: 0.4 * S, tailRise: -0.05 });
    const spec = quadSpec(seed, "cat", body);
    const rest = restJoints(spec.rig);
    const legR = 0.026 * S * Math.sqrt(bulk);
    const restTip = add(rest["tail2"]!, spec.rig.bones[spec.rig.index["tail2"]!]!.tip!);

    const skin = (skel: Skeleton, P: Pen): void => {
      const B = bones(skel);
      const th0 = B.W("spine", [0, 0, -0.03 * S]), th1 = B.W("chest", [0, 0.01 * S, 0.02 * S]);
      const mid = lerp(th0, th1, 0.5);
      // The thorax: along the body and across it.
      P.cap("chest", th0, th1, R);
      P.cap("chest.broad", add(mid, [-hw, 0, 0]), add(mid, [hw, 0, 0]), R * 0.92);
      // The head on its neck, in front.
      const hc = B.W("head", [0, 0, hr * 0.5]);
      P.cap("neck", th1, hc, hr * 0.6);
      P.ball("head", hc, hr);
      const H = (x: number, y: number, z: number): V3 => B.W("head", [x * hr, y * hr, hr * 0.5 + z * hr]);
      // Eyes: a big pair on the front's corners, a small pair above them.
      for (const [s, x] of [["L", -1], ["R", 1]] as const) {
        P.ball(`eye.${s}`, H(x * 0.58, 0.28, 0.68), hr * 0.3);
        P.ball(`eye.${s}2`, H(x * 0.26, 0.72, 0.6), hr * 0.15);
      }
      P.cap("brow", H(-0.66, 0.62, 0.3), H(0.66, 0.62, 0.3), hr * 0.22);
      // The mouthparts.
      for (const [s, x] of [["L", -1], ["R", 1]] as const) {
        if (head === "mandibles") {
          P.cap(`nose.${s}`, H(x * 0.55, -0.35, 0.7), H(x * 0.62, -0.42, 1.55), hr * 0.2);
          P.cap(`nose.${s}2`, H(x * 0.62, -0.42, 1.55), H(x * 0.12, -0.42, 2.0), hr * 0.15);
        } else if (head === "pincers") {
          P.cap(`nose.${s}`, H(x * 0.62, -0.3, 0.65), H(x * 1.15, -0.35, 1.5), hr * 0.2);
          P.cap(`nose.${s}2`, H(x * 1.15, -0.35, 1.5), H(x * 0.95, -0.3, 2.3), hr * 0.28);
          P.cap(`nose.${s}3`, H(x * 0.95, -0.3, 2.3), H(x * 0.5, -0.3, 2.75), hr * 0.14);
          P.cap(`nose.${s}4`, H(x * 1.15, -0.3, 2.35), H(x * 1.0, -0.3, 2.9), hr * 0.12);
        } else {
          P.cap(`nose.${s}`, H(x * 0.45, -0.45, 0.75), H(x * 0.7, -0.6, 1.5), hr * 0.24);
          P.cap(`nose.${s}2`, H(x * 0.7, -0.6, 1.5), H(x * 0.62, 0.1, 2.05), hr * 0.15);
        }
      }
      if (horn === "single") P.cap("antler", H(0, 0.85, 0.25), H(0, 2.0, 0.95), hr * 0.18);
      if (horn === "triple") for (const x of [-1, 0, 1]) P.cap(`antler.${x + 1}`, H(x * 0.45, 0.8, 0.25), H(x * 0.9, 1.7, 0.7 - Math.abs(x) * 0.2), hr * 0.13);

      // The abdomen: segments down the tail chain (a third of the tail's sway), a team band between each two.
      const calm = (p: V3, restP: V3): V3 => lerp(B.W("pelvis", sub(restP, rest["pelvis"]!)), p, 0.3);
      const chain = [B.W("pelvis", [0, 0.02 * S, -0.02 * S]), calm(B.P("tail1"), rest["tail1"]!), calm(B.P("tail2"), rest["tail2"]!), calm(B.W("tail2", spec.rig.bones[spec.rig.index["tail2"]!]!.tip!), restTip)];
      const along = (d: number): V3 => {
        for (let i = 0; i < chain.length - 1; i += 1) {
          const l = dlen(sub(chain[i + 1]!, chain[i]!));
          if (d <= l || i === chain.length - 2) return lerp(chain[i]!, chain[i + 1]!, d / Math.max(1e-9, l));
          d -= l;
        }
        return chain[0]!;
      };
      const segR = [1.0, 0.92, 0.66].map((k) => k * R * 1.05);
      const segD: number[] = [R * 0.25];
      for (let i = 1; i < segR.length; i += 1) segD.push(segD[i - 1]! + 0.66 * (segR[i - 1]! + segR[i]!));
      P.cap("body.waist", th0, along(0), R * 0.6);
      segR.forEach((r, i) => P.ball(`body.seg${i}`, along(segD[i]!), r));
      for (let i = 0; i < segR.length - 1; i += 1) P.ball(`collar.band${i}`, along((segD[i]! + segD[i + 1]!) / 2), Math.min(segR[i]!, segR[i + 1]!) * 0.98);
      P.ball("tail.tip", along(segD[segR.length - 1]! + segR[segR.length - 1]! * 0.85), R * 0.24);

      // The carapace over the broad thorax, its rim in team colour.
      const cy = R * 0.45;
      const cap = (x: number, z: number, up = 0): V3 => add(mid, [x * hw, cy + up * R, z * (th1[2] - th0[2]) * 0.5]);
      P.cap("hips", cap(-0.8, 0), cap(0.8, 0), R * 0.82);
      P.cap("hips.2", cap(0, -0.9), cap(0, 0.9), R * 0.8);
      // (Round the shell's widest line, just proud of it: an outline from above.)
      const ex = 0.8 * hw + 0.82 * R, ez = 0.45 * (th1[2] - th0[2]) + 0.8 * R;
      for (let i = 0; i < 14; i += 1) {
        const a = (i / 14) * Math.PI * 2;
        P.ball(`collar.rim${i}`, add(mid, [dsin(a) * ex * 0.96, cy, dcos(a) * ez * 0.96]), R * 0.27);
      }
      if (carapace === "ridged") for (let i = 0; i < 3; i += 1) P.cap(`accessory.ridge${i}`, cap(-0.75, -0.55 + i * 0.55, 0.62), cap(0.75, -0.55 + i * 0.55, 0.62), R * 0.24);
      else if (carapace === "spiked") for (let i = 0; i < 3; i += 1) for (const x of [-1, 1]) { const b = cap(x * 0.55, -0.6 + i * 0.6, 0.55); P.cap(`hips.spike${i}${x}`, b, add(b, [x * R * 0.45, R * 0.95, -R * 0.2]), R * 0.14); }
      else P.cap("accessory.stripe", cap(0, -0.85, 0.72), cap(0, 0.85, 0.72), R * 0.28);

      // Its load.
      const back = along(segD[0]!);
      if (load === "sac") { P.ball("pack", add(back, [0, R * 0.7, -R * 0.1]), R * 0.78); P.ball("collar.sac", add(back, [0, R * 0.92, 0.05 * R]), R * 0.6); }
      if (load === "pod") { P.cap("pack", cap(-0.5, -0.4, 1.0), cap(0.5, -0.4, 1.0), R * 0.42); P.cap("pack.2", cap(0, -1.2, 0.8), cap(0, 0.2, 1.0), R * 0.4); }
      if (load === "turret") {
        const base = cap(0, 0, 1.1);
        P.box("pack", base, [R * 0.6, R * 0.28, R * 0.6]);
        P.cap("forearm.gun", add(base, [0, R * 0.15, 0]), add(base, [0, R * 0.3, R * 2.1]), R * 0.16);
      }

      // Legs: hips round the thorax's sides, feet set out wide, moved as the rig's paws move.
      const paw = (k: string): V3 => sub(B.P(`paw.${k}`), rest[`paw.${k}`]!);
      const diagA = lerp(paw("FL"), paw("HR"), 0.5), diagB = lerp(paw("FR"), paw("HL"), 0.5);
      const pairs = legs === 6
        ? [[0.75, paw("FL"), paw("FR"), 0.3], [0, diagB, diagA, 0.02], [-0.75, paw("HR"), paw("HL"), -0.26]] as const
        : [[0.85, paw("FL"), paw("FR"), 0.32], [0.3, diagB, diagA, 0.12], [-0.3, diagA, diagB, -0.08], [-0.85, paw("HL"), paw("HR"), -0.28]] as const;
      pairs.forEach(([zk, dL, dR, splay], i) => {
        for (const [s, x, d] of [["L", -1, dL], ["R", 1, dR]] as const) {
          const hip = add(mid, [x * (hw + R * 0.55), -R * 0.1, zk * (th1[2] - th0[2]) * 0.55]);
          const foot: V3 = add(v(mid[0] + x * (hw + R + 0.3 * S * span), legR, mid[2] + splay * S), [d[0] * x * 0.5, d[1], d[2]]);
          const knee = add(lerp(hip, foot, 0.4), [x * 0.04 * S * span, 0.15 * S, 0]);
          const k = `M${i}${s}`;
          P.cap(`upper.${k}`, hip, knee, legR * 1.2);
          P.cap(`lower.${k}`, knee, foot, legR * 0.85);
          P.ball(`paw.${k}`, foot, legR * 1.05);
        }
      });
    };

    const tailSeg = spec.rig.bones[spec.rig.index["tail1"]!]!.off;
    return {
      spec,
      roles: { head: "fur", neck: "fur", chest: "fur", body: "fur", eye: "eye", brow: "furAlt", nose: "dark", antler: "furAlt", hips: "furAlt", collar: "accent", accessory: "accent", "tail.tip": "accent", pack: "furAlt", forearm: "dark", upper: "dark", lower: "dark", paw: "dark" },
      skin,
      sites: {
        head: { bone: "head", at: [0, hr, hr * 0.5], size: [2 * hr, hr, 2 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        crown: { bone: "head", at: [0, hr * 1.35, hr * 0.4], size: [1.6 * hr, 0.6 * hr, 1.6 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        face: { bone: "head", at: [0, hr * 0.2, hr * 1.5], size: [1.8 * hr, 0.9 * hr, 0.6 * hr], out: [0, 0, 1], part: "head", sits: "surface" },
        back: { bone: "spine", at: [0, R * 1.5, body.bodyLen * 0.25], size: [2 * (hw + R), R, body.bodyLen], out: [0, 1, 0], part: "hips", sits: "surface" },
        mount: { bone: "spine", at: [0, R * 1.9, body.bodyLen * 0.25], size: [1.2 * R, 0.8 * R, 1.2 * R], out: [0, 1, 0], part: "pack", sits: "surface" },
        tail: { bone: "tail1", at: [0, 0, 0], size: [2.2 * R, 2.2 * R, dhypot(tailSeg[0], tailSeg[1], tailSeg[2])], out: [0, 0, -1], part: "body", sits: "around" },
      },
    };
  },
};
