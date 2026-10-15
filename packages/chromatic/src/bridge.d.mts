import type {UsbDevice} from './transport.mjs';
export function readBridgeId(device:UsbDevice):Promise<{idcode:number;expected:boolean}>;
