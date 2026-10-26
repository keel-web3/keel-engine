// Ported from Three.js r180's materials/MeshToonMaterial.js (MIT, see packages/lit/NOTICE).

import { Color } from "../math/Color.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Material } from "./Material.ts";
import type { MaterialParameters } from "./Material.ts";
import type { Texture } from "../texture/Texture.ts";
import type { NormalMapType } from "../constants.ts";

/** Banded (toon) shading through a gradient map (r180's MeshToonMaterial; the "toon" program). */
export class ToonMaterial extends Material {
  readonly isMeshToonMaterial = true;
  // (KEEL's name for the same flag)
  readonly isToonMaterial = true;

  defines: Record<string, unknown>;

  color: Color;

  map: Texture | null;
  gradientMap: Texture | null;

  lightMap: Texture | null;
  lightMapIntensity: number;

  aoMap: Texture | null;
  aoMapIntensity: number;

  emissive: Color;
  emissiveIntensity: number;
  emissiveMap: Texture | null;

  bumpMap: Texture | null;
  bumpScale: number;

  normalMap: Texture | null;
  normalMapType: NormalMapType;
  normalScale: Vector2;

  displacementMap: Texture | null;
  displacementScale: number;
  displacementBias: number;

  alphaMap: Texture | null;

  wireframe: boolean;
  wireframeLinewidth: number;
  wireframeLinecap: string;
  wireframeLinejoin: string;

  fog: boolean;

  constructor(parameters?: MaterialParameters<ToonMaterial>) {
    super();

    this.defines = { TOON: "" };

    this.type = "ToonMaterial";

    this.color = new Color(0xffffff);

    this.map = null;
    this.gradientMap = null;

    this.lightMap = null;
    this.lightMapIntensity = 1.0;

    this.aoMap = null;
    this.aoMapIntensity = 1.0;

    this.emissive = new Color(0x000000);
    this.emissiveIntensity = 1.0;
    this.emissiveMap = null;

    this.bumpMap = null;
    this.bumpScale = 1;

    this.normalMap = null;
    this.normalMapType = "tangent";
    this.normalScale = new Vector2(1, 1);

    this.displacementMap = null;
    this.displacementScale = 1;
    this.displacementBias = 0;

    this.alphaMap = null;

    this.wireframe = false;
    this.wireframeLinewidth = 1;
    this.wireframeLinecap = "round";
    this.wireframeLinejoin = "round";

    this.fog = true;

    this.setValues(parameters);
  }

  override copy(source: ToonMaterial): this {
    super.copy(source);

    this.color.copy(source.color);

    this.map = source.map;
    this.gradientMap = source.gradientMap;

    this.lightMap = source.lightMap;
    this.lightMapIntensity = source.lightMapIntensity;

    this.aoMap = source.aoMap;
    this.aoMapIntensity = source.aoMapIntensity;

    this.emissive.copy(source.emissive);
    this.emissiveMap = source.emissiveMap;
    this.emissiveIntensity = source.emissiveIntensity;

    this.bumpMap = source.bumpMap;
    this.bumpScale = source.bumpScale;

    this.normalMap = source.normalMap;
    this.normalMapType = source.normalMapType;
    this.normalScale.copy(source.normalScale);

    this.displacementMap = source.displacementMap;
    this.displacementScale = source.displacementScale;
    this.displacementBias = source.displacementBias;

    this.alphaMap = source.alphaMap;

    this.wireframe = source.wireframe;
    this.wireframeLinewidth = source.wireframeLinewidth;
    this.wireframeLinecap = source.wireframeLinecap;
    this.wireframeLinejoin = source.wireframeLinejoin;

    this.fog = source.fog;

    return this;
  }
}
