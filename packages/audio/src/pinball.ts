import {streamOf} from './score.ts';
import {add,bp,buf,burst,env,finish,noiseOf,osc,thump,wearOf} from './synth.ts';

export const PINBALL_SOUNDS=['spring.charge','spring.release','flipper.up','flipper.down','bumper.pop','slingshot.snap','rail.ting','ramp.enter','ramp.roll','ramp.exit','spinner.tick','target.hit','gate.open','gate.close','diverter.turn','scoop.capture','scoop.eject','lock.capture','lock.release','capture.travel','capture.blocked','portal.enter','portal.exit','drain','tilt','route.complete','skill.pulse','skill.dash','skill.shield','damage','multiball','ui.select'] as const;
export type PinballSoundName=typeof PINBALL_SOUNDS[number];
export type PinballSoundStyle='clean'|'lofi'|'chip';
export interface PinballSoundRecipe {readonly generator:'keel/pinball-audio';readonly version:1;readonly name:PinballSoundName;readonly seed:string;readonly variant:number;readonly style:PinballSoundStyle}
export const isPinballSound=(value:string):value is PinballSoundName=>(PINBALL_SOUNDS as readonly string[]).includes(value);
export function pinballSoundRecipe(name:PinballSoundName,seed:string,variant=0,style:PinballSoundStyle='clean'):PinballSoundRecipe {
 if(!isPinballSound(name)||typeof seed!=='string'||seed.length<1||seed.length>256||!Number.isInteger(variant)||variant<0||variant>3||!['clean','lofi','chip'].includes(style))throw new TypeError('Pinball sound recipe');
 return Object.freeze({generator:'keel/pinball-audio',version:1,name,seed,variant,style});
}

/** Pure bounded mechanical PCM. A seed owns resonance/noise colour; runtime
 * energy, distance and pan are playback parameters, outside authority state. */
export function pinballSoundSample(recipe:PinballSoundRecipe,rate=44100):Float32Array<ArrayBuffer> {
 if(recipe.generator!=='keel/pinball-audio'||recipe.version!==1)throw new TypeError('Unsupported pinball audio');
 pinballSoundRecipe(recipe.name,recipe.seed,recipe.variant,recipe.style);
 if(!Number.isInteger(rate)||rate<8000||rate>96000)throw new RangeError('Pinball audio sample rate');
 const {name}=recipe,rng=streamOf(`${recipe.seed}|pinball-audio:1|${name}|${recipe.variant}`),random=noiseOf(rng.int(1,0x7fffffff)),pitch=rng.between(.94,1.06),ring=rng.between(540,780);
 const noise=(seconds:number,decay:number,hz:number,gain:number)=>bp(burst(buf(rate,seconds),rate,random,0,env(.0006,decay),gain),hz,.75,rate);
 const tone=(pcm:Float32Array<ArrayBuffer>,at:number,duration:number,hz:number,level:number,end=hz)=>osc(pcm,rate,at,duration,t=>hz*pitch*(end/hz)**(t/duration),t=>level*env(.0007,duration/5)(t));
 let pcm=buf(rate,.5);
 const solenoid=(up:boolean)=>{
  pcm=buf(rate,.28);thump(pcm,rate,0,up?230:160,up?70:45,.018,.75);
  add(pcm,noise(.12,.009,up?2300:1300,.25));
  [1,2.73,5.11].forEach((ratio,index)=>tone(pcm,.003,.15/(index+1),ring*ratio,.11/(index+1)));
 };
 if(name==='spring.charge'){
  pcm=buf(rate,.55);for(let index=0;index<11;index++){const at=index*.039;add(pcm,noise(.065,.012,800+index*130,.14),1,at*rate);tone(pcm,at,.08,260+index*22,.065);}
 }else if(name==='spring.release'||name==='slingshot.snap'){
  pcm=buf(rate,.48);thump(pcm,rate,0,170,52,.034,.65);add(pcm,noise(.2,.026,2700,.2));
  [1,2.71,5.2].forEach((ratio,index)=>tone(pcm,0,.4/(1+index*.65),360*ratio,.24/(index+1),250*ratio));
 }else if(name==='flipper.up'||name==='flipper.down'||name==='gate.open'||name==='gate.close'||name==='diverter.turn'){solenoid(name!=='flipper.down'&&name!=='gate.close');}
 else if(name==='bumper.pop'){
  pcm=buf(rate,.42);thump(pcm,rate,0,145,62,.039,.72);add(pcm,noise(.16,.011,3100,.18));tone(pcm,.002,.34,930,.22);tone(pcm,.002,.22,930*2.73,.075);
 }else if(name==='rail.ting'||name==='spinner.tick'||name==='target.hit'){
  pcm=buf(rate,name==='rail.ting'?.48:.26);const hz=name==='spinner.tick'?1450:name==='target.hit'?560:2100;
  add(pcm,noise(.08,.005,4200,.15));[1,2.72,5.13].forEach((ratio,index)=>tone(pcm,0,.35/(index+1),hz*ratio,.22/(index+1)));
  if(name==='target.hit')thump(pcm,rate,0,260,90,.023,.35);
 }else if(name.startsWith('ramp.')){
  pcm=buf(rate,name==='ramp.roll'?.62:.3);add(pcm,noise(pcm.length/rate,.12,1100,.15));
  const count=name==='ramp.roll'?12:4;for(let index=0;index<count;index++)tone(pcm,index*.043,.035,1500+index*90,.055);
  if(name==='ramp.exit')thump(pcm,rate,0,190,95,.026,.3);
 }else if(name==='capture.travel'){
  pcm=buf(rate,.68);add(pcm,noise(.62,.18,720,.2));
  for(let index=0;index<7;index++){const at=index*.065;tone(pcm,at,.13,420+index*80,.075);tone(pcm,at,.08,ring*2.71,.035);}
 }else if(name==='capture.blocked'){
  pcm=buf(rate,.46);[0,.14,.28].forEach(at=>{add(pcm,noise(.09,.012,1200,.17),1,at*rate);tone(pcm,at,.12,310,.13,230);});
  thump(pcm,rate,0,210,70,.027,.4);
 }else if(name==='scoop.capture'||name==='lock.capture'||name==='scoop.eject'||name==='lock.release'){
  pcm=buf(rate,.52);thump(pcm,rate,0,name.endsWith('capture')?220:320,65,.043,.7);add(pcm,noise(.32,.036,900,.22));
  tone(pcm,.035,.36,name.endsWith('capture')?510:360,.2,name.endsWith('capture')?160:760);
 }else if(name.startsWith('portal.')||name.startsWith('skill.')){
  pcm=buf(rate,.85);const rising=name==='portal.exit'||name==='skill.shield',start=rising?180:1400,end=rising?1600:120;
  tone(pcm,0,.65,start,.28,end);tone(pcm,.03,.68,start*1.51,.12,end*1.51);add(pcm,noise(.65,.18,3200,.13));
  if(name==='skill.pulse')thump(pcm,rate,0,140,40,.08,.55);
 }else if(name==='route.complete'||name==='multiball'){
  pcm=buf(rate,1.2);[523.25,659.25,783.99,1046.5].forEach((hz,index)=>{tone(pcm,index*.1,.72,hz,.25);tone(pcm,index*.1,.35,hz*2,.035);});
 }else if(name==='drain'||name==='damage'){
  pcm=buf(rate,.6);thump(pcm,rate,0,180,45,.055,.65);add(pcm,noise(.35,.064,850,.2));tone(pcm,.05,.4,190,.12,65);
 }else if(name==='tilt'){
  pcm=buf(rate,.7);[0,.19,.38].forEach(at=>tone(pcm,at,.17,155,.3,100));
 }else {pcm=buf(rate,.15);tone(pcm,0,.09,1350,.2,2200);}
 return finish(pcm,rate,wearOf(recipe.style),.42,.015);
}
