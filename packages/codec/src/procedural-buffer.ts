/** Exact byte-derived repeated and affine Float32 rows. No model templates or tolerance. */
export function encodeFloat32Runs(source: Uint8Array, stride: number): Uint8Array | null {
  if (!Number.isInteger(stride) || stride < 4 || stride > 4096 || stride % 4 || source.length % stride) throw Error('Invalid procedural stride');
  const rows = source.length / stride;
  if (rows < 2 || rows > 262144) return null;
  const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const scratch = new DataView(new ArrayBuffer(4));
  const steps = new Uint8Array(stride), stepView = new DataView(steps.buffer);
  type Run = { type: number; start: number; count: number; steps?: Uint8Array };
  const runs: Run[] = [];
  const infer = (start: number): Run | null => {
    let count = 1;
    same: while (start + count < rows) {
      for (let k = 0; k < stride; k++) if (source[start * stride + k] !== source[(start + count) * stride + k]) break same;
      count++;
    }
    if (count >= 2) return { type: 1, start, count };
    if (start + 4 > rows) return null;
    for (let k = 0; k < stride; k += 4) {
      const first = sourceView.getFloat32(start * stride + k, true);
      const second = sourceView.getFloat32((start + 1) * stride + k, true);
      const step = Math.fround(second - first);
      if (!Number.isFinite(first) || !Number.isFinite(step)) return null;
      stepView.setFloat32(k, step, true);
    }
    count = 1;
    affine: while (start + count < rows) {
      for (let k = 0; k < stride; k += 4) {
        const first = sourceView.getFloat32(start * stride + k, true), step = stepView.getFloat32(k, true);
        scratch.setFloat32(0, Math.fround(first + step * count), true);
        if (scratch.getUint32(0, true) !== sourceView.getUint32((start + count) * stride + k, true)) break affine;
      }
      count++;
    }
    return count >= 4 ? { type: 2, start, count, steps: steps.slice() } : null;
  };
  let row = 0, literal = -1, inferred = false;
  while (row < rows) {
    const run = infer(row);
    if (run) { if (literal >= 0) runs.push({ type: 0, start: literal, count: row - literal }); literal = -1; runs.push(run); row += run.count; inferred = true; }
    else { if (literal < 0) literal = row; row++; }
  }
  if (literal >= 0) runs.push({ type: 0, start: literal, count: rows - literal });
  if (!inferred) return null;
  const length = runs.reduce((n, run) => n + 5 + (run.type === 0 ? run.count * stride : run.type === 1 ? stride : 2 * stride), 0);
  const output = new Uint8Array(length), view = new DataView(output.buffer); let cursor = 0;
  for (const run of runs) {
    output[cursor++] = run.type; view.setUint32(cursor, run.count, true); cursor += 4;
    const literalLength = run.type === 0 ? run.count * stride : stride;
    output.set(source.subarray(run.start * stride, run.start * stride + literalLength), cursor); cursor += literalLength;
    if (run.type === 2) { output.set(run.steps!, cursor); cursor += stride; }
  }
  return output;
}
export function decodeFloat32Runs(data: Uint8Array, length: number, stride: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0 || length > 536870912 || !Number.isInteger(stride) || stride < 4 || stride > 4096 || stride % 4 || length % stride) throw Error('Invalid procedural extent');
  const out = new Uint8Array(length), input = new DataView(data.buffer, data.byteOffset, data.byteLength), output = new DataView(out.buffer);
  let cursor = 0, row = 0; const rows = length / stride;
  while (cursor < data.length) {
    if (cursor + 5 > data.length) throw new Error('Truncated procedural run');
    const type = data[cursor++]!, count = input.getUint32(cursor, true); cursor += 4;
    if (!count || count > rows - row || type > 2 || (type === 1 && count < 2) || (type === 2 && count < 4)) throw new Error('Invalid procedural run');
    const stored = type === 0 ? count * stride : type === 1 ? stride : 2 * stride;
    if (cursor + stored > data.length) throw new Error('Truncated procedural data');
    if (type === 0) out.set(data.subarray(cursor, cursor + stored), row * stride);
    else if (type === 1) {
      const start = row * stride;
      out.set(data.subarray(cursor, cursor + stride), start);
      for (let copied = 1; copied < count; copied *= 2) out.copyWithin(start + copied * stride, start, start + Math.min(copied, count - copied) * stride);
    }
    else {
      for (let k = 0; k < stride; k += 4) {
        const first = input.getFloat32(cursor + k, true), step = input.getFloat32(cursor + stride + k, true);
        if (!Number.isFinite(first) || !Number.isFinite(step)) throw new Error('Invalid affine seed or step');
        // The seed is copied bit-for-bit, including signed zero. Later rows execute arithmetic.
        output.setUint32(row * stride + k, input.getUint32(cursor + k, true), true);
        for (let i = 1; i < count; i++) output.setFloat32((row + i) * stride + k, Math.fround(first + step * i), true);
      }
    }
    row += count; cursor += stored;
  }
  if (row !== rows) throw new Error('Incomplete procedural rows');
  return out;
}
