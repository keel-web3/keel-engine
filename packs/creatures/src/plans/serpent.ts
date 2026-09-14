// SERPENT (quadruped rig, legs never drawn): a legless body on the ground with
// its front RAISED up the neck (raise 0: head down on the ground; 1: reared
// high), a head (a viper's fangs, horns, or blunt), a hood behind it (flared
// in team colour, a crest, or none), spines down the back (a ridge, paired
// spikes, or none) and team bands round the body.
//
// Standing (idle, attack) it lies COILED in a loose ring behind its raised
// neck; moving, it stretches back into an S that travels down it with the gait
// (the rig's tail swing gives the phase). The rig moves the neck and head -- a
// look round, an attack's strike (a strike at the ground stops on it). Every
// lying point rests one body radius up, whatever the rig's hips and shoulders
// do, so it never floats and never sinks.

import { restJoints } from "@keel-engine/entity";
import type { Skeleton } from "@keel-engine/entity";
import { add, bones, lerp, sub } from "../kit.ts";
import type { Pen, V3 } from "../kit.ts";
import type { PlanDef } from "./common.ts";
import { quadBody, quadSpec } from "./common.ts";

export const serpent: PlanDef = {
  rig: "quadruped",
  choices: {
    raise: { range: [0, 1] },
    hood: ["none", "flared", "crest"],
    spines: ["none", "ridge", "spikes"],
    head: ["viper", "horned", "blunt"],
    girth: { range: [0.85, 1.2] },
  },
  build(seed, S, c) {
    const raise = c["raise"] as number, hood = c["hood"] as string, spines = c["spines"] as string, head = c["head"] as string, girth = c["girth"] as number;
    const R = 0.085 * S * girth;
    const hr = 0.085 * S * Math.sqrt(girth);
    const neck = (0.3 + 0.35 * raise) * S;
    const body = quadBody({ sh: R + 0.05 * S, hip: R + 0.05 * S, ankle: 0.03 * S, bodyR: R, legR: 0.02 * S, len: 0.6 * S, w: 0.04 * S, neck, rise: 0.15 + 1.1 * raise, headR: hr, pawR: 0.02 * S, pawLen: 0.03 * S, tail: 0.85 * S, tailRise: 0 });
    const spec = quadSpec(seed, "fox", body);

    const neckRest = restJoints(spec.rig)["neck"]!;
    const rs = [1.0, 1.06, 1.04, 0.96, 0.84, 0.68, 0.5, 0.3].map((k) => k * R);
    const rho = 0.37 * S;

    const skin = (skel: Skeleton, P: Pen): void => {
      const B = bones(skel);
      const rot = skel.pose?.rot ?? {};
      // The rig's tail swing: its phase (moving: the gait's) and a small wave either way.
      const s0 = (rot["tail0"]?.[1] ?? 0) / 0.3, s1 = (rot["tail1"]?.[1] ?? 0) / 0.35;
      const phase = Math.atan2(s0, (s0 * Math.cos(0.7) - s1) / Math.sin(0.7));
      const moving = (skel.pose?.cycle ?? 0) > 0;
      const nb = B.P("neck");
      const base: V3 = [nb[0], 0, neckRest[2] + (nb[2] - neckRest[2]) * 0.5];
      // The lying body, front to back: coiled round behind the neck when it stands, an S trailing back when it moves.
      const pts: V3[] = rs.map((r, i) => {
        if (moving) {
          const z = base[2] - R * 0.4 - i * 0.16 * S;
          return [base[0] + 0.11 * S * Math.sin(phase - i * 0.9) * Math.min(1, i / 2), r, z];
        }
        const th = (i / (rs.length - 1)) * Math.PI * 1.8;
        const rr = rho * (1 - 0.2 * (i / (rs.length - 1))) * (1 + 0.04 * Math.sin(phase + i));
        return [base[0] + Math.sin(th) * rr, r, base[2] - rho + Math.cos(th) * rr];
      });
      for (let i = 0; i < pts.length - 1; i += 1) P.cap(`body.${i}`, pts[i]!, pts[i + 1]!, Math.min(rs[i]!, rs[i + 1]!) + (rs[i]! - rs[i + 1]!) * 0.5);
      // Team bands round it.
      for (let i = 0; i < pts.length - 2; i += 1) P.ball(`collar.${i}`, lerp(pts[i]!, pts[i + 1]!, 0.5), (rs[i]! + rs[i + 1]!) * 0.5 * 1.03);
      // The raised front: from the chest up the neck to the head.
      // (Its head never goes into the ground: a strike at the ground stops on it.)
      const hj0 = B.P("head");
      const headLift = Math.max(0, hr * 1.15 - hj0[1]);
      const hj: V3 = add(hj0, [0, headLift, 0]);
      const front0 = lerp(nb, hj, 0.5);
      const front: V3 = [front0[0], Math.max(front0[1], R), front0[2]];
      const n0: V3 = [pts[0]![0], pts[0]![1], pts[0]![2]];
      const n1: V3 = add(front, [-0.03 * S, 0, 0]);
      P.cap("neck", n0, n1, R * 0.98);
      P.cap("neck.2", n1, hj, R * 0.88);
      P.ball("collar.neck", lerp(n1, hj, 0.35), R * 0.93);
      // Belly scales up the raised front (they show as it rears).
      P.cap("hips.belly", add(lerp(n0, n1, 0.35), B.D("neck", [0, 0, R * 0.35])), add(lerp(n1, hj, 0.7), B.D("neck", [0, 0, R * 0.4])), R * 0.66);

      // The head: long, flat, on the neck's end; its jaw under it; eyes high on its sides.
      const H = (x: number, y: number, z: number): V3 => add(B.W("head", [x * hr, y * hr, z * hr]), [0, headLift, 0]);
      const long = head === "blunt" ? 1.1 : 1.6;
      P.cap("head", H(0, 0.1, 0.1), H(0, 0.05, long), hr * (head === "blunt" ? 1.02 : 0.9));
      P.cap("snout", H(0, -0.45, 0.25), H(0, -0.45, long + 0.1), hr * 0.55);
      for (const [s, x] of [["L", -1], ["R", 1]] as const) {
        P.ball(`eye.${s}`, H(x * 0.62, 0.45, long * 0.55), hr * 0.24);
        P.cap(`brow.${s}`, H(x * 0.55, 0.72, long * 0.35), H(x * 0.45, 0.72, long * 0.75), hr * 0.18);
      }
      if (head === "viper") for (const x of [-1, 1]) P.cap(`nose.${x}`, H(x * 0.3, -0.5, long * 0.9), H(x * 0.3, -1.1, long * 0.85), hr * 0.1);
      if (head === "horned") for (const x of [-1, 1]) P.cap(`antler.${x}`, H(x * 0.5, 0.7, 0.2), H(x * 1.0, 1.6, -0.6), hr * 0.17);

      // The hood.
      if (hood === "flared") for (const x of [-1, 1]) {
        const a = lerp(n1, hj, 0.2), b = lerp(n1, hj, 0.9);
        P.cap(`hood.${x}`, add(a, B.D("neck", [x * R * 1.4, 0, -R * 0.3])), add(b, B.D("neck", [x * R * 1.2, 0, -R * 0.4])), R * 0.55);
        P.cap(`hood.${x}b`, add(a, B.D("neck", [x * R * 0.6, 0, -R * 0.5])), add(b, B.D("neck", [x * R * 0.6, 0, -R * 0.55])), R * 0.6);
      }
      if (hood === "crest") P.cap("hood.crest", H(0, 0.9, 0.2), H(0, 0.6, -1.4), hr * 0.3);

      // Spines down the back.
      if (spines !== "none") for (let i = 0; i < 5; i += 1) {
        const q = lerp(pts[i]!, pts[i + 1]!, 0.5);
        const r = Math.min(rs[i]!, rs[i + 1]!);
        const d = sub(pts[i + 1]!, pts[i]!);
        const back: V3 = [d[0] * 0.18, 0, d[2] * 0.18];
        if (spines === "ridge") P.cap(`hips.${i}`, add(q, [0, r * 0.7, 0]), add(add(q, [0, r * 1.45, 0]), back), r * 0.2);
        else for (const x of [-1, 1]) P.cap(`hips.${i}${x}`, add(q, [x * r * 0.5, r * 0.6, 0]), add(add(q, [x * r * 0.95, r * 1.4, 0]), back), r * 0.16);
      }
    };

    return {
      spec,
      roles: { body: "fur", neck: "fur", collar: "accent", hips: "furAlt", head: "fur", snout: "furAlt", eye: "eye", brow: "furAlt", nose: "dark", antler: "dark", hood: "accent" },
      skin,
      sites: {
        head: { bone: "head", at: [0, hr * 1.0, hr * 0.8], size: [2 * hr, hr, 2 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        crown: { bone: "head", at: [0, hr * 1.3, hr * 0.6], size: [1.6 * hr, 0.6 * hr, 1.6 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        face: { bone: "head", at: [0, hr * 0.2, hr * 1.9], size: [1.6 * hr, 0.8 * hr, 0.6 * hr], out: [0, 0, 1], part: "head", sits: "surface" },
        back: { bone: "spine", at: [0, R * 1.0 - body.shoulderH + R, 0], size: [2 * R, R, 0.4 * body.bodyLen], out: [0, 1, 0], part: "body", sits: "surface" },
        mount: { bone: "neck", at: [0, 0, -R * 0.6], size: [1.6 * R, 1.6 * R, R], out: [0, 0, -1], part: "neck", sits: "surface" },
      },
    };
  },
};
