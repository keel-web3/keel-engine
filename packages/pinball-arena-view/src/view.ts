import {
  createLookTable, createSpriteRenderer, lookMesh, meshMatrix, poseMatrices, projectionOf,
  type LookMesh, type MeshDraw, type MeshLight, type MeshStyle, type Projection, type SpriteRenderer,
} from "@keel-engine/bake";
import {
  hashText, phaseAt, slotOf, swaySignal, swayWeight, type BuiltObject, type WorldRoles,
} from "@keel-engine/object";
import { FIELD_ROLES, biomeLookKey, worldArtAsset, worldArtPaint, pinballThemeFromBiome, PINBALL_SCENE_BLUEPRINTS, planPinballSceneGenome, validatePinballSceneGenome, type PinballSceneGenome } from "@keel-engine/pinball-world-art";
import { createPinballFeedback } from "@keel-engine/pinball-feedback";
import type { ArenaBiomeBlend, ArenaField, ArenaFrame, ArenaWorldDefinition, ArenaBallFrame } from "@keel-engine/pinball-arena";
import { arenaSurfaceMesh, arenaRampMesh, arenaIndicatorRing, builtArtMesh, builtArtWorld, arenaPhysicalMesh } from "./geometry.ts";
import { prioritizeArenaPulseCues, arenaLampSignal, arenaActivityWeight, type ArenaPulseCue } from "./effects.ts";
import { fitArenaAim, fitArenaLocalAim, arenaReturnReceiver, arenaReceiverLookahead, arenaCatchAimAvailable, arenaCatchYaw, type ArenaAimPoint, type ArenaAimContext } from "./camera.ts";
import { arenaTrackDetailMesh, arenaWireApronMesh, arenaCoasterTrackMesh, arenaCatchPlateMesh, arenaShooterMesh, arenaShooterPose, arenaCaptureReadoutMesh, arenaCaptureLocatorMesh } from "./mechanisms.ts";
import { arenaChamberBoundary, arenaEnvironmentMount, arenaTrackFoundation } from "./construction.ts";
import { arenaCaptureCue, type ArenaCaptureCue } from "./capture-cues.ts";
import { arenaPhysicalPartitions, arenaPresentationBounds, type ArenaPhysicalPartition } from "./physical-partitions.ts";
import { arenaBedArtMesh, arenaBedPanelMesh } from "./bed-art.ts";
import { ARENA_GROWTH_ROLES, arenaGrateGrowth, arenaGrateGrowthPose } from "./growth.ts";
import { arenaStructuralRim, arenaPivotHousing, arenaEnvironmentFloor, arenaCatchSideMachinery, ARENA_STRUCTURE_ROLES } from "./structural-art.ts";
import { arenaBodyCutaway, arenaTransformedBodyCutaway } from "./cutaway.ts";
import { arenaArtSceneAt } from "./scene-regions.ts";
import { admitArenaBodyVisuals } from "./body-visuals.ts";
import { arenaFoundationPaint, arenaBoundaryPaint, arenaSceneryPriority } from "./scenery.ts";
import type { ArenaCamera, ArenaRenderStyle, ArenaViewOptions, PinballArenaView } from "./types.ts";

/** Physical body draws use this mesh and their canonical owner; rings and cues use separate mesh identities. */
export const ARENA_BODY_MESH_ID = "body:unit-sphere";

const IDENTITY = meshMatrix();
const GARDEN: ArenaBiomeBlend = { forge: 0, neon: 0, garden: 1, glacier: 0, ruins: 0 };
const teamColour = (teamId: number): number => (185 + Math.max(0, Math.min(99, Math.floor(teamId))) * 137.508) % 360;
const STYLE_TARGET = { pixel: 256, dither: 320, arcade: 480, realistic: 720, cartoon: 480 } as const;
const radiusDistance = (x: number, y: number, bounds: readonly number[]): number => Math.hypot(Math.max(bounds[0]! - x, 0, x - bounds[2]!), Math.max(bounds[1]! - y, 0, y - bounds[3]!));
const centerOf = (bounds: readonly number[]): readonly [number, number] => [(bounds[0]! + bounds[2]!) * 0.5, (bounds[1]! + bounds[3]!) * 0.5];
const biomeAt = (field: ArenaField, x: number, y: number): ArenaBiomeBlend => field.regions.reduce<ArenaField["regions"][number] | undefined>((a, b) => !a || Math.hypot(b.center.x - x, b.center.y - y) < Math.hypot(a.center.x - x, a.center.y - y) ? b : a, undefined)?.biome ?? GARDEN;
const slot = (role: string): number => slotOf(FIELD_ROLES, role);

interface MeshRecord { readonly bytes: number; readonly shape: LookMesh; last: number }
interface ArtRecord { readonly built: BuiltObject; readonly mesh: string; readonly far: string; readonly rest: ReturnType<typeof builtArtWorld> }
interface Spring { bendX: number; bendZ: number; vx: number; vz: number; last: number }

/** A single KEEL GL renderer is reused for a canvas; meshes and world caches are released by the view. */
const RENDERERS = new WeakMap<HTMLCanvasElement, SpriteRenderer>();
export function createPinballArenaView(canvas: HTMLCanvasElement, options: ArenaViewOptions = {}): PinballArenaView {
  const bodyVisuals = new Map(admitArenaBodyVisuals(options.bodyVisuals).map(visual => [visual.ownerId, visual]));
  let style: ArenaRenderStyle = options.style ?? "pixel";
  let W = Math.max(16, Math.floor(options.width ?? 480)), H = Math.max(16, Math.floor(options.height ?? 320));
  let requestedWidth = W, requestedHeight = H;
  const sr = RENDERERS.get(canvas) ?? createSpriteRenderer(canvas, { width: W, height: H, capacity: 4096 });
  RENDERERS.set(canvas, sr);
  let table = createLookTable({ rampLength: 8 }), dirtyLooks = true;
  let world: ArenaWorldDefinition | null = null, view: Projection | null = null, disposed = false;
  let frameNumber = 0, meshBytes = 0, chunkCount = 0, moving = 0;
  const meshBudget = Math.max(64, Math.min(512, (options.maxChunkMeshes ?? 128) + 192));
  const motionBudget = Math.max(0, Math.min(128, options.maxMovingFoliage ?? (options.density === "low" ? 32 : options.density === "high" ? 96 : 64)));
  const instanceBudget = options.density === "low" ? 240 : options.density === "high" ? 800 : 480;
  const meshes = new Map<string, MeshRecord>(), art = new Map<string, ArtRecord>(), looks = new Map<string, number>(), springs = new Map<string, Spring>();
  const used = new Set<string>();
  const pulses = new Map<string, ArenaPulseCue>();
  const seenPulseIds = new Set<string>();
  let lastTick = -1;
  let feedback: ReturnType<typeof createPinballFeedback> | undefined, feedbackTick = -1;
  let lastArenaId = "", lastCameraMode = "", centerX = 0, centerY = 0, centerHeight = 0, cameraYaw = 0;
  let projectedOffsetX = 0, projectedOffsetY = 0;
  let projectionOffsets = new Map<string, readonly [number, number]>();
  const sceneByField = new Map<string, PinballSceneGenome>();
  const sceneByDefinition = new Map<object, PinballSceneGenome>();
  const sceneSignatures = new Map<PinballSceneGenome, string>();
  const physicalByField = new Map<string, readonly ArenaPhysicalPartition[]>();
  const presentationByField = new Map<string, ReturnType<typeof arenaPresentationBounds>>();
  let renderScene: PinballSceneGenome | undefined;
  const lightTints: (readonly [number, number])[] = [], sceneTints = new Map<string, readonly [number, number]>();
  const customAssets = new Map((options.worldArtAssets ?? []).map(a => [a.id, a]));
  if (customAssets.size !== (options.worldArtAssets?.length ?? 0) || customAssets.size > 128) throw new RangeError("Pinball content pack object budget");
  const appearanceKey = (biome: ArenaBiomeBlend): string => `${biomeLookKey(biome)}:${renderScene ? sceneSignatures.get(renderScene) : "legacy"}`;

  function assertLive(): void { if (disposed) throw new Error("Pinball arena view disposed."); }
  function clear(): void {
    for (const key of meshes.keys()) sr.setMesh(key, null);
    meshes.clear(); art.clear(); looks.clear(); springs.clear(); pulses.clear(); seenPulseIds.clear(); lastTick = -1; meshBytes = 0; feedback?.reset(); feedback = undefined; feedbackTick = -1;
    table = createLookTable({ rampLength: 8 }); dirtyLooks = true; view = null; lastArenaId = ""; lastCameraMode = "";
    sceneByField.clear(); sceneByDefinition.clear(); sceneSignatures.clear(); physicalByField.clear(); presentationByField.clear(); renderScene = undefined; lightTints.length = 0; sceneTints.clear();
  }
  function mesh(key: string, build: () => LookMesh): string {
    let record = meshes.get(key);
    if (!record) {
      const shape = build(), bytes = shape.positions.byteLength + shape.normals.byteLength + shape.attrs.byteLength + shape.bodies.byteLength + shape.indices.byteLength;
      sr.setMesh(key, shape); record = { bytes, shape, last: frameNumber }; meshes.set(key, record); meshBytes += bytes;
    }
    record.last = frameNumber; used.add(key); return key;
  }
  function prune(): void {
    if (meshes.size > meshBudget) {
      // Draws have completed: even an unusually wide overview may release old
      // uploads now. Their deterministic source records can recreate them later.
      const cold = [...meshes].sort((a, b) => Number(used.has(a[0])) - Number(used.has(b[0])) || a[1].last - b[1].last);
      for (const [key, record] of cold) {
        if (meshes.size <= meshBudget) break;
        sr.setMesh(key, null); meshes.delete(key); meshBytes -= record.bytes;
      }
    }
    for (const [key, state] of springs) if (frameNumber - state.last > 120) springs.delete(key);
  }
  let controllingApertures: { point: readonly number[]; radius: number }[] = [];
  let nearbyBodyApertures: { point: readonly number[]; radius: number }[] = [];
  function bodyCutMesh(key: string, point: readonly number[] | null, radius: number, offset: readonly [number, number], protectPair = false, protectNearby = false): string {
    if (!point || !view) return key;
    let shape = arenaBodyCutaway(meshes.get(key)!.shape, view, point, radius, offset);
    if (protectPair) for (const aperture of controllingApertures) { const cut = arenaBodyCutaway(shape ?? meshes.get(key)!.shape, view, aperture.point, aperture.radius, offset); if (cut) shape = cut; }
    if (protectNearby) for (const aperture of nearbyBodyApertures) { const cut = arenaBodyCutaway(shape ?? meshes.get(key)!.shape, view, aperture.point, aperture.radius, offset); if (cut) shape = cut; }
    if (!shape) return key;
    const target = `${key}/body-aperture`, old = meshes.get(target), bytes = shape.positions.byteLength + shape.normals.byteLength + shape.attrs.byteLength + shape.bodies.byteLength + shape.indices.byteLength;
    sr.setMesh(target, shape); meshes.set(target, { shape, bytes, last: frameNumber }); meshBytes += bytes - (old?.bytes ?? 0); used.add(target); return target;
  }
  function artCutMesh(key: string, instanceId: string, point: readonly number[] | null, radius: number, matrix: ArrayLike<number>, parts?: Float32Array): string | null {
    if (!point || !view) return null;
    let shape = arenaTransformedBodyCutaway(meshes.get(key)!.shape, view, point, radius, matrix, parts);
    for (const aperture of controllingApertures) { const cut = shape ? arenaBodyCutaway(shape, view, aperture.point, aperture.radius) : arenaTransformedBodyCutaway(meshes.get(key)!.shape, view, aperture.point, aperture.radius, matrix, parts); if (cut) shape = cut; }
    for (const aperture of nearbyBodyApertures) { const cut = shape ? arenaBodyCutaway(shape, view, aperture.point, aperture.radius) : arenaTransformedBodyCutaway(meshes.get(key)!.shape, view, aperture.point, aperture.radius, matrix, parts); if (cut) shape = cut; }
    if (!shape) return null;
    const target = `${key}/instance-aperture/${instanceId}`, old = meshes.get(target), bytes = shape.positions.byteLength + shape.normals.byteLength + shape.attrs.byteLength + shape.bodies.byteLength + shape.indices.byteLength;
    sr.setMesh(target, shape); meshes.set(target, { shape, bytes, last: frameNumber }); meshBytes += bytes - (old?.bytes ?? 0); used.add(target); return target;
  }
  function look(roles: WorldRoles, biome: ArenaBiomeBlend, tag = "field"): number {
    const key = `${tag}/${Object.keys(roles).join(",")}/${appearanceKey(biome)}`;
    let value = looks.get(key);
    if (value === undefined) { value = table.add(worldArtPaint(roles, `pinball-circuit/${key}`, biome, renderScene?.material.tones)); looks.set(key, value); dirtyLooks = true; }
    return value;
  }
  function artOf(assetId: string, seed: string): ArtRecord {
    const variant = Number.parseInt(hashText(seed), 36) % 4, key = `art:${assetId}:${variant}`;
    let value = art.get(key);
    if (!value) {
      const built = (customAssets.get(assetId) ?? worldArtAsset(assetId)).build({ seed: `pinball-circuit/${assetId}/${variant}`, pins: { variant }, style: "pixel" });
      const near = `${key}:near`, far = `${key}:far`;
      value = { built, mesh: near, far, rest: builtArtWorld(built) }; art.set(key, value);
    }
    return value;
  }
  function flushLooks(): void {
    if (!dirtyLooks) return;
    sr.setLooks({ palette: table.palette(), paints: table.paintTexture(), looks: table.texture(), places: table.placeTexture(), decals: table.decalTexture() }); dirtyLooks = false;
  }
  function lightTintIds(): readonly [number, number] {
    const key = renderScene ? sceneSignatures.get(renderScene)! : "legacy";
    const cached = sceneTints.get(key); if (cached) return cached;
    const paint = worldArtPaint(FIELD_ROLES, `scene-lights/${key}`, renderScene?.biome ?? GARDEN, renderScene?.material.tones);
    const roles = renderScene?.lighting.tintRoles ?? ["core", "trim"];
    const ids = roles.map(role => { const tone = renderScene?.material.tones[role], original = paint[slot(role)]?.look ?? paint[slot("core")]!.look;
      const look = tone ? { ...original, hue: tone[0], chroma: tone[1], light: tone[2] } : original;
      lightTints.push([table.ramp(look), table.rampLength]); return lightTints.length;
    }) as [number, number];
    sceneTints.set(key, ids); dirtyLooks = true; return ids;
  }
  function ballLook(teamId: number, owner: boolean, distant=false): number {
    const key = `ball:${Math.max(0, Math.min(99, Math.floor(teamId)))}:${owner ? 1 : 0}:${distant?1:0}`;
    let value = looks.get(key);
    if (value === undefined) {
      const base = [...worldArtPaint(FIELD_ROLES, "pinball-circuit/ball", GARDEN)], paint = base[slot("ball")]!;
      const hue = teamColour(teamId);
      base[slot("ball")] = { ...paint, look: { ...paint.look, hue, chroma: owner ? .015 : distant?.085:0.13, light: owner ? .89 : distant?.61:.69, span: distant?.24:.31, finish: "metal" }, sheen: "top", mirror: 0.35 };
      const signal = base[slot("core")]!;
      base[slot("core")] = { ...signal, look: { ...signal.look, hue, chroma: .17, light: .69, span: .18, finish: "glow" } };
      value = table.add(base); looks.set(key, value); dirtyLooks = true;
    }
    return value;
  }
  function bladeLook(biome:ArenaBiomeBlend,distant:boolean):number {
    if(!distant)return look(FIELD_ROLES,biome);
    const key=`background-blade:${appearanceKey(biome)}`;let value=looks.get(key);
    if(value===undefined){const paint=[...worldArtPaint(FIELD_ROLES,key,biome,renderScene?.material.tones)],trim=paint[slot("trim")]!;paint[slot("trim")]={...trim,sheen:"none",mirror:0,look:{...trim.look,light:.48,chroma:trim.look.chroma*.7,span:.14,finish:"matte"}};value=table.add(paint);looks.set(key,value);dirtyLooks=true;}return value;
  }
  function mechanismLook(biome: ArenaBiomeBlend, active: boolean): number {
    const key = `mechanism:${appearanceKey(biome)}:${active ? 1 : 0}`;
    let value = looks.get(key);
    if (value === undefined) {
      const paint = [...worldArtPaint(FIELD_ROLES, key, biome, renderScene?.material.tones)], core = paint[slot("core")]!;
      paint[slot("core")] = { ...core, look: { ...core.look, hue: active ? 153 : 34, chroma: .17, light: .68, span: .20, finish: "glow" } };
      value = table.add(paint); looks.set(key, value); dirtyLooks = true;
    }
    return value;
  }
  function captureLook(biome: ArenaBiomeBlend, phase: ArenaCaptureCue["phase"]): number {
    const key = `capture-phase:${appearanceKey(biome)}:${phase}`;
    let value = looks.get(key);
    if (value === undefined) {
      const paint = [...worldArtPaint(FIELD_ROLES, key, biome, renderScene?.material.tones)], core = paint[slot("core")]!;
      paint[slot("core")] = { ...core, look: { ...core.look, hue: phase === "captured" ? 75 : phase === "transit" ? 200 : 22, chroma: .18, light: .78, span: .12, finish: "glow" }, sheen: "none", mirror: 0 };
      value = table.add(paint); looks.set(key, value); dirtyLooks = true;
    }
    return value;
  }
  function surfaceLook(material: string, biome: ArenaBiomeBlend, pathFamily?: string): number {
    const family = material === "pinball-inlay" ? "playfield" : material === "return-track" || pathFamily === "return" ? "return" : material === "shot-track" || /wireform/.test(material) ? pathFamily ?? "route" : "terrain";
    if (family === "terrain") return look(FIELD_ROLES, biome);
    const key = `surface:${family}:${appearanceKey(biome)}`;
    let value = looks.get(key);
    if (value === undefined) {
      const paint = [...worldArtPaint(FIELD_ROLES, key, biome, renderScene?.material.tones)], ground = paint[slot("ground")]!, core = paint[slot("core")]!;
      const hue = family === "playfield" ? ground.look.hue : (ground.look.hue + (family === "cross-return" ? 40 : family === "orbit" ? -35 : family === "shooter" ? 90 : 0) + 360) % 360;
      paint[slot("ground")] = { ...ground, look: { ...ground.look, hue, light: family === "playfield" ? Math.max(.24, ground.look.light) : family === "return" ? .25 : .22, span: .16, chroma: Math.max(.055, ground.look.chroma), finish: "matte" }, sheen: "none", mirror: 0 };
      if (family === "playfield") { const side = paint[slot("steel")]!; paint[slot("steel")] = { ...side, look: { ...side.look, light: Math.min(.34, side.look.light), span: .12, finish: "matte" }, sheen: "none", mirror: 0 }; }
      paint[slot("core")] = { ...core, look: { ...core.look, hue: family === "cross-return" ? (core.look.hue + 50) % 360 : family === "shooter" ? (core.look.hue + 95) % 360 : core.look.hue, chroma: family === "return" ? .075 : .13, light: family === "return" ? .45 : .63, span: .14, finish: "matte" }, sheen: "none", mirror: 0 };
      value = table.add(paint); looks.set(key, value); dirtyLooks = true;
    }
    return value;
  }
  function sceneAt(field: ArenaField, x: number, y: number, layer: number, canonicalRegionId?: string): PinballSceneGenome {
    const bound = arenaArtSceneAt(field, x, y, layer, canonicalRegionId);
    return bound ? sceneByDefinition.get(bound)! : sceneByField.get(field.id)!;
  }
  function bedPrintLook(biome: ArenaBiomeBlend): number {
    const key = `quiet-bed-print:${appearanceKey(biome)}`;
    let value = looks.get(key);
    if (value === undefined) { const paint = [...worldArtPaint(FIELD_ROLES, key, biome, renderScene?.material.tones)], ground = paint[slot("ground")]!.look;
      for (const role of ["core", "trim", "steel", "bark"]) { const old = paint[slot(role)]!, contrast=role==="core"||role==="trim"?.18:.11; paint[slot(role)] = { ...old, sheen: "none", mirror: 0, look: { ...old.look, light: Math.min(.54, ground.light + contrast), chroma: Math.min(.15, old.look.chroma * .75), span: .07, finish: "matte" } }; }
      value = table.add(paint); looks.set(key, value); dirtyLooks = true;
    } return value;
  }
  function bedPanelLook(biome: ArenaBiomeBlend): number {
    const key=`quiet-bed-panels:${appearanceKey(biome)}`;let value=looks.get(key);
    if(value===undefined){const paint=[...worldArtPaint(FIELD_ROLES,key,biome,renderScene?.material.tones)],ground=paint[slot("ground")]!.look;
      for(const role of ["dark","steel","bark","trim","core"]){const old=paint[slot(role)]!,offset=role==="dark"?-.16:role==="steel"?.14:role==="bark"?.10:role==="core"?.18:.20;paint[slot(role)]={...old,sheen:"none",mirror:0,look:{...old.look,light:Math.max(.15,Math.min(.62,ground.light+offset)),chroma:Math.min(.16,old.look.chroma),span:.10,finish:"matte"}};}
      value=table.add(paint);looks.set(key,value);dirtyLooks=true;
    }return value;
  }
  function foundationLook(biome: ArenaBiomeBlend): number {
    const key = `matte-foundation:${appearanceKey(biome)}`;
    let value = looks.get(key);
    if (value === undefined) { value = table.add(arenaFoundationPaint(ARENA_STRUCTURE_ROLES, key, biome, renderScene!)); looks.set(key, value); dirtyLooks = true; }
    return value;
  }
  function boundaryLook(biome: ArenaBiomeBlend): number {
    const key = `matte-boundary:${appearanceKey(biome)}`;
    let value = looks.get(key);
    if (value === undefined) { value = table.add(arenaBoundaryPaint(ARENA_STRUCTURE_ROLES, key, biome, renderScene!)); looks.set(key, value); dirtyLooks = true; }
    return value;
  }
  function portLook(family: string, biome: ArenaBiomeBlend, completed: boolean): number {
    const key = `port:${family}:${appearanceKey(biome)}:${completed ? 1 : 0}`;
    let value = looks.get(key);
    if (value === undefined) {
      const paint = [...worldArtPaint(FIELD_ROLES, key, biome, renderScene?.material.tones)], core = paint[slot("core")]!;
      const returning = family === "return", hue = completed ? 153 : family === "cross-return" ? 70 : family === "orbit" ? 230 : family === "shooter" ? 300 : 185;
      paint[slot("core")] = { ...core, look: { ...core.look, hue, chroma: returning ? .025 : .15, light: returning ? .46 : .64, span: .16, finish: returning ? "matte" : "glow" } };
      value = table.add(paint); looks.set(key, value); dirtyLooks = true;
    }
    return value;
  }
  function hazardLook(biome: ArenaBiomeBlend): number {
    const key = `hazard:${appearanceKey(biome)}`;
    let value = looks.get(key);
    if (value === undefined) {
      const paint = [...worldArtPaint(FIELD_ROLES, key, biome, renderScene?.material.tones)], core = paint[slot("core")]!;
      paint[slot("core")] = { ...core, look: { ...core.look, hue: 12, chroma: .17, light: .55, span: .14, finish: "glow" } };
      value = table.add(paint); looks.set(key, value); dirtyLooks = true;
    }
    return value;
  }
  function foliagePose(record: ArtRecord, instanceId: string, x: number, y: number, scale: number, yaw: number, balls: readonly ArenaBallFrame[], seconds: number, dt: number): Float32Array | undefined {
    const sway = record.built.sway;
    if (!sway || options.reducedMotion || moving >= motionBudget) return undefined;
    let state = springs.get(instanceId);
    if (!state) {
      if (springs.size >= motionBudget) { const oldest = [...springs].sort((a, b) => a[1].last - b[1].last)[0]; if (oldest) springs.delete(oldest[0]); }
      state = { bendX: 0, bendZ: 0, vx: 0, vz: 0, last: frameNumber }; springs.set(instanceId, state);
    }
    state.last = frameNumber; moving++;
    let pushX = 0, pushZ = 0;
    const reach = 86 * Math.max(0.6, scale);
    for (const ball of balls) {
      if (!ball.active || ball.eliminated) continue;
      const dx = x - ball.x, dz = y - ball.y, distance = Math.hypot(dx, dz);
      if (distance >= reach) continue;
      const amount = (1 - distance / reach) * 0.52;
      pushX += (dx / Math.max(1, distance) + ball.vx * 0.001) * amount;
      pushZ += (dz / Math.max(1, distance) + ball.vy * 0.001) * amount;
    }
    // Disturbance is in world space; wind/pose offsets must be inverse-rotated
    // before the instance transform, or a rotated plant bends toward the ball.
    const co = Math.cos(yaw), si = Math.sin(yaw), localPushX = co * pushX - si * pushZ, localPushZ = si * pushX + co * pushZ;
    const bound = (n: number): number => Math.max(-0.8, Math.min(0.8, n));
    state.vx += ((bound(localPushX) - state.bendX) * 26 - state.vx * 8) * dt; state.bendX += state.vx * dt;
    state.vz += ((bound(localPushZ) - state.bendZ) * 26 - state.vz * 8) * dt; state.bendZ += state.vz * dt;
    const top = Math.max(0.1, record.built.def.bounds[4]), phase = phaseAt(x * world!.unitScale, y * world!.unitScale, sway.hz);
    const wind = swaySignal(seconds, sway.hz * (renderScene?.motion.windRate ?? 1), phase) * sway.amp * top * (renderScene?.motion.windGain ?? 1);
    const shift = (p: readonly number[], group?: string): [number, number, number] => {
      if (sway.groups && !sway.groups.includes(group ?? "")) return [p[0]!, p[1]!, p[2]!];
      const weight = swayWeight(p[1]!, top, sway);
      return [p[0]! + (co * wind - si * wind * .35 + state!.bendX * top * 0.12) * weight, p[1]!, p[2]! + (si * wind + co * wind * .35 + state!.bendZ * top * 0.12) * weight];
    };
    const partGroup = (p: object): string | undefined => (p as { readonly group?: string | null }).group ?? undefined;
    const boxGroups = record.built.def.parts.filter(p => p.wedge || p.prim?.type === "box").map(partGroup);
    const capsuleGroups = record.built.def.parts.filter(p => p.prim?.type === "capsule").map(partGroup);
    const posed = {
      boxes: record.rest.boxes.map((b, i) => ({ ...b, c: shift(b.c, boxGroups[i]) })),
      capsules: record.rest.capsules.map((c, i) => ({ ...c, a: shift(c.a, capsuleGroups[i]), b: shift(c.b, capsuleGroups[i]) })),
    };
    return poseMatrices(record.rest, posed);
  }
  function rotorPose(record: ArtRecord, seconds: number): Float32Array | undefined {
    if (options.reducedMotion || record.built.id !== "forge-turbine") return undefined;
    const posed = { boxes: record.rest.boxes.map(b => ({ ...b })), capsules: record.rest.capsules };
    const boxParts = record.built.def.parts.filter(p => p.wedge || p.prim?.type === "box");
    const angle = seconds * 1.7, co = Math.cos(angle), si = Math.sin(angle);
    for (let i = 0; i < posed.boxes.length; i++) if ((boxParts[i] as { group?: string })?.group === "rotor") {
      const b = posed.boxes[i]!, c = b.c;
      posed.boxes[i] = { ...b, c: [co * c[0] + si * c[2], c[1], -si * c[0] + co * c[2]], yaw: b.yaw + angle };
    }
    return poseMatrices(record.rest, posed);
  }



  const api: PinballArenaView = {
    setWorld(next) { assertLive(); if (world === next) return; if (!(next.unitScale > 0) || !next.arenas.length) throw new RangeError("Arena world needs a positive unit scale and an arena.");
      const scenes = next.arenas.map(field => { const explicit = (field as ArenaField & { readonly scene?: PinballSceneGenome }).scene;
        return [field.id, explicit ? validatePinballSceneGenome(explicit, options.worldArtAssets) : planPinballSceneGenome(field.seed, 0, PINBALL_SCENE_BLUEPRINTS[pinballThemeFromBiome(field.regions[0]?.biome ?? GARDEN)])] as const;
      });
      const regional = next.arenas.flatMap(field => field.sceneRegions?.map(binding => [binding.scene, validatePinballSceneGenome(binding.scene as PinballSceneGenome, options.worldArtAssets)] as const) ?? []);
      const nextFeedback = createPinballFeedback(next, { maxParticles: options.density === "low" ? 64 : options.density === "high" ? 192 : 128, maxPulses: 32, reducedMotion: options.reducedMotion ?? false }); clear(); world = next; feedback = nextFeedback; for (const [id, scene] of scenes) sceneByField.set(id, scene);
      for (const field of next.arenas) if (field.scene) sceneByDefinition.set(field.scene, sceneByField.get(field.id)!);
      for (const [source, scene] of regional) sceneByDefinition.set(source, scene);
      for (const scene of [...scenes.map(([, scene]) => scene), ...regional.map(([, scene]) => scene)]) sceneSignatures.set(scene, `${scene.seed}/${hashText(JSON.stringify(scene))}`);
      for (const field of next.arenas) { physicalByField.set(field.id, arenaPhysicalPartitions(field)); presentationByField.set(field.id, arenaPresentationBounds(field)); } },
    resize(width, height) {
      assertLive(); const cap = style === "pixel" ? options.density === "low" ? 256 : options.density === "high" ? 384 : 320 : STYLE_TARGET[style];
      requestedWidth = Math.max(16, Number.isFinite(width) ? width : 480); requestedHeight = Math.max(16, Number.isFinite(height) ? height : 320);
      const scale = Math.min(1, cap / requestedHeight, 1280 / requestedWidth);
      W = Math.max(16, Math.round(requestedWidth * scale)); H = Math.max(16, Math.round(requestedHeight * scale)); sr.setTarget(W, H);
    },
    setStyle(next) { assertLive(); style = next; api.resize(requestedWidth, requestedHeight); },
    render(frame, { timeMs, deltaMs = 16, camera = { mode: "follow" } }) {
      assertLive(); if (!world) throw new Error("Set a generated arena world before rendering.");
      frameNumber++; used.clear(); moving = 0; chunkCount = 0;
      const ownerId = camera.ownerId ?? options.ownerId ?? 0;
      const body = frame.balls.find(b => b.ownerId === ownerId && !b.eliminated) ?? frame.balls[0];
      if (frame.tick < lastTick) { pulses.clear(); seenPulseIds.clear(); springs.clear(); lastCameraMode = ""; feedback!.reset(); feedbackTick = -1; }
      lastTick = frame.tick;
      if (feedbackTick !== frame.tick) { feedback!.update(frame); feedbackTick = frame.tick; }
      const feedbackFrame = feedback!.sample(frame.tick);
      const mechanismPoses = new Map(feedbackFrame.mechanisms.map(m => [m.id, m]));
      for (const [id, pulse] of pulses) if (timeMs - pulse.born > 420 || timeMs < pulse.born) pulses.delete(id);
      for (const event of frame.events) if (event.type === "ability" && event.ability === "pulse" && event.arenaId && event.x !== undefined && event.y !== undefined && event.radius && !seenPulseIds.has(event.id)) {
        if (seenPulseIds.size >= 256) seenPulseIds.delete(seenPulseIds.values().next().value!);
        seenPulseIds.add(event.id);
        pulses.set(event.id, { id: event.id, arenaId: event.arenaId, x: event.x, y: event.y, elevation: event.elevation ?? 0, radius: event.radius, ownerId: event.ownerId ?? 0, born: timeMs });
      }
      if (pulses.size > 32) {
        const keep = new Set(prioritizeArenaPulseCues(pulses.values(), ownerId, body, 32).map(p => p.id));
        for (const id of pulses.keys()) if (!keep.has(id)) pulses.delete(id);
      }
      const selectedField = world.arenas.find(a => a.id === (camera.arenaId ?? body?.arenaId)) ?? world.arenas[0]!;
      const presentation = presentationByField.get(selectedField.id)!, center = centerOf(presentation), overview = camera.mode === "overview", global = overview && camera.scope === "world", scale = world.unitScale;
      const offsets = new Map<string, readonly [number, number]>();
      let mapWidth = 0, mapDepth = 0;
      for (const field of world.arenas) {
        const bounds = presentationByField.get(field.id)!;
        offsets.set(field.id, global ? [mapWidth - bounds[0], -bounds[1]] : [0, 0]);
        mapWidth += bounds[2] - bounds[0] + 800;
        mapDepth = Math.max(mapDepth, bounds[3] - bounds[1]);
      }
      mapWidth -= 800;
      projectionOffsets = offsets;
      [projectedOffsetX, projectedOffsetY] = offsets.get(selectedField.id)!;
      const station = body && selectedField.stations.find(s => s.id === (body.stationId ?? body.nextStationId));
      const returnStation = !overview && body ? arenaReturnReceiver(selectedField, body, arenaReceiverLookahead(body)) : null;
      const nearStation = body?.transport ? null : returnStation || (!overview && station && body && arenaCatchAimAvailable(selectedField, body, station) ? station : null);
      const ownedCapture = body?.transport && selectedField.captures?.find(c => c.id === body.transport!.mechanismId);
      const ownedCaptureCue = ownedCapture ? arenaCaptureCue(world, selectedField, ownedCapture, frame) : null;
      const lead=body&&nearStation?Math.min(7,body.radius*3/Math.max(1,Math.hypot(body.vx,body.vy))):7;
      const bodyX = body ? body.x + body.vx * lead : center[0], bodyY = body ? body.y + body.vy * lead : center[1];
      const wantedH = camera.elevation ?? body?.elevation ?? 0;
      const pitch = camera.pitch ?? 1.10;
      const basisBank = nearStation ?? (station?.layer === body?.layer ? station : undefined) ?? selectedField.stations.find(s => s.layer === body?.layer) ?? selectedField.stations[0];
      const wantedYaw = camera.yaw ?? arenaCatchYaw(selectedField, basisBank);
      const yawStep = Math.atan2(Math.sin(wantedYaw - cameraYaw), Math.cos(wantedYaw - cameraYaw));
      cameraYaw = camera.yaw !== undefined || overview || lastArenaId !== selectedField.id || !lastCameraMode || options.reducedMotion ? wantedYaw : cameraYaw + yawStep * (1 - Math.exp(-Math.min(50, Math.max(0, deltaMs)) * .009));
      const yaw = cameraYaw;
      const aim: ArenaAimPoint[] = [], aimContexts:ArenaAimContext[]=[];
      if (nearStation && body) {
        aim.push({ x: bodyX, y: bodyY, elevation: body.elevation }, { x: body.x, y: body.y, elevation: body.elevation + body.radius }, nearStation);
        for (const f of frame.flippers) if (f.arenaId === selectedField.id && nearStation.flipperIds.includes(f.id)) {
          for (const [x, y] of [[f.pivotX, f.pivotY], [f.tipX, f.tipY]]) {
            aim.push({ x: x! - f.radius, y: y! - f.radius, elevation: f.elevation }, { x: x! + f.radius, y: y! + f.radius, elevation: f.elevation });
          }
        }
        if (arenaCatchAimAvailable(selectedField, body, nearStation)) {
          const shotIds = new Set(selectedField.challenges?.filter(c => c.kind === "main-shot" && c.sourceFlipperIds?.some(id => nearStation.flipperIds.includes(id))).map(c => c.id));
          for (const port of selectedField.pinball?.ports ?? []) if (port.role === "shot-entry" && port.qualificationId && shotIds.has(port.qualificationId)) {
            const length = Math.hypot(port.tangent.x, port.tangent.y), half = port.clearWidth * .5;
            const nx = length > 0 ? -port.tangent.y / length * half : half, ny = length > 0 ? port.tangent.x / length * half : 0;
            const dx=port.x-body.x,dy=port.y-body.y,distance=Math.hypot(dx,dy),speed=Math.hypot(body.vx,body.vy),alignment=speed>1?(body.vx*dx+body.vy*dy)/(speed*Math.max(1,distance)):0;
            aimContexts.push({id:port.id,points:[port,{x:port.x+nx,y:port.y+ny,elevation:port.elevation},{x:port.x-nx,y:port.y-ny,elevation:port.elevation}],priority:distance*(1-.25*alignment)});
          }
        }
        for (const hazard of selectedField.hazards ?? []) if (hazard.kind === "drain" && hazard.layer === nearStation.layer && Math.hypot(hazard.x - nearStation.x, hazard.y - nearStation.y) < 300) {
          aim.push({ x: hazard.x - hazard.radius, y: hazard.y - hazard.radius, elevation: hazard.elevation }, { x: hazard.x + hazard.radius, y: hazard.y + hazard.radius, elevation: hazard.elevation });
        }
      }
      const bodyFloorK = body ? 4 / Math.max(.05, body.radius * scale) : 0;
      const receiving = !!(nearStation && body && !arenaCatchAimAvailable(selectedField, body, nearStation));
      const localAimFit=aim.length && !receiving ? fitArenaLocalAim(aim,aimContexts,scale,W,H,pitch,yaw,wantedH,bodyFloorK) : null;
      let aimingFit=localAimFit ?? (aim.length?fitArenaAim(aim,scale,W,H,pitch,yaw,wantedH):null);
      if(localAimFit){aim.length=0;aim.push(...localAimFit.points);}
      // A far receiver is not yet a playable landing if fitting it reduces the
      // actual sphere below readable local travel scale. Keep the body/path in
      // view until both the body and controlling machinery fit at that scale.
      if (receiving && aimingFit && aimingFit.k < bodyFloorK) { aim.length = 0; aimingFit = null; }
      const wantedX = camera.x ?? (global ? mapWidth * .5 : overview ? center[0] : aimingFit?.x ?? bodyX);
      const wantedY = camera.y ?? (global ? mapDepth * .5 : overview ? center[1] : aimingFit?.y ?? bodyY - 55);
      const dt = Math.max(0, Math.min(50, deltaMs)) / 1000;
      const cameraMode = `${camera.mode}:${camera.scope ?? "arena"}`;
      const smooth = overview || ownedCaptureCue || lastArenaId !== selectedField.id || lastCameraMode !== cameraMode || options.reducedMotion ? 1 : 1 - Math.exp(-dt * 10);
      centerX += (wantedX - centerX) * smooth; centerY += (wantedY - centerY) * smooth; centerHeight += (wantedH - centerHeight) * smooth; lastArenaId = selectedField.id; lastCameraMode = cameraMode;
      const zoom = Math.max(0.18, Math.min(6, camera.zoom ?? 1));
      const fieldWidth = (global ? mapWidth : presentation[2] - presentation[0]) * scale, fieldDepth = (global ? mapDepth : presentation[3] - presentation[1]) * scale;
      const overviewWidthMargin = Math.min(16, fieldWidth * .08 + 2), overviewHeightMargin = Math.min(20, fieldDepth * .08 + 3);
      let followK = aimingFit?.k ?? Math.max(Math.min(H / 27, W / 28), bodyFloorK);
      // Real transport has no free physical body to frame. Preserve a readable
      // local mechanism display; fitting the distant exit would erase its phase.
      if (!overview && ownedCaptureCue) {
        const entry = selectedField.pinball?.ports.find(p => p.id === ownedCapture!.entryPortId);
        const radius = (entry?.clearWidth ?? 2 / scale) * scale * .5;
        followK = Math.min(Math.max(12, bodyFloorK), W * .86 / (radius * 2 + 8.34), H / 10);
        if (camera.x === undefined) centerX += Math.cos(yaw) * 1.88 / scale;
        if (camera.y === undefined) centerY -= Math.sin(yaw) * 1.88 / scale;
      }
      if (aimingFit && camera.x === undefined && camera.y === undefined) {
        // While the center eases from shooter to catch, widen enough to retain
        // those same admitted mouth/blade points throughout the transition.
        const probe = projectionOf({ kind: "ortho", center: [centerX * scale, centerHeight * scale, centerY * scale], yaw, pitch, k: 1 }, W, H, 400);
        const projected = aim.map(p => probe.project([p.x * scale, p.elevation * scale, p.y * scale]));
        const sideways = Math.max(1e-6, ...projected.map(p => Math.abs(p[0] - W * .5)));
        const up = Math.max(1e-6, ...projected.map(p => H * .5 - p[1])), down = Math.max(1e-6, ...projected.map(p => p[1] - H * .5));
        followK = Math.min(followK, W * .41 / sideways, H * .35 / up, H * .28 / down);
        if (followK < bodyFloorK) {
          // A stale eased center must not trade away body scale at the arrival
          // transition. The admitted fit already includes body, blades/drain.
          centerX = wantedX; centerY = wantedY; centerHeight = wantedH;
          followK = aimingFit.k;
        }
      }
      const k = overview ? Math.min(W / (fieldWidth + overviewWidthMargin), H / (fieldDepth * Math.sin(pitch) + overviewHeightMargin))*zoom : Math.max(body?.transport ? 0 : bodyFloorK,followK*zoom);
      const depthRange = overview ? Math.max(400, Math.hypot(fieldWidth, fieldDepth) * 2 + 80) : 400;
      if (!overview && body && !aimingFit && camera.x === undefined && camera.y === undefined) {
        // Lead and azimuth easing are subordinate to actual body tracking.
        // Solve a ground-plane camera correction with KEEL's own axes when
        // the canonical body approaches the local travel framing boundary.
        const probe = projectionOf({ kind: "ortho", center: [centerX * scale, centerHeight * scale, centerY * scale], yaw, pitch, k }, W, H, depthRange), p = probe.project([body.x * scale, (body.elevation + body.radius) * scale, body.y * scale]);
        const dx = p[0] - Math.max(W * .25, Math.min(W * .75, p[0])), dy = p[1] - Math.max(H * .25, Math.min(H * .65, p[1]));
        const a = probe.right[0] * k, b = probe.right[2] * k, c = -probe.up[0] * k, d = -probe.up[2] * k, determinant = a * d - b * c;
        if (Math.abs(determinant) > .00001) { centerX += (dx * d - b * dy) / determinant / scale; centerY += (a * dy - dx * c) / determinant / scale; }
      }
      view = projectionOf({ kind: "ortho", center: [centerX * scale, centerHeight * scale, centerY * scale], yaw, pitch, k }, W, H, depthRange);
      const apertureBody = !overview && body && !body.eliminated && body.transport === null ? view.project([(body.x + projectedOffsetX) * scale, (body.elevation + body.radius) * scale, (body.y + projectedOffsetY) * scale]) : null;
      const apertureRadius = body ? Math.max(4, body.radius * scale * k + 3) : 0;
      nearbyBodyApertures = [];
      if (apertureBody && body) for (const other of [...frame.balls].sort((a,b)=>a.ownerId-b.ownerId)) {
        if(other.ownerId===ownerId||other.arenaId!==selectedField.id||!other.active||other.eliminated||other.transport!==null||arenaActivityWeight(ownerId,body,other)!==1)continue;
        const point=view.project([(other.x+projectedOffsetX)*scale,(other.elevation+other.radius)*scale,(other.y+projectedOffsetY)*scale]),radius=Math.max(1,other.radius*scale*k)+1;
        if(point[0]<-radius||point[0]>W+radius||point[1]<-radius||point[1]>H+radius)continue;
        nearbyBodyApertures.push({point,radius});
      }
      controllingApertures = [];
      if (apertureBody && nearStation) for (const blade of frame.flippers.filter(f => f.arenaId === selectedField.id && nearStation.flipperIds.includes(f.id))) {
        const at = (x: number, y: number) => view!.project([(x + projectedOffsetX) * scale, (blade.elevation + blade.radius) * scale, (y + projectedOffsetY) * scale]), a = at(blade.pivotX, blade.pivotY), b = at(blade.tipX, blade.tipY), middle = at((blade.pivotX + blade.tipX) * .5, (blade.pivotY + blade.tipY) * .5);
        controllingApertures.push({ point: [middle[0], middle[1], Math.min(a[2], b[2])], radius: Math.hypot(a[0] - b[0], a[1] - b[1]) * .5 + blade.radius * scale * k + 2 });
      }
      if(apertureBody && nearStation && body && arenaCatchAimAvailable(selectedField,body,nearStation) && localAimFit) {
        const included=new Set(localAimFit.included);
        for(const port of selectedField.pinball?.ports??[]) if(included.has(port.id)) for(const t of [.35,.70,1]) {const point=view.project([(nearStation.x+(port.x-nearStation.x)*t+projectedOffsetX)*scale,(nearStation.elevation+(port.elevation-nearStation.elevation)*t+body.radius)*scale,(nearStation.y+(port.y-nearStation.y)*t+projectedOffsetY)*scale]);
          controllingApertures.push({point,radius:Math.max(9,body.radius*scale*k*2.5)});
        }
      }
      const distance = overview ? Infinity : Math.hypot(W, H) / Math.max(0.1, k) / scale;
      const draws: MeshDraw[] = [], lights: MeshLight[] = [];
      let instances = 0;
      for (const field of global ? world.arenas : [selectedField]) {
      renderScene = sceneByField.get(field.id);
      const [offsetX, offsetY] = offsets.get(field.id)!, localCenterX = centerX - offsetX, localCenterY = centerY - offsetY;
      const fieldMatrix = global ? meshMatrix({ x: offsetX * scale, z: offsetY * scale }) : IDENTITY;
      const chunks = field.chunks.filter(c => radiusDistance(localCenterX, localCenterY, c.bounds) < distance + 400).sort((a, b) => radiusDistance(localCenterX, localCenterY, a.bounds) - radiusDistance(localCenterX, localCenterY, b.bounds));
      const foundationLayer = !overview && body?.arenaId === field.id ? body.layer : 0;
      const foundationRegions: { id: string; bounds: ArenaField["bounds"]; surround: boolean }[] = [];
      if (field.sceneRegions?.length) {
        const margin = Math.max(sceneByField.get(field.id)!.environment?.floor?.margin ?? 0, ...field.sceneRegions.map(binding => binding.scene.environment?.floor?.margin ?? 0)), columns = Math.max(1, Math.min(8, Math.ceil((field.bounds[2] - field.bounds[0] + margin * 2) / 640))), rows = Math.max(1, Math.min(8, Math.ceil((field.bounds[3] - field.bounds[1] + margin * 2) / 640)));
        for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { const x = (i: number) => field.bounds[0] - margin + i / columns * (field.bounds[2] - field.bounds[0] + margin * 2), y = (i: number) => field.bounds[1] - margin + i / rows * (field.bounds[3] - field.bounds[1] + margin * 2); foundationRegions.push({ id: `${column}.${row}`, bounds: [x(column), y(row), x(column + 1), y(row + 1)], surround: false }); }
      } else foundationRegions.push({ id: "field", bounds: field.bounds, surround: true });
      for (const patch of foundationRegions) {
        const bounds = patch.bounds;
        renderScene = sceneAt(field, (bounds[0] + bounds[2]) * .5, (bounds[1] + bounds[3]) * .5, foundationLayer);
        if (!renderScene.environment?.floor) continue;
        for (const pulsing of renderScene.environment.substrate?.parts.some(p => p.motion === "pulse") ? [false, true] : [false]) {
          const foundation = mesh(`${field.id}/environment-floor/${patch.id}/${foundationLayer}/${appearanceKey(renderScene.biome)}/${pulsing}`, () => arenaEnvironmentFloor(field, scale, renderScene!, bounds, foundationLayer, patch.surround, pulsing));
          draws.push({ mesh: bodyCutMesh(foundation, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale], true, true), matrix: fieldMatrix, look: foundationLook(renderScene.biome), light: .78, ...(pulsing ? { flash: arenaLampSignal(renderScene.seed, `${patch.id}/substrate`, timeMs, options.reducedMotion) * .02 } : {}) });
        }
      }
      const pathBySurface = new Map(field.pinball?.paths.flatMap(path => path.surfaceIds.map(id => [id, path] as const)));
      const compiledRampIds = new Set(field.surfaces.filter(s => s.kind === "ramp" && s.vertexElevations && s.rampId).map(s => s.rampId!));
      for (const surface of field.surfaces) {
        if (surface.kind === "ramp" && !surface.vertexElevations) continue;
        const bounds = [Math.min(...surface.polygon.map(p => p.x)), Math.min(...surface.polygon.map(p => p.y)), Math.max(...surface.polygon.map(p => p.x)), Math.max(...surface.polygon.map(p => p.y))];
        if (radiusDistance(localCenterX, localCenterY, bounds) > distance + 100) continue;
        renderScene = sceneAt(field, (bounds[0]! + bounds[2]!) * .5, (bounds[1]! + bounds[3]!) * .5, surface.layer);
        const pathFamily = surface.role === "return" ? "return" : pathBySurface.get(surface.id)?.role;
        const bedLook = surfaceLook(surface.material, surface.biome, pathFamily);
        const wireform = /wireform/.test(surface.material), openCoaster = wireform && surface.kind === "bridge";
        if (!openCoaster) {
          const authoredSide = renderScene.structure?.rim[0]?.role, sideMaterial = surface.kind === "playfield" || surface.material === "pinball-inlay" ? authoredSide === "body" ? "ground" : authoredSide === "gold" ? "trim" : authoredSide && authoredSide in FIELD_ROLES ? authoredSide as keyof typeof FIELD_ROLES : undefined : undefined;
          const key = mesh(`${field.id}/surface/${surface.id}`, () => arenaSurfaceMesh(surface, scale, sideMaterial));
          draws.push({ mesh: bodyCutMesh(key, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale],true), matrix: fieldMatrix, look: bedLook, seam: surface.kind === "ground" ? 1 : 0, light: 1.05 });
          if (surface.kind === "playfield" || surface.material === "pinball-inlay") {
            if(renderScene?.print.layout==="field"){const panels=mesh(`${field.id}/bed-panels/${surface.id}/${appearanceKey(surface.biome)}`,()=>arenaBedPanelMesh(surface,scale,renderScene!,field));draws.push({mesh:bodyCutMesh(panels,body?.arenaId===field.id?apertureBody:null,apertureRadius,[offsetX*scale,offsetY*scale]),matrix:fieldMatrix,look:bedPanelLook(surface.biome),light:1});}
            const printed = mesh(`${field.id}/bed-print/${surface.id}/${appearanceKey(surface.biome)}`, () => arenaBedArtMesh(surface, scale, renderScene, field));
            draws.push({ mesh: bodyCutMesh(printed, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale]), matrix: fieldMatrix, look: bedPrintLook(surface.biome), seam: 1, light: .82 });
            if (renderScene?.structure) { const rim = mesh(`${field.id}/structural-rim/${surface.id}/${appearanceKey(surface.biome)}`, () => arenaStructuralRim(surface, scale, renderScene!));
              draws.push({ mesh: bodyCutMesh(rim, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale]), matrix: fieldMatrix, look: look(ARENA_STRUCTURE_ROLES, surface.biome, "native-structure"), light: 1.1 }); }
          }
        }
        if (surface.kind === "playfield" && renderScene?.environment?.construction?.boundary) for (const pulsing of [false, true]) {
          const surround = mesh(`${field.id}/chamber-boundary/${surface.id}/${appearanceKey(surface.biome)}/${pulsing}`, () => arenaChamberBoundary(field, surface, scale, renderScene!, pulsing));
          const priority = arenaSceneryPriority(radiusDistance(localCenterX, localCenterY, bounds) * scale, overview);
          draws.push({ mesh: bodyCutMesh(surround, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale], true, true), matrix: fieldMatrix, look: boundaryLook(renderScene.biome), flash: pulsing ? arenaLampSignal(renderScene.seed, surface.id, timeMs, options.reducedMotion) * .04 * priority.signal : 0, light: priority.light });
        }
        if (wireform || pathFamily && surface.polygon.length === 4) {
          const detail = mesh(`${field.id}/track-detail/${surface.id}`, () => openCoaster ? arenaCoasterTrackMesh(surface, scale) : surface.polygon.length === 4 ? arenaTrackDetailMesh(surface, scale, pathFamily ?? "route", false) : arenaWireApronMesh(surface, scale));
          draws.push({ mesh: bodyCutMesh(detail, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale]), matrix: fieldMatrix, look: bedLook, seam: 1 });
          const path = pathBySurface.get(surface.id);
          if (path && renderScene?.environment?.construction) { const supports = mesh(`${field.id}/native-track-foundation/${surface.id}/${appearanceKey(surface.biome)}`, () => arenaTrackFoundation(field, surface, path.surfaceIds.indexOf(surface.id), scale, renderScene!));
            draws.push({ mesh: bodyCutMesh(supports, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale], true, true), matrix: fieldMatrix, look: boundaryLook(surface.biome), light: .9 }); }
          if (wireform && renderScene?.growth.kind === "edge-vines" && instances < instanceBudget) {
            const growth = arenaGrateGrowth(surface, scale, renderScene.seed, renderScene.growth.density);
            if (growth) { const vine = mesh(`${field.id}/grate-growth/${surface.id}`, () => lookMesh(growth.rest, { around: 6, rings: 1 }));
              const pose = moving < motionBudget ? arenaGrateGrowthPose(growth, scale, timeMs / 1000, frame.balls.filter(b => b.arenaId === field.id && b.layer === surface.layer), options.reducedMotion) : undefined;
              if (pose) moving++; instances++;
              draws.push({ mesh: vine, matrix: fieldMatrix, look: look(ARENA_GROWTH_ROLES, surface.biome, "grate-growth"), ...(pose ? { parts: pose } : {}) });
            }
          }
        }
      }
      for (const ramp of field.ramps) {
        const bounds = [Math.min(ramp.ax, ramp.bx), Math.min(ramp.ay, ramp.by), Math.max(ramp.ax, ramp.bx), Math.max(ramp.ay, ramp.by)];
        if (radiusDistance(localCenterX, localCenterY, bounds) > distance + ramp.width) continue;
        renderScene = sceneAt(field, (ramp.ax + ramp.bx) * .5, (ramp.ay + ramp.by) * .5, ramp.fromLayer);
        const rampBiome = biomeAt(field, (ramp.ax + ramp.bx) * .5, (ramp.ay + ramp.by) * .5);
        if (!compiledRampIds.has(ramp.id)) {
          const key = mesh(`${field.id}/ramp/${ramp.id}`, () => arenaRampMesh(ramp, scale));
          draws.push({ mesh: key, matrix: fieldMatrix, look: look(FIELD_ROLES, rampBiome), light: 1.12 });
        }
        const mouthWidth = ramp.width * scale, mouthKey = mesh(`ramp-mouth:${ramp.width}`, () => lookMesh({ boxes: [
          { c: [0, .035, -mouthWidth * .49], h: [.62, .04, .055], mat: slot("trim") },
          { c: [0, .035, mouthWidth * .49], h: [.62, .04, .055], mat: slot("trim") },
          { c: [-.15, .12, -mouthWidth * .53], h: [.27, .12, .13], kind: "wedge", lo: .03, mat: slot("steel") },
          { c: [-.15, .12, mouthWidth * .53], h: [.27, .12, .13], kind: "wedge", lo: .03, mat: slot("steel") },
          { c: [.45, .07, -.26], h: [.38, .03, .08], yaw: -.5, mat: slot("trim") },
          { c: [.45, .07, .26], h: [.38, .03, .08], yaw: .5, mat: slot("trim") },
        ], capsules: [
          { a: [-.30, .18, -mouthWidth * .53], b: [.22, .18, -mouthWidth * .53], r: .075, mat: slot("rail") },
          { a: [-.30, .18, mouthWidth * .53], b: [.22, .18, mouthWidth * .53], r: .075, mat: slot("rail") },
        ] }, { around: 8, rings: 1 }));
        const yaw = -Math.atan2(ramp.by - ramp.ay, ramp.bx - ramp.ax);
        draws.push({ mesh: mouthKey, matrix: meshMatrix({ x: (ramp.ax + offsetX) * scale, y: ramp.fromElevation * scale, z: (ramp.ay + offsetY) * scale, yaw }), look: look(FIELD_ROLES, rampBiome) });
        draws.push({ mesh: mouthKey, matrix: meshMatrix({ x: (ramp.bx + offsetX) * scale, y: ramp.toElevation * scale, z: (ramp.by + offsetY) * scale, yaw: yaw + (ramp.bidirectional ? Math.PI : 0) }), look: look(FIELD_ROLES, rampBiome) });
      }
      const localBalls = frame.balls.filter(b => b.arenaId === field.id);
      // Stations are part of the shared field. Their bank, launch mouth and
      // copper hinge mounts establish an aim direction at the true coordinates.
      for (const bank of field.stations) {
        if (radiusDistance(localCenterX, localCenterY, [bank.x, bank.y, bank.x, bank.y]) > distance + 180) continue;
        renderScene = sceneAt(field, bank.x, bank.y, bank.layer);
        const key = mesh(`${field.id}/catch-plating/${bank.id}`, () => arenaCatchPlateMesh(field, bank, scale) ?? lookMesh({}));
        draws.push({ mesh: key, matrix: fieldMatrix, look: surfaceLook("pinball-inlay", biomeAt(field, bank.x, bank.y)), seam: 1 });
        if (renderScene?.structure) {
          const sides = mesh(`${field.id}/catch-side-machinery/${bank.id}/${appearanceKey(renderScene.biome)}`, () => arenaCatchSideMachinery(field, bank, scale, renderScene!));
          draws.push({ mesh: bodyCutMesh(sides, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale]), matrix: fieldMatrix, look: look(ARENA_STRUCTURE_ROLES, renderScene.biome, "native-structure"), light: 1.08 });
        }
        if (renderScene?.structure) for (const blade of field.flippers.filter(f => bank.flipperIds.includes(f.id))) {
          const basis = arenaCatchYaw(field, bank), live = frame.flippers.find(f => f.arenaId === field.id && f.id === blade.id), active = live?.ownerId === ownerId;
          for (const pulsing of [false, true]) {
            const housing = mesh(`${field.id}/pivot-housing/${blade.id}/${appearanceKey(biomeAt(field, bank.x, bank.y))}/${pulsing}`, () => arenaPivotHousing(blade, scale, renderScene!, basis, pulsing));
            const signal = pulsing ? arenaLampSignal(renderScene.seed, blade.id, timeMs, options.reducedMotion) * .12 + (active ? .10 : 0) : 0;
            draws.push({ mesh: housing, matrix: fieldMatrix, look: look(ARENA_STRUCTURE_ROLES, biomeAt(field, bank.x, bank.y), "native-structure"), flash: signal, light: active ? 1.12 : .92 });
          }
        }
      }
      for (const partition of physicalByField.get(field.id)!) {
        if (radiusDistance(localCenterX, localCenterY, partition.bounds) > distance + 400) continue;
        const physical = mesh(`${field.id}/physical-grid/${partition.id}`, () => arenaPhysicalMesh(partition, scale));
        const x = (partition.bounds[0] + partition.bounds[2]) * .5, y = (partition.bounds[1] + partition.bounds[3]) * .5;
        renderScene = sceneAt(field, x, y, partition.rails[0]?.layer ?? partition.bumpers[0]?.layer ?? 0);
        draws.push({ mesh: bodyCutMesh(physical, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale]), matrix: fieldMatrix, look: look(FIELD_ROLES, biomeAt(field, x, y)), light: 1.1 });
      }
      for (const chunk of chunks) {
        renderScene = sceneAt(field, (chunk.bounds[0] + chunk.bounds[2]) * .5, (chunk.bounds[1] + chunk.bounds[3]) * .5, chunk.layer);
        chunkCount++;
        for (const item of chunk.instances) {
          if (instances >= instanceBudget) break;
          renderScene = sceneAt(field, item.x, item.y, chunk.layer);
          const record = artOf(item.assetId, item.seed);
          const height = Math.max(0.2, record.built.def.bounds[4]) * item.scale;
          if (height * k < 0.8) continue;
          const dist = Math.hypot(item.x - localCenterX, item.y - localCenterY) * scale;
          if (!overview && dist > distance * scale + height) continue;
          const far = overview || dist > 25;
          const sceneryPriority = arenaSceneryPriority(dist, overview);
          const key = far ? record.far : record.mesh;
          mesh(key, () => builtArtMesh(record.built, far));
          const parts = !far ? foliagePose(record, `${field.id}/${item.id}`, item.x, item.y, item.scale, item.yaw, localBalls.filter(b => b.layer === chunk.layer), timeMs / 1000, dt) ?? rotorPose(record, timeMs / 1000) : undefined;
          const reaction = feedbackFrame.pulses.reduce((amount, pulse) => pulse.arenaId === field.id ? Math.max(amount, pulse.alpha * Math.max(0, 1 - Math.hypot(item.x - pulse.x, item.y - pulse.y) / 420)) : amount, 0);
          const neon = renderScene?.lighting.fixtureAssetIds.includes(item.assetId) ?? false, rhythm = renderScene?.motion;
          const arcadeSignal = neon ? (1 - (rhythm?.blinkDepth ?? .6)) + (rhythm?.blinkDepth ?? .6) * arenaLampSignal(item.seed, item.id, timeMs * 2400 / (rhythm?.blinkPeriodMs ?? 2400), options.reducedMotion ?? false) : 0;
          const paintVariant = Number.parseInt(hashText(`${item.seed}/${item.id}`), 36) % 8;
          const matrix = meshMatrix({ x: (item.x + offsetX) * scale, y: item.z * scale, z: (item.y + offsetY) * scale, yaw: item.yaw, scale: item.scale }), cut = artCutMesh(key, item.id, body?.arenaId === field.id ? apertureBody : null, apertureRadius, matrix, parts);
          if (renderScene.environment?.construction?.mounts.some(m => m.assetId === item.assetId)) for (const pulsing of [false, true]) {
            const mounting = mesh(`${field.id}/environment-mount/${item.id}/${appearanceKey(chunk.biome)}/${pulsing}`, () => arenaEnvironmentMount(field, item, chunk.layer, scale, renderScene!, pulsing));
            draws.push({ mesh: bodyCutMesh(mounting, body?.arenaId === field.id ? apertureBody : null, apertureRadius, [offsetX * scale, offsetY * scale], true, true), matrix: fieldMatrix, look: boundaryLook(chunk.biome), flash: pulsing ? arcadeSignal * .04 * sceneryPriority.signal : 0, light: .94 * sceneryPriority.light });
          }
          draws.push({ mesh: cut ?? key, matrix: cut ? IDENTITY : matrix, look: look(record.built.roles, chunk.biome, `${item.assetId}:${paintVariant}`), flash: (reaction * .10 + arcadeSignal * .075) * sceneryPriority.signal, light: (/stack|furnace|vault/.test(item.assetId) ? .86 : 1) * sceneryPriority.light, ...(!cut && parts ? { parts } : {}) });
          if (item.assetId === "neon-swing-lamp" && lights.length < 10) {
            const index = record.rest.boxes.findIndex(b => b.mat === slotOf(record.built.roles, "core")), lamp = record.rest.boxes[index];
            if (lamp) {
              const x = lamp.c[0]! + (parts?.[index * 16 + 12] ?? 0), y = lamp.c[1]! + (parts?.[index * 16 + 13] ?? 0), z = lamp.c[2]! + (parts?.[index * 16 + 14] ?? 0), co = Math.cos(item.yaw), si = Math.sin(item.yaw);
              lights.push({ pos: [(item.x + offsetX) * scale + (co * x + si * z) * item.scale, item.z * scale + y * item.scale, (item.y + offsetY) * scale + (-si * x + co * z) * item.scale], dir: [0, -1, 0], cone: .55, radius: Math.max(3.2, height * 2.2), intensity: (.36 + arcadeSignal * .72) * (renderScene?.lighting.gain ?? 1) * sceneryPriority.signal, tint: lightTintIds()[1] });
            }
          }
          if (neon && item.assetId !== "neon-swing-lamp" && lights.length < 10) lights.push({ pos: [(item.x + offsetX) * scale, item.z * scale + height * 0.6, (item.y + offsetY) * scale], radius: height * 1.5, intensity: (.18 + arcadeSignal * .26 + reaction * .14) * (renderScene?.lighting.gain ?? 1) * sceneryPriority.signal, tint: lightTintIds()[0] });
          instances++;
        }
      }
      // Dynamic collision surfaces come from the canonical frame, never art pose.
      for (const f of frame.flippers) {
        if (f.arenaId !== field.id) continue;
        renderScene = sceneAt(field, f.pivotX, f.pivotY, f.layer);
        const length = Math.hypot(f.tipX - f.pivotX, f.tipY - f.pivotY), restLength = field.flippers.find(spec => spec.id === f.id)?.length ?? length, key = `flipper:${restLength}:${f.radius}`;
        const rest = { capsules: [{ a: [0, f.radius, 0], b: [restLength, f.radius, 0], r: f.radius, mat: slot("trim") }] };
        mesh(key, () => lookMesh(rest, { around: 8, rings: 1 }));
        const parts = poseMatrices(rest, { capsules: [{ ...rest.capsules[0]!, b: [length, f.radius, 0] }] });
        const activity=arenaActivityWeight(ownerId,body,{ownerId:f.ownerId,arenaId:f.arenaId,x:f.pivotX,y:f.pivotY,elevation:f.elevation}),flipperLook=bladeLook(biomeAt(field,f.pivotX,f.pivotY),!overview&&activity<1);
        draws.push({ mesh: key, matrix: meshMatrix({ x: (f.pivotX + offsetX) * scale, y: f.elevation * scale, z: (f.pivotY + offsetY) * scale, yaw: -Math.atan2(f.tipY - f.pivotY, f.tipX - f.pivotX), scale }), look: flipperLook, parts,owner:f.ownerId>=0?f.ownerId:65535 });
        const hub = mesh(`flipper-hinge:${f.radius}`, () => lookMesh({ capsules: [{ a: [0, f.radius * .55, 0], b: [0, f.radius * 1.1, 0], r: f.radius * .72, mat: slot("steel") }] }, { around: 8, rings: 1 }));
        draws.push({ mesh: hub, matrix: meshMatrix({ x: (f.pivotX + offsetX) * scale, y: f.elevation * scale, z: (f.pivotY + offsetY) * scale, scale }), look: flipperLook });
      }
      for (const gate of field.gates) {
        const gateBiome = biomeAt(field, (gate.ax + gate.bx) * .5, (gate.ay + gate.by) * .5);
        const live = frame.gates.find(g => g.arenaId === field.id && g.id === gate.id), length = Math.hypot(gate.bx - gate.ax, gate.by - gate.ay), key = `gate:${length.toFixed(3)}:${gate.radius}`;
        const required = field.requirements?.find(r => r.gateIds.includes(gate.id));
        const ownerTeam = frame.balls.find(b => b.ownerId === ownerId)?.teamId;
        const participants = required?.scope === "team" ? frame.balls.filter(b => b.teamId === ownerTeam).map(b => b.ownerId) : [ownerId];
        if (gate.kind === "target") {
          const height = Math.max(20, gate.radius * 6), face = mesh(`target-face:${length.toFixed(3)}:${gate.radius}`, () => lookMesh({ boxes: [
            { c: [length * .5, height * .5, 0], h: [length * .5, height * .5, gate.radius], mat: slot("steel") },
            { c: [length * .5, height * .87, 0], h: [length * .46, height * .065, gate.radius], mat: slot("trim") },
            { c: [length * .5, height * .48, -gate.radius * .94], h: [length * .31, height * .22, gate.radius * .06], mat: slot("core") },
          ] }));
          const targetRoutes = field.challenges?.filter(c => c.finalColliderId === gate.id).map(c => c.id) ?? [];
          const completed = frame.routeProgress.some(p => participants.includes(p.ownerId) && p.completed && targetRoutes.includes(p.routeId));
          const impact = frame.events.some(e => e.arenaId === field.id && e.colliderId === gate.id && (e.type === "rail" || e.type === "gate"));
          draws.push({ mesh: face, matrix: meshMatrix({ x: (gate.ax + offsetX) * scale, y: (gate.elevation - (live?.open ? height + gate.radius : 0)) * scale, z: (gate.ay + offsetY) * scale, yaw: -Math.atan2(gate.by - gate.ay, gate.bx - gate.ax), scale }), look: mechanismLook(gateBiome, completed || Boolean(live?.open)), flash: impact ? .13 : 0 });
          continue;
        }
        mesh(key, () => lookMesh({ capsules: [{ a: [0, gate.radius, 0], b: [length, gate.radius, 0], r: gate.radius, mat: slot("steel") }] }, { around: 8, rings: 1 }));
        draws.push({ mesh: key, matrix: meshMatrix({ x: (gate.ax + offsetX) * scale, y: (gate.elevation + (live?.open ? -gate.radius * 3 : 0)) * scale, z: (gate.ay + offsetY) * scale, yaw: -Math.atan2(gate.by - gate.ay, gate.bx - gate.ax), scale }), look: look(FIELD_ROLES, gateBiome) });
        const post = mesh("gate-lock-post", () => lookMesh({ boxes: [{ c: [0, .42, 0], h: [.22, .42, .28], mat: slot("steel") }, { c: [0, .82, 0], h: [.28, .08, .32], mat: slot("trim") }, { c: [0, .48, -.29], h: [.13, .16, .03], mat: slot("core") }] }));
        for (const [x, y] of [[gate.ax, gate.ay], [gate.bx, gate.by]]) draws.push({ mesh: post, matrix: meshMatrix({ x: (x! + offsetX) * scale, y: gate.elevation * scale, z: (y! + offsetY) * scale }), look: mechanismLook(gateBiome, live?.open ?? gate.initiallyOpen) });
        if (required) {
          const routeGroups = required.routeGroups ?? required.routeIds.map(id => [id]);
          const consoleKey = mesh("route-lock-console", () => lookMesh({ boxes: [{ c: [0, .56, 0], h: [.98, .56, .22], mat: slot("steel") }, { c: [0, .64, -.24], h: [.86, .35, .035], mat: slot("dark") }, { c: [0, 1.16, 0], h: [1.08, .06, .28], mat: slot("trim") }] }));
          const lampKey = mesh("route-lock-lamp", () => lookMesh({ boxes: [{ c: [0, 0, 0], h: [.065, .12, .045], mat: slot("core") }] }));
          const dx = gate.bx - gate.ax, dy = gate.by - gate.ay, len = Math.hypot(dx, dy), x = gate.bx - dy / len * 36, y = gate.by + dx / len * 36, yaw = -Math.atan2(dy, dx);
          draws.push({ mesh: consoleKey, matrix: meshMatrix({ x: (x + offsetX) * scale, y: gate.elevation * scale, z: (y + offsetY) * scale, yaw }), look: look(FIELD_ROLES, gateBiome) });
          for (let i = 0; i < routeGroups.length; i++) {
            const completed = frame.routeProgress.some(p => routeGroups[i]!.includes(p.routeId) && p.completed && participants.includes(p.ownerId));
            const along = -.66 + i * 1.32 / Math.max(1, routeGroups.length - 1);
            draws.push({ mesh: lampKey, matrix: meshMatrix({ x: (x + offsetX) * scale + dx / len * along + dy / len * .27, y: gate.elevation * scale + .64, z: (y + offsetY) * scale + dy / len * along - dx / len * .27, yaw }), look: mechanismLook(gateBiome, completed) });
          }
        }
      }
      for (const target of field.switches) {
        const active = frame.switches.find(s => s.arenaId === field.id && s.id === target.id)?.active ?? false;
        const key = mesh(`switch:${target.radius}`, () => arenaIndicatorRing(target.radius * scale, Math.min(.10, target.radius * scale * .2), .055));
        const plate = mesh(`switch-plate:${target.radius}`, () => lookMesh({ boxes: [{ c: [0, .04, 0], h: [target.radius * scale * .53, .035, target.radius * scale * .53], mat: slot("steel") }, { c: [0, .08, 0], h: [target.radius * scale * .28, .018, target.radius * scale * .28], mat: slot("core") }] }));
        const matrix = meshMatrix({ x: (target.x + offsetX) * scale, y: target.elevation * scale, z: (target.y + offsetY) * scale });
        const stateLook = mechanismLook(biomeAt(field, target.x, target.y), active);
        draws.push({ mesh: key, matrix, look: stateLook, light: active ? 1.25 : .85, flash: active ? .13 : 0 }, { mesh: plate, matrix, look: stateLook });
      }
      for (const hazard of field.hazards ?? []) {
        const radius = hazard.radius * scale, key = mesh(`hazard-ring:${hazard.radius}`, () => arenaIndicatorRing(radius, Math.min(.10, radius * .15), .065, "core", 32));
        const matrix = meshMatrix({ x: (hazard.x + offsetX) * scale, y: hazard.elevation * scale, z: (hazard.y + offsetY) * scale });
        const stateLook = hazardLook(biomeAt(field, hazard.x, hazard.y));
        if (hazard.kind === "drain") {
          const aperture = mesh(`drain-aperture:${hazard.radius}`, () => arenaIndicatorRing(radius * .91, radius * .909, .025, "dark", 32));
          draws.push({ mesh: aperture, matrix, look: stateLook, seam: 1 });
        }
        draws.push({ mesh: key, matrix, look: stateLook, seam: 1 });
      }
      // Port marks are flat inlays on the generator's actual supported mouth.
      // Their direction and width come from the admission contract; they add
      // no posts, collision geometry, transport or inferred route completion.
      for (const port of field.pinball?.ports ?? []) {
        if (radiusDistance(localCenterX, localCenterY, [port.x, port.y, port.x, port.y]) > distance + port.clearWidth) continue;
        const returning = port.role === "return-entry" || port.role === "return-exit" || port.role === "release-exit";
        const path = field.pinball?.paths.find(p => p.entryPortId === port.id || p.exitPortId === port.id);
        const family = returning ? "return" : path?.role ?? port.role;
        const completed = port.qualificationId !== undefined && frame.routeProgress.some(p => p.ownerId === ownerId && p.routeId === port.qualificationId && p.completed);
        const mouthWidth = port.clearWidth * scale, key = mesh(`port-inlay:${port.clearWidth}:${returning ? 1 : 0}`, () => {
          const half = mouthWidth * .40, arrow = Math.min(.48, mouthWidth * .24);
          return lookMesh({ boxes: [
            { c: [0, .018, -half], h: [.34, .012, .055], mat: slot("trim") },
            { c: [0, .018, half], h: [.34, .012, .055], mat: slot("trim") },
            { c: [-.20, .018, -arrow * .36], h: [arrow * .57, .012, .04], yaw: -.58, mat: slot("core") },
            { c: [-.20, .018, arrow * .36], h: [arrow * .57, .012, .04], yaw: .58, mat: slot("core") },
          ] });
        });
        draws.push({ mesh: key, matrix: meshMatrix({ x: (port.x + offsetX) * scale, y: port.elevation * scale, z: (port.y + offsetY) * scale, yaw: -Math.atan2(port.tangent.y, port.tangent.x) }), look: portLook(family, biomeAt(field, port.x, port.y), completed), seam: 1 });
        if (port.role === "shooter-entry") {
          const launcher = mesh(`shooter-mechanism:${port.clearWidth}`, () => arenaShooterMesh(mouthWidth));
          const pose = mechanismPoses.get(port.receiverCatchId ?? port.mechanismId);
          draws.push({ mesh: launcher, matrix: meshMatrix({ x: (port.x + offsetX) * scale, y: port.elevation * scale, z: (port.y + offsetY) * scale, yaw: -Math.atan2(port.tangent.y, port.tangent.x) }), parts: arenaShooterPose(mouthWidth, pose?.recoil ?? 0), look: portLook("shooter", biomeAt(field, port.x, port.y), false), flash: (pose?.pulse ?? 0) * .06 });
        }
      }
      // Every capture mouth belongs to an admitted controller and real entry/
      // release ports. Lamps report its actual phase; no generic disc claims a
      // capture, tunnel, release or gate pose.
      for (const capture of field.captures ?? []) {
        const port = field.pinball?.ports.find(p => p.id === capture.entryPortId);
        if (!port || radiusDistance(localCenterX, localCenterY, [port.x, port.y, port.x, port.y]) > distance + port.clearWidth) continue;
        const live = frame.captures.find(c => c.arenaId === field.id && c.id === capture.id), pose = mechanismPoses.get(capture.id), radius = port.clearWidth * scale * .5;
        const cue = arenaCaptureCue(world, field, capture, frame);
        const aperture = mesh("capture-mouth-aperture", () => arenaIndicatorRing(1, .998, .012, "dark", 24));
        const rim = mesh("capture-mouth-rim", () => arenaIndicatorRing(1, .09, .035, "steel", 24));
        const signal = mesh("capture-mouth-signal", () => arenaIndicatorRing(1, .045, .065, "core", 24));
        const matrix = meshMatrix({ x: (port.x + offsetX) * scale, y: port.elevation * scale, z: (port.y + offsetY) * scale, scale: radius });
        const active = live?.enabled ?? false, occupied = (live?.occupiedBodyId ?? null) !== null, biome = biomeAt(field, port.x, port.y);
        draws.push({ mesh: aperture, matrix, look: look(FIELD_ROLES, biome), seam: 1 }, { mesh: rim, matrix, look: look(FIELD_ROLES, biome) }, { mesh: signal, matrix, look: cue ? captureLook(biome, cue.phase) : mechanismLook(biome, active), flash: (pose?.pulse ?? 0) * .08 });
        if (occupied && cue) {
          const stateLook = captureLook(biome, cue.phase);
          const readout = mesh(`capture-readout:${cue.label}:${cue.locationLabel}`, () => arenaCaptureReadoutMesh(cue.label, cue.locationLabel));
          // Fixed beside the mouth in world units. This shallow case never
          // covers the aperture; static words distinguish all three phases
          // even under reduced motion or at an identical progress fraction.
          const mouthX = (port.x + offsetX) * scale, mouthZ = (port.y + offsetY) * scale, readoutX = mouthX + view.right[0] * (radius + 2.92), readoutZ = mouthZ + view.right[2] * (radius + 2.92);
          draws.push({ mesh: readout, matrix: meshMatrix({ x: readoutX, y: port.elevation * scale + .02, z: readoutZ, yaw }), look: stateLook, seam: 1 });
          const compass = mesh(`capture-destination-locator:${cue.local ? "local" : "remote"}`, () => arenaCaptureLocatorMesh(!cue.local));
          const compassX = mouthX - view.right[0] * (radius + 1.05), compassZ = mouthZ - view.right[2] * (radius + 1.05);
          const compassRing = mesh("capture-destination-compass", () => arenaIndicatorRing(.76, .04, .035, "steel", 24));
          draws.push({ mesh: compassRing, matrix: meshMatrix({ x: compassX, y: port.elevation * scale, z: compassZ }), look: stateLook },
            { mesh: compass, matrix: meshMatrix({ x: compassX, y: port.elevation * scale, z: compassZ, yaw: -(cue.bearing ?? 0) }), look: stateLook });
          const lamp = mesh("capture-progress-lamp", () => lookMesh({ boxes: [{ c: [0, .02, 0], h: [.065, .015, .035], mat: slot("core") }] }));
          for (let i = 0; i < 8; i++) {
            const reached = i < Math.floor(cue.progress * 8);
            const along = -2.10 + i * .60;
            draws.push({ mesh: lamp, matrix: meshMatrix({ x: readoutX + Math.cos(yaw) * along - Math.sin(yaw) * .91, y: port.elevation * scale + .11, z: readoutZ - Math.sin(yaw) * along - Math.cos(yaw) * .91, yaw, scale: 2.2 }), look: reached ? stateLook : mechanismLook(biome, false) });
          }
          const exit = cue.destination;
          if (cue.local && radiusDistance(localCenterX, localCenterY, [exit.x, exit.y, exit.x, exit.y]) < distance + exit.clearWidth) {
            draws.push({ mesh: signal, matrix: meshMatrix({ x: (exit.x + offsetX) * scale, y: exit.elevation * scale, z: (exit.y + offsetY) * scale, scale: exit.clearWidth * scale * .5 }), look: captureLook(biomeAt(field, exit.x, exit.y), cue.phase) },
              { mesh: compass, matrix: meshMatrix({ x: (exit.x + offsetX) * scale, y: exit.elevation * scale + .03, z: (exit.y + offsetY) * scale, yaw: -Math.atan2(exit.tangent.y, exit.tangent.x) }), look: stateLook });
          }
        }
      }
      for (const challenge of field.challenges ?? []) {
        const progress = frame.routeProgress.find(p => p.ownerId === ownerId && p.routeId === challenge.id);
        const entryPort = field.pinball?.ports.find(p => p.qualificationId === challenge.id && (p.role === "shot-entry" || p.role === "shooter-entry"));
        const family = field.pinball?.paths.find(p => p.entryPortId === entryPort?.id)?.role ?? "route";
        for (let i = 0; i < challenge.checkpoints.length; i++) {
          const checkpoint = challenge.checkpoints[i]!;
          if (radiusDistance(localCenterX, localCenterY, [checkpoint.x, checkpoint.y, checkpoint.x, checkpoint.y]) > distance + checkpoint.radius) continue;
          const reached = progress?.completed || (progress?.nextCheckpoint ?? 0) > i, next = !progress?.completed && (progress?.nextCheckpoint ?? 0) === i;
          if (!next && !reached) continue;
          // Checkpoints are admission volumes, not physical circular targets.
          // A bounded route lamp marks real progress at the canonical location.
          const marker = Math.min(.55, checkpoint.radius * scale * .18), key = mesh(`route-progress-marker:${marker}`, () => lookMesh({ boxes: [
            { c: [0, .035, 0], h: [marker * .65, .025, marker * .45], mat: slot("dark") },
            { c: [-marker * .10, .075, -marker * .15], h: [marker * .40, .015, .035], yaw: -.6, mat: slot("core") },
            { c: [-marker * .10, .075, marker * .15], h: [marker * .40, .015, .035], yaw: .6, mat: slot("core") },
          ] }));
          const tangent = entryPort?.tangent ?? { x: 1, y: 0 };
          draws.push({ mesh: key, matrix: meshMatrix({ x: (checkpoint.x + offsetX) * scale, y: checkpoint.elevation * scale, z: (checkpoint.y + offsetY) * scale, yaw: -Math.atan2(tangent.y, tangent.x) }), look: portLook(family, biomeAt(field, checkpoint.x, checkpoint.y), Boolean(reached)), flash: next && !options.reducedMotion ? (Math.sin(timeMs * .003) + 1) * .035 : 0 });
        }
      }
      for (const pulse of pulses.values()) {
        if (pulse.arenaId !== field.id) continue;
        const age = Math.max(0, Math.min(1, (timeMs - pulse.born) / 420)), radius = pulse.radius * scale * (options.reducedMotion ? 1 : .18 + age * .82);
        const key = mesh("combat-pulse", () => arenaIndicatorRing(1, .035, .015, "core", 32));
        const team = frame.balls.find(b => b.ownerId === pulse.ownerId)?.teamId ?? 0;
        draws.push({ mesh: key, matrix: meshMatrix({ x: (pulse.x + offsetX) * scale, y: pulse.elevation * scale + .045, z: (pulse.y + offsetY) * scale, scale: radius }), look: ballLook(team, pulse.ownerId === ownerId), owner: pulse.ownerId, fade: (1-age)*arenaActivityWeight(ownerId,body,pulse), seam: 1 });
      }
      if (frame.storm.active && frame.storm.arenaId === field.id) {
        const key = mesh("storm-boundary", () => arenaIndicatorRing(1, .003, .0005, "core", 96));
        draws.push({ mesh: key, matrix: meshMatrix({ x: (frame.storm.x + offsetX) * scale, z: (frame.storm.y + offsetY) * scale, scale: frame.storm.radius * scale }), look: mechanismLook(field.regions[0]?.biome ?? GARDEN, false), seam: 1 });
      }
      for (const portal of field.portals) {
        const portalBiome = biomeAt(field, portal.x, portal.y);
        const enabled = frame.portals.find(p => p.arenaId === field.id && p.id === portal.id)?.enabled ?? true;
        const record = artOf("portal-frame", portal.id); mesh(record.mesh, () => builtArtMesh(record.built));
        draws.push({ mesh: record.mesh, matrix: meshMatrix({ x: (portal.x + offsetX) * scale, y: portal.elevation * scale, z: (portal.y + offsetY) * scale, yaw: portal.angle * Math.PI / 180, scale: portal.radius * scale / 1.8 }), look: look(record.built.roles, portalBiome, "portal-frame"), light: enabled ? 1.1 : 0.55 });
        const mouth = mesh("portal-capture-lamp", () => arenaIndicatorRing(1, .07, .045));
        draws.push({ mesh: mouth, matrix: meshMatrix({ x: (portal.x + offsetX) * scale, y: portal.elevation * scale, z: (portal.y + offsetY) * scale, scale: portal.radius * scale }), look: mechanismLook(portalBiome, enabled) });
      }
      const visibleBodies = localBalls.filter(b => !b.eliminated && b.transport === null).map(b => ({ point: view!.project([(b.x + offsetX) * scale, (b.elevation + b.radius) * scale, (b.y + offsetY) * scale]), radius: b.radius * scale * k * 1.7 }));
      for (const particle of feedbackFrame.particles) {
        if (particle.arenaId !== field.id || radiusDistance(localCenterX, localCenterY, [particle.x, particle.y, particle.x, particle.y]) > distance) continue;
        const point = view.project([(particle.x + offsetX) * scale, particle.elevation * scale + .045, (particle.y + offsetY) * scale]);
        if (visibleBodies.some(b => Math.hypot(b.point[0] - point[0], b.point[1] - point[1]) < b.radius + particle.size * scale * k * 1.75)) continue;
        const key = mesh("mechanism-event-particle", () => lookMesh({ boxes: [{ c: [0, 0, 0], h: [1, 1, 1], mat: slot("core") }] }));
        const size = particle.size * scale;
        draws.push({ mesh: key, matrix: meshMatrix({ x: (particle.x + offsetX) * scale, y: particle.elevation * scale + .045, z: (particle.y + offsetY) * scale, scale: size }), look: mechanismLook(biomeAt(field, particle.x, particle.y), particle.kind !== "mist"), fade: particle.alpha * .7*arenaActivityWeight(ownerId,body,particle) });
      }
      for (const pulse of feedbackFrame.pulses) {
        if (pulse.arenaId !== field.id || radiusDistance(localCenterX, localCenterY, [pulse.x, pulse.y, pulse.x, pulse.y]) > distance) continue;
        const point = view.project([(pulse.x + offsetX) * scale, pulse.elevation * scale + .035, (pulse.y + offsetY) * scale]);
        if (visibleBodies.some(b => Math.hypot(b.point[0] - point[0], b.point[1] - point[1]) < b.radius + pulse.radius * scale * k)) continue;
        const key = mesh("mechanism-event-pulse", () => arenaIndicatorRing(1, .035, .005, "core", 24));
        draws.push({ mesh: key, matrix: meshMatrix({ x: (pulse.x + offsetX) * scale, y: pulse.elevation * scale + .035, z: (pulse.y + offsetY) * scale, scale: pulse.radius * scale }), look: mechanismLook(biomeAt(field, pulse.x, pulse.y), pulse.kind !== "mist"), fade: pulse.alpha * .55*arenaActivityWeight(ownerId,body,pulse), seam: 1 });
      }
      for (const ball of localBalls) {
        if (ball.eliminated || ball.transport !== null) continue;
        const visual = bodyVisuals.get(ball.ownerId);
        const key = visual ? mesh(visual.meshId, () => visual.mesh) : mesh(ARENA_BODY_MESH_ID, () => lookMesh({ capsules: [{ a: [0, 0, 0], b: [0, 0, 0], r: 1, mat: slot("ball") }] }, { around: 12, rings: 3 }));
        const activity=arenaActivityWeight(ownerId,body,ball);
        let bodyLook: number;
        if (visual) { let value = looks.get(visual.meshId); if (value === undefined) { value = table.add(visual.paint); looks.set(visual.meshId, value); dirtyLooks = true; } bodyLook = value; }
        else bodyLook = ballLook(ball.teamId, ball.ownerId === ownerId,!overview&&activity<1);
        draws.push({ mesh: key, matrix: meshMatrix({ x: (ball.x + offsetX) * scale, y: (ball.elevation + ball.radius) * scale, z: (ball.y + offsetY) * scale, scale: ball.radius * scale }), look: bodyLook, ...(visual ? { light: ball.ownerId === ownerId ? 1.15 : !overview && activity < 1 ? .78 : 1 } : {}), owner: ball.ownerId, flash: ball.shieldTicks > 0 ? 0.15*activity : 0 });
        if (ball.ownerId === ownerId && !overview) {
          const beacon = mesh("owned-ball-beacon", () => {
            const capsules = [];
            for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, b = (i + .72) / 12 * Math.PI * 2; capsules.push({ a: [Math.cos(a) * 1.85, .04, Math.sin(a) * 1.85], b: [Math.cos(b) * 1.85, .04, Math.sin(b) * 1.85], r: .085, mat: slot("core") }); }
            return lookMesh({ capsules }, { around: 6, rings: 1 });
          });
          draws.push({ mesh: beacon, matrix: meshMatrix({ x: (ball.x + offsetX) * scale, y: ball.elevation * scale + .045, z: (ball.y + offsetY) * scale, yaw: options.reducedMotion ? 0 : timeMs * .0003, scale: ball.radius * scale }), look: ballLook(ball.teamId, true), seam: 1 });
        }
        if (ball.ownerId === ownerId) lights.push({ pos: [(ball.x + offsetX) * scale, (ball.elevation + ball.radius * 3) * scale, (ball.y + offsetY) * scale], radius: 2.4, intensity: 0.28, owner: ball.ownerId });
      }
      }
      if (global) for (const link of world.links) {
        const a = world.arenas.find(f => f.id === link.a), b = world.arenas.find(f => f.id === link.b);
        const pa = a?.portals.find(p => p.id === link.portalA), pb = b?.portals.find(p => p.id === link.portalB);
        if (!a || !b || !pa || !pb) continue;
        const oa = offsets.get(a.id)!, ob = offsets.get(b.id)!;
        const key = mesh(`map-link:${link.id}`, () => lookMesh({ capsules: [{ a: [(pa.x + oa[0]) * scale, 0.12, (pa.y + oa[1]) * scale], b: [(pb.x + ob[0]) * scale, 0.12, (pb.y + ob[1]) * scale], r: 0.12, mat: slot("core") }] }, { around: 6, rings: 1 }));
        draws.push({ mesh: key, matrix: IDENTITY, look: look(FIELD_ROLES, GARDEN), light: 1.2, seam: 1 });
      }
      const activeScene = body && selectedField.id === body.arenaId ? sceneAt(selectedField, body.x, body.y, body.layer, body.regionId) : sceneByField.get(selectedField.id)!;
      const targetStyle: MeshStyle = { clear: activeScene.environment?.clear ?? [0.065, 0.075, 0.12], screen: style === "dither" ? 8 : style === "arcade" ? 4 : 0, dither: style === "dither" ? .90 : style === "pixel" ? 0 : style === "realistic" ? .15 : .22, outline: style === "cartoon" ? 2 : style === "realistic" ? 0 : 1, ambient: .30, sun: [-0.5, 0.9, -0.35], shadows: { strength: style === "realistic" ? 0.72 : 0.60, size: options.density === "low" ? 512 : 1024 }, lights, bloom: style === "arcade" ? 4 : 2, mirror: style === "realistic" ? 120 : 0, time: options.reducedMotion ? 0 : timeMs / 1000, ...(style === "cartoon" ? { filter: "toon" } : style === "arcade" ? { filter: "soft" } : {}) };
      const litStyle = { ...targetStyle, tints: lightTints };
      flushLooks(); sr.drawMeshes(view, draws, options.onMeshFrame ? { ...litStyle, after: options.onMeshFrame } : litStyle); prune();
    },
    project(x, y, elevation = 0, arenaId) { const offset = arenaId ? projectionOffsets.get(arenaId) : undefined; return view && world ? view.project([(x + (offset?.[0] ?? projectedOffsetX)) * world.unitScale, elevation * world.unitScale, (y + (offset?.[1] ?? projectedOffsetY)) * world.unitScale]) : null; },
    bodyMeshId(ownerId) { return bodyVisuals.get(ownerId)?.meshId ?? ARENA_BODY_MESH_ID; },
    inputSideMapping(frame, ownerId = options.ownerId ?? 0) {
      if (!view || !world) return null;
      const body = frame.balls.find(b => b.ownerId === ownerId && !b.eliminated && b.transport === null), field = body && world.arenas.find(a => a.id === body.arenaId);
      const bank = field?.stations.find(s => s.id === body?.stationId); if (!field || !bank) return null;
      const blades = field.flippers.filter(f => bank.flipperIds.includes(f.id)); if (blades.length !== 2 || !blades.some(f => f.side === "left") || !blades.some(f => f.side === "right")) return null;
      const projected = blades.map(f => ({ f, p: api.project(f.pivotX, f.pivotY, f.elevation, field.id)! })).sort((a, b) => a.p[0] - b.p[0]);
      if (Math.abs(projected[0]!.p[0] - projected[1]!.p[0]) < .01) return null;
      return { arenaId: field.id, stationId: bank.id, left: projected[0]!.f.side, right: projected[1]!.f.side, leftFlipperId: projected[0]!.f.id, rightFlipperId: projected[1]!.f.id };
    },
    getStats() { const stats = sr.meshStats; return { cachedMeshes: meshes.size, meshBytes, chunks: chunkCount, drawn: stats.drawn, culled: stats.culled, triangles: stats.triangles, shadowDrawn: stats.shadowDrawn, shadowTriangles: stats.shadowTriangles, movingFoliage: moving, width: W, height: H, backend: "keel-live-mesh" }; },
    dispose() { if (disposed) return; clear(); flushLooks(); world = null; disposed = true; },
  };
  api.resize(W, H); return api;
}
