import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomEventJournal} from '../src/event-journal.ts';
import {createArenaMatch,ArenaInput} from '@keel-engine/pinball-arena';
import {field,worldFrom,player} from '../../pinball-arena/test/fixtures.ts';
test('all 100 admitted launch and pulse actions survive a crowded public event window',()=>{
 const stations=Array.from({length:100},(_,ownerId)=>({id:`seat-${ownerId}`,ownerId,teamId:ownerId,x:300+ownerId%10*230,y:300+Math.floor(ownerId/10)*230,layer:0,elevation:0,launchX:300+ownerId%10*230,launchY:300+Math.floor(ownerId/10)*230,launchVx:0,launchVy:6,flipperIds:[]}));
 const world=worldFrom([field({bounds:[64,64,3000,3000],stations})]),match=createArenaMatch(world,{players:stations.map(s=>player(s.ownerId)),mode:'battle'}),journal=createRoomEventJournal();
 const frame=match.step(stations.map(s=>({ownerId:s.ownerId,bits:ArenaInput.LAUNCH|ArenaInput.PULSE})));
 journal.append(frame.events);const actual=journal.take();
 assert.equal(actual.filter(e=>e.type==='launch').length,100);assert.equal(actual.filter(e=>e.type==='ability'&&e.ability==='pulse').length,100);
 assert.deepEqual(actual.filter(e=>e.type==='ability').map(e=>e.ownerId),Array.from({length:100},(_,i)=>i));
 journal.append(frame.events);const deferred=journal.take();assert.equal(deferred.length,44);assert.ok(deferred.every(event=>event.type==='mechanism-actuate'));
 assert.equal(new Set([...actual,...deferred].map(event=>event.id)).size,300);assert.equal(journal.take().length,0);
});
test('crowded packets defer actions and rotate contact cues fairly across owners',()=>{
 const journal=createRoomEventJournal(),events=Array.from({length:300},(_,i)=>({id:`1:${i}`,tick:1,type:'launch' as const,ownerId:i%100}));journal.append(events);
 const first=journal.take();assert.equal(first.length,256);assert.equal(journal.pending,44);
 for(let ownerId=0;ownerId<100;ownerId++)journal.append([{id:`2:${ownerId}`,tick:2,type:'flipper',ownerId}]);
 const second=journal.take();assert.deepEqual([...first,...second].filter(e=>e.type==='launch').map(e=>e.id),events.map(e=>e.id));
 const heard=new Set<number>();for(let tick=3;tick<8;tick++){journal.append(Array.from({length:100},(_,ownerId)=>({id:`${tick}:${ownerId}`,tick,type:'flipper' as const,ownerId})));for(const event of journal.take(23))heard.add(event.ownerId!);}
 assert.equal(heard.size,100);
});
test('duplicate action IDs are admitted once and expired action delivery fails explicitly',()=>{
 const journal=createRoomEventJournal(),action={id:'1:launch',tick:1,type:'launch' as const,ownerId:0};
 journal.append([action,action]);assert.equal(journal.pending,1);
 assert.throws(()=>journal.take(256,122),/publication deadline/);assert.equal(journal.pending,1);
 const contacts=createRoomEventJournal();contacts.append([{id:'1:contact',tick:1,type:'flipper',ownerId:0}]);
 assert.deepEqual(contacts.take(256,122),[]);assert.equal(contacts.pending,0);
});
test('continuous shared mechanism actuations coalesce while real capture actions remain reliable',()=>{
 const journal=createRoomEventJournal(),heard=new Set<string>(),captures:string[]=[];
 for(let tick=1;tick<=60;tick++){
  journal.append(Array.from({length:100},(_,ownerId)=>({id:`${tick}:${ownerId}:recoil`,tick,type:'mechanism-actuate' as const,ownerId,mechanismId:`shared-spring-${ownerId}`})));
  if(tick%12===1)journal.append([{id:`${tick}:capture`,tick,type:'capture-enter',ownerId:0,bodyId:'core-0',mechanismId:'scoop',entryPortId:'in',exitPortId:'out'}]);
  assert.ok(journal.pending<=101);
  if(tick%6===0)for(const event of journal.take(32,tick)){if(event.type==='mechanism-actuate')heard.add(event.mechanismId!);else captures.push(event.id);}
 }
 assert.equal(heard.size,100);assert.deepEqual(captures,['1:capture','13:capture','25:capture','37:capture','49:capture']);
 const before=journal.pending;assert.throws(()=>journal.append(Array.from({length:513},(_,index)=>({id:`61:${index}`,tick:61,type:'mechanism-actuate' as const,mechanismId:`new-${index}`}))),/capacity/);assert.equal(journal.pending,before);
});
