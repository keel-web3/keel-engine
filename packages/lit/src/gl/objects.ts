// Ported from Three.js r180's renderers/webgl/WebGLObjects.js (MIT, see
// packages/lit/NOTICE): an object's buffers brought up to date once a frame,
// an Instances' matrix and colour buffers with them.
//
// Dropped, as keel/lit has no SkinnedMesh: r180 updated a skinned mesh's
// skeleton once a frame here.

import type { EmitterEvent, Listener } from "../core/Emitter.ts";
import type { Attributes, AttributesAttribute } from "./attributes.ts";
import type { Geometries, GeometriesGeometry } from "./geometries.ts";
import type { Info } from "./info.ts";

/** What objects read of an object (keel/lit's Mesh, Instances and Billboard fit). */
export interface ObjectsObject<G extends GeometriesGeometry = GeometriesGeometry> {
  geometry: G;
  readonly isInstancedMesh?: boolean;
  instanceMatrix?: AttributesAttribute;
  instanceColor?: AttributesAttribute | null;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  hasEventListener(type: string, listener: Listener): boolean;
}

/** r180's WebGLObjects. */
export interface Objects {
  update<G extends GeometriesGeometry>(object: ObjectsObject<G>): G;
  dispose(): void;
}

export function createObjects(gl: WebGL2RenderingContext, geometries: Geometries, attributes: Attributes, info: Pick<Info, "render">): Objects {
  let updateMap = new WeakMap<object, number>();

  function update<G extends GeometriesGeometry>(object: ObjectsObject<G>): G {
    const frame = info.render.frame;

    const geometry = object.geometry;
    const buffergeometry = geometries.get(object, geometry);

    // Update once per frame

    if (updateMap.get(buffergeometry) !== frame) {
      geometries.update(buffergeometry);

      updateMap.set(buffergeometry, frame);
    }

    if (object.isInstancedMesh) {
      if (object.hasEventListener("dispose", onInstancedMeshDispose) === false) {
        object.addEventListener("dispose", onInstancedMeshDispose);
      }

      if (updateMap.get(object) !== frame) {
        attributes.update(object.instanceMatrix!, gl.ARRAY_BUFFER);

        if (object.instanceColor !== null) {
          attributes.update(object.instanceColor!, gl.ARRAY_BUFFER);
        }

        updateMap.set(object, frame);
      }
    }

    // (r180: a SkinnedMesh's skeleton updated once a frame)

    return buffergeometry;
  }

  function dispose(): void {
    updateMap = new WeakMap();
  }

  function onInstancedMeshDispose(event: EmitterEvent): void {
    const instancedMesh = event.target as ObjectsObject;

    instancedMesh.removeEventListener("dispose", onInstancedMeshDispose);

    attributes.remove(instancedMesh.instanceMatrix!);

    if (instancedMesh.instanceColor !== null) attributes.remove(instancedMesh.instanceColor!);
  }

  return {
    update: update,
    dispose: dispose,
  };
}
