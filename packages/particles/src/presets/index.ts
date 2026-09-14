// The preset library: one effect a file, all palette-driven (PARTICLE_RAMPS' names) and sized in metres.
// Pass PRESETS to createParticlePool (fire starts "embers" and explosion debris throws "dust-puff" by name).
import type { EmitterRecipe } from "../recipe.ts";
import bloodSplat from "./blood-splat.ts";
import dustPuff from "./dust-puff.ts";
import embers from "./embers.ts";
import explosion from "./explosion.ts";
import fire from "./fire.ts";
import footstepDust from "./footstep-dust.ts";
import ichorSplat from "./ichor-splat.ts";
import magicSwirl from "./magic-swirl.ts";
import muzzleFlash from "./muzzle-flash.ts";
import rain from "./rain.ts";
import smokeColumn from "./smoke-column.ts";
import snow from "./snow.ts";
import sparkShower from "./spark-shower.ts";
import waterSplash from "./water-splash.ts";
// (The RTS set: impacts per damage class, tracers, construction, damage states and deaths -- damage.ts drives
// the damage and death ones.)
import impactKinetic from "./impact-kinetic.ts";
import impactPiercing from "./impact-piercing.ts";
import impactBlast from "./impact-blast.ts";
import impactEnergy from "./impact-energy.ts";
import impactAcid from "./impact-acid.ts";
import impactSiege from "./impact-siege.ts";
import impactFlesh from "./impact-flesh.ts";
import tracer from "./tracer.ts";
import tracerKinetic from "./tracer-kinetic.ts";
import tracerPiercing from "./tracer-piercing.ts";
import tracerEnergy from "./tracer-energy.ts";
import tracerAcid from "./tracer-acid.ts";
import tracerBlast from "./tracer-blast.ts";
import tracerSiege from "./tracer-siege.ts";
import damageSparks from "./damage-sparks.ts";
import buildSparks from "./build-sparks.ts";
import buildMotes from "./build-motes.ts";
import buildGlow from "./build-glow.ts";
import warpRing from "./warp-ring.ts";
import finishFlash from "./finish-flash.ts";
import smokeLight from "./smoke-light.ts";
import smokeHeavy from "./smoke-heavy.ts";
import fireDamage from "./fire-damage.ts";
import debrisBits from "./debris-bits.ts";
import rubbleDust from "./rubble-dust.ts";
import metalSparks from "./metal-sparks.ts";
import bleedDrip from "./bleed-drip.ts";
import crystalChips from "./crystal-chips.ts";
import smokeTrail from "./smoke-trail.ts";
import deathCollapse from "./death-collapse.ts";
import deathBurst from "./death-burst.ts";
import deathDissolve from "./death-dissolve.ts";

export const PRESETS: Readonly<Record<string, EmitterRecipe>> = Object.freeze({
  "dust-puff": dustPuff,
  "footstep-dust": footstepDust,
  "spark-shower": sparkShower,
  "muzzle-flash": muzzleFlash,
  explosion,
  "smoke-column": smokeColumn,
  fire,
  embers,
  "magic-swirl": magicSwirl,
  "blood-splat": bloodSplat,
  "ichor-splat": ichorSplat,
  rain,
  snow,
  "water-splash": waterSplash,
  "impact-kinetic": impactKinetic,
  "impact-piercing": impactPiercing,
  "impact-blast": impactBlast,
  "impact-energy": impactEnergy,
  "impact-acid": impactAcid,
  "impact-siege": impactSiege,
  "impact-flesh": impactFlesh,
  tracer,
  "build-sparks": buildSparks,
  "build-motes": buildMotes,
  "build-glow": buildGlow,
  "warp-ring": warpRing,
  "finish-flash": finishFlash,
  "smoke-light": smokeLight,
  "smoke-heavy": smokeHeavy,
  "fire-damage": fireDamage,
  "debris-bits": debrisBits,
  "rubble-dust": rubbleDust,
  "metal-sparks": metalSparks,
  "bleed-drip": bleedDrip,
  "crystal-chips": crystalChips,
  "smoke-trail": smokeTrail,
  "death-collapse": deathCollapse,
  "death-burst": deathBurst,
  "death-dissolve": deathDissolve,
  "tracer-kinetic": tracerKinetic,
  "tracer-piercing": tracerPiercing,
  "tracer-energy": tracerEnergy,
  "tracer-acid": tracerAcid,
  "tracer-blast": tracerBlast,
  "tracer-siege": tracerSiege,
  "damage-sparks": damageSparks,
});
