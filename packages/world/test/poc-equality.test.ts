// The world beside the proof of concept's src/world/world.js: the same level,
// the same brains, the same scripted player -- and the same run, to the bit:
// settings, streams, bodies, minds, particles, the level, what each frame
// hands the renderer. Where this world differs on purpose, the difference is
// shown here too (and README "Differences" says why):
//
//   1. The camera's subject is an entity's real height. The proof of concept
//      held every subject to 0.6 m (its arm started at half the height, inside
//      the floor's room, for a cat); the camera package now starts a small
//      subject's arm clear of the floor itself. Views of subjects under 0.6 m differ.
//   2. restore() is exact. The proof of concept restarted animators and dropped
//      a camera blend in progress (and the fov kick); here they are loaded.
//   3. Snapshots are v2: the camera's own saved state (not v1's field copy),
//      each entity's animator. Everything v1 carried is the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettings, createWorld, namedStream, parseLocks, targetRules } from "../src/index.ts";
import type { Frame, World, WorldOptions } from "../src/index.ts";
import { level, makeWorld } from "./fixtures.ts";
import { POC, counter, hasPoc, poc, rand } from "./reference.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
type Make = (o: WorldOptions) => World;
const pocWorld = hasPoc ? (await poc<{ createWorld: Make }>("src/world/world.js")).createWorld : null;
const pocSettings = hasPoc ? await poc<{ createSettings: typeof createSettings; parseLocks: typeof parseLocks }>("src/world/settings.js") : null;
const pocStreams = hasPoc ? await poc<{ namedStream: typeof namedStream }>("src/world/streams.js") : null;
const pocRules = hasPoc ? await poc<{ targetRules: typeof targetRules }>("src/world/rules.js") : null;

// What v1 and v2 snapshots share (v2 adds the camera's own state and each animator's).
function shared(w: World): Record<string, unknown> {
  const s = JSON.parse(JSON.stringify(w.snapshot())) as Record<string, unknown> & { entities: Record<string, unknown>[] };
  const { v: _v, camera: _camera, ...rest } = s;
  return { ...rest, entities: s.entities.map(({ anim: _anim, heldKey: _held, ...e }) => e) };
}
// A frame, as JSON (the renderer's inputs, minus the rules object's own identity).
const frameOf = (w: World): Frame => JSON.parse(JSON.stringify(w.frame())) as Frame;

test("settings, locks, streams and target rules beside the proof of concept's", { skip }, () => {
  const c = counter();
  const R = rand(7);
  const scopes = ["engine", "project", "scene", "runtime", "tag:bench", "tag:lamp", "id:bench-1", "id:lamp-2", "seed:bench-1"];
  const keys = ["material", "render.palette", "show", "species", "size"];
  const things = [null, "bench-1", "lamp-2", { id: "bench-3", tags: ["bench"] }, { id: "x", tags: ["lamp", "bench"] }];
  for (let round = 0; round < 40; round += 1) {
    const tagsOf = (id: string) => (id.startsWith("bench") ? ["bench"] : id.startsWith("lamp") ? ["lamp"] : []);
    const a = createSettings({ engine: { material: "stone" }, tagsOf });
    const b = pocSettings!.createSettings({ engine: { material: "stone" }, tagsOf });
    for (let op = 0; op < 60; op += 1) {
      const scope = scopes[Math.floor(R() * scopes.length)]!;
      const key = keys[Math.floor(R() * keys.length)]!;
      const value = ["oak", "teak", 2, true, null, ["fog"]][Math.floor(R() * 6)]!;
      const thing = things[Math.floor(R() * things.length)]!;
      const kind = Math.floor(R() * 6);
      const note = R() < 0.2 ? "n" : undefined;
      const force = R() < 0.5;
      const run = (s: typeof a) => {
        try {
          if (kind === 0) return s.set(scope, key, value, { note });
          if (kind === 1) return s.lock(scope, key, value);
          if (kind === 2) return s.unlock(scope, key);
          if (kind === 3) return s.unset(scope, key, { force });
          if (kind === 4) return s.propose(key, value, thing);
          return s.set(scope, key, value, { force: true });
        } catch (e) { return String((e as Error).message); }
      };
      c.same("writes", run(a), run(b));
      for (const k of keys) for (const t of things) {
        c.same("get", a.get(k, t), b.get(k, t));
        c.same("explain", a.explain(k, t), b.explain(k, t));
      }
    }
    c.same("toJSON", a.toJSON(), b.toJSON());
    c.same("refusals", a.refusals, b.refusals);
  }
  const text = "scene/render.palette=dusk;tag:animal/species=cat;id:bench-1/material=~oak;scene/render.fx=[\"fog\"];scene/x=1";
  c.same("parseLocks", parseLocks(text), pocSettings!.parseLocks(text));
  for (let i = 0; i < 40; i += 1) {
    const a = namedStream(`0x${"ab".repeat(32)}`, `rng:s${i}`, i * 3);
    const b = pocStreams!.namedStream(`0x${"ab".repeat(32)}`, `rng:s${i}`, i * 3);
    for (let k = 0; k < 20; k += 1) c.exact("streams", a.f(), b.f());
    c.same("weighted", a.weighted([["a", 1], ["b", 3], ["c", 2]]), b.weighted([["a", 1], ["b", 3], ["c", 2]]));
  }
  for (let w = 8; w <= 300; w += 7) for (const h of [w, 40, 256]) c.same("targetRules", targetRules(w, h), pocRules!.targetRules(w, h));
  console.log(c.summary("settings/streams/rules equality"));
});

test("the test level, 12 s: every checkpoint's state and frame are the proof of concept's, to the bit", { skip }, () => {
  const c = counter();
  const sizes: [number, number][] = [[64, 64], [32, 32], [128, 96]];
  for (const [width, height] of sizes) {
    const a = makeWorld({ width, height });
    const b = makeWorld({ width, height }, pocWorld!);
    c.same("layout", a.layout(), b.layout());
    c.same("rests", a.rests, b.rests);
    for (let i = 0; i < 48; i += 1) {
      a.simulate(0.25);
      b.simulate(0.25);
      c.same("state (v1 fields)", shared(a), shared(b), `${width}x${height} at ${i}`);
      c.same("frame", frameOf(a), frameOf(b), `${width}x${height} frame at ${i}`);
      c.same("view", a.camera.view(), b.camera.view());
      // (Settings change mid-run: a lock, a tag's material, a hidden crate -- then the frame again.)
      if (i === 20) for (const w of [a, b]) { w.lock("id:bench-1", "material", "paint"); w.set("tag:animal", "system.physics.gravity", 12); w.set("id:crate-1", "show", false); }
      if (i === 30) for (const w of [a, b]) { w.set("scene", "render.fx", ["glow", "vignette"]); w.set("scene", "fx.glow", false); w.setTarget(48, 48); }
    }
  }
  console.log(c.summary("world equality (3 sizes x 48 checkpoints)"));
});

test("a keyboard run, recorded and replayed, is the proof of concept's", { skip }, () => {
  const c = counter();
  const keys: [number, string, boolean][] = [[0, "w", true], [120, " ", true], [130, " ", false], [300, "d", true], [420, "w", false], [600, "d", false]];
  const run = (make: Make) => {
    const w = makeWorld({}, make);
    w.drive(null);
    w.record();
    for (let i = 0; i < 720; i += 1) {
      for (const [at, k, down] of keys) if (at === i) w.input.key(k, down);
      if (i === 200) w.input.look(0.4, -0.1);
      w.step();
    }
    return { w, log: w.record(false)! };
  };
  const a = run(createWorld);
  const b = run(pocWorld!);
  c.same("log", a.log, b.log);
  c.same("state", shared(a.w), shared(b.w));
  c.same("view", a.w.camera.view(), b.w.camera.view());
  c.same("frame", frameOf(a.w), frameOf(b.w));
  console.log(c.summary("keyboard run equality"));
});

test("difference 1: a small subject's camera -- its real height, not 0.6 m (the bodies are the same)", { skip }, () => {
  const a = makeWorld();
  const b = makeWorld({}, pocWorld!);
  // (animal-1 is the seed's; a small one is found, so the test says what it shows.)
  const small = [...a.entities.values()].find((e) => e.size.height < 0.6);
  assert.ok(small, "the level has an entity under 0.6 m");
  a.focus = small.id;
  b.focus = small.id;
  for (const w of [a, b]) w.lock("scene", "system.camera.mode", "chase");
  let differ = 0;
  for (let i = 0; i < 24; i += 1) {
    a.simulate(0.25);
    b.simulate(0.25);
    assert.deepEqual(shared(a), shared(b), "the simulation is the same: only the camera differs");
    if (JSON.stringify(a.camera.view()) !== JSON.stringify(b.camera.view())) differ += 1;
    // (Here the subject is as tall as it is; there it was 0.6 m.)
    assert.equal(a.subjectFor(a.entities.get(small.id)!).height, small.size.height);
    assert.equal(b.subjectFor(b.entities.get(small.id)!).height, 0.6);
    assert.ok(a.camera.eye[1] > a.entities.get(small.id)!.body.pos[1], "the eye is above the subject's feet");
  }
  assert.ok(differ > 0, "views differ for a subject under 0.6 m");
  // A subject 0.6 m and up (the hero): the same view.
  const c = makeWorld();
  const d = makeWorld({}, pocWorld!);
  for (let i = 0; i < 12; i += 1) { c.simulate(0.25); d.simulate(0.25); assert.deepEqual(c.camera.view(), d.camera.view()); }
});

test("difference 2: restore is exact here (poses and a blend in progress); the proof of concept's wasn't", { skip }, () => {
  const exact = (make: Make) => {
    const w = makeWorld({}, make);
    w.simulate(2.5);
    // (A blend under way: the camera mode changes, and the snapshot is taken 0.1 s into its 0.35 s.)
    w.lock("scene", "system.camera.mode", "chase");
    w.simulate(0.1);
    const snap = w.snapshot();
    w.simulate(0.1);
    const straight = frameOf(w); // (0.2 s into the blend)
    w.restore(snap);
    w.simulate(0.1);
    const again = frameOf(w);
    return { straight, again };
  };
  const a = exact(createWorld);
  // (The palette's key counts rebuilds -- a restore rebuilds it -- and names no colour.)
  assert.deepEqual({ ...a.again, palette: { ...a.again.palette, key: "" } }, { ...a.straight, palette: { ...a.straight.palette, key: "" } }, "here: the same frame");
  const b = exact(pocWorld!);
  assert.notDeepEqual(b.again.capsules, b.straight.capsules, "there: the animators restarted, the poses differ");
  assert.notDeepEqual(b.again.view, b.straight.view, "there: the blend was dropped, the view differs");
  // (And the simulation itself was exact there too: the bodies match.)
  assert.deepEqual(b.again.boxes, b.straight.boxes);
});

test("generation under locks beside the proof of concept's: the same items kept, the same rolls", { skip }, () => {
  const c = counter();
  for (const locks of ["", "tag:animal/species=deer", "scene/animals=3;id:bench-1/material=paint", "id:animal-2/species=fox;scene/render.palette=x"]) {
    const a = makeWorld({ config: { locks } });
    const b = makeWorld({ config: { locks } }, pocWorld!);
    c.same("settings", a.settings.toJSON(), b.settings.toJSON());
    c.same("warnings", a.warnings, b.warnings);
    c.same("entities", [...a.entities.values()].map((e) => [e.id, e.make, e.spec.choices, e.size]), [...b.entities.values()].map((e) => [e.id, e.make, e.spec.choices, e.size]));
    c.same("explain", a.explain("species", "animal-1"), b.explain("species", "animal-1"));
    a.generate(level);
    b.generate(level);
    c.same("regenerated", shared(a), shared(b));
  }
  // (A lock the entity can't take: the same refusal, naming the lock.)
  const err = (make: Make) => { try { makeWorld({ config: { locks: "id:hero/species=cat" } }, make); return ""; } catch (e) { return (e as Error).message; } };
  c.same("errors", err(createWorld), err(pocWorld!));
  assert.match(err(createWorld), /locked at id:hero/);
  console.log(c.summary("generation equality"));
});
