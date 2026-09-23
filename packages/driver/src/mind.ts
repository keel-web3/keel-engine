// A driver's mind: what they're good at, and the mistakes that come out of what
// they aren't. Six skills (0..1): CORNERING (how much of the grip they dare
// use, and the line), BRAKING (where they brake), WEAVING (reading traffic and
// slipping past it), CONTROL (catching a slide), AGGRESSION (holding the line
// against a rival, braking late behind one) and NERVE (keeping it together with
// someone on their bumper). A driver is drawn from a seed, leaned by the kind of
// car they chose -- the muscle-car driver is brave and blunt, the hypercar one
// precise, the kei one quick in traffic and timid -- so a field is a mix.
//
// Mistakes are a matrix over those skills: each stretch of road rolls, from the
// driver's seed and the stretch's number (so the same race makes the same
// mistakes, and one driver's spin sets off the same chain behind them every
// time), whether they get it wrong here, and how:
//
//   overcook   (cornering)  in too fast: runs wide into the kerb or the wall
//   lateBrake  (braking)    brakes too late: ploughs on, or locks up
//   lift       (control)    lifts mid-corner: the tail steps out
//   twitch     (control)    a flinch of the wheel at speed
//   dive       (aggression, weaving) goes for a gap that isn't there
//
// A rival close behind raises the odds, by how little nerve they have.
// Deterministic: integer hashes and arithmetic.

/** What a driver is good at (each 0..1). */
export interface DriverSkills {
  readonly cornering: number;
  readonly braking: number;
  readonly weaving: number;
  readonly control: number;
  readonly aggression: number;
  readonly nerve: number;
}

export type MistakeKind = "overcook" | "lateBrake" | "lift" | "twitch" | "dive";

/** A mistake on a stretch of road: its kind, how bad (0..1), and which way (for a twitch). */
export interface Mistake { readonly kind: MistakeKind; readonly size: number; readonly side: 1 | -1 }

const mix32 = (a: number, b: number): number => {
  let h = Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
/** 0..1 from a seed and a few integers. */
const roll = (seed: number, ...k: number[]): number => k.reduce((h, v) => mix32(h, v | 0), seed >>> 0) / 4294967296;

/** A seed from a string (a racer's name, a race and a slot). */
export function driverSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** How each kind of car leans the driver who picks it (added to a 0.5-centred draw). */
const LEAN: Readonly<Record<string, Partial<DriverSkills>>> = {
  hyper: { cornering: 0.15, control: 0.1, braking: 0.1, aggression: 0.05 },
  proto: { cornering: 0.2, braking: 0.1, nerve: -0.05 },
  gt: { cornering: 0.08, braking: 0.08, control: 0.05 },
  muscle: { aggression: 0.25, cornering: -0.12, braking: -0.08, nerve: 0.1 },
  rally: { control: 0.25, weaving: 0.1, nerve: 0.05 },
  kei: { weaving: 0.2, aggression: -0.15, nerve: -0.1 },
  pickup: { weaving: -0.15, control: -0.1, aggression: 0.1 },
  buggy: { control: 0.1, nerve: -0.15, aggression: 0.1 },
};

/**
 * A driver's base skills from a seed, leaned by their car's kind (packs/vehicles archetypes; anything else unleaned).
 * The draw is wide on purpose -- 0.1 to 0.95 before the lean -- so a common driver can be brilliant: rarity (the
 * instincts) tips the odds, it doesn't cap anyone.
 */
export function driverSkills(seed: number, carKind = ""): DriverSkills {
  const lean = LEAN[carKind] ?? {};
  // (Two rolls averaged: most drivers middling, the tails still reachable.)
  const draw = (k: number, key: keyof DriverSkills): number => Math.max(0.05, Math.min(0.98, 0.1 + ((roll(seed, 71, k) + roll(seed, 72, k)) / 2) * 0.85 + (lean[key] ?? 0)));
  return {
    cornering: draw(1, "cornering"), braking: draw(2, "braking"), weaving: draw(3, "weaving"),
    control: draw(4, "control"), aggression: draw(5, "aggression"), nerve: draw(6, "nerve"),
  };
}

// ------------------------------------------------------------------------------------------------ instincts

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
/** How often each rarity comes up, relative (per instinct in the table). */
export const RARITY_WEIGHT: Readonly<Record<Rarity, number>> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };

/**
 * An instinct: a named trait a driver has, what it does to their skills, and how it scales their mistakes (x per kind,
 * `all` for every kind; under 1 fewer, over 1 more -- or bigger, for `size`). Rare ones are the smart ones, but the
 * table is a weight system like everything else: plenty of commons are good, some rares are wild.
 */
export interface Instinct {
  readonly name: string;
  readonly rarity: Rarity;
  readonly skills: Partial<DriverSkills>;
  readonly mistakes?: Partial<Record<MistakeKind | "all", number>>;
  /** Mistakes made bigger (x): the daredevil's are spectacular. */
  readonly size?: number;
}

const inst = (name: string, rarity: Rarity, skills: Partial<DriverSkills>, mistakes?: Instinct["mistakes"], size?: number): Instinct => ({ name, rarity, skills, ...(mistakes ? { mistakes } : {}), ...(size ? { size } : {}) });

export const INSTINCTS: readonly Instinct[] = [
  inst("Rookie", "common", { cornering: -0.05, braking: -0.05, nerve: -0.05 }, { all: 1.3 }),
  inst("Hothead", "common", { aggression: 0.25, nerve: -0.15 }, { dive: 1.6, overcook: 1.2 }),
  inst("Sunday Driver", "common", { cornering: -0.08, braking: 0.12, aggression: -0.2 }, { overcook: 0.7, dive: 0.4 }),
  inst("Street Smart", "common", { weaving: 0.12, control: 0.05 }),
  inst("Heavy Foot", "common", { aggression: 0.1 }, { lift: 0.6, lateBrake: 1.3 }),
  inst("Late Braker", "uncommon", { braking: 0.15, aggression: 0.05 }, { lateBrake: 1.2 }, 1.2),
  inst("Veteran", "uncommon", { nerve: 0.1, control: 0.05 }, { all: 0.7 }),
  inst("Wall Rider", "uncommon", { aggression: 0.15, cornering: 0.05 }, { overcook: 1.2 }),
  inst("Smooth Operator", "uncommon", { control: 0.12, cornering: 0.05 }, { twitch: 0.4, lift: 0.6 }),
  inst("Apex Hunter", "rare", { cornering: 0.18 }, { overcook: 0.5 }),
  inst("Traffic Ghost", "rare", { weaving: 0.25 }, { dive: 0.3 }),
  inst("Daredevil", "rare", { cornering: 0.1, aggression: 0.2 }, { all: 1.2 }, 1.4),
  inst("Ice Veins", "epic", { nerve: 0.35 }, { all: 0.8 }),
  inst("Car Whisperer", "epic", { control: 0.28 }, { lift: 0.25, twitch: 0.25 }),
  inst("Clutch", "legendary", { nerve: 0.3, braking: 0.1, cornering: 0.1 }, { all: 0.4 }),
  inst("Ghost of the Streets", "legendary", { weaving: 0.3, control: 0.2, cornering: 0.15 }, { all: 0.35 }),
];

/** A generated driver: their instincts, their skills with them applied, how their mistakes scale, and their rarity. */
export interface Driver {
  readonly seed: number;
  readonly instincts: readonly Instinct[];
  readonly skills: DriverSkills;
  readonly mistakes: Readonly<Record<MistakeKind, number>>;
  readonly size: number;
  /** The rarest instinct they drew. */
  readonly rarity: Rarity;
}

const RANK: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** A driver from a seed (and their car's kind, which leans their skills): one to three instincts drawn by weight. */
export function generateDriver(seed: number, carKind = ""): Driver {
  const count = roll(seed, 90) < 0.6 ? 1 : roll(seed, 90) < 0.9 ? 2 : 3;
  const total = INSTINCTS.reduce((t, i) => t + RARITY_WEIGHT[i.rarity], 0);
  const picked: Instinct[] = [];
  for (let k = 0; picked.length < count && k < 12; k += 1) {
    let u = roll(seed, 91, k) * total, pick = INSTINCTS[0]!;
    for (const i of INSTINCTS) { u -= RARITY_WEIGHT[i.rarity]; if (u < 0) { pick = i; break; } }
    if (!picked.includes(pick)) picked.push(pick);
  }
  const base = driverSkills(seed, carKind), skills = { ...base } as Record<keyof DriverSkills, number>;
  const mistakes: Record<MistakeKind, number> = { overcook: 1, lateBrake: 1, lift: 1, twitch: 1, dive: 1 };
  let size = 1;
  for (const i of picked) {
    for (const [k, d] of Object.entries(i.skills) as [keyof DriverSkills, number][]) skills[k] = Math.max(0.05, Math.min(0.99, skills[k] + d));
    for (const [k, m] of Object.entries(i.mistakes ?? {}) as [MistakeKind | "all", number][]) {
      if (k === "all") for (const kind of Object.keys(mistakes) as MistakeKind[]) mistakes[kind] *= m; else mistakes[k] *= m;
    }
    size *= i.size ?? 1;
  }
  const rarity = picked.reduce<Rarity>((r, i) => (RANK.indexOf(i.rarity) > RANK.indexOf(r) ? i.rarity : r), "common");
  return { seed, instincts: picked, skills, mistakes, size, rarity };
}

/** Metres of road each mistake roll covers. */
export const STRETCH = 25;

/**
 * The mistake a driver makes on stretch `n` of the road, if any. `bend` is how tight the stretch is (curvature, 1/m):
 * corner mistakes only happen in corners, a twitch only at speed. `pressure` (0..1) is a rival on their bumper.
 * `rate` scales how error-prone the whole field is (1: a normal street race).
 */
export function mistakeAt(seed: number, n: number, sk: DriverSkills, bend: number, speed: number, pressure = 0, rate = 1, scale?: Readonly<Record<MistakeKind, number>>, bigger = 1): Mistake | null {
  const nerves = 1 + pressure * 2 * (1 - sk.nerve);
  const corner = bend > 1 / 220 ? Math.min(1, bend * 60) : 0;
  // Each kind's chance on this stretch, from the skill it comes out of.
  const odds: readonly [MistakeKind, number][] = [
    ["overcook", corner * 0.15 * (1 - sk.cornering) * (0.6 + sk.aggression * 0.8)],
    ["lateBrake", corner * 0.12 * (1 - sk.braking)],
    ["lift", corner * 0.08 * (1 - sk.control)],
    ["twitch", speed > 25 ? 0.03 * (1 - sk.control) : 0],
    ["dive", pressure > 0 || corner > 0 ? 0.06 * sk.aggression * (1 - sk.weaving) : 0],
  ];
  let u = roll(seed, n, 1), acc = 0;
  for (const [kind, p] of odds) {
    acc += p * nerves * rate * (scale ? scale[kind] : 1);
    if (u < acc) return { kind, size: Math.min(1.5, (0.35 + roll(seed, n, 2) * 0.65) * bigger), side: roll(seed, n, 3) < 0.5 ? -1 : 1 };
  }
  return null;
}
