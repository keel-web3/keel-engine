// @keel-engine/capture: optional stills, video and GIF export. Nothing in a
// game needs it; the GIF encoder (core's) is loaded only when a GIF is asked
// for. Names as in the proof of concept's src/capture.

export { createCapture, flipRows, gifIndexer, pickMime, videoScale } from "./capture.ts";
export type { Capture, CaptureOptions, GifIndexer, GifOptions, PixelSource, VideoOptions } from "./capture.ts";
