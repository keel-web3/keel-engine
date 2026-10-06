# Independently tested CGB optimization helpers

These helpers provide lossless palette-group factoring, scene-global palette
packing, RGB555/bitplane/map oracles, guarded release-ROM profiling, a literal
GBDK data adapter and effective-worker source hashes. The codec also exports
deterministic bank-record packing and an exact native frame clock. Each helper
keeps target hardware rules separate; bank packing makes no mapper assumption.

This commit contains only the reviewed optimization helpers. The existing
Crucible consumer additionally depends on retro/specimen/target foundations
which were uncommitted in its detached engine checkout during measurement.
Those foundations and the top-level targets package/export integration are
outside this commit. Resolve their source branch and review them before using
this clean engine revision as Crucible's pinned build dependency.

Run the focused checks from the engine checkout:

```sh
node --test packages/codec/test/rom-banks.test.ts packages/targets/test/cgb-color.test.ts packages/targets/test/cgb-palette-groups.test.ts packages/targets/test/gbdk-data.test.mjs packages/targets/test/source-key.test.mjs
python3 packages/targets/test/cgb-profile.test.py
clang -std=c99 -O1 -fsanitize=address,undefined packages/codec/test/native-clock.c -o /tmp/keel-native-clock-check
/tmp/keel-native-clock-check
```

Palette factoring never changes the supplied colors. Canonical Crucible color
intent is a separately reviewed consumer profile; no default or artwork is
selected here. Timing samples describe their recorded calls, not universal FPS.
