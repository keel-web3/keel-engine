import{rampColours,type RoleLook}from'@keel-engine/core';
const look=(h:number,c:number,l:number,span=.40):RoleLook=>({hue:h,chroma:c,light:l,span,finish:'matte',pattern:{kind:'none',freq:1,angle:0,width:1,shift:0,ink:null}});
export function pinballPixelPalette():readonly(readonly[number,number,number])[]{return Object.freeze([look(275,.06,.19,.16),look(253,.08,.39,.20),look(230,.12,.45),look(45,.18,.61),look(195,.16,.68),look(335,.18,.60),look(80,.06,.85),look(255,.04,.50)].flatMap(v=>rampColours(v,5).map(c=>Object.freeze([...c] as[number,number,number]))));}
