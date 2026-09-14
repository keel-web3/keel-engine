// The bake bench: real entity designs (people, anthro animals, animals on four
// legs, each wearing a thing or two) baked through the pixel renderer at a
// ladder of pixel scales -- the cost per sprite and per design, and a sheet of
// what came out. Build with `node packages/bake/tools/build.mjs`, open
// http://localhost:4300/packages/bake/tools/bake-bench.html (globalThis.bakeBench).
import { createPixelRenderer } from "@keel-engine/render";
import { entityOf } from "@keel-engine/entity";
import type { AttributeShape, Kind } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import type { Socket } from "@keel-engine/runtime";
import { bakeSprites, bakeStyleKey, entityDesign, planBake, renderSprites } from "../src/index.ts";
import type { BakeRenderer, EntityDesign } from "../src/index.ts";

const both = [{ body: "body/humanoid@^1" }, { body: "body/quadruped@^1" }] as const;
const hat = defineAttribute<AttributeShape>({ id: "hat", slot: "head", targets: both, build: (S, fit) => ({ capsules: [{ a: [0, 0, 0], b: [0, fit.size[1] * (0.5 + S.f() * 0.5), 0], r: fit.size[0] * 0.42, role: "accent" }] }) });
// (A pack grows out of the back: behind a person (-z), on top of an animal (+y) -- the socket's `out` says which.)
const pack = defineAttribute<AttributeShape>({ id: "pack", slot: "back", targets: both, build: (_S, fit) => {
  const out = (fit as Socket & { out?: readonly number[] }).out ?? [0, 0, -1];
  const d = out[1]! > 0.5 ? fit.size[1] * 0.3 : fit.size[2] * 0.35;
  return { boxes: [{ c: [out[0]! * d, out[1]! * d, out[2]! * d], h: [fit.size[0] * 0.42, out[1]! > 0.5 ? d : fit.size[1] * 0.42, out[1]! > 0.5 ? fit.size[2] * 0.35 : d], role: "clothAlt" }] };
} });
const collar = defineAttribute<AttributeShape>({ id: "collar", slot: "neck", targets: both, build: (_S, fit) => ({ capsules: [{ a: [-fit.size[0] * 0.5, 0, 0], b: [fit.size[0] * 0.5, 0, 0], r: fit.size[1] * 0.35, role: "accent" }] }) });

export function armyDesigns(n: number, seed = 1): EntityDesign[] {
  const kinds: Kind[] = ["anthro", "animal", "humanoid", "anthro", "animal"];
  const wears = [[hat], [pack], [collar], [hat, pack], [collar, hat]];
  return Array.from({ length: n }, (_, i) => entityDesign(entityOf(String(seed * 1000 + i), { kind: kinds[i % kinds.length]! }), { attributes: wears[i % wears.length]!, pack: "bench" }));
}

export interface BenchRow { offPalette: number; k: number; designs: number; sprites: number; spriteH: number; ms: number; perSprite: number; perDesign: number; drawMs: number; readMs: number; trimMs: number; kept: string }

export async function bakeBench(sheet: HTMLCanvasElement): Promise<{ rows: BenchRow[]; compileMs: number }> {
  const canvas = new OffscreenCanvas(64, 64);
  const px: BakeRenderer = createPixelRenderer(canvas, { width: 64, height: 64 });
  const style = { screen: 4, dither: 0.9, outline: 1 };
  const all = armyDesigns(24);
  const byKey = new Map([...all, ...armyDesigns(15)].map((d) => [d.key, d]));
  const rows: BenchRow[] = [];
  // (The first render compiles the shaders: timed apart.)
  const c0 = performance.now();
  renderSprites(px, planBake(all.slice(0, 1), { pixelsPerMetre: 8, directions: 1 }).sprites.slice(0, 1), byKey);
  const compileMs = performance.now() - c0;
  const run = (k: number, designs: EntityDesign[]) => {
    const plan = planBake(designs, { directions: 8, pixelsPerMetre: k, pitch: 0.6, style: bakeStyleKey({ style }) });
    const r = renderSprites(px, plan.sprites, byKey, { style });
    const s = r.stats;
    // Palette-true: every opaque pixel is one of its design's palette entries.
    const designOf = new Map(plan.sprites.map((j) => [j.key, j.design]));
    const sets = new Map(designs.map((d) => [d.key, new Set(d.palette.colours.map((c) => ((c[0]! << 16) | (c[1]! << 8) | c[2]!)))]));
    let offPalette = 0;
    for (const b of r.baked) { const set = sets.get(designOf.get(b.key)!)!; for (let i = 0; i < b.rgba.length; i += 4) if (b.rgba[i + 3] && !set.has((b.rgba[i]! << 16) | (b.rgba[i + 1]! << 8) | b.rgba[i + 2]!)) offPalette += 1; }
    const spriteH = Math.round(r.baked.reduce((m, b) => m + b.h, 0) / r.baked.length);
    rows.push({ offPalette, k, designs: designs.length, sprites: s.sprites, spriteH, ms: +s.ms.toFixed(1), perSprite: +(s.ms / s.sprites).toFixed(3), perDesign: +(s.ms / designs.length).toFixed(1), drawMs: +s.drawMs.toFixed(1), readMs: +s.readMs.toFixed(1), trimMs: +s.trimMs.toFixed(1), kept: `${((s.kept / s.rendered) * 100).toFixed(0)}%` });
    return r;
  };
  for (const k of [16, 24, 32]) run(k, all);
  // Big sprites: people ~128 and ~256 px tall.
  const people = armyDesigns(15).filter((d) => d.spec.kind === "humanoid");
  run(88, people.slice(0, 2));
  run(176, people.slice(0, 2));
  // The sheet: every design at 32 px/m, walking, all 8 directions, 4x.
  const plan = planBake(all, { directions: 8, pixelsPerMetre: 32, pitch: 0.6 });
  const jobs = plan.sprites.filter((j) => (j.clip === "walk" && j.frame === 2) || (j.clip === "idle" && j.frame === 0 && j.direction === 0));
  const bake = bakeSprites(px, jobs, byKey, { style, pack: { size: 1024 } });
  const g = sheet.getContext("2d")!;
  const cellW = 48, cellH = 72, cols = 9, S = 3;
  sheet.width = cols * cellW * S; sheet.height = all.length * cellH * S;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#2a2d38"; g.fillRect(0, 0, sheet.width, sheet.height);
  const pages = bake.pages.map((p) => { const c = new OffscreenCanvas(p.width, p.height); c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.width, p.height), 0, 0); return c; });
  all.forEach((d, row) => {
    const keys = [...jobs.filter((j) => j.design === d.key && j.clip === "idle"), ...jobs.filter((j) => j.design === d.key && j.clip === "walk")];
    keys.forEach((j, col) => {
      const r = bake.sprites.get(j.key)!;
      // Anchor at the cell's ground point: a dot marks it.
      const gx = (col * cellW + cellW / 2) * S, gy = (row * cellH + cellH - 8) * S;
      g.drawImage(pages[r.page]!, r.x, r.y, r.w, r.h, gx - r.ax * S, gy - r.ay * S, r.w * S, r.h * S);
      g.fillStyle = "#ff3b3b"; g.fillRect(gx - 1, gy - 1, 3, 3);
    });
  });
  return { rows, compileMs };
}

(globalThis as { bakeBench?: typeof bakeBench }).bakeBench = bakeBench;
