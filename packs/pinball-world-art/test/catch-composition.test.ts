import { test } from "node:test";
import assert from "node:assert/strict";
import { pinballCatchFronts, pinballCatchFrontClear, PINBALL_SCENE_BLUEPRINTS, planPinballSceneGenome, pinballPrintContours } from "../src/index.ts";
import { pairedFlipperWorld } from "../../../packages/pinball-arena/test/fixtures.ts";

test("catch openings follow real drains under rotations and mirrored blade labels, preserving recessed scenery", () => {
  const native = pairedFlipperWorld().arenas[0]!;
  for (const angle of [0, .4, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (const mirror of [false, true]) {
    const rotate = (x: number, y: number) => ({ x: Math.cos(angle) * x - Math.sin(angle) * y, y: Math.sin(angle) * x + Math.cos(angle) * y });
    const field = { ...native, flippers: native.flippers.map(f => { const p=rotate(f.pivotX,f.pivotY);return {...f,pivotX:p.x,pivotY:p.y,side:mirror?(f.side==="left"?"right":"left") as "left"|"right":f.side}; }), hazards: native.hazards!.map(h=>({...h,...rotate(h.x,h.y)})) }, before=JSON.stringify(field),front=pinballCatchFronts(field)[0]!;
    const drain=field.hazards!.find(h=>h.kind==="drain")!;
    assert.ok((drain.x-front.x)*front.upX+(drain.y-front.y)*front.upY<0,"the native drain remains behind the opening");
    const point={x:front.x-front.upX*200,y:front.y-front.upY*200};
    assert.equal(pinballCatchFrontClear([front],point,20,front.layer,front.elevation,front.elevation+140),false);
    assert.equal(pinballCatchFrontClear([front],point,20,front.layer,front.elevation,front.elevation-20),true,"recessed mid/far masses remain whole");
    assert.equal(pinballCatchFrontClear([front],point,20,front.layer+1,front.elevation,front.elevation+140),true,"a different real chamber layer owns its own architecture");
    assert.equal(pinballCatchFrontClear([front],{x:front.x+front.upX*300,y:front.y+front.upY*300},20,front.layer,front.elevation,front.elevation+140),true,"upfield side and back architecture remain eligible");
    assert.equal(JSON.stringify(field),before);
  }
});

test("each starter biome has admitted substantial distinct matte artwork in the body-readable local fan", () => {
  const shapes=[];
  for(const blueprint of Object.values(PINBALL_SCENE_BLUEPRINTS)) {
    const scene=planPinballSceneGenome("cafe",0,blueprint),local=scene.print.primitives.filter(p=>Math.max(Math.abs(p.a[0]),Math.abs(p.b[0]))<=110&&Math.min(p.a[1],p.b[1])<300);
    assert.ok(local.length>=16,"large local artwork survives the field crop");
    const panels=pinballPrintContours(local);assert.ok(panels.length>=3);
    assert.ok(panels.some(p=>Math.max(...p.points.map(q=>q[0]))-Math.min(...p.points.map(q=>q[0]))>=40));
    shapes.push(JSON.stringify(local));
  }
  assert.equal(new Set(shapes).size,shapes.length);
});
