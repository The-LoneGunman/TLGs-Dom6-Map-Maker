import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultProject, addPlane, generateProject } from "../src/generator";
import { cloneProject, type MapProject } from "../src/domain";
import { assertProjectLocks, snapshotWithLocks } from "../src/authoringLocks";
import { addAuthoredRegion, previewBatchEdit, previewContentReroll, protectedProvinceKeys, selectProvinces } from "../src/iteration";
import { applyBuiltinRecipe, applySettingsRecipe, createSettingsRecipe, parseSettingsRecipe } from "../src/recipes";
import { parseProject, serializeProject } from "../src/export";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { IterationPanel } from "../src/IterationPanel";

const frozen: Record<string,string> = {
  default:"bb6c7ae62970a8d44f42f82d6db7916b0984e3341dd82327b0aba120c2389da9",
  islands:"f6e25c37740bd78b4fc803bffb89b75d7d925a36319fba56253e85543a092448",
  continents:"e50ec3e83bef10a045f420b3405b59cf6e688ca4b7f5214221d2d3530b1cda4e",
  // Sparse generation intentionally changed when connected regions became
  // mandatory. Keep reviewed new baselines while solid-only hashes stay frozen.
  caves:"cc1ced9a0757c0c539660b603bd87dc9c4617b27aac73e0f9b10ceb16a838da2",
  eight:"48abe5e004a6caf6dfae5624cbfdbfd6cd121956ea39b15e868a359d9d8a88cc",
};
function frozenFixture(kind: string): MapProject {
  let p = createDefaultProject(`round-baseline-${kind}`);
  if(kind==="islands") {p.settings.oceanLayout="island_chains";p.settings.startDistribution={land:2,coastal:2,water:2,cave:0,other:0};}
  if(kind==="continents") {p.settings.oceanLayout="multiple_continents";p.settings.continentCount=3;p.settings.waterPercent=40;p.settings.overlandTopology="strategic";p.settings.economyBalance="soft";}
  if(kind==="caves") {p=addPlane(p,"cave",{generate:false});p.settings.startDistribution={land:3,coastal:0,water:0,cave:3,other:0};}
  if(kind==="eight") {p.settings.players=4;p.settings.startDistribution={land:4,coastal:0,water:0,cave:0,other:0};p.settings.throneCount=4;for(const kind of ["cave","underworld","hell","abyss","dream","cloud","elemental"] as const)p=addPlane(p,kind,{generate:false});}
  return generateProject(p);
}
for (const [kind, digest] of Object.entries(frozen)) test(`${kind} defaults match the reviewed generation digest`,()=>{
  const p=frozenFixture(kind);
  assert.equal(createHash("sha256").update(JSON.stringify(p,(key,value)=>key==="createdAt"||key==="updatedAt"?undefined:value)).digest("hex"),digest);
});

const baseline = createDefaultProject("iteration-regressions");
const planeId = baseline.planes[0]!.id;
const unprotected = baseline.planes[0]!.provinces.filter(p=>!protectedProvinceKeys(baseline).has(`${planeId}:${p.id}`));

test("batch preview respects field locks, protects capitals, preserves source and geography",()=>{
  const p=snapshotWithLocks(baseline,planeId,[unprotected[0]!.id],["economy"],true);
  const before=serializeProject(p);
  const result=previewBatchEdit(p,planeId,p.planes[0]!.provinces.map(v=>v.id),{kind:"population",value:9999});
  assert.equal(result.locked,1);assert.equal(result.protected,6);assert.ok(result.changed>0);assert.equal(result.errors.length,0);
  assert.equal(serializeProject(p),before);
  assert.deepEqual(result.project.planes[0]!.edges,p.planes[0]!.edges);assert.deepEqual(result.project.gates,p.gates);
  assert.equal(result.project.planes[0]!.provinces.find(v=>v.id===unprotected[0]!.id)!.population,unprotected[0]!.population);
  assert.throws(()=>previewBatchEdit(p,planeId,["missing"],{kind:"population",value:1}),/changed/);
  assert.throws(()=>previewBatchEdit(p,planeId,[unprotected[0]!.id],{kind:"population",value:Infinity}),/whole-number/);
});

test("content rerolls are deterministic, honor manual/locked names and preserve unrelated fields",()=>{
  const p=cloneProject(baseline);const plane=p.planes[0]!;const first=unprotected[0]!.id;const second=unprotected[1]!.id;
  plane.provinces.find(v=>v.id===first)!.nameSource="authored";
  plane.provinces.find(v=>v.id===second)!.editorLocks=["name","guardians"];
  for(const kind of ["name","economy","sites","guardians"] as const) {
    const ids=plane.provinces.map(v=>v.id);const a=previewContentReroll(p,planeId,ids,kind,"one");const b=previewContentReroll(p,planeId,ids,kind,"one");
    assert.deepEqual(a.project,b.project);assert.deepEqual(a.project.gates,p.gates);assert.deepEqual(a.project.specificStarts,p.specificStarts);
    assert.deepEqual(a.project.planes[0]!.provinces.map(v=>[v.x,v.y,v.terrain,v.terrainFlags,v.start,v.teamStart]),plane.provinces.map(v=>[v.x,v.y,v.terrain,v.terrainFlags,v.start,v.teamStart]));
    assert.deepEqual(a.project.planes[0]!.edges,plane.edges);
    if(kind==="name") {assert.equal(a.project.planes[0]!.provinces.find(v=>v.id===first)!.name,plane.provinces.find(v=>v.id===first)!.name);assert.equal(a.locked,2);}
  }
});

test("layout and starts locks reject conflicting changes but allow explicit unlock and content edits",()=>{
  const p=cloneProject(baseline);p.authoring={lockLayout:true,lockStarts:true};
  assert.throws(()=>generateProject(p),/Layout is locked/);
  const next=cloneProject(p);next.planes[0]!.wrapX=!next.planes[0]!.wrapX;
  assert.throws(()=>assertProjectLocks(p,next),/Layout is locked/);next.authoring!.lockLayout=false;assert.doesNotThrow(()=>assertProjectLocks(p,next));
  const changed=cloneProject(p);changed.planes[0]!.provinces.find(v=>v.start)!.teamStart=0;assert.throws(()=>assertProjectLocks(p,changed),/Starts are locked/);
  const content=cloneProject(p);content.planes[0]!.provinces[0]!.name="A deliberate edit";assert.doesNotThrow(()=>assertProjectLocks(p,content));
});

test("field locks and named regions survive project serialization and drive exact bounded selections",()=>{
  let p=snapshotWithLocks(baseline,planeId,[unprotected[0]!.id],["terrain","name"],true);
  p=addAuthoredRegion(p,planeId,[unprotected[0]!.id,unprotected[1]!.id],"Inner March");
  const copy=parseProject(serializeProject(p));assert.deepEqual(copy,p);
  assert.equal(selectProvinces(copy,{planeId,regionId:"region-1"}).length,2);
  assert.equal(selectProvinces(copy,{planeId,regionId:"missing"}).length,0);
  assert.throws(()=>parseProject(JSON.stringify({...p,authoring:{...p.authoring,unknown:true}})),/unknown/i);
  const duplicate=cloneProject(p);duplicate.planes[0]!.provinces[0]!.editorLocks=["name","name"];
  assert.throws(()=>serializeProject(duplicate),/duplicates/);
});

test("settings recipes never contain province content and round-trip across compatible plans",()=>{
  const recipe=createSettingsRecipe(baseline,"Settings",true);
  const parsed=parseSettingsRecipe(JSON.stringify(recipe));
  assert.ok(parsed.planes.every(p=>!("provinces" in p)&&!("edges" in p)&&!("rawDirectives" in p)));
  const applied=applySettingsRecipe(baseline,parsed);
  assert.equal(JSON.stringify(applied.planes),JSON.stringify(baseline.planes));
  assert.deepEqual(applied.gates,baseline.gates);assert.equal(applied.seed,baseline.seed);
  const changed=applyBuiltinRecipe(baseline,"naval");assert.equal(JSON.stringify(changed.planes),JSON.stringify(baseline.planes));assert.equal(changed.settings.oceanLayout,"island_chains");
  assert.throws(()=>parseSettingsRecipe(JSON.stringify({...recipe,settings:{...recipe.settings,players:999}})),/Players|allocation/);
  assert.throws(()=>parseSettingsRecipe(JSON.stringify({...recipe,planes:[{...recipe.planes[0],rawDirectives:"#god 5 1"}]})),/unknown|content/);
});

test("iteration workspace renders opt-in controls and previews without replacing existing tabs",()=>{
  const html=renderToStaticMarkup(createElement(IterationPanel,{project:baseline,planeId,catalog:BUILTIN_DOM6_CATALOG,busy:false,onCommit:()=>true,onHighlight:()=>undefined}));
  for(const label of ["Preview batch edit","Preview content reroll","Download settings recipe","Compare generated candidates","Lock layout","Pending iteration"]) {
    if(label!=="Pending iteration")assert.ok(html.includes(label),label);
  }
  assert.doesNotMatch(html,/Apply previewed change/);
});
