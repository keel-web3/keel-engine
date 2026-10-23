# KEEL pinball classic world

`createClassicWorld(map,{balls:3,ballSaveTicks:600})` wraps the shared kernel in classic launch, score, ball-save, drain, ball-count, game-over and restart rules. The object exposes `step(inputBits)`, `readFrame()`, `readEvents()`, `snapshot()` and `restore(bytes)`. `step` admits one 120 Hz input frame, never elapsed time. LEFT=1, RIGHT=2, LAUNCH=4, RESTART=8. Launch/restart are rising edges. A held launch cannot spend the next ball. Ball saves expire relative to the original launch and do not renew themselves.

Frames include physics plus `score`, `ballNumber`, `ballsRemaining`, `phase`, `ballSaveRemaining`, `canLaunch`, and ordered canonical events. Bumper events receive the authored integer point value; collision cooldown is 12 ticks and saved in kernel state. Score saturates at signed 32-bit maximum. Snapshots preserve prior input, save expiry, rules, score, ball lifecycle and the complete kernel snapshot. Malformed restore is transactional.

This first profile implements a single owned classic ball. Locks, multiball, target banks, multipliers, tilt, jackpots, campaign and roguelike progression are future consumer features, not empty placeholder modules or claimed functionality.

Returned shooter balls can be relaunched with a new LAUNCH edge after settling inside the declared socket: defaults are half-width 14, 16 units above and 40 below the authored launch position, speed at most 1 unit/tick. These frozen `rules.launchSocket` bounds are explicit and snapshot-bound. Relaunch preserves owner, ball credit, score, and original ball-save deadline. `canLaunch` exposes readiness for the application prompt.
