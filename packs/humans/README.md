# `packs/humans` (`@keel-engine/humans`)

A person and the catalogue's anthro animals, one file each. Module
`packs/humans@1.0.0` (`kind: "pack"`), needs `keel/runtime@^0.1`,
`keel/entity@^0.1`; **provides** `body/humanoid@1.0.0`; **compatible**
`["packs/cloth@^1"]`. No attributes of its own.

| file | entity | surfaced choices | `size` pin (height, m) |
| --- | --- | --- | --- |
| `src/entities/human.ts` | `human` | hair, top, hood, pants, shoes, pack, accessory, height, head, legs, arms, girth, stride, eyes | 1.5..1.95 |
| `src/entities/anthro-cat.ts` | `anthro-cat` | ears, earSize, coat, tail, snout + eyes, outfit, build | 0.85..1.15 |
| `src/entities/anthro-fox.ts` | `anthro-fox` | earSize, coat, tail, snout + ... | 0.89..1.21 |
| `src/entities/anthro-bunny.ts` | `anthro-bunny` | ears, earSize, coat, tail, snout + ... | 0.81..1.09 |
| `src/entities/anthro-bear.ts` | `anthro-bear` | earSize, coat, tail, snout + ... | 0.95..1.29 |
| `src/entities/anthro-mouse.ts` | `anthro-mouse` | earSize, coat, tail, snout + ... | 0.73..0.99 |
| `src/entities/anthro-frog.ts` | `anthro-frog` | coat + ... | 0.73..0.99 |
| `src/entities/anthro-dog.ts` | `anthro-dog` | ears, earSize, coat, tail, snout + ... | 0.88..1.2 |

("outfit" = top, hood, pants, shoes, pack, accessory; "build" = height, head,
legs, arms, girth, stride.) `src/species.ts` wraps keel/entity's
`speciesEntity`: only surfaced choices pin, plus `seed`, `size` and the three
colours. Anthro sizes are the species' `ANTHRO_H` x 0.85..1.15.

Shape and look (keel/entity's `groupsFor`): the outfit's COVERAGE -- `top`,
`pants`, `shoes` -- and the `coat` are look choices: they only move roles
between parts (a tee's forearms are bare, a jacket's are cloth), so one baked
body wears them all. Hair, hood, pack, accessory, ears, tail, snout and the
build are shape choices. Look roles, in order: a person `cloth, clothAlt, fur
(skin), hair, accent, furAlt, dark, blush`; an anthro `cloth, fur, clothAlt,
furAlt, accent, hair, dark, blush`.

Compatibility: as `packs/animals` -- a handshake with `packs/cloth`, not an
open door (see its README).

Tests: `node --test packs/humans/test/*.test.ts` -- 100 seeds per character
on `body/humanoid@1.0.0` with every required socket; surfaced options pin,
sizes pin in range, foreign pins throw; manifest contents; the bundle.
