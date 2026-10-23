import {ArenaInput,admitArenaInput} from '@keel-engine/pinball-arena';
import type {ArenaOwnerInput} from '@keel-engine/pinball-arena';
import type {KeyEventLike,PadState,PadButton} from '@keel-engine/input';

export const PINBALL_INPUT_VERSION='keel-pinball-input@1';
const defaultKeys:Readonly<Record<string,number>>=Object.freeze({ArrowLeft:ArenaInput.LEFT,KeyA:ArenaInput.LEFT,ArrowRight:ArenaInput.RIGHT,KeyD:ArenaInput.RIGHT,Space:ArenaInput.LAUNCH,KeyQ:ArenaInput.DASH,KeyW:ArenaInput.PULSE,KeyE:ArenaInput.SHIELD});
const defaultPad:readonly PinballPadBinding[]=Object.freeze([{button:4,bits:ArenaInput.LEFT},{button:6,bits:ArenaInput.LEFT},{button:5,bits:ArenaInput.RIGHT},{button:7,bits:ArenaInput.RIGHT},{button:0,bits:ArenaInput.LAUNCH},{button:2,bits:ArenaInput.DASH},{button:1,bits:ArenaInput.PULSE},{button:3,bits:ArenaInput.SHIELD}].map(binding=>Object.freeze(binding)));
const pressed=(button:PadButton)=>typeof button==='number'?button>.5:Boolean(button?.pressed);
const editable=(target:EventTarget|null)=>typeof HTMLElement!=='undefined'&&target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select')!==null);
export interface PinballPadBinding {readonly button:number;readonly bits:number}
export interface PinballInputOptions {readonly ownerId:number;readonly deadzone?:number;readonly keyBindings?:Readonly<Record<string,number>>;readonly gamepadBindings?:readonly PinballPadBinding[]}
export interface PinballInputAttachOptions {readonly target:Window;readonly document?:Document;readonly navigator?:Pick<Navigator,'getGamepads'>}

/** Device state stays outside simulation. Every sample passes the same canonical
 * owner-input admission used by the authority. A tap between steps is retained;
 * holding an action remains held so the authority decides its rising edge. */
export function createPinballInput(options:PinballInputOptions){
 admitArenaInput({ownerId:options.ownerId,bits:0});const deadzone=options.deadzone??.2;
 if(!Number.isFinite(deadzone)||deadzone<0||deadzone>=1)throw new Error('Invalid pinball input deadzone');
 const bindings=Object.freeze({...options.keyBindings??defaultKeys}),padBindings=Object.freeze((options.gamepadBindings??defaultPad).map(binding=>Object.freeze({...binding})));
 if(Object.keys(bindings).length>64||Object.keys(bindings).some(code=>!/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(code))||padBindings.length>32||padBindings.some(binding=>!Number.isSafeInteger(binding.button)||binding.button<0||binding.button>31)||new Set(padBindings.map(binding=>binding.button)).size!==padBindings.length)throw new Error('Invalid pinball device bindings');
 for(const bits of [...Object.values(bindings),...padBindings.map(binding=>binding.bits)])admitArenaInput({ownerId:options.ownerId,bits});
 const sources=new Map<string,number>(),pending=new Map<string,number>(),keys=new Set<string>(),bindingResets=new Set<()=>void>();let aimX=0,aimY=0,pad:PadState|null=null,pollPads:(()=>PadState|null)|undefined,suspended=false,attached=false;
 const internalSources=new Set(['keyboard','gamepad']);
 function checkSource(source:string,allocate=false){if(typeof source!=='string'||source.length<1||source.length>64||allocate&&!internalSources.has(source)&&!sources.has(source)&&!pending.has(source)&&new Set([...sources.keys(),...pending.keys()].filter(key=>!internalSources.has(key))).size>=32)throw new Error('Pinball input source cap');}
 function buttons(source:string,bits:number){checkSource(source);admitArenaInput({ownerId:options.ownerId,bits});if(suspended)return;const before=sources.get(source)??0,nextPending=(pending.get(source)??0)|(bits&~before);checkSource(source,bits!==0||nextPending!==0);if(nextPending)pending.set(source,nextPending);else pending.delete(source);if(bits)sources.set(source,bits);else sources.delete(source);}
 function keyboard(){let bits=0;for(const code of keys)bits|=bindings[code]??0;buttons('keyboard',bits);}
 function releaseKeyboard(){keys.clear();sources.delete('keyboard');pending.delete('keyboard');}
 function key(event:string|KeyEventLike,down:boolean){
  const code=typeof event==='string'?event:event.code??'';
  if(typeof event!=='string'&&(event.metaKey||event.ctrlKey||event.altKey)){releaseKeyboard();return false;}
  if(!Object.hasOwn(bindings,code)||suspended)return false;if(down)keys.add(code);else keys.delete(code);keyboard();return true;
 }
 function neutral(){sources.clear();pending.clear();keys.clear();aimX=0;aimY=0;pad=null;for(const reset of bindingResets)reset();}
 function readPad(){const current=pollPads?pollPads():pad;let bits=0;
  if(current&&current.connected!==false){const b=current.buttons??[];for(const binding of padBindings)if(pressed(b[binding.button]))bits|=binding.bits;const x=current.axes?.[0]??0,y=current.axes?.[1]??0;
   if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Invalid pinball gamepad axes');const length=Math.hypot(x,y),scale=length>deadzone?Math.min(1,(length-deadzone)/(1-deadzone))/length:0;aimX=x*scale;aimY=-y*scale;
  }else{aimX=0;aimY=0;}buttons('gamepad',bits);
 }
 function peek():ArenaOwnerInput{if(suspended)return admitArenaInput({ownerId:options.ownerId,bits:0});readPad();let bits=0;for(const value of sources.values())bits|=value;for(const value of pending.values())bits|=value;return admitArenaInput({ownerId:options.ownerId,bits,steerX:Math.round(aimX*127)/127,steerY:Math.round(aimY*127)/127});}
 function consumePending(){pending.clear();}
 function sample():ArenaOwnerInput{const value=peek();consumePending();return value;}
 function attach({target,document:doc=target.document,navigator:nav=target.navigator}:PinballInputAttachOptions){
  if(attached)throw new Error('Pinball input is already attached');attached=true;
  const focused=()=>!doc.hidden&&(typeof doc.hasFocus!=='function'||doc.hasFocus());suspended=!focused();
  if(suspended)neutral();
  const down=(event:KeyboardEvent)=>{if(editable(event.target))return;if(key(event,true))event.preventDefault();};
  const up=(event:KeyboardEvent)=>{if(key(event,false)&&!editable(event.target))event.preventDefault();};
  const blur=()=>{suspended=true;neutral();},focus=()=>{suspended=!focused();if(suspended)neutral();};
  const hide=()=>{suspended=!focused();if(suspended)neutral();};
  target.addEventListener('keydown',down);target.addEventListener('keyup',up);target.addEventListener('blur',blur);target.addEventListener('focus',focus);doc.addEventListener('visibilitychange',hide);
  pollPads=()=>{const list=nav.getGamepads?.();if(!list)return null;for(let i=0;i<list.length;i++){const value=list[i];if(value?.connected&&value.mapping==='standard')return value;}return null;};
  return ()=>{target.removeEventListener('keydown',down);target.removeEventListener('keyup',up);target.removeEventListener('blur',blur);target.removeEventListener('focus',focus);doc.removeEventListener('visibilitychange',hide);pollPads=undefined;attached=false;suspended=false;neutral();};
 }
 /** Bind a control already placed by the game's UI. Multiple fingers may hold
  * one blade; releasing one finger does not release another. */
 function bindButton(element:HTMLElement,source:string,bits:number){checkSource(source);admitArenaInput({ownerId:options.ownerId,bits});const pointers=new Set<number>();
  const down=(event:PointerEvent)=>{if(event.button!==0||suspended)return;event.preventDefault();const oldHeld=sources.get(source),oldPending=pending.get(source),wasHeld=pointers.has(event.pointerId);buttons(source,bits);pointers.add(event.pointerId);try{element.setPointerCapture?.(event.pointerId);}catch(error){if(!wasHeld)pointers.delete(event.pointerId);if(oldHeld===undefined)sources.delete(source);else sources.set(source,oldHeld);if(oldPending===undefined)pending.delete(source);else pending.set(source,oldPending);throw error;}};
  const release=(event:PointerEvent,cancelled:boolean)=>{if(!pointers.delete(event.pointerId))return;buttons(source,pointers.size?bits:0);if(cancelled&&!pointers.size)pending.delete(source);};
  const up=(event:PointerEvent)=>release(event,false),cancel=(event:PointerEvent)=>release(event,true);
  const blur=()=>{pointers.clear();sources.delete(source);pending.delete(source);};
  bindingResets.add(blur);element.addEventListener('pointerdown',down);element.addEventListener('pointerup',up);element.addEventListener('pointercancel',cancel);element.addEventListener('lostpointercapture',cancel);
  const window=element.ownerDocument.defaultView;window?.addEventListener('blur',blur);
  const hidden=()=>{if(element.ownerDocument.hidden)blur();};element.ownerDocument.addEventListener('visibilitychange',hidden);
  return ()=>{element.removeEventListener('pointerdown',down);element.removeEventListener('pointerup',up);element.removeEventListener('pointercancel',cancel);element.removeEventListener('lostpointercapture',cancel);window?.removeEventListener('blur',blur);element.ownerDocument.removeEventListener('visibilitychange',hidden);bindingResets.delete(blur);blur();};
 }
 return {key,setButtons:buttons,neutral,sample,peek,consumePending,attach,bindButton,readBindings:()=>Object.freeze({keys:bindings,gamepad:padBindings}),setPad(value:PadState|null){pad=value;}};
}
