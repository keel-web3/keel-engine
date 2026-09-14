// Placing the two-ended pieces: a bridge between two bank points (the
// terrain's bridge spans), and walls, fences and path stones following a
// path, gates where it asks. Each hands back ContentRecords (@keel-engine/object):
// what a level stores and placeContent builds.
import type { ContentRecord } from "@keel-engine/object";
import { spanBetween } from "./kit.ts";
import { dhypot } from "@keel-engine/core";

type P3 = readonly [number, number, number];
const PACK = "packs/buildings";

/**
 * A bridge from bank point `a` to bank point `b`: its pins (length, rise; kind and width as given) and
 * placement, so its endA lands on a and its endB on b. Lengths and rises past the bridge's ranges throw
 * (3..30 m, -3..3 m): a gap that wide wants piers of its own.
 */
export function bridgeFor(a: P3, b: P3, { kind = "beam", width = 2.4, seed = 0, style, pins = {} }: { kind?: "beam" | "arch" | "rope" | "plank"; width?: number; seed?: string | number; style?: string; pins?: Record<string, unknown> } = {}): ContentRecord {
  const s = spanBetween(a, b, "z");
  const length = Math.round(s.length * 1000) / 1000, rise = Math.round(s.rise * 1000) / 1000;
  if (length < 3 || length > 30) throw new RangeError(`A bridge spans 3..30 m; these ends are ${length.toFixed(2)} m apart.`);
  if (Math.abs(rise) > 3) throw new RangeError(`A bridge rises -3..3 m end to end; these ends differ by ${rise.toFixed(2)} m.`);
  return { pack: PACK, id: "bridge", seed, pins: { ...pins, length, rise, kind, width }, ...(style ? { style } : {}), pos: s.pos, yaw: s.yaw };
}

export interface AlongOptions {
  /** "wall", "fence" or "path-stones". */
  readonly id?: "wall" | "fence" | "path-stones";
  /** The longest a segment may be (the piece's own maximum at most). */
  readonly maxSegment?: number;
  /** Segment indices (after splitting) to make gates instead. */
  readonly gates?: readonly number[];
  readonly pins?: Record<string, unknown>;
  readonly gatePins?: Record<string, unknown>;
  readonly seed?: string | number;
  readonly style?: string;
}

const MAX: Record<string, number> = { wall: 12, fence: 6, "path-stones": 6, gate: 6 };

// A gate's posts, as gate.ts builds them: wooden 0.3, sci-fi 0.6, an arch's towers 30% of the opening (1 m at least).
const postOf = (kind: string, width: number): number => (kind === "arch" ? Math.max(1, width * 0.3) : kind === "scifi" ? 0.6 : 0.3);
/** How long a gate of this opening is, end to end (what a path must leave it). */
export const gateSpan = (kind: string, width: number): number => width + 2 * postOf(kind, width);
/** The opening a gate needs to be `span` long end to end (2..6 m: a shorter gap gets a 2 m gate that overlaps). */
export function gateWidthFor(kind: string, span: number): number {
  const w = kind === "arch" ? (span >= 3.34 * 1.6 ? span / 1.6 : span - 2) : span - 2 * postOf(kind, 0);
  return Math.round(Math.max(2, Math.min(6, w)) * 1000) / 1000;
}

/**
 * Segments along a polyline: every leg split into equal pieces no longer than `maxSegment`, each a record
 * whose endA lands on the leg's point and endB on the next -- consecutive segments meet end to end. A gate
 * replaces a segment named in `gates`: its opening sized so the gate fills it post to post, or -- a segment
 * longer than a 6 m gate -- the gate in its middle and a piece of the run either side.
 */
export function alongPath(points: readonly P3[], { id = "wall", maxSegment, gates = [], pins = {}, gatePins = {}, seed = 0, style }: AlongOptions = {}): ContentRecord[] {
  const cap = Math.min(maxSegment ?? MAX[id]!, MAX[id]!);
  const out: ContentRecord[] = [];
  let index = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!, b = points[i + 1]!;
    const legLen = dhypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(legLen / cap - 1e-9));
    for (let k = 0; k < n; k += 1) {
      const t0 = k / n, t1 = (k + 1) / n;
      const p: P3 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0];
      const q: P3 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1];
      const s = spanBetween(p, q, "x");
      const len = Math.round(s.length * 1000) / 1000;
      // (One look for the whole run: every segment shares the path's look seed.)
      const look = { seed: `path/${seed}` };
      const piece = (at: number, l: number, rec: Omit<ContentRecord, "pos" | "yaw">): ContentRecord => {
        // (A piece `l` long centred `at` metres along this segment from its middle.)
        const dx = (q[0] - p[0]) / (s.length || 1), dz = (q[2] - p[2]) / (s.length || 1);
        return { ...rec, ...(style ? { style } : {}), look, pos: [s.pos[0] + dx * at, s.pos[1], s.pos[2] + dz * at], yaw: s.yaw, pins: { ...(rec.pins ?? {}), [rec.id === "gate" ? "width" : "length"]: rec.id === "gate" ? gateWidthFor(String(gatePins["kind"] ?? "wooden"), l) : Math.round(l * 1000) / 1000 } };
      };
      if (!gates.includes(index)) out.push(piece(0, len, { pack: PACK, id, seed: `${seed}/${index}`, pins }));
      else {
        const kind = String(gatePins["kind"] ?? "wooden");
        const span = Math.min(len, gateSpan(kind, 6));
        const gate = { pack: PACK, id: "gate", seed: `${seed}/${index}`, pins: { kind, ...gatePins } };
        if (span >= len - 1e-6) out.push(piece(0, len, gate));
        else {
          // (Wider than a gate: the gate in the middle, a piece of the run either side.)
          const side = (len - span) / 2;
          out.push(piece(-(span + side) / 2, side, { pack: PACK, id, seed: `${seed}/${index}a`, pins }));
          out.push(piece(0, span, gate));
          out.push(piece((span + side) / 2, side, { pack: PACK, id, seed: `${seed}/${index}b`, pins }));
        }
      }
      index += 1;
    }
  }
  return out;
}
