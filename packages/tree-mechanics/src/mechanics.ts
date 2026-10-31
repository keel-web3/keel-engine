// Tree mechanics over a branch graph. A tree is limbs: chains of internodes
// of one branch order, each growing from a node of its parent limb. Every
// limb bends in one mode (Rayleigh–Ritz): its internodes turn in proportion
// to their compliance under the load the limb carries (moment × length ÷ EI,
// the beam law), so a limb gives most where it is thin and far from its base.
// The mode's stiffness and inertia come from the wood and leaves it really
// carries; its frequency is the beam law's, pressed into the band trees are
// seen to sway in (a trunk breathes at well under a hertz, a twig flickers at
// a few). Limbs ride on their parents' motion and lag behind it, so a gust
// rolls out through the crown from trunk to twig.
//
// Forces are real ones: drag (½ρC·A·v|v|) on wood and leaves, leaves folding
// away in strong wind; the weight of snow on whatever catches it; animals'
// weight where they sit. Stress at each joint is the bending moment over the
// section modulus (πr³/4); wood that is dead, rotten or knotted is weaker, and
// a joint whose stress passes its strength breaks. The piece falls, tumbling,
// lands on the ground and, after a while, rots away.

/** The branch graph: what grows from what. Keel tree models (`keel/tree-growth`) fit as they are. */
export interface TreeShape {
  readonly count: number;
  /** Each internode's parent, −1 for the root; parents come before their children. */
  readonly parent: ArrayLike<number>;
  /** Branch order: 0 the trunk, 1 its limbs, 2 theirs. */
  readonly order: ArrayLike<number>;
  /** Leaf places by the node each grows on; without them every living tip carries `leafPerTip` leaves. */
  readonly leaves?: { readonly count: number; readonly node: ArrayLike<number>; readonly size?: ArrayLike<number> } | undefined;
}

/** One moment of the tree, as `keel/tree-growth`'s `treeFrame` poses it. Positions in metres. */
export interface TreePose {
  readonly grow: ArrayLike<number>;
  readonly radius: ArrayLike<number>;
  readonly dead: ArrayLike<number>;
  readonly fall: ArrayLike<number>;
  readonly rot: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly z: ArrayLike<number>;
  readonly baseX: ArrayLike<number>;
  readonly baseY: ArrayLike<number>;
  readonly baseZ: ArrayLike<number>;
}

/** The pose as moved: positions, and the fall and rot of what broke off, written fresh; everything else is the input's. */
export type MovedPose<P extends TreePose> = Omit<P, "x" | "y" | "z" | "baseX" | "baseY" | "baseZ" | "fall" | "rot"> & {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly baseX: Float32Array;
  readonly baseY: Float32Array;
  readonly baseZ: Float32Array;
  readonly fall: Float32Array;
  readonly rot: Float32Array;
};

/** Weight resting on the tree at a node's end (an animal on a branch), in kilograms. */
export interface TreeLoad {
  readonly node: number;
  readonly mass: number;
}

/** What acts on the tree this step. */
export interface TreeForces {
  /** Seconds, for gusts and buffeting. */
  readonly elapsed: number;
  /** Seconds since the last step. */
  readonly dt: number;
  /** The wind as a share of `gale`: 0 still, 1 a gale. */
  readonly wind: number;
  /** The way the wind blows toward, in radians from +x toward +z. */
  readonly dir?: number | undefined;
  /** 0..1, how deep snow lies on the wood and leaves. */
  readonly snow?: number | undefined;
  /** 0..1, how much of its foliage the tree has on (bare in winter, full in summer). */
  readonly foliage?: number | undefined;
  readonly loads?: readonly TreeLoad[] | undefined;
}

export interface WoodSpec {
  /** Green wood, kg/m³. */
  readonly density: number;
  /** Elastic modulus, Pa: it sets how the bend shares out along a limb and each limb's frequency. */
  readonly stiffness: number;
  /** Bending strength (modulus of rupture), Pa, as a tree drawn at this scale holds up. */
  readonly strength: number;
  /** Dead wood's share of that strength. */
  readonly deadStrength: number;
}

export interface MechanicsOptions {
  readonly wood?: Partial<WoodSpec> | undefined;
  /** Wind speed at `wind` 1, m/s. */
  readonly gale?: number | undefined;
  /** Drag coefficient of wood and leaves. */
  readonly drag?: number | undefined;
  /** One leaf's area, m², and mass, kg. */
  readonly leafArea?: number | undefined;
  readonly leafMass?: number | undefined;
  /** Leaves on a living tip when the shape has no leaf places. */
  readonly leafPerTip?: number | undefined;
  /** The band limbs sway in, Hz: [slowest, quickest]. */
  readonly band?: readonly [number, number] | undefined;
  /** Damping ratio of bare wood; leaves add to it. */
  readonly damping?: number | undefined;
  /** The furthest a limb bends from rest, radians. */
  readonly maxBend?: number | undefined;
  /** How much further everything bends than the sway band alone allows: 1 as it is, 2 twice the give. */
  readonly pliancy?: number | undefined;
  /** Dead wood's share of a sound limb's stiffness; rot takes more. */
  readonly limp?: number | undefined;
  /** How fast a strained limb takes a lasting set, per second: 0 springs back whole. */
  readonly creep?: number | undefined;
  /** Fresh snow's depth at `snow` 1 (m) and density (kg/m³). */
  readonly snowDepth?: number | undefined;
  readonly snowDensity?: number | undefined;
  /** World y of the ground broken limbs land on, and how far from the trunk they may come to rest. */
  readonly ground?: number | undefined;
  readonly groundRadius?: number | undefined;
  /** Storm breaks: off, or how they go. */
  readonly breaks?: false | BreakOptions | undefined;
  readonly seed?: number | undefined;
}

export interface BreakOptions {
  /** Wood thicker than this share of the trunk never breaks (nor the trunk itself). */
  readonly protect?: number | undefined;
  /** Seconds between breaks, so a storm takes a limb at a time. */
  readonly cooldown?: number | undefined;
  /** Breaks the tree takes before it holds on to everything left. */
  readonly most?: number | undefined;
  /** Seconds a fallen piece lies before it rots away, and how long the rotting takes. */
  readonly lieFor?: number | undefined;
  readonly rotFor?: number | undefined;
  /** Whether the live wind breaks wood; off when every break is struck with `storm()`. */
  readonly live?: boolean | undefined;
}

export interface StormStrike {
  /** The swing a gust adds to where the wind alone holds a limb (default 1.3). */
  readonly gust?: number | undefined;
  /** The storm's own seed, for which over-strained joints hold. */
  readonly seed?: number | undefined;
}

export type BreakCause = "wind" | "snow" | "load";

export interface TreeBreak {
  /** The internode that snapped; it and all that grew from it came down. */
  readonly node: number;
  readonly at: number;
  readonly cause: BreakCause;
  readonly radius: number;
  /** Where it snapped. */
  readonly p: readonly [number, number, number];
  /** Internodes that came down with it. */
  readonly pieces: number;
}

/** A piece of wood an animal can stand on or climb, as posed this step. */
export interface WoodCapsule {
  readonly node: number;
  readonly parent: number;
  readonly order: number;
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly r: number;
  /** The weight, kg, that this wood and everything it grows from bear at its end without breaking (with a margin). */
  readonly carry: number;
}

/** A point along wood and its radius. */
export interface WoodPoint {
  readonly p: readonly [number, number, number];
  readonly r: number;
}

export interface TreeMechanics {
  /** Steps the tree under `forces` and returns `frame` as it moves. The same object comes back for the same frame. */
  update<P extends TreePose>(frame: P, forces: TreeForces): MovedPose<P>;
  /** The breaks so far, oldest first. */
  readonly breaks: readonly TreeBreak[];
  /** Climbable wood at least `minRadius` thick, as posed by the last update. */
  capsules(minRadius?: number): WoodCapsule[];
  /** The wood from the trunk's foot out to a node's end, as posed by the last update. */
  woodPath(node: number): WoodPoint[];
  /** What a node's end can carry, kg. */
  carry(node: number): number;
  /** A node's limb: the first internode of the chain it belongs to. */
  limbOf(node: number): number;
  /** The frequency the node's limb sways at, Hz. */
  frequency(node: number): number;
  /** How near a node's joint is to breaking this step: stress over strength. */
  strain(node: number): number;
  /**
   * Strikes the tree with a storm's peak all at once: `forces.wind` blowing steady at `forces.elapsed`,
   * the limbs bent where it would hold them times `gust` (the swing a gust adds), and all that breaks
   * comes down there and then, as a live break does. A gust does not catch every limb at its worst, so
   * a joint only just past its strength often holds and one far past it nearly always goes, drawn from
   * `how.seed` (one per storm). For a storm the tree went through while nobody watched; the limbs are
   * left at rest. Returns the storm's breaks.
   */
  storm<P extends TreePose>(frame: P, forces: TreeForces, how?: StormStrike): TreeBreak[];
  /** Mend every break and let the limbs settle from rest. */
  heal(): void;
}

const AIR = 1.225;
const GRAVITY = 9.81;
const TAU = Math.PI * 2;

const DEFAULT_WOOD: WoodSpec = { density: 850, stiffness: 8e9, strength: 2.6e6, deadStrength: 0.15 };

const at = (array: ArrayLike<number>, index: number): number => array[index] ?? 0;
const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

function hash(seed: number, index: number): number {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** How strongly a gust is passing over a point `along` the wind: fronts roll through from upwind. */
export function gustAt(elapsed: number, along: number): number {
  const front = elapsed * 0.5 - along * 0.22;
  return Math.max(0, Math.sin(front) * Math.sin(front * 0.43 + 1.7)) ** 2;
}

/** Writes the rotation by vector (θx, θy, θz) (axis × angle) into m at o, row-major. */
function rotation(m: Float32Array, o: number, tx: number, ty: number, tz: number): void {
  const angle = Math.hypot(tx, ty, tz);
  if (angle < 1e-9) {
    m[o] = 1; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0; m[o + 4] = 1; m[o + 5] = 0; m[o + 6] = 0; m[o + 7] = 0; m[o + 8] = 1;
    return;
  }
  const x = tx / angle, y = ty / angle, z = tz / angle;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  m[o] = t * x * x + c; m[o + 1] = t * x * y - s * z; m[o + 2] = t * x * z + s * y;
  m[o + 3] = t * x * y + s * z; m[o + 4] = t * y * y + c; m[o + 5] = t * y * z - s * x;
  m[o + 6] = t * x * z - s * y; m[o + 7] = t * y * z + s * x; m[o + 8] = t * z * z + c;
}

/** out[o] = a[ao] × b[bo] for 3 × 3 row-major matrices (out may not alias). */
function multiply(out: Float32Array, o: number, a: Float32Array, ao: number, b: Float32Array, bo: number): void {
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[o + r * 3 + c] = (a[ao + r * 3] ?? 0) * (b[bo + c] ?? 0) + (a[ao + r * 3 + 1] ?? 0) * (b[bo + 3 + c] ?? 0) + (a[ao + r * 3 + 2] ?? 0) * (b[bo + 6 + c] ?? 0);
    }
  }
}

interface Piece {
  readonly root: number;
  readonly nodes: Int32Array;
  /** Posed positions when it broke: x, y, z, baseX, baseY, baseZ per node. */
  readonly rest: Float32Array;
  readonly pivot: readonly [number, number, number];
  readonly axis: readonly [number, number, number];
  readonly drift: readonly [number, number];
  readonly at: number;
  /** Seconds into the fall it landed, and how far it was lifted to rest on the ground. */
  landed: number;
  /** Seconds after the break it first touched down, and how steeply it stood then: it topples until it lies flat. */
  touched: number;
  flat: number;
  lift: number;
}

interface Limbs {
  readonly count: number;
  /** Per node: its limb, its share of the limb's bend, its share summed from the limb's base. */
  readonly limb: Int32Array;
  readonly share: Float32Array;
  readonly upto: Float32Array;
  /** Per limb: base node, parent limb, the parent's bend share where it grows from, stiffness, inertia, damping, frequency. */
  readonly base: Int32Array;
  readonly parentLimb: Int32Array;
  readonly attach: Float32Array;
  readonly stiffness: Float64Array;
  /** How sound each limb is: 1 whole, less as it dies and rots. */
  readonly firm: Float64Array;
  readonly inertia: Float64Array;
  readonly damping: Float64Array;
  readonly frequency: Float32Array;
  /** A phase per limb for its own buffeting. */
  readonly phase: Float32Array;
}

export function createTreeMechanics(shape: TreeShape, options: MechanicsOptions = {}): TreeMechanics {
  const n = shape.count;
  const wood: WoodSpec = { ...DEFAULT_WOOD, ...options.wood };
  const gale = options.gale ?? 18;
  const drag = options.drag ?? 0.35;
  const leafArea = options.leafArea ?? 0.012;
  const leafMass = options.leafMass ?? 0.004;
  const leafPerTip = options.leafPerTip ?? 8;
  const [slowest, quickest] = options.band ?? [0.28, 3.2];
  const damping = options.damping ?? 0.07;
  const maxBend = options.maxBend ?? 0.6;
  const pliancy = Math.max(options.pliancy ?? 1, 1e-3);
  const limp = options.limp ?? 0.5;
  const creep = options.creep ?? 0;
  const snowDepth = options.snowDepth ?? 0.06;
  const snowDensity = options.snowDensity ?? 160;
  const ground = options.ground ?? 0;
  const groundRadius = options.groundRadius ?? Infinity;
  const breakOptions = options.breaks === false ? null : (options.breaks ?? {});
  const protect = breakOptions?.protect ?? 0.45;
  const cooldown = breakOptions?.cooldown ?? 3;
  const most = breakOptions?.most ?? 16;
  const lieFor = breakOptions?.lieFor ?? 120;
  const rotFor = Math.max(breakOptions?.rotFor ?? 30, 1e-6);
  const liveBreaks = breakOptions?.live ?? true;
  const seed = options.seed ?? 1;

  // Leaves per node, as summed leaf size² (a bigger leaf has more area).
  const leafWeight = new Float32Array(n);
  if (shape.leaves) {
    for (let i = 0; i < shape.leaves.count; i += 1) {
      const node = at(shape.leaves.node, i);
      const size = shape.leaves.size ? at(shape.leaves.size, i) : 1;
      if (node >= 0 && node < n) leafWeight[node] = (leafWeight[node] ?? 0) + size * size;
    }
  }
  const knot = Float32Array.from({ length: n }, (_, node) => 0.75 + 0.5 * hash(seed, node));

  // Rest geometry, read from the frame each rebuild.
  const bx = new Float64Array(n), by = new Float64Array(n), bz = new Float64Array(n);
  const ex = new Float64Array(n), ey = new Float64Array(n), ez = new Float64Array(n);
  const length = new Float64Array(n), radius = new Float64Array(n);
  const alive = new Uint8Array(n);
  /** Broken off, with everything grown from it. */
  const cut = new Uint8Array(n);
  const mass = new Float64Array(n), leafAt = new Float64Array(n), strength = new Float64Array(n), carryAt = new Float32Array(n);
  let limbs: Limbs | null = null;
  let height = 1;
  let trunkRadius = 0.1;
  let builtFoliage = -1;

  // Motion state per limb, kept across rebuilds by the limb's base node.
  /** The bend each limb has taken for good, which it now springs about. */
  let setX: Float64Array = new Float64Array(0), setZ: Float64Array = new Float64Array(0);
  let phiX: Float64Array = new Float64Array(0), phiZ: Float64Array = new Float64Array(0), velX: Float64Array = new Float64Array(0), velZ: Float64Array = new Float64Array(0), accX: Float64Array = new Float64Array(0), accZ: Float64Array = new Float64Array(0);
  let staticX: Float64Array = new Float64Array(0), staticZ: Float64Array = new Float64Array(0);

  // Per-step sums: force and moment about the origin carried by each subtree, and the gravity share of them.
  const fx = new Float64Array(n), fy = new Float64Array(n), fz = new Float64Array(n);
  const mx = new Float64Array(n), mz = new Float64Array(n);
  const gx = new Float64Array(n), gz = new Float64Array(n), gfy = new Float64Array(n);
  const strainAt = new Float32Array(n);
  const profileAt = new Float32Array(n);
  let buffetAlong: Float64Array = new Float64Array(0), buffetAcross: Float64Array = new Float64Array(0), genX: Float64Array = new Float64Array(0), genZ: Float64Array = new Float64Array(0);

  const rot = new Float32Array(n * 9);
  const scratch = new Float32Array(9);
  const pieces: Piece[] = [];
  const breaks: TreeBreak[] = [];
  let lastBreak = -Infinity;
  let lastFrame: TreePose | null = null;
  let out: MovedPose<TreePose> | null = null;
  /** A struck storm: the wind steady, no gust fronts or buffeting, and no breaks checked by the step. */
  let steady = false;

  function rebuild(frame: TreePose, foliage: number): void {
    height = 1;
    trunkRadius = Math.max(at(frame.radius, 0), 1e-3);
    for (let k = 0; k < n; k += 1) {
      bx[k] = at(frame.baseX, k); by[k] = at(frame.baseY, k); bz[k] = at(frame.baseZ, k);
      ex[k] = at(frame.x, k); ey[k] = at(frame.y, k); ez[k] = at(frame.z, k);
      length[k] = Math.hypot(ex[k]! - bx[k]!, ey[k]! - by[k]!, ez[k]! - bz[k]!);
      radius[k] = Math.max(at(frame.radius, k), 0.004);
      const parent = at(shape.parent, k);
      if (parent >= 0 && cut[parent]) cut[k] = 1;
      alive[k] = at(frame.grow, k) > 0.02 && at(frame.rot, k) < 1 && at(frame.fall, k) <= 0 && !cut[k] ? 1 : 0;
      if (alive[k]) height = Math.max(height, ey[k]!);
    }
    // Leaves: the shape's places, or a tuft on every living tip.
    if (!shape.leaves) {
      leafWeight.fill(0);
      const hasChild = new Uint8Array(n);
      for (let k = 1; k < n; k += 1) if (alive[k]) hasChild[at(shape.parent, k)] = 1;
      for (let k = 0; k < n; k += 1) if (alive[k] && !hasChild[k]) leafWeight[k] = leafPerTip;
    }
    for (let k = 0; k < n; k += 1) {
      const r = radius[k]!;
      // Dead wood is bare, whatever leaf places it once had.
      leafAt[k] = alive[k] && at(frame.dead, k) < 0.5 ? leafWeight[k]! : 0;
      mass[k] = alive[k] ? wood.density * Math.PI * r * r * length[k]! * Math.min(1, at(frame.grow, k) + 0.1) + leafMass * leafAt[k]! * foliage : 0;
      strength[k] = wood.strength * (1 - (1 - wood.deadStrength) * clamp(at(frame.dead, k), 0, 1)) * (1 - 0.8 * clamp(at(frame.rot, k), 0, 1)) * knot[k]! * (Math.PI * r * r * r) / 4;
    }
    builtFoliage = foliage;
    const next = buildLimbs(frame, foliage);
    // Keep each limb's motion where its base node is unchanged.
    const keep = (old: Float64Array, fresh: Float64Array): Float64Array => {
      if (limbs) for (let l = 0; l < next.count; l += 1) {
        const before = at(limbs.limb, at(next.base, l));
        if (before >= 0 && at(limbs.base, before) === at(next.base, l)) fresh[l] = old[before] ?? 0;
      }
      return fresh;
    };
    phiX = keep(phiX, new Float64Array(next.count)); phiZ = keep(phiZ, new Float64Array(next.count));
    velX = keep(velX, new Float64Array(next.count)); velZ = keep(velZ, new Float64Array(next.count));
    setX = keep(setX, new Float64Array(next.count)); setZ = keep(setZ, new Float64Array(next.count));
    accX = new Float64Array(next.count); accZ = new Float64Array(next.count);
    staticX = new Float64Array(next.count); staticZ = new Float64Array(next.count);
    buffetAlong = new Float64Array(next.count); buffetAcross = new Float64Array(next.count);
    genX = new Float64Array(next.count); genZ = new Float64Array(next.count);
    for (let k = 0; k < n; k += 1) profileAt[k] = clamp((Math.max((by[k]! + ey[k]!) * 0.5, 0.3) / height) ** 0.25, 0.45, 1.15);
    limbs = next;
    buildCarry();
  }

  function buildLimbs(frame: TreePose, foliage: number): Limbs {
    const limb = new Int32Array(n).fill(-1);
    const continued = new Uint8Array(n);
    const bases: number[] = [];
    for (let k = 0; k < n; k += 1) {
      const parent = at(shape.parent, k);
      if (parent >= 0 && at(shape.order, k) === at(shape.order, parent) && !continued[parent] && at(limb, parent) >= 0) {
        continued[parent] = 1;
        limb[k] = at(limb, parent);
      } else {
        limb[k] = bases.length;
        bases.push(k);
      }
    }
    const count = bases.length;
    // The load each joint's bend answers to: the area beyond it times the reach to that area's middle.
    const area = new Float64Array(n), ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n);
    for (let k = 0; k < n; k += 1) {
      if (!alive[k]) continue;
      const own = 2 * radius[k]! * length[k]! + leafArea * leafAt[k]! * Math.max(foliage, 0.3);
      area[k] = own;
      ax[k] = own * (bx[k]! + ex[k]!) * 0.5; ay[k] = own * (by[k]! + ey[k]!) * 0.5; az[k] = own * (bz[k]! + ez[k]!) * 0.5;
    }
    for (let k = n - 1; k > 0; k -= 1) {
      const parent = at(shape.parent, k);
      if (parent < 0) continue;
      area[parent] = area[parent]! + area[k]!; ax[parent] = ax[parent]! + ax[k]!; ay[parent] = ay[parent]! + ay[k]!; az[parent] = az[parent]! + az[k]!;
    }
    const compliance = new Float64Array(n);
    const total = new Float64Array(count);
    for (let k = 0; k < n; k += 1) {
      if (!alive[k] || area[k]! <= 0) continue;
      const reach = Math.hypot(ax[k]! / area[k]! - bx[k]!, ay[k]! / area[k]! - by[k]!, az[k]! / area[k]! - bz[k]!);
      const r = radius[k]!;
      compliance[k] = (area[k]! * reach * Math.max(length[k]!, 1e-3)) / (wood.stiffness * Math.PI * r ** 4 / 4);
      total[limb[k]!] = total[limb[k]!]! + compliance[k]!;
    }
    const share = new Float32Array(n), upto = new Float32Array(n);
    const kPhys = new Float64Array(count);
    for (let k = 0; k < n; k += 1) {
      const l = limb[k]!;
      const s = total[l]! > 0 ? compliance[k]! / total[l]! : 0;
      share[k] = s;
      const parent = at(shape.parent, k);
      upto[k] = (parent >= 0 && limb[parent] === l ? upto[parent]! : 0) + s;
      const r = radius[k]!;
      if (s > 0) kPhys[l] = kPhys[l]! + ((wood.stiffness * Math.PI * r ** 4) / 4 / Math.max(length[k]!, 1e-3)) * s * s;
    }
    // Inertia of each limb's mode: every mass beyond it, moving as the limb's bend carries it.
    const inertia = new Float64Array(count);
    for (let p = 0; p < n; p += 1) {
      if (!alive[p] || mass[p]! <= 0) continue;
      const px = (bx[p]! + ex[p]!) * 0.5, py = (by[p]! + ey[p]!) * 0.5, pz = (bz[p]! + ez[p]!) * 0.5;
      let vx = 0, vy = 0, vz = 0;
      let current = limb[p]!;
      for (let q = p; q >= 0; q = at(shape.parent, q)) {
        if (limb[q] !== current) {
          inertia[current] = inertia[current]! + mass[p]! * (vy * vy + 0.5 * (vx * vx + vz * vz));
          vx = 0; vy = 0; vz = 0;
          current = limb[q]!;
        }
        const s = share[q]!;
        vx += s * (px - bx[q]!); vy += s * (py - by[q]!); vz += s * (pz - bz[q]!);
      }
      inertia[current] = inertia[current]! + mass[p]! * (vy * vy + 0.5 * (vx * vx + vz * vz));
    }
    const base = Int32Array.from(bases);
    const parentLimb = new Int32Array(count).fill(-1);
    const attach = new Float32Array(count);
    const stiffness = new Float64Array(count), damp = new Float64Array(count), frequency = new Float32Array(count), firm = new Float64Array(count);
    const leafy = new Float64Array(count), woody = new Float64Array(count);
    const sound = new Float64Array(count);
    for (let k = 0; k < n; k += 1) {
      if (!alive[k]) continue;
      sound[limb[k]!] = sound[limb[k]!]! + share[k]! * (1 - (1 - limp) * clamp(at(frame.dead, k), 0, 1)) * (1 - 0.6 * clamp(at(frame.rot, k), 0, 1));
      leafy[limb[k]!] = leafy[limb[k]!]! + leafMass * leafAt[k]! * foliage;
      woody[limb[k]!] = woody[limb[k]!]! + mass[k]!;
    }
    for (let l = 0; l < count; l += 1) {
      const b = base[l]!;
      const parent = at(shape.parent, b);
      if (parent >= 0) { parentLimb[l] = limb[parent]!; attach[l] = upto[parent]!; }
      const j = Math.max(inertia[l]!, 1e-6);
      // The beam law's frequency, pressed into the band trees sway in.
      const physical = Math.sqrt(kPhys[l]! / j) / TAU;
      const f = clamp(Math.sqrt(Math.max(physical, 1e-6)) * 0.55, slowest, quickest);
      frequency[l] = f;
      // Dead and rotten wood gives under what sound wood shrugs off.
      stiffness[l] = (j * (TAU * f) ** 2 * clamp(sound[l]!, 0.05, 1)) / pliancy;
      firm[l] = clamp(sound[l]!, 0, 1);
      inertia[l] = j;
      // Leaves catch the air: a leafy limb settles sooner than bare wood.
      const zeta = damping + 0.12 * (leafy[l]! / Math.max(woody[l]!, 1e-9)) ** 0.5;
      damp[l] = 2 * clamp(zeta, 0.03, 0.6) * Math.sqrt(stiffness[l]! * j);
    }
    const phase = Float32Array.from(base, (b) => hash(seed, b) * TAU);
    return { count, limb, share, upto, base, parentLimb, attach, stiffness, inertia, damping: damp, frequency, phase, firm };
  }

  /** What each node's end can bear: the weakest joint between it and the ground, at its lever. */
  function buildCarry(): void {
    for (let k = 0; k < n; k += 1) {
      if (!alive[k]) { carryAt[k] = 0; continue; }
      let carry = 1e4;
      for (let q = k; q >= 0; q = at(shape.parent, q)) {
        const lever = Math.hypot(ex[k]! - bx[q]!, ez[k]! - bz[q]!);
        if (lever > 1e-3) carry = Math.min(carry, (strength[q]! * 0.6) / (GRAVITY * lever));
      }
      carryAt[k] = carry;
    }
  }

  function step(forces: TreeForces): void {
    const L = limbs!;
    const foliage = clamp(forces.foliage ?? 1, 0, 1);
    const snow = clamp(forces.snow ?? 0, 0, 1);
    const dir = forces.dir ?? 0;
    const dx = Math.cos(dir), dz = Math.sin(dir);
    const t = forces.elapsed;
    const speed = Math.max(0, forces.wind) * gale;
    fx.fill(0); fy.fill(0); fz.fill(0); mx.fill(0); mz.fill(0); gx.fill(0); gz.fill(0); gfy.fill(0);
    // Each limb buffets on its own (the gusts roll through the whole crown): its share of the wind along and across.
    if (steady) { buffetAlong.fill(0); buffetAcross.fill(0); } else if (speed > 0) {
      for (let l = 0; l < L.count; l += 1) {
        const phase = L.phase[l]!;
        buffetAlong[l] = 0.16 * Math.sin(t * 1.7 + phase) + 0.1 * Math.sin(t * 3.1 + phase * 1.9) + 0.07 * Math.sin(t * 5.3 + phase * 2.7);
        buffetAcross[l] = 0.3 * (Math.sin(t * 1.3 + phase * 3.1) * 0.6 + Math.sin(t * 2.9 + phase * 0.7) * 0.4);
      }
    }
    // Forces on each living internode: drag on wood at its middle, on leaves at its end; snow's weight likewise.
    for (let k = 0; k < n; k += 1) {
      if (!alive[k]) continue;
      const l = L.limb[k]!;
      const midX = (bx[k]! + ex[k]!) * 0.5, midY = (by[k]! + ey[k]!) * 0.5, midZ = (bz[k]! + ez[k]!) * 0.5;
      let wfx = 0, wfz = 0, lfx = 0, lfz = 0;
      if (speed > 0) {
        const along = midX * dx + midZ * dz;
        const profile = profileAt[k]!;
        const along_ = speed * profile * (steady ? 1 : 0.55 + 0.9 * gustAt(t, along) + buffetAlong[l]!);
        const across = speed * profile * buffetAcross[l]!;
        const vx = along_ * dx - across * dz, vz = along_ * dz + across * dx;
        const v = Math.hypot(vx, vz);
        const pressure = 0.5 * AIR * drag * v;
        const woodArea = 2 * radius[k]! * length[k]!;
        // Leaves fold and stream in a strong wind, so their drag grows slower than v².
        const leaves = leafArea * leafAt[k]! * foliage / (1 + v / 12);
        wfx = pressure * woodArea * vx; wfz = pressure * woodArea * vz;
        lfx = pressure * leaves * vx; lfz = pressure * leaves * vz;
      }
      let woodW = 0, leafW = 0;
      if (snow > 0) {
        const horizontal = Math.hypot(ex[k]! - bx[k]!, ez[k]! - bz[k]!) / Math.max(length[k]!, 1e-6);
        woodW = snowDensity * snowDepth * snow * 2 * radius[k]! * length[k]! * (horizontal + 0.1) * GRAVITY;
        leafW = snowDensity * snowDepth * snow * leafArea * leafAt[k]! * foliage * 0.6 * GRAVITY;
      }
      // Moments about the origin: r × F, with F = (fx, −w, fz).
      fx[k] = wfx + lfx; fz[k] = wfz + lfz; fy[k] = -(woodW + leafW);
      mx[k] = midY * wfz - midZ * -woodW + ey[k]! * lfz - ez[k]! * -leafW;
      mz[k] = midX * -woodW - midY * wfx + ex[k]! * -leafW - ey[k]! * lfx;
      gfy[k] = -(woodW + leafW);
      gx[k] = midZ * woodW + ez[k]! * leafW;
      gz[k] = -midX * woodW - ex[k]! * leafW;
    }
    for (const load of forces.loads ?? []) {
      const k = load.node;
      if (!(k >= 0 && k < n) || !alive[k] || !(load.mass !== 0)) continue;
      const w = load.mass * GRAVITY;
      fy[k] = fy[k]! - w; gfy[k] = gfy[k]! - w;
      mx[k] = mx[k]! + ez[k]! * w; mz[k] = mz[k]! - ex[k]! * w;
      gx[k] = gx[k]! + ez[k]! * w; gz[k] = gz[k]! - ex[k]! * w;
    }
    for (let k = n - 1; k > 0; k -= 1) {
      const parent = at(shape.parent, k);
      if (parent < 0 || !alive[k]) continue;
      fx[parent] = fx[parent]! + fx[k]!; fy[parent] = fy[parent]! + fy[k]!; fz[parent] = fz[parent]! + fz[k]!;
      mx[parent] = mx[parent]! + mx[k]!; mz[parent] = mz[parent]! + mz[k]!;
      gx[parent] = gx[parent]! + gx[k]!; gz[parent] = gz[parent]! + gz[k]!; gfy[parent] = gfy[parent]! + gfy[k]!;
    }
    // Generalised force on each limb's mode: each joint's moment, weighted by its share of the bend.
    const qx = genX, qz = genZ;
    qx.fill(0); qz.fill(0);
    for (let k = 0; k < n; k += 1) {
      if (!alive[k]) continue;
      // Moment about the joint: M − B × F (the horizontal axes; twist is ignored).
      const tx = mx[k]! - (by[k]! * fz[k]! - bz[k]! * fy[k]!);
      const tz = mz[k]! - (bx[k]! * fy[k]! - by[k]! * fx[k]!);
      const s = L.share[k]!;
      qx[L.limb[k]!] = qx[L.limb[k]!]! + s * tx;
      qz[L.limb[k]!] = qz[L.limb[k]!]! + s * tz;
    }
    const dt = clamp(forces.dt, 0, 0.1);
    const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / substeps;
    for (let l = 0; l < L.count; l += 1) {
      const K = L.stiffness[l]!, J = L.inertia[l]!, C = L.damping[l]!;
      const restX = setX[l]!, restZ = setZ[l]!;
      staticX[l] = qx[l]! / K + restX; staticZ[l] = qz[l]! / K + restZ;
      if (h <= 0) continue;
      // A limb rides its parent: when the parent swings, the limb's own inertia holds it back, so it whips after.
      const parent = L.parentLimb[l]!;
      const lag = parent >= 0 ? J * L.attach[l]! : 0;
      const px = parent >= 0 ? accX[parent]! : 0, pz = parent >= 0 ? accZ[parent]! : 0;
      let x = phiX[l]!, z = phiZ[l]!, vx = velX[l]!, vz = velZ[l]!;
      const ox = vx, oz = vz;
      for (let i = 0; i < substeps; i += 1) {
        // Implicit Euler: stable for the stiffest twig at any frame rate.
        const denom = 1 + (h * C) / J + (h * h * K) / J;
        vx = (vx + (h * (qx[l]! - lag * px - K * (x - restX))) / J) / denom;
        vz = (vz + (h * (qz[l]! - lag * pz - K * (z - restZ))) / J) / denom;
        x += h * vx; z += h * vz;
      }
      const bend = Math.hypot(x, z);
      if (bend > maxBend) { x *= maxBend / bend; z *= maxBend / bend; vx *= 0.5; vz *= 0.5; }
      accX[l] = (vx - ox) / dt; accZ[l] = (vz - oz) / dt;
      phiX[l] = x; phiZ[l] = z; velX[l] = vx; velZ[l] = vz;
      // Held bent, wood takes a set; sound wood slowly lifts back, dead wood stays down.
      const taken = Math.min(1, creep * dt), lifted = Math.min(1, creep * 0.25 * L.firm[l]! ** 4 * dt);
      const bentX = setX[l]! + (x - restX) * taken, bentZ = setZ[l]! + (z - restZ) * taken;
      const worn = Math.hypot(bentX, bentZ), most = maxBend * 0.35;
      const held = (1 - lifted) * (worn > most ? most / worn : 1);
      setX[l] = bentX * held; setZ[l] = bentZ * held;
    }
    if (breakOptions && liveBreaks && !steady) checkBreaks(forces, snow);
  }

  function checkBreaks(forces: TreeForces, snow: number): void {
    const worst = weakest();
    if (worst < 0 || breaks.length >= most || forces.elapsed - lastBreak < cooldown) return;
    snap(worst, forces, causeOf(worst, snow));
  }

  /** The joint most over its strength this step (strain past 1), or −1; `spared` joints are passed over. */
  function weakest(spared?: Uint8Array): number {
    const L = limbs!;
    let worst = -1, worstRatio = 1;
    for (let k = 1; k < n; k += 1) {
      if (!alive[k]) { strainAt[k] = 0; continue; }
      const tx = mx[k]! - (by[k]! * fz[k]! - bz[k]! * fy[k]!);
      const tz = mz[k]! - (bx[k]! * fy[k]! - by[k]! * fx[k]!);
      const l = L.limb[k]!;
      // The swing past where the load alone would hold it adds to the moment.
      const still = Math.hypot(staticX[l]!, staticZ[l]!);
      const amplify = still > 1e-9 ? clamp(Math.hypot(phiX[l]!, phiZ[l]!) / still, 1, 3) : 1;
      const ratio = (Math.hypot(tx, tz) * amplify) / Math.max(strength[k]!, 1e-9);
      strainAt[k] = ratio;
      if (ratio > worstRatio && !spared?.[k] && at(shape.order, k) > 0 && radius[k]! < trunkRadius * protect) { worst = k; worstRatio = ratio; }
    }
    return worst;
  }

  /** What broke a joint: its weight (snow or a load) or the wind. */
  function causeOf(worst: number, snow: number): BreakCause {
    const tx = mx[worst]! - (by[worst]! * fz[worst]! - bz[worst]! * fy[worst]!);
    const tz = mz[worst]! - (bx[worst]! * fy[worst]! - by[worst]! * fx[worst]!);
    const gxx = gx[worst]! - (by[worst]! * 0 - bz[worst]! * gfy[worst]!);
    const gzz = gz[worst]! - (bx[worst]! * gfy[worst]! - 0);
    const gravity = Math.hypot(gxx, gzz);
    return gravity > Math.hypot(tx - gxx, tz - gzz) ? (snow > 0 ? "snow" : "load") : "wind";
  }

  function snap(node: number, forces: TreeForces, cause: BreakCause): void {
    const o = out!;
    const nodes: number[] = [];
    const inside = new Uint8Array(n);
    inside[node] = 1;
    for (let k = node; k < n; k += 1) {
      if (k > node && !inside[at(shape.parent, k)]) continue;
      inside[k] = 1;
      if (at(lastFrame!.fall, k) > 0) continue;
      nodes.push(k);
    }
    const rest = new Float32Array(nodes.length * 6);
    nodes.forEach((k, i) => {
      rest[i * 6] = o.x[k]!; rest[i * 6 + 1] = o.y[k]!; rest[i * 6 + 2] = o.z[k]!;
      rest[i * 6 + 3] = o.baseX[k]!; rest[i * 6 + 4] = o.baseY[k]!; rest[i * 6 + 5] = o.baseZ[k]!;
    });
    for (let k = 0; k < n; k += 1) if (inside[k]) cut[k] = 1;
    const pivot: [number, number, number] = [o.baseX[node]!, o.baseY[node]!, o.baseZ[node]!];
    // It tips outward over its break, the far end going down first.
    let ox = o.x[node]! - pivot[0], oz = o.z[node]! - pivot[2];
    if (Math.hypot(ox, oz) < 1e-6) { ox = Math.cos(forces.dir ?? 0); oz = Math.sin(forces.dir ?? 0); }
    const len = Math.hypot(ox, oz);
    const axis: [number, number, number] = [oz / len, 0, -ox / len];
    const dir = forces.dir ?? 0;
    const blow = Math.max(0, forces.wind) * 0.7;
    pieces.push({ root: node, nodes: Int32Array.from(nodes), rest, pivot, axis, drift: [Math.cos(dir) * blow, Math.sin(dir) * blow], at: forces.elapsed, landed: -1, touched: -1, flat: Math.atan2(o.y[node]! - pivot[1], len), lift: 0 });
    breaks.push({ node, at: forces.elapsed, cause, radius: radius[node]!, p: pivot, pieces: nodes.length });
    lastBreak = forces.elapsed;
    // The tree is lighter now: its limbs sway at new frequencies.
    rebuild(lastFrame!, builtFoliage);
  }

  function pose(frame: TreePose, elapsed: number): void {
    const o = out!;
    const L = limbs!;
    const R = rot;
    for (let k = 0; k < n; k += 1) {
      if (cut[k]) continue;
      const parent = at(shape.parent, k);
      const ro = k * 9;
      if (at(frame.fall, k) > 0) {
        // Shed by the tree's own life and lying where it fell: not moved here.
        rotation(R, ro, 0, 0, 0);
        o.x[k] = ex[k]!; o.y[k] = ey[k]!; o.z[k] = ez[k]!; o.baseX[k] = bx[k]!; o.baseY[k] = by[k]!; o.baseZ[k] = bz[k]!;
        continue;
      }
      const l = L.limb[k]!;
      const s = L.share[k]!;
      if (s > 0) rotation(scratch, 0, s * phiX[l]!, 0, s * phiZ[l]!);
      else rotation(scratch, 0, 0, 0, 0);
      let baseX = bx[k]!, baseY = by[k]!, baseZ = bz[k]!;
      if (parent >= 0) {
        multiply(R, ro, scratch, 0, R, parent * 9);
        // Where it starts: its parent's moved end, plus any offset from it turned with the parent.
        const ox = bx[k]! - ex[parent]!, oy = by[k]! - ey[parent]!, oz = bz[k]! - ez[parent]!;
        const po = parent * 9;
        baseX = o.x[parent]! + R[po]! * ox + R[po + 1]! * oy + R[po + 2]! * oz;
        baseY = o.y[parent]! + R[po + 3]! * ox + R[po + 4]! * oy + R[po + 5]! * oz;
        baseZ = o.z[parent]! + R[po + 6]! * ox + R[po + 7]! * oy + R[po + 8]! * oz;
      } else {
        R.set(scratch, ro);
      }
      const vx = ex[k]! - bx[k]!, vy = ey[k]! - by[k]!, vz = ez[k]! - bz[k]!;
      o.baseX[k] = baseX; o.baseY[k] = baseY; o.baseZ[k] = baseZ;
      o.x[k] = baseX + R[ro]! * vx + R[ro + 1]! * vy + R[ro + 2]! * vz;
      o.y[k] = baseY + R[ro + 3]! * vx + R[ro + 4]! * vy + R[ro + 5]! * vz;
      o.z[k] = baseZ + R[ro + 6]! * vx + R[ro + 7]! * vy + R[ro + 8]! * vz;
    }
    for (const piece of pieces) posePiece(piece, elapsed);
  }

  function posePiece(piece: Piece, elapsed: number): void {
    const o = out!;
    const since = elapsed - piece.at;
    // Any piece is down within four seconds, so one first posed long after it broke lands at once.
    const t = piece.landed >= 0 ? piece.landed : clamp(since, 0, 4);
    // A moment hanging by the torn wood, then a tumbling drop.
    const turn = Math.min(Math.abs(piece.flat), 2.2 * t * t);
    const angle = piece.flat < 0 ? -turn : turn;
    const falling = Math.max(0, t - 0.15);
    const drop = 0.5 * GRAVITY * 0.85 * falling * falling;
    let driftX = piece.drift[0] * t, driftZ = piece.drift[1] * t;
    const reach = Math.hypot(piece.pivot[0] + driftX, piece.pivot[2] + driftZ);
    if (reach > groundRadius) { const k = groundRadius / reach; driftX = (piece.pivot[0] + driftX) * k - piece.pivot[0]; driftZ = (piece.pivot[2] + driftZ) * k - piece.pivot[2]; }
    rotation(scratch, 0, piece.axis[0] * angle, 0, piece.axis[2] * angle);
    const [px, py, pz] = piece.pivot;
    const m = scratch;
    let lowest = Infinity;
    const place = (x: number, y: number, z: number): [number, number, number] => {
      const vx = x - px, vy = y - py, vz = z - pz;
      return [px + m[0]! * vx + m[1]! * vy + m[2]! * vz + driftX, py + m[3]! * vx + m[4]! * vy + m[5]! * vz - drop + piece.lift, pz + m[6]! * vx + m[7]! * vy + m[8]! * vz + driftZ];
    };
    const moved = new Float32Array(piece.rest.length);
    for (let i = 0; i < piece.nodes.length; i += 1) {
      const r = piece.rest;
      const end = place(r[i * 6]!, r[i * 6 + 1]!, r[i * 6 + 2]!);
      const start = place(r[i * 6 + 3]!, r[i * 6 + 4]!, r[i * 6 + 5]!);
      moved.set(end, i * 6); moved.set(start, i * 6 + 3);
      lowest = Math.min(lowest, end[1] - radius[piece.nodes[i]!]!, start[1] - radius[piece.nodes[i]!]!);
    }
    // It keeps toppling on the ground until it lies along it, then comes to rest.
    let lift = 0;
    if (piece.landed < 0 && lowest < ground) {
      lift = ground - lowest;
      if (piece.touched < 0) piece.touched = since;
      if (turn >= Math.abs(piece.flat)) { piece.landed = t; piece.lift += lift; }
    }
    // Its side twigs give under it: nothing that lay down stands back up out of the ground.
    const pressed = piece.touched < 0 ? 0 : 0.85 * clamp((since - piece.touched) / 0.6, 0, 1);
    const press = (y: number, r: number): number => (y > ground + r ? ground + r + (y - ground - r) * (1 - pressed) : y);
    const rotting = piece.landed >= 0 ? clamp((since - piece.landed - lieFor) / rotFor, 0, 1) : 0;
    for (let i = 0; i < piece.nodes.length; i += 1) {
      const k = piece.nodes[i]!;
      o.x[k] = moved[i * 6]!; o.y[k] = press(moved[i * 6 + 1]! + lift, radius[k]!); o.z[k] = moved[i * 6 + 2]!;
      o.baseX[k] = moved[i * 6 + 3]!; o.baseY[k] = press(moved[i * 6 + 4]! + lift, radius[k]!); o.baseZ[k] = moved[i * 6 + 5]!;
      o.fall[k] = piece.landed >= 0 ? 1 : Math.min(0.99, 0.05 + t);
      o.rot[k] = Math.max(o.rot[k]!, rotting);
    }
  }

  function fresh<P extends TreePose>(frame: P): MovedPose<P> {
    const copy = (array: ArrayLike<number>): Float32Array => Float32Array.from(array as ArrayLike<number>);
    return { ...frame, x: copy(frame.x), y: copy(frame.y), z: copy(frame.z), baseX: copy(frame.baseX), baseY: copy(frame.baseY), baseZ: copy(frame.baseZ), fall: copy(frame.fall), rot: copy(frame.rot) };
  }

  const point = (o: MovedPose<TreePose>, k: number, end: boolean): [number, number, number] => (end ? [o.x[k]!, o.y[k]!, o.z[k]!] : [o.baseX[k]!, o.baseY[k]!, o.baseZ[k]!]);

  function prepare(frame: TreePose, forces: TreeForces): void {
    const foliage = clamp(forces.foliage ?? 1, 0, 1);
    if (frame !== lastFrame) {
      lastFrame = frame;
      out = fresh(frame) as unknown as MovedPose<TreePose>;
      rebuild(frame, foliage);
    } else {
      out!.fall.set(frame.fall as ArrayLike<number>);
      out!.rot.set(frame.rot as ArrayLike<number>);
      if (Math.abs(foliage - builtFoliage) > 0.08) rebuild(frame, foliage);
    }
  }

  return {
    update<P extends TreePose>(frame: P, forces: TreeForces): MovedPose<P> {
      prepare(frame, forces);
      step(forces);
      pose(frame, forces.elapsed);
      return out as unknown as MovedPose<P>;
    },
    get breaks() { return breaks; },
    capsules(minRadius = 0.03) {
      const o = out;
      if (!o) return [];
      const list: WoodCapsule[] = [];
      for (let k = 0; k < n; k += 1) {
        if (!alive[k] || radius[k]! < minRadius || length[k]! < 1e-3) continue;
        list.push({ node: k, parent: at(shape.parent, k), order: at(shape.order, k), a: point(o, k, false), b: point(o, k, true), r: radius[k]!, carry: carryAt[k]! });
      }
      return list;
    },
    woodPath(node) {
      const o = out;
      if (!o || node < 0 || node >= n) return [];
      const chain: number[] = [];
      for (let k = node; k >= 0; k = at(shape.parent, k)) chain.push(k);
      chain.reverse();
      const path: WoodPoint[] = [{ p: point(o, chain[0]!, false), r: radius[chain[0]!]! }];
      for (const k of chain) path.push({ p: point(o, k, true), r: radius[k]! });
      return path;
    },
    carry: (node) => at(carryAt, node),
    limbOf: (node) => (limbs ? at(limbs.base, at(limbs.limb, node)) : node),
    frequency: (node) => (limbs ? at(limbs.frequency, at(limbs.limb, node)) : 0),
    strain: (node) => at(strainAt, node),
    storm(frame, forces, how = {}) {
      prepare(frame, forces);
      const gust = how.gust ?? 1.3;
      const stormSeed = (seed ^ Math.imul((how.seed ?? 0) | 0, 0x27d4eb2d)) >>> 0;
      const struck: TreeBreak[] = [];
      const spared = new Uint8Array(n);
      const snow = clamp(forces.snow ?? 0, 0, 1);
      steady = true;
      try {
        while (breaks.length < most) {
          step({ ...forces, dt: 0 });
          const L = limbs!;
          for (let l = 0; l < L.count; l += 1) { phiX[l] = staticX[l]! * gust; phiZ[l] = staticZ[l]! * gust; }
          const worst = weakest(spared);
          if (worst < 0) break;
          if (hash(stormSeed, worst) >= 1 - Math.exp(-2 * (strainAt[worst]! - 1))) { spared[worst] = 1; continue; }
          snap(worst, forces, causeOf(worst, snow));
          struck.push(breaks[breaks.length - 1]!);
        }
      } finally {
        steady = false;
        phiX.fill(0); phiZ.fill(0); velX.fill(0); velZ.fill(0); accX.fill(0); accZ.fill(0);
      }
      pose(frame, forces.elapsed);
      return struck;
    },
    heal() {
      cut.fill(0);
      pieces.length = 0;
      breaks.length = 0;
      lastBreak = -Infinity;
      phiX.fill(0); phiZ.fill(0); velX.fill(0); velZ.fill(0);
      setX.fill(0); setZ.fill(0);
      if (lastFrame) { out = fresh(lastFrame) as unknown as MovedPose<TreePose>; rebuild(lastFrame, builtFoliage); }
    },
  };
}
