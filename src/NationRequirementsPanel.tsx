"use client";
import { useState } from "react";
import { TERRAIN_FLAGS, type MapProject, type TerrainFlag } from "./domain";
import { checkNationRequirements } from "./nationRequirements";
import { BoundedNumberInput } from "./EditorInputs";

export function NationRequirementsPanel({project,onChange}:{project:MapProject;onChange:(context:NonNullable<MapProject["analysisContext"]>)=>void}){
  const [nation,setNation]=useState(5),[minimum,setMinimum]=useState(2),[radius,setRadius]=useState(2),[label,setLabel]=useState("Host terrain request"),[terrain,setTerrain]=useState<TerrainFlag>("forest");
  const context=project.analysisContext??{};const results=checkNationRequirements(project);
  return <details className="ruleset-context"><summary>Optional nation terrain requirements · Check only</summary>
    <p>Explicit host requests, not nation tiers or automatic bonuses. A patch/mod change makes prior requests unverified. Declare the patch above first. Counts use potential graph connections, exclude all capitals, and do not prove practical access or recruitment.</p>
    <label className="field"><span>Requirement label</span><input value={label} maxLength={120} onChange={e=>setLabel(e.target.value)} /></label>
    <div className="field-grid two"><label className="field" htmlFor="requirement-nation"><span>Nation ID</span><BoundedNumberInput id="requirement-nation" value={nation} min={5} max={1000000} onChange={setNation} /></label>
      <label className="field"><span>Required terrain flag</span><select value={terrain} onChange={e=>setTerrain(e.target.value as TerrainFlag)}>{TERRAIN_FLAGS.filter(t=>t!=="cavewall").map(t=><option key={t} value={t}>{t}</option>)}</select></label>
      <label className="field" htmlFor="requirement-minimum"><span>Minimum matching provinces</span><BoundedNumberInput id="requirement-minimum" value={minimum} min={1} max={20} onChange={setMinimum} /></label>
      <label className="field" htmlFor="requirement-radius"><span>Maximum graph steps</span><BoundedNumberInput id="requirement-radius" value={radius} min={1} max={3} onChange={setRadius} /></label></div>
    <button type="button" className="button quiet" disabled={!label.trim()||!context.gameVersion?.trim()||(context.requirements?.length??0)>=64} onClick={()=>onChange({...context,requirements:[...context.requirements??[],{nation,label:label.trim(),terrain,minimum,radius,gameVersion:context.gameVersion!.trim(),mods:(context.mods??"").trim()}]})}>Add declared requirement</button>
    {results.map((r,i)=><div className="iteration-preview" key={i}><strong>{r.requirement.label} · Nation {r.requirement.nation}: {r.status}</strong><p>{r.message}</p>
      <div className="iteration-actions"><button type="button" className="text-button" onClick={()=>onChange({...context,requirements:context.requirements!.filter((_,j)=>j!==i)})}>Remove requirement</button>
        {r.status==="unverified"&&<button className="text-button" type="button" disabled={!context.gameVersion?.trim()} onClick={()=>onChange({...context,requirements:context.requirements!.map((v,j)=>j===i?{...v,gameVersion:context.gameVersion!.trim(),mods:(context.mods??"").trim()}:v)})}>Reconfirm for declared patch/mods</button>}</div>
    </div>)}
    <p>To accommodate a request, inspect its start and preview an explicit terrain edit using Iterate. Atlas will not grant hidden provinces, resources or income.</p>
  </details>;
}
