import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {KeelTheme,KeelButton,useKeelStore,createKeelStore} from '../src/index.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const pkg=fileURLToPath(new URL('..',import.meta.url));
const fixture=`import React,{StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createEngine,defineManifest} from '@keel-engine/runtime';
import {KeelProvider,useKeelModule,KeelTheme,KeelButton,KeelCanvas,createKeelStore,useKeelStore,useKeelInspection} from '@keel-engine/react';
import '@keel-engine/react/styles.css';
const store=createKeelStore(Object.freeze({tick:0})),engine=createEngine();window.starts=0;
engine.define(defineManifest({id:'test/react',version:'1.0.0',kind:'runtime',needs:[]}),()=>{window.starts++;return {store};});
const readers=new Map();const probe={register(id,kind,read){readers.set(id,read);return ()=>readers.delete(id);}};window.probe=()=>Object.fromEntries([...readers].map(([id,read])=>[id,read()]));
const setup=renderer=>{renderer.setPalette([[0,0,0],[64,64,64],[128,128,128],[255,255,255]],{base:[0,4]});renderer.setMaterials([{ramp:'base'}]);renderer.setWorld({boxes:[{c:[0,0,0],h:[1,1,1],mat:0}]});};
function App(){const api=useKeelModule('test/react'),state=useKeelStore(store),[scale,setScale]=useState(2);useKeelInspection(probe,'scene','state',()=>state);
return <KeelTheme recipe={{seed:'test',culture:'clean'}}><div id='ready'>{api?'ready':'loading'}</div><div id='tick'>{state.tick}</div>
<KeelButton id='advance' onClick={()=>api.store.setSnapshot({tick:state.tick+1})}>ADVANCE</KeelButton><KeelButton id='scale' onClick={()=>setScale(3)}>SCALE</KeelButton>
<KeelCanvas width={160} height={144} scale={scale} playing={false} setup={setup} onReady={handle=>{window.scene=handle;}} onError={error=>{window.sceneError=error.message;}} draw={(renderer,{seconds})=>renderer.render({eye:[Math.sin(seconds)*5,3,Math.cos(seconds)*5],target:[0,0,0],time:seconds})}/></KeelTheme>;}
const app=createRoot(document.getElementById('app'));window.unmount=()=>app.unmount();app.render(<StrictMode><KeelProvider engine={engine}><App/></KeelProvider></StrictMode>);`;
test('server rendering retains the exact initial external-store snapshot',()=>{
 const store=createKeelStore({tick:7});function App(){const value=useKeelStore(store);return React.createElement(KeelTheme,{recipe:{seed:'server',culture:'clean'}},React.createElement(KeelButton,null,String(value.tick)));}
 assert.match(renderToString(React.createElement(App)),/>7<\/button>/);
});
test('real React Strict Mode binds one engine API, canonical GL pixels, probes and teardown',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'keel-react-browser-'));let browser,server;
 try {
  const result=await build({stdin:{contents:fixture,loader:'tsx',resolveDir:pkg},outdir:path.join(dir,'bundle'),bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',absWorkingDir:root});
  const js=result.outputFiles.find(x=>x.path.endsWith('.js'))??result.outputFiles.find(x=>x.text.includes('createRoot'));
  const css=result.outputFiles.find(x=>x.path.endsWith('.css'));
  assert.ok(js);const html=`<!doctype html><html><head><style>${css?.text??''}</style></head><body><div id='app'></div><script type='module' src='/app.js'></script></body></html>`;
  await writeFile(path.join(dir,'index.html'),html);await writeFile(path.join(dir,'app.js'),js.contents);
  server=createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(await readFile(path.join(dir,req.url==='/app.js'?'app.js':'index.html')));}catch(error){res.statusCode=500;res.end(error.message);}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:900,height:700}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('#ready')?.textContent==='ready'&&window.scene);
  assert.equal(await page.evaluate(()=>window.starts),1);assert.equal(await page.evaluate(()=>window.sceneError),undefined);
  await page.click('#advance');assert.equal(await page.locator('#tick').textContent(),'1');assert.deepEqual(await page.evaluate(()=>window.probe()),{scene:{tick:1}});
  const info=await page.evaluate(()=>{window.scene.clock.seek(6);return {pixels:[...window.scene.renderer.read()],offPalette:window.scene.renderer.offPalette(),width:window.scene.canvas.width,cssWidth:getComputedStyle(window.scene.canvas).width};});
  assert.equal(info.offPalette,0);assert.equal(info.width,160);assert.equal(info.cssWidth,'320px');assert.ok(new Set(info.pixels).size>1);
  const again=await page.evaluate(()=>{window.scene.clock.seek(6);return [...window.scene.renderer.read()];});assert.deepEqual(again,info.pixels);
  const changed=await page.evaluate(()=>{window.scene.clock.seek(20);return [...window.scene.renderer.read()];});assert.notDeepEqual(changed,info.pixels);
  await page.click('#scale');assert.equal(await page.locator('canvas').evaluate(node=>getComputedStyle(node).width),'480px');assert.equal(await page.evaluate(()=>window.starts),1);
  if(process.env.KEEL_REACT_EVIDENCE){await page.screenshot({path:process.env.KEEL_REACT_EVIDENCE});await writeFile(process.env.KEEL_REACT_EVIDENCE+'.json',JSON.stringify({reactVersion:React.version,engineStarts:1,width:160,height:144,integerScale:3,offPalette:0,frame:6,pixelsSha256:createHash('sha256').update(Buffer.from(info.pixels)).digest('hex'),repeatPixelsIdentical:true,errors},null,2)+'\n');}
  await page.evaluate(()=>window.unmount());assert.equal(await page.locator('canvas').count(),0);assert.deepEqual(await page.evaluate(()=>window.probe()),{});assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
