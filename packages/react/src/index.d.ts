import type {ReactNode,HTMLAttributes,ButtonHTMLAttributes} from 'react';
import type {Engine} from '@keel-engine/runtime';
import type {PixelRenderer} from '@keel-engine/render';
import type {Theme} from '@keel-engine/ui';
export {themeTokens,recipeTheme,DESIGN_LANGUAGE} from './design.ts';
export interface KeelStore<T>{getSnapshot():T;getServerSnapshot():T;subscribe(callback:()=>void):()=>void;setSnapshot(value:T):void}
export function createKeelStore<T>(initial:T):KeelStore<T>;
export function useKeelStore<T>(store:KeelStore<T>):T;
export interface FrameTime {readonly frame:number;readonly seconds:number;readonly delta:number}
export interface FrameClock {start():void;pause():void;seek(frame:number):void;dispose():void;readonly frame:number}
export function createFrameLoop(options:{draw:(time:FrameTime)=>void;fps?:number;schedule?:(callback:(now:number)=>void)=>number;cancel?:(id:number)=>void;onError?:(error:unknown)=>void}):FrameClock;
export function integerFit(width:number,height:number,availableWidth:number,availableHeight:number):{scale:number;width:number;height:number;overflow:boolean};
export function KeelProvider(props:{engine?:Engine;children?:ReactNode;onError?:(error:unknown)=>void}):ReactNode;
export function useKeelEngine():{engine:Engine;ready:boolean;error:unknown};
export function useKeelModule<T=unknown>(id:string):T|undefined;
export function KeelTheme(props:HTMLAttributes<HTMLDivElement>&{theme?:Theme;recipe?:unknown;scale?:number;fontFamily?:string}):ReactNode;
export function useKeelTheme():Theme;
export function KeelPanel(props:HTMLAttributes<HTMLElement>):ReactNode;
export function KeelButton(props:ButtonHTMLAttributes<HTMLButtonElement>):ReactNode;
export interface InspectionProbe {register(id:string,kind:'mesh'|'graph'|'grid'|'state',read:()=>unknown):()=>unknown}
export function useKeelInspection(probe:InspectionProbe|undefined,id:string,kind:'mesh'|'graph'|'grid'|'state',read:()=>unknown):void;
export interface CanvasHandle {canvas:HTMLCanvasElement;renderer:PixelRenderer;clock:FrameClock}
export function KeelCanvas(props:HTMLAttributes<HTMLDivElement>&{width?:number;height?:number;scale?:number;fps?:number;playing?:boolean;label?:string;setup?:(renderer:PixelRenderer,canvas:HTMLCanvasElement)=>(()=>void)|void;draw?:(renderer:PixelRenderer,time:FrameTime)=>void;onReady?:(handle:CanvasHandle)=>void;onError?:(error:unknown)=>void}):ReactNode;
