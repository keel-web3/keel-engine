// Skeletons for voxel creatures: pick the body (humanoid or quadruped) from
// the shape, place the engine's own bones in it, bind every voxel to a bone,
// and hand back an EntitySpec -- so the engine's clips, animator and sockets
// work on it unchanged (walk, run, trot, gallop, sit... and every attribute
// that fits the body contract).
//
//   const rig = autoRig(model);                  // analysis, joints, binding, spec, sockets
//   rig.plan; rig.analysis.why;                   // "quadruped: 4 leg columns ..."
//   const skel = posed(rig.spec, "walk", { phase: 0.3 });
//   poseVoxels(rig, skel, look.table);            // { boxes, capsules } for the renderer
//   animator(rig.spec).step(dt, body)             // the engine's animator, as for any entity
//
// How the shape is read (all in voxels, +y up, +z the front, +x its right):
//   legs      layer by layer from the ground, the columns of cells that stand
//             apart (2D components per layer); where they merge is the crotch
//             or the belly. Two side by side: two legs. Four, in a front pair
//             and a hind pair: four legs.
//   plan      the leg count first, then proportions (tall or long, legs split
//             along x or along z) -- scored, with the reasons.
//   humanoid  from the top down, the head is the run of layers of one width
//             and area; narrower layers under it are the neck; the columns
//             beside the torso (gap-separated where they are, else outside the
//             hips' width) are the arms: shoulder at their top, hand at their
//             bottom, elbow between. Cells behind the hips are a tail.
//   quadruped the body runs between the leg pairs; ahead of where it stops
//             reaching down to the belly (and above its back at the front) is
//             the neck and head, split where the section narrows; behind, the tail.
//   binding   each cell to the nearest bone segment among the bones of its
//             region (a left-leg cell only to the left leg's bones), then a
//             pass that moves a cell to the bone most of its neighbours hold.
//
// Bones are the engine's (humanoidRig / quadrupedRig), with every detected
// joint moved to where the voxels put it; the proportions the clips read
// (hipW, ankleH, bodyLen, w, ...) agree with them, so IK plants the feet
// under the legs. Overrides move a joint, reassign a region, mark a socket.

import { contractOf, entityOf, humanoidRig, missingSockets, quadrupedRig, restJoints, socketsOf } from "@keel-engine/entity";
import type {
  Bone, Chain, EntitySocket, EntitySpec, HumanoidBody, HumanoidSpec, Plan, QuadrupedBody, QuadrupedSpec, Rig,
} from "@keel-engine/entity";
import { datan2, dhypot, dlen } from "@keel-engine/core";
import { greedyGrid } from "./mesh.ts";
import { inRegion, regionOf } from "./voxels.ts";
import type { Dense, Region, V3, Vec3i, VoxelModel } from "./voxels.ts";

// ---------------------------------------------------------------- types

export interface LegColumn {
  /** L R (two legs) or FL FR HL HR. */
  readonly name: string;
  /** Centre at the layer the legs were found on, in voxel coordinates (cell centres: +0.5). */
  readonly x: number;
  readonly z: number;
  /** Its top: the last layer before it merges into the body. */
  readonly top: number;
  readonly width: number;
  readonly depth: number;
  /** Its foot on the ground: z of heel and toe (cell edges). */
  readonly heel: number;
  readonly toe: number;
  readonly cells: number;
}

export interface RigAnalysis {
  readonly plan: Plan;
  /** 0..1 */
  readonly confidence: number;
  readonly scores: { readonly humanoid: number; readonly quadruped: number };
  readonly why: readonly string[];
  readonly legs: readonly LegColumn[];
  /** The rig's ground point (the spec's origin) in voxel coordinates. */
  readonly origin: V3;
  /** Every detected joint, in voxel coordinates. */
  readonly joints: Readonly<Record<string, V3>>;
  /** Cells per region: legs, arms, head, neck, torso, tail. */
  readonly regions: Readonly<Record<string, number>>;
}

/** A socket marked by hand: the bone it rides, its origin (voxel coordinates), its size (voxels), the way things grow. */
export interface SocketMark {
  readonly bone: string;
  readonly at: Vec3i | readonly [number, number, number];
  readonly size?: readonly [number, number, number];
  readonly out?: readonly [number, number, number];
}

/** Manual edits on top of the automatic rig (plain data: it travels in exported pack code). */
export interface RigEdits {
  readonly plan?: Plan;
  /** Joints moved, by bone name, in voxel coordinates. */
  readonly joints?: Readonly<Record<string, readonly [number, number, number]>>;
  /** Regions of voxels given to a bone (later ones win). */
  readonly assign?: ReadonlyArray<{ readonly from: Vec3i; readonly to: Vec3i; readonly bone: string }>;
  /** Sockets added (or replacing the contract's, by name). */
  readonly sockets?: Readonly<Record<string, SocketMark>>;
  /**
   * Limb bones (thighs, shins, arms, tails) as one capsule each -- smooth swings, since the renderer turns boxes
   * about y only -- or their boxes held rigid (blocky, block-builder style). "auto" (default): a capsule where the
   * limb is long for its thickness, rigid boxes where it's stout.
   */
  readonly limbs?: "capsule" | "rigid" | "auto";
}

/** A skinned piece in its bone's frame (metres, the own frame at rest). */
export interface BoundBox { readonly bone: string; readonly c: V3; readonly h: V3; readonly role: string }
export interface BoundCapsule { readonly bone: string; readonly a: V3; readonly b: V3; readonly r: number; readonly role: string }
export interface VoxelSkin {
  readonly boxes: readonly BoundBox[];
  readonly capsules: readonly BoundCapsule[];
  /** Cells per bone. */
  readonly cells: Readonly<Record<string, number>>;
}

/** What a voxel creature's spec carries besides the engine's: its skin, sockets and where it came from. */
export interface VoxelExtras {
  readonly voxel: {
    readonly name: string;
    readonly skin: VoxelSkin;
    readonly sockets: Readonly<Record<string, EntitySocket>>;
    readonly analysis: RigAnalysis;
  };
}
export type VoxelSpec = (HumanoidSpec & VoxelExtras) | (QuadrupedSpec & VoxelExtras);

export interface VoxelRig {
  readonly model: VoxelModel;
  readonly plan: Plan;
  readonly analysis: RigAnalysis;
  readonly spec: VoxelSpec;
  readonly skin: VoxelSkin;
  readonly sockets: Readonly<Record<string, EntitySocket>>;
  /** Required sockets of the body contract it lacks (empty: it keeps the contract). */
  readonly missing: readonly string[];
  /** Each cell's bone: "x,y,z" -> bone name. */
  readonly binding: ReadonlyMap<string, string>;
  readonly edits: RigEdits;
}

// ---------------------------------------------------------------- the grid

interface Grid {
  readonly d: Dense;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  occ(x: number, y: number, z: number): boolean;
  at(x: number, y: number, z: number): number;
}
function gridOf(model: VoxelModel): Grid {
  const d = model.dense();
  const [sx, sy, sz] = d.size;
  const at = (x: number, y: number, z: number): number => x + sx * (y + sy * z);
  return { d, sx, sy, sz, at, occ: (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && d.data[at(x, y, z)]! > 0 };
}

interface Comp { cells: number[]; n: number; cx: number; cz: number; x0: number; x1: number; z0: number; z1: number }
/** 2D components (4-connected) of a layer; cells as x + sx * z. */
function layerComps(g: Grid, y: number, keep?: (x: number, z: number) => boolean): Comp[] {
  const seen = new Uint8Array(g.sx * g.sz);
  const out: Comp[] = [];
  for (let z = 0; z < g.sz; z += 1) for (let x = 0; x < g.sx; x += 1) {
    const k = x + g.sx * z;
    if (seen[k] || !g.occ(x, y, z) || (keep && !keep(x, z))) continue;
    const stack = [k];
    seen[k] = 1;
    const cells: number[] = [];
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const cx = c % g.sx, cz = Math.floor(c / g.sx);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= g.sx || nz >= g.sz) continue;
        const q = nx + g.sx * nz;
        if (seen[q] || !g.occ(nx, y, nz) || (keep && !keep(nx, nz))) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    let sx = 0, sz = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of cells) { const cx = c % g.sx, cz = Math.floor(c / g.sx); sx += cx; sz += cz; x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz); }
    out.push({ cells, n: cells.length, cx: sx / cells.length + 0.5, cz: sz / cells.length + 0.5, x0, x1, z0, z1 });
  }
  return out;
}

// ---------------------------------------------------------------- legs

interface Track { comp: Comp; top: number; cells: Set<number>; /* dense indices */ bottomComp: Comp; y0: number; xs: number[]; zs: number[] }

function findLegs(g: Grid): { y: number; tracks: Track[] } {
  // (Grounded cells: connected to the ground through the layers below -- a hand hanging free is not a leg.)
  const grounded = new Uint8Array(g.d.data.length);
  const cellAt = (k: number, y: number): number => g.at(k % g.sx, y, Math.floor(k / g.sx));
  for (let y = 0; y < g.sy; y += 1) {
    for (const c of layerComps(g, y)) {
      if (y === 0 || c.cells.some((k) => grounded[cellAt(k, y - 1)])) for (const k of c.cells) grounded[cellAt(k, y)] = 1;
    }
  }
  // (The lowest layer, in the lower 60%, with the most grounded columns standing apart; slivers under 15% of the biggest don't count.)
  const scanTo = Math.max(1, Math.floor(g.sy * 0.6));
  let best = { y: 0, comps: [] as Comp[] };
  for (let y = 0; y < scanTo; y += 1) {
    const cs = layerComps(g, y).filter((c) => grounded[cellAt(c.cells[0]!, y)]);
    const big = Math.max(0, ...cs.map((c) => c.n));
    const legs = cs.filter((c) => c.n >= Math.max(1, big * 0.15));
    if (legs.length > best.comps.length) best = { y, comps: legs };
  }
  const tracks: Track[] = best.comps.map((c) => ({ comp: c, top: best.y, cells: new Set(c.cells.map((k) => g.at(k % g.sx, best.y, Math.floor(k / g.sx)))), bottomComp: c, y0: best.y, xs: [c.cx], zs: [c.cz] }));
  if (tracks.length < 2) return { y: best.y, tracks };
  // Up: a track goes on while one component of the next layer overlaps it and no other track.
  let alive = tracks.slice();
  for (let y = best.y + 1; y < g.sy && alive.length; y += 1) {
    const cs = layerComps(g, y);
    const owner = new Map<Comp, Track[]>();
    for (const t of alive) {
      const prev = new Set(t.comp.cells);
      for (const c of cs) if (c.cells.some((k) => prev.has(k))) { const l = owner.get(c) ?? []; l.push(t); owner.set(c, l); }
    }
    const next: Track[] = [];
    for (const t of alive) {
      const mine = [...owner.entries()].filter(([, ts]) => ts.includes(t));
      if (mine.length === 1 && mine[0]![1].length === 1) {
        const c = mine[0]![0];
        t.comp = c;
        t.top = y;
        t.xs.push(c.cx); t.zs.push(c.cz);
        for (const k of c.cells) t.cells.add(g.at(k % g.sx, y, Math.floor(k / g.sx)));
        next.push(t);
      }
    }
    alive = next;
  }
  // Down: cells under the found layer go to the nearest track (feet on a shared base still split).
  for (let y = best.y - 1; y >= 0; y -= 1) {
    for (let z = 0; z < g.sz; z += 1) for (let x = 0; x < g.sx; x += 1) {
      if (!g.occ(x, y, z) || !grounded[g.at(x, y, z)]) continue;
      let bt: Track | null = null, bd = Infinity;
      for (const t of tracks) { const d = dhypot(x + 0.5 - t.bottomComp.cx, z + 0.5 - t.bottomComp.cz); if (d < bd) { bd = d; bt = t; } }
      bt!.cells.add(g.at(x, y, z));
    }
  }
  return { y: best.y, tracks };
}

function legColumn(g: Grid, t: Track, name: string): LegColumn {
  let heel = Infinity, toe = -Infinity;
  for (const i of t.cells) {
    const y = Math.floor(i / g.sx) % g.sy;
    if (y > 1) continue;
    const z = Math.floor(i / (g.sx * g.sy));
    heel = Math.min(heel, z); toe = Math.max(toe, z + 1);
  }
  const c = t.bottomComp;
  if (!Number.isFinite(heel)) { heel = c.z0; toe = c.z1 + 1; }
  // (Its centre: the median over the layers it was tracked through -- a boot's toe doesn't pull it forward.)
  const med = (v: number[]): number => { const a = [...v].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]!; };
  return { name, x: med(t.xs), z: med(t.zs), top: t.top, width: c.x1 - c.x0 + 1, depth: c.z1 - c.z0 + 1, heel, toe, cells: t.cells.size };
}

// ---------------------------------------------------------------- analysis

const HUMANOID_LIMBS = new Set(["thigh.L", "thigh.R", "shin.L", "shin.R", "upperArm.L", "upperArm.R", "forearm.L", "forearm.R", "tail0", "tail1"]);
const QUADRUPED_LIMBS = new Set(["upper.FL", "upper.FR", "upper.HL", "upper.HR", "lower.FL", "lower.FR", "lower.HL", "lower.HR", "tail0", "tail1", "tail2"]);

/** Which bones a region's cells may bind to. */
const CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  "leg.L": ["thigh.L", "shin.L", "foot.L"], "leg.R": ["thigh.R", "shin.R", "foot.R"],
  "arm.L": ["upperArm.L", "forearm.L", "hand.L"], "arm.R": ["upperArm.R", "forearm.R", "hand.R"],
  "h.torso": ["hips", "spine", "chest"], "h.neck": ["neck"], "h.head": ["head"], "h.tail": ["tail0", "tail1"],
  "leg.FL": ["upper.FL", "lower.FL", "paw.FL"], "leg.FR": ["upper.FR", "lower.FR", "paw.FR"],
  "leg.HL": ["upper.HL", "lower.HL", "paw.HL"], "leg.HR": ["upper.HR", "lower.HR", "paw.HR"],
  "q.torso": ["pelvis", "spine", "chest"], "q.neck": ["neck"], "q.head": ["head"], "q.tail": ["tail0", "tail1", "tail2"],
};

interface Read {
  analysis: RigAnalysis;
  /** Region of each occupied dense cell. */
  region: Map<number, string>;
  body: HumanoidBody | QuadrupedBody;
  kind: "humanoid" | "anthro" | "animal";
  tail: number;
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function decide(g: Grid, legs: { tracks: Track[] }, forced?: Plan): { plan: Plan; confidence: number; scores: { humanoid: number; quadruped: number }; why: string[] } {
  const why: string[] = [];
  const K = legs.tracks.length;
  let hum = 0, quad = 0;
  const tall = g.sy / Math.max(1, g.sz);
  if (K >= 4) { quad += 3; why.push(`${K} columns stand apart near the ground: four legs`); }
  else if (K === 2) {
    const [a, b] = legs.tracks.map((t) => t.bottomComp);
    const dx = Math.abs(a!.cx - b!.cx), dz = Math.abs(a!.cz - b!.cz);
    if (dx >= dz) { hum += 3; why.push(`two columns side by side (${dx.toFixed(1)} apart across, ${dz.toFixed(1)} along): two legs`); }
    else { quad += 2; why.push(`two columns one behind the other (${dz.toFixed(1)} along): a front and a hind pair, each pair joined`); }
  } else if (K === 3) { quad += 1; hum += 0.5; why.push("three columns near the ground: a leg pair merged, or a tail down"); }
  else why.push("no separate leg columns: judged by proportions alone");
  if (tall > 1.25) { hum += 1; why.push(`tall for its length (${g.sy} up x ${g.sz} long)`); }
  else if (tall < 0.9) { quad += 1; why.push(`long for its height (${g.sz} long x ${g.sy} up)`); }
  // (Legs under a long body: a quadruped's mass runs ahead of and behind its columns.)
  if (K >= 2) {
    const zs = legs.tracks.map((t) => t.bottomComp.cz);
    const spread = Math.max(...zs) - Math.min(...zs);
    if (spread > g.sz * 0.35) { quad += 1; why.push("the columns spread along the body"); }
  }
  let plan: Plan = quad > hum ? "quadruped" : "humanoid";
  const total = hum + quad || 1;
  let confidence = Math.max(hum, quad) / total * Math.min(1, Math.max(hum, quad) / 3);
  if (forced) { if (forced !== plan) why.push(`asked for ${forced} (the shape says ${plan})`); plan = forced; confidence = 1; }
  why.unshift(`${plan} (${Math.round(confidence * 100)}%)`);
  return { plan, confidence, scores: { humanoid: hum, quadruped: quad }, why };
}

type Reading = Omit<Read, "analysis"> & { joints: Record<string, V3>; legCols: LegColumn[]; origin: V3; armBottom: number | null; fallback: boolean };

function readHumanoid(g: Grid, legs: { y: number; tracks: Track[] }, unit: number, why: string[], crotchHint?: number): Reading {
  const region = new Map<number, string>();
  const { sx, sy, sz } = g;
  // Legs: the two biggest columns (left is -x); none found: the bottom third split at the middle.
  let tr = [...legs.tracks].sort((a, b) => b.cells.size - a.cells.size).slice(0, 2).sort((a, b) => a.bottomComp.cx - b.bottomComp.cx);
  let legCols: LegColumn[];
  let crotch: number;
  if (tr.length === 2) {
    legCols = tr.map((t, i) => legColumn(g, t, i ? "R" : "L"));
    crotch = Math.min(legCols[0]!.top, legCols[1]!.top) + 1;
    tr.forEach((t, i) => { for (const c of t.cells) if (Math.floor(c / sx) % sy < crotch) region.set(c, i ? "leg.R" : "leg.L"); });
  } else {
    crotch = crotchHint ?? Math.max(1, Math.round(sy * 0.3));
    // (Split at the middle of what stands on the ground; each side's extent is its leg.)
    let gx0 = Infinity, gx1 = -Infinity;
    for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) if (g.occ(x, 0, z)) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x + 1); }
    const mid = Number.isFinite(gx0) ? (gx0 + gx1) / 2 : sx / 2;
    const ext = { L: [Infinity, -Infinity, Infinity, -Infinity], R: [Infinity, -Infinity, Infinity, -Infinity] };
    for (let z = 0; z < sz; z += 1) for (let y = 0; y < crotch; y += 1) for (let x = 0; x < sx; x += 1) {
      if (!g.occ(x, y, z)) continue;
      const side = x + 0.5 < mid ? "L" : "R";
      region.set(g.at(x, y, z), `leg.${side}`);
      const e = ext[side];
      e[0] = Math.min(e[0]!, x); e[1] = Math.max(e[1]!, x + 1); e[2] = Math.min(e[2]!, z); e[3] = Math.max(e[3]!, z + 1);
    }
    const col = (side: "L" | "R"): LegColumn => {
      const e = ext[side];
      const ok = Number.isFinite(e[0]!);
      const x0 = ok ? e[0]! : side === "L" ? 0 : mid, x1 = ok ? e[1]! : side === "L" ? mid : sx;
      const z0 = ok ? e[2]! : 0, z1 = ok ? e[3]! : sz;
      return { name: side, x: (x0 + x1) / 2, z: (z0 + z1) / 2, top: crotch - 1, width: Math.max(1, x1 - x0), depth: Math.max(1, z1 - z0), heel: z0, toe: z1, cells: 0 };
    };
    legCols = [col("L"), col("R")];
    why.push(crotchHint === undefined ? "no leg columns: the bottom third split down the middle as legs" : `legs that touch: split down the middle, up to where the hands hang (${crotch})`);
    tr = [];
  }
  const cx = (legCols[0]!.x + legCols[1]!.x) / 2;
  const cz = (legCols[0]!.z + legCols[1]!.z) / 2;
  const origin: V3 = [cx, 0, cz];

  // Layer profiles above the crotch: x extent and area.
  const W = new Array<number>(sy).fill(0), A = new Array<number>(sy).fill(0), X0 = new Array<number>(sy).fill(Infinity), X1 = new Array<number>(sy).fill(-Infinity);
  for (let y = 0; y < sy; y += 1) for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) if (g.occ(x, y, z)) { A[y] = A[y]! + 1; X0[y] = Math.min(X0[y]!, x); X1[y] = Math.max(X1[y]!, x); }
  for (let y = 0; y < sy; y += 1) W[y] = A[y]! ? X1[y]! - X0[y]! + 1 : 0;
  // The head: from the top down, layers of one width and area -- starting under anything thin on top (ears, horns, a crest).
  let upperMax = 0;
  for (let y = Math.floor((crotch + sy) / 2); y < sy; y += 1) upperMax = Math.max(upperMax, A[y]!);
  let headTop = sy - 1;
  while (headTop > crotch && A[headTop]! < 0.35 * upperMax) headTop -= 1;
  let headBottom = headTop;
  const hw: number[] = [W[headTop]!], ha: number[] = [A[headTop]!];
  const maxHead = Math.max(1, Math.floor((headTop + 1 - crotch) * 0.55));
  for (let y = headTop - 1; y >= crotch && headTop - y < maxHead; y -= 1) {
    const w = Math.max(...hw), a = Math.max(...ha);
    if (Math.abs(W[y]! - w) > Math.max(1, 0.25 * w) || Math.abs(A[y]! - a) > 0.3 * a) break;
    headBottom = y; hw.push(W[y]!); ha.push(A[y]!);
  }
  const headA = Math.max(...ha), headW = Math.max(...hw);
  // The neck: narrower layers under the head.
  let neckBottom = headBottom;
  for (let y = headBottom - 1; y > crotch; y -= 1) {
    if (A[y]! < 0.6 * headA && W[y]! < headW) neckBottom = y; else break;
  }
  const torsoTop = neckBottom - 1;
  if (headBottom <= crotch + 1) why.push("the head could not be told from the body: the top layers are the head");

  // Arms: gap-separated side runs where there are any, else what's outside the hips.
  const runsAt = (y: number): Array<[number, number]> => {
    const col = new Uint8Array(sx);
    for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) if (g.occ(x, y, z)) col[x] = 1;
    const out: Array<[number, number]> = [];
    for (let x = 0; x < sx; x += 1) if (col[x] && (x === 0 || !col[x - 1])) { let e = x; while (e + 1 < sx && col[e + 1]) e += 1; out.push([x, e]); }
    return out;
  };
  // (The torso's half-width: its narrowest layer -- below where the arms reach, when they don't hang the whole way;
  // when they do (no layer is narrow), the legs' outer edges.)
  const coreHalf = (y: number): number => { const run = runsAt(y).find(([a, b]) => a <= cx && b + 1 >= cx); return run ? Math.max(cx - run[0], run[1] + 1 - cx) : Infinity; };
  let torsoHalf = Infinity;
  for (let y = crotch; y <= Math.max(crotch, torsoTop); y += 1) torsoHalf = Math.min(torsoHalf, coreHalf(y));
  const legOuter = Math.max(...legCols.map((l) => Math.abs(l.x - cx) + l.width / 2));
  if (!Number.isFinite(torsoHalf) || torsoHalf > legOuter + 1.5) torsoHalf = legOuter;
  const gapHalves: number[] = [];
  for (let y = crotch; y <= torsoTop; y += 1) {
    const rs = runsAt(y);
    if (rs.length >= 3) { const mid = rs.find(([a, b]) => a <= cx && b + 1 >= cx); if (mid) gapHalves.push(Math.max(cx - mid[0], mid[1] + 1 - cx)); }
  }
  if (gapHalves.length >= 2) { torsoHalf = Math.max(...gapHalves); why.push(`arms stand apart from the torso on ${gapHalves.length} layers`); }
  const armCells: Record<"L" | "R", number[]> = { L: [], R: [] };
  for (let y = 0; y <= torsoTop; y += 1) for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) {
    if (!g.occ(x, y, z)) continue;
    const i = g.at(x, y, z);
    if (region.has(i) && y < crotch) continue;
    const off = x + 0.5 - cx;
    if (Math.abs(off) > torsoHalf + 0.01 && y >= crotch - Math.round(sy * 0.25)) armCells[off < 0 ? "L" : "R"].push(i);
  }
  const joints: Record<string, V3> = {};
  const hipY = crotch;
  joints["hips"] = [cx, hipY, cz];
  joints["thigh.L"] = [legCols[0]!.x, hipY, legCols[0]!.z];
  joints["thigh.R"] = [legCols[1]!.x, hipY, legCols[1]!.z];
  const legW = mean(legCols.map((l) => Math.min(l.width, l.depth)));
  const footR = Math.max(0.5, (legW / 2) * 0.9);
  const ankleY = Math.min(hipY * 0.45, Math.max(footR * 1.25, hipY * 0.1));
  for (const l of legCols) {
    joints[`foot.${l.name}`] = [l.x, ankleY, l.z];
    joints[`shin.${l.name}`] = [l.x, (hipY + ankleY) / 2, l.z];
  }
  const neckY = torsoTop + 1;
  // (Where the neck and head sit front to back: the middle of the head's bottom layer.)
  let hz = 0, hn = 0;
  for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) if (g.occ(x, headBottom, z)) { hz += z + 0.5; hn += 1; }
  const headZ = hn ? hz / hn : cz;
  joints["neck"] = [cx, neckY, headZ];
  joints["head"] = [cx, headBottom, headZ];
  const T = Math.max(1e-3, neckY - hipY);
  joints["spine"] = [cx, hipY + T * 0.28, (cz + headZ) / 2];
  joints["chest"] = [cx, hipY + T * 0.58, (cz + headZ) / 2];
  // Arms.
  let armW = Math.max(1, legW * 0.8);
  let armBottom: number | null = null;
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? -1 : 1;
    const cells = armCells[side];
    if (cells.length >= 2) {
      let y0 = Infinity, y1 = -Infinity, xs = 0, zs = 0, xmin = Infinity, xmax = -Infinity;
      for (const i of cells) {
        const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
        y0 = Math.min(y0, y); y1 = Math.max(y1, y); xs += x + 0.5; zs += z + 0.5; xmin = Math.min(xmin, x); xmax = Math.max(xmax, x + 1);
        region.set(i, `arm.${side}`);
      }
      const ax = xs / cells.length, az = zs / cells.length;
      const reachX = xmax - xmin, reachY = y1 + 1 - y0;
      armBottom = armBottom === null ? y0 : Math.min(armBottom, y0);
      armW = Math.max(1, Math.min(reachX, reachY, 3));
      if (reachX > reachY * 1.5) {
        // (Arms held out: the shoulder at the inner end, the hand at the outer.)
        const inner = s < 0 ? xmax : xmin, outer = s < 0 ? xmin : xmax;
        const ay = (y0 + y1 + 1) / 2;
        joints[`upperArm.${side}`] = [inner, ay, az];
        joints[`hand.${side}`] = [outer - s * Math.min(armW, reachX * 0.25), ay, az];
        why.push(`the ${side === "L" ? "left" : "right"} arm is held out: it swings from the shoulder as built`);
      } else {
        const handLen = Math.min(armW, reachY * 0.25);
        joints[`upperArm.${side}`] = [ax, y1 + 1 - armW / 2, az];
        joints[`hand.${side}`] = [ax, y0 + handLen, az];
      }
    } else {
      // (No arm cells: short arms at the shoulders, so the hand sockets exist.)
      joints[`upperArm.${side}`] = [cx + s * (torsoHalf + 0.5), hipY + T * 0.9, cz];
      joints[`hand.${side}`] = [cx + s * (torsoHalf + 0.5), hipY + T * 0.55, cz];
      why.push(`no ${side === "L" ? "left" : "right"} arm found: a short one at the shoulder`);
    }
    const u = joints[`upperArm.${side}`]!, h = joints[`hand.${side}`]!;
    joints[`forearm.${side}`] = [(u[0] + h[0]) / 2, (u[1] + h[1]) / 2, (u[2] + h[2]) / 2];
    joints[`shoulder.${side}`] = [cx + (u[0] - cx) * 0.35, u[1], u[2]];
  }
  // The rest: head, neck, torso; cells behind the hips (low, not arms) are a tail.
  let zBack = Infinity;
  for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) if (g.occ(x, Math.min(crotch, sy - 1), z)) zBack = Math.min(zBack, z);
  const tailCells: number[] = [];
  for (let z = 0; z < sz; z += 1) for (let y = 0; y < sy; y += 1) for (let x = 0; x < sx; x += 1) {
    if (!g.occ(x, y, z)) continue;
    const i = g.at(x, y, z);
    if (region.has(i)) continue;
    if (y >= headBottom) region.set(i, "h.head");
    else if (y >= neckBottom) region.set(i, "h.neck");
    else if (z < zBack && y < (hipY + neckY) / 2 && y >= crotch - 2) { region.set(i, "h.tail"); tailCells.push(i); }
    else region.set(i, y < crotch ? (x + 0.5 < cx ? "leg.L" : "leg.R") : "h.torso");
  }
  let tail = 0;
  if (tailCells.length >= 2) {
    // (Base: the tail cells nearest the hips; tip: the farthest.)
    const pts = tailCells.map((i): V3 => [i % sx + 0.5, Math.floor(i / sx) % sy + 0.5, Math.floor(i / (sx * sy)) + 0.5]);
    const dist = (p: V3): number => dhypot(p[0] - cx, p[1] - hipY, p[2] - cz);
    pts.sort((a, b) => dist(a) - dist(b));
    const base = pts[0]!, tip = pts[pts.length - 1]!;
    joints["tail0"] = base;
    joints["tail1"] = [(base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2];
    joints["tail.tip"] = tip;
    tail = dhypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]) + 0.5;
    why.push(`a tail of ${tailCells.length} cells behind the hips`);
  }
  const headR = (sy - headBottom) / 2;
  let tz0 = Infinity, tz1 = -Infinity;
  for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) if (g.occ(x, Math.max(crotch, Math.round(hipY + T * 0.6)), z)) { tz0 = Math.min(tz0, z); tz1 = Math.max(tz1, z + 1); }
  const torsoR = Number.isFinite(tz0) ? (tz1 - tz0) / 2 : torsoHalf;
  const u = unit;
  const shoulderW = mean((["L", "R"] as const).map((s) => Math.abs(joints[`upperArm.${s}`]![0] - cx)));
  const upperArm = mean((["L", "R"] as const).map((s) => dist3(joints[`upperArm.${s}`]!, joints[`forearm.${s}`]!)));
  const forearm = mean((["L", "R"] as const).map((s) => dist3(joints[`forearm.${s}`]!, joints[`hand.${s}`]!)));
  const footLen = Math.max(footR * 1.5, mean(legCols.map((l) => l.toe - l.z)) / 0.78);
  const body: HumanoidBody = {
    H: sy * u, hipH: hipY * u, ankleH: ankleY * u, footR: footR * u,
    neck: Math.max(0.02, headBottom - neckY) * u, torso: T * u, headR: headR * u, torsoR: torsoR * u,
    thigh: ((hipY - ankleY) / 2) * u, shin: ((hipY - ankleY) / 2) * u, footLen: footLen * u,
    hipW: Math.abs(legCols[1]!.x - legCols[0]!.x) / 2 * u, shoulderW: shoulderW * u,
    upperArm: upperArm * u, forearm: forearm * u, handLen: Math.max(0.5, armW * 0.8) * u,
    legR: (legW / 2) * u, armR: (armW / 2) * u, tailLen: tail * u, stride: 1,
  };
  const kind = headR * 2 > sy * 0.25 ? "anthro" : "humanoid";
  return { region, body, kind, tail: tail * u, joints, legCols, origin, armBottom, fallback: tr.length !== 2 };
}

const dist3 = (a: V3, b: V3): number => dhypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function readQuadruped(g: Grid, legs: { y: number; tracks: Track[] }, unit: number, why: string[]): Omit<Read, "analysis"> & { joints: Record<string, V3>; legCols: LegColumn[]; origin: V3 } {
  const region = new Map<number, string>();
  const { sx, sy, sz } = g;
  // Four legs: the four biggest columns; front pair has the larger z. (Two, one behind the other: each split down the middle.)
  let tr = [...legs.tracks].sort((a, b) => b.cells.size - a.cells.size).slice(0, 4);
  const legCols: LegColumn[] = [];
  if (tr.length === 4) {
    const byZ = [...tr].sort((a, b) => b.bottomComp.cz - a.bottomComp.cz);
    const front = byZ.slice(0, 2).sort((a, b) => a.bottomComp.cx - b.bottomComp.cx);
    const hind = byZ.slice(2).sort((a, b) => a.bottomComp.cx - b.bottomComp.cx);
    const named: Array<[Track, string]> = [[front[0]!, "FL"], [front[1]!, "FR"], [hind[0]!, "HL"], [hind[1]!, "HR"]];
    for (const [t, n] of named) {
      legCols.push(legColumn(g, t, n));
      for (const c of t.cells) region.set(c, `leg.${n}`);
    }
  } else if (tr.length >= 2) {
    // (Two or three columns: a front and a hind group by z; a group of one is a left-right pair standing joined -- split down its middle.)
    const zs = tr.map((t) => t.bottomComp.cz);
    const zMid = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (const end of ["F", "H"] as const) {
      const mine = tr.filter((t) => (end === "F" ? t.bottomComp.cz >= zMid : t.bottomComp.cz < zMid)).sort((a, b) => a.bottomComp.cx - b.bottomComp.cx);
      if (mine.length >= 2) {
        const pair = [mine[0]!, mine[mine.length - 1]!];
        pair.forEach((t, i) => { const n = `${end}${i ? "R" : "L"}`; legCols.push(legColumn(g, t, n)); for (const c of t.cells) region.set(c, `leg.${n}`); });
      } else {
        const t = mine[0]!;
        const col = legColumn(g, t, `${end}L`);
        const half = { L: [] as number[], R: [] as number[] };
        for (const c of t.cells) { const side = (c % sx) + 0.5 < col.x ? "L" : "R"; half[side].push(c); region.set(c, `leg.${end}${side}`); }
        for (const side of ["L", "R"] as const) {
          const xs = half[side].map((c) => (c % sx) + 0.5);
          legCols.push({ ...col, name: `${end}${side}`, x: xs.length ? mean(xs) : col.x, width: Math.max(1, col.width / 2), cells: half[side].length });
        }
      }
    }
    why.push(`${tr.length} leg columns: pairs standing joined are split down their middles`);
  } else {
    // (Fewer than two columns: the lowest third split into quarters by x and z around its middle.)
    const top = Math.max(1, Math.round(sy * 0.35));
    const midX = sx / 2, midZ = sz / 2;
    const cells: Record<string, number[]> = { FL: [], FR: [], HL: [], HR: [] };
    for (let z = 0; z < sz; z += 1) for (let y = 0; y < top; y += 1) for (let x = 0; x < sx; x += 1) {
      if (!g.occ(x, y, z)) continue;
      const n = `${z + 0.5 >= midZ ? "F" : "H"}${x + 0.5 < midX ? "L" : "R"}`;
      cells[n]!.push(g.at(x, y, z));
      region.set(g.at(x, y, z), `leg.${n}`);
    }
    for (const n of ["FL", "FR", "HL", "HR"]) {
      const list = cells[n]!;
      const xs = list.map((i) => (i % sx) + 0.5), zs = list.map((i) => Math.floor(i / (sx * sy)) + 0.5);
      legCols.push({ name: n, x: list.length ? mean(xs) : (n[1] === "L" ? sx * 0.25 : sx * 0.75), z: list.length ? mean(zs) : (n[0] === "F" ? sz * 0.75 : sz * 0.25), top: top - 1, width: Math.max(1, sx / 4), depth: Math.max(1, sz / 4), heel: 0, toe: sz, cells: list.length });
    }
    why.push(`${tr.length} leg columns: the lowest third split into four legs`);
    tr = [];
  }
  const L = (n: string): LegColumn => legCols.find((l) => l.name === n)!;
  const cx = mean(legCols.map((l) => l.x));
  const zF = (L("FL").z + L("FR").z) / 2;
  const zH = (L("HL").z + L("HR").z) / 2;
  const oz = (zF + zH) / 2;
  const origin: V3 = [cx, 0, oz];
  const belly = Math.min(...legCols.map((l) => l.top)) + 1;
  // Body slices (non-leg cells) along z: bottom and top.
  const bot = new Array<number>(sz).fill(Infinity), topY = new Array<number>(sz).fill(-Infinity);
  for (let z = 0; z < sz; z += 1) for (let y = 0; y < sy; y += 1) for (let x = 0; x < sx; x += 1) {
    if (!g.occ(x, y, z) || region.has(g.at(x, y, z))) continue;
    bot[z] = Math.min(bot[z]!, y); topY[z] = Math.max(topY[z]!, y + 1);
  }
  const zi = (v: number): number => Math.max(0, Math.min(sz - 1, Math.floor(v)));
  const sliceMid = (z: number): number => (Number.isFinite(bot[z]!) ? (bot[z]! + topY[z]!) / 2 : belly + 1);
  const shoulderY = sliceMid(zi(zF));
  const hipY = sliceMid(zi(zH));
  const between: number[] = [];
  for (let z = zi(zH); z <= zi(zF); z += 1) if (Number.isFinite(bot[z]!)) between.push((topY[z]! - bot[z]!) / 2);
  const bodyR = Math.max(0.75, mean(between));
  const backTop = mean(Array.from({ length: zi(zF) - zi(zH) + 1 }, (_, k) => topY[zi(zH) + k]!).filter(Number.isFinite)) || belly + bodyR * 2;
  // Where the body stops, ahead and behind: the first slice whose bottom or top leaves the body's (a head is higher, a tail thinner).
  const bodyLike = (z: number, ref: number): boolean => Number.isFinite(bot[z]!) && Math.abs(bot[z]! - bot[ref]!) <= 1 && Math.abs(topY[z]! - topY[ref]!) <= 1;
  let zFront = zi(zF);
  while (zFront + 1 < sz && bodyLike(zFront + 1, zi(zF))) zFront += 1;
  let zBack = zi(zH);
  while (zBack - 1 >= 0 && bodyLike(zBack - 1, zi(zH))) zBack -= 1;
  const headCells: number[] = [];
  const tailCells: number[] = [];
  for (let z = 0; z < sz; z += 1) for (let y = 0; y < sy; y += 1) for (let x = 0; x < sx; x += 1) {
    if (!g.occ(x, y, z)) continue;
    const i = g.at(x, y, z);
    if (region.has(i)) continue;
    if (z > zFront || (y >= backTop + 1 && z >= zF - bodyR)) headCells.push(i);
    else if (z < zBack || (y >= backTop + 1 && z <= zH + bodyR * 0.5)) tailCells.push(i);
    else region.set(i, "q.torso");
  }
  const P = (i: number): V3 => [(i % sx) + 0.5, (Math.floor(i / sx) % sy) + 0.5, Math.floor(i / (sx * sy)) + 0.5];
  const chest: V3 = [cx, shoulderY, zF];
  // Head and neck: along the way out from the chest, the head starts where the section stops being narrow.
  let headR = bodyR * 0.8;
  let headC: V3 = [cx, shoulderY + bodyR * 1.2, zF + bodyR * 1.5];
  let neckBase: V3 | null = null;
  if (headCells.length) {
    const pts = headCells.map(P);
    let far = pts[0]!;
    for (const p of pts) if (dist3(p, chest) > dist3(far, chest)) far = p;
    const dir = norm3([far[0] - chest[0], far[1] - chest[1], far[2] - chest[2]]);
    const ts = pts.map((p) => (p[0] - chest[0]) * dir[0] + (p[1] - chest[1]) * dir[1] + (p[2] - chest[2]) * dir[2]);
    const t0 = Math.floor(Math.min(...ts)), t1 = Math.ceil(Math.max(...ts));
    const bins = new Array<number>(t1 - t0 + 1).fill(0);
    for (const t of ts) { const k = Math.min(bins.length - 1, Math.floor(t - t0)); bins[k] = bins[k]! + 1; }
    let cut = 0;
    for (let k = 0; k < bins.length; k += 1) {
      const later = Math.max(0, ...bins.slice(k + 1));
      if (bins[k]! < 0.6 * later) cut = k + 1; else if (cut) break;
    }
    const headT = cut ? t0 + cut : -Infinity;
    const head: V3[] = [];
    pts.forEach((p, k) => {
      const isHead = ts[k]! >= headT;
      region.set(headCells[k]!, isHead ? "q.head" : "q.neck");
      if (isHead) head.push(p);
    });
    if (cut) { neckBase = pts.reduce((a, p) => (dist3(p, chest) < dist3(a, chest) ? p : a), pts[0]!); why.push(`a neck of ${pts.length - head.length} cells, then the head`); }
    const ys = head.map((p) => p[1]), zs = head.map((p) => p[2]), xs = head.map((p) => p[0]);
    const hy0 = Math.min(...ys) - 0.5, hy1 = Math.max(...ys) + 0.5;
    const hz0 = Math.min(...zs) - 0.5, hz1 = Math.max(...zs) + 0.5;
    headR = Math.max(0.75, (hy1 - hy0) / 2);
    // (The engine's head ball sits a quarter radius up and half a radius ahead of the head joint; its crown is the top of the head.)
    headC = [mean(xs), (hy0 + hy1) / 2, Math.min((hz0 + hz1) / 2, hz1 - headR)];
  } else why.push("no head found ahead of the body: a small one is placed there");
  const headJoint: V3 = [headC[0], headC[1] - 0.25 * headR, headC[2] - 0.5 * headR];
  const neckJoint: V3 = neckBase ?? [cx, shoulderY + bodyR * 0.35, zF + bodyR * 0.45];
  let tailLen = 0;
  let tailRise = 0.4;
  const joints: Record<string, V3> = {};
  if (tailCells.length) {
    for (const i of tailCells) region.set(i, "q.tail");
    const pts = tailCells.map(P);
    const pelvis: V3 = [cx, hipY, zH];
    pts.sort((a, b) => dist3(a, pelvis) - dist3(b, pelvis));
    const base = pts[0]!, tip = pts[pts.length - 1]!;
    tailLen = dist3(base, tip) + 0.5;
    tailRise = datan2(tip[1] - base[1], -(tip[2] - base[2]) || 1e-6);
    joints["tail0"] = base;
    joints["tail1"] = lerp3(base, tip, 1 / 3);
    joints["tail2"] = lerp3(base, tip, 2 / 3);
    joints["tail.tip"] = tip;
    why.push(`a tail of ${tailCells.length} cells behind the body`);
  }
  joints["pelvis"] = [cx, hipY, zH];
  joints["spine"] = [cx, (hipY + shoulderY) / 2, (zH + zF) / 2];
  joints["chest"] = chest;
  joints["neck"] = neckJoint;
  joints["head"] = headJoint;
  const legW = mean(legCols.map((l) => Math.min(l.width, l.depth)));
  const ankleY = Math.min(belly * 0.5, Math.max((legW / 2) * 1.05, shoulderY * 0.085));
  for (const l of legCols) {
    const top = l.name[0] === "F" ? shoulderY : hipY;
    joints[`upper.${l.name}`] = [l.x, top, l.name[0] === "F" ? zF : zH];
    joints[`lower.${l.name}`] = [l.x, (top + ankleY) / 2, l.name[0] === "F" ? zF : zH];
    joints[`paw.${l.name}`] = [l.x, ankleY, l.name[0] === "F" ? zF : zH];
  }
  const u = unit;
  const nv: V3 = [headJoint[0] - neckJoint[0], headJoint[1] - neckJoint[1], headJoint[2] - neckJoint[2]];
  const legR = (legW / 2) * u;
  const body: QuadrupedBody = {
    shoulderH: shoulderY * u, hipH: hipY * u, ankleH: ankleY * u, bodyR: bodyR * u, legR,
    H: sy * u, bodyLen: (zF - zH) * u, neckLen: dhypot(nv[1], nv[2]) * u || 0.01, neckRise: datan2(nv[1], nv[2]),
    headR: headR * u, w: mean(legCols.map((l) => Math.abs(l.x - cx))) * u,
    upperF: ((shoulderY - ankleY) / 2) * u, lowerF: ((shoulderY - ankleY) / 2) * u,
    upperH: ((hipY - ankleY) / 2) * u, lowerH: ((hipY - ankleY) / 2) * u,
    pawR: legR * 1.1, pawLen: Math.max(legR * 1.2, mean(legCols.map((l) => l.toe - l.z)) * u), snoutLen: 0.3,
    tailLen: tailLen * u, tailRise, stride: 1,
  };
  return { region, body, kind: "animal", tail: tailLen * u, joints, legCols, origin };
}

const norm3 = (v: V3): V3 => { const l = dhypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Read a model's shape: which body, where its joints are, which cells are what (see the top). */
export function analyseShape(model: VoxelModel, { plan: forced }: { plan?: Plan } = {}): RigAnalysis {
  return read(model, gridOf(model), forced).analysis;
}

function read(model: VoxelModel, g: Grid, forced?: Plan): Read & { joints: Record<string, V3>; legCols: LegColumn[]; origin: V3 } {
  if (!model.count) throw new RangeError(`${model.name}: an empty model has no body to rig.`);
  const legs = findLegs(g);
  const d = decide(g, legs, forced);
  const why = [...d.why];
  let r: Reading | ReturnType<typeof readQuadruped>;
  if (d.plan === "quadruped") r = readQuadruped(g, legs, model.unit, why);
  else {
    const first = readHumanoid(g, legs, model.unit, [...why]);
    // (Legs that touch all the way down show no crotch: where the hands hang is the best guess, when that's in the lower half.)
    const hint = first.fallback && first.armBottom !== null && first.armBottom > g.sy * 0.2 && first.armBottom < g.sy * 0.55 ? first.armBottom : undefined;
    r = readHumanoid(g, legs, model.unit, why, hint);
  }
  // Into voxel coordinates (the dense box starts at d.min).
  const m = g.d.min;
  const abs = (p: V3): V3 => [p[0] + m[0], p[1] + m[1], p[2] + m[2]];
  const joints: Record<string, V3> = {};
  for (const [k, v] of Object.entries(r.joints)) joints[k] = abs(v);
  const regions: Record<string, number> = {};
  for (const v of r.region.values()) regions[v] = (regions[v] ?? 0) + 1;
  const legsOut = r.legCols.map((l) => ({ ...l, x: l.x + m[0], z: l.z + m[2], top: l.top + m[1], heel: l.heel + m[2], toe: l.toe + m[2] }));
  const analysis: RigAnalysis = { plan: d.plan, confidence: d.confidence, scores: d.scores, why, legs: legsOut, origin: abs(r.origin), joints, regions };
  return { ...r, analysis, joints, legCols: legsOut, origin: abs(r.origin) };
}

// ---------------------------------------------------------------- the rig

/** A rig whose joints sit where `abs` says (rig metres, own frame); bone offsets and chain lengths follow. */
function withJoints<B, P extends Plan>(base: Rig<B, P>, abs: Readonly<Record<string, V3>>): Rig<B, P> {
  const rest = restJoints(base as Rig);
  const at = (n: string): V3 => abs[n] ?? (rest[n] as V3);
  const bones: Bone[] = base.bones.map((b) => {
    const p = at(b.name);
    const off: V3 = b.parent ? [p[0] - at(b.parent)[0], p[1] - at(b.parent)[1], p[2] - at(b.parent)[2]] : [...p];
    return b.tip ? { name: b.name, parent: b.parent, off, tip: b.tip } : { name: b.name, parent: b.parent, off };
  });
  const index = base.index;
  const chains: Record<string, Chain> = {};
  for (const [k, c] of Object.entries(base.chains)) {
    const l1 = bones[index[c.bones[1]]!]!.off, l2 = bones[index[c.bones[2]]!]!.off;
    chains[k] = { bones: c.bones, pole: c.pole, poleIn: c.poleIn, lengths: [dlen(l1), dlen(l2)] };
  }
  return { plan: base.plan, bones, index, children: base.children, chains, body: base.body, top: base.top };
}

/** Where each bone's segment ends at rest (its chain child's joint, or its tip). */
const SEGMENT_END: Readonly<Record<string, string>> = {
  hips: "spine", spine: "chest", chest: "neck", neck: "head", pelvis: "spine",
  "thigh.L": "shin.L", "shin.L": "foot.L", "thigh.R": "shin.R", "shin.R": "foot.R",
  "upperArm.L": "forearm.L", "forearm.L": "hand.L", "upperArm.R": "forearm.R", "forearm.R": "hand.R",
  tail0: "tail1", tail1: "tail2",
  "upper.FL": "lower.FL", "lower.FL": "paw.FL", "upper.FR": "lower.FR", "lower.FR": "paw.FR",
  "upper.HL": "lower.HL", "lower.HL": "paw.HL", "upper.HR": "lower.HR", "lower.HR": "paw.HR",
};

function segmentsOf(rig: Rig): Record<string, [V3, V3]> {
  const rest = restJoints(rig) as Record<string, V3>;
  const out: Record<string, [V3, V3]> = {};
  for (const b of rig.bones) {
    const a = rest[b.name]!;
    const endName = SEGMENT_END[b.name];
    const e: V3 = endName && rest[endName] && rig.bones[rig.index[endName]!]!.parent === b.name ? rest[endName]! : b.tip ? [a[0] + b.tip[0], a[1] + b.tip[1], a[2] + b.tip[2]] : a;
    out[b.name] = [a, e];
  }
  return out;
}

const segDist = (p: V3, [a, b]: [V3, V3]): number => {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L2)) : 0;
  return dhypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
};

/**
 * autoRig(model, edits) -> a VoxelRig: the body picked (or edits.plan), the
 * engine's bones placed in the voxels, every cell bound, skinned, and a spec
 * the engine's clips, animator, sockets and wear() take as any entity's.
 */
export function autoRig(model: VoxelModel, edits: RigEdits = {}): VoxelRig {
  const g = gridOf(model);
  const r = read(model, g, edits.plan);
  const plan = r.analysis.plan;
  const u = model.unit;
  const O = r.origin;
  const toRig = (p: readonly number[]): V3 => [(p[0]! - O[0]) * u, (p[1]! - O[1]) * u, (p[2]! - O[2]) * u];
  // Joints: detected, then moved by hand.
  const jointsVox: Record<string, V3> = { ...r.joints };
  for (const [k, v] of Object.entries(edits.joints ?? {})) jointsVox[k] = [v[0], v[1], v[2]];
  const absRig: Record<string, V3> = {};
  for (const [k, v] of Object.entries(jointsVox)) if (!k.includes(".tip")) absRig[k] = toRig(v);
  // The proportions the clips read, agreeing with the joints (hip width, ankle height, body length, leg spread).
  const body = { ...r.body } as HumanoidBody & QuadrupedBody;
  if (plan === "humanoid") {
    const tl = absRig["thigh.L"], tR = absRig["thigh.R"];
    if (tl && tR) body.hipW = Math.abs(tR[0] - tl[0]) / 2;
    if (absRig["hips"]) body.hipH = absRig["hips"][1];
    if (absRig["foot.L"] && absRig["foot.R"]) body.ankleH = (absRig["foot.L"][1] + absRig["foot.R"][1]) / 2;
  } else {
    if (absRig["pelvis"]) body.hipH = absRig["pelvis"][1];
    if (absRig["chest"]) body.shoulderH = absRig["chest"][1];
    if (absRig["chest"] && absRig["pelvis"]) body.bodyLen = absRig["chest"][2] - absRig["pelvis"][2];
    const ws = ["FL", "FR", "HL", "HR"].map((k) => absRig[`upper.${k}`]).filter((v): v is V3 => !!v).map((v) => Math.abs(v[0]));
    if (ws.length) body.w = mean(ws);
  }
  const baseRig = plan === "humanoid" ? humanoidRig(body) : quadrupedRig(body);
  for (const k of Object.keys(edits.joints ?? {})) {
    if (k !== "tail.tip" && baseRig.index[k] === undefined) throw new RangeError(`joint: no bone "${k}" on a ${plan} (${baseRig.bones.map((b) => b.name).join(", ")}, tail.tip).`);
  }
  // (Tail joints the rig has but the model lacks stay where the rig puts them; a humanoid's tail1 tip follows the tail's.)
  const rig = withJoints(baseRig as Rig, absRig);
  if (jointsVox["tail.tip"]) {
    const last = plan === "humanoid" ? "tail1" : "tail2";
    const b = rig.bones[rig.index[last]!]!;
    const tip = toRig(jointsVox["tail.tip"]!);
    const j = restJoints(rig)[last]!;
    (rig.bones as Bone[])[rig.index[last]!] = { ...b, tip: [tip[0] - j[0], tip[1] - j[1], tip[2] - j[2]] };
  }
  // The spec: the catalogue's template for its kind (choices, colours, front), with this body and rig.
  const template = entityOf("keel-builder", { kind: r.kind, species: r.kind === "humanoid" ? "human" : r.kind === "anthro" ? "bear" : "dog" });
  const tailShape = r.tail > 0 ? "long" : "none";
  const features = { ...template.features, ears: { shape: "none" as const, len: 0, w: 0, spread: 0 }, snout: 0, tail: { shape: tailShape as "long" | "none", len: r.tail } };
  const specBase = { ...template, seed: `voxel:${model.name}`, body, rig, features, plan } as unknown as EntitySpec;
  // Binding: each cell to the nearest segment among its region's bones; hand-assigned regions win.
  const segs = segmentsOf(rig);
  const binding = new Map<string, string>();
  const boneIdx = new Map(rig.bones.map((b, i) => [b.name, i + 1]));
  const cellBone = new Int16Array(g.d.data.length);
  const assign = (edits.assign ?? []).map((a) => ({ r: regionOf(a.from, a.to), bone: a.bone }));
  for (const a of assign) if (!boneIdx.has(a.bone)) throw new RangeError(`assign: no bone "${a.bone}" on a ${plan} (${rig.bones.map((b) => b.name).join(", ")}).`);
  const m0 = g.d.min;
  for (const [i, reg] of r.region) {
    const x = i % g.sx, y = Math.floor(i / g.sx) % g.sy, z = Math.floor(i / (g.sx * g.sy));
    const vx = x + m0[0], vy = y + m0[1], vz = z + m0[2];
    let bone: string | undefined;
    for (const a of assign) if (inRegion(a.r, vx, vy, vz)) bone = a.bone;
    if (!bone) {
      const p = toRig([vx + 0.5, vy + 0.5, vz + 0.5]);
      let best = Infinity;
      for (const c of CANDIDATES[reg] ?? []) { const s = segs[c]; if (!s) continue; const dd = segDist(p, s); if (dd < best) { best = dd; bone = c; } }
    }
    cellBone[i] = boneIdx.get(bone ?? rig.top) ?? 1;
  }
  // (One pass toward the neighbours: a cell most of whose neighbours in its region hold another of its bones joins them.)
  const fixed = new Set<number>();
  for (const [i] of r.region) {
    const x = i % g.sx, y = Math.floor(i / g.sx) % g.sy, z = Math.floor(i / (g.sx * g.sy));
    if (assign.some((a) => inRegion(a.r, x + m0[0], y + m0[1], z + m0[2]))) fixed.add(i);
  }
  const next = Int16Array.from(cellBone);
  for (const [i, reg] of r.region) {
    if (fixed.has(i)) continue;
    const x = i % g.sx, y = Math.floor(i / g.sx) % g.sy, z = Math.floor(i / (g.sx * g.sy));
    const votes = new Map<number, number>();
    let n = 0;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      if (!g.occ(x + dx, y + dy, z + dz)) continue;
      const j = g.at(x + dx, y + dy, z + dz);
      if (r.region.get(j) !== reg) continue;
      n += 1;
      votes.set(cellBone[j]!, (votes.get(cellBone[j]!) ?? 0) + 1);
    }
    for (const [b, v] of votes) if (b !== cellBone[i] && v > n / 2 && v >= 3) next[i] = b;
  }
  cellBone.set(next);
  const names = rig.bones.map((b) => b.name);
  for (const [i] of r.region) {
    const x = i % g.sx, y = Math.floor(i / g.sx) % g.sy, z = Math.floor(i / (g.sx * g.sy));
    binding.set(`${x + m0[0]},${y + m0[1]},${z + m0[2]}`, names[cellBone[i]! - 1]!);
  }
  // Skin: greedy boxes per bone and role, in each bone's frame; limb bones as a capsule each unless held rigid.
  const skin = skinFrom(model, g, cellBone, rig, toRig, plan, edits.limbs ?? "auto");
  // Sockets: the contract's, from the proportions and joints, plus any marked by hand.
  let sockets: Record<string, EntitySocket> = { ...socketsOf(specBase) };
  const rest = restJoints(rig) as Record<string, V3>;
  for (const [name, mark] of Object.entries(edits.sockets ?? {})) {
    const j = rest[mark.bone];
    if (!j) throw new RangeError(`socket ${name}: no bone "${mark.bone}" on a ${plan}.`);
    const pos = toRig(mark.at);
    const at: V3 = [pos[0] - j[0], pos[1] - j[1], pos[2] - j[2]];
    const size: V3 = mark.size ? [mark.size[0] * u, mark.size[1] * u, mark.size[2] * u] : [u * 4, u * 4, u * 4];
    const out: V3 = mark.out ? norm3([mark.out[0], mark.out[1], mark.out[2]]) : [0, 1, 0];
    sockets = { ...sockets, [name]: Object.freeze({ name, pos, yaw: 0, size, bone: mark.bone, at, out, part: mark.bone, sits: "surface" as const }) };
  }
  const spec = { ...specBase, voxel: { name: model.name, skin, sockets, analysis: r.analysis } } as VoxelSpec;
  const missing = missingSockets(contractOf({ plan }), sockets);
  return { model, plan, analysis: r.analysis, spec, skin, sockets, missing, binding, edits };
}

function skinFrom(model: VoxelModel, g: Grid, cellBone: Int16Array, rig: Rig, toRig: (p: readonly number[]) => V3, plan: Plan, limbs: "capsule" | "rigid" | "auto"): VoxelSkin {
  const rest = restJoints(rig) as Record<string, V3>;
  const names = rig.bones.map((b) => b.name);
  const segs = segmentsOf(rig);
  const limbSet = new Set<string>(limbs === "rigid" ? [] : plan === "humanoid" ? HUMANOID_LIMBS : QUADRUPED_LIMBS);
  if (limbs === "auto") {
    // (Long for its thickness: its bulk as a round section, against its reach along the bone.)
    const count = new Map<string, number>();
    for (let i = 0; i < g.d.data.length; i += 1) if (g.d.data[i] && cellBone[i]) { const b = names[cellBone[i]! - 1]!; count.set(b, (count.get(b) ?? 0) + 1); }
    for (const b of [...limbSet]) {
      const n = count.get(b) ?? 0;
      const [a, e] = segs[b]!;
      const L = dhypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]) / model.unit;
      const r = Math.sqrt(n / Math.max(1, L) / Math.PI);
      if (!n || L < 3.2 * r) limbSet.delete(b);
    }
  }
  const cells: Record<string, number> = {};
  const labels = new Int32Array(g.d.data.length);
  const capsuleCells = new Map<string, number[]>();
  for (let i = 0; i < g.d.data.length; i += 1) {
    const v = g.d.data[i]!;
    if (!v || !cellBone[i]) continue;
    const bone = names[cellBone[i]! - 1]!;
    cells[bone] = (cells[bone] ?? 0) + 1;
    if (limbSet.has(bone)) { const l = capsuleCells.get(bone) ?? []; l.push(i); capsuleCells.set(bone, l); continue; }
    labels[i] = cellBone[i]! * 256 + v;
  }
  const u = model.unit;
  const boxes: BoundBox[] = [];
  for (const b of greedyGrid(labels, g.d.size, g.d.min, [0, 2, 1])) {
    const bone = names[(b.label >> 8) - 1]!;
    const role = model.roles[(b.label & 255) - 1]!;
    const c = toRig([b.min[0] + b.size[0] / 2, b.min[1] + b.size[1] / 2, b.min[2] + b.size[2] / 2]);
    const j = rest[bone]!;
    boxes.push({ bone, c: [c[0] - j[0], c[1] - j[1], c[2] - j[2]], h: [(b.size[0] / 2) * u, (b.size[1] / 2) * u, (b.size[2] / 2) * u], role });
  }
  const capsules: BoundCapsule[] = [];
  for (const [bone, list] of capsuleCells) {
    const [a, e] = segs[bone]!;
    let dir: V3 = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
    if (dlen(dir) < 1e-9) dir = [0, -1, 0];
    dir = norm3(dir);
    const pts = list.map((i) => toRig([(i % g.sx) + g.d.min[0] + 0.5, (Math.floor(i / g.sx) % g.sy) + g.d.min[1] + 0.5, Math.floor(i / (g.sx * g.sy)) + g.d.min[2] + 0.5]));
    const cen: V3 = [mean(pts.map((p) => p[0])), mean(pts.map((p) => p[1])), mean(pts.map((p) => p[2]))];
    const ts = pts.map((p) => (p[0] - cen[0]) * dir[0] + (p[1] - cen[1]) * dir[1] + (p[2] - cen[2]) * dir[2]);
    const t0 = Math.min(...ts) - u / 2, t1 = Math.max(...ts) + u / 2;
    const len = Math.max(u, t1 - t0);
    // (The same bulk: a cross-section of cells / length, as a circle.)
    const r = Math.max(u * 0.5, Math.sqrt((list.length * u * u * u) / len / Math.PI));
    const ta = Math.min(t0 + r, (t0 + t1) / 2), tb = Math.max(t1 - r, (t0 + t1) / 2);
    const j = rest[bone]!;
    const P = (t: number): V3 => [cen[0] + dir[0] * t - j[0], cen[1] + dir[1] * t - j[1], cen[2] + dir[2] * t - j[2]];
    const votes = new Map<number, number>();
    for (const i of list) votes.set(g.d.data[i]!, (votes.get(g.d.data[i]!) ?? 0) + 1);
    const top = [...votes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]![0];
    capsules.push({ bone, a: P(ta), b: P(tb), r, role: model.roles[top - 1]! });
  }
  return { boxes, capsules, cells };
}

export { poseVoxels } from "./rig-pose.ts";
export type { PosedSolids } from "./rig-pose.ts";

// ---------------------------------------------------------------- overrides

/** The rig with a joint moved (voxel coordinates): re-bound and re-skinned. */
export const moveJoint = (rig: VoxelRig, bone: string, at: readonly [number, number, number]): VoxelRig =>
  autoRig(rig.model, { ...rig.edits, plan: rig.plan, joints: { ...(rig.edits.joints ?? {}), [bone]: [at[0], at[1], at[2]] } });

/** The rig with a region of voxels given to a bone. */
export const reassign = (rig: VoxelRig, region: { from: Vec3i; to: Vec3i }, bone: string): VoxelRig =>
  autoRig(rig.model, { ...rig.edits, plan: rig.plan, assign: [...(rig.edits.assign ?? []), { from: region.from, to: region.to, bone }] });

/** The rig with a socket marked on a bone (voxel coordinates). */
export const markSocket = (rig: VoxelRig, name: string, mark: SocketMark): VoxelRig =>
  autoRig(rig.model, { ...rig.edits, plan: rig.plan, sockets: { ...(rig.edits.sockets ?? {}), [name]: mark } });

/** How far the rig's joints are from where they should be (voxels): per joint, mean and worst. */
export function jointError(rig: VoxelRig, truth: Readonly<Record<string, readonly [number, number, number]>>): { mean: number; max: number; worst: string; each: Record<string, number> } {
  const u = rig.model.unit;
  const rest = restJoints(rig.spec.rig) as Record<string, V3>;
  const O = rig.analysis.origin;
  const each: Record<string, number> = {};
  for (const [k, t] of Object.entries(truth)) {
    const j = rest[k];
    if (!j) continue;
    each[k] = dhypot(j[0] / u + O[0] - t[0], j[1] / u + O[1] - t[1], j[2] / u + O[2] - t[2]);
  }
  const vals = Object.values(each);
  const worst = Object.entries(each).sort((a, b) => b[1] - a[1])[0];
  return { mean: mean(vals), max: Math.max(0, ...vals), worst: worst ? worst[0] : "", each };
}

/** Which region (of the analysis) each cell fell in, for an editor overlay: "x,y,z" -> region. */
export function regionsOf(model: VoxelModel, plan?: Plan): Map<string, string> {
  const g = gridOf(model);
  const r = read(model, g, plan);
  const out = new Map<string, string>();
  const m0 = g.d.min;
  for (const [i, reg] of r.region) out.set(`${(i % g.sx) + m0[0]},${(Math.floor(i / g.sx) % g.sy) + m0[1]},${Math.floor(i / (g.sx * g.sy)) + m0[2]}`, reg);
  return out;
}

export type { Region };
