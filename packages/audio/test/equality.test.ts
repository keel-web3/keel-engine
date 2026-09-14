// The port against its references. NOCTURNES: the TS scoreOf, fed a NOCTURNES
// genome through moodOfNocturnes, makes NOCTURNES' plan byte for byte (JSON),
// and the TS samples are NOCTURNES' samples number for number. The proof of
// concept (src/audio/*.js): plans, moods, sample arrays, the sfx palette and
// its synthesis, params, intensity, voicing, WAV and loop measures are the
// JS's exactly; the player, the sfx and the sound ask Tone / Web Audio for the
// same things in the same order (a recording stand-in writes both down).

import { test } from "node:test";
import assert from "node:assert/strict";
import * as TS from "../src/index.ts";
import { nocturnes, poc, polyfillAudioBuffer, recorder, sameBits } from "./helpers.ts";
import type { ToneLike } from "../src/index.ts";

polyfillAudioBuffer();
const [nMusic, nGenome, nRng, nThemes, nSamples] = await Promise.all([nocturnes("music.js"), nocturnes("genome.js"), nocturnes("rng.js"), nocturnes("themes.js"), nocturnes("samples.js")]);
// (The proof of concept's modules, typed as their ports: they share an API.)
const JS = {
  score: await poc<typeof import("../src/score.ts")>("src/audio/score.js"),
  nocturnes: await poc<typeof import("../src/nocturnes.ts")>("src/audio/nocturnes.js"),
  samples: await poc<typeof import("../src/samples.ts")>("src/audio/samples.js"),
  sfx: await poc<typeof import("../src/sfx.ts")>("src/audio/sfx.js"),
  player: await poc<typeof import("../src/player.ts")>("src/audio/player.js"),
  wav: await poc<typeof import("../src/wav.ts")>("src/audio/wav.js"),
  sound: await poc<typeof import("../src/sound.ts")>("src/audio/sound.js"),
};

const counts: Record<string, number> = {};
const count = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const json = (x: unknown) => JSON.stringify(x);
const engine = (g: TS.NocturnesGenome) => { const m = TS.moodOfNocturnes(g); return TS.scoreOf(m, m.seed); };
const same = (k: string, g: TS.NocturnesGenome, msg: string) => { assert.equal(json(engine(g)), json(nMusic.scoreOf(g)), msg); count(k); };
// (A genome takes NOCTURNES ~20 ms to make: each token's is made once, and only ever spread over, never changed.)
const genomes = new Map<number, TS.NocturnesGenome & Record<string, unknown>>();
const genome = (t: number): TS.NocturnesGenome & Record<string, unknown> => { if (!genomes.has(t)) genomes.set(t, Object.freeze(nGenome.makeGenome(nRng.seedFromToken(t)))); return genomes.get(t)!; };

// ---------------------------------------------------------------- against NOCTURNES

test("NOCTURNES plans: tokens 1..300, the port's = NOCTURNES' (JSON, byte for byte)", () => {
  for (let t = 1; t <= 300; t += 1) same("NOCTURNES plans, tokens 1..300", genome(t), `token ${t}`);
  assert.equal(counts["NOCTURNES plans, tokens 1..300"], 300);
});

test("NOCTURNES plans: rooms without a theme (workstation, floor, the things on the sill) and with no hue", () => {
  for (let t = 1; t <= 60; t += 1) {
    const g = genome(t);
    same("NOCTURNES plans without a theme", { ...g, canvas: { ...(g.canvas ?? {}), theme: "Loose" } }, `token ${t} loose`);
    same("NOCTURNES plans without a theme", { ...g, canvas: { ...(g.canvas ?? {}), theme: undefined }, setting: "Sill" }, `token ${t} sill`);
    same("NOCTURNES plans with no hue / eclipse", {
      ...g, palette: { ...(g.palette ?? {}), hue: undefined, ramps: undefined, scheme: "Nope" }, // (the hue drawn by the seed; an unknown harmony)
      view: { ...(g.view ?? {}), eclipse: t % 3 === 0 },
    }, `token ${t} no hue`);
  }
});

test("NOCTURNES plans: every pin (recipe.music) the studio can set", () => {
  const C = nMusic.MUSIC_CHOICES as Record<string, string[]>;
  let r = 7;
  const rnd = () => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r / 4294967296; };
  const pick = (l: readonly string[]) => l[Math.floor(rnd() * l.length)]!;
  for (let t = 1; t <= 120; t += 1) {
    const music: Record<string, string> = {};
    if (rnd() < 0.4) music.theme = pick([...C.theme!, "Nope"]);
    if (rnd() < 0.4) music.keys = pick(C.keys!);
    if (rnd() < 0.4) music.lead = pick(C.lead!);
    if (rnd() < 0.4) music.bass = pick(C.bass!);
    if (rnd() < 0.4) music.kit = pick(C.kit!);
    if (rnd() < 0.4) music.mode = pick(C.mode!);
    if (rnd() < 0.4) music.key = String(Math.floor(rnd() * 12));
    if (rnd() < 0.4) music.tempo = pick(C.tempo!);
    if (rnd() < 0.1) music.theme = "";
    same("NOCTURNES plans with pins", { ...genome(t), recipe: { music } }, `token ${t} ${json(music)}`);
  }
});

test("NOCTURNES themeForItems: the port picks NOCTURNES' theme", () => {
  const realms = [["Desk", "lamp"], ["Relic", "console"], ["Occult", "candles"], ["Still Life", "Mug"], ["Relic", "vinyl"], ["Decor", "vase"], ["Relic", "boombox"], ["Still Life", "Drink"], ["Relic", "phone"], ["Decor", "cat"], ["Nope", "thing"]] as const;
  for (let i = 0; i < 2000; i += 1) {
    const S = TS.streamOf(`items ${i}`);
    const items = Array.from({ length: S.int(0, 5) }, () => { const [realm, key] = S.pick(realms); return { realm, key }; });
    const a = nThemes.themeForItems(items, TS.streamOf(`t ${i}`))?.name ?? null;
    assert.equal(TS.themeForItems(items, TS.streamOf(`t ${i}`)), a, json(items));
    count("NOCTURNES themeForItems");
  }
});

test("NOCTURNES samples: the port's instruments = NOCTURNES' (every sample, every value)", () => {
  const rate = 22050;
  const kinds = new Set<string>();
  for (const t of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    const plan = nMusic.scoreOf(genome(t)) as TS.Plan;
    kinds.add(`${plan.keys}/${plan.lead}/${plan.bass}`);
    const a = nSamples.makeSamples(plan, rate) as TS.SampleData<{ getChannelData(c: number): Float32Array }>;
    const b = TS.makeSampleData(plan, rate);
    for (const part of ["keys", "lead", "bass", "drums"] as const) {
      assert.deepEqual(Object.keys(b[part]), Object.keys(a[part]));
      for (const [k, x] of Object.entries(a[part])) {
        assert.ok(sameBits(x.getChannelData(0), (b[part] as Record<string, Float32Array>)[k]!), `token ${t} ${part} ${k}`);
        count("NOCTURNES samples (arrays bit-identical)");
      }
    }
  }
  assert.ok(kinds.size >= 5, "the tokens cover several instruments");
});

// ---------------------------------------------------------------- against the proof of concept

const MOOD_SPECS: TS.MoodSpec[] = [
  {}, { name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"] }, { energy: 0, darkness: 0 }, { energy: 1, darkness: 1, weather: ["rain"] },
  { energy: 0.3, darkness: 0.45, hue: 185, tempo: 84, room: ["fan", "x"] }, { energy: 0.8, tempo: [72, 76], weather: "crickets", space: 0.1 },
  { energy: NaN, darkness: -3, weather: ["nope"] }, { pins: { keys: "organ", key: "F#", mode: "phrygian" } },
];
const moods = (): TS.Mood[] => [
  ...MOOD_SPECS.map((s) => TS.moodFor(s)), ...Object.keys(TS.BANDS).map((band) => ({ band })),
  { band: { keys: [["vibes", 1]], swing: [0.1, 0.2] } }, { hue: 40, eclipse: true, picture: 4.32 }, { picture: 3.6, pins: { tempo: 90 } }, { energy: 0.2, dark: 0.3, view: "Sea", weather: ["waves"], room: ["hum", "vinyl"] },
];

test("POC plans: moodFor and scoreOf = the JS's for many moods, seeds and pins", () => {
  for (const spec of MOOD_SPECS) { assert.equal(json(TS.moodFor(spec)), json(JS.score.moodFor(spec))); count("POC moodFor"); }
  const pinSets: (TS.Pins | undefined)[] = [undefined, { band: "Retro Den" }, { keys: "wurli", lead: "chip", bass: "synth", kit: "boombap", mode: "dorian", key: "F#", tempo: 88 }, { key: 7 }, { key: "9" }, { tempo: "74" }, { band: "Nope" }];
  const ms = moods();
  for (let i = 0; i < 400; i += 1) {
    const mood = ms[i % ms.length]!;
    const pins = pinSets[i % pinSets.length];
    const opts = pins ? { pins } : {};
    assert.equal(json(TS.scoreOf(mood, `poc ${i}`, opts)), json(JS.score.scoreOf(mood, `poc ${i}`, opts)), `mood ${i % ms.length} pins ${json(pins)}`);
    count("POC plans (JSON identical)");
  }
  // (NOCTURNES' moods through the JS port's reader: the same mood, key for key.)
  for (let t = 1; t <= 50; t += 1) { assert.equal(json(TS.moodOfNocturnes(genome(t))), json(JS.nocturnes.moodOfNocturnes(genome(t)))); count("POC moodOfNocturnes"); }
  for (let i = 0; i < 200; i += 1) {
    const a = TS.streamOf(`s ${i}`); const b = JS.score.streamOf(`s ${i}`);
    for (let k = 0; k < 20; k += 1) assert.equal(a.f(), b.f());
    assert.equal(TS.hash(`h ${i}`), JS.score.hash(`h ${i}`));
  }
});

test("POC samples: the port's arrays = the JS's, bit for bit, across 16 plans", () => {
  const rate = 11025;
  const ms = moods();
  const kinds = new Set<string>();
  for (let i = 0; i < 16; i += 1) {
    const plan = TS.scoreOf(ms[(i * 5) % ms.length], `samples ${i}`, { pins: { keys: TS.CHOICES.keys[i % 7], lead: TS.CHOICES.lead[i % 8], bass: TS.CHOICES.bass[i % 4] } });
    kinds.add(`${plan.keys}/${plan.lead}/${plan.bass}`);
    const a = JS.samples.makeSampleData(plan, rate);
    const b = TS.makeSampleData(plan, rate);
    for (const part of ["keys", "lead", "bass", "drums"] as const) {
      assert.deepEqual(Object.keys(b[part]), Object.keys(a[part]));
      for (const [k, x] of Object.entries(a[part] as Record<string, Float32Array>)) {
        assert.ok(sameBits(x, (b[part] as Record<string, Float32Array>)[k]!), `plan ${i} ${part} ${k}`);
        count("POC samples (arrays bit-identical)");
      }
    }
    count("POC sample plans");
  }
  assert.ok(kinds.size >= 12, `every keys, lead and bass instrument is covered (${kinds.size} combos)`);
});

test("POC sfx: palettes and every sound's synthesis = the JS's, bit for bit", () => {
  const rate = 22050;
  const styles: TS.SfxStyleInput[] = ["lofi", "clean", "chip", "soft", "nope", { name: "chip", shoe: "boot", pitch: 1 }, { shoe: "soft", water: 1.2 }];
  for (let i = 0; i < 14; i += 1) {
    const seed = i % 2 ? `sfx ${i}` : i;
    const style = styles[i % styles.length]!;
    const a = JS.sfx.sfxStyle(seed, style);
    const b = TS.sfxStyle(seed, style);
    assert.equal(json(b), json(a));
    count("POC sfx palettes");
    const x = JS.sfx.sfxSamples(a, rate);
    const y = TS.sfxSamples(b, rate);
    assert.deepEqual(Object.keys(y), Object.keys(x));
    for (const k of Object.keys(x) as TS.SfxSampleKey[]) {
      const [xs, ys] = [x[k], y[k]].map((v) => (Array.isArray(v) ? v : [v])) as [Float32Array[], Float32Array[]];
      assert.equal(ys.length, xs.length);
      xs.forEach((v, j) => { assert.ok(sameBits(v, ys[j]!), `seed ${seed} ${k}[${j}]`); count("POC sfx samples (arrays bit-identical)"); });
    }
  }
});

test("POC numbers: paramsFor, intensityMix, voice, WAV and loop measures = the JS's", () => {
  const st = TS.sfxStyle("p");
  const inputs: TS.SfxParams[] = [{}, { speed: -5 }, { speed: 0 }, { speed: 3 }, { speed: 9.5 }, { speed: 14 }, { speed: 40 }, { speed: 1e9 }, { speed: NaN }, { gain: 3, pan: -9 }, { gain: -1, pan: 9 }, { rate: 100 }, { rate: 0 }, { surface: "metal" }, { surface: "lava" }, { surface: "water", speed: 7, gain: 0.5, pan: 0.2, rate: 1.3 }];
  for (const name of [...TS.SFX_NAMES, ...TS.LOOP_NAMES, "nope"]) for (const p of inputs) { assert.deepEqual(TS.paramsFor(name, p, st), JS.sfx.paramsFor(name, p, st)); count("POC paramsFor"); }
  for (let x = -0.5; x <= 1.5; x += 0.01) for (const tempo of [0, 0.04, 0.1]) { assert.deepEqual(TS.intensityMix(x, { tempo }), JS.player.intensityMix(x, { tempo })); count("POC intensityMix"); }
  for (const x of [NaN, "x", undefined, null]) assert.deepEqual(TS.intensityMix(x), JS.player.intensityMix(x));
  for (const [i, mood] of moods().entries()) {
    const plan = TS.scoreOf(mood, `v ${i}`);
    for (const b of plan.bars) {
      const prev = TS.voice(plan, b.chord, null);
      assert.deepEqual(TS.voice(plan, b.chord, prev), JS.player.voice(plan, b.chord, JS.player.voice(plan, b.chord, null)));
      count("POC voicings");
    }
  }
  const S = TS.streamOf("wav");
  for (let i = 0; i < 12; i += 1) {
    const chans = Array.from({ length: 1 + (i % 2) }, () => Float32Array.from({ length: 500 + i * 37 }, () => S.between(-1.2, 1.2)));
    if (i === 3) chans[0]![5] = NaN;
    assert.deepEqual(TS.measureLoop(chans, 8000, { edge: 0.01 * (1 + (i % 3)) }), JS.wav.measureLoop(chans, 8000, { edge: 0.01 * (1 + (i % 3)) }));
    assert.ok(Buffer.from(TS.encodeWav(chans, 8000)).equals(Buffer.from(JS.wav.encodeWav(chans, 8000))));
    count("POC WAV + measures");
  }
});

// ---------------------------------------------------------------- the page parts, call for call

test("POC player: play() asks Tone for the same graph and the same notes, bar for bar", async () => {
  for (const [i, mood] of moods().entries()) {
    if (i % 2) continue;
    const plan = TS.scoreOf(mood, `play ${i}`);
    const run = (play: typeof TS.play) => {
      const r = recorder();
      const band = play(r.tone as unknown as ToneLike, plan, null, i % 4 === 0 ? { intensity: 0.9 } : {});
      for (let n = 0; n < plan.loopBars + 3; n += 1) r.loops[0]!(n * plan.barSec);
      band.setIntensity(0.1, 2); band.setIntensity(0.105); band.react("dim"); band.react("bright"); band.setIntensity(1);
      for (let n = 0; n < 6; n += 1) r.loops[0]!(100 + n * plan.barSec);
      band.stop(0, { transport: i % 3 === 0 });
      return { r, intensity: band.intensity };
    };
    const a = run(JS.player.play);
    const b = run(TS.play);
    await new Promise((ok) => setTimeout(ok, 100)); // (stop disposes what it made a moment later)
    assert.equal(b.intensity, a.intensity);
    assert.ok(b.r.log.length > 1000, `a whole loop is a lot of calls (${b.r.log.length})`);
    assert.deepEqual(b.r.log, a.r.log, `mood ${i} ${plan.keys}/${plan.lead}/${plan.bass}/${plan.kit}`);
    count("POC player runs (call logs identical)");
    count("POC player calls compared", b.r.log.length);
  }
});

test("POC sfx on Web Audio: createSfx and bodySfx make the same nodes and play the same way", () => {
  for (const [i, target] of (["ctx", "tone", "ctx", "tone"] as const).entries()) {
    const run = (sfxMod: typeof TS) => {
      const r = recorder({ sampleRate: 11025 });
      const t = target === "tone" ? (r.tone as unknown as ToneLike) : (r.ctx as unknown as BaseAudioContext);
      const sfx = sfxMod.createSfx(t, { seed: `web ${i}`, style: TS.STYLE_NAMES[i]!, volume: 0.7 });
      for (const name of [...TS.SFX_NAMES, "nope"]) sfx.play(name, { speed: 5 + i, surface: TS.SURFACES[i % 3]!, pan: 0.2, when: 1 });
      for (let k = 0; k < 9; k += 1) sfx.play("step", { speed: k });
      const g = sfx.loop("grind", { speed: 9 }); g.set({ speed: 13 }); g.stop(0.2, 3); g.set({ speed: 1 });
      sfx.loop("nope");
      sfx.volume = 3;
      const feet = sfxMod.bodySfx(sfx, { surfaceOf: () => "metal" });
      const modes = ["ground", "ground", "air", "grind", "grind", "wall", "skim", "ground", "ground"];
      modes.forEach((mode, k) => feet.update({ mode, vel: [4 + k, k % 2, 6], events: k === 2 ? [{ type: "jumped" }] : k === 7 ? [{ type: "landed", speed: 11 }] : [] }, 0.3));
      feet.stop();
      sfx.stopAll();
      sfx.dispose();
      return r.log;
    };
    const a = run(JS.sfx as unknown as typeof TS);
    const b = run(TS);
    assert.deepEqual(b, a, `${target} ${TS.STYLE_NAMES[i]}`);
    count("POC createSfx + bodySfx runs (call logs identical)");
  }
});

test("POC sound on KEEL audio: createSound starts, follows the plan and plays sfx the same way", async () => {
  const run = async (createSound: typeof TS.createSound) => {
    const r = recorder();
    const events: string[] = [];
    const K = { start: () => {}, stop: () => {}, volume: 0.5 } as Record<string, unknown>;
    const handlers: Record<string, () => void> = {};
    for (const k of ["configure", "mountButton"]) K[k] = (...a: unknown[]) => { events.push(`${k} ${JSON.stringify(a[a.length - 1])}`); };
    K.onStart = (fn: () => void) => { handlers.start = fn; };
    K.onStop = (fn: () => void) => { handlers.stop = fn; };
    const g = globalThis as Record<string, unknown>;
    g.Tone = r.tone; g.KEEL_AUDIO = K;
    try {
      const sound = createSound(null, { id: "wall run!", sfx: { seed: "s", style: "chip" }, intensity: 0.7 });
      const plan = TS.scoreOf(TS.moodFor({ energy: 0.6 }), "sound");
      sound.setPlan(plan);
      events.push(`off ${sound.on} ${sound.sfx.play("jump")}`);
      handlers.start!();
      await new Promise((ok) => setTimeout(ok, 0));
      events.push(`on ${sound.on} ${sound.intensity} ${sound.volume}`);
      sound.sfx.play("confirm");
      sound.setIntensity(0.2, 1);
      sound.setPlan(plan); // (the same: plays on)
      sound.setPlan(TS.scoreOf(TS.moodFor({ energy: 0.1 }), "sound 2"));
      await new Promise((ok) => setTimeout(ok, 0));
      r.loops.at(-1)!(0);
      sound.react("dim");
      handlers.stop!();
      events.push(`stopped ${sound.on}`);
      await new Promise((ok) => setTimeout(ok, 500));
      return { log: r.log, events };
    } finally { delete g.Tone; delete g.KEEL_AUDIO; }
  };
  const a = await run(JS.sound.createSound);
  const b = await run(TS.createSound);
  assert.deepEqual(b.events, a.events);
  assert.deepEqual(b.log, a.log);
  count("POC createSound runs (call logs identical)");
});

test("summary", () => {
  console.log(`audio equality checks (all identical):\n${Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
});
