// Ported from Three.js r180's renderers/webgl/WebGLBindingStates.js (MIT, see
// packages/lit/NOTICE): one vertex array object per geometry, program and
// wireframe flag, its attribute pointers set up when what it binds changes,
// instanced attributes with their divisors.
//
// Dropped, as keel/lit's geometry has none: interleaved attributes (r180 also
// compared an attribute's InterleavedBuffer `.data` in needsUpdate / saveCache,
// and pointed into it with its stride and offset, with InstancedInterleavedBuffer
// divisors, in setupVertexAttributes).

import type { AttributeBuffer, Attributes, AttributesAttribute } from "./attributes.ts";

/** What binding states read of an attribute (keel/lit's Attribute and InstanceAttribute fit). */
export interface BindingAttribute extends AttributesAttribute {
  normalized: boolean;
  itemSize: number;
  count: number;
  gpuType: string;
  readonly isInstancedBufferAttribute?: boolean;
  meshPerAttribute?: number;
}

/** A linked program's attribute (r180's WebGLProgram.getAttributes()). */
export interface ProgramAttribute {
  type: number;
  location: number;
  locationSize: number;
}

/** What binding states read of a program (r180's WebGLProgram). */
export interface BindingProgram {
  id: number;
  getAttributes(): Record<string, ProgramAttribute>;
}

/** What binding states read of a material. */
export interface BindingMaterial {
  readonly isMaterial: boolean;
  wireframe?: boolean;
  defaultAttributeValues?: Record<string, ArrayLike<number>>;
}

/** What binding states read of an object (an Instances adds its instance buffers). */
export interface BindingObject {
  readonly isObject3D: boolean;
  readonly isInstancedMesh?: boolean;
  instanceMatrix?: BindingAttribute;
  instanceColor?: BindingAttribute | null;
}

/** What binding states read of a geometry (and the instance count it may note on it, as r180 does). */
export interface BindingGeometry {
  readonly id: number;
  attributes: Record<string, BindingAttribute>;
  _maxInstanceCount?: number;
}

interface CachedAttribute {
  attribute: BindingAttribute | undefined;
}

interface BindingState {
  // for backward compatibility on non-VAO support browser
  geometry: null;
  program: null;
  wireframe: false;

  newAttributes: number[];
  enabledAttributes: number[];
  attributeDivisors: number[];
  object: WebGLVertexArrayObject | null;
  attributes: Record<string, CachedAttribute>;
  attributesNum?: number;
  index: AttributesAttribute | null;
}

/** r180's WebGLBindingStates. */
export interface BindingStates {
  setup(object: BindingObject, material: BindingMaterial, program: BindingProgram, geometry: BindingGeometry, index: AttributesAttribute | null): void;
  reset(): void;
  resetDefaultState(): void;
  dispose(): void;
  releaseStatesOfGeometry(geometry: { readonly id: number }): void;
  releaseStatesOfProgram(program: { id: number }): void;

  initAttributes(): void;
  enableAttribute(attribute: number): void;
  disableUnusedAttributes(): void;
}

export function createBindingStates(gl: WebGL2RenderingContext, attributes: Attributes): BindingStates {
  const maxVertexAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;

  const bindingStates: Record<number, Record<number, Record<string, BindingState>>> = {};

  const defaultState = createBindingState(null);
  let currentState = defaultState;
  let forceUpdate = false;

  function setup(object: BindingObject, material: BindingMaterial, program: BindingProgram, geometry: BindingGeometry, index: AttributesAttribute | null): void {
    let updateBuffers = false;

    const state = getBindingState(geometry, program, material);

    if (currentState !== state) {
      currentState = state;
      bindVertexArrayObject(currentState.object);
    }

    updateBuffers = needsUpdate(object, geometry, program, index);

    if (updateBuffers) saveCache(object, geometry, program, index);

    if (index !== null) {
      attributes.update(index, gl.ELEMENT_ARRAY_BUFFER);
    }

    if (updateBuffers || forceUpdate) {
      forceUpdate = false;

      setupVertexAttributes(object, material, program, geometry);

      if (index !== null) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, (attributes.get(index) as AttributeBuffer).buffer);
      }
    }
  }

  function createVertexArrayObject(): WebGLVertexArrayObject {
    return gl.createVertexArray();
  }

  function bindVertexArrayObject(vao: WebGLVertexArrayObject | null): void {
    return gl.bindVertexArray(vao);
  }

  function deleteVertexArrayObject(vao: WebGLVertexArrayObject | null): void {
    return gl.deleteVertexArray(vao);
  }

  function getBindingState(geometry: BindingGeometry, program: BindingProgram, material: BindingMaterial): BindingState {
    const wireframe = (material.wireframe === true);

    let programMap = bindingStates[geometry.id];

    if (programMap === undefined) {
      programMap = {};
      bindingStates[geometry.id] = programMap;
    }

    let stateMap = programMap[program.id];

    if (stateMap === undefined) {
      stateMap = {};
      programMap[program.id] = stateMap;
    }

    let state = stateMap[String(wireframe)];

    if (state === undefined) {
      state = createBindingState(createVertexArrayObject());
      stateMap[String(wireframe)] = state;
    }

    return state;
  }

  function createBindingState(vao: WebGLVertexArrayObject | null): BindingState {
    const newAttributes: number[] = [];
    const enabledAttributes: number[] = [];
    const attributeDivisors: number[] = [];

    for (let i = 0; i < maxVertexAttributes; i++) {
      newAttributes[i] = 0;
      enabledAttributes[i] = 0;
      attributeDivisors[i] = 0;
    }

    return {
      // for backward compatibility on non-VAO support browser
      geometry: null,
      program: null,
      wireframe: false,

      newAttributes: newAttributes,
      enabledAttributes: enabledAttributes,
      attributeDivisors: attributeDivisors,
      object: vao,
      attributes: {},
      index: null,
    };
  }

  function needsUpdate(object: BindingObject, geometry: BindingGeometry, program: BindingProgram, index: AttributesAttribute | null): boolean {
    const cachedAttributes = currentState.attributes;
    const geometryAttributes = geometry.attributes;

    let attributesNum = 0;

    const programAttributes = program.getAttributes();

    for (const name in programAttributes) {
      const programAttribute = programAttributes[name]!;

      if (programAttribute.location >= 0) {
        const cachedAttribute = cachedAttributes[name];
        let geometryAttribute = geometryAttributes[name];

        if (geometryAttribute === undefined) {
          if (name === "instanceMatrix" && object.instanceMatrix) geometryAttribute = object.instanceMatrix;
          if (name === "instanceColor" && object.instanceColor) geometryAttribute = object.instanceColor;
        }

        if (cachedAttribute === undefined) return true;

        if (cachedAttribute.attribute !== geometryAttribute) return true;

        // (r180: and an interleaved attribute whose buffer changed)

        attributesNum++;
      }
    }

    if (currentState.attributesNum !== attributesNum) return true;

    if (currentState.index !== index) return true;

    return false;
  }

  function saveCache(object: BindingObject, geometry: BindingGeometry, program: BindingProgram, index: AttributesAttribute | null): void {
    const cache: Record<string, CachedAttribute> = {};
    const attributes = geometry.attributes;
    let attributesNum = 0;

    const programAttributes = program.getAttributes();

    for (const name in programAttributes) {
      const programAttribute = programAttributes[name]!;

      if (programAttribute.location >= 0) {
        let attribute = attributes[name];

        if (attribute === undefined) {
          if (name === "instanceMatrix" && object.instanceMatrix) attribute = object.instanceMatrix;
          if (name === "instanceColor" && object.instanceColor) attribute = object.instanceColor;
        }

        const data: CachedAttribute = { attribute: undefined };
        data.attribute = attribute;

        // (r180: and an interleaved attribute's buffer, as data.data)

        cache[name] = data;

        attributesNum++;
      }
    }

    currentState.attributes = cache;
    currentState.attributesNum = attributesNum;

    currentState.index = index;
  }

  function initAttributes(): void {
    const newAttributes = currentState.newAttributes;

    for (let i = 0, il = newAttributes.length; i < il; i++) {
      newAttributes[i] = 0;
    }
  }

  function enableAttribute(attribute: number): void {
    enableAttributeAndDivisor(attribute, 0);
  }

  function enableAttributeAndDivisor(attribute: number, meshPerAttribute: number): void {
    const newAttributes = currentState.newAttributes;
    const enabledAttributes = currentState.enabledAttributes;
    const attributeDivisors = currentState.attributeDivisors;

    newAttributes[attribute] = 1;

    if (enabledAttributes[attribute] === 0) {
      gl.enableVertexAttribArray(attribute);
      enabledAttributes[attribute] = 1;
    }

    if (attributeDivisors[attribute] !== meshPerAttribute) {
      gl.vertexAttribDivisor(attribute, meshPerAttribute);
      attributeDivisors[attribute] = meshPerAttribute;
    }
  }

  function disableUnusedAttributes(): void {
    const newAttributes = currentState.newAttributes;
    const enabledAttributes = currentState.enabledAttributes;

    for (let i = 0, il = enabledAttributes.length; i < il; i++) {
      if (enabledAttributes[i] !== newAttributes[i]) {
        gl.disableVertexAttribArray(i);
        enabledAttributes[i] = 0;
      }
    }
  }

  function vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number, integer: boolean): void {
    if (integer === true) {
      gl.vertexAttribIPointer(index, size, type, stride, offset);
    } else {
      gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
    }
  }

  function setupVertexAttributes(object: BindingObject, material: BindingMaterial, program: BindingProgram, geometry: BindingGeometry): void {
    initAttributes();

    const geometryAttributes = geometry.attributes;

    const programAttributes = program.getAttributes();

    const materialDefaultAttributeValues = material.defaultAttributeValues;

    for (const name in programAttributes) {
      const programAttribute = programAttributes[name]!;

      if (programAttribute.location >= 0) {
        let geometryAttribute = geometryAttributes[name];

        if (geometryAttribute === undefined) {
          if (name === "instanceMatrix" && object.instanceMatrix) geometryAttribute = object.instanceMatrix;
          if (name === "instanceColor" && object.instanceColor) geometryAttribute = object.instanceColor;
        }

        if (geometryAttribute !== undefined) {
          const normalized = geometryAttribute.normalized;
          const size = geometryAttribute.itemSize;

          const attribute = attributes.get(geometryAttribute);

          // TODO Attribute may not be available on context restore

          if (attribute === undefined) continue;

          const buffer = attribute.buffer;
          const type = attribute.type;
          const bytesPerElement = attribute.bytesPerElement;

          // check for integer attributes

          const integer = (type === gl.INT || type === gl.UNSIGNED_INT || geometryAttribute.gpuType === "int");

          // (r180: an interleaved attribute here, pointing into its buffer by stride and offset)

          if (geometryAttribute.isInstancedBufferAttribute) {
            for (let i = 0; i < programAttribute.locationSize; i++) {
              enableAttributeAndDivisor(programAttribute.location + i, geometryAttribute.meshPerAttribute as number);
            }

            if (object.isInstancedMesh !== true && geometry._maxInstanceCount === undefined) {
              geometry._maxInstanceCount = (geometryAttribute.meshPerAttribute as number) * geometryAttribute.count;
            }
          } else {
            for (let i = 0; i < programAttribute.locationSize; i++) {
              enableAttribute(programAttribute.location + i);
            }
          }

          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

          for (let i = 0; i < programAttribute.locationSize; i++) {
            vertexAttribPointer(
              programAttribute.location + i,
              size / programAttribute.locationSize,
              type,
              normalized,
              size * bytesPerElement,
              (size / programAttribute.locationSize) * i * bytesPerElement,
              integer,
            );
          }
        } else if (materialDefaultAttributeValues !== undefined) {
          const value = materialDefaultAttributeValues[name];

          if (value !== undefined) {
            switch (value.length) {
              case 2:
                gl.vertexAttrib2fv(programAttribute.location, value as Float32List);
                break;

              case 3:
                gl.vertexAttrib3fv(programAttribute.location, value as Float32List);
                break;

              case 4:
                gl.vertexAttrib4fv(programAttribute.location, value as Float32List);
                break;

              default:
                gl.vertexAttrib1fv(programAttribute.location, value as Float32List);
            }
          }
        }
      }
    }

    disableUnusedAttributes();
  }

  function dispose(): void {
    reset();

    for (const geometryId in bindingStates) {
      const programMap = bindingStates[geometryId]!;

      for (const programId in programMap) {
        const stateMap = programMap[programId]!;

        for (const wireframe in stateMap) {
          deleteVertexArrayObject(stateMap[wireframe]!.object);

          delete stateMap[wireframe];
        }

        delete programMap[programId];
      }

      delete bindingStates[geometryId];
    }
  }

  function releaseStatesOfGeometry(geometry: { readonly id: number }): void {
    if (bindingStates[geometry.id] === undefined) return;

    const programMap = bindingStates[geometry.id]!;

    for (const programId in programMap) {
      const stateMap = programMap[programId]!;

      for (const wireframe in stateMap) {
        deleteVertexArrayObject(stateMap[wireframe]!.object);

        delete stateMap[wireframe];
      }

      delete programMap[programId];
    }

    delete bindingStates[geometry.id];
  }

  function releaseStatesOfProgram(program: { id: number }): void {
    for (const geometryId in bindingStates) {
      const programMap = bindingStates[geometryId]!;

      if (programMap[program.id] === undefined) continue;

      const stateMap = programMap[program.id]!;

      for (const wireframe in stateMap) {
        deleteVertexArrayObject(stateMap[wireframe]!.object);

        delete stateMap[wireframe];
      }

      delete programMap[program.id];
    }
  }

  function reset(): void {
    resetDefaultState();
    forceUpdate = true;

    if (currentState === defaultState) return;

    currentState = defaultState;
    bindVertexArrayObject(currentState.object);
  }

  // for backward-compatibility

  function resetDefaultState(): void {
    defaultState.geometry = null;
    defaultState.program = null;
    defaultState.wireframe = false;
  }

  return {
    setup: setup,
    reset: reset,
    resetDefaultState: resetDefaultState,
    dispose: dispose,
    releaseStatesOfGeometry: releaseStatesOfGeometry,
    releaseStatesOfProgram: releaseStatesOfProgram,

    initAttributes: initAttributes,
    enableAttribute: enableAttribute,
    disableUnusedAttributes: disableUnusedAttributes,
  };
}
