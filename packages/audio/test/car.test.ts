import { test } from "node:test";
import assert from "node:assert/strict";
import { CAR_MATERIALS, CAR_SOUNDS, carSoundRecipe, carSoundSample, isCarLoop, measureLoop, soundFeatures, featureDistance, createCarAudio } from "../src/index.ts";
import { polyfillAudioBuffer, recorder } from "./helpers.ts";
import type { ToneLike } from "../src/index.ts";

test("all car recipes and variants render finite, audible PCM with headroom and seamless loops", () => {
  for (const rate of [22050, 44100, 48000]) for (const name of CAR_SOUNDS) for (let variant = 0; variant < 4; variant++) {
    const recipe = carSoundRecipe(name, "redline", variant), pcm = carSoundSample(recipe, rate), m = measureLoop([pcm], rate);
    assert.equal(m.nan, 0, name); assert.ok(m.peak <= .73 && m.rmsDb > -55, `${name}: ${JSON.stringify(m)}`);
    assert.ok(m.seconds >= .1 && m.seconds <= 1.8, name);
    if (isCarLoop(name)) { assert.ok(m.seamless, `${name} seam`); assert.ok(m.edgeDiffDb < 4, `${name} loudness seam`); }
    else { assert.ok(Math.abs(pcm[0]!) < .002, `${name} attack click`); assert.ok(Math.abs(pcm.at(-1)!) < .002, `${name} release click`); }
  }
});
test("seeds and saved recipes reproduce exactly; materials have different spectral and temporal signatures", () => {
  for (const name of CAR_SOUNDS) {
    const a = carSoundRecipe(name, "redline", 1);
    assert.deepEqual(carSoundSample(a, 16000), carSoundSample(JSON.parse(JSON.stringify(a)), 16000));
  }
  const named = CAR_MATERIALS.map(m => [m, soundFeatures(carSoundSample(carSoundRecipe(`hit.${m}`), 16000), 16000)] as const);
  let min = Infinity;
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) { const d = featureDistance(named[i]![1], named[j]![1]); min = Math.min(min, d); assert.ok(d > 1.2, `${named[i]![0]} vs ${named[j]![0]}: ${d}`); }
  console.log(`Closest material feature distance: ${min.toFixed(3)} (not a subjective listening score)`);
  assert.notDeepEqual(carSoundSample(carSoundRecipe("hit.metal", "a")), carSoundSample(carSoundRecipe("hit.metal", "b")));
  assert.throws(() => carSoundSample(carSoundRecipe("hit.metal"), NaN), RangeError);
  assert.throws(() => carSoundSample({ ...carSoundRecipe("hit.metal"), version: 999 } as never), TypeError);
});
test("playback bounds voices, rate limits hits, caches samples, rejects invalid imports, and cleans up", () => {
  polyfillAudioBuffer(); const r = recorder({ sampleRate: 8000 });
  const player = createCarAudio(r.tone as unknown as ToneLike, { maxVoices: 4, maxCache: 8 });
  const first = player.play("hit.metal"); assert.ok(first);
  assert.equal(player.play("hit.metal"), null); assert.equal(player.stats.limited, 1);
  for (const name of ["engine.4", "wind", "nos"] as const) assert.ok(player.loop(name));
  assert.equal(player.stats.active, 4);
  assert.equal(player.loop("fire"), null); assert.ok(player.stats.dropped > 0);
  first.set({ gain: NaN, rate: Infinity, pan: 999, cutoff: NaN });
  assert.throws(() => player.adopt("hit.metal", Float32Array.of(NaN), 44100), TypeError);
  assert.throws(() => player.adopt("hit.metal", new Float32Array(12), 0), TypeError);
  player.dispose(); assert.equal(player.stats.active, 0); assert.equal(player.stats.cached, 0); assert.equal(player.play("horn"), null);
});

test("adopted engine banks remain isolated and missing banks never synthesize a substitute", () => {
  polyfillAudioBuffer(); const r = recorder({ sampleRate: 8000 });
  const player = createCarAudio(r.tone as unknown as ToneLike, { maxVoices: 8 });
  player.adopt("engine.8", new Float32Array(800).fill(.1), 8000, 0, "v8-a");
  player.adopt("engine.8", new Float32Array(800).fill(.2), 8000, 0, "v8-b");
  assert.ok(player.loop("engine.8", { profile: "v8-a" }));
  assert.ok(player.loop("engine.8", { profile: "v8-b" }));
  assert.equal(player.loop("engine.8", { profile: "missing" }), null);
  assert.equal(player.loop("engine.8", { profile: "v8-a", variant: 3 }), null);
  assert.equal(player.stats.rendered, 0);
  const buffers = r.log.filter(row => row[1] === "buffer=").map(row => row[2]);
  assert.equal(buffers.length, 2); assert.notEqual(buffers[0], buffers[1]);
  player.dispose();
});
test("effect variants reuse the adopted reference without evicting it or generating old effects", () => {
  polyfillAudioBuffer(); const r = recorder({ sampleRate: 8000 });
  const player = createCarAudio(r.tone as unknown as ToneLike, { maxVoices: 8, maxCache: 8 });
  for (const profile of ["effects", "audition"]) {
    player.adopt("road.snow", new Float32Array(800).fill(.1), 8000, 0, profile);
    for (let variant = 0; variant < 4; variant++) assert.ok(player.loop("road.snow", { profile, variant }));
  }
  assert.equal(player.stats.cached, 2); assert.equal(player.stats.rendered, 0);
  player.dispose();
});
test("nearby engines can start at independent loop phases without skipping one-shot attacks", () => {
  polyfillAudioBuffer(); const r = recorder({ sampleRate: 8000 });
  const player = createCarAudio(r.tone as unknown as ToneLike);
  player.adopt("engine.8", new Float32Array(80000).fill(.1), 8000, 0, "idle");
  for (const phase of [.17, .63, NaN]) assert.ok(player.loop("engine.8", { profile: "idle", phase }));
  assert.ok(player.play("shift.up", { phase: .8 }));
  const starts = r.log.filter(row => row[1] === "start");
  assert.equal(starts.length, 4);
  assert.ok(Math.abs(Number(starts[0]![3]) - 1.7) < 1e-9);
  assert.equal(starts[1]![3], 6.3); assert.equal(starts[2]![3], 0); assert.equal(starts[3]![3], 0);
  player.dispose();
});
