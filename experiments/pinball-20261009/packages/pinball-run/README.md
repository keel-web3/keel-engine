# KEEL pinball survival run

`createPinballRun(cabinet, baseMap, {layouts, classId, profile, campaignStages?, startStage?, objectiveIds?, launchSocket?})` composes canonical cabinet stages with the real classic world and integer WASM. It exposes `map` (current getter), `step(bits)`, `readFrame()`, `readEvents()`, `snapshot()`, `restore(bytes)`, and `getStage()`.

Profiles are `endless` and `campaign`. Classes are `striker` and `warden`. A campaign defaults to three chapters (1–100 permitted); its optional zero-based starting checkpoint must be in that range. Endless starts at zero. Explicit objective IDs name one to three canonical bumpers; EMBERLINE passes all three coil IDs. Normal targets and kickers still award points and ultimate charge, but cannot substitute for objective contacts.

## Input and actual game loop

One `step` admits a 120 Hz input frame: left 1, right 2, launch 4, restart 8, skill one 16, skill two 32, ultimate 64, draft choices 128/256/512. Ability/choice/restart actions use rising edges. Simultaneous draft choices are rejected. Skills require an active ball. Every successful activation changes real canonical state and starts its cooldown.

A stage requires all declared coil IDs plus four coil hits initially; the hit quota rises to sixteen and then caps. Only actual kernel bumper events count. Clearing enters a draft, freezes ball/mechanics/ability timers, and offers three deterministic stage-seeded upgrades. Choosing one changes the actual run modifiers and enters the next canonical map, carrying health, shields, charge, upgrades and run score. Input transitions during a draft consume one command tick so release edges replay exactly; identical idle input changes no state and returns no new events. Hosts may journal only commands that advance `runTick` to omit deliberation time. Physics never receives arbitrary elapsed time.

Credited drains consume one shield or one hull. Ball-saved drains do neither. Striker starts with three hull and no shield; Warden has four hull and one shield. Zero hull is `defeated`. The underlying world has nine ball credits; if a protected character survives exhaustion, a fresh canonical world continues the same stage and objective state. Event IDs include global command tick, stage and world cycle, so resetting local kernel ticks cannot duplicate hit identities.

The frame is compatible with classic rendering and adds run phase, profile, global `runTick`, stage/checkpoint, hull/shields, total score/combo, objective hit IDs/quota, skill cooldowns, charge, upgrades and draft choices. Its `score` is total run score. Hosts should display run hull/stage rather than presenting the underlying nine world credits as the run's life allowance.

## Classes

| Class | Skill one | Skill two | Ultimate |
| --- | --- | --- | --- |
| Striker | Drive: upward impulse; 180-tick cooldown | Cross Shot: centerward/upward impulse; 300 ticks | Overdrive: upward impulse and 600 ticks of doubled hit awards, within the 4x score cap |
| Warden | Guard: one shield up to three; 900 ticks | Rescue: reverses a descending lower-field ball upward; 600 ticks | Bastion: up to two shields and one hull repair |

Canonical bumper hits generate fifteen charge before upgrades. Ultimates consume 100 charge. Rescue uses the world's sanctioned bounded velocity-only impulse API; it never changes ball position. The WASM radial speed limit remains authoritative.

## Guardians

Every fifth endless stage (indices 4, 9, …) is a guardian encounter. Campaign and classic profiles do not gain this mechanic. Guardian hull starts at eight and caps at twenty. Real objective-coil contacts deal damage; power upgrades increase it within declared bounds. The second phase begins at half hull. A sixty-active-tick telegraph precedes a real downward ball impulse: two units/tick in phase one, four in phase two. The first strike is after 180 active-ball ticks; later periods are 360/240. Player abilities are processed after the hazard impulse, allowing a correctly timed Rescue to answer it. There are no invisible projectile collisions or synthetic hit credits.

A guardian stage needs both its normal objective and zero guardian hull to clear. Frames expose `encounter`, `bossHealth`, `maxBossHealth`, `bossPhase`, `hazardWarning`, and `hazardCountdown`; canonical warning, strike, damage, phase and defeat events drive presentation. Timers freeze during drafts and while no ball is active.

## Restart, checkpoints and snapshots

Endless restart clears run-local rewards/health/score and returns to stage zero with the same cabinet seed. Campaign restart retries the current chapter checkpoint, retaining permanent upgrades and score earned in earlier completed chapters while restoring full hull. Creating a fresh campaign starts over; the host owns durable checkpoint storage. The final chapter ends in `completed`, distinct from defeat.

Snapshots bind run/rules/kernel versions, cabinet recipe, base/layout template, class, profile, campaign configuration, objective IDs and effective launch-socket rules. They include complete world bytes plus input edges, clocks, cooldowns, draft state derivation, scores, objectives, checkpoint, upgrades and guardian timers. Restore regenerates the stage, verifies its digest, validates bounded and consistent state, restores a candidate world, then commits transactionally. Local validation detects malformed saves; it does not prove a human supplied a transcript or confer ranked authority.

This is a real local survival/campaign slice. Multiplayer authority, collectible minting, arbitrary encounter families, spatially distinct second fields, locks and multiball are outside this module. No publication or on-chain operation is performed.
