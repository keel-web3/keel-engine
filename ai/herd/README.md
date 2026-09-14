# `ai/herd` (`@keel-engine/herd`)

Animals that keep together: boids -- separation, alignment, cohesion -- plus a
leader the rest follow (going its way at its pace, settling a gap behind it
when it grazes), and flight: a threat in range sends an animal straight away
from it, and a running neighbour spooks a calm one (alarm, with a moment's
immunity after a fright so two can't keep spooking each other). The leader
meanders and rests on seeded timers, walks slower than the herd can, and
slower still while the herd is strung out. Module `ai/herd@1.0.0` (`kind:
"ai"`), needs `keel/core@^0.1` and **`contract:body/quadruped@^1`**;
**provides** `ai/animal@1.0.0`.

```ts
import { createBrain, paramsFor } from "@keel-engine/herd";
const lead = createBrain(seedA, { ...paramsFor(sockets), leader: true });
const deer = createBrain(seedB, paramsFor(sockets));
// every fixed step, every brain against the same snapshot:
next[i] = brain[i].step(agent[i], world);   // world.neighbours() reports { id, pos, vel, mode, leader }
```

Same contract, agent, world query, save and purity as ai/wander (see its
README); `stepHerd` is the pure step; `social: true`. Params: `view`
(alignment/cohesion/alarm), `leaderView`, `separation`, the four weights,
`followGap`, `fleeRadius`, `calmFor`, `alarm`, `leader`, the leader's
`jitter`/`walkFor`/`restFor`.

Tests: `node --test ai/herd/test/*.test.ts` -- determinism, save/JSON/load
through a fright, cohesion (12 scattered over 14 m gather to a mean spread
< 3.5 m, nearest neighbour > 0.6 x separation, followers < 4.5 m from the
leader, polarisation > 0.7 while moving, the herd travels), bounded speeds,
flee (more flee than the threat reached -- the alarm spreads -- 10+ of 12 get
well away, all calm 12 s later), params by body, setup's binding, the bundle.
(Cohesion held over 8 seeds: spread ~1.1 m, polarisation ~1.0.)
