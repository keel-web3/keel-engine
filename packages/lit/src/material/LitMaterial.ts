// Ported from Three.js r180's materials/MeshStandardMaterial.js (MIT, see packages/lit/NOTICE).

import { Color } from "../math/Color.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Euler } from "../math/Euler.ts";
import { Material } from "./Material.ts";
import type { MaterialParameters } from "./Material.ts";
import type { Texture } from "../texture/Texture.ts";
import type { NormalMapType } from "../constants.ts";

/** Physically based, metal and roughness (r180's MeshStandardMaterial; the "lit" program). */
export class LitMaterial extends Material {
  readonly isMeshStandardMaterial = true;
  // (KEEL's name for the same flag)
  readonly isLitMaterial = true;

  defines: Record<string, unknown>;

  color: Color;
  roughness: number;
  metalness: number;

  map: Texture | null;

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

  roughnessMap: Texture | null;

  metalnessMap: Texture | null;

  alphaMap: Texture | null;

  envMap: Texture | null;
  envMapRotation: Euler;
  envMapIntensity: number;

  wireframe: boolean;
  wireframeLinewidth: number;
  wireframeLinecap: string;
  wireframeLinejoin: string;

  flatShading: boolean;

  fog: boolean;

  constructor(parameters?: MaterialParameters<LitMaterial>) {
    super();

    this.type = "LitMaterial";

    this.defines = { STANDARD: "" };

    // (the diffuse colour)
    this.color = new Color(0xffffff);
    this.roughness = 1.0;
    this.metalness = 0.0;

    this.map = null;

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

    this.roughnessMap = null;

    this.metalnessMap = null;

    this.alphaMap = null;

    this.envMap = null;
    this.envMapRotation = new Euler();
    this.envMapIntensity = 1.0;

    this.wireframe = false;
    this.wireframeLinewidth = 1;
    this.wireframeLinecap = "round";
    this.wireframeLinejoin = "round";

    this.flatShading = false;

    this.fog = true;

    this.setValues(parameters);
  }

  override copy(source: LitMaterial): this {
    super.copy(source);

    this.defines = { STANDARD: "" };

    this.color.copy(source.color);
    this.roughness = source.roughness;
    this.metalness = source.metalness;

    this.map = source.map;

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

    this.roughnessMap = source.roughnessMap;

    this.metalnessMap = source.metalnessMap;

    this.alphaMap = source.alphaMap;

    this.envMap = source.envMap;
    this.envMapRotation.copy(source.envMapRotation);
    this.envMapIntensity = source.envMapIntensity;

    this.wireframe = source.wireframe;
    this.wireframeLinewidth = source.wireframeLinewidth;
    this.wireframeLinecap = source.wireframeLinecap;
    this.wireframeLinejoin = source.wireframeLinejoin;

    this.flatShading = source.flatShading;

    this.fog = source.fog;

    return this;
  }
}
