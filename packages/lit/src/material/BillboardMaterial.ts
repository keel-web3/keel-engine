// Ported from Three.js r180's materials/SpriteMaterial.js (MIT, see packages/lit/NOTICE).

import { Color } from "../math/Color.ts";
import { Material } from "./Material.ts";
import type { MaterialParameters } from "./Material.ts";
import type { Texture } from "../texture/Texture.ts";

/** A billboard's surface (r180's SpriteMaterial; the "billboard" program). Transparent by default. */
export class BillboardMaterial extends Material {
  readonly isSpriteMaterial = true;
  // (KEEL's name for the same flag)
  readonly isBillboardMaterial = true;

  color: Color;

  map: Texture | null;

  alphaMap: Texture | null;

  rotation: number;

  sizeAttenuation: boolean;

  fog: boolean;

  constructor(parameters?: MaterialParameters<BillboardMaterial>) {
    super();

    this.type = "BillboardMaterial";

    this.color = new Color(0xffffff);

    this.map = null;

    this.alphaMap = null;

    this.rotation = 0;

    this.sizeAttenuation = true;

    this.transparent = true;

    this.fog = true;

    this.setValues(parameters);
  }

  override copy(source: BillboardMaterial): this {
    super.copy(source);

    this.color.copy(source.color);

    this.map = source.map;

    this.alphaMap = source.alphaMap;

    this.rotation = source.rotation;

    this.sizeAttenuation = source.sizeAttenuation;

    this.fog = source.fog;

    return this;
  }
}
