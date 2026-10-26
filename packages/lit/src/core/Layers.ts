// Ported from Three.js r180's core/Layers.js (MIT, see packages/lit/NOTICE).

/** Which of 32 layers a node is on (a camera sees a node when they share one). */
export class Layers {
  mask: number;

  constructor() {
    this.mask = 1 | 0;
  }

  set(layer: number): void {
    this.mask = ((1 << layer) | 0) >>> 0;
  }

  enable(layer: number): void {
    this.mask |= (1 << layer) | 0;
  }

  enableAll(): void {
    this.mask = 0xffffffff | 0;
  }

  toggle(layer: number): void {
    this.mask ^= (1 << layer) | 0;
  }

  disable(layer: number): void {
    this.mask &= ~((1 << layer) | 0);
  }

  disableAll(): void {
    this.mask = 0;
  }

  test(layers: Layers): boolean {
    return (this.mask & layers.mask) !== 0;
  }

  isEnabled(layer: number): boolean {
    return (this.mask & ((1 << layer) | 0)) !== 0;
  }
}
