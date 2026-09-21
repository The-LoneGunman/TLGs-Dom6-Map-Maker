import { effectiveProvinceTerrainFlags, isBlockedProvince, isWaterProvince, type DryTerrainPreference, type MapProject, type Plane, type PlaneGenerationOverrides, type Province, type TerrainKey } from "./domain";
import { protectedStartProvinceKeys } from "./authoringLocks";

export const DRY_TERRAIN_PREFERENCES: readonly DryTerrainPreference[] = ["plains","forest","farm","swamp","waste","highland","mountains"];
function random(seed: string): number { let h=2166136261;for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)/4294967296; }

export function assertPlaneGenerationOverrides(value: unknown): asserts value is PlaneGenerationOverrides {
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Plane generation overrides must be an object.");
  const o=value as Record<string,unknown>;
  const fields=["waterPercent","caveWaterPercent","terrainWeights","roadPercent","riverPercent","passPercent","guardianCoveragePercent","guardianRosterScale","manySitesPercent","regions"];
  if(Object.keys(o).some(k=>!fields.includes(k)))throw new Error("Unknown plane generation override.");
  for(const key of fields.filter(k=>k!=="terrainWeights"&&k!=="regions"))if(o[key]!==undefined){
    const n=o[key];const max=key==="guardianRosterScale"?2:key==="waterPercent"||key==="caveWaterPercent"?60:key==="guardianCoveragePercent"?80:100;
    const min=key==="guardianRosterScale"?0.5:0;
    if(typeof n!=="number"||!Number.isFinite(n)||n<min||n>max||(key!=="guardianRosterScale"&&!Number.isInteger(n)))throw new Error(`${key} is outside its supported range (${min}–${max}).`);
  }
  if(Number(o.roadPercent??0)+Number(o.riverPercent??0)+Number(o.passPercent??0)>100)throw new Error("Road, river and pass shares must total no more than 100%.");
  if(o.terrainWeights!==undefined){
    if(!o.terrainWeights||typeof o.terrainWeights!=="object"||Array.isArray(o.terrainWeights))throw new Error("Terrain weights must be an object.");
    for(const [key,value] of Object.entries(o.terrainWeights))if(!(DRY_TERRAIN_PREFERENCES as readonly string[]).includes(key)||typeof value!=="number"||!Number.isInteger(value)||value<0||value>5)throw new Error("Dry-terrain weights range from 0 to 5.");
    const weights=o.terrainWeights as Record<string,number>;
    if(!DRY_TERRAIN_PREFERENCES.some(k=>(weights[k]??1)>0))throw new Error("At least one dry-terrain weight must be positive.");
  }
  if(o.regions!==undefined){
    if(!Array.isArray(o.regions)||o.regions.length>16)throw new Error("Use at most 16 regional terrain plans per plane.");
    for(const r of o.regions){
      if(!r||typeof r!=="object"||Array.isArray(r)||Object.keys(r).some(k=>!["name","x0","y0","x1","y1","terrain"].includes(k)))throw new Error("Invalid regional terrain plan.");
      if(typeof r.name!=="string"||!r.name.trim()||r.name.length>80||!DRY_TERRAIN_PREFERENCES.includes(r.terrain))throw new Error("A regional plan requires a short name and dry terrain.");
      for(const k of ["x0","x1","y0","y1"])if(typeof r[k]!=="number"||!Number.isFinite(r[k])||r[k]<0||r[k]>1)throw new Error("Regional bounds must be between 0 and 1.");
      if(r.x0>=r.x1||r.y0>=r.y1)throw new Error("A regional plan needs positive width and height.");
    }
  }
}

/** Independent local randomness: omitted or all-default controls consume no original RNG draws. */
export function preferredDryTerrain(plane: Plane, original: TerrainKey, x: number, y: number, seed: string): TerrainKey {
  const controls=plane.generationOverrides;
  if(!controls||["sea","deepsea","kelp","cavewall"].includes(original))return original;
  const cave=original.startsWith("cave");
  const convert=(key:DryTerrainPreference):TerrainKey => cave ? ({plains:"cave",forest:"caveforest",swamp:"caveswamp",waste:"cavewaste",highland:"cavehighland",mountains:"cavehighland",farm:"cave"} as const)[key] : key;
  const region=controls.regions?.find(r=>x>=r.x0&&x<=r.x1&&y>=r.y0&&y<=r.y1);
  if(region && !(cave&&region.terrain==="farm"))return convert(region.terrain);
  const weights=controls.terrainWeights;
  if(!weights||Object.values(weights).every(w=>w===1))return original;
  const choices=DRY_TERRAIN_PREFERENCES.filter(k=>!cave||k!=="farm").map(key=>({key,weight:(weights[key]??1)*(convert(key)===original?3:1)}));
  const total=choices.reduce((sum,c)=>sum+c.weight,0);
  if(!total)throw new Error(`${plane.name}: no positive dry-terrain weight is compatible with cave terrain.`);
  let score=random(seed)*total;
  for(const c of choices){score-=c.weight;if(score<0)return convert(c.key);}
  return original;
}

function protectedIds(project: MapProject, plane: Plane, depth: number): Set<string> {
  const keys = protectedStartProvinceKeys(project, depth);
  return new Set(plane.provinces.filter(province => keys.has(`${plane.id}:${province.id}`)).map(province => province.id));
}

export function applyPlaneRoutePreferences(project: MapProject, plane: Plane): void {
  const c=plane.generationOverrides;
  if(!c||[c.roadPercent,c.riverPercent,c.passPercent].every(v=>v===undefined))return;
  if(plane.kind!=="surface"&&!(plane.kind==="custom"&&["temperate","wild","frozen","arid","oceanic"].includes(plane.variant??"temperate")))return;
  if(plane.ownershipMode==="sparse")return;
  const protectedSet=protectedIds(project,plane,0);
  const provinces=new Map(plane.provinces.map(p=>[p.id,p]));
  for(const e of plane.edges){
    if(protectedSet.has(e.a)||protectedSet.has(e.b)||!["standard","road","river","bridge","mountain_pass"].includes(e.kind))continue;
    const a=provinces.get(e.a),b=provinces.get(e.b);if(!a||!b||isWaterProvince(a)||isWaterProvince(b)||isBlockedProvince(a)||isBlockedProvince(b))continue;
    const roll=random(`${project.seed}:route-preference:${e.id}`)*100;
    e.kind=roll<(c.roadPercent??0)?"road":roll<(c.roadPercent??0)+(c.riverPercent??0)?"river":roll<(c.roadPercent??0)+(c.riverPercent??0)+(c.passPercent??0)?"mountain_pass":"standard";
    delete e.special;
  }
}

/** Applied only when explicitly configured; native unit identity stays in the established themed pools. */
export function applyPlaneContentPreferences(project: MapProject, plane: Plane, createGuardian:(p:Province,seed:string)=>Province["defenders"][number]): void {
  const c=plane.generationOverrides;if(!c)return;
  const protectedSet=protectedIds(project,plane,2);
  const candidates=plane.provinces.filter(p=>!protectedSet.has(p.id)&&!isBlockedProvince(p));
  // The original archetype pass ran before gateways existed. Explicit guardian
  // preferences must also remove its guardians from newly connected start rings.
  if(c.guardianCoveragePercent!==undefined||c.guardianRosterScale!==undefined){
    for(const p of plane.provinces)if(protectedSet.has(p.id))p.defenders=[];
  }
  if(c.guardianCoveragePercent!==undefined){
    const target=Math.round(candidates.length*c.guardianCoveragePercent/100);
    const ranked=[...candidates].sort((a,b)=>random(`${project.seed}:guardian-share:${a.id}`)-random(`${project.seed}:guardian-share:${b.id}`));
    const guarded=new Set(ranked.slice(0,target).map(p=>p.id));
    for(const p of candidates)p.defenders=guarded.has(p.id)?[createGuardian(p,`${project.seed}:guardian-profile:${p.id}`)]:[];
  }
  if(c.guardianRosterScale!==undefined&&c.guardianRosterScale!==1){
    for(const p of candidates)for(const d of p.defenders)for(const squad of d.squads)squad.count=Math.min(1000,Math.max(1,Math.round(squad.count*c.guardianRosterScale)));
  }
  if(c.manySitesPercent!==undefined){
    const protectedSites=protectedIds(project,plane,1);
    for(const p of plane.provinces)if(!isBlockedProvince(p))p.manySites=!protectedSites.has(p.id)&&random(`${project.seed}:reward-share:${p.id}`)*100<c.manySitesPercent;
  }
}

export function generationControlSummary(plane: Plane): string {
  const count=plane.provinces.length;const water=plane.provinces.filter(isWaterProvince).length;
  const guardians=plane.provinces.filter(p=>p.defenders.length).length;const sites=plane.provinces.filter(p=>p.manySites).length;
  const flags=new Map<string,number>();for(const p of plane.provinces)for(const f of effectiveProvinceTerrainFlags(p))flags.set(f,(flags.get(f)??0)+1);
  return `${count} provinces: ${water} water, ${guardians} with authored guardians, ${sites} many-sites; forest ${flags.get("forest")??0}, farm ${flags.get("farm")??0}, waste ${flags.get("waste")??0}. Constraints and capital safety can override requested preferences.`;
}
