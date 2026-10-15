# @keel-engine/chromatic

Initial shared cartridge metadata and compatible-release selector. Both site previews use identical vendored bytes from this package. No firmware images or third-party protocol code are included.

`inspectRom(Uint8Array)` reads actual/declaration sizes, mapper, RAM and checksums. Those values describe a game's requirements, **not** physical cart capacity.

`selectVariant(capability, variants, writer)` chooses the highest-content validated release supported by the verified physical cartridge. No global 2 MiB limit. It separates addressability, save memory, mapper/peripherals, protected bytes, and writer limits. Protected comparisons are bound to a full range, release SHA and device-connection epoch. Unknown facts fail closed. Every result has `canWrite: false`: selection is never write consent.

Run `node --test test/*.test.mjs`. Tests use synthetic cartridge/ROM fixtures; they do not establish device support.

Pending: documented hardware adapters, simulator transports/fault injection, persistent local library, backup/write executor, validated CRUCIBLE profile builds, save migration and physical-device verification. The public preview labels its example devices and planned builds; it cannot flash hardware.
