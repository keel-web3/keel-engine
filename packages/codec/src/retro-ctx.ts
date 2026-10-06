/** keel-retro-ctx v2: lossless 2bpp sprite clips for 8-bit targets at about 40% of keel-retro-v1's size.
 * A clip is one keyframe (keel-retro-v1 packet: random access, fast) and chains of P-frames. A chain is ONE binary
 * arithmetic stream. Per frame it holds 16 changed-tile flags, a shade-mask change and then, in raster order, a
 * changed-row flag for each row of each changed tile. Each pixel of a changed row is predicted by a static context
 * model (13 bits): left, up, up-right and up-left in the frame being decoded, same and right in the previous frame,
 * and whether the row above changed at this column. The model is trained once on a catalogue and ships in ROM
 * (8,200 bytes). v2 replaced v1's previous-left neighbour with up-left plus the row-above-changed bit: about 6%
 * smaller on the 1,146-object catalogue. The coder never
 * multiplies: LPS sizes come from a 16-class x 4-range-bucket table. An SM83 decodes a frame in about 300 pixel
 * decisions, and any byte string decodes without overrunning anything. */
import { decodeRetroFrame,encodeRetroFrame } from './retro.ts';
import { sha256 } from './sha256.ts';
export const RETRO_CTX_VERSION=2;
/** Context table entries (13-bit contexts). */
export const CTX_SIZE=8192;
/** LPS probability per class: .75 down to ~1/1400 in steps of 2^(2/3). */
export const CTX_CLASSES=16;
export const CTX_PLPS=Array.from({length:CTX_CLASSES},(_,c)=>.75*Math.pow(2,-c*2/3));
/** LPS interval size per class and range bucket ((range>>13)&3, range in [0x8000,0xffff]); never multiplies. */
export const CTX_QTAB=Uint16Array.from(CTX_PLPS.flatMap(p=>[0,1,2,3].map(b=>Math.max(1,Math.round(p*(0x8000+b*0x2000+0x1000))))));
/** Class 1 (p = .47) codes the near-even decisions: the last of three ranks and changed shade-mask bits. */
const EVEN=1;
export function ctxClassOf(p:number):number {let best=0,bd=1e9;for(let c=0;c<CTX_CLASSES;c++){const d=Math.abs(Math.log(CTX_PLPS[c]!)-Math.log(Math.max(1e-5,Math.min(.75,p))));if(d<bd){bd=d;best=c;}}return best;}
/** Static model: ctx[CTX_SIZE] = v0 | v1<<2 | class<<4; d2 = class of "second guess wrong"; tile[2], row[4], mask =
 * MPS<<7 | class (tile by the tile's flag in the previous frame; row by (previous row in tile changed)*2 + last row). */
export interface CtxModel {ctx:Uint8Array;d2:number;tile:Uint8Array;row:Uint8Array;mask:number}
export const CTX_MODEL_BYTES=CTX_SIZE+1+2+4+1;
export function encodeCtxModel(m:CtxModel):Uint8Array {const o=new Uint8Array(CTX_MODEL_BYTES),n=CTX_SIZE;o.set(m.ctx);o[n]=m.d2;o.set(m.tile,n+1);o.set(m.row,n+3);o[n+7]=m.mask;return o;}
export function decodeCtxModel(b:Uint8Array):CtxModel {const n=CTX_SIZE;if(b.length!==CTX_MODEL_BYTES)throw new Error('invalid ctx model');return {ctx:b.slice(0,n),d2:b[n]!&15,tile:b.slice(n+1,n+3),row:b.slice(n+3,n+7),mask:b[n+7]!};}
/** 32-bit model id carried by streamed clips: the first four bytes of the model's SHA-256. */
export function ctxModelId(m:CtxModel):number {const h=sha256(encodeCtxModel(m));return ((h[0]!<<24)|(h[1]!<<16)|(h[2]!<<8)|h[3]!)>>>0;}
/** 2bpp tile frame (16 tiles, 8 rows, lo/hi) <-> 32x32 pixel values. */
export function ctxPixels(f:Uint8Array):Uint8Array {const px=new Uint8Array(1024);for(let t=0;t<16;t++)for(let y=0;y<8;y++){const lo=f[t*16+y*2]!,hi=f[t*16+y*2+1]!;for(let x=0;x<8;x++)px[((t>>2)*8+y)*32+(t&3)*8+x]=((lo>>(7-x))&1)|(((hi>>(7-x))&1)<<1);}return px;}
export function ctxTiles(px:Uint8Array):Uint8Array {const f=new Uint8Array(256);for(let t=0;t<16;t++)for(let y=0;y<8;y++){let lo=0,hi=0;for(let x=0;x<8;x++){const q=px[((t>>2)*8+y)*32+(t&3)*8+x]!;lo|=(q&1)<<(7-x);hi|=(q>>1)<<(7-x);}f[t*16+y*2]=lo;f[t*16+y*2+1]=hi;}return f;}
const at=(px:Uint8Array,x:number,y:number)=>x<0||y<0||x>31?0:px[y*32+x]!;
/** The pixel context: left, up, up-right, up-left of the current frame; same and right of the previous frame; and
 * whether the row above is unchanged at this column (1 when the previous and current frames agree there). */
export const ctxOf=(cur:Uint8Array,prev:Uint8Array,x:number,y:number)=>at(cur,x-1,y)|at(cur,x,y-1)<<2|at(cur,x+1,y-1)<<4|at(prev,x,y)<<6|at(prev,x+1,y)<<8|at(cur,x-1,y-1)<<10|(at(prev,x,y-1)===at(cur,x,y-1)?1:0)<<12;
/** Changed rows of a P-frame: bit y of rows[t] is set when row y of tile t differs from the previous frame. */
function changedRows(cur:Uint8Array,prev:Uint8Array):Uint8Array {const r=new Uint8Array(16);for(let i=0;i<1024;i++)if(cur[i]!==prev[i])r[((i>>8)<<2)|((i&31)>>3)]!|=1<<((i>>5)&7);return r;}
class Enc {
 private out:number[]=[];private bits=0;private low=0;private r=0xffff;
 private push(b:number){if(!(this.bits&7))this.out.push(0);if(b)this.out[this.out.length-1]!|=128>>(this.bits&7);this.bits++;}
 private carry(){let i=this.bits-1;while(i>=0&&(this.out[i>>3]!>>(7-(i&7)))&1){this.out[i>>3]!&=~(128>>(i&7));i--;}if(i<0)throw new Error('ctx coder carry overflow');this.out[i>>3]!|=128>>(i&7);}
 code(lps:boolean,cls:number){const q=CTX_QTAB[cls*4+((this.r>>13)&3)]!;if(!lps)this.r-=q;else{this.low+=this.r-q;this.r=q;if(this.low>=0x10000){this.low-=0x10000;this.carry();}}
  while(this.r<0x8000){this.r<<=1;this.push((this.low>>15)&1);this.low=(this.low<<1)&0xffff;}}
 finish():Uint8Array {for(let k=15;k>=0;k--)this.push((this.low>>k)&1);let n=this.out.length;while(n&&!this.out[n-1])n--;return Uint8Array.from(this.out.slice(0,n));}
}
class Dec {
 private at=0;private r=0xffff;private v=0;private readonly d:Uint8Array;
 constructor(d:Uint8Array){this.d=d;for(let k=0;k<16;k++)this.v=(this.v<<1)|this.bit();}
 private bit(){const i=this.at++;return (i>>3)<this.d.length?(this.d[i>>3]!>>(7-(i&7)))&1:0;}
 code(cls:number):boolean {const q=CTX_QTAB[cls*4+((this.r>>13)&3)]!,m=this.r-q;let lps=false;if(this.v<m)this.r=m;else{this.v-=m;this.r=q;lps=true;}while(this.r<0x8000){this.r<<=1;this.v=((this.v<<1)|this.bit())&0xffff;}return lps;}
}
export interface CtxFrame {tiles:Uint8Array;mask:number}
/** One P-frame chain as one stream. `key` is the frame the chain starts from (the clip's keyframe). */
export function encodeCtxChain(key:CtxFrame,frames:readonly CtxFrame[],m:CtxModel):Uint8Array {
 if(!frames.length)return new Uint8Array(0);
 const e=new Enc();let prev=ctxPixels(key.tiles),prevTiles=0xffff,mask=key.mask;
 for(const f of frames){const cur=ctxPixels(f.tiles),rows=changedRows(cur,prev);let flags=0;
  for(let t=0;t<16;t++){const b=rows[t]?1:0,c=m.tile[(prevTiles>>t)&1]!;e.code(b!==c>>7,c&15);flags|=b<<t;}prevTiles=flags;
  e.code((f.mask!==mask)!==!!(m.mask>>7),m.mask&15);if(f.mask!==mask){for(let t=0;t<16;t++)e.code((((f.mask^mask)>>t)&1)===1,EVEN);mask=f.mask;}
  for(let y=0;y<32;y++)for(let tx=0;tx<4;tx++){const t=(y>>3)*4+tx;if(!((flags>>t)&1))continue;const ry=y&7,changed=(rows[t]!>>ry)&1,k=(ry?(rows[t]!>>(ry-1))&1:1)*2+(ry===7?1:0),rc=m.row[k]!;
   e.code(changed!==rc>>7,rc&15);if(!changed)continue;
   for(let x=tx*8;x<tx*8+8;x++){const c=m.ctx[ctxOf(cur,prev,x,y)]!,v=cur[y*32+x]!,v0=c&3,v1=(c>>2)&3;
    if(v===v0){e.code(false,c>>4);continue;}e.code(true,c>>4);if(v===v1){e.code(false,m.d2);continue;}e.code(true,m.d2);
    let r0=-1;for(let k2=0;k2<4;k2++)if(k2!==v0&&k2!==v1){r0=k2;break;}e.code(v!==r0,EVEN);}}
  prev=cur;}
 return e.finish();
}
export function decodeCtxChain(bytes:Uint8Array,key:CtxFrame,count:number,m:CtxModel):CtxFrame[] {
 const d=new Dec(bytes),out:CtxFrame[]=[];let prev=ctxPixels(key.tiles),prevTiles=0xffff,mask=key.mask;
 for(let n=0;n<count;n++){let flags=0;
  for(let t=0;t<16;t++){const c=m.tile[(prevTiles>>t)&1]!;if(d.code(c&15)!==!!(c>>7))flags|=1<<t;}prevTiles=flags;
  if(d.code(m.mask&15)!==!!(m.mask>>7)){let x=0;for(let t=0;t<16;t++)if(d.code(EVEN))x|=1<<t;mask^=x;}
  const cur=prev.slice(),rows=new Uint8Array(16);
  for(let y=0;y<32;y++)for(let tx=0;tx<4;tx++){const t=(y>>3)*4+tx;if(!((flags>>t)&1))continue;const ry=y&7,k=(ry?(rows[t]!>>(ry-1))&1:1)*2+(ry===7?1:0),rc=m.row[k]!;
   if(d.code(rc&15)===!!(rc>>7))continue;rows[t]!|=1<<ry;
   for(let x=tx*8;x<tx*8+8;x++){const c=m.ctx[ctxOf(cur,prev,x,y)]!,v0=c&3,v1=(c>>2)&3;let v:number;
    if(!d.code(c>>4))v=v0;else if(!d.code(m.d2))v=v1;else{let r0=-1,r1=-1;for(let k2=0;k2<4;k2++)if(k2!==v0&&k2!==v1){if(r0<0)r0=k2;else r1=k2;}v=d.code(EVEN)?r1:r0;}
    cur[y*32+x]=v;}}
  out.push({tiles:ctxTiles(cur),mask});prev=cur;}
 return out;
}
/** Train a model from chains (keyframe plus P-frames): the statistics every decision above uses. */
export function trainCtxModel(chains:readonly {key:CtxFrame;frames:readonly CtxFrame[]}[]):CtxModel {
 const cnt=new Float64Array(CTX_SIZE*4),tile=[[0,0],[0,0]],row=[[0,0],[0,0],[0,0],[0,0]],mask=[0,0];let n2=0,l2=0;
 for(const ch of chains){let prev=ctxPixels(ch.key.tiles),prevTiles=0xffff,mk=ch.key.mask;
  for(const f of ch.frames){const cur=ctxPixels(f.tiles),rows=changedRows(cur,prev);let flags=0;for(let t=0;t<16;t++){const b=rows[t]?1:0;tile[(prevTiles>>t)&1]![b]!++;flags|=b<<t;}prevTiles=flags;mask[f.mask!==mk?1:0]!++;mk=f.mask;
   for(let y=0;y<32;y++)for(let tx=0;tx<4;tx++){const t=(y>>3)*4+tx;if(!((flags>>t)&1))continue;const ry=y&7,changed=(rows[t]!>>ry)&1;row[(ry?(rows[t]!>>(ry-1))&1:1)*2+(ry===7?1:0)]![changed]!++;if(!changed)continue;
    for(let x=tx*8;x<tx*8+8;x++)cnt[ctxOf(cur,prev,x,y)*4+cur[y*32+x]!]!++;}
   prev=cur;}}
 const ctx=new Uint8Array(CTX_SIZE);
 for(let c=0;c<CTX_SIZE;c++){const t=[0,1,2,3].map(v=>cnt[c*4+v]!),ord=[0,1,2,3].sort((a,b)=>t[b]!-t[a]!||a-b),s=t[0]!+t[1]!+t[2]!+t[3]!;
  ctx[c]=ord[0]!|ord[1]!<<2|ctxClassOf(s?(s-t[ord[0]!]!+.4)/(s+.8):.5)<<4;n2+=s-t[ord[0]!]!;l2+=t[ord[2]!]!+t[ord[3]!]!;}
 const flag=([no,yes]:number[])=>{const mps=yes!>no!?1:0;return mps<<7|ctxClassOf((Math.min(no!,yes!)+.4)/(no!+yes!+.8));};
 return {ctx,d2:ctxClassOf((l2+.4)/(n2+.8)),tile:Uint8Array.from(tile.map(flag)),row:Uint8Array.from(row.map(flag)),mask:flag(mask)};
}
/** A whole object clip: the keyframe plus a rest chain (resting poses) and a turn chain (the turntable). */
export interface CtxClip {key:CtxFrame;rest:CtxFrame[];turn:CtxFrame[]}
export interface CtxClipCode {key:Uint8Array;rest:Uint8Array;turn:Uint8Array}
export function encodeCtxClip(c:CtxClip,m:CtxModel):CtxClipCode {
 const code={key:encodeRetroFrame(c.key.tiles),rest:encodeCtxChain(c.key,c.rest,m),turn:encodeCtxChain(c.key,c.turn,m)};
 // A codec must never change artwork: every coded clip is decoded and compared before it is used.
 const same=(a:readonly CtxFrame[],b:readonly CtxFrame[])=>a.length===b.length&&a.every((f,i)=>f.mask===b[i]!.mask&&f.tiles.every((v,k)=>v===b[i]!.tiles[k]));
 if(!decodeRetroFrame(code.key).every((v,i)=>v===c.key.tiles[i])||!same(decodeCtxChain(code.rest,c.key,c.rest.length,m),c.rest)||!same(decodeCtxChain(code.turn,c.key,c.turn.length,m),c.turn))throw new Error('keel-retro-ctx round trip changed artwork');
 return code;
}
export function decodeCtxClip(code:CtxClipCode,keyMask:number,restCount:number,turnCount:number,m:CtxModel):CtxClip {
 const key={tiles:decodeRetroFrame(code.key),mask:keyMask};return {key,rest:decodeCtxChain(code.rest,key,restCount,m),turn:decodeCtxChain(code.turn,key,turnCount,m)};
}
