# Source-owned playfield framing helper

Source-only candidate, not imported by camera.ts, index.ts or hosts. No tests, build, typecheck, native run or renderer was executed by this author. Existing defaults remain unchanged.

`src/playfield-framing.ts` exports `createPlayfieldFramingIndex(world, {rooms, transitions?})` and `solvePlayfieldOrigins(request)`.

Rooms declare exact arena, bed and bank IDs plus native surface/rail/flipper/station/path/port membership. Transitions own their corridor geometry separately, and bind one actual path or capture plus source/destination rooms. This prevents a bridge from inflating a local cabinet's envelope. Every declared native member has exactly one scope owner. A receiving port can belong to the destination room; references across scopes do not duplicate ownership. Path rails/decks must belong to the same scope as their path. All path/port references must close over declared owners, and transition exits must name a real destination bank. Both capture exits are checked. Rooms permit one or more banks with one or more actual blades; single-flipper branches are not forced into pair anatomy.

The constructor checks dense bounded definitions, source IDs, arena ownership, bed/bank plane and containment, unique blade-bank membership, exact path/port closure, duplicate capture/ramp scopes and finite geometry. It copies only relevant native records/point lists; no renderer, raster or simulation handle is retained. This is framing admission, not a replacement for validateArenaWorld or physical path/return qualification. Bounds describe native source geometry, not the full decorative R22 atlas.

## Root integration

```ts
const scopes = createPlayfieldFramingIndex(world, generatorFraming);
// At each existing native camera sample:
const selection = scopes.select(observedFrame, ownerId, viewport.mode);
const sourceBounds = scopes.bounds(selection, currentElevationRatio);
// Keep the camera's existing readable uniform scale and protected-ball/blade
// projected-plane bounds. Explicit manual overview keeps its existing world path.
const origin = sourceBounds && selection.kind !== 'world'
  ? solvePlayfieldOrigins({bounds:sourceBounds, protectedBounds:followBox,
      scale:finalScale, width, height, safeInsets,
      followLeft:finalLeft, followTop:finalTop, padding:10})
  : null;
if (origin?.status === 'ok') {
  finalLeft = origin.left!;
  finalTop = origin.top!;
}
// An infeasible protected span returns maximumSafeScale, not a fabricated
// safety certificate. Retain the existing camera's scale-fitting fallback.
```

Use this at the final native camera origin calculation, before the existing bounded depth translation/final protected clamp and before creating immutable project/inverse closures. If the engine uses a scoped map fit candidate, recompute that candidate from `sourceBounds` with the same current ratio; do not reuse a whole-arena fit certificate under a new room label. Manual overview bypasses the optional room policy. The helper itself changes no scale, camera state, native frame, ownership or controls.

Each fitting axis is centered within the safe rectangle at the already readable scale. Each oversized axis follows the camera target constrained to the room's extent. Those room intervals intersect the current native ball/owned-blade safe-origin intervals. If a real body leaves its selected room and intervals conflict, native safety wins and `escapedRoom` is reported. If even the protected span cannot fit, status is `infeasible`. Padding must be at least one pixel to cover rounded projection. This fixes the asymmetric tall-phone vertical policy; it cannot remove all unused area inherent to an extremely narrow viewport while retaining a uniform scale.

## Native selection semantics

- Manual overview returns `world` and complete arena source bounds.
- During capture hold, `select` returns a transition with exact from/to room IDs and actual selected primary/fallback exit. `bounds` retains the source room during `captured`. Transit/exit-blocked bounds contain the actual corridor (if any), both source rooms and selected endpoint. The existing native camera alone interpolates phase clocks; the helper never creates a body pose or immediately snaps to a receiver room.
- Active ramp ID selects its exact declared connector. Otherwise a body on a room bed at its actual layer/height selects that room; a body on a connector support selects that transition. Support means center/plane membership for presentation, not complete-ball safety proof.
- A native bank ID provides room context when the body is off the bed. Inactive bodies exactly at a canonical launch seat can select that room without a claimed lease. There is no nearest-bank fabrication.
- Unknown/unowned travel returns `unscoped` with null bounds; root retains ordinary native body follow. Ambiguous source support/ownership throws rather than choosing arbitrary array order.

`bounds(selection, ratio)` projects immutable point records at the supplied ratio and returns fresh bounds. There is no cache per dynamic ratio and no retained per-frame canvas. Definitions are capped at64 rooms/128 transitions, source record arrays at32768, polygon32 and path128 points; native world validation remains the stricter canonical admission. Parent should retain/bind the index once per world, and may measure/optimize bounded point projection later if shared-world size warrants it.

Authored tests cover two-room native selection, capture hold/transit/fallback, manual world overview, ratio recomputation/source-copy identity, membership rejection, fitting/oversized axes, escaped native body safety, infeasible protection, invalid inputs, and actual connector/ramp selection. They remain unexecuted until root runs them.
