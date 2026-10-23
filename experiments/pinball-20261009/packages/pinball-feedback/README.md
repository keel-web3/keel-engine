# Pinball mechanism feedback

`keel/pinball-feedback@0.1.0` turns admitted Frame@2 mechanism activations and capture events into seeded particles, lamp pulses, normalized spring/plunger recoil, capture phase progress and pinball sound cues. The renderer constrains recoil inside each generated mechanism housing. The authority remains responsible for collision poses, flippers, gates, capture/release, impacts and body visibility.

Create one service per world, call `update(frame)` at each completed simulation tick, and render `sample(frame.tick, interpolation)` between ticks. Sounds returned by `update` carry position and owner for distance/priority mixing. Duplicate journal events are ignored. Activation serials recover mechanism feedback when cosmetic cues are coalesced in transport. `reset()` precedes replay seek or a restarted match.

Particles and pulses have independent fixed caps; age, position and appearance are deterministic from the world seed and admitted event identity. Reduced motion suppresses particle bursts and mechanical recoil while retaining short lamp cues. This module supplies presentation data; source checks do not establish that a finished map is attractive, readable or accepted on a physical device.

Ramp entry and exit cues follow the native ball's route position and elevation. If the same tick then transfers or captures that ball, the cue stays at the ramp's declared endpoint using the contiguous prior approach. A body on an unrelated floor cannot anchor it. Deferred delivery without an explicit position or an unambiguous native approach omits the cue rather than inventing a ramp location.

Transport `transit-start` and `exit-blocked` events produce distinct generated travel and blocked-mechanism sounds and short phase pulses. Their location remains the admitted event's entry mechanism; destination guidance belongs to the actual transport/port state. A blocked pulse does not imply a release or successful route. Duplicate delivery and replay seek stay silent. PCM recipes are deterministic presentation assets, not evidence of an auditioned final mix.

`pinballFeedbackMix(cue, focus, ownerId)` supplies the game's distance, pan and priority policy. Owned mechanism cues remain audible if another native action transfers the listener in the same tick; a cue from the previous arena is centered. Ambient cues stay in the current arena and attenuate with native X/Y/elevation distance. This is a bounded distance mix, not environmental acoustic occlusion.
