import type {ArenaWorldDefinition, ArenaFrame, ArenaField, ArenaBallFrame} from '@keel-engine/pinball-arena';
import {createPlayfieldFramingIndex,solvePlayfieldOrigins,type PlayfieldFramingDefinition} from './playfield-framing-v2.ts';

export type CameraPoint = readonly [number, number];
export interface CameraSafeInsets {readonly left:number;readonly top:number;readonly right:number;readonly bottom:number}
export interface PinballCameraViewport {readonly width:number;readonly height:number;readonly safeInsets?:CameraSafeInsets;readonly mode?:'follow'|'overview';readonly cssPixelsPerPixel?:number}
export interface PinballCameraReadability {
 readonly ballDiameterPixels?:number;
 readonly ballDiameterCssPixels?:number;
 readonly bladeLengthPixels?:number;
 readonly bladeLengthCssPixels?:number;
 readonly bladeThicknessPixels?:number;
 readonly bladeThicknessCssPixels?:number;
}
export interface PinballCameraOptions {
 /** Exact optional room/connector source membership. Explicit MAP remains a
  * world overview; gameplay centers fitting axes at the same readable scale. */
 readonly playfieldFraming?:PlayfieldFramingDefinition;
 /** Opt-in presentation driven only by observed native ball positions.
  * The ground plane retains one XY scale; all geometry uses the same view. */
 readonly depthMotion?:Readonly<{maximumTranslationPixels?:number;maximumElevationRatioDelta?:number;dampingTicks?:number}>;
 /** Fit the source playfield whenever balls and blades remain readable. */
 readonly framing?:'follow'|'adaptive';
 /** Gameplay legibility at both indexed-raster and actual displayed sizes. */
 readonly readability?:PinballCameraReadability;
 /** Independent maximum full-field scale; leaves follow's nominal scale intact. */
 readonly fitMaximumScale?:number;
 /** Uniform ground-plane pixels per native unit. Elevation is projected separately. */
 readonly scale?:number;
 readonly elevationRatio?:number;
 readonly leadTicks?:number;
 readonly maximumLead?:number;
 readonly dampingTicks?:number;
 readonly deadZone?:number;
 /** Presentation only: sphere-on-plane adds radius vertically, not a slope-normal lift. */
 readonly bodyHeight?:'native-plane'|'sphere-on-plane';
 /** First native launch blends an arena overview into ball-follow. Zero disables it. */
 readonly introTicks?:number;
 /** Camera-only preview after a native drain or a late waiting-frame join.
  * Fits the nearest source bank and launch origin without claiming a lease. */
 readonly waitingStationPreview?:boolean;
}
type Box = {x0:number;y0:number;x1:number;y1:number};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function finite(value:number,name:string,min=-1e9,max=1e9){if(!Number.isFinite(value)||value<min||value>max)throw Error('Invalid camera '+name);return value;}
function boxOf(points:readonly {x:number;y:number;r:number}[]):Box {
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const p of points){x0=Math.min(x0,p.x-p.r);x1=Math.max(x1,p.x+p.r);y0=Math.min(y0,p.y-p.r);y1=Math.max(y1,p.y+p.r);}
 return{x0,y0,x1,y1};
}
function nearest(field:ArenaField,x:number,y:number){return field.stations.reduce((a,b)=>{const da=(a.x-x)**2+(a.y-y)**2,db=(b.x-x)**2+(b.y-y)**2;return db<da||(db===da&&b.id<a.id)?b:a;});}

/** One rig per source world and observed owner. Observe every completed native
 * tick, including while hidden. Rendering never advances state. Backward ticks
 * restart the presentation state; reset before replay/seek and feed all source
 * frames to reproduce the original camera exactly. Memory is constant-size. */
export function createPinballCameraRig(world:ArenaWorldDefinition,ownerId:number,options:PinballCameraOptions={}) {
 if(!Number.isSafeInteger(ownerId)||ownerId<0)throw Error('Invalid camera owner');
 const framing=options.framing??'follow';if(framing!=='follow'&&framing!=='adaptive')throw Error('Invalid camera framing');
 const nominalScale=finite(options.scale??(framing==='adaptive'?.4375:.82),'scale',.1,4),elevationRatio=finite(options.elevationRatio??.8,'elevation ratio',0,2),leadTicks=finite(options.leadTicks??7,'lead ticks',0,30),maximumLead=finite(options.maximumLead??85,'maximum lead',0,500),dampingTicks=finite(options.dampingTicks??7,'damping ticks',1,120),deadZone=finite(options.deadZone??14,'dead zone',0,100);
 const fitMaximumScale=finite(options.fitMaximumScale??nominalScale,'fit maximum scale',.1,4);
 const depth=options.depthMotion===undefined?null:{
  maximumTranslationPixels:finite(options.depthMotion.maximumTranslationPixels??6,'depth translation',0,8),
  maximumElevationRatioDelta:finite(options.depthMotion.maximumElevationRatioDelta??.02,'depth elevation delta',0,.02),
  dampingTicks:finite(options.depthMotion.dampingTicks??18,'depth damping',1,120),
 };
 let depthX=0,depthY=0,viewElevationRatio=elevationRatio;
 const readability={ballDiameterPixels:finite(options.readability?.ballDiameterPixels??8,'ball raster readability',1,256),ballDiameterCssPixels:finite(options.readability?.ballDiameterCssPixels??12,'ball display readability',1,256),bladeLengthPixels:finite(options.readability?.bladeLengthPixels??16,'blade raster readability',1,512),bladeLengthCssPixels:finite(options.readability?.bladeLengthCssPixels??24,'blade display readability',1,512),bladeThicknessPixels:finite(options.readability?.bladeThicknessPixels??0,'blade raster thickness',0,64),bladeThicknessCssPixels:finite(options.readability?.bladeThicknessCssPixels??0,'blade display thickness',0,64)};
 const bodyHeight=options.bodyHeight===undefined?'native-plane':options.bodyHeight;
 if(bodyHeight!=='native-plane'&&bodyHeight!=='sphere-on-plane')throw Error('Invalid camera body height');
 const introTicks=options.introTicks===undefined?0:options.introTicks;
 if(!Number.isSafeInteger(introTicks)||introTicks<0||introTicks>360)throw Error('Invalid camera intro ticks');
 const waitingStationPreview=options.waitingStationPreview===undefined?false:options.waitingStationPreview;
 if(typeof waitingStationPreview!=='boolean')throw Error('Invalid camera waiting station preview');
 const visualElevation=(elevation:number,radius:number)=>bodyHeight==='sphere-on-plane'?finite(elevation+radius,'visual body elevation'):elevation;
 if(!world.arenas.length||world.arenas.some(a=>!a.stations.length))throw Error('Camera world requires source stations');
 const sourceFraming=options.playfieldFraming===undefined?null:createPlayfieldFramingIndex(world,options.playfieldFraming);
 const fields=new Map(world.arenas.map(a=>[a.id,a]));
 let observed:ArenaFrame|null=null,body:ArenaBallFrame|null=null,field:ArenaField|null=null;
 let center:CameraPoint=[0,0],anchor:CameraPoint=[0,0],lastElevation=0,discontinuity=false;
 let firstLaunchTick:number|null=null,introSkipped=false;
 let bridge:null|{scope:'same-arena-selected-native-exit'|'cross-arena-selected-native-exit';progress:number;receiverStationId:string|null;previewStationId:string;entryStationId:string|null;exitPortId:string;phaseTick:number;plannedReleaseTick:number;pathId:string|null}=null;
 const plane=(x:number,y:number,z:number):CameraPoint=>[x,-y-z*viewElevationRatio];
 // Source geometry only: gameplay movement never resizes this envelope.
 const mapBoxes=new Map<string,Box>();
 function sourceBox(a:ArenaField){
  let box=mapBoxes.get(a.id);if(box)return box;
  const points:{x:number;y:number;r:number}[]=[];
  for(const s of a.surfaces)for(const [i,p]of s.polygon.entries()){const q=plane(p.x,p.y,s.vertexElevations?.[i]??s.height);points.push({x:q[0],y:q[1],r:0});}
  for(const rail of a.rails)for(const q of[plane(rail.ax,rail.ay,rail.elevation??0),plane(rail.bx,rail.by,rail.elevationB??rail.elevation??0)])points.push({x:q[0],y:q[1],r:rail.radius});
  for(const f of a.flippers){const q=plane(f.pivotX,f.pivotY,f.elevation??0);if(Number.isFinite(f.length)&&Number.isFinite(f.radius))points.push({x:q[0],y:q[1],r:f.length+f.radius});}
  if(!points.length)return null;
  const raw=boxOf(points),margin=32;
  box={x0:raw.x0-margin,y0:raw.y0-margin,x1:raw.x1+margin,y1:raw.y1+margin};mapBoxes.set(a.id,box);return box;
 }
 function reset(frame?:ArenaFrame){observed=null;body=null;field=null;bridge=null;center=[0,0];anchor=[0,0];lastElevation=0;discontinuity=false;firstLaunchTick=null;introSkipped=false;depthX=0;depthY=0;viewElevationRatio=elevationRatio;mapBoxes.clear();if(frame)observe(frame);}
 function observe(frame:ArenaFrame){
  if(!Number.isSafeInteger(frame.tick)||frame.tick<0)throw Error('Invalid camera source tick');
  // Same tick is idempotent. A different source at that tick requires reset().
  if(observed?.tick===frame.tick){if(observed!==frame&&JSON.stringify(observed)!==JSON.stringify(frame))throw Error('Conflicting camera source tick; reset first');return;}
  const next=frame.balls.find(b=>b.ownerId===ownerId);if(!next)throw Error('Missing actual focus body');
  const nextField=fields.get(next.arenaId);if(!nextField)throw Error('Missing actual body arena');
  for(const [name,v]of Object.entries({x:next.x,y:next.y,elevation:next.elevation,vx:next.vx,vy:next.vy,radius:next.radius}))finite(v,name);
  if(next.radius<=0)throw Error('Invalid camera body radius');
  const previousTick=observed?.tick,previousField=field?.id;
  const nextDiscontinuity=previousTick!==undefined&&(frame.tick!==previousTick+1||previousField!==nextField.id);
  let nextDepthX=depthX,nextDepthY=depthY,nextElevationRatio=viewElevationRatio;
  if(depth){
   const bank=nextField.stations.find(s=>s.id===next.stationId)??nearest(nextField,next.x,next.y);
   const active=next.active&&!next.eliminated&&next.transport===null&&(introTicks===0||introSkipped||(firstLaunchTick!==null&&frame.tick-firstLaunchTick>=introTicks));
   const dx=active?clamp((next.x-bank.x)/480,-1,1):0,dy=active?clamp((next.y-bank.y-320)/720,-1,1):0;
   if(previousTick===undefined||nextDiscontinuity){nextDepthX=dx;nextDepthY=dy;}
   else{const alpha=1-Math.exp(-1/depth.dampingTicks);nextDepthX+= (dx-depthX)*alpha;nextDepthY+= (dy-depthY)*alpha;}
   nextElevationRatio=clamp(elevationRatio+nextDepthY*depth.maximumElevationRatioDelta,0,2);
  }
  const observationPlane=(x:number,y:number,z:number):CameraPoint=>[x,-y-z*nextElevationRatio];
  const nextVisualElevation=visualElevation(next.elevation,next.radius);
  let target=observationPlane(next.x,next.y,nextVisualElevation),nextBridge:typeof bridge=null;
  const t=next.transport;
  if(t){
   if(!Number.isSafeInteger(t.phaseTick)||t.phaseTick>frame.tick||!Number.isSafeInteger(t.entryTick)||t.entryTick>t.phaseTick)throw Error('Invalid camera transport clock');
   if(t.plannedReleaseTick!==null&&(!Number.isSafeInteger(t.plannedReleaseTick)||t.plannedReleaseTick<t.entryTick))throw Error('Invalid camera release clock');
   const exitField=fields.get(t.exitArenaId),exit=exitField?.pinball?.ports.find(p=>p.id===t.exitPortId);
   if(!exit||!exitField)throw Error('Missing selected native camera exit');
   for(const value of [exit.x,exit.y,exit.elevation])finite(value,'selected exit');
   if(t.plannedReleaseTick!==null){
    // Keep the native mouth readable throughout the actual capture HOLD.
    // Transit timing starts at its source phaseTick, never at capture entry.
    const raw=t.phase==='captured'?0:t.phase==='exit-blocked'?1:clamp((frame.tick-t.phaseTick)/Math.max(1,t.plannedReleaseTick-t.phaseTick),0,1),p=clamp(raw/.85,0,1),progress=p*p*(3-2*p);
    const capture=nextField.captures?.find(c=>c.id===t.mechanismId),entry=nextField.pinball?.ports.find(port=>port.id===capture?.entryPortId);
    let path=nextField.pinball?.paths.find(p=>p.entryPortId===capture?.entryPortId&&p.exitPortId===exit.id);
    // Compiled underchannels may have distinct lower-elevation ports beneath
    // the capture and receiver. Use an unambiguous exact XY connection only;
    // the source/exit vertical shafts remain camera anchors, never body poses.
    if(!path&&entry&&exitField.id===nextField.id){
     const candidates=(nextField.pinball?.paths??[]).filter(p=>{const a=p.vertices[0],b=p.vertices[p.vertices.length-1];return p.role==='travel'&&a&&b&&a.x===entry.x&&a.y===entry.y&&b.x===exit.x&&b.y===exit.y;});
     if(candidates.length===1)path=candidates[0];
    }
    // These are camera anchors, never an interpolated native body or render proxy.
    const route=path?.vertices.length?path.vertices:null;
    if(exitField.id===nextField.id){
     if(route){const points=[{x:next.x,y:next.y,elevation:next.elevation},...route,exit],segments=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i]!.x,p.y-points[i]!.y,p.elevation-points[i]!.elevation)),total=segments.reduce((a,b)=>a+b,0);let distance=progress*total;for(let i=0;i<segments.length;i++){const length=segments[i]!;if(distance<=length||i===segments.length-1){const a=points[i]!,b=points[i+1]!,fraction=length?clamp(distance/length,0,1):1;target=observationPlane(mix(a.x,b.x,fraction),mix(a.y,b.y,fraction),visualElevation(mix(a.elevation,b.elevation,fraction),next.radius));break;}distance-=length;}}
     else{const end=observationPlane(exit.x,exit.y,visualElevation(exit.elevation,next.radius));target=[mix(target[0],end[0],progress),mix(target[1],end[1],progress)];}
    }
    nextBridge={scope:exitField.id===nextField.id?'same-arena-selected-native-exit':'cross-arena-selected-native-exit',progress,receiverStationId:exit.receiverCatchId??null,previewStationId:nearest(exitField,exit.x,exit.y).id,entryStationId:next.stationId,exitPortId:exit.id,phaseTick:t.phaseTick,plannedReleaseTick:t.plannedReleaseTick,pathId:path?.id??null};
   }
  }else if(next.active&&!next.eliminated){
   const dz=previousTick!==undefined&&frame.tick===previousTick+1?nextVisualElevation-lastElevation:0;
   let lx=next.vx*leadTicks,ly=(-next.vy-clamp(dz,-24,24)*nextElevationRatio)*leadTicks;
   const length=Math.hypot(lx,ly);if(length>maximumLead){lx*=maximumLead/length;ly*=maximumLead/length;}target=[target[0]+lx,target[1]+ly];
  }
  finite(target[0],'target x');finite(target[1],'target y');
  anchor=target;
  if(previousTick===undefined||nextDiscontinuity)center=target;
  else{const alpha=1-Math.exp(-1/dampingTicks),dx=target[0]-center[0],dy=target[1]-center[1],step=(d:number)=>Math.sign(d)*Math.max(0,Math.abs(d)-deadZone)*alpha;center=[center[0]+step(dx),center[1]+step(dy)];}
  discontinuity=nextDiscontinuity;bridge=nextBridge;
  if(previousTick!==undefined&&frame.tick<previousTick){firstLaunchTick=null;introSkipped=false;}
  if(firstLaunchTick===null&&!introSkipped){
   // Replay seeks and joins during a captured/transport frame are not a new
   // plunger launch. Only a genuinely initial waiting ball arms the intro.
   if(next.transport!==null||next.eliminated||((previousTick===undefined||frame.tick<(previousTick??0))&&frame.tick>0))introSkipped=true;
   else if(next.active&&!next.eliminated)firstLaunchTick=frame.tick;
  }
  if(depth){depthX=nextDepthX;depthY=nextDepthY;if(viewElevationRatio!==nextElevationRatio)mapBoxes.clear();viewElevationRatio=nextElevationRatio;}
  observed=frame;body=next;field=nextField;lastElevation=nextVisualElevation;
 }
 function sample(viewport:PinballCameraViewport){
  if(!observed||!body||!field)throw Error('Observe a native frame before camera sampling');
  const frame=observed,b=body,a=field,width=finite(viewport.width,'width',64,32768),height=finite(viewport.height,'height',64,32768),safe=viewport.safeInsets??{left:12,top:12,right:12,bottom:24};
  for(const v of [safe.left,safe.top,safe.right,safe.bottom])finite(v,'safe inset',0,32768);
  const sw=width-safe.left-safe.right,sh=height-safe.top-safe.bottom;if(sw<48||sh<48)throw Error('Invalid camera safe area');
  const cssPixelsPerPixel=finite(viewport.cssPixelsPerPixel??1,'CSS pixel scale',.01,100);
  const lease=frame.stations.find(s=>s.arenaId===a.id&&s.ownerId===ownerId),stationId=b.stationId??lease?.id;
  const presentationOnly=stationId==null,station=stationId!=null?a.stations.find(s=>s.id===stationId):nearest(a,b.x,b.y);if(!station)throw Error('Missing actual camera station');
  if(!station.flipperIds.length)throw Error('Camera station requires source blades');
  const pair=station.flipperIds.map(id=>{const f=a.flippers.find(f=>f.id===id);if(!f)throw Error('Missing source blade');return f;});
  const poses=frame.flippers.filter(f=>f.arenaId===a.id&&station.flipperIds.includes(f.id));
  for(const p of poses)for(const v of[p.pivotX,p.pivotY,p.tipX,p.tipY,p.radius,p.elevation])finite(v,'blade pose');
  const actualBallVisible=b.active&&!b.eliminated&&b.transport===null,bodyVisualElevation=visualElevation(b.elevation,b.radius),focus=plane(b.x,b.y,bodyVisualElevation),nativeFocus=plane(b.x,b.y,b.elevation),bank=plane(pair.reduce((v,f)=>v+f.pivotX,0)/pair.length,pair.reduce((v,f)=>v+f.pivotY,0)/pair.length,station.elevation??0);
  // Native proximity only: no arena, cabinet, target or backdrop bounds in follow.
  const pairApplicable=actualBallVisible&&!presentationOnly&&poses.length===pair.length&&poses.every(p=>p.ownerId===ownerId)&&Math.abs(b.elevation-(station.elevation??0))<=48&&Math.abs(nativeFocus[0]-bank[0])<=210&&Math.abs(nativeFocus[1]-bank[1])<=250;
  const points:{x:number;y:number;r:number}[]=[{x:actualBallVisible?focus[0]:anchor[0],y:actualBallVisible?focus[1]:anchor[1],r:actualBallVisible?b.radius:0}];
  if(pairApplicable)for(const p of poses)for(const q of[plane(p.pivotX,p.pivotY,p.elevation),plane(p.tipX,p.tipY,p.elevation)])points.push({x:q[0],y:q[1],r:p.radius});
  const explicitOverview=viewport.mode==='overview',prelaunch=introTicks>0&&!introSkipped&&firstLaunchTick===null&&!b.active;
  const introRaw=introTicks&&!introSkipped&&firstLaunchTick!==null?clamp((frame.tick-firstLaunchTick)/introTicks,0,1):1,introProgress=introRaw*introRaw*(3-2*introRaw);
  const padding=10;
  let minimumBladeLength=Math.min(...pair.map(f=>Number.isFinite(f.length)?f.length:64));
  let minimumBladeThickness=Math.min(...pair.map(f=>Number.isFinite(f.radius)&&f.radius>0?f.radius*2:12));
  let readableScale=Math.max(readability.ballDiameterPixels/(b.radius*2),readability.ballDiameterCssPixels/(b.radius*2*cssPixelsPerPixel),readability.bladeLengthPixels/minimumBladeLength,readability.bladeLengthCssPixels/(minimumBladeLength*cssPixelsPerPixel),readability.bladeThicknessPixels/minimumBladeThickness,readability.bladeThicknessCssPixels/(minimumBladeThickness*cssPixelsPerPixel));
  let waitingPairPreview=false,sourceWaitingStationId:string|null=null;
  // Initial prelaunch and explicit overview retain their existing source
  // framing. This branch never alters native ownership or ball visibility.
  if(waitingStationPreview&&!b.active&&!b.eliminated&&b.transport===null&&!explicitOverview&&!prelaunch&&(firstLaunchTick!==null||introSkipped)){
   const waitingStation=nearest(a,b.x,b.y);sourceWaitingStationId=waitingStation.id;
   const waitingPair=waitingStation.flipperIds.map(id=>{const blade=a.flippers.find(f=>f.id===id);if(!blade)throw Error('Missing waiting source blade');return blade;});
   const waitingPoses=frame.flippers.filter(f=>f.arenaId===a.id&&waitingStation.flipperIds.includes(f.id));
   for(const p of waitingPoses){for(const v of[p.pivotX,p.pivotY,p.tipX,p.tipY,p.radius,p.elevation])finite(v,'waiting blade pose');if(p.radius<=0)throw Error('Invalid camera waiting blade radius');}
   const complete=waitingPair.length>0&&waitingPoses.length===waitingPair.length&&waitingPair.every(f=>waitingPoses.some(p=>p.id===f.id))&&waitingStation.layer===b.layer&&Math.abs(waitingStation.elevation-b.elevation)<=48&&waitingPoses.every(p=>p.layer===waitingStation.layer&&Math.abs(p.elevation-waitingStation.elevation)<=48);
   if(complete){
    for(const v of[waitingStation.launchX,waitingStation.launchY,waitingStation.elevation])finite(v,'waiting launch origin');
    const launch=plane(waitingStation.launchX,waitingStation.launchY,waitingStation.elevation),previewPoints=[...points,{x:launch[0],y:launch[1],r:0}];
    for(const p of waitingPoses)for(const q of[plane(p.pivotX,p.pivotY,p.elevation),plane(p.tipX,p.tipY,p.elevation)])previewPoints.push({x:q[0],y:q[1],r:p.radius});
    const previewBox=boxOf(previewPoints),length=Math.min(...waitingPair.map(f=>Number.isFinite(f.length)?f.length:64)),thickness=Math.min(...waitingPair.map(f=>Number.isFinite(f.radius)&&f.radius>0?f.radius*2:12));
    const previewReadableScale=Math.max(readability.ballDiameterPixels/(b.radius*2),readability.ballDiameterCssPixels/(b.radius*2*cssPixelsPerPixel),readability.bladeLengthPixels/length,readability.bladeLengthCssPixels/(length*cssPixelsPerPixel),readability.bladeThicknessPixels/thickness,readability.bladeThicknessCssPixels/(thickness*cssPixelsPerPixel));
    const availableScale=Math.min((sw-padding*2)/Math.max(1,previewBox.x1-previewBox.x0),(sh-padding*2)/Math.max(1,previewBox.y1-previewBox.y0));
    if(availableScale>=(framing==='adaptive'?previewReadableScale:nominalScale*.65)){
     points.push(...previewPoints.slice(points.length));waitingPairPreview=true;minimumBladeLength=length;minimumBladeThickness=thickness;readableScale=previewReadableScale;
    }
   }
  }
  const sourceSelection=sourceFraming?.select(frame,ownerId,explicitOverview||prelaunch?'overview':'follow')??null;
  const scopedBounds=sourceSelection&&sourceSelection.kind!=='world'?sourceFraming!.bounds(sourceSelection,viewElevationRatio):null;
  const scopedBox=scopedBounds?{x0:scopedBounds.x0-32,y0:scopedBounds.y0-32,x1:scopedBounds.x1+32,y1:scopedBounds.y1+32}:null;
  const followBox=boxOf(points),mapBox=framing==='adaptive'?(scopedBox??sourceBox(a)):null;
  const mapScale=mapBox?Math.min(fitMaximumScale,(sw-padding*2)/(mapBox.x1-mapBox.x0),(sh-padding*2)/(mapBox.y1-mapBox.y0)):0;
  const focusInside=!!mapBox&&(!actualBallVisible||(focus[0]-b.radius>=mapBox.x0&&focus[0]+b.radius<=mapBox.x1&&focus[1]-b.radius>=mapBox.y0&&focus[1]+b.radius<=mapBox.y1));
  const protectedScopeContained=!scopedBox||(followBox.x0>=scopedBox.x0&&followBox.x1<=scopedBox.x1&&followBox.y0>=scopedBox.y0&&followBox.y1<=scopedBox.y1);
  const fits=framing==='adaptive'&&!explicitOverview&&focusInside&&protectedScopeContained&&mapScale>=readableScale;
  const overview=explicitOverview||prelaunch||fits;
  if(overview){for(const s of a.surfaces)for(const [i,p]of s.polygon.entries()){const q=plane(p.x,p.y,s.vertexElevations?.[i]??s.height);points.push({x:q[0],y:q[1],r:0});}for(const rail of a.rails)for(const q of[plane(rail.ax,rail.ay,rail.elevation??0),plane(rail.bx,rail.by,rail.elevationB??rail.elevation??0)])points.push({x:q[0],y:q[1],r:rail.radius});}
  const box=overview&&mapBox?mapBox:boxOf(points),followTarget=framing==='adaptive'?Math.max(nominalScale,readableScale):nominalScale;
  const widthScale=overview?fitMaximumScale:framing==='adaptive'&&mapBox?Math.max(readableScale,(sw-padding*2)/(mapBox.x1-mapBox.x0)):nominalScale;
  const scale=Math.min(overview?fitMaximumScale:followTarget,widthScale,(sw-padding*2)/Math.max(1,box.x1-box.x0),(sh-padding*2)/Math.max(1,box.y1-box.y0)),elevationScale=scale*elevationRatio;
  let left=center[0]*scale-(safe.left+sw/2),top=center[1]*scale-(safe.top+sh*.48);
  if(!overview&&mapBox&&focusInside){
   if((mapBox.x1-mapBox.x0)*scale<=sw-padding*2)left=(mapBox.x0+mapBox.x1)*scale/2-(safe.left+sw/2);
   if((mapBox.y1-mapBox.y0)*scale>sh-padding*2)top=clamp(top,mapBox.y0*scale-safe.top-padding,mapBox.y1*scale-(height-safe.bottom-padding));
  }
  if(overview){left=(box.x0+box.x1)*scale/2-(safe.left+sw/2);top=(box.y0+box.y1)*scale/2-(safe.top+sh/2);}
  // Safety wins over damping. A fast collision cannot move the actual ball or
  // applicable blades behind existing physical controls for one render frame.
  left=clamp(left,box.x1*scale-(width-safe.right-padding),box.x0*scale-safe.left-padding);
  top=clamp(top,box.y1*scale-(height-safe.bottom-padding),box.y0*scale-safe.top-padding);
  let finalScale=scale,finalLeft=left,finalTop=top;
  if(!overview&&introProgress<1){
   const mapPoints=[...points];
   for(const s of a.surfaces)for(const [i,p]of s.polygon.entries()){const q=plane(p.x,p.y,s.vertexElevations?.[i]??s.height);mapPoints.push({x:q[0],y:q[1],r:0});}
   for(const rail of a.rails)for(const q of[plane(rail.ax,rail.ay,rail.elevation??0),plane(rail.bx,rail.by,rail.elevationB??rail.elevation??0)])mapPoints.push({x:q[0],y:q[1],r:rail.radius});
   const mapBox=boxOf(mapPoints),mapScale=Math.min(fitMaximumScale,(sw-padding*2)/Math.max(1,mapBox.x1-mapBox.x0),(sh-padding*2)/Math.max(1,mapBox.y1-mapBox.y0)),mapLeft=(mapBox.x0+mapBox.x1)*mapScale/2-(safe.left+sw/2),mapTop=(mapBox.y0+mapBox.y1)*mapScale/2-(safe.top+sh/2);
   finalScale=mix(mapScale,scale,introProgress);
   finalLeft=mix(mapLeft/mapScale,left/scale,introProgress)*finalScale;finalTop=mix(mapTop/mapScale,top/scale,introProgress)*finalScale;
   finalLeft=clamp(finalLeft,followBox.x1*finalScale-(width-safe.right-padding),followBox.x0*finalScale-safe.left-padding);
   finalTop=clamp(finalTop,followBox.y1*finalScale-(height-safe.bottom-padding),followBox.y0*finalScale-safe.top-padding);
  }
  const scopedOrigins=scopedBox&&!overview&&introProgress>=1?solvePlayfieldOrigins({bounds:scopedBox,protectedBounds:followBox,scale:finalScale,width,height,safeInsets:safe,followLeft:finalLeft,followTop:finalTop,padding}):null;
  if(scopedOrigins?.status==='ok'){finalLeft=scopedOrigins.left!;finalTop=scopedOrigins.top!;}
  let depthAppliedX=0,depthAppliedY=0;
  if(depth){
   const beforeLeft=finalLeft,beforeTop=finalTop;
   const protectedBox=overview&&mapBox?mapBox:followBox;
   finalLeft=clamp(finalLeft+depthX*depth.maximumTranslationPixels,protectedBox.x1*finalScale-(width-safe.right),protectedBox.x0*finalScale-safe.left);
   finalTop=clamp(finalTop+depthY*depth.maximumTranslationPixels*.5,protectedBox.y1*finalScale-(height-safe.bottom),protectedBox.y0*finalScale-safe.top);
   depthAppliedX=finalLeft-beforeLeft;depthAppliedY=finalTop-beforeTop;
  }
  // A displayed sample must retain its exact view after the rig observes a
  // later native frame (including inverse input against that displayed frame).
  const sampleElevationRatio=viewElevationRatio;
  const sampleElevationScale=finalScale*sampleElevationRatio;
  const project=(x:number,y:number,z:number):CameraPoint=>[Math.round(x*finalScale-finalLeft),Math.round(depth?-y*finalScale-z*sampleElevationScale-finalTop:(-y-z*sampleElevationRatio)*finalScale-finalTop)];
  const viewToPlane=(x:number,y:number,z:number):CameraPoint=>{
   finite(x,'inverse view x');finite(y,'inverse view y');finite(z,'inverse plane height');
   return[(x+finalLeft)/finalScale,-(y+finalTop)/finalScale-z*sampleElevationRatio];
  };
  const q=project(b.x,b.y,bodyVisualElevation),r=b.radius*finalScale,ballBounds=[q[0]-r,q[1]-r,q[0]+r,q[1]+r] as const;
  const ballInSafeArea=actualBallVisible?ballBounds[0]>=safe.left&&ballBounds[1]>=safe.top&&ballBounds[2]<=width-safe.right&&ballBounds[3]<=height-safe.bottom:null;
  return{body:b,bodyVisualElevation,renderBallElevation:bodyVisualElevation,field:a,station,pair,presentationOnly,scale:finalScale,elevationScale:finalScale*viewElevationRatio,left:finalLeft,top:finalTop,project,viewToPlane,retainPair:pairApplicable&&(!overview||fits),transportBridge:bridge,framing:{...(sourceFraming?{sourceFraming:{revision:sourceFraming.revision,selection:sourceSelection,scopedBounds,axes:scopedOrigins?.axes??null,originStatus:scopedOrigins?.status??null,scopeAvailable:scopedBox!==null,scopeApplied:scopedBox!==null&&(fits||scopedOrigins?.status==='ok'),policyStage:'before-common-depth' as const}}:{}),...(depth?{depthMotion:{revision:'native-coherent-depth/1',source:'observed-native-position',normalized:[depthX,depthY],translation:[depthAppliedX,depthAppliedY],elevationRatio:viewElevationRatio,maximumTranslationPixels:depth.maximumTranslationPixels,maximumElevationRatioDelta:depth.maximumElevationRatioDelta}}:{}),bodyHeightConvention:bodyHeight,tick:frame.tick,mode:fits?'fit' as const:overview?'overview' as const:'follow' as const,introPhase:explicitOverview?'overview':fits?'fit':prelaunch?'prelaunch':introProgress<1?'launch':'follow',introProgress:prelaunch?0:introProgress,firstLaunchTick,introSkipped,ballInSafeArea,ballBounds,ballDiameterPixels:r*2,ballDiameterCssPixels:r*2*cssPixelsPerPixel,pairApplicable,retainedPair:pairApplicable&&(!overview||fits),waitingPairPreview,sourceWaitingStationId,nominalScale,zoomRatio:finalScale/nominalScale,usefulZoom:framing==='adaptive'?finalScale+1e-9>=readableScale:finalScale>=nominalScale*.65,adaptiveFraming:framing==='adaptive',fullPlayfieldReadable:fits,readability:{...readability},minimumBladeLengthPixels:minimumBladeLength*finalScale,minimumBladeLengthCssPixels:minimumBladeLength*finalScale*cssPixelsPerPixel,minimumBladeThicknessPixels:minimumBladeThickness*finalScale,minimumBladeThicknessCssPixels:minimumBladeThickness*finalScale*cssPixelsPerPixel,readableScale,fitScale:mapScale,fitMaximumScale,cssPixelsPerPixel,playfieldBounds:mapBox,safeInsets:{...safe},sourceDiscontinuity:discontinuity,sourceArenaId:b.arenaId,sourceStationId:b.stationId,cameraAnchor:[...anchor] as number[],cameraCenter:[...center] as number[],cachedFrames:1,presentationOnly:true as const}};
 }
 return{observe,reset,sample,get tick(){return observed?.tick??null;}};
}
export type PinballCameraRig=ReturnType<typeof createPinballCameraRig>;
export type PinballCameraSample=ReturnType<PinballCameraRig['sample']>;
