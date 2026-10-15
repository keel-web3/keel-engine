# Protocol sources and licenses

`src/bridge.mjs` adapts the GWU2X packet layout and bit alignment from openFPGALoader v1.1.1, Copyright (C) 2024 Gwenhael Goavec-Merou, under Apache-2.0. Changes: browser WebUSB transport, bounded asynchronous reads, read-IDCODE-only command sequence. The Apache license is included at `LICENSES/Apache-2.0.txt`.

- https://github.com/trabucayre/openFPGALoader/blob/v1.1.1/src/gwu2x_jtag.cpp
- https://github.com/trabucayre/openFPGALoader/blob/v1.1.1/src/gowin.cpp

`src/transport.mjs` and `src/cbu1.mjs` independently implement the wire protocol documented in Shiny Relay's published MCU source: `mcu/components/nw/cartflash/cf_usb.h`, `cf_usb.c`, `cf_esp.c`, `mcu/components/cwl/cwl_esp.c`, and `mcu/components/osd/status/fw.c` in shiny-relay-src-1.0.2. Firmware source distribution: https://install.shinyrelay.com/ (release source links). No unlicensed installer JavaScript is copied.

The supplied cart-engine source archive is GPL-3.0, SHA-256 d2b28c95647c479106ca07691924139624226e8f87b78e823a5e1d4b937841e3. No engine bitstream or other third-party firmware image is shipped by this package.

## Temporary cartridge access

`src/sram.mjs` adapts the SRAM-only Gowin/GWU2X sequences from openFPGALoader v1.1.1 (Apache-2.0). The browser retrieves the GPL-3.0 Shiny Relay cart engine directly from its official host with credentials omitted and verifies SHA-256 `6e30f490e9d4702f5a96f63e368afb56802ba7c9e38544428302b8fbd10204ee`. No engine image is redistributed by this package. Corresponding source: https://install.shinyrelay.com/download/shiny-relay-src-cart-engine-c4aebde587b8.tar.gz . Only volatile FPGA SRAM is loaded; no SPI flash access is implemented.
