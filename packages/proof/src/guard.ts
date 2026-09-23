// A source guard for provable code, callable from any repo's test (the engine's
// own sim-math test covers engine packages; a game's provable sim lives in the
// game). Stricter than deterministic math: a provable sim must be reproducible
// by a zkVM guest in another language, so floats are out, not just the
// transcendentals.
//
// It reads no files itself (the engine ships to browsers): the caller passes
// each file's path and text.
//
//   const files = readdirSync(dir).map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));
//   assertProvableSource(files);

/** What a provable file may use from Math: integer-exact operations only. */
const MATH_OK = new Set(["floor", "ceil", "trunc", "min", "max", "abs", "imul", "sign", "clz32"]);

export interface GuardHit { readonly file: string; readonly line: number; readonly text: string; readonly why: string }

// (Patterns as strings: a regex literal holding a block-comment opener confuses simpler scanners, the engine's own guard among them.)
const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
const LINE = new RegExp("//.*$", "gm");
const QUOTED = new RegExp("([\"'`])(?:\\\\.|(?!\\1)[^\\\\\\n])*\\1", "g");
const blank = (m: string): string => m.replace(/[^\n]/g, " ");
const strip = (src: string): string => src.replace(BLOCK, blank).replace(LINE, "").replace(QUOTED, blank);

const RULES: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string | null]> = [
  // (A string, so the engine's own sim-math guard doesn't read this rule as a call.)
  [new RegExp("\\bMath\\.(\\w+)", "g"), (m) => (MATH_OK.has(m[1]!) ? null : `${m[0]} is not integer-exact`)],
  [/\b(Date|performance)\b/g, () => "a clock has no place in a provable sim"],
  [/\b(Float32Array|Float64Array|parseFloat)\b/g, (m) => `${m[1]}: floats don't cross into the guest`],
  [/\b\d+\.\d+(?:e[+-]?\d+)?\b/gi, (m) => `float literal ${m[0]}`],
  [/\*\*/g, () => "** (use an integer loop or a table)"],
  [/@keel-engine\/core|dmath/g, () => "dmath is deterministic but not provable: use integers"],
];

export interface SourceFile { readonly file: string; readonly text: string }

export function scanProvableSource(files: readonly SourceFile[], { allow = {} }: { allow?: Readonly<Record<string, string>> } = {}): GuardHit[] {
  const hits: GuardHit[] = [];
  for (const { file, text: src } of files) {
    if (allow[file]) continue;
    strip(src).split("\n").forEach((text, i) => {
      for (const [re, why] of RULES) {
        for (const m of text.matchAll(re)) {
          const w = why(m);
          if (w) hits.push({ file, line: i + 1, text: text.trim(), why: w });
        }
      }
    });
  }
  return hits;
}

/** Throws listing every violation. `allow` exempts a file by path, with the reason as the value. */
export function assertProvableSource(files: readonly SourceFile[], opts: { allow?: Readonly<Record<string, string>> } = {}): void {
  const hits = scanProvableSource(files, opts);
  if (hits.length) throw new Error(`Not provable:\n${hits.map((h) => `  ${h.file}:${h.line}  ${h.why}\n      ${h.text}`).join("\n")}`);
}
