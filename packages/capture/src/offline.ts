import { Output, Mp4OutputFormat, StreamTarget, CanvasSource, AudioSampleSource, AudioSample, Quality, canEncodeVideo, canEncodeAudio } from 'mediabunny';
import { createBlobTarget } from './blob-target.ts';

export interface FixedFrameAudio {
  readonly rate: number;
  readonly channels: readonly Float32Array[];
}
export interface FixedFrameOptions {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly audio?: FixedFrameAudio | null;
  readonly signal?: AbortSignal;
  readonly videoBitrate?: number;
  readonly audioBitrate?: number;
  readonly codecString?: string;
}

/** Media time never depends on RAF, rendering speed or the playback clock. */
export function fixedFrameTiming(index: number, fps: number) {
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isFinite(fps) || fps <= 0 || fps > 240) throw new RangeError('Invalid fixed frame time');
  return { timestamp: index / fps, duration: 1 / fps };
}

/** Optional WebCodecs export. One awaited input frame bounds encoder backpressure. */
export async function createFixedFrameEncoder(options: FixedFrameOptions) {
  const { width, height, fps, frames, audio: sound, signal, videoBitrate = 20_000_000, audioBitrate = 320_000, codecString = 'avc1.64002a' } = options;
  for (const value of [width, height, frames, videoBitrate, audioBitrate]) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Invalid MP4 dimensions, frame count or bitrate');
  if (width % 2 || height % 2) throw new RangeError('H.264 dimensions must be even');
  fixedFrameTiming(0, fps);
  const check = () => { if (signal?.aborted) throw new DOMException('Encoding cancelled', 'AbortError'); };
  check();
  if (sound) {
    const count = sound.channels[0]?.length;
    if (!Number.isInteger(sound.rate) || sound.rate <= 0 || !count || sound.channels.length > 2 || sound.channels.some(c => c.length !== count)) throw new RangeError('Invalid prepared PCM soundtrack');
    if (Math.abs(count / sound.rate - frames / fps) > 1 / fps) throw new RangeError('Soundtrack and fixed frame duration differ');
  }
  if (!await canEncodeVideo('avc', { width, height, bitrate: videoBitrate, frameRate: fps, fullCodecString: codecString, latencyMode: 'realtime' })) throw new Error('This browser cannot encode H.264 MP4');
  if (sound && !await canEncodeAudio('aac', { sampleRate: sound.rate, numberOfChannels: sound.channels.length, bitrate: audioBitrate })) throw new Error('This browser cannot encode the MP4 soundtrack');
  check();
  const file = createBlobTarget();
  const target = new StreamTarget(new WritableStream({ write({ data, position }) { file.write(data, position); } }), { chunked: true, chunkSize: 1024 * 1024 });
  // Packet counts are known, so reserve normal fast-start metadata. No fragmented
  // transport, whole-movie reallocation, or media-sized finalization copy.
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target });
  const canvas = new OffscreenCanvas(width, height), draw = canvas.getContext('2d', { alpha: false });
  if (!draw) throw new Error('MP4 scale canvas is unavailable');
  const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: videoBitrate }), latencyMode: 'realtime', fullCodecString: codecString, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps, maximumPacketCount: frames });
  const audio = sound ? new AudioSampleSource({ codec: 'aac', quality: new Quality({ bitrate: audioBitrate }) }) : null;
  if (audio && sound) output.addAudioTrack(audio, { maximumPacketCount: Math.ceil(sound.channels[0]!.length / 1024) + 32 });
  let count = 0, pending = false, closed = false, audioError: unknown;
  const cancel = async () => { if (!closed) { closed = true; await output.cancel(); file.clear(); } };
  const abort = () => { void cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try { await output.start(); check(); } catch (error) { signal?.removeEventListener('abort', abort); await cancel(); throw error; }
  const audioDone = (async () => {
    if (!sound || !audio) return;
    const length = sound.channels[0]!.length;
    for (let at = 0; at < length; at += 8192) {
      check(); const size = Math.min(8192, length - at), data = new Float32Array(size * sound.channels.length);
      sound.channels.forEach((channel, c) => data.set(channel.subarray(at, at + size), c * size));
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: sound.channels.length, sampleRate: sound.rate, timestamp: at / sound.rate });
      try { await audio.add(sample); } finally { sample.close(); }
    }
    audio.close();
  })().catch(error => { audioError = error; });
  return {
    async addFrame(frame: CanvasImageSource, index: number) {
      check(); if (audioError) throw audioError;
      if (closed || pending || index !== count || count >= frames) throw new Error('MP4 frame sequence is incomplete or concurrent');
      pending = true;
      try { const time = fixedFrameTiming(index, fps); draw.imageSmoothingEnabled = false; draw.drawImage(frame, 0, 0, width, height); await video.add(time.timestamp, time.duration); count++; }
      finally { pending = false; }
    },
    async finish() {
      check(); if (closed || pending || count !== frames) throw new Error('MP4 is missing frames');
      try { video.close(); await audioDone; check(); if (audioError) throw audioError; await output.finalize(); closed = true; const blob = file.finish(); file.clear(); return { blob, frames: count }; }
      catch (error) { await cancel(); throw error; }
      finally { signal?.removeEventListener('abort', abort); }
    },
    async cancel() { signal?.removeEventListener('abort', abort); await cancel(); await audioDone; },
  };
}
