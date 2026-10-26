// Ported from Three.js r180's textures/Source.js (MIT, see packages/lit/NOTICE).
// toJSON is not ported.

import { generateUUID } from "../math/mathUtils.ts";
import type { Vector3 } from "../math/Vector3.ts";

/** A data texture's image: raw texels and a size. */
export interface DataImage {
  data: ArrayBufferView | null;
  width: number;
  height: number;
  depth?: number;
}

/** A render target's or depth texture's image: just a size. */
export interface SizeImage {
  width: number;
  height: number;
  depth?: number;
}

/** What a texture's source holds: an image, a canvas, a bitmap, raw texels or just a size. */
export type TextureImage = TexImageSource | OffscreenCanvas | DataImage | SizeImage | null;

let _sourceId = 0;

/** A texture's data, shared between textures that copy each other (r180's Source). */
export class Source {
  readonly isSource = true;

  declare readonly id: number;

  uuid: string;
  data: TextureImage;
  dataReady: boolean;
  version: number;

  constructor(data: TextureImage = null) {
    Object.defineProperty(this, "id", { value: _sourceId++ });

    this.uuid = generateUUID();

    this.data = data;

    this.dataReady = true;

    this.version = 0;
  }

  getSize(target: Vector3): Vector3 {
    const data = this.data as unknown as { width: number; height: number; depth?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number } | null;

    if (typeof HTMLVideoElement !== "undefined" && data instanceof HTMLVideoElement) {
      target.set(data.videoWidth, data.videoHeight, 0);
    } else if (typeof VideoFrame !== "undefined" && data instanceof VideoFrame) {
      // (sic: r180 swaps a video frame's width and height)
      target.set(data.displayHeight, data.displayWidth, 0);
    } else if (data !== null) {
      target.set(data.width, data.height, data.depth || 0);
    } else {
      target.set(0, 0, 0);
    }

    return target;
  }

  set needsUpdate(value: boolean) {
    if (value === true) this.version++;
  }
}
