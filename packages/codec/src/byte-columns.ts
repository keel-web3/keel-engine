// Lossless byte-layout transform for interleaved mesh, tile and record buffers.
// The schema supplies stride and length; no runtime compressor or dictionary.
const MAX_BYTES = 8 * 1024 * 1024;
function rowsOf(bytes: Uint8Array, stride: number): number {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(stride) || stride < 1 || stride > 4096 ||
      bytes.length > MAX_BYTES || bytes.length % stride) throw new RangeError('Invalid byte-column buffer or stride');
  return bytes.length / stride;
}

/** Store byte columns contiguously with modulo-256 deltas. Signed mode zigzags small negative steps. */
export function encodeByteColumns(bytes: Uint8Array, stride: number, signed = false): Uint8Array {
  const rows = rowsOf(bytes, stride), out = new Uint8Array(bytes.length);
  for (let col = 0; col < stride; col++) {
    let previous = 0;
    for (let row = 0; row < rows; row++) {
      const value = bytes[row * stride + col]!;
      const delta = (value - previous + 128 & 255) - 128;
      out[col * rows + row] = signed ? delta << 1 ^ delta >> 7 : delta;
      previous = value;
    }
  }
  return out;
}

/** Restore the exact original bytes, including integer sign, endian order and float bits. */
export function decodeByteColumns(bytes: Uint8Array, stride: number, signed = false): Uint8Array {
  const rows = rowsOf(bytes, stride), out = new Uint8Array(bytes.length);
  for (let col = 0; col < stride; col++) {
    let value = 0;
    for (let row = 0; row < rows; row++) {
      const delta = bytes[col * rows + row]!;
      value = (value + (signed ? delta >>> 1 ^ -(delta & 1) : delta)) & 255;
      out[row * stride + col] = value;
    }
  }
  return out;
}
