// Ported from Three.js r180's renderers/webgl/WebGLProperties.js (MIT, see
// packages/lit/NOTICE): the renderer's per-object bookkeeping.

/** r180's WebGLProperties: a bag of renderer fields per object (r180's `__webgl*` names). */
export interface Properties {
  has(object: object): boolean;
  get(object: object): any;
  remove(object: object): void;
  update(object: object, key: string, value: unknown): void;
  dispose(): void;
}

export function createProperties(): Properties {
  let properties = new WeakMap<object, Record<string, unknown>>();

  function has(object: object): boolean {
    return properties.has(object);
  }

  function get(object: object): Record<string, unknown> {
    let map = properties.get(object);

    if (map === undefined) {
      map = {};
      properties.set(object, map);
    }

    return map;
  }

  function remove(object: object): void {
    properties.delete(object);
  }

  function update(object: object, key: string, value: unknown): void {
    properties.get(object)![key] = value;
  }

  function dispose(): void {
    properties = new WeakMap();
  }

  return {
    has: has,
    get: get,
    remove: remove,
    update: update,
    dispose: dispose,
  };
}
