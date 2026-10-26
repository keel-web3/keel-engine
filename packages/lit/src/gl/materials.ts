// Ported from Three.js r180's renderers/webgl/WebGLMaterials.js and
// UniformsUtils' getUnlitUniformColorSpace (MIT, see packages/lit/NOTICE).
//
// Copies a material's state into its program's uniforms before an upload:
// fog, the common block (opacity, diffuse, emissive x intensity, every map and
// its uv transform, alphaTest, env map, light and ao maps), and each class's
// own (lit: roughness and metalness; toon: gradientMap; billboard: rotation;
// distance: the light's position and range). A CustomMaterial's uniforms are
// its own: only uniformsNeedUpdate is reset, as in r180.
//
// Dropped (no such class in keel/lit): Lambert, Phong, Matcap, Normal, Line,
// Dashed, Points and Shadow materials, and the physical extras
// (refreshUniformsPhysical: LitMaterial is r180's MeshStandardMaterial, never
// isMeshPhysicalMaterial).

import { Euler } from "../math/Euler.ts";
import { Matrix4 } from "../math/Matrix4.ts";
import { colorManagement } from "../math/ColorManagement.ts";
import type { ColorSpace } from "../math/types.ts";
import type { Color } from "../math/Color.ts";
import type { Matrix3 } from "../math/Matrix3.ts";

const _e1 = /*@__PURE__*/ new Euler();
const _m1 = /*@__PURE__*/ new Matrix4();

/** What getUnlitUniformColorSpace reads of the renderer. */
export interface UnlitColorSpaceRenderer {
  getRenderTarget(): { readonly isXRRenderTarget?: boolean; readonly texture: { readonly colorSpace: ColorSpace } } | null;
  readonly outputColorSpace: ColorSpace;
}

/** r180's getUnlitUniformColorSpace: the colour space unlit uniform colours (fog, clear colour) are given in. */
export function getUnlitUniformColorSpace(renderer: UnlitColorSpaceRenderer): ColorSpace {
  const currentRenderTarget = renderer.getRenderTarget();

  if (currentRenderTarget === null) {
    // https://github.com/mrdoob/three.js/pull/23937#issuecomment-1111067398
    return renderer.outputColorSpace;
  }

  // https://github.com/mrdoob/three.js/issues/27868
  if (currentRenderTarget.isXRRenderTarget === true) {
    return currentRenderTarget.texture.colorSpace;
  }

  return colorManagement.workingColorSpace;
}

/** A map, as the uv transform refresh reads it. */
interface MapLike {
  matrixAutoUpdate: boolean;
  updateMatrix(): void;
  readonly matrix: Matrix3;
}

// (r180 reads whatever the material class has; the uniforms are the program's)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** A program's uniforms: r180's `{ value }` objects. */
export type MaterialUniforms = Record<string, { value: Any; needsUpdate?: boolean }>;

/** The fog, as refreshFogUniforms reads it. */
export interface FogLike {
  readonly color: Color;
  readonly isFog?: boolean;
  readonly isFogExp2?: boolean;
  readonly near?: number;
  readonly far?: number;
  readonly density?: number;
}

/** r180's WebGLProperties, as the materials read it (the env map getProgram resolved). */
export interface MaterialsProperties {
  get(object: object): Any;
}

export interface Materials {
  refreshFogUniforms(uniforms: MaterialUniforms, fog: FogLike): void;
  refreshMaterialUniforms(uniforms: MaterialUniforms, material: object, pixelRatio: number, height: number, transmissionRenderTarget?: unknown): void;
}

/** r180's WebGLMaterials. */
export function createMaterials(renderer: UnlitColorSpaceRenderer, properties: MaterialsProperties): Materials {
  function refreshTransformUniform(map: MapLike, uniform: { value: Any }): void {
    if (map.matrixAutoUpdate === true) {
      map.updateMatrix();
    }

    uniform.value.copy(map.matrix);
  }

  function refreshFogUniforms(uniforms: MaterialUniforms, fog: FogLike): void {
    fog.color.getRGB(uniforms["fogColor"]!.value, getUnlitUniformColorSpace(renderer));

    if (fog.isFog) {
      uniforms["fogNear"]!.value = fog.near;
      uniforms["fogFar"]!.value = fog.far;
    } else if (fog.isFogExp2) {
      uniforms["fogDensity"]!.value = fog.density;
    }
  }

  function refreshMaterialUniforms(uniforms: MaterialUniforms, m: object, _pixelRatio: number, _height: number, _transmissionRenderTarget?: unknown): void {
    const material = m as Any;

    if (material.isMeshBasicMaterial) {
      refreshUniformsCommon(uniforms, material);
    } else if (material.isMeshToonMaterial) {
      refreshUniformsCommon(uniforms, material);
      refreshUniformsToon(uniforms, material);
    } else if (material.isMeshStandardMaterial) {
      refreshUniformsCommon(uniforms, material);
      refreshUniformsStandard(uniforms, material);

      // (isMeshPhysicalMaterial: not ported, see the header)
    } else if (material.isMeshDepthMaterial) {
      refreshUniformsCommon(uniforms, material);
    } else if (material.isMeshDistanceMaterial) {
      refreshUniformsCommon(uniforms, material);
      refreshUniformsDistance(uniforms, material);
    } else if (material.isSpriteMaterial) {
      refreshUniformsSprites(uniforms, material);
    } else if (material.isShaderMaterial) {
      material.uniformsNeedUpdate = false; // #15581
    }
  }

  function refreshUniformsCommon(uniforms: MaterialUniforms, material: Any): void {
    const u = uniforms as Record<string, { value: Any }>;

    u["opacity"]!.value = material.opacity;

    if (material.color) {
      u["diffuse"]!.value.copy(material.color);
    }

    if (material.emissive) {
      u["emissive"]!.value.copy(material.emissive).multiplyScalar(material.emissiveIntensity);
    }

    if (material.map) {
      u["map"]!.value = material.map;

      refreshTransformUniform(material.map, u["mapTransform"]!);
    }

    if (material.alphaMap) {
      u["alphaMap"]!.value = material.alphaMap;

      refreshTransformUniform(material.alphaMap, u["alphaMapTransform"]!);
    }

    if (material.bumpMap) {
      u["bumpMap"]!.value = material.bumpMap;

      refreshTransformUniform(material.bumpMap, u["bumpMapTransform"]!);

      u["bumpScale"]!.value = material.bumpScale;

      if (material.side === "back") {
        u["bumpScale"]!.value *= -1;
      }
    }

    if (material.normalMap) {
      u["normalMap"]!.value = material.normalMap;

      refreshTransformUniform(material.normalMap, u["normalMapTransform"]!);

      u["normalScale"]!.value.copy(material.normalScale);

      if (material.side === "back") {
        u["normalScale"]!.value.negate();
      }
    }

    if (material.displacementMap) {
      u["displacementMap"]!.value = material.displacementMap;

      refreshTransformUniform(material.displacementMap, u["displacementMapTransform"]!);

      u["displacementScale"]!.value = material.displacementScale;
      u["displacementBias"]!.value = material.displacementBias;
    }

    if (material.emissiveMap) {
      u["emissiveMap"]!.value = material.emissiveMap;

      refreshTransformUniform(material.emissiveMap, u["emissiveMapTransform"]!);
    }

    if (material.specularMap) {
      u["specularMap"]!.value = material.specularMap;

      refreshTransformUniform(material.specularMap, u["specularMapTransform"]!);
    }

    if (material.alphaTest > 0) {
      u["alphaTest"]!.value = material.alphaTest;
    }

    const materialProperties = properties.get(material);

    const envMap = materialProperties.envMap;
    const envMapRotation = materialProperties.envMapRotation;

    if (envMap) {
      u["envMap"]!.value = envMap;

      _e1.copy(envMapRotation);

      // accommodate left-handed frame
      _e1.x *= -1; _e1.y *= -1; _e1.z *= -1;

      if (envMap.isCubeTexture && envMap.isRenderTargetTexture === false) {
        // environment maps which are not cube render targets or PMREMs follow a different convention
        _e1.y *= -1;
        _e1.z *= -1;
      }

      u["envMapRotation"]!.value.setFromMatrix4(_m1.makeRotationFromEuler(_e1));

      u["flipEnvMap"]!.value = (envMap.isCubeTexture && envMap.isRenderTargetTexture === false) ? -1 : 1;

      u["reflectivity"]!.value = material.reflectivity;
      u["ior"]!.value = material.ior;
      u["refractionRatio"]!.value = material.refractionRatio;
    }

    if (material.lightMap) {
      u["lightMap"]!.value = material.lightMap;
      u["lightMapIntensity"]!.value = material.lightMapIntensity;

      refreshTransformUniform(material.lightMap, u["lightMapTransform"]!);
    }

    if (material.aoMap) {
      u["aoMap"]!.value = material.aoMap;
      u["aoMapIntensity"]!.value = material.aoMapIntensity;

      refreshTransformUniform(material.aoMap, u["aoMapTransform"]!);
    }
  }

  function refreshUniformsSprites(uniforms: MaterialUniforms, material: Any): void {
    const u = uniforms as Record<string, { value: Any }>;

    u["diffuse"]!.value.copy(material.color);
    u["opacity"]!.value = material.opacity;
    u["rotation"]!.value = material.rotation;

    if (material.map) {
      u["map"]!.value = material.map;

      refreshTransformUniform(material.map, u["mapTransform"]!);
    }

    if (material.alphaMap) {
      u["alphaMap"]!.value = material.alphaMap;

      refreshTransformUniform(material.alphaMap, u["alphaMapTransform"]!);
    }

    if (material.alphaTest > 0) {
      u["alphaTest"]!.value = material.alphaTest;
    }
  }

  function refreshUniformsToon(uniforms: MaterialUniforms, material: Any): void {
    if (material.gradientMap) {
      uniforms["gradientMap"]!.value = material.gradientMap;
    }
  }

  function refreshUniformsStandard(uniforms: MaterialUniforms, material: Any): void {
    const u = uniforms as Record<string, { value: Any }>;

    u["metalness"]!.value = material.metalness;

    if (material.metalnessMap) {
      u["metalnessMap"]!.value = material.metalnessMap;

      refreshTransformUniform(material.metalnessMap, u["metalnessMapTransform"]!);
    }

    u["roughness"]!.value = material.roughness;

    if (material.roughnessMap) {
      u["roughnessMap"]!.value = material.roughnessMap;

      refreshTransformUniform(material.roughnessMap, u["roughnessMapTransform"]!);
    }

    if (material.envMap) {
      //uniforms.envMap.value = material.envMap; // part of uniforms common

      u["envMapIntensity"]!.value = material.envMapIntensity;
    }
  }

  function refreshUniformsDistance(uniforms: MaterialUniforms, material: Any): void {
    const u = uniforms as Record<string, { value: Any }>;
    const light = properties.get(material).light;

    u["referencePosition"]!.value.setFromMatrixPosition(light.matrixWorld);
    u["nearDistance"]!.value = light.shadow.camera.near;
    u["farDistance"]!.value = light.shadow.camera.far;
  }

  return {
    refreshFogUniforms: refreshFogUniforms,
    refreshMaterialUniforms: refreshMaterialUniforms,
  };
}
