# `@keel-engine/capture`

Getting pictures out of a running project: a still, a video, a GIF. Module
`keel/capture@0.1.0` (`kind: "runtime"`, needs `keel/core@^0.1` — its GIF
encoder, loaded on first use). It is **optional**: no game needs it, the
renderer knows nothing about it, and a KEEL bundle only carries it if its
entry imports it.

```ts
import { createCapture } from "@keel-engine/capture";
const cap = createCapture(canvas, { renderer: px, step: (dt) => sim.simulate(dt), draw });

await cap.png();                          // the canvas now, exact pixels
await cap.video({ seconds: 20 });         // WebM of what plays, as it plays
await cap.film({ seconds: 20, fps: 30 }); // WebM stepped frame by frame: a seed films the same clip every time
await cap.gif({ seconds: 8, fps: 25 });   // GIF, encoder loaded on first use; refuses more than 255 colours
await cap.save(blob, "out/clip.webm");    // PUT to the dev server (scripts/serve.mjs writes into out/), or a download
```

A game's picture is whatever it draws: any palette size, any number of
materials, full frame rate. GIF is one export format among others — the
art-piece format NOCTURNES is built around — not a limit on anything.

- **Video is blown up** with nearest-neighbour before it is encoded (up to 8x,
  to about 1080 px): video codecs halve colour resolution, which smears pixel
  art at its native size. Pass `scale: 1` to record the canvas as it is.
- **film** and **gif** step the game themselves: pause the page's own loop
  while they run.
- **gif** builds its colour table from the colours the clip actually uses (or
  a `palette` you pass, first). Past 255 colours it throws rather than
  posterising: film it instead.

A TypeScript port of the proof of concept's `src/capture/capture.js`, names
unchanged; its pure parts are exported on their own. Tested in Node on
browser stand-ins (`test/browser-stand-in.ts`: canvases, MediaRecorder,
OffscreenCanvas, requestAnimationFrame, fetch, downloads), and — where the
proof of concept is on the machine — its capture driven the same way: the
same browser calls and the same blobs for png, film, video and save, and GIF
bytes identical over 80 clips (sizes, colour counts, palettes, loop, the 2D
copy path, the >255-colour refusal).

| Export | Signature | Returns |
| --- | --- | --- |
| `createCapture` | `(canvas, { renderer?, step?, draw? })` | `Capture` |
| `flipRows` | `(rgba, width, height)` | bottom-row-first (GL) as top-row-first, `Uint8ClampedArray` |
| `videoScale` | `(width, height, scale = null)` | the video blow-up: `scale`, else `clamp(floor(1080 / long side), 1, 8)` |
| `pickMime` | `(type, supported)` | `type` if supported, else VP9, VP8, WebM; `undefined` for none |
| `gifIndexer` | `(palette = null)` | `{ colours, index(rgba, pixels) }`: the growing table; throws past 255 |

| Type | What |
| --- | --- |
| `Capture` | `png()`, `video(VideoOptions)`, `film(VideoOptions)`, `gif(GifOptions)`, `save(blob, path, { put })` |
| `CaptureOptions` | `{ renderer?: PixelSource, step?(dt), draw?() }` — without a renderer, pixels come through a 2D copy |
| `PixelSource` | `{ read(): Uint8Array }` RGBA bottom row first (`@keel-engine/render`'s renderer is one) |
| `VideoOptions` | `{ seconds = 10, fps (video 60, film 30), type = null, scale = null }` |
| `GifOptions` | `{ seconds = 8, fps = 25, palette = null, loop = 0 }` |
