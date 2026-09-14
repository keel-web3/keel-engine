// Procedural voxel things from a seed -- what "the user doesn't do much"
// means: ask for a critter and get a rig-ready creature with its groups,
// variation rules and a suggested look; ask for a banner and get one that
// waves. Every generator draws from its own seeded stream, builds with the
// editor's brush ops under x symmetry (so it is as symmetric as a person
// would make it), names its groups, and says where its joints truly are (the
// auto-rig is scored against that).
//
//   generate("critter", "7")          -> { model, rules, animation?, colours, truth }
//   generate("critter", "7", { plan: "humanoid" })
//   generate("banner", "3").animation  -> a wave on the cloth
//
// Kinds: critter (four legs or two), crate, banner, tree, lamp, windmill.

import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { Plan } from "@keel-engine/entity";
import type { Stream } from "@keel-engine/runtime";
import type { ObjectAnimation } from "./animate.ts";
import { createEditor } from "./edit.ts";
import type { Oklch } from "./look.ts";
import type { VariationRules } from "./variation.ts";
import { createVoxels } from "./voxels.ts";
import type { V3, VoxelModel } from "./voxels.ts";

export type GeneratorKind = "critter" | "crate" | "banner" | "tree" | "lamp" | "windmill";
export const GENERATOR_KINDS: readonly GeneratorKind[] = ["critter", "crate", "banner", "tree", "lamp", "windmill"];

export interface Generated {
  readonly kind: GeneratorKind;
  readonly seed: string;
  readonly model: VoxelModel;
  /** Seeded variation this base supports. */
  readonly rules: VariationRules;
  /** Clips for things that move by themselves (a banner's wave, a lamp's flicker). */
  readonly animation?: ObjectAnimation;
  /** A suggested look: OKLCH per role. */
  readonly colours: Readonly<Record<string, Oklch>>;
  /** Critters: the body it was built as, and where its joints truly are (voxel coordinates). */
  readonly truth?: { readonly plan: Plan; readonly joints: Readonly<Record<string, V3>> };
  /** What the model is for (object, entity, attribute), for the op list and export. */
  readonly target: "object" | "entity";
}

export interface GenerateOptions {
  /** Critters: four legs or two (default: drawn). */
  readonly plan?: Plan;
  /** Metres per voxel (default by kind). */
  readonly unit?: number;
}

const streamOf = (seed: string, kind: string): Stream => stream(createRoll(deriveSeed(deriveSeed(String(seed), "builder"), kind)), 0);
const hueRole = (S: Stream, L: number, C: number): Oklch => [L, C, Math.round(S.between(0, 360))];

// (A box of voxels on both sides of the x = 0 mirror: x from -hx to hx - 1.)
type Ed = ReturnType<typeof createEditor>;
const mbox = (ed: Ed, hx0: number, hx1: number, y0: number, y1: number, z0: number, z1: number, role: string | null): void => {
  // hx0..hx1 on the +x side (0-based), mirrored by the editor's symmetry
  ed.box([hx0, y0, z0], [hx1, y1, z1], role);
};
const group = (m: VoxelModel, name: string, from: V3, to: V3): void => {
  const rs = m.groups.get(name) ?? [];
  rs.push({ min: [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])], max: [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])] });
  m.groups.set(name, rs);
};

function quadCritter(S: Stream, m: VoxelModel): Generated["truth"] {
  const ed = createEditor(m, { symmetry: { mode: "x", center: [0, 0] } });
  const hw = S.int(2, 4);           // body half-width
  const L = S.int(4, 7) * 2;        // body length (even)
  const bh = S.int(4, 6);           // body height
  const legH = S.int(3, 7);
  const lw = S.pick([2, 3]);        // leg width in cells
  const hs = S.int(2, 3) * 2;       // head size
  const neck = S.pick([0, 0, 1, 2, 3]);
  const tail = S.pick([0, 3, 4, 5, 6]);
  const ears = S.pick(["none", "point", "long", "round"]);
  const horns = S.chance(0.3);
  const zF = L / 2 - 1, zB = -L / 2;
  const y0 = legH, y1 = legH + bh - 1;
  // Legs: four columns at the body's corners.
  const lx0 = Math.max(0, hw - lw), lx1 = hw - 1;
  mbox(ed, lx0, lx1, 0, legH - 1, zF - lw + 1, zF, "primary");
  mbox(ed, lx0, lx1, 0, legH - 1, zB, zB + lw - 1, "primary");
  // Paws: dark soles.
  mbox(ed, lx0, lx1, 0, 0, zF - lw + 1, zF, "dark");
  mbox(ed, lx0, lx1, 0, 0, zB, zB + lw - 1, "dark");
  // Body, belly.
  mbox(ed, 0, hw - 1, y0, y1, zB, zF, "primary");
  mbox(ed, 0, Math.max(0, hw - 2), y0, y0, zB + 1, zF - 1, "secondary");
  // Neck and head, ahead and above.
  const hy0 = y1 - Math.floor(hs / 2) + 1 + neck, hy1 = hy0 + hs - 1;
  const hz0 = zF + 1 + neck, hz1 = hz0 + hs - 1;
  if (neck) mbox(ed, 0, Math.max(0, Math.floor(hs / 2) - 2), y1 - 1, hy0 + 1, zF + 1, hz0, "primary");
  mbox(ed, 0, hs / 2 - 1, hy0, hy1, hz0, hz1, "skin");
  // Snout, eyes, nose.
  mbox(ed, 0, Math.max(0, hs / 2 - 2), hy0, hy0 + 1, hz1 + 1, hz1 + 1 + (hs > 4 ? 1 : 0), "skin");
  ed.set([Math.max(1, hs / 2 - 2), hy1 - 1, hz1], "dark");
  ed.set([0, hy0 + 1, hz1 + 1 + (hs > 4 ? 1 : 0)], "dark");
  // Ears, horns.
  if (ears !== "none") {
    const ex = Math.max(1, hs / 2 - 2);
    const eh = ears === "long" ? 3 : ears === "round" ? 1 : 2;
    mbox(ed, ex, ex + (ears === "round" ? 1 : 0), hy1 + 1, hy1 + eh, hz0 + 1, hz0 + 1, "trim");
  }
  if (horns) ed.line([Math.max(1, hs / 2 - 1), hy1 + 1, hz0 + 2], [hs / 2, hy1 + 3, hz0 + 1], "trim");
  // Tail: a line up and back from the rump.
  if (tail) ed.line([0, y1, zB - 1], [0, y1 + Math.round(tail * 0.6), zB - tail], "secondary");
  // Groups.
  group(m, "head", [-hs / 2, hy0, hz0], [hs / 2 - 1, hy1 + 4, hz1 + 2]);
  if (ears !== "none") group(m, "ears", [-hs / 2, hy1 + 1, hz0], [hs / 2 - 1, hy1 + 3, hz0 + 2]);
  if (horns) group(m, "horns", [-hs / 2, hy1 + 1, hz0], [hs / 2, hy1 + 4, hz0 + 3]);
  if (tail) group(m, "tail", [-1, y1, zB - tail], [0, y1 + tail, zB - 1]);
  for (const zs of [[zF - lw + 1, zF], [zB, zB + lw - 1]] as const) for (const sx of [-1, 1]) {
    const xa = sx > 0 ? lx0 : -lx1 - 1, xb = sx > 0 ? lx1 : -lx0 - 1;
    group(m, "legs", [xa, 0, zs[0]], [xb, legH - 1, zs[1]]);
  }
  // Truth: the body's middle over each leg pair, the legs' columns.
  const bodyMid = y0 + bh / 2;
  const legX = (lx0 + lx1 + 1) / 2;
  const zFc = zF - lw / 2 + 1, zHc = zB + lw / 2;
  return {
    plan: "quadruped",
    joints: {
      pelvis: [0, bodyMid, zHc], chest: [0, bodyMid, zFc],
      "upper.FL": [-legX, bodyMid, zFc], "upper.FR": [legX, bodyMid, zFc], "upper.HL": [-legX, bodyMid, zHc], "upper.HR": [legX, bodyMid, zHc],
    },
  };
}

function bipedCritter(S: Stream, m: VoxelModel): Generated["truth"] {
  const ed = createEditor(m, { symmetry: { mode: "x", center: [0, 0] } });
  const lw = S.pick([1, 2]);        // leg width (cells) on each side
  const gap = S.pick([1, 1, 2]);     // half the gap between legs... cells from the middle to the leg
  const legH = S.int(4, 8);
  const hw = Math.max(gap + lw, S.int(2, 4)); // torso half-width
  const th = S.int(5, 8);            // torso height
  const d = S.pick([2, 3, 4]);       // depth (z) of legs and torso
  const aw = S.pick([1, 2]);         // arm width
  const armLen = Math.min(th + 1, S.int(4, 8));
  const armGap = S.pick([0, 1]);
  const hs = S.int(2, 4) * 2;        // head size
  const neck = S.pick([0, 1]);
  const ears = S.pick(["none", "point", "long"]);
  const tail = S.pick([0, 0, 3, 4]);
  const z0 = -Math.floor(d / 2), z1 = z0 + d - 1;
  // Legs with a gap, boots dark.
  mbox(ed, gap - 1 + 1, gap + lw - 1, 0, legH - 1, z0, z1, "secondary");
  mbox(ed, gap, gap + lw - 1, 0, 0, z0, z1 + 1, "dark");
  // Torso and belt.
  const ty0 = legH, ty1 = legH + th - 1;
  mbox(ed, 0, hw - 1, ty0, ty1, z0, z1, "primary");
  mbox(ed, 0, hw - 1, ty0, ty0, z0, z1, "trim");
  // Arms beside it.
  const ax0 = hw + armGap, ax1 = ax0 + aw - 1;
  mbox(ed, ax0, ax1, ty1 - armLen + 1, ty1, z0 + (d > 2 ? 1 : 0), z1 - (d > 3 ? 1 : 0), "primary");
  mbox(ed, ax0, ax1, ty1 - armLen + 1, ty1 - armLen + 1, z0 + (d > 2 ? 1 : 0), z1 - (d > 3 ? 1 : 0), "skin");
  if (armGap) mbox(ed, hw, ax0 - 1, ty1, ty1, z0 + (d > 2 ? 1 : 0), z1 - (d > 3 ? 1 : 0), "primary");
  // Neck, head, face.
  const hy0 = ty1 + 1 + neck, hy1 = hy0 + hs - 1;
  if (neck) mbox(ed, 0, Math.max(0, Math.floor(hs / 4) - 1), ty1 + 1, ty1 + 1, z0, z1, "skin");
  const hz0 = -hs / 2, hz1 = hs / 2 - 1;
  mbox(ed, 0, hs / 2 - 1, hy0, hy1, hz0, hz1, "skin");
  ed.set([Math.max(1, hs / 2 - 2), hy0 + Math.floor(hs / 2), hz1], "dark");
  mbox(ed, 0, hs / 2 - 1, hy1, hy1, hz0, hz1, "accent");
  if (ears !== "none") mbox(ed, Math.max(1, hs / 2 - 2), hs / 2 - 1, hy1 + 1, hy1 + (ears === "long" ? 3 : 1), 0, 0, "trim");
  if (tail) ed.line([0, ty0 + 1, z0 - 1], [0, ty0 + 1 + Math.round(tail / 2), z0 - tail], "secondary");
  group(m, "head", [-hs / 2, hy0, hz0], [hs / 2 - 1, hy1 + 3, hz1]);
  if (ears !== "none") group(m, "ears", [-hs / 2, hy1 + 1, hz0], [hs / 2 - 1, hy1 + 3, hz1]);
  group(m, "legs", [-(gap + lw), 0, z0], [gap + lw - 1, legH - 1, z1 + 1]);
  group(m, "arms", [ax0, ty1 - armLen + 1, z0], [ax1, ty1, z1]);
  group(m, "arms", [-ax1 - 1, ty1 - armLen + 1, z0], [-ax0 - 1, ty1, z1]);
  if (tail) group(m, "tail", [-1, ty0, z0 - tail], [0, ty0 + tail, z0 - 1]);
  const legX = gap + lw / 2;
  const armX = ax0 + aw / 2;
  const cz = (z0 + z1 + 1) / 2;
  return {
    plan: "humanoid",
    joints: {
      hips: [0, legH, cz], "thigh.L": [-legX, legH, cz], "thigh.R": [legX, legH, cz],
      "upperArm.L": [-armX, ty1 + 1 - aw / 2, cz], "upperArm.R": [armX, ty1 + 1 - aw / 2, cz],
      neck: [0, ty1 + 1, 0], head: [0, hy0, 0],
    },
  };
}

function crate(S: Stream, m: VoxelModel): void {
  const ed = createEditor(m, { symmetry: { mode: "x", center: [0, 0] } });
  const hw = S.int(3, 6), h = S.int(6, 12), d = S.int(3, 6) * 2;
  const z0 = -d / 2, z1 = d / 2 - 1;
  mbox(ed, 0, hw - 1, 0, h - 1, z0, z1, "primary");
  // Planks: darker seams every few rows.
  const every = S.pick([2, 3, 4]);
  for (let y = every; y < h - 1; y += every) { mbox(ed, 0, hw - 1, y, y, z0, z0, "secondary"); mbox(ed, 0, hw - 1, y, y, z1, z1, "secondary"); }
  // Trim on every edge.
  for (const y of [0, h - 1]) { mbox(ed, 0, hw - 1, y, y, z0, z0, "trim"); mbox(ed, 0, hw - 1, y, y, z1, z1, "trim"); mbox(ed, hw - 1, hw - 1, y, y, z0, z1, "trim"); }
  mbox(ed, hw - 1, hw - 1, 0, h - 1, z0, z0, "trim"); mbox(ed, hw - 1, hw - 1, 0, h - 1, z1, z1, "trim");
  // A stencilled label on the front, sometimes.
  if (S.chance(0.6)) { ed.symmetry = { mode: "none" }; ed.box([-1, Math.floor(h / 2) - 1, z1 + 1], [0, Math.floor(h / 2), z1 + 1], "accent"); group(m, "label", [-1, 0, z1 + 1], [0, h, z1 + 1]); }
}

function banner(S: Stream, m: VoxelModel): ObjectAnimation {
  const ed = createEditor(m);
  const ph = S.int(20, 28), cw = S.int(10, 16), ch = S.int(7, 10);
  ed.box([0, 0, 0], [0, ph, 0], "trim");
  ed.box([-1, 0, -1], [1, 0, 1], "dark");
  ed.sphere([0.5, ph + 1.5, 0.5], 1.2, "accent");
  const top = ph - 1;
  ed.box([1, top - ch + 1, 0], [cw, top, 0], "primary");
  // An emblem: a stripe, a chevron or a disc.
  const kind = S.pick(["stripe", "chevron", "disc"]);
  if (kind === "stripe") ed.box([1, top - Math.floor(ch / 2), 0], [cw, top - Math.floor(ch / 2) + 1, 0], "secondary");
  else if (kind === "chevron") for (let i = 0; i < Math.floor(ch / 2); i += 1) { ed.set([2 + i, top - i, 0], "secondary"); ed.set([2 + i, top - ch + 1 + i, 0], "secondary"); }
  else {
    // (A flat disc in the cloth's plane: the emblem waves with it.)
    const r = Math.min(ch, cw) / 3.2, cx = cw / 2 + 1, cy = top - ch / 2 + 1;
    for (let y = top - ch + 1; y <= top; y += 1) for (let x = 1; x <= cw; x += 1) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) ed.set([x, y, 0], "accent");
  }
  group(m, "cloth", [1, top - ch + 1, 0], [cw, top, 0]);
  const hz = S.pick([0.5, 0.5, 0.75]);
  return { clips: { idle: { period: 1 / hz, frames: 8, motions: [{ kind: "wave", group: "cloth", along: "x", dir: "z", amp: 1.4, hz, pin: "min" }] } } };
}

function tree(S: Stream, m: VoxelModel): ObjectAnimation {
  const ed = createEditor(m);
  const th = S.int(7, 12), tw = S.pick([1, 2]);
  ed.box([0, 0, 0], [tw - 1, th, tw - 1], "primary");
  ed.box([-1, 0, -1], [tw, 0, tw], "primary");
  const c: V3 = [tw / 2, th + S.between(2, 3.5), tw / 2];
  const r = S.between(3.5, 5.5);
  ed.sphere(c, r, "secondary");
  const blobs = S.int(2, 4);
  for (let i = 0; i < blobs; i += 1) {
    const a = S.between(0, Math.PI * 2);
    ed.sphere([c[0] + Math.cos(a) * r * 0.7, c[1] + S.between(-1, 1.5), c[2] + Math.sin(a) * r * 0.7], r * S.between(0.5, 0.75), "secondary");
  }
  if (S.chance(0.5)) for (let i = 0; i < 5; i += 1) ed.set([Math.round(c[0] + S.between(-r, r) * 0.8), Math.round(c[1] + S.between(-r, r) * 0.6), Math.round(c[2] + r * 0.9)], "accent");
  group(m, "canopy", [-12, th + 1, -12], [12, th + 16, 12]);
  return { clips: { idle: { period: 4, frames: 8, motions: [{ kind: "sway", group: "canopy", axis: "z", pivot: [tw / 2, th, tw / 2], amp: 0.06, hz: 0.25 }] } } };
}

function lamp(S: Stream, m: VoxelModel): ObjectAnimation {
  const ed = createEditor(m, { symmetry: { mode: "xz", center: [0, 0] } });
  const h = S.int(12, 20);
  ed.box([0, 0, 0], [1, 0, 1], "dark");
  ed.box([0, 1, 0], [0, h, 0], "dark");
  ed.box([0, h + 1, 0], [1, h + 1, 1], "trim");
  ed.box([0, h + 2, 0], [0, h + 4, 0], "glow");
  ed.box([1, h + 2, 1], [1, h + 4, 1], "trim");
  ed.box([0, h + 5, 0], [1, h + 5, 1], "trim");
  group(m, "light", [-2, h + 1, -2], [1, h + 5, 1]);
  return { clips: { idle: { period: 2, frames: 8, motions: [{ kind: "flicker", group: "light", rate: 6, duty: 0.75, seed: S.int(1, 999) }] } } };
}

function windmill(S: Stream, m: VoxelModel): ObjectAnimation {
  const ed = createEditor(m, { symmetry: { mode: "x", center: [0, 0] } });
  const h = S.int(14, 20), base = S.int(3, 4);
  for (let y = 0; y <= h; y += 1) { const w = Math.max(2, Math.round(base - (y / h) * (base - 2))); mbox(ed, 0, w - 1, y, y, -w, w - 1, "primary"); }
  mbox(ed, 0, 2, h + 1, h + 3, -3, 2, "secondary");
  // A door on the front.
  ed.symmetry = { mode: "none" };
  ed.box([-1, 0, base], [0, 3, base], "dark");
  group(m, "door", [-1, 0, base], [0, 3, base]);
  // The sails: four arms on a hub, in front of the cap.
  const L = S.int(8, 11), hub: V3 = [0, h + 2, 4];
  ed.box([-1, hub[1] - 1, 3], [0, hub[1], 4], "dark");
  ed.box([-1, hub[1] + 1, 4], [0, hub[1] + L, 4], "trim");
  ed.box([-1, hub[1] - L - 1, 4], [0, hub[1] - 2, 4], "trim");
  ed.box([1, hub[1] - 1, 4], [L, hub[1], 4], "trim");
  ed.box([-L - 1, hub[1] - 1, 4], [-2, hub[1], 4], "trim");
  group(m, "sails", [-L - 1, hub[1] - L - 1, 3], [L, hub[1] + L, 4]);
  const hz = S.pick([0.25, 0.33, 0.5]);
  return { clips: { idle: { period: 1 / hz / 4, frames: 6, motions: [{ kind: "spin", group: "sails", axis: "z", pivot: [0, hub[1], 4.5], hz }] } } };
}

const UNIT: Readonly<Record<GeneratorKind, number>> = { critter: 0.06, crate: 0.08, banner: 0.07, tree: 0.12, lamp: 0.08, windmill: 0.2 };

/** A seeded voxel thing of a kind (see the top). */
export function generate(kind: GeneratorKind, seed: string | number, opts: GenerateOptions = {}): Generated {
  if (!GENERATOR_KINDS.includes(kind)) throw new RangeError(`No generator "${kind}" (${GENERATOR_KINDS.join(", ")}).`);
  const S = streamOf(String(seed), kind);
  const m = createVoxels({ unit: opts.unit ?? UNIT[kind], name: `${kind}-${seed}` });
  const colours: Record<string, Oklch> = {};
  let animation: ObjectAnimation | undefined;
  let truth: Generated["truth"];
  let rules: VariationRules = {};
  let target: Generated["target"] = "object";
  if (kind === "critter") {
    const plan = opts.plan ?? (S.chance(0.5) ? "quadruped" : "humanoid");
    truth = plan === "quadruped" ? quadCritter(S, m) : bipedCritter(S, m);
    const hue = S.between(0, 360);
    Object.assign(colours, { primary: [S.between(0.5, 0.72), S.between(0.05, 0.14), hue], secondary: [0.82, 0.04, hue + 20], skin: [S.between(0.6, 0.8), S.between(0.04, 0.1), hue + S.between(-30, 30)], trim: hueRole(S, 0.7, 0.1), accent: hueRole(S, 0.6, 0.16) });
    rules = {
      scale: {
        legs: { region: "legs", y: [0.8, 1.35], anchor: "top" },
        head: { region: "head", uniform: [0.85, 1.2], anchor: plan === "quadruped" ? "back" : "bottom" },
      },
      ...(m.groups.has("tail") ? { optional: { tail: 0.75 } } : {}),
      size: [0.85, 1.2],
    };
    target = "entity";
  } else if (kind === "crate") {
    crate(S, m);
    Object.assign(colours, { primary: [0.62, 0.09, 65], secondary: [0.45, 0.07, 55], trim: [0.5, 0.02, 250], accent: [0.6, 0.16, 25] });
    rules = { size: [0.8, 1.3] };
  } else if (kind === "banner") {
    animation = banner(S, m);
    Object.assign(colours, { primary: hueRole(S, 0.55, 0.16), secondary: [0.88, 0.05, 90], trim: [0.55, 0.06, 60], accent: [0.8, 0.14, 90] });
  } else if (kind === "tree") {
    animation = tree(S, m);
    Object.assign(colours, { primary: [0.45, 0.07, 50], secondary: [S.between(0.55, 0.7), 0.13, S.between(120, 150)], accent: [0.7, 0.17, S.pick([25, 80, 330])] });
    rules = { size: [0.8, 1.25] };
  } else if (kind === "lamp") {
    animation = lamp(S, m);
    Object.assign(colours, { glow: [0.9, 0.14, S.pick([85, 60, 190])], trim: [0.55, 0.05, 70] });
  } else {
    animation = windmill(S, m);
    Object.assign(colours, { primary: [0.82, 0.03, 80], secondary: [0.45, 0.1, 30], trim: [0.7, 0.05, 70] });
  }
  return { kind, seed: String(seed), model: m, rules, colours, target, ...(animation ? { animation } : {}), ...(truth ? { truth } : {}) };
}
