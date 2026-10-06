/** Digital CGB oracle. Values are RGB555 words, without an LCD color filter.
 * Palette RAM is scene-global; tile-map positions select palettes independently.
 * BG index zero is visible and affects OBJ priority; OBJ zero is transparent. */
export const CGB_PALETTES=8, CGB_COLORS=4;
export function rgb555(r:number,g:number,b:number):number {
 if(![r,g,b].every(Number.isFinite))throw new Error('invalid RGB component');
 const q=(v:number)=>Math.max(0,Math.min(31,Math.round(v*31/255)));
 return q(r)|(q(g)<<5)|(q(b)<<10);
}
export function rgb555Bytes(colors:ArrayLike<number>):Uint8Array {
 const out=new Uint8Array(colors.length*2);
 for(let i=0;i<colors.length;i++){const c=colors[i]!&32767;out[i*2]=c&255;out[i*2+1]=c>>>8;}
 return out;
}
export function readRgb555(bytes:Uint8Array):Uint16Array {
 if(bytes.length%2)throw new Error('RGB555 requires two little-endian bytes');
 return Uint16Array.from({length:bytes.length/2},(_,i)=>(bytes[i*2]!|(bytes[i*2+1]!<<8))&32767);
}
/** Select the emulator's explicitly documented expansion, not an implicit filter. */
export function rgb888(color:number,expansion:'replicate'|'shift'='replicate'):number[] {
 const e=(v:number)=>expansion==='shift'?v<<3:(v<<3)|(v>>>2);
 return [e(color&31),e((color>>>5)&31),e((color>>>10)&31)];
}
export function tileIndices(tile:Uint8Array,xFlip=false,yFlip=false):Uint8Array {
 if(tile.length!==16)throw new Error('CGB tile requires 16 bytes');
 const out=new Uint8Array(64);
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){const sy=yFlip?7-y:y,sx=xFlip?7-x:x,bit=7-sx;out[y*8+x]=((tile[sy*2]!>>>bit)&1)|(((tile[sy*2+1]!>>>bit)&1)<<1);}
 return out;
}
export function encodeTile(indices:ArrayLike<number>):Uint8Array {
 if(indices.length!==64)throw new Error('CGB tile requires 64 indices');
 const out=new Uint8Array(16);
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=indices[y*8+x]!;if(p<0||p>3||!Number.isInteger(p))throw new Error('invalid 2bpp index');out[y*2]!|=(p&1)<<(7-x);out[y*2+1]!|=(p>>>1)<<(7-x);}
 return out;
}
export function palettePixel(palette:ArrayLike<number>,index:number,obj=false):{color:number;alpha:number} {
 if(palette.length!==4||!Number.isInteger(index)||index<0||index>3)throw new Error('invalid palette/index');
 return {color:palette[index]!&32767,alpha:obj&&index===0?0:255};
}
export interface MapRegion { readonly vram:readonly [Uint8Array,Uint8Array]; readonly cram:Uint16Array; readonly mapOffset:number; readonly x:number; readonly y:number; readonly width:number; readonly height:number; readonly unsignedTiles:boolean }
/** A tile-aligned region. Scroll/window/OBJ compositing is a separate stage. */
export function renderMapRegion(p:MapRegion) {
 if(p.vram.some(b=>b.length!==8192)||p.cram.length!==32||![0x1800,0x1c00].includes(p.mapOffset)||![p.x,p.y,p.width,p.height].every(Number.isInteger)||p.x<0||p.y<0||p.width<1||p.height<1||p.x+p.width>32||p.y+p.height>32)throw new Error('invalid CGB map region');
 const width=p.width*8,height=p.height*8,colors=new Uint16Array(width*height),indices=new Uint8Array(width*height),paletteIds=new Uint8Array(width*height),priority=new Uint8Array(width*height);
 for(let ty=0;ty<p.height;ty++)for(let tx=0;tx<p.width;tx++){
  const map=p.mapOffset+(p.y+ty)*32+p.x+tx,id=p.vram[0][map]!,attr=p.vram[1][map]!,pal=attr&7,bank=(attr>>>3)&1;
  const at=p.unsignedTiles?id*16:0x1000+(id<128?id:id-256)*16,tile=tileIndices(p.vram[bank]!.subarray(at,at+16),!!(attr&32),!!(attr&64));
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){const dest=(ty*8+y)*width+tx*8+x,q=tile[y*8+x]!;indices[dest]=q;paletteIds[dest]=pal;priority[dest]=attr>>>7;colors[dest]=p.cram[pal*4+q]!&32767;}
 }
 return {width,height,colors,indices,paletteIds,priority};
}
export function pixelDifference(expected:ArrayLike<number>,actual:ArrayLike<number>) {
 if(expected.length!==actual.length)throw new Error('pixel dimensions differ');
 let changed=0,maxChannel5=0,first=-1;const perChannel=[0,0,0];
 for(let i=0;i<expected.length;i++)if((expected[i]!&32767)!==(actual[i]!&32767)){
  if(first<0)first=i;changed++;
  for(let c=0;c<3;c++){const delta=Math.abs(((expected[i]!>>>(c*5))&31)-((actual[i]!>>>(c*5))&31));maxChannel5=Math.max(maxChannel5,delta);perChannel[c]!+=delta;}
 }
 return {pixels:expected.length,changed,first,maxChannel5,channelAbsolute5:perChannel};
}
