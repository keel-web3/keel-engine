# Pinball arena generator

The current supported development entry is the compact procedural compiler, awaiting independent playability and visual approval. The earlier `createArenaWorld`/diagnostic spatial generators are rejected experiments and must not be presented as the generated pinball product. Root gates them out of the client. The authored cabinet is a separate primitive fixture.

```ts
import {generateQualifiedPinballMachine} from '@keel-engine/pinball-arena-gen';
const result = generateQualifiedPinballMachine('0x2026', {
  maxAttempts: 8,
});
// result.world is the exact identity-bearing collider/surface descriptor.
// result.admission contains one-based legal input spans and physical receipts.
```

Run generation in an offline script or worker. It compiles a seeded catch/shooter foundation, measures outgoing paths from canonical timed flipper inputs, derives ground-orbit/elevated-return geometry from those paths, then runs the full shooter and final-contact routes. Geometry rejection and bounded retry are deterministic. Exhaustion throws `PinballGenerationError` with rejection reasons; it never silently returns an authored fallback.

Current admission radius is12 table units. Compiler revision .2 admits a minimum eight adjacent successful start ticks for each distinct LEFT/BOTH fixed120-tick hold policy, with every witness receipt stored in `orbitWindow` and `crossReturnWindow`. The compiler has static seam/support checks, typed launch versus main-shot provenance, real receiving-flipper finals, RIGHT return control and exact replay. `replayPinballReceipt` bounds ticks to1–3600 and permits at most16 validated one-based input spans. `createPinballCandidateWorld` compiles an unapproved recipe for a separate review harness.

The prior .1 corpus was rejected after independent timing review found isolated8.33ms success windows and raised balls obscured by the solid shooter deck. The .2 central-feed corpus passes all64 stored family witnesses across four seeds and uses explicitly serialized wireform raised decks. Independent physical review and fresh wide/tall visibility approval are pending; this remains a compact development slice. Source tests and exact trajectories do not establish human controls, browser/device performance or a finished game.

Pending product work includes broader seeded topology/shape families, five-bank common shot fields, connected downstream catches, targets/spinners/locks, physically sealed compound gates, captured transit and real owned multiball budgets, and100-body shared collision/performance qualification. Limits are global across all arenas; query `ARENA_CONTENT_LIMITS` from the authority. Renderer style/materials never alter collision identity.
