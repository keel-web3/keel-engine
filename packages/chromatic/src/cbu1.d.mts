import type {ConsoleSession} from './transport.mjs';
export interface CartInfo {proto:number;flashBytes:number;writableBytes:number;ramBytes:number;chunk:number;skipblank:boolean;binary:boolean;engine:boolean;cartridgeType:number;romCode:number;ramCode:number;headerValid:boolean;title:string;evidence:string}
export function parseCartInfo(line:string):CartInfo;
export function readCartStatus(session:ConsoleSession):Promise<string>;
export function readCartInfo(session:ConsoleSession):Promise<CartInfo>;
export function readCartRange(session:ConsoleSession,kind:'rom'|'sav',size:number,options?:{skipblank?:boolean;onProgress?:(received:number,total:number)=>void}):Promise<Uint8Array>;
export function verifiedBackup(session:ConsoleSession,info:CartInfo,onProgress?:(progress:{kind:string;pass:number;received:number;total:number})=>void):Promise<{rom:Uint8Array;sav?:Uint8Array}>;
