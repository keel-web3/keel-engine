import type {BrowserDevices,ConsoleSession,UsbDevice} from './transport.mjs';
import type {CartInfo} from './cbu1.mjs';
export function prepareCartridge(options:{nav:BrowserDevices;session:ConsoleSession;bridge:UsbDevice;onSession?:(session:ConsoleSession)=>void;onStage?:(stage:string)=>void;onDisconnect?:()=>void;onProgress?:(progress:{received:number;total:number|null;phase:string;cached?:boolean})=>void}):Promise<CartInfo>;
