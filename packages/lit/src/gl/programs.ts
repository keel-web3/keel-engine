// Ported from Three.js r180's renderers/webgl/WebGLPrograms.js (MIT, see
// packages/lit/NOTICE).
//
// getParameters reads a material, the lights, the stage and the object into
// r180's program parameters, field for field and in r180's order (the false
// and off cases included: they decide the GLSL); getProgramCacheKey joins them
// as r180 does; acquireProgram compiles a program once per key.
//
// KEEL's differences, all outside the GLSL:
//
//   - shaderID is the src/shader LIBRARY key, by KEEL material type:
//     FlatMaterial "flat" (r180 "basic"), LitMaterial "lit" (r180 "physical"),
//     ToonMaterial "toon", BillboardMaterial "billboard" (r180 "sprite"),
//     DepthMaterial "depth", DistanceMaterial "distance" (r180
//     "distanceRGBA"). A CustomMaterial has none (r180's ShaderMaterial has
//     none either): it compiles its own texts, named in the key by
//     shader-cache ids. The key's first entry is therefore KEEL's id.
//   - shaderType is r180's material type name (MeshStandardMaterial ...), not
//     KEEL's: it goes into the GLSL as `#define SHADER_TYPE`.
//   - Constants are KEEL's typed strings in the parameters (toneMapping,
//     shadowMapType, envMapMode, combine, outputColorSpace) and r180's
//     numbers (and r180's colour space strings) in the cache key, through
//     src/constants.ts. depthPacking is r180's number (or 0), as the GLSL
//     #define and the key both take it.
//   - customProgramCacheKey is the material's (KEEL: onCompile's text).
//   - The lit program's uniforms are r180's standard set: r180 clones
//     ShaderLib.physical's (standard plus the physical extras), but no extra
//     is ever declared without PHYSICAL, so nothing it uploads differs.

import { LIBRARY } from "../shader/library.ts";
import type { ProgramName } from "../shader/library.ts";
import { realizeUniforms } from "../shader/uniforms.ts";
import type { Uniforms } from "../shader/uniforms.ts";
import { Color } from "../math/Color.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Matrix3 } from "../math/Matrix3.ts";
import { Matrix4 } from "../math/Matrix4.ts";
import { colorManagement } from "../math/ColorManagement.ts";
import type { ColorSpace } from "../math/types.ts";
import { Layers } from "../core/Layers.ts";
import { COLOR_SPACE, R180 } from "../constants.ts";
import type { Blending, Combine, DepthPacking, GlslVersion, Mapping, NormalMapType, ShadowMapType, Side, ToneMapping } from "../constants.ts";
import { createProgram } from "./program.ts";
import type { LitProgram, ProgramBindingStates, ProgramRenderer } from "./program.ts";
import { createShaderCache } from "./shader-cache.ts";
import type { LightsState } from "./lights.ts";

export type Precision = "highp" | "mediump" | "lowp";

/** A texture, as getParameters reads it. */
export interface ProgramTexture {
  readonly channel: number;
  readonly colorSpace: ColorSpace;
  readonly mapping?: Mapping;
  readonly isVideoTexture?: boolean;
  readonly image?: unknown;
}

type Tex = ProgramTexture | null | undefined;

/** A material, as getParameters reads it: the base fields, and any map or factor its class has. */
export interface ProgramMaterial {
  readonly type: string;
  readonly name: string;
  readonly isMeshStandardMaterial?: boolean;
  readonly isRawShaderMaterial?: boolean;

  defines?: Record<string, unknown> | undefined;
  vertexShader?: string;
  fragmentShader?: string;
  uniforms?: Uniforms;
  glslVersion?: GlslVersion | null;
  extensions?: { clipCullDistance?: boolean; multiDraw?: boolean };
  index0AttributeName?: string | undefined;

  precision: Precision | null;

  map?: Tex;
  matcap?: Tex;
  envMap?: Tex;
  aoMap?: Tex;
  lightMap?: Tex;
  bumpMap?: Tex;
  normalMap?: Tex;
  normalMapType?: NormalMapType;
  displacementMap?: Tex;
  emissiveMap?: Tex;
  metalnessMap?: Tex;
  roughnessMap?: Tex;
  specularMap?: Tex;
  specularColorMap?: Tex;
  specularIntensityMap?: Tex;
  gradientMap?: Tex;
  alphaMap?: Tex;

  anisotropy?: number;
  anisotropyMap?: Tex;
  clearcoat?: number;
  clearcoatMap?: Tex;
  clearcoatNormalMap?: Tex;
  clearcoatRoughnessMap?: Tex;
  dispersion?: number;
  iridescence?: number;
  iridescenceMap?: Tex;
  iridescenceThicknessMap?: Tex;
  sheen?: number;
  sheenColorMap?: Tex;
  sheenRoughnessMap?: Tex;
  transmission?: number;
  transmissionMap?: Tex;
  thicknessMap?: Tex;

  alphaTest: number;
  alphaHash: boolean;
  alphaToCoverage: boolean;
  transparent: boolean;
  blending: Blending;
  toneMapped: boolean;
  combine?: Combine;
  vertexColors: boolean;
  fog?: boolean;
  flatShading?: boolean;
  wireframe?: boolean;
  sizeAttenuation?: boolean;
  dithering: boolean;
  premultipliedAlpha: boolean;
  side: Side;
  depthPacking?: DepthPacking;

  customProgramCacheKey(): string;
}

/** The stage, as getParameters reads it. */
export interface ProgramScene {
  readonly fog: { readonly isFogExp2?: boolean } | null;
  readonly environment: ProgramTexture | null;
}

/** The drawn object, as getParameters reads it. */
export interface ProgramObject {
  readonly geometry: {
    readonly attributes: Readonly<Record<string, { readonly itemSize: number }>>;
    readonly morphAttributes: Readonly<Record<string, readonly unknown[]>>;
  };
  readonly isInstancedMesh?: boolean;
  readonly isBatchedMesh?: boolean;
  readonly isPoints?: boolean;
  readonly isSkinnedMesh?: boolean;
  readonly instanceColor?: unknown;
  readonly morphTexture?: unknown;
  readonly _colorsTexture?: unknown;
}

/** r180's program parameters, in r180's order (see the header for KEEL's few differences). */
export interface ProgramParameters {
  shaderID: ProgramName | undefined;
  shaderType: string;
  shaderName: string;

  vertexShader: string;
  fragmentShader: string;
  defines: Record<string, unknown> | undefined;

  customVertexShaderID: number | undefined;
  customFragmentShaderID: number | undefined;

  isRawShaderMaterial: boolean;
  glslVersion: GlslVersion | null | undefined;

  precision: Precision;

  batching: boolean;
  batchingColor: boolean;
  instancing: boolean;
  instancingColor: boolean;
  instancingMorph: boolean;

  supportsVertexTextures: boolean;
  outputColorSpace: ColorSpace;
  alphaToCoverage: boolean;

  map: boolean;
  matcap: boolean;
  envMap: boolean;
  envMapMode: Mapping | false | undefined;
  envMapCubeUVHeight: number | null;
  aoMap: boolean;
  lightMap: boolean;
  bumpMap: boolean;
  normalMap: boolean;
  displacementMap: boolean;
  emissiveMap: boolean;

  normalMapObjectSpace: boolean;
  normalMapTangentSpace: boolean;

  metalnessMap: boolean;
  roughnessMap: boolean;

  anisotropy: boolean;
  anisotropyMap: boolean;

  clearcoat: boolean;
  clearcoatMap: boolean;
  clearcoatNormalMap: boolean;
  clearcoatRoughnessMap: boolean;

  dispersion: boolean;

  iridescence: boolean;
  iridescenceMap: boolean;
  iridescenceThicknessMap: boolean;

  sheen: boolean;
  sheenColorMap: boolean;
  sheenRoughnessMap: boolean;

  specularMap: boolean;
  specularColorMap: boolean;
  specularIntensityMap: boolean;

  transmission: boolean;
  transmissionMap: boolean;
  thicknessMap: boolean;

  gradientMap: boolean;

  opaque: boolean;

  alphaMap: boolean;
  alphaTest: boolean;
  alphaHash: boolean;

  combine: Combine | undefined;

  //

  mapUv: string | false;
  aoMapUv: string | false;
  lightMapUv: string | false;
  bumpMapUv: string | false;
  normalMapUv: string | false;
  displacementMapUv: string | false;
  emissiveMapUv: string | false;

  metalnessMapUv: string | false;
  roughnessMapUv: string | false;

  anisotropyMapUv: string | false;

  clearcoatMapUv: string | false;
  clearcoatNormalMapUv: string | false;
  clearcoatRoughnessMapUv: string | false;

  iridescenceMapUv: string | false;
  iridescenceThicknessMapUv: string | false;

  sheenColorMapUv: string | false;
  sheenRoughnessMapUv: string | false;

  specularMapUv: string | false;
  specularColorMapUv: string | false;
  specularIntensityMapUv: string | false;

  transmissionMapUv: string | false;
  thicknessMapUv: string | false;

  alphaMapUv: string | false;

  //

  vertexTangents: boolean;
  vertexColors: boolean;
  vertexAlphas: boolean;

  pointsUvs: boolean;

  fog: boolean;
  useFog: boolean;
  fogExp2: boolean | undefined;

  flatShading: boolean;

  sizeAttenuation: boolean;
  logarithmicDepthBuffer: boolean;
  reversedDepthBuffer: boolean;

  skinning: boolean;

  morphTargets: boolean;
  morphNormals: boolean;
  morphColors: boolean;
  morphTargetsCount: number;
  morphTextureStride: number;

  numDirLights: number;
  numPointLights: number;
  numSpotLights: number;
  numSpotLightMaps: number;
  numRectAreaLights: number;
  numHemiLights: number;

  numDirLightShadows: number;
  numPointLightShadows: number;
  numSpotLightShadows: number;
  numSpotLightShadowsWithMaps: number;

  numLightProbes: number;

  numClippingPlanes: number;
  numClipIntersection: number;

  dithering: boolean;

  shadowMapEnabled: boolean;
  shadowMapType: ShadowMapType;

  toneMapping: ToneMapping;

  decodeVideoTexture: boolean;
  decodeVideoTextureEmissive: boolean;

  premultipliedAlpha: boolean;

  doubleSided: boolean;
  flipSided: boolean;

  useDepthPacking: boolean;
  depthPacking: number;

  index0AttributeName: string | undefined;

  extensionClipCullDistance: boolean;
  extensionMultiDraw: boolean;

  rendererExtensionParallelShaderCompile: boolean;

  customProgramCacheKey: string;

  vertexUv1s: boolean;
  vertexUv2s: boolean;
  vertexUv3s: boolean;

  /** Set by the renderer before onCompile (r180's getProgram: parameters.uniforms = getUniforms( material )). */
  uniforms?: Uniforms;

  // (onCompile may add its own fields, as r180's onBeforeCompile may)
  [key: string]: unknown;
}

/** What getParameters reads of the renderer, beyond what a program does. */
export interface ProgramsRenderer extends ProgramRenderer {
  getRenderTarget(): { readonly isXRRenderTarget?: boolean; readonly texture: { readonly colorSpace: ColorSpace } } | null;
  readonly state: { readonly buffers: { readonly depth: { getReversed(): boolean } } };
  readonly toneMapping: ToneMapping;
  readonly outputColorSpace: ColorSpace;
  readonly shadowMap: { readonly enabled: boolean; readonly type: ShadowMapType };
}

/** r180's WebGLCubeMaps / WebGLCubeUVMaps, as getParameters reads them (keel/lit hands textures through). */
export interface ProgramEnvMaps {
  get(texture: ProgramTexture | null): (ProgramTexture & { readonly image?: { readonly height: number } }) | null;
}

export interface ProgramExtensions {
  has(name: string): boolean;
}

export interface ProgramCapabilities {
  readonly logarithmicDepthBuffer: boolean;
  readonly vertexTextures: boolean;
  readonly precision: Precision;
  getMaxPrecision(precision: Precision): Precision;
}

export interface ProgramClipping {
  readonly numPlanes: number;
  readonly numIntersection: number;
}

export interface Programs {
  getParameters(material: ProgramMaterial, lights: LightsState, shadows: readonly unknown[], scene: ProgramScene, object: ProgramObject): ProgramParameters;
  getProgramCacheKey(parameters: ProgramParameters): string;
  getUniforms(material: ProgramMaterial): Uniforms;
  acquireProgram(parameters: ProgramParameters, cacheKey: string): LitProgram;
  releaseProgram(program: LitProgram): void;
  releaseShaderCache(material: ProgramMaterial): void;
  // Exposed for resource monitoring & error feedback via renderer.info:
  programs: LitProgram[];
  dispose(): void;
}

// (KEEL material type -> the library program)
const shaderIDs: Readonly<Record<string, ProgramName>> = {
  DepthMaterial: "depth",
  DistanceMaterial: "distance",
  FlatMaterial: "flat",
  ToonMaterial: "toon",
  LitMaterial: "lit",
  BillboardMaterial: "billboard",
};

/** KEEL material type -> r180's, as `#define SHADER_TYPE` writes it. */
export const R180_MATERIAL_TYPE: Readonly<Record<string, string>> = Object.freeze({
  LitMaterial: "MeshStandardMaterial",
  ToonMaterial: "MeshToonMaterial",
  FlatMaterial: "MeshBasicMaterial",
  BillboardMaterial: "SpriteMaterial",
  CustomMaterial: "ShaderMaterial",
  DepthMaterial: "MeshDepthMaterial",
  DistanceMaterial: "MeshDistanceMaterial",
});

// (realizes the library's default descriptors as r180's maths values)
const maker = {
  color: (hex: number) => new Color(hex),
  vec2: (x: number, y: number) => new Vector2(x, y),
  vec3: (x: number, y: number, z: number) => new Vector3(x, y, z),
  mat3: () => new Matrix3(),
  mat4: () => new Matrix4(),
};

/** r180's WebGLPrograms. */
export function createPrograms(
  renderer: ProgramsRenderer,
  cubemaps: ProgramEnvMaps,
  cubeuvmaps: ProgramEnvMaps,
  extensions: ProgramExtensions,
  capabilities: ProgramCapabilities,
  bindingStates: ProgramBindingStates,
  clipping: ProgramClipping,
): Programs {
  const _programLayers = new Layers();
  const _customShaders = createShaderCache();
  const _activeChannels = new Set<number>();
  const programs: LitProgram[] = [];

  const logarithmicDepthBuffer = capabilities.logarithmicDepthBuffer;
  const SUPPORTS_VERTEX_TEXTURES = capabilities.vertexTextures;

  let precision = capabilities.precision;

  function getChannel(value: number): string {
    _activeChannels.add(value);

    if (value === 0) return "uv";

    return `uv${value}`;
  }

  function getParameters(material: ProgramMaterial, lights: LightsState, shadows: readonly unknown[], scene: ProgramScene, object: ProgramObject): ProgramParameters {
    const fog = scene.fog;
    const geometry = object.geometry;
    const environment = material.isMeshStandardMaterial ? scene.environment : null;

    const envMap = (material.isMeshStandardMaterial ? cubeuvmaps : cubemaps).get(material.envMap || environment);
    const envMapCubeUVHeight = (!!envMap) && (envMap.mapping === "cube-uv-reflection") ? envMap.image!.height : null;

    const shaderID = shaderIDs[material.type];

    // heuristics to create shader parameters according to lights in the scene
    // (not to blow over maxLights budget)

    if (material.precision !== null) {
      precision = capabilities.getMaxPrecision(material.precision);

      if (precision !== material.precision) {
        console.warn("keel/lit programs.getParameters:", material.precision, "not supported, using", precision, "instead.");
      }
    }

    //

    const morphAttribute = geometry.morphAttributes["position"] || geometry.morphAttributes["normal"] || geometry.morphAttributes["color"];
    const morphTargetsCount = (morphAttribute !== undefined) ? morphAttribute.length : 0;

    let morphTextureStride = 0;

    if (geometry.morphAttributes["position"] !== undefined) morphTextureStride = 1;
    if (geometry.morphAttributes["normal"] !== undefined) morphTextureStride = 2;
    if (geometry.morphAttributes["color"] !== undefined) morphTextureStride = 3;

    //

    let vertexShader: string, fragmentShader: string;
    let customVertexShaderID: number | undefined, customFragmentShaderID: number | undefined;

    if (shaderID) {
      const shader = LIBRARY[shaderID];

      vertexShader = shader.vertexShader;
      fragmentShader = shader.fragmentShader;
    } else {
      vertexShader = material.vertexShader!;
      fragmentShader = material.fragmentShader!;

      const custom = material as ProgramMaterial & { vertexShader: string; fragmentShader: string };

      _customShaders.update(custom);

      customVertexShaderID = _customShaders.getVertexShaderID(custom);
      customFragmentShaderID = _customShaders.getFragmentShaderID(custom);
    }

    const currentRenderTarget = renderer.getRenderTarget();
    const reversedDepthBuffer = renderer.state.buffers.depth.getReversed();

    const IS_INSTANCEDMESH = object.isInstancedMesh === true;
    const IS_BATCHEDMESH = object.isBatchedMesh === true;

    const HAS_MAP = !!material.map;
    const HAS_MATCAP = !!material.matcap;
    const HAS_ENVMAP = !!envMap;
    const HAS_AOMAP = !!material.aoMap;
    const HAS_LIGHTMAP = !!material.lightMap;
    const HAS_BUMPMAP = !!material.bumpMap;
    const HAS_NORMALMAP = !!material.normalMap;
    const HAS_DISPLACEMENTMAP = !!material.displacementMap;
    const HAS_EMISSIVEMAP = !!material.emissiveMap;

    const HAS_METALNESSMAP = !!material.metalnessMap;
    const HAS_ROUGHNESSMAP = !!material.roughnessMap;

    // (`undefined > 0` is false, as in r180, for the classes without these factors)
    const HAS_ANISOTROPY = (material.anisotropy as number) > 0;
    const HAS_CLEARCOAT = (material.clearcoat as number) > 0;
    const HAS_DISPERSION = (material.dispersion as number) > 0;
    const HAS_IRIDESCENCE = (material.iridescence as number) > 0;
    const HAS_SHEEN = (material.sheen as number) > 0;
    const HAS_TRANSMISSION = (material.transmission as number) > 0;

    const HAS_ANISOTROPYMAP = HAS_ANISOTROPY && !!material.anisotropyMap;

    const HAS_CLEARCOATMAP = HAS_CLEARCOAT && !!material.clearcoatMap;
    const HAS_CLEARCOAT_NORMALMAP = HAS_CLEARCOAT && !!material.clearcoatNormalMap;
    const HAS_CLEARCOAT_ROUGHNESSMAP = HAS_CLEARCOAT && !!material.clearcoatRoughnessMap;

    const HAS_IRIDESCENCEMAP = HAS_IRIDESCENCE && !!material.iridescenceMap;
    const HAS_IRIDESCENCE_THICKNESSMAP = HAS_IRIDESCENCE && !!material.iridescenceThicknessMap;

    const HAS_SHEEN_COLORMAP = HAS_SHEEN && !!material.sheenColorMap;
    const HAS_SHEEN_ROUGHNESSMAP = HAS_SHEEN && !!material.sheenRoughnessMap;

    const HAS_SPECULARMAP = !!material.specularMap;
    const HAS_SPECULAR_COLORMAP = !!material.specularColorMap;
    const HAS_SPECULAR_INTENSITYMAP = !!material.specularIntensityMap;

    const HAS_TRANSMISSIONMAP = HAS_TRANSMISSION && !!material.transmissionMap;
    const HAS_THICKNESSMAP = HAS_TRANSMISSION && !!material.thicknessMap;

    const HAS_GRADIENTMAP = !!material.gradientMap;

    const HAS_ALPHAMAP = !!material.alphaMap;

    const HAS_ALPHATEST = material.alphaTest > 0;

    const HAS_ALPHAHASH = !!material.alphaHash;

    const HAS_EXTENSIONS = !!material.extensions;

    let toneMapping: ToneMapping = "none";

    if (material.toneMapped) {
      if (currentRenderTarget === null || currentRenderTarget.isXRRenderTarget === true) {
        toneMapping = renderer.toneMapping;
      }
    }

    const parameters: ProgramParameters = {
      shaderID: shaderID,
      shaderType: R180_MATERIAL_TYPE[material.type] ?? material.type,
      shaderName: material.name,

      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      defines: material.defines,

      customVertexShaderID: customVertexShaderID,
      customFragmentShaderID: customFragmentShaderID,

      isRawShaderMaterial: material.isRawShaderMaterial === true,
      glslVersion: material.glslVersion,

      precision: precision,

      batching: IS_BATCHEDMESH,
      batchingColor: IS_BATCHEDMESH && object._colorsTexture !== null,
      instancing: IS_INSTANCEDMESH,
      instancingColor: IS_INSTANCEDMESH && object.instanceColor !== null,
      instancingMorph: IS_INSTANCEDMESH && object.morphTexture !== null,

      supportsVertexTextures: SUPPORTS_VERTEX_TEXTURES,
      outputColorSpace: (currentRenderTarget === null) ? renderer.outputColorSpace : (currentRenderTarget.isXRRenderTarget === true ? currentRenderTarget.texture.colorSpace : "linear"),
      alphaToCoverage: !!material.alphaToCoverage,

      map: HAS_MAP,
      matcap: HAS_MATCAP,
      envMap: HAS_ENVMAP,
      envMapMode: HAS_ENVMAP && envMap!.mapping,
      envMapCubeUVHeight: envMapCubeUVHeight,
      aoMap: HAS_AOMAP,
      lightMap: HAS_LIGHTMAP,
      bumpMap: HAS_BUMPMAP,
      normalMap: HAS_NORMALMAP,
      displacementMap: SUPPORTS_VERTEX_TEXTURES && HAS_DISPLACEMENTMAP,
      emissiveMap: HAS_EMISSIVEMAP,

      normalMapObjectSpace: HAS_NORMALMAP && material.normalMapType === "object",
      normalMapTangentSpace: HAS_NORMALMAP && material.normalMapType === "tangent",

      metalnessMap: HAS_METALNESSMAP,
      roughnessMap: HAS_ROUGHNESSMAP,

      anisotropy: HAS_ANISOTROPY,
      anisotropyMap: HAS_ANISOTROPYMAP,

      clearcoat: HAS_CLEARCOAT,
      clearcoatMap: HAS_CLEARCOATMAP,
      clearcoatNormalMap: HAS_CLEARCOAT_NORMALMAP,
      clearcoatRoughnessMap: HAS_CLEARCOAT_ROUGHNESSMAP,

      dispersion: HAS_DISPERSION,

      iridescence: HAS_IRIDESCENCE,
      iridescenceMap: HAS_IRIDESCENCEMAP,
      iridescenceThicknessMap: HAS_IRIDESCENCE_THICKNESSMAP,

      sheen: HAS_SHEEN,
      sheenColorMap: HAS_SHEEN_COLORMAP,
      sheenRoughnessMap: HAS_SHEEN_ROUGHNESSMAP,

      specularMap: HAS_SPECULARMAP,
      specularColorMap: HAS_SPECULAR_COLORMAP,
      specularIntensityMap: HAS_SPECULAR_INTENSITYMAP,

      transmission: HAS_TRANSMISSION,
      transmissionMap: HAS_TRANSMISSIONMAP,
      thicknessMap: HAS_THICKNESSMAP,

      gradientMap: HAS_GRADIENTMAP,

      opaque: material.transparent === false && material.blending === "normal" && material.alphaToCoverage === false,

      alphaMap: HAS_ALPHAMAP,
      alphaTest: HAS_ALPHATEST,
      alphaHash: HAS_ALPHAHASH,

      combine: material.combine,

      //

      mapUv: HAS_MAP && getChannel(material.map!.channel),
      aoMapUv: HAS_AOMAP && getChannel(material.aoMap!.channel),
      lightMapUv: HAS_LIGHTMAP && getChannel(material.lightMap!.channel),
      bumpMapUv: HAS_BUMPMAP && getChannel(material.bumpMap!.channel),
      normalMapUv: HAS_NORMALMAP && getChannel(material.normalMap!.channel),
      displacementMapUv: HAS_DISPLACEMENTMAP && getChannel(material.displacementMap!.channel),
      emissiveMapUv: HAS_EMISSIVEMAP && getChannel(material.emissiveMap!.channel),

      metalnessMapUv: HAS_METALNESSMAP && getChannel(material.metalnessMap!.channel),
      roughnessMapUv: HAS_ROUGHNESSMAP && getChannel(material.roughnessMap!.channel),

      anisotropyMapUv: HAS_ANISOTROPYMAP && getChannel(material.anisotropyMap!.channel),

      clearcoatMapUv: HAS_CLEARCOATMAP && getChannel(material.clearcoatMap!.channel),
      clearcoatNormalMapUv: HAS_CLEARCOAT_NORMALMAP && getChannel(material.clearcoatNormalMap!.channel),
      clearcoatRoughnessMapUv: HAS_CLEARCOAT_ROUGHNESSMAP && getChannel(material.clearcoatRoughnessMap!.channel),

      iridescenceMapUv: HAS_IRIDESCENCEMAP && getChannel(material.iridescenceMap!.channel),
      iridescenceThicknessMapUv: HAS_IRIDESCENCE_THICKNESSMAP && getChannel(material.iridescenceThicknessMap!.channel),

      sheenColorMapUv: HAS_SHEEN_COLORMAP && getChannel(material.sheenColorMap!.channel),
      sheenRoughnessMapUv: HAS_SHEEN_ROUGHNESSMAP && getChannel(material.sheenRoughnessMap!.channel),

      specularMapUv: HAS_SPECULARMAP && getChannel(material.specularMap!.channel),
      specularColorMapUv: HAS_SPECULAR_COLORMAP && getChannel(material.specularColorMap!.channel),
      specularIntensityMapUv: HAS_SPECULAR_INTENSITYMAP && getChannel(material.specularIntensityMap!.channel),

      transmissionMapUv: HAS_TRANSMISSIONMAP && getChannel(material.transmissionMap!.channel),
      thicknessMapUv: HAS_THICKNESSMAP && getChannel(material.thicknessMap!.channel),

      alphaMapUv: HAS_ALPHAMAP && getChannel(material.alphaMap!.channel),

      //

      vertexTangents: !!geometry.attributes["tangent"] && (HAS_NORMALMAP || HAS_ANISOTROPY),
      vertexColors: material.vertexColors,
      vertexAlphas: material.vertexColors === true && !!geometry.attributes["color"] && geometry.attributes["color"].itemSize === 4,

      pointsUvs: object.isPoints === true && !!geometry.attributes["uv"] && (HAS_MAP || HAS_ALPHAMAP),

      fog: !!fog,
      useFog: material.fog === true,
      // (r180: undefined, not false, under a linear Fog; the cache key shows it)
      fogExp2: (!!fog && fog.isFogExp2),

      flatShading: (material.flatShading === true && material.wireframe === false),

      sizeAttenuation: material.sizeAttenuation === true,
      logarithmicDepthBuffer: logarithmicDepthBuffer,
      reversedDepthBuffer: reversedDepthBuffer,

      skinning: object.isSkinnedMesh === true,

      morphTargets: geometry.morphAttributes["position"] !== undefined,
      morphNormals: geometry.morphAttributes["normal"] !== undefined,
      morphColors: geometry.morphAttributes["color"] !== undefined,
      morphTargetsCount: morphTargetsCount,
      morphTextureStride: morphTextureStride,

      numDirLights: lights.directional.length,
      numPointLights: lights.point.length,
      numSpotLights: lights.spot.length,
      numSpotLightMaps: lights.spotLightMap.length,
      numRectAreaLights: lights.rectArea.length,
      numHemiLights: lights.hemi.length,

      numDirLightShadows: lights.directionalShadowMap.length,
      numPointLightShadows: lights.pointShadowMap.length,
      numSpotLightShadows: lights.spotShadowMap.length,
      numSpotLightShadowsWithMaps: lights.numSpotLightShadowsWithMaps,

      numLightProbes: lights.numLightProbes,

      numClippingPlanes: clipping.numPlanes,
      numClipIntersection: clipping.numIntersection,

      dithering: material.dithering,

      shadowMapEnabled: renderer.shadowMap.enabled && shadows.length > 0,
      shadowMapType: renderer.shadowMap.type,

      toneMapping: toneMapping,

      decodeVideoTexture: HAS_MAP && (material.map!.isVideoTexture === true) && (colorManagement.getTransfer(material.map!.colorSpace) === "srgb"),
      decodeVideoTextureEmissive: HAS_EMISSIVEMAP && (material.emissiveMap!.isVideoTexture === true) && (colorManagement.getTransfer(material.emissiveMap!.colorSpace) === "srgb"),

      premultipliedAlpha: material.premultipliedAlpha,

      doubleSided: material.side === "both",
      flipSided: material.side === "back",

      // (r180: depthPacking >= 0, true for the depth material only; || 0 for the others)
      useDepthPacking: material.depthPacking !== undefined && R180.depthPacking[material.depthPacking] >= 0,
      depthPacking: (material.depthPacking !== undefined ? R180.depthPacking[material.depthPacking] : 0) || 0,

      index0AttributeName: material.index0AttributeName,

      extensionClipCullDistance: HAS_EXTENSIONS && material.extensions!.clipCullDistance === true && extensions.has("WEBGL_clip_cull_distance"),
      extensionMultiDraw: (HAS_EXTENSIONS && material.extensions!.multiDraw === true || IS_BATCHEDMESH) && extensions.has("WEBGL_multi_draw"),

      rendererExtensionParallelShaderCompile: extensions.has("KHR_parallel_shader_compile"),

      customProgramCacheKey: material.customProgramCacheKey(),

      // the usage of getChannel() determines the active texture channels for this shader

      vertexUv1s: false,
      vertexUv2s: false,
      vertexUv3s: false,
    };

    parameters.vertexUv1s = _activeChannels.has(1);
    parameters.vertexUv2s = _activeChannels.has(2);
    parameters.vertexUv3s = _activeChannels.has(3);

    _activeChannels.clear();

    return parameters;
  }

  function getProgramCacheKey(parameters: ProgramParameters): string {
    const array: unknown[] = [];

    if (parameters.shaderID) {
      array.push(parameters.shaderID);
    } else {
      array.push(parameters.customVertexShaderID);
      array.push(parameters.customFragmentShaderID);
    }

    if (parameters.defines !== undefined) {
      for (const name in parameters.defines) {
        array.push(name);
        array.push(parameters.defines[name]);
      }
    }

    if (parameters.isRawShaderMaterial === false) {
      getProgramCacheKeyParameters(array, parameters);
      getProgramCacheKeyBooleans(array, parameters);
      array.push(COLOR_SPACE[renderer.outputColorSpace]);
    }

    array.push(parameters.customProgramCacheKey);

    return array.join();
  }

  function getProgramCacheKeyParameters(array: unknown[], parameters: ProgramParameters): void {
    array.push(parameters.precision);
    array.push(COLOR_SPACE[parameters.outputColorSpace]);
    array.push(parameters.envMapMode ? R180.mapping[parameters.envMapMode] : parameters.envMapMode);
    array.push(parameters.envMapCubeUVHeight);
    array.push(parameters.mapUv);
    array.push(parameters.alphaMapUv);
    array.push(parameters.lightMapUv);
    array.push(parameters.aoMapUv);
    array.push(parameters.bumpMapUv);
    array.push(parameters.normalMapUv);
    array.push(parameters.displacementMapUv);
    array.push(parameters.emissiveMapUv);
    array.push(parameters.metalnessMapUv);
    array.push(parameters.roughnessMapUv);
    array.push(parameters.anisotropyMapUv);
    array.push(parameters.clearcoatMapUv);
    array.push(parameters.clearcoatNormalMapUv);
    array.push(parameters.clearcoatRoughnessMapUv);
    array.push(parameters.iridescenceMapUv);
    array.push(parameters.iridescenceThicknessMapUv);
    array.push(parameters.sheenColorMapUv);
    array.push(parameters.sheenRoughnessMapUv);
    array.push(parameters.specularMapUv);
    array.push(parameters.specularColorMapUv);
    array.push(parameters.specularIntensityMapUv);
    array.push(parameters.transmissionMapUv);
    array.push(parameters.thicknessMapUv);
    array.push(parameters.combine === undefined ? undefined : R180.combine[parameters.combine]);
    array.push(parameters.fogExp2);
    array.push(parameters.sizeAttenuation);
    array.push(parameters.morphTargetsCount);
    array.push(parameters["morphAttributeCount"]); // (r180 pushes a field it never sets: always empty)
    array.push(parameters.numDirLights);
    array.push(parameters.numPointLights);
    array.push(parameters.numSpotLights);
    array.push(parameters.numSpotLightMaps);
    array.push(parameters.numHemiLights);
    array.push(parameters.numRectAreaLights);
    array.push(parameters.numDirLightShadows);
    array.push(parameters.numPointLightShadows);
    array.push(parameters.numSpotLightShadows);
    array.push(parameters.numSpotLightShadowsWithMaps);
    array.push(parameters.numLightProbes);
    array.push(R180.shadowMapType[parameters.shadowMapType]);
    array.push(R180.toneMapping[parameters.toneMapping]);
    array.push(parameters.numClippingPlanes);
    array.push(parameters.numClipIntersection);
    array.push(parameters.depthPacking);
  }

  function getProgramCacheKeyBooleans(array: unknown[], parameters: ProgramParameters): void {
    _programLayers.disableAll();

    if (parameters.supportsVertexTextures)
      _programLayers.enable(0);
    if (parameters.instancing)
      _programLayers.enable(1);
    if (parameters.instancingColor)
      _programLayers.enable(2);
    if (parameters.instancingMorph)
      _programLayers.enable(3);
    if (parameters.matcap)
      _programLayers.enable(4);
    if (parameters.envMap)
      _programLayers.enable(5);
    if (parameters.normalMapObjectSpace)
      _programLayers.enable(6);
    if (parameters.normalMapTangentSpace)
      _programLayers.enable(7);
    if (parameters.clearcoat)
      _programLayers.enable(8);
    if (parameters.iridescence)
      _programLayers.enable(9);
    if (parameters.alphaTest)
      _programLayers.enable(10);
    if (parameters.vertexColors)
      _programLayers.enable(11);
    if (parameters.vertexAlphas)
      _programLayers.enable(12);
    if (parameters.vertexUv1s)
      _programLayers.enable(13);
    if (parameters.vertexUv2s)
      _programLayers.enable(14);
    if (parameters.vertexUv3s)
      _programLayers.enable(15);
    if (parameters.vertexTangents)
      _programLayers.enable(16);
    if (parameters.anisotropy)
      _programLayers.enable(17);
    if (parameters.alphaHash)
      _programLayers.enable(18);
    if (parameters.batching)
      _programLayers.enable(19);
    if (parameters.dispersion)
      _programLayers.enable(20);
    if (parameters.batchingColor)
      _programLayers.enable(21);
    if (parameters.gradientMap)
      _programLayers.enable(22);

    array.push(_programLayers.mask);
    _programLayers.disableAll();

    if (parameters.fog)
      _programLayers.enable(0);
    if (parameters.useFog)
      _programLayers.enable(1);
    if (parameters.flatShading)
      _programLayers.enable(2);
    if (parameters.logarithmicDepthBuffer)
      _programLayers.enable(3);
    if (parameters.reversedDepthBuffer)
      _programLayers.enable(4);
    if (parameters.skinning)
      _programLayers.enable(5);
    if (parameters.morphTargets)
      _programLayers.enable(6);
    if (parameters.morphNormals)
      _programLayers.enable(7);
    if (parameters.morphColors)
      _programLayers.enable(8);
    if (parameters.premultipliedAlpha)
      _programLayers.enable(9);
    if (parameters.shadowMapEnabled)
      _programLayers.enable(10);
    if (parameters.doubleSided)
      _programLayers.enable(11);
    if (parameters.flipSided)
      _programLayers.enable(12);
    if (parameters.useDepthPacking)
      _programLayers.enable(13);
    if (parameters.dithering)
      _programLayers.enable(14);
    if (parameters.transmission)
      _programLayers.enable(15);
    if (parameters.sheen)
      _programLayers.enable(16);
    if (parameters.opaque)
      _programLayers.enable(17);
    if (parameters.pointsUvs)
      _programLayers.enable(18);
    if (parameters.decodeVideoTexture)
      _programLayers.enable(19);
    if (parameters.decodeVideoTextureEmissive)
      _programLayers.enable(20);
    if (parameters.alphaToCoverage)
      _programLayers.enable(21);

    array.push(_programLayers.mask);
  }

  function getUniforms(material: ProgramMaterial): Uniforms {
    const shaderID = shaderIDs[material.type];
    let uniforms: Uniforms;

    if (shaderID) {
      const shader = LIBRARY[shaderID];
      uniforms = realizeUniforms(shader.uniforms(), maker);
    } else {
      uniforms = material.uniforms!;
    }

    return uniforms;
  }

  function acquireProgram(parameters: ProgramParameters, cacheKey: string): LitProgram {
    let program: LitProgram | undefined;

    // Check if code has been already compiled
    for (let p = 0, pl = programs.length; p < pl; p++) {
      const preexistingProgram = programs[p]!;

      if (preexistingProgram.cacheKey === cacheKey) {
        program = preexistingProgram;
        ++program.usedTimes;

        break;
      }
    }

    if (program === undefined) {
      program = createProgram(renderer, cacheKey, parameters, bindingStates);
      programs.push(program);
    }

    return program;
  }

  function releaseProgram(program: LitProgram): void {
    if (--program.usedTimes === 0) {
      // Remove from unordered set
      const i = programs.indexOf(program);
      programs[i] = programs[programs.length - 1]!;
      programs.pop();

      // Free WebGL resources
      program.destroy();
    }
  }

  function releaseShaderCache(material: ProgramMaterial): void {
    _customShaders.remove(material as ProgramMaterial & { vertexShader: string; fragmentShader: string });
  }

  function dispose(): void {
    _customShaders.dispose();
  }

  return {
    getParameters: getParameters,
    getProgramCacheKey: getProgramCacheKey,
    getUniforms: getUniforms,
    acquireProgram: acquireProgram,
    releaseProgram: releaseProgram,
    releaseShaderCache: releaseShaderCache,
    // Exposed for resource monitoring & error feedback via renderer.info:
    programs: programs,
    dispose: dispose,
  };
}
