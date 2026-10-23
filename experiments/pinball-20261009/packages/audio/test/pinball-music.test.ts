import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PINBALL_MUSIC_THEMES,PINBALL_MUSIC_BLUEPRINTS,pinballMusicRecipe,pinballMusicSamples,createPinballMusic} from '../src/pinball-music.ts';
const hash=(pcm:Float32Array)=>createHash('sha256').update(new Uint8Array(pcm.buffer,pcm.byteOffset,pcm.byteLength)).digest('hex');
test('seeded theme and custom blueprint scores are finite, bounded and repeatable',()=>{
 const identities=new Set<string>();
 for(const theme of PINBALL_MUSIC_THEMES){const recipe=pinballMusicRecipe('cabinet.123',theme),a=pinballMusicSamples(recipe,8000),b=pinballMusicSamples(recipe,8000);
  assert.equal(hash(a.atmosphere),hash(b.atmosphere));assert.equal(hash(a.drive),hash(b.drive));assert.equal(a.atmosphere.length,a.drive.length);assert.ok(Math.abs(a.atmosphere.length/8000-16*60/a.bpm)<1/8000);
  for(const [pcm,peak]of [[a.atmosphere,.240001],[a.drive,.200001]] as const){assert.ok(pcm.every(Number.isFinite));assert.ok(pcm.some(n=>n!==0));assert.ok(pcm.every(n=>Math.abs(n)<=peak));assert.equal(pcm[0],0);assert.equal(pcm.at(-1),0);}
  identities.add(hash(a.atmosphere)+hash(a.drive));assert.notEqual(hash(a.drive),hash(pinballMusicSamples(pinballMusicRecipe('cabinet.456',theme),8000).drive));
 }
 assert.equal(identities.size,5);
 const source={...PINBALL_MUSIC_BLUEPRINTS.nature,id:'fungal-choir',root:38,scale:[0,3,5,6,10],shape:'tri' as const,kick:[3,11],snare:[],hat:[],airHz:420};
 const recipe=pinballMusicRecipe('seed',source);source.scale[0]=1;assert.equal(recipe.blueprint.scale[0],0);assert.ok(Object.isFrozen(recipe.blueprint.scale));
 const serialized=JSON.parse(JSON.stringify(recipe));assert.equal(hash(pinballMusicSamples(recipe,8000).drive),hash(pinballMusicSamples(serialized,8000).drive));assert.equal(recipe.theme,'fungal-choir');
 assert.throws(()=>pinballMusicSamples({...recipe,theme:'wrong'},8000));assert.throws(()=>pinballMusicRecipe('seed',{...source,bpm:0}));assert.throws(()=>pinballMusicRecipe('seed',{...source,kick:[0,0]}));assert.throws(()=>pinballMusicSamples(recipe,7999));
});
test('music has two cached stems, two active sources and no allocation on invalid admission',()=>{
 let nodes=0,buffers=0,started=0,stopped=0,disconnected=0;const starts:number[]=[];
 const parameter=()=>({value:0,setTargetAtTime(){},cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}});
 const context={sampleRate:48000,currentTime:2,destination:{},createGain(){nodes++;return {gain:parameter(),connect(){},disconnect(){disconnected++;}};},createBuffer(_channels:number,length:number,rate:number){buffers++;const pcm=new Float32Array(length);return {duration:length/rate,getChannelData(){return pcm;}};},createBufferSource(){nodes++;return {buffer:null,loop:false,onended:null,connect(){},disconnect(){disconnected++;},start(_time:number,offset:number){started++;starts.push(offset);},stop(){stopped++;}};}} as unknown as BaseAudioContext;
 assert.throws(()=>createPinballMusic(context,{seed:'seed',theme:'nature',volume:NaN}));assert.equal(nodes,0);
 const music=createPinballMusic(context,{seed:'seed',theme:'nature'});assert.equal(nodes,3);assert.equal(music.stats.cached,0);
 assert.throws(()=>music.start(-1));assert.equal(buffers,0);assert.equal(started,0);
 music.start(240);assert.equal(music.stats.active,2);assert.equal(music.stats.cached,2);assert.equal(buffers,2);assert.deepEqual(starts,[2,2]);
 music.start(360);assert.equal(started,2);music.setIntensity(1);music.duck(.5,.14);assert.equal(music.stats.intensity,1);assert.equal(music.stats.active,2);assert.throws(()=>music.setIntensity(Infinity));
 music.stop();assert.equal(music.stats.active,0);assert.equal(stopped,2);music.start();assert.equal(started,4);assert.equal(buffers,2);music.dispose();music.dispose();music.start();assert.equal(music.stats.active,0);assert.equal(music.stats.cached,0);assert.equal(stopped,4);assert.ok(disconnected>=7);
});
