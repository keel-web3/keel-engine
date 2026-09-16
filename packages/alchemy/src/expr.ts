// The formulas a program may carry: code, but only this code. An expression
// is JSON -- a number, a variable, or an operator applied to expressions --
// over the variables its contract names, with a small set of operators that
// are pure arithmetic (no trig, no pow: every engine computes these the same,
// bit for bit, so a run that uses them replays anywhere). Its size is bounded
// by the program's tier; a division by zero is zero; nothing loops.
//
//   3                                    a number
//   ["var", "count.fire"]                a variable (the contract's)
//   ["mul", 0.2, ["var", "count.water"]] an operator: add sub mul div min max clamp neg abs floor step
//
// (Sim code: no Math.sin and friends; Math.floor/min/max/abs are exact.)

export type Expr = number | readonly ["var", string] | readonly [Op, ...Expr[]];
export const OPS = ["add", "sub", "mul", "div", "min", "max", "clamp", "neg", "abs", "floor", "step"] as const;
export type Op = (typeof OPS)[number];
const ARITY: Readonly<Record<Op, readonly [number, number]>> = {
  add: [2, 6], sub: [2, 2], mul: [2, 6], div: [2, 2], min: [2, 6], max: [2, 6], clamp: [3, 3], neg: [1, 1], abs: [1, 1], floor: [1, 1], step: [2, 2],
};

/** The biggest magnitude anything evaluates to (and any number a program carries). */
export const LIMIT = 1e6;
/** Numbers are kept to four decimals: what an AI wrote as 0.30000000004 is 0.3 -- and hashes the same. */
export const tidy = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  const c = v > LIMIT ? LIMIT : v < -LIMIT ? -LIMIT : v;
  return Math.round(c * 1e4) / 1e4;
};

export interface ExprCheck { readonly expr: Expr; readonly nodes: number; readonly depth: number; readonly problems: readonly string[] }

/**
 * Reads what an AI (or anyone) wrote as an expression and returns it cleaned: unknown variables and operators become
 * 0, arities are fixed, numbers tidied, and anything over `maxNodes` nodes or `maxDepth` deep is cut to 0 there.
 */
export function checkExpr(raw: unknown, vars: ReadonlySet<string>, maxNodes = 32, maxDepth = 6): ExprCheck {
  const problems: string[] = [];
  let nodes = 0;
  let deepest = 0;
  const walk = (x: unknown, depth: number): Expr => {
    nodes += 1;
    if (depth > deepest) deepest = depth;
    if (nodes > maxNodes) { problems.push("too many nodes"); return 0; }
    if (depth > maxDepth) { problems.push("too deep"); return 0; }
    if (typeof x === "number") return tidy(x);
    if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return tidy(Number(x));
    if (!Array.isArray(x) || x.length === 0) { problems.push(`not an expression: ${JSON.stringify(x)?.slice(0, 40)}`); return 0; }
    const [head, ...rest] = x as unknown[];
    if (head === "var") {
      const name = String(rest[0] ?? "");
      if (!vars.has(name)) { problems.push(`unknown variable ${name}`); return 0; }
      return ["var", name] as const;
    }
    if (!(OPS as readonly string[]).includes(String(head))) { problems.push(`unknown operator ${String(head)}`); return 0; }
    const op = head as Op;
    const [lo, hi] = ARITY[op];
    const args = rest.slice(0, hi).map((a) => walk(a, depth + 1));
    while (args.length < lo) args.push(op === "mul" || op === "div" ? 1 : 0);
    return [op, ...args] as const;
  };
  const expr = walk(raw, 1);
  return { expr, nodes, depth: deepest, problems };
}

/** Evaluates a (checked) expression over the variables' values. Pure arithmetic; the same everywhere. */
export function evalExpr(e: Expr, vars: Readonly<Record<string, number>>): number {
  if (typeof e === "number") return e;
  if (e[0] === "var") return vars[e[1] as string] ?? 0;
  const op = e[0] as Op;
  const a = (e.slice(1) as Expr[]).map((x) => evalExpr(x, vars));
  let v: number;
  switch (op) {
    case "add": v = a.reduce((p, q) => p + q, 0); break;
    case "sub": v = a[0]! - a[1]!; break;
    case "mul": v = a.reduce((p, q) => p * q, 1); break;
    case "div": v = a[1] === 0 ? 0 : a[0]! / a[1]!; break;
    case "min": v = Math.min(...a); break;
    case "max": v = Math.max(...a); break;
    case "clamp": v = a[0]! < a[1]! ? a[1]! : a[0]! > a[2]! ? a[2]! : a[0]!; break;
    case "neg": v = -a[0]!; break;
    case "abs": v = Math.abs(a[0]!); break;
    case "floor": v = Math.floor(a[0]!); break;
    case "step": v = a[0]! >= a[1]! ? 1 : 0; break;
    default: v = 0;
  }
  return Number.isFinite(v) ? (v > LIMIT ? LIMIT : v < -LIMIT ? -LIMIT : v) : 0;
}

/** The variables an expression reads. */
export function exprVars(e: Expr, out: Set<string> = new Set()): Set<string> {
  if (typeof e === "number") return out;
  if (e[0] === "var") { out.add(e[1] as string); return out; }
  for (const x of e.slice(1) as Expr[]) exprVars(x, out);
  return out;
}

/** `neutral + k * (e - neutral)`: an expression pulled toward doing nothing, by k (0..1). */
export const scaleToward = (e: Expr, neutral: number, k: number): Expr => {
  if (typeof e === "number") return tidy(neutral + k * (e - neutral));
  return ["add", tidy(neutral), ["mul", tidy(k), ["sub", e, tidy(neutral)]]] as const;
};
