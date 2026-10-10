import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaInput} from '@keel-engine/pinball-arena';
import {SessionAction} from '@keel-engine/pinball-session';
import {createPinballSessionInput,createPinballSessionControlBinding,createPinballInput,type PinballInputPair} from '../src/index.ts';
const pair:PinballInputPair={arenaId:'field',stationId:'home',ownerId:0,leaseTicks:180,left:'left',right:'right',leftFlipperId:'left',rightFlipperId:'right'};

test('medicine tap, held flipper and launch remain separate admitted channels',()=>{
 const input=createPinballSessionInput({ownerId:0});input.key('KeyA',true);input.key('KeyR',true);input.key('KeyR',false);
 assert.deepEqual(input.sample(),{ownerId:0,bits:ArenaInput.LEFT,steerX:0,steerY:0,actions:SessionAction.MEDKIT});
 assert.equal(input.sample().actions,0);input.key('Space',true);assert.equal(input.sample().bits,ArenaInput.LEFT|ArenaInput.LAUNCH);assert.equal(input.sample().actions,0);
 input.key('KeyR',true);assert.equal(input.sample().actions,SessionAction.MEDKIT);assert.equal(input.sample().actions,SessionAction.MEDKIT);input.neutral();assert.deepEqual(input.sample(),{ownerId:0,bits:0,steerX:0,steerY:0,actions:0});
 assert.equal(createPinballInput({ownerId:0}).key('KeyR',true),false);
});
test('controller medicine and equipment map independently and disconnect releases both',()=>{
 const input=createPinballSessionInput({ownerId:0}),buttons=Array.from({length:9},()=>0);buttons[8]=1;buttons[4]=1;buttons[1]=1;input.setPad({buttons,axes:[0,0],connected:true});
 assert.deepEqual(input.sample(),{ownerId:0,bits:ArenaInput.LEFT|ArenaInput.PULSE,steerX:0,steerY:-0,actions:1});input.setPad(null);assert.equal(input.sample().bits,0);assert.equal(input.sample().actions,0);
});
test('touch action taps coexist with blade sources, and invalid actions fail before state mutation',()=>{
 const input=createPinballSessionInput({ownerId:0});input.setButtons('blade',ArenaInput.RIGHT);input.setActions('heal-touch',1);input.setActions('heal-touch',0);assert.equal(input.sample().actions,1);assert.equal(input.sample().bits,ArenaInput.RIGHT);
 assert.throws(()=>input.setActions('bad',2),/action/);assert.equal(input.sample().actions,0);assert.equal(input.sample().bits,ArenaInput.RIGHT);
});
test('pair changes suppress held blade intent while medicine keeps its own action',()=>{
 const binding=createPinballSessionControlBinding(0);assert.equal(binding.map({ownerId:0,bits:1,actions:1},pair).bits,1);
 assert.deepEqual(binding.map({ownerId:0,bits:1,actions:1},{...pair,stationId:'other'}),{ownerId:0,bits:0,steerX:0,steerY:0,actions:1});
 assert.throws(()=>binding.map({ownerId:0,bits:0,actions:2},pair),/action/);
 assert.equal(binding.map({ownerId:0,bits:1,actions:1},pair).bits,0);binding.map({ownerId:0,bits:0},pair);assert.equal(binding.map({ownerId:0,bits:1,actions:1},pair).bits,1);
});
test('configured mappings are immutable, and cross-channel conflicts are rejected',()=>{
 const configured={KeyZ:1},pads=[{button:10,bits:2}],input=createPinballInput({ownerId:0,keyBindings:configured,gamepadBindings:pads});configured.KeyZ=2;pads[0]!.bits=1;input.key('KeyZ',true);assert.equal(input.sample().bits,1);assert(Object.isFrozen(input.readBindings().keys));
 assert.throws(()=>createPinballSessionInput({ownerId:0,medkitKeys:['Space']}),/conflict/);assert.throws(()=>createPinballSessionInput({ownerId:0,medkitPadButtons:[4]}),/conflict/);
 const medicine=createPinballSessionInput({ownerId:0,medkitKeys:['KeyH'],medkitPadButtons:[10]});assert.equal(medicine.key('KeyR',true),false);medicine.key('KeyH',true);assert.equal(medicine.sample().actions,1);assert.equal(medicine.sample().bits,0);
});
test('attached samplers share one controller snapshot, and hidden state clears medicine and blades',()=>{
 const target=new EventTarget(),document=new EventTarget();let hidden=false,reads=0;
 Object.defineProperties(document,{hidden:{get:()=>hidden},hasFocus:{value:()=>true},defaultView:{value:target}});
 Object.defineProperty(target,'document',{value:document});
 const buttons=Array.from({length:9},()=>({pressed:false,value:0,touched:false}));buttons[4]!.pressed=true;buttons[8]!.pressed=true;
 const navigator={getGamepads:()=>{reads++;return[{connected:true,mapping:'standard',buttons,axes:[0,0]} as unknown as Gamepad];}},input=createPinballSessionInput({ownerId:0}),detach=input.attach({target:target as Window,document:document as Document,navigator});
 const first=input.sample();assert.equal(reads,1);assert.equal(first.bits,1);assert.equal(first.actions,1);input.sample();assert.equal(reads,2);
 hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(input.sample().bits,0);assert.equal(input.sample().actions,0);assert.equal(reads,2);
 hidden=false;document.dispatchEvent(new Event('visibilitychange'));assert.equal(input.sample().actions,1);detach();assert.equal(input.sample().actions,0);
});
test('medicine pointers retain another finger and cancellation removes a between-step pending tap',()=>{
 const target=new EventTarget(),document=new EventTarget();Object.defineProperties(document,{hidden:{value:false},defaultView:{value:target}});
 const element=new EventTarget();Object.defineProperties(element,{ownerDocument:{value:document},setPointerCapture:{value:()=>{}}});
 const input=createPinballSessionInput({ownerId:0}),unbind=input.bindActionButton(element as HTMLElement,'medkit');
 const pointer=(type:string,id:number)=>{const event=new Event(type,{cancelable:true});Object.defineProperties(event,{pointerId:{value:id},button:{value:0}});element.dispatchEvent(event);};
 pointer('pointerdown',1);pointer('pointerdown',2);pointer('pointerup',1);assert.equal(input.sample().actions,1);pointer('pointerup',2);assert.equal(input.sample().actions,0);
 pointer('pointerdown',3);pointer('pointercancel',3);assert.equal(input.sample().actions,0);pointer('pointerdown',4);target.dispatchEvent(new Event('blur'));assert.equal(input.sample().actions,0);unbind();
});
test('initially hidden or unfocused attachment discards pre-attachment launch and medicine taps',()=>{
 for(const initiallyHidden of [true,false]){
  const target=new EventTarget(),document=new EventTarget();let hidden=initiallyHidden,focused=false;Object.defineProperties(document,{hidden:{get:()=>hidden},hasFocus:{value:()=>focused},defaultView:{value:target}});Object.defineProperty(target,'document',{value:document});
  const input=createPinballSessionInput({ownerId:0});input.key('Space',true);input.key('Space',false);input.key('KeyR',true);input.key('KeyR',false);
  const detach=input.attach({target:target as Window,document:document as Document,navigator:{getGamepads:()=>[]}});hidden=false;focused=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(input.sample().bits,0);assert.equal(input.sample().actions,0);detach();
 }
});
test('32 external sources leave reserved device capacity, and zero action sources do not allocate slots',()=>{
 const input=createPinballSessionInput({ownerId:0});for(let i=0;i<32;i++){input.setButtons('held-'+i,1);input.setActions('zero-'+i,0);}
 assert.equal(input.sample().bits,1);assert.equal(input.sample().actions,0);assert.throws(()=>input.setButtons('overflow',2),/source cap/);input.setActions('heal',1);assert.equal(input.sample().actions,1);
});
test('a failed second channel does not consume a pending launch or medicine tap',()=>{
 const input=createPinballSessionInput({ownerId:0});input.key('Space',true);input.key('Space',false);input.key('KeyR',true);input.key('KeyR',false);
 const buttons=Array.from({length:9},()=>({pressed:false}));Object.defineProperty(buttons[8]!,'pressed',{get:()=>{throw Error('Failed medicine pad read');}});input.setPad({buttons,axes:[0,0]});assert.throws(()=>input.sample(),/Failed medicine/);input.setPad(null);
 const recovered=input.sample();assert.equal(recovered.bits,4);assert.equal(recovered.actions,1);assert.equal(input.sample().bits,0);assert.equal(input.sample().actions,0);
});
test('a rejected pointer never becomes a ghost hold, and capture failure restores earlier pending state',()=>{
 const input=createPinballInput({ownerId:0}),document=new EventTarget(),target=new EventTarget();Object.defineProperties(document,{hidden:{value:false},defaultView:{value:target}});
 const handlers=new Map<string,EventListener>(),element={ownerDocument:document,setPointerCapture:()=>{},addEventListener(type:string,listener:EventListener){handlers.set(type,listener);},removeEventListener(type:string){handlers.delete(type);}};
 const unbind=input.bindButton(element as unknown as HTMLElement,'extra',2),pointer=(type:string,pointerId:number)=>handlers.get(type)!({button:0,pointerId,preventDefault:()=>{}} as unknown as Event);
 for(let i=0;i<32;i++)input.setButtons('held-'+i,1);assert.throws(()=>pointer('pointerdown',100),/source cap/);input.setButtons('held-0',0);input.sample();pointer('pointerdown',101);assert.equal(input.sample().bits,3);pointer('pointerup',101);assert.equal(input.sample().bits,1);unbind();
 const failed=createPinballInput({ownerId:0}),listeners=new Map<string,EventListener>(),bad={...element,setPointerCapture:()=>{throw Error('Capture failed');},addEventListener(type:string,listener:EventListener){listeners.set(type,listener);},removeEventListener(type:string){listeners.delete(type);}};
 const release=failed.bindButton(bad as unknown as HTMLElement,'capture',2);failed.key('Space',true);failed.key('Space',false);assert.throws(()=>listeners.get('pointerdown')!({button:0,pointerId:1,preventDefault:()=>{}} as unknown as Event),/Capture failed/);assert.equal(failed.sample().bits,4);assert.equal(failed.sample().bits,0);release();
});
