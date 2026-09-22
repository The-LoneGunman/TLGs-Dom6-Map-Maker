import { cloneProject, landformWaterError, sanitizeMapName, type MapProject, type Plane } from "./domain";
import { calculateFairness } from "./generator";
import { buildHostTopologyReport } from "./hostReport";
import { analysisContextLines, analyzeStarts, buildStartAnalysisText } from "./workbench";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "./catalog";
import { assertPlaneGenerationOverrides } from "./generationControls";
import { buildInitialDefensePlan, type InitialDefensePlan, type VerifiedPopulationDefenseProfile } from "./populationDefenders";
import { VERIFIED_POPULATION_DEFENSE_PROFILES } from "./populationDefenseProfiles";
import { assertBlockedTerrainContentSafe } from "./terrainSafety";
import {
  createIllustratedExport,
  illustratedExportError,
  illustratedPackageBytes,
  illustratedNumberingReport,
  imageFileStem,
  nativeFileStem,
  IMAGE_SUFFIXES,
  type ExportArtwork,
} from "./illustratedMap";
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

export type PackageAudience = "host" | "player";

export type { ExportArtwork } from "./illustratedMap";

/** Registry override supports internal verification fixtures; project imports cannot supply trusted profiles. */
export async function buildPackageFiles(project: MapProject, onProgress?: ProgressCallback, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG, audience: PackageAudience = "host",
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = VERIFIED_POPULATION_DEFENSE_PROFILES, artwork: ExportArtwork = "native"): Promise<PackageFile[]> {
  assertBlockedTerrainContentSafe(project, catalog);
  assertArtworkExportSupported(project, artwork);
  const illustrated = artwork === "illustrated" ? createIllustratedExport(project) : undefined;
  const base = sanitizeMapName(project.name);
  const encoder = new TextEncoder();
  const files: PackageFile[] = [];
  onProgress?.({ stage: "preparing", plane: 0, planeCount: project.planes.length, percent: 0, message: "Compiling Dominions map directives…" });
  for (let index = 0; index < project.planes.length; index += 1) {
    const suffix = index === 0 ? "" : `_plane${index + 1}`;
    files.push({ name: `${base}${suffix}.map`, data: encoder.encode(illustrated
      ? await illustrated.mapText(index, catalog, populationProfiles) : compileMapText(project, index, catalog, populationProfiles)) });
  }
  if (audience === "host") files.push(...supportFiles(project, catalog, populationProfiles, artwork));
  else files.push({ name: "PLAYER_README.txt", data: encoder.encode([
    "PANTOKRATOR ATLAS — PLAYER MAP PACKAGE", "",
    "Extract this entire folder into your Dominions 6 user-data maps directory.",
    "Find it using Tools & Manuals > Open User Data Directory in Dominions 6.",
    "For an update, replace the old map folder instead of merging; stale plane files can change the map.",
    "Use the game version, mods and settings specified by your host.", "",
    "This handoff omits the editable project, seed dossier, balance report and host topology/settings reports.",
    artwork === "native" ? "Native .map/.d6m files are identical to the host package. They still contain map content, including starts and guardians."
      : "Playable .map/.tga/.d6m files and artwork ownership records are identical to the host package. They still contain map content, including starts and guardians.",
    "This is a reduced-spoiler handoff, NOT encryption or protection against inspecting map files.",
  ].join("\r\n")) });

  const imageRecords: ArtworkImageRecord[] = [];
  for (let index = 0; index < project.planes.length; index += 1) {
    const plane = project.planes[index]!;
    const suffix = index === 0 ? "" : `_plane${index + 1}`;
    if (illustrated?.isIllustrated(index)) {
      let completed = 0;
      const seenSuffixes = new Set<string>();
      for await (const image of illustrated.images(index)) {
        assertImageVariant(image.suffix, seenSuffixes);
        const name = `${imageFileStem(project, index)}${image.suffix}.tga`;
        files.push({ name, data: image.data });
        imageRecords.push({ name, sha256: await bytesFingerprint(image.data) });
        completed += 1;
        onProgress?.({ stage: "rasterizing", plane: index + 1, planeCount: project.planes.length,
          percent: Math.round(((index + completed / IMAGE_SUFFIXES.length) / project.planes.length) * 92),
          message: `Rendering ${plane.name}: artwork ${completed}/${IMAGE_SUFFIXES.length}…` });
      }
      assertCompleteImages(seenSuffixes);
      continue;
    }
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
    const name = `${nativeFileStem(project, index, artwork)}.d6m`;
    files.push({ name, data });
    if (name !== `${base}${suffix}.d6m`) imageRecords.push({ name, sha256: await bytesFingerprint(data) });
  }
  if (illustrated) files.push({ name: ARTWORK_MANIFEST_NAME, data: encodeArtworkManifest(base, artwork, imageRecords) });
  onProgress?.({ stage: "done", plane: project.planes.length, planeCount: project.planes.length, percent: 100, message: "Dominions package ready." });
  return files;
}

export async function downloadPackage(project: MapProject, onProgress?: ProgressCallback, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG, audience: PackageAudience = "host", artwork: ExportArtwork = "native") {
  const safety = zipPackageSafety(project, catalog, artwork);
  if (safety.level === "blocked") throw new Error(safety.message);
  const files = await buildPackageFiles(project, onProgress, catalog, audience, VERIFIED_POPULATION_DEFENSE_PROFILES, artwork);
  const root = sanitizeMapName(project.name);
  onProgress?.({ stage: "packaging", plane: project.planes.length, planeCount: project.planes.length, percent: 96, message: "Packing the ready-to-install map folder…" });
  const zip = createStoredZip(files.map((file) => ({ ...file, name: `${root}/${file.name}` })));
  downloadBlob(new Blob([ownedBuffer(zip)], { type: "application/zip" }), `${root}${audience === "player" ? "_players" : ""}.zip`);
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

export async function installPackage(project: MapProject, onProgress?: ProgressCallback, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG, artwork: ExportArtwork = "native"): Promise<"installed" | "unsupported" | "cancelled"> {
  assertBlockedTerrainContentSafe(project, catalog);
  assertArtworkExportSupported(project, artwork);
  const picker = (window as typeof window & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  const locks = globalThis.navigator?.locks;
  if (!picker || !locks) return "unsupported";
  try {
    const mapsDirectory = await picker({ mode: "readwrite", id: "dominions6-maps" });
    // Keep the picker in the initiating user gesture, then exclude competing
    // installs from every tab on this origin throughout staging and rollback.
    return await locks.request("pantokrator-atlas:direct-install", { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another Atlas tab is installing a map. Wait for it to finish, then retry. No files were changed.");
    const root = sanitizeMapName(project.name);
    const mapDirectory = await mapsDirectory.getDirectoryHandle(root, { create: true });
    const safety = await assertSafeInstallDirectory(mapDirectory, root);
    const previousArtworkRead = await readArtworkManifest(mapDirectory, root);
    const previousArtwork = previousArtworkRead?.manifest;
    const illustrated = artwork === "illustrated" ? createIllustratedExport(project) : undefined;
    const imageRecords = new Map((previousArtwork?.images ?? []).map(record => [record.name, record]));
    const imageTargetNames = project.planes.flatMap((_, index) => illustrated?.isIllustrated(index)
      ? IMAGE_SUFFIXES.map(suffix => `${imageFileStem(project, index)}${suffix}.tga`)
      : nativeFileStem(project, index, artwork) === imageFileStem(project, index) ? [`${imageFileStem(project, index)}.d6m`] : []);
    const originals = new Map<string, string | null>();
    const possibleTargets = new Set([...knownAtlasInstallTargetNames(root), ...imageRecords.keys(), ...imageTargetNames]);
    for (const name of possibleTargets) originals.set(name, await fileFingerprint(mapDirectory, name));
    if (originals.get(ARTWORK_MANIFEST_NAME) !== (previousArtworkRead?.fingerprint ?? null)) {
      throw new Error("The artwork ownership record changed while Atlas was preparing the installation. No files were changed.");
    }
    for (const name of new Set([...imageRecords.keys(), ...imageTargetNames])) {
      const current = originals.get(name) ?? null;
      if (current !== null && imageRecords.get(name)?.sha256 !== current) {
        throw new Error(`Direct install refused to overwrite or remove ${name}: it is not an unchanged Atlas-owned artwork file. Choose a new project name or move the conflicting file yourself. No files were changed.`);
      }
    }
    const encoder = new TextEncoder();
    const transactionId = nextInstallTransactionId();
    const support = supportFiles(project, catalog, VERIFIED_POPULATION_DEFENSE_PROFILES, artwork);
    const textArtifacts: InstallArtifact[] = [];
    for (let index = 0; index < project.planes.length; index += 1) {
      const suffix = index === 0 ? "" : `_plane${index + 1}`;
      textArtifacts.push(installArtifact(root, transactionId, `${root}${suffix}.map`, encoder.encode(illustrated
        ? await illustrated.mapText(index, catalog, VERIFIED_POPULATION_DEFENSE_PROFILES) : compileMapText(project, index, catalog))));
    }
    textArtifacts.push(...support.map((file) => installArtifact(root, transactionId, file.name, file.data)));
    const binaryArtifactsByPlane = project.planes.map((_, index) => {
      return illustrated?.isIllustrated(index)
        ? IMAGE_SUFFIXES.map(imageSuffix => installArtifact(root, transactionId, `${imageFileStem(project, index)}${imageSuffix}.tga`))
        : [installArtifact(root, transactionId, `${nativeFileStem(project, index, artwork)}.d6m`)];
    });
    const binaryArtifacts = binaryArtifactsByPlane.flat();
    const artworkArtifact = illustrated || previousArtwork ? installArtifact(root, transactionId, ARTWORK_MANIFEST_NAME) : undefined;
    if (artworkArtifact) textArtifacts.push(artworkArtifact);
    const allArtifacts = [...binaryArtifacts, ...textArtifacts];
    const temporaryNames = new Set(allArtifacts.flatMap(artifact => [artifact.stageName, artifact.backupName]));
    const currentTargetNames = new Set(allArtifacts.map(artifact => artifact.targetName));
    const obsoleteNames = [...possibleTargets].filter(name => {
      if (currentTargetNames.has(name)) return false;
      if (name.endsWith(".tga")) return imageRecords.has(name);
      return name.endsWith(".map") || name.endsWith(".d6m");
    });
    const backups = new Map<string, string | null>();
    const touchedTargets: string[] = [];
    const stagedFingerprints = new Map<string, string>();
    const publish = async (artifact: InstallArtifact) => {
      await assertInstallFileUnchanged(mapDirectory, artifact.targetName, originals.get(artifact.targetName) ?? null);
      touchedTargets.push(artifact.targetName);
      await copyFile(mapDirectory, artifact.stageName, artifact.targetName);
    };

    try {
      // Stage each raster independently; no set of terrain variants is retained
      // in RAM and no playable file changes during rendering.
      for (let index = 0; index < project.planes.length; index += 1) {
        const plane = project.planes[index]!;
        if (illustrated?.isIllustrated(index)) {
          const artifacts = new Map(binaryArtifactsByPlane[index]!.map(artifact => [artifact.targetName, artifact]));
          let completed = 0;
          const seenSuffixes = new Set<string>();
          for await (const image of illustrated.images(index)) {
            assertImageVariant(image.suffix, seenSuffixes);
            const name = `${imageFileStem(project, index)}${image.suffix}.tga`;
            const artifact = artifacts.get(name);
            if (!artifact) throw new Error(`Unexpected illustrated export artifact ${name}.`);
            await writeFile(mapDirectory, artifact.stageName, image.data);
            imageRecords.set(name, { name, sha256: await bytesFingerprint(image.data) });
            completed += 1;
            onProgress?.({ stage: "rasterizing", plane: index + 1, planeCount: project.planes.length,
              percent: Math.round(((index + completed / IMAGE_SUFFIXES.length) / project.planes.length) * 84),
              message: `Staging ${plane.name}: artwork ${completed}/${IMAGE_SUFFIXES.length}…` });
          }
          assertCompleteImages(seenSuffixes);
          continue;
        }
        const artifact = binaryArtifactsByPlane[index]![0]!;
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
        if (imageTargetNames.includes(artifact.targetName)) imageRecords.set(artifact.targetName, { name: artifact.targetName, sha256: await bytesFingerprint(data) });
      }
      if (artworkArtifact) artworkArtifact.data = encodeArtworkManifest(root, artwork, [...imageRecords.values()]);

      // Map/support compilation already succeeded above. Staging these small
      // files detects quota or permission failures before current files move.
      for (const artifact of textArtifacts) await writeFile(mapDirectory, artifact.stageName, artifact.data!);

      // File System Access has no atomic rename. Disk-backed Atlas-only backups
      // provide deterministic rollback without retaining all old D6Ms in RAM.
      for (const artifact of allArtifacts) {
        await assertInstallFileUnchanged(mapDirectory, artifact.targetName, originals.get(artifact.targetName) ?? null);
        stagedFingerprints.set(artifact.targetName, (await fileFingerprint(mapDirectory, artifact.stageName))!);
        const existing = await readFileIfExists(mapDirectory, artifact.targetName);
        if ((existing === undefined ? null : await bytesFingerprint(existing)) !== (originals.get(artifact.targetName) ?? null)) {
          throw new Error(`${artifact.targetName} changed while its backup was being read. No backup from the competing writer was accepted.`);
        }
        if (existing) {
          await writeFile(mapDirectory, artifact.backupName, existing);
          backups.set(artifact.targetName, artifact.backupName);
        } else {
          backups.set(artifact.targetName, null);
        }
      }

      // A first install gets its ownership/recovery marker before playable files.
      const marker = textArtifacts.find((artifact) => artifact.targetName === "atlas_project.json")!;
      if (!safety.hasMarker) await publish(marker);
      // Publish binaries first. Only after all current images exist do .map and
      // support files begin referencing them.
      for (let index = 0; index < binaryArtifactsByPlane.length; index += 1) {
        onProgress?.({ stage: "writing", plane: index + 1, planeCount: project.planes.length, percent: 90 + Math.round(((index + 1) / project.planes.length) * 5), message: `Publishing ${project.planes[index]!.name}…` });
        for (const artifact of binaryArtifactsByPlane[index]!) await publish(artifact);
      }
      for (const artifact of textArtifacts) {
        if (!safety.hasMarker && artifact === marker) continue;
        await publish(artifact);
      }
      for (const artifact of allArtifacts) await assertInstallFileUnchanged(mapDirectory, artifact.targetName, stagedFingerprints.get(artifact.targetName)!);
    } catch (error) {
      const rollbackErrors = await rollbackInstall(mapDirectory, touchedTargets, backups, originals, stagedFingerprints);
      const cleanupNames = rollbackErrors.length
        ? new Set([...temporaryNames].filter((name) => name.includes("__stage__")))
        : temporaryNames;
      const cleanupErrors = await cleanupInstallArtifacts(mapDirectory, cleanupNames);
      const recoveryErrors = [...rollbackErrors, ...cleanupErrors];
      if (recoveryErrors.length) {
        throw new AggregateError(
          [error, ...recoveryErrors],
          "Direct installation failed and the browser could not fully restore or clean every Atlas-owned file. Atlas backup temporary files were retained when restoration failed; unrelated files were not touched. Do not host this folder yet. Stop other installers and review the retained backups; choose a new atlas name for a clean installation if recovery is uncertain.",
        );
      }
      throw error;
    }

    // Cleanup is deliberately last: temporary/backup artifacts and obsolete
    // numbered planes remain available until every current file is published.
    const cleanupErrors = await cleanupInstallArtifacts(mapDirectory, temporaryNames);
    try {
      // Check the full removal set before deleting any stale artifact. Image
      // names require manifest provenance; native names retain legacy ownership.
      for (const name of obsoleteNames) await assertInstallFileUnchanged(mapDirectory, name, originals.get(name) ?? null);
      for (const name of obsoleteNames) {
        await assertInstallFileUnchanged(mapDirectory, name, originals.get(name) ?? null);
        await removeFileIfExists(mapDirectory, name);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        cleanupErrors,
        "The current atlas was installed, but Atlas could not remove every Atlas-owned temporary or obsolete plane file. Unrelated files were not touched; retry the direct install before hosting.",
      );
    }
    onProgress?.({ stage: "done", plane: project.planes.length, planeCount: project.planes.length, percent: 100, message: safety.orphanStages ? "Installed. Older interrupted staging files were preserved; they are not playable map files." : "Installed. The map is ready in Dominions 6." });
    return "installed" as const;
    });
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
const SPARSE_LAYOUTS = new Set(["chambers", "regions"]);
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
  "analysisContext", "generationInputs", "authoring", "populationDefense",
]);
const GENERATION_SETTING_FIELDS = new Set([
  "players", "provincesPerPlayer", "waterPercent", "oceanLayout", "continentCount", "specialPlaneSizePercent",
  "provinceNameSeed", "randomizeNamesOnLoad", "biomeCohesion", "throneCount", "siteFrequency", "economyBalance", "overlandTopology",
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
  "rawDirectives", "generationOverrides", "sparseLayout", "landformStyle", "landformWater",
]);
const EDGE_FIELDS = new Set(["id", "a", "b", "kind", "special"]);
const PROVINCE_FIELDS = new Set([
  "id", "index", "x", "y", "gridX", "gridY", "name", "nameSource", "editorLocks", "biome", "terrain", "terrainFlags",
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
  if (project.populationDefense !== undefined) {
    const policy = recordAt(project.populationDefense, "project.populationDefense");
    assertKnownFields(policy, "project.populationDefense", new Set(["enabled", "profileRevision"]));
    booleanAt(policy.enabled, "project.populationDefense.enabled");
    stringAt(policy.profileRevision, "project.populationDefense.profileRevision");
    const revision = policy.profileRevision as string;
    if (!revision.trim() || revision.length > 120 || revision !== revision.trim()
      || [...revision].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new Error("project.populationDefense.profileRevision must be a nonblank, whitespace-trimmed revision of at most 120 characters.");
    }
  }
  if (project.authoring !== undefined) {
    const options = recordAt(project.authoring, "project.authoring");
    assertKnownFields(options, "project.authoring", new Set(["lockLayout", "lockStarts", "regions"]));
    optionalBooleanAt(options.lockLayout, "project.authoring.lockLayout");
    optionalBooleanAt(options.lockStarts, "project.authoring.lockStarts");
    if (options.regions !== undefined) {
      const seen = new Set<string>();
      boundedArrayAt(options.regions, "project.authoring.regions", 64).forEach((value, index) => {
        const path = `project.authoring.regions[${index}]`;
        const region = recordAt(value, path);
        assertKnownFields(region, path, new Set(["id", "name", "planeId", "provinceIds"]));
        idAt(region.id, `${path}.id`); idAt(region.planeId, `${path}.planeId`); stringAt(region.name, `${path}.name`);
        if (seen.has(region.id as string)) throw new Error("Authored region IDs must be unique.");
        seen.add(region.id as string);
        const ids = boundedArrayAt(region.provinceIds, `${path}.provinceIds`, MAX_IMPORTED_PROVINCES_PER_PLANE);
        ids.forEach((id, i) => idAt(id, `${path}.provinceIds[${i}]`));
        if (new Set(ids).size !== ids.length) throw new Error("A region cannot contain duplicate provinces.");
      });
    }
  }
  if (project.analysisContext !== undefined) {
    const context = recordAt(project.analysisContext, "project.analysisContext");
    assertKnownFields(context, "project.analysisContext", new Set(["gameVersion", "era", "mods", "requirements"]));
    optionalStringAt(context.gameVersion, "project.analysisContext.gameVersion");
    if (context.era !== undefined && context.era !== 1 && context.era !== 2 && context.era !== 3) {
      throw new Error("project.analysisContext.era must be 1 (Early Age), 2 (Middle Age), or 3 (Late Age), or omitted when unknown.");
    }
    optionalStringAt(context.mods, "project.analysisContext.mods");
    if (context.requirements !== undefined) boundedArrayAt(context.requirements, "project.analysisContext.requirements", 64).forEach((value,index)=>{
      const path=`project.analysisContext.requirements[${index}]`;const r=recordAt(value,path);
      assertKnownFields(r,path,new Set(["nation","label","gameVersion","mods","terrain","minimum","radius"]));
      for(const k of ["label","gameVersion","mods"])stringAt(r[k],`${path}.${k}`);
      if(!(r.label as string).trim()||(r.label as string).length>120||!(r.gameVersion as string).trim()||(r.gameVersion as string).length>64)throw new Error("Requirements need a short label and explicit patch snapshot.");
      enumAt(r.terrain,TERRAIN_FLAGS,`${path}.terrain`);
      for(const [key,min,max] of [["nation",5,1000000],["minimum",1,20],["radius",1,3]] as const){numberAt(r[key],`${path}.${key}`);if(!Number.isInteger(r[key])||(r[key] as number)<min||(r[key] as number)>max)throw new Error(`${path}.${key} is outside the supported range.`);}
    });
  }
  if (project.generationInputs !== undefined) {
    const inputs = recordAt(project.generationInputs, "project.generationInputs");
    assertKnownFields(inputs, "project.generationInputs", new Set(["version", "seed", "starts", "terrain", "planes", "links"]));
    if (inputs.version !== 1) throw new Error("project.generationInputs.version must be 1.");
    for (const key of ["seed", "starts", "terrain", "planes", "links"]) {
      if (typeof inputs[key] !== "string" || inputs[key].length > 65_536) {
        throw new Error(`project.generationInputs.${key} must be a string of at most 65536 characters.`);
      }
    }
  }
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
  const regions=(project.authoring as {regions?: {planeId:string;provinceIds:string[]}[]}|undefined)?.regions;
  for(const r of regions??[]){
    const plane=planes.find(v=>(v as Record<string,unknown>).id===r.planeId) as {provinces:{id:string}[]}|undefined;
    if(!plane||r.provinceIds.some(id=>!plane.provinces.some(p=>p.id===id)))throw new Error("An authored region references a missing plane or province.");
  }

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
  optionalBooleanAt(settings.randomizeNamesOnLoad, "project.settings.randomizeNamesOnLoad");
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
  if (plane.generationOverrides !== undefined) assertPlaneGenerationOverrides(plane.generationOverrides);
  numberAt(plane.provinceTarget, `${path}.provinceTarget`);
  numberAt(plane.width, `${path}.width`);
  numberAt(plane.height, `${path}.height`);
  booleanAt(plane.wrapX, `${path}.wrapX`);
  booleanAt(plane.wrapY, `${path}.wrapY`);
  optionalEnumAt(plane.ownershipMode, OWNERSHIP_MODES, `${path}.ownershipMode`);
  optionalEnumAt(plane.landformStyle, new Set(["natural-v1"]), `${path}.landformStyle`);
  optionalEnumAt(plane.sparseLayout, SPARSE_LAYOUTS, `${path}.sparseLayout`);
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
  const waterProvenanceError = landformWaterError(plane as unknown as Plane);
  if (waterProvenanceError) throw new Error(`${path}.${waterProvenanceError}`);
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
  if (province.editorLocks !== undefined) {
    const locks = boundedArrayAt(province.editorLocks, `${path}.editorLocks`, 5);
    locks.forEach(lock => enumAt(lock, new Set(["name", "terrain", "economy", "sites", "guardians"]), `${path}.editorLocks`));
    if (new Set(locks).size !== locks.length) throw new Error(`${path}.editorLocks contains duplicates.`);
  }
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

export function estimatedPackageBytes(project: MapProject, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = VERIFIED_POPULATION_DEFENSE_PROFILES, artwork: ExportArtwork = "native"): number {
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
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = VERIFIED_POPULATION_DEFENSE_PROFILES): number {
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
  const estimatedBytes = estimatedPackageBytes(project, catalog, VERIFIED_POPULATION_DEFENSE_PROFILES, artwork);
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

function supportFiles(project: MapProject, catalog: Dom6CatalogBundle,
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = VERIFIED_POPULATION_DEFENSE_PROFILES, artwork: ExportArtwork = "native"): PackageFile[] {
  const encoder = new TextEncoder();
  const numberingNote = artwork === "illustrated" ? ["Province numbers in this report are editor IDs. See the mapping in host_settings.txt for in-game image province numbers.", ""] : [];
  const fairness = calculateFairness(project);
  const issues = validateProject(project, catalog, populationProfiles);
  const populationDefenseNotes = project.populationDefense?.enabled ? [
    `Population-matched initial defenders: enabled, pinned profile revision ${JSON.stringify(project.populationDefense.profileRevision)}.`,
    "Only supported verified recruitment profiles add fixed-count initial armies. Custom guardians and protected/authored scenarios are preserved; unsupported populations retain native engine armies.",
    "The profile snapshot must match the declared host patch, mods, active catalog identities and effective terrain. It does not replace post-capture PD or certify battle difficulty.",
  ] : [];
  const report = [
    "PANTOKRATOR ATLAS — DOMINIONS 6 MAP REPORT",
    "",
    ...numberingNote,
    `Map: ${project.name}`,
    `Seed: ${project.seed}`,
    `Planes: ${project.planes.length}`,
    `Provinces: ${project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0)}`,
    `Player starts (generic, team, and specific; deduplicated): ${analyzeStarts(project).totalStarts}`,
    `Fairness score (legacy structural heuristic, not certified balance): ${fairness.overall}/100`,
    `  Start separation: ${fairness.startSeparation}`,
    `  Expansion parity: ${fairness.expansionParity}`,
    `  Nearby throne parity (within 4 graph hops, not turns): ${fairness.throneAccess}`,
    `  Terrain variety: ${fairness.terrainVariety}`,
    `  Connectivity: ${fairness.connectivity}`,
    `  Start degree parity: ${fairness.startDegree}`,
    `  Requested start allocation: ${fairness.startAllocation}`,
    "A high average does not override an export error or certify nation, economy, or combat balance.",
    ...fairness.notes.map(note => `  Score note: ${note}`),
    "",
    `Active selector catalog: ${JSON.stringify(catalog.catalogVersion.slice(0, 256))}`,
    "Catalog entries are lookup/validation metadata, not proof of installed game content. Custom catalogs and required mods must be supplied separately.",
    buildStartAnalysisText(project, catalog.gameVersion.slice(0, 256)),
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
    artwork === "native" ? "The .d6m files let Dominions render winter and terrain transformations natively."
      : "Illustrated planes include custom TGA scenery, winter/terrain sheets and exact province ownership. Native .d6m planes retain engine-rendered scenery. Keep every supplied image and the atlas_artwork.json ownership record together.",
    `This package declares Dominions ${formatDomVersion(project.targetVersion)} or newer.`,
    "",
    "NOTE ABOUT PROVINCE DEFENSE",
    "Authored commander/unit groups are unique initial independent guardians.",
    "Post-conquest recruitable province-defense composition comes from the selected poptype or nation.",
    ...populationDefenseNotes,
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
    "",
    ...analysisContextLines(project, catalog.gameVersion.slice(0,256)),
    ...populationDefenseNotes,
    ...(artwork === "illustrated" ? ["", illustratedNumberingReport(project)] : []),
  ].join("\r\n");
  const install = [
    "PANTOKRATOR ATLAS - INSTALLATION",
    "",
    `Folder name: ${sanitizeMapName(project.name)}`,
    `Main map file: ${sanitizeMapName(project.name)}.map`,
    "",
    "Direct install",
    artwork === "native" ? "Choose the Dominions 6 user-data maps folder. Pantokrator Atlas stages and backs up its own files, publishes current D6Ms before their map references, then removes temporary and obsolete plane files last."
      : "Choose the Dominions 6 user-data maps folder. Pantokrator Atlas stages each image separately, backs up its own files, publishes artwork before map references, then removes temporary and obsolete owned files last. Modified or unowned artwork collisions are refused.",
    "",
    "ZIP install or update",
    "Before extracting, remove any existing map folder with the same name, then extract this entire folder into the Dominions 6 maps directory.",
    artwork === "native" ? "Do not merge it into an older copy: obsolete _planeN.map and _planeN.d6m files would keep removed planes active."
      : "Do not merge it into an older copy: stale planes and terrain images can change the map. Copy all TGA variants and atlas_artwork.json with the map files.",
  ].join("\r\n");
  return [
    { name: "INSTALL.txt", data: encoder.encode(install) },
    { name: "atlas_project.json", data: encoder.encode(serializeProject(project, true)) },
    { name: "balance_report.txt", data: encoder.encode(report) },
    { name: "host_settings.txt", data: encoder.encode(host) },
    { name: "host_topology.txt", data: encoder.encode(numberingNote.join("\r\n") + buildHostTopologyReport(project, catalog, populationProfiles)) },
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
const ARTWORK_MANIFEST_NAME = "atlas_artwork.json";
const MAX_ARTWORK_MANIFEST_BYTES = 1024 * 1024;

interface ArtworkImageRecord {
  name: string;
  sha256: string;
}

interface ArtworkManifest {
  schemaVersion: 1;
  mapRoot: string;
  artwork: ExportArtwork;
  images: ArtworkImageRecord[];
}

function assertArtworkExportSupported(project: MapProject, artwork: ExportArtwork): void {
  if (artwork !== "native" && artwork !== "illustrated") throw new Error("Unknown map artwork export mode.");
  const error = artwork === "illustrated" ? illustratedExportError(project) : undefined;
  if (error) throw new Error(error);
}

function assertImageVariant(suffix: string, seen: Set<string>): void {
  if (!IMAGE_SUFFIXES.includes(suffix) || seen.has(suffix)) throw new Error("Illustrated export produced an unknown or duplicate terrain image.");
  seen.add(suffix);
}

function assertCompleteImages(seen: ReadonlySet<string>): void {
  if (seen.size !== IMAGE_SUFFIXES.length) throw new Error("Illustrated export did not produce every required terrain image.");
}

function knownArtworkTargetNames(root: string): string[] {
  return Array.from({ length: 8 }, (_, index) => [
    ...IMAGE_SUFFIXES.map(suffix => `${root}_realm${index + 1}${suffix}.tga`),
    ...(index > 0 ? [`${root}_realm${index + 1}.d6m`] : []),
  ]).flat();
}

function encodeArtworkManifest(root: string, artwork: ExportArtwork, images: readonly ArtworkImageRecord[]): Uint8Array {
  const manifest: ArtworkManifest = { schemaVersion: 1, mapRoot: root, artwork,
    images: [...images].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) };
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2));
}

async function readArtworkManifest(directory: FileSystemDirectoryHandle, root: string): Promise<{ manifest: ArtworkManifest; fingerprint: string } | undefined> {
  let value: unknown;
  let bytes: Uint8Array;
  try {
    const handle = await directory.getFileHandle(ARTWORK_MANIFEST_NAME);
    const file = await handle.getFile();
    if (file.size > MAX_ARTWORK_MANIFEST_BYTES) throw new Error("the artwork record is too large");
    bytes = new Uint8Array(await file.arrayBuffer());
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
    throw new Error("Direct install refused the existing artwork ownership record. No files were changed.", { cause: error });
  }
  const known = new Set(knownArtworkTargetNames(root));
  const seen = new Set<string>();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidArtworkManifest();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "artwork,images,mapRoot,schemaVersion" || record.schemaVersion !== 1
    || record.mapRoot !== root || (record.artwork !== "native" && record.artwork !== "illustrated")
    || !Array.isArray(record.images) || record.images.length > known.size) throw invalidArtworkManifest();
  for (const entry of record.images) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidArtworkManifest();
    const image = entry as Record<string, unknown>;
    if (Object.keys(image).sort().join(",") !== "name,sha256" || typeof image.name !== "string"
      || !known.has(image.name) || seen.has(image.name) || typeof image.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(image.sha256)) throw invalidArtworkManifest();
    seen.add(image.name);
  }
  return { manifest: value as ArtworkManifest, fingerprint: await bytesFingerprint(bytes) };
}

function invalidArtworkManifest(): Error {
  return new Error("Direct install refused an invalid or foreign artwork ownership record. No files were changed.");
}

function nextInstallTransactionId(): string {
  return globalThis.crypto.randomUUID();
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

function knownAtlasInstallTargetNames(root: string): string[] {
  const targets: string[] = [...SUPPORT_FILE_NAMES, ARTWORK_MANIFEST_NAME];
  for (let planeNumber = 1; planeNumber <= 8; planeNumber += 1) {
    const suffix = planeNumber === 1 ? "" : `_plane${planeNumber}`;
    targets.push(`${root}${suffix}.map`, `${root}${suffix}.d6m`);
  }
  return targets;
}

async function readFileIfExists(directory: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | undefined> {
  try {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    if ((name === ARTWORK_MANIFEST_NAME || name.endsWith(`${ARTWORK_MANIFEST_NAME}.tmp`))
      && file.size > MAX_ARTWORK_MANIFEST_BYTES) throw new Error("The artwork ownership record exceeds the safe read limit.");
    // Generated TGA files fit below 32 MiB at the maximum supported resolution.
    // Refuse an unexpected oversized collision before loading it into memory.
    if (/(?:\.tga|_realm[2-8]\.d6m)(?:\.tmp)?$/.test(name) && file.size > 64 * 1024 * 1024) {
      throw new Error(`Artwork file ${name} exceeds the safe 64 MiB read limit.`);
    }
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
async function assertSafeInstallDirectory(directory: FileSystemDirectoryHandle, root: string): Promise<{ hasMarker: boolean; orphanStages: boolean }> {
  const values = (directory as IterableDirectoryHandle).values;
  if (typeof values !== "function") {
    throw installCollisionError(root, "this browser cannot verify whether the target folder is empty");
  }
  let hasEntries = false;
  let onlyStages = true;
  const stagePrefix = `${INSTALL_TEMP_PREFIX}${root}__`;
  const stageTargets = new Set([...knownAtlasInstallTargetNames(root), ...knownArtworkTargetNames(root)]);
  for await (const entry of values.call(directory)) {
    hasEntries = true;
    const parts = entry.name.startsWith(stagePrefix) ? entry.name.slice(stagePrefix.length).split("__stage__") : [];
    const validStage = entry.kind === "file" && parts.length === 2
      && /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(parts[0]!)
      && parts[1]!.endsWith(".tmp") && stageTargets.has(parts[1]!.slice(0, -4));
    if (!validStage) onlyStages = false;
  }
  if (!hasEntries) return { hasMarker: false, orphanStages: false };
  // Names allow a safe retry, never deletion authority. Preserve old stages.
  if (onlyStages) return { hasMarker: false, orphanStages: true };

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
  return { hasMarker: true, orphanStages: false };
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
  originals: ReadonlyMap<string, string | null>,
  staged: ReadonlyMap<string, string>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const target of [...touchedTargets].reverse()) {
    try {
      // Keep a first-install recovery marker if any playable file failed recovery.
      if (target === "atlas_project.json" && originals.get(target) === null && errors.length) continue;
      const current = await fileFingerprint(directory, target);
      const original = originals.get(target) ?? null;
      if (current === original) continue;
      const emptyCreatedFile = original === null && current === await bytesFingerprint(new Uint8Array());
      if (current !== staged.get(target) && !emptyCreatedFile) {
        throw new Error(`${target} changed outside this installation. Its current contents and the Atlas backup were preserved for manual recovery.`);
      }
      const backup = backups.get(target);
      if (backup) await copyFile(directory, backup, target);
      else await removeFileIfExists(directory, target);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function bytesFingerprint(data: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer(data)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fileFingerprint(directory: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  const data = await readFileIfExists(directory, name);
  return data === undefined ? null : bytesFingerprint(data);
}

async function assertInstallFileUnchanged(directory: FileSystemDirectoryHandle, name: string, expected: string | null): Promise<void> {
  if (await fileFingerprint(directory, name) !== expected) {
    throw new Error(`${name} changed while Atlas was installing. Stop other installers, review the folder, and retry. Use only one browser profile or app address to install into this folder.`);
  }
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
