# Playfield framing V2 source candidate

Separate candidate preserving the held `src/playfield-framing.ts` (acbe4c142354168f9bc76d517c20657bafa3657cfba6ab6722c9344461c1e081). V2 changes the exported revision and explicitly types the two field iterations as `readonly ArenaField[]`; this prevents the preceding Array.isArray narrowing from causing implicit-any callback parameters in strict TypeScript. No camera, index, host, renderer or default opt-in is changed.

Root reported eight executed V1 helper cases passing and six TS7006 errors at its final world-points loop. Those results are inherited context, not V2 execution evidence. The author has not run either V2 code or tests. Native camera/art acceptance remains separate.

Independent critic identified an entry-source gap in V1. V2 additionally requires each transition entry to be in its native source arena, have nonempty referenced support belonging only to the source room or that transition, and have its actual entry point on a referenced support plane. This rejects a capture labeled from A whose entry actually rests on destination B. The center/plane check is source geometry validation, not full-disc or moving-arrival qualification.

Path bounds now use each declared vertex clearWidths entry, checking profile length and numeric widths, instead of applying the minimum clearWidth everywhere. Native bed selection also remains a center/plane membership test, not a claim of full-ball support. V2 tests copy the eight original authored cases and add entry ownership/support and variable-width regression cases; no tests were executed by this author.

Capture HOLD bounds include the source room, actual entry footprint, referenced mouth supports, and explicitly declared intake paths sharing those supports (including their rails/decks). Destination room and primary/fallback exit footprints remain excluded until native transit. This keeps a legitimate outlying intake visible without selecting a receiver early or creating a lease. An eleventh authored case covers an entry outside the room envelope.
