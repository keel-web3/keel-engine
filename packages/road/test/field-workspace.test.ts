import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFieldWindowWorkspace,
  fieldWindowSteps,
  roadGraph,
  straight,
} from "../src/index.ts";
import type { FieldWindow, RoadGraph } from "../src/index.ts";

const graph = roadGraph(
  [{ id: 0, x: 0, z: 0 }, { id: 1, x: 40, z: 0 }, { id: 2, x: 40, z: 40 }],
  [
    { a: 0, b: 1, cls: "street", path: straight(0, 0, 40, 0) },
    { a: 1, b: 2, cls: "street", path: straight(40, 0, 40, 40) },
  ],
);

interface Result { readonly yields: number[]; readonly window: FieldWindow }
const drain = (steps: Generator<number, FieldWindow, void>, yields: number[] = []): Result => {
  for (;;) {
    const next = steps.next();
    if (next.done) return { yields, window: next.value };
    yields.push(next.value);
  }
};

const assertSame = (actual: Result, expected: Result): void => {
  assert.deepEqual(actual.yields, expected.yields, "yield sequence");
  assert.deepEqual(actual.window.x0, expected.window.x0);
  assert.deepEqual(actual.window.z0, expected.window.z0);
  assert.deepEqual(actual.window.width, expected.window.width);
  assert.deepEqual(actual.window.height, expected.window.height);
  assert.deepEqual(actual.window.tpm, expected.window.tpm);
  assert.deepEqual(actual.window.data, expected.window.data, "RGBA bytes");
  assert.deepEqual(actual.window.edge, expected.window.edge, "edge ids");
};

const local = (x0: number, z0: number, width: number, height: number): Result =>
  drain(fieldWindowSteps(graph, x0, z0, width, height, 1, 30, 1));
const shared = (workspace: ReturnType<typeof createFieldWindowWorkspace>, x0: number, z0: number, width: number, height: number): Result =>
  drain(fieldWindowSteps(graph, x0, z0, width, height, 1, 30, 1, workspace));

test("workspace reuse preserves bytes and yields while every returned window stays independent", () => {
  const workspace = createFieldWindowWorkspace(512), windows: FieldWindow[] = [];
  for (const [x0, z0, width, height] of [[-8, -8, 24, 20], [4, -4, 13, 9], [0, 0, 32, 32]] as const) {
    const actual = shared(workspace, x0, z0, width, height), expected = local(x0, z0, width, height);
    assertSame(actual, expected);
    windows.push(actual.window);
  }
  assert.notStrictEqual(windows[0]!.data.buffer, windows[1]!.data.buffer);
  assert.notStrictEqual(windows[0]!.edge.buffer, windows[1]!.edge.buffer);
  const second = windows[1]!.data.slice();
  windows[0]!.data[0] = windows[0]!.data[0]! + 1;
  windows[0]!.edge[0] = 12345;
  assert.deepEqual(windows[1]!.data, second, "a later output does not alias an earlier output");
  assert.notEqual(windows[1]!.edge[0], 12345);
  workspace.dispose();
});

test("workspace scratch is one lazy capacity-sized backing store reused across windows", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "ArrayBuffer")!;
  const originalArrayBuffer = globalThis.ArrayBuffer;
  const sizes: number[] = [];
  const countingArrayBuffer = new Proxy(originalArrayBuffer, {
    construct(target, args, newTarget) {
      sizes.push(args[0] as number);
      return Reflect.construct(target, args, newTarget) as ArrayBuffer;
    },
  });
  Object.defineProperty(globalThis, "ArrayBuffer", { ...original, value: countingArrayBuffer });
  try {
    const workspace = createFieldWindowWorkspace(8);
    assert.deepEqual(sizes, [], "scratch backing store is lazy");
    assertSame(shared(workspace, 0, 0, 2, 4), local(0, 0, 2, 4));
    assertSame(shared(workspace, 2, -2, 2, 4), local(2, -2, 2, 4));
    assert.deepEqual(sizes, [8 * 12], "best and seen share one 12-byte-per-cell store");
    workspace.dispose();
  } finally {
    Object.defineProperty(globalThis, "ArrayBuffer", original);
  }
});

test("an interleaved generator falls back safely while the workspace has an active lease", () => {
  const workspace = createFieldWindowWorkspace(1024);
  const a = fieldWindowSteps(graph, -8, -8, 32, 32, 1, 30, 1, workspace);
  const b = fieldWindowSteps(graph, 0, -4, 28, 24, 1, 30, 1, workspace);
  const firstA = a.next(), firstB = b.next();
  assert.equal(firstA.done, false);
  assert.equal(firstB.done, false);
  const resultA = drain(a, [firstA.value]);
  const resultB = drain(b, [firstB.value]);
  assertSame(resultA, local(-8, -8, 32, 32));
  assertSame(resultB, local(0, -4, 28, 24));
  workspace.dispose();
});

test("oversized windows use local scratch and do not prevent a later in-capacity borrow", () => {
  const workspace = createFieldWindowWorkspace(8);
  assertSame(shared(workspace, -4, -4, 4, 4), local(-4, -4, 4, 4));
  assertSame(shared(workspace, 0, -2, 2, 4), local(0, -2, 2, 4));
  workspace.dispose();
});

test("return, injected throw, and dispose leave windows byte-exact and independently owned", () => {
  const workspace = createFieldWindowWorkspace(1024);
  const cancelled = fieldWindowSteps(graph, -8, -8, 32, 32, 1, 30, 1, workspace);
  assert.equal(cancelled.next().done, false);
  assert.equal(cancelled.return(undefined as never).done, true);
  assertSame(shared(workspace, -8, -8, 32, 32), local(-8, -8, 32, 32));

  const edges = [...graph.edges];
  Object.defineProperty(edges, Symbol.iterator, {
    value: function* () { yield edges[0]!; throw new Error("injected edge iteration failure"); },
  });
  const throwingGraph = { ...graph, edges } as unknown as RoadGraph;
  const interrupted = fieldWindowSteps(throwingGraph, -8, -8, 32, 32, 1, 30, 1, workspace);
  assert.equal(interrupted.next().done, false);
  assert.throws(() => interrupted.next(), /injected edge iteration failure/);
  assertSame(shared(workspace, -8, -8, 32, 32), local(-8, -8, 32, 32));

  const disposedDuringUse = fieldWindowSteps(graph, -8, -8, 32, 32, 1, 30, 1, workspace);
  assert.equal(disposedDuringUse.next().done, false);
  workspace.dispose();
  assertSame(shared(workspace, 0, -4, 24, 20), local(0, -4, 24, 20));
  assert.equal(disposedDuringUse.return(undefined as never).done, true);
  workspace.dispose();
  workspace.dispose();
  assertSame(shared(workspace, 0, -4, 24, 20), local(0, -4, 24, 20));
});
