export type EquipmentSlot='weapon'|'passive';
export interface EquipmentDefinition {
 readonly id:string;readonly name:string;readonly slot:EquipmentSlot;
 readonly impactDamage:number;readonly passingDamage:number;readonly passingRadius:number;
 readonly minimumSpeed:number;readonly cooldownTicks:number;
}
export const STARTER_EQUIPMENT:readonly EquipmentDefinition[]=Object.freeze([
 {id:'impact-core',name:'Impact Core',slot:'weapon',impactDamage:1,passingDamage:0,passingRadius:0,minimumSpeed:3,cooldownTicks:120},
 {id:'arc-field',name:'Arc Field',slot:'passive',impactDamage:0,passingDamage:1,passingRadius:56,minimumSpeed:4,cooldownTicks:180},
 {id:'quiet-drive',name:'Quiet Drive',slot:'passive',impactDamage:0,passingDamage:0,passingRadius:0,minimumSpeed:0,cooldownTicks:120},
].map(item=>Object.freeze(item as EquipmentDefinition)));
const integer=(n:unknown,lo:number,hi:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=lo&&n<=hi;
export function admitEquipment(source:readonly EquipmentDefinition[]):readonly EquipmentDefinition[]{
 if(!Array.isArray(source)||source.length<1||source.length>64||new Set(source.map(item=>item.id)).size!==source.length)throw new Error('Equipment catalogue bound');
 return Object.freeze(source.map(item=>{
  if(!item||Object.keys(item).sort().join(',')!=='cooldownTicks,id,impactDamage,minimumSpeed,name,passingDamage,passingRadius,slot'||typeof item.id!=='string'||!/^[a-z][a-z0-9.-]{0,63}$/.test(item.id)||typeof item.name!=='string'||item.name.length<1||item.name.length>80||!['weapon','passive'].includes(item.slot)||!integer(item.impactDamage,0,10)||!integer(item.passingDamage,0,10)||!integer(item.passingRadius,0,160)||!integer(item.minimumSpeed,0,18)||!integer(item.cooldownTicks,90,12000)||(item.passingDamage>0)!==(item.passingRadius>0))throw new Error('Invalid equipment definition');
  return Object.freeze({...item});
 }));
}
