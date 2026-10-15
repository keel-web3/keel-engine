import type {UsbDevice} from './transport.mjs';
export const ENGINE_URL:string;
export const ENGINE_SHA256:string;
export interface SramImage {data:Uint8Array;checksum:number;idcode:number}
export function fetchEngine():Promise<SramImage>;
export function checkEngine(bytes:Uint8Array):Promise<SramImage>;
export function parseSram(text:string):SramImage;
export function loadSram(device:UsbDevice,image:SramImage,onProgress?:(n:number,total:number)=>void):Promise<{status:number}>;
