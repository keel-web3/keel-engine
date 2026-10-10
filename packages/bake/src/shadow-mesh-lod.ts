// Polygon detail for the light's own orthographic projection, independent of camera LOD.
// Include Float32 position/model/world rounding; fail closed at very large coordinates.
export function shadowMeshError(light: ArrayLike<number>, model: ArrayLike<number>, lo: ArrayLike<number>, hi: ArrayLike<number>, error: number, size: number): { pixels: number; depth: number } {
  if (!(error >= 0) || !Number.isFinite(error) || !(size > 0) || !Number.isFinite(size) || lo.length !== 3 || hi.length !== 3 || light.length !== 16 || model.length !== 16) return { pixels: Infinity, depth: Infinity };
  for(let i=0;i<16;i++)if(!Number.isFinite(light[i])||!Number.isFinite(model[i]))return { pixels: Infinity, depth: Infinity };
  for(let i=0;i<3;i++)if(!Number.isFinite(lo[i])||!Number.isFinite(hi[i])||lo[i]!>hi[i]!)return { pixels: Infinity, depth: Infinity };
  if(model[3]!==0||model[7]!==0||model[11]!==0||model[15]!==1)return { pixels: Infinity, depth: Infinity };
  if(light[3]!==0||light[7]!==0||light[11]!==0||light[15]!==1)return { pixels: Infinity, depth: Infinity };
  const epsilon=2**-24,gamma=7*epsilon/(1-7*epsilon),extent=[0,1,2].map(i=>Math.max(Math.abs(lo[i]!),Math.abs(hi[i]!))+error);
  const localError=error+2*epsilon*Math.hypot(...extent),magnitude=[0,0,0],rounding=[0,0,0];
  for(let row=0;row<3;row++){
    const t=model[12+row]!,tf=Math.fround(t);magnitude[row]=Math.abs(tf);rounding[row]=Math.abs(tf-t);
    for(let axis=0;axis<3;axis++){
      const v=model[axis*4+row]!,vf=Math.fround(v);magnitude[row]!+=extent[axis]!*Math.abs(vf);rounding[row]!+=extent[axis]!*Math.abs(vf-v);
    }
    rounding[row]!+=gamma*magnitude[row]!;
  }
  const displacement=(row:number)=>{
    let scale2=0,round=Math.abs(Math.fround(light[12+row]!)-light[12+row]!),clipMagnitude=Math.abs(Math.fround(light[12+row]!));
    for(let axis=0;axis<3;axis++){
      let a=0;for(let j=0;j<3;j++)a+=Math.fround(light[j*4+row]!)*model[axis*4+j]!;
      const l=light[axis*4+row]!,lf=Math.fround(l);
      scale2+=a*a;round+=Math.abs(lf)*rounding[axis]!+Math.abs(lf-l)*magnitude[axis]!;
      clipMagnitude+=Math.abs(lf)*magnitude[axis]!;
    }
    return localError*Math.sqrt(scale2)+2*(round+gamma*clipMagnitude);
  };
  return {pixels:size*.5*Math.max(displacement(0),displacement(1)),depth:.5*displacement(2)};
}
