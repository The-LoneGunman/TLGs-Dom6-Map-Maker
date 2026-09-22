"use client";

import { useMemo, useState } from "react";
import { NationRequirementsPanel } from "./NationRequirementsPanel";
import { GAME_ERA_LABELS, type FairnessMetrics, type GameEra, type MapProject } from "./domain";
import { previewProvinceBudget } from "./generator";
import { analyzeStarts, GENERATION_INPUT_LABELS, pendingGenerationGroups, rulesetNotice, searchProvinces,
  type AnalysisMode, type ProvinceReference } from "./workbench";

export function GenerationPlanSummary({ project, onReview }: { project: MapProject; onReview: () => void }) {
  const budget = useMemo(() => previewProvinceBudget(project), [project]);
  const pending = pendingGenerationGroups(project);
  return <section className="generation-plan-summary" aria-label="Generation plan and province budget">
    <div className="scope-heading"><strong>Next generation</strong><span className="scope-badge">Plan only</span></div>
    <p role="status" aria-live="polite">{pending === undefined ? "No generation baseline recorded for this project. Existing geography is unchanged."
      : pending.length ? `Pending: ${pending.map(key => GENERATION_INPUT_LABELS[key]).join(", ")}.`
        : "Plan matches the last recorded generation. Manual map edits may still differ."}</p>
    <div className="budget-totals"><span><strong>{budget.core}</strong> core</span><span><strong>+ {budget.bonus}</strong> bonus</span><span><strong>{budget.total}</strong> planned</span></div>
    <details><summary>Province budget by plane</summary>
      <ul className="budget-planes">{budget.planes.map((row, i) => <li key={row.planeId}>
        <strong>{i + 1}. {row.name}: {row.current} → {row.target}</strong>
        <span>{row.core ? "Core" : "Bonus"}{row.reserved ? " · generated starts blocked" : ` · ${row.allocatedStarts} generated start${row.allocatedStarts === 1 ? "" : "s"}`}. {row.reason}.</span>
      </li>)}</ul>
      {budget.usesFallbackCore && <p>No core planes: bonus sizes reference Players × Provinces/player ({budget.referenceCore}), not a hidden core layer.</p>}
      <p>Generate sizes each plane and places its generated starts from this same plan. Counts are planned, not a spacing guarantee. Review generation-plan errors before generating. Water quotas and themed guardian coverage can also produce best-effort notices.</p>
    </details>
    <button type="button" className="button quiet wide" onClick={onReview} aria-haspopup="dialog">Review current starts</button>
  </section>;
}

export function ProvinceExplorer({ project, onSelect }: { project: MapProject; onSelect: (province: ProvinceReference) => void }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchProvinces(project, query), [project, query]);
  return <details className="province-explorer">
    <summary>Find a province</summary>
    <label className="field"><span>Name, plane, or province number <span className="scope-badge">Navigate only</span></span>
      <input type="search" maxLength={160} value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, #global or local number" />
    </label>
    <p role="status" aria-live="polite">{query.trim() ? `${matches.total} matches${matches.total > matches.results.length ? `; showing the first ${matches.results.length}` : ""}.` : "Search across every plane. Numbers match global or local province IDs."}</p>
    <ul>{matches.results.map(ref => <li key={ref.key}><button type="button" onClick={() => onSelect(ref)}>
      <strong>{ref.province.name}</strong><span>Global #{ref.globalNumber} · Plane {ref.planeNumber}: {ref.planeName} · Local #{ref.province.index}</span>
    </button></li>)}</ul>
  </details>;
}

const metricEntries = (fairness: FairnessMetrics): [string, number][] => [
  ["Spacing", fairness.startSeparation], ["Expansion proxy", fairness.expansionParity], ["Throne locations", fairness.throneAccess],
  ["Start exits", fairness.startDegree], ["Terrain variety", fairness.terrainVariety], ["Connectivity", fairness.connectivity], ["Allocation", fairness.startAllocation],
];

export function StartBalancePanel({ project, fairness, errors, catalogVersion, onContextChange, onInspect }: {
  project: MapProject; fairness: FairnessMetrics; errors: number; catalogVersion: string;
  onContextChange: (context: NonNullable<MapProject["analysisContext"]>) => void;
  onInspect: (province: ProvinceReference, keys: string[], mode: AnalysisMode) => void;
}) {
  const [mode, setMode] = useState<AnalysisMode>("structural");
  const report = useMemo(() => analyzeStarts(project, mode), [project, mode]);
  const weakMetrics = metricEntries(fairness).filter(([, value]) => value < 80);
  return <div className="balance-panel">
    <div className="analysis-status-grid">
      <div><span>Structural validity</span><strong>{errors ? `${errors} export blocker${errors === 1 ? "" : "s"}` : "No export blockers"}</strong></div>
      <div><span>Legacy structural score</span><strong>{fairness.overall}/100</strong><small>{weakMetrics.length ? `Review: ${weakMetrics.map(([label, value]) => `${label} ${value}`).join("; ")}` : "No low headline subscores"}</small></div>
      <div><span>Analysis confidence</span><strong>Limited / assumptions shown</strong><small>Not a nation, economy, or combat balance certificate</small></div>
    </div>
    <p>The legacy score uses population/farmland and graph-distance heuristics. A high average cannot override an export error or an individual weak region.</p>
    <details className="ruleset-context"><summary>Game patch, era and mod assumptions</summary>
      <p>These declarations travel with project JSON and the host report; nothing is auto-detected. They never apply nation bonuses. When population-matched defenders are enabled, changing the patch, era or mods rechecks which verified army templates can be exported.</p>
      <label className="field"><span>Declared game patch <span className="scope-badge">Current Map</span></span>
        <input maxLength={64} value={project.analysisContext?.gameVersion ?? ""} placeholder="Unknown / not declared" onChange={event => onContextChange({ ...project.analysisContext, gameVersion: event.target.value })} />
      </label>
      <label className="field"><span>Declared host game era <span className="scope-badge">Current Map</span></span>
        <select value={project.analysisContext?.era ?? ""} aria-describedby="analysis-era-help"
          onChange={event => onContextChange({ ...project.analysisContext, era: event.target.value ? Number(event.target.value) as GameEra : undefined })}>
          <option value="">Unknown / not declared</option>
          {([1, 2, 3] as const).map(era => <option key={era} value={era}>{GAME_ERA_LABELS[era]}</option>)}
        </select>
      </label>
      <p id="analysis-era-help">This does not configure the game host. Choose the same era in Dominions; restricted defender templates require a known, matching era.</p>
      <label className="field"><span>Mod names and versions <span className="scope-badge">Current Map</span></span>
        <textarea maxLength={4096} rows={2} value={project.analysisContext?.mods ?? ""} placeholder="None declared (not verified)" onChange={event => onContextChange({ ...project.analysisContext, mods: event.target.value })} />
      </label>
    </details>
    <p className="analysis-caution" role="status">{rulesetNotice(project, catalogVersion)}</p>
    <NationRequirementsPanel project={project} onChange={onContextChange} />
    <label className="field analysis-model"><span>Access model <span className="scope-badge">Analysis only</span></span>
      <select value={mode} onChange={event => setMode(event.target.value as AnalysisMode)}>
        <option value="structural">Potential connections (all terrain)</option>
        <option value="conservative">Conservative dry / water-separated routes</option>
      </select>
    </label>
    <p>{mode === "structural" ? "Includes land/water transitions, rivers and passes as potential graph connections. Gates count as one step."
      : "Dry starts stay on dry provinces; water starts stay underwater. Rivers, passes, mountain borders, and corresponding custom border bits are excluded conservatively. Gates must remain in the same medium."}
      {" "}Neither model simulates sailing, flight, seasonal scales, terrain movement costs, ownership, or conquest turns. Team-start labels are treated as alliances here; the host must configure the intended teams. The legacy score above is unchanged by this view.</p>
    {report.truncated && <p className="analysis-caution" role="alert">Showing only {report.starts.length} of {report.totalStarts} starts. Competition and overall spread are incomplete; reduce the start count for a complete comparison.</p>}
    {!report.starts.length ? <p>No generic, team, or nation-specific starts exist. Add starts or generate a map before comparing regions.</p> : <>
      {/* Keyboard users need a focus target to scroll this wide comparison without activating a row. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="analysis-table-wrap" tabIndex={0} role="region" aria-label="Start region comparison; scroll horizontally for all columns">
        <table className="analysis-table">
          <caption>{report.starts.length} starting regions · counts exclude every capital · distances are graph hops, not turns</caption>
          <thead><tr><th scope="col">Start / inspect region</th><th scope="col">Exits</th><th scope="col">2 / 3 steps</th><th scope="col">Exclusive / contested</th><th scope="col">Known population (2 steps)</th><th scope="col">Authored guards</th><th scope="col">Thrones (≤4 steps)</th><th scope="col">Nearest rival / throne / realm gate</th></tr></thead>
          <tbody>{report.starts.map(row => <tr key={row.key}>
            <th scope="row"><button type="button" onClick={() => onInspect(row, row.twoStepKeys, mode)}>
              {row.province.name}<small>Global #{row.globalNumber} · P{row.planeNumber} / local #{row.province.index}</small>
            </button><small>{row.planeName}{row.team !== undefined ? ` · Team group ${row.team}` : ""}{row.nations.length ? ` · Nation ${row.nations.join(", ")}` : ""}{row.blocked ? " · BLOCKED" : ""}</small></th>
            <td>{row.blocked ? "—" : row.exits}</td><td>{row.blocked ? "—" : `${row.twoStepKeys.length} / ${row.threeStepCount}`}</td>
            <td>{report.truncated || row.blocked ? "—" : <>{row.exclusive} / {row.contested}<small>{row.fractionalOpportunity?.toFixed(2)} fractional opportunity</small></>}</td>
            <td>{row.blocked ? "—" : <>{row.knownPopulation.toLocaleString("en-US")}<small>{row.unknownPopulationCount ? `+ ${row.unknownPopulationCount} unknown provinces` : "Population only; not income/resources"}</small></>}</td>
            <td>{row.guardianProvinceCount}<small>provinces; difficulty unknown</small></td>
            <td>{row.preferredThrones} preferred / {row.fixedThrones} fixed<small>Nearest preferred: {hop(row.nearestPreferredThrone)} · fixed: {hop(row.nearestFixedThrone)}</small></td>
            <td>{hop(row.nearestRival)} / {hop(row.nearestThrone)} / {hop(row.nearestRealmEntrance)}<small>Ally: {hop(row.nearestAlly)} · hostile frontier groups: {row.rivalRegionsAtFrontier ?? "—"} · shared direct surroundings: {row.sharedCapitalNeighbours}</small></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p>Exclusive means closer than every competing start in this model; contested includes ties and provinces a rival reaches sooner. It predicts neither ownership nor battle success. “—” means no reachable target, blocked start, or incomplete analysis.</p>
      <p>Fractional opportunity gives a full share for a distance lead, splits rival ties, and gives zero when a rival is closer. Allies do not compete; do not sum these as a team economy. Frontier exposure counts distinct hostile team/start regions touching the two-step neighbourhood, not individual gateway links. Shared surroundings include allies.</p>
      <p>Throne markers are planned locations, not confirmation of the engine’s final selection. Guardian counts cover authored groups only; random independents remain unknown. Resources, recruitment points, and actual income are not modeled.</p>
    </>}
    <details><summary>All legacy subscores and notes</summary><ul>{metricEntries(fairness).map(([label, value]) => <li key={label}>{label}: {value}/100</li>)}</ul><ul>{fairness.notes.map(note => <li key={note}>{note}</li>)}</ul></details>
    <small>Model: {report.modelVersion} · neutral diagnostics only · selector snapshot {catalogVersion}</small>
  </div>;
}

function hop(value?: number): string { return value === undefined ? "—" : String(value); }
