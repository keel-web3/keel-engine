// The engine's audio: generative lo-fi (score -> plan, player -> Tone), the
// instruments it plays (samples), sound effects (sfx), the page's speaker and
// KEEL audio glue (sound), NOCTURNES' room as a mood (nocturnes), loops as WAV,
// and music and sfx settings as codec bytes (store, sfx).
// Tone is the page's global (a KEEL piece `extends` it), never bundled.
export { BANDS, CHOICES, MINORISH, MODES, ROOM_KINDS, WEATHER_KINDS, bandNamed, diatonic, hash, moodFor, scoreOf, streamOf } from "./score.ts";
export type {
  Band as BandDef, BandInput, BandName, BassName, BassStyle, BackBeat, Bar, Chord, CompStyle, Design, Form, GameMood, Groove, KeysName, KitName, LeadName,
  Mix, ModeName, Mood, MoodSpec, Motif, Pins, Plan, RoomKind, ScoreOptions, SectionName, Spread, Stream, WeatherKind, Weighted,
} from "./score.ts";
export { intensityMix, midiHz, play, render, voice } from "./player.ts";
export type { Band, IntensityMix, PlayOptions, RenderOptions } from "./player.ts";
export { makeSampleData, makeSamples, toAudioBuffer } from "./samples.ts";
export type { DrumName, PartialSpec, SampleData, SamplePlan, Samples, Voice, Wear } from "./samples.ts";
export { LOOP_NAMES, SFX_NAMES, STYLE_NAMES, SURFACES, bodySfx, createSfx, jitterOf, paramsFor, sfxSamples, sfxSettingsBytes, sfxSettingsOf, sfxStyle, tuningOf } from "./sfx.ts";
export type {
  BodySfx, BodySfxOptions, LoopName, Sfx, SfxBody, SfxLoop, SfxName, SfxOptions, SfxParams, SfxPlay, SfxPlayer, SfxSampleKey, SfxSamples, SfxSettings, SfxStyle, SfxStyleInput,
  SfxTuning, StyleName, Surface, Wave,
} from "./sfx.ts";
export { loadMusic, musicRecipe, planOfRecipe, storeMusic } from "./store.ts";
export type { MusicRecipe, MusicSource } from "./store.ts";
export { createSound } from "./sound.ts";
export type { Corner, QuietSfx, Sound, SoundOptions, SoundPosition } from "./sound.ts";
export { moodOfNocturnes, themeForItems, DARK, KIT_BAND, SCHEME_MODE, WEATHER } from "./nocturnes.ts";
export type { Item, NocturnesGenome, NocturnesMusicPins, NocturnesPlacement } from "./nocturnes.ts";
export { encodeWav, measureLoop } from "./wav.ts";
export type { LoopMeasure } from "./wav.ts";
export { pageKeelAudio, pageTone } from "./tone.ts";
export type { KeelAudioLike, ToneClass, ToneInput, ToneInstrument, ToneLike, ToneNode, ToneParam, ToneRendered, ToneTransport } from "./tone.ts";
// Battle audio (an RTS's): weapon fire, impacts, explosions, deaths, construction loops, stings, alert voices and
// unit barks, all seeded; the pure samples (battle, voice, synth, features) and the pooled player (battle-audio).
export {
  BATTLE_LOOPS, BATTLE_SOUNDS, BUILD_FLAVOURS, DAMAGE_CLASSES, DEATH_MATERIALS, EXPLOSION_SIZES, asVoice, battleSample, buildOfFlavour, isBattleLoop, isBattleName,
  isVoiced, variantsOf,
} from "./battle.ts";
export type {
  AlertName, BarkName, BattleLoopName, BattleName, BattleSampleOptions, BattleSoundName, BuildFlavour, DamageClass, DeathMaterial, DeathName, ExplodeName,
  ExplosionSize, FireName, HitName, StingName,
} from "./battle.ts";
export { ALERT_KINDS, BARK_KINDS, STING_KINDS, TIMBRES, alertSample, barkSample, stingSample, timbreOf, voiceFor } from "./voice.ts";
export type { AlertKind, BarkKind, BattleVoice, StingKind, Timbre, VoiceSpec } from "./voice.ts";
export { createBattleAudio, distanceGain, panFor, priorityOf } from "./battle-audio.ts";
export type { BattleAudio, BattleAudioOptions, BattleLoop, BattleLoopParams, BattlePlayParams, BattleSound, BattleStats } from "./battle-audio.ts";
export { BATTLE_STYLES, wearOf } from "./synth.ts";
export type { BattleStyleName, BattleWear } from "./synth.ts";
export { featureDistance, featureVector, soundFeatures } from "./features.ts";
export type { SoundFeatures } from "./features.ts";
