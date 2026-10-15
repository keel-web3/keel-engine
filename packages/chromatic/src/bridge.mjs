// SPDX-License-Identifier: Apache-2.0
// GWU2X packet and bit alignment adapted from openFPGALoader v1.1.1.
// Copyright (C) 2024 Gwenhael Goavec-Merou. See THIRD_PARTY.md and LICENSES.
// Only the read-IDCODE path: no configuration, erase, reload or flash commands.
export async function readBridgeId(device) {
  async function transfer(bytes, size = 0) {
    const data = new Uint8Array(bytes), out = await device.transferOut(2, data);
    if (out.status !== 'ok' || out.bytesWritten !== data.length) throw new Error('USB bridge write did not complete.');
    if (!size) return;
    const status = await device.transferIn(3, 4);
    if (status.status !== 'ok' || status.data?.byteLength !== 4) throw new Error('USB bridge did not acknowledge its read.');
    const result = new Uint8Array(size); let offset = 0;
    while (offset < size) {const input = await device.transferIn(1, size - offset); if (input.status !== 'ok' || !input.data?.byteLength || input.data.byteLength > size - offset) throw new Error('USB bridge returned incomplete JTAG data.'); result.set(new Uint8Array(input.data.buffer, input.data.byteOffset, input.data.byteLength), offset); offset += input.data.byteLength;}
    return result;
  }
  let timer;
  try {
    return await Promise.race([(async () => {
      await transfer([0x20, 0x07, 0x02, 0x21, 0, 0, 0xab, 60]); // GPIO; conservative 1 MHz TCK
      await transfer([0x5b, 5, 0x1f]); // reset TAP (5 high), then idle
      await transfer([0x5b, 3, 0x03]); // idle -> shift IR
      await transfer([0x6b, 6, 0x11, 0x5b, 0, 0x01]); // 8-bit READ_IDCODE, exit1
      await transfer([0x5b, 1, 0x01, 0x9b, 5, 0]); // update IR, idle, six clocks
      await transfer([0x5b, 2, 0x01]); // idle -> shift DR
      const low = await transfer([0x7c, 2, 255, 255, 255, 0x8b], 3);
      const high = await transfer([0x6c, 6, 255, 0x5c, 0, 0x81, 0x8b], 1);
      await transfer([0x5b, 1, 0x01]); // update DR -> idle
      const idcode = (low[0] | low[1] << 8 | low[2] << 16 | high[0] << 24) >>> 0;
      if (!idcode || idcode === 0xffffffff) throw new Error('The bridge opened, but the FPGA did not return an IDCODE.');
      return {idcode, expected: idcode === 0x0001281b};
    })(), new Promise((_, reject) => {timer = setTimeout(() => {void device.close().catch(() => {}); reject(new Error('JTAG read timed out. Reconnect the USB bridge.'));}, 8000);})]);
  } finally {clearTimeout(timer);}
}
