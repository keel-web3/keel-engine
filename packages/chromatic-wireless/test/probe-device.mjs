import {createSocket} from 'node:dgram';
import {randomBytes} from 'node:crypto';
const ip=process.argv[2];if(!ip)throw new Error('Device IP required');
const socket=createSocket('udp4');let timer,done=false;
function finish(value){if(done)return;done=true;clearTimeout(timer);socket.close();console.log(JSON.stringify(value));}
socket.on('message',(b,from)=>{if(from.address===ip&&from.port===47820&&b.length===6&&b[0]===67&&b[1]===87&&b[2]===2&&b[3]===5)finish({cwl2Hello:true,elapsedMs:Date.now()-start,scope:'Protocol response only; no game transfer or management operation.'});});
socket.on('error',e=>finish({cwl2Hello:false,error:e.code}));
const start=Date.now();socket.bind(0,()=>{const s=randomBytes(2);socket.send(Buffer.from([67,87,2,6,s[0],s[1]]),47820,ip);timer=setTimeout(()=>finish({cwl2Hello:false,elapsedMs:Date.now()-start,reason:'No HELLO response; no retry or reset performed.'}),5000);});
