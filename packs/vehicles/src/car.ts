// A car, generated the way a Pixel Marine is: BASE traits from integer tables
// (traits.ts) -- a named body style, a stance, headlights, a grille, a wing, rims,
// a finish, decals, a condition -- each of them VARIED inside (a wing's height,
// chord and span; a rim's spoke count and dish; a number's digits; which door is
// off another car), on top of continuous DIALS (length, width, how low, where the
// cabin sits, glass rake, fastback, wheels and stagger, aero, flares, rounding,
// ride, power, mass) that the style centres and every car jitters. Several traits
// can land on one site; the rarest takes its chip; the score is the marine's
// half-octave points over the fixed chip vector.
//
// What comes out is plain data: geometry numbers and part forms (shapes.ts builds
// solids from them, panel by panel), paints per panel (paint.ts), decals
// (decals.ts), handling (drive.ts), and the traits, chips, score and tier
// (metadata.ts writes them as a token's attributes and papers).
//
// Deterministic: integer hashing per tag (draws.ts), dmath only.

import { at, clamp, drawsOf, snap } from "./draws.ts";
import type { Draws } from "./draws.ts";
import {
  BODY_STYLES, CATEGORIES, EFFECT_TABLE, SPECIAL_STYLES, LIGHT_TABLE, NEON_TABLE, ONE_PPM, RIM_SIZE_TABLE, SPINNER_TABLE, PAINT_FAMILIES, PAINT_TABLES, TYPE_TABLE, WINGS, WING_ACCENT_CHANCE, category, chipsOf, entryPpm, scoreOf, stylePpm, tierOf, traitPpm,
} from "./traits.ts";
import type { BodyStyle, PaintKey, Site, Table, Tier, Trait } from "./traits.ts";
import type { MechanicalUpgrades } from "./mechanics.ts";
import { semiRig } from "./semi.ts";
import { policeParts, serviceDecals, serviceLook, serviceRig } from "./service.ts";
import type { DumpBed, ServiceParts } from "./service.ts";

// ---------------------------------------------------------------- vocabulary

/** Each class's bumper odds (weights). */
const BUMPER_ODDS: Readonly<Record<string, ReadonlyArray<readonly [Bumper, number]>>> = {
  hyper: [["sport", 9], ["street", 1]], proto: [["sport", 1]], gt: [["sport", 5], ["street", 4], ["chrome", 1]],
  muscle: [["chrome", 5], ["street", 3], ["sport", 2]], rally: [["street", 5], ["tube", 3], ["sport", 2]],
  kei: [["street", 7], ["chrome", 3]], pickup: [["tube", 5], ["chrome", 4], ["street", 1]], buggy: [["tube", 1]],
};
export const ARCHETYPES = ["hyper", "gt", "muscle", "rally", "kei", "pickup", "buggy", "proto"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const DIALS = ["length", "width", "low", "cab", "hood", "roof", "rake", "fast", "wheel", "stagger", "aero", "flare", "round", "ride", "power", "mass"] as const;
export type Dial = (typeof DIALS)[number];

export type HeadLights = "strip" | "pair" | "round" | "quad" | "popup" | "slit" | "frog";
export type Grille = "mesh" | "slat" | "egg" | "smooth" | "split" | "chrome" | "shark";
export type TailLights = "bar" | "blocks" | "round" | "split" | "quad" | "slim";
export type Spoiler = "none" | "lip" | "ducktail" | "wing" | "bigwing" | "swan" | "whale" | "roof";
/**
 * A bumper's form: SPORT (wrapped, a big intake mouth, vents and a lip), STREET (wrapped, a rub strip, a slim grille),
 * CHROME (a bright bar with overriders over a painted valance), TUBE (off-road tubes and a skid plate).
 */
export type Bumper = "sport" | "street" | "chrome" | "tube";
export type Exhaust = "none" | "single" | "twin" | "quad" | "center" | "side" | "stacks";
export type RoofKind = "hard" | "contrast" | "glass" | "vinyl" | "carbon" | "open";
export type RimStyle = "spoke" | "split" | "mesh" | "dish" | "turbofan" | "star" | "steelie" | "deepdish" | "monoblock" | "wire";
export type Tyre = "street" | "slick" | "letters" | "whitewall" | "stretched" | "knobby";
export type Finish = "gloss" | "pearl" | "matte" | "satin" | "flake" | "candy" | "chameleon";
export type CarType = "gold" | "chrome" | "carbon" | "rust" | "hologram" | "stealth";
export type Livery = "none" | "stripes" | "twin" | "bands" | "checks" | "fade" | "camo" | "spots" | "pinstripe" | "slash";
export type RimPaint = "chrome" | "gold" | "black" | "gunmetal" | "white" | "body" | "bronze";
export type Effect = "underglow" | "neon" | "glowrims" | "trails";
/** What its lamps burn (the Lights site): the colour of the beam as well as the lens. */
export type LampKind = "halogen" | "led" | "xenon" | "amber" | "ice" | "violet" | "green";
/** How the tubes under a car run: the whole length, the nose only, the tail only, or right round it. */
export type NeonRun = "full" | "front" | "rear" | "ring";
/** A neon kit (the Neon site): where the tubes are. */
export interface NeonKit { readonly name: string; readonly under: boolean; readonly rims: boolean; readonly trim: boolean; readonly cabin: boolean; readonly run: NeonRun }
/** A rim that turns on its own (the Spinner site). */
export type Spinner = "none" | "spinners" | "floaters" | "knockoffs";
/** A body panel: what the ghetto conditions repaint and decals are stamped on. */
export type Panel = "hood" | "trunk" | "doorL" | "doorR" | "fenderFL" | "fenderFR" | "quarterL" | "quarterR" | "bumperF" | "bumperR" | "roof";
export const PANELS: readonly Panel[] = ["hood", "trunk", "doorL", "doorR", "fenderFL", "fenderFR", "quarterL", "quarterR", "bumperF", "bumperR", "roof"];

/** A colour as a place on a curve: OKLCH lightness, chroma, hue. */
export interface Colour { readonly light: number; readonly chroma: number; readonly hue: number }

/** One wheel shape (every value snapped: wheels that land on the same values share a bake). */
export interface WheelSpec {
  readonly radius: number;
  readonly width: number;
  /** The sidewall's height as a share of the radius. */
  readonly sidewall: number;
  /** The rim's size in inches (the tyre's profile follows it: a bigger rim, a thinner wall). */
  readonly size: number;
  /** A rim that turns on its own. */
  readonly spinner: Spinner;
  readonly rim: RimStyle;
  readonly spokes: number;
  /** How far the spokes sit in from the tyre's face (m). */
  readonly dish: number;
  /** Tread blocks round the tyre (a multiple of the spokes: the spin repeats every spoke); 0 for slicks. */
  readonly lugs: number;
  readonly tyre: Tyre;
}

/** Where a wheel sits on the car: its ground point under the hub (car frame: +z front, +x right) and whether it steers. */
export interface WheelMount {
  readonly x: number;
  readonly z: number;
  readonly steers: boolean;
  /** Which of the car's wheel shapes (0 front, 1 rear). */
  readonly shape: 0 | 1;
  /** -1 on the left, +1 on the right. */
  readonly side: -1 | 1;
}

/** The body's measurements (metres; car frame: origin on the ground under the body's middle). */
export interface BodyGeometry {
  readonly length: number;
  readonly width: number;
  readonly ride: number;
  /** Top of the lower hull (the belt line), and the roof. */
  readonly belt: number;
  readonly roof: number;
  /** The cabin's base: rear and front z, and its width. */
  readonly cabRear: number;
  readonly cabFront: number;
  readonly cabWidth: number;
  /** How far the windscreen and the rear glass run along z. */
  readonly screenRun: number;
  readonly rearRun: number;
  /** Nose and tail: how long, and their foot's height as a share of the hull's. */
  readonly nose: number;
  readonly noseLo: number;
  readonly tail: number;
  readonly tailLo: number;
  /**
   * The tail's end, rounded three ways (metres; 0 keeps it square, a muscle car's or a pickup's): its corners pulled in
   * seen from above, its top edge rolled down, and its bottom tucked up under the bumper.
   */
  readonly tailRound: number;
  readonly tailRoll: number;
  readonly tailTuck: number;
  /** Shoulder rounding radius, fender flare radius, the side panels' strip width. */
  readonly shoulder: number;
  readonly flare: number;
  readonly strip: number;
  /** Where the doors end, front and rear (z). */
  readonly doorFront: number;
  readonly doorRear: number;
  readonly wheelbase: number;
  readonly frontAxle: number;
  readonly rearAxle: number;
  readonly track: readonly [number, number];
}

/** The part forms and their variance (what shapes.ts builds). */
export interface CarParts {
  readonly head: HeadLights;
  readonly headScale: number;
  readonly grille: Grille;
  readonly grilleScale: number;
  readonly splitter: "none" | "lip" | "race";
  readonly bullbar: boolean;
  readonly lightPod: boolean;
  readonly hood: "none" | "scoop" | "shaker" | "twin" | "naca";
  readonly tail: TailLights;
  readonly spoiler: Spoiler;
  /** A wing's height above the deck, chord and span (share of the body's width), endplate size. */
  readonly wing: { readonly height: number; readonly chord: number; readonly span: number; readonly plate: number };
  readonly exhaust: Exhaust;
  /** Which side a single pipe (or a car with no visible exhaust) exits: -1 left, 1 right. */
  readonly exhaustSide: -1 | 1;
  readonly pipe: number;
  readonly diffuser: boolean;
  /** The bumpers' form, and whether the front one carries fog lamps. */
  readonly bumper: Bumper;
  readonly fogs: boolean;
  readonly mudflaps: boolean;
  readonly roof: RoofKind;
  readonly roofScoop: "none" | "scoop" | "airbox";
  readonly roofRack: boolean;
  readonly lightBar: boolean;
  readonly cage: "none" | "bar" | "cage";
  readonly fin: boolean;
  readonly snorkel: boolean;
  readonly widebody: "none" | "box" | "bolt";
  readonly intakes: "none" | "side" | "deep";
  readonly skirts: boolean;
  readonly arches: "none" | "trim" | "cladding";
  readonly mirrors: "wing" | "aero" | "none";
  readonly twoTone: boolean;
  /** A pickup's bed (true) -- or a dump truck's, its inside volume (service.ts DumpBed): either way, it has one. */
  readonly bed: boolean | DumpBed;
  readonly crew: boolean;
  readonly open: boolean;
  /** A semi tractor's own forms (the "Semi Truck" style only; semi.ts builds it). */
  readonly semi?: SemiParts;
  /** A service vehicle's own forms (the bus, fire engine, ambulance, police cruiser and dump truck; service.ts). */
  readonly service?: ServiceParts;
  /** It carries flashing beacons (BODY_SLOT.beaconA/B; carLights' `beacon` phase flashes them). */
  readonly beacons?: true;
}

/** A semi tractor's forms: its sleeper (m; 0 a day cab) and whether its roof is raised, a roof fairing, where its fifth wheel and its two drive axles are (z). */
export interface SemiParts {
  readonly sleeper: number;
  readonly raised: boolean;
  readonly fairing: boolean;
  readonly fifth: number;
  readonly drive: readonly [number, number];
}

/** A panel painted other than the body: primer, a part off another car, rust, sun-faded. */
/** (A "livery" panel is the fleet's own second colour -- a cruiser's white doors, a steel dump bed -- in the body's finish.) */
export interface PanelPaint { readonly panel: Panel; readonly kind: "primer" | "odd" | "rust" | "faded" | "livery"; readonly colour: Colour }

/** A decal the car wears: its kind, what it says or shows (varied per car), and the panels it may go on, best first. */
export interface CarDecal {
  readonly kind: "number" | "sponsors" | "flames" | "teeth" | "bolt" | "starburst" | "checkered" | "skull" | "stars" | "tribal" | "tag" | "lettering" | "chevrons";
  readonly seed: string;
  /** Race number, sponsor names, or nothing. */
  readonly text: string;
  readonly panels: readonly Panel[];
  /** Which of the car's colours its inks wear. */
  readonly inks: readonly ("accent" | "alt" | "body" | "white" | "black" | "fire" | "gold")[];
  /** A service vehicle's lettering: the emblem before its words (a badge, a Maltese cross, the star of life). */
  readonly emblem?: "shield" | "cross" | "star";
}

/** What each paintable part wears. */
export interface CarPaints {
  readonly family: string;
  readonly body: Colour;
  readonly alt: Colour;
  readonly accent: Colour;
  readonly finish: Finish;
  readonly type: CarType | null;
  readonly livery: Livery;
  /** The livery's stripe count, angle (eighths) and width (eighths). */
  readonly liveryFreq: number;
  readonly liveryAngle: number;
  readonly liveryWidth: number;
  readonly roofLivery: "none" | "checks" | "stripes";
  readonly wingAccent: boolean;
  readonly glass: Colour;
  readonly glassScreen: "lines" | "diagonal" | "hatch";
  readonly mirrorGlass: boolean;
  readonly head: Colour;
  readonly tail: Colour;
  readonly rim: RimPaint;
  readonly caliper: Colour;
  readonly tyre: Colour;
  readonly trimChrome: boolean;
  readonly panels: readonly PanelPaint[];
  readonly effect: Effect | null;
  readonly glow: Colour;
  /** Its lamps: what they burn, and the colour that comes out (the beam takes it too). */
  readonly lamp: LampKind;
  readonly lampName: string;
  /** Its neon kit, if it has one (its colour is `glow`). */
  readonly neon: NeonKit | null;
  /** A service vehicle's beacons: the colour each half of its flash burns (BODY_SLOT.beaconA, beaconB). */
  readonly beacon?: { readonly a: Colour; readonly b: Colour };
}

export interface Handling {
  /** What it weighs, in kilograms: everything a car does is this against its power, its tyres and its brakes. */
  readonly massKg: number;
  /** At the wheels, in watts -- what it has to push that weight with. */
  readonly power: number;
  /** Air: the force it meets is drag x speed² (newtons at 1 m/s), from its frontal area and how clean its shape is. */
  readonly drag: number;
  /** Rolling resistance, newtons a kilogram (tyres and bearings). */
  readonly roll: number;
  /** What its brakes can ask of the tyres, as a share of its weight (1: a g). */
  readonly brakeG: number;
  /** Top speed (m/s), acceleration and braking (m/s²), lateral grip (m/s²), steering lock (rad), wheelbase (m), mass (t). */
  readonly topSpeed: number;
  readonly accel: number;
  readonly brake: number;
  readonly grip: number;
  readonly steer: number;
  readonly wheelbase: number;
  readonly mass: number;
  /** A collision circle's radius and the body's half length and width (m). */
  readonly radius: number;
  readonly halfLength: number;
  readonly halfWidth: number;
}

export interface Car {
  readonly mechanical?: MechanicalUpgrades;
  readonly seed: string;
  readonly style: string;
  readonly archetype: Archetype;
  readonly name: string;
  /** The dials, -1..1. */
  readonly dials: Readonly<Record<Dial, number>>;
  readonly body: BodyGeometry;
  readonly parts: CarParts;
  readonly wheels: readonly [WheelSpec, WheelSpec];
  readonly mounts: readonly WheelMount[];
  readonly paints: CarPaints;
  readonly decals: readonly CarDecal[];
  readonly handling: Handling;
  /** Every trait it has, in draw order; the chip per site (the rarest there); the score (half-bits) and tier. */
  readonly traits: readonly Trait[];
  readonly chips: Readonly<Record<Site, { readonly name: string; readonly ppm: number }>>;
  readonly score: number;
  readonly tier: Tier;
}

export interface CarOptions {
  /** Visible fitted mechanical upgrades, independent of the immutable seed traits. */
  readonly mechanical?: MechanicalUpgrades;
  /** Pin the body style by name, or the class (a style of it, by weight). */
  readonly style?: string | undefined;
  readonly archetype?: Archetype | undefined;
  /** Pin dials (-1..1) by name. */
  readonly dials?: Partial<Record<Dial, number>> | undefined;
  /** Pin traits by category ("Spoiler": "Swan Neck Wing", "Condition": "Odd Door"). */
  readonly traits?: Readonly<Record<string, string>> | undefined;
  /** Luck, per mille (0..999): trait presence chances rise and trait tables flatten toward their rare entries. A weight, never a
   *  guarantee; body style and dials are untouched. (Hashers derives it from a seed's hash work.) */
  readonly luck?: number | undefined;
}

// ---------------------------------------------------------------- class baselines

/** Each class's dial baseline (a style's presets override it). Exported for racing DNA tables built off the same draws. */
export const ARCHETYPE_DIALS: Readonly<Record<Archetype, Readonly<Record<Dial, number>>>> = {
  hyper: { length: 0.2, width: 0.7, low: 0.9, cab: 0.5, hood: -0.5, roof: -0.6, rake: 0.9, fast: 0.8, wheel: 0.4, stagger: 0.6, aero: 0.6, flare: 0.4, round: 0.4, ride: -0.8, power: 0.9, mass: -0.3 },
  gt: { length: 0.6, width: 0.3, low: 0.4, cab: -0.4, hood: 0.6, roof: -0.2, rake: 0.5, fast: 0.5, wheel: 0.2, stagger: 0.2, aero: -0.2, flare: 0.1, round: 0.6, ride: -0.4, power: 0.5, mass: 0.2 },
  muscle: { length: 0.7, width: 0.4, low: -0.1, cab: -0.6, hood: 0.9, roof: -0.1, rake: -0.2, fast: -0.3, wheel: 0.1, stagger: 0.7, aero: -0.3, flare: 0.5, round: -0.5, ride: -0.2, power: 0.7, mass: 0.7 },
  rally: { length: -0.5, width: -0.1, low: -0.4, cab: 0.2, hood: -0.4, roof: 0.3, rake: 0.1, fast: -0.6, wheel: -0.1, stagger: 0, aero: 0.4, flare: 0.8, round: -0.2, ride: 0.3, power: 0.3, mass: -0.4 },
  kei: { length: -1, width: -0.9, low: -0.9, cab: 0.7, hood: -0.9, roof: 0.9, rake: -0.6, fast: -0.9, wheel: -0.8, stagger: 0, aero: -0.6, flare: -0.5, round: 0.5, ride: -0.1, power: -0.9, mass: -0.9 },
  pickup: { length: 0.5, width: 0.5, low: -0.9, cab: 0.3, hood: 0.3, roof: 0.5, rake: -0.7, fast: -1, wheel: 0.8, stagger: 0, aero: -0.8, flare: 0.3, round: -0.6, ride: 0.8, power: 0.2, mass: 0.9 },
  buggy: { length: -0.7, width: 0.2, low: -0.6, cab: 0, hood: -0.2, roof: 0.2, rake: -0.3, fast: -1, wheel: 0.9, stagger: 0.3, aero: -0.4, flare: 0, round: -0.8, ride: 1, power: 0.1, mass: -0.8 },
  proto: { length: 0.9, width: 0.9, low: 1, cab: 0.7, hood: -0.3, roof: -0.9, rake: 1, fast: 1, wheel: 0.1, stagger: 0.2, aero: 1, flare: 0.6, round: 0.7, ride: -1, power: 1, mass: -0.5 },
};

const MAKES = ["Vantor", "Kestrel", "Oryx", "Solenne", "Marauder", "Ashvale", "Corvane", "Ibex", "Novaro", "Halcyon", "Brisa", "Tarsus", "Zephra", "Morrow", "Quill", "Ferrant", "Lyric", "Stellan", "Ruxa", "Obelle"];
const MODELS: Readonly<Record<Archetype, readonly string[]>> = {
  hyper: ["Apex", "Venom", "Aeris", "Rift", "Zenith", "Halo"], gt: ["Grand", "Meridian", "Tourer", "Corsa", "Sovereign", "Estoril"],
  muscle: ["Brute", "Thunder", "Charger", "Outlaw", "Rumble", "Bandit"], rally: ["Dirt", "Stage", "Gravel", "Sprint", "Hillclimb", "Rogue"],
  kei: ["Pip", "Mochi", "Button", "Dot", "Sprout", "Pebble"], pickup: ["Hauler", "Ridge", "Ranch", "Mule", "Canyon", "Bison"],
  buggy: ["Dune", "Scrub", "Goat", "Mesa", "Sidewinder", "Tumble"], proto: ["LMP", "Prototype", "Endurance", "Mirage", "Spectre", "Nova"],
};
/** A service vehicle's model, by its form. */
const SERVICE_MODEL: Readonly<Record<string, string>> = {
  diesel: "Citybus", hybrid: "Citybus Hybrid", cng: "Citybus CNG", pumper: "Pumper", aerial: "Aerial Ladder", type3: "Medic III", cruiser: "Interceptor", tipper: "Tipper 6x4",
};
const SPONSOR_A = ["Volt", "Nano", "Apex", "Hydro", "Turbo", "Omni", "Pyro", "Zen", "Flux", "Grip", "Neo", "Rad", "Ultra", "Maxi", "Dyna"];
const SPONSOR_B = ["rix", "brake", "lube", "tek", "fuel", "cola", "max", "tron", "grip", "zap", "oil", "wax", "gear", "spark", "coil"];

const lookBy = <T extends string>(table: Readonly<Record<string, T>>, name: string): T => {
  const v = table[name];
  if (v === undefined) throw new RangeError(`No form for trait "${name}".`);
  return v;
};

// ---------------------------------------------------------------- the generator

/** A car from a seed. */
export function generateCar(seed: string, options: CarOptions = {}): Car {
  const D: Draws = drawsOf(`keel-vehicles|car|${seed}`);
  const traits: Trait[] = [];
  const pins = options.traits ?? {};
  const luck = Math.max(0, Math.min(999, Math.floor(options.luck ?? 0)));
  // (Luck: a presence chance scaled up, a table flattened toward uniform -- the rarest entries gain the most.)
  const odds = (chance: number): number => (luck ? Math.min(ONE_PPM, Math.floor((chance * (2000 + luck)) / 2000)) : chance);
  const lucky = <T,>(entries: ReadonlyArray<readonly [T, number]>): ReadonlyArray<readonly [T, number]> => {
    if (!luck) return entries;
    const top = Math.max(...entries.map(([, w]) => w));
    return entries.map(([v, w]) => [v, w + Math.floor(((top - w) * luck) / 5000)] as const);
  };

  // The body style: the base everything else is drawn under.
  // (A special style -- outside the draw, never minted -- only ever by name.)
  const special = options.style ? SPECIAL_STYLES.find((s) => s.name === options.style) : undefined;
  const candidates = BODY_STYLES.filter((s) => (options.style ? s.name === options.style : options.archetype ? s.cls === options.archetype : true));
  if (!candidates.length && !special) throw new RangeError(`No body style "${options.style ?? options.archetype}".`);
  const style: BodyStyle = special ?? D.pick("style", candidates.map((s) => [s, s.weight] as const));
  const cls = style.cls;
  // (A service vehicle's style also settles what no roll decides -- its lamps, rim size, no spinner, no rare type, no
  // effect, no neon -- from its `force`; "None" is none. Every other style draws them as it always has.)
  const svc = style.service;
  const fixed = (k: string): string | null | undefined => { const f = svc ? style.force?.[k] : undefined; return f === undefined ? undefined : f === "None" ? null : f; };
  traits.push({ category: "Body", name: style.name, site: "Body", ppm: stylePpm(style) });

  /** A category's roll: forced by the style, pinned, or drawn from its class table -- noted as a trait (with its site) when it lands. */
  const roll = (name: string, detail?: (value: string) => string): string | null => {
    const cat = category(name);
    const forced = pins[name] ?? style.force?.[name];
    let value: string | null = null;
    if (forced !== undefined) value = forced === "None" ? null : forced;
    else {
      const t: Table | undefined = cat.tables[cls];
      if (t && t.entries.length && D.u(`gate.${name}`) < odds(t.chance) / ONE_PPM) value = D.pick(`pick.${name}`, lucky(t.entries));
    }
    if (value !== null) {
      const d = detail?.(value);
      traits.push({ category: name, name: value, site: cat.sites?.[value] ?? cat.site, ppm: traitPpm(name, value), ...(d ? { detail: d } : {}) });
    }
    return value;
  };

  // ------------------------------------------------ dials: the class's baseline, the style's presets, jitter, a shared sport draw
  const sport = D.tri("sport") * 0.6;
  const lean: Partial<Record<Dial, number>> = { low: 0.3 * sport, aero: 0.4 * sport, power: 0.35 * sport, ride: -0.25 * sport, rake: 0.2 * sport, mass: -0.15 * sport };
  const d = {} as Record<Dial, number>;
  for (const k of DIALS) {
    const centre = style.dials[k] ?? ARCHETYPE_DIALS[cls][k];
    d[k] = options.dials?.[k] !== undefined ? clamp(options.dials[k]!, -1, 1) : snap(clamp(D.tri(`dial.${k}`) * 0.45 + centre + (lean[k] ?? 0), -1, 1), 0.01);
  }
  const stance = roll("Stance")!;
  const STANCE_RIDE: Readonly<Record<string, number>> = { Stock: 0, Lowered: -0.5, Slammed: -1.4, Lifted: 0.7, Prerunner: 1.2, "Race Height": -0.6 };
  d.ride = snap(clamp(d.ride + (STANCE_RIDE[stance] ?? 0), -1, 1), 0.01);

  // ------------------------------------------------ the front
  const headName = roll("Headlights")!;
  const head = lookBy<HeadLights>({ "Slit Eyes": "slit", "Light Bar": "strip", "Twin Pods": "pair", "Pop-Ups": "popup", "Quad Round": "quad", "Round Eyes": "round", "Frog Eyes": "frog" }, headName);
  const grilleName = roll("Grille")!;
  const grille = lookBy<Grille>({ "Mesh Grille": "mesh", "Slat Grille": "slat", "Egg Crate": "egg", "Smooth Nose": "smooth", "Split Grille": "split", "Chrome Grille": "chrome", "Shark Nose": "shark" }, grilleName);
  const splitterName = roll("Splitter");
  const bullbar = roll("Bull Bar") !== null;
  const lightPod = roll("Light Pod") !== null;
  const hoodName = roll("Hood");
  if (style.name !== "Semi Truck") roll("Engine Bay");
  // ------------------------------------------------ the rear
  const tailName = roll("Tail Lights")!;
  const tail = lookBy<TailLights>({ "Light Bar": "bar", Blocks: "blocks", "Round Twins": "round", "Split Bar": "split", "Quad Round": "quad", "Slim Line": "slim" }, tailName);
  const wing = { height: snap(at(D.flat("wing.h"), 0.18, 0.42), 0.01), chord: snap(at(D.flat("wing.c"), 0.22, 0.44), 0.01), span: snap(at(D.flat("wing.s"), 0.82, 1.04), 0.01), plate: snap(at(D.flat("wing.p"), 0.12, 0.3), 0.01) };
  const spoilerName = roll("Spoiler", (v) => (WINGS.has(v) ? `${Math.round(wing.height * 100)} cm up, ${Math.round(wing.chord * 100)} cm chord` : ""));
  const spoiler: Spoiler = spoilerName === null ? "none" : lookBy<Spoiler>({ Wing: "wing", "Big Wing": "bigwing", "Swan Neck Wing": "swan", Ducktail: "ducktail", "Lip Spoiler": "lip", "Whale Tail": "whale", "Roof Spoiler": "roof" }, spoilerName);
  const exhaustName = roll("Exhaust");
  const exhaust: Exhaust = exhaustName === null ? "none" : lookBy<Exhaust>({ "Single Pipe": "single", "Twin Pipes": "twin", "Quad Pipes": "quad", "Center Exit": "center", "Side Pipes": "side", Stacks: "stacks" }, exhaustName);
  const diffuser = roll("Diffuser") !== null;
  const mudflaps = roll("Mudflaps") !== null;
  // ------------------------------------------------ the top
  const roofName = style.open ? (traits.push({ category: "Roof", name: "Open Top", site: "Top", ppm: traitPpm("Roof", "Open Top") }), "Open Top") : roll("Roof")!;
  const roof = lookBy<RoofKind>({ Hardtop: "hard", "Contrast Roof": "contrast", "Glass Roof": "glass", "Vinyl Top": "vinyl", "Carbon Roof": "carbon", "Open Top": "open" }, roofName);
  const roofScoopName = style.open ? null : roll("Roof Scoop");
  const roofRack = !style.open && roll("Roof Rack") !== null;
  const lightBar = roll("Light Bar") !== null;
  const cageName = roll("Cage");
  const fin = roll("Fin") !== null;
  const snorkel = roll("Snorkel") !== null;
  // ------------------------------------------------ the sides
  const widebodyName = roll("Widebody");
  const intakesName = roll("Intakes");
  const skirts = roll("Skirts") !== null;
  const archName = roll("Arches");
  const mirrorName = roll("Mirrors")!;
  if (widebodyName) d.flare = snap(clamp(d.flare + (widebodyName === "Box Flares" ? 0.9 : 0.6), -1, 1), 0.01);

  // ------------------------------------------------ wheels
  const rimName = roll("Rims")!;
  const rim = lookBy<RimStyle>({ "5 Spoke": "spoke", "Split Spoke": "split", Mesh: "mesh", Dish: "dish", Turbofan: "turbofan", Star: "star", Steelies: "steelie", "Deep Dish": "deepdish", Monoblock: "monoblock", "Wire Spoke": "wire" }, rimName);
  const SPOKES: Readonly<Record<RimStyle, ReadonlyArray<readonly [number, number]>>> = {
    spoke: [[5, 1]], split: [[5, 3], [6, 2], [7, 1]], mesh: [[8, 2], [10, 1]], dish: [[4, 1], [5, 2], [6, 1]], turbofan: [[6, 1], [8, 2], [10, 2], [12, 1]], star: [[5, 3], [6, 1]],
    steelie: [[4, 1], [5, 2], [6, 1]], deepdish: [[5, 1], [6, 1], [8, 1]], monoblock: [[3, 1], [4, 2], [5, 2]], wire: [[16, 1], [20, 1]],
  };
  const spokes = D.pick("spokes", SPOKES[rim]);
  const tyreName = roll("Tyres")!;
  const tyre = lookBy<Tyre>({ Street: "street", Slicks: "slick", "Raised Letters": "letters", "White Walls": "whitewall", Stretched: "stretched", Knobby: "knobby" }, tyreName);
  traits[traits.length - 2] = { ...traits[traits.length - 2]!, detail: `${spokes} spokes` };
  const rimFinish = roll("Rim Finish")!;

  const buggy = cls === "buggy", pickup = cls === "pickup", kei = cls === "kei", proto = cls === "proto", muscle = cls === "muscle";
  const radiusF = snap(at(d.wheel, 0.26, 0.38) * (buggy || pickup ? 1.1 : 1), 0.01);
  const stagger = Math.max(0, d.stagger);
  const radiusR = snap(radiusF * (1 + 0.16 * stagger), 0.01);
  const widthF = snap(at(0.5 * d.width + 0.4 * d.power - (kei ? 0.3 : 0), 0.17, 0.3) * (buggy || tyre === "knobby" ? 1.2 : 1), 0.01);
  const widthR = snap(widthF * (1 + 0.35 * stagger), 0.01);
  // The rims' size: the wheel keeps its diameter, so a bigger rim just wears a thinner tyre (and fills the arch).
  const rimSizeName = pins["Rim Size"] ?? fixed("Rim Size") ?? D.pick("pick.RimSize", lucky(RIM_SIZE_TABLE.entries));
  const rimSize = Number.parseInt(rimSizeName, 10);
  traits.push({ category: "Rim Size", name: rimSizeName, site: "Rim Size", ppm: entryPpm(RIM_SIZE_TABLE, rimSizeName) });
  const fixedSpinner = fixed("Spinner");
  const spinnerName = pins["Spinner"] ?? (fixedSpinner !== undefined ? fixedSpinner : D.u("gate.Spinner") < odds(SPINNER_TABLE.chance) / ONE_PPM ? D.pick("pick.Spinner", lucky(SPINNER_TABLE.entries)) : null);
  const spinner: Spinner = spinnerName === null || spinnerName === "None" ? "none" : lookBy<Spinner>({ Spinners: "spinners", Floaters: "floaters", "Knock-Offs": "knockoffs" }, spinnerName);
  if (spinnerName) traits.push({ category: "Spinner", name: spinnerName, site: "Spinner", ppm: entryPpm(SPINNER_TABLE, spinnerName) });
  // (A bigger rim wears a thinner tyre -- but a tyre is still a tyre: even a 24" keeps a wall you can see, or the wheel
  // reads as a bare rim with a rubber band round it.)
  const profile = snap(clamp(1.25 - (rimSize - 15) * 0.07, 0.7, 1.25), 0.05);
  const sidewall = snap(clamp((tyre === "stretched" ? 0.24 : at(-0.6 * d.low + 0.5 * d.ride + (buggy || pickup ? 0.6 : 0) + (tyre === "knobby" ? 0.5 : 0), 0.3, 0.52)) * profile, 0.22, 0.58), 0.02);
  const dish = snap(rim === "deepdish" ? at(D.flat("dish"), 0.06, 0.1) : at(d.flare - 0.3 * d.round, 0.01, 0.06) * (rim === "dish" || rim === "steelie" ? 0.5 : 1), 0.01);
  const lugsFor = (n: number) => (tyre === "slick" ? 0 : n * Math.max(2, Math.ceil((tyre === "knobby" ? 12 : 22) / n)));
  const wheelF: WheelSpec = { radius: radiusF, width: widthF, sidewall, size: rimSize, spinner, rim, spokes, dish, lugs: lugsFor(spokes), tyre };
  const wheelR: WheelSpec = { ...wheelF, radius: radiusR, width: widthR };

  // ------------------------------------------------ the body's measurements
  const length = snap(at(d.length, 3.2, 5.1), 0.01);
  const width = snap(at(d.width, 1.5, 2.06), 0.01);
  const ride = snap(at(d.ride, 0.05, 0.38), 0.01);
  const wheelbase = snap(length * at(D.tri("wheelbase") * 0.6 + (kei ? 0.8 : 0) - (muscle ? 0.4 : 0), 0.55, 0.66), 0.01);
  const overhang = length - wheelbase;
  const frontShare = at(0.5 * d.hood - 0.4 * d.cab + (cls === "hyper" || proto ? -0.3 : 0), 0.4, 0.6);
  const frontAxle = snap(length / 2 - overhang * frontShare, 0.01);
  const rearAxle = snap(frontAxle - wheelbase, 0.01);
  const hull = at(-d.low, 0.36, 0.66) + (pickup ? 0.12 : 0);
  // (The hull covers most of the wheel -- except a buggy's, whose wheels stand out in the open.)
  const belt = snap(buggy ? ride + hull * 0.8 : Math.max(ride + hull, 2 * Math.max(radiusF, radiusR) + 0.12), 0.01); // (the wells always close over the tyre)
  const roofH = at(d.roof, 0.24, 0.56) * (proto ? 0.8 : 1);
  const roofY = snap(belt + roofH, 0.01);
  const cabLen = length * (pickup ? (style.crew ? 0.4 : at(D.tri("cablen"), 0.26, 0.32)) : at(-0.5 * d.hood + 0.3 * d.roof + (kei ? 0.4 : 0), 0.3, 0.5));
  const cabMid = length * at(d.cab, -0.2, 0.14) + (pickup ? length * 0.12 : 0);
  const cabFront = snap(Math.min(length / 2 - 0.5, cabMid + cabLen / 2), 0.01);
  const cabRear = snap(Math.max(-length / 2 + 0.3, cabMid - cabLen / 2), 0.01);
  const cab = cabFront - cabRear;
  const screenRun = snap(Math.min(cab * 0.62, roofH * at(d.rake, 0.5, 2.6)), 0.01);
  const rearRun = snap(pickup ? Math.min(cab * 0.15, 0.1) : Math.min(cab * 0.6 - (d.rake > 0.6 ? 0.1 : 0), roofH * at(d.fast, 0.4, 3.0)), 0.01);
  const cabWidth = snap(width * at(0.3 * d.round - 0.4 * d.low + (buggy ? -0.4 : 0), 0.66, 0.9), 0.01);
  const nose = snap(Math.min(length / 2 - cabFront + 0.2, at(-0.4 * d.round + 0.6 * d.hood + 0.3 * d.low, 0.25, 1.1)), 0.01);
  // (The bonnet's slope never dips below the front tyres, the deck's never below the rear: a wheel well always closes over its tyre.)
  const clearOver = (axleFrac: number, R: number): number => { const need = (2 * R + 0.12 - ride) / Math.max(0.05, belt - ride); return axleFrac >= 1 ? 0 : clamp((need - axleFrac) / (1 - axleFrac), 0, 0.95); };
  const frontFrac = clamp((length / 2 - frontAxle) / Math.max(0.1, length / 2 - cabFront), 0, 1);
  const noseLo = snap(Math.max(at(-d.low - 0.3 * d.round + (pickup ? 1 : 0), 0.22, 0.8), clearOver(frontFrac, radiusF)), 0.02);
  const tailLen = snap(Math.min(length / 2 + cabRear, at(d.fast + 0.3 * d.round, 0.12, 0.7)), 0.01);
  const rearFrac = clamp((rearAxle + length / 2) / Math.max(0.1, length / 2 + cabRear), 0, 1);
  const tailLo = snap(Math.max(at(-d.fast + (cls === "rally" || kei ? 0.4 : 0), 0.5, 0.94), clearOver(rearFrac, radiusR)), 0.02);
  const shoulder = snap(at(d.round, 0, 0.1) * (buggy || pickup ? 0.4 : 1), 0.01);
  // (Most real tails are soft -- a bumper that wraps its corners and tucks under, a boot lid that rolls over into the
  // back panel. The round dial leads, a fastback's already sloping deck needs less roll, and a draw of its own for each
  // so two cars of a class don't share a back end. A pickup's tailgate and a buggy's frame stay square.)
  const squareTail = pickup || buggy;
  const tailRound = squareTail ? 0 : snap((width / 2) * at(0.8 * d.round + 0.35 * d.fast + 0.55 * D.tri("tail.plan"), 0, 0.34), 0.01);
  const tailRoll = squareTail ? 0 : snap(hull * at(0.6 * d.round - 0.35 * d.fast + 0.5 * D.tri("tail.roll"), 0.02, 0.4), 0.01);
  const tailTuck = squareTail ? 0 : snap(hull * at(0.4 * d.round + 0.25 * d.low + 0.5 * D.tri("tail.tuck"), 0, 0.32), 0.01);
  const flare = snap(Math.max(0, at(d.flare, -0.02, 0.1)), 0.01);
  const strip = snap(Math.max(0.12, Math.min(width * 0.2, 2 * shoulder + 0.06)), 0.01);
  const doorFront = snap(Math.min(cabFront, length / 2 - nose - 0.05), 0.01);
  const doorRear = snap(Math.max(-length / 2 + tailLen + 0.05, doorFront - at(D.flat("door"), 0.95, 1.3) * (style.crew ? 1.6 : 1)), 0.01);
  const protrude = buggy ? 0.26 + 0.06 * d.flare : at(d.flare, 0.06, 0.1) + (widebodyName ? 0.05 : 0); // (flush with the body's side or just proud of it -- an inset wheel hides behind the door at a three-quarter view; a widebody runs them out under its flares)
  const track: [number, number] = [snap(width / 2 + protrude - widthF / 2, 0.01), snap(width / 2 + protrude - widthR / 2, 0.01)];
  const body: BodyGeometry = { length, width, ride, belt, roof: roofY, cabRear, cabFront, cabWidth, screenRun, rearRun, nose, noseLo, tail: tailLen, tailLo, tailRound, tailRoll, tailTuck, shoulder, flare, strip, doorFront, doorRear, wheelbase, frontAxle, rearAxle, track };

  // ------------------------------------------------ paint: a type (rare) or a family on its curve, a finish, livery, decals, condition
  const fixedType = fixed("Type");
  const typeName = pins["Type"] ?? (fixedType !== undefined ? fixedType : D.u("gate.Type") < odds(TYPE_TABLE.chance) / ONE_PPM ? D.pick("pick.Type", lucky(TYPE_TABLE.entries)) : null);
  const type: CarType | null = typeName === null || typeName === "None" ? null : lookBy<CarType>({ "Gold Plated": "gold", Chrome: "chrome", "Full Carbon": "carbon", "Rust Bucket": "rust", Hologram: "hologram", Stealth: "stealth" }, typeName);
  // (A pinned Paint names a family -- the paint shop's choice; the draw is still made, so nothing after it moves.)
  const drawnFamily: PaintKey = D.pick("family", style.paints ?? PAINT_TABLES[cls]);
  const pinnedFamily = pins["Paint"] ? (Object.keys(PAINT_FAMILIES) as PaintKey[]).find((k) => PAINT_FAMILIES[k].name === pins["Paint"]) : undefined;
  const familyKey: PaintKey = pinnedFamily ?? drawnFamily;
  const fam = PAINT_FAMILIES[familyKey];
  const curve = (f: typeof fam, t: number): Colour => ({
    light: snap(clamp(f.v0 + (f.v1 - f.v0) * t, 0.08, 0.95), 0.02),
    hue: snap((((f.h0 + (f.h1 - f.h0) * t) % 360) + 360) % 360, 5) % 360,
    chroma: snap(clamp(f.c0 + (f.c1 - f.c0) * t + f.bump * 4 * t * (1 - t), 0, 0.3), 0.01),
  });
  const bodyC = curve(fam, D.u("bodyt"));
  if (type) traits.push({ category: "Paint", name: typeName!, site: "Paint", ppm: entryPpm(TYPE_TABLE, typeName!) });
  else traits.push({ category: "Paint", name: fam.name, site: "Paint", ppm: traitPpm("Paint", fam.name) });
  const dark = bodyC.light < 0.4;
  const others = PAINT_TABLES[cls].filter(([k]) => k !== familyKey);
  const altKey: PaintKey = D.pick("altFamily", [[dark ? "white" : "black", 40], ["silver", 15], ["gunmetal", 15], [familyKey, 15], ...others.slice(0, 3).map(([k]) => [k, 6] as const)]);
  const altC = altKey === familyKey ? curve(fam, clamp(1 - D.u("altt"), 0, 1) * 0.3) : curve(PAINT_FAMILIES[altKey], D.u("altt"));
  const accentKey: PaintKey = D.pick("accentFamily", [[dark ? "white" : "black", 30], ["yellow", 10], ["red", 10], ["orange", 10], ["electric", 10], ["acid", 6], ["white", 10]]);
  const accentC = curve(PAINT_FAMILIES[accentKey], D.u("accentt"));
  const finishName = type ? null : roll("Finish");
  const finish = finishName === null ? "gloss" : lookBy<Finish>({ Gloss: "gloss", Pearl: "pearl", Matte: "matte", Satin: "satin", "Metal Flake": "flake", Candy: "candy", Chameleon: "chameleon" }, finishName);
  const liveryName = type ? null : roll("Livery");
  const livery: Livery = liveryName === null ? "none" : lookBy<Livery>({ "Racing Stripes": "stripes", "Twin Stripes": "twin", "Side Bands": "bands", Checkers: "checks", Fade: "fade", Camo: "camo", Spots: "spots", Pinstripe: "pinstripe", Slash: "slash" }, liveryName);
  const roofLiveryName = type || style.open ? null : roll("Roof Livery");
  const wingAccent = WINGS.has(spoilerName ?? "") && D.u("gate.Wing Accent") < odds(WING_ACCENT_CHANCE) / ONE_PPM;
  if (wingAccent) traits.push({ category: "Wing Accent", name: "Wing Accent", site: "Livery", ppm: traitPpm("Wing Accent", "Wing Accent") });

  // Decals: each a roll of its own; what it says and where it goes, varied per car.
  const decals: CarDecal[] = [];
  const decal = (cat: string, kind: CarDecal["kind"], panels: readonly Panel[], inks: CarDecal["inks"], text = (): string => ""): void => {
    const hit = roll(cat, () => "");
    if (hit === null) return;
    const t = text();
    const last = traits[traits.length - 1]!;
    if (t) traits[traits.length - 1] = { ...last, detail: t };
    decals.push({ kind, seed: `${seed}|${cat}`, text: t, panels, inks });
  };
  const bothDoors: Panel[] = ["doorL", "doorR"];
  decal("Race Number", "number", D.u("number.where") < 0.7 ? bothDoors : ["hood", "doorL", "doorR"], [D.u("number.ink") < 0.5 ? "white" : "black", "accent", dark ? "white" : "black"], () => `#${1 + Math.floor(D.u("number") * 99)}`);
  decal("Sponsors", "sponsors", D.u("sponsor.where") < 0.5 ? ["doorL", "doorR", "hood"] : ["hood", "doorL", "doorR", "trunk"], [dark ? "white" : "black", "accent"], () => [0, 1].map((i) => `${SPONSOR_A[Math.floor(D.u(`sp${i}a`) * SPONSOR_A.length)]}${SPONSOR_B[Math.floor(D.u(`sp${i}b`) * SPONSOR_B.length)]}`).join(", "));
  decal("Flames", "flames", D.u("flames.where") < 0.6 ? ["hood", "doorL", "doorR"] : ["doorL", "doorR", "hood"], ["fire"]);
  decal("Shark Teeth", "teeth", ["doorL", "doorR"], ["white", "black", "accent"]);
  decal("Bolt", "bolt", bothDoors, ["accent", "black"]);
  decal("Starburst", "starburst", D.u("sun.where") < 0.5 ? ["hood"] : ["roof"], ["accent", "alt"]);
  decal("Checkered", "checkered", D.u("chk.where") < 0.5 ? ["roof", "trunk", "hood"] : ["hood", "roof"], ["white", "black"]);
  decal("Skull", "skull", ["hood", "doorL", "doorR"], ["white", "black"]);
  decal("Stars", "stars", D.u("stars.where") < 0.5 ? bothDoors : ["hood"], ["white", "accent", "gold"]);
  decal("Tribal", "tribal", ["doorL", "doorR", "hood"], [dark ? "white" : "black"]);
  decal("Tag", "tag", D.u("tag.where") < 0.5 ? ["doorL", "hood"] : ["doorR", "trunk"], ["accent", "white", "black", "alt"], () => ["DRFT", "ZOOM", "KEEL", "OKAY", "YEAH", "BRRR", "NOPE", "GOGO"][Math.floor(D.u("tag.word") * 8)]!);

  // Condition: panels off another car, primer, rust, sun.
  const panelsPainted: PanelPaint[] = [];
  const primer: Colour = { light: snap(at(D.flat("primer"), 0.46, 0.62), 0.02), chroma: 0.01, hue: D.u("primer.hue") < 0.3 ? 20 : 250 };
  const oddColour = (tag: string): Colour => { const k = D.pick<PaintKey>(`odd.${tag}`, others.length ? others : PAINT_TABLES[cls]); return curve(PAINT_FAMILIES[k], D.u(`odd.${tag}.t`)); };
  const side = (tag: string) => (D.u(tag) < 0.5 ? "L" : "R");
  const conditionName = type ? null : roll("Condition", (v) => {
    if (v === "Primer Hood") { panelsPainted.push({ panel: "hood", kind: "primer", colour: primer }); return "hood in primer"; }
    if (v === "Primer Bumper") { const p: Panel = D.u("pb") < 0.5 ? "bumperF" : "bumperR"; panelsPainted.push({ panel: p, kind: "primer", colour: primer }); return p === "bumperF" ? "front bumper" : "rear bumper"; }
    if (v === "Odd Door") { const p = `door${side("od")}` as Panel; const c = oddColour("door"); panelsPainted.push({ panel: p, kind: "odd", colour: c }); return p === "doorL" ? "left door" : "right door"; }
    if (v === "Odd Fender") { const p = `fenderF${side("of")}` as Panel; panelsPainted.push({ panel: p, kind: "odd", colour: oddColour("fender") }); return p === "fenderFL" ? "left fender" : "right fender"; }
    if (v === "Sun Faded") { for (const p of ["hood", "roof", "trunk"] as const) panelsPainted.push({ panel: p, kind: "faded", colour: { light: clamp(bodyC.light + 0.1, 0, 0.9), chroma: snap(bodyC.chroma * 0.45, 0.01), hue: bodyC.hue } }); return "bonnet, roof and boot"; }
    // Mismatched: three to five panels, each primer or off another car.
    const pool = PANELS.filter((p) => p !== "roof");
    const n = 3 + Math.floor(D.u("mm.n") * 3);
    const picked: Panel[] = [];
    for (let i = 0; picked.length < n && i < 40; i += 1) { const p = pool[Math.floor(D.u(`mm.${i}`) * pool.length)]!; if (!picked.includes(p)) picked.push(p); }
    for (const p of picked) panelsPainted.push({ panel: p, kind: D.u(`mm.k.${p}`) < 0.35 ? "primer" : "odd", colour: D.u(`mm.k.${p}`) < 0.35 ? primer : oddColour(p) });
    return `${picked.length} panels`;
  });
  const rustName = type ? null : roll("Rust", () => {
    const lower: Panel[] = ["quarterL", "quarterR", "fenderFL", "fenderFR", "doorL", "doorR", "bumperR"];
    const n = 1 + Math.floor(D.u("rust.n") * 3);
    const got: Panel[] = [];
    for (let i = 0; got.length < n && i < 30; i += 1) { const p = lower[Math.floor(D.u(`rust.${i}`) * lower.length)]!; if (!got.includes(p)) got.push(p); }
    for (const p of got) panelsPainted.push({ panel: p, kind: "rust", colour: { light: 0.42, chroma: 0.1, hue: 45 } });
    return `${got.length} panel${got.length > 1 ? "s" : ""}`;
  });
  void conditionName; void rustName; void roofScoopName;

  const tintName = roll("Tint")!;
  const TINTS: Readonly<Record<string, Colour>> = { Smoke: { light: 0.2, chroma: 0.02, hue: 250 }, Clear: { light: 0.34, chroma: 0.03, hue: 220 }, "Blue Tint": { light: 0.26, chroma: 0.07, hue: 245 }, Mirror: { light: 0.5, chroma: 0.02, hue: 240 }, "Purple Tint": { light: 0.24, chroma: 0.08, hue: 300 }, "Gold Tint": { light: 0.4, chroma: 0.09, hue: 80 } };
  const fixedEffect = fixed("Effect");
  const effectName = pins["Effect"] ?? (fixedEffect !== undefined ? fixedEffect : D.u("gate.Effect") < odds(EFFECT_TABLE.chance) / ONE_PPM ? D.pick("pick.Effect", lucky(EFFECT_TABLE.entries)) : null);
  const effect: Effect | null = effectName === null || effectName === "None" ? null : lookBy<Effect>({ Underglow: "underglow", "Neon Trim": "neon", "Glow Rims": "glowrims", "Light Trails": "trails" }, effectName);
  const glow = D.pick<Colour>("glow", [[{ light: 0.78, chroma: 0.14, hue: 200 }, 3], [{ light: 0.66, chroma: 0.24, hue: 340 }, 3], [{ light: 0.84, chroma: 0.22, hue: 130 }, 2], [{ light: 0.78, chroma: 0.16, hue: 75 }, 2], [{ light: 0.6, chroma: 0.2, hue: 295 }, 2]]);
  const glowName = ["cyan", "magenta", "lime", "amber", "violet"][[200, 340, 130, 75, 295].indexOf(glow.hue)] ?? "";
  if (effect) traits.push({ category: "Effect", name: effectName!, site: "Effect", ppm: entryPpm(EFFECT_TABLE, effectName!), detail: glowName });

  // Its lamps: what they burn. Every car has some, and the beam it throws takes the same colour.
  const lampName = pins["Lights"] ?? fixed("Lights") ?? D.pick("pick.Lights", lucky(LIGHT_TABLE.entries));
  const lamp = lookBy<LampKind>({ Halogen: "halogen", "LED White": "led", "Xenon Blue": "xenon", Amber: "amber", "Ice Blue": "ice", Violet: "violet", "Toxic Green": "green" }, lampName);
  const LAMP_COLOUR: Readonly<Record<LampKind, Colour>> = {
    halogen: { light: 0.92, chroma: 0.05, hue: 92 }, led: { light: 0.96, chroma: 0.015, hue: 240 }, xenon: { light: 0.92, chroma: 0.07, hue: 240 },
    amber: { light: 0.86, chroma: 0.15, hue: 70 }, ice: { light: 0.94, chroma: 0.08, hue: 215 }, violet: { light: 0.8, chroma: 0.16, hue: 300 }, green: { light: 0.88, chroma: 0.19, hue: 135 },
  };
  traits.push({ category: "Lights", name: lampName, site: "Lights", ppm: entryPpm(LIGHT_TABLE, lampName) });

  // A neon kit: tubes under the sills, round the rims, along the trim, or -- once in a while -- everywhere.
  const fixedNeon = fixed("Neon");
  const neonName = pins["Neon"] ?? (fixedNeon !== undefined ? fixedNeon : D.u("gate.Neon") < odds(NEON_TABLE.chance) / ONE_PPM ? D.pick("pick.Neon", lucky(NEON_TABLE.entries)) : null);
  const neon: NeonKit | null = neonName === null || neonName === "None" ? null : {
    name: neonName,
    run: D.pick<NeonRun>("neonRun", [["full", 6], ["ring", 3], ["front", 2], ["rear", 2]]),
    under: neonName === "Underglow" || neonName === "Under + Rims" || neonName === "Full Neon",
    rims: neonName === "Glow Rims" || neonName === "Under + Rims" || neonName === "Full Neon",
    trim: neonName === "Neon Trim" || neonName === "Full Neon",
    cabin: neonName === "Cabin Glow" || neonName === "Full Neon",
  };
  if (neon) traits.push({ category: "Neon", name: neonName!, site: "Neon", ppm: entryPpm(NEON_TABLE, neonName!), detail: glowName });

  const paints: CarPaints = {
    family: fam.name, body: bodyC, alt: altC, accent: accentC, finish, type, livery,
    liveryFreq: livery === "twin" ? 2 : livery === "stripes" ? 1 : 1 + Math.floor(D.u("liveryFreq") * 3),
    liveryAngle: livery === "slash" ? 2 + Math.floor(D.u("liveryAngle") * 2) : livery === "stripes" || livery === "twin" ? 0 : Math.floor(D.u("liveryAngle") * 8),
    liveryWidth: 2 + Math.floor(D.u("liveryWidth") * 3),
    roofLivery: roofLiveryName === "Checker Roof" ? "checks" : roofLiveryName === "Striped Roof" ? "stripes" : "none",
    wingAccent,
    glass: TINTS[tintName]!, glassScreen: D.pick("glassScreen", [["lines", 3], ["diagonal", 2], ["hatch", 1]]), mirrorGlass: tintName === "Mirror" || tintName === "Gold Tint",
    head: LAMP_COLOUR[lamp], lamp, lampName, neon,
    tail: D.pick<Colour>("tailColour", [[{ light: 0.56, chroma: 0.2, hue: 25 }, 5], [{ light: 0.64, chroma: 0.17, hue: 45 }, 1], [{ light: 0.56, chroma: 0.18, hue: 330 }, 0.5]]),
    rim: lookBy<RimPaint>({ Chrome: "chrome", Black: "black", Gunmetal: "gunmetal", Gold: "gold", White: "white", "Body Colour": "body", Bronze: "bronze" }, rimFinish),
    caliper: D.pick<Colour>("caliper", [[{ light: 0.52, chroma: 0.19, hue: 25 }, 3], [{ light: 0.82, chroma: 0.16, hue: 95 }, 2], [{ light: 0.5, chroma: 0.14, hue: 255 }, 1], [{ light: 0.3, chroma: 0.01, hue: 250 }, 2], [accentC, 1]]),
    tyre: { light: snap(at(D.flat("tyreL"), 0.14, 0.22), 0.02), chroma: 0.01, hue: 260 },
    trimChrome: D.u("trimChrome") < (muscle || cls === "gt" ? 0.6 : 0.25),
    panels: panelsPainted, effect, glow,
  };

  const parts: CarParts = {
    head, headScale: snap(at(D.flat("head.s"), 0.8, 1.25), 0.05), grille, grilleScale: snap(at(D.flat("grille.s"), 0.8, 1.2), 0.05),
    splitter: splitterName === "Race Splitter" ? "race" : splitterName ? "lip" : "none", bullbar, lightPod,
    hood: hoodName === null ? "none" : lookBy<CarParts["hood"]>({ "Hood Scoop": "scoop", "Shaker Scoop": "shaker", "Twin Scoops": "twin", "NACA Duct": "naca" }, hoodName),
    tail, spoiler, wing, exhaust, exhaustSide: D.pick<-1 | 1>("exhaustSide", [[-1, 1], [1, 1]]), pipe: snap(at(D.flat("pipe"), 0.035, 0.06), 0.005), diffuser, mudflaps,
    roof, roofScoop: roofScoopName === "Airbox" ? "airbox" : roofScoopName ? "scoop" : "none", roofRack, lightBar,
    cage: cageName === "Roll Cage" ? "cage" : cageName ? "bar" : "none", fin, snorkel,
    widebody: widebodyName === "Box Flares" ? "box" : widebodyName ? "bolt" : "none",
    intakes: intakesName === "Deep Intakes" ? "deep" : intakesName ? "side" : "none", skirts,
    arches: archName === "Cladding" ? "cladding" : archName ? "trim" : "none",
    mirrors: mirrorName === "Aero Mirrors" ? "aero" : mirrorName === "No Mirrors" ? "none" : "wing",
    twoTone: !type && D.u("twoTone") < (pickup || cls === "rally" ? 0.35 : 0.12),
    bed: pickup, crew: !!style.crew, open: !!style.open,
    // (The class leads -- a muscle car's chrome, a pickup's tubes, a hypercar's intakes -- and a draw of its own crosses
    // it now and then, so not every car of a class wears the same face.)
    bumper: D.pick<Bumper>("bumper", BUMPER_ODDS[cls] ?? [["street", 1]]),
    fogs: D.u("fogs") < (cls === "rally" ? 0.7 : cls === "hyper" || cls === "proto" ? 0.1 : 0.35),
  };

  // ------------------------------------------------ handling, from the same dials and parts
  const aero01 = (d.aero + 1) / 2 + (spoiler === "bigwing" || spoiler === "swan" ? 0.25 : spoiler === "wing" ? 0.12 : 0) + (parts.splitter === "race" ? 0.1 : 0);
  const power01 = (d.power + 1) / 2, mass01 = (d.mass + 1) / 2;
  const tyre01 = clamp((widthR - 0.17) / 0.2, 0, 1) + (tyre === "slick" ? 0.35 : tyre === "knobby" ? -0.3 : 0);
  // What it weighs, and what it has to move that weight with. A pickup is two tonnes of metal: it gets going slowly,
  // stops slowly, leans, and shoves whatever it hits -- while a kei car is half that and lives on its agility.
  const massT = snap(0.7 + 1.6 * mass01 + 0.25 * (length - 3.2) + (type === "gold" ? 0.8 : 0), 0.01);
  const massKg = Math.round(massT * 1000);
  // (Frontal area from its own size, and how slippery its shape is: a wedge cheats the air, a truck fights it.)
  const frontal = width * (belt - ride + (parts.open ? 0.15 : roofY - belt) * 0.75);
  const cd = clamp(0.42 - 0.12 * Math.min(1, aero01) + (pickup ? 0.16 : 0) + (buggy ? 0.2 : 0) - 0.06 * d.low, 0.24, 0.72);
  const drag = snap(0.5 * 1.225 * cd * frontal, 0.001);
  const handling: Handling = {
    massKg,
    // (Power at the wheels: 40 kW for a slow kei, ~600 kW for a hypercar, and heavier cars are usually given more of it.)
    power: Math.round((40 + 420 * power01 + 90 * mass01) * 1000),
    drag,
    roll: snap(0.013 + 0.006 * Math.max(0, d.ride) + (tyre === "knobby" ? 0.006 : 0), 0.001),
    brakeG: snap(clamp(0.85 + 0.35 * tyre01 + 0.2 * Math.min(1, aero01) - 0.12 * mass01, 0.55, 1.35), 0.01),
    topSpeed: snap(20 + 13 * power01 + 2 * Math.min(1, aero01) - 2 * mass01 - (buggy ? 2 : 0) - 1.5 * Math.max(0, d.roof) - (type === "rust" ? 3 : 0), 0.1),
    accel: snap(4.5 + 6 * power01 - 2.5 * mass01, 0.1),
    brake: snap(10 + 4 * Math.min(1, aero01) + 2 * tyre01 - 2 * mass01, 0.1),
    grip: snap(8 + 4 * tyre01 + 3.5 * Math.min(1.2, aero01) - 2 * mass01 - 1.2 * Math.max(0, d.ride), 0.1),
    steer: snap(at(-d.length + (kei ? 0.5 : 0), 0.42, 0.62), 0.01),
    wheelbase,
    mass: massT,
    radius: snap(Math.max(width / 2, length * 0.3), 0.01),
    halfLength: snap(length / 2, 0.01),
    halfWidth: snap(width / 2 + Math.max(0, protrude), 0.01),
  };

  const mounts: WheelMount[] = [];
  for (const [z, shape] of [[frontAxle, 0], [rearAxle, 1]] as const) for (const s of [-1, 1] as const) mounts.push({ x: s * track[shape], z, steers: shape === 0, shape, side: s });

  // A semi tractor: its own measurements, wheels, handling and forms (semi.ts) over everything drawn above.
  const rig = style.semi ? semiRig(D, d, wheelF) : null;
  // A service vehicle: the same for the bus, the fire engine, the ambulance and the dump truck; the cruiser keeps the
  // sedan it drew and wears its kit. Each wears its fleet's second colour, its livery panels, its beacons, its lettering.
  const svcRig = svc && svc !== "police" ? serviceRig(svc, D, d, wheelF) : null;
  const service = svcRig ? svcRig.service : svc === "police" ? policeParts(D, { archetype: cls, body, dials: d }) : null;
  const look = service ? serviceLook(service, D, bodyC) : null;
  if (service) decals.push(...serviceDecals(service, seed, bodyC));

  const chips = chipsOf(traits);
  const score = scoreOf(chips);
  const make = MAKES[Math.floor(D.u("make") * MAKES.length)]!;
  const models = MODELS[cls];
  const model = models[Math.floor(D.u("model") * models.length)]!;
  const trimName = D.pick("trimName", [["", 5], [" RS", 1 + aero01], [" GT", 1], [" S", 1], [" R", power01], [" Turbo", power01], [" Evo", cls === "rally" ? 2 : 0.3], [" XL", pickup ? 2 : 0]]);
  return {
    ...(options.mechanical ? { mechanical: { ...options.mechanical } } : {}),
    seed, style: style.name, archetype: cls, name: service ? `${make} ${SERVICE_MODEL[service.form] ?? service.form}` : `${make} ${model}${trimName}`, dials: d,
    body: rig ? rig.body : svcRig ? svcRig.body : body,
    parts: rig ? { ...parts, bed: false, crew: false, open: false, semi: rig.semi }
      : service ? { ...parts, ...(svcRig ? { bed: svcRig.bed ?? false, crew: false, open: false } : {}), service, ...(service.beacons.length ? { beacons: true as const } : {}) }
      : parts,
    wheels: rig ? rig.wheels : svcRig ? svcRig.wheels : [wheelF, wheelR],
    mounts: rig ? rig.mounts : svcRig ? svcRig.mounts : mounts,
    paints: rig ? { ...paints, trimChrome: true }
      : look ? { ...paints, alt: look.alt, accent: look.accent, panels: [...look.panels], trimChrome: look.trimChrome, ...(look.beacon ? { beacon: look.beacon } : {}) }
      : paints,
    decals, handling: rig ? rig.handling : svcRig ? svcRig.handling : handling,
    traits, chips, score, tier: tierOf(score),
  };
}
