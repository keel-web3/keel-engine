// The KEEL alphabet: 64 glyph codes, two pixel fonts. On-chain text is stored as these codes,
// never as free bytes -- so every string a contract accepts is one the engine can draw, the
// same everywhere, and nothing hides in a lookalike character. `toGlyphs` converts typed text
// into it (and says what it had to drop).
//
//   0 space · 1-26 A-Z · 27-36 0-9 · 37 . 38 , 39 ! 40 ? 41 - 42 + 43 & 44 ' 45 : 46 / 47 # 48 $
//   49 % 50 @ 51 * 52 ( 53 ) 54 " 55 = 56 _ 57 < 58 > 59 ; 60 heart 61 star 62 bolt 63 line break

export const LINE_BREAK = 63;
export const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-+&':/#$%@*()\"=_<>;♥★⚡\n";

/** Big: 5 x 7, rows top to bottom, bits left to right (16 = leftmost). Index = glyph code. */
export const BIG: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [14, 17, 17, 31, 17, 17, 17], [30, 17, 17, 30, 17, 17, 30], [14, 17, 16, 16, 16, 17, 14], [30, 17, 17, 17, 17, 17, 30], [31, 16, 16, 30, 16, 16, 31],
  [31, 16, 16, 30, 16, 16, 16], [14, 17, 16, 23, 17, 17, 15], [17, 17, 17, 31, 17, 17, 17], [14, 4, 4, 4, 4, 4, 14], [7, 2, 2, 2, 2, 18, 12],
  [17, 18, 20, 24, 20, 18, 17], [16, 16, 16, 16, 16, 16, 31], [17, 27, 21, 21, 17, 17, 17], [17, 17, 25, 21, 19, 17, 17], [14, 17, 17, 17, 17, 17, 14],
  [30, 17, 17, 30, 16, 16, 16], [14, 17, 17, 17, 21, 18, 13], [30, 17, 17, 30, 20, 18, 17], [15, 16, 16, 14, 1, 1, 30], [31, 4, 4, 4, 4, 4, 4],
  [17, 17, 17, 17, 17, 17, 14], [17, 17, 17, 17, 17, 10, 4], [17, 17, 17, 21, 21, 21, 10], [17, 17, 10, 4, 10, 17, 17], [17, 17, 10, 4, 4, 4, 4],
  [31, 1, 2, 4, 8, 16, 31],
  [14, 17, 19, 21, 25, 17, 14], [4, 12, 4, 4, 4, 4, 14], [14, 17, 1, 2, 4, 8, 31], [30, 1, 1, 14, 1, 1, 30], [2, 6, 10, 18, 31, 2, 2],
  [31, 16, 30, 1, 1, 17, 14], [6, 8, 16, 30, 17, 17, 14], [31, 1, 2, 4, 8, 8, 8], [14, 17, 17, 14, 17, 17, 14], [14, 17, 17, 15, 1, 2, 12],
  [0, 0, 0, 0, 0, 12, 12], [0, 0, 0, 0, 12, 4, 8], [4, 4, 4, 4, 4, 0, 4], [14, 17, 1, 2, 4, 0, 4], [0, 0, 0, 31, 0, 0, 0],
  [0, 4, 4, 31, 4, 4, 0], [12, 18, 20, 8, 21, 18, 13], [4, 4, 8, 0, 0, 0, 0], [0, 12, 12, 0, 12, 12, 0], [1, 1, 2, 4, 8, 16, 16],
  [10, 10, 31, 10, 31, 10, 10], [4, 15, 20, 14, 5, 30, 4], [24, 25, 2, 4, 8, 19, 3], [14, 17, 23, 21, 23, 16, 14], [0, 4, 21, 14, 21, 4, 0],
  [2, 4, 8, 8, 8, 4, 2], [8, 4, 2, 2, 2, 4, 8], [10, 10, 0, 0, 0, 0, 0], [0, 0, 31, 0, 31, 0, 0], [0, 0, 0, 0, 0, 0, 31],
  [2, 4, 8, 16, 8, 4, 2], [8, 4, 2, 1, 2, 4, 8], [0, 12, 12, 0, 12, 4, 8], [0, 10, 31, 31, 14, 4, 0], [4, 4, 31, 14, 14, 27, 17],
  [2, 4, 8, 31, 2, 4, 8], [0, 0, 0, 0, 0, 0, 0],
];

/** Small: 3 x 5, bits left to right (4 = leftmost). Index = glyph code. */
export const SMALL: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0],
  [2, 5, 7, 5, 5], [6, 5, 6, 5, 6], [3, 4, 4, 4, 3], [6, 5, 5, 5, 6], [7, 4, 6, 4, 7], [7, 4, 6, 4, 4], [3, 4, 5, 5, 3], [5, 5, 7, 5, 5], [7, 2, 2, 2, 7],
  [1, 1, 1, 5, 2], [5, 5, 6, 5, 5], [4, 4, 4, 4, 7], [5, 7, 7, 5, 5], [6, 5, 5, 5, 5], [2, 5, 5, 5, 2], [6, 5, 6, 4, 4], [2, 5, 5, 6, 3], [6, 5, 6, 5, 5],
  [3, 4, 2, 1, 6], [7, 2, 2, 2, 2], [5, 5, 5, 5, 7], [5, 5, 5, 5, 2], [5, 5, 7, 7, 5], [5, 5, 2, 5, 5], [5, 5, 2, 2, 2], [7, 1, 2, 4, 7],
  [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [6, 1, 2, 4, 7], [6, 1, 2, 1, 6], [5, 5, 7, 1, 1], [7, 4, 6, 1, 6], [3, 4, 7, 5, 7], [7, 1, 2, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 6],
  [0, 0, 0, 0, 2], [0, 0, 0, 2, 4], [2, 2, 2, 0, 2], [6, 1, 2, 0, 2], [0, 0, 7, 0, 0], [0, 2, 7, 2, 0], [2, 5, 2, 5, 3], [2, 2, 0, 0, 0], [0, 2, 0, 2, 0],
  [1, 1, 2, 4, 4], [5, 7, 5, 7, 5], [3, 6, 2, 3, 6], [5, 1, 2, 4, 5], [7, 5, 7, 4, 7], [5, 2, 7, 2, 5], [1, 2, 2, 2, 1], [4, 2, 2, 2, 4], [5, 5, 0, 0, 0],
  [0, 7, 0, 7, 0], [0, 0, 0, 0, 7], [1, 2, 4, 2, 1], [4, 2, 1, 2, 4], [0, 2, 0, 2, 4], [0, 5, 7, 7, 2], [2, 7, 2, 5, 5], [1, 2, 7, 2, 4], [0, 0, 0, 0, 0],
];

export const FONTS = [{ cols: 5, rows: 7, glyphs: BIG }, { cols: 3, rows: 5, glyphs: SMALL }] as const;

// Typed text that means one of ours: typographic punctuation and the usual symbol lookalikes.
const FOLD: Readonly<Record<string, string>> = {
  "‘": "'", "’": "'", "‚": ",", "“": "\"", "”": "\"", "–": "-", "—": "-", "−": "-", "…": "...",
  "♡": "♥", "❤": "♥", "❤️": "♥", "☆": "★", "⭐": "★", "⚡️": "⚡", "\t": " ", "\r": "",
};

export interface Converted {
  readonly glyphs: number[];
  /** The text as it will read, back out of the glyphs. */
  readonly text: string;
  /** Characters that have no glyph and were left out. */
  readonly dropped: string[];
}

/** Typed text in the KEEL alphabet: decomposed and stripped of accents, upper-cased, punctuation folded, the rest dropped (and listed). */
export function toGlyphs(input: string): Converted {
  const glyphs: number[] = [];
  const dropped: string[] = [];
  const src = [...input.normalize("NFKD")].filter((c) => !/\p{M}/u.test(c)).join("");
  for (const raw of src.replace(/❤️|⚡️/gu, (m) => FOLD[m]!)) {
    const folded = FOLD[raw] ?? raw;
    for (const ch of folded.toUpperCase()) {
      const code = CHARSET.indexOf(ch);
      if (code >= 0) glyphs.push(code); else dropped.push(ch);
    }
  }
  return { glyphs, text: fromGlyphs(glyphs), dropped };
}

export const fromGlyphs = (glyphs: readonly number[]): string => glyphs.map((g) => CHARSET[g] ?? "").join("");
