# @keel-engine/decal

Pictures and words people put on things, stored on-chain as a small doc a registry contract
validates. Text is stored as **glyph codes in the KEEL alphabet** — never free bytes — so every
string a contract accepts is one the engine can draw, the same everywhere, with no lookalike tricks.

```ts
import { textDecal, decodeDecal, rasterize, STYLE } from "@keel/game-engine/decal";

const { bytes, text, dropped } = textDecal("Volt Fuel ♡", { inks, style: STYLE.plate | STYLE.outline });
// text: "VOLT FUEL ♥", dropped: []  -- bytes are the KDCL doc a DecalRegistry stores
const texels = rasterize(decodeDecal(bytes), { scale: 2 });   // bake decal texels: ink, tone, lit, 255
carDecals(car, { extra: [{ decal: texels, inks: decodeDecal(bytes).inks, panels: ["doorL", "doorR"] }] });
```

- **The alphabet**: 64 codes — space, A–Z, 0–9, `.,!?-+&':/#$%@*()"=_<>;`, ♥ ★ ⚡ and a line break;
  a 5×7 and a 3×5 pixel font. `toGlyphs` converts typed text (NFKD, accents stripped, upper-cased,
  typographic punctuation folded) and lists anything it had to drop.
- **KDCL v1**: a four-ink pixel image (≤ 96×64, 4-bit texels) or styled text (font, plate / outline /
  shadow / slant, ≤ 4 lines of ≤ 24 glyphs), each with its own OKLCH inks. `checkDoc` is exactly the
  contract's validation.
- **Rasterize**: to the texel layout keel/bake's decal row and packs/vehicles' painted decals share;
  `imageTexels` turns an RGBA picture into an image doc's texels (Bayer alpha, nearest ink in OKLab).
