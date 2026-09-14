// Colours -> ROLES. A model's cells play roles (primary, secondary, trim,
// accent, skin, dark, glow), never colours, so any look recolours an import
// as it recolours any engine asset -- and the colours it came with are kept
// as a look preset ("source").
//
//   clusters  weighted k-means in OKLab over the surface cells' colours
//             (a flat material is one heavy sample; textured and vertex-
//             coloured cells each their own), k = 1..8 chosen as the smallest
//             whose error is under `tolerance` (or that stops paying); the
//             first centre the heaviest colour, then farthest-first --
//             deterministic, no randomness
//   names     emissive -> glow; the darkest (L < 0.3) -> dark; on a creature,
//             a skin/fur tone on its exposed body -> skin; then by coverage
//             primary, secondary; the rest trim (pale or grey: metal, bone,
//             rope) or accent (the most chromatic small one); beyond seven
//             roles, "<role>-2"...
//
//   const r = clusterRoles(grid, { creature: true });
//   r.roleOf[cell]; r.look.colours.primary   // [L, C, h]

import { labDistance, linearToOklab, oklabToOklch } from "./color.ts";
import type { Lab } from "./color.ts";
import type { VoxelGrid } from "./voxelize.ts";

export type Oklch = [number, number, number];

export interface RoleCluster {
  readonly role: string;
  /** Its colour (OKLab centre) and as OKLCH [L, C, hue]. */
  readonly lab: Lab;
  readonly oklch: Oklch;
  /** Share of the surface it covers. */
  readonly share: number;
  /** Source materials it holds most of. */
  readonly materials: readonly string[];
  readonly why: string;
}

export interface Roles {
  readonly clusters: readonly RoleCluster[];
  /** Per cell: the role index into `clusters` (-1 empty). */
  readonly roleOf: Int16Array;
  /** k tried -> error (RMS OKLab distance to the centre). */
  readonly errors: Readonly<Record<number, number>>;
  readonly k: number;
  readonly error: number;
  /** The colours it came with, as a look preset. */
  readonly look: { readonly name: "source"; readonly colours: Readonly<Record<string, Oklch>> };
}

export interface RoleOptions {
  /** Most clusters (default 7: the standard roles). */
  readonly maxK?: number;
  /** An RMS OKLab error that's good enough (default 0.045). */
  readonly tolerance?: number;
  /** A creature: a skin/fur tone on its exposed body plays "skin". */
  readonly creature?: boolean;
  /** Cells that are the body's exposed skin (for the skin test), when known. */
  readonly bodyCells?: (cell: number) => boolean;
}

interface Sample { lab: Lab; w: number; mat: number; glow: boolean }

function kmeans(samples: readonly Sample[], k: number): { centres: Lab[]; assign: Int32Array; error: number } {
  const n = samples.length;
  const total = samples.reduce((s, x) => s + x.w, 0) || 1;
  // (Farthest-first from the heaviest: deterministic, and a small bright accent gets its own centre.)
  const centres: Lab[] = [];
  let first = 0;
  for (let i = 1; i < n; i += 1) if (samples[i]!.w > samples[first]!.w) first = i;
  centres.push([...samples[first]!.lab]);
  const d2 = new Float64Array(n).fill(Infinity);
  while (centres.length < k) {
    const c = centres[centres.length - 1]!;
    let bi = -1, bs = -1;
    for (let i = 0; i < n; i += 1) {
      const s = samples[i]!;
      d2[i] = Math.min(d2[i]!, labDistance(s.lab, c) ** 2);
      // (Weighted a little by coverage: a far colour covering a lot beats a far speck.)
      const score = d2[i]! * Math.sqrt(s.w);
      if (score > bs) { bs = score; bi = i; }
    }
    if (bi < 0 || d2[bi]! < 1e-10) break;
    centres.push([...samples[bi]!.lab]);
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < 30; it += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      let best = 0, bd = Infinity;
      centres.forEach((c, j) => { const d = labDistance(samples[i]!.lab, c); if (d < bd) { bd = d; best = j; } });
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const acc = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i += 1) { const a = acc[assign[i]!]!, s = samples[i]!; a[0]! += s.lab[0] * s.w; a[1]! += s.lab[1] * s.w; a[2]! += s.lab[2] * s.w; a[3]! += s.w; }
    acc.forEach((a, j) => { if (a[3]! > 0) centres[j] = [a[0]! / a[3]!, a[1]! / a[3]!, a[2]! / a[3]!]; });
    if (!moved && it > 0) break;
  }
  let err = 0;
  for (let i = 0; i < n; i += 1) err += samples[i]!.w * labDistance(samples[i]!.lab, centres[assign[i]!]!) ** 2;
  return { centres, assign, error: Math.sqrt(err / total) };
}

const isSkinTone = ([L, C, h]: Oklch): boolean => L > 0.45 && L < 0.92 && C > 0.02 && C < 0.16 && h > 20 && h < 90;

/** Cluster a grid's colours into roles (see the top). */
export function clusterRoles(grid: VoxelGrid, opts: RoleOptions = {}): Roles {
  const n = grid.occ.length;
  // Samples: surface cells, pooled by (material, quantised colour) so a flat material is one heavy sample.
  const pool = new Map<string, Sample>();
  const keyOf = new Map<number, string>();
  const labOf = (i: number): Lab => linearToOklab(Math.max(0, grid.colour[i * 3]!), Math.max(0, grid.colour[i * 3 + 1]!), Math.max(0, grid.colour[i * 3 + 2]!));
  for (let i = 0; i < n; i += 1) {
    if (grid.occ[i] !== 1) continue;
    const lab = labOf(i);
    const q = (v: number): number => Math.round(v * 200);
    const key = `${grid.material[i]}|${q(lab[0])},${q(lab[1])},${q(lab[2])}`;
    keyOf.set(i, key);
    const s = pool.get(key);
    if (s) s.w += 1;
    else pool.set(key, { lab, w: 1, mat: grid.material[i]!, glow: grid.emissive.has(grid.material[i]!) });
  }
  const samples = [...pool.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, s]) => s);
  if (!samples.length) throw new RangeError("roles: no surface cells to read colours from");
  const maxK = Math.min(opts.maxK ?? 7, samples.length);
  const tol = opts.tolerance ?? 0.045;
  const errors: Record<number, number> = {};
  let chosen = kmeans(samples, 1);
  errors[1] = chosen.error;
  for (let k = 2; k <= maxK; k += 1) {
    if (chosen.error <= tol) break;
    const next = kmeans(samples, k);
    errors[k] = next.error;
    // (Stop when another cluster barely helps: under a tenth off the error.)
    if (next.centres.length < k || next.error > chosen.error * 0.9) { if (next.error < chosen.error) chosen = next; break; }
    chosen = next;
  }
  // (A colour far from its centre is worth a role of its own even when it barely moves the error: a small speck --
  // eyes, a gem -- when it's plainly another colour, a whole material -- steel next to skin -- when it's visibly one.)
  const total0 = samples.reduce((s, x) => s + x.w, 0);
  // Materials that are (nearly) one colour: their mean and spread. A texture's planks and grain spread wide.
  const matStats = new Map<number, { lab: Lab; w: number; spread: number }>();
  for (const s of samples) {
    const m = matStats.get(s.mat) ?? { lab: [0, 0, 0] as Lab, w: 0, spread: 0 };
    m.lab = [m.lab[0] + s.lab[0] * s.w, m.lab[1] + s.lab[1] * s.w, m.lab[2] + s.lab[2] * s.w];
    m.w += s.w;
    matStats.set(s.mat, m);
  }
  for (const m of matStats.values()) m.lab = [m.lab[0] / m.w, m.lab[1] / m.w, m.lab[2] / m.w];
  for (const s of samples) { const m = matStats.get(s.mat)!; m.spread += (s.w * labDistance(s.lab, m.lab) ** 2); }
  for (const m of matStats.values()) m.spread = Math.sqrt(m.spread / m.w);
  const flat = [...matStats.entries()].filter(([, m]) => m.spread < 0.03 && m.w >= total0 * 0.004);
  const outlier = (c: ReturnType<typeof kmeans>): boolean => {
    if (samples.some((s, i) => s.w >= total0 * 0.0008 && labDistance(s.lab, c.centres[c.assign[i]!]!) > 0.14)) return true;
    // (Two visible flat materials in one cluster that are plainly different colours: steel and skin. A texture's own
    // shades -- planks and grain -- are one material's, and don't count.)
    const home = (lab: Lab): number => { let best = 0, bd = Infinity; c.centres.forEach((q, j) => { const d = labDistance(lab, q); if (d < bd) { bd = d; best = j; } }); return best; };
    const homes = flat.map(([, m]) => home(m.lab));
    for (let a = 0; a < flat.length; a += 1) for (let b = a + 1; b < flat.length; b += 1) {
      if (homes[a] === homes[b] && labDistance(flat[a]![1].lab, flat[b]![1].lab) > 0.085) return true;
    }
    return false;
  };
  while (chosen.centres.length < maxK && outlier(chosen)) {
    const next = kmeans(samples, chosen.centres.length + 1);
    if (next.centres.length <= chosen.centres.length) break;
    errors[next.centres.length] = next.error;
    chosen = next;
  }
  const { centres, assign } = chosen;
  const k = centres.length;
  const total = samples.reduce((s, x) => s + x.w, 0);
  const weight = new Array<number>(k).fill(0), glowW = new Array<number>(k).fill(0), skinW = new Array<number>(k).fill(0);
  const mats: Array<Map<number, number>> = centres.map(() => new Map());
  samples.forEach((s, i) => { const c = assign[i]!; weight[c]! += s.w; if (s.glow) glowW[c]! += s.w; const m = mats[c]!; m.set(s.mat, (m.get(s.mat) ?? 0) + s.w); });
  const sampleIndex = new Map(samples.map((s, i) => [s, i]));
  if (opts.bodyCells) for (let i = 0; i < n; i += 1) {
    const key = keyOf.get(i);
    if (key === undefined || !opts.bodyCells(i)) continue;
    const si = sampleIndex.get(pool.get(key)!);
    if (si !== undefined) skinW[assign[si]!]! += 1;
  }
  // Names.
  const lch = centres.map((c) => oklabToOklch(c) as Oklch);
  const names = new Array<string>(k).fill("");
  const why = new Array<string>(k).fill("");
  const free = new Set<number>(centres.map((_c, i) => i));
  const take = (i: number, role: string, reason: string): void => { names[i] = role; why[i] = reason; free.delete(i); };
  for (const i of [...free]) if (glowW[i]! > weight[i]! * 0.5) { take(i, "glow", "emissive material"); break; }
  {
    const darks = [...free].filter((i) => lch[i]![0] < 0.3).sort((a, b) => lch[a]![0] - lch[b]![0]);
    if (darks.length) take(darks[0]!, "dark", `L ${lch[darks[0]!]![0].toFixed(2)}`);
  }
  if (opts.creature) {
    const cand = [...free].filter((i) => isSkinTone(lch[i]!)).sort((a, b) => (skinW[b]! - skinW[a]!) || (weight[b]! - weight[a]!));
    if (cand.length && (!opts.bodyCells || skinW[cand[0]!]! > 0)) take(cand[0]!, "skin", `a skin or fur tone${opts.bodyCells ? " on the body" : ""} (L ${lch[cand[0]!]![0].toFixed(2)}, C ${lch[cand[0]!]![1].toFixed(2)}, h ${Math.round(lch[cand[0]!]![2])})`);
  }
  const byWeight = [...free].sort((a, b) => weight[b]! - weight[a]! || a - b);
  if (byWeight[0] !== undefined) take(byWeight[0], "primary", "covers the most");
  if (byWeight[1] !== undefined) take(byWeight[1], "secondary", "covers the next most");
  const rest = [...free].sort((a, b) => weight[b]! - weight[a]! || a - b);
  const order = ["trim", "accent", "dark", "skin", "glow", "secondary"];
  const used = new Set(names.filter(Boolean));
  for (const i of rest) {
    const [L, C] = lch[i]!;
    const want = C > 0.12 ? "accent" : L > 0.7 || C < 0.04 ? "trim" : "trim";
    let role = !used.has(want) ? want : order.find((r) => !used.has(r) && r !== "glow" && r !== "skin" && r !== "dark");
    if (!role) { const base = want; let m = 2; while (used.has(`${base}-${m}`)) m += 1; role = `${base}-${m}`; }
    used.add(role);
    take(i, role, C > 0.12 ? `chromatic (C ${C.toFixed(2)})` : L > 0.7 ? `pale (L ${L.toFixed(2)})` : `grey or muted (C ${C.toFixed(2)})`);
  }
  // Every cell to its nearest centre (interior cells too).
  const roleOf = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    if (!grid.occ[i]) continue;
    const key = keyOf.get(i);
    const s = key !== undefined ? pool.get(key) : undefined;
    if (s) { roleOf[i] = assign[sampleIndex.get(s)!]!; continue; }
    const lab = labOf(i);
    let best = 0, bd = Infinity;
    centres.forEach((c, j) => { const d = labDistance(lab, c); if (d < bd) { bd = d; best = j; } });
    roleOf[i] = best;
  }
  const clusters: RoleCluster[] = centres.map((c, i) => ({
    role: names[i]!, lab: c, oklch: [+lch[i]![0].toFixed(3), +lch[i]![1].toFixed(3), +lch[i]![2].toFixed(1)], share: +(weight[i]! / total).toFixed(4),
    materials: [...mats[i]!.entries()].sort((a, b) => b[1] - a[1]).filter(([m]) => m >= 0).slice(0, 3).map(([m]) => grid.materialNames[m] ?? `material ${m}`), why: why[i]!,
  }));
  return { clusters, roleOf, errors, k, error: chosen.error, look: { name: "source", colours: Object.fromEntries(clusters.map((c) => [c.role, c.oklch])) } };
}
