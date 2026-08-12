import {
  effectiveProvinceTerrainFlags,
  setNationSpecificStart,
  type GateEndpoint,
  type MapProject,
  type TerrainKey,
} from "./domain";

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
): boolean {
  const province = project.planes
    .find((plane) => plane.id === planeId)
    ?.provinces.find((item) => item.id === provinceId);
  if (!province) return false;

  province.terrain = terrain;
  const inherentFlags = effectiveProvinceTerrainFlags({ terrain, terrainFlags: undefined, freshwater: false });
  province.terrainFlags = province.terrainFlags?.filter((flag) => !inherentFlags.has(flag));
  if (!province.terrainFlags?.length) province.terrainFlags = undefined;

  if (terrain === "cavewall") {
    province.noStart = true;
    province.start = false;
    province.startType = undefined;
    province.teamStart = undefined;
    province.throne = "none";
    province.fixedThrone = undefined;
    province.defenders = [];
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
