// A foliage field: every plant one instance of crossed sprite cards, of 3D
// blades, or of both (blades near the eye, cards past it, crossfading by an
// ordered dither so nothing pops). One LitMaterial each, so the plants take
// the scene's sun, sky and shadows; what makes them sit in the ground is the
// normal: "ground" lights every pixel of a plant as the ground under it is
// lit, so a field of cards shades as one surface with the terrain, the way
// 3D pixel-art grass does. Wind bends them as one gusting field; up to four
// pushers (feet, paws, a ball) part them.

import { Color, DataTexture, Group, InstanceAttribute, Instances, LitMaterial, Matrix4, Quaternion, Vector2, Vector3, Vector4 } from "@keel-engine/lit";
import type { ColorRepresentation, Geometry } from "@keel-engine/lit";
import { bladeClump, crossCards } from "./cards.ts";
import { spriteCell } from "./sprites.ts";
import type { FloraAtlas, FloraKind } from "./sprites.ts";

export const MAX_PUSHERS = 4;

export interface FloraPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: FloraKind;
  readonly variant?: number;
  /** Height in world units. */
  readonly scale?: number;
  readonly yaw?: number;
  /** The leaf colour (sprites shade along it). */
  readonly tint: ColorRepresentation;
  /** The blossom colour (flowers, seed heads, caps). */
  readonly bloom?: ColorRepresentation;
  /** The ground's normal under the plant (default straight up). */
  readonly ground?: readonly [number, number, number];
}

export interface Pusher { readonly x: number; readonly z: number; readonly radius: number; readonly strength?: number }

export interface FloraFieldSpec {
  readonly atlas: FloraAtlas;
  /** cards: crossed sprites; blades: 3D blades; both: blades near, cards far. */
  readonly style?: "cards" | "blades" | "both";
  /** Sprite planes per card: 1 faces the camera, 2 an X, 3 a star. */
  readonly planes?: 1 | 2 | 3 | 4;
  /** How plants are lit: as the ground under them, as a rounded clump, or as flat cards. */
  readonly normals?: "ground" | "volume" | "card";
  /** Where blades give way to cards (style both): distance, and the crossfade's half width. */
  readonly lod?: { readonly near: number; readonly band: number };
  /** The flower eye colour. */
  readonly accent?: ColorRepresentation;
  /** How dark the root is (0..1) and how high the darkening reaches (share of the plant). */
  readonly root?: { readonly shade: number; readonly height: number };
  /** Room for this many plants (default the first placement list's length). */
  readonly capacity?: number;
  readonly castShadow?: boolean;
  readonly seed?: number;
}

export interface FloraField {
  readonly root: Group;
  readonly cards: Instances | null;
  readonly blades: Instances | null;
  /** Wind strength (0 still, 1 a gale) and the direction it blows toward, in radians from +x toward +z. */
  setWind(strength: number, direction: number): void;
  setTime(seconds: number): void;
  setPushers(pushers: readonly Pusher[]): void;
  /** Squashes every plant toward the ground (1 full height; snow, trampling, mowing). */
  setGrow(amount: number): void;
  /** Replaces the plants (up to capacity). */
  update(placements: readonly FloraPlacement[]): void;
  dispose(): void;
}

const FLORA_VERTEX_HEAD = /* glsl */ `
attribute vec3 aCard;
attribute vec4 aFlora;
attribute vec3 aFloraTint;
attribute vec3 aFloraBloom;
attribute vec3 aFloraGround;
uniform vec4 uFloraWind;
uniform vec4 uFloraPush[${String(MAX_PUSHERS)}];
uniform vec4 uFloraMode;
varying vec3 vCard;
varying float vFloraCell;
varying vec3 vFloraTint;
varying vec3 vFloraBloom;
varying float vFloraDistance;
`;

// (At beginnormal, the first of main's chunks to need it: the bend, in field space, and the normal.)
const FLORA_VERTEX_NORMAL = /* glsl */ `
  mat3 floraBasis = mat3(instanceMatrix);
  mat3 floraInverse = inverse(floraBasis);
  vec3 floraOrigin = instanceMatrix[3].xyz;
  float floraHeight = length(floraBasis[1]);
  vec2 floraDir = uFloraWind.yz;
  float floraAlong = dot(floraOrigin.xz, floraDir);
  float floraT = uFloraWind.w;
  float floraGust = 0.5 + 0.5 * sin(floraT * 1.3 - floraAlong * 0.35) * sin(floraT * 0.47 - floraAlong * 0.13 + 1.7);
  floraGust *= floraGust;
  float floraFree = aCard.z * uFloraMode.w;
  float floraLean = uFloraWind.x * (0.3 + 0.9 * floraGust);
  float floraFlick = (0.035 + uFloraWind.x * 0.1) * sin(floraT * (2.6 + aFlora.y) + aFlora.y * 6.2832 + floraAlong * 0.8);
  vec3 floraBend = vec3(floraDir.x, 0.0, floraDir.y) * (floraLean + floraFlick);
  floraBend.xz += vec2(-floraDir.y, floraDir.x) * floraFlick * 0.4;
  for (int i = 0; i < ${String(MAX_PUSHERS)}; i++) {
    vec4 push = uFloraPush[i];
    if (push.w <= 0.0) continue;
    vec2 away = floraOrigin.xz - push.xy;
    float d = length(away);
    float k = push.w * (1.0 - smoothstep(push.z * 0.35, push.z, d));
    if (k <= 0.0) continue;
    floraBend.xz += away / max(d, 1e-3) * k * 0.9;
    floraBend.y -= k * 0.45;
  }
  vec3 floraShift = floraInverse * (floraBend * floraFree * floraHeight);
  vec3 objectNormal = uFloraMode.x < 0.5 ? normal : uFloraMode.x < 1.5 ? floraInverse * aFloraGround : normalize(vec3(position.x, 0.35 + position.y * 0.4, position.z));
  vCard = aCard;
  vFloraCell = aFlora.x;
  vFloraTint = aFloraTint;
  vFloraBloom = aFloraBloom;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`;

const FLORA_VERTEX_BEGIN = /* glsl */ `
  vec3 transformed = vec3(position);
#ifdef FLORA_FACE
  vec3 floraEye = floraInverse * ((inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - floraOrigin);
  float floraYaw = atan(floraEye.x, floraEye.z);
  transformed.xz = vec2(transformed.x * cos(floraYaw), -transformed.x * sin(floraYaw));
#endif
  transformed.y *= uFloraMode.y;
  transformed += floraShift;
  vFloraDistance = distance(cameraPosition, (modelMatrix * vec4(floraOrigin, 1.0)).xyz);`;

const FLORA_FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uFloraAtlas;
uniform vec4 uFloraCell;
uniform vec4 uFloraLod;
uniform vec3 uFloraAccent;
uniform vec2 uFloraRoot;
varying vec3 vCard;
varying float vFloraCell;
varying vec3 vFloraTint;
varying vec3 vFloraBloom;
varying float vFloraDistance;
float floraBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float m = mod(q.x + q.y * 4.0, 16.0);
  return fract(m * 0.4375 + floor(m * 0.25) * 0.3125);
}
`;

const FLORA_FRAGMENT_MAP = /* glsl */ `
  if (uFloraLod.z > 0.5) {
    float floraNear = smoothstep(uFloraLod.x + uFloraLod.y, uFloraLod.x - uFloraLod.y, vFloraDistance);
    float floraKeep = uFloraLod.z < 1.5 ? floraNear : 1.0 - floraNear;
    if (floraKeep < floraBayer(gl_FragCoord.xy)) discard;
  }
#ifdef FLORA_SPRITE
  vec2 floraAt = vec2(mod(vFloraCell, uFloraCell.z), floor(vFloraCell / uFloraCell.z));
  vec4 floraTexel = texture2D(uFloraAtlas, (floraAt + clamp(vCard.xy, 0.001, 0.999)) * uFloraCell.xy);
  if (floraTexel.a < 0.5) discard;
  float floraShade = floraTexel.r;
  int floraRole = int(floraTexel.g * 3.0 + 0.5);
#else
  float floraShade = clamp(0.2 + vCard.y * 0.85 - abs(vCard.x - 0.5) * 0.3, 0.0, 1.0);
  int floraRole = 0;
#endif
  vec3 floraColor = floraRole == 2 ? vFloraBloom : floraRole == 3 ? uFloraAccent : vFloraTint;
  float floraStep = floraShade < 0.17 ? 0.58 : floraShade < 0.5 ? 0.78 : floraShade < 0.83 ? 0.93 : 1.1;
  if (floraRole == 1) floraStep *= 0.82;
  floraColor *= floraStep * mix(1.0 - uFloraRoot.x, 1.0, smoothstep(0.0, uFloraRoot.y, vCard.y));
  diffuseColor.rgb = floraColor;`;

const FLORA_NORMAL = /* glsl */ `#include <normal_fragment_begin>
#ifdef FLORA_KEEP_NORMAL
#ifdef DOUBLE_SIDED
  normal *= faceDirection;
#endif
#endif`;

interface Built {
  readonly mesh: Instances;
  readonly attrs: { readonly flora: InstanceAttribute<Float32Array>; readonly tint: InstanceAttribute<Float32Array>; readonly bloom: InstanceAttribute<Float32Array>; readonly ground: InstanceAttribute<Float32Array> };
  readonly material: LitMaterial;
  /** x the normal mode, y the height scale, w how freely it bends. */
  readonly mode: Vector4;
}

export function createFloraField(spec: FloraFieldSpec, placements: readonly FloraPlacement[]): FloraField {
  const style = spec.style ?? "cards";
  const planes = spec.planes ?? 2;
  const normals = spec.normals ?? "ground";
  const capacity = Math.max(1, spec.capacity ?? placements.length);
  const atlas = spec.atlas;
  const aspect = atlas.cell[0] / atlas.cell[1];
  const texture = new DataTexture(atlas.rgba, atlas.width, atlas.height, "rgba", "u8");
  texture.needsUpdate = true;
  const lod = spec.lod ?? { near: 6, band: 1.5 };

  const wind = new Vector4(0, 1, 0, 0);
  const push = Array.from({ length: MAX_PUSHERS }, () => new Vector4(0, 0, 1, 0));
  const shared = {
    uFloraWind: { value: wind },
    uFloraPush: { value: push },
    uFloraAtlas: { value: texture },
    uFloraCell: { value: new Vector4(atlas.cell[0] / atlas.width, atlas.cell[1] / atlas.height, atlas.cols, 0) },
    uFloraAccent: { value: new Color(spec.accent ?? "#f2c945") },
    uFloraRoot: { value: new Vector2(spec.root?.shade ?? 0.35, spec.root?.height ?? 0.35) },
  };

  const build = (geometry: Geometry, sprite: boolean, lodMode: number): Built => {
    const flora = new InstanceAttribute(new Float32Array(capacity * 4), 4);
    const tint = new InstanceAttribute(new Float32Array(capacity * 3), 3);
    const bloom = new InstanceAttribute(new Float32Array(capacity * 3), 3);
    const ground = new InstanceAttribute(new Float32Array(capacity * 3), 3);
    geometry.setAttribute("aFlora", flora);
    geometry.setAttribute("aFloraTint", tint);
    geometry.setAttribute("aFloraBloom", bloom);
    geometry.setAttribute("aFloraGround", ground);
    const mode = new Vector4(normals === "card" ? 0 : normals === "ground" ? 1 : 2, 1, 0, 1);
    const uniforms = { ...shared, uFloraMode: { value: mode }, uFloraLod: { value: new Vector4(lod.near, lod.band, style === "both" ? lodMode : 0, 0) } };
    const material = new LitMaterial({ color: "#ffffff", roughness: 0.92, metalness: 0, side: "both" });
    if (sprite) material.defines = { ...material.defines, FLORA_SPRITE: "" };
    if (planes === 1 && sprite) material.defines = { ...material.defines, FLORA_FACE: "" };
    if (normals !== "card") material.defines = { ...material.defines, FLORA_KEEP_NORMAL: "" };
    material.onCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = FLORA_VERTEX_HEAD + shader.vertexShader
        .replace("#include <beginnormal_vertex>", FLORA_VERTEX_NORMAL)
        .replace("#include <begin_vertex>", FLORA_VERTEX_BEGIN);
      shader.fragmentShader = FLORA_FRAGMENT_HEAD + shader.fragmentShader
        .replace("#include <map_fragment>", FLORA_FRAGMENT_MAP)
        .replace("#include <normal_fragment_begin>", FLORA_NORMAL);
    };
    material.customProgramCacheKey = () => `keel-flora|${sprite ? "card" : "blade"}|${String(planes)}|${normals}`;
    // (A look that swaps materials must keep this one: the plants live in its shader.)
    material.userData.voxelDitherKeep = true;
    const mesh = new Instances(geometry, material, capacity);
    mesh.castShadow = spec.castShadow ?? false;
    mesh.receiveShadow = true;
    // Plants bend past their bounds; the field is culled as a whole by its owner.
    mesh.frustumCulled = false;
    return { mesh, attrs: { flora, tint, bloom, ground }, material, mode };
  };

  const root = new Group();
  root.name = "keel-flora";
  const parts: Built[] = [];
  const cards = style === "blades" ? null : build(crossCards(planes, { aspect }), true, 2);
  const blades = style === "cards" ? null : build(bladeClump({ seed: spec.seed ?? 1 }), false, 1);
  for (const p of [cards, blades]) if (p) { parts.push(p); root.add(p.mesh); }

  const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3(), up = new Vector3(0, 1, 0), c = new Color();
  const write = (list: readonly FloraPlacement[]): void => {
    const n = Math.min(list.length, capacity);
    for (const part of parts) {
      const { flora, tint, bloom, ground } = part.attrs;
      for (let i = 0; i < n; i += 1) {
        const p = list[i]!;
        const h = p.scale ?? 0.4;
        pos.set(p.x, p.y, p.z);
        q.setFromAxisAngle(up, p.yaw ?? 0);
        // Blades are a round clump; cards keep the sprite's aspect.
        scl.set(h, h, h);
        m.compose(pos, q, scl);
        part.mesh.setMatrixAt(i, m);
        const phase = ((Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1 + 1) % 1;
        flora.array.set([spriteCell(atlas, p.kind, p.variant ?? 0), phase, 0, 0], i * 4);
        c.set(p.tint);
        tint.array.set([c.r, c.g, c.b], i * 3);
        c.set(p.bloom ?? p.tint);
        bloom.array.set([c.r, c.g, c.b], i * 3);
        const g = p.ground ?? [0, 1, 0];
        ground.array.set(g, i * 3);
      }
      part.mesh.count = n;
      part.mesh.instanceMatrix.needsUpdate = true;
      for (const a of [flora, tint, bloom, ground]) a.needsUpdate = true;
    }
  };
  write(placements);

  return {
    root,
    cards: cards?.mesh ?? null,
    blades: blades?.mesh ?? null,
    setWind(strength, direction) {
      wind.x = Math.max(0, strength);
      wind.y = Math.cos(direction);
      wind.z = Math.sin(direction);
    },
    setTime(seconds) { wind.w = seconds; },
    setPushers(list) {
      for (let i = 0; i < MAX_PUSHERS; i += 1) {
        const p = list[i];
        push[i]!.set(p?.x ?? 0, p?.z ?? 0, p?.radius ?? 1, p === undefined ? 0 : p.strength ?? 1);
      }
    },
    setGrow(amount) {
      for (const part of parts) part.mode.y = Math.max(0, amount);
    },
    update: write,
    dispose() {
      for (const part of parts) {
        part.mesh.geometry.dispose();
        part.material.dispose();
      }
      texture.dispose();
    },
  };
}
