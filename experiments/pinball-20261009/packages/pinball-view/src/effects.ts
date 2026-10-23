import type { PinballViewEvent } from "./types.ts";

export interface HitPosition {
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly kind: "emerald" | "brass" | "warning";
}

export interface HitParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  totalLife: number;
  size: number;
  layer: number;
  kind: HitPosition["kind"];
}

export interface HitPulse extends HitPosition {
  life: number;
  totalLife: number;
  readonly colliderId: string | undefined;
}

/** Stable cosmetic entropy, deliberately independent of the physics RNG. */
export function hashSkin(value: string | number): number {
  const source = String(value);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function skinRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_QUEUED_EVENTS = 64;
const MAX_REMEMBERED_EVENTS = 512;
const MAX_PULSES = 32;

/**
 * Bounded presentation state. Dedupe remembers the most recent 512 event IDs;
 * simulation replay seeks should call clear() before delivering a new event era.
 */
export class PinballEffects {
  readonly particles: HitParticle[] = [];
  readonly pulses: HitPulse[] = [];
  readonly #queue: PinballViewEvent[] = [];
  readonly #seen = new Set<string>();
  readonly #ids: string[] = [];
  readonly #capacity: number;
  readonly #reducedMotion: boolean;
  readonly #spare: HitParticle[] = [];
  #cursor = 0;

  constructor(maxParticles = 96, reducedMotion = false) {
    this.#capacity = Math.min(256, Math.max(0, Math.floor(Number.isFinite(maxParticles) ? maxParticles : 96)));
    this.#reducedMotion = reducedMotion;
  }

  ingest(events: readonly PinballViewEvent[]): void {
    for (const event of events) {
      if (this.#seen.has(event.id)) continue;
      this.#seen.add(event.id);
      if (this.#ids.length < MAX_REMEMBERED_EVENTS) this.#ids.push(event.id);
      else {
        const old = this.#ids[this.#cursor];
        if (old !== undefined) this.#seen.delete(old);
        this.#ids[this.#cursor] = event.id;
        this.#cursor = (this.#cursor + 1) % MAX_REMEMBERED_EVENTS;
      }
      if (this.#queue.length < MAX_QUEUED_EVENTS) this.#queue.push(event);
    }
  }

  advance(deltaMs: number, locate: (event: PinballViewEvent) => HitPosition | undefined, seed: number): void {
    const dt = Math.min(50, Math.max(0, deltaMs)) / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      if (particle === undefined) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        const last = this.particles.pop();
        if (i < this.particles.length && last !== undefined) this.particles[i] = last;
        this.#spare.push(particle);
      } else {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= Math.exp(-5 * dt);
        particle.vy = particle.vy * Math.exp(-5 * dt) + 18 * dt;
      }
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i];
      if (pulse === undefined) continue;
      pulse.life -= dt;
      if (pulse.life <= 0) this.pulses.splice(i, 1);
    }
    for (const event of this.#queue) {
      const type = event.type.toLowerCase();
      if (!/(bumper|target|rail|segment|flipper|hit|lock|jackpot|launch|ability|guardian-strike)/.test(type)) continue;
      const position = locate(event);
      if (position === undefined) continue;
      const pulseLife = this.#reducedMotion ? 0.08 : 0.10;
      if (this.pulses.length >= MAX_PULSES) this.pulses.shift();
      this.pulses.push({ ...position, life: pulseLife, totalLife: pulseLife, colliderId: event.colliderId });
      if (this.#reducedMotion || this.#capacity === 0) continue;
      const random = skinRandom(hashSkin(event.id) ^ seed);
      const amount = /ability|guardian-strike/.test(type) ? 12 : /bumper|target|lock|jackpot/.test(type) ? 5 : 3;
      for (let i = 0; i < amount && this.particles.length < this.#capacity; i++) {
        const angle = random() * Math.PI * 2;
        const speed = 16 + random() * 36;
        const life = 0.12 + random() * 0.18;
        const values = {
          x: position.x, y: position.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life, totalLife: life, size: 0.6 + random() * 0.8, layer: position.layer, kind: position.kind,
        };
        const recycled = this.#spare.pop();
        this.particles.push(recycled === undefined ? values : Object.assign(recycled, values));
      }
    }
    this.#queue.length = 0;
  }

  get queuedEvents(): number { return this.#queue.length; }
  get rememberedEvents(): number { return this.#seen.size; }

  clear(): void {
    this.particles.length = 0;
    this.#spare.length = 0;
    this.pulses.length = 0;
    this.#queue.length = 0;
    this.#ids.length = 0;
    this.#seen.clear();
    this.#cursor = 0;
  }
}
