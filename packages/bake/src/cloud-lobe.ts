/** A compact, smoothly shaded cloud lobe. The lower belly is flatter than its crown. */
export function cloudLobe(x: number, y: number, z: number, radius: number, height: number, top: number, under: number,
  emit: (positions: readonly number[], normals: readonly number[], slot: number) => void, turn = 0, squash = 1): void {
  const sides = 10, bands = 3;
  for (const sign of [1, -1]) for (let band = 0; band < bands; band++) for (let k = 0; k < sides; k++) {
    const point = (j: number, q: number): { p: number[]; n: number[] } => {
      const a = turn + j * Math.PI * 2 / sides, t = q * Math.PI / (2 * bands), c = Math.cos(t), s = Math.sin(t);
      const h = height * (sign > 0 ? 1 : .3), nx = Math.sin(a) * c / radius, ny = sign * s / h, nz = Math.cos(a) * c / (radius * squash), l = Math.hypot(nx, ny, nz) || 1;
      return {p:[x + Math.sin(a) * radius * c, y + sign * h * s, z + Math.cos(a) * radius * c * squash], n:[nx/l,ny/l,nz/l]};
    };
    const a=point(k,band),b=point(k+1,band),c=point(k+1,band+1),d=point(k,band+1),slot=sign>0?top:under;
    const triangle=(a:{p:number[];n:number[]},b:{p:number[];n:number[]},c:{p:number[];n:number[]})=>{
      const v=sign>0?[a,b,c]:[a,c,b];emit(v.flatMap(q=>q.p),v.flatMap(q=>q.n),slot);
    };
    triangle(a,b,c);
    if(band+1<bands)triangle(a,c,d);
  }
}
