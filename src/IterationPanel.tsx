"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cloneProject, TERRAIN_FLAGS, TERRAIN_LABELS, type MapProject, type ProvinceLockGroup, type TerrainFlag, type TerrainKey } from "./domain";
import { PROVINCE_LOCK_GROUPS, snapshotWithLocks } from "./authoringLocks";
import { addAuthoredRegion, previewBatchEdit, previewContentReroll, selectProvinces, type BatchEdit, type ContentReroll, type EditPreview, type ProvinceSelection } from "./iteration";
import { applyBuiltinRecipe, applySettingsRecipe, BUILTIN_RECIPES, createSettingsRecipe, MAX_RECIPE_BYTES, parseSettingsRecipe } from "./recipes";
import { type Dom6CatalogBundle } from "./catalog";
import { calculateFairness } from "./generator";
import { isGenerationAbort, type ProjectGenerationTask } from "./generationWorker";
import { createGenerationWorkerSession } from "./generationWorkerSession";
import { prefetchVerifiedPopulationDefenseProfiles } from "./populationDefenseRegistry";
import { validateProject } from "./dom6";
import { analyzeStarts, recordGenerationInputs } from "./workbench";
import { MapCanvas } from "./MapCanvas";
import { BoundedNumberInput } from "./EditorInputs";
import { NativeInspectionPanel } from "./NativeInspectionPanel";
import { GuardianScenarioPanel } from "./GuardianScenarioPanel";

/** The section whose controls produced a preview or error; its feedback renders directly below it. */
type IterationSection = "selection" | "batch" | "reroll" | "protect" | "locks" | "candidates" | "recipes";
interface ProposedEdit { source: MapProject; next: MapProject; title: string; detail: string; section: IterationSection; result?: EditPreview }
interface CandidateRun { source: MapProject; running: boolean; message: string; projects: MapProject[] }

const LOCK_GROUP_LABELS: Record<ProvinceLockGroup, string> = { name: "Name", terrain: "Terrain", economy: "Economy", sites: "Sites", guardians: "Guardians" };
/** Same names as the province inspector's terrain-flag checkboxes; option values stay the saved flag keys. */
const TERRAIN_FLAG_LABELS: Record<TerrainFlag, string> = {
  sea: "Sea", freshwater: "Fresh water", highland: "Highland", swamp: "Swamp", waste: "Wasteland", forest: "Forest",
  farm: "Farm", deep: "Deep sea", cave: "Cave", mountains: "Mountains", cavewall: "Impassable cave wall",
};

function CandidatePreview({project}:{project:MapProject}) {
  const [open,setOpen]=useState(false);
  const [planeId,setPlaneId]=useState(project.planes[0]!.id);
  const plane=project.planes.find(p=>p.id===planeId)??project.planes[0]!;
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Preview candidate planes</summary>
    {open&&<><label className="field"><span>Candidate preview plane</span><select value={plane.id} onChange={e=>setPlaneId(e.target.value)}>{project.planes.map(p=><option key={p.id} value={p.id}>{p.name} ({p.provinces.length})</option>)}</select></label>
      <div className="candidate-map"><MapCanvas plane={plane} previewCondition="normal" onNavigate={()=>undefined} onActivate={()=>undefined} /></div></>}
  </details>;
}

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Provinces on one plane whose saved content differs between the current atlas and a proposal. */
function changedProvinceIds(source: MapProject, next: MapProject, planeId: string): string[] {
  const before = new Map(source.planes.find(p => p.id === planeId)?.provinces.map(p => [p.id, JSON.stringify(p)]));
  return (next.planes.find(p => p.id === planeId)?.provinces ?? []).filter(p => before.get(p.id) !== JSON.stringify(p)).map(p => p.id);
}

export function IterationPanel({ project, planeId, selectedId, catalog, busy, onCommit, onHighlight, onClearHighlight }: {
  project: MapProject; planeId: string; selectedId?: string; catalog: Dom6CatalogBundle; busy: boolean;
  onCommit: (next: MapProject, expectedSource: MapProject) => boolean;
  onHighlight: (ids: string[], label: string) => void;
  /** Clears a map highlight this panel added for a preview once that preview is discarded. */
  onClearHighlight?: () => void;
}) {
  const [selection, setSelection] = useState<Omit<ProvinceSelection,"planeId">>({role:"neutral"});
  const [onlySelected, setOnlySelected] = useState(false);
  const [regionName, setRegionName] = useState("");
  const [group, setGroup] = useState<ProvinceLockGroup>("terrain");
  const [editKind, setEditKind] = useState<BatchEdit["kind"]>("flag");
  const [terrain, setTerrain] = useState<TerrainKey>("forest");
  const [flag, setFlag] = useState<TerrainFlag>("forest");
  const [enabled, setEnabled] = useState(true);
  const [population, setPopulation] = useState(8000);
  const [climate, setClimate] = useState<"normal"|"warmer"|"colder">("normal");
  const [reroll, setReroll] = useState<ContentReroll>("name");
  const [contentSeed, setContentSeed] = useState("variation-1");
  const [preview, setPreview] = useState<ProposedEdit>();
  const [error, setError] = useState<{ section: IterationSection; message: string }>();
  const [recipeText, setRecipeText] = useState("");
  const [recipeId, setRecipeId] = useState("ffa");
  const [includeSeed, setIncludeSeed] = useState(false);
  const [candidates, setCandidates] = useState<CandidateRun>();
  const [candidateCount, setCandidateCount] = useState(2);
  const task = useRef<ProjectGenerationTask | undefined>(undefined);
  const request = useRef(0);
  const recipeInput = useRef<HTMLInputElement>(null);
  const recipeSequence = useRef(0);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const previewCard = useRef<HTMLElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  /** The control that opened the preview; Apply and Discard return focus to it. */
  const previewTrigger = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const previewHighlighted = useRef(false);
  const previewHeadingId = useId();
  const toolsHeadingId = useId();
  useEffect(() => () => { request.current++; recipeSequence.current++; task.current?.cancel(); task.current = undefined; }, [project]);
  const plane = project.planes.find(p => p.id === planeId)!;
  const matches = useMemo(() => onlySelected ? plane.provinces.filter(p => p.id === selectedId)
    : selectProvinces(project, { ...selection, planeId }), [onlySelected, plane, planeId, project, selectedId, selection]);
  const ids = matches.map(p => p.id);
  const currentPreview = preview?.source === project ? preview : undefined;
  const currentCandidates = candidates?.source === project ? candidates : undefined;
  const running = busy || !!currentCandidates?.running;
  // A new preview renders below the section that produced it; bring it into view and announce it by focusing its heading.
  useEffect(() => {
    if (!preview) return;
    previewCard.current?.scrollIntoView({ block: "nearest" });
    previewHeading.current?.focus({ preventScroll: true });
  }, [preview]);
  // After Apply or Discard removes the card, keep keyboard focus in the panel instead of dropping it to the page.
  useEffect(() => {
    if (currentPreview || !restoreFocus.current) return;
    restoreFocus.current = false;
    const trigger = previewTrigger.current;
    previewTrigger.current = null;
    (trigger?.isConnected && !trigger.matches(":disabled") ? trigger : panelHeading.current)?.focus();
  }, [currentPreview]);
  const fail = (section: IterationSection, e: unknown, fallback: string) => setError({ section, message: e instanceof Error ? e.message : fallback });
  const attempt = (section: IterationSection, action: () => void) => { try { setError(undefined); action(); } catch (e) { fail(section, e, "The operation could not be prepared."); } };
  const dismissPreview = () => {
    setPreview(undefined);
    if (previewHighlighted.current) { previewHighlighted.current = false; onClearHighlight?.(); }
  };
  const propose = (section: IterationSection, title: string, next: MapProject, detail: string, result?: EditPreview, highlight?: { ids: string[]; label: string }) => {
    previewTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A preview that turns population-matched defenders on (for example, a recipe) is applied later; load the templates now.
    if (next.populationDefense?.enabled) prefetchVerifiedPopulationDefenseProfiles();
    setPreview({source:project,next,title,detail,section,result});
    previewHighlighted.current = !!highlight?.ids.length;
    if (highlight?.ids.length) onHighlight(highlight.ids, highlight.label);
  };
  /** Previews built from the province selection highlight the provinces they change (or, if none change, the selection). */
  const proposeForSelection = (section: IterationSection, title: string, next: MapProject, detail: string, result?: EditPreview) => {
    const changed = changedProvinceIds(project, next, planeId);
    propose(section, title, next, detail, result, changed.length ? { ids: changed, label: `${title} (${changed.length} changed)` } : { ids, label: `${title} (${ids.length} matched)` });
  };
  const proposeContent = (section: IterationSection, result: EditPreview, title: string) => proposeForSelection(section, title, result.project,
    `${result.matched} matched; ${result.changed} changed; ${result.locked} locked/manual and ${result.protected} protected provinces skipped.`, result);
  const runCandidates = async () => {
    const source = project;
    const token = ++request.current;
    const projects: MapProject[] = [];
    // One background worker generates the candidates in turn and is released when the comparison ends.
    // Cancelling terminates it mid-candidate; a failed worker is never reused.
    const session = createGenerationWorkerSession();
    setError(undefined); setCandidates({source,running:true,message:"Preparing candidates…",projects:[]});
    try {
      for (let i=0; i<candidateCount; i++) {
        if (request.current !== token) return;
        const input = cloneProject(source); input.seed = `${source.seed}:candidate:${contentSeed}:${i+1}`;
        task.current = session.start(input,{onProgress:p=>setCandidates({source,running:true,message:`Candidate ${i+1}/${candidateCount}: ${p.message}`,projects:[...projects]})});
        const result = await task.current.promise;
        if (request.current !== token) return;
        projects.push(recordGenerationInputs(result));
      }
      setCandidates({source,running:false,message:"Compare candidates; none has replaced your current atlas.",projects});
    } catch (e) {
      if (request.current === token) {
        if (!isGenerationAbort(e)) fail("candidates", e, "Candidate generation failed.");
        setCandidates({source,running:false,message:"Stopped; current atlas is unchanged.",projects});
      }
    } finally { session.dispose(); if (request.current === token) task.current = undefined; }
  };
  /** Errors and the Apply/Discard card appear directly below the section that produced them. */
  const feedback = (section: IterationSection) => <>
    {error?.section === section && <p role="alert" className="analysis-caution">{error.message}</p>}
    {currentPreview?.section === section && <section ref={previewCard} className="iteration-preview" aria-label="Pending iteration edit">
      <h3 id={previewHeadingId} ref={previewHeading} tabIndex={-1}>{currentPreview.title}</h3><p>{currentPreview.detail}</p>
      {!!currentPreview.result?.samples.length&&<p>{currentPreview.result.samples.join(" · ")}</p>}
      {!!currentPreview.result?.errors.length&&<div role="alert" className="analysis-caution"><strong>Cannot apply: introduces {currentPreview.result.errors.length} export blockers.</strong><ul>{currentPreview.result.errors.slice(0,4).map((e,i)=><li key={i}>{e.message}</li>)}</ul></div>}
      <div className="iteration-actions" role="group" aria-labelledby={previewHeadingId}><button type="button" className="button primary" disabled={running||!!currentPreview.result?.errors.length||currentPreview.result?.changed===0} onClick={()=>{if(onCommit(currentPreview.next,currentPreview.source)){restoreFocus.current=true;previewHighlighted.current=false;setPreview(undefined);}}}>Apply previewed change</button><button className="button quiet" type="button" onClick={()=>{restoreFocus.current=true;dismissPreview();}}>Discard preview</button></div>
    </section>}
  </>;

  return <div className="iteration-panel">
    <div className="section-heading"><p className="eyebrow">SAFE ITERATION</p><h2 ref={panelHeading} tabIndex={-1}>Refine this atlas</h2></div>
    <p>Choose provinces on {plane.name}, preview a change, then apply it. Each applied change is one Undoable edit; discarding a preview leaves the atlas unchanged.</p>
    <details open><summary>Choose provinces / named regions</summary>
      <label className="iteration-check"><input type="checkbox" checked={onlySelected} onChange={e=>{setOnlySelected(e.target.checked);dismissPreview();}} />Only the currently selected province</label>
      {!onlySelected && <>
        <label className="field"><span>Province role</span><select value={selection.role} onChange={e=>{setSelection({...selection,role:e.target.value as ProvinceSelection["role"]});dismissPreview();}}>
          <option value="all">All provinces</option><option value="neutral">Non-capitals</option><option value="starts">Capitals</option><option value="guardians">With guardians</option><option value="water">Water</option><option value="dry">Traversable dry land</option>
        </select></label>
        <label className="field"><span>Primary terrain filter</span><select value={selection.terrain??""} onChange={e=>{setSelection({...selection,terrain:(e.target.value||undefined) as TerrainKey|undefined});dismissPreview();}}><option value="">Any terrain</option>{Object.entries(TERRAIN_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field"><span>Effective terrain flag filter</span><select value={selection.flag??""} onChange={e=>{setSelection({...selection,flag:(e.target.value||undefined) as TerrainFlag|undefined});dismissPreview();}}><option value="">Any flag</option>{TERRAIN_FLAGS.map(flag=><option key={flag} value={flag}>{TERRAIN_FLAG_LABELS[flag]}</option>)}</select></label>
        <label className="field"><span>Name or local province number</span><input value={selection.query??""} maxLength={160} onChange={e=>{setSelection({...selection,query:e.target.value});dismissPreview();}} /></label>
        <label className="field"><span>Named region</span><select value={selection.regionId??""} onChange={e=>{setSelection({...selection,regionId:e.target.value||undefined});dismissPreview();}}><option value="">Entire active plane</option>{project.authoring?.regions?.filter(r=>r.planeId===planeId).map(r=><option key={r.id} value={r.id}>{r.name} ({r.provinceIds.length})</option>)}</select></label>
      </>}
      <p role="status">{ids.length} provinces selected.</p>
      <button className="button quiet wide" type="button" disabled={!ids.length} onClick={()=>{previewHighlighted.current=false;onHighlight(ids,"Iteration selection");}}>Highlight selection</button>
      <label className="field"><span>Save selection as region</span><input value={regionName} maxLength={80} onChange={e=>setRegionName(e.target.value)} placeholder="Northern marches" /></label>
      <button className="button quiet wide" type="button" disabled={!ids.length||!regionName.trim()} onClick={()=>attempt("selection",()=>proposeForSelection("selection","Save named region",addAuthoredRegion(project,planeId,ids,regionName),`Remember ${ids.length} province IDs; geography is unchanged.`))}>Preview saved region</button>
      {selection.regionId && <button className="button quiet wide" type="button" onClick={()=>attempt("selection",()=>{const next=cloneProject(project);next.authoring!.regions=next.authoring!.regions!.filter(r=>r.id!==selection.regionId);proposeForSelection("selection","Remove named selection",next,"Only the region bookmark is removed; provinces stay unchanged.");})}>Remove region bookmark…</button>}
    </details>
    {feedback("selection")}
    <details><summary>Batch edit selected provinces</summary>
      <label className="field"><span>Batch operation</span><select value={editKind} onChange={e=>{setEditKind(e.target.value as BatchEdit["kind"]);dismissPreview();}}><option value="flag">Add/remove terrain flag</option><option value="terrain">Replace primary terrain</option><option value="population">Set population</option><option value="poptype">Set population-type ID</option><option value="manySites">Many-sites flag</option><option value="climate">Climate marker</option><option value="clearGuardians">Clear guardian groups</option></select></label>
      {editKind === "terrain" && <label className="field"><span>Replacement terrain</span><select value={terrain} onChange={e=>{setTerrain(e.target.value as TerrainKey);dismissPreview();}}>{Object.entries(TERRAIN_LABELS).filter(([k])=>k!=="freshwater").map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
      {editKind === "flag" && <label className="field"><span>Terrain flag</span><select value={flag} onChange={e=>{setFlag(e.target.value as TerrainFlag);dismissPreview();}}>{TERRAIN_FLAGS.map(f=><option key={f} value={f}>{TERRAIN_FLAG_LABELS[f]}</option>)}</select></label>}
      {(editKind === "flag" || editKind === "manySites") && <label className="iteration-check"><input type="checkbox" checked={enabled} onChange={e=>{setEnabled(e.target.checked);dismissPreview();}} />Enable flag (unchecked removes it)</label>}
      {(editKind === "population" || editKind === "poptype") && <label className="field"><span>{editKind === "population" ? "Population value" : "Population-type ID"}</span><BoundedNumberInput value={population} min={0} max={editKind==="population"?50000:1000000} onChange={value=>{setPopulation(value);dismissPreview();}} /></label>}
      {editKind === "climate" && <label className="field"><span>Climate marker</span><select value={climate} onChange={e=>{setClimate(e.target.value as typeof climate);dismissPreview();}}><option value="normal">Neither marker</option><option value="warmer">Warmer</option><option value="colder">Colder</option></select></label>}
      <button className="button quiet wide" type="button" disabled={!ids.length||running} onClick={()=>attempt("batch",()=>{
        const edit: BatchEdit = editKind === "terrain" ? {kind:editKind,terrain} : editKind === "flag" ? {kind:editKind,flag,enabled}
          : editKind === "population" || editKind === "poptype" ? {kind:editKind,value:population} : editKind === "manySites" ? {kind:editKind,enabled}
            : editKind === "climate" ? {kind:editKind,value:climate} : {kind:"clearGuardians"};
        proposeContent("batch",previewBatchEdit(project,planeId,ids,edit,catalog),"Batch edit preview");
      })}>Preview batch edit</button>
    </details>
    {feedback("batch")}
    <details><summary>Reroll content without changing geography</summary>
      <label className="field"><span>Content to reroll</span><select value={reroll} onChange={e=>{setReroll(e.target.value as ContentReroll);dismissPreview();}}><option value="name">Generated names only</option><option value="economy">Population and local recruitment</option><option value="sites">Many-sites flag and site affinity</option><option value="guardians">Initial guardian groups</option></select></label>
      <label className="field"><span>Content / candidate seed</span><input value={contentSeed} maxLength={256} onChange={e=>{setContentSeed(e.target.value);dismissPreview();}} /></label>
      <p>Starts, borders, gateways and geography stay unchanged. Locks and protected capital zones are respected; names marked manual are preserved.</p>
      <button className="button quiet wide" type="button" disabled={!ids.length||!contentSeed.trim()||running} onClick={()=>attempt("reroll",()=>proposeContent("reroll",previewContentReroll(project,planeId,ids,reroll,contentSeed,catalog),"Content-only reroll preview"))}>Preview content reroll</button>
    </details>
    {feedback("reroll")}
    <details><summary>Protect authored fields</summary>
      <label className="field"><span>Field group to protect</span><select value={group} onChange={e=>setGroup(e.target.value as ProvinceLockGroup)}>{PROVINCE_LOCK_GROUPS.map(g=><option key={g} value={g}>{LOCK_GROUP_LABELS[g]}</option>)}</select></label>
      <p>Field locks protect same-seed regeneration and batch tools. A different world seed changes province IDs and is rejected while fields are locked; use content-only rerolls or unlock explicitly. Direct inspector edits remain intentional edits. Keep layout locked if positions must not move.</p>
      <div className="iteration-actions">{[true,false].map(value=><button key={String(value)} type="button" className="button quiet" disabled={!ids.length} onClick={()=>attempt("protect",()=>proposeForSelection("protect",value?"Protect fields":"Unlock fields",snapshotWithLocks(project,planeId,ids,[group],value),`${value?"Protect":"Unlock"} ${LOCK_GROUP_LABELS[group].toLowerCase()} fields on ${ids.length} selected provinces.`))}>{value?"Protect":"Unlock"} selected</button>)}</div>
    </details>
    {feedback("protect")}
    <details><summary>Layout and start safeguards</summary>
      <label className="iteration-check"><input type="checkbox" checked={!!project.authoring?.lockLayout} onChange={e=>attempt("locks",()=>{const next=cloneProject(project);next.authoring={...next.authoring,lockLayout:e.target.checked};onCommit(next,project);})} />Lock layout, borders, gateways and dimensions</label>
      <label className="iteration-check"><input type="checkbox" checked={!!project.authoring?.lockStarts} onChange={e=>attempt("locks",()=>{const next=cloneProject(project);next.authoring={...next.authoring,lockStarts:e.target.checked};onCommit(next,project);})} />Lock generic, team and nation starts</label>
      <p>Layout lock blocks full generation. Content-only rerolls still work. Unlock explicitly to change protected structure.</p>
    </details>
    {feedback("locks")}
    <details><summary>Compare generated candidates</summary>
      <label className="field"><span>Candidate count (2–3)</span><select value={candidateCount} onChange={event=>setCandidateCount(Number(event.target.value))}><option value={2}>2 candidates</option><option value={3}>3 candidates</option></select></label>
      <p>Uses the content/candidate seed from Reroll content above. Generates alternatives in background workers; no candidate is automatically selected by its score.</p>
      <button className="button quiet wide" type="button" disabled={running||!contentSeed.trim()||!!project.authoring?.lockLayout} onClick={()=>{void runCandidates();}}>Generate candidates for comparison</button>
      {currentCandidates?.running && <button className="button quiet wide" type="button" onClick={()=>{request.current++;task.current?.cancel();task.current=undefined;setCandidates({...currentCandidates,running:false,message:"Cancelled; current atlas is unchanged."});}}>Cancel candidate generation</button>}
      {currentCandidates && <p role="status" aria-live="polite">{currentCandidates.message}</p>}
      {currentCandidates?.projects.map((candidate,index)=>{
        const issues=validateProject(candidate,catalog);const errors=issues.filter(i=>i.severity==="error");const analysis=analyzeStarts(candidate);
        const minimum=analysis.starts.length?Math.min(...analysis.starts.map(s=>s.twoStepKeys.length)):0;
        return <section className="candidate-card" key={candidate.seed}><h3>Candidate {index+1}</h3><p className="microcopy">{candidate.seed}</p>
          <p>Structural score {calculateFairness(candidate).overall}/100 · smallest two-step region {minimum} · two-step spread (CV) {analysis.twoStepCv===undefined?"unknown":`${(analysis.twoStepCv*100).toFixed(1)}%`} · {errors.length} export blockers · {issues.filter(i=>i.severity==="warning").length} warnings. No score certifies multiplayer balance.</p>
          <CandidatePreview project={candidate} />
          {errors.length>0&&<p className="analysis-caution">{errors[0]!.message}</p>}
          <button className="button quiet wide" type="button" disabled={!!errors.length||running} onClick={()=>propose("candidates",`Use candidate ${index+1}`,candidate,"Replaces the current atlas with this candidate as one Undoable edit. Export a project backup first if needed.")}>Review candidate replacement</button>
        </section>;
      })}
    </details>
    {feedback("candidates")}
    <section className="iteration-tools" aria-labelledby={toolsHeadingId}>
      <h3 id={toolsHeadingId}>Tools</h3>
      <details><summary>Settings and host-policy recipes</summary>
        <label className="field"><span>Starting recipe</span><select value={recipeId} onChange={e=>{setRecipeId(e.target.value);dismissPreview();}}>{BUILTIN_RECIPES.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <p>{BUILTIN_RECIPES.find(r=>r.id===recipeId)?.note}</p>
        <button type="button" className="button quiet wide" onClick={()=>attempt("recipes",()=>propose("recipes","Apply starting recipe",applyBuiltinRecipe(project,recipeId),"Changes next-generation settings only. Current provinces, starts and gates are unchanged; generate when ready."))}>Preview recipe settings</button>
        <label className="iteration-check"><input type="checkbox" checked={includeSeed} onChange={e=>setIncludeSeed(e.target.checked)} />Include the current world seed in saved recipe</label>
        <button type="button" className="button quiet wide" onClick={()=>attempt("recipes",()=>downloadText(JSON.stringify(createSettingsRecipe(project,project.name,includeSeed),null,2),"Atlas-settings.recipe.json"))}>Download settings recipe</button>
        <input hidden ref={recipeInput} type="file" accept=".json" aria-label="Import settings recipe file" onChange={event=>{
          const file=event.target.files?.[0];event.target.value="";if(!file)return;const token=++recipeSequence.current;
          if(file.size>MAX_RECIPE_BYTES){setError({section:"recipes",message:"Settings recipes are limited to 256 KiB."});return;}
          void file.text().then(text=>{if(token!==recipeSequence.current)return;const recipe=parseSettingsRecipe(text);propose("recipes",`Import recipe: ${recipe.name}`,applySettingsRecipe(project,recipe),"Applies configuration and stages missing planes. No existing plane is removed. Geometry/borders may update for configured wrap or dimensions. Included defender policies and host patch/mod declarations affect current exports immediately; Generate rebuilds geography.");setError(undefined);}).catch(e=>{if(token===recipeSequence.current)fail("recipes",e,"Recipe could not be read.");});
        }} />
        <button type="button" className="button quiet wide" onClick={()=>recipeInput.current?.click()}>Open settings recipe</button>
        <label className="field"><span>Or paste recipe JSON</span><textarea rows={3} maxLength={MAX_RECIPE_BYTES} value={recipeText} onChange={e=>{recipeSequence.current++;setRecipeText(e.target.value);dismissPreview();}} /></label>
        <button type="button" className="button quiet wide" disabled={!recipeText.trim()} onClick={()=>attempt("recipes",()=>{const recipe=parseSettingsRecipe(recipeText);propose("recipes",`Import recipe: ${recipe.name}`,applySettingsRecipe(project,recipe),"Applies configuration and stages missing planes; no existing plane is removed. Included defender policies and host patch/mod declarations affect current exports immediately. Generate after reviewing the geography plan.");})}>Preview pasted recipe</button>
        <p>A recipe contains configuration, not authored province content. Defender policies and host patch/mod declarations affect current exports immediately. Keep Editable project JSON for an exact backup. Older Atlas builds may reject new optional editing metadata.</p>
      </details>
      {feedback("recipes")}
      <NativeInspectionPanel project={project} planeId={planeId} catalog={catalog} />
      <GuardianScenarioPanel project={project} catalog={catalog} />
    </section>
  </div>;
}
