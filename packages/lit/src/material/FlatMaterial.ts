// Ported from Three.js r180's materials/MeshBasicMaterial.js (MIT, see packages/lit/NOTICE).

import { Color } from "../math/Color.ts";
import { Euler } from "../math/Euler.ts";
import { Material } from "./Material.ts";
import type { MaterialParameters } from "./Material.ts";
import type { Texture } from "../texture/Texture.ts";
import type { Combine } from "../constants.ts";

/** Unlit colour (r180's MeshBasicMaterial; the "flat" program). */
export class FlatMaterial extends Material {
  readonly isMeshBasicMaterial = true;
  // (KEEL's name for the same flag)
  readonly isFlatMaterial = true;

  color: Color;

  map: Texture | null;

  lightMap: Texture | null;
  lightMapIntensity: number;

  aoMap: Texture | null;
  aoMapIntensity: number;

  specularMap: Texture | null;

  alphaMap: Texture | null;

  envMap: Texture | null;
  envMapRotation: Euler;
  combine: Combine;
  reflectivity: number;
  refractionRatio: number;

  wireframe: boolean;
  wireframeLinewidth: number;
  wireframeLinecap: string;
  wireframeLinejoin: string;

  fog: boolean;

  constructor(parameters?: MaterialParameters<FlatMaterial>) {
    super();

    this.type = "FlatMaterial";

    // (the diffuse colour)
    this.color = new Color(0xffffff);

    this.map = null;

    this.lightMap = null;
    this.lightMapIntensity = 1.0;

    this.aoMap = null;
    this.aoMapIntensity = 1.0;

    this.specularMap = null;

    this.alphaMap = null;

    this.envMap = null;
    this.envMapRotation = new Euler();
    this.combine = "multiply";
    this.reflectivity = 1;
    this.refractionRatio = 0.98;

    this.wireframe = false;
    this.wireframeLinewidth = 1;
    this.wireframeLinecap = "round";
    this.wireframeLinejoin = "round";

    this.fog = true;

    this.setValues(parameters);
  }

  override copy(source: FlatMaterial): this {
    super.copy(source);

    this.color.copy(source.color);

    this.map = source.map;

    this.lightMap = source.lightMap;
    this.lightMapIntensity = source.lightMapIntensity;

    this.aoMap = source.aoMap;
    this.aoMapIntensity = source.aoMapIntensity;

    this.specularMap = source.specularMap;

    this.alphaMap = source.alphaMap;

    this.envMap = source.envMap;
    this.envMapRotation.copy(source.envMapRotation);
    this.combine = source.combine;
    this.reflectivity = source.reflectivity;
    this.refractionRatio = source.refractionRatio;

    this.wireframe = source.wireframe;
    this.wireframeLinewidth = source.wireframeLinewidth;
    this.wireframeLinecap = source.wireframeLinecap;
    this.wireframeLinejoin = source.wireframeLinejoin;

    this.fog = source.fog;

    return this;
  }
}
