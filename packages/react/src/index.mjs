"use client";
import {createContext,createElement,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createEngine} from '@keel-engine/runtime';
import {createPixelRenderer} from '@keel-engine/render';
import {themeTokens,recipeTheme} from './design.ts';
import {createFrameLoop} from './lifecycle.mjs';
export {themeTokens,recipeTheme,DESIGN_LANGUAGE} from './design.ts';
export {createKeelStore,createFrameLoop,integerFit} from './lifecycle.mjs';
const EngineContext=createContext(null),ThemeContext=createContext(null),starts=new WeakMap();
function startOnce(engine){let promise=starts.get(engine);if(!promise){promise=Promise.resolve().then(()=>engine.start());starts.set(engine,promise);}return promise;}
export function KeelProvider({engine:provided,children,onError}) {
 const errorCallback=useRef(onError);errorCallback.current=onError;
 const engine=useMemo(()=>provided??createEngine(),[provided]),[state,setState]=useState({engine,ready:false,error:null});
 useEffect(()=>{let live=true;setState({engine,ready:false,error:null});startOnce(engine).then(()=>{if(live)setState({engine,ready:true,error:null});},error=>{if(live){setState({engine,ready:false,error});errorCallback.current?.(error);}});return()=>{live=false;};},[engine]);
 const value=state.engine===engine?state:{engine,ready:false,error:null};return createElement(EngineContext.Provider,{value},children);
}
export function useKeelEngine(){const value=useContext(EngineContext);if(!value)throw new Error('Wrap the app in KeelProvider.');return value;}
export function useKeelModule(id){const {engine,ready,error}=useKeelEngine();if(error)throw error;return ready?engine.get(id):undefined;}
export function useKeelStore(store){return useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot);}
export function useKeelInspection(probe,id,kind,read){const latest=useRef(read);latest.current=read;useEffect(()=>{if(!probe)return;const unregister=probe.register(id,kind,()=>latest.current());return()=>{unregister();};},[probe,id,kind]);}
export function KeelTheme({theme,recipe,scale=2,fontFamily='ui-monospace, monospace',children,style,...props}) {
 const resolved=useMemo(()=>theme??recipeTheme(recipe),[theme,recipe]);const tokens=useMemo(()=>themeTokens(resolved,scale),[resolved,scale]);
 return createElement(ThemeContext.Provider,{value:resolved},createElement('div',{...props,'data-keel-theme':resolved.key,style:{...tokens,'--keel-font':fontFamily,...style}},children));
}
export function useKeelTheme(){const theme=useContext(ThemeContext);if(!theme)throw new Error('Wrap themed controls in KeelTheme.');return theme;}
export function KeelPanel({className='',...props}){return createElement('section',{...props,className:`keel-panel ${className}`});}
export function KeelButton({className='',type='button',...props}){return createElement('button',{...props,type,className:`keel-button ${className}`});}
/** Own a fresh canvas per mount so Strict Mode cleanup never loses a reused canvas context. */
export function KeelCanvas({width=256,height=144,scale=2,fps=30,playing=true,setup,draw,onReady,onError,label='KEEL scene',style,className='',...props}) {
 const host=useRef(null),latest=useRef({draw,onReady,onError}),controller=useRef(null);latest.current={draw,onReady,onError};
 if(![width,height,scale].every(Number.isInteger)||width<8||height<8||scale<1||scale>16)throw new RangeError('Invalid KEEL canvas size or integer scale.');
 useEffect(()=>{
  const node=host.current,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label);canvas.style.cssText=`width:${width*scale}px;height:${height*scale}px;image-rendering:pixelated;display:block`;node.appendChild(canvas);
  let cleanup,loop;
  const fail=error=>{canvas.dataset.keelError=error.message;latest.current.onError?.(error);};
  try {
   const renderer=createPixelRenderer(canvas,{width,height});cleanup=setup?.(renderer,canvas);
   loop=createFrameLoop({fps,draw:time=>latest.current.draw?.(renderer,time),onError:fail});controller.current=loop;loop.seek(0);latest.current.onReady?.({canvas,renderer,clock:loop});
  }catch(error){fail(error);}
  return()=>{loop?.dispose();controller.current=null;try{cleanup?.();}finally{canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();}};
 },[width,height,fps,setup]);
 useEffect(()=>{const canvas=host.current?.querySelector('canvas');if(canvas){canvas.style.width=`${width*scale}px`;canvas.style.height=`${height*scale}px`;canvas.setAttribute('aria-label',label);}},[width,height,scale,label]);
 useEffect(()=>{if(playing)controller.current?.start();else controller.current?.pause();},[playing,width,height,fps,setup]);
 return createElement('div',{...props,ref:host,className:`keel-canvas ${className}`,style:{overflow:'hidden',...style}});
}
