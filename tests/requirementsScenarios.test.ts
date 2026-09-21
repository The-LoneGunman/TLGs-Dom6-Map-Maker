import assert from "node:assert/strict";
import test from "node:test";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import { cloneProject } from "../src/domain";
import { createGuardianScenario, prepareGuardianScenario } from "../src/guardianScenario";
import { checkNationRequirements } from "../src/nationRequirements";
import { parseProject, serializeProject } from "../src/export";
import { validateProject } from "../src/dom6";
import { buildStartAnalysisText } from "../src/workbench";

const baseline=createDefaultProject("requirements-and-fixtures");
test("nation requests are patch/mod-bound host checks and never silently accommodate a start",()=>{
  const p=cloneProject(baseline);const plane=p.planes[0]!,start=plane.provinces.find(v=>v.start)!;
  p.specificStarts=[{nation:5,planeId:plane.id,provinceId:start.id}];
  p.analysisContext={gameVersion:"6.37",mods:"Host Mod v2",requirements:[{label:"Forest access",nation:5,gameVersion:"6.37",mods:"Host Mod v2",terrain:"forest",radius:2,minimum:20}]};
  const before=serializeProject(p),result=checkNationRequirements(p)[0]!;
  assert.equal(result.status,"shortfall");assert.ok(result.count!==undefined);assert.equal(serializeProject(p),before);
  assert.deepEqual(parseProject(before).analysisContext,p.analysisContext);
  p.analysisContext.gameVersion="6.38";assert.equal(checkNationRequirements(p)[0]!.status,"unverified");
  p.analysisContext.gameVersion="6.37";p.analysisContext.mods="Host Mod v3";assert.equal(checkNationRequirements(p)[0]!.status,"unverified");
  p.analysisContext.mods="Host Mod v2";p.specificStarts=[];assert.equal(checkNationRequirements(p)[0]!.status,"unassigned");
  assert.match(buildStartAnalysisText(p,"6.35"),/HOST-DECLARED NATION TERRAIN REQUIREMENTS/);
  for(const change of [{minimum:0},{radius:4},{gameVersion:""},{nation:0},{verified:true}]){
    const invalid=cloneProject(p);Object.assign(invalid.analysisContext!.requirements![0]!,change);assert.throws(()=>parseProject(JSON.stringify(invalid)));
  }
});
test("all themed guardian fixtures are independent, bounded, deterministic and protect starts",()=>{
  let source=cloneProject(baseline);source.settings.players=2;source.settings.throneCount=2;source.settings.startDistribution={land:2,coastal:0,water:0,cave:0,other:0};
  for(const kind of ["cave","underworld","hell","abyss","dream","cloud","elemental"] as const)source=addPlane(source,kind,{generate:false});
  source=generateProject(source);const before=serializeProject(source);
  for(const plane of source.planes){
    const guardian=plane.provinces.find(v=>v.defenders.length);if(!guardian)continue;
    const input=prepareGuardianScenario(source,plane.id,guardian.id);assert.equal(input.planes[0]!.provinces.length,0);
    const fixture=createGuardianScenario(source,plane.id,guardian.id);
    assert.equal(fixture.planes.length,1);assert.equal(fixture.planes[0]!.provinces.length,48);
    const targets=fixture.planes[0]!.provinces.filter(v=>v.defenders.length);assert.equal(targets.length,1);assert.equal(JSON.stringify(targets[0]!.defenders),JSON.stringify(guardian.defenders));
    assert.equal(fixture.planes[0]!.provinces.filter(v=>v.start).length,2);assert.equal(fixture.gates.length,0);
    assert.deepEqual(validateProject(fixture).filter(i=>i.severity==="error"),[],plane.kind);
    assert.ok(fixture.planes[0]!.provinces.every(v=>v.throne!=="fixed"&&v.throne!=="preferred"));
  }
  assert.equal(serializeProject(source),before);
});
