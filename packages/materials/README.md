# `@keel-engine/materials`

Surface materials as generative pixel art. Give it an exact sheet (a material
atlas, a tileset, a painted texture) and it learns how to make more of it:
every seed is a new sheet of the same look, and a gauntlet proves it still
looks like the original. Without a sheet it paints bark, leaves and snow
procedurally. Module `keel/materials@0.1.0` (`kind: "runtime"`, plain data:
the atlas is RGBA bytes any renderer uploads).

```ts
import { analyzeMaterialSheet, distillMaterial, encodeMaterialExemplar, paintMaterialAtlas, scoreMaterial } from "@keel-engine/materials";

const analysis = analyzeMaterialSheet(sheet);            // what the sheet is, which rules fired, and why
const { exemplar, fidelity } = distillMaterial(sheet, {  // the author names what each block depicts
  names: ["bark", "foliage", "autumn", "snow"],
  blocks: analysis.blocks,
  columns: analysis.columns,
  plan: analysis.plan,                                   // the rulebook's plan, as is or overruled
});
const bytes = encodeMaterialExemplar(exemplar);          // a .kmx: tens of KB instead of the PNG
const atlas = paintMaterialAtlas({ exemplar, seed: 42 }); // a new sheet, same look
scoreMaterial(sheet, atlas.art, { ...exemplar, families: exemplar.families.map((f) => f.name) }).pass;
```

## The rulebook

Converting an exact object is not guesswork. `analyzeMaterialSheet` measures
evidence and runs the rules in [`src/rules.ts`](src/rules.ts); each rule says
when it applies, what it decides and why, and the analysis reports which fired
on what numbers. The evidence settles the technique. The author settles only
what it can't: what each block depicts, and whether they want it reproduced,
varied, or new pieces in its style.

| Rule | When | Decides |
| --- | --- | --- |
| `sprite-sheet` | over 5% transparent | exact colour and alpha by mode, no light layer, no dither |
| `pixel-art-source` | rebuilds from a coarse grid (pixel art scaled up) | that grid, by mode, the artist's palette, no dither |
| `painted-source` | anything else | 24 art pixels a cell, area mean, finished as pixel art (16..32 colours, bayer4 at 0.35, lone pixels cleaned) |
| `separable-light` | painted, smooth light varies over 6% | albedo + a light layer (a sample every 4 pixels), composited by multiply |
| `staggered-plates` | gaps cut cell columns at staggered heights | restack whole plates (bark, planks, brick) |
| `framed-cells` | cell rims over 25% darker | whole cells move; never quilt through one |
| `open-texture` | no frames, no plates | cells, then quilt 40% along the darkest seam |
| `banded-light` | light changes down the block over 25% | cells stay in their row, plates within one; colour and light move together |
| `two-hues` | cells' row-detrended chroma splits over 12 | lean 20% of cells to the other hue; albedo keeps 32+ colours |

Distilling also mends block edges a neighbour bled into (a stray row of snow
under the leaves would travel as a dash), divides the albedo by the light it
will actually be multiplied by, and keeps the fewest colours that pass the
strict fidelity limits.

## Exemplars (`.kmx`, `KMX2`)

A family is a set of layers (`palette`: indices into an RGBA palette; `scalar`:
a coarse grid read bilinearly), a `compose` list of blends (`base`,
`multiply`, `screen`, `add`, `over`), a `recipe` of moves (`strips`, `cells`,
`quilt`, `lean`, `paint`, each on named layers), and an optional `finish`
(palette, `none`/`bayer2`/`bayer4`/`bayer8` dither, amount, clean). Moves keep
layers together unless a step names them, so a cell's highlight never parts
from its leaf. Variance 0 rebuilds the exemplar exactly.

## The gauntlet

`scoreMaterial` reads both sheets at art resolution, block by block: the
average cell, the palette's quantiles, edge, fine and coarse contrast, spread
within cells and spread between them. `GAUNTLET_LIMITS` allow a variant to be
crisper than a painted source, never blurrier; `FIDELITY_LIMITS` are the
strict ones distilling must meet at variance 0.
