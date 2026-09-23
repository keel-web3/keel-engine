import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBitmap,plot} from '../src/bitmap.ts';
import type {Bitmap} from '../src/bitmap.ts';
import type {Rgba} from '../src/color.ts';
import {glyphOf,makeFont} from '../src/font.ts';
import type {PixelFont} from '../src/font.ts';
import {generateFont,DEFAULT_FONT} from '../src/genfont.ts';
import {textInto,textWidth} from '../src/gauges.ts';

// Independent pre-cache renderer: preserve clipping, overlapping outlines and transparent writes.
function directText(b: Bitmap, font: PixelFont, s: string, x: number, y: number, c: Rgba, o: { readonly outline?: Rgba; readonly align?: "left" | "center" | "right" } = {}): void {
  const w = textWidth(font, s);
  const x0 = Math.round(o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x), base = y + font.ascent;
  const pass = (dx: number, dy: number, col: Rgba): void => {
    let pen = x0;
    for (const ch of s) {
      const g = glyphOf(font, ch.charCodeAt(0));
      if (!g) { pen += Math.ceil(font.size / 2); continue; }
      for (let gy = 0; gy < g.h; gy += 1) for (let gx = 0; gx < g.w; gx += 1) if (g.bits[gy * g.w + gx]) plot(b, pen + g.ox + gx + dx, base + g.oy + gy + dy, col);
      pen += g.adv;
    }
  };
  if (o.outline !== undefined) for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) pass(dx, dy, o.outline);
  pass(0, 0, c);
}

test('cached text is exact across clipping, colors, overlapping glyphs, fractions and cache eviction',()=>{
const fonts=[7,9,12,16,22,32].map(size=>generateFont({...DEFAULT_FONT,slant:1},size));
for(const fractional of [false,true])fonts.push(makeFont({source:'grid',name:'overlap',size:7,ascent:fractional?.25:7,descent:2,lineHeight:12,glyphs:[65,63].map(code=>({code,w:7,h:9,ox:fractional?-.3:-3,oy:-5,adv:fractional?3.1:3,bits:Uint8Array.from({length:63},(_,i)=>+(i%3===0||i%11===0))}))}));
fonts.push(makeFont({source:'grid',name:'empty',size:7,ascent:7,descent:1,lineHeight:9,glyphs:[]}));
let checks=0,seed=17;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(const font of fonts)for(const value of ['REDLINE','GRID 128 KM/H','AAA? AA','HELLO ⛽🚘',''])for(const align of ['left','center','right'] as const)for(const offset of [-15,-.5,0,.3,7,46])for(const outline of [undefined,0,0xff334455]){
 const a=createBitmap(93,51),b=createBitmap(93,51);for(let i=0;i<a.px.length;i++)a.px[i]=b.px[i]=random();
 const x=offset+35,y=offset,ink=checks%3===0?0:0x88776655;
 const style=outline===undefined?{align}:{align,outline};directText(a,font,value,x,y,ink,style);textInto(b,font,value,x,y,ink,style);
 const mismatch=a.px.findIndex((v,i)=>v!==b.px[i]);if(mismatch!==-1)throw Error(JSON.stringify({checks,font:font.name,size:font.size,align,offset,outline,value,mismatch,expected:a.px[mismatch],actual:b.px[mismatch]}));checks++;
}
// Churn glyph identities, including empty masks, without retaining unlimited cache metadata or arrays.
for(let i=0;i<80;i++){
 const f=makeFont({source:'grid',name:'churn',size:8,ascent:8,descent:1,lineHeight:9,glyphs:[{code:65,w:64,h:64,ox:-3,oy:-7,adv:8,bits:Uint8Array.from({length:4096},(_,n)=>i%2?n%2:0)}]});
 const a=createBitmap(93,71),b=createBitmap(93,71);directText(a,f,'AAA',0,0,0xffffffff,{outline:1});textInto(b,f,'AAA',0,0,0xffffffff,{outline:1});if(a.px.some((v,i)=>v!==b.px[i]))throw Error('Eviction changed pixels');checks++;
 
}
// Zero-area glyphs must also evict by entry count rather than retain unlimited metadata.
for(let i=0;i<300;i++){
 const f=makeFont({source:'grid',name:'space'+i,size:7,ascent:7,descent:1,lineHeight:9,glyphs:[{code:65,w:0,h:0,ox:0,oy:0,adv:3,bits:new Uint8Array()}]});
 const a=createBitmap(11,9),b=createBitmap(11,9);a.px.fill(123);b.px.fill(123);
 directText(a,f,'AAA',0,0,456,{outline:789});textInto(b,f,'AAA',0,0,456,{outline:789});
 if(a.px.some((v,j)=>v!==b.px[j]))throw Error('Empty glyph changed pixels');checks++;
 
}
// Fractional arithmetic must keep the reference's grouping even when an index happens to land on an integer.
for(let i=0;i<300;i++){
 const f=makeFont({source:'grid',name:'fractional',size:7,ascent:(i%11)/10,descent:1,lineHeight:9,glyphs:[{code:65,w:3,h:3,ox:(i%7)/10,oy:(i%13)/10,adv:(i%17)/10,bits:Uint8Array.from([1,1,1,1,0,1,1,1,1])}]});
 const a=createBitmap(27,21),b=createBitmap(27,21),y=(i%10)/10;
 directText(a,f,'AAAA',0,y,0xffaa1133,{outline:0xff224455});textInto(b,f,'AAAA',0,y,0xffaa1133,{outline:0xff224455});
 if(a.px.some((v,j)=>v!==b.px[j]))throw Error('Fractional mismatch '+i);checks++;
}
assert.equal(checks,3110);
});
