'use client';
import {useEffect,useRef,useState} from 'react';
import {ActionButton} from './controls';
import {probeWifi} from '../../chromatic-wireless/src/client.mjs';

export function WifiSupport({token,initialIp}:{token:string;initialIp?:string}){
 const [ip,setIp]=useState(initialIp??''),[busy,setBusy]=useState(false),[message,setMessage]=useState('No Wi-Fi check has run.');
 const abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>{abort.current?.abort();},[]);
 async function check(){const controller=new AbortController();abort.current=controller;setBusy(true);try{await probeWifi({token,ip,signal:controller.signal,onState:s=>{if(!controller.signal.aborted)setMessage(s.message);}});if(!controller.signal.aborted)setMessage('Chromatic answered the CWL2 Wi-Fi check. The check is now closed. This does not verify gameplay or enable cartridge management.');}catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:'Wi-Fi check failed.');}finally{if(!controller.signal.aborted)setBusy(false);if(abort.current===controller)abort.current=null;}}
 return <section className="chromatic-panel"><p className="chromatic-kicker">WI-FI · DEVELOPMENT PREVIEW</p><h2>Check the wireless link</h2>
  <p>Keep the helper running on this computer. Your Chromatic must already have Shiny Relay Wi-Fi and nearby link enabled on the same network. Opening the helper is separate from getting a reply from the device.</p>
  <div className="chromatic-actions"><a className="package-action" href="/chromatic/wifi-v1/chromatic-wifi-macos-arm64.tar.gz" download>Download helper · Mac Apple Silicon</a><a className="package-action" href="/chromatic/wifi-v1/source.tar.gz" download>Source · all platforms</a></div>
  <p>Extract the Mac download and run <code>./chromatic-wifi</code> in Terminal, then open its private launch link. Other platforms can run the source with Bun. This is an unsigned command-line preview.</p>
  {!token&&<p>Open the launch link printed by the helper to enable the check. The launch key stays in this page’s memory.</p>}
  <div className="chromatic-form"><label>Chromatic IP address<input value={ip} onChange={e=>setIp(e.target.value.trim())} inputMode="decimal" autoComplete="off" placeholder="192.168.1.20" maxLength={15} disabled={busy}/></label></div>
  <div className="chromatic-actions"><ActionButton primary disabled={!token||busy||!ip} onClick={()=>void check()}>Check Wi-Fi response</ActionButton>{busy&&<ActionButton onClick={()=>{abort.current?.abort();abort.current=null;setBusy(false);setMessage('Wi-Fi check cancelled.');}}>Cancel check</ActionButton>}</div>
  <p role="status" className="chromatic-status">{message}</p>
  <h3>What works over Wi-Fi</h3><p>This check sends one link-protocol probe and waits up to five seconds. It never resets the device. Game-service and multiplayer integration are still in development; this is not a Play button.</p>
  <p>Wireless firmware and cartridge management are not supported by the current device firmware. Use the USB connections for the available health and backup tools. WASM handles protocol logic, but a normal browser still needs the helper to reach this UDP link.</p>
  <details><summary>Helper details and source</summary><p>The helper accepts only game-link packets, one selected local device and one page at a time. CWL2 radio traffic is not encrypted or authenticated: use a trusted network. Stop the helper with Ctrl+C.</p><a href="/chromatic/wifi-v1/README.md">Read the development notes</a></details>
 </section>;
}
