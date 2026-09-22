"use client";

import { useEffect, useRef, useState } from "react";
import { type MapProject } from "./domain";
import { type Dom6CatalogBundle } from "./catalog";
import { prepareGuardianScenario, finishGuardianScenario } from "./guardianScenario";
import { startProjectGeneration, isGenerationAbort, type ProjectGenerationTask } from "./generationWorker";
import { downloadProject } from "./projectFile";
import { loadPackageExporter } from "./packageExporterLoader";
import { validateProject } from "./dom6";

export function GuardianScenarioPanel({project, catalog}:{project:MapProject;catalog:Dom6CatalogBundle}){
  const [selected,setSelected]=useState("");const [error,setError]=useState<string>();const [exportBusy,setExportBusy]=useState(false);
  const [job,setJob]=useState<{source:MapProject;running:boolean}>();const sequence=useRef(0);const task=useRef<ProjectGenerationTask|undefined>(undefined);
  useEffect(()=>()=>{sequence.current++;task.current?.cancel();task.current=undefined;},[project]);
  const busy=exportBusy||(job?.source===project&&job.running);
  const choices=project.planes.flatMap(p=>p.provinces.filter(v=>v.defenders.length).map(v=>({key:`${p.id}:${v.id}`,plane:p,province:v})));
  const [fixture,setFixture]=useState<{source:MapProject;value:MapProject}>();
  const current=fixture?.source===project?fixture.value:undefined;
  const issues=current?validateProject(current,catalog):[];
  return <details className="iteration-panel"><summary>Isolated guardian test scenario</summary>
    <p>Build a separate two-player, 48-province test map with one copied guardian province. The current atlas and game saves are never replaced. Use appropriate nations, mods and attacking armies; this does not simulate combat.</p>
    <label className="field"><span>Guardian source province</span><select value={selected} disabled={busy} onChange={e=>{sequence.current++;task.current?.cancel();task.current=undefined;setJob({source:project,running:false});setSelected(e.target.value);setFixture(undefined);}}><option value="">Choose authored guardians</option>{choices.map(c=><option value={c.key} key={c.key}>{c.plane.name} #{c.province.index}: {c.province.name}</option>)}</select></label>
    <button className="button quiet wide" type="button" disabled={!choices.some(c=>c.key===selected)||busy} onClick={async()=>{
      const token=++sequence.current;setJob({source:project,running:true});setError(undefined);
      try{const choice=choices.find(c=>c.key===selected)!;const input=prepareGuardianScenario(project,choice.plane.id,choice.province.id);task.current=startProjectGeneration(input);const generated=await task.current.promise;if(token!==sequence.current)return;
        setFixture({source:project,value:finishGuardianScenario(project,choice.plane.id,choice.province.id,generated,catalog)});}
      catch(e){if(token===sequence.current&&!isGenerationAbort(e)){setError(e instanceof Error?e.message:"Could not build fixture.");setFixture(undefined);}}
      finally{if(token===sequence.current){task.current=undefined;setJob({source:project,running:false});}}
    }}>Prepare separate fixture</button>
    {job?.source===project&&job.running&&<><p role="status">Generating separate fixture in the background…</p><button className="button quiet" type="button" onClick={()=>{sequence.current++;task.current?.cancel();task.current=undefined;setJob({source:project,running:false});}}>Cancel fixture generation</button></>}
    {error&&<p role="alert">{error}</p>}
    {current&&<div className="iteration-preview"><p>{current.name}: {current.planes[0]!.provinces.length} provinces. Find the province named GUARDIAN TEST in-game. Random independents elsewhere still follow host/game rules.</p><p>{current.description}</p>
      <div className="iteration-actions"><button type="button" className="button quiet" disabled={busy} onClick={()=>downloadProject(current)}>Download fixture JSON</button><button type="button" className="button quiet" disabled={busy||issues.some(i=>i.severity==="error")} onClick={async()=>{
        setExportBusy(true);try{const {downloadPackage}=await loadPackageExporter();await downloadPackage(current,undefined,catalog);setError(undefined);}catch(e){setError(e instanceof Error?e.message:"Fixture download failed.");}finally{setExportBusy(false);}
      }}>{busy?"Preparing fixture ZIP…":"Download fixture ZIP"}</button></div>
      {issues.filter(i=>i.severity!=="info").slice(0,8).map(i=><p key={i.id}>{i.severity}: {i.message}</p>)}
    </div>}
  </details>;
}
