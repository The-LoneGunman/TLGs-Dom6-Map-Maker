"use client";

import { useRef, useState } from "react";
import { type MapProject } from "./domain";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "./catalog";
import { compileMapText } from "./dom6";
import { inspectNativeMap, inspectNativeRaster, MAX_NATIVE_RASTER_BYTES, MAX_NATIVE_TEXT_BYTES, type NativeMapInspection } from "./nativeInspection";

export function NativeInspectionPanel({ project, planeId, catalog = BUILTIN_DOM6_CATALOG }: { project: MapProject; planeId: string; catalog?: Dom6CatalogBundle }) {
  const [text,setText]=useState("");const [report,setReport]=useState<NativeMapInspection>();const [raster,setRaster]=useState<string>();const [error,setError]=useState<string>();
  const sequence=useRef(0);
  const inspect=(value:string)=>{try{setReport(inspectNativeMap(value));setError(undefined);}catch(e){setReport(undefined);setError(e instanceof Error?e.message:"Inspection failed.");}};
  return <details className="iteration-panel"><summary>Inspect external native maps · Read only</summary>
    <p>Inventory a Dominions .map or .d6m locally. Nothing is executed, followed, uploaded or imported into this atlas. TGA/custom artwork and unsupported directives cannot yet be converted into editable Atlas geometry.</p>
    <label className="field"><span>Native map text</span><textarea rows={5} maxLength={MAX_NATIVE_TEXT_BYTES} value={text} onChange={e=>{sequence.current++;setText(e.target.value);setReport(undefined);setError(undefined);}} /></label>
    <div className="iteration-actions"><button className="button quiet" type="button" disabled={!text.trim()} onClick={()=>{sequence.current++;inspect(text);}}>Inspect pasted map</button><button className="button quiet" type="button" onClick={()=>{sequence.current++;const value=compileMapText(project,project.planes.findIndex(p=>p.id===planeId),catalog);setText(value);inspect(value);}}>Inspect current native text</button></div>
    <label className="field"><span>Open .map or .d6m for inspection</span><input type="file" accept=".map,.d6m" onChange={async e=>{
      const file=e.target.files?.[0];e.target.value="";if(!file)return;const token=++sequence.current;setError(undefined);setReport(undefined);setRaster(undefined);
      try{
        if(/\.d6m$/i.test(file.name)){
          if(file.size>MAX_NATIVE_RASTER_BYTES)throw new Error("Raster inspection is limited to 40 MiB.");
          const data=new Uint8Array(await file.arrayBuffer());if(token!==sequence.current)return;
          const r=inspectNativeRaster(data);setRaster(`${r.valid?"Valid Atlas-compatible D6M structure":"D6M checks failed or use unsupported fields"}: ${r.width}×${r.height}, ${r.provinceCount} provinces, ${r.noneOwnerPixels} ownerless pixels. This is a binary-format check, not an in-game playtest.`);
        }else{
          if(file.size>MAX_NATIVE_TEXT_BYTES)throw new Error("Native map inspection is limited to 16 MiB.");
          const value=await file.text();if(token!==sequence.current)return;setText(value);inspect(value);
        }
      }catch(e){if(token===sequence.current)setError(e instanceof Error?e.message:"Inspection failed.");}
    }} /></label>
    {error&&<p className="analysis-caution" role="alert">{error}</p>}
    {raster&&<p role="status">{raster}</p>}
    {report&&<div className="iteration-preview" role="status"><strong>{report.title||"Untitled native map"}</strong>
      <p>{report.provinceCount} terrain records · {report.namedProvinces} named · {report.starts} generic/team starts · {report.specificStarts} nation-start declarations</p>
      <p>{report.neighbours} neighbour declarations · {report.specialBorders} border modifiers · {report.gateways} gate endpoints · {report.commanders} commanders · {report.units} units</p>
      <p>Image reference (not opened): {report.image||"none"}. Dimensions: {report.dimensions?.join(" × ")||"not declared"}.</p>
      <p>Unrecognized by Atlas: {report.unrecognized.join(", ")||"none"}. Recognized does not mean semantically validated or safe to host.</p>
      {report.warnings.map((w,i)=><p key={i}>{w}</p>)}
    </div>}
  </details>;
}
