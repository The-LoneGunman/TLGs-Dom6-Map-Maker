import { sanitizeMapName, type MapProject } from "./domain";
import { calculateFairness } from "./generator";
import { buildHostTopologyReport } from "./hostReport";
import { analysisContextLines, analyzeStarts, buildStartAnalysisText } from "./workbench";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "./catalog";
import { type VerifiedPopulationDefenseProfile } from "./populationDefenders";
import { VERIFIED_POPULATION_DEFENSE_PROFILES } from "./populationDefenseProfiles";
import { assertBlockedTerrainContentSafe } from "./terrainSafety";
import {
  createIllustratedExport,
  illustratedExportError,
  illustratedNumberingReport,
  imageFileStem,
  nativeFileStem,
  IMAGE_SUFFIXES,
  type ExportArtwork,
} from "./illustratedMap";
import {
  compileMapText,
  encodeD6m,
  validateProject,
  type D6mProgress,
} from "./dom6";
import { downloadBlob, MAX_PROJECT_IMPORT_BYTES, parseProject, serializeProject } from "./projectFile";
import { zipPackageSafety } from "./packageEstimate";

// The editor imports the project-file and estimate modules directly and loads
// this package exporter on demand; re-exporting them keeps this module's
// complete public API unchanged for every other caller.
export {
  downloadProject,
  MAX_IMPORTED_DIRECTIVE_LENGTH,
  MAX_IMPORTED_EDGES_PER_PLANE,
  MAX_IMPORTED_GATES,
  MAX_IMPORTED_ID_LENGTH,
  MAX_IMPORTED_PLANES,
  MAX_IMPORTED_PROVINCES_PER_PLANE,
  MAX_IMPORTED_STRING_LENGTH,
  MAX_PROJECT_IMPORT_BYTES,
  parseProject,
  serializeProject,
} from "./projectFile";
export {
  estimatedPackageBytes,
  estimatedTextPackageBytes,
  ZIP_MEMORY_LIMIT_PEAK_BYTES,
  ZIP_MEMORY_WARNING_PEAK_BYTES,
  zipPackageSafety,
  type ZipPackageSafety,
  type ZipPackageSafetyLevel,
} from "./packageEstimate";

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
  // Illustrated .map files end with #pb ownership runs. Those are appended below
  // from the same native ownership sample as the plane's images, so each plane
  // is sampled once; the placeholder keeps every file in its original position.
  const pendingOwnershipText = new Map<number, { slot: number; text: string }>();
  onProgress?.({ stage: "preparing", plane: 0, planeCount: project.planes.length, percent: 0, message: "Compiling Dominions map directives…" });
  for (let index = 0; index < project.planes.length; index += 1) {
    const suffix = index === 0 ? "" : `_plane${index + 1}`;
    const name = `${base}${suffix}.map`;
    if (illustrated?.isIllustrated(index)) {
      pendingOwnershipText.set(index, { slot: files.length, text: illustrated.baseMapText(index, catalog, populationProfiles) });
      files.push({ name, data: new Uint8Array() });
      continue;
    }
    files.push({ name, data: encoder.encode(illustrated
      ? illustrated.baseMapText(index, catalog, populationProfiles) : compileMapText(project, index, catalog, populationProfiles)) });
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
      const artwork = await illustrated.artwork(index);
      const pending = pendingOwnershipText.get(index)!;
      files[pending.slot] = { name: files[pending.slot]!.name, data: encoder.encode(pending.text + artwork.ownershipText) };
      for await (const image of artwork.images) {
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
  // The Blob copies the ZIP straight from its parts; no joined intermediate copy.
  const zip = createStoredZipParts(files.map((file) => ({ ...file, name: `${root}/${file.name}` })));
  downloadBlob(new Blob(zip.map(unsharedBytes), { type: "application/zip" }), `${root}${audience === "player" ? "_players" : ""}.zip`);
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
    // Illustrated #pb runs are completed from each plane's single ownership
    // sample while its images are staged, before any text artifact is written.
    const pendingOwnershipText = new Map<number, { artifact: InstallArtifact; text: string }>();
    for (let index = 0; index < project.planes.length; index += 1) {
      const suffix = index === 0 ? "" : `_plane${index + 1}`;
      const name = `${root}${suffix}.map`;
      if (illustrated?.isIllustrated(index)) {
        const artifact = installArtifact(root, transactionId, name);
        pendingOwnershipText.set(index, { artifact, text: illustrated.baseMapText(index, catalog, VERIFIED_POPULATION_DEFENSE_PROFILES) });
        textArtifacts.push(artifact);
        continue;
      }
      textArtifacts.push(installArtifact(root, transactionId, name, encoder.encode(illustrated
        ? illustrated.baseMapText(index, catalog, VERIFIED_POPULATION_DEFENSE_PROFILES) : compileMapText(project, index, catalog))));
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
          const artwork = await illustrated.artwork(index);
          const pending = pendingOwnershipText.get(index)!;
          pending.artifact.data = encoder.encode(pending.text + artwork.ownershipText);
          for await (const image of artwork.images) {
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
  // WebCrypto hashes exactly the view's bytes; no intermediate copy is needed.
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", unsharedBytes(data)));
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

function ownedBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

/** Blob and WebCrypto copy a view's bytes themselves; only shared memory needs an owned copy first. */
function unsharedBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer ? data as Uint8Array<ArrayBuffer> : new Uint8Array(ownedBuffer(data));
}

/** Stored (uncompressed) ZIP as ordered byte parts; concatenated, they are the archive. */
function createStoredZipParts(files: PackageFile[]): Uint8Array[] {
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
  return [...localParts, ...centralParts, end];
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
  // Indexed loop: several times faster than an iterator over multi-megabyte images.
  for (let index = 0, length = data.length; index < length; index += 1) crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
