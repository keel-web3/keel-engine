// Ported from Three.js r180's textures/DataTexture.js (MIT, see packages/lit/NOTICE).

import { Texture } from "./Texture.ts";
import type { DataImage } from "./Source.ts";
import type { ColorSpace } from "../math/types.ts";
import type { Mapping, PixelFormat, TextureFilter, TextureType, Wrapping } from "../constants.ts";

/** A texture from raw texels. Nearest-filtered, unflipped, no mipmaps, unpack alignment 1. */
export class DataTexture extends Texture {
  readonly isDataTexture = true;

  constructor(
    data: ArrayBufferView | null = null,
    width = 1,
    height = 1,
    format?: PixelFormat,
    type?: TextureType,
    mapping?: Mapping,
    wrapS?: Wrapping,
    wrapT?: Wrapping,
    magFilter: TextureFilter = "nearest",
    minFilter: TextureFilter = "nearest",
    anisotropy?: number,
    colorSpace?: ColorSpace,
  ) {
    super(null, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy, colorSpace);

    this.image = { data: data, width: width, height: height };

    this.generateMipmaps = false;
    this.flipY = false;
    this.unpackAlignment = 1;
  }

  override get image(): DataImage {
    return this.source.data as DataImage;
  }

  override set image(value: DataImage) {
    this.source.data = value === undefined ? null : value;
  }
}
