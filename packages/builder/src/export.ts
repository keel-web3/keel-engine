// Code output: a built thing as one pack-ready TypeScript file -- one file,
// one thing, like every asset in packs/*. The voxels ride along as compact
// text (a bit-codec document, role-indexed and LZ-coded, as base64url: the
// storage seam, store.ts); a build() converts them when the module loads. So
// a creator's pack is ordinary code: the editor shows it, an agent edits the
// plain fields (slot, fit, variation, rig joints), and the voxel data stays
// one string.
//
//   exportPackFile({ kind: "attribute", id: "war-flag", model, attribute: { slot: "back", fit: "height" } })
//   ->  import { defineAttribute } from "@keel-engine/runtime";
//       import { loadVoxels, voxelAttribute } from "@keel-engine/builder";
//       const VOXELS = loadVoxels("KC1:...");    (the storage seam: store.ts)
//       export default defineAttribute({ id: "war-flag", slot: "back", targets: [...], build: voxelAttribute(VOXELS, { fit: "height" }) });

import { contractOf } from "@keel-engine/entity";
import type { AttributeTarget } from "@keel-engine/runtime";
import type { FrontSpec } from "@keel-engine/scene";
import type { ObjectAnimation } from "./animate.ts";
import { storeVoxels, storeVoxelsText } from "./store.ts";
import type { Anchor, FitMode, SmoothOptions } from "./convert.ts";
import type { Oklch } from "./look.ts";
import { analyseShape } from "./rig.ts";
import type { RigEdits } from "./rig.ts";
import type { CharacterDesign } from "./character.ts";
import { variationChoices } from "./variation.ts";
import type { VariationRules } from "./variation.ts";
import type { VoxelModel } from "./voxels.ts";

/** A built thing, ready to export (what buildSession / assetOf make). */
export interface AssetSpec {
  readonly kind: "object" | "attribute" | "entity" | "character";
  readonly id: string;
  readonly model: VoxelModel;
  readonly title?: string;
  readonly tags?: readonly string[];
  /** A suggested look (OKLCH per role): written as a comment -- looks are the game's. */
  readonly colours?: Readonly<Record<string, Oklch>>;
  readonly variation?: VariationRules;
  readonly object?: { readonly front?: FrontSpec | "detect"; readonly smooth?: SmoothOptions; readonly animation?: ObjectAnimation };
  readonly attribute?: { readonly slot: string; readonly targets?: readonly AttributeTarget[]; readonly fit?: FitMode; readonly fill?: number; readonly anchor?: Anchor; readonly offset?: readonly [number, number, number]; readonly smooth?: SmoothOptions };
  readonly entity?: { readonly rig?: RigEdits };
  /** A capsule-and-rig character design (no voxels). */
  readonly character?: CharacterDesign;
}

export interface ExportOptions {
  /** "engine": @keel-engine/* (packs inside the engine) · "sdk": @keel/game-engine/* (a creator's own project). */
  readonly imports?: "engine" | "sdk";
  /** Characters per line of voxel text (default 96). */
  readonly width?: number;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** A value as a TypeScript literal (keys unquoted where they can be; short arrays on one line). */
export function literal(v: unknown, indent = ""): string {
  const next = `${indent}  `;
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(Object.is(v, -0) ? 0 : +v.toFixed(6)) : "0";
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const items = v.map((x) => literal(x, next));
    const flat = `[${items.join(", ")}]`;
    return flat.length <= 80 && !flat.includes("\n") ? flat : `[\n${items.map((x) => `${next}${x},`).join("\n")}\n${indent}]`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return "{}";
    const items = entries.map(([k, x]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${literal(x, next)}`);
    const flat = `{ ${items.join(", ")} }`;
    return flat.length <= 80 && !flat.includes("\n") ? flat : `{\n${items.map((x) => `${next}${x},`).join("\n")}\n${indent}}`;
  }
  return "undefined";
}

const clean = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** The file (see the top). */
export function exportPackFile(a: AssetSpec, { imports = "engine", width = 96 }: ExportOptions = {}): string {
  const runtime = imports === "sdk" ? "@keel/game-engine" : "@keel-engine/runtime";
  const builder = imports === "sdk" ? "@keel/game-engine/builder" : "@keel-engine/builder";
  if (a.kind === "character") {
    // (No voxels: the design is plain data -- the catalogue's entity, its pins, proportions and parts.)
    const d = a.character!;
    const def = clean({ id: a.id, title: a.title, tags: a.tags && a.tags.length ? [...a.tags] : undefined, kind: d.kind, species: d.species, seed: d.seed, size: d.size, pins: Object.keys(d.pins).length ? d.pins : undefined, body: Object.keys(d.body).length ? d.body : undefined, parts: d.parts.length ? d.parts : undefined });
    return [
      `// ${a.title ?? a.id}: ${d.kind === "anthro" ? "an" : "a"} ${d.kind}${d.species ? ` ${d.species}` : ""} designed with the KEEL builder -- the catalogue's character with its`,
      `// choices pinned, its proportions set and ${d.parts.length} part${d.parts.length === 1 ? "" : "s"} added.${d.wear.length ? ` Worn in the editor (attributes are their own assets): ${d.wear.map((w) => w.attribute).join(", ")}.` : ""}`,
      `import { characterEntity } from "${builder}";`,
      "",
      `export default characterEntity(${block(def, [])});`,
      "",
    ].join("\n");
  }
  const m = a.model;
  const text = storeVoxelsText(m);
  const bytes = storeVoxels(m).length;
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  const data = lines.length === 1 ? `loadVoxels(${JSON.stringify(lines[0])})` : `loadVoxels(\n  ${lines.map((l) => JSON.stringify(l)).join(" +\n  ")},\n)`;
  const title = a.title ?? a.id;
  const what = a.kind === "attribute" ? `an attribute for the "${a.attribute?.slot}" socket` : a.kind === "entity" ? "a creature" : "an object";
  const head = [
    `// ${title}: ${what}, built with the KEEL builder -- ${m.count} voxels (${[...new Set(m.roles)].join(", ")}),`,
    `// ${bytes} bytes as data. The voxels are a role-indexed, LZ-coded codec document (loadVoxels); they`,
    `// convert when this module loads.${a.colours ? " Suggested look (OKLCH per role; looks are applied later):" : ""}`,
    ...(a.colours ? [`//   ${JSON.stringify(a.colours)}`] : []),
  ];
  const tags = [...(a.tags ?? [])];
  if (a.kind === "attribute") {
    const at = a.attribute ?? { slot: "head" };
    const targets = at.targets ?? [{ body: "body/humanoid@^1" }, { body: "body/quadruped@^1" }];
    const choices = a.variation ? variationChoices(a.variation) : undefined;
    const opts = clean({ fit: at.fit, fill: at.fill, anchor: at.anchor, offset: at.offset, smooth: at.smooth, variation: a.variation });
    const def = clean({ id: a.id, slot: at.slot, title: a.title, tags: [...tags, "voxel"], targets, choices: choices && Object.keys(choices).length ? choices : undefined });
    return [
      ...head,
      `import { defineAttribute } from "${runtime}";`,
      `import { loadVoxels, voxelAttribute } from "${builder}";`,
      "",
      `const VOXELS = ${data};`,
      "",
      `export default defineAttribute(${block(def, [`build: voxelAttribute(VOXELS, ${literal(opts, "  ")})`])});`,
      "",
    ].join("\n");
  }
  if (a.kind === "entity") {
    const rig = a.entity?.rig ?? {};
    const plan = rig.plan ?? analyseShape(m).plan;
    const choices = a.variation ? variationChoices(a.variation) : undefined;
    const def = clean({ id: a.id, body: contractOf({ plan }).ref, title: a.title, tags: [...tags, "voxel", plan], choices: choices && Object.keys(choices).length ? choices : undefined });
    const opts = clean({ rig: { ...rig, plan }, variation: a.variation });
    return [
      ...head,
      `import { defineEntity } from "${runtime}";`,
      `import { loadVoxels, voxelEntity, voxelSockets } from "${builder}";`,
      "",
      `const VOXELS = ${data};`,
      "",
      `export default defineEntity(${block(def, [`build: voxelEntity(VOXELS, ${literal(opts, "  ")})`, "sockets: voxelSockets"])});`,
      "",
    ].join("\n");
  }
  const o = a.object ?? {};
  const meta = clean({ animation: o.animation, variation: a.variation, colours: a.colours });
  const opts = clean({ key: a.id, front: o.front ?? "detect", tags: tags.length ? tags : undefined, smooth: o.smooth, meta: Object.keys(meta).length ? meta : undefined });
  return [
    ...head,
    `import { loadVoxels, objectFromVoxels } from "${builder}";`,
    "",
    `const VOXELS = ${data};`,
    "",
    `export default objectFromVoxels(VOXELS, ${literal(opts)});`,
    "",
  ].join("\n");
}

// (A top-level object literal, a key a line, with more lines -- code, not data -- at its end.)
function block(o: object, more: readonly string[]): string {
  const items = Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${literal(x, "  ")}`);
  return `{\n${[...items, ...more].map((x) => `  ${x},`).join("\n")}\n}`;
}
