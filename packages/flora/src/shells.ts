// Ground with depth: the surface drawn again in stacked shells, each a little
// higher along the normal, every texel kept only as high as a height function
// says it reaches. Seen at any angle the gaps between layers read as real
// relief, moss in cushions, pebbles standing proud, mud cracked into plates,
// with no geometry of their own; and because each layer is shifted by the
// motion field, the ground's fuzz sways and flattens with the plants on it.
// Heights snap to a texel grid, so a shell keeps the pixel-art grain.

import { Attribute, Color, DataTexture, Geometry, InstanceAttribute, Instances, LitMaterial, Vector4 } from "@keel-engine/lit";
import type { ColorRepresentation } from "@keel-engine/lit";
import { FLORA_MOTION_HEAD } from "./motion.ts";
import type { FloraMotion } from "./motion.ts";

export const MAX_SHELL_MATERIALS = 8;
export const SHELL_KINDS = ["none", "fuzz", "moss", "pebbles", "cracks", "ripples", "mounds", "strata", "litter"] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];

export interface ShellLook {
  readonly kind: ShellKind;
  /** Features per metre. */
  readonly scale?: number;
  /** Tallest feature, as a share of the shells' height. */
  readonly height?: number;
  /** How far the wind and bodies move it, 0..1. */
  readonly give?: number;
  /** Colour at the root and at the tip. */
  readonly low: ColorRepresentation;
  readonly high: ColorRepresentation;
}

export interface GroundShellSpec {
  /** The surface, with normals. */
  readonly geometry: Geometry;
  readonly motion: FloraMotion;
  /** One cell's material index per cell, row by row along +x, rows along +z. */
  readonly cells: Uint8Array;
  readonly width: number;
  readonly depth: number;
  readonly cell: number;
  readonly origin: readonly [number, number];
  /** One look per material index (null: bare, drawn by the surface alone). */
  readonly looks: readonly (ShellLook | null)[];
  readonly layers?: number;
  /** World height of the top layer. */
  readonly height?: number;
  /** Texels per metre the heights snap to. */
  readonly texels?: number;
  /** Past this distance the upper layers drop away, then all of them. */
  readonly far?: number;
}

export interface GroundShells {
  readonly mesh: Instances;
  dispose(): void;
}

const SHELL_VERTEX_HEAD = /* glsl */ `
attribute float aShellLayer;
uniform vec4 uShellFrame;
uniform vec4 uShellSize;
uniform vec4 uFloraWind;
varying vec2 vShellAt;
varying vec2 vShellLean;
varying float vShellT;
varying float vShellPress;
varying float vShellFar;
${FLORA_MOTION_HEAD}
`;

const SHELL_VERTEX_BEGIN = /* glsl */ `#include <begin_vertex>
  vShellT = aShellLayer;
  transformed += normal * aShellLayer * uShellSize.x;
  vec3 shellMoved = floraField(position.xz);
  vec2 shellDir = uFloraWind.yz;
  float shellGust = floraGustAt(dot(position.xz, shellDir), uFloraWind.w);
  float shellWave = sin(uFloraWind.w * 2.1 + dot(position.xz, vec2(1.3, 2.1)));
  vShellLean = (shellDir * uFloraWind.x * (0.25 + shellGust + 0.2 * shellWave) + shellMoved.xy * 1.4) * aShellLayer * aShellLayer * 0.09;
  vShellPress = shellMoved.z;
  vShellAt = position.xz;
  vShellFar = clamp((uShellSize.y - distance(cameraPosition, position)) / (uShellSize.y * 0.35), 0.0, 1.0);`;

const SHELL_FRAGMENT_HEAD = /* glsl */ `
#define SHELL_MAX ${String(MAX_SHELL_MATERIALS)}
uniform sampler2D uShellCells;
uniform vec4 uShellFrame;
uniform vec4 uShellSize;
uniform vec4 uShellA[SHELL_MAX];
uniform vec3 uShellLow[SHELL_MAX];
uniform vec3 uShellHigh[SHELL_MAX];
varying vec2 vShellAt;
varying vec2 vShellLean;
varying float vShellT;
varying float vShellPress;
varying float vShellFar;
float shellHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 shellHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float shellNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(shellHash(i), shellHash(i + vec2(1.0, 0.0)), f.x), mix(shellHash(i + vec2(0.0, 1.0)), shellHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The nearest and second-nearest stone: distance to one, the gap between them, and the nearest's own id.
vec3 shellCells(vec2 p, out float id) {
  vec2 i = floor(p), f = fract(p);
  float a = 8.0, b = 8.0;
  id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = g + shellHash2(i + g) - f;
    float d = dot(o, o);
    if (d < a) { b = a; a = d; id = shellHash(i + g + 3.7); }
    else if (d < b) b = d;
  }
  return vec3(sqrt(a), sqrt(b) - sqrt(a), 0.0);
}
// How high the ground reaches here, 0..1, and a tone 0..1 for its colour.
float shellHeight(int kind, vec2 p, out float tone) {
  tone = 0.5;
  if (kind == 1) {
    vec2 c = floor(p);
    float blade = shellHash(c);
    float patch_ = shellNoise(p * 0.11);
    tone = patch_;
    return blade * (0.55 + 0.6 * patch_);
  }
  if (kind == 2) {
    float bump = shellNoise(p) * 0.6 + shellNoise(p * 2.3 + 4.1) * 0.3 + shellNoise(p * 6.1) * 0.25;
    tone = bump;
    return smoothstep(0.3, 0.86, bump);
  }
  if (kind == 3) {
    float id;
    vec3 c = shellCells(p, id);
    float size = 0.3 + 0.55 * id;
    tone = id;
    return clamp(1.0 - c.x / size, 0.0, 1.0) * (0.5 + 0.5 * id) * 1.5;
  }
  if (kind == 4) {
    float id;
    vec3 c = shellCells(p, id);
    tone = id;
    return smoothstep(0.03, 0.12, c.y) * (0.72 + 0.28 * id);
  }
  if (kind == 5) {
    float warp = shellNoise(p * 0.3) * 4.0;
    float wave = 0.5 + 0.5 * sin(p.y * 1.4 + warp + p.x * 0.3);
    tone = wave;
    return wave * wave * 0.85 + 0.1 * shellNoise(p * 3.0);
  }
  if (kind == 6) {
    float m = shellNoise(p * 0.5) * 0.7 + shellNoise(p * 1.3 + 2.0) * 0.3;
    tone = m;
    return smoothstep(0.2, 0.8, m);
  }
  if (kind == 7) {
    float bands = floor((p.y + shellNoise(p * 0.2) * 5.0) * 1.2);
    tone = shellHash(vec2(bands, 3.1));
    return 0.3 + 0.7 * tone * smoothstep(0.2, 0.7, shellNoise(p * 0.7 + bands));
  }
  float id;
  vec3 c = shellCells(p * vec2(1.0, 1.7), id);
  tone = id;
  return clamp(1.0 - c.x * 2.2, 0.0, 1.0) * (0.3 + 0.7 * id);
}
`;

const SHELL_FRAGMENT_MAP = /* glsl */ `
  if (vShellT > vShellFar) discard;
  vec2 shellPoint = vShellAt - vShellLean;
  vec2 shellCell = (shellPoint - uShellFrame.xy + (vec2(shellNoise(shellPoint * 3.1), shellNoise(shellPoint * 3.1 + 7.0)) - 0.5) * uShellFrame.z * 0.9) / uShellFrame.z;
  int shellMaterial = int(texelFetch(uShellCells, clamp(ivec2(floor(shellCell)), ivec2(0), ivec2(uShellFrame.w, uShellSize.w) - 1), 0).r * 255.0 + 0.5);
  vec4 shellLook = uShellA[shellMaterial];
  int shellKind = int(shellLook.x + 0.5);
  if (shellKind == 0) discard;
  vec2 shellSnap = (floor(shellPoint * uShellSize.z) + 0.5) / uShellSize.z;
  float shellTone;
  float shellReach = shellHeight(shellKind, shellSnap * shellLook.y, shellTone) * shellLook.z * (1.0 - vShellPress * 0.8 * shellLook.w);
  if (vShellT > shellReach) discard;
  float shellRise = vShellT / max(shellReach, 0.05);
  diffuseColor.rgb = mix(uShellLow[shellMaterial], uShellHigh[shellMaterial], shellRise * 0.75 + shellTone * 0.25) * (0.62 + 0.42 * shellRise);`;

export function createGroundShells(spec: GroundShellSpec): GroundShells {
  if (spec.looks.length > MAX_SHELL_MATERIALS) throw new RangeError(`Ground shells hold up to ${String(MAX_SHELL_MATERIALS)} looks.`);
  const layers = spec.layers ?? 12;
  const height = spec.height ?? 0.14;
  const data = spec.cells.slice();
  const cells = new DataTexture(data, spec.width, spec.depth, "red", "u8");
  cells.unpackAlignment = 1;
  cells.needsUpdate = true;
  const A = Array.from({ length: MAX_SHELL_MATERIALS }, () => new Vector4(0, 1, 0, 0));
  const low = Array.from({ length: MAX_SHELL_MATERIALS }, () => new Color());
  const high = Array.from({ length: MAX_SHELL_MATERIALS }, () => new Color());
  spec.looks.forEach((look, i) => {
    if (look === null) return;
    A[i]!.set(SHELL_KINDS.indexOf(look.kind), look.scale ?? 30, look.height ?? 1, look.give ?? 0.6);
    low[i]!.set(look.low);
    high[i]!.set(look.high);
  });
  const uniforms = {
    ...spec.motion.uniforms,
    uShellCells: { value: cells },
    uShellFrame: { value: new Vector4(spec.origin[0], spec.origin[1], spec.cell, spec.width) },
    uShellSize: { value: new Vector4(height, spec.far ?? 40, spec.texels ?? 24, spec.depth) },
    uShellA: { value: A },
    uShellLow: { value: low },
    uShellHigh: { value: high },
  };
  // (Its own geometry object over the surface's buffers, since it adds a per-layer attribute.)
  const geometry = new Geometry();
  for (const name of ["position", "normal"]) geometry.setAttribute(name, spec.geometry.getAttribute(name) as Attribute);
  geometry.setIndex(spec.geometry.index);
  const layer = new InstanceAttribute(new Float32Array(layers), 1);
  for (let i = 0; i < layers; i += 1) layer.array[i] = (i + 1) / layers;
  geometry.setAttribute("aShellLayer", layer);
  const material = new LitMaterial({ color: "#ffffff", roughness: 0.95, metalness: 0 });
  material.onCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = SHELL_VERTEX_HEAD + shader.vertexShader.replace("#include <begin_vertex>", SHELL_VERTEX_BEGIN);
    shader.fragmentShader = SHELL_FRAGMENT_HEAD + shader.fragmentShader.replace("#include <map_fragment>", SHELL_FRAGMENT_MAP);
  };
  material.customProgramCacheKey = () => "keel-shells";
  // (A look that swaps materials must keep this one: the ground lives in its shader.)
  material.userData.voxelDitherKeep = true;
  const mesh = new Instances(geometry, material, layers);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = "keel-shells";
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
      cells.dispose();
    },
  };
}
