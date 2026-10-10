# Canonical ordered physical progression

Revision `ordered-mechanisms/2026-10-08.1`. This package compiles source-bound contact graphs and interprets authoritative observations. It implements ordered/fresh shot guards, contact rearm/dedup, shared physical drop-bank/gate state, next-tick native collider mutations, and identity-bound deterministic snapshots. Source is authored; tests are authored but **not executed by the author**. Arena integration and native/portable/room acceptance belong to root.

No spinner, moving diverter, magnet, spatial enemy, extra-ball spawn, lock-bank multiball, score mutation or renderer-driven objective is implemented here. Capture objectives are not accepted as graph triggers in this first schema. Do not translate their animation or enum name into a supported capability.

## Compile exact bindings

`createProgressionCatalog(world)` checks the exact world canonical/digest pair and derives native collider IDs, kinds and explicit target roles. `compileProgression(definition,catalog,roster)` binds that catalog and the admitted owner/team/body roster into a compiled identity. Definitions use:

- `contacts`: exact mechanism ID, collider IDs, accepted contact types, source flipper IDs, shot requirement, fresh-shot requirement and maximum age.
- `gates`: logical gate ID, actual native gate collider ID and initial open state.
- `dropBanks`: bank ID and explicitly nominated native target rail IDs. Only rails whose source kind is `target` may be dropped. Initially-down IDs must be a subset.
- `graphs`: scope, initial node, nodes with contact binding/next node/effects/timeout, and explicit drain reset/effects policy. Effects are `gate`, `drop-target` and `reset-bank` only. Every node must be reachable from the initial node. Terminal nodes use `nextNodeId:null`; a cycle is permitted but requires fresh observations on every transition.

The compiler rejects sparse or duplicate identities, absent sources, unsupported types/effects, non-target drop geometry, ambiguous contact bindings and multiple graphs writing one actuator. Arrays normalize to stable ID order; the declared successor edges retain objective order. Owner/team/world scope controls graph instances. **Native gates and targets remain shared physical objects**; this package does not implement private collision geometry. Within one graph, effect serials resolve shared actuator requests to one final write at the boundary. Select shared-state/reset semantics deliberately for multiplayer.

`maxShotAgeTicks` is an upper bound, not a way to mint credentials. The arena must produce each `SourceShot` from an actually controlled native flipper contact whose leased owner equals the struck body's owner. It contains its numeric cursor, owner, body and blade. A fresh-shot guard requires that cursor to be later than the graph node's entry cursor. A contact arriving after arming with an older flight's shot cannot qualify that node.

## Numeric canonical observations

Each observation has an immutable ID and `{tick,phase,nativeOrdinal,serial}`. Native contacts require phase `NATIVE=0` and the actual exported native event ordinal; endpoint sensors use `SENSOR=1`, transport actions `CAPTURE=2`, and full separation reports `SEPARATION=3`. Synthetic phases have `nativeOrdinal:null`. They describe the exported authority pipeline, not inaccessible substep timing. The batch must already be in numeric causal order. Lexical event IDs, room journal ordering and camera observations are inappropriate inputs.

`contact` requires actual collider/type, body/owner and optional canonical source shot. Contacts on controlled colliders already disabled by an acknowledged target/gate state reject. Unbound valid native contacts do not advance a graph. Exact duplicate observations coalesce; ID/content conflicts or distinct observations sharing a cursor reject the whole observation batch.

Every bound contact disarms that body/binding, including out-of-order or unqualified contacts. This prevents a resting target or prior hit from becoming a new objective when the node changes. Only an authority `separation` observation rearms it. Integration must prove that the whole ball is outside every collider's served contact envelope for that binding, using its actual plane and geometry; a cooldown, a missing public contact, an old position or simply advancing a tick is not separation. No native pose is inferred by this package.

At an exclusive node timeout, that tick's expired contact is ignored, the initial node is entered at the end-of-tick boundary, and reset effects are scheduled for the next tick. Drain reset is explicit. A drain does not silently rearm a target; emit separation after the actual recovered body is clear. Completed graphs remain completed unless their declared reset policy changes them.

## Required arena19 hooks — actual physics, one writer

The package does **not** call `kernel.enabled` itself. `adaptActuatorEffects` implements the state-to-native adapter: down target ⇒ actual target collider `enabled:false`; reset bank ⇒ its target colliders `enabled:true`; open gate ⇒ gate collider `enabled:false`. Output includes exact IDs and accepted effect IDs. One final mutation per collider is emitted; hit-then-drain in a tick produces the final reset state without an intermediate physical write.

Root must implement the following around the canonical arena loop:

1. Create the controller from the exact compiled world/graph/roster. Reserve the controlled gate and target collider IDs. Disable legacy approach-switch, timer, requirement and capture-occupancy writers for those IDs or include their interlocks in a single actuator resolver. In particular, held assembler approach rollovers must not reopen an ordered gate. Initialization emits target and gate mutations even when source descriptors initially opened them.
2. Before native tick `t`, call `prepareActuatorTick(t)`. It returns a frozen controller-owned plan without changing accepted progression state. Resolve every collider ID against the exact admitted native dictionary, validate the entire batch, and check closing/reset target geometry against active bodies, release reservations and relevant served blade sweeps. A newly enabled collider cannot be placed through a body. Select a documented wait/failure policy; the module does not invent an escape displacement.
3. Atomically apply the complete native enabled batch, then call `commitActuatorTick(plan)` with that exact plan object. Discarding a plan consumes no rule effects. Foreign/stale plans, including plans created before a restore, reject. If the native batch fails partway, roll back native and rule state together; do not acknowledge a partial batch. Replaying `commit` twice is rejected.
4. Execute native tick `t`. Collect bounded raw canonical contact observations **before** the current 12-tick public contact suppression. Add source-shot cursors before deriving objective observations. Emit source-bound separation and drain observations in their declared phases. Call `observeTick(t,observations)` exactly once. Its validation/advance is atomic within this module and schedules effects for `t+1`. If any enclosing arena step fails after physics moved, restore the enclosing arena/controller snapshot transaction together.
5. Publish physical target/gate states and reliable objective transitions only after the corresponding authority operation succeeded. Presentation/audio contact coalescing is downstream. Extend room dictionaries/codecs and snapshot identities for this state. Never let client contacts, claimed progress or client actuator commands enter the interpreter.

The lifecycle is strict: `prepare/commit(t)` → native step → `observeTick(t)` → next tick. `tick` records the last observed completed native tick; `actuatorTick` may be `tick+1` while the current admitted tick awaits its observations. This intermediate phase is snapshot-supported. Failed observation validation leaves rule state unchanged; it does not by itself roll back a separately executed native step.

## Connected assembler bindings

Root can convert the held assembler's separate contact and transit bindings without modifying that held source:

| Room | Ordered contact binding IDs | Controlled gate |
| --- | --- | --- |
| Ion | `slice.ion.objective.pressure` → `.relay` → `.return` | `slice.ion.to-grove.gate` |
| Grove | `slice.grove.objective.pressure` → `.relay` → `.return` | `slice.grove.to-vapor.gate` |
| Vapor | `slice.vapor.objective.pressure` → `.relay` → `.return` | `slice.vapor.to-ion.gate` |

Pressure maps to each room's `.pressure` bumper; relay maps to `.relay.0` target rail; return maps to `.return-target.inner` and `.outer` rails. Use the assembler's explicit `admission.sourceFlipperIds`. These are source bindings, not inherited native qualification. If a physical drop-bank objective is selected, nominate only the intended relay target explicitly; keep passive return facets enabled. `unlockBindingId` maps to the transit binding's `actuatorIds`; it is not a route-complete event by itself.

The prospective west-transfer branch must supply its held exact IDs separately. Its author reports `slice.ion.to-west-transfer` and `slice.ion.west-transfer.to-ion` captures/gates plus branch return targets and own bank; those new descriptors were not inspected or admitted by this package author.

## Snapshots and evidence boundary

Snapshots include graph entries/counters, rearm state, physical gate/drop state, pending effects, bounded observation receipts, last transitions and both lifecycle clocks. Restore validates schema/revision, exact compiled graph/world/roster identity, checksum, membership/capacities, numeric cursors, pending-effect derivation and lifecycle phase before changing accepted state. A restore invalidates old prepared plans.

The checksum detects accidental corruption; it is **not authentication or proof that a forged snapshot's contacts happened**. Use authority-owned snapshots and legal replay for provenance. Full-disc support, native lease/interior contact, moving-face timing, hidden substeps, actual collider application, receiver usability and connected cardinal travel require separate engine evidence. This module does not fabricate that evidence.

Authored tests cover binding rejection, ordered actual mutation output, out-of-order/rearm, fresh versus old/wrong shots, numeric order, duplicate conflicts, owner/body integrity, discarded/stale plans, pending/applied snapshot phases, atomic malformed restore, deadlines/drain, scopes, disabled-collider observations and drop-then-reset final output. Root must execute focused tests, strict typing, module linkage and integration/native gates before acceptance. No test has been run by this author.
