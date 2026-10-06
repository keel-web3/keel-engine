/** Small deterministic 32-bit streams. Core's fixed-slot token RNG remains a separate contract. */
export interface RandomStream { (): number; state(): number; restore(state: number): void }
export function createMulberry32(seed: number): () => number;
export function createMulberry32(seed: number, checkpointed: true): RandomStream;
export function createMulberry32(seed: number, checkpointed = false): () => number {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (checkpointed) {
    const stream = next as RandomStream;
    stream.state = () => a;
    stream.restore = state => { a = state >>> 0; };
  }
  return next;
}
