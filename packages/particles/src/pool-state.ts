import type { EmitterRecipe } from "./recipe.ts";
import { h30, MAX_STYLES, STYLE_WIDTH } from "./pool-internal.ts";
import type { Compiled } from "./pool-internal.ts";
import type { ParticleHost, ParticlePoolOptions, ParticleSlots, ParticleStats } from "./pool-types.ts";

const F_SIZE = 48;

/** Everything a pool is: typed arrays, a few counters, the recipes. */
export class PoolState {
  readonly N: number;
  readonly E: number;
  readonly stats: ParticleStats;
  // Particles, by slot.
  readonly p0: Float64Array;
  readonly v0: Float64Array;
  readonly vinf: Float64Array;
  readonly tSeg: Float64Array;
  readonly tStop: Float64Array;
  readonly tBirth: Float64Array;
  readonly life: Float64Array;
  readonly tGround: Float64Array; // absolute time of its next ground event (Infinity: none)
  readonly tLive: Float64Array; // absolute time of its next live sub-emit (Infinity: none)
  readonly tEvent: Float64Array; // the soonest of its death, ground and live events (Infinity: a free slot)
  readonly style: Uint8Array;
  readonly rnd: Uint8Array;
  readonly lod: Uint8Array;
  readonly pseed: Uint32Array;
  readonly owner: Uint16Array;
  readonly flags: Uint8Array;
  readonly liveN: Uint16Array; // live sub-emits so far (keys the next one)
  count = 0;
  highWater = 0;
  readonly heap: Int32Array; // free slots, a min-heap: the lowest free slot comes out first
  heapSize: number;
  readonly changed: Uint8Array;
  readonly changes: Int32Array;
  changeCount = 0;
  allChanged = true;
  // Emitters: slots, a free stack, the running list.
  readonly eState: Uint8Array; // 0 free, 1 running, 2 draining (waiting for its particles to die)
  readonly eGen: Uint16Array;
  readonly eRecipe: Int32Array;
  readonly eUnit: Int32Array;
  readonly eSocket: (string | null)[];
  readonly eP: Float64Array;
  readonly ePrev: Float64Array;
  readonly eV: Float64Array;
  readonly eBaseV: Float64Array;
  readonly eF: Float64Array; // the located frame: position + 3×3
  readonly eDir: Float64Array;
  readonly eHasDir: Uint8Array;
  readonly eAge: Float64Array;
  readonly eDur: Float64Array; // (-1: until stopped)
  readonly eAcc: Float64Array;
  readonly eLodAcc: Float64Array;
  readonly eSpawn: Float64Array;
  readonly eKey: Uint32Array;
  readonly ePri: Uint8Array;
  readonly eScale: Float32Array;
  readonly eCount: Int32Array;
  readonly eLive: Int32Array;
  readonly eFresh: Uint8Array;
  readonly eFired: Uint8Array;
  readonly active: Int32Array;
  readonly activeAt: Int32Array;
  readonly free: Int32Array;
  activeCount = 0;
  freeTop: number;
  serial = 0;
  tick = 0;
  readonly key0: number;
  readonly wind: Float64Array;
  readonly scratch: Float64Array;
  readonly F: Float64Array;
  // The view: 0..3 its ground rectangle (x0, z0, x1, z1), 4..5 its centre, 6 "far" squared, 7 pixels per metre.
  readonly V: Float64Array;
  hasView = false;
  readonly limit: Int32Array; // live particles past which importance 0..3 stop spawning
  readonly usePressure: boolean;
  readonly host: ParticleHost | null;
  // Styles (one per recipe): the renderer's table and what the step reads.
  readonly styleData: Float32Array;
  readonly styleRamps: string[] = [];
  readonly sGrav: Float64Array;
  readonly sDrag: Float64Array;
  readonly sWind: Float64Array;
  readonly sCurl: Float64Array;
  readonly sGround: Uint8Array;
  readonly sBounce: Float64Array;
  readonly sFric: Float64Array;
  readonly sSub: Int32Array; // per trigger (death, ground, live): the recipe thrown, or -1
  readonly sSubC0: Float64Array;
  readonly sSubC1: Float64Array;
  readonly sSubRate: Float64Array;
  readonly sSubChance: Float64Array;
  readonly sSubInherit: Float64Array;
  readonly sSubRefs: (string | EmitterRecipe | null)[];
  readonly recipes: Compiled[] = [];
  readonly byName = new Map<string, number>();
  readonly names: string[] = [];
  readonly styles: { version: number; count: number; data: Float32Array; ramps: readonly string[] } = { version: 0, count: 0, data: new Float32Array(0), ramps: [] };
  readonly slots: ParticleSlots;

  constructor(N: number, E: number, o: ParticlePoolOptions) {
    this.N = N;
    this.E = E;
    const stats: ParticleStats = { spawned: 0, sub: 0, died: 0, bounced: 0, culled: 0, lod: 0, budget: 0, emitterBudget: 0, noEmitter: 0, growths: 0 };
    this.stats = stats;
    // (Every typed array the pool will ever have, counted: the tests hold this still.)
    const T = <A>(a: A): A => { stats.growths += 1; return a; };
    this.p0 = T(new Float64Array(N * 3));
    this.v0 = T(new Float64Array(N * 3));
    this.vinf = T(new Float64Array(N * 3));
    this.tSeg = T(new Float64Array(N));
    this.tStop = T(new Float64Array(N));
    this.tBirth = T(new Float64Array(N));
    this.life = T(new Float64Array(N));
    this.tGround = T(new Float64Array(N).fill(Infinity));
    this.tLive = T(new Float64Array(N).fill(Infinity));
    this.tEvent = T(new Float64Array(N).fill(Infinity));
    this.style = T(new Uint8Array(N));
    this.rnd = T(new Uint8Array(N));
    this.lod = T(new Uint8Array(N));
    this.pseed = T(new Uint32Array(N));
    this.owner = T(new Uint16Array(N));
    this.flags = T(new Uint8Array(N));
    this.liveN = T(new Uint16Array(N));
    this.heap = T(new Int32Array(N));
    for (let i = 0; i < N; i += 1) this.heap[i] = i; // (ascending: already a min-heap)
    this.heapSize = N;
    this.changed = T(new Uint8Array(N));
    this.changes = T(new Int32Array(N));
    this.eState = T(new Uint8Array(E));
    this.eGen = T(new Uint16Array(E));
    this.eRecipe = T(new Int32Array(E));
    this.eUnit = T(new Int32Array(E));
    this.eSocket = new Array<string | null>(E).fill(null);
    this.eP = T(new Float64Array(E * 3));
    this.ePrev = T(new Float64Array(E * 3));
    this.eV = T(new Float64Array(E * 3));
    this.eBaseV = T(new Float64Array(E * 3));
    this.eF = T(new Float64Array(E * 12));
    this.eDir = T(new Float64Array(E * 3));
    this.eHasDir = T(new Uint8Array(E));
    this.eAge = T(new Float64Array(E));
    this.eDur = T(new Float64Array(E));
    this.eAcc = T(new Float64Array(E));
    this.eLodAcc = T(new Float64Array(E));
    this.eSpawn = T(new Float64Array(E));
    this.eKey = T(new Uint32Array(E));
    this.ePri = T(new Uint8Array(E));
    this.eScale = T(new Float32Array(E));
    this.eCount = T(new Int32Array(E));
    this.eLive = T(new Int32Array(E));
    this.eFresh = T(new Uint8Array(E));
    this.eFired = T(new Uint8Array(E));
    this.active = T(new Int32Array(E));
    this.activeAt = T(new Int32Array(E));
    this.free = T(new Int32Array(E));
    for (let i = 0; i < E; i += 1) this.free[i] = E - 1 - i; // (slot 0 comes off first)
    this.freeTop = E;
    const seed = o.seed ?? 1;
    this.key0 = typeof seed === "number" ? h30((seed >>> 0) ^ 0x5eed) : (((Math.floor(seed.f() * 65536) << 14) ^ Math.floor(seed.f() * 65536)) & 0x3fffffff);
    this.wind = T(new Float64Array(3));
    this.scratch = T(new Float64Array(12));
    this.F = T(new Float64Array(F_SIZE));
    this.F[14] = o.minPixels ?? 1.5;
    this.F[15] = o.maxLod ?? 4;
    this.V = T(new Float64Array(8));
    const reserve = o.reserve ?? [0.55, 0.8, 0.95, 1];
    this.limit = T(new Int32Array(4));
    for (let q = 0; q < 4; q += 1) this.limit[q] = Math.floor(N * reserve[q]!);
    this.usePressure = o.pressure ?? true;
    this.host = o.host ?? null;
    this.styleData = T(new Float32Array(MAX_STYLES * STYLE_WIDTH * 4));
    this.styles.data = this.styleData;
    this.styles.ramps = this.styleRamps;
    this.sGrav = T(new Float64Array(MAX_STYLES));
    this.sDrag = T(new Float64Array(MAX_STYLES));
    this.sWind = T(new Float64Array(MAX_STYLES));
    this.sCurl = T(new Float64Array(MAX_STYLES));
    this.sGround = T(new Uint8Array(MAX_STYLES));
    this.sBounce = T(new Float64Array(MAX_STYLES));
    this.sFric = T(new Float64Array(MAX_STYLES));
    this.sSub = T(new Int32Array(MAX_STYLES * 3).fill(-1));
    this.sSubC0 = T(new Float64Array(MAX_STYLES * 3));
    this.sSubC1 = T(new Float64Array(MAX_STYLES * 3));
    this.sSubRate = T(new Float64Array(MAX_STYLES * 3));
    this.sSubChance = T(new Float64Array(MAX_STYLES * 3));
    this.sSubInherit = T(new Float64Array(MAX_STYLES * 3));
    this.sSubRefs = new Array<string | EmitterRecipe | null>(MAX_STYLES * 3).fill(null);
    this.slots = { p0: this.p0, v0: this.v0, vinf: this.vinf, tSeg: this.tSeg, tStop: this.tStop, tBirth: this.tBirth, life: this.life, style: this.style, rnd: this.rnd, lod: this.lod, owner: this.owner };
  }
}
