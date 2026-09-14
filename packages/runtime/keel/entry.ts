"use strict";
// The KEEL entry of keel/runtime, the registry: what `keel module build`
// compiles into its on-chain bytes. It makes the page's one global,
// KEEL_ENGINE, and defines itself there like every other module.
import link from "./link.json" with { type: "json" };
import * as runtime from "../src/index.ts";
import type { Engine, ModuleManifest } from "../src/index.ts";

const page = globalThis as { KEEL_ENGINE?: Engine };
const engine = page.KEEL_ENGINE ?? (page.KEEL_ENGINE = runtime.createEngine());
engine.define(link.manifest as unknown as ModuleManifest, () => runtime);
