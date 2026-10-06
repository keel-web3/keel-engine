import test from 'node:test';import assert from 'node:assert/strict';
import {srgb8ToLinear} from '../src/color.ts';import {plainRole} from '../src/role.ts';
import {availableStorage,browserStorage} from '../../ui/src/store.ts';
test('shared colour conversion preserves fractional, byte and exceptional input behavior',()=>{
 const old=(c:number)=>{const v=c/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4};
 for(let channel=-255;channel<=511;channel+=.25)assert.ok(Object.is(srgb8ToLinear(channel),old(channel)));
 for(const channel of [NaN,Infinity,-Infinity,-0])assert.ok(Object.is(srgb8ToLinear(channel),old(channel)));
});
test('plain material roles retain unclamped values and fresh pattern records',()=>{
 const one=plainRole(-10,.16,.8,'glow'),two=plainRole(-10,.16,.8,'glow');
 assert.deepEqual(one,{hue:-10,chroma:.16,light:.8,span:.3,finish:'glow',pattern:{kind:'none',freq:1,angle:0,width:4,shift:0,ink:null}});
 assert.notEqual(one.pattern,two.pattern);assert.equal(plainRole(720,.2,.3,'metal',.45).span,.45);
});
test('read-only storage remains readable without probe writes',()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let writes=0;
 const storage={getItem:()=> '42',setItem:()=>{writes++;throw Error('quota')},removeItem:()=>{}};
 try{Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});for(let i=0;i<100;i++)assert.equal(availableStorage()?.getItem('score'),'42');assert.equal(writes,0);assert.equal(browserStorage(),null);assert.equal(writes,1);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked')}});assert.equal(availableStorage(),null);
 }finally{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete (globalThis as any).localStorage}
});
