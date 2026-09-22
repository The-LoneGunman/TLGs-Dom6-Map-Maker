import {
  effectiveProvinceTerrainFlags,
  setNationSpecificStart,
  type GateEndpoint,
  type MapProject,
  type TerrainFlag,
  type TerrainKey,
} from "./domain";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "./catalog";
import { clearBlockedTerrainContent } from "./terrainSafety";

export interface AtlasReplacementImpact {
  planeCount: number;
  provinceCount: number;
  gatewayCount: number;
}

export interface PlaneRemovalImpact {
  planeName: string;
  provinceCount: number;
  gatewayCount: number;
  specificStartCount: number;
}

/**
 * Atlas does not currently retain provenance for every terrain, border, and
 * province-editor change. Treat every populated atlas as potentially authored
 * so Generate can never silently discard work that merely looks generated.
 */
export function atlasReplacementImpact(project: MapProject): AtlasReplacementImpact {
  return {
    planeCount: project.planes.length,
    provinceCount: project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0),
    gatewayCount: project.gates.length,
  };
}

export function atlasReplacementNeedsConfirmation(impact: AtlasReplacementImpact): boolean {
  return impact.provinceCount > 0 || impact.gatewayCount > 0;
}

export function planeRemovalImpact(project: MapProject, planeId: string): PlaneRemovalImpact | undefined {
  const plane = project.planes.find((item) => item.id === planeId);
  if (!plane) return undefined;
  return {
    planeName: plane.name,
    provinceCount: plane.provinces.length,
    gatewayCount: project.gates.filter((gate) => gate.endpoints.some((endpoint) => endpoint.planeId === planeId)).length,
    specificStartCount: project.specificStarts.filter((start) => start.planeId === planeId).length,
  };
}

export function appendHistorySnapshot<T>(stack: T[], snapshot: T, limit = 30): T[] {
  return [...stack.slice(-Math.max(0, limit - 1)), snapshot];
}

/** Plane JSON of the most recent draft, so the next edit need not re-encode it. */
let lastPlaneTexts: { project: MapProject; texts: string[] } | undefined;

/**
 * Structural sharing for editor history. After an edit recipe ran on a full
 * clone of `previous`, keep `previous`'s plane objects wherever the edit left
 * a plane's JSON unchanged, so Undo snapshots and the new project share them
 * instead of each holding a copy. Only for projects that are never mutated in
 * place after being committed.
 */
export function shareUnchangedPlanes(previous: MapProject, draft: MapProject): MapProject {
  const previousTexts = lastPlaneTexts?.project === previous ? lastPlaneTexts.texts : previous.planes.map((plane) => JSON.stringify(plane));
  const texts = draft.planes.map((plane, index) => {
    const text = JSON.stringify(plane);
    const before = previous.planes[index];
    if (before && text === previousTexts[index]) draft.planes[index] = before;
    return text;
  });
  lastPlaneTexts = { project: draft, texts };
  return draft;
}

/**
 * Typing in one field is one Undo step. A commit dispatched by the field that
 * started the current session joins it; any other commit (a different field,
 * a button, Generate, an import) records its own step and ends the session.
 */
export function textEditHistoryStep<T>(session: T | undefined, changeTarget: T | undefined): { record: boolean; session: T | undefined } {
  return { record: changeTarget === undefined || session !== changeTarget, session: changeTarget };
}

/**
 * Apply the province inspector's primary-terrain choice as one project edit.
 * Cave walls are impassable map space, so they cannot safely retain any kind
 * of capital marker, throne, or independent guardian group.
 */
export function applyPrimaryTerrain(
  project: MapProject,
  planeId: string,
  provinceId: string,
  terrain: TerrainKey,
  catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
): boolean {
  const province = project.planes
    .find((plane) => plane.id === planeId)
    ?.provinces.find((item) => item.id === provinceId);
  if (!province) return false;

  province.terrain = terrain;
  const inherentFlags = effectiveProvinceTerrainFlags({ terrain, terrainFlags: undefined, freshwater: false });
  province.terrainFlags = province.terrainFlags?.filter((flag) => !inherentFlags.has(flag));
  if (!province.terrainFlags?.length) province.terrainFlags = undefined;

  if (effectiveProvinceTerrainFlags(province).has("cavewall")) {
    clearBlockedTerrainContent(province, catalog);
    setNationSpecificStart(project, planeId, provinceId, undefined);
  }
  return true;
}

/** Apply an additive flag with the same project-wide wall cleanup as the primary preset. */
export function applyAdditionalTerrainFlag(
  project: MapProject,
  planeId: string,
  provinceId: string,
  flag: TerrainFlag,
  enabled: boolean,
  catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
): boolean {
  const province = project.planes.find(plane => plane.id === planeId)?.provinces.find(item => item.id === provinceId);
  if (!province) return false;

  const inherentFlags = effectiveProvinceTerrainFlags({ terrain: province.terrain, terrainFlags: undefined, freshwater: false });
  if (!enabled && inherentFlags.has(flag)) {
    // Batch edits may remove a preset's inherent flag; preserve every other effective bit.
    const flags = new Set(effectiveProvinceTerrainFlags(province));
    flags.delete(flag);
    province.terrain = "plains";
    province.terrainFlags = [...flags];
    province.freshwater = false;
  } else {
    province.terrainFlags = enabled
      ? [...new Set([...(province.terrainFlags ?? []), flag])]
      : province.terrainFlags?.filter(entry => entry !== flag);
    if (!enabled && flag === "freshwater") province.freshwater = false;
  }
  if (!province.terrainFlags?.length) province.terrainFlags = undefined;
  if (effectiveProvinceTerrainFlags(province).has("cavewall")) {
    clearBlockedTerrainContent(province, catalog);
    setNationSpecificStart(project, planeId, provinceId, undefined);
  }
  return true;
}

export function armedEndpointCopy(
  project: MapProject,
  mode: "link" | "gate",
  endpoint: GateEndpoint,
  activePlaneId: string,
): string {
  const planeIndex = project.planes.findIndex((plane) => plane.id === endpoint.planeId);
  const plane = project.planes[planeIndex];
  const province = plane?.provinces.find((item) => item.id === endpoint.provinceId);
  if (!plane || !province) return `${mode === "link" ? "Link" : "Gate"} source is no longer available.`;
  const location = `Plane ${planeIndex + 1} · ${plane.name}, province #${province.index}`;
  if (mode === "gate") {
    return `Gate source: ${location}. Choose any other province, on this plane or another plane.`;
  }
  if (endpoint.planeId !== activePlaneId) {
    return `Link source: ${location}. Return there for a shared-border destination, or click a province on this plane to replace the source.`;
  }
  return `Link source: ${location}. Choose a shared-border destination on this plane.`;
}
