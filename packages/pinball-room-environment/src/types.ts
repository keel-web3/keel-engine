export type PinballRoomEnvironmentTheme='ion-relay'|'grove'|'vaporwave';
/** Presentation recipe derived by the game from its actual validated native bed. */
export interface PinballRoomEnvironmentRecipe{readonly worldSha256:string;readonly roomId:string;readonly detailSeed:string;readonly style:PinballRoomEnvironmentTheme;readonly bed:{readonly id:string;readonly height:number};readonly bounds:readonly[number,number,number,number];readonly center:{readonly x:number;readonly y:number};}
