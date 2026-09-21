/** Reproducible structural evaluation. No claim of gameplay calibration or certified multiplayer balance. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import { cloneProject, type MapProject } from "../src/domain";
import { validateProject } from "../src/dom6";
import { analyzeStarts } from "../src/workbench";

const countArg=process.argv.indexOf("--count");
const count=countArg>=0?Number(process.argv[countArg+1]):1000;
if(!Number.isInteger(count)||count<1||count>10000)throw new Error("Use --count 1–10000.");
const outputArg=process.argv.indexOf("--output");
const output=path.resolve(process.argv[outputArg+1]&&outputArg>=0?process.argv[outputArg+1]!:"tmp/generation-evaluation-sep20.json");
const base=createDefaultProject("evaluation-template");
const profiles=["ffa","continents","islands","caves","realms","inland","teams","cave-naval"] as const;
function input(index:number):MapProject{
  let p=cloneProject(base);p.seed=`atlas-evaluation-v1:${index<800?"fixed":"held-out"}:${index}`;
  const profile=profiles[index%profiles.length]!;
  p.settings.players=index%3===0?4:6;p.settings.provincesPerPlayer=16;
  p.settings.startDistribution={land:p.settings.players,coastal:0,water:0,cave:0,other:0};p.settings.throneCount=4;
  p.settings.economyBalance=index%3===0?"none":index%3===1?"soft":"hard";
  p.settings.overlandTopology=index%3===0?"open":index%3===1?"competitive":"strategic";
  p.planes[0]!.wrapX=index%4===0;p.planes[0]!.wrapY=index%11===0;
  if(profile==="continents"){p.settings.waterPercent=40;p.settings.oceanLayout="multiple_continents";p.settings.continentCount=2;}
  if(profile==="islands"){p.settings.waterPercent=52;p.settings.oceanLayout="island_chains";p.settings.startDistribution={land:p.settings.players-2,coastal:1,water:1,cave:0,other:0};}
  if(profile==="inland"){p.settings.waterPercent=30;p.settings.oceanLayout="inland_sea";}
  if(profile==="caves"||profile==="cave-naval"){
    p=addPlane(p,"cave",{generate:false});p.settings.startDistribution={land:p.settings.players-2,coastal:0,water:0,cave:2,other:0};
    if(profile==="cave-naval"){p.settings.waterPercent=40;p.settings.startDistribution.land--;p.settings.startDistribution.water=1;}
  }
  if(profile==="realms")for(const kind of ["underworld","abyss","dream"] as const)p=addPlane(p,kind,{generate:false});
  // Paired fixed groups exercise inherited defaults and explicit preferences independently.
  if(Math.floor(index/8)%2===1)for(const plane of p.planes){
    plane.generationOverrides={terrainWeights:{forest:3,waste:2},guardianCoveragePercent:30,manySitesPercent:45};
    if(plane.kind==="surface")Object.assign(plane.generationOverrides,{roadPercent:20,riverPercent:5,passPercent:5});
    if(plane.kind==="cave")plane.generationOverrides.caveWaterPercent=25;
  }
  return p;
}
const results:object[]=[];const started=Date.now();let errors=0,exceptions=0,qualityMisses=0;
for(let i=0;i<count;i++){
  const p=input(i),begin=performance.now();
  try{
    const g=generateProject(p);
    if(profiles[i%profiles.length]==="teams")g.planes[0]!.provinces.filter(v=>v.start).forEach((v,j)=>{v.teamStart=Math.floor(j/2);});
    const issues=validateProject(g);const blocking=issues.filter(v=>v.severity==="error");
    const analysis=analyzeStarts(g);const cv=analysis.twoStepCv;
    const nearest=analysis.starts.flatMap(s=>s.nearestRival===undefined?[]:[s.nearestRival]);
    const shared=analysis.starts.some(s=>(s.sharedCapitalNeighbours??0)>0);
    const miss=cv===undefined||cv>.15||shared||(nearest.length>0&&Math.max(...nearest)-Math.min(...nearest)>1);
    if(blocking.length)errors++;if(miss)qualityMisses++;
    results.push({index:i,seed:p.seed,profile:profiles[i%profiles.length],overrides:!!p.planes[0]!.generationOverrides,ms:Math.round(performance.now()-begin),provinces:g.planes.reduce((sum,v)=>sum+v.provinces.length,0),errors:blocking.map(v=>v.message),warnings:issues.filter(v=>v.severity==="warning").length,twoStepCv:cv,nearestRivalRange:nearest.length?[Math.min(...nearest),Math.max(...nearest)]:null,sharedSurroundings:shared,proposedQualityMiss:miss,digest:createHash("sha256").update(JSON.stringify(g,(k,v)=>k==="createdAt"||k==="updatedAt"?undefined:v)).digest("hex")});
  }catch(e){exceptions++;results.push({index:i,seed:p.seed,exception:e instanceof Error?e.message:String(e)});}
  if((i+1)%25===0)console.log(`${i+1}/${count}: ${errors} maps with export errors; ${exceptions} exceptions; ${qualityMisses} proposed-quality misses.`);
}
const summary={corpus:"atlas-evaluation-v1",count,elapsedMs:Date.now()-started,errors,exceptions,qualityMisses,scope:"Structural generation and declared-start safety only. Proposed quality criteria are experimental, not community standards. No engine, combat, human or multiplayer claims.",results};
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(summary,null,2));
console.log(JSON.stringify({...summary,results:undefined,output}));
process.exitCode=errors||exceptions?1:0;
