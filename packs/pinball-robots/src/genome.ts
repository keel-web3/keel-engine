import { createRoll, deriveSeed, normalizeSeed, type Weighted } from "@keel-engine/core";

export const ROBOT_GENERATOR_VERSION = "pinball-robots/2026-10-07.3";
export type RobotTone = readonly [number, number, number];
export type RobotForm = "rolled" | "portrait" | "unfolded";
export type RobotMorphology = "biped" | "radial" | "quadruped" | "tripod";
export const ROBOT_HULL_BASES = Object.freeze(["stepped-service-hull", "round-shoulder-hull", "lenticular-core", "vented-lens-core", "low-load-hull", "armored-saddle-hull", "long-rib-core", "split-crown-core"] as const);
export const ROBOT_FACE_BASES = Object.freeze(["offset-slit", "paired-eyes", "concentric-lens", "brow-slit", "split-crest"] as const);
export const ROBOT_GEAR_BASES = Object.freeze(["retracted-tool-dock", "sealed-courier-pocket", "folded-sensor-cradle", "retracted-load-cleat"] as const);
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
export interface RobotFamilyBlueprint {
  readonly id: string; readonly revision: string; readonly title: string; readonly weight: number;
  readonly morphology: RobotMorphology; readonly shellGrammar: "petals" | "iris" | "clamshell" | "ribs";
  readonly limbs: number; readonly panels: number; readonly body: readonly [number, number, number];
  readonly hulls: Weighted<string>; readonly faces: Weighted<string>; readonly gear: Weighted<string>;
}
export const ROBOT_FAMILIES: readonly RobotFamilyBlueprint[] = deepFreeze([
  { id: "rivet-courier", revision: "3", title: "Rivet Courier", weight: 34, morphology: "biped", shellGrammar: "petals", limbs: 2, panels: 4, body: [.40, .40, .28], hulls: [["stepped-service-hull", 6], ["round-shoulder-hull", 4]], faces: [["offset-slit", 7], ["paired-eyes", 3]], gear: [["retracted-tool-dock", 5], ["sealed-courier-pocket", 5]] },
  { id: "iris-scout", revision: "3", title: "Iris Scout", weight: 24, morphology: "radial", shellGrammar: "iris", limbs: 5, panels: 5, body: [.28, .35, .25], hulls: [["lenticular-core", 7], ["vented-lens-core", 3]], faces: [["concentric-lens", 8], ["paired-eyes", 2]], gear: [["folded-sensor-cradle", 7], ["sealed-courier-pocket", 3]] },
  { id: "tortoise-hauler", revision: "3", title: "Tortoise Hauler", weight: 26, morphology: "quadruped", shellGrammar: "clamshell", limbs: 4, panels: 2, body: [.53, .26, .46], hulls: [["low-load-hull", 7], ["armored-saddle-hull", 3]], faces: [["brow-slit", 6], ["paired-eyes", 4]], gear: [["retracted-load-cleat", 8], ["retracted-tool-dock", 2]] },
  { id: "reed-skimmer", revision: "3", title: "Reed Skimmer", weight: 16, morphology: "tripod", shellGrammar: "ribs", limbs: 3, panels: 3, body: [.24, .46, .24], hulls: [["long-rib-core", 7], ["split-crown-core", 3]], faces: [["split-crest", 7], ["offset-slit", 3]], gear: [["folded-sensor-cradle", 6], ["retracted-tool-dock", 4]] },
]);
export const ROBOT_PALETTES = deepFreeze({
  "oxide-cream": [24, 66], "signal-cobalt": [258, 67], "orchid-copper": [325, 43], "seafoam-ceramic": [166, 337],
  "ember-carbon": [35, 190], "citron-indigo": [107, 283], "rose-porcelain": [352, 207], "slate-lime": [224, 122],
} as const);
export const ROBOT_LIVERIES = Object.freeze(["offset-service-band", "split-chevron", "three-rib-inlay", "dorsal-saddle"] as const);
export interface RobotPins { readonly family?: string; readonly hull?: string; readonly face?: string; readonly palette?: string; readonly livery?: string; readonly gear?: string }
export interface RobotGenome {
  readonly schema: "keel-rollable-robot@1"; readonly generatorVersion: typeof ROBOT_GENERATOR_VERSION; readonly seed: string;
  readonly family: { readonly id: string; readonly revision: string; readonly morphology: RobotMorphology; readonly title: string };
  readonly hull: { readonly base: string; readonly size: readonly [number, number, number]; readonly bevel: number; readonly rivetRadius: number };
  readonly face: { readonly base: string; readonly width: number; readonly height: number; readonly offset: number; readonly lensRadius: number };
  readonly shell: { readonly grammar: RobotFamilyBlueprint["shellGrammar"]; readonly panels: number; readonly seam: number; readonly phase: number; readonly facet: number };
  readonly limbs: { readonly count: number; readonly reach: number; readonly jointRadius: number; readonly footWidth: number };
  readonly material: { readonly base: string; readonly tones: Readonly<Record<"primary" | "secondary" | "trim" | "metal" | "dark" | "glow", RobotTone>> };
  readonly livery: { readonly base: string; readonly width: number; readonly offset: number };
  readonly gear: { readonly base: string; readonly width: number; readonly inset: number };
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, part) => part && typeof part === "object" && !Array.isArray(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const token = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9./-]{0,119}$/.test(v);
const finite = (v: number, lo: number, hi: number): boolean => Number.isFinite(v) && v >= lo && v <= hi;
function plainRecipe(value: unknown): void {
  let nodes = 0; const seen = new Set<object>();
  function read(part: unknown, depth: number): void {
    if (++nodes > 1024 || depth > 10) throw new RangeError("Robot recipe budget");
    if (part === null || typeof part === "boolean" || typeof part === "string" && part.length <= 500 || typeof part === "number" && Number.isFinite(part)) return;
    if (!part || typeof part !== "object" || seen.has(part) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(part))) throw new RangeError("Robot recipe must be finite plain JSON");
    seen.add(part);
    const properties = Object.getOwnPropertyDescriptors(part), keys = Reflect.ownKeys(properties);
    if (keys.some(key => typeof key !== "string")) throw new RangeError("Robot recipe symbol");
    if (Array.isArray(part) && (Object.keys(part).length !== part.length || Object.keys(part).some(key => !/^(0|[1-9][0-9]*)$/.test(key)))) throw new RangeError("Robot recipe array");
    for (const [key, descriptor] of Object.entries(properties)) {
      if (Array.isArray(part) && key === "length") continue;
      if (descriptor.get || descriptor.set || !descriptor.enumerable) throw new RangeError("Robot recipe property");
      read(descriptor.value, depth + 1);
    }
    seen.delete(part);
  }
  read(value, 0);
}
// Roll.range is integer arithmetic. Geometry reads an explicit bounded fraction.
const between = (roll: ReturnType<typeof createRoll>, slot: number, lo: number, hi: number): number => lo + roll.at(slot) / 65535 * (hi - lo);
export function defineRobotFamily(value: RobotFamilyBlueprint): RobotFamilyBlueprint {
  plainRecipe(value);
  if (typeof value.id !== "string" || !/^[a-z][a-z0-9-]{0,119}$/.test(value.id)) throw new RangeError("Robot family id must be a canonical entity id");
  if (Object.keys(value).length !== 12 || Object.keys(value).some(key => !["id", "revision", "title", "weight", "morphology", "shellGrammar", "limbs", "panels", "body", "hulls", "faces", "gear"].includes(key))) throw new RangeError("Robot family fields");
  if (!token(value.id) || !token(value.revision) || typeof value.title !== "string" || !value.title.length || value.title.length > 80 || !Number.isSafeInteger(value.weight) || !finite(value.weight, 1, 1000) || !["biped", "radial", "quadruped", "tripod"].includes(value.morphology) || !["petals", "iris", "clamshell", "ribs"].includes(value.shellGrammar) || !Number.isSafeInteger(value.limbs) || !finite(value.limbs, 2, 8) || !Number.isSafeInteger(value.panels) || !finite(value.panels, 2, 8) || !Array.isArray(value.body) || value.body.length !== 3 || !value.body.every(n => finite(n, .15, .65))) throw new RangeError("Robot family envelope");
  if (value.morphology === "biped" && value.limbs !== 2 || value.morphology === "quadruped" && value.limbs !== 4 || value.morphology === "tripod" && value.limbs !== 3) throw new RangeError("Robot family articulation");
  for (const table of [value.hulls, value.faces, value.gear]) if (!Array.isArray(table) || table.length < 1 || table.length > 16 || new Set(table.map(e => e[0])).size !== table.length || table.some(e => !Array.isArray(e) || e.length !== 2 || !token(e[0]) || !Number.isSafeInteger(e[1]) || !finite(e[1], 1, 1000))) throw new RangeError("Robot named-base table");
  for (const [table, registry] of [[value.hulls, ROBOT_HULL_BASES], [value.faces, ROBOT_FACE_BASES], [value.gear, ROBOT_GEAR_BASES]] as const) if (table.some(([base]) => !(registry as readonly string[]).includes(base))) throw new RangeError("Robot named-base has no registered geometry");
  return deepFreeze(JSON.parse(JSON.stringify(value)) as RobotFamilyBlueprint);
}
export function createRobotGenome(seed: string, pins: RobotPins = {}, families: readonly RobotFamilyBlueprint[] = ROBOT_FAMILIES): RobotGenome {
  if (Object.entries(pins).some(([site, value]) => !["family", "hull", "face", "palette", "livery", "gear"].includes(site) || typeof value !== "string")) throw new RangeError("Robot pin grammar");
  const s = normalizeSeed(seed), definitions = families.map(defineRobotFamily);
  if (!definitions.length || definitions.length > 32 || new Set(definitions.map(f => f.id)).size !== definitions.length) throw new RangeError("Robot family registry");
  const f = pins.family ? definitions.find(family => family.id === pins.family) : createRoll(deriveSeed(s, "robot:family")).weighted(0, definitions.map(f => [f, f.weight] as const));
  if (!f) throw new RangeError("Unknown robot family pin");
  const named = (site: string, table: Weighted<string>, pin?: string): { base: string; roll: ReturnType<typeof createRoll> } => {
    if (pin !== undefined && !table.some(([name]) => name === pin)) throw new RangeError(`Unknown robot ${site} pin`);
    const base = pin ?? createRoll(deriveSeed(s, `robot:${f.id}:${site}:base`)).weighted(0, table);
    return { base, roll: createRoll(deriveSeed(s, `robot:${f.id}:${site}:${base}:variation`)) };
  };
  const hull = named("hull", f.hulls, pins.hull), face = named("face", f.faces, pins.face), gear = named("gear", f.gear, pins.gear), palette = named("material", Object.keys(ROBOT_PALETTES).map(p => [p, 1] as const), pins.palette), livery = named("livery", ROBOT_LIVERIES.map(l => [l, 1] as const), pins.livery), shell = createRoll(deriveSeed(s, `robot:${f.id}:shell`)), limbs = createRoll(deriveSeed(s, `robot:${f.id}:limbs`));
  const hues = ROBOT_PALETTES[palette.base as keyof typeof ROBOT_PALETTES], tint = palette.roll.range(0, -6, 6);
  const tone = (h: number, c: number, l: number): RobotTone => [(h + tint + 360) % 360, c, l];
  return deepFreeze({ schema: "keel-rollable-robot@1", generatorVersion: ROBOT_GENERATOR_VERSION, seed: s, family: { id: f.id, revision: f.revision, morphology: f.morphology, title: f.title },
    hull: { base: hull.base, size: f.body.map((n, i) => n * between(hull.roll, i, .91, 1.09)) as unknown as [number, number, number], bevel: between(hull.roll, 4, .06, .16), rivetRadius: between(hull.roll, 5, .035, .055) },
    face: { base: face.base, width: between(face.roll, 0, .23, .38), height: between(face.roll, 1, .045, .10), offset: between(face.roll, 2, -.085, .085), lensRadius: between(face.roll, 3, .11, .18) },
    shell: { grammar: f.shellGrammar, panels: f.panels, seam: between(shell, 0, .035, .06), phase: between(shell, 1, -.12, .12), facet: between(shell, 2, .94, .99) },
    limbs: { count: f.limbs, reach: between(limbs, 0, .58, .83) * (f.morphology === "quadruped" ? .62 : f.morphology === "tripod" ? 1.14 : 1), jointRadius: between(limbs, 1, .075, .12), footWidth: between(limbs, 2, .11, .18) },
    material: { base: palette.base, tones: { primary: tone(hues[0], .12, .57), secondary: tone(hues[0] + 12, .075, .36), trim: tone(hues[1], .13, .76), metal: tone(228, .025, .62), dark: tone(hues[0], .035, .20), glow: tone(hues[1], .17, .86) } },
    livery: { base: livery.base, width: between(livery.roll, 0, .12, .22), offset: between(livery.roll, 1, -.18, .18) }, gear: { base: gear.base, width: between(gear.roll, 0, .18, .30), inset: between(gear.roll, 1, .025, .065) },
  });
}
export function validateRobotGenome(value: RobotGenome, families: readonly RobotFamilyBlueprint[] = ROBOT_FAMILIES): RobotGenome {
  plainRecipe(value);
  if (!value || value.schema !== "keel-rollable-robot@1" || value.generatorVersion !== ROBOT_GENERATOR_VERSION || canonical(value).length > 8192) throw new RangeError("Robot genome schema/budget");
  const expected = createRobotGenome(value.seed, { family: value.family?.id, hull: value.hull?.base, face: value.face?.base, palette: value.material?.base, livery: value.livery?.base, gear: value.gear?.base }, families);
  if (canonical(expected) !== canonical(value)) throw new RangeError("Robot resolved genome differs from its versioned seeded identity");
  return expected;
}
export function robotIdentityKey(genome: RobotGenome): string { return deriveSeed(genome.seed, canonical(genome)); }
export function robotAttributes(genome: RobotGenome): readonly { readonly trait_type: string; readonly value: string | number }[] {
  return deepFreeze([{ trait_type: "Family", value: genome.family.title }, { trait_type: "Hull", value: genome.hull.base }, { trait_type: "Face", value: genome.face.base }, { trait_type: "Shell", value: genome.shell.grammar }, { trait_type: "Shell Panels", value: genome.shell.panels }, { trait_type: "Material", value: genome.material.base }, { trait_type: "Livery", value: genome.livery.base }, { trait_type: "Retracted Gear", value: genome.gear.base }]);
}
