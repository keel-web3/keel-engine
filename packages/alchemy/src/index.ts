// keel/alchemy -- the element matrix. See contract.ts (what a program may be),
// sheet.ts (laying programs on a hero), matrix.ts (the combinations, cached
// forever) and relay.ts (asking an AI through the technomancy bridge).

export { LIMIT, OPS, checkExpr, evalExpr, exprVars, scaleToward, tidy } from "./expr.ts";
export type { Expr, ExprCheck, Op } from "./expr.ts";
export { defineContract, limitsFor, programHash, readProgram } from "./contract.ts";
export type { Contract, ElementSpec, EventSpec, Limits, Look, Mod, ModOp, Program, Reading, StatSpec, Trigger, VarSpec } from "./contract.ts";
export { createSheet } from "./sheet.ts";
export type { Sheet } from "./sheet.ts";
export { baseEntries, cellKey, createMatrix, entryOf, jsonFromText, loadoutText, memoryStore, promptFor, seededOracle } from "./matrix.ts";
export type { CellRequest, Entry, Matrix, MatrixStore, Oracle } from "./matrix.ts";
export { createRelayQueue, relayOracle } from "./relay.ts";
export type { RelayJob, RelayQueue, RelayResult } from "./relay.ts";
