import type {PinballGraphicsQuality} from './index.ts';
const ORDER=['low','balanced','high','ultra'] as const;
export interface PinballGraphicsGovernorOptions {
 readonly initial:PinballGraphicsQuality;
 /** Automatic changes are allowed only when the consumer enables this. */
 readonly automatic:boolean;
 readonly targetFrameMs?:number;
}
export interface PinballGraphicsTiming {
 readonly quality:PinballGraphicsQuality;readonly samples:number;readonly p95Ms:number|null;
 readonly changed:null|{readonly from:PinballGraphicsQuality;readonly to:PinballGraphicsQuality;readonly reason:'frame-budget'|'sustained-headroom'};
}
/** Observe actual active frame intervals, not capped physics deltas or hidden
 * browser waits. This changes presentation only. Recovery never exceeds the
 * initial admitted quality. A capability plan alone is not a timing sample. */
export function createPinballGraphicsGovernor(options:PinballGraphicsGovernorOptions){
 if(!options||typeof options!=='object'||Array.isArray(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options))||Reflect.ownKeys(options).some(k=>typeof k!=='string'||!['initial','automatic','targetFrameMs'].includes(k)||!('value' in Object.getOwnPropertyDescriptor(options,k)!)))throw new Error('Invalid graphics timing options');
 const maximum=ORDER.indexOf(options.initial),target=options.targetFrameMs??1000/60,automatic=options.automatic;
 if(maximum<0||typeof automatic!=='boolean'||!Number.isFinite(target)||target<4||target>100)throw new Error('Invalid graphics timing governor');
 let current=maximum,warmup=30,samples:number[]=[],last:number|null=null,slow=0,fast=0,cooldown=0;
 function reset(){warmup=30;samples=[];last=null;slow=0;fast=0;cooldown=0;}
 function observe(deltaMs:number,active=true):PinballGraphicsTiming {
  if(typeof active!=='boolean')throw new Error('Invalid graphics frame activity');
  let changed:PinballGraphicsTiming['changed']=null;
  if(!active){reset();return Object.freeze({quality:ORDER[current]!,samples:0,p95Ms:null,changed});}
  // A long foreground stall is evidence of missed frames, not a fatal input
  // error. Hidden/waking intervals were already discarded above.
  if(!Number.isFinite(deltaMs)||deltaMs<=0)throw new Error('Invalid graphics frame timing');
  if(warmup>0){warmup--;return Object.freeze({quality:ORDER[current]!,samples:0,p95Ms:null,changed});}
  samples.push(deltaMs);if(cooldown>0)cooldown--;
  if(samples.length===60){
   const sorted=[...samples].sort((a,b)=>a-b);last=sorted[Math.ceil(.95*sorted.length)-1]!;samples=[];
   slow=last>target*1.4?slow+1:0;fast=last<target*.72?fast+1:0;
   if(automatic&&cooldown===0&&(slow>=2&&current>0||fast>=6&&current<maximum)){
    const from=ORDER[current]!;current+=slow>=2?-1:1;changed=Object.freeze({from,to:ORDER[current]!,reason:slow>=2?'frame-budget':'sustained-headroom'});slow=0;fast=0;cooldown=360;warmup=30;
   }
  }
  return Object.freeze({quality:ORDER[current]!,samples:samples.length,p95Ms:last,changed});
 }
 return Object.freeze({observe,reset,get quality(){return ORDER[current]!;}});
}
