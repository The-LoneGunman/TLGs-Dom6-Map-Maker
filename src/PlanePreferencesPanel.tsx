"use client";

import { useState } from "react";
import { type DryTerrainPreference, type Plane, type PlaneGenerationOverrides, type RegionalTerrainPlan } from "./domain";
import { assertPlaneGenerationOverrides, DRY_TERRAIN_PREFERENCES, generationControlSummary } from "./generationControls";

/** Optional values are committed only on blur so incomplete keystrokes never change the atlas. */
function PreferenceNumber({ label, value, max = 100, onChange }: {
  label: string; value?: number; max?: number; onChange: (value?: number) => boolean | void;
}) {
  return <label className="field"><span>{label}</span><input key={String(value)} type="number" min={0} max={max} step={1}
    defaultValue={value ?? ""} placeholder="Inherit" onBlur={e => {
      const raw = e.target.value.trim();
      if (!raw) { if (value !== undefined) onChange(undefined); return; }
      const parsed = Number(raw);
      if (!(Number.isInteger(parsed) && parsed >= 0 && parsed <= max) || onChange(parsed) === false) e.target.value = value === undefined ? "" : String(value);
    }} /></label>;
}

export function PlanePreferencesPanel({ plane, onChange }: { plane: Plane; onChange: (value?: PlaneGenerationOverrides) => void }) {
  const [error, setError] = useState<string>();
  const [regionName, setRegionName] = useState("Northern forest");
  const [regionTerrain, setRegionTerrain] = useState<DryTerrainPreference>("forest");
  const [regionArea, setRegionArea] = useState("north");
  const c = plane.generationOverrides ?? {};
  const update = (value: PlaneGenerationOverrides) => {
    try { assertPlaneGenerationOverrides(value); onChange(value); setError(undefined); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Invalid preferences; previous values kept."); return false; }
  };
  const set = (key: keyof PlaneGenerationOverrides, value?: number) => {
    const next = structuredClone(c); if (value === undefined) delete next[key]; else Object.assign(next, { [key]: value }); return update(next);
  };
  const surface = plane.kind === "surface" || (plane.kind === "custom" && ["temperate","wild","frozen","arid","oceanic"].includes(plane.variant ?? "temperate"));
  const cave = plane.kind === "cave" || plane.kind === "cavern";
  return <details className="iteration-panel"><summary>Generation preferences · Next generation</summary>
    <p>Blank fields inherit the established generator. These are preferences, not exact quotas: topology, terrain variety, ocean style, locks and safe starts take priority. Current provinces do not change until Generate.</p>
    {error && <p className="analysis-caution" role="alert">{error} Previous settings were kept.</p>}
    {["surface","dream","elemental","custom"].includes(plane.kind) && <PreferenceNumber label="Plane water preference (%)" value={c.waterPercent} max={60} onChange={v=>set("waterPercent",v)} />}
    {cave && <PreferenceNumber label="Cave ocean preference (%)" value={c.caveWaterPercent} max={60} onChange={v=>set("caveWaterPercent",v)} />}
    {plane.kind === "underworld" && <p>The River Styx remains an edge-to-edge barrier; water preferences never remove it.</p>}
    <details><summary>Dry-terrain weights and regional plans</summary>
      <p>Weights 0–5 bias dry terrain; 1 inherits normal preference. Cave equivalents are used underground, where farm has no effect. Water and walls are excluded.</p>
      <div className="field-grid two">{DRY_TERRAIN_PREFERENCES.map(t=><PreferenceNumber key={t} label={`${t} weight`} value={c.terrainWeights?.[t]} max={5} onChange={v=>{
        const weights={...c.terrainWeights}; if(v===undefined)delete weights[t];else weights[t]=v;return update({...c,terrainWeights:weights});
      }} />)}</div>
      <label className="field"><span>Regional plan name</span><input maxLength={80} value={regionName} onChange={e=>setRegionName(e.target.value)} /></label>
      <label className="field"><span>Regional area</span><select value={regionArea} onChange={e=>setRegionArea(e.target.value)}><option value="north">North half</option><option value="south">South half</option><option value="west">West half</option><option value="east">East half</option><option value="center">Central quarter</option></select></label>
      <label className="field"><span>Regional dry terrain</span><select value={regionTerrain} onChange={e=>setRegionTerrain(e.target.value as DryTerrainPreference)}>{DRY_TERRAIN_PREFERENCES.map(t=><option key={t}>{t}</option>)}</select></label>
      <button type="button" className="button quiet wide" disabled={!regionName.trim() || (c.regions?.length ?? 0)>=16} onClick={()=>{
        const bounds: Record<string, [number,number,number,number]>={north:[0,0,1,.5],south:[0,.5,1,1],west:[0,0,.5,1],east:[.5,0,1,1],center:[.25,.25,.75,.75]};
        const [x0,y0,x1,y1]=bounds[regionArea]!;
        const region:RegionalTerrainPlan={name:regionName.trim(),terrain:regionTerrain,x0,y0,x1,y1};update({...c,regions:[...c.regions??[],region]});
      }}>Add regional plan</button>
      <p>First matching region wins. Bounds are normalized to any map size; recipes support custom rectangles.</p>
      {c.regions?.map((r,i)=><div className="iteration-actions" key={i}><span>{r.name}: {r.terrain}</span><button className="text-button" type="button" aria-label={`Remove regional plan ${r.name}`} onClick={()=>update({...c,regions:c.regions!.filter((_,j)=>j!==i)})}>Remove</button></div>)}
    </details>
    {surface && plane.ownershipMode !== "sparse" && <details><summary>Eligible dry-land border mix</summary>
      <p>Optional shares total at most 100%. Capital access, water, impassable borders and mountain barriers are preserved. These replace the selected topology policy on eligible edges only. River share budgets complete connected routes, including bridges; safe outlets and barriers can reduce the achieved share.</p>
      <PreferenceNumber label="Road share (%)" value={c.roadPercent} onChange={v=>set("roadPercent",v)} />
      <PreferenceNumber label="River share (%)" value={c.riverPercent} onChange={v=>set("riverPercent",v)} />
      <p>Rivers follow shared borders from uplands or lakes toward coasts, joining into channels and tributaries. Capital and road crossings use bridges. Set River share to 0 for no generated border rivers. Changes apply on Generate; existing authored borders are not rerouted.</p>
      <PreferenceNumber label="Mountain-pass share (%)" value={c.passPercent} onChange={v=>set("passPercent",v)} />
    </details>}
    <PreferenceNumber label="Guarded share of eligible provinces (%)" value={c.guardianCoveragePercent} max={80} onChange={v=>set("guardianCoveragePercent",v)} />
    <label className="field"><span>Guardian troop-count multiplier</span><select value={c.guardianRosterScale??""} onChange={e=>set("guardianRosterScale",e.target.value?Number(e.target.value):undefined)}><option value="">Inherit</option>{[.5,1,1.5,2].map(v=><option key={v} value={v}>{v}×</option>)}</select></label>
    <p>Uses existing themed commander/unit pools and protects two steps around capitals. Troop count is not a battle-difficulty rating; leadership warnings and in-game testing still apply.</p>
    <PreferenceNumber label="Many-sites share outside capital rings (%)" value={c.manySitesPercent} onChange={v=>set("manySitesPercent",v)} />
    <p><strong>Current result:</strong> {generationControlSummary(plane)}</p>
    {plane.generationOverrides && <button type="button" className="button quiet wide" onClick={()=>{onChange(undefined);setError(undefined);}}>Reset plane preferences to inherited</button>}
  </details>;
}
