// Scripts: what the editor's Scratch-like blocks save to. Two forms of one
// program, each with its schema:
//
//   BLOCKS    the block tree the editor shows: handlers ("when the game
//             starts", "every tick", "when I receive hit") holding statements
//             (set, change, if/else, repeat, while, wait, do an action, send a
//             message, stop) over typed expressions (numbers, text, flags,
//             variables, arithmetic, comparisons, logic, random, sensing).
//   BYTECODE  a flat stack-machine op list per handler, structured (an IF says
//             how long its branch is, a WHILE how long its test and body) so
//             it turns back into the same tree -- compileScript and
//             decompileScript are exact inverses -- and a small VM runs it.
//
// Actions and senses are names the host answers ("move", "play",
// "distance"): the op set stays small and typed, the game supplies the verbs.
// The VM is deterministic: a fixed instruction budget per thread per step,
// random() from the host's seeded stream, waits in simulation seconds.

import { alt, array, bool, dyn, enumOf, named, num, optional, recursive, ref, string, struct, union, varuint } from "../schema.ts";
import type { Infer, Json, Type } from "../schema.ts";

// ---------------------------------------------------------------- the block tree

export const EVENTS = ["start", "tick", "message", "touch", "key", "timer", "hit", "near"] as const;
export const ARITH = ["+", "-", "*", "/", "%", "min", "max"] as const;
export const COMPARE = ["<", "<=", "==", "!=", ">=", ">"] as const;
export const LOGIC = ["and", "or"] as const;

export type Expr =
  | { readonly op: "num"; readonly value: number }
  | { readonly op: "flag"; readonly value: boolean }
  | { readonly op: "text"; readonly value: string }
  | { readonly op: "var"; readonly name: string }
  | { readonly op: "arith"; readonly fn: (typeof ARITH)[number]; readonly a: Expr; readonly b: Expr }
  | { readonly op: "compare"; readonly fn: (typeof COMPARE)[number]; readonly a: Expr; readonly b: Expr }
  | { readonly op: "logic"; readonly fn: (typeof LOGIC)[number]; readonly a: Expr; readonly b: Expr }
  | { readonly op: "not"; readonly a: Expr }
  | { readonly op: "random"; readonly lo: Expr; readonly hi: Expr }
  | { readonly op: "sense"; readonly name: string; readonly args: readonly Expr[] };
export type Stmt =
  | { readonly op: "set"; readonly name: string; readonly value: Expr }
  | { readonly op: "change"; readonly name: string; readonly by: Expr }
  | { readonly op: "if"; readonly cond: Expr; readonly then: readonly Stmt[]; readonly else: readonly Stmt[] }
  | { readonly op: "repeat"; readonly times: Expr; readonly body: readonly Stmt[] }
  | { readonly op: "while"; readonly cond: Expr; readonly body: readonly Stmt[] }
  | { readonly op: "wait"; readonly seconds: Expr }
  | { readonly op: "do"; readonly action: string; readonly args: readonly Expr[] }
  | { readonly op: "send"; readonly message: string }
  | { readonly op: "stop" };
export interface Handler { readonly on: string; readonly arg?: string | number; readonly body: readonly Stmt[] }
export interface Script { readonly name: string; readonly vars: readonly { readonly name: string; readonly init: Json }[]; readonly handlers: readonly Handler[] }

export const EXPR: Type<Expr> = recursive<Expr>((e) => union("op", {
  num: struct({ value: num() }),
  flag: struct({ value: bool() }),
  text: struct({ value: ref("text") }),
  var: struct({ name: ref("vars") }),
  arith: struct({ fn: enumOf(ARITH, { capacity: 16 }), a: e, b: e }),
  compare: struct({ fn: enumOf(COMPARE, { capacity: 8 }), a: e, b: e }),
  logic: struct({ fn: enumOf(LOGIC, { capacity: 4 }), a: e, b: e }),
  not: struct({ a: e }),
  random: struct({ lo: e, hi: e }),
  sense: struct({ name: ref("names"), args: array(e, { max: 7 }) }),
}, { capacity: 16 }) as unknown as Type<Expr>);

export const STMT: Type<Stmt> = recursive<Stmt>((s) => union("op", {
  set: struct({ name: ref("vars"), value: EXPR }),
  change: struct({ name: ref("vars"), by: EXPR }),
  if: struct({ cond: EXPR, then: array(s), else: array(s) }),
  repeat: struct({ times: EXPR, body: array(s) }),
  while: struct({ cond: EXPR, body: array(s) }),
  wait: struct({ seconds: EXPR }),
  do: struct({ action: ref("names"), args: array(EXPR, { max: 7 }) }),
  send: struct({ message: ref("text") }),
  stop: struct({}),
}, { capacity: 16 }) as unknown as Type<Stmt>);

const EVENT = enumOf(EVENTS, { capacity: 16, other: true });
const VARS = array(struct({ name: ref("vars"), init: dyn() }));

/** The block tree (what the editor saves). */
export const BLOCKS = named("keel/script/blocks", struct({
  name: string(),
  vars: VARS,
  handlers: array(struct({ on: EVENT, arg: optional(alt([ref("text"), num()])), body: array(STMT) })),
}, { open: true }), { doc: "A script as blocks: handlers of statements over typed expressions." });

// ---------------------------------------------------------------- the bytecode

/** Every op, by its 6-bit code (append only). */
export const OPS = [
  "num", "true", "false", "text", "load", "store", "change",
  "+", "-", "*", "/", "%", "min", "max", "<", "<=", "==", "!=", ">=", ">", "and", "or", "not", "random",
  "sense", "do", "send", "wait", "if", "ifelse", "else", "repeat", "while", "stop",
] as const;
export type OpName = (typeof OPS)[number];

/** One instruction: an op and its immediates (a number, a text or name, a variable's index, a branch length). */
export type Instr =
  | { readonly op: "num"; readonly v: number }
  | { readonly op: "text" | "send"; readonly s: string }
  | { readonly op: "load" | "store" | "change"; readonly i: number }
  | { readonly op: "sense" | "do"; readonly s: string; readonly argc: number }
  | { readonly op: "if" | "ifelse" | "else" | "repeat"; readonly n: number }
  | { readonly op: "while"; readonly c: number; readonly n: number }
  | { readonly op: Exclude<OpName, "num" | "text" | "send" | "load" | "store" | "change" | "sense" | "do" | "if" | "ifelse" | "else" | "repeat" | "while"> };

const bare = struct({});
const variants: Record<string, ReturnType<typeof struct>> = {};
for (const op of OPS) variants[op] = bare;
Object.assign(variants, {
  num: struct({ v: num() }), text: struct({ s: ref("text") }), send: struct({ s: ref("text") }),
  load: struct({ i: varuint() }), store: struct({ i: varuint() }), change: struct({ i: varuint() }),
  sense: struct({ s: ref("names"), argc: varuint() }), do: struct({ s: ref("names"), argc: varuint() }),
  if: struct({ n: varuint({ k: 2 }) }), ifelse: struct({ n: varuint({ k: 2 }) }), else: struct({ n: varuint({ k: 2 }) }), repeat: struct({ n: varuint({ k: 2 }) }),
  while: struct({ c: varuint({ k: 1 }), n: varuint({ k: 2 }) }),
});
export const INSTR = union("op", variants, { capacity: 64 }) as unknown as Type<Instr>;

/** A compiled script: variables by index, each handler's op list. */
export const BYTECODE = named("keel/script/bytecode", struct({
  name: string(),
  vars: VARS,
  handlers: array(struct({ on: EVENT, arg: optional(alt([ref("text"), num()])), code: array(INSTR) })),
}, { open: true }), { doc: "A script compiled: a stack machine's ops per handler (6-bit opcodes, typed immediates)." });

export type Blocks = Infer<typeof BLOCKS>;
export type Bytecode = Infer<typeof BYTECODE>;

// ---------------------------------------------------------------- compile / decompile

/** Blocks to bytecode (checks every variable is declared). */
export function compileScript(script: Script): Bytecode {
  const index = new Map(script.vars.map((v, i) => [v.name, i]));
  const varOf = (name: string): number => {
    const i = index.get(name);
    if (i === undefined) throw new RangeError(`Script ${script.name}: no variable called ${name} (declare it in vars).`);
    return i;
  };
  const expr = (x: Expr, out: Instr[]): void => {
    switch (x.op) {
      case "num": out.push({ op: "num", v: x.value }); return;
      case "flag": out.push({ op: x.value ? "true" : "false" }); return;
      case "text": out.push({ op: "text", s: x.value }); return;
      case "var": out.push({ op: "load", i: varOf(x.name) }); return;
      case "arith": case "compare": case "logic": expr(x.a, out); expr(x.b, out); out.push({ op: x.fn } as Instr); return;
      case "not": expr(x.a, out); out.push({ op: "not" }); return;
      case "random": expr(x.lo, out); expr(x.hi, out); out.push({ op: "random" }); return;
      case "sense": for (const a of x.args) expr(a, out); out.push({ op: "sense", s: x.name, argc: x.args.length }); return;
    }
  };
  const block = (list: readonly Stmt[]): Instr[] => { const out: Instr[] = []; for (const s of list) stmt(s, out); return out; };
  const stmt = (s: Stmt, out: Instr[]): void => {
    switch (s.op) {
      case "set": expr(s.value, out); out.push({ op: "store", i: varOf(s.name) }); return;
      case "change": expr(s.by, out); out.push({ op: "change", i: varOf(s.name) }); return;
      case "if": {
        expr(s.cond, out);
        const then = block(s.then);
        // ("ifelse": an else follows the then-block -- so a skipped if never mistakes an outer if's else for its own.)
        if (s.else.length) { const els = block(s.else); out.push({ op: "ifelse", n: then.length }, ...then, { op: "else", n: els.length }, ...els); }
        else out.push({ op: "if", n: then.length }, ...then);
        return;
      }
      case "repeat": { expr(s.times, out); const body = block(s.body); out.push({ op: "repeat", n: body.length }, ...body); return; }
      case "while": { const cond: Instr[] = []; expr(s.cond, cond); const body = block(s.body); out.push({ op: "while", c: cond.length, n: body.length }, ...cond, ...body); return; }
      case "wait": expr(s.seconds, out); out.push({ op: "wait" }); return;
      case "do": for (const a of s.args) expr(a, out); out.push({ op: "do", s: s.action, argc: s.args.length }); return;
      case "send": out.push({ op: "send", s: s.message }); return;
      case "stop": out.push({ op: "stop" }); return;
    }
  };
  return {
    name: script.name,
    vars: script.vars.map((v) => ({ name: v.name, init: v.init })),
    handlers: script.handlers.map((h) => ({ on: h.on, ...(h.arg !== undefined ? { arg: h.arg } : {}), code: block(h.body) })),
  };
}

const BINARY: Readonly<Record<string, "arith" | "compare" | "logic">> = Object.fromEntries([...ARITH.map((f) => [f, "arith"]), ...COMPARE.map((f) => [f, "compare"]), ...LOGIC.map((f) => [f, "logic"])]);

/** Bytecode back to blocks: the exact inverse of compileScript (and a check that the code is well formed). */
export function decompileScript(code: Bytecode): Script {
  const names = code.vars.map((v) => v.name);
  const nameOf = (i: number): string => names[i] ?? (() => { throw new RangeError(`Variable #${i} doesn't exist.`); })();
  const block = (list: readonly Instr[], from: number, to: number, where: string): Stmt[] => {
    const out: Stmt[] = [];
    const stack: Expr[] = [];
    const pop = (at: number): Expr => stack.pop() ?? (() => { throw new RangeError(`${where}: op ${at} (${list[at]!.op}) takes a value the code never pushed.`); })();
    const popN = (n: number, at: number): Expr[] => { const a: Expr[] = []; for (let k = 0; k < n; k += 1) a.unshift(pop(at)); return a; };
    const flat = (at: number): void => { if (stack.length) throw new RangeError(`${where}: ${stack.length} value(s) left over before op ${at} (${list[at]?.op ?? "end"}).`); };
    let pc = from;
    while (pc < to) {
      const x = list[pc]!;
      const at = pc;
      pc += 1;
      switch (x.op) {
        case "num": stack.push({ op: "num", value: x.v }); break;
        case "true": case "false": stack.push({ op: "flag", value: x.op === "true" }); break;
        case "text": stack.push({ op: "text", value: x.s }); break;
        case "load": stack.push({ op: "var", name: nameOf(x.i) }); break;
        case "not": stack.push({ op: "not", a: pop(at) }); break;
        case "random": { const hi = pop(at); const lo = pop(at); stack.push({ op: "random", lo, hi }); break; }
        case "sense": stack.push({ op: "sense", name: x.s, args: popN(x.argc, at) }); break;
        case "store": out.push({ op: "set", name: nameOf(x.i), value: pop(at) }); flat(pc); break;
        case "change": out.push({ op: "change", name: nameOf(x.i), by: pop(at) }); flat(pc); break;
        case "wait": out.push({ op: "wait", seconds: pop(at) }); flat(pc); break;
        case "do": out.push({ op: "do", action: x.s, args: popN(x.argc, at) }); flat(pc); break;
        case "send": flat(at); out.push({ op: "send", message: x.s }); break;
        case "stop": flat(at); out.push({ op: "stop" }); break;
        case "if": case "ifelse": {
          const cond = pop(at);
          flat(pc);
          if (pc + x.n > to) throw new RangeError(`${where}: the if at ${at} runs past its block.`);
          const then = block(list, pc, pc + x.n, where);
          pc += x.n;
          let els: Stmt[] = [];
          if (x.op === "ifelse") {
            const next = list[pc];
            if (pc >= to || next?.op !== "else") throw new RangeError(`${where}: the ifelse at ${at} has no else after its then-block.`);
            if (pc + 1 + next.n > to) throw new RangeError(`${where}: the else at ${pc} runs past its block.`);
            els = block(list, pc + 1, pc + 1 + next.n, where);
            if (!els.length) throw new RangeError(`${where}: an empty else at ${pc} (not canonical: use if).`);
            pc += 1 + next.n;
          }
          out.push({ op: "if", cond, then, else: els });
          break;
        }
        case "else": throw new RangeError(`${where}: an else at ${at} with no if before it.`);
        case "repeat": {
          const times = pop(at);
          flat(pc);
          if (pc + x.n > to) throw new RangeError(`${where}: the repeat at ${at} runs past its block.`);
          out.push({ op: "repeat", times, body: block(list, pc, pc + x.n, where) });
          pc += x.n;
          break;
        }
        case "while": {
          flat(at);
          if (pc + x.c + x.n > to) throw new RangeError(`${where}: the while at ${at} runs past its block.`);
          const test = exprOf(list, pc, pc + x.c, where);
          out.push({ op: "while", cond: test, body: block(list, pc + x.c, pc + x.c + x.n, where) });
          pc += x.c + x.n;
          break;
        }
        default: {
          const kind = BINARY[x.op];
          if (!kind) throw new RangeError(`${where}: unknown op ${x.op}.`);
          const b = pop(at); const a = pop(at);
          stack.push({ op: kind, fn: x.op, a, b } as Expr);
        }
      }
    }
    flat(to);
    return out;
  };
  // (A while's test: ops that leave exactly one value.)
  const exprOf = (list: readonly Instr[], from: number, to: number, where: string): Expr => {
    const fake: Instr[] = [...list.slice(from, to), { op: "wait" }];
    const s = block(fake, 0, fake.length, where);
    const w = s[0];
    if (s.length !== 1 || w?.op !== "wait") throw new RangeError(`${where}: a while's test must leave one value.`);
    return w.seconds;
  };
  return {
    name: code.name,
    vars: code.vars.map((v) => ({ name: v.name, init: v.init })),
    handlers: code.handlers.map((h, k) => ({ on: h.on, ...(h.arg !== undefined ? { arg: h.arg } : {}), body: block(h.code, 0, h.code.length, `handler ${k} (${h.on})`) })),
  };
}

// ---------------------------------------------------------------- the VM

/** What a script runs against: the game's verbs and senses, and a seeded random. */
export interface ScriptHost {
  act(name: string, args: readonly Json[]): void;
  sense(name: string, args: readonly Json[]): Json;
  /** A seeded draw in [0, 1) (never Math.random: runs are replayed). */
  random(): number;
}
interface Thread { h: number; pc: number; stack: Json[]; loops: { kind: "repeat" | "while"; start: number; body: number; end: number; left: number }[]; sleep: number }

/** A running script: fire events, step it on the fixed step. Deterministic. */
export interface ScriptVM {
  readonly vars: Json[];
  /** Start the handlers for an event (arg: a message's text, a key...). */
  fire(event: string, arg?: string | number): void;
  /** Run every thread until it waits, stops or spends `budget` ops; sleeping ones count `dt` down. */
  step(dt: number, budget?: number): void;
  readonly threads: number;
}

export function createScriptVM(code: Bytecode, host: ScriptHost): ScriptVM {
  const vars: Json[] = code.vars.map((v) => structuredClone(v.init) as Json);
  const threads: Thread[] = [];
  const fire = (event: string, arg?: string | number): void => {
    code.handlers.forEach((h, k) => { if (h.on === event && (h.arg === undefined || h.arg === arg)) threads.push({ h: k, pc: 0, stack: [], loops: [], sleep: 0 }); });
  };
  const n = (v: Json): number => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0);
  const truthy = (v: Json): boolean => (typeof v === "number" ? v !== 0 : Boolean(v));
  const run = (t: Thread, budget: number): boolean => {
    const ops = code.handlers[t.h]!.code;
    for (let spent = 0; spent < budget; spent += 1) {
      const top = t.loops[t.loops.length - 1];
      // A while's test just ran: go in, or leave.
      if (top && top.kind === "while" && t.pc === top.body && top.left === 0) {
        if (!truthy(t.stack.pop() ?? null)) { t.pc = top.end; t.loops.pop(); continue; }
        top.left = 1; // (in the body: don't test again till it comes round)
      }
      // A loop's end: go round again, or leave.
      if (top && t.pc === top.end) {
        if (top.kind === "repeat") { top.left -= 1; if (top.left > 0) { t.pc = top.start; continue; } t.loops.pop(); continue; }
        t.pc = top.start; top.left = 0; continue;
      }
      if (t.pc >= ops.length) return false;
      const x = ops[t.pc]!;
      t.pc += 1;
      const S = t.stack;
      switch (x.op) {
        case "num": S.push(x.v); break;
        case "true": S.push(true); break;
        case "false": S.push(false); break;
        case "text": S.push(x.s); break;
        case "load": S.push(vars[x.i] ?? null); break;
        case "store": vars[x.i] = S.pop() ?? null; break;
        case "change": vars[x.i] = n(vars[x.i] ?? 0) + n(S.pop() ?? 0); break;
        case "not": S.push(!truthy(S.pop() ?? null)); break;
        case "random": { const hi = n(S.pop() ?? 0), lo = n(S.pop() ?? 0); S.push(lo + (hi - lo) * host.random()); break; }
        case "sense": { const args = S.splice(S.length - x.argc, x.argc); S.push(host.sense(x.s, args)); break; }
        case "do": { const args = S.splice(S.length - x.argc, x.argc); host.act(x.s, args); break; }
        case "send": fire("message", x.s); break;
        case "wait": t.sleep = n(S.pop() ?? 0); return true;
        case "stop": return false;
        case "if": if (!truthy(S.pop() ?? null)) t.pc += x.n; break;
        case "ifelse": if (!truthy(S.pop() ?? null)) t.pc += x.n + 1; break;
        case "else": t.pc += x.n; break;
        case "repeat": { const times = Math.floor(n(S.pop() ?? 0)); if (times > 0 && x.n > 0) t.loops.push({ kind: "repeat", start: t.pc, body: t.pc, end: t.pc + x.n, left: times }); else t.pc += x.n; break; }
        case "while": t.loops.push({ kind: "while", start: t.pc, body: t.pc + x.c, end: t.pc + x.c + x.n, left: 0 }); break;
        default: {
          const b = S.pop() ?? null, a = S.pop() ?? null;
          switch (x.op) {
            case "+": S.push(typeof a === "string" || typeof b === "string" ? `${String(a)}${String(b)}` : n(a) + n(b)); break;
            case "-": S.push(n(a) - n(b)); break;
            case "*": S.push(n(a) * n(b)); break;
            case "/": S.push(n(b) === 0 ? 0 : n(a) / n(b)); break;
            case "%": S.push(n(b) === 0 ? 0 : n(a) % n(b)); break;
            case "min": S.push(Math.min(n(a), n(b))); break;
            case "max": S.push(Math.max(n(a), n(b))); break;
            case "<": S.push(n(a) < n(b)); break;
            case "<=": S.push(n(a) <= n(b)); break;
            case "==": S.push(a === b || (typeof a !== "string" && typeof b !== "string" && n(a) === n(b))); break;
            case "!=": S.push(!(a === b || (typeof a !== "string" && typeof b !== "string" && n(a) === n(b)))); break;
            case ">=": S.push(n(a) >= n(b)); break;
            case ">": S.push(n(a) > n(b)); break;
            case "and": S.push(truthy(a) && truthy(b)); break;
            case "or": S.push(truthy(a) || truthy(b)); break;
          }
        }
      }
    }
    return true; // (out of budget: it goes on next step)
  };
  return {
    vars,
    fire,
    step(dt, budget = 10000) {
      const live = threads.splice(0, threads.length);
      const keep: Thread[] = [];
      for (const t of live) {
        if (t.sleep > 0) { t.sleep -= dt; if (t.sleep > 1e-9) { keep.push(t); continue; } t.sleep = 0; }
        if (run(t, budget)) keep.push(t);
      }
      threads.unshift(...keep);
    },
    get threads() { return threads.length; },
  };
}
