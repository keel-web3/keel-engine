// A field of real 3D plants: every kind and variant its own instanced mesh,
// all sharing one LitMaterial, so they take the scene's sun, sky and shadows.
// One shader moves them all in three tiers: the whole plant leans with the
// gusts and the motion field, each branch rocks on its own beat, and leaf tips
// flutter. How much is the kind's own: a saguaro stands, a poppy thrashes.
//
// Every plant has three levels of detail, chosen by how big it is and how far
// off: a rich near shape (built only once something comes near), a plain
// middle one, and a sketch far away, past which it is not drawn. setView moves
// plants between them on the CPU, so only what is close costs what close
// costs, and at each border an ordered dither crosses from one to the next.

import { Color, Group, InstanceAttribute, Instances, LitMaterial, Matrix4, Quaternion, Vector2, Vector3 } from "@keel-engine/lit";
import type { ColorRepresentation, Geometry } from "@keel-engine/lit";
import { FLORA_MOTION_HEAD } from "./motion.ts";
import type { FloraMotion } from "./motion.ts";
import { PLANTS, plantGeometry } from "./plants.ts";

export interface PlantPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: string;
  /** Which of the field's shapes of this kind (wraps). */
  readonly variant?: number;
  /** Height (or, hanging, length) in world units. */
  readonly size: number;
  /** Width over height (default 1). */
  readonly wide?: number;
  readonly yaw?: number;
  /** Leaning off upright, in radians, as on a slope. */
  readonly tilt?: number;
  /** The leaf colour. */
  readonly tint: ColorRepresentation;
  /** The bloom colour (default the tint). */
  readonly bloom?: ColorRepresentation;
}

export interface PlantFieldSpec {
  readonly motion: FloraMotion;
  /** Shapes per kind. */
  readonly variants?: number;
  /** How rich every level is (1: the catalogue's own). */
  readonly detail?: number;
  /** Scales how far each level reaches: 2 keeps detail twice as far out. */
  readonly reach?: number;
  readonly seed?: number;
  /** Whether the kinds that cast shadows do. */
  readonly shadows?: boolean;
}

export interface PlantField {
  readonly root: Group;
  /** Triangles drawn from the current view. */
  readonly triangles: number;
  /** The meshes built so far. */
  readonly meshes: readonly Instances[];
  /** Plants drawn at each level, near to far, from the current view. */
  readonly levels: readonly [number, number, number];
  /** Where the eye is, in world space: call it each frame (it does little until the eye has moved). */
  setView(x: number, y: number, z: number): void;
  /** Plants' height, 0..1 (growing in, or pressed by snow). */
  setGrow(amount: number): void;
  dispose(): void;
}

// World-space vines share this shader: PLANT_WORLD reads the motion field at
// each vertex, since they have no instance to stand at.
export const PLANT_VERTEX_HEAD = /* glsl */ `
attribute vec4 aPart;
attribute vec2 aShade;
attribute vec3 aOwn;
#ifndef PLANT_WORLD
attribute vec3 aPlantTint;
attribute vec3 aPlantBloom;
attribute vec2 aPlantLife;
attribute vec4 aPlantBand;
#else
uniform vec3 uPlantTint;
uniform vec3 uPlantBloom;
uniform float uPlantFar;
#endif
uniform vec4 uFloraWind;
uniform vec2 uPlantGrow;
varying vec3 vPlantColor;
varying float vPlantAlong;
varying vec2 vPlantKeep;
${FLORA_MOTION_HEAD}
`;

export const PLANT_VERTEX_BEGIN = /* glsl */ `
  vec3 transformed = vec3(position);
#ifdef PLANT_WORLD
  vec3 plantRoot = position;
  float plantTall = 1.0, plantFree = 1.0, plantBeat = 0.37;
  mat3 plantBack = mat3(1.0);
  vec3 plantTint = uPlantTint, plantBloom = uPlantBloom;
#else
  mat3 plantBasis = mat3(instanceMatrix);
  mat3 plantBack = inverse(plantBasis);
  vec3 plantRoot = instanceMatrix[3].xyz;
  float plantTall = length(plantBasis[1]), plantFree = aPlantLife.y, plantBeat = aPlantLife.x;
  vec3 plantTint = aPlantTint, plantBloom = aPlantBloom;
  transformed *= uPlantGrow.x;
  float plantSeen = distance(cameraPosition, (modelMatrix * vec4(plantRoot, 1.0)).xyz);
  float plantGone = smoothstep(aPlantBand.y - aPlantBand.z, aPlantBand.y + aPlantBand.z, plantSeen);
  float plantIn = smoothstep(aPlantBand.x - aPlantBand.z, aPlantBand.x + aPlantBand.z, plantSeen);
  // The last level shrinks to its root instead of dotting away.
  if (aPlantBand.w > 1.5) { transformed *= 1.0 - plantGone; plantGone = 0.0; }
  vPlantKeep = vec2(plantIn * (1.0 - plantGone), mod(aPlantBand.w, 2.0));
#endif
#ifdef PLANT_WORLD
  // Stems this fine only shimmer from afar, so they go first.
  vPlantKeep = vec2(1.0 - smoothstep(uPlantFar * 0.7, uPlantFar, distance(cameraPosition, (modelMatrix * vec4(transformed, 1.0)).xyz)), 0.0);
#endif
  vec2 plantDir = uFloraWind.yz;
  float plantT = uFloraWind.w, plantAlongWind = dot(plantRoot.xz, plantDir);
  float plantGust = floraGustAt(plantAlongWind, plantT);
  vec3 plantMoved = floraField(plantRoot.xz);
  float plantLean = uFloraWind.x * (0.22 + 0.95 * plantGust) * plantFree;
  float plantRock = (0.012 + 0.07 * uFloraWind.x * (0.4 + plantGust)) * sin(plantT * (1.7 + plantBeat) + (aPart.z + plantBeat) * 6.2832 + plantAlongWind * 0.5);
  float plantLeaf = aPart.w * (0.006 + 0.03 * uFloraWind.x) * sin(plantT * (6.0 + aPart.z * 5.0) + aPart.z * 40.0 + position.y * 11.0);
  vec3 plantBend = vec3(plantDir.x, 0.0, plantDir.y) * (plantLean + plantRock * plantFree) + vec3(plantMoved.x, 0.0, plantMoved.y) * 1.05 * plantFree;
  plantBend.y -= (plantMoved.z * 0.55 * plantFree + plantLean * plantLean * 0.3);
  plantBend *= aPart.y * plantTall;
  plantBend += normal * plantLeaf;
  transformed += plantBack * plantBend;
  float plantRole = aPart.x;
  vPlantColor = (plantRole < 0.5 ? plantTint : plantRole < 1.5 ? aOwn : plantBloom) * aShade.x;
  vPlantAlong = aShade.y;`;

export const PLANT_FRAGMENT_HEAD = /* glsl */ `
uniform vec2 uPlantGrow;
varying vec3 vPlantColor;
varying float vPlantAlong;
varying vec2 vPlantKeep;
float plantBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float m = mod(q.x + q.y * 4.0, 16.0);
  return fract(m * 0.4375 + floor(m * 0.25) * 0.3125);
}
`;

// (Odd levels read the dither upside down, so two levels crossing fill each other's holes.)
export const PLANT_FRAGMENT_MAP = /* glsl */ `
  if (vPlantAlong > uPlantGrow.y) discard;
  float plantDither = plantBayer(gl_FragCoord.xy);
  if (vPlantKeep.x < (vPlantKeep.y > 0.5 ? 1.0 - plantDither : plantDither)) discard;
  diffuseColor.rgb = vPlantColor;`;

export function plantMaterial(motion: FloraMotion, grow: { value: Vector2 }, world: boolean, extra: Record<string, { value: unknown }> = {}): LitMaterial {
  const material = new LitMaterial({ color: "#ffffff", roughness: 0.85, metalness: 0, side: "both" });
  if (world) material.defines = { ...material.defines, PLANT_WORLD: "" };
  material.onCompile = (shader) => {
    Object.assign(shader.uniforms, motion.uniforms, { uPlantGrow: grow }, extra);
    shader.vertexShader = PLANT_VERTEX_HEAD + shader.vertexShader.replace("#include <begin_vertex>", PLANT_VERTEX_BEGIN);
    shader.fragmentShader = PLANT_FRAGMENT_HEAD + shader.fragmentShader.replace("#include <map_fragment>", PLANT_FRAGMENT_MAP);
  };
  material.customProgramCacheKey = () => `keel-plants|${world ? "world" : "instanced"}`;
  // (A look that swaps materials must keep this one: the plants live in its shader.)
  material.userData.voxelDitherKeep = true;
  return material;
}

/** Detail of each level against the field's own. */
const LEVEL_DETAIL = [1.8, 0.7, 0.22] as const;
const STRIDE = 16;

interface Level {
  readonly mesh: Instances;
  readonly tint: InstanceAttribute<Float32Array>;
  readonly bloom: InstanceAttribute<Float32Array>;
  readonly life: InstanceAttribute<Float32Array>;
  readonly band: InstanceAttribute<Float32Array>;
  readonly triangles: number;
}

interface Stand {
  readonly kind: string;
  readonly variant: number;
  readonly list: readonly PlantPlacement[];
  readonly matrices: Float32Array;
  readonly tint: Float32Array;
  readonly bloom: Float32Array;
  readonly life: Float32Array;
  /** Each plant's three borders, near to far. */
  readonly edges: Float32Array;
  readonly levels: (Level | null)[];
}

export function createPlantField(spec: PlantFieldSpec, placements: readonly PlantPlacement[]): PlantField {
  const variants = spec.variants ?? 2, reach = spec.reach ?? 1, detail = spec.detail ?? 1;
  const grow = { value: new Vector2(1, 2) };
  const material = plantMaterial(spec.motion, grow, false);
  const groups = new Map<string, PlantPlacement[]>();
  for (const p of placements) {
    const key = `${p.kind}|${String((((p.variant ?? 0) % variants) + variants) % variants)}`;
    const list = groups.get(key);
    if (list) list.push(p); else groups.set(key, [p]);
  }
  const root = new Group();
  root.name = "keel-plants";
  const meshes: Instances[] = [];
  const geometries: Geometry[] = [];
  const m = new Matrix4(), q = new Quaternion(), t = new Quaternion(), pos = new Vector3(), scl = new Vector3(), up = new Vector3(0, 1, 0), lean = new Vector3(1, 0, 0), c = new Color(), eye = new Vector3();
  const stands: Stand[] = [];
  for (const [key, list] of groups) {
    const [kind, variant] = key.split("|") as [string, string];
    const def = PLANTS[kind];
    if (def === undefined) throw new Error(`Unknown plant ${kind}.`);
    const n = list.length;
    const stand: Stand = { kind, variant: Number(variant), list, matrices: new Float32Array(n * STRIDE), tint: new Float32Array(n * 3), bloom: new Float32Array(n * 3), life: new Float32Array(n * 2), edges: new Float32Array(n * 3), levels: [null, null, null] };
    list.forEach((p, i) => {
      pos.set(p.x, p.y, p.z);
      q.setFromAxisAngle(up, p.yaw ?? 0);
      if (p.tilt) { t.setFromAxisAngle(lean, p.tilt); q.multiply(t); }
      const wide = p.size * (p.wide ?? 1);
      scl.set(wide, p.size, wide);
      m.compose(pos, q, scl);
      stand.matrices.set(m.elements, i * STRIDE);
      c.set(p.tint);
      stand.tint.set([c.r, c.g, c.b], i * 3);
      c.set(p.bloom ?? p.tint);
      stand.bloom.set([c.r, c.g, c.b], i * 3);
      stand.life.set([((Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1 + 1) % 1, def.sway ?? 1], i * 2);
      // What matters is how big it looks: a tall thing keeps its detail further off.
      const big = Math.max(p.size, wide * 0.6);
      // A rock has nothing to resolve up close and shows every swap, so it skips the near level.
      stand.edges.set([def.group === "object" ? -1 : reach * (4 + big * 6), reach * (14 + big * 16), reach * (42 + big * 70)], i * 3);
    });
    stands.push(stand);
  }

  /** Built the first time a plant needs it, so a near shape costs nothing until someone comes close. */
  const level = (stand: Stand, l: number): Level => {
    const had = stand.levels[l];
    if (had) return had;
    const n = stand.list.length, def = PLANTS[stand.kind]!;
    // A kind grown by the hundred is seen as a mass: the middle and far levels thin it, so a prairie costs what a garden does.
    const thin = l === 0 ? 1 : n > 400 ? 0.5 : n > 120 ? 0.75 : 1;
    const geometry = plantGeometry(stand.kind, { seed: ((spec.seed ?? 1) * 2654435761 + stand.kind.length * 7919 + stand.variant * 104729 + l * 17) >>> 0, detail: detail * LEVEL_DETAIL[def.group === "object" && l === 1 ? 0 : l]! * thin });
    const tint = new InstanceAttribute(new Float32Array(n * 3), 3), bloom = new InstanceAttribute(new Float32Array(n * 3), 3), life = new InstanceAttribute(new Float32Array(n * 2), 2), band = new InstanceAttribute(new Float32Array(n * 4), 4);
    geometry.setAttribute("aPlantTint", tint);
    geometry.setAttribute("aPlantBloom", bloom);
    geometry.setAttribute("aPlantLife", life);
    geometry.setAttribute("aPlantBand", band);
    const mesh = new Instances(geometry, material, n);
    mesh.count = 0;
    mesh.castShadow = (spec.shadows ?? true) && (def.shadow ?? false) && l < 2;
    mesh.receiveShadow = true;
    // Plants bend past their bounds; the field is culled as a whole by its owner.
    mesh.frustumCulled = false;
    root.add(mesh);
    meshes.push(mesh);
    geometries.push(geometry);
    const built = { mesh, tint, bloom, life, band, triangles: (geometry.index?.count ?? 0) / 3 };
    stand.levels[l] = built;
    return built;
  };

  const counts: [number, number, number] = [0, 0, 0];
  let triangles = 0;
  const place = (x: number, y: number, z: number): void => {
    counts.fill(0);
    triangles = 0;
    for (const stand of stands) {
      const n = stand.list.length, used = [0, 0, 0];
      for (let i = 0; i < n; i += 1) {
        const o = i * STRIDE, d = Math.hypot(stand.matrices[o + 12]! - x, stand.matrices[o + 13]! - y, stand.matrices[o + 14]! - z);
        let start = -1e4;
        for (let l = 0; l < 3; l += 1) {
          const end = stand.edges[i * 3 + l]!, width = l === 2 ? end * 0.2 : Math.min(end * 0.05, 1);
          if (d >= start - width * 1.5 && d <= end + width * 1.5) {
            const to = level(stand, l), at = used[l]!;
            used[l] = at + 1;
            to.mesh.instanceMatrix.array.set(stand.matrices.subarray(o, o + STRIDE), at * STRIDE);
            to.tint.array.set(stand.tint.subarray(i * 3, i * 3 + 3), at * 3);
            to.bloom.array.set(stand.bloom.subarray(i * 3, i * 3 + 3), at * 3);
            to.life.array.set(stand.life.subarray(i * 2, i * 2 + 2), at * 2);
            to.band.array.set([start, end, width, l === 2 ? 2 : l], at * 4);
          }
          start = end;
        }
      }
      for (let l = 0; l < 3; l += 1) {
        const to = stand.levels[l];
        if (!to) continue;
        to.mesh.count = used[l]!;
        to.mesh.instanceMatrix.needsUpdate = true;
        for (const a of [to.tint, to.bloom, to.life, to.band]) a.needsUpdate = true;
        counts[l] = counts[l]! + used[l]!;
        triangles += used[l]! * to.triangles;
      }
    }
  };
  let at: [number, number, number] | null = null;
  const setView = (x: number, y: number, z: number): void => {
    eye.set(x, y, z);
    root.worldToLocal(eye);
    if (at && Math.hypot(eye.x - at[0], eye.y - at[1], eye.z - at[2]) < 0.75) return;
    at = [eye.x, eye.y, eye.z];
    place(eye.x, eye.y, eye.z);
  };
  // Until told otherwise the eye is high and far: the sketches, which are cheap to build.
  place(0, 200, 0);

  return {
    root,
    get triangles() { return triangles; },
    meshes,
    get levels() { return [...counts] as [number, number, number]; },
    setView,
    setGrow(amount) { grow.value.x = Math.max(0.001, amount); },
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
    },
  };
}
