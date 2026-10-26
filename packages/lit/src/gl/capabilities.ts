// Ported from Three.js r180's renderers/webgl/WebGLCapabilities.js (MIT, see
// packages/lit/NOTICE): the context's limits and precision, read once.

import type { PixelFormat, TextureType } from "../constants.ts";
import type { Extensions } from "./extensions.ts";
import type { Utils } from "./utils.ts";

export type Precision = "highp" | "mediump" | "lowp";

/** The renderer parameters capabilities read (r180's WebGLRenderer parameters). */
export interface CapabilitiesParameters {
  precision?: Precision | undefined;
  logarithmicDepthBuffer?: boolean | undefined;
  reversedDepthBuffer?: boolean | undefined;
}

/** r180's WebGLCapabilities. */
export interface Capabilities {
  isWebGL2: true;
  getMaxAnisotropy(): number;
  getMaxPrecision(precision: Precision): Precision;
  textureFormatReadable(textureFormat: PixelFormat): boolean;
  textureTypeReadable(textureType: TextureType): boolean;
  precision: Precision;
  logarithmicDepthBuffer: boolean;
  reversedDepthBuffer: boolean;
  maxTextures: number;
  maxVertexTextures: number;
  maxTextureSize: number;
  maxCubemapSize: number;
  maxAttributes: number;
  maxVertexUniforms: number;
  maxVaryings: number;
  maxFragmentUniforms: number;
  vertexTextures: boolean;
  maxSamples: number;
}

export function createCapabilities(gl: WebGL2RenderingContext, extensions: Extensions, parameters: CapabilitiesParameters, utils: Utils): Capabilities {
  let maxAnisotropy: number | undefined;

  function getMaxAnisotropy(): number {
    if (maxAnisotropy !== undefined) return maxAnisotropy;

    if (extensions.has("EXT_texture_filter_anisotropic") === true) {
      const extension = extensions.get("EXT_texture_filter_anisotropic");

      maxAnisotropy = gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
    } else {
      maxAnisotropy = 0;
    }

    return maxAnisotropy;
  }

  function textureFormatReadable(textureFormat: PixelFormat): boolean {
    if (textureFormat !== "rgba" && utils.convert(textureFormat) !== gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT)) {
      return false;
    }

    return true;
  }

  function textureTypeReadable(textureType: TextureType): boolean {
    const halfFloatSupportedByExt = (textureType === "half") && (extensions.has("EXT_color_buffer_half_float") || extensions.has("EXT_color_buffer_float"));

    if (textureType !== "u8" && utils.convert(textureType) !== gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) && // Edge and Chrome Mac < 52 (#9513)
      textureType !== "float" && !halfFloatSupportedByExt) {
      return false;
    }

    return true;
  }

  function getMaxPrecision(precision: Precision): Precision {
    if (precision === "highp") {
      if (gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT)!.precision > 0 &&
        gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)!.precision > 0) {
        return "highp";
      }

      precision = "mediump";
    }

    if (precision === "mediump") {
      if (gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.MEDIUM_FLOAT)!.precision > 0 &&
        gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)!.precision > 0) {
        return "mediump";
      }
    }

    return "lowp";
  }

  let precision: Precision = parameters.precision !== undefined ? parameters.precision : "highp";
  const maxPrecision = getMaxPrecision(precision);

  if (maxPrecision !== precision) {
    console.warn("keel/lit renderer:", precision, "not supported, using", maxPrecision, "instead.");
    precision = maxPrecision;
  }

  const logarithmicDepthBuffer = parameters.logarithmicDepthBuffer === true;
  const reversedDepthBuffer = parameters.reversedDepthBuffer === true && extensions.has("EXT_clip_control");

  const maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
  const maxVertexTextures = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number;
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxCubemapSize = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) as number;

  const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
  const maxVertexUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number;
  const maxVaryings = gl.getParameter(gl.MAX_VARYING_VECTORS) as number;
  const maxFragmentUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;

  const vertexTextures = maxVertexTextures > 0;

  const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;

  return {
    isWebGL2: true, // keeping this for backwards compatibility

    getMaxAnisotropy: getMaxAnisotropy,
    getMaxPrecision: getMaxPrecision,

    textureFormatReadable: textureFormatReadable,
    textureTypeReadable: textureTypeReadable,

    precision: precision,
    logarithmicDepthBuffer: logarithmicDepthBuffer,
    reversedDepthBuffer: reversedDepthBuffer,

    maxTextures: maxTextures,
    maxVertexTextures: maxVertexTextures,
    maxTextureSize: maxTextureSize,
    maxCubemapSize: maxCubemapSize,

    maxAttributes: maxAttributes,
    maxVertexUniforms: maxVertexUniforms,
    maxVaryings: maxVaryings,
    maxFragmentUniforms: maxFragmentUniforms,

    vertexTextures: vertexTextures,

    maxSamples: maxSamples,
  };
}
