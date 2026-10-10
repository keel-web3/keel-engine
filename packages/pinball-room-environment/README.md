# Native room environment

`keel/pinball-room-environment` generates original indexed scenery behind a
caller's validated native pinball bed. It exposes `roomEnvironmentPalette`
and `paintRoomEnvironment`. It does not create physics geometry or validate
a playable room.

Three construction styles have their own material ramps, structures and
authored pixel cells: a pressure-service bay, a ceramic neon atrium and a
root/stone garden cavern. Animation uses native simulation ticks; reduced
motion holds its ambient pose. Painting a secondary exterior uses
`background:false` to retain the existing background.

`preparePinballTrackEnvironment` copies a caller's validated source orbit
into immutable scenery anchors. `paintPinballTrackEnvironment` uses those
anchors for a quiet gallery behind active, unleased travel. The caller then
paints native decks, rails and bodies. This pass creates no gameplay route,
station lease, platform or transport body. Plans accept at most64 vertices
and32768 source units; projected canvases are capped at1024×1024. Ambient
lights use the native tick and reduced motion freezes their pose.

The opaque cache includes the source bed identity and has a 12-entry/4 MiB
limit. Decorative polygons are clipped before their raster masks are
allocated, including maximum canvas and projected-bed budgets.
The separate static track-gallery cache holds at most8 entries/2MiB, so
total indexed environment caches are bounded at6MiB. It excludes bodies
and working mechanisms, and clipped painting bypasses opaque cache reuse.

The prototype imports this module's source through the canonical engine
workspace. A separate SDK build preserves its exact input and output
receipt. The SDK's current IIFE loader is unsupported on a page that already
defines `require`: its generated helper can capture that resolver before
the module factory supplies scoped dependencies. The source browser host
does not define it. Neither source parity nor the SDK receipt is art,
whole-game, device or publication approval.
