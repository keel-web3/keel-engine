import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { gameEntrySource } from "../src/document.ts";

test("game and site entries start the same module through different exports", async () => {
  const calls: string[] = [];
  const body = { textContent: "" };
  const game = {
    main: (host: unknown) => { assert.equal(host, body); calls.push("game"); },
    site: (host: unknown) => { assert.equal(host, body); calls.push("site"); },
  };
  const context = { document: { body }, KEEL_ENGINE: { start: async () => { calls.push("start"); }, get: (id: string) => { assert.equal(id, "fixtures/hello"); return game; } } };
  await vm.runInNewContext(gameEntrySource("fixtures/hello"), context);
  await vm.runInNewContext(gameEntrySource("fixtures/hello", "site"), context);
  assert.deepEqual(calls, ["start", "game", "start", "site"]);
});

test("entry export is a name, never injected script", () => {
  assert.throws(() => gameEntrySource("fixtures/hello", "site();"), /Invalid game entry export/);
});

test("default game entry keeps the published source unchanged", () => {
  assert.equal(gameEntrySource("fixtures/hello"), `(async function(){var E=globalThis.KEEL_ENGINE;await E.start();var g=E.get("fixtures/hello");if(g&&typeof g.main==="function")await g.main(document.body);})().catch(function(e){document.body.textContent=String(e&&e.stack||e);throw e;});\n`);
});
