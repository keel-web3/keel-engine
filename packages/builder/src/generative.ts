// Editor-only, bounded JSON programs. This entry is deliberately outside the
// catalogue-pinned builder module. A program selects native builder operations;
// it never evaluates source code or loads a pack, file, URL, or ambient registry.
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import { CHOICES, LOOK, SPECIES, contractOf } from "@keel-engine/entity";
import type { Kind } from "@keel-engine/entity";
import { proportionNames } from "./character.ts";
import { OPS, buildSession, createSession, runOps, validateOps } from "./ops.ts";
import type { AgentOp, Built, Session } from "./ops.ts";

export const GENERATIVE_PROGRAM_FORMAT = "keel-generative-program@1" as const;
export const GENERATIVE_RECIPE_FORMAT = "keel-generative-recipe@1" as const;
/** Increment when this entry's interpretation, defaults, or native output changes. */
export const GENERATIVE_RUNTIME_VERSION = "keel-generative-runtime@1.0.0" as const;
export const GENERATIVE_LIMITS = Object.freeze({
  jsonBytes: 131072, nodes: 16384, depth: 12, stringLength: 256, ops: 128,
  pickOptions: 32, coordinate: 64, voxelVisits: 131072, denseVolume: 262144,
  groups: 16, parts: 64, roles: 32,
});
export const GENERATIVE_OPS = Object.freeze([
  "new", "set", "box", "sphere", "line", "group", "origin", "unit", "look",
  "character", "pin", "proportion", "part", "target",
] as const);

export interface GenerativeProgram {
  readonly format: typeof GENERATIVE_PROGRAM_FORMAT;
  readonly id: string;
  readonly title: string;
  readonly ops: readonly AgentOp[];
}
export interface GenerativeRecipe {
  readonly format: typeof GENERATIVE_RECIPE_FORMAT;
  readonly runtime: typeof GENERATIVE_RUNTIME_VERSION;
  readonly program: GenerativeProgram;
  /** The user-facing seed, retained exactly (a numeric input becomes a string). */
  readonly seed: string;
}
export interface GenerativeError { readonly path: string; readonly message: string }
export interface GenerativeBudget {
  readonly ops: number;
  readonly voxelVisits: number;
  readonly denseVolume: number;
  readonly parts: number;
}
export interface ValidGenerativeProgram {
  readonly ok: true;
  readonly runtime: typeof GENERATIVE_RUNTIME_VERSION;
  readonly program: GenerativeProgram;
  readonly budget: GenerativeBudget;
}
export interface InvalidGenerativeProgram { readonly ok: false; readonly errors: readonly GenerativeError[] }
export type GenerativeValidation = ValidGenerativeProgram | InvalidGenerativeProgram;
export interface ResolvedGenerativeProgram extends ValidGenerativeProgram {
  readonly seed: string;
  readonly ops: readonly AgentOp[];
}
export type GenerativeResolution = ResolvedGenerativeProgram | InvalidGenerativeProgram;
export interface GenerativeRun extends ResolvedGenerativeProgram { readonly session: Session }
export interface GenerativeBuild extends GenerativeRun { readonly built: Built }

type RecordValue = Record<string, unknown>;
type Scalar = string | number | boolean | null;
type Bounds = readonly [number, number];
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const ALLOWED = new Set<string>(GENERATIVE_OPS);
const ID = /^[a-z0-9][a-z0-9.-]{0,63}$/i;
const ROLE = /^[a-z][a-z0-9-]{0,31}$/;
// Native pack export includes titles in a line comment as well as a string.
const singleLineTitle = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 120 && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(v);
const CHARACTER_ROLES = ["fur", "furAlt", "cloth", "clothAlt", "accent", "dark", "blush", "hair", "primary", "secondary", "trim", "skin", "glow"];
const isRecord = (v: unknown): v is RecordValue => v !== null && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown): v is Scalar => v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
class Invalid extends Error {
  readonly path: string;
  constructor(path: string, message: string) { super(message); this.path = path; }
}
function requireThat(ok: unknown, path: string, message: string): asserts ok {
  if (!ok) throw new Invalid(path, message);
}
const invalid = (e: unknown): InvalidGenerativeProgram => ({ ok: false, errors: [{ path: e instanceof Invalid ? e.path : "$", message: e instanceof Error ? e.message : "Invalid program" }] });

/** Copy only JSON data, without invoking getters/toJSON, before inspecting ops. */
function jsonData(input: unknown, recipeEnvelope = false): unknown {
  const byteLimit = GENERATIVE_LIMITS.jsonBytes + (recipeEnvelope ? 1024 : 0);
  if (typeof input === "string") {
    requireThat(input.length <= byteLimit, "$", "JSON exceeds the byte budget");
    requireThat(new TextEncoder().encode(input).length <= byteLimit, "$", "JSON exceeds the byte budget");
    try { input = JSON.parse(input) as unknown; } catch { throw new Invalid("$", "Expected a JSON object (no Markdown or executable code)"); }
  }
  let nodes = 0;
  const seen = new Set<object>();
  const copy = (v: unknown, path: string, depth: number): unknown => {
    requireThat(++nodes <= GENERATIVE_LIMITS.nodes + (recipeEnvelope ? 8 : 0), path, "JSON node budget exceeded");
    requireThat(depth <= GENERATIVE_LIMITS.depth + (recipeEnvelope ? 1 : 0), path, "JSON nesting budget exceeded");
    if (typeof v === "string") { requireThat(v.length <= GENERATIVE_LIMITS.stringLength, path, "String exceeds 256 characters"); return v; }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") { requireThat(Number.isFinite(v), path, "Numbers must be finite"); return Object.is(v, -0) ? 0 : v; }
    requireThat(v !== null && typeof v === "object", path, "Only plain JSON data is allowed");
    requireThat(!seen.has(v), path, "Cycles or shared object references are not JSON");
    seen.add(v);
    const proto: unknown = Object.getPrototypeOf(v);
    requireThat(Array.isArray(v) ? proto === Array.prototype : proto === Object.prototype || proto === null, path, "Only plain JSON objects and arrays are allowed");
    if (Array.isArray(v)) requireThat(v.length <= GENERATIVE_LIMITS.ops, path, "Array exceeds 128 items");
    const keys = Reflect.ownKeys(v);
    requireThat(keys.every((k) => typeof k === "string"), path, "Symbol keys are not JSON");
    requireThat(keys.length <= (Array.isArray(v) ? GENERATIVE_LIMITS.ops + 1 : 32), path, "Object exceeds its field budget");
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Array.isArray(v)) {
      requireThat(keys.length === v.length + 1, path, "Arrays must be dense with no extra properties");
      const out: unknown[] = [];
      for (let i = 0; i < v.length; i += 1) {
        const d = descriptors[String(i)];
        requireThat(d && Object.hasOwn(d, "value") && d.enumerable, `${path}[${i}]`, "Only plain JSON data properties are allowed");
        out.push(copy(d.value, `${path}[${i}]`, depth + 1));
      }
      seen.delete(v); return out;
    }
    const out: RecordValue = {};
    for (const k of keys as string[]) {
      requireThat(k.length <= 64 && !FORBIDDEN.has(k), path, `Forbidden object key: ${k.slice(0, 64)}`);
      const d = descriptors[k]!;
      requireThat(Object.hasOwn(d, "value") && d.enumerable, `${path}.${k}`, "Only plain JSON data properties are allowed");
      out[k] = copy(d.value, `${path}.${k}`, depth + 1);
    }
    seen.delete(v); return out;
  };
  const out = copy(input, "$", 0);
  requireThat(new TextEncoder().encode(JSON.stringify(out)).length <= byteLimit, "$", "JSON exceeds the byte budget");
  return out;
}

function fields(v: RecordValue, names: readonly string[], path: string): void {
  for (const k of Object.keys(v)) requireThat(names.includes(k), `${path}.${k}`, `Unknown field ${k}`);
}
function literal(v: unknown, path: string): void { requireThat(!isRecord(v), path, "This field must be literal, not a seeded expression"); }
function values(v: unknown, path: string, seedAllowed = false): readonly Scalar[] {
  if (!isRecord(v)) { requireThat(scalar(v), path, "Expected a scalar or a seeded scalar expression"); return [v]; }
  if (Object.hasOwn(v, "$seed")) {
    fields(v, ["$seed"], path);
    requireThat(seedAllowed && v["$seed"] === true, path, "$seed:true is allowed only in character.seed");
    return ["1"];
  }
  const range = Object.hasOwn(v, "$range");
  fields(v, range ? ["$range", "integer", "key"] : ["$pick", "key"], path);
  if (v["key"] !== undefined) requireThat(typeof v["key"] === "string" && ID.test(v["key"]) && !FORBIDDEN.has(v["key"]), `${path}.key`, "A key must be a safe 1..64 character identifier");
  if (range) {
    const r = v["$range"];
    requireThat(Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === "number" && Number.isFinite(n)), path, "$range must be [finite minimum, finite maximum]");
    requireThat(r[0] <= r[1] && Math.abs(r[0]) <= 4096 && Math.abs(r[1]) <= 4096, path, "Range must be ordered and within -4096..4096");
    requireThat(v["integer"] === undefined || v["integer"] === true, path, "integer, when present, must be true");
    requireThat(v["integer"] !== true || r.every(Number.isInteger), path, "Integer ranges need whole-number endpoints");
    return r as number[];
  }
  const p = v["$pick"];
  requireThat(Array.isArray(p) && p.length > 0 && p.length <= GENERATIVE_LIMITS.pickOptions && p.every(scalar), path, "$pick must contain 1..32 literal finite scalars (no nested expressions)");
  return p as Scalar[];
}
function every(v: unknown, path: string, predicate: (v: Scalar) => boolean, message: string, seedAllowed = false): void {
  requireThat(values(v, path, seedAllowed).every(predicate), path, message);
}
function number(v: unknown, path: string, lo: number, hi: number, integer = false): Bounds {
  const all = values(v, path);
  requireThat(all.every((n) => typeof n === "number" && n >= lo && n <= hi && (!integer || Number.isInteger(n))), path, `Every value must be ${integer ? "an integer " : ""}in ${lo}..${hi}`);
  requireThat(!integer || !isRecord(v) || !Object.hasOwn(v, "$range") || v["integer"] === true, path, "Integer fields require integer:true on $range");
  return [Math.min(...all as number[]), Math.max(...all as number[])];
}
function vector(v: unknown, path: string, lo: number, hi: number, integer = false): Bounds[] {
  requireThat(Array.isArray(v) && v.length === 3, path, "Expected three components; place seeded expressions inside the vector");
  return v.map((n, i) => number(n, `${path}[${i}]`, lo, hi, integer));
}
function colour(v: unknown, path: string): void {
  requireThat(Array.isArray(v) && v.length === 3, path, "Expected OKLCH [lightness, chroma, hue]");
  number(v[0], `${path}[0]`, 0, 1); number(v[1], `${path}[1]`, 0, 0.37); number(v[2], `${path}[2]`, 0, 360);
}
function genericField(type: (typeof OPS)[string]["fields"][string]["type"], v: unknown, path: string, seedAllowed = false): void {
  if (Array.isArray(type)) { every(v, path, (x) => typeof x === "string" && type.includes(x), `Expected one of ${type.join(", ")}`); return; }
  switch (type) {
    case "int3": vector(v, path, -64, 64, true); break;
    case "num3": vector(v, path, -64, 64); break;
    case "int": number(v, path, -64, 64, true); break;
    case "num": number(v, path, -4096, 4096); break;
    case "pos": number(v, path, 0.0001, 64); break;
    case "id": literal(v, path); every(v, path, (x) => typeof x === "string" && ID.test(x) && !FORBIDDEN.has(x), "Expected a safe identifier (letters, digits, dots and dashes)"); break;
    case "string": every(v, path, (x) => typeof x === "string" && x.length > 0 && !FORBIDDEN.has(x), "Expected a nonempty safe string", seedAllowed); break;
    case "role": case "role?": every(v, path, (x) => (type === "role?" && x === null) || (typeof x === "string" && ROLE.test(x) && !FORBIDDEN.has(x)), "Expected a safe lowercase role"); break;
    case "bool": every(v, path, (x) => typeof x === "boolean", "Expected true or false"); break;
    case "strings": requireThat(Array.isArray(v) && v.length <= 16, path, "Expected at most 16 strings"); for (const x of v) { literal(x, path); every(x, path, (y) => typeof y === "string" && y.length > 0 && !FORBIDDEN.has(y), "Expected nonempty safe strings"); } break;
    case "colour": colour(v, path); break;
    case "any": break; // pin.value has a choice-specific validator below.
    default: throw new Invalid(path, "Field type is unavailable in generative program v1");
  }
}

function pinValue(choice: string, v: unknown, path: string, species: readonly string[]): void {
  const spec = CHOICES.find((c) => c.name === choice && c.name !== "kind" && c.name !== "species");
  requireThat(spec, path, `Unknown character choice ${choice}`);
  if (spec.range) { number(v, path, spec.range[0], spec.range[1]); return; }
  if (choice === "furColour" || choice === "hairColour") { colour(v, path); return; }
  if (choice === "outfitColour") {
    requireThat(isRecord(v), path, "outfitColour requires cloth, clothAlt and accent OKLCH arrays");
    fields(v, ["cloth", "clothAlt", "accent"], path);
    for (const key of ["cloth", "clothAlt", "accent"]) colour(v[key], `${path}.${key}`);
    return;
  }
  if (choice === "ears" || choice === "coat") {
    const options = species.map((s) => choice === "ears" ? LOOK[s as keyof typeof LOOK].ears : LOOK[s as keyof typeof LOOK].coats.map(([c]) => c));
    every(v, path, (x) => options.every((o) => (o as readonly unknown[]).includes(x)), `${choice} must be valid for every possible species`); return;
  }
  requireThat(spec.options, path, "Choice is unavailable in this format");
  every(v, path, (x) => (spec.options as readonly unknown[]).includes(x), `Invalid value for ${choice}`);
}

/** Validate the entire domains and worst-case work, not a sampled seed. No builder ops run here. */
export function validateGenerativeProgram(input: unknown): GenerativeValidation {
  try {
    const p = jsonData(input);
    requireThat(isRecord(p), "$", "Expected a generative program object");
    fields(p, ["format", "id", "title", "ops"], "$");
    requireThat(p["format"] === GENERATIVE_PROGRAM_FORMAT, "$.format", `Expected ${GENERATIVE_PROGRAM_FORMAT}`);
    genericField("id", p["id"], "$.id");
    requireThat(singleLineTitle(p["title"]), "$.title", "Expected a nonempty, single-line title up to 120 characters, without control characters");
    const ops = p["ops"];
    requireThat(Array.isArray(ops) && ops.length > 0 && ops.length <= GENERATIVE_LIMITS.ops, "$.ops", "Expected 1..128 operations");
    const opCount = ops.length + (isRecord(ops.at(-1)) && (ops.at(-1) as RecordValue)["op"] === "target" ? 0 : 1);
    requireThat(opCount <= GENERATIVE_LIMITS.ops, "$.ops", "At most 128 operations including the implicit final target");
    requireThat(isRecord(ops[0]) && (ops[0]["op"] === "new" || ops[0]["op"] === "character"), "$.ops[0]", "Start with new (primitive object) or character (capsule entity)");
    const character = ops[0]["op"] === "character";
    let kind: Kind = "humanoid", species: string[] = [];
    let visits = 0, parts = 0, groups = 0;
    const roles = new Set<string>();
    const lower = [Infinity, Infinity, Infinity], upper = [-Infinity, -Infinity, -Infinity];
    const include = (b: readonly Bounds[], path: string): void => {
      for (let i = 0; i < 3; i += 1) {
        requireThat(b[i]![0] >= -64 && b[i]![1] <= 64, path, "Every generated voxel must stay within -64..64");
        lower[i] = Math.min(lower[i]!, b[i]![0]); upper[i] = Math.max(upper[i]!, b[i]![1]);
      }
    };
    const volume = (b: readonly Bounds[]): number => b.reduce((n, [lo, hi]) => n * (hi - lo + 1), 1);
    for (let i = 0; i < ops.length; i += 1) {
      const o = ops[i], path = `$.ops[${i}]`;
      requireThat(isRecord(o) && typeof o["op"] === "string" && ALLOWED.has(o["op"]), path, `Unsupported op; allowed: ${GENERATIVE_OPS.join(", ")}`);
      const op = o["op"], spec = OPS[op]!;
      fields(o, ["op", ...Object.keys(spec.fields)], path);
      for (const [name, f] of Object.entries(spec.fields)) {
        requireThat(!f.required || Object.hasOwn(o, name), `${path}.${name}`, "Required field is missing");
        if (Object.hasOwn(o, name)) genericField(f.type, o[name], `${path}.${name}`, op === "character" && name === "seed");
      }
      requireThat(i === 0 || (op !== "new" && op !== "character"), path, "A program starts exactly one fresh model");
      if (op === "target") {
        requireThat(i === ops.length - 1, path, "target, when present, must be last");
        fields(o, ["op", "as", "id", "title", "tags", "front", "smooth"], path);
        requireThat(o["as"] === (character ? "entity" : "object"), `${path}.as`, character ? "Characters target entity" : "Primitive programs target object in v1");
        if (o["title"] !== undefined) every(o["title"], `${path}.title`, singleLineTitle, "Expected a nonempty, single-line title up to 120 characters, without control characters");
      } else if (op !== "new" && op !== "character") {
        requireThat(character ? ["pin", "proportion", "part"].includes(op) : !["pin", "proportion", "part"].includes(op), path, `Op ${op} is incompatible with this model kind`);
      }
      if (o["role"] !== undefined) for (const r of values(o["role"], `${path}.role`)) if (typeof r === "string") roles.add(r);
      switch (op) {
        case "new": if (o["unit"] !== undefined) number(o["unit"], `${path}.unit`, 0.001, 0.25); break;
        case "unit": number(o["metres"], `${path}.metres`, 0.001, 0.25); break;
        case "set": { const b = vector(o["at"], `${path}.at`, -64, 64, true); visits += 1; include(b, path); break; }
        case "box": case "group": case "line": {
          const a = vector(o["from"], `${path}.from`, -64, 64, true), b = vector(o["to"], `${path}.to`, -64, 64, true);
          const bounds = a.map(([lo, hi], j): Bounds => [Math.min(lo, b[j]![0]), Math.max(hi, b[j]![1])]);
          if (op === "line") {
            const r = o["radius"] === undefined ? 0 : number(o["radius"], `${path}.radius`, 0, 8)[1];
            const ri = Math.ceil(r), side = ri * 2 + 1;
            visits += (Math.max(1, ...bounds.map(([lo, hi]) => hi - lo)) + 1) * side * side * side;
            include(bounds.map(([lo, hi]): Bounds => [lo - ri, hi + ri]), path);
          } else if (op === "group") { groups += 1; visits += volume(bounds) * groups; }
          else { visits += volume(bounds); include(bounds, path); }
          break;
        }
        case "sphere": {
          const c = vector(o["center"], `${path}.center`, -64, 64), r = number(o["radius"], `${path}.radius`, 0.1, 32)[1];
          const s = o["scale"] === undefined ? [[1, 1], [1, 1], [1, 1]] : vector(o["scale"], `${path}.scale`, 0.1, 4);
          const bounds = c.map(([lo, hi], j): Bounds => [Math.floor(lo - r * s[j]![1]!), Math.ceil(hi + r * s[j]![1]!)]);
          visits += volume(bounds); include(bounds, path); break;
        }
        case "character": {
          literal(o["kind"], `${path}.kind`); kind = o["kind"] as Kind;
          const options = SPECIES[kind].map(([s]) => s);
          if (o["species"] !== undefined) every(o["species"], `${path}.species`, (s) => (options as readonly unknown[]).includes(s), `Species must be one of ${options.join(", ")}`);
          species = o["species"] === undefined ? options : values(o["species"], `${path}.species`) as string[];
          if (o["size"] !== undefined) number(o["size"], `${path}.size`, 0.05, 4);
          break;
        }
        case "pin": {
          literal(o["choice"], `${path}.choice`);
          pinValue(o["choice"] as string, o["value"], `${path}.value`, species); break;
        }
        case "proportion": {
          literal(o["name"], `${path}.name`);
          requireThat(proportionNames(kind).includes(o["name"] as string), `${path}.name`, `Unknown proportion for ${kind}`);
          requireThat(Object.hasOwn(o, "value") !== Object.hasOwn(o, "scale"), path, "Supply exactly one of value or scale");
          if (o["value"] !== undefined) number(o["value"], `${path}.value`, 0.001, 4);
          if (o["scale"] !== undefined) number(o["scale"], `${path}.scale`, 0.25, 2);
          break;
        }
        case "part": {
          parts += 1; literal(o["shape"], `${path}.shape`); literal(o["on"], `${path}.on`);
          const body = contractOf({ plan: kind === "animal" ? "quadruped" : "humanoid" });
          const sites = [...body.bones, ...body.sockets.map((s) => s.name)];
          requireThat(sites.includes(o["on"] as string), `${path}.on`, `Expected a native bone or socket: ${sites.join(", ")}`);
          requireThat(o["on"] !== "tail" || species.every((s) => LOOK[s as keyof typeof LOOK].tail[0] !== "none"), `${path}.on`, "Every possible species needs a tail for the tail socket");
          every(o["role"], `${path}.role`, (r) => (CHARACTER_ROLES as readonly unknown[]).includes(r), "Invalid character part role");
          if (o["shape"] === "capsule") {
            fields(o, ["op", "id", "shape", "on", "role", "units", "a", "b", "r"], path);
            vector(o["a"], `${path}.a`, -4, 4); vector(o["b"], `${path}.b`, -4, 4); number(o["r"], `${path}.r`, 0.001, 2);
          } else {
            fields(o, ["op", "id", "shape", "on", "role", "units", "c", "h", "yaw", ...(o["shape"] === "wedge" ? ["lo"] : [])], path);
            vector(o["c"], `${path}.c`, -4, 4); vector(o["h"], `${path}.h`, 0.001, 2);
            if (o["yaw"] !== undefined) number(o["yaw"], `${path}.yaw`, -6.283186, 6.283186);
            if (o["lo"] !== undefined) number(o["lo"], `${path}.lo`, 0, 0.98);
          }
          break;
        }
      }
      requireThat(visits <= GENERATIVE_LIMITS.voxelVisits, path, "Worst-case voxel work exceeds 131072 visits");
      requireThat(parts <= GENERATIVE_LIMITS.parts, path, "At most 64 character parts are allowed");
      requireThat(groups <= GENERATIVE_LIMITS.groups, path, "At most 16 group operations are allowed");
      requireThat(roles.size <= GENERATIVE_LIMITS.roles, path, "At most 32 roles are allowed");
    }
    const denseVolume = lower[0] === Infinity ? 0 : volume(lower.map((lo, i): Bounds => [lo, upper[i]!]));
    requireThat(denseVolume <= GENERATIVE_LIMITS.denseVolume, "$.ops", "Worst-case dense bounding volume exceeds 262144 cells (including sparse distant parts)");
    return { ok: true, runtime: GENERATIVE_RUNTIME_VERSION, program: p as unknown as GenerativeProgram, budget: { ops: opCount, voxelVisits: visits, denseVolume, parts } };
  } catch (e) { return invalid(e); }
}

function seedText(seed: unknown): string {
  requireThat(typeof seed === "string" || (typeof seed === "number" && Number.isSafeInteger(seed)), "$.seed", "Seed must be a string or safe integer");
  const text = String(seed);
  requireThat(text.length > 0 && text.length <= 128, "$.seed", "Seed must contain 1..128 characters");
  return text;
}

/** Native per-key streams make named choices stable when unrelated ops are inserted. */
export function resolveGenerativeProgram(input: unknown, seed: unknown): GenerativeResolution {
  const accepted = validateGenerativeProgram(input);
  if (!accepted.ok) return accepted;
  try {
    const text = seedText(seed), root = deriveSeed(text, `${GENERATIVE_PROGRAM_FORMAT}:${accepted.program.id}`);
    const resolve = (v: unknown, path: string): unknown => {
      if (Array.isArray(v)) return v.map((x, i) => resolve(x, `${path}[${i}]`));
      if (!isRecord(v)) return v;
      if (v["$seed"] === true) return root;
      if (Object.hasOwn(v, "$range") || Object.hasOwn(v, "$pick")) {
        const label = typeof v["key"] === "string" ? `key:${v["key"]}` : `path:${path}`;
        const s = stream(createRoll(deriveSeed(root, label)), 0);
        if (Object.hasOwn(v, "$pick")) return s.pick(v["$pick"] as Scalar[]);
        const [lo, hi] = v["$range"] as [number, number];
        return v["integer"] === true ? s.int(lo, hi) : s.between(lo, hi);
      }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, `${path}.${k}`)]));
    };
    const ops = accepted.program.ops.map((o, i) => resolve(o, `ops[${i}]`) as AgentOp);
    if (ops[0]!.op === "character" && ops[0]!["seed"] === undefined) ops[0] = { ...ops[0]!, seed: root };
    const last = ops.at(-1)!;
    if (last.op === "target") ops[ops.length - 1] = { ...last, id: last["id"] ?? accepted.program.id, title: last["title"] ?? accepted.program.title };
    else ops.push({ op: "target", as: ops[0]!.op === "character" ? "entity" : "object", id: accepted.program.id, title: accepted.program.title });
    const check = validateOps(ops);
    if (!check.ok) return { ok: false, errors: check.errors.map((e) => ({ path: `$.ops[${e.index}]${e.field ? `.${e.field}` : ""}`, message: e.message })) };
    return { ...accepted, seed: text, ops };
  } catch (e) { return invalid(e); }
}

/** Always creates an isolated session. The caller's selected source is never mutated. */
export function runGenerativeProgram(input: unknown, seed: unknown): GenerativeRun | InvalidGenerativeProgram {
  const resolved = resolveGenerativeProgram(input, seed);
  if (!resolved.ok) return resolved;
  try {
    const run = runOps(resolved.ops, createSession());
    if (!run.ok) return { ok: false, errors: run.errors.map((e) => ({ path: `$.ops[${e.index}]${e.field ? `.${e.field}` : ""}`, message: e.message })) };
    requireThat(run.session.design !== null || run.session.editor.model.count > 0, "$.ops", "The program produced an empty model");
    return { ...resolved, session: run.session };
  } catch (e) { return invalid(e); }
}

/** Build native solids/design/code; generated pack code is data, never executed. */
export function buildGenerativeProgram(input: unknown, seed: unknown): GenerativeBuild | InvalidGenerativeProgram {
  const run = runGenerativeProgram(input, seed);
  if (!run.ok) return run;
  try { return { ...run, built: buildSession(run.session) }; } catch (e) { return invalid(e); }
}

/** Store the accepted source program and seed, not just its one resolved mesh. */
export function serializeGenerativeRecipe(input: unknown, seed: unknown): string {
  const r = resolveGenerativeProgram(input, seed);
  if (!r.ok) throw new TypeError(r.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
  return JSON.stringify({ format: GENERATIVE_RECIPE_FORMAT, runtime: GENERATIVE_RUNTIME_VERSION, program: r.program, seed: r.seed } satisfies GenerativeRecipe);
}

export function parseGenerativeRecipe(input: unknown): GenerativeResolution {
  try {
    const r = jsonData(input, true);
    requireThat(isRecord(r), "$", "Expected a saved recipe"); fields(r, ["format", "runtime", "program", "seed"], "$");
    requireThat(r["format"] === GENERATIVE_RECIPE_FORMAT, "$.format", `Expected ${GENERATIVE_RECIPE_FORMAT}`);
    requireThat(r["runtime"] === GENERATIVE_RUNTIME_VERSION, "$.runtime", `Recipe requires runtime ${GENERATIVE_RUNTIME_VERSION}; never replay with a silently different runtime`);
    return resolveGenerativeProgram(r["program"], r["seed"]);
  } catch (e) { return invalid(e); }
}

/** The prompt contract comes from the actual native op table plus this entry's limits. */
export function generativeProgramReference(): string {
  return JSON.stringify({
    format: GENERATIVE_PROGRAM_FORMAT,
    runtime: GENERATIVE_RUNTIME_VERSION,
    envelope: { format: GENERATIVE_PROGRAM_FORMAT, id: "safe-lowercase-id", title: "Readable title", ops: ["native operations below"] },
    expressions: {
      range: { $range: [0.8, 1.2], key: "body-height" }, integer: { $range: [2, 8], integer: true, key: "height" },
      pick: { $pick: ["primary", "accent"], key: "material" }, seed: { $seed: true },
    },
    rules: [
      "Return only a JSON program, not code, Markdown, a recipe wrapper or a source mesh. No loops, imports, network, files or eval.",
      "Start with exactly one new (primitive object) or character (capsule entity) op. Never reset later. Optional target must be last, object for primitives or entity for characters.",
      "Numeric range and scalar pick expressions may replace scalar field values or vector components. Pick alternatives must be literal scalars; never whole vectors, ops or nested expressions. Ranges must be ordered; integer fields require integer:true.",
      "Shared keys use the same deterministic random draw; distinct keys vary independently. Without key the field path is used. Same program+seed+runtime version always resolves identically. character.seed may be {$seed:true} or omitted to use the program seed.",
      "IDs, kind, shape, choice, proportion name, part.on, and target.as must be literal. Unknown fields and unsafe identifiers are rejected.",
      "Primitive ops: new,set,box,sphere,line,group,origin,unit,look,target. Character ops: character,pin,proportion,part,target. Explicitly enumerate a bounded set of authored parts; use ranges/picks for genuine silhouette, proportion and palette variation.",
      "All generated voxel coordinates must fit -64..64. Unit 0.001..0.25 m. sphere radius 0.1..32 and scale 0.1..4; line radius 0..8. Worst-case ranges count against work and dense-volume budgets, including sparse distant parts.",
      "Character size 0.05..4 m; proportion value 0.001..4 or scale 0.25..2, exactly one. Part coordinates -4..4; capsule radius/box half-extents 0.001..2; yaw +/-6.283186; wedge lo 0..0.98. Capsule requires a,b,r; box/wedge requires c,h.",
      "Pin numeric catalogue choices only within listed ranges. ears/coat must be valid for every possible species. Colours use OKLCH L 0..1, C 0..0.37, hue 0..360. furColour/hairColour are vectors; outfitColour is {cloth:[...],clothAlt:[...],accent:[...]}. look applies only to primitive objects.",
      "V1 does not expose animation, arbitrary variation ops, auto-rig, attached or registry-worn attributes, imported source meshes or source replacement. Characters retain their native idle/walk/run rig and clips.",
    ],
    limits: GENERATIVE_LIMITS,
    species: Object.fromEntries(Object.entries(SPECIES).map(([k, list]) => [k, list.map(([s]) => s)])),
    choices: CHOICES.filter((c) => c.name !== "kind" && c.name !== "species").map((c) => ({ name: c.name, ...(c.range ? { range: c.range } : {}), ...(c.options ? { options: c.options } : {}) })),
    speciesLooks: Object.fromEntries(Object.entries(LOOK).map(([s, l]) => [s, { ears: l.ears, coat: l.coats.map(([c]) => c) }])),
    proportions: Object.fromEntries((["humanoid", "anthro", "animal"] as const).map((k) => [k, proportionNames(k)])),
    partSites: Object.fromEntries((["humanoid", "quadruped"] as const).map((plan) => { const body = contractOf({ plan }); return [plan, { bones: body.bones, sockets: body.sockets.map((s) => s.name) }]; })),
    operations: Object.fromEntries(GENERATIVE_OPS.map((name) => [name, OPS[name]])),
    example: {
      format: GENERATIVE_PROGRAM_FORMAT, id: "forest-fox", title: "Forest fox",
      ops: [
        { op: "character", kind: "anthro", species: "fox", seed: { $seed: true }, size: { $range: [0.9, 1.2], key: "height" } },
        { op: "proportion", name: "headR", scale: { $range: [1, 1.3], key: "head" } },
        { op: "part", id: "crest", shape: "capsule", on: "head", a: [0, 0.2, 0], b: [0, { $range: [0.5, 0.9], key: "crest" }, 0], r: 0.12, role: "accent" },
        { op: "target", as: "entity", id: "forest-fox" },
      ],
    },
  }, null, 2);
}
