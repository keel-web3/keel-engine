import { test } from "node:test";
import assert from "node:assert/strict";
import { linkProgram } from "../src/link-program.ts";

function fakeGL(options: { vertexOK?: boolean; fragmentOK?: boolean; linkOK?: boolean; noShaderAt?: number; noProgram?: boolean; emptyShaderLog?: boolean } = {}) {
  const calls: string[] = [];
  const shaders: { type: number; source: string }[] = [];
  const program = {};
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader(type: number) {
      calls.push(`createShader:${type}`);
      if (options.noShaderAt === shaders.length) return null;
      const shader = { type, source: "" };
      shaders.push(shader);
      return shader;
    },
    shaderSource(shader: { source: string }, source: string) { calls.push("shaderSource"); shader.source = source; },
    compileShader(shader: { type: number }) { calls.push(`compileShader:${shader.type}`); },
    createProgram() { calls.push("createProgram"); return options.noProgram ? null : program; },
    attachShader(_program: object, shader: { type: number }) { calls.push(`attachShader:${shader.type}`); },
    linkProgram() { calls.push("linkProgram"); },
    getProgramParameter(_program: object, parameter: number) {
      assert.equal(parameter, 4);
      calls.push("linkStatus");
      return options.linkOK ?? true;
    },
    getShaderParameter(shader: { type: number }, parameter: number) {
      assert.equal(parameter, 3);
      calls.push(`compileStatus:${shader.type}`);
      return shader.type === 1 ? (options.vertexOK ?? true) : (options.fragmentOK ?? true);
    },
    getShaderInfoLog(shader: { type: number }) { calls.push(`shaderLog:${shader.type}`); return options.emptyShaderLog ? "" : shader.type === 1 ? "vertex error" : "fragment error"; },
    getProgramInfoLog() { calls.push("programLog"); return "link error"; },
    detachShader(_program: object, shader: { type: number }) { calls.push(`detachShader:${shader.type}`); },
    deleteShader(shader: { type: number }) { calls.push(`deleteShader:${shader.type}`); },
    deleteProgram() { calls.push("deleteProgram"); },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, calls, shaders, program };
}

test("both shaders compile before link; success checks only link and releases shader handles", () => {
  const { gl, calls, shaders, program } = fakeGL();
  assert.equal(linkProgram(gl, "vertex source", "fragment source"), program);
  assert.deepEqual(shaders.map((s) => s.source), ["vertex source", "fragment source"]);
  assert.deepEqual(calls, [
    "createShader:1", "shaderSource", "compileShader:1",
    "createShader:2", "shaderSource", "compileShader:2",
    "createProgram", "attachShader:1", "attachShader:2", "linkProgram", "linkStatus",
    "detachShader:1", "detachShader:2", "deleteShader:1", "deleteShader:2",
  ]);
  assert.equal(calls.filter((call) => call.startsWith("compileStatus")).length, 0);
});

test("failed shader is diagnosed only after failed link, then all handles are released", () => {
  const { gl, calls } = fakeGL({ vertexOK: false, linkOK: false });
  assert.throws(() => linkProgram(gl, "v", "f", "Test"), /Test: vertex error/);
  assert.ok(calls.indexOf("linkStatus") < calls.indexOf("compileStatus:1"));
  assert.deepEqual(calls.filter((call) => call.startsWith("compileStatus")), ["compileStatus:1", "compileStatus:2"]);
  assert.deepEqual(calls.slice(-5), ["detachShader:1", "detachShader:2", "deleteShader:1", "deleteShader:2", "deleteProgram"]);
});

test("program link failure with valid shaders reports its log and releases all handles", () => {
  const { gl, calls } = fakeGL({ linkOK: false });
  assert.throws(() => linkProgram(gl, "v", "f", "Sky"), /Sky: link error/);
  assert.ok(calls.includes("programLog"));
  assert.equal(calls.at(-1), "deleteProgram");
});

test("an empty failed-shader log still names the compile failure", () => {
  const { gl, calls } = fakeGL({ fragmentOK: false, linkOK: false, emptyShaderLog: true });
  assert.throws(() => linkProgram(gl, "v", "f", "Sky"), /^Error: Sky: shader compile failed$/);
  assert.ok(calls.includes("shaderLog:2"));
  assert.equal(calls.at(-1), "deleteProgram");
});

test("allocation failures release only handles actually created", () => {
  const missingShader = fakeGL({ noShaderAt: 1 });
  assert.throws(() => linkProgram(missingShader.gl, "v", "f"), /shader allocation failed/);
  assert.deepEqual(missingShader.calls.slice(-1), ["deleteShader:1"]);
  assert.ok(!missingShader.calls.includes("createProgram"));

  const missingProgram = fakeGL({ noProgram: true });
  assert.throws(() => linkProgram(missingProgram.gl, "v", "f"), /program allocation failed/);
  assert.deepEqual(missingProgram.calls.slice(-2), ["deleteShader:1", "deleteShader:2"]);
});
