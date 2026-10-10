import { createRoll, deriveSeed, normalizeSeed } from "@keel-engine/core";
import type { ArenaBiomeBlend, ArenaSceneGenome, ArenaSceneMusicBlueprint, ArenaSceneStructure, ArenaSceneEnvironment } from "@keel-engine/pinball-arena";
import type { StyledObjectDef } from "@keel-engine/object";
import { worldArtAsset } from "./assets.ts";
import type { PinballFrameTheme } from "./framing.ts";
import { pinballThemeTones } from "./looks.ts";
import { PINBALL_SCENE_CONSTRUCTIONS } from "./scene-construction.ts";
import { PINBALL_SCENE_SUBSTRATES } from "./scene-substrate.ts";
import { PINBALL_SCENE_PRINTS } from "./scene-print.ts";
import { pinballPrintContours } from "./print-contours.ts";

export type PinballSceneTone = readonly [hue: number, chroma: number, light: number];
export interface PinballSceneProp {
  readonly assetId: string; readonly semantic: string; readonly band: "mechanical-frame" | "plant-fringe";
  readonly weight: number; readonly scale: readonly [number, number];
  readonly socket?: "boundary" | "bank-flank";
}
export interface PinballScenePrint { readonly a: readonly [number, number]; readonly b: readonly [number, number]; readonly width: number; readonly role: "trim" | "core" | "dark" | "steel" | "bark" }
export interface PinballSceneBlueprint {
  readonly id: string; readonly revision: string; readonly cabinetFamily: string;
  readonly biome: ArenaBiomeBlend; readonly props: readonly PinballSceneProp[];
  readonly material: { readonly tones: Readonly<Record<string, PinballSceneTone>>; readonly hueVariance: number; readonly lightVariance: number };
  readonly print: { readonly spacing: number; readonly primitives: readonly PinballScenePrint[]; readonly layout?: "grid" | "field"; readonly semantic?: string };
  readonly lighting: { readonly semantic: string; readonly fixtureAssetIds: readonly string[]; readonly tintRoles: readonly [string, string]; readonly gain: number };
  readonly motion: { readonly windGain: number; readonly windRate: number; readonly blinkPeriodMs: number; readonly blinkDepth: number };
  readonly growth: { readonly kind: "none" | "edge-vines"; readonly density: number };
  readonly ambient: { readonly semantic: string; readonly tempo: number; readonly scale: string; readonly voices: readonly string[] };
  readonly music?: ArenaSceneMusicBlueprint;
  readonly structure?: ArenaSceneStructure;
  readonly environment?: ArenaSceneEnvironment;
}
export interface PinballSceneGenome extends ArenaSceneGenome {
  readonly schema: "keel-pinball-scene@1"; readonly blueprintId: string; readonly blueprintRevision: string;
  readonly cabinetFamily: string; readonly cabinetSeed: string; readonly stage: number; readonly seed: string;
  readonly biome: ArenaBiomeBlend; readonly props: readonly PinballSceneProp[];
  readonly material: { readonly tones: Readonly<Record<string, PinballSceneTone>> };
  readonly print: PinballSceneBlueprint["print"]; readonly lighting: PinballSceneBlueprint["lighting"];
  readonly motion: PinballSceneBlueprint["motion"]; readonly growth: PinballSceneBlueprint["growth"]; readonly ambient: PinballSceneBlueprint["ambient"];
}

const freeze = <T>(value: T): T => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const finite = (n: number, a: number, b: number): boolean => Number.isFinite(n) && n >= a && n <= b;
/** New themed content packs supply their own semantic assets and blueprint.
 * No fixed theme-name switch is needed to admit a new vocabulary. */
export function definePinballSceneBlueprint(blueprint: PinballSceneBlueprint, assets: readonly StyledObjectDef[] = []): PinballSceneBlueprint {
  const resolve = (id: string): StyledObjectDef => assets.find(a => a.id === id) ?? worldArtAsset(id);
  const token = (value: string): boolean => typeof value === "string" && value.length >= 1 && value.length <= 120;
  if (!token(blueprint.id) || !Array.isArray(blueprint.props) || !Array.isArray(blueprint.print?.primitives)) throw new RangeError("Pinball scene JSON grammar");
  if (!/^[a-z0-9][a-z0-9./-]{0,119}$/.test(blueprint.id) || !blueprint.revision || !blueprint.cabinetFamily || blueprint.props.length < 1 || blueprint.props.length > 24 || !finite(blueprint.material.hueVariance, 0, 24) || !finite(blueprint.material.lightVariance, 0, .10) || !finite(blueprint.print.spacing, 80, 800) || blueprint.print.primitives.length > 64 || !finite(blueprint.lighting.gain, 0, 2) || !finite(blueprint.motion.windGain, 0, 1) || !finite(blueprint.motion.windRate, .1, 3) || !finite(blueprint.motion.blinkPeriodMs, 800, 20000) || !finite(blueprint.motion.blinkDepth, 0, .9) || !finite(blueprint.growth.density, 0, 1) || !["none", "edge-vines"].includes(blueprint.growth.kind) || !finite(blueprint.ambient.tempo, 30, 200)) throw new RangeError("Pinball scene blueprint budget");
  if (!token(blueprint.revision) || !token(blueprint.cabinetFamily) || !token(blueprint.lighting.semantic) || !token(blueprint.ambient.semantic) || !token(blueprint.ambient.scale) || !Array.isArray(blueprint.ambient.voices) || blueprint.ambient.voices.length < 1 || blueprint.ambient.voices.length > 8 || blueprint.ambient.voices.some(v => !token(v))) throw new RangeError("Pinball scene semantic vocabulary");
  if (blueprint.print.layout !== undefined && !["grid", "field"].includes(blueprint.print.layout) || blueprint.print.semantic !== undefined && !token(blueprint.print.semantic)) throw new RangeError("Pinball scene print composition");
  const shares = ["forge", "neon", "garden", "glacier", "ruins"].map(id => blueprint.biome[id as keyof ArenaBiomeBlend]);
  if (!shares.every(n => finite(n, 0, 1)) || Math.abs(shares.reduce((sum, n) => sum + n, 0) - 1) > .0001) throw new RangeError("Pinball scene biome shares");
  for (const prop of blueprint.props) { if (!token(prop.assetId) || !token(prop.semantic) || !["mechanical-frame", "plant-fringe"].includes(prop.band) || prop.socket !== undefined && !["boundary", "bank-flank"].includes(prop.socket) || !finite(prop.weight, .01, 100) || !Array.isArray(prop.scale) || prop.scale.length !== 2 || !finite(prop.scale[0], .05, 2) || !finite(prop.scale[1], prop.scale[0], 2)) throw new RangeError("Pinball scene prop vocabulary"); resolve(prop.assetId); }
  if (!Array.isArray(blueprint.lighting.fixtureAssetIds) || blueprint.lighting.fixtureAssetIds.length > 24 || blueprint.lighting.fixtureAssetIds.some(id => !token(id) || !blueprint.props.some(p => p.assetId === id)) || !Array.isArray(blueprint.lighting.tintRoles) || blueprint.lighting.tintRoles.length !== 2 || blueprint.lighting.tintRoles.some(role => !token(role) || !blueprint.material.tones[role])) throw new RangeError("Pinball scene light vocabulary");
  for (const id of blueprint.lighting.fixtureAssetIds) resolve(id);
  const toneEntries = Object.entries(blueprint.material.tones);
  if (toneEntries.length > 32 || ["ground", "steel", "rail", "core", "trim", "dark"].some(role => !blueprint.material.tones[role])) throw new RangeError("Pinball scene required material roles");
  for (const [role, tone] of toneEntries) if (!token(role) || !Array.isArray(tone) || tone.length !== 3 || !finite(tone[0], 0, 360) || !finite(tone[1], 0, .2) || !finite(tone[2], .15, .9)) throw new RangeError("Pinball scene material");
  for (const line of blueprint.print.primitives) if (!Array.isArray(line.a) || line.a.length !== 2 || !Array.isArray(line.b) || line.b.length !== 2 || ![...line.a, ...line.b].every(n => finite(n, -320, 320)) || !finite(line.width, 1, 16) || !["trim", "core", "dark", "steel", "bark"].includes(line.role)) throw new RangeError("Pinball scene print envelope");
  if (blueprint.print.layout === "field") pinballPrintContours(blueprint.print.primitives);
  if (blueprint.structure) {
    const structure = blueprint.structure, role = (value: string) => token(value) && !!blueprint.material.tones[value] && ["body", "steel", "rail", "core", "trim", "dark", "bark", "leaf", "stone", "gold", "ground"].includes(value);
    const tuple = (values: readonly number[]) => Array.isArray(values) && values.length === 3 && values.every(n => finite(n, -3, 3));
    if (!Array.isArray(structure.rim) || structure.rim.length > 8 || !Array.isArray(structure.hubs) || structure.hubs.length > 32) throw new RangeError("Pinball scene structure budget");
    for (const band of structure.rim) if (!role(band.role) || !finite(band.inset, -24, 24) || !finite(band.drop, 0, 120) || !finite(band.width, 1, 40) || !finite(band.height, 1, 60) || band.drop < band.height) throw new RangeError("Pinball scene rim envelope");
    for (const hub of structure.hubs) {
      const size = hub.kind === "ball" || hub.kind === "capsule" ? hub.size[0] : hub.size[1];
      if (!role(hub.role) || !["box", "ball", "capsule"].includes(hub.kind) || !["static", "pulse"].includes(hub.motion) || !tuple(hub.a) || !tuple(hub.b) || !Array.isArray(hub.size) || hub.size.length !== 3 || !hub.size.every((n: number) => finite(n, .02, 3)) || Math.max(hub.a[1], hub.b[1]) + size > .5 || Math.max(Math.abs(hub.a[0]), Math.abs(hub.b[0])) + hub.size[0] > 3 || Math.max(Math.abs(hub.a[2]), Math.abs(hub.b[2])) + (hub.kind === "box" ? hub.size[2] : hub.size[0]) > 3) throw new RangeError("Pinball scene hub envelope");
    }
  }
  if (blueprint.environment) {
    const env = blueprint.environment;
    if (!token(env.semantic) || !Array.isArray(env.clear) || env.clear.length !== 3 || !env.clear.every(n => finite(n, 0, .4)) || !Array.isArray(env.tiers) || env.tiers.length > 12) throw new RangeError("Pinball scene environment vocabulary");
    if (env.floor !== null && (!env.floor || !blueprint.material.tones[env.floor.role] || !["ground", "dark", "bark", "steel", "stone", "body"].includes(env.floor.role) || !finite(env.floor.depth, 120, 400) || !finite(env.floor.margin, 0, 1600))) throw new RangeError("Pinball scene recessed environment floor");
    if (env.substrate) {
      const s = env.substrate, tuple = (v: readonly number[]) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
      if (!env.floor || !token(s.semantic) || s.layout !== undefined && !["lattice", "boundary"].includes(s.layout) || !finite(s.spacing, 160, 640) || !finite(s.rise, 16, 160) || s.rise > env.floor.depth - 32 || !Array.isArray(s.parts) || !s.parts.length || s.parts.length > 16 || !s.parts.some(p => p.motion === "static")) throw new RangeError("Pinball scene substrate envelope");
      for (const p of s.parts) {
        if (!blueprint.material.tones[p.role] || !["body", "steel", "rail", "core", "trim", "dark", "bark", "leaf", "stone", "gold", "ground"].includes(p.role) || !["box", "ball", "capsule"].includes(p.kind) || !["static", "pulse"].includes(p.motion) || !tuple(p.a) || !tuple(p.b) || !tuple(p.size) || !p.size.every((n: number) => finite(n, .005, .5)) || [...p.a, ...p.b].some((n, i) => !finite(n, i % 3 === 1 ? 0 : -.5, i % 3 === 1 ? 1 : .5)) || [0, 2].some(i => Math.max(Math.abs(p.a[i]!), Math.abs(p.b[i]!)) + (p.kind === "box" ? p.size[i]! : p.size[0]) > .75)) throw new RangeError("Pinball scene substrate geometry");
        const ry = p.kind === "box" ? p.size[1] : p.size[0];
        if (Math.min(p.a[1], p.b[1]) - ry < 0 || Math.max(p.a[1], p.b[1]) + ry > 1) throw new RangeError("Pinball scene substrate must remain within its recessed rise");
      }
    }
    for (const tier of env.tiers) {
      if (!token(tier.assetId) || !token(tier.semantic) || !["near", "mid", "far"].includes(tier.band) || !finite(tier.spacing, 160, 1200) || !Array.isArray(tier.scale) || tier.scale.length !== 2 || !finite(tier.scale[0], .1, 2) || !finite(tier.scale[1], tier.scale[0], 2) || !finite(tier.offset, 0, 2400) || tier.rise !== undefined && !finite(tier.rise, 0, 240)) throw new RangeError("Pinball scene environment tier envelope");
      const asset = resolve(tier.assetId);
      for (let variant = 0; variant < 4; variant++) { const b = asset.build({ seed: `pinball-circuit/${tier.assetId}/${variant}`, pins: { variant }, style: "pixel" }).def.bounds;
        if (b.length !== 6 || !b.every(n => Number.isFinite(n)) || b.some(n => Math.abs(n) > 24)) throw new RangeError("Pinball scene environment asset geometry");
      }
    }
    if (env.construction) {
      const construction = env.construction, boundRole = (value: string) => !!blueprint.material.tones[value] && ["body", "steel", "rail", "core", "trim", "dark", "bark", "leaf", "stone", "gold", "ground"].includes(value);
      const tuple = (v: readonly number[]) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n));
      const parts = (values: ArenaSceneStructure["hubs"], cap: number): void => {
        if (!Array.isArray(values) || !values.length || values.length > cap || !values.some(p => p.motion === "static")) throw new RangeError("Pinball construction part budget");
        for (const p of values) {
          if (!boundRole(p.role) || !["box", "ball", "capsule"].includes(p.kind) || !["static", "pulse"].includes(p.motion) || !tuple(p.a) || !tuple(p.b) || !tuple(p.size) || !p.size.every((n: number) => finite(n, .005, .5)) || [...p.a, ...p.b].some((n, i) => !finite(n, i % 3 === 1 ? 0 : -.5, i % 3 === 1 ? 1 : .5)) || [0, 2].some(i => Math.max(Math.abs(p.a[i]!), Math.abs(p.b[i]!)) + (p.kind === "box" ? p.size[i]! : p.size[0]) > .75) || p.kind === "box" && (p.a[1] - p.size[1] < 0 || p.a[1] + p.size[1] > 1)) throw new RangeError("Pinball construction normalized geometry");
        }
      };
      if (!token(construction.semantic) || !Array.isArray(construction.mounts) || construction.mounts.length > 16 || new Set(construction.mounts.map(m => m.assetId)).size !== construction.mounts.length) throw new RangeError("Pinball construction vocabulary");
      if (construction.boundary !== null) { const b = construction.boundary;
        if (!b || !finite(b.offset, 0, 400) || !finite(b.width, 16, 240) || !finite(b.rise, 0, 240) || !finite(b.drop, 16, 400) || !finite(b.spacing, 80, 600)) throw new RangeError("Pinball construction boundary envelope");
        parts(b.parts, 24);
      }
      for (const m of construction.mounts) {
        if (!token(m.assetId) || !token(m.semantic) || !["foundation", "chamber"].includes(m.from) || !finite(m.width, 16, 240) || ![...env.tiers, ...blueprint.props].some(p => p.assetId === m.assetId)) throw new RangeError("Pinball construction mount envelope");
        resolve(m.assetId); parts(m.parts, 16);
        if (m.from === "foundation" && !env.floor) throw new RangeError("Pinball mount requires foundation");
      }
    }
  }
  return freeze(JSON.parse(JSON.stringify(blueprint)) as PinballSceneBlueprint);
}

/** A cabinet retains its declared family; stage streams evolve the scene's
 * materials and behavior without changing physical generation or owner state. */
export function planPinballSceneGenome(seed: string, stage: number, blueprint: PinballSceneBlueprint, assets: readonly StyledObjectDef[] = []): PinballSceneGenome {
  if (!Number.isSafeInteger(stage) || stage < 0 || stage > 100000) throw new RangeError("Pinball scene stage");
  const admitted = definePinballSceneBlueprint(blueprint, assets), cabinetSeed = normalizeSeed(seed), child = deriveSeed(cabinetSeed, `scene:${admitted.id}:${admitted.revision}:${stage}`), roll = createRoll(child);
  const hueShift = (roll.index(0, 1025) / 512 - 1) * admitted.material.hueVariance, lightShift = (roll.index(1, 1025) / 512 - 1) * admitted.material.lightVariance;
  const tones = Object.fromEntries(Object.entries(admitted.material.tones).map(([role, tone]) => [role, [(tone[0] + hueShift + 360) % 360, tone[1], Math.max(.15, Math.min(.9, tone[2] + lightShift))] as PinballSceneTone]));
  return freeze({ schema: "keel-pinball-scene@1", blueprintId: admitted.id, blueprintRevision: admitted.revision, cabinetFamily: admitted.cabinetFamily, cabinetSeed, stage, seed: child, biome: admitted.biome, props: admitted.props,
    material: { tones }, print: admitted.print, lighting: admitted.lighting, growth: admitted.growth, ambient: admitted.ambient,
    motion: { ...admitted.motion, windRate: Math.max(.1, Math.min(3, admitted.motion.windRate * (.88 + roll.index(2, 25) / 100))), blinkPeriodMs: Math.max(800, Math.min(20000, Math.round(admitted.motion.blinkPeriodMs * (.90 + roll.index(3, 21) / 100)))) }, ...(admitted.music ? { music: admitted.music } : {}), ...(admitted.structure ? { structure: admitted.structure } : {}), ...(admitted.environment ? { environment: admitted.environment } : {}) });
}

export function validatePinballSceneGenome(genome: PinballSceneGenome, assets: readonly StyledObjectDef[] = []): PinballSceneGenome {
  if (genome.schema !== "keel-pinball-scene@1" || genome.cabinetSeed !== normalizeSeed(genome.cabinetSeed) || !Number.isSafeInteger(genome.stage) || genome.stage < 0 || genome.stage > 100000 || genome.seed !== deriveSeed(genome.cabinetSeed, `scene:${genome.blueprintId}:${genome.blueprintRevision}:${genome.stage}`)) throw new RangeError("Pinball scene genome identity");
  definePinballSceneBlueprint({ id: genome.blueprintId, revision: genome.blueprintRevision, cabinetFamily: genome.cabinetFamily, biome: genome.biome, props: genome.props, material: { ...genome.material, hueVariance: 0, lightVariance: 0 }, print: genome.print, lighting: genome.lighting, motion: genome.motion, growth: genome.growth, ambient: genome.ambient, ...(genome.music ? { music: genome.music } : {}), ...(genome.structure ? { structure: genome.structure } : {}), ...(genome.environment ? { environment: genome.environment } : {}) }, assets);
  return freeze(JSON.parse(JSON.stringify(genome)) as PinballSceneGenome);
}

const props = (frame: string, semantic: string, plants: readonly string[], lamp = false): PinballSceneProp[] => [{ assetId: frame, semantic, band: "mechanical-frame", weight: 4, scale: [.78, .95] }, ...plants.map(assetId => ({ assetId, semantic: `boundary-${assetId}`, band: "plant-fringe" as const, weight: 1, scale: [.38, .58] as const })), ...(lamp ? [{ assetId: "neon-swing-lamp", semantic: "bank-light-marquee", band: "mechanical-frame" as const, socket: "bank-flank" as const, weight: 2, scale: [.70, .84] as const }] : [])];
type Hub = ArenaSceneStructure["hubs"][number];
const hubBox = (role: string, a: Hub["a"], size: Hub["size"], motion: Hub["motion"] = "static"): Hub => ({ role, kind: "box", a, b: a, size, motion });
const hubTube = (role: string, a: Hub["a"], b: Hub["b"], radius: number, motion: Hub["motion"] = "static"): Hub => ({ role, kind: "capsule", a, b, size: [radius, radius, radius], motion });
const STRUCTURES: Readonly<Record<PinballFrameTheme, ArenaSceneStructure>> = {
  cyber: { rim: [{ role: "body", inset: 0, drop: 66, height: 60, width: 20 }, { role: "core", inset: -10, drop: 20, height: 7, width: 4 }, { role: "dark", inset: -14, drop: 45, height: 13, width: 5 }], hubs: [hubBox("body", [0, .1, 0], [2.4, .2, 1.5]), hubBox("dark", [0, .3, 0], [1.8, .05, .9]), ...[-1.2, 0, 1.2].map(x => hubBox("core", [x, .38, 0], [.18, .06, .72], "pulse")), hubTube("rail", [-2.4, .1, 1.5], [2.4, .1, 1.5], .18)] },
  vapor: { rim: [{ role: "body", inset: 0, drop: 54, height: 50, width: 24 }, { role: "trim", inset: -14, drop: 14, height: 7, width: 7 }, { role: "core", inset: -14, drop: 36, height: 4, width: 5 }], hubs: [hubBox("body", [0, .1, 0], [2.5, .2, 1.6]), ...[-1.6, -.8, 0, .8, 1.6].map(x => hubTube("trim", [x, .31, -1.2], [x + .25, .31, 1.2], .12)), hubBox("core", [0, .37, 0], [1.8, .06, .18], "pulse")] },
  gold: { rim: [{ role: "gold", inset: -4, drop: 66, height: 60, width: 30 }, { role: "dark", inset: -19, drop: 34, height: 22, width: 3 }, { role: "trim", inset: -19, drop: 68, height: 8, width: 4 }], hubs: [hubBox("gold", [0, .12, 0], [2.5, .24, 1.8]), hubBox("dark", [0, .38, 0], [1.6, .03, 1]), hubBox("core", [0, .44, 0], [.8, .04, .5], "pulse")] },
  nature: { rim: [{ role: "bark", inset: -3, drop: 66, height: 60, width: 22 }, { role: "leaf", inset: -14, drop: 18, height: 12, width: 6 }], hubs: [hubTube("bark", [-2.4, .1, -.8], [2.4, .15, .7], .26), hubTube("bark", [-2, .1, 1.1], [1.7, .1, -1.3], .23), ...[-1.4, 0, 1.4].map(x => hubBox("leaf", [x, .34, .45], [.60, .07, .40], "pulse"))] },
  crypto: { rim: [{ role: "body", inset: 0, drop: 64, height: 60, width: 26 }, { role: "gold", inset: -15, drop: 38, height: 15, width: 5 }], hubs: [hubBox("body", [0, .12, 0], [2.6, .22, 1.8]), ...[-1.2, 1.2].flatMap(x => [hubTube("trim", [x - .55, .32, 0], [x, .32, -.7], .12), hubTube("core", [x, .32, -.7], [x + .55, .32, 0], .12, "pulse"), hubTube("trim", [x + .55, .32, 0], [x, .32, .7], .12), hubTube("core", [x, .32, .7], [x - .55, .32, 0], .12, "pulse")])] },
  nightshift: { rim: [{ role: "steel", inset: 0, drop: 66, height: 60, width: 30 }, { role: "dark", inset: -16, drop: 44, height: 29, width: 3 }], hubs: [hubBox("steel", [0, .1, 0], [2.6, .22, 1.8]), ...[-1.6, -.8, 0, .8, 1.6].map(x => hubBox("dark", [x, .36, 0], [.21, .03, 1.1])), hubBox("core", [0, .43, -1.5], [1.8, .04, .15], "pulse")] },
};
const tier = (assetId: string, semantic: string, band: "near" | "mid" | "far", spacing: number, scale: readonly [number, number], offset: number): ArenaSceneEnvironment["tiers"][number] => ({ assetId, semantic, band, spacing, scale, offset, rise: band === "near" ? 170 : band === "mid" ? 80 : 0 });
const ENVIRONMENTS: Readonly<Record<PinballFrameTheme, ArenaSceneEnvironment>> = {
  cyber: { semantic: "recessed-service-machinery", clear: [.025, .022, .055], floor: { role: "dark", depth: 360, margin: 700 }, tiers: [tier("circuit-rib", "connected-cable-cabinets", "near", 340, [.85, 1.1], 0), tier("neon-swing-lamp", "swaying-service-lamps", "near", 700, [.68, .85], 60), tier("neon-pylon", "signal-towers", "mid", 620, [.9, 1.25], 160), tier("forge-stack", "deep-service-stacks", "far", 920, [1, 1.35], 440)] },
  vapor: { semantic: "sunken-prism-garden", clear: [.09, .045, .10], floor: { role: "dark", depth: 340, margin: 640 }, tiers: [tier("prism-fan", "pastel-shell-colonnade", "near", 360, [.85, 1.15], 0), tier("neon-swing-lamp", "pastel-prism-pendants", "near", 700, [.68, .85], 60), tier("palm", "breezy-palm-silhouettes", "mid", 640, [.85, 1.15], 140), tier("glacier-spire", "distant-prismatic-outcrops", "far", 980, [1.1, 1.5], 400)] },
  gold: { semantic: "excavated-vault-chamber", clear: [.055, .04, .02], floor: { role: "dark", depth: 400, margin: 740 }, tiers: [tier("vault-buttress", "weight-bearing-vault-wall", "near", 370, [.95, 1.2], 0), tier("ruin-column", "recessed-column-courts", "mid", 660, [1.1, 1.4], 120), tier("ruin-arch", "deep-arch-silhouette", "far", 1100, [1.1, 1.5], 420)] },
  nature: { semantic: "layered-root-ravine", clear: [.024, .045, .032], floor: { role: "bark", depth: 320, margin: 720 }, tiers: [tier("rooted-bank", "living-chamber-banks", "near", 370, [.9, 1.2], 0), tier("root-bridge", "interlocking-root-masses", "mid", 650, [1, 1.4], 150), tier("oak", "deep-canopy-silhouette", "far", 980, [1, 1.4], 460)] },
  crypto: { semantic: "recessed-cipher-foundry", clear: [.035, .025, .07], floor: { role: "dark", depth: 380, margin: 700 }, tiers: [tier("cipher-chain", "linked-key-cages", "near", 370, [.95, 1.25], 0), tier("crystal", "quartz-key-clusters", "mid", 660, [1.05, 1.45], 180), tier("ruin-vault", "distant-key-vaults", "far", 1050, [1, 1.35], 420)] },
  nightshift: { semantic: "sunken-heatworks", clear: [.038, .035, .029], floor: { role: "steel", depth: 400, margin: 780 }, tiers: [tier("heat-exchanger", "connected-heat-services", "near", 370, [.95, 1.2], 0), tier("forge-turbine", "lower-turbine-wells", "mid", 690, [1, 1.35], 160), tier("forge-furnace", "deep-furnace-hall", "far", 1100, [1.05, 1.4], 420)] },
};
const pinballFrameMaterial = (theme: PinballFrameTheme): ArenaBiomeBlend => ({
  cyber: { forge: .125, neon: .875, garden: 0, glacier: 0, ruins: 0 }, vapor: { forge: 0, neon: .5, garden: .125, glacier: .375, ruins: 0 },
  gold: { forge: .25, neon: 0, garden: 0, glacier: 0, ruins: .75 }, nature: { forge: 0, neon: 0, garden: .875, glacier: 0, ruins: .125 },
  crypto: { forge: .125, neon: .375, garden: 0, glacier: 0, ruins: .5 }, nightshift: { forge: .875, neon: 0, garden: 0, glacier: 0, ruins: .125 },
})[theme];
const starter = (theme: PinballFrameTheme, values: { readonly props: readonly PinballSceneProp[]; readonly tones: Readonly<Record<string, PinballSceneTone>>; readonly light: string; readonly fixtures: readonly string[]; readonly growth?: boolean; readonly wind: number; readonly blink: number; readonly tempo: number; readonly voices: readonly string[]; readonly scale: string }): PinballSceneBlueprint => definePinballSceneBlueprint({
  id: `pinball/example/${theme}`, revision: "8", cabinetFamily: theme, biome: pinballFrameMaterial(theme), props: values.props,
  material: { tones: { body: [values.tones.ground![0], Math.min(.16, values.tones.ground![1] * 1.2), .40], stone: [theme === "gold" ? 74 : theme === "nature" ? 95 : values.tones.ground![0], .08, .38], gold: [88, .14, .65], bark: [48, .09, .38], leaf: [142, .14, .55], ...pinballThemeTones(theme), steel: [values.tones.ground![0], .07, theme === "vapor" ? .51 : .41], ...values.tones }, hueVariance: 8, lightVariance: .035 }, print: PINBALL_SCENE_PRINTS[theme],
  lighting: { semantic: values.light, fixtureAssetIds: values.fixtures, tintRoles: ["core", "trim"], gain: .8 },
  motion: { windGain: values.wind, windRate: 1, blinkPeriodMs: values.blink, blinkDepth: .6 }, growth: { kind: values.growth ? "edge-vines" : "none", density: values.growth ? .72 : 0 },
  ambient: { semantic: `${theme}-environment`, tempo: values.tempo, scale: values.scale, voices: values.voices },
  structure: STRUCTURES[theme], environment: { ...ENVIRONMENTS[theme], construction: PINBALL_SCENE_CONSTRUCTIONS[theme], substrate: PINBALL_SCENE_SUBSTRATES[theme] },
});
export const PINBALL_SCENE_BLUEPRINTS: Readonly<Record<PinballFrameTheme, PinballSceneBlueprint>> = freeze({
  cyber: starter("cyber", { props: props("circuit-rib", "cable-service-rib", ["crystal"], true), tones: { ground: [272, .14, .31], body:[295,.15,.37], rail: [204, .11, .66], core: [187, .17, .81], trim: [320, .15, .73] }, light: "sequenced-neon-marquee", fixtures: ["neon-swing-lamp", "circuit-rib"], wind: .5, blink: 1800, tempo: 112, scale: "dorian", voices: ["percussive-arp", "electric-bass"] }),
  vapor: starter("vapor", { props: props("prism-fan", "prismatic-shell", ["palm", "reeds"], true), tones: { ground: [288, .12, .39], body:[331,.13,.52], rail: [184, .105, .72], core: [185, .15, .84], trim: [337, .14, .77] }, light: "pastel-prism-wash", fixtures: ["neon-swing-lamp", "prism-fan"], wind: .8, blink: 4800, tempo: 78, scale: "lydian", voices: ["hazy-chord", "soft-pluck"] }),
  gold: starter("gold", { props: props("vault-buttress", "weighted-vault-buttress", ["rock"]), tones: { ground: [68, .065, .43], rail: [78, .085, .65], core: [93, .13, .76], trim: [88, .15, .78] }, light: "warm-vault-seal", fixtures: ["vault-buttress"], wind: .1, blink: 7400, tempo: 92, scale: "pentatonic", voices: ["metal-chime", "low-resonance"] }),
  nature: starter("nature", { props: props("rooted-bank", "root-canopy", ["reeds", "bush", "grass"]), tones: { ground: [140, .105, .43], body:[56,.09,.36], rail: [64, .07, .62], core: [156, .13, .78], trim: [85, .105, .70] }, light: "bioluminescent-canopy", fixtures: ["rooted-bank"], growth: true, wind: 1, blink: 9200, tempo: 68, scale: "pentatonic", voices: ["airy-pluck", "leaf-wind"] }),
  crypto: starter("crypto", { props: props("cipher-chain", "linked-cipher-cage", ["crystal"]), tones: { ground: [254, .095, .42], rail: [176, .1, .64], core: [179, .17, .81], trim: [88, .13, .75] }, light: "digital-chain-node", fixtures: ["cipher-chain"], wind: .15, blink: 2400, tempo: 126, scale: "minor", voices: ["digital-pulse", "clock-tone"] }),
  nightshift: starter("nightshift", { props: props("heat-exchanger", "vented-heat-bank", ["rock"]), tones: { ground: [34, .045, .41], rail: [215, .035, .62], core: [43, .17, .78], trim: [69, .12, .71] }, light: "industrial-warning-beacon", fixtures: ["heat-exchanger"], wind: .2, blink: 3600, tempo: 100, scale: "minor", voices: ["relay-percussion", "vent-drone"] }),
});
