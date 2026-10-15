# @keel-engine/chromatic

One shared implementation, vendored identically into EGRESS and CRUCIBLE. Site adapters supply the existing DialogueBox/cast, header, footer and theme. ActionButton is also used by each homepage. Layout CSS does not define another theme.

## Implemented

- Web Serial and WebUSB choosers invoked synchronously from a user click; previously permitted device discovery, explicit reconnection and disconnect handling. Connected requires a firmware or FPGA response, not merely a browser grant.
- 115200 console with low DTR/RTS, wake newlines before each command, bounded parsing, timeouts, port cleanup and no raw console retention.
- Firmware-reported versions and allowlisted Wi-Fi/relay status. Passwords, pairing codes, device IDs and URLs are discarded. Unsupported commands remain unsupported, never successful fixtures.
- Read-only GWU2X/GW5A IDCODE path, adapted from Apache-2.0 openFPGALoader. USB claim and JTAG response are distinct evidence.
- In-page temporary FPGA preparation: fetch the pinned official engine with no credentials/referrer, verify its SHA-256 and device ID, load only SRAM, require the selected console to disappear, reopen it, then require `engine=1` in cartridge identity. Phase progress and bounded waits replace silent hangs. Power-off restores the installed FPGA image.
- CBU1 cartridge identity and ROM/save backup from the published firmware source. Every frame and full read have CRC checks; two complete device reads must agree. Busy/unfinished operations are not canceled or resumed automatically. Reads may interrupt link sessions.
- Local IndexedDB library; blobs >=4 MiB use OPFS when available. SHA-256 deduplication and storage readback; real import, rename/tags, export and delete. Current site ROM import verifies the exact served size/hash. Damaged cartridge ROM headers can be retained as backups; uploaded ROM headers must validate.
- ROM requirements and compatible release selector. A ROM header never proves physical flash capacity. The general selector has no global 2 MiB limit; the published hardware adapter does.

## Boundaries

This release performs no persistent firmware or cartridge writes. Firmware image dump/identity, rollback/recovery and cartridge install remain unimplemented. Cartridge preparation is implemented here using volatile FPGA SRAM. No third-party firmware image is redistributed; the engine is downloaded from its official CORS-enabled host and pinned by hash. CRUCIBLE smaller recipe editions are not built. Only actual published releases are shown.

CBU1 needs compatible Shiny Relay firmware and a prepared cartridge FPGA engine. The current engine addresses at most 2 MiB and exposes 32 KiB of save access. Returned geometry is labeled firmware-reported; it does not certify arbitrary board/mapper support.

Tests exercise the real transports with simulated browser devices and fault injection. They do not establish physical device compatibility or speed. An owner must approve real browser permission prompts; initial runs read status/IDCODE, with no persistent writes. No physical timing comparison or rollback proof is claimed.

Run `node --test test/*.test.mjs`. Both sites run the same `browser-tests/chromatic.spec.ts` against static exports. Set `CHROMATIC_ENGINE_FILE` to a downloaded official `engine.fs` for deterministic offline browser tests of the preparation path; the production digest check still applies. No analytics or outbound device-data requests are used on `/chromatic/`.

## Capture and input status (2026-10-15)

Both sites now share the Live / OBS view: explicit Chromatic-only video selection, optional matching game audio, full screen/PiP, frame freshness, cancellation and stream cleanup. The permission-discovery action is separately labelled: it briefly opens and immediately closes the browser's default camera/microphone solely to reveal device labels. That temporary stream is never rendered, stored or sent. Media permission, physical footage and working OBS capture are separate from the synthetic browser tests.

`ConsoleSession.beginInput()` is a local prototype, not yet vendored or exposed by the public sites. Its exclusive lease blocks ordinary read operations, accepts only game-button masks (bits 0–7), sends a fixed 80 ms `poke` followed by a firmware response check, never retries input, and rejects overlapping taps. Firmware owns the release timer. Releasing the lease before transmission suppresses the tap. A console response does not prove physical game input. No continuous holds, remote input service or online pairing is implemented. Hardware acceptance remains pending normal gameplay and physical video.
