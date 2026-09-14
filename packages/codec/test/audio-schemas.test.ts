// Sound through the codec: a recipe regenerates its plan exactly (scoreOf), a
// song IS its plan (JSON-equal), sfx settings make the same palette -- over
// NOCTURNES' tokens (when ../keel-nocturnes is there, as audio's own tests
// use it), WALLRUN's moods, every band, and pins.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BANDS, CHOICES, KIT_BAND, MODES, ROOM_KINDS as A_ROOM, WEATHER_KINDS as A_WEATHER, LOOP_NAMES as A_LOOPS, SFX_NAMES as A_SFX, STYLE_NAMES as A_STYLES, SURFACES as A_SURFACES,
  diatonic as aDiatonic, moodFor, moodOfNocturnes, scoreOf, sfxStyle,
} from "@keel-engine/audio";
import type { Mood, NocturnesGenome, Plan } from "@keel-engine/audio";
import {
  MUSIC_RECIPE, SFX_SETTINGS, SONG, array, decode, diatonic, encode, moodOfRecipe, planOfSong, recipeOfMood, songOf,
  BASS_NAMES, KEYS_NAMES, KIT_NAMES, LEAD_NAMES, LOOP_NAMES, MODE_NAMES, MODE_STEPS, ROOM_KINDS, SFX_NAMES, STYLE_NAMES, SURFACES, WEATHER_KINDS,
} from "../src/index.ts";
import type { MusicRecipe, Song } from "../src/index.ts";
import { WALLRUN_SFX } from "../tools/samples.ts";
import { rng } from "./gen.ts";

const tables = { bands: BANDS, kits: KIT_BAND };
const json = (v: unknown): string => JSON.stringify(v);
/** The plan a recipe stands for. */
function planOf(r: MusicRecipe): Plan {
  const m = moodOfRecipe(r, tables);
  return m.from === "game" ? scoreOf(moodFor(m.mood as never), m.seed, { pins: m.pins as never }) : scoreOf(m.mood as Mood, m.seed, { pins: m.pins as never });
}
const through = (r: MusicRecipe): MusicRecipe => decode(MUSIC_RECIPE, encode(MUSIC_RECIPE, r));

test("the codec's music vocabulary is audio's", () => {
  assert.deepEqual([...MODE_NAMES], Object.keys(MODES));
  for (const m of MODE_NAMES) assert.deepEqual(MODE_STEPS[m], MODES[m]);
  assert.deepEqual([...KEYS_NAMES], CHOICES.keys);
  assert.deepEqual([...LEAD_NAMES], CHOICES.lead);
  assert.deepEqual([...BASS_NAMES], CHOICES.bass);
  assert.deepEqual([...KIT_NAMES], CHOICES.kit);
  assert.deepEqual([...WEATHER_KINDS], [...A_WEATHER]);
  assert.deepEqual([...ROOM_KINDS], [...A_ROOM]);
  assert.deepEqual([...SFX_NAMES], [...A_SFX]);
  assert.deepEqual([...LOOP_NAMES], [...A_LOOPS]);
  assert.deepEqual([...STYLE_NAMES], [...A_STYLES]);
  assert.deepEqual([...SURFACES], [...A_SURFACES]);
  for (const m of MODE_NAMES) for (let d = 0; d < 7; d += 1) assert.deepEqual(diatonic(m, d), aDiatonic(m, d));
});

test("recipes: game moods (WALLRUN's and more), every band, and pins make their plans exactly", () => {
  const S = rng("music");
  const specs = [
    { name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"] },
    { energy: 0.1 }, { energy: 1, darkness: 0.95 }, { darkness: 0.1, weather: "rain" }, { tempo: [70, 80] as [number, number], hue: 212.5 }, { tempo: 88 },
  ];
  let n = 0;
  for (const spec of specs) for (let s = 0; s < 25; s += 1) {
    const seed = S.chance(0.5) ? `seed-${s}` : s * 7919;
    const hue = S.chance(0.5) ? S.f() * 360 : undefined;
    const pins = S.chance(0.3) ? { keys: S.pick(CHOICES.keys), key: S.pick(["C#", 5, "11"]), tempo: S.pick([72, "84"]) } : undefined;
    const r: MusicRecipe = { from: "game", seed, spec: { ...spec, ...(hue === undefined ? {} : { hue }) }, ...(pins ? { pins } : {}) } as MusicRecipe;
    assert.equal(json(planOf(through(r))), json(planOf(r)), `game recipe ${n++}`);
  }
  for (const band of Object.keys(BANDS)) for (let s = 0; s < 8; s += 1) {
    const mood: Mood = { band, hue: s * 45, eclipse: s === 3, picture: s % 2 ? 4.32 : undefined, weather: ["rain", "hush"], room: ["fan"], dark: 0.4 + s / 20, space: 0.08 };
    const clean = JSON.parse(JSON.stringify(mood)) as Mood;
    const want = scoreOf(clean, `band-${s}`);
    const r = recipeOfMood(clean as never, `band-${s}`, tables);
    assert.equal(json(planOf(through(r))), json(want), `${band} ${s}`);
  }
});

test("recipes: NOCTURNES tokens make their plans exactly, bands by preset and corner", async (t) => {
  const NOCTURNES = resolve(process.env["NOCTURNES"] ?? resolve(import.meta.dirname, "../../../../keel-nocturnes"));
  let make: ((t: number) => NocturnesGenome) | null = null;
  try {
    const nGenome = await import(pathToFileURL(`${NOCTURNES}/src/genome.js`).href);
    const nRng = await import(pathToFileURL(`${NOCTURNES}/src/rng.js`).href);
    make = (tok) => nGenome.makeGenome(nRng.seedFromToken(tok)) as NocturnesGenome;
  } catch { t.skip(`NOCTURNES isn't at ${NOCTURNES}`); return; }
  const recipes: MusicRecipe[] = [];
  const plans: Plan[] = [];
  for (let tok = 1; tok <= 120; tok += 1) {
    const g = make(tok);
    const pinned = tok % 5 === 0 ? { ...g, recipe: { music: { theme: "Nightcap", keys: "vibes", key: "D" } } } : g;
    const m = moodOfNocturnes(pinned);
    const plan = scoreOf(m, m.seed);
    const r = recipeOfMood(m as never, m.seed, tables);
    // (The band is a preset and a corner, not the table.)
    const band = (r as { mood: { band?: unknown } }).mood.band;
    assert.ok(typeof band === "object" && band !== null && !("over" in band), `token ${tok}: band by reference`);
    assert.equal(json(planOf(through(r))), json(plan), `token ${tok}`);
    recipes.push(r);
    plans.push(plan);
  }
  // All of them in one document: the shared tables make it smaller still.
  const one = encode(array(MUSIC_RECIPE), recipes);
  assert.ok(one.length * 30 < json(plans).length, `${one.length} B for ${json(plans).length} B of plans`);
});

test("songs: a plan through its song is the plan, JSON-equal -- generated ones and one edited by hand", () => {
  const plans: Plan[] = [];
  for (let s = 0; s < 60; s += 1) plans.push(scoreOf(moodFor({ energy: (s % 10) / 10, darkness: ((s * 3) % 10) / 10, hue: s * 17 }), `song-${s}`));
  for (const band of Object.keys(BANDS)) plans.push(scoreOf({ band, picture: 4.32, eclipse: true }, band));
  for (const [k, plan] of plans.entries()) {
    const back = planOfSong(decode(SONG, encode(SONG, songOf(plan as never))));
    assert.equal(json(back), json(plan), `plan ${k}`);
  }
  // By hand: round numbers, a bar that breaks its section, a groove out of order, a tune's own lengths.
  const p = JSON.parse(JSON.stringify(plans[0])) as Plan & Record<string, unknown>;
  const edited = {
    ...p, bpm: 84, barSec: 240 / 84, loopSec: p.loopBars * (240 / 84), swing: 0.3, jazz: 0.4, keys: "harpsichord",
    groove: { ...p.groove, kick: [0, 10, 7, 3], hat: [0, 4, 8, 12] },
    bars: p.bars.map((b, i) => (i === 3 ? { ...b, chord: { root: 2, tones: [5, 9, 12], deg: 9 } } : i === 1 ? { ...b, sec: "C" } : b)),
    motif: { ...p.motif, lengths: p.motif.lengths.map((l) => l + 1) },
    mix: { cutoff: 4000, tape: 0.25, reverb: 0.3, wow: 0.2, level: -4 },
  };
  const song: Song = songOf(edited as never);
  assert.equal(song.barSec, undefined, "240/bpm is left out");
  assert.equal(song.bars.as, "list", "a broken section is listed bar by bar");
  assert.ok(Array.isArray(song.groove.kick), "an unsorted kick keeps its order");
  const bytes = encode(SONG, song);
  assert.equal(json(planOfSong(decode(SONG, bytes))), json(edited));
  assert.ok(bytes.length < 360, `${bytes.length} bytes for the edited song`);
});

test("sfx settings: through the codec, the same palette", () => {
  const back = decode(SFX_SETTINGS, encode(SFX_SETTINGS, WALLRUN_SFX));
  assert.deepEqual(back, WALLRUN_SFX);
  assert.deepEqual(sfxStyle(back.seed, back.style as never), sfxStyle(WALLRUN_SFX.seed, WALLRUN_SFX.style as never));
  for (const style of ["lofi", "chip", "cassette"] as const) {
    const s = decode(SFX_SETTINGS, encode(SFX_SETTINGS, { seed: 42, style, volume: 0.8, sounds: {} }));
    assert.equal(s.style, style);
  }
  assert.throws(() => encode(SFX_SETTINGS, { ...WALLRUN_SFX, body: { ...WALLRUN_SFX.body!, surfaces: { wall: 3 as never } } }), /body\.surfaces\.wall: 3 is not one of \["stone","metal","water"\]\.$/);
});
