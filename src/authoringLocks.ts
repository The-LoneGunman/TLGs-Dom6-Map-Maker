import { clearAllPlayerStartFeatures, cloneProject, isBlockedProvince, isCaveProvince, isWaterProvince, type MapProject, type Province, type ProvinceLockGroup } from "./domain";
import { BUILTIN_DOM6_CATALOG, findCatalogEntry } from "./catalog";
import { usesConnectedRegions } from "./geometry";

export const PROVINCE_LOCK_GROUPS: readonly ProvinceLockGroup[] = ["name", "terrain", "economy", "sites", "guardians"];
export const LOCK_FIELDS: Record<ProvinceLockGroup, readonly (keyof Province)[]> = {
  name: ["name", "nameSource"],
  terrain: ["terrain", "terrainFlags", "freshwater", "biome", "small", "large", "warmer", "colder"],
  economy: ["population", "poptype", "unrest", "fort", "temple", "lab", "owner", "provinceDefense"],
  sites: ["manySites", "siteBias", "sites", "killRandomSites", "throne", "fixedThrone"],
  guardians: ["defenders", "battle", "rawDirectives"],
};

export function fieldIsLocked(province: Province, group: ProvinceLockGroup): boolean {
  return province.editorLocks?.includes(group) ?? false;
}

/** Start protection crosses gateways, whose matching native identifiers are bidirectional. */
export function protectedStartProvinceKeys(project: MapProject, depth: number): Set<string> {
  const starts = new Set(project.specificStarts.map(start => `${start.planeId}:${start.provinceId}`));
  for (const plane of project.planes) for (const province of plane.provinces) {
    if (province.start || province.teamStart !== undefined) starts.add(`${plane.id}:${province.id}`);
  }
  const protectedKeys = new Set(starts);
  const boundedDepth = Number.isFinite(depth) ? Math.max(0, Math.min(3, Math.floor(depth))) : 0;
  let frontier = starts;
  for (let step = 0; step < boundedDepth && frontier.size; step++) {
    const next = new Set<string>();
    for (const plane of project.planes) for (const edge of plane.edges) {
      if (frontier.has(`${plane.id}:${edge.a}`)) next.add(`${plane.id}:${edge.b}`);
      if (frontier.has(`${plane.id}:${edge.b}`)) next.add(`${plane.id}:${edge.a}`);
    }
    for (const gate of project.gates) if (gate.endpoints.some(endpoint => frontier.has(`${endpoint.planeId}:${endpoint.provinceId}`))) {
      for (const endpoint of gate.endpoints) next.add(`${endpoint.planeId}:${endpoint.provinceId}`);
    }
    frontier = new Set([...next].filter(key => !protectedKeys.has(key)));
    for (const key of next) protectedKeys.add(key);
  }
  return protectedKeys;
}

export function changedLockedGroups(previous: Province, next: Province): ProvinceLockGroup[] {
  return PROVINCE_LOCK_GROUPS.filter(group => fieldIsLocked(previous, group)
    && LOCK_FIELDS[group].some(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field])));
}

function layout(project: MapProject) {
  return JSON.stringify([project.planes.map(p => [p.id, p.kind, p.ownershipMode, p.landformStyle, p.landformWater, p.generationKey, p.width, p.height, p.wrapX, p.wrapY,
    p.provinces.map(v => [v.id, v.index, v.x, v.y, v.gridX, v.gridY]), p.edges,
    ...(usesConnectedRegions(p) ? [{ topology: "connected-regions" }] : [])]), project.gates]);
}
function starts(project: MapProject) {
  return JSON.stringify([project.specificStarts, project.planes.map(p => [p.id,
    p.provinces.filter(v => v.start || v.teamStart !== undefined).map(v => [v.id, v.start, v.startType, v.teamStart, v.noStart])])]);
}

/** Explicitly unlocking in the same edit is allowed; old safeguards are never silently ignored. */
export function assertProjectLocks(previous: MapProject, next: MapProject): void {
  if (previous.authoring?.lockLayout && next.authoring?.lockLayout && layout(previous) !== layout(next)) {
    throw new Error("Layout is locked. Unlock it before changing planes, geometry, borders, gateways, wrapping, or resolution; content-only edits remain available.");
  }
  if (previous.authoring?.lockStarts && next.authoring?.lockStarts && starts(previous) !== starts(next)) {
    throw new Error("Starts are locked. Unlock them before changing generic, team, or nation-specific starts.");
  }
}

export function assertCanRebuildLayout(project: MapProject): void {
  if (project.authoring?.lockLayout && project.planes.some(p => p.provinces.length)) {
    throw new Error("Layout is locked. Use a content-only reroll or unlock layout before generating new geography.");
  }
}

/** Reapply locked fields to matching stable IDs; disappearing locked provinces are an error. */
export function restoreGenerationLocks(previous: MapProject, next: MapProject): void {
  for (const plane of previous.planes) {
    const generated = next.planes.find(p => p.id === plane.id);
    for (const province of plane.provinces) {
      if (!province.editorLocks?.length) continue;
      const target = generated?.provinces.find(p => p.id === province.id);
      if (!target) throw new Error(`Locked province ${plane.name} #${province.index} would be removed or receive a new identity. Keep its seed, plane and size, use a content-only reroll, or unlock it before generating new geography.`);
      if (fieldIsLocked(province, "terrain") && (isWaterProvince(province) !== isWaterProvince(target)
        || isCaveProvince(province) !== isCaveProvince(target) || isBlockedProvince(province) !== isBlockedProvince(target))) {
        throw new Error(`Terrain lock at ${plane.name} #${province.index} conflicts with regenerated land/water/cave geography. Use a content-only reroll or unlock the province.`);
      }
      target.editorLocks = [...province.editorLocks];
      for (const group of province.editorLocks) for (const field of LOCK_FIELDS[group]) {
        if (province[field] === undefined) delete target[field];
        else Object.assign(target, { [field]: structuredClone(province[field]) });
      }
    }
  }
  assertProjectLocks(previous, next);
  if (!previous.planes.some(p => p.provinces.some(v => v.editorLocks?.length))) return;
  const cleaned = cloneProject(next);
  clearAllPlayerStartFeatures(cleaned);
  const protectedSites = protectedStartProvinceKeys(next, 1);
  const protectedGuardians = protectedStartProvinceKeys(next, 2);
  for (const plane of next.planes) {
    for (const p of plane.provinces) if (p.editorLocks?.length) {
      const safe = cleaned.planes.find(v => v.id === plane.id)!.provinces.find(v => v.id === p.id)!;
      for (const group of p.editorLocks) for (const key of LOCK_FIELDS[group]) {
        if (JSON.stringify(p[key]) !== JSON.stringify(safe[key])) throw new Error(`Locked ${group} at ${plane.name} #${p.index} conflicts with capital safety. Unlock it or keep the original starts.`);
      }
      const key = `${plane.id}:${p.id}`;
      const rawGuardians = p.rawDirectives.split(/\r\n?|\n/).some(line => /^\s*#(?:commander|comname|bodyguards|units|xp|randomequip|additem|clearmagic|mag_[a-z_]+)\b/i.test(line));
      const placedThrone = p.sites.some(site => findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, site.value)?.tags?.includes("throne"));
      if ((protectedGuardians.has(key) && (p.defenders.length || rawGuardians))
        || (protectedSites.has(key) && (p.throne === "preferred" || p.throne === "fixed" || placedThrone))) {
        throw new Error(`Locked content at ${plane.name} #${p.index} conflicts with a protected start zone.`);
      }
    }
  }
}

/** Regions are selections, not ownership; an explicit rebuild/removal may remove their members. */
export function pruneAuthoringRegions(project: MapProject): void {
  if (!project.authoring?.regions) return;
  project.authoring.regions = project.authoring.regions.flatMap(region => {
    const plane = project.planes.find(p => p.id === region.planeId);
    if (!plane) return [];
    const ids = new Set(plane.provinces.map(p => p.id));
    const provinceIds = region.provinceIds.filter(id => ids.has(id));
    return provinceIds.length ? [{ ...region, provinceIds }] : [];
  });
}

export function copyFieldGroup(source: Province, target: Province, group: ProvinceLockGroup): void {
  for (const field of LOCK_FIELDS[group]) {
    if (source[field] === undefined) delete target[field];
    else Object.assign(target, { [field]: structuredClone(source[field]) });
  }
}

export function snapshotWithLocks(project: MapProject, planeId: string, ids: readonly string[], groups: readonly ProvinceLockGroup[], enabled: boolean): MapProject {
  const source = project.planes.find(p => p.id === planeId);
  if (!source) throw new Error("The selected plane no longer exists.");
  if (!ids.length || ids.length > 800 || new Set(ids).size !== ids.length || ids.some(id => !source.provinces.some(p => p.id === id))) {
    throw new Error("The selected provinces changed. Select between 1 and 800 existing provinces before changing locks.");
  }
  if (!groups.length || groups.length > PROVINCE_LOCK_GROUPS.length || new Set(groups).size !== groups.length
    || groups.some(group => !PROVINCE_LOCK_GROUPS.includes(group))) {
    throw new Error("Select one or more distinct, supported field-lock groups.");
  }
  const next = cloneProject(project);
  const plane = next.planes.find(p => p.id === planeId);
  if (!plane) throw new Error("The selected plane no longer exists.");
  const selected = new Set(ids);
  for (const p of plane.provinces) if (selected.has(p.id)) {
    const locks = new Set(p.editorLocks ?? []);
    for (const group of groups) { if (enabled) locks.add(group); else locks.delete(group); }
    p.editorLocks = PROVINCE_LOCK_GROUPS.filter(group => locks.has(group));
    if (!p.editorLocks.length) delete p.editorLocks;
  }
  return next;
}
