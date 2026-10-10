import { createRoll, deriveSeed, normalizeSeed } from "@keel-engine/core/rng";
import { sha256, toHex } from "@keel-engine/codec/hash";
import { ARENA_CONTENT_LIMITS } from "@keel-engine/pinball-arena";

/** This script requests physical assemblies. It is deliberately not an ArenaWorld:
 * a compiler must build and qualify every mouth, connection, gate and recovery. */
export const ARCADE_SCRIPT_REVISION = "pinball-arcade-script/2026-10-07.1";
export type ArcadeTopology = "forked-caverns" | "braided-terraces" | "loop-manifold";
export type ArcadeAssemblyFamily = "fork-basin" | "terrace-switchback" | "loop-gallery" | "vault-reservoir" | "encounter-crucible";
export type ArcadeShotFamily = "ground-orbit" | "elevated-cross-return" | "target-to-scoop" | "lock-release" | "countershot";
export type ArcadeTheme = "cyber" | "gold" | "vapor" | "nature" | "nightshift";
export type ArcadeCapability = "paired-catch" | "ground-orbit" | "sloped-track" | "compound-gate" | "localized-flow" | "guided-junction" | "physical-hazard" | "target-contact" | "canonical-capture" | "encounter-state";
type Point = { readonly x: number; readonly y: number };
export interface ArcadePortPlan {
  readonly id: string; readonly role: "shot" | "return" | "arrival" | "shooter" | "locked-branch";
  readonly family: ArcadeShotFamily | "travel";
  /** Desired mouth pose, not an admitted trajectory. Compiler rebinding needs a new script identity. */
  readonly position: Point; readonly tangent: Point; readonly layer: number; readonly elevation: number;
  readonly clearWidth: number; readonly receiverBank: number;
}
export interface ArcadeMechanismVisualPlan {
  readonly id: string; readonly sourcePortId: string;
  readonly form: "plunger" | "gate-throat" | "target-bank" | "scoop-ring" | "lock-cradle" | "countershot-emitter";
  readonly motionSource: "accepted-event-recoil" | "canonical-gate-pose" | "canonical-capture-pose";
  /** Requested physical-unit inner housing envelope in the mouth tangent basis.
   * Compiler must bind and reserve it against the actual mechanism bounds. */
  readonly innerMovementFootprint: {
    readonly minAlong: number; readonly maxAlong: number; readonly minAcross: number;
    readonly maxAcross: number; readonly minElevation: number; readonly maxElevation: number;
  };
  readonly requireCompiledBounds: true; readonly protectedBodySightline: true;
}
export interface ArcadeShotPlan {
  readonly id: string; readonly family: ArcadeShotFamily; readonly entryPortId: string;
  /** Several local intakes may merge into one actual upper assembly, preserving shared play. */
  readonly sharedRouteId: string;
  readonly recoveryPortId: string; readonly sourceBanks: readonly number[];
  readonly crestLayer: number; readonly crestElevation: number;
  readonly direction: "clockwise" | "counterclockwise"; readonly bendCount: number;
  readonly returnSide: "same" | "opposite"; readonly intakeWidth: number;
}
export interface ArcadeAssemblyPlan {
  readonly id: string; readonly seed: string; readonly family: ArcadeAssemblyFamily;
  readonly origin: Point; readonly quarterTurns: 0 | 1 | 2 | 3;
  readonly layer: number; readonly elevation: number; readonly bankCount: number;
  readonly banks: readonly { readonly index: number; readonly center: Point; readonly tangent: Point; readonly launchOwnerId: number | null }[];
  readonly launchOwners: readonly number[]; readonly commonShotField: true;
  readonly physics: {
    readonly arenaGravity: Point; readonly localDown: Point; readonly downwardForce: .04;
    readonly flowCoverage: "compiled-support-and-catch";
    readonly conflictingFlowOverlap: "reject";
  };
  readonly silhouette: {
    readonly width: number; readonly height: number; readonly lobes: number;
    readonly leftShoulder: number; readonly rightShoulder: number;
    readonly neckFraction: number; readonly tierCount: number; readonly tierRise: number;
    readonly centralVoid: "none" | "ravine" | "reservoir";
    /** Missing layer0 art is not a physical hole in the current authority. */
    readonly voidPhysics: "none" | "admitted-hazard";
  };
  readonly shots: readonly ArcadeShotPlan[]; readonly ports: readonly ArcadePortPlan[];
  readonly mechanisms: readonly ("shooter" | "target-bank" | "compound-throat" | "scoop" | "ball-lock" | "counterable-threat")[];
  readonly mechanismVisuals: readonly ArcadeMechanismVisualPlan[];
  readonly requiredCapabilities: readonly ArcadeCapability[];
  readonly framing: {
    readonly theme: ArcadeTheme; readonly transitionTheme: ArcadeTheme;
    readonly plants: "exterior-reserved"; readonly corridorMargin: number;
    readonly protectedCatchSightlines: true; readonly deck: "wireform";
  };
}
export interface ArcadeConnectionPlan {
  readonly id: string; readonly fromAssembly: string; readonly fromPort: string;
  readonly toAssembly: string; readonly toPort: string;
  readonly kind: "guided-track" | "ramp" | "captured-transit";
  readonly curve: "cubic-bezier";
  /** A proposed continuous route shape. Geometry and actual input admission remain compulsory. */
  readonly controls: readonly Point[]; readonly clearWidth: number;
  readonly lockedBy: readonly string[]; readonly escape: boolean;
}
export interface ArcadeJunctionPlan {
  readonly id: string; readonly assemblyId: string; readonly incomingPortId: string;
  readonly outgoingConnectionIds: readonly string[];
  readonly kind: "open-fork"; readonly selection: "physical-shot-angle";
  readonly minimumClearWidth: number; readonly requireSupportedCommonApron: true;
  readonly requireDistinctLegalChoices: true; readonly prohibitOverlaidGuidePairs: true;
}
export interface ArcadeRequirementPlan {
  readonly id: string; readonly assemblyId: string; readonly gateId: string;
  readonly routeGroups: readonly (readonly string[])[];
  readonly scope: "owner" | "team"; readonly persistent: true; readonly holdTicks: number;
}
export interface ArcadeScript {
  readonly schema: "keel-pinball-arcade-script@1"; readonly revision: string;
  readonly seed: string; readonly attempt: number; readonly topology: ArcadeTopology;
  readonly state: "uncompiled"; readonly players: number;
  readonly spawnAssemblyIds: readonly string[]; readonly goalAssemblyId: string;
  readonly assemblies: readonly ArcadeAssemblyPlan[]; readonly connections: readonly ArcadeConnectionPlan[];
  readonly junctions: readonly ArcadeJunctionPlan[];
  readonly requirements: readonly ArcadeRequirementPlan[];
  readonly admission: {
    readonly minimumAdjacentStarts: 8; readonly ticksPerSecond: 120;
    readonly requireFullRecovery: true; readonly requireShooterCounterfactual: true;
    readonly requireWideTallVisibility: true; readonly prohibitPrivateSpawnWalls: true;
    readonly exactGlobalBudgetRequired: true;
  };
  readonly structuralSignature: string; readonly canonical: string; readonly sha256: string;
}
export interface ArcadeScriptOptions {
  readonly attempt?: number; readonly players?: number; readonly teamSize?: number;
  readonly topology?: ArcadeTopology; readonly assemblyCount?: number;
  /** Pending capture/combat families are explicit requests, never decorative emulation. */
  readonly includePendingMechanisms?: boolean;
}
export interface ArcadeScriptIssue { readonly code: string; readonly id: string; readonly detail: string }

const TOPOLOGIES = ["forked-caverns", "braided-terraces", "loop-manifold"] as const;
const BASE_FAMILIES = ["fork-basin", "terrace-switchback", "loop-gallery"] as const;
const THEMES = ["cyber", "gold", "vapor", "nature", "nightshift"] as const;
/** Bind planned heights to the actual authority's public descriptor budget. */
export const ARCADE_MAX_ELEVATION = ARENA_CONTENT_LIMITS.elevation;
const q = (n: number): number => Math.round(n * 1024) / 1024;
const digest = (value: unknown): string => toHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
function rotate(p: Point, turns: number): Point {
  return turns === 1 ? { x: -p.y, y: p.x } : turns === 2 ? { x: -p.x, y: -p.y } : turns === 3 ? { x: p.y, y: -p.x } : p;
}
function finiteInteger(value: number, low: number, high: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new RangeError(`${name} must be ${low}..${high}.`);
  return value;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}

function assembly(seed: string, index: number, family: ArcadeAssemblyFamily, origin: Point, layer: number, elevation: number, owners: readonly number[]): ArcadeAssemblyPlan {
  const id = `assembly.${index}`, localSeed = deriveSeed(seed, `assembly:${index}`), roll = createRoll(localSeed);
  const banks = owners.length || 1 + roll.index(21, 2), turns = roll.index(22, 4) as 0 | 1 | 2 | 3;
  // Catch dimensions remain a solver concern. Shared-field extent grows for
  // multiple banks, rather than putting a wall around each participant.
  const width = Math.max(1100 + roll.range(23, 0, 420), 600 + banks * 480), height = 1300 + roll.range(24, 0, 900);
  const tierCount = Math.min(ARENA_CONTENT_LIMITS.layers - layer, family === "terrace-switchback" ? 2 + roll.index(25, 2) : family === "loop-gallery" ? 2 : 1);
  const maximumRise = Math.min(144, Math.floor((ARCADE_MAX_ELEVATION - elevation) / Math.max(1, tierCount - 1)));
  const rise = roll.range(26, 80, maximumRise), left = .30 + roll.range(27, 0, 16) / 100, right = .50 + roll.range(28, 0, 16) / 100;
  const world = (p: Point): Point => { const r = rotate(p, turns); return { x: q(origin.x + r.x), y: q(origin.y + r.y) }; };
  const direction = (p: Point): Point => rotate(p, turns);
  const ports: ArcadePortPlan[] = [];
  const addPort = (name: string, role: ArcadePortPlan["role"], family: ArcadePortPlan["family"], p: Point, tangent: Point, upper = false, receiverBank = 0): string => {
    const portId = `${id}.${name}`;
    ports.push({ id: portId, role, family, position: world(p), tangent: direction(tangent), layer: layer + Number(upper), elevation: elevation + (upper ? rise : 0), clearWidth: family === "ground-orbit" ? 100 : 76, receiverBank });
    return portId;
  };
  const bankRequests = Array.from({ length: banks }, (_, i) => ({ index: i, center: world({ x: (i - (banks - 1) / 2) * 480, y: 0 }), tangent: direction({ x: 0, y: 1 }), launchOwnerId: owners[i] ?? null }));
  const shots: ArcadeShotPlan[] = [];
  const families: ArcadeShotFamily[] = ["ground-orbit", "elevated-cross-return"];
  if (family === "vault-reservoir") families.push("target-to-scoop", "lock-release");
  if (family === "encounter-crucible") families.push("countershot");
  for (let bank = 0; bank < banks; bank++) for (const [i, shotFamily] of families.entries()) {
    const upper = shotFamily === "elevated-cross-return", side = i % 2 ? 1 : -1;
    const bankX = (bank - (banks - 1) / 2) * 480;
    const returnSide = roll.chance(60 + i, 1, 2) ? "same" : "opposite";
    const entryPortId = addPort(`bank.${bank}.shot.${i}.entry`, "shot", shotFamily, { x: bankX + side * (160 + roll.range(40 + i, 0, 50)), y: 360 + i * 45 }, { x: 0, y: 1 }, false, bank);
    const recoveryPortId = addPort(`bank.${bank}.shot.${i}.return`, "return", shotFamily, { x: bankX + side * (returnSide === "same" ? 160 : -160), y: 140 }, { x: 0, y: -1 }, false, bank);
    shots.push({ id: `${id}.bank.${bank}.route.${i}`, sharedRouteId: `${id}.upper.${shotFamily}`, family: shotFamily, entryPortId, recoveryPortId, sourceBanks: [bank], crestLayer: layer + Number(upper), crestElevation: elevation + (upper ? rise : 0), direction: roll.chance(50 + i, 1, 2) ? "clockwise" : "counterclockwise", bendCount: 3 + roll.index(55 + i, 5), returnSide, intakeWidth: 100 + roll.range(65 + i, 0, 80) });
  }
  addPort("arrival", "arrival", "travel", { x: -width * .38, y: height * .08 }, { x: 1, y: 0 });
  addPort("travel", "shot", "travel", { x: width * .38, y: height * .58 }, { x: 1, y: 0 });
  addPort("escape", "return", "travel", { x: width * .35, y: height * .12 }, { x: 1, y: 0 });
  addPort("branch", "locked-branch", "travel", { x: -width * .35, y: height * .74 }, { x: -1, y: 0 }, family === "terrace-switchback");
  if (owners.length) addPort("shooter", "shooter", "travel", { x: width * .43, y: 0 }, { x: 0, y: 1 });
  const mechanisms: ArcadeAssemblyPlan["mechanisms"][number][] = ["compound-throat"];
  if (owners.length) mechanisms.push("shooter");
  const capabilities: ArcadeCapability[] = ["paired-catch", "ground-orbit", "sloped-track", "compound-gate", "localized-flow"];
  if (family === "fork-basin" || family === "loop-gallery") capabilities.push("physical-hazard");
  if (family === "vault-reservoir") { mechanisms.push("target-bank", "scoop", "ball-lock"); capabilities.push("target-contact", "canonical-capture"); }
  if (family === "encounter-crucible") { mechanisms.push("target-bank", "counterable-threat"); capabilities.push("target-contact", "encounter-state"); }
  const visual = (form: ArcadeMechanismVisualPlan["form"], port: ArcadePortPlan, motionSource: ArcadeMechanismVisualPlan["motionSource"]): ArcadeMechanismVisualPlan => ({ id: `${id}.mechanism.${form}`, sourcePortId: port.id, form, motionSource, innerMovementFootprint: form === "plunger" ? { minAlong: -32, maxAlong: -4, minAcross: -port.clearWidth * .24, maxAcross: port.clearWidth * .24, minElevation: 0, maxElevation: 8 } : { minAlong: -4, maxAlong: 4, minAcross: -port.clearWidth * .4, maxAcross: port.clearWidth * .4, minElevation: 0, maxElevation: 8 }, requireCompiledBounds: true, protectedBodySightline: true });
  const mechanismVisuals: ArcadeMechanismVisualPlan[] = [visual("gate-throat", ports.find(p => p.role === "locked-branch")!, "canonical-gate-pose")];
  if (owners.length) mechanismVisuals.push(visual("plunger", ports.find(p => p.role === "shooter")!, "accepted-event-recoil"));
  if (family === "vault-reservoir") { const port = ports.find(p => p.family === "target-to-scoop" && p.role === "shot")!; mechanismVisuals.push(visual("target-bank", port, "accepted-event-recoil"), visual("scoop-ring", port, "canonical-capture-pose"), visual("lock-cradle", ports.find(p => p.family === "lock-release" && p.role === "shot")!, "canonical-capture-pose")); }
  if (family === "encounter-crucible") mechanismVisuals.push(visual("countershot-emitter", ports.find(p => p.family === "countershot" && p.role === "shot")!, "accepted-event-recoil"));
  const theme = roll.pick(90, THEMES), transitionTheme = THEMES[(THEMES.indexOf(theme) + 1 + roll.index(91, THEMES.length - 1)) % THEMES.length]!;
  return {
    id, seed: localSeed, family, origin, quarterTurns: turns, layer, elevation, bankCount: banks, banks: bankRequests, launchOwners: owners, commonShotField: true,
    physics: { arenaGravity: { x: 0, y: 0 }, localDown: direction({ x: 0, y: -1 }), downwardForce: .04, flowCoverage: "compiled-support-and-catch", conflictingFlowOverlap: "reject" },
    silhouette: { width, height, lobes: family === "fork-basin" ? 2 + roll.index(92, 3) : family === "loop-gallery" ? 3 + roll.index(93, 3) : 2, leftShoulder: left, rightShoulder: right, neckFraction: .22 + roll.range(94, 0, 16) / 100, tierCount, tierRise: rise, centralVoid: family === "loop-gallery" ? "reservoir" : family === "fork-basin" ? "ravine" : "none", voidPhysics: family === "loop-gallery" || family === "fork-basin" ? "admitted-hazard" : "none" },
    shots, ports, mechanisms, mechanismVisuals, requiredCapabilities: capabilities,
    framing: { theme, transitionTheme, plants: "exterior-reserved", corridorMargin: 48, protectedCatchSightlines: true, deck: "wireform" },
  };
}

/** Seed changes branch/cycle structure, chamber roles, tier distribution and
 * route directions. Chassis shapes and physical connections must be compiled
 * from this plan; translating the old compact cabinet into each cell is invalid. */
export function planArcadePinballWorld(seedInput: string, options: ArcadeScriptOptions = {}): ArcadeScript {
  const seed = normalizeSeed(seedInput), attempt = finiteInteger(options.attempt ?? 0, 0, 31, "attempt"), players = finiteInteger(options.players ?? 1, 1, Math.min(100, ARENA_CONTENT_LIMITS.players), "players"), teamSize = finiteInteger(options.teamSize ?? 1, 1, 5, "teamSize");
  const rootSeed = deriveSeed(seed, `arcade:${attempt}`), roll = createRoll(rootSeed), topology = options.topology ?? roll.pick(20, TOPOLOGIES);
  if (!(TOPOLOGIES as readonly string[]).includes(topology)) throw new RangeError("Unknown arcade topology.");
  const spawnCount = Math.ceil(players / 5), count = finiteInteger(options.assemblyCount ?? Math.max(spawnCount + 3, 5 + roll.index(21, 4)), spawnCount + 3, 32, "assemblyCount");
  const assemblies: ArcadeAssemblyPlan[] = [], goalIndex = count - 1;
  for (let i = 0; i < count; i++) {
    const r = createRoll(deriveSeed(rootSeed, `place:${i}`)), column = i % 3, row = Math.floor(i / 3);
    let origin: Point, layer = 0, elevation = 0;
    if (topology === "forked-caverns") origin = { x: q(column * 6000 + r.range(20, -400, 400)), y: q(row * 5000 + (column === 1 ? 800 : 0) + r.range(21, -300, 300)) };
    else if (topology === "braided-terraces") { layer = row % 3; elevation = layer * 140; origin = { x: q(column * 6000 + (row % 2 ? 1500 : 0) + r.range(20, -300, 300)), y: q(row * 5000 + r.range(21, -300, 300)) }; }
    else { const theta = i / (count - 1) * Math.PI * 2, radius = Math.max(4700, (count - 1) * 5000 / (Math.PI * 2)) + r.range(20, 0, 300); origin = i === goalIndex ? { x: 0, y: 0 } : { x: q(Math.cos(theta) * radius), y: q(Math.sin(theta) * radius) }; layer = i % 3 === 1 ? 1 : 0; elevation = layer * 140; }
    const owners = i < spawnCount ? Array.from({ length: Math.min(5, players - i * 5) }, (_, j) => i * 5 + j) : [];
    const base = BASE_FAMILIES[(i + roll.index(30, 3)) % BASE_FAMILIES.length]!;
    const family: ArcadeAssemblyFamily = options.includePendingMechanisms && i === goalIndex ? "encounter-crucible" : options.includePendingMechanisms && i === count - 2 ? "vault-reservoir" : base;
    assemblies.push(assembly(rootSeed, i, family, origin, layer, elevation, owners));
  }
  const connections: ArcadeConnectionPlan[] = [], requirements: ArcadeRequirementPlan[] = [];
  const add = (from: number, to: number, escape = false, gated = false): void => {
    const a = assemblies[from]!, b = assemblies[to]!, id = `connection.${connections.length}`, p = a.ports.find(p => p.id.endsWith(gated ? ".branch" : escape ? ".escape" : ".travel"))!, target = b.ports.find(p => p.role === "arrival")!, r = createRoll(deriveSeed(rootSeed, id));
    const length = Math.hypot(target.position.x - p.position.x, target.position.y - p.position.y), reachA = Math.min(1400, Math.max(260, length * r.range(20, 18, 34) / 100)), reachB = Math.min(1400, Math.max(260, length * r.range(21, 18, 34) / 100)), gateId = `${a.id}.throat.${id}`;
    connections.push({ id, fromAssembly: a.id, fromPort: p.id, toAssembly: b.id, toPort: target.id, kind: p.layer === target.layer && p.elevation === target.elevation ? "guided-track" : "ramp", curve: "cubic-bezier", controls: [p.position, { x: q(p.position.x + p.tangent.x * reachA), y: q(p.position.y + p.tangent.y * reachA) }, { x: q(target.position.x - target.tangent.x * reachB), y: q(target.position.y - target.tangent.y * reachB) }, target.position], clearWidth: Math.max(p.clearWidth, target.clearWidth), lockedBy: gated ? [gateId] : [], escape });
    if (gated) requirements.push({ id: `${gateId}.requirement`, assemblyId: a.id, gateId, routeGroups: [a.shots.filter(s => s.family === "ground-orbit").map(s => s.id), a.shots.filter(s => s.family === "elevated-cross-return").map(s => s.id)], scope: teamSize > 1 ? "team" : "owner", persistent: true, holdTicks: 120 });
  };
  // All non-goal places form a connected recoverable route graph. The goal's
  // only inbound edge is a compound physical throat; its exit remains usable.
  for (let i = 0; i < count - 2; i++) { add(i, i + 1); add(i + 1, i, true); }
  if (topology === "forked-caverns") { for (let i = 0; i + 3 < goalIndex; i += 2) { add(i, i + 3); add(i + 3, i, true); } }
  else if (topology === "braided-terraces") { for (let i = 0; i + 2 < goalIndex; i++) if (roll.chance(100 + i, 2, 3)) { add(i, i + 2); add(i + 2, i, true); } }
  else { add(goalIndex - 1, 0); add(0, goalIndex - 1, true); for (let i = 0; i < Math.floor(goalIndex / 3); i++) { const to = 2 + i * 2; if (to < goalIndex) { add(i, to); add(to, i, true); } } }
  const gateSource = roll.range(200, 0, goalIndex - 1); add(gateSource, goalIndex, false, true); add(goalIndex, gateSource, true);
  const junctions: ArcadeJunctionPlan[] = [];
  for (const a of assemblies) for (const port of a.ports) { const outputs = connections.filter(c => c.fromAssembly === a.id && c.fromPort === port.id); if (outputs.length > 1) junctions.push({ id: `${port.id}.junction`, assemblyId: a.id, incomingPortId: port.id, outgoingConnectionIds: outputs.map(c => c.id), kind: "open-fork", selection: "physical-shot-angle", minimumClearWidth: port.clearWidth, requireSupportedCommonApron: true, requireDistinctLegalChoices: true, prohibitOverlaidGuidePairs: true }); }
  const structural = { topology, assemblies: assemblies.map(a => ({ family: a.family, banks: a.bankCount, tierCount: a.silhouette.tierCount, lobes: a.silhouette.lobes, centralVoid: a.silhouette.centralVoid, shots: a.shots.map(s => ({ family: s.family, direction: s.direction, bendCount: s.bendCount, returnSide: s.returnSide })) })), connections: connections.map(c => ({ from: c.fromAssembly, to: c.toAssembly, kind: c.kind, locked: c.lockedBy.length > 0, escape: c.escape })) };
  const body = { schema: "keel-pinball-arcade-script@1" as const, revision: ARCADE_SCRIPT_REVISION, seed, attempt, topology, state: "uncompiled" as const, players, spawnAssemblyIds: assemblies.filter(a => a.launchOwners.length).map(a => a.id), goalAssemblyId: assemblies[goalIndex]!.id, assemblies, connections, junctions, requirements, admission: { minimumAdjacentStarts: 8 as const, ticksPerSecond: 120 as const, requireFullRecovery: true as const, requireShooterCounterfactual: true as const, requireWideTallVisibility: true as const, prohibitPrivateSpawnWalls: true as const, exactGlobalBudgetRequired: true as const }, structuralSignature: digest(structural) };
  const script: ArcadeScript = { ...body, canonical: JSON.stringify(body), sha256: digest(body) };
  const issues = inspectArcadeScript(script);
  if (issues.length) throw new Error(`Invalid arcade plan: ${issues.map(i => `${i.code}:${i.id}`).join(", ")}`);
  return deepFreeze(script);
}

/** Static planning checks do not certify a physical edge. The implementation
 * still needs exact budgets, support/clearance, legal shots and actual pixels. */
export function inspectArcadeScript(script: ArcadeScript): readonly ArcadeScriptIssue[] {
  const issues: ArcadeScriptIssue[] = [], add = (code: string, id: string, detail: string): void => { issues.push({ code, id, detail }); };
  const assemblies = new Map(script.assemblies.map(a => [a.id, a])), ids = new Set<string>(), owners: number[] = [];
  if (assemblies.size !== script.assemblies.length) add("DUPLICATE_ASSEMBLY", "script", "Assembly identities must be unique.");
  if (script.assemblies.length < 4 || script.assemblies.length > 32) add("ASSEMBLY_COUNT", "script", "Plan requires4..32 assemblies.");
  for (const a of script.assemblies) {
    owners.push(...a.launchOwners);
    if (a.bankCount < Math.max(1, a.launchOwners.length) || a.bankCount > 5) add("CATCH_CAPACITY", a.id, "Every owner and downstream place needs usable shared catch machinery.");
    if (a.banks.length !== a.bankCount || new Set(a.banks.map(b => b.index)).size !== a.bankCount || a.banks.some(b => b.index < 0 || b.index >= a.bankCount || new Set(a.shots.filter(s => s.sourceBanks.includes(b.index)).map(s => s.family)).size < 2)) add("LOCAL_SHOT_CHOICES", a.id, "Every controlling pair needs two local readable intakes, which may join shared upper routes.");
    if (a.layer < 0 || a.layer + a.silhouette.tierCount > ARENA_CONTENT_LIMITS.layers || a.shots.some(s => s.crestLayer >= ARENA_CONTENT_LIMITS.layers)) add("LAYER_BUDGET", a.id, "Declared tiers must fit the canonical collision layers.");
    if (a.elevation < 0 || a.elevation + (a.silhouette.tierCount - 1) * a.silhouette.tierRise > ARCADE_MAX_ELEVATION || a.ports.some(p => p.elevation < 0 || p.elevation > ARCADE_MAX_ELEVATION) || a.shots.some(s => s.crestElevation < 0 || s.crestElevation > ARCADE_MAX_ELEVATION)) add("ELEVATION_BUDGET", a.id, "Base, tiers, ports and crests must stay within native admitted heights.");
    if (a.silhouette.centralVoid !== "none" && a.silhouette.voidPhysics !== "admitted-hazard") add("VOID_PHYSICS", a.id, "Deleting a layer0 bed cannot establish a playable void; bind a real admitted hazard footprint.");
    const expectedDown = rotate({ x: 0, y: -1 }, a.quarterTurns);
    if (a.physics.arenaGravity.x !== 0 || a.physics.arenaGravity.y !== 0 || a.physics.localDown.x !== expectedDown.x || a.physics.localDown.y !== expectedDown.y) add("LOCAL_FLOW_ORIENTATION", a.id, "Rotated banks require rotated, bounded local physical flow fields in one shared zero-gravity arena.");
    if (a.silhouette.leftShoulder === a.silhouette.rightShoulder) add("SYMMETRIC_CHASSIS", a.id, "Arcade chamber shoulders require meaningful asymmetry.");
    if (new Set(a.shots.map(s => s.family)).size < 2) add("SHOT_VARIETY", a.id, "At least two different mechanical shot families are required.");
    const ports = new Map(a.ports.map(p => [p.id, p]));
    for (const p of a.ports) { if (ids.has(p.id)) add("DUPLICATE_PORT", p.id, "Port identity repeats."); ids.add(p.id); if (!Number.isFinite(p.position.x + p.position.y + p.elevation) || Math.abs(Math.hypot(p.tangent.x, p.tangent.y) - 1) > 1e-6 || p.clearWidth < 48) add("PORT_POSE", p.id, "Finite pose, unit tangent and admitted aperture are required."); }
    for (const s of a.shots) {
      const entry = ports.get(s.entryPortId), exit = ports.get(s.recoveryPortId);
      if (entry?.role !== "shot" || exit?.role !== "return" || !s.sourceBanks.length || s.sourceBanks.some(i => i < 0 || i >= a.bankCount)) { add("SHOT_PORTS", s.id, "Shot must join its own entry, recovery and source catch bank."); continue; }
      const bank = a.banks.find(b => b.index === s.sourceBanks[0]);
      if (!bank) { add("SHOT_BANK", s.id, "A shot must bind an existing controlling catch pair."); continue; }
      const across = rotate({ x: 1, y: 0 }, a.quarterTurns);
      const entrySide = (entry.position.x - bank.center.x) * across.x + (entry.position.y - bank.center.y) * across.y, exitSide = (exit.position.x - bank.center.x) * across.x + (exit.position.y - bank.center.y) * across.y;
      if (Math.sign(entrySide * exitSide) !== (s.returnSide === "same" ? 1 : -1)) add("RECOVERY_SIDE", s.id, "Seeded return relation must match the requested entry and recovery mouth sides.");
    }
    for (const visual of a.mechanismVisuals) { const f = visual.innerMovementFootprint; if (!ports.has(visual.sourcePortId) || !Object.values(f).every(Number.isFinite) || f.minAlong >= f.maxAlong || f.minAcross >= f.maxAcross || f.minElevation >= f.maxElevation) add("MECHANISM_ENVELOPE", visual.id, "Motion needs a bound physical source and finite reserved inner footprint."); }
  }
  if (owners.length !== script.players || new Set(owners).size !== script.players || owners.some(o => !Number.isInteger(o) || o < 0 || o >= script.players)) add("OWNER_ALLOCATION", "script", "Each launch owner must occur exactly once.");
  if (new Set(script.assemblies.map(a => a.family)).size < 3) add("CHAMBER_VARIETY", "script", "A level cannot repeat one compact cabinet family.");
  for (const c of script.connections) {
    const a = assemblies.get(c.fromAssembly), b = assemblies.get(c.toAssembly), p = a?.ports.find(p => p.id === c.fromPort), target = b?.ports.find(p => p.id === c.toPort);
    if (!a || !b || !p || !target || target.role !== "arrival" || a === b) { add("CONNECTION_PORTS", c.id, "A connection joins distinct valid physical mouth requests."); continue; }
    if (c.kind === "guided-track" && (p.layer !== target.layer || p.elevation !== target.elevation)) add("CONNECTION_HEIGHT", c.id, "A tier change requires an actual supported ramp or captured transit.");
    if (c.controls.length < 2 || c.controls.some(p => !Number.isFinite(p.x + p.y)) || Math.hypot(c.controls[0]!.x - p.position.x, c.controls[0]!.y - p.position.y) > .01 || Math.hypot(c.controls.at(-1)!.x - target.position.x, c.controls.at(-1)!.y - target.position.y) > .01) add("CONNECTION_SHAPE", c.id, "Route controls must connect the declared mouths.");
    if (c.curve !== "cubic-bezier" || c.controls.length !== 4 || Math.abs((c.controls[1]!.x - p.position.x) * p.tangent.y - (c.controls[1]!.y - p.position.y) * p.tangent.x) > .01 || Math.abs((target.position.x - c.controls[2]!.x) * target.tangent.y - (target.position.y - c.controls[2]!.y) * target.tangent.x) > .01) add("CONNECTION_TANGENT", c.id, "Compiled continuous curves must preserve the requested mouth tangents.");
    if (c.escape && c.lockedBy.length) add("LOCKED_ESCAPE", c.id, "The only recovery cannot wait on progression.");
    for (const gate of c.lockedBy) if (!script.requirements.some(r => r.gateId === gate && r.assemblyId === a.id)) add("GATE_REQUIREMENT", c.id, "A locked throat requires matching local qualification.");
  }
  for (const a of script.assemblies) for (const p of a.ports) {
    const outgoing = script.connections.filter(c => c.fromAssembly === a.id && c.fromPort === p.id);
    if (outgoing.length > 1 && !script.junctions.some(j => j.assemblyId === a.id && j.incomingPortId === p.id && j.outgoingConnectionIds.length === outgoing.length && outgoing.every(c => j.outgoingConnectionIds.includes(c.id)))) add("SHARED_MOUTH_JUNCTION", p.id, "Multiple tracks need an admitted physical fork/junction, not overlapping rail pairs.");
  }
  for (const j of script.junctions) { const a = assemblies.get(j.assemblyId), p = a?.ports.find(p => p.id === j.incomingPortId); if (!p || j.outgoingConnectionIds.length < 2 || new Set(j.outgoingConnectionIds).size !== j.outgoingConnectionIds.length || j.outgoingConnectionIds.some(id => !script.connections.some(c => c.id === id && c.fromAssembly === j.assemblyId && c.fromPort === j.incomingPortId))) add("JUNCTION_BINDING", j.id, "A supported selectable fork must bind all its real outgoing route requests."); }
  for (const r of script.requirements) {
    const a = assemblies.get(r.assemblyId), shots = new Map(a?.shots.map(s => [s.id, s]));
    const routeIds = r.routeGroups.flat();
    if (r.routeGroups.length < 2 || new Set(routeIds).size !== routeIds.length || r.routeGroups.some(group => !group.length || group.some(id => !shots.has(id))) || r.routeGroups.some((group, i) => r.routeGroups.slice(i + 1).some(other => group.some(id => other.some(next => shots.get(id)?.family === shots.get(next)?.family))))) add("COMPOUND_QUALIFICATION", r.id, "Independent required groups contain alternatives; no one route/family may satisfy both groups.");
  }
  const reachable = (start: string, gatesClosed: boolean): Set<string> => { const seen = new Set<string>(), queue = [start]; while (queue.length) { const id = queue.pop()!; if (seen.has(id)) continue; seen.add(id); for (const edge of script.connections) if (edge.fromAssembly === id && (!gatesClosed || !edge.lockedBy.length)) queue.push(edge.toAssembly); } return seen; };
  for (const spawn of script.spawnAssemblyIds) {
    const closed = reachable(spawn, true), open = reachable(spawn, false);
    if (closed.has(script.goalAssemblyId)) add("PROGRESSION_BYPASS", spawn, "Closed goal must be separated by the declared gate cut.");
    if (open.size !== assemblies.size || closed.size !== assemblies.size - 1) add("WORLD_CONNECTIVITY", spawn, "Common traversal and gated destination must remain reachable.");
  }
  if (!reachable(script.goalAssemblyId, true).size || !script.connections.some(c => c.fromAssembly === script.goalAssemblyId && c.escape && !c.lockedBy.length)) add("GOAL_RECOVERY", script.goalAssemblyId, "The gated chamber must have a supported escape request.");
  const minimumFlippers = script.assemblies.reduce((n, a) => n + a.bankCount * 2, 0);
  if (minimumFlippers > ARENA_CONTENT_LIMITS.flippers) add("MINIMUM_FLIPPER_BUDGET", "script", "Even the minimum catch allocation exceeds canonical global capacity.");
  return issues;
}

/** Compiler admission must fail explicitly for unavailable state machinery. */
export function missingArcadeCapabilities(script: ArcadeScript, available: readonly ArcadeCapability[]): readonly ArcadeCapability[] {
  const admitted = new Set(available);
  const requested: ArcadeCapability[] = script.assemblies.flatMap(a => a.requiredCapabilities);
  if (script.junctions.length) requested.push("guided-junction");
  return [...new Set(requested)].filter(c => !admitted.has(c));
}
