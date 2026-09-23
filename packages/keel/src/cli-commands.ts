import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundleModule } from "./bundle.ts";
import { buildGameDocument, closureOf, keelAudioScripts } from "./document.ts";
import { buildVerifiedModule } from "./pipeline.ts";
import type { readWorkspace } from "./workspace.ts";

type Workspace = Awaited<ReturnType<typeof readWorkspace>>;

interface CliArgs {
  readonly args: string[];
  readonly projects: string[];
  readonly revision: string | null;
  readonly chainId: number;
  readonly dev: boolean;
  readonly check: boolean;
  readonly minify: boolean;
  readonly command: string | undefined;
  readonly id: string | undefined;
  readonly out: string;
}

export function takeCliFlag(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = args.indexOf(name); i >= 0; i = args.indexOf(name)) {
    out.push(args[i + 1] ?? "");
    args.splice(i, 2);
  }
  return out;
}

/** Parse shared flags while preserving the CLI's original order and defaults. */
export function parseCliArgs(argv: readonly string[], { engineRoot, cwd }: { engineRoot: string; cwd: string }): CliArgs {
  const args = [...argv];
  const projects = takeCliFlag(args, "--project").map((p) => resolve(cwd, p));
  const outFlag = takeCliFlag(args, "--out")[0];
  const revision = takeCliFlag(args, "--revision")[0] ?? null;
  const chainId = Number(takeCliFlag(args, "--chain-id")[0] ?? 11155111);
  const dev = args.includes("--dev");
  const check = args.includes("--check");
  const minify = !args.includes("--readable");
  const [command, id] = args.filter((a) => !a.startsWith("--"));
  const out = outFlag ? resolve(cwd, outFlag) : join(projects[0] ?? engineRoot, "out");
  return { args, projects, revision, chainId, dev, check, minify, command, id, out };
}

export const formatKb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

interface OutputCommandOptions {
  readonly args: string[];
  readonly workspace: Workspace;
  readonly engineRoot: string;
  readonly out: string;
  readonly dev: boolean;
  readonly minify: boolean;
}

/** Handle module listing and local module/document output; build commands stay in cli.ts. */
export async function runOutputCommand(command: string | undefined, id: string | undefined, options: OutputCommandOptions): Promise<boolean> {
  const { args, workspace, engineRoot, out, dev, minify } = options;
  const kb = formatKb;
  switch (command) {
    case "modules":
      for (const w of workspace) console.log(`${w.manifest.id}@${w.manifest.version}  ${w.manifest.kind}  ${w.origin}  needs [${w.manifest.needs.join(", ")}]${w.manifest.provides.length ? `  provides [${w.manifest.provides.join(", ")}]` : ""}`);
      return true;
    case "module": {
      const mod = workspace.find((w) => w.manifest.id === id);
      if (!mod) throw new Error(`No module ${id}.`);
      const b = dev ? await bundleModule(mod, workspace, { minify }) : await buildVerifiedModule(mod, workspace, engineRoot);
      const dir = join(out, "modules", mod.manifest.id, mod.manifest.version);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "module.js"), b.bytes);
      writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(mod.manifest, null, 2)}\n`);
      console.log(`${mod.manifest.id}@${mod.manifest.version} ${kb(b.bytes.byteLength)}${"outputDigest" in b ? ` ${b.outputDigest} (${b.disposition})` : " (dev bundle)"} -> ${dir}`);
      return true;
    }
    case "document": {
      if (!id) throw new Error("document <game-id>");
      const audio = !args.includes("--no-audio") && closureOf(id, workspace).some((m) => m.manifest.id === "keel/audio") && existsSync(join(engineRoot, "vendor"));
      const doc = await buildGameDocument(id, workspace, { minify, engineRoot, modules: dev ? "dev" : "verified", ...(audio ? { pageScripts: await keelAudioScripts(join(engineRoot, "vendor")) } : {}) });
      const dir = join(out, "documents", id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), doc.html);
      writeFileSync(join(dir, "report.json"), `${JSON.stringify({ game: id, bytes: dev ? "dev" : "verified", order: doc.resolution.order, modules: doc.modules, document: doc.html.byteLength }, null, 2)}\n`);
      for (const m of doc.modules) console.log(`  ${m.id}@${m.version}  ${m.kind}/${m.phase}@${m.weight}  ${kb(m.bytes)} (${kb(m.stored)} stored)${m.digest ? `  ${m.digest}` : ""}`);
      console.log(`${id}: ${doc.modules.length} modules (${dev ? "dev bundles" : "verified bytes"}), document ${kb(doc.html.byteLength)} -> ${join(dir, "index.html")}`);
      return true;
    }
    default:
      return false;
  }
}
