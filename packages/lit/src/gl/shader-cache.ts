// Ported from Three.js r180's renderers/webgl/WebGLShaderCache.js (MIT, see
// packages/lit/NOTICE). A CustomMaterial's shader texts, each given a stable id
// (the program cache key names a custom program by these ids). The id counter
// is module-wide, as r180's `_id` is.

let _id = 0;

/** One shader text and how many materials use it (r180's WebGLShaderStage). */
export interface ShaderStage {
  readonly id: number;
  readonly code: string;
  usedTimes: number;
}

/** The two texts a custom material compiles. */
export interface ShaderCacheMaterial {
  readonly vertexShader: string;
  readonly fragmentShader: string;
}

export interface ShaderCache {
  readonly shaderCache: Map<string, ShaderStage>;
  readonly materialCache: Map<ShaderCacheMaterial, Set<ShaderStage>>;
  update(material: ShaderCacheMaterial): ShaderCache;
  remove(material: ShaderCacheMaterial): ShaderCache;
  getVertexShaderID(material: ShaderCacheMaterial): number;
  getFragmentShaderID(material: ShaderCacheMaterial): number;
  dispose(): void;
  _getShaderCacheForMaterial(material: ShaderCacheMaterial): Set<ShaderStage>;
  _getShaderStage(code: string): ShaderStage;
}

function createShaderStage(code: string): ShaderStage {
  return { id: _id++, code, usedTimes: 0 };
}

/** r180's WebGLShaderCache. */
export function createShaderCache(): ShaderCache {
  const shaderCache = new Map<string, ShaderStage>();
  const materialCache = new Map<ShaderCacheMaterial, Set<ShaderStage>>();

  const self: ShaderCache = {
    shaderCache,
    materialCache,

    update(material) {
      const vertexShader = material.vertexShader;
      const fragmentShader = material.fragmentShader;

      const vertexShaderStage = self._getShaderStage(vertexShader);
      const fragmentShaderStage = self._getShaderStage(fragmentShader);

      const materialShaders = self._getShaderCacheForMaterial(material);

      if (materialShaders.has(vertexShaderStage) === false) {
        materialShaders.add(vertexShaderStage);
        vertexShaderStage.usedTimes++;
      }

      if (materialShaders.has(fragmentShaderStage) === false) {
        materialShaders.add(fragmentShaderStage);
        fragmentShaderStage.usedTimes++;
      }

      return self;
    },

    remove(material) {
      const materialShaders = materialCache.get(material);

      // (r180 iterates `undefined` here and throws; a material never compiled has nothing to free)
      if (materialShaders !== undefined) {
        for (const shaderStage of materialShaders) {
          shaderStage.usedTimes--;

          if (shaderStage.usedTimes === 0) shaderCache.delete(shaderStage.code);
        }
      }

      materialCache.delete(material);

      return self;
    },

    getVertexShaderID(material) {
      return self._getShaderStage(material.vertexShader).id;
    },

    getFragmentShaderID(material) {
      return self._getShaderStage(material.fragmentShader).id;
    },

    dispose() {
      shaderCache.clear();
      materialCache.clear();
    },

    _getShaderCacheForMaterial(material) {
      const cache = materialCache;
      let set = cache.get(material);

      if (set === undefined) {
        set = new Set();
        cache.set(material, set);
      }

      return set;
    },

    _getShaderStage(code) {
      const cache = shaderCache;
      let stage = cache.get(code);

      if (stage === undefined) {
        stage = createShaderStage(code);
        cache.set(code, stage);
      }

      return stage;
    },
  };

  return self;
}
