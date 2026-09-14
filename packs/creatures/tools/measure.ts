// The roster's numbers at the game's view: pairwise silhouette IoU between the
// plans (feet aligned, centred), each plan against itself at twice the size,
// the team colour's share, and portrait distances.
//
//   node packs/creatures/tools/measure.ts [seeds=6] [size=1.6]

import { lookOf } from "@keel-engine/core";
import type { LookRoles } from "@keel-engine/core";
import { bodyShape, createLookTable, createPortraits, headOf, paintSlots, portraitDistance, portraitMask, softBake, softMask } from "@keel-engine/bake";
import type { BodyShape, PortraitSubject } from "@keel-engine/bake";
import { CREATURE_PLANS, creatureOf } from "../src/index.ts";
import type { CreaturePlan } from "../src/index.ts";

const args: Record<string, string> = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=") as [string, string]));
const SEEDS = Number(args["seeds"] ?? 6), SIZE = Number(args["size"] ?? 1.6);
const VIEW = { pixelsPerMetre: 12, pitch: (55 * Math.PI) / 180 };
const CLIPS = [{ name: "idle", frames: 4 }, { name: "walk", frames: 6 }, { name: "attack", frames: 8 }];

export const shapeOf = (seed: string, plan: CreaturePlan, size: number, pins: Record<string, unknown> = {}): BodyShape => {
  const c = creatureOf(seed, plan, { size, pins });
  return bodyShape(c.spec, { pack: "packs/creatures", clips: CLIPS, skin: (s) => c.skin(s), sockets: c.sockets });
};

/** A silhouette as a set of (x, y) cells, its bottom row at y = 0 and its bbox centred on x = 0. */
function cells(b: BodyShape): Set<string> {
  const m = softMask(b, "idle", 0, VIEW);
  if (args["anchor"] !== undefined) {
    const out = new Set<string>();
    for (let y = 0; y < m.h; y += 1) for (let x = 0; x < m.w; x += 1) if (m.solid[y * m.w + x]) out.add(`${x - m.ax},${m.ay - y}`);
    return out;
  }
  let x0 = m.w, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y += 1) for (let x = 0; x < m.w; x += 1) if (m.solid[y * m.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = Math.floor((x0 + x1) / 2);
  const out = new Set<string>();
  for (let y = 0; y < m.h; y += 1) for (let x = 0; x < m.w; x += 1) if (m.solid[y * m.w + x]) out.add(`${x - cx},${y1 - y}`);
  return out;
}
const iou = (a: Set<string>, b: Set<string>): number => { let i = 0; for (const k of a) if (b.has(k)) i += 1; return i / (a.size + b.size - i); };

function accentShare(b: BodyShape): number {
  const m = softMask(b, "idle", 0, VIEW);
  const roles = b.slotRoles();
  let n = 0, a = 0;
  for (let i = 0; i < m.w * m.h; i += 1) { const s = m.slots[i]!; if (!s) continue; n += 1; if (roles[s - 1] === "accent") a += 1; }
  return a / n;
}

const pl = CREATURE_PLANS;
let worst = 0, worstPair = "";
const sums: number[][] = pl.map(() => pl.map(() => 0));
const maxes: number[][] = pl.map(() => pl.map(() => 0));
const acc: Record<string, number[]> = {};
const self: Record<string, number[]> = {};
for (let s = 0; s < SEEDS; s += 1) {
  const seed = `m${s}`;
  const sh = pl.map((p) => shapeOf(seed, p, SIZE));
  const cs = sh.map(cells);
  pl.forEach((p, i) => { (acc[p] ??= []).push(accentShare(sh[i]!)); (self[p] ??= []).push(iou(cells(shapeOf(seed, p, 1.2)), cells(shapeOf(seed, p, 2.4)))); });
  for (let i = 0; i < pl.length; i += 1) for (let j = i + 1; j < pl.length; j += 1) {
    const v = iou(cs[i]!, cs[j]!);
    sums[i]![j]! += v / SEEDS; maxes[i]![j] = Math.max(maxes[i]![j]!, v);
    if (v > worst) { worst = v; worstPair = `${pl[i]} vs ${pl[j]} (${seed})`; }
  }
}
console.log(`IoU at size ${SIZE}, ${SEEDS} seeds: worst ${worst.toFixed(3)} ${worstPair}`);
console.log(`${"".padEnd(9)}${pl.map((p) => p.slice(0, 7).padStart(8)).join("")}`);
pl.forEach((p, i) => console.log(`${p.padEnd(9)}${pl.map((_, j) => (j > i ? `${sums[i]![j]!.toFixed(2)}/${maxes[i]![j]!.toFixed(2)}` : "").padStart(8)).join("")}`));
if (args["dims"] !== undefined) for (const p of pl) {
  const out: string[] = [];
  for (let s = 0; s < SEEDS; s += 1) {
    const m = softMask(shapeOf(`m${s}`, p, SIZE), "idle", 0, VIEW);
    let x0 = m.w, x1 = -1, y0 = m.h, y1 = -1, n = 0;
    for (let y = 0; y < m.h; y += 1) for (let x = 0; x < m.w; x += 1) if (m.solid[y * m.w + x]) { n += 1; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // (Where its mass is: the share of its pixels in the lower, middle and upper thirds of its box.)
    const th = [0, 0, 0];
    for (let y = y0; y <= y1; y += 1) for (let x = 0; x < m.w; x += 1) if (m.solid[y * m.w + x]) th[Math.min(2, Math.floor(((y1 - y) / (y1 - y0 + 1)) * 3))]! += 1;
    out.push(`${x1 - x0 + 1}x${y1 - y0 + 1} n${n} ${th.map((t) => Math.round((t / n) * 10)).join("")}`);
  }
  console.log(`${p.padEnd(9)} ${out.join("  ")}`);
}
for (const p of pl) console.log(`${p.padEnd(9)} accent ${acc[p]!.map((x) => (x * 100).toFixed(0)).join(" ")}%   1.2 vs 2.4 IoU max ${Math.max(...self[p]!).toFixed(2)}`);

// Portraits: one look for every plan (a race's), first frames compared.
const roles: LookRoles = { fur: { stuff: "fur" }, furAlt: { stuff: "fur" }, accent: { stuff: "paint" }, dark: { stuff: "dark" }, eye: { stuff: "glow" }, cloth: { stuff: "cloth" }, clothAlt: { stuff: "cloth" }, skin: { stuff: "skin" } };
for (let s = 0; s < Number(args["pseeds"] ?? Math.min(3, SEEDS)); s += 1) {
  const table = createLookTable({ rampLength: 5 });
  const look = lookOf(`race${s}`, roles, { pins: { "eye.finish": "glow", "accent.hue": 20 + s * 110, "accent.chroma": 0.2 } });
  const P = createPortraits(table);
  const sheets = pl.map((p) => {
    const b = shapeOf(`m${s}`, p, SIZE);
    const subject: PortraitSubject = { spec: b, kind: "unit", head: headOf(b), quadruped: b.spec.plan === "quadruped" };
    for (const j of P.need(subject)) P.offer(j, softBake(b, j));
    if (args["heads"] !== undefined) console.log(`${p} head r ${subject.head?.r.toFixed(3)} (${(subject.head!.r / b.height).toFixed(3)} of its height ${b.height.toFixed(2)})`);
    return P.sheet(subject, table.add(paintSlots(look, b.slotRoles())))!;
  });
  let min = Infinity, mp = "";
  const rows: string[] = [];
  for (let i = 0; i < pl.length; i += 1) {
    let r = pl[i]!.padEnd(9);
    for (let j = 0; j < pl.length; j += 1) {
      if (j <= i) { r += "      "; continue; }
      const d = portraitDistance(sheets[i]!.views[0]!.frames[0]!, sheets[j]!.views[0]!.frames[0]!, { a: portraitMask(sheets[i]!), b: portraitMask(sheets[j]!) });
      r += d.toFixed(2).padStart(6);
      if (d < min) { min = d; mp = `${pl[i]} vs ${pl[j]}`; }
    }
    rows.push(r);
  }
  if (args["matrix"] !== undefined) console.log(rows.join("\n"));
  console.log(`portraits m${s}: min distance ${min.toFixed(3)} (${mp}); eyes ${sheets.map((x, i) => `${pl[i]!.slice(0, 4)}:${x.views[0]!.eyes.length}`).join(" ")}`);
  if (args["show"] !== undefined && s === Number(args["show"])) {
    for (let i = 0; i < pl.length; i += 1) {
      const pic = sheets[i]!.views[0]!.frames[0]!;
      const rows: string[] = [];
      for (let y = 0; y < 56; y += 2) { let r = ""; for (let x = 0; x < 60; x += 1) { const c = pic[y * 60 + x]!; if (!c) { r += " "; continue; } const L = ((c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255)) / 3; r += " .:-=+*#%@"[Math.min(9, Math.floor(L / 25.6))]!; } rows.push(r); }
      console.log(`--- ${pl[i]}\n${rows.join("\n")}`);
    }
  }
}
