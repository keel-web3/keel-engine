// Ported from Three.js r180's core/RenderTarget.js and renderers/WebGLRenderTarget.js
// (MIT, see packages/lit/NOTICE): one class, KEEL's RenderTarget.

import { Vector4 } from "../math/Vector4.ts";
import { Emitter } from "../core/Emitter.ts";
import { Texture } from "./Texture.ts";
import { Source } from "./Source.ts";
import type { SizeImage } from "./Source.ts";
import type { DepthTexture } from "./DepthTexture.ts";
import type { ColorSpace } from "../math/types.ts";
import type { Mapping, PixelFormat, TextureFilter, TextureType, Wrapping } from "../constants.ts";

export interface RenderTargetOptions {
  generateMipmaps?: boolean;
  internalFormat?: string | null;
  minFilter?: TextureFilter;
  magFilter?: TextureFilter;
  depthBuffer?: boolean;
  stencilBuffer?: boolean;
  resolveDepthBuffer?: boolean;
  resolveStencilBuffer?: boolean;
  depthTexture?: DepthTexture | null;
  /** MSAA samples (0: none). */
  samples?: number;
  /** How many colour textures (MRT). */
  count?: number;
  depth?: number;
  multiview?: boolean;
  mapping?: Mapping;
  wrapS?: Wrapping;
  wrapT?: Wrapping;
  wrapR?: Wrapping;
  format?: PixelFormat;
  type?: TextureType;
  anisotropy?: number;
  colorSpace?: ColorSpace;
  flipY?: boolean;
}

/** Something to draw into instead of the canvas: colour texture(s) and a depth buffer (r180's WebGLRenderTarget). */
export class RenderTarget extends Emitter {
  readonly isRenderTarget = true;

  width: number;
  height: number;
  depth: number;

  scissor: Vector4;
  scissorTest: boolean;

  viewport: Vector4;

  textures: Texture[];

  depthBuffer: boolean;
  stencilBuffer: boolean;

  resolveDepthBuffer: boolean;
  resolveStencilBuffer: boolean;

  _depthTexture: DepthTexture | null;

  samples: number;

  multiview: boolean;

  // (r180's WebGLRenderTarget flag: this is that class)
  readonly isWebGLRenderTarget = true;

  constructor(width = 1, height = 1, options: RenderTargetOptions = {}) {
    super();

    const o = Object.assign({
      generateMipmaps: false,
      internalFormat: null,
      minFilter: "linear",
      depthBuffer: true,
      stencilBuffer: false,
      resolveDepthBuffer: true,
      resolveStencilBuffer: true,
      depthTexture: null,
      samples: 0,
      count: 1,
      depth: 1,
      multiview: false,
    } as const, options) as Required<Pick<RenderTargetOptions, "depthBuffer" | "stencilBuffer" | "resolveDepthBuffer" | "resolveStencilBuffer" | "samples" | "count" | "depth" | "multiview">> & RenderTargetOptions & { depthTexture: DepthTexture | null };

    this.width = width;
    this.height = height;
    this.depth = o.depth;

    this.scissor = new Vector4(0, 0, width, height);
    this.scissorTest = false;

    this.viewport = new Vector4(0, 0, width, height);

    const image: SizeImage = { width: width, height: height, depth: o.depth };

    const texture = new Texture(image);

    this.textures = [];

    const count = o.count;
    for (let i = 0; i < count; i++) {
      const t = texture.clone();
      this.textures[i] = t;
      t.isRenderTargetTexture = true;
      t.renderTarget = this;
    }

    this._setTextureOptions(o);

    this.depthBuffer = o.depthBuffer;
    this.stencilBuffer = o.stencilBuffer;

    this.resolveDepthBuffer = o.resolveDepthBuffer;
    this.resolveStencilBuffer = o.resolveStencilBuffer;

    this._depthTexture = null;
    this.depthTexture = o.depthTexture;

    this.samples = o.samples;

    this.multiview = o.multiview;
  }

  _setTextureOptions(options: RenderTargetOptions = {}): void {
    const values: Record<string, unknown> = {
      minFilter: "linear",
      generateMipmaps: false,
      flipY: false,
      internalFormat: null,
    };

    if (options.mapping !== undefined) values["mapping"] = options.mapping;
    if (options.wrapS !== undefined) values["wrapS"] = options.wrapS;
    if (options.wrapT !== undefined) values["wrapT"] = options.wrapT;
    if (options.wrapR !== undefined) values["wrapR"] = options.wrapR;
    if (options.magFilter !== undefined) values["magFilter"] = options.magFilter;
    if (options.minFilter !== undefined) values["minFilter"] = options.minFilter;
    if (options.format !== undefined) values["format"] = options.format;
    if (options.type !== undefined) values["type"] = options.type;
    if (options.anisotropy !== undefined) values["anisotropy"] = options.anisotropy;
    if (options.colorSpace !== undefined) values["colorSpace"] = options.colorSpace;
    if (options.flipY !== undefined) values["flipY"] = options.flipY;
    if (options.generateMipmaps !== undefined) values["generateMipmaps"] = options.generateMipmaps;
    if (options.internalFormat !== undefined) values["internalFormat"] = options.internalFormat;

    for (let i = 0; i < this.textures.length; i++) {
      const texture = this.textures[i]!;
      texture.setValues(values);
    }
  }

  get texture(): Texture {
    return this.textures[0]!;
  }

  set texture(value: Texture) {
    this.textures[0] = value;
  }

  set depthTexture(current: DepthTexture | null) {
    if (this._depthTexture !== null) this._depthTexture.renderTarget = null;
    if (current !== null) current.renderTarget = this;

    this._depthTexture = current;
  }

  get depthTexture(): DepthTexture | null {
    return this._depthTexture;
  }

  setSize(width: number, height: number, depth = 1): void {
    if (this.width !== width || this.height !== height || this.depth !== depth) {
      this.width = width;
      this.height = height;
      this.depth = depth;

      for (let i = 0, il = this.textures.length; i < il; i++) {
        const t = this.textures[i]!;
        const image = t.image as SizeImage;
        image.width = width;
        image.height = height;
        image.depth = depth;
        t.isArrayTexture = image.depth > 1;
      }

      this.dispose();
    }

    this.viewport.set(0, 0, width, height);
    this.scissor.set(0, 0, width, height);
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }

  copy(source: RenderTarget): this {
    this.width = source.width;
    this.height = source.height;
    this.depth = source.depth;

    this.scissor.copy(source.scissor);
    this.scissorTest = source.scissorTest;

    this.viewport.copy(source.viewport);

    this.textures.length = 0;

    for (let i = 0, il = source.textures.length; i < il; i++) {
      const t = source.textures[i]!.clone();
      this.textures[i] = t;
      t.isRenderTargetTexture = true;
      t.renderTarget = this;

      // (a size of its own: the texture's image can't be shared, setSize would change both)
      const image = Object.assign({}, source.textures[i]!.image as SizeImage);
      t.source = new Source(image);
    }

    this.depthBuffer = source.depthBuffer;
    this.stencilBuffer = source.stencilBuffer;

    this.resolveDepthBuffer = source.resolveDepthBuffer;
    this.resolveStencilBuffer = source.resolveStencilBuffer;

    if (source.depthTexture !== null) this.depthTexture = source.depthTexture.clone();

    this.samples = source.samples;

    return this;
  }

  dispose(): void {
    this.dispatchEvent({ type: "dispose" });
  }
}
