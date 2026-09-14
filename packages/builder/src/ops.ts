// The agent op list: building as plain JSON an assistant can emit, check and
// run -- "box at ... role primary", "mirror x", "rig as quadruped", "wave the
// flag at 0.5 Hz", "a fox, tall ears, a bigger head, horns". Voxel builds and
// capsule-and-rig characters both. Validation says exactly what's wrong and
// where. Ops stream: applyOp / streamOps apply one at a time, each returning
// a small change event a live preview updates from, each undoable on its own;
// runOps is atomic (any op failing leaves the session as it was).
//
//   const r = runOps([
//     { op: "generate", kind: "banner", seed: "4" },
//     { op: "animate", group: "cloth", motion: "wave", hz: 0.5 },
//     { op: "target", as: "object", id: "war-banner" },
//   ]);
//   r.ok; r.errors; r.results;           // [{ index, op, did }]
//   const built = buildSession(r.session); built.object; built.code;  // an ObjectDef, and pack code for it
//
// OPS (below) is the one table every op is checked against, and what
// opReference() / opSchema() hand the desktop's assistant tools.

import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import { contractOf, wear } from "@keel-engine/entity";
import type { AttributeShape, EntitySpec, Kind, Plan, Species } from "@keel-engine/entity";
import type { ObjectDef } from "@keel-engine/object";
import type { AttributeDef } from "@keel-engine/runtime";
import { MOTION_KINDS, checkAnimation } from "./animate.ts";
import type { Motion, ObjectAnimation, ObjectClip } from "./animate.ts";
import { voxelStats } from "./codec.ts";
import { attributeFromVoxels, objectFromVoxels } from "./convert.ts";
import type { Anchor, FitMode, SmoothOptions, VoxelAttributeShape, VoxelObjectMeta } from "./convert.ts";
import { characterBakeDesign, creatureDesign, objectDesign } from "./design.ts";
import type { BuilderDesign } from "./design.ts";
import { createEditor } from "./edit.ts";
import type { EditOp, Editor, HistoryEntry, SymmetryMode } from "./edit.ts";
import { characterDesign, characterEntity, characterSpec, checkPart, choiceNames, proportionNames } from "./character.ts";
import type { CharacterDesign, CharacterSpec, PartDesign } from "./character.ts";
import { entityFromVoxels } from "./entity.ts";
import { exportPackFile } from "./export.ts";
import type { AssetSpec } from "./export.ts";
import { GENERATOR_KINDS, generate } from "./generate.ts";
import type { GeneratorKind } from "./generate.ts";
import type { Oklch } from "./look.ts";
import { greedyBoxes } from "./mesh.ts";
import { autoRig } from "./rig.ts";
import type { RigEdits, VoxelRig, VoxelSpec } from "./rig.ts";
import { checkVariation, removeGroup } from "./variation.ts";
import type { ScaleAnchor, ScaleRule, VariationRules } from "./variation.ts";
import { ROLE_NAME, createVoxels } from "./voxels.ts";
import type { V3, VoxelModel } from "./voxels.ts";
import type { EntityDef } from "@keel-engine/runtime";

// ---------------------------------------------------------------- the table

type FieldType = "int3" | "num3" | "int" | "num" | "pos" | "string" | "id" | "role" | "role?" | "bool" | "range" | "strings" | "colour" | "any" | "object" | readonly string[];
interface Field { readonly type: FieldType; readonly required?: boolean; readonly doc: string }
interface OpSpec { readonly doc: string; readonly fields: Readonly<Record<string, Field>>; readonly example: Record<string, unknown> }

const AXES = ["x", "y", "z"] as const;
/** Every op: what it does, its fields, an example. */
export const OPS: Readonly<Record<string, OpSpec>> = {
  new: { doc: "Start an empty model.", fields: { name: { type: "id", doc: "its name" }, unit: { type: "pos", doc: "metres per voxel (default 0.1)" } }, example: { op: "new", name: "hat", unit: 0.05 } },
  set: { doc: "One voxel (role null empties it).", fields: { at: { type: "int3", required: true, doc: "[x, y, z]" }, role: { type: "role?", required: true, doc: "a role, or null" } }, example: { op: "set", at: [0, 4, 2], role: "dark" } },
  box: { doc: "A solid (or hollow) box, both corners included.", fields: { from: { type: "int3", required: true, doc: "a corner" }, to: { type: "int3", required: true, doc: "the other corner" }, role: { type: "role?", required: true, doc: "a role, or null to carve" }, hollow: { type: "bool", doc: "only its shell" } }, example: { op: "box", from: [-2, 0, -2], to: [1, 3, 1], role: "primary" } },
  fill: { doc: "Like box, but only over cells that are `only` (a role, or null for empty ones).", fields: { from: { type: "int3", required: true, doc: "a corner" }, to: { type: "int3", required: true, doc: "the other corner" }, role: { type: "role?", required: true, doc: "what goes in" }, only: { type: "role?", doc: "only cells that are this (null: empty cells)" } }, example: { op: "fill", from: [-4, 0, -4], to: [3, 0, 3], role: "trim", only: null } },
  sphere: { doc: "A ball (an ellipsoid with `scale`): cells whose centres are inside.", fields: { center: { type: "num3", required: true, doc: "[x, y, z], halves allowed" }, radius: { type: "pos", required: true, doc: "in voxels" }, role: { type: "role?", required: true, doc: "a role, or null" }, scale: { type: "num3", doc: "stretch per axis" } }, example: { op: "sphere", center: [0, 6, 0], radius: 2.5, role: "skin" } },
  line: { doc: "A line of cells, thickened by `radius`.", fields: { from: { type: "int3", required: true, doc: "start" }, to: { type: "int3", required: true, doc: "end" }, role: { type: "role?", required: true, doc: "a role, or null" }, radius: { type: "num", doc: "thickness (voxels)" } }, example: { op: "line", from: [0, 5, -3], to: [0, 8, -7], role: "secondary" } },
  mirror: { doc: "Copy one side onto the other across a plane.", fields: { axis: { type: ["x", "z"], required: true, doc: "x or z" }, center: { type: "num", doc: "the plane (0: between -1 and 0; 0.5: through voxel 0)" }, keep: { type: ["positive", "negative"], doc: "which side is copied (default positive)" } }, example: { op: "mirror", axis: "x" } },
  erase: { doc: "Empty a region (or everything).", fields: { from: { type: "int3", doc: "a corner" }, to: { type: "int3", doc: "the other corner" } }, example: { op: "erase", from: [0, 0, 0], to: [3, 3, 3] } },
  recolour: { doc: "Give every cell of one role another (only in a group, optionally).", fields: { from: { type: "role", required: true, doc: "the role now" }, to: { type: "role", required: true, doc: "the role after" }, group: { type: "id", doc: "only this group's regions" } }, example: { op: "recolour", from: "primary", to: "secondary", group: "legs" } },
  symmetry: { doc: "Mirror every following brush op.", fields: { mode: { type: ["none", "x", "z", "xz", "radial4"], required: true, doc: "none, x, z, xz, radial4" }, center: { type: "range", doc: "[cx, cz] planes (default [0, 0])" } }, example: { op: "symmetry", mode: "x" } },
  undo: { doc: "Take back the last op (any op: a box, a joint, a part, a pin).", fields: { steps: { type: "int", doc: "how many (default 1)" } }, example: { op: "undo" } },
  redo: { doc: "Apply again what undo took back.", fields: { steps: { type: "int", doc: "how many (default 1)" } }, example: { op: "redo" } },
  unit: { doc: "Metres per voxel.", fields: { metres: { type: "pos", required: true, doc: "e.g. 0.05" } }, example: { op: "unit", metres: 0.05 } },
  origin: { doc: "The pivot (voxel coordinates), or \"auto\": the middle of the base.", fields: { at: { type: "num3", doc: "[x, y, z]; omit for auto" } }, example: { op: "origin", at: [0, 0, 0] } },
  group: { doc: "Name a region (add to it; `replace` starts it over). Groups name parts, carry animation and variation.", fields: { name: { type: "id", required: true, doc: "e.g. flag, door, legs" }, from: { type: "int3", required: true, doc: "a corner" }, to: { type: "int3", required: true, doc: "the other corner" }, replace: { type: "bool", doc: "forget its earlier regions" } }, example: { op: "group", name: "flag", from: [1, 12, 0], to: [10, 18, 0] } },
  ungroup: { doc: "Forget a group (its voxels stay).", fields: { name: { type: "id", required: true, doc: "the group" } }, example: { op: "ungroup", name: "flag" } },
  merge: { doc: "Merge groups into one (the first, or `into`): their regions join it and the rest are forgotten (their voxels stay). An attachment on the kept group stays.", fields: { groups: { type: "strings", required: true, doc: "two or more groups" }, into: { type: "id", doc: "the merged group's name (default the first's)" } }, example: { op: "merge", groups: ["blade", "hilt"], into: "sword" } },
  attach: {
    doc: "Mark a group as an attribute worn in a socket: it leaves the body (the rig and the entity don't see it) and builds as an attribute sized to that socket. Again on the same group moves it to another socket.",
    fields: {
      group: { type: "id", required: true, doc: "the group" }, socket: { type: "string", required: true, doc: "head, face, neck, chest, back, waist, hand.L, hand.R, foot.L, foot.R, paw.FL..., tail" },
      id: { type: "id", doc: "the attribute's id (default the group's)" }, fit: { type: ["width", "height", "depth", "contain", "stretch"], doc: "how it's sized to the socket" },
      fill: { type: "pos", doc: "share of the socket" }, anchor: { type: ["auto", "bottom", "top", "back", "front", "center"], doc: "which face sits on the socket" },
      offset: { type: "num3", doc: "moved by these shares of the socket's size" }, bodies: { type: "strings", doc: "body ranges it fits (default the rig's, else humanoid and quadruped)" },
    },
    example: { op: "attach", group: "helmet", socket: "head", fill: 1.1, anchor: "bottom", offset: [0, -0.9, 0] },
  },
  detach: { doc: "Put an attached group back in the body (mark it as body).", fields: { group: { type: "id", required: true, doc: "the group" } }, example: { op: "detach", group: "cape" } },
  generate: { doc: "Replace the model with a seeded one (with its groups, animation, variation and look).", fields: { kind: { type: GENERATOR_KINDS, required: true, doc: GENERATOR_KINDS.join(", ") }, seed: { type: "string", required: true, doc: "any string or number" }, plan: { type: ["humanoid", "quadruped"], doc: "critters: two legs or four" } }, example: { op: "generate", kind: "critter", seed: "7", plan: "quadruped" } },
  rig: { doc: "Rig it as a creature: auto (read from the shape), humanoid or quadruped. Attached groups stay out of it.", fields: { as: { type: ["auto", "humanoid", "quadruped"], doc: "default auto" }, limbs: { type: ["auto", "capsule", "rigid"], doc: "limb bones as capsules (smooth swings), rigid boxes (blocky), or auto: capsules where long, boxes where stout" }, joints: { type: "object", doc: "joints placed at once, bone -> [x, y, z] voxel coordinates (an imported skeleton)" } }, example: { op: "rig", as: "quadruped" } },
  joint: { doc: "Move a rig joint (voxel coordinates).", fields: { bone: { type: "string", required: true, doc: "e.g. hips, upperArm.L, upper.FL" }, at: { type: "num3", required: true, doc: "[x, y, z]" } }, example: { op: "joint", bone: "neck", at: [0, 14, 2] } },
  assign: { doc: "Give a region's voxels to a bone.", fields: { bone: { type: "string", required: true, doc: "the bone" }, from: { type: "int3", required: true, doc: "a corner" }, to: { type: "int3", required: true, doc: "the other corner" } }, example: { op: "assign", bone: "head", from: [-2, 12, 3], to: [1, 15, 6] } },
  socket: { doc: "Mark a socket on a bone (voxel coordinates, size in voxels).", fields: { name: { type: "string", required: true, doc: "e.g. saddle, horn" }, bone: { type: "string", required: true, doc: "the bone it rides" }, at: { type: "num3", required: true, doc: "its origin" }, size: { type: "num3", doc: "[w, h, d] voxels" }, out: { type: "num3", doc: "the way things grow (default up)" } }, example: { op: "socket", name: "saddle", bone: "spine", at: [0, 9, 0], size: [6, 2, 6] } },
  animate: {
    doc: "A motion on a group, in a clip (default \"idle\"; its period follows hz unless given).",
    fields: {
      group: { type: "id", required: true, doc: "the group that moves" }, motion: { type: MOTION_KINDS, required: true, doc: MOTION_KINDS.join(", ") },
      clip: { type: "id", doc: "clip name (default idle)" }, hz: { type: "num", doc: "cycles a second" }, amp: { type: "num", doc: "sway: radians; bob, wave: voxels" },
      axis: { type: AXES, doc: "turning or bobbing axis" }, pivot: { type: "num3", doc: "voxel coordinates (default: the group's base)" },
      from: { type: "num", doc: "hinge: start angle" }, to: { type: "num", doc: "hinge: end angle" }, angle: { type: "num", doc: "pivot: how far" },
      along: { type: AXES, doc: "wave: down which axis" }, dir: { type: AXES, doc: "wave: moving along which axis" }, wavelength: { type: "pos", doc: "wave: voxels" }, pin: { type: ["min", "max"], doc: "wave: the fixed end" },
      rate: { type: "pos", doc: "flicker: changes a second" }, duty: { type: "num", doc: "flicker: share lit" }, frames: { type: "int", doc: "frames to bake" }, period: { type: "pos", doc: "seconds a cycle" },
      parent: { type: "id", doc: "a group it rides" },
    },
    example: { op: "animate", group: "flag", motion: "wave", hz: 0.5 },
  },
  vary: {
    doc: "A variation rule: scale a group, make it optional, pick one of several, or vary the size.",
    fields: {
      name: { type: "id", doc: "the choice's name (default: the group's)" }, group: { type: "id", doc: "the group" },
      scale: { type: "range", doc: "uniform [lo, hi]" }, x: { type: "range", doc: "[lo, hi] across" }, y: { type: "range", doc: "[lo, hi] up" }, z: { type: "range", doc: "[lo, hi] along" },
      anchor: { type: ["bottom", "top", "center", "front", "back", "left", "right"], doc: "what stays put (default bottom)" },
      optional: { type: "num", doc: "chance the group is there" }, pick: { type: "strings", doc: "groups: one is kept" }, size: { type: "range", doc: "the whole thing's size factor" },
    },
    example: { op: "vary", group: "legs", y: [0.8, 1.3], anchor: "top" },
  },
  look: { doc: "Suggest a role's colour (OKLCH [L 0..1, C 0..0.37, hue degrees]); looks can replace it.", fields: { role: { type: "role", required: true, doc: "the role" }, colour: { type: "colour", required: true, doc: "[L, C, h]" } }, example: { op: "look", role: "primary", colour: [0.6, 0.15, 30] } },
  character: { doc: "Design a capsule-and-rig character (the kind the games use) instead of voxels: its kind picks the body contract.", fields: { kind: { type: ["humanoid", "anthro", "animal"], required: true, doc: "humanoid, anthro (two legs), animal (four)" }, species: { type: "string", doc: "human; cat fox bunny bear mouse frog dog (anthro); cat dog fox bear rabbit mouse deer (animal)" }, seed: { type: "string", doc: "the seed its unpinned choices come from" }, size: { type: "pos", doc: "height on two legs, shoulder height on four (m)" }, id: { type: "id", doc: "its id" } }, example: { op: "character", kind: "anthro", species: "fox", seed: "7" } },
  pin: { doc: "Pin one of the catalogue's choices (ears, tail, snout, top, hood, pants, shoes, pack, accessory, coat, height, head, legs...).", fields: { choice: { type: "string", required: true, doc: "the choice" }, value: { type: "any", required: true, doc: "a value it accepts" } }, example: { op: "pin", choice: "ears", value: "tall" } },
  unpin: { doc: "Let a choice come from the seed again.", fields: { choice: { type: "string", required: true, doc: "the choice" } }, example: { op: "unpin", choice: "ears" } },
  proportion: { doc: "Set a rig proportion (headR, hipH, torso, thigh, upperArm... ; bodyLen, neckLen, shoulderH... on four legs): metres, or a scale.", fields: { name: { type: "string", required: true, doc: "the proportion" }, value: { type: "pos", doc: "metres" }, scale: { type: "pos", doc: "times what it is" } }, example: { op: "proportion", name: "headR", scale: 1.25 } },
  part: { doc: "Add (or, by id, edit) a capsule, box or wedge on a bone or socket of the character, with a role. On a socket its numbers are shares of the socket's size.", fields: { id: { type: "id", required: true, doc: "its id" }, shape: { type: ["capsule", "box", "wedge"], required: true, doc: "capsule (a, b, r), box or wedge (c, h, yaw; a wedge's lo)" }, on: { type: "string", required: true, doc: "a socket (head, back, hand.R...) or a bone (tail1, upperArm.L...)" }, role: { type: "string", required: true, doc: "fur, furAlt, cloth, clothAlt, accent, dark, blush, hair -- or primary, trim..." }, units: { type: ["socket", "m"], doc: "socket shares or metres" }, a: { type: "num3", doc: "capsule end" }, b: { type: "num3", doc: "capsule end" }, r: { type: "pos", doc: "capsule radius" }, c: { type: "num3", doc: "box centre" }, h: { type: "num3", doc: "box half-extents" }, yaw: { type: "num", doc: "box turn about the frame's y" }, lo: { type: "num", doc: "wedge foot, 0..0.98" } }, example: { op: "part", id: "horn.L", shape: "capsule", on: "head", a: [-0.2, 0, 0.1], b: [-0.35, 0.7, 0], r: 0.08, role: "furAlt" } },
  unpart: { doc: "Remove a part.", fields: { id: { type: "id", required: true, doc: "its id" } }, example: { op: "unpart", id: "horn.L" } },
  wear: { doc: "Wear an attribute from the session's registry (built to its socket; pins pick its variant).", fields: { attribute: { type: "string", required: true, doc: "its id" }, pins: { type: "object", doc: "its choices, pinned" } }, example: { op: "wear", attribute: "beanie", pins: { pompom: true } } },
  unwear: { doc: "Take an attribute off.", fields: { attribute: { type: "string", required: true, doc: "its id" } }, example: { op: "unwear", attribute: "beanie" } },
  target: {
    doc: "What it becomes: an object, an attribute (for a socket) or an entity (rigged, or a character).",
    fields: {
      as: { type: ["object", "attribute", "entity"], required: true, doc: "object, attribute or entity" }, id: { type: "id", doc: "its id (default the model's name)" },
      title: { type: "string", doc: "a title" }, tags: { type: "strings", doc: "tags" },
      slot: { type: "string", doc: "attribute: its socket (head, back, neck, hand.R...)" }, bodies: { type: "strings", doc: "attribute: body ranges it fits (default humanoid and quadruped)" },
      fit: { type: ["width", "height", "depth", "contain", "stretch"], doc: "attribute: how it's sized to the socket" }, fill: { type: "pos", doc: "attribute: share of the socket" },
      anchor: { type: ["auto", "bottom", "top", "back", "front", "center"], doc: "attribute: which face sits on the socket" },
      front: { type: ["detect", "+z", "-z", "+x", "-x", "none"], doc: "object: its front (default detect)" }, smooth: { type: "bool", doc: "long boxes as capsules" },
    },
    example: { op: "target", as: "attribute", id: "war-flag", slot: "back", fit: "height", anchor: "bottom" },
  },
};

export type AgentOp = { readonly op: string; readonly [field: string]: unknown };
export interface OpError { readonly index: number; readonly op: string; readonly field?: string; readonly message: string }

// (How far apart two words are: to suggest the op or field meant.)
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    // (Two letters swapped is one slip, not two.)
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
  }
  return d[a.length]![b.length]!;
}
const nearest = (w: string, list: readonly string[]): string | null => {
  let best: string | null = null, bd = Infinity;
  for (const x of list) { const dd = distance(w.toLowerCase(), x.toLowerCase()); if (dd < bd) { bd = dd; best = x; } }
  return bd <= Math.max(2, Math.floor(w.length / 3)) ? best : null;
};

const isInt3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && Math.abs(n as number) < 2048);
const isNum3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const ID = /^[a-z0-9][a-z0-9.-]*$/i;

function checkField(t: FieldType, v: unknown): string | null {
  if (Array.isArray(t)) return typeof v === "string" && t.includes(v) ? null : `one of ${t.map((x) => JSON.stringify(x)).join(", ")}`;
  switch (t) {
    case "int3": return isInt3(v) ? null : "[x, y, z] whole numbers (-2048..2047)";
    case "num3": return isNum3(v) ? null : "[x, y, z] numbers";
    case "int": return Number.isInteger(v) ? null : "a whole number";
    case "num": return typeof v === "number" && Number.isFinite(v) ? null : "a number";
    case "pos": return typeof v === "number" && v > 0 && Number.isFinite(v) ? null : "a number above 0";
    case "string": return typeof v === "string" || typeof v === "number" ? null : "a string";
    case "id": return typeof v === "string" && ID.test(v) ? null : "a name: letters, digits, dots and dashes";
    case "role": return typeof v === "string" && ROLE_NAME.test(v) ? null : "a role: primary, secondary, trim, accent, skin, dark, glow (or your own: lower-case, a letter first)";
    case "role?": return v === null || (typeof v === "string" && ROLE_NAME.test(v)) ? null : "a role (primary, secondary, trim, accent, skin, dark, glow, or your own) or null";
    case "bool": return typeof v === "boolean" ? null : "true or false";
    case "range": return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? null : "[lo, hi] numbers";
    case "strings": return Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "a list of strings";
    case "colour": return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? null : "[L, C, hue] numbers (OKLCH)";
    case "any": return v === undefined ? "a value" : null;
    case "object": return v && typeof v === "object" && !Array.isArray(v) ? null : "an object";
  }
  return null;
}

/** Check an op list's shape (no model needed): unknown ops and fields, missing ones, wrong types. */
export function validateOps(ops: unknown): { ok: boolean; errors: OpError[] } {
  const errors: OpError[] = [];
  if (!Array.isArray(ops)) return { ok: false, errors: [{ index: -1, op: "", message: "The op list must be an array of { op, ... } objects." }] };
  ops.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors.push({ index, op: "", message: `ops[${index}] must be an object like { "op": "box", ... }.` }); return; }
    const o = raw as Record<string, unknown>;
    const name = o["op"];
    if (typeof name !== "string") { errors.push({ index, op: "", message: `ops[${index}] has no "op" (one of ${Object.keys(OPS).join(", ")}).` }); return; }
    const spec = OPS[name];
    if (!spec) { const n = nearest(name, Object.keys(OPS)); errors.push({ index, op: name, message: `ops[${index}]: no op "${name}"${n ? ` -- did you mean "${n}"?` : ""} (ops: ${Object.keys(OPS).join(", ")}).` }); return; }
    for (const [f, fs] of Object.entries(spec.fields)) {
      if (!(f in o)) { if (fs.required) errors.push({ index, op: name, field: f, message: `ops[${index}] (${name}): "${f}" is required -- ${fs.doc}. e.g. ${JSON.stringify(spec.example)}` }); continue; }
      const bad = checkField(fs.type, o[f]);
      if (bad) errors.push({ index, op: name, field: f, message: `ops[${index}] (${name}): "${f}" must be ${bad}; got ${JSON.stringify(o[f])}.` });
    }
    for (const f of Object.keys(o)) {
      if (f === "op" || f in spec.fields) continue;
      const n = nearest(f, Object.keys(spec.fields));
      errors.push({ index, op: name, field: f, message: `ops[${index}] (${name}): no field "${f}"${n ? ` -- did you mean "${n}"?` : ""} (fields: ${Object.keys(spec.fields).join(", ") || "none"}).` });
    }
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- sessions

export type TargetKind = "object" | "attribute" | "entity";
export interface Target {
  as: TargetKind;
  id?: string;
  title?: string;
  tags?: string[];
  slot?: string;
  bodies?: string[];
  fit?: FitMode;
  fill?: number;
  anchor?: Anchor;
  front?: string;
  smooth?: boolean;
}

/** What an op changed -- small enough to stream, enough for a live preview to update without rebuilding the rest. */
export type ChangeKind = "voxels" | "model" | "group" | "attach" | "rig" | "animation" | "variation" | "look" | "target" | "character" | "proportion" | "part" | "wear" | "undo" | "redo";

/** A group worn as an attribute: its socket and how it's built to it (attributeFromVoxels' options). */
export interface Attachment {
  socket: string;
  id?: string;
  fit?: FitMode;
  fill?: number;
  anchor?: Anchor;
  offset?: [number, number, number];
  bodies?: string[];
}
export interface ChangeEvent {
  /** Its place in the session's history (undo takes it back). */
  readonly seq: number;
  readonly op: string;
  readonly kind: ChangeKind;
  /** What it did, in words. */
  readonly did: string;
  /** voxels: the cells that changed ([x, y, z] triplets) and the palette index each holds now (0: empty), with the palette. */
  readonly cells?: { readonly at: Int16Array; readonly now: Uint8Array; readonly roles: readonly string[] };
  /** voxels: their bounds, and how many were added, removed or recoloured. */
  readonly region?: { readonly min: V3; readonly max: V3 };
  readonly added?: number;
  readonly removed?: number;
  readonly recoloured?: number;
  /** The group, bone, choice, proportion, part, attribute or clip it touched. */
  readonly name?: string;
  readonly action?: "add" | "edit" | "remove";
  /** What a preview must redo: "none" (cells above say it all), "skin" (re-skin the same rig), "all". */
  readonly rebuild: "none" | "skin" | "all";
  /** undo / redo: the kind of change undone or redone. */
  readonly of?: ChangeKind;
}

/** One applied op: the op, its change, and how to take it back. */
interface Applied { readonly op: AgentOp; readonly event: ChangeEvent; readonly restore: () => HistoryEntry[] }

/** What a run of ops builds up: the model (through its editor) or a character design, and everything said about it. */
export interface Session {
  editor: Editor;
  rig: RigEdits | null;
  animation: { clips: Record<string, ObjectClip>; parents: Record<string, string> };
  variation: { scale: Record<string, ScaleRule>; optional: Record<string, number>; pick: Record<string, string[]>; size?: [number, number] };
  colours: Record<string, Oklch>;
  target: Target;
  /** Groups worn as attributes, by group: they leave the body and build as attributes for their sockets. */
  attachments: Record<string, Attachment>;
  /** A capsule-and-rig character being designed (then the voxel model is set aside), or null. */
  design: CharacterDesign | null;
  /** Attributes a character may wear, by id (the host's packs, and what the user has built). */
  readonly attributes: Map<string, AttributeDef<AttributeShape>>;
  /** Ops applied, newest last (undo takes them back one at a time), and ops undone (redo applies them again). */
  readonly history: Applied[];
  readonly undone: AgentOp[];
  seq: number;
}

export function createSession(model: VoxelModel = createVoxels(), { attributes = [] }: { attributes?: ReadonlyArray<AttributeDef<AttributeShape>> } = {}): Session {
  return {
    editor: createEditor(model, { depth: SESSION_DEPTH }), rig: null, animation: { clips: {}, parents: {} }, variation: { scale: {}, optional: {}, pick: {} }, colours: {}, target: { as: "object" }, attachments: {},
    design: null, attributes: new Map(attributes.map((a) => [a.id, a])), history: [], undone: [], seq: 0,
  };
}

// (A session's editor keeps this many brush entries: an imported model replays as a thousand boxes, each undoable.)
const SESSION_DEPTH = 8192;

const BRUSH = new Set(["set", "box", "fill", "sphere", "line", "mirror", "erase", "recolour", "symmetry"]);

/** How many voxels a group holds (the first group holding a voxel has it). */
function groupCells(m: VoxelModel, name: string): number {
  let n = 0;
  m.forEach((x, y, z) => { if (m.groupAt(x, y, z) === name) n += 1; });
  return n;
}

/** The body: the model without its attached groups (what's rigged and becomes the entity or object). */
export function bodyOf(s: Pick<Session, "editor" | "attachments">): VoxelModel {
  const m = s.editor.model;
  const attached = Object.keys(s.attachments);
  if (!attached.length) return m;
  const out = m.clone();
  for (const g of attached) if (out.groups.has(g)) removeGroup(out, g);
  // (Cells another group held first stay: removeGroup takes only the group's own.)
  return out;
}

/** An attached group on its own: its cells, in the model's coordinates, unit and roles. */
export function attachmentModel(s: Pick<Session, "editor">, group: string): VoxelModel {
  const m = s.editor.model;
  if (!m.groups.has(group)) throw new RangeError(`no group "${group}"`);
  const out = createVoxels({ unit: m.unit, roles: m.roles, name: group });
  m.forEach((x, y, z, v) => { if (m.groupAt(x, y, z) === group) out.setIndex(x, y, z, v); });
  return out;
}

// (Everything an op may change, so it can be put back: brush ops come off the editor's history, the rest from a copy.)
function snapshot(s: Session): () => HistoryEntry[] {
  const editor = s.editor;
  const m = editor.model;
  const serial = editor.history().serial;
  const meta ={ unit: m.unit, origin: m.origin, name: m.name, groups: JSON.stringify([...m.groups]) };
  const sym = editor.symmetry;
  const rest = JSON.stringify({ rig: s.rig, animation: s.animation, variation: s.variation, colours: s.colours, target: s.target, attachments: s.attachments, design: s.design });
  return () => {
    const undone: HistoryEntry[] = [];
    s.editor = editor;
    // (By the serial, not the count: a full history drops its oldest entry for each new one and the count stands still.)
    while (editor.history().serial > serial) { const e = editor.last(); if (!e || !editor.undo()) break; undone.push(e); }
    editor.symmetry = sym;
    m.unit = meta.unit; m.origin = meta.origin; m.name = meta.name;
    m.groups.clear();
    for (const [k, v] of JSON.parse(meta.groups) as Array<[string, never]>) m.groups.set(k, v);
    Object.assign(s, JSON.parse(rest));
    return undone;
  };
}

/** A change's voxel cells from history entries (the values `pick` says: after an op, before for its undo). */
function cellsOf(entries: readonly HistoryEntry[], pick: "after" | "before", roles: readonly string[]): Pick<ChangeEvent, "cells" | "region" | "added" | "removed" | "recoloured"> {
  const map = new Map<string, [number, number, number, number, number]>();
  // (Undo lists newest first: the first entry seen for a cell is the one that decides it.)
  for (const e of entries) for (let i = 0; i < e.before.length; i += 1) {
    const k = `${e.at[i * 3]},${e.at[i * 3 + 1]},${e.at[i * 3 + 2]}`;
    const prev = map.get(k);
    const was = pick === "after" ? e.before[i]! : e.after[i]!;
    const now = pick === "after" ? e.after[i]! : e.before[i]!;
    if (prev) { if (pick === "after") prev[4] = now; else prev[4] = now; continue; }
    map.set(k, [e.at[i * 3]!, e.at[i * 3 + 1]!, e.at[i * 3 + 2]!, was, now]);
  }
  const list = [...map.values()];
  const at = new Int16Array(list.length * 3);
  const now = new Uint8Array(list.length);
  let added = 0, removed = 0, recoloured = 0;
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  list.forEach(([x, y, z, w, n], i) => {
    at[i * 3] = x; at[i * 3 + 1] = y; at[i * 3 + 2] = z; now[i] = n;
    if (!w && n) added += 1; else if (w && !n) removed += 1; else if (w !== n) recoloured += 1;
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  });
  return { cells: { at, now, roles: [...roles] }, ...(list.length ? { region: { min, max } } : {}), added, removed, recoloured };
}

type Change = Omit<ChangeEvent, "seq" | "op">;

function needDesign(s: Session, op: string): CharacterDesign {
  if (!s.design) throw new Error(`${op} is for characters: start one with { "op": "character", "kind": "anthro" }`);
  return s.design;
}

function runOne(s: Session, o: AgentOp): Change {
  const m = s.editor.model;
  const f = o as Record<string, unknown>;
  switch (o.op) {
    case "new": { s.editor = createEditor(createVoxels({ unit: (f["unit"] as number | undefined) ?? 0.1, name: (f["name"] as string | undefined) ?? "model" }), { depth: SESSION_DEPTH }); s.rig = null; s.design = null; s.animation = { clips: {}, parents: {} }; s.variation = { scale: {}, optional: {}, pick: {} }; s.target = { as: "object" }; s.attachments = {}; return { kind: "model", did: "a new empty model", rebuild: "all" }; }
    case "unit": m.unit = f["metres"] as number; return { kind: "model", did: `a voxel is ${m.unit} m`, rebuild: "all" };
    case "origin": m.origin = f["at"] ? [...(f["at"] as [number, number, number])] : null; return { kind: "model", did: m.origin ? `pivot at ${JSON.stringify(m.origin)}` : "pivot: the middle of the base", rebuild: "all" };
    case "group": {
      const name = f["name"] as string;
      const a = f["from"] as [number, number, number], b = f["to"] as [number, number, number];
      const rs = f["replace"] ? [] : m.groups.get(name) ?? [];
      const had = m.groups.has(name);
      const region = { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])] as V3, max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] as V3 };
      rs.push(region);
      m.groups.set(name, rs);
      // (A replaced group moves every chunk it was in; adding a region changes only the chunks under it.)
      const all = Boolean(f["replace"]) && had;
      // (Counted inside the new region only: an imported part is hundreds of regions, and a whole-model count each would be quadratic.)
      let inside = 0;
      for (let z = region.min[2]; z <= region.max[2]; z += 1) for (let y = region.min[1]; y <= region.max[1]; y += 1) for (let x = region.min[0]; x <= region.max[0]; x += 1) if (m.get(x, y, z) && m.groupAt(x, y, z) === name) inside += 1;
      return { kind: "group", did: `group ${name}: ${inside} voxels in ${JSON.stringify(region.min)}..${JSON.stringify(region.max)}`, name, action: had ? "edit" : "add", rebuild: all ? "all" : "none", ...(all ? {} : { region: { min: [...region.min] as V3, max: [...region.max] as V3 } }) };
    }
    case "ungroup": {
      const name = f["name"] as string;
      if (!m.groups.delete(name)) throw new Error(`no group "${name}" (groups: ${[...m.groups.keys()].join(", ") || "none"})`);
      delete s.attachments[name];
      return { kind: "group", did: `forgot ${name}`, name, action: "remove", rebuild: "all" };
    }
    case "merge": {
      const names = f["groups"] as string[];
      if (names.length < 2) throw new Error("merge needs two or more groups");
      for (const g of names) if (!m.groups.has(g)) { const n = nearest(g, [...m.groups.keys()]); throw new Error(`no group "${g}"${n ? ` -- did you mean "${n}"?` : ""} (groups: ${[...m.groups.keys()].join(", ") || "none"})`); }
      const into = (f["into"] as string | undefined) ?? names[0]!;
      if (m.groups.has(into) && !names.includes(into)) throw new Error(`"${into}" is another group already: merge it too, or pick a new name`);
      // (The merged group takes the first's place in the order, so the voxels it held stay its.)
      const regions = names.flatMap((g) => m.groups.get(g)!);
      const order = [...m.groups.entries()];
      const at = order.findIndex(([g]) => names.includes(g));
      const kept = order.filter(([g]) => !names.includes(g));
      kept.splice(at, 0, [into, regions]);
      m.groups.clear();
      for (const [g, rs] of kept) m.groups.set(g, rs);
      const attached = names.map((g) => s.attachments[g]).find((a) => a);
      for (const g of names) delete s.attachments[g];
      if (attached) s.attachments[into] = attached;
      return { kind: "group", did: `merged ${names.join(", ")} into ${into}: ${groupCells(m, into)} voxels`, name: into, action: "edit", rebuild: "all" };
    }
    case "attach": {
      const group = f["group"] as string;
      if (!m.groups.has(group)) { const n = nearest(group, [...m.groups.keys()]); throw new Error(`no group "${group}"${n ? ` -- did you mean "${n}"?` : ""} (groups: ${[...m.groups.keys()].join(", ") || "none: name one with { op: \"group\" }"})`); }
      const socket = f["socket"] as string;
      const known = s.rig ? Object.keys(autoRig(bodyOf(s), s.rig).sockets) : [...new Set([...contractOf({ plan: "humanoid" }).sockets, ...contractOf({ plan: "quadruped" }).sockets].map((c) => c.name))];
      if (!known.includes(socket)) { const n = nearest(socket, known); throw new Error(`no socket "${socket}"${n ? ` -- did you mean "${n}"?` : ""} (sockets: ${known.join(", ")})`); }
      const had = s.attachments[group];
      const a: Attachment = { socket };
      for (const k of ["id", "fit", "fill", "anchor", "offset", "bodies"] as const) if (f[k] !== undefined) (a as unknown as Record<string, unknown>)[k] = f[k];
      s.attachments[group] = a;
      return { kind: "attach", did: had ? `${group}: ${had.socket} -> ${socket}` : `${group} worn in ${socket}`, name: group, action: had ? "edit" : "add", rebuild: "none" };
    }
    case "detach": {
      const group = f["group"] as string;
      if (!s.attachments[group]) throw new Error(`"${group}" isn't attached (attached: ${Object.keys(s.attachments).join(", ") || "none"})`);
      delete s.attachments[group];
      return { kind: "attach", did: `${group} is body again`, name: group, action: "remove", rebuild: "none" };
    }
    case "generate": {
      const g = generate(f["kind"] as GeneratorKind, String(f["seed"]), f["plan"] ? { plan: f["plan"] as Plan } : {});
      s.editor = createEditor(g.model, { depth: SESSION_DEPTH });
      s.design = null;
      s.attachments = {};
      s.animation = { clips: { ...(g.animation?.clips ?? {}) } as Record<string, ObjectClip>, parents: { ...(g.animation?.parents ?? {}) } };
      s.variation = { scale: { ...(g.rules.scale ?? {}) }, optional: { ...(g.rules.optional ?? {}) }, pick: Object.fromEntries(Object.entries(g.rules.pick ?? {}).map(([k, v]) => [k, [...v]])), ...(g.rules.size ? { size: [g.rules.size[0], g.rules.size[1]] as [number, number] } : {}) };
      s.colours = { ...g.colours };
      s.rig = g.target === "entity" ? { plan: g.truth!.plan } : null;
      s.target = { as: g.target, id: g.model.name };
      return { kind: "model", did: `generated ${g.model.name}: ${g.model.count} voxels, groups ${[...g.model.groups.keys()].join(", ") || "none"}`, rebuild: "all" };
    }
    case "rig": {
      const as = (f["as"] as string | undefined) ?? "auto";
      const given = f["joints"] as Record<string, unknown> | undefined;
      if (given) for (const [k, v] of Object.entries(given)) if (!isNum3(v)) throw new Error(`joints.${k} must be [x, y, z] numbers; got ${JSON.stringify(v)}`);
      const edits: RigEdits = {
        ...(s.rig ?? {}), ...(as === "auto" ? {} : { plan: as as Plan }), ...(f["limbs"] ? { limbs: f["limbs"] as "capsule" | "rigid" | "auto" } : {}),
        ...(given ? { joints: { ...(s.rig?.joints ?? {}), ...(given as Record<string, [number, number, number]>) } } : {}),
      };
      if (as === "auto") delete (edits as { plan?: Plan }).plan;
      const r = autoRig(bodyOf(s), edits);
      s.rig = { ...edits, plan: r.plan };
      s.target = { ...s.target, as: "entity" };
      return { kind: "rig", did: `rigged as ${r.plan}: ${r.analysis.why[0]}; ${r.skin.boxes.length} boxes, ${r.skin.capsules.length} capsules${r.missing.length ? `; missing sockets ${r.missing.join(", ")}` : ""}`, rebuild: "all" };
    }
    case "joint": case "assign": case "socket": {
      if (!s.rig) throw new Error(`${o.op} needs a rig: add { "op": "rig" } first`);
      const r0 = autoRig(bodyOf(s), s.rig);
      const bone = f["bone"] as string;
      if (r0.spec.rig.index[bone] === undefined) {
        const n = nearest(bone, r0.spec.rig.bones.map((b) => b.name));
        throw new Error(`no bone "${bone}" on a ${r0.plan}${n ? ` -- did you mean "${n}"?` : ""} (bones: ${r0.spec.rig.bones.map((b) => b.name).join(", ")})`);
      }
      if (o.op === "joint") s.rig = { ...s.rig, joints: { ...(s.rig.joints ?? {}), [bone]: f["at"] as [number, number, number] } };
      else if (o.op === "assign") s.rig = { ...s.rig, assign: [...(s.rig.assign ?? []), { from: f["from"] as [number, number, number], to: f["to"] as [number, number, number], bone }] };
      else s.rig = { ...s.rig, sockets: { ...(s.rig.sockets ?? {}), [f["name"] as string]: { bone, at: f["at"] as [number, number, number], ...(f["size"] ? { size: f["size"] as [number, number, number] } : {}), ...(f["out"] ? { out: f["out"] as [number, number, number] } : {}) } } };
      autoRig(bodyOf(s), s.rig);
      return { kind: "rig", did: `${o.op} ${bone}`, name: o.op === "socket" ? f["name"] as string : bone, action: "edit", rebuild: o.op === "socket" ? "none" : "skin" };
    }
    case "animate": {
      const group = f["group"] as string;
      if (!m.groups.has(group)) { const n = nearest(group, [...m.groups.keys()]); throw new Error(`no group "${group}"${n ? ` -- did you mean "${n}"?` : ""} (groups: ${[...m.groups.keys()].join(", ") || "none: name one with { op: \"group\" }"})`); }
      const kind = f["motion"] as Motion["kind"];
      const hz = (f["hz"] as number | undefined) ?? (kind === "hinge" ? 0.25 : kind === "spin" ? 0.25 : kind === "sway" ? 0.3 : kind === "bob" ? 0.5 : kind === "wave" ? 0.5 : 0);
      const pick = <K extends string>(...keys: K[]): Partial<Record<K, unknown>> => Object.fromEntries(keys.filter((k) => f[k] !== undefined).map((k) => [k, f[k]])) as Partial<Record<K, unknown>>;
      let motion: Motion;
      switch (kind) {
        case "hinge": motion = { kind, group, hz, to: (f["to"] as number | undefined) ?? 1.4, ...pick("from", "axis", "pivot") } as Motion; break;
        case "pivot": motion = { kind, group, angle: (f["angle"] as number | undefined) ?? 1.4, ...pick("axis", "pivot") } as Motion; break;
        case "spin": motion = { kind, group, hz, ...pick("axis", "pivot") } as Motion; break;
        case "sway": motion = { kind, group, hz, amp: (f["amp"] as number | undefined) ?? 0.12, ...pick("axis", "pivot") } as Motion; break;
        case "bob": motion = { kind, group, hz, amp: (f["amp"] as number | undefined) ?? 1, ...pick("axis") } as Motion; break;
        case "wave": motion = { kind, group, hz, amp: (f["amp"] as number | undefined) ?? 1.4, ...pick("along", "dir", "wavelength", "pin") } as Motion; break;
        default: motion = { kind: "flicker", group, ...pick("rate", "duty") } as Motion;
      }
      const clip = (f["clip"] as string | undefined) ?? "idle";
      const had = s.animation.clips[clip];
      const period = (f["period"] as number | undefined) ?? had?.period ?? (kind === "pivot" ? 1 : kind === "flicker" ? 2 : 1 / Math.max(1e-3, hz));
      s.animation.clips[clip] = { period, frames: (f["frames"] as number | undefined) ?? had?.frames ?? 8, ...(kind === "pivot" ? { loop: false } : {}), motions: [...(had?.motions ?? []), motion] };
      if (f["parent"]) s.animation.parents[group] = f["parent"] as string;
      const bad = checkAnimation(m, s.animation as ObjectAnimation);
      if (bad.length) throw new Error(bad.join("; "));
      return { kind: "animation", did: `${clip}: ${group} ${kind}${hz ? ` at ${hz} Hz` : ""}`, name: clip, action: had ? "edit" : "add", rebuild: "none" };
    }
    case "vary": {
      const group = f["group"] as string | undefined;
      const name = (f["name"] as string | undefined) ?? group ?? "size";
      if (f["size"]) s.variation.size = f["size"] as [number, number];
      if (f["optional"] !== undefined) { if (!group) throw new Error("optional needs a group"); s.variation.optional[group] = f["optional"] as number; }
      if (f["pick"]) s.variation.pick[name] = f["pick"] as string[];
      if (f["scale"] || f["x"] || f["y"] || f["z"]) {
        if (!group) throw new Error("scale needs a group");
        s.variation.scale[name] = { region: group, ...(f["scale"] ? { uniform: f["scale"] as [number, number] } : {}), ...(f["x"] ? { x: f["x"] as [number, number] } : {}), ...(f["y"] ? { y: f["y"] as [number, number] } : {}), ...(f["z"] ? { z: f["z"] as [number, number] } : {}), ...(f["anchor"] ? { anchor: f["anchor"] as ScaleAnchor } : {}) };
      }
      const bad = checkVariation(m, s.variation);
      if (bad.length) throw new Error(bad.join("; "));
      return { kind: "variation", did: `vary ${name}`, name, rebuild: "none" };
    }
    case "look": s.colours[f["role"] as string] = f["colour"] as Oklch; return { kind: "look", did: `${f["role"]} wears ${JSON.stringify(f["colour"])}`, name: f["role"] as string, rebuild: "none" };
    case "target": {
      const t: Target = { as: f["as"] as TargetKind };
      for (const k of ["id", "title", "tags", "slot", "bodies", "fit", "fill", "anchor", "front", "smooth"] as const) if (f[k] !== undefined) (t as unknown as Record<string, unknown>)[k] = f[k];
      if (t.as === "attribute" && !t.slot) throw new Error('an attribute needs a slot: { "op": "target", "as": "attribute", "slot": "head" }');
      if (s.design && t.as !== "entity") throw new Error("a character is an entity: target it as entity (or start a voxel model with new)");
      if (t.as === "entity" && !s.rig && !s.design) s.rig = {};
      s.target = t;
      return { kind: "target", did: `target: ${t.as}${t.id ? ` ${t.id}` : ""}`, rebuild: "none" };
    }
    case "recolour": {
      const g = f["group"] as string | undefined;
      if (!g) return { kind: "voxels", did: `${s.editor.recolour(f["from"] as string, f["to"] as string)} voxels changed`, rebuild: "none" };
      const rs = m.groups.get(g);
      if (!rs) throw new Error(`no group "${g}" (groups: ${[...m.groups.keys()].join(", ") || "none"})`);
      let n = 0;
      for (const r of rs) n += s.editor.recolour(f["from"] as string, f["to"] as string, { from: r.min, to: r.max });
      return { kind: "voxels", did: `${n} voxels changed`, rebuild: "none" };
    }
    // Characters: the capsule-and-rig kind the games use.
    case "character": {
      const d = characterDesign({ kind: f["kind"] as Kind, ...(f["species"] ? { species: f["species"] as Species } : {}), seed: f["seed"] !== undefined ? String(f["seed"]) : "1", ...(f["size"] !== undefined ? { size: f["size"] as number } : {}) });
      const spec = characterSpec(d);
      s.design = d;
      s.rig = null;
      s.target = { as: "entity", id: (f["id"] as string | undefined) ?? `${d.kind === "anthro" ? "anthro-" : ""}${spec.species}` };
      return { kind: "character", did: `a ${spec.kind} ${spec.species} (${spec.plan}, ${contractOf(spec).ref}), seed ${d.seed}`, rebuild: "all" };
    }
    case "pin": case "unpin": {
      const d = needDesign(s, o.op);
      const choice = f["choice"] as string;
      if (!choiceNames().includes(choice)) { const n = nearest(choice, choiceNames()); throw new Error(`no choice "${choice}"${n ? ` -- did you mean "${n}"?` : ""} (choices: ${choiceNames().join(", ")})`); }
      const had = choice in d.pins;
      if (o.op === "pin") d.pins[choice] = f["value"]; else delete d.pins[choice];
      characterSpec(d);
      return { kind: "character", did: o.op === "pin" ? `${choice} = ${JSON.stringify(f["value"])}` : `${choice} from the seed`, name: choice, action: o.op === "unpin" ? "remove" : had ? "edit" : "add", rebuild: "all" };
    }
    case "proportion": {
      const d = needDesign(s, o.op);
      const name = f["name"] as string;
      const names = proportionNames(d.kind);
      if (!names.includes(name)) { const n = nearest(name, names); throw new Error(`no proportion "${name}" on a ${d.kind}${n ? ` -- did you mean "${n}"?` : ""} (${names.join(", ")})`); }
      if (f["value"] === undefined && f["scale"] === undefined) throw new Error("give a value (metres) or a scale");
      const before = (characterSpec(d).body as unknown as Record<string, number>)[name]!;
      d.body[name] = f["value"] !== undefined ? { value: f["value"] as number } : { scale: f["scale"] as number };
      const after = (characterSpec(d).body as unknown as Record<string, number>)[name]!;
      return { kind: "proportion", did: `${name} ${before.toFixed(3)} -> ${after.toFixed(3)} m`, name, action: "edit", rebuild: "all" };
    }
    case "part": {
      const d = needDesign(s, o.op);
      const part: PartDesign = { id: f["id"] as string, shape: f["shape"] as PartDesign["shape"], on: f["on"] as string, role: f["role"] as string, ...Object.fromEntries(["units", "a", "b", "r", "c", "h", "yaw", "lo"].filter((k) => f[k] !== undefined).map((k) => [k, f[k]])) };
      const ROLES_OK = ["fur", "furAlt", "cloth", "clothAlt", "accent", "dark", "blush", "hair", "primary", "secondary", "trim", "skin", "glow"];
      if (!ROLES_OK.includes(part.role)) { const n = nearest(part.role, ROLES_OK); throw new Error(`role "${part.role}"${n ? ` -- did you mean "${n}"?` : ""}: one of ${ROLES_OK.join(", ")}`); }
      const bad = checkPart(characterSpec(d), part);
      if (bad.length) throw new Error(bad.join("; "));
      const at = d.parts.findIndex((p) => p.id === part.id);
      if (at >= 0) d.parts[at] = part; else d.parts.push(part);
      return { kind: "part", did: `${at >= 0 ? "edited" : "added"} ${part.shape} ${part.id} on ${part.on}`, name: part.id, action: at >= 0 ? "edit" : "add", rebuild: "skin" };
    }
    case "unpart": {
      const d = needDesign(s, o.op);
      const at = d.parts.findIndex((p) => p.id === f["id"]);
      if (at < 0) throw new Error(`no part "${f["id"]}" (parts: ${d.parts.map((p) => p.id).join(", ") || "none"})`);
      d.parts.splice(at, 1);
      return { kind: "part", did: `removed ${f["id"]}`, name: f["id"] as string, action: "remove", rebuild: "skin" };
    }
    case "wear": case "unwear": {
      const d = needDesign(s, o.op);
      const id = f["attribute"] as string;
      if (o.op === "unwear") {
        const at = d.wear.findIndex((w) => w.attribute === id);
        if (at < 0) throw new Error(`not wearing "${id}"`);
        d.wear.splice(at, 1);
        return { kind: "wear", did: `took off ${id}`, name: id, action: "remove", rebuild: "skin" };
      }
      const def = s.attributes.get(id);
      if (!def) { const n = nearest(id, [...s.attributes.keys()]); throw new Error(`no attribute "${id}"${n ? ` -- did you mean "${n}"?` : ""} (attributes: ${[...s.attributes.keys()].join(", ") || "none given to this session"})`); }
      const pins = (f["pins"] as Record<string, unknown> | undefined) ?? {};
      // (Built to its socket now, so a slot the body hasn't got fails here, not at bake.)
      wear(def, characterSpec(d), stream(createRoll(deriveSeed(d.seed, `attribute:${id}`)), 0), pins);
      const at = d.wear.findIndex((w) => w.attribute === id);
      if (at >= 0) d.wear[at] = { attribute: id, pins }; else d.wear.push({ attribute: id, pins });
      return { kind: "wear", did: `wearing ${id} (${def.slot})`, name: id, action: at >= 0 ? "edit" : "add", rebuild: "skin" };
    }
    default: {
      if (!BRUSH.has(o.op)) throw new Error(`no op "${o.op}"`);
      if (s.design && o.op !== "symmetry") throw new Error(`${o.op} builds voxels; this session is designing a character (start a voxel model with new)`);
      const changed = s.editor.apply(o as unknown as EditOp);
      return o.op === "symmetry" ? { kind: "voxels", did: `symmetry ${(f["mode"] as SymmetryMode)}`, rebuild: "none" } : { kind: "voxels", did: `${changed} voxels changed`, rebuild: "none" };
    }
  }
}

/** One op applied: its change event, or why it couldn't be. */
export type OpResult = { readonly ok: true; readonly event: ChangeEvent } | { readonly ok: false; readonly error: OpError };

/**
 * Apply one op to a session -- the streaming form: a live preview applies ops
 * as an agent emits them and updates from each event. The op joins the
 * session's history (undo takes it back); an op that fails changes nothing.
 */
export function applyOp(session: Session, op: AgentOp, index = session.history.length): OpResult {
  const r = applyInner(session, op, index);
  // (A new op drops what could have been redone.)
  if (r.ok && op.op !== "undo" && op.op !== "redo") session.undone.length = 0;
  return r;
}

function applyInner(session: Session, op: AgentOp, index: number): OpResult {
  const v = validateOps([op]);
  if (!v.ok) return { ok: false, error: { ...v.errors[0]!, index, message: v.errors[0]!.message.replace(/^ops\[0\]/, `ops[${index}]`) } };
  const fail = (e: unknown): OpResult => ({ ok: false, error: { index, op: op.op, message: `ops[${index}] (${op.op}): ${(e as Error).message}` } });
  const s = session;
  if (op.op === "undo" || op.op === "redo") {
    const n = (op["steps"] as number | undefined) ?? 1;
    let last: ChangeEvent | null = null;
    for (let k = 0; k < n; k += 1) {
      if (op.op === "undo") {
        const a = s.history.pop();
        if (!a) break;
        const roles = [...s.editor.model.roles];
        const entries = a.restore();
        s.undone.push(a.op);
        last = { seq: s.seq++, op: "undo", kind: "undo", of: a.event.kind, did: `undid ${a.op.op}: ${a.event.did}`, rebuild: entries.length && a.event.kind === "voxels" ? "none" : "all", ...(entries.length ? cellsOf(entries, "before", roles) : {}) };
      } else {
        const again = s.undone.pop();
        if (!again) break;
        const r = applyInner(s, again, index);
        if (!r.ok) return r;
        last = { ...r.event, op: "redo", kind: "redo", of: r.event.kind };
      }
    }
    if (!last) return fail(new Error(`nothing to ${op.op}`));
    return { ok: true, event: last };
  }
  const restore = snapshot(s);
  const before = s.editor.history().serial;
  const editorBefore = s.editor;
  let change: Change;
  try { change = runOne(s, op); }
  catch (e) { restore(); return fail(e); }
  // (A brush op's cells: the editor entries it just made -- a recolour in a group makes one per region.)
  const made: HistoryEntry[] = [];
  if (s.editor === editorBefore && change.kind === "voxels") {
    const n = s.editor.history().serial - before;
    made.push(...s.editor.recent(n));
  }
  const event: ChangeEvent = { seq: s.seq++, op: op.op, ...change, ...(made.length ? cellsOf(made, "after", s.editor.model.roles) : {}) };
  s.history.push({ op, event, restore });
  return { ok: true, event };
}

/** Apply ops one at a time, yielding each result (stop at the first failure): what a live preview drives off. */
export function* streamOps(ops: readonly AgentOp[], session: Session): Generator<OpResult, void, unknown> {
  for (let i = 0; i < ops.length; i += 1) {
    const r = applyOp(session, ops[i]!, i);
    yield r;
    if (!r.ok) return;
  }
}

export interface RunResult {
  readonly ok: boolean;
  readonly session: Session;
  readonly errors: OpError[];
  /** What each op did (up to the failing one). */
  readonly results: Array<{ index: number; op: string; did: string }>;
  /** The change events, in order. */
  readonly events: ChangeEvent[];
}

/** Validate, then run an op list on a session (a new one by default). Atomic: an op failing leaves the session as it was. */
export function runOps(ops: unknown, session: Session = createSession(), { atomic = true }: { atomic?: boolean } = {}): RunResult {
  const v = validateOps(ops);
  if (!v.ok) return { ok: false, session, errors: v.errors, results: [], events: [] };
  const results: RunResult["results"] = [];
  const events: ChangeEvent[] = [];
  const list = ops as AgentOp[];
  const start = session.history.length;
  const undone = [...session.undone];
  for (let index = 0; index < list.length; index += 1) {
    const o = list[index]!;
    const r = applyOp(session, o, index);
    if (!r.ok) {
      if (atomic) {
        // (Take back what this run did, newest first -- and only what it did.)
        while (session.history.length > start) session.history.pop()!.restore();
        session.undone.length = 0;
        session.undone.push(...undone);
      }
      return { ok: false, session, errors: [r.error], results, events };
    }
    results.push({ index, op: o.op, did: r.event.did });
    events.push(r.event);
  }
  return { ok: true, session, errors: [], results, events };
}

// ---------------------------------------------------------------- building

/** A session as an export-ready asset spec. */
export function assetOf(s: Session): AssetSpec {
  const m = bodyOf(s);
  const t = s.target;
  const id = (t.id ?? m.name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "voxel-thing";
  if (s.design) return { kind: "character", id, model: m, ...(t.title ? { title: t.title } : {}), ...(t.tags ? { tags: t.tags } : {}), character: s.design };
  const variation: VariationRules = {
    ...(Object.keys(s.variation.scale).length ? { scale: s.variation.scale } : {}),
    ...(Object.keys(s.variation.optional).length ? { optional: s.variation.optional } : {}),
    ...(Object.keys(s.variation.pick).length ? { pick: s.variation.pick } : {}),
    ...(s.variation.size ? { size: s.variation.size } : {}),
  };
  const hasVar = Object.keys(variation).length > 0;
  const smooth: SmoothOptions | undefined = t.smooth ? { capsules: true } : undefined;
  const common = { id, model: m, ...(t.title ? { title: t.title } : {}), ...(t.tags ? { tags: t.tags } : {}), ...(Object.keys(s.colours).length ? { colours: s.colours } : {}), ...(hasVar ? { variation } : {}) };
  if (t.as === "attribute") {
    return { kind: "attribute", ...common, attribute: { slot: t.slot ?? "head", ...(t.bodies ? { targets: t.bodies.map((body) => ({ body })) } : {}), ...(t.fit ? { fit: t.fit } : {}), ...(t.fill ? { fill: t.fill } : {}), ...(t.anchor ? { anchor: t.anchor } : {}), ...(smooth ? { smooth } : {}) } };
  }
  if (t.as === "entity") return { kind: "entity", ...common, entity: { rig: s.rig ?? {} } };
  const front = t.front === undefined || t.front === "detect" ? "detect" : t.front === "none" ? null : t.front;
  const anim = Object.keys(s.animation.clips).length ? { clips: s.animation.clips, ...(Object.keys(s.animation.parents).length ? { parents: s.animation.parents } : {}) } : undefined;
  return { kind: "object", ...common, object: { front, ...(smooth ? { smooth } : {}), ...(anim ? { animation: anim } : {}) } };
}

export interface Built {
  readonly kind: TargetKind | "character";
  readonly object?: ObjectDef<VoxelObjectMeta>;
  readonly attribute?: AttributeDef<VoxelAttributeShape>;
  readonly entity?: EntityDef<VoxelSpec>;
  /** A character design as the engine's entity. */
  readonly character?: EntityDef<CharacterSpec>;
  readonly rig?: VoxelRig;
  /** A character's spec (the design as the engine's entity). */
  readonly spec?: EntitySpec;
  /** What the baker takes (entities and objects). */
  readonly design?: BuilderDesign;
  /** The pack file: one TypeScript file, one thing. */
  readonly code: string;
  readonly stats: { voxels: number; bytes: number; boxes: number; roles: string[]; groups: string[] };
  /** Attached groups, as the attributes they build (each with its own pack file). */
  readonly attributes?: readonly WornGroup[];
}

/** An attached group as the attribute it builds (its socket, sized as the attachment says), and its pack file. */
export interface WornGroup {
  readonly group: string;
  readonly slot: string;
  readonly attribute: AttributeDef<VoxelAttributeShape>;
  readonly code: string;
}

/** The session's attached groups as attributes (targets: the attachment's bodies, else the rig's body, else both). */
export function attachedAttributes(s: Session): WornGroup[] {
  const plan = s.rig?.plan;
  return Object.entries(s.attachments).filter(([g]) => s.editor.model.groups.has(g)).map(([group, a]) => {
    const model = attachmentModel(s, group);
    const id = (a.id ?? group).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";
    const targets = a.bodies ? a.bodies.map((body) => ({ body })) : plan ? [{ body: contractOf({ plan }).range }] : undefined;
    const opts = { slot: a.socket, ...(targets ? { targets } : {}), ...(a.fit ? { fit: a.fit } : {}), ...(a.fill ? { fill: a.fill } : {}), ...(a.anchor ? { anchor: a.anchor } : {}), ...(a.offset ? { offset: a.offset } : {}) };
    const attribute = attributeFromVoxels(model, { id, ...opts });
    return { group, slot: a.socket, attribute, code: exportPackFile({ kind: "attribute", id, model, ...(Object.keys(s.colours).length ? { colours: s.colours } : {}), attribute: opts }) };
  });
}

/** Build what the session says: the engine thing, a bake design, and its pack code -- and, for attached groups, their attributes (worn by the bake design). */
export function buildSession(s: Session, { pack = "keel/builder" }: { pack?: string } = {}): Built {
  const a = assetOf(s);
  const m = a.model;
  const code = exportPackFile(a);
  if (a.kind === "character") {
    const d = a.character!;
    const spec = characterSpec(d);
    const character = characterEntity({ ...d, id: a.id, ...(a.title ? { title: a.title } : {}) });
    return { kind: "character", character, spec, design: characterBakeDesign(d, { pack, registry: s.attributes }), code, stats: { voxels: 0, bytes: 0, boxes: d.parts.length, roles: [...new Set(d.parts.map((p) => p.role))], groups: [] } };
  }
  const st = voxelStats(m);
  const stats = { voxels: m.count, bytes: st.bytes, boxes: greedyBoxes(m).length, roles: [...m.roles], groups: [...m.groups.keys()] };
  const colours = a.colours ?? {};
  const worn = attachedAttributes(s);
  const attributes = worn.length ? { attributes: worn } : {};
  if (a.kind === "attribute") return { kind: "attribute", attribute: attributeFromVoxels(m, { id: a.id, ...a.attribute!, ...(a.variation ? { variation: a.variation } : {}) }), code, stats, ...attributes };
  if (a.kind === "entity") {
    const rig = autoRig(m, a.entity!.rig ?? {});
    const entity = entityFromVoxels(m, { id: a.id, rig: { ...(a.entity!.rig ?? {}), plan: rig.plan }, ...(a.variation ? { variation: a.variation } : {}) });
    if (contractOf({ plan: rig.plan }).ref !== entity.body) throw new Error("the entity's body and its rig disagree");
    // (What it was built wearing, it's baked wearing -- only what its body has a socket for.)
    const wearable = worn.filter((w) => rig.sockets[w.slot]).map((w) => w.attribute);
    return { kind: "entity", entity, rig, design: creatureDesign(rig, { pack, colours, attributes: wearable }), code, stats, ...attributes };
  }
  const o = a.object!;
  const object = objectFromVoxels(m, { key: a.id, front: o.front ?? "detect", ...(o.smooth ? { smooth: o.smooth } : {}), ...(a.tags ? { tags: a.tags } : {}), meta: { ...(o.animation ? { animation: o.animation } : {}), ...(a.variation ? { variation: a.variation } : {}) } });
  return { kind: "object", object, design: objectDesign(m, { pack, colours, ...(o.animation ? { animation: o.animation } : {}), ...(o.smooth ? { smooth: o.smooth } : {}) }), code, stats, ...attributes };
}

/**
 * A model as an op list: its greedy boxes as box ops (biggest first, so a
 * replay "draws" it the way a builder would), then its groups -- for agents
 * to read and edit, and for a live replay.
 */
export function opsOf(model: VoxelModel): AgentOp[] {
  const boxes = greedyBoxes(model, { label: (_x, _y, _z, v) => v }).sort((a, b) => a.min[1] - b.min[1] || b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2]);
  return [
    { op: "new", name: model.name, unit: model.unit },
    ...boxes.map((b): AgentOp => ({ op: "box", from: [...b.min], to: [b.min[0] + b.size[0] - 1, b.min[1] + b.size[1] - 1, b.min[2] + b.size[2] - 1], role: model.roles[b.label - 1]! })),
    ...[...model.groups].flatMap(([name, rs]) => rs.map((r): AgentOp => ({ op: "group", name, from: [...r.min], to: [...r.max] }))),
  ];
}

// ---------------------------------------------------------------- reference

/** The op reference as Markdown (what the README's table is made from). */
export function opReference(): string {
  const rows = Object.entries(OPS).map(([name, s]) => {
    const fields = Object.entries(s.fields).map(([f, fs]) => `\`${f}\`${fs.required ? "" : "?"}`).join(" ");
    return `| \`${name}\` | ${s.doc} | ${fields || "--"} | \`${JSON.stringify(s.example)}\` |`;
  });
  return ["| op | what | fields (? optional) | example |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

/** A JSON schema for one op object (a tool definition's `input_schema` for an op list takes { ops: [these] }). */
export function opSchema(): Record<string, unknown> {
  const typeOf = (t: FieldType): Record<string, unknown> => {
    if (Array.isArray(t)) return { enum: [...t] };
    switch (t) {
      case "int3": return { type: "array", items: { type: "integer" }, minItems: 3, maxItems: 3 };
      case "num3": case "colour": return { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
      case "range": return { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };
      case "int": return { type: "integer" };
      case "num": case "pos": return { type: "number" };
      case "bool": return { type: "boolean" };
      case "strings": return { type: "array", items: { type: "string" } };
      case "role?": return { type: ["string", "null"] };
      case "any": return {};
      case "object": return { type: "object" };
      default: return { type: "string" };
    }
  };
  return {
    oneOf: Object.entries(OPS).map(([name, s]) => ({
      type: "object",
      description: s.doc,
      properties: { op: { const: name }, ...Object.fromEntries(Object.entries(s.fields).map(([f, fs]) => [f, { ...typeOf(fs.type), description: fs.doc }])) },
      required: ["op", ...Object.entries(s.fields).filter(([, fs]) => fs.required).map(([f]) => f)],
      additionalProperties: false,
    })),
  };
}
