import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEventListeners } from 'node:events';
import { createControls, createTouchSurface } from '../src/index.ts';
import type { TouchLayout } from '../src/index.ts';

class Target extends EventTarget {
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, callback, typeof options === 'boolean' ? {capture: options} : options);
  }
}
class Element extends Target {
  children: Element[] = []; parent: Element | null = null;
  dataset: Record<string,string> = {}; attrs: Record<string,string> = {};
  styles: Record<string,string> = {}; className = ''; textContent = '';
  style: Record<string,unknown> & {setProperty: (k: string,v: string) => void} = {setProperty: (k,v) => {this.styles[k] = v;}};
  box = {left: 10, top: 20, width: 400, height: 800};
  constructor(readonly ownerDocument: Doc) {super();}
  append(...children: Element[]): void {for(const child of children) {child.parent = this; this.children.push(child);}}
  replaceChildren(...children: Element[]): void {for(const child of this.children) child.parent = null; this.children = []; this.append(...children);}
  remove(): void {if(this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); this.parent = null;}
  setAttribute(key: string,value: string): void {this.attrs[key] = value;}
  getBoundingClientRect(): {left: number; top: number; width: number; height: number; right: number; bottom: number} {
    const p = this.parent?.getBoundingClientRect();
    const part = (key: string, span: number, fallback: number): number => typeof this.style[key] === 'string' && String(this.style[key]).endsWith('%') ? parseFloat(String(this.style[key])) * span / 100 : fallback;
    const b = p && this.style.width ? {left: p.left + part('left',p.width,0), top: p.top + part('top',p.height,0), width: part('width',p.width,64), height: part('height',p.height,64)} : this.box;
    return {...b, right: b.left + b.width, bottom: b.top + b.height};
  }
  setPointerCapture(_id: number): void {}
}
class Doc extends Target {defaultView = new Target(); hidden = false; createElement(_tag: string): Element {return new Element(this);}}
Object.assign(globalThis,{getComputedStyle: () => ({getPropertyValue: () => '3'})});
const layout: TouchLayout = {name: 'generated-driving',controls: [
  {type: 'stick',x: 'steer',anchor: 'bl',at: [1,1],radius: 300,rect: [.05,.7,.3,.25],deadzone: 0},
  {type: 'button',id: 'gas',label: 'Accelerator',anchor: 'br',x: 0,y: 0,rect: [.8,.75,.12,.2],pulse: false},
  {type: 'button',id: 'brake',label: 'Foot brake',anchor: 'br',x: 0,y: 0,rect: [.65,.84,.12,.1],pulse: false},
  {type: 'button',id: 'handbrake',label: 'Handbrake',anchor: 'br',x: 0,y: 0,rect: [.65,.7,.12,.1],pulse: false},
]};
function pointer(target: EventTarget,type: string,id: number,x = 0,y = 0): void {const e = new Event(type,{cancelable: true}); Object.assign(e,{pointerId: id,clientX: x,clientY: y}); target.dispatchEvent(e);}
function fixture() {
  const doc = new Doc(),host = new Element(doc);
  const controls = createControls({steer: {kind: 'axis',touch: 'steer',deadzone: 0,curve: 0},gas: {kind: 'button',touch: 'gas'},brake: {kind: 'button',touch: 'brake'},handbrake: {kind: 'button',touch: 'handbrake'}} as const);
  const overlay = createTouchSurface(host as unknown as HTMLElement,controls.virtual,layout,{visuals: 'external'});
  const root = overlay.root as unknown as Element;
  const element = (id: string) => {const e = root.children.find(c => c.dataset.id === id); assert(e); return e;};
  const state = () => {controls.update(); return (['steer','gas','brake','handbrake'] as const).map(id => controls.value(id));};
  return {doc,host,controls,overlay,root,element,state};
}

test('external visuals retain exact live input rectangles, ARIA and independent wheel/pedals without CSS ripples',() => {
  const f = fixture();
  assert.equal(f.root.style.opacity,'0'); assert.equal(f.root.dataset.visuals,'external');
  const rows = f.overlay.snapshot(); assert.equal(rows.length,4);
  for(let i = 0;i < rows.length;i++) {
    const c = layout.controls[i]!; assert(c.type === 'stick' || c.type === 'button');
    for(let k = 0;k < 4;k++) assert(Math.abs(rows[i]!.bounds[k]! - c.rect![k]!) < 1e-12);
  }
  assert.equal(f.element('gas').attrs['aria-label'],'Accelerator');
  const b = f.element('steer').getBoundingClientRect();
  pointer(f.element('steer'),'pointerdown',1,b.right,b.top + b.height / 2);
  pointer(f.element('gas'),'pointerdown',2); pointer(f.element('brake'),'pointerdown',3); pointer(f.element('handbrake'),'pointerdown',4);
  assert.deepEqual(f.state(),[1,1,1,1],'exact rectangle radius, not legacy radius × CSS scale, defines steering');
  assert.strictEqual(f.overlay.snapshot(),rows); assert(rows.every(row => row.pressed && row.value === 1));
  assert(f.element('gas').children.length === 0,'an external visual surface never allocates CSS ripple nodes');
  pointer(f.doc,'pointercancel',3); assert.deepEqual(f.state(),[1,1,0,1]);
  pointer(f.doc,'pointerup',2); assert.deepEqual(f.state(),[1,0,0,1],'handbrake does not synthesize accelerator or foot brake');
  f.overlay.destroy(); assert.equal(rows.length,0); assert.deepEqual(f.state(),[0,0,0,0]);
});

test('relayout, menu release, blur and suspension clear the borrowed visual state and all input owners',() => {
  const f = fixture(),rows = f.overlay.snapshot();
  for(const release of [() => f.overlay.release(),() => f.doc.defaultView.dispatchEvent(new Event('blur')),() => {f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); f.doc.hidden = false;},() => f.overlay.setLayout({...layout,controls: layout.controls.filter(c => !('id' in c) || c.id !== 'brake')})]) {
    pointer(f.element('gas'),'pointerdown',2); pointer(f.element('handbrake'),'pointerdown',4); assert.deepEqual(f.state().slice(1),[1,0,1]);
    release(); assert.deepEqual(f.state(),[0,0,0,0]); assert.strictEqual(f.overlay.snapshot(),rows); assert(rows.every(row => !row.pressed && row.value === 0));
  }
  f.overlay.destroy(); f.overlay.destroy(); assert.equal(rows.length,0);
  for(const event of ['pointermove','pointerup','pointercancel','visibilitychange']) assert.equal(getEventListeners(f.doc,event).length,0);
  assert.equal(getEventListeners(f.doc.defaultView,'blur').length,0);
});

test('invalid exact geometry is rejected before mounting or replacing a valid held layout',() => {
  const f = fixture(); pointer(f.element('gas'),'pointerdown',9); assert.equal(f.state()[1],1);
  const bad: TouchLayout = {...layout,controls: [{...layout.controls[1],rect: [0,0,NaN,.2]} as never]};
  const rows = f.overlay.snapshot(),element = f.element('gas');
  assert.throws(() => f.overlay.setLayout(bad),RangeError); assert.strictEqual(f.element('gas'),element); assert.strictEqual(f.overlay.snapshot(),rows); assert.equal(f.state()[1],1);
  f.overlay.destroy(); const before = f.host.children.length;
  assert.throws(() => createTouchSurface(f.host as unknown as HTMLElement,f.controls.virtual,bad,{visuals: 'external'}),RangeError);
  assert.equal(f.host.children.length,before); assert.equal(getEventListeners(f.doc,'visibilitychange').length,0);
  const floating: TouchLayout = {...layout,controls: [{...layout.controls[0],region: [0,0,1,1]} as never]};
  assert.throws(() => createTouchSurface(f.host as unknown as HTMLElement,f.controls.virtual,floating),/floating region/);
});
