export function isChromatic(label:string):boolean;
export function stopTracks(stream:MediaStream|null):void;
export function captureDevices(media:MediaDevices):Promise<{video:MediaDeviceInfo[];audio:MediaDeviceInfo[]}>;
export function revealCaptureDevices(media:MediaDevices,kind:'video'|'audio'):Promise<{video:MediaDeviceInfo[];audio:MediaDeviceInfo[]}>;
export class CaptureSession {
 constructor(media:MediaDevices,options?:{onEnded?:()=>void;timeout?:number});
 start(video:MediaDeviceInfo,audio?:MediaDeviceInfo|null):Promise<MediaStream>;
 stop():void;
}
