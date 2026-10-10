import test from 'node:test';
import assert from 'node:assert/strict';
import {createArenaMatch} from '../src/index.ts';
import {field,worldFrom,player} from './fixtures.ts';
test('equipment damage passes impact grace but consumes shields; score pressure passes both without erasing shields',()=>{
 const match=createArenaMatch(worldFrom([field()]),{players:[player()],mode:'expedition',defeatPolicy:'eliminate'});
 match.step([],[{id:'impact',ownerId:0,type:'damage',amount:1}]);assert.equal(match.readFrame().balls[0]!.health,5);
 match.step([],[{id:'weapon',ownerId:0,type:'equipment-damage',amount:1,sourceOwnerId:0}]);assert.equal(match.readFrame().balls[0]!.health,4);
 match.step([],[{id:'shield',ownerId:0,type:'shield',amount:1}]);
 let f=match.step([],[{id:'curve',ownerId:0,type:'score-pressure',amount:1}]);assert.equal(f.balls[0]!.health,3);assert(f.balls[0]!.shieldTicks>0);assert(f.events.some(e=>e.type==='damage'&&e.cause==='score-pressure'&&e.sourceOwnerId===undefined));
 f=match.step([],[{id:'weapon-2',ownerId:0,type:'equipment-damage',amount:1}]);assert.equal(f.balls[0]!.health,3);assert.equal(f.balls[0]!.shieldTicks,0);assert(f.events.some(e=>e.type==='damage'&&e.cause==='equipment'&&e.amount===0));
 const saved=match.snapshot(),clone=createArenaMatch(match.world,{players:match.players,mode:'expedition',defeatPolicy:'eliminate'});clone.restore(saved);assert.deepEqual(clone.snapshot(),saved);
});
test('score pressure has no PvP source and admitted rule commands remain idempotent and bounded',()=>{
 const match=createArenaMatch(worldFrom([field()]),{players:[player()],mode:'expedition',defeatPolicy:'eliminate'}),before=match.snapshot();
 assert.throws(()=>match.step([],[{id:'forged',ownerId:0,type:'score-pressure',amount:1,sourceOwnerId:0} as never]),/PvP/);assert.deepEqual(match.snapshot(),before);
 assert.throws(()=>match.step([],[{id:'oversize',ownerId:0,type:'equipment-damage',amount:101}]));assert.deepEqual(match.snapshot(),before);
 match.step([],[{id:'curve',ownerId:0,type:'score-pressure',amount:6}]);assert(match.readFrame().balls[0]!.eliminated);match.step([],[{id:'curve',ownerId:0,type:'score-pressure',amount:6},{id:'revive',ownerId:0,type:'heal',amount:100}]);assert.equal(match.readFrame().balls[0]!.health,0);
});
