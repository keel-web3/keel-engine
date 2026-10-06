import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CTX_QTAB,ctxPixels,ctxTiles,trainCtxModel,encodeCtxModel,decodeCtxModel,encodeCtxClip,decodeCtxClip,encodeCtxChain,decodeCtxChain,ctxModelId,type CtxClip,type CtxFrame} from '../src/retro-ctx.ts';
// Synthetic sprites that behave like turntable renders: a shaded, dithered ellipse whose band boundary and a
// bright feature move with the view, plus a flickering emitter at the top for the resting poses.
let seed=7;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
const noise=Array.from({length:1024},()=>rand());
function sprite(view:number,pose:number):CtxFrame {const px=new Uint8Array(1024),a=view*Math.PI/8;
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){const dx=(x-16)/11,dy=(y-17)/13,r=dx*dx+dy*dy;if(r>1)continue;
  const light=1.4+1.6*Math.max(0,-.5*dx+.7*-dy+.5*Math.sqrt(1-Math.min(1,r)))+.6*Math.cos(a+dx*2),band=Math.floor(light),frac=light-band;
  px[y*32+x]=r>.86?1:Math.min(3,Math.max(1,band+(frac>noise[y*32+x]!?1:0)));}
 for(let k=0;k<3+pose%3;k++){const x=14+((pose*5+k*3)%5),y=2+((pose+k)%4);px[y*32+x]=3;}
 return {tiles:ctxTiles(px),mask:pose%5===4?0x0003:0};}
const clipOf=(o:number):CtxClip=>({key:sprite(o,0),rest:Array.from({length:7},(_,i)=>sprite(o,i+1)),turn:Array.from({length:15},(_,i)=>sprite(o+i+1,i+1))});
test('ctx clips are lossless, compact and the model round-trips',()=>{
 const clips=[0,3,6].map(clipOf),m=trainCtxModel(clips.flatMap(c=>[{key:c.key,frames:c.rest},{key:c.key,frames:c.turn}]));
 assert.deepEqual(decodeCtxModel(encodeCtxModel(m)),m);assert.equal(typeof ctxModelId(m),'number');
 for(const c of clips){const code=encodeCtxClip(c,m),back=decodeCtxClip(code,c.key.mask,7,15,m);assert.deepEqual(back,c);
  assert.ok(code.rest.length+code.turn.length<22*256/4,'chains well below raw');}
 for(let i=0;i<64;i++){const px=Uint8Array.from({length:1024},()=>Math.floor(rand()*4));assert.deepEqual(ctxPixels(ctxTiles(px)),px);}
 // any bytes decode without throwing (wrong pixels only)
 const junk=Uint8Array.from({length:300},()=>Math.floor(rand()*256));assert.equal(decodeCtxChain(junk,clips[0]!.key,9,m).length,9);
 assert.equal(encodeCtxChain(clips[0]!.key,[],m).length,0);
});
test('the C decoder matches the TypeScript reference with any row chunking',(t)=>{
 try{execFileSync('cc',['--version'],{stdio:'ignore'});}catch{t.skip('no C compiler');return;}
 const clips=[1,4].map(clipOf),m=trainCtxModel(clips.flatMap(c=>[{key:c.key,frames:c.rest},{key:c.key,frames:c.turn}]));
 const header=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'../native/keel_retro_ctx.h'),'utf8');
 const q=header.match(/krc_q\[64\]=\{([^}]*)\}/)![1]!.split(',').map(Number);assert.deepEqual(q,[...CTX_QTAB]);
 const arr=(n:string,b:Iterable<number>)=>`static const uint8_t ${n}[]={${[...b].join(',')||'0'}};\n`;
 let src='#include <stdint.h>\n#include <string.h>\n'+arr('model',encodeCtxModel(m))+'#define KRC_MODEL model\n#include "keel_retro_ctx.h"\nstatic const uint8_t*stream_end;\nstatic uint8_t krc_fill(krc_stream*s){uint8_t n=s->left<KRC_IN?(uint8_t)s->left:KRC_IN;memcpy(s->in,s->src,n);s->src+=n;s->left-=n;return n;}\n#include <stdio.h>\nstatic krc_stream st;\nint fails=0;\n';
 const checks:string[]=[];
 clips.forEach((c,ci)=>{const code=encodeCtxClip(c,m);for(const [name,frames] of [['rest',c.rest],['turn',c.turn]] as const){const id=`${name}${ci}`;
  src+=arr(`${id}_s`,code[name])+arr(`${id}_k`,c.key.tiles)+arr(`${id}_e`,frames.flatMap(f=>[...f.tiles]))+`static const uint16_t ${id}_m[]={${frames.map(f=>f.mask).join(',')}};\n`;
  checks.push(`{uint8_t f,chunk=1;krc_open(&st,${id}_s,${code[name].length},0,${id}_k,${c.key.mask});for(f=0;f<${frames.length};f++){krc_frame(&st);while(!krc_rows(&st,chunk))chunk=(uint8_t)(chunk%7+1);if(memcmp(st.tiles,${id}_e+f*256,256)||st.mask!=${id}_m[f]){printf("${id} frame %d differs\\n",f);fails++;}}}`);}});
 src+=`int main(void){${checks.join('\n')}\nprintf("%d\\n",fails);return fails!=0;}\n`;
 const dir=mkdtempSync(join(tmpdir(),'krc-'));writeFileSync(join(dir,'t.c'),src);
 execFileSync('cc',['-std=c99','-O1','-Wall','-Wno-unused-function','-Wno-unused-variable','-I',join(dirname(fileURLToPath(import.meta.url)),'../native'),'-o',join(dir,'t'),join(dir,'t.c')]);
 assert.equal(execFileSync(join(dir,'t'),{encoding:'utf8'}).trim(),'0');
});
