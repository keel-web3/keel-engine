# `@keel-engine/audio`

Music and sound effects for projects and games on the engine, as the KEEL
module `keel/audio` (`runtime`, needs `keel/codec@^0.1`: music and sfx
settings are stored as its bytes). Everything is made in code
from a seed: the music is generative lo-fi (the NOCTURNES composer,
generalised), the instruments are synthesised samples, and the sound effects
are a seeded sound palette. Nothing is fetched.

Only `play`, `render`, `createSound`, `createSfx` and `createBattleAudio` touch Web Audio. The rest
(plans, moods, samples, sfx synthesis, params, the body mapping, WAV and loop
measures) is plain TypeScript that runs in Node and is tested there.

**Tone is not bundled.** It is a global the page provides: a KEEL piece gets it
(and keel-audio) from its `extends`, locally from `vendor/`. The package types
only what it uses (`ToneLike` in `src/tone.ts`) and depends on no `tone` npm
package. `pageTone()` / `pageKeelAudio()` read the globals.

| File | What |
| --- | --- |
| `src/score.ts` | `scoreOf(mood, seed, { pins })` → `Plan` (plain JSON); `moodFor(spec)` → `GameMood`; `BANDS`, `CHOICES`, `MODES`, `WEATHER_KINDS`, `ROOM_KINDS`, `streamOf`, `hash`, `diatonic` |
| `src/player.ts` | `play(Tone, plan, out, { intensity, tempo, from, start })` → `Band` (`ready`, `stop`, `react`, `setIntensity`, `intensity`); `render(Tone, plan, { preroll, intensity, rate, overrun })` → one seamless loop (`AudioBuffer`); `intensityMix(x)`; `voice` |
| `src/samples.ts` | `makeSampleData(plan, rate)` → `SampleData` of `Float32Array`s (keys, lead, bass, drums); `makeSamples(plan, rate)` → `AudioBuffer`s; the synthesis parts (`partials`, `pluck`, `wear`, …) |
| `src/sfx.ts` | `createSfx(Tone \| ctx, { seed, style, settings })` → `Sfx` (`play(name, params)`, `loop(name, params)` → `SfxLoop`); `bodySfx(sfx, { surfaceOf, materialOf, settings })` for physics bodies; `sfxStyle`, `sfxSamples`, `paramsFor`, `jitterOf`, `tuningOf`; `sfxSettingsBytes` / `sfxSettingsOf` |
| `src/battle.ts` | battle audio's pure half: `battleSample(name, { seed, style, variant, voice, rate })` → `Float32Array`; `BATTLE_SOUNDS`, `BATTLE_LOOPS`, `DAMAGE_CLASSES`, `DEATH_MATERIALS`, `BUILD_FLAVOURS`, `EXPLOSION_SIZES`, `variantsOf`, `isBattleName`, `isBattleLoop`, `isVoiced`, `buildOfFlavour`, `asVoice` |
| `src/voice.ts` | a race's voice: `voiceFor({ seed, timbre, size, root, hue })` → `BattleVoice`; `alertSample`, `barkSample`, `stingSample`; `TIMBRES`, `ALERT_KINDS`, `BARK_KINDS`, `STING_KINDS`, `timbreOf` |
| `src/battle-audio.ts` | `createBattleAudio(Tone \| ctx, { seed, style, maxVoices, minGap, voice, out, volume, jitter })` → `BattleAudio` (the pooled player); `panFor`, `distanceGain`, `priorityOf` |
| `src/synth.ts` | the battle audio's synthesis kit (bursts, sweeps, thumps, oscillators on a contour, formants, `finish`); `BATTLE_STYLES`, `wearOf` |
| `src/features.ts` | `soundFeatures(x, rate)` → `SoundFeatures`, `featureVector`, `featureDistance` (how sounds are told apart) |
| `src/store.ts` | music as codec bytes: `musicRecipe(mood, seed, pins)`, `storeMusic(recipe \| plan)`, `loadMusic(bytes)` → `Plan`, `planOfRecipe` |
| `src/sound.ts` | `createSound(host, { id, sfx })` → `Sound`: the speaker button, the KEEL_AUDIO path, `setPlan`, `setIntensity`, `sfx`, `renderLoop` |
| `src/nocturnes.ts` | `moodOfNocturnes(genome)` — NOCTURNES' room as a mood (its plans, byte for byte); `themeForItems` |
| `src/wav.ts` | `encodeWav(channels, rate)`, `measureLoop(channels, rate)` → `LoopMeasure` (level, peak, seam) |
| `src/tone.ts` | `ToneLike`, `KeelAudioLike` and the few node shapes the player uses; `pageTone`, `pageKeelAudio` |
| `src/module.ts` | `manifest` — `keel/audio@0.1.0`, `runtime`, `needs: ["keel/codec@^0.1"]` |
| `src/index.ts` | all of the above |

## Music and sound effects in a game, in about 20 lines

```html
<script src="vendor/tone-15.1.22-native.js"></script>
<!-- on a KEEL page, keel-audio comes from the piece's extends; locally: -->
<script src="vendor/keel-audio-1.0.0.min.js"></script>
```

```ts
import { bodySfx, createSound, moodFor, scoreOf } from "@keel-engine/audio";
import type { BodySfx } from "@keel-engine/audio";

// The record: this game's mood, this seed's band. (Pass the palette's key hue to put the music in the picture's key.)
const mood = moodFor({ name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"], hue: palette.hue });
const sound = createSound(hostElement, { id: "wallrun", sfx: { seed, style: "lofi" } });
sound.setPlan(scoreOf(mood, seed));

let feet: BodySfx | null = null;
function stepOnce() {
  body.step(STEP, input);
  // Sound effects come alive once the listener turns sound on (browsers need the click).
  if (sound.on && !feet) feet = bodySfx(sound.sfx, { surfaceOf: (b) => surfaceUnder(b) }); // "stone" | "metal" | "water"
  if (!sound.on && feet) { feet.stop(); feet = null; }
  feet?.update(body, STEP);
  // Faster and fuller while running; filtered and sparse while standing.
  const speed = Math.hypot(body.vel[0], body.vel[2]);
  sound.setIntensity(Math.min(1, 0.15 + speed / 11), 1.5);
}
// UI: sound.sfx.play("select"), sound.sfx.play("confirm") ...
```

`setIntensity` ramps (1.5 s here) and ignores changes under 0.01, so calling
it every step is fine. For a menu, call `sound.setIntensity(0.15)`.

## The score

`scoreOf(mood, seed, { pins })` returns a `Plan` — plain JSON: the band's
players (`keys`, `lead`, `bass`, `kit`), `tonic`, `mode`, `bpm`, `swing`,
`form` (sections A, B, A2, C, T), `loopBars` (32, 36 or 40) and `loopSec`, the
`groove`, the instruments' `design` (brightness, bell, kick, snare, bits,
wear), every bar's chord, the `motif`, the `weather` and `room` layers, and the
`mix` (cutoff, tape, reverb, wow). The same mood and seed make the same plan
on every machine (exact integer streams). Every bar is played from its own
seed (`${seed}|bar|${index}`), so the loop starts anywhere and goes round
without a seam.

**Every piece is lo-fi.** Whatever the mood: a swung beat off synthesised drum
samples, keys that pump under the kick (the sidechain), tape wow and
saturation, a record scratch into sections, a tape stop on the loop's last
beat, vinyl crackle and platter rumble always under it, the samples worn to
the plan's bits and top. The mood only chooses which lo-fi.

**Every seed is its own record.** Tokens 1..200 of NOCTURNES make 122
instrument combinations and 200/200 distinct plans; a game mood over 200
seeds makes 136-164 combinations, 200/200 distinct, 23-33 keys-and-modes and
13-16 tempi (`test/audio.test.ts` prints these). Don't write one song per
scene: give the scene a mood and let the seed write the song.

### Moods

```ts
moodFor({ energy: 0.65, darkness: 0.7, weather: ["waves", "wind"], tempo: 84 /* or [lo, hi] */, hue: 185, name: "Night Water", room: ["fan"], space: 0.05, pins })
```

- `energy` 0 (idle, menus) … 1 (driving): tempo range (64-76 bpm at 0, 82-96 at 1), boom-bap
  and Wurli/organ/chip as it rises, brushed/soft kits and felt/celesta/music box as it falls,
  more scratch, less room. It is also the plan's `energy` — the player's starting intensity.
- `darkness` 0 (day: major, brighter instruments, open top) … 1 (deep night: minor, jazzier
  chords, Rhodes and piano, a darker cutoff).
- `weather`: layers under the record — `rain`, `waves`, `traffic`, `wind`, `hush`, `crickets`,
  `car`, `chimes`, `shimmer` (unknown names are dropped). `room` adds `crackle`, `fan`, `hum`.
- `tempo`: a number pins the bpm; `[lo, hi]` is the range the seed picks in.
- `hue` (0-360): the key, round the circle of fifths, as NOCTURNES reads its palette. Omit it
  and the seed picks the key — or pass the project's palette hue so each seed's picture and
  music share a key (a fixed hue means one key for every seed: pass the seed's).

A `Mood` can also be written by hand: `{ band: "Nightcap" }` plays NOCTURNES'
Nightcap band (any of `BANDS`), or `{ band: { keys: [["rhodes", 3], ["felt", 1]], … } }`
a band of your own (`BandInput`, laid over "Loose": `keys`, `lead`, `bass`,
`feel` as `[choice, weight]` lists; `tempo` [lo, hi]; `swing` [lo, hi]; `room`,
`jazz`, `vox`, `scratch`, `bright`, `worn` 0-1; optional `mode` or
`lean: "major"`). `picture` (seconds) locks the tempo so the loop is a whole
number of an animation's loops (NOCTURNES' GIFs); `view`, `dark`, `eclipse`,
`space` are the rest of what NOCTURNES reads.

### Locks and pins

Any choice can be fixed; the seed decides the rest (as in NOCTURNES' studio, a
pin skips its own draw, so the seed's later choices may come out differently
than without it — still the same every time for that seed and those pins):

```ts
scoreOf(mood, seed, { pins: { band: "Retro Den", keys: "wurli", lead: "chip", bass: "synth", kit: "boombap", mode: "dorian", key: "F#" /* or 6 */, tempo: 88 } })
```

Pins can also live on the mood (`mood.pins`); `opts.pins` wins. The choices
are `CHOICES` (`keys`: rhodes wurli piano felt vibes organ guitar; `lead`:
rhodes piano celesta kalimba musicbox vibes guitar chip; `bass`: sub upright
electric synth; `kit`: dusty boombap brushed soft rim chip; `mode`: ionian
dorian phrygian lydian mixolydian aeolian harmonic; `key`: C … B). Pins are
typed as strings (`Pins`): NOCTURNES' studio passes its own, and an unknown
one falls back the way the proof of concept does.

### Intensity

`band.setIntensity(x, ramp)` (or `sound.setIntensity`) moves layers live
without touching the loop — bars keep their seeds and their place:

| x | what you hear |
| --- | --- |
| 0 | keys through a wall (650 Hz lowpass), a soft pulse of drums (30%), no tune, tempo −4% |
| 0.5 | the plan as composed (all layers at 1, open, the plan's tempo) |
| 1 | everything in, a busier kit on top (extra hats, kicks and shaker from a separate stream), tempo +4% |

`intensityMix(x)` gives the numbers (tests read them); `play(..., { tempo: 0 })`
holds the tempo still (renders always do).

### Playing and rendering

```ts
const band = play(Tone, plan, out /* default Tone's destination */, { intensity: 0.5 });
await band.ready;            // (the reverb's room)
band.react("dim");           // a little quieter; "bright" back
band.stop(0.4);
const loop = await render(Tone, plan);   // one loop, played from 4 bars before the top so tails ring in: repeats with no seam
```

`Tone` here is the page's global (`pageTone()`), typed `ToneLike`.

## Sound effects

```ts
const sfx = createSfx(Tone /* or an AudioContext / OfflineAudioContext */, { seed, style: "lofi" });
sfx.play("step", { surface: "metal", speed: 8, pan: -0.3 });
sfx.play("land", { speed: 11 });            // louder and lower the harder; "land_hard" over 9 m/s
const g = sfx.loop("grind", { speed: 9 });  // loops fade in from anywhere in them
g.set({ speed: 13 }); g.stop(0.15);
```

The seed picks the project's **sound palette** (`sfxStyle(seed, style)` →
`SfxStyle`): the shoes (sneaker, boot, soft), pitch, brightness, weight, how
worn (bits, hold, top), the rails' metal (a bar's inharmonic partials), the
water, the wind, the UI's key. Styles: `lofi` (default: worn, warm, a short
slap), `clean`, `chip` (6-bit, square UI), `soft`. Pin any field:
`style: { name: "chip", shoe: "boot" }`.

| Name | Params | What |
| --- | --- | --- |
| `step` | `surface` stone/metal/water, `speed` | heel and toe (stone), a ring (metal), a splash with bubbles (water); 4 variants each, in turn |
| `jump` | | the push and a whoosh going up |
| `land` | `speed` (m/s) | a falling thump and the crunch underfoot |
| `wallStart`, `wallJump` | | a grab; a kick and the air |
| `railStart`, `railEnd` | | a clang on the rail; a smaller ring letting go |
| `splash`, `skimStart` | | in you go (plop, bubbles); a skim's touch-down |
| `respawn` | | a rise in the palette's key |
| `blip`, `hover`, `select`, `back`, `confirm`, `error` | | the UI, in key |
| loop `grind` | `speed` 4-14 | the rail singing and rattling: pitch, level and brightness by speed |
| loop `wallrun` | `speed` | two scuffs a loop and the rub between; cadence by speed |
| loop `skim` | `speed` 6.5-12 | a hiss and a slap each stride |
| loop `wind` | `speed` 0-20 | silent under 2 m/s, gusting up with speed |

Every sound also takes `gain` (0-2), `pan` (-1..1), `rate`, `when` (context
time) — `SfxParams`. `paramsFor(name, params)` → `SfxPlay` shows how a sound
will be played.

### A physics body's sounds

`bodySfx(sfx, { surfaceOf, wind, gain })` → `{ update(body, dt), stop(), held }`.
It takes any `SfxPlayer` (`play`, `loop`) and any `SfxBody` (`vel`, `mode`,
`events`) — the character controller's shape. Call `update` after each
`body.step`. It plays: `landed {speed}` → land, `jumped` → jump, `wallStart`,
`wallJump`, `railStart`, `railEnd`, `skimStart`, `splashIn` → splash,
`respawn`; footsteps from the run (a stride of 0.7 m + 0.24 × speed: ~3 steps
a second at a full run, on `surfaceOf(body)`); and holds the `grind`,
`wallrun` and `skim` loops while the body's mode is `grind`, `wall`, `skim`
(speeds follow the body), and the `wind` by its speed. `stop()` lets every
loop go.

### Settings: a project's sounds as data

A project keeps its sound effects as one `SfxSettings` value (the codec's
`SFX_SETTINGS`, `keel/audio/sfx`): `seed`, `style`, `volume`, `body` (`wind`,
`gain`, `surfaces`: material → stone/metal/water, `events`: body event →
sound) and `sounds` (per sound: `gain`, `rate`, `pan`, `jitter`).

```ts
const settings = { seed: "wallrun", style: { name: "lofi", shoe: "boot" }, volume: 0.8,
  body: { wind: true, gain: 1, surfaces: { rail: "metal", water: "water" }, events: { ledgeGrab: "wallStart" } },
  sounds: { step: { gain: 0.9, jitter: 0.08 }, grind: { rate: 1.05 }, wind: { gain: 0.6, pan: 0 } } };
const bytes = sfxSettingsBytes(settings);       // 151 bytes for WALLRUN's (JSON: 514); sfxSettingsOf(bytes) reads them
const sfx = createSfx(Tone, { settings: bytes }); // or the value
const feet = bodySfx(sfx, { settings: bytes, materialOf: (body) => level.materialUnder(body) }); // (the game says what is underfoot)
```

- `createSfx(target, { settings })`: the seed, style and volume come from the
  settings unless the options give them. Each sound's tuning is applied in
  `play()` and `loop()`: `gain` multiplies its gain, `rate` its pitch, `pan`
  is used when the call gives none, and `jitter` is the +/- spread of its rate
  from play to play (untuned: 0.035 for step, land and jump, none for the
  rest; a loop draws its own once as it starts). `paramsFor(name, params, st,
  tuning)` and `jitterOf(name, tuning)` are that mapping as plain code. With no
  settings (or none for a sound) every value and every draw from the seeded
  jitter stream is what it always was (`test/store.test.ts` replays the draws).
- `bodySfx(sfx, { settings, materialOf })`: `body.wind` and `body.gain`
  (options win); the surface a footstep plays is `surfaces[materialOf(body)]`,
  falling back to `surfaceOf(body)`; `events` lays more event → sound entries
  over the built-in table (or other sounds for the same events; `landed` keeps
  its speed). The tuning is the player's: give the settings to `createSfx`.

## Battle audio

An RTS's sounds (MYRIAD's), made in code from a seed like the rest: weapon
fire and impacts per damage class, explosions, deaths per body material,
construction loops per tech flavour, stings, alert "announcers" and unit
barks. Nothing is fetched and nothing is speech: the voices are
syllable-shaped formant blips, chirps, grunts, clicks, chitters and hums.
The synthesis is plain code on `Float32Array`s (`battleSample`, Node runs
it); `createBattleAudio` plays it.

```ts
import { createBattleAudio, distanceGain, panFor, voiceFor, buildOfFlavour } from "@keel-engine/audio";

// On the page: the same target createSfx takes. With createSound, once the listener has turned sound on:
//   const battle = createBattleAudio(pageTone()!, { seed: matchSeed, voice: { seed: race.seed, timbre: race.flavour, hue: race.palette.hue } });
// (Tone: its raw context, into Tone's destination -- KEEL's volume and mute cover it. An AudioContext works too:
//  createBattleAudio(sound.sfx.context, ...) when sound.on, or any AudioContext / OfflineAudioContext.)
const battle = createBattleAudio(Tone, { seed: matchSeed, style: "clean", maxVoices: 12, voice: { seed: race.seed, timbre: "machine" } });

battle.play(`fire.${unit.damage}`, { pan: panFor(sx, view.width), gain: distanceGain(cellsFromCamera) });
battle.play("hit.blast", { pan, gain });
battle.play("explode.big", { pan });                 // (a building)
battle.play(`death.${unit.material}`, { pan });       // metal | organic | crystal
battle.play("alert.underAttack");                    // in the player's race voice
battle.play("bark.select", { voice: voiceFor({ seed: race.seed, timbre: race.flavour, size: unit.size }) });
const site = battle.loop(buildOfFlavour(race.flavour), { pan }); // build.machine | build.organic | build.energy
site.set({ gain: 0.6 }); site.stop();                // (and battle.play("sting.complete") when it's done)
battle.stats;                                        // { played, dropped, limited, stolen, active, rendered }
```

### The sounds

| Name | Variants | What |
| --- | --- | --- |
| `fire.kinetic` | 4 | gunfire: one to three cracks in a rattle over a short body, the report behind |
| `fire.piercing` | 4 | a rail / needle: a zip falling from ~8 kHz, a ringing snap |
| `fire.blast` | 4 | a launcher: the tube's thump, a pop, the round whooshing away |
| `fire.energy` | 4 | a zap: a buzzing, wobbling fall over a fifth |
| `fire.siege` | 4 | a heavy boom, the roar closing down, a rumbling tail |
| `fire.acid` | 4 | a wet spit (organic attackers): a squirt through a resonant falling band, bubbles |
| `hit.kinetic` | 3 | a tick off armour, usually a ricochet whining away |
| `hit.piercing` | 3 | a hard thunk |
| `hit.blast` | 3 | a small explosion with debris |
| `hit.energy` | 3 | a crackling sizzle and a dying hum |
| `hit.siege` | 3 | a big crunch, rubble, a rumble |
| `hit.acid` | 3 | a hiss that eats, small pops |
| `explode.small`, `explode.big` | 3, 2 | a unit (~0.95 s); a building (~2.3 s: deep boom, secondary blasts, falling rubble, a long rumble) |
| `death.metal`, `death.organic`, `death.crystal` | 3 each | a crunch, a clang, the frame collapsing in clanks; a wet burst and splatter; a crack and shards pinging apart |
| loop `build.machine` | 1 | a motor's hum, welding crackle in two runs, hammer clanks (1.6 s) |
| loop `build.organic` | 1 | a squelchy growing churn, bubbles, a slow heartbeat (2 s) |
| loop `build.energy` | 1 | a hum of beating partials and a swelling high shimmer (2 s; crystal and energy techs) |
| `sting.complete`, `sting.ready` | 1 | a short motif / two notes up, on the voice's instrument, in its key (`root`, or `hue` read as `moodFor` reads it) |
| `alert.<kind>` | 1 | `underAttack` (a fast siren of five), `noResources` (three slow falling), `supplyBlocked` (three quick taps, a long low buzz), `buildingComplete` (a major arpeggio up), `researchComplete` (a long glide up an octave, a sparkle of three), `unitReady` (a call and an answer a fifth up), `idleWorker` (a rising question), `fieldDepleted` (a long fall, two low taps) |
| `bark.<kind>` | 4 (annoyed 3) | `select` (one or two rising), `move` (level then falling), `attack` (two or three short, rough), `death` (one long falling cry), `annoyed` (five or six fast, high, jumping, agitated) |

Weapons are ≤ 0.6 s, impacts ≤ 0.8 s, `explode.big` ≤ 2.5 s, barks
0.06-0.7 s (a big unit's are compressed to fit), alerts and stings ≤ 1.2 s;
every sound peaks under full scale (0.6-0.9 by kind). `style`: `"clean"`
(default, 16-bit), `"lofi"` (12-bit, the top at 9 kHz), `"chip"` (7-bit,
held), `"soft"` (the top at 5 kHz), or `{ bits, hold, top }`. The seed picks
the battle's palette (calibre, boom size, the metal's partials, how wet);
each (name, variant) has its own stream.

### Voices

`voiceFor({ seed, timbre, size = 1, root, hue })` → `BattleVoice` (plain
numbers; `id` is what samples are cached by). `seed` is the race's; `timbre`
one of `TIMBRES` or a MYRIAD flavour (`biotic` → organic, `crystalline` →
crystal; none: the seed picks); `size` the unit's (0.3-4: pitch × size^-0.6,
formants × size^-0.3, pace × size^0.2 -- a bigger unit is lower and slower).
The race's seed moves the pitch (±~17%), the throat, the pace, the roughness
and which vowels it favours. The six timbres are six ways of making a sound,
not one filtered six ways:

| Timbre | How | Base pitch |
| --- | --- | --- |
| `machine` | a pulse whose pitch moves in steps, a beep an octave up, formants, crushed to 5 bits; a relay click | 150 Hz |
| `organic` | a tongue click, a wavering glottal buzz that growls at half its pitch and breathes; chitters when agitated | 118 Hz |
| `crystal` | inharmonic partials following the contour, ringing past each syllable | 430 Hz |
| `resonant` | a soft tone, its chorus and fifth, through very sharp formants: a hummed vowel | 165 Hz |
| `thermal` | noise through formants over a low rumble, flickering, with crackle: a roaring breath | 92 Hz |
| `gravitic` | a deep FM tone that swells in, dips and wobbles, a sub under it | 85 Hz |

### The player

`createBattleAudio(target, { seed, style, maxVoices = 12, minGap = 0.04, voice, out, volume = 0.8, jitter = 0.03 })`:

- `play(name, { pan, gain, rate, variant, priority, when, voice })` →
  `BattleSound` (`name`, `variant`, `priority`, `start`, `end`, `stop(fade)`)
  or `null` (an unknown name, rate-limited, or dropped). Variants play in turn
  (a seeded skip now and then) unless one is asked for; `fire.*` and `hit.*`
  vary their rate ±`jitter`.
- `loop(name, params)` → `BattleLoop` (`playing`, `set({ gain, pan, rate }, ramp)`,
  `stop(fade)`), faded in from anywhere in it; a quiet handle when refused.
- **The pool**: at most `maxVoices` sounds (loops included) at once. When
  it's full, a new sound steals the lowest-priority voice below its own (the
  oldest of those), faded in 12 ms; with none lower it is dropped
  (`stats.dropped`). Priorities (`priorityOf`, or `priority`): alerts 5,
  stings 4, barks and `explode.big` 3, deaths, `explode.small` and loops 2,
  fire and hits 1.
- **Rate limit**: the same name at most every `minGap` (40 ms) by its start
  time (`stats.limited`), checked before the pool.
- **Cache**: each (name, variant, voice) is rendered once, on first play, at
  the context's rate (`stats.rendered`); `prerender(names?, voices?)` warms it
  during loading (default: every unvoiced sound, 59 samples, ~230 ms at
  44.1 kHz on the dev Mac; a voice's 29 voiced samples ~100 ms).
  `prerenderStep(ms, names?, voices?)` does it a little at a time -- a game's
  spare frame time: at least one sample, then as many as fit in `ms`; returns
  how many are still to go. `adopt(name, variant, samples, voice?, rate?)`
  takes a sample made elsewhere (`battleSample()` on a loading screen, before
  there's a context) as the player's own: the long ones (a building's
  explosion ~21 ms, a construction loop 10-40 ms) never render mid-frame.
- `stats` → `{ played, dropped, limited, stolen, active, rendered }`;
  `stop(fade)`, `dispose()`, `volume`.
- `panFor(screenX, screenWidth, spread = 0.85)` → -1..1;
  `distanceGain(d, { near = 8, far = 48, rolloff = 1 })` → 1 within `near`,
  `near / (near + rolloff (d - near))` faded to 0 at `far` (the game's units).

It plays into `out`, or Tone's destination (via `Tone.connect`, as
`createSfx` does), or the context's: on a KEEL page, KEEL's volume and mute
cover it. Get the target from the page's Tone (`pageTone()`), or from
`sound.sfx.context` once `sound.on` (make it in the listener's click, as
`createSound` makes `sfx`).

### Measured (test/battle.test.ts prints these)

Distances are `featureDistance` (Euclidean over 13 features: duration,
spectral centroid, zero crossings, flatness, attack, envelope weight,
sustain, onsets, centroid slope, voiced share, pitch slope, pitch spread,
median pitch). For scale, one class's own variants sit a median 0.34 apart
(up to 4.6 for gunfire's one-to-three-shot rattles).

| What | Closest pair | Distance (floor in the test) |
| --- | --- | --- |
| fire, 6 classes | piercing ~ acid | 1.50 (0.6) |
| impacts, 6 classes | piercing ~ blast | 2.88 (0.6) |
| deaths, 3 materials | organic ~ crystal | 4.07 (0.6) |
| `explode.small` ~ `explode.big` | | 5.15 (0.6) |
| alerts, 8 kinds, per timbre (2 races × 6 timbres) | gravitic noResources ~ fieldDepleted | 0.45 (0.35); per timbre the closest is 0.45-1.36 |
| barks, 6 timbres, per bark kind (2 races × 5 kinds) | machine ~ organic (move) | 1.19 (0.8) |
| two races, one timbre (bark.select / bark.attack / alert.underAttack) | thermal alert.underAttack | 0.23 (0.05; every pair's bits differ) |

A bigger unit's bark is lower in every timbre (size 0.6 → 2: its spectral
centroid falls). Construction loops wrap with a step of 0.020 / 0.046 / 0.031
against their own 99th-percentile steps of 0.151 / 0.086 / 0.067, head and
tail within 3.2 dB. A storm of 400 random plays 20 ms apart through a pool of
6: 144 played, 236 dropped, 20 limited, 73 stolen, never more than 6 at once.

## Music as bytes

Through the codec, two ways (`src/store.ts`):

```ts
const bytes = storeMusic(musicRecipe({ band: "Nightcap", hue: 212 }, "seed-7", { keys: "vibes" }));
const game = storeMusic({ from: "game", seed: 7, spec: { energy: 0.8, darkness: 0.7 } });  // moodFor's few words
const song = storeMusic(editedPlan);   // a plan itself
play(Tone, loadMusic(bytes));          // the header says which: a recipe goes through scoreOf, a song is its plan
```

- A **recipe** (`MUSIC_RECIPE`, `keel/audio/recipe`): a seed, a mood (the band
  as a preset's name plus one of NOCTURNES' `KIT_BAND` corners when that's
  what it is) or a game's `moodFor` spec, and pins. `loadMusic` gives exactly
  the plan `scoreOf` makes. Band moods average 21 bytes (their plans' JSON:
  3.9 KB); a game recipe ~23 bytes.
- A **song** (`SONG`, `keel/audio/song`): the plan itself, for plans written or
  edited by hand. It loads JSON-equal, so it plays the same. ~230 bytes.

Anything else (another document, no header, cut short) is a `TypeError`
saying what it is.

## KEEL audio

On a KEEL page, `globalThis.KEEL_AUDIO` (keel-audio 1.0.0, in `vendor/`) owns
the one AudioContext, the gesture-only start, the listener's volume and mute
(remembered per piece), visibility pauses and the sound button. `createSound`
uses it when it's there — `configure({ id })`, `onStart`/`onStop`,
`mountButton(host, { corner })`, `start()`, `stop()`, `volume` (typed
`KeelAudioLike`) — and makes its own button on Tone otherwise (the studio,
local tools). The music plays into Tone's destination and the sound effects
into it too (`Tone.connect`), so KEEL's volume and mute cover both.
`sound.sfx` is a silent stand-in (`QuietSfx`) until the listener turns sound
on. Load order on a page: Tone, then keel-audio, then the project.

No AudioWorklet is used (some viewers refuse their blob URLs) and nothing is
fetched: samples, sfx and reverb impulses are all computed on the page.

## Vendor

Copied unchanged from the proof of concept's `vendor/` into the repo's
`vendor/`:

| File | Bytes | gzip -9 | SHA-256 |
| --- | --- | --- | --- |
| `vendor/tone-15.1.22-native.js` (Tone 15.1.22, the native-context build) | 234,102 | 50,857 | `20c2cc23e71dc366eb56eb4e4ce7419ab498e688c79e7af4494c3e307ef39861` |
| `vendor/keel-audio-1.0.0.min.js` | 8,405 | 3,558 | `75cbdc41afc1636c4c5fd1c8a0508e2dbef2ed0d0af4c66c14149bdc8983efd3` |

## Budget

| What | Bytes | gzip -9 |
| --- | --- | --- |
| `src/*.ts` (all of it, with types and comments) | ~140,700 | ~44,300 |
| battle audio, besides (`battle.ts`, `voice.ts`, `battle-audio.ts`, `synth.ts`, `features.ts`) | ~77,400 | ~23,400 |
| the module, bundled and minified (esbuild, ESM, with the runtime's `defineManifest`) | ~56,000 | ~22,600 |

Tone is the one big dependency; a KEEL piece gets it (and keel-audio) from its
`extends`, so a project's own code carries only this module. At the start of
play the samples cost ~50-150 ms to synthesise (keys, lead, bass at 7 roots
each, 7 drums; sfx ~50 ms), and the reverb's impulse is rendered once.

## Tests

`node --test packages/audio/test/*.test.ts` (the NOCTURNES and proof-of-concept
repos are read from `../keel-nocturnes` and `../keel-pixel-engine`, or
`NOCTURNES=` / `POC=`; neither is written to).

- `test/equality.test.ts` — the port against its references.
  NOCTURNES: plans for tokens 1..300, 120 rooms without a theme, 60 with no
  hue / an eclipse, 120 with random studio pins (all JSON-identical);
  `themeForItems` on 2000 item sets; every sample array of 10 plans
  bit-identical. The proof of concept's JS: `moodFor`, 400 plans over moods
  and pins, `moodOfNocturnes`, streams and hashes; sample arrays of 16 plans
  bit-identical (every keys, lead and bass instrument); 14 sfx palettes and
  every sound's synthesis bit-identical; `paramsFor`, `intensityMix`,
  voicings, WAV bytes and loop measures equal; and, through a recording
  stand-in for Tone and Web Audio, `play` (13 moods, a loop and more with
  intensity, react and stop), `createSfx` + `bodySfx` (Tone and raw context)
  and `createSound` (the KEEL_AUDIO path) make the same calls, in the same
  order, with the same arguments.
- `test/audio.test.ts` — the manifest, determinism, whole plans (finite,
  32-40 bars, lo-fi tempi), diversity (printed), moods move the band the way
  they say, pins, intensity numbers, instruments that sound and never clip,
  WAV and seam measures.
- `test/sfx.test.ts` — the palette, every sound finite and heard, loops
  seamless, params in range for any input, a real physics body's events
  mapped (the proof of concept's character controller, until
  `@keel-engine/physics` has one).
- `test/battle.test.ts` — battle audio: names, variants and voices;
  determinism (every sound bit-identical for a seed and voice, other seeds
  other sounds); 514 sounds (every variant in two styles, every bark in six
  timbres at three sizes, every alert and sting) finite, heard, under full
  scale and within their kind's length; the construction loops seamless;
  distinctness (printed): damage classes, deaths, explosions, alerts per
  timbre, timbres per bark, two races per timbre, size; `panFor`,
  `distanceGain`; the player through the recording stand-in (the cap, drops,
  priority steals, the rate limit, the cache, loops, a 400-play storm, Tone's
  destination, prerender).
- `test/store.test.ts` — recipes (every band with pins and absent fields,
  KIT_BAND corners, game specs, `moodFor` moods) load JSON-equal to
  `scoreOf`; songs (generated and edited by hand) load JSON-equal; sizes;
  non-music refused; sfx settings through bytes; tuned params; `bodySfx`
  mapping materials and events; `createSfx` on a stand-in context, untuned
  draw for draw as before and tuned as the settings say.
