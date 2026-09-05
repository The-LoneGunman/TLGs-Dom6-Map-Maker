import { cloneProject, sanitizeMapName, type MapProject } from "./domain";
import { calculateFairness } from "./generator";
import { buildHostTopologyReport } from "./hostReport";
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
  const safety = zipPackageSafety(project);
  if (safety.level === "blocked") throw new Error(safety.message);
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
    await assertSafeInstallDirectory(mapDirectory, root);
    const encoder = new TextEncoder();
    const transactionId = nextInstallTransactionId();
    const support = supportFiles(project);
    const textArtifacts: InstallArtifact[] = project.planes.map((_, index) => {
      const suffix = index === 0 ? "" : `_plane${index + 1}`;
      return installArtifact(root, transactionId, `${root}${suffix}.map`, encoder.encode(compileMapText(project, index)));
    });
    textArtifacts.push(...support.map((file) => installArtifact(root, transactionId, file.name, file.data)));
    const d6mArtifacts = project.planes.map((_, index) => {
      const suffix = index === 0 ? "" : `_plane${index + 1}`;
      return installArtifact(root, transactionId, `${root}${suffix}.d6m`);
    });
    const allArtifacts = [...d6mArtifacts, ...textArtifacts];
    const temporaryNames = knownAtlasInstallTemporaryNames(root, transactionId);
    const backups = new Map<string, string | null>();
    const touchedTargets: string[] = [];

    try {
      // Stage each raster independently so an all-plane update never retains
      // every D6M in RAM and no playable file changes during rendering.
      for (let index = 0; index < project.planes.length; index += 1) {
        const plane = project.planes[index]!;
        const artifact = d6mArtifacts[index]!;
        const data = await encodeD6m(plane, `${project.seed}:d6m:${index}`, (progress) => {
          const planeFraction = progress.totalRows ? progress.completedRows / progress.totalRows : 0;
          onProgress?.({
            stage: "rasterizing",
            plane: index + 1,
            planeCount: project.planes.length,
            percent: Math.round(((index + planeFraction) / project.planes.length) * 84),
            message: `Rendering ${plane.name} at ${plane.width}×${plane.height}…`,
          });
        });
        onProgress?.({ stage: "writing", plane: index + 1, planeCount: project.planes.length, percent: 86, message: `Staging ${plane.name} safely…` });
        await writeFile(mapDirectory, artifact.stageName, data);
      }

      // Map/support compilation already succeeded above. Staging these small
      // files detects quota or permission failures before current files move.
      for (const artifact of textArtifacts) await writeFile(mapDirectory, artifact.stageName, artifact.data!);

      // File System Access has no atomic rename. Disk-backed Atlas-only backups
      // provide deterministic rollback without retaining all old D6Ms in RAM.
      for (const artifact of allArtifacts) {
        const existing = await readFileIfExists(mapDirectory, artifact.targetName);
        if (existing) {
          await writeFile(mapDirectory, artifact.backupName, existing);
          backups.set(artifact.targetName, artifact.backupName);
        } else {
          backups.set(artifact.targetName, null);
        }
      }

      // Publish binaries first. Only after all current D6Ms exist do .map and
      // support files begin referencing them.
      for (let index = 0; index < d6mArtifacts.length; index += 1) {
        const artifact = d6mArtifacts[index]!;
        touchedTargets.push(artifact.targetName);
        onProgress?.({ stage: "writing", plane: index + 1, planeCount: project.planes.length, percent: 90 + Math.round(((index + 1) / project.planes.length) * 5), message: `Publishing ${project.planes[index]!.name}…` });
        await copyFile(mapDirectory, artifact.stageName, artifact.targetName);
      }
      for (const artifact of textArtifacts) {
        touchedTargets.push(artifact.targetName);
        await copyFile(mapDirectory, artifact.stageName, artifact.targetName);
      }
    } catch (error) {
      const rollbackErrors = await rollbackInstall(mapDirectory, touchedTargets, backups);
      const cleanupNames = rollbackErrors.length
        ? new Set([...temporaryNames].filter((name) => name.includes("__stage__")))
        : temporaryNames;
      const cleanupErrors = await cleanupInstallArtifacts(mapDirectory, cleanupNames);
      const recoveryErrors = [...rollbackErrors, ...cleanupErrors];
      if (recoveryErrors.length) {
        throw new AggregateError(
          [error, ...recoveryErrors],
          "Direct installation failed and the browser could not fully restore or clean every Atlas-owned file. Atlas backup temporary files were retained when restoration failed; unrelated files were not touched. Retry the direct install before hosting.",
        );
      }
      throw error;
    }

    // Cleanup is deliberately last: temporary/backup artifacts and obsolete
    // numbered planes remain available until every current file is published.
    const cleanupErrors = await cleanupInstallArtifacts(mapDirectory, temporaryNames);
    try {
      await removeObsoletePlaneArtifacts(mapDirectory, root, project.planes.length);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        cleanupErrors,
        "The current atlas was installed, but Atlas could not remove every Atlas-owned temporary or obsolete plane file. Unrelated files were not touched; retry the direct install before hosting.",
      );
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
  downloadBlob(new Blob([serializeProject(project, true)], { type: "application/json" }), name);
}

/** Parser-side ceiling. The file picker should also reject larger files before calling File.text(). */
export const MAX_PROJECT_IMPORT_BYTES = 16 * 1024 * 1024;
export const MAX_IMPORTED_PLANES = 8;
export const MAX_IMPORTED_PROVINCES_PER_PLANE = 800;
export const MAX_IMPORTED_EDGES_PER_PLANE = 6_400;
export const MAX_IMPORTED_GATES = 2_048;
export const MAX_IMPORTED_ID_LENGTH = 128;
export const MAX_IMPORTED_STRING_LENGTH = 4_096;
export const MAX_IMPORTED_DIRECTIVE_LENGTH = 256 * 1024;

const MAX_GENERIC_ARRAY_ENTRIES = 10_000;
const MAX_PLAYER_ENTRIES = 512;
const MAX_SPECIFIC_STARTS = 512;
const MAX_PLANE_CONNECTION_RULES = 64;
const MAX_GATE_ENDPOINTS = 64;
const MAX_GENERATION_WARNINGS = 256;
const MAX_SITES_PER_PROVINCE = 64;
const MAX_DEFENSE_GROUPS_PER_PROVINCE = 32;
const MAX_SQUADS_PER_DEFENSE_GROUP = 64;
const MAX_ITEMS_PER_DEFENSE_GROUP = 64;
const SAFE_IMPORTED_ID = /^[A-Za-z0-9_-]+$/;

export function parseProject(text: string): MapProject {
  assertProjectTextSize(text);
  const parsed: unknown = JSON.parse(text);
  const root = recordAt(parsed, "project", "This is not a Pantokrator Atlas project.");
  if (root.schemaVersion !== 1) throw new Error(`Unsupported project schema ${String(root.schemaVersion)}.`);
  assertProjectShape(root);
  return cloneProject(root as unknown as MapProject);
}

/** Save only project states the importer can restore, without parsing/cloning a second atlas. */
export function serializeProject(project: MapProject, pretty = false): string {
  const root = recordAt(project, "project");
  if (root.schemaVersion !== 1) throw new Error(`Unsupported project schema ${String(root.schemaVersion)}.`);
  assertProjectShape(root);
  const compact = JSON.stringify(project);
  assertProjectTextSize(compact);
  if (!pretty) return compact;
  const formatted = JSON.stringify(project, null, 2);
  try {
    assertProjectTextSize(formatted);
    return formatted;
  } catch {
    return compact;
  }
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
const ECONOMY_BALANCE_MODES = new Set(["none", "soft", "hard"]);
const OVERLAND_TOPOLOGY_MODES = new Set(["open", "competitive", "strategic"]);
const RESOLUTIONS = new Set(["compact", "2k", "4k", "square-max", "custom"]);

const PROJECT_FIELDS = new Set([
  "schemaVersion", "name", "description", "seed", "targetVersion", "settings", "generationWarnings", "mapNoHide",
  "noDeepCaves", "noDeepChoice", "noHomelandNames", "noNameFilter", "sailDistance", "victoryPoints", "allowedPlayers",
  "computerPlayers", "cannotWin", "specificStarts", "planes", "gates", "rawDirectives", "createdAt", "updatedAt",
]);
const GENERATION_SETTING_FIELDS = new Set([
  "players", "provincesPerPlayer", "waterPercent", "oceanLayout", "continentCount", "specialPlaneSizePercent",
  "provinceNameSeed", "biomeCohesion", "throneCount", "siteFrequency", "economyBalance", "overlandTopology",
  "startDistribution", "startDegreeTarget", "caveStartNations", "gateLayout", "gateDirection", "gatePairsPerConnection",
  "planeConnections", "resolution",
]);
const START_DISTRIBUTION_FIELDS = new Set(["land", "coastal", "water", "cave", "other"]);
const COMPUTER_PLAYER_FIELDS = new Set(["nation", "difficulty"]);
const SPECIFIC_START_FIELDS = new Set(["nation", "planeId", "provinceId", "source"]);
const PLANE_CONNECTION_FIELDS = new Set(["a", "b", "pairs", "enabled"]);
const PLANE_FIELDS = new Set([
  "id", "name", "kind", "variant", "autoSize", "noGeneratedStarts", "provinceTarget", "width", "height", "wrapX",
  "wrapY", "ownershipMode", "mapNoHide", "noDeepCaves", "mapTextColor", "mapDominionColor", "provinces", "edges",
  "rawDirectives",
]);
const EDGE_FIELDS = new Set(["id", "a", "b", "kind", "special"]);
const PROVINCE_FIELDS = new Set([
  "id", "index", "x", "y", "gridX", "gridY", "name", "nameSource", "biome", "terrain", "terrainFlags",
  "freshwater", "small", "large", "noStart", "manySites", "warmer", "colder", "siteBias", "start", "startType",
  "teamStart", "throne", "fixedThrone", "sites", "killRandomSites", "owner", "poptype", "population", "unrest", "fort",
  "temple", "lab", "provinceDefense", "defenders", "battle", "rawDirectives",
]);
const MAGIC_SITE_FIELDS = new Set(["id", "value", "known"]);
const DEFENSE_FIELDS = new Set([
  "commander", "clearMagic", "commanderName", "bodyguard", "bodyguardCount", "squads", "experience", "randomEquipment",
  "items", "magic",
]);
const DEFENSE_SQUAD_FIELDS = new Set(["id", "unit", "count"]);
const BATTLE_FIELDS = new Set(["skybox", "battleMap", "groundColor", "rockColor", "fogColor"]);
const GATE_FIELDS = new Set(["id", "gateNumber", "direction", "adjacentStartFallback", "endpoints"]);
const GATE_ENDPOINT_FIELDS = new Set(["planeId", "provinceId"]);

function assertProjectShape(project: Record<string, unknown>): void {
  assertKnownFields(project, "project", PROJECT_FIELDS);
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
  numberArrayAt(project.allowedPlayers, "project.allowedPlayers", MAX_PLAYER_ENTRIES);
  boundedArrayAt(project.computerPlayers, "project.computerPlayers", MAX_PLAYER_ENTRIES).forEach((value, index) => {
    const player = recordAt(value, `project.computerPlayers[${index}]`);
    assertKnownFields(player, `project.computerPlayers[${index}]`, COMPUTER_PLAYER_FIELDS);
    numberAt(player.nation, `project.computerPlayers[${index}].nation`);
    numberAt(player.difficulty, `project.computerPlayers[${index}].difficulty`);
  });
  numberArrayAt(project.cannotWin, "project.cannotWin", MAX_PLAYER_ENTRIES);
  boundedArrayAt(project.specificStarts, "project.specificStarts", MAX_SPECIFIC_STARTS).forEach((value, index) => {
    const start = recordAt(value, `project.specificStarts[${index}]`);
    assertKnownFields(start, `project.specificStarts[${index}]`, SPECIFIC_START_FIELDS);
    numberAt(start.nation, `project.specificStarts[${index}].nation`);
    idAt(start.planeId, `project.specificStarts[${index}].planeId`);
    idAt(start.provinceId, `project.specificStarts[${index}].provinceId`);
    optionalEnumAt(start.source, new Set(["generated-cave"]), `project.specificStarts[${index}].source`);
  });

  const planes = boundedArrayAt(project.planes, "project.planes", MAX_IMPORTED_PLANES);
  if (planes.length === 0) throw new Error("project.planes must contain at least one plane.");
  planes.forEach((value, index) => assertPlane(recordAt(value, `project.planes[${index}]`), index));

  boundedArrayAt(project.gates, "project.gates", MAX_IMPORTED_GATES).forEach((value, index) => {
    const gate = recordAt(value, `project.gates[${index}]`);
    assertKnownFields(gate, `project.gates[${index}]`, GATE_FIELDS);
    idAt(gate.id, `project.gates[${index}].id`);
    numberAt(gate.gateNumber, `project.gates[${index}].gateNumber`);
    optionalEnumAt(gate.direction, GATE_DIRECTIONS, `project.gates[${index}].direction`);
    optionalBooleanAt(gate.adjacentStartFallback, `project.gates[${index}].adjacentStartFallback`);
    const endpoints = boundedArrayAt(gate.endpoints, `project.gates[${index}].endpoints`, MAX_GATE_ENDPOINTS);
    if (endpoints.length < 2) throw new Error(`project.gates[${index}].endpoints must contain at least two endpoints.`);
    endpoints.forEach((endpointValue, endpointIndex) => {
      const endpoint = recordAt(endpointValue, `project.gates[${index}].endpoints[${endpointIndex}]`);
      assertKnownFields(endpoint, `project.gates[${index}].endpoints[${endpointIndex}]`, GATE_ENDPOINT_FIELDS);
      idAt(endpoint.planeId, `project.gates[${index}].endpoints[${endpointIndex}].planeId`);
      idAt(endpoint.provinceId, `project.gates[${index}].endpoints[${endpointIndex}].provinceId`);
    });
  });
  directiveAt(project.rawDirectives, "project.rawDirectives");
  if (project.generationWarnings !== undefined) stringArrayAt(project.generationWarnings, "project.generationWarnings", MAX_GENERATION_WARNINGS);
  stringAt(project.createdAt, "project.createdAt");
  stringAt(project.updatedAt, "project.updatedAt");
}

function assertGenerationSettings(settings: Record<string, unknown>): void {
  assertKnownFields(settings, "project.settings", GENERATION_SETTING_FIELDS);
  for (const key of ["players", "provincesPerPlayer", "waterPercent", "biomeCohesion", "throneCount"] as const) {
    numberAt(settings[key], `project.settings.${key}`);
  }
  optionalNumberAt(settings.siteFrequency, "project.settings.siteFrequency");
  optionalEnumAt(settings.oceanLayout, OCEAN_LAYOUTS, "project.settings.oceanLayout");
  optionalNumberAt(settings.continentCount, "project.settings.continentCount");
  optionalNumberAt(settings.specialPlaneSizePercent, "project.settings.specialPlaneSizePercent");
  optionalNumberAt(settings.provinceNameSeed, "project.settings.provinceNameSeed");
  optionalEnumAt(settings.economyBalance, ECONOMY_BALANCE_MODES, "project.settings.economyBalance");
  optionalEnumAt(settings.overlandTopology, OVERLAND_TOPOLOGY_MODES, "project.settings.overlandTopology");
  if (settings.startDistribution !== undefined) {
    const distribution = recordAt(settings.startDistribution, "project.settings.startDistribution");
    assertKnownFields(distribution, "project.settings.startDistribution", START_DISTRIBUTION_FIELDS);
    for (const key of ["land", "coastal", "water", "cave", "other"] as const) {
      numberAt(distribution[key], `project.settings.startDistribution.${key}`);
    }
  }
  optionalNumberAt(settings.startDegreeTarget, "project.settings.startDegreeTarget");
  if (settings.caveStartNations !== undefined) numberArrayAt(settings.caveStartNations, "project.settings.caveStartNations", MAX_PLAYER_ENTRIES);
  optionalEnumAt(settings.gateLayout, GATE_LAYOUTS, "project.settings.gateLayout");
  optionalEnumAt(settings.gateDirection, GATE_DIRECTIONS, "project.settings.gateDirection");
  optionalNumberAt(settings.gatePairsPerConnection, "project.settings.gatePairsPerConnection");
  if (settings.planeConnections !== undefined) {
    boundedArrayAt(settings.planeConnections, "project.settings.planeConnections", MAX_PLANE_CONNECTION_RULES).forEach((value, index) => {
      const rule = recordAt(value, `project.settings.planeConnections[${index}]`);
      assertKnownFields(rule, `project.settings.planeConnections[${index}]`, PLANE_CONNECTION_FIELDS);
      idAt(rule.a, `project.settings.planeConnections[${index}].a`);
      idAt(rule.b, `project.settings.planeConnections[${index}].b`);
      numberAt(rule.pairs, `project.settings.planeConnections[${index}].pairs`);
      optionalBooleanAt(rule.enabled, `project.settings.planeConnections[${index}].enabled`);
    });
  }
  enumAt(settings.resolution, RESOLUTIONS, "project.settings.resolution");
}

function assertPlane(plane: Record<string, unknown>, index: number): void {
  const path = `project.planes[${index}]`;
  assertKnownFields(plane, path, PLANE_FIELDS);
  idAt(plane.id, `${path}.id`);
  stringAt(plane.name, `${path}.name`);
  enumAt(plane.kind, PLANE_KINDS, `${path}.kind`);
  optionalEnumAt(plane.variant, PLANE_VARIANTS, `${path}.variant`);
  optionalBooleanAt(plane.autoSize, `${path}.autoSize`);
  optionalBooleanAt(plane.noGeneratedStarts, `${path}.noGeneratedStarts`);
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
  const provinces = boundedArrayAt(plane.provinces, `${path}.provinces`, MAX_IMPORTED_PROVINCES_PER_PLANE);
  provinces.forEach((value, provinceIndex) => assertProvince(recordAt(value, `${path}.provinces[${provinceIndex}]`), `${path}.provinces[${provinceIndex}]`));
  provinces.forEach((value, provinceIndex) => {
    const province = value as Record<string, unknown>;
    if (province.index !== provinceIndex + 1) {
      throw new Error(`${path}.provinces must be stored in local province-number order; expected index ${provinceIndex + 1} at array position ${provinceIndex}.`);
    }
  });
  boundedArrayAt(plane.edges, `${path}.edges`, MAX_IMPORTED_EDGES_PER_PLANE).forEach((value, edgeIndex) => {
    const edgePath = `${path}.edges[${edgeIndex}]`;
    const edge = recordAt(value, edgePath);
    assertKnownFields(edge, edgePath, EDGE_FIELDS);
    idAt(edge.id, `${edgePath}.id`);
    idAt(edge.a, `${edgePath}.a`);
    idAt(edge.b, `${edgePath}.b`);
    enumAt(edge.kind, EDGE_KINDS, `${edgePath}.kind`);
    optionalNumberAt(edge.special, `${edgePath}.special`);
  });
  directiveAt(plane.rawDirectives, `${path}.rawDirectives`);
}

function assertProvince(province: Record<string, unknown>, path: string): void {
  assertKnownFields(province, path, PROVINCE_FIELDS);
  idAt(province.id, `${path}.id`);
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
  boundedArrayAt(province.sites, `${path}.sites`, MAX_SITES_PER_PROVINCE).forEach((value, siteIndex) => {
    const sitePath = `${path}.sites[${siteIndex}]`;
    const site = recordAt(value, sitePath);
    assertKnownFields(site, sitePath, MAGIC_SITE_FIELDS);
    idAt(site.id, `${sitePath}.id`);
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
  boundedArrayAt(province.defenders, `${path}.defenders`, MAX_DEFENSE_GROUPS_PER_PROVINCE).forEach((value, defenderIndex) => {
    assertDefense(recordAt(value, `${path}.defenders[${defenderIndex}]`), `${path}.defenders[${defenderIndex}]`);
  });
  const battle = recordAt(province.battle, `${path}.battle`);
  assertKnownFields(battle, `${path}.battle`, BATTLE_FIELDS);
  for (const key of ["skybox", "battleMap", "groundColor", "rockColor", "fogColor"] as const) {
    optionalStringAt(battle[key], `${path}.battle.${key}`);
  }
  directiveAt(province.rawDirectives, `${path}.rawDirectives`);
}

function assertDefense(defense: Record<string, unknown>, path: string): void {
  assertKnownFields(defense, path, DEFENSE_FIELDS);
  stringAt(defense.commander, `${path}.commander`);
  optionalBooleanAt(defense.clearMagic, `${path}.clearMagic`);
  optionalStringAt(defense.commanderName, `${path}.commanderName`);
  optionalStringAt(defense.bodyguard, `${path}.bodyguard`);
  optionalNumberAt(defense.bodyguardCount, `${path}.bodyguardCount`);
  boundedArrayAt(defense.squads, `${path}.squads`, MAX_SQUADS_PER_DEFENSE_GROUP).forEach((value, squadIndex) => {
    const squadPath = `${path}.squads[${squadIndex}]`;
    const squad = recordAt(value, squadPath);
    assertKnownFields(squad, squadPath, DEFENSE_SQUAD_FIELDS);
    idAt(squad.id, `${squadPath}.id`);
    stringAt(squad.unit, `${squadPath}.unit`);
    numberAt(squad.count, `${squadPath}.count`);
  });
  optionalNumberAt(defense.experience, `${path}.experience`);
  optionalNumberAt(defense.randomEquipment, `${path}.randomEquipment`);
  if (defense.items !== undefined) stringArrayAt(defense.items, `${path}.items`, MAX_ITEMS_PER_DEFENSE_GROUP);
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

function assertKnownFields(record: Record<string, unknown>, path: string, fields: ReadonlySet<string>): void {
  for (const key of Object.keys(record)) {
    if (!fields.has(key)) throw new Error(`${path}.${key} is not supported by project schema version 1.`);
  }
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > MAX_GENERIC_ARRAY_ENTRIES) throw new Error(`${path} must contain at most ${MAX_GENERIC_ARRAY_ENTRIES} entries.`);
  return value;
}

function boundedArrayAt(value: unknown, path: string, maximum: number): unknown[] {
  const array = arrayAt(value, path);
  if (array.length > maximum) throw new Error(`${path} must contain at most ${maximum} entries.`);
  return array;
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
  if (value.length > MAX_IMPORTED_STRING_LENGTH) {
    throw new Error(`${path} must contain at most ${MAX_IMPORTED_STRING_LENGTH} characters.`);
  }
}

function idAt(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  if (!value.length) throw new Error(`${path} must not be empty.`);
  if (value.length > MAX_IMPORTED_ID_LENGTH) throw new Error(`${path} must contain at most ${MAX_IMPORTED_ID_LENGTH} characters.`);
  if (!SAFE_IMPORTED_ID.test(value)) throw new Error(`${path} may contain only letters, digits, underscores, and hyphens.`);
}

function directiveAt(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  if (value.length > MAX_IMPORTED_DIRECTIVE_LENGTH) {
    throw new Error(`${path} must contain at most ${MAX_IMPORTED_DIRECTIVE_LENGTH} characters.`);
  }
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

function numberArrayAt(value: unknown, path: string, maximum = MAX_GENERIC_ARRAY_ENTRIES): void {
  boundedArrayAt(value, path, maximum).forEach((entry, index) => numberAt(entry, `${path}[${index}]`));
}

function stringArrayAt(value: unknown, path: string, maximum = MAX_GENERIC_ARRAY_ENTRIES): void {
  boundedArrayAt(value, path, maximum).forEach((entry, index) => stringAt(entry, `${path}[${index}]`));
}

function enumArrayAt(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  arrayAt(value, path).forEach((entry, index) => enumAt(entry, allowed, `${path}[${index}]`));
}

function assertProjectTextSize(text: string): void {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > MAX_PROJECT_IMPORT_BYTES) {
      throw new Error(`Project files must be at most ${MAX_PROJECT_IMPORT_BYTES} UTF-8 bytes.`);
    }
  }
}

export function estimatedPackageBytes(project: MapProject): number {
  return project.planes.reduce((sum, plane) => sum + estimatedD6mBytes(plane), 0)
    + estimatedTextPackageBytes(project);
}

/**
 * Conservative, allocation-light estimate for the maps and support files that
 * accompany D6Ms. In particular, advanced directives exist both in compiled
 * .map files and in atlas_project.json, so omitting text can substantially
 * understate ZIP memory for heavily authored projects.
 */
export function estimatedTextPackageBytes(project: MapProject): number {
  const mapBytes = project.planes.reduce(
    (sum, plane, planeIndex) => sum + estimatedCompiledMapBytes(project, plane, planeIndex),
    0,
  );
  const projectJsonBytes = estimatedPrettyJsonBytes(project);
  const provinceCount = project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0);
  const edgeCount = project.planes.reduce((sum, plane) => sum + plane.edges.length, 0);
  const gateEndpointCount = project.gates.reduce((sum, gate) => sum + gate.endpoints.length, 0);

  // INSTALL, balance, host settings, and host topology. The topology dossier
  // repeats province/edge descriptions, so budget by records instead of using
  // the former fixed 64 KB allowance.
  const supportTextBytes = 64 * 1024
    + project.planes.length * 4 * 1024
    + provinceCount * 1024
    + edgeCount * 512
    + project.gates.length * 512
    + gateEndpointCount * 512
    + estimatedTopologyRepeatedStringBytes(project);
  const zipDirectoryOverhead = 8 * 1024 + (project.planes.length * 2 + 5) * 256;
  return mapBytes + projectJsonBytes + supportTextBytes + zipDirectoryOverhead;
}

export function zipPackageSafety(project: MapProject): ZipPackageSafety {
  const estimatedBytes = estimatedPackageBytes(project);
  const estimatedPeakBytes = estimatedBytes * 3 + 16 * 1024 * 1024;
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
      message: "This ZIP may use substantial browser memory. Direct install is safer and streams one plane at a time.",
    };
  }
  return { level: "safe", estimatedPackageBytes: estimatedBytes, estimatedPeakBytes };
}

function estimatedCompiledMapBytes(
  project: MapProject,
  plane: MapProject["planes"][number],
  planeIndex: number,
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
    for (const defense of province.defenders) {
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
    if (raw.charCodeAt(index) === 10) newlines += 1;
  }
  // appendRaw trims and filters lines, then joins with CRLF. Counting the
  // original UTF-8 payload plus one extra CR byte per LF is an upper bound.
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
    "Choose the Dominions 6 user-data maps folder. Pantokrator Atlas stages and backs up its own files, publishes current D6Ms before their map references, then removes temporary and obsolete plane files last.",
    "",
    "ZIP install or update",
    "Before extracting, remove any existing map folder with the same name, then extract this entire folder into the Dominions 6 maps directory.",
    "Do not merge it into an older copy: obsolete _planeN.map and _planeN.d6m files would keep removed planes active.",
  ].join("\r\n");
  return [
    { name: "INSTALL.txt", data: encoder.encode(install) },
    { name: "atlas_project.json", data: encoder.encode(serializeProject(project, true)) },
    { name: "balance_report.txt", data: encoder.encode(report) },
    { name: "host_settings.txt", data: encoder.encode(host) },
    { name: "host_topology.txt", data: encoder.encode(buildHostTopologyReport(project)) },
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

interface InstallArtifact {
  targetName: string;
  stageName: string;
  backupName: string;
  data?: Uint8Array;
}

const INSTALL_TEMP_PREFIX = ".__pantokrator_atlas_install__";
const SUPPORT_FILE_NAMES = ["INSTALL.txt", "atlas_project.json", "balance_report.txt", "host_settings.txt", "host_topology.txt"] as const;
let installTransactionSequence = 0;

function nextInstallTransactionId(): string {
  installTransactionSequence += 1;
  return `${Date.now().toString(36)}_${installTransactionSequence.toString(36)}`;
}

function temporaryInstallName(root: string, transactionId: string, role: "stage" | "backup", targetName: string): string {
  return `${INSTALL_TEMP_PREFIX}${root}__${transactionId}__${role}__${targetName}.tmp`;
}

function installArtifact(root: string, transactionId: string, targetName: string, data?: Uint8Array): InstallArtifact {
  return {
    targetName,
    stageName: temporaryInstallName(root, transactionId, "stage", targetName),
    backupName: temporaryInstallName(root, transactionId, "backup", targetName),
    data,
  };
}

function knownAtlasInstallTemporaryNames(root: string, transactionId: string): Set<string> {
  const targets: string[] = [...SUPPORT_FILE_NAMES];
  for (let planeNumber = 1; planeNumber <= 8; planeNumber += 1) {
    const suffix = planeNumber === 1 ? "" : `_plane${planeNumber}`;
    targets.push(`${root}${suffix}.map`, `${root}${suffix}.d6m`);
  }
  return new Set(targets.flatMap((target) => [
    temporaryInstallName(root, transactionId, "stage", target),
    temporaryInstallName(root, transactionId, "backup", target),
  ]));
}

async function readFileIfExists(directory: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | undefined> {
  try {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
    throw error;
  }
}

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values?: () => AsyncIterableIterator<FileSystemHandle>;
};

/**
 * Never infer Atlas ownership from a colliding normalized folder name. A new
 * directory is safe; an existing directory is writable only when its editable
 * project marker proves that Atlas created the same normalized map root.
 */
async function assertSafeInstallDirectory(directory: FileSystemDirectoryHandle, root: string): Promise<void> {
  const values = (directory as IterableDirectoryHandle).values;
  if (typeof values !== "function") {
    throw installCollisionError(root, "this browser cannot verify whether the target folder is empty");
  }
  let hasEntries = false;
  for await (const entry of values.call(directory)) {
    void entry;
    hasEntries = true;
    break;
  }
  if (!hasEntries) return;

  let marker: string | undefined;
  try {
    const handle = await directory.getFileHandle("atlas_project.json");
    const file = await handle.getFile();
    if (file.size > MAX_PROJECT_IMPORT_BYTES) {
      throw new Error(`atlas_project.json exceeds the ${MAX_PROJECT_IMPORT_BYTES}-byte project limit`);
    }
    marker = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      throw installCollisionError(root, "the existing folder has no atlas_project.json ownership marker");
    }
    throw installCollisionError(root, "the existing atlas_project.json ownership marker could not be read safely", error);
  }

  try {
    const installedProject = parseProject(marker);
    if (sanitizeMapName(installedProject.name) !== root) {
      throw new Error(`the marker belongs to ${sanitizeMapName(installedProject.name)}`);
    }
  } catch (error) {
    throw installCollisionError(root, "the existing atlas_project.json does not identify this normalized map folder", error);
  }
}

function installCollisionError(root: string, reason: string, cause?: unknown): Error {
  return new Error(
    `Direct install refused to change the existing ${root} folder because ${reason}. `
      + "Choose a different project name, or manually move/remove the colliding folder and try again. No files were changed.",
    cause === undefined ? undefined : { cause },
  );
}

async function copyFile(directory: FileSystemDirectoryHandle, sourceName: string, targetName: string): Promise<void> {
  const data = await readFileIfExists(directory, sourceName);
  if (!data) throw new Error(`Atlas install staging file ${sourceName} is missing.`);
  await writeFile(directory, targetName, data);
}

async function removeFileIfExists(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await directory.removeEntry(name);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return;
    throw error;
  }
}

async function rollbackInstall(
  directory: FileSystemDirectoryHandle,
  touchedTargets: string[],
  backups: ReadonlyMap<string, string | null>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const target of [...touchedTargets].reverse()) {
    try {
      const backup = backups.get(target);
      if (backup) await copyFile(directory, backup, target);
      else await removeFileIfExists(directory, target);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function cleanupInstallArtifacts(directory: FileSystemDirectoryHandle, names: ReadonlySet<string>): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const name of names) {
    try {
      await removeFileIfExists(directory, name);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
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
