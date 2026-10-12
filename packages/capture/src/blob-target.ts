/** Immutable bounded writes; final assembly joins Blob references, not a movie-sized ArrayBuffer. */
export function createBlobTarget(type = 'video/mp4') {
  type Part = { start: number; end: number; blob: Blob };
  let parts: Part[] = [], length = 0;
  return {
    write(data: Uint8Array<ArrayBuffer>, position: number) {
      if (!Number.isSafeInteger(position) || position < 0) throw new RangeError('Invalid media write position');
      if (!data.length) return;
      const end = position + data.length;
      if (!Number.isSafeInteger(end)) throw new RangeError('Media length overflow');
      const part = { start: position, end, blob: new Blob([data]) };
      if (position >= length) {
        if (position > length) parts.push({ start: length, end: position, blob: new Blob([new Uint8Array(position - length)]) });
        parts.push(part); length = end; return;
      }
      const next: Part[] = [];
      let inserted = false;
      for (const p of parts) {
        if (p.end <= position) { next.push(p); continue; }
        if (p.start >= end) { if (!inserted) { next.push(part); inserted = true; } next.push(p); continue; }
        if (p.start < position) next.push({ start: p.start, end: position, blob: p.blob.slice(0, position - p.start) });
        if (!inserted) { next.push(part); inserted = true; }
        if (p.end > end) next.push({ start: end, end: p.end, blob: p.blob.slice(end - p.start) });
      }
      if (!inserted) next.push(part);
      parts = next; length = Math.max(length, end);
    },
    finish() { return new Blob(parts.map(p => p.blob), { type }); },
    clear() { parts = []; length = 0; },
    get byteLength() { return length; },
    get parts() { return parts.length; },
  };
}
