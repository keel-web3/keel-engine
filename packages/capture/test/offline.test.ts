import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixedFrameEncoder, fixedFrameTiming } from '../src/offline.ts';

test('fixed-frame media time spans exactly one minute despite arbitrary wall-clock delay', () => {
  let duration = 0;
  for (let index = 0; index < 3600; index++) {
    const time = fixedFrameTiming(index, 60);
    assert.equal(time.timestamp, index / 60);
    duration += time.duration;
  }
  assert(Math.abs(duration - 60) < 1e-9);
  assert.equal(fixedFrameTiming(3599, 60).timestamp + 1 / 60, 60);
});

test('invalid frame indices and rate are rejected before encoding', () => {
  for (const index of [-1, .5, NaN, Infinity]) assert.throws(() => fixedFrameTiming(index, 60));
  for (const fps of [0, -1, NaN, Infinity, 241]) assert.throws(() => fixedFrameTiming(0, fps));
});

test('abort and malformed prepared PCM fail before acquiring browser codec resources', async () => {
  const basic = { width: 1920, height: 1080, fps: 60, frames: 3600 };
  const c = new AbortController(); c.abort();
  await assert.rejects(createFixedFrameEncoder({ ...basic, signal: c.signal }), { name: 'AbortError' });
  await assert.rejects(createFixedFrameEncoder({ ...basic, width: 1919 }), /even/);
  await assert.rejects(createFixedFrameEncoder({ ...basic, audio: { rate: 48000, channels: [new Float32Array(48)] } }), /duration/);
  await assert.rejects(createFixedFrameEncoder({ ...basic, audio: { rate: 48000, channels: [new Float32Array(48), new Float32Array(47)] } }), /PCM/);
});
