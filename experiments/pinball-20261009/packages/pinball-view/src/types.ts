/** All geometry is in canonical table units, +y downward. Angles are degrees. */
export interface PinballViewSegment {
  readonly id: string;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly layer?: number;
}

export interface PinballViewBumper {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly layer?: number;
  readonly points?: number;
}

export interface PinballViewFlipper {
  readonly id: string;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly length: number;
  readonly radius: number;
  readonly restAngle: number;
  readonly activeAngle: number;
  readonly side: "left" | "right";
  readonly layer?: number;
  readonly ownerId?: string | number;
}

/** Labels and lamps are floor decoration; they never create collision geometry. */
export interface PinballViewIndicator {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly value?: string | number;
  readonly active?: boolean;
  readonly kind?: "emerald" | "brass" | "warning";
  readonly layer?: number;
}

export interface PinballViewPresentation {
  readonly title?: string;
  readonly subtitle?: string;
  /** World-space backbox bounds; reserve this area in the authored table. */
  readonly scoreDisplay?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly indicators?: readonly PinballViewIndicator[];
}

export interface PinballViewMap {
  readonly width: number;
  readonly height: number;
  readonly ballRadius: number;
  readonly drainY?: number;
  readonly launch?: { readonly x: number; readonly y: number };
  readonly segments: readonly PinballViewSegment[];
  readonly bumpers: readonly PinballViewBumper[];
  readonly flippers: readonly PinballViewFlipper[];
  readonly presentation?: PinballViewPresentation;
  /** Increment when mutating table geometry in place; immutable maps need no key. */
  readonly viewRevision?: string | number;
}

export interface PinballViewBall {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
  readonly layer?: number;
  readonly ownerId?: string | number;
  readonly radius?: number;
  readonly vx?: number;
  readonly vy?: number;
}

export interface PinballViewFlipperFrame {
  readonly id: string;
  readonly angle: number;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly tipX: number;
  readonly tipY: number;
  readonly radius: number;
}

export interface PinballViewSnapshot {
  /** Read-only encounter presentation; the run module owns damage and timing. */
  readonly encounter?: "table" | "guardian";
  readonly bossHealth?: number;
  readonly maxBossHealth?: number;
  readonly bossPhase?: 0 | 1 | 2;
  readonly hazardWarning?: boolean;
  readonly hazardCountdown?: number;
  readonly tick: number;
  readonly balls: readonly PinballViewBall[];
  readonly flippers: readonly PinballViewFlipperFrame[];
  readonly score?: number;
  readonly ballNumber?: number;
  readonly ballsRemaining?: number;
  readonly phase?: string;
  readonly objective?: string;
  readonly multiplier?: number;
  /** Host profile's short score-row status, e.g. HP 4/6 · STAGE 2. */
  readonly statusLabel?: string;
  /** IDs of actual colliders/lamps lit by the host's canonical objective state. */
  readonly activeIndicatorIds?: readonly string[];
  readonly indicators?: readonly PinballViewIndicator[];
}

export interface PinballViewEvent {
  readonly id: string;
  readonly tick: number;
  readonly type: string;
  readonly colliderId?: string;
  readonly ballId?: string;
  readonly points?: number;
  /** If supplied by physics, use the actual contact position for sparks. */
  readonly x?: number;
  readonly y?: number;
  readonly layer?: number;
}

export interface PinballViewFrame {
  readonly timeMs: number;
  readonly deltaMs?: number;
}

export type PinballViewTheme = "nightshift" | "cyberpunk" | "vaporwave" | "gold" | "nature";
export type PinballViewStyle = "pixel" | "dither" | "arcade" | "realistic" | "cartoon";
export type PinballVisualDensity = "low" | "medium" | "high";
export interface PinballBiomeOrnament {
  readonly id: string;
  readonly kind: "leaf" | "frond" | "circuit" | "tower" | "grid" | "sun" | "obelisk" | "gem";
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** Cosmetic rotation and phase are radians (physics flipper angles are degrees). */
  readonly rotation?: number;
  readonly phase?: number;
  readonly variant?: number;
}
export interface PinballViewBiome {
  readonly schema: "keel-pinball-biome@1";
  readonly theme: PinballViewTheme;
  readonly seed: string | number;
  readonly ornaments: readonly PinballBiomeOrnament[];
  readonly palette?: {
    readonly floor: string; readonly raised: string; readonly steel: string; readonly rail: string;
    readonly ball: string; readonly accent: string; readonly brass: string; readonly warning: string;
  };
}

export interface PinballViewOptions {
  readonly skinSeed?: string | number;
  /** Ball material only; the physical ball radius and every collider stay fixed. */
  readonly finish?: "steel" | "gold" | "jade";
  readonly theme?: PinballViewTheme;
  readonly style?: PinballViewStyle;
  readonly visualDensity?: PinballVisualDensity;
  readonly biome?: PinballViewBiome;
  readonly maxLeaves?: number;
  readonly reducedMotion?: boolean;
  readonly maxParticles?: number;
  readonly maxPixelRatio?: number;
  readonly title?: string;
  readonly subtitle?: string;
}

export interface PinballViewStats {
  readonly particles: number;
  readonly pulses: number;
  readonly queuedEvents: number;
  readonly rememberedEvents: number;
  readonly trailBalls: number;
  readonly cachedLayers: number;
  readonly backingPixels: number;
  readonly renderPixels: number;
  readonly leaves: number;
  readonly style: PinballViewStyle;
  readonly theme: PinballViewTheme;
}

export interface PinballView {
  resize(width: number, height: number, pixelRatio?: number): void;
  render(map: PinballViewMap, snapshot: PinballViewSnapshot, frame: PinballViewFrame): void;
  ingest(events: readonly PinballViewEvent[]): void;
  /** Clear transient trails/effects after a replay seek, restart or table change. */
  resetEffects(): void;
  getStats(): PinballViewStats;
  dispose(): void;
}
