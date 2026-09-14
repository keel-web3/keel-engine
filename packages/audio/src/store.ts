// Music as bytes, through the codec, two ways:
//
//   a recipe  (MUSIC_RECIPE, keel/audio/recipe) -- a seed and a mood, or a
//             game's few words for moodFor, and pins: scoreOf makes the plan
//             again, exactly. The band goes as a preset's name and a corner
//             (BANDS, NOCTURNES' KIT_BAND) when one makes it. The smallest.
//   a song    (SONG, keel/audio/song) -- the plan itself, for a plan written
//             or edited by hand: it comes back JSON-equal, so it plays the same.
//
//   const bytes = storeMusic(musicRecipe({ band: "Nightcap", hue: 212 }, "seed-7"));   // ~80 bytes
//   const game = storeMusic({ from: "game", seed: 7, spec: { energy: 0.8, darkness: 0.7 } });
//   const song = storeMusic(editedPlan);                                               // ~300 bytes
//   play(loadMusic(bytes));                                                             // either kind: the header says which

import { MUSIC_RECIPE, SONG, decode, encode, moodOfRecipe, planOfSong, readHeader, recipeOfMood, shortId, songOf } from "@keel-engine/codec";
import type { MusicRecipe } from "@keel-engine/codec";
import { KIT_BAND } from "./nocturnes.ts";
import { BANDS, moodFor, scoreOf } from "./score.ts";
import type { Mood, MoodSpec, Pins, Plan } from "./score.ts";

export type { MusicRecipe };
/** What storeMusic stores: a recipe (musicRecipe's, or a game's `{ from: "game", seed, spec, pins }`) or a plan. */
export type MusicSource = MusicRecipe | Plan;

// (The presets a recipe's band names: audio's own, and NOCTURNES' corners.)
const TABLES = { bands: BANDS, kits: KIT_BAND };

/** A value with every undefined left out, all the way down (a mood's absent fields are absent). */
const defined = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(defined) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, defined(x)])) : v;

/** A mood's recipe: scoreOf(mood, seed, { pins }) makes the same plan from it. */
export function musicRecipe(mood: Mood, seed?: string | number, pins?: Pins): MusicRecipe {
  return recipeOfMood(defined(mood) as Record<string, unknown>, seed, TABLES, pins === undefined ? undefined : (defined(pins) as Record<string, unknown>));
}

/** The plan a recipe stands for (a "game" recipe's spec goes through moodFor). */
export function planOfRecipe(r: MusicRecipe): Plan {
  const m = moodOfRecipe(r, TABLES);
  const opts = { pins: m.pins as Pins | undefined };
  return m.from === "game" ? scoreOf(moodFor(m.mood as MoodSpec), m.seed, opts) : scoreOf(m.mood as Mood, m.seed, opts);
}

const isRecipe = (x: MusicSource): x is MusicRecipe => typeof (x as { from?: unknown }).from === "string";

/** Music as codec bytes: a recipe as MUSIC_RECIPE, a plan as SONG. */
export function storeMusic(x: MusicSource): Uint8Array {
  return isRecipe(x) ? encode(MUSIC_RECIPE, defined(x) as MusicRecipe) : encode(SONG, songOf(x as unknown as Record<string, unknown>));
}

// (Worked out once, when first asked: each is a hash of its schema.)
let ids: { readonly recipe: string; readonly song: string } | null = null;
const idsOf = () => (ids ??= { recipe: shortId(MUSIC_RECIPE), song: shortId(SONG) });

/** Codec bytes back to a plan: a recipe through scoreOf, a song as it is. Anything else is a TypeError saying what it is. */
export function loadMusic(bytes: Uint8Array): Plan {
  const { recipe, song } = idsOf();
  let id: string | null;
  try {
    id = readHeader(bytes).id?.slice(0, 8) ?? null;
  } catch (e) {
    throw new TypeError(`These bytes aren't music: ${(e as Error).message}`, { cause: e });
  }
  const read = <T>(what: string, f: () => T): T => {
    try {
      return f();
    } catch (e) {
      throw new TypeError(`These bytes aren't a readable ${what}: ${(e as Error).message}`, { cause: e });
    }
  };
  if (id === recipe) return planOfRecipe(read("music recipe (keel/audio/recipe)", () => decode(MUSIC_RECIPE, bytes)));
  if (id === song) return planOfSong(read("song (keel/audio/song)", () => decode(SONG, bytes))) as unknown as Plan;
  throw new TypeError(`These bytes aren't music: their schema is ${id ?? "not named (no header)"}, not a recipe (keel/audio/recipe, ${recipe}) or a song (keel/audio/song, ${song}).`);
}
