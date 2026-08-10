import {
  MAX_PLANES,
  isBlockedTerrain,
  isCaveTerrain,
  isWaterTerrain,
  planeFileSuffix,
  sanitizeMapName,
  type Edge,
  type EdgeKind,
  type MagicPath,
  type MapProject,
  type Plane,
  type Province,
  type TerrainKey,
  type ValidationIssue,
} from "./domain";
import { adjacencyFor, provinceGlobalNumber, shortestDistances } from "./generator";

export const D6M_MAGIC = 898933;
export const D6M_VERSION = 3;
export const D6M_TRAILER = 1155;

export const TERRAIN_BITS = {
  small: 1n,
  large: 2n,
  sea: 4n,
  freshwater: 8n,
  highland: 16n,
  swamp: 32n,
  waste: 64n,
  forest: 128n,
  farm: 256n,
  noStart: 512n,
  manySites: 1024n,
  deep: 2048n,
  cave: 4096n,
  fireSites: 8192n,
  airSites: 16384n,
  waterSites: 32768n,
  earthSites: 65536n,
  astralSites: 131072n,
  deathSites: 262144n,
  natureSites: 524288n,
  glamourSites: 1048576n,
  bloodSites: 2097152n,
  holySites: 4194304n,
  mountains: 8388608n,
  goodThrone: 33554432n,
  goodStart: 67108864n,
  badThrone: 134217728n,
  warmer: 1073741824n,
  colder: 2147483648n,
  caveWall: 68719476736n,
} as const;

const SITE_PATH_BITS: Record<MagicPath, bigint> = {
  fire: TERRAIN_BITS.fireSites,
  air: TERRAIN_BITS.airSites,
  water: TERRAIN_BITS.waterSites,
  earth: TERRAIN_BITS.earthSites,
  astral: TERRAIN_BITS.astralSites,
  death: TERRAIN_BITS.deathSites,
  nature: TERRAIN_BITS.natureSites,
  glamour: TERRAIN_BITS.glamourSites,
  blood: TERRAIN_BITS.bloodSites,
  holy: TERRAIN_BITS.holySites,
};

export const ADVANCED_COMMANDS = [
  { command: "#dom2title", scope: "map", description: "Map title and multiplane anchor" },
  { command: "#imagefile", scope: "plane", description: "D6M or TGA geography file" },
  { command: "#mapsize", scope: "plane", description: "Plane pixel dimensions" },
  { command: "#domversion", scope: "map", description: "Required game version" },
  { command: "#description", scope: "plane", description: "Map description" },
  { command: "#planename", scope: "plane", description: "Plane display name" },
  { command: "#maptextcol", scope: "plane", description: "Province-name color" },
  { command: "#mapdomcol", scope: "plane", description: "Dominion-overlay color" },
  { command: "#mapnohide", scope: "plane", description: "Reveal the plane image" },
  { command: "#nodeepcaves", scope: "plane", description: "Disable a random cave plane" },
  { command: "#nodeepchoice", scope: "map", description: "Hide the cave-plane choice" },
  { command: "#saildist", scope: "map", description: "Maximum sailing distance" },
  { command: "#features", scope: "map", description: "Magic-site frequency" },
  { command: "#nohomelandnames", scope: "map", description: "Disable homeland names" },
  { command: "#nonamefilter", scope: "map", description: "Disable generated-name filtering" },
  { command: "#allowedplayer", scope: "map", description: "Allowed nation" },
  { command: "#computerplayer", scope: "map", description: "Forced AI nation" },
  { command: "#cannotwin", scope: "map", description: "Nation cannot win" },
  { command: "#victorycondition", scope: "map", description: "Victory condition" },
  { command: "#start", scope: "province", description: "Generic start" },
  { command: "#nostart", scope: "province", description: "Forbid a random start" },
  { command: "#specstart", scope: "map", description: "Nation-specific start" },
  { command: "#teamstart", scope: "province", description: "Disciple-team start" },
  { command: "#gate", scope: "province", description: "Cross-plane gateway" },
  { command: "#landname", scope: "province", description: "Province display name" },
  { command: "#terrain", scope: "province", description: "64-bit terrain mask" },
  { command: "#neighbour", scope: "plane", description: "Province adjacency" },
  { command: "#neighbourspec", scope: "plane", description: "Special border type" },
  { command: "#pb", scope: "plane", description: "Raster ownership run (TGA maps)" },
  { command: "#land / #setland", scope: "province", description: "Select and optionally clear a province" },
  { command: "#feature", scope: "province", description: "Hidden magic site" },
  { command: "#knownfeature", scope: "province", description: "Known magic site" },
  { command: "#killfeatures", scope: "province", description: "Remove random sites" },
  { command: "#poptype", scope: "province", description: "Recruitment and local PD type" },
  { command: "#owner", scope: "province", description: "Starting owner" },
  { command: "#fort", scope: "province", description: "Fortification" },
  { command: "#temple", scope: "province", description: "Temple" },
  { command: "#lab", scope: "province", description: "Laboratory" },
  { command: "#unrest", scope: "province", description: "Starting unrest" },
  { command: "#population", scope: "province", description: "Population" },
  { command: "#defence", scope: "province", description: "Owned-province PD level" },
  { command: "#skybox", scope: "province", description: "Battle sky image" },
  { command: "#batmap", scope: "province", description: "Battle map" },
  { command: "#groundcol", scope: "province", description: "Battle ground color" },
  { command: "#rockcol", scope: "province", description: "Battle rock color" },
  { command: "#fogcol", scope: "province", description: "Battle fog color" },
  { command: "#commander", scope: "province", description: "Independent commander" },
  { command: "#comname", scope: "province", description: "Commander name" },
  { command: "#bodyguards", scope: "province", description: "Commander bodyguards" },
  { command: "#units", scope: "province", description: "Independent squad" },
  { command: "#xp", scope: "province", description: "Commander experience" },
  { command: "#randomequip", scope: "province", description: "Random magic items" },
  { command: "#additem", scope: "province", description: "Specific magic item" },
  { command: "#clearmagic", scope: "province", description: "Clear commander magic" },
  { command: "#mag_fire … #mag_priest", scope: "province", description: "Commander magic paths" },
  { command: "#god", scope: "map", description: "Scenario pretender" },
  { command: "#dominionstr", scope: "map", description: "Scenario dominion strength" },
  { command: "#scale_*", scope: "map", description: "Scenario pretender scales" },
] as const;

export function terrainMask(province: Province): bigint {
  let mask = 0n;
  if (province.small) mask |= TERRAIN_BITS.small;
  if (province.large) mask |= TERRAIN_BITS.large;
  if (province.noStart) mask |= TERRAIN_BITS.noStart;
  if (province.manySites) mask |= TERRAIN_BITS.manySites;
  if (province.warmer) mask |= TERRAIN_BITS.warmer;
  if (province.colder) mask |= TERRAIN_BITS.colder;
  if (province.start) mask |= TERRAIN_BITS.goodStart;
  if (province.throne === "preferred" || province.throne === "fixed") mask |= TERRAIN_BITS.goodThrone;
  if (province.throne === "avoid") mask |= TERRAIN_BITS.badThrone;
  for (const path of province.siteBias) mask |= SITE_PATH_BITS[path];

  switch (province.terrain) {
    case "forest": mask |= TERRAIN_BITS.forest; break;
    case "farm": mask |= TERRAIN_BITS.farm; break;
    case "swamp": mask |= TERRAIN_BITS.swamp; break;
    case "waste": mask |= TERRAIN_BITS.waste; break;
    case "highland": mask |= TERRAIN_BITS.highland; break;
    case "mountains": mask |= TERRAIN_BITS.mountains; break;
    case "freshwater": mask |= TERRAIN_BITS.freshwater; break;
    case "sea": mask |= TERRAIN_BITS.sea; break;
    case "deepsea": mask |= TERRAIN_BITS.sea | TERRAIN_BITS.deep; break;
    case "kelp": mask |= TERRAIN_BITS.sea | TERRAIN_BITS.forest; break;
    case "cave": mask |= TERRAIN_BITS.cave; break;
    case "caveforest": mask |= TERRAIN_BITS.cave | TERRAIN_BITS.forest; break;
    case "caveswamp": mask |= TERRAIN_BITS.cave | TERRAIN_BITS.swamp; break;
    case "cavewaste": mask |= TERRAIN_BITS.cave | TERRAIN_BITS.waste; break;
    case "cavehighland": mask |= TERRAIN_BITS.cave | TERRAIN_BITS.highland; break;
    case "cavewall": mask |= TERRAIN_BITS.caveWall | TERRAIN_BITS.noStart; break;
    default: break;
  }
  return mask;
}

export function edgeSpecial(edge: Edge): number {
  if (edge.kind === "custom") return edge.special ?? 0;
  const values: Record<EdgeKind, number> = {
    standard: 0,
    mountain_border: 32,
    mountain_pass: 33,
    river: 2,
    bridge: 16,
    impassable: 4,
    road: 8,
    custom: edge.special ?? 0,
  };
  return values[edge.kind];
}

export interface CompiledTextFile {
  name: string;
  data: Uint8Array;
  mime: string;
}

export function compileMapText(project: MapProject, planeIndex: number): string {
  const plane = project.planes[planeIndex];
  if (!plane) throw new Error(`Plane ${planeIndex + 1} does not exist.`);
  const baseName = sanitizeMapName(project.name);
  const fileStem = `${baseName}${planeFileSuffix(planeIndex)}`;
  const lines: string[] = [
    "--",
    "-- Generated by Pantokrator Atlas for Dominions 6",
    `-- Seed: ${safeComment(project.seed)}`,
    "--",
    "",
  ];

  if (planeIndex === 0) lines.push(`#dom2title ${safeBare(project.name)}`);
  lines.push(`#imagefile ${fileStem}.d6m`);
  lines.push(`#mapsize ${plane.width} ${plane.height}`);
  lines.push(`#domversion ${Math.max(600, project.targetVersion)}`);
  if (plane.wrapX && plane.wrapY) lines.push("#wraparound");
  else if (plane.wrapX) lines.push("#hwraparound");
  else if (plane.wrapY) lines.push("#vwraparound");
  if (project.mapNoHide) lines.push("#mapnohide");
  if (project.noDeepCaves) lines.push("#nodeepcaves");
  if (planeIndex === 0 && project.noDeepChoice) lines.push("#nodeepchoice");
  if (planeIndex > 0 || plane.name !== "Pantokrator's Realm") lines.push(`#planename ${safeBare(plane.name)}`);
  lines.push(`#description ${quote(planeIndex === 0 ? project.description : `${project.description} — ${plane.name}`)}`);
  lines.push("#maptextcol 0.93 0.88 0.70 1.0");
  lines.push("#mapdomcol 238 205 112 42");

  if (planeIndex === 0) {
    lines.push(`#saildist ${clamp(Math.round(project.sailDistance), 1, 10)}`);
    if (project.settings.siteFrequency !== undefined) lines.push(`#features ${clamp(Math.round(project.settings.siteFrequency), 0, 100)}`);
    if (project.noHomelandNames) lines.push("#nohomelandnames");
    if (project.noNameFilter) lines.push("#nonamefilter");
    if (project.victoryPoints !== undefined) lines.push(`#victorycondition 6 ${Math.max(1, Math.round(project.victoryPoints))}`);
    for (const nation of uniqueNumbers(project.allowedPlayers)) lines.push(`#allowedplayer ${nation}`);
    for (const player of project.computerPlayers) lines.push(`#computerplayer ${player.nation} ${player.difficulty}`);
    for (const nation of uniqueNumbers(project.cannotWin)) lines.push(`#cannotwin ${nation}`);
  }

  lines.push("", "-- Province names, terrain, starts, thrones, and gates");
  const gateAssignments = new Map<string, number[]>();
  for (const gate of project.gates) {
    for (const endpoint of gate.endpoints) {
      if (endpoint.planeId !== plane.id) continue;
      const current = gateAssignments.get(endpoint.provinceId) ?? [];
      current.push(gate.gateNumber);
      gateAssignments.set(endpoint.provinceId, current);
    }
  }

  for (const province of plane.provinces) {
    if (province.name) lines.push(`#landname ${province.index} ${quote(province.name)}`);
    lines.push(`#terrain ${province.index} ${terrainMask(province).toString()}`);
    if (province.start) lines.push(`#start ${province.index}`);
    if (province.teamStart !== undefined) lines.push(`#teamstart ${province.index} ${clamp(Math.round(province.teamStart), 0, 7)}`);
    for (const gateNumber of gateAssignments.get(province.id) ?? []) lines.push(`#gate ${province.index} ${gateNumber}`);
  }

  if (planeIndex === 0) {
    for (const start of project.specificStarts) {
      const global = provinceGlobalNumber(project, start.planeId, start.provinceId);
      if (global !== undefined) lines.push(`#specstart ${start.nation} ${global}`);
    }
  }

  lines.push("", "-- Province connections");
  for (const edge of [...plane.edges].sort((a, b) => {
    const leftA = provinceIndex(plane, a.a);
    const leftB = provinceIndex(plane, b.a);
    return leftA - leftB || provinceIndex(plane, a.b) - provinceIndex(plane, b.b);
  })) {
    const a = provinceIndex(plane, edge.a);
    const b = provinceIndex(plane, edge.b);
    if (!a || !b) continue;
    lines.push(`#neighbour ${a} ${b}`);
    const special = edgeSpecial(edge);
    if (special) lines.push(`#neighbourspec ${a} ${b} ${special}`);
  }

  const configured = plane.provinces.filter(hasProvinceBlock);
  if (configured.length) lines.push("", "-- Authored province features and defenders");
  for (const province of configured) {
    const replacesIndependents = province.defenders.length > 0;
    // #land is intentionally forbidden on starts: it can erase the starting army and god.
    lines.push(`${replacesIndependents && !province.start ? "#land" : "#setland"} ${province.index}`);
    if (province.owner !== undefined) lines.push(`#owner ${province.owner}`);
    if (province.poptype !== undefined) lines.push(`#poptype ${province.poptype}`);
    if (province.killRandomSites) lines.push("#killfeatures");
    for (const site of province.sites) lines.push(`${site.known ? "#knownfeature" : "#feature"} ${siteArg(site.value)}`);
    if (province.throne === "fixed" && province.fixedThrone) lines.push(`#feature ${siteArg(province.fixedThrone)}`);
    if (province.fort !== undefined) lines.push(`#fort ${province.fort}`);
    if (province.temple) lines.push("#temple");
    if (province.lab) lines.push("#lab");
    if (province.unrest !== undefined) lines.push(`#unrest ${province.unrest}`);
    if (province.population !== undefined) lines.push(`#population ${province.population}`);
    if (province.provinceDefense !== undefined && province.owner !== undefined && province.owner !== 0) lines.push(`#defence ${province.provinceDefense}`);
    if (province.battle.skybox) lines.push(`#skybox ${quote(province.battle.skybox)}`);
    if (province.battle.battleMap) lines.push(`#batmap ${quote(province.battle.battleMap)}`);
    if (province.battle.groundColor) lines.push(`#groundcol ${rgbArgs(province.battle.groundColor)}`);
    if (province.battle.rockColor) lines.push(`#rockcol ${rgbArgs(province.battle.rockColor)}`);
    if (province.battle.fogColor) lines.push(`#fogcol ${rgbArgs(province.battle.fogColor)}`);
    for (const defense of province.defenders) {
      if (!defense.commander) continue;
      lines.push(`#commander ${unitArg(defense.commander)}`);
      if (defense.commanderName) lines.push(`#comname ${quote(defense.commanderName)}`);
      if (defense.bodyguard && defense.bodyguardCount) lines.push(`#bodyguards ${defense.bodyguardCount} ${unitArg(defense.bodyguard)}`);
      for (const squad of defense.squads) {
        if (squad.unit && squad.count > 0) lines.push(`#units ${squad.count} ${unitArg(squad.unit)}`);
      }
      if (defense.experience !== undefined) lines.push(`#xp ${defense.experience}`);
      if (defense.randomEquipment !== undefined) lines.push(`#randomequip ${defense.randomEquipment}`);
      for (const item of defense.items ?? []) lines.push(`#additem ${quote(item)}`);
      for (const [path, level] of Object.entries(defense.magic ?? {})) {
        if (level === undefined) continue;
        const command = path === "holy" ? "priest" : path;
        lines.push(`#mag_${command} ${level}`);
      }
    }
    appendRaw(lines, province.rawDirectives);
  }

  if (planeIndex === 0) appendRaw(lines, project.rawDirectives);
  appendRaw(lines, plane.rawDirectives);
  lines.push("");
  return lines.join("\r\n");
}

function hasProvinceBlock(province: Province): boolean {
  return province.owner !== undefined
    || province.poptype !== undefined
    || province.killRandomSites
    || province.sites.length > 0
    || (province.throne === "fixed" && !!province.fixedThrone)
    || province.fort !== undefined
    || province.temple
    || province.lab
    || province.unrest !== undefined
    || province.population !== undefined
    || province.provinceDefense !== undefined
    || province.defenders.length > 0
    || Object.values(province.battle).some(Boolean)
    || !!province.rawDirectives.trim();
}

export function compileTextFiles(project: MapProject): CompiledTextFile[] {
  const encoder = new TextEncoder();
  const baseName = sanitizeMapName(project.name);
  return project.planes.map((_, index) => ({
    name: `${baseName}${planeFileSuffix(index)}.map`,
    data: encoder.encode(compileMapText(project, index)),
    mime: "text/plain;charset=utf-8",
  }));
}

export interface D6mProgress {
  phase: "raster" | "done";
  completedRows: number;
  totalRows: number;
}

export async function encodeD6m(
  plane: Plane,
  seed: string,
  onProgress?: (progress: D6mProgress) => void,
): Promise<Uint8Array> {
  const width = Math.round(plane.width);
  const height = Math.round(plane.height);
  const provinceCount = plane.provinces.length;
  const pixelCount = width * height;
  const headerBytes = 34 + provinceCount * 12;
  const heightOffset = headerBytes;
  const ownerOffset = heightOffset + pixelCount * 2;
  const totalBytes = ownerOffset + pixelCount * 2 + 4;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;
  view.setInt32(offset, D6M_MAGIC, true); offset += 4;
  view.setInt32(offset, D6M_VERSION, true); offset += 4;
  view.setInt32(offset, width, true); offset += 4;
  view.setInt32(offset, height, true); offset += 4;
  view.setBigInt64(offset, 0n, true); offset += 8;
  const minDistance = minimumCapitalDistance(plane) * Math.min(width, height);
  const integerPart = Math.floor(minDistance);
  const decimalPart = Math.round((minDistance - integerPart) * 65535);
  view.setUint16(offset, decimalPart, true); offset += 2;
  view.setInt32(offset, integerPart, true); offset += 4;
  view.setInt32(offset, provinceCount, true); offset += 4;
  for (const province of plane.provinces) {
    view.setInt16(offset, clamp(Math.round(province.x * (width - 1)), 0, 32767), true); offset += 2;
    view.setInt16(offset, clamp(Math.round(province.y * (height - 1)), 0, 32767), true); offset += 2;
    let spec = 0n;
    if (isWaterTerrain(province.terrain)) spec |= TERRAIN_BITS.sea;
    if (province.terrain === "deepsea") spec |= TERRAIN_BITS.deep;
    view.setBigInt64(offset, spec, true); offset += 8;
  }

  const heights = new Int16Array(buffer, heightOffset, pixelCount);
  const owners = new Int16Array(buffer, ownerOffset, pixelCount);
  const buckets = buildSpatialBuckets(plane);
  const seedHash = hash32(seed);
  const baseHeights = plane.provinces.map((province) => terrainHeight(province.terrain));
  const yieldEvery = Math.max(8, Math.floor(height / 40));

  for (let y = 0; y < height; y += 1) {
    const ny = (y + 0.5) / height;
    const bucketY = Math.min(buckets.rows - 1, Math.floor(ny * buckets.rows));
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5) / width;
      const bucketX = Math.min(buckets.cols - 1, Math.floor(nx * buckets.cols));
      const candidates = buckets.candidates[bucketY * buckets.cols + bucketX]!;
      let bestIndex = candidates[0] ?? 0;
      let bestDistance = Infinity;
      for (const index of candidates) {
        const province = plane.provinces[index]!;
        let dx = Math.abs(nx - province.x);
        let dy = Math.abs(ny - province.y);
        if (plane.wrapX) dx = Math.min(dx, 1 - dx);
        if (plane.wrapY) dy = Math.min(dy, 1 - dy);
        const warped = pixelNoise(x >> 4, y >> 4, seedHash ^ index) * 0.000018;
        const distance = dx * dx + dy * dy + warped;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      const pixel = y * width + x;
      const noise = pixelNoise(x >> 2, y >> 2, seedHash) * 0.32 + pixelNoise(x >> 5, y >> 5, seedHash ^ 0x9e3779b9) * 0.68;
      heights[pixel] = clamp(Math.round(baseHeights[bestIndex]! + noise * 180), -2000, 2000);
      owners[pixel] = bestIndex + 1;
    }
    if (onProgress && (y % yieldEvery === 0 || y === height - 1)) {
      onProgress({ phase: "raster", completedRows: y + 1, totalRows: height });
      await yieldToBrowser();
    }
  }
  view.setInt32(totalBytes - 4, D6M_TRAILER, true);
  onProgress?.({ phase: "done", completedRows: height, totalRows: height });
  return new Uint8Array(buffer);
}

function buildSpatialBuckets(plane: Plane) {
  const count = plane.provinces.length;
  const aspect = plane.width / plane.height;
  const cols = Math.max(2, Math.ceil(Math.sqrt(count * aspect)));
  const rows = Math.max(2, Math.ceil(count / cols));
  const raw = Array.from({ length: cols * rows }, () => [] as number[]);
  plane.provinces.forEach((province, index) => {
    const x = Math.min(cols - 1, Math.max(0, Math.floor(province.x * cols)));
    const y = Math.min(rows - 1, Math.max(0, Math.floor(province.y * rows)));
    raw[y * cols + x]!.push(index);
  });
  const candidates = Array.from({ length: cols * rows }, () => [] as number[]);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const found = new Set<number>();
      for (let radius = 1; radius <= 3 && found.size < 3; radius += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            let bx = x + dx;
            let by = y + dy;
            if (plane.wrapX) bx = (bx + cols) % cols;
            if (plane.wrapY) by = (by + rows) % rows;
            if (bx < 0 || bx >= cols || by < 0 || by >= rows) continue;
            for (const index of raw[by * cols + bx]!) found.add(index);
          }
        }
      }
      if (!found.size) plane.provinces.forEach((_, index) => found.add(index));
      candidates[y * cols + x] = [...found];
    }
  }
  return { cols, rows, candidates };
}

export function inspectD6m(data: Uint8Array) {
  if (data.byteLength < 38) throw new Error("D6M file is too short.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getInt32(0, true);
  const version = view.getInt32(4, true);
  const width = view.getInt32(8, true);
  const height = view.getInt32(12, true);
  const provinceCount = view.getInt32(30, true);
  const expectedLength = 34 + provinceCount * 12 + width * height * 4 + 4;
  const trailer = data.byteLength >= 4 ? view.getInt32(data.byteLength - 4, true) : 0;
  return { magic, version, width, height, provinceCount, expectedLength, trailer, validLength: expectedLength === data.byteLength };
}

export function validateProject(project: MapProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: ValidationIssue["severity"], message: string, planeId?: string, provinceId?: string) => {
    issues.push({ id: `issue-${issues.length + 1}`, severity, message, planeId, provinceId });
  };
  if (!project.name.trim()) add("error", "Map name is required.");
  if (sanitizeMapName(project.name) !== project.name) add("warning", `Export filenames will be normalized to “${sanitizeMapName(project.name)}”.`);
  if (project.planes.length < 1 || project.planes.length > MAX_PLANES) add("error", "Dominions 6 maps must contain one to eight planes.");
  if (project.settings.players < 2) add("error", "At least two player starts are required for a multiplayer map.");

  for (const [planeIndex, plane] of project.planes.entries()) {
    if (plane.width < 256 || plane.height < 256) add("error", `${plane.name} is below Dominions' 256×256 minimum.`, plane.id);
    if (plane.width > 32767 || plane.height > 32767) add("error", `${plane.name} exceeds signed-short D6M coordinates.`, plane.id);
    if (plane.width > 3840 || plane.height > 3840 || plane.width * plane.height > 8_294_400) {
      add("warning", `${plane.name} exceeds the selected ChatGPT Images maximum-pixel envelope; export can be memory intensive.`, plane.id);
    }
    if (!plane.provinces.length) {
      add("error", `${plane.name} has no provinces.`, plane.id);
      continue;
    }
    if (plane.provinces.length > 32767) add("error", `${plane.name} has too many provinces for the D6M owner raster.`, plane.id);
    const provinceIds = new Set(plane.provinces.map((province) => province.id));
    if (provinceIds.size !== plane.provinces.length) add("error", `${plane.name} contains duplicate province IDs.`, plane.id);
    const indices = plane.provinces.map((province) => province.index).sort((a, b) => a - b);
    if (indices.some((value, index) => value !== index + 1)) add("error", `${plane.name} province numbers are not contiguous from 1.`, plane.id);

    const adjacency = adjacencyFor(plane);
    const reachable = shortestDistances(adjacency, plane.provinces[0]!.id);
    if (reachable.size !== plane.provinces.length) add("error", `${plane.name} is disconnected (${reachable.size}/${plane.provinces.length} provinces reachable).`, plane.id);
    const edgeKeys = new Set<string>();
    for (const edge of plane.edges) {
      if (!provinceIds.has(edge.a) || !provinceIds.has(edge.b)) add("error", "A connection references a missing province.", plane.id);
      if (edge.a === edge.b) add("error", "A province cannot neighbor itself.", plane.id, edge.a);
      const key = [edge.a, edge.b].sort().join("|");
      if (edgeKeys.has(key)) add("warning", "A province connection is duplicated.", plane.id, edge.a);
      edgeKeys.add(key);
      const special = edgeSpecial(edge);
      if (special < 0 || special > 255) add("error", "A special connection value must be between 0 and 255.", plane.id, edge.a);
    }

    for (const province of plane.provinces) {
      const degree = adjacency.get(province.id)?.length ?? 0;
      if (province.start) {
        if (province.noStart) add("error", `${province.name} is marked both Start and No start.`, plane.id, province.id);
        if (isBlockedTerrain(province.terrain)) add("error", `${province.name} is a start on blocked terrain.`, plane.id, province.id);
        if (degree < 3) add("warning", `${province.name} is a start with only ${degree} connections.`, plane.id, province.id);
        if (province.defenders.length) add("error", `${province.name} is a start with authored independent defenders; #land would erase its starting army.`, plane.id, province.id);
      }
      if (province.small && province.large) add("warning", `${province.name} is marked both small and large.`, plane.id, province.id);
      if (province.warmer && province.colder) add("warning", `${province.name} is marked both warmer and colder.`, plane.id, province.id);
      if (province.throne === "fixed" && !province.fixedThrone?.trim()) add("error", `${province.name} needs a throne site name or ID.`, plane.id, province.id);
      if (province.provinceDefense !== undefined && (province.owner === undefined || province.owner === 0)) {
        add("warning", `${province.name}: #defence only works for a nation-owned province; independent guardians use commander/unit groups.`, plane.id, province.id);
      }
      for (const defense of province.defenders) {
        if (!defense.commander.trim()) add("error", `${province.name} has a defender group without a commander.`, plane.id, province.id);
        for (const squad of defense.squads) {
          if (!squad.unit.trim() || squad.count < 1) add("error", `${province.name} has an incomplete defender squad.`, plane.id, province.id);
        }
      }
    }
    const starts = plane.provinces.filter((province) => province.start);
    if (planeIndex === 0 && starts.length < project.settings.players) add("error", `Only ${starts.length} starts exist for ${project.settings.players} players.`, plane.id);
    if (starts.length > project.settings.players) add("info", `${plane.name} has ${starts.length} generic starts for ${project.settings.players} players.`, plane.id);
  }

  const gateNumbers = new Set<number>();
  for (const gate of project.gates) {
    if (gateNumbers.has(gate.gateNumber)) add("error", `Gate number ${gate.gateNumber} is duplicated across link groups.`);
    gateNumbers.add(gate.gateNumber);
    if (gate.endpoints.length < 2) add("error", `Gate ${gate.gateNumber} has fewer than two endpoints.`);
    for (const endpoint of gate.endpoints) {
      const plane = project.planes.find((item) => item.id === endpoint.planeId);
      const province = plane?.provinces.find((item) => item.id === endpoint.provinceId);
      if (!plane || !province) add("error", `Gate ${gate.gateNumber} references a missing province.`);
      if (province?.start) add("warning", `Gate ${gate.gateNumber} is in start province ${province.name}.`, plane?.id, province.id);
    }
  }
  if (project.planes.length > 1) {
    const connectedPlanes = new Set<string>([project.planes[0]!.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const gate of project.gates) {
        if (!gate.endpoints.some((endpoint) => connectedPlanes.has(endpoint.planeId))) continue;
        for (const endpoint of gate.endpoints) {
          if (!connectedPlanes.has(endpoint.planeId)) {
            connectedPlanes.add(endpoint.planeId);
            changed = true;
          }
        }
      }
    }
    for (const plane of project.planes) {
      if (!connectedPlanes.has(plane.id)) add("error", `${plane.name} is not linked to the main plane.`, plane.id);
    }
  }
  if (!issues.some((issue) => issue.severity === "error")) add("info", "Compatibility checks passed; the package is ready for Dominions 6.");
  return issues;
}

export function estimatedD6mBytes(plane: Plane): number {
  return 34 + plane.provinces.length * 12 + plane.width * plane.height * 4 + 4;
}

export function terrainPreviewKey(terrain: TerrainKey, condition: string): TerrainKey {
  if (condition === "forested") return isWaterTerrain(terrain) ? "kelp" : isCaveTerrain(terrain) ? "caveforest" : "forest";
  if (condition === "flooded") return isCaveTerrain(terrain) ? "caveswamp" : "sea";
  if (condition === "wasted") return isCaveTerrain(terrain) ? "cavewaste" : "waste";
  if (condition === "farmland") return isCaveTerrain(terrain) ? terrain : "farm";
  return terrain;
}

function minimumCapitalDistance(plane: Plane): number {
  if (plane.provinces.length < 2) return 0;
  let minimum = Infinity;
  for (let i = 0; i < plane.provinces.length; i += 1) {
    for (let j = i + 1; j < plane.provinces.length; j += 1) {
      const a = plane.provinces[i]!;
      const b = plane.provinces[j]!;
      let dx = Math.abs(a.x - b.x);
      let dy = Math.abs(a.y - b.y);
      if (plane.wrapX) dx = Math.min(dx, 1 - dx);
      if (plane.wrapY) dy = Math.min(dy, 1 - dy);
      minimum = Math.min(minimum, Math.hypot(dx, dy));
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function terrainHeight(terrain: TerrainKey): number {
  const heights: Record<TerrainKey, number> = {
    plains: 90,
    forest: 130,
    farm: 75,
    swamp: 18,
    waste: 105,
    highland: 520,
    mountains: 900,
    freshwater: -35,
    sea: -380,
    deepsea: -1180,
    kelp: -290,
    cave: 120,
    caveforest: 165,
    caveswamp: 35,
    cavewaste: 210,
    cavehighland: 640,
    cavewall: 1250,
  };
  return heights[terrain];
}

function pixelNoise(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y + seed, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 15;
  return ((value >>> 0) / 4294967295) * 2 - 1;
}

function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function provinceIndex(plane: Plane, id: string): number {
  return plane.provinces.find((province) => province.id === id)?.index ?? 0;
}

function siteArg(value: string): string {
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? trimmed : quote(trimmed);
}

function unitArg(value: string): string {
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? trimmed : quote(trimmed);
}

function rgbArgs(value: string): string {
  const parts = value.split(/[ ,]+/).map(Number).filter(Number.isFinite).slice(0, 3);
  while (parts.length < 3) parts.push(128);
  return parts.map((part) => clamp(Math.round(part), 0, 255)).join(" ");
}

function quote(value: string): string {
  return `"${value.replace(/[\r\n]+/g, " ").replace(/"/g, "'").trim()}"`;
}

function safeBare(value: string): string {
  return value.replace(/[\r\n#]+/g, " ").replace(/--/g, "-").trim() || "Untitled";
}

function safeComment(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/--/g, "-").trim();
}

function appendRaw(lines: string[], raw: string) {
  const clean = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#") || line.startsWith("--"));
  if (clean.length) lines.push(...clean);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value)).filter((value) => Number.isFinite(value)))];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
