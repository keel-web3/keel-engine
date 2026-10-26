// Ported from Three.js r180's textures/Texture.js (MIT, see packages/lit/NOTICE).
// toJSON is not ported. The constants are KEEL's typed strings (src/constants.ts).

import { generateUUID } from "../math/mathUtils.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Matrix3 } from "../math/Matrix3.ts";
import { Emitter } from "../core/Emitter.ts";
import { Source } from "./Source.ts";
import type { TextureImage } from "./Source.ts";
import type { ColorSpace } from "../math/types.ts";
import type { Mapping, PixelFormat, TextureFilter, TextureType, Wrapping } from "../constants.ts";
import type { RenderTarget } from "./RenderTarget.ts";

export interface TextureUpdateRange {
  start: number;
  count: number;
}

/** A mip level's image. */
export type Mipmap = TextureImage;

let _textureId = 0;

const _tempVec3 = /*@__PURE__*/ new Vector3();

export class Texture extends Emitter {
  static DEFAULT_IMAGE: TextureImage = null;
  static DEFAULT_MAPPING: Mapping = "uv";
  static DEFAULT_ANISOTROPY = 1;

  readonly isTexture = true;

  declare readonly id: number;

  uuid: string;
  name: string;

  source: Source;
  mipmaps: Mipmap[];

  mapping: Mapping;
  channel: number;

  wrapS: Wrapping;
  wrapT: Wrapping;

  magFilter: TextureFilter;
  minFilter: TextureFilter;

  anisotropy: number;

  format: PixelFormat;
  internalFormat: string | null;
  type: TextureType;

  offset: Vector2;
  repeat: Vector2;
  center: Vector2;
  rotation: number;

  matrixAutoUpdate: boolean;
  matrix: Matrix3;

  generateMipmaps: boolean;
  premultiplyAlpha: boolean;
  flipY: boolean;
  /** 1, 2, 4 or 8 (glPixelStorei's UNPACK_ALIGNMENT). */
  unpackAlignment: number;

  colorSpace: ColorSpace;

  userData: Record<string, unknown>;

  updateRanges: TextureUpdateRange[];

  version: number;
  onUpdate: ((texture: Texture) => void) | null;

  renderTarget: RenderTarget | null;
  isRenderTargetTexture: boolean;
  isArrayTexture: boolean;

  pmremVersion: number;

  constructor(
    image: TextureImage = Texture.DEFAULT_IMAGE,
    mapping: Mapping = Texture.DEFAULT_MAPPING,
    wrapS: Wrapping = "clamp",
    wrapT: Wrapping = "clamp",
    magFilter: TextureFilter = "linear",
    minFilter: TextureFilter = "linear-mipmap-linear",
    format: PixelFormat = "rgba",
    type: TextureType = "u8",
    anisotropy: number = Texture.DEFAULT_ANISOTROPY,
    colorSpace: ColorSpace = "",
  ) {
    super();

    Object.defineProperty(this, "id", { value: _textureId++ });

    this.uuid = generateUUID();

    this.name = "";

    this.source = new Source(image);
    this.mipmaps = [];

    this.mapping = mapping;
    this.channel = 0;

    this.wrapS = wrapS;
    this.wrapT = wrapT;

    this.magFilter = magFilter;
    this.minFilter = minFilter;

    this.anisotropy = anisotropy;

    this.format = format;
    this.internalFormat = null;
    this.type = type;

    this.offset = new Vector2(0, 0);
    this.repeat = new Vector2(1, 1);
    this.center = new Vector2(0, 0);
    this.rotation = 0;

    this.matrixAutoUpdate = true;
    this.matrix = new Matrix3();

    this.generateMipmaps = true;
    this.premultiplyAlpha = false;
    this.flipY = true;
    this.unpackAlignment = 4;

    this.colorSpace = colorSpace;

    this.userData = {};

    this.updateRanges = [];

    this.version = 0;
    this.onUpdate = null;

    this.renderTarget = null;
    this.isRenderTargetTexture = false;
    const sized = image as { depth?: number } | null;
    this.isArrayTexture = sized && sized.depth && sized.depth > 1 ? true : false;

    this.pmremVersion = 0;
  }

  get width(): number {
    return this.source.getSize(_tempVec3).x;
  }

  get height(): number {
    return this.source.getSize(_tempVec3).y;
  }

  get depth(): number {
    return this.source.getSize(_tempVec3).z;
  }

  get image(): TextureImage {
    return this.source.data;
  }

  set image(value: TextureImage) {
    this.source.data = value === undefined ? null : value;
  }

  updateMatrix(): void {
    this.matrix.setUvTransform(this.offset.x, this.offset.y, this.repeat.x, this.repeat.y, this.rotation, this.center.x, this.center.y);
  }

  addUpdateRange(start: number, count: number): void {
    this.updateRanges.push({ start, count });
  }

  clearUpdateRanges(): void {
    this.updateRanges.length = 0;
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }

  copy(source: Texture): this {
    this.name = source.name;

    this.source = source.source;
    this.mipmaps = source.mipmaps.slice(0);

    this.mapping = source.mapping;
    this.channel = source.channel;

    this.wrapS = source.wrapS;
    this.wrapT = source.wrapT;

    this.magFilter = source.magFilter;
    this.minFilter = source.minFilter;

    this.anisotropy = source.anisotropy;

    this.format = source.format;
    this.internalFormat = source.internalFormat;
    this.type = source.type;

    this.offset.copy(source.offset);
    this.repeat.copy(source.repeat);
    this.center.copy(source.center);
    this.rotation = source.rotation;

    this.matrixAutoUpdate = source.matrixAutoUpdate;
    this.matrix.copy(source.matrix);

    this.generateMipmaps = source.generateMipmaps;
    this.premultiplyAlpha = source.premultiplyAlpha;
    this.flipY = source.flipY;
    this.unpackAlignment = source.unpackAlignment;
    this.colorSpace = source.colorSpace;

    this.renderTarget = source.renderTarget;
    this.isRenderTargetTexture = source.isRenderTargetTexture;
    this.isArrayTexture = source.isArrayTexture;

    this.userData = JSON.parse(JSON.stringify(source.userData)) as Record<string, unknown>;

    this.needsUpdate = true;

    return this;
  }

  setValues(values: Record<string, unknown>): void {
    const self = this as unknown as Record<string, unknown>;

    for (const key in values) {
      const newValue = values[key] as { isVector2?: boolean; isVector3?: boolean; isMatrix3?: boolean } | undefined;

      if (newValue === undefined) {
        console.warn(`keel/lit Texture.setValues(): parameter '${key}' has value of undefined.`);
        continue;
      }

      const currentValue = self[key] as { isVector2?: boolean; isVector3?: boolean; isMatrix3?: boolean; copy(v: unknown): unknown } | undefined;

      if (currentValue === undefined) {
        console.warn(`keel/lit Texture.setValues(): property '${key}' does not exist.`);
        continue;
      }

      if (currentValue && newValue && currentValue.isVector2 && newValue.isVector2) {
        currentValue.copy(newValue);
      } else if (currentValue && newValue && currentValue.isVector3 && newValue.isVector3) {
        currentValue.copy(newValue);
      } else if (currentValue && newValue && currentValue.isMatrix3 && newValue.isMatrix3) {
        currentValue.copy(newValue);
      } else {
        self[key] = newValue;
      }
    }
  }

  dispose(): void {
    this.dispatchEvent({ type: "dispose" });
  }

  /** Maps a uv through this texture's transform and wrapping, as the GPU would sample it. */
  transformUv(uv: Vector2): Vector2 {
    if (this.mapping !== "uv") return uv;

    uv.applyMatrix3(this.matrix);

    if (uv.x < 0 || uv.x > 1) {
      switch (this.wrapS) {
        case "repeat":
          uv.x = uv.x - Math.floor(uv.x);
          break;

        case "clamp":
          uv.x = uv.x < 0 ? 0 : 1;
          break;

        case "mirror":
          if (Math.abs(Math.floor(uv.x) % 2) === 1) {
            uv.x = Math.ceil(uv.x) - uv.x;
          } else {
            uv.x = uv.x - Math.floor(uv.x);
          }

          break;
      }
    }

    if (uv.y < 0 || uv.y > 1) {
      switch (this.wrapT) {
        case "repeat":
          uv.y = uv.y - Math.floor(uv.y);
          break;

        case "clamp":
          uv.y = uv.y < 0 ? 0 : 1;
          break;

        case "mirror":
          if (Math.abs(Math.floor(uv.y) % 2) === 1) {
            uv.y = Math.ceil(uv.y) - uv.y;
          } else {
            uv.y = uv.y - Math.floor(uv.y);
          }

          break;
      }
    }

    if (this.flipY) {
      uv.y = 1 - uv.y;
    }

    return uv;
  }

  set needsUpdate(value: boolean) {
    if (value === true) {
      this.version++;
      this.source.needsUpdate = true;
    }
  }

  set needsPMREMUpdate(value: boolean) {
    if (value === true) {
      this.pmremVersion++;
    }
  }
}
