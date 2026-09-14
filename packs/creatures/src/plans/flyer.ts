// FLYER (quadruped rig): a real flying body -- wings spread wide (bat, bird,
// four insect wings, or a craft's swept blades or ring wing with engine pods),
// a sleek or stout body, a head (a beak, a crest or fangs; a craft has a
// canopy), a long tail, a fan of tail feathers or none. Its legs are tucked
// claws under the belly; the body sits at its own origin (a game draws it at
// altitude).
//
// Its wings FLAP with the rig's fore leg: the upper fore-left bone's swing (in
// the chest's frame) is the flap's phase, so a walk beats them and an attack's
// lunge sweeps them; standing (idle) they glide, rising and falling slowly
// with the rig's breathing. A craft's wings don't beat: they bank a little.

import { restJoints } from "@keel-engine/entity";
import type { Skeleton } from "@keel-engine/entity";
import { add, bones, clamp, lerp, sub } from "../kit.ts";
import type { Pen, V3 } from "../kit.ts";
import type { PlanDef } from "./common.ts";
import { quadBody, quadSpec } from "./common.ts";

export const flyer: PlanDef = {
  rig: "quadruped",
  choices: {
    wings: ["bat", "bird", "insect", "blade", "ring"],
    body: ["sleek", "stout"],
    tail: ["long", "fan", "none"],
    head: ["beak", "crest", "fangs"],
    span: { range: [0.9, 1.2] },
  },
  weights: { wings: [2, 2, 2, 1, 1] },
  build(seed, S, c) {
    const wings = c["wings"] as string, stout = c["body"] === "stout", tail = c["tail"] as string, head = c["head"] as string, span = c["span"] as number;
    const craft = wings === "blade" || wings === "ring";
    const R = (stout ? 0.13 : 0.095) * S;
    const hr = (stout ? 0.1 : 0.085) * S;
    const body = quadBody({ sh: R + 0.07 * S, hip: R + 0.06 * S, ankle: 0.03 * S, bodyR: R, legR: 0.018 * S, len: (stout ? 0.36 : 0.44) * S, w: 0.05 * S, neck: 0.12 * S, rise: 0.3, headR: hr, pawR: 0.02 * S, pawLen: 0.04 * S, tail: 0.5 * S, tailRise: 0.08 });
    const spec = quadSpec(seed, "fox", body);
    const rest = restJoints(spec.rig);
    const L = 0.78 * S * span; // one wing's span

    const skin = (skel: Skeleton, P: Pen): void => {
      const B = bones(skel);
      // The flap: the fore leg's swing in the chest's frame (walk: its stride; attack: the lunge); idle: a slow glide.
      const d = B.into("chest", sub(B.P("lower.FL"), B.P("upper.FL")));
      const swing = Math.atan2(d[2], -d[1]);
      const breath = (B.P("pelvis")[1] - rest["pelvis"]![1]) / Math.max(1e-6, body.bodyR * 0.02);
      const moving = Math.abs(swing) > 0.02;
      // (The downstroke stops a little under level: the body sits at its origin, so its wings never dip below it.)
      const el = craft ? 0.05 + 0.06 * clamp(swing, -1, 1) : moving ? clamp(0.3 + 1.5 * swing, -0.1, 1.05) : 0.18 + 0.12 * clamp(breath + 1.5, -1, 1);

      // The body and head.
      const b0 = B.W("pelvis", [0, 0, -0.02 * S]), b1 = B.W("chest", [0, 0, 0.03 * S]);
      P.cap("body", b0, b1, R);
      P.cap("hips", lerp(b0, b1, 0.1), add(lerp(b0, b1, 0.85), [0, -R * 0.35, 0]), R * 0.72);
      const hc = B.W("head", [0, 0, hr * 0.6]);
      P.cap("neck", b1, hc, hr * 0.7);
      const H = (x: number, y: number, z: number): V3 => B.W("head", [x * hr, y * hr, hr * 0.6 + z * hr]);
      if (craft) {
        P.cap("head", H(0, 0, -0.4), H(0, -0.1, 0.9), hr);
        P.cap("eye.canopy", H(0, 0.55, -0.1), H(0, 0.45, 0.75), hr * 0.55);
        P.cap("snout", H(0, -0.15, 0.9), H(0, -0.2, 1.8), hr * 0.45);
      } else {
        P.ball("head", H(0, 0, 0), hr);
        for (const [s, x] of [["L", -1], ["R", 1]] as const) P.ball(`eye.${s}`, H(x * 0.55, 0.28, 0.72), hr * 0.24);
        if (head === "beak") { P.cap("snout", H(0, -0.05, 0.7), H(0, -0.35, 1.9), hr * 0.32); P.ball("snout.tip", H(0, -0.45, 1.95), hr * 0.2); }
        if (head === "crest") { P.cap("snout", H(0, -0.1, 0.7), H(0, -0.25, 1.45), hr * 0.3); P.cap("brow.crest", H(0, 0.8, 0.2), H(0, 1.5, -1.2), hr * 0.22); P.cap("brow.crest2", H(0, 0.6, -0.2), H(0, 0.9, -1.5), hr * 0.18); }
        if (head === "fangs") { P.cap("snout", H(0, -0.2, 0.6), H(0, -0.25, 1.2), hr * 0.42); for (const x of [-1, 1]) P.cap(`nose.${x}`, H(x * 0.25, -0.45, 1.2), H(x * 0.22, -0.95, 1.25), hr * 0.1); }
        P.cap("brow", H(-0.6, 0.6, 0.55), H(0.6, 0.6, 0.55), hr * 0.14);
      }

      // Wings, from the shoulders: a span axis raised by the flap, the chord running back.
      const tipBack = craft ? 0.28 : 0.1;
      for (const [s, x] of [["L", -1], ["R", 1]] as const) {
        const root = B.W("chest", [x * R * 0.7, R * 0.35, -0.02 * S]);
        const e: V3 = [x * Math.cos(el), Math.sin(el), 0];
        // A point on the wing: u along the span (0 root .. 1 tip), w along the chord (metres back), swept back toward the tip.
        const at = (u: number, w: number): V3 => add(add(root, e, u * L), [0, 0, -w - u * u * tipBack * S]);
        if (wings === "bat") {
          P.cap(`upperArm.${s}`, at(0, 0), at(0.42, -0.02 * S), 0.03 * S);
          P.cap(`forearm.${s}`, at(0.42, -0.02 * S), at(0.72, 0.0), 0.024 * S);
          const tips = [[1.0, 0.04], [0.9, 0.24], [0.7, 0.36], [0.45, 0.36]] as const;
          tips.forEach(([u, w], i) => P.cap(`hand.${s}f${i}`, at(0.72, 0), at(u, w * S), 0.014 * S));
          // The membrane: strips between the fingers, the second one in team colour.
          for (let i = 0; i < 4; i += 1) { const [u, w] = tips[i]!; const part = i === 1 ? `collar.${s}m${i}` : `chest.${s}m${i}`; P.cap(part, at(0.1 + i * 0.05, 0.05 * S + i * 0.045 * S), at(u * 0.93, w * S * 0.82), 0.05 * S); }
        } else if (wings === "bird") {
          P.cap(`upperArm.${s}`, at(0, 0), at(0.5, 0), 0.045 * S);
          P.cap(`forearm.${s}`, at(0.5, 0), at(0.92, 0.02 * S), 0.03 * S);
          for (let i = 0; i < 7; i += 1) { const u = 0.12 + i * 0.13; const len = (0.16 + 0.1 * Math.sin((i / 6) * Math.PI)) * S; P.cap(i % 3 === 2 ? `collar.${s}f${i}` : `chest.${s}f${i}`, at(u, 0.02 * S), at(Math.min(1.05, u + 0.07), len), 0.034 * S); }
        } else if (wings === "insect") {
          for (const [k, w0, lenK] of [[0, 0, 1], [1, 0.09, 0.8]] as const) {
            const wl = lenK * L;
            const a = add(root, [0, 0.01 * S, -w0 * S]);
            const e2: V3 = [x * Math.cos(el * (k ? 0.7 : 1)), Math.sin(el * (k ? 0.7 : 1)), -0.35 - k * 0.45];
            const n2 = Math.hypot(...e2);
            const pt = (t: number): V3 => add(a, [e2[0] / n2 * wl * t, e2[1] / n2 * wl * t, e2[2] / n2 * wl * t]);
            P.cap(`chest.${s}w${k}`, pt(0.08), pt(0.95), 0.065 * S);
            P.cap(`chest.${s}w${k}b`, pt(0.3), pt(0.8), 0.085 * S);
            P.cap(`collar.${s}v${k}`, pt(0.55), pt(0.7), 0.087 * S);
            P.cap(`upperArm.${s}${k}`, pt(0), pt(0.97), 0.016 * S);
          }
        } else if (wings === "blade") {
          P.cap(`upperArm.${s}`, at(0, 0), at(1, 0.02 * S), 0.03 * S);
          P.cap(`chest.${s}b`, at(0.05, 0.08 * S), at(0.85, 0.08 * S), 0.05 * S);
          P.cap(`collar.${s}`, at(0.6, 0.02 * S), at(0.8, 0.04 * S), 0.045 * S);
          const pod = at(0.55, 0.02 * S);
          P.cap(`forearm.${s}pod`, add(pod, [0, -0.04 * S, 0.12 * S]), add(pod, [0, -0.04 * S, -0.16 * S]), 0.05 * S);
          P.ball(`collar.${s}pod`, add(pod, [0, -0.04 * S, 0.0]), 0.054 * S);
          P.ball(`paw.${s}nozzle`, add(pod, [0, -0.04 * S, -0.19 * S]), 0.035 * S);
        } else {
          // (A ring wing: one hoop round the body, drawn once.)
          if (x > 0) {
            const rc = B.W("spine", [0, R * 0.2, -0.02 * S]), rr = 0.36 * S * span;
            const pts: V3[] = [];
            for (let i = 0; i <= 14; i += 1) { const a = (i / 14) * Math.PI * 2; pts.push(add(rc, [Math.cos(a) * rr * 1.25, Math.sin(a) * rr * 0.55 + (Math.cos(a) * el * 0.3) * rr, 0])); }
            for (let i = 0; i < 14; i += 1) P.cap(i % 3 === 1 ? `collar.r${i}` : `chest.r${i}`, pts[i]!, pts[i + 1]!, 0.045 * S);
            for (const xx of [-1, 1]) {
              const pod: V3 = add(rc, [xx * rr * 1.25, -0.01 * S, 0]);
              P.cap(`forearm.pod${xx}`, add(pod, [0, 0, 0.14 * S]), add(pod, [0, 0, -0.18 * S]), 0.06 * S);
              P.ball(`collar.pod${xx}`, add(pod, [0, 0, 0.02 * S]), 0.064 * S);
              P.ball(`paw.nozzle${xx}`, add(pod, [0, 0, -0.21 * S]), 0.04 * S);
            }
            P.cap("upperArm.strut", add(rc, [-rr * 1.2, 0, 0]), add(rc, [rr * 1.2, 0, 0]), 0.022 * S);
          }
        }
      }

      // The tail.
      const tipBone = spec.rig.bones[spec.rig.index["tail2"]!]!.tip!;
      const t0 = B.P("tail0"), t1 = B.P("tail1"), t2 = B.P("tail2"), tt = B.W("tail2", tipBone);
      if (tail === "long") { P.cap("tail", t0, t1, R * 0.45); P.cap("tail.mid", t1, t2, R * 0.33); P.cap("tail.m2", t2, tt, R * 0.22); P.ball("tail.tip", tt, R * 0.42); }
      if (tail === "fan") { P.cap("tail", t0, t1, R * 0.5); for (let i = -2; i <= 2; i += 1) { const e2 = add(t1, [i * 0.07 * S, 0.01 * S, -0.22 * S + Math.abs(i) * 0.025 * S]); P.cap(i === 0 ? "tail.tip" : `tail.f${i}`, t1, e2, 0.035 * S); } }
      if (tail === "none") P.ball("tail", t0, R * 0.5);

      // Claws tucked under the belly.
      for (const k of ["FL", "FR", "HL", "HR"]) {
        const x = k[1] === "L" ? -1 : 1;
        const top = add(B.P(`upper.${k}`), [x * 0.01 * S, -R * 0.4, 0]);
        P.cap(`lower.${k}`, top, add(top, [x * 0.01 * S, -0.05 * S, (k[0] === "F" ? -0.03 : -0.06) * S]), 0.018 * S);
      }
    };

    return {
      spec,
      roles: { body: "fur", hips: "furAlt", neck: "fur", head: "fur", eye: "eye", snout: "furAlt", nose: "dark", brow: "accent", upperArm: "dark", forearm: craft ? "furAlt" : "dark", hand: "dark", chest: "furAlt", collar: "accent", paw: "dark", tail: "fur", "tail.tip": "accent", lower: "dark" },
      skin,
      sites: {
        head: { bone: "head", at: [0, hr * 0.9, hr * 0.6], size: [2 * hr, hr, 2 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        crown: { bone: "head", at: [0, hr * 1.2, hr * 0.5], size: [1.6 * hr, 0.6 * hr, 1.6 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        face: { bone: "head", at: [0, hr * 0.28, hr * 1.5], size: [1.8 * hr, 0.9 * hr, 0.6 * hr], out: [0, 0, 1], part: "head", sits: "surface" },
        back: { bone: "chest", at: [0, R, -body.bodyLen * 0.3], size: [1.6 * R, R, 0.5 * body.bodyLen], out: [0, 1, 0], part: "body", sits: "surface" },
        mount: { bone: "chest", at: [0, -R, -body.bodyLen * 0.2], size: [1.4 * R, R, 0.5 * body.bodyLen], out: [0, -1, 0], part: "hips", sits: "surface" },
      },
    };
  },
};
