import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultProject, addPlane, generateProject } from "../src/generator";
import { cloneProject, isWaterProvince } from "../src/domain";
import { assertPlaneGenerationOverrides, preferredDryTerrain, applyPlaneRoutePreferences } from "../src/generationControls";
import { buildPackageFiles, estimatedTextPackageBytes, parseProject, serializeProject } from "../src/export";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { compileMapText, encodeD6m, validateProject } from "../src/dom6";
import { inspectNativeMap, inspectNativeRaster } from "../src/nativeInspection";
import { captureGenerationInputs } from "../src/workbench";
import { createSettingsRecipe, parseSettingsRecipe } from "../src/recipes";
import { PlanePreferencesPanel } from "../src/PlanePreferencesPanel";

const baseline=createDefaultProject("preferences-regression");
test("plane preferences are strict, bounded, persisted, and tracked as pending generation",()=>{
  for(const value of [{mystery:1},{waterPercent:61},{caveWaterPercent:-1},{roadPercent:80,riverPercent:30},{guardianCoveragePercent:81},{guardianRosterScale:3},{terrainWeights:{lava:1}},{regions:[{name:"x",x0:1,x1:0,y0:0,y1:1,terrain:"forest"}]}])assert.throws(()=>assertPlaneGenerationOverrides(value));
  const p=cloneProject(baseline);p.planes[0]!.generationOverrides={waterPercent:30,terrainWeights:{forest:3},guardianCoveragePercent:30,guardianRosterScale:1.5};
  assert.deepEqual(parseProject(serializeProject(p)).planes[0]!.generationOverrides,p.planes[0]!.generationOverrides);
  assert.notEqual(captureGenerationInputs(p).planes,captureGenerationInputs(baseline).planes);
  assert.deepEqual(parseSettingsRecipe(JSON.stringify(createSettingsRecipe(p))).planes[0]!.generationOverrides,p.planes[0]!.generationOverrides);
});
test("regional dry terrain scales to coordinates without changing water, walls or cave medium",()=>{
  const plane=cloneProject(baseline).planes[0]!;plane.generationOverrides={regions:[{name:"north",x0:0,y0:0,x1:1,y1:.5,terrain:"forest"}]};
  assert.equal(preferredDryTerrain(plane,"farm",.5,.25,"x"),"forest");
  assert.equal(preferredDryTerrain(plane,"farm",.5,.75,"x"),"farm");
  assert.equal(preferredDryTerrain(plane,"sea",.5,.25,"x"),"sea");
  assert.equal(preferredDryTerrain(plane,"cavewall",.5,.25,"x"),"cavewall");
  assert.equal(preferredDryTerrain(plane,"cave",.5,.25,"x"),"caveforest");
});
test("opt-in controls preserve playable starts, Styx, gates and blocker-free exports",()=>{
  let p=cloneProject(baseline);p.settings.players=4;p.settings.startDistribution={land:4,coastal:0,water:0,cave:0,other:0};p.settings.throneCount=3;
  for(const kind of ["cave","underworld","abyss"] as const)p=addPlane(p,kind,{generate:false});
  p.planes[0]!.generationOverrides={waterPercent:30,roadPercent:30,riverPercent:10,passPercent:10,terrainWeights:{forest:3,farm:2},guardianCoveragePercent:60,manySitesPercent:70};
  p.planes[1]!.generationOverrides={caveWaterPercent:0};p.planes[2]!.generationOverrides={caveWaterPercent:0,waterPercent:0,guardianCoveragePercent:80,guardianRosterScale:2};
  const g=generateProject(p);
  assert.equal(g.planes[1]!.provinces.filter(isWaterProvince).length,0);
  assert.ok(g.planes[2]!.provinces.filter(isWaterProvince).length>0);
  assert.ok(g.gates.length>0);
  assert.deepEqual(validateProject(g).filter(i=>i.severity==="error"),[]);
  for(const plane of g.planes){
    const starts=new Set(plane.provinces.filter(v=>v.start||v.teamStart!==undefined).map(v=>v.id));
    for(const s of g.specificStarts)if(s.planeId===plane.id)starts.add(s.provinceId);
    const safe=new Set(starts);for(const e of plane.edges){if(starts.has(e.a))safe.add(e.b);if(starts.has(e.b))safe.add(e.a);}
    for(const v of plane.provinces)if(safe.has(v.id)){assert.equal(v.defenders.length,0);assert.ok(v.throne!=="fixed"&&v.throne!=="preferred");}
  }
});
test("route preferences retain water, capital and impassable edges",()=>{
  const p=cloneProject(baseline),plane=p.planes[0]!;plane.generationOverrides={roadPercent:100};
  const starts=new Set(plane.provinces.filter(v=>v.start).map(v=>v.id));const water=new Set(plane.provinces.filter(isWaterProvince).map(v=>v.id));
  plane.edges[0]!.kind="impassable";const before=structuredClone(plane.edges);applyPlaneRoutePreferences(p,plane);
  for(let i=0;i<before.length;i++){const e=before[i]!;if(e.kind==="impassable"||starts.has(e.a)||starts.has(e.b)||water.has(e.a)||water.has(e.b))assert.deepEqual(plane.edges[i],e);}
});
test("native map inventory never executes directives, reports unknown commands and validates masks",()=>{
  const report=inspectNativeMap(compileMapText(baseline,0));
  assert.equal(report.provinceCount,baseline.planes[0]!.provinces.length);assert.equal(report.starts,6);assert.ok(report.neighbours>0);
  const external=inspectNativeMap('#dom2title "External"\n#imagefile "../not-opened.tga"\n#terrain 1 18446744073709551615\n#script danger\n#terrain 2 18446744073709551616\n#neighbour 1 999');
  assert.deepEqual(external.unrecognized,["#script"]);assert.ok(external.warnings.some(w=>/not be opened/.test(w)));assert.ok(external.warnings.some(w=>/64-bit/.test(w)));assert.ok(external.warnings.some(w=>/999/.test(w)));
  assert.throws(()=>inspectNativeMap('#dom2title "unfinished'),/unterminated/);
});
test("player packages retain identical playable bytes and omit all host dossiers",async()=>{
  const p=cloneProject(baseline);p.planes[0]!.width=256;p.planes[0]!.height=256;
  const host=await buildPackageFiles(p),player=await buildPackageFiles(p,undefined,undefined,"player");
  assert.equal(player.length,3);assert.ok(player.some(f=>f.name==="PLAYER_README.txt"));
  for(const f of player.filter(f=>/\.(map|d6m)$/.test(f.name)))assert.deepEqual(f.data,host.find(v=>v.name===f.name)!.data);
  assert.ok(!player.some(f=>/json|balance|host/i.test(f.name)));assert.ok(host.some(f=>f.name.endsWith(".json")));
  assert.ok(inspectNativeRaster(player.find(f=>f.name.endsWith(".d6m"))!.data).valid);
});
test("native raster inspection rejects oversized or malformed headers before pixel scans",async()=>{
  const plane=cloneProject(baseline).planes[0]!;plane.width=256;plane.height=256;
  const bytes=await encodeD6m(plane,"raster-inspection");assert.ok(inspectNativeRaster(bytes).valid);
  const malformed=bytes.slice();new DataView(malformed.buffer).setInt32(8,2147483647,true);
  assert.throws(()=>inspectNativeRaster(malformed),/bounds/);assert.throws(()=>inspectNativeRaster(new Uint8Array(12)),/short/);
  assert.equal(inspectNativeRaster(bytes.subarray(0,bytes.length-1)).valid,false);
});

test("host settings use the active catalog and memory estimates cover repeated requirement snapshots",async()=>{
  const p=cloneProject(baseline);p.planes[0]!.width=256;p.planes[0]!.height=256;
  p.analysisContext={gameVersion:"6.99",requirements:Array.from({length:64},(_,i)=>({nation:5,label:`Requirement ${i}`,gameVersion:"6.99",mods:"\u0001".repeat(4096),terrain:"forest",minimum:2,radius:2}))};
  const catalog={...BUILTIN_DOM6_CATALOG,gameVersion:"6.99",catalogVersion:"host-custom-test"};
  const files=await buildPackageFiles(p,undefined,catalog);
  const host=new TextDecoder().decode(files.find(f=>f.name==="host_settings.txt")!.data);
  assert.match(host,/Selector catalog snapshot: 6\.99/);assert.doesNotMatch(host,/differs from catalog 6\.35/);
  const bytes=files.filter(f=>!f.name.endsWith(".d6m")).reduce((sum,f)=>sum+f.data.byteLength,0);
  assert.ok(estimatedTextPackageBytes(p)>=bytes,`Estimate ${estimatedTextPackageBytes(p)} must cover actual ${bytes}`);
});

test("plane preference labels are readable while saved terrain keys are unchanged",()=>{
  const plane=cloneProject(baseline).planes[0]!;
  plane.generationOverrides={regions:[{name:"Fields",terrain:"farm",x0:0,y0:0,x1:1,y1:.5}]};
  const html=renderToStaticMarkup(createElement(PlanePreferencesPanel,{plane,onChange:()=>undefined}));
  for(const label of ["Plains weight","Farmland weight","Highlands weight","Mountains weight","Fields: Farmland"])assert.ok(html.includes(label),label);
  assert.match(html,/<option value="forest" selected="">Forest<\/option>/);
  assert.match(html,/<option value="farm">Farmland<\/option>/);
  assert.doesNotMatch(html,/>(plains|forest|farm|swamp|waste|highland|mountains) weight</);
});
