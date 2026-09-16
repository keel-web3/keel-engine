// @keel-engine/replay: runs that prove themselves. A deterministic simulation
// records its input tape with checksums along the way and a transcript hash
// chain over all of it; a verifier replays the payload from its header and
// derives the result -- or names the first tick the replay left the recording.

export { createHasher, mix32 } from "./hash.ts";
export type { Hasher } from "./hash.ts";
export { createTape, decodeTape, encodeTape, fromBase64url, tapeBytes, toBase64url } from "./tape.ts";
export type { Run, Tape } from "./tape.ts";
export { RUN_FORMAT, canonicalJson, createRecorder, transcriptNext, transcriptStart, verifyRun } from "./run.ts";
export type { Checkpoint, Json, Recorder, RecorderOptions, RunPayload, RunSim, Verdict, VerifyOptions } from "./run.ts";
