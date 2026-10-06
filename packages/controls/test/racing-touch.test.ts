import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getEventListeners} from 'node:events';
import {createControls, createTouchOverlay, racingTouchLayout} from '../src/index.ts';
class Target extends EventTarget {
  override removeEventListener(type:string, cb:EventListenerOrEventListenerObject|null, opts?:boolean|EventListenerOptions){super.removeEventListener(type,cb,typeof opts==='boolean'?{capture:opts}:opts)}
}
class El extends Target {
 children:El[]=[];parent:El|null=null;dataset:Record<string,string>={};attrs:Record<string,string>={};className='';textContent='';
 style=Object.assign({setProperty:(k:string,v:string)=>{this.styles[k]=v}},{});styles:Record<string,string>={};
 box={left:0,top:0,width:64,height:64,right:64,bottom:64};
 ownerDocument:Doc;
 constructor(ownerDocument:Doc){super();this.ownerDocument=ownerDocument}
 append(...cs:El[]){for(const c of cs){c.parent=this;this.children.push(c)}}
 remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null}
 replaceChildren(...cs:El[]){this.children.forEach(c=>c.parent=null);this.children=[];this.append(...cs)}
 setAttribute(k:string,v:string){this.attrs[k]=v}
 getBoundingClientRect(){return this.box}
 setPointerCapture(_id:number){}
}
class Doc extends Target {defaultView=new Target();hidden=false;createElement(_tag:string){return new El(this)}}
Object.assign(globalThis,{getComputedStyle:()=>({getPropertyValue:()=> '1'})});
function pointer(target:EventTarget,type:string,id:number,x=0,y=0){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y});target.dispatchEvent(e)}
function fixture(){
 const doc=new Doc(),host=new El(doc),ctl=createControls({steer:{kind:'axis',touch:'steer'},gas:{kind:'button',touch:'gas'},brake:{kind:'button',touch:'brake'},drift:{kind:'button',touch:'handbrake'},boost:{kind:'button',touch:'boost'},camera:{kind:'button',touch:'camera'}} as const);
 const overlay=createTouchOverlay(host as unknown as HTMLElement,ctl.virtual,racingTouchLayout(),{css:false});
 const root=overlay.root as unknown as El;
 const el=(id:string)=>{const e=root.children.find(c=>c.dataset.id===id);assert(e);return e};
 for(const [i,id]of ['steer','gas','brake','handbrake','boost'].entries()){const e=el(id),left=i*200;e.box={left,top:100,width:128,height:128,right:left+128,bottom:228}}
 const held=()=>{ctl.update();return ['steer','gas','brake','drift','boost','camera'].map(id=>ctl.value(id as any))};
 return {doc,ctl,overlay,el,held,root};
}
test('two thumbs steer and slide pedals through drift, boost and brake without losing throttle or keeping stale actions',()=>{
 const f=fixture();pointer(f.el('steer'),'pointerdown',1,120,164);pointer(f.el('gas'),'pointerdown',2,220,160);
 let v=f.held();assert(v[0]>0.8);assert.deepEqual(v.slice(1,5),[1,0,0,0]);
 pointer(f.doc,'pointermove',1,120,900);assert.equal(f.held()[0],v[0],'vertical travel cannot weaken a one-axis wheel');
 for(const [x,expected]of [[630,[1,0,1,0]],[830,[1,0,0,1]],[430,[0,1,0,0]],[1400,[0,0,0,0]],[220,[1,0,0,0]]] as const){pointer(f.doc,'pointermove',2,x,160);assert.deepEqual(f.held().slice(1,5),expected)}
 pointer(f.doc,'pointerup',1);assert.equal(f.held()[0],0);assert.equal(f.held()[1],1);
 pointer(f.doc,'pointercancel',2);assert.deepEqual(f.held(),[0,0,0,0,0,0]);f.overlay.destroy();
});
test('steering has one pointer owner; a spare finger cannot recenter it or release another finger',()=>{
 const f=fixture();pointer(f.el('steer'),'pointerdown',1,120,164);const v=f.held()[0];pointer(f.el('steer'),'pointerdown',2,4,164);pointer(f.doc,'pointermove',2,0,160);pointer(f.doc,'pointerup',2);assert.equal(f.held()[0],v);pointer(f.el('steer'),'lostpointercapture',1);assert.equal(f.held()[0],0);f.overlay.destroy();
});
test('independent fingers on a shared action release independently',()=>{
 const f=fixture();pointer(f.el('gas'),'pointerdown',1,220,160);pointer(f.el('boost'),'pointerdown',2,830,160);assert.deepEqual(f.held().slice(1,5),[1,0,0,1]);pointer(f.doc,'pointerup',1);assert.deepEqual(f.held().slice(1,5),[1,0,0,1]);pointer(f.doc,'pointerup',2);assert.deepEqual(f.held().slice(1,5),[0,0,0,0]);f.overlay.destroy();
});
test('blur, hidden document, explicit pause release, layout change and disposal neutralize input and detach listeners',()=>{
 const f=fixture();
 for(const release of [()=>f.doc.defaultView.dispatchEvent(new Event('blur')),()=>{f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));f.doc.hidden=false},()=>f.overlay.release(),()=>f.overlay.setLayout(racingTouchLayout({swap:true}))]){
  // Reapply fixture boxes after layout reconstruction.
  const g=f.el('gas');g.box={left:200,top:100,width:128,height:128,right:328,bottom:228};pointer(g,'pointerdown',1,220,160);assert.equal(f.held()[1],1);release();assert.deepEqual(f.held(),[0,0,0,0,0,0]);
 }
 pointer(f.el('camera'),'pointerdown',7);f.overlay.release();assert.equal(f.held()[5],0,'paused tap cannot replay later');
 f.overlay.destroy();f.overlay.destroy();for(const type of ['pointermove','pointerup','pointercancel','visibilitychange'])assert.equal(getEventListeners(f.doc,type).length,0);assert.equal(getEventListeners(f.doc.defaultView,'blur').length,0);
});
test('one racing template retains action semantics under side swap, bounded height and manual gears',()=>{
 const normal=racingTouchLayout(),mirror=racingTouchLayout({swap:true,lift:999,manual:true});
 assert.equal(normal.name,mirror.name);assert(!normal.controls.some(c=>'id'in c&&c.id==='shiftUp'));
 const stick=mirror.controls.find(c=>c.type==='stick')!;assert.equal(stick.anchor,'br');assert.equal(stick.x,'steer');assert.equal(stick.at[1],160);
 assert(mirror.controls.some(c=>'id'in c&&c.id==='shiftUp'));assert.deepEqual(racingTouchLayout({lift:NaN}),normal);
});
