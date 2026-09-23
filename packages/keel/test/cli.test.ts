import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs, takeCliFlag } from "../src/cli-commands.ts";
import { run } from "../src/cli.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDir, "..", "..", "..");
const fixture = join(testDir, "fixtures", "hello");

test("CLI parsing keeps repeated projects, first output, and the remaining command flags", () => {
  const cwd = join(tmpdir(), "keel-cli-test");
  const parsed = parseCliArgs(
    ["modules", "--project", "one", "--project", "two", "--out", "first", "--out", "second", "--chain-id", "5", "--dev", "--readable"],
    { engineRoot: "/engine", cwd },
  );
  assert.deepEqual(parsed.projects, [resolve(cwd, "one"), resolve(cwd, "two")]);
  assert.equal(parsed.out, resolve(cwd, "first"));
  assert.equal(parsed.chainId, 5);
  assert.equal(parsed.command, "modules");
  assert.equal(parsed.id, undefined);
  assert.equal(parsed.dev, true);
  assert.equal(parsed.minify, false);
  assert.deepEqual(parsed.args, ["modules", "--dev", "--readable"]);
});

test("verify-origin keeps its commit flag for command-time validation", () => {
  const parsed = parseCliArgs(["verify-origin", "--commit", "bad"], { engineRoot: "/engine", cwd: "/tmp" });
  assert.equal(parsed.command, "verify-origin");
  assert.deepEqual(parsed.args, ["verify-origin", "--commit", "bad"]);
  assert.deepEqual(takeCliFlag(parsed.args, "--commit"), ["bad"]);
  assert.deepEqual(parsed.args, ["verify-origin"]);
});

test("module and document commands write their dev artifacts and report paths", async () => {
  const out = mkdtempSync(join(tmpdir(), "keel-cli-output-"));
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  try {
    await run(["modules", "--project", fixture], { engineRoot: root, cwd: root });
    assert.ok(logs.some((line) => line.startsWith("fixtures/hello@0.1.0 ")));

    logs.length = 0;
    const moduleOut = join(out, "module-out");
    await run(["module", "fixtures/hello", "--project", fixture, "--out", moduleOut, "--dev"], { engineRoot: root, cwd: root });
    const moduleDir = join(moduleOut, "modules", "fixtures", "hello", "0.1.0");
    assert.ok(readFileSync(join(moduleDir, "module.js")).byteLength > 0);
    assert.equal(JSON.parse(readFileSync(join(moduleDir, "manifest.json"), "utf8")).id, "fixtures/hello");
    assert.ok(logs.some((line) => line.startsWith("fixtures/hello@0.1.0 ") && line.endsWith(` -> ${moduleDir}`)));

    logs.length = 0;
    const documentOut = join(out, "document-out");
    await run(["document", "fixtures/hello", "--project", fixture, "--out", documentOut, "--dev"], { engineRoot: root, cwd: root });
    const documentDir = join(documentOut, "documents", "fixtures", "hello");
    assert.match(readFileSync(join(documentDir, "index.html"), "utf8"), /<html|<!doctype html/i);
    const report = JSON.parse(readFileSync(join(documentDir, "report.json"), "utf8"));
    assert.equal(report.game, "fixtures/hello");
    assert.equal(report.bytes, "dev");
    assert.ok(logs.some((line) => line.startsWith("fixtures/hello:") && line.endsWith(` -> ${join(documentDir, "index.html")}`)));
  } finally {
    console.log = originalLog;
    rmSync(out, { recursive: true, force: true });
  }
});
