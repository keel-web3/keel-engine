export interface PageState {view:string;operation:{label:string;state:string;at:number}|null}
export function readPageState(site:string):PageState|null;
export function savePageState(site:string,data:PageState):boolean;
