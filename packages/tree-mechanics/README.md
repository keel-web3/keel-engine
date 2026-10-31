# `@keel-engine/tree-mechanics`

A tree's wood as it really carries itself. Module `keel/tree-mechanics@0.1.0`
(`kind: "runtime"`, no needs: it reads a branch graph and a pose as plain
arrays and writes a moved copy, so any renderer can draw it).

```ts
import { createTreeMechanics } from "@keel-engine/tree-mechanics";
import { growTree, treeFrame } from "keel://module/tree-growth.js";

const model = growTree({ species: "oak", seed });
const mechanics = createTreeMechanics(model, { ground: 0, groundRadius: 4, seed });
// each frame
const frame = treeFrame(model, cycle);           // the grown tree at rest
const moved = mechanics.update(frame, {
  elapsed, dt, wind: 0.4, dir: windDirection,     // wind as a share of `gale` (18 m/s)
  snow: 0.6, foliage: year.leaf,                   // snow on what catches it; leaves on or off
  loads: [{ node: perchNode, mass: 0.6 }],         // an animal's weight, kg, at a node's end
});
render.update(moved, year, { ...motion, field: 0 }); // draw the moved tree, without a sway field on top
for (const b of mechanics.breaks) …              // what the storm took
const wood = mechanics.capsules(0.03);           // climbable wood: { a, b, r, carry (kg) }
```

## How it moves

A tree is limbs: chains of internodes of one branch order, each growing from
a node of its parent limb. Each limb bends in one mode. Its internodes turn in
proportion to their compliance under the load the limb carries (moment ×
length ÷ EI, the beam law), so a limb gives most where it is thin and far from
its base. The mode's stiffness and inertia come from the wood and leaves it
really carries; its frequency is the beam law's, pressed into the band trees
are seen to sway in (`band`, by default 0.28–3.2 Hz): a grown trunk breathes at
about one hertz, a twig flickers at three. Limbs ride their parents' motion
and lag behind it, so a gust rolls out from the trunk to the twigs. The step
is implicit, so the stiffest twig is stable at any frame rate.

## What moves it

- **Wind**: drag, ½ρC·A·v|v|, on wood and on leaves (`foliage` scales them),
  under a wind that rises with height, rolls through in gust fronts from
  upwind, buffets each limb on its own and swirls across the wind a little.
  Leaves fold and stream in a strong wind, so their drag grows slower than v².
- **Snow**: its weight on the horizontal wood and on the leaves that catch it.
  A bare deciduous tree carries little; an evergreen's boughs bow.
- **Loads**: weight at a node's end, in kilograms. A bird dips a twig, a monkey
  bows a limb, and when either leaves the wood springs back past rest and settles.

## Breaks

Stress at each joint is its bending moment (the load beyond it, swelled by
how far it swings past where the load alone would hold it) over the section
modulus, πr³/4. Strength is `wood.strength`, less for dead wood
(`deadStrength`), rot and knots (seeded per node). When a joint's stress passes
its strength it snaps: the piece hangs a moment by the torn wood, tumbles down
(drifting downwind), lands on `ground` within `groundRadius`, lies `lieFor`
seconds and rots away over `rotFor` seconds. The trunk and wood thicker than `protect` × the trunk
never break; a storm takes one piece every `cooldown` seconds, at most `most`
in all. At the default strength a gale takes dead wood while living limbs
hold; a storm may take a living twig, and deep snow on an evergreen strips a
few. Pass a stronger `wood` for wood that bends rather than breaks (a palm's
fronds). `heal()` mends everything.

`storm(frame, forces, { gust = 1.3, seed })` strikes the tree with a storm's
peak all at once, for a storm it went through while nobody watched:
`forces.wind` blows steady at `forces.elapsed` (no fronts or buffeting), each
limb bends where the wind would hold it times `gust`, and joints past their
strength come down there and then, without the cooldown. A gust does not catch
every limb at its worst, so a joint only just past its strength often holds
and one far past it nearly always goes (a chance of 1 − e^(−2(strain − 1)),
drawn from the storm's `seed`). Its pieces lie on the ground from that moment,
so replaying a tree's storms on one clock (seconds, say) and then updating it
at the present leaves this year's wreckage lying and older wood rotted away.
It returns the storm's breaks and leaves the limbs at rest. With
`breaks: { live: false }` the live wind breaks nothing, so every break is one
`storm()` struck.

## Climbing

`capsules(minRadius)` lists the wood as moved this step: `{ node, parent,
order, a, b, r, carry }`, where `carry` is the weight in kilograms the wood can
bear at its end (the weakest joint between it and the ground, with a margin).
Animals should pick wood that carries them. `woodPath(node)` runs from the
trunk's foot out along the moved wood to a node, for a climber to follow.
