import type { ArenaCapture, ArenaField, ArenaFrame, ArenaPinballPort, ArenaTransportFrame, ArenaWorldDefinition } from "@keel-engine/pinball-arena";

export const ARENA_CAPTURE_CUE_REVISION = "capture-cue/2026-10-07.1";
export interface ArenaCaptureCue {
  readonly phase: ArenaTransportFrame["phase"];
  readonly label: "HOLD" | "TRANSIT" | "BLOCKED";
  readonly progress: number;
  readonly ownerId: number;
  readonly entry: ArenaPinballPort;
  readonly destination: ArenaPinballPort;
  readonly destinationArenaId: string;
  readonly local: boolean;
  /** Bearing is the actual entry-to-selected-exit vector, never the release velocity. */
  readonly bearing: number | null;
  readonly distance: number | null;
  readonly locationLabel: string;
}

/** Resolve the occupied body by identity and use its authority-selected exit.
 * Qualification timeout may choose the fallback; the planned primary is not
 * evidence of the active destination. No presentation clock predicts phases. */
export function arenaCaptureCue(world: ArenaWorldDefinition, field: ArenaField, capture: ArenaCapture, frame: ArenaFrame): ArenaCaptureCue | null {
  const live = frame.captures.find(c => c.arenaId === field.id && c.id === capture.id);
  const body = live?.occupiedBodyId ? frame.balls.find(b => b.id === live.occupiedBodyId) : undefined;
  const transport = body?.transport;
  if (!body || body.eliminated || !transport || transport.mechanismId !== capture.id || transport.phase !== live?.phase) return null;
  const entry = field.pinball?.ports.find(p => p.id === capture.entryPortId);
  const destinationField = world.arenas.find(f => f.id === transport.exitArenaId);
  const destination = destinationField?.pinball?.ports.find(p => p.id === transport.exitPortId);
  if (!entry || !destination || !destinationField) return null;
  const local = destinationField.id === field.id, dx = destination.x - entry.x, dy = destination.y - entry.y;
  const distance = local ? Math.hypot(dx, dy) : null;
  const duration = transport.phase === "captured" ? capture.release.kind === "qualification" ? capture.release.maxHoldTicks : capture.captureTicks : transport.phase === "transit" ? capture.travelTicks : capture.maxExitWaitTicks;
  const progress = Math.max(0, Math.min(1, (frame.tick - transport.phaseTick) / Math.max(1, duration)));
  return { phase: transport.phase, label: transport.phase === "captured" ? "HOLD" : transport.phase === "transit" ? "TRANSIT" : "BLOCKED", progress, ownerId: body.ownerId, entry, destination,
    destinationArenaId: destinationField.id, local, bearing: local ? Math.atan2(dy, dx) : null, distance,
    locationLabel: local ? `${Math.round(distance!)}U L${destination.layer}` : `REMOTE L${destination.layer}` };
}
