// SPDX-License-Identifier: MIT
import {startBridge} from './server.mjs';
const bridge=startBridge();
const site=process.argv.includes('--egress')?'egress':'crucible';
console.log('Chromatic Wi-Fi bridge is running on this computer only.');
console.log('Game-link packets only. It cannot flash firmware or cartridges.');
console.log(`Open https://${site}.onkeel.io/chromatic/#wifi-bridge=${bridge.token}`);
console.log('Quit with Ctrl+C. Keep the launch link private.');
let stopping=false;
function stop(){if(stopping)return;stopping=true;bridge.close();process.exit(0);}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,stop);
// Native app owns stdin. Exit on EOF if its window/process disappears.
if(process.env.CHROMATIC_APP_PARENT==='1'){process.stdin.on('end',stop);process.stdin.on('error',stop);process.stdin.resume();}

