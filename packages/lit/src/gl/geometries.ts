// Ported from Three.js r180's renderers/webgl/WebGLGeometries.js (MIT, see
// packages/lit/NOTICE): the geometries the renderer has seen, their buffers
// updated and, on dispose, released (with their vertex array objects).
//
// Dropped, as keel/lit has no InstancedBufferGeometry: r180 deleted such a
// geometry's _maxInstanceCount on dispose.

import { Attribute } from "../core/Attribute.ts";
import type { EmitterEvent, Listener } from "../core/Emitter.ts";
import type { Attributes, AttributesAttribute } from "./attributes.ts";
import type { BindingStates } from "./binding-states.ts";
import type { Info } from "./info.ts";

/** What geometries read of a geometry (keel/lit's Geometry fits). */
export interface GeometriesGeometry {
  readonly id: number;
  index: (AttributesAttribute & { array: ArrayLike<number> }) | null;
  attributes: Record<string, AttributesAttribute>;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

/** r180's WebGLGeometries. */
export interface Geometries {
  get<G extends GeometriesGeometry>(object: unknown, geometry: G): G;
  update(geometry: GeometriesGeometry): void;
  getWireframeAttribute(geometry: GeometriesGeometry): Attribute | undefined;
}

// (r180's utils.arrayNeedsUint32)
function arrayNeedsUint32(array: ArrayLike<number>): boolean {
  // assumes larger values usually on last

  for (let i = array.length - 1; i >= 0; --i) {
    if (array[i]! >= 65535) return true; // account for PRIMITIVE_RESTART_FIXED_INDEX, #24565
  }

  return false;
}

export function createGeometries(gl: WebGL2RenderingContext, attributes: Attributes, info: Pick<Info, "memory">, bindingStates: Pick<BindingStates, "releaseStatesOfGeometry">): Geometries {
  const geometries: Record<number, boolean> = {};
  const wireframeAttributes = new WeakMap<GeometriesGeometry, Attribute>();

  function onGeometryDispose(event: EmitterEvent): void {
    const geometry = event.target as GeometriesGeometry;

    if (geometry.index !== null) {
      attributes.remove(geometry.index);
    }

    for (const name in geometry.attributes) {
      attributes.remove(geometry.attributes[name]!);
    }

    geometry.removeEventListener("dispose", onGeometryDispose);

    delete geometries[geometry.id];

    const attribute = wireframeAttributes.get(geometry);

    if (attribute) {
      attributes.remove(attribute);
      wireframeAttributes.delete(geometry);
    }

    bindingStates.releaseStatesOfGeometry(geometry);

    // (r180: an InstancedBufferGeometry's _maxInstanceCount deleted)

    //

    info.memory.geometries--;
  }

  function get<G extends GeometriesGeometry>(object: unknown, geometry: G): G {
    void object;

    if (geometries[geometry.id] === true) return geometry;

    geometry.addEventListener("dispose", onGeometryDispose);

    geometries[geometry.id] = true;

    info.memory.geometries++;

    return geometry;
  }

  function update(geometry: GeometriesGeometry): void {
    const geometryAttributes = geometry.attributes;

    // Updating index buffer in VAO now. See WebGLBindingStates.

    for (const name in geometryAttributes) {
      attributes.update(geometryAttributes[name]!, gl.ARRAY_BUFFER);
    }
  }

  function updateWireframeAttribute(geometry: GeometriesGeometry): void {
    const indices: number[] = [];

    const geometryIndex = geometry.index;
    const geometryPosition = geometry.attributes.position as (AttributesAttribute & { array: ArrayLike<number> }) | undefined;
    let version = 0;

    if (geometryIndex !== null) {
      const array = geometryIndex.array;
      version = geometryIndex.version;

      for (let i = 0, l = array.length; i < l; i += 3) {
        const a = array[i + 0]!;
        const b = array[i + 1]!;
        const c = array[i + 2]!;

        indices.push(a, b, b, c, c, a);
      }
    } else if (geometryPosition !== undefined) {
      const array = geometryPosition.array;
      version = geometryPosition.version;

      for (let i = 0, l = (array.length / 3) - 1; i < l; i += 3) {
        const a = i + 0;
        const b = i + 1;
        const c = i + 2;

        indices.push(a, b, b, c, c, a);
      }
    } else {
      return;
    }

    const attribute = new Attribute(arrayNeedsUint32(indices) ? new Uint32Array(indices) : new Uint16Array(indices), 1);
    attribute.version = version;

    // Updating index buffer in VAO now. See WebGLBindingStates

    //

    const previousAttribute = wireframeAttributes.get(geometry);

    if (previousAttribute) attributes.remove(previousAttribute);

    //

    wireframeAttributes.set(geometry, attribute);
  }

  function getWireframeAttribute(geometry: GeometriesGeometry): Attribute | undefined {
    const currentAttribute = wireframeAttributes.get(geometry);

    if (currentAttribute) {
      const geometryIndex = geometry.index;

      if (geometryIndex !== null) {
        // if the attribute is obsolete, create a new one

        if (currentAttribute.version < geometryIndex.version) {
          updateWireframeAttribute(geometry);
        }
      }
    } else {
      updateWireframeAttribute(geometry);
    }

    return wireframeAttributes.get(geometry);
  }

  return {
    get: get,
    update: update,

    getWireframeAttribute: getWireframeAttribute,
  };
}
