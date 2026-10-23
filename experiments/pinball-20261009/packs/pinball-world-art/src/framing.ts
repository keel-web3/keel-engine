import { createRoll, deriveSeed, normalizeSeed } from "@keel-engine/core/rng";
import type { ArenaBiomeBlend, ArenaChunk, ArenaField, ArenaArtInstance, ArenaSurface } from "@keel-engine/pinball-arena";
import { arenaSceneForRegion } from "@keel-engine/pinball-arena";
import { worldArtAsset, type WorldArtAssetId } from "./assets.ts";
import { quantizedBiomeBlend } from "./looks.ts";
import { PINBALL_SCENE_BLUEPRINTS, planPinballSceneGenome, validatePinballSceneGenome, type PinballSceneBlueprint, type PinballSceneGenome } from "./scenes.ts";
import type { StyledObjectDef } from "@keel-engine/object";
import { pinballConstructionMountRadius } from "./scene-construction.ts";
import { pinballCatchFronts, pinballCatchFrontClear } from "./catch-composition.ts";

export const PINBALL_FRAMING_REVISION = "pinball-framing/2026-10-07.11";
export type PinballFrameTheme = "cyber" | "gold" | "vapor" | "nature" | "crypto" | "nightshift";
export type PinballFrameFamily = "fork-basin" | "terrace-switchback" | "loop-gallery" | "vault-reservoir" | "encounter-crucible";
export interface PinballFramingOptions {
  readonly family: PinballFrameFamily; readonly theme?: PinballFrameTheme;
  readonly transitionTheme?: PinballFrameTheme; readonly unitScale: number;
  /** A real compiled onward mouth owns the neighbouring material transition. */
  readonly transitionPortId?: string;
  readonly seed?: string; readonly maxInstances?: number;
  /** Bind the actual admitted chassis/terrace outlines, excluding narrow track strips. */
  readonly structuralSurfaceIds?: readonly string[];
  readonly corridorMargin?: number;
  readonly sceneBlueprint?: PinballSceneBlueprint; readonly stage?: number;
  /** Registered objects supplied by an additional KEEL content pack. */
  readonly assets?: readonly StyledObjectDef[];
}
export interface PinballFramePlacement {
  readonly instanceId: string; readonly sourceSurfaceId: string; readonly edgeIndex: number; readonly edgeT: number;
  readonly band: "mechanical-frame" | "plant-fringe" | "environment-near" | "environment-mid" | "environment-far"; readonly protectedRadius: number;
}
export interface PinballFramingPlan {
  readonly revision: typeof PINBALL_FRAMING_REVISION; readonly state: "unadmitted-framing";
  readonly seed: string; readonly family: PinballFrameFamily; readonly theme: PinballFrameTheme | null;
  readonly minimumCameraPitch: .75; readonly chunks: readonly ArenaChunk[];
  readonly placements: readonly PinballFramePlacement[]; readonly material: ArenaBiomeBlend;
  readonly rejectedAnchors: number;
  readonly genome: PinballSceneGenome;
}
type Point = { readonly x: number; readonly y: number };
type Envelope = { readonly radius: number; readonly height: number };
const ENVELOPES = new Map<WorldArtAssetId, Envelope>();
const THEMES: Readonly<Record<PinballFrameTheme, { readonly frame: WorldArtAssetId; readonly plants: readonly WorldArtAssetId[]; readonly material: ArenaBiomeBlend }>> = {
  cyber: { frame: "circuit-rib", plants: ["grass", "crystal"], material: { forge: .125, neon: .875, garden: 0, glacier: 0, ruins: 0 } },
  gold: { frame: "vault-buttress", plants: ["bush", "grass"], material: { forge: .25, neon: 0, garden: 0, glacier: 0, ruins: .75 } },
  vapor: { frame: "prism-fan", plants: ["palm", "reeds"], material: { forge: 0, neon: .5, garden: .125, glacier: .375, ruins: 0 } },
  nature: { frame: "rooted-bank", plants: ["reeds", "bush", "grass"], material: { forge: 0, neon: 0, garden: .875, glacier: 0, ruins: .125 } },
  crypto: { frame: "cipher-chain", plants: ["crystal", "grass"], material: { forge: .125, neon: .375, garden: 0, glacier: 0, ruins: .5 } },
  nightshift: { frame: "heat-exchanger", plants: ["grass", "reeds"], material: { forge: .875, neon: 0, garden: 0, glacier: 0, ruins: .125 } },
};
const q = (n: number): number => Math.round(n * 1024) / 1024;
function area(polygon: readonly Point[]): number { return polygon.reduce((sum, p, i) => { const b = polygon[(i + 1) % polygon.length]!; return sum + p.x * b.y - b.x * p.y; }, 0) * .5; }
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function polygonDistance(p: Point, polygon: readonly Point[]): number {
  let inside = false, distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    distance = Math.min(distance, segmentDistance(p, a, b));
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? 0 : distance;
}
/** Match the renderer's exact four canonical assets, including their allowed
 * sway envelope. Cached by the fixed pack vocabulary, never by arbitrary seed. */
function envelope(id: string, assets: readonly StyledObjectDef[] = []): Envelope {
  const custom = assets.find(a => a.id === id), asset = custom ?? worldArtAsset(id);
  let result = custom ? undefined : ENVELOPES.get(id as WorldArtAssetId);
  if (result) return result;
  let radius = 0, height = 0;
  for (let variant = 0; variant < 4; variant++) {
    const built = asset.build({ seed: `pinball-circuit/${id}/${variant}`, pins: { variant }, style: "pixel" }), b = built.def.bounds;
    const top = Math.max(0, b[4]), sway = built.sway ? top * (built.sway.amp + .12) : 0;
    radius = Math.max(radius, Math.hypot(Math.max(Math.abs(b[0]), Math.abs(b[3])), Math.max(Math.abs(b[2]), Math.abs(b[5]))) + sway + .12);
    height = Math.max(height, top + .06);
  }
  result = Object.freeze({ radius, height }); if (!custom) ENVELOPES.set(id as WorldArtAssetId, result); return result;
}

/** Conservative all-yaw sightline extrusion for pitch>=.75. No renderer fade
 * is used to justify planting over an actual playable bed or shot corridor. */
export function pinballFrameProtectedRadius(id: string, instanceScale: number, unitScale: number, assets: readonly StyledObjectDef[] = []): number {
  const e = envelope(id, assets);
  return (e.radius + e.height / Math.tan(.75)) * instanceScale / unitScale;
}

export function pinballFrameMaterial(theme: PinballFrameTheme, transitionTheme = theme, transition = 0): ArenaBiomeBlend {
  if (!(theme in THEMES) || !(transitionTheme in THEMES) || !Number.isFinite(transition)) throw new RangeError("Pinball frame theme");
  const t = Math.max(0, Math.min(1, transition)), a = THEMES[theme].material, b = THEMES[transitionTheme].material;
  return quantizedBiomeBlend({ forge: a.forge * (1 - t) + b.forge * t, neon: a.neon * (1 - t) + b.neon * t, garden: a.garden * (1 - t) + b.garden * t, glacier: a.glacier * (1 - t) + b.glacier * t, ruins: a.ruins * (1 - t) + b.ruins * t });
}

/** Check canonical geometry, including unsupported ravine/drain mouths. This
 * is art reservation only; it cannot certify physical support or legal shots. */
export function pinballFrameClear(field: ArenaField, point: Point, radius: number, margin = 24): boolean {
  if (!Number.isFinite(point.x + point.y + radius + margin) || radius < 0 || margin < 0 || point.x < radius || point.y < radius || point.x + radius > 65535 || point.y + radius > 65535) return false;
  const clearance = radius + margin;
  for (const s of field.surfaces) if (polygonDistance(point, s.polygon) < clearance) return false;
  for (const r of [...field.rails, ...field.gates]) if (segmentDistance(point, { x: r.ax, y: r.ay }, { x: r.bx, y: r.by }) < clearance + r.radius) return false;
  for (const r of field.ramps) if (segmentDistance(point, { x: r.ax, y: r.ay }, { x: r.bx, y: r.by }) < clearance + r.width * .5) return false;
  for (const path of field.pinball?.paths ?? []) for (let i = 0; i < path.vertices.length - 1; i++) if (segmentDistance(point, path.vertices[i]!, path.vertices[i + 1]!) < clearance + Math.max(path.clearWidths?.[i] ?? path.clearWidth, path.clearWidths?.[i + 1] ?? path.clearWidth) * .5 + 24) return false;
  for (const port of field.pinball?.ports ?? []) {
    if (Math.hypot(point.x - port.x, point.y - port.y) < clearance + port.clearWidth * .5 + 48) return false;
    if (port.role === "shot-entry") for (const challenge of field.challenges ?? []) if (challenge.id === port.qualificationId) for (const id of challenge.sourceFlipperIds ?? []) {
      const blade = field.flippers.find(f => f.id === id);
      if (blade && segmentDistance(point, { x: blade.pivotX, y: blade.pivotY }, port) < clearance + port.clearWidth * .5 + blade.length) return false;
    }
  }
  for (const bank of field.stations) {
    const blades = field.flippers.filter(f => bank.flipperIds.includes(f.id));
    const bankRadius = Math.max(160, ...blades.map(f => Math.hypot(f.pivotX - bank.x, f.pivotY - bank.y) + f.length * 2));
    if (Math.hypot(point.x - bank.x, point.y - bank.y) < clearance + bankRadius) return false;
  }
  for (const h of field.hazards ?? []) if (Math.hypot(point.x - h.x, point.y - h.y) < clearance + h.radius) return false;
  for (const b of [...field.bumpers, ...field.switches, ...field.portals]) if (Math.hypot(point.x - b.x, point.y - b.y) < clearance + b.radius) return false;
  return true;
}

/** Preserve every actual bed/guide/track footprint. Recessed surroundings and
 * bounded raised edge architecture share the same horizontal reservation;
 * raised foreground uses actual posed body cutaways in the consumer. */
export function pinballEnvironmentClear(field: ArenaField, point: Point, radius: number, margin = 24): boolean {
  return pinballFrameClear({ ...field, stations: [], hazards: [], pinball: { paths: [], ports: [] } }, point, radius, margin);
}

/** Seeded scenery follows emitted mechanical boundaries. The compiler must
 * serialize these records into the final world identity and re-run admission;
 * this function neither mutates authority geometry nor approves its result. */
export function planPinballFraming(field: ArenaField, options: PinballFramingOptions): PinballFramingPlan {
  const maximum = options.maxInstances ?? 48, margin = options.corridorMargin ?? 24;
  if (!Number.isFinite(options.unitScale) || options.unitScale < .001 || options.unitScale > 1 || !Number.isSafeInteger(maximum) || maximum < 0 || maximum > 96 || !Number.isFinite(margin) || margin < 16 || margin > 400 || !options.sceneBlueprint && (!options.theme || !(options.theme in THEMES)) || !["fork-basin", "terrace-switchback", "loop-gallery", "vault-reservoir", "encounter-crucible"].includes(options.family)) throw new RangeError("Pinball framing budget");
  const seed = normalizeSeed(options.seed ?? field.seed), genome = planPinballSceneGenome(seed, options.stage ?? 0, options.sceneBlueprint ?? PINBALL_SCENE_BLUEPRINTS[options.theme!], options.assets ?? []), material = genome.biome;
  const recipes = new Map<object, PinballSceneGenome>();
  for (const binding of field.sceneRegions ?? []) recipes.set(binding.scene, validatePinballSceneGenome(binding.scene as PinballSceneGenome, options.assets));
  const recipeAt = (x: number, y: number, layer: number): PinballSceneGenome => {
    const distance = (r: ArenaField["regions"][number]) => (r.center.x - x) ** 2 + (r.center.y - y) ** 2, region = field.regions.reduce((a, b) => distance(b) < distance(a) ? b : a), binding = arenaSceneForRegion(field, region.id, layer);
    return binding && recipes.get(binding) || genome;
  };
  const pick = (values: typeof genome.props, fraction: number) => { let choice = fraction * values.reduce((sum, p) => sum + p.weight, 0); for (const value of values) { choice -= value.weight; if (choice < 0) return value; } return values.at(-1); };
  const transitionPort = options.transitionPortId ? field.pinball?.ports.find(p => p.id === options.transitionPortId) : undefined;
  if (options.transitionPortId && !transitionPort) throw new RangeError("Framing names absent transition port");
  const requested = options.structuralSurfaceIds && new Set(options.structuralSurfaceIds);
  if (requested && [...requested].some(id => !field.surfaces.some(s => s.id === id))) throw new RangeError("Framing names absent structural surface");
  let structures = field.surfaces.filter(s => requested ? requested.has(s.id) : s.kind === "playfield" || s.material === "pinball-inlay");
  if (!structures.length && !requested) {
    const largest = [...field.surfaces].filter(s => s.kind !== "water" && !/track|wire/.test(s.material)).sort((a, b) => Math.abs(area(b.polygon)) - Math.abs(area(a.polygon)) || a.id.localeCompare(b.id))[0];
    if (largest) structures = [largest];
  }
  structures = structures.slice(0, 32);
  const recipeBySurface = new Map(structures.map(surface => { const x = surface.polygon.reduce((n, p) => n + p.x, 0) / surface.polygon.length, y = surface.polygon.reduce((n, p) => n + p.y, 0) / surface.polygon.length; return [surface.id, recipeAt(x, y, surface.layer)] as const; }));
  const instances: ArenaArtInstance[] = [], placements: PinballFramePlacement[] = [], radii: number[] = [];
  const catchFronts = pinballCatchFronts(field);
  let rejectedAnchors = 0;
  const layerById = new Map<string, number>();
  const place = (surface: ArenaSurface, edge: number, t: number, x: number, y: number, nx: number, ny: number, assetId: string, scale: number, band: PinballFramePlacement["band"], slot: number): void => {
    if (instances.length >= maximum) return;
    const radius = Math.max(pinballFrameProtectedRadius(assetId, scale, options.unitScale, options.assets), pinballConstructionMountRadius(recipeBySurface.get(surface.id)!.environment, assetId)), extra = band === "mechanical-frame" ? 36 : 4;
    const point = { x: q(x + nx * (radius + margin + extra)), y: q(y + ny * (radius + margin + extra)) };
    const heights = surface.vertexElevations ?? surface.polygon.map(() => surface.height), height = heights[edge]! + (heights[(edge + 1) % heights.length]! - heights[edge]!) * t;
    if (!pinballFrameClear(field, point, radius, margin) || !pinballCatchFrontClear(catchFronts, point, radius, surface.layer, height, height + envelope(assetId, options.assets).height * scale / options.unitScale) || instances.some((a, i) => Math.hypot(a.x - point.x, a.y - point.y) < (radii[i]! + radius) * .62)) { rejectedAnchors++; return; }
    const id = `${field.id}.frame.${surface.id}.${edge}.${slot}.${band}`, child = deriveSeed(recipeBySurface.get(surface.id)!.seed, `frame:${surface.id}:${edge}:${slot}:${band}`);
    instances.push({ id, assetId, seed: child, x: point.x, y: point.y, z: q(height), yaw: q(-Math.atan2(ny, nx) - Math.PI / 2), scale, anchorSurfaceId: surface.id }); layerById.set(id, surface.layer);
    radii.push(radius); placements.push({ instanceId: id, sourceSurfaceId: surface.id, edgeIndex: edge, edgeT: t, band, protectedRadius: radius });
  };
  // The recessed environment uses full physical footprints outside the bed.
  // Its declared rise can form real enclosing architecture; actual body
  // sightline cutaways apply to raised foreground scenery. Near/mid/far candidates interleave across chambers;
  // an early long boundary cannot consume the entire environment budget.
  const candidates: { surface: ArenaSurface; edge: number; t: number; x: number; y: number; nx: number; ny: number; tier: NonNullable<PinballSceneGenome["environment"]>["tiers"][number]; slot: number }[][] = [];
  for (const surface of structures) for (const tier of recipeBySurface.get(surface.id)!.environment?.tiers ?? []) {
    const list: typeof candidates[number] = [], winding = Math.sign(area(surface.polygon)) || 1;
    for (let edge = 0; edge < surface.polygon.length; edge++) { const a = surface.polygon[edge]!, b = surface.polygon[(edge + 1) % surface.polygon.length]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); if (length < 80) continue;
      const count = Math.min(12, Math.max(1, Math.floor(length / tier.spacing)));
      for (let slot = 0; slot < count; slot++) { const t = (slot + .5) / count; list.push({ surface, edge, t, x: a.x + dx * t, y: a.y + dy * t, nx: winding * dy / length, ny: -winding * dx / length, tier, slot }); }
    } candidates.push(list);
  }
  const environmentBudget = Math.floor(maximum * .67);
  for (let round = 0; instances.length < environmentBudget && candidates.some(list => list.length > round); round++) for (const list of candidates) {
    if (instances.length >= environmentBudget) break;
    const candidate = list[round]; if (!candidate) continue;
    const { surface, edge, t, x, y, nx, ny, tier, slot } = candidate, id = `${field.id}.environment.${surface.id}.${edge}.${slot}.${tier.assetId}.${tier.band}`, child = deriveSeed(recipeBySurface.get(surface.id)!.seed, id), roll = createRoll(child);
    const scale = tier.scale[0] + roll.index(0, 256) / 255 * (tier.scale[1] - tier.scale[0]), e = envelope(tier.assetId, options.assets), radius = Math.max(e.radius * scale / options.unitScale, pinballConstructionMountRadius(recipeBySurface.get(surface.id)!.environment, tier.assetId));
    const point = { x: q(x + nx * (radius + margin + tier.offset)), y: q(y + ny * (radius + margin + tier.offset)) };
    const recess = tier.band === "near" ? 8 : tier.band === "mid" ? 80 : 160;
    const heights = surface.vertexElevations ?? surface.polygon.map(() => surface.height), height = heights[edge]! + (heights[(edge + 1) % heights.length]! - heights[edge]!) * t;
    if (!pinballEnvironmentClear(field, point, radius, margin) || !pinballCatchFrontClear(catchFronts, point, radius, surface.layer, height, height + (tier.rise ?? 0) - recess) || instances.some((a, i) => Math.hypot(a.x - point.x, a.y - point.y) < (radii[i]! + radius) * .8)) { rejectedAnchors++; continue; }
    instances.push({ id, assetId: tier.assetId, seed: child, x: point.x, y: point.y, z: q(height + (tier.rise ?? 0) - recess - e.height * scale / options.unitScale), yaw: q(-Math.atan2(ny, nx) - Math.PI / 2), scale, anchorSurfaceId: surface.id });
    layerById.set(id, surface.layer); radii.push(radius); placements.push({ instanceId: id, sourceSurfaceId: surface.id, edgeIndex: edge, edgeT: t, band: `environment-${tier.band}`, protectedRadius: radius });
  }
  // Each actual controlling pair requests a fixture at its nearest safe flank
  // boundary. The canonical bank, surface elevation and layer own the socket.
  for (const bank of field.stations) for (const fixture of recipeAt(bank.x, bank.y, bank.layer).props.filter(p => p.socket === "bank-flank")) {
    const surface = structures.filter(s => s.layer === bank.layer).sort((a, b) => polygonDistance(bank, a.polygon) - polygonDistance(bank, b.polygon))[0]; if (!surface) continue;
    const edges = surface.polygon.map((a, edge) => { const b = surface.polygon[(edge + 1) % surface.polygon.length]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), t = Math.max(.1, Math.min(.9, ((bank.x - a.x) * dx + (bank.y - a.y) * dy) / (length * length))); return { edge, t, x: a.x + dx * t, y: a.y + dy * t, nx: (Math.sign(area(surface.polygon)) || 1) * dy / length, ny: -(Math.sign(area(surface.polygon)) || 1) * dx / length, d: segmentDistance(bank, a, b) }; }).sort((a, b) => a.d - b.d);
    let mounted = 0;
    for (const edge of edges) { const roll = createRoll(deriveSeed(genome.seed, `bank-fixture:${bank.id}:${edge.edge}:${fixture.assetId}`)), before = instances.length; place(surface, edge.edge, edge.t, edge.x, edge.y, edge.nx, edge.ny, fixture.assetId, fixture.scale[0] + roll.index(0, 256) / 255 * (fixture.scale[1] - fixture.scale[0]), "mechanical-frame", 80 + field.stations.indexOf(bank));
      mounted += instances.length - before; if (mounted >= 2) break;
    }
  }
  // Stable edge cadence makes coherent bank frames. Cosmetic choices select
  // framing machinery/plants; seed-owned physical silhouettes remain upstream.
  for (const surface of structures) {
    const recipe = recipeBySurface.get(surface.id)!, frames = recipe.props.filter(p => p.band === "mechanical-frame" && p.socket !== "bank-flank"), plants = recipe.props.filter(p => p.band === "plant-fringe");
    const winding = Math.sign(area(surface.polygon)) || 1;
    for (let edge = 0; edge < surface.polygon.length; edge++) {
      const a = surface.polygon[edge]!, b = surface.polygon[(edge + 1) % surface.polygon.length]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < 80) continue;
      const nx = winding * dy / length, ny = -winding * dx / length, count = Math.min(8, Math.max(1, Math.floor(length / 240)));
      for (let slot = 0; slot < count; slot++) {
        const roll = createRoll(deriveSeed(recipe.seed, `cadence:${surface.id}:${edge}:${slot}`)), t = (slot + .5) / count, x = a.x + dx * t, y = a.y + dy * t;
        const primary = frames[0];
        if (primary && (edge + slot) % (options.family === "loop-gallery" ? 3 : 2) === 0) place(surface, edge, t, x, y, nx, ny, primary.assetId, primary.scale[0] + roll.index(0, 256) / 255 * (primary.scale[1] - primary.scale[0]), "mechanical-frame", slot);
        const secondary = pick(frames.slice(1), roll.index(3, 65536) / 65536);
        if (secondary && (edge + slot) % 3 === 1) place(surface, edge, t, x - dx / length * Math.min(84, length * .18), y - dy / length * Math.min(84, length * .18), nx, ny, secondary.assetId, secondary.scale[0] + roll.index(4, 256) / 255 * (secondary.scale[1] - secondary.scale[0]), "mechanical-frame", slot + 8);
        const plant = pick(plants, roll.index(1, 65536) / 65536);
        if (plant) place(surface, edge, t, x + dx / length * Math.min(60, length * .12), y + dy / length * Math.min(60, length * .12), nx, ny, plant.assetId, plant.scale[0] + roll.index(2, 256) / 255 * (plant.scale[1] - plant.scale[0]), "plant-fringe", slot);
      }
    }
  }
  const groups = new Map<string, ArenaArtInstance[]>();
  for (const item of instances) { const key = `${layerById.get(item.id)}.${Math.floor(item.x / 768)}.${Math.floor(item.y / 768)}`, list = groups.get(key) ?? []; list.push(item); groups.set(key, list); }
  const radiusById = new Map(instances.map((item, i) => [item.id, radii[i]!]));
  const chunks: ArenaChunk[] = [...groups].flatMap(([key, group]) => Array.from({ length: Math.ceil(group.length / 64) }, (_, index): ArenaChunk => {
    const values = group.slice(index * 64, (index + 1) * 64), cx = values.reduce((n, v) => n + v.x, 0) / values.length, cy = values.reduce((n, v) => n + v.y, 0) / values.length;
    const transition = transitionPort ? Math.max(0, 1 - Math.hypot(cx - transitionPort.x, cy - transitionPort.y) / 1100) : 0;
    return { id: `${field.id}.frame-chunk.${key}.${index}`, bounds: [Math.max(0, Math.min(...values.map(v => v.x - radiusById.get(v.id)!))), Math.max(0, Math.min(...values.map(v => v.y - radiusById.get(v.id)!))), Math.min(65535, Math.max(...values.map(v => v.x + radiusById.get(v.id)!))), Math.min(65535, Math.max(...values.map(v => v.y + radiusById.get(v.id)!)))], layer: layerById.get(values[0]!.id)!, height: Math.min(...values.map(v => v.z)), biome: options.transitionTheme && options.theme ? pinballFrameMaterial(options.theme, options.transitionTheme, transition) : recipeAt(cx, cy, layerById.get(values[0]!.id)!).biome, seed: deriveSeed(recipeAt(cx, cy, layerById.get(values[0]!.id)!).seed, `frame-chunk:${key}:${index}`), instances: values };
  }));
  return { revision: PINBALL_FRAMING_REVISION, state: "unadmitted-framing", seed, family: options.family, theme: options.theme ?? null, minimumCameraPitch: .75, chunks, placements, material, rejectedAnchors, genome };
}
