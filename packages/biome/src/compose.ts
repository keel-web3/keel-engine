// A biome as a stage: its land as one keel/tiles surface, 3D ground shells and
// sprite cover over that, real plants and vines on it, water where the land
// falls under the level; all of it reading one spring field, so what walks,
// lands or blows through moves the ground, the grass, the bushes and the
// water alike. Everything comes from the seed.

import { Color, Group, LitMaterial, Mesh, plane } from "@keel-engine/lit";
import { FLORA_MOTION_HEAD, PLANTS, createFloraField, createFloraMotion, createGroundShells, createPlantField, createVineField, crawl, hash3, paintFoliageAtlas, pickWeighted, scatter } from "@keel-engine/flora";
import type { FloraBody, FloraField, FloraImpact, FloraKind, FloraMotion, GroundShells, PlantField, PlantPlacement, ShellLook, V3, VineField } from "@keel-engine/flora";
import { createTileGrid, createTileSurface } from "@keel-engine/tiles";
import type { TileSurface } from "@keel-engine/tiles";
import { BIOMES } from "./biomes.ts";
import type { BiomeSpec, GroundRule } from "./biomes.ts";
import { fbm, reliefHeight } from "./relief.ts";

export interface BiomeOptions {
  /** Metres on a side. */
  readonly size?: number;
  /** Ground cell, metres. */
  readonly cell?: number;
  readonly seed?: number;
  /** How rich each plant is at every distance (1: the catalogue's own). */
  readonly detail?: number;
  /** Plants per area against the biome's own: a background can take fewer. */
  readonly thick?: number;
  /** Scales how far each plant keeps its detail. */
  readonly reach?: number;
  /** Ground shells (0: none). */
  readonly layers?: number;
  readonly shadows?: boolean;
  /** How tall a tree of this species and scale stands, for hanging plants on (default 9 m at scale 1). */
  readonly treeHeight?: (place: TreePlace) => number;
}

export interface TreePlace { readonly species: string; readonly x: number; readonly y: number; readonly z: number; readonly scale: number; readonly yaw: number }

export interface Biome {
  readonly spec: BiomeSpec;
  readonly root: Group;
  readonly motion: FloraMotion;
  readonly surface: TileSurface;
  readonly plants: PlantField;
  readonly shells: GroundShells | null;
  /** Where its trees stand, by species: grow them with keel tree-growth and draw them with tree-render's createForest. */
  readonly trees: readonly TreePlace[];
  /** What is drawn from the current view. */
  readonly stats: { readonly plants: number; readonly cards: number; readonly triangles: number; readonly draws: number; readonly levels: readonly [number, number, number] };
  heightAt(x: number, z: number): number;
  /** Advances the wind and springs. Wind defaults to the biome's own. */
  update(input: { readonly time: number; readonly dt: number; readonly wind?: number; readonly direction?: number; readonly bodies?: readonly FloraBody[]; readonly view?: readonly [number, number, number] }): void;
  impact(blow: FloraImpact): void;
  dispose(): void;
}

const pick = <T>(list: readonly T[] | undefined, roll: number): T | undefined => (list === undefined ? undefined : list[Math.floor(roll * list.length) % list.length]);
const hash = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i += 1) h = Math.imul(h, 31) + s.charCodeAt(i) | 0; return h >>> 0; };

const WATER_HEAD = /* glsl */ `
uniform vec4 uFloraWind;
varying vec2 vWaterAt;
${FLORA_MOTION_HEAD}
`;
const WATER_NORMAL = /* glsl */ `#include <normal_fragment_maps>
  {
    float t = uFloraWind.w;
    vec2 p = vWaterAt;
    vec2 ripple = vec2(cos(p.x * 2.1 + t * 1.2 + sin(p.y * 1.3)), cos(p.y * 2.7 - t * 0.9 + sin(p.x * 1.7))) * (0.03 + 0.05 * uFloraWind.x);
    vec3 moved = floraField(p);
    ripple += moved.xy * 0.8 + vec2(sin(p.y * 5.0 + t * 2.0), cos(p.x * 4.0 - t * 2.3)) * 0.02;
    normal = normalize(mat3(viewMatrix) * vec3(ripple.x, 1.0, ripple.y));
  }`;

/** What a plot's ground is, which decides what can root in it. */
export type PlotSoil = "soil" | "sand" | "stone" | "gem" | "ice" | "fire" | "unreal";

/** How much of each kind of plant each ground takes, against the biome's own. A plot is grass and small things; bushes are a rare accent. */
const PLOT_SOILS: Readonly<Record<PlotSoil, Readonly<Record<string, number>>>> = {
  soil: { grass: 1, flower: 1, understory: 0.6, fungus: 0.7, wetland: 0.5, desert: 0.5, bush: 0.05 },
  sand: { desert: 1, grass: 0.4, flower: 0.15 },
  stone: { grass: 0.3, understory: 0.2, fungus: 0.4, flower: 0.15, desert: 0.3 },
  gem: { grass: 0.12, flower: 0.08 },
  ice: { grass: 0.08 },
  fire: {},
  unreal: { flower: 0.15, grass: 0.15 },
};

/** Planter looks by what they are made of. */
export const PLANTER_SOILS: Readonly<Record<string, PlotSoil>> = {
  earth: "soil", goldOre: "stone", marble: "stone", granite: "stone", obsidian: "stone", sandstone: "sand", jade: "gem", gold: "gem", emerald: "gem", ruby: "gem", sapphire: "gem", amethyst: "gem", glitter: "gem", chrome: "gem",
  ice: "ice", lava: "fire", cyber: "unreal", vapor: "unreal", antigravity: "unreal", hologram: "unreal", cosmic: "unreal",
};

/** The most bushes on one plot, whatever the biome. */
const PLOT_BUSHES = 2;

export interface BiomePlotOptions {
  /** The plot's rectangle: min x, min z, max x, max z. */
  readonly bounds: readonly [number, number, number, number];
  /** Whether a point is on the plot. */
  readonly inside: (x: number, z: number) => boolean;
  /** The plot's ground height. */
  readonly height: number;
  /** What the plot is made of (default soil): `PLANTER_SOILS` names it for a grove planter. */
  readonly soil?: PlotSoil;
  /** Plants' size against life size (a planter is a miniature). */
  readonly scale?: number;
  /** Plants per area against the biome's own. */
  readonly thick?: number;
  readonly seed?: number;
  readonly detail?: number;
}

export interface BiomePlot {
  readonly root: Group;
  readonly motion: FloraMotion;
  readonly stats: { readonly plants: number; readonly triangles: number };
  update(input: { readonly time: number; readonly dt: number; readonly wind?: number; readonly direction?: number; readonly bodies?: readonly FloraBody[]; readonly view?: readonly [number, number, number] }): void;
  dispose(): void;
}

/** A biome's small plants on someone else's ground: a planter, a garden bed, a window box. */
export function createBiomePlot(input: string | BiomeSpec, options: BiomePlotOptions): BiomePlot {
  const spec = typeof input === "string" ? BIOMES[input] : input;
  if (spec === undefined) throw new Error(`Unknown biome ${String(input)}.`);
  const { bounds, inside, height } = options;
  const scale = options.scale ?? 0.5, thick = options.thick ?? 3, seed = options.seed ?? 1;
  const motion = createFloraMotion({ bounds, cells: 48 });
  const list: PlantPlacement[] = [];
  const takes = PLOT_SOILS[options.soil ?? "soil"];
  let bushes = 0;
  spec.plants.forEach((rule, index) => {
    const group = PLANTS[rule.kind]?.group ?? "";
    const share = takes[group] ?? 0;
    if (share <= 0 || rule.hangFrom || rule.size[1] > 2.4 || rule.water === "float" || rule.water === "in") return;
    for (const p of scatter({ bounds, spacing: Math.sqrt(100 / (rule.per100 * thick * share)), seed: (seed + hash(rule.kind) + index) >>> 0, limit: 400, density: (x, z) => (inside(x, z) ? 1 : 0) })) {
      if (group === "bush" && (bushes += 1) > PLOT_BUSHES) break;
      const bloom = pick(rule.blooms, p.roll2);
      list.push({ kind: rule.kind, x: p.x, y: height - 0.01, z: p.z, size: (rule.size[0] + (rule.size[1] - rule.size[0]) * p.roll2) * scale, yaw: p.roll * 6.283, variant: Math.floor(p.roll2 * 7), tint: pick(rule.tints, p.roll) ?? "#5f8f3e", ...(bloom ? { bloom } : {}) });
    }
  });
  const plants = createPlantField({ motion, seed, variants: 2, shadows: false, ...(options.detail === undefined ? {} : { detail: options.detail }) }, list);
  motion.setWind(spec.wind, 0.6);
  return {
    root: plants.root, motion,
    get stats() { return { plants: list.length, triangles: Math.round(plants.triangles) }; },
    update({ time, dt, wind, direction, bodies, view }) {
      motion.setTime(time);
      motion.setWind(wind ?? spec.wind, direction ?? 0.6);
      if (bodies) motion.setBodies(bodies);
      motion.step(dt);
      if (view) plants.setView(view[0], view[1], view[2]);
    },
    dispose() {
      plants.dispose();
      motion.dispose();
    },
  };
}

export function createBiome(input: string | BiomeSpec, options: BiomeOptions = {}): Biome {
  const spec = typeof input === "string" ? BIOMES[input] : input;
  if (spec === undefined) throw new Error(`Unknown biome ${String(input)}.`);
  const size = options.size ?? 48, cell = options.cell ?? 0.5, seed = options.seed ?? 1, detail = options.detail ?? 1, thick = options.thick ?? 1, shadows = options.shadows ?? true;
  const side = Math.ceil(size / cell), half = (side * cell) / 2;
  const origin: [number, number] = [-half, -half];
  const level = spec.water?.level ?? -Infinity;

  const heights = new Float32Array((side + 1) * (side + 1));
  for (let j = 0; j <= side; j += 1) for (let i = 0; i <= side; i += 1) heights[j * (side + 1) + i] = reliefHeight(spec.relief, origin[0] + i * cell, origin[1] + j * cell, seed);
  const heightAt = (x: number, z: number): number => {
    const u = Math.max(0, Math.min(side - 1e-3, (x - origin[0]) / cell)), v = Math.max(0, Math.min(side - 1e-3, (z - origin[1]) / cell));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * (side + 1) + i;
    return (heights[k]! * (1 - fu) + heights[k + 1]! * fu) * (1 - fv) + (heights[k + side + 1]! * (1 - fu) + heights[k + side + 2]! * fu) * fv;
  };
  const slopeAt = (x: number, z: number): number => Math.hypot(heightAt(x + cell, z) - heightAt(x - cell, z), heightAt(x, z + cell) - heightAt(x, z - cell)) / (2 * cell);
  const normalAt = (x: number, z: number): V3 => {
    const a = heightAt(x + cell, z) - heightAt(x - cell, z), b = heightAt(x, z + cell) - heightAt(x, z - cell), l = Math.hypot(a, 2 * cell, b);
    return [-a / l, (2 * cell) / l, -b / l];
  };

  const holds = (rule: GroundRule | undefined, x: number, z: number, layer: number): boolean => {
    if (rule === undefined) return true;
    const y = heightAt(x, z);
    if (rule.height && (y < rule.height[0] || y > rule.height[1])) return false;
    if (rule.shore && (y - level < rule.shore[0] || y - level > rule.shore[1])) return false;
    if (rule.slope) { const s = slopeAt(x, z); if (s < rule.slope[0] || s > rule.slope[1]) return false; }
    if (rule.patches && fbm(x / rule.patches[0], z / rule.patches[0], seed + layer * 53 + 11, 3) < 0.72 - rule.patches[1] * 0.44) return false;
    return true;
  };

  const names = spec.ground.map((l) => l.name);
  const grid = createTileGrid({ width: side, depth: side, materials: names, fill: names[0]! });
  spec.ground.forEach((layer, i) => {
    if (i > 0) grid.paint(layer.name, (cx, cz) => holds(layer.when, origin[0] + (cx + 0.5) * cell, origin[1] + (cz + 0.5) * cell, i));
  });
  const surface = createTileSurface(grid, {
    cell, origin, texels: 8, height: heights,
    materials: Object.fromEntries(spec.ground.map((l) => [l.name, { ramp: l.ramp, pattern: l.pattern ?? "noise", scale: l.scale ?? 1.4, rough: 0.34, shadow: 0 }])),
  });
  const root = new Group();
  root.name = `keel-biome-${spec.id}`;
  root.add(surface.mesh);
  const motion = createFloraMotion({ bounds: [-half, -half, half, half], cells: Math.min(128, Math.round(size * 2)) });

  let shells: GroundShells | null = null;
  const layers = options.layers ?? 12;
  const looks = spec.ground.map((l): ShellLook | null => (l.shell ? { ...l.shell, low: l.ramp[0], high: l.ramp[3] } : null));
  if (layers > 0 && looks.some((l) => l !== null)) {
    shells = createGroundShells({ geometry: surface.mesh.geometry, motion, cells: grid.cells, width: side, depth: side, cell, origin, looks, layers, height: spec.depth ?? 0.12, far: Math.max(30, size * 0.8) });
    root.add(shells.mesh);
  }

  const materialAt = (x: number, z: number): string | null => surface.materialAt(x, z);
  const placements: PlantPlacement[] = [];
  const rocks: { x: number; y: number; z: number; r: number }[] = [];
  const boughs: { x: number; y: number; z: number; reach: number }[] = [];
  const trees: TreePlace[] = [];
  for (const rule of spec.trees ?? []) {
    const points = scatter({ bounds: [-half, -half, half, half], spacing: Math.sqrt(100 / rule.per100), seed: (seed + hash(rule.species)) >>> 0, density: (x, z) => (heightAt(x, z) > level + 0.05 && slopeAt(x, z) < 0.7 && (!rule.on || rule.on.includes(materialAt(x, z) ?? "")) ? 1 : 0) });
    for (const p of points) {
      const place = { species: rule.species, x: p.x, y: heightAt(p.x, p.z) - 0.05, z: p.z, scale: 0.7 + p.roll2 * 0.5, yaw: p.roll * 6.283 };
      trees.push(place);
      const tall = options.treeHeight?.(place) ?? 9 * place.scale;
      boughs.push({ x: p.x, y: place.y + tall * 0.62, z: p.z, reach: tall * 0.26 });
    }
  }

  spec.plants.forEach((rule, index) => {
    const spacing = Math.sqrt(100 / (rule.per100 * thick));
    const mode = rule.water ?? "dry";
    const standAt = rule.stand;
    if (rule.hangFrom && !rule.on) {
      // Off the boughs: a few round each crown, however many the rule asks for overall.
      const each = Math.max(1, Math.round((rule.per100 * thick * size * size) / 100 / Math.max(1, boughs.length)));
      boughs.forEach((bough, b) => {
        for (let i = 0; i < each; i += 1) {
          const a = hash3(b, i, seed + index + 101) * 6.283, q = bough.reach * Math.sqrt(hash3(b, i, seed + index + 211)), roll = hash3(b, i, seed + index + 307);
          const x = bough.x + Math.cos(a) * q, z = bough.z + Math.sin(a) * q;
          placements.push({ kind: rule.kind, x, y: bough.y, z, size: Math.min(bough.y - heightAt(x, z) - 0.2, rule.size[0] + (rule.size[1] - rule.size[0]) * roll), yaw: a, variant: i, tint: pick(rule.tints, roll) ?? "#5f8f3e", ...(pick(rule.blooms, roll) ? { bloom: pick(rule.blooms, roll)! } : {}) });
        }
      });
      return;
    }
    const points = scatter({
      bounds: [-half, -half, half, half], spacing, seed: (seed + hash(rule.kind) + index) >>> 0, limit: 6000,
      density: (x, z) => {
        const y = heightAt(x, z), gap = y - level;
        if (spec.water) {
          if (mode === "dry" && gap < 0.02) return 0;
          if (mode === "shore" && (gap < -0.22 || gap > 0.42)) return 0;
          if ((mode === "float" || mode === "in") && gap > -0.03) return 0;
        }
        if (slopeAt(x, z) > (rule.slope ?? 0.9)) return 0;
        if (rule.height && (y < rule.height[0] || y > rule.height[1])) return 0;
        if (rule.on && !rule.on.includes(materialAt(x, z) ?? "")) return 0;
        return standAt ? Math.max(0, (fbm(x / standAt, z / standAt, seed + index * 31, 2) - 0.42) * 7) : 1;
      },
    });
    for (const p of points) {
      const ground = heightAt(p.x, p.z);
      const s = rule.size[0] + (rule.size[1] - rule.size[0]) * p.roll2;
      const tint = pick(rule.tints, p.roll) ?? "#5f8f3e";
      const bloom = pick(rule.blooms, p.roll2);
      const y = mode === "float" ? level + 0.012 : rule.hangFrom ? ground + rule.hangFrom + s * 0.1 : ground - 0.02;
      const n = normalAt(p.x, p.z);
      placements.push({ kind: rule.kind, x: p.x, y, z: p.z, size: s, yaw: p.roll * 6.283, variant: Math.floor(p.roll2 * 7), tilt: mode === "float" || rule.hangFrom ? 0 : Math.acos(Math.min(1, n[1])) * 0.3, tint, ...(rule.wide ? { wide: rule.wide } : {}), ...(bloom ? { bloom } : {}) });
      if (rule.bears) boughs.push({ x: p.x, y: ground + s * 0.7, z: p.z, reach: s * 0.3 });
      if (spec.vines?.on === rule.kind) rocks.push({ x: p.x, y: ground + s * 0.3, z: p.z, r: s * 0.62 });
    }
  });
  const plants = createPlantField({ motion, detail, seed, shadows, variants: 3, ...(options.reach === undefined ? {} : { reach: options.reach }) }, placements);
  root.add(plants.root);

  let cards: FloraField | null = null;
  let cardCount = 0;
  const cover = spec.cover;
  if (cover) {
    const points = scatter({ bounds: [-half, -half, half, half], spacing: 1 / Math.sqrt(cover.per1 * thick), seed: seed ^ 0x51ed, limit: 12000, density: (x, z) => (cover.on.includes(materialAt(x, z) ?? "") && heightAt(x, z) > level + 0.02 ? 1 : 0) });
    const kinds = Object.keys(cover.kinds) as FloraKind[];
    const list = points.map((p) => ({ x: p.x, y: heightAt(p.x, p.z) - 0.01, z: p.z, kind: (pickWeighted(cover.kinds, p.roll) ?? kinds[0]!) as FloraKind, variant: Math.floor(p.roll2 * 4), scale: cover.size[0] + (cover.size[1] - cover.size[0]) * p.roll2, yaw: p.roll2 * 6.28, tint: pick(cover.tints, p.roll)!, bloom: pick(cover.blooms, p.roll2) ?? pick(cover.tints, p.roll)!, ground: normalAt(p.x, p.z) }));
    cards = createFloraField({ atlas: paintFoliageAtlas({ kinds, seed: seed + 3, variants: 4 }), motion, style: "both", lod: { near: 7, band: 0.8 }, thin: { from: 14, to: 48, keep: 0.25 }, planes: 2, normals: "ground", capacity: Math.max(1, list.length) }, list);
    cardCount = list.length;
    root.add(cards.root);
  }

  let vines: VineField | null = null;
  if (spec.vines && rocks.length > 0) {
    const paths: V3[][] = [];
    rocks.slice(0, Math.ceil(spec.vines.per100 * (size * size) / 100)).forEach((rock, i) => {
      const round = (x: number, y: number, z: number): number => Math.hypot(x - rock.x, y - rock.y, z - rock.z) - rock.r;
      for (let k = 0; k < 3; k += 1) {
        const a = i * 1.7 + k * 2.1;
        paths.push(crawl(round, { start: [rock.x + Math.cos(a) * rock.r, heightAt(rock.x, rock.z), rock.z + Math.sin(a) * rock.r], steps: Math.ceil(rock.r * 28), step: 0.07, seed: seed + i * 13 + k, gap: 0.03 }));
      }
    });
    vines = createVineField({ motion, paths, tint: spec.vines.tint, ...(spec.vines.bloom ? { bloom: spec.vines.bloom, blooms: 0.2 } : {}), seed });
    root.add(vines.root);
  }

  let water: Mesh | null = null;
  if (spec.water) {
    const material = new LitMaterial({ color: new Color(spec.water.color), roughness: 0.16, metalness: 0.05, transparent: true, opacity: spec.water.clarity === undefined ? 0.8 : 1 - spec.water.clarity * 0.4 });
    material.onCompile = (shader) => {
      Object.assign(shader.uniforms, motion.uniforms);
      shader.vertexShader = `varying vec2 vWaterAt;\n${shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vWaterAt = (modelMatrix * vec4(position, 1.0)).xz;")}`;
      shader.fragmentShader = WATER_HEAD + shader.fragmentShader.replace("#include <normal_fragment_maps>", WATER_NORMAL);
    };
    material.customProgramCacheKey = () => "keel-biome-water";
    material.userData.voxelDitherKeep = true;
    water = new Mesh(plane(size, size), material);
    water.rotation.x = -Math.PI / 2;
    water.position.y = level;
    water.receiveShadow = true;
    root.add(water);
  }

  const shell = shells === null ? 0 : ((surface.mesh.geometry.index?.count ?? 0) / 3) * layers;
  motion.setWind(spec.wind, 0.6);
  return {
    spec, root, motion, surface, plants, shells, trees,
    get stats() { return { plants: placements.length, cards: cardCount, triangles: Math.round(plants.triangles + shell), draws: plants.meshes.length + 1 + (shells ? 1 : 0) + (cards ? 1 : 0) + (vines ? 1 : 0) + (water ? 1 : 0), levels: plants.levels }; },
    heightAt,
    update({ time, dt, wind, direction, bodies, view }) {
      motion.setTime(time);
      motion.setWind(wind ?? spec.wind, direction ?? 0.6);
      if (bodies) motion.setBodies(bodies);
      motion.step(dt);
      surface.setTime(time);
      if (view) plants.setView(view[0], view[1], view[2]);
    },
    impact(blow) { motion.impact(blow); },
    dispose() {
      plants.dispose();
      shells?.dispose();
      cards?.dispose();
      vines?.dispose();
      surface.dispose();
      motion.dispose();
      if (water) { water.geometry.dispose(); (water.material as LitMaterial).dispose(); }
    },
  };
}
