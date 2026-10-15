/** Explicit local capture. Nothing is uploaded, recorded or resumed automatically. */
export const isChromatic = label => /\bchromatic\b/i.test(label || '');
export function stopTracks(stream) {for (const track of stream?.getTracks?.() || []) track.stop();}
export async function captureDevices(media) {
 if (!media?.enumerateDevices || !media?.getUserMedia) throw new Error('Camera capture is unavailable in this browser. Use a secure page in a browser with camera support, or capture directly in OBS.');
 const devices = await media.enumerateDevices();
 return {video:devices.filter(d=>d.kind==='videoinput'&&isChromatic(d.label)),audio:devices.filter(d=>d.kind==='audioinput'&&isChromatic(d.label))};
}
/** Permission discovery is a separate, clearly labelled user action. Its default
 * camera/microphone stream is stopped immediately and is never rendered. */
export async function revealCaptureDevices(media,kind) {
 if (!['video','audio'].includes(kind)) throw new Error('Invalid capture permission.');
 const stream=await media.getUserMedia({video:kind==='video',audio:kind==='audio'});
 stopTracks(stream);
 return captureDevices(media);
}
export class CaptureSession {
 constructor(media,{onEnded=()=>{},timeout=15000}={}) {this.media=media;this.onEnded=onEnded;this.timeout=timeout;this.generation=0;this.stream=null;}
 stop() {this.generation++;stopTracks(this.stream);this.stream=null;this.cancel?.();this.cancel=null;}
 async start(video,audio=null) {
  this.stop();const generation=this.generation;
  if (!video?.deviceId || !isChromatic(video.label) || video.kind!=='videoinput') throw new Error('Select a labelled Chromatic camera first.');
  if (audio&&(!audio.deviceId||!isChromatic(audio.label)||audio.kind!=='audioinput')) throw new Error('Select a labelled Chromatic audio input.');
  let timer;
  const work=this.media.getUserMedia({video:{deviceId:{exact:video.deviceId}},audio:audio?{deviceId:{exact:audio.deviceId},echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false}).then(stream=>{
   if (generation!==this.generation) {stopTracks(stream);throw new Error('Capture cancelled.');}
   const v=stream.getVideoTracks(),a=stream.getAudioTracks();
   if (v.length!==1||!isChromatic(v[0].label)||v[0].getSettings().deviceId!==video.deviceId || (audio?(a.length!==1||!isChromatic(a[0].label)||a[0].getSettings().deviceId!==audio.deviceId):a.length!==0)) {
    stopTracks(stream);throw new Error('The browser returned a different capture device. No preview was opened.');
   }
   this.stream=stream;
   for (const track of stream.getTracks()) track.addEventListener('ended',()=>{if(this.stream===stream){this.stop();this.onEnded();}},{once:true});
   return stream;
  });
  const cancelled=new Promise((_,reject)=>{this.cancel=()=>reject(new Error('Capture cancelled.'));timer=setTimeout(()=>{if(generation===this.generation){this.stop();}},this.timeout);});
  try {return await Promise.race([work,cancelled]);} finally {clearTimeout(timer);if(generation===this.generation)this.cancel=null;}
 }
}
