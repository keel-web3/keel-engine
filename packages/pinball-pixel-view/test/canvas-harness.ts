/** Canvas2D recorder for geometry/guard tests. It does not claim browser
 * raster quality, device sampling or visual acceptance. */
export function createCanvasHarness(){
 const calls:unknown[][]=[];let width=300,height=150;
 const context={imageSmoothingEnabled:true,fillStyle:'',fillRect(...args:number[]){calls.push(['fill',...args]);},drawImage(_raster:unknown,...args:number[]){calls.push(['draw',...args]);}};
 const rasterContext={createImageData(w:number,h:number){calls.push(['image',w,h]);return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},putImageData(image:{data:Uint8ClampedArray},x:number,y:number){calls.push(['upload',x,y,Array.from(image.data)]);}};
 const raster={width:300,height:150,getContext(){calls.push(['raster-context']);return rasterContext;}};
 const element={style:{width:'100%',height:'100%'},get width(){return width;},set width(value:number){width=value;calls.push(['width',value]);},get height(){return height;},set height(value:number){height=value;calls.push(['height',value]);},getContext(){calls.push(['context']);return context;},ownerDocument:{createElement(tag:string){calls.push(['element',tag]);return raster;}}};
 return {canvas:element as unknown as HTMLCanvasElement,calls,context,style:element.style};
}
