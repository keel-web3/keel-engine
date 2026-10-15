export interface WifiState {phase:string;message:string;helper:boolean;transport:boolean;peer:boolean}
export function probeWifi(options:{token:string;ip:string;onState?:(state:WifiState)=>void;signal?:AbortSignal}):Promise<{protocol:string;deviceResponded:boolean;management:boolean;gameplayVerified:boolean}>;
