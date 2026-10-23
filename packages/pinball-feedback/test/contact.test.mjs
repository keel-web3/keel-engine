// packages/pinball-feedback/test/contact.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// packages/pinball-arena/src/native-coordinate.ts
var Q = 1024;
var NATIVE_SNAPSHOT_PADDING_Q = (24 + 18 + 132) * Q + 16 * 99 * (24 * Q + 2);
var NATIVE_SNAPSHOT_MIN = -NATIVE_SNAPSHOT_PADDING_Q / Q;
var NATIVE_SNAPSHOT_MAX = 65535 + NATIVE_SNAPSHOT_PADDING_Q / Q;
function nativeStoredCoordinate(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= -NATIVE_SNAPSHOT_PADDING_Q && value <= 65535 * Q + NATIVE_SNAPSHOT_PADDING_Q;
}
function nativeEventCoordinate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= NATIVE_SNAPSHOT_MIN && value <= NATIVE_SNAPSHOT_MAX;
}

// packages/pinball-arena/src/event-budget.ts
var ARENA_EVENT_CONTENT_LIMITS = Object.freeze({ hazards: 256, routes: 256, requirements: 128, routeRequirementMembership: 2, records: 4096 });
var CELL = 256;
function overlapBound(points) {
  const cells = new Map;
  let maximum = 0;
  for (const p of points) {
    if (typeof p.id !== "string" || !p.id.length || ![p.x, p.y, p.radius].every(Number.isFinite) || p.x < 0 || p.x > 65535 || p.y < 0 || p.y > 65535 || p.radius < 0 || p.radius > 224 || !Number.isInteger(p.layer) || p.layer < 0 || p.layer > 3)
      throw new Error("Invalid event overlap geometry");
  }
  for (const p of points)
    for (let y = Math.floor((p.y - p.radius) / CELL);y <= Math.floor((p.y + p.radius) / CELL); y++)
      for (let x = Math.floor((p.x - p.radius) / CELL);x <= Math.floor((p.x + p.radius) / CELL); x++) {
        const key = `${p.layer}:${x}:${y}`, cell = cells.get(key) ?? new Set;
        cell.add(p.id);
        cells.set(key, cell);
        maximum = Math.max(maximum, cell.size);
      }
  return maximum;
}
function arenaEventBudget(world, players) {
  if (!Number.isSafeInteger(players) || players < 1 || players > 100)
    throw new Error("Event budget accepted player count");
  const hazards = world.arenas.flatMap((a) => a.hazards ?? []), routes = world.arenas.flatMap((a) => a.challenges ?? []), requirements = world.arenas.flatMap((a) => a.requirements ?? []);
  if (hazards.length > ARENA_EVENT_CONTENT_LIMITS.hazards || routes.length > ARENA_EVENT_CONTENT_LIMITS.routes || requirements.length > ARENA_EVENT_CONTENT_LIMITS.requirements)
    throw new Error("Arena logical event content capacity exceeded");
  const membership = new Map;
  for (const requirement of requirements) {
    const groups = requirement.routeGroups ?? requirement.routeIds.map((id) => [id]);
    if (!Array.isArray(groups) || groups.length < 2 || groups.length > 8 || groups.some((group) => !Array.isArray(group) || group.length < 1 || group.length > 32 || group.some((id) => !routes.some((r) => r.id === id))) || new Set(groups.flat()).size !== groups.flat().length || groups.flat().length !== requirement.routeIds.length || requirement.routeIds.some((id) => !groups.flat().includes(id)))
      throw new Error("Invalid compound event groups");
    for (const id of new Set(groups.flat()))
      membership.set(id, (membership.get(id) ?? 0) + 1);
  }
  const maximumMembership = Math.max(0, ...membership.values());
  if (maximumMembership > ARENA_EVENT_CONTENT_LIMITS.routeRequirementMembership)
    throw new Error("Route compound event membership exceeded");
  const hazardOverlap = overlapBound(hazards.map((h) => ({ ...h, radius: h.radius + 24 }))), routeOverlap = overlapBound(routes.flatMap((r) => r.checkpoints.map((p) => ({ ...p, id: r.id }))));
  const switches = world.arenas.reduce((n, a) => n + a.switches.length, 0), gates = world.arenas.reduce((n, a) => n + a.gates.length, 0), mechanisms = world.arenas.reduce((n, a) => n + a.bumpers.length + a.stations.length + a.switches.length + a.gates.length + (a.captures?.length ?? 0), 0);
  const upperBound = 512 + 100 + 2 + mechanisms + switches + gates + players * (15 + hazardOverlap + routeOverlap * (1 + maximumMembership));
  return Object.freeze({ upperBound, limit: ARENA_EVENT_CONTENT_LIMITS.records, hazardOverlap, routeOverlap, maximumMembership, players, mechanisms, switches, gates });
}
function assertArenaEventBudget(world, players) {
  const budget = arenaEventBudget(world, players);
  if (budget.upperBound > budget.limit)
    throw new Error(`Arena event budget exceeds ${budget.limit}: ${budget.upperBound}`);
  return budget;
}
// packages/pinball-arena/src/presentation.ts
function assertArenaSceneEnvelope(scene) {
  let nodes = 0;
  function visit(value, depth) {
    if (++nodes > 4096 || depth > 12)
      throw new Error("Scene presentation record cap");
    if (value === null || typeof value === "boolean")
      return;
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new Error("Non-finite scene presentation");
      return;
    }
    if (typeof value === "string") {
      if (value.length > 512)
        throw new Error("Scene presentation string cap");
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 256)
        throw new Error("Scene presentation array cap");
      for (const child of value)
        visit(child, depth + 1);
      return;
    }
    if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      const entries = Object.entries(value);
      if (entries.length > 128 || entries.some(([key]) => key.length > 120))
        throw new Error("Scene presentation dictionary cap");
      for (const [, child] of entries)
        visit(child, depth + 1);
      return;
    }
    throw new Error("Scene presentation must be plain JSON");
  }
  visit(scene, 0);
  if (scene.schema !== "keel-pinball-scene@1" || typeof scene.blueprintId !== "string" || !scene.blueprintId || typeof scene.blueprintRevision !== "string" || !scene.blueprintRevision || typeof scene.cabinetFamily !== "string" || !scene.cabinetFamily || !/^0x[0-9a-f]{64}$/.test(scene.cabinetSeed) || !/^0x[0-9a-f]{64}$/.test(scene.seed) || !Number.isSafeInteger(scene.stage) || scene.stage < 0 || scene.stage > 1e5 || !Array.isArray(scene.props) || scene.props.length > 24 || !scene.material?.tones || !scene.print || !Array.isArray(scene.print.primitives) || scene.print.primitives.length > 64 || !scene.lighting || !scene.motion || !scene.growth || !scene.ambient)
    throw new Error("Invalid scene presentation envelope");
  if (scene.print.layout !== undefined && !["grid", "field"].includes(scene.print.layout) || scene.print.semantic !== undefined && (typeof scene.print.semantic !== "string" || scene.print.semantic.length < 1 || scene.print.semantic.length > 120))
    throw new Error("Invalid scene print presentation");
  if (new TextEncoder().encode(JSON.stringify(scene)).length > 65536)
    throw new Error("Scene presentation byte cap");
}
function assertArenaFieldScenes(field) {
  if (field.scene !== undefined)
    assertArenaSceneEnvelope(field.scene);
  if (field.sceneRegions === undefined)
    return;
  if (!Array.isArray(field.sceneRegions) || field.sceneRegions.length > 16)
    throw new Error("Regional scene record cap");
  const keys = new Set;
  for (const binding of field.sceneRegions) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding) || Object.getPrototypeOf(binding) !== Object.prototype && Object.getPrototypeOf(binding) !== null || Object.keys(binding).some((key2) => !["regionId", "layer", "scene"].includes(key2)) || typeof binding.regionId !== "string" || binding.regionId.length < 1 || binding.regionId.length > 120 || field.regions.filter((region) => region.id === binding.regionId).length !== 1 || binding.layer !== undefined && (!Number.isSafeInteger(binding.layer) || binding.layer < 0 || binding.layer > 3))
      throw new Error("Invalid regional scene binding");
    const key = binding.regionId + "\x00" + (binding.layer ?? "*");
    if (keys.has(key))
      throw new Error("Duplicate regional scene binding");
    keys.add(key);
    assertArenaSceneEnvelope(binding.scene);
  }
  if (new TextEncoder().encode(JSON.stringify({ scene: field.scene, sceneRegions: field.sceneRegions })).length > 65536)
    throw new Error("Regional scene byte cap");
}
// packages/pinball-arena/src/capture.ts
function arenaMechanismSpecs(world) {
  const specs = [];
  for (const a of world.arenas) {
    for (const b of a.bumpers)
      specs.push({ id: b.id, arenaId: a.id, kind: b.kind === "spring" ? "spring" : "bumper", durationTicks: 36 });
    for (const s of a.stations)
      specs.push({ id: s.id, arenaId: a.id, kind: "plunger", durationTicks: 24 });
    for (const s of a.switches)
      specs.push({ id: s.id, arenaId: a.id, kind: "switch", durationTicks: 18 });
    for (const g of a.gates)
      specs.push({ id: g.id, arenaId: a.id, kind: "gate", durationTicks: 12 });
    for (const c of a.captures ?? [])
      specs.push({ id: c.id, arenaId: a.id, kind: "lock", durationTicks: 24 });
  }
  if (specs.length > 512 || new Set(specs.map((s) => s.id)).size !== specs.length)
    throw new Error("Mechanism record capacity or identity");
  return Object.freeze(specs.sort((a, b) => compare(a.id, b.id)).map((s) => Object.freeze(s)));
}
function arenaCaptureBindings(world) {
  return world.arenas.flatMap((a) => (a.captures ?? []).map((item) => {
    const entry = a.pinball?.ports.find((p) => p.id === item.entryPortId), target = world.arenas.find((a2) => a2.id === item.exitArenaId), exit = target?.pinball?.ports.find((p) => p.id === item.exitPortId), fallback = target?.pinball?.ports.find((p) => p.id === item.fallbackExitPortId);
    if (!entry || !exit || !fallback)
      throw new Error("Capture port reference absent");
    return { item, arenaId: a.id, entry, exit, fallback };
  })).sort((a, b) => compare(a.item.id, b.item.id));
}
var integer = (n, min, max) => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
var finite = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
var compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value))
      freeze(child);
    Object.freeze(value);
  }
  return value;
};
var keys = (value, expected) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
function captureCrossing(entry, previous, current, approach) {
  if (![previous, current].every((b) => [b.x, b.y, b.vx, b.vy, b.radius, b.elevation].every(Number.isFinite) && b.x >= 0 && b.x <= 65535 && b.y >= 0 && b.y <= 65535 && b.radius >= 6 && b.radius <= 24 && b.elevation >= 0 && b.elevation <= 400 && integer(b.layer, 0, 3) && integer(b.ownerId, 0, 99)))
    return null;
  if (!previous.active || !current.active || current.eliminated || previous.ownerId !== current.ownerId || previous.id !== current.id || previous.arenaId !== current.arenaId || current.layer !== entry.layer || previous.layer !== entry.layer || current.radius > entry.maxBallRadius)
    return null;
  if (Math.abs(current.elevation - entry.elevation) > current.radius + 4 || Math.abs(previous.elevation - entry.elevation) > current.radius + 4)
    return null;
  const speed = Math.hypot(current.vx, current.vy);
  if (speed < approach.minSpeed || speed > approach.maxSpeed || speed === 0 || (current.vx * entry.tangent.x + current.vy * entry.tangent.y) / speed < approach.minDot)
    return null;
  const before = (previous.x - entry.x) * entry.tangent.x + (previous.y - entry.y) * entry.tangent.y, after = (current.x - entry.x) * entry.tangent.x + (current.y - entry.y) * entry.tangent.y;
  if (before >= 0 || after < 0 || after <= before)
    return null;
  const t = -before / (after - before), x = previous.x + (current.x - previous.x) * t, y = previous.y + (current.y - previous.y) * t;
  if (Math.abs((x - entry.x) * -entry.tangent.y + (y - entry.y) * entry.tangent.x) > entry.clearWidth / 2 - current.radius - 1 / 1024)
    return null;
  return Math.round(t * 65536);
}
function createCaptureController(bindings) {
  if (bindings.length > 256)
    throw new Error("Capture capacity exceeded");
  const records = bindings.map((value) => ({ binding: freeze(JSON.parse(JSON.stringify(value))), occupiedBodyId: null, activations: 0 })).sort((a, b) => compare(a.binding.item.id, b.binding.item.id));
  const byId = new Map(records.map((record) => [record.binding.item.id, record])), transports = new Map;
  if (byId.size !== records.length)
    throw new Error("Duplicate capture identity");
  for (const { binding: b } of records) {
    const c = b.item;
    if (!c.id || !["scoop", "lock", "tunnel", "portal"].includes(c.kind) || !["timer", "qualification"].includes(c.release.kind) || c.entryPortId !== b.entry.id || c.exitPortId !== b.exit.id || c.fallbackExitPortId !== b.fallback.id || b.entry.role !== "capture-entry" || b.exit.role !== "release-exit" || b.fallback.role !== "release-exit" || c.blockedTerminal !== "drain" || !integer(c.captureTicks, 12, 1200) || !integer(c.travelTicks, 0, 2400) || !integer(c.maxExitWaitTicks, 12, 600) || !finite(c.approach.minSpeed, 0, 18) || !finite(c.approach.maxSpeed, c.approach.minSpeed, 18) || !finite(c.approach.minDot, 0, 1) || !finite(c.exitVelocity.x, -18, 18) || !finite(c.exitVelocity.y, -18, 18) || Math.hypot(c.exitVelocity.x, c.exitVelocity.y) > 18 || c.release.kind === "qualification" && (!c.release.id || !integer(c.release.maxHoldTicks, c.captureTicks, 1200)))
      throw new Error("Invalid capture binding");
    for (const p of [b.entry, b.exit, b.fallback])
      if (![p.x, p.y, p.elevation, p.clearWidth, p.maxBallRadius, p.tangent.x, p.tangent.y].every(Number.isFinite) || !finite(p.x, 0, 65535) || !finite(p.y, 0, 65535) || !finite(p.elevation, 0, 400) || !integer(p.layer, 0, 3) || !finite(p.maxBallRadius, 6, 24) || !finite(p.clearWidth, 24, 400) || p.clearWidth < 2 * p.maxBallRadius + 2 / 1024 || Math.abs(Math.hypot(p.tangent.x, p.tangent.y) - 1) > 0.001)
        throw new Error("Invalid capture port");
  }
  const action = (r, t, type, port = r.binding.entry) => ({ type, bodyId: t.bodyId, ownerId: t.ownerId, mechanismId: r.binding.item.id, entryPortId: r.binding.entry.id, exitPortId: t.state.exitPortId, arenaId: type === "capture-release" ? r.binding.item.exitArenaId : r.binding.arenaId, x: port.x, y: port.y, layer: port.layer, elevation: port.elevation, vx: type === "capture-release" ? r.binding.item.exitVelocity.x : 0, vy: type === "capture-release" ? r.binding.item.exitVelocity.y : 0 });
  function cancel(bodyId) {
    const t = transports.get(bodyId);
    if (!t)
      return;
    const r = byId.get(t.state.mechanismId);
    r.occupiedBodyId = null;
    transports.delete(bodyId);
  }
  return {
    state(bodyId) {
      const state = transports.get(bodyId)?.state;
      return state ? { ...state } : null;
    },
    frames() {
      return records.map((r) => ({ id: r.binding.item.id, arenaId: r.binding.arenaId, enabled: r.occupiedBodyId === null, occupiedBodyId: r.occupiedBodyId, phase: r.occupiedBodyId ? transports.get(r.occupiedBodyId).state.phase : "idle", activations: r.activations }));
    },
    occupiedGateIds() {
      return new Set(records.filter((r) => r.occupiedBodyId !== null).flatMap((r) => r.binding.item.busyGateIds));
    },
    cancel,
    enter(previous, current, tick) {
      if (!integer(tick, 1, 432000) || current.length > 128)
        throw new Error("Capture entry tick/body budget");
      const candidates = [];
      for (const b of current) {
        if (transports.has(b.id))
          continue;
        const p = previous.get(b.id);
        if (!p)
          continue;
        for (const r of records) {
          if (r.occupiedBodyId !== null || r.binding.arenaId !== b.arenaId)
            continue;
          const fraction = captureCrossing(r.binding.entry, p, b, r.binding.item.approach);
          if (fraction !== null)
            candidates.push({ r, b, fraction });
        }
      }
      candidates.sort((a, b) => a.fraction - b.fraction || a.b.ownerId - b.b.ownerId || compare(a.b.id, b.b.id) || compare(a.r.binding.item.id, b.r.binding.item.id));
      const out = [];
      for (const { r, b } of candidates) {
        if (r.occupiedBodyId !== null || transports.has(b.id))
          continue;
        const c = r.binding.item, state = { mechanismId: c.id, kind: c.kind, phase: "captured", entryTick: tick, phaseTick: tick, plannedReleaseTick: c.release.kind === "timer" ? tick + c.captureTicks + c.travelTicks : null, exitArenaId: c.exitArenaId, exitPortId: c.exitPortId }, t = { bodyId: b.id, ownerId: b.ownerId, state };
        r.occupiedBodyId = b.id;
        r.activations++;
        transports.set(b.id, t);
        out.push(action(r, t, "capture-enter"));
      }
      return out;
    },
    advance(tick, qualified, exitClear) {
      if (!integer(tick, 1, 432000))
        throw new Error("Capture advance tick budget");
      const out = [];
      for (const t of [...transports.values()].sort((a, b) => a.ownerId - b.ownerId || compare(a.bodyId, b.bodyId))) {
        const r = byId.get(t.state.mechanismId), c = r.binding.item;
        if (t.state.phase === "captured") {
          const age = tick - t.state.entryTick;
          if (age < c.captureTicks)
            continue;
          const timedOut = c.release.kind === "qualification" && age >= c.release.maxHoldTicks;
          if (c.release.kind === "qualification" && !timedOut && !qualified(c.release.id, t.ownerId))
            continue;
          t.state = { ...t.state, phase: "transit", phaseTick: tick, plannedReleaseTick: tick + c.travelTicks, exitPortId: timedOut ? c.fallbackExitPortId : c.exitPortId };
          out.push(action(r, t, "transit-start"));
        }
        if (t.state.phase === "transit" && tick < t.state.plannedReleaseTick)
          continue;
        const selected = t.state.exitPortId === c.fallbackExitPortId ? r.binding.fallback : r.binding.exit;
        if (exitClear(r.binding, selected, t.bodyId)) {
          out.push(action(r, t, "capture-release", selected));
          cancel(t.bodyId);
          continue;
        }
        if (t.state.phase !== "exit-blocked") {
          t.state = { ...t.state, phase: "exit-blocked", phaseTick: tick };
          out.push(action(r, t, "exit-blocked"));
        }
        if (tick - t.state.phaseTick >= c.maxExitWaitTicks) {
          if (selected.id !== r.binding.fallback.id && exitClear(r.binding, r.binding.fallback, t.bodyId)) {
            t.state = { ...t.state, exitPortId: c.fallbackExitPortId };
            out.push(action(r, t, "capture-release", r.binding.fallback));
          } else
            out.push(action(r, t, "terminal-drain"));
          cancel(t.bodyId);
        }
      }
      return out;
    },
    snapshot() {
      return { records: records.map((r) => ({ id: r.binding.item.id, occupiedBodyId: r.occupiedBodyId, activations: r.activations })), transports: [...transports.values()].sort((a, b) => a.ownerId - b.ownerId || compare(a.bodyId, b.bodyId)).map((t) => ({ ...t, state: { ...t.state } })) };
    },
    prepareRestore(data, tick, bodies, qualified = () => false) {
      const d = data;
      if (!keys(d, ["records", "transports"]) || !integer(tick, 0, 432000) || !Array.isArray(d.records) || d.records.length !== records.length || !Array.isArray(d.transports) || d.transports.length > 128)
        throw new Error("Invalid capture snapshot budget");
      const bodyMap = new Map(bodies.map((b) => [b.id, b])), restored = new Map, occupancy = new Map;
      for (const value of d.records) {
        const v = value;
        if (!keys(v, ["id", "occupiedBodyId", "activations"]) || !byId.has(v.id) || occupancy.has(v.id) || !integer(v.activations, 0, tick * 128) || v.occupiedBodyId !== null && !bodyMap.has(v.occupiedBodyId))
          throw new Error("Invalid capture snapshot record");
        occupancy.set(v.id, { bodyId: v.occupiedBodyId, activations: v.activations });
      }
      for (const value of d.transports) {
        const t = value, s = t?.state, r = s && byId.get(s.mechanismId), b = bodyMap.get(t?.bodyId);
        if (!keys(t, ["bodyId", "ownerId", "state"]) || !keys(s, ["mechanismId", "kind", "phase", "entryTick", "phaseTick", "plannedReleaseTick", "exitArenaId", "exitPortId"]) || !r || !b || restored.has(t.bodyId) || b.ownerId !== t.ownerId || b.active || b.eliminated || occupancy.get(s.mechanismId)?.bodyId !== t.bodyId || occupancy.get(s.mechanismId).activations === 0 || s.kind !== r.binding.item.kind || !["captured", "transit", "exit-blocked"].includes(s.phase) || !integer(s.entryTick, 1, tick) || !integer(s.phaseTick, s.entryTick, tick) || s.exitArenaId !== r.binding.item.exitArenaId || ![r.binding.item.exitPortId, r.binding.item.fallbackExitPortId].includes(s.exitPortId) || b.arenaId !== r.binding.arenaId || b.layer !== r.binding.entry.layer || Math.abs(b.elevation - r.binding.entry.elevation) > 1 / 1024 || Math.hypot(b.x - r.binding.entry.x, b.y - r.binding.entry.y) > 2 / 1024 || b.vx !== 0 || b.vy !== 0)
          throw new Error("Invalid capture snapshot transport");
        const c = r.binding.item, age = tick - s.entryTick;
        if (s.phase === "captured") {
          if (s.phaseTick !== s.entryTick || s.exitPortId !== c.exitPortId || (c.release.kind === "timer" ? age >= c.captureTicks || s.plannedReleaseTick !== s.entryTick + c.captureTicks + c.travelTicks : age >= c.release.maxHoldTicks || age >= c.captureTicks && qualified(c.release.id, t.ownerId) || s.plannedReleaseTick !== null))
            throw new Error("Invalid capture hold phase");
        } else {
          if (!integer(s.plannedReleaseTick, s.entryTick + c.captureTicks + c.travelTicks, s.entryTick + (c.release.kind === "timer" ? c.captureTicks : c.release.maxHoldTicks) + c.travelTicks))
            throw new Error("Invalid capture transit schedule");
          const start = s.plannedReleaseTick - c.travelTicks, expectedExit = c.release.kind === "qualification" && start === s.entryTick + c.release.maxHoldTicks ? c.fallbackExitPortId : c.exitPortId;
          if (c.release.kind === "timer" && start !== s.entryTick + c.captureTicks || c.release.kind === "qualification" && expectedExit === c.exitPortId && !qualified(c.release.id, t.ownerId) || s.exitPortId !== expectedExit || s.phase === "transit" && (s.phaseTick !== start || tick >= s.plannedReleaseTick) || s.phase === "exit-blocked" && (s.phaseTick !== s.plannedReleaseTick || tick - s.phaseTick >= c.maxExitWaitTicks))
            throw new Error("Invalid capture transit phase");
        }
        restored.set(t.bodyId, { bodyId: t.bodyId, ownerId: t.ownerId, state: { ...s } });
      }
      for (const { bodyId } of occupancy.values())
        if (bodyId !== null && !restored.has(bodyId))
          throw new Error("Invalid capture occupancy bijection");
      return () => {
        transports.clear();
        for (const [id, t] of restored)
          transports.set(id, t);
        for (const r of records) {
          const v = occupancy.get(r.binding.item.id);
          r.occupiedBodyId = v.bodyId;
          r.activations = v.activations;
        }
      };
    }
  };
}
// packages/runtime/src/semver.ts
function parseVersion(text) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
  if (!m)
    throw new TypeError(`"${text}" is not a version (major.minor.patch).`);
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}
function splitRef(ref) {
  const at = ref.lastIndexOf("@");
  if (at <= 0)
    return { name: ref, range: "*" };
  return { name: ref.slice(0, at), range: ref.slice(at + 1) || "*" };
}
// packages/runtime/src/manifest.ts
var MANIFEST_SCHEMA = "keel-engine-module@1";
var MODULE_KINDS = ["runtime", "pack", "system", "ai", "game", "map"];
var ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/;
var DEFAULT_PHASE = { runtime: "runtime", pack: "runtime", system: "runtime", ai: "runtime", game: "render", map: "data" };
var DEFAULT_WEIGHT = { runtime: -1000, pack: -500, system: -300, ai: -300, map: -100, game: 0 };
function defineManifest(input) {
  const bad = (why) => {
    throw new TypeError(`Module ${input.id ?? "(no id)"}: ${why}`);
  };
  if (!ID.test(input.id))
    bad(`id must be namespaced, lower-case: "packs/animals", "keel/render" (got "${input.id}").`);
  try {
    parseVersion(input.version);
  } catch {
    bad(`version must be exact semver (got "${input.version}").`);
  }
  if (input.version.split(".").length !== 3)
    bad(`version must be exact semver major.minor.patch (got "${input.version}").`);
  if (!MODULE_KINDS.includes(input.kind))
    bad(`kind must be one of ${MODULE_KINDS.join(", ")}.`);
  const needs = [...input.needs ?? []];
  for (const n of needs) {
    const { name } = splitRef(n.replace(/^contract:/, ""));
    if (!name)
      bad(`need "${n}" names nothing.`);
  }
  const provides = [...input.provides ?? []];
  for (const p of provides) {
    const { name, range } = splitRef(p);
    if (!name.includes("/"))
      bad(`contract "${p}" must be namespaced ("body/quadruped@1.0.0").`);
    try {
      if (range.split(".").length !== 3)
        throw new Error;
      parseVersion(range);
    } catch {
      bad(`contract "${p}" must carry an exact version.`);
    }
  }
  if (input.id === undefined)
    bad("no id.");
  return Object.freeze({
    schema: MANIFEST_SCHEMA,
    ...input,
    needs: Object.freeze(needs),
    provides: Object.freeze(provides),
    compatible: Object.freeze([...input.compatible ?? []]),
    phase: input.phase ?? DEFAULT_PHASE[input.kind],
    weight: input.weight ?? DEFAULT_WEIGHT[input.kind]
  });
}
// packages/pinball-arena/src/module.ts
var manifest = defineManifest({
  id: "keel/pinball-arena",
  version: "0.1.0",
  kind: "runtime",
  needs: [
    "keel/runtime@^0.1",
    "keel/core@^0.1",
    "keel/codec@^0.1"
  ],
  title: "Shared pinball arena",
  description: "Canonical multi-owner integer WASM arena physics, field mechanisms and snapshots."
});
// packages/pinball-arena/src/kernel-bytes.ts
var ARENA_KERNEL_SHA256 = "638eaa423d7a7fe6b46eb30f03fe15b6878c55e062ef792c82627dd48cd6a109";
var ARENA_KERNEL_BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 99, 11, 96, 0, 1, 127, 96, 2, 127, 127, 0, 96, 0, 0, 96, 9, 127, 127, 127, 127, 127, 127, 127, 127, 127, 1, 127, 96, 11, 127, 127, 127, 127, 127, 127, 127, 127, 127, 127, 127, 1, 127, 96, 1, 127, 1, 127, 96, 7, 127, 127, 127, 127, 127, 127, 127, 1, 127, 96, 10, 127, 127, 127, 127, 127, 127, 127, 127, 127, 127, 0, 96, 8, 127, 127, 127, 127, 127, 127, 127, 127, 0, 96, 3, 127, 127, 127, 0, 96, 8, 127, 127, 127, 127, 127, 127, 127, 127, 1, 127, 3, 24, 23, 2, 0, 0, 0, 0, 2, 3, 1, 6, 4, 1, 1, 7, 8, 1, 4, 9, 0, 2, 10, 3, 5, 5, 5, 4, 1, 1, 32, 32, 6, 96, 14, 127, 1, 65, 128, 128, 4, 11, 127, 0, 65, 0, 11, 127, 0, 65, 1, 11, 127, 0, 65, 128, 128, 4, 11, 127, 0, 65, 128, 128, 4, 11, 127, 0, 65, 144, 140, 193, 0, 11, 127, 0, 65, 128, 128, 4, 11, 127, 0, 65, 180, 184, 4, 11, 127, 0, 65, 0, 11, 127, 0, 65, 128, 128, 4, 11, 127, 0, 65, 128, 128, 4, 11, 127, 0, 65, 144, 140, 193, 0, 11, 127, 0, 65, 128, 128, 128, 1, 11, 127, 0, 65, 128, 128, 4, 11, 7, 198, 3, 36, 6, 109, 101, 109, 111, 114, 121, 2, 0, 17, 95, 95, 119, 97, 115, 109, 95, 99, 97, 108, 108, 95, 99, 116, 111, 114, 115, 0, 0, 15, 95, 95, 115, 116, 97, 99, 107, 95, 112, 111, 105, 110, 116, 101, 114, 3, 0, 9, 115, 116, 97, 116, 101, 95, 112, 116, 114, 0, 1, 10, 115, 116, 97, 116, 101, 95, 115, 105, 122, 101, 0, 2, 9, 105, 110, 112, 117, 116, 95, 112, 116, 114, 0, 3, 8, 116, 114, 105, 103, 95, 112, 116, 114, 0, 4, 4, 105, 110, 105, 116, 0, 5, 4, 114, 97, 105, 108, 0, 6, 18, 114, 97, 105, 108, 95, 101, 110, 100, 95, 101, 108, 101, 118, 97, 116, 105, 111, 110, 0, 7, 6, 98, 117, 109, 112, 101, 114, 0, 8, 7, 102, 108, 105, 112, 112, 101, 114, 0, 9, 7, 101, 110, 97, 98, 108, 101, 100, 0, 10, 5, 108, 101, 97, 115, 101, 0, 11, 8, 97, 100, 100, 95, 98, 97, 108, 108, 0, 12, 8, 115, 101, 116, 95, 98, 97, 108, 108, 0, 13, 9, 101, 108, 101, 118, 97, 116, 105, 111, 110, 0, 14, 4, 114, 97, 109, 112, 0, 15, 5, 102, 111, 114, 99, 101, 0, 16, 11, 105, 110, 100, 101, 120, 95, 119, 111, 114, 108, 100, 0, 17, 4, 115, 116, 101, 112, 0, 18, 5, 116, 105, 112, 95, 120, 0, 21, 5, 116, 105, 112, 95, 121, 0, 22, 12, 95, 95, 100, 115, 111, 95, 104, 97, 110, 100, 108, 101, 3, 4, 10, 95, 95, 100, 97, 116, 97, 95, 101, 110, 100, 3, 5, 14, 95, 95, 114, 111, 100, 97, 116, 97, 95, 115, 116, 97, 114, 116, 3, 6, 12, 95, 95, 114, 111, 100, 97, 116, 97, 95, 101, 110, 100, 3, 7, 11, 95, 95, 115, 116, 97, 99, 107, 95, 108, 111, 119, 3, 8, 12, 95, 95, 115, 116, 97, 99, 107, 95, 104, 105, 103, 104, 3, 9, 13, 95, 95, 103, 108, 111, 98, 97, 108, 95, 98, 97, 115, 101, 3, 10, 11, 95, 95, 104, 101, 97, 112, 95, 98, 97, 115, 101, 3, 11, 10, 95, 95, 104, 101, 97, 112, 95, 101, 110, 100, 3, 12, 13, 95, 95, 109, 101, 109, 111, 114, 121, 95, 98, 97, 115, 101, 3, 1, 12, 95, 95, 116, 97, 98, 108, 101, 95, 98, 97, 115, 101, 3, 2, 21, 95, 95, 119, 97, 115, 109, 95, 102, 105, 114, 115, 116, 95, 112, 97, 103, 101, 95, 101, 110, 100, 3, 13, 10, 95, 95, 116, 108, 115, 95, 98, 97, 115, 101, 3, 3, 12, 1, 1, 10, 200, 92, 23, 2, 0, 11, 6, 0, 65, 192, 184, 4, 11, 6, 0, 65, 160, 208, 1, 11, 6, 0, 65, 224, 136, 6, 11, 6, 0, 65, 128, 128, 4, 11, 153, 2, 1, 1, 127, 65, 224, 175, 126, 33, 0, 3, 64, 32, 0, 65, 248, 136, 6, 106, 66, 0, 55, 2, 0, 32, 0, 65, 240, 136, 6, 106, 66, 0, 55, 2, 0, 32, 0, 65, 232, 136, 6, 106, 66, 0, 55, 2, 0, 32, 0, 65, 224, 136, 6, 106, 66, 0, 55, 2, 0, 32, 0, 65, 32, 106, 34, 0, 13, 0, 11, 65, 240, 124, 33, 0, 3, 64, 32, 0, 65, 128, 140, 6, 106, 65, 0, 54, 2, 0, 32, 0, 65, 248, 139, 6, 106, 66, 0, 55, 2, 0, 32, 0, 65, 240, 139, 6, 106, 66, 0, 55, 2, 0, 32, 0, 65, 20, 106, 34, 0, 13, 0, 11, 65, 128, 64, 33, 0, 3, 64, 32, 0, 65, 136, 204, 6, 106, 66, 0, 55, 3, 0, 32, 0, 65, 128, 204, 6, 106, 66, 0, 55, 3, 0, 32, 0, 65, 248, 203, 6, 106, 66, 0, 55, 3, 0, 32, 0, 65, 240, 203, 6, 106, 66, 0, 55, 3, 0, 32, 0, 65, 32, 106, 34, 0, 13, 0, 11, 65, 244, 203, 6, 65, 0, 54, 2, 0, 65, 240, 203, 6, 65, 0, 54, 2, 0, 65, 248, 203, 6, 65, 0, 54, 2, 0, 65, 128, 128, 112, 33, 0, 3, 64, 32, 0, 65, 152, 204, 22, 106, 66, 127, 55, 3, 0, 32, 0, 65, 144, 204, 22, 106, 66, 127, 55, 3, 0, 32, 0, 65, 136, 204, 22, 106, 66, 127, 55, 3, 0, 32, 0, 65, 128, 204, 22, 106, 66, 127, 55, 3, 0, 32, 0, 65, 32, 106, 34, 0, 13, 0, 11, 11, 227, 1, 1, 2, 127, 65, 200, 184, 4, 65, 200, 184, 4, 40, 2, 0, 34, 10, 65, 1, 106, 54, 2, 0, 32, 10, 65, 204, 0, 108, 34, 9, 65, 200, 204, 22, 106, 32, 8, 54, 2, 0, 32, 9, 65, 196, 204, 22, 106, 32, 8, 54, 2, 0, 32, 9, 65, 192, 204, 22, 106, 65, 1, 54, 2, 0, 32, 9, 65, 184, 204, 22, 106, 66, 128, 128, 128, 128, 112, 55, 2, 0, 32, 9, 65, 176, 204, 22, 106, 66, 0, 55, 2, 0, 32, 9, 65, 168, 204, 22, 106, 66, 0, 55, 2, 0, 32, 9, 65, 164, 204, 22, 106, 32, 7, 54, 2, 0, 32, 9, 65, 160, 204, 22, 106, 32, 6, 54, 2, 0, 32, 9, 65, 156, 204, 22, 106, 65, 0, 54, 2, 0, 32, 9, 65, 152, 204, 22, 106, 32, 5, 54, 2, 0, 32, 9, 65, 148, 204, 22, 106, 32, 4, 54, 2, 0, 32, 9, 65, 144, 204, 22, 106, 32, 3, 54, 2, 0, 32, 9, 65, 140, 204, 22, 106, 32, 2, 54, 2, 0, 32, 9, 65, 136, 204, 22, 106, 32, 1, 54, 2, 0, 32, 9, 65, 132, 204, 22, 106, 32, 0, 54, 2, 0, 32, 9, 65, 128, 204, 22, 106, 65, 0, 54, 2, 0, 32, 10, 11, 51, 0, 2, 64, 32, 0, 65, 0, 72, 13, 0, 32, 0, 65, 200, 184, 4, 40, 2, 0, 78, 13, 0, 32, 0, 65, 204, 0, 108, 34, 0, 40, 2, 128, 204, 22, 13, 0, 32, 0, 65, 128, 204, 22, 106, 32, 1, 54, 2, 72, 11, 11, 228, 1, 1, 2, 127, 65, 200, 184, 4, 65, 200, 184, 4, 40, 2, 0, 34, 8, 65, 1, 106, 54, 2, 0, 32, 8, 65, 204, 0, 108, 34, 7, 65, 200, 204, 22, 106, 65, 0, 54, 2, 0, 32, 7, 65, 196, 204, 22, 106, 32, 6, 54, 2, 0, 32, 7, 65, 192, 204, 22, 106, 65, 1, 54, 2, 0, 32, 7, 65, 184, 204, 22, 106, 66, 128, 128, 128, 128, 112, 55, 2, 0, 32, 7, 65, 176, 204, 22, 106, 66, 0, 55, 2, 0, 32, 7, 65, 168, 204, 22, 106, 66, 0, 55, 2, 0, 32, 7, 65, 164, 204, 22, 106, 32, 5, 54, 2, 0, 32, 7, 65, 160, 204, 22, 106, 32, 4, 54, 2, 0, 32, 7, 65, 156, 204, 22, 106, 32, 3, 54, 2, 0, 32, 7, 65, 152, 204, 22, 106, 65, 128, 8, 54, 2, 0, 32, 7, 65, 148, 204, 22, 106, 32, 2, 54, 2, 0, 32, 7, 65, 144, 204, 22, 106, 32, 1, 54, 2, 0, 32, 7, 65, 140, 204, 22, 106, 32, 0, 54, 2, 0, 32, 7, 65, 136, 204, 22, 106, 32, 1, 54, 2, 0, 32, 7, 65, 132, 204, 22, 106, 32, 0, 54, 2, 0, 32, 7, 65, 128, 204, 22, 106, 65, 1, 54, 2, 0, 32, 8, 11, 156, 2, 1, 3, 127, 65, 200, 184, 4, 65, 200, 184, 4, 40, 2, 0, 34, 12, 65, 1, 106, 54, 2, 0, 65, 204, 184, 4, 65, 204, 184, 4, 40, 2, 0, 34, 13, 65, 1, 106, 54, 2, 0, 32, 12, 65, 204, 0, 108, 34, 11, 65, 200, 204, 22, 106, 65, 0, 54, 2, 0, 32, 11, 65, 196, 204, 22, 106, 32, 10, 54, 2, 0, 32, 11, 65, 192, 204, 22, 106, 65, 1, 54, 2, 0, 32, 11, 65, 188, 204, 22, 106, 32, 13, 54, 2, 0, 32, 11, 65, 184, 204, 22, 106, 32, 2, 54, 2, 0, 32, 11, 65, 180, 204, 22, 106, 32, 5, 54, 2, 0, 32, 11, 65, 176, 204, 22, 106, 32, 4, 54, 2, 0, 32, 11, 65, 172, 204, 22, 106, 32, 6, 54, 2, 0, 32, 11, 65, 168, 204, 22, 106, 32, 7, 54, 2, 0, 32, 11, 65, 164, 204, 22, 106, 32, 9, 54, 2, 0, 32, 11, 65, 160, 204, 22, 106, 32, 8, 54, 2, 0, 32, 11, 65, 152, 204, 22, 106, 66, 210, 6, 55, 2, 0, 32, 11, 65, 148, 204, 22, 106, 32, 3, 54, 2, 0, 32, 11, 65, 140, 204, 22, 106, 66, 0, 55, 2, 0, 32, 11, 65, 136, 204, 22, 106, 32, 1, 54, 2, 0, 32, 11, 65, 132, 204, 22, 106, 32, 0, 54, 2, 0, 32, 11, 65, 128, 204, 22, 106, 65, 2, 54, 2, 0, 32, 13, 65, 2, 116, 34, 11, 65, 128, 140, 32, 106, 32, 12, 54, 2, 0, 32, 11, 65, 224, 128, 5, 106, 32, 4, 54, 2, 0, 32, 12, 11, 37, 0, 2, 64, 32, 0, 65, 0, 72, 13, 0, 32, 0, 65, 200, 184, 4, 40, 2, 0, 78, 13, 0, 32, 0, 65, 204, 0, 108, 32, 1, 54, 2, 192, 204, 22, 11, 11, 54, 0, 2, 64, 32, 0, 65, 0, 72, 13, 0, 32, 0, 65, 200, 184, 4, 40, 2, 0, 78, 13, 0, 32, 0, 65, 204, 0, 108, 34, 0, 40, 2, 128, 204, 22, 65, 2, 71, 13, 0, 32, 0, 65, 128, 204, 22, 106, 32, 1, 54, 2, 40, 11, 11, 130, 3, 2, 1, 127, 6, 126, 65, 196, 184, 4, 65, 196, 184, 4, 40, 2, 0, 34, 10, 65, 1, 106, 54, 2, 0, 32, 10, 65, 200, 0, 108, 34, 10, 65, 160, 185, 4, 106, 66, 0, 55, 2, 0, 32, 10, 65, 152, 185, 4, 106, 66, 128, 128, 128, 128, 112, 55, 2, 0, 32, 10, 65, 144, 185, 4, 106, 66, 128, 128, 128, 128, 192, 115, 55, 2, 0, 32, 10, 65, 140, 185, 4, 106, 65, 0, 54, 2, 0, 32, 10, 65, 136, 185, 4, 106, 65, 0, 54, 2, 0, 32, 10, 65, 132, 185, 4, 106, 32, 9, 54, 2, 0, 32, 10, 65, 128, 185, 4, 106, 32, 8, 54, 2, 0, 32, 10, 65, 252, 184, 4, 106, 32, 7, 54, 2, 0, 32, 10, 65, 248, 184, 4, 106, 32, 6, 54, 2, 0, 32, 10, 65, 244, 184, 4, 106, 32, 5, 54, 2, 0, 32, 10, 65, 240, 184, 4, 106, 32, 4, 54, 2, 0, 32, 10, 65, 236, 184, 4, 106, 32, 3, 54, 2, 0, 32, 10, 65, 232, 184, 4, 106, 32, 2, 54, 2, 0, 32, 10, 65, 228, 184, 4, 106, 32, 1, 54, 2, 0, 32, 10, 65, 224, 184, 4, 106, 34, 9, 32, 0, 54, 2, 0, 32, 3, 172, 34, 14, 32, 14, 126, 32, 2, 172, 34, 15, 32, 15, 126, 124, 33, 13, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 11, 3, 64, 32, 11, 34, 12, 66, 2, 136, 33, 11, 32, 12, 32, 13, 86, 13, 0, 11, 2, 64, 32, 12, 80, 13, 0, 66, 0, 33, 11, 3, 64, 32, 11, 66, 1, 136, 66, 0, 32, 12, 32, 13, 32, 11, 32, 12, 124, 34, 16, 84, 34, 10, 27, 124, 33, 11, 32, 13, 66, 0, 32, 16, 32, 10, 27, 125, 33, 13, 32, 12, 66, 2, 136, 34, 12, 66, 0, 82, 13, 0, 11, 32, 11, 167, 65, 129, 144, 1, 72, 13, 0, 32, 9, 32, 14, 66, 128, 144, 1, 126, 32, 11, 66, 255, 255, 255, 255, 7, 131, 34, 12, 127, 62, 2, 12, 32, 9, 32, 15, 66, 128, 144, 1, 126, 32, 12, 127, 62, 2, 8, 11, 11, 173, 2, 1, 6, 126, 2, 64, 32, 0, 65, 0, 72, 13, 0, 32, 0, 65, 196, 184, 4, 40, 2, 0, 78, 13, 0, 32, 0, 65, 200, 0, 108, 34, 0, 65, 0, 54, 2, 140, 185, 4, 32, 0, 32, 7, 54, 2, 128, 185, 4, 32, 0, 32, 6, 54, 2, 252, 184, 4, 32, 0, 32, 5, 54, 2, 240, 184, 4, 32, 0, 32, 4, 54, 2, 236, 184, 4, 32, 0, 32, 3, 54, 2, 232, 184, 4, 32, 0, 32, 2, 54, 2, 228, 184, 4, 32, 0, 32, 1, 54, 2, 224, 184, 4, 32, 0, 65, 0, 54, 2, 164, 185, 4, 32, 0, 65, 127, 54, 2, 156, 185, 4, 32, 0, 65, 0, 54, 2, 136, 185, 4, 32, 0, 65, 224, 184, 4, 106, 33, 7, 32, 4, 172, 34, 11, 32, 11, 126, 32, 3, 172, 34, 12, 32, 12, 126, 124, 33, 10, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 8, 3, 64, 32, 8, 34, 9, 66, 2, 136, 33, 8, 32, 9, 32, 10, 86, 13, 0, 11, 32, 9, 80, 13, 0, 66, 0, 33, 8, 3, 64, 32, 8, 66, 1, 136, 66, 0, 32, 9, 32, 10, 32, 8, 32, 9, 124, 34, 13, 84, 34, 0, 27, 124, 33, 8, 32, 10, 66, 0, 32, 13, 32, 0, 27, 125, 33, 10, 32, 9, 66, 2, 136, 34, 9, 66, 0, 82, 13, 0, 11, 32, 8, 167, 65, 129, 144, 1, 72, 13, 0, 32, 7, 32, 11, 66, 128, 144, 1, 126, 32, 8, 66, 255, 255, 255, 255, 7, 131, 34, 9, 127, 62, 2, 12, 32, 7, 32, 12, 66, 128, 144, 1, 126, 32, 9, 127, 62, 2, 8, 11, 11, 37, 0, 2, 64, 32, 0, 65, 0, 72, 13, 0, 32, 0, 65, 196, 184, 4, 40, 2, 0, 78, 13, 0, 32, 0, 65, 200, 0, 108, 32, 1, 54, 2, 152, 185, 4, 11, 11, 162, 1, 1, 2, 127, 65, 244, 203, 6, 65, 244, 203, 6, 40, 2, 0, 34, 12, 65, 1, 106, 54, 2, 0, 32, 12, 65, 44, 108, 34, 11, 65, 168, 148, 32, 106, 32, 10, 54, 2, 0, 32, 11, 65, 164, 148, 32, 106, 32, 9, 54, 2, 0, 32, 11, 65, 160, 148, 32, 106, 32, 8, 54, 2, 0, 32, 11, 65, 156, 148, 32, 106, 32, 7, 54, 2, 0, 32, 11, 65, 152, 148, 32, 106, 32, 6, 54, 2, 0, 32, 11, 65, 148, 148, 32, 106, 32, 5, 54, 2, 0, 32, 11, 65, 144, 148, 32, 106, 32, 4, 54, 2, 0, 32, 11, 65, 140, 148, 32, 106, 32, 3, 54, 2, 0, 32, 11, 65, 136, 148, 32, 106, 32, 2, 54, 2, 0, 32, 11, 65, 132, 148, 32, 106, 32, 1, 54, 2, 0, 32, 11, 65, 128, 148, 32, 106, 32, 0, 54, 2, 0, 32, 12, 11, 240, 1, 1, 6, 126, 2, 64, 32, 0, 65, 0, 72, 13, 0, 32, 0, 65, 196, 184, 4, 40, 2, 0, 78, 13, 0, 32, 0, 65, 200, 0, 108, 34, 0, 32, 0, 40, 2, 232, 184, 4, 32, 1, 106, 34, 1, 54, 2, 232, 184, 4, 32, 0, 32, 0, 40, 2, 236, 184, 4, 32, 2, 106, 34, 2, 54, 2, 236, 184, 4, 32, 2, 172, 34, 6, 32, 6, 126, 32, 1, 172, 34, 7, 32, 7, 126, 124, 33, 5, 32, 0, 65, 224, 184, 4, 106, 33, 2, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 3, 3, 64, 32, 3, 34, 4, 66, 2, 136, 33, 3, 32, 4, 32, 5, 86, 13, 0, 11, 32, 4, 80, 13, 0, 66, 0, 33, 3, 3, 64, 32, 3, 66, 1, 136, 66, 0, 32, 4, 32, 5, 32, 3, 32, 4, 124, 34, 8, 84, 34, 0, 27, 124, 33, 3, 32, 5, 66, 0, 32, 8, 32, 0, 27, 125, 33, 5, 32, 4, 66, 2, 136, 34, 4, 66, 0, 82, 13, 0, 11, 32, 3, 167, 65, 129, 144, 1, 72, 13, 0, 32, 2, 32, 6, 66, 128, 144, 1, 126, 32, 3, 66, 255, 255, 255, 255, 7, 131, 34, 4, 127, 62, 2, 12, 32, 2, 32, 7, 66, 128, 144, 1, 126, 32, 4, 127, 62, 2, 8, 11, 11, 230, 4, 1, 16, 127, 65, 128, 128, 112, 33, 2, 3, 64, 32, 2, 65, 152, 236, 48, 106, 66, 127, 55, 3, 0, 32, 2, 65, 144, 236, 48, 106, 66, 127, 55, 3, 0, 32, 2, 65, 136, 236, 48, 106, 66, 127, 55, 3, 0, 32, 2, 65, 128, 236, 48, 106, 66, 127, 55, 3, 0, 32, 2, 65, 32, 106, 34, 2, 13, 0, 11, 65, 1, 33, 6, 2, 64, 65, 200, 184, 4, 40, 2, 0, 34, 11, 65, 0, 76, 13, 0, 65, 0, 33, 2, 3, 64, 32, 8, 65, 204, 0, 108, 34, 0, 65, 128, 204, 22, 106, 33, 10, 32, 0, 40, 2, 148, 204, 22, 65, 128, 128, 3, 106, 33, 1, 32, 0, 40, 2, 136, 204, 22, 33, 4, 32, 0, 40, 2, 132, 204, 22, 34, 3, 2, 127, 32, 0, 40, 2, 128, 204, 22, 65, 2, 71, 4, 64, 32, 0, 40, 2, 144, 204, 22, 33, 5, 32, 0, 40, 2, 140, 204, 22, 12, 1, 11, 32, 10, 40, 2, 56, 32, 1, 106, 33, 1, 32, 4, 33, 5, 32, 3, 11, 34, 0, 32, 0, 32, 3, 72, 27, 32, 1, 106, 65, 128, 128, 192, 0, 109, 33, 7, 32, 3, 32, 0, 32, 0, 32, 3, 74, 27, 32, 1, 107, 65, 128, 128, 192, 0, 109, 33, 0, 2, 64, 32, 4, 32, 5, 32, 4, 32, 5, 74, 27, 32, 1, 106, 65, 128, 128, 192, 0, 109, 34, 3, 65, 0, 32, 3, 65, 0, 74, 27, 34, 6, 65, 63, 32, 4, 32, 5, 32, 4, 32, 5, 72, 27, 32, 1, 107, 65, 128, 128, 192, 0, 109, 34, 1, 65, 0, 32, 1, 65, 0, 74, 27, 34, 1, 32, 1, 65, 63, 78, 27, 34, 3, 73, 13, 0, 32, 7, 65, 0, 32, 7, 65, 0, 74, 27, 34, 1, 65, 63, 32, 0, 65, 0, 32, 0, 65, 0, 74, 27, 34, 0, 32, 0, 65, 63, 78, 27, 34, 9, 73, 13, 0, 32, 3, 65, 63, 32, 6, 32, 6, 65, 63, 78, 27, 34, 0, 32, 0, 32, 3, 73, 27, 33, 12, 32, 9, 65, 2, 116, 65, 128, 236, 32, 106, 33, 13, 32, 9, 65, 63, 32, 1, 32, 1, 65, 63, 78, 27, 34, 0, 32, 0, 32, 9, 73, 27, 65, 1, 106, 33, 14, 3, 64, 65, 128, 128, 2, 32, 2, 32, 2, 65, 128, 128, 2, 76, 27, 33, 15, 32, 2, 65, 2, 116, 33, 0, 32, 13, 33, 4, 32, 9, 33, 1, 3, 64, 65, 0, 33, 6, 32, 2, 32, 15, 70, 13, 4, 32, 1, 32, 3, 114, 65, 63, 75, 13, 4, 32, 10, 40, 2, 32, 34, 5, 32, 10, 40, 2, 36, 34, 7, 114, 65, 3, 75, 13, 4, 32, 0, 65, 128, 236, 48, 106, 32, 8, 54, 2, 0, 32, 4, 32, 3, 32, 7, 65, 8, 116, 106, 32, 5, 65, 6, 116, 106, 65, 8, 116, 106, 34, 5, 40, 2, 0, 33, 7, 32, 5, 32, 2, 54, 2, 0, 32, 0, 65, 128, 236, 56, 106, 32, 7, 54, 2, 0, 32, 0, 65, 4, 106, 33, 0, 32, 4, 65, 4, 106, 33, 4, 32, 2, 65, 1, 106, 33, 2, 32, 14, 32, 1, 65, 1, 106, 34, 1, 71, 13, 0, 11, 32, 3, 32, 12, 71, 33, 0, 32, 3, 65, 1, 106, 33, 3, 32, 0, 13, 0, 11, 11, 65, 1, 33, 6, 32, 8, 65, 1, 106, 34, 8, 32, 11, 71, 13, 0, 11, 11, 32, 6, 11, 195, 47, 2, 31, 127, 7, 126, 35, 0, 65, 128, 4, 107, 34, 23, 36, 0, 65, 216, 184, 4, 66, 0, 55, 2, 0, 65, 208, 184, 4, 66, 0, 55, 2, 0, 65, 192, 184, 4, 65, 192, 184, 4, 40, 2, 0, 65, 1, 106, 54, 2, 0, 65, 200, 184, 4, 40, 2, 0, 34, 3, 65, 0, 74, 4, 64, 65, 128, 204, 22, 33, 0, 3, 64, 32, 0, 40, 2, 0, 65, 2, 70, 4, 64, 32, 0, 65, 60, 106, 40, 2, 0, 65, 2, 116, 34, 2, 65, 128, 236, 192, 0, 106, 32, 2, 65, 224, 128, 5, 106, 40, 2, 0, 34, 1, 54, 2, 0, 32, 2, 65, 128, 244, 192, 0, 106, 2, 127, 2, 64, 32, 0, 65, 40, 106, 40, 2, 0, 34, 5, 65, 227, 0, 75, 13, 0, 32, 0, 65, 44, 106, 40, 2, 0, 32, 5, 65, 2, 116, 40, 2, 224, 136, 6, 113, 69, 13, 0, 65, 198, 0, 33, 4, 65, 52, 33, 9, 65, 186, 127, 12, 1, 11, 65, 45, 33, 4, 65, 48, 33, 9, 65, 83, 11, 34, 5, 32, 0, 32, 9, 106, 40, 2, 0, 32, 1, 107, 34, 2, 32, 4, 32, 2, 32, 4, 72, 27, 32, 2, 32, 5, 72, 27, 32, 1, 106, 54, 2, 0, 11, 32, 0, 65, 204, 0, 106, 33, 0, 32, 3, 65, 1, 107, 34, 3, 13, 0, 11, 11, 2, 64, 65, 196, 184, 4, 40, 2, 0, 34, 2, 65, 0, 76, 13, 0, 32, 2, 65, 3, 113, 33, 3, 65, 0, 33, 1, 32, 2, 65, 4, 79, 4, 64, 32, 2, 65, 252, 255, 255, 255, 7, 113, 33, 5, 65, 192, 184, 4, 33, 0, 3, 64, 32, 0, 65, 168, 1, 106, 65, 0, 54, 2, 0, 32, 0, 65, 208, 0, 106, 65, 0, 54, 2, 0, 32, 0, 65, 224, 0, 106, 65, 0, 54, 2, 0, 32, 0, 65, 240, 1, 106, 65, 0, 54, 2, 0, 32, 0, 65, 152, 1, 106, 65, 0, 54, 2, 0, 32, 0, 65, 184, 2, 106, 65, 0, 54, 2, 0, 32, 0, 65, 224, 1, 106, 65, 0, 54, 2, 0, 32, 0, 65, 168, 2, 106, 65, 0, 54, 2, 0, 32, 0, 65, 160, 2, 106, 33, 0, 32, 5, 32, 1, 65, 4, 106, 34, 1, 71, 13, 0, 11, 32, 3, 69, 13, 1, 11, 32, 1, 65, 200, 0, 108, 65, 144, 185, 4, 106, 33, 0, 3, 64, 32, 0, 65, 0, 54, 2, 0, 32, 0, 65, 16, 106, 65, 0, 54, 2, 0, 32, 0, 65, 200, 0, 106, 33, 0, 32, 3, 65, 1, 107, 34, 3, 13, 0, 11, 11, 65, 1, 33, 26, 3, 64, 32, 2, 65, 0, 74, 4, 64, 32, 26, 65, 1, 107, 33, 27, 65, 0, 33, 25, 65, 244, 203, 6, 40, 2, 0, 33, 28, 65, 240, 203, 6, 40, 2, 0, 33, 7, 3, 64, 32, 25, 65, 2, 116, 34, 3, 32, 25, 65, 200, 0, 108, 34, 0, 40, 2, 224, 184, 4, 34, 17, 54, 2, 128, 252, 64, 32, 3, 32, 0, 40, 2, 228, 184, 4, 34, 18, 54, 2, 128, 128, 65, 32, 0, 40, 2, 240, 184, 4, 4, 64, 32, 0, 65, 224, 184, 4, 106, 34, 6, 32, 6, 40, 2, 12, 34, 5, 32, 6, 40, 2, 44, 106, 34, 0, 65, 16, 109, 34, 3, 32, 18, 106, 34, 19, 54, 2, 4, 32, 6, 32, 6, 40, 2, 8, 34, 4, 32, 6, 40, 2, 40, 106, 34, 2, 65, 16, 109, 34, 1, 32, 17, 106, 34, 10, 54, 2, 0, 32, 6, 32, 0, 32, 3, 65, 4, 116, 107, 54, 2, 44, 32, 6, 32, 2, 32, 1, 65, 4, 116, 107, 54, 2, 40, 2, 64, 32, 28, 65, 0, 76, 13, 0, 32, 5, 172, 33, 36, 32, 4, 172, 33, 37, 32, 6, 40, 2, 28, 33, 5, 65, 0, 33, 3, 65, 128, 148, 32, 33, 0, 3, 64, 2, 64, 32, 0, 65, 36, 106, 40, 2, 0, 32, 5, 71, 13, 0, 32, 6, 40, 2, 60, 34, 2, 32, 3, 71, 32, 2, 65, 0, 78, 113, 13, 0, 2, 127, 65, 127, 32, 19, 32, 0, 65, 4, 106, 40, 2, 0, 34, 1, 107, 34, 4, 172, 32, 0, 65, 12, 106, 40, 2, 0, 32, 1, 107, 172, 34, 31, 126, 32, 10, 32, 0, 40, 2, 0, 34, 1, 107, 34, 9, 172, 32, 0, 65, 8, 106, 40, 2, 0, 32, 1, 107, 172, 34, 33, 126, 124, 34, 32, 66, 0, 83, 13, 0, 26, 65, 129, 128, 4, 32, 31, 32, 31, 126, 32, 33, 32, 33, 126, 124, 34, 34, 32, 32, 83, 13, 0, 26, 65, 0, 32, 32, 80, 13, 0, 26, 65, 128, 128, 4, 32, 32, 32, 34, 90, 13, 0, 26, 32, 32, 66, 16, 134, 32, 34, 128, 167, 11, 33, 1, 32, 4, 65, 128, 128, 4, 32, 1, 65, 0, 32, 1, 65, 0, 74, 27, 34, 8, 32, 8, 65, 128, 128, 4, 78, 27, 173, 34, 32, 32, 31, 126, 66, 128, 128, 124, 127, 167, 106, 172, 34, 34, 32, 34, 126, 32, 9, 32, 32, 32, 33, 126, 66, 128, 128, 124, 127, 167, 106, 172, 34, 34, 32, 34, 126, 124, 33, 35, 32, 0, 65, 16, 106, 40, 2, 0, 65, 2, 109, 32, 6, 40, 2, 36, 34, 4, 107, 172, 34, 34, 32, 34, 126, 33, 34, 2, 64, 2, 64, 32, 2, 32, 3, 70, 4, 64, 32, 1, 65, 128, 128, 4, 77, 32, 34, 32, 35, 90, 113, 13, 1, 65, 127, 33, 2, 2, 64, 32, 34, 32, 35, 84, 13, 0, 32, 1, 65, 129, 128, 4, 73, 13, 0, 65, 1, 65, 127, 32, 6, 40, 2, 68, 65, 1, 65, 127, 32, 1, 65, 128, 128, 4, 74, 27, 70, 27, 33, 2, 11, 32, 6, 65, 0, 54, 2, 68, 32, 6, 65, 127, 54, 2, 60, 32, 6, 32, 2, 32, 3, 65, 1, 106, 108, 54, 2, 64, 32, 6, 32, 0, 65, 28, 65, 32, 32, 1, 65, 128, 128, 2, 72, 34, 3, 27, 106, 40, 2, 0, 54, 2, 56, 12, 2, 11, 32, 1, 65, 128, 128, 4, 75, 13, 2, 32, 34, 32, 35, 84, 13, 2, 65, 0, 33, 9, 2, 127, 65, 0, 32, 6, 40, 2, 32, 34, 8, 32, 0, 65, 20, 106, 40, 2, 0, 71, 13, 0, 26, 65, 0, 32, 1, 65, 255, 63, 75, 13, 0, 26, 65, 0, 32, 4, 65, 128, 32, 106, 32, 6, 40, 2, 56, 32, 0, 65, 28, 106, 40, 2, 0, 107, 34, 12, 32, 12, 65, 31, 117, 34, 12, 115, 32, 12, 107, 72, 13, 0, 26, 32, 31, 32, 36, 126, 32, 33, 32, 37, 126, 124, 66, 0, 85, 11, 33, 2, 2, 64, 32, 0, 65, 40, 106, 40, 2, 0, 69, 13, 0, 32, 8, 32, 0, 65, 24, 106, 40, 2, 0, 71, 13, 0, 32, 1, 65, 129, 192, 3, 73, 13, 0, 32, 4, 65, 128, 32, 106, 32, 6, 40, 2, 56, 32, 0, 65, 32, 106, 40, 2, 0, 107, 34, 8, 32, 8, 65, 31, 117, 34, 8, 115, 32, 8, 107, 72, 13, 0, 32, 31, 32, 36, 126, 32, 33, 32, 37, 126, 124, 66, 63, 136, 167, 33, 9, 11, 32, 2, 32, 9, 114, 65, 1, 113, 69, 13, 2, 32, 6, 32, 3, 54, 2, 60, 32, 6, 65, 1, 65, 127, 32, 2, 27, 54, 2, 68, 11, 32, 6, 32, 0, 65, 28, 106, 40, 2, 0, 34, 3, 32, 0, 65, 32, 106, 40, 2, 0, 32, 3, 107, 172, 32, 32, 126, 66, 128, 128, 4, 127, 167, 106, 54, 2, 56, 32, 1, 65, 128, 128, 2, 73, 33, 3, 11, 32, 6, 32, 0, 65, 20, 65, 24, 32, 3, 27, 106, 40, 2, 0, 54, 2, 32, 12, 2, 11, 32, 0, 65, 44, 106, 33, 0, 32, 28, 32, 3, 65, 1, 106, 34, 3, 71, 13, 0, 11, 11, 65, 132, 132, 193, 0, 32, 25, 54, 2, 0, 65, 128, 132, 193, 0, 32, 6, 54, 2, 0, 65, 240, 203, 6, 32, 7, 65, 1, 106, 34, 21, 54, 2, 0, 32, 7, 65, 255, 253, 255, 255, 7, 78, 4, 64, 65, 128, 64, 33, 0, 3, 64, 32, 0, 65, 136, 204, 6, 106, 66, 0, 55, 3, 0, 32, 0, 65, 128, 204, 6, 106, 66, 0, 55, 3, 0, 32, 0, 65, 248, 203, 6, 106, 66, 0, 55, 3, 0, 32, 0, 65, 240, 203, 6, 106, 66, 0, 55, 3, 0, 32, 0, 65, 32, 106, 34, 0, 13, 0, 11, 65, 240, 203, 6, 65, 1, 54, 2, 0, 65, 1, 33, 21, 11, 32, 10, 65, 128, 128, 192, 0, 109, 33, 0, 32, 19, 65, 128, 128, 192, 0, 109, 33, 3, 2, 64, 32, 19, 65, 255, 255, 255, 31, 74, 13, 0, 32, 10, 65, 255, 255, 255, 31, 74, 13, 0, 32, 0, 32, 3, 114, 65, 0, 72, 13, 0, 32, 6, 40, 2, 32, 34, 2, 32, 6, 40, 2, 28, 34, 1, 114, 65, 3, 75, 13, 0, 32, 2, 65, 6, 116, 32, 1, 65, 8, 116, 114, 32, 3, 106, 65, 6, 116, 32, 0, 106, 34, 0, 65, 0, 72, 13, 0, 32, 0, 65, 2, 116, 40, 2, 128, 236, 32, 34, 0, 65, 0, 72, 13, 0, 65, 0, 33, 10, 65, 220, 184, 4, 40, 2, 0, 33, 1, 3, 64, 2, 64, 32, 0, 65, 2, 116, 34, 0, 40, 2, 128, 236, 48, 34, 2, 65, 2, 116, 65, 240, 139, 6, 106, 34, 3, 40, 2, 0, 32, 21, 70, 13, 0, 32, 3, 32, 21, 54, 2, 0, 32, 10, 65, 255, 0, 76, 4, 64, 32, 23, 32, 10, 65, 2, 116, 106, 32, 2, 54, 2, 0, 32, 10, 65, 1, 106, 33, 10, 12, 1, 11, 32, 6, 65, 1, 54, 2, 48, 65, 220, 184, 4, 32, 1, 65, 1, 106, 34, 1, 54, 2, 0, 11, 32, 0, 40, 2, 128, 236, 56, 34, 0, 65, 0, 78, 13, 0, 11, 32, 10, 65, 2, 78, 4, 64, 65, 1, 33, 5, 32, 23, 33, 4, 3, 64, 32, 23, 32, 5, 65, 2, 116, 106, 40, 2, 0, 33, 1, 32, 4, 33, 0, 32, 5, 33, 3, 2, 64, 3, 64, 32, 0, 40, 2, 0, 34, 2, 32, 1, 76, 13, 1, 32, 0, 65, 4, 106, 32, 2, 54, 2, 0, 32, 0, 65, 4, 107, 33, 0, 32, 3, 65, 1, 74, 33, 2, 32, 3, 65, 1, 107, 33, 3, 32, 2, 13, 0, 11, 65, 0, 33, 3, 11, 32, 23, 32, 3, 65, 2, 116, 106, 32, 1, 54, 2, 0, 32, 4, 65, 4, 106, 33, 4, 32, 5, 65, 1, 106, 34, 5, 32, 10, 71, 13, 0, 11, 11, 32, 10, 65, 0, 76, 13, 0, 65, 0, 33, 22, 3, 64, 65, 0, 33, 24, 65, 0, 33, 3, 3, 64, 2, 64, 32, 23, 32, 3, 65, 2, 116, 106, 40, 2, 0, 34, 4, 65, 204, 0, 108, 34, 0, 65, 192, 204, 22, 106, 40, 2, 0, 69, 13, 0, 2, 127, 32, 0, 65, 128, 204, 22, 106, 34, 0, 40, 2, 0, 65, 2, 71, 4, 64, 32, 0, 40, 2, 8, 33, 5, 32, 0, 40, 2, 4, 33, 9, 65, 0, 33, 8, 65, 0, 33, 19, 32, 0, 40, 2, 16, 34, 13, 33, 2, 32, 0, 40, 2, 12, 34, 16, 12, 1, 11, 32, 0, 52, 2, 56, 34, 31, 32, 0, 40, 2, 60, 65, 2, 116, 34, 2, 65, 128, 244, 192, 0, 106, 40, 2, 0, 32, 2, 65, 128, 236, 192, 0, 106, 40, 2, 0, 34, 2, 107, 34, 5, 32, 26, 108, 65, 16, 109, 32, 2, 106, 34, 9, 65, 144, 28, 111, 34, 1, 65, 144, 28, 106, 32, 1, 32, 1, 65, 0, 72, 27, 65, 1, 116, 50, 1, 128, 128, 4, 126, 66, 128, 8, 127, 167, 34, 1, 32, 5, 32, 27, 108, 65, 16, 109, 32, 2, 106, 34, 5, 65, 144, 28, 111, 34, 2, 65, 144, 28, 106, 32, 2, 32, 2, 65, 0, 72, 27, 65, 1, 116, 50, 1, 128, 128, 4, 32, 31, 126, 66, 128, 8, 127, 167, 34, 7, 107, 65, 4, 116, 33, 8, 32, 31, 32, 9, 65, 132, 7, 106, 65, 144, 28, 111, 34, 2, 65, 144, 28, 106, 32, 2, 32, 2, 65, 0, 72, 27, 65, 1, 116, 50, 1, 128, 128, 4, 126, 66, 128, 8, 127, 167, 34, 12, 32, 5, 65, 132, 7, 106, 65, 144, 28, 111, 34, 2, 65, 144, 28, 106, 32, 2, 32, 2, 65, 0, 72, 27, 65, 1, 116, 50, 1, 128, 128, 4, 32, 31, 126, 66, 128, 8, 127, 167, 34, 11, 107, 65, 4, 116, 33, 19, 32, 0, 40, 2, 8, 34, 5, 32, 7, 106, 33, 13, 32, 1, 32, 5, 106, 33, 2, 32, 0, 40, 2, 4, 34, 9, 32, 11, 106, 33, 16, 32, 9, 32, 12, 106, 11, 33, 1, 32, 4, 32, 9, 32, 5, 32, 1, 32, 2, 65, 0, 32, 19, 32, 8, 16, 19, 33, 5, 32, 0, 40, 2, 0, 33, 9, 2, 127, 2, 64, 32, 5, 32, 22, 114, 34, 12, 69, 4, 64, 32, 9, 69, 4, 64, 32, 0, 40, 2, 68, 34, 7, 32, 0, 40, 2, 72, 71, 13, 2, 11, 32, 0, 40, 2, 8, 34, 7, 32, 2, 32, 2, 32, 7, 72, 27, 33, 15, 32, 7, 32, 2, 32, 2, 32, 7, 74, 27, 33, 14, 32, 0, 40, 2, 4, 34, 11, 32, 1, 32, 1, 32, 11, 72, 27, 33, 7, 32, 11, 32, 1, 32, 1, 32, 11, 74, 27, 33, 11, 65, 0, 33, 20, 32, 9, 65, 2, 70, 4, 64, 32, 13, 32, 15, 32, 13, 32, 15, 74, 27, 33, 15, 32, 16, 32, 7, 32, 7, 32, 16, 72, 27, 33, 7, 32, 16, 32, 11, 32, 11, 32, 16, 74, 27, 33, 11, 65, 2, 33, 20, 32, 13, 32, 14, 32, 13, 32, 14, 72, 27, 33, 14, 11, 32, 0, 40, 2, 20, 32, 6, 40, 2, 36, 32, 20, 106, 106, 172, 34, 31, 32, 11, 32, 7, 32, 7, 32, 11, 72, 27, 172, 124, 32, 17, 32, 6, 40, 2, 0, 34, 20, 32, 17, 32, 20, 72, 27, 172, 83, 13, 3, 32, 17, 32, 20, 32, 17, 32, 20, 74, 27, 172, 32, 11, 32, 7, 32, 7, 32, 11, 74, 27, 172, 32, 31, 125, 83, 13, 3, 32, 18, 32, 6, 40, 2, 4, 34, 7, 32, 7, 32, 18, 74, 27, 172, 32, 31, 32, 14, 32, 15, 32, 14, 32, 15, 74, 27, 172, 124, 85, 13, 3, 32, 18, 32, 7, 32, 7, 32, 18, 72, 27, 172, 32, 14, 32, 15, 32, 14, 32, 15, 72, 27, 172, 32, 31, 125, 83, 13, 3, 11, 32, 0, 40, 2, 68, 34, 7, 32, 9, 13, 1, 26, 11, 66, 0, 33, 32, 2, 64, 32, 2, 32, 0, 40, 2, 8, 34, 11, 107, 172, 34, 31, 32, 31, 126, 32, 1, 32, 0, 40, 2, 4, 34, 15, 107, 172, 34, 33, 32, 33, 126, 124, 34, 34, 80, 13, 0, 32, 6, 40, 2, 4, 32, 11, 107, 172, 32, 31, 126, 32, 6, 40, 2, 0, 32, 15, 107, 172, 32, 33, 126, 124, 34, 31, 66, 0, 87, 13, 0, 66, 128, 128, 4, 33, 32, 32, 31, 32, 34, 89, 13, 0, 32, 31, 66, 16, 134, 32, 34, 128, 196, 33, 32, 11, 32, 7, 32, 32, 32, 0, 40, 2, 72, 32, 7, 107, 172, 126, 66, 128, 128, 4, 127, 167, 106, 11, 33, 7, 2, 64, 32, 12, 13, 0, 65, 0, 33, 5, 32, 0, 40, 2, 32, 32, 6, 40, 2, 32, 71, 13, 0, 32, 0, 40, 2, 36, 32, 6, 40, 2, 28, 71, 13, 0, 32, 7, 32, 6, 40, 2, 56, 34, 11, 107, 34, 12, 32, 12, 65, 31, 117, 34, 12, 115, 32, 12, 107, 32, 0, 40, 2, 20, 32, 6, 40, 2, 36, 106, 34, 12, 74, 13, 0, 32, 12, 65, 2, 65, 0, 32, 9, 65, 2, 70, 27, 34, 20, 106, 173, 34, 31, 32, 11, 32, 7, 107, 172, 34, 33, 124, 32, 31, 32, 33, 125, 126, 33, 33, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 32, 3, 64, 32, 32, 34, 31, 66, 2, 136, 33, 32, 32, 31, 32, 33, 86, 13, 0, 11, 32, 17, 32, 18, 32, 6, 40, 2, 0, 34, 7, 32, 6, 40, 2, 4, 34, 12, 32, 0, 40, 2, 4, 34, 11, 32, 0, 40, 2, 8, 34, 15, 32, 1, 32, 2, 32, 31, 80, 4, 127, 65, 0, 5, 66, 0, 33, 32, 3, 64, 32, 32, 66, 1, 136, 66, 0, 32, 31, 32, 33, 32, 31, 32, 32, 124, 34, 34, 84, 34, 5, 27, 124, 33, 32, 32, 33, 66, 0, 32, 34, 32, 5, 27, 125, 33, 33, 32, 31, 66, 2, 136, 34, 31, 66, 0, 82, 13, 0, 11, 32, 32, 167, 11, 34, 5, 16, 20, 33, 0, 2, 64, 2, 64, 32, 9, 65, 2, 71, 4, 64, 32, 1, 33, 9, 32, 2, 33, 14, 12, 1, 11, 32, 13, 32, 2, 32, 17, 32, 18, 32, 7, 32, 12, 32, 11, 32, 15, 32, 16, 32, 13, 32, 5, 16, 20, 34, 29, 65, 0, 78, 32, 0, 32, 29, 75, 113, 34, 30, 27, 33, 14, 32, 16, 32, 1, 32, 30, 27, 33, 9, 32, 29, 32, 0, 32, 30, 27, 33, 0, 32, 17, 32, 18, 32, 7, 32, 12, 32, 16, 32, 13, 32, 1, 32, 2, 32, 5, 16, 20, 34, 5, 65, 0, 72, 13, 0, 32, 0, 32, 5, 77, 13, 1, 32, 2, 33, 14, 32, 1, 33, 9, 32, 13, 33, 15, 32, 16, 33, 11, 32, 5, 33, 0, 12, 1, 11, 65, 0, 33, 5, 32, 0, 65, 0, 72, 13, 1, 11, 32, 6, 32, 18, 32, 0, 173, 34, 31, 32, 12, 32, 18, 107, 172, 126, 66, 128, 128, 4, 127, 167, 106, 54, 2, 4, 32, 6, 32, 17, 32, 31, 32, 7, 32, 17, 107, 172, 126, 66, 128, 128, 4, 127, 167, 106, 54, 2, 0, 65, 1, 33, 5, 32, 4, 32, 11, 32, 15, 32, 9, 32, 14, 32, 20, 32, 19, 32, 8, 16, 19, 13, 0, 32, 6, 32, 12, 54, 2, 4, 32, 6, 32, 7, 54, 2, 0, 65, 0, 33, 5, 11, 32, 5, 32, 24, 106, 33, 24, 11, 32, 3, 65, 1, 106, 34, 3, 32, 10, 71, 13, 0, 11, 32, 24, 69, 13, 1, 32, 22, 65, 3, 71, 33, 0, 32, 22, 65, 1, 106, 33, 22, 32, 0, 13, 0, 11, 32, 6, 65, 1, 54, 2, 48, 65, 220, 184, 4, 65, 220, 184, 4, 40, 2, 0, 65, 1, 106, 54, 2, 0, 11, 32, 21, 33, 7, 65, 196, 184, 4, 40, 2, 0, 33, 2, 11, 32, 25, 65, 1, 106, 34, 25, 32, 2, 72, 13, 0, 11, 11, 2, 64, 65, 248, 203, 6, 40, 2, 0, 34, 0, 65, 0, 76, 13, 0, 32, 0, 65, 3, 113, 33, 3, 65, 0, 33, 1, 32, 0, 65, 4, 79, 4, 64, 32, 0, 65, 252, 255, 255, 255, 7, 113, 33, 5, 65, 144, 132, 193, 0, 33, 0, 3, 64, 32, 0, 40, 2, 0, 65, 2, 116, 65, 128, 204, 6, 106, 65, 127, 54, 2, 0, 32, 0, 65, 4, 106, 40, 2, 0, 65, 2, 116, 65, 128, 204, 6, 106, 65, 127, 54, 2, 0, 32, 0, 65, 8, 106, 40, 2, 0, 65, 2, 116, 65, 128, 204, 6, 106, 65, 127, 54, 2, 0, 32, 0, 65, 12, 106, 40, 2, 0, 65, 2, 116, 65, 128, 204, 6, 106, 65, 127, 54, 2, 0, 32, 0, 65, 16, 106, 33, 0, 32, 5, 32, 1, 65, 4, 106, 34, 1, 71, 13, 0, 11, 32, 3, 69, 13, 1, 11, 32, 1, 65, 2, 116, 65, 144, 132, 193, 0, 106, 33, 0, 3, 64, 32, 0, 40, 2, 0, 65, 2, 116, 65, 128, 204, 6, 106, 65, 127, 54, 2, 0, 32, 0, 65, 4, 106, 33, 0, 32, 3, 65, 1, 107, 34, 3, 13, 0, 11, 11, 65, 248, 203, 6, 65, 0, 54, 2, 0, 32, 2, 65, 0, 74, 4, 64, 32, 2, 65, 1, 106, 33, 1, 32, 2, 65, 200, 0, 108, 65, 152, 184, 4, 106, 33, 0, 32, 2, 65, 2, 116, 65, 140, 136, 193, 0, 106, 33, 3, 65, 0, 33, 10, 3, 64, 2, 64, 32, 0, 65, 16, 106, 40, 2, 0, 69, 4, 64, 32, 3, 65, 127, 54, 2, 0, 12, 1, 11, 32, 0, 65, 28, 106, 40, 2, 0, 33, 5, 32, 0, 65, 32, 106, 40, 2, 0, 33, 4, 32, 0, 40, 2, 0, 34, 19, 65, 128, 128, 192, 0, 109, 33, 9, 32, 0, 65, 4, 106, 40, 2, 0, 34, 8, 65, 128, 128, 192, 0, 109, 33, 6, 2, 64, 2, 64, 32, 8, 65, 255, 255, 255, 31, 74, 13, 0, 32, 19, 65, 255, 255, 255, 31, 74, 13, 0, 32, 4, 32, 5, 114, 65, 3, 75, 13, 0, 32, 6, 32, 9, 114, 65, 0, 72, 13, 0, 32, 6, 32, 4, 65, 6, 116, 32, 5, 65, 8, 116, 114, 106, 65, 6, 116, 32, 9, 106, 34, 5, 65, 0, 78, 13, 1, 11, 32, 3, 65, 127, 54, 2, 0, 12, 1, 11, 32, 5, 65, 2, 116, 34, 4, 65, 128, 204, 6, 106, 33, 9, 32, 4, 40, 2, 128, 204, 6, 34, 4, 65, 127, 70, 4, 64, 65, 248, 203, 6, 32, 10, 65, 1, 106, 34, 6, 54, 2, 0, 32, 10, 65, 2, 116, 65, 144, 132, 193, 0, 106, 32, 5, 54, 2, 0, 32, 6, 33, 10, 11, 32, 9, 32, 1, 65, 2, 107, 54, 2, 0, 32, 3, 32, 4, 54, 2, 0, 11, 32, 0, 65, 200, 0, 107, 33, 0, 32, 3, 65, 4, 107, 33, 3, 32, 1, 65, 1, 107, 34, 1, 65, 1, 75, 13, 0, 11, 11, 32, 2, 65, 0, 74, 4, 64, 65, 0, 33, 3, 3, 64, 32, 3, 65, 200, 0, 108, 34, 0, 40, 2, 240, 184, 4, 4, 64, 32, 3, 65, 2, 116, 34, 2, 65, 128, 128, 193, 0, 106, 33, 18, 32, 2, 65, 128, 252, 192, 0, 106, 33, 17, 32, 0, 65, 224, 184, 4, 106, 34, 2, 40, 2, 4, 65, 128, 128, 192, 0, 109, 34, 0, 65, 1, 106, 33, 28, 32, 2, 40, 2, 0, 65, 128, 128, 192, 0, 109, 34, 1, 65, 1, 106, 33, 19, 32, 1, 65, 1, 107, 33, 21, 32, 0, 65, 1, 107, 33, 9, 3, 64, 32, 9, 65, 63, 74, 33, 6, 32, 21, 33, 0, 3, 64, 32, 0, 33, 5, 2, 64, 32, 6, 13, 0, 32, 0, 65, 63, 74, 13, 0, 32, 0, 32, 9, 114, 65, 0, 72, 13, 0, 32, 2, 40, 2, 32, 34, 0, 32, 2, 40, 2, 28, 34, 1, 114, 65, 3, 75, 13, 0, 32, 0, 65, 6, 116, 32, 1, 65, 8, 116, 114, 32, 9, 106, 65, 6, 116, 32, 5, 106, 34, 0, 65, 0, 72, 13, 0, 32, 0, 65, 2, 116, 40, 2, 128, 204, 6, 34, 0, 65, 0, 72, 13, 0, 3, 64, 2, 64, 32, 0, 32, 3, 77, 13, 0, 32, 0, 65, 200, 0, 108, 34, 1, 40, 2, 240, 184, 4, 69, 13, 0, 32, 2, 40, 2, 28, 32, 1, 65, 224, 184, 4, 106, 34, 1, 40, 2, 28, 71, 13, 0, 32, 2, 40, 2, 32, 32, 1, 40, 2, 32, 71, 13, 0, 32, 2, 40, 2, 56, 34, 12, 32, 1, 40, 2, 56, 107, 34, 4, 32, 4, 65, 31, 117, 34, 8, 115, 32, 8, 107, 32, 1, 40, 2, 36, 32, 2, 40, 2, 36, 106, 34, 8, 74, 13, 0, 65, 212, 184, 4, 65, 212, 184, 4, 40, 2, 0, 65, 1, 106, 54, 2, 0, 32, 2, 40, 2, 0, 34, 16, 32, 1, 40, 2, 0, 107, 34, 10, 32, 17, 40, 2, 0, 34, 24, 32, 0, 65, 2, 116, 34, 13, 40, 2, 128, 252, 64, 34, 22, 107, 34, 7, 32, 7, 32, 10, 74, 27, 32, 8, 74, 13, 0, 65, 0, 32, 8, 107, 34, 15, 32, 10, 32, 7, 32, 7, 32, 10, 72, 27, 74, 13, 0, 32, 2, 40, 2, 4, 34, 14, 32, 1, 40, 2, 4, 107, 34, 11, 32, 18, 40, 2, 0, 34, 20, 32, 13, 40, 2, 128, 128, 65, 34, 27, 107, 34, 13, 32, 11, 32, 13, 72, 27, 32, 8, 74, 13, 0, 32, 11, 32, 13, 32, 11, 32, 13, 74, 27, 32, 15, 72, 13, 0, 32, 8, 173, 34, 31, 32, 4, 172, 34, 33, 124, 32, 31, 32, 33, 125, 126, 33, 33, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 32, 3, 64, 32, 32, 34, 31, 66, 2, 136, 33, 32, 32, 31, 32, 33, 86, 13, 0, 11, 32, 31, 80, 4, 127, 65, 0, 5, 66, 0, 33, 32, 3, 64, 32, 32, 66, 1, 136, 66, 0, 32, 31, 32, 33, 32, 31, 32, 32, 124, 34, 34, 84, 34, 4, 27, 124, 33, 32, 32, 33, 66, 0, 32, 34, 32, 4, 27, 125, 33, 33, 32, 31, 66, 2, 136, 34, 31, 66, 0, 82, 13, 0, 11, 32, 32, 167, 11, 33, 8, 32, 11, 172, 34, 31, 32, 31, 126, 32, 10, 172, 34, 31, 32, 31, 126, 124, 33, 33, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 32, 3, 64, 32, 32, 34, 31, 66, 2, 136, 33, 32, 32, 31, 32, 33, 86, 13, 0, 11, 2, 64, 32, 8, 32, 31, 80, 4, 127, 65, 0, 5, 66, 0, 33, 32, 3, 64, 32, 32, 66, 1, 136, 66, 0, 32, 31, 32, 33, 32, 31, 32, 32, 124, 34, 34, 84, 34, 4, 27, 124, 33, 32, 32, 33, 66, 0, 32, 34, 32, 4, 27, 125, 33, 33, 32, 31, 66, 2, 136, 34, 31, 66, 0, 82, 13, 0, 11, 32, 32, 167, 11, 34, 4, 74, 13, 0, 32, 7, 32, 13, 32, 10, 32, 11, 65, 0, 65, 0, 65, 0, 65, 0, 32, 8, 16, 20, 34, 4, 65, 0, 72, 13, 1, 32, 2, 32, 24, 32, 4, 173, 34, 31, 32, 16, 32, 24, 107, 172, 126, 66, 128, 128, 4, 127, 167, 106, 54, 2, 0, 32, 2, 32, 20, 32, 31, 32, 14, 32, 20, 107, 172, 126, 66, 128, 128, 4, 127, 167, 106, 54, 2, 4, 32, 1, 32, 22, 32, 1, 40, 2, 0, 32, 22, 107, 172, 32, 31, 126, 66, 128, 128, 4, 127, 167, 106, 34, 4, 54, 2, 0, 32, 1, 32, 27, 32, 1, 40, 2, 4, 32, 27, 107, 172, 32, 31, 126, 66, 128, 128, 4, 127, 167, 106, 34, 10, 54, 2, 4, 32, 2, 40, 2, 4, 34, 14, 32, 10, 107, 34, 11, 172, 34, 31, 32, 31, 126, 32, 2, 40, 2, 0, 34, 16, 32, 4, 107, 34, 10, 172, 34, 31, 32, 31, 126, 124, 33, 33, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 32, 3, 64, 32, 32, 34, 31, 66, 2, 136, 33, 32, 32, 31, 32, 33, 86, 13, 0, 11, 32, 31, 80, 4, 64, 65, 0, 33, 4, 12, 1, 11, 66, 0, 33, 32, 3, 64, 32, 32, 66, 1, 136, 66, 0, 32, 31, 32, 33, 32, 31, 32, 32, 124, 34, 34, 84, 34, 4, 27, 124, 33, 32, 32, 33, 66, 0, 32, 34, 32, 4, 27, 125, 33, 33, 32, 31, 66, 2, 136, 34, 31, 66, 0, 82, 13, 0, 11, 32, 32, 167, 33, 4, 11, 32, 2, 32, 14, 32, 11, 65, 0, 32, 4, 27, 172, 66, 10, 134, 32, 4, 65, 128, 8, 32, 4, 27, 34, 7, 172, 34, 33, 127, 196, 34, 31, 32, 8, 32, 7, 107, 65, 4, 106, 65, 2, 109, 172, 34, 32, 126, 66, 128, 8, 127, 167, 34, 8, 106, 54, 2, 4, 32, 2, 32, 16, 32, 10, 65, 128, 120, 32, 4, 27, 172, 66, 10, 134, 32, 33, 127, 196, 34, 33, 32, 32, 126, 66, 128, 8, 127, 167, 34, 4, 106, 54, 2, 0, 32, 1, 32, 1, 40, 2, 4, 32, 8, 107, 54, 2, 4, 32, 1, 32, 1, 40, 2, 0, 32, 4, 107, 54, 2, 0, 32, 31, 32, 2, 40, 2, 12, 34, 4, 32, 1, 40, 2, 12, 107, 172, 126, 32, 33, 32, 2, 40, 2, 8, 34, 8, 32, 1, 40, 2, 8, 107, 172, 126, 124, 66, 128, 8, 127, 34, 32, 167, 34, 10, 65, 0, 78, 13, 0, 32, 2, 32, 8, 66, 0, 32, 32, 125, 66, 255, 255, 255, 255, 15, 131, 66, 194, 7, 126, 66, 10, 136, 34, 32, 32, 33, 126, 66, 128, 8, 127, 167, 34, 7, 106, 54, 2, 8, 32, 2, 32, 4, 32, 31, 32, 32, 126, 66, 128, 8, 127, 167, 34, 11, 106, 54, 2, 12, 32, 1, 32, 1, 40, 2, 8, 32, 7, 107, 34, 8, 54, 2, 8, 32, 1, 32, 1, 40, 2, 12, 32, 11, 107, 34, 7, 54, 2, 12, 32, 2, 52, 2, 12, 34, 35, 32, 35, 126, 32, 2, 52, 2, 8, 34, 36, 32, 36, 126, 124, 33, 33, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 32, 3, 64, 32, 32, 34, 31, 66, 2, 136, 33, 32, 32, 31, 32, 33, 86, 13, 0, 11, 2, 64, 32, 31, 80, 13, 0, 66, 0, 33, 32, 3, 64, 32, 32, 66, 1, 136, 66, 0, 32, 31, 32, 33, 32, 31, 32, 32, 124, 34, 34, 84, 34, 4, 27, 124, 33, 32, 32, 33, 66, 0, 32, 34, 32, 4, 27, 125, 33, 33, 32, 31, 66, 2, 136, 34, 31, 66, 0, 82, 13, 0, 11, 32, 32, 167, 65, 129, 144, 1, 72, 13, 0, 32, 2, 32, 35, 66, 128, 144, 1, 126, 32, 32, 66, 255, 255, 255, 255, 7, 131, 34, 31, 127, 62, 2, 12, 32, 2, 32, 36, 66, 128, 144, 1, 126, 32, 31, 127, 62, 2, 8, 32, 1, 40, 2, 12, 33, 7, 32, 1, 40, 2, 8, 33, 8, 11, 65, 0, 32, 10, 107, 33, 10, 32, 7, 172, 34, 35, 32, 35, 126, 32, 8, 172, 34, 36, 32, 36, 126, 124, 33, 33, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 32, 3, 64, 32, 32, 34, 31, 66, 2, 136, 33, 32, 32, 31, 32, 33, 86, 13, 0, 11, 2, 64, 32, 31, 80, 13, 0, 66, 0, 33, 32, 3, 64, 32, 32, 66, 1, 136, 66, 0, 32, 31, 32, 33, 32, 31, 32, 32, 124, 34, 34, 84, 34, 4, 27, 124, 33, 32, 32, 33, 66, 0, 32, 34, 32, 4, 27, 125, 33, 33, 32, 31, 66, 2, 136, 34, 31, 66, 0, 82, 13, 0, 11, 32, 32, 167, 65, 129, 144, 1, 72, 13, 0, 32, 1, 32, 35, 66, 128, 144, 1, 126, 32, 32, 66, 255, 255, 255, 255, 7, 131, 34, 31, 127, 62, 2, 12, 32, 1, 32, 36, 66, 128, 144, 1, 126, 32, 31, 127, 62, 2, 8, 11, 2, 64, 65, 208, 184, 4, 40, 2, 0, 34, 8, 65, 0, 74, 4, 64, 32, 8, 65, 1, 106, 33, 4, 32, 8, 65, 5, 116, 65, 192, 184, 4, 106, 33, 1, 3, 64, 2, 64, 32, 1, 65, 128, 208, 0, 106, 40, 2, 0, 65, 3, 71, 13, 0, 32, 1, 65, 132, 208, 0, 106, 40, 2, 0, 32, 3, 71, 13, 0, 32, 1, 65, 136, 208, 0, 106, 40, 2, 0, 32, 0, 71, 13, 0, 32, 1, 65, 140, 208, 0, 106, 40, 2, 0, 65, 127, 71, 13, 0, 32, 1, 65, 144, 208, 0, 106, 34, 4, 40, 2, 0, 32, 10, 78, 13, 4, 32, 4, 32, 10, 54, 2, 0, 32, 1, 65, 156, 208, 0, 106, 32, 12, 54, 2, 0, 32, 1, 65, 148, 208, 0, 106, 32, 2, 41, 2, 0, 55, 2, 0, 12, 4, 11, 32, 1, 65, 32, 107, 33, 1, 32, 4, 65, 1, 107, 34, 4, 65, 1, 75, 13, 0, 11, 32, 8, 65, 255, 3, 74, 13, 1, 11, 65, 208, 184, 4, 32, 8, 65, 1, 106, 54, 2, 0, 32, 2, 41, 2, 0, 33, 31, 32, 8, 65, 5, 116, 34, 1, 65, 224, 136, 5, 106, 65, 3, 54, 2, 0, 32, 1, 65, 228, 136, 5, 106, 32, 3, 54, 2, 0, 32, 1, 65, 232, 136, 5, 106, 32, 0, 54, 2, 0, 32, 1, 65, 236, 136, 5, 106, 65, 127, 54, 2, 0, 32, 1, 65, 244, 136, 5, 106, 32, 31, 55, 2, 0, 32, 1, 65, 252, 136, 5, 106, 32, 12, 54, 2, 0, 32, 1, 65, 240, 136, 5, 106, 32, 10, 54, 2, 0, 12, 1, 11, 65, 220, 184, 4, 65, 220, 184, 4, 40, 2, 0, 65, 1, 106, 54, 2, 0, 11, 32, 0, 65, 2, 116, 40, 2, 144, 136, 65, 34, 0, 65, 0, 78, 13, 0, 11, 11, 32, 5, 65, 1, 106, 33, 0, 32, 5, 32, 19, 71, 13, 0, 11, 32, 9, 32, 28, 70, 33, 0, 32, 9, 65, 1, 106, 33, 9, 32, 0, 69, 13, 0, 11, 65, 196, 184, 4, 40, 2, 0, 33, 2, 11, 32, 3, 65, 1, 106, 34, 3, 32, 2, 72, 13, 0, 11, 11, 32, 26, 65, 1, 106, 34, 26, 65, 17, 71, 13, 0, 11, 65, 0, 33, 2, 2, 64, 65, 204, 184, 4, 40, 2, 0, 34, 0, 65, 0, 76, 13, 0, 32, 0, 65, 3, 113, 33, 3, 32, 0, 65, 4, 79, 4, 64, 32, 0, 65, 252, 255, 255, 255, 7, 113, 33, 1, 65, 0, 33, 0, 3, 64, 32, 0, 65, 224, 128, 5, 106, 32, 0, 65, 128, 244, 192, 0, 106, 40, 2, 0, 54, 2, 0, 32, 0, 65, 228, 128, 5, 106, 32, 0, 65, 132, 244, 192, 0, 106, 40, 2, 0, 54, 2, 0, 32, 0, 65, 232, 128, 5, 106, 32, 0, 65, 136, 244, 192, 0, 106, 40, 2, 0, 54, 2, 0, 32, 0, 65, 236, 128, 5, 106, 32, 0, 65, 140, 244, 192, 0, 106, 40, 2, 0, 54, 2, 0, 32, 0, 65, 16, 106, 33, 0, 32, 1, 32, 2, 65, 4, 106, 34, 2, 71, 13, 0, 11, 32, 3, 69, 13, 1, 11, 32, 2, 65, 2, 116, 33, 0, 3, 64, 32, 0, 65, 224, 128, 5, 106, 32, 0, 65, 128, 244, 192, 0, 106, 40, 2, 0, 54, 2, 0, 32, 0, 65, 4, 106, 33, 0, 32, 3, 65, 1, 107, 34, 3, 13, 0, 11, 11, 32, 23, 65, 128, 4, 106, 36, 0, 11, 180, 13, 2, 7, 126, 10, 127, 32, 0, 65, 204, 0, 108, 34, 16, 65, 192, 204, 22, 106, 40, 2, 0, 69, 4, 64, 65, 0, 15, 11, 2, 64, 32, 16, 65, 128, 204, 22, 106, 34, 16, 40, 2, 32, 65, 128, 132, 193, 0, 40, 2, 0, 34, 15, 40, 2, 32, 71, 13, 0, 32, 16, 40, 2, 36, 32, 15, 40, 2, 28, 71, 13, 0, 2, 64, 32, 16, 40, 2, 0, 34, 20, 69, 4, 64, 32, 16, 40, 2, 72, 32, 16, 40, 2, 68, 71, 13, 1, 11, 2, 64, 32, 15, 52, 2, 0, 34, 10, 32, 16, 40, 2, 20, 32, 15, 40, 2, 36, 106, 34, 17, 32, 5, 106, 172, 34, 8, 32, 1, 32, 3, 32, 1, 32, 3, 74, 27, 172, 124, 85, 13, 0, 32, 1, 32, 3, 32, 1, 32, 3, 72, 27, 172, 32, 8, 125, 32, 10, 85, 13, 0, 32, 15, 52, 2, 4, 34, 10, 32, 8, 32, 2, 32, 4, 32, 2, 32, 4, 74, 27, 172, 124, 85, 13, 0, 32, 2, 32, 4, 32, 2, 32, 4, 72, 27, 172, 32, 8, 125, 32, 10, 87, 13, 1, 11, 32, 16, 40, 2, 68, 32, 15, 40, 2, 56, 107, 34, 0, 32, 0, 65, 31, 117, 34, 0, 115, 32, 0, 107, 32, 17, 74, 13, 1, 65, 216, 184, 4, 65, 216, 184, 4, 40, 2, 0, 65, 1, 106, 54, 2, 0, 65, 0, 15, 11, 2, 64, 32, 3, 32, 1, 107, 34, 21, 172, 34, 10, 32, 10, 126, 34, 13, 32, 4, 32, 2, 107, 34, 22, 172, 34, 8, 32, 8, 126, 124, 34, 9, 80, 13, 0, 32, 15, 40, 2, 4, 32, 2, 107, 172, 32, 8, 126, 32, 15, 40, 2, 0, 32, 1, 107, 172, 32, 10, 126, 124, 34, 11, 66, 0, 87, 13, 0, 66, 128, 128, 4, 33, 12, 32, 9, 32, 11, 87, 13, 0, 32, 11, 66, 16, 134, 32, 9, 128, 196, 33, 12, 11, 32, 16, 40, 2, 68, 33, 3, 32, 20, 69, 4, 64, 32, 3, 32, 12, 32, 16, 40, 2, 72, 32, 3, 107, 172, 126, 66, 128, 128, 4, 127, 167, 106, 33, 3, 11, 32, 3, 32, 15, 40, 2, 56, 34, 17, 107, 34, 4, 32, 4, 65, 31, 117, 34, 4, 115, 32, 4, 107, 32, 16, 40, 2, 20, 32, 15, 40, 2, 36, 106, 34, 4, 74, 13, 0, 65, 216, 184, 4, 65, 216, 184, 4, 40, 2, 0, 65, 1, 106, 54, 2, 0, 32, 15, 40, 2, 4, 32, 2, 32, 8, 32, 12, 126, 66, 128, 128, 4, 127, 167, 106, 34, 23, 107, 34, 18, 172, 34, 8, 32, 8, 126, 32, 15, 40, 2, 0, 32, 1, 32, 10, 32, 12, 126, 66, 128, 128, 4, 127, 167, 106, 34, 24, 107, 34, 2, 172, 34, 8, 32, 8, 126, 124, 34, 10, 32, 4, 32, 5, 106, 173, 34, 8, 32, 8, 126, 34, 8, 90, 13, 0, 32, 8, 32, 17, 32, 3, 107, 172, 34, 9, 32, 9, 126, 125, 33, 9, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 11, 3, 64, 32, 11, 34, 8, 66, 2, 136, 33, 11, 32, 8, 32, 9, 86, 13, 0, 11, 32, 8, 80, 4, 127, 65, 0, 5, 66, 0, 33, 11, 3, 64, 32, 11, 66, 1, 136, 66, 0, 32, 8, 32, 9, 32, 8, 32, 11, 124, 34, 14, 84, 34, 1, 27, 124, 33, 11, 32, 9, 66, 0, 32, 14, 32, 1, 27, 125, 33, 9, 32, 8, 66, 2, 136, 34, 8, 66, 0, 82, 13, 0, 11, 32, 11, 167, 11, 33, 3, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 9, 3, 64, 32, 9, 34, 8, 66, 2, 136, 33, 9, 32, 8, 32, 10, 86, 13, 0, 11, 2, 64, 32, 8, 80, 4, 64, 66, 0, 33, 9, 12, 1, 11, 66, 0, 33, 9, 3, 64, 32, 9, 66, 1, 136, 66, 0, 32, 8, 32, 10, 32, 8, 32, 9, 124, 34, 11, 84, 34, 1, 27, 124, 33, 9, 32, 10, 66, 0, 32, 11, 32, 1, 27, 125, 33, 10, 32, 8, 66, 2, 136, 34, 8, 66, 0, 82, 13, 0, 11, 11, 32, 9, 167, 34, 1, 32, 3, 78, 4, 64, 65, 0, 15, 11, 2, 64, 32, 1, 13, 0, 65, 0, 32, 22, 107, 34, 2, 172, 34, 8, 32, 8, 126, 32, 13, 124, 33, 10, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 9, 3, 64, 32, 9, 34, 8, 66, 2, 136, 33, 9, 32, 8, 32, 10, 86, 13, 0, 11, 32, 8, 66, 0, 82, 4, 64, 66, 0, 33, 9, 3, 64, 32, 9, 66, 1, 136, 66, 0, 32, 8, 32, 10, 32, 8, 32, 9, 124, 34, 11, 84, 34, 1, 27, 124, 33, 9, 32, 10, 66, 0, 32, 11, 32, 1, 27, 125, 33, 10, 32, 8, 66, 2, 136, 34, 8, 66, 0, 82, 13, 0, 11, 32, 21, 33, 18, 32, 9, 167, 13, 1, 11, 66, 128, 8, 33, 9, 65, 0, 33, 2, 65, 128, 120, 33, 18, 11, 32, 15, 32, 23, 32, 18, 172, 66, 10, 134, 32, 9, 196, 34, 10, 127, 196, 34, 8, 32, 3, 32, 3, 65, 128, 2, 109, 106, 65, 2, 106, 172, 34, 9, 126, 66, 128, 8, 127, 167, 106, 54, 2, 4, 32, 15, 32, 24, 32, 2, 172, 66, 10, 134, 32, 10, 127, 196, 34, 10, 32, 9, 126, 66, 128, 8, 127, 167, 106, 54, 2, 0, 32, 8, 32, 15, 40, 2, 12, 34, 1, 32, 12, 32, 7, 172, 126, 66, 128, 128, 124, 127, 167, 106, 172, 126, 32, 10, 32, 15, 40, 2, 8, 34, 3, 32, 12, 32, 6, 172, 126, 66, 128, 128, 124, 127, 167, 106, 172, 126, 124, 66, 128, 8, 127, 34, 9, 167, 34, 19, 65, 0, 78, 4, 64, 65, 1, 15, 11, 32, 16, 40, 2, 24, 65, 128, 8, 106, 172, 66, 0, 32, 9, 125, 66, 255, 255, 255, 255, 15, 131, 126, 66, 128, 8, 127, 167, 33, 2, 65, 0, 32, 19, 107, 33, 5, 65, 1, 33, 19, 32, 15, 32, 1, 32, 8, 32, 20, 65, 1, 70, 4, 127, 32, 16, 40, 2, 28, 32, 2, 106, 5, 32, 2, 11, 172, 34, 9, 126, 66, 128, 8, 127, 167, 106, 54, 2, 12, 32, 15, 32, 3, 32, 9, 32, 10, 126, 66, 128, 8, 127, 167, 106, 54, 2, 8, 32, 15, 52, 2, 12, 34, 12, 32, 12, 126, 32, 15, 52, 2, 8, 34, 13, 32, 13, 126, 124, 33, 11, 66, 128, 128, 128, 128, 128, 128, 128, 128, 192, 0, 33, 9, 3, 64, 32, 9, 34, 8, 66, 2, 136, 33, 9, 32, 8, 32, 11, 86, 13, 0, 11, 2, 64, 32, 8, 80, 13, 0, 66, 0, 33, 9, 3, 64, 32, 9, 66, 1, 136, 66, 0, 32, 8, 32, 11, 32, 8, 32, 9, 124, 34, 10, 84, 34, 1, 27, 124, 33, 9, 32, 11, 66, 0, 32, 10, 32, 1, 27, 125, 33, 11, 32, 8, 66, 2, 136, 34, 8, 66, 0, 82, 13, 0, 11, 32, 9, 167, 65, 129, 144, 1, 72, 13, 0, 32, 15, 32, 12, 66, 128, 144, 1, 126, 32, 9, 66, 255, 255, 255, 255, 7, 131, 34, 8, 127, 62, 2, 12, 32, 15, 32, 13, 66, 128, 144, 1, 126, 32, 8, 127, 62, 2, 8, 11, 32, 16, 40, 2, 0, 33, 6, 65, 132, 132, 193, 0, 40, 2, 0, 33, 4, 2, 64, 2, 64, 65, 208, 184, 4, 40, 2, 0, 34, 3, 65, 0, 74, 4, 64, 32, 3, 65, 1, 106, 33, 2, 32, 3, 65, 5, 116, 65, 192, 184, 4, 106, 33, 1, 3, 64, 2, 64, 32, 1, 65, 128, 208, 0, 106, 40, 2, 0, 32, 6, 71, 13, 0, 32, 1, 65, 132, 208, 0, 106, 40, 2, 0, 32, 4, 71, 13, 0, 32, 1, 65, 136, 208, 0, 106, 40, 2, 0, 65, 127, 71, 13, 0, 32, 1, 65, 140, 208, 0, 106, 40, 2, 0, 32, 0, 71, 13, 0, 32, 5, 32, 1, 65, 144, 208, 0, 106, 34, 2, 40, 2, 0, 76, 13, 4, 32, 2, 32, 5, 54, 2, 0, 32, 1, 65, 148, 208, 0, 106, 32, 4, 65, 200, 0, 108, 34, 2, 65, 224, 184, 4, 106, 40, 2, 0, 54, 2, 0, 32, 1, 65, 152, 208, 0, 106, 32, 2, 65, 228, 184, 4, 106, 40, 2, 0, 54, 2, 0, 32, 1, 65, 156, 208, 0, 106, 32, 2, 65, 152, 185, 4, 106, 40, 2, 0, 54, 2, 0, 12, 4, 11, 32, 1, 65, 32, 107, 33, 1, 32, 2, 65, 1, 107, 34, 2, 65, 1, 75, 13, 0, 11, 32, 3, 65, 255, 3, 74, 13, 1, 11, 65, 208, 184, 4, 32, 3, 65, 1, 106, 54, 2, 0, 32, 4, 65, 200, 0, 108, 34, 2, 65, 152, 185, 4, 106, 40, 2, 0, 33, 7, 32, 2, 65, 224, 184, 4, 106, 40, 2, 0, 33, 15, 32, 3, 65, 5, 116, 34, 1, 65, 248, 136, 5, 106, 32, 2, 65, 228, 184, 4, 106, 40, 2, 0, 54, 2, 0, 32, 1, 65, 232, 136, 5, 106, 65, 127, 54, 2, 0, 32, 1, 65, 224, 136, 5, 106, 32, 6, 54, 2, 0, 32, 1, 65, 228, 136, 5, 106, 32, 4, 54, 2, 0, 32, 1, 65, 236, 136, 5, 106, 32, 0, 54, 2, 0, 32, 1, 65, 244, 136, 5, 106, 32, 15, 54, 2, 0, 32, 1, 65, 252, 136, 5, 106, 32, 7, 54, 2, 0, 32, 1, 65, 240, 136, 5, 106, 32, 5, 54, 2, 0, 12, 1, 11, 65, 220, 184, 4, 65, 220, 184, 4, 40, 2, 0, 65, 1, 106, 54, 2, 0, 11, 11, 32, 19, 11, 229, 6, 2, 11, 126, 2, 127, 35, 0, 65, 32, 107, 33, 21, 65, 127, 33, 20, 2, 64, 32, 0, 32, 2, 32, 0, 32, 2, 72, 27, 172, 32, 8, 172, 34, 9, 32, 4, 32, 6, 32, 4, 32, 6, 74, 27, 172, 124, 85, 13, 0, 32, 0, 32, 2, 32, 0, 32, 2, 74, 27, 172, 32, 4, 32, 6, 32, 4, 32, 6, 72, 27, 172, 32, 9, 125, 83, 13, 0, 32, 1, 32, 3, 32, 1, 32, 3, 72, 27, 172, 32, 5, 32, 7, 32, 5, 32, 7, 74, 27, 172, 32, 9, 124, 85, 13, 0, 32, 1, 32, 3, 32, 1, 32, 3, 74, 27, 172, 32, 5, 32, 7, 32, 5, 32, 7, 72, 27, 172, 32, 9, 125, 83, 13, 0, 65, 0, 33, 20, 32, 21, 65, 176, 184, 4, 40, 2, 0, 54, 2, 16, 32, 21, 65, 168, 184, 4, 41, 3, 0, 55, 3, 8, 32, 21, 65, 160, 184, 4, 41, 3, 0, 55, 3, 0, 32, 3, 32, 1, 107, 172, 34, 13, 32, 13, 126, 32, 2, 32, 0, 107, 172, 34, 14, 32, 14, 126, 124, 34, 10, 66, 0, 82, 4, 64, 2, 64, 32, 5, 32, 1, 107, 172, 32, 13, 126, 32, 4, 32, 0, 107, 172, 32, 14, 126, 124, 34, 11, 66, 0, 87, 13, 0, 65, 128, 128, 4, 33, 20, 32, 10, 32, 11, 87, 13, 0, 32, 11, 66, 16, 134, 32, 10, 128, 167, 33, 20, 11, 32, 21, 32, 20, 54, 2, 8, 32, 21, 2, 127, 65, 0, 32, 7, 32, 1, 107, 172, 32, 13, 126, 32, 6, 32, 0, 107, 172, 32, 14, 126, 124, 34, 11, 66, 0, 87, 13, 0, 26, 65, 128, 128, 4, 32, 10, 32, 11, 87, 13, 0, 26, 32, 11, 66, 16, 134, 32, 10, 128, 167, 11, 54, 2, 12, 11, 32, 6, 32, 4, 107, 172, 34, 15, 32, 15, 126, 33, 10, 32, 7, 32, 5, 107, 172, 34, 16, 32, 16, 126, 33, 11, 2, 64, 32, 14, 32, 16, 126, 34, 12, 32, 13, 32, 15, 126, 34, 17, 81, 13, 0, 32, 4, 32, 0, 107, 172, 34, 18, 32, 13, 126, 32, 5, 32, 1, 107, 172, 34, 19, 32, 14, 126, 125, 66, 16, 134, 32, 12, 32, 17, 125, 34, 12, 127, 33, 17, 32, 16, 32, 18, 126, 32, 15, 32, 19, 126, 125, 66, 16, 134, 32, 12, 127, 34, 12, 66, 128, 128, 4, 86, 13, 0, 32, 17, 66, 128, 128, 4, 86, 13, 0, 32, 21, 32, 12, 62, 2, 16, 11, 32, 10, 32, 11, 124, 33, 11, 32, 1, 32, 5, 107, 33, 8, 32, 0, 32, 4, 107, 33, 1, 32, 9, 32, 9, 126, 33, 12, 65, 127, 33, 20, 65, 0, 33, 4, 3, 64, 32, 4, 32, 21, 106, 40, 2, 0, 34, 0, 172, 34, 9, 32, 13, 126, 66, 128, 128, 4, 127, 167, 32, 8, 106, 33, 6, 32, 9, 32, 14, 126, 66, 128, 128, 4, 127, 167, 32, 1, 106, 33, 2, 66, 0, 33, 9, 2, 64, 32, 11, 80, 34, 5, 13, 0, 32, 6, 172, 32, 16, 126, 32, 2, 172, 32, 15, 126, 124, 34, 10, 66, 0, 87, 13, 0, 66, 128, 128, 4, 33, 9, 32, 10, 32, 11, 89, 13, 0, 32, 10, 66, 16, 134, 32, 11, 128, 196, 33, 9, 11, 32, 0, 32, 0, 32, 20, 32, 0, 32, 20, 72, 27, 32, 20, 65, 0, 72, 27, 32, 20, 32, 6, 32, 9, 32, 16, 126, 66, 128, 128, 124, 127, 167, 106, 172, 34, 10, 32, 10, 126, 32, 2, 32, 9, 32, 15, 126, 66, 128, 128, 124, 127, 167, 106, 172, 34, 9, 32, 9, 126, 124, 32, 12, 84, 27, 33, 20, 32, 4, 65, 4, 106, 34, 4, 65, 20, 71, 13, 0, 11, 32, 20, 65, 0, 76, 13, 0, 65, 0, 33, 0, 65, 0, 33, 4, 3, 64, 32, 0, 32, 20, 106, 65, 1, 118, 34, 6, 173, 34, 9, 32, 13, 126, 66, 128, 128, 4, 127, 167, 32, 8, 106, 33, 2, 32, 9, 32, 14, 126, 66, 128, 128, 4, 127, 167, 32, 1, 106, 33, 21, 66, 0, 33, 9, 2, 64, 32, 5, 13, 0, 32, 2, 172, 32, 16, 126, 32, 21, 172, 32, 15, 126, 124, 34, 10, 66, 0, 87, 13, 0, 66, 128, 128, 4, 33, 9, 32, 10, 32, 11, 89, 13, 0, 32, 10, 66, 16, 134, 32, 11, 128, 196, 33, 9, 11, 32, 6, 32, 20, 32, 2, 32, 9, 32, 16, 126, 66, 128, 128, 124, 127, 167, 106, 172, 34, 10, 32, 10, 126, 32, 21, 32, 9, 32, 15, 126, 66, 128, 128, 124, 127, 167, 106, 172, 34, 9, 32, 9, 126, 124, 32, 12, 84, 34, 2, 27, 33, 20, 32, 4, 65, 14, 75, 13, 1, 32, 4, 65, 1, 106, 33, 4, 32, 0, 32, 6, 65, 1, 106, 32, 2, 27, 34, 0, 32, 20, 72, 13, 0, 11, 11, 32, 20, 11, 110, 1, 1, 127, 2, 64, 32, 0, 65, 0, 72, 13, 0, 32, 0, 65, 204, 184, 4, 40, 2, 0, 78, 13, 0, 32, 0, 65, 2, 116, 34, 0, 40, 2, 128, 140, 32, 65, 204, 0, 108, 34, 1, 65, 132, 204, 22, 106, 40, 2, 0, 32, 1, 65, 184, 204, 22, 106, 52, 2, 0, 32, 0, 40, 2, 224, 128, 5, 65, 132, 7, 106, 65, 144, 28, 111, 34, 0, 65, 144, 28, 106, 32, 0, 32, 0, 65, 0, 72, 27, 65, 1, 116, 50, 1, 128, 128, 4, 126, 66, 128, 8, 127, 167, 106, 33, 1, 11, 32, 1, 11, 106, 1, 1, 127, 2, 64, 32, 0, 65, 0, 72, 13, 0, 32, 0, 65, 204, 184, 4, 40, 2, 0, 78, 13, 0, 32, 0, 65, 2, 116, 34, 0, 40, 2, 128, 140, 32, 65, 204, 0, 108, 34, 1, 65, 136, 204, 22, 106, 40, 2, 0, 32, 1, 65, 184, 204, 22, 106, 52, 2, 0, 32, 0, 40, 2, 224, 128, 5, 65, 144, 28, 111, 34, 0, 65, 144, 28, 106, 32, 0, 32, 0, 65, 0, 72, 27, 65, 1, 116, 50, 1, 128, 128, 4, 126, 66, 128, 8, 127, 167, 106, 33, 1, 11, 32, 1, 11, 11, 174, 56, 1, 0, 65, 130, 128, 4, 11, 165, 56, 2, 0, 4, 0, 5, 0, 7, 0, 9, 0, 11, 0, 13, 0, 14, 0, 16, 0, 18, 0, 20, 0, 21, 0, 23, 0, 25, 0, 27, 0, 29, 0, 30, 0, 32, 0, 34, 0, 36, 0, 38, 0, 39, 0, 41, 0, 43, 0, 45, 0, 46, 0, 48, 0, 50, 0, 52, 0, 54, 0, 55, 0, 57, 0, 59, 0, 61, 0, 63, 0, 64, 0, 66, 0, 68, 0, 70, 0, 71, 0, 73, 0, 75, 0, 77, 0, 79, 0, 80, 0, 82, 0, 84, 0, 86, 0, 87, 0, 89, 0, 91, 0, 93, 0, 95, 0, 96, 0, 98, 0, 100, 0, 102, 0, 103, 0, 105, 0, 107, 0, 109, 0, 111, 0, 112, 0, 114, 0, 116, 0, 118, 0, 119, 0, 121, 0, 123, 0, 125, 0, 127, 0, 128, 0, 130, 0, 132, 0, 134, 0, 135, 0, 137, 0, 139, 0, 141, 0, 143, 0, 144, 0, 146, 0, 148, 0, 150, 0, 151, 0, 153, 0, 155, 0, 157, 0, 158, 0, 160, 0, 162, 0, 164, 0, 165, 0, 167, 0, 169, 0, 171, 0, 173, 0, 174, 0, 176, 0, 178, 0, 180, 0, 181, 0, 183, 0, 185, 0, 187, 0, 188, 0, 190, 0, 192, 0, 194, 0, 195, 0, 197, 0, 199, 0, 201, 0, 202, 0, 204, 0, 206, 0, 208, 0, 209, 0, 211, 0, 213, 0, 215, 0, 216, 0, 218, 0, 220, 0, 222, 0, 223, 0, 225, 0, 227, 0, 229, 0, 230, 0, 232, 0, 234, 0, 236, 0, 237, 0, 239, 0, 241, 0, 243, 0, 244, 0, 246, 0, 248, 0, 249, 0, 251, 0, 253, 0, 255, 0, 0, 1, 2, 1, 4, 1, 6, 1, 7, 1, 9, 1, 11, 1, 12, 1, 14, 1, 16, 1, 18, 1, 19, 1, 21, 1, 23, 1, 25, 1, 26, 1, 28, 1, 30, 1, 31, 1, 33, 1, 35, 1, 37, 1, 38, 1, 40, 1, 42, 1, 43, 1, 45, 1, 47, 1, 49, 1, 50, 1, 52, 1, 54, 1, 55, 1, 57, 1, 59, 1, 60, 1, 62, 1, 64, 1, 66, 1, 67, 1, 69, 1, 71, 1, 72, 1, 74, 1, 76, 1, 77, 1, 79, 1, 81, 1, 82, 1, 84, 1, 86, 1, 88, 1, 89, 1, 91, 1, 93, 1, 94, 1, 96, 1, 98, 1, 99, 1, 101, 1, 103, 1, 104, 1, 106, 1, 108, 1, 109, 1, 111, 1, 113, 1, 114, 1, 116, 1, 118, 1, 119, 1, 121, 1, 123, 1, 124, 1, 126, 1, 128, 1, 129, 1, 131, 1, 133, 1, 134, 1, 136, 1, 138, 1, 139, 1, 141, 1, 142, 1, 144, 1, 146, 1, 147, 1, 149, 1, 151, 1, 152, 1, 154, 1, 156, 1, 157, 1, 159, 1, 160, 1, 162, 1, 164, 1, 165, 1, 167, 1, 169, 1, 170, 1, 172, 1, 174, 1, 175, 1, 177, 1, 178, 1, 180, 1, 182, 1, 183, 1, 185, 1, 186, 1, 188, 1, 190, 1, 191, 1, 193, 1, 194, 1, 196, 1, 198, 1, 199, 1, 201, 1, 203, 1, 204, 1, 206, 1, 207, 1, 209, 1, 210, 1, 212, 1, 214, 1, 215, 1, 217, 1, 218, 1, 220, 1, 222, 1, 223, 1, 225, 1, 226, 1, 228, 1, 229, 1, 231, 1, 233, 1, 234, 1, 236, 1, 237, 1, 239, 1, 240, 1, 242, 1, 244, 1, 245, 1, 247, 1, 248, 1, 250, 1, 251, 1, 253, 1, 254, 1, 0, 2, 2, 2, 3, 2, 5, 2, 6, 2, 8, 2, 9, 2, 11, 2, 12, 2, 14, 2, 15, 2, 17, 2, 18, 2, 20, 2, 22, 2, 23, 2, 25, 2, 26, 2, 28, 2, 29, 2, 31, 2, 32, 2, 34, 2, 35, 2, 37, 2, 38, 2, 40, 2, 41, 2, 43, 2, 44, 2, 46, 2, 47, 2, 49, 2, 50, 2, 52, 2, 53, 2, 55, 2, 56, 2, 58, 2, 59, 2, 61, 2, 62, 2, 64, 2, 65, 2, 67, 2, 68, 2, 69, 2, 71, 2, 72, 2, 74, 2, 75, 2, 77, 2, 78, 2, 80, 2, 81, 2, 83, 2, 84, 2, 86, 2, 87, 2, 88, 2, 90, 2, 91, 2, 93, 2, 94, 2, 96, 2, 97, 2, 99, 2, 100, 2, 101, 2, 103, 2, 104, 2, 106, 2, 107, 2, 109, 2, 110, 2, 111, 2, 113, 2, 114, 2, 116, 2, 117, 2, 118, 2, 120, 2, 121, 2, 123, 2, 124, 2, 125, 2, 127, 2, 128, 2, 130, 2, 131, 2, 132, 2, 134, 2, 135, 2, 137, 2, 138, 2, 139, 2, 141, 2, 142, 2, 143, 2, 145, 2, 146, 2, 148, 2, 149, 2, 150, 2, 152, 2, 153, 2, 154, 2, 156, 2, 157, 2, 158, 2, 160, 2, 161, 2, 162, 2, 164, 2, 165, 2, 167, 2, 168, 2, 169, 2, 171, 2, 172, 2, 173, 2, 175, 2, 176, 2, 177, 2, 178, 2, 180, 2, 181, 2, 182, 2, 184, 2, 185, 2, 186, 2, 188, 2, 189, 2, 190, 2, 192, 2, 193, 2, 194, 2, 195, 2, 197, 2, 198, 2, 199, 2, 201, 2, 202, 2, 203, 2, 204, 2, 206, 2, 207, 2, 208, 2, 210, 2, 211, 2, 212, 2, 213, 2, 215, 2, 216, 2, 217, 2, 218, 2, 220, 2, 221, 2, 222, 2, 223, 2, 225, 2, 226, 2, 227, 2, 228, 2, 230, 2, 231, 2, 232, 2, 233, 2, 234, 2, 236, 2, 237, 2, 238, 2, 239, 2, 241, 2, 242, 2, 243, 2, 244, 2, 245, 2, 247, 2, 248, 2, 249, 2, 250, 2, 251, 2, 253, 2, 254, 2, 255, 2, 0, 3, 1, 3, 2, 3, 4, 3, 5, 3, 6, 3, 7, 3, 8, 3, 9, 3, 11, 3, 12, 3, 13, 3, 14, 3, 15, 3, 16, 3, 18, 3, 19, 3, 20, 3, 21, 3, 22, 3, 23, 3, 24, 3, 26, 3, 27, 3, 28, 3, 29, 3, 30, 3, 31, 3, 32, 3, 33, 3, 35, 3, 36, 3, 37, 3, 38, 3, 39, 3, 40, 3, 41, 3, 42, 3, 43, 3, 44, 3, 45, 3, 47, 3, 48, 3, 49, 3, 50, 3, 51, 3, 52, 3, 53, 3, 54, 3, 55, 3, 56, 3, 57, 3, 58, 3, 59, 3, 60, 3, 61, 3, 63, 3, 64, 3, 65, 3, 66, 3, 67, 3, 68, 3, 69, 3, 70, 3, 71, 3, 72, 3, 73, 3, 74, 3, 75, 3, 76, 3, 77, 3, 78, 3, 79, 3, 80, 3, 81, 3, 82, 3, 83, 3, 84, 3, 85, 3, 86, 3, 87, 3, 88, 3, 89, 3, 90, 3, 91, 3, 92, 3, 93, 3, 94, 3, 95, 3, 96, 3, 97, 3, 98, 3, 99, 3, 99, 3, 100, 3, 101, 3, 102, 3, 103, 3, 104, 3, 105, 3, 106, 3, 107, 3, 108, 3, 109, 3, 110, 3, 111, 3, 112, 3, 112, 3, 113, 3, 114, 3, 115, 3, 116, 3, 117, 3, 118, 3, 119, 3, 120, 3, 121, 3, 121, 3, 122, 3, 123, 3, 124, 3, 125, 3, 126, 3, 127, 3, 128, 3, 128, 3, 129, 3, 130, 3, 131, 3, 132, 3, 133, 3, 134, 3, 134, 3, 135, 3, 136, 3, 137, 3, 138, 3, 139, 3, 139, 3, 140, 3, 141, 3, 142, 3, 143, 3, 144, 3, 144, 3, 145, 3, 146, 3, 147, 3, 148, 3, 148, 3, 149, 3, 150, 3, 151, 3, 152, 3, 152, 3, 153, 3, 154, 3, 155, 3, 155, 3, 156, 3, 157, 3, 158, 3, 159, 3, 159, 3, 160, 3, 161, 3, 162, 3, 162, 3, 163, 3, 164, 3, 165, 3, 165, 3, 166, 3, 167, 3, 167, 3, 168, 3, 169, 3, 170, 3, 170, 3, 171, 3, 172, 3, 172, 3, 173, 3, 174, 3, 175, 3, 175, 3, 176, 3, 177, 3, 177, 3, 178, 3, 179, 3, 179, 3, 180, 3, 181, 3, 181, 3, 182, 3, 183, 3, 183, 3, 184, 3, 185, 3, 185, 3, 186, 3, 187, 3, 187, 3, 188, 3, 189, 3, 189, 3, 190, 3, 191, 3, 191, 3, 192, 3, 192, 3, 193, 3, 194, 3, 194, 3, 195, 3, 195, 3, 196, 3, 197, 3, 197, 3, 198, 3, 198, 3, 199, 3, 200, 3, 200, 3, 201, 3, 201, 3, 202, 3, 203, 3, 203, 3, 204, 3, 204, 3, 205, 3, 205, 3, 206, 3, 206, 3, 207, 3, 208, 3, 208, 3, 209, 3, 209, 3, 210, 3, 210, 3, 211, 3, 211, 3, 212, 3, 212, 3, 213, 3, 213, 3, 214, 3, 214, 3, 215, 3, 215, 3, 216, 3, 216, 3, 217, 3, 217, 3, 218, 3, 218, 3, 219, 3, 219, 3, 220, 3, 220, 3, 221, 3, 221, 3, 222, 3, 222, 3, 222, 3, 223, 3, 223, 3, 224, 3, 224, 3, 225, 3, 225, 3, 226, 3, 226, 3, 226, 3, 227, 3, 227, 3, 228, 3, 228, 3, 229, 3, 229, 3, 229, 3, 230, 3, 230, 3, 231, 3, 231, 3, 231, 3, 232, 3, 232, 3, 232, 3, 233, 3, 233, 3, 234, 3, 234, 3, 234, 3, 235, 3, 235, 3, 235, 3, 236, 3, 236, 3, 236, 3, 237, 3, 237, 3, 238, 3, 238, 3, 238, 3, 239, 3, 239, 3, 239, 3, 239, 3, 240, 3, 240, 3, 240, 3, 241, 3, 241, 3, 241, 3, 242, 3, 242, 3, 242, 3, 243, 3, 243, 3, 243, 3, 243, 3, 244, 3, 244, 3, 244, 3, 244, 3, 245, 3, 245, 3, 245, 3, 246, 3, 246, 3, 246, 3, 246, 3, 247, 3, 247, 3, 247, 3, 247, 3, 247, 3, 248, 3, 248, 3, 248, 3, 248, 3, 249, 3, 249, 3, 249, 3, 249, 3, 249, 3, 250, 3, 250, 3, 250, 3, 250, 3, 250, 3, 251, 3, 251, 3, 251, 3, 251, 3, 251, 3, 251, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 253, 3, 253, 3, 253, 3, 253, 3, 253, 3, 253, 3, 253, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 255, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 254, 3, 253, 3, 253, 3, 253, 3, 253, 3, 253, 3, 253, 3, 253, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 251, 3, 251, 3, 251, 3, 251, 3, 251, 3, 251, 3, 250, 3, 250, 3, 250, 3, 250, 3, 250, 3, 249, 3, 249, 3, 249, 3, 249, 3, 249, 3, 248, 3, 248, 3, 248, 3, 248, 3, 247, 3, 247, 3, 247, 3, 247, 3, 247, 3, 246, 3, 246, 3, 246, 3, 246, 3, 245, 3, 245, 3, 245, 3, 244, 3, 244, 3, 244, 3, 244, 3, 243, 3, 243, 3, 243, 3, 243, 3, 242, 3, 242, 3, 242, 3, 241, 3, 241, 3, 241, 3, 240, 3, 240, 3, 240, 3, 239, 3, 239, 3, 239, 3, 239, 3, 238, 3, 238, 3, 238, 3, 237, 3, 237, 3, 236, 3, 236, 3, 236, 3, 235, 3, 235, 3, 235, 3, 234, 3, 234, 3, 234, 3, 233, 3, 233, 3, 232, 3, 232, 3, 232, 3, 231, 3, 231, 3, 231, 3, 230, 3, 230, 3, 229, 3, 229, 3, 229, 3, 228, 3, 228, 3, 227, 3, 227, 3, 226, 3, 226, 3, 226, 3, 225, 3, 225, 3, 224, 3, 224, 3, 223, 3, 223, 3, 222, 3, 222, 3, 222, 3, 221, 3, 221, 3, 220, 3, 220, 3, 219, 3, 219, 3, 218, 3, 218, 3, 217, 3, 217, 3, 216, 3, 216, 3, 215, 3, 215, 3, 214, 3, 214, 3, 213, 3, 213, 3, 212, 3, 212, 3, 211, 3, 211, 3, 210, 3, 210, 3, 209, 3, 209, 3, 208, 3, 208, 3, 207, 3, 206, 3, 206, 3, 205, 3, 205, 3, 204, 3, 204, 3, 203, 3, 203, 3, 202, 3, 201, 3, 201, 3, 200, 3, 200, 3, 199, 3, 198, 3, 198, 3, 197, 3, 197, 3, 196, 3, 195, 3, 195, 3, 194, 3, 194, 3, 193, 3, 192, 3, 192, 3, 191, 3, 191, 3, 190, 3, 189, 3, 189, 3, 188, 3, 187, 3, 187, 3, 186, 3, 185, 3, 185, 3, 184, 3, 183, 3, 183, 3, 182, 3, 181, 3, 181, 3, 180, 3, 179, 3, 179, 3, 178, 3, 177, 3, 177, 3, 176, 3, 175, 3, 175, 3, 174, 3, 173, 3, 172, 3, 172, 3, 171, 3, 170, 3, 170, 3, 169, 3, 168, 3, 167, 3, 167, 3, 166, 3, 165, 3, 165, 3, 164, 3, 163, 3, 162, 3, 162, 3, 161, 3, 160, 3, 159, 3, 159, 3, 158, 3, 157, 3, 156, 3, 155, 3, 155, 3, 154, 3, 153, 3, 152, 3, 152, 3, 151, 3, 150, 3, 149, 3, 148, 3, 148, 3, 147, 3, 146, 3, 145, 3, 144, 3, 144, 3, 143, 3, 142, 3, 141, 3, 140, 3, 139, 3, 139, 3, 138, 3, 137, 3, 136, 3, 135, 3, 134, 3, 134, 3, 133, 3, 132, 3, 131, 3, 130, 3, 129, 3, 128, 3, 128, 3, 127, 3, 126, 3, 125, 3, 124, 3, 123, 3, 122, 3, 121, 3, 121, 3, 120, 3, 119, 3, 118, 3, 117, 3, 116, 3, 115, 3, 114, 3, 113, 3, 112, 3, 112, 3, 111, 3, 110, 3, 109, 3, 108, 3, 107, 3, 106, 3, 105, 3, 104, 3, 103, 3, 102, 3, 101, 3, 100, 3, 99, 3, 99, 3, 98, 3, 97, 3, 96, 3, 95, 3, 94, 3, 93, 3, 92, 3, 91, 3, 90, 3, 89, 3, 88, 3, 87, 3, 86, 3, 85, 3, 84, 3, 83, 3, 82, 3, 81, 3, 80, 3, 79, 3, 78, 3, 77, 3, 76, 3, 75, 3, 74, 3, 73, 3, 72, 3, 71, 3, 70, 3, 69, 3, 68, 3, 67, 3, 66, 3, 65, 3, 64, 3, 63, 3, 61, 3, 60, 3, 59, 3, 58, 3, 57, 3, 56, 3, 55, 3, 54, 3, 53, 3, 52, 3, 51, 3, 50, 3, 49, 3, 48, 3, 47, 3, 45, 3, 44, 3, 43, 3, 42, 3, 41, 3, 40, 3, 39, 3, 38, 3, 37, 3, 36, 3, 35, 3, 33, 3, 32, 3, 31, 3, 30, 3, 29, 3, 28, 3, 27, 3, 26, 3, 24, 3, 23, 3, 22, 3, 21, 3, 20, 3, 19, 3, 18, 3, 16, 3, 15, 3, 14, 3, 13, 3, 12, 3, 11, 3, 9, 3, 8, 3, 7, 3, 6, 3, 5, 3, 4, 3, 2, 3, 1, 3, 0, 3, 255, 2, 254, 2, 253, 2, 251, 2, 250, 2, 249, 2, 248, 2, 247, 2, 245, 2, 244, 2, 243, 2, 242, 2, 241, 2, 239, 2, 238, 2, 237, 2, 236, 2, 234, 2, 233, 2, 232, 2, 231, 2, 230, 2, 228, 2, 227, 2, 226, 2, 225, 2, 223, 2, 222, 2, 221, 2, 220, 2, 218, 2, 217, 2, 216, 2, 215, 2, 213, 2, 212, 2, 211, 2, 210, 2, 208, 2, 207, 2, 206, 2, 204, 2, 203, 2, 202, 2, 201, 2, 199, 2, 198, 2, 197, 2, 195, 2, 194, 2, 193, 2, 192, 2, 190, 2, 189, 2, 188, 2, 186, 2, 185, 2, 184, 2, 182, 2, 181, 2, 180, 2, 178, 2, 177, 2, 176, 2, 175, 2, 173, 2, 172, 2, 171, 2, 169, 2, 168, 2, 167, 2, 165, 2, 164, 2, 162, 2, 161, 2, 160, 2, 158, 2, 157, 2, 156, 2, 154, 2, 153, 2, 152, 2, 150, 2, 149, 2, 148, 2, 146, 2, 145, 2, 143, 2, 142, 2, 141, 2, 139, 2, 138, 2, 137, 2, 135, 2, 134, 2, 132, 2, 131, 2, 130, 2, 128, 2, 127, 2, 125, 2, 124, 2, 123, 2, 121, 2, 120, 2, 118, 2, 117, 2, 116, 2, 114, 2, 113, 2, 111, 2, 110, 2, 109, 2, 107, 2, 106, 2, 104, 2, 103, 2, 101, 2, 100, 2, 99, 2, 97, 2, 96, 2, 94, 2, 93, 2, 91, 2, 90, 2, 88, 2, 87, 2, 86, 2, 84, 2, 83, 2, 81, 2, 80, 2, 78, 2, 77, 2, 75, 2, 74, 2, 72, 2, 71, 2, 69, 2, 68, 2, 67, 2, 65, 2, 64, 2, 62, 2, 61, 2, 59, 2, 58, 2, 56, 2, 55, 2, 53, 2, 52, 2, 50, 2, 49, 2, 47, 2, 46, 2, 44, 2, 43, 2, 41, 2, 40, 2, 38, 2, 37, 2, 35, 2, 34, 2, 32, 2, 31, 2, 29, 2, 28, 2, 26, 2, 25, 2, 23, 2, 22, 2, 20, 2, 18, 2, 17, 2, 15, 2, 14, 2, 12, 2, 11, 2, 9, 2, 8, 2, 6, 2, 5, 2, 3, 2, 2, 2, 0, 2, 254, 1, 253, 1, 251, 1, 250, 1, 248, 1, 247, 1, 245, 1, 244, 1, 242, 1, 240, 1, 239, 1, 237, 1, 236, 1, 234, 1, 233, 1, 231, 1, 229, 1, 228, 1, 226, 1, 225, 1, 223, 1, 222, 1, 220, 1, 218, 1, 217, 1, 215, 1, 214, 1, 212, 1, 210, 1, 209, 1, 207, 1, 206, 1, 204, 1, 203, 1, 201, 1, 199, 1, 198, 1, 196, 1, 194, 1, 193, 1, 191, 1, 190, 1, 188, 1, 186, 1, 185, 1, 183, 1, 182, 1, 180, 1, 178, 1, 177, 1, 175, 1, 174, 1, 172, 1, 170, 1, 169, 1, 167, 1, 165, 1, 164, 1, 162, 1, 160, 1, 159, 1, 157, 1, 156, 1, 154, 1, 152, 1, 151, 1, 149, 1, 147, 1, 146, 1, 144, 1, 142, 1, 141, 1, 139, 1, 138, 1, 136, 1, 134, 1, 133, 1, 131, 1, 129, 1, 128, 1, 126, 1, 124, 1, 123, 1, 121, 1, 119, 1, 118, 1, 116, 1, 114, 1, 113, 1, 111, 1, 109, 1, 108, 1, 106, 1, 104, 1, 103, 1, 101, 1, 99, 1, 98, 1, 96, 1, 94, 1, 93, 1, 91, 1, 89, 1, 88, 1, 86, 1, 84, 1, 82, 1, 81, 1, 79, 1, 77, 1, 76, 1, 74, 1, 72, 1, 71, 1, 69, 1, 67, 1, 66, 1, 64, 1, 62, 1, 60, 1, 59, 1, 57, 1, 55, 1, 54, 1, 52, 1, 50, 1, 49, 1, 47, 1, 45, 1, 43, 1, 42, 1, 40, 1, 38, 1, 37, 1, 35, 1, 33, 1, 31, 1, 30, 1, 28, 1, 26, 1, 25, 1, 23, 1, 21, 1, 19, 1, 18, 1, 16, 1, 14, 1, 12, 1, 11, 1, 9, 1, 7, 1, 6, 1, 4, 1, 2, 1, 0, 1, 255, 0, 253, 0, 251, 0, 249, 0, 248, 0, 246, 0, 244, 0, 243, 0, 241, 0, 239, 0, 237, 0, 236, 0, 234, 0, 232, 0, 230, 0, 229, 0, 227, 0, 225, 0, 223, 0, 222, 0, 220, 0, 218, 0, 216, 0, 215, 0, 213, 0, 211, 0, 209, 0, 208, 0, 206, 0, 204, 0, 202, 0, 201, 0, 199, 0, 197, 0, 195, 0, 194, 0, 192, 0, 190, 0, 188, 0, 187, 0, 185, 0, 183, 0, 181, 0, 180, 0, 178, 0, 176, 0, 174, 0, 173, 0, 171, 0, 169, 0, 167, 0, 165, 0, 164, 0, 162, 0, 160, 0, 158, 0, 157, 0, 155, 0, 153, 0, 151, 0, 150, 0, 148, 0, 146, 0, 144, 0, 143, 0, 141, 0, 139, 0, 137, 0, 135, 0, 134, 0, 132, 0, 130, 0, 128, 0, 127, 0, 125, 0, 123, 0, 121, 0, 119, 0, 118, 0, 116, 0, 114, 0, 112, 0, 111, 0, 109, 0, 107, 0, 105, 0, 103, 0, 102, 0, 100, 0, 98, 0, 96, 0, 95, 0, 93, 0, 91, 0, 89, 0, 87, 0, 86, 0, 84, 0, 82, 0, 80, 0, 79, 0, 77, 0, 75, 0, 73, 0, 71, 0, 70, 0, 68, 0, 66, 0, 64, 0, 63, 0, 61, 0, 59, 0, 57, 0, 55, 0, 54, 0, 52, 0, 50, 0, 48, 0, 46, 0, 45, 0, 43, 0, 41, 0, 39, 0, 38, 0, 36, 0, 34, 0, 32, 0, 30, 0, 29, 0, 27, 0, 25, 0, 23, 0, 21, 0, 20, 0, 18, 0, 16, 0, 14, 0, 13, 0, 11, 0, 9, 0, 7, 0, 5, 0, 4, 0, 2, 0, 0, 0, 254, 255, 252, 255, 251, 255, 249, 255, 247, 255, 245, 255, 243, 255, 242, 255, 240, 255, 238, 255, 236, 255, 235, 255, 233, 255, 231, 255, 229, 255, 227, 255, 226, 255, 224, 255, 222, 255, 220, 255, 218, 255, 217, 255, 215, 255, 213, 255, 211, 255, 210, 255, 208, 255, 206, 255, 204, 255, 202, 255, 201, 255, 199, 255, 197, 255, 195, 255, 193, 255, 192, 255, 190, 255, 188, 255, 186, 255, 185, 255, 183, 255, 181, 255, 179, 255, 177, 255, 176, 255, 174, 255, 172, 255, 170, 255, 169, 255, 167, 255, 165, 255, 163, 255, 161, 255, 160, 255, 158, 255, 156, 255, 154, 255, 153, 255, 151, 255, 149, 255, 147, 255, 145, 255, 144, 255, 142, 255, 140, 255, 138, 255, 137, 255, 135, 255, 133, 255, 131, 255, 129, 255, 128, 255, 126, 255, 124, 255, 122, 255, 121, 255, 119, 255, 117, 255, 115, 255, 113, 255, 112, 255, 110, 255, 108, 255, 106, 255, 105, 255, 103, 255, 101, 255, 99, 255, 98, 255, 96, 255, 94, 255, 92, 255, 91, 255, 89, 255, 87, 255, 85, 255, 83, 255, 82, 255, 80, 255, 78, 255, 76, 255, 75, 255, 73, 255, 71, 255, 69, 255, 68, 255, 66, 255, 64, 255, 62, 255, 61, 255, 59, 255, 57, 255, 55, 255, 54, 255, 52, 255, 50, 255, 48, 255, 47, 255, 45, 255, 43, 255, 41, 255, 40, 255, 38, 255, 36, 255, 34, 255, 33, 255, 31, 255, 29, 255, 27, 255, 26, 255, 24, 255, 22, 255, 20, 255, 19, 255, 17, 255, 15, 255, 13, 255, 12, 255, 10, 255, 8, 255, 7, 255, 5, 255, 3, 255, 1, 255, 0, 255, 254, 254, 252, 254, 250, 254, 249, 254, 247, 254, 245, 254, 244, 254, 242, 254, 240, 254, 238, 254, 237, 254, 235, 254, 233, 254, 231, 254, 230, 254, 228, 254, 226, 254, 225, 254, 223, 254, 221, 254, 219, 254, 218, 254, 216, 254, 214, 254, 213, 254, 211, 254, 209, 254, 207, 254, 206, 254, 204, 254, 202, 254, 201, 254, 199, 254, 197, 254, 196, 254, 194, 254, 192, 254, 190, 254, 189, 254, 187, 254, 185, 254, 184, 254, 182, 254, 180, 254, 179, 254, 177, 254, 175, 254, 174, 254, 172, 254, 170, 254, 168, 254, 167, 254, 165, 254, 163, 254, 162, 254, 160, 254, 158, 254, 157, 254, 155, 254, 153, 254, 152, 254, 150, 254, 148, 254, 147, 254, 145, 254, 143, 254, 142, 254, 140, 254, 138, 254, 137, 254, 135, 254, 133, 254, 132, 254, 130, 254, 128, 254, 127, 254, 125, 254, 123, 254, 122, 254, 120, 254, 118, 254, 117, 254, 115, 254, 114, 254, 112, 254, 110, 254, 109, 254, 107, 254, 105, 254, 104, 254, 102, 254, 100, 254, 99, 254, 97, 254, 96, 254, 94, 254, 92, 254, 91, 254, 89, 254, 87, 254, 86, 254, 84, 254, 82, 254, 81, 254, 79, 254, 78, 254, 76, 254, 74, 254, 73, 254, 71, 254, 70, 254, 68, 254, 66, 254, 65, 254, 63, 254, 62, 254, 60, 254, 58, 254, 57, 254, 55, 254, 53, 254, 52, 254, 50, 254, 49, 254, 47, 254, 46, 254, 44, 254, 42, 254, 41, 254, 39, 254, 38, 254, 36, 254, 34, 254, 33, 254, 31, 254, 30, 254, 28, 254, 27, 254, 25, 254, 23, 254, 22, 254, 20, 254, 19, 254, 17, 254, 16, 254, 14, 254, 12, 254, 11, 254, 9, 254, 8, 254, 6, 254, 5, 254, 3, 254, 2, 254, 0, 254, 254, 253, 253, 253, 251, 253, 250, 253, 248, 253, 247, 253, 245, 253, 244, 253, 242, 253, 241, 253, 239, 253, 238, 253, 236, 253, 234, 253, 233, 253, 231, 253, 230, 253, 228, 253, 227, 253, 225, 253, 224, 253, 222, 253, 221, 253, 219, 253, 218, 253, 216, 253, 215, 253, 213, 253, 212, 253, 210, 253, 209, 253, 207, 253, 206, 253, 204, 253, 203, 253, 201, 253, 200, 253, 198, 253, 197, 253, 195, 253, 194, 253, 192, 253, 191, 253, 189, 253, 188, 253, 187, 253, 185, 253, 184, 253, 182, 253, 181, 253, 179, 253, 178, 253, 176, 253, 175, 253, 173, 253, 172, 253, 170, 253, 169, 253, 168, 253, 166, 253, 165, 253, 163, 253, 162, 253, 160, 253, 159, 253, 157, 253, 156, 253, 155, 253, 153, 253, 152, 253, 150, 253, 149, 253, 147, 253, 146, 253, 145, 253, 143, 253, 142, 253, 140, 253, 139, 253, 138, 253, 136, 253, 135, 253, 133, 253, 132, 253, 131, 253, 129, 253, 128, 253, 126, 253, 125, 253, 124, 253, 122, 253, 121, 253, 119, 253, 118, 253, 117, 253, 115, 253, 114, 253, 113, 253, 111, 253, 110, 253, 108, 253, 107, 253, 106, 253, 104, 253, 103, 253, 102, 253, 100, 253, 99, 253, 98, 253, 96, 253, 95, 253, 94, 253, 92, 253, 91, 253, 89, 253, 88, 253, 87, 253, 85, 253, 84, 253, 83, 253, 81, 253, 80, 253, 79, 253, 78, 253, 76, 253, 75, 253, 74, 253, 72, 253, 71, 253, 70, 253, 68, 253, 67, 253, 66, 253, 64, 253, 63, 253, 62, 253, 61, 253, 59, 253, 58, 253, 57, 253, 55, 253, 54, 253, 53, 253, 52, 253, 50, 253, 49, 253, 48, 253, 46, 253, 45, 253, 44, 253, 43, 253, 41, 253, 40, 253, 39, 253, 38, 253, 36, 253, 35, 253, 34, 253, 33, 253, 31, 253, 30, 253, 29, 253, 28, 253, 26, 253, 25, 253, 24, 253, 23, 253, 22, 253, 20, 253, 19, 253, 18, 253, 17, 253, 15, 253, 14, 253, 13, 253, 12, 253, 11, 253, 9, 253, 8, 253, 7, 253, 6, 253, 5, 253, 3, 253, 2, 253, 1, 253, 0, 253, 255, 252, 254, 252, 252, 252, 251, 252, 250, 252, 249, 252, 248, 252, 247, 252, 245, 252, 244, 252, 243, 252, 242, 252, 241, 252, 240, 252, 238, 252, 237, 252, 236, 252, 235, 252, 234, 252, 233, 252, 232, 252, 230, 252, 229, 252, 228, 252, 227, 252, 226, 252, 225, 252, 224, 252, 223, 252, 221, 252, 220, 252, 219, 252, 218, 252, 217, 252, 216, 252, 215, 252, 214, 252, 213, 252, 212, 252, 211, 252, 209, 252, 208, 252, 207, 252, 206, 252, 205, 252, 204, 252, 203, 252, 202, 252, 201, 252, 200, 252, 199, 252, 198, 252, 197, 252, 196, 252, 195, 252, 193, 252, 192, 252, 191, 252, 190, 252, 189, 252, 188, 252, 187, 252, 186, 252, 185, 252, 184, 252, 183, 252, 182, 252, 181, 252, 180, 252, 179, 252, 178, 252, 177, 252, 176, 252, 175, 252, 174, 252, 173, 252, 172, 252, 171, 252, 170, 252, 169, 252, 168, 252, 167, 252, 166, 252, 165, 252, 164, 252, 163, 252, 162, 252, 161, 252, 160, 252, 159, 252, 158, 252, 157, 252, 157, 252, 156, 252, 155, 252, 154, 252, 153, 252, 152, 252, 151, 252, 150, 252, 149, 252, 148, 252, 147, 252, 146, 252, 145, 252, 144, 252, 144, 252, 143, 252, 142, 252, 141, 252, 140, 252, 139, 252, 138, 252, 137, 252, 136, 252, 135, 252, 135, 252, 134, 252, 133, 252, 132, 252, 131, 252, 130, 252, 129, 252, 128, 252, 128, 252, 127, 252, 126, 252, 125, 252, 124, 252, 123, 252, 122, 252, 122, 252, 121, 252, 120, 252, 119, 252, 118, 252, 117, 252, 117, 252, 116, 252, 115, 252, 114, 252, 113, 252, 112, 252, 112, 252, 111, 252, 110, 252, 109, 252, 108, 252, 108, 252, 107, 252, 106, 252, 105, 252, 104, 252, 104, 252, 103, 252, 102, 252, 101, 252, 101, 252, 100, 252, 99, 252, 98, 252, 97, 252, 97, 252, 96, 252, 95, 252, 94, 252, 94, 252, 93, 252, 92, 252, 91, 252, 91, 252, 90, 252, 89, 252, 89, 252, 88, 252, 87, 252, 86, 252, 86, 252, 85, 252, 84, 252, 84, 252, 83, 252, 82, 252, 81, 252, 81, 252, 80, 252, 79, 252, 79, 252, 78, 252, 77, 252, 77, 252, 76, 252, 75, 252, 75, 252, 74, 252, 73, 252, 73, 252, 72, 252, 71, 252, 71, 252, 70, 252, 69, 252, 69, 252, 68, 252, 67, 252, 67, 252, 66, 252, 65, 252, 65, 252, 64, 252, 64, 252, 63, 252, 62, 252, 62, 252, 61, 252, 61, 252, 60, 252, 59, 252, 59, 252, 58, 252, 58, 252, 57, 252, 56, 252, 56, 252, 55, 252, 55, 252, 54, 252, 53, 252, 53, 252, 52, 252, 52, 252, 51, 252, 51, 252, 50, 252, 50, 252, 49, 252, 48, 252, 48, 252, 47, 252, 47, 252, 46, 252, 46, 252, 45, 252, 45, 252, 44, 252, 44, 252, 43, 252, 43, 252, 42, 252, 42, 252, 41, 252, 41, 252, 40, 252, 40, 252, 39, 252, 39, 252, 38, 252, 38, 252, 37, 252, 37, 252, 36, 252, 36, 252, 35, 252, 35, 252, 34, 252, 34, 252, 34, 252, 33, 252, 33, 252, 32, 252, 32, 252, 31, 252, 31, 252, 30, 252, 30, 252, 30, 252, 29, 252, 29, 252, 28, 252, 28, 252, 27, 252, 27, 252, 27, 252, 26, 252, 26, 252, 25, 252, 25, 252, 25, 252, 24, 252, 24, 252, 24, 252, 23, 252, 23, 252, 22, 252, 22, 252, 22, 252, 21, 252, 21, 252, 21, 252, 20, 252, 20, 252, 20, 252, 19, 252, 19, 252, 18, 252, 18, 252, 18, 252, 17, 252, 17, 252, 17, 252, 17, 252, 16, 252, 16, 252, 16, 252, 15, 252, 15, 252, 15, 252, 14, 252, 14, 252, 14, 252, 13, 252, 13, 252, 13, 252, 13, 252, 12, 252, 12, 252, 12, 252, 12, 252, 11, 252, 11, 252, 11, 252, 10, 252, 10, 252, 10, 252, 10, 252, 9, 252, 9, 252, 9, 252, 9, 252, 9, 252, 8, 252, 8, 252, 8, 252, 8, 252, 7, 252, 7, 252, 7, 252, 7, 252, 7, 252, 6, 252, 6, 252, 6, 252, 6, 252, 6, 252, 5, 252, 5, 252, 5, 252, 5, 252, 5, 252, 5, 252, 4, 252, 4, 252, 4, 252, 4, 252, 4, 252, 4, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 0, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 1, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 2, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 3, 252, 4, 252, 4, 252, 4, 252, 4, 252, 4, 252, 4, 252, 5, 252, 5, 252, 5, 252, 5, 252, 5, 252, 5, 252, 6, 252, 6, 252, 6, 252, 6, 252, 6, 252, 7, 252, 7, 252, 7, 252, 7, 252, 7, 252, 8, 252, 8, 252, 8, 252, 8, 252, 9, 252, 9, 252, 9, 252, 9, 252, 9, 252, 10, 252, 10, 252, 10, 252, 10, 252, 11, 252, 11, 252, 11, 252, 12, 252, 12, 252, 12, 252, 12, 252, 13, 252, 13, 252, 13, 252, 13, 252, 14, 252, 14, 252, 14, 252, 15, 252, 15, 252, 15, 252, 16, 252, 16, 252, 16, 252, 17, 252, 17, 252, 17, 252, 17, 252, 18, 252, 18, 252, 18, 252, 19, 252, 19, 252, 20, 252, 20, 252, 20, 252, 21, 252, 21, 252, 21, 252, 22, 252, 22, 252, 22, 252, 23, 252, 23, 252, 24, 252, 24, 252, 24, 252, 25, 252, 25, 252, 25, 252, 26, 252, 26, 252, 27, 252, 27, 252, 27, 252, 28, 252, 28, 252, 29, 252, 29, 252, 30, 252, 30, 252, 30, 252, 31, 252, 31, 252, 32, 252, 32, 252, 33, 252, 33, 252, 34, 252, 34, 252, 34, 252, 35, 252, 35, 252, 36, 252, 36, 252, 37, 252, 37, 252, 38, 252, 38, 252, 39, 252, 39, 252, 40, 252, 40, 252, 41, 252, 41, 252, 42, 252, 42, 252, 43, 252, 43, 252, 44, 252, 44, 252, 45, 252, 45, 252, 46, 252, 46, 252, 47, 252, 47, 252, 48, 252, 48, 252, 49, 252, 50, 252, 50, 252, 51, 252, 51, 252, 52, 252, 52, 252, 53, 252, 53, 252, 54, 252, 55, 252, 55, 252, 56, 252, 56, 252, 57, 252, 58, 252, 58, 252, 59, 252, 59, 252, 60, 252, 61, 252, 61, 252, 62, 252, 62, 252, 63, 252, 64, 252, 64, 252, 65, 252, 65, 252, 66, 252, 67, 252, 67, 252, 68, 252, 69, 252, 69, 252, 70, 252, 71, 252, 71, 252, 72, 252, 73, 252, 73, 252, 74, 252, 75, 252, 75, 252, 76, 252, 77, 252, 77, 252, 78, 252, 79, 252, 79, 252, 80, 252, 81, 252, 81, 252, 82, 252, 83, 252, 84, 252, 84, 252, 85, 252, 86, 252, 86, 252, 87, 252, 88, 252, 89, 252, 89, 252, 90, 252, 91, 252, 91, 252, 92, 252, 93, 252, 94, 252, 94, 252, 95, 252, 96, 252, 97, 252, 97, 252, 98, 252, 99, 252, 100, 252, 101, 252, 101, 252, 102, 252, 103, 252, 104, 252, 104, 252, 105, 252, 106, 252, 107, 252, 108, 252, 108, 252, 109, 252, 110, 252, 111, 252, 112, 252, 112, 252, 113, 252, 114, 252, 115, 252, 116, 252, 117, 252, 117, 252, 118, 252, 119, 252, 120, 252, 121, 252, 122, 252, 122, 252, 123, 252, 124, 252, 125, 252, 126, 252, 127, 252, 128, 252, 128, 252, 129, 252, 130, 252, 131, 252, 132, 252, 133, 252, 134, 252, 135, 252, 135, 252, 136, 252, 137, 252, 138, 252, 139, 252, 140, 252, 141, 252, 142, 252, 143, 252, 144, 252, 144, 252, 145, 252, 146, 252, 147, 252, 148, 252, 149, 252, 150, 252, 151, 252, 152, 252, 153, 252, 154, 252, 155, 252, 156, 252, 157, 252, 157, 252, 158, 252, 159, 252, 160, 252, 161, 252, 162, 252, 163, 252, 164, 252, 165, 252, 166, 252, 167, 252, 168, 252, 169, 252, 170, 252, 171, 252, 172, 252, 173, 252, 174, 252, 175, 252, 176, 252, 177, 252, 178, 252, 179, 252, 180, 252, 181, 252, 182, 252, 183, 252, 184, 252, 185, 252, 186, 252, 187, 252, 188, 252, 189, 252, 190, 252, 191, 252, 192, 252, 193, 252, 195, 252, 196, 252, 197, 252, 198, 252, 199, 252, 200, 252, 201, 252, 202, 252, 203, 252, 204, 252, 205, 252, 206, 252, 207, 252, 208, 252, 209, 252, 211, 252, 212, 252, 213, 252, 214, 252, 215, 252, 216, 252, 217, 252, 218, 252, 219, 252, 220, 252, 221, 252, 223, 252, 224, 252, 225, 252, 226, 252, 227, 252, 228, 252, 229, 252, 230, 252, 232, 252, 233, 252, 234, 252, 235, 252, 236, 252, 237, 252, 238, 252, 240, 252, 241, 252, 242, 252, 243, 252, 244, 252, 245, 252, 247, 252, 248, 252, 249, 252, 250, 252, 251, 252, 252, 252, 254, 252, 255, 252, 0, 253, 1, 253, 2, 253, 3, 253, 5, 253, 6, 253, 7, 253, 8, 253, 9, 253, 11, 253, 12, 253, 13, 253, 14, 253, 15, 253, 17, 253, 18, 253, 19, 253, 20, 253, 22, 253, 23, 253, 24, 253, 25, 253, 26, 253, 28, 253, 29, 253, 30, 253, 31, 253, 33, 253, 34, 253, 35, 253, 36, 253, 38, 253, 39, 253, 40, 253, 41, 253, 43, 253, 44, 253, 45, 253, 46, 253, 48, 253, 49, 253, 50, 253, 52, 253, 53, 253, 54, 253, 55, 253, 57, 253, 58, 253, 59, 253, 61, 253, 62, 253, 63, 253, 64, 253, 66, 253, 67, 253, 68, 253, 70, 253, 71, 253, 72, 253, 74, 253, 75, 253, 76, 253, 78, 253, 79, 253, 80, 253, 81, 253, 83, 253, 84, 253, 85, 253, 87, 253, 88, 253, 89, 253, 91, 253, 92, 253, 94, 253, 95, 253, 96, 253, 98, 253, 99, 253, 100, 253, 102, 253, 103, 253, 104, 253, 106, 253, 107, 253, 108, 253, 110, 253, 111, 253, 113, 253, 114, 253, 115, 253, 117, 253, 118, 253, 119, 253, 121, 253, 122, 253, 124, 253, 125, 253, 126, 253, 128, 253, 129, 253, 131, 253, 132, 253, 133, 253, 135, 253, 136, 253, 138, 253, 139, 253, 140, 253, 142, 253, 143, 253, 145, 253, 146, 253, 147, 253, 149, 253, 150, 253, 152, 253, 153, 253, 155, 253, 156, 253, 157, 253, 159, 253, 160, 253, 162, 253, 163, 253, 165, 253, 166, 253, 168, 253, 169, 253, 170, 253, 172, 253, 173, 253, 175, 253, 176, 253, 178, 253, 179, 253, 181, 253, 182, 253, 184, 253, 185, 253, 187, 253, 188, 253, 189, 253, 191, 253, 192, 253, 194, 253, 195, 253, 197, 253, 198, 253, 200, 253, 201, 253, 203, 253, 204, 253, 206, 253, 207, 253, 209, 253, 210, 253, 212, 253, 213, 253, 215, 253, 216, 253, 218, 253, 219, 253, 221, 253, 222, 253, 224, 253, 225, 253, 227, 253, 228, 253, 230, 253, 231, 253, 233, 253, 234, 253, 236, 253, 238, 253, 239, 253, 241, 253, 242, 253, 244, 253, 245, 253, 247, 253, 248, 253, 250, 253, 251, 253, 253, 253, 254, 253, 0, 254, 2, 254, 3, 254, 5, 254, 6, 254, 8, 254, 9, 254, 11, 254, 12, 254, 14, 254, 16, 254, 17, 254, 19, 254, 20, 254, 22, 254, 23, 254, 25, 254, 27, 254, 28, 254, 30, 254, 31, 254, 33, 254, 34, 254, 36, 254, 38, 254, 39, 254, 41, 254, 42, 254, 44, 254, 46, 254, 47, 254, 49, 254, 50, 254, 52, 254, 53, 254, 55, 254, 57, 254, 58, 254, 60, 254, 62, 254, 63, 254, 65, 254, 66, 254, 68, 254, 70, 254, 71, 254, 73, 254, 74, 254, 76, 254, 78, 254, 79, 254, 81, 254, 82, 254, 84, 254, 86, 254, 87, 254, 89, 254, 91, 254, 92, 254, 94, 254, 96, 254, 97, 254, 99, 254, 100, 254, 102, 254, 104, 254, 105, 254, 107, 254, 109, 254, 110, 254, 112, 254, 114, 254, 115, 254, 117, 254, 118, 254, 120, 254, 122, 254, 123, 254, 125, 254, 127, 254, 128, 254, 130, 254, 132, 254, 133, 254, 135, 254, 137, 254, 138, 254, 140, 254, 142, 254, 143, 254, 145, 254, 147, 254, 148, 254, 150, 254, 152, 254, 153, 254, 155, 254, 157, 254, 158, 254, 160, 254, 162, 254, 163, 254, 165, 254, 167, 254, 168, 254, 170, 254, 172, 254, 174, 254, 175, 254, 177, 254, 179, 254, 180, 254, 182, 254, 184, 254, 185, 254, 187, 254, 189, 254, 190, 254, 192, 254, 194, 254, 196, 254, 197, 254, 199, 254, 201, 254, 202, 254, 204, 254, 206, 254, 207, 254, 209, 254, 211, 254, 213, 254, 214, 254, 216, 254, 218, 254, 219, 254, 221, 254, 223, 254, 225, 254, 226, 254, 228, 254, 230, 254, 231, 254, 233, 254, 235, 254, 237, 254, 238, 254, 240, 254, 242, 254, 244, 254, 245, 254, 247, 254, 249, 254, 250, 254, 252, 254, 254, 254, 0, 255, 1, 255, 3, 255, 5, 255, 7, 255, 8, 255, 10, 255, 12, 255, 13, 255, 15, 255, 17, 255, 19, 255, 20, 255, 22, 255, 24, 255, 26, 255, 27, 255, 29, 255, 31, 255, 33, 255, 34, 255, 36, 255, 38, 255, 40, 255, 41, 255, 43, 255, 45, 255, 47, 255, 48, 255, 50, 255, 52, 255, 54, 255, 55, 255, 57, 255, 59, 255, 61, 255, 62, 255, 64, 255, 66, 255, 68, 255, 69, 255, 71, 255, 73, 255, 75, 255, 76, 255, 78, 255, 80, 255, 82, 255, 83, 255, 85, 255, 87, 255, 89, 255, 91, 255, 92, 255, 94, 255, 96, 255, 98, 255, 99, 255, 101, 255, 103, 255, 105, 255, 106, 255, 108, 255, 110, 255, 112, 255, 113, 255, 115, 255, 117, 255, 119, 255, 121, 255, 122, 255, 124, 255, 126, 255, 128, 255, 129, 255, 131, 255, 133, 255, 135, 255, 137, 255, 138, 255, 140, 255, 142, 255, 144, 255, 145, 255, 147, 255, 149, 255, 151, 255, 153, 255, 154, 255, 156, 255, 158, 255, 160, 255, 161, 255, 163, 255, 165, 255, 167, 255, 169, 255, 170, 255, 172, 255, 174, 255, 176, 255, 177, 255, 179, 255, 181, 255, 183, 255, 185, 255, 186, 255, 188, 255, 190, 255, 192, 255, 193, 255, 195, 255, 197, 255, 199, 255, 201, 255, 202, 255, 204, 255, 206, 255, 208, 255, 210, 255, 211, 255, 213, 255, 215, 255, 217, 255, 218, 255, 220, 255, 222, 255, 224, 255, 226, 255, 227, 255, 229, 255, 231, 255, 233, 255, 235, 255, 236, 255, 238, 255, 240, 255, 242, 255, 243, 255, 245, 255, 247, 255, 249, 255, 251, 255, 252, 255, 254, 255, 0, 0, 0, 0, 0, 0, 1, 0, 148, 1, 15, 116, 97, 114, 103, 101, 116, 95, 102, 101, 97, 116, 117, 114, 101, 115, 8, 43, 15, 109, 117, 116, 97, 98, 108, 101, 45, 103, 108, 111, 98, 97, 108, 115, 43, 19, 110, 111, 110, 116, 114, 97, 112, 112, 105, 110, 103, 45, 102, 112, 116, 111, 105, 110, 116, 43, 11, 98, 117, 108, 107, 45, 109, 101, 109, 111, 114, 121, 43, 8, 115, 105, 103, 110, 45, 101, 120, 116, 43, 15, 114, 101, 102, 101, 114, 101, 110, 99, 101, 45, 116, 121, 112, 101, 115, 43, 10, 109, 117, 108, 116, 105, 118, 97, 108, 117, 101, 43, 15, 98, 117, 108, 107, 45, 109, 101, 109, 111, 114, 121, 45, 111, 112, 116, 43, 22, 99, 97, 108, 108, 45, 105, 110, 100, 105, 114, 101, 99, 116, 45, 111, 118, 101, 114, 108, 111, 110, 103]);
// packages/codec/src/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function sha256(data) {
  const h = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const len = data.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(data);
  padded[len] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len * 8 / 2 ** 32));
  view.setUint32(padded.length - 4, len * 8 >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0;off < padded.length; off += 64) {
    for (let i = 0;i < 16; i += 1)
      w[i] = view.getUint32(off + i * 4);
    for (let i = 16;i < 64; i += 1) {
      const a2 = w[i - 15], b2 = w[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0;i < 64; i += 1) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = hh + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0;i < 8; i += 1)
    ov.setUint32(i * 4, h[i]);
  return out;
}
var toHex = (b) => {
  let s = "";
  for (let i = 0;i < b.length; i += 1)
    s += b[i].toString(16).padStart(2, "0");
  return s;
};

// packages/pinball-arena/src/storm.ts
var Q2 = 1024;
var integer2 = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
function integerSquareRoot(value) {
  if (value < 0n)
    throw Error("Negative integer square root");
  if (value < 2n)
    return value;
  let current = value, next = current + 1n >> 1n;
  while (next < current) {
    current = next;
    next = current + value / current >> 1n;
  }
  return current;
}
function createFixedStorm(bounds, arenaId, mode, delayTicks, durationTicks, enabled = true) {
  if (typeof enabled !== "boolean" || !Array.isArray(bounds) || bounds.length !== 4 || bounds.some((n) => !Number.isFinite(n) || Math.abs(n) > 65535) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3] || !integer2(delayTicks, 0, 432000) || !integer2(durationTicks, 1, 432000) || !["battle", "expedition"].includes(mode))
    throw Error("Invalid fixed storm");
  const [left, top, right, bottom] = bounds.map((n) => Math.round(n * Q2));
  const dx = BigInt(right - left), dy = BigInt(bottom - top), startQ = Number(integerSquareRoot(dx * dx + dy * dy) >> 1n), centerX2Q = left + right, centerY2Q = top + bottom;
  let cachedTick = -1, cachedRadiusQ = startQ;
  function radiusQ(tick) {
    if (!integer2(tick, 0, 432000))
      throw Error("Invalid storm tick");
    if (!enabled)
      return startQ;
    if (tick !== cachedTick) {
      const elapsed = Math.min(durationTicks, Math.max(0, tick - delayTicks));
      cachedRadiusQ = Math.max(160 * Q2, Number(BigInt(startQ) * BigInt(durationTicks - elapsed) / BigInt(durationTicks)));
      cachedTick = tick;
    }
    return cachedRadiusQ;
  }
  function read(tick) {
    return { active: enabled && mode === "battle" && tick > delayTicks, arenaId, x: centerX2Q / (2 * Q2), y: centerY2Q / (2 * Q2), radius: radiusQ(tick) / Q2 };
  }
  function isOutside(point, tick) {
    const xQ = Math.round(point.x * Q2), yQ = Math.round(point.y * Q2);
    if (!integer2(xQ, -2147483648, 2147483647) || !integer2(yQ, -2147483648, 2147483647))
      throw Error("Invalid storm point");
    if (!enabled)
      return false;
    const dx2Q = 2 * xQ - centerX2Q, dy2Q = 2 * yQ - centerY2Q, r2Q = 2 * radiusQ(tick);
    if (Math.abs(dx2Q) <= 67108863 && Math.abs(dy2Q) <= 67108863 && r2Q <= 94906265)
      return dx2Q * dx2Q + dy2Q * dy2Q > r2Q * r2Q;
    const x = BigInt(dx2Q), y = BigInt(dy2Q), r = BigInt(r2Q);
    return x * x + y * y > r * r;
  }
  return { read, isOutside, startRadiusQ: startQ };
}

// packages/pinball-arena/src/index.ts
var ARENA_VERSION = "keel-pinball-arena@1";
var ARENA_AUTHORITY_REVISION = "shared-arena/2026-10-07.17";
var ARENA_HZ = 120;
var ARENA_CONTENT_LIMITS = Object.freeze({ players: 100, bodies: 128, colliders: 2048, flippers: 256, ramps: 256, captures: 256, mechanisms: 512, coordinate: 65535, elevation: 400, eventRecords: 4096, layers: 4, arenas: 4 });
var ArenaInput = Object.freeze({ LEFT: 1, RIGHT: 2, LAUNCH: 4, DASH: 8, PULSE: 16, SHIELD: 32 });
var Q3 = 1024;
var HEADER = 8;
var BALL_STRIDE = 18;
var ANGLE_OFFSET = HEADER + 128 * BALL_STRIDE;
var EVENT_OFFSET = ANGLE_OFFSET + 256;
var encode = (v) => new TextEncoder().encode(JSON.stringify(v));
var hash = (v) => toHex(sha256(encode(v)));
var q = (n) => Math.round(n * Q3);
var integer3 = (n, lo, hi) => typeof n === "number" && Number.isSafeInteger(n) && n >= lo && n <= hi;
var finite2 = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
function inside(p, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1;i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
      hit = !hit;
  }
  return hit;
}
function supportHeight(p, surface) {
  if (!inside(p, surface.polygon))
    return null;
  const zs = surface.vertexElevations;
  if (!zs)
    return surface.height;
  const a = surface.polygon[0];
  for (let i = 1;i + 1 < surface.polygon.length; i++) {
    const b = surface.polygon[i], c = surface.polygon[i + 1], den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(den) < 0.000000001)
      continue;
    const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / den, v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / den, w = 1 - u - v;
    if (u >= -0.00000001 && v >= -0.00000001 && w >= -0.00000001)
      return u * zs[0] + v * zs[i] + w * zs[i + 1];
  }
  return null;
}
var distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
var distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var fraction = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, ll = dx * dx + dy * dy;
  return ll ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ll)) : 0;
};
var wasm;
function createArenaRoster(options = {}) {
  const count = options.players ?? 100, size = options.teamSize ?? 5;
  if (!integer3(count, 1, 100) || ![1, 5].includes(size) || !integer3(options.humanOwnerId ?? 0, 0, count - 1))
    throw new Error("Invalid arena roster");
  return Object.freeze(Array.from({ length: count }, (_, ownerId) => Object.freeze({ ownerId, teamId: Math.floor(ownerId / size), name: ownerId === (options.humanOwnerId ?? 0) ? "YOU" : `RIVAL ${ownerId + 1}`, role: ["vector", "anchor", "weaver"][ownerId % 3], bot: ownerId !== (options.humanOwnerId ?? 0) })));
}
function admitArenaInput(input) {
  if (!integer3(input.ownerId, 0, 99) || !integer3(input.bits, 0, 63) || !finite2(input.steerX ?? 0, -1, 1) || !finite2(input.steerY ?? 0, -1, 1))
    throw new Error("Invalid owner input");
  return { ownerId: input.ownerId, bits: input.bits, steerX: Math.round((input.steerX ?? 0) * 127) / 127, steerY: Math.round((input.steerY ?? 0) * 127) / 127 };
}
function validateArenaWorld(world) {
  if (world.schema !== "keel-pinball-arena-world@1" || !finite2(world.unitScale, 0.001, 1) || !Array.isArray(world.arenas) || world.arenas.length < 1 || world.arenas.length > 4)
    throw new Error("Invalid arena world");
  const { canonical, sha256: checksum, ...body } = world;
  if (canonical !== JSON.stringify(body) || checksum !== hash(body))
    throw new Error("Arena descriptor identity mismatch");
  const ids = new Set;
  let colliders = 0, flippers = 0, ramps = 0, captures = 0;
  const id = (s) => {
    if (typeof s !== "string" || !s.length || s.length > 120 || ids.has(s))
      throw new Error("Duplicate or invalid arena item ID");
    ids.add(s);
  };
  const point = (x, y) => {
    if (!finite2(x, 0, 65535) || !finite2(y, 0, 65535))
      throw new Error("Arena coordinates exceed shared grid");
  };
  const layer = (n) => {
    if (!integer3(n, 0, 3))
      throw new Error("Invalid arena collision layer");
  };
  for (const a of world.arenas) {
    id(a.id);
    if (a.gravity && (!finite2(a.gravity.x, -0.12, 0.12) || !finite2(a.gravity.y, -0.12, 0.12)))
      throw new Error("Invalid field gravity");
    if (a.bounds.length !== 4 || a.bounds.some((n) => !finite2(n, 0, 65535)) || a.bounds[2] <= a.bounds[0] || a.bounds[3] <= a.bounds[1])
      throw new Error("Invalid arena bounds");
    assertArenaFieldScenes(a);
    for (const r of [...a.rails, ...a.gates]) {
      id(r.id);
      point(r.ax, r.ay);
      point(r.bx, r.by);
      layer(r.layer);
      if (!finite2(r.elevation, 0, 400) || !finite2("elevationB" in r ? r.elevationB ?? r.elevation : r.elevation, 0, 400) || !finite2(r.radius, 0, 64) || !finite2(r.restitution, 0, 1) || Math.hypot(r.bx - r.ax, r.by - r.ay) > 1100)
        throw new Error("Invalid or overly long arena rail");
      colliders++;
    }
    for (const b of a.bumpers) {
      id(b.id);
      point(b.x, b.y);
      layer(b.layer);
      if (!finite2(b.radius, 4, 80) || !finite2(b.impulse, 0, 12))
        throw new Error("Invalid arena bumper");
      colliders++;
    }
    for (const f of a.flippers) {
      id(f.id);
      point(f.pivotX, f.pivotY);
      layer(f.layer);
      if (!integer3(f.ownerId, -1, 99) || !finite2(f.length, 16, 96) || !finite2(f.radius, 2, 12) || !finite2(f.restAngle, -360, 360) || !finite2(f.activeAngle, -360, 360) || Math.abs(f.activeAngle - f.restAngle) > 100)
        throw new Error("Invalid arena flipper");
      colliders++;
      flippers++;
    }
    for (const s of a.stations) {
      id(s.id);
      point(s.x, s.y);
      point(s.launchX, s.launchY);
      layer(s.layer);
      if (!finite2(s.launchVx, -18, 18) || !finite2(s.launchVy, -18, 18) || !finite2(s.captureRadius ?? 0, 0, 80))
        throw new Error("Invalid station launch");
      for (const f of s.flipperIds)
        if (!a.flippers.some((x) => x.id === f))
          throw new Error("Station names missing flipper");
    }
    for (const s of a.switches) {
      id(s.id);
      point(s.x, s.y);
      layer(s.layer);
      if (!finite2(s.radius, 12, 80) || !integer3(s.holdTicks, 1, 1e5))
        throw new Error("Invalid switch");
      for (const g of s.gateIds)
        if (!a.gates.some((x) => x.id === g))
          throw new Error("Switch names missing gate");
    }
    for (const r of a.ramps) {
      ramps++;
      id(r.id);
      point(r.ax, r.ay);
      point(r.bx, r.by);
      layer(r.fromLayer);
      layer(r.toLayer);
      if (!finite2(r.width, 32, 400) || !finite2(r.fromElevation, 0, 400) || !finite2(r.toElevation, 0, 400) || Math.hypot(r.bx - r.ax, r.by - r.ay) > 1100)
        throw new Error("Invalid ramp");
    }
    for (const p of a.portals) {
      id(p.id);
      point(p.x, p.y);
      layer(p.layer);
      if (!finite2(p.radius, 24, 100) || !finite2(p.angle, -360, 360))
        throw new Error("Invalid portal");
      const target = world.arenas.find((x) => x.id === p.targetArenaId)?.portals.find((x) => x.id === p.targetPortalId);
      if (!target)
        throw new Error("Portal destination absent");
    }
    for (const c of a.challenges ?? []) {
      id(c.id);
      if (c.kind !== undefined && !["main-shot", "launch-skillshot"].includes(c.kind) || c.maxTraversalTicks !== undefined && !integer3(c.maxTraversalTicks, 60, 12000) || c.entryDirection && (!finite2(c.entryDirection.x, -1, 1) || !finite2(c.entryDirection.y, -1, 1) || Math.abs(Math.hypot(c.entryDirection.x, c.entryDirection.y) - 1) > 0.01) || c.sourceFlipperIds?.some((id2) => !a.flippers.some((f) => f.id === id2)))
        throw new Error("Invalid shot admission");
      if (c.finalColliderId && ![...a.rails, ...a.gates, ...a.bumpers, ...a.flippers].some((x) => x.id === c.finalColliderId))
        throw new Error("Route final collider absent");
      if (c.checkpoints.length < 2 || c.checkpoints.length > 8)
        throw new Error("Route challenge checkpoint count");
      for (const p of c.checkpoints) {
        point(p.x, p.y);
        layer(p.layer);
        if (!finite2(p.radius, 24, 180) || !finite2(p.elevation, 0, 400))
          throw new Error("Invalid route checkpoint");
      }
    }
    for (const r of a.requirements ?? []) {
      id(r.id);
      const groups = r.routeGroups ?? r.routeIds.map((id2) => [id2]);
      if (!["owner", "team"].includes(r.scope) || r.routeIds.length < 2 || r.routeIds.length > 64 || r.gateIds.length < 1 || r.gateIds.length > 8 || !integer3(r.holdTicks, 1, 1e5) || typeof r.persistent !== "boolean" || new Set(r.routeIds).size !== r.routeIds.length || !Array.isArray(groups) || groups.length < 2 || groups.length > 8 || groups.some((group) => !Array.isArray(group) || group.length < 1 || group.length > 32 || group.some((id2) => !a.challenges?.some((c) => c.id === id2))) || groups.flat().length !== r.routeIds.length || new Set(groups.flat()).size !== r.routeIds.length || r.routeIds.some((id2) => !groups.flat().includes(id2)) || r.gateIds.some((id2) => !a.gates.some((g) => g.id === id2)))
        throw new Error("Invalid compound gate requirement");
    }
    for (const h of a.hazards ?? []) {
      id(h.id);
      point(h.x, h.y);
      layer(h.layer);
      if (!["damage", "drain"].includes(h.kind) || !finite2(h.radius, 12, 200) || !integer3(h.damage, 0, 100) || !integer3(h.cooldownTicks, 1, 1e5))
        throw new Error("Invalid hazard");
    }
    for (const f of a.flows) {
      id(f.id);
      point(f.ax, f.ay);
      point(f.bx, f.by);
      layer(f.layer);
      if (!finite2(f.elevation ?? 0, 0, 400) || !finite2(f.width, 24, 600) || !finite2(f.fx, -0.2, 0.2) || !finite2(f.fy, -0.2, 0.2) || !finite2(f.maxSpeed, 0, 18))
        throw new Error("Invalid induction flow");
    }
    for (const s of a.surfaces) {
      id(s.id);
      layer(s.layer);
      if (s.polygon.length < 3 || s.polygon.length > 32 || !finite2(s.height, 0, 400) || s.vertexElevations && (s.vertexElevations.length !== s.polygon.length || s.vertexElevations.some((z) => !finite2(z, 0, 400))) || s.rampId && !a.ramps.some((r) => r.id === s.rampId))
        throw new Error("Invalid surface");
      for (const p of s.polygon)
        point(p.x, p.y);
    }
    for (const port of a.pinball?.ports ?? []) {
      id(port.id);
      point(port.x, port.y);
      layer(port.layer);
      if (!finite2(port.elevation, 0, 400) || !finite2(port.clearWidth, 24, 400) || !finite2(port.maxBallRadius, 6, 24) || port.surfaceIds.length > 256 || port.surfaceIds.some((id2) => !a.surfaces.some((s) => s.id === id2)) || !finite2(port.tangent.x, -1, 1) || !finite2(port.tangent.y, -1, 1) || Math.abs(Math.hypot(port.tangent.x, port.tangent.y) - 1) > 0.001)
        throw new Error("Invalid canonical port");
    }
    for (const c of a.captures ?? []) {
      id(c.id);
      captures++;
      const qualificationId = c.release.kind === "qualification" ? c.release.id : null;
      if (c.busyGateIds.length < 1 || c.busyGateIds.length > 8 || new Set(c.busyGateIds).size !== c.busyGateIds.length || c.busyGateIds.some((id2) => !a.gates.some((g) => g.id === id2)) || c.release.kind === "qualification" && !world.arenas.some((a2) => a2.requirements?.some((r) => r.id === qualificationId)))
        throw new Error("Invalid capture gate/qualification");
    }
    for (const c of a.chunks) {
      id(c.id);
      if (c.instances.length > 64)
        throw new Error("Chunk detail record cap");
      for (const item of c.instances)
        if (item.anchorSurfaceId !== undefined && (typeof item.anchorSurfaceId !== "string" || !a.surfaces.some((s) => s.id === item.anchorSurfaceId && s.layer === c.layer)))
          throw new Error("Art mounting surface absent from chunk layer");
    }
  }
  createCaptureController(arenaCaptureBindings(world));
  arenaMechanismSpecs(world);
  arenaEventBudget(world, 1);
  if (captures > ARENA_CONTENT_LIMITS.captures)
    throw new Error("Capture capacity exceeded");
  if (colliders > ARENA_CONTENT_LIMITS.colliders || flippers > ARENA_CONTENT_LIMITS.flippers || ramps > ARENA_CONTENT_LIMITS.ramps)
    throw new Error("Shared arena collider capacity exceeded");
}
function createArenaMatch(candidate, options = {}) {
  validateArenaWorld(candidate);
  const freeze2 = (v) => {
    if (v && typeof v === "object") {
      for (const child of Object.values(v))
        freeze2(child);
      Object.freeze(v);
    }
    return v;
  };
  const world = freeze2(JSON.parse(JSON.stringify(candidate)));
  const players = (options.players ?? createArenaRoster()).map((p) => Object.freeze({ ...p })).sort((a, b) => a.ownerId - b.ownerId), mode = options.mode ?? "battle", stormEnabled = options.stormEnabled ?? true, maxTicks = options.maxTicks ?? 120 * 600, stormDelay = options.stormDelayTicks ?? Math.min(maxTicks, 120 * 45), stormDuration = options.stormDurationTicks ?? 120 * 180, defeatPolicy = options.defeatPolicy ?? (mode === "battle" ? "eliminate" : "recover"), launchDeadline = options.launchDeadlineTicks ?? Math.min(maxTicks, 600);
  if (options.stormEnabled !== undefined && typeof options.stormEnabled !== "boolean" || typeof stormEnabled !== "boolean" || players.length < 1 || players.length > 100 || !["battle", "expedition"].includes(mode) || !["eliminate", "recover"].includes(defeatPolicy) || !integer3(maxTicks, 120, 120 * 3600) || !integer3(stormDelay, 0, maxTicks) || !integer3(stormDuration, 120, 120 * 3600) || !integer3(launchDeadline, 1, maxTicks))
    throw new Error("Invalid arena match rules");
  const owners = new Set;
  for (const p of players) {
    if (!integer3(p.ownerId, 0, 99) || owners.has(p.ownerId) || !integer3(p.teamId, 0, 99) || !["vector", "anchor", "weaver"].includes(p.role) || !finite2(p.maxHealth ?? 6, 1, 100) || !integer3(p.maxHealth ?? 6, 1, 100) || !finite2(p.ballRadius ?? 12, 6, 24))
      throw new Error("Invalid accepted player");
    owners.add(p.ownerId);
  }
  assertArenaEventBudget(world, players.length);
  const identity = hash({ authority: ARENA_AUTHORITY_REVISION, world: world.sha256, kernel: ARENA_KERNEL_SHA256, players, mode, stormEnabled, maxTicks, stormDelay, stormDuration, defeatPolicy, launchDeadline });
  wasm ??= new WebAssembly.Module(ARENA_KERNEL_BYTES);
  const kernel = new WebAssembly.Instance(wasm, {}).exports;
  kernel.init();
  const state = new Int32Array(kernel.memory.buffer, kernel.state_ptr(), kernel.state_size() / 4), held = new Int32Array(kernel.memory.buffer, kernel.input_ptr(), 100);
  const colliders = [], flippers = [];
  const gates = world.arenas.flatMap((a, ai) => a.gates.map((g) => ({ item: g, arenaId: a.id, ai, kernelId: -1, openTicks: g.initiallyOpen ? 360 : 0 })));
  for (const [ai, a] of world.arenas.entries()) {
    for (const r of a.rails) {
      const i = kernel.rail(q(r.ax), q(r.ay), q(r.bx), q(r.by), q(r.radius), q(r.restitution), r.layer, ai, q(r.elevation));
      kernel.rail_end_elevation(i, q(r.elevationB ?? r.elevation));
      colliders.push({ id: r.id, arenaId: a.id, type: "rail", kernelId: i });
    }
    for (const b of a.bumpers) {
      const i = kernel.bumper(q(b.x), q(b.y), q(b.radius), q(b.impulse), b.layer, ai, q(b.elevation));
      colliders.push({ id: b.id, arenaId: a.id, type: "bumper", kernelId: i });
    }
    for (const f of a.flippers) {
      const i = kernel.flipper(q(f.pivotX), q(f.pivotY), q(f.length), q(f.radius), Math.round(f.restAngle * 10), Math.round(f.activeAngle * 10), f.side === "left" ? 1 : 2, -1, f.layer, ai, q(f.elevation));
      colliders.push({ id: f.id, arenaId: a.id, type: "flipper", kernelId: i });
      flippers.push({ item: f, arenaId: a.id, kernelId: i, index: flippers.length });
    }
    for (const g of gates.filter((x) => x.ai === ai)) {
      g.kernelId = kernel.rail(q(g.item.ax), q(g.item.ay), q(g.item.bx), q(g.item.by), q(g.item.radius), q(g.item.restitution), g.item.layer, ai, q(g.item.elevation));
      colliders.push({ id: g.item.id, arenaId: a.id, type: "rail", kernelId: g.kernelId });
      kernel.enabled(g.kernelId, g.openTicks > 0 ? 0 : 1);
    }
  }
  const ramps = world.arenas.flatMap((a, ai) => a.ramps.map((item) => ({ item, ai, arenaId: a.id })));
  for (const r of ramps)
    kernel.ramp(q(r.item.ax), q(r.item.ay), q(r.item.bx), q(r.item.by), q(r.item.width), r.item.fromLayer, r.item.toLayer, q(r.item.fromElevation), q(r.item.toElevation), r.ai, r.item.bidirectional ? 1 : 0);
  if (!kernel.index_world())
    throw new Error("Shared arena spatial index capacity exceeded");
  const stations = world.arenas.flatMap((a, ai) => a.stations.map((item) => ({ item, arenaId: a.id, ai, ownerId: null, leaseTicks: 0 })));
  const ownerIndex = new Map(players.map((p, i) => [p.ownerId, i])), stationById = new Map(stations.map((s) => [s.item.id, s])), stationByFlipper = new Map(stations.flatMap((s) => s.item.flipperIds.map((id) => [id, s])));
  const stationBuckets = new Map;
  for (const s of stations) {
    const key = `${s.ai}:${s.item.layer}:${Math.floor(s.item.x / 1024)}:${Math.floor(s.item.y / 1024)}`, bucket = stationBuckets.get(key) ?? [];
    bucket.push(s);
    stationBuckets.set(key, bucket);
  }
  const nearbyStations = (b) => {
    const out = [];
    for (let y = Math.floor(b.y / 1024) - 1;y <= Math.floor(b.y / 1024) + 1; y++)
      for (let x = Math.floor(b.x / 1024) - 1;x <= Math.floor(b.x / 1024) + 1; x++)
        out.push(...stationBuckets.get(`${b.ai}:${b.layer}:${x}:${y}`) ?? []);
    return out;
  };
  const switches = world.arenas.flatMap((a, ai) => a.switches.map((item) => ({ item, arenaId: a.id, ai, remainingTicks: 0, lastOwnerId: null })));
  const portals = world.arenas.flatMap((a, ai) => a.portals.map((item) => ({ item, arenaId: a.id, ai, transfers: 0 })));
  const challenges = world.arenas.flatMap((a, ai) => (a.challenges ?? []).map((item) => ({ item, ai, arenaId: a.id }))), requirements = world.arenas.flatMap((a) => (a.requirements ?? []).map((item) => ({ item, arenaId: a.id, qualifiedBy: new Set })));
  const captures = createCaptureController(arenaCaptureBindings(world)), mechanisms = arenaMechanismSpecs(world).map((spec) => ({ ...spec, activationTick: 0, activationSerial: 0, intensity: 0 })), mechanismById = new Map(mechanisms.map((m) => [m.id, m]));
  const routeProgress = new Map;
  const metas = players.map((p, i) => {
    const s = stations.find((s2) => s2.item.ownerId === p.ownerId) ?? stations[i];
    if (!s)
      throw new Error("Accepted player has no safe station");
    s.ownerId = p.ownerId;
    s.leaseTicks = 180;
    kernel.add_ball(q(s.item.launchX), q(s.item.launchY), 0, 0, 0, p.ownerId, p.teamId, s.ai, s.item.layer, q(p.ballRadius ?? 12));
    kernel.elevation(i, q(s.item.elevation));
    return { elevation: s.item.elevation, health: p.maxHealth ?? 6, energy: 100, shieldTicks: 0, cooldowns: [0, 0, 0], eliminated: false, score: 0, portalCooldown: 0, rampId: null, stationId: s.item.id, nextStationId: s.item.id, stationCooldown: 0, launched: false, damageTick: -1000, damageSources: {}, hazardTimes: {}, previousInput: 0, stationHome: s.item.id, role: p.role, shotTick: -1, shotFlipper: null };
  });
  let events = [], phase = "ready", winnerTeamId = null, finishReason = null, eventTick = 0;
  const contactTimes = new Map, commandIds = [];
  const raw = (i) => {
    const o = HEADER + i * BALL_STRIDE;
    return { x: state[o] / Q3, y: state[o + 1] / Q3, vx: state[o + 2] / Q3, vy: state[o + 3] / Q3, active: state[o + 4] === 1, ownerId: state[o + 5], teamId: state[o + 6], ai: state[o + 7], layer: state[o + 8], radius: state[o + 9] / Q3, elevation: state[o + 14] / Q3, rampIndex: state[o + 15], rampExit: state[o + 16] };
  };
  const emit = (type, data = {}) => {
    events.push({ id: `${eventTick}:${events.length}:${type}`, tick: eventTick, type, ...data });
    const id = data.mechanismId ?? data.colliderId, m = id ? mechanismById.get(id) : undefined;
    if (m && ["launch", "bumper", "switch", "gate", "capture-enter", "capture-release"].includes(type)) {
      const intensity = Math.max(1, Math.min(1024, Math.round((data.energy ?? 18) / 18 * 1024)));
      if (m.activationTick === eventTick) {
        m.intensity = Math.max(m.intensity, intensity);
        return;
      }
      m.activationTick = eventTick;
      m.activationSerial++;
      m.intensity = intensity;
      events.push({ id: `${eventTick}:${events.length}:mechanism-actuate`, tick: eventTick, type: "mechanism-actuate", mechanismId: m.id, arenaId: m.arenaId, ...data.ownerId === undefined ? {} : { ownerId: data.ownerId }, ...data.bodyId === undefined ? {} : { bodyId: data.bodyId } });
    }
  };
  const captureProbe = (i) => {
    const b = raw(i);
    return { id: `core-${b.ownerId}`, ownerId: b.ownerId, arenaId: world.arenas[b.ai].id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, radius: b.radius, layer: b.layer, elevation: b.elevation, active: b.active, eliminated: metas[i].eliminated };
  };
  const locate = (ai, x, y) => world.arenas[ai].regions.reduce((best, r) => distance2(r.center, { x, y }) < distance2(best.center, { x, y }) ? r : best).id;
  const fixedStorm = createFixedStorm(world.arenas[0].bounds, world.arenas[0].id, mode, stormDelay, stormDuration, stormEnabled);
  const storm = () => fixedStorm.read(state[0]);
  function leaseBanks() {
    for (const s of stations) {
      if (s.ownerId === null)
        continue;
      const i = ownerIndex.get(s.ownerId) ?? -1, b = i >= 0 ? raw(i) : null;
      if (!b || metas[i].eliminated || b.ai !== s.ai || b.layer !== s.item.layer || Math.abs(b.elevation - s.item.elevation) > b.radius + 4 || distance2(b, s.item) > 360 * 360) {
        s.leaseTicks = Math.min(s.leaseTicks, 30) - 1;
        if (s.leaseTicks <= 0) {
          if (i >= 0)
            metas[i].stationId = null;
          s.ownerId = null;
          s.leaseTicks = 0;
        }
      } else
        s.leaseTicks = 180;
    }
    const arrivals = [];
    for (let i = 0;i < players.length; i++) {
      if (metas[i].eliminated || captures.state(`core-${players[i].ownerId}`))
        continue;
      const b = raw(i), local = nearbyStations(b);
      let best, bestD = Infinity;
      for (const s of local) {
        if (Math.abs(b.elevation - s.item.elevation) > b.radius + 4)
          continue;
        const d = distance2(b, s.item);
        if (d < bestD || d === bestD && s.item.id < (best?.item.id ?? "~")) {
          best = s;
          bestD = d;
        }
        if (!metas[i].stationId && d < 170 * 170 && s.ownerId === null)
          arrivals.push({ station: s, index: i, d });
      }
      if (bestD > 1024 * 1024)
        for (const s of stations) {
          if (s.ai !== b.ai || s.item.layer !== b.layer || Math.abs(b.elevation - s.item.elevation) > b.radius + 4)
            continue;
          const d = distance2(b, s.item);
          if (d < bestD || d === bestD && s.item.id < (best?.item.id ?? "~")) {
            best = s;
            bestD = d;
          }
        }
      metas[i].nextStationId = best?.item.id ?? null;
    }
    arrivals.sort((a, b) => a.d - b.d || players[a.index].ownerId - players[b.index].ownerId || (a.station.item.id < b.station.item.id ? -1 : a.station.item.id > b.station.item.id ? 1 : 0));
    for (const a of arrivals) {
      if (a.station.ownerId !== null || metas[a.index].stationId)
        continue;
      a.station.ownerId = players[a.index].ownerId;
      a.station.leaseTicks = 180;
      metas[a.index].stationId = a.station.item.id;
      emit("lease", { ownerId: a.station.ownerId, arenaId: a.station.arenaId, colliderId: a.station.item.id });
    }
    for (const f of flippers)
      kernel.lease(f.kernelId, stationByFlipper.get(f.item.id)?.ownerId ?? -1);
  }
  leaseBanks();
  function readFrame() {
    const balls = players.map((p, i) => {
      const b = raw(i), m = metas[i], a = world.arenas[b.ai];
      return { id: `core-${p.ownerId}`, ownerId: p.ownerId, teamId: p.teamId, arenaId: a.id, regionId: locate(b.ai, b.x, b.y), x: b.x, y: b.y, vx: b.vx, vy: b.vy, radius: b.radius, layer: b.layer, elevation: b.elevation, active: b.active, health: m.health, energy: m.energy, shieldTicks: m.shieldTicks, cooldowns: [...m.cooldowns], eliminated: m.eliminated, score: m.score, portalCooldown: m.portalCooldown, rampId: m.rampId, stationId: m.stationId, nextStationId: m.nextStationId, transport: captures.state(`core-${p.ownerId}`) };
    });
    const occupied = captures.occupiedGateIds();
    const teams = [...new Set(players.map((p) => p.teamId))].sort((a, b) => a - b).map((id) => ({ id, alive: balls.filter((b) => b.teamId === id && !b.eliminated).length, score: balls.filter((b) => b.teamId === id).reduce((s, b) => s + b.score, 0) }));
    return { schema: "keel-pinball-arena-frame@2", captures: captures.frames(), mechanisms: mechanisms.map((m) => ({ ...m })), tick: state[0], mode, phase, balls, flippers: flippers.map((f) => ({ id: f.item.id, arenaId: f.arenaId, ownerId: stationByFlipper.get(f.item.id)?.ownerId ?? -1, layer: f.item.layer, elevation: f.item.elevation, angle: state[ANGLE_OFFSET + f.index] / 10, pivotX: f.item.pivotX, pivotY: f.item.pivotY, tipX: kernel.tip_x(f.index) / Q3, tipY: kernel.tip_y(f.index) / Q3, radius: f.item.radius })), gates: gates.map((g) => ({ id: g.item.id, arenaId: g.arenaId, open: g.openTicks > 0 && !occupied.has(g.item.id), openTicks: occupied.has(g.item.id) ? 0 : g.openTicks })), switches: switches.map((s) => ({ id: s.item.id, arenaId: s.arenaId, active: s.remainingTicks > 0, lastOwnerId: s.lastOwnerId, remainingTicks: s.remainingTicks })), portals: portals.map((p) => ({ id: p.item.id, arenaId: p.arenaId, enabled: true, transfers: p.transfers })), stations: stations.map((s) => ({ id: s.item.id, arenaId: s.arenaId, ownerId: s.ownerId, leaseTicks: s.leaseTicks })), routeProgress: [...routeProgress.values()].map(({ startedTick, ...p }) => ({ ...p })), qualifications: requirements.map((r) => ({ id: r.item.id, qualifiedBy: [...r.qualifiedBy].sort((a, b) => a - b) })), teams, events: events.map((e) => ({ ...e })), storm: storm(), winnerTeamId, finishReason };
  }
  function damage(i, amount = 1, sourceOwnerId, cause = "impact") {
    const m = metas[i], b = raw(i);
    if (m.eliminated || cause !== "equipment" && cause !== "score-pressure" && state[0] - m.damageTick < 90)
      return;
    if (cause !== "score-pressure")
      m.damageTick = state[0];
    const absorbed = cause !== "score-pressure" && m.shieldTicks > 0;
    if (!absorbed && amount > 0 && sourceOwnerId !== undefined)
      m.damageSources[sourceOwnerId] = state[0];
    if (absorbed)
      m.shieldTicks = 0;
    else
      m.health = Math.max(0, m.health - amount);
    emit("damage", { ownerId: b.ownerId, arenaId: world.arenas[b.ai].id, x: b.x, y: b.y, amount: absorbed ? 0 : amount, cause, ...sourceOwnerId === undefined ? {} : { sourceOwnerId } });
    if (m.health === 0) {
      if (defeatPolicy === "recover") {
        recover(i);
        m.health = players[i].maxHealth ?? 6;
        m.energy = 25;
      } else {
        m.eliminated = true;
        captures.cancel(`core-${players[i].ownerId}`);
        releaseLease(i);
        kernel.set_ball(i, q(b.x), q(b.y), 0, 0, 0, b.ai, b.layer);
        const assists = Object.entries(m.damageSources).filter(([owner, tick]) => Number(owner) !== sourceOwnerId && state[0] - tick <= 600).map(([owner]) => Number(owner));
        emit("eliminated", { ownerId: b.ownerId, arenaId: world.arenas[b.ai].id, assists, ...sourceOwnerId === undefined ? {} : { sourceOwnerId } });
      }
    }
  }
  function releaseLease(i) {
    const m = metas[i];
    for (const s of stations)
      if (s.ownerId === players[i].ownerId) {
        s.ownerId = null;
        s.leaseTicks = 0;
      }
    m.stationId = null;
  }
  function recover(i) {
    captures.cancel(`core-${players[i].ownerId}`);
    releaseLease(i);
    const m = metas[i], s = stationById.get(m.stationHome);
    kernel.set_ball(i, q(s.item.launchX), q(s.item.launchY), 0, 0, 0, s.ai, s.item.layer);
    kernel.elevation(i, q(s.item.elevation));
    m.elevation = s.item.elevation;
    m.rampId = null;
    m.portalCooldown = 120;
    m.stationId = null;
  }
  function captureQualified(id, ownerId) {
    const r = requirements.find((r2) => r2.item.id === id), p = players[ownerIndex.get(ownerId) ?? -1];
    return !!r && !!p && r.qualifiedBy.has(r.item.scope === "owner" ? ownerId : p.teamId);
  }
  function launchDiskClear(index, ai, pose, radius) {
    const a = world.arenas[ai];
    if (pose.x - radius < a.bounds[0] || pose.x + radius > a.bounds[2] || pose.y - radius < a.bounds[1] || pose.y + radius > a.bounds[3])
      return false;
    for (let i = 0;i < players.length; i++) {
      if (i === index)
        continue;
      const b = raw(i);
      if (b.active && b.ai === ai && b.layer === pose.layer && distance2(b, pose) + (b.elevation - pose.elevation) ** 2 < (radius + b.radius + 2) ** 2)
        return false;
    }
    const occupied = captures.occupiedGateIds();
    const blocked = (ax, ay, bx, by, r, z0, z1 = z0) => {
      const t = fraction(pose.x, pose.y, ax, ay, bx, by), x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = z0 + (z1 - z0) * t;
      return (x - pose.x) ** 2 + (y - pose.y) ** 2 + (z - pose.elevation) ** 2 < (radius + r + 2) ** 2;
    };
    for (const r of a.rails)
      if (r.layer === pose.layer && blocked(r.ax, r.ay, r.bx, r.by, r.radius, r.elevation, r.elevationB))
        return false;
    for (const g of gates)
      if (g.ai === ai && g.item.layer === pose.layer && (g.openTicks === 0 || occupied.has(g.item.id)) && blocked(g.item.ax, g.item.ay, g.item.bx, g.item.by, g.item.radius, g.item.elevation))
        return false;
    for (const b of a.bumpers)
      if (b.layer === pose.layer && blocked(b.x, b.y, b.x, b.y, b.radius, b.elevation))
        return false;
    for (const f of flippers)
      if (f.arenaId === a.id && f.item.layer === pose.layer && blocked(f.item.pivotX, f.item.pivotY, kernel.tip_x(f.index) / Q3, kernel.tip_y(f.index) / Q3, f.item.radius, f.item.elevation))
        return false;
    return true;
  }
  function captureExitClear(binding, port, bodyId) {
    const ai = world.arenas.findIndex((a2) => a2.id === binding.item.exitArenaId), a = world.arenas[ai], index = players.findIndex((p) => `core-${p.ownerId}` === bodyId), radius = players[index]?.ballRadius ?? 12;
    const receiver = port.receiverCatchId ? stationById.get(port.receiverCatchId) : undefined;
    if (receiver && receiver.ownerId !== null && receiver.ownerId !== players[index].ownerId)
      return false;
    if (port.maxBallRadius < radius || port.clearWidth < 2 * radius + 2 / 1024)
      return false;
    if (!port.surfaceIds.some((id) => a.surfaces.some((s) => {
      if (s.id !== id || s.layer !== port.layer)
        return false;
      const height = supportHeight(port, s);
      return height !== null && Math.abs(height - port.elevation) < 1 / 1024;
    })))
      return false;
    return launchDiskClear(index, ai, port, radius);
  }
  function applyCaptureAction(action) {
    const i = ownerIndex.get(action.ownerId), m = metas[i], ai = world.arenas.findIndex((a) => a.id === action.arenaId);
    const fields = { ownerId: action.ownerId, bodyId: action.bodyId, mechanismId: action.mechanismId, colliderId: action.mechanismId, entryPortId: action.entryPortId, exitPortId: action.exitPortId, arenaId: action.arenaId, x: action.x, y: action.y, layer: action.layer, elevation: action.elevation };
    if (action.type === "capture-enter") {
      releaseLease(i);
      kernel.set_ball(i, q(action.x), q(action.y), 0, 0, 0, ai, action.layer);
      kernel.elevation(i, q(action.elevation));
      m.rampId = null;
      m.elevation = action.elevation;
      m.shotTick = -1;
      m.shotFlipper = null;
      emit(action.type, fields);
    } else if (action.type === "capture-release") {
      kernel.set_ball(i, q(action.x), q(action.y), q(action.vx), q(action.vy), 1, ai, action.layer);
      kernel.elevation(i, q(action.elevation));
      m.elevation = action.elevation;
      m.rampId = null;
      m.portalCooldown = 120;
      emit(action.type, fields);
    } else if (action.type === "terminal-drain") {
      emit("drain", fields);
      damage(i, 1, undefined, "hazard");
      if (!m.eliminated)
        recover(i);
    } else
      emit(action.type, fields);
  }
  function admitCommands(commands) {
    if (commands.length > 100)
      throw new Error("Command tick cap");
    return commands.map((command) => {
      const c = { ...command }, i = ownerIndex.get(c.ownerId) ?? -1;
      if (i < 0 || typeof c.id !== "string" || !c.id.length || c.id.length > 120)
        throw new Error("Invalid admitted command");
      if (c.type === "impulse") {
        if (!finite2(c.vx, -12, 12) || !finite2(c.vy, -12, 12))
          throw new Error("Unbounded admitted impulse");
      } else {
        if (!["heal", "shield", "energy", "recover", "damage", "equipment-damage", "score-pressure"].includes(c.type) || !integer3(c.amount ?? 1, 0, 100))
          throw new Error("Invalid admitted resource command");
        if (c.type === "score-pressure" && Object.hasOwn(c, "sourceOwnerId"))
          throw new Error("Score pressure cannot carry PvP credit");
        if ((c.type === "damage" || c.type === "equipment-damage") && c.sourceOwnerId !== undefined && !owners.has(c.sourceOwnerId))
          throw new Error("Invalid damage source");
      }
      return c;
    });
  }
  function applyCommands(commands) {
    for (const c of commands) {
      const i = ownerIndex.get(c.ownerId) ?? -1;
      if (commandIds.includes(c.id))
        continue;
      const m = metas[i];
      if (m.eliminated) {
        commandIds.push(c.id);
        if (commandIds.length > 4096)
          commandIds.shift();
        emit("command", { ownerId: c.ownerId, amount: 0 });
        continue;
      }
      if (c.type === "impulse") {
        if (!captures.state(`core-${c.ownerId}`))
          kernel.force(i, q(c.vx), q(c.vy));
      } else {
        if (c.type === "heal")
          m.health = Math.min(players[i].maxHealth ?? 6, m.health + (c.amount ?? 1));
        if (c.type === "shield")
          m.shieldTicks = Math.max(m.shieldTicks, (c.amount ?? 1) * 120);
        if (c.type === "energy")
          m.energy = Math.min(100, m.energy + (c.amount ?? 1));
        if (c.type === "recover" && !m.eliminated)
          recover(i);
        if (c.type === "damage" || c.type === "equipment-damage")
          damage(i, c.amount ?? 1, c.sourceOwnerId, c.type === "equipment-damage" ? "equipment" : "command");
        if (c.type === "score-pressure")
          damage(i, c.amount ?? 1, undefined, "score-pressure");
      }
      commandIds.push(c.id);
      if (commandIds.length > 4096)
        commandIds.shift();
      emit("command", { ownerId: c.ownerId });
    }
  }
  function step(inputs = [], commands = []) {
    if (phase === "finished")
      return readFrame();
    if (state[0] >= maxTicks)
      throw new Error("Arena tick duration exceeded");
    if (inputs.length > players.length)
      throw new Error("Input count exceeds accepted players");
    const admitted = new Map;
    for (const input of inputs) {
      if (!owners.has(input.ownerId) || admitted.has(input.ownerId) || !integer3(input.bits, 0, 63) || !finite2(input.steerX ?? 0, -1, 1) || !finite2(input.steerY ?? 0, -1, 1))
        throw new Error("Invalid owner input");
      admitted.set(input.ownerId, admitArenaInput(input));
    }
    const acceptedCommands = admitCommands(commands);
    events = [];
    eventTick = state[0] + 1;
    held.fill(0);
    applyCommands(acceptedCommands);
    const occupiedAtStart = captures.occupiedGateIds();
    for (const g of gates) {
      const was = g.openTicks > 0;
      g.openTicks = Math.max(0, g.openTicks - 1);
      kernel.enabled(g.kernelId, g.openTicks > 0 && !occupiedAtStart.has(g.item.id) ? 0 : 1);
      if (was && g.openTicks === 0)
        emit("gate", { arenaId: g.arenaId, colliderId: g.item.id });
    }
    for (const s of switches)
      s.remainingTicks = Math.max(0, s.remainingTicks - 1);
    for (let i = 0;i < players.length; i++) {
      const p = players[i], m = metas[i], b = raw(i), input = admitted.get(p.ownerId) ?? { ownerId: p.ownerId, bits: 0 }, pressed = input.bits & ~m.previousInput;
      m.previousInput = input.bits;
      if (m.eliminated)
        continue;
      m.cooldowns = m.cooldowns.map((n) => Math.max(0, n - 1));
      m.shieldTicks = Math.max(0, m.shieldTicks - 1);
      m.portalCooldown = Math.max(0, m.portalCooldown - 1);
      m.stationCooldown = Math.max(0, m.stationCooldown - 1);
      if (state[0] % 120 === 0)
        m.energy = Math.min(100, m.energy + 1);
      if (captures.state(`core-${p.ownerId}`))
        continue;
      held[p.ownerId] = input.bits;
      const leased = stationById.get(m.stationId ?? ""), home = stationById.get(m.stationHome);
      const atHome = !b.active && b.ai === home.ai && b.layer === home.item.layer && Math.abs(b.x - home.item.launchX) <= 1 / Q3 && Math.abs(b.y - home.item.launchY) <= 1 / Q3 && Math.abs(b.elevation - home.item.elevation) <= 1 / Q3;
      const s = atHome ? home : leased?.ownerId === p.ownerId ? leased : undefined;
      if (pressed & ArenaInput.LAUNCH && s && (b.active ? distance(b, s.item) < 75 && Math.hypot(b.vx, b.vy) < 2 : launchDiskClear(i, b.ai, b, b.radius))) {
        kernel.set_ball(i, q(b.x), q(b.y), q(s.item.launchVx), q(s.item.launchVy), 1, b.ai, b.layer);
        kernel.elevation(i, q(s.item.elevation));
        phase = "playing";
        m.launched = true;
        m.shotTick = -1;
        m.shotFlipper = null;
        m.stationCooldown = 60;
        emit("launch", { ownerId: p.ownerId, arenaId: world.arenas[b.ai].id, colliderId: s.item.id });
      }
      if (!raw(i).active)
        continue;
      const gravity = world.arenas[b.ai].gravity ?? { x: 0, y: 0.04 };
      kernel.force(i, q(gravity.x), q(gravity.y));
      const sx = input.steerX ?? 0, sy = input.steerY ?? 0, steering = Math.hypot(sx, sy) > 0.15;
      let { vx: ax, vy: ay } = b;
      if (steering) {
        const angle = Math.round(Math.atan2(sy, sx) / (Math.PI / 8)) * (Math.PI / 8);
        ax = Math.round(Math.cos(angle) * 1024) / 1024;
        ay = Math.round(Math.sin(angle) * 1024) / 1024;
        kernel.force(i, q(ax * 0.024), q(ay * 0.024));
      }
      const length = Math.hypot(ax, ay) || 1;
      ax /= length;
      ay /= length;
      if (pressed & ArenaInput.DASH && m.cooldowns[0] === 0 && m.energy >= 20) {
        m.energy -= 20;
        m.cooldowns[0] = 240;
        kernel.force(i, q(ax * (p.role === "vector" ? 3 : 2)), q(ay * (p.role === "vector" ? 3 : 2)));
        emit("ability", { ownerId: p.ownerId, ability: "dash", arenaId: world.arenas[b.ai].id, x: b.x, y: b.y, layer: b.layer, elevation: b.elevation });
      }
      if (pressed & ArenaInput.PULSE && m.cooldowns[1] === 0 && m.energy >= 30) {
        m.energy -= 30;
        m.cooldowns[1] = 360;
        const radius = p.role === "weaver" ? 220 : 160;
        for (let j = 0;j < players.length; j++) {
          if (j === i)
            continue;
          const other = raw(j), d = distance(b, other);
          if (other.active && other.ai === b.ai && other.layer === b.layer && Math.abs(other.elevation - b.elevation) < other.radius + b.radius && d > 0 && d < radius) {
            kernel.force(j, q((other.x - b.x) / d * 3), q((other.y - b.y) / d * 3));
            if (other.teamId !== p.teamId)
              damage(j, 1, p.ownerId, "pulse");
          }
        }
        emit("ability", { ownerId: p.ownerId, ability: "pulse", arenaId: world.arenas[b.ai].id, x: b.x, y: b.y, layer: b.layer, elevation: b.elevation, radius });
      }
      if (pressed & ArenaInput.SHIELD && m.cooldowns[2] === 0 && m.energy >= 25) {
        m.energy -= 25;
        m.cooldowns[2] = 600;
        m.shieldTicks = p.role === "anchor" ? 360 : 240;
        emit("ability", { ownerId: p.ownerId, ability: "shield", arenaId: world.arenas[b.ai].id, x: b.x, y: b.y, layer: b.layer, elevation: b.elevation, radius: b.radius });
      }
      for (const f of world.arenas[b.ai].flows) {
        if (f.layer !== b.layer || Math.abs(b.elevation - (f.elevation ?? 0)) > b.radius + 4 || Math.hypot(b.vx, b.vy) > f.maxSpeed)
          continue;
        const t = fraction(b.x, b.y, f.ax, f.ay, f.bx, f.by), dx = b.x - f.ax - (f.bx - f.ax) * t, dy = b.y - f.ay - (f.by - f.ay) * t;
        if (dx * dx + dy * dy < f.width * f.width / 4)
          kernel.force(i, q(f.fx), q(f.fy));
      }
    }
    const previousCaptureBodies = new Map(players.map((_, i) => {
      const b = captureProbe(i);
      return [b.id, b];
    }));
    kernel.step();
    for (let e = 0;e < state[4]; e++) {
      const o = EVENT_OFFSET + e * 8, type = state[o], i = state[o + 1], j = state[o + 2], c = state[o + 3], energy = state[o + 4] / Q3, b = raw(i), m = metas[i];
      if (type === 3) {
        const other = raw(j);
        if (b.teamId !== other.teamId && energy > 3) {
          damage(i, 1, other.ownerId);
          damage(j, 1, b.ownerId);
        }
        emit("ball-contact", { ownerId: b.ownerId, otherOwnerId: other.ownerId, arenaId: world.arenas[b.ai].id, x: state[o + 5] / Q3, y: state[o + 6] / Q3, elevation: state[o + 7] / Q3, energy });
      } else {
        const collider = colliders[c];
        if (type === 2) {
          const f = flippers.find((f2) => f2.kernelId === c);
          const owner = f ? stationByFlipper.get(f.item.id)?.ownerId : null;
          if (f && owner !== null && owner !== undefined && held[owner] & (f.item.side === "left" ? 1 : 2)) {
            m.shotTick = state[0];
            m.shotFlipper = f.item.id;
          }
        }
        const key = `${i}:${c}`;
        if (state[0] - (contactTimes.get(key) ?? -100) < 12)
          continue;
        contactTimes.set(key, state[0]);
        if (type === 1) {
          m.score += 25;
          m.energy = Math.min(100, m.energy + 3);
        }
        emit(collider.type, { ownerId: b.ownerId, arenaId: collider.arenaId, colliderId: collider.id, x: state[o + 5] / Q3, y: state[o + 6] / Q3, elevation: state[o + 7] / Q3, energy });
      }
    }
    for (let i = 0;i < players.length; i++) {
      const b = raw(i), m = metas[i];
      if (m.eliminated)
        continue;
      const ring = storm(), transport = captures.state(`core-${b.ownerId}`), stormPort = transport && transport.phase !== "captured" ? world.arenas.find((a2) => a2.id === transport.exitArenaId)?.pinball?.ports.find((p) => p.id === transport.exitPortId) : undefined, stormArenaId = stormPort ? transport.exitArenaId : world.arenas[b.ai].id;
      if (ring.active && (stormArenaId !== ring.arenaId || fixedStorm.isOutside(stormPort ?? b, state[0])) && state[0] % 120 === 0)
        damage(i, 1, undefined, "storm");
      if (!b.active || m.eliminated)
        continue;
      const a = world.arenas[b.ai];
      for (const s of switches) {
        if (s.ai !== b.ai || s.item.layer !== b.layer || Math.abs(s.item.elevation - b.elevation) > b.radius + 4 || distance(b, s.item) > s.item.radius + b.radius || s.remainingTicks > 0)
          continue;
        s.remainingTicks = s.item.holdTicks;
        s.lastOwnerId = b.ownerId;
        for (const id of s.item.gateIds) {
          const g = gates.find((g2) => g2.item.id === id);
          g.openTicks = s.item.holdTicks;
          kernel.enabled(g.kernelId, 0);
        }
        m.score += 100;
        emit("switch", { ownerId: b.ownerId, arenaId: a.id, colliderId: s.item.id });
      }
      for (const c of challenges) {
        if (c.ai !== b.ai)
          continue;
        const key = `${b.ownerId}:${c.item.id}`;
        let progress = routeProgress.get(key) ?? { ownerId: b.ownerId, routeId: c.item.id, nextCheckpoint: 0, completed: false, startedTick: state[0] };
        if (progress.completed)
          continue;
        if (state[0] - progress.startedTick > (c.item.maxTraversalTicks ?? 12000)) {
          routeProgress.delete(key);
          progress = { ownerId: b.ownerId, routeId: c.item.id, nextCheckpoint: 0, completed: false, startedTick: state[0] };
        }
        if (progress.nextCheckpoint === 0 && (c.item.kind === "main-shot" && (m.shotTick < 0 || state[0] - m.shotTick > 120 || !c.item.sourceFlipperIds?.includes(m.shotFlipper ?? "")) || c.item.entryDirection && b.vx * c.item.entryDirection.x + b.vy * c.item.entryDirection.y <= 0))
          continue;
        const point = c.item.checkpoints[progress.nextCheckpoint];
        if (point.layer === b.layer && Math.abs(point.elevation - b.elevation) < b.radius + 4 && distance(b, point) < point.radius && (progress.nextCheckpoint < c.item.checkpoints.length - 1 || !c.item.finalColliderId || events.some((e) => e.ownerId === b.ownerId && e.colliderId === c.item.finalColliderId && ["rail", "bumper", "flipper"].includes(e.type)))) {
          progress.nextCheckpoint++;
          progress.completed = progress.nextCheckpoint === c.item.checkpoints.length;
          routeProgress.set(key, progress);
          emit(progress.completed ? "route-complete" : "route-checkpoint", { ownerId: b.ownerId, arenaId: a.id, colliderId: c.item.id, x: b.x, y: b.y });
        }
      }
      const bank = stationById.get(m.stationId ?? "");
      if (bank && bank.ownerId === b.ownerId && Math.abs(bank.item.elevation - b.elevation) < b.radius + 4 && m.stationCooldown === 0 && (bank.item.captureRadius ?? 0) > 0 && distance(b, bank.item) < bank.item.captureRadius) {
        kernel.set_ball(i, q(b.x), q(b.y), 0, 0, 0, b.ai, b.layer);
        kernel.elevation(i, q(bank.item.elevation));
        m.stationCooldown = 30;
        emit("station-catch", { ownerId: b.ownerId, arenaId: a.id, colliderId: bank.item.id, x: b.x, y: b.y });
        continue;
      }
      const ramp = ramps[b.rampIndex];
      if (ramp && m.rampId !== ramp.item.id)
        emit("ramp-enter", { ownerId: b.ownerId, arenaId: a.id, colliderId: ramp.item.id });
      m.rampId = ramp?.item.id ?? null;
      m.elevation = b.elevation;
      if (b.rampExit !== 0) {
        const exited = ramps[Math.abs(b.rampExit) - 1];
        emit(b.rampExit > 0 ? "ramp-exit" : "ramp-abort", { ownerId: b.ownerId, arenaId: a.id, colliderId: exited.item.id });
      }
      const current = raw(i);
      if (current.layer > 0 && !m.rampId && !a.surfaces.some((s) => s.kind !== "ramp" && s.layer === current.layer && inside(current, s.polygon))) {
        kernel.set_ball(i, q(current.x), q(current.y), q(current.vx), q(current.vy), 1, current.ai, 0);
        kernel.elevation(i, 0);
        m.elevation = 0;
        emit("fall", { ownerId: b.ownerId, arenaId: a.id, x: b.x, y: b.y });
      }
      if (m.portalCooldown === 0)
        for (const p of portals) {
          if (p.ai !== b.ai || p.item.layer !== b.layer || distance(b, p.item) > p.item.radius - b.radius)
            continue;
          const target = portals.find((t) => t.arenaId === p.item.targetArenaId && t.item.id === p.item.targetPortalId);
          const angle = (target.item.angle - p.item.angle + 180) * Math.PI / 180, c = Math.round(Math.cos(angle) * 1024) / 1024, s = Math.round(Math.sin(angle) * 1024) / 1024;
          kernel.set_ball(i, q(target.item.x), q(target.item.y), q(b.vx * c - b.vy * s), q(b.vx * s + b.vy * c), 1, target.ai, target.item.layer);
          kernel.elevation(i, q(target.item.elevation));
          m.elevation = target.item.elevation;
          m.portalCooldown = 120;
          m.rampId = null;
          releaseLease(i);
          p.transfers++;
          emit("portal", { ownerId: b.ownerId, arenaId: target.arenaId, colliderId: p.item.id, x: target.item.x, y: target.item.y });
          break;
        }
      for (const h of a.hazards ?? []) {
        if (h.layer !== b.layer || Math.abs(h.elevation - b.elevation) > b.radius + 4 || distance(b, h) > h.radius + b.radius || state[0] - (m.hazardTimes[h.id] ?? -1e5) < h.cooldownTicks)
          continue;
        m.hazardTimes[h.id] = state[0];
        emit(h.kind === "drain" ? "drain" : "hazard", { ownerId: b.ownerId, arenaId: a.id, colliderId: h.id, x: b.x, y: b.y });
        if (h.damage > 0)
          damage(i, h.damage, undefined, "hazard");
        if (h.kind === "drain" && !m.eliminated)
          recover(i);
      }
      if (b.x < a.bounds[0] - 24 || b.x > a.bounds[2] + 24 || b.y < a.bounds[1] - 24 || b.y > a.bounds[3] + 24) {
        emit("escape", { ownerId: b.ownerId, arenaId: a.id, x: b.x, y: b.y });
        recover(i);
      }
    }
    for (const r of requirements) {
      const groups = r.item.scope === "owner" ? players.map((p) => p.ownerId) : [...new Set(players.map((p) => p.teamId))];
      for (const group of groups) {
        const participants = r.item.scope === "owner" ? [group] : players.filter((p) => p.teamId === group).map((p) => p.ownerId);
        let newlyQualified = false;
        if (!r.qualifiedBy.has(group) && (r.item.routeGroups ?? r.item.routeIds.map((id) => [id])).every((group2) => group2.some((id) => participants.some((ownerId) => routeProgress.get(`${ownerId}:${id}`)?.completed)))) {
          newlyQualified = true;
          r.qualifiedBy.add(group);
          emit("unlock", { ownerId: participants[0], arenaId: r.arenaId, colliderId: r.item.id });
        }
        if (r.qualifiedBy.has(group) && (r.item.persistent || newlyQualified))
          for (const id of r.item.gateIds) {
            const g = gates.find((g2) => g2.item.id === id);
            g.openTicks = r.item.holdTicks;
            kernel.enabled(g.kernelId, 0);
          }
      }
    }
    const exitReservations = [];
    const reserveExit = (binding, port, bodyId) => {
      const radius = players[ownerIndex.get(Number(bodyId.slice(5)))].ballRadius ?? 12;
      if (exitReservations.some((r) => r.arenaId === binding.item.exitArenaId && (r.port.receiverCatchId && r.port.receiverCatchId === port.receiverCatchId || r.port.layer === port.layer && distance2(r.port, port) + (r.port.elevation - port.elevation) ** 2 < (r.radius + radius + 2) ** 2)) || !captureExitClear(binding, port, bodyId))
        return false;
      exitReservations.push({ arenaId: binding.item.exitArenaId, port, radius });
      return true;
    };
    for (const action of captures.advance(state[0], captureQualified, reserveExit))
      applyCaptureAction(action);
    for (const action of captures.enter(previousCaptureBodies, players.map((_, i) => captureProbe(i)).filter((b) => !events.some((e) => e.type === "portal" && e.ownerId === b.ownerId)), state[0]))
      applyCaptureAction(action);
    const occupiedCaptureGates = captures.occupiedGateIds();
    for (const g of gates)
      kernel.enabled(g.kernelId, g.openTicks > 0 && !occupiedCaptureGates.has(g.item.id) ? 0 : 1);
    for (const [key, tick] of contactTimes)
      if (state[0] - tick > 12)
        contactTimes.delete(key);
    leaseBanks();
    if (state[7] > 0)
      emit("contact-budget");
    if (mode === "battle") {
      if (state[0] >= launchDeadline)
        for (let i = 0;i < players.length; i++) {
          const m = metas[i], b = raw(i);
          if (!m.launched && !m.eliminated) {
            m.health = 0;
            m.eliminated = true;
            captures.cancel(`core-${players[i].ownerId}`);
            releaseLease(i);
            kernel.set_ball(i, q(b.x), q(b.y), 0, 0, 0, b.ai, b.layer);
            emit("eliminated", { ownerId: b.ownerId, cause: "launch-deadline", arenaId: world.arenas[b.ai].id });
          }
        }
      const alive = [...new Set(players.filter((_, i) => !metas[i].eliminated).map((p) => p.teamId))];
      if (alive.length <= 1 && (phase === "playing" || state[0] >= launchDeadline)) {
        phase = "finished";
        winnerTeamId = alive[0] ?? null;
        finishReason = alive.length ? "last-team" : "mutual-elimination";
        emit("match-end");
      }
    }
    if (state[0] >= maxTicks && phase !== "finished") {
      phase = "finished";
      winnerTeamId = null;
      finishReason = "timeout";
      emit("match-end");
    }
    if (phase === "finished") {
      for (let i = 0;i < players.length; i++)
        if (captures.state(`core-${players[i].ownerId}`))
          recover(i);
    }
    return readFrame();
  }
  function snapshot() {
    return encode({ schema: ARENA_VERSION, identity, state: Array.from(state), metas, gates: gates.map((g) => g.openTicks), switches: switches.map((s) => [s.remainingTicks, s.lastOwnerId]), portals: portals.map((p) => p.transfers), stations: stations.map((s) => [s.ownerId, s.leaseTicks]), phase, winnerTeamId, finishReason, routeProgress: [...routeProgress.values()], qualifications: requirements.map((r) => [...r.qualifiedBy].sort((a, b) => a - b)), captures: captures.snapshot(), mechanisms: mechanisms.map((m) => ({ activationTick: m.activationTick, activationSerial: m.activationSerial, intensity: m.intensity })), contactTimes: [...contactTimes], commandIds, events });
  }
  function restore(bytes) {
    if (bytes.byteLength > 1500000)
      throw new Error("Arena snapshot cap");
    const d = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const reject = (condition, label) => {
      if (!condition)
        throw new Error(`Invalid arena snapshot: ${label}`);
    };
    reject(d?.schema === ARENA_VERSION && d.identity === identity, "identity");
    reject(Array.isArray(d.state) && d.state.length === state.length && d.state.every((n) => integer3(n, -2147483648, 2147483647)), "kernel storage");
    const tick = d.state[0];
    reject(integer3(tick, 0, maxTicks) && d.state[1] === players.length && d.state[2] === colliders.length && d.state[3] === flippers.length && integer3(d.state[4], 0, 512) && integer3(d.state[5], 0, 79200) && integer3(d.state[6], 0, 819200) && integer3(d.state[7], 0, 1e5), "kernel header");
    for (const [key, length] of [["metas", metas.length], ["gates", gates.length], ["switches", switches.length], ["portals", portals.length], ["stations", stations.length]])
      reject(Array.isArray(d[key]) && d[key].length === length, key);
    reject(["ready", "playing", "finished"].includes(d.phase) && Array.isArray(d.commandIds) && d.commandIds.length <= 4096 && Array.isArray(d.contactTimes) && d.contactTimes.length <= 1e4 && Array.isArray(d.events) && d.events.length <= ARENA_CONTENT_LIMITS.eventRecords, "lifecycle storage");
    const stationIds = new Set(stations.map((s) => s.item.id)), rampIds = new Set(world.arenas.flatMap((a) => a.ramps.map((r) => r.id))), hazardIds = new Set(world.arenas.flatMap((a) => (a.hazards ?? []).map((h) => h.id)));
    const nullableId = (value, allowed) => value === null || typeof value === "string" && allowed.has(value);
    const keys2 = Object.keys(metas[0]).sort().join(",");
    for (let i = 0;i < players.length; i++) {
      const o = HEADER + i * BALL_STRIDE, m = d.metas[i], player = players[i], original = metas[i];
      reject(nativeStoredCoordinate(d.state[o]) && nativeStoredCoordinate(d.state[o + 1]) && integer3(d.state[o + 2], -18 * Q3, 18 * Q3) && integer3(d.state[o + 3], -18 * Q3, 18 * Q3) && d.state[o + 2] ** 2 + d.state[o + 3] ** 2 <= (18 * Q3 + 1) ** 2 && [0, 1].includes(d.state[o + 4]) && d.state[o + 5] === player.ownerId && d.state[o + 6] === player.teamId && integer3(d.state[o + 7], 0, world.arenas.length - 1) && integer3(d.state[o + 8], 0, 3) && d.state[o + 9] === q(player.ballRadius ?? 12) && integer3(d.state[o + 10], -15, 15) && integer3(d.state[o + 11], -15, 15) && [0, 1].includes(d.state[o + 12]) && d.state[o + 13] === -100 && integer3(d.state[o + 14], 0, 400 * Q3) && integer3(d.state[o + 15], -1, ramps.length - 1) && integer3(d.state[o + 16], -ramps.length, ramps.length) && integer3(d.state[o + 17], -1, 1), "body storage");
      reject(m && typeof m === "object" && Object.keys(m).sort().join(",") === keys2 && integer3(m.health, 0, player.maxHealth ?? 6) && integer3(m.energy, 0, 100) && finite2(m.elevation, 0, 400) && integer3(m.previousInput, 0, 63) && typeof m.eliminated === "boolean" && typeof m.launched === "boolean" && integer3(m.shieldTicks, 0, 12000) && integer3(m.score, 0, tick * 20000) && integer3(m.portalCooldown, 0, 120) && integer3(m.stationCooldown, 0, 60) && integer3(m.damageTick, -1000, tick) && integer3(m.shotTick, -1, tick) && nullableId(m.shotFlipper, new Set(flippers.map((f) => f.item.id))) && m.shotTick === -1 === (m.shotFlipper === null) && m.stationHome === original.stationHome && m.role === player.role && nullableId(m.stationId, stationIds) && nullableId(m.nextStationId, stationIds) && nullableId(m.rampId, rampIds) && Array.isArray(m.cooldowns) && m.cooldowns.length === 3 && m.cooldowns.every((n) => integer3(n, 0, 1e4)), "body metadata");
      reject(!m.eliminated || m.health === 0 && d.state[o + 4] === 0, "eliminated body");
      reject(m.damageSources && typeof m.damageSources === "object" && !Array.isArray(m.damageSources) && Object.entries(m.damageSources).every(([key, value]) => owners.has(Number(key)) && integer3(value, 0, tick)), "damage source history");
      reject(m.hazardTimes && typeof m.hazardTimes === "object" && !Array.isArray(m.hazardTimes) && Object.entries(m.hazardTimes).every(([key, value]) => hazardIds.has(key) && integer3(value, 0, tick)), "hazard history");
    }
    for (let i = players.length;i < 128; i++)
      for (let j = 0;j < BALL_STRIDE; j++)
        reject(d.state[HEADER + i * BALL_STRIDE + j] === 0, "unused body");
    for (let i = 0;i < 256; i++) {
      const f = flippers[i]?.item;
      if (f) {
        const lo = Math.round(Math.min(f.restAngle, f.activeAngle) * 10), hi = Math.round(Math.max(f.restAngle, f.activeAngle) * 10);
        reject(integer3(d.state[ANGLE_OFFSET + i], lo, hi), "actuator angle");
      } else
        reject(d.state[ANGLE_OFFSET + i] === 0, "unused actuator");
    }
    for (let i = 0;i < d.state[4]; i++) {
      const o = EVENT_OFFSET + i * 8, type = d.state[o], owner = d.state[o + 1], other = d.state[o + 2], collider = d.state[o + 3];
      reject(integer3(type, 0, 3) && integer3(owner, 0, players.length - 1) && integer3(d.state[o + 4], 0, 64 * Q3) && nativeStoredCoordinate(d.state[o + 5]) && nativeStoredCoordinate(d.state[o + 6]) && integer3(d.state[o + 7], 0, 400 * Q3) && (type === 3 ? integer3(other, 0, players.length - 1) && other !== owner && collider === -1 : other === -1 && integer3(collider, 0, colliders.length - 1)), "kernel contact");
    }
    for (const n of d.gates)
      reject(integer3(n, 0, 1e5), "gate");
    for (const s of d.switches)
      reject(Array.isArray(s) && s.length === 2 && integer3(s[0], 0, 1e5) && (s[1] === null || owners.has(s[1])), "switch");
    for (const n of d.portals)
      reject(integer3(n, 0, tick * players.length), "portal count");
    const leased = new Set;
    for (let i = 0;i < stations.length; i++) {
      const s = d.stations[i], item = stations[i];
      reject(Array.isArray(s) && s.length === 2 && integer3(s[1], 0, 180) && (s[0] === null ? s[1] === 0 : owners.has(s[0]) && s[1] > 0 && !leased.has(s[0])), "lease");
      if (s[0] !== null) {
        leased.add(s[0]);
        const bi = players.findIndex((p) => p.ownerId === s[0]);
        reject(d.metas[bi].stationId === item.item.id && !d.metas[bi].eliminated, "lease owner");
      }
    }
    for (let i = 0;i < players.length; i++) {
      const sid = d.metas[i].stationId;
      if (sid !== null) {
        const si = stations.findIndex((s) => s.item.id === sid);
        reject(d.stations[si][0] === players[i].ownerId, "owner lease");
      }
    }
    const commandSet = new Set;
    for (const id of d.commandIds) {
      reject(typeof id === "string" && id.length > 0 && id.length <= 120 && !commandSet.has(id), "command ID");
      commandSet.add(id);
    }
    const contactSet = new Set;
    for (const entry of d.contactTimes) {
      reject(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && /^\d+:\d+$/.test(entry[0]) && !contactSet.has(entry[0]) && integer3(entry[1], Math.max(0, tick - 12), tick), "contact cooldown");
      const parts = entry[0].split(":").map(Number);
      reject(integer3(parts[0], 0, players.length - 1) && integer3(parts[1], 0, colliders.length - 1), "contact body");
      contactSet.add(entry[0]);
    }
    const eventTypes = new Set(["rail", "bumper", "flipper", "ball-contact", "launch", "switch", "gate", "ramp-enter", "ramp-exit", "ramp-abort", "portal", "ability", "damage", "eliminated", "match-end", "contact-budget", "lease", "command", "hazard", "drain", "fall", "escape", "route-checkpoint", "route-complete", "unlock", "station-catch", "capture-enter", "transit-start", "capture-release", "exit-blocked", "mechanism-actuate"]), eventIds = new Set, arenaIds = new Set(world.arenas.map((a) => a.id));
    for (const e of d.events) {
      reject(e && typeof e === "object" && typeof e.id === "string" && e.id.length <= 120 && !eventIds.has(e.id) && e.tick === tick && eventTypes.has(e.type) && (e.bodyId === undefined || players.some((p) => e.bodyId === `core-${p.ownerId}`)) && (e.mechanismId === undefined || mechanismById.has(e.mechanismId)) && (e.entryPortId === undefined || world.arenas.some((a) => a.pinball?.ports.some((p) => p.id === e.entryPortId))) && (e.exitPortId === undefined || world.arenas.some((a) => a.pinball?.ports.some((p) => p.id === e.exitPortId))) && (e.ownerId === undefined || owners.has(e.ownerId)) && (e.otherOwnerId === undefined || owners.has(e.otherOwnerId)) && (e.arenaId === undefined || arenaIds.has(e.arenaId)) && (e.colliderId === undefined || typeof e.colliderId === "string" && e.colliderId.length <= 120) && (e.x === undefined || nativeEventCoordinate(e.x)) && (e.y === undefined || nativeEventCoordinate(e.y)) && (e.energy === undefined || finite2(e.energy, 0, 64)) && (e.elevation === undefined || finite2(e.elevation, 0, 400)) && (e.radius === undefined || finite2(e.radius, 0, 600)) && (e.layer === undefined || integer3(e.layer, 0, 3)) && (e.sourceOwnerId === undefined || owners.has(e.sourceOwnerId)) && (e.amount === undefined || integer3(e.amount, 0, 100)) && (e.assists === undefined || Array.isArray(e.assists) && e.assists.length <= 100 && e.assists.every((id) => owners.has(id))) && (e.cause === undefined || ["impact", "pulse", "hazard", "storm", "command", "equipment", "score-pressure", "launch-deadline"].includes(e.cause)) && (e.ability === undefined || ["dash", "pulse", "shield"].includes(e.ability)), "event");
      eventIds.add(e.id);
    }
    reject(Array.isArray(d.routeProgress) && d.routeProgress.length <= players.length * challenges.length && Array.isArray(d.qualifications) && d.qualifications.length === requirements.length, "route storage");
    const routeKeys = new Set;
    for (const p of d.routeProgress) {
      const c = challenges.find((c2) => c2.item.id === p.routeId), key = `${p.ownerId}:${p.routeId}`;
      reject(c !== undefined && owners.has(p.ownerId) && !routeKeys.has(key) && integer3(p.startedTick, 1, tick) && integer3(p.nextCheckpoint, 1, Math.min(tick, c.item.checkpoints.length)) && d.metas[players.findIndex((player) => player.ownerId === p.ownerId)]?.launched === true && p.completed === (p.nextCheckpoint === c.item.checkpoints.length), "route progress");
      routeKeys.add(key);
    }
    for (let i = 0;i < requirements.length; i++) {
      const r = requirements[i], groups = r.item.scope === "owner" ? owners : new Set(players.map((p) => p.teamId)), qualified = d.qualifications[i];
      reject(Array.isArray(qualified) && qualified.length <= players.length && new Set(qualified).size === qualified.length && qualified.every((n) => groups.has(n)), "compound qualification");
      for (const group of qualified) {
        const participants = r.item.scope === "owner" ? [group] : players.filter((p) => p.teamId === group).map((p) => p.ownerId);
        reject((r.item.routeGroups ?? r.item.routeIds.map((id) => [id])).every((group2) => group2.some((id) => d.routeProgress.some((p) => participants.includes(p.ownerId) && p.routeId === id && p.completed))), "unearned compound gate");
      }
      const earned = [...groups].filter((group) => {
        const participants = r.item.scope === "owner" ? [group] : players.filter((p) => p.teamId === group).map((p) => p.ownerId);
        return (r.item.routeGroups ?? r.item.routeIds.map((id) => [id])).every((group2) => group2.some((id) => d.routeProgress.some((p) => participants.includes(p.ownerId) && p.routeId === id && p.completed)));
      });
      reject(earned.length === qualified.length && earned.every((group) => qualified.includes(group)), "omitted earned compound gate");
    }
    const alive = [...new Set(players.filter((_, i) => !d.metas[i].eliminated).map((p) => p.teamId))];
    reject(d.phase === "finished" ? d.finishReason === "timeout" ? tick === maxTicks && d.winnerTeamId === null : mode === "battle" && alive.length <= 1 && d.winnerTeamId === (alive[0] ?? null) && d.finishReason === (alive.length ? "last-team" : "mutual-elimination") : d.winnerTeamId === null && d.finishReason === null, "winner");
    reject(d.phase !== "ready" || players.every((_, i) => d.state[HEADER + i * BALL_STRIDE + 4] === 0 && !d.metas[i].eliminated), "ready phase");
    const restoreCaptures = captures.prepareRestore(d.captures, tick, players.map((p, i) => {
      const o = HEADER + i * BALL_STRIDE;
      return { id: `core-${p.ownerId}`, ownerId: p.ownerId, arenaId: world.arenas[d.state[o + 7]].id, x: d.state[o] / Q3, y: d.state[o + 1] / Q3, vx: d.state[o + 2] / Q3, vy: d.state[o + 3] / Q3, radius: d.state[o + 9] / Q3, layer: d.state[o + 8], elevation: d.state[o + 14] / Q3, active: d.state[o + 4] === 1, eliminated: d.metas[i].eliminated };
    }), (id, ownerId) => {
      const ri = requirements.findIndex((r) => r.item.id === id), player = players[ownerIndex.get(ownerId)];
      return ri >= 0 && !!player && d.qualifications[ri].includes(requirements[ri].item.scope === "owner" ? ownerId : player.teamId);
    });
    reject(Array.isArray(d.mechanisms) && d.mechanisms.length === mechanisms.length, "mechanism storage");
    for (const m of d.mechanisms)
      reject(m && Object.keys(m).sort().join(",") === "activationSerial,activationTick,intensity" && integer3(m.activationTick, 0, tick) && integer3(m.activationSerial, 0, tick) && integer3(m.intensity, 0, 1024) && (m.activationSerial === 0 ? m.activationTick === 0 && m.intensity === 0 : m.activationTick > 0 && m.intensity > 0), "mechanism activation");
    reject(d.phase !== "ready" || d.captures.transports.length === 0 && d.metas.every((m) => !m.launched), "ready capture phase");
    reject(d.phase !== "finished" || d.captures.transports.length === 0, "finished capture phase");
    state.set(d.state);
    restoreCaptures();
    const restoredOccupied = captures.occupiedGateIds();
    for (let i = 0;i < mechanisms.length; i++)
      Object.assign(mechanisms[i], d.mechanisms[i]);
    for (let i = 0;i < metas.length; i++)
      Object.assign(metas[i], d.metas[i]);
    for (let i = 0;i < gates.length; i++) {
      gates[i].openTicks = d.gates[i];
      kernel.enabled(gates[i].kernelId, d.gates[i] > 0 && !restoredOccupied.has(gates[i].item.id) ? 0 : 1);
    }
    for (let i = 0;i < switches.length; i++) {
      switches[i].remainingTicks = d.switches[i][0];
      switches[i].lastOwnerId = d.switches[i][1];
    }
    for (let i = 0;i < portals.length; i++)
      portals[i].transfers = d.portals[i];
    for (let i = 0;i < stations.length; i++) {
      stations[i].ownerId = d.stations[i][0];
      stations[i].leaseTicks = d.stations[i][1];
    }
    for (const f of flippers)
      kernel.lease(f.kernelId, stationByFlipper.get(f.item.id)?.ownerId ?? -1);
    routeProgress.clear();
    for (const p of d.routeProgress)
      routeProgress.set(`${p.ownerId}:${p.routeId}`, { ...p });
    for (let i = 0;i < requirements.length; i++) {
      requirements[i].qualifiedBy.clear();
      for (const n of d.qualifications[i])
        requirements[i].qualifiedBy.add(n);
    }
    eventTick = state[0];
    phase = d.phase;
    winnerTeamId = d.winnerTeamId;
    finishReason = d.finishReason;
    contactTimes.clear();
    for (const [k, v] of d.contactTimes)
      contactTimes.set(k, v);
    commandIds.splice(0, commandIds.length, ...d.commandIds);
    events = d.events.map((e) => ({ ...e }));
    held.fill(0);
  }
  return { world, players: Object.freeze(players), step, readFrame, readEvents: () => events.map((e) => ({ ...e })), snapshot, restore, getStats: () => ({ staticChecks: state[6], pairChecks: state[5], contactBudget: state[7], budgetOwners: players.filter((_, i) => state[HEADER + i * BALL_STRIDE + 12] === 1).map((p) => p.ownerId), bytes: kernel.memory.buffer.byteLength, kernel: ARENA_KERNEL_SHA256 }) };
}

// packages/pinball-replay/src/module.ts
var manifest2 = defineManifest({ id: "keel/pinball-replay", version: "0.1.0", kind: "runtime", needs: ["keel/runtime@^0.1", "keel/codec@^0.1", "keel/pinball-arena@^0.1"], title: "Deterministic pinball replay", description: "Bounded admitted-input and command tapes, exact authority identity, portable integrity checks and independent playback." });

// packages/pinball-replay/src/index.ts
var MAGIC = 827478091;
var MAX_TICKS = ARENA_HZ * 180;
var MAX_FILE = 16 * 1024 * 1024;
var MAX_HEADER = 8 * 1024 * 1024;
var MAX_SNAPSHOT = 1500000;
var utf8 = new TextEncoder;
var text = new TextDecoder("utf-8", { fatal: true });
var digest = (bytes) => toHex(sha256(bytes));
var integer4 = (n, lo, hi) => typeof n === "number" && Number.isSafeInteger(n) && n >= lo && n <= hi;
var demand = (ok, label) => {
  if (!ok)
    throw new Error("Invalid pinball replay: " + label);
};
function validateTape(tape) {
  demand(tape.schema === "keel-pinball-replay@1" && tape.kernel === ARENA_KERNEL_SHA256 && tape.authority === ARENA_AUTHORITY_REVISION, "authority identity");
  demand(Array.isArray(tape.players) && integer4(tape.players.length, 1, 100) && integer4(tape.startTick, 0, ARENA_HZ * 3600) && integer4(tape.ticks, 0, MAX_TICKS) && typeof tape.recentSegment === "boolean", "duration/roster");
  demand(tape.initialSnapshot instanceof Uint8Array && tape.initialSnapshot.length <= MAX_SNAPSHOT && tape.inputs instanceof Uint8Array && tape.inputs.length === tape.ticks * tape.players.length * 3, "byte lengths");
  demand(typeof tape.finalDigest === "string" && /^[0-9a-f]{64}$/.test(tape.finalDigest) && tape.options && typeof tape.options === "object" && !Array.isArray(tape.options) && tape.options.players === undefined, "rules/digest");
  demand(Array.isArray(tape.commands) && tape.commands.length <= tape.ticks, "command log");
  let previous = -1;
  for (const entry of tape.commands) {
    demand(integer4(entry.tick, 0, tape.ticks - 1) && entry.tick > previous && Array.isArray(entry.commands) && integer4(entry.commands.length, 1, 100), "command tick");
    previous = entry.tick;
  }
  for (let at = 0;at < tape.inputs.length; at += 3)
    demand(tape.inputs[at] <= 63 && tape.inputs[at + 1] !== 128 && tape.inputs[at + 2] !== 128, "admitted input");
}
function createArenaReplayPlayer(candidate) {
  validateTape(candidate);
  const tape = { ...candidate, world: structuredClone(candidate.world), players: structuredClone(candidate.players), options: structuredClone(candidate.options), initialSnapshot: candidate.initialSnapshot.slice(), inputs: candidate.inputs.slice(), commands: structuredClone(candidate.commands) };
  const match = createArenaMatch(tape.world, { ...tape.options, players: tape.players });
  match.restore(tape.initialSnapshot);
  demand(match.readFrame().tick === tape.startTick, "initial tick");
  let index = 0, commandIndex = 0, verified = false;
  function verify() {
    if (index === tape.ticks && !verified) {
      demand(digest(match.snapshot()) === tape.finalDigest, "final snapshot");
      verified = true;
    }
  }
  function step() {
    if (index === tape.ticks) {
      verify();
      return match.readFrame();
    }
    const offset = index * tape.players.length * 3, entry = tape.commands[commandIndex];
    const inputs = tape.players.map((player, i) => ({ ownerId: player.ownerId, bits: tape.inputs[offset + i * 3], steerX: (tape.inputs[offset + i * 3 + 1] << 24 >> 24) / 127, steerY: (tape.inputs[offset + i * 3 + 2] << 24 >> 24) / 127 }));
    const usesCommands = entry?.tick === index, frame = match.step(inputs, usesCommands ? entry.commands : []);
    demand(frame.tick === tape.startTick + index + 1, "tick progression");
    if (usesCommands)
      commandIndex++;
    index++;
    verify();
    return frame;
  }
  verify();
  return { step, readFrame: match.readFrame, snapshot: match.snapshot, get index() {
    return index;
  }, get ticks() {
    return tape.ticks;
  }, get complete() {
    return verified;
  } };
}
function decodeArenaReplay(bytes) {
  demand(bytes.length >= 48 && bytes.length <= MAX_FILE, "file length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  demand(view.getUint32(0, true) === MAGIC, "file version");
  const headerLength = view.getUint32(4, true), snapshotLength = view.getUint32(8, true), inputLength = view.getUint32(12, true), bodyLength = 16 + headerLength + snapshotLength + inputLength;
  demand(headerLength <= MAX_HEADER && snapshotLength <= MAX_SNAPSHOT && bodyLength + 32 === bytes.length, "section lengths");
  demand(digest(bytes.subarray(0, bodyLength)) === toHex(bytes.subarray(bodyLength)), "file checksum");
  const metadata = JSON.parse(text.decode(bytes.subarray(16, 16 + headerLength)));
  const tape = { ...metadata, initialSnapshot: bytes.slice(16 + headerLength, 16 + headerLength + snapshotLength), inputs: bytes.slice(16 + headerLength + snapshotLength, bodyLength) };
  validateTape(tape);
  return tape;
}

// packages/pinball-feedback/src/module.ts
var manifest3 = defineManifest({ id: "keel/pinball-feedback", version: "0.1.0", kind: "runtime", needs: ["keel/core@^0.1", "keel/runtime@^0.1", "keel/pinball-arena@^0.1", "keel/audio@^0.1"], title: "Pinball mechanism feedback", description: "Bounded seeded mechanism poses, particles, lamp pulses and sound cues from admitted pinball state and events." });
// packages/audio/src/score.ts
var MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11]
};
var MINORISH = new Set(["dorian", "phrygian", "aeolian", "harmonic"]);
var BANDS = {
  "Late Shift": { keys: [["rhodes", 4], ["wurli", 2], ["piano", 1]], lead: [["rhodes", 2], ["vibes", 1], ["guitar", 1], ["kalimba", 1]], bass: [["sub", 2], ["electric", 2], ["upright", 1]], feel: [["dusty", 3], ["boombap", 2], ["rim", 1]], tempo: [68, 90], swing: [0.22, 0.36], room: 0.25, jazz: 0.35, vox: 0.3, scratch: 0.5, bright: 0.5, worn: 0.5 },
  "Retro Den": { keys: [["wurli", 2], ["organ", 2], ["rhodes", 1]], lead: [["chip", 3], ["kalimba", 1]], bass: [["synth", 3], ["electric", 1]], feel: [["chip", 2], ["boombap", 2]], tempo: [80, 93], swing: [0.08, 0.2], room: 0.2, jazz: 0.1, vox: 0.1, scratch: 0.6, bright: 0.6, worn: 0.6, mode: "dorian" },
  Candlelight: { keys: [["felt", 3], ["piano", 2], ["guitar", 1]], lead: [["celesta", 2], ["vibes", 1], ["musicbox", 1]], bass: [["upright", 3], ["sub", 1]], feel: [["brushed", 3], ["soft", 2]], tempo: [66, 80], swing: [0.2, 0.32], room: 0.42, jazz: 0.3, vox: 0.4, scratch: 0.15, bright: 0.35, worn: 0.5, lean: "major" },
  Bedside: { keys: [["felt", 3], ["piano", 1], ["rhodes", 1]], lead: [["musicbox", 3], ["kalimba", 2], ["celesta", 1]], bass: [["sub", 3], ["upright", 1]], feel: [["soft", 3], ["brushed", 1]], tempo: [64, 78], swing: [0.18, 0.28], room: 0.4, jazz: 0.2, vox: 0.25, scratch: 0.1, bright: 0.3, worn: 0.55, lean: "major" },
  "The Reading": { keys: [["rhodes", 2], ["piano", 1], ["felt", 1]], lead: [["celesta", 2], ["kalimba", 1], ["vibes", 1]], bass: [["sub", 3], ["upright", 1]], feel: [["dusty", 2], ["soft", 1]], tempo: [66, 82], swing: [0.18, 0.3], room: 0.48, jazz: 0.25, vox: 0.5, scratch: 0.25, bright: 0.4, worn: 0.6, mode: "dorian" },
  "Night Desk": { keys: [["rhodes", 3], ["piano", 2], ["wurli", 1]], lead: [["rhodes", 1], ["vibes", 1], ["guitar", 1]], bass: [["upright", 3], ["electric", 1]], feel: [["rim", 3], ["dusty", 1]], tempo: [68, 86], swing: [0.26, 0.38], room: 0.3, jazz: 0.45, vox: 0.2, scratch: 0.3, bright: 0.45, worn: 0.45 },
  "Game Night": { keys: [["rhodes", 2], ["wurli", 2], ["organ", 1]], lead: [["chip", 3], ["kalimba", 1]], bass: [["synth", 2], ["electric", 2]], feel: [["boombap", 3], ["chip", 1]], tempo: [80, 93], swing: [0.14, 0.26], room: 0.2, jazz: 0.15, vox: 0.2, scratch: 0.7, bright: 0.6, worn: 0.4, mode: "mixolydian" },
  Nightcap: { keys: [["vibes", 2], ["piano", 2], ["rhodes", 1]], lead: [["vibes", 2], ["guitar", 1], ["rhodes", 1]], bass: [["upright", 4]], feel: [["brushed", 3], ["rim", 1]], tempo: [66, 84], swing: [0.3, 0.4], room: 0.35, jazz: 0.6, vox: 0.2, scratch: 0.15, bright: 0.45, worn: 0.45, mode: "dorian" },
  Collector: { keys: [["felt", 2], ["rhodes", 1], ["wurli", 1]], lead: [["musicbox", 2], ["kalimba", 2]], bass: [["sub", 2], ["electric", 1]], feel: [["boombap", 2], ["dusty", 1]], tempo: [72, 90], swing: [0.18, 0.3], room: 0.3, jazz: 0.2, vox: 0.3, scratch: 0.5, bright: 0.55, worn: 0.5, lean: "major" },
  "Green Sill": { keys: [["felt", 2], ["guitar", 2], ["piano", 1]], lead: [["celesta", 1], ["kalimba", 2], ["musicbox", 1]], bass: [["sub", 2], ["upright", 1]], feel: [["soft", 2], ["brushed", 2]], tempo: [66, 82], swing: [0.18, 0.3], room: 0.38, jazz: 0.25, vox: 0.35, scratch: 0.15, bright: 0.4, worn: 0.5, lean: "major" },
  Mixtape: { keys: [["rhodes", 2], ["wurli", 1], ["piano", 1]], lead: [["rhodes", 1], ["guitar", 1], ["vibes", 1]], bass: [["electric", 2], ["sub", 1]], feel: [["boombap", 3], ["dusty", 1]], tempo: [74, 93], swing: [0.26, 0.36], room: 0.25, jazz: 0.3, vox: 0.35, scratch: 0.8, bright: 0.5, worn: 0.8 },
  "A Room": { keys: [["rhodes", 2], ["felt", 2], ["guitar", 1], ["piano", 1]], lead: [["celesta", 1], ["kalimba", 1], ["vibes", 1]], bass: [["sub", 2], ["upright", 1]], feel: [["dusty", 2], ["soft", 1], ["brushed", 1]], tempo: [66, 86], swing: [0.2, 0.32], room: 0.45, jazz: 0.3, vox: 0.35, scratch: 0.35, bright: 0.45, worn: 0.5 },
  Loose: { keys: [["rhodes", 2], ["felt", 1], ["piano", 1]], lead: [["rhodes", 1], ["celesta", 1], ["kalimba", 1]], bass: [["sub", 2], ["electric", 1]], feel: [["dusty", 2], ["boombap", 1]], tempo: [68, 88], swing: [0.2, 0.32], room: 0.3, jazz: 0.3, vox: 0.3, scratch: 0.4, bright: 0.45, worn: 0.5 }
};
var CHOICES = {
  band: Object.keys(BANDS),
  kit: ["dusty", "boombap", "brushed", "soft", "rim", "chip"],
  keys: ["rhodes", "wurli", "piano", "felt", "vibes", "organ", "guitar"],
  lead: ["rhodes", "piano", "celesta", "kalimba", "musicbox", "vibes", "guitar", "chip"],
  bass: ["sub", "upright", "electric", "synth"],
  mode: Object.keys(MODES),
  key: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
};
var HATS = {
  16: [...Array(16).keys()],
  8: [0, 2, 4, 6, 8, 10, 12, 14],
  4: [0, 4, 8, 12],
  "16skip": [0, 2, 3, 4, 6, 8, 10, 11, 12, 14],
  swing16: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
  shaker: []
};
// packages/audio/src/samples.ts
var TAU = Math.PI * 2;
// packages/codec/src/bits.ts
var F = new DataView(new ArrayBuffer(8));
var P32 = 2 ** 32;

class BitError extends RangeError {
  bit;
  constructor(message, bit) {
    super(message);
    this.name = "BitError";
    this.bit = bit;
  }
}
function bitsFor(n) {
  if (n <= 1)
    return 0;
  if (n <= 4294967296)
    return 32 - Math.clz32(n - 1);
  let b = 32;
  let v = Math.floor((n - 1) / 4294967296);
  while (v >= 1) {
    v = Math.floor(v / 2);
    b += 1;
  }
  return b;
}
var lengthOf = (x) => x < 4294967296 ? 32 - Math.clz32(x) : 32 + lengthOf(Math.floor(x / 4294967296));
function toHalf(v) {
  F.setFloat32(0, v);
  const x = F.getUint32(0);
  const sign = x >>> 16 & 32768;
  const exp = x >>> 23 & 255;
  let mant = x & 8388607;
  if (exp === 255)
    return sign | 31744 | (mant ? 512 : 0);
  const e = exp - 127 + 15;
  if (e >= 31)
    return sign | 31744;
  if (e <= 0) {
    if (e < -10)
      return sign;
    mant |= 8388608;
    const shift = 14 - e;
    let h2 = mant >>> shift;
    const rem2 = mant & (1 << shift) - 1;
    const half = 1 << shift - 1;
    if (rem2 > half || rem2 === half && h2 & 1)
      h2 += 1;
    return sign | h2;
  }
  let h = e << 10 | mant >>> 13;
  const rem = mant & 8191;
  if (rem > 4096 || rem === 4096 && h & 1)
    h += 1;
  return sign | h;
}
function fromHalf(h) {
  const sign = h & 32768 ? -1 : 1;
  const exp = h >>> 10 & 31;
  const mant = h & 1023;
  if (exp === 0)
    return sign * mant * 2 ** -24;
  if (exp === 31)
    return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

class BitWriter {
  buf;
  pos = 0;
  bit = 0;
  constructor(capacity = 256) {
    this.buf = new Uint8Array(Math.max(16, capacity));
  }
  get length() {
    return this.pos * 8 + this.bit;
  }
  room(bytes) {
    if (this.pos + bytes < this.buf.length)
      return;
    let n = this.buf.length * 2;
    while (n <= this.pos + bytes)
      n *= 2;
    const next = new Uint8Array(n);
    next.set(this.buf.subarray(0, this.pos + 1));
    this.buf = next;
  }
  bits(v, n) {
    if (n === 0)
      return;
    this.room(5);
    const buf = this.buf;
    let pos = this.pos;
    let bit = this.bit;
    while (n > 0) {
      const free = 8 - bit;
      if (n >= free) {
        n -= free;
        buf[pos] = buf[pos] | v >>> n & (1 << free) - 1;
        pos += 1;
        bit = 0;
      } else {
        buf[pos] = buf[pos] | (v & (1 << n) - 1) << free - n;
        bit += n;
        n = 0;
      }
    }
    this.pos = pos;
    this.bit = bit;
  }
  wide(v, n) {
    if (n <= 32) {
      this.bits(v >>> 0, n);
      return;
    }
    const hi = Math.floor(v / P32);
    this.bits(hi, n - 32);
    this.bits(v >>> 0, 32);
  }
  bool(b) {
    this.bits(b ? 1 : 0, 1);
  }
  big(v, n) {
    let left = n;
    while (left > 32) {
      left -= 32;
      this.bits(Number(v >> BigInt(left) & 0xffffffffn), 32);
    }
    this.bits(Number(v & (1n << BigInt(left)) - 1n), left);
  }
  golomb(v, k) {
    const x = v + (k < 31 ? 1 << k : 2 ** k);
    const len = lengthOf(x);
    const zeros = len - 1 - k;
    if (zeros > 0) {
      this.room((zeros >>> 3) + 6);
      const at = this.pos * 8 + this.bit + zeros;
      this.pos = at >>> 3;
      this.bit = at & 7;
    }
    if (len <= 32)
      this.bits(x >>> 0, len);
    else
      this.wide(x, len);
  }
  groups(v, g) {
    const span = 2 ** g;
    do {
      const part = v % span;
      v = Math.floor(v / span);
      this.bits(part, g);
      this.bool(v > 0);
    } while (v > 0);
  }
  f16(v) {
    this.bits(toHalf(v), 16);
  }
  f32(v) {
    F.setFloat32(0, v);
    this.bits(F.getUint32(0), 32);
  }
  f64(v) {
    F.setFloat64(0, v);
    this.bits(F.getUint32(0), 32);
    this.bits(F.getUint32(4), 32);
  }
  bytes(b) {
    if (this.bit === 0) {
      this.room(b.length + 1);
      this.buf.set(b, this.pos);
      this.pos += b.length;
      return;
    }
    for (let i = 0;i < b.length; i += 1)
      this.bits(b[i], 8);
  }
  append(other) {
    const n = other.length;
    const src = other.buf;
    const full = n >>> 3;
    if (this.bit === 0) {
      this.room(full + 2);
      this.buf.set(src.subarray(0, full), this.pos);
      this.pos += full;
    } else
      for (let i = 0;i < full; i += 1)
        this.bits(src[i], 8);
    const rest = n & 7;
    if (rest)
      this.bits(src[full] >>> 8 - rest, rest);
  }
  align() {
    if (this.bit) {
      this.pos += 1;
      this.bit = 0;
      this.room(1);
    }
  }
  finish() {
    return this.buf.slice(0, this.pos + (this.bit ? 1 : 0));
  }
  reset() {
    this.buf.fill(0, 0, this.pos + 1);
    this.pos = 0;
    this.bit = 0;
  }
}
// packages/codec/src/schema.ts
class SchemaError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}
var bad = (why) => {
  throw new SchemaError(why);
};
var whole = (v, lo, hi, what) => {
  if (!Number.isInteger(v) || v < lo || v > hi)
    bad(`${what} must be a whole number in ${lo}..${hi} (got ${v}).`);
  return v;
};
var node = (n) => Object.freeze(n);
var asNode = (t) => t;
var uint = (bits) => node({ kind: "uint", bits: whole(bits, 1, 53, "uint bits") });
var int = (bits) => node({ kind: "int", bits: whole(bits, 2, 53, "int bits") });
var bool = () => node({ kind: "bool" });
function fixed(min, max, step, { off = "round", k = -1, delta = false } = {}) {
  if (![min, max, step].every(Number.isFinite))
    bad("fixed(min, max, step) takes finite numbers.");
  if (!(step > 0))
    bad(`fixed step must be positive (got ${step}).`);
  if (!(max > min))
    bad(`fixed max must be above min (got ${min}..${max}).`);
  const steps = Math.round((max - min) / step);
  if (steps > 2 ** 52)
    bad(`fixed(${min}, ${max}, ${step}) has more than 2^52 steps.`);
  if (!["round", "strict", "exact"].includes(off))
    bad(`fixed off must be "round", "strict" or "exact" (got ${off}).`);
  if (delta && k < 0)
    bad("fixed delta needs a Golomb k (the differences are Golomb-coded).");
  return node({ kind: "fixed", min, max, step, off, k: whole(k, -1, 31, "fixed k"), delta });
}
var float64 = () => node({ kind: "float", bits: 64 });
var varuint = ({ k = 0, group = 0 } = {}) => node({ kind: "varuint", k: whole(k, 0, 31, "varuint k"), group: whole(group, 0, 31, "varuint group") });
var num = () => node({ kind: "num" });
function enumOf(values, { capacity = 0, open = false, other = false } = {}) {
  if (!values.length)
    bad("An enum needs values.");
  const seen = new Set;
  for (const v of values) {
    const key = `${typeof v}:${String(v)}`;
    if (!["string", "number", "boolean"].includes(typeof v))
      bad(`Enum values are strings, numbers or booleans (got ${typeof v}).`);
    if (seen.has(key))
      bad(`Enum value ${JSON.stringify(v)} is listed twice.`);
    seen.add(key);
  }
  if (capacity && capacity < values.length)
    bad(`Enum capacity ${capacity} is below its ${values.length} values.`);
  return node({ kind: "enum", values: Object.freeze([...values]), capacity: whole(capacity, 0, 2 ** 32, "enum capacity"), open, other });
}
var string = ({ max = 0, packHex = false } = {}) => node({ kind: "string", max: whole(max, 0, 2 ** 32, "string max"), packHex });
var ref = (table = "str", { packHex = false } = {}) => node({ kind: "ref", table: table || bad("ref needs a table name."), packHex });
var bytes = ({ length = 0 } = {}) => node({ kind: "bytes", length: whole(length, 0, 2 ** 32, "bytes length") });
var dyn = () => node({ kind: "dyn" });
function array(of, { length = 0, max = 0 } = {}) {
  if (length && max)
    bad("An array has a fixed length or a max, not both.");
  return node({ kind: "array", of: asNode(of), length: whole(length, 0, 2 ** 32, "array length"), max: whole(max, 0, 2 ** 32, "array max") });
}
var optional = (of) => node({ kind: "optional", of: asNode(of), optional: true });
var nullable = (of) => node({ kind: "nullable", of: asNode(of) });
var withDefault = (of, value) => node({ kind: "default", of: asNode(of), value });
var fieldsOf = (fields, what) => {
  const out = [];
  for (const [name, type] of Object.entries(fields)) {
    if (!name)
      bad(`${what}: a field needs a name.`);
    if (!type || typeof type.kind !== "string")
      bad(`${what}: field ${name} is not a schema.`);
    out.push(Object.freeze({ name, type: asNode(type) }));
  }
  return out;
};
function struct(fields, { open = false } = {}) {
  return node({ kind: "struct", fields: Object.freeze(fieldsOf(fields, "struct")), open, ext: Object.freeze([]) });
}
var tuple = (items) => node({ kind: "tuple", items: Object.freeze(items.map(asNode)) });
function union(tag, variants, { capacity = 0 } = {}) {
  const list = fieldsOf(variants, "union");
  if (!list.length)
    bad("A union needs variants.");
  for (const v of list) {
    if (v.type.kind !== "struct")
      bad(`Union variant ${v.name} must be a struct.`);
    const st = v.type;
    if ([...st.fields, ...st.ext.flat()].some((f) => f.name === tag))
      bad(`Union variant ${v.name} has a field called ${tag}, its tag.`);
  }
  if (capacity && capacity < list.length)
    bad(`Union capacity ${capacity} is below its ${list.length} variants.`);
  return node({ kind: "union", tag, variants: Object.freeze(list), capacity: whole(capacity, 0, 2 ** 16, "union capacity") });
}
function alt(of) {
  if (of.length < 2)
    bad("alt() takes two or more types.");
  const cats = of.map((t) => categoryOf(asNode(t)));
  const seen = new Set;
  for (const c of cats) {
    if (c === "any")
      bad("alt() branches must have a definite category (not dyn, optional or a recursion).");
    if (seen.has(c))
      bad(`alt() has two ${c} branches: nothing tells them apart.`);
    seen.add(c);
  }
  return node({ kind: "alt", of: Object.freeze(of.map(asNode)) });
}
function map(key, value, { order = "sorted" } = {}) {
  if (categoryOf(asNode(key)) !== "string")
    bad("A map's key must be a string type (string, ref, hex or an enum of strings).");
  return node({ kind: "map", key: asNode(key), value: asNode(value), order });
}
function delta(of, { k = 0 } = {}) {
  const n = asNode(of);
  if (!["uint", "int", "varuint", "varint", "fixed"].includes(n.kind))
    bad("delta() takes uint, int, varuint, varint or fixed.");
  if (n.kind === "fixed" && n.delta)
    bad("delta() of a fixed that is already delta-coded: give it a plain fixed().");
  return node({ kind: "delta", of: n, k: whole(k, 0, 31, "delta k") });
}
var named = (name, of, { version = 1, doc = "" } = {}) => node({ kind: "named", name: name || bad("named() needs a name."), version: whole(version, 0, 2 ** 32, "version"), doc, of: asNode(of) });
function recursive(build) {
  const placeholder = Object.freeze({ kind: "self", depth: -1 });
  const body = asNode(build(placeholder));
  const fix = (n, depth) => {
    if (n === placeholder)
      return node({ kind: "self", depth });
    return mapChildren(n, (c) => fix(c, depth + (n.kind === "rec" ? 1 : 0)));
  };
  return node({ kind: "rec", of: fix(body, 0) });
}
function mapChildren(n, f) {
  const fl = (fs) => {
    let changed = false;
    const out = fs.map((x) => {
      const t = f(x.type);
      if (t !== x.type)
        changed = true;
      return t === x.type ? x : Object.freeze({ name: x.name, type: t });
    });
    return changed ? Object.freeze(out) : fs;
  };
  switch (n.kind) {
    case "array":
    case "optional":
    case "nullable":
    case "default":
    case "delta":
    case "runs":
    case "named":
    case "rec":
    case "lz": {
      const of = f(n.of);
      return of === n.of ? n : node({ ...n, of });
    }
    case "struct": {
      const fields = fl(n.fields);
      const ext = n.ext.map(fl);
      return fields === n.fields && ext.every((g, i) => g === n.ext[i]) ? n : node({ ...n, fields, ext: Object.freeze(ext) });
    }
    case "union": {
      const variants = fl(n.variants);
      return variants === n.variants ? n : node({ ...n, variants });
    }
    case "tuple": {
      const items = n.items.map(f);
      return items.every((x, i) => x === n.items[i]) ? n : node({ ...n, items: Object.freeze(items) });
    }
    case "alt": {
      const of = n.of.map(f);
      return of.every((x, i) => x === n.of[i]) ? n : node({ ...n, of: Object.freeze(of) });
    }
    case "map": {
      const key = f(n.key);
      const value = f(n.value);
      return key === n.key && value === n.value ? n : node({ ...n, key, value });
    }
    case "grow": {
      const base = f(n.base);
      const of = f(n.of);
      return base === n.base && of === n.of ? n : node({ ...n, base, of });
    }
    default:
      return n;
  }
}
function categoryOf(n) {
  switch (n.kind) {
    case "uint":
    case "int":
    case "fixed":
    case "float":
    case "varuint":
    case "varint":
    case "num":
      return "number";
    case "bool":
      return "boolean";
    case "string":
    case "ref":
    case "hex":
      return "string";
    case "biguint":
      return "bigint";
    case "bytes":
      return "bytes";
    case "array":
    case "delta":
    case "runs":
    case "planes":
    case "tuple":
    case "lz":
    case "grow":
      return "array";
    case "struct":
    case "union":
    case "map":
      return "object";
    case "nullable":
      return "any";
    case "enum": {
      const c = new Set([...n.values.map((v) => typeof v), ...n.other ? ["string"] : []]);
      return c.size === 1 ? [...c][0] : "any";
    }
    case "const":
      return n.value === null ? "null" : Array.isArray(n.value) ? "array" : typeof n.value;
    case "named":
    case "default":
      return categoryOf(n.of);
    default:
      return "any";
  }
}
// packages/codec/src/codec-primitives.ts
class CodecError extends Error {
  path;
  why;
  bit;
  constructor(why, path = [], bit = null) {
    super(why);
    this.name = "CodecError";
    this.why = why;
    this.path = path;
    this.bit = bit;
    this.message = CodecError.format(why, path, bit);
  }
  static format(why, path, bit) {
    const p = pathText(path);
    return `${p ? `${p}: ` : ""}${why}${bit !== null ? ` (at bit ${bit})` : ""}`;
  }
}
function pathText(path) {
  let out = "";
  for (const k of path)
    out += typeof k === "number" ? `[${k}]` : out ? `.${k}` : k;
  return out;
}
var fail = (why) => {
  throw new CodecError(why);
};
function under(e, label, bit = null) {
  if (e instanceof CodecError) {
    e.path.unshift(label);
    if (e.bit === null && bit !== null)
      e.bit = bit;
    e.message = CodecError.format(e.why, e.path, e.bit);
    return e;
  }
  if (e instanceof BitError)
    return new CodecError(e.message.replace(/ at bit \d+/, ""), [label], e.bit);
  if (e instanceof Error)
    return new CodecError(e.message, [label]);
  return new CodecError(String(e), [label]);
}

class Tables {
  m = new Map;
  constructor(init = {}) {
    for (const [name, list] of Object.entries(init))
      for (const s of list)
        this.add(name, s);
  }
  table(name) {
    let t = this.m.get(name);
    if (!t) {
      t = { list: [], index: new Map };
      this.m.set(name, t);
    }
    return t;
  }
  add(name, s) {
    const t = this.table(name);
    const have = t.index.get(s);
    if (have !== undefined)
      return have;
    t.list.push(s);
    t.index.set(s, t.list.length - 1);
    return t.list.length - 1;
  }
  n = new Map;
  numbers(name) {
    let t = this.n.get(name);
    if (!t) {
      t = { list: [], index: new Map };
      this.n.set(name, t);
    }
    return t;
  }
  sh = new Map;
  shapes(name) {
    let t = this.sh.get(name);
    if (!t) {
      t = { list: [], index: new Map };
      this.sh.set(name, t);
    }
    return t;
  }
  toJSON() {
    return Object.fromEntries([...this.m.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, [...v.list]]));
  }
}
var fresh = () => ({ tables: new Tables, trace: null, strict: true, text: new BitWriter(64), tr: null, last: null });
var lastOf = (x) => x.last ??= new Map;
function wr(c, o, v, x, label) {
  try {
    c.w(o, v, x);
  } catch (e) {
    throw under(e, label, null);
  }
}
function rd(c, i, x, label) {
  const start = i.at;
  try {
    if (x.trace === null)
      return c.r(i, x);
    x.trace.open(label, c.node, start);
    const v = c.r(i, x);
    x.trace.close(v, i.at);
    return v;
  } catch (e) {
    throw under(e, label, start);
  }
}
var meta = (x, label, start, i, value, note = "") => {
  x.trace?.meta(label, start, i.at - start, value, note);
};
function same(a, b) {
  if (typeof a === "number" || typeof b === "number")
    return Object.is(a, b);
  if (a === b)
    return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return false;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.length !== b.length)
      return false;
    for (let k = 0;k < a.length; k += 1)
      if (a[k] !== b[k])
        return false;
    return true;
  }
  const aa = Array.isArray(a) || ArrayBuffer.isView(a);
  if (aa !== (Array.isArray(b) || ArrayBuffer.isView(b)))
    return false;
  if (aa) {
    const x = a, y = b;
    if (x.length !== y.length)
      return false;
    for (let k = 0;k < x.length; k += 1)
      if (!same(x[k], y[k]))
        return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length)
    return false;
  for (const k of ka)
    if (!same(a[k], b[k]))
      return false;
  return true;
}
function put(o, k, v) {
  if (k === "__proto__")
    Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else
    o[k] = v;
}
var zig = (v) => v >= 0 ? v * 2 : -v * 2 - 1;
var unzig = (u) => u % 2 ? -(u + 1) / 2 : u / 2;
var describe = (v) => typeof v === "string" ? JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}...` : v) : typeof v === "bigint" ? `${v}n` : Array.isArray(v) ? `an array of ${v.length}` : v instanceof Uint8Array ? `${v.length} bytes` : v === null ? "null" : typeof v === "object" ? "an object" : String(v);
var GRIDS = new WeakMap;
function gridOf(n) {
  const have = GRIDS.get(n);
  if (have)
    return have;
  const inv = 1 / n.step;
  const den = Math.abs(inv - Math.round(inv)) < 0.000000001 * Math.max(1, inv) ? Math.round(inv) : 0;
  const value = den ? (k) => k / den : (k) => k * n.step;
  const units = den ? (v) => Math.round(v * den) : (v) => Math.round(v / n.step);
  const near = (x) => Math.abs(x - Math.round(x)) <= 0.000000001 * Math.max(1, Math.abs(x)) ? Math.round(x) : null;
  const lo = near(n.min / n.step) ?? Math.ceil(n.min / n.step);
  const hi = near(n.max / n.step) ?? Math.floor(n.max / n.step);
  let places = -1;
  if (den) {
    for (let p = 0, ten = 1;p <= 15; p += 1, ten *= 10)
      if (ten % den === 0) {
        places = p;
        break;
      }
  }
  const g = { lo, hi, bits: bitsFor(hi - lo + 1), den, step: n.step, places, value, units };
  GRIDS.set(n, g);
  return g;
}
function intCheck(v, what) {
  if (typeof v !== "number" || !Number.isInteger(v))
    fail(`${describe(v)} is not a whole number (${what}).`);
  return v;
}
var NUM_KINDS = ["int", "decimal", "float32", "float64"];
var TEN = [1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8];
function placesOf(v) {
  if (!Number.isFinite(v) || Object.is(v, -0) || Math.abs(v) > 2 ** 40)
    return 0;
  for (let p = 1;p <= 8; p += 1) {
    const m = Math.round(v * TEN[p]);
    if (Math.abs(m) <= 2 ** 51 && m / TEN[p] === v)
      return p;
  }
  return 0;
}
function writeNum(o, v, tagBits) {
  if (Number.isSafeInteger(v) && !Object.is(v, -0) && Math.abs(v) <= 2 ** 51) {
    o.bits(0, tagBits);
    o.golomb(zig(v), 0);
    return;
  }
  const p = placesOf(v);
  if (p) {
    o.bits(1, tagBits);
    o.bits(p - 1, 3);
    o.golomb(zig(Math.round(v * TEN[p])), 0);
    return;
  }
  if (Number.isNaN(v) || Object.is(Math.fround(v), v)) {
    o.bits(2, tagBits);
    o.f32(v);
    return;
  }
  o.bits(3, tagBits);
  o.f64(v);
}
function readNum(i, tag) {
  if (tag === 0)
    return unzig(i.golomb(0));
  if (tag === 1) {
    const p = i.bits(3) + 1;
    const m = unzig(i.golomb(0));
    const v = m / TEN[p];
    if (Number.isInteger(v) || placesOf(v) !== p)
      throw new CodecError(`A decimal with ${p} places that isn't its shortest spelling (not canonical).`);
    return v;
  }
  if (tag === 2)
    return i.f32();
  return i.f64();
}
var COMPILED = new WeakMap;
function compiled(root, compile) {
  const have = COMPILED.get(root);
  if (have)
    return have;
  const c = compile(root, []);
  COMPILED.set(root, c);
  return c;
}
var enc = new TextEncoder;
function utf82(s) {
  const n = s.length;
  if (n < 64) {
    let ascii = true;
    for (let k = 0;k < n; k += 1)
      if (s.charCodeAt(k) > 127) {
        ascii = false;
        break;
      }
    if (ascii) {
      const b = new Uint8Array(n);
      for (let k = 0;k < n; k += 1)
        b[k] = s.charCodeAt(k);
      return b;
    }
  }
  return enc.encode(s);
}
function fromUtf8(tr, len) {
  const b = tr.bytes(len);
  if (len < 64) {
    let ascii = true;
    for (let k = 0;k < len; k += 1)
      if (b[k] > 127) {
        ascii = false;
        break;
      }
    if (ascii)
      return String.fromCharCode.apply(null, b);
  }
  return dec.decode(b);
}
var LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
var wellFormed = (s) => !LONE.test(s);
var SCRATCH = new BitWriter(64);
var dec = new TextDecoder("utf-8", { fatal: true });

// packages/codec/src/codec.ts
function compiled2(root) {
  return compiled(root, compile);
}
function compile(n, recs) {
  switch (n.kind) {
    case "uint": {
      const max = 2 ** n.bits;
      const what = `uint(${n.bits})`;
      return {
        node: n,
        w(o, v) {
          const k = intCheck(v, what);
          if (k < 0 || k >= max)
            fail(`${k} is outside ${what}'s 0..${max - 1}.`);
          o.wide(k, n.bits);
        },
        r: (i) => i.bits(n.bits)
      };
    }
    case "int": {
      const half = 2 ** (n.bits - 1);
      const what = `int(${n.bits})`;
      return {
        node: n,
        w(o, v) {
          const k = intCheck(v, what);
          if (k < -half || k >= half)
            fail(`${k} is outside ${what}'s ${-half}..${half - 1}.`);
          o.wide(zig(k), n.bits);
        },
        r: (i) => unzig(i.bits(n.bits))
      };
    }
    case "bool":
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "boolean")
            fail(`${describe(v)} is not a boolean.`);
          o.bool(v);
        },
        r: (i) => i.bool()
      };
    case "fixed": {
      const g = gridOf(n);
      const what = `fixed(${n.min}, ${n.max}, ${n.step})`;
      const exact = n.off === "exact";
      const signed = g.lo < 0;
      const self = {};
      const put2 = n.delta ? (o, k, x) => {
        const m = lastOf(x);
        const d = k - (m.get(self) ?? 0);
        if (d === 0)
          o.bool(false);
        else {
          o.bool(true);
          o.golomb(zig(d) - 1, n.k);
        }
        m.set(self, k);
      } : n.k >= 0 ? (o, k) => o.golomb(signed ? zig(k) : k, n.k) : (o, k) => o.wide(k - g.lo, g.bits);
      const get = n.delta ? (i, x) => {
        const m = lastOf(x);
        const k = (m.get(self) ?? 0) + (i.bool() ? unzig(i.golomb(n.k) + 1) : 0);
        if (k < g.lo || k > g.hi)
          fail(`${g.value(k)} is outside ${what} (corrupt data).`);
        m.set(self, k);
        return k;
      } : n.k >= 0 ? (i) => {
        const u = i.golomb(n.k);
        const k = signed ? unzig(u) : u;
        if (k < g.lo || k > g.hi)
          fail(`${g.value(k)} is outside ${what} (corrupt data).`);
        return k;
      } : (i) => i.wide(g.bits) + g.lo;
      return {
        node: n,
        w(o, v, ctx) {
          if (typeof v !== "number")
            fail(`${describe(v)} is not a number (${what}).`);
          const x = v;
          if (exact) {
            const k2 = Number.isFinite(x) ? g.units(x) : NaN;
            if (k2 >= g.lo && k2 <= g.hi && Object.is(g.value(k2) === 0 ? 0 : g.value(k2), x)) {
              o.bool(false);
              put2(o, k2, ctx);
              return;
            }
            o.bool(true);
            o.f64(x);
            return;
          }
          if (!Number.isFinite(x))
            fail(`${x} is not a finite number (${what}).`);
          const k = g.units(x);
          if (k < g.lo)
            fail(`${x} is below ${what}'s min ${n.min}.`);
          if (k > g.hi)
            fail(`${x} is above ${what}'s max ${n.max}.`);
          if (n.off === "strict" && g.value(k) !== x)
            fail(`${x} is not on ${what}'s grid (nearest ${g.value(k)}).`);
          put2(o, k, ctx);
        },
        r(i, x) {
          if (exact) {
            const s = i.at;
            const whole2 = i.bool();
            if (x.trace)
              meta(x, "exact", s, i, whole2, whole2 ? "off the grid: a float64" : "on the grid");
            if (whole2)
              return i.f64();
          }
          const v = g.value(get(i, x));
          return v === 0 ? 0 : v;
        }
      };
    }
    case "float": {
      const bits = n.bits;
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "number")
            fail(`${describe(v)} is not a number.`);
          const x = v;
          if (bits === 32) {
            if (!Number.isNaN(x) && !Object.is(Math.fround(x), x))
              fail(`${x} is not exactly a float32 (use float64 or fixed()).`);
            o.f32(x);
          } else if (bits === 16) {
            if (!Number.isNaN(x) && !Object.is(fromHalf(toHalf(x)), x))
              fail(`${x} is not exactly a float16 (use float32, float64 or fixed()).`);
            o.f16(x);
          } else
            o.f64(x);
        },
        r: (i) => bits === 32 ? i.f32() : bits === 16 ? i.f16() : i.f64()
      };
    }
    case "varuint":
    case "varint": {
      const signed = n.kind === "varint";
      const put2 = n.group ? (o, u) => o.groups(u, n.group) : (o, u) => o.golomb(u, n.k);
      const get = n.group ? (i) => i.groups(n.group) : (i) => i.golomb(n.k);
      return {
        node: n,
        w(o, v) {
          const k = intCheck(v, n.kind);
          if (!Number.isSafeInteger(k))
            fail(`${k} is beyond a safe integer.`);
          if (!signed && k < 0)
            fail(`${k} is negative (a varuint).`);
          if (signed && Math.abs(k) > 2 ** 51)
            fail(`${k} is beyond a varint's ±2^51.`);
          put2(o, signed ? zig(k) : k);
        },
        r: (i) => signed ? unzig(get(i)) : get(i)
      };
    }
    case "num":
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "number")
            fail(`${describe(v)} is not a number.`);
          writeNum(o, v, 2);
        },
        r(i, x) {
          const s = i.at;
          const tag = i.bits(2);
          if (x.trace)
            meta(x, "kind", s, i, NUM_KINDS[tag], "");
          return readNum(i, tag);
        }
      };
    case "biguint": {
      const lim = 1n << BigInt(n.bits);
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "bigint")
            fail(`${describe(v)} is not a bigint (biguint(${n.bits})).`);
          if (v < 0n || v >= lim)
            fail(`${v}n is outside biguint(${n.bits}).`);
          o.big(v, n.bits);
        },
        r: (i) => i.big(n.bits)
      };
    }
    case "enum": {
      const index = new Map(n.values.map((v, k) => [v, k]));
      const limit = n.capacity || n.values.length;
      const width = bitsFor(limit + (n.other ? 1 : 0));
      const str = n.other ? compile({ kind: "string", max: 0 }, []) : null;
      return {
        node: n,
        w(o, v, x) {
          const k = index.get(v);
          if (k === undefined) {
            if (str && typeof v === "string") {
              if (n.open)
                o.golomb(limit, 0);
              else
                o.bits(limit, width);
              str.w(o, v, x);
              return;
            }
            fail(`${describe(v)} is not one of ${JSON.stringify(n.values.length > 12 ? [...n.values.slice(0, 12), "..."] : n.values)}.`);
          }
          if (n.open)
            o.golomb(k, 0);
          else
            o.bits(k, width);
        },
        r(i, x) {
          const s = i.at;
          const k = n.open ? i.golomb(0) : i.bits(width);
          if (str && k === limit) {
            if (x.trace)
              meta(x, "other", s, i, k, "not in the list: written out");
            return str.r(i, x);
          }
          if (k >= n.values.length)
            fail(`Enum index ${k} is not a value this reader knows (it knows ${n.values.length}: data from a newer schema?).`);
          return n.values[k];
        }
      };
    }
    case "string": {
      const lw = n.max ? bitsFor(n.max + 1) : -1;
      const HEX = /^0x(?:[0-9a-f]{2})+$/;
      return {
        node: n,
        w(o, v, x) {
          if (typeof v !== "string")
            fail(`${describe(v)} is not a string.`);
          const s = v;
          const text2 = x.text;
          if (n.packHex) {
            const packed = HEX.test(s);
            o.bool(packed);
            if (packed) {
              const len = (s.length - 2) / 2;
              o.golomb(len - 1, 0);
              for (let k = 0;k < len; k += 1)
                text2.bits(parseInt(s.slice(2 + k * 2, 4 + k * 2), 16), 8);
              return;
            }
          }
          if (!wellFormed(s))
            fail("The string has a lone surrogate (not UTF-8 encodable).");
          const b = utf82(s);
          if (n.max && b.length > n.max)
            fail(`The string is ${b.length} bytes; the max is ${n.max}.`);
          if (lw >= 0)
            o.bits(b.length, lw);
          else
            o.golomb(b.length, 0);
          text2.bytes(b);
        },
        r(i, x) {
          const tr = x.tr;
          if (n.packHex) {
            const s0 = i.at;
            const packed = i.bool();
            if (x.trace)
              meta(x, "hex", s0, i, packed, packed ? "0x hex, packed as bytes" : "text");
            if (packed) {
              const s1 = i.at;
              const len2 = i.golomb(0) + 1;
              if (x.trace)
                meta(x, "length", s1, i, len2, `${len2} bytes`);
              const t02 = tr.at;
              let out2 = "0x";
              for (let k = 0;k < len2; k += 1)
                out2 += tr.bits(8).toString(16).padStart(2, "0");
              if (x.trace)
                x.trace.meta("text", t02, len2 * 8, out2, `${len2} bytes in the text section`);
              return out2;
            }
          }
          const s = i.at;
          const len = lw >= 0 ? i.bits(lw) : i.golomb(0);
          if (x.trace)
            meta(x, "length", s, i, len, `${len} bytes`);
          if (n.max && len > n.max)
            fail(`The string is ${len} bytes; the max is ${n.max}.`);
          const t0 = tr.at;
          const out = fromUtf8(tr, len);
          if (x.trace)
            x.trace.meta("text", t0, len * 8, out, `${len} bytes in the text section`);
          return out;
        }
      };
    }
    case "ref": {
      const text2 = compile({ kind: "string", max: 0, packHex: n.packHex }, []);
      return {
        node: n,
        w(o, v, x) {
          if (typeof v !== "string")
            fail(`${describe(v)} is not a string (ref "${n.table}").`);
          const s = v;
          const t = x.tables.table(n.table);
          const k = t.index.get(s);
          const size = t.list.length;
          if (k !== undefined) {
            o.bits(k, bitsFor(size + 1));
            return;
          }
          o.bits(size, bitsFor(size + 1));
          text2.w(o, s, x);
          t.list.push(s);
          t.index.set(s, size);
        },
        r(i, x) {
          const t = x.tables.table(n.table);
          const size = t.list.length;
          const s0 = i.at;
          const k = i.bits(bitsFor(size + 1));
          if (k < size) {
            if (x.trace)
              meta(x, "index", s0, i, k, `table ${n.table} #${k} of ${size}`);
            return t.list[k];
          }
          if (k > size)
            fail(`Table ${n.table} has ${size} strings; the data names #${k}.`);
          if (x.trace)
            meta(x, "index", s0, i, k, `new: table ${n.table} #${k}`);
          const s = text2.r(i, x);
          if (t.index.has(s))
            fail(`${JSON.stringify(s)} written again in full (not canonical: it's table ${n.table} #${t.index.get(s)}).`);
          t.list.push(s);
          t.index.set(s, size);
          return s;
        }
      };
    }
    case "bytes":
      return {
        node: n,
        w(o, v) {
          if (!(v instanceof Uint8Array))
            fail(`${describe(v)} is not a Uint8Array.`);
          const b = v;
          if (n.length) {
            if (b.length !== n.length)
              fail(`${b.length} bytes; this is exactly ${n.length}.`);
          } else
            o.golomb(b.length, 0);
          o.bytes(b);
        },
        r(i, x) {
          const s = i.at;
          const len = n.length || i.golomb(0);
          if (!n.length) {
            if (x.trace)
              meta(x, "length", s, i, len, `${len} bytes`);
          }
          return i.bytes(len);
        }
      };
    case "hex": {
      const re = /^0x(?:[0-9a-f]{2})*$/;
      return {
        node: n,
        w(o, v) {
          if (typeof v !== "string" || !re.test(v))
            fail(`${describe(v)} is not "0x" + lower-case hex byte pairs.`);
          const s = v;
          const len = (s.length - 2) / 2;
          if (n.bytes) {
            if (len !== n.bytes)
              fail(`${len} bytes of hex; this is exactly ${n.bytes}.`);
          } else
            o.golomb(len, 0);
          for (let k = 0;k < len; k += 1)
            o.bits(parseInt(s.slice(2 + k * 2, 4 + k * 2), 16), 8);
        },
        r(i, x) {
          const s = i.at;
          const len = n.bytes || i.golomb(0);
          if (!n.bytes) {
            if (x.trace)
              meta(x, "length", s, i, len, `${len} bytes`);
          }
          let out = "0x";
          for (let k = 0;k < len; k += 1)
            out += i.bits(8).toString(16).padStart(2, "0");
          return out;
        }
      };
    }
    case "const":
      return {
        node: n,
        w(_o, v) {
          if (!same(v, n.value))
            fail(`${describe(v)} is not the constant ${JSON.stringify(n.value)}.`);
        },
        r: () => structuredClone(n.value)
      };
    case "dyn":
      return dynCodec(n);
    case "array": {
      const of = compile(n.of, recs);
      const lw = n.max ? bitsFor(n.max + 1) : -1;
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v) && !(ArrayBuffer.isView(v) && !(v instanceof DataView)))
            fail(`${describe(v)} is not an array.`);
          const a = v;
          if (n.length) {
            if (a.length !== n.length)
              fail(`${a.length} items; this is exactly ${n.length}.`);
          } else if (lw >= 0) {
            if (a.length > n.max)
              fail(`${a.length} items; the max is ${n.max}.`);
            o.bits(a.length, lw);
          } else
            o.golomb(a.length, 0);
          let k = 0;
          try {
            for (;k < a.length; k += 1)
              of.w(o, a[k], x);
          } catch (e) {
            throw under(e, k, null);
          }
        },
        r(i, x) {
          const s = i.at;
          const len = n.length || (lw >= 0 ? i.bits(lw) : i.golomb(0));
          if (!n.length) {
            if (x.trace)
              meta(x, "length", s, i, len, `${len} items`);
          }
          if (n.max && len > n.max)
            fail(`${len} items; the max is ${n.max}.`);
          if (len > 2 ** 28)
            fail(`${len} items: corrupt data.`);
          const out = new Array(len);
          if (x.trace !== null) {
            for (let k2 = 0;k2 < len; k2 += 1)
              out[k2] = rd(of, i, x, k2);
            return out;
          }
          let k = 0;
          try {
            for (;k < len; k += 1)
              out[k] = of.r(i, x);
          } catch (e) {
            throw under(e, k, null);
          }
          return out;
        }
      };
    }
    case "grow": {
      const b = n.base;
      const item = compile(b.of, recs);
      const next = compile(n.of, recs);
      const lw = bitsFor(b.max + 1);
      const spare = 2 ** lw - 1;
      const above = recs.map((c) => c.node);
      return {
        node: n,
        w(o, v, x) {
          if (!holds(b, v, above)) {
            o.bits(spare, lw);
            next.w(o, v, x);
            return;
          }
          if (!Array.isArray(v) && !(ArrayBuffer.isView(v) && !(v instanceof DataView)))
            fail(`${describe(v)} is not an array.`);
          const a = v;
          o.bits(a.length, lw);
          let k = 0;
          try {
            for (;k < a.length; k += 1)
              item.w(o, a[k], x);
          } catch (e) {
            throw under(e, k, null);
          }
        },
        r(i, x) {
          const s = i.at;
          const len = i.bits(lw);
          if (len === spare) {
            if (x.trace)
              meta(x, "grown", s, i, len, "the spare length code: the grown layout follows");
            const v = next.r(i, x);
            if (holds(b, v, above))
              fail("Written in the grown layout, but the original layout holds it (not canonical).");
            return v;
          }
          if (x.trace)
            meta(x, "length", s, i, len, `${len} items`);
          if (len > b.max)
            fail(`${len} items; the max is ${b.max}.`);
          const out = new Array(len);
          if (x.trace !== null) {
            for (let k2 = 0;k2 < len; k2 += 1)
              out[k2] = rd(item, i, x, k2);
            return out;
          }
          let k = 0;
          try {
            for (;k < len; k += 1)
              out[k] = item.r(i, x);
          } catch (e) {
            throw under(e, k, null);
          }
          return out;
        }
      };
    }
    case "optional":
    case "nullable": {
      const of = compile(n.of, recs);
      const none = n.kind === "optional" ? undefined : null;
      return {
        node: n,
        w(o, v, x) {
          const has = n.kind === "optional" ? v !== undefined : v !== null;
          if (n.kind === "nullable" && v === undefined && n.of.kind !== "optional" && n.of.kind !== "default")
            fail("undefined is not a value here (nullable: give null).");
          o.bool(has);
          if (has)
            of.w(o, v, x);
        },
        r(i, x) {
          const s = i.at;
          const has = i.bool();
          if (x.trace)
            meta(x, "present", s, i, has, has ? "present" : n.kind === "optional" ? "absent" : "null");
          return has ? of.r(i, x) : none;
        }
      };
    }
    case "default": {
      const of = compile(n.of, recs);
      try {
        of.w(new BitWriter(16), n.value, fresh());
      } catch (e) {
        throw new SchemaError(`withDefault(): the default isn't a value of its type: ${e.message}`);
      }
      return {
        node: n,
        w(o, v, x) {
          if (v === undefined || same(v, n.value)) {
            o.bool(false);
            return;
          }
          o.bool(true);
          of.w(o, v, x);
        },
        r(i, x) {
          const s = i.at;
          const given = i.bool();
          if (x.trace)
            meta(x, "given", s, i, given, given ? "not the default" : "the default");
          return given ? of.r(i, x) : structuredClone(n.value);
        }
      };
    }
    case "struct":
      return structCodec(n.fields, n.open, n.ext, recs, n, null);
    case "tuple": {
      const items = n.items.map((it) => compile(it, recs));
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v))
            fail(`${describe(v)} is not a tuple (an array of ${items.length}).`);
          const a = v;
          if (a.length !== items.length)
            fail(`A tuple of ${items.length}; got ${a.length} items.`);
          for (let k = 0;k < items.length; k += 1)
            wr(items[k], o, a[k], x, k);
        },
        r(i, x) {
          const out = new Array(items.length);
          for (let k = 0;k < items.length; k += 1)
            out[k] = rd(items[k], i, x, k);
          return out;
        }
      };
    }
    case "union": {
      const variants = n.variants.map((f) => {
        const s = f.type;
        return { name: f.name, c: structCodec(s.fields, s.open, s.ext, recs, s, n.tag) };
      });
      const index = new Map(variants.map((v, k) => [v.name, k]));
      const width = bitsFor(n.capacity || variants.length);
      return {
        node: n,
        w(o, v, x) {
          if (typeof v !== "object" || v === null)
            fail(`${describe(v)} is not an object (a union by "${n.tag}").`);
          const tag = v[n.tag];
          const k = typeof tag === "string" ? index.get(tag) : undefined;
          if (k === undefined)
            fail(`${n.tag} ${describe(tag)} is not one of ${variants.map((x2) => x2.name).join(", ")}.`);
          o.bits(k, width);
          wr(variants[k].c, o, v, x, `${n.tag}(${String(tag)})`);
        },
        r(i, x) {
          const s = i.at;
          const k = i.bits(width);
          const vt = variants[k];
          if (!vt)
            fail(`Union tag ${k} is not a variant this reader knows (it knows ${variants.length}: data from a newer schema?).`);
          if (x.trace)
            meta(x, n.tag, s, i, vt.name, `variant ${k}: ${vt.name}`);
          const body = rd(vt.c, i, x, `${n.tag}(${vt.name})`);
          const out = { [n.tag]: vt.name };
          for (const key in body)
            put(out, key, body[key]);
          return out;
        }
      };
    }
    case "alt": {
      const branches = n.of.map((b) => ({ cat: categoryOf(b), c: compile(b, recs) }));
      const width = bitsFor(branches.length);
      return {
        node: n,
        w(o, v, x) {
          const cat = valueCategory(v);
          const k = branches.findIndex((b) => b.cat === cat);
          if (k < 0)
            fail(`${describe(v)} (${cat}) matches none of ${branches.map((b) => b.cat).join(", ")}.`);
          o.bits(k, width);
          wr(branches[k].c, o, v, x, `(${cat})`);
        },
        r(i, x) {
          const s = i.at;
          const k = i.bits(width);
          const b = branches[k];
          if (!b)
            fail(`Alt branch ${k} doesn't exist.`);
          if (x.trace)
            meta(x, "branch", s, i, b.cat, `branch ${k}: ${b.cat}`);
          return rd(b.c, i, x, `(${b.cat})`);
        }
      };
    }
    case "map": {
      const kc = compile(n.key, recs);
      const vc = compile(n.value, recs);
      return {
        node: n,
        w(o, v, x) {
          if (typeof v !== "object" || v === null || Array.isArray(v))
            fail(`${describe(v)} is not a record.`);
          const rec = v;
          const keys2 = Object.keys(rec).filter((k) => rec[k] !== undefined);
          if (n.order === "sorted")
            keys2.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
          o.golomb(keys2.length, 0);
          for (const k of keys2) {
            wr(kc, o, k, x, `${k}(key)`);
            wr(vc, o, rec[k], x, k);
          }
        },
        r(i, x) {
          const s = i.at;
          const count = i.golomb(0);
          if (x.trace)
            meta(x, "count", s, i, count, `${count} entries`);
          const out = {};
          let last = null;
          for (let k = 0;k < count; k += 1) {
            const key = rd(kc, i, x, `#${k}(key)`);
            if (Object.hasOwn(out, key))
              fail(`The key ${JSON.stringify(key)} is in the map twice.`);
            if (n.order === "sorted" && last !== null && !(last < key))
              fail(`Map keys out of order (${JSON.stringify(last)} before ${JSON.stringify(key)}): not canonical.`);
            last = key;
            put(out, key, rd(vc, i, x, key));
          }
          return out;
        }
      };
    }
    case "delta": {
      const first = compile(n.of, recs);
      const of = n.of;
      const g = of.kind === "fixed" ? gridOf(of) : null;
      const toUnits = g ? (v) => g.units(v) : (v) => v;
      const fromUnits = g ? (k) => {
        const v = g.value(k);
        return v === 0 ? 0 : v;
      } : (k) => k;
      const lo = g ? g.lo : of.kind === "uint" || of.kind === "varuint" ? 0 : -Infinity;
      const hi = g ? g.hi : of.kind === "uint" ? 2 ** of.bits - 1 : of.kind === "int" ? 2 ** (of.bits - 1) - 1 : Infinity;
      const lo2 = of.kind === "int" ? -(2 ** (of.bits - 1)) : lo;
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v) && !ArrayBuffer.isView(v))
            fail(`${describe(v)} is not an array.`);
          const a = v;
          o.golomb(a.length, 0);
          if (!a.length)
            return;
          wr(first, o, a[0], x, 0);
          let prev = toUnits(a[0]);
          for (let k = 1;k < a.length; k += 1) {
            const e = a[k];
            SCRATCH.reset();
            try {
              first.w(SCRATCH, e, x);
            } catch (err) {
              throw under(err, k, null);
            }
            const u = toUnits(e);
            o.golomb(zig(u - prev), n.k);
            prev = u;
          }
        },
        r(i, x) {
          const s = i.at;
          const len = i.golomb(0);
          if (x.trace)
            meta(x, "length", s, i, len, `${len} items`);
          const out = new Array(len);
          if (!len)
            return out;
          out[0] = rd(first, i, x, 0);
          let prev = toUnits(out[0]);
          for (let k = 1;k < len; k += 1) {
            const s1 = i.at;
            const d = unzig(i.golomb(n.k));
            prev += d;
            if (prev < lo2 || prev > hi)
              throw under(new CodecError(`A delta walks out of range (${prev}).`), k, s1);
            out[k] = fromUnits(prev);
            if (x.trace)
              meta(x, `[${k}]`, s1, i, out[k], `${d >= 0 ? "+" : ""}${d}`);
          }
          return out;
        }
      };
    }
    case "runs": {
      const of = compile(n.of, recs);
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v) && !ArrayBuffer.isView(v))
            fail(`${describe(v)} is not an array.`);
          const a = v;
          o.golomb(a.length, 0);
          let k = 0;
          while (k < a.length) {
            let j = k + 1;
            while (j < a.length && same(a[j], a[k]))
              j += 1;
            wr(of, o, a[k], x, k);
            o.golomb(j - k - 1, 0);
            k = j;
          }
        },
        r(i, x) {
          const s = i.at;
          const len = i.golomb(0);
          if (x.trace)
            meta(x, "length", s, i, len, `${len} items`);
          const out = new Array(len);
          let k = 0;
          let prev = undefined;
          while (k < len) {
            const v = rd(of, i, x, k);
            if (k > 0 && same(v, prev))
              fail(`Two runs of the same value at ${k}: not canonical.`);
            const s1 = i.at;
            const run = i.golomb(0) + 1;
            if (x.trace)
              meta(x, "run", s1, i, run, `x${run}`);
            if (k + run > len)
              fail(`A run of ${run} overruns the ${len} items.`);
            for (let j = 0;j < run; j += 1)
              out[k + j] = j === 0 ? v : structuredClone(v);
            k += run;
            prev = v;
          }
          return out;
        }
      };
    }
    case "lz": {
      const of = compile(n.of, recs);
      const MIN = n.min;
      const WINDOW = 1 << 16;
      const CHAIN = 48;
      return {
        node: n,
        w(o, v, x) {
          if (!Array.isArray(v) && !ArrayBuffer.isView(v))
            fail(`${describe(v)} is not an array.`);
          const a = v;
          const L = a.length;
          o.golomb(L, 0);
          const heads = new Map;
          const keyAt = (p) => {
            let key = "";
            for (let q2 = 0;q2 < MIN; q2 += 1)
              key += `${typeof a[p + q2] === "string" ? "s" : ""}${String(a[p + q2])}\x00`;
            return key;
          };
          const insert = (p) => {
            if (p + MIN > L)
              return;
            const key = keyAt(p);
            let c = heads.get(key);
            if (!c) {
              c = [];
              heads.set(key, c);
            }
            c.push(p);
            if (c.length > CHAIN * 2)
              c.splice(0, c.length - CHAIN);
          };
          let i = 0;
          while (i < L) {
            let bestLen = 0, bestDist = 0;
            if (i + MIN <= L) {
              const c = heads.get(keyAt(i));
              if (c)
                for (let q2 = c.length - 1, tries = 0;q2 >= 0 && tries < CHAIN; q2 -= 1, tries += 1) {
                  const j = c[q2];
                  if (i - j > WINDOW)
                    break;
                  let len = 0;
                  while (i + len < L && a[j + len] === a[i + len])
                    len += 1;
                  if (len > bestLen) {
                    bestLen = len;
                    bestDist = i - j;
                    if (i + len === L)
                      break;
                  }
                }
            }
            if (bestLen >= MIN) {
              o.bool(true);
              o.golomb(bestDist - 1, 0);
              o.golomb(bestLen - MIN, 0);
              for (let q2 = 0;q2 < bestLen; q2 += 1)
                insert(i + q2);
              i += bestLen;
            } else {
              o.bool(false);
              wr(of, o, a[i], x, i);
              insert(i);
              i += 1;
            }
          }
        },
        r(i, x) {
          const s = i.at;
          const L = i.golomb(0);
          if (x.trace)
            meta(x, "length", s, i, L, `${L} items`);
          const out = new Array(L);
          let k = 0;
          while (k < L) {
            const s1 = i.at;
            if (i.bool()) {
              const dist = i.golomb(0) + 1;
              const len = i.golomb(0) + MIN;
              if (x.trace)
                meta(x, "copy", s1, i, len, `${len} items from ${dist} back`);
              if (dist > k)
                fail(`A copy from ${dist} back at item ${k} reaches before the start.`);
              if (k + len > L)
                fail(`A copy of ${len} at item ${k} overruns the ${L} items.`);
              for (let q2 = 0;q2 < len; q2 += 1)
                out[k + q2] = out[k + q2 - dist];
              k += len;
            } else {
              if (x.trace)
                meta(x, "literal", s1, i, null, "a literal item");
              out[k] = rd(of, i, x, k);
              k += 1;
            }
          }
          return out;
        }
      };
    }
    case "planes": {
      const lim = 2 ** n.bits;
      return {
        node: n,
        w(o, v) {
          if (!Array.isArray(v) && !ArrayBuffer.isView(v))
            fail(`${describe(v)} is not an array.`);
          const a = v;
          for (let k = 0;k < a.length; k += 1) {
            const e = a[k];
            if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e >= lim)
              throw under(new CodecError(`${describe(e)} is outside planes(${n.bits})'s 0..${lim - 1}.`), k, null);
          }
          o.golomb(a.length, 0);
          for (let b = n.bits - 1;b >= 0; b -= 1) {
            const m = 2 ** b;
            for (let k = 0;k < a.length; k += 1)
              o.bits(Math.floor(a[k] / m) % 2, 1);
          }
        },
        r(i, x) {
          const s = i.at;
          const len = i.golomb(0);
          if (x.trace)
            meta(x, "length", s, i, len, `${len} items`);
          const out = new Array(len).fill(0);
          for (let b = n.bits - 1;b >= 0; b -= 1) {
            const s1 = i.at;
            const m = 2 ** b;
            for (let k = 0;k < len; k += 1)
              if (i.bool())
                out[k] = out[k] + m;
            if (x.trace)
              meta(x, `plane ${b}`, s1, i, null, `bit ${b} of every value`);
          }
          return out;
        }
      };
    }
    case "named": {
      const of = compile(n.of, recs);
      return { node: n, w: (o, v, x) => of.w(o, v, x), r: (i, x) => of.r(i, x) };
    }
    case "rec": {
      const fwd = { c: null };
      const self = { node: n, w: (o, v, x) => fwd.c.w(o, v, x), r: (i, x) => fwd.c.r(i, x) };
      fwd.c = compile(n.of, [...recs, self]);
      return self;
    }
    case "self": {
      const target = recs[recs.length - 1 - n.depth];
      if (!target)
        throw new SchemaError(`A self node (depth ${n.depth}) outside its recursive().`);
      return { node: n, w: (o, v, x) => target.w(o, v, x), r: (i, x) => target.r(i, x) };
    }
  }
}
function holds(n, v, recs = []) {
  const fields = (fs, ext, tag) => {
    if (typeof v !== "object" || v === null || Array.isArray(v))
      return true;
    const rec = v;
    const all = [...fs, ...ext.flat()];
    for (const key in rec)
      if (rec[key] !== undefined && key !== tag && !all.some((f) => f.name === key))
        return false;
    return all.every((f) => rec[f.name] === undefined || holds(f.type, rec[f.name], recs));
  };
  switch (n.kind) {
    case "named":
    case "default":
    case "optional":
      return v === undefined || holds(n.of, v, recs);
    case "nullable":
      return v === undefined || v === null || holds(n.of, v, recs);
    case "rec":
      return holds(n.of, v, [...recs, n]);
    case "self": {
      const at = recs.length - 1 - n.depth;
      return at < 0 || holds(recs[at], v, recs.slice(0, at));
    }
    case "array":
    case "runs":
    case "lz": {
      if (!Array.isArray(v) && !(ArrayBuffer.isView(v) && !(v instanceof DataView)))
        return true;
      const a = v;
      if (n.kind === "array" && n.max && a.length > n.max)
        return false;
      for (let k = 0;k < a.length; k += 1)
        if (!holds(n.of, a[k], recs))
          return false;
      return true;
    }
    case "tuple":
      return !Array.isArray(v) || n.items.every((t, k) => holds(t, v[k], recs));
    case "struct":
      return fields(n.fields, n.ext, null);
    case "union": {
      const tag = typeof v === "object" && v !== null ? v[n.tag] : undefined;
      const variant = n.variants.find((x) => x.name === tag)?.type;
      return !variant || fields(variant.fields, variant.ext, n.tag);
    }
    case "alt": {
      const cat = valueCategory(v);
      const b = n.of.find((x) => categoryOf(x) === cat);
      return !b || holds(b, v, recs);
    }
    case "map":
      return typeof v !== "object" || v === null || Array.isArray(v) || Object.values(v).every((x) => x === undefined || holds(n.value, x, recs));
    case "grow":
      return holds(n.of, v, recs);
    default:
      return true;
  }
}
function valueCategory(v) {
  if (v === null)
    return "null";
  if (Array.isArray(v))
    return "array";
  if (v instanceof Uint8Array)
    return "bytes";
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean" || t === "bigint")
    return t;
  return "object";
}
function structCodec(fields, open, ext, recs, node2, tagKey) {
  const fs = fields.map((f) => ({ name: f.name, c: compile(f.type, recs), optional: f.type.kind === "optional" }));
  const groups = ext.map((g) => g.map((f) => ({ name: f.name, c: compile(f.type, recs), optional: f.type.kind === "optional", node: f.type })));
  const known = new Set([...fields, ...ext.flat()].map((f) => f.name));
  if (tagKey !== null)
    known.add(tagKey);
  const proto = known.has("__proto__");
  const scratch = [];
  const empty = (g, v) => g.every((f) => v[f.name] === undefined || f.node.kind === "default" && same(v[f.name], f.node.value));
  return {
    node: node2,
    w(o, v, x) {
      if (typeof v !== "object" || v === null || Array.isArray(v))
        fail(`${describe(v)} is not an object.`);
      const rec = v;
      let k = 0;
      let given = tagKey !== null && rec[tagKey] !== undefined ? 1 : 0;
      try {
        for (;k < fs.length; k += 1) {
          const f = fs[k];
          const fv = rec[f.name];
          if (fv !== undefined)
            given += 1;
          f.c.w(o, fv, x);
        }
      } catch (e) {
        throw under(e, fs[k].name, null);
      }
      if (x.strict) {
        let all = 0;
        for (const key in rec)
          if (rec[key] !== undefined)
            all += 1;
        if (all > given) {
          for (const g of groups)
            for (const f of g)
              if (rec[f.name] !== undefined)
                given += 1;
          if (all > given) {
            for (const key in rec)
              if (!known.has(key) && rec[key] !== undefined)
                fail(`Unknown field ${JSON.stringify(key)} (the fields are ${[...known].join(", ")}).`);
          }
        }
      }
      if (!open)
        return;
      let count = groups.length;
      while (count > 0 && empty(groups[count - 1], rec))
        count -= 1;
      o.golomb(count, 0);
      for (let g = 0;g < count; g += 1) {
        const s = scratch.pop() ?? new BitWriter(64);
        s.reset();
        const t0 = x.text.length;
        for (const f of groups[g])
          wr(f.c, s, rec[f.name], x, f.name);
        o.golomb(s.length, 0);
        o.golomb((x.text.length - t0) / 8, 0);
        o.append(s);
        scratch.push(s);
      }
    },
    r(i, x) {
      const out = {};
      if (x.trace !== null || proto) {
        for (let k = 0;k < fs.length; k += 1) {
          const f = fs[k];
          const v = rd(f.c, i, x, f.name);
          if (v !== undefined || !f.optional)
            put(out, f.name, v);
        }
      } else {
        let k = 0;
        try {
          for (;k < fs.length; k += 1) {
            const f = fs[k];
            const v = f.c.r(i, x);
            if (v !== undefined || !f.optional)
              out[f.name] = v;
          }
        } catch (e) {
          throw under(e, fs[k].name, null);
        }
      }
      if (!open)
        return out;
      const s0 = i.at;
      const count = i.golomb(0);
      if (x.trace)
        meta(x, "groups", s0, i, count, `${count} extension group${count === 1 ? "" : "s"}`);
      for (let g = 0;g < Math.max(count, groups.length); g += 1) {
        const group = groups[g];
        if (g >= count) {
          for (const f of group)
            if (f.node.kind === "default")
              out[f.name] = structuredClone(f.node.value);
          continue;
        }
        const s1 = i.at;
        const len = i.golomb(0);
        const textLen = i.golomb(0);
        if (x.trace)
          meta(x, `group ${g + 1}`, s1, i, len, `${len} bits, ${textLen} bytes of text`);
        const start = i.at;
        const t0 = x.tr.at;
        if (!group) {
          i.skip(len);
          x.tr.skip(textLen * 8);
          if (x.trace) {
            meta(x, `group ${g + 1} (unknown)`, start, i, null, "skipped: a newer schema's fields");
            if (textLen)
              x.trace.meta(`group ${g + 1} text (unknown)`, t0, textLen * 8, null, "skipped");
          }
          continue;
        }
        for (const f of group) {
          const v = rd(f.c, i, x, f.name);
          if (v !== undefined || !f.optional)
            out[f.name] = v;
        }
        if (i.at - start !== len)
          fail(`Extension group ${g + 1} is ${len} bits long but its fields read ${i.at - start}.`);
        if (x.tr.at - t0 !== textLen * 8)
          fail(`Extension group ${g + 1} has ${textLen} bytes of text but its fields read ${(x.tr.at - t0) / 8}.`);
      }
      return out;
    }
  };
}
var DYN_TABLE = "str";
var DYN_NUMS = "$dyn";
function dynCodec(n) {
  const str = compile({ kind: "ref", table: DYN_TABLE, packHex: false }, []);
  const w = (o, v, x) => {
    if (v === null) {
      o.bits(0, 3);
      return;
    }
    switch (typeof v) {
      case "boolean":
        o.bits(v ? 2 : 1, 3);
        return;
      case "number":
        if (Number.isSafeInteger(v) && !Object.is(v, -0) && Math.abs(v) <= 2 ** 51) {
          o.bits(3, 3);
          o.golomb(zig(v), 0);
          return;
        }
        o.bits(4, 3);
        {
          const t = x.tables.numbers(DYN_NUMS);
          const at = t.index.get(v);
          if (at !== undefined) {
            o.bits(0, 2);
            o.bits(at, bitsFor(t.list.length));
            return;
          }
          writeNum(o, v, 2);
          t.index.set(v, t.list.length);
          t.list.push(v);
        }
        return;
      case "string":
        o.bits(5, 3);
        str.w(o, v, x);
        return;
      case "object": {
        if (Array.isArray(v)) {
          o.bits(6, 3);
          o.golomb(v.length, 0);
          for (let k = 0;k < v.length; k += 1) {
            try {
              w(o, v[k], x);
            } catch (e) {
              throw under(e, k, null);
            }
          }
          return;
        }
        if (ArrayBuffer.isView(v))
          fail("A typed array isn't JSON-like (dyn): give an array, or a typed schema.");
        const rec = v;
        const keys2 = Object.keys(rec).filter((k) => rec[k] !== undefined);
        o.bits(7, 3);
        const t = x.tables.shapes(DYN_NUMS);
        const sig = JSON.stringify(keys2);
        const at = keys2.length ? t.index.get(sig) : undefined;
        if (at !== undefined) {
          o.bool(true);
          o.bits(at, bitsFor(t.list.length));
        } else {
          o.bool(false);
          o.golomb(keys2.length, 0);
          for (const k of keys2)
            str.w(o, k, x);
          if (keys2.length) {
            t.index.set(sig, t.list.length);
            t.list.push(keys2);
          }
        }
        for (const k of keys2) {
          try {
            w(o, rec[k], x);
          } catch (e) {
            throw under(e, k, null);
          }
        }
        return;
      }
      default:
        fail(`${typeof v} isn't JSON-like (dyn).`);
    }
  };
  const TAGS = ["null", "false", "true", "int", "number", "string", "array", "object"];
  const r = (i, x) => {
    const s = i.at;
    const tag = i.bits(3);
    if (x.trace)
      meta(x, "type", s, i, TAGS[tag], TAGS[tag]);
    switch (tag) {
      case 0:
        return null;
      case 1:
        return false;
      case 2:
        return true;
      case 3:
        return unzig(i.golomb(0));
      case 4: {
        const s1 = i.at;
        const k = i.bits(2);
        const t = x.tables.numbers(DYN_NUMS);
        if (k === 0) {
          const at = i.bits(bitsFor(t.list.length));
          if (x.trace)
            meta(x, "repeat", s1, i, at, `the number #${at} again`);
          if (at >= t.list.length)
            fail(`The number #${at} again, of ${t.list.length}.`);
          return t.list[at];
        }
        if (x.trace)
          meta(x, "kind", s1, i, NUM_KINDS[k], "");
        const v = readNum(i, k);
        if (t.index.has(v))
          fail("A number written again in full (not canonical: it repeats by index).");
        t.index.set(v, t.list.length);
        t.list.push(v);
        return v;
      }
      case 5:
        return str.r(i, x);
      case 6: {
        const s1 = i.at;
        const len = i.golomb(0);
        if (x.trace)
          meta(x, "length", s1, i, len, `${len} items`);
        const out = new Array(len);
        for (let k = 0;k < len; k += 1)
          out[k] = x.trace ? rd(self, i, x, k) : r(i, x);
        return out;
      }
      default: {
        const t = x.tables.shapes(DYN_NUMS);
        const s1 = i.at;
        let keys2;
        if (i.bool()) {
          const at = i.bits(bitsFor(t.list.length));
          if (at >= t.list.length)
            fail(`Object shape #${at} of ${t.list.length}.`);
          keys2 = t.list[at];
          if (x.trace)
            meta(x, "shape", s1, i, at, `shaped like object #${at}: ${keys2.length} keys`);
        } else {
          const count = i.golomb(0);
          if (x.trace)
            meta(x, "keys", s1, i, count, `${count} keys, a new shape`);
          keys2 = [];
          for (let k = 0;k < count; k += 1) {
            const key = str.r(i, x);
            if (keys2.includes(key))
              fail(`The key ${JSON.stringify(key)} is in the object twice.`);
            keys2.push(key);
          }
          if (count) {
            const sig = JSON.stringify(keys2);
            if (t.index.has(sig))
              fail("An object's keys written again in full (not canonical: its shape repeats by index).");
            t.index.set(sig, t.list.length);
            t.list.push(keys2);
          }
        }
        const out = {};
        for (const key of keys2)
          put(out, key, x.trace ? rd(self, i, x, key) : r(i, x));
        return out;
      }
    }
  };
  const self = { node: n, w, r };
  return self;
}
var WRITER = new BitWriter(4096);
var TEXT = new BitWriter(1024);
var OUT = new BitWriter(4096);
var writerBusy = false;
function writeBody(o, c, value, x, bits) {
  c.w(bits, value, x);
  const text2 = x.text;
  let n = text2.length / 8;
  o.align();
  do {
    const b = n % 128;
    n = Math.floor(n / 128);
    o.bits(b | (n > 0 ? 128 : 0), 8);
  } while (n > 0);
  o.append(bits);
  o.align();
  o.append(text2);
}
function encodeRaw(schema, value, opts = {}) {
  const reuse = !writerBusy;
  const bits = reuse ? WRITER : new BitWriter(256);
  const text2 = reuse ? TEXT : new BitWriter(64);
  const out = reuse ? OUT : new BitWriter(256);
  if (reuse) {
    writerBusy = true;
    bits.reset();
    text2.reset();
    out.reset();
  }
  try {
    writeBody(out, compiled2(schema), value, { tables: opts.tables ?? new Tables, trace: null, strict: opts.strict ?? true, text: text2, tr: null, last: null }, bits);
    return out.finish();
  } finally {
    if (reuse)
      writerBusy = false;
  }
}
// packages/codec/src/canonical.ts
var NAMES = "$names";
var field = (self) => struct({ name: ref(NAMES), type: self });
var SCHEMA_SCHEMA = named("keel/codec/schema", recursive((self) => union("kind", {
  uint: struct({ bits: uint(6) }),
  int: struct({ bits: uint(6) }),
  bool: struct({}),
  fixed: struct({ min: num(), max: num(), step: num(), off: enumOf(["round", "strict", "exact"]), k: int(7), delta: bool() }),
  float: struct({ bits: enumOf([16, 32, 64]) }),
  enum: struct({ values: array(alt([string(), num(), bool()])), capacity: varuint(), open: bool(), other: bool() }),
  varuint: struct({ k: uint(5), group: uint(5) }),
  varint: struct({ k: uint(5), group: uint(5) }),
  string: struct({ max: varuint(), packHex: bool() }),
  ref: struct({ table: ref(NAMES), packHex: bool() }),
  bytes: struct({ length: varuint() }),
  hex: struct({ bytes: varuint() }),
  biguint: struct({ bits: uint(9) }),
  array: struct({ of: self, length: varuint(), max: varuint() }),
  optional: struct({ of: self }),
  nullable: struct({ of: self }),
  default: struct({ of: self, value: bytes() }),
  struct: struct({ fields: array(field(self)), open: bool(), ext: array(array(field(self))) }),
  tuple: struct({ items: array(self) }),
  union: struct({ tag: ref(NAMES), variants: array(field(self)), capacity: varuint() }),
  alt: struct({ of: array(self) }),
  map: struct({ key: self, value: self, order: enumOf(["sorted", "kept"]) }),
  delta: struct({ of: self, k: uint(5) }),
  runs: struct({ of: self }),
  planes: struct({ bits: uint(6) }),
  dyn: struct({}),
  num: struct({}),
  const: struct({ value: dyn() }),
  named: struct({ name: ref(NAMES), version: varuint(), doc: string(), of: self }),
  rec: struct({ of: self }),
  self: struct({ depth: varuint() }),
  lz: struct({ of: self, min: uint(4) }),
  grow: struct({ base: self, of: self })
}, { capacity: 64 })), { doc: "Every schema, as data: a document can carry its own." });
function toRecord(type, { docs = true } = {}) {
  const walk = (n) => {
    const fl = (fs) => fs.map((f) => ({ name: f.name, type: walk(f.type) }));
    switch (n.kind) {
      case "uint":
      case "int":
      case "biguint":
      case "planes":
        return { kind: n.kind, bits: n.bits };
      case "bool":
      case "dyn":
      case "num":
        return { kind: n.kind };
      case "fixed":
        return { kind: "fixed", min: n.min, max: n.max, step: n.step, off: n.off, k: n.k, delta: n.delta };
      case "float":
        return { kind: "float", bits: n.bits };
      case "enum":
        return { kind: "enum", values: [...n.values], capacity: n.capacity, open: n.open, other: n.other };
      case "varuint":
      case "varint":
        return { kind: n.kind, k: n.k, group: n.group };
      case "string":
        return { kind: "string", max: n.max, packHex: n.packHex };
      case "ref":
        return { kind: "ref", table: n.table, packHex: n.packHex };
      case "bytes":
        return { kind: "bytes", length: n.length };
      case "hex":
        return { kind: "hex", bytes: n.bytes };
      case "array":
        return { kind: "array", of: walk(n.of), length: n.length, max: n.max };
      case "optional":
      case "nullable":
      case "runs":
      case "rec":
        return { kind: n.kind, of: walk(n.of) };
      case "default": {
        let value;
        try {
          value = encodeRaw(n.of, n.value);
        } catch (e) {
          throw new SchemaError(`A default can't be written as data: ${e.message}`);
        }
        return { kind: "default", of: walk(n.of), value };
      }
      case "struct":
        return { kind: "struct", fields: fl(n.fields), open: n.open, ext: n.ext.map((g) => fl(g)) };
      case "tuple":
        return { kind: "tuple", items: n.items.map((x) => walk(x)) };
      case "union":
        return { kind: "union", tag: n.tag, variants: fl(n.variants), capacity: n.capacity };
      case "alt":
        return { kind: "alt", of: n.of.map((x) => walk(x)) };
      case "map":
        return { kind: "map", key: walk(n.key), value: walk(n.value), order: n.order };
      case "delta":
        return { kind: "delta", of: walk(n.of), k: n.k };
      case "const":
        return { kind: "const", value: n.value };
      case "named":
        return { kind: "named", name: n.name, version: n.version, doc: docs ? n.doc : "", of: walk(n.of) };
      case "self":
        return { kind: "self", depth: n.depth };
      case "lz":
        return { kind: "lz", of: walk(n.of), min: n.min };
      case "grow":
        return { kind: "grow", base: walk(n.base), of: walk(n.of) };
    }
  };
  return walk(type);
}
var encodeSchema = (type, opts = {}) => encodeRaw(SCHEMA_SCHEMA, toRecord(type, opts));
var IDS = new WeakMap;
function schemaId(type) {
  const have = IDS.get(type);
  if (have)
    return have;
  const id = toHex(sha256(encodeSchema(type, { docs: false })));
  IDS.set(type, id);
  return id;
}
function schemaName(type) {
  const n = type;
  return n.kind === "named" ? { name: n.name, version: n.version, doc: n.doc } : null;
}
// packages/codec/src/document.ts
function createRegistry() {
  const byId = new Map;
  const byKey = new Map;
  const reg = {
    register(schema, alias) {
      const id = schemaId(schema);
      const named2 = schemaName(schema);
      const have = byId.get(id);
      const aliases = new Set(have?.aliases ?? []);
      if (alias) {
        const other = byKey.get(alias);
        if (other && other.id !== id)
          throw new RangeError(`The name ${alias} is already schema ${other.short}.`);
        aliases.add(alias);
      }
      const entry = { id, short: id.slice(0, 8), schema: have?.schema ?? schema, name: named2?.name ?? null, version: named2?.version ?? null, aliases: [...aliases] };
      const clash = byKey.get(entry.short);
      if (clash && clash.id !== id)
        throw new RangeError(`Two schemas share the short id ${entry.short} (${clash.id} and ${id}): a header can't tell them apart.`);
      byId.set(id, entry);
      for (const k of [id, entry.short, ...aliases, ...named2 ? [`${named2.name}@${named2.version}`] : []])
        byKey.set(k, entry);
      return id;
    },
    get: (key) => byKey.get(key),
    has: (key) => byKey.has(key),
    list: () => [...byId.values()]
  };
  return reg;
}
var defaultRegistry = createRegistry();
// packages/codec/src/schemas/common.ts
var coord = fixed(-8192, 8192, 0.001);
var local = fixed(-8192, 8192, 0.001, { k: 10 });
var localDelta = fixed(-8192, 8192, 0.001, { k: 9, delta: true });
var size = fixed(0, 1024, 0.001, { k: 9 });
var sizeDelta = fixed(0, 1024, 0.001, { k: 9, delta: true });
var yaw = fixed(-Math.PI, Math.PI, Math.PI / 32768);
var unit = fixed(0, 1, 1 / 1024);
var signed = fixed(-1, 1, 0.001);
var vec3 = tuple([coord, coord, coord]);
var lvec3 = tuple([local, local, local]);
var dvec3 = tuple([localDelta, localDelta, localDelta]);
var dhalf3 = tuple([sizeDelta, sizeDelta, sizeDelta]);
var half3 = tuple([size, size, size]);
var dir3 = tuple([signed, signed, signed]);
var seedText = ref("str", { packHex: true });
var seedAny = alt([num(), seedText]);
var oklch = tuple([fixed(0, 1, 0.001, { off: "exact" }), fixed(0, 0.5, 0.001, { off: "exact" }), fixed(0, 360, 0.01, { off: "exact" })]);
var id = ref("ids");
var count8 = uint(8);

// packages/codec/src/schemas/audio.ts
var MODE_NAMES = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "harmonic"];
var KEYS_NAMES = ["rhodes", "wurli", "piano", "felt", "vibes", "organ", "guitar"];
var LEAD_NAMES = ["rhodes", "piano", "celesta", "kalimba", "musicbox", "vibes", "guitar", "chip"];
var BASS_NAMES = ["sub", "upright", "electric", "synth"];
var KIT_NAMES = ["dusty", "boombap", "brushed", "soft", "rim", "chip"];
var WEATHER_KINDS = ["rain", "waves", "traffic", "wind", "hush", "crickets", "car", "chimes", "shimmer"];
var ROOM_KINDS = ["vinyl", "crackle", "fan", "hum"];
var SECTIONS = ["A", "B", "A2", "C", "T"];
var COMPS = ["strum", "arp", "stabs", "sustain", "push"];
var BASS_STYLES = ["root", "rootfifth", "walk", "sync"];
var SPREADS = ["close", "open", "drop2"];
var BACKBEATS = ["snare", "rim", "clap", "both"];
var SFX_NAMES = ["step", "jump", "land", "wallStart", "wallJump", "railStart", "railEnd", "splash", "skimStart", "respawn", "blip", "select", "back", "confirm", "error", "hover"];
var LOOP_NAMES = ["grind", "wallrun", "skim", "wind"];
var STYLE_NAMES = ["lofi", "clean", "chip", "soft"];
var SURFACES = ["stone", "metal", "water"];
var ex = (min, max, step) => fixed(min, max, step, { off: "exact" });
var share = ex(0, 1, 0.001);
var name = ref("audio");
var Weighted = array(tuple([name, ex(0, 1000, 0.001)]), { max: 31 });
var BAND_INPUT = struct({
  keys: optional(Weighted),
  lead: optional(Weighted),
  bass: optional(Weighted),
  feel: optional(Weighted),
  tempo: optional(tuple([ex(0, 400, 0.001), ex(0, 400, 0.001)])),
  swing: optional(tuple([share, share])),
  room: optional(share),
  jazz: optional(share),
  vox: optional(share),
  scratch: optional(share),
  bright: optional(share),
  worn: optional(share),
  mode: optional(enumOf(MODE_NAMES, { capacity: 8, other: true })),
  lean: optional(enumOf(["major"], { capacity: 2, other: true }))
});
var MUSIC_PINS = struct({
  band: optional(name),
  keys: optional(name),
  lead: optional(name),
  bass: optional(name),
  kit: optional(name),
  mode: optional(name),
  key: optional(alt([name, num()])),
  tempo: optional(alt([name, num()]))
});
var BandRef = struct({ preset: optional(name), kit: optional(name), over: optional(BAND_INPUT) });
var MOOD = struct({
  seed: optional(seedAny),
  name: optional(name),
  band: optional(alt([name, BandRef])),
  hue: optional(ex(0, 360, 0.01)),
  mode: optional(name),
  eclipse: optional(bool()),
  picture: optional(ex(0, 3600, 0.001)),
  view: optional(name),
  weather: optional(array(enumOf(WEATHER_KINDS, { capacity: 16, other: true }), { max: 15 })),
  room: optional(array(enumOf(ROOM_KINDS, { capacity: 8, other: true }), { max: 15 })),
  dark: optional(share),
  space: optional(share),
  energy: optional(share),
  pins: optional(MUSIC_PINS)
}, { open: true });
var MOOD_SPEC = struct({
  energy: optional(share),
  darkness: optional(share),
  weather: optional(alt([name, array(name)])),
  tempo: optional(alt([num(), tuple([num(), num()])])),
  hue: optional(ex(0, 360, 0.01)),
  name: optional(name),
  room: optional(array(name)),
  space: optional(share),
  pins: optional(MUSIC_PINS)
}, { open: true });
var MUSIC_RECIPE = named("keel/audio/recipe", union("from", {
  mood: struct({ seed: optional(seedAny), mood: MOOD, pins: optional(MUSIC_PINS) }),
  game: struct({ seed: optional(seedAny), spec: MOOD_SPEC, pins: optional(MUSIC_PINS) })
}, { capacity: 8 }), { doc: "Music as its recipe: a seed and a mood; the plan comes back from scoreOf exactly." });
var Steps = alt([uint(16), array(uint(4), { max: 31 })]);
var Chord = union("q", {
  deg: struct({ d: uint(3) }),
  dom: struct({ root: uint(4) }),
  iv: struct({}),
  raw: struct({ root: int(8), tones: array(int(8), { max: 15 }), deg: int(8) })
}, { capacity: 4 });
var SectionName = enumOf(SECTIONS, { capacity: 8, other: true });
var SONG = named("keel/audio/song", struct({
  seed: string(),
  theme: name,
  view: name,
  eclipse: bool(),
  mode: enumOf(MODE_NAMES, { capacity: 8, other: true }),
  family: enumOf(["major", "minor"]),
  tonic: uint(4),
  bpm: ex(0, 400, 0.001),
  barSec: optional(float64()),
  swing: share,
  jazz: share,
  keys: enumOf(KEYS_NAMES, { capacity: 16, other: true }),
  lead: enumOf(LEAD_NAMES, { capacity: 16, other: true }),
  bass: enumOf(BASS_NAMES, { capacity: 8, other: true }),
  kit: enumOf(KIT_NAMES, { capacity: 8, other: true }),
  vox: share,
  scratch: share,
  form: array(tuple([SectionName, uint(6)]), { max: 15 }),
  picture: nullable(ex(0, 3600, 0.001)),
  comp: enumOf(COMPS, { capacity: 8, other: true }),
  bassStyle: enumOf(BASS_STYLES, { capacity: 8, other: true }),
  groove: struct({ kick: Steps, back: Steps, hat: Steps, ghost: Steps, open: Steps, shaker: Steps }),
  design: struct({
    seed: uint(32),
    bright: share,
    bell: ex(0, 20, 0.001),
    kickHz: ex(0, 200, 0.01),
    kickDecay: share,
    punch: share,
    snareBody: ex(0, 1000, 0.01),
    snareTone: ex(0, 1e4, 0.1),
    snareDecay: share,
    hatTone: ex(0, 4, 0.001),
    bits: uint(5),
    hold: uint(3),
    top: ex(0, 30000, 1),
    pump: share,
    strum: share,
    spread: enumOf(SPREADS, { capacity: 4, other: true }),
    back: enumOf(BACKBEATS, { capacity: 4, other: true })
  }),
  bars: union("as", {
    sections: struct({ chords: map(SectionName, array(Chord, { max: 63 }), { order: "kept" }) }),
    list: struct({ bars: array(struct({ sec: SectionName, k: uint(6), of: uint(6), chord: Chord })) })
  }),
  motif: struct({ rhythm: delta(uint(6)), moves: array(int(5)), lengths: optional(array(uint(6))) }),
  weather: array(enumOf(WEATHER_KINDS, { capacity: 16, other: true }), { max: 15 }),
  room: array(enumOf(ROOM_KINDS, { capacity: 8, other: true }), { max: 15 }),
  mix: struct({ cutoff: ex(0, 30000, 1), tape: share, reverb: share, wow: share, level: ex(-60, 12, 0.5) }),
  energy: optional(share)
}, { open: true }), { doc: "A music plan, packed: sections of chords, the tune delta-coded, drums as step masks." });
var SoundName = enumOf([...SFX_NAMES, ...LOOP_NAMES], { capacity: 32, other: true });
var SFX_STYLE = alt([
  enumOf(STYLE_NAMES, { capacity: 8, other: true }),
  struct({
    name: optional(name),
    pitch: optional(ex(0, 4, 0.001)),
    bright: optional(share),
    weight: optional(share),
    bits: optional(uint(5)),
    hold: optional(uint(3)),
    top: optional(ex(0, 30000, 1)),
    shoe: optional(enumOf(["sneaker", "boot", "soft"], { capacity: 4, other: true })),
    metal: optional(array(ex(0, 32, 0.001), { max: 15 })),
    metalHz: optional(ex(0, 5000, 0.01)),
    water: optional(ex(0, 4, 0.001)),
    wind: optional(ex(0, 4, 0.001)),
    tonic: optional(uint(4)),
    wave: optional(enumOf(["sine", "triangle", "square"], { capacity: 4, other: true })),
    room: optional(share),
    seed: optional(uint(32))
  })
]);
var SFX_SETTINGS = named("keel/audio/sfx", struct({
  seed: seedAny,
  style: withDefault(SFX_STYLE, "lofi"),
  volume: withDefault(share, 0.8),
  body: optional(struct({
    wind: withDefault(bool(), true),
    gain: withDefault(ex(0, 4, 0.01), 1),
    surfaces: withDefault(map(ref("mats"), enumOf(SURFACES, { capacity: 4, other: true })), {}),
    events: withDefault(map(ref("events"), SoundName), {})
  })),
  sounds: withDefault(map(SoundName, struct({
    gain: optional(ex(0, 2, 0.01)),
    rate: optional(ex(0.25, 4, 0.01)),
    pan: optional(ex(-1, 1, 0.01)),
    jitter: optional(share)
  })), {})
}, { open: true }), { doc: "A project's sound palette and how its sounds are played." });

// packages/audio/src/sfx.ts
var TAU2 = Math.PI * 2;
var STYLES = {
  lofi: { bright: 0.45, bits: 11, hold: 2, top: 7000, wave: "triangle", room: 0.25 },
  clean: { bright: 0.6, bits: 16, hold: 1, top: 14000, wave: "sine", room: 0.12 },
  chip: { bright: 0.7, bits: 6, hold: 3, top: 9000, wave: "square", room: 0.05 },
  soft: { bright: 0.3, bits: 12, hold: 2, top: 4500, wave: "sine", room: 0.35 }
};
var STYLE_NAMES2 = Object.keys(STYLES);
var JITTERED = new Set(["step", "land", "jump"]);
// packages/audio/src/synth.ts
var TAU3 = Math.PI * 2;

// packages/audio/src/voice.ts
var ALERT_KINDS = ["underAttack", "noResources", "supplyBlocked", "buildingComplete", "researchComplete", "unitReady", "idleWorker", "fieldDepleted"];
var BARK_KINDS = ["select", "move", "attack", "death", "annoyed"];
var STING_KINDS = ["complete", "ready"];

// packages/audio/src/battle.ts
var DAMAGE_CLASSES = ["kinetic", "piercing", "blast", "energy", "siege", "acid"];
var DEATH_MATERIALS = ["metal", "organic", "crystal"];
var BUILD_FLAVOURS = ["machine", "organic", "energy"];
var EXPLOSION_SIZES = ["small", "big"];
var BATTLE_SOUNDS = [
  ...DAMAGE_CLASSES.map((d) => `fire.${d}`),
  ...DAMAGE_CLASSES.map((d) => `hit.${d}`),
  ...EXPLOSION_SIZES.map((s) => `explode.${s}`),
  ...DEATH_MATERIALS.map((m) => `death.${m}`),
  ...STING_KINDS.map((s) => `sting.${s}`),
  ...ALERT_KINDS.map((a) => `alert.${a}`),
  ...BARK_KINDS.map((b) => `bark.${b}`)
];
var BATTLE_LOOPS = BUILD_FLAVOURS.map((f) => `build.${f}`);
var KNOWN = new Set([...BATTLE_SOUNDS, ...BATTLE_LOOPS]);
// packages/audio/src/car.ts
var CAR_MATERIALS = ["metal", "concrete", "glass", "wood", "plastic", "rubber", "foliage", "brick", "water", "snow"];
var CAR_UI = ["move", "confirm", "back", "deny", "cash", "tab", "search", "found", "click", "digitize", "win"];
var CAR_LOOPS = ["engine.4", "engine.6", "engine.8", "engine.12", "engine.rotary", "engine.electric", "tyre.squeal", "tyre.drift", "tyre.brake", "brake.pads", "brake.gravel", "road.asphalt", "road.gravel", "road.grass", "road.wet", "road.snow", "fire.roar", "wind", "turbo", "nos", "fire", "rain", "machine"];
var CAR_SHOTS = [
  ...CAR_UI.map((n) => `ui.${n}`),
  ...CAR_MATERIALS.map((n) => `hit.${n}`),
  "glass.crack",
  "glass.shatter",
  "metal.scrape",
  "tyre.pop",
  "panel.drop",
  "pole.ring",
  "fire.start",
  "engine.start",
  "engine.stop",
  "engine.backfire",
  "engine.redline",
  "shift.up",
  "shift.down",
  "turbo.release",
  "nos.start",
  "nos.end",
  "land",
  "splash",
  "debris.brick",
  "debris.wood",
  "debris",
  "rustle",
  "horn",
  "reverse",
  "countdown",
  "go",
  "checkpoint",
  "finish",
  "crush",
  "hydraulic",
  "door",
  "repair"
];
var CAR_SOUNDS = [...CAR_SHOTS, ...CAR_LOOPS];
// packages/audio/src/pinball-music.ts
var common = { chordShape: "sine", chordGain: 0.035, leadEvery: 1, leadOffset: 0, bassEvery: 4, leadBeats: 0.55, kick: [0, 8], snare: [4, 12], hat: [1, 3, 5, 7, 9, 11, 13, 15], partials: [{ interval: 0, gain: 1 }], air: 0, airHz: 750 };
var PINBALL_MUSIC_BLUEPRINTS = {
  cyberpunk: { ...common, id: "cyberpunk", bpm: 124, root: 42, scale: [0, 2, 3, 5, 7, 10], shape: "saw", wear: "clean", bass: 0.15, lead: 0.075, drum: 0.4, bassEvery: 2 },
  vaporwave: { ...common, id: "vaporwave", bpm: 88, root: 45, scale: [0, 2, 4, 5, 7, 9, 11], shape: "tri", wear: "lofi", bass: 0.12, lead: 0.055, drum: 0.22, chordShape: "tri", chordGain: 0.075, leadEvery: 4, leadOffset: 2 },
  gold: { ...common, id: "gold", bpm: 100, root: 50, scale: [0, 2, 3, 5, 7, 8, 11], shape: "sine", wear: "clean", bass: 0.08, lead: 0.1, drum: 0.2, leadEvery: 2, leadBeats: 1.2, partials: [{ interval: 0, gain: 1 }, { interval: 19, gain: 0.28 }] },
  nature: { ...common, id: "nature", bpm: 76, root: 50, scale: [0, 2, 4, 7, 9], shape: "sine", wear: "soft", bass: 0.045, lead: 0.055, drum: 0.08, leadEvery: 4, leadOffset: 1, hat: [], air: 1 },
  crypto: { ...common, id: "crypto", bpm: 138, root: 40, scale: [0, 1, 3, 5, 7, 8, 10], shape: "pulse", wear: "chip", bass: 0.14, lead: 0.065, drum: 0.34, bassEvery: 2, kick: [0, 6, 8, 14] }
};
var freeze2 = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value))
      freeze2(child);
    Object.freeze(value);
  }
  return value;
};
freeze2(PINBALL_MUSIC_BLUEPRINTS);
// packages/core/src/dmath.ts
var F64 = new Float64Array(1);
var U32 = new Uint32Array(F64.buffer);
F64[0] = 1;
var HI = U32[1] === 1072693248 ? 1 : 0;
var LO = 1 - HI;
var hiWord = (x) => {
  F64[0] = x;
  return U32[HI] | 0;
};
var loWord = (x) => {
  F64[0] = x;
  return U32[LO];
};
var fromWords = (hi, lo) => {
  U32[HI] = hi;
  U32[LO] = lo;
  return F64[0];
};
var withHi = (x, hi) => {
  F64[0] = x;
  U32[HI] = hi;
  return F64[0];
};
var copysign = (x, y) => withHi(x, hiWord(x) & 2147483647 | hiWord(y) & 2147483648);
var TWO54 = 18014398509481984;
var TWOM54 = 0.00000000000000005551115123125783;
var HUGE = 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000;
var TINY = 0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001;
function dscalbn(x, n) {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = (hx & 2146435072) >> 20;
  if (k === 0) {
    if ((lx | hx & 2147483647) === 0)
      return x;
    x *= TWO54;
    hx = hiWord(x);
    k = ((hx & 2146435072) >> 20) - 54;
  }
  if (k === 2047)
    return x + x;
  k = k + n;
  if (k > 2046)
    return HUGE * copysign(HUGE, x);
  if (n < -50000)
    return TINY * copysign(TINY, x);
  if (k > 0)
    return withHi(x, hx & 2148532223 | k << 20);
  if (k <= -54) {
    if (n > 50000)
      return HUGE * copysign(HUGE, x);
    return TINY * copysign(TINY, x);
  }
  k += 54;
  return withHi(x, hx & 2148532223 | k << 20) * TWOM54;
}
var S1 = -0.16666666666666632;
var S2 = 0.00833333333332249;
var S3 = -0.0001984126982985795;
var S4 = 0.0000027557313707070068;
var S5 = -0.000000025050760253406863;
var S6 = 0.000000000158969099521155;
function kSin(x, y, iy) {
  const ix = hiWord(x) & 2147483647;
  if (ix < 1044381696)
    return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0)
    return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}
var C1 = 0.0416666666666666;
var C2 = -0.001388888888887411;
var C3 = 0.00002480158728947673;
var C4 = -0.00000027557314351390663;
var C5 = 0.000000002087572321298175;
var C6 = -0.000000000011359647557788195;
function kCos(x, y) {
  const ix = hiWord(x) & 2147483647;
  if (ix < 1044381696)
    return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 1070805811)
    return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 1072234496 ? 0.28125 : fromWords(ix - 2097152, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}
var TWO_OVER_PI = [
  10680707,
  7228996,
  1387004,
  2578385,
  16069853,
  12639074,
  9804092,
  4427841,
  16666979,
  11263675,
  12935607,
  2387514,
  4345298,
  14681673,
  3074569,
  13734428,
  16653803,
  1880361,
  10960616,
  8533493,
  3062596,
  8710556,
  7349940,
  6258241,
  3772886,
  3769171,
  3798172,
  8675211,
  12450088,
  3874808,
  9961438,
  366607,
  15675153,
  9132554,
  7151469,
  3571407,
  2607881,
  12013382,
  4155038,
  6285869,
  7677882,
  13102053,
  15825725,
  473591,
  9065106,
  15363067,
  6271263,
  9264392,
  5636912,
  4652155,
  7056368,
  13614112,
  10155062,
  1944035,
  9527646,
  15080200,
  6658437,
  6231200,
  6832269,
  16767104,
  5075751,
  3212806,
  1398474,
  7579849,
  6349435,
  12618859
];
var NPIO2_HW = [
  1073291771,
  1074340347,
  1074977148,
  1075388923,
  1075800698,
  1076025724,
  1076231611,
  1076437499,
  1076643386,
  1076849274,
  1076971356,
  1077074300,
  1077177244,
  1077280187,
  1077383131,
  1077486075,
  1077589019,
  1077691962,
  1077794906,
  1077897850,
  1077968460,
  1078019932,
  1078071404,
  1078122876,
  1078174348,
  1078225820,
  1078277292,
  1078328763,
  1078380235,
  1078431707,
  1078483179,
  1078534651
];
var TWO24 = 16777216;
var TWON24 = 0.00000005960464477539063;
var INVPIO2 = 0.6366197723675814;
var PIO2_1 = 1.5707963267341256;
var PIO2_1T = 0.00000000006077100506506192;
var PIO2_2 = 0.00000000006077100506303966;
var PIO2_2T = 0.0000000000000000000020222662487959506;
var PIO2_3 = 0.0000000000000000000020222662487111665;
var PIO2_3T = 0.000000000000000000000000000000084784276603689;
var PIO2 = [
  1.570796251296997,
  0.00000007549789415861596,
  0.000000000000005390302529957765,
  0.0000000000000000000003282003415807913,
  0.00000000000000000000000000001270655753080676,
  0.0000000000000000000000000000000000012293330898111133,
  0.000000000000000000000000000000000000000000027337005381646456,
  0.0000000000000000000000000000000000000000000000000021674168387780482
];
var Y = [0, 0];
function kRemPio2(x, e0, nx) {
  if (nx < 1)
    return 0;
  const jk = 4;
  const jp = jk;
  const f = new Array(20).fill(0);
  const fq = new Array(20).fill(0);
  const q2 = new Array(20).fill(0);
  const iq = new Array(20).fill(0);
  const jx = nx - 1;
  let jv = Math.trunc((e0 - 3) / 24);
  if (jv < 0)
    jv = 0;
  let q0 = e0 - 24 * (jv + 1);
  let j = jv - jx;
  const m = jx + jk;
  for (let i = 0;i <= m; i += 1, j += 1)
    f[i] = j < 0 ? 0 : TWO_OVER_PI[j];
  for (let i = 0;i <= jk; i += 1) {
    let fw2 = 0;
    for (j = 0;j <= jx; j += 1)
      fw2 += x[j] * f[jx + i - j];
    q2[i] = fw2;
  }
  let jz = jk;
  let z;
  let n;
  let ih;
  for (;; ) {
    let i = 0;
    z = q2[jz];
    for (j = jz;j > 0; i += 1, j -= 1) {
      const fw2 = TWON24 * z | 0;
      iq[i] = z - TWO24 * fw2 | 0;
      z = q2[j - 1] + fw2;
    }
    for (let k = jz;k < 20; k += 1)
      iq[k] = 0;
    z = dscalbn(z, q0);
    z -= 8 * Math.floor(z * 0.125);
    n = z | 0;
    z -= n;
    ih = 0;
    if (q0 > 0) {
      i = iq[jz - 1] >> 24 - q0;
      n += i;
      iq[jz - 1] = iq[jz - 1] - (i << 24 - q0);
      ih = iq[jz - 1] >> 23 - q0;
    } else if (q0 === 0)
      ih = iq[jz - 1] >> 23;
    else if (z >= 0.5)
      ih = 2;
    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (i = 0;i < jz; i += 1) {
        const v = iq[i];
        if (carry === 0) {
          if (v !== 0) {
            carry = 1;
            iq[i] = 16777216 - v;
          }
        } else
          iq[i] = 16777215 - v;
      }
      if (q0 > 0) {
        if (q0 === 1)
          iq[jz - 1] = iq[jz - 1] & 8388607;
        else if (q0 === 2)
          iq[jz - 1] = iq[jz - 1] & 4194303;
      }
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0)
          z -= dscalbn(1, q0);
      }
    }
    if (z === 0) {
      j = 0;
      for (i = jz - 1;i >= jk; i -= 1)
        j |= iq[i];
      if (j === 0) {
        let k = 1;
        while (iq[jk - k] === 0)
          k += 1;
        for (i = jz + 1;i <= jz + k; i += 1) {
          f[jx + i] = TWO_OVER_PI[jv + i];
          let fw2 = 0;
          for (j = 0;j <= jx; j += 1)
            fw2 += x[j] * f[jx + i - j];
          q2[i] = fw2;
        }
        jz += k;
        continue;
      }
    }
    break;
  }
  if (z === 0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] === 0) {
      jz -= 1;
      q0 -= 24;
    }
  } else {
    z = dscalbn(z, -q0);
    if (z >= TWO24) {
      const fw2 = TWON24 * z | 0;
      iq[jz] = z - TWO24 * fw2 | 0;
      jz += 1;
      q0 += 24;
      iq[jz] = fw2;
    } else
      iq[jz] = z | 0;
  }
  let fw = dscalbn(1, q0);
  for (let i = jz;i >= 0; i -= 1) {
    q2[i] = fw * iq[i];
    fw *= TWON24;
  }
  for (let i = jz;i >= 0; i -= 1) {
    fw = 0;
    for (let k = 0;k <= jp && k <= jz - i; k += 1)
      fw += PIO2[k] * q2[i + k];
    fq[jz - i] = fw;
  }
  fw = 0;
  for (let i = jz;i >= 0; i -= 1)
    fw += fq[i];
  Y[0] = ih === 0 ? fw : -fw;
  fw = fq[0] - fw;
  for (let i = 1;i <= jz; i += 1)
    fw += fq[i];
  Y[1] = ih === 0 ? fw : -fw;
  return n & 7;
}
function remPio2(x) {
  const hx = hiWord(x);
  const ix = hx & 2147483647;
  if (ix <= 1072243195) {
    Y[0] = x;
    Y[1] = 0;
    return 0;
  }
  if (ix < 1073928572) {
    if (hx > 0) {
      let z3 = x - PIO2_1;
      if (ix !== 1073291771) {
        Y[0] = z3 - PIO2_1T;
        Y[1] = z3 - Y[0] - PIO2_1T;
      } else {
        z3 -= PIO2_2;
        Y[0] = z3 - PIO2_2T;
        Y[1] = z3 - Y[0] - PIO2_2T;
      }
      return 1;
    }
    let z2 = x + PIO2_1;
    if (ix !== 1073291771) {
      Y[0] = z2 + PIO2_1T;
      Y[1] = z2 - Y[0] + PIO2_1T;
    } else {
      z2 += PIO2_2;
      Y[0] = z2 + PIO2_2T;
      Y[1] = z2 - Y[0] + PIO2_2T;
    }
    return -1;
  }
  if (ix <= 1094263291) {
    let t = Math.abs(x);
    const n2 = t * INVPIO2 + 0.5 | 0;
    const fn = n2;
    let r = t - fn * PIO2_1;
    let w = fn * PIO2_1T;
    if (n2 < 32 && ix !== NPIO2_HW[n2 - 1]) {
      Y[0] = r - w;
    } else {
      const j = ix >> 20;
      Y[0] = r - w;
      let i = j - (hiWord(Y[0]) >> 20 & 2047);
      if (i > 16) {
        t = r;
        w = fn * PIO2_2;
        r = t - w;
        w = fn * PIO2_2T - (t - r - w);
        Y[0] = r - w;
        i = j - (hiWord(Y[0]) >> 20 & 2047);
        if (i > 49) {
          t = r;
          w = fn * PIO2_3;
          r = t - w;
          w = fn * PIO2_3T - (t - r - w);
          Y[0] = r - w;
        }
      }
    }
    Y[1] = r - Y[0] - w;
    if (hx < 0) {
      Y[0] = -Y[0];
      Y[1] = -Y[1];
      return -n2;
    }
    return n2;
  }
  if (ix >= 2146435072) {
    Y[0] = Y[1] = x - x;
    return 0;
  }
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), loWord(x));
  const tx = [0, 0, 0];
  for (let i = 0;i < 2; i += 1) {
    tx[i] = z | 0;
    z = (z - tx[i]) * TWO24;
  }
  tx[2] = z;
  let nx = 3;
  while (nx > 0 && tx[nx - 1] === 0)
    nx -= 1;
  const n = kRemPio2(tx, e0, nx);
  if (hx < 0) {
    Y[0] = -Y[0];
    Y[1] = -Y[1];
    return -n;
  }
  return n;
}
function dsin(x) {
  const ix = hiWord(x) & 2147483647;
  if (ix <= 1072243195)
    return kSin(x, 0, 0);
  if (ix >= 2146435072)
    return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kSin(Y[0], Y[1], 1);
    case 1:
      return kCos(Y[0], Y[1]);
    case 2:
      return -kSin(Y[0], Y[1], 1);
    default:
      return -kCos(Y[0], Y[1]);
  }
}
function dcos(x) {
  const ix = hiWord(x) & 2147483647;
  if (ix <= 1072243195)
    return kCos(x, 0);
  if (ix >= 2146435072)
    return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kCos(Y[0], Y[1]);
    case 1:
      return -kSin(Y[0], Y[1], 1);
    case 2:
      return -kCos(Y[0], Y[1]);
    default:
      return kSin(Y[0], Y[1], 1);
  }
}

// packages/core/src/frame.ts
var FRONT = Object.freeze([0, 0, 1]);
var RIGHT = Object.freeze([1, 0, 0]);
var UP = Object.freeze([0, 1, 0]);
// packages/core/src/math.ts
var TAU4 = Math.PI * 2;
var fract = (v) => v - Math.floor(v);
var tri = (v) => 1 - Math.abs(2 * fract(v) - 1);
// packages/core/src/curl.ts
var FLOW_PERIOD = 4096;
var FLOW_SPEED = 0.35;
var FLOW_R = FLOW_PERIOD * FLOW_SPEED / (2 * Math.PI);
var W = new Float64Array(8);
var IO = new Float64Array(7);
var CURL_GLSL = `
float curlLat(ivec3 i, uint s) {
  uint h = (uint(i.x) * 0x8da6b343u) ^ (uint(i.y) * 0xd8163841u) ^ (uint(i.z) * 0xcb1ab31fu) ^ s;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h) / 2147483647.5 - 1.0;
}
vec3 curlGrad(vec3 x, uint s) {
  vec3 fi = floor(x); ivec3 i = ivec3(fi); vec3 f = x - fi;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = curlLat(i, s), b = curlLat(i + ivec3(1, 0, 0), s), c = curlLat(i + ivec3(0, 1, 0), s), d = curlLat(i + ivec3(1, 1, 0), s);
  float e = curlLat(i + ivec3(0, 0, 1), s), ff = curlLat(i + ivec3(1, 0, 1), s), g = curlLat(i + ivec3(0, 1, 1), s), h = curlLat(i + ivec3(1, 1, 1), s);
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + ff, k7 = -a + b + c - d + e - ff - g + h;
  return du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
}
vec3 curlNoiseN(vec3 p, float t, int octaves) {
  float th = t / ${FLOW_PERIOD.toFixed(1)} * 6.283185307;
  p += vec3(${FLOW_R.toFixed(4)} * cos(th), 0.0, ${FLOW_R.toFixed(4)} * sin(th));
  vec3 a = vec3(0.0), b = vec3(0.0);
  float f = 1.0, w = 1.0;
  for (int k = 0; k < 2; k++) {
    if (k >= octaves) break;
    a += curlGrad(p * f, 0x2545f491u + uint(k)) * f * w;
    b += curlGrad(p * f + vec3(31.4, 17.7, 5.9), 0x68e31da4u + uint(k)) * f * w;
    f *= 2.03; w *= 0.5;
  }
  return cross(a, b) * 0.25;
}
vec3 curlNoise(vec3 p, float t) { return curlNoiseN(p, t, 2); }`;
// packages/core/src/palette.ts
var CMAX = new Map;
function ramp(S, hues, extra = {}) {
  return {
    hues,
    chroma: S.between(0.11, 0.19),
    lift: S.between(0.04, 0.09),
    top: S.between(0.94, 0.985),
    gamma: S.between(1, 1.35),
    shift: S.between(6, 20),
    ...extra
  };
}
var accentRamp = (S, hue, extra = {}) => ({
  hues: [hue - 6, hue + 6],
  chroma: S.between(0.15, 0.23),
  lift: 0.32,
  top: 0.96,
  gamma: 0.9,
  shift: 4,
  ...extra
});
var SCHEMES = [
  ["Monochrome", 3, (S, h) => ({
    key: ramp(S, [h - 4, h + 4]),
    accent: accentRamp(S, h + S.between(-10, 10), { chroma: S.between(0.18, 0.25) })
  })],
  ["Nocturne", 9, (S, h) => ({
    key: ramp(S, [h - 9, h + 9]),
    accent: accentRamp(S, h + 180 + S.between(-35, 35))
  })],
  ["Duotone", 5, (S, h) => {
    const d = S.pick([-1, 1]) * S.between(45, 85);
    return { key: ramp(S, [h - d / 2, h + d / 2]), accent: accentRamp(S, h + 180 + S.between(-25, 25)) };
  }],
  ["Split", 3, (S, h) => ({
    key: ramp(S, [h - 12, h + 12]),
    accent: accentRamp(S, h + S.pick([-1, 1]) * S.between(125, 155))
  })],
  ["Triad", 3, (S, h) => {
    const dir = S.pick([-1, 1]);
    return { key: ramp(S, [h, h + dir * 120]), accent: accentRamp(S, h - dir * 120 + S.between(-15, 15)) };
  }],
  ["Two Worlds", 7.5, (S, h) => {
    const inside2 = h + 180 + S.between(-40, 40);
    return {
      outside: ramp(S, [h - 10, h + 10], { chroma: S.between(0.12, 0.2), top: 0.9 }),
      key: ramp(S, [inside2 - 12, inside2 + 12]),
      accent: accentRamp(S, inside2 + S.pick([-1, 1]) * S.between(25, 60))
    };
  }],
  ["Neon Noir", 2, (S, h) => ({
    key: ramp(S, [h - 5, h + 5], { chroma: S.between(0.025, 0.05), shift: 4 }),
    accent: accentRamp(S, h + S.pick([0, 150, 180, 210]), { chroma: 0.3, lift: 0.4 })
  })],
  ["Spectrum", 1.5, (S, h) => {
    const span = S.pick([-1, 1]) * S.between(150, 220);
    return {
      key: ramp(S, [h, h + span / 3, h + span * 2 / 3, h + span], { chroma: S.between(0.13, 0.18) }),
      accent: accentRamp(S, h + span / 2 + 180)
    };
  }],
  ["Prism", 0.6, (S, h) => ({
    key: ramp(S, [h, h + 90, h + 180, h + 270, h + 360], { chroma: S.between(0.13, 0.17), shift: 0 }),
    accent: accentRamp(S, h + 45, { chroma: 0.12 })
  })]
];
var SCHEME_NAMES = SCHEMES.map(([n]) => n);
// packages/core/src/look.ts
var DRAWS = new Float64Array(16);
var WEIGHTS = [1, 0.8, 0.5];
var W_NORM = Math.sqrt(WEIGHTS.reduce((a, b) => a + b, 0));
var VECTORS = new WeakMap;
// packages/core/src/dither.ts
var BAYER2 = [0, 2, 3, 1];
var BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
var BAYER8 = (() => {
  const out = new Array(64);
  for (let y = 0;y < 8; y += 1) {
    for (let x = 0;x < 8; x += 1) {
      const q2 = BAYER4[(y & 3) * 4 + (x & 3)];
      const b = BAYER2[(y >> 2) * 2 + (x >> 2)];
      out[y * 8 + x] = q2 * 4 + b;
    }
  }
  return out;
})();
var b2 = (i) => BAYER2[i];
var b4 = (i) => BAYER4[i];
var b8 = (i) => BAYER8[i];
function equalize(shape, w, h, tie = (x, y) => b8((y & 7) * 8 + (x & 7))) {
  const cells = [];
  for (let y = 0;y < h; y += 1)
    for (let x = 0;x < w; x += 1)
      cells.push([Math.round(shape(x, y) * 1e6), tie(x, y), y * w + x]);
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const table = new Float32Array(w * h);
  cells.forEach(([, , k], rank) => {
    table[k] = (rank + 0.5) / cells.length;
  });
  return (x, y) => table[(y % h + h) % h * w + (x % w + w) % w];
}
var ALONG = [0, 4, 2, 6, 1, 5, 3, 7];
var along = (x) => ALONG[x & 7];
function dotScreen([ax, ay], [bx, by], w, h) {
  const det = ax * by - ay * bx;
  const coords = (x, y) => [(x * by - y * bx) / det, (y * ax - x * ay) / det];
  const shape = (x, y) => {
    const [u, v] = coords(x, y);
    return -(Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v));
  };
  const tie = (x, y) => {
    const [u, v] = coords(x, y);
    const [i, j] = [Math.round(u), Math.round(v)];
    const dx = x - (i * ax + j * bx);
    const dy = y - (i * ay + j * by);
    const oct = Math.floor((Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI) / (Math.PI / 4) + 0.000000001) & 7;
    return ALONG[oct];
  };
  return equalize(shape, w, h, tie);
}
var BLUE_NOISE = (() => {
  const s = atob("5mkewUkqf948qxhk/1Z7InJdnyjRPMYG7J5vuSVFfs4icUOTeFyxR58dPbIYZuANoGHAbEzFDJw5+ljabO1AJ643o3lg9rRoBovgpDXGlNyt+kC2evOhaYJS+QPXqpU1uO3UK/Ib4Qf4wG7wUJM5tydE9Bi0eVrYHHQqnBKOt3fNj+sA2xmZT9EsSXQdqwxOMRJu2AlWHjPQFT2GZ+RWCGaHD1SdvYFlky2LBMSp/VvIepgujv9BrIzJsuZPxRlKDFgut0SHMu16vfaQ12LtiM6X7UqRr+C+keOkxy8YwP+hPa/fa0Ex0kzmW9omcBCD5gjbX9EAKOZgRQlqNf6A4mn1gtNvrccOnh9bAblFI3C2XB3DLWR9Q14ic1HqjHVKzRl8yAD8qRC2G6N6ONBKpTRUsT2mb8OCFfaV1apgK6E6mhBQJP1cQWzdrjzogMT3BDuBoOoX/AGo8boSnzyxJZHwWimWUIXsb8tD+bWN7yK/i/gaheFJojO9eiGIArjbILPG4qESkum4MYpvEZkyVafR43FIs47TLoNG2GLzA+BtN7Tlc8QhW5owiQxhF1fechBqyixZEfJm21Q+7NBIdY1hQH1nN89/B1X70ahf1xyKZSgQyjJuUMFmCZInxoRY1BOgQxbZO7IE8lLZqsmYP6LXRa3pmrqJJKcMsVyYE/nLBe4orOZOJqLHG0cp7Hq0P/68k1vcohblm/qwdUOpMLx++mGIneh402S7JHUyfgLwL5JiC3Y1yUl0/McufbtSMNiUvAuKwXbwZZR/vU4O358HS+18C/VAfCU6VuIO95dNBs0tvA5OKow9n+NK9s9ktVXHIfxH2QPknByMbfEhpYRDcVP0XxpC3DCyC/dsyS9cd7E2pymMtF/dvhXMgGEf6W2aU+1rrfrFG3AJkhedKYIR4Im6p4NptFg71wZF3mix/xehOdCzmARU1j+jIZaD684e2mXDTs8NoYVrmS6xxYo9tRnSPoAIWKnst2DBUNX6pUFpMFYX9CuR72SuxZQPWyjF3nwkavx9v2iH41e6RRSbVYoD6nYy/Ukg8EHnTwzWKvR1kSThldgmRIQz5ng9IHHCBOXOm0LTEcAnf1Q06buKTQGU5kYVpyjvETLNAPVxOcH6Qp8crolnxqcA0mihelqlAsBMtDVkfMz3HqIGs49Y7ZV6I2CucIRPpuwcz3I98ahiNa3EWN+PTZ10q2OO3KgnZ4HUWeUH1y9ZeY8p/hrcQuVg/HAV7qUBV5DXYvHJFDSuSO/CC/4y4ABojaEIfxnTdu4RinE60B7H/kDVLFEN5rMQNr9xQJO49xeswEiJu5cxhA2eyE+9OnK/RyuBSp7VZRCHOZNSuZbLNvpM2GebLbpI2Cv4B3qxVg1/GJ/EdYxM9JAfpPMUf0ngN1/sCWkgy6xF138ljeKeE/+pDeR2I/u13GnPIXYVSXu7JK43/FYJgaJhlLzqYy6WuuJe+jy8JaFq20/FYiedbckgeKXTVHLyHF43+BFjLcyFark4wlGQLksDquRd8ajcClnnF42qxvIbz0sYP4fS7WtJJIYF4FrPOwF+Mq3s0wSHst4/K+oEirvfl7d1pulZPyHuXYYSzW6f9n8zw4gnZZ6Kx0vWbyZdOnuu4J0jqwU4krLRbqcZern9l+MNiztb+00OkLV9o0kuawhSyEYFsZHVmgDgou8cv1YZmkYNuT73L3O4A0Hdmb3rAVp0+099wfURTu82lutQKmfMU3Cowi+ga/FX2SHK/rCE7yDXfvMYc0yyNGNGgTngccrzV+J5xBHlXp71hQ5tLI3WNLcb3l8sooIgwmYJjrAaP7si8BB80ibAEjpqj1cXQKA0k187wSz7e8ghrdSUCbMoZ6qOHU6khiHLLk+t/0emEsdlkKRE5W3MWqriR9l385t63kyXYudGi3j1qwvmeMLcbb4U355k0BWR8nQSXfmGQdEFNdVo8DvdeGPDH9Be43lL7wrVIYkB9zoQgyzGEVbVA480zB6vAaXWTb0005clVAf7qk2IC0KlVDe93UmjH+t7nP62ggyxkgjvnII3kxqzKYY6c6zGS5eycvCZXac4tyln/7mDWPcwYBWVdUhj9KiMMXki7LDccOcEZ5svyWusUBdeQibHVUasGEPdBL5q+Zvav1X7MGffKNFAuB75cIfkpVIKPtpzmsfjKe8Dtho/513Vu2sygx+3jf4XeegHOOHDlOagc/iH5XG2XHroPlEHYh6UDYG4E5BXBGqO1AlExRt865MltQxCbIbDoYDObsQUmkIC+E7LXz2sUbyRYLWIKWwA0TIcYDjNKvKXJqnSgLbpQcha7j93/sHiLlCb62Ew061pxlGJ8aoZTjjiUiqGrVLkkcSgDtoof+AlQPQQ10byhVew2sKZGoNJDslvG/MteKjcJp3Qrx2fRH7KsxWDn0oQNvoW3TNbzfVoEZn9Bt4teB5aNXXuk8IGb82ifVWpFbw+kwpLaf2k1rFZOYuiSF4CiGwRUzJmiAztIGU7+7ly6I9dnXm6CJV7JbrUdEG+YvOz1oiwFmVJ95tXMh7Hb90n+m3nLLoCVi9z9tu5FN+88TnD44/xvt5bqXOU2VUB1yi/RM8jathAs+aHMlylkBiDRQn8S8wzqHwT3rf9jjebWoIUpovsd92QHZoFTWmEIZhOryl7BUcmzTL3EsMtjmCmgAbnr0z+KmAATKwP2O84zqVkKnCX6iHQQYhkBUrqC861RtRfPBe0R843e8X9NNVwC/dj16C0dpBSu0J9q+8/GPZuNo8OgqPTkfi/dyhQbhDskdq8AF22au8nrdR5p2Q08HMgrcqC9Wes7V6hD6xYxoakPR1Z+RXnBJ9j6QtszbJPnMle7cVxGDxpHOiGyJe7VSA+fuFHjA/CUpgZ5CfDhg+a5QiWTyoHhBbhKI1F7hYx5XnNlTFpr4XeI9BPmCaF2C0WqT4fTt6pylSePgX/M3bMrhahKvSlNnjMPVmT+0qxWDP5ZeO/nUK2UdB33GqZulITtkbawh1NNHWnN8L5DmTyftFtvJf1CYkt1rhdrRyL6F/6a9JTgOII+Gy8AnIi4M5/tR86dtHzbpM6AbYiP9Ru/4wAg17zmMf9GI5beUa4k00C6S9+Xjhw6xRsgd9Ong1FMJIKxB9gsY0rqNs3n2MVQnHakhNaLhvC7qNc9n4Iqytg6yamPHsIZrHrBNukHjbfoFiwEdfEspRG9SA5zWzBq9x2tECc1koX5kZ8yO+Lw6IAUr3/poneYBOFSsGS5EvPo75Q4xa82VQ7fyzKaunAdCiD90SNJFIG0J+7iAP4I4JOGeVm+TF0yWKcHVcKSizzmSd8Qwq1N3ivK9kONWYedzoTec1qiyqc5L2WQhGJXAvYvRxv5KD9g2YuUOOwWTvumsgthQKPpvIKvuqVuHjWX7Lty2rbVPDJR/yZcrL0nN+P9povs0n4EHAaWvGiS/+rPpZTzA5iM9oZyXkXb5bSagpcrOtRxSNCgDVuKPwThD4OjTUbhZskBIliH8xUFsNXB2ZG6gxhxahK1nzCMNIZf2boMah8u0uvkvGpQusuE6rdNnge1G20WN+Q0Udlo8Hhclyp6b5AcaThvD3pikJ/L6vWI6TckTeB7yauAm2PtSrIBYz5IuACdD1bCIzItX5Eivu/nT4P/6AYugKr2zNUJMb7SgVh1fg0Vg95rAOiz/xwwIZRdCDQCGWUO/lV3kH0Ua9uQ1yVyvYjv9ljH0/yyyVTB2XijnoxaPVTfhuS8J87HZC4Kn0Wsc+V9C9o5SBPDzzyBLD+R7nhUsZ+IaMKdJ3aGM61L4ZPpIIy/J53AGeWuIDMTSK72EOLJsrpbAV8r9lo5J3ITIdkHUjWtliVe7mbXssvmGyFIqMN57dfzociOfB+C+hmEuJtDbg+4qk15xz0L63rVwen5bJhP75N0F8LgzlVCeow26Rwiw45x+0u2xqB51QS7TjXa0STL+RIvWeWU6ZDxq840JlZhRXUUbB1RZ8Ma5LKdhY2hhKb+C2h7iWr+nWZwQ/8JcDygBdnSoyraD+1zp5ds4kW83IPrOoAxCv6diKK9U0d7sssbI0K2V2H0zz5K0qe9M63chyJUMFv1Rq5PF2ATq5gQ5nSpwLjJ8cMjyh1Afssv1HJl1l9QdqNENSdXgd9v2hDl7v+P8AX57Mff77fWW8KUdc83xM1lkVjjiPjnjHSCucpVf1zt1j2fNXvO8VOmXbdHzb9FadvWrlLNObKoSqrBehaJH6ZMXJQm2EDqh2R4SygfrT/d+IFy/BwyADujWmleb4cNoVDoCBMYaOE5A87pmW3hdIt8xzhdLAZbT33itd7FKbhY/fLDe7ZRYT9QK5m8wJhyCmvWZwTSKhVdz3EGNpFj8zsCsRusgjbHlyx9owD5ERhwJo+iAT/jlXcFl5IuDfSSwKqQIonunDRLcN7Gr5DjKVNgvY1voct2boh9lmVCa5dJpXjM/+QvjFv0SNSwXQjkAlTzaZexSScuXfOI/JsiL0qe8NapjgPmmMI7laW2x/lDNMbdd5c/RWSZakz5Wz4fNxIW4AbRHjwoEKA6TOj8bTcdSXqOH1I7TUBr42gCljolPMR4Hf2U+iySKHUMnNbO7pmlUSkB7N6ReIGg8ZMGzq0E6TA2a5UFMoGl2DTDUxrMfeED7TfFMuCUftkLt2zHDZoSZgdyY0ZdcwjgQv5m4TxMMrsJWnSM6DJVbclotaKynLuAWcn6Itk+bYZfZvKG6pJwphuU6ViluAdRMSBQXfYpc8wYqpB3zSR61HGtRetcQFTgMGPTOoYa/o/d+gFYyNQjz+dfcc5rEwu4kD+WYrWA2E21CvxCjC/eKPqEpnxVgVz/LoJg1/AAGk6jmJHItSathQ69QywiCuaE5JSvZz80i3E+E0J2x56wpBtJro5duOm+xmBxXKwTdgHa1PLGrDFJoFO1PApmP6r4SfM51c3/WXhqFpzzlbnv9pn9CxAeBGnYhu4kW2e61cA0akM7JQpVIu1S5U5+RqJOrf+M4RDkOk8nCBxrkZXFHKeBnyoiRpGeinbnB1BewE4sBqE3bdT64bhM1j1PhOw30WCX8dIEs1xBtkg5GOiVeOTHqpu1WEUtuFbyA3ThbvZNPS/EOm+lMsEhjb7tqJci89HpAtoljkGdK7RJMSHaSyV8h9zn/W5POlXqn0I07wne1/dDPMroW8DjjV59TwaW5JLaD1xLF3xrU/IZg7V7CVu8FrG9iLWwEiYEHunUPzJFlOv2jBkgiKYastEkjZr7AHBPpi5Vsz6R73mpiSX6neyJNiYz6kSO23oJJR2MEudtBWRNH9Mq2v+K91j5Qs4o3a9PIwD5k+s/Q4puPQSnEmo91Ehhzp9H5ZkFk1ow0fODfiBBlD7h9WdD7tW8sOEB9NB57wC5IwUW4izRCjNjl3oD/hcpMIUzziJ2HRZ3YDPK4tz0uoGp94x7oHQrwOIMaNewA==");
  const t = new Uint8Array(s.length);
  for (let i = 0;i < s.length; i += 1)
    t[i] = s.charCodeAt(i);
  return t;
})();
var SCREENS = {
  bayer2: { name: "Bayer 2", at: (x, y) => (b2((y & 1) * 2 + (x & 1)) + 0.5) / 4 },
  bayer4: { name: "Bayer 4", at: (x, y) => (b4((y & 3) * 4 + (x & 3)) + 0.5) / 16 },
  bayer8: { name: "Bayer 8", at: (x, y) => (b8((y & 7) * 8 + (x & 7)) + 0.5) / 64 },
  chunky: { name: "Chunky", at: (x, y) => (b4((y >> 1 & 3) * 4 + (x >> 1 & 3)) + 0.5) / 16 },
  halftone: { name: "Halftone", at: dotScreen([3, 3], [3, -3], 6, 6) },
  coarseDot: { name: "Coarse Dot", at: (x, y) => (Math.cos((x + y) / 6 * Math.PI) * Math.cos((x - y) / 6 * Math.PI) + 1) * 0.5 },
  lines: { name: "Line Screen", at: (x, y) => tri(y / 3 + 0.5) * 0.9 + b2((y & 1) * 2 + (x & 1)) / 4 * 0.1 },
  diagonal: { name: "Diagonal", at: equalize((x, y) => [3, 1, 0, 2][x + y & 3], 8, 8, (x, y) => along(x + 4 * (x + y >> 2))) },
  hatch: { name: "Crosshatch", at: (x, y) => (tri((x + y) / 4) + tri((x - y) / 4)) * 0.5 },
  stipple: { name: "Stipple", at: (x, y) => (BLUE_NOISE[(y & 63) * 64 + (x & 63)] + 0.5) / 256 },
  ign: { name: "Interleaved", at: (x, y) => fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y)) },
  checker: { name: "Checker", at: (x, y) => x + y & 1 ? 0.3 : 0.7 },
  weave: { name: "Weave", at: (x, y) => ((x >> 1) + (y >> 1) & 1 ? tri(x / 4) : tri(y / 4)) * 0.94 + 0.03 }
};
var SCREEN_IDS = Object.keys(SCREENS);
function measureScreen(at, T = 24) {
  const vals = [];
  for (let y = 0;y < T; y += 1)
    for (let x = 0;x < T; x += 1)
      vals.push(at(x, y));
  const levels = new Set(vals.map((v) => v.toFixed(4))).size;
  const bins = new Array(16).fill(0);
  for (const v of vals) {
    const b = Math.min(15, Math.floor(v * 16));
    bins[b] = bins[b] + 1;
  }
  const maxBin = Math.max(...bins) / vals.length;
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
  const varr = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length || 1;
  const corr = (dx, dy) => {
    let acc = 0;
    let n = 0;
    for (let y = 0;y < T - 8; y += 1)
      for (let x = 8;x < T - 8; x += 1) {
        acc += (at(x, y) - mean) * (at(x + dx, y + dy) - mean);
        n += 1;
      }
    return acc / n / varr;
  };
  const shifts = [];
  for (let dy = 0;dy <= 8; dy += 1)
    for (let dx = -8;dx <= 8; dx += 1)
      if (dy > 0 || dx > 0)
        shifts.push({ r: corr(dx, dy), dx, dy });
  const rMax = Math.max(...shifts.map((s) => s.r));
  const best = shifts.filter((s) => s.r > rMax - 0.02).sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))[0];
  const angle = (Math.atan2(best.dy, best.dx) * 180 / Math.PI + 180) % 180;
  const unit2 = [[0, 1, 0], [45, 1, 1], [90, 0, 1], [135, -1, 1]].map(([a, dx, dy]) => [a, corr(dx, dy)]);
  const top = Math.max(...unit2.map(([, r]) => r));
  return {
    levels,
    maxBin,
    period: +Math.hypot(best.dx, best.dy).toFixed(2),
    angle: +angle.toFixed(1),
    r: +best.r.toFixed(2),
    lines: unit2.filter(([, r]) => r > top - 0.02).map(([a]) => a)
  };
}
var SCREEN_GEOM = Object.fromEntries(SCREEN_IDS.map((id2) => {
  const m = measureScreen(SCREENS[id2].at);
  return [id2, { period: m.period, angle: m.angle, r: m.r, lines: m.lines }];
}));
// packages/core/src/quantize.ts
var BAYER4Q = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
// packages/core/src/gif.ts
var DICT = new Int32Array(1 << 17).fill(-1);
var DICT_TOUCHED = new Int32Array(1 << 12);
var WIDE = new Map;
// packages/core/src/targets.ts
var preset = (id2, label, kind, width, height, paletteLimit, channelBits, screen, hardware = null) => Object.freeze({ id: id2, label, kind, width, height, paletteLimit, channelBits, screen, dither: screen ? 0.9 : 0, hardware });
var TARGET_PROFILES = Object.freeze({
  native: preset("native", "Original", "native", 128, 128, 65536, 8, 4),
  "8-bit": preset("8-bit", "8-bit style", "style", 256, 240, 16, 8, 2),
  "16-bit": preset("16-bit", "16-bit style", "style", 320, 240, 256, 5, 4),
  "32-bit": preset("32-bit", "32-bit style", "style", 512, 384, 32768, 5, 4),
  "64-bit": preset("64-bit", "64-bit style", "style", 640, 480, 65536, 8, 8),
  "game-boy": preset("game-boy", "Game Boy", "hardware", 160, 144, 4, 8, 2, "game-boy"),
  "game-boy-color": preset("game-boy-color", "Game Boy Color", "hardware", 160, 144, 32, 5, 2, "game-boy-color"),
  chromatic: preset("chromatic", "ModRetro Chromatic", "hardware", 160, 144, 32, 5, 2, "game-boy-color")
});
// packages/pinball-feedback/src/index.ts
var integer5 = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
var clamp2 = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
var hash4 = (value) => {
  let n = 2166136261;
  for (let i = 0;i < value.length; i++)
    n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
};
var random = (seed) => {
  let n = seed || 1;
  return () => {
    n ^= n << 13;
    n ^= n >>> 17;
    n ^= n << 5;
    return (n >>> 0) / 4294967296;
  };
};
function rampCue(r, arenaId, event, body, old, relocated) {
  if (event.arenaId !== undefined && event.arenaId !== arenaId)
    return;
  const dx = r.bx - r.ax, dy = r.by - r.ay, den = dx * dx + dy * dy;
  const progress = (b) => den ? clamp2(((b.x - r.ax) * dx + (b.y - r.ay) * dy) / den) : 0;
  const near = (b) => {
    if (!b || b.arenaId !== arenaId || b.transport || ![r.fromLayer, r.toLayer].includes(b.layer) || b.elevation < Math.min(r.fromElevation, r.toElevation) - b.radius - 4 || b.elevation > Math.max(r.fromElevation, r.toElevation) + b.radius + 4)
      return false;
    const t = progress(b);
    return Math.hypot(b.x - r.ax - dx * t, b.y - r.ay - dy * t) <= r.width / 2 + b.radius + 18;
  };
  const nativeBody = !relocated && near(body) ? body : undefined, previous = near(old) ? old : undefined;
  let end;
  if (event.x !== undefined && event.y !== undefined && event.elevation !== undefined && [event.x, event.y, event.elevation].every(Number.isFinite)) {
    const da = (event.x - r.ax) ** 2 + (event.y - r.ay) ** 2 + (event.elevation - r.fromElevation) ** 2, db = (event.x - r.bx) ** 2 + (event.y - r.by) ** 2 + (event.elevation - r.toElevation) ** 2;
    if (da !== db)
      end = db < da;
  }
  if (end === undefined && event.layer !== undefined && r.fromLayer !== r.toLayer && [r.fromLayer, r.toLayer].includes(event.layer))
    end = event.layer === r.toLayer;
  if (end === undefined) {
    const motion = previous ?? nativeBody, dot2 = motion ? motion.vx * dx + motion.vy * dy : 0;
    if (event.type === "ramp-abort" && motion)
      end = progress(motion) >= 0.5;
    else if (dot2 !== 0)
      end = event.type === "ramp-enter" ? dot2 < 0 : dot2 > 0;
  }
  if (!nativeBody && end === undefined)
    return;
  const anchor = nativeBody ?? { x: end ? r.bx : r.ax, y: end ? r.by : r.ay, layer: end ? r.toLayer : r.fromLayer, elevation: end ? r.toElevation : r.fromElevation };
  const position = { arenaId, x: event.x ?? anchor.x, y: event.y ?? anchor.y, layer: event.layer ?? anchor.layer, elevation: event.elevation ?? anchor.elevation };
  return [position.x, position.y, position.elevation].every(Number.isFinite) && integer5(position.layer, 0, 3) ? position : undefined;
}
var soundForEvent = (event, kind) => {
  switch (event.type) {
    case "launch":
      return "spring.release";
    case "bumper":
      return kind === "spring" ? "slingshot.snap" : "bumper.pop";
    case "rail":
      return "rail.ting";
    case "switch":
      return "target.hit";
    case "gate":
      return "gate.close";
    case "ramp-enter":
      return "ramp.enter";
    case "ramp-exit":
      return "ramp.exit";
    case "portal":
      return "portal.exit";
    case "capture-enter":
      return kind === "scoop" ? "scoop.capture" : kind === "portal" ? "portal.enter" : "lock.capture";
    case "transit-start":
      return "capture.travel";
    case "exit-blocked":
      return "capture.blocked";
    case "capture-release":
      return kind === "scoop" ? "scoop.eject" : kind === "portal" ? "portal.exit" : "lock.release";
    case "drain":
    case "escape":
      return "drain";
    case "route-complete":
      return "route.complete";
    case "ability":
      return event.ability === "dash" ? "skill.dash" : event.ability === "shield" ? "skill.shield" : "skill.pulse";
    case "damage":
      return "damage";
    default:
      return;
  }
};
function createPinballFeedback(world, options = {}) {
  validateArenaWorld(world);
  const seed = options.seed ?? world.seed, particleCap = options.maxParticles ?? 256, pulseCap = options.maxPulses ?? 64;
  if (typeof seed !== "string" || seed.length < 1 || seed.length > 256 || !integer5(particleCap, 0, 2048) || !integer5(pulseCap, 0, 512))
    throw new Error("Pinball feedback budget");
  const specs = arenaMechanismSpecs(world), bindings = arenaCaptureBindings(world), bindingById = new Map(bindings.map((b) => [b.item.id, b])), positions = new Map, captureKinds = new Map(bindings.map((b) => [b.item.id, b.item.kind]));
  const flipperSpecs = new Map(world.arenas.flatMap((a) => a.flippers.map((f) => [f.id, f]))), ramps = new Map(world.arenas.flatMap((a) => a.ramps.map((r) => [r.id, { arenaId: a.id, item: r }])));
  for (const a of world.arenas) {
    for (const b of a.bumpers)
      positions.set(b.id, { arenaId: a.id, x: b.x, y: b.y, layer: b.layer, elevation: b.elevation });
    for (const s of a.stations)
      positions.set(s.id, { arenaId: a.id, x: s.launchX, y: s.launchY, layer: s.layer, elevation: s.elevation });
    for (const s of a.switches)
      positions.set(s.id, { arenaId: a.id, x: s.x, y: s.y, layer: s.layer, elevation: s.elevation });
    for (const g of a.gates)
      positions.set(g.id, { arenaId: a.id, x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2, layer: g.layer, elevation: g.elevation });
  }
  for (const b of bindings)
    positions.set(b.item.id, { arenaId: b.arenaId, x: b.entry.x, y: b.entry.y, layer: b.entry.layer, elevation: b.entry.elevation });
  const serials = new Map, seen = new Map, bladeMotion = new Map, gateOpen = new Map;
  let current, lastTick = -1, particles = [], pulses = [], droppedParticles = 0, droppedPulses = 0, evictedEvents = 0;
  let transports = new Map;
  function burst2(id2, tick, position, kind, intensity, ownerId) {
    const rng = random(hash4(seed + "|" + id2)), count = options.reducedMotion ? 0 : Math.ceil(2 + intensity * 6), duration = kind === "mist" ? 48 : 28;
    for (let i = 0;i < count; i++) {
      if (particles.length >= particleCap) {
        droppedParticles++;
        break;
      }
      const angle = rng() * Math.PI * 2, speed = (0.4 + rng() * 1.3) * (kind === "mist" ? 0.45 : 1);
      particles.push({ ...position, id: id2 + ":" + i, kind, tick, duration, size: 1.2 + rng() * 1.6, ownerId, vx: dcos(angle) * speed, vy: dsin(angle) * speed, vz: 0.1 + rng() * 0.3 });
    }
    if (pulses.length >= pulseCap) {
      droppedPulses++;
      return;
    }
    pulses.push({ ...position, id: id2, kind, tick, duration: options.reducedMotion ? 12 : 24, radius: 8 + intensity * 22, ownerId });
  }
  function update(frame) {
    if (frame.schema !== "keel-pinball-arena-frame@2" || !integer5(frame.tick, 0, 432000) || frame.tick < lastTick || frame.mechanisms.length !== specs.length || frame.mechanisms.some((m, i) => m.id !== specs[i].id || m.kind !== specs[i].kind || m.arenaId !== specs[i].arenaId || m.durationTicks !== specs[i].durationTicks || !integer5(m.activationSerial, 0, frame.tick) || !integer5(m.activationTick, 0, frame.tick) || !integer5(m.intensity, 0, 1024)) || frame.events.length > 4096 || frame.balls.length > 128 || frame.flippers.length !== flipperSpecs.size || new Set(frame.flippers.map((f) => f.id)).size !== flipperSpecs.size || frame.flippers.some((f) => !flipperSpecs.has(f.id) || !Number.isFinite(f.angle)))
      throw new Error("Pinball feedback frame admission");
    const first = current === undefined, sounds = [], sounded = new Set, ownerForMechanism = new Map(frame.events.filter((e) => e.type === "mechanism-actuate" && e.mechanismId).map((e) => [e.mechanismId, e.ownerId ?? null])), bodies = new Map(frame.balls.map((b) => [b.ownerId, b])), mechanisms = new Map(frame.mechanisms.map((m) => [m.id, m]));
    const contacts = new Map;
    for (const event of frame.events) {
      if (event.type !== "bumper" && event.type !== "rail")
        continue;
      const id2 = event.colliderId ?? event.mechanismId, m = id2 ? mechanisms.get(id2) : undefined;
      if (!m || event.tick !== m.activationTick)
        continue;
      if (!contacts.has(m.id))
        contacts.set(m.id, undefined);
      const center = positions.get(m.id);
      if (contacts.get(m.id) || event.arenaId !== m.arenaId || event.colliderId !== undefined && event.colliderId !== m.id || event.mechanismId !== undefined && event.mechanismId !== m.id || event.x === undefined || event.y === undefined || event.elevation === undefined || ![event.x, event.y, event.elevation].every(Number.isFinite) || event.layer !== undefined && event.layer !== center.layer)
        continue;
      contacts.set(m.id, { arenaId: event.arenaId, x: event.x, y: event.y, layer: center.layer, elevation: event.elevation });
    }
    const relocated = new Set(frame.events.filter((e) => e.tick === frame.tick && ["portal", "fall", "drain", "escape", "capture-enter", "capture-release"].includes(e.type)).map((e) => e.ownerId));
    particles = particles.filter((p) => frame.tick - p.tick < p.duration);
    pulses = pulses.filter((p) => frame.tick - p.tick < p.duration);
    for (const [id2, tick] of seen)
      if (frame.tick - tick > 120)
        seen.delete(id2);
    const focusPosition = (event) => {
      const binding = bindingById.get(event.mechanismId ?? ""), body = event.ownerId === undefined ? undefined : bodies.get(event.ownerId), ramp2 = ramps.get(event.colliderId ?? "");
      if (ramp2 && ["ramp-enter", "ramp-exit", "ramp-abort"].includes(event.type)) {
        const old = current?.tick === event.tick - 1 ? current.balls.find((b) => b.ownerId === event.ownerId) : undefined;
        return rampCue(ramp2.item, ramp2.arenaId, event, frame.tick === event.tick ? body : undefined, old, relocated.has(event.ownerId));
      }
      const anchor = positions.get(event.mechanismId ?? event.colliderId ?? "") ?? body;
      const port = binding && event.type === "capture-release" ? event.exitPortId === binding.item.fallbackExitPortId ? binding.fallback : binding.exit : undefined;
      if (port)
        return { arenaId: binding.item.exitArenaId, x: port.x, y: port.y, layer: port.layer, elevation: port.elevation };
      if (event.arenaId === undefined && !anchor)
        return;
      return { arenaId: event.arenaId ?? anchor.arenaId, x: event.x ?? anchor?.x ?? 0, y: event.y ?? anchor?.y ?? 0, layer: event.layer ?? anchor?.layer ?? 0, elevation: event.elevation ?? anchor?.elevation ?? 0 };
    };
    for (const event of frame.events) {
      if (seen.has(event.id) || event.tick > frame.tick || frame.tick - event.tick > 120)
        continue;
      if (seen.size >= 8192) {
        seen.delete(seen.keys().next().value);
        evictedEvents++;
      }
      seen.set(event.id, event.tick);
      if (first && frame.tick > 0)
        continue;
      const position = focusPosition(event), mechanism = mechanisms.get(event.mechanismId ?? event.colliderId ?? ""), kind = captureKinds.get(event.mechanismId ?? "") ?? mechanism?.kind, name2 = soundForEvent(event, kind);
      if (!position)
        continue;
      if (name2) {
        sounds.push({ ...position, id: event.id, name: name2, gain: clamp2((event.energy ?? 9) / 18, 0.3, 1), priority: name2 === "rail.ting" ? 0 : ["capture-enter", "capture-release", "exit-blocked", "route-complete", "drain"].includes(event.type) ? 3 : event.type === "transit-start" ? 2 : 1, ownerId: event.ownerId ?? null });
        if (mechanism)
          sounded.add(mechanism.id);
      }
      if (["capture-enter", "capture-release", "transit-start", "exit-blocked", "ability", "drain", "route-complete"].includes(event.type))
        burst2(event.id, event.tick, position, event.type.startsWith("capture") ? "mist" : event.type === "ability" || event.type === "transit-start" ? "charge" : "ring", event.type === "transit-start" ? 0.35 : event.type === "exit-blocked" ? 0.5 : 1, event.ownerId ?? null);
      if (event.type === "ramp-enter" || event.type === "ramp-exit")
        burst2(event.id, event.tick, position, event.type === "ramp-enter" ? "spark" : "ring", 0.2, event.ownerId ?? null);
    }
    for (const m of frame.mechanisms) {
      const previous = serials.get(m.id) ?? 0;
      serials.set(m.id, m.activationSerial);
      if (first || m.activationSerial <= previous || frame.tick - m.activationTick >= m.durationTicks)
        continue;
      const position = positions.get(m.id);
      const impact = contacts.get(m.id), burstPosition = impact ?? (!contacts.has(m.id) && m.kind !== "spring" && m.kind !== "bumper" ? position : undefined);
      if (burstPosition)
        burst2(m.id + ":" + m.activationSerial, m.activationTick, burstPosition, m.kind === "lock" ? "mist" : "spark", m.intensity / 1024, ownerForMechanism.get(m.id) ?? null);
      if (!sounded.has(m.id) && m.kind !== "lock")
        sounds.push({ ...position, id: m.id + ":" + m.activationSerial, name: m.kind === "plunger" ? "spring.release" : m.kind === "spring" ? "slingshot.snap" : m.kind === "bumper" ? "bumper.pop" : m.kind === "gate" ? "gate.close" : "target.hit", gain: clamp2(m.intensity / 1024, 0.3, 1), priority: 1, ownerId: ownerForMechanism.get(m.id) ?? null });
    }
    if (frame.tick !== lastTick)
      for (const f of frame.flippers) {
        const previous = bladeMotion.get(f.id), spec = flipperSpecs.get(f.id);
        if (!spec)
          throw new Error("Pinball feedback flipper identity");
        const direction = previous ? Math.sign((f.angle - previous.angle) * (spec.activeAngle - spec.restAngle)) : 0;
        if (previous && direction !== 0 && direction !== previous.direction)
          sounds.push({ id: f.id + ":" + frame.tick, name: direction > 0 ? "flipper.up" : "flipper.down", arenaId: f.arenaId, x: f.pivotX, y: f.pivotY, layer: f.layer, elevation: f.elevation, gain: 0.55, priority: 2, ownerId: f.ownerId < 0 ? null : f.ownerId });
        bladeMotion.set(f.id, { angle: f.angle, direction });
      }
    for (const g of frame.gates) {
      if (gateOpen.get(g.id) === false && g.open) {
        const position = positions.get(g.id);
        if (position)
          sounds.push({ ...position, id: g.id + ":open:" + frame.tick, name: "gate.open", gain: 0.65, priority: 2, ownerId: null });
      }
      gateOpen.set(g.id, g.open);
    }
    if (frame.tick !== lastTick && frame.tick % 12 === 0) {
      for (const b of frame.balls)
        if (b.active && b.rampId !== null)
          sounds.push({ id: b.id + ":roll:" + frame.tick, name: "ramp.roll", arenaId: b.arenaId, x: b.x, y: b.y, layer: b.layer, elevation: b.elevation, gain: clamp2(Math.hypot(b.vx, b.vy) / 18, 0.1, 0.5), priority: 0, ownerId: b.ownerId });
    }
    transports = new Map(frame.balls.filter((b) => b.transport !== null).map((b) => [b.transport.mechanismId, b.transport]));
    current = frame;
    lastTick = frame.tick;
    return Object.freeze(sounds.map((sound) => Object.freeze(sound)));
  }
  function sample(tick = lastTick, alpha = 0) {
    if (!current || tick !== lastTick || !Number.isFinite(alpha) || alpha < 0 || alpha >= 1)
      throw new Error("Pinball feedback sample timing");
    const now = tick + alpha;
    const mechanisms = current.mechanisms.map((m) => {
      const u = clamp2((now - m.activationTick) / m.durationTicks), intensity = m.activationSerial === 0 ? 0 : m.intensity / 1024, transport = transports.get(m.id) ?? null, binding = bindingById.get(m.id);
      const captureDuration = binding?.item.release.kind === "qualification" ? binding.item.release.maxHoldTicks : binding?.item.captureTicks ?? 1;
      const duration = transport?.phase === "captured" ? captureDuration : transport?.phase === "transit" ? binding?.item.travelTicks ?? 1 : binding?.item.maxExitWaitTicks ?? 1;
      return Object.freeze({ ...positions.get(m.id), id: m.id, kind: m.kind, recoil: options.reducedMotion ? 0 : intensity * (1 - u) * Math.exp(-6 * u) * (0.65 + 0.35 * Math.cos(6 * Math.PI * u)), pulse: intensity * (1 - u), charge: transport?.phase === "captured" ? clamp2((now - transport.entryTick) / captureDuration) : 0, transportPhase: transport?.phase ?? null, transportProgress: transport ? clamp2((now - transport.phaseTick) / Math.max(1, duration)) : 0 });
    });
    return Object.freeze({ tick: now, mechanisms: Object.freeze(mechanisms), particles: Object.freeze(particles.filter((p) => now - p.tick < p.duration).map((p) => {
      const age = now - p.tick;
      return Object.freeze({ id: p.id, kind: p.kind, arenaId: p.arenaId, x: p.x + p.vx * age, y: p.y + p.vy * age, layer: p.layer, elevation: p.elevation + Math.max(0, p.vz * age - 0.005 * age * age), age, alpha: (1 - age / p.duration) ** 2, size: p.size, ownerId: p.ownerId });
    })), pulses: Object.freeze(pulses.filter((p) => now - p.tick < p.duration).map((p) => {
      const age = now - p.tick;
      return Object.freeze({ id: p.id, kind: p.kind, arenaId: p.arenaId, x: p.x, y: p.y, layer: p.layer, elevation: p.elevation, alpha: 1 - age / p.duration, radius: p.radius * (0.4 + 0.6 * age / p.duration), ownerId: p.ownerId });
    })) });
  }
  return { update, sample, reset() {
    current = undefined;
    lastTick = -1;
    serials.clear();
    seen.clear();
    bladeMotion.clear();
    gateOpen.clear();
    transports.clear();
    particles = [];
    pulses = [];
    droppedParticles = 0;
    droppedPulses = 0;
    evictedEvents = 0;
  }, get stats() {
    return Object.freeze({ particles: particles.length, pulses: pulses.length, droppedParticles, droppedPulses, evictedEvents, eventHistory: seen.size, mechanisms: specs.length });
  } };
}

// packages/pinball-feedback/test/fixtures/phase3/module.ts
var manifest4 = defineManifest({ id: "keel/pinball-feedback", version: "0.1.0", kind: "runtime", needs: ["keel/runtime@^0.1", "keel/pinball-arena@^0.1", "keel/audio@^0.1"], title: "Pinball mechanism feedback", description: "Bounded seeded mechanism poses, particles, lamp pulses and sound cues from admitted pinball state and events." });
// packages/pinball-feedback/test/fixtures/phase3/index.ts
var integer6 = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
var clamp3 = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
var hash6 = (value) => {
  let n = 2166136261;
  for (let i = 0;i < value.length; i++)
    n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
};
var random2 = (seed) => {
  let n = seed || 1;
  return () => {
    n ^= n << 13;
    n ^= n >>> 17;
    n ^= n << 5;
    return (n >>> 0) / 4294967296;
  };
};
function rampCue2(r, arenaId, event, body, old, relocated) {
  if (event.arenaId !== undefined && event.arenaId !== arenaId)
    return;
  const dx = r.bx - r.ax, dy = r.by - r.ay, den = dx * dx + dy * dy;
  const progress = (b) => den ? clamp3(((b.x - r.ax) * dx + (b.y - r.ay) * dy) / den) : 0;
  const near = (b) => {
    if (!b || b.arenaId !== arenaId || b.transport || ![r.fromLayer, r.toLayer].includes(b.layer) || b.elevation < Math.min(r.fromElevation, r.toElevation) - b.radius - 4 || b.elevation > Math.max(r.fromElevation, r.toElevation) + b.radius + 4)
      return false;
    const t = progress(b);
    return Math.hypot(b.x - r.ax - dx * t, b.y - r.ay - dy * t) <= r.width / 2 + b.radius + 18;
  };
  const nativeBody = !relocated && near(body) ? body : undefined, previous = near(old) ? old : undefined;
  let end;
  if (event.x !== undefined && event.y !== undefined && event.elevation !== undefined && [event.x, event.y, event.elevation].every(Number.isFinite)) {
    const da = (event.x - r.ax) ** 2 + (event.y - r.ay) ** 2 + (event.elevation - r.fromElevation) ** 2, db = (event.x - r.bx) ** 2 + (event.y - r.by) ** 2 + (event.elevation - r.toElevation) ** 2;
    if (da !== db)
      end = db < da;
  }
  if (end === undefined && event.layer !== undefined && r.fromLayer !== r.toLayer && [r.fromLayer, r.toLayer].includes(event.layer))
    end = event.layer === r.toLayer;
  if (end === undefined) {
    const motion = previous ?? nativeBody, dot2 = motion ? motion.vx * dx + motion.vy * dy : 0;
    if (event.type === "ramp-abort" && motion)
      end = progress(motion) >= 0.5;
    else if (dot2 !== 0)
      end = event.type === "ramp-enter" ? dot2 < 0 : dot2 > 0;
  }
  if (!nativeBody && end === undefined)
    return;
  const anchor = nativeBody ?? { x: end ? r.bx : r.ax, y: end ? r.by : r.ay, layer: end ? r.toLayer : r.fromLayer, elevation: end ? r.toElevation : r.fromElevation };
  const position = { arenaId, x: event.x ?? anchor.x, y: event.y ?? anchor.y, layer: event.layer ?? anchor.layer, elevation: event.elevation ?? anchor.elevation };
  return [position.x, position.y, position.elevation].every(Number.isFinite) && integer6(position.layer, 0, 3) ? position : undefined;
}
var soundForEvent2 = (event, kind) => {
  switch (event.type) {
    case "launch":
      return "spring.release";
    case "bumper":
      return kind === "spring" ? "slingshot.snap" : "bumper.pop";
    case "rail":
      return "rail.ting";
    case "switch":
      return "target.hit";
    case "gate":
      return "gate.close";
    case "ramp-enter":
      return "ramp.enter";
    case "ramp-exit":
      return "ramp.exit";
    case "portal":
      return "portal.exit";
    case "capture-enter":
      return kind === "scoop" ? "scoop.capture" : kind === "portal" ? "portal.enter" : "lock.capture";
    case "transit-start":
      return "capture.travel";
    case "exit-blocked":
      return "capture.blocked";
    case "capture-release":
      return kind === "scoop" ? "scoop.eject" : kind === "portal" ? "portal.exit" : "lock.release";
    case "drain":
    case "escape":
      return "drain";
    case "route-complete":
      return "route.complete";
    case "ability":
      return event.ability === "dash" ? "skill.dash" : event.ability === "shield" ? "skill.shield" : "skill.pulse";
    case "damage":
      return "damage";
    default:
      return;
  }
};
function createPinballFeedback2(world, options = {}) {
  validateArenaWorld(world);
  const seed = options.seed ?? world.seed, particleCap = options.maxParticles ?? 256, pulseCap = options.maxPulses ?? 64;
  if (typeof seed !== "string" || seed.length < 1 || seed.length > 256 || !integer6(particleCap, 0, 2048) || !integer6(pulseCap, 0, 512))
    throw new Error("Pinball feedback budget");
  const specs = arenaMechanismSpecs(world), bindings = arenaCaptureBindings(world), bindingById = new Map(bindings.map((b) => [b.item.id, b])), positions = new Map, captureKinds = new Map(bindings.map((b) => [b.item.id, b.item.kind]));
  const flipperSpecs = new Map(world.arenas.flatMap((a) => a.flippers.map((f) => [f.id, f]))), ramps = new Map(world.arenas.flatMap((a) => a.ramps.map((r) => [r.id, { arenaId: a.id, item: r }])));
  for (const a of world.arenas) {
    for (const b of a.bumpers)
      positions.set(b.id, { arenaId: a.id, x: b.x, y: b.y, layer: b.layer, elevation: b.elevation });
    for (const s of a.stations)
      positions.set(s.id, { arenaId: a.id, x: s.launchX, y: s.launchY, layer: s.layer, elevation: s.elevation });
    for (const s of a.switches)
      positions.set(s.id, { arenaId: a.id, x: s.x, y: s.y, layer: s.layer, elevation: s.elevation });
    for (const g of a.gates)
      positions.set(g.id, { arenaId: a.id, x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2, layer: g.layer, elevation: g.elevation });
  }
  for (const b of bindings)
    positions.set(b.item.id, { arenaId: b.arenaId, x: b.entry.x, y: b.entry.y, layer: b.entry.layer, elevation: b.entry.elevation });
  const serials = new Map, seen = new Map, bladeMotion = new Map, gateOpen = new Map;
  let current, lastTick = -1, particles = [], pulses = [], droppedParticles = 0, droppedPulses = 0, evictedEvents = 0;
  let transports = new Map;
  function burst2(id2, tick, position, kind, intensity, ownerId) {
    const rng = random2(hash6(seed + "|" + id2)), count = options.reducedMotion ? 0 : Math.ceil(2 + intensity * 6), duration = kind === "mist" ? 48 : 28;
    for (let i = 0;i < count; i++) {
      if (particles.length >= particleCap) {
        droppedParticles++;
        break;
      }
      const angle = rng() * Math.PI * 2, speed = (0.4 + rng() * 1.3) * (kind === "mist" ? 0.45 : 1);
      particles.push({ ...position, id: id2 + ":" + i, kind, tick, duration, size: 1.2 + rng() * 1.6, ownerId, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, vz: 0.1 + rng() * 0.3 });
    }
    if (pulses.length >= pulseCap) {
      droppedPulses++;
      return;
    }
    pulses.push({ ...position, id: id2, kind, tick, duration: options.reducedMotion ? 12 : 24, radius: 8 + intensity * 22, ownerId });
  }
  function update(frame) {
    if (frame.schema !== "keel-pinball-arena-frame@2" || !integer6(frame.tick, 0, 432000) || frame.tick < lastTick || frame.mechanisms.length !== specs.length || frame.mechanisms.some((m, i) => m.id !== specs[i].id || m.kind !== specs[i].kind || m.arenaId !== specs[i].arenaId || m.durationTicks !== specs[i].durationTicks || !integer6(m.activationSerial, 0, frame.tick) || !integer6(m.activationTick, 0, frame.tick) || !integer6(m.intensity, 0, 1024)) || frame.events.length > 4096 || frame.balls.length > 128 || frame.flippers.length !== flipperSpecs.size || new Set(frame.flippers.map((f) => f.id)).size !== flipperSpecs.size || frame.flippers.some((f) => !flipperSpecs.has(f.id) || !Number.isFinite(f.angle)))
      throw new Error("Pinball feedback frame admission");
    const first = current === undefined, sounds = [], sounded = new Set, ownerForMechanism = new Map(frame.events.filter((e) => e.type === "mechanism-actuate" && e.mechanismId).map((e) => [e.mechanismId, e.ownerId ?? null])), bodies = new Map(frame.balls.map((b) => [b.ownerId, b])), mechanisms = new Map(frame.mechanisms.map((m) => [m.id, m]));
    const relocated = new Set(frame.events.filter((e) => e.tick === frame.tick && ["portal", "fall", "drain", "escape", "capture-enter", "capture-release"].includes(e.type)).map((e) => e.ownerId));
    particles = particles.filter((p) => frame.tick - p.tick < p.duration);
    pulses = pulses.filter((p) => frame.tick - p.tick < p.duration);
    for (const [id2, tick] of seen)
      if (frame.tick - tick > 120)
        seen.delete(id2);
    const focusPosition = (event) => {
      const binding = bindingById.get(event.mechanismId ?? ""), body = event.ownerId === undefined ? undefined : bodies.get(event.ownerId), ramp2 = ramps.get(event.colliderId ?? "");
      if (ramp2 && ["ramp-enter", "ramp-exit", "ramp-abort"].includes(event.type)) {
        const old = current?.tick === event.tick - 1 ? current.balls.find((b) => b.ownerId === event.ownerId) : undefined;
        return rampCue2(ramp2.item, ramp2.arenaId, event, frame.tick === event.tick ? body : undefined, old, relocated.has(event.ownerId));
      }
      const anchor = positions.get(event.mechanismId ?? event.colliderId ?? "") ?? body;
      const port = binding && event.type === "capture-release" ? event.exitPortId === binding.item.fallbackExitPortId ? binding.fallback : binding.exit : undefined;
      if (port)
        return { arenaId: binding.item.exitArenaId, x: port.x, y: port.y, layer: port.layer, elevation: port.elevation };
      if (event.arenaId === undefined && !anchor)
        return;
      return { arenaId: event.arenaId ?? anchor.arenaId, x: event.x ?? anchor?.x ?? 0, y: event.y ?? anchor?.y ?? 0, layer: event.layer ?? anchor?.layer ?? 0, elevation: event.elevation ?? anchor?.elevation ?? 0 };
    };
    for (const event of frame.events) {
      if (seen.has(event.id) || event.tick > frame.tick || frame.tick - event.tick > 120)
        continue;
      if (seen.size >= 8192) {
        seen.delete(seen.keys().next().value);
        evictedEvents++;
      }
      seen.set(event.id, event.tick);
      if (first && frame.tick > 0)
        continue;
      const position = focusPosition(event), mechanism = mechanisms.get(event.mechanismId ?? event.colliderId ?? ""), kind = captureKinds.get(event.mechanismId ?? "") ?? mechanism?.kind, name2 = soundForEvent2(event, kind);
      if (!position)
        continue;
      if (name2) {
        sounds.push({ ...position, id: event.id, name: name2, gain: clamp3((event.energy ?? 9) / 18, 0.3, 1), priority: name2 === "rail.ting" ? 0 : ["capture-enter", "capture-release", "exit-blocked", "route-complete", "drain"].includes(event.type) ? 3 : event.type === "transit-start" ? 2 : 1, ownerId: event.ownerId ?? null });
        if (mechanism)
          sounded.add(mechanism.id);
      }
      if (["capture-enter", "capture-release", "transit-start", "exit-blocked", "ability", "drain", "route-complete"].includes(event.type))
        burst2(event.id, event.tick, position, event.type.startsWith("capture") ? "mist" : event.type === "ability" || event.type === "transit-start" ? "charge" : "ring", event.type === "transit-start" ? 0.35 : event.type === "exit-blocked" ? 0.5 : 1, event.ownerId ?? null);
      if (event.type === "ramp-enter" || event.type === "ramp-exit")
        burst2(event.id, event.tick, position, event.type === "ramp-enter" ? "spark" : "ring", 0.2, event.ownerId ?? null);
    }
    for (const m of frame.mechanisms) {
      const previous = serials.get(m.id) ?? 0;
      serials.set(m.id, m.activationSerial);
      if (first || m.activationSerial <= previous || frame.tick - m.activationTick >= m.durationTicks)
        continue;
      const position = positions.get(m.id);
      burst2(m.id + ":" + m.activationSerial, m.activationTick, position, m.kind === "lock" ? "mist" : "spark", m.intensity / 1024, ownerForMechanism.get(m.id) ?? null);
      if (!sounded.has(m.id) && m.kind !== "lock")
        sounds.push({ ...position, id: m.id + ":" + m.activationSerial, name: m.kind === "plunger" ? "spring.release" : m.kind === "spring" ? "slingshot.snap" : m.kind === "bumper" ? "bumper.pop" : m.kind === "gate" ? "gate.close" : "target.hit", gain: clamp3(m.intensity / 1024, 0.3, 1), priority: 1, ownerId: ownerForMechanism.get(m.id) ?? null });
    }
    if (frame.tick !== lastTick)
      for (const f of frame.flippers) {
        const previous = bladeMotion.get(f.id), spec = flipperSpecs.get(f.id);
        if (!spec)
          throw new Error("Pinball feedback flipper identity");
        const direction = previous ? Math.sign((f.angle - previous.angle) * (spec.activeAngle - spec.restAngle)) : 0;
        if (previous && direction !== 0 && direction !== previous.direction)
          sounds.push({ id: f.id + ":" + frame.tick, name: direction > 0 ? "flipper.up" : "flipper.down", arenaId: f.arenaId, x: f.pivotX, y: f.pivotY, layer: f.layer, elevation: f.elevation, gain: 0.55, priority: 2, ownerId: f.ownerId < 0 ? null : f.ownerId });
        bladeMotion.set(f.id, { angle: f.angle, direction });
      }
    for (const g of frame.gates) {
      if (gateOpen.get(g.id) === false && g.open) {
        const position = positions.get(g.id);
        if (position)
          sounds.push({ ...position, id: g.id + ":open:" + frame.tick, name: "gate.open", gain: 0.65, priority: 2, ownerId: null });
      }
      gateOpen.set(g.id, g.open);
    }
    if (frame.tick !== lastTick && frame.tick % 12 === 0) {
      for (const b of frame.balls)
        if (b.active && b.rampId !== null)
          sounds.push({ id: b.id + ":roll:" + frame.tick, name: "ramp.roll", arenaId: b.arenaId, x: b.x, y: b.y, layer: b.layer, elevation: b.elevation, gain: clamp3(Math.hypot(b.vx, b.vy) / 18, 0.1, 0.5), priority: 0, ownerId: b.ownerId });
    }
    transports = new Map(frame.balls.filter((b) => b.transport !== null).map((b) => [b.transport.mechanismId, b.transport]));
    current = frame;
    lastTick = frame.tick;
    return Object.freeze(sounds.map((sound) => Object.freeze(sound)));
  }
  function sample(tick = lastTick, alpha = 0) {
    if (!current || tick !== lastTick || !Number.isFinite(alpha) || alpha < 0 || alpha >= 1)
      throw new Error("Pinball feedback sample timing");
    const now = tick + alpha;
    const mechanisms = current.mechanisms.map((m) => {
      const u = clamp3((now - m.activationTick) / m.durationTicks), intensity = m.activationSerial === 0 ? 0 : m.intensity / 1024, transport = transports.get(m.id) ?? null, binding = bindingById.get(m.id);
      const captureDuration = binding?.item.release.kind === "qualification" ? binding.item.release.maxHoldTicks : binding?.item.captureTicks ?? 1;
      const duration = transport?.phase === "captured" ? captureDuration : transport?.phase === "transit" ? binding?.item.travelTicks ?? 1 : binding?.item.maxExitWaitTicks ?? 1;
      return Object.freeze({ ...positions.get(m.id), id: m.id, kind: m.kind, recoil: options.reducedMotion ? 0 : intensity * (1 - u) * Math.exp(-6 * u) * (0.65 + 0.35 * Math.cos(6 * Math.PI * u)), pulse: intensity * (1 - u), charge: transport?.phase === "captured" ? clamp3((now - transport.entryTick) / captureDuration) : 0, transportPhase: transport?.phase ?? null, transportProgress: transport ? clamp3((now - transport.phaseTick) / Math.max(1, duration)) : 0 });
    });
    return Object.freeze({ tick: now, mechanisms: Object.freeze(mechanisms), particles: Object.freeze(particles.filter((p) => now - p.tick < p.duration).map((p) => {
      const age = now - p.tick;
      return Object.freeze({ id: p.id, kind: p.kind, arenaId: p.arenaId, x: p.x + p.vx * age, y: p.y + p.vy * age, layer: p.layer, elevation: p.elevation + Math.max(0, p.vz * age - 0.005 * age * age), age, alpha: (1 - age / p.duration) ** 2, size: p.size, ownerId: p.ownerId });
    })), pulses: Object.freeze(pulses.filter((p) => now - p.tick < p.duration).map((p) => {
      const age = now - p.tick;
      return Object.freeze({ id: p.id, kind: p.kind, arenaId: p.arenaId, x: p.x, y: p.y, layer: p.layer, elevation: p.elevation, alpha: 1 - age / p.duration, radius: p.radius * (0.4 + 0.6 * age / p.duration), ownerId: p.ownerId });
    })) });
  }
  return { update, sample, reset() {
    current = undefined;
    lastTick = -1;
    serials.clear();
    seen.clear();
    bladeMotion.clear();
    gateOpen.clear();
    transports.clear();
    particles = [];
    pulses = [];
    droppedParticles = 0;
    droppedPulses = 0;
    evictedEvents = 0;
  }, get stats() {
    return Object.freeze({ particles: particles.length, pulses: pulses.length, droppedParticles, droppedPulses, evictedEvents, eventHistory: seen.size, mechanisms: specs.length });
  } };
}

// packages/pinball-feedback/test/contact.test.ts
var fixtures = new URL("./fixtures/compact-apron-v4/", import.meta.url);
var read = (name2) => decodeArenaReplay(new Uint8Array(readFileSync(new URL(name2 + ".kpr", fixtures))));
function springFrames() {
  const tape = read("right-spring-0"), p = createArenaReplayPlayer(tape), frames = [p.readFrame()];
  for (let tick = 1;tick <= 373; tick++)
    frames.push(p.step());
  return { tape, previous: frames[372], frame: frames[373] };
}
test("actual v4 spring and target tapes preserve authority, sounds and mechanism poses while bursts use exact contact", () => {
  let springs = 0, targets = 0;
  for (const name2 of ["right-spring-0", "left-target-0"]) {
    const tape = read(name2), live = createArenaMatch(tape.world, { ...tape.options, players: tape.players }), replay = createArenaReplayPlayer(tape), feedback = createPinballFeedback(tape.world), old = createPinballFeedback2(tape.world);
    live.restore(tape.initialSnapshot);
    feedback.update(live.readFrame());
    old.update(live.readFrame());
    for (let i = 0;i < tape.ticks; i++) {
      const frame = live.step(tape.players.map((p, j) => ({ ownerId: p.ownerId, bits: tape.inputs[(i * tape.players.length + j) * 3] })));
      assert.deepEqual(replay.step(), frame);
      const snapshot = live.snapshot(), sounds = feedback.update(frame);
      assert.deepEqual(sounds, old.update(frame));
      const sample = feedback.sample(), before = old.sample();
      assert.deepEqual(sample.mechanisms, before.mechanisms);
      for (const event of frame.events) {
        if (event.type === "bumper" && event.colliderId === "compact22.spring") {
          const m = frame.mechanisms.find((m2) => m2.id === event.colliderId), id2 = m.id + ":" + m.activationSerial, pulse = sample.pulses.find((p) => p.id === id2);
          assert(pulse);
          assert.deepEqual([pulse.x, pulse.y, pulse.elevation], [event.x, event.y, event.elevation]);
          const particles = sample.particles.filter((p) => p.id.startsWith(id2 + ":"));
          assert(particles.length > 0);
          assert(particles.every((p) => p.x === event.x && p.y === event.y && p.elevation === event.elevation));
          assert.equal(sample.pulses.filter((p) => p.id === id2).length, 1);
          const pose = sample.mechanisms.find((p) => p.id === m.id), spec = tape.world.arenas[0].bumpers.find((b) => b.id === m.id);
          assert.deepEqual([pose.x, pose.y, pose.elevation], [spec.x, spec.y, spec.elevation]);
          assert.notDeepEqual([pulse.x, pulse.y], [pose.x, pose.y]);
          if (event.tick === 373) {
            assert.deepEqual([event.x, event.y, event.elevation], [1018.62890625, 1495.8759765625, 0]);
            springs++;
          }
        }
        if (event.type === "rail" && event.colliderId === "compact22.rebound-target") {
          assert(sounds.some((s) => s.id === event.id && s.name === "rail.ting"));
          assert(!sample.mechanisms.some((m) => m.id === event.colliderId), "no invented rail-target mechanism");
          targets++;
        }
      }
      const stats = feedback.stats;
      assert.deepEqual(feedback.update(frame), []);
      assert.deepEqual(feedback.sample(), sample);
      assert.deepEqual(feedback.stats, stats);
      assert.deepEqual(live.snapshot(), snapshot);
    }
    assert(replay.complete);
    assert.deepEqual(replay.snapshot(), live.snapshot());
    assert.equal(createHash("sha256").update(live.snapshot()).digest("hex"), tape.finalDigest);
  }
  assert(springs > 0 && targets > 0);
});
test("missing, stale, unrelated and malformed contact coordinates never fabricate a spring burst", () => {
  const { tape, previous, frame } = springFrames(), native = frame.events.find((e) => e.type === "bumper");
  const negatives = [["missing", () => null], ["stale", (e) => ({ ...e, tick: e.tick - 1 })], ["other-id", (e) => ({ ...e, colliderId: "compact22.rebound-target" })], ["contradictory-id", (e) => ({ ...e, mechanismId: "other" })], ["other-arena", (e) => ({ ...e, arenaId: "other" })], ["missing-arena", (e) => {
    const { arenaId: _a, ...rest } = e;
    return rest;
  }], ["missing-x", (e) => {
    const { x: _x, ...rest } = e;
    return rest;
  }], ["nan-y", (e) => ({ ...e, y: NaN })], ["infinite-height", (e) => ({ ...e, elevation: Infinity })], ["wrong-layer", (e) => ({ ...e, layer: 1 })]];
  for (const [name2, change] of negatives) {
    const feedback = createPinballFeedback(tape.world);
    feedback.update(previous);
    const replacement = change(native), altered = { ...frame, events: frame.events.flatMap((e) => e === native ? replacement ? [replacement] : [] : [e]) };
    feedback.update(altered);
    const sample = feedback.sample();
    assert(!sample.pulses.some((p) => p.id.startsWith("compact22.spring:")), name2);
    assert(!sample.particles.some((p) => p.id.startsWith("compact22.spring:")), name2);
    assert(sample.mechanisms.find((m) => m.id === "compact22.spring").pulse > 0, name2 + " keeps glow");
  }
});
test("one activation emits one contact burst despite duplicate contacts, while noncontact actuation retains center fallback", () => {
  const { tape, previous, frame } = springFrames(), native = frame.events.find((e) => e.type === "bumper"), m = frame.mechanisms.find((m2) => m2.id === "compact22.spring"), feedback = createPinballFeedback(tape.world);
  feedback.update(previous);
  feedback.update({ ...frame, events: [...frame.events, { ...native, id: native.id + ":duplicate", x: native.x + 20 }] });
  const sample = feedback.sample(), id2 = m.id + ":" + m.activationSerial;
  assert.equal(sample.pulses.filter((p) => p.id === id2).length, 1);
  assert.equal(sample.pulses.find((p) => p.id === id2).x, native.x);
  const match = createArenaMatch(tape.world, { ...tape.options, players: tape.players }), f = createPinballFeedback(tape.world);
  f.update(match.readFrame());
  const launched = match.step([{ ownerId: 0, bits: 4 }]);
  f.update(launched);
  const launch = launched.mechanisms.find((m2) => m2.kind === "plunger"), pulse = f.sample().pulses.find((p) => p.id === launch.id + ":" + launch.activationSerial), station = tape.world.arenas[0].stations[0];
  assert.deepEqual([pulse.x, pulse.y, pulse.elevation], [station.launchX, station.launchY, station.elevation]);
});
