import {
  MAX_PLANES,
  effectiveProvinceTerrainFlags,
  isBlockedProvince,
  isCaveProvince,
  isCaveTerrain,
  isWaterProvince,
  isWaterTerrain,
  planeFileSuffix,
  sanitizeMapName,
  type Edge,
  type EdgeKind,
  type MagicPath,
  type MapProject,
  type Plane,
  type Province,
  type StartType,
  type TerrainKey,
  type ValidationIssue,
} from "./domain";
import { adjacencyFor, provinceGlobalNumber, shortestDistances } from "./generator";
import { auditPlaneTopology, createProvinceOwnerResolver } from "./geometry";
import { BUILTIN_DOM6_CATALOG, findCatalogEntry, siteCompatibility } from "./catalog";

export const D6M_MAGIC = 898933;
export const D6M_VERSION = 3;
export const D6M_TRAILER = 1155;
export const MAX_D6M_PIXELS = 8_294_400;

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
  { command: "#dom2title", scope: "plane", description: "Required first command in every plane file" },
  { command: "#imagefile", scope: "plane", description: "D6M or TGA geography file" },
  { command: "#mapsize", scope: "plane", description: "Plane pixel dimensions" },
  { command: "#wraparound / #hwraparound / #vwraparound", scope: "plane", description: "Full or axis-specific wrapping" },
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
  { command: "#poptype", scope: "province", description: "Local recruitment type; does not replace initial defenders" },
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
  { command: "#bodyguards", scope: "province", description: "Independent commander bodyguards; AI nations ignore it" },
  { command: "#units", scope: "province", description: "Independent squad" },
  { command: "#xp", scope: "province", description: "Commander experience" },
  { command: "#randomequip", scope: "province", description: "Random magic items" },
  { command: "#additem", scope: "province", description: "Specific magic item" },
  { command: "#clearmagic", scope: "province", description: "Clear commander magic" },
  { command: "#mag_fire … #mag_priest", scope: "province", description: "Commander magic paths" },
  { command: "#god", scope: "map", description: "Scenario pretender" },
  { command: "#dominionstr", scope: "map", description: "Scenario dominion strength" },
  { command: "#scale chaos|lazy|cold|death|unluck|unmagic", scope: "map", description: "Scenario pretender scales (-5 to 5)" },
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
  const flags = effectiveProvinceTerrainFlags(province);
  if (flags.has("sea")) mask |= TERRAIN_BITS.sea;
  if (flags.has("freshwater")) mask |= TERRAIN_BITS.freshwater;
  if (flags.has("highland")) mask |= TERRAIN_BITS.highland;
  if (flags.has("swamp")) mask |= TERRAIN_BITS.swamp;
  if (flags.has("waste")) mask |= TERRAIN_BITS.waste;
  if (flags.has("forest")) mask |= TERRAIN_BITS.forest;
  if (flags.has("farm")) mask |= TERRAIN_BITS.farm;
  if (flags.has("deep")) mask |= TERRAIN_BITS.deep;
  if (flags.has("cave")) mask |= TERRAIN_BITS.cave;
  if (flags.has("mountains")) mask |= TERRAIN_BITS.mountains;
  if (flags.has("cavewall")) mask |= TERRAIN_BITS.caveWall | TERRAIN_BITS.noStart;
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

  // The map manual requires #dom2title to be the first command in every
  // plane's .map file, including _plane2 through _plane8.
  lines.push(`#dom2title ${safeBare(project.name)}`);
  lines.push(`#imagefile ${fileStem}.d6m`);
  lines.push(`#mapsize ${plane.width} ${plane.height}`);
  lines.push(`#domversion ${Math.max(600, project.targetVersion)}`);
  if (plane.wrapX && plane.wrapY) lines.push("#wraparound");
  else if (plane.wrapX) lines.push("#hwraparound");
  else if (plane.wrapY) lines.push("#vwraparound");
  if (plane.mapNoHide ?? project.mapNoHide) lines.push("#mapnohide");
  if (plane.noDeepCaves ?? project.noDeepCaves) lines.push("#nodeepcaves");
  if (planeIndex === 0 && project.noDeepChoice) lines.push("#nodeepchoice");
  if (planeIndex > 0 || plane.name !== "Pantokrator's Realm") lines.push(`#planename ${safeBare(plane.name)}`);
  lines.push(`#description ${quote(planeIndex === 0 ? project.description : `${project.description} — ${plane.name}`)}`);
  lines.push(`#maptextcol ${safeColorTuple(plane.mapTextColor, "0.93 0.88 0.70 1.0", 0, 1, false)}`);
  lines.push(`#mapdomcol ${safeColorTuple(plane.mapDominionColor, "238 205 112 42", 0, 255, true)}`);

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
    if (province.teamStart !== undefined) lines.push(`#teamstart ${province.index} ${Math.max(0, Math.round(province.teamStart))}`);
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
    const isProtectedStart = province.start
      || province.teamStart !== undefined
      || project.specificStarts.some((start) => start.planeId === plane.id && start.provinceId === province.id);
    // #land is forbidden on every kind of start: it can erase the starting
    // army and god. #setland keeps the province contents intact.
    lines.push(`${replacesIndependents && !isProtectedStart ? "#land" : "#setland"} ${province.index}`);
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
    if (province.provinceDefense !== undefined && province.owner !== undefined && !isIndependentOwner(province.owner)) lines.push(`#defence ${province.provinceDefense}`);
    if (province.battle.skybox) lines.push(`#skybox ${quote(province.battle.skybox)}`);
    if (province.battle.battleMap) lines.push(`#batmap ${quote(province.battle.battleMap)}`);
    if (province.battle.groundColor) lines.push(`#groundcol ${rgbArgs(province.battle.groundColor)}`);
    if (province.battle.rockColor) lines.push(`#rockcol ${rgbArgs(province.battle.rockColor)}`);
    if (province.battle.fogColor) lines.push(`#fogcol ${rgbArgs(province.battle.fogColor)}`);
    for (const defense of province.defenders) {
      if (!defense.commander) continue;
      lines.push(`#commander ${unitArg(defense.commander)}`);
      if (defense.commanderName) lines.push(`#comname ${quote(defense.commanderName)}`);
      if (defense.clearMagic) lines.push("#clearmagic");
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
  if (width < 256 || height < 256 || width > 3840 || height > 3840 || width * height > MAX_D6M_PIXELS) {
    throw new RangeError(`D6M dimensions ${width}x${height} exceed the supported 256x256 to 8.29-megapixel export envelope.`);
  }
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
    const flags = effectiveProvinceTerrainFlags(province);
    let spec = 0n;
    if (flags.has("sea")) spec |= TERRAIN_BITS.sea;
    if (flags.has("sea") && flags.has("deep")) spec |= TERRAIN_BITS.deep;
    view.setBigInt64(offset, spec, true); offset += 8;
  }

  const heights = new Int16Array(buffer, heightOffset, pixelCount);
  const owners = new Int16Array(buffer, ownerOffset, pixelCount);
  const ownerResolver = createProvinceOwnerResolver(plane);
  const seedHash = hash32(seed);
  const baseHeights = plane.provinces.map((province) => terrainHeight(province));
  const yieldEvery = Math.max(8, Math.floor(height / 40));

  for (let y = 0; y < height; y += 1) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5) / width;
      const bestIndex = ownerResolver.ownerAt(nx, ny);
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

export function inspectD6m(data: Uint8Array) {
  if (data.byteLength < 38) throw new Error("D6M file is too short.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getInt32(0, true);
  const version = view.getInt32(4, true);
  const width = view.getInt32(8, true);
  const height = view.getInt32(12, true);
  const globalSpec = view.getBigInt64(16, true);
  const minimumDistanceFraction = view.getUint16(24, true);
  const minimumDistanceInteger = view.getInt32(26, true);
  const provinceCount = view.getInt32(30, true);
  const layoutValuesValid = width > 0 && height > 0 && provinceCount >= 0;
  const expectedLength = layoutValuesValid ? 34 + provinceCount * 12 + width * height * 4 + 4 : -1;
  const trailer = data.byteLength >= 4 ? view.getInt32(data.byteLength - 4, true) : 0;
  const validLength = Number.isSafeInteger(expectedLength) && expectedLength === data.byteLength;
  let validCenters = validLength;
  let validProvinceSpecs = validLength;
  let validHeights = validLength;
  let validOwners = validLength;
  if (validLength) {
    let provinceOffset = 34;
    for (let index = 0; index < provinceCount; index += 1) {
      const x = view.getInt16(provinceOffset, true);
      const y = view.getInt16(provinceOffset + 2, true);
      const spec = view.getBigInt64(provinceOffset + 4, true);
      if (x < 0 || x >= width || y < 0 || y >= height) validCenters = false;
      if ((spec & ~(TERRAIN_BITS.sea | TERRAIN_BITS.deep)) !== 0n || ((spec & TERRAIN_BITS.deep) !== 0n && (spec & TERRAIN_BITS.sea) === 0n)) {
        validProvinceSpecs = false;
      }
      provinceOffset += 12;
    }
    const pixelCount = width * height;
    const heightOffset = 34 + provinceCount * 12;
    const ownerOffset = heightOffset + pixelCount * 2;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const elevation = view.getInt16(heightOffset + pixel * 2, true);
      const owner = view.getInt16(ownerOffset + pixel * 2, true);
      if (elevation < -2000 || elevation > 2000) validHeights = false;
      if (owner < 0 || owner > provinceCount) validOwners = false;
    }
  }
  const validHeader = magic === D6M_MAGIC
    && version === D6M_VERSION
    && globalSpec === 0n
    && minimumDistanceInteger >= 0;
  const validTrailer = trailer === D6M_TRAILER;
  return {
    magic,
    version,
    width,
    height,
    globalSpec,
    minimumDistanceFraction,
    minimumDistanceInteger,
    provinceCount,
    expectedLength,
    trailer,
    validLength,
    validHeader,
    validCenters,
    validProvinceSpecs,
    validHeights,
    validOwners,
    validTrailer,
    valid: validLength && validHeader && validCenters && validProvinceSpecs && validHeights && validOwners && validTrailer,
  };
}

export function validateProject(project: MapProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: ValidationIssue["severity"], message: string, planeId?: string, provinceId?: string) => {
    issues.push({ id: `issue-${issues.length + 1}`, severity, message, planeId, provinceId });
  };
  if (!project.name.trim()) add("error", "Map name is required.");
  if (sanitizeMapName(project.name) !== project.name) add("warning", `Export filenames will be normalized to “${sanitizeMapName(project.name)}”.`);
  if (project.planes.length < 1 || project.planes.length > MAX_PLANES) add("error", "Dominions 6 maps must contain one to eight planes.");
  if (!integerInRange(project.settings.players, 2, 32)) add("error", "Player count must be a whole number from 2 to 32.");
  if (!integerInRange(project.settings.provincesPerPlayer, 8, 30)) add("error", "Provinces per player must be a whole number from 8 to 30.");
  if (!integerInRange(project.settings.waterPercent, 0, 60)) add("error", "Water percentage must be between 0 and 60.");
  if (!integerInRange(project.settings.biomeCohesion, 0, 100)) add("error", "Biome cohesion must be between 0 and 100.");
  if (!integerInRange(project.settings.throneCount, 0, 64)) add("error", "Recommended throne count must be between 0 and 64.");
  if (!integerInRange(project.settings.startDegreeTarget ?? 4, 1, 8)) add("error", "Start connection target must be between 1 and 8.");
  if (project.settings.gatePairsPerConnection !== undefined && !integerInRange(project.settings.gatePairsPerConnection, 1, 3)) add("error", "Gate pairs per plane connection must be between 1 and 3.");
  if (project.settings.startDistribution) {
    const startTotal = (["land", "coastal", "water", "cave", "other"] as const)
      .reduce((sum, type) => sum + project.settings.startDistribution![type], 0);
    const validSplit = (["land", "coastal", "water", "cave", "other"] as const)
      .every((type) => Number.isInteger(project.settings.startDistribution![type]) && project.settings.startDistribution![type] >= 0);
    if (!validSplit || startTotal !== project.settings.players) add("error", "Start-category counts must be non-negative whole numbers that add up to the player count.");
  }
  if (!Number.isInteger(project.targetVersion) || project.targetVersion < 600) add("error", "The minimum Dominions version must be an integer of 600 or newer.");
  if (!integerInRange(project.sailDistance, 1, 10)) add("error", "Sail distance must be between 1 and 10.");
  if (project.settings.siteFrequency !== undefined && !integerInRange(project.settings.siteFrequency, 0, 100)) add("error", "Magic-site frequency must be between 0 and 100.");
  if (project.victoryPoints !== undefined && (!Number.isInteger(project.victoryPoints) || project.victoryPoints < 1)) add("error", "Ascension points must be a positive integer.");
  for (const player of project.computerPlayers) {
    if (!Number.isInteger(player.nation) || player.nation < 0 || !integerInRange(player.difficulty, 1, 5)) {
      add("error", "Forced AI entries require a non-negative nation ID and difficulty from 1 to 5.");
    } else if (isIndependentOwner(player.nation)) {
      add("error", `Special independent ID ${player.nation} cannot be selected as a forced AI player.`);
    } else if (!findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, player.nation)) {
      add("warning", `Forced AI nation ${player.nation} is not in the bundled vanilla 6.35 catalog; it requires matching custom content.`);
    }
  }
  for (const nation of [...project.allowedPlayers, ...project.cannotWin]) {
    if (!Number.isInteger(nation) || nation < 0) add("error", "Allowed-player and cannot-win nation IDs must be non-negative integers.");
    else if (isIndependentOwner(nation)) add("error", `Special independent ID ${nation} is an owner type, not a playable nation.`);
    else if (!findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, nation)) add("warning", `Nation ${nation} is not in the bundled vanilla 6.35 catalog; it requires matching custom content.`);
  }

  for (const plane of project.planes) {
    if (!integerInRange(plane.provinceTarget, 8, 800)) add("error", `${plane.name} province target must be between 8 and 800.`, plane.id);
    if (!Number.isInteger(plane.width) || !Number.isInteger(plane.height)) add("error", `${plane.name} dimensions must be whole pixels.`, plane.id);
    if (plane.width < 256 || plane.height < 256) add("error", `${plane.name} is below Dominions' 256×256 minimum.`, plane.id);
    if (plane.width > 32767 || plane.height > 32767) add("error", `${plane.name} exceeds signed-short D6M coordinates.`, plane.id);
    if (plane.width > 3840 || plane.height > 3840 || plane.width * plane.height > MAX_D6M_PIXELS) {
      add("error", `${plane.name} exceeds the supported 8.29-megapixel export envelope. Choose 3840x2160, 2880x2880, or a smaller custom size.`, plane.id);
    }
    if (plane.mapTextColor && !validColorTuple(plane.mapTextColor, 4, 0, 1, false)) {
      add("error", `${plane.name}: province-name color needs four decimal values from 0 to 1.`, plane.id);
    }
    if (plane.mapDominionColor && !validColorTuple(plane.mapDominionColor, 4, 0, 255, true)) {
      add("error", `${plane.name}: dominion-overlay color needs four integer values from 0 to 255.`, plane.id);
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
    const protectedStartIds = new Set(plane.provinces
      .filter((province) => province.start
        || province.teamStart !== undefined
        || project.specificStarts.some((start) => start.planeId === plane.id && start.provinceId === province.id))
      .map((province) => province.id));
    const traversableProvinces = plane.provinces.filter((province) => !isBlockedProvince(province));
    const traversableAdjacency = adjacencyFor(plane, { traversableOnly: true });
    const reachable = traversableProvinces.length
      ? shortestDistances(traversableAdjacency, traversableProvinces[0]!.id)
      : new Map<string, number>();
    const reachableTraversable = traversableProvinces.filter((province) => reachable.has(province.id)).length;
    if (reachableTraversable !== traversableProvinces.length) {
      add("error", `${plane.name} is disconnected for normal movement (${reachableTraversable}/${traversableProvinces.length} traversable provinces reachable).`, plane.id);
    }
    const topologyAudit = auditPlaneTopology(plane);
    if (topologyAudit.missing.length) {
      add(
        "error",
        `${plane.name} has ${topologyAudit.missing.length} shared province border${topologyAudit.missing.length === 1 ? "" : "s"} without a Dominions connection. Synchronize visible borders before export.`,
        plane.id,
        topologyAudit.missing[0]?.a,
      );
    }
    if (topologyAudit.extra.length) {
      add(
        "error",
        `${plane.name} has ${topologyAudit.extra.length} connection${topologyAudit.extra.length === 1 ? "" : "s"} between provinces that do not share a border. Synchronize visible borders before export.`,
        plane.id,
        topologyAudit.extra[0]?.a,
      );
    }
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
        if (isBlockedProvince(province)) add("error", `${province.name} is a start on blocked terrain.`, plane.id, province.id);
        const targetDegree = project.settings.startDegreeTarget ?? 4;
        if (degree < targetDegree) add("error", `${province.name} is a start with ${degree} connections; the configured minimum is ${targetDegree}.`, plane.id, province.id);
        const blockingEdges = plane.edges.filter((edge) => (edge.a === province.id || edge.b === province.id) && blocksReliableStartMovement(edge));
        if (blockingEdges.length) add("error", `${province.name} has ${blockingEdges.length} blocking or condition-dependent start border${blockingEdges.length === 1 ? "" : "s"}.`, plane.id, province.id);
        if (province.defenders.length) add("error", `${province.name} is a start with authored independent defenders; #land would erase its starting army.`, plane.id, province.id);
      }
      if (province.teamStart !== undefined && (!Number.isInteger(province.teamStart) || province.teamStart < 0)) add("error", `${province.name}: team-start group must be a non-negative integer smaller than the number of teams selected while hosting.`, plane.id, province.id);
      if (province.population !== undefined && !integerInRange(province.population, 0, 50000)) add("error", `${province.name}: population must be between 0 and 50000.`, plane.id, province.id);
      if (province.unrest !== undefined && !integerInRange(province.unrest, 0, 500)) add("error", `${province.name}: unrest must be between 0 and 500.`, plane.id, province.id);
      if (province.provinceDefense !== undefined && !integerInRange(province.provinceDefense, 0, 125)) add("error", `${province.name}: owned province defence must be between 0 and 125.`, plane.id, province.id);
      for (const [label, color] of [["ground", province.battle.groundColor], ["rock", province.battle.rockColor], ["fog", province.battle.fogColor]] as const) {
        if (color && !validBattleColor(color)) add("error", `${province.name}: ${label} color needs three RGB values from 0 to 255.`, plane.id, province.id);
      }
      if (province.battle.skybox) add("warning", `${province.name}: the referenced skybox asset must also be placed in the exported map folder.`, plane.id, province.id);
      if (province.battle.battleMap && province.battle.battleMap.trim().toLowerCase() !== "empty") add("warning", `${province.name}: the referenced battle-map asset must also be placed in the exported map folder.`, plane.id, province.id);
      if (province.small && province.large) add("warning", `${province.name} is marked both small and large.`, plane.id, province.id);
      if (province.warmer && province.colder) add("warning", `${province.name} is marked both warmer and colder.`, plane.id, province.id);
      const terrainFlags = effectiveProvinceTerrainFlags(province);
      if (terrainFlags.has("deep") && !terrainFlags.has("sea")) add("warning", `${province.name}: the deep-sea flag has no effect without the sea flag.`, plane.id, province.id);
      const adverseTerrainCount = ["forest", "swamp", "waste", "highland", "mountains"]
        .filter((flag) => terrainFlags.has(flag as "forest" | "swamp" | "waste" | "highland" | "mountains")).length;
      if (adverseTerrainCount > 2) add("warning", `${province.name} combines ${adverseTerrainCount} adverse terrain types; the map manual recommends at most two.`, plane.id, province.id);
      if (province.throne === "fixed" && !province.fixedThrone?.trim()) add("error", `${province.name} needs a throne site name or ID.`, plane.id, province.id);
      if (province.throne === "fixed" && province.fixedThrone?.trim()) {
        const throne = findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, province.fixedThrone);
        if (!throne) {
          add("warning", `${province.name}: fixed throne ${province.fixedThrone} is not in the bundled vanilla 6.35 catalog.`, plane.id, province.id);
        } else {
          if (!throne.tags?.includes("throne")) add("error", `${province.name}: ${throne.name} is a magic site, not a throne site.`, plane.id, province.id);
          if (!siteCompatibility(throne, province, plane).compatible) add("warning", `${province.name}: ${throne.name} is not normally compatible with this province terrain.`, plane.id, province.id);
        }
      }
      if (province.poptype !== undefined && !findCatalogEntry(BUILTIN_DOM6_CATALOG.poptypes, province.poptype)) {
        add("error", `${province.name}: population type ${province.poptype} is not a vanilla Dominions 6 poptype.`, plane.id, province.id);
      }
      if (province.fort !== undefined && !findCatalogEntry(BUILTIN_DOM6_CATALOG.forts, province.fort)) {
        add("error", `${province.name}: fortification ${province.fort} is not listed in the Dominions 6 map manual.`, plane.id, province.id);
      }
      for (const site of province.sites) {
        if (!site.value.trim()) {
          add("error", `${province.name} has an empty magic-site entry.`, plane.id, province.id);
          continue;
        }
        const knownSite = findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, site.value);
        if (!knownSite) add("warning", `${province.name}: magic site ${site.value} is not in the bundled vanilla 6.35 catalog.`, plane.id, province.id);
        else if (!siteCompatibility(knownSite, province, plane).compatible) add("warning", `${province.name}: ${knownSite.name} is not normally compatible with this province terrain.`, plane.id, province.id);
      }
      if (province.throne === "preferred" || province.throne === "fixed") {
        if (protectedStartIds.has(province.id)) {
          add("warning", `${province.name} is both a throne location and a start; prefer a throne at least two connections away.`, plane.id, province.id);
        } else {
          const adjacentStart = adjacency.get(province.id)?.find((provinceId) => protectedStartIds.has(provinceId));
          if (adjacentStart) {
            const startName = plane.provinces.find((item) => item.id === adjacentStart)?.name ?? "a start";
            add("warning", `${province.name} is a throne location adjacent to start province ${startName}; prefer a throne at least two connections away.`, plane.id, province.id);
          }
        }
      }
      if (province.provinceDefense !== undefined && (province.owner === undefined || isIndependentOwner(province.owner))) {
        add("warning", `${province.name}: #defence only works for a nation-owned province; independent guardians use commander/unit groups.`, plane.id, province.id);
      }
      for (const defense of province.defenders) {
        if (!defense.commander.trim()) add("error", `${province.name} has a defender group without a commander.`, plane.id, province.id);
        else if (!findCatalogEntry(BUILTIN_DOM6_CATALOG.units, defense.commander)) add("warning", `${province.name}: commander ${defense.commander} is not in the bundled vanilla 6.35 unit catalog.`, plane.id, province.id);
        if (defense.experience !== undefined && !integerInRange(defense.experience, 0, 900)) add("error", `${province.name}: commander experience must be between 0 and 900.`, plane.id, province.id);
        if (defense.randomEquipment !== undefined && !integerInRange(defense.randomEquipment, 0, 4)) add("error", `${province.name}: random equipment richness must be between 0 and 4.`, plane.id, province.id);
        if (defense.bodyguard && (!Number.isInteger(defense.bodyguardCount) || (defense.bodyguardCount ?? 0) < 1)) add("error", `${province.name} has bodyguards without a positive count.`, plane.id, province.id);
        if (defense.bodyguard && !findCatalogEntry(BUILTIN_DOM6_CATALOG.units, defense.bodyguard)) add("warning", `${province.name}: bodyguard ${defense.bodyguard} is not in the bundled vanilla 6.35 unit catalog.`, plane.id, province.id);
        if (defense.bodyguard && province.owner !== undefined && !isIndependentOwner(province.owner)) {
          add("warning", `${province.name}: bodyguards only affect independent commanders and will be ignored by a nation owner.`, plane.id, province.id);
        }
        for (const item of defense.items ?? []) {
          if (!item.trim() || /^-?\d+$/.test(item.trim())) add("error", `${province.name}: #additem requires a non-empty item name, not a numeric ID.`, plane.id, province.id);
        }
        for (const [path, level] of Object.entries(defense.magic ?? {})) {
          if (level !== undefined && (!Number.isInteger(level) || level < 0)) add("error", `${province.name}: ${path} magic must be a non-negative integer.`, plane.id, province.id);
        }
        for (const squad of defense.squads) {
          if (!squad.unit.trim() || !Number.isInteger(squad.count) || squad.count < 1) add("error", `${province.name} has an incomplete defender squad.`, plane.id, province.id);
          else if (!findCatalogEntry(BUILTIN_DOM6_CATALOG.units, squad.unit)) add("warning", `${province.name}: squad unit ${squad.unit} is not in the bundled vanilla 6.35 unit catalog.`, plane.id, province.id);
        }
      }
    }
    const starts = plane.provinces.filter((province) => province.start);
    if (starts.length) {
      const degrees = starts.map((province) => adjacency.get(province.id)?.length ?? 0);
      if (Math.min(...degrees) !== Math.max(...degrees)) add("warning", `${plane.name} start connection counts vary from ${Math.min(...degrees)} to ${Math.max(...degrees)}.`, plane.id);
    }
  }

  const starts = project.planes.flatMap((plane) => plane.provinces.filter((province) => province.start).map((province) => ({ plane, province })));
  if (starts.length < project.settings.players) add("error", `Only ${starts.length} starts exist across all planes for ${project.settings.players} players.`);
  if (starts.length > project.settings.players) add("info", `The atlas has ${starts.length} generic starts for ${project.settings.players} players.`);
  if (starts.length > 1) {
    const degrees = starts.map(({ plane, province }) => adjacencyFor(plane).get(province.id)?.length ?? 0);
    if (Math.min(...degrees) !== Math.max(...degrees)) add("warning", `Start connection counts across the atlas vary from ${Math.min(...degrees)} to ${Math.max(...degrees)}.`);
  }
  if (project.settings.startDistribution) {
    const actual = { land: 0, coastal: 0, water: 0, cave: 0, other: 0 };
    for (const { plane, province } of starts) actual[classifyStart(plane, province)] += 1;
    for (const type of ["land", "coastal", "water", "cave", "other"] as const) {
      const requested = project.settings.startDistribution[type];
      if (actual[type] !== requested) add("error", `Requested ${requested} ${type} start${requested === 1 ? "" : "s"}, but generated ${actual[type]}.`);
    }
  }

  const specificNations = new Set<number>();
  const specificProvinces = new Set<string>();
  for (const start of project.specificStarts) {
    if (!Number.isInteger(start.nation) || start.nation < 0) add("error", "A nation-specific start has an invalid nation ID.");
    else if (isIndependentOwner(start.nation)) add("error", `Special independent ID ${start.nation} cannot receive a nation-specific player start.`);
    else if (!findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, start.nation)) add("warning", `Nation-specific start ${start.nation} is not in the bundled vanilla 6.35 catalog; it requires matching custom content.`);
    const plane = project.planes.find((item) => item.id === start.planeId);
    const province = plane?.provinces.find((item) => item.id === start.provinceId);
    if (!plane || !province) add("error", `Nation-specific start for nation ${start.nation} references a missing province.`);
    if (specificNations.has(start.nation)) add("error", `Nation ${start.nation} has more than one nation-specific start.`);
    specificNations.add(start.nation);
    const provinceKey = `${start.planeId}:${start.provinceId}`;
    if (specificProvinces.has(provinceKey)) add("warning", `${province?.name ?? "A province"} is assigned to more than one nation-specific start.`, plane?.id, province?.id);
    specificProvinces.add(provinceKey);
  }

  const gateNumbers = new Set<number>();
  for (const gate of project.gates) {
    if (!Number.isInteger(gate.gateNumber) || gate.gateNumber < 1) add("error", "Gate numbers must be positive integers.");
    if (gateNumbers.has(gate.gateNumber)) add("error", `Gate number ${gate.gateNumber} is duplicated across link groups.`);
    gateNumbers.add(gate.gateNumber);
    if (gate.endpoints.length < 2) add("error", `Gate ${gate.gateNumber} has fewer than two endpoints.`);
    const endpointKeys = new Set(gate.endpoints.map((endpoint) => `${endpoint.planeId}:${endpoint.provinceId}`));
    if (endpointKeys.size !== gate.endpoints.length) add("error", `Gate ${gate.gateNumber} repeats an endpoint.`);
    for (const endpoint of gate.endpoints) {
      const plane = project.planes.find((item) => item.id === endpoint.planeId);
      const province = plane?.provinces.find((item) => item.id === endpoint.provinceId);
      if (!plane || !province) add("error", `Gate ${gate.gateNumber} references a missing province.`);
      if (!plane || !province) continue;
      const protectedStarts = new Set(plane.provinces
        .filter((item) => item.start || item.teamStart !== undefined || project.specificStarts.some((start) => start.planeId === plane.id && start.provinceId === item.id))
        .map((item) => item.id));
      if (protectedStarts.has(province.id)) {
        add("warning", `Gate ${gate.gateNumber} is in start province ${province.name}; regenerate or move it when the plane has another valid endpoint.`, plane.id, province.id);
        continue;
      }
      const adjacentStart = adjacencyFor(plane).get(province.id)?.find((provinceId) => protectedStarts.has(provinceId));
      if (adjacentStart) {
        const startName = plane.provinces.find((item) => item.id === adjacentStart)?.name ?? "a start";
        add("warning", `Gate ${gate.gateNumber} in ${province.name} is adjacent to start province ${startName}; prefer an endpoint at least two connections away.`, plane.id, province.id);
      }
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

function terrainHeight(province: Province): number {
  const heights: Record<TerrainKey, number> = {
    plains: 90,
    forest: 130,
    farm: 75,
    swamp: 18,
    waste: 105,
    highland: 520,
    mountains: 900,
    freshwater: 90,
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
  const flags = effectiveProvinceTerrainFlags(province);
  if (flags.has("sea")) {
    if (flags.has("deep")) return -1180;
    if (flags.has("mountains") || flags.has("highland")) return -220;
    if (flags.has("forest")) return -290;
    return -380;
  }
  if (flags.has("cavewall")) return 1250;
  return heights[province.terrain];
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
  // Early Atlas builds displayed normalized decimal placeholders for these
  // commands even though Dominions expects integer channels. Preserve those
  // saved projects by interpreting an all-0..1 triplet as normalized RGB.
  if (parts.every((part) => part >= 0 && part <= 1)) {
    return parts.map((part) => Math.round(part * 255)).join(" ");
  }
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

function integerInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isIndependentOwner(nation: number): boolean {
  return nation === 0 || nation === 2 || nation === 4;
}

function validBattleColor(value: string): boolean {
  const parts = value.trim().split(/[ ,]+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return false;
  if (parts.every((part) => part >= 0 && part <= 1)) return true;
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
}

function validColorTuple(value: string, count: number, minimum: number, maximum: number, integers: boolean): boolean {
  const parts = value.trim().split(/[ ,]+/).map(Number);
  return parts.length === count
    && parts.every((part) => Number.isFinite(part)
      && part >= minimum
      && part <= maximum
      && (!integers || Number.isInteger(part)));
}

function safeColorTuple(value: string | undefined, fallback: string, minimum: number, maximum: number, integers: boolean): string {
  if (!value || !validColorTuple(value, 4, minimum, maximum, integers)) return fallback;
  return value.trim().split(/[ ,]+/).map(Number).join(" ");
}

function blocksReliableStartMovement(edge: Edge): boolean {
  // Bits 1, 2, and 4 are pass, river, and impassable respectively. Combined
  // special codes such as 33 and 36 retain the same movement behavior.
  return (edgeSpecial(edge) & 0b111) !== 0;
}

function classifyStart(plane: Plane, province: Province): StartType {
  if (isWaterProvince(province)) return "water";
  if (isCaveProvince(province) || ["cave", "cavern", "underworld", "hell", "abyss"].includes(plane.kind)) return "cave";
  if (province.startType && province.startType !== "water" && province.startType !== "cave") return province.startType;
  if (plane.kind !== "surface") return "other";
  const provinceById = new Map(plane.provinces.map((item) => [item.id, item]));
  const coastal = plane.edges.some((edge) => {
    if (edge.a !== province.id && edge.b !== province.id) return false;
    const other = provinceById.get(edge.a === province.id ? edge.b : edge.a);
    return !!other && isWaterProvince(other);
  });
  return coastal ? "coastal" : "land";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
