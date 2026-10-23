const Q=1024;
// Serialized world coordinates stay within0..65535. A completed native tick
// may retain a brief edge crossing, or an eliminated body before escape resets
// it. Conservative allowance covers24 escape units,18 movement units,132
// static-contact units (96 blade +12 rail +24 body) and16 substeps of99
// possible pair corrections of at most24Q+2 per axis. It is deliberately wider
// than ordinary playable space and still rejects signed-int storage extremes.
export const NATIVE_SNAPSHOT_PADDING_Q=(24+18+132)*Q+16*99*(24*Q+2);
export const NATIVE_SNAPSHOT_MIN=-NATIVE_SNAPSHOT_PADDING_Q/Q;
export const NATIVE_SNAPSHOT_MAX=65535+NATIVE_SNAPSHOT_PADDING_Q/Q;
export function nativeStoredCoordinate(value:unknown):value is number {
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=-NATIVE_SNAPSHOT_PADDING_Q&&value<=65535*Q+NATIVE_SNAPSHOT_PADDING_Q;
}
export function nativeEventCoordinate(value:unknown):value is number {
 return typeof value==='number'&&Number.isFinite(value)&&value>=NATIVE_SNAPSHOT_MIN&&value<=NATIVE_SNAPSHOT_MAX;
}
