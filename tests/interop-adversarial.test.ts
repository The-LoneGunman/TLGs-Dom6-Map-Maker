import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { cloneProject, effectiveProvinceTerrainFlags, type MapProject, type PlaneKind, type PlaneVariant } from "../src/domain";
import { addPlane, ARCHETYPE_PROFILES, createDefaultProject, generateProject } from "../src/generator";
import { compileMapText, validateProject } from "../src/dom6";
import { parseProject, serializeProject } from "../src/export";
import { createGuardianScenario, finishGuardianScenario, prepareGuardianScenario } from "../src/guardianScenario";
import { BUILTIN_DOM6_CATALOG, createCatalogTemplate, mergeCatalogBundles } from "../src/catalog";
import { protectedProvinceKeys } from "../src/iteration";
import { inspectNativeMap, inspectNativeRaster, MAX_NATIVE_TEXT_BYTES } from "../src/nativeInspection";
import { checkNationRequirements } from "../src/nationRequirements";
import { applySettingsRecipe, createSettingsRecipe, parseSettingsRecipe } from "../src/recipes";

const baseline = createDefaultProject("interop-adversarial");
const kinds = Object.keys(ARCHETYPE_PROFILES) as PlaneKind[];
const variants: PlaneVariant[] = ["temperate", "wild", "frozen", "arid", "oceanic", "fungal", "crystal", "volcanic", "storm", "infernal", "void"];
const guardian = { commander: "1067", squads: [{ id: "fixture-squad", unit: "1046", count: 20 }] };

test("native inventory recognizes every exported magic path and rejects alternate numeric spellings", () => {
  const p = cloneProject(baseline);
  const target = p.planes[0]!.provinces.find(v => !v.start)!;
  target.defenders = [{ ...structuredClone(guardian), bodyguard: "1046", bodyguardCount: 4, magic: { fire: 1, air: 1, water: 1, earth: 1, astral: 1, death: 1, nature: 1, glamour: 1, blood: 1, holy: 1 } }];
  const compiledReport=inspectNativeMap(compileMapText(p, 0));
  assert.deepEqual(compiledReport.unrecognized, []);
  const declaredUnits=p.planes[0]!.provinces.reduce((sum,v)=>sum+v.defenders.reduce((total,d)=>total+d.squads.reduce((units,s)=>units+s.count,0)+(d.bodyguardCount??0),0),0);
  assert.equal(compiledReport.units, declaredUnits);
  const report = inspectNativeMap('#dom2title "Numeric probe"\r#imagefile "safe.d6m"\r#terrain 1 0\r#terrain 0x2 0\r#start 1e0\r#mapsize 0x100 256\r#domversion 0x27d\r#units 1e3 1046\r#setland 99');
  assert.equal(report.provinceCount, 1);
  assert.equal(report.starts, 0);
  assert.equal(report.units, 0);
  assert.equal(report.dimensions, undefined);
  assert.ok(report.warnings.some(w => /99.*without a terrain record/.test(w)));
  for (const phrase of ["province number", "map dimensions", "domversion", "unit count"]) assert.ok(report.warnings.some(w => w.includes(phrase)), phrase);
});

test("native parsing bounds untrusted input and never follows paths or hidden directives", () => {
  const report = inspectNativeMap('#dom2title "A -- quoted // title" -- outside comment\n#imagefile "C:\\never-open\\file.d6m"\n#terrain 1 0\n#landname 1 "#commander 1067"\n#unknown_probe 1 // #units 9999 1046');
  assert.equal(report.title, "A -- quoted // title");
  assert.equal(report.commanders, 0);
  assert.equal(report.units, 0);
  assert.deepEqual(report.unrecognized, ["#unknown_probe"]);
  assert.ok(report.warnings.some(w => /will not be opened/.test(w)));
  assert.throws(() => inspectNativeMap("x".repeat(MAX_NATIVE_TEXT_BYTES + 1)), /16 MiB/);
  assert.throws(() => inspectNativeMap("\n".repeat(200001)), /200,000/);
  assert.throws(() => inspectNativeMap(`#description "${"x".repeat(65536)}"`), /line limit/);
  assert.throws(() => inspectNativeMap(Array.from({ length: 2049 }, (_, i) => `#directive${i} 1`).join("\n")), /distinct directives/);
  const raster = new Uint8Array(38);
  const view = new DataView(raster.buffer);
  view.setInt32(8, 256, true); view.setInt32(12, 256, true); view.setInt32(30, 1, true);
  assert.equal(inspectNativeRaster(raster).valid, false);
  view.setInt32(30, 32768, true);
  assert.throws(() => inspectNativeRaster(raster), /bounds/);
});

test("guardian fixtures support every plane/variant and flooded target without changing source or graph", () => {
  let checked = 0;
  for (const kind of kinds) for (const variant of variants) for (const flooded of [false, true]) {
    const source = cloneProject(baseline);
    const plane = source.planes[0]!;
    plane.kind = kind; plane.variant = variant;
    plane.ownershipMode = kind === "surface" || kind === "custom" ? "solid" : "sparse";
    const target = plane.provinces.find(v => !v.start)!;
    const cave = ARCHETYPE_PROFILES[kind].caveFamily || (kind === "custom" && variant === "fungal");
    target.terrain = flooded ? "sea" : cave ? "cave" : "forest";
    target.terrainFlags = cave ? ["cave"] : undefined;
    target.freshwater = true; target.small = false; target.large = true;
    target.defenders = [structuredClone(guardian)];
    target.battle = { groundColor: "17 34 51", fogColor: "68 85 102" };
    const before = serializeProject(source);
    const prepared = prepareGuardianScenario(source, plane.id, target.id);
    const generated = generateProject(prepared);
    const generatedBefore = serializeProject(generated);
    const fixture = finishGuardianScenario(source, plane.id, target.id, generated);
    const label = `${kind}/${variant}/${flooded ? "water" : "dry"}`;
    const exportedTarget = fixture.planes[0]!.provinces.find(v => v.defenders.length)!;
    assert.equal(serializeProject(source), before, `${label}: source`);
    assert.equal(serializeProject(generated), generatedBefore, `${label}: generated snapshot`);
    assert.equal(JSON.stringify(fixture.planes[0]!.edges), JSON.stringify(generated.planes[0]!.edges), `${label}: graph`);
    assert.equal(fixture.planes[0]!.provinces.filter(v => v.defenders.length).length, 1, label);
    assert.deepEqual(exportedTarget.defenders, target.defenders, `${label}: guardians`);
    assert.deepEqual(effectiveProvinceTerrainFlags(exportedTarget), effectiveProvinceTerrainFlags(target), `${label}: terrain`);
    assert.equal(exportedTarget.large, true, `${label}: large flag`);
    assert.deepEqual(exportedTarget.battle, target.battle, `${label}: battle`);
    assert.equal(protectedProvinceKeys(fixture, 2).has(`${fixture.planes[0]!.id}:${exportedTarget.id}`), false, `${label}: two-ring safety`);
    assert.deepEqual(validateProject(fixture).filter(i => i.severity === "error"), [], label);
    assert.deepEqual(parseProject(serializeProject(fixture)), fixture, `${label}: serialization`);
    assert.match(fixture.description, /movement abilities/);
    checked++;
  }
  assert.equal(checked, kinds.length * variants.length * 2);
});

test("Custom sparse fixtures and incompatible scenario results fail safely", () => {
  for (const variant of variants) {
    const source = cloneProject(baseline), plane = source.planes[0]!;
    plane.kind = "custom"; plane.variant = variant; plane.ownershipMode = "sparse";
    const target = plane.provinces.find(v => !v.start)!;
    target.terrain = "sea"; target.terrainFlags = ["cave"]; target.defenders = [structuredClone(guardian)];
    const generated = generateProject(prepareGuardianScenario(source, plane.id, target.id));
    const fixture = finishGuardianScenario(source, plane.id, target.id, generated);
    assert.deepEqual(validateProject(fixture).filter(i => i.severity === "error"), [], variant);
    assert.match(fixture.description, /target alone was adapted/);
    const before = serializeProject(source);
    assert.throws(() => finishGuardianScenario(source, plane.id, target.id, { ...generated, planes: [] }), /incomplete/);
    target.terrainFlags.push("cavewall");
    assert.throws(() => finishGuardianScenario(source, plane.id, target.id, generated), /blocked/);
    target.terrainFlags.pop();
    assert.equal(serializeProject(source), before);
  }
});

test("long authored source names do not overflow fixture metadata limits", () => {
  const source=cloneProject(baseline),plane=source.planes[0]!;
  const target=plane.provinces.find(v=>!v.start)!;
  plane.name="Realm ".repeat(680);target.name="Guardian ".repeat(455);target.defenders=[structuredClone(guardian)];
  const before=serializeProject(source);
  const generated=generateProject(prepareGuardianScenario(source,plane.id,target.id));
  const fixture=finishGuardianScenario(source,plane.id,target.id,generated);
  assert.doesNotThrow(()=>parseProject(serializeProject(fixture)));
  assert.equal(serializeProject(source),before);
});

test("guardian fixture validation receives the active imported catalog", () => {
  const custom=createCatalogTemplate("6.37");custom.catalogVersion="fixture-test-catalog";
  custom.provenance[0]!.id="fixture-test-source";
  custom.units=[{id:700001,name:"Mod guardian",provenanceId:"fixture-test-source"}];
  const active=mergeCatalogBundles(BUILTIN_DOM6_CATALOG,custom);
  let unitCatalogReads=0;
  const observed=new Proxy(active,{get(target,key,receiver){if(key==="units")unitCatalogReads++;return Reflect.get(target,key,receiver);}});
  const source=cloneProject(baseline),plane=source.planes[0]!,target=plane.provinces.find(v=>!v.start)!;
  target.defenders=[{commander:"700001",squads:[{id:"mod-squad",unit:"700001",count:5}]}];
  const fixture=createGuardianScenario(source,plane.id,target.id,observed);
  assert.ok(unitCatalogReads>0,"the fixture helper must consult the passed catalog");
  assert.ok(!validateProject(fixture,active).some(i=>i.message.includes("700001")));
  assert.ok(validateProject(fixture).some(i=>i.message.includes("700001")));
});

test("recipe imports reject silently normalized seeds, cave IDs and duplicate connection plans", () => {
  let source = cloneProject(baseline);
  source = addPlane(source, "cave", { generate: false });
  source.settings.startDistribution = { land: 4, coastal: 0, water: 0, cave: 2, other: 0 };
  const recipe = createSettingsRecipe(source, "Adversarial recipe", true);
  for (const settings of [
    { provinceNameSeed: -1 }, { provinceNameSeed: .5 },
    { caveStartNations: [0] }, { caveStartNations: [5.5] }, { caveStartNations: [5, 5] },
    { planeConnections: [{ a: recipe.planes[0]!.id, b: recipe.planes[1]!.id, pairs: 1 }, { a: recipe.planes[1]!.id, b: recipe.planes[0]!.id, pairs: 2 }] },
  ]) {
    const bad = { ...recipe, settings: { ...recipe.settings, ...settings } };
    const before = serializeProject(source);
    assert.throws(() => applySettingsRecipe(source, bad));
    assert.equal(serializeProject(source), before);
  }
  const imported = cloneProject(baseline);
  imported.planes[0]!.id = "unrelated-plane-id";
  const parsed = parseSettingsRecipe(JSON.stringify(recipe));
  parsed.settings.planeConnections = [{ a: parsed.planes[0]!.id, b: parsed.planes[1]!.id, pairs: 2 }];
  const applied = applySettingsRecipe(imported, parsed);
  assert.equal(applied.settings.planeConnections![0]!.a, "unrelated-plane-id");
  assert.equal(applied.settings.planeConnections![0]!.b, applied.planes[1]!.id);
  assert.equal(applied.planes[0]!.provinces.length, imported.planes[0]!.provinces.length);
  assert.equal(applied.planes[1]!.provinces.length, 0);
});

function requirementFixture(): MapProject {
  const p = cloneProject(baseline), plane = p.planes[0]!;
  plane.provinces = plane.provinces.slice(0, 4);
  const [start, forest, rival, blocked] = plane.provinces;
  for (const v of plane.provinces) { v.start = false; delete v.teamStart; v.terrain = "forest"; v.terrainFlags = undefined; }
  blocked!.terrain = "cavewall";
  p.gates = [];
  p.specificStarts = [{ nation: 5, planeId: plane.id, provinceId: start!.id }, { nation: 6, planeId: plane.id, provinceId: rival!.id }];
  plane.edges = [
    { id: "request-edge-1", a: start!.id, b: forest!.id, kind: "standard" },
    { id: "request-edge-2", a: start!.id, b: rival!.id, kind: "standard" },
    { id: "request-edge-3", a: start!.id, b: blocked!.id, kind: "standard" },
  ];
  p.analysisContext = { gameVersion: "6.37", mods: "", requirements: [{ label: "Declared forest", nation: 5, gameVersion: "6.37", mods: "", terrain: "forest", radius: 1, minimum: 2 }] };
  return p;
}

test("host requests never count capitals, blocked provinces, ambiguous assignments or stale snapshots", () => {
  const p = requirementFixture();
  const before = serializeProject(p);
  assert.equal(checkNationRequirements(p)[0]!.count, 1);
  assert.equal(checkNationRequirements(p)[0]!.status, "shortfall");
  assert.equal(serializeProject(p), before);
  p.specificStarts[1]!.provinceId = p.specificStarts[0]!.provinceId;
  assert.equal(checkNationRequirements(p)[0]!.status, "unassigned");
  p.analysisContext!.mods = "Changed mod";
  assert.equal(checkNationRequirements(p)[0]!.status, "unverified");
  p.analysisContext!.mods = ""; p.specificStarts = [];
  assert.equal(checkNationRequirements(p)[0]!.status, "unassigned");
});

function deferred<T>() {
  let resolve!: (value:T)=>void;
  let reject!: (reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

/** Extract and execute the checked-in JSX callback, including its actual guards. */
function productionCallback(file:string,tag:string,marker:string,attribute:string,bindings:Record<string,unknown>):(event?:unknown)=>unknown {
  const source=readFileSync(new URL(`../src/${file}`,import.meta.url),"utf8");
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
  let expression:string|undefined;
  const visit=(node:ts.Node)=>{
    if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)){
      const opening=ts.isJsxElement(node)?node.openingElement:node;
      if(opening.tagName.getText(ast)===tag&&node.getText(ast).includes(marker)){
        const property=opening.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)===attribute);
        if(property&&ts.isJsxAttribute(property)&&property.initializer&&ts.isJsxExpression(property.initializer))expression=property.initializer.expression?.getText(ast);
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(ast);
  assert.ok(expression,`${file}: ${tag} ${marker} ${attribute} callback exists`);
  const javascript=ts.transpileModule(`function makeProductionCallback(){return (${expression});}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(bindings),`${javascript}\nreturn makeProductionCallback();`)(...Object.values(bindings));
}

test("native inspection callbacks keep explicit pasted inspection newer than pending files and errors", async()=>{
  const state:{text:string;report?:string;error?:string;raster?:string}={text:"new pasted text"};
  const sequence={current:0};
  const inspected:string[]=[];
  const bindings={sequence,MAX_NATIVE_TEXT_BYTES,MAX_NATIVE_RASTER_BYTES:40*1024*1024,text:state.text,
    setText:(value:string)=>{state.text=value;},setError:(value?:string)=>{state.error=value;},
    setReport:(value?:string)=>{state.report=value;},setRaster:(value?:string)=>{state.raster=value;},
    inspect:(value:string)=>{inspected.push(value);state.report=value;},
    inspectNativeRaster:()=>({valid:true,width:256,height:256,provinceCount:2,noneOwnerPixels:0}),
  };
  const fileChange=productionCallback("NativeInspectionPanel.tsx","input",'.map,.d6m',"onChange",bindings);
  const paste=productionCallback("NativeInspectionPanel.tsx","button","Inspect pasted map","onClick",bindings);
  const first=deferred<string>();
  const pending=fileChange({target:{value:"selected",files:[{name:"old.map",size:1,text:()=>first.promise}]}});
  paste();first.resolve("old file");await pending;
  assert.deepEqual(inspected,["new pasted text"]);assert.equal(state.text,"new pasted text");
  const rejected=deferred<string>();
  const oldFailure=fileChange({target:{value:"selected",files:[{name:"old.map",size:1,text:()=>rejected.promise}]}});
  paste();rejected.reject(new Error("late file error"));await oldFailure;
  assert.equal(state.error,undefined);assert.equal(state.report,"new pasted text");
  const oldRaster=deferred<ArrayBuffer>();
  const lateRaster=fileChange({target:{value:"selected",files:[{name:"old.d6m",size:38,arrayBuffer:()=>oldRaster.promise}]}});
  paste();oldRaster.resolve(new ArrayBuffer(38));await lateRaster;
  assert.equal(state.raster,undefined);assert.equal(state.report,"new pasted text");
});

test("guardian source changes cancel pending callbacks and cannot display the old fixture",async()=>{
  const sequence={current:0};const pending=deferred<MapProject>();let cancellations=0,finishes=0;
  const source=cloneProject(baseline),plane=source.planes[0]!,province=plane.provinces[0]!;
  const choices=[{key:"first",plane,province}];
  const task:{current?:{promise:Promise<MapProject>;cancel:()=>void}}={};
  const state:{selected:string;fixture?:unknown;job?:{source:MapProject;running:boolean};error?:string}={selected:"first"};
  const bindings={sequence,task,project:source,catalog:BUILTIN_DOM6_CATALOG,choices,selected:"first",
    setJob:(job:{source:MapProject;running:boolean})=>{state.job=job;},setError:(error?:string)=>{state.error=error;},
    setFixture:(fixture?:unknown)=>{state.fixture=fixture;},setSelected:(selected:string)=>{state.selected=selected;},
    prepareGuardianScenario:()=>source,startProjectGeneration:()=>({promise:pending.promise,cancel:()=>{cancellations++;}}),
    finishGuardianScenario:()=>{finishes++;return source;},isGenerationAbort:()=>false,
  };
  const prepare=productionCallback("GuardianScenarioPanel.tsx","button","Prepare separate fixture","onClick",bindings);
  const select=productionCallback("GuardianScenarioPanel.tsx","select","Choose authored guardians","onChange",bindings);
  const running=prepare();assert.equal(state.job?.running,true);
  select({target:{value:"second"}});
  pending.resolve(source);await running;
  assert.equal(cancellations,1);assert.equal(finishes,0);assert.equal(state.fixture,undefined);
  assert.equal(state.selected,"second");assert.equal(state.job?.running,false);
  const ui=readFileSync(new URL("../src/GuardianScenarioPanel.tsx",import.meta.url),"utf8");
  assert.match(ui,/<select[^>]*disabled=\{busy\}/);
  assert.ok(ui.includes("{current.description}"),"movement and adapted-terrain caveats stay visible before downloads");
});
