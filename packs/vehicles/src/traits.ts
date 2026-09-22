// The car's TRAITS, the way the Pixel Marine's are (keel-pixel-pfps src/sites.js,
// src/rarity.js): every worn thing is a named BASE -- "Swan Neck Wing", "Deep
// Dish", "Metal Flake" -- drawn from integer-weighted tables at integer odds,
// then VARIED (draws inside each base: a wing's height and chord, a rim's spoke
// count, a stripe's width), so the same base is never the same part twice.
//
// Each trait is filed under a SITE (Front, Rear, Top, Sides, Wheels, ...), and a
// site can hold several: a nose with a race splitter AND a bull bar AND pop-ups.
// On chain the site's chip is the RARER thing there (the lowest odds; the first
// in order on a tie), "None" when it's bare; the papers list everything.
//
// Odds are parts per million, integer floors all the way (a contract can do the
// same arithmetic): a trait's odds is the chance of its table times its weight's
// share, per body style, summed over the styles weighted by their own odds -- so
// a Big Wing is common on a prototype and rare on a kei, and its chip says how
// rare it is across every car. The score is the marine's: half-octave points
// (x181/128 until certain) over a FIXED vector of chips, None included.

import type { Archetype } from "./car.ts";

export const ONE_PPM = 1_000_000;

/** How many half-octaves lift ppm to certainty (the marine's points(): Shannon information in half-bits, integer only). */
export function points(ppm: number): number {
  if (ppm <= 0 || ppm >= ONE_PPM) return 0;
  let x = ppm, p = 0;
  while (x < ONE_PPM) { x = Math.floor((x * 181 + 127) / 128); p += 1; }
  return p;
}

/** The sites a car's chips are filed under, in the order they're scored and shown. */
export const SITES = ["Body", "Stance", "Paint", "Finish", "Livery", "Decals", "Condition", "Front", "Rear", "Top", "Sides", "Wheels", "Rim Finish", "Rim Size", "Spinner", "Tint", "Lights", "Neon", "Effect"] as const;
export type Site = (typeof SITES)[number];

/** A table: a presence chance (ppm; ONE_PPM is always) and integer weights. */
export interface Table { readonly chance: number; readonly entries: ReadonlyArray<readonly [string, number]> }
const T = (chance: number, entries: ReadonlyArray<readonly [string, number]>): Table => ({ chance, entries: entries.filter(([, w]) => w > 0) });
const ALWAYS = ONE_PPM;
const NEVER = T(0, []);

// ---------------------------------------------------------------- body styles: the base, with presets

export interface BodyStyle {
  readonly name: string;
  readonly cls: Archetype;
  readonly weight: number;
  /** Dial presets (-1..1) the style centres on; every dial is jittered round them. */
  readonly dials: Readonly<Record<string, number>>;
  /** Traits the style forces (category -> name). */
  readonly force?: Readonly<Record<string, string>>;
  readonly open?: boolean;
  readonly crew?: boolean;
  /** A semi tractor (car.ts's semiRig): its own measurements and body (shapes.ts's semiSolids), not the car's. */
  readonly semi?: boolean;
}

export const BODY_STYLES: readonly BodyStyle[] = [
  { name: "Wedge Hyper", cls: "hyper", weight: 30, dials: { rake: 1, low: 1, round: -0.4 } },
  { name: "Bubble Hyper", cls: "hyper", weight: 20, dials: { round: 0.9, roof: -0.2, fast: 0.9, rake: 0.6 } },
  { name: "Longtail Hyper", cls: "hyper", weight: 10, dials: { length: 0.95, fast: 1, aero: 0.8 } },
  { name: "Hyper Roadster", cls: "hyper", weight: 6, dials: { roof: -1 }, open: true, force: { Roof: "Open Top" } },
  { name: "Fastback GT", cls: "gt", weight: 30, dials: { fast: 0.8 } },
  { name: "Grand Tourer", cls: "gt", weight: 25, dials: { fast: 0.1, hood: 0.9, length: 0.8 } },
  { name: "Shooting Brake", cls: "gt", weight: 8, dials: { fast: -1, roof: 0.1, length: 0.7 } },
  { name: "GT Convertible", cls: "gt", weight: 7, dials: { roof: -0.6 }, open: true, force: { Roof: "Open Top" } },
  { name: "Time Attack", cls: "gt", weight: 4, dials: { aero: 1, flare: 1, low: 0.8, power: 0.9 }, force: { Spoiler: "Big Wing", Splitter: "Race Splitter" } },
  { name: "Muscle Coupe", cls: "muscle", weight: 30, dials: {} },
  { name: "Fastback Muscle", cls: "muscle", weight: 18, dials: { fast: 0.5, rake: 0.3 } },
  { name: "Pro Street", cls: "muscle", weight: 6, dials: { stagger: 1, flare: 1, power: 1 }, force: { Tyres: "Slicks" } },
  { name: "Hot Hatch", cls: "rally", weight: 30, dials: { length: -0.8, fast: -1 } },
  { name: "Rally Coupe", cls: "rally", weight: 18, dials: { fast: 0.1, length: -0.2 } },
  { name: "Group B", cls: "rally", weight: 5, dials: { flare: 1, aero: 1, power: 1, length: -0.6 }, force: { Widebody: "Box Flares" } },
  { name: "Kei Box", cls: "kei", weight: 20, dials: { roof: 1, fast: -1 } },
  { name: "Micro", cls: "kei", weight: 10, dials: { length: -1, width: -1, roof: 0.6 } },
  { name: "Kei Roadster", cls: "kei", weight: 4, dials: { roof: -0.8, low: 0.2 }, open: true, force: { Roof: "Open Top" } },
  { name: "Pickup", cls: "pickup", weight: 20, dials: {} },
  { name: "Crew Cab", cls: "pickup", weight: 8, dials: { length: 1 }, crew: true },
  { name: "Baja Truck", cls: "pickup", weight: 5, dials: { ride: 1, flare: 1, wheel: 1, power: 0.8 }, force: { Tyres: "Knobby" } },
  { name: "Dune Buggy", cls: "buggy", weight: 12, dials: {} },
  { name: "Sand Rail", cls: "buggy", weight: 5, dials: { length: 0.4, low: 0.3, power: 0.6 } },
  { name: "Le Mans Prototype", cls: "proto", weight: 10, dials: {} },
  { name: "Group C", cls: "proto", weight: 4, dials: { round: 1, fast: 1, aero: 0.6 } },
];

/**
 * Styles outside the draw: never picked for a seed, never minted, in no odds and no count -- a game asks for one by
 * name (`generateCar(seed, { style })`) when its world needs a vehicle that isn't a car to own. Paint, finish, livery,
 * decals, lamps and rims are drawn as for any car of the class; what doesn't belong on it is forced off.
 */
export const SPECIAL_STYLES: readonly BodyStyle[] = [
  // A conventional semi tractor -- a long bonnet, a tall cab (a sleeper behind it, or not), twin stacks, fuel tanks, a
  // tandem of drive axles and a fifth wheel for a trailer: what pulls a billboard down the road.
  {
    name: "Semi Truck", cls: "pickup", weight: 0, dials: { length: 0.4, power: 0.6, mass: 1 }, semi: true,
    force: {
      Stance: "Stock", Exhaust: "Stacks", Spoiler: "None", Splitter: "None", "Bull Bar": "None", "Light Pod": "None", Hood: "None", Diffuser: "None",
      Mudflaps: "Mudflaps", Roof: "Hardtop", "Roof Scoop": "None", "Roof Rack": "None", "Light Bar": "None", Cage: "None", Fin: "None", Snorkel: "None",
      Widebody: "None", Intakes: "None", Skirts: "None", Arches: "None", Mirrors: "Wing Mirrors", Rims: "Dish", Tyres: "Street", "Roof Livery": "None",
      "Race Number": "None", "Shark Teeth": "None", Condition: "None", Rust: "None",
    },
  },
  // A PACE CAR: the four-square saloon that leads a field round and peels off before the flag. Long, upright and
  // deliberately unexciting -- nothing on it is for going fast, because its whole job is to go slowly in front of
  // cars that are. Weight 0 keeps it out of the draw, so no seed can roll one and nobody can own one.
  {
    name: "Sports Sedan", cls: "gt", weight: 0, dials: { length: 0.55, roof: 0.3, fast: -0.6, low: -0.2, aero: -0.8, flare: -0.6 },
    force: {
      Spoiler: "None", Splitter: "None", Diffuser: "None", Widebody: "None", Skirts: "None", Arches: "None",
      "Bull Bar": "None", "Light Pod": "None", Hood: "None", Snorkel: "None", Fin: "None", Cage: "None",
      "Roof Scoop": "None", "Roof Rack": "None", Mudflaps: "None", Intakes: "None",
      Stance: "Stock", Exhaust: "Single Pipe", Tyres: "Street", Rims: "Dish", Condition: "None", Rust: "None",
    },
  },
];

// ---------------------------------------------------------------- the tables, per class

type ByClass = Readonly<Partial<Record<Archetype, Table>>>;

/** Every category: its site, and its table per class (a class without one never draws it). */
export interface Category { readonly name: string; readonly site: Site; readonly tables: ByClass; readonly sites?: Readonly<Record<string, Site>> }

const all = (t: Table): ByClass => ({ hyper: t, gt: t, muscle: t, rally: t, kei: t, pickup: t, buggy: t, proto: t });

export const CATEGORIES: readonly Category[] = [
  { name: "Stance", site: "Stance", tables: {
    ...all(T(ALWAYS, [["Stock", 60], ["Lowered", 25], ["Slammed", 8], ["Lifted", 2]])),
    pickup: T(ALWAYS, [["Stock", 50], ["Lifted", 35], ["Prerunner", 10], ["Lowered", 5]]),
    buggy: T(ALWAYS, [["Stock", 55], ["Lifted", 30], ["Prerunner", 15]]),
    proto: T(ALWAYS, [["Race Height", 90], ["Slammed", 10]]),
  } },
  // ---- Front
  { name: "Headlights", site: "Front", tables: {
    hyper: T(ALWAYS, [["Slit Eyes", 30], ["Light Bar", 25], ["Twin Pods", 20], ["Pop-Ups", 6], ["Quad Round", 2]]),
    gt: T(ALWAYS, [["Twin Pods", 35], ["Round Eyes", 15], ["Pop-Ups", 10], ["Slit Eyes", 15], ["Light Bar", 10]]),
    muscle: T(ALWAYS, [["Quad Round", 30], ["Round Eyes", 30], ["Twin Pods", 20], ["Pop-Ups", 5]]),
    rally: T(ALWAYS, [["Round Eyes", 25], ["Twin Pods", 30], ["Quad Round", 15], ["Light Bar", 10]]),
    kei: T(ALWAYS, [["Round Eyes", 45], ["Twin Pods", 30], ["Frog Eyes", 8]]),
    pickup: T(ALWAYS, [["Twin Pods", 40], ["Quad Round", 25], ["Round Eyes", 20], ["Light Bar", 10]]),
    buggy: T(ALWAYS, [["Round Eyes", 50], ["Light Bar", 25], ["Frog Eyes", 10]]),
    proto: T(ALWAYS, [["Slit Eyes", 50], ["Light Bar", 35], ["Twin Pods", 10]]),
  } },
  { name: "Grille", site: "Front", tables: {
    ...all(T(ALWAYS, [["Mesh Grille", 30], ["Slat Grille", 25], ["Egg Crate", 12], ["Smooth Nose", 20], ["Split Grille", 8], ["Chrome Grille", 3]])),
    muscle: T(ALWAYS, [["Slat Grille", 30], ["Egg Crate", 20], ["Shark Nose", 15], ["Chrome Grille", 10], ["Mesh Grille", 10]]),
    pickup: T(ALWAYS, [["Slat Grille", 35], ["Chrome Grille", 15], ["Egg Crate", 20], ["Mesh Grille", 20]]),
    proto: T(ALWAYS, [["Smooth Nose", 60], ["Mesh Grille", 40]]),
    buggy: T(ALWAYS, [["Smooth Nose", 70], ["Mesh Grille", 30]]),
  } },
  { name: "Splitter", site: "Front", tables: {
    hyper: T(450_000, [["Lip Splitter", 3], ["Race Splitter", 2]]), gt: T(200_000, [["Lip Splitter", 4], ["Race Splitter", 1]]), muscle: T(120_000, [["Lip Splitter", 1]]),
    rally: T(350_000, [["Lip Splitter", 2], ["Race Splitter", 1]]), kei: T(50_000, [["Lip Splitter", 1]]), pickup: T(20_000, [["Lip Splitter", 1]]), proto: T(950_000, [["Race Splitter", 1]]),
  } },
  { name: "Bull Bar", site: "Front", tables: { pickup: T(300_000, [["Bull Bar", 1]]), buggy: T(400_000, [["Bull Bar", 1]]), rally: T(60_000, [["Bull Bar", 1]]) } },
  { name: "Light Pod", site: "Front", tables: { rally: T(350_000, [["Light Pod", 1]]), pickup: T(150_000, [["Light Pod", 1]]), buggy: T(300_000, [["Light Pod", 1]]) } },
  { name: "Hood", site: "Front", tables: {
    muscle: T(450_000, [["Hood Scoop", 5], ["Shaker Scoop", 2], ["Twin Scoops", 1]]), rally: T(150_000, [["NACA Duct", 2], ["Hood Scoop", 1]]), gt: T(80_000, [["NACA Duct", 1]]),
    hyper: T(100_000, [["NACA Duct", 1]]), pickup: T(120_000, [["Hood Scoop", 1]]), kei: T(20_000, [["Hood Scoop", 1]]),
  } },
  // Rare coachwork uses the same seeded category rolls and rarity chips as every other part.
  { name: "Engine Bay", site: "Front", tables: all(T(1_000, [["Open Engine Bay", 3], ["Velocity Stacks", 1]])) },
  // ---- Rear
  { name: "Tail Lights", site: "Rear", tables: {
    ...all(T(ALWAYS, [["Light Bar", 25], ["Blocks", 35], ["Round Twins", 15], ["Split Bar", 15], ["Quad Round", 4], ["Slim Line", 10]])),
    muscle: T(ALWAYS, [["Blocks", 30], ["Round Twins", 25], ["Quad Round", 15], ["Light Bar", 15]]),
  } },
  { name: "Spoiler", site: "Rear", tables: {
    hyper: T(650_000, [["Wing", 30], ["Big Wing", 12], ["Ducktail", 10], ["Lip Spoiler", 20], ["Swan Neck Wing", 6]]),
    gt: T(400_000, [["Lip Spoiler", 30], ["Ducktail", 25], ["Wing", 10], ["Whale Tail", 5]]),
    muscle: T(450_000, [["Lip Spoiler", 20], ["Ducktail", 30], ["Wing", 15], ["Whale Tail", 3]]),
    rally: T(700_000, [["Wing", 40], ["Big Wing", 10], ["Roof Spoiler", 25], ["Lip Spoiler", 10]]),
    kei: T(150_000, [["Roof Spoiler", 30], ["Lip Spoiler", 20]]),
    proto: T(ALWAYS, [["Big Wing", 40], ["Swan Neck Wing", 25], ["Wing", 10]]),
  } },
  { name: "Exhaust", site: "Rear", sites: { "Side Pipes": "Sides", Stacks: "Top" }, tables: {
    hyper: T(ALWAYS, [["Center Exit", 30], ["Twin Pipes", 30], ["Quad Pipes", 20], ["Single Pipe", 10]]),
    gt: T(ALWAYS, [["Twin Pipes", 40], ["Quad Pipes", 30], ["Single Pipe", 10]]),
    muscle: T(ALWAYS, [["Twin Pipes", 35], ["Quad Pipes", 15], ["Side Pipes", 15], ["Stacks", 5]]),
    rally: T(ALWAYS, [["Single Pipe", 40], ["Twin Pipes", 20], ["Center Exit", 10]]),
    kei: T(700_000, [["Single Pipe", 1]]),
    pickup: T(ALWAYS, [["Single Pipe", 40], ["Twin Pipes", 30], ["Stacks", 8], ["Side Pipes", 5]]),
    buggy: T(ALWAYS, [["Single Pipe", 30], ["Stacks", 20], ["Twin Pipes", 20]]),
    proto: T(ALWAYS, [["Center Exit", 40], ["Twin Pipes", 30], ["Side Pipes", 10]]),
  } },
  { name: "Diffuser", site: "Rear", tables: { hyper: T(700_000, [["Diffuser", 1]]), gt: T(250_000, [["Diffuser", 1]]), muscle: T(50_000, [["Diffuser", 1]]), rally: T(200_000, [["Diffuser", 1]]), kei: T(20_000, [["Diffuser", 1]]), proto: T(ALWAYS, [["Diffuser", 1]]) } },
  { name: "Mudflaps", site: "Rear", tables: { rally: T(500_000, [["Mudflaps", 1]]), pickup: T(400_000, [["Mudflaps", 1]]), buggy: T(100_000, [["Mudflaps", 1]]) } },
  // ---- Top
  { name: "Roof", site: "Top", tables: {
    ...all(T(ALWAYS, [["Hardtop", 70], ["Contrast Roof", 12], ["Glass Roof", 6], ["Vinyl Top", 4], ["Carbon Roof", 3]])),
    muscle: T(ALWAYS, [["Hardtop", 60], ["Vinyl Top", 20], ["Contrast Roof", 15]]),
    hyper: T(ALWAYS, [["Hardtop", 55], ["Carbon Roof", 20], ["Glass Roof", 10], ["Contrast Roof", 10]]),
    proto: T(ALWAYS, [["Hardtop", 60], ["Carbon Roof", 40]]),
    kei: T(ALWAYS, [["Hardtop", 55], ["Contrast Roof", 35], ["Glass Roof", 5]]),
    buggy: T(ALWAYS, [["Hardtop", 1]]),
  } },
  { name: "Roof Scoop", site: "Top", tables: { rally: T(300_000, [["Roof Scoop", 1]]), kei: T(50_000, [["Roof Scoop", 1]]), hyper: T(60_000, [["Roof Scoop", 1]]), proto: T(300_000, [["Airbox", 1]]) } },
  { name: "Roof Rack", site: "Top", tables: { pickup: T(150_000, [["Roof Rack", 1]]), kei: T(80_000, [["Roof Rack", 1]]), rally: T(60_000, [["Roof Rack", 1]]), gt: T(20_000, [["Roof Rack", 1]]) } },
  { name: "Light Bar", site: "Top", tables: { pickup: T(250_000, [["Roof Light Bar", 1]]), buggy: T(350_000, [["Roof Light Bar", 1]]), rally: T(100_000, [["Roof Light Bar", 1]]) } },
  { name: "Cage", site: "Top", tables: { buggy: T(ALWAYS, [["Roll Cage", 1]]), pickup: T(150_000, [["Roll Bar", 1]]), rally: T(50_000, [["Roll Bar", 1]]) } },
  { name: "Fin", site: "Top", tables: { proto: T(450_000, [["Shark Fin", 1]]), hyper: T(60_000, [["Shark Fin", 1]]) } },
  { name: "Snorkel", site: "Top", tables: { pickup: T(100_000, [["Snorkel", 1]]), rally: T(40_000, [["Snorkel", 1]]), buggy: T(80_000, [["Snorkel", 1]]) } },
  // ---- Sides
  { name: "Widebody", site: "Sides", tables: {
    muscle: T(150_000, [["Box Flares", 2], ["Bolt-on Flares", 1]]), rally: T(350_000, [["Box Flares", 3], ["Bolt-on Flares", 1]]), hyper: T(150_000, [["Bolt-on Flares", 1]]),
    gt: T(60_000, [["Bolt-on Flares", 1]]), pickup: T(250_000, [["Box Flares", 1]]), proto: T(200_000, [["Box Flares", 1]]), kei: T(40_000, [["Bolt-on Flares", 1]]),
  } },
  { name: "Intakes", site: "Sides", tables: { hyper: T(800_000, [["Side Intakes", 3], ["Deep Intakes", 1]]), proto: T(700_000, [["Side Intakes", 1]]), gt: T(200_000, [["Side Intakes", 1]]), muscle: T(60_000, [["Side Intakes", 1]]), rally: T(60_000, [["Side Intakes", 1]]) } },
  { name: "Skirts", site: "Sides", tables: { hyper: T(500_000, [["Side Skirts", 1]]), gt: T(250_000, [["Side Skirts", 1]]), rally: T(250_000, [["Side Skirts", 1]]), proto: T(800_000, [["Side Skirts", 1]]), muscle: T(150_000, [["Side Skirts", 1]]), kei: T(60_000, [["Side Skirts", 1]]) } },
  { name: "Arches", site: "Sides", tables: { ...all(T(350_000, [["Arch Trim", 1]])), pickup: T(600_000, [["Cladding", 1]]), buggy: NEVER } },
  { name: "Mirrors", site: "Sides", tables: { ...all(T(ALWAYS, [["Wing Mirrors", 80], ["Aero Mirrors", 15], ["No Mirrors", 5]])), proto: T(ALWAYS, [["No Mirrors", 60], ["Aero Mirrors", 40]]), buggy: T(ALWAYS, [["No Mirrors", 70], ["Wing Mirrors", 30]]) } },
  // ---- Wheels
  { name: "Rims", site: "Wheels", tables: {
    ...all(T(ALWAYS, [["5 Spoke", 30], ["Split Spoke", 20], ["Mesh", 12], ["Dish", 10], ["Turbofan", 6], ["Star", 12], ["Steelies", 4], ["Deep Dish", 4], ["Monoblock", 5], ["Wire Spoke", 2]])),
    hyper: T(ALWAYS, [["Split Spoke", 30], ["5 Spoke", 20], ["Turbofan", 15], ["Monoblock", 15], ["Mesh", 10], ["Star", 10]]),
    muscle: T(ALWAYS, [["Star", 25], ["Deep Dish", 15], ["5 Spoke", 20], ["Wire Spoke", 8], ["Steelies", 10], ["Dish", 10]]),
    kei: T(ALWAYS, [["Steelies", 25], ["Dish", 30], ["5 Spoke", 20], ["Deep Dish", 8], ["Mesh", 10]]),
    pickup: T(ALWAYS, [["Steelies", 30], ["Dish", 25], ["5 Spoke", 20], ["Star", 15], ["Deep Dish", 10]]),
    buggy: T(ALWAYS, [["Dish", 35], ["Steelies", 35], ["Monoblock", 20], ["Star", 10]]),
    proto: T(ALWAYS, [["Turbofan", 35], ["Monoblock", 35], ["Split Spoke", 20], ["Mesh", 10]]),
  } },
  { name: "Tyres", site: "Wheels", tables: {
    ...all(T(ALWAYS, [["Street", 70], ["Slicks", 8], ["Raised Letters", 6], ["White Walls", 2], ["Stretched", 3], ["Knobby", 1]])),
    hyper: T(ALWAYS, [["Street", 60], ["Slicks", 30], ["Stretched", 5]]),
    proto: T(ALWAYS, [["Slicks", 85], ["Street", 15]]),
    muscle: T(ALWAYS, [["Street", 50], ["Raised Letters", 25], ["White Walls", 10], ["Slicks", 10]]),
    kei: T(ALWAYS, [["Street", 70], ["Stretched", 15], ["White Walls", 8]]),
    pickup: T(ALWAYS, [["Street", 50], ["Knobby", 35], ["Raised Letters", 15]]),
    buggy: T(ALWAYS, [["Knobby", 80], ["Street", 20]]),
  } },
  { name: "Rim Finish", site: "Rim Finish", tables: all(T(ALWAYS, [["Chrome", 30], ["Black", 25], ["Gunmetal", 20], ["Gold", 8], ["White", 8], ["Body Colour", 7], ["Bronze", 7]])) },
  // ---- Paint
  { name: "Finish", site: "Finish", tables: {
    ...all(T(ALWAYS, [["Gloss", 50], ["Pearl", 20], ["Matte", 12], ["Satin", 12], ["Metal Flake", 8], ["Candy", 8], ["Chameleon", 2]])),
    hyper: T(ALWAYS, [["Gloss", 40], ["Matte", 25], ["Pearl", 15], ["Satin", 10], ["Chameleon", 4], ["Candy", 6]]),
    muscle: T(ALWAYS, [["Gloss", 45], ["Metal Flake", 20], ["Candy", 15], ["Satin", 10], ["Matte", 5]]),
    pickup: T(ALWAYS, [["Gloss", 45], ["Satin", 25], ["Matte", 25], ["Metal Flake", 5]]),
  } },
  { name: "Livery", site: "Livery", tables: {
    ...all(T(450_000, [["Racing Stripes", 30], ["Twin Stripes", 15], ["Side Bands", 15], ["Checkers", 4], ["Fade", 12], ["Camo", 3], ["Spots", 1], ["Pinstripe", 10], ["Slash", 6]])),
    muscle: T(600_000, [["Racing Stripes", 60], ["Twin Stripes", 40], ["Pinstripe", 15], ["Fade", 5]]),
    rally: T(650_000, [["Side Bands", 40], ["Slash", 25], ["Racing Stripes", 15], ["Checkers", 8], ["Fade", 10]]),
    pickup: T(350_000, [["Camo", 30], ["Side Bands", 20], ["Pinstripe", 20], ["Fade", 10]]),
    buggy: T(400_000, [["Camo", 20], ["Checkers", 15], ["Side Bands", 30], ["Slash", 20]]),
    proto: T(800_000, [["Side Bands", 30], ["Slash", 30], ["Fade", 20], ["Checkers", 10], ["Racing Stripes", 10]]),
  } },
  { name: "Roof Livery", site: "Livery", tables: { ...all(T(80_000, [["Checker Roof", 3], ["Striped Roof", 5]])), buggy: NEVER } },
  { name: "Tint", site: "Tint", tables: all(T(ALWAYS, [["Smoke", 45], ["Clear", 25], ["Blue Tint", 15], ["Mirror", 8], ["Purple Tint", 4], ["Gold Tint", 3]])) },
  // ---- Decals: each its own roll, so a car can wear several (a number AND sponsors AND flames); the rarest takes the chip.
  { name: "Race Number", site: "Decals", tables: { rally: T(400_000, [["Race Number", 1]]), proto: T(700_000, [["Race Number", 1]]), muscle: T(80_000, [["Race Number", 1]]), hyper: T(60_000, [["Race Number", 1]]), gt: T(60_000, [["Race Number", 1]]), buggy: T(300_000, [["Race Number", 1]]), kei: T(30_000, [["Race Number", 1]]), pickup: T(20_000, [["Race Number", 1]]) } },
  { name: "Sponsors", site: "Decals", tables: { rally: T(450_000, [["Sponsor Stickers", 1]]), proto: T(600_000, [["Sponsor Stickers", 1]]), hyper: T(100_000, [["Sponsor Stickers", 1]]), buggy: T(250_000, [["Sponsor Stickers", 1]]), gt: T(50_000, [["Sponsor Stickers", 1]]), muscle: T(50_000, [["Sponsor Stickers", 1]]), kei: T(60_000, [["Sponsor Stickers", 1]]), pickup: T(40_000, [["Sponsor Stickers", 1]]) } },
  { name: "Flames", site: "Decals", tables: { ...all(T(10_000, [["Flames", 1]])), muscle: T(90_000, [["Flames", 1]]), pickup: T(60_000, [["Flames", 1]]), kei: T(20_000, [["Flames", 1]]), hyper: T(15_000, [["Flames", 1]]) } },
  { name: "Shark Teeth", site: "Decals", tables: { proto: T(40_000, [["Shark Teeth", 1]]), gt: T(20_000, [["Shark Teeth", 1]]), hyper: T(20_000, [["Shark Teeth", 1]]), muscle: T(20_000, [["Shark Teeth", 1]]) } },
  { name: "Bolt", site: "Decals", tables: { kei: T(60_000, [["Lightning Bolt", 1]]), rally: T(40_000, [["Lightning Bolt", 1]]), muscle: T(30_000, [["Lightning Bolt", 1]]), hyper: T(20_000, [["Lightning Bolt", 1]]), buggy: T(30_000, [["Lightning Bolt", 1]]) } },
  { name: "Starburst", site: "Decals", tables: { kei: T(30_000, [["Starburst", 1]]), gt: T(10_000, [["Starburst", 1]]), rally: T(20_000, [["Starburst", 1]]), hyper: T(10_000, [["Starburst", 1]]) } },
  { name: "Checkered", site: "Decals", tables: { ...all(T(20_000, [["Checkered Flag", 1]])), proto: T(80_000, [["Checkered Flag", 1]]), rally: T(60_000, [["Checkered Flag", 1]]), buggy: T(80_000, [["Checkered Flag", 1]]) } },
  { name: "Skull", site: "Decals", tables: { ...all(T(8_000, [["Skull", 1]])), pickup: T(30_000, [["Skull", 1]]), buggy: T(40_000, [["Skull", 1]]), muscle: T(30_000, [["Skull", 1]]) } },
  { name: "Stars", site: "Decals", tables: { ...all(T(10_000, [["Stars", 1]])), muscle: T(30_000, [["Stars", 1]]), pickup: T(40_000, [["Stars", 1]]), kei: T(20_000, [["Stars", 1]]) } },
  { name: "Tribal", site: "Decals", tables: { hyper: T(20_000, [["Tribal", 1]]), kei: T(20_000, [["Tribal", 1]]), pickup: T(20_000, [["Tribal", 1]]), muscle: T(20_000, [["Tribal", 1]]), rally: T(10_000, [["Tribal", 1]]) } },
  { name: "Tag", site: "Decals", tables: { ...all(T(8_000, [["Graffiti Tag", 1]])), kei: T(15_000, [["Graffiti Tag", 1]]), pickup: T(25_000, [["Graffiti Tag", 1]]), buggy: T(20_000, [["Graffiti Tag", 1]]) } },
  // ---- Condition: very rare on a hypercar, less so on a work truck -- a primer bonnet, a door off another car, rust.
  { name: "Condition", site: "Condition", tables: {
    pickup: T(120_000, [["Primer Hood", 4], ["Odd Door", 3], ["Odd Fender", 3], ["Sun Faded", 3], ["Mismatched Panels", 2], ["Primer Bumper", 3]]),
    kei: T(60_000, [["Odd Door", 3], ["Primer Hood", 2], ["Sun Faded", 3], ["Mismatched Panels", 2], ["Primer Bumper", 2]]),
    muscle: T(50_000, [["Primer Hood", 4], ["Odd Fender", 2], ["Odd Door", 2], ["Mismatched Panels", 1], ["Sun Faded", 2]]),
    rally: T(40_000, [["Odd Door", 3], ["Primer Bumper", 3], ["Mismatched Panels", 2], ["Odd Fender", 2]]),
    buggy: T(80_000, [["Primer Hood", 3], ["Sun Faded", 4], ["Mismatched Panels", 1]]),
    gt: T(10_000, [["Sun Faded", 3], ["Odd Door", 1], ["Primer Bumper", 1]]),
    hyper: T(5_000, [["Odd Door", 1], ["Primer Bumper", 1]]),
    proto: T(3_000, [["Mismatched Panels", 1]]),
  } },
  { name: "Rust", site: "Condition", tables: { pickup: T(60_000, [["Rust Patches", 1]]), kei: T(30_000, [["Rust Patches", 1]]), muscle: T(30_000, [["Rust Patches", 1]]), buggy: T(50_000, [["Rust Patches", 1]]), rally: T(20_000, [["Rust Patches", 1]]), gt: T(5_000, [["Rust Patches", 1]]) } },
];

/** The rare kinds: a type replaces the paint (and, as the marine's, its chip takes the Paint site; Type is shown, not scored). */
export const TYPE_TABLE = T(15_000, [["Gold Plated", 3], ["Chrome", 3], ["Full Carbon", 4], ["Rust Bucket", 4], ["Hologram", 1], ["Stealth", 3]]);
/** The animated kinds, drawn by the game from the chip (the ground's glow, trails; the trim's and rims' glow). */
export const EFFECT_TABLE = T(35_000, [["Underglow", 5], ["Neon Trim", 3], ["Glow Rims", 3], ["Light Trails", 2]]);
/** How big the rims are: the wheel keeps its overall size, so a bigger rim wears a thinner tyre and fills the arch. */
export const RIM_SIZE_TABLE = T(ALWAYS, [['15"', 6], ['16"', 9], ['17"', 11], ['18"', 11], ['19"', 8], ['20"', 5], ['22"', 3], ['24"', 1]]);
/** A rim that turns on its own: a spinner keeps going when the car stops. */
export const SPINNER_TABLE = T(60_000, [["Spinners", 6], ["Floaters", 3], ["Knock-Offs", 4]]);
/** What its lamps burn: every car has one (the beam it throws takes this colour too). */
export const LIGHT_TABLE = T(ALWAYS, [["Halogen", 26], ["LED White", 20], ["Xenon Blue", 14], ["Amber", 8], ["Ice Blue", 5], ["Violet", 3], ["Toxic Green", 2]]);
/** A neon kit under it, on its rims, round its trim -- and, at its wildest, everywhere at once. */
export const NEON_TABLE = T(140_000, [["Underglow", 7], ["Glow Rims", 5], ["Under + Rims", 4], ["Neon Trim", 3], ["Cabin Glow", 2], ["Full Neon", 1]]);
/** A wing's accent: only where there's a wing. */
export const WING_ACCENT_CHANCE = 400_000;
export const WINGS = new Set(["Wing", "Big Wing", "Swan Neck Wing"]);

// ---------------------------------------------------------------- paint families, named

export interface PaintFamily { readonly name: string; readonly v0: number; readonly v1: number; readonly h0: number; readonly h1: number; readonly c0: number; readonly c1: number; readonly bump: number }
const F = (name: string, v0: number, v1: number, h0: number, h1: number, c0: number, c1: number, bump = 0.02): PaintFamily => ({ name, v0, v1, h0, h1, c0, c1, bump });
export const PAINT_FAMILIES = {
  acid: F("Acid Green", 0.62, 0.78, 118, 132, 0.16, 0.22), orange: F("Blaze Orange", 0.6, 0.72, 42, 58, 0.15, 0.2), yellow: F("Signal Yellow", 0.8, 0.88, 92, 104, 0.14, 0.18),
  white: F("Glacier White", 0.88, 0.94, 240, 260, 0, 0.02, 0), black: F("Midnight Black", 0.16, 0.24, 250, 280, 0, 0.02, 0), silver: F("Liquid Silver", 0.62, 0.76, 230, 260, 0.01, 0.02, 0),
  gunmetal: F("Gunmetal", 0.36, 0.46, 235, 255, 0.01, 0.03, 0), electric: F("Electric Blue", 0.5, 0.62, 248, 266, 0.13, 0.18), magenta: F("Hot Magenta", 0.54, 0.64, 338, 356, 0.17, 0.21),
  racingGreen: F("Racing Green", 0.3, 0.4, 150, 162, 0.06, 0.09), navy: F("Deep Navy", 0.28, 0.38, 255, 268, 0.07, 0.11), burgundy: F("Burgundy", 0.3, 0.4, 8, 20, 0.1, 0.13),
  red: F("Rosso Red", 0.48, 0.58, 22, 32, 0.17, 0.21), blue: F("Royal Blue", 0.44, 0.56, 245, 258, 0.12, 0.16), olive: F("Army Olive", 0.4, 0.5, 105, 118, 0.06, 0.09),
  purple: F("Plum Crazy", 0.36, 0.48, 300, 318, 0.12, 0.16), lime: F("Lime Rush", 0.78, 0.86, 125, 135, 0.18, 0.22), mint: F("Mint", 0.8, 0.88, 160, 172, 0.05, 0.08),
  babyBlue: F("Baby Blue", 0.78, 0.86, 222, 236, 0.05, 0.08), cream: F("Cream", 0.86, 0.92, 80, 92, 0.03, 0.05, 0.01), pink: F("Bubblegum", 0.76, 0.84, 345, 358, 0.07, 0.1),
  tan: F("Desert Tan", 0.56, 0.66, 62, 76, 0.04, 0.07), forest: F("Forest", 0.32, 0.42, 138, 150, 0.05, 0.08), brick: F("Brick", 0.42, 0.52, 28, 38, 0.1, 0.13),
  rust: F("Copper Rust", 0.5, 0.58, 45, 55, 0.11, 0.14), sand: F("Dune Sand", 0.72, 0.8, 72, 84, 0.06, 0.09), sky: F("Sky", 0.66, 0.76, 225, 240, 0.09, 0.12),
  teal: F("Teal", 0.5, 0.62, 185, 198, 0.09, 0.12), copper: F("Copper", 0.5, 0.62, 48, 60, 0.09, 0.12),
} as const;
export type PaintKey = keyof typeof PAINT_FAMILIES;

export const PAINT_TABLES: Readonly<Record<Archetype, ReadonlyArray<readonly [PaintKey, number]>>> = {
  hyper: [["acid", 30], ["orange", 30], ["yellow", 20], ["white", 20], ["black", 20], ["electric", 20], ["magenta", 10], ["silver", 10], ["teal", 10]],
  gt: [["silver", 30], ["gunmetal", 20], ["racingGreen", 20], ["navy", 20], ["burgundy", 20], ["white", 20], ["black", 20], ["copper", 10]],
  muscle: [["red", 30], ["black", 30], ["orange", 15], ["blue", 20], ["olive", 10], ["yellow", 10], ["purple", 15], ["white", 10]],
  rally: [["white", 30], ["blue", 30], ["yellow", 20], ["red", 20], ["lime", 10], ["electric", 10]],
  kei: [["mint", 30], ["babyBlue", 30], ["cream", 30], ["pink", 20], ["yellow", 10], ["white", 10], ["red", 10]],
  pickup: [["tan", 20], ["forest", 20], ["brick", 20], ["white", 20], ["black", 20], ["rust", 15], ["navy", 10], ["olive", 10]],
  buggy: [["sand", 30], ["orange", 20], ["lime", 20], ["red", 15], ["sky", 15], ["yellow", 10]],
  proto: [["white", 30], ["red", 20], ["electric", 20], ["black", 20], ["silver", 10], ["acid", 10], ["orange", 10]],
};

// ---------------------------------------------------------------- odds, integer

const sumW = (e: ReadonlyArray<readonly [unknown, number]>): number => e.reduce((a, [, w]) => a + w, 0);
/** The table's odds for one entry, ppm: chance x weight share, floored (the marine's oddsOf). */
export const entryPpm = (t: Table, name: string): number => {
  const e = t.entries.find(([n]) => n === name);
  return e ? Math.floor((t.chance * e[1]) / sumW(t.entries)) : 0;
};
const STYLE_TOTAL = BODY_STYLES.reduce((a, s) => a + s.weight, 0);
/** A body style's own odds, ppm. */
export const stylePpm = (s: BodyStyle): number => Math.floor((ONE_PPM * s.weight) / STYLE_TOTAL);

const categoryOf = new Map(CATEGORIES.map((c) => [c.name, c]));
export const category = (name: string): Category => {
  const c = categoryOf.get(name);
  if (!c) throw new RangeError(`No trait category "${name}".`);
  return c;
};

/** A trait's odds across every car, ppm: each style's odds times the trait's odds in that style (forced traits: certain), summed. */
function globalPpm(cat: Category, name: string): number {
  let total = 0;
  for (const s of BODY_STYLES) {
    const forced = s.force?.[cat.name];
    const p = forced !== undefined ? (forced === name ? ONE_PPM : 0) : cat.tables[s.cls] ? entryPpm(cat.tables[s.cls]!, name) : 0;
    total += Math.floor((stylePpm(s) * p) / ONE_PPM);
  }
  return total;
}

const ODDS = new Map<string, number>();
/** Odds of a trait across every car (ppm), by category and name. */
export function traitPpm(categoryName: string, name: string): number {
  const key = `${categoryName}|${name}`;
  let v = ODDS.get(key);
  if (v === undefined) {
    if (categoryName === "Body") v = stylePpm(BODY_STYLES.find((s) => s.name === name)!);
    else if (categoryName === "Type") v = entryPpm(TYPE_TABLE, name);
    else if (categoryName === "Effect") v = entryPpm(EFFECT_TABLE, name);
    else if (categoryName === "Rim Size") v = entryPpm(RIM_SIZE_TABLE, name);
    else if (categoryName === "Spinner") v = entryPpm(SPINNER_TABLE, name);
    else if (categoryName === "Lights") v = entryPpm(LIGHT_TABLE, name);
    else if (categoryName === "Neon") v = entryPpm(NEON_TABLE, name);
    else if (categoryName === "Paint") {
      v = 0;
      for (const s of BODY_STYLES) {
        const t = PAINT_TABLES[s.cls];
        const e = t.find(([k]) => PAINT_FAMILIES[k].name === name);
        if (e) v += Math.floor((Math.floor((stylePpm(s) * e[1]) / sumW(t)) * (ONE_PPM - TYPE_TABLE.chance)) / ONE_PPM);
      }
    } else if (categoryName === "Wing Accent") {
      v = 0;
      const spoiler = category("Spoiler");
      for (const s of BODY_STYLES) {
        const forced = s.force?.["Spoiler"];
        const t = spoiler.tables[s.cls];
        const pw = forced !== undefined ? (WINGS.has(forced) ? ONE_PPM : 0) : t ? [...WINGS].reduce((a, w) => a + entryPpm(t, w), 0) : 0;
        v += Math.floor((Math.floor((stylePpm(s) * pw) / ONE_PPM) * WING_ACCENT_CHANCE) / ONE_PPM);
      }
    } else v = globalPpm(category(categoryName), name);
    ODDS.set(key, v);
  }
  return v;
}

/** A trait a car has: its category and name, the site it's filed under, its odds, and how this one varies (its papers' line). */
export interface Trait {
  readonly category: string;
  readonly name: string;
  readonly site: Site;
  readonly ppm: number;
  readonly detail?: string;
}

/** The chip per site: the rarest trait there (lowest odds, the first on a tie), or None. */
export function chipsOf(traits: readonly Trait[]): Record<Site, { name: string; ppm: number }> {
  const out = Object.fromEntries(SITES.map((s) => [s, { name: "None", ppm: ONE_PPM }])) as Record<Site, { name: string; ppm: number }>;
  for (const t of traits) if (t.ppm < out[t.site].ppm) out[t.site] = { name: t.name, ppm: t.ppm };
  return out;
}

/** The score: points over the fixed chip vector (SITES), None included. */
export const scoreOf = (chips: Record<Site, { ppm: number }>): number => SITES.reduce((a, s) => a + points(chips[s].ppm), 0);

/**
 * The tier ladder, richest first: `min` is the score at or above which a car is that tier. Struck on a 100,000-car
 * census of these tables to the marine's cumulative shares (0.041 / 0.277 / 0.808 / 9.461 / 41.721 %): measured
 * 0.037 % mythic, 0.267 % legendary or better, 0.750 % epic or better, 9.99 % rare or better, 43.2 % uncommon or
 * better. Re-strike it (test/vehicles.test.ts shows how) whenever a table changes.
 */
export const TIER_LADDER = [
  { id: "mythic", label: "Mythic", min: 141 },
  { id: "legendary", label: "Legendary", min: 131 },
  { id: "epic", label: "Epic", min: 124 },
  { id: "rare", label: "Rare", min: 110 },
  { id: "uncommon", label: "Uncommon", min: 94 },
  { id: "common", label: "Common", min: 0 },
] as const;
export type Tier = (typeof TIER_LADDER)[number]["id"];
export const tierOf = (score: number): Tier => (TIER_LADDER.find((r) => score >= r.min) ?? TIER_LADDER[TIER_LADDER.length - 1]!).id;

/**
 * How many different cars the TABLES alone can make (the marine's "possible" line): per body style, the product of
 * every category's choices (each entry, plus none where the table isn't certain), the paint families, the rare
 * types and effects -- summed over the styles. The dials and every trait's variance are continuous on top of it.
 */
export function possibleCars(): bigint {
  let total = 0n;
  const choices = (t: Table | undefined): bigint => (!t || !t.entries.length ? 1n : BigInt(t.entries.length + (t.chance < ONE_PPM ? 1 : 0)));
  for (const s of BODY_STYLES) {
    let n = 1n;
    for (const c of CATEGORIES) n *= s.force?.[c.name] !== undefined ? 1n : choices(c.tables[s.cls]);
    n *= BigInt(PAINT_TABLES[s.cls].length) + BigInt(TYPE_TABLE.entries.length);
    n *= BigInt(EFFECT_TABLE.entries.length + 1);
    n *= BigInt(LIGHT_TABLE.entries.length);
    n *= BigInt(RIM_SIZE_TABLE.entries.length);
    n *= BigInt(SPINNER_TABLE.entries.length + 1);
    n *= BigInt(NEON_TABLE.entries.length + 1);
    total += n;
  }
  return total;
}
