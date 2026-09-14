// RIDER (quadruped rig): a mount -- keel/entity's own animal for the rig's
// species (deer, bear, dog, cat or fox, at a war-beast's size), skinned by
// keel/entity and recoloured through this plan's roles -- with a small seated
// rider on its back: a torso, a head under a helm, a hood, a crest or horns,
// arms (the left on the reins), legs down its flanks, and something held:
// a lance, a banner, a rifle, a staff or nothing. Saddle, caparison or barding.
//
// The rider is built in the mount's chest frame, so it rides every step; the
// attack's lunge (the neck's pitch) drives the rider's thrust.
//
// The PORTRAIT rule: only the rider's head uses the head-core part names
// (head, eye, brow) -- the mount's head, snout, eyes and nose are renamed
// ("body.head", "foot.eye.L"...) -- so a portrait frames the rider.

import { entityOf, skinOf } from "@keel-engine/entity";
import type { QuadrupedSpec, Skeleton, Species } from "@keel-engine/entity";
import { add, bones, clamp, lerp, mix } from "../kit.ts";
import type { Pen, V3 } from "../kit.ts";
import type { PlanDef } from "./common.ts";
import { dcos, dsin } from "@keel-engine/core";

// The mount's parts, renamed into this plan's groups: its head is body, its eyes and nose dark (foot), its ears tail.
const MOUNT_PART: Readonly<Record<string, string>> = { body: "body", chest: "body.chest", neck: "neck", head: "body.head", snout: "body.snout", nose: "foot.nose", eye: "foot.eye", ear: "tail.ear", innerEar: "tail.inner", antler: "paw.antler", collar: "hips.collar", upper: "upper", lower: "lower", paw: "paw", tail: "tail" };
const mountPart = (part: string): string => {
  if (part === "tail.tip") return "tail.tip";
  const [g, ...rest] = part.split(".");
  const to = MOUNT_PART[g!] ?? "body";
  return rest.length ? `${to}.${rest.join(".")}` : to;
};

export const rider: PlanDef = {
  rig: "quadruped",
  choices: {
    mount: ["deer", "bear", "dog", "cat", "fox"],
    helm: ["helm", "hood", "crest", "horns"],
    held: ["lance", "banner", "rifle", "staff", "none"],
    saddle: ["saddle", "caparison", "barding"],
    rider: { range: [0.9, 1.1] },
  },
  weights: { held: [3, 2, 2, 2, 1] },
  build(seed, S, c) {
    const species = c["mount"] as Species, helm = c["helm"] as string, held = c["held"] as string, saddle = c["saddle"] as string;
    const rk = (c["rider"] as number) * S;
    // The mount at a war-beast's size, its species' own proportions from this seed: its back at about 0.62 of the
    // size (the rider sits on it, its head near the top).
    const girthOf = { deer: 0.22, bear: 0.42, dog: 0.28, cat: 0.3, fox: 0.25 }[species as "deer"];
    const mountOf = (sh: number) => entityOf(`${seed}|mount`, { kind: "animal", species, size: sh, pins: { accessory: "none", antlers: species === "deer" } }) as QuadrupedSpec;
    let spec = mountOf((0.62 * S) / (1 + girthOf));
    // (A beast whose head -- antlers and all -- would tower over the size class is made smaller.)
    const tall = spec.body.H + (spec.features.antlers ? spec.body.headR * 2.3 : 0);
    if (tall > 1.05 * S) spec = mountOf(((0.62 * S) / (1 + girthOf)) * ((1.05 * S) / tall));
    const B0 = spec.body;
    const rise = (B0.shoulderH - B0.hipH) * 0.5;
    // The seat, in the chest bone's frame: the back socket's spot (mid-body, on top), a little forward.
    const seat: V3 = [0, B0.bodyR - rise - 0.01 * S, -B0.bodyLen * 0.42];
    const hr = 0.062 * rk, tr = 0.062 * rk;

    const skin = (skel: Skeleton, P: Pen): void => {
      const B = bones(skel);
      // The mount: keel/entity's skin, renamed.
      for (const k of skinOf(spec, skel)) P.cap(mountPart(k.part), k.a, k.b, k.r);
      const R = (x: number, y: number, z: number): V3 => B.W("chest", [seat[0] + x, seat[1] + y, seat[2] + z]);
      // The attack's thrust: the neck pitching down into the lunge.
      const neck = skel.pose?.rot?.["neck"]?.[0] ?? 0;
      const thrust = clamp((neck + 0.05) * 2.2, -0.4, 1);

      // Saddle and barding.
      const bw = B0.bodyR;
      // (The back's top line, withers to croup, a little proud of the body: where a cloth lies.)
      const croup = B.W("pelvis", [0, B0.bodyR * 0.3, -B0.bodyR * 0.1]), withers = B.W("chest", [0, B0.bodyR * 0.3, -B0.bodyR * 0.1]);
      if (saddle === "saddle") {
        // A saddle on a team-coloured cloth, the cloth down both flanks.
        P.cap("pack", lerp(croup, withers, 0.12), lerp(croup, withers, 0.62), B0.bodyR * 0.8);
        P.cap("hips.cantle", R(-bw * 0.4, 0.03 * rk, -0.06 * rk), R(bw * 0.4, 0.03 * rk, -0.06 * rk), 0.03 * rk);
        for (const x of [-1, 1]) P.cap(`pack.flap${x}`, R(x * bw * 0.82, -bw * 0.2, -bw * 0.1), R(x * bw * 0.98, -bw * 0.78, -bw * 0.15), bw * 0.34);
      } else if (saddle === "caparison") {
        // A caparison: the cloth over the whole back, skirts down the flanks.
        P.cap("pack", lerp(croup, withers, 0), lerp(croup, withers, 0.95), B0.bodyR * 0.74);
        for (const x of [-1, 1]) for (const t of [0.1, 0.5, 0.9]) { const q = lerp(croup, withers, t); P.cap(`pack.drape${x}${t}`, add(q, B.D("chest", [x * bw * 0.72, -bw * 0.2, 0])), add(q, B.D("chest", [x * bw * 0.95, -bw * 1.0, 0])), bw * 0.2); }
      } else {
        P.cap("pack", lerp(croup, withers, 0.08), lerp(croup, withers, 0.62), B0.bodyR * 0.8);
        P.cap("hips.crinet", B.P("neck"), B.W("neck", [0, B0.headR * 0.4, B0.neckLen * 0.4]), Math.min(B0.bodyR * 0.62, B0.headR * 0.82));
        P.ball("hips.peytral", B.W("chest", [0, -B0.bodyR * 0.02, B0.bodyR * 0.3]), B0.bodyR * 1.1);
        P.cap("hips.chanfron", B.W("head", [0, B0.headR * 0.95, B0.headR * 0.35]), B.W("head", [0, B0.headR * 0.55, B0.headR * 1.35]), B0.headR * 0.32);
        P.cap("collar.trim", B.W("chest", [-B0.bodyR * 0.9, B0.bodyR * 0.4, B0.bodyR * 0.55]), B.W("chest", [B0.bodyR * 0.9, B0.bodyR * 0.4, B0.bodyR * 0.55]), B0.bodyR * 0.2);
        P.cap("collar.crest", B.W("neck", [0, Math.min(B0.bodyR * 0.62, B0.headR * 0.82) * 0.8, 0]), B.W("neck", [0, B0.headR * 0.4 + Math.min(B0.bodyR * 0.62, B0.headR * 0.82) * 0.8, B0.neckLen * 0.4]), B0.headR * 0.22);
        for (const x of [-1, 1]) P.cap(`pack.side${x}`, R(x * bw * 0.85, -bw * 0.1, -bw * 0.5), R(x * bw * 0.95, -bw * 0.7, -bw * 0.55), bw * 0.3);
      }

      // The rider: legs down the flanks, a torso leaning a touch forward, the head.
      for (const [s, x] of [["L", -1], ["R", 1]] as const) {
        const hip = R(x * 0.05 * rk, 0.02 * rk, 0);
        const knee = R(x * (bw + 0.02 * rk), -0.05 * rk, 0.07 * rk);
        const ankle = R(x * (bw * 0.92 + 0.02 * rk), -0.2 * rk, 0.02 * rk);
        P.cap(`thigh.${s}`, hip, knee, 0.042 * rk);
        P.cap(`shin.${s}`, knee, ankle, 0.034 * rk);
        P.cap(`foot.${s}`, ankle, add(ankle, B.D("chest", [0, -0.01 * rk, 0.06 * rk])), 0.032 * rk);
      }
      const lean = 0.05 * rk + 0.05 * rk * thrust;
      const waist = R(0, 0.05 * rk, 0), shoulders = R(0, 0.22 * rk, lean);
      // The tunic in team colour, belted.
      P.cap("chest", waist, shoulders, tr);
      P.cap("hips.belt", R(-tr * 0.5, 0.07 * rk, lean * 0.3), R(tr * 0.5, 0.07 * rk, lean * 0.3), tr * 0.62);
      const hc = R(0, 0.3 * rk, lean * 1.25 + 0.01 * rk);
      P.ball("head", hc, hr);
      const Hd = (x: number, y: number, z: number): V3 => add(hc, B.D("chest", [x * hr, y * hr, z * hr]));
      for (const [s, x] of [["L", -1], ["R", 1]] as const) P.ball(`eye.${s}`, Hd(x * 0.38, 0.05, 0.9), hr * 0.17);
      if (helm === "helm" || helm === "crest" || helm === "horns") {
        P.cap("hood", Hd(0, 0.35, -0.1), Hd(0, 0.3, 0.05), hr * 1.02);
        P.cap("brow", Hd(-0.9, 0.35, 0.45), Hd(0.9, 0.35, 0.45), hr * 0.22);
        if (helm === "crest") P.cap("hair", Hd(0, 1.2, 0.5), Hd(0, 1.05, -1.2), hr * 0.26);
        if (helm === "horns") for (const x of [-1, 1]) P.cap(`hair.${x}`, Hd(x * 0.75, 0.75, 0), Hd(x * 1.35, 1.5, -0.35), hr * 0.17);
      } else {
        P.cap("hood", Hd(0, 0.3, -0.25), Hd(0, -0.9, -0.75), hr * 1.08);
        P.cap("brow", Hd(-0.75, 0.62, 0.52), Hd(0.75, 0.62, 0.52), hr * 0.2);
      }
      // Arms: the left down to the reins, the right to what it holds.
      const shL = R(-tr * 1.1, 0.2 * rk, lean), shR = R(tr * 1.1, 0.2 * rk, lean);
      const reins = B.W("neck", [0, B0.bodyR * 0.3, 0]);
      const elL = lerp(shL, reins, 0.45);
      P.cap("upperArm.L", shL, add(elL, [0, -0.03 * rk, 0]), 0.03 * rk);
      P.cap("forearm.L", add(elL, [0, -0.03 * rk, 0]), lerp(shL, reins, 0.85), 0.027 * rk);
      P.ball("hand.L", lerp(shL, reins, 0.87), 0.03 * rk);
      const handR = R(tr * 1.6, 0.12 * rk + 0.05 * rk * thrust, lean + 0.1 * rk + 0.12 * rk * thrust);
      const elR = R(tr * 1.9, 0.12 * rk, lean - 0.02 * rk);
      P.cap("upperArm.R", shR, elR, 0.03 * rk);
      P.cap("forearm.R", elR, handR, 0.027 * rk);
      P.ball("hand.R", handR, 0.03 * rk);
      // What it holds.
      const F = (x: number, y: number, z: number): V3 => add(handR, B.D("chest", [x, y, z]));
      if (held === "lance") {
        const tilt = mix(0.5, 0.12, clamp(thrust, 0, 1));
        const dir: V3 = [0, dsin(tilt), dcos(tilt)];
        P.cap("accessory", F(-dir[0] * 0.25 * rk, -dir[1] * 0.25 * rk, -dir[2] * 0.25 * rk), F(0, dir[1] * 0.85 * rk, dir[2] * 0.85 * rk), 0.017 * rk);
        P.cap("collar.pennant", F(0, dir[1] * 0.55 * rk + 0.02 * rk, dir[2] * 0.55 * rk), F(0.0, dir[1] * 0.72 * rk + 0.05 * rk, dir[2] * 0.72 * rk - 0.08 * rk), 0.04 * rk);
      } else if (held === "banner") {
        const top = F(0.0, 0.42 * rk, -0.06 * rk);
        P.cap("accessory", F(0, -0.12 * rk, 0), top, 0.016 * rk);
        for (let i = 0; i < 3; i += 1) P.cap(`collar.flag${i}`, add(top, B.D("chest", [0.02 * rk, -0.05 * rk - i * 0.075 * rk, -0.03 * rk])), add(top, B.D("chest", [0.02 * rk, -0.05 * rk - i * 0.075 * rk, -0.25 * rk + i * 0.02 * rk])), 0.04 * rk);
      } else if (held === "rifle") {
        P.cap("accessory", F(0, -0.02 * rk, -0.14 * rk), F(0, 0.02 * rk + 0.03 * rk * thrust, 0.32 * rk), 0.022 * rk);
        P.cap("collar.stock", F(0, -0.04 * rk, -0.2 * rk), F(0, -0.02 * rk, -0.08 * rk), 0.032 * rk);
      } else if (held === "staff") {
        const top = F(0.02 * rk, 0.34 * rk + 0.1 * rk * thrust, 0.05 * rk + 0.1 * rk * thrust);
        P.cap("accessory", F(0, -0.2 * rk, -0.02 * rk), top, 0.018 * rk);
        P.ball("collar.orb", add(top, [0, 0.03 * rk, 0]), 0.055 * rk);
      }
    };

    const at = (x: number, y: number, z: number): V3 => [seat[0] + x, seat[1] + y, seat[2] + z];
    return {
      spec,
      roles: {
        body: "fur", neck: "fur", upper: "fur", lower: "fur", paw: "furAlt", tail: "fur", "tail.tip": "furAlt", foot: "dark", hips: "furAlt",
        pack: "accent", collar: "accent", chest: "accent", upperArm: "cloth", forearm: "cloth", hand: "skin", thigh: "clothAlt", shin: "clothAlt",
        head: "skin", eye: "eye", hood: "clothAlt", brow: "clothAlt", hair: "accent", accessory: "dark",
      },
      skin,
      sites: {
        head: { bone: "chest", at: at(0, 0.3 * rk + hr * 1.3, 0.06 * rk), size: [2 * hr, hr, 2 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        crown: { bone: "chest", at: at(0, 0.3 * rk + hr * 1.6, 0.06 * rk), size: [1.6 * hr, 0.6 * hr, 1.6 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
        face: { bone: "chest", at: at(0, 0.3 * rk, 0.06 * rk + hr), size: [1.8 * hr, 0.9 * hr, 0.6 * hr], out: [0, 0, 1], part: "head", sits: "surface" },
        back: { bone: "chest", at: at(0, 0.16 * rk, 0.05 * rk - tr), size: [2 * tr, 0.18 * rk, 1.5 * tr], out: [0, 0, -1], part: "chest", sits: "surface" },
        "hand.R": { bone: "chest", at: at(tr * 1.6, 0.12 * rk, 0.15 * rk), size: [0.06 * rk, 0.06 * rk, 0.06 * rk], out: [0, -1, 0], part: "hand.R", sits: "around" },
        mount: { bone: "chest", at: [0, B0.bodyR - rise, -B0.bodyLen / 2], size: [1.8 * B0.bodyR, B0.bodyR, 0.6 * B0.bodyLen], out: [0, 1, 0], part: "body", sits: "surface" },
      },
    };
  },
};
