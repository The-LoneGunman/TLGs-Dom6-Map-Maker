import { type MapProject } from "./domain";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "./catalog";
import { estimatedD6mBytes } from "./dom6";
import { buildInitialDefensePlan, type InitialDefensePlan, type VerifiedPopulationDefenseProfile } from "./populationDefenders";
import { verifiedPopulationDefenseProfiles } from "./populationDefenseRegistry";
import { illustratedPackageBytes, type ExportArtwork } from "./illustratedArtworkPlan";

/**
 * Allocation-light package-size estimates and the ZIP memory-safety verdict.
 * The editor shows these continuously; the package exporter in `./export`
 * re-exports them and is loaded only when a package is built.
 */

export type ZipPackageSafetyLevel = "safe" | "warning" | "blocked";

export interface ZipPackageSafety {
  level: ZipPackageSafetyLevel;
  estimatedPackageBytes: number;
  estimatedPeakBytes: number;
  message?: string;
}

/** Stored ZIP assembly temporarily needs source files, the ZIP, and Blob copies. */
export const ZIP_MEMORY_WARNING_PEAK_BYTES = 384 * 1024 * 1024;
export const ZIP_MEMORY_LIMIT_PEAK_BYTES = 768 * 1024 * 1024;

export function estimatedPackageBytes(project: MapProject, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = verifiedPopulationDefenseProfiles(), artwork: ExportArtwork = "native"): number {
  if (artwork === "illustrated") return illustratedPackageBytes(project)
    + estimatedTextPackageBytes(project, catalog, populationProfiles) + 64 * 1024;
  return project.planes.reduce((sum, plane) => sum + estimatedD6mBytes(plane), 0)
    + estimatedTextPackageBytes(project, catalog, populationProfiles);
}

/**
 * Conservative, allocation-light estimate for the maps and support files that
 * accompany D6Ms. In particular, advanced directives exist both in compiled
 * .map files and in atlas_project.json, so omitting text can substantially
 * understate ZIP memory for heavily authored projects.
 */
export function estimatedTextPackageBytes(project: MapProject, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = verifiedPopulationDefenseProfiles()): number {
  const defensePlan = project.populationDefense?.enabled
    ? buildInitialDefensePlan(project, catalog, project.populationDefense, populationProfiles) : undefined;
  const mapBytes = project.planes.reduce(
    (sum, plane, planeIndex) => sum + estimatedCompiledMapBytes(project, plane, planeIndex, defensePlan),
    0,
  );
  const projectJsonBytes = estimatedPrettyJsonBytes(project);
  const provinceCount = project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0);
  const edgeCount = project.planes.reduce((sum, plane) => sum + plane.edges.length, 0);
  const gateEndpointCount = project.gates.reduce((sum, gate) => sum + gate.endpoints.length, 0);
  // Both access views repeat up to 64 start names in quoted form. Six bytes per
  // UTF-16 code unit covers JSON escaping, and patch notes occur in two reports.
  const specificKeys = new Set(project.specificStarts.map(start => `${start.planeId}:${start.provinceId}`));
  const analyzedStarts = project.planes.flatMap(plane => plane.provinces.filter(province => province.start
    || province.teamStart !== undefined || specificKeys.has(`${plane.id}:${province.id}`))).slice(0, 64);
  const analysisTextBytes = 16 * 1024 + analyzedStarts.reduce((sum, province) => sum + 2048 + province.name.length * 12, 0)
    + ((project.analysisContext?.gameVersion?.length ?? 0) + (project.analysisContext?.mods?.length ?? 0)) * 18
    + (project.analysisContext?.requirements ?? []).reduce((sum, r) => sum + 2048 + (r.label.length + r.gameVersion.length + r.mods.length) * 6, 0);

  // INSTALL, balance, host settings, and host topology. The topology dossier
  // repeats province/edge descriptions, so budget by records instead of using
  // the former fixed 64 KB allowance.
  const supportTextBytes = 64 * 1024
    + analysisTextBytes
    + project.planes.length * 4 * 1024
    + provinceCount * 1024
    + edgeCount * 512
    + project.gates.length * 512
    + gateEndpointCount * 512
    + estimatedTopologyRepeatedStringBytes(project);
  const zipDirectoryOverhead = 8 * 1024 + (project.planes.length * 2 + 5) * 256;
  return mapBytes + projectJsonBytes + supportTextBytes + zipDirectoryOverhead;
}

export function zipPackageSafety(project: MapProject, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG, artwork: ExportArtwork = "native"): ZipPackageSafety {
  const estimatedBytes = estimatedPackageBytes(project, catalog, verifiedPopulationDefenseProfiles(), artwork);
  const renderingWorkspaceBytes = artwork === "illustrated"
    ? Math.max(0, ...project.planes.map(plane => plane.width * plane.height)) * 16 : 0;
  const estimatedPeakBytes = estimatedBytes * 3 + 16 * 1024 * 1024 + renderingWorkspaceBytes;
  if (estimatedPeakBytes >= ZIP_MEMORY_LIMIT_PEAK_BYTES) {
    return {
      level: "blocked",
      estimatedPackageBytes: estimatedBytes,
      estimatedPeakBytes,
      message: "This ZIP could exceed the browser's safe memory limit. Use direct install, reduce plane count or resolution, or export the editable project instead.",
    };
  }
  if (estimatedPeakBytes >= ZIP_MEMORY_WARNING_PEAK_BYTES) {
    return {
      level: "warning",
      estimatedPackageBytes: estimatedBytes,
      estimatedPeakBytes,
      message: artwork === "native" ? "This ZIP may use substantial browser memory. Direct install is safer and streams one plane at a time."
        : "This illustrated ZIP may use substantial browser memory. Direct install is safer and stages one image variant at a time.",
    };
  }
  return { level: "safe", estimatedPackageBytes: estimatedBytes, estimatedPeakBytes };
}

function estimatedCompiledMapBytes(
  project: MapProject,
  plane: MapProject["planes"][number],
  planeIndex: number,
  defensePlan?: InitialDefensePlan,
): number {
  let bytes = 8 * 1024
    + jsonStringBytes(project.name)
    + jsonStringBytes(project.description)
    + jsonStringBytes(project.seed)
    + jsonStringBytes(plane.name)
    + rawDirectiveOutputUpperBound(plane.rawDirectives);
  if (planeIndex === 0) bytes += rawDirectiveOutputUpperBound(project.rawDirectives);

  for (const province of plane.provinces) {
    bytes += 512 + jsonStringBytes(province.name) + rawDirectiveOutputUpperBound(province.rawDirectives);
    if (province.fixedThrone) bytes += 64 + jsonStringBytes(province.fixedThrone);
    for (const site of province.sites) bytes += 64 + jsonStringBytes(site.value);
    for (const value of Object.values(province.battle)) {
      if (value) bytes += 64 + jsonStringBytes(value);
    }
    const row = defensePlan?.entries.get(`${plane.id}:${province.id}`);
    const defenders = row?.status === "derived" ? row.groups : province.defenders;
    if (row?.status === "derived") bytes += 512;
    for (const defense of defenders) {
      bytes += 256 + jsonStringBytes(defense.commander) + jsonStringBytes(defense.commanderName ?? "")
        + jsonStringBytes(defense.bodyguard ?? "");
      for (const squad of defense.squads) bytes += 96 + jsonStringBytes(squad.unit);
      for (const item of defense.items ?? []) bytes += 96 + jsonStringBytes(item);
      bytes += Object.keys(defense.magic ?? {}).length * 48;
    }
  }
  bytes += plane.edges.length * 96;
  bytes += project.gates.reduce(
    (sum, gate) => sum + gate.endpoints.filter((endpoint) => endpoint.planeId === plane.id).length * 64,
    0,
  );
  if (planeIndex === 0) bytes += project.specificStarts.length * 64;
  return bytes;
}

function rawDirectiveOutputUpperBound(raw: string): number {
  if (!raw) return 0;
  let newlines = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code === 10 || code === 13) newlines += 1;
  }
  // appendRaw trims and filters lines, then joins with CRLF. Counting the
  // original UTF-8 payload plus one extra byte per CR or LF is an upper bound.
  return utf8StringBytes(raw) + newlines + 2;
}

function estimatedPrettyJsonBytes(value: unknown, depth = 0): number {
  if (value === null) return 4;
  if (typeof value === "string") return jsonStringBytes(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value).length : 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (Array.isArray(value)) {
    if (!value.length) return 2;
    let bytes = 3 + depth * 2;
    for (const [index, entry] of value.entries()) {
      bytes += (depth + 1) * 2 + estimatedPrettyJsonBytes(entry ?? null, depth + 1) + 1;
      if (index < value.length - 1) bytes += 1;
    }
    return bytes;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    if (!entries.length) return 2;
    let bytes = 3 + depth * 2;
    for (const [index, [key, entry]] of entries.entries()) {
      bytes += (depth + 1) * 2 + jsonStringBytes(key) + 2
        + estimatedPrettyJsonBytes(entry, depth + 1) + 1;
      if (index < entries.length - 1) bytes += 1;
    }
    return bytes;
  }
  return 4;
}

function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x0c
      || code === 0x0a || code === 0x0d || code === 0x09) bytes += 2;
    else if (code <= 0x1f || (code >= 0xd800 && code <= 0xdfff
      && !(code <= 0xdbff && index + 1 < value.length
        && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff))) bytes += 6;
    else if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function estimatedTopologyRepeatedStringBytes(project: MapProject): number {
  const planeById = new Map(project.planes.map((plane) => [plane.id, plane]));
  const provinceByKey = new Map(project.planes.flatMap((plane) => plane.provinces.map((province) => [
    `${plane.id}\u0000${province.id}`,
    province,
  ] as const)));
  let bytes = jsonStringBytes(project.name);
  for (const plane of project.planes) {
    const provinceById = new Map(plane.provinces.map((province) => [province.id, province]));
    bytes += jsonStringBytes(plane.name) * 2;
    for (const province of plane.provinces) bytes += jsonStringBytes(province.name) * 2;
    for (const edge of plane.edges) {
      for (const provinceId of [edge.a, edge.b]) {
        const province = provinceById.get(provinceId);
        bytes += province
          ? jsonStringBytes(province.name)
          : jsonStringBytes(provinceId);
      }
    }
  }
  for (const gate of project.gates) {
    bytes += jsonStringBytes(gate.id);
    for (const endpoint of gate.endpoints) {
      const plane = planeById.get(endpoint.planeId);
      const province = provinceByKey.get(`${endpoint.planeId}\u0000${endpoint.provinceId}`);
      bytes += jsonStringBytes(plane?.name ?? endpoint.planeId)
        + jsonStringBytes(province?.name ?? endpoint.provinceId);
    }
  }
  return bytes;
}

function utf8StringBytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
