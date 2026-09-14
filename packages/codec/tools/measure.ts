// The size table: real engine data as JSON, JSON + gzip, the codec's
// documents, and the codec + gzip -- and the codec's speed. Run:
//
//   node packages/codec/tools/measure.ts            (a markdown table on stdout)
//
// Test fixtures of other packages (WALLRUN's course, the world's garden, the
// army's cast in bake's test/cast.ts) are imported by path: they are
// fixtures, not those packages' API. NOCTURNES' genomes come from ../keel-nocturnes (NOCTURNES=path), read
// only, as audio's own tests do.

import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPiece, PIECE_KEYS } from "@keel-engine/object";
import { BANDS, KIT_BAND, moodFor, moodOfNocturnes, scoreOf } from "@keel-engine/audio";
import type { NocturnesGenome, Plan } from "@keel-engine/audio";
import { PRESETS, createParticlePool } from "@keel-engine/particles";
import {
  BLOCKS, BYTECODE, HYBRID_POPULATION, MUSIC_RECIPE, OBJECT, PLACED, POPULATION, PARTICLE_POOL, PARTICLES, SFX_SETTINGS, SONG, WORLD_SNAPSHOT, VOXELS,
  array, compileScript, decode, decodeRaw, encode, encodeRaw, mm, objectRecordOf, placedRecordOf, populationRecordOf, recipeOfMood, songOf, voxelRecordOf,
  opListSchema,
} from "../src/index.ts";
import type { Type, Infer, ObjectDefLike, InstanceLike, OpTable, VoxelModelLike } from "../src/index.ts";
import { levelOf } from "../../object/test/wallrun-level.ts";
import { makeWorld } from "../../world/test/fixtures.ts";
import { armyPopulation } from "../../bake/test/cast.ts";
import { recordOf } from "../../bake/src/index.ts";
import { GUARD_SCRIPT, WALLRUN_SFX } from "./samples.ts";

const gz = (b: Uint8Array | string): number => gzipSync(typeof b === "string" ? Buffer.from(b) : b, { level: 9 }).length;
const kb = (n: number): string => (n >= 10240 ? `${(n / 1024).toFixed(0)} KB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const pct = (a: number, b: number): string => `${((100 * a) / b).toFixed(1)}%`;
const now = (): number => performance.now();
/** Numbers rounded to the millimetre (what an object record holds): the fair JSON beside the codec's. */
const roundDeep = (v: unknown): unknown => (typeof v === "number" ? mm(v) : Array.isArray(v) ? v.map(roundDeep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)])) : v);
/** Typed arrays as plain arrays (not through JSON: it would turn an Infinity into null). */
const plain = (v: unknown): unknown => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : Array.isArray(v) ? v.map(plain) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

interface Row { name: string; note: string; json: number; jsonGz: number; codec: number; codecGz: number; exact: string }
const rows: Row[] = [];
function row<S extends Type<unknown>>(name: string, note: string, schema: S, value: Infer<S>, json: string, exact: string): Uint8Array {
  const bytes = encode(schema, value);
  // (Every row decodes back: the table is of documents that work.)
  const back = decode(schema, bytes);
  if (JSON.stringify(encodeRaw(schema, back)) !== JSON.stringify(encodeRaw(schema, value))) throw new Error(`${name}: not canonical.`);
  rows.push({ name, note, json: Buffer.byteLength(json), jsonGz: gz(json), codec: bytes.length, codecGz: gz(bytes), exact });
  return bytes;
}

// ---------------------------------------------------------------- objects

const pieces = PIECE_KEYS.flatMap((key) => Array.from({ length: 25 }, (_, i) => objectRecordOf(buildPiece(key, `0x${(i + 1).toString(16)}`) as unknown as ObjectDefLike)));
row("object catalogue", `${pieces.length} pieces (12 kinds × 25 seeds)`, array(OBJECT), pieces, JSON.stringify(pieces), "to the mm");
rows.push({ ...rows[rows.length - 1]!, name: "", note: "... against JSON at the same precision", json: Buffer.byteLength(JSON.stringify(roundDeep(pieces))), jsonGz: gz(JSON.stringify(roundDeep(pieces))) });

const course = levelOf("7");
const placed = placedRecordOf(course.objects as unknown as InstanceLike[]);
row("WALLRUN course", `${course.objects.length} instances, ${placed.defs.length} definitions`, PLACED, placed, JSON.stringify(placed), "to the mm");
rows.push({ ...rows[rows.length - 1]!, name: "", note: "... against JSON at the same precision", json: Buffer.byteLength(JSON.stringify(roundDeep(placed))), jsonGz: gz(JSON.stringify(roundDeep(placed))) });

// ---------------------------------------------------------------- the garden world

const garden = makeWorld();
garden.simulate(10);
// (Dust in the air, as a landing leaves it: the snapshot carries live particles.)
for (let k = 0; k < 6; k += 1) garden.particles.emit("dust", [k - 3, 0.3, -k], { count: 8 });
garden.simulate(0.2);
const snap = garden.snapshot();
row("garden world snapshot", `${snap.entities.length} entities, ${snap.particles.length} particles, 10.2 s in`, WORLD_SNAPSHOT, snap as never, JSON.stringify(snap), "exact");
row("garden particles (save)", `${snap.particles.length} live particles`, PARTICLES, snap.particles as never, JSON.stringify(snap.particles), "exact");

const pool = createParticlePool({ capacity: 4096, emitters: 256, seed: 7, recipes: PRESETS });
for (let k = 0; k < 12; k += 1) pool.emit(Object.keys(PRESETS)[k % Object.keys(PRESETS).length]!, k * 2, 0, k);
for (let k = 0; k < 40; k += 1) pool.step(1 / 60);
const poolSnap = plain(pool.save()) as Infer<typeof PARTICLE_POOL>;
row("particle pool snapshot", `${pool.count} particles, 256 emitter slots`, PARTICLE_POOL, poolSnap, JSON.stringify(poolSnap), "exact (JSON: not -- Infinity becomes null)");

// ---------------------------------------------------------------- the army

let t0 = now();
const pop = armyPopulation("army", 10000);
const popRec = populationRecordOf("army", pop as never);
const popMs = now() - t0;
const popBytes = row("army population (pack + looks)", `10,000 units, ${popRec.bodies.length} bodies, ${popRec.attributes.length} wearable shapes`, POPULATION, popRec, JSON.stringify(popRec), "exact");
// (The same 10,000 units as a hybrid record: the recipe and the look re-rolls -- bake's populationOf makes every unit again.)
const hybrid = recordOf(pop);
row("army population as a hybrid record", `the same 10,000: recipe + ${hybrid.exceptions.length} units' re-rolls`, HYBRID_POPULATION, hybrid, JSON.stringify(popRec), "exact (regenerated)");

// ---------------------------------------------------------------- scripts

const bc = compileScript(GUARD_SCRIPT);
row("script: blocks", "a guard (4 handlers, 7 vars)", BLOCKS, GUARD_SCRIPT as never, JSON.stringify(GUARD_SCRIPT), "exact");
row("script: bytecode", `the same, ${bc.handlers.reduce((a, h) => a + h.code.length, 0)} ops`, BYTECODE, bc, JSON.stringify(GUARD_SCRIPT), "exact (vs the blocks' JSON)");

// ---------------------------------------------------------------- sound

const NOCTURNES = resolve(process.env["NOCTURNES"] ?? resolve(import.meta.dirname, "../../../../keel-nocturnes"));
let nocturnes: { plans: Plan[]; recipes: Infer<typeof MUSIC_RECIPE>[] } | null = null;
try {
  const nGenome = await import(pathToFileURL(`${NOCTURNES}/src/genome.js`).href);
  const nRng = await import(pathToFileURL(`${NOCTURNES}/src/rng.js`).href);
  const plans: Plan[] = [];
  const recipes: Infer<typeof MUSIC_RECIPE>[] = [];
  for (let t = 1; t <= 100; t += 1) {
    const g = nGenome.makeGenome(nRng.seedFromToken(t)) as NocturnesGenome;
    const m = moodOfNocturnes(g);
    plans.push(scoreOf(m, m.seed));
    recipes.push(recipeOfMood(m as never, m.seed, { bands: BANDS, kits: KIT_BAND }));
  }
  nocturnes = { plans, recipes };
} catch (e) { console.error(`(NOCTURNES not found at ${NOCTURNES}: ${(e as Error).message.split("\n")[0]}; its rows are skipped)`); }
if (nocturnes) {
  const { plans, recipes } = nocturnes;
  const one = JSON.stringify(plans[0]);
  row("NOCTURNES music: 1 plan as recipe", "token 1", MUSIC_RECIPE, recipes[0]!, one, "the plan, exactly (scoreOf)");
  row("NOCTURNES music: 1 plan as song", "token 1", SONG, songOf(plans[0] as never), one, "the plan, JSON-equal");
  row("NOCTURNES music: 100 recipes", "tokens 1..100, one document", array(MUSIC_RECIPE), recipes, JSON.stringify(plans), "the plans, exactly");
  row("NOCTURNES music: 100 songs", "tokens 1..100, one document", array(SONG), plans.map((p) => songOf(p as never)), JSON.stringify(plans), "the plans, JSON-equal");
}
const WALLRUN = { name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"] } as const;
const wallrunSpecs = Array.from({ length: 50 }, (_, i) => ({ ...WALLRUN, weather: [...WALLRUN.weather], hue: (i * 37.5) % 360 }));
const wallrunPlans = wallrunSpecs.map((spec, i) => scoreOf(moodFor(spec), `wallrun-${i}`));
const wallrunRecipes = wallrunSpecs.map((spec, i): Infer<typeof MUSIC_RECIPE> => ({ from: "game", seed: `wallrun-${i}`, spec }));
row("WALLRUN music: 50 recipes", "moodFor spec + seed", array(MUSIC_RECIPE), wallrunRecipes, JSON.stringify(wallrunPlans), "the plans, exactly");
row("WALLRUN music: 50 songs", "", array(SONG), wallrunPlans.map((p) => songOf(p as never)), JSON.stringify(wallrunPlans), "the plans, JSON-equal");
row("WALLRUN sfx settings", "seed, style, body mapping, per-sound tuning", SFX_SETTINGS, WALLRUN_SFX, JSON.stringify(WALLRUN_SFX), "exact");

// ---------------------------------------------------------------- the builder (if it loads: it's being written)

try {
  const B = await import("../../builder/src/index.ts");
  const models = (B.GENERATOR_KINDS as readonly string[]).flatMap((k) => [1, 2, 3].map((s) => B.generate(k as never, s).model as unknown as VoxelModelLike & Parameters<typeof B.encodeVoxels>[0]));
  const recs = models.map((m) => voxelRecordOf(m));
  const kv1 = models.reduce((a, m) => a + B.encodeVoxels(m).length, 0);
  const kv1gz = models.reduce((a, m) => a + gz(B.encodeVoxels(m)), 0);
  const bytes = row("builder voxel models", `${models.length} generated (6 kinds × 3 seeds)`, array(VOXELS), recs, JSON.stringify(recs), "exact");
  rows.push({ name: "", note: `... the builder's own KV1 bytes: ${kv1} B (gz ${kv1gz} B, per model)`, json: kv1, jsonGz: kv1gz, codec: bytes.length, codecGz: gz(bytes), exact: "" });
  const OPS_SCHEMA = opListSchema(B.OPS as unknown as OpTable);
  const examples = Object.values(B.OPS as unknown as Record<string, { example: Record<string, unknown> }>).map((o) => o.example);
  row("builder op list", `${examples.length} ops (every op's example)`, OPS_SCHEMA, examples as never, JSON.stringify(examples), "exact");
} catch (e) { console.error(`(the builder didn't load: ${(e as Error).message.split("\n")[0]}; its rows are skipped)`); }

// ---------------------------------------------------------------- the table

console.log("| data | what | JSON | JSON+gz | codec | codec+gz | codec+gz / JSON+gz | fidelity |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
for (const r of rows) console.log(`| ${r.name} | ${r.note} | ${kb(r.json)} | ${kb(r.jsonGz)} | ${kb(r.codec)} | ${kb(r.codecGz)} | ${pct(r.codecGz, r.jsonGz)} | ${r.exact} |`);

// ---------------------------------------------------------------- speed

function speed(name: string, schema: Type<unknown>, value: unknown, bytes: Uint8Array, rounds: number): void {
  const json = JSON.stringify(value);
  for (let k = 0; k < 2; k += 1) { encodeRaw(schema, value as never); decodeRaw(schema, encodeRaw(schema, value as never)); }
  const raw = encodeRaw(schema, value as never);
  let t = now();
  for (let k = 0; k < rounds; k += 1) encodeRaw(schema, value as never);
  const enc = (now() - t) / rounds;
  t = now();
  for (let k = 0; k < rounds; k += 1) decodeRaw(schema, raw);
  const dec = (now() - t) / rounds;
  t = now();
  for (let k = 0; k < rounds; k += 1) JSON.stringify(value);
  const jenc = (now() - t) / rounds;
  t = now();
  for (let k = 0; k < rounds; k += 1) JSON.parse(json);
  const jdec = (now() - t) / rounds;
  const mbs = (n: number, ms: number): string => `${(n / 1e6 / (ms / 1000)).toFixed(1)} MB/s`;
  console.log(`| ${name} | ${kb(raw.length)} | ${enc.toFixed(2)} ms (${mbs(raw.length, enc)} out, ${mbs(json.length, enc)} JSON-equiv) | ${dec.toFixed(2)} ms (${mbs(raw.length, dec)} in, ${mbs(json.length, dec)} JSON-equiv) | ${jenc.toFixed(2)} / ${jdec.toFixed(2)} ms |`);
  void bytes;
}
console.log("\n| speed | codec size | encode | decode | JSON.stringify / parse |");
console.log("| --- | ---: | --- | --- | --- |");
speed("army population", POPULATION, popRec, popBytes, 5);
speed("garden snapshot", WORLD_SNAPSHOT, snap, new Uint8Array(0), 50);
speed("object catalogue", array(OBJECT), pieces, new Uint8Array(0), 20);
console.log(`\n(population built in ${popMs.toFixed(0)} ms)`);
