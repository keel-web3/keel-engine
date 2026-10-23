import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaBedArtMesh,arenaBedPanelMesh,arenaBedPrintCanvas } from "../src/bed-art.ts";
import { pinballFrameMaterial, pinballThemeFromBiome, worldArtPaint, FIELD_ROLES,PINBALL_SCENE_BLUEPRINTS,planPinballSceneGenome,type PinballFrameTheme } from "@keel-engine/pinball-world-art";
import type { ArenaSurface } from "@keel-engine/pinball-arena";
import {field}from"../../pinball-arena/test/fixtures.ts";

test("cabinet prints use six distinct bounded mesh motifs on the exact sloped bed plane", () => {
  const themes: readonly PinballFrameTheme[] = ["cyber", "vapor", "gold", "nature", "crypto", "nightshift"];
  const outlines = [
    [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 700 }, { x: 100, y: 700 }],
    [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 260 }, { x: 400, y: 260 }, { x: 400, y: 700 }, { x: 100, y: 700 }],
  ];
  const motifs = new Set<string>(), paints = new Set<string>();
  for (const theme of themes) for (const polygon of outlines) {
    const biome = pinballFrameMaterial(theme);
    assert.equal(pinballThemeFromBiome(biome), theme);
    const bed: ArenaSurface = { id: "bed", kind: "playfield", role: "catch", polygon, height: 40, vertexElevations: polygon.map(p => 40 + p.x * .1), layer: 0, material: "pinball-inlay", biome };
    const before = JSON.stringify(bed), mesh = arenaBedArtMesh(bed, .025);
    assert.equal(JSON.stringify(bed), before);
    assert.ok(mesh.indices.length > 0 && mesh.indices.length <= 384 * 6);
    assert.ok([...mesh.positions, ...mesh.normals, ...mesh.bodies].every(Number.isFinite));
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]! / .025, y = mesh.positions[i + 2]! / .025;
      assert.ok(x >= 100 && x <= 900 && y >= 100 && y <= 700);
      if (polygon.length > 4) assert.ok(x <= 400 || y <= 260, "print must not paint across the concave open footprint");
      assert.ok(Math.abs(mesh.positions[i + 1]! - (40 + x * .1) * .025 - .028) < 1e-5);
    }
    if (polygon.length === 4) { motifs.add(JSON.stringify([...mesh.positions])); paints.add(JSON.stringify(worldArtPaint(FIELD_ROLES, "same", biome))); }
  }
  assert.equal(motifs.size, themes.length); assert.equal(paints.size, themes.length);
});

test("whole-field panels clip concave native footprints and remain on exact sloped support without mutating authority",()=>{
  const polygon=[{x:100,y:100},{x:900,y:100},{x:900,y:260},{x:400,y:260},{x:400,y:700},{x:100,y:700}],identities=new Set<string>();
  for(const blueprint of Object.values(PINBALL_SCENE_BLUEPRINTS)){const scene=planPinballSceneGenome("cafe",0,blueprint),surface:ArenaSurface={id:"native-bed",kind:"playfield",role:"catch",polygon,height:40,vertexElevations:polygon.map(p=>40+p.x*.1),layer:0,material:"pinball-inlay",biome:scene.biome},before=JSON.stringify(surface),mesh=arenaBedPanelMesh(surface,.025,scene);
    assert.ok(mesh.indices.length>0 && mesh.indices.length<4096*3);assert.ok([...mesh.positions,...mesh.normals,...mesh.attrs].every(Number.isFinite));assert.equal(JSON.stringify(surface),before);
    for(let i=0;i<mesh.positions.length;i+=3){const x=mesh.positions[i]!/.025,y=mesh.positions[i+2]!/.025;assert.ok(x>=100-.001&&x<=900+.001&&y>=100-.001&&y<=700+.001);assert.ok(x<=400+.001||y<=260+.001);assert.ok(Math.abs(mesh.positions[i+1]!-((40+x*.1)*.025+.014))<1e-5);}
    for(let i=0;i<mesh.indices.length;i+=3){const at=(n:number)=>{const a=mesh.indices[i+n]!*3;return[mesh.positions[a]!,mesh.positions[a+2]!]as const;},a=at(0),b=at(1),c=at(2);assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<0,"paint faces native sky");}
    identities.add(JSON.stringify([...mesh.positions,...mesh.attrs]));
  }
  assert.equal(identities.size,Object.keys(PINBALL_SCENE_BLUEPRINTS).length);
});

test("overlapping real fan and support surfaces share one seeded receiving-bank print canvas",()=>{
  const source=field(),bank=source.stations[0]!,biome=source.regions[0]!.biome,fan:ArenaSurface={id:`${bank.id}.fan`,kind:"playfield",polygon:[{x:200,y:100},{x:1000,y:100},{x:1000,y:700},{x:200,y:700}],height:bank.elevation,layer:bank.layer,material:"pinball-inlay",biome},support={...fan,id:"support",polygon:[{x:100,y:50},{x:1100,y:50},{x:1100,y:750},{x:100,y:750}]},physical={...source,stations:[bank],surfaces:[fan,support]},seed=planPinballSceneGenome("cafe",0,PINBALL_SCENE_BLUEPRINTS.cyber).seed;
  const a=arenaBedPrintCanvas(fan,physical,seed),b=arenaBedPrintCanvas(support,physical,seed);for(const point of [[-320,-320],[0,0],[320,320]]as const)assert.deepEqual(a(point),b(point));assert.notDeepEqual(a([320,320]),arenaBedPrintCanvas(fan,physical,planPinballSceneGenome("beef",0,PINBALL_SCENE_BLUEPRINTS.cyber).seed)([320,320]));
});
