"use client";
import {useMemo,useState} from 'react';
import {KeelCanvas,KeelTheme,KeelPanel,KeelButton,recipeTheme} from '@keel-engine/react';
import type {PixelRenderer} from '@keel-engine/render';
import '@keel-engine/react/styles.css';
const recipe = {seed: 'keel/react-demo', culture: 'clean'} as const;
const theme = recipeTheme(recipe);
const colours = [...theme.palette.surface, ...theme.palette.accent].map(c=>[c&255,(c>>>8)&255,(c>>>16)&255]);
function setup(renderer:PixelRenderer) {
  renderer.setPalette(colours,{surface:[0,theme.palette.surface.length],accent:[theme.palette.surface.length,theme.palette.accent.length]});
  renderer.setMaterials([{ramp:'surface'},{ramp:'accent'}]);
  renderer.setWorld({boxes:[{c:[0,-.5,0],h:[5,.5,5],mat:0},{c:[0,1,0],h:[.75,1,.75],mat:1}]});
  renderer.setStyle({screen:4});
}
export default function KeelDemo() {
  const [playing,setPlaying]=useState(false);
  const themeRecipe=useMemo(()=>recipe,[]);
  return <KeelTheme recipe={themeRecipe} scale={2}>
    <KeelCanvas width={256} height={144} scale={2} playing={playing} setup={setup}
      onReady={({canvas,clock})=>{if(new URLSearchParams(location.search).get('cinematic')==='1') {clock.pause();canvas.dataset.cinematic='ready';}}}
      draw={(renderer,{seconds})=>renderer.render({eye:[Math.sin(seconds)*5,3,Math.cos(seconds)*5],target:[0,1,0],time:seconds})}/>
    <KeelPanel aria-label="Scene controls"><KeelButton onClick={()=>setPlaying(!playing)}>{playing?'PAUSE':'PLAY'}</KeelButton></KeelPanel>
  </KeelTheme>;
}
