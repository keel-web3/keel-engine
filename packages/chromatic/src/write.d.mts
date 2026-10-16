import type {ConsoleSession,CartridgeLease} from './transport.mjs';
import type {CartInfo} from './cbu1.mjs';
export interface WriteProgress {phase:string;received:number;total:number}
export interface WritePlan {writeRom:Uint8Array;verifyRom:Uint8Array;save:Uint8Array;header:ReturnType<typeof import('./cartridge.mjs').inspectRom>}
export function planCartridgeWrite(rom:Uint8Array,info:CartInfo,backupRom:Uint8Array|null,save:Uint8Array):WritePlan;
export function cartridgeDataFrame(offset:number,data:Uint8Array,binary:boolean):Uint8Array;
export function streamCartridgeWrite(lease:CartridgeLease,kind:'rom'|'sav',bytes:Uint8Array,options?:{binary?:boolean;onProgress?:(progress:WriteProgress)=>void}):Promise<{sha256:string;crc32:string;deviceVerified:boolean;timings:Record<string,number>}>;
export function writeVerifiedCartridge(session:ConsoleSession,expected:CartInfo,plan:WritePlan,onProgress?:(progress:WriteProgress)=>void):Promise<{romSha256:string;saveSha256:string;verified:boolean;romVerification:'firmware-sha256-crc32'|'browser-sha256';deviceTimings:Record<string,number>}>;
