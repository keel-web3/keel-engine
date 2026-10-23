import {isPinballSound,pinballSoundRecipe,pinballSoundSample,type PinballSoundName,type PinballSoundStyle} from './pinball.ts';
export interface PinballAudioOptions {readonly seed:string;readonly style?:PinballSoundStyle;readonly out?:AudioNode;readonly maxVoices?:number;readonly maxCache?:number;readonly volume?:number}
export interface PinballPlayParams {readonly gain?:number;readonly pan?:number;readonly rate?:number;readonly priority?:number;readonly variant?:number}
export interface PinballVoice {readonly playing:boolean;stop():void}
const bounded=(value:number|undefined,fallback:number,lo:number,hi:number)=>Number.isFinite(value)?Math.max(lo,Math.min(hi,value!)):fallback;
/** Bounded one-shot mixer. All names and variants come from the mechanical
 * generator; no network recordings or random playback jitter. */
export function createPinballAudio(context:BaseAudioContext,options:PinballAudioOptions){
 pinballSoundRecipe('ui.select',options.seed,0,options.style??'clean');
 const limit=options.maxVoices??16,cacheLimit=options.maxCache??32;
 if(!Number.isInteger(limit)||limit<1||limit>64||!Number.isInteger(cacheLimit)||cacheLimit<1||cacheLimit>128)throw new Error('Pinball audio budget');
 if(!Number.isInteger(context.sampleRate)||context.sampleRate<8000||context.sampleRate>96000)throw new RangeError('Unsupported pinball audio sample rate');
 const output=context.createGain(),limiter=context.createDynamicsCompressor();output.gain.value=bounded(options.volume,.7,0,1);
 limiter.threshold.value=-6;limiter.knee.value=6;limiter.ratio.value=12;limiter.attack.value=.002;limiter.release.value=.08;
 output.connect(limiter).connect(options.out??context.destination);
 const cache=new Map<string,AudioBuffer>(),turns=new Map<PinballSoundName,number>(),gaps=new Map<PinballSoundName,{at:number;priority:number}>();
 const active=new Set<{priority:number;serial:number;stop:()=>void}>();let serial=0,played=0,dropped=0,limited=0,stolen=0,rendered=0,disposed=false;
 function play(name:PinballSoundName,parameters:PinballPlayParams={}):PinballVoice|null {
  if(!isPinballSound(name))throw new Error('Unknown pinball sound');if(disposed)return null;
  const gain=bounded(parameters.gain,1,0,1);if(gain===0)return null;
  const priority=bounded(parameters.priority,name==='route.complete'||name.includes('capture')||name==='multiball'?3:name==='rail.ting'||name==='ramp.roll'?0:1,0,8);
  const now=context.currentTime,gap=gaps.get(name);if(gap&&now-gap.at<.018&&priority<=gap.priority){limited++;return null;}
  if(active.size>=limit){let victim:{priority:number;serial:number;stop:()=>void}|undefined;
   for(const voice of active)if(voice.priority<priority&&(!victim||voice.priority<victim.priority||voice.priority===victim.priority&&voice.serial<victim.serial))victim=voice;
   if(!victim){dropped++;return null;}victim.stop();stolen++;
  }
  const turn=turns.get(name)??0,variant=Math.floor(bounded(parameters.variant,turn%4,0,3)),key=`${name}/${variant}`;
  let buffer=cache.get(key);if(buffer){cache.delete(key);cache.set(key,buffer);}else{
   const pcm=pinballSoundSample(pinballSoundRecipe(name,options.seed,variant,options.style??'clean'),context.sampleRate);
   buffer=context.createBuffer(1,pcm.length,context.sampleRate);buffer.getChannelData(0).set(pcm);cache.set(key,buffer);rendered++;
   if(cache.size>cacheLimit)cache.delete(cache.keys().next().value!);
  }
  const source=context.createBufferSource(),level=context.createGain(),pan=context.createStereoPanner();
  source.buffer=buffer;source.playbackRate.value=bounded(parameters.rate,1,.5,2);level.gain.value=gain*.3;pan.pan.value=bounded(parameters.pan,0,-1,1);
  source.connect(level).connect(pan).connect(output);let playing=true;
  const record={priority,serial:serial++,stop:()=>{if(!playing)return;source.stop();cleanup();}};
  function cleanup(){if(!playing)return;playing=false;source.onended=null;source.disconnect();level.disconnect();pan.disconnect();active.delete(record);}
  source.onended=cleanup;active.add(record);source.start(now);played++;gaps.set(name,{at:now,priority});turns.set(name,turn+1);
  return {get playing(){return playing;},stop:record.stop};
 }
 return {play,get stats(){return Object.freeze({active:active.size,played,dropped,limited,stolen,rendered,cached:cache.size});},get volume(){return output.gain.value;},set volume(value:number){output.gain.setTargetAtTime(bounded(value,.7,0,1),context.currentTime,.02);},stop(){for(const voice of [...active])voice.stop();turns.clear();gaps.clear();},dispose(){if(disposed)return;disposed=true;for(const voice of [...active])voice.stop();output.disconnect();limiter.disconnect();cache.clear();turns.clear();gaps.clear();}};
}
