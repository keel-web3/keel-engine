# Fixed-frame MP4 export

`@keel-engine/capture/offline` is an optional module. Games which do not import it
do not carry the encoder or its pinned Mediabunny dependency.

Call `createFixedFrameEncoder({width, height, fps, frames, audio, signal})`, then
await `addFrame(canvas, index)` for every frame, and call `finish()`. Render the
native game at `index / fps`; timestamps come from that index, never RAF or a
recording clock. An incomplete, concurrent, or cancelled sequence cannot produce
a successful export. Device speed changes export time, not frame count or duration.
Use a separate deterministic scene so export does not pause collector playback.
Use an OffscreenCanvas scene worker when the adapter supports it. Transfer one
ImageBitmap at a time, await addFrame, then close it before requesting the next
frame. Opaque token workers can render even when they lack VideoEncoder; the
verified page then owns native asynchronous WebCodecs.

Scaling is nearest neighbour. Defaults are H.264 High 4.2, a 20 Mbps variable
bitrate target, 2-second keyframes and AAC-LC stereo at 320 kbps. Supply prepared
PCM at the exact scene duration. Standard AAC encoder padding can extend the
container slightly beyond the video duration. Encoder support depends on the
browser, its codecs and secure context; report errors instead of silently
returning WebM or a partial MP4.

The native async codec path also supports secure opaque token frames, whose Blob
workers may lack WebCodecs. No network requests or external encoder service are
required. The caller owns its input canvas; `finish()` returns the MP4 Blob, while
`cancel()` releases incomplete output. A 1080p minute can occupy roughly 150 MB;
release the download URL when the player is disposed.

The MP4 writer reserves ordinary fast-start metadata from the declared packet
counts. Seekable writes use bounded immutable Blob segments, so final assembly
does not allocate or copy a second movie-sized ArrayBuffer. It still retains the
finished movie for playback/download. The frame and audio counts, bitrate and
nearest-neighbour scale remain unchanged.

REDLINE integration verification covered all 3,600 frames at 60 fps, decoded native
scene parity, audible prepared PCM, automatic export, Save MP4 and playback handoff.
Evidence for each published revision belongs beside that revision's source hashes.
