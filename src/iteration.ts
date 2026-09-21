import { cloneProject, effectiveProvinceTerrainFlags, isBlockedProvince, isWaterProvince, type MagicPath, type MapProject, type Province, type ProvinceLockGroup, type TerrainFlag, type TerrainKey, type ValidationIssue } from "./domain";
import { assertProjectLocks, changedLockedGroups, copyFieldGroup, fieldIsLocked, protectedStartProvinceKeys } from "./authoringLocks";
import { validateProject } from "./dom6";
import { serializeProject } from "./export";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "./catalog";
import { rerollPlaneDetails } from "./generator";
import { regenerateGeneratedProvinceNames } from "./naming";
import { applyPrimaryTerrain } from "./uiWorkflow";

export interface ProvinceSelection {
  planeId: string;
  terrain?: TerrainKey;
  flag?: TerrainFlag;
  role?: "all" | "neutral" | "starts" | "guardians" | "water" | "dry";
  query?: string;
  regionId?: string;
}
export type BatchEdit =
  | { kind: "terrain"; terrain: TerrainKey }
  | { kind: "flag"; flag: TerrainFlag; enabled: boolean }
  | { kind: "population"; value: number }
  | { kind: "poptype"; value: number }
  | { kind: "manySites"; enabled: boolean }
  | { kind: "climate"; value: "normal" | "warmer" | "colder" }
  | { kind: "siteBias"; path: MagicPath; enabled: boolean }
  | { kind: "clearGuardians" };
export type ContentReroll = "name" | "economy" | "sites" | "guardians";
export interface EditPreview {
  source: MapProject;
  project: MapProject;
  matched: number;
  changed: number;
  locked: number;
  protected: number;
  errors: ValidationIssue[];
  samples: string[];
}

export function selectProvinces(project: MapProject, selection: ProvinceSelection): Province[] {
  const plane = project.planes.find(p => p.id === selection.planeId);
  if (!plane) return [];
  const starts = new Set(project.specificStarts.filter(s => s.planeId === plane.id).map(s => s.provinceId));
  const region = selection.regionId ? project.authoring?.regions?.find(r => r.id === selection.regionId && r.planeId === plane.id) : undefined;
  if (selection.regionId && !region) return [];
  const regionIds = region ? new Set(region.provinceIds) : undefined;
  const words = (selection.query ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return plane.provinces.filter(p => {
    const start = p.start || p.teamStart !== undefined || starts.has(p.id);
    return (!selection.terrain || p.terrain === selection.terrain)
      && (!selection.flag || effectiveProvinceTerrainFlags(p).has(selection.flag))
      && (!regionIds || regionIds.has(p.id))
      && words.every(word => /^#?\d+$/.test(word) ? p.index === Number(word.replace("#", "")) : p.name.toLocaleLowerCase().includes(word))
      && (selection.role === "starts" ? start : selection.role === "neutral" ? !start
        : selection.role === "guardians" ? p.defenders.length > 0 : selection.role === "water" ? isWaterProvince(p)
          : selection.role === "dry" ? !isWaterProvince(p) && !isBlockedProvince(p) : true);
  });
}

export function protectedProvinceKeys(project: MapProject, includeNeighbors: boolean | number = true): Set<string> {
  return protectedStartProvinceKeys(project, typeof includeNeighbors === "number" ? includeNeighbors : includeNeighbors ? 1 : 0);
}

export function newBlockingIssues(before: MapProject, after: MapProject, catalog = BUILTIN_DOM6_CATALOG): ValidationIssue[] {
  const signature = (issue: ValidationIssue) => JSON.stringify([issue.planeId, issue.provinceId, issue.message]);
  // Validation messages contain display names. Compare using current labels so a
  // name reroll does not incorrectly turn an unchanged pre-existing error into a new blocker.
  const prior = structuredClone(before);
  for (const plane of prior.planes) {
    const current = after.planes.find(p => p.id === plane.id);
    if (!current) continue;
    plane.name = current.name;
    for (const province of plane.provinces) {
      const renamed = current.provinces.find(p => p.id === province.id);
      if (renamed) province.name = renamed.name;
    }
  }
  const old = new Map<string, number>();
  for (const issue of validateProject(prior, catalog).filter(i => i.severity === "error")) {
    const key = signature(issue);
    old.set(key, (old.get(key) ?? 0) + 1);
  }
  return validateProject(after, catalog).filter(issue => {
    if (issue.severity !== "error") return false;
    const key = signature(issue), previousCount = old.get(key) ?? 0;
    if (!previousCount) return true;
    old.set(key, previousCount - 1);
    return false;
  });
}

function finish(preview: EditPreview, catalog: Dom6CatalogBundle): EditPreview {
  assertProjectLocks(preview.source, preview.project);
  serializeProject(preview.project);
  preview.errors = newBlockingIssues(preview.source, preview.project, catalog);
  return preview;
}
function selectionIds(project: MapProject, planeId: string, ids: readonly string[]) {
  const plane = project.planes.find(p => p.id === planeId);
  if (!plane || !ids.length || ids.length > 800) throw new Error("Select between 1 and 800 provinces on an existing plane.");
  const selected = new Set(ids);
  if (selected.size !== ids.length || ids.some(id => !plane.provinces.some(p => p.id === id))) throw new Error("The selected provinces changed. Refresh the selection before editing.");
  return selected;
}
function blankPreview(source: MapProject, matched: number): EditPreview {
  return { source, project: cloneProject(source), matched, changed: 0, locked: 0, protected: 0, errors: [], samples: [] };
}

export function previewBatchEdit(project: MapProject, planeId: string, ids: readonly string[], edit: BatchEdit, catalog = BUILTIN_DOM6_CATALOG): EditPreview {
  const selected = selectionIds(project, planeId, ids);
  if ((edit.kind === "population" || edit.kind === "poptype") && (!Number.isSafeInteger(edit.value) || edit.value < 0 || edit.value > (edit.kind === "population" ? 50000 : 1000000))) throw new Error("Enter a valid whole-number population or population-type ID.");
  const result = blankPreview(project, ids.length);
  const group: ProvinceLockGroup = edit.kind === "population" || edit.kind === "poptype" ? "economy"
    : edit.kind === "manySites" || edit.kind === "siteBias" ? "sites" : edit.kind === "clearGuardians" ? "guardians" : "terrain";
  const protectedKeys = protectedProvinceKeys(project, group === "sites");
  const plane = result.project.planes.find(p => p.id === planeId)!;
  for (const province of plane.provinces) if (selected.has(province.id)) {
    if (fieldIsLocked(province, group)) { result.locked++; continue; }
    if (edit.kind !== "clearGuardians" && protectedKeys.has(`${planeId}:${province.id}`)) { result.protected++; continue; }
    const original = structuredClone(province);
    const before = JSON.stringify(province);
    if (edit.kind === "terrain") applyPrimaryTerrain(result.project, planeId, province.id, edit.terrain);
    else if (edit.kind === "flag") {
      // Materialize the complete mask so removing an inherent preset flag really removes it.
      const flags = new Set(effectiveProvinceTerrainFlags(province));
      if (edit.enabled) flags.add(edit.flag); else flags.delete(edit.flag);
      if (flags.has("cavewall")) applyPrimaryTerrain(result.project, planeId, province.id, "cavewall");
      province.terrain = "plains"; province.terrainFlags = [...flags]; province.freshwater = false;
    } else if (edit.kind === "population") province.population = edit.value;
    else if (edit.kind === "poptype") province.poptype = edit.value;
    else if (edit.kind === "manySites") province.manySites = edit.enabled;
    else if (edit.kind === "climate") { province.warmer = edit.value === "warmer"; province.colder = edit.value === "colder"; }
    else if (edit.kind === "siteBias") province.siteBias = edit.enabled ? [...new Set([...province.siteBias, edit.path])] : province.siteBias.filter(p => p !== edit.path);
    else province.defenders = [];
    if (changedLockedGroups(original, province).length) {
      // Terrain-to-wall cleanup also touches guardians and thrones. An edit must
      // not evade those groups' locks simply because its primary group is terrain.
      for (const key of Object.keys(province) as (keyof Province)[]) delete province[key];
      Object.assign(province, original);
      result.locked++;
      continue;
    }
    if (JSON.stringify(province) !== before) { result.changed++; if (result.samples.length < 8) result.samples.push(`#${province.index} ${province.name}`); }
  }
  return finish(result, catalog);
}

export function previewContentReroll(project: MapProject, planeId: string, ids: readonly string[], kind: ContentReroll, seed: string, catalog = BUILTIN_DOM6_CATALOG): EditPreview {
  if (!seed.trim() || seed.length > 256) throw new Error("A content seed must contain 1–256 characters.");
  const selected = selectionIds(project, planeId, ids);
  const result = blankPreview(project, ids.length);
  const protectedKeys = protectedProvinceKeys(project, kind === "guardians" ? 2 : 1);
  const target = result.project.planes.find(p => p.id === planeId)!;
  if (kind === "name") {
    const sources = new Map<string, Province["nameSource"]>();
    for (const plane of result.project.planes) for (const p of plane.provinces) {
      sources.set(`${plane.id}:${p.id}`, p.nameSource);
      if (plane.id !== planeId || !selected.has(p.id)) p.nameSource = "authored";
    }
    regenerateGeneratedProvinceNames(result.project.planes, `${project.seed}:scoped:${seed}`, 0);
    for (const plane of result.project.planes) for (const p of plane.provinces) {
      const source = sources.get(`${plane.id}:${p.id}`);
      if (source === undefined) delete p.nameSource; else p.nameSource = source;
    }
  } else {
    const generated = rerollPlaneDetails(target, `${project.seed}:scoped:${seed}`, project);
    for (const p of target.provinces) if (selected.has(p.id)) {
      if (fieldIsLocked(p, kind) || protectedKeys.has(`${planeId}:${p.id}`) || isBlockedProvince(p)) continue;
      const source = generated.provinces.find(v => v.id === p.id)!;
      copyFieldGroup(source, p, kind);
    }
  }
  const before = project.planes.find(p => p.id === planeId)!;
  for (const p of target.provinces) if (selected.has(p.id)) {
    if (fieldIsLocked(p, kind) || (kind === "name" && p.nameSource !== "generated")) result.locked++;
    else if (kind !== "name" && (protectedKeys.has(`${planeId}:${p.id}`) || isBlockedProvince(p))) result.protected++;
    else if (JSON.stringify(p) !== JSON.stringify(before.provinces.find(v => v.id === p.id))) { result.changed++; if (result.samples.length < 8) result.samples.push(`#${p.index} ${p.name}`); }
  }
  return finish(result, catalog);
}

export function addAuthoredRegion(project: MapProject, planeId: string, ids: readonly string[], name: string): MapProject {
  selectionIds(project, planeId, ids);
  if (!name.trim() || name.length > 80) throw new Error("Enter a region name of 1–80 characters.");
  const next = cloneProject(project);
  next.authoring ??= {};
  next.authoring.regions ??= [];
  if (next.authoring.regions.length >= 64) throw new Error("This atlas already has 64 named regions.");
  let number = 1;
  while (next.authoring.regions.some(r => r.id === `region-${number}`)) number++;
  next.authoring.regions.push({ id: `region-${number}`, name: name.trim(), planeId, provinceIds: [...ids] });
  return next;
}
