// Ported from Three.js r180's renderers/webgl/WebGLCubeUVMaps.js (MIT, see
// packages/lit/NOTICE), as a pass-through: keel/lit has no environment maps,
// so nothing is ever prefiltered into a cube-UV map (r180's PMREMGenerator
// is dropped). get() hands every texture back as r180 does for one that is
// neither equirectangular nor a cube map, and refuses one that is.

import type { Texture } from "../texture/Texture.ts";

/** r180's WebGLCubeUVMaps. */
export interface CubeUVMaps {
  get<T extends Texture | null | undefined>(texture: T): T;
  dispose(): void;
}

export function createCubeUVMaps(_renderer: unknown): CubeUVMaps {
  function get<T extends Texture | null | undefined>(texture: T): T {
    if (texture && texture.isTexture) {
      const mapping = texture.mapping;

      const isEquirectMap = (mapping === "equirect-reflection" || mapping === "equirect-refraction");
      const isCubeMap = (mapping === "cube-reflection" || mapping === "cube-refraction");

      if (isEquirectMap || isCubeMap) {
        throw new Error("keel/lit: environment maps (PMREM) are not supported");
      }
    }

    return texture;
  }

  function dispose(): void {
    // (nothing held)
  }

  return {
    get: get,
    dispose: dispose,
  };
}
