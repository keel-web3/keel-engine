// A creature in the terminal: its sprite at the game's view (or any scale, pitch
// and direction) as text, one character per texel by the role its slot wears --
//   o fur   + furAlt   # accent (team)   . dark   @ eye   c cloth   C clothAlt   s skin
//
//   node packs/creatures/tools/preview.ts crawler 7 [size=1.6] [k=12] [pitch=55] [dir=0] [clip=idle] [frame=0] [legs=8 ...pins]

import { bodyShape, softMask } from "@keel-engine/bake";
import { CREATURE_PLANS, creatureOf } from "../src/index.ts";
import type { CreaturePlan } from "../src/index.ts";

const [plan = "crawler", seed = "7", ...rest] = process.argv.slice(2);
const opt: Record<string, string> = Object.fromEntries(rest.map((a) => a.split("=") as [string, string]));
const num = (k: string, d: number): number => (opt[k] !== undefined ? Number(opt[k]) : d);
const known = new Set(["size", "k", "pitch", "dir", "clip", "frame", "dirs"]);
const pins: Record<string, unknown> = {};
for (const [k, x] of Object.entries(opt)) if (!known.has(k)) pins[k] = Number.isFinite(Number(x)) ? Number(x) : x;
if (!(CREATURE_PLANS as readonly string[]).includes(plan)) throw new Error(`plans: ${CREATURE_PLANS.join(", ")}`);
const c = creatureOf(seed, plan as CreaturePlan, { size: num("size", 1.6), pins });
const body = bodyShape(c.spec, { pack: "packs/creatures", clips: [{ name: "idle", frames: 4 }, { name: "walk", frames: 6 }, { name: "attack", frames: 8 }], skin: (s) => c.skin(s), sockets: c.sockets });
const m = softMask(body, opt["clip"] ?? "idle", num("frame", 0), { pixelsPerMetre: num("k", 12), pitch: (num("pitch", 55) * Math.PI) / 180, direction: num("dir", 0), directions: num("dirs", 8) });
const roles = body.slotRoles();
const CH: Record<string, string> = { fur: "o", furAlt: "+", accent: "#", dark: ".", eye: "@", cloth: "c", clothAlt: "C", skin: "s" };
const count: Record<string, number> = {};
let solid = 0;
const lines: string[] = [];
for (let y = 0; y < m.h; y += 1) {
  let line = "";
  for (let x = 0; x < m.w; x += 1) {
    const s = m.slots[y * m.w + x]!;
    if (!s) { line += " "; continue; }
    const r = roles[s - 1] ?? "?";
    count[r] = (count[r] ?? 0) + 1; solid += 1;
    line += CH[r] ?? "?";
  }
  lines.push(line.replace(/\s+$/, ""));
}
console.log(lines.join("\n"));
console.log(`${plan} ${seed} size ${num("size", 1.6)}: ${m.w}x${m.h}, height ${c.height.toFixed(2)} m, ${JSON.stringify(c.pins)}`);
console.log(Object.entries(count).map(([r, n]) => `${r} ${((n / solid) * 100).toFixed(1)}%`).join("  "));
