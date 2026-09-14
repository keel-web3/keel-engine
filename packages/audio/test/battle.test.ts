// Battle audio in Node: every sound seeded (the same seed and voice, the same
// bits), finite, heard, under full scale and as long as its kind may be; the
// construction loops seamless; the damage classes, the alerts and the six
// voice timbres told apart by their features (the distances are printed); a
// race's seed and a unit's size moving the voice; and the player's pool
// honoured through the recording stand-in for Web Audio (never more than
// maxVoices, drops counted, the lower priority stolen, the same name rate
// limited, samples rendered once).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_KINDS, BARK_KINDS, BATTLE_LOOPS, BATTLE_SOUNDS, DAMAGE_CLASSES, DEATH_MATERIALS, STING_KINDS, TIMBRES, battleSample, buildOfFlavour, createBattleAudio,
  distanceGain, featureDistance, measureLoop, panFor, priorityOf, soundFeatures, timbreOf, variantsOf, voiceFor,
} from "../src/index.ts";
import type { BattleVoice, SoundFeatures } from "../src/index.ts";
import { polyfillAudioBuffer, recorder, sameBits } from "./helpers.ts";

const RATE = 22050;
const SEED = "myriad-battle";
const RACES = ["race-a", "race-b"] as const;
const f2 = (x: number) => x.toFixed(2);

/** The closest pair among named features, and every pair's distance. */
function spread(label: string, named: readonly (readonly [string, SoundFeatures])[], full = true): { min: number; at: string } {
  let min = Infinity;
  let at = "";
  const rows: string[] = [];
  for (let i = 0; i < named.length; i += 1) {
    const cells: string[] = [];
    for (let j = 0; j < named.length; j += 1) {
      const d = featureDistance(named[i]![1], named[j]![1]);
      cells.push(i === j ? "  -  " : f2(d).padStart(5));
      if (j > i && d < min) { min = d; at = `${named[i]![0]} ~ ${named[j]![0]}`; }
    }
    rows.push(`  ${named[i]![0].padEnd(18)} ${cells.join(" ")}`);
  }
  console.log(`${label}: closest ${f2(min)} (${at})${full ? `\n${rows.join("\n")}` : ""}`);
  return { min, at };
}
const feat = (name: string, voice?: BattleVoice, variant = 0) => soundFeatures(battleSample(name, { seed: SEED, voice, variant, rate: RATE }), RATE);

test("names, variants, voices: what a game asks for", () => {
  assert.equal(BATTLE_SOUNDS.length, 6 + 6 + 2 + 3 + 2 + 8 + 5);
  assert.deepEqual([...BATTLE_LOOPS], ["build.machine", "build.organic", "build.energy"]);
  assert.equal(TIMBRES.length, 6);
  for (const n of BATTLE_SOUNDS) assert.ok(variantsOf(n) >= 1);
  assert.equal(variantsOf("fire.kinetic"), 4);
  assert.equal(variantsOf("bark.select"), 4);
  assert.throws(() => battleSample("fire.laser"), RangeError);
  // A voice: seeded, its flavour names read, a hue read as moodFor reads it, a size clamped.
  assert.deepEqual(voiceFor({ seed: "r", timbre: "machine" }), voiceFor({ seed: "r", timbre: "machine" }));
  assert.equal(voiceFor({ seed: "r", timbre: "biotic" }).timbre, "organic");
  assert.equal(voiceFor({ seed: "r", timbre: "crystalline" }).timbre, "crystal");
  assert.equal(timbreOf("nope"), undefined);
  assert.ok(TIMBRES.includes(voiceFor({ seed: "r" }).timbre), "no timbre: the seed picks one");
  assert.equal(voiceFor({ seed: "r", hue: 0 }).root, 0);
  assert.equal(voiceFor({ seed: "r", hue: 30 }).root, 7);
  assert.equal(voiceFor({ seed: "r", root: 14 }).root, 2);
  assert.equal(voiceFor({ seed: "r", size: 99 }).size, 4);
  assert.equal(buildOfFlavour("biotic"), "build.organic");
  assert.equal(buildOfFlavour("thermal"), "build.machine");
  assert.equal(buildOfFlavour("gravitic"), "build.energy");
});

test("determinism: the same seed and voice make the same bits; another battle seed other sounds", () => {
  const v = voiceFor({ seed: "race-a", timbre: "resonant", size: 1.2 });
  for (const n of [...BATTLE_SOUNDS, ...BATTLE_LOOPS]) {
    const a = battleSample(n, { seed: SEED, voice: v, variant: 1, rate: RATE });
    const b = battleSample(n, { seed: SEED, voice: { seed: "race-a", timbre: "resonant", size: 1.2 }, variant: 1, rate: RATE });
    assert.ok(sameBits(a, b), `${n} the same twice`);
    if (!/^(alert|bark|sting)\./.test(n)) assert.ok(!sameBits(a, battleSample(n, { seed: "another", variant: 1, rate: RATE })), `${n} differs between seeds`);
  }
  // Variants differ from each other.
  for (const n of ["fire.kinetic", "hit.siege", "death.crystal", "bark.move"]) {
    const xs = Array.from({ length: variantsOf(n) }, (_, k) => battleSample(n, { seed: SEED, voice: v, variant: k, rate: RATE }));
    for (let i = 1; i < xs.length; i += 1) assert.ok(!sameBits(xs[0]!, xs[i]!), `${n} variant ${i}`);
  }
});

test("every sound: finite, heard, never clips, as long as its kind may be", () => {
  const limit = (n: string): [number, number] => {
    if (n.startsWith("bark.")) return [0.06, 0.7];
    if (n.startsWith("fire.")) return [0.05, 0.6];
    if (n.startsWith("hit.")) return [0.05, 0.8];
    if (n === "explode.big") return [1, 2.5];
    if (n === "explode.small") return [0.3, 1];
    if (n.startsWith("death.")) return [0.3, 1.2];
    return [0.2, 1.2]; // (alerts, stings)
  };
  const check = (n: string, x: Float32Array, what: string) => {
    const m = measureLoop([x], RATE);
    const [lo, hi] = limit(n);
    assert.equal(m.nan, 0, `${what} finite`);
    assert.ok(m.peak > 0.5 && m.peak <= 0.9, `${what} peak ${m.peak}`);
    assert.ok(m.rmsDb > -32, `${what} heard (${m.rmsDb} dB)`);
    assert.ok(m.seconds >= lo && m.seconds <= hi, `${what} ${m.seconds} s in ${lo}-${hi}`);
  };
  let count = 0;
  for (const style of ["clean", "chip"]) {
    for (const n of BATTLE_SOUNDS.filter((s) => !/^(alert|bark|sting)\./.test(s))) {
      for (let k = 0; k < variantsOf(n); k += 1) { check(n, battleSample(n, { seed: SEED, style, variant: k, rate: RATE }), `${style} ${n}#${k}`); count += 1; }
    }
  }
  for (const timbre of TIMBRES) {
    for (const size of [0.6, 1, 3]) {
      const v = voiceFor({ seed: "race-a", timbre, size });
      for (const b of BARK_KINDS) for (let k = 0; k < variantsOf(`bark.${b}`); k += 1) { check(`bark.${b}`, battleSample(`bark.${b}`, { seed: SEED, voice: v, variant: k, rate: RATE }), `${timbre}@${size} bark.${b}#${k}`); count += 1; }
      if (size !== 1) continue;
      for (const a of ALERT_KINDS) { check(`alert.${a}`, battleSample(`alert.${a}`, { seed: SEED, voice: v, rate: RATE }), `${timbre} alert.${a}`); count += 1; }
      for (const s of STING_KINDS) { check(`sting.${s}`, battleSample(`sting.${s}`, { seed: SEED, voice: v, rate: RATE }), `${timbre} sting.${s}`); count += 1; }
    }
  }
  console.log(`sounds checked: ${count}`);
});

test("construction loops: seamless, level at both ends, under full scale", () => {
  for (const seed of [SEED, "other"]) {
    for (const n of BATTLE_LOOPS) {
      const m = measureLoop([battleSample(n, { seed, rate: RATE })], RATE);
      assert.equal(m.nan, 0);
      assert.ok(m.rmsDb > -32 && m.peak <= 0.61, `${seed} ${n} ${m.rmsDb} dB peak ${m.peak}`);
      assert.ok(m.seamless, `${seed} ${n} wraps with a step of ${m.wrapStep} (its own p99 ${m.stepP99})`);
      assert.ok(m.edgeDiffDb < 6, `${seed} ${n} head and tail alike (${m.headDb} / ${m.tailDb})`);
      if (seed === SEED) console.log(`${n}: ${m.seconds} s, ${m.rmsDb} dB, wrap ${m.wrapStep} vs p99 ${m.stepP99}, edges ${m.edgeDiffDb} dB`);
    }
  }
});

test("distinct: the damage classes' fire and impacts, the deaths, the explosions", () => {
  const fire = spread("fire (feature distance)", DAMAGE_CLASSES.map((d) => [d, feat(`fire.${d}`)] as const));
  const hit = spread("impacts", DAMAGE_CLASSES.map((d) => [d, feat(`hit.${d}`)] as const));
  const death = spread("deaths", DEATH_MATERIALS.map((m) => [m, feat(`death.${m}`)] as const));
  const boom = featureDistance(feat("explode.small"), feat("explode.big"));
  console.log(`explode small ~ big: ${f2(boom)}`);
  assert.ok(fire.min > 0.6, `fire: ${fire.at} only ${f2(fire.min)} apart`);
  assert.ok(hit.min > 0.6, `impacts: ${hit.at} only ${f2(hit.min)} apart`);
  assert.ok(death.min > 0.6, `deaths: ${death.at} only ${f2(death.min)} apart`);
  assert.ok(boom > 0.6);
});

test("distinct: the alerts in every timbre, for two races (rhythm and contour)", () => {
  let worst = Infinity;
  for (const race of RACES) {
    for (const timbre of TIMBRES) {
      const v = voiceFor({ seed: race, timbre });
      const { min, at } = spread(`alerts, ${race} ${timbre}`, ALERT_KINDS.map((a) => [a, feat(`alert.${a}`, v)] as const), race === RACES[0]);
      assert.ok(min > 0.35, `${race} ${timbre}: ${at} only ${f2(min)} apart`);
      worst = Math.min(worst, min);
    }
  }
  console.log(`alerts: the closest pair over 2 races x 6 timbres is ${f2(worst)} apart`);
});

test("distinct: the six timbres' barks; two races with one timbre; a bigger unit lower", () => {
  let worst = Infinity;
  for (const race of RACES) {
    for (const b of BARK_KINDS) {
      const { min, at } = spread(`timbres, ${race} bark.${b}`, TIMBRES.map((t) => [t, feat(`bark.${b}`, voiceFor({ seed: race, timbre: t }))] as const), race === RACES[0]);
      assert.ok(min > 0.8, `${race} bark.${b}: ${at} only ${f2(min)} apart`);
      worst = Math.min(worst, min);
    }
  }
  console.log(`timbres: the closest pair over 2 races x 5 barks is ${f2(worst)} apart`);
  // Two races, one timbre: other sounds (other bits, other features).
  const rows: string[] = [];
  for (const t of TIMBRES) {
    const [a, b] = RACES.map((r) => voiceFor({ seed: r, timbre: t })) as [BattleVoice, BattleVoice];
    assert.ok(a.f0 !== b.f0 && a.id !== b.id);
    for (const k of ["bark.select", "bark.attack", "alert.underAttack"]) {
      const [x, y] = [a, b].map((v) => battleSample(k, { seed: SEED, voice: v, rate: RATE })) as [Float32Array, Float32Array];
      assert.ok(!sameBits(x, y), `${t} ${k}`);
      const d = featureDistance(soundFeatures(x, RATE), soundFeatures(y, RATE));
      assert.ok(d > 0.05, `${t} ${k}: two races only ${f2(d)} apart`);
      rows.push(`${t} ${k} ${f2(d)}`);
    }
  }
  console.log(`two races, one timbre: ${rows.join(", ")}`);
  // A unit's size: a bigger one is lower (its pitch and its brightness) and a little slower.
  for (const t of TIMBRES) {
    const [small, big] = [0.6, 2].map((size) => voiceFor({ seed: "race-a", timbre: t, size })) as [BattleVoice, BattleVoice];
    assert.ok(big.f0 < small.f0 && big.formant < small.formant && big.beat > small.beat, t);
    const [cs, cb] = [small, big].map((v) => soundFeatures(battleSample("bark.select", { seed: SEED, voice: v, rate: RATE }), RATE).centroid) as [number, number];
    assert.ok(cb < cs, `${t}: a big unit's bark (${cs.toFixed(0)} -> ${cb.toFixed(0)} Hz) is lower`);
  }
});

test("panFor, distanceGain, priorities", () => {
  assert.equal(panFor(0, 800), -0.85);
  assert.equal(panFor(400, 800), 0);
  assert.equal(panFor(800, 800, 1), 1);
  assert.equal(panFor(5000, 800, 1), 1);
  assert.equal(panFor(NaN, 800), -0.85);
  assert.equal(distanceGain(3), 1);
  assert.equal(distanceGain(60), 0);
  assert.ok(distanceGain(12) > distanceGain(24) && distanceGain(24) > distanceGain(40) && distanceGain(40) > 0);
  assert.equal(distanceGain(NaN), 1);
  assert.ok(priorityOf("alert.underAttack") > priorityOf("bark.select") && priorityOf("bark.select") > priorityOf("death.metal") && priorityOf("death.metal") > priorityOf("fire.kinetic"));
});

test("the player: the pool's cap, drops, steals, rate limits and the cache, through the recording stand-in", () => {
  polyfillAudioBuffer();
  const rec = recorder({ sampleRate: 8000 });
  const ctx = rec.ctx as unknown as BaseAudioContext & { currentTime: number };
  const battle = createBattleAudio(ctx, { seed: SEED, maxVoices: 4, voice: { seed: "race-a", timbre: "machine" } });
  const sources = () => rec.log.filter((e) => e[0] === "new" && e[1] === "ctx.BufferSource").map((e) => e[2] as string);
  // Four fill the pool; the next two (as important) are dropped and counted.
  const first = ["fire.kinetic", "fire.blast", "hit.kinetic", "hit.energy"].map((n) => battle.play(n));
  assert.ok(first.every((s) => s !== null));
  assert.equal(battle.play("fire.siege"), null);
  assert.equal(battle.play("hit.acid", { priority: 1 }), null);
  assert.deepEqual({ ...battle.stats, rendered: 0 }, { played: 4, dropped: 2, limited: 0, stolen: 0, active: 4, rendered: 0 });
  assert.equal(sources().length, 4, "a dropped sound makes no nodes");
  // An alert steals: the lowest priority, the oldest of those (the first gunshot), faded out and stopped.
  const alert = battle.play("alert.underAttack");
  assert.ok(alert && alert.priority === 5);
  assert.equal(battle.stats.stolen, 1);
  assert.equal(battle.stats.active, 4);
  const firstSrc = sources()[0]!;
  assert.ok(rec.log.some((e) => e[0] === firstSrc && e[1] === "stop"), "the stolen one is stopped");
  // A sound at a higher priority than all but the alert steals the next oldest; one no higher than any is dropped.
  assert.ok(battle.play("death.metal"));
  assert.equal(battle.play("fire.acid", { priority: 0 }), null);
  assert.deepEqual([battle.stats.stolen, battle.stats.dropped], [2, 3]);
  // The same name again inside 40 ms: limited (before the pool is even asked).
  assert.equal(battle.play("alert.underAttack"), null);
  assert.equal(battle.stats.limited, 1);
  // Time passes: the one-shots end and free their voices.
  ctx.currentTime = 5;
  assert.equal(battle.stats.active, 0);
  assert.ok(battle.play("alert.underAttack"), "after 40 ms it plays again");
  // A loop holds a voice until stopped; set ramps; stop frees it.
  const site = battle.loop("build.machine", { pan: -0.3 });
  assert.ok(site.playing);
  assert.equal(battle.stats.active, 2);
  site.set({ gain: 0.5, rate: 1.1 });
  site.stop();
  assert.ok(!site.playing);
  assert.equal(battle.stats.active, 1);
  assert.ok(!battle.loop("fire.kinetic").playing, "a one-shot isn't a loop");
  assert.equal(battle.play("build.machine"), null, "a loop isn't a one-shot");
  assert.equal(battle.play("nope"), null);
  // The cache: a sound (name, variant, voice) is rendered once, however often it plays.
  const before = battle.stats.rendered;
  for (let k = 0; k < 8; k += 1) { ctx.currentTime += 1; battle.play("fire.kinetic", { variant: 2 }); }
  assert.equal(battle.stats.rendered, before + 1);
  ctx.currentTime += 1;
  battle.play("bark.select", { variant: 0, voice: { seed: "race-a", timbre: "machine", size: 2 } });
  ctx.currentTime += 1;
  battle.play("bark.select", { variant: 0, voice: { seed: "race-b", timbre: "organic" } });
  assert.equal(battle.stats.rendered, before + 3, "another voice is another sample");

  // A storm: 400 plays, 20 ms apart, random names and priorities; the pool never holds more than maxVoices.
  const storm = createBattleAudio(ctx, { seed: SEED, maxVoices: 6 });
  const S = [...BATTLE_SOUNDS.filter((n) => !n.startsWith("bark.") && !n.startsWith("alert.") && !n.startsWith("sting."))];
  let peak = 0;
  let h = 7;
  const rnd = () => { h = (Math.imul(h, 1103515245) + 12345) >>> 0; return h / 4294967296; };
  for (let i = 0; i < 400; i += 1) {
    ctx.currentTime += 0.02;
    storm.play(S[Math.floor(rnd() * S.length)]!, { priority: Math.floor(rnd() * 4), variant: Math.floor(rnd() * 4) });
    peak = Math.max(peak, storm.stats.active);
    assert.ok(storm.stats.active <= 6);
  }
  const st = storm.stats;
  console.log(`storm (400 plays, maxVoices 6): played ${st.played}, dropped ${st.dropped}, limited ${st.limited}, stolen ${st.stolen}, most at once ${peak}, samples rendered ${st.rendered}`);
  assert.equal(st.played + st.dropped + st.limited, 400);
  assert.equal(peak, 6);
  assert.ok(st.dropped > 0 && st.stolen > 0 && st.limited > 0);
  storm.stop();
  assert.equal(storm.stats.active, 0);
});

test("the player on Tone: into Tone's destination (KEEL's volume and mute), and prerender", () => {
  polyfillAudioBuffer();
  const rec = recorder({ sampleRate: 8000 });
  const battle = createBattleAudio(rec.tone as never, { seed: SEED, voice: { seed: "race-a", timbre: "crystal" } });
  const connect = rec.log.find((e) => e[0] === "Tone" && e[1] === "connect");
  assert.ok(connect && /^ctx\.Gain#/.test(connect[2] as string) && /^Destination#/.test(connect[3] as string), JSON.stringify(connect));
  const n = battle.prerender();
  assert.equal(n, [...BATTLE_SOUNDS, ...BATTLE_LOOPS].filter((s) => !/^(alert|bark|sting)\./.test(s)).reduce((s, x) => s + variantsOf(x), 0));
  const m = battle.prerender(["bark.select", "alert.unitReady"], [{ seed: "race-a", timbre: "crystal" }, { seed: "race-a", timbre: "crystal", size: 1.4 }]);
  assert.equal(m, n + 2 * (variantsOf("bark.select") + 1));
  assert.ok(battle.play("sting.complete"));
  battle.dispose();
});

test("prerenderStep: a little at a time, never past its budget by more than one sample, until everything's cached", () => {
  polyfillAudioBuffer();
  const rec = recorder({ sampleRate: 8000 });
  const battle = createBattleAudio(rec.ctx as never, { seed: SEED, voice: { seed: "race-a", timbre: "organic" } });
  const names = ["fire.kinetic", "hit.kinetic", "explode.small", "bark.select"];
  const total = names.reduce((n, name) => n + variantsOf(name), 0);
  assert.equal(battle.prerenderStep(0, names), total, "no time: nothing rendered, all still to go");
  let left = total, steps = 0;
  while (left > 0 && steps < 100) { const before = left; left = battle.prerenderStep(0.001, names); assert.ok(left < before, "each step renders at least one"); steps += 1; }
  assert.equal(left, 0);
  assert.equal(battle.prerenderStep(50, names), 0, "all cached: nothing left");
  assert.ok(battle.stats.rendered >= total);
});

test("adopt: a sample made during loading (battleSample, no context yet) is the player's own -- never rendered again", () => {
  polyfillAudioBuffer();
  const rec = recorder({ sampleRate: 8000 });
  const voice = { seed: "race-a", timbre: "machine" } as const;
  const battle = createBattleAudio(rec.ctx as never, { seed: SEED, voice });
  const made = battleSample("explode.big", { seed: SEED, style: "clean", variant: 0, rate: 8000 });
  assert.equal(battle.adopt("explode.big", 0, made, undefined, 8000), true);
  assert.equal(battle.adopt("nonsense.name", 0, made), false);
  const before = battle.stats.rendered;
  battle.play("explode.big", { variant: 0 });
  assert.equal(battle.stats.rendered, before, "played from the adopted sample");
  assert.equal(battle.prerenderStep(0, ["explode.big"]), variantsOf("explode.big") - 1, "only the other variant is still to go");
});
