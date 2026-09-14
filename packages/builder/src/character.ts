// Character designs: the generative capsule-and-rig characters the games use
// (keel/entity's people, anthro animals and animals), made through the same
// op list as voxel builds -- a body contract and species, pinned catalogue
// choices, proportions (the rig's own numbers), extra parts (capsules, boxes,
// wedges on bones or sockets, each with a role) and attributes worn in
// sockets. Plain data, so it streams op by op and exports as code.
//
//   const d = characterDesign({ kind: "anthro", species: "fox", seed: "7" });
//   d.pins.ears = "tall"; d.body.headR = { scale: 1.2 };
//   d.parts.push({ id: "horn.L", shape: "capsule", on: "head", a: [-0.3, 0, 0.1], b: [-0.45, 0.6, 0], r: 0.08, role: "furAlt" });
//   const spec = characterSpec(d);                       // an EntitySpec: entityOf + the proportions, rig rebuilt
//   characterSolids(d, posed(spec, "run", { phase: 0.3 }), look, registry)   // capsules, boxes, wedges to draw

import { createRoll, datan2, dcos, deriveSeed, dsin, oklch, stream } from "@keel-engine/core";
import { CHOICES, contractOf, entityOf, humanoidRig, placeAttribute, quadrupedRig, skinOf, socketFrame, socketToWorld, socketsOf, wear } from "@keel-engine/entity";
import type { AttributeShape, EntitySocket, EntitySpec, HumanoidBody, Kind, MaterialTable, QuadrupedBody, Role as EntityRole, Skeleton, Species } from "@keel-engine/entity";
import { defineEntity } from "@keel-engine/runtime";
import type { AttributeDef, EntityDef, Pins, Stream } from "@keel-engine/runtime";
import { ENTITY_ROLE_OF } from "./look.ts";
import type { Look, LookMaterial, Oklch } from "./look.ts";
import type { V3 } from "./voxels.ts";

/** A part added to a character: a capsule, box or wedge in a bone's or a socket's frame, with a role. */
export interface PartDesign {
  readonly id: string;
  readonly shape: "capsule" | "box" | "wedge";
  /** A bone ("head", "tail1", "upperArm.L") or a socket ("head", "back", "hand.R"); a socket wins when both are named so. */
  readonly on: string;
  /** "socket": numbers are shares of the socket's size (sized to a mouse's head or a bear's); "m": metres. Default: socket on sockets, m on bones. */
  readonly units?: "socket" | "m";
  readonly a?: readonly [number, number, number];
  readonly b?: readonly [number, number, number];
  readonly r?: number;
  readonly c?: readonly [number, number, number];
  readonly h?: readonly [number, number, number];
  readonly yaw?: number;
  /** A wedge's foot height, 0..0.98 of its height (the renderer's `lo`). */
  readonly lo?: number;
  /** An entity role (fur, cloth, accent...) or a builder role (primary, trim...: played as entity roles). */
  readonly role: string;
}

/** A proportion: set to a value (metres), or scaled. */
export interface Proportion { readonly value?: number; readonly scale?: number }

export interface CharacterDesign {
  kind: Kind;
  species?: Species;
  seed: string;
  /** World size: height on two legs, shoulder height on four. */
  size?: number;
  /** Catalogue choices pinned (keel/entity's CHOICES: ears, tail, top, hood, pack...). */
  pins: Record<string, unknown>;
  /** Rig proportions (HumanoidBody / QuadrupedBody names: headR, hipH, torso, bodyLen, neckLen...). */
  body: Record<string, Proportion>;
  parts: PartDesign[];
  /** Attributes worn, by id (from the session's registry), with pins. */
  wear: Array<{ attribute: string; pins: Record<string, unknown> }>;
}

export const characterDesign = (d: Partial<CharacterDesign> & { kind: Kind }): CharacterDesign => ({
  kind: d.kind, ...(d.species ? { species: d.species } : {}), seed: d.seed ?? "1", ...(d.size !== undefined ? { size: d.size } : {}),
  pins: { ...(d.pins ?? {}) }, body: { ...(d.body ?? {}) }, parts: [...(d.parts ?? [])], wear: [...(d.wear ?? [])],
});

/** The proportions a kind's body has (what `proportion` ops may set). */
export function proportionNames(kind: Kind): string[] {
  return Object.keys(entityOf("1", { kind }).body).filter((k) => k !== "stride");
}
export const choiceNames = (): string[] => CHOICES.map((c) => c.name).filter((n) => n !== "kind" && n !== "species");

/** The design's spec: the catalogue's entity (seed, kind, species, pins, size), its proportions applied and its rig rebuilt from them. */
export function characterSpec(d: CharacterDesign): EntitySpec {
  const base = entityOf(d.seed, { kind: d.kind, ...(d.species ? { species: d.species } : {}), pins: d.pins as never, ...(d.size !== undefined ? { size: d.size } : {}) });
  if (!Object.keys(d.body).length) return base;
  const body = { ...base.body } as Record<string, number>;
  for (const [k, p] of Object.entries(d.body)) {
    if (!(k in body)) throw new RangeError(`No proportion "${k}" on a ${base.plan} (${Object.keys(body).join(", ")}).`);
    const v = p.value ?? body[k]! * (p.scale ?? 1);
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`Proportion ${k} = ${v}: a length, 0 or more.`);
    body[k] = v;
  }
  // (Two legs: the torso is what's left of the height; keep them adding up when a part of it changes.)
  if (base.plan === "humanoid" && !("torso" in d.body) && ("hipH" in d.body || "headR" in d.body || "neck" in d.body || "H" in d.body)) {
    body["torso"] = Math.max(0.05, body["H"]! - body["hipH"]! - body["neck"]! - body["headR"]! * 2);
  }
  const features = { ...base.features, tail: { ...base.features.tail, len: body["tailLen"] ?? base.features.tail.len } };
  if (base.plan === "quadruped") return { ...base, body: body as unknown as QuadrupedBody, rig: quadrupedRig(body as unknown as QuadrupedBody), features };
  return { ...base, body: body as unknown as HumanoidBody, rig: humanoidRig(body as unknown as HumanoidBody), features };
}

/** The material numbers a character's roles wear (the baker's ENTITY_MATERIALS), and the builder's roles played on them. */
export const CHARACTER_MATERIALS: MaterialTable = Object.freeze({ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9, furAlt: 11, clothAlt: 12, hair: 13 });

// (A ramp dark to light round a colour: the baker's rampAround.)
function rampAround([L, C, h]: Oklch, n: number): Array<[number, number, number]> {
  const L0 = Math.max(0.12, L - 0.42), L1 = Math.min(0.98, L + 0.16), c = Math.max(C, 0.02), turn = 12;
  return Array.from({ length: n }, (_, i) => { const k = n > 1 ? i / (n - 1) : 0.5; const [r, g, b] = oklch(L0 + (L1 - L0) * k, c * dsin(Math.PI * (0.15 + 0.7 * k)), h + turn * (k - 0.5)); return [r, g, b]; });
}

/** A look for a character: ramps round its own colours per entity role (as the baker's entityPalette), a table for entity and builder roles. */
export function characterLook(spec: EntitySpec, rampLength = 5): Look {
  const c = spec.colours;
  const list: Record<string, Array<[number, number, number]>> = {
    dark: rampAround(c.dark, Math.max(3, rampLength - 1)), fur: rampAround(c.fur, rampLength), furAlt: rampAround(c.furAlt, rampLength),
    cloth: rampAround(c.cloth, rampLength), clothAlt: rampAround(c.clothAlt, rampLength), accent: rampAround(c.accent, rampLength),
    blush: rampAround(c.blush, Math.max(3, rampLength - 1)), hair: rampAround(c.hair, rampLength),
  };
  const colours: Array<[number, number, number]> = [];
  const ramps: Record<string, [number, number]> = {};
  for (const [name, r] of Object.entries(list)) { ramps[name] = [colours.length, r.length]; colours.push(...r); }
  const materials: LookMaterial[] = [
    { ramp: "dark" }, { ramp: "dark" }, { ramp: "dark" }, { ramp: "dark", light: 0.8 }, { ramp: "dark" }, { ramp: "dark" },
    { ramp: "fur", light: 1.1 }, { ramp: "cloth" }, { ramp: "accent" }, { ramp: "blush" }, { ramp: "accent" },
    { ramp: "furAlt", light: 1.1 }, { ramp: "clothAlt" }, { ramp: "hair" },
  ];
  const table: Record<string, number> = { ...(CHARACTER_MATERIALS as Record<string, number>) };
  for (const [builderRole, entityRole] of Object.entries(ENTITY_ROLE_OF)) table[builderRole] = CHARACTER_MATERIALS[entityRole] ?? 7;
  table["glow-dim"] = table["glow"]!;
  const named: Record<string, Oklch> = { dark: c.dark, fur: c.fur, furAlt: c.furAlt, cloth: c.cloth, clothAlt: c.clothAlt, accent: c.accent, blush: c.blush, hair: c.hair };
  return { palette: { colours, ramps }, materials, table, colours: named };
}

const entityRole = (role: string): EntityRole => (["fur", "furAlt", "cloth", "clothAlt", "accent", "dark", "blush", "hair"].includes(role) ? role as EntityRole : ENTITY_ROLE_OF[role] ?? "cloth");

/** Check a part against a spec: where it goes, its shape's numbers. Returns problems (empty: fine). */
export function checkPart(spec: EntitySpec, p: PartDesign): string[] {
  const bad: string[] = [];
  const sockets = socketsOf(spec);
  if (!sockets[p.on] && spec.rig.index[p.on] === undefined) bad.push(`part ${p.id}: "${p.on}" is no socket (${Object.keys(sockets).join(", ")}) and no bone of a ${spec.plan}.`);
  const v3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  if (p.shape === "capsule" && (!v3(p.a) || !v3(p.b) || !(typeof p.r === "number" && p.r > 0))) bad.push(`part ${p.id}: a capsule needs a, b ([x, y, z]) and r > 0.`);
  if (p.shape !== "capsule" && (!v3(p.c) || !v3(p.h) || !(p.h as readonly number[]).every((n) => n > 0))) bad.push(`part ${p.id}: a ${p.shape} needs c ([x, y, z]) and h (half-extents above 0).`);
  if (p.lo !== undefined && !(p.lo >= 0 && p.lo <= 0.98)) bad.push(`part ${p.id}: lo is 0..0.98.`);
  return bad;
}

/** Solids a character draws: boxes (a wedge is a box with kind "wedge"), capsules. */
export interface CharacterSolids {
  boxes: Array<{ c: V3; h: V3; yaw: number; mat: number; kind?: "wedge"; lo?: number }>;
  capsules: Array<{ a: V3; b: V3; r: number; mat: number }>;
}

/** An attribute registry: ids to runtime attributes whose designs are AttributeShapes (packs/cloth's, voxel ones). */
export type AttributeRegistry = ReadonlyMap<string, AttributeDef<AttributeShape>>;

/** The character on a posed skeleton: its skin, its parts through their bones and sockets, what it wears. */
export function characterSolids(d: CharacterDesign, skel: Skeleton, look: Pick<Look, "table">, registry: AttributeRegistry = new Map(), spec: EntitySpec = characterSpec(d)): CharacterSolids {
  const table = look.table as MaterialTable;
  const out: CharacterSolids = { boxes: [], capsules: skinOf(spec, skel, table).map((c) => ({ a: c.a, b: c.b, r: c.r, mat: c.mat })) };
  const sockets = socketsOf(spec);
  for (const p of d.parts) {
    const socket: EntitySocket | undefined = sockets[p.on];
    const units = p.units ?? (socket ? "socket" : "m");
    const frame = socketFrame(skel, socket ?? { name: p.on, bone: p.on, at: [0, 0, 0] });
    const k: V3 = units === "socket" && socket ? [socket.size[0], socket.size[1], socket.size[2]] : [1, 1, 1];
    const S = (v: readonly number[]): V3 => [v[0]! * k[0], v[1]! * k[1], v[2]! * k[2]];
    const mat = look.table[p.role] ?? look.table[entityRole(p.role)] ?? 7;
    if (p.shape === "capsule") {
      const r = p.r! * (units === "socket" && socket ? Math.min(k[0], k[2]) : 1);
      out.capsules.push({ a: socketToWorld(frame, S(p.a!)), b: socketToWorld(frame, S(p.b!)), r, mat });
    } else {
      const m = frame.m;
      const yaw = datan2(m[2] * dcos(p.yaw ?? 0) + m[0] * dsin(p.yaw ?? 0), m[8] * dcos(p.yaw ?? 0) + m[6] * dsin(p.yaw ?? 0));
      out.boxes.push({ c: socketToWorld(frame, S(p.c!)), h: S(p.h!), yaw, mat, ...(p.shape === "wedge" ? { kind: "wedge" as const, lo: p.lo ?? 0 } : {}) });
    }
  }
  const roles: MaterialTable = Object.fromEntries(Object.keys(CHARACTER_MATERIALS).map((r) => [r, look.table[r] ?? (CHARACTER_MATERIALS as Record<string, number>)[r]!]));
  for (const w of d.wear) {
    const def = registry.get(w.attribute);
    if (!def) continue;
    const worn = wear(def, spec, stream(createRoll(deriveSeed(String(spec.seed), `attribute:${def.id}`)), 0), w.pins);
    const f = placeAttribute(skel, worn.socket, worn.design, { materials: roles });
    for (const c of f.capsules) out.capsules.push({ a: c.a, b: c.b, r: c.r, mat: c.mat });
    for (const b of f.boxes) out.boxes.push({ c: b.c, h: b.h, yaw: b.yaw, mat: b.mat });
  }
  return out;
}

/** A character's spec: the engine's, with the parts it was given. */
export type CharacterSpec = EntitySpec & { readonly parts: readonly PartDesign[] };

/** A character design as a runtime entity: the catalogue's build (a seed from S, or pins.seed), with the design's pins, proportions and parts. */
export function characterEntity(d: Partial<CharacterDesign> & { readonly kind: Kind; readonly id: string; readonly title?: string; readonly tags?: readonly string[] }): EntityDef<CharacterSpec> {
  const design = characterDesign(d);
  const plan = d.kind === "animal" ? "quadruped" : "humanoid";
  return defineEntity<CharacterSpec>({
    id: d.id,
    body: contractOf({ plan }).ref,
    ...(d.title ? { title: d.title } : {}),
    tags: [...(d.tags ?? []), "character", d.kind, ...(d.species ? [d.species] : [])],
    build(S: Stream, pins: Pins) {
      let seed = "0x";
      for (let i = 0; i < 4; i += 1) seed += Math.floor(S.f() * 65536).toString(16).padStart(4, "0");
      const { seed: pinned, size, ...rest } = pins as Record<string, unknown>;
      const spec = characterSpec({ ...design, seed: pinned !== undefined ? String(pinned) : seed, pins: { ...design.pins, ...rest }, ...(typeof size === "number" ? { size } : {}) });
      return { ...spec, parts: design.parts };
    },
    sockets: (spec) => socketsOf(spec),
  });
}
