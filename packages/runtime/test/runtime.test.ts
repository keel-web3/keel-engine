import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine, defineAttribute, defineEntity, defineManifest, definePack, contentsOf, fits, satisfies } from "../src/index.ts";
import type { AnyEntityDef, ModuleManifest } from "../src/index.ts";

test("version ranges", () => {
  const yes: Array<[string, string]> = [["1.4.2", "^1.2"], ["1.4.2", "~1.4"], ["1.4.2", "1.x"], ["1.4.2", ">=1.2 <2"], ["0.2.5", "^0.2.1"], ["2.0.0", "^1 || ^2"], ["3.1.0", "*"], ["1.0.0", "1"]];
  const no: Array<[string, string]> = [["2.0.0", "^1.2"], ["1.5.0", "~1.4"], ["0.3.0", "^0.2.1"], ["0.0.4", "^0.0.3"], ["1.1.9", ">=1.2 <2"]];
  for (const [v, r] of yes) assert.ok(satisfies(v, r), `${v} in ${r}`);
  for (const [v, r] of no) assert.ok(!satisfies(v, r), `${v} not in ${r}`);
});

test("manifests are checked and get KEEL slot defaults by kind", () => {
  const m = defineManifest({ id: "packs/animals", version: "1.2.0", kind: "pack", provides: ["body/quadruped@1.0.0"] });
  assert.equal(m.phase, "runtime");
  assert.ok(m.weight < 0);
  assert.throws(() => defineManifest({ id: "Animals", version: "1.0.0", kind: "pack" }), /namespaced/);
  assert.throws(() => defineManifest({ id: "packs/a", version: "1.0", kind: "pack" }), /exact semver/);
  assert.throws(() => defineManifest({ id: "packs/a", version: "1.0.0", kind: "pack", provides: ["body/q@1"] }), /exact version/);
});

const mod = (id: string, version: string, kind: ModuleManifest["kind"], extra: Partial<ModuleManifest> = {}) =>
  defineManifest({ id, version, kind, ...extra });

test("the registry starts modules in dependency order and hands each only what it needs", async () => {
  const engine = createEngine();
  const started: string[] = [];
  engine.define(mod("games/park", "1.0.0", "game", { needs: ["keel/entity@^1", "contract:ai/animal@^1", "contract:body/quadruped@^1"] }), (ctx) => {
    started.push("park");
    const ai = ctx.providers<{ name: string }>("ai/animal");
    const bodies = ctx.providers<{ n: number }>("body/quadruped");
    return { ai: ai.map((a) => a.api.name), bodies: bodies.length, entity: ctx.use<{ v: number }>("keel/entity").v };
  });
  engine.define(mod("ai/wander", "1.0.0", "ai", { needs: ["keel/entity@^1"], provides: ["ai/animal@1.0.0"] }), () => { started.push("wander"); return { name: "wander" }; });
  engine.define(mod("packs/animals", "1.3.0", "pack", { needs: ["keel/entity@^1"], provides: ["body/quadruped@1.2.0"] }), () => { started.push("animals"); return { n: 7 }; });
  engine.define(mod("packs/farm", "2.0.0", "pack", { needs: ["keel/entity@^1"], provides: ["body/quadruped@1.0.0"] }), () => { started.push("farm"); return { n: 3 }; });
  engine.define(mod("keel/entity", "1.1.0", "runtime"), () => { started.push("entity"); return { v: 11 }; });
  const r = engine.resolve();
  assert.ok(r.ok, JSON.stringify(r.problems));
  await engine.start();
  assert.equal(started[0], "entity");
  assert.equal(started.at(-1), "park");
  assert.deepEqual(engine.get("games/park"), { ai: ["wander"], bodies: 2, entity: 11 });
});

test("a data-phase module reads every defined module's manifest before the others start (never their apis)", async () => {
  const engine = createEngine();
  const schemas = [{ id: "packs/tiles/tile@1", hash: "ab".repeat(32) }];
  let seen: Array<{ id: string; started: boolean; schemas: number }> = [];
  engine.define(mod("keel/codec", "0.1.0", "runtime", { phase: "data", weight: -31000 }), (ctx) => {
    const list = ctx.modules();
    assert.ok(Object.isFrozen(list), "a read-only list");
    seen = list.map((m) => ({ id: m.id, started: engine.has(m.id) && (() => { try { engine.get(m.id); return true; } catch { return false; } })(), schemas: m.contents?.schemas?.length ?? 0 }));
    return {};
  });
  engine.define(mod("packs/tiles", "1.0.0", "pack", { contents: { schemas } }), () => ({}));
  engine.define(mod("games/walk", "1.0.0", "game", { needs: ["packs/tiles@^1"] }), (ctx) => ({ n: ctx.modules().length }));
  await engine.start();
  assert.deepEqual(seen, [
    { id: "games/walk", started: false, schemas: 0 },
    { id: "keel/codec", started: false, schemas: 0 },
    { id: "packs/tiles", started: false, schemas: 1 },
  ]);
  assert.deepEqual(engine.get("games/walk"), { n: 3 });
});

test("a module can't reach what it didn't declare", async () => {
  const engine = createEngine();
  engine.define(mod("keel/core", "1.0.0", "runtime"), () => ({}));
  engine.define(mod("keel/render", "1.0.0", "runtime"), () => ({}));
  engine.define(mod("games/sneaky", "1.0.0", "game", { needs: ["keel/core@1"] }), (ctx) => ctx.use("keel/render"));
  await assert.rejects(engine.start(), /without needing it/);
});

test("problems come back all at once: missing, wrong version, no provider, cycles, duplicates", () => {
  const engine = createEngine();
  engine.define(mod("keel/core", "2.0.0", "runtime"), () => ({}));
  engine.define(mod("games/a", "1.0.0", "game", { needs: ["keel/core@^1", "keel/physics@^1", "contract:ai/unit@^1"] }), () => ({}));
  engine.define(mod("sys/x", "1.0.0", "system", { needs: ["sys/y@1"] }), () => ({}));
  engine.define(mod("sys/y", "1.0.0", "system", { needs: ["sys/x@1"] }), () => ({}));
  const r = engine.resolve();
  assert.equal(r.ok, false);
  const kinds = r.problems.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ["contract", "cycle", "missing", "version"]);
  assert.throws(() => engine.define(mod("keel/core", "2.1.0", "runtime"), () => ({})), /one version per document/);
});

// ---- attributes on entities

const S = { f: () => 0.5, between: (a: number, b: number) => (a + b) / 2, int: (a: number) => a, pick: <T,>(l: readonly T[]) => l[0] as T, chance: () => false };
const dog = (body = "body/quadruped@1.2.0"): AnyEntityDef => defineEntity({ id: "dog", body, build: () => ({ size: 0.6 }), sockets: () => ({ head: { pos: [0, 0.6, 0.3], size: [0.2, 0.15, 0.2] } }) });
const beanie = defineAttribute({ id: "beanie", slot: "head", targets: [{ body: "body/quadruped@^1" }, { body: "body/humanoid@^1" }], build: (_s, fit) => ({ w: fit.size[0] }) });
const onlyAnimals = defineAttribute({ id: "collar", slot: "neck", targets: [{ body: "body/quadruped@^1", packs: ["packs/animals@^1"] }], build: () => ({}) });

test("attributes: same pack fits; another pack's dog needs both packs to agree", () => {
  const animals = mod("packs/animals", "1.3.0", "pack", { provides: ["body/quadruped@1.2.0"] });
  const farm = mod("packs/farm", "2.0.0", "pack", { provides: ["body/quadruped@1.0.0"] });
  const animalsOpenToFarm = mod("packs/animals", "1.3.0", "pack", { provides: ["body/quadruped@1.2.0"], compatible: ["packs/farm@^2"] });
  const farmOpenToAnimals = mod("packs/farm", "2.0.0", "pack", { provides: ["body/quadruped@1.0.0"], compatible: ["packs/animals@^1"] });
  const openFarm = mod("packs/farm", "2.0.0", "pack", { provides: ["body/quadruped@1.0.0"], compatible: ["*"] });

  assert.ok(fits({ def: beanie, pack: animals }, { def: dog(), pack: animals }).ok, "same pack");
  const other = fits({ def: beanie, pack: animals }, { def: dog("body/quadruped@1.0.0"), pack: farm });
  assert.equal(other.ok, false, "another pack's dog, neither agreed");
  assert.equal(fits({ def: beanie, pack: animalsOpenToFarm }, { def: dog("body/quadruped@1.0.0"), pack: farm }).ok, false, "only one side agreed");
  assert.ok(fits({ def: beanie, pack: animalsOpenToFarm }, { def: dog("body/quadruped@1.0.0"), pack: farmOpenToAnimals }).ok, "both agreed");
  assert.ok(fits({ def: beanie, pack: animalsOpenToFarm }, { def: dog("body/quadruped@1.0.0"), pack: openFarm }).ok, "the farm is open to every wearable");
  // Named targets: the collar is for packs/animals entities only -- and packs/animals still has to agree.
  assert.equal(fits({ def: onlyAnimals, pack: farm }, { def: dog(), pack: animals }).ok, false, "named, but animals never agreed");
  assert.ok(fits({ def: onlyAnimals, pack: farm }, { def: dog(), pack: animalsOpenToFarm }).ok, "named, and animals agreed");
  assert.ok(fits({ def: onlyAnimals, pack: animals }, { def: dog(), pack: animals }).ok, "its own pack");
  assert.equal(fits({ def: onlyAnimals, pack: animals }, { def: dog("body/quadruped@1.0.0"), pack: farm }).ok, false);
  // A different body never fits.
  assert.equal(fits({ def: onlyAnimals, pack: animals }, { def: dog("body/humanoid@1.0.0"), pack: animals }).ok, false);
});

test("an attribute is built to the socket it lands on", () => {
  const d = dog();
  const sock = d.sockets(d.build(S, {}))["head"];
  assert.ok(sock);
  assert.deepEqual(beanie.build(S, sock, {}), { w: 0.2 });
});

test("packs refuse duplicate ids and list their contents", () => {
  const pack = definePack({ entities: [dog()], attributes: [beanie] });
  assert.deepEqual(contentsOf(pack), { entities: [{ id: "dog", body: "body/quadruped@1.2.0" }], attributes: [{ id: "beanie", slot: "head" }] });
  assert.throws(() => definePack({ entities: [dog(), dog()], attributes: [] }), /two entities called dog/);
});
