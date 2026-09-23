import { test } from "node:test";
import assert from "node:assert/strict";
import { createBloomPass } from "../src/bloom.ts";

test("disabled bloom and empty emission perform no WebGL work or shader compilation", () => {
  const gl = new Proxy({}, { get() { assert.fail("Disabled bloom touched WebGL"); } }) as WebGL2RenderingContext;
  const bloom = createBloomPass(gl, () => { assert.fail("Disabled bloom compiled a shader"); });
  const texture = {} as WebGLTexture;
  for (const rows of [[], [undefined], [new Float32Array(128)], [Float32Array.from([1, 1, 1, .001])]]) bloom.draw(texture, texture, rows, 640, 360, 5);
  for (const reach of [0, -1]) bloom.draw(texture, texture, [Float32Array.from([1, 1, 1, 1])], 640, 360, reach);
});
