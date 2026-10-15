# Chromatic Wi-Fi bridge — development preview

This is a game-link transport and a bounded device connectivity check. It is not a wireless cartridge installer, firmware updater, or a finished multiplayer release.

The helper runs on the same computer as the browser and forwards only six-byte CWL2 packets to a selected private IPv4 address on UDP 47820. The Chromatic must already run Shiny Relay with Wi-Fi and nearby link enabled, on the same reachable network. A firmware version string or Wi-Fi association alone does not prove that its link endpoint responds.

## Run

With Bun 1.3.14 or newer installed: `bun helper/main.mjs` (or add `--egress`). Open the private launch link printed in the terminal. It stays on the selected game's own site. Enter the device address reported under Device health, then choose **Check Wi-Fi response**. The check sends one HELLO_PROBE and closes after a HELLO reply or five seconds. It never resets the device or transfers a game byte.

For macOS 13 or newer on Apple Silicon, download the signed and notarized app from [GitHub Releases](https://github.com/Ravonus/chromatic-helper/releases). Extract the ZIP, open Chromatic Helper, then choose Open CRUCIBLE or Open EGRESS. Keep its window open; closing it stops the helper. The app embeds its runtime, so Terminal and Bun are not required. Other platforms can run the source with Bun and stop with Ctrl+C. The earlier unsigned command-line download had an invalid embedded signature and is superseded by this release.

The launch token is generated on each run, carried in a URL fragment, removed from the page URL, and used only to authenticate the loopback WebSocket. Do not share the launch link. The helper binds only 127.0.0.1, checks the Host and exact EGRESS/CRUCIBLE Origin, allows one page at a time, and accepts neither USB/console commands nor arbitrary network payloads. Traffic remains on the local network. CWL2 itself is unauthenticated and unencrypted; the token protects the local helper, not the radio link. Use a trusted local network.

## What is implemented

- `src/client.mjs`: browser helper connection and a finite, cancellable Wi-Fi probe. Helper readiness and device response are different states.
- `src/peer.mjs`: WASM wrapper around the unmodified Shiny Relay CWL2 core, with bounded event queues, retries and authoritative slave acknowledgements.
- `src/service.mjs`: byte adapter for a cartridge acting as link master and the existing Crucible authenticated `/cable` gateway. The caller must authenticate the gateway with the exact ROM hash, token and room before `setReady(true)`. This adapter does not invent a new game protocol, replace the gateway, or supply player credentials.
- `helper/server.mjs`: local WebSocket ↔ UDP bridge with origin, token, size, rate, target and timeout checks.

## What is not implemented or verified

The public games are not yet wired to this game-service adapter or to CWL2 multiplayer rooms. A HELLO reply is only a device protocol response, never gameplay proof. The physical device tested on 2026-10-15 did not answer its single Wi-Fi probe in its then-current temporary cartridge-engine state; no reset was attempted.

Shiny Relay 1.0.2 does not expose the USB console/JTAG cartridge-management interface over Wi-Fi. Cable-free management needs a new authenticated firmware endpoint and a separately validated installation/recovery path. A USB-connected host could instead proxy management, but that is a separate transport, not enabled by this helper. Do not send USB commands to the game's UDP port.

Browser WASM cannot open arbitrary UDP sockets; it uses the host browser's APIs. That is why this implementation keeps only the UDP socket in the helper and the portable protocol in WASM. A future authenticated browser-compatible firmware endpoint could remove the helper for supported operations.

## Build and test

- `sh build.sh` — Emscripten 6.0.5, builds `dist/cwl.mjs` and `dist/cwl.wasm`.
- `node --test test/peer.test.mjs test/client.test.mjs`
- `bun test test/helper.test.mjs`
- `bun build helper/main.mjs --compile --outfile dist/chromatic-wifi`

Tests use the real CWL2 core and local UDP/WebSocket sockets; they do not establish physical gameplay acceptance. The service-adapter test checks serial byte delivery, not live service authentication or game semantics.

## Source and license

The CWL2 core, WASM wrapper and service adapter are GPL-3.0-only. The independently written helper, packet validation and browser transport are MIT; they do not link the GPL core. Bun runtime notices are in LICENSES/Bun.md. The complete corresponding source, build scripts and license accompany the downloads. `upstream/cwl_proto.c` and `.h` are unmodified copies from Shiny Relay 1.0.2:
https://install.shinyrelay.com/download/shiny-relay-src-1.0.2.tar.gz

The upstream protocol specification is included as `upstream/PROTOCOL.md`. Modifications are the WASM host wrapper, JavaScript adapters, helper, UI integration and tests. No firmware image or user device data is bundled. See SOURCE.json for exact upstream-file hashes.

## Mac release gate

`macos/build-app.sh OUTPUT SOURCE_REVISION` builds the native AppKit launcher and bundled helper. `python3 macos/release-macos.py APP OUTPUT` requires a Developer ID Application identity and Apple notary credentials, signs nested code with hardened runtime, verifies signatures, submits to Apple, staples the accepted ticket and requires Gatekeeper acceptance before creating the distribution ZIP. Credentials come from the local keychain/environment and never belong in this repository. The runtime uses only the JIT entitlement. Every public release must include source on GitHub, the exact source revision, hashes, build instructions and license notices. Test the packaged artifact, not only an unsigned development binary.
