export interface ScorePressureRules {
 readonly percentile:number;
 readonly pacePermille:number;
 readonly startGraceTicks:number;
 readonly deficitGraceTicks:number;
 readonly damageIntervalTicks:number;
 readonly damage:number;
}
export interface ScoredLife {readonly ownerId:number;readonly score:number;readonly eliminated:boolean}
export interface ScoreCurve {readonly living:number;readonly benchmark:number;readonly cutoff:number}
const integer=(n:unknown,lo:number,hi:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=lo&&n<=hi;
/** Initial balance proposal, not a playtested universal difficulty curve. */
export const DEFAULT_SCORE_PRESSURE:ScorePressureRules=Object.freeze({percentile:600,pacePermille:650,startGraceTicks:3600,deficitGraceTicks:600,damageIntervalTicks:240,damage:1});
export function admitScorePressure(value:ScorePressureRules):ScorePressureRules {
 if(!value||Object.keys(value).sort().join(',')!=='damage,damageIntervalTicks,deficitGraceTicks,pacePermille,percentile,startGraceTicks'||!integer(value.percentile,0,1000)||!integer(value.pacePermille,1,1000)||!integer(value.startGraceTicks,0,432000)||!integer(value.deficitGraceTicks,1,432000)||!integer(value.damageIntervalTicks,120,432000)||!integer(value.damage,1,100))throw new Error('Invalid score-pressure rules');
 return Object.freeze({...value});
}
/** Linear integer quantile over all living players, across every layer/arena.
 * Equal scores are safe because pressure compares strictly below the cutoff.
 * One remaining life has no score pressure; elimination already ends BR. */
export function deriveScoreCurve(lives:readonly ScoredLife[],source:ScorePressureRules=DEFAULT_SCORE_PRESSURE):ScoreCurve {
 const rules=admitScorePressure(source);
 if(!Array.isArray(lives)||lives.length>100||new Set(lives.map(p=>p.ownerId)).size!==lives.length||lives.some(p=>!integer(p.ownerId,0,99)||!integer(p.score,0,Number.MAX_SAFE_INTEGER)||typeof p.eliminated!=='boolean'))throw new Error('Invalid live-score population');
 const scores=lives.filter(p=>!p.eliminated).map(p=>p.score).sort((a,b)=>a-b);
 if(scores.length<2)return Object.freeze({living:scores.length,benchmark:0,cutoff:0});
 const position=(scores.length-1)*rules.percentile,index=Math.floor(position/1000),fraction=position%1000;
 const lo=scores[index]!,hi=scores[Math.min(index+1,scores.length-1)]!;
 const benchmark=lo+Number(BigInt(hi-lo)*BigInt(fraction)/1000n);
 return Object.freeze({living:scores.length,benchmark,cutoff:Number(BigInt(benchmark)*BigInt(rules.pacePermille)/1000n)});
}
