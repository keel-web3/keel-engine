// Sound as data, three ways:
//
//   MUSIC_RECIPE  the smallest: a seed and a mood (or a game's few words, for
//                 moodFor) and pins. scoreOf regenerates the plan from it
//                 exactly -- the band as a preset's name plus a corner's
//                 overrides, not the whole table. What a pack or a token stores.
//   SONG          a plan itself, for plans written or edited by hand: bars as
//                 sections of chords (each a scale degree, a secondary
//                 dominant, a borrowed iv, or spelled out), the tune's rhythm
//                 delta-coded, drum voices as 16-step bitmasks, instruments as
//                 enums, the mix and the instruments' make in fixed point (a
//                 value off the grid kept whole). planOfSong(songOf(plan)) is
//                 the plan, JSON-equal: the player plays it the same.
//   SFX_SETTINGS  a project's sound palette: its seed and style (a preset or
//                 fields over one), the volume, what a body's events and
//                 surfaces play, and each sound's gain, pitch and pan.
//
// No import of @keel-engine/audio (it can import this): the lists are copied
// here and test/audio-schemas.test.ts checks them against audio's own; the
// recipe's band presets come in as a table (moodOfRecipe(r, { bands, kits })).

import { alt, array, bool, enumOf, fixed, float64, map, named, nullable, num, optional, ref, string, struct, tuple, uint, union, withDefault, delta, int } from "../schema.ts";
import type { Infer } from "../schema.ts";
import { seedAny } from "./common.ts";

// ---------------------------------------------------------------- vocabulary (audio's, copied: see the test)

export const MODE_NAMES = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "harmonic"] as const;
export const MODE_STEPS: Readonly<Record<(typeof MODE_NAMES)[number], readonly number[]>> = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
};
export const KEYS_NAMES = ["rhodes", "wurli", "piano", "felt", "vibes", "organ", "guitar"] as const;
export const LEAD_NAMES = ["rhodes", "piano", "celesta", "kalimba", "musicbox", "vibes", "guitar", "chip"] as const;
export const BASS_NAMES = ["sub", "upright", "electric", "synth"] as const;
export const KIT_NAMES = ["dusty", "boombap", "brushed", "soft", "rim", "chip"] as const;
export const WEATHER_KINDS = ["rain", "waves", "traffic", "wind", "hush", "crickets", "car", "chimes", "shimmer"] as const;
export const ROOM_KINDS = ["vinyl", "crackle", "fan", "hum"] as const;
export const SECTIONS = ["A", "B", "A2", "C", "T"] as const;
export const COMPS = ["strum", "arp", "stabs", "sustain", "push"] as const;
export const BASS_STYLES = ["root", "rootfifth", "walk", "sync"] as const;
export const SPREADS = ["close", "open", "drop2"] as const;
export const BACKBEATS = ["snare", "rim", "clap", "both"] as const;
export const SFX_NAMES = ["step", "jump", "land", "wallStart", "wallJump", "railStart", "railEnd", "splash", "skimStart", "respawn", "blip", "select", "back", "confirm", "error", "hover"] as const;
export const LOOP_NAMES = ["grind", "wallrun", "skim", "wind"] as const;
export const STYLE_NAMES = ["lofi", "clean", "chip", "soft"] as const;
export const SURFACES = ["stone", "metal", "water"] as const;

/** A share or a small number: authored decimals in few bits, anything else kept whole (1 flag bit). */
const ex = (min: number, max: number, step: number) => fixed(min, max, step, { off: "exact" });
const share = ex(0, 1, 0.001);
const name = ref("audio");

// ---------------------------------------------------------------- the recipe

const Weighted = array(tuple([name, ex(0, 1000, 0.001)]), { max: 31 });
/** A band's fields (all optional: laid over a preset, or over "Loose"). */
export const BAND_INPUT = struct({
  keys: optional(Weighted), lead: optional(Weighted), bass: optional(Weighted), feel: optional(Weighted),
  tempo: optional(tuple([ex(0, 400, 0.001), ex(0, 400, 0.001)])), swing: optional(tuple([share, share])),
  room: optional(share), jazz: optional(share), vox: optional(share), scratch: optional(share), bright: optional(share), worn: optional(share),
  mode: optional(enumOf(MODE_NAMES, { capacity: 8, other: true })), lean: optional(enumOf(["major"], { capacity: 2, other: true })),
});
/** Choices fixed by hand (audio's Pins). */
export const MUSIC_PINS = struct({
  band: optional(name), keys: optional(name), lead: optional(name), bass: optional(name), kit: optional(name), mode: optional(name),
  key: optional(alt([name, num()])), tempo: optional(alt([name, num()])),
});
/** A band by reference: a preset's name, a corner's overrides (NOCTURNES' KIT_BAND), then any fields of its own. */
const BandRef = struct({ preset: optional(name), kit: optional(name), over: optional(BAND_INPUT) });
export const MOOD = struct({
  seed: optional(seedAny), name: optional(name), band: optional(alt([name, BandRef])),
  hue: optional(ex(0, 360, 0.01)), mode: optional(name), eclipse: optional(bool()), picture: optional(ex(0, 3600, 0.001)),
  view: optional(name),
  weather: optional(array(enumOf(WEATHER_KINDS, { capacity: 16, other: true }), { max: 15 })),
  room: optional(array(enumOf(ROOM_KINDS, { capacity: 8, other: true }), { max: 15 })),
  dark: optional(share), space: optional(share), energy: optional(share), pins: optional(MUSIC_PINS),
}, { open: true });
/** moodFor's few words about a game. */
export const MOOD_SPEC = struct({
  energy: optional(share), darkness: optional(share), weather: optional(alt([name, array(name)])),
  tempo: optional(alt([num(), tuple([num(), num()])])), hue: optional(ex(0, 360, 0.01)), name: optional(name),
  room: optional(array(name)), space: optional(share), pins: optional(MUSIC_PINS),
}, { open: true });

/** A plan's recipe: scoreOf(mood, seed, { pins }) -- or scoreOf(moodFor(spec), seed, { pins }). */
export const MUSIC_RECIPE = named("keel/audio/recipe", union("from", {
  mood: struct({ seed: optional(seedAny), mood: MOOD, pins: optional(MUSIC_PINS) }),
  game: struct({ seed: optional(seedAny), spec: MOOD_SPEC, pins: optional(MUSIC_PINS) }),
}, { capacity: 8 }), { doc: "Music as its recipe: a seed and a mood; the plan comes back from scoreOf exactly." });
export type MusicRecipe = Infer<typeof MUSIC_RECIPE>;

type Rec = Record<string, unknown>;
/** The band presets a recipe names (audio's BANDS; NOCTURNES' KIT_BAND corners). */
export interface BandTables { readonly bands: Readonly<Record<string, object>>; readonly kits?: Readonly<Record<string, object>> }

const clean = <T extends Rec>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const json = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Rec).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** A mood (audio's Mood) as the recipe's: a band object becomes a preset + corner when one makes it. */
export function recipeOfMood(mood: Rec, seed: string | number | undefined, tables: BandTables, pins?: Rec): MusicRecipe {
  let band: unknown = mood["band"];
  if (band && typeof band === "object") {
    const want = json(band);
    const tries: [string | undefined, string | undefined][] = [];
    const presets = [mood["name"] as string | undefined, ...Object.keys(tables.bands)];
    const kits = [undefined, ...Object.keys(tables.kits ?? {})];
    for (const p of [undefined, ...presets]) for (const k of kits) tries.push([p, k]);
    const hit = tries.find(([p, k]) => json({ ...(p ? tables.bands[p] : {}), ...(k ? tables.kits?.[k] : {}) }) === want);
    band = hit ? clean({ preset: hit[0], kit: hit[1] }) : { over: band };
  }
  return clean({ from: "mood" as const, seed, mood: clean({ ...mood, band }) as MusicRecipe extends infer R ? R extends { from: "mood"; mood: infer M } ? M : never : never, pins }) as MusicRecipe;
}
/** The mood (and seed and pins) a recipe stands for: scoreOf(mood, seed, { pins }) -- for "game", mood is the spec (give it to moodFor). */
export function moodOfRecipe(r: MusicRecipe, tables: BandTables): { readonly from: "mood" | "game"; readonly mood: Rec; readonly seed: string | number | undefined; readonly pins: Rec | undefined } {
  if (r.from === "game") return { from: "game", mood: { ...r.spec }, seed: r.seed, pins: r.pins as Rec | undefined };
  const m = { ...r.mood } as Rec;
  const b = m["band"];
  if (b && typeof b === "object") {
    const ref = b as { preset?: string; kit?: string; over?: object };
    m["band"] = { ...(ref.preset ? tables.bands[ref.preset] : {}), ...(ref.kit ? tables.kits?.[ref.kit] : {}), ...(ref.over ?? {}) };
  }
  return { from: "mood", mood: m, seed: r.seed, pins: r.pins as Rec | undefined };
}

// ---------------------------------------------------------------- the song

/** Drum steps: a 16-bit mask when they're in order (the usual), else the list. */
const Steps = alt([uint(16), array(uint(4), { max: 31 })]);
/** A chord: a scale degree (diatonic in the song's mode), a secondary dominant on a root, the borrowed iv, or spelled out. */
const Chord = union("q", {
  deg: struct({ d: uint(3) }),
  dom: struct({ root: uint(4) }),
  iv: struct({}),
  raw: struct({ root: int(8), tones: array(int(8), { max: 15 }), deg: int(8) }),
}, { capacity: 4 });
const SectionName = enumOf(SECTIONS, { capacity: 8, other: true });

export const SONG = named("keel/audio/song", struct({
  seed: string(), theme: name, view: name, eclipse: bool(),
  mode: enumOf(MODE_NAMES, { capacity: 8, other: true }), family: enumOf(["major", "minor"]), tonic: uint(4),
  bpm: ex(0, 400, 0.001),
  /** Absent: 240 / bpm (a plan written by hand); a generated plan's own (its bpm is rounded, its bar isn't). */
  barSec: optional(float64()),
  swing: share, jazz: share,
  keys: enumOf(KEYS_NAMES, { capacity: 16, other: true }), lead: enumOf(LEAD_NAMES, { capacity: 16, other: true }),
  bass: enumOf(BASS_NAMES, { capacity: 8, other: true }), kit: enumOf(KIT_NAMES, { capacity: 8, other: true }),
  vox: share, scratch: share,
  form: array(tuple([SectionName, uint(6)]), { max: 15 }),
  picture: nullable(ex(0, 3600, 0.001)),
  comp: enumOf(COMPS, { capacity: 8, other: true }), bassStyle: enumOf(BASS_STYLES, { capacity: 8, other: true }),
  groove: struct({ kick: Steps, back: Steps, hat: Steps, ghost: Steps, open: Steps, shaker: Steps }),
  design: struct({
    seed: uint(32), bright: share, bell: ex(0, 20, 0.001), kickHz: ex(0, 200, 0.01), kickDecay: share, punch: share,
    snareBody: ex(0, 1000, 0.01), snareTone: ex(0, 10000, 0.1), snareDecay: share, hatTone: ex(0, 4, 0.001),
    bits: uint(5), hold: uint(3), top: ex(0, 30000, 1), pump: share, strum: share,
    spread: enumOf(SPREADS, { capacity: 4, other: true }), back: enumOf(BACKBEATS, { capacity: 4, other: true }),
  }),
  /** Bars as each section's chords (the form lays them out), or listed one by one when sections differ. */
  bars: union("as", {
    sections: struct({ chords: map(SectionName as never, array(Chord, { max: 63 }), { order: "kept" }) }),
    list: struct({ bars: array(struct({ sec: SectionName, k: uint(6), of: uint(6), chord: Chord })) }),
  }),
  motif: struct({ rhythm: delta(uint(6)), moves: array(int(5)), lengths: optional(array(uint(6))) }),
  weather: array(enumOf(WEATHER_KINDS, { capacity: 16, other: true }), { max: 15 }),
  room: array(enumOf(ROOM_KINDS, { capacity: 8, other: true }), { max: 15 }),
  mix: struct({ cutoff: ex(0, 30000, 1), tape: share, reverb: share, wow: share, level: ex(-60, 12, 0.5) }),
  energy: optional(share),
}, { open: true }), { doc: "A music plan, packed: sections of chords, the tune delta-coded, drums as step masks." });
export type Song = Infer<typeof SONG>;

type ChordV = { readonly root: number; readonly tones: readonly number[]; readonly deg: number };
type Mode = (typeof MODE_NAMES)[number];
/** audio's diatonic(): a chord as semitones over the tonic. */
export function diatonic(mode: Mode, d: number): ChordV {
  const sc = MODE_STEPS[mode];
  const at = (k: number): number => sc[(d + k) % 7]! + 12 * Math.floor((d + k) / 7);
  return { root: at(0) % 12, tones: [at(2), at(4), at(6), at(8)], deg: d };
}
const dominant = (r: number): ChordV => ({ root: r, tones: [r + 4, r + 7, r + 10, r + 14], deg: -1 });
const borrowed = (mode: Mode): ChordV => { const r = MODE_STEPS[mode][3]!; return { root: r, tones: [r + 3, r + 7, r + 10, r + 14], deg: -2 }; };
const sameChord = (a: ChordV, b: ChordV): boolean => a.root === b.root && a.deg === b.deg && a.tones.length === b.tones.length && a.tones.every((t, i) => t === b.tones[i]);

function chordOf(c: ChordV, mode: string): Infer<typeof Chord> {
  const m = (MODE_STEPS as Record<string, readonly number[]>)[mode] ? (mode as Mode) : null;
  if (m && c.deg >= 0 && c.deg <= 6 && sameChord(c, diatonic(m, c.deg))) return { q: "deg", d: c.deg };
  if (c.deg === -1 && c.root >= 0 && c.root < 12 && sameChord(c, dominant(c.root))) return { q: "dom", root: c.root };
  if (m && sameChord(c, borrowed(m))) return { q: "iv" };
  return { q: "raw", root: c.root, tones: [...c.tones], deg: c.deg };
}
function chordFrom(c: Infer<typeof Chord>, mode: string): ChordV {
  if (c.q === "deg") return diatonic(mode as Mode, c.d);
  if (c.q === "dom") return dominant(c.root);
  if (c.q === "iv") return borrowed(mode as Mode);
  return { root: c.root, tones: [...c.tones], deg: c.deg };
}
const toMask = (steps: readonly number[]): number | number[] => {
  const sorted = steps.every((s, i) => Number.isInteger(s) && s >= 0 && s < 16 && (i === 0 || s > steps[i - 1]!));
  return sorted ? steps.reduce((m, s) => m | (1 << s), 0) : [...steps];
};
const fromMask = (v: number | readonly number[]): number[] => (typeof v === "number" ? Array.from({ length: 16 }, (_, s) => s).filter((s) => v & (1 << s)) : [...v]);
const lengthsOf = (rhythm: readonly number[]): number[] => rhythm.map((s, i) => Math.max(2, (rhythm[i + 1] ?? 32) - s));

/** A plan (audio's Plan, structurally) as a song. */
export function songOf(plan: Rec): Song {
  const p = plan as Rec & { form: [string, number][]; bars: { sec: string; k: number; of: number; chord: ChordV }[]; groove: Record<string, number[]>; motif: { rhythm: number[]; moves: number[]; lengths: number[] }; mode: string; bpm: number; barSec: number };
  // Bars: each section's chords, when every appearance of a section is the same chords.
  const chords: Record<string, ChordV[]> = {};
  let at = 0;
  let sectioned = true;
  for (const [sec, n] of p.form) {
    const seg = p.bars.slice(at, at + n);
    at += n;
    if (seg.length !== n || seg.some((b, k) => b.sec !== sec || b.k !== k || b.of !== n)) { sectioned = false; break; }
    const have = chords[sec];
    const list = seg.map((b) => b.chord);
    if (!have) chords[sec] = list;
    else {
      const common = Math.min(have.length, list.length);
      if (!list.slice(0, common).every((c, i) => sameChord(c, have[i]!))) { sectioned = false; break; }
      if (list.length > have.length) chords[sec] = list;
    }
  }
  if (at !== p.bars.length) sectioned = false;
  const bars: Song["bars"] = sectioned
    ? { as: "sections", chords: Object.fromEntries(Object.entries(chords).map(([k, v]) => [k, v.map((c) => chordOf(c, p.mode))])) }
    : { as: "list", bars: p.bars.map((b) => ({ sec: b.sec, k: b.k, of: b.of, chord: chordOf(b.chord, p.mode) })) };
  const lengths = p.motif.lengths;
  const derived = lengthsOf(p.motif.rhythm);
  return clean({
    seed: p["seed"], theme: p["theme"], view: p["view"], eclipse: p["eclipse"], mode: p.mode, family: p["family"], tonic: p["tonic"],
    bpm: p.bpm, barSec: p.barSec === 240 / p.bpm ? undefined : p.barSec, swing: p["swing"], jazz: p["jazz"],
    keys: p["keys"], lead: p["lead"], bass: p["bass"], kit: p["kit"], vox: p["vox"], scratch: p["scratch"],
    form: p.form.map(([s, n]) => [s, n] as const), picture: p["picture"], comp: p["comp"], bassStyle: p["bassStyle"],
    groove: Object.fromEntries(["kick", "back", "hat", "ghost", "open", "shaker"].map((v) => [v, toMask(p.groove[v] ?? [])])),
    design: { ...(p["design"] as Rec) },
    bars,
    motif: { rhythm: [...p.motif.rhythm], moves: [...p.motif.moves], ...(lengths.length === derived.length && lengths.every((l, i) => l === derived[i]) ? {} : { lengths: [...lengths] }) },
    weather: [...(p["weather"] as string[])], room: [...(p["room"] as string[])], mix: { ...(p["mix"] as Rec) },
    energy: p["energy"],
  } as unknown as Rec) as unknown as Song;
}

/** A song back to its plan: every field audio's Plan has, in its order (so its JSON is the plan's). */
export function planOfSong(s: Song): Rec {
  const barSec = s.barSec ?? 240 / s.bpm;
  const loopBars = s.form.reduce((a, [, n]) => a + n, 0);
  let bars: Rec[];
  if (s.bars.as === "sections") {
    const chords = s.bars.chords as Readonly<Record<string, readonly Infer<typeof Chord>[]>>;
    bars = s.form.flatMap(([sec, n]) => (chords[sec] ?? []).slice(0, n).map((c, k) => ({ sec, k, of: n, chord: chordFrom(c, s.mode) })));
  } else bars = s.bars.bars.map((b) => ({ sec: b.sec, k: b.k, of: b.of, chord: chordFrom(b.chord, s.mode) }));
  const g = s.groove;
  return {
    seed: s.seed, theme: s.theme, view: s.view, eclipse: s.eclipse, mode: s.mode, family: s.family, tonic: s.tonic,
    bpm: s.bpm, barSec, swing: s.swing, jazz: s.jazz,
    keys: s.keys, lead: s.lead, bass: s.bass, kit: s.kit, vox: s.vox, scratch: s.scratch,
    form: s.form.map(([a, b]) => [a, b]), loopBars, loopSec: loopBars * barSec, picture: s.picture,
    comp: s.comp, bassStyle: s.bassStyle,
    groove: { kick: fromMask(g.kick), back: fromMask(g.back), hat: fromMask(g.hat), ghost: fromMask(g.ghost), open: fromMask(g.open), shaker: fromMask(g.shaker) },
    design: { ...s.design }, bars,
    motif: { rhythm: [...s.motif.rhythm], moves: [...s.motif.moves], lengths: s.motif.lengths ? [...s.motif.lengths] : lengthsOf(s.motif.rhythm) },
    weather: [...s.weather], room: [...s.room], mix: { ...s.mix },
    ...(s.energy !== undefined ? { energy: s.energy } : {}),
  };
}

// ---------------------------------------------------------------- sfx settings

const SoundName = enumOf([...SFX_NAMES, ...LOOP_NAMES], { capacity: 32, other: true });
/** sfxStyle's input: a preset's name, or any palette fields over one. */
export const SFX_STYLE = alt([
  enumOf(STYLE_NAMES, { capacity: 8, other: true }),
  struct({
    name: optional(name), pitch: optional(ex(0, 4, 0.001)), bright: optional(share), weight: optional(share),
    bits: optional(uint(5)), hold: optional(uint(3)), top: optional(ex(0, 30000, 1)), shoe: optional(enumOf(["sneaker", "boot", "soft"], { capacity: 4, other: true })),
    metal: optional(array(ex(0, 32, 0.001), { max: 15 })), metalHz: optional(ex(0, 5000, 0.01)), water: optional(ex(0, 4, 0.001)), wind: optional(ex(0, 4, 0.001)),
    tonic: optional(uint(4)), wave: optional(enumOf(["sine", "triangle", "square"], { capacity: 4, other: true })), room: optional(share), seed: optional(uint(32)),
  }),
]);
/** A project's sound effects: createSfx's options, bodySfx's mapping, and per-sound tuning. */
export const SFX_SETTINGS = named("keel/audio/sfx", struct({
  seed: seedAny,
  style: withDefault(SFX_STYLE, "lofi"),
  volume: withDefault(share, 0.8),
  /** bodySfx: the wind loop, a gain, which surface each material sounds like, which sound each body event plays. */
  body: optional(struct({
    wind: withDefault(bool(), true),
    gain: withDefault(ex(0, 4, 0.01), 1),
    surfaces: withDefault(map(ref("mats"), enumOf(SURFACES, { capacity: 4, other: true })), {}),
    events: withDefault(map(ref("events"), SoundName), {}),
  })),
  /** Each sound's own tuning: gain, pitch (rate), pan, how much it varies from play to play. */
  sounds: withDefault(map(SoundName as never, struct({
    gain: optional(ex(0, 2, 0.01)), rate: optional(ex(0.25, 4, 0.01)), pan: optional(ex(-1, 1, 0.01)), jitter: optional(share),
  })), {}),
}, { open: true }), { doc: "A project's sound palette and how its sounds are played." });
export type SfxSettings = Infer<typeof SFX_SETTINGS>;
