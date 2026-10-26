// Ported from Three.js r180's textures/CanvasTexture.js (MIT, see packages/lit/NOTICE).

import { Texture } from "./Texture.ts";
import type { TextureImage } from "./Source.ts";
import type { Mapping, PixelFormat, TextureFilter, TextureType, Wrapping } from "../constants.ts";

/** A texture from a canvas, marked for upload as it is made. */
export class CanvasTexture extends Texture {
  readonly isCanvasTexture = true;

  constructor(
    canvas?: TextureImage,
    mapping?: Mapping,
    wrapS?: Wrapping,
    wrapT?: Wrapping,
    magFilter?: TextureFilter,
    minFilter?: TextureFilter,
    format?: PixelFormat,
    type?: TextureType,
    anisotropy?: number,
  ) {
    super(canvas, mapping, wrapS, wrapT, magFilter, minFilter, format, type, anisotropy);

    this.needsUpdate = true;
  }
}
