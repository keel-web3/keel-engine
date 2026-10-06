export function integerFit(width,height,availableWidth,availableHeight) {
 if(![width,height,availableWidth,availableHeight].every(x=>Number.isFinite(x)&&x>0)||![width,height].every(Number.isInteger))throw new RangeError('Invalid pixel viewport.');
 const scale=Math.max(1,Math.floor(Math.min(availableWidth/width,availableHeight/height)));
 return {scale,width:width*scale,height:height*scale,overflow:width>availableWidth||height>availableHeight};
}
export function createKeelStore(initial) {
 let snapshot=initial;const listeners=new Set();
 return {getSnapshot:()=>snapshot,getServerSnapshot:()=>initial,subscribe(callback){listeners.add(callback);return()=>listeners.delete(callback);},setSnapshot(next){if(Object.is(snapshot,next))return; snapshot=next;for(const callback of [...listeners])callback();}};
}
export function createFrameLoop({draw,fps=30,schedule=callback=>requestAnimationFrame(callback),cancel=id=>cancelAnimationFrame(id),onError=error=>{throw error;}}) {
 if(!Number.isFinite(fps)||fps<1||fps>240)throw new RangeError('Invalid frame rate.');
 let frame=0,token=null,running=false,last=null,closed=false;
 const render=()=>draw(Object.freeze({frame,seconds:frame/fps,delta:1/fps}));
 const tick=now=>{token=null;if(!running||closed)return;try{if(last===null||now-last>=1000/fps-.01){last=now;render();frame++;}token=schedule(tick);}catch(error){running=false;onError(error);}};
 return {start(){if(running||closed)return;running=true;token=schedule(tick);},pause(){running=false;if(token!==null)cancel(token);token=null;last=null;},seek(next){if(closed)throw new Error('Scene disposed.');if(!Number.isSafeInteger(next)||next<0)throw new RangeError('Frame must be nonnegative.');frame=next;render();},dispose(){this.pause();closed=true;},get frame(){return frame;}};
}
