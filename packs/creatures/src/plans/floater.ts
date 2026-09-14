// FLOATER (humanoid rig): a thing that hovers -- nothing of it touches the
// ground. A bell, a robe or a lantern of a body, its dome the head (a single
// great eye or a cluster), a crown over it (a ring, spikes, floating orbs, or
// none), and 3-8 tentacles or tassels trailing under it.
//
// It rides a person's rig without drawing a limb of it: the whole body is
// lifted a quarter of its height (LIFT) and bobs with the rig's breathing and
// steps (the hips' rise and fall, magnified); each tentacle sways and trails
// with one of the rig's four limbs (thighs and upper arms in turn), so a walk
// sets them streaming back and an attack lashes them.

import { restJoints } from "@keel-engine/entity";
import type { Skeleton } from "@keel-engine/entity";
import { add, bones, clamp, sub, v } from "../kit.ts";
import type { Pen, V3 } from "../kit.ts";
import type { PlanDef } from "./common.ts";
import { humanBody, humanSpec } from "./common.ts";
import { dcos, dlen, dsin } from "@keel-engine/core";

/** How far a floater hovers: a share of its own height. */
export const FLOATER_LIFT = 0.25;

export const floater: PlanDef = {
  rig: "humanoid",
  choices: {
    body: ["bell", "robe", "lantern"],
    tentacles: [3, 4, 5, 6, 7, 8],
    crown: ["none", "ring", "spikes", "orbs"],
    eyes: ["single", "cluster"],
    trail: { range: [0.85, 1.2] },
  },
  weights: { tentacles: [1, 2, 2, 2, 1, 1], crown: [2, 1, 1, 1] },
  build(seed, S, c) {
    const kind = c["body"] as string, n = c["tentacles"] as number, crown = c["crown"] as string, eyes = c["eyes"] as string, trail = c["trail"] as number;
    const body = humanBody(S * 0.8, { hip: 0.45, ankle: 0.05, headR: 0.1, torsoR: 0.14, neck: 0.03, hipW: 0.08, shoulderW: 0.16, arm: 0.3, legR: 0.03, armR: 0.028, footLen: 0.12 });
    const spec = humanSpec(seed, body);
    const rest = restJoints(spec.rig);
    // The body's size: a dome and the rim under it.
    const dr = (kind === "robe" ? 0.16 : kind === "lantern" ? 0.18 : 0.22) * S;
    const lift = FLOATER_LIFT * S;
    // Where the dome sits (the whole thing is drawn from the chest joint, at rest ~0.62 of the rig's height).
    const domeY = 0.66 * S - dr;
    const restChest = rest["chest"]!;

    const skin = (skel: Skeleton, P: Pen): void => {
      const B = bones(skel);
      // The bob: the hips' rise and fall from their rest, magnified (never down onto the ground).
      const bob = clamp((B.P("hips")[1] - rest["hips"]![1]) * 5, -0.06 * S, 0.06 * S);
      const sway = clamp((B.P("chest")[0] - restChest[0]) * 3, -0.05 * S, 0.05 * S);
      P.offset = [sway, lift + bob, 0];
      const ch = B.P("chest");
      const base: V3 = [ch[0] - sway, 0, ch[2]]; // (its column: under the chest, without the sway P.offset adds)
      const D = (x: number, y: number, z: number): V3 => [base[0] + x * dr, domeY + y * dr, base[2] + z * dr];

      let rimY: number, rimR: number;
      if (kind === "bell") {
        P.ball("head", D(0, 0, 0), dr);
        rimY = domeY - dr * 0.5; rimR = dr * 1.08;
        for (let i = 0; i < 10; i += 1) { const a = (i / 10) * Math.PI * 2; P.ball(`chest.${i}`, [base[0] + dcos(a) * rimR, rimY, base[2] + dsin(a) * rimR], dr * 0.28); }
      } else if (kind === "robe") {
        P.ball("head", D(0, 0, 0), dr);
        P.cap("hood", D(0, 0.2, -0.25), D(0, -0.8, -0.55), dr * 1.08);
        P.cap("chest", D(0, -0.9, 0), D(0, -1.8, -0.1), dr * 1.1);
        // (The robe flares to a wide hem: five lobes round it.)
        for (let i = 0; i < 5; i += 1) { const a = (i / 5) * Math.PI * 2 + Math.PI / 2; P.ball(`chest.hem${i}`, D(dcos(a) * 1.25, -2.15, -0.1 + dsin(a) * 1.25), dr * 0.72); }
        P.cap("collar.stripe", D(0, -0.95, 1.12), D(0, -1.95, 1.12), dr * 0.22);
        P.cap("collar.stripe2", D(0, -2.05, 1.95), D(0, -2.4, 2.05), dr * 0.26);
        rimY = domeY - dr * 2.4; rimR = dr * 2.0;
      } else {
        P.ball("head", D(0, 0.15, 0), dr * 0.92);
        P.box("chest", D(0, -0.55, 0), [dr * 1.45, dr * 0.12, dr * 1.45]);
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) P.cap(`collar.bar${x}${z}`, D(x * 1.15, -0.6, z * 1.15), D(x * 1.15, -1.7, z * 1.15), dr * 0.14);
        P.ball("eye.core", D(0, -1.15, 0), dr * 0.7);
        P.box("chest.base", D(0, -1.8, 0), [dr * 1.45, dr * 0.14, dr * 1.45]);
        rimY = domeY - dr * 1.8; rimR = dr * 1.55;
      }
      // The team band round the rim.
      for (let i = 0; i < 12; i += 1) { const a = (i / 12) * Math.PI * 2; P.ball(`collar.${i}`, [base[0] + dcos(a) * rimR * 1.02, rimY + dr * 0.05, base[2] + dsin(a) * rimR * 1.02], dr * (kind === "lantern" ? 0.16 : 0.2)); }

      // The eyes on the dome's front.
      const ey = kind === "lantern" ? 0.3 : 0.05;
      if (eyes === "single") {
        P.ball("eye", D(0, ey, 0.82), dr * 0.36);
        P.cap("brow", D(-0.5, ey + 0.45, 0.72), D(0.5, ey + 0.45, 0.72), dr * 0.16);
      } else {
        for (const [x, y, r] of [[-0.42, ey + 0.12, 0.2], [0.42, ey + 0.12, 0.2], [0, ey - 0.2, 0.24], [-0.2, ey + 0.52, 0.13], [0.2, ey + 0.52, 0.13]] as const) P.ball(`eye.${x}${y}`, D(x, y, Math.sqrt(Math.max(0, 1 - x * x - (y - 0.1) ** 2)) * 0.9), dr * r);
      }

      // The crown.
      const topY = kind === "lantern" ? 1.1 : 1.0;
      if (crown === "ring") for (let i = 0; i < 8; i += 1) { const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2; P.cap(`hair.${i}`, D(dcos(a0) * 0.62, topY + 0.28, dsin(a0) * 0.62), D(dcos(a1) * 0.62, topY + 0.28, dsin(a1) * 0.62), dr * 0.08); }
      if (crown === "spikes") for (let i = 0; i < 5; i += 1) { const a = (i / 5) * Math.PI * 2 + Math.PI / 2; P.cap(`hair.${i}`, D(dcos(a) * 0.45, topY - 0.15, dsin(a) * 0.45), D(dcos(a) * 0.62, topY + 0.55, dsin(a) * 0.62), dr * 0.09); }
      if (crown === "orbs") for (let i = 0; i < 3; i += 1) { const a = (i / 3) * Math.PI * 2 + Math.PI / 2; P.ball(`hair.${i}`, D(dcos(a) * 0.55, topY + 0.45 + 0.08 * dsin(bob * 40 + i), dsin(a) * 0.55), dr * 0.14); }

      // Tentacles: from under the rim, three segments each, swaying with one of the rig's limbs.
      const limbs = [["thigh.L", "shin.L"], ["thigh.R", "shin.R"], ["upperArm.L", "forearm.L"], ["upperArm.R", "forearm.R"]] as const;
      // (Never down to the ground: a tip hangs 5/6 of its reach below the rim, and stays 0.16 of the size clear.)
      const reach = Math.min((kind === "robe" ? 0.3 : kind === "lantern" ? 0.3 : 0.36) * S * trail, (rimY - dr * 0.1 + lift - 0.21 * S) / (2.5 / 3));
      const moving = (skel.pose?.cycle ?? 0) > 0 ? 1 : 0;
      for (let i = 0; i < n; i += 1) {
        const a = ((i + 0.5) / n) * Math.PI * 2 + Math.PI / 2;
        const [b0, b1] = limbs[i % 4]!;
        const rest0 = sub(rest[b1]!, rest[b0]!);
        const now = sub(B.P(b1), B.P(b0));
        const l = dlen(rest0) || 1;
        // (How far the limb has swung from its rest, as a sideways and a forward lean.)
        const sx = clamp((now[0] - rest0[0]) / l, -0.8, 0.8), sz = clamp((now[2] - rest0[2]) / l, -0.9, 0.9);
        const r0 = rimR * 0.78;
        let p: V3 = [base[0] + dcos(a) * r0, rimY - dr * 0.1, base[2] + dsin(a) * r0];
        const seg = reach / 3;
        const rad = [0.075, 0.06, 0.045];
        for (let j = 0; j < 3; j += 1) {
          const k = (j + 1) / 3;
          const q = add(p, v(dcos(a) * seg * 0.8 + sx * seg * 0.9 * k, -seg * (1 - 0.25 * k), dsin(a) * seg * 0.8 + sz * seg * 1.1 * k - moving * seg * 0.35 * k));
          P.cap(j < 2 ? `${j === 0 ? "thigh" : "shin"}.${i}` : `foot.${i}`, p, q, rad[j]! * S * (kind === "robe" ? 0.8 : 1));
          p = q;
        }
      }
    };

    const dome: V3 = [0, domeY + lift, 0];
    const chestAt = (p: V3): V3 => [p[0] - restChest[0], p[1] - restChest[1], p[2] - restChest[2]];
    return {
      spec,
      roles: { head: "furAlt", hood: "fur", chest: "fur", eye: "eye", brow: "dark", collar: "accent", hair: "accent", thigh: "fur", shin: "fur", foot: "accent" },
      skin,
      sites: {
        head: { bone: "chest", at: chestAt([0, dome[1] + dr, 0]), size: [2 * dr, dr, 2 * dr], out: [0, 1, 0], part: "head", sits: "surface" },
        crown: { bone: "chest", at: chestAt([0, dome[1] + dr * 1.3, 0]), size: [1.4 * dr, 0.6 * dr, 1.4 * dr], out: [0, 1, 0], part: "head", sits: "surface" },
        face: { bone: "chest", at: chestAt([0, dome[1], dr * 0.95]), size: [1.8 * dr, 0.9 * dr, 0.6 * dr], out: [0, 0, 1], part: "head", sits: "surface" },
        back: { bone: "chest", at: chestAt([0, dome[1] - dr * 0.2, -dr]), size: [2 * dr, 1.4 * dr, dr], out: [0, 0, -1], part: "head", sits: "surface" },
        mount: { bone: "chest", at: chestAt([0, dome[1] - dr * 1.1, dr * 0.9]), size: [dr, dr, dr], out: [0, 0, 1], part: "chest", sits: "surface" },
      },
    };
  },
};
