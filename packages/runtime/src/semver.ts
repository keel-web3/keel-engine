// Versions and ranges, the small part of semver modules need: exact versions
// ("1.4.2"), caret ("^1.4"), tilde ("~1.4.2"), comparisons (">=1.2 <2"), "x"
// wildcards ("1.x") and "*". (KEEL pins modules to exact versions; ranges are
// how a pack says which versions of a body contract or another pack it fits.)

export type Version = readonly [number, number, number];

export function parseVersion(text: string): Version {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new TypeError(`"${text}" is not a version (major.minor.patch).`);
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

type Check = (v: Version) => boolean;

function one(part: string): Check {
  const p = part.trim();
  if (p === "*" || p === "" || p === "x") return () => true;
  const op = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(p);
  if (!op) throw new TypeError(`"${part}" is not a version range.`);
  const sign = op[1] ?? "=";
  const body = op[2] ?? "";
  // (Wildcards: "1.x" / "1.2.x" / "1" -- any version under that prefix.)
  const bits = body.split(".");
  const wild = bits.length < 3 || bits.some((b) => b === "x" || b === "*");
  const base = parseVersion(bits.map((b) => (b === "x" || b === "*" ? "0" : b)).join("."));
  const fixed = bits.findIndex((b) => b === "x" || b === "*");
  const depth = fixed < 0 ? bits.length : fixed;
  if (sign === "=" && wild) return (v) => (depth < 1 || v[0] === base[0]) && (depth < 2 || v[1] === base[1]) && (depth < 3 || v[2] === base[2]);
  switch (sign) {
    case "=": return (v) => compare(v, base) === 0;
    case ">": return (v) => compare(v, base) > 0;
    case ">=": return (v) => compare(v, base) >= 0;
    case "<": return (v) => compare(v, base) < 0;
    case "<=": return (v) => compare(v, base) <= 0;
    case "~": return (v) => compare(v, base) >= 0 && v[0] === base[0] && (depth < 2 || v[1] === base[1]);
    case "^": {
      // (^1.2.3 is >=1.2.3 <2; ^0.2.3 is >=0.2.3 <0.3; ^0.0.3 is exactly 0.0.3 -- as npm has it.)
      if (base[0] > 0 || depth < 2) return (v) => compare(v, base) >= 0 && v[0] === base[0];
      if (base[1] > 0 || depth < 3) return (v) => compare(v, base) >= 0 && v[0] === 0 && v[1] === base[1];
      return (v) => compare(v, base) === 0;
    }
    default: throw new TypeError(`"${part}" is not a version range.`);
  }
}

/** Does `version` fall in `range`? Ranges: space-separated parts all hold; "||" separates alternatives. */
export function satisfies(version: string | Version, range: string): boolean {
  const v = typeof version === "string" ? parseVersion(version) : version;
  return range.split("||").some((alt) => alt.trim().split(/\s+(?=[\^~<>=\d*x])/).every((part) => one(part)(v)));
}

/** "name@range" -> { name, range } ("name" alone means any version). */
export function splitRef(ref: string): { name: string; range: string } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { name: ref, range: "*" };
  return { name: ref.slice(0, at), range: ref.slice(at + 1) || "*" };
}
