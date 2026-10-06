/** Cartridge-friendly, lossless 256-byte frames. No heap or history is needed by
 * the C decoder. A clip may XOR one independent anchor, never a dependency chain.
 * Bytes: mode 0 raw, 1 PackBits, 2 literal/fill/copy/zero commands. */
export const RETRO_CODEC_VERSION=1;
export interface RetroClip {data:Uint8Array;offsets:Uint16Array;bases:Uint16Array;frames:number;views:number}
function packRuns(f:Uint8Array):Uint8Array {
 const o:number[]=[];let at=0;
 const run=(i:number)=>{let n=1;while(n<128&&i+n<f.length&&f[i+n]===f[i])n++;return n;};
 while(at<f.length){const n=run(at);if(n>=3){o.push(128|(n-1),f[at]!);at+=n;}else{const s=at;at+=n;while(at<f.length&&at-s<128&&run(at)<3)at+=Math.min(run(at),128-(at-s));o.push(at-s-1,...f.subarray(s,at));}}
 return Uint8Array.from(o);
}
function packCopies(f:Uint8Array):Uint8Array {
 // Dynamic programming selects a shortest command stream. Ties prefer a fill
 // or zero, then the closest copy, to minimize work in the tiny decoder.
 const previous=new Int16Array(256),last=new Int16Array(256).fill(-1);
 for(let i=0;i<256;i++){previous[i]=last[f[i]!]!;last[f[i]!]=i;}
 const cost=new Uint16Array(257),kind=new Uint8Array(256),len=new Uint8Array(256),dist=new Uint8Array(256);
 for(let at=255;at>=0;at--){let best=65535;
  const pick=(k:number,n:number,d:number,c:number)=>{const v=c+cost[at+n]!;if(v<best){best=v;kind[at]=k;len[at]=n;dist[at]=d;}};
  let run=1;while(run<66&&at+run<256&&f[at+run]===f[at])run++;
  if(f[at]===0)for(let n=1;n<=Math.min(run,64);n++)pick(3,n,0,1);
  for(let n=3;n<=run;n++)pick(1,n,0,2);
  let longest=2;
  for(let before=previous[at]!;before>=0&&longest<66;before=previous[before]!){const d=at-before;let n=1;while(n<66&&at+n<256&&f[at+n]===f[at+n-d])n++;if(n>longest){for(let k=longest+1;k<=n;k++)pick(2,k,d-1,2);longest=n;}}
  for(let n=1;n<=64&&at+n<=256;n++)pick(0,n,0,n+1);
  cost[at]=best;
 }
 const o:number[]=[];for(let at=0;at<256;){const k=kind[at]!,n=len[at]!;o.push(k*64+(k===1||k===2?n-3:n-1));if(k===0)o.push(...f.subarray(at,at+n));else if(k===1)o.push(f[at]!);else if(k===2)o.push(dist[at]!);at+=n;}return Uint8Array.from(o);
}
export function encodeRetroFrame(frame:Uint8Array):Uint8Array {
 if(frame.length!==256)throw new Error('retro frame must contain 256 bytes');
 const runs=packRuns(frame),copies=packCopies(frame);let mode=0,bytes=frame;
 if(runs.length<bytes.length){mode=1;bytes=runs;}if(copies.length<bytes.length){mode=2;bytes=copies;}
 return Uint8Array.from([mode,...bytes]);
}
export function decodeRetroFrame(packet:Uint8Array):Uint8Array {
 const o=new Uint8Array(256);if(!packet.length)throw new Error('missing retro mode');
 const mode=packet[0];if(mode===0){if(packet.length!==257)throw new Error('invalid raw frame');o.set(packet.subarray(1));return o;}if(mode!==1&&mode!==2)throw new Error('unsupported retro mode');
 let at=1,w=0;
 while(at<packet.length){const c=packet[at++]!;let n:number,k:number;
  if(mode===1){k=c&128?1:0;n=(c&127)+1;}else{k=c>>6;n=(c&63)+(k===1||k===2?3:1);}
  if(w+n>256)throw new Error('retro frame overflow');
  if(k===0){if(at+n>packet.length)throw new Error('truncated literal');o.set(packet.subarray(at,at+n),w);at+=n;w+=n;}
  else if(k===3){o.fill(0,w,w+n);w+=n;}
  else{if(at>=packet.length)throw new Error('truncated command');const v=packet[at++]!;if(k===1){o.fill(v,w,w+n);w+=n;}else{const d=v+1;if(d>w)throw new Error('invalid back reference');while(n--) {o[w]=o[w-d]!;w++;}}}
 }
 if(w!==256)throw new Error('incomplete retro frame');return o;
}
export function encodeRetroClip(frames:readonly Uint8Array[],views:number,anchorPhases=4):RetroClip {
 if(!Number.isInteger(views)||views<1||views>16||!frames.length||frames.length%views||frames.length>256)throw new Error('invalid retro clip dimensions');
 if(!Number.isInteger(anchorPhases)||anchorPhases<1||anchorPhases>16)throw new Error('invalid anchor interval');
 const packets:Uint8Array[]=[],bases=new Uint16Array(frames.length).fill(65535),offsets=[0];
 for(const [i,f] of frames.entries()){
  let p=encodeRetroFrame(f);const base=Math.floor(i/(views*anchorPhases))*views*anchorPhases+i%views;
  if(i!==base){const delta=Uint8Array.from(f,(v,n)=>v^frames[base]![n]!),d=encodeRetroFrame(delta);if(d.length+12<p.length){p=d;bases[i]=base;}}
  packets.push(p);offsets.push(offsets.at(-1)!+p.length);
 }
 if(offsets.at(-1)!>65535)throw new Error('retro clip exceeds bank address range');
 return {data:Uint8Array.from(packets.flatMap(p=>[...p])),offsets:Uint16Array.from(offsets),bases,frames:frames.length,views};
}
export function decodeRetroClipFrame(c:RetroClip,frame:number):Uint8Array {
 if(!Number.isInteger(frame)||frame<0||frame>=c.frames||c.offsets.length!==c.frames+1||c.bases.length!==c.frames)throw new Error('invalid retro frame index');
 const read=(i:number)=>{const a=c.offsets[i]!,b=c.offsets[i+1]!;if(a>=b||b>c.data.length)throw new Error('invalid retro offsets');return decodeRetroFrame(c.data.subarray(a,b));};
 const o=read(frame),b=c.bases[frame]!;if(b!==65535){if(b>=c.frames||b===frame||c.bases[b]!==65535)throw new Error('chained retro dependency');const anchor=read(b);for(let i=0;i<256;i++)o[i]!^=anchor[i]!;}return o;
}
/** A complete independently cacheable phase, with palette, shade attributes and
 * a per-view directory. At most 4,188 bytes for sixteen incompressible views.
 * Wire: 'KT', version, views, RGB555[4], shade masks[views], offsets[views+1], frames. */
export interface RetroAsset {palette:readonly number[];shadeMasks:Uint16Array;frames:readonly Uint8Array[]}
export function encodeRetroAsset(asset:RetroAsset):Uint8Array {
 const views=asset.frames.length;if(views!==8&&views!==16)throw new Error('asset requires eight or sixteen views');
 if(asset.palette.length!==4||asset.palette.some(v=>!Number.isInteger(v)||v<0||v>32767)||asset.shadeMasks.length!==views)throw new Error('invalid retro palette or masks');
 const packets=asset.frames.map(encodeRetroFrame),head=14+views*4,size=head+packets.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size),d=new DataView(out.buffer);
 out.set([75,84,RETRO_CODEC_VERSION,views]);asset.palette.forEach((p,i)=>d.setUint16(4+i*2,p,true));asset.shadeMasks.forEach((p,i)=>d.setUint16(12+i*2,p,true));
 let at=head;packets.forEach((p,i)=>{d.setUint16(12+views*2+i*2,at,true);out.set(p,at);at+=p.length;});d.setUint16(12+views*2+views*2,at,true);return out;
}
export function decodeRetroAssetFrame(bytes:Uint8Array,view:number):{palette:number[];shadeMask:number;tiles:Uint8Array} {
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),views=bytes[3]!;
 if(bytes.length<14+views*4||bytes[0]!==75||bytes[1]!==84||bytes[2]!==RETRO_CODEC_VERSION||(views!==8&&views!==16)||!Number.isInteger(view)||view<0||view>=views)throw new Error('invalid retro asset');
 const table=12+views*2,head=14+views*4;let last=head;
 for(let i=0;i<=views;i++){const at=d.getUint16(table+i*2,true);if((i===0?at!==head:at<=last)||at>bytes.length)throw new Error('invalid asset offsets');if(i===views&&at!==bytes.length)throw new Error('trailing retro asset');last=at;}
 const a=d.getUint16(table+view*2,true),b=d.getUint16(table+view*2+2,true);
 const palette=Array.from({length:4},(_,i)=>d.getUint16(4+i*2,true));if(palette.some(p=>p>32767))throw new Error('invalid RGB555');
 return {palette,shadeMask:d.getUint16(12+view*2,true),tiles:decodeRetroFrame(bytes.subarray(a,b))};
}
