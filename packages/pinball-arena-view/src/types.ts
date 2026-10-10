import type { ArenaFrame, ArenaWorldDefinition } from "@keel-engine/pinball-arena";
import type { MeshGBuffer } from "@keel-engine/bake";
import type { StyledObjectDef } from "@keel-engine/object";
import type { ArenaBodyVisual } from "./body-visuals.ts";
export type ArenaRenderStyle = "pixel" | "dither" | "arcade" | "realistic" | "cartoon";
export type ArenaRenderDensity = "low" | "medium" | "high";
export interface ArenaCamera {
  readonly mode: "follow" | "overview";
  /** World overview lays distinct physical arenas out beside their portal links. */
  readonly scope?: "arena" | "world";
  readonly arenaId?: string;
  readonly ownerId?: number;
  /** Physical field coordinates; unset follow coordinates come from the body. */
  readonly x?: number; readonly y?: number; readonly elevation?: number;
  readonly zoom?: number; readonly yaw?: number; readonly pitch?: number;
}
export interface ArenaViewOptions {
  readonly ownerId?: number; readonly width?: number; readonly height?: number;
  readonly style?: ArenaRenderStyle; readonly density?: ArenaRenderDensity;
  readonly reducedMotion?: boolean; readonly maxChunkMeshes?: number; readonly maxMovingFoliage?: number;
  /** Optional read-only admission probe after the actual depth-tested mesh pass. No readback runs by default. */
  readonly onMeshFrame?: (buffer: MeshGBuffer) => void;
  /** Extra registered KEEL content-pack objects named by serialized scene props. */
  readonly worldArtAssets?: readonly StyledObjectDef[];
  /** Bounded ordinary rolled-unit presentation, copied and admitted once.
   * Actual native center, radius, layer, capture and ownership remain authoritative. */
  readonly bodyVisuals?: readonly ArenaBodyVisual[];
}
export interface ArenaViewStats {
  readonly cachedMeshes: number; readonly meshBytes: number; readonly chunks: number;
  readonly drawn: number; readonly culled: number; readonly triangles: number;
  /** Actual KEEL sun depth-map submissions, for read-only source-depth probes. */
  readonly shadowDrawn: number; readonly shadowTriangles: number;
  readonly movingFoliage: number; readonly width: number; readonly height: number;
  readonly backend: "keel-live-mesh";
}
export interface PinballArenaView {
  setWorld(world: ArenaWorldDefinition): void;
  resize(width: number, height: number): void;
  setStyle(style: ArenaRenderStyle): void;
  render(frame: ArenaFrame, options: { readonly timeMs: number; readonly deltaMs?: number; readonly camera?: ArenaCamera }): void;
  project(x: number, y: number, elevation?: number, arenaId?: string): readonly [number, number, number] | null;
  /** Actual main-body mesh identity for read-only owner visibility inspection. */
  bodyMeshId(ownerId: number): string;
  /** Maps visible screen sides to the currently rendered canonical pair.
   * Never rewrites physics, recorded tapes or the source flipper labels. */
  inputSideMapping(frame: ArenaFrame, ownerId?: number): { readonly arenaId: string; readonly stationId: string; readonly left: "left" | "right"; readonly right: "left" | "right"; readonly leftFlipperId: string; readonly rightFlipperId: string } | null;
  getStats(): ArenaViewStats;
  dispose(): void;
}
