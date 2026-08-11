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

export async function installPackage(project: MapProject, onProgress?: ProgressCallback): Promise<"installed" | "unsupported" | "cancelled"> {
  const picker = (window as typeof window & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) return "unsupported";
  try {
    const mapsDirectory = await picker({ mode: "readwrite", id: "dominions6-maps" });
    const root = sanitizeMapName(project.name);
    const mapDirectory = await mapsDirectory.getDirectoryHandle(root, { create: true });
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
  const parsed = JSON.parse(text) as MapProject;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.planes)) throw new Error("This is not a Pantokrator Atlas project.");
  if (parsed.schemaVersion !== 1) throw new Error(`Unsupported project schema ${String(parsed.schemaVersion)}.`);
  return cloneProject(parsed);
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
    `  Throne access: ${fairness.throneAccess}`,
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
    `Wrap: ${project.planes[0]?.wrapX ? "east/west" : "none"}${project.planes[0]?.wrapY ? " + north/south" : ""}`,
  ].join("\r\n");
  return [
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
