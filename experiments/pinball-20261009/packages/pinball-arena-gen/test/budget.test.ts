import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinballBudget,countPinballMechanisms,PinballBudgetError} from '../src/budget.ts';
import {pairedFlipperWorld,player} from '../../pinball-arena/test/fixtures.ts';
import {arenaMechanismSpecs} from '@keel-engine/pinball-arena';
import {captureWorld} from '../../pinball-arena/test/capture-fixtures.ts';
test('shared world debits every collider category and keeps100 owners inside one global cap',()=>{
 const budget=createPinballBudget();budget.reserve('owners',{players:100,bodies:100});budget.reserve('actual-multiball-reserve',{bodies:28});budget.reserve('all-blades',{flippers:200,colliders:200});budget.reserve('shared-mechanisms',{colliders:1848,ramps:256,arenas:4});
 assert.equal(budget.getStats().remaining.colliders,0);assert.equal(budget.getStats().remaining.bodies,0);
 const before=budget.getStats();assert.throws(()=>budget.reserve('one-more-rail',{colliders:1}),PinballBudgetError);assert.throws(()=>budget.reserve('extra-body',{bodies:1}),PinballBudgetError);assert.deepEqual(budget.getStats(),before);
 assert.throws(()=>createPinballBudget({colliders:2049}));assert.throws(()=>createPinballBudget({bodies:99}));
});
test('deterministic failed repairs roll back reservations without stale branches or aliases',()=>{
 const budget=createPinballBudget();budget.reserve('bank',{flippers:10,colliders:30});const baseline=budget.getStats(),checkpoint=budget.checkpoint();budget.replace('bank',{flippers:10,colliders:40});const branch=budget.checkpoint();budget.reserve('travel',{colliders:100});
 const beforeFailure=budget.getStats();assert.throws(()=>budget.replace('bank',{colliders:2000}),PinballBudgetError);assert.deepEqual(budget.getStats(),beforeFailure);
 budget.rollback(checkpoint);assert.deepEqual(budget.getStats(),baseline);assert.throws(()=>budget.rollback(branch));assert.throws(()=>budget.rollback({ordinal:checkpoint.ordinal}));
 const request={colliders:2};budget.reserve('copied',request);request.colliders=2048;assert.equal(budget.getStats().allocations.find(a=>a.id==='copied')!.counts.colliders,2);
 budget.release('copied');assert.deepEqual(budget.getStats(),baseline);assert.throws(()=>budget.reserve('bad',{colliders:NaN}));assert.throws(()=>budget.reserve('bad',{layers:4} as any));
});
test('compiled aggregate audit detects omitted mechanisms and extra body reservations',()=>{
 const world=pairedFlipperWorld(),budget=createPinballBudget(),roster=[player()];budget.reserve('owners',{players:1,bodies:1});budget.reserve('one-arena',{arenas:1});budget.reserve('mechanisms',countPinballMechanisms(world.arenas[0]!));const measured=budget.assertCompiled(world,roster);
 assert.equal(measured.flippers,2);assert.equal(measured.colliders,world.arenas[0]!.rails.length+world.arenas[0]!.gates.length+world.arenas[0]!.bumpers.length+2);
 assert.equal(measured.mechanisms,arenaMechanismSpecs(world).length);assert.equal(measured.captures,0);
 assert.throws(()=>budget.assertCompiled(world,roster,1),PinballBudgetError);budget.reserve('future-body',{bodies:1});assert.equal(budget.assertCompiled(world,roster,1).bodies,2);
 budget.replace('mechanisms',{colliders:measured.colliders-1,flippers:2,ramps:measured.ramps});assert.throws(()=>budget.assertCompiled(world,roster),PinballBudgetError);
});
test('capture occupancy and animation records share global caps and reject atomic under-debits',()=>{
 const budget=createPinballBudget();budget.reserve('shared-captures',{captures:256,mechanisms:256});budget.reserve('springs-and-gates',{mechanisms:256});
 const before=budget.getStats();assert.equal(before.remaining.captures,0);assert.equal(before.remaining.mechanisms,0);
 assert.throws(()=>budget.reserve('extra-capture',{captures:1}),PinballBudgetError);assert.throws(()=>budget.replace('springs-and-gates',{mechanisms:257}),PinballBudgetError);assert.deepEqual(budget.getStats(),before);
 assert.throws(()=>createPinballBudget({captures:257}));assert.throws(()=>createPinballBudget({mechanisms:513}));
 const world=pairedFlipperWorld(),roster=[player()],audit=createPinballBudget();audit.reserve('all-but-animation',{...countPinballMechanisms(world.arenas[0]!),mechanisms:0,players:1,bodies:1,arenas:1});
 assert.throws(()=>audit.assertCompiled(world,roster),PinballBudgetError);
 const captured=captureWorld(),captureAudit=createPinballBudget();captureAudit.reserve('all',{...countPinballMechanisms(captured.arenas[0]!),players:1,bodies:1,arenas:1});const actual=captureAudit.assertCompiled(captured,roster);assert.equal(actual.captures,1);assert.equal(actual.mechanisms,arenaMechanismSpecs(captured).length);
 captureAudit.replace('all',{...actual,captures:0});assert.throws(()=>captureAudit.assertCompiled(captured,roster),PinballBudgetError);
});
