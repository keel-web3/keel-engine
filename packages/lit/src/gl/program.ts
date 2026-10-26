// Ported from Three.js r180's renderers/webgl/WebGLProgram.js and
// WebGLShader.js (MIT, see packages/lit/NOTICE).
//
// Assembles a program's GLSL exactly as r180 does: the vertex and fragment
// prefixes line for line (precision, SHADER_TYPE / SHADER_NAME, the
// material's defines, one #define per parameter that is on), the GLSL 3
// conversion lines and `#version 300 es`, `#include <chunk>` resolved from
// src/shader's CHUNKS (recursively, r180's pattern), the light and clipping
// counts substituted, and `#pragma unroll_loop_start` loops unrolled. The text
// handed to gl.shaderSource is byte for byte the one r180 hands it for the same
// parameters, so the GPU compiles the same code.
//
// SHADER_TYPE carries r180's material type name (programs.ts puts it in
// `parameters.shaderType`): it is part of the GLSL. Parameters that r180 holds
// as numeric constants (toneMapping, shadowMapType, envMapMode, combine) are
// KEEL's typed strings here, read through the same switches.

import { CHUNKS, PREFIX_CHUNKS } from "../shader/chunks.ts";
import { colorManagement } from "../math/ColorManagement.ts";
import type { ColorSpace } from "../math/types.ts";
import { Matrix3 } from "../math/Matrix3.ts";
import { Vector3 } from "../math/Vector3.ts";
import type { ToneMapping } from "../constants.ts";
import { createUniforms } from "./uniforms.ts";
import type { ProgramUniforms } from "./uniforms.ts";
import type { ProgramParameters } from "./programs.ts";

// From https://www.khronos.org/registry/webgl/extensions/KHR_parallel_shader_compile/
const COMPLETION_STATUS_KHR = 0x91b1;

let programIdCount = 0;

function handleSource(string: string, errorLine: number): string {
  const lines = string.split("\n");
  const lines2: string[] = [];

  const from = Math.max(errorLine - 6, 0);
  const to = Math.min(errorLine + 6, lines.length);

  for (let i = from; i < to; i++) {
    const line = i + 1;
    lines2.push(`${line === errorLine ? ">" : " "} ${line}: ${lines[i]}`);
  }

  return lines2.join("\n");
}

const _m0 = /*@__PURE__*/ new Matrix3();

function getEncodingComponents(colorSpace: ColorSpace): [string, string] {
  colorManagement._getMatrix(_m0, colorManagement.workingColorSpace, colorSpace);

  const encodingMatrix = `mat3( ${_m0.elements.map((v) => v.toFixed(4))} )`;

  switch (colorManagement.getTransfer(colorSpace)) {
    case "linear":
      return [encodingMatrix, "LinearTransferOETF"];

    case "srgb":
      return [encodingMatrix, "sRGBTransferOETF"];

    default:
      console.warn("keel/lit program: Unsupported color space: ", colorSpace);
      return [encodingMatrix, "LinearTransferOETF"];
  }
}

function getShaderErrors(gl: WebGL2RenderingContext, shader: WebGLShader, type: string): string {
  const status = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;

  const shaderInfoLog = gl.getShaderInfoLog(shader) || "";
  const errors = shaderInfoLog.trim();

  if (status && errors === "") return "";

  const errorMatches = /ERROR: 0:(\d+)/.exec(errors);
  if (errorMatches) {
    // --enable-privileged-webgl-extension
    // console.log( '**' + type + '**', gl.getExtension( 'WEBGL_debug_shaders' ).getTranslatedShaderSource( shader ) );

    const errorLine = parseInt(errorMatches[1]!);
    return type.toUpperCase() + "\n\n" + errors + "\n\n" + handleSource(gl.getShaderSource(shader) ?? "", errorLine);
  } else {
    return errors;
  }
}

function getTexelEncodingFunction(functionName: string, colorSpace: ColorSpace): string {
  const components = getEncodingComponents(colorSpace);

  return [
    `vec4 ${functionName}( vec4 value ) {`,

    `	return ${components[1]}( vec4( value.rgb * ${components[0]}, value.a ) );`,

    "}",
  ].join("\n");
}

function getToneMappingFunction(functionName: string, toneMapping: ToneMapping): string {
  let toneMappingName;

  switch (toneMapping) {
    case "linear":
      toneMappingName = "Linear";
      break;

    case "reinhard":
      toneMappingName = "Reinhard";
      break;

    case "cineon":
      toneMappingName = "Cineon";
      break;

    case "aces-filmic":
      toneMappingName = "ACESFilmic";
      break;

    case "agx":
      toneMappingName = "AgX";
      break;

    case "neutral":
      toneMappingName = "Neutral";
      break;

    case "custom":
      toneMappingName = "Custom";
      break;

    default:
      console.warn("keel/lit program: Unsupported toneMapping:", toneMapping);
      toneMappingName = "Linear";
  }

  return "vec3 " + functionName + "( vec3 color ) { return " + toneMappingName + "ToneMapping( color ); }";
}

const _v0 = /*@__PURE__*/ new Vector3();

function getLuminanceFunction(): string {
  colorManagement.getLuminanceCoefficients(_v0);

  const r = _v0.x.toFixed(4);
  const g = _v0.y.toFixed(4);
  const b = _v0.z.toFixed(4);

  return [
    "float luminance( const in vec3 rgb ) {",

    `	const vec3 weights = vec3( ${r}, ${g}, ${b} );`,

    "	return dot( weights, rgb );",

    "}",
  ].join("\n");
}

function generateVertexExtensions(parameters: ProgramParameters): string {
  const chunks = [
    parameters.extensionClipCullDistance ? "#extension GL_ANGLE_clip_cull_distance : require" : "",
    parameters.extensionMultiDraw ? "#extension GL_ANGLE_multi_draw : require" : "",
  ];

  return chunks.filter(filterEmptyLine).join("\n");
}

function generateDefines(defines: Readonly<Record<string, unknown>> | undefined): string {
  const chunks: string[] = [];

  for (const name in defines) {
    const value = defines[name];

    if (value === false) continue;

    chunks.push("#define " + name + " " + String(value));
  }

  return chunks.join("\n");
}

/** One active attribute, as r180's fetchAttributeLocations records it. */
export interface ProgramAttribute {
  type: number;
  location: number;
  locationSize: number;
}

function fetchAttributeLocations(gl: WebGL2RenderingContext, program: WebGLProgram): Record<string, ProgramAttribute> {
  const attributes: Record<string, ProgramAttribute> = {};

  const n = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number;

  for (let i = 0; i < n; i++) {
    const info = gl.getActiveAttrib(program, i)!;
    const name = info.name;

    let locationSize = 1;
    if (info.type === gl.FLOAT_MAT2) locationSize = 2;
    if (info.type === gl.FLOAT_MAT3) locationSize = 3;
    if (info.type === gl.FLOAT_MAT4) locationSize = 4;

    // console.log( 'THREE.WebGLProgram: ACTIVE VERTEX ATTRIBUTE:', name, i );

    attributes[name] = {
      type: info.type,
      location: gl.getAttribLocation(program, name),
      locationSize: locationSize,
    };
  }

  return attributes;
}

function filterEmptyLine(string: string): boolean {
  return string !== "";
}

/** r180's replaceLightNums: the light counts into the program text. */
export function replaceLightNums(string: string, parameters: ProgramParameters): string {
  const numSpotLightCoords = parameters.numSpotLightShadows + parameters.numSpotLightMaps - parameters.numSpotLightShadowsWithMaps;

  return string
    .replace(/NUM_DIR_LIGHTS/g, String(parameters.numDirLights))
    .replace(/NUM_SPOT_LIGHTS/g, String(parameters.numSpotLights))
    .replace(/NUM_SPOT_LIGHT_MAPS/g, String(parameters.numSpotLightMaps))
    .replace(/NUM_SPOT_LIGHT_COORDS/g, String(numSpotLightCoords))
    .replace(/NUM_RECT_AREA_LIGHTS/g, String(parameters.numRectAreaLights))
    .replace(/NUM_POINT_LIGHTS/g, String(parameters.numPointLights))
    .replace(/NUM_HEMI_LIGHTS/g, String(parameters.numHemiLights))
    .replace(/NUM_DIR_LIGHT_SHADOWS/g, String(parameters.numDirLightShadows))
    .replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g, String(parameters.numSpotLightShadowsWithMaps))
    .replace(/NUM_SPOT_LIGHT_SHADOWS/g, String(parameters.numSpotLightShadows))
    .replace(/NUM_POINT_LIGHT_SHADOWS/g, String(parameters.numPointLightShadows));
}

/** r180's replaceClippingPlaneNums. */
export function replaceClippingPlaneNums(string: string, parameters: ProgramParameters): string {
  return string
    .replace(/NUM_CLIPPING_PLANES/g, String(parameters.numClippingPlanes))
    .replace(/UNION_CLIPPING_PLANES/g, String(parameters.numClippingPlanes - parameters.numClipIntersection));
}

// Resolve Includes

const includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;

/** r180's resolveIncludes: every `#include <name>` replaced by its chunk (from CHUNKS), recursively. */
export function resolveIncludes(string: string): string {
  return string.replace(includePattern, includeReplacer);
}

// (r180 maps renamed chunks here; r180 has none left in its table)
const shaderChunkMap = new Map<string, string>();

function includeReplacer(_match: string, include: string): string {
  let string = CHUNKS[include];

  if (string === undefined) {
    const newInclude = shaderChunkMap.get(include);

    if (newInclude !== undefined) {
      string = CHUNKS[newInclude]!;
      console.warn('keel/lit renderer: Shader chunk "%s" has been deprecated. Use "%s" instead.', include, newInclude);
    } else {
      throw new Error("Can not resolve #include <" + include + ">");
    }
  }

  return resolveIncludes(string);
}

// Unroll Loops

const unrollLoopPattern = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;

/** r180's unrollLoops. */
export function unrollLoops(string: string): string {
  return string.replace(unrollLoopPattern, loopReplacer);
}

function loopReplacer(_match: string, start: string, end: string, snippet: string): string {
  let string = "";

  for (let i = parseInt(start); i < parseInt(end); i++) {
    string += snippet
      .replace(/\[\s*i\s*\]/g, "[ " + i + " ]")
      .replace(/UNROLLED_LOOP_INDEX/g, String(i));
  }

  return string;
}

//

function generatePrecision(parameters: ProgramParameters): string {
  let precisionstring = `precision ${parameters.precision} float;
	precision ${parameters.precision} int;
	precision ${parameters.precision} sampler2D;
	precision ${parameters.precision} samplerCube;
	precision ${parameters.precision} sampler3D;
	precision ${parameters.precision} sampler2DArray;
	precision ${parameters.precision} sampler2DShadow;
	precision ${parameters.precision} samplerCubeShadow;
	precision ${parameters.precision} sampler2DArrayShadow;
	precision ${parameters.precision} isampler2D;
	precision ${parameters.precision} isampler3D;
	precision ${parameters.precision} isamplerCube;
	precision ${parameters.precision} isampler2DArray;
	precision ${parameters.precision} usampler2D;
	precision ${parameters.precision} usampler3D;
	precision ${parameters.precision} usamplerCube;
	precision ${parameters.precision} usampler2DArray;
	`;

  if (parameters.precision === "highp") {
    precisionstring += "\n#define HIGH_PRECISION";
  } else if (parameters.precision === "mediump") {
    precisionstring += "\n#define MEDIUM_PRECISION";
  } else if (parameters.precision === "lowp") {
    precisionstring += "\n#define LOW_PRECISION";
  }

  return precisionstring;
}

function generateShadowMapTypeDefine(parameters: ProgramParameters): string {
  let shadowMapTypeDefine = "SHADOWMAP_TYPE_BASIC";

  if (parameters.shadowMapType === "pcf") {
    shadowMapTypeDefine = "SHADOWMAP_TYPE_PCF";
  } else if (parameters.shadowMapType === "pcf-soft") {
    shadowMapTypeDefine = "SHADOWMAP_TYPE_PCF_SOFT";
  } else if (parameters.shadowMapType === "vsm") {
    shadowMapTypeDefine = "SHADOWMAP_TYPE_VSM";
  }

  return shadowMapTypeDefine;
}

function generateEnvMapTypeDefine(parameters: ProgramParameters): string {
  let envMapTypeDefine = "ENVMAP_TYPE_CUBE";

  if (parameters.envMap) {
    switch (parameters.envMapMode) {
      case "cube-reflection":
      case "cube-refraction":
        envMapTypeDefine = "ENVMAP_TYPE_CUBE";
        break;

      case "cube-uv-reflection":
        envMapTypeDefine = "ENVMAP_TYPE_CUBE_UV";
        break;
    }
  }

  return envMapTypeDefine;
}

function generateEnvMapModeDefine(parameters: ProgramParameters): string {
  let envMapModeDefine = "ENVMAP_MODE_REFLECTION";

  if (parameters.envMap) {
    switch (parameters.envMapMode) {
      case "cube-refraction":
        envMapModeDefine = "ENVMAP_MODE_REFRACTION";
        break;
    }
  }

  return envMapModeDefine;
}

function generateEnvMapBlendingDefine(parameters: ProgramParameters): string {
  let envMapBlendingDefine = "ENVMAP_BLENDING_NONE";

  if (parameters.envMap) {
    switch (parameters.combine) {
      case "multiply":
        envMapBlendingDefine = "ENVMAP_BLENDING_MULTIPLY";
        break;

      case "mix":
        envMapBlendingDefine = "ENVMAP_BLENDING_MIX";
        break;

      case "add":
        envMapBlendingDefine = "ENVMAP_BLENDING_ADD";
        break;
    }
  }

  return envMapBlendingDefine;
}

function generateCubeUVSize(parameters: ProgramParameters): { texelWidth: number; texelHeight: number; maxMip: number } | null {
  const imageHeight = parameters.envMapCubeUVHeight;

  if (imageHeight === null) return null;

  const maxMip = Math.log2(imageHeight) - 2;

  const texelHeight = 1.0 / imageHeight;

  const texelWidth = 1.0 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16));

  return { texelWidth, texelHeight, maxMip };
}

/** r180's WebGLShader: a compiled shader stage. */
export function createShader(gl: WebGL2RenderingContext, type: number, string: string): WebGLShader {
  const shader = gl.createShader(type)!;

  gl.shaderSource(shader, string);
  gl.compileShader(shader);

  return shader;
}

/** What a program needs of the renderer. */
export interface ProgramRenderer {
  getContext(): WebGL2RenderingContext;
  readonly debug: {
    checkShaderErrors: boolean;
    onShaderError: ((gl: WebGL2RenderingContext, program: WebGLProgram, glVertexShader: WebGLShader, glFragmentShader: WebGLShader) => void) | null;
  };
}

/** What a program needs of the binding states (r180's WebGLBindingStates). */
export interface ProgramBindingStates {
  releaseStatesOfProgram(program: LitProgram): void;
}

export interface ProgramDiagnostics {
  runnable: boolean;
  programLog: string;
  vertexShader: { log: string; prefix: string };
  fragmentShader: { log: string; prefix: string };
}

/** A linked program (r180's WebGLProgram instance). */
export interface LitProgram {
  getUniforms(): ProgramUniforms;
  getAttributes(): Record<string, ProgramAttribute>;
  isReady(): boolean;
  destroy(): void;
  type: string;
  name: string;
  id: number;
  cacheKey: string;
  usedTimes: number;
  program: WebGLProgram | undefined;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
  diagnostics?: ProgramDiagnostics;
}

/** r180's `new WebGLProgram( renderer, cacheKey, parameters, bindingStates )`. */
export function createProgram(renderer: ProgramRenderer, cacheKey: string, parameters: ProgramParameters, bindingStates: ProgramBindingStates): LitProgram {
  // TODO Send this event to Three.js DevTools
  // console.log( 'WebGLProgram', cacheKey );

  const gl = renderer.getContext();

  const defines = parameters.defines;

  let vertexShader = parameters.vertexShader;
  let fragmentShader = parameters.fragmentShader;

  const shadowMapTypeDefine = generateShadowMapTypeDefine(parameters);
  const envMapTypeDefine = generateEnvMapTypeDefine(parameters);
  const envMapModeDefine = generateEnvMapModeDefine(parameters);
  const envMapBlendingDefine = generateEnvMapBlendingDefine(parameters);
  const envMapCubeUVSize = generateCubeUVSize(parameters);

  const customVertexExtensions = generateVertexExtensions(parameters);

  const customDefines = generateDefines(defines);

  const program = gl.createProgram()!;

  let prefixVertex: string, prefixFragment: string;
  let versionString = parameters.glslVersion ? "#version " + parameters.glslVersion + "\n" : "";

  if (parameters.isRawShaderMaterial) {
    prefixVertex = [
      "#define SHADER_TYPE " + parameters.shaderType,
      "#define SHADER_NAME " + parameters.shaderName,

      customDefines,
    ].filter(filterEmptyLine).join("\n");

    if (prefixVertex.length > 0) {
      prefixVertex += "\n";
    }

    prefixFragment = [
      "#define SHADER_TYPE " + parameters.shaderType,
      "#define SHADER_NAME " + parameters.shaderName,

      customDefines,
    ].filter(filterEmptyLine).join("\n");

    if (prefixFragment.length > 0) {
      prefixFragment += "\n";
    }
  } else {
    prefixVertex = [
      generatePrecision(parameters),

      "#define SHADER_TYPE " + parameters.shaderType,
      "#define SHADER_NAME " + parameters.shaderName,

      customDefines,

      parameters.extensionClipCullDistance ? "#define USE_CLIP_DISTANCE" : "",
      parameters.batching ? "#define USE_BATCHING" : "",
      parameters.batchingColor ? "#define USE_BATCHING_COLOR" : "",
      parameters.instancing ? "#define USE_INSTANCING" : "",
      parameters.instancingColor ? "#define USE_INSTANCING_COLOR" : "",
      parameters.instancingMorph ? "#define USE_INSTANCING_MORPH" : "",

      parameters.useFog && parameters.fog ? "#define USE_FOG" : "",
      parameters.useFog && parameters.fogExp2 ? "#define FOG_EXP2" : "",

      parameters.map ? "#define USE_MAP" : "",
      parameters.envMap ? "#define USE_ENVMAP" : "",
      parameters.envMap ? "#define " + envMapModeDefine : "",
      parameters.lightMap ? "#define USE_LIGHTMAP" : "",
      parameters.aoMap ? "#define USE_AOMAP" : "",
      parameters.bumpMap ? "#define USE_BUMPMAP" : "",
      parameters.normalMap ? "#define USE_NORMALMAP" : "",
      parameters.normalMapObjectSpace ? "#define USE_NORMALMAP_OBJECTSPACE" : "",
      parameters.normalMapTangentSpace ? "#define USE_NORMALMAP_TANGENTSPACE" : "",
      parameters.displacementMap ? "#define USE_DISPLACEMENTMAP" : "",
      parameters.emissiveMap ? "#define USE_EMISSIVEMAP" : "",

      parameters.anisotropy ? "#define USE_ANISOTROPY" : "",
      parameters.anisotropyMap ? "#define USE_ANISOTROPYMAP" : "",

      parameters.clearcoatMap ? "#define USE_CLEARCOATMAP" : "",
      parameters.clearcoatRoughnessMap ? "#define USE_CLEARCOAT_ROUGHNESSMAP" : "",
      parameters.clearcoatNormalMap ? "#define USE_CLEARCOAT_NORMALMAP" : "",

      parameters.iridescenceMap ? "#define USE_IRIDESCENCEMAP" : "",
      parameters.iridescenceThicknessMap ? "#define USE_IRIDESCENCE_THICKNESSMAP" : "",

      parameters.specularMap ? "#define USE_SPECULARMAP" : "",
      parameters.specularColorMap ? "#define USE_SPECULAR_COLORMAP" : "",
      parameters.specularIntensityMap ? "#define USE_SPECULAR_INTENSITYMAP" : "",

      parameters.roughnessMap ? "#define USE_ROUGHNESSMAP" : "",
      parameters.metalnessMap ? "#define USE_METALNESSMAP" : "",
      parameters.alphaMap ? "#define USE_ALPHAMAP" : "",
      parameters.alphaHash ? "#define USE_ALPHAHASH" : "",

      parameters.transmission ? "#define USE_TRANSMISSION" : "",
      parameters.transmissionMap ? "#define USE_TRANSMISSIONMAP" : "",
      parameters.thicknessMap ? "#define USE_THICKNESSMAP" : "",

      parameters.sheenColorMap ? "#define USE_SHEEN_COLORMAP" : "",
      parameters.sheenRoughnessMap ? "#define USE_SHEEN_ROUGHNESSMAP" : "",

      //

      parameters.mapUv ? "#define MAP_UV " + parameters.mapUv : "",
      parameters.alphaMapUv ? "#define ALPHAMAP_UV " + parameters.alphaMapUv : "",
      parameters.lightMapUv ? "#define LIGHTMAP_UV " + parameters.lightMapUv : "",
      parameters.aoMapUv ? "#define AOMAP_UV " + parameters.aoMapUv : "",
      parameters.emissiveMapUv ? "#define EMISSIVEMAP_UV " + parameters.emissiveMapUv : "",
      parameters.bumpMapUv ? "#define BUMPMAP_UV " + parameters.bumpMapUv : "",
      parameters.normalMapUv ? "#define NORMALMAP_UV " + parameters.normalMapUv : "",
      parameters.displacementMapUv ? "#define DISPLACEMENTMAP_UV " + parameters.displacementMapUv : "",

      parameters.metalnessMapUv ? "#define METALNESSMAP_UV " + parameters.metalnessMapUv : "",
      parameters.roughnessMapUv ? "#define ROUGHNESSMAP_UV " + parameters.roughnessMapUv : "",

      parameters.anisotropyMapUv ? "#define ANISOTROPYMAP_UV " + parameters.anisotropyMapUv : "",

      parameters.clearcoatMapUv ? "#define CLEARCOATMAP_UV " + parameters.clearcoatMapUv : "",
      parameters.clearcoatNormalMapUv ? "#define CLEARCOAT_NORMALMAP_UV " + parameters.clearcoatNormalMapUv : "",
      parameters.clearcoatRoughnessMapUv ? "#define CLEARCOAT_ROUGHNESSMAP_UV " + parameters.clearcoatRoughnessMapUv : "",

      parameters.iridescenceMapUv ? "#define IRIDESCENCEMAP_UV " + parameters.iridescenceMapUv : "",
      parameters.iridescenceThicknessMapUv ? "#define IRIDESCENCE_THICKNESSMAP_UV " + parameters.iridescenceThicknessMapUv : "",

      parameters.sheenColorMapUv ? "#define SHEEN_COLORMAP_UV " + parameters.sheenColorMapUv : "",
      parameters.sheenRoughnessMapUv ? "#define SHEEN_ROUGHNESSMAP_UV " + parameters.sheenRoughnessMapUv : "",

      parameters.specularMapUv ? "#define SPECULARMAP_UV " + parameters.specularMapUv : "",
      parameters.specularColorMapUv ? "#define SPECULAR_COLORMAP_UV " + parameters.specularColorMapUv : "",
      parameters.specularIntensityMapUv ? "#define SPECULAR_INTENSITYMAP_UV " + parameters.specularIntensityMapUv : "",

      parameters.transmissionMapUv ? "#define TRANSMISSIONMAP_UV " + parameters.transmissionMapUv : "",
      parameters.thicknessMapUv ? "#define THICKNESSMAP_UV " + parameters.thicknessMapUv : "",

      //

      parameters.vertexTangents && parameters.flatShading === false ? "#define USE_TANGENT" : "",
      parameters.vertexColors ? "#define USE_COLOR" : "",
      parameters.vertexAlphas ? "#define USE_COLOR_ALPHA" : "",
      parameters.vertexUv1s ? "#define USE_UV1" : "",
      parameters.vertexUv2s ? "#define USE_UV2" : "",
      parameters.vertexUv3s ? "#define USE_UV3" : "",

      parameters.pointsUvs ? "#define USE_POINTS_UV" : "",

      parameters.flatShading ? "#define FLAT_SHADED" : "",

      parameters.skinning ? "#define USE_SKINNING" : "",

      parameters.morphTargets ? "#define USE_MORPHTARGETS" : "",
      parameters.morphNormals && parameters.flatShading === false ? "#define USE_MORPHNORMALS" : "",
      (parameters.morphColors) ? "#define USE_MORPHCOLORS" : "",
      (parameters.morphTargetsCount > 0) ? "#define MORPHTARGETS_TEXTURE_STRIDE " + parameters.morphTextureStride : "",
      (parameters.morphTargetsCount > 0) ? "#define MORPHTARGETS_COUNT " + parameters.morphTargetsCount : "",
      parameters.doubleSided ? "#define DOUBLE_SIDED" : "",
      parameters.flipSided ? "#define FLIP_SIDED" : "",

      parameters.shadowMapEnabled ? "#define USE_SHADOWMAP" : "",
      parameters.shadowMapEnabled ? "#define " + shadowMapTypeDefine : "",

      parameters.sizeAttenuation ? "#define USE_SIZEATTENUATION" : "",

      parameters.numLightProbes > 0 ? "#define USE_LIGHT_PROBES" : "",

      parameters.logarithmicDepthBuffer ? "#define USE_LOGARITHMIC_DEPTH_BUFFER" : "",
      parameters.reversedDepthBuffer ? "#define USE_REVERSED_DEPTH_BUFFER" : "",

      "uniform mat4 modelMatrix;",
      "uniform mat4 modelViewMatrix;",
      "uniform mat4 projectionMatrix;",
      "uniform mat4 viewMatrix;",
      "uniform mat3 normalMatrix;",
      "uniform vec3 cameraPosition;",
      "uniform bool isOrthographic;",

      "#ifdef USE_INSTANCING",

      "	attribute mat4 instanceMatrix;",

      "#endif",

      "#ifdef USE_INSTANCING_COLOR",

      "	attribute vec3 instanceColor;",

      "#endif",

      "#ifdef USE_INSTANCING_MORPH",

      "	uniform sampler2D morphTexture;",

      "#endif",

      "attribute vec3 position;",
      "attribute vec3 normal;",
      "attribute vec2 uv;",

      "#ifdef USE_UV1",

      "	attribute vec2 uv1;",

      "#endif",

      "#ifdef USE_UV2",

      "	attribute vec2 uv2;",

      "#endif",

      "#ifdef USE_UV3",

      "	attribute vec2 uv3;",

      "#endif",

      "#ifdef USE_TANGENT",

      "	attribute vec4 tangent;",

      "#endif",

      "#if defined( USE_COLOR_ALPHA )",

      "	attribute vec4 color;",

      "#elif defined( USE_COLOR )",

      "	attribute vec3 color;",

      "#endif",

      "#ifdef USE_SKINNING",

      "	attribute vec4 skinIndex;",
      "	attribute vec4 skinWeight;",

      "#endif",

      "\n",
    ].filter(filterEmptyLine).join("\n");

    prefixFragment = [
      generatePrecision(parameters),

      "#define SHADER_TYPE " + parameters.shaderType,
      "#define SHADER_NAME " + parameters.shaderName,

      customDefines,

      parameters.useFog && parameters.fog ? "#define USE_FOG" : "",
      parameters.useFog && parameters.fogExp2 ? "#define FOG_EXP2" : "",

      parameters.alphaToCoverage ? "#define ALPHA_TO_COVERAGE" : "",
      parameters.map ? "#define USE_MAP" : "",
      parameters.matcap ? "#define USE_MATCAP" : "",
      parameters.envMap ? "#define USE_ENVMAP" : "",
      parameters.envMap ? "#define " + envMapTypeDefine : "",
      parameters.envMap ? "#define " + envMapModeDefine : "",
      parameters.envMap ? "#define " + envMapBlendingDefine : "",
      envMapCubeUVSize ? "#define CUBEUV_TEXEL_WIDTH " + envMapCubeUVSize.texelWidth : "",
      envMapCubeUVSize ? "#define CUBEUV_TEXEL_HEIGHT " + envMapCubeUVSize.texelHeight : "",
      envMapCubeUVSize ? "#define CUBEUV_MAX_MIP " + envMapCubeUVSize.maxMip + ".0" : "",
      parameters.lightMap ? "#define USE_LIGHTMAP" : "",
      parameters.aoMap ? "#define USE_AOMAP" : "",
      parameters.bumpMap ? "#define USE_BUMPMAP" : "",
      parameters.normalMap ? "#define USE_NORMALMAP" : "",
      parameters.normalMapObjectSpace ? "#define USE_NORMALMAP_OBJECTSPACE" : "",
      parameters.normalMapTangentSpace ? "#define USE_NORMALMAP_TANGENTSPACE" : "",
      parameters.emissiveMap ? "#define USE_EMISSIVEMAP" : "",

      parameters.anisotropy ? "#define USE_ANISOTROPY" : "",
      parameters.anisotropyMap ? "#define USE_ANISOTROPYMAP" : "",

      parameters.clearcoat ? "#define USE_CLEARCOAT" : "",
      parameters.clearcoatMap ? "#define USE_CLEARCOATMAP" : "",
      parameters.clearcoatRoughnessMap ? "#define USE_CLEARCOAT_ROUGHNESSMAP" : "",
      parameters.clearcoatNormalMap ? "#define USE_CLEARCOAT_NORMALMAP" : "",

      parameters.dispersion ? "#define USE_DISPERSION" : "",

      parameters.iridescence ? "#define USE_IRIDESCENCE" : "",
      parameters.iridescenceMap ? "#define USE_IRIDESCENCEMAP" : "",
      parameters.iridescenceThicknessMap ? "#define USE_IRIDESCENCE_THICKNESSMAP" : "",

      parameters.specularMap ? "#define USE_SPECULARMAP" : "",
      parameters.specularColorMap ? "#define USE_SPECULAR_COLORMAP" : "",
      parameters.specularIntensityMap ? "#define USE_SPECULAR_INTENSITYMAP" : "",

      parameters.roughnessMap ? "#define USE_ROUGHNESSMAP" : "",
      parameters.metalnessMap ? "#define USE_METALNESSMAP" : "",

      parameters.alphaMap ? "#define USE_ALPHAMAP" : "",
      parameters.alphaTest ? "#define USE_ALPHATEST" : "",
      parameters.alphaHash ? "#define USE_ALPHAHASH" : "",

      parameters.sheen ? "#define USE_SHEEN" : "",
      parameters.sheenColorMap ? "#define USE_SHEEN_COLORMAP" : "",
      parameters.sheenRoughnessMap ? "#define USE_SHEEN_ROUGHNESSMAP" : "",

      parameters.transmission ? "#define USE_TRANSMISSION" : "",
      parameters.transmissionMap ? "#define USE_TRANSMISSIONMAP" : "",
      parameters.thicknessMap ? "#define USE_THICKNESSMAP" : "",

      parameters.vertexTangents && parameters.flatShading === false ? "#define USE_TANGENT" : "",
      parameters.vertexColors || parameters.instancingColor || parameters.batchingColor ? "#define USE_COLOR" : "",
      parameters.vertexAlphas ? "#define USE_COLOR_ALPHA" : "",
      parameters.vertexUv1s ? "#define USE_UV1" : "",
      parameters.vertexUv2s ? "#define USE_UV2" : "",
      parameters.vertexUv3s ? "#define USE_UV3" : "",

      parameters.pointsUvs ? "#define USE_POINTS_UV" : "",

      parameters.gradientMap ? "#define USE_GRADIENTMAP" : "",

      parameters.flatShading ? "#define FLAT_SHADED" : "",

      parameters.doubleSided ? "#define DOUBLE_SIDED" : "",
      parameters.flipSided ? "#define FLIP_SIDED" : "",

      parameters.shadowMapEnabled ? "#define USE_SHADOWMAP" : "",
      parameters.shadowMapEnabled ? "#define " + shadowMapTypeDefine : "",

      parameters.premultipliedAlpha ? "#define PREMULTIPLIED_ALPHA" : "",

      parameters.numLightProbes > 0 ? "#define USE_LIGHT_PROBES" : "",

      parameters.decodeVideoTexture ? "#define DECODE_VIDEO_TEXTURE" : "",
      parameters.decodeVideoTextureEmissive ? "#define DECODE_VIDEO_TEXTURE_EMISSIVE" : "",

      parameters.logarithmicDepthBuffer ? "#define USE_LOGARITHMIC_DEPTH_BUFFER" : "",
      parameters.reversedDepthBuffer ? "#define USE_REVERSED_DEPTH_BUFFER" : "",

      "uniform mat4 viewMatrix;",
      "uniform vec3 cameraPosition;",
      "uniform bool isOrthographic;",

      (parameters.toneMapping !== "none") ? "#define TONE_MAPPING" : "",
      (parameters.toneMapping !== "none") ? PREFIX_CHUNKS["tonemapping_pars_fragment"]! : "", // this code is required here because it is used by the toneMapping() function defined below
      (parameters.toneMapping !== "none") ? getToneMappingFunction("toneMapping", parameters.toneMapping) : "",

      parameters.dithering ? "#define DITHERING" : "",
      parameters.opaque ? "#define OPAQUE" : "",

      PREFIX_CHUNKS["colorspace_pars_fragment"]!, // this code is required here because it is used by the various encoding/decoding function defined below
      getTexelEncodingFunction("linearToOutputTexel", parameters.outputColorSpace),
      getLuminanceFunction(),

      parameters.useDepthPacking ? "#define DEPTH_PACKING " + parameters.depthPacking : "",

      "\n",
    ].filter(filterEmptyLine).join("\n");
  }

  vertexShader = resolveIncludes(vertexShader);
  vertexShader = replaceLightNums(vertexShader, parameters);
  vertexShader = replaceClippingPlaneNums(vertexShader, parameters);

  fragmentShader = resolveIncludes(fragmentShader);
  fragmentShader = replaceLightNums(fragmentShader, parameters);
  fragmentShader = replaceClippingPlaneNums(fragmentShader, parameters);

  vertexShader = unrollLoops(vertexShader);
  fragmentShader = unrollLoops(fragmentShader);

  if (parameters.isRawShaderMaterial !== true) {
    // GLSL 3.0 conversion for built-in materials and ShaderMaterial

    versionString = "#version 300 es\n";

    prefixVertex = [
      customVertexExtensions,
      "#define attribute in",
      "#define varying out",
      "#define texture2D texture",
    ].join("\n") + "\n" + prefixVertex;

    prefixFragment = [
      "#define varying in",
      (parameters.glslVersion === "300 es") ? "" : "layout(location = 0) out highp vec4 pc_fragColor;",
      (parameters.glslVersion === "300 es") ? "" : "#define gl_FragColor pc_fragColor",
      "#define gl_FragDepthEXT gl_FragDepth",
      "#define texture2D texture",
      "#define textureCube texture",
      "#define texture2DProj textureProj",
      "#define texture2DLodEXT textureLod",
      "#define texture2DProjLodEXT textureProjLod",
      "#define textureCubeLodEXT textureLod",
      "#define texture2DGradEXT textureGrad",
      "#define texture2DProjGradEXT textureProjGrad",
      "#define textureCubeGradEXT textureGrad",
    ].join("\n") + "\n" + prefixFragment;
  }

  const vertexGlsl = versionString + prefixVertex + vertexShader;
  const fragmentGlsl = versionString + prefixFragment + fragmentShader;

  // console.log( '*VERTEX*', vertexGlsl );
  // console.log( '*FRAGMENT*', fragmentGlsl );

  const glVertexShader = createShader(gl, gl.VERTEX_SHADER, vertexGlsl);
  const glFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentGlsl);

  gl.attachShader(program, glVertexShader);
  gl.attachShader(program, glFragmentShader);

  // Force a particular attribute to index 0.

  if (parameters.index0AttributeName !== undefined) {
    gl.bindAttribLocation(program, 0, parameters.index0AttributeName);
  } else if (parameters.morphTargets === true) {
    // programs with morphTargets displace position out of attribute 0
    gl.bindAttribLocation(program, 0, "position");
  }

  gl.linkProgram(program);

  function onFirstUse(self: LitProgram): void {
    // check for link errors
    if (renderer.debug.checkShaderErrors) {
      const programInfoLog = gl.getProgramInfoLog(program) || "";
      const vertexShaderInfoLog = gl.getShaderInfoLog(glVertexShader) || "";
      const fragmentShaderInfoLog = gl.getShaderInfoLog(glFragmentShader) || "";

      const programLog = programInfoLog.trim();
      const vertexLog = vertexShaderInfoLog.trim();
      const fragmentLog = fragmentShaderInfoLog.trim();

      let runnable = true;
      let haveDiagnostics = true;

      if (gl.getProgramParameter(program, gl.LINK_STATUS) === false) {
        runnable = false;

        if (typeof renderer.debug.onShaderError === "function") {
          renderer.debug.onShaderError(gl, program, glVertexShader, glFragmentShader);
        } else {
          // default error reporting

          const vertexErrors = getShaderErrors(gl, glVertexShader, "vertex");
          const fragmentErrors = getShaderErrors(gl, glFragmentShader, "fragment");

          console.error(
            "keel/lit program: Shader Error " + gl.getError() + " - " +
            "VALIDATE_STATUS " + String(gl.getProgramParameter(program, gl.VALIDATE_STATUS)) + "\n\n" +
            "Material Name: " + self.name + "\n" +
            "Material Type: " + self.type + "\n\n" +
            "Program Info Log: " + programLog + "\n" +
            vertexErrors + "\n" +
            fragmentErrors,
          );
        }
      } else if (programLog !== "") {
        console.warn("keel/lit program: Program Info Log:", programLog);
      } else if (vertexLog === "" || fragmentLog === "") {
        haveDiagnostics = false;
      }

      if (haveDiagnostics) {
        self.diagnostics = {
          runnable: runnable,

          programLog: programLog,

          vertexShader: {
            log: vertexLog,
            prefix: prefixVertex,
          },

          fragmentShader: {
            log: fragmentLog,
            prefix: prefixFragment,
          },
        };
      }
    }

    // Clean up

    // Crashes in iOS9 and iOS10. #18402
    // gl.detachShader( program, glVertexShader );
    // gl.detachShader( program, glFragmentShader );

    gl.deleteShader(glVertexShader);
    gl.deleteShader(glFragmentShader);

    cachedUniforms = createUniforms(gl, program);
    cachedAttributes = fetchAttributeLocations(gl, program);
  }

  // set up caching for uniform locations

  let cachedUniforms: ProgramUniforms | undefined;

  // set up caching for attribute locations

  let cachedAttributes: Record<string, ProgramAttribute> | undefined;

  // indicate when the program is ready to be used. if the KHR_parallel_shader_compile extension isn't supported,
  // flag the program as ready immediately. It may cause a stall when it's first used.

  let programReady = (parameters.rendererExtensionParallelShaderCompile === false);

  const self: LitProgram = {
    getUniforms() {
      if (cachedUniforms === undefined) {
        // Populates cachedUniforms and cachedAttributes
        onFirstUse(self);
      }

      return cachedUniforms!;
    },

    getAttributes() {
      if (cachedAttributes === undefined) {
        // Populates cachedAttributes and cachedUniforms
        onFirstUse(self);
      }

      return cachedAttributes!;
    },

    isReady() {
      if (programReady === false) {
        programReady = gl.getProgramParameter(program, COMPLETION_STATUS_KHR) as boolean;
      }

      return programReady;
    },

    // free resource

    destroy() {
      bindingStates.releaseStatesOfProgram(self);

      gl.deleteProgram(program);
      self.program = undefined;
    },

    //

    type: parameters.shaderType,
    name: parameters.shaderName,
    id: programIdCount++,
    cacheKey: cacheKey,
    usedTimes: 1,
    program: program,
    vertexShader: glVertexShader,
    fragmentShader: glFragmentShader,
  };

  return self;
}
