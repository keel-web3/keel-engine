import {sha256,toHex} from '@keel-engine/codec/hash';
import {ObservationPhase,PROGRESSION_LIMITS,type ObservationCursor} from './types.ts';
export const digest=(value:unknown)=>toHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
export const textId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
export const hashId=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const integer=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=lo&&v<=hi;
export function ensure(ok:unknown,message:string):asserts ok {if(!ok)throw new Error(`Pinball progression: ${message}`);}
export function record(v:unknown,keys:readonly string[],label:string):Record<string,unknown>{ensure(v!==null&&typeof v==='object'&&!Array.isArray(v),label);const p=Object.getPrototypeOf(v);ensure(p===Object.prototype||p===null,label);const r=v as Record<string,unknown>;ensure(Object.keys(r).sort().join(',')===[...keys].sort().join(','),`${label} fields`);return r;}
export function array(v:unknown,max:number,label:string):readonly unknown[]{ensure(Array.isArray(v)&&v.length<=max,label);for(let i=0;i<v.length;i++)ensure(Object.hasOwn(v,i),`${label} sparse`);return v;}
export function ids(v:unknown,max:number,label:string,nonempty=true):readonly string[]{const a=array(v,max,label);ensure(!nonempty||a.length>0,label);ensure(a.every(textId)&&new Set(a).size===a.length,`${label} ids`);return [...a] as string[];}
export function clone<T>(v:T):T{return JSON.parse(JSON.stringify(v)) as T;}
export function frozen<T>(v:T):T{if(v!==null&&typeof v==='object'){for(const q of Object.values(v))frozen(q);Object.freeze(v);}return v;}
export function cursor(v:unknown):ObservationCursor {const r=record(v,['tick','phase','nativeOrdinal','serial'],'cursor');ensure(integer(r.tick,0,PROGRESSION_LIMITS.tick)&&integer(r.phase,0,3)&&integer(r.serial,0,PROGRESSION_LIMITS.observationsPerTick-1),'cursor range');ensure(r.phase===ObservationPhase.NATIVE?integer(r.nativeOrdinal,0,PROGRESSION_LIMITS.observationsPerTick-1):r.nativeOrdinal===null,'native ordinal/phase');return {tick:r.tick,phase:r.phase as 0|1|2|3,nativeOrdinal:r.nativeOrdinal as number|null,serial:r.serial};}
export function compareObservationCursors(a:ObservationCursor,b:ObservationCursor):number{return a.tick-b.tick||a.phase-b.phase||(a.nativeOrdinal??-1)-(b.nativeOrdinal??-1)||a.serial-b.serial;}
export const endCursor=(tick:number):ObservationCursor=>({tick,phase:ObservationPhase.SEPARATION,nativeOrdinal:null,serial:PROGRESSION_LIMITS.observationsPerTick-1});
