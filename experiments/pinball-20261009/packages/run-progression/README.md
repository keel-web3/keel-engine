# KEEL run progression

Pure deterministic rules used by `keel/pinball-run`: two class definitions, bounded modifiers, score/combo awards and three-choice seed-bound drafts. `core/rng` supplies fixed trait slots under a named stage draft stream. This module has no renderer, clock, network or persistence dependency.

Permanent upgrades cap at four levels each: hull (+1 maximum hull and repair), power (+0.5 ability impulse; every two levels adds one guardian damage), score (+15%), haste (10% shorter skill cooldown), charge (+5 charge per bumper). When permanent upgrades cap, repair, shield and battery consumables still supply three distinct usable choices. Maximum hull is eight, shields three, ultimate charge 100, hit multiplier 4x and cooldown floor 30 ticks.

These rules are versioned by `RUN_RULES_VERSION`. Hosts must retain the matching rules/kernel/map artifacts for replay rather than interpreting an older run under changed balance.
