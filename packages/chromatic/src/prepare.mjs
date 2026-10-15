import {fetchEngine,loadSram} from './sram.mjs';
import {grantedDevices,ConsoleSession} from './transport.mjs';
import {readCartInfo,readCartStatus} from './cbu1.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/** Only volatile FPGA preparation. Never cancel an existing cartridge operation. */
export async function prepareCartridge({nav,session,bridge,onSession=()=>{},onStage=()=>{},onDisconnect=()=>{}},{fetchImage=fetchEngine,loadImage=loadSram,wait=sleep,reconnectMs=30000}={}){
 if(!session||session.closed||!bridge?.opened)throw new Error('Connect both the console and USB bridge before reading the cartridge.');
 const original=session.port,known=await grantedDevices(nav);
 if(known.ports.length!==1||known.ports[0]!==original||known.bridges.length!==1||known.bridges[0]!==bridge)throw new Error('Keep only this Chromatic connected before preparing cartridge access.');
 onStage('Checking for an unfinished cartridge operation');await readCartStatus(session);
 onStage('Downloading and checking the temporary engine');const image=await fetchImage();
 // Install the listener before closing; only physical USB loss counts, not port.close().
 let lost=false;const disconnected=e=>{if(e.port===original||e.target===original)lost=true;};
 nav.serial.addEventListener('disconnect',disconnected);
 let next;
 try{
  onStage('Loading temporary FPGA access; the screen and console will restart');
  await session.close();
  await loadImage(bridge,image,(n,total)=>onStage(`Loading temporary FPGA access · ${Math.floor(n/total*100)}%`));
  onStage('Waiting for the console to return after the FPGA restart');
  const end=Date.now()+reconnectMs;let returned;
  while(Date.now()<end){
   const ports=(await grantedDevices(nav)).ports;
   if(lost&&ports.length===1){returned=ports[0];break;}
   if(ports.length>1)throw new Error('Multiple consoles returned. Select this Chromatic again before continuing.');
   await wait(200);
  }
  if(!lost)throw new Error('The selected console did not disconnect during preparation. The console and bridge may belong to different devices. No cartridge command was sent.');
  if(!returned)throw new Error('The console did not return after preparation. Reconnect it here; no cartridge bytes were written.');
  onStage('Opening the returned console');next=new ConsoleSession(returned,onDisconnect);await next.open();
  // FPGA and MCU boot independently; allow their console startup before the first request.
  await wait(1500);
  onStage('Checking the prepared cartridge engine');
  const info=await readCartInfo(next);
  if(!info.engine)throw new Error('The cartridge engine did not confirm it is ready. No backup or install was started.');
  onSession(next);return info;
 }catch(e){if(next)await next.close();throw e;}
 finally{nav.serial.removeEventListener('disconnect',disconnected);}
}
