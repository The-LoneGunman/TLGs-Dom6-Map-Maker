import { effectiveProvinceTerrainFlags, type MapProject, type NationTerrainRequirement } from "./domain";
import { globalMovementAdjacency, shortestDistances } from "./generator";

export interface RequirementResult { requirement:NationTerrainRequirement; status:"unverified"|"unassigned"|"met"|"shortfall"; count?:number; message:string }

/** Patch-bound host requests. No claim that the requirement itself is official, sufficient, or competitively fair. */
export function checkNationRequirements(project:MapProject):RequirementResult[]{
  const graph=globalMovementAdjacency(project);
  const capitals=new Set(project.specificStarts.map(s=>`${s.planeId}:${s.provinceId}`));
  for(const p of project.planes)for(const v of p.provinces)if(v.start||v.teamStart!==undefined)capitals.add(`${p.id}:${v.id}`);
  return (project.analysisContext?.requirements??[]).map(requirement=>{
    if(requirement.gameVersion!==project.analysisContext?.gameVersion?.trim()||requirement.mods!==(project.analysisContext?.mods??"").trim())return {requirement,status:"unverified",message:"Patch/mod declaration differs from this requirement snapshot. Reconfirm the requirement explicitly before relying on it."};
    const starts=project.specificStarts.filter(s=>s.nation===requirement.nation);
    if(starts.length!==1)return {requirement,status:"unassigned",message:"Requires exactly one nation-specific start; random/team slots do not identify this nation."};
    const start=starts[0]!,key=`${start.planeId}:${start.provinceId}`;
    if(project.specificStarts.some(other=>other.nation!==requirement.nation&&other.planeId===start.planeId&&other.provinceId===start.provinceId))return {requirement,status:"unassigned",message:"The capital is assigned to multiple nations. Resolve the conflicting assignments before checking this requirement."};
    if(!graph.has(key))return {requirement,status:"unassigned",message:"Assigned start is missing or blocked."};
    const distances=shortestDistances(graph,key);
    const count=project.planes.reduce((sum,p)=>sum+p.provinces.filter(v=>!capitals.has(`${p.id}:${v.id}`)&&(distances.get(`${p.id}:${v.id}`)??Infinity)<=requirement.radius&&effectiveProvinceTerrainFlags(v).has(requirement.terrain)).length,0);
    return {requirement,status:count>=requirement.minimum?"met":"shortfall",count,message:`${count}/${requirement.minimum} requested ${requirement.terrain} provinces within ${requirement.radius} potential graph steps. Movement/combat and the host's requirement remain unverified.`};
  });
}

export function requirementReportLines(project:MapProject):string[]{
  const results=checkNationRequirements(project);if(!results.length)return [];
  return ["", "HOST-DECLARED NATION TERRAIN REQUIREMENTS — NOT AUTOMATIC ACCOMMODATIONS",...results.map(r=>`${JSON.stringify(r.requirement.label)} / nation ${r.requirement.nation} / snapshot ${JSON.stringify(r.requirement.gameVersion)} / mods ${JSON.stringify(r.requirement.mods)}: ${r.status}: ${r.message}`)];
}
