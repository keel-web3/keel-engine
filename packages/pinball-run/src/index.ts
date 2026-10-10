export {manifest} from './module.ts';
import {createClassicWorld} from '@keel-engine/pinball-world';
import type {ClassicFrame,LaunchSocketRules} from '@keel-engine/pinball-world';
import {createCabinetRecipe,createCabinetStage,MAX_CABINET_STAGE} from '@keel-engine/pinball-mapgen';
import type {CabinetRecipe,CabinetLayout} from '@keel-engine/pinball-mapgen';
import {compilePinballMap} from '@keel-engine/pinball-map';
import type {PinballMap} from '@keel-engine/pinball-map';
import {KERNEL_SHA256} from '@keel-engine/pinball-physics';
import {RUN_CLASSES,RUN_RULES_VERSION,UPGRADE_IDS,emptyUpgradeLevels,validateUpgradeLevels,createUpgradeChoices,skillCooldown,hitAward} from '@keel-engine/run-progression';
import type {RunClassId,UpgradeLevels,PermanentUpgradeId,UpgradeChoice} from '@keel-engine/run-progression';
import {sha256,toHex} from '@keel-engine/codec/hash';
export const PINBALL_RUN_VERSION='keel-pinball-run@1';
export const RunInput=Object.freeze({LEFT:1,RIGHT:2,LAUNCH:4,RESTART:8,SKILL1:16,SKILL2:32,ULTIMATE:64,CHOICE1:128,CHOICE2:256,CHOICE3:512});
export interface RunOptions {layouts?:readonly CabinetLayout[];classId:RunClassId;profile:'endless'|'campaign';campaignStages?:number;startStage?:number;objectiveIds?:readonly string[];launchSocket?:Partial<LaunchSocketRules>}
export interface RunEvent {id:string;tick:number;type:string;colliderId?:string;ballId?:string;points?:number;x?:number;y?:number;abilityId?:string;upgradeId?:string}
export type RunPhase='ready'|'playing'|'draft'|'defeated'|'completed';
export type RunFrame=Omit<ClassicFrame,'events'> & {runTick:number;events:RunEvent[];runPhase:RunPhase;profile:'endless'|'campaign';stageIndex:number;campaignCheckpoint:number;health:number;maxHealth:number;shields:number;runScore:number;combo:number;objectiveProgress:number;objectiveTarget:number;hitIds:string[];objectiveIds:readonly string[];classId:RunClassId;skills:{id:string;name:string;cooldownRemaining:number;cooldownTicks:number}[];ultimateCharge:number;ultimateName:string;overdriveTicks:number;upgradeChoices:readonly UpgradeChoice[];upgrades:{id:string;level:number}[];encounter:'table'|'guardian';bossHealth:number;maxBossHealth:number;bossPhase:0|1|2;hazardWarning:boolean;hazardCountdown:number};
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const hash=(value:unknown)=>toHex(sha256(encode(value)));
const int=(v:unknown,lo:number,hi:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=lo&&v<=hi;
export function createPinballRun(cabinetSource:CabinetRecipe,baseSource:PinballMap,options:RunOptions){
 if(!Object.hasOwn(RUN_CLASSES,options.classId)||!['endless','campaign'].includes(options.profile))throw new Error('Invalid run class/profile');
 const classId=options.classId,profile=options.profile,definition=RUN_CLASSES[classId],campaignStages=options.campaignStages??3,startStage=options.startStage??0;
 if(!int(campaignStages,1,100)||!int(startStage,0,campaignStages-1)||(profile==='endless'&&startStage!==0))throw new Error('Invalid campaign start/checkpoint');
 const cabinet=createCabinetRecipe(cabinetSource.seed,{theme:cabinetSource.theme,style:cabinetSource.style});if(cabinet.sha256!==cabinetSource.sha256)throw new Error('Cabinet identity mismatch');
 const base=compilePinballMap(baseSource),layouts=options.layouts===undefined?undefined:JSON.parse(JSON.stringify(options.layouts)) as CabinetLayout[];
 const objectiveIds=Object.freeze([...(options.objectiveIds??base.bumpers.slice(0,3).map(b=>b.id))].sort());
 if(objectiveIds.length<1||objectiveIds.length>3||new Set(objectiveIds).size!==objectiveIds.length||objectiveIds.some(id=>!base.bumpers.some(b=>b.id===id)))throw new Error('Objective IDs must name 1..3 distinct canonical bumpers');
 const stageOptions=layouts===undefined?{}:{layouts};
 const makeStage=(index:number)=>createCabinetStage(cabinet,index,base,stageOptions);
 const worldRules=Object.freeze({balls:9,ballSaveTicks:360,...(options.launchSocket===undefined?{}:{launchSocket:Object.freeze({...options.launchSocket})})});
 let stage=makeStage(startStage),world=createClassicWorld(stage.map,worldRules);
 const identity=hash({schema:PINBALL_RUN_VERSION,rules:RUN_RULES_VERSION,kernel:KERNEL_SHA256,cabinet:cabinet.sha256,template:stage.templateSha256,classId,profile,campaignStages,startStage,objectiveIds,worldRules:world.rules,guardian:profile==='endless'?'keel-pinball-guardian@1':null});
 let levels=emptyUpgradeLevels(),runTick=0,playTick=0,previousInput=0,phase:RunPhase='ready',health:number=definition.health,shields:number=definition.shields,runScore=0,combo=0,lastHitTick=-1000,hitCount=0,hitIds:string[]=[],cooldowns=[0,0],charge=0,overdrive=0,cycle=0,attempt=0;
 let checkpoint={stageIndex:startStage,levels:emptyUpgradeLevels(),score:0};
 let choices:readonly UpgradeChoice[]=[],events:RunEvent[]=[];
 const guardianMaximum=(index:number)=>profile==='endless'&&(index+1)%5===0?8+Math.min(12,Math.floor(index/5)*2):0;
 let bossHealth=guardianMaximum(stage.stageIndex),hazardCountdown=bossHealth>0?180:0;
 const guardianPhase=():0|1|2=>bossHealth===0?0:bossHealth*2<=guardianMaximum(stage.stageIndex)?2:1;
 const maximumHealth=()=>definition.health+levels.hull;
 const target=()=>4+Math.min(stage.stageIndex,12);
 const emit=(type:string,extra:Partial<RunEvent>={})=>events.push({id:`${runTick}:${stage.stageIndex}:${cycle}:${events.length}:${type}`,tick:runTick,type,...extra});
 function readFrame():RunFrame{const f=world.readFrame();return {...f,tick:runTick,runTick,phase:phase==='defeated'||phase==='completed'?'gameover':f.phase,canLaunch:(phase==='ready'||phase==='playing')&&f.canLaunch,score:runScore,events:events.map(e=>({...e})),runPhase:phase,profile,stageIndex:stage.stageIndex,campaignCheckpoint:checkpoint.stageIndex,health,maxHealth:maximumHealth(),shields,runScore,combo,objectiveProgress:Math.min(hitCount,target()),objectiveTarget:target(),hitIds:[...hitIds],objectiveIds,classId,skills:definition.skills.map((skill,i)=>({...skill,cooldownRemaining:cooldowns[i]!,cooldownTicks:skillCooldown(classId,i,levels)})),ultimateCharge:charge,ultimateName:definition.ultimate,overdriveTicks:overdrive,upgradeChoices:choices,upgrades:UPGRADE_IDS.filter(id=>levels[id]>0).map(id=>({id,level:levels[id]})),encounter:guardianMaximum(stage.stageIndex)>0?'guardian':'table',bossHealth,maxBossHealth:guardianMaximum(stage.stageIndex),bossPhase:guardianPhase(),hazardWarning:bossHealth>0&&hazardCountdown<=60&&phase==='playing'&&f.balls[0]!.active,hazardCountdown};}
 function enter(index:number):void {stage=makeStage(index);world=createClassicWorld(stage.map,worldRules);phase='ready';hitCount=0;hitIds=[];combo=0;lastHitTick=-1000;cooldowns=[0,0];overdrive=0;choices=[];cycle=0;bossHealth=guardianMaximum(index);hazardCountdown=bossHealth>0?180:0;emit('stage-start');}
 function restart():void {attempt++;if(profile==='campaign'){levels={...checkpoint.levels};runScore=checkpoint.score;}else {levels=emptyUpgradeLevels();runScore=0;checkpoint={stageIndex:0,levels:emptyUpgradeLevels(),score:0};}health=maximumHealth();shields=definition.shields;charge=0;playTick=0;enter(profile==='campaign'?checkpoint.stageIndex:0);emit('restart');}
 function choose(index:number):void {const choice=choices[index];if(!choice)return;
  if(UPGRADE_IDS.includes(choice.id as PermanentUpgradeId)){const id=choice.id as PermanentUpgradeId;levels[id]++;if(id==='hull')health=Math.min(maximumHealth(),health+1);}
  else if(choice.id==='repair')health=Math.min(maximumHealth(),health+2);else if(choice.id==='shield')shields=Math.min(3,shields+1);else if(choice.id==='battery')charge=Math.min(100,charge+40);
  emit('upgrade',{upgradeId:choice.id});const next=stage.stageIndex+1;enter(next);if(profile==='campaign')checkpoint={stageIndex:next,levels:{...levels},score:runScore};
 }
 function activate(slot:number):void {if(cooldowns[slot]!==0||!world.readFrame().balls[0]!.active)return;const b=world.readFrame().balls[0]!,power=levels.power*.5;let used=false;
  if(classId==='striker'){used=slot===0?world.applyBallImpulse(0,-4-power):world.applyBallImpulse((b.x<stage.map.width/2?1:-1)*(3+power),-2-power);}
  else if(slot===0){if(shields<3){shields++;used=true;}}else if(b.y>stage.map.height*.65&&b.vy>=0){used=world.applyBallImpulse(0,-(b.vy+4+power));}
  if(used){cooldowns[slot]=skillCooldown(classId,slot,levels);emit('ability',{abilityId:definition.skills[slot]!.id});}
 }
 function ultimate():void {if(charge<100||!world.readFrame().balls[0]!.active)return;charge=0;if(classId==='striker'){overdrive=600;world.applyBallImpulse(0,-6-levels.power*.5);}else{shields=Math.min(3,shields+2);health=Math.min(maximumHealth(),health+1);}emit('ability',{abilityId:classId==='striker'?'overdrive':'bastion'});}
 function step(bits:number):RunFrame {
  if(!int(bits,0,1023))throw new Error('Invalid run input bits');
  if((phase==='draft'||phase==='defeated'||phase==='completed')&&bits===previousInput)return {...readFrame(),events:[]};
  if(runTick>=2147480000)throw new Error('Run tick bound reached');runTick++;events=[];const edge=bits&~previousInput;previousInput=bits;
  if(edge&8){restart();return readFrame();}
  if(phase==='draft'){const selection=edge&896;if(selection&&(selection&(selection-1))===0)choose(selection===128?0:selection===256?1:2);return readFrame();}
  if(phase==='defeated'||phase==='completed')return readFrame();
  playTick++;if(playTick-lastHitTick>240)combo=0;cooldowns=cooldowns.map(n=>Math.max(0,n-1));overdrive=Math.max(0,overdrive-1);
  if(bossHealth>0&&world.readFrame().balls[0]!.active){hazardCountdown--;if(hazardCountdown===60)emit('guardian-warning');if(hazardCountdown===0){world.applyBallImpulse(0,guardianPhase()===2?4:2);hazardCountdown=guardianPhase()===2?240:360;emit('guardian-strike');}}
  if(edge&16)activate(0);if(edge&32)activate(1);if(edge&64)ultimate();
  const f=world.step(bits&7);for(const event of f.events){events.push({...event,id:`${runTick}:${stage.stageIndex}:${cycle}:${event.id}`,tick:runTick});if(event.type==='bumper'){
    combo=playTick-lastHitTick<=240?Math.min(20,combo+1):1;lastHitTick=playTick;const award=hitAward(event.points??0,combo,levels,overdrive>0);runScore=Math.min(2147483647,runScore+award);events[events.length-1]!.points=award;charge=Math.min(100,charge+15+levels.charge*5);
    if(objectiveIds.includes(event.colliderId!)){hitCount=Math.min(100000,hitCount+1);if(!hitIds.includes(event.colliderId!))hitIds.push(event.colliderId!);hitIds.sort();if(bossHealth>0){const priorPhase=guardianPhase();bossHealth=Math.max(0,bossHealth-1-Math.floor(levels.power/2));emit('guardian-hit',{colliderId:event.colliderId!});if(bossHealth===0){hazardCountdown=0;emit('guardian-defeated');}else if(guardianPhase()!==priorPhase){hazardCountdown=Math.min(hazardCountdown,120);emit('guardian-phase');}}}
   }}
  if(f.events.some(e=>e.type==='drain')&&!f.events.some(e=>e.type==='ball-save')){combo=0;if(shields>0){shields--;emit('shield');}else {health--;emit('damage');}}
  if(health<=0){health=0;phase='defeated';emit('defeated');return readFrame();}
  if(hitIds.length===objectiveIds.length&&hitCount>=target()&&bossHealth===0){
    emit('stage-clear');if((profile==='campaign'&&stage.stageIndex+1>=campaignStages)||stage.stageIndex===MAX_CABINET_STAGE){phase='completed';emit('completed');}else{phase='draft';choices=createUpgradeChoices(stage.stageSeed,levels);}return readFrame();
  }
  if(f.phase==='gameover'){cycle++;world=createClassicWorld(stage.map,worldRules);emit('resupply');}
  phase=world.readFrame().phase==='ready'?'ready':'playing';return readFrame();
 }
 function snapshot():Uint8Array{return encode({schema:PINBALL_RUN_VERSION,identity,stageIndex:stage.stageIndex,mapSha256:stage.mapSha256,runTick,playTick,previousInput,phase,health,shields,runScore,combo,lastHitTick,hitCount,hitIds,levels,cooldowns,charge,overdrive,cycle,attempt,bossHealth,hazardCountdown,checkpoint,events,world:new TextDecoder().decode(world.snapshot())});}
 function restore(bytes:Uint8Array):void {
  if(bytes.byteLength>350000)throw new Error('Run snapshot exceeds bound');const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(d.schema!==PINBALL_RUN_VERSION||d.identity!==identity||!int(d.stageIndex,startStage,profile==='campaign'?campaignStages-1:MAX_CABINET_STAGE))throw new Error('Incompatible run snapshot');
  const nextLevels=validateUpgradeLevels(d.levels),maxHealth=definition.health+nextLevels.hull;
  const bossMaximum=guardianMaximum(d.stageIndex);if(!int(d.bossHealth,0,bossMaximum)||d.bossHealth!==Math.max(0,bossMaximum-d.hitCount*(1+Math.floor(nextLevels.power/2)))||!int(d.hazardCountdown,0,360)||(d.bossHealth>0?d.hazardCountdown===0:d.hazardCountdown!==0)||(bossMaximum>0&&d.bossHealth<bossMaximum&&d.hitCount===0))throw new Error('Invalid guardian snapshot');
  if(!int(d.runTick,0,2147480000)||!int(d.playTick,0,d.runTick)||!int(d.previousInput,0,1023)||!['ready','playing','draft','defeated','completed'].includes(d.phase)||!int(d.health,0,maxHealth)||!int(d.shields,0,3)||!int(d.runScore,0,2147483647)||!int(d.combo,0,20)||!int(d.lastHitTick,-1000,d.playTick)||!int(d.hitCount,0,100000)||!int(d.charge,0,100)||!int(d.overdrive,0,600)||!int(d.cycle,0,d.runTick)||!int(d.attempt,0,d.runTick)||!Array.isArray(d.cooldowns)||d.cooldowns.length!==2||d.cooldowns.some((n:unknown,i:number)=>!int(n,0,skillCooldown(classId,i,nextLevels)))||!Array.isArray(d.hitIds)||new Set(d.hitIds).size!==d.hitIds.length||d.hitIds.some((id:unknown)=>typeof id!=='string'||!objectiveIds.includes(id))||d.hitCount<d.hitIds.length||!Array.isArray(d.events)||d.events.length>80||d.events.some((e:RunEvent)=>typeof e.id!=='string'||e.tick!==d.runTick||typeof e.type!=='string')||typeof d.world!=='string')throw new Error('Invalid run snapshot state');
  if(UPGRADE_IDS.reduce((sum,id)=>sum+nextLevels[id],0)>d.stageIndex-startStage||JSON.stringify(d.hitIds)!==JSON.stringify([...d.hitIds].sort())||(d.lastHitTick!==-1000&&d.lastHitTick<1))throw new Error('Impossible upgrade or contact history');
  if(d.playTick===0&&(d.charge!==0||d.overdrive!==0||d.combo!==0||d.lastHitTick!==-1000||d.hitCount!==0||d.cooldowns.some((n:number)=>n!==0)))throw new Error('Impossible unplayed ability state');
  if(d.runScore===0&&base.bumpers.every(b=>(b.points??100)>0)&&(d.combo!==0||d.lastHitTick!==-1000||d.hitCount!==0||d.charge!==0||d.overdrive!==0))throw new Error('Impossible unscored contact state');
  if((d.health===0)!==(d.phase==='defeated')||(classId==='warden'&&d.overdrive!==0))throw new Error('Inconsistent run life state');
  const nextStage=makeStage(d.stageIndex);if(nextStage.mapSha256!==d.mapSha256)throw new Error('Run snapshot map mismatch');
  const complete=d.hitIds.length===objectiveIds.length&&d.hitCount>=4+Math.min(d.stageIndex,12)&&d.bossHealth===0;
  if(complete&&(d.phase==='ready'||d.phase==='playing'))throw new Error('Uncommitted stage clear');
  if((d.phase==='draft'||d.phase==='completed')&&!complete)throw new Error('Uncleared run stage');
  if(d.phase==='draft'&&profile==='campaign'&&d.stageIndex+1>=campaignStages)throw new Error('Invalid campaign draft');
  if(d.phase==='completed'&&!(profile==='campaign'&&d.stageIndex+1===campaignStages)&&d.stageIndex!==MAX_CABINET_STAGE)throw new Error('Invalid completion');
  if(!d.checkpoint||!int(d.checkpoint.stageIndex,startStage,profile==='campaign'?d.stageIndex:0)||!int(d.checkpoint.score,0,d.runScore))throw new Error('Invalid campaign checkpoint');
  const checkpointLevels=validateUpgradeLevels(d.checkpoint.levels);if(UPGRADE_IDS.some(id=>checkpointLevels[id]>nextLevels[id])||(profile==='campaign'&&d.checkpoint.stageIndex!==d.stageIndex))throw new Error('Invalid checkpoint upgrades');
  const candidate=createClassicWorld(nextStage.map,worldRules);candidate.restore(new TextEncoder().encode(d.world));const wf=candidate.readFrame();
  if(d.runScore<wf.score||(d.hitCount>0&&((wf.tick===0&&d.cycle===0)||d.lastHitTick<1||d.playTick<1))||((d.phase==='draft'||d.phase==='completed')&&wf.phase!=='playing'&&!wf.events.some(e=>e.type==='drain')))throw new Error('Impossible run contact lifecycle');
  if(bossMaximum>0&&wf.tick===0&&d.cycle===0&&d.hazardCountdown!==180)throw new Error('Impossible initial guardian timer');
  if(wf.tick>d.playTick||(d.phase==='ready'&&wf.phase!=='ready')||(d.phase==='playing'&&wf.phase!=='playing'))throw new Error('Inconsistent run world phase');
  stage=nextStage;world=candidate;levels=nextLevels;runTick=d.runTick;playTick=d.playTick;previousInput=d.previousInput;phase=d.phase;health=d.health;shields=d.shields;runScore=d.runScore;combo=d.combo;lastHitTick=d.lastHitTick;hitCount=d.hitCount;hitIds=[...d.hitIds];cooldowns=[...d.cooldowns];charge=d.charge;overdrive=d.overdrive;cycle=d.cycle;attempt=d.attempt;bossHealth=d.bossHealth;hazardCountdown=d.hazardCountdown;checkpoint={stageIndex:d.checkpoint.stageIndex,levels:checkpointLevels,score:d.checkpoint.score};events=d.events.map((e:RunEvent)=>({...e}));choices=phase==='draft'?createUpgradeChoices(stage.stageSeed,levels):[];
 }
 return {get map(){return stage.map;},step,readFrame,readEvents:()=>events.map(e=>({...e})),snapshot,restore,getStage:()=>stage};
}
export type PinballRun=ReturnType<typeof createPinballRun>;
