// SPDX-License-Identifier: MIT
export const packetValid=b=>b instanceof Uint8Array&&b.length===6&&b[0]===67&&b[1]===87&&b[2]===2&&b[3]>=1&&b[3]<=11;
