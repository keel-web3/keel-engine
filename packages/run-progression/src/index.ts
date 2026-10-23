export {manifest} from './module.ts';
import {createRoll,deriveSeed} from '@keel-engine/core/rng';
export const RUN_RULES_VERSION='keel-pinball-run-rules@1';
export const RUN_CLASSES=Object.freeze({striker:Object.freeze({name:'Striker',health:3,shields:0,skills:Object.freeze([{id:'drive',name:'Drive',cooldownTicks:180},{id:'cross-shot',name:'Cross Shot',cooldownTicks:300}].map(value=>Object.freeze(value))),ultimate:'Overdrive'}),warden:Object.freeze({name:'Warden',health:4,shields:1,skills:Object.freeze([{id:'guard',name:'Guard',cooldownTicks:900},{id:'rescue',name:'Rescue',cooldownTicks:600}].map(value=>Object.freeze(value))),ultimate:'Bastion'})});
export type RunClassId=keyof typeof RUN_CLASSES;
export const UPGRADE_IDS=['hull','power','score','haste','charge'] as const;
export type PermanentUpgradeId=typeof UPGRADE_IDS[number];
export type UpgradeLevels=Record<PermanentUpgradeId,number>;
export interface UpgradeChoice {readonly id:string;readonly name:string;readonly description:string}
const catalogue:readonly UpgradeChoice[]=Object.freeze([
 {id:'hull',name:'Hull Plating',description:'+1 maximum hull and repair 1 hull (maximum 4 levels).'},
 {id:'power',name:'Flux Drive',description:'Ability impulses gain 0.5 power; every 2 levels adds 1 guardian damage (maximum 4 levels).'},
 {id:'score',name:'Resonant Coils',description:'+15% hit score (maximum 4 levels).'},
 {id:'haste',name:'Fast Capacitors',description:'Skill cooldowns are 10% shorter (maximum 4 levels).'},
 {id:'charge',name:'Charge Conduit',description:'+5 ultimate charge per bumper hit (maximum 4 levels).'},
 {id:'repair',name:'Field Repair',description:'Restore 2 hull, up to your maximum.'},
 {id:'shield',name:'Shield Cache',description:'Gain 1 drain shield, up to 3.'},
 {id:'battery',name:'Charge Cell',description:'Gain 40 ultimate charge, up to 100.'},
].map(value=>Object.freeze(value)));
export function emptyUpgradeLevels():UpgradeLevels{return {hull:0,power:0,score:0,haste:0,charge:0};}
export function validateUpgradeLevels(value:unknown):UpgradeLevels {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==UPGRADE_IDS.length)throw new Error('Invalid upgrade levels');
 const out=emptyUpgradeLevels();for(const id of UPGRADE_IDS){const n=(value as UpgradeLevels)[id];if(!Number.isInteger(n)||n<0||n>4)throw new Error('Invalid bounded upgrade level');out[id]=n;}return out;
}
export function createUpgradeChoices(stageSeed:string,levels:UpgradeLevels):readonly UpgradeChoice[]{
 const valid=validateUpgradeLevels(levels),roll=createRoll(deriveSeed(stageSeed,`${RUN_RULES_VERSION}:upgrade-draft`));
 return Object.freeze(catalogue.map((choice,index)=>({choice,rank:roll.at(16+index),index})).filter(({choice})=>!UPGRADE_IDS.includes(choice.id as PermanentUpgradeId)||valid[choice.id as PermanentUpgradeId]<4).sort((a,b)=>a.rank-b.rank||a.index-b.index).slice(0,3).map(({choice})=>choice));
}
export function skillCooldown(classId:RunClassId,slot:number,levels:UpgradeLevels):number{return Math.max(30,Math.floor(RUN_CLASSES[classId].skills[slot]!.cooldownTicks*(100-levels.haste*10)/100));}
export function hitAward(points:number,combo:number,levels:UpgradeLevels,overdrive:boolean):number {const percent=Math.min(400,(100+levels.score*15+Math.min(10,Math.max(0,combo-1))*5)*(overdrive?2:1));return Math.floor(points*percent/100);}
