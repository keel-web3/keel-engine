// importModel: a 3D file -> the builder's own data, and a proposal to review.
//
//   parse       glTF/GLB, OBJ(+MTL), STL, .vox (told apart by their bytes)
//   voxelise    at a resolution (cells along the longest side, or metres per cell)
//   segment     meshes, pieces, materials (and later body regions, narrowing)
//   read        a creature? (skin joints named as two or four legs, or a shape
//               the builder's rig reads as one) -- else a prop
//   split       which parts are worn (scored cues) and which socket each sits in
//   rig         the body alone (worn things out of it), on the contract's
//               bones: the skeleton's joints where it has one, else the shape's
//   roles       colours clustered into roles; the source colours kept as a look
//   outputs     (a) voxels: a VoxelModel, groups = parts; the body; each worn
//               part as an attribute sized to its socket (so it fits other bodies)
//               (b) primitive fit: boxes/capsules/wedges per part -- a fitted skin
//               on the rig, a generative base with variation rules
//               (c) an object for props (colliders, a detected front, top sockets)
//   proposal    the part graph, the split, sockets and confidences, as plain
//               data, and the builder OP LIST that replays it live (streamOps)
//
//   const r = importModel(bytes, { name: "knight", voxels: 64 });
//   r.proposal.attributes;  r.ops;  replayImport(r.ops);   // review, replay, use

import { analyseShape, attributeFromVoxels, autoRig, buildSession, createVoxels, entityFromVoxels, greedyBoxes, objectFromVoxels, opsOf, runOps } from "@keel-engine/builder";
import type { AgentOp, Anchor, Built, VariationRules, VoxelAttributeShape, VoxelModel, VoxelObjectMeta, VoxelRig, VoxelSpec } from "@keel-engine/builder";
import { contractOf } from "@keel-engine/entity";
import type { EntitySocket, Plan } from "@keel-engine/entity";
import { defineObject } from "@keel-engine/object";
import type { ObjectDef } from "@keel-engine/object";
import type { AttributeDef, EntityDef } from "@keel-engine/runtime";
import { boneOfJoint, chooseSocket, classify, featuresOf, socketsInGrid } from "./body.ts";
import type { Classified } from "./body.ts";
import { fitPart, fittedSkin, iouWith, rasterPrims } from "./fit.ts";
import type { PartFit, Prim } from "./fit.ts";
import { isGlb, parseGltf } from "./gltf.ts";
import type { GltfOptions } from "./gltf.ts";
import type { V3 } from "./math.ts";
import { parseObj } from "./obj.ts";
import type { ObjOptions } from "./obj.ts";
import { clusterRoles } from "./roles.ts";
import type { Oklch, RoleOptions, Roles } from "./roles.ts";
import { ImportError, jointPosition } from "./scene.ts";
import type { Format, ImportScene } from "./scene.ts";
import { measure, narrowingCut, segmentSource, uniqueIds } from "./segment.ts";
import type { PartEdge, PartNode, Segmentation } from "./segment.ts";
import { mapSkeleton, regionOfBone } from "./skeleton.ts";
import type { SkeletonMap } from "./skeleton.ts";
import { isBinaryStl, parseStl } from "./stl.ts";
import { isVox, parseVox } from "./vox.ts";
import { voxelize } from "./voxelize.ts";
import type { VoxelGrid, VoxelizeOptions } from "./voxelize.ts";

export interface ImportOptions extends VoxelizeOptions {
  /** The thing's name (default the file's). */
  readonly name?: string;
  /** The format, when the bytes don't say (OBJ text vs ASCII STL). */
  readonly format?: Format;
  /** glTF: external buffers and images by URI; OBJ: MTL files and textures by name. */
  readonly resources?: GltfOptions["resources"];
  readonly mtl?: ObjOptions["mtl"];
  readonly images?: ObjOptions["images"];
  readonly decodeImage?: GltfOptions["decodeImage"];
  /** Metres per source unit (OBJ/STL; glTF is metres). */
  readonly metres?: number;
  /** "auto" (default): a creature if it reads as one; or force it. */
  readonly as?: "auto" | "creature" | "object";
  readonly plan?: Plan;
  /** The importing pack (its attributes' pack, in the proposal). */
  readonly pack?: string;
  readonly roles?: Omit<RoleOptions, "creature" | "bodyCells">;
}

export type ImportInput = Uint8Array | string | ImportScene;

/** A worn part, as the attribute it becomes. */
export interface AttributeProposal {
  readonly part: string;
  readonly id: string;
  readonly slot: string;
  /** How it's built to the socket (attributeFromVoxels): width-fit at `fill`, the anchor face, an offset in socket sizes -- so on its own body it lands where it was, and on any other it scales with the socket. */
  readonly fit: "width";
  readonly fill: number;
  readonly anchor: Exclude<Anchor, "auto">;
  readonly offset: [number, number, number];
  readonly targets: ReadonlyArray<{ readonly body: string }>;
  readonly pack: string;
  readonly confidence: number;
  readonly socketConfidence: number;
  readonly reason: readonly string[];
  readonly scores: Readonly<Record<string, number>>;
  /** Its voxels (same unit and coordinates as the model) and the runtime attribute. */
  readonly model: VoxelModel;
  readonly def: AttributeDef<VoxelAttributeShape>;
}

export interface CreatureReading {
  readonly plan: Plan;
  readonly source: "skin" | "shape" | "forced";
  readonly confidence: number;
  readonly why: readonly string[];
  readonly skeleton: SkeletonMap | null;
  /** Contract joints placed from the source skeleton (builder voxel coordinates). */
  readonly joints: Readonly<Record<string, V3>>;
}

/** What the proposal says about each part (plain data: what the editor lists and an agent reads). */
export interface ProposalPart {
  readonly id: string;
  readonly kind: PartNode["kind"];
  readonly cells: number;
  readonly min: V3;
  readonly max: V3;
  readonly source: string;
  readonly materials: readonly string[];
  readonly region?: string;
  readonly socket?: string;
  readonly confidence: number;
  readonly cues: readonly string[];
  readonly why: readonly string[];
  readonly fit?: { readonly chosen: string; readonly iou: number; readonly prims: number };
}

/** The import as a document to review: the part graph, the split, the sockets, confidences -- plain JSON. */
export interface ImportProposal {
  readonly version: "keel-import@1";
  readonly name: string;
  readonly source: { readonly format: Format; readonly nodes: number; readonly meshes: number; readonly materials: number; readonly triangles: number; readonly skinned: boolean; readonly warnings: readonly string[] };
  readonly grid: { readonly size: V3; readonly unit: number; readonly voxels: number; readonly surface: number };
  readonly kind: "creature" | "object";
  readonly creature?: { readonly plan: Plan; readonly source: string; readonly confidence: number; readonly why: readonly string[]; readonly bones: Readonly<Record<string, string>>; readonly missing: readonly string[] };
  readonly roles: ReadonlyArray<{ readonly role: string; readonly oklch: Oklch; readonly share: number; readonly materials: readonly string[]; readonly why: string }>;
  readonly look: { readonly name: "source"; readonly colours: Readonly<Record<string, Oklch>> };
  readonly parts: readonly ProposalPart[];
  readonly edges: ReadonlyArray<{ readonly a: string; readonly b: string; readonly contact: number; readonly cues: readonly string[]; readonly confidence: number }>;
  readonly attributes: ReadonlyArray<{ readonly part: string; readonly id: string; readonly slot: string; readonly fill: number; readonly anchor: string; readonly offset: readonly number[]; readonly targets: readonly string[]; readonly pack: string; readonly confidence: number; readonly reason: readonly string[] }>;
  readonly object?: { readonly front: number | null; readonly frontFrom: string; readonly frontConfidence: number; readonly colliders: number; readonly sockets: readonly string[]; readonly figures: ReadonlyArray<{ readonly part: string; readonly plan: Plan; readonly confidence: number }>; readonly why: readonly string[] };
  readonly generative: { readonly prims: number; readonly iou: number; readonly rules: VariationRules };
}

export interface ImportResult {
  readonly scene: ImportScene;
  readonly grid: VoxelGrid;
  readonly roles: Roles;
  readonly segmentation: Segmentation;
  /** Every part as a group, cells as roles. */
  readonly model: VoxelModel;
  /** The body alone (worn parts taken out). */
  readonly body: VoxelModel;
  readonly creature: CreatureReading | null;
  readonly rig: VoxelRig | null;
  readonly attributes: readonly AttributeProposal[];
  readonly object: ObjectDef<VoxelObjectMeta> | null;
  /** (b) primitive fit: per part, and for a creature a fitted skin on its rig (a VoxelSpec the animator and poseVoxels take). */
  readonly fitted: { readonly parts: Readonly<Record<string, PartFit>>; readonly spec: VoxelSpec | null; readonly prims: readonly Prim[]; readonly iou: number };
  /** The generative base: the fitted primitives as clean voxels, with variation rules, and what the builder makes of it. */
  readonly generative: { readonly model: VoxelModel; readonly rules: VariationRules; readonly entity: EntityDef<VoxelSpec> | null; readonly object: ObjectDef | null; readonly ops: AgentOp[] };
  readonly proposal: ImportProposal;
  /** The builder op list that replays the import (streamOps draws it live). */
  readonly ops: AgentOp[];
  readonly offset: V3;
  readonly timings: Readonly<Record<string, number>>;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : 0);

/** Parse any supported file (format told from its bytes, else `format`, else the text). */
export function parseModel(input: ImportInput, opts: Pick<ImportOptions, "format" | "name" | "resources" | "mtl" | "images" | "decodeImage" | "metres"> = {}): ImportScene {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) return input;
  const name = opts.name;
  const bytes = typeof input === "string" ? null : input;
  const text = typeof input === "string" ? input : null;
  const fmt = opts.format ?? (bytes && isGlb(bytes) ? "glb" : bytes && isVox(bytes) ? "vox" : bytes && isBinaryStl(bytes) ? "stl" : (() => {
    const t = (text ?? new TextDecoder().decode(bytes!.subarray(0, 2048))).trimStart();
    if (t.startsWith("{")) return "gltf";
    if (/^solid\b/.test(t) && /facet|endsolid/.test(text ?? new TextDecoder().decode(bytes!))) return "stl";
    if (/^(v|vt|vn|f|o|g|mtllib|usemtl|#)\s/m.test(t)) return "obj";
    return null;
  })());
  const m = opts.metres !== undefined ? { metres: opts.metres } : {};
  switch (fmt) {
    case "glb": case "gltf": return parseGltf(bytes ?? text!, { ...(name ? { name } : {}), ...(opts.resources ? { resources: opts.resources } : {}), ...(opts.decodeImage ? { decodeImage: opts.decodeImage } : {}) });
    case "obj": return parseObj(text ?? new TextDecoder().decode(bytes!), { ...(name ? { name } : {}), ...(opts.mtl ? { mtl: opts.mtl } : {}), ...(opts.images ? { images: opts.images } : {}), ...m });
    case "stl": return parseStl(bytes ?? text!, { ...(name ? { name } : {}), ...m });
    case "vox": if (!bytes) throw new ImportError("VOX", "is binary: pass bytes"); return parseVox(bytes, { ...(name ? { name } : {}), ...m });
    default: throw new ImportError("import", "not glTF, GLB, OBJ, STL or .vox (pass `format` if it is one)");
  }
}

/** A socket's builder name as a part noun, for worn parts with no name of their own. */
const SOCKET_NOUN: Readonly<Record<string, string>> = { head: "headwear", face: "facewear", neck: "neckwear", chest: "chestpiece", back: "backpiece", waist: "beltwear", "hand.L": "held-left", "hand.R": "held-right", "foot.L": "footwear-left", "foot.R": "footwear-right", tail: "tailwear" };
const GENERIC = /^(part|node|mesh|model|object|group|default|solid|stl|geometry)(-\d+)?$/;

/** Import a model (see the top). */
export function importModel(input: ImportInput, opts: ImportOptions = {}): ImportResult {
  const timings: Record<string, number> = {};
  let t = now();
  const lap = (k: string): void => { const n = now(); timings[k] = Math.round(n - t); t = n; };
  const scene = parseModel(input, opts);
  const name = (opts.name ?? scene.name ?? "import").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "import";
  lap("parse");
  const grid = voxelize(scene, opts);
  lap("voxelize");
  const [sx, sy, sz] = grid.size;
  const off: V3 = [Math.floor(sx / 2), 0, Math.floor(sz / 2)];
  const seg = segmentSource(grid);
  lap("segment");
  const pack = opts.pack ?? "packs/imported";

  // The source skeleton, if skinned: its joints, their parents among them, mapped to a contract.
  let skel: SkeletonMap | null = null;
  const jointNodes: number[] = [];
  const jointIndex = new Map<number, number>();
  const jointParents: number[] = [];
  if (grid.skinned) {
    for (const s of scene.skins) for (const j of s.joints) if (!jointIndex.has(j)) { jointIndex.set(j, jointNodes.length); jointNodes.push(j); }
    for (const j of jointNodes) {
      let p = scene.nodes[j]!.parent;
      while (p >= 0 && !jointIndex.has(p)) p = scene.nodes[p]!.parent;
      jointParents.push(p >= 0 ? jointIndex.get(p)! : -1);
    }
    skel = mapSkeleton(jointNodes.map((j) => scene.nodes[j]!.name), jointParents);
  }
  const boneOf = skel ? boneOfJoint(skel, jointIndex, jointParents) : null;
  const skinPlan = skel?.plan && skel.confidence >= 0.5 ? skel.plan : null;
  const regionOfJoint = (node: number): string | null => { const b = boneOf?.(node); return b && skinPlan ? regionOfBone(b, skinPlan) : null; };

  // The core: the biggest part, and the parts of its mesh it touches (through each other).
  const partsOf = (pred: (p: PartNode) => boolean): number[] => seg.parts.filter(pred).map((p) => p.index);
  let big = [...seg.parts].sort((a, b) => b.cells - a.cells || a.index - b.index)[0]!;
  if (skinPlan) {
    // (Skinned: the node whose cells span the most body regions is the body -- a sword skinned to a hand spans one.)
    const spans = new Map<number, Set<string>>();
    for (let i = 0; i < grid.occ.length; i += 1) {
      if (!grid.occ[i] || grid.joint[i]! < 0) continue;
      const r = regionOfJoint(grid.joint[i]!);
      if (!r) continue;
      const set = spans.get(grid.node[i]!) ?? new Set<string>();
      set.add(r);
      spans.set(grid.node[i]!, set);
    }
    const bodyNode = [...spans.entries()].sort((a, b) => b[1].size - a[1].size || a[0] - b[0])[0]?.[0];
    const inNode = seg.parts.filter((p) => p.node === bodyNode).sort((a, b) => b.cells - a.cells);
    if (inNode[0]) big = inNode[0];
  }
  const coreNode = big.node;
  const core = new Set<number>([big.index]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of seg.edges) {
      const [a, b] = [e.a, e.b];
      if (core.has(a) !== core.has(b)) {
        const other = core.has(a) ? b : a;
        if (seg.parts[other]!.node === coreNode) { core.add(other); grew = true; }
      }
    }
  }
  // The skin test: body regions the core's cells cover.
  const coreRegions = new Set<string>();
  if (skinPlan) for (let i = 0; i < grid.occ.length; i += 1) if (core.has(seg.label[i]!) && grid.joint[i]! >= 0) { const r = regionOfJoint(grid.joint[i]!); if (r) coreRegions.add(r); }

  // Classify every other part against the body.
  const classes = new Map<number, Classified>();
  for (const p of seg.parts) {
    if (p.index === big.index) continue;
    const body = new Set<number>([...core].filter((c) => c !== p.index));
    const f = featuresOf(grid, seg, p.index, body.size ? body : new Set([big.index]), coreNode);
    classes.set(p.index, classify(p, f, skinPlan ? { regionOf: regionOfJoint, coreRegions } : {}));
  }
  lap("classify");

  // A creature? The skin's names, else the shape of the body (worn parts out) as the builder's rig reads it.
  const bodyParts = (): number[] => partsOf((p) => p.index === big.index || classes.get(p.index)?.kind !== "attribute");
  const modelOf = (parts: readonly number[], nm: string, roleNames?: (i: number) => string): VoxelModel => {
    const keep = new Set(parts);
    const m = createVoxels({ unit: grid.unit, name: nm });
    for (let i = 0; i < seg.label.length; i += 1) {
      if (!keep.has(seg.label[i]!)) continue;
      m.set((i % sx) - off[0], Math.floor(i / sx) % sy, Math.floor(i / (sx * sy)) - off[2], roleNames ? roleNames(i) : "primary");
    }
    return m;
  };
  let creature: CreatureReading | null = null;
  const notCreature: string[] = [];
  const forced =opts.as === "creature" ? opts.plan ?? skinPlan ?? null : null;
  if (opts.as !== "object") {
    if (skinPlan && !opts.plan) creature = { plan: skinPlan, source: "skin", confidence: +(0.5 + skel!.confidence / 2).toFixed(2), why: [...skel!.why], skeleton: skel, joints: {} };
    else {
      const probe = modelOf(bodyParts(), `${name}-probe`);
      try {
        const a = analyseShape(probe, opts.plan ? { plan: opts.plan } : {});
        const tall = (probe.bounds()!.max[1] - probe.bounds()!.min[1] + 1);
        const ground = standsOnFeet(probe);
        const reads = a.legs.length >= 2 && a.confidence >= 0.5 && tall >= 8 && ground.feet;
        const why = [...a.why, ground.why];
        if (reads || opts.as === "creature") creature = { plan: opts.plan ?? a.plan, source: opts.as === "creature" ? "forced" : "shape", confidence: +a.confidence.toFixed(2), why, skeleton: skel, joints: {} };
        else notCreature.push(...why);
      } catch (e) {
        if (opts.as === "creature") throw e;
      }
    }
    if (!creature && forced) creature = { plan: forced, source: "forced", confidence: 0.5, why: ["forced"], skeleton: skel, joints: {} };
  }
  lap("read");

  // Kinds: a prop's parts are all props; a creature's are body, marks and worn things.
  for (const p of seg.parts) {
    const c = classes.get(p.index);
    p.kind = !creature ? "prop" : p.index === big.index ? "body" : c!.kind;
    p.why = !creature ? [] : p.index === big.index ? ["the body: its biggest part"] : [...c!.why];
    p.confidence = p.index === big.index ? 1 : !creature ? 0.5 : +Math.min(0.99, Math.max(0.05, 0.5 + (c!.score - 0.45) * (c!.kind === "attribute" ? 1.2 : -1.2))).toFixed(2);
  }

  // A creature: rig the body alone; its cells split by body region (skin weights, else the rig's binding).
  let rig: VoxelRig | null = null;
  const figures: Array<{ part: string; plan: Plan; confidence: number }> = [];
  if (creature) {
    const bodyIdx = bodyParts();
    const bodyModel = modelOf(bodyIdx, name);
    const joints: Record<string, V3> = {};
    if (creature.source === "skin" && skel) {
      for (const [bone, ji] of Object.entries(skel.bones)) {
        const p = jointPosition(scene, jointNodes[ji]!, { ...(opts.axes ? { axes: opts.axes } : {}), scale: grid.scale / scene.metres });
        joints[bone] = [+((p[0] - grid.origin[0]) / grid.unit - off[0]).toFixed(3), +((p[1] - grid.origin[1]) / grid.unit).toFixed(3), +((p[2] - grid.origin[2]) / grid.unit - off[2]).toFixed(3)];
      }
      delete joints["shoulder.L"]; delete joints["shoulder.R"];
    }
    try {
      rig = autoRig(bodyModel, { plan: creature.plan, ...(Object.keys(joints).length ? { joints } : {}) });
      creature = { ...creature, joints };
    } catch (e) {
      if (opts.as === "creature") throw e;
      creature = null;
      for (const p of seg.parts) { p.kind = "prop"; p.why = [`rigging failed (${(e as Error).message}): a prop`]; }
    }
  }
  if (creature && rig) {
    // Body cells -> regions.
    const regionCells = new Map<string, number[]>();
    const bodySet = new Set(bodyParts());
    for (let i = 0; i < seg.label.length; i += 1) {
      if (!bodySet.has(seg.label[i]!)) continue;
      let r: string | null = null;
      if (creature.source === "skin" && grid.joint[i]! >= 0) r = regionOfJoint(grid.joint[i]!);
      if (!r) {
        const b = rig.binding.get(`${(i % sx) - off[0]},${Math.floor(i / sx) % sy},${Math.floor(i / (sx * sy)) - off[2]}`);
        r = b ? regionOfBone(b, creature.plan) : "torso";
      }
      const l = regionCells.get(r) ?? [];
      l.push(i);
      regionCells.set(r, l);
    }
    const marks = seg.parts.filter((p) => bodySet.has(p.index) && p.kind === "mark").map((p) => p.id);
    const kept = seg.parts.filter((p) => !bodySet.has(p.index));
    foldTinyRegions(regionCells);
    const regions = [...regionCells.keys()].sort();
    const newParts: PartNode[] = regions.map((r, k) => ({
      id: r, index: k, cells: 0, surface: 0, min: [0, 0, 0], max: [0, 0, 0], centroid: [0, 0, 0], node: coreNode, nodeName: seg.parts[big.index]!.nodeName, materials: [], joint: -1, jointShare: 0,
      region: r, cues: [creature!.source === "skin" ? "skin weights: the dominant joint's body region" : "the rig's reading: limbs where the section narrows along the bones"], confidence: creature!.source === "skin" ? 0.85 : 0.7,
      kind: "body", why: [`the ${r}${marks.length ? `; marks folded in: ${marks.join(", ")}` : ""}`],
    }));
    const relabel = new Int32Array(seg.label.length).fill(-1);
    regions.forEach((r, k) => { for (const i of regionCells.get(r)!) relabel[i] = k; });
    const keptAt = new Map(kept.map((p, k) => [p.index, regions.length + k]));
    for (let i = 0; i < seg.label.length; i += 1) { const k = keptAt.get(seg.label[i]!); if (k !== undefined) relabel[i] = k; }
    seg.label.set(relabel);
    seg.parts.length = 0;
    seg.parts.push(...newParts, ...kept);
    measure(grid, seg);
    // Sockets for the worn parts.
    const sockets = socketsInGrid(rig, off);
    const bodyH = rig.model.bounds() ? rig.model.bounds()!.max[1] - rig.model.bounds()!.min[1] + 1 : sy;
    for (const p of seg.parts) {
      if (p.kind !== "attribute") continue;
      const choice = chooseSocket(grid, seg, p.index, sockets, { bodyHeight: bodyH, plan: creature.plan, ...(boneOf ? { boneOf } : {}) });
      p.socket = choice.socket;
      p.why.push(`socket ${choice.socket} (${Math.round(choice.confidence * 100)}%): ${choice.why.join("; ")}`);
      (p as PartNode & { socketScores?: Record<string, number>; socketConfidence?: number }).socketScores = { ...choice.scores };
      (p as PartNode & { socketConfidence?: number }).socketConfidence = choice.confidence;
      if (GENERIC.test(p.id) || /^node|^mesh/.test(p.id)) p.id = SOCKET_NOUN[choice.socket] ?? `${choice.socket.replace(/\./g, "-").toLowerCase()}-piece`;
    }
    uniqueIds(seg.parts);
  } else {
    // A prop: cut its biggest part where its section jumps; any part that reads as a figure splits by region too.
    const biggest = [...seg.parts].sort((a, b) => b.cells - a.cells)[0]!;
    let total = 0;
    for (const p of seg.parts) total += p.cells;
    if (biggest.cells >= total * 0.4) {
      const q = narrowingCut(grid, seg, biggest.index);
      if (q >= 0) {
        measure(grid, seg);
        // (The part standing on top after a vertical cut: a figure on its plinth?)
        const top = seg.parts[q]!;
        const bottom = seg.parts[biggest.index]!;
        const fm = modelOf([q], `${name}-figure`);
        try {
          const a = analyseShape(fm);
          if (a.legs.length >= 2 && a.confidence >= 0.5) {
            const r = autoRig(fm, { plan: a.plan });
            figures.push({ part: "figure", plan: a.plan, confidence: +a.confidence.toFixed(2) });
            const regionCells = new Map<string, number[]>();
            for (let i = 0; i < seg.label.length; i += 1) {
              if (seg.label[i] !== q) continue;
              const b = r.binding.get(`${(i % sx) - off[0]},${Math.floor(i / sx) % sy},${Math.floor(i / (sx * sy)) - off[2]}`);
              const reg = b ? regionOfBone(b, a.plan) : "torso";
              const l = regionCells.get(reg) ?? [];
              l.push(i);
              regionCells.set(reg, l);
            }
            // (One mesh cut in two: its name was the whole thing's, so the pieces take what they are.)
            foldTinyRegions(regionCells);
            const baseCues = [...top.cues, `the figure reads as a ${a.plan}: split where its limbs narrow`];
            const regs = [...regionCells.keys()].sort();
            regs.forEach((reg, k) => {
              const idx = k === 0 ? q : seg.parts.length;
              if (k > 0) seg.parts.push({ ...top, index: idx });
              const part = seg.parts[idx]!;
              part.id = `figure.${reg}`;
              part.region = reg;
              part.cues = [...baseCues];
              part.why = [];
              for (const i of regionCells.get(reg)!) seg.label[i] = idx;
            });
            bottom.id = "plinth";
          }
        } catch { /* not a figure */ }
        measure(grid, seg);
        uniqueIds(seg.parts);
      }
    }
    for (const p of seg.parts) { p.kind = "prop"; p.confidence = +Math.min(0.99, 0.4 + (p.cues.length - 1) * 0.2 + (p.node >= 0 && seg.parts.filter((q) => q.node === p.node).length === 1 ? 0.3 : 0)).toFixed(2); }
  }
  lap("split");

  // Roles: a creature's skin tone read off its exposed body (head, arms, hands).
  const bodyish = new Set(seg.parts.filter((p) => p.kind === "body" && /head|arm|hand|leg\.F|torso/.test(p.id)).map((p) => p.index));
  const roles = clusterRoles(grid, { ...(opts.roles ?? {}), creature: Boolean(creature), ...(creature ? { bodyCells: (i: number) => bodyish.has(seg.label[i]!) } : {}) });
  const roleAt = (i: number): string => roles.clusters[roles.roleOf[i]!]?.role ?? "primary";
  lap("roles");

  // (a) The model: every cell its role, every part a group (its exact greedy boxes).
  const model = createVoxels({ unit: grid.unit, name, roles: roles.clusters.map((c) => c.role) });
  const partAt = new Map<number, number>();
  for (let i = 0; i < seg.label.length; i += 1) {
    if (seg.label[i]! < 0) continue;
    const x = (i % sx) - off[0], y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy)) - off[2];
    model.set(x, y, z, roleAt(i));
    partAt.set(cellKey(x, y, z), seg.label[i]!);
  }
  groupsByLabel(model, (x, y, z) => partAt.get(cellKey(x, y, z)) ?? -1, seg.parts.map((p) => p.id));
  const worn = seg.parts.filter((p) => p.kind === "attribute" && p.socket);
  const body = model.clone();
  for (const p of worn) {
    for (const r of body.groups.get(p.id) ?? []) for (let z = r.min[2]; z <= r.max[2]; z += 1) for (let y = r.min[1]; y <= r.max[1]; y += 1) for (let x = r.min[0]; x <= r.max[0]; x += 1) body.setIndex(x, y, z, 0);
    body.groups.delete(p.id);
  }
  // (The rig again, on the body with its roles: the same cells, so the same joints -- what a replay builds.)
  if (creature && rig) rig = autoRig(body, rig.edits);
  lap("model");

  // Worn parts as attributes: built to their socket, sized so they land where they were on this body.
  const attributes: AttributeProposal[] = [];
  if (creature && rig) {
    const u = grid.unit, O = rig.analysis.origin;
    const range = contractOf({ plan: creature.plan }).range;
    for (const p of worn) {
      const socket = rig.sockets[p.socket!] as EntitySocket;
      const am = createVoxels({ unit: u, roles: model.roles, name: p.id });
      for (const r of model.groups.get(p.id) ?? []) for (let z = r.min[2]; z <= r.max[2]; z += 1) for (let y = r.min[1]; y <= r.max[1]; y += 1) for (let x = r.min[0]; x <= r.max[0]; x += 1) { const v = model.get(x, y, z); if (v) am.setIndex(x, y, z, v); }
      const b = am.bounds()!;
      const sp: V3 = [socket.pos[0] / u + O[0], socket.pos[1] / u + O[1], socket.pos[2] / u + O[2]];
      const anchor = anchorOf(socket);
      const at: V3 = [(b.min[0] + b.max[0] + 1) / 2, (b.min[1] + b.max[1] + 1) / 2, (b.min[2] + b.max[2] + 1) / 2];
      if (anchor === "bottom") at[1] = b.min[1];
      if (anchor === "top") at[1] = b.max[1] + 1;
      if (anchor === "back") at[2] = b.min[2];
      if (anchor === "front") at[2] = b.max[2] + 1;
      const width = b.max[0] - b.min[0] + 1;
      const fill = +((u * width) / socket.size[0]).toFixed(5);
      const offset: [number, number, number] = [0, 1, 2].map((k) => +(((at[k]! - sp[k]!) * u) / socket.size[k]!).toFixed(5)) as [number, number, number];
      const id = `${name}-${p.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      const targets = [{ body: range }];
      const def = attributeFromVoxels(am, { id, slot: p.socket!, targets, fit: "width", fill, anchor, offset });
      const extra = p as PartNode & { socketScores?: Record<string, number>; socketConfidence?: number };
      attributes.push({
        part: p.id, id, slot: p.socket!, fit: "width", fill, anchor, offset, targets, pack, confidence: p.confidence, socketConfidence: extra.socketConfidence ?? 0,
        reason: p.why, scores: extra.socketScores ?? {}, model: am, def,
      });
    }
  }
  lap("attributes");

  // (c) A prop: an object (colliders, detected front, top sockets).
  // (Its front: a small part in the middle of one side -- a lock, a handle, a keyhole, a face -- says so; else the builder's detection.)
  const cue = !creature ? frontCue(seg.parts, off) : null;
  const object = !creature ? objectFromVoxels(model, { key: name, front: cue ? cue.front : "detect", tags: ["imported"] }) : null;

  // (b) Primitive fit: a creature's skin per bone on its rig (limbs as capsules along their bones), and every other
  // part on its own; a body region's fit is its bones'.
  const partFits: Record<string, PartFit> = {};
  const allPrims: Prim[] = [];
  let fittedSpec: VoxelSpec | null = null;
  let boneFits: Record<string, PartFit> = {};
  if (rig) {
    const fs = fittedSkin(rig);
    boneFits = fs.fits;
    fittedSpec = { ...rig.spec, voxel: { ...rig.spec.voxel, name: `${name}-fitted`, skin: fs.skin } } as VoxelSpec;
  }
  for (const p of seg.parts) {
    const cells: Array<[number, number, number]> = [];
    for (const r of model.groups.get(p.id) ?? []) for (let z = r.min[2]; z <= r.max[2]; z += 1) for (let y = r.min[1]; y <= r.max[1]; y += 1) for (let x = r.min[0]; x <= r.max[0]; x += 1) if (model.get(x, y, z)) cells.push([x, y, z]);
    if (!cells.length) continue;
    let f: PartFit;
    if (creature && rig && p.kind === "body" && p.region) {
      const prims = Object.entries(boneFits).filter(([b]) => regionOfBone(b, creature!.plan) === p.region).flatMap(([, bf]) => bf.prims);
      f = { prims, iou: iouWith(prims, cells), chosen: "bones", candidates: {} };
    } else f = fitPart(cells, (x, y, z) => model.roleAt(x, y, z));
    partFits[p.id] = f;
    allPrims.push(...f.prims);
  }
  const covered = rasterPrims(allPrims);
  let inter = 0;
  for (const { at } of covered.values()) if (model.get(at[0], at[1], at[2])) inter += 1;
  const fitIou = +(inter / (covered.size + model.count - inter || 1)).toFixed(3);
  lap("fit");

  // The generative base: the body's primitives as clean voxels, groups by part, and variation rules.
  const gen = createVoxels({ unit: grid.unit, name: `${name}-base`, roles: model.roles });
  const genParts = seg.parts.filter((p) => p.kind !== "attribute");
  const genAt = new Map<number, number>();
  for (const p of genParts) {
    const f = partFits[p.id];
    if (!f) continue;
    for (const { at, role } of rasterPrims(f.prims).values()) {
      if (gen.get(at[0], at[1], at[2]) || at[1] < 0) continue;
      gen.set(at[0], at[1], at[2], role);
      genAt.set(cellKey(at[0], at[1], at[2]), p.index);
    }
  }
  groupsByLabel(gen, (x, y, z) => genAt.get(cellKey(x, y, z)) ?? -1, seg.parts.map((p) => p.id));
  const rules = variationFor(gen, seg.parts, creature?.plan ?? null);
  let genEntity: EntityDef<VoxelSpec> | null = null;
  let genObject: ObjectDef | null = null;
  if (creature && gen.count) {
    try { genEntity = entityFromVoxels(gen, { id: `${name}-base`, rig: { plan: creature.plan }, variation: rules, tags: ["imported", "generative"] }); } catch { genEntity = null; }
  } else if (gen.count) {
    const parts = allPrims.map((q, i) => (q.shape === "capsule" ? { capsule: { a: m3(q.a, gen, grid.unit), b: m3(q.b, gen, grid.unit), r: q.r * grid.unit }, name: `prim${i}`, mat: q.role } : { box: { c: m3(q.c, gen, grid.unit), h: [q.h[0] * grid.unit, q.h[1] * grid.unit, q.h[2] * grid.unit] as V3, yaw: q.yaw }, name: `prim${i}`, mat: q.role }));
    genObject = defineObject({ key: `${name}-fitted`, parts, front: object?.front ?? null, tags: ["imported", "fitted"], meta: { wedges: allPrims.filter((q) => q.shape === "wedge").length } });
  }
  const genOps: AgentOp[] = [
    ...opsOf(gen),
    ...Object.entries(roles.look.colours).map(([role, colour]): AgentOp => ({ op: "look", role, colour: [...colour] })),
    ...varyOps(rules),
    ...(creature ? [{ op: "rig", as: creature.plan } as AgentOp] : []),
    { op: "target", as: creature ? "entity" : "object", id: `${name}-base` },
  ];
  lap("generative");

  // The op list: the voxels box by box, the parts as groups, the look, the worn parts attached, the rig, a lid's hinge, the target.
  const hinges = !creature ? hingeOps(seg.parts, model) : [];
  const ops: AgentOp[] = [
    ...opsOf(model),
    ...Object.entries(roles.look.colours).map(([role, colour]): AgentOp => ({ op: "look", role, colour: [...colour] })),
    ...attributes.map((a): AgentOp => ({ op: "attach", group: a.part, socket: a.slot, id: a.id, fit: "width", fill: a.fill, anchor: a.anchor, offset: [...a.offset], bodies: a.targets.map((x) => x.body) })),
    ...(creature ? [{ op: "rig", as: creature.plan, ...(Object.keys(creature.joints).length ? { joints: creature.joints } : {}) } as AgentOp] : []),
    ...hinges,
    { op: "target", as: creature ? "entity" : "object", id: name },
  ];

  const proposal: ImportProposal = {
    version: "keel-import@1", name,
    source: { format: scene.format, nodes: scene.nodes.length, meshes: scene.meshes.length, materials: scene.materials.length, triangles: grid.stats.triangles, skinned: grid.skinned, warnings: [...scene.warnings] },
    grid: { size: [...grid.size], unit: +grid.unit.toFixed(5), voxels: model.count, surface: grid.stats.surface },
    kind: creature ? "creature" : "object",
    ...(creature && rig ? { creature: { plan: creature.plan, source: creature.source, confidence: creature.confidence, why: creature.why, bones: Object.fromEntries(Object.entries(skel?.bones ?? {}).map(([b, j]) => [b, scene.nodes[jointNodes[j]!]!.name])), missing: [...rig.missing] } } : {}),
    roles: roles.clusters.map((c) => ({ role: c.role, oklch: c.oklch, share: c.share, materials: c.materials, why: c.why })),
    look: roles.look,
    parts: seg.parts.map((p) => ({
      id: p.id, kind: p.kind, cells: p.cells, min: sub(p.min, off), max: sub(p.max, off), source: p.nodeName, materials: p.materials.map((m) => m[0]),
      ...(p.region ? { region: p.region } : {}), ...(p.socket ? { socket: p.socket } : {}), confidence: p.confidence, cues: p.cues, why: p.why,
      ...(partFits[p.id] ? { fit: { chosen: partFits[p.id]!.chosen, iou: partFits[p.id]!.iou, prims: partFits[p.id]!.prims.length } } : {}),
    })),
    edges: seg.edges.map((e: PartEdge) => ({ a: seg.parts[e.a]!.id, b: seg.parts[e.b]!.id, contact: e.contact, cues: e.cues, confidence: e.confidence })),
    attributes: attributes.map((a) => ({ part: a.part, id: a.id, slot: a.slot, fill: a.fill, anchor: a.anchor, offset: a.offset, targets: a.targets.map((x) => x.body), pack: a.pack, confidence: a.confidence, reason: a.reason })),
    ...(object ? { object: { front: object.front, frontFrom: cue ? cue.why : "the builder's front detection", frontConfidence: cue ? cue.confidence : +object.meta.builder.front.confidence.toFixed(3), colliders: object.colliders.length, sockets: Object.keys(object.sockets), figures, why: notCreature } } : {}),
    generative: { prims: allPrims.length, iou: fitIou, rules },
  };
  lap("proposal");
  return {
    scene, grid, roles, segmentation: seg, model, body, creature, rig, attributes, object,
    fitted: { parts: partFits, spec: fittedSpec, prims: allPrims, iou: fitIou },
    generative: { model: gen, rules, entity: genEntity, object: genObject, ops: genOps },
    proposal, ops, offset: off, timings,
  };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** A body region too small to be a part of its own (a stub the rig called a tail) joins the torso. */
function foldTinyRegions(regionCells: Map<string, number[]>): void {
  let total = 0;
  for (const l of regionCells.values()) total += l.length;
  for (const [r, l] of [...regionCells]) {
    if (r === "torso" || l.length >= total * 0.03) continue;
    const t = regionCells.get("torso") ?? [];
    t.push(...l);
    regionCells.set("torso", t);
    regionCells.delete(r);
  }
}

/**
 * Does it stand on feet? Its ground layer is two or more pieces (legs), or one small compact one (legs together) --
 * not a plinth (as wide as it is anywhere) or a frame's ring (a hollow outline): those stand columns on a base, not a body on legs.
 */
function standsOnFeet(m: VoxelModel): { feet: boolean; why: string } {
  const d = m.dense();
  const [sx, sy, sz] = d.size;
  const area = (y: number): number => { let n = 0; for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) if (d.data[x + sx * (y + sy * z)]) n += 1; return n; };
  let maxArea = 0;
  for (let y = 0; y < sy; y += 1) maxArea = Math.max(maxArea, area(y));
  const seen = new Uint8Array(sx * sz);
  const comps: Array<{ n: number; x0: number; x1: number; z0: number; z1: number }> = [];
  for (let z = 0; z < sz; z += 1) for (let x = 0; x < sx; x += 1) {
    if (seen[x + sx * z] || !d.data[x + sx * sy * z]) continue;
    const c = { n: 0, x0: x, x1: x, z0: z, z1: z };
    const stack = [[x, z] as const];
    seen[x + sx * z] = 1;
    while (stack.length) {
      const [cx, cz] = stack.pop()!;
      c.n += 1; c.x0 = Math.min(c.x0, cx); c.x1 = Math.max(c.x1, cx); c.z0 = Math.min(c.z0, cz); c.z1 = Math.max(c.z1, cz);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= sx || nz >= sz || seen[nx + sx * nz] || !d.data[nx + sx * sy * nz]) continue;
        seen[nx + sx * nz] = 1;
        stack.push([nx, nz]);
      }
    }
    if (c.n >= 2) comps.push(c);
  }
  if (comps.length >= 2) return { feet: true, why: `${comps.length} pieces on the ground` };
  const c = comps[0];
  if (!c) return { feet: false, why: "nothing on the ground" };
  const fill = c.n / ((c.x1 - c.x0 + 1) * (c.z1 - c.z0 + 1));
  if (fill >= 0.6 && c.n <= maxArea * 0.35) return { feet: true, why: "feet together on the ground" };
  return { feet: false, why: fill < 0.6 ? "its ground layer is an outline (a frame), not feet" : "it stands on a base as wide as itself (a plinth), not feet" };
}
const cellKey = (x: number, y: number, z: number): number => ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);

/** Groups from a per-cell label (a part index, -1 none): each part its exact greedy boxes, in part order. */
function groupsByLabel(model: VoxelModel, labelAt: (x: number, y: number, z: number) => number, names: readonly string[]): void {
  const boxes = greedyBoxes(model, { label: (x, y, z) => labelAt(x, y, z) + 1 });
  const byPart = new Map<number, Array<{ min: V3; max: V3 }>>();
  for (const b of boxes) {
    const l = byPart.get(b.label - 1) ?? [];
    l.push({ min: [...b.min], max: [b.min[0] + b.size[0] - 1, b.min[1] + b.size[1] - 1, b.min[2] + b.size[2] - 1] });
    byPart.set(b.label - 1, l);
  }
  names.forEach((n, i) => { const rs = byPart.get(i); if (rs?.length) model.groups.set(n, rs); });
}
// (Voxel coordinates -> metres about the model's pivot, the middle of its base.)
const m3 = (p: V3, m: VoxelModel, u: number): V3 => { const pv = m.pivot(); return [(p[0] - pv[0]) * u, (p[1] - pv[1]) * u, (p[2] - pv[2]) * u]; };

const FRONT_WORDS = /(^|[-.])(lock|latch|keyhole|handle|knob|door|face|screen|dial|button|mouth|eyes?|sign|label|plaque|drawer|window|display)([-.]|$)/;

/** A prop's front from its parts: a small one sitting on the outside of one side, near its middle (a lock, a handle, a door). */
function frontCue(parts: readonly PartNode[], off: V3): { front: "+z" | "-z" | "+x" | "-x"; confidence: number; why: string } | null {
  if (parts.length < 2) return null;
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  let total = 0;
  for (const p of parts) { total += p.cells; for (let k = 0; k < 3; k += 1) { lo[k] = Math.min(lo[k]!, p.min[k]!); hi[k] = Math.max(hi[k]!, p.max[k]!); } }
  let best: { front: "+z" | "-z" | "+x" | "-x"; confidence: number; why: string } | null = null;
  for (const p of parts) {
    if (p.cells > total * 0.08) continue;
    for (const [axis, sign, name] of [[2, 1, "+z"], [2, -1, "-z"], [0, 1, "+x"], [0, -1, "-x"]] as const) {
      const face = sign > 0 ? hi[axis]! : lo[axis]!;
      const touches = sign > 0 ? p.max[axis]! >= face - 0.5 : p.min[axis]! <= face + 0.5;
      if (!touches) continue;
      const other = axis === 2 ? 0 : 2;
      const mid = (lo[other]! + hi[other]!) / 2, span = hi[other]! - lo[other]! + 1;
      const centred = 1 - Math.min(1, Math.abs(p.centroid[other]! - (mid + 0.5)) / (span / 2));
      const named = FRONT_WORDS.test(p.id);
      const confidence = +(0.35 * centred + (named ? 0.45 : 0) + 0.15).toFixed(2);
      if (confidence >= 0.5 && (!best || confidence > best.confidence)) best = { front: name, confidence, why: `${p.id} sits in the middle of the ${name} side${named ? ` (a ${p.id} marks a front)` : ""}` };
    }
  }
  void off;
  return best;
}

/** Which face of an attribute sits on its socket (the builder's anchorFor, "auto"). */
function anchorOf(s: EntitySocket): Exclude<Anchor, "auto"> {
  if (s.sits === "around") return "center";
  const o = s.out;
  const ax = Math.abs(o[1]) >= Math.abs(o[2]) && Math.abs(o[1]) >= Math.abs(o[0]) ? 1 : 2;
  if (ax === 1) return o[1] >= 0 ? "bottom" : "top";
  return o[2] >= 0 ? "back" : "front";
}

/** Variation rules for a generative base: its size; a creature's head and legs, a tail that may go; a prop's small parts optional. */
function variationFor(gen: VoxelModel, parts: readonly PartNode[], plan: Plan | null): VariationRules {
  const scale: Record<string, { region: string | { from: [number, number, number]; to: [number, number, number] }; y?: [number, number]; uniform?: [number, number]; x?: [number, number]; z?: [number, number]; anchor?: "bottom" | "top" | "center" }> = {};
  const optional: Record<string, number> = {};
  const has = (g: string): boolean => gen.groups.has(g);
  if (plan) {
    if (has("head")) scale["head"] = { region: "head", uniform: [0.85, 1.2], anchor: "bottom" };
    if (has("torso")) scale["torso"] = { region: "torso", x: [0.9, 1.15], z: [0.9, 1.15], anchor: "center" };
    const legs = [...gen.groups.keys()].filter((g) => g.startsWith("leg."));
    if (legs.length) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const g of legs) for (const r of gen.groups.get(g)!) for (let k = 0; k < 3; k += 1) { lo[k] = Math.min(lo[k]!, r.min[k]!); hi[k] = Math.max(hi[k]!, r.max[k]!); }
      scale["legs"] = { region: { from: lo as [number, number, number], to: hi as [number, number, number] }, y: [0.85, 1.2], anchor: "top" };
    }
    if (has("tail")) optional["tail"] = 0.8;
  } else {
    const total = parts.reduce((s, p) => s + p.cells, 0);
    for (const p of parts) if (has(p.id) && p.cells < total * 0.08) optional[p.id] = 0.75;
  }
  return { ...(Object.keys(scale).length ? { scale } : {}), ...(Object.keys(optional).length ? { optional } : {}), size: [0.9, 1.1] };
}

function varyOps(rules: VariationRules): AgentOp[] {
  const out: AgentOp[] = [];
  for (const [name, r] of Object.entries(rules.scale ?? {})) {
    if (typeof r.region !== "string") continue;
    out.push({ op: "vary", name, group: r.region, ...(r.uniform ? { scale: [...r.uniform] } : {}), ...(r.x ? { x: [...r.x] } : {}), ...(r.y ? { y: [...r.y] } : {}), ...(r.z ? { z: [...r.z] } : {}), ...(typeof r.anchor === "string" ? { anchor: r.anchor } : {}) });
  }
  for (const [g, p] of Object.entries(rules.optional ?? {})) out.push({ op: "vary", group: g, optional: p });
  if (rules.size) out.push({ op: "vary", size: [...rules.size] });
  return out;
}

/** A lid (or door, hatch) on a prop: a hinge at its back edge, opening up and back. */
function hingeOps(parts: readonly PartNode[], model: VoxelModel): AgentOp[] {
  const out: AgentOp[] = [];
  for (const p of parts) {
    if (!/(^|[-.])(lid|hatch|cover|door|gate)([-.]|$)/.test(p.id) || !model.groups.has(p.id)) continue;
    let lo: V3 = [Infinity, Infinity, Infinity];
    for (const r of model.groups.get(p.id)!) lo = [Math.min(lo[0], r.min[0]), Math.min(lo[1], r.min[1]), Math.min(lo[2], r.min[2])];
    const door = /door|gate/.test(p.id);
    out.push(door
      ? { op: "animate", group: p.id, motion: "hinge", axis: "y", to: -1.3, hz: 0.25, pivot: [lo[0], lo[1], lo[2]] }
      : { op: "animate", group: p.id, motion: "hinge", axis: "x", to: -1.1, hz: 0.25, pivot: [0, lo[1], lo[2]] });
  }
  return out;
}

/** Replay an import's op list into a builder session and build it: the entity or object, its attributes, bake designs, pack files. */
export function replayImport(ops: readonly AgentOp[], { pack = "packs/imported" }: { pack?: string } = {}): Built & { readonly session: ReturnType<typeof runOps>["session"] } {
  const r = runOps(ops);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return { ...buildSession(r.session, { pack }), session: r.session };
}

