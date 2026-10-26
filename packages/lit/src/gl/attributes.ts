// Ported from Three.js r180's renderers/webgl/WebGLAttributes.js (MIT, see
// packages/lit/NOTICE): one GL buffer per attribute, uploaded whole on first
// use and then by its update ranges (merged as r180 merges them) whenever its
// version moves.
//
// Dropped, as keel/lit's geometry has none of them: interleaved attributes
// (r180 read an InterleavedBufferAttribute's .data buffer in get/remove/update),
// GLBufferAttribute (r180 cached its external buffer as is), and half floats
// (r180 typed Float16Array and Float16BufferAttribute arrays as HALF_FLOAT).

import { USAGE } from "../constants.ts";
import type { Usage } from "../constants.ts";
import type { UpdateRange } from "../core/Attribute.ts";

/** What attributes read of an attribute (keel/lit's Attribute and InstanceAttribute fit). */
export interface AttributesAttribute {
  array: ArrayBufferView & ArrayLike<number> & { readonly BYTES_PER_ELEMENT: number };
  usage: Usage;
  updateRanges: UpdateRange[];
  version: number;
  onUploadCallback(): void;
  clearUpdateRanges(): void;
}

/** One attribute's GL buffer. */
export interface AttributeBuffer {
  buffer: WebGLBuffer;
  type: number;
  bytesPerElement: number;
  version: number;
  size: number;
}

/** r180's WebGLAttributes. */
export interface Attributes {
  get(attribute: AttributesAttribute): AttributeBuffer | undefined;
  remove(attribute: AttributesAttribute): void;
  update(attribute: AttributesAttribute, bufferType: number): void;
}

export function createAttributes(gl: WebGL2RenderingContext): Attributes {
  const buffers = new WeakMap<AttributesAttribute, AttributeBuffer>();

  function createBuffer(attribute: AttributesAttribute, bufferType: number): AttributeBuffer {
    const array = attribute.array;
    const usage = attribute.usage;
    const size = array.byteLength;

    const buffer = gl.createBuffer();

    gl.bindBuffer(bufferType, buffer);
    gl.bufferData(bufferType, array, USAGE[usage]);

    attribute.onUploadCallback();

    let type: number;

    if (array instanceof Float32Array) {
      type = gl.FLOAT;

      // (r180: Float16Array -> gl.HALF_FLOAT)
    } else if (array instanceof Uint16Array) {
      // (r180: a Float16BufferAttribute's Uint16Array -> gl.HALF_FLOAT)
      type = gl.UNSIGNED_SHORT;
    } else if (array instanceof Int16Array) {
      type = gl.SHORT;
    } else if (array instanceof Uint32Array) {
      type = gl.UNSIGNED_INT;
    } else if (array instanceof Int32Array) {
      type = gl.INT;
    } else if (array instanceof Int8Array) {
      type = gl.BYTE;
    } else if (array instanceof Uint8Array) {
      type = gl.UNSIGNED_BYTE;
    } else if (array instanceof Uint8ClampedArray) {
      type = gl.UNSIGNED_BYTE;
    } else {
      throw new Error("keel/lit Attributes: Unsupported buffer data format: " + String(array));
    }

    return {
      buffer: buffer,
      type: type,
      bytesPerElement: array.BYTES_PER_ELEMENT,
      version: attribute.version,
      size: size,
    };
  }

  function updateBuffer(buffer: WebGLBuffer, attribute: AttributesAttribute, bufferType: number): void {
    const array = attribute.array;
    const updateRanges = attribute.updateRanges;

    gl.bindBuffer(bufferType, buffer);

    if (updateRanges.length === 0) {
      // Not using update ranges
      gl.bufferSubData(bufferType, 0, array);
    } else {
      // Before applying update ranges, we merge any adjacent / overlapping
      // ranges to reduce load on `gl.bufferSubData`. Empirically, this has led
      // to performance improvements for applications which make heavy use of
      // update ranges. Likely due to GPU command overhead.
      //
      // Note that to reduce garbage collection between frames, we merge the
      // update ranges in-place. This is safe because this method will clear the
      // update ranges once updated.

      updateRanges.sort((a, b) => a.start - b.start);

      // To merge the update ranges in-place, we work from left to right in the
      // existing updateRanges array, merging ranges. This may result in a final
      // array which is smaller than the original. This index tracks the last
      // index representing a merged range, any data after this index can be
      // trimmed once the merge algorithm is completed.
      let mergeIndex = 0;

      for (let i = 1; i < updateRanges.length; i++) {
        const previousRange = updateRanges[mergeIndex]!;
        const range = updateRanges[i]!;

        // We add one here to merge adjacent ranges. This is safe because ranges
        // operate over positive integers.
        if (range.start <= previousRange.start + previousRange.count + 1) {
          previousRange.count = Math.max(
            previousRange.count,
            range.start + range.count - previousRange.start,
          );
        } else {
          ++mergeIndex;
          updateRanges[mergeIndex] = range;
        }
      }

      // Trim the array to only contain the merged ranges.
      updateRanges.length = mergeIndex + 1;

      for (let i = 0, l = updateRanges.length; i < l; i++) {
        const range = updateRanges[i]!;

        gl.bufferSubData(bufferType, range.start * array.BYTES_PER_ELEMENT,
          array, range.start, range.count);
      }

      attribute.clearUpdateRanges();
    }

    attribute.onUploadCallback();
  }

  //

  function get(attribute: AttributesAttribute): AttributeBuffer | undefined {
    // (r180: an interleaved attribute's buffer is its InterleavedBuffer's)
    return buffers.get(attribute);
  }

  function remove(attribute: AttributesAttribute): void {
    // (r180: an interleaved attribute's buffer is its InterleavedBuffer's)
    const data = buffers.get(attribute);

    if (data) {
      gl.deleteBuffer(data.buffer);

      buffers.delete(attribute);
    }
  }

  function update(attribute: AttributesAttribute, bufferType: number): void {
    // (r180: an interleaved attribute's buffer is its InterleavedBuffer's)
    // (r180: a GLBufferAttribute's external buffer is cached as is, and nothing uploaded)

    const data = buffers.get(attribute);

    if (data === undefined) {
      buffers.set(attribute, createBuffer(attribute, bufferType));
    } else if (data.version < attribute.version) {
      if (data.size !== attribute.array.byteLength) {
        throw new Error("keel/lit Attributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");
      }

      updateBuffer(data.buffer, attribute, bufferType);

      data.version = attribute.version;
    }
  }

  return {
    get: get,
    remove: remove,
    update: update,
  };
}
