"use client";

import { useMemo } from "react";
import { findCatalogEntry, type Dom6CatalogBundle } from "./catalog";
import { GAME_ERA_LABELS, type GameEra, type MapProject } from "./domain";
import {
  buildInitialDefensePlan,
  type InitialDefenseReason,
  type PopulationDefensePolicy,
  type VerifiedPopulationDefenseProfile,
} from "./populationDefenders";
import { POPULATION_DEFENSE_PROFILE_REVISION, VERIFIED_POPULATION_DEFENSE_PROFILES } from "./populationDefenseProfiles";

/** Toggling never silently upgrades the templates pinned in a saved project. */
export function populationDefensePolicyForToggle(
  policy: PopulationDefensePolicy | undefined,
  enabled: boolean,
): PopulationDefensePolicy {
  return { enabled, profileRevision: policy?.profileRevision ?? POPULATION_DEFENSE_PROFILE_REVISION };
}

export interface PopulationDefensePanelProps {
  project: MapProject;
  catalog: Dom6CatalogBundle;
  busy?: boolean;
  onPolicyChange: (policy: PopulationDefensePolicy) => void;
  onContextChange: (context: NonNullable<MapProject["analysisContext"]>) => void;
  onOpenAssumptions?: () => void;
  /** Explicit data injection also keeps the UI's coverage tests independent of the live registry. */
  profiles?: readonly VerifiedPopulationDefenseProfile[];
}

export function PopulationDefensePanel({
  project, catalog, busy = false, onPolicyChange, onContextChange, onOpenAssumptions,
  profiles = VERIFIED_POPULATION_DEFENSE_PROFILES,
}: PopulationDefensePanelProps) {
  const policy = project.populationDefense;
  const enabled = policy?.enabled ?? false;
  const revision = policy?.profileRevision ?? POPULATION_DEFENSE_PROFILE_REVISION;
  // When off, coverage is an explicitly labelled preview, not an applied army.
  const plan = useMemo(() => buildInitialDefensePlan(project, catalog,
    { enabled: true, profileRevision: revision }, profiles), [project, catalog, revision, profiles]);
  const currentProfiles = profiles.filter(profile => profile.revision === revision);
  const verifiedPopulationCount = new Set(currentProfiles.map(profile => profile.poptype.id)).size;
  const currentRevisionAvailable = profiles.some(profile => profile.revision === POPULATION_DEFENSE_PROFILE_REVISION);
  const potential = plan.counts.derived + plan.counts.unsupported;
  const skipped = new Map<InitialDefenseReason, { count: number; message: string }>();
  for (const entry of plan.entries.values()) {
    if (entry.status !== "excluded" && entry.status !== "unsupported") continue;
    const previous = skipped.get(entry.reason);
    skipped.set(entry.reason, { count: (previous?.count ?? 0) + 1, message: entry.message });
  }

  return <section className="iteration-panel" aria-labelledby="population-defense-heading">
    <div className="scope-heading"><h3 id="population-defense-heading">Ordinary initial defenders</h3><span className="scope-badge">Current Map</span></div>
    <label className="iteration-check">
      <input type="checkbox" checked={enabled} disabled={busy || (!enabled && verifiedPopulationCount === 0)}
        aria-describedby="population-defense-help population-defense-coverage"
        onChange={event => onPolicyChange(populationDefensePolicyForToggle(policy, event.target.checked))} />
      <span>Match ordinary defenders to recruitment population</span>
    </label>
    <p id="population-defense-help">Off by default. When enabled, verified templates replace ordinary initial armies at export. Manual and generated population-type edits take effect immediately, without a reroll or Generate. Existing custom guardians are always preserved; starts and their directly connected neighbours are excluded from automatic defenders.</p>
    <p>This changes initial defenders, not persistent province defence (PD). Template troop counts are fixed: they do not reproduce the game’s independent-strength formula and are not a combat-balance guarantee.</p>

    <label className="field"><span>Declared host game patch <span className="scope-badge">Current Map / export check</span></span>
      <input maxLength={64} value={project.analysisContext?.gameVersion ?? ""} disabled={busy}
        placeholder="For example, 6.37" aria-describedby="population-defense-version-help"
        onChange={event => onContextChange({ ...project.analysisContext, gameVersion: event.target.value })} />
    </label>
    <p id="population-defense-version-help">The patch must exactly match a verified template. It is not auto-detected, and the map’s minimum <code>#domversion</code> is not this declaration. Patch, era, mod, catalog or terrain mismatches leave native armies unchanged.</p>
    <label className="field"><span>Declared host game era <span className="scope-badge">Current Map / export check</span></span>
      <select value={project.analysisContext?.era ?? ""} disabled={busy} aria-describedby="population-defense-era-help"
        onChange={event => onContextChange({ ...project.analysisContext, era: event.target.value ? Number(event.target.value) as GameEra : undefined })}>
        <option value="">Unknown / not declared</option>
        {([1, 2, 3] as const).map(era => <option key={era} value={era}>{GAME_ERA_LABELS[era]}</option>)}
      </select>
    </label>
    <p id="population-defense-era-help">Era-restricted templates require an explicit matching era. This declaration is not inferred from nations and does not configure the game host; choose the same era in Dominions.</p>
    <p>Declared mods: {project.analysisContext?.mods?.trim() || "none declared (not auto-detected)"}.</p>
    {onOpenAssumptions && <button type="button" className="button quiet wide" disabled={busy} aria-haspopup="dialog" onClick={onOpenAssumptions}>Review patch, era and mod assumptions</button>}

    <p id="population-defense-coverage" role="status" aria-live="polite" aria-atomic="true">
      {enabled ? `On: ${plan.counts.derived} ordinary province${plan.counts.derived === 1 ? "" : "s"} will use population-matched initial defenders.`
        : `Off: no automatic defenders are applied. Coverage preview: ${plan.counts.derived} ordinary province${plan.counts.derived === 1 ? "" : "s"} would match if enabled.`}
      {` Verified coverage for this map: ${plan.counts.derived} of ${potential} otherwise eligible province${potential === 1 ? "" : "s"}. ${plan.counts.custom} custom-guardian province${plan.counts.custom === 1 ? "" : "s"} preserved; ${plan.counts.excluded} excluded.`}
    </p>
    {plan.counts.unsupported > 0 && <p className="warning-copy">{plan.counts.unsupported} otherwise eligible province{plan.counts.unsupported === 1 ? " is" : "s are"} unsupported for the saved revision and declared context. Native initial armies are retained and may not match the assigned recruitment population.</p>}
    {verifiedPopulationCount === 0 && <p className="warning-copy">Verification pending: no verified population templates are available for this revision. Activation is unavailable until verified data exists; an imported enabled policy can still be turned off. Ordinary native defenders remain unchanged; complete population coverage is not claimed.</p>}
    <p>Pinned template revision: {revision}. Available verified population types in this revision: {verifiedPopulationCount}.</p>
    {revision !== POPULATION_DEFENSE_PROFILE_REVISION && <>
      <p className="warning-copy">This project pins a different template revision. It is not upgraded automatically. Choosing the current revision can change which ordinary armies are exported.</p>
      <button type="button" className="button quiet wide" disabled={busy || !currentRevisionAvailable} onClick={() => onPolicyChange({ enabled, profileRevision: POPULATION_DEFENSE_PROFILE_REVISION })}>Use current verified profiles</button>
    </>}
    {!!skipped.size && <details><summary>Why provinces are excluded or unsupported</summary>
      {[...skipped].map(([reason, row]) => <p key={reason}><strong>{row.count}:</strong> {row.message}</p>)}
    </details>}
    {currentProfiles.length > 0 && <details><summary>Verified template scope</summary>
      {currentProfiles.map(profile => <p key={`${profile.revision}:${profile.poptype.id}:${profile.gameVersion}:${profile.mods}`}>
        <strong>#{profile.poptype.id} {profile.poptype.name}</strong>: patch {profile.gameVersion}; {profile.allowedEras ? profile.allowedEras.map(era => `${GAME_ERA_LABELS[era]} (${era})`).join(" / ") : "no era restriction declared"}; {profile.mods || "no declared mods"}; {profile.allowedMedia.join(" / ")}; {profile.caveRule === "any" ? "cave or non-cave terrain" : profile.caveRule === "required" ? "cave terrain required" : "non-cave terrain only"}. {profile.source.verification}
      </p>)}
    </details>}
  </section>;
}

/** Read-only derived armies stay distinct from the province's editable guardian groups. */
export function PopulationDefenseProvinceStatus({ project, catalog, planeId, provinceId, onConfigure,
  profiles = VERIFIED_POPULATION_DEFENSE_PROFILES,
}: {
  project: MapProject; catalog: Dom6CatalogBundle; planeId: string; provinceId: string;
  onConfigure?: () => void; profiles?: readonly VerifiedPopulationDefenseProfile[];
}) {
  const plan = useMemo(() => buildInitialDefensePlan(project, catalog, project.populationDefense, profiles), [project, catalog, profiles]);
  const entry = plan.entries.get(`${planeId}:${provinceId}`);
  if (!entry) return null;
  const title = entry.status === "derived" ? "Automatic population template"
    : entry.status === "custom" ? "Custom guardians preserved"
      : entry.status === "unsupported" ? "Population template unsupported" : "No automatic population army";
  const unitLabel = (id: string) => {
    const unit = findCatalogEntry(catalog.units, id);
    return unit ? `${unit.name} (#${unit.id})` : `Unit #${id}`;
  };
  return <section className="iteration-panel" aria-label="Selected province initial defenders">
    <div className="scope-heading"><h3>Initial-defender preview</h3><span className="scope-badge">Current Map</span></div>
    <p role="status" aria-live="polite"><strong>{title}.</strong> {entry.message}</p>
    {entry.status === "derived" && <>
      <p>Read-only export result, not an editable custom guardian group. Changing this province’s population type rechecks the template immediately; adding custom guardians overrides it.</p>
      {entry.groups.map((group, index) => <div key={index} className="defense-card">
        <p><strong>Commander: {unitLabel(group.commander)}</strong></p>
        {group.squads.map(squad => <p key={squad.id}>{squad.count} × {unitLabel(squad.unit)}</p>)}
      </div>)}
      <p>Fixed template counts, not the game’s independent-strength formula or persistent PD. Verified for patch {entry.profile?.gameVersion}; {entry.profile?.allowedEras ? entry.profile.allowedEras.map(era => `${GAME_ERA_LABELS[era]} (${era})`).join(" / ") : "no era restriction declared"}; revision {entry.profile?.revision}.</p>
    </>}
    {entry.status === "custom" && <p>Existing editable guardian groups take priority over automatic population templates and are never replaced by this option.</p>}
    {entry.status === "unsupported" && <p>Native initial armies are retained. They may not match this province’s assigned recruitment population.</p>}
    {onConfigure && <button type="button" className="button quiet wide" onClick={onConfigure}>Configure population-matched defenders</button>}
  </section>;
}
