// Weather: a city's sky and what it leaves on the ground, as a pure function of the city and the GAME clock -- so every
// screen has the same rain at the same moment, and a race formed at a moment races the roads as they were then. One real
// second is one game minute: a game day is 24 real minutes, a season 90 game days (a day and a half, real).
//
// The sky is regional (one front over the whole city and its land): spells of weather that come and go on the climate's
// odds for the season -- clear, fair-weather cumulus, overcast, rain or snow light to heavy, summer storms with lightning,
// dawn fog -- and a wind that veers and gusts. Where you are then shapes it: the showers move over the land on the wind,
// the air is colder up the hills (6.5 degrees a kilometre), so the same front is rain in the city and snow on the ridge.
// And the ground remembers: the road film builds in rain and dries in sun and wind, snow lies where it's cold enough and
// melts when it isn't, a wet road freezes. `at()` walks the last week of it in half-hour steps from a dry, bare start.
//
// Deterministic by construction: integer hashes, and only the arithmetic IEEE makes exact everywhere (+ - * / floor
// sqrt) plus keel/core's dmath for the cosines. What a race needs of it is `surfaceAt` (keel/city's race surfaces).

import { dcos, dsin, hash2 } from "@keel-engine/core";
import { climateOf } from "./climate.ts";
import type { Climate } from "./climate.ts";
import type { CitySite } from "./types.ts";

/** Game minute 0: the start of spring, day 1, year 1 (a fixed moment, so every clock agrees what minute it is). */
export const GAME_EPOCH_MS = Date.UTC(2026, 8, 1, 0, 0, 0);
/** A game minute is this many real milliseconds. */
export const GAME_MINUTE_MS = 1000;
export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_YEAR = 360;
/** The game minute at a moment of real time (ms since 1970, the server's clock). */
export const gameMinuteAt = (ms: number): number => Math.floor((ms - GAME_EPOCH_MS) / GAME_MINUTE_MS);

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export interface Calendar {
  readonly minute: number;
  readonly year: number;
  /** 0..359 */
  readonly dayOfYear: number;
  /** 0..1439 */
  readonly minuteOfDay: number;
  readonly season: Season;
  /** How far through the year (0..1, 0 the first day of spring) and through its season (0..1). */
  readonly yearPhase: number;
  readonly seasonPhase: number;
  /** The sun's height: -1 midnight .. 1 noon (a plain cosine of the hour). */
  readonly sun: number;
}

export function calendarAt(minute: number): Calendar {
  const day = Math.floor(minute / MINUTES_PER_DAY), minuteOfDay = minute - day * MINUTES_PER_DAY;
  const year = Math.floor(day / DAYS_PER_YEAR), dayOfYear = day - year * DAYS_PER_YEAR;
  const s = Math.floor(dayOfYear / 90);
  return {
    minute, year: year + 1, dayOfYear, minuteOfDay, season: SEASONS[s]!, yearPhase: dayOfYear / DAYS_PER_YEAR, seasonPhase: (dayOfYear - s * 90) / 90,
    sun: -dcos((minuteOfDay / MINUTES_PER_DAY) * Math.PI * 2),
  };
}

export type CloudKind = "clear" | "cirrus" | "cumulus" | "stratus" | "nimbostratus" | "storm" | "fog";
export type Intensity = "none" | "light" | "medium" | "heavy";
export type Precip = "none" | "rain" | "sleet" | "snow";

/** The regional sky at a minute (sea level). */
export interface Sky {
  readonly minute: number;
  /** Cloud cover 0..1, and the kind that dominates it. */
  readonly cover: number;
  readonly kind: CloudKind;
  /** The front's precipitation over the region (mm/h of water), before where you are shapes it. */
  readonly rate: number;
  /** Wind: where it blows TOWARD (rad, frame convention: 0 is +z), its speed and its gusts (m/s). */
  readonly windDir: number;
  readonly wind: number;
  readonly gust: number;
  /** Lightning strikes a minute over the region. */
  readonly lightning: number;
  /** Fog 0..1. */
  readonly fog: number;
  /** Air temperature at sea level (degrees C). */
  readonly temp: number;
}

/** What it's like at one place: the air, what's falling, and what the ground holds. */
export interface Here {
  readonly temp: number;
  readonly precip: Precip;
  readonly intensity: Intensity;
  /** Falling now (mm/h of water). */
  readonly rate: number;
  /** The water film on a road (mm, 0..3), and whether it's frozen. */
  readonly water: number;
  readonly ice: boolean;
  /** Lying snow (mm of snow, on open ground; a road keeps less: it's driven and treated). */
  readonly snow: number;
}

/** A race's surface on a road (keel/city's race surfaces: the race profile's). */
export type RoadSurface = "dry" | "wet" | "snow" | "ice";

/** What each climate does through the year. Temperatures in degrees C; odds 0..1. */
interface ClimateSpec {
  readonly mean: number;
  /** Seasonal swing either side of the mean (warmest mid-summer), and the day's swing either side. */
  readonly seasonal: number;
  readonly daily: number;
  /** How often a front is wet, by season (spring, summer, autumn, winter), and how often a wet summer spell is a storm. */
  readonly wet: readonly [number, number, number, number];
  readonly storms: number;
  /** How hard it falls when it does (mm/h at the heaviest). */
  readonly heavy: number;
  /** Fog's odds at dawn, and the prevailing wind's bearing (rad) and strength (m/s). */
  readonly fog: number;
  readonly prevailing: number;
  readonly breeze: number;
}

const CLIMATE: Readonly<Record<Climate, ClimateSpec>> = {
  // (Warm coast: hot wet summers with afternoon thunderstorms, a mild dry winter, a sea breeze.)
  subtropical: { mean: 23, seasonal: 5, daily: 5, wet: [0.25, 0.45, 0.3, 0.15], storms: 0.55, heavy: 40, fog: 0.15, prevailing: 1.2, breeze: 5 },
  mediterranean: { mean: 17, seasonal: 8, daily: 7, wet: [0.25, 0.05, 0.3, 0.45], storms: 0.2, heavy: 20, fog: 0.2, prevailing: 0.6, breeze: 4 },
  temperate: { mean: 11, seasonal: 11, daily: 6, wet: [0.4, 0.35, 0.45, 0.45], storms: 0.3, heavy: 22, fog: 0.3, prevailing: 1.6, breeze: 5 },
  boreal: { mean: 3, seasonal: 16, daily: 6, wet: [0.35, 0.4, 0.45, 0.45], storms: 0.2, heavy: 14, fog: 0.25, prevailing: 1.9, breeze: 6 },
  arid: { mean: 22, seasonal: 9, daily: 12, wet: [0.08, 0.1, 0.06, 0.1], storms: 0.6, heavy: 30, fog: 0.02, prevailing: 2.4, breeze: 7 },
};

const fnv = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h | 0;
};
const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise through time: a smooth 0..1 wander, one knot every `span` minutes. */
function wander(seed: number, minute: number, span: number): number {
  const k = Math.floor(minute / span), t = smooth((minute - k * span) / span);
  const a = hash2(k, 0, seed), b = hash2(k + 1, 0, seed);
  return a + (b - a) * t;
}
/** Value noise over the land (0..1), knots `span` m apart. */
function patch(seed: number, x: number, z: number, span: number): number {
  const fx = x / span, fz = z / span, ix = Math.floor(fx), iz = Math.floor(fz), tx = smooth(fx - ix), tz = smooth(fz - iz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/** How far the showers' pattern moves a game minute per m/s of the climate's breeze (m). */
const SHOWER_DRIFT = 6;
/** How long a plow's salt keeps a road from icing (game minutes). */
const SALT_MINUTES = 240;
/** How far back `at()` looks (game minutes), and its step: a week, a half-hour at a time. */
const MEMORY = 7 * MINUTES_PER_DAY, STEP = 30;

export interface Weather {
  readonly climate: Climate;
  calendar(minute: number): Calendar;
  sky(minute: number): Sky;
  /** Where you are (world x, z, and the ground's height there in m), at a minute. */
  at(x: number, z: number, altitude: number, minute: number): Here;
  /** What the air is doing at a place right now, without the ground's memory (cheap: for particles and sway). */
  now(x: number, z: number, altitude: number, minute: number): Pick<Here, "temp" | "precip" | "intensity" | "rate">;
  /** A road's surface for a race at a place and minute (a road keeps less snow than the verge: it's driven and treated). */
  surfaceAt(x: number, z: number, altitude: number, minute: number): RoadSurface;
  /** `at()` on a road the plows have been down, at these minutes (ascending): keel/city plows.ts. */
  plowed(x: number, z: number, altitude: number, minute: number, passes: readonly number[]): Here;
}

/** A city's weather (the world's, for a city in a world of cities: neighbours share their sky). */
export function weatherOf(site: CitySite): Weather {
  const climate = climateOf(site), C = CLIMATE[climate];
  const seed = fnv(site.cell ? `weather|world|${site.cell.world}` : `weather|${site.seed}`);
  const ox = site.cell ? site.cell.x * site.size : 0, oz = site.cell ? site.cell.z * site.size : 0;
  const skies = new Map<number, Sky>();

  const sky = (minute: number): Sky => {
    const hit = skies.get(minute);
    if (hit) return hit;
    const cal = calendarAt(minute), s = SEASONS.indexOf(cal.season);
    // (The season's wet odds, eased across the season's turn so a spring doesn't start at noon on day 90.)
    const next = C.wet[(s + 1) % 4]!, wetOdds = C.wet[s]! + (next - C.wet[s]!) * smooth(sat((cal.seasonPhase - 0.75) / 0.25));
    // Fronts: a slow wander (a spell every day or two) with a quicker one on it (the showers inside a spell).
    const front = wander(seed, minute, 1440) * 0.7 + wander(seed + 1, minute, 300) * 0.3;
    const threshold = 1 - wetOdds;
    const wet = sat((front - threshold) / Math.max(0.05, 1 - threshold));
    // Warm half of the year and a wet spell: the odds of it building into a storm, by the afternoon.
    const warm = s === 1 || (s === 0 && cal.seasonPhase > 0.6);
    const storm = warm && wet > 0.35 && wander(seed + 2, minute, 720) < C.storms ? sat((wet - 0.35) / 0.4) * sat(0.4 + cal.sun) : 0;
    const rate = wet > 0.05 ? C.heavy * (wet * wet * 0.55 + storm * 0.45) : 0;
    const cover = sat(0.15 + 0.2 * wander(seed + 3, minute, 480) + front * 0.6 + wet * 0.5);
    // The air: the season's cosine (warmest mid-summer, day 135), the day's (warmest 15:00), the front's anomaly; cloud
    // flattens the day's swing, rain cools it.
    const seasonal = dcos(((cal.dayOfYear - 135) / DAYS_PER_YEAR) * Math.PI * 2) * C.seasonal;
    const daily = dcos(((cal.minuteOfDay - 900) / MINUTES_PER_DAY) * Math.PI * 2) * C.daily * (1 - 0.6 * cover);
    const temp = C.mean + seasonal + daily + (wander(seed + 4, minute, 2880) - 0.5) * 8 - wet * 3 - storm * 4;
    // Wind: the prevailing bearing, veering with the fronts; stronger in them, gusting hard in a storm.
    const windDir = C.prevailing + (wander(seed + 5, minute, 1440) - 0.5) * 2.4 + (wander(seed + 6, minute, 180) - 0.5) * 0.5;
    const wind = C.breeze * (0.4 + 0.9 * wander(seed + 7, minute, 360)) + wet * 5 + storm * 9;
    const gust = wind * (1.2 + 0.5 * wander(seed + 8, minute, 20)) + storm * 8;
    // Dawn fog: still, cool air after a clear night (odds by climate).
    const dawn = sat(1 - Math.abs(cal.minuteOfDay - 360) / 180);
    const fog = wander(seed + 9, Math.floor(minute / 1440) * 1440, 1440) < C.fog ? dawn * sat(1 - wind / 6) * sat(1 - wet * 2) : 0;
    const kind: CloudKind = fog > 0.4 ? "fog" : storm > 0.2 ? "storm" : wet > 0.35 ? "nimbostratus" : wet > 0.05 || cover > 0.75 ? "stratus" : cover > 0.4 ? "cumulus" : cover > 0.22 ? "cirrus" : "clear";
    const lightning = storm > 0.3 ? storm * storm * 6 : 0;
    const out: Sky = { minute, cover, kind, rate, windDir, wind, gust, lightning, fog, temp };
    if (skies.size > 4096) skies.clear();
    skies.set(minute, out);
    return out;
  };

  /** The air and what's falling at a place (showers move over the land on the wind; colder uphill). */
  const now = (x: number, z: number, altitude: number, minute: number): Pick<Here, "temp" | "precip" | "intensity" | "rate"> => {
    const S = sky(minute);
    // (The showers' pattern drifts on the climate's prevailing wind at a steady SHOWER_DRIFT metres a game minute -- a
    // steady drift, so it never jumps when the wind veers, and slow enough that a shower takes a couple of real minutes
    // to cross the city. The pattern's position is the drift so far: a minute count times a constant, exact everywhere.)
    const drift = SHOWER_DRIFT * C.breeze * minute;
    const px = x + ox - dsin(C.prevailing) * drift, pz = z + oz - dcos(C.prevailing) * drift;
    const local = S.rate > 0 ? S.rate * sat(0.35 + 1.1 * patch(seed + 10, px, pz, 3500) + (S.kind === "storm" ? 0.6 * patch(seed + 11, px, pz, 1200) - 0.3 : 0)) : 0;
    const temp = S.temp - 0.0065 * Math.max(0, altitude);
    const precip: Precip = local < 0.05 ? "none" : temp < 0.5 ? "snow" : temp < 2.5 ? "sleet" : "rain";
    const intensity: Intensity = local < 0.05 ? "none" : local < 2.5 ? "light" : local < 8 ? "medium" : "heavy";
    return { temp, precip, intensity, rate: local };
  };

  /**
   * The ground's memory: a week of half-hours, from bare dry ground. `passes`: the minutes a plow went over this spot
   * (ascending) -- its blade takes nine tenths of what lies there, and its salt keeps the road from icing a while.
   */
  const walk = (x: number, z: number, altitude: number, minute: number, passes: readonly number[] = []): Here => {
    let water = 0, snow = 0, pass = 0, salted = -Infinity;
    const end = Math.floor(minute / STEP) * STEP;
    for (let m = end - MEMORY; m <= end; m += STEP) {
      while (pass < passes.length && passes[pass]! <= m) { if (passes[pass]! > m - STEP) { snow *= 0.1; salted = passes[pass]!; } pass += 1; }
      const S = sky(m), n = now(x, z, altitude, m), h = STEP / 60;
      const sunUp = sat(calendarAt(m).sun * 1.5) * (1 - S.cover * 0.7);
      if (n.precip === "snow") snow += n.rate * 10 * h;
      else if (n.precip === "sleet") { snow += n.rate * 4 * h; water += n.rate * 0.5 * h; }
      else if (n.precip === "rain") water += n.rate * h;
      // (Melt: warmth and sun eat snow, rain eats it faster; it turns to water on the ground as it goes.)
      if (snow > 0 && n.temp > 0) {
        const melt = Math.min(snow, (n.temp * 1.8 + sunUp * 4 + (n.precip === "rain" ? n.rate * 3 : 0)) * h);
        snow -= melt; water += melt * 0.02;
      }
      // (Lying snow settles and sublimes: a deep drift packs down rather than climbing for ever.)
      snow = Math.min(900, snow * (1 - 0.004 * h));
      // (A road film drains and dries: to a few mm at most, faster in wind, sun and warmth.)
      water = Math.min(3, water);
      const dry = (0.12 + S.wind * 0.02 + sunUp * 0.35 + Math.max(0, n.temp) * 0.02) * h;
      water = Math.max(0, water - (n.precip === "none" ? dry : dry * 0.15));
    }
    const n = now(x, z, altitude, minute);
    // (Salt holds for four hours and down to -9: past that a wet road freezes as any would.)
    const salt = minute - salted < SALT_MINUTES && n.temp > -9;
    return { ...n, water, ice: water > 0.3 && n.temp < -0.5 && !salt, snow };
  };
  const at = (x: number, z: number, altitude: number, minute: number): Here => walk(x, z, altitude, minute);

  const surfaceAt = (x: number, z: number, altitude: number, minute: number): RoadSurface => roadSurfaceOf(at(x, z, altitude, minute));

  return { climate, calendar: calendarAt, sky, at, now, surfaceAt, plowed: walk };
}

/** How much of the verge's snow a road keeps: it's driven and treated (`roadSurfaceOf`). */
export const ROAD_SNOW = 0.35;

/**
 * A road's race surface from what's at a place -- `surfaceAt`'s own rule, for a caller that already holds `at()`'s
 * answer (a renderer sampling a grid of the city draws each road as the race will race it, without asking twice).
 */
export function roadSurfaceOf(h: Here): RoadSurface {
  // (A road: driven and treated -- it keeps a third of what lies on the verge, and loses it faster.)
  const road = h.snow * ROAD_SNOW;
  if (h.ice || (road > 8 && h.temp < -3)) return "ice";
  if (road > 12 || (h.precip === "snow" && h.intensity === "heavy")) return "snow";
  if (h.water > 0.25 || h.precip === "rain" || h.precip === "sleet" || road > 2) return "wet";
  return "dry";
}

const weathers = new WeakMap<CitySite, Weather>();
/** A site's weather, made once a site. */
export function weatherFor(site: CitySite): Weather {
  let w = weathers.get(site);
  if (!w) { w = weatherOf(site); weathers.set(site, w); }
  return w;
}
