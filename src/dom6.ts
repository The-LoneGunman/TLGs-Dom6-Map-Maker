import {
  MAX_PLANES,
  effectiveProvinceTerrainFlags,
  isBlockedProvince,
  isCaveProvince,
  isWaterProvince,
  landformWaterError,
  nationSpecificStartFeatureConflicts,
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
import {
  ISLAND_CHAIN_MIN_WATER_PERCENT,
  adjacencyFor,
  classifyCurrentStart,
  globalMovementAdjacency,
  distancesToSources,
  nearestSourceDistances,
  provinceGlobalNumber,
  scaledStartSeparationTarget,
  shortestDistances,
} from "./generator";
import { auditPlaneTopology, createProvinceOwnerResolver, resolvePlaneOwnershipMode, usesConnectedRegions } from "./geometry";
import { BUILTIN_DOM6_CATALOG, findCatalogEntry, siteCompatibility, type Dom6CatalogBundle } from "./catalog";
import { previewProvinceTerrain, terrainElevation, terrainVisualKey } from "./terrainVisuals";
import { buildInitialDefensePlan, type VerifiedPopulationDefenseProfile } from "./populationDefenders";
import { VERIFIED_POPULATION_DEFENSE_PROFILES } from "./populationDefenseProfiles";
import { protectedStartProvinceKeys } from "./authoringLocks";
import { connectedRegionLayoutNotice } from "./connectedRegions";
import { blockedTerrainContentConflicts, hasRawIndependentDefenderDirectives } from "./terrainSafety";

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

const TERRAIN_KEY_SET = new Set<TerrainKey>([
  "plains", "forest", "farm", "swamp", "waste", "highland", "mountains", "freshwater",
  "sea", "deepsea", "kelp", "cave", "caveforest", "caveswamp", "cavewaste", "cavehighland", "cavewall",
]);

const EDGE_KIND_SET = new Set<EdgeKind>([
  "standard", "mountain_border", "mountain_pass", "river", "bridge", "impassable", "road", "custom",
]);

export const ADVANCED_COMMANDS = [
  { command: "#dom2title", scope: "plane", description: "Required first command in every plane file" },
  { command: "#imagefile", scope: "plane", description: "D6M or TGA geography file" },
  { command: "#winterimagefile", scope: "plane", description: "Winter TGA geography file (illustrated export)" },
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

/** Image marker order differs from editor numbering; never mutate the project. */
export interface MapTextOptions {
  numbering?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  imageFile?: string;
  winterImageFile?: string;
}

/** The optional registry override is for internal verification fixtures, never imported project data. */
export function compileMapText(project: MapProject, planeIndex: number, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = VERIFIED_POPULATION_DEFENSE_PROFILES, options: MapTextOptions = {}): string {
  const plane = project.planes[planeIndex];
  if (!plane) throw new Error(`Plane ${planeIndex + 1} does not exist.`);
  const localNumber = (province: Province) => options.numbering?.get(plane.id)?.get(province.id) ?? province.index;
  const edgeNumber = (id: string) => options.numbering?.get(plane.id)?.get(id) ?? provinceIndex(plane, id);
  const defensePlan = project.populationDefense?.enabled
    ? buildInitialDefensePlan(project, catalog, project.populationDefense, populationProfiles) : undefined;
  const derivedAt = (province: Province) => {
    const row = defensePlan?.entries.get(`${plane.id}:${province.id}`);
    return row?.status === "derived" ? row : undefined;
  };
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
  lines.push(`#imagefile ${options.imageFile ?? `${fileStem}.d6m`}`);
  if (options.winterImageFile) lines.push(`#winterimagefile ${options.winterImageFile}`);
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
    for (const nation of uniquePlayerNationIds(project.allowedPlayers)) lines.push(`#allowedplayer ${nation}`);
    for (const player of project.computerPlayers.filter((item) => isPlayerNationId(item.nation))) {
      lines.push(`#computerplayer ${player.nation} ${player.difficulty}`);
    }
    for (const nation of uniquePlayerNationIds(project.cannotWin)) lines.push(`#cannotwin ${nation}`);
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
    const number = localNumber(province);
    if (province.name) lines.push(`#landname ${number} ${quote(province.name)}`);
    lines.push(`#terrain ${number} ${terrainMask(province).toString()}`);
    if (province.start) lines.push(`#start ${number}`);
    if (province.teamStart !== undefined) lines.push(`#teamstart ${number} ${Math.max(0, Math.round(province.teamStart))}`);
    for (const gateNumber of gateAssignments.get(province.id) ?? []) lines.push(`#gate ${number} ${gateNumber}`);
  }

  if (planeIndex === 0) {
    for (const start of project.specificStarts) {
      if (!isPlayerNationId(start.nation)) continue;
      const targetPlane = project.planes.findIndex(candidate => candidate.id === start.planeId);
      const mapped = options.numbering?.get(start.planeId)?.get(start.provinceId);
      const global = mapped === undefined ? provinceGlobalNumber(project, start.planeId, start.provinceId)
        : mapped + project.planes.slice(0, targetPlane).reduce((sum, candidate) => sum + candidate.provinces.length, 0);
      if (global !== undefined) lines.push(`#specstart ${start.nation} ${global}`);
    }
  }

  lines.push("", "-- Province connections");
  for (const edge of [...plane.edges].sort((a, b) => {
    const leftA = edgeNumber(a.a);
    const leftB = edgeNumber(b.a);
    return leftA - leftB || edgeNumber(a.b) - edgeNumber(b.b);
  })) {
    const a = edgeNumber(edge.a);
    const b = edgeNumber(edge.b);
    if (!a || !b) continue;
    lines.push(`#neighbour ${a} ${b}`);
    const special = edgeSpecial(edge);
    if (special) lines.push(`#neighbourspec ${a} ${b} ${special}`);
  }

  const configured = plane.provinces.filter(province => hasProvinceBlock(province) || derivedAt(province)?.groups.length);
  if (configured.length) lines.push("", "-- Authored province features and defenders");
  for (const province of configured) {
    const derived = derivedAt(province);
    const defenders = province.defenders.length ? province.defenders : derived?.groups ?? province.defenders;
    const replacesIndependents = defenders.length > 0;
    const isProtectedStart = province.start
      || province.teamStart !== undefined
      || project.specificStarts.some((start) => start.planeId === plane.id && start.provinceId === province.id);
    // #land is forbidden on every kind of start: it can erase the starting
    // army and god. #setland keeps the province contents intact.
    if (derived?.profile) lines.push(`-- Population-matched initial defenders: poptype ${derived.profile.poptypeId}; profile ${safeComment(derived.profile.revision)}; host snapshot ${safeComment(derived.profile.gameVersion)}`);
    lines.push(`${replacesIndependents && !isProtectedStart ? "#land" : "#setland"} ${localNumber(province)}`);
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
    for (const defense of defenders) {
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

export function compileTextFiles(project: MapProject, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = VERIFIED_POPULATION_DEFENSE_PROFILES): CompiledTextFile[] {
  const encoder = new TextEncoder();
  const baseName = sanitizeMapName(project.name);
  return project.planes.map((_, index) => ({
    name: `${baseName}${planeFileSuffix(index)}.map`,
    data: encoder.encode(compileMapText(project, index, catalog, populationProfiles)),
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
  if (plane.provinces.some((province, index) => province.index !== index + 1)) {
    throw new RangeError("D6M provinces must be stored in ascending local province-number order.");
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
  const minDistance = minimumCapitalDistance(plane, width, height);
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
  const baseHeights = plane.provinces.map((province) => terrainElevation(province));
  const undergroundRelief = resolvePlaneOwnershipMode(plane) === "sparse"
    && ["cave", "cavern", "underworld", "hell", "abyss"].includes(plane.kind)
    ? createUndergroundReliefSampler(plane, width, height, seedHash, baseHeights)
    : undefined;
  const yieldEvery = Math.max(8, Math.floor(height / 40));

  for (let y = 0; y < height; y += 1) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5) / width;
      const bestIndex = ownerResolver.ownerAt(nx, ny);
      const pixel = y * width + x;
      if (bestIndex < 0) {
        heights[pixel] = 0;
        owners[pixel] = 0;
        continue;
      }
      // Retain the original raster byte-for-byte outside sparse underground
      // planes. Their narrow tunnels need low, continuous relief, not the old
      // 4/32-pixel sample-and-hold steps which read as square terraces in-game.
      const relief = undergroundRelief
        ? undergroundRelief(x, y, bestIndex)
        : (pixelNoise(x >> 2, y >> 2, seedHash) * 0.32 + pixelNoise(x >> 5, y >> 5, seedHash ^ 0x9e3779b9) * 0.68) * 180;
      heights[pixel] = clamp(Math.round(baseHeights[bestIndex]! + relief), -2000, 2000);
      owners[pixel] = bestIndex + 1;
    }
    if (onProgress && (y % yieldEvery === 0 || y === height - 1)) {
      onProgress({ phase: "raster", completedRows: y + 1, totalRows: height });
      await yieldToBrowser();
    }
  }
  // Capital coordinates must always point at their own owner, even when a
  // quantized pixel center lands just outside a very narrow analytic chamber.
  plane.provinces.forEach((province, index) => {
    const x = clamp(Math.round(province.x * (width - 1)), 0, width - 1);
    const y = clamp(Math.round(province.y * (height - 1)), 0, height - 1);
    const pixel = y * width + x;
    owners[pixel] = index + 1;
    heights[pixel] = clamp(baseHeights[index]!, -2000, 2000);
  });
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
  let noneOwnerPixels = 0;
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
      if (owner === 0) noneOwnerPixels += 1;
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
    noneOwnerPixels,
    validTrailer,
    valid: validLength && validHeader && validCenters && validProvinceSpecs && validHeights && validOwners && validTrailer,
  };
}

export function validateProject(project: MapProject, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
  populationProfiles: readonly VerifiedPopulationDefenseProfile[] = VERIFIED_POPULATION_DEFENSE_PROFILES): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: ValidationIssue["severity"], message: string, planeId?: string, provinceId?: string) => {
    issues.push({ id: `issue-${issues.length + 1}`, severity, message, planeId, provinceId });
  };
  if (!project.name.trim()) add("error", "Map name is required.");
  const exportName = sanitizeMapName(project.name);
  if (exportName !== project.name) {
    // Spaces becoming underscores (as in the default name) is routine; other character changes deserve a warning.
    const whitespaceOnly = exportName.toLocaleLowerCase() === project.name.trim().replace(/\s+/g, "_").toLocaleLowerCase();
    add(whitespaceOnly ? "info" : "warning", `Export filenames will be normalized to “${exportName}”.`);
  }
  if (project.planes.length < 1 || project.planes.length > MAX_PLANES) add("error", "Dominions 6 maps must contain one to eight planes.");
  if (!integerInRange(project.settings.players, 2, 32)) add("error", "Player count must be a whole number from 2 to 32.");
  if (!integerInRange(project.settings.provincesPerPlayer, 8, 30)) add("error", "Provinces per player must be a whole number from 8 to 30.");
  if (!integerInRange(project.settings.waterPercent, 0, 60)) add("error", "Water percentage must be between 0 and 60.");
  if (project.settings.oceanLayout !== undefined
    && !["natural", "single_continent", "multiple_continents", "island_chains", "inland_sea"].includes(project.settings.oceanLayout)) {
    add("error", "Overland ocean layout is not supported.");
  }
  if (project.settings.continentCount !== undefined && !integerInRange(project.settings.continentCount, 2, 6)) {
    add("error", "Major continent count must be a whole number from 2 to 6.");
  }
  if (project.settings.oceanLayout === "island_chains" && project.settings.waterPercent < ISLAND_CHAIN_MIN_WATER_PERCENT) {
    add("warning", `Island chains require at least ${ISLAND_CHAIN_MIN_WATER_PERCENT}% overland water; Generate uses and records that effective minimum instead of the lower requested quota.`);
  }
  if (project.settings.specialPlaneSizePercent !== undefined && !integerInRange(project.settings.specialPlaneSizePercent, 1, 500)) {
    add("error", "Bonus-plane size must be a whole percentage from 1 to 500.");
  }
  if (!integerInRange(project.settings.biomeCohesion, 0, 100)) add("error", "Biome cohesion must be between 0 and 100.");
  if (!integerInRange(project.settings.throneCount, 0, 64)) add("error", "Recommended throne count must be between 0 and 64.");
  const provinceCount = project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0);
  const placedThroneCount = project.planes.reduce((sum, plane) => sum + plane.provinces.filter((province) =>
    province.throne === "preferred" || province.throne === "fixed").length, 0);
  if (provinceCount > 0 && placedThroneCount < project.settings.throneCount) {
    add("warning", `Requested ${project.settings.throneCount} recommended throne locations, but only ${placedThroneCount} fit outside protected start and gate zones. Reduce the target or enlarge the atlas.`);
  }
  if (!integerInRange(project.settings.startDegreeTarget ?? 4, 1, 8)) add("error", "Start connection target must be between 1 and 8.");
  if (project.settings.gatePairsPerConnection !== undefined && !integerInRange(project.settings.gatePairsPerConnection, 1, 3)) add("error", "Gate pairs per plane connection must be between 1 and 3.");
  if (project.settings.startDistribution) {
    const startTotal = (["land", "coastal", "water", "cave", "other"] as const)
      .reduce((sum, type) => sum + project.settings.startDistribution![type], 0);
    const validSplit = (["land", "coastal", "water", "cave", "other"] as const)
      .every((type) => Number.isInteger(project.settings.startDistribution![type]) && project.settings.startDistribution![type] >= 0);
    if (!validSplit || startTotal !== project.settings.players) add("error", "Start-category counts must be non-negative whole numbers that add up to the player count.");
  }
  const caveStartNations = project.settings.caveStartNations ?? [];
  const uniqueCaveStartNations = new Set<number>();
  for (const nation of caveStartNations) {
    if (!isPlayerNationId(nation)) {
      add("error", "Configured cave-start nations must be playable nation IDs of 5 or greater.");
      continue;
    }
    if (uniqueCaveStartNations.has(nation)) {
      add("warning", `Configured cave-start nation ${nation} is duplicated and will only be assigned once.`);
      continue;
    }
    uniqueCaveStartNations.add(nation);
    if (!findCatalogEntry(catalog.nations, nation)) {
      add("warning", `Configured cave-start nation ${nation} is not in the active catalog; it requires matching custom content.`);
    }
  }
  const actualCaveStarts = project.planes.reduce((sum, plane) => sum + plane.provinces.filter((province) =>
    province.start && !isWaterProvince(province) && (province.startType === "cave" || isCaveProvince(province))).length, 0);
  if (uniqueCaveStartNations.size > actualCaveStarts) {
    add("error", `${uniqueCaveStartNations.size} cave-start nations are configured, but only ${actualCaveStarts} generated cave starts exist. Adjust Cave starts and choose Generate.`);
  }
  if (!integerInRange(project.targetVersion, 600, 999)) add("error", "The minimum Dominions version must be a whole number from 600 to 999.");
  if (!integerInRange(project.sailDistance, 1, 10)) add("error", "Sail distance must be between 1 and 10.");
  if (project.settings.siteFrequency !== undefined && !integerInRange(project.settings.siteFrequency, 0, 100)) add("error", "Magic-site frequency must be between 0 and 100.");
  if (project.victoryPoints !== undefined && !integerInRange(project.victoryPoints, 1, 999)) add("error", "Ascension points must be a whole number from 1 to 999.");
  for (const player of project.computerPlayers) {
    if (!isPlayerNationId(player.nation) || !integerInRange(player.difficulty, 1, 5)) {
      add("error", "Forced AI entries require a player nation ID of 5 or greater and difficulty from 1 to 5.");
    } else if (!findCatalogEntry(catalog.nations, player.nation)) {
      add("warning", `Forced AI nation ${player.nation} is not in the active catalog; it requires matching custom content.`);
    }
  }
  for (const nation of [...project.allowedPlayers, ...project.cannotWin]) {
    if (!isPlayerNationId(nation)) add("error", "Allowed-player and cannot-win entries require player nation IDs of 5 or greater.");
    else if (!findCatalogEntry(catalog.nations, nation)) add("warning", `Nation ${nation} is not in the active Dominions catalog; it requires matching custom content.`);
  }
  const allowedPlayerCount = uniquePlayerNationIds(project.allowedPlayers).length;
  if (project.allowedPlayers.length && allowedPlayerCount < project.settings.players) {
    add("error", `Only ${allowedPlayerCount} distinct allowed nation${allowedPlayerCount === 1 ? " is" : "s are"} available for ${project.settings.players} recommended players.`);
  }

  if (project.settings.oceanLayout === "multiple_continents") {
    const overland = project.planes.find((plane) => (plane.kind === "surface" || plane.kind === "custom")
      && resolvePlaneOwnershipMode(plane) === "solid" && plane.provinces.length > 0);
    if (overland) {
      const eligible = new Set(overland.provinces.filter((province) => !isWaterProvince(province) && !isBlockedProvince(province))
        .map((province) => province.id));
      const adjacency = adjacencyFor(overland, { traversableOnly: true });
      let achieved = 0;
      while (eligible.size) {
        achieved += 1;
        const queue = [eligible.values().next().value as string];
        eligible.delete(queue[0]!);
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          for (const neighbour of adjacency.get(queue[cursor]!) ?? []) {
            if (!eligible.delete(neighbour)) continue;
            queue.push(neighbour);
          }
        }
      }
      const requested = project.settings.continentCount ?? 3;
      if (achieved !== requested) {
        add("warning", `Requested ${requested} major continents, but the current overland water quota and wrap topology sustain ${achieved}. Generate keeps the achieved movement components explicit; increase water or change wrapping to reach the requested count.`, overland.id);
      }
    }
  }

  const startLocations = new Map<string, { plane: Plane; province: Province }>();
  for (const plane of project.planes) for (const province of plane.provinces) {
    if (province.start || province.teamStart !== undefined) startLocations.set(`${plane.id}:${province.id}`, { plane, province });
  }
  for (const start of project.specificStarts) {
    const plane = project.planes.find(item => item.id === start.planeId);
    const province = plane?.provinces.find(item => item.id === start.provinceId);
    if (plane && province) startLocations.set(`${plane.id}:${province.id}`, { plane, province });
  }
  const protectedStartRingKeys = protectedStartProvinceKeys(project, 1);
  const gatewayStartNames = new Map<string, string>();
  for (const gate of project.gates) {
    const start = gate.endpoints.map(endpoint => startLocations.get(`${endpoint.planeId}:${endpoint.provinceId}`)).find(Boolean);
    if (!start) continue;
    for (const endpoint of gate.endpoints) {
      const key = `${endpoint.planeId}:${endpoint.provinceId}`;
      if (!gatewayStartNames.has(key)) gatewayStartNames.set(key, `${start.province.name} through gateway ${gate.gateNumber}`);
    }
  }
  const planeIds = new Set<string>();
  for (const plane of project.planes) {
    if (!plane.id.trim()) add("error", `${plane.name} needs a stable internal plane ID.`);
    else if (planeIds.has(plane.id)) add("error", `Plane ID ${plane.id} is duplicated; gates and cross-plane starts would be ambiguous.`, plane.id);
    planeIds.add(plane.id);
    if (!integerInRange(plane.provinceTarget, 8, 800)) add("error", `${plane.name} province target must be between 8 and 800.`, plane.id);
    if (plane.ownershipMode !== undefined && plane.ownershipMode !== "solid" && plane.ownershipMode !== "sparse") {
      add("error", `${plane.name} ownership mode must be solid or sparse.`, plane.id);
    }
    const waterProvenanceError = landformWaterError(plane);
    if (waterProvenanceError) add("error", `${plane.name}: ${waterProvenanceError}`, plane.id);
    if (plane.generationKey !== undefined && (typeof plane.generationKey !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(plane.generationKey))) {
      add("error", `${plane.name} has an invalid applied generation key.`, plane.id);
    }
    if (plane.landformStyle !== undefined && plane.landformStyle !== "natural-v1") {
      add("error", `${plane.name} has an unsupported natural landform style.`, plane.id);
    }
    if (plane.sparseLayout !== undefined && plane.sparseLayout !== "chambers" && plane.sparseLayout !== "regions") {
      add("error", `${plane.name} province layout must be chambers or regions.`, plane.id);
    }
    if (plane.kind === "underworld" && plane.wrapX && plane.wrapY) {
      add("warning", `${plane.name} wraps in both directions, so one River Styx band cannot form a true two-bank barrier across the torus. Disable at least one wrap axis and Generate again.`, plane.id);
    }
    if (!Number.isInteger(plane.width) || !Number.isInteger(plane.height)) add("error", `${plane.name} dimensions must be whole pixels.`, plane.id);
    if (plane.width < 256 || plane.height < 256) add("error", `${plane.name} is below Dominions' 256×256 minimum.`, plane.id);
    if (plane.width > 32767 || plane.height > 32767) add("error", `${plane.name} exceeds signed-short D6M coordinates.`, plane.id);
    if (plane.width > 3840 || plane.height > 3840 || plane.width * plane.height > MAX_D6M_PIXELS) {
      add("error", `${plane.name} exceeds the supported 8.29-megapixel export envelope. Choose 3840x2160, 2880x2880, or a smaller custom size.`, plane.id);
    }
    if (resolvePlaneOwnershipMode(plane) === "solid" && plane.provinces.length > 0
      && Number.isInteger(plane.width) && Number.isInteger(plane.height)
      && plane.width >= 256 && plane.height >= 256 && plane.width <= 3840 && plane.height <= 3840
      && plane.width * plane.height <= MAX_D6M_PIXELS
      && plane.width * plane.height / plane.provinces.length < 512) {
      add("warning", `${plane.name} has fewer than 512 native pixels per province. Very short borders can collapse below one pixel or merge visually at this resolution. Increase the output resolution or reduce the province count for clearer contacts; this is a raster-resolution caution, not a shape-generation failure.`, plane.id);
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
    if (plane.provinces.some((province, index) => province.index !== index + 1)) {
      add("error", `${plane.name} province array is not stored in local-number order; export would mismatch D6M geography and map commands.`, plane.id);
    }
    const capitalPixels = new Set<string>();
    for (const province of plane.provinces) {
      if (!Number.isFinite(province.x) || !Number.isFinite(province.y) || province.x < 0 || province.x > 1 || province.y < 0 || province.y > 1) {
        add("error", `${province.name}: province-center coordinates must be finite values from 0 to 1.`, plane.id, province.id);
        continue;
      }
      if (!Number.isInteger(plane.width) || !Number.isInteger(plane.height) || plane.width < 1 || plane.height < 1) continue;
      const x = Math.round(province.x * (plane.width - 1));
      const y = Math.round(province.y * (plane.height - 1));
      const key = `${x}:${y}`;
      if (capitalPixels.has(key)) add("error", `${plane.name} has multiple province centers on D6M pixel ${x},${y}.`, plane.id, province.id);
      capitalPixels.add(key);
    }

    const adjacency = adjacencyFor(plane);
    const protectedStartIds = new Set(plane.provinces
      .filter((province) => province.start
        || province.teamStart !== undefined
        || project.specificStarts.some((start) => start.planeId === plane.id && start.provinceId === province.id))
      .map((province) => province.id));
    const traversableProvinces = plane.provinces.filter((province) => !isBlockedProvince(province));
    const traversableAdjacency = adjacencyFor(plane, { traversableOnly: true });
    const protectedStartDistances = distancesToSources(traversableAdjacency, protectedStartIds, 2);
    const reachable = traversableProvinces.length
      ? shortestDistances(traversableAdjacency, traversableProvinces[0]!.id)
      : new Map<string, number>();
    const reachableTraversable = traversableProvinces.filter((province) => reachable.has(province.id)).length;
    if (reachableTraversable !== traversableProvinces.length) {
      add("error", `${plane.name} is disconnected for normal movement (${reachableTraversable}/${traversableProvinces.length} traversable provinces reachable).`, plane.id);
    }
    const topologyAudit = auditPlaneTopology(plane);
    if (usesConnectedRegions(plane)) {
      const layoutNotice = connectedRegionLayoutNotice(plane);
      if (layoutNotice) add("warning", `${plane.name}: ${layoutNotice}`, plane.id);
    }
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
    const edgeIds = new Set<string>();
    let duplicateEdgeIds = 0;
    for (const edge of plane.edges) {
      if (edgeIds.has(edge.id)) duplicateEdgeIds += 1;
      edgeIds.add(edge.id);
      if (!provinceIds.has(edge.a) || !provinceIds.has(edge.b)) add("error", "A connection references a missing province.", plane.id);
      if (edge.a === edge.b) add("error", "A province cannot neighbor itself.", plane.id, edge.a);
      const key = [edge.a, edge.b].sort().join("|");
      if (edgeKeys.has(key)) add("warning", "A province connection is duplicated.", plane.id, edge.a);
      edgeKeys.add(key);
      if (!EDGE_KIND_SET.has(edge.kind)) {
        add("error", `A connection has unknown edge kind ${String(edge.kind)}.`, plane.id, edge.a);
        continue;
      }
      if (edge.kind === "custom" && (edge.special === undefined || !integerInRange(edge.special, 0, 255))) {
        add("error", "A custom connection requires a safe whole-number bitmask from 0 to 255.", plane.id, edge.a);
      }
    }

    if (duplicateEdgeIds) {
      add("warning", `${plane.name} has ${duplicateEdgeIds} border${duplicateEdgeIds === 1 ? "" : "s"} sharing another border's ID, so border edits may change the wrong border. Use Synchronize borders to repair the IDs.`, plane.id);
    }

    for (const province of plane.provinces) {
      if (!TERRAIN_KEY_SET.has(province.terrain)) add("error", `${province.name}: unknown terrain ${String(province.terrain)}.`, plane.id, province.id);
      const isStartProvince = protectedStartIds.has(province.id);
      const adjacentStartId = isStartProvince
        ? undefined
        : adjacency.get(province.id)?.find((provinceId) => protectedStartIds.has(provinceId));
      const isStartNeighbor = !isStartProvince && protectedStartRingKeys.has(`${plane.id}:${province.id}`);
      const startRingName = isStartProvince
        ? province.name
        : plane.provinces.find((item) => item.id === adjacentStartId)?.name ?? gatewayStartNames.get(`${plane.id}:${province.id}`);
      if (protectedStartIds.has(province.id)) {
        if (province.noStart) add("error", `${province.name} is marked both Start and No start.`, plane.id, province.id);
        if (isBlockedProvince(province)) add("error", `${province.name} is a start on blocked terrain.`, plane.id, province.id);
        const targetDegree = project.settings.startDegreeTarget ?? 4;
        const hardMinimumDegree = Math.min(targetDegree, 4);
        // Cave Walls and impassable borders are declared neighbours but not exits.
        const startDegree = traversableAdjacency.get(province.id)?.length ?? 0;
        if (startDegree < hardMinimumDegree) {
          add("error", `${province.name} is a start with ${startDegree} traversable connections; at least ${hardMinimumDegree} are required.`, plane.id, province.id);
        } else if (startDegree < targetDegree) {
          add("warning", `${province.name} achieved ${startDegree} traversable connections; the requested ${targetDegree} is a best-effort preference above four.`, plane.id, province.id);
        }
        const blockingEdges = plane.edges.filter((edge) => (edge.a === province.id || edge.b === province.id) && blocksReliableStartMovement(edge));
        if (blockingEdges.length) add("error", `${province.name} has ${blockingEdges.length} blocking or condition-dependent start border${blockingEdges.length === 1 ? "" : "s"}.`, plane.id, province.id);
        if (province.defenders.length) add("error", `${province.name} is a start with authored independent defenders; capital provinces cannot retain independent guardian groups.`, plane.id, province.id);
      }
      if (province.teamStart !== undefined && (!Number.isSafeInteger(province.teamStart) || province.teamStart < 0)) add("error", `${province.name}: team-start group must be a non-negative safe integer smaller than the number of teams selected while hosting.`, plane.id, province.id);
      if (province.teamStart !== undefined && (province.noStart || isBlockedProvince(province))) add("error", `${province.name}: a team start cannot use no-start or blocked terrain.`, plane.id, province.id);
      if (province.owner !== undefined) {
        if (!isValidOwner(province.owner)) add("error", `${province.name}: owner must be independent 0, 2, or 4, or a playable nation ID of 5 or greater.`, plane.id, province.id);
        else if (isPlayerNationId(province.owner) && !findCatalogEntry(catalog.nations, province.owner)) {
          add("warning", `${province.name}: owner nation ${province.owner} is not in the active catalog; it requires matching custom content.`, plane.id, province.id);
        }
      }
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
      const blockedContent = blockedTerrainContentConflicts(province, catalog);
      if (blockedContent.length) add("error", `${province.name}: blocked Cave Wall cannot contain ${blockedContent.join(", ")}. Remove that content or the Cave Wall flag.`, plane.id, province.id);
      if (terrainFlags.has("sea") && terrainFlags.has("cavewall")) add("warning", `${province.name}: Sea + Cave Wall retains both flags and remains blocked, with submerged native relief. This combination's in-game appearance has not been verified; remove Cave Wall for traversable water.`, plane.id, province.id);
      if (terrainFlags.has("deep") && !terrainFlags.has("sea")) add("warning", `${province.name}: the deep-sea flag has no effect without the sea flag.`, plane.id, province.id);
      const adverseTerrainCount = ["forest", "swamp", "waste", "highland", "mountains"]
        .filter((flag) => terrainFlags.has(flag as "forest" | "swamp" | "waste" | "highland" | "mountains")).length;
      if (adverseTerrainCount > 2) add("warning", `${province.name} combines ${adverseTerrainCount} adverse terrain types; the map manual recommends at most two.`, plane.id, province.id);
      if (province.throne === "fixed" && !province.fixedThrone?.trim()) add("error", `${province.name} needs a throne site name or ID.`, plane.id, province.id);
      if (province.throne === "fixed" && province.fixedThrone?.trim()) {
        if (invalidPositiveNumericReference(province.fixedThrone)) add("error", `${province.name}: a numeric throne-site ID must be a positive safe integer.`, plane.id, province.id);
        const throne = findCatalogEntry(catalog.sites, province.fixedThrone);
        if (!throne) {
          add("warning", `${province.name}: fixed throne ${province.fixedThrone} is not in the active catalog.`, plane.id, province.id);
        } else {
          if (!throne.tags?.includes("throne")) add("error", `${province.name}: ${throne.name} is a magic site, not a throne site.`, plane.id, province.id);
          if (!siteCompatibility(throne, province, plane).compatible) add("warning", `${province.name}: ${throne.name} is not normally compatible with this province terrain.`, plane.id, province.id);
        }
      }
      if (province.poptype !== undefined && !findCatalogEntry(catalog.poptypes, province.poptype)) {
        add("error", `${province.name}: population type ${province.poptype} is not a vanilla Dominions 6 poptype.`, plane.id, province.id);
      }
      if (province.fort !== undefined && !findCatalogEntry(catalog.forts, province.fort)) {
        add("error", `${province.name}: fortification ${province.fort} is not listed in the Dominions 6 map manual.`, plane.id, province.id);
      }
      for (const site of province.sites) {
        if (!site.value.trim()) {
          add("error", `${province.name} has an empty magic-site entry.`, plane.id, province.id);
          continue;
        }
        if (invalidPositiveNumericReference(site.value)) {
          add("error", `${province.name}: a numeric magic-site ID must be a positive safe integer.`, plane.id, province.id);
          continue;
        }
        const knownSite = findCatalogEntry(catalog.sites, site.value);
        if (!knownSite) add("warning", `${province.name}: magic site ${site.value} is not in the active catalog.`, plane.id, province.id);
        else {
          if (!siteCompatibility(knownSite, province, plane).compatible) add("warning", `${province.name}: ${knownSite.name} is not normally compatible with this province terrain.`, plane.id, province.id);
          if (knownSite.tags?.includes("throne") && (isStartProvince || isStartNeighbor)) {
            add(
              "error",
              isStartProvince
                ? `${province.name} contains the throne site ${knownSite.name} on a player start; capitals must remain free of thrones.`
                : `${province.name} contains the throne site ${knownSite.name} adjacent to start province ${startRingName ?? "a start"}; the entire start one-ring must remain free of thrones.`,
              plane.id,
              province.id,
            );
          }
        }
      }
      if (province.throne === "preferred" || province.throne === "fixed") {
        if (isStartProvince) {
          add("error", `${province.name} is both a throne location and a player start; capitals must remain free of thrones.`, plane.id, province.id);
        } else if (isStartNeighbor) {
          add("error", `${province.name} is a throne location adjacent to start province ${startRingName ?? "a start"}; the entire start one-ring must remain free of thrones.`, plane.id, province.id);
        }
      }
      if ((isStartProvince || isStartNeighbor) && hasRawIndependentDefenderDirectives(province.rawDirectives)) {
        add(
          "error",
          isStartProvince
            ? `${province.name} is a player start with raw independent-defender directives; capitals must remain free of guardian and special-unit commands.`
            : `${province.name} has raw independent-defender directives adjacent to player start ${startRingName ?? "a start"}; the entire start one-ring must remain free of guardian and special-unit commands.`,
          plane.id,
          province.id,
        );
      }
      if (province.provinceDefense !== undefined && (province.owner === undefined || isIndependentOwner(province.owner))) {
        add("warning", `${province.name}: #defence only works for a nation-owned province; independent guardians use commander/unit groups.`, plane.id, province.id);
      }
      for (const defense of province.defenders) {
        if (!defense.commander.trim()) add("error", `${province.name} has a defender group without a commander.`, plane.id, province.id);
        else if (invalidPositiveNumericReference(defense.commander)) add("error", `${province.name}: a numeric commander ID must be a positive safe integer.`, plane.id, province.id);
        else if (!findCatalogEntry(catalog.units, defense.commander)) add("warning", `${province.name}: commander ${defense.commander} is not in the active unit catalog.`, plane.id, province.id);
        if (defense.experience !== undefined && !integerInRange(defense.experience, 0, 900)) add("error", `${province.name}: commander experience must be between 0 and 900.`, plane.id, province.id);
        if (defense.randomEquipment !== undefined && !integerInRange(defense.randomEquipment, 0, 4)) add("error", `${province.name}: random equipment richness must be between 0 and 4.`, plane.id, province.id);
        if (defense.bodyguard && !integerInRange(defense.bodyguardCount ?? 0, 1, 1000)) add("error", `${province.name} has bodyguards without a whole-number count from 1 to 1000.`, plane.id, province.id);
        if (defense.bodyguard && invalidPositiveNumericReference(defense.bodyguard)) add("error", `${province.name}: a numeric bodyguard ID must be a positive safe integer.`, plane.id, province.id);
        if (defense.bodyguard && !findCatalogEntry(catalog.units, defense.bodyguard)) add("warning", `${province.name}: bodyguard ${defense.bodyguard} is not in the active unit catalog.`, plane.id, province.id);
        if (defense.bodyguard && province.owner !== undefined && !isIndependentOwner(province.owner)) {
          add("warning", `${province.name}: bodyguards only affect independent commanders and will be ignored by a nation owner.`, plane.id, province.id);
        }
        for (const item of defense.items ?? []) {
          if (!item.trim() || /^-?\d+$/.test(item.trim())) add("error", `${province.name}: #additem requires a non-empty item name, not a numeric ID.`, plane.id, province.id);
        }
        for (const [path, level] of Object.entries(defense.magic ?? {})) {
          if (level !== undefined && !integerInRange(level, 0, 10)) add("error", `${province.name}: ${path} magic must be a whole number from 0 to 10.`, plane.id, province.id);
        }
        for (const squad of defense.squads) {
          if (!squad.unit.trim() || !integerInRange(squad.count, 1, 1000)) add("error", `${province.name} has an incomplete defender squad; counts must be whole numbers from 1 to 1000.`, plane.id, province.id);
          if (squad.unit.trim() && invalidPositiveNumericReference(squad.unit)) add("error", `${province.name}: a numeric squad-unit ID must be a positive safe integer.`, plane.id, province.id);
          else if (squad.unit.trim() && !findCatalogEntry(catalog.units, squad.unit)) add("warning", `${province.name}: squad unit ${squad.unit} is not in the active unit catalog.`, plane.id, province.id);
        }
      }
      if (!isStartProvince && province.defenders.length) {
        if (isStartNeighbor) {
          const description = powerfulGuardianForce(province)
            ? "a powerful independent guardian force"
            : "independent guardian groups";
          add(
            "error",
            `${province.name} has ${description} adjacent to player start ${startRingName ?? "a start"}; the entire start one-ring must remain free of independent defenders.`,
            plane.id,
            province.id,
          );
          continue;
        }
      }
      if (!protectedStartIds.has(province.id) && province.defenders.length && powerfulGuardianForce(province)) {
        const nearestStart = protectedStartDistances.get(province.id) ?? Infinity;
        if (nearestStart === 2) {
          add("warning", `${province.name} has a powerful independent guardian force only two moves from a player start; prefer at least three moves of expansion room.`, plane.id, province.id);
        }
      }
    }
    const starts = plane.provinces.filter((province) => province.start);
    if (starts.length) {
      const degrees = starts.map((province) => adjacency.get(province.id)?.length ?? 0);
      if (Math.min(...degrees) !== Math.max(...degrees)) add("warning", `${plane.name} start connection counts vary from ${Math.min(...degrees)} to ${Math.max(...degrees)}.`, plane.id);
    }
  }

  const genericStarts = project.planes.flatMap((plane) => plane.provinces.filter((province) => province.start).map((province) => ({ plane, province })));
  const starts = [...startLocations.values()];
  if (starts.length < project.settings.players) add("error", `Only ${starts.length} distinct start locations exist across all planes for ${project.settings.players} players.`);
  if (starts.length > project.settings.players) add("info", `The atlas has ${starts.length} distinct start locations for ${project.settings.players} players.`);
  if (starts.length > 1) {
    const localAdjacency = new Map(project.planes.map((plane) => [plane.id, adjacencyFor(plane)]));
    const degrees = starts.map(({ plane, province }) => localAdjacency.get(plane.id)!.get(province.id)?.length ?? 0);
    if (Math.min(...degrees) !== Math.max(...degrees)) add("warning", `Start connection counts across the atlas vary from ${Math.min(...degrees)} to ${Math.max(...degrees)}.`);
    const movement = globalMovementAdjacency(project);
    const globalKey = (planeId: string, provinceId: string) => `${planeId}:${provinceId}`;
    const nearestDistances = nearestSourceDistances(movement, starts.map(({ plane, province }) => globalKey(plane.id, province.id)));
    // Normal multiplayer maps get individual pair diagnostics. Hostile/imported
    // drafts with thousands of starts still get exact safety checks, but bounded output.
    const closeStarts = starts.filter(({ plane, province }) => (nearestDistances.get(globalKey(plane.id, province.id)) ?? Infinity) < 3);
    if (starts.length > 64 && closeStarts.length) {
      const first = closeStarts[0]!;
      add("error", `${closeStarts.length} of ${starts.length} distinct start locations are fewer than 3 movement connections from another start; distinct multiplayer starts require at least 3. Individual pair details are limited to atlases with at most 64 starts.`, first.plane.id, first.province.id);
    }
    for (let left = 0; starts.length <= 64 && left < starts.length; left += 1) {
      const a = starts[left]!;
      const fromA = shortestDistances(movement, globalKey(a.plane.id, a.province.id), 2);
      for (let right = left + 1; right < starts.length; right += 1) {
        const b = starts[right]!;
        const distance = fromA.get(globalKey(b.plane.id, b.province.id));
        if (distance === undefined || distance >= 3) continue;
        const aLabel = `${a.province.name} (${a.plane.name})`;
        const bLabel = `${b.province.name} (${b.plane.name})`;
        add(
          "error",
          `${aLabel} and ${bLabel} are only ${distance} movement connection${distance === 1 ? "" : "s"} apart; distinct multiplayer starts require at least 3.`,
          a.plane.id,
          a.province.id,
        );
      }
    }
    const preferredByStart = new Map<string, number>();
    for (const plane of project.planes) {
      const local = adjacencyFor(plane, { traversableOnly: true });
      const startKeysOnPlane = new Set(starts.filter((start) => start.plane.id === plane.id)
        .map((start) => start.province.id));
      const visited = new Set<string>();
      for (const province of plane.provinces) {
        if (visited.has(province.id) || isBlockedProvince(province)) continue;
        const component = [...shortestDistances(local, province.id).keys()].filter((id) => {
          const resolved = plane.provinces.find((item) => item.id === id);
          return resolved ? !isBlockedProvince(resolved) : false;
        });
        for (const id of component) visited.add(id);
        const componentStarts = component.filter((id) => startKeysOnPlane.has(id));
        if (!componentStarts.length) continue;
        const target = scaledStartSeparationTarget(component.length, componentStarts.length);
        for (const id of componentStarts) preferredByStart.set(globalKey(plane.id, id), target);
      }
    }
    const nearestByStart = starts.map(({ plane, province }) => {
      const key = globalKey(plane.id, province.id);
      const nearest = nearestDistances.get(key) ?? Infinity;
      return { plane, province, nearest, target: preferredByStart.get(key) ?? 3 };
    }).filter((item) => Number.isFinite(item.nearest));
    const belowScale = nearestByStart.filter((item) => item.nearest < item.target && item.nearest >= 3);
    if (belowScale.length) {
      const achieved = Math.min(...belowScale.map((item) => item.nearest));
      const requestedTarget = Math.max(...belowScale.map((item) => item.target));
      add(
        "warning",
        `Scale-aware start spacing reaches ${achieved} moves, below the preferred ${requestedTarget} for this map's traversable provinces per start; generation keeps the hard 3-move floor when the larger target is infeasible.`,
        belowScale[0]!.plane.id,
        belowScale[0]!.province.id,
      );
    }
    if (nearestByStart.length > 1) {
      const finiteNearest = nearestByStart.map((item) => item.nearest);
      const nearestSpread = Math.max(...finiteNearest) - Math.min(...finiteNearest);
      if (nearestSpread > 1) add("warning", `Nearest-hostile start distances vary by ${nearestSpread} moves; prefer a spread of at most 1 when editing or regenerating capitals.`);
    }
  }
  if (project.settings.startDistribution) {
    const actual = { land: 0, coastal: 0, water: 0, cave: 0, other: 0 };
    for (const { plane, province } of genericStarts) actual[classifyStart(plane, province)] += 1;
    for (const type of ["land", "coastal", "water", "cave", "other"] as const) {
      const requested = project.settings.startDistribution[type];
      if (actual[type] !== requested) add("error", `Requested ${requested} ${type} start${requested === 1 ? "" : "s"}, but generated ${actual[type]}.`);
    }
  }

  const specificNations = new Set<number>();
  const specificProvinces = new Set<string>();
  for (const start of project.specificStarts) {
    if (!isPlayerNationId(start.nation)) add("error", "A nation-specific start requires a player nation ID of 5 or greater.");
    else if (!findCatalogEntry(catalog.nations, start.nation)) add("warning", `Nation-specific start ${start.nation} is not in the active catalog; it requires matching custom content.`);
    const plane = project.planes.find((item) => item.id === start.planeId);
    const province = plane?.provinces.find((item) => item.id === start.provinceId);
    if (!plane || !province) add("error", `Nation-specific start for nation ${start.nation} references a missing province.`);
    else {
      if (province.noStart || isBlockedProvince(province)) add("error", `${province.name}: a nation-specific start cannot use no-start or blocked terrain.`, plane.id, province.id);
      const conflicts = nationSpecificStartFeatureConflicts(province);
      if (conflicts.length) {
        add(
          "error",
          `${province.name}: a nation-specific start still contains province setup that can interfere with its capital (${conflicts.join(", ")}). Reassign the specific start to clear it.`,
          plane.id,
          province.id,
        );
      }
    }
    if (specificNations.has(start.nation)) add("error", `Nation ${start.nation} has more than one nation-specific start.`);
    specificNations.add(start.nation);
    const provinceKey = `${start.planeId}:${start.provinceId}`;
    if (specificProvinces.has(provinceKey)) add("error", `${province?.name ?? "A province"} is assigned to more than one nation-specific start.`, plane?.id, province?.id);
    specificProvinces.add(provinceKey);
  }

  const configuredCaveProvinceKeys = new Set<string>();
  for (const nation of uniqueCaveStartNations) {
    const assignments = project.specificStarts.filter((start) => start.nation === nation);
    if (assignments.length === 0) {
      add("error", `Configured cave-start nation ${nation} has no current #specstart cave capital. Choose Generate to create its assignment.`);
      continue;
    }
    if (assignments.length !== 1) {
      add("error", `Configured cave-start nation ${nation} has ${assignments.length} #specstart assignments; exactly one distinct generated cave start is required.`);
      continue;
    }
    const assignment = assignments[0]!;
    const plane = project.planes.find((item) => item.id === assignment.planeId);
    const province = plane?.provinces.find((item) => item.id === assignment.provinceId);
    if (!plane || !province) continue;
    if (!province.start || classifyStart(plane, province) !== "cave") {
      const provenance = assignment.source === "generated-cave" ? "Generated" : "Manual";
      add(
        "error",
        `${provenance} #specstart for configured cave-start nation ${nation} is preserved, but ${province.name} is not an actual generated cave start. Move the manual assignment to a cave start or remove the conflict and choose Generate.`,
        plane.id,
        province.id,
      );
      continue;
    }
    const provinceKey = `${assignment.planeId}:${assignment.provinceId}`;
    if (configuredCaveProvinceKeys.has(provinceKey)) {
      add("error", `Configured cave-start nation ${nation} shares ${province.name}; every configured nation needs a distinct generated cave start.`, plane.id, province.id);
      continue;
    }
    configuredCaveProvinceKeys.add(provinceKey);
  }

  const gateNumbers = new Set<number>();
  const gateGroupsByEndpoint = new Map<string, { plane: Plane; province: Province; groups: number[] }>();
  // Start sets and adjacency depend only on the plane; build them once instead
  // of once per gate endpoint so large imported gate tables stay responsive.
  const gatePlaneContext = new Map<string, { protectedStarts: Set<string>; adjacency: Map<string, string[]> }>();
  const gateContextFor = (plane: Plane) => {
    let context = gatePlaneContext.get(plane.id);
    if (!context) {
      const specificStartIds = new Set(project.specificStarts.filter((start) => start.planeId === plane.id).map((start) => start.provinceId));
      context = {
        protectedStarts: new Set(plane.provinces
          .filter((item) => item.start || item.teamStart !== undefined || specificStartIds.has(item.id))
          .map((item) => item.id)),
        adjacency: adjacencyFor(plane),
      };
      gatePlaneContext.set(plane.id, context);
    }
    return context;
  };
  for (const gate of project.gates) {
    if (!Number.isSafeInteger(gate.gateNumber) || gate.gateNumber < 1) add("error", "Gate numbers must be positive safe integers.");
    if (gateNumbers.has(gate.gateNumber)) add("error", `Gate number ${gate.gateNumber} is duplicated across link groups.`);
    gateNumbers.add(gate.gateNumber);
    if (gate.endpoints.length < 2) add("error", `Gate ${gate.gateNumber} has fewer than two endpoints.`);
    const endpointKeys = new Set(gate.endpoints.map((endpoint) => `${endpoint.planeId}:${endpoint.provinceId}`));
    if (endpointKeys.size !== gate.endpoints.length) add("error", `Gate ${gate.gateNumber} repeats an endpoint.`);
    const resolvedEndpoints: Array<{ plane: Plane; province: Province }> = [];
    for (const endpoint of gate.endpoints) {
      const plane = project.planes.find((item) => item.id === endpoint.planeId);
      const province = plane?.provinces.find((item) => item.id === endpoint.provinceId);
      if (!plane || !province) add("error", `Gate ${gate.gateNumber} references a missing province.`);
      if (!plane || !province) continue;
      resolvedEndpoints.push({ plane, province });
      const endpointKey = `${plane.id}:${province.id}`;
      const usage = gateGroupsByEndpoint.get(endpointKey) ?? { plane, province, groups: [] };
      if (!usage.groups.includes(gate.gateNumber)) usage.groups.push(gate.gateNumber);
      gateGroupsByEndpoint.set(endpointKey, usage);
      if (isBlockedProvince(province)) {
        add("error", `Gate ${gate.gateNumber} endpoint ${province.name} is on blocked terrain.`, plane.id, province.id);
        continue;
      }
      const { protectedStarts, adjacency: gateAdjacency } = gateContextFor(plane);
      if (protectedStarts.has(province.id)) {
        add("warning", `Gate ${gate.gateNumber} is in start province ${province.name}; regenerate or move it when the plane has another valid endpoint.`, plane.id, province.id);
        continue;
      }
      const adjacentStart = gateAdjacency.get(province.id)?.find((provinceId) => protectedStarts.has(provinceId));
      if (adjacentStart) {
        const startName = plane.provinces.find((item) => item.id === adjacentStart)?.name ?? "a start";
        add("warning", `Gate ${gate.gateNumber} in ${province.name} is adjacent to start province ${startName}; prefer an endpoint at least two connections away.`, plane.id, province.id);
      }
    }
    for (let left = 0; left < resolvedEndpoints.length; left += 1) {
      for (let right = left + 1; right < resolvedEndpoints.length; right += 1) {
        const a = resolvedEndpoints[left]!;
        const b = resolvedEndpoints[right]!;
        const aSurface = (a.plane.kind === "surface" || a.plane.kind === "custom") && resolvePlaneOwnershipMode(a.plane) === "solid";
        const bSurface = (b.plane.kind === "surface" || b.plane.kind === "custom") && resolvePlaneOwnershipMode(b.plane) === "solid";
        const aSubterranean = a.plane.kind === "cave" || a.plane.kind === "cavern" || a.plane.kind === "underworld";
        const bSubterranean = b.plane.kind === "cave" || b.plane.kind === "cavern" || b.plane.kind === "underworld";
        if (!((aSurface && bSubterranean) || (bSurface && aSubterranean))) continue;
        if (isWaterProvince(a.province) === isWaterProvince(b.province)) continue;
        add("error", `Gate ${gate.gateNumber} mixes a dry endpoint with an aquatic surface-to-subterranean endpoint; move both ends to matching water status or regenerate the link.`);
      }
    }
  }
  for (const { plane, province, groups } of gateGroupsByEndpoint.values()) {
    if (groups.length < 2) continue;
    add("warning", `${province.name} is an endpoint of gates ${groups.join(", ")}; the generator uses one gate per province and Dominions' handling of several #gate lines on one province is unverified.`, plane.id, province.id);
  }
  if (project.planes.length > 1) {
    const connectedPlanes = new Set<string>([project.planes[0]!.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const gate of project.gates) {
        const validEndpoints = gate.endpoints.filter((endpoint) => {
          const plane = project.planes.find((item) => item.id === endpoint.planeId);
          const province = plane?.provinces.find((item) => item.id === endpoint.provinceId);
          return !!plane && !!province && !isBlockedProvince(province);
        });
        if (!validEndpoints.some((endpoint) => connectedPlanes.has(endpoint.planeId))) continue;
        for (const endpoint of validEndpoints) {
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
  if (project.populationDefense?.enabled) {
    const plan = buildInitialDefensePlan(project, catalog, project.populationDefense, populationProfiles);
    if (project.rawDirectives.trim() || project.planes.some(plane => plane.rawDirectives.trim()
      || plane.provinces.some(province => province.rawDirectives.trim()))) {
      add("warning", "Population-matched initial defenders are suspended across this atlas because raw directives can change province selection or contents. Authored commands and custom guardian groups are preserved; Atlas adds no derived replacement armies while any raw directives remain.");
    }
    if (plan.counts.unsupported) {
      const reasons = new Map<string, { count: number; message: string }>();
      for (const row of plan.entries.values()) if (row.status === "unsupported") {
        const previous = reasons.get(row.reason);
        reasons.set(row.reason, { count: (previous?.count ?? 0) + 1, message: row.message });
      }
      add("warning", `Population-matched initial defenders: ${plan.counts.unsupported} eligible province${plan.counts.unsupported === 1 ? " has" : "s have"} no usable verified template and retain normal engine-generated armies. No empty replacement army is exported. ${[...reasons.values()].map(reason => `${reason.count}: ${reason.message}`).join(" ")}`);
    }
    if (plan.counts.derived) add("info", `Population-matched initial defenders: ${plan.counts.derived} province${plan.counts.derived === 1 ? " uses" : "s use"} verified, revision-pinned recruitment identities with fixed authored counts. These are initial armies, not calibrated combat difficulty or post-capture province defense.`);
  }
  if (!issues.some((issue) => issue.severity === "error")) add("info", "Compatibility checks passed; the package is ready for Dominions 6.");
  return issues;
}

export function estimatedD6mBytes(plane: Plane): number {
  return 34 + plane.provinces.length * 12 + plane.width * plane.height * 4 + 4;
}

export function terrainPreviewKey(terrain: TerrainKey, condition: string): TerrainKey {
  return terrainVisualKey(previewProvinceTerrain({ terrain }, condition));
}

function minimumCapitalDistance(plane: Plane, width: number, height: number): number {
  if (plane.provinces.length < 2) return 0;
  const centers = plane.provinces.map((province) => ({
    x: clamp(Math.round(province.x * (width - 1)), 0, width - 1),
    y: clamp(Math.round(province.y * (height - 1)), 0, height - 1),
  }));
  let minimum = Infinity;
  for (let i = 0; i < centers.length; i += 1) {
    for (let j = i + 1; j < centers.length; j += 1) {
      const a = centers[i]!;
      const b = centers[j]!;
      let dx = Math.abs(a.x - b.x);
      let dy = Math.abs(a.y - b.y);
      if (plane.wrapX) dx = Math.min(dx, width - dx);
      if (plane.wrapY) dy = Math.min(dy, height - dy);
      minimum = Math.min(minimum, Math.hypot(dx, dy));
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function pixelNoise(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y + seed, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 15;
  return ((value >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Square-pixel, map-relative value noise. The lattice and per-axis smoothstep
 * weights are prepared once, so an owned pixel uses only two bilinear samples
 * (eight bounded lattice lookups), with no per-pixel hashes or trigonometry.
 * Whole lattice periods meet smoothly at enabled wrap seams. Using the shorter
 * map axis as the scale keeps portrait and ultrawide maps from stretching the
 * relief into stripes, and keeps its visual scale stable between 256px and 4K.
 */
function createUndergroundReliefSampler(
  plane: Plane, width: number, height: number, seed: number, baseHeights: readonly number[],
): (x: number, y: number, owner: number) => number {
  const shortSide = Math.min(width, height);
  const broad = smoothReliefOctave(width, height, shortSide, 6, plane.wrapX, plane.wrapY, seed);
  const detail = smoothReliefOctave(width, height, shortSide, 18, plane.wrapX, plane.wrapY, seed ^ 0x9e3779b9);
  // Even very low dry terrain must remain above zero; aquatic terrain must
  // remain below it. Terrain/spec semantics are never inferred from this art.
  const amplitudes = baseHeights.map((base) => Math.min(24, Math.abs(base) * 0.45));
  const centerX = plane.provinces.map((province) => clamp(Math.round(province.x * (width - 1)), 0, width - 1));
  const centerY = plane.provinces.map((province) => clamp(Math.round(province.y * (height - 1)), 0, height - 1));
  const anchorRadius = shortSide / 32;
  const inverseAnchorRadiusSquared = 1 / (anchorRadius * anchorRadius);
  return (x, y, owner) => {
    let relief = (broad(x, y) * 0.75 + detail(x, y) * 0.25) * amplitudes[owner]!;
    let dx = Math.abs(x - centerX[owner]!);
    let dy = Math.abs(y - centerY[owner]!);
    if (plane.wrapX) dx = Math.min(dx, width - dx);
    if (plane.wrapY) dy = Math.min(dy, height - dy);
    if (dx < anchorRadius && dy < anchorRadius) {
      // Exact native capital heights are an existing contract. Fade nearby
      // relief toward them instead of leaving an isolated one-pixel spike.
      const t = Math.min(1, (dx * dx + dy * dy) * inverseAnchorRadiusSquared);
      relief *= t * t * (3 - 2 * t);
    }
    return relief;
  };
}

function smoothReliefOctave(
  width: number, height: number, shortSide: number, frequency: number,
  wrapX: boolean, wrapY: boolean, seed: number,
): (x: number, y: number) => number {
  const columns = Math.max(1, Math.round(width / shortSide * frequency));
  const rows = Math.max(1, Math.round(height / shortSide * frequency));
  const stride = columns + 1;
  const values = new Float32Array(stride * (rows + 1));
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= columns; x += 1) {
      values[y * stride + x] = pixelNoise(wrapX && x === columns ? 0 : x, wrapY && y === rows ? 0 : y, seed);
    }
  }
  const axis = (length: number, cells: number, offsetStride: number) => {
    const offsets = new Uint32Array(length);
    const weights = new Float32Array(length);
    for (let pixel = 0; pixel < length; pixel += 1) {
      const position = (pixel + 0.5) / length * cells;
      const cell = Math.floor(position);
      const t = position - cell;
      offsets[pixel] = cell * offsetStride;
      weights[pixel] = t * t * (3 - 2 * t);
    }
    return { offsets, weights };
  };
  const horizontal = axis(width, columns, 1);
  const vertical = axis(height, rows, stride);
  return (x, y) => {
    const offset = horizontal.offsets[x]! + vertical.offsets[y]!;
    const a = values[offset]!;
    const b = values[offset + stride]!;
    const top = a + (values[offset + 1]! - a) * horizontal.weights[x]!;
    const bottom = b + (values[offset + stride + 1]! - b) * horizontal.weights[x]!;
    return top + (bottom - top) * vertical.weights[y]!;
  };
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
  return catalogReferenceArg(value);
}

function unitArg(value: string): string {
  return catalogReferenceArg(value);
}

function catalogReferenceArg(value: string): string {
  const trimmed = value.trim();
  const numeric = positiveIntegerReferenceValue(trimmed);
  return numeric !== undefined
    ? String(numeric)
    : quote(trimmed);
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
  // Collapse whole runs so "a---b" cannot leave a "--" comment marker behind;
  // quotes and "//" would otherwise start a string or comment in native parsers.
  return value.replace(/[\r\n#]+/g, " ").replace(/-{2,}/g, "-").replace(/\/{2,}/g, "/").replace(/"/g, "'").trim() || "Untitled";
}

function safeComment(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/-{2,}/g, "-").trim();
}

function appendRaw(lines: string[], raw: string) {
  const clean = raw
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#") || line.startsWith("--"));
  if (clean.length) lines.push(...clean);
}

function uniquePlayerNationIds(values: number[]): number[] {
  return [...new Set(values.filter(isPlayerNationId))];
}

function integerInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function invalidPositiveNumericReference(value: string): boolean {
  const numeric = numericReferenceValue(value);
  if (numeric === undefined) return false;
  return positiveIntegerReferenceValue(value) === undefined;
}

/**
 * Recognize an entirely numeric catalog reference before deciding whether it
 * can instead be treated as a named mod entry. Only unsigned integer syntax
 * (with an optional catalog-search # prefix) is accepted for IDs; signed,
 * decimal, exponent, non-positive, and unsafe values are rejected by
 * validation. Arbitrary nonnumeric mod names remain valid.
 */
function numericReferenceValue(value: string): number | undefined {
  const trimmed = value.trim().replace(/^#/, "");
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

function positiveIntegerReferenceValue(value: string): number | undefined {
  const trimmed = value.trim().replace(/^#/, "");
  if (!/^\d+$/.test(trimmed)) return undefined;
  const numeric = Number(trimmed);
  return Number.isSafeInteger(numeric) && numeric >= 1 ? numeric : undefined;
}

function isIndependentOwner(nation: number): boolean {
  return nation === 0 || nation === 2 || nation === 4;
}

function isValidOwner(nation: number): boolean {
  return Number.isSafeInteger(nation) && (isIndependentOwner(nation) || nation >= 5);
}

function isPlayerNationId(nation: number): boolean {
  return Number.isSafeInteger(nation) && nation >= 5;
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

function powerfulGuardianForce(province: Province): boolean {
  const troopCount = province.defenders.reduce((total, group) => total
    + group.squads.reduce((sum, squad) => sum + Math.max(0, squad.count), 0)
    + Math.max(0, group.bodyguardCount ?? 0), 0);
  return troopCount >= 28
    || province.defenders.length >= 2
    || province.defenders.some((group) => (group.experience ?? 0) > 0
      || (group.randomEquipment ?? 0) > 0
      || Object.values(group.magic ?? {}).some((level) => (level ?? 0) > 0));
}

function blocksReliableStartMovement(edge: Edge): boolean {
  // Bits 1, 2, and 4 are pass, river, and impassable respectively. Combined
  // special codes such as 33 and 36 retain the same movement behavior. Named
  // mountain borders match the generator's start-edge rule.
  return edge.kind === "mountain_border" || (edgeSpecial(edge) & 0b111) !== 0;
}

function classifyStart(plane: Plane, province: Province): StartType {
  return classifyCurrentStart(plane, province);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
