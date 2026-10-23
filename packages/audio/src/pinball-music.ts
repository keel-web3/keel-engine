import {streamOf} from './score.ts';
import {buf,osc,env,midiHz,noiseOf,burst,bp,thump,finish,wearOf,type Shape} from './synth.ts';

export const PINBALL_MUSIC_THEMES=['cyberpunk','vaporwave','gold','nature','crypto'] as const;
export type PinballMusicTheme=typeof PINBALL_MUSIC_THEMES[number];
export interface PinballMusicBlueprint {
 readonly id:string;readonly bpm:number;readonly root:number;readonly scale:readonly number[];readonly shape:Shape;readonly chordShape:Shape;readonly wear:'clean'|'lofi'|'chip'|'soft';
 readonly bass:number;readonly lead:number;readonly drum:number;readonly chordGain:number;readonly leadEvery:1|2|4|8;readonly leadOffset:number;readonly bassEvery:1|2|4|8;readonly leadBeats:number;
 readonly kick:readonly number[];readonly snare:readonly number[];readonly hat:readonly number[];readonly partials:readonly {readonly interval:number;readonly gain:number}[];readonly air:number;readonly airHz:number;
}
export interface PinballMusicRecipe {readonly schema:'keel-pinball-music@1';readonly seed:string;readonly theme:string;readonly blueprint:PinballMusicBlueprint}
export interface PinballMusicSamples {readonly recipe:PinballMusicRecipe;readonly sampleRate:number;readonly bpm:number;readonly beats:16;readonly atmosphere:Float32Array<ArrayBuffer>;readonly drive:Float32Array<ArrayBuffer>}
const common={chordShape:'sine' as const,chordGain:.035,leadEvery:1 as const,leadOffset:0,bassEvery:4 as const,leadBeats:.55,kick:[0,8],snare:[4,12],hat:[1,3,5,7,9,11,13,15],partials:[{interval:0,gain:1}],air:0,airHz:750};
export const PINBALL_MUSIC_BLUEPRINTS:Readonly<Record<PinballMusicTheme,PinballMusicBlueprint>>={
 cyberpunk:{...common,id:'cyberpunk',bpm:124,root:42,scale:[0,2,3,5,7,10],shape:'saw',wear:'clean',bass:.15,lead:.075,drum:.4,bassEvery:2},
 vaporwave:{...common,id:'vaporwave',bpm:88,root:45,scale:[0,2,4,5,7,9,11],shape:'tri',wear:'lofi',bass:.12,lead:.055,drum:.22,chordShape:'tri',chordGain:.075,leadEvery:4,leadOffset:2},
 gold:{...common,id:'gold',bpm:100,root:50,scale:[0,2,3,5,7,8,11],shape:'sine',wear:'clean',bass:.08,lead:.10,drum:.20,leadEvery:2,leadBeats:1.2,partials:[{interval:0,gain:1},{interval:19,gain:.28}]},
 nature:{...common,id:'nature',bpm:76,root:50,scale:[0,2,4,7,9],shape:'sine',wear:'soft',bass:.045,lead:.055,drum:.08,leadEvery:4,leadOffset:1,hat:[],air:1},
 crypto:{...common,id:'crypto',bpm:138,root:40,scale:[0,1,3,5,7,8,10],shape:'pulse',wear:'chip',bass:.14,lead:.065,drum:.34,bassEvery:2,kick:[0,6,8,14]},
};
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
freeze(PINBALL_MUSIC_BLUEPRINTS);
function blueprint(source:PinballMusicBlueprint):PinballMusicBlueprint{
 const integer=(value:number,lo:number,hi:number)=>Number.isSafeInteger(value)&&value>=lo&&value<=hi,level=(value:number,lo=0,hi=1)=>Number.isFinite(value)&&value>=lo&&value<=hi;
 const pattern=(value:readonly number[])=>Array.isArray(value)&&value.length<=16&&new Set(value).size===value.length&&value.every(n=>integer(n,0,15));
 const shapes=['sine','saw','square','pulse','tri'];
 if(!source||typeof source.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/.test(source.id)||!integer(source.bpm,42,200)||!integer(source.root,24,72)||!Array.isArray(source.scale)||source.scale.length<3||source.scale.length>12||source.scale.some((n,i)=>!integer(n,0,11)||i>0&&n<=source.scale[i-1]!)||!shapes.includes(source.shape)||!shapes.includes(source.chordShape)||!['clean','lofi','chip','soft'].includes(source.wear)||![source.bass,source.lead,source.drum,source.chordGain,source.air].every(n=>level(n))||![1,2,4,8].includes(source.leadEvery)||![1,2,4,8].includes(source.bassEvery)||!integer(source.leadOffset,0,source.leadEvery-1)||!level(source.leadBeats,.1,1.5)||!pattern(source.kick)||!pattern(source.snare)||!pattern(source.hat)||!Array.isArray(source.partials)||source.partials.length<1||source.partials.length>4||source.partials.some(p=>!integer(p.interval,0,36)||!level(p.gain))||!level(source.airHz,100,6000))throw new TypeError('Pinball music blueprint');
 return freeze({id:source.id,bpm:source.bpm,root:source.root,scale:[...source.scale],shape:source.shape,chordShape:source.chordShape,wear:source.wear,bass:source.bass,lead:source.lead,drum:source.drum,chordGain:source.chordGain,leadEvery:source.leadEvery,leadOffset:source.leadOffset,bassEvery:source.bassEvery,leadBeats:source.leadBeats,kick:[...source.kick],snare:[...source.snare],hat:[...source.hat],partials:source.partials.map(p=>({interval:p.interval,gain:p.gain})),air:source.air,airHz:source.airHz});
}
/** Named entries are starter examples; a theme pack can serialize its own
 * instrumentation, rhythm, atmosphere and scale without editing this module. */
export function pinballMusicRecipe(seed:string,theme:PinballMusicTheme|PinballMusicBlueprint):PinballMusicRecipe{
 if(typeof seed!=='string'||seed.length<1||seed.length>256||typeof theme==='string'&&!Object.hasOwn(PINBALL_MUSIC_BLUEPRINTS,theme))throw new TypeError('Pinball cabinet music recipe');
 const profile=blueprint(typeof theme==='string'?PINBALL_MUSIC_BLUEPRINTS[theme]:theme);
 return Object.freeze({schema:'keel-pinball-music@1',seed,theme:profile.id,blueprint:profile});
}
/** Four original bars with separate atmosphere and action stems. Timing,
 * pitches and noise are seeded; mixing never changes game authority. */
export function pinballMusicSamples(recipe:PinballMusicRecipe,sampleRate=24000):PinballMusicSamples{
 if(recipe.schema!=='keel-pinball-music@1')throw new TypeError('Pinball music version');
 const admitted=pinballMusicRecipe(recipe.seed,recipe.blueprint);if(admitted.theme!==recipe.theme)throw new TypeError('Pinball music theme identity');
 if(!Number.isSafeInteger(sampleRate)||sampleRate<8000||sampleRate>48000)throw new RangeError('Pinball music sample rate');
 const p=admitted.blueprint,random=streamOf(`${recipe.seed}|pinball-music:1|${JSON.stringify(p)}`),bpm=p.bpm+random.int(-2,2),beat=60/bpm,seconds=beat*16;
 const atmosphere=buf(sampleRate,seconds),drive=buf(sampleRate,seconds),length=atmosphere.length,noise=noiseOf(random.int(1,0x7fffffff));
 const addCircular=(target:Float32Array,source:Float32Array,at:number,gain=1)=>{const offset=Math.round(at*sampleRate);for(let i=0;i<source.length;i++)target[(offset+i)%length]!+=source[i]!*gain;};
 const note=(target:Float32Array,at:number,duration:number,midi:number,gain:number,shape:Shape=p.shape)=>{const pcm=buf(sampleRate,duration),hz=midiHz(midi);osc(pcm,sampleRate,0,duration,()=>hz,t=>gain*env(.008,duration*.22)(t)*Math.min(1,(duration-t)/.02),shape);addCircular(target,pcm,at);};
 const chordRoots=[0,random.int(1,2),random.int(3,4),random.int(0,1)];
 for(let bar=0;bar<4;bar++){
  const degree=chordRoots[bar]!,root=p.root+p.scale[degree%p.scale.length]!;
  for(const interval of [0,2,4])note(atmosphere,bar*4*beat,beat*3.8,p.root+12+p.scale[(degree+interval)%p.scale.length]!,p.chordGain,p.chordShape);
  for(let step=0;step<16;step++){
   const at=(bar*4+step/4)*beat;
   if(step%p.bassEvery===0)note(atmosphere,at,beat*.42,root+(step===8?12:0),p.bass,'tri');
   if(step%p.leadEvery===p.leadOffset&&random.f()>.12){const index=(degree+step+random.int(0,2))%p.scale.length,midi=p.root+24+p.scale[index]!;for(const partial of p.partials)note(drive,at,beat*p.leadBeats,midi+partial.interval,p.lead*partial.gain);}
   if(p.kick.includes(step)){const drum=buf(sampleRate,.22);thump(drum,sampleRate,0,150,45,.035,p.drum);addCircular(drive,drum,at);}
   if(p.snare.includes(step)){const drum=buf(sampleRate,.16);burst(drum,sampleRate,noise,0,env(.001,.025),p.drum*.45);bp(drum,1800,.8,sampleRate);addCircular(drive,drum,at);}
   if(p.hat.includes(step)){const hat=buf(sampleRate,.07);burst(hat,sampleRate,noise,0,env(.001,.012),.03);bp(hat,5500,.7,sampleRate);addCircular(drive,hat,at);}
  }
 }
 if(p.air>0){
  const air=buf(sampleRate,seconds);burst(air,sampleRate,noise,0,t=>.35+.15*Math.sin(t/seconds*Math.PI*2),.018*p.air);bp(air,p.airHz,.6,sampleRate);for(let i=0;i<length;i++)atmosphere[i]!+=air[i]!;
 }
 const finishLoop=(pcm:Float32Array<ArrayBuffer>,peak:number)=>{finish(pcm,sampleRate,wearOf(p.wear),peak,.012);const fade=Math.round(sampleRate*.012);for(let i=0;i<fade;i++)pcm[i]!*=i/fade;pcm[0]=0;pcm[pcm.length-1]=0;return pcm;};
 return {recipe:admitted,sampleRate,bpm,beats:16,atmosphere:finishLoop(atmosphere,.24),drive:finishLoop(drive,.20)};
}

export interface PinballMusicOptions {readonly seed:string;readonly theme:PinballMusicTheme|PinballMusicBlueprint;readonly volume?:number;readonly out?:AudioNode}
/** Exactly two looping sources and two cached mono buffers. Action intensity
 * and brief impact ducking affect cosmetic gains, never the seeded score. */
export function createPinballMusic(context:BaseAudioContext,options:PinballMusicOptions){
 const recipe=pinballMusicRecipe(options.seed,options.theme),volume=options.volume??.15;
 if(!Number.isFinite(volume)||volume<0||volume>1)throw new RangeError('Pinball music volume');
 if(!Number.isSafeInteger(context.sampleRate)||context.sampleRate<8000||context.sampleRate>96000)throw new RangeError('Pinball music context rate');
 const output=context.createGain(),bed=context.createGain(),action=context.createGain();output.gain.value=volume;bed.gain.value=1;action.gain.value=.2;bed.connect(output);action.connect(output);output.connect(options.out??context.destination);
 let buffers:readonly [AudioBuffer,AudioBuffer]|undefined,sources:AudioBufferSourceNode[]=[],disposed=false,starts=0,intensity=0;
 function stop(){for(const source of sources){source.onended=null;source.stop();source.disconnect();}sources=[];output.gain.cancelScheduledValues(context.currentTime);output.gain.setValueAtTime(volume,context.currentTime);}
 function start(tick=0){
  if(!Number.isSafeInteger(tick)||tick<0||tick>120*3600)throw new RangeError('Pinball music tick');if(disposed||sources.length)return;
  if(!buffers){const samples=pinballMusicSamples(recipe,Math.min(24000,context.sampleRate));buffers=[samples.atmosphere,samples.drive].map(pcm=>{const buffer=context.createBuffer(1,pcm.length,samples.sampleRate);buffer.getChannelData(0).set(pcm);return buffer;}) as [AudioBuffer,AudioBuffer];}
  const created:AudioBufferSourceNode[]=[],startTime=context.currentTime;
  try{for(const [index,buffer]of buffers.entries()){const source=context.createBufferSource();created.push(source);source.buffer=buffer;source.loop=true;source.connect(index===0?bed:action);source.start(startTime,(tick/120)%buffer.duration);}sources=created;starts++;}
  catch(error){for(const source of created){try{source.stop();}catch{/* A source whose start failed can already be stopped. */}source.disconnect();}sources=[];throw error;}
 }
 function setIntensity(value:number){if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('Pinball music intensity');if(disposed)return;intensity=value;action.gain.setTargetAtTime(.2+value*.8,context.currentTime,.15);}
 function duck(depth=.5,seconds=.14){if(!Number.isFinite(depth)||depth<0||depth>1||!Number.isFinite(seconds)||seconds<.03||seconds>1)throw new RangeError('Pinball music duck');if(disposed)return;const now=context.currentTime;output.gain.cancelScheduledValues(now);output.gain.setValueAtTime(volume*(1-depth),now);output.gain.linearRampToValueAtTime(volume,now+seconds);}
 return {start,stop,setIntensity,duck,get stats(){return Object.freeze({theme:recipe.theme,active:sources.length,cached:buffers?2:0,starts,intensity});},dispose(){if(disposed)return;stop();disposed=true;bed.disconnect();action.disconnect();output.disconnect();buffers=undefined;}};
}
