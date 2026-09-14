// Damage states: the smoke, fire, sparks and drips that say how hurt a building or a unit is, and the
// explosion or the body coming apart when it dies. Presentation only -- it never reads or writes game
// state; the game tells it each tick what each thing is (where, how hurt, what it's made of) and it only
// emits into a ParticlePool.
//
//   const damage = createDamageStates(pool);
//   // each game tick, for every building and unit on the map (reuse one object: set() copies what it needs):
//   damage.set(id, { x, y, z, hp01, material: "metal", kind: "building", size: 6 });
//   damage.set(id, { x, y, z, hp01, material: "organic", kind: "unit", size: 0.6, unit: id }); // follows via host.locate
//   damage.remove(id, "destroyed");   // the explosion / the death; "gone" just stops its emitters
//
// Buildings, read at a glance: clean above DAMAGE_STAGES.light; light damage below it (smoke-light from 2-3 roof
// points, damage-sparks shorting from 1-2, a few debris-bits -- or a material burst for organic and crystal);
// heavy below DAMAGE_STAGES.heavy (fire-damage from 3-5 points spread over the roof by size, a dense
// smoke-heavy column or two, debris-bits). Units:
// a burst by material every 1.5-3 s once lightly damaged (metal-sparks, bleed-drip, crystal-chips, a dust
// puff for stone), twice as often when heavy, and machine and stone ones trail smoke when heavy.
//
// A stage worsens the moment hp crosses its threshold; it improves (repair) only once hp is `band` past it and
// the stage has held for `settle` seconds -- so a value on a boundary doesn't flicker, and hp flapping about
// can't churn emitters faster than one change per `settle`. The clock is pool.time: deterministic with the pool.
//
// Cheap for hundreds of entities updated every tick: fixed typed arrays sized at creation, one reused emit
// options object, recipe ids resolved once; a set() that changes nothing is a map lookup and a few compares.
// At most MAX_DAMAGE_EMITTERS continuous emitters an entity (bursts are one-shot). The pool culls and LODs what
// they throw like anything else: nothing spawns off the picture.

import type { ParticleEmitOptions, ParticlePool } from "./pool.ts";
import { mix32 } from "./pool.ts";

export interface DamageStageThresholds {
  readonly light: number;
  readonly heavy: number;
  readonly band: number;
  readonly settle: number;
}

/** The stage thresholds (hp01) and the hysteresis: light damage below `light`, heavy below `heavy`. */
export const DAMAGE_STAGES: DamageStageThresholds = Object.freeze({
  /** Below this, stage 1 (light damage). */
  light: 0.66,
  /** Below this, stage 2 (heavy damage). */
  heavy: 0.33,
  /** A stage improves only once hp is this far back above its threshold. */
  band: 0.04,
  /** ...and the stage has held this many seconds (pool time). */
  settle: 0.5,
});

/** Continuous emitters one entity holds at most (a big building on fire: 5 fires, 2 smoke columns, debris). */
export const MAX_DAMAGE_EMITTERS = 8;

export type DamageMaterial = "metal" | "organic" | "crystal" | "stone";
export type DamageKind = "building" | "unit";

/** What a damaged thing is, this tick. */
export interface DamageState {
  /** Its anchor on the ground (metres). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Health, 0..1. */
  readonly hp01: number;
  readonly material: DamageMaterial;
  readonly kind: DamageKind;
  /** Metres: a building's footprint side, a unit's radius. */
  readonly size: number;
  /** A host id: continuous effects ride the unit through the pool's host.locate (else they're moved to x, y, z). */
  readonly unit?: number;
}

/** The effects the system emits, by role -> the pool recipe it uses (override any in the options). */
export interface DamageEffects {
  smokeLight: string; smokeHeavy: string; fire: string; debris: string; shorting: string; explosion: string; rubble: string;
  sparks: string; drip: string; chips: string; dust: string; trail: string;
  deathMetal: string; deathOrganic: string; deathCrystal: string; deathStone: string;
}

export const DAMAGE_EFFECTS: Readonly<DamageEffects> = Object.freeze({
  smokeLight: "smoke-light", smokeHeavy: "smoke-heavy", fire: "fire-damage", debris: "debris-bits", shorting: "damage-sparks", explosion: "explosion", rubble: "rubble-dust",
  sparks: "metal-sparks", drip: "bleed-drip", chips: "crystal-chips", dust: "dust-puff", trail: "smoke-trail",
  deathMetal: "death-collapse", deathOrganic: "death-burst", deathCrystal: "death-dissolve", deathStone: "death-collapse",
});

export interface DamageStatesOptions {
  /** Entities tracked at most (default 2048; a set() past it is dropped and counted). */
  readonly capacity?: number;
  /** Seeds the smoke points and burst intervals (default 1). */
  readonly seed?: number;
  /** Override the thresholds. */
  readonly stages?: Partial<DamageStageThresholds>;
  /** Override which recipe plays each role (the pool must have them all). */
  readonly effects?: Partial<DamageEffects>;
  /** A building's roof above its anchor, as a fraction of its size (default 0.5). */
  readonly roof?: number;
  /** A unit's body above its anchor, in radii (default 1). */
  readonly body?: number;
}

/** Counters: entities by stage now, the emitters held, and what happened. */
export interface DamageStats {
  entities: number;
  /** Stage 0, 1, 2 counts. */
  clean: number;
  light: number;
  heavy: number;
  /** Continuous emitter handles held (live in the pool, or draining after their unit left). */
  emitters: number;
  /** Material bursts thrown. */
  bursts: number;
  /** Deaths played (remove "destroyed"). */
  deaths: number;
  /** set() calls refused: at capacity. */
  dropped: number;
  /** Emits the pool refused (no emitter slot free; retried every half second). */
  missed: number;
}

export interface DamageStates {
  /** This tick's state of `id` (tracks it from the first call). Copies what it needs: reuse one object. */
  set(id: number, s: DamageState): void;
  /** It's gone: stop its emitters; "destroyed" plays its death first. */
  remove(id: number, how: "destroyed" | "gone"): void;
  /** Its stage: 0 clean, 1 light, 2 heavy; -1 when it isn't tracked. */
  stageOf(id: number): number;
  readonly stats: DamageStats;
  /** Stop everything and forget every entity. */
  clear(): void;
}

// Roles, as indices into the resolved recipe ids.
const R_SMOKE_LIGHT = 0, R_SMOKE_HEAVY = 1, R_FIRE = 2, R_DEBRIS = 3, R_EXPLOSION = 4, R_RUBBLE = 5, R_SPARKS = 6, R_DRIP = 7, R_CHIPS = 8, R_DUST = 9, R_TRAIL = 10;
const R_DEATH = 11; // + material
const R_SHORTING = 15;
const ROLES: readonly (keyof DamageEffects)[] = [
  "smokeLight", "smokeHeavy", "fire", "debris", "explosion", "rubble", "sparks", "drip", "chips", "dust", "trail", "deathMetal", "deathOrganic", "deathCrystal", "deathStone", "shorting",
];
const M_METAL = 0, M_ORGANIC = 1, M_CRYSTAL = 2, M_STONE = 3;
const K_BUILDING = 0, K_UNIT = 1;
const NONE = -1, MISSING = -2;
const ON_UNIT = 255; // (an emitter entry's point: on the unit itself)
/** A unit's smoke trail is scaled at most this much: it marks the unit, it mustn't smother the fight. */
const TRAIL_SCALE = 1.2;
const INV16 = 1 / 65535;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export function createDamageStates(pool: ParticlePool, options: DamageStatesOptions = {}): DamageStates {
  const N = options.capacity ?? 2048;
  if (!(N > 0 && Number.isInteger(N))) throw new RangeError("Damage states' capacity is a positive integer.");
  const T = { ...DAMAGE_STAGES, ...options.stages };
  if (!(T.heavy < T.light) || !(T.band >= 0) || !(T.settle >= 0)) throw new RangeError("Damage stages: heavy < light, band and settle >= 0.");
  const upLight = T.light + T.band, upHeavy = T.heavy + T.band;
  const effects = { ...DAMAGE_EFFECTS, ...options.effects };
  const rid = new Int32Array(ROLES.length);
  const missing: string[] = [];
  ROLES.forEach((role, k) => { const id = pool.recipeId(effects[role]); if (id < 0) missing.push(effects[role]); rid[k] = id; });
  if (missing.length) throw new RangeError(`Damage states need these particle recipes in the pool: ${[...new Set(missing)].join(", ")} (pass PRESETS).`);
  const roof = options.roof ?? 0.5;
  const body = options.body ?? 1;
  const key0 = mix32(((options.seed ?? 1) >>> 0) ^ 0xda3a6e);

  const E = MAX_DAMAGE_EMITTERS;
  const slotOf = new Map<number, number>();
  const sId = new Float64Array(N);
  const sKind = new Uint8Array(N);
  const sMat = new Uint8Array(N);
  const sStage = new Int8Array(N);
  const sX = new Float64Array(N), sY = new Float64Array(N), sZ = new Float64Array(N);
  const sSize = new Float64Array(N);
  const sUnit = new Float64Array(N);
  const sSince = new Float64Array(N); // pool time the stage was entered
  const sNext = new Float64Array(N); // pool time of the next material burst (Infinity: none)
  const sSerial = new Uint32Array(N); // bursts so far (keys the next interval)
  const sRetry = new Float64Array(N); // pool time a refused emit is tried again
  const sMissing = new Uint8Array(N);
  const sN = new Uint8Array(N); // emitter entries in use
  const hE = new Int32Array(N * E).fill(NONE); // handles (NONE, MISSING: refused, retried)
  const hR = new Int16Array(N * E); // role
  const hP = new Uint8Array(N * E); // roof point (0..4), or ON_UNIT
  const free = new Int32Array(N);
  let freeTop = N;
  for (let i = 0; i < N; i += 1) free[i] = N - 1 - i;

  const stats: DamageStats = { entities: 0, clean: 0, light: 0, heavy: 0, emitters: 0, bursts: 0, deaths: 0, dropped: 0, missed: 0 };
  // (One options object for every emit, rewritten in place: emit() reads it and keeps nothing.)
  const AT: Mutable<ParticleEmitOptions> = { scale: 1 };
  const ON: Mutable<ParticleEmitOptions> = { unit: 0, scale: 1 };
  // (A point's position, written here rather than returned: no doubles across calls.)
  const P = new Float64Array(3);

  const count = (stage: number, d: number) => { if (stage === 0) stats.clean += d; else if (stage === 1) stats.light += d; else stats.heavy += d; };
  /** A hash of entity i's id and a counter, 0..2^32-1. */
  const hash = (i: number, n: number): number => mix32((key0 ^ Math.imul(sId[i]! | 0, 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca77)) | 0);
  // (A building's effects stay readable at ~12 px/m however small it is: at least 0.8.)
  const scaleOf = (i: number): number => {
    const k = sKind[i] === K_BUILDING ? sSize[i]! / 3.5 : sSize[i]! / 0.5;
    const lo = sKind[i] === K_BUILDING ? 0.8 : 0.5, hi = sKind[i] === K_BUILDING ? 2 : 2.5;
    return k < lo ? lo : k > hi ? hi : k;
  };
  // Point k of entity i into P: a building's roof points -- 0 near the middle, the rest round it a golden angle
  // apart (so five fires spread over the roof, never in a clump), jittered by its id; a unit's body.
  const pointOf = (i: number, k: number) => {
    if (sKind[i] === K_UNIT) { P[0] = sX[i]!; P[1] = sY[i]! + sSize[i]! * body; P[2] = sZ[i]!; return; }
    const s = sSize[i]!;
    const h = hash(i, 0x100 + k);
    const r = k === 0 ? 0.08 * s * ((h >>> 16) * INV16) : s * (0.2 + 0.14 * ((h >>> 16) * INV16));
    const a = (hash(i, 0xa9) >>> 16) * INV16 * 6.283185307179586 + k * 2.399963229728653 + ((h & 0xffff) * INV16 - 0.5) * 0.6;
    P[0] = sX[i]! + Math.cos(a) * r;
    P[1] = sY[i]! + s * roof;
    P[2] = sZ[i]! + Math.sin(a) * r;
  };
  const burstRole = (i: number): number => {
    const m = sMat[i]!;
    if (sKind[i] === K_BUILDING) return m === M_ORGANIC ? R_DRIP : m === M_CRYSTAL ? R_CHIPS : -1; // (metal and stone buildings shed debris-bits)
    return m === M_METAL ? R_SPARKS : m === M_ORGANIC ? R_DRIP : m === M_CRYSTAL ? R_CHIPS : R_DUST;
  };

  function emitEntry(i: number, j: number) {
    const e = i * E + j;
    const p = hP[e]!;
    let h: number;
    const k = scaleOf(i);
    const scale = hR[e] === R_TRAIL && k > TRAIL_SCALE ? TRAIL_SCALE : k;
    if (p === ON_UNIT && sUnit[i]! >= 0) {
      ON.unit = sUnit[i]!;
      ON.scale = scale;
      h = pool.emit(rid[hR[e]!]!, 0, 0, 0, ON);
    } else {
      if (p === ON_UNIT) { P[0] = sX[i]!; P[1] = sY[i]!; P[2] = sZ[i]!; } else pointOf(i, p);
      AT.scale = scale;
      h = pool.emit(rid[hR[e]!]!, P[0]!, P[1]!, P[2]!, AT);
    }
    if (h < 0) { hE[e] = MISSING; sMissing[i] = sMissing[i]! + 1; stats.missed += 1; } else { hE[e] = h; stats.emitters += 1; }
  }
  const add = (i: number, role: number, point: number) => {
    const j = sN[i]!;
    if (j >= E) return;
    sN[i] = j + 1;
    hR[i * E + j] = role;
    hP[i * E + j] = point;
    emitEntry(i, j);
  };
  function stopAll(i: number) {
    const n = sN[i]!;
    for (let j = 0; j < n; j += 1) {
      const e = i * E + j;
      const h = hE[e]!;
      if (h >= 0) { pool.stop(h); stats.emitters -= 1; }
      hE[e] = NONE;
    }
    sN[i] = 0;
    sMissing[i] = 0;
  }
  // Start stage `stage`'s continuous emitters for entity i.
  function startStage(i: number, stage: number) {
    if (stage === 0) return;
    const m = sMat[i]!;
    const hard = m === M_METAL || m === M_STONE;
    if (sKind[i] === K_BUILDING) {
      const s = sSize[i]!;
      if (stage === 1) {
        // Smoke from 2-3 points; machine and stone ones short out (sparks from 1-2) and shed a few bits.
        const smokes = s < 3 ? 2 : 3;
        for (let k = 0; k < smokes; k += 1) add(i, R_SMOKE_LIGHT, k);
        if (hard) {
          add(i, R_SHORTING, 1);
          if (s >= 4) add(i, R_SHORTING, 2);
          add(i, R_DEBRIS, 0);
        }
      } else {
        // Fire from 3-5 points spread over the roof; a dense column (two on a big one) from the middle.
        const fires = s < 3 ? 3 : s < 5 ? 4 : 5;
        for (let k = 0; k < fires; k += 1) add(i, R_FIRE, k);
        add(i, R_SMOKE_HEAVY, 0);
        if (s >= 4) add(i, R_SMOKE_HEAVY, 1);
        if (hard) add(i, R_DEBRIS, 2);
      }
    } else if (stage === 2 && hard) add(i, R_TRAIL, ON_UNIT);
  }
  const interval = (i: number): number => {
    const n = sSerial[i]!;
    sSerial[i] = n + 1;
    return (1.5 + 1.5 * (hash(i, n) >>> 16) * INV16) * (sStage[i] === 2 ? 0.5 : 1);
  };

  function burst(i: number, role: number) {
    pointOf(i, 0);
    AT.scale = role === R_DUST ? scaleOf(i) * 0.5 : scaleOf(i);
    pool.emit(rid[role]!, P[0]!, P[1]!, P[2]!, AT);
    stats.bursts += 1;
  }

  const api: DamageStates = {
    stats,
    set(id, s) {
      let i = slotOf.get(id);
      const kind = s.kind === "unit" ? K_UNIT : K_BUILDING;
      const mt = s.material;
      const mat = mt === "organic" ? M_ORGANIC : mt === "crystal" ? M_CRYSTAL : mt === "stone" ? M_STONE : M_METAL;
      const unit = s.unit ?? -1;
      const x = s.x, y = s.y, z = s.z, hp = s.hp01, size = s.size;
      const now = pool.time;
      let restart = false;
      let moved = false;
      if (i === undefined) {
        if (freeTop === 0) { stats.dropped += 1; return; }
        freeTop -= 1;
        i = free[freeTop]!;
        slotOf.set(id, i);
        sId[i] = id; sStage[i] = 0; sN[i] = 0; sMissing[i] = 0; sSerial[i] = 0; sNext[i] = Infinity; sSince[i] = now; sRetry[i] = 0;
        sKind[i] = kind; sMat[i] = mat; sUnit[i] = unit; sSize[i] = size;
        sX[i] = x; sY[i] = y; sZ[i] = z;
        stats.entities += 1;
        stats.clean += 1;
      } else {
        if (sKind[i] !== kind || sMat[i] !== mat || sUnit[i] !== unit || sSize[i] !== size) {
          sKind[i] = kind; sMat[i] = mat; sUnit[i] = unit; sSize[i] = size;
          restart = true;
        }
        if (sX[i] !== x || sY[i] !== y || sZ[i] !== z) { sX[i] = x; sY[i] = y; sZ[i] = z; moved = true; }
      }
      // The stage: worse at once; better past the band, once it has settled.
      const prev = sStage[i]!;
      let st = prev;
      if (hp < T.heavy) st = 2;
      else if (hp < T.light) { if (st === 0 || (st === 2 && hp >= upHeavy)) st = 1; }
      else if (st === 2) st = hp >= upLight ? 0 : hp >= upHeavy ? 1 : 2;
      else if (st === 1 && hp >= upLight) st = 0;
      if (st < prev && now - sSince[i]! < T.settle) st = prev;
      if (st !== prev) {
        count(prev, -1); count(st, 1);
        sStage[i] = st;
        sSince[i] = now;
        restart = true;
      }
      if (restart) {
        stopAll(i);
        startStage(i, st);
        // (The first burst staggered by the id: a volley's victims don't spark in step. A burst already due keeps its time.)
        if (st === 0 || burstRole(i) < 0) sNext[i] = Infinity;
        else if (sNext[i] === Infinity) sNext[i] = now + 0.2 + 1.3 * (hash(i, 0xb0) >>> 16) * INV16;
      } else {
        const n = sN[i]!;
        if (moved) {
          // (Follow the anchor: world-point emitters; those on a unit ride the host.)
          for (let j = 0; j < n; j += 1) {
            const e = i * E + j;
            const h = hE[e]!;
            if (h < 0 || (hP[e] === ON_UNIT && unit >= 0)) continue;
            if (hP[e] === ON_UNIT) { P[0] = x; P[1] = y; P[2] = z; } else pointOf(i, hP[e]!);
            pool.move(h, P[0]!, P[1]!, P[2]!);
          }
        }
        if (sMissing[i]! > 0 && now >= sRetry[i]!) {
          sRetry[i] = now + 0.5;
          sMissing[i] = 0;
          for (let j = 0; j < n; j += 1) if (hE[i * E + j] === MISSING) emitEntry(i, j);
        }
      }
      if (st > 0 && now >= sNext[i]!) {
        burst(i, burstRole(i));
        sNext[i] = now + interval(i);
      }
    },
    remove(id, how) {
      const i = slotOf.get(id);
      if (i === undefined) return;
      stopAll(i);
      if (how === "destroyed") {
        const m = sMat[i]!;
        if (sKind[i] === K_BUILDING) {
          const s = sSize[i]!;
          const k = s / 3;
          AT.scale = k < 0.8 ? 0.8 : k > 2.5 ? 2.5 : k;
          pool.emit(rid[R_EXPLOSION]!, sX[i]!, sY[i]! + s * roof * 0.5, sZ[i]!, AT);
          const r = s / 4;
          AT.scale = r < 0.7 ? 0.7 : r > 2 ? 2 : r;
          pool.emit(rid[R_RUBBLE]!, sX[i]!, sY[i]!, sZ[i]!, AT);
          // (A living or crystal building comes apart as its body does, too.)
          if (m === M_ORGANIC || m === M_CRYSTAL) pool.emit(rid[R_DEATH + m]!, sX[i]!, sY[i]! + s * roof * 0.3, sZ[i]!, AT);
        } else {
          AT.scale = scaleOf(i);
          pool.emit(rid[R_DEATH + m]!, sX[i]!, sY[i]! + sSize[i]! * 0.3, sZ[i]!, AT);
        }
        stats.deaths += 1;
      }
      count(sStage[i]!, -1);
      stats.entities -= 1;
      slotOf.delete(id);
      free[freeTop] = i;
      freeTop += 1;
    },
    stageOf(id) { const i = slotOf.get(id); return i === undefined ? -1 : sStage[i]!; },
    clear() {
      for (const i of slotOf.values()) { stopAll(i); }
      slotOf.clear();
      freeTop = N;
      for (let i = 0; i < N; i += 1) free[i] = N - 1 - i;
      stats.entities = 0; stats.clean = 0; stats.light = 0; stats.heavy = 0; stats.emitters = 0;
    },
  };
  return api;
}
