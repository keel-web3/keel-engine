// Ported from Three.js r180's textures/DepthTexture.js (MIT, see packages/lit/NOTICE).

import { Source } from "./Source.ts";
import type { SizeImage } from "./Source.ts";
import { Texture } from "./Texture.ts";
import type { CompareFunction, Mapping, PixelFormat, TextureFilter, TextureType, Wrapping } from "../constants.ts";

/** A render target's depth (or depth and stencil) as a texture. */
export class DepthTexture extends Texture {
  readonly isDepthTexture = true;

  /** Sampled as a shadow comparison when set (r180's *Compare constants; see COMPARE_FUNC). */
  compareFunction: CompareFunction | null;

  constructor(
    width?: number,
    height?: number,
    type: TextureType = "uint",
    mapping?: Mapping,
    wrapS?: Wrapping,
    wrapT?: Wrapping,
    magFilter: TextureFilter = "nearest",
    minFilter: TextureFilter = "nearest",
    anisotropy?: number,
    format: PixelFormat = "depth",
    depth = 1,
  ) {
    if (format !== "depth" && format !== "depth-stencil") {
      throw new Error('keel/lit DepthTexture: format must be "depth" or "depth-stencil"');
    }

    const image = { width: width, height: height, depth: depth } as SizeImage;

    super(image, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy);

    this.flipY = false;
    this.generateMipmaps = false;

    this.compareFunction = null;
  }

  override copy(source: DepthTexture): this {
    super.copy(source);

    // (#30540: a size of its own)
    this.source = new Source(Object.assign({}, source.image as SizeImage));
    this.compareFunction = source.compareFunction;

    return this;
  }
}
