// Sound as codec bytes: a recipe's bytes load as the very plan scoreOf makes,
// a song's (generated or edited by hand) as its plan, JSON-equal; loadMusic
// refuses what isn't music. SFX settings: through bytes and back, a sound's
// tuning on its params, bodySfx's materials and events, and createSfx (on a
// stand-in context) taking them -- with no settings, the same draws as ever.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MUSIC_RECIPE, SFX_SETTINGS, SONG, encode, readHeader, shortId } from "@keel-engine/codec";
import {
  BANDS, KIT_BAND, LOOP_NAMES, SFX_NAMES, bodySfx, createSfx, jitterOf, loadMusic, moodFor, musicRecipe, paramsFor, planOfRecipe, scoreOf, sfxSettingsBytes, sfxSettingsOf,
  sfxStyle, storeMusic, streamOf, tuningOf,
} from "../src/index.ts";
import type { Mood, MoodSpec, MusicRecipe, Pins, Plan, SfxBody, SfxParams, SfxPlayer, SfxSettings } from "../src/index.ts";

const json = (v: unknown): string => JSON.stringify(v);
const bands = Object.keys(BANDS);

// ---------------------------------------------------------------- music

test("recipes: band moods (with pins and absent fields) and game moods load as the plans scoreOf makes, exactly", () => {
  let n = 0;
  for (const [i, band] of bands.entries()) for (let s = 0; s < 4; s += 1) {
    const mood: Mood = { band, hue: s * 67.5, eclipse: s === 2, picture: s % 2 ? 4.32 : undefined, weather: ["rain", "hush"], room: ["fan"], dark: 0.3 + s / 10, space: 0.05 * s };
    const seed = s % 2 ? `band-${i}-${s}` : i * 100 + s;
    const pins: Pins | undefined = s === 3 ? { keys: "vibes", key: "D", tempo: 80 } : undefined;
    const want = scoreOf(mood, seed, { pins });
    const bytes = storeMusic(musicRecipe(mood, seed, pins));
    assert.equal(readHeader(bytes).id, shortId(MUSIC_RECIPE));
    assert.equal(json(loadMusic(bytes)), json(want), `${band} ${s}`);
    n += 1;
  }
  // A band laid over a preset with one of NOCTURNES' corners goes by reference, and still makes its plan.
  for (const [k, kit] of Object.keys(KIT_BAND).entries()) {
    const mood: Mood = { name: "Nightcap", band: { ...BANDS.Nightcap, ...KIT_BAND[kit] }, hue: k * 30 };
    const r = musicRecipe(mood, `kit-${k}`);
    assert.deepEqual((r as { mood: { band: unknown } }).mood.band, { preset: "Nightcap", kit });
    assert.equal(json(loadMusic(storeMusic(r))), json(scoreOf(mood, `kit-${k}`)), kit);
  }
  // Game moods: the few words (a "game" recipe), and moodFor's mood itself.
  const specs: MoodSpec[] = [
    { name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"] }, { energy: 0.1 }, { energy: 1, darkness: 0.95 }, { darkness: 0.1, weather: "rain" },
    { tempo: [70, 80], hue: 212.5 }, { tempo: 88, pins: { kit: "rim" } },
  ];
  for (const [k, spec] of specs.entries()) for (const seed of [k, `game-${k}`]) {
    const want = scoreOf(moodFor(spec), seed);
    assert.equal(json(loadMusic(storeMusic({ from: "game", seed, spec } as MusicRecipe))), json(want), `game ${k} ${seed}`);
    assert.equal(json(loadMusic(storeMusic(musicRecipe(moodFor(spec), seed)))), json(want), `moodFor ${k} ${seed} as a mood`);
    n += 2;
  }
  assert.equal(json(planOfRecipe(musicRecipe({ band: "Loose" }, 5))), json(scoreOf({ band: "Loose" }, 5)));
  assert.ok(n > 60);
});

test("songs: a plan stored as a song loads JSON-equal -- generated ones and one edited by hand", () => {
  const plans: Plan[] = [];
  for (let s = 0; s < 20; s += 1) plans.push(scoreOf(moodFor({ energy: (s % 10) / 10, darkness: ((s * 3) % 10) / 10, hue: s * 17 }), `song-${s}`));
  for (const band of bands) plans.push(scoreOf({ band, picture: 4.32, eclipse: true }, band));
  for (const [k, plan] of plans.entries()) {
    const bytes = storeMusic(plan);
    assert.equal(readHeader(bytes).id, shortId(SONG));
    assert.equal(json(loadMusic(bytes)), json(plan), `plan ${k}`);
  }
  // By hand: round numbers, a bar that breaks its section, a groove out of order, a tune's own lengths.
  const p = JSON.parse(json(plans[0])) as Plan;
  const edited: Plan = {
    ...p, bpm: 84, barSec: 240 / 84, loopSec: p.loopBars * (240 / 84), swing: 0.3, jazz: 0.4, keys: "harpsichord",
    groove: { ...p.groove, kick: [0, 10, 7, 3], hat: [0, 4, 8, 12] },
    bars: p.bars.map((b, i) => (i === 3 ? { ...b, chord: { root: 2, tones: [5, 9, 12], deg: 9 } } : i === 1 ? { ...b, sec: "C" } : b)),
    motif: { ...p.motif, lengths: p.motif.lengths.map((l) => l + 1) },
    mix: { cutoff: 4000, tape: 0.25, reverb: 0.3, wow: 0.2, level: -4 },
  };
  const bytes = storeMusic(edited);
  assert.equal(json(loadMusic(bytes)), json(edited));
  assert.ok(bytes.length < 400, `${bytes.length} bytes for the edited song`);
});

test("sizes: a recipe is a sliver of its plan's JSON, a song a fraction", () => {
  const mood: Mood = { band: "Night Desk", hue: 140, weather: ["rain"], room: ["vinyl"] };
  const plan = scoreOf(mood, "size");
  const recipe = storeMusic(musicRecipe(mood, "size"));
  const song = storeMusic(plan);
  const game = storeMusic({ from: "game", seed: 7, spec: { energy: 0.8, darkness: 0.7, weather: ["waves", "wind"] } });
  assert.ok(recipe.length * 20 < json(plan).length, `recipe ${recipe.length} B, plan ${json(plan).length} B of JSON`);
  assert.ok(song.length * 5 < json(plan).length, `song ${song.length} B`);
  assert.ok(game.length < 40, `game recipe ${game.length} B`);
  console.log(`music: plan ${json(plan).length} B of JSON; recipe ${recipe.length} B; song ${song.length} B; game recipe ${game.length} B`);
});

test("loadMusic refuses what isn't music, saying what it is", () => {
  const settings = sfxSettingsBytes({ seed: 1, style: "lofi", volume: 0.8, sounds: {} });
  assert.throws(() => loadMusic(settings), (e: unknown) => e instanceof TypeError && e.message.includes(shortId(SFX_SETTINGS)) && /not a recipe \(keel\/audio\/recipe/.test(e.message));
  assert.throws(() => loadMusic(new Uint8Array([1, 2, 3])), /aren't music: their schema is not named/);
  const song = storeMusic(scoreOf({ band: "Loose" }, 1));
  assert.throws(() => loadMusic(song.subarray(0, 20)), /aren't a readable song \(keel\/audio\/song\)/);
});

// ---------------------------------------------------------------- sfx settings

const WALLRUN: SfxSettings = {
  seed: "wallrun",
  style: { name: "lofi", shoe: "boot", bright: 0.5 },
  volume: 0.8,
  body: {
    wind: true, gain: 1,
    surfaces: { wall: "stone", floor: "stone", rail: "metal", metal: "metal", water: "water", wood: "stone" },
    events: { jumped: "jump", wallStart: "wallStart", wallJump: "wallJump", railStart: "railStart", railEnd: "railEnd", skimStart: "skimStart", splashIn: "splash", respawn: "respawn" },
  },
  sounds: { step: { gain: 0.9, jitter: 0.08 }, land: { gain: 1.1 }, grind: { rate: 1.05 }, wind: { gain: 0.6, pan: 0 } },
};

test("sfx settings: through bytes and back, the same value; other bytes refused", () => {
  const bytes = sfxSettingsBytes(WALLRUN);
  assert.equal(readHeader(bytes).id, shortId(SFX_SETTINGS));
  assert.deepEqual(sfxSettingsOf(bytes), WALLRUN);
  assert.equal(sfxSettingsOf(WALLRUN), WALLRUN, "a value comes back as it is");
  assert.ok(bytes.length < json(WALLRUN).length / 2, `${bytes.length} B vs ${json(WALLRUN).length} B of JSON`);
  assert.throws(() => sfxSettingsOf(encode(MUSIC_RECIPE, musicRecipe({ band: "Loose" }, 1))), /aren't sfx settings \(keel\/audio\/sfx\)/);
});

test("a sound's tuning: gain and rate multiply, pan when the call gives none, jitter the spread; untuned, the params as ever", () => {
  const st = sfxStyle("tune");
  const inputs: SfxParams[] = [{}, { speed: 3 }, { speed: 12 }, { gain: 3, pan: -9 }, { rate: 0.5, pan: 0.4 }, { surface: "metal", speed: 8 }];
  for (const name of [...SFX_NAMES, ...LOOP_NAMES, "nope"]) for (const p of inputs) {
    assert.deepEqual(paramsFor(name, p, st, undefined), paramsFor(name, p, st), `${name} untuned`);
    assert.deepEqual(paramsFor(name, p, st, {}), paramsFor(name, p, st), `${name} tuned with nothing`);
    const base = paramsFor(name, p, st);
    const q = paramsFor(name, p, st, { gain: 0.5, rate: 1.25, pan: -0.6 });
    assert.equal(q.gain, Math.min(2, base.gain * 0.5), `${name} gain`);
    assert.equal(q.rate, Math.max(0.25, Math.min(4, base.rate * 1.25)), `${name} rate`);
    assert.equal(q.pan, p.pan === undefined ? -0.6 : base.pan, `${name} pan: the call's wins`);
    assert.equal(q.cutoff, base.cutoff);
    assert.equal(q.key, base.key);
    const loud = paramsFor(name, p, st, { gain: 2, rate: 4 });
    assert.ok(loud.gain <= 2 && loud.rate <= 4, "still in range");
  }
  assert.equal(jitterOf("step"), 0.035);
  assert.equal(jitterOf("land"), 0.035);
  assert.equal(jitterOf("jump"), 0.035);
  assert.equal(jitterOf("blip"), 0);
  assert.equal(jitterOf("grind"), 0);
  assert.equal(jitterOf("step", { jitter: 0.08 }), 0.08);
  assert.equal(jitterOf("blip", { jitter: 0.1 }), 0.1);
  assert.equal(jitterOf("step", { gain: 2 }), 0.035, "a tuning without a jitter keeps the default");
  assert.deepEqual(tuningOf(WALLRUN, "step"), { gain: 0.9, jitter: 0.08 });
  assert.equal(tuningOf(WALLRUN, "blip"), undefined);
  assert.equal(tuningOf(WALLRUN, "toString"), undefined);
  assert.equal(tuningOf(undefined, "step"), undefined);
});

interface HeldLoop { sets: SfxParams[]; stopped: boolean; set(q?: SfxParams): void; stop(): void }
/** A stand-in for createSfx: it only writes down what it was asked to play. */
function recorder() {
  const log: [string, SfxParams][] = [];
  const loops: Record<string, HeldLoop[]> = {};
  const player: SfxPlayer = {
    play(name, p = {}) { log.push([name, p]); return {}; },
    loop(name, p = {}) { const h: HeldLoop = { sets: [p], stopped: false, set(q = {}) { h.sets.push(q); }, stop() { h.stopped = true; } }; (loops[name] ??= []).push(h); return h; },
  };
  return { log, loops, player };
}

test("bodySfx with settings: materials sound like their surfaces, events play the settings' sounds, wind and gain from them", () => {
  const settings: SfxSettings = {
    ...WALLRUN,
    body: { wind: false, gain: 0.7, surfaces: { grate: "metal", pond: "water" }, events: { jumped: "blip", landed: "confirm", ledgeGrab: "select" } },
  };
  const body = (mode: string, events: { type: string; speed?: number }[], mat = "grate", vel = [0, 0, 8]): SfxBody & { mat: string } => ({ mode, events, vel, mat });
  for (const given of [settings, sfxSettingsBytes(settings)]) {
    const rec = recorder();
    const feet = bodySfx(rec.player, { settings: given, materialOf: (b) => (b as SfxBody & { mat: string }).mat, surfaceOf: () => "stone" });
    feet.update(body("air", [{ type: "jumped" }, { type: "ledgeGrab" }, { type: "railStart" }, { type: "grinding" }]), 0.01);
    feet.update(body("ground", [{ type: "landed", speed: 11 }]), 0.01);
    for (const mat of ["grate", "pond", "carpet"]) for (let i = 0; i < 30; i += 1) feet.update(body("ground", [], mat), 0.05);
    const played = rec.log.map(([n]) => n);
    assert.deepEqual(played.slice(0, 4), ["blip", "select", "railStart", "confirm"], "the settings' events over the built-in table");
    assert.equal(rec.log[3]![1].speed, 11, "a landing keeps its speed");
    assert.ok(rec.log.every(([, p]) => p.gain === 0.7), "the settings' gain");
    const surfaces = rec.log.filter(([n]) => n === "step").map(([, p]) => p.surface);
    assert.ok(surfaces.includes("metal") && surfaces.includes("water") && surfaces.includes("stone"), `each material's surface (${[...new Set(surfaces)].join(", ")})`);
    assert.equal(surfaces[0], "metal");
    assert.equal(surfaces.at(-1), "stone", "a material the settings don't map falls back to surfaceOf");
    assert.equal(rec.loops["wind"], undefined, "the settings' wind: off");
  }
  // Options win over the settings.
  const rec = recorder();
  bodySfx(rec.player, { settings, wind: true, gain: 1.5 }).update(body("air", [{ type: "jumped" }]), 0.01);
  assert.equal(rec.log[0]![1].gain, 1.5);
  assert.equal(rec.loops["wind"]?.length, 1);
  // No materialOf: surfaceOf, as ever.
  const plain = recorder();
  const feet = bodySfx(plain.player, { settings, surfaceOf: () => "water" });
  for (let i = 0; i < 30; i += 1) feet.update(body("ground", []), 0.05);
  assert.ok(plain.log.length > 0 && plain.log.every(([n, p]) => n === "step" && p.surface === "water"));
});

// ---------------------------------------------------------------- createSfx on a stand-in context

interface FakeParam { value: number; setValueAtTime(v: number): void; linearRampToValueAtTime(v: number): void; setTargetAtTime(v: number): void; cancelScheduledValues(): void }
interface FakeSource { buffer: { duration: number } | null; loop: boolean; playbackRate: FakeParam; starts: number[][]; start(...a: number[]): void; stop(): void }
/** Just enough of a BaseAudioContext for createSfx: it notes each voice's rate, gain and pan. */
function fakeContext(rate = 8000) {
  const param = (): FakeParam => {
    const p: FakeParam = { value: 0, setValueAtTime(v) { p.value = v; }, linearRampToValueAtTime(v) { p.value = v; }, setTargetAtTime(v) { p.value = v; }, cancelScheduledValues() {} };
    return p;
  };
  const node = () => ({ connect() {}, disconnect() {} });
  const sources: FakeSource[] = [];
  const gains: { gain: FakeParam }[] = [];
  const pans: { pan: FakeParam }[] = [];
  const ctx = {
    sampleRate: rate, currentTime: 0, destination: node(),
    createBuffer: (_ch: number, len: number, r: number) => ({ duration: len / r, copyToChannel() {} }),
    createGain: () => { const g = { ...node(), gain: param() }; gains.push(g); return g; },
    createDelay: () => ({ ...node(), delayTime: param() }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: param() }),
    createStereoPanner: () => { const p = { ...node(), pan: param() }; pans.push(p); return p; },
    createBufferSource: () => {
      const s: FakeSource = { ...node(), buffer: null, loop: false, playbackRate: param(), starts: [], start(...a) { s.starts.push(a); }, stop() {} };
      sources.push(s);
      return s;
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources, gains, pans, master: () => gains[0]! };
}

const PLAYS: [string, SfxParams][] = [["step", { speed: 6 }], ["step", { surface: "metal", speed: 9 }], ["land", { speed: 12 }], ["jump", {}], ["blip", {}], ["step", { speed: 3, pan: 0.3 }], ["land", { speed: 2 }], ["confirm", {}]];
const VARIANTS: Record<string, number> = { step_stone: 4, step_metal: 4, step_water: 4 };

test("createSfx with no settings: every play's rate, gain and pan, and the jitter stream's draws, as they always were", () => {
  const f = fakeContext();
  const sfx = createSfx(f.ctx, { seed: "same" });
  const st = sfxStyle("same", "lofi");
  // (Today's draws, written out: a round-robin skip for a sound of 3+ variants, the rate jitter for step, land
  // and jump, then a step's gain.)
  const J = streamOf("same|sfx|play");
  for (const [name, p] of PLAYS) {
    const q = paramsFor(name, p, st);
    if ((VARIANTS[q.key] ?? 1) > 2) J.chance(0.3);
    const jitter = name === "step" || name === "land" || name === "jump" ? 1 + J.between(-0.035, 0.035) : 1;
    const g = name === "step" ? J.between(0.88, 1.05) : 1;
    const src = sfx.play(name, p) as unknown as FakeSource;
    assert.equal(src.playbackRate.value, q.rate * jitter, `${name} rate`);
    assert.equal(f.gains.at(-1)!.gain.value, q.gain * g, `${name} gain`);
    assert.equal(f.pans.at(-1)!.pan.value, q.pan, `${name} pan`);
  }
  const grind = sfx.loop("grind", { speed: 9 });
  const src = f.sources.at(-1)!;
  assert.equal(src.starts[0]![1], J.between(0, src.buffer!.duration), "a loop starts where the stream says");
  assert.equal(src.playbackRate.value, paramsFor("grind", { speed: 9 }, st).rate);
  grind.set({ speed: 12 });
  assert.equal(src.playbackRate.value, paramsFor("grind", { speed: 12 }, st).rate);
  assert.equal(f.master().gain.value, 0.8);
  // Settings that tune nothing play the same as none.
  const g = fakeContext();
  const same = createSfx(g.ctx, { settings: { seed: "same", style: "lofi", volume: 0.8, sounds: {} } });
  const h = fakeContext();
  const none = createSfx(h.ctx, { seed: "same" });
  for (const [name, p] of PLAYS) {
    const a = same.play(name, p) as unknown as FakeSource, b = none.play(name, p) as unknown as FakeSource;
    assert.equal(a.playbackRate.value, b.playbackRate.value);
    assert.equal(g.gains.at(-1)!.gain.value, h.gains.at(-1)!.gain.value);
  }
});

test("createSfx with settings: seed, style and volume from them (options win), each sound tuned", () => {
  const f = fakeContext();
  const sfx = createSfx(f.ctx, { settings: sfxSettingsBytes(WALLRUN) });
  const st = sfxStyle("wallrun", { name: "lofi", shoe: "boot", bright: 0.5 });
  assert.deepEqual(sfx.style, st, "the settings' seed and style");
  assert.equal(sfx.style.shoe, "boot");
  assert.equal(f.master().gain.value, 0.8);
  const J = streamOf("wallrun|sfx|play");
  const tunes = WALLRUN.sounds as Record<string, { gain?: number; rate?: number; pan?: number; jitter?: number }>;
  for (const [name, p] of PLAYS) {
    const tune = tunes[name];
    const q = paramsFor(name, p, st, tune);
    if ((VARIANTS[q.key] ?? 1) > 2) J.chance(0.3);
    const spread = tune?.jitter ?? (name === "step" || name === "land" || name === "jump" ? 0.035 : 0);
    const jitter = spread > 0 ? 1 + J.between(-spread, spread) : 1;
    const g = name === "step" ? J.between(0.88, 1.05) : 1;
    const src = sfx.play(name, p) as unknown as FakeSource;
    assert.equal(src.playbackRate.value, q.rate * jitter, `${name} rate`);
    assert.equal(f.gains.at(-1)!.gain.value, q.gain * g, `${name} gain`);
  }
  // A step's tuned gain and wider jitter: 0.9 of the untuned, and a spread of 0.08.
  assert.equal(paramsFor("step", { speed: 6 }, st, tunes["step"]).gain, paramsFor("step", { speed: 6 }, st).gain * 0.9);
  // Loops: the wind's gain and pan (the call gives none), the grind's rate.
  sfx.loop("wind", { speed: 12 });
  assert.equal(f.gains.at(-1)!.gain.value, paramsFor("wind", { speed: 12 }, st).gain * 0.6);
  assert.equal(f.pans.at(-1)!.pan.value, 0);
  const grind = sfx.loop("grind", { speed: 9 });
  assert.equal(f.sources.at(-1)!.playbackRate.value, paramsFor("grind", { speed: 9 }, st).rate * 1.05);
  grind.set({ speed: 12 });
  assert.equal(f.sources.at(-1)!.playbackRate.value, paramsFor("grind", { speed: 12 }, st).rate * 1.05);
  // Options win.
  const o = fakeContext();
  const mine = createSfx(o.ctx, { settings: WALLRUN, seed: "mine", style: "chip", volume: 0.3 });
  assert.deepEqual(mine.style, sfxStyle("mine", "chip"));
  assert.equal(o.master().gain.value, 0.3);
  assert.throws(() => createSfx(fakeContext().ctx, { settings: new Uint8Array([0xb1, 0, 0, 0, 0]) }), /aren't sfx settings/);
});
