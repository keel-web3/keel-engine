# Optional KEEL PPMd tooling

This directory pins `ppmd-rust = 1.4.1` and its registry checksum in Cargo.lock. Upstream is https://github.com/hasenbanck/ppmd-rust/ under CC0-1.0 OR MIT-0; both license texts are included here. The encoder is a build-time tool, not a cartridge runtime dependency.

```sh
cargo build --locked --release --bin keel-ppmd-pack
target/release/keel-ppmd-pack source.bin packed.k7 16 26
```

The encoder finishes without an end marker and independently decodes the exact source length before writing. K7 v1 is four header bytes: `K`, `7`, model order, and log2 workspace bytes, followed by PPMd7H range data. The enclosing KEEL descriptor must commit decoded length and stored/decoded hashes. The browser reader bounds order to 2–16, model to 1–64 MiB, compressed input to 4 MiB and decoded output to 32 MiB. These limits are not claims that a cartridge supports this model.

The decode-only Rust library uses a bounded 104 MiB arena and exported allocate/start/step/reset functions. Generate the SDK's pure JavaScript module with Rust 1.94, Binaryen wasm2js 132 and Terser 5.44.0:

```sh
rustup target add wasm32-unknown-unknown
rustup component add rust-src
RUSTC_BOOTSTRAP=1 RUSTFLAGS="-Zunstable-options -Cpanic=immediate-abort" cargo build --locked --release --lib --target wasm32-unknown-unknown -Z build-std=std,panic_abort
wasm2js target/wasm32-unknown-unknown/release/keel_ppmd.wasm -O4 --all-features -o cooperative.mjs
node /path/to/keel-sdk/scripts/build-ppmd-runtime.mjs cooperative.mjs
```

Check load before these heavy jobs and offload when necessary. Browser tasks own separate arenas, serialize decompression jobs, yield cooperatively and dispose after cancellation or failure. No WebAssembly, Python dependency or runtime network import ships in this profile.
