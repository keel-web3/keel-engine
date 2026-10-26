// Ported from Three.js r180's renderers/webgl/WebGLTextures.js (MIT, see
// packages/lit/NOTICE): textures to GL, render targets' framebuffers, and their
// disposal. The same GL calls with the same arguments in the same order as r180,
// for what keel/lit has: 2D textures from images, canvases, bitmaps and raw
// data, depth textures, and 2D render targets (one or more colour textures,
// MSAA, a depth buffer or a depth texture).
//
// Dropped, as nothing in keel/lit can reach them:
// - video and external textures (no VideoTexture, no ExternalTexture);
// - compressed textures and their array variant (no CompressedTexture);
// - data array, 3D textures and their render targets (no DataArrayTexture / Data3DTexture);
// - framebuffer textures (no FramebufferTexture);
// - cube textures and cube render targets (no CubeTexture / WebGLCubeRenderTarget:
//   setTextureCube, setTexture2DArray and setTexture3D only bind, see below);
// - XR render targets (no WebXR: forceLinearTransfer is never set).

import { colorManagement } from "../math/ColorManagement.ts";
import { Vector2 } from "../math/Vector2.ts";
import type { ColorSpace } from "../math/types.ts";
import type { CompareFunction, TextureFilter, TextureType, Wrapping } from "../constants.ts";
import type { Texture } from "../texture/Texture.ts";
import type { RenderTarget } from "../texture/RenderTarget.ts";
import type { DepthTexture } from "../texture/DepthTexture.ts";

// ---- what this module receives (the other src/gl modules fit)

/** r180's WebGLExtensions, as textures read it. */
export interface TexturesExtensions {
  has(name: string): boolean;
  get(name: string): any;
}

/** r180's WebGLState, as textures call it. */
export interface TexturesState {
  bindTexture(webglType: number, webglTexture: WebGLTexture | null | undefined, webglSlot?: number): void;
  unbindTexture(): void;
  activeTexture(webglSlot?: number): void;
  bindFramebuffer(target: number, framebuffer: WebGLFramebuffer | null | undefined): boolean;
  texImage2D(...args: any[]): void;
  texSubImage2D(...args: any[]): void;
  texStorage2D(target: number, levels: number, internalFormat: number, width: number, height: number): void;
}

/** r180's WebGLProperties. */
export interface TexturesProperties {
  get(object: object): any;
  remove(object: object): void;
}

/** r180's WebGLCapabilities, as textures read it. */
export interface TexturesCapabilities {
  maxTextures: number;
  maxTextureSize: number;
  maxSamples: number;
  getMaxAnisotropy(): number;
}

/** r180's WebGLUtils: a KEEL constant to its GL enum. */
export interface TexturesUtils {
  convert(p: string, colorSpace?: ColorSpace): number | null | undefined;
}

/** r180's WebGLInfo, as textures count in it. */
export interface TexturesInfo {
  memory: { textures: number };
}

/** What a texture's properties hold (r180's names). */
interface TextureProperties {
  __webglInit?: boolean;
  __cacheKey?: string;
  __webglTexture?: WebGLTexture;
  __version?: number;
  __currentAnisotropy?: number;
  __renderTarget?: RenderTarget;
}

interface SourceProperties {
  __version?: number;
}

/** What a render target's properties hold (r180's names). */
interface RenderTargetProperties {
  __webglFramebuffer?: WebGLFramebuffer | WebGLFramebuffer[];
  __webglDepthbuffer?: WebGLRenderbuffer;
  __webglMultisampledFramebuffer?: WebGLFramebuffer;
  __webglColorRenderbuffer?: WebGLRenderbuffer[];
  __webglDepthRenderbuffer?: WebGLRenderbuffer;
  __boundDepthTexture?: DepthTexture | null;
  __depthDisposeCallback?: () => void;
  // (set by the renderer, as r180's WebGLRenderer sets them)
  __autoAllocateDepthBuffer?: boolean;
  __hasExternalTextures?: boolean;
  __useRenderToTexture?: boolean;
}

/** A texture, with the flags and fields only some kinds carry. */
type AnyTexture = Texture & {
  readonly isDataTexture?: boolean;
  readonly isDepthTexture?: boolean;
  readonly isCanvasTexture?: boolean;
  compareFunction?: CompareFunction | null;
  wrapR?: Wrapping;
};

/** Whatever a texture's image is, as the upload reads it. */
interface AnyImage {
  width: number;
  height: number;
  depth?: number;
  data?: ArrayBufferView | null;
  complete?: boolean;
}

interface WebGLTextureEntry {
  texture: WebGLTexture;
  usedTimes: number;
}

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;

/** The textures layer (r180's WebGLTextures). */
export interface Textures {
  allocateTextureUnit(): number;
  resetTextureUnits(): void;
  setTexture2D(texture: Texture, slot: number): void;
  setTexture2DArray(texture: Texture, slot: number): void;
  setTexture3D(texture: Texture, slot: number): void;
  setTextureCube(texture: Texture, slot: number): void;
  rebindTextures(renderTarget: RenderTarget, colorTexture: WebGLTexture | undefined, depthTexture: WebGLTexture | undefined): void;
  setupRenderTarget(renderTarget: RenderTarget): void;
  updateRenderTargetMipmap(renderTarget: RenderTarget): void;
  updateMultisampleRenderTarget(renderTarget: RenderTarget): void;
  setupDepthRenderbuffer(renderTarget: RenderTarget): void;
  setupFrameBufferTexture(framebuffer: WebGLFramebuffer | undefined, renderTarget: RenderTarget, texture: Texture, attachment: number, textureTarget: number, level: number): void;
  useMultisampledRTT(renderTarget: RenderTarget): boolean;
}

export function createTextures(
  _gl: WebGL2RenderingContext,
  extensions: TexturesExtensions,
  state: TexturesState,
  properties: TexturesProperties,
  capabilities: TexturesCapabilities,
  utils: TexturesUtils,
  info: TexturesInfo,
): Textures {
  const multisampledRTTExt = extensions.has("WEBGL_multisampled_render_to_texture") ? extensions.get("WEBGL_multisampled_render_to_texture") : null;
  const supportsInvalidateFramebuffer = typeof navigator === "undefined" ? false : /OculusBrowser/g.test(navigator.userAgent);

  const _imageDimensions = new Vector2();
  let _canvas: Canvas2D | undefined;

  const _sources = new WeakMap<object, Record<string, WebGLTextureEntry>>(); // (WebGLTexture objects by Source)

  const textureProps = (texture: Texture): TextureProperties => properties.get(texture) as TextureProperties;
  const targetProps = (renderTarget: RenderTarget): RenderTargetProperties => properties.get(renderTarget) as RenderTargetProperties;

  // (cordova iOS's UIWebView has an OffscreenCanvas without a 2d context; some have it only in part)

  let useOffscreenCanvas = false;

  try {
    useOffscreenCanvas = typeof OffscreenCanvas !== "undefined"
      && (new OffscreenCanvas(1, 1).getContext("2d")) !== null;
  } catch {
    // (ignored)
  }

  function createCanvas(width: number, height: number): Canvas2D {
    // (an OffscreenCanvas where there is one: needed in workers)
    return useOffscreenCanvas
      ? new OffscreenCanvas(width, height)
      : document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
  }

  function resizeImage(image: any, needsNewCanvas: boolean, maxSize: number): any {
    let scale = 1;

    const dimensions = getDimensions(image);

    // (larger than the GPU takes)

    if (dimensions.width > maxSize || dimensions.height > maxSize) {
      scale = maxSize / Math.max(dimensions.width, dimensions.height);
    }

    if (scale < 1) {
      // (only these can be drawn to a canvas)

      if ((typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) ||
        (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) ||
        (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) ||
        (typeof VideoFrame !== "undefined" && image instanceof VideoFrame)) {
        const width = Math.floor(scale * dimensions.width);
        const height = Math.floor(scale * dimensions.height);

        if (_canvas === undefined) _canvas = createCanvas(width, height);

        // (cube textures can't share the canvas)

        const canvas = needsNewCanvas ? createCanvas(width, height) : _canvas;

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d") as CanvasRenderingContext2D;
        context.drawImage(image, 0, 0, width, height);

        console.warn("keel/lit: Texture has been resized from (" + dimensions.width + "x" + dimensions.height + ") to (" + width + "x" + height + ").");

        return canvas;
      } else {
        if ("data" in image) {
          console.warn("keel/lit: Image in DataTexture is too big (" + dimensions.width + "x" + dimensions.height + ").");
        }

        return image;
      }
    }

    return image;
  }

  function textureNeedsGenerateMipmaps(texture: Texture): boolean {
    return texture.generateMipmaps;
  }

  function generateMipmap(target: number): void {
    _gl.generateMipmap(target);
  }

  function getTargetType(_renderTarget: RenderTarget): number {
    // (cube, 3D and array render targets are dropped: always 2D)
    return _gl.TEXTURE_2D;
  }

  function getInternalFormat(internalFormatName: string | null, glFormat: number | null | undefined, glType: number | null | undefined, colorSpace: ColorSpace, forceLinearTransfer = false): number {
    if (internalFormatName !== null) {
      const named = (_gl as unknown as Record<string, number | undefined>)[internalFormatName];
      if (named !== undefined) return named;

      console.warn("keel/lit: Attempt to use non-existing WebGL internal format '" + internalFormatName + "'");
    }

    let internalFormat = glFormat as number;

    if (glFormat === _gl.RED) {
      if (glType === _gl.FLOAT) internalFormat = _gl.R32F;
      if (glType === _gl.HALF_FLOAT) internalFormat = _gl.R16F;
      if (glType === _gl.UNSIGNED_BYTE) internalFormat = _gl.R8;
    }

    if (glFormat === _gl.RED_INTEGER) {
      if (glType === _gl.UNSIGNED_BYTE) internalFormat = _gl.R8UI;
      if (glType === _gl.UNSIGNED_SHORT) internalFormat = _gl.R16UI;
      if (glType === _gl.UNSIGNED_INT) internalFormat = _gl.R32UI;
      if (glType === _gl.BYTE) internalFormat = _gl.R8I;
      if (glType === _gl.SHORT) internalFormat = _gl.R16I;
      if (glType === _gl.INT) internalFormat = _gl.R32I;
    }

    if (glFormat === _gl.RG) {
      if (glType === _gl.FLOAT) internalFormat = _gl.RG32F;
      if (glType === _gl.HALF_FLOAT) internalFormat = _gl.RG16F;
      if (glType === _gl.UNSIGNED_BYTE) internalFormat = _gl.RG8;
    }

    if (glFormat === _gl.RG_INTEGER) {
      if (glType === _gl.UNSIGNED_BYTE) internalFormat = _gl.RG8UI;
      if (glType === _gl.UNSIGNED_SHORT) internalFormat = _gl.RG16UI;
      if (glType === _gl.UNSIGNED_INT) internalFormat = _gl.RG32UI;
      if (glType === _gl.BYTE) internalFormat = _gl.RG8I;
      if (glType === _gl.SHORT) internalFormat = _gl.RG16I;
      if (glType === _gl.INT) internalFormat = _gl.RG32I;
    }

    if (glFormat === _gl.RGB_INTEGER) {
      if (glType === _gl.UNSIGNED_BYTE) internalFormat = _gl.RGB8UI;
      if (glType === _gl.UNSIGNED_SHORT) internalFormat = _gl.RGB16UI;
      if (glType === _gl.UNSIGNED_INT) internalFormat = _gl.RGB32UI;
      if (glType === _gl.BYTE) internalFormat = _gl.RGB8I;
      if (glType === _gl.SHORT) internalFormat = _gl.RGB16I;
      if (glType === _gl.INT) internalFormat = _gl.RGB32I;
    }

    if (glFormat === _gl.RGBA_INTEGER) {
      if (glType === _gl.UNSIGNED_BYTE) internalFormat = _gl.RGBA8UI;
      if (glType === _gl.UNSIGNED_SHORT) internalFormat = _gl.RGBA16UI;
      if (glType === _gl.UNSIGNED_INT) internalFormat = _gl.RGBA32UI;
      if (glType === _gl.BYTE) internalFormat = _gl.RGBA8I;
      if (glType === _gl.SHORT) internalFormat = _gl.RGBA16I;
      if (glType === _gl.INT) internalFormat = _gl.RGBA32I;
    }

    if (glFormat === _gl.RGB) {
      if (glType === _gl.UNSIGNED_INT_5_9_9_9_REV) internalFormat = _gl.RGB9_E5;
      if (glType === _gl.UNSIGNED_INT_10F_11F_11F_REV) internalFormat = _gl.R11F_G11F_B10F;
    }

    if (glFormat === _gl.RGBA) {
      const transfer = forceLinearTransfer ? "linear" : colorManagement.getTransfer(colorSpace);

      if (glType === _gl.FLOAT) internalFormat = _gl.RGBA32F;
      if (glType === _gl.HALF_FLOAT) internalFormat = _gl.RGBA16F;
      if (glType === _gl.UNSIGNED_BYTE) internalFormat = (transfer === "srgb") ? _gl.SRGB8_ALPHA8 : _gl.RGBA8;
      if (glType === _gl.UNSIGNED_SHORT_4_4_4_4) internalFormat = _gl.RGBA4;
      if (glType === _gl.UNSIGNED_SHORT_5_5_5_1) internalFormat = _gl.RGB5_A1;
    }

    if (internalFormat === _gl.R16F || internalFormat === _gl.R32F ||
      internalFormat === _gl.RG16F || internalFormat === _gl.RG32F ||
      internalFormat === _gl.RGBA16F || internalFormat === _gl.RGBA32F) {
      extensions.get("EXT_color_buffer_float");
    }

    return internalFormat;
  }

  function getInternalDepthFormat(useStencil: boolean, depthType: TextureType | null): number {
    let glInternalFormat: number | undefined;
    if (useStencil) {
      if (depthType === null || depthType === "uint" || depthType === "depth24-stencil8") {
        glInternalFormat = _gl.DEPTH24_STENCIL8;
      } else if (depthType === "float") {
        glInternalFormat = _gl.DEPTH32F_STENCIL8;
      } else if (depthType === "u16") {
        glInternalFormat = _gl.DEPTH24_STENCIL8;
        console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.");
      }
    } else {
      if (depthType === null || depthType === "uint" || depthType === "depth24-stencil8") {
        glInternalFormat = _gl.DEPTH_COMPONENT24;
      } else if (depthType === "float") {
        glInternalFormat = _gl.DEPTH_COMPONENT32F;
      } else if (depthType === "u16") {
        glInternalFormat = _gl.DEPTH_COMPONENT16;
      }
    }

    // (sic: undefined for any other type, as r180)
    return glInternalFormat as number;
  }

  function getMipLevels(texture: Texture, image: AnyImage): number {
    // (r180 also counts a framebuffer texture's levels here: dropped, there are none)
    if (textureNeedsGenerateMipmaps(texture) === true) {
      return Math.log2(Math.max(image.width, image.height)) + 1;
    } else if (texture.mipmaps !== undefined && texture.mipmaps.length > 0) {
      // (the user's own mipmaps)
      return texture.mipmaps.length;
    } else {
      // (the base level only; compressed textures' levels are dropped)
      return 1;
    }
  }

  // ----

  function onTextureDispose(event: { target?: unknown }): void {
    const texture = event.target as Texture;

    texture.removeEventListener("dispose", onTextureDispose);

    deallocateTexture(texture);

    // (video textures dropped)
  }

  function onRenderTargetDispose(event: { target?: unknown }): void {
    const renderTarget = event.target as RenderTarget;

    renderTarget.removeEventListener("dispose", onRenderTargetDispose);

    deallocateRenderTarget(renderTarget);
  }

  // ----

  function deallocateTexture(texture: Texture): void {
    const textureProperties = textureProps(texture);

    if (textureProperties.__webglInit === undefined) return;

    // (is the WebGLTexture still used?)

    const source = texture.source;
    const webglTextures = _sources.get(source);

    if (webglTextures) {
      const webglTexture = webglTextures[textureProperties.__cacheKey!]!;
      webglTexture.usedTimes--;

      // (no longer used: delete it)

      if (webglTexture.usedTimes === 0) {
        deleteTexture(texture);
      }

      // (no WebGLTexture uses the source any more)

      if (Object.keys(webglTextures).length === 0) {
        _sources.delete(source);
      }
    }

    properties.remove(texture);
  }

  function deleteTexture(texture: Texture): void {
    const textureProperties = textureProps(texture);
    _gl.deleteTexture(textureProperties.__webglTexture!);

    const source = texture.source;
    const webglTextures = _sources.get(source)!;
    delete webglTextures[textureProperties.__cacheKey!];

    info.memory.textures--;
  }

  function deallocateRenderTarget(renderTarget: RenderTarget): void {
    const renderTargetProperties = targetProps(renderTarget);

    if (renderTarget.depthTexture) {
      renderTarget.depthTexture.dispose();

      properties.remove(renderTarget.depthTexture);
    }

    // (cube render targets dropped)

    if (Array.isArray(renderTargetProperties.__webglFramebuffer)) {
      for (let level = 0; level < renderTargetProperties.__webglFramebuffer.length; level++) _gl.deleteFramebuffer(renderTargetProperties.__webglFramebuffer[level]!);
    } else {
      _gl.deleteFramebuffer(renderTargetProperties.__webglFramebuffer!);
    }

    if (renderTargetProperties.__webglDepthbuffer) _gl.deleteRenderbuffer(renderTargetProperties.__webglDepthbuffer);
    if (renderTargetProperties.__webglMultisampledFramebuffer) _gl.deleteFramebuffer(renderTargetProperties.__webglMultisampledFramebuffer);

    if (renderTargetProperties.__webglColorRenderbuffer) {
      for (let i = 0; i < renderTargetProperties.__webglColorRenderbuffer.length; i++) {
        if (renderTargetProperties.__webglColorRenderbuffer[i]) _gl.deleteRenderbuffer(renderTargetProperties.__webglColorRenderbuffer[i]!);
      }
    }

    if (renderTargetProperties.__webglDepthRenderbuffer) _gl.deleteRenderbuffer(renderTargetProperties.__webglDepthRenderbuffer);

    const textures = renderTarget.textures;

    for (let i = 0, il = textures.length; i < il; i++) {
      const attachmentProperties = textureProps(textures[i]!);

      if (attachmentProperties.__webglTexture) {
        _gl.deleteTexture(attachmentProperties.__webglTexture);

        info.memory.textures--;
      }

      properties.remove(textures[i]!);
    }

    properties.remove(renderTarget);
  }

  // ----

  let textureUnits = 0;

  function resetTextureUnits(): void {
    textureUnits = 0;
  }

  function allocateTextureUnit(): number {
    const textureUnit = textureUnits;

    if (textureUnit >= capabilities.maxTextures) {
      console.warn("keel/lit: Trying to use " + textureUnit + " texture units while this GPU supports only " + capabilities.maxTextures);
    }

    textureUnits += 1;

    return textureUnit;
  }

  function getTextureCacheKey(texture: AnyTexture): string {
    const array: unknown[] = [];

    array.push(texture.wrapS);
    array.push(texture.wrapT);
    array.push(texture.wrapR || 0);
    array.push(texture.magFilter);
    array.push(texture.minFilter);
    array.push(texture.anisotropy);
    array.push(texture.internalFormat);
    array.push(texture.format);
    array.push(texture.type);
    array.push(texture.generateMipmaps);
    array.push(texture.premultiplyAlpha);
    array.push(texture.flipY);
    array.push(texture.unpackAlignment);
    array.push(texture.colorSpace);

    return array.join();
  }

  // ----

  function setTexture2D(texture: Texture, slot: number): void {
    const textureProperties = textureProps(texture);

    // (video and external textures dropped)

    if (texture.isRenderTargetTexture === false && texture.version > 0 && textureProperties.__version !== texture.version) {
      const image = texture.image as AnyImage | null;

      if (image === null) {
        console.warn("keel/lit: Texture marked for update but no image data found.");
      } else if (image.complete === false) {
        console.warn("keel/lit: Texture marked for update but image is incomplete");
      } else {
        uploadTexture(textureProperties, texture, slot);
        return;
      }
    }

    state.bindTexture(_gl.TEXTURE_2D, textureProperties.__webglTexture, _gl.TEXTURE0 + slot);
  }

  // (keel/lit has no array, 3D or cube textures to upload: these only bind,
  // as r180 does for a texture with nothing to upload -- an empty cube or
  // array texture a sampler uniform falls back to)

  function bindOnly(webglType: number, texture: Texture, slot: number, what: string): void {
    const textureProperties = textureProps(texture);

    if (texture.version > 0 && textureProperties.__version !== texture.version) {
      throw new Error("keel/lit: " + what + " textures are not supported");
    }

    state.bindTexture(webglType, textureProperties.__webglTexture, _gl.TEXTURE0 + slot);
  }

  function setTexture2DArray(texture: Texture, slot: number): void {
    bindOnly(_gl.TEXTURE_2D_ARRAY, texture, slot, "array");
  }

  function setTexture3D(texture: Texture, slot: number): void {
    bindOnly(_gl.TEXTURE_3D, texture, slot, "3D");
  }

  function setTextureCube(texture: Texture, slot: number): void {
    bindOnly(_gl.TEXTURE_CUBE_MAP, texture, slot, "cube");
  }

  const wrappingToGL: Record<Wrapping, number> = {
    repeat: _gl.REPEAT,
    clamp: _gl.CLAMP_TO_EDGE,
    mirror: _gl.MIRRORED_REPEAT,
  };

  const filterToGL: Record<TextureFilter, number> = {
    nearest: _gl.NEAREST,
    "nearest-mipmap-nearest": _gl.NEAREST_MIPMAP_NEAREST,
    "nearest-mipmap-linear": _gl.NEAREST_MIPMAP_LINEAR,

    linear: _gl.LINEAR,
    "linear-mipmap-nearest": _gl.LINEAR_MIPMAP_NEAREST,
    "linear-mipmap-linear": _gl.LINEAR_MIPMAP_LINEAR,
  };

  const compareToGL: Record<CompareFunction, number> = {
    never: _gl.NEVER,
    always: _gl.ALWAYS,
    less: _gl.LESS,
    "less-equal": _gl.LEQUAL,
    equal: _gl.EQUAL,
    "greater-equal": _gl.GEQUAL,
    greater: _gl.GREATER,
    "not-equal": _gl.NOTEQUAL,
  };

  function setTextureParameters(textureType: number, texture: AnyTexture): void {
    if (texture.type === "float" && extensions.has("OES_texture_float_linear") === false &&
      (texture.magFilter === "linear" || texture.magFilter === "linear-mipmap-nearest" || texture.magFilter === "nearest-mipmap-linear" || texture.magFilter === "linear-mipmap-linear" ||
      texture.minFilter === "linear" || texture.minFilter === "linear-mipmap-nearest" || texture.minFilter === "nearest-mipmap-linear" || texture.minFilter === "linear-mipmap-linear")) {
      console.warn("keel/lit: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device.");
    }

    _gl.texParameteri(textureType, _gl.TEXTURE_WRAP_S, wrappingToGL[texture.wrapS]);
    _gl.texParameteri(textureType, _gl.TEXTURE_WRAP_T, wrappingToGL[texture.wrapT]);

    // (TEXTURE_WRAP_R is for 3D and array textures: dropped)

    _gl.texParameteri(textureType, _gl.TEXTURE_MAG_FILTER, filterToGL[texture.magFilter]);
    _gl.texParameteri(textureType, _gl.TEXTURE_MIN_FILTER, filterToGL[texture.minFilter]);

    if (texture.compareFunction) {
      _gl.texParameteri(textureType, _gl.TEXTURE_COMPARE_MODE, _gl.COMPARE_REF_TO_TEXTURE);
      _gl.texParameteri(textureType, _gl.TEXTURE_COMPARE_FUNC, compareToGL[texture.compareFunction]);
    }

    if (extensions.has("EXT_texture_filter_anisotropic") === true) {
      if (texture.magFilter === "nearest") return;
      if (texture.minFilter !== "nearest-mipmap-linear" && texture.minFilter !== "linear-mipmap-linear") return;
      if (texture.type === "float" && extensions.has("OES_texture_float_linear") === false) return; // (the extension, again)

      if (texture.anisotropy > 1 || textureProps(texture).__currentAnisotropy) {
        const extension = extensions.get("EXT_texture_filter_anisotropic");
        _gl.texParameterf(textureType, extension.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(texture.anisotropy, capabilities.getMaxAnisotropy()));
        textureProps(texture).__currentAnisotropy = texture.anisotropy;
      }
    }
  }

  function initTexture(textureProperties: TextureProperties, texture: Texture): boolean {
    let forceUpload = false;

    if (textureProperties.__webglInit === undefined) {
      textureProperties.__webglInit = true;

      texture.addEventListener("dispose", onTextureDispose);
    }

    // (the Source's WebGLTextures, by parameters)

    const source = texture.source;
    let webglTextures = _sources.get(source);

    if (webglTextures === undefined) {
      webglTextures = {};
      _sources.set(source, webglTextures);
    }

    // (one for these parameters already?)

    const textureCacheKey = getTextureCacheKey(texture);

    if (textureCacheKey !== textureProperties.__cacheKey) {
      // (if not, a new one)

      if (webglTextures[textureCacheKey] === undefined) {
        webglTextures[textureCacheKey] = {
          texture: _gl.createTexture(),
          usedTimes: 0,
        };

        info.memory.textures++;

        // (a new WebGLTexture needs the upload, even if the image is the same)

        forceUpload = true;
      }

      webglTextures[textureCacheKey].usedTimes++;

      // (the old key's WebGLTexture may now be unused: delete it, or it leaks)

      const webglTexture = webglTextures[textureProperties.__cacheKey!];

      if (webglTexture !== undefined) {
        webglTextures[textureProperties.__cacheKey!]!.usedTimes--;

        if (webglTexture.usedTimes === 0) {
          deleteTexture(texture);
        }
      }

      textureProperties.__cacheKey = textureCacheKey;
      textureProperties.__webglTexture = webglTextures[textureCacheKey].texture;
    }

    return forceUpload;
  }

  function getRow(index: number, rowLength: number, componentStride: number): number {
    return Math.floor(Math.floor(index / componentStride) / rowLength);
  }

  function updateTexture(texture: Texture, image: AnyImage, glFormat: number | null | undefined, glType: number | null | undefined): void {
    const componentStride = 4; // (RGBA only)

    const updateRanges = texture.updateRanges;

    if (updateRanges.length === 0) {
      state.texSubImage2D(_gl.TEXTURE_2D, 0, 0, 0, image.width, image.height, glFormat, glType, image.data);
    } else {
      // (adjacent and overlapping ranges merged first, in place: fewer
      // texSubImage2D calls, and no garbage; the ranges are cleared after)

      updateRanges.sort((a, b) => a.start - b.start);

      // (left to right: mergeIndex is the last merged range, the rest is trimmed after)
      let mergeIndex = 0;

      for (let i = 1; i < updateRanges.length; i++) {
        const previousRange = updateRanges[mergeIndex]!;
        const range = updateRanges[i]!;

        // (merged only within a row, and when they touch or overlap)
        const previousEnd = previousRange.start + previousRange.count;
        const currentRow = getRow(range.start, image.width, componentStride);
        const previousRow = getRow(previousRange.start, image.width, componentStride);

        // (+1 merges adjacent ones: ranges are positive integers)
        if (
          range.start <= previousEnd + 1 &&
          currentRow === previousRow &&
          getRow(range.start + range.count - 1, image.width, componentStride) === currentRow // (and doesn't spill into the next)
        ) {
          previousRange.count = Math.max(
            previousRange.count,
            range.start + range.count - previousRange.start,
          );
        } else {
          ++mergeIndex;
          updateRanges[mergeIndex] = range;
        }
      }

      updateRanges.length = mergeIndex + 1;

      const currentUnpackRowLen = _gl.getParameter(_gl.UNPACK_ROW_LENGTH);
      const currentUnpackSkipPixels = _gl.getParameter(_gl.UNPACK_SKIP_PIXELS);
      const currentUnpackSkipRows = _gl.getParameter(_gl.UNPACK_SKIP_ROWS);

      _gl.pixelStorei(_gl.UNPACK_ROW_LENGTH, image.width);

      for (let i = 0, l = updateRanges.length; i < l; i++) {
        const range = updateRanges[i]!;

        const pixelStart = Math.floor(range.start / componentStride);
        const pixelCount = Math.ceil(range.count / componentStride);

        const x = pixelStart % image.width;
        const y = Math.floor(pixelStart / image.width);

        // (contiguous memory)
        const width = pixelCount;
        const height = 1;

        _gl.pixelStorei(_gl.UNPACK_SKIP_PIXELS, x);
        _gl.pixelStorei(_gl.UNPACK_SKIP_ROWS, y);

        state.texSubImage2D(_gl.TEXTURE_2D, 0, x, y, width, height, glFormat, glType, image.data);
      }

      texture.clearUpdateRanges();

      _gl.pixelStorei(_gl.UNPACK_ROW_LENGTH, currentUnpackRowLen);
      _gl.pixelStorei(_gl.UNPACK_SKIP_PIXELS, currentUnpackSkipPixels);
      _gl.pixelStorei(_gl.UNPACK_SKIP_ROWS, currentUnpackSkipRows);
    }
  }

  function uploadTexture(textureProperties: TextureProperties, texture: AnyTexture, slot: number): void {
    // (array and 3D textures dropped: always TEXTURE_2D)
    const textureType = _gl.TEXTURE_2D;

    const forceUpload = initTexture(textureProperties, texture);
    const source = texture.source;

    state.bindTexture(textureType, textureProperties.__webglTexture, _gl.TEXTURE0 + slot);

    const sourceProperties = properties.get(source) as SourceProperties;

    if (source.version !== sourceProperties.__version || forceUpload === true) {
      state.activeTexture(_gl.TEXTURE0 + slot);

      const workingPrimaries = colorManagement.getPrimaries(colorManagement.workingColorSpace);
      const texturePrimaries = texture.colorSpace === "" ? null : colorManagement.getPrimaries(texture.colorSpace);
      const unpackConversion = texture.colorSpace === "" || workingPrimaries === texturePrimaries ? _gl.NONE : _gl.BROWSER_DEFAULT_WEBGL;

      _gl.pixelStorei(_gl.UNPACK_FLIP_Y_WEBGL, texture.flipY as unknown as number);
      _gl.pixelStorei(_gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha as unknown as number);
      _gl.pixelStorei(_gl.UNPACK_ALIGNMENT, texture.unpackAlignment);
      _gl.pixelStorei(_gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, unpackConversion);

      let image = resizeImage(texture.image, false, capabilities.maxTextureSize) as AnyImage;
      image = verifyColorSpace(texture, image);

      const glFormat = utils.convert(texture.format, texture.colorSpace);

      const glType = utils.convert(texture.type);
      let glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType, texture.colorSpace, false);

      setTextureParameters(textureType, texture);

      let mipmap: AnyImage;
      const mipmaps = texture.mipmaps as unknown as AnyImage[];

      // (r180 uses texImage2D only for video textures: dropped, so always texStorage2D)
      const useTexStorage = true;
      const allocateMemory = (sourceProperties.__version === undefined) || (forceUpload === true);
      const dataReady = source.dataReady;
      const levels = getMipLevels(texture, image);

      if (texture.isDepthTexture) {
        glInternalFormat = getInternalDepthFormat(texture.format === "depth-stencil", texture.type);

        //

        if (allocateMemory) {
          if (useTexStorage) {
            state.texStorage2D(_gl.TEXTURE_2D, 1, glInternalFormat, image.width, image.height);
          } else {
            state.texImage2D(_gl.TEXTURE_2D, 0, glInternalFormat, image.width, image.height, 0, glFormat, glType, null);
          }
        }
      } else if (texture.isDataTexture) {
        // (the user's mipmaps if any; otherwise level 0, and GL makes the rest)

        if (mipmaps.length > 0) {
          if (useTexStorage && allocateMemory) {
            state.texStorage2D(_gl.TEXTURE_2D, levels, glInternalFormat, mipmaps[0]!.width, mipmaps[0]!.height);
          }

          for (let i = 0, il = mipmaps.length; i < il; i++) {
            mipmap = mipmaps[i]!;

            if (useTexStorage) {
              if (dataReady) {
                state.texSubImage2D(_gl.TEXTURE_2D, i, 0, 0, mipmap.width, mipmap.height, glFormat, glType, mipmap.data);
              }
            } else {
              state.texImage2D(_gl.TEXTURE_2D, i, glInternalFormat, mipmap.width, mipmap.height, 0, glFormat, glType, mipmap.data);
            }
          }

          texture.generateMipmaps = false;
        } else {
          if (useTexStorage) {
            if (allocateMemory) {
              state.texStorage2D(_gl.TEXTURE_2D, levels, glInternalFormat, image.width, image.height);
            }

            if (dataReady) {
              updateTexture(texture, image, glFormat, glType);
            }
          } else {
            state.texImage2D(_gl.TEXTURE_2D, 0, glInternalFormat, image.width, image.height, 0, glFormat, glType, image.data);
          }
        }
      } else {
        // (compressed, data array, 3D and framebuffer textures dropped)

        // (a plain Texture: an image, a canvas, a bitmap; the user's mipmaps if
        // any, otherwise level 0 and GL makes the rest)

        if (mipmaps.length > 0) {
          if (useTexStorage && allocateMemory) {
            const dimensions = getDimensions(mipmaps[0]);

            state.texStorage2D(_gl.TEXTURE_2D, levels, glInternalFormat, dimensions.width, dimensions.height);
          }

          for (let i = 0, il = mipmaps.length; i < il; i++) {
            mipmap = mipmaps[i]!;

            if (useTexStorage) {
              if (dataReady) {
                state.texSubImage2D(_gl.TEXTURE_2D, i, 0, 0, glFormat, glType, mipmap);
              }
            } else {
              state.texImage2D(_gl.TEXTURE_2D, i, glInternalFormat, glFormat, glType, mipmap);
            }
          }

          texture.generateMipmaps = false;
        } else {
          if (useTexStorage) {
            if (allocateMemory) {
              const dimensions = getDimensions(image);

              state.texStorage2D(_gl.TEXTURE_2D, levels, glInternalFormat, dimensions.width, dimensions.height);
            }

            if (dataReady) {
              state.texSubImage2D(_gl.TEXTURE_2D, 0, 0, 0, glFormat, glType, image);
            }
          } else {
            state.texImage2D(_gl.TEXTURE_2D, 0, glInternalFormat, glFormat, glType, image);
          }
        }
      }

      if (textureNeedsGenerateMipmaps(texture)) {
        generateMipmap(textureType);
      }

      sourceProperties.__version = source.version;

      if (texture.onUpdate) texture.onUpdate(texture);
    }

    textureProperties.__version = texture.version;
  }

  // (uploadCubeTexture dropped: no cube textures)

  // ---- render targets

  // (storage for a target's texture, attached to the framebuffer)
  function setupFrameBufferTexture(framebuffer: WebGLFramebuffer | undefined, renderTarget: RenderTarget, texture: Texture, attachment: number, textureTarget: number, level: number): void {
    const glFormat = utils.convert(texture.format, texture.colorSpace);
    const glType = utils.convert(texture.type);
    const glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType, texture.colorSpace);
    const renderTargetProperties = targetProps(renderTarget);
    const textureProperties = textureProps(texture);

    textureProperties.__renderTarget = renderTarget;

    if (!renderTargetProperties.__hasExternalTextures) {
      const width = Math.max(1, renderTarget.width >> level);
      const height = Math.max(1, renderTarget.height >> level);

      // (3D and array targets dropped)

      state.texImage2D(textureTarget, level, glInternalFormat, width, height, 0, glFormat, glType, null);
    }

    state.bindFramebuffer(_gl.FRAMEBUFFER, framebuffer);

    if (useMultisampledRTT(renderTarget)) {
      multisampledRTTExt.framebufferTexture2DMultisampleEXT(_gl.FRAMEBUFFER, attachment, textureTarget, textureProperties.__webglTexture, 0, getRenderTargetSamples(renderTarget));
    } else if (textureTarget === _gl.TEXTURE_2D || (textureTarget >= _gl.TEXTURE_CUBE_MAP_POSITIVE_X && textureTarget <= _gl.TEXTURE_CUBE_MAP_NEGATIVE_Z)) { // (see three.js #24753)
      _gl.framebufferTexture2D(_gl.FRAMEBUFFER, attachment, textureTarget, textureProperties.__webglTexture!, level);
    }

    state.bindFramebuffer(_gl.FRAMEBUFFER, null);
  }

  // (storage for the internal depth / stencil buffer, attached to the framebuffer)
  function setupRenderBufferStorage(renderbuffer: WebGLRenderbuffer, renderTarget: RenderTarget, isMultisample: boolean): void {
    _gl.bindRenderbuffer(_gl.RENDERBUFFER, renderbuffer);

    if (renderTarget.depthBuffer) {
      // (the depth attachment's type)
      const depthTexture = renderTarget.depthTexture;
      const depthType = depthTexture && depthTexture.isDepthTexture ? depthTexture.type : null;
      const glInternalFormat = getInternalDepthFormat(renderTarget.stencilBuffer, depthType);
      const glAttachmentType = renderTarget.stencilBuffer ? _gl.DEPTH_STENCIL_ATTACHMENT : _gl.DEPTH_ATTACHMENT;

      // (the attachment)
      const samples = getRenderTargetSamples(renderTarget);
      const isUseMultisampledRTT = useMultisampledRTT(renderTarget);
      if (isUseMultisampledRTT) {
        multisampledRTTExt.renderbufferStorageMultisampleEXT(_gl.RENDERBUFFER, samples, glInternalFormat, renderTarget.width, renderTarget.height);
      } else if (isMultisample) {
        _gl.renderbufferStorageMultisample(_gl.RENDERBUFFER, samples, glInternalFormat, renderTarget.width, renderTarget.height);
      } else {
        _gl.renderbufferStorage(_gl.RENDERBUFFER, glInternalFormat, renderTarget.width, renderTarget.height);
      }

      _gl.framebufferRenderbuffer(_gl.FRAMEBUFFER, glAttachmentType, _gl.RENDERBUFFER, renderbuffer);
    } else {
      const textures = renderTarget.textures;

      for (let i = 0; i < textures.length; i++) {
        const texture = textures[i]!;

        const glFormat = utils.convert(texture.format, texture.colorSpace);
        const glType = utils.convert(texture.type);
        const glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType, texture.colorSpace);
        const samples = getRenderTargetSamples(renderTarget);

        if (isMultisample && useMultisampledRTT(renderTarget) === false) {
          _gl.renderbufferStorageMultisample(_gl.RENDERBUFFER, samples, glInternalFormat, renderTarget.width, renderTarget.height);
        } else if (useMultisampledRTT(renderTarget)) {
          multisampledRTTExt.renderbufferStorageMultisampleEXT(_gl.RENDERBUFFER, samples, glInternalFormat, renderTarget.width, renderTarget.height);
        } else {
          _gl.renderbufferStorage(_gl.RENDERBUFFER, glInternalFormat, renderTarget.width, renderTarget.height);
        }
      }
    }

    _gl.bindRenderbuffer(_gl.RENDERBUFFER, null);
  }

  // (a depth texture for a framebuffer)
  function setupDepthTexture(framebuffer: WebGLFramebuffer | undefined, renderTarget: RenderTarget): void {
    // (cube render targets dropped)

    state.bindFramebuffer(_gl.FRAMEBUFFER, framebuffer);

    if (!(renderTarget.depthTexture && renderTarget.depthTexture.isDepthTexture)) {
      throw new Error("keel/lit: renderTarget.depthTexture must be a DepthTexture");
    }

    const depthTexture = renderTarget.depthTexture;
    const textureProperties = textureProps(depthTexture);
    textureProperties.__renderTarget = renderTarget;

    // (an empty depth texture, the framebuffer's size)
    const depthImage = depthTexture.image as AnyImage;
    if (!textureProperties.__webglTexture ||
      depthImage.width !== renderTarget.width ||
      depthImage.height !== renderTarget.height) {
      depthImage.width = renderTarget.width;
      depthImage.height = renderTarget.height;
      depthTexture.needsUpdate = true;
    }

    setTexture2D(depthTexture, 0);

    const webglDepthTexture = textureProperties.__webglTexture!;
    const samples = getRenderTargetSamples(renderTarget);

    if (depthTexture.format === "depth") {
      if (useMultisampledRTT(renderTarget)) {
        multisampledRTTExt.framebufferTexture2DMultisampleEXT(_gl.FRAMEBUFFER, _gl.DEPTH_ATTACHMENT, _gl.TEXTURE_2D, webglDepthTexture, 0, samples);
      } else {
        _gl.framebufferTexture2D(_gl.FRAMEBUFFER, _gl.DEPTH_ATTACHMENT, _gl.TEXTURE_2D, webglDepthTexture, 0);
      }
    } else if (depthTexture.format === "depth-stencil") {
      if (useMultisampledRTT(renderTarget)) {
        multisampledRTTExt.framebufferTexture2DMultisampleEXT(_gl.FRAMEBUFFER, _gl.DEPTH_STENCIL_ATTACHMENT, _gl.TEXTURE_2D, webglDepthTexture, 0, samples);
      } else {
        _gl.framebufferTexture2D(_gl.FRAMEBUFFER, _gl.DEPTH_STENCIL_ATTACHMENT, _gl.TEXTURE_2D, webglDepthTexture, 0);
      }
    } else {
      throw new Error("keel/lit: Unknown depthTexture format");
    }
  }

  // (a depth buffer that isn't a texture)
  function setupDepthRenderbuffer(renderTarget: RenderTarget): void {
    const renderTargetProperties = targetProps(renderTarget);

    // (the depth texture changed?)
    if (renderTargetProperties.__boundDepthTexture !== renderTarget.depthTexture) {
      // (let go of the previous one's state)
      const depthTexture = renderTarget.depthTexture;
      if (renderTargetProperties.__depthDisposeCallback) {
        renderTargetProperties.__depthDisposeCallback();
      }

      // (and know when this one goes)
      if (depthTexture) {
        const disposeEvent = (): void => {
          delete renderTargetProperties.__boundDepthTexture;
          delete renderTargetProperties.__depthDisposeCallback;
          depthTexture.removeEventListener("dispose", disposeEvent);
        };

        depthTexture.addEventListener("dispose", disposeEvent);
        renderTargetProperties.__depthDisposeCallback = disposeEvent;
      }

      renderTargetProperties.__boundDepthTexture = depthTexture;
    }

    if (renderTarget.depthTexture && !renderTargetProperties.__autoAllocateDepthBuffer) {
      const mipmaps = renderTarget.texture.mipmaps;

      if (mipmaps && mipmaps.length > 0) {
        setupDepthTexture((renderTargetProperties.__webglFramebuffer as WebGLFramebuffer[])[0], renderTarget);
      } else {
        setupDepthTexture(renderTargetProperties.__webglFramebuffer as WebGLFramebuffer, renderTarget);
      }
    } else {
      // (cube render targets dropped)

      const mipmaps = renderTarget.texture.mipmaps;

      if (mipmaps && mipmaps.length > 0) {
        state.bindFramebuffer(_gl.FRAMEBUFFER, (renderTargetProperties.__webglFramebuffer as WebGLFramebuffer[])[0]);
      } else {
        state.bindFramebuffer(_gl.FRAMEBUFFER, renderTargetProperties.__webglFramebuffer as WebGLFramebuffer);
      }

      if (renderTargetProperties.__webglDepthbuffer === undefined) {
        renderTargetProperties.__webglDepthbuffer = _gl.createRenderbuffer();
        setupRenderBufferStorage(renderTargetProperties.__webglDepthbuffer, renderTarget, false);
      } else {
        // (made already: attach it)
        const glAttachmentType = renderTarget.stencilBuffer ? _gl.DEPTH_STENCIL_ATTACHMENT : _gl.DEPTH_ATTACHMENT;
        const renderbuffer = renderTargetProperties.__webglDepthbuffer;
        _gl.bindRenderbuffer(_gl.RENDERBUFFER, renderbuffer);
        _gl.framebufferRenderbuffer(_gl.FRAMEBUFFER, glAttachmentType, _gl.RENDERBUFFER, renderbuffer);
      }
    }

    state.bindFramebuffer(_gl.FRAMEBUFFER, null);
  }

  // (the framebuffer again, with external textures)
  function rebindTextures(renderTarget: RenderTarget, colorTexture: WebGLTexture | undefined, depthTexture: WebGLTexture | undefined): void {
    const renderTargetProperties = targetProps(renderTarget);

    if (colorTexture !== undefined) {
      setupFrameBufferTexture(renderTargetProperties.__webglFramebuffer as WebGLFramebuffer, renderTarget, renderTarget.texture, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, 0);
    }

    if (depthTexture !== undefined) {
      setupDepthRenderbuffer(renderTarget);
    }
  }

  // (a render target's GL resources)
  function setupRenderTarget(renderTarget: RenderTarget): void {
    const texture = renderTarget.texture;

    const renderTargetProperties = targetProps(renderTarget);
    const textureProperties = textureProps(texture);

    renderTarget.addEventListener("dispose", onRenderTargetDispose);

    const textures = renderTarget.textures;

    // (cube render targets dropped)
    const isMultipleRenderTargets = (textures.length > 1);

    if (!isMultipleRenderTargets) {
      if (textureProperties.__webglTexture === undefined) {
        textureProperties.__webglTexture = _gl.createTexture();
      }

      textureProperties.__version = texture.version;
      info.memory.textures++;
    }

    // (the framebuffer)

    if (texture.mipmaps && texture.mipmaps.length > 0) {
      const framebuffers: WebGLFramebuffer[] = [];
      renderTargetProperties.__webglFramebuffer = framebuffers;

      for (let level = 0; level < texture.mipmaps.length; level++) {
        framebuffers[level] = _gl.createFramebuffer();
      }
    } else {
      renderTargetProperties.__webglFramebuffer = _gl.createFramebuffer();
    }

    if (isMultipleRenderTargets) {
      for (let i = 0, il = textures.length; i < il; i++) {
        const attachmentProperties = textureProps(textures[i]!);

        if (attachmentProperties.__webglTexture === undefined) {
          attachmentProperties.__webglTexture = _gl.createTexture();

          info.memory.textures++;
        }
      }
    }

    if ((renderTarget.samples > 0) && useMultisampledRTT(renderTarget) === false) {
      const multisampledFramebuffer = _gl.createFramebuffer();
      const colorRenderbuffers: WebGLRenderbuffer[] = [];
      renderTargetProperties.__webglMultisampledFramebuffer = multisampledFramebuffer;
      renderTargetProperties.__webglColorRenderbuffer = colorRenderbuffers;

      state.bindFramebuffer(_gl.FRAMEBUFFER, multisampledFramebuffer);

      for (let i = 0; i < textures.length; i++) {
        const texture = textures[i]!;
        const colorRenderbuffer = _gl.createRenderbuffer();
        colorRenderbuffers[i] = colorRenderbuffer;

        _gl.bindRenderbuffer(_gl.RENDERBUFFER, colorRenderbuffer);

        const glFormat = utils.convert(texture.format, texture.colorSpace);
        const glType = utils.convert(texture.type);
        // (r180 forces a linear transfer for XR targets: dropped)
        const glInternalFormat = getInternalFormat(texture.internalFormat, glFormat, glType, texture.colorSpace, false);
        const samples = getRenderTargetSamples(renderTarget);
        _gl.renderbufferStorageMultisample(_gl.RENDERBUFFER, samples, glInternalFormat, renderTarget.width, renderTarget.height);

        _gl.framebufferRenderbuffer(_gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + i, _gl.RENDERBUFFER, colorRenderbuffer);
      }

      _gl.bindRenderbuffer(_gl.RENDERBUFFER, null);

      if (renderTarget.depthBuffer) {
        const depthRenderbuffer = _gl.createRenderbuffer();
        renderTargetProperties.__webglDepthRenderbuffer = depthRenderbuffer;
        setupRenderBufferStorage(depthRenderbuffer, renderTarget, true);
      }

      state.bindFramebuffer(_gl.FRAMEBUFFER, null);
    }

    // (the colour buffer)

    if (isMultipleRenderTargets) {
      for (let i = 0, il = textures.length; i < il; i++) {
        const attachment = textures[i]!;
        const attachmentProperties = textureProps(attachment);

        // (3D and array targets dropped)
        const glTextureType = _gl.TEXTURE_2D;

        state.bindTexture(glTextureType, attachmentProperties.__webglTexture);
        setTextureParameters(glTextureType, attachment);
        setupFrameBufferTexture(renderTargetProperties.__webglFramebuffer as WebGLFramebuffer, renderTarget, attachment, _gl.COLOR_ATTACHMENT0 + i, glTextureType, 0);

        if (textureNeedsGenerateMipmaps(attachment)) {
          generateMipmap(glTextureType);
        }
      }

      state.unbindTexture();
    } else {
      // (3D and array targets dropped)
      const glTextureType = _gl.TEXTURE_2D;

      state.bindTexture(glTextureType, textureProperties.__webglTexture);
      setTextureParameters(glTextureType, texture);

      if (texture.mipmaps && texture.mipmaps.length > 0) {
        for (let level = 0; level < texture.mipmaps.length; level++) {
          setupFrameBufferTexture((renderTargetProperties.__webglFramebuffer as WebGLFramebuffer[])[level], renderTarget, texture, _gl.COLOR_ATTACHMENT0, glTextureType, level);
        }
      } else {
        setupFrameBufferTexture(renderTargetProperties.__webglFramebuffer as WebGLFramebuffer, renderTarget, texture, _gl.COLOR_ATTACHMENT0, glTextureType, 0);
      }

      if (textureNeedsGenerateMipmaps(texture)) {
        generateMipmap(glTextureType);
      }

      state.unbindTexture();
    }

    // (the depth and stencil buffers)

    if (renderTarget.depthBuffer) {
      setupDepthRenderbuffer(renderTarget);
    }
  }

  function updateRenderTargetMipmap(renderTarget: RenderTarget): void {
    const textures = renderTarget.textures;

    for (let i = 0, il = textures.length; i < il; i++) {
      const texture = textures[i]!;

      if (textureNeedsGenerateMipmaps(texture)) {
        const targetType = getTargetType(renderTarget);
        const webglTexture = textureProps(texture).__webglTexture;

        state.bindTexture(targetType, webglTexture);
        generateMipmap(targetType);
        state.unbindTexture();
      }
    }
  }

  const invalidationArrayRead: number[] = [];
  const invalidationArrayDraw: number[] = [];

  function updateMultisampleRenderTarget(renderTarget: RenderTarget): void {
    if (renderTarget.samples > 0) {
      if (useMultisampledRTT(renderTarget) === false) {
        const textures = renderTarget.textures;
        const width = renderTarget.width;
        const height = renderTarget.height;
        let mask = _gl.COLOR_BUFFER_BIT;
        const depthStyle = renderTarget.stencilBuffer ? _gl.DEPTH_STENCIL_ATTACHMENT : _gl.DEPTH_ATTACHMENT;
        const renderTargetProperties = targetProps(renderTarget);
        const isMultipleRenderTargets = (textures.length > 1);
        const framebuffer = renderTargetProperties.__webglFramebuffer as WebGLFramebuffer;

        // (MRT: the attachments come off first)
        if (isMultipleRenderTargets) {
          for (let i = 0; i < textures.length; i++) {
            state.bindFramebuffer(_gl.FRAMEBUFFER, renderTargetProperties.__webglMultisampledFramebuffer);
            _gl.framebufferRenderbuffer(_gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + i, _gl.RENDERBUFFER, null);

            state.bindFramebuffer(_gl.FRAMEBUFFER, framebuffer);
            _gl.framebufferTexture2D(_gl.DRAW_FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + i, _gl.TEXTURE_2D, null, 0);
          }
        }

        state.bindFramebuffer(_gl.READ_FRAMEBUFFER, renderTargetProperties.__webglMultisampledFramebuffer);

        const mipmaps = renderTarget.texture.mipmaps;

        if (mipmaps && mipmaps.length > 0) {
          state.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, (renderTargetProperties.__webglFramebuffer as WebGLFramebuffer[])[0]);
        } else {
          state.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, framebuffer);
        }

        for (let i = 0; i < textures.length; i++) {
          if (renderTarget.resolveDepthBuffer) {
            if (renderTarget.depthBuffer) mask |= _gl.DEPTH_BUFFER_BIT;

            // (resolving stencil is slow on D3D: off for transmission targets, three.js #27799)

            if (renderTarget.stencilBuffer && renderTarget.resolveStencilBuffer) mask |= _gl.STENCIL_BUFFER_BIT;
          }

          if (isMultipleRenderTargets) {
            _gl.framebufferRenderbuffer(_gl.READ_FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.RENDERBUFFER, renderTargetProperties.__webglColorRenderbuffer![i]!);

            const webglTexture = textureProps(textures[i]!).__webglTexture!;
            _gl.framebufferTexture2D(_gl.DRAW_FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, webglTexture, 0);
          }

          _gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, mask, _gl.NEAREST);

          if (supportsInvalidateFramebuffer === true) {
            invalidationArrayRead.length = 0;
            invalidationArrayDraw.length = 0;

            invalidationArrayRead.push(_gl.COLOR_ATTACHMENT0 + i);

            if (renderTarget.depthBuffer && renderTarget.resolveDepthBuffer === false) {
              invalidationArrayRead.push(depthStyle);
              invalidationArrayDraw.push(depthStyle);

              _gl.invalidateFramebuffer(_gl.DRAW_FRAMEBUFFER, invalidationArrayDraw);
            }

            _gl.invalidateFramebuffer(_gl.READ_FRAMEBUFFER, invalidationArrayRead);
          }
        }

        state.bindFramebuffer(_gl.READ_FRAMEBUFFER, null);
        state.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, null);

        // (MRT: and back on)
        if (isMultipleRenderTargets) {
          for (let i = 0; i < textures.length; i++) {
            state.bindFramebuffer(_gl.FRAMEBUFFER, renderTargetProperties.__webglMultisampledFramebuffer);
            _gl.framebufferRenderbuffer(_gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + i, _gl.RENDERBUFFER, renderTargetProperties.__webglColorRenderbuffer![i]!);

            const webglTexture = textureProps(textures[i]!).__webglTexture!;

            state.bindFramebuffer(_gl.FRAMEBUFFER, framebuffer);
            _gl.framebufferTexture2D(_gl.DRAW_FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + i, _gl.TEXTURE_2D, webglTexture, 0);
          }
        }

        state.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, renderTargetProperties.__webglMultisampledFramebuffer);
      } else {
        if (renderTarget.depthBuffer && renderTarget.resolveDepthBuffer === false && supportsInvalidateFramebuffer) {
          const depthStyle = renderTarget.stencilBuffer ? _gl.DEPTH_STENCIL_ATTACHMENT : _gl.DEPTH_ATTACHMENT;

          _gl.invalidateFramebuffer(_gl.DRAW_FRAMEBUFFER, [depthStyle]);
        }
      }
    }
  }

  function getRenderTargetSamples(renderTarget: RenderTarget): number {
    return Math.min(capabilities.maxSamples, renderTarget.samples);
  }

  function useMultisampledRTT(renderTarget: RenderTarget): boolean {
    const renderTargetProperties = targetProps(renderTarget);

    return renderTarget.samples > 0 && extensions.has("WEBGL_multisampled_render_to_texture") === true && renderTargetProperties.__useRenderToTexture !== false;
  }

  // (updateVideoTexture dropped: no video textures)

  function verifyColorSpace(texture: Texture, image: AnyImage): AnyImage {
    const colorSpace = texture.colorSpace;
    const format = texture.format;
    const type = texture.type;

    // (compressed and video textures dropped)

    if (colorSpace !== "linear" && colorSpace !== "") {
      // (sRGB)

      if (colorManagement.getTransfer(colorSpace) === "srgb") {
        // (WebGL 2 decodes sRGB only for uncompressed RGBA8)

        if (format !== "rgba" || type !== "u8") {
          console.warn("keel/lit: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.");
        }
      } else {
        console.error("keel/lit: Unsupported texture color space:", colorSpace);
      }
    }

    return image;
  }

  function getDimensions(image: any): Vector2 {
    if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
      // (the intrinsic size, else width / height)

      _imageDimensions.width = image.naturalWidth || image.width;
      _imageDimensions.height = image.naturalHeight || image.height;
    } else if (typeof VideoFrame !== "undefined" && image instanceof VideoFrame) {
      _imageDimensions.width = image.displayWidth;
      _imageDimensions.height = image.displayHeight;
    } else {
      _imageDimensions.width = image.width;
      _imageDimensions.height = image.height;
    }

    return _imageDimensions;
  }

  //

  return {
    allocateTextureUnit,
    resetTextureUnits,

    setTexture2D,
    setTexture2DArray,
    setTexture3D,
    setTextureCube,
    rebindTextures,
    setupRenderTarget,
    updateRenderTargetMipmap,
    updateMultisampleRenderTarget,
    setupDepthRenderbuffer,
    setupFrameBufferTexture,
    useMultisampledRTT,
  };
}
