// Body vs attributes. Is it a creature (a skin whose joints read as two or
// four legs, or a shape the builder's rig reads as one)? Then which parts are
// the body and which are worn or carried -- and for each worn thing, which
// socket it sits in.
//
// A part is worn when it is SEPARABLE and sits ON the body, not IN it:
//   + its own mesh (or a piece of its own: disconnected)          strong
//   + it wraps a body part (a ring, a cover: rays from the body   strong
//     beside it meet it on many sides) -- a collar, a helmet
//   + a name that says so (helmet, cape, sword, collar, belt ...)
//   - a name that says body (arm, leg, head, torso ...)
//   - hidden inside (most of it has no open face: teeth, eyeballs)
//   - big (a third of everything is a body, not a hat)
//   - skinned to a region the core body lacks (a separate head mesh IS the head)
// A material region of the body's own mesh that doesn't wrap anything is a
// MARK (eyes, a nose, a belly patch): it stays body, recoloured by its role.
//
// Sockets: every socket the rig gives the body, scored for each worn part --
// how near its nearest cell comes and how near its middle sits, a ring round
// an "around" socket, behind the back for "back", above the crown for
// "head", the skin bone it's weighted to, its name -- the best wins, with its
// margin over the runner-up as the confidence.

import type { EntitySocket, Plan } from "@keel-engine/entity";
import type { VoxelRig } from "@keel-engine/builder";
import type { V3 } from "./math.ts";
import { regionOfBone } from "./skeleton.ts";
import type { SkeletonMap } from "./skeleton.ts";
import type { PartNode, Segmentation } from "./segment.ts";
import type { VoxelGrid } from "./voxelize.ts";

/** Words that name worn things, and the sockets they go in (first: the likeliest). */
export const ATTRIBUTE_WORDS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\b(helmet|helm|hat|cap|crown|hood|beanie|tiara|headband|halo|horns?|bandana|turban)\b/, ["head"]],
  [/\b(glasses|goggles|visor|mask|monocle|eyepatch|spectacles)\b/, ["face"]],
  [/\b(collar|scarf|necklace|neckerchief|bell|choker|amulet|pendant|tie|bowtie)\b/, ["neck"]],
  [/\b(cape|cloak|backpack|pack|quiver|wings?|jetpack|bag|satchel|saddle|saddlebags?|shell)\b/, ["back"]],
  [/\b(belt|holster|skirt|sash|kilt|pouch)\b/, ["waist"]],
  [/\b(shield|buckler|lantern|book)\b/, ["hand.L"]],
  [/\b(sword|axe|blade|dagger|knife|spear|staff|wand|mace|hammer|gun|pistol|rifle|bow|torch|club|weapon|sabre|saber|katana|lance|trident|pickaxe|tool)\b/, ["hand.R"]],
  [/\b(boots?|shoes?|sandals?|greaves?|clogs?|sneakers?)\b/, ["foot.L", "foot.R", "paw.FL", "paw.FR", "paw.HL", "paw.HR"]],
  [/\b(armou?r|chestplate|breastplate|vest|badge|bib|harness|medal)\b/, ["chest"]],
  [/\b(antenna|antennae|feather|plume)\b/, ["head"]],
];
const BODY_WORDS = /\b(body|torso|trunk|head|arms?|legs?|hands?|feet|foot|skin|hair|face|eyes?|mouth|teeth|tongue|tail|ears?|nose|snout|paws?|neck|hips|chest|belly|fur|base|plinth|pedestal|figure)\b/;

export interface PartFeatures {
  readonly exposure: number;
  readonly enclosure: number;
  readonly contact: number;
  readonly share: number;
  readonly ownNode: boolean;
  readonly disconnected: boolean;
}

const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

/** Words of a part's names (its node's, its materials'). */
const wordsOf = (p: PartNode): string => `${p.id} ${p.nodeName} ${p.materials.slice(0, 1).map((m) => m[0]).join(" ")}`.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ");

/** The sockets a part's name says (empty: no word). */
export function socketsByName(p: PartNode): readonly string[] {
  const w = ` ${p.id.replace(/[^a-z0-9]+/g, " ")} ${p.nodeName.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const [re, sockets] of ATTRIBUTE_WORDS) if (re.test(w)) return sockets;
  return [];
}

/** How a part sits against a set of body parts: exposure, enclosure (rays from the body beside it meeting it), contact. */
export function featuresOf(grid: VoxelGrid, seg: Segmentation, part: number, body: ReadonlySet<number>, coreNode: number): PartFeatures {
  const [sx, sy, sz] = grid.size;
  const { label } = seg;
  const at = (x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? -2 : label[x + sx * (y + sy * z)]!);
  let cells = 0, open = 0, contact = 0;
  const beside = new Set<number>();
  let total = 0;
  for (let i = 0; i < label.length; i += 1) {
    if (label[i]! >= 0) total += 1;
    if (label[i] !== part) continue;
    cells += 1;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    let isOpen = false;
    for (const [dx, dy, dz] of N6) {
      const q = at(x + dx, y + dy, z + dz);
      if (q < 0) isOpen = true;
      else if (q !== part && body.has(q)) { contact += 1; beside.add((x + dx) + sx * ((y + dy) + sy * (z + dz))); }
    }
    if (isOpen) open += 1;
    // (Body cells within two cells of it -- not only touching -- are what it may wrap: a helmet sits a cell off the head.)
    for (let dz = -2; dz <= 2; dz += 1) for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const q = at(x + dx, y + dy, z + dz);
      if (q >= 0 && q !== part && body.has(q)) beside.add((x + dx) + sx * ((y + dy) + sy * (z + dz)));
    }
  }
  // Enclosure: from body cells beside it, the six axis rays -- through anything solid -- meet it before open air?
  const list = [...beside].sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(list.length / 600));
  let rays = 0, hits = 0;
  const reach = Math.max(sx, sy, sz);
  for (let k = 0; k < list.length; k += step) {
    const i = list[k]!;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [dx, dy, dz] of N6) {
      rays += 1;
      for (let s = 1; s <= reach; s += 1) {
        const q = at(x + dx * s, y + dy * s, z + dz * s);
        if (q === part) { hits += 1; break; }
        if (q < 0) break;
      }
    }
  }
  const p = seg.parts[part]!;
  return {
    exposure: cells ? open / cells : 0, enclosure: rays ? hits / rays : 0, contact, share: total ? cells / total : 0,
    ownNode: p.node !== coreNode, disconnected: contact === 0,
  };
}

export interface Classified { readonly kind: "attribute" | "body" | "mark"; readonly score: number; readonly why: string[] }

/** Is this part worn (see the top)? `coreRegions`: body regions the core has cells in (for the skin test). */
export function classify(p: PartNode, f: PartFeatures, { regionOf, coreRegions }: { regionOf?: (joint: number) => string | null; coreRegions?: ReadonlySet<string> } = {}): Classified {
  const why: string[] = [];
  let score = 0;
  const named = socketsByName(p);
  const words = wordsOf(p);
  if (f.ownNode) { score += 0.4; why.push("its own mesh"); }
  if (f.disconnected) { score += 0.15; why.push("doesn't touch the body"); }
  if (named.length) { score += 0.35; why.push(`named like a worn thing (${named[0]})`); }
  else if (BODY_WORDS.test(words)) { score -= 0.6; why.push("named like a body part"); }
  if (f.enclosure >= 0.3) { score += 0.25; why.push(`wraps the body beside it (${Math.round(f.enclosure * 100)}% of rays meet it)`); }
  else score += f.enclosure * 0.5;
  if (f.exposure < 0.12) { score -= 0.4; why.push(`mostly hidden inside (${Math.round(f.exposure * 100)}% open)`); }
  if (f.share > 0.3) { score -= 0.6; why.push(`too big to wear (${Math.round(f.share * 100)}% of the model)`); }
  if (!f.ownNode && f.enclosure < 0.3 && !named.length) { score -= 0.3; why.push("a region of the body's own mesh that wraps nothing: a mark"); }
  if (regionOf && coreRegions && p.joint >= 0 && p.jointShare > 0.6) {
    const r = regionOf(p.joint);
    if (r && !coreRegions.has(r)) { score -= 0.7; why.push(`skinned to the ${r}, which the body hasn't got without it: it IS the ${r}`); }
  }
  const kind = score >= 0.45 ? "attribute" : !f.ownNode && !f.disconnected ? "mark" : "body";
  return { kind, score: +score.toFixed(3), why };
}

// ---------------------------------------------------------------- sockets

export interface SocketChoice { readonly socket: string; readonly confidence: number; readonly scores: Readonly<Record<string, number>>; readonly why: string[] }

/** Socket positions in grid coordinates (cell units, continuous), from a rig on a model offset by `off` from the grid. */
export function socketsInGrid(rig: VoxelRig, off: V3): Record<string, { s: EntitySocket; p: V3 }> {
  const u = rig.model.unit, O = rig.analysis.origin;
  const out: Record<string, { s: EntitySocket; p: V3 }> = {};
  for (const [name, s] of Object.entries(rig.sockets)) out[name] = { s, p: [s.pos[0] / u + O[0] + off[0], s.pos[1] / u + O[1] + off[1], s.pos[2] / u + O[2] + off[2]] };
  return out;
}

/** Which socket a worn part sits in (see the top). `bodyHeight` in cells; `boneOf`: a skin joint's contract bone. */
export function chooseSocket(grid: VoxelGrid, seg: Segmentation, part: number, sockets: Readonly<Record<string, { s: EntitySocket; p: V3 }>>, { bodyHeight, plan, boneOf }: { bodyHeight: number; plan: Plan; boneOf?: (joint: number) => string | null }): SocketChoice {
  const [sx, sy] = grid.size;
  const p = seg.parts[part]!;
  const cells: V3[] = [];
  for (let i = 0; i < seg.label.length; i += 1) if (seg.label[i] === part) cells.push([(i % sx) + 0.5, (Math.floor(i / sx) % sy) + 0.5, Math.floor(i / (sx * sy)) + 0.5]);
  const H = Math.max(4, bodyHeight);
  const named = socketsByName(p);
  const bone = boneOf && p.joint >= 0 ? boneOf(p.joint) : null;
  const scores: Record<string, number> = {};
  const whys: Record<string, string[]> = {};
  const c = p.centroid;
  for (const [name, { s, p: sp }] of Object.entries(sockets)) {
    const why: string[] = [];
    let dmin = Infinity;
    for (const q of cells) dmin = Math.min(dmin, Math.hypot(q[0] - sp[0], q[1] - sp[1], q[2] - sp[2]));
    const dc = Math.hypot(c[0] - sp[0], c[1] - sp[1], c[2] - sp[2]);
    let score = 0.6 * Math.exp(-((dmin / H / 0.07) ** 2)) + 0.4 * Math.exp(-((dc / H / 0.16) ** 2));
    why.push(`nearest ${dmin.toFixed(1)}, middle ${dc.toFixed(1)} cells off`);
    // (Round an "around" socket: its cells fill most of eight sectors round it, in one of the three planes.)
    if (s.sits === "around") {
      let best = 0;
      for (const [a, b] of [[0, 2], [0, 1], [1, 2]] as const) {
        const sectors = new Set<number>();
        const band = s.size[1] / grid.unit * 0.5 + 1.5;
        for (const q of cells) {
          const other = 3 - a - b;
          if (Math.abs(q[other]! - sp[other]!) > band * 1.5) continue;
          const da = q[a]! - sp[a]!, db = q[b]! - sp[b]!;
          if (Math.hypot(da, db) < 0.5) continue;
          sectors.add(Math.floor(((Math.atan2(db, da) + Math.PI) / (2 * Math.PI)) * 8) % 8);
        }
        best = Math.max(best, sectors.size);
      }
      if (best >= 6) { score += 0.25; why.push(`rings it (${best}/8 sides)`); }
    }
    if (name === "back" && c[2] < sp[2] + 0.5) { score += 0.2; why.push("behind the body"); }
    if ((name === "chest" || name === "face") && c[2] > sp[2] - 1) { score += 0.1; why.push("in front"); }
    if (name === "head" && p.max[1] + 1 >= sp[1]) { score += 0.15; why.push("reaches the crown"); }
    if (named.includes(name)) { score += named[0] === name ? 0.6 : 0.4; why.push("its name says so"); }
    if (bone && skinAgrees(name, s.bone, bone, plan)) { score += 0.35; why.push(`skinned to ${bone}`); }
    scores[name] = +score.toFixed(3);
    whys[name] = why;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const [best, second] = ranked;
  if (!best) return { socket: "", confidence: 0, scores, why: ["the body has no sockets"] };
  return { socket: best[0], confidence: +(best[1] / (best[1] + (second?.[1] ?? 0) || 1)).toFixed(2), scores, why: whys[best[0]]! };
}

/** Does a part skinned to `bone` belong in this socket? Its own bone; its region for the trunk's sockets; a forearm for a hand, a shin for a foot. */
function skinAgrees(socket: string, socketBone: string, bone: string, plan: Plan): boolean {
  if (socketBone === bone) return true;
  const side = bone.slice(-2);
  if (socket.startsWith("hand.")) return socket.endsWith(side) && /^(forearm|hand)\./.test(bone);
  if (socket.startsWith("foot.")) return socket.endsWith(side) && /^(shin|foot)\./.test(bone);
  if (socket.startsWith("paw.")) return bone.endsWith(socket.slice(3)) && /^(lower|paw)\./.test(bone);
  return regionOfBone(socketBone, plan) === regionOfBone(bone, plan);
}

/** A skeleton map's bone for a source joint, walking up to the nearest mapped ancestor. */
export function boneOfJoint(map: SkeletonMap, jointIndexOfNode: ReadonlyMap<number, number>, parents: readonly number[]): (node: number) => string | null {
  return (node) => {
    let j = jointIndexOfNode.get(node);
    for (let guard = 0; j !== undefined && j >= 0 && guard < 64; guard += 1) {
      const b = map.of.get(j);
      if (b) return b;
      j = parents[j];
    }
    return null;
  };
}
