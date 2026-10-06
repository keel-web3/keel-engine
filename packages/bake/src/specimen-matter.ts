/** Actual material actions. Solids, ballistic motion and curl flow are supplied by KEEL;
 * this cartridge compiler lowers them to sixteen deterministic frame samples. */
import { lookMesh, type LookMesh } from './mesh.ts';
import { VolumeInstances, VOLUME_KIND } from './volumes.ts';
import { motionAt } from '@keel-engine/particles/pool';
import { createParticles,type Recipe } from '@keel-engine/particles/basic';
import { curlNoise } from '@keel-engine/core/curl';
import { stream,createRoll,normalizeSeed } from '@keel-engine/core/rng';
import type {SpecimenDynamic as DynamicMatter,SpecimenV3 as V3} from './specimen-types.ts';
export interface MatterFrame {meshes:LookMesh[];volumes:VolumeInstances;points:V3[]}
const add=(a:readonly number[],b:readonly number[]):V3=>[a[0]!+b[0]!,a[1]!+b[1]!,a[2]!+b[2]!];
export function matterFrame(node:DynamicMatter,seed:string,time:number,period:number):MatterFrame {
 const {at,size:s,material}=node,meshes:LookMesh[]=[],volumes=new VolumeInstances(64),points:V3[]=[];
 const world=(p:V3)=>add(at,p.map(v=>v*s)),mat=material*3;
 if(node.kind==='liquid'&&(node.flow==='viscous'||node.flow==='molten')){
  const phase=((time/period)%1+1)%1,path=node.path??[[-.35,.2,-.1],[-.1,.05,0],[.1,-.12,.1],[.35,-.3,.2]];
  const sample=(u:number):V3=>{const at=Math.min(path.length-1.000001,Math.max(0,u)*(path.length-1)),i=Math.floor(at),f=at-i;return path[i]!.map((v,k)=>v+(path[i+1]![k]!-v)*f) as V3;};
  const capsules:Array<{a:V3;b:V3;r:number;mat:number}>=[];
  // Continuous downhill channel with advected bulges, rather than falling water.
  for(let i=0;i<20;i++){const u=i/20,q=(u-phase)*Math.PI*4,r=.075+.016*Math.sin(q);capsules.push({a:world(sample(u)),b:world(sample((i+1)/20)),r:r*s,mat});}
  meshes.push(lookMesh({boxes:[],capsules},{around:8,rings:2}));
  const plates:Array<{c:V3;h:V3;yaw:number;lo:number;mat:number}>=[],seams:Array<{a:V3;b:V3;r:number;mat:number}>=[];
  for(let i=0;i<7;i++){const u=(i/7+phase)%1,fade=Math.sin(Math.PI*u),p=sample(u),next=sample(Math.min(1,u+.07)),yaw=Math.atan2(next[0]-p[0],next[2]-p[2]);
   if(node.flow==='molten')plates.push({c:world([p[0],p[1]+.047,p[2]]),h:[.052*s*fade,.013*s*fade,.083*s*fade],yaw,lo:0,mat:mat+1});
   seams.push({a:world([p[0]-.025,p[1]+.058,p[2]]),b:world([next[0]-.025,next[1]+.058,next[2]]),r:Math.max(.001,.012*s*fade),mat:mat+2});
  }
  meshes.push(lookMesh({boxes:plates,capsules:seams},{around:6,rings:1}));
 }else if(node.kind==='liquid'&&(node.flow==='pour'||node.flow==='jet')){
  // A continuous stream (top of path, default 0.95 above the pool) with bulges travelling down it,
  // staggered splash crowns where it lands and ripple rings crossing the pool; every part closes its loop.
  const phase=((time/period)%1+1)%1,top=node.path?.[0]?.[1]??.95,x0=node.path?.[0]?.[0]??0,z0=node.path?.[0]?.[2]??0,radius=.48*s,center=world([0,0,0]),capsules:Array<{a:V3;b:V3;r:number;mat:number}>=[];
  const pool=lookMesh({boxes:[],capsules:[{a:center,b:center,r:radius,mat}]},{around:24,rings:6});
  for(let i=0;i<pool.positions.length;i+=3){const upper=pool.positions[i+1]!>=center[1];pool.positions[i+1]=center[1]+(pool.positions[i+1]!-center[1])*.14;if(upper){pool.normals[i]=0;pool.normals[i+1]=1;pool.normals[i+2]=0;}}
  meshes.push(pool);
  // pour: bulges travel down to the pool; jet: up from the vent, and the spray falls back from the top.
  const up=node.flow==='jet'?-1:1,n=12;for(let i=0;i<n;i++){const u=i/n,v=(i+1)/n,y=(t:number)=>top+(.05-top)*t,bulge=(t:number)=>.075+.025*Math.sin((t*3-up*phase)*Math.PI*2)*(node.flow==='jet'?.6+.4*t:1),xs=(t:number)=>x0*(1-t);capsules.push({a:world([xs(u),y(u),z0*(1-u)]),b:world([xs(v),y(v),z0*(1-v)]),r:bulge((u+v)/2)*s,mat});}
  if(node.flow==='jet')for(let k=0;k<8;k++){const age=((phase+k/8)%1)*period,a=k*2.4,m:number[]=[];motionAt([x0,top,z0],[Math.cos(a)*.3,.25,Math.sin(a)*.3],[0,0,0],0,0,1.6,age*.6,10,m);if(m[1]!<.05)continue;const p=world([m[0]!,m[1]!,m[2]!]),f=1-age/period;capsules.push({a:p,b:p,r:Math.max(.012,.04*f)*s,mat:mat+2});}
  for(let crown=0;crown<2;crown++){const age=((phase+crown*.5)%1)*period*.5,u=age/(period*.5);
   for(let k=0;k<5;k++){const a=k*Math.PI*2/5+crown*.6,m:number[]=[];motionAt([0,.03,0],[Math.cos(a)*.38,.55,Math.sin(a)*.38],[0,0,0],0,0,2.2,age,10,m);if(m[1]!<.03)continue;const p=world([m[0]!,m[1]!,m[2]!]);capsules.push({a:p,b:p,r:Math.max(.012,.03*(1-u))*s,mat:mat+2});}
   const ring=.1+u*.34;for(let k=0;k<14;k++){const a=k*Math.PI/7,b=(k+1)*Math.PI/7;capsules.push({a:world([Math.cos(a)*ring,.04,Math.sin(a)*ring]),b:world([Math.cos(b)*ring,.04,Math.sin(b)*ring]),r:.016*s*(1-u*.6),mat:mat+2});}}
  meshes.push(lookMesh({boxes:[],capsules},{around:8,rings:2}));points.push(world([0,top+.1,0]));
 }else if(node.kind==='liquid'&&node.flow==='wave'){
  const phase=time/period,segments:Array<{a:V3;b:V3;r:number;mat:number}>=[];
  for(let row=0;row<5;row++)for(let i=0;i<18;i++){const x=-.55+i/18*1.1,z=-.32+row*.16;
   const height=(q:number)=>.08+.095*Math.sin((q*1.5-phase)*Math.PI*2)+.02*Math.sin(z*5+phase*Math.PI*2);
   segments.push({a:world([x,height(x),z]),b:world([x+1.1/18,height(x+1.1/18),z]),r:.082*s,mat:row===2?mat+2:mat});}
  meshes.push(lookMesh({boxes:[],capsules:segments},{around:6,rings:1}));
 }else if(node.kind==='liquid'){
  const cycle=period,dropAge=((time%cycle)+cycle)%cycle,flight=cycle*.75;
  // Impact happens at the end of the fall. Its splash and wave continue across the loop join.
  const age=((dropAge-flight+cycle)%cycle),u=age/cycle;
  // Stationary edge, a physically localized travelling ring on the upper fluid surface.
  const radius=.48*s,center=world([0,0,0]);const pool=lookMesh({boxes:[],capsules:[{a:center,b:center,r:radius,mat}]},{around:24,rings:6});
  for(let i=0;i<pool.positions.length;i+=3){const x=pool.positions[i]!-center[0],z=pool.positions[i+2]!-center[2],r=Math.hypot(x,z)/s,upper=pool.positions[i+1]!>=center[1],front=.08+u*.48;
   const q=(r-front)/.065,h=upper?.055*Math.exp(-q*q)*(1-u):0;
   pool.positions[i+1]=center[1]+(pool.positions[i+1]!-center[1])*.12+h*s;
   if(upper){const dh=-q/.065*.11*Math.exp(-q*q)*(1-u),nx=r>0?-dh*x/(r*s):0,nz=r>0?-dh*z/(r*s):0,n=Math.hypot(nx,1,nz);pool.normals[i]=nx/n;pool.normals[i+1]=1/n;pool.normals[i+2]=nz/n;}
  }
  meshes.push(pool);
  const capsules:Array<{a:V3;b:V3;r:number;mat:number}>=[];
  // The next falling packet of water, accelerated by the same KEEL ballistic solver as particles.
  const position:number[]=[];motionAt([0,.80,0],[0,-.12,0],[0,0,0],0,0,1.6/(flight*flight)-.24/flight,dropAge,10,position);
  if(dropAge<flight){const birth=Math.min(1,dropAge/(cycle*.12)),drop=world([position[0]!,Math.max(.03,position[1]!),position[2]!]),tip=world([0,Math.max(.03,position[1]!)+(.06+dropAge/cycle*.09)*birth,0]);capsules.push({a:drop,b:tip,r:Math.max(.002,.085*birth)*s,mat});}
  // An impact crown breaks into separate droplets, each following its own ballistic arc.
  if(age<.72)for(let k=0;k<6;k++){
   const a=k*Math.PI/3,m:number[]=[];motionAt([0,.025,0],[Math.cos(a)*.45,.65,Math.sin(a)*.45],[0,0,0],0,0,1.8,age,10,m);
   if(m[1]!<.025)continue;const p=world([m[0]!,m[1]!,m[2]!]);capsules.push({a:age<.22?world([Math.cos(a)*.045,.02,Math.sin(a)*.045]):p,b:p,r:Math.max(.015,.035*(1-u))*s,mat:mat+2});
  }
  // White crest of the wave travels away from the impact, rather than moving the whole puddle.
  const ring=.08+u*.48;if(u<.88)for(let k=0;k<16;k++){const a=k*Math.PI/8,b=(k+1)*Math.PI/8;capsules.push({a:world([Math.cos(a)*ring,.045,Math.sin(a)*ring]),b:world([Math.cos(b)*ring,.045,Math.sin(b)*ring]),r:.018*s*(1-u*.7),mat:mat+2});}
  meshes.push(lookMesh({boxes:[],capsules},{around:8,rings:2}));
 }else{
  // Each plume is born, advected by KEEL physics, then consumed/expanded by its age.
  const births=11;
  for(let birth=0;birth<births;birth++){
   const age=((time/period-birth/births+1)%1)*period;
   const fire=node.kind==='combustion',life=period*(fire?.44:.74);if(age>=life)continue;
   const S=stream(createRoll(normalizeSeed(seed)),90+birth),x=S.between(-.19,.19),z=S.between(-.1,.1);
   const recipe:Recipe={life:[life,life],speed:[.01,.04],up:[(fire?.6:.43)*s,(fire?.85:.56)*s],gravity:(fire?-.16:-.06)*s,drag:.5,size:[fire?.24:.2,fire?.35:.29],light:[1,1],fade:.1,ramp:fire?'fire':'smoke'};
   const pool=createParticles(1,{recipes:{plume:recipe}});pool.emit('plume',world([x,0,z]),{count:1,S,spread:.12});for(let t=0;t<age-1e-9;){const dt=Math.min(1/120,age-t);pool.step(dt);t+=dt;}
   const state=pool.save()[0]!;if(!state)continue;const q=age/life,flow:number[]=[];curlNoise(x*3+birth*.31,age*2,z*3,age,flow);
   const envelope=Math.min(1,q/.16,(1-q)/.18),p=add(state.p,[flow[0]!*.11*s,0,flow[2]!*.1*s]),r=Math.max(.002,state.size*s*(fire?1-q*.45:1+q*.9)*envelope);
   volumes.push(...p,r,fire?VOLUME_KIND.fire:VOLUME_KIND.smoke,birth*1.317,q,0,4,1);points.push([p[0]-r,p[1]-r,p[2]-r],[p[0]+r,p[1]+r*1.8,p[2]+r]);
   // Combustion products detach from the hot upper tongue and continue upward as cooling smoke.
   if(fire&&q>.35){const smoke=world([x+flow[0]!*.15,.6+q*.6,z]),fade=Math.min(1,(q-.35)/.16,(1-q)/.18);const sr=Math.max(.002,.12*s*(.6+q)*fade);volumes.push(...smoke,sr,VOLUME_KIND.smoke,birth*2.13,(q-.35)/.65,0,4,.6*fade);points.push([smoke[0]-sr*2,smoke[1]-sr,smoke[2]-sr*2],[smoke[0]+sr*2,smoke[1]+sr*2,smoke[2]+sr*2]);}
  }
 }
 return {meshes,volumes,points};
}
