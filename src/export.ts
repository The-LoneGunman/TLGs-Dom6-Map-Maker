import { cloneProject, sanitizeMapName, type MapProject } from "./domain";
import { calculateFairness } from "./generator";
import {
  compileMapText,
  encodeD6m,
  estimatedD6mBytes,
  validateProject,
  type D6mProgress,
} from "./dom6";

export interface ExportProgress {
  stage: "preparing" | "rasterizing" | "writing" | "packaging" | "done";
  plane: number;
  planeCount: number;
  percent: number;
  message: string;
}

export interface PackageFile {
  name: string;
  data: Uint8Array;
}

type ProgressCallback = (progress: ExportProgress) => void;

export async function buildPackageFiles(project: MapProject, onProgress?: ProgressCallback): Promise<PackageFile[]> {
  const base = sanitizeMapName(project.name);
  const encoder = new TextEncoder();
  const files: PackageFile[] = [];
  onProgress?.({ stage: "preparing", plane: 0, planeCount: project.planes.length, percent: 0, message: "Compiling Dominions map directives…" });
  for (let index = 0; index < project.planes.length; index += 1) {
    const suffix = index === 0 ? "" : `_plane${index + 1}`;
    files.push({ name: `${base}${suffix}.map`, data: encoder.encode(compileMapText(project, index)) });
  }
  files.push(...supportFiles(project));

  for (let index = 0; index < project.planes.length; index += 1) {
    const plane = project.planes[index]!;
    const suffix = index === 0 ? "" : `_plane${index + 1}`;
    const data = await encodeD6m(plane, `${project.seed}:d6m:${index}`, (progress: D6mProgress) => {
      const planeFraction = progress.totalRows ? progress.completedRows / progress.totalRows : 0;
      const totalFraction = (index + planeFraction) / project.planes.length;
      onProgress?.({
        stage: "rasterizing",
        plane: index + 1,
        planeCount: project.planes.length,
        percent: Math.round(totalFraction * 92),
        message: `Rendering ${plane.name} at ${plane.width}×${plane.height}…`,
      });
    });
    files.push({ name: `${base}${suffix}.d6m`, data });
  }
  onProgress?.({ stage: "done", plane: project.planes.length, planeCount: project.planes.length, percent: 100, message: "Dominions package ready." });
  return files;
}

export async function downloadPackage(project: MapProject, onProgress?: ProgressCallback) {
  const files = await buildPackageFiles(project, onProgress);
  const root = sanitizeMapName(project.name);
  onProgress?.({ stage: "packaging", plane: project.planes.length, planeCount: project.planes.length, percent: 96, message: "Packing the ready-to-install map folder…" });
  const zip = createStoredZip(files.map((file) => ({ ...file, name: `${root}/${file.name}` })));
  downloadBlob(new Blob([ownedBuffer(zip)], { type: "application/zip" }), `${root}.zip`);
  onProgress?.({ stage: "done", plane: project.planes.length, planeCount: project.planes.length, percent: 100, message: "Package downloaded." });
}

export async function removeObsoletePlaneArtifacts(
  directory: Pick<FileSystemDirectoryHandle, "removeEntry">,
  root: string,
  planeCount: number,
): Promise<void> {
  const currentPlaneCount = Math.max(1, Math.min(8, Math.trunc(planeCount)));
  for (let planeNumber = currentPlaneCount + 1; planeNumber <= 8; planeNumber += 1) {
    for (const extension of ["map", "d6m"] as const) {
      try {
        await directory.removeEntry(`${root}_plane${planeNumber}.${extension}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") continue;
        throw error;
      }
    }
  }
}

export async function installPackage(project: MapProject, onProgress?: ProgressCallback): Promise<"installed" | "unsupported" | "cancelled"> {
  const picker = (window as typeof window & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) return "unsupported";
  try {
    const mapsDirectory = await picker({ mode: "readwrite", id: "dominions6-maps" });
    const root = sanitizeMapName(project.name);
    const mapDirectory = await mapsDirectory.getDirectoryHandle(root, { create: true });
    await removeObsoletePlaneArtifacts(mapDirectory, root, project.planes.length);
    const support = supportFiles(project);
    for (let index = 0; index < project.planes.length; index += 1) {
      const suffix = index === 0 ? "" : `_plane${index + 1}`;
      await writeFile(mapDirectory, `${root}${suffix}.map`, new TextEncoder().encode(compileMapText(project, index)));
    }
    for (const file of support) await writeFile(mapDirectory, file.name, file.data);
    for (let index = 0; index < project.planes.length; index += 1) {
      const plane = project.planes[index]!;
      const suffix = index === 0 ? "" : `_plane${index + 1}`;
      const data = await encodeD6m(plane, `${project.seed}:d6m:${index}`, (progress) => {
        const planeFraction = progress.totalRows ? progress.completedRows / progress.totalRows : 0;
        onProgress?.({
          stage: "rasterizing",
          plane: index + 1,
          planeCount: project.planes.length,
          percent: Math.round(((index + planeFraction) / project.planes.length) * 92),
          message: `Rendering ${plane.name} at ${plane.width}×${plane.height}…`,
        });
      });
      onProgress?.({ stage: "writing", plane: index + 1, planeCount: project.planes.length, percent: 94, message: `Installing ${plane.name}…` });
      await writeFile(mapDirectory, `${root}${suffix}.d6m`, data);
    }
    onProgress?.({ stage: "done", plane: project.planes.length, planeCount: project.planes.length, percent: 100, message: "Installed. The map is ready in Dominions 6." });
    return "installed";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    throw error;
  }
}

export function downloadProject(project: MapProject) {
  const name = `${sanitizeMapName(project.name)}.atlas.json`;
  downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), name);
}

export function parseProject(text: string): MapProject {
  const parsed: unknown = JSON.parse(text);
  const root = recordAt(parsed, "project", "This is not a Pantokrator Atlas project.");
  if (root.schemaVersion !== 1) throw new Error(`Unsupported project schema ${String(root.schemaVersion)}.`);
  assertProjectShape(root);
  return cloneProject(root as unknown as MapProject);
}

const PLANE_KINDS = new Set([
  "surface", "cave", "cavern", "cloud", "air", "underworld", "hell", "abyss", "dream", "elemental", "custom",
]);
const PLANE_VARIANTS = new Set([
  "temperate", "wild", "frozen", "arid", "oceanic", "fungal", "crystal", "volcanic", "storm", "infernal", "void",
]);
const OWNERSHIP_MODES = new Set(["solid", "sparse"]);
const TERRAIN_KEYS = new Set([
  "plains", "forest", "farm", "swamp", "waste", "highland", "mountains", "freshwater", "sea", "deepsea", "kelp",
  "cave", "caveforest", "caveswamp", "cavewaste", "cavehighland", "cavewall",
]);
const TERRAIN_FLAGS = new Set([
  "sea", "freshwater", "highland", "swamp", "waste", "forest", "farm", "deep", "cave", "mountains", "cavewall",
]);
const BIOME_KEYS = new Set([
  "heartland", "wildwood", "marshlands", "sunscorched", "high_country", "tundra", "archipelago", "deep_ocean",
  "living_caves", "crystal_deeps", "ashen_deeps", "void_reaches",
]);
const MAGIC_PATHS = new Set([
  "fire", "air", "water", "earth", "astral", "death", "nature", "glamour", "blood", "holy",
]);
const START_TYPES = new Set(["land", "coastal", "water", "cave", "other"]);
const THRONE_MODES = new Set(["none", "preferred", "avoid", "fixed"]);
const EDGE_KINDS = new Set([
  "standard", "mountain_border", "mountain_pass", "river", "bridge", "impassable", "road", "custom",
]);
const GATE_DIRECTIONS = new Set(["bidirectional", "forward", "reverse"]);
const GATE_LAYOUTS = new Set(["hub", "chain", "ring", "compatible"]);
const OCEAN_LAYOUTS = new Set(["natural", "single_continent", "multiple_continents", "island_chains", "inland_sea"]);
const RESOLUTIONS = new Set(["compact", "2k", "4k", "square-max", "custom"]);

function assertProjectShape(project: Record<string, unknown>): void {
  stringAt(project.name, "project.name");
  stringAt(project.description, "project.description");
  stringAt(project.seed, "project.seed");
  numberAt(project.targetVersion, "project.targetVersion");
  assertGenerationSettings(recordAt(project.settings, "project.settings"));
  booleanAt(project.mapNoHide, "project.mapNoHide");
  booleanAt(project.noDeepCaves, "project.noDeepCaves");
  booleanAt(project.noDeepChoice, "project.noDeepChoice");
  booleanAt(project.noHomelandNames, "project.noHomelandNames");
  booleanAt(project.noNameFilter, "project.noNameFilter");
  numberAt(project.sailDistance, "project.sailDistance");
  optionalNumberAt(project.victoryPoints, "project.victoryPoints");
  numberArrayAt(project.allowedPlayers, "project.allowedPlayers");
  arrayAt(project.computerPlayers, "project.computerPlayers").forEach((value, index) => {
    const player = recordAt(value, `project.computerPlayers[${index}]`);
    numberAt(player.nation, `project.computerPlayers[${index}].nation`);
    numberAt(player.difficulty, `project.computerPlayers[${index}].difficulty`);
  });
  numberArrayAt(project.cannotWin, "project.cannotWin");
  arrayAt(project.specificStarts, "project.specificStarts").forEach((value, index) => {
    const start = recordAt(value, `project.specificStarts[${index}]`);
    numberAt(start.nation, `project.specificStarts[${index}].nation`);
    nonemptyStringAt(start.planeId, `project.specificStarts[${index}].planeId`);
    nonemptyStringAt(start.provinceId, `project.specificStarts[${index}].provinceId`);
    optionalEnumAt(start.source, new Set(["generated-cave"]), `project.specificStarts[${index}].source`);
  });

  const planes = arrayAt(project.planes, "project.planes");
  if (planes.length === 0) throw new Error("project.planes must contain at least one plane.");
  planes.forEach((value, index) => assertPlane(recordAt(value, `project.planes[${index}]`), index));

  arrayAt(project.gates, "project.gates").forEach((value, index) => {
    const gate = recordAt(value, `project.gates[${index}]`);
    nonemptyStringAt(gate.id, `project.gates[${index}].id`);
    numberAt(gate.gateNumber, `project.gates[${index}].gateNumber`);
    optionalEnumAt(gate.direction, GATE_DIRECTIONS, `project.gates[${index}].direction`);
    optionalBooleanAt(gate.adjacentStartFallback, `project.gates[${index}].adjacentStartFallback`);
    const endpoints = arrayAt(gate.endpoints, `project.gates[${index}].endpoints`);
    if (endpoints.length < 2) throw new Error(`project.gates[${index}].endpoints must contain at least two endpoints.`);
    endpoints.forEach((endpointValue, endpointIndex) => {
      const endpoint = recordAt(endpointValue, `project.gates[${index}].endpoints[${endpointIndex}]`);
      nonemptyStringAt(endpoint.planeId, `project.gates[${index}].endpoints[${endpointIndex}].planeId`);
      nonemptyStringAt(endpoint.provinceId, `project.gates[${index}].endpoints[${endpointIndex}].provinceId`);
    });
  });
  stringAt(project.rawDirectives, "project.rawDirectives");
  stringAt(project.createdAt, "project.createdAt");
  stringAt(project.updatedAt, "project.updatedAt");
}

function assertGenerationSettings(settings: Record<string, unknown>): void {
  for (const key of ["players", "provincesPerPlayer", "waterPercent", "biomeCohesion", "throneCount"] as const) {
    numberAt(settings[key], `project.settings.${key}`);
  }
  optionalNumberAt(settings.siteFrequency, "project.settings.siteFrequency");
  optionalEnumAt(settings.oceanLayout, OCEAN_LAYOUTS, "project.settings.oceanLayout");
  optionalNumberAt(settings.continentCount, "project.settings.continentCount");
  optionalNumberAt(settings.specialPlaneSizePercent, "project.settings.specialPlaneSizePercent");
  optionalNumberAt(settings.provinceNameSeed, "project.settings.provinceNameSeed");
  if (settings.startDistribution !== undefined) {
    const distribution = recordAt(settings.startDistribution, "project.settings.startDistribution");
    for (const key of ["land", "coastal", "water", "cave", "other"] as const) {
      numberAt(distribution[key], `project.settings.startDistribution.${key}`);
    }
  }
  optionalNumberAt(settings.startDegreeTarget, "project.settings.startDegreeTarget");
  if (settings.caveStartNations !== undefined) numberArrayAt(settings.caveStartNations, "project.settings.caveStartNations");
  optionalEnumAt(settings.gateLayout, GATE_LAYOUTS, "project.settings.gateLayout");
  optionalEnumAt(settings.gateDirection, GATE_DIRECTIONS, "project.settings.gateDirection");
  optionalNumberAt(settings.gatePairsPerConnection, "project.settings.gatePairsPerConnection");
  if (settings.planeConnections !== undefined) {
    arrayAt(settings.planeConnections, "project.settings.planeConnections").forEach((value, index) => {
      const rule = recordAt(value, `project.settings.planeConnections[${index}]`);
      nonemptyStringAt(rule.a, `project.settings.planeConnections[${index}].a`);
      nonemptyStringAt(rule.b, `project.settings.planeConnections[${index}].b`);
      numberAt(rule.pairs, `project.settings.planeConnections[${index}].pairs`);
      optionalBooleanAt(rule.enabled, `project.settings.planeConnections[${index}].enabled`);
    });
  }
  enumAt(settings.resolution, RESOLUTIONS, "project.settings.resolution");
}

function assertPlane(plane: Record<string, unknown>, index: number): void {
  const path = `project.planes[${index}]`;
  nonemptyStringAt(plane.id, `${path}.id`);
  stringAt(plane.name, `${path}.name`);
  enumAt(plane.kind, PLANE_KINDS, `${path}.kind`);
  optionalEnumAt(plane.variant, PLANE_VARIANTS, `${path}.variant`);
  optionalBooleanAt(plane.autoSize, `${path}.autoSize`);
  numberAt(plane.provinceTarget, `${path}.provinceTarget`);
  numberAt(plane.width, `${path}.width`);
  numberAt(plane.height, `${path}.height`);
  booleanAt(plane.wrapX, `${path}.wrapX`);
  booleanAt(plane.wrapY, `${path}.wrapY`);
  optionalEnumAt(plane.ownershipMode, OWNERSHIP_MODES, `${path}.ownershipMode`);
  optionalBooleanAt(plane.mapNoHide, `${path}.mapNoHide`);
  optionalBooleanAt(plane.noDeepCaves, `${path}.noDeepCaves`);
  optionalStringAt(plane.mapTextColor, `${path}.mapTextColor`);
  optionalStringAt(plane.mapDominionColor, `${path}.mapDominionColor`);
  const provinces = arrayAt(plane.provinces, `${path}.provinces`);
  if (provinces.length === 0) throw new Error(`${path}.provinces must contain at least one province.`);
  provinces.forEach((value, provinceIndex) => assertProvince(recordAt(value, `${path}.provinces[${provinceIndex}]`), `${path}.provinces[${provinceIndex}]`));
  arrayAt(plane.edges, `${path}.edges`).forEach((value, edgeIndex) => {
    const edgePath = `${path}.edges[${edgeIndex}]`;
    const edge = recordAt(value, edgePath);
    nonemptyStringAt(edge.id, `${edgePath}.id`);
    nonemptyStringAt(edge.a, `${edgePath}.a`);
    nonemptyStringAt(edge.b, `${edgePath}.b`);
    enumAt(edge.kind, EDGE_KINDS, `${edgePath}.kind`);
    optionalNumberAt(edge.special, `${edgePath}.special`);
  });
  stringAt(plane.rawDirectives, `${path}.rawDirectives`);
}

function assertProvince(province: Record<string, unknown>, path: string): void {
  nonemptyStringAt(province.id, `${path}.id`);
  numberAt(province.index, `${path}.index`);
  for (const key of ["x", "y", "gridX", "gridY"] as const) numberAt(province[key], `${path}.${key}`);
  stringAt(province.name, `${path}.name`);
  optionalEnumAt(province.nameSource, new Set(["generated", "authored"]), `${path}.nameSource`);
  enumAt(province.biome, BIOME_KEYS, `${path}.biome`);
  enumAt(province.terrain, TERRAIN_KEYS, `${path}.terrain`);
  if (province.terrainFlags !== undefined) enumArrayAt(province.terrainFlags, TERRAIN_FLAGS, `${path}.terrainFlags`);
  optionalBooleanAt(province.freshwater, `${path}.freshwater`);
  for (const key of ["small", "large", "noStart", "manySites", "warmer", "colder", "start"] as const) {
    booleanAt(province[key], `${path}.${key}`);
  }
  enumArrayAt(province.siteBias, MAGIC_PATHS, `${path}.siteBias`);
  optionalEnumAt(province.startType, START_TYPES, `${path}.startType`);
  optionalNumberAt(province.teamStart, `${path}.teamStart`);
  enumAt(province.throne, THRONE_MODES, `${path}.throne`);
  optionalStringAt(province.fixedThrone, `${path}.fixedThrone`);
  arrayAt(province.sites, `${path}.sites`).forEach((value, siteIndex) => {
    const sitePath = `${path}.sites[${siteIndex}]`;
    const site = recordAt(value, sitePath);
    nonemptyStringAt(site.id, `${sitePath}.id`);
    stringAt(site.value, `${sitePath}.value`);
    booleanAt(site.known, `${sitePath}.known`);
  });
  booleanAt(province.killRandomSites, `${path}.killRandomSites`);
  optionalNumberAt(province.owner, `${path}.owner`);
  optionalNumberAt(province.poptype, `${path}.poptype`);
  optionalNumberAt(province.population, `${path}.population`);
  optionalNumberAt(province.unrest, `${path}.unrest`);
  optionalNumberAt(province.fort, `${path}.fort`);
  booleanAt(province.temple, `${path}.temple`);
  booleanAt(province.lab, `${path}.lab`);
  optionalNumberAt(province.provinceDefense, `${path}.provinceDefense`);
  arrayAt(province.defenders, `${path}.defenders`).forEach((value, defenderIndex) => {
    assertDefense(recordAt(value, `${path}.defenders[${defenderIndex}]`), `${path}.defenders[${defenderIndex}]`);
  });
  const battle = recordAt(province.battle, `${path}.battle`);
  for (const key of ["skybox", "battleMap", "groundColor", "rockColor", "fogColor"] as const) {
    optionalStringAt(battle[key], `${path}.battle.${key}`);
  }
  stringAt(province.rawDirectives, `${path}.rawDirectives`);
}

function assertDefense(defense: Record<string, unknown>, path: string): void {
  nonemptyStringAt(defense.commander, `${path}.commander`);
  optionalBooleanAt(defense.clearMagic, `${path}.clearMagic`);
  optionalStringAt(defense.commanderName, `${path}.commanderName`);
  optionalStringAt(defense.bodyguard, `${path}.bodyguard`);
  optionalNumberAt(defense.bodyguardCount, `${path}.bodyguardCount`);
  arrayAt(defense.squads, `${path}.squads`).forEach((value, squadIndex) => {
    const squadPath = `${path}.squads[${squadIndex}]`;
    const squad = recordAt(value, squadPath);
    nonemptyStringAt(squad.id, `${squadPath}.id`);
    nonemptyStringAt(squad.unit, `${squadPath}.unit`);
    numberAt(squad.count, `${squadPath}.count`);
  });
  optionalNumberAt(defense.experience, `${path}.experience`);
  optionalNumberAt(defense.randomEquipment, `${path}.randomEquipment`);
  if (defense.items !== undefined) stringArrayAt(defense.items, `${path}.items`);
  if (defense.magic !== undefined) {
    const magic = recordAt(defense.magic, `${path}.magic`);
    for (const [key, value] of Object.entries(magic)) {
      if (!MAGIC_PATHS.has(key)) throw new Error(`${path}.magic.${key} is not a supported magic path.`);
      numberAt(value, `${path}.magic.${key}`);
    }
  }
}

function recordAt(value: unknown, path: string, message?: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message ?? `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function numberAt(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
}

function optionalNumberAt(value: unknown, path: string): void {
  if (value !== undefined) numberAt(value, path);
}

function booleanAt(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
}

function optionalBooleanAt(value: unknown, path: string): void {
  if (value !== undefined) booleanAt(value, path);
}

function stringAt(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
}

function nonemptyStringAt(value: unknown, path: string): asserts value is string {
  stringAt(value, path);
  if (!value.trim()) throw new Error(`${path} must not be empty.`);
}

function optionalStringAt(value: unknown, path: string): void {
  if (value !== undefined) stringAt(value, path);
}

function enumAt(value: unknown, allowed: ReadonlySet<string>, path: string): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) throw new Error(`${path} has an unsupported value.`);
}

function optionalEnumAt(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  if (value !== undefined) enumAt(value, allowed, path);
}

function numberArrayAt(value: unknown, path: string): void {
  arrayAt(value, path).forEach((entry, index) => numberAt(entry, `${path}[${index}]`));
}

function stringArrayAt(value: unknown, path: string): void {
  arrayAt(value, path).forEach((entry, index) => stringAt(entry, `${path}[${index}]`));
}

function enumArrayAt(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  arrayAt(value, path).forEach((entry, index) => enumAt(entry, allowed, `${path}[${index}]`));
}

export function estimatedPackageBytes(project: MapProject): number {
  return project.planes.reduce((sum, plane) => sum + estimatedD6mBytes(plane), 0) + 64_000;
}

function supportFiles(project: MapProject): PackageFile[] {
  const encoder = new TextEncoder();
  const fairness = calculateFairness(project);
  const issues = validateProject(project);
  const report = [
    "PANTOKRATOR ATLAS — DOMINIONS 6 MAP REPORT",
    "",
    `Map: ${project.name}`,
    `Seed: ${project.seed}`,
    `Planes: ${project.planes.length}`,
    `Provinces: ${project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0)}`,
    `Player starts: ${project.planes.reduce((sum, plane) => sum + plane.provinces.filter((province) => province.start).length, 0)}`,
    `Fairness score: ${fairness.overall}/100`,
    `  Start separation: ${fairness.startSeparation}`,
    `  Expansion parity: ${fairness.expansionParity}`,
    `  Nearby throne parity (within 4 moves): ${fairness.throneAccess}`,
    `  Terrain variety: ${fairness.terrainVariety}`,
    `  Connectivity: ${fairness.connectivity}`,
    `  Start degree parity: ${fairness.startDegree}`,
    `  Requested start allocation: ${fairness.startAllocation}`,
    "",
    "PLANES",
    ...project.planes.map((plane, index) => `  ${index + 1}. ${plane.name} — ${plane.kind}/${plane.variant ?? "default"}, ${plane.provinces.length} provinces, ${project.gates.filter((gate) => gate.endpoints.some((endpoint) => endpoint.planeId === plane.id)).length} gates`),
    "",
    "VALIDATION",
    ...issues.map((issue) => `[${issue.severity.toUpperCase()}] ${issue.message}`),
    "",
    "INSTALLATION",
    "Place this entire folder inside the Dominions 6 user data 'maps' directory.",
    "In Dominions 6, use Tools & Manuals > Open User Data Directory to locate it.",
    "When updating from a ZIP, replace the old folder completely instead of merging it; stale _planeN files would keep removed planes active.",
    "The .d6m files let Dominions render winter and terrain transformations natively.",
    `This package declares Dominions ${formatDomVersion(project.targetVersion)} or newer.`,
    "",
    "NOTE ABOUT PROVINCE DEFENSE",
    "Authored commander/unit groups are unique initial independent guardians.",
    "Post-conquest recruitable province-defense composition comes from the selected poptype or nation.",
  ].join("\r\n");
  const host = [
    "PANTOKRATOR ATLAS — HOST SETTINGS",
    "",
    `Map file: ${sanitizeMapName(project.name)}.map`,
    `Recommended players: ${project.settings.players}`,
    `Recommended throne slots: ${project.settings.throneCount}`,
    `Start mix: ${formatStartDistribution(project)}`,
    `Minimum start connections: ${project.settings.startDegreeTarget ?? 4}`,
    project.victoryPoints ? `Ascension points: ${project.victoryPoints}` : "Ascension points: choose in the host setup",
    `Special starts: ${project.specificStarts.length ? "enable if using assigned nations" : "not required"}`,
    `Wrap: ${formatWrap(project.planes[0])}`,
  ].join("\r\n");
  const install = [
    "PANTOKRATOR ATLAS - INSTALLATION",
    "",
    `Folder name: ${sanitizeMapName(project.name)}`,
    `Main map file: ${sanitizeMapName(project.name)}.map`,
    "",
    "Direct install",
    "Choose the Dominions 6 user-data maps folder. Pantokrator Atlas removes obsolete plane files before writing the update.",
    "",
    "ZIP install or update",
    "Before extracting, remove any existing map folder with the same name, then extract this entire folder into the Dominions 6 maps directory.",
    "Do not merge it into an older copy: obsolete _planeN.map and _planeN.d6m files would keep removed planes active.",
  ].join("\r\n");
  return [
    { name: "INSTALL.txt", data: encoder.encode(install) },
    { name: "atlas_project.json", data: encoder.encode(JSON.stringify(project, null, 2)) },
    { name: "balance_report.txt", data: encoder.encode(report) },
    { name: "host_settings.txt", data: encoder.encode(host) },
  ];
}

function formatDomVersion(version: number): string {
  const major = Math.floor(version / 100);
  const minor = String(Math.max(0, version % 100)).padStart(2, "0");
  return `${major}.${minor}`;
}

function formatStartDistribution(project: MapProject): string {
  const distribution = project.settings.startDistribution;
  if (!distribution) return `${project.settings.players} land`;
  return (["land", "coastal", "water", "cave", "other"] as const)
    .filter((type) => distribution[type] > 0)
    .map((type) => `${distribution[type]} ${type}`)
    .join(", ");
}

function formatWrap(plane: MapProject["planes"][number] | undefined): string {
  if (!plane?.wrapX && !plane?.wrapY) return "none";
  if (plane.wrapX && plane.wrapY) return "east/west + north/south";
  return plane.wrapX ? "east/west" : "north/south";
}

async function writeFile(directory: FileSystemDirectoryHandle, name: string, data: Uint8Array) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(ownedBuffer(data));
  await writable.close();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function ownedBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function createStoredZip(files: PackageFile[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name.replace(/\\/g, "/"));
    const crc = crc32(file.data);
    const time = dosTime(new Date());
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time.time, true);
    localView.setUint16(12, time.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, file.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time.time, true);
    centralView.setUint16(14, time.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + file.data.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
