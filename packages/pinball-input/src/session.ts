import {ArenaInput} from '@keel-engine/pinball-arena';
import {SessionAction,type SessionOwnerInput} from '@keel-engine/pinball-session';
import type {KeyEventLike,PadState} from '@keel-engine/input';
import {createPinballInput,type PinballInputOptions,type PinballInputAttachOptions} from './device.ts';
import {createPinballControlBinding,type PinballInputPair} from './side-binding.ts';

export const PINBALL_SESSION_INPUT_REVISION='pinball-session-input/2026-10-07.1';

export interface PinballSessionInputOptions extends PinballInputOptions {
 readonly medkitKeys?:readonly string[];
 readonly medkitPadButtons?:readonly number[];
}
const action=(value:number)=>{if(!Number.isSafeInteger(value)||value<0||value>SessionAction.MEDKIT)throw Error('Invalid pinball session device action');return value;};

/** The existing device sampler supplies both channels. Its private medicine
 * sampler uses a launch bit only internally; that bit never reaches the arena.
 * Focus, tap latching, pointers and controller release share the same code. */
export function createPinballSessionInput(options:PinballSessionInputOptions){
 const arena=createPinballInput(options),keys=options.medkitKeys??['KeyR'],buttons=options.medkitPadButtons??[8];
 if(!Array.isArray(keys)||!Array.isArray(buttons)||new Set(keys).size!==keys.length||new Set(buttons).size!==buttons.length)throw Error('Invalid pinball medkit bindings');
 const nativeBindings=arena.readBindings();
 if(keys.some(key=>(nativeBindings.keys[key]??0)!==0)||buttons.some(button=>nativeBindings.gamepad.some(binding=>binding.button===button&&binding.bits!==0)))throw Error('Pinball medicine and arena bindings conflict');
 const medicine=createPinballInput({ownerId:options.ownerId,...(options.deadzone===undefined?{}:{deadzone:options.deadzone}),keyBindings:Object.fromEntries(keys.map(code=>[code,ArenaInput.LAUNCH])),gamepadBindings:buttons.map(button=>({button,bits:ArenaInput.LAUNCH}))});
 let cachedPads:ReturnType<Navigator['getGamepads']>|undefined;
 function neutral(){arena.neutral();medicine.neutral();cachedPads=undefined;}
 function sample():SessionOwnerInput{try{const control=arena.peek(),actions=medicine.peek().bits&ArenaInput.LAUNCH?SessionAction.MEDKIT:0;arena.consumePending();medicine.consumePending();return{...control,actions};}finally{cachedPads=undefined;}}
 function attach(settings:PinballInputAttachOptions){
  const nav=settings.navigator??settings.target.navigator,sharedNavigator={getGamepads:()=>cachedPads??=nav.getGamepads?.()??[]};
  const detachArena=arena.attach({...settings,navigator:sharedNavigator});let detachMedicine:()=>void;
  try{detachMedicine=medicine.attach({...settings,navigator:sharedNavigator});}catch(error){detachArena();throw error;}
  return()=>{detachArena();detachMedicine();neutral();};
 }
 return{
  sample,neutral,attach,
  key(event:string|KeyEventLike,down:boolean){const acceptedArena=arena.key(event,down),acceptedMedicine=medicine.key(event,down);return acceptedArena||acceptedMedicine;},
  setPad(value:PadState|null){arena.setPad(value);medicine.setPad(value);},
  setButtons:arena.setButtons,bindButton:arena.bindButton,
  setActions(source:string,value:number){medicine.setButtons(source,action(value)?ArenaInput.LAUNCH:0);},
  bindActionButton(element:HTMLElement,source:string,value=SessionAction.MEDKIT){return medicine.bindButton(element,source,action(value)?ArenaInput.LAUNCH:0);},
 };
}

/** Pair/lease changes suppress stale blade intent while medicine retains its
 * separate accepted action. Neither channel creates a lease or changes HP. */
export function createPinballSessionControlBinding(ownerId:number){
 const binding=createPinballControlBinding(ownerId);
 return{map(input:SessionOwnerInput,pair:PinballInputPair|null):SessionOwnerInput{const actions=action(input.actions??0);return{...binding.map(input,pair),actions};},cancel:binding.cancel};
}
