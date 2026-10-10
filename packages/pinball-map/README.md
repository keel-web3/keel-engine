# KEEL pinball map

`compilePinballMap(source)` validates `keel-pinball-map@1`, quantizes authored geometry to Q10, sorts stable collider IDs, rejects duplicate IDs and capacity/range errors, and freezes a canonical immutable map. Physics and view consume this same geometry. Table coordinates are +x right, +y down. Segments are zero-thickness centerlines with a ball-radius collision expansion; bumpers are circles; flippers are rotating capsules. Discrete layer/owner IDs reserve explicit world boundaries without introducing simulated field transfers.

This compiler validates data and bounds. It does not claim that every accepted arrangement has playable shots, non-overlapping rails, a reachable exit or sufficient return clearance. Qualify authored maps with the exact kernel's input probes and human play before claiming playability. Editor, random generation and future map families remain separate features.
