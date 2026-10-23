/** node packages/pinball-physics/tools/probe-table.ts /absolute/table.ts */
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createClassicWorld } from '@keel-engine/pinball-world';
import { KERNEL_SHA256 } from '../src/index.ts';
import type {PinballMap} from '@keel-engine/pinball-map';
const path=process.argv[2];if(!path)throw new Error('Provide absolute authored table TypeScript path');
const {EMBERLINE_MAP:map}=await import(pathToFileURL(path).href) as {EMBERLINE_MAP:PinballMap};
function probe(threshold:number|null){
 const world=createClassicWorld(map,{balls:1,ballSaveTicks:0});let hold=0,shotStart=-999,shots=0;const contacts:Record<string,number>={};const hash=createHash('sha256');
 for(let i=0;i<7200;i++){
  const before=world.readFrame(),ball=before.balls[0]!;
  if(threshold!==null&&hold===0&&ball.y>threshold&&ball.vy>0&&ball.x>215&&ball.x<385){hold=10;shotStart=i;}
  const input=before.phase==='ready'?4:hold>0?3:0;hold=Math.max(0,hold-1);
  const frame=world.step(input);hash.update(world.snapshot());
  for(const event of frame.events)contacts[event.type]=(contacts[event.type]??0)+1;
  if(i-shotStart<100&&frame.balls[0]!.y<500){shots++;shotStart=-999;}
  if(frame.phase==='gameover')break;
 }
 const f=world.readFrame();return {threshold,ticks:f.tick,seconds:f.tick/120,score:f.score,shots,contacts,phase:f.phase,ball:f.balls[0],transcriptSha256:hash.digest('hex')};
}
const results=[null,825,850,860].map(probe);
for(const result of results)if(JSON.stringify(result)!==JSON.stringify(probe(result.threshold)))throw new Error('Repeated authored-table probe diverged');
console.log(JSON.stringify({kernelSha256:KERNEL_SHA256,map:map.id,results},null,2));
