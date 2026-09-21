import { clearAllPlayerStartFeatures, cloneProject, isBlockedProvince, isCaveProvince, isWaterProvince, type MapProject } from "./domain";
import { addPlane, ARCHETYPE_PROFILES, createDefaultProject, generateProject, isCorePlaneForSizing } from "./generator";
import { protectedProvinceKeys } from "./iteration";
import { validateProject } from "./dom6";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "./catalog";

/** Creates a separate atlas; never changes the source or writes any game/save directory. */
export function prepareGuardianScenario(project: MapProject, planeId: string, provinceId: string): MapProject {
  const sourcePlane=project.planes.find(p=>p.id===planeId);
  const source=sourcePlane?.provinces.find(p=>p.id===provinceId);
  if(!sourcePlane||!source||!source.defenders.length||isBlockedProvince(source))throw new Error("Select a traversable province with authored guardians.");
  let fixture=createDefaultProject(`guardian-fixture:${project.seed.slice(0,128)}:${source.index}`,{generate:false});
  fixture.name=`Guardian Test ${source.index}`;
  fixture.description=`Isolated test of ${sourcePlane.name.slice(0,120)} #${source.index} (${source.name.slice(0,120)}). Neutral structural setup only: choose suitable nations, mods, referenced battle assets and attacking armies in Dominions. The host must provide the movement abilities needed to reach the target, especially for water/cave terrain. No battle difficulty is certified. Fixture guardians are marked GUARDIAN TEST.`;
  fixture.targetVersion=project.targetVersion;fixture.settings.players=2;fixture.settings.provincesPerPlayer=24;
  fixture.settings.throneCount=0;fixture.settings.waterPercent=isWaterProvince(source)?50:18;
  fixture.settings.economyBalance="none";fixture.settings.caveStartNations=[];fixture.settings.planeConnections=[];
  if(sourcePlane.kind!=="surface"){
    fixture=addPlane(fixture,sourcePlane.kind,{generate:false});fixture.planes=[fixture.planes[1]!];
  }
  const p=fixture.planes[0]!;p.kind=sourcePlane.kind;p.variant=sourcePlane.variant;p.ownershipMode=sourcePlane.ownershipMode;
  p.autoSize=false;p.provinceTarget=48;p.width=1024;p.height=768;p.wrapX=false;p.wrapY=false;p.noGeneratedStarts=false;
  const cave=ARCHETYPE_PROFILES[sourcePlane.kind].caveFamily;
  const other=!cave&&!isCorePlaneForSizing(sourcePlane);
  fixture.settings.startDistribution={land:!cave&&!other?2:0,coastal:0,water:0,cave:cave?2:0,other:other?2:0};
  return fixture;
}

export function finishGuardianScenario(project: MapProject, planeId: string, provinceId: string, generated: MapProject, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG): MapProject {
  const source=project.planes.find(p=>p.id===planeId)?.provinces.find(p=>p.id===provinceId);
  if(!source?.defenders.length||isBlockedProvince(source))throw new Error("Guardian source no longer exists or is blocked.");
  if(generated.planes.length!==1||generated.settings.players!==2||generated.planes[0]!.provinces.length!==48)throw new Error("The isolated guardian fixture is incomplete; the source atlas was kept.");
  const fixture=cloneProject(generated);
  fixture.gates=[];fixture.specificStarts=[];
  const protectedKeys=protectedProvinceKeys(fixture,2);
  const targetPlane=fixture.planes[0]!;
  const targets=targetPlane.provinces.filter(v=>!protectedKeys.has(`${targetPlane.id}:${v.id}`)&&!isBlockedProvince(v));
  const matchingTarget=targets.find(v=>isWaterProvince(v)===isWaterProvince(source)&&isCaveProvince(v)===isCaveProvince(source));
  const target=matchingTarget??targets[0];
  if(!target)throw new Error("No safe test province exists outside the two-ring capital buffers. The source atlas was kept.");
  if(!matchingTarget)fixture.description+=" The target alone was adapted to the source guardian province's water/cave terrain; the surrounding test geography is not a copy of the source map.";
  for(const v of targetPlane.provinces){v.defenders=[];v.throne="none";delete v.fixedThrone;v.sites=[];v.manySites=false;v.rawDirectives="";v.killRandomSites=true;}
  target.name=`GUARDIAN TEST — ${source.name.slice(0,120)}`;target.nameSource="authored";
  target.terrain=source.terrain;target.terrainFlags=source.terrainFlags?structuredClone(source.terrainFlags):undefined;
  target.freshwater=source.freshwater;target.small=source.small;target.large=source.large;
  target.biome=source.biome;target.warmer=source.warmer;target.colder=source.colder;target.poptype=source.poptype;
  target.defenders=structuredClone(source.defenders);target.battle=structuredClone(source.battle);
  target.noStart=true;fixture.analysisContext=project.analysisContext?structuredClone(project.analysisContext):undefined;
  fixture.settings.resolution="custom";clearAllPlayerStartFeatures(fixture);
  // Cleanups must never silently erase the single group that makes this fixture useful.
  if(!target.defenders.length)throw new Error("The fixture target conflicts with capital safety; no scenario was produced.");
  const errors=validateProject(fixture,catalog).filter(issue=>issue.severity==="error");
  if(errors.length)throw new Error(`The isolated guardian fixture cannot be exported: ${errors[0]!.message} The source atlas was kept.`);
  return cloneProject(fixture);
}

export function createGuardianScenario(project: MapProject, planeId: string, provinceId: string, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG): MapProject {
  return finishGuardianScenario(project,planeId,provinceId,generateProject(prepareGuardianScenario(project,planeId,provinceId)),catalog);
}
