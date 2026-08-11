import {
  BIOME_LABELS,
  MAX_PLANES,
  RESOLUTION_PRESETS,
  SCHEMA_VERSION,
  cloneProject,
  effectiveProvinceTerrainFlags,
  isBlockedProvince,
  isBlockedTerrain,
  isCaveProvince,
  isWaterProvince,
  isWaterTerrain,
  type BiomeKey,
  type Edge,
  type EdgeKind,
  type FairnessMetrics,
  type GateDirection,
  type GateLink,
  type GateLayout,
  type GenerationSettings,
  type MagicPath,
  type MapProject,
  type Plane,
  type PlaneConnectionRule,
  type PlaneKind,
  type PlaneVariant,
  type Province,
  type StartDistribution,
  type StartType,
  type TerrainKey,
} from "./domain";
import { computeProvinceTopology, connectionKey } from "./geometry";

const TAU = Math.PI * 2;

const NAME_PARTS: Record<BiomeKey, [string[], string[]]> = {
  heartland: [["Amber", "Golden", "Kings", "Old", "River", "Valen", "Green"], ["field", "march", "ford", "mead", "vale", "cross", "holm"]],
  wildwood: [["Ash", "Briar", "Elder", "Moon", "Thorn", "Verdant", "Whisper"], ["wood", "grove", "weald", "shade", "bough", "hollow", "wilds"]],
  marshlands: [["Black", "Mire", "Mist", "Reed", "Sable", "Still", "Fen"], ["marsh", "fen", "mere", "water", "mire", "reach", "bog"]],
  sunscorched: [["Ash", "Copper", "Dun", "Red", "Salt", "Sun", "White"], ["waste", "scar", "dune", "reach", "desert", "expanse", "flats"]],
  high_country: [["Cloud", "Crag", "Eagle", "Granite", "Iron", "Storm", "High"], ["peak", "ridge", "crown", "pass", "heights", "spine", "tor"]],
  tundra: [["Frost", "Grey", "Ice", "Pale", "Rime", "Snow", "Winter"], ["fell", "wold", "reach", "plain", "waste", "march", "cairn"]],
  archipelago: [["Azure", "Coral", "Gull", "Pearl", "Sapphire", "Tide", "Wave"], ["isles", "bank", "sound", "shoal", "bay", "keys", "reef"]],
  deep_ocean: [["Abyssal", "Black", "Drowned", "Endless", "Leviathan", "Midnight", "Sunken"], ["deep", "trench", "sea", "basin", "gulf", "waters", "rift"]],
  living_caves: [["Bracken", "Fungal", "Moss", "Root", "Spore", "Verdant", "Worm"], ["cavern", "hollow", "grotto", "vault", "maze", "deep", "burrow"]],
  crystal_deeps: [["Amethyst", "Crystal", "Diamond", "Glass", "Opal", "Prism", "Star"], ["gallery", "vault", "cavern", "hall", "geode", "deep", "maze"]],
  ashen_deeps: [["Ash", "Cinder", "Ember", "Iron", "Obsidian", "Scoria", "Soot"], ["pit", "vault", "fissure", "deep", "forge", "chasm", "scar"]],
  void_reaches: [["Dream", "Echo", "Hollow", "Nameless", "Silent", "Twilight", "Unseen"], ["reach", "rift", "fold", "expanse", "maze", "threshold", "beyond"]],
};

const TERRAIN_POPULATION: Record<TerrainKey, number> = {
  plains: 8200,
  forest: 6200,
  farm: 10800,
  swamp: 4700,
  waste: 2900,
  highland: 5200,
  mountains: 4300,
  freshwater: 8200,
  sea: 5600,
  deepsea: 3800,
  kelp: 6500,
  cave: 4300,
  caveforest: 5100,
  caveswamp: 3900,
  cavewaste: 2600,
  cavehighland: 3600,
  cavewall: 0,
};

interface ArchetypeProfile {
  defaultVariant: PlaneVariant;
  sitePaths: MagicPath[];
  poptypes: number[];
  populationScale: number;
  waterCapable: boolean;
  caveFamily: boolean;
  manySitesChance: number;
}

/**
 * Poptypes are Dominions' native independent-population templates. The manual
 * guarantees their recruitable effect; PD implications come from game data,
 * and they do not change the initial independent army. Selected non-start
 * provinces therefore receive explicit guardian squads below.
 */
const ARCHETYPE_PROFILES: Record<PlaneKind, ArchetypeProfile> = {
  surface: { defaultVariant: "temperate", sitePaths: ["nature", "earth"], poptypes: [25, 26, 27, 28, 29, 30, 37, 39, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60], populationScale: 1, waterCapable: true, caveFamily: false, manySitesChance: 0.09 },
  cave: { defaultVariant: "fungal", sitePaths: ["earth", "death", "glamour"], poptypes: [44, 66, 67, 81, 84, 93], populationScale: 0.78, waterCapable: false, caveFamily: true, manySitesChance: 0.13 },
  cavern: { defaultVariant: "crystal", sitePaths: ["earth", "astral", "glamour"], poptypes: [44, 66, 67, 81, 84, 93], populationScale: 0.9, waterCapable: false, caveFamily: true, manySitesChance: 0.15 },
  cloud: { defaultVariant: "storm", sitePaths: ["air", "glamour"], poptypes: [34, 37, 39, 48], populationScale: 0.72, waterCapable: false, caveFamily: false, manySitesChance: 0.15 },
  air: { defaultVariant: "storm", sitePaths: ["air", "astral", "glamour"], poptypes: [34, 37, 39, 48], populationScale: 0.68, waterCapable: false, caveFamily: false, manySitesChance: 0.17 },
  underworld: { defaultVariant: "fungal", sitePaths: ["earth", "death", "glamour"], poptypes: [44, 66, 67, 81, 84, 93, 96], populationScale: 0.8, waterCapable: false, caveFamily: true, manySitesChance: 0.14 },
  hell: { defaultVariant: "infernal", sitePaths: ["fire", "death", "blood"], poptypes: [67, 94, 96], populationScale: 0.62, waterCapable: false, caveFamily: true, manySitesChance: 0.18 },
  abyss: { defaultVariant: "void", sitePaths: ["death", "astral", "glamour"], poptypes: [66, 93, 96, 106], populationScale: 0.5, waterCapable: false, caveFamily: true, manySitesChance: 0.2 },
  dream: { defaultVariant: "wild", sitePaths: ["astral", "glamour", "nature"], poptypes: [37, 39, 48, 49, 54, 60], populationScale: 0.84, waterCapable: true, caveFamily: false, manySitesChance: 0.18 },
  elemental: { defaultVariant: "volcanic", sitePaths: ["fire", "air", "water", "earth"], poptypes: [30, 34, 44, 48, 94], populationScale: 0.7, waterCapable: true, caveFamily: false, manySitesChance: 0.18 },
  custom: { defaultVariant: "temperate", sitePaths: ["astral"], poptypes: [25, 26, 27, 28, 29, 30, 37, 39, 48], populationScale: 1, waterCapable: true, caveFamily: false, manySitesChance: 0.09 },
};

const START_TYPES: StartType[] = ["land", "coastal", "water", "cave", "other"];

export interface AddPlaneOptions {
  /** Generate immediately for compatibility; set false to configure all planes first. */
  generate?: boolean;
  variant?: PlaneVariant;
  provinceTarget?: number;
  name?: string;
  autoSize?: boolean;
}

interface GeneratePlaneOptions {
  deferStrategicFeatures?: boolean;
  waterPercent?: number;
}

export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    this.state = hashString(seed) || 0x6d2b79f5;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function idFor(seed: string, scope: string, index: number): string {
  const a = hashString(`${seed}:${scope}:${index}`).toString(36);
  const b = hashString(`${scope}:${index}:${seed}:atlas`).toString(36);
  return `${scope}-${a}-${b}`;
}

function field(x: number, y: number, salt: number): number {
  const a = Math.sin((x * (1.35 + (salt % 3) * 0.21) + salt * 0.173) * TAU);
  const b = Math.cos((y * (1.17 + (salt % 5) * 0.13) - salt * 0.091) * TAU);
  const c = Math.sin(((x + y) * 0.71 + salt * 0.037) * TAU);
  const d = Math.cos(((x - y) * 1.93 - salt * 0.019) * TAU);
  return (a * 0.38 + b * 0.31 + c * 0.21 + d * 0.1 + 1) / 2;
}

function defaultPlane(seed: string, index: number, kind: PlaneKind = "surface"): Plane {
  const preset = RESOLUTION_PRESETS["4k"];
  return {
    id: idFor(seed, "plane", index),
    name: index === 0 ? "Pantokrator's Realm" : defaultPlaneName(kind, index),
    kind,
    variant: ARCHETYPE_PROFILES[kind].defaultVariant,
    autoSize: index === 0,
    provinceTarget: index === 0 ? 96 : 48,
    width: preset.width,
    height: preset.height,
    wrapX: true,
    wrapY: true,
    provinces: [],
    edges: [],
    rawDirectives: "",
  };
}

function defaultPlaneName(kind: PlaneKind, index: number): string {
  const names: Partial<Record<PlaneKind, string>> = {
    cave: "The Caves",
    cavern: "The Great Cavern",
    cloud: "The Cloud Realm",
    air: "The Firmament",
    underworld: "The Underworld",
    hell: "The Inferno",
    abyss: "The Abyss",
    dream: "The Dreamlands",
    elemental: "The Elemental Expanse",
  };
  return names[kind] ?? `Plane ${index + 1}`;
}

export function createDefaultProject(seed = "pantokrator-001"): MapProject {
  const now = new Date().toISOString();
  const settings: GenerationSettings = {
    players: 6,
    provincesPerPlayer: 16,
    waterPercent: 18,
    biomeCohesion: 68,
    throneCount: 8,
    startDistribution: { land: 6, coastal: 0, water: 0, cave: 0, other: 0 },
    startDegreeTarget: 4,
    gateLayout: "compatible",
    gateDirection: "bidirectional",
    resolution: "4k",
  };
  const project: MapProject = {
    schemaVersion: SCHEMA_VERSION,
    name: "Pantokrator Atlas",
    description: "A varied, multiplayer-balanced realm generated for Dominions 6.",
    seed,
    targetVersion: 635,
    settings,
    mapNoHide: false,
    noDeepCaves: true,
    noDeepChoice: true,
    noHomelandNames: false,
    noNameFilter: false,
    sailDistance: 2,
    victoryPoints: undefined,
    allowedPlayers: [],
    computerPlayers: [],
    cannotWin: [],
    specificStarts: [],
    planes: [defaultPlane(seed, 0)],
    gates: [],
    rawDirectives: "",
    createdAt: now,
    updatedAt: now,
  };
  project.planes[0]!.provinceTarget = settings.players * settings.provincesPerPlayer;
  return generateProject(project);
}

export function applyResolution(project: MapProject, resolution: GenerationSettings["resolution"]): MapProject {
  const next = cloneProject(project);
  next.settings.resolution = resolution;
  if (resolution !== "custom") {
    const preset = RESOLUTION_PRESETS[resolution];
    for (const plane of next.planes) {
      plane.width = preset.width;
      plane.height = preset.height;
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function addPlane(project: MapProject, kind: PlaneKind = "underworld", options: AddPlaneOptions = {}): MapProject {
  if (project.planes.length >= MAX_PLANES) return project;
  const next = cloneProject(project);
  const plane = defaultPlane(project.seed, next.planes.length, kind);
  if (next.settings.resolution !== "custom") {
    const preset = RESOLUTION_PRESETS[next.settings.resolution];
    plane.width = preset.width;
    plane.height = preset.height;
  }
  plane.variant = options.variant ?? plane.variant;
  plane.autoSize = options.autoSize ?? false;
  plane.name = options.name?.trim() || plane.name;
  plane.provinceTarget = clamp(
    Math.round(options.provinceTarget ?? next.settings.players * next.settings.provincesPerPlayer * 0.45),
    8,
    800,
  );
  const planeIndex = next.planes.length;
  next.planes.push(options.generate === false
    ? plane
    : generatePlane(plane, next.settings, `${project.seed}:plane:${planeIndex}`, planeIndex));
  next.gates = options.generate === false ? [] : generateGates(next);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function generateProject(project: MapProject): MapProject {
  const next = cloneProject(project);
  next.schemaVersion = SCHEMA_VERSION;
  next.settings.players = clamp(Math.round(next.settings.players), 2, 32);
  next.settings.provincesPerPlayer = clamp(Math.round(next.settings.provincesPerPlayer), 8, 30);
  next.settings.waterPercent = clamp(Math.round(next.settings.waterPercent), 0, 60);
  next.settings.biomeCohesion = clamp(Math.round(next.settings.biomeCohesion), 0, 100);
  next.settings.throneCount = clamp(Math.round(next.settings.throneCount), 0, 64);
  next.settings.startDegreeTarget = clamp(Math.round(next.settings.startDegreeTarget ?? 4), 1, 8);
  next.settings.gateLayout = normalizeGateLayout(next.settings.gateLayout);
  next.settings.gateDirection = normalizeGateDirection(next.settings.gateDirection);
  if (next.settings.gatePairsPerConnection !== undefined) {
    next.settings.gatePairsPerConnection = clamp(Math.round(next.settings.gatePairsPerConnection), 1, 3);
  }
  next.settings.startDistribution = normalizeStartDistribution(next.settings.startDistribution, next.settings.players);
  if (!next.planes.length) next.planes = [defaultPlane(next.seed, 0)];
  next.planes = next.planes.slice(0, MAX_PLANES);

  next.planes = next.planes.map((plane, index) => {
    const normalized = cloneProject({ ...next, planes: [plane] } as MapProject).planes[0]!;
    normalized.kind = normalizePlaneKind(normalized.kind);
    normalized.variant = normalized.variant ?? ARCHETYPE_PROFILES[normalized.kind].defaultVariant;
    normalized.autoSize = normalized.autoSize ?? index === 0;
    if (normalized.autoSize) {
      normalized.provinceTarget = index === 0
        ? next.settings.players * next.settings.provincesPerPlayer
        : Math.max(18, Math.round(next.settings.players * next.settings.provincesPerPlayer * 0.45));
    }
    normalized.provinceTarget = clamp(Math.round(normalized.provinceTarget), 8, 800);
    const requestedWater = next.settings.startDistribution!.water + (next.settings.startDistribution!.coastal ? Math.max(2, next.settings.startDistribution!.coastal) : 0);
    const waterPercent = ARCHETYPE_PROFILES[normalized.kind].waterCapable
      ? Math.max(next.settings.waterPercent, Math.ceil((requestedWater * 100) / normalized.provinceTarget))
      : 0;
    return generatePlane(normalized, next.settings, `${next.seed}:plane:${index}:v1`, index, {
      deferStrategicFeatures: true,
      waterPercent,
    });
  });
  if (next.settings.planeConnections !== undefined) {
    next.settings.planeConnections = normalizePlaneConnections(next.settings.planeConnections, next.planes);
  }
  placeDistributedStarts(next);
  distributeThrones(next);
  for (const plane of next.planes) {
    if (plane.provinces.some((province) => province.start)) balanceStartRegions(plane);
    markProvinceSizes(plane);
  }
  balanceGlobalStartRegions(next);
  next.gates = generateGates(next);
  next.specificStarts = next.specificStarts.filter((start) =>
    next.planes.some((plane) => plane.id === start.planeId && plane.provinces.some((province) => province.id === start.provinceId)),
  );
  next.updatedAt = new Date().toISOString();
  return next;
}

export function generatePlane(
  source: Plane,
  settings: GenerationSettings,
  stageSeed: string,
  planeIndex: number,
  options: GeneratePlaneOptions = {},
): Plane {
  const rng = new SeededRandom(stageSeed);
  const count = clamp(Math.round(source.provinceTarget), 8, 800);
  const aspect = source.width / source.height;
  const cols = Math.max(3, Math.ceil(Math.sqrt(count * aspect)));
  const rows = Math.max(2, Math.ceil(count / cols));
  const provinces: Province[] = [];

  for (let index = 0; index < count; index += 1) {
    const gridX = index % cols;
    const gridY = Math.floor(index / cols);
    const x = clamp((gridX + 0.5 + (rng.next() - 0.5) * 0.46) / cols, 0.003, 0.997);
    const y = clamp((gridY + 0.5 + (rng.next() - 0.5) * 0.46) / rows, 0.003, 0.997);
    const climate = climateAt(x, y, hashString(stageSeed));
    const terrainBiome = chooseTerrain(source.kind, source.variant, climate, rng, settings, x, y);
    const profile = ARCHETYPE_PROFILES[source.kind];
    const populationBase = TERRAIN_POPULATION[terrainBiome.terrain];
    const population = populationBase
      ? Math.max(100, Math.round((populationBase * profile.populationScale * (0.83 + rng.next() * 0.34)) / 10) * 10)
      : undefined;
    const siteBias = mergePaths(siteBiasFor(terrainBiome.terrain, climate), profile.sitePaths, 3);
    provinces.push({
      id: idFor(stageSeed, "province", index),
      index: index + 1,
      x,
      y,
      gridX,
      gridY,
      name: makeProvinceName(terrainBiome.biome, index, rng),
      biome: terrainBiome.biome,
      terrain: terrainBiome.terrain,
      freshwater: !isBlockedTerrain(terrainBiome.terrain) && climate.moisture > 0.64 && rng.chance(0.22) || undefined,
      small: false,
      large: false,
      noStart: isBlockedTerrain(terrainBiome.terrain),
      manySites: rng.chance(profile.manySitesChance),
      warmer: source.variant === "volcanic" || source.variant === "infernal"
        ? rng.chance(0.62)
        : climate.temperature > 0.89 && rng.chance(0.35),
      colder: source.variant === "frozen"
        ? rng.chance(0.68)
        : climate.temperature < 0.12 && rng.chance(0.35),
      siteBias,
      start: false,
      throne: "none",
      sites: [],
      killRandomSites: false,
      population,
      temple: false,
      lab: false,
      defenders: [],
      battle: {},
      rawDirectives: "",
    });
  }

  enforceWaterQuota(provinces, source.kind, source.variant, options.waterPercent ?? settings.waterPercent, stageSeed);
  enforceTerrainVariety(provinces, source.kind, source.variant, stageSeed);
  assignArchetypeDetails(provinces, source.kind, stageSeed);
  const edges = buildEdges(provinces, source, stageSeed);
  const generated: Plane = { ...source, provinces, edges };

  if (!options.deferStrategicFeatures) {
    if (planeIndex === 0) {
      placeStarts(generated, settings.players, stageSeed, settings.startDegreeTarget ?? 4, "land");
      repairStartBorders(generated);
      clearStartZoneGuardians(generated);
    }
    placeThrones(generated, planeIndex === 0 ? settings.throneCount : Math.max(1, Math.round(settings.throneCount * 0.35)), stageSeed);
    if (planeIndex === 0) balanceStartRegions(generated);
  }
  markProvinceSizes(generated);
  return generated;
}

function climateAt(x: number, y: number, salt: number) {
  return {
    elevation: clamp(field(x, y, salt % 17) * 0.72 + field(x, y, (salt % 23) + 7) * 0.28, 0, 1),
    moisture: clamp(field(x, y, (salt % 29) + 11) * 0.65 + field(x, y, (salt % 31) + 3) * 0.35, 0, 1),
    temperature: clamp(0.58 - Math.abs(y - 0.52) * 0.7 + (field(x, y, (salt % 13) + 19) - 0.5) * 0.5, 0, 1),
    water: clamp(field(x, y, (salt % 37) + 5) * 0.75 + field(x, y, (salt % 41) + 17) * 0.25, 0, 1),
  };
}

function chooseTerrain(
  kind: PlaneKind,
  variant: PlaneVariant | undefined,
  climate: ReturnType<typeof climateAt>,
  rng: SeededRandom,
  settings: GenerationSettings,
  x: number,
  y: number,
): { terrain: TerrainKey; biome: BiomeKey } {
  const activeVariant = variant ?? ARCHETYPE_PROFILES[kind].defaultVariant;
  const cohesion = settings.biomeCohesion / 100;
  const local = (field(x, y, 53) - 0.5) * (1 - cohesion) * 0.8;
  const moistureShift = activeVariant === "wild" || activeVariant === "fungal" || activeVariant === "oceanic" ? 0.18
    : activeVariant === "arid" || activeVariant === "volcanic" || activeVariant === "infernal" ? -0.2 : 0;
  const temperatureShift = activeVariant === "frozen" ? -0.42
    : activeVariant === "volcanic" || activeVariant === "infernal" ? 0.32 : 0;
  const moisture = clamp(climate.moisture + moistureShift, 0, 1);
  const temperature = clamp(climate.temperature + temperatureShift, 0, 1);

  if (ARCHETYPE_PROFILES[kind].caveFamily) {
    const wallThreshold = kind === "abyss" || activeVariant === "void" ? 0.1 : kind === "cave" ? 0.055 : 0.025;
    if (climate.water < wallThreshold) return { terrain: "cavewall", biome: kind === "abyss" ? "void_reaches" : "ashen_deeps" };
    if (kind === "hell" || activeVariant === "infernal" || activeVariant === "volcanic") {
      if (temperature + local > 0.48) return { terrain: "cavewaste", biome: "ashen_deeps" };
      if (climate.elevation + local > 0.58) return { terrain: "cavehighland", biome: "ashen_deeps" };
    }
    if (activeVariant === "crystal" && climate.elevation + local > 0.46) return { terrain: "cavehighland", biome: "crystal_deeps" };
    if (moisture + local > (kind === "cavern" ? 0.6 : 0.69)) return { terrain: "caveforest", biome: "living_caves" };
    if (moisture + local > 0.55 && climate.elevation < 0.48) return { terrain: "caveswamp", biome: "living_caves" };
    if (temperature + local > 0.72) return { terrain: "cavewaste", biome: "ashen_deeps" };
    if (climate.elevation + local > 0.67) return { terrain: "cavehighland", biome: "crystal_deeps" };
    const biome: BiomeKey = kind === "abyss" ? "void_reaches" : activeVariant === "fungal" ? "living_caves" : "crystal_deeps";
    return { terrain: "cave", biome };
  }

  if (kind === "cloud" || kind === "air") {
    if (activeVariant === "frozen" && temperature < 0.34) return { terrain: "highland", biome: "tundra" };
    if (climate.elevation + local > (kind === "air" ? 0.54 : 0.65)) return { terrain: rng.chance(0.2) ? "mountains" : "highland", biome: "high_country" };
    if (moisture + local > 0.69) return { terrain: "forest", biome: activeVariant === "storm" ? "void_reaches" : "wildwood" };
    return { terrain: "plains", biome: activeVariant === "storm" ? "void_reaches" : "high_country" };
  }

  if (kind === "dream") {
    if (moisture > 0.68) return { terrain: "forest", biome: "void_reaches" };
    if (climate.elevation > 0.66) return { terrain: "highland", biome: "void_reaches" };
    return { terrain: "plains", biome: "void_reaches" };
  }

  if (kind === "elemental") {
    const element = field(x, y, 97) + local;
    if (element < 0.25) return { terrain: "swamp", biome: "marshlands" };
    if (element < 0.47) return { terrain: "highland", biome: "high_country" };
    if (element > 0.76) return { terrain: "waste", biome: "sunscorched" };
    return { terrain: moisture > 0.56 ? "forest" : "plains", biome: moisture > 0.56 ? "wildwood" : "heartland" };
  }

  if (temperature < 0.2) {
    return climate.elevation > 0.59
      ? { terrain: "highland", biome: "tundra" }
      : { terrain: rng.chance(0.44) ? "forest" : "plains", biome: "tundra" };
  }
  if (climate.elevation + local > 0.73) return { terrain: rng.chance(0.22) ? "mountains" : "highland", biome: "high_country" };
  if (moisture + local > 0.74 && climate.elevation < 0.5) return { terrain: "swamp", biome: "marshlands" };
  if (moisture + local > 0.61) return { terrain: "forest", biome: "wildwood" };
  if (temperature + local > 0.72 && moisture < 0.44) return { terrain: "waste", biome: "sunscorched" };
  if (moisture > 0.43 && climate.elevation < 0.52 && rng.chance(0.42)) return { terrain: "farm", biome: "heartland" };
  return { terrain: "plains", biome: "heartland" };
}

function enforceWaterQuota(provinces: Province[], kind: PlaneKind, variant: PlaneVariant | undefined, percent: number, seed: string) {
  if (!ARCHETYPE_PROFILES[kind].waterCapable) return;
  if (variant === "oceanic") percent = Math.max(percent, 42);
  const target = Math.round((provinces.length * clamp(percent, 0, 60)) / 100);
  if (!target) return;
  const salt = hashString(`${seed}:water`);
  const ranked = [...provinces].sort((a, b) => {
    const scoreA = field(a.x, a.y, (salt % 43) + 3) + field(a.x, a.y, (salt % 31) + 11) * 0.28;
    const scoreB = field(b.x, b.y, (salt % 43) + 3) + field(b.x, b.y, (salt % 31) + 11) * 0.28;
    return scoreA - scoreB || a.index - b.index;
  });
  const water = new Set(ranked.slice(0, target).map((province) => province.id));
  for (const province of provinces) {
    if (!water.has(province.id)) continue;
    const depth = field(province.x, province.y, (salt % 17) + 29);
    const kelp = field(province.x, province.y, (salt % 19) + 47);
    province.terrain = depth < 0.23 ? "deepsea" : kelp > 0.69 ? "kelp" : "sea";
    province.biome = province.terrain === "deepsea" ? "deep_ocean" : "archipelago";
    province.population = Math.round(TERRAIN_POPULATION[province.terrain] * ARCHETYPE_PROFILES[kind].populationScale * (0.86 + field(province.x, province.y, 73) * 0.28));
    province.siteBias = siteBiasFor(province.terrain, climateAt(province.x, province.y, salt));
  }
}

function enforceTerrainVariety(provinces: Province[], kind: PlaneKind, variant: PlaneVariant | undefined, seed: string) {
  const surface: TerrainKey[] = ["plains", "forest", "farm", "swamp", "waste", "highland"];
  const caves: TerrainKey[] = ["cave", "caveforest", "caveswamp", "cavewaste", "cavehighland"];
  const air: TerrainKey[] = ["plains", "forest", "highland", "mountains"];
  const wanted = ARCHETYPE_PROFILES[kind].caveFamily ? caves : kind === "cloud" || kind === "air" ? air : surface;
  if (variant === "oceanic") wanted.splice(0, wanted.length, "plains", "forest", "swamp", "highland");
  const minimum = provinces.length >= 72 ? 2 : 1;
  const rng = new SeededRandom(`${seed}:variety`);
  for (const terrain of wanted) {
    while (provinces.filter((province) => province.terrain === terrain).length < minimum) {
      const counts = new Map<TerrainKey, number>();
      for (const province of provinces) counts.set(province.terrain, (counts.get(province.terrain) ?? 0) + 1);
      const eligible = provinces.filter((province) => {
        if (isWaterProvince(province) || isBlockedProvince(province)) return false;
        return wanted.includes(province.terrain) && province.terrain !== terrain;
      });
      const candidates = eligible.filter((province) => (counts.get(province.terrain) ?? 0) > minimum);
      if (!candidates.length && eligible.length) candidates.push(...eligible);
      if (!candidates.length) break;
      const province = candidates[rng.int(0, candidates.length - 1)]!;
      province.terrain = terrain;
      province.biome = biomeForTerrain(terrain);
      province.population = Math.round(TERRAIN_POPULATION[terrain] * ARCHETYPE_PROFILES[kind].populationScale);
      province.siteBias = siteBiasFor(terrain, climateAt(province.x, province.y, hashString(seed)));
    }
  }
}

function assignArchetypeDetails(provinces: Province[], kind: PlaneKind, seed: string) {
  const profile = ARCHETYPE_PROFILES[kind];
  for (const province of provinces) {
    if (isBlockedProvince(province) || province.population === undefined) {
      province.poptype = undefined;
      province.defenders = [];
      continue;
    }
    const rng = new SeededRandom(`${seed}:details:${province.id}`);
    const poptypes = poptypesForProvince(province, profile);
    province.poptype = rng.pick(poptypes);
    province.siteBias = mergePaths(province.siteBias, profile.sitePaths, 3);
    if (province.freshwater && !province.siteBias.includes("water")) {
      province.siteBias = [...province.siteBias.slice(0, 2), "water"];
    }
    const guardianChance = 0.045 + profile.manySitesChance * 0.28;
    province.defenders = rng.chance(guardianChance)
      ? [guardianFor(kind, province, rng, `${seed}:${province.id}`)]
      : [];
  }
}

function poptypesForProvince(province: Province, profile: ArchetypeProfile): number[] {
  if (isWaterProvince(province)) return [31, 45, 63, 64, 65, 72, 73, 90, 91, 92, 95, 97, 105];
  return profile.poptypes;
}

function guardianFor(kind: PlaneKind, province: Province, rng: SeededRandom, seed: string): Province["defenders"][number] {
  let templates: ReadonlyArray<{ commander: string; units: readonly string[] }> = [
    { commander: "34", units: ["18", "17", "28"] }, // Commander; militia, archer, light infantry
  ];
  if (isWaterProvince(province)) {
    templates = [{ commander: "1067", units: ["1046"] }]; // Merman Captain; Merman
  } else if (ARCHETYPE_PROFILES[kind].caveFamily) {
    templates = kind === "hell"
      ? [{ commander: "87", units: ["303", "304", "632"] }] // Demonbred; imp, devil, storm demon
      : kind === "abyss"
        ? [{ commander: "2844", units: ["676", "753", "3624"] }] // Spectral Commander; shade, void thing, phantasm
        : [{ commander: "2483", units: ["447", "1615", "1616"] }]; // Troglodyte Trainer; cave troops
  } else if (kind === "cloud" || kind === "air") {
    templates = [{ commander: "92", units: ["205", "239", "1278"] }]; // Cloud Mage; raptor, harpy, raptorian
  } else if (kind === "dream") {
    templates = [{ commander: "341", units: ["3624"] }]; // Illusionist; Phantasmal Warrior
  } else if (kind === "elemental") {
    templates = [
      { commander: "98", units: ["3719"] },
      { commander: "92", units: ["3727"] },
      { commander: "103", units: ["3735"] },
      { commander: "1893", units: ["3743"] },
    ];
  }
  const template = rng.pick(templates);
  return {
    commander: template.commander,
    squads: [{
      id: idFor(seed, "guardian", 0),
      unit: rng.pick(template.units),
      count: rng.int(8, 18),
    }],
    experience: rng.chance(0.18) ? rng.int(1, 2) : undefined,
  };
}

function biomeForTerrain(terrain: TerrainKey): BiomeKey {
  if (terrain === "forest") return "wildwood";
  if (terrain === "swamp") return "marshlands";
  if (terrain === "waste") return "sunscorched";
  if (terrain === "highland" || terrain === "mountains") return "high_country";
  if (terrain === "sea" || terrain === "kelp") return "archipelago";
  if (terrain === "deepsea") return "deep_ocean";
  if (terrain === "caveforest" || terrain === "caveswamp") return "living_caves";
  if (terrain === "cavewaste") return "ashen_deeps";
  if (terrain.startsWith("cave")) return "crystal_deeps";
  return "heartland";
}

function siteBiasFor(terrain: TerrainKey, climate: ReturnType<typeof climateAt>): MagicPath[] {
  if (terrain === "forest" || terrain === "caveforest") return ["nature"];
  if (terrain === "swamp" || terrain === "caveswamp") return ["water", "death"];
  if (terrain === "waste" || terrain === "cavewaste") return climate.temperature > 0.55 ? ["fire", "death"] : ["death"];
  if (terrain === "highland" || terrain === "mountains" || terrain === "cavehighland") return ["earth", "air"];
  if (isWaterTerrain(terrain)) return ["water"];
  if (terrain.startsWith("cave")) return ["earth", "glamour"];
  if (terrain === "farm") return ["nature", "holy"];
  return climate.temperature > 0.72 ? ["fire"] : climate.temperature < 0.24 ? ["water"] : [];
}

function makeProvinceName(biome: BiomeKey, index: number, rng: SeededRandom): string {
  const [prefixes, suffixes] = NAME_PARTS[biome];
  const prefix = rng.pick(prefixes);
  const suffix = rng.pick(suffixes);
  const base = `${prefix}${suffix}`;
  return index % 17 === 0 ? `The ${prefix} ${capitalize(suffix)}` : base;
}

function buildEdges(provinces: Province[], plane: Plane, seed: string): Edge[] {
  return synchronizePlaneEdges({ ...plane, provinces, edges: [] }, seed, false).edges;
}

/**
 * Reconciles Dominions neighbour commands with the province ownership geometry.
 * Valid existing edge kinds are preserved so a repair does not erase authored
 * rivers, roads, passes, or impassable borders.
 */
export function synchronizePlaneEdges(plane: Plane, seed: string, preserveExisting = true): Plane {
  const topology = computeProvinceTopology(plane);
  const existing = new Map<string, Edge>();
  if (preserveExisting) {
    for (const edge of plane.edges) {
      const key = connectionKey(edge.a, edge.b);
      if (!existing.has(key)) existing.set(key, edge);
    }
  }
  const provinceById = new Map(plane.provinces.map((province) => [province.id, province]));
  const rng = new SeededRandom(`${seed}:borders`);
  const edges = topology.pairs.map((pair, index) => {
    const current = existing.get(pair.key);
    if (current) return { ...current, a: pair.a, b: pair.b };
    const a = provinceById.get(pair.a)!;
    const b = provinceById.get(pair.b)!;
    return {
      id: idFor(seed, "edge", index),
      a: pair.a,
      b: pair.b,
      kind: borderKind(a, b, rng),
    } satisfies Edge;
  });
  return { ...plane, edges };
}

function borderKind(a: Province, b: Province, rng: SeededRandom): EdgeKind {
  if (isBlockedProvince(a) || isBlockedProvince(b)) return "impassable";
  const flagsA = effectiveProvinceTerrainFlags(a);
  const flagsB = effectiveProvinceTerrainFlags(b);
  const rugged = flagsA.has("highland") || flagsA.has("mountains") || flagsB.has("highland") || flagsB.has("mountains");
  if (rugged && rng.chance(0.28)) return rng.chance(0.62) ? "mountain_pass" : "mountain_border";
  const wet = flagsA.has("freshwater") || flagsB.has("freshwater") || flagsA.has("swamp") || flagsB.has("swamp");
  if (wet && rng.chance(0.23)) return rng.chance(0.2) ? "bridge" : "river";
  if (!isWaterProvince(a) && !isWaterProvince(b) && rng.chance(0.055)) return "road";
  return "standard";
}

function placeStarts(plane: Plane, count: number, seed: string, degreeTarget: number, startType: StartType) {
  const starts: Province[] = [];
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const candidates = plane.provinces.filter((province) => isEligibleStartProvince(province));
  while (starts.length < Math.min(count, candidates.length)) {
    const next = chooseStartCandidate(plane, candidates, starts, adjacency, degreeTarget, `${seed}:${startType}:${starts.length}`);
    if (!next) break;
    starts.push(next);
  }
  for (const province of starts) markStart(province, startType);
}

interface ProvinceRef {
  plane: Plane;
  planeIndex: number;
  province: Province;
}

function placeDistributedStarts(project: MapProject) {
  const requested = normalizeStartDistribution(project.settings.startDistribution, project.settings.players);
  project.settings.startDistribution = requested;
  for (const plane of project.planes) {
    for (const province of plane.provinces) {
      province.start = false;
      province.startType = undefined;
      if (province.throne === "avoid") province.throne = "none";
    }
  }

  const adjacency = new Map(project.planes.map((plane) => [plane.id, adjacencyFor(plane, { traversableOnly: true })]));
  const placementOrder: StartType[] = ["water", "coastal", "cave", "other", "land"];
  const degreeTarget = project.settings.startDegreeTarget ?? 4;
  const candidateDegrees = [...new Set(project.planes.flatMap((plane) => plane.provinces
    .filter((province) => isEligibleStartProvince(province))
    .map((province) => adjacency.get(plane.id)?.get(province.id)?.length ?? 0)
    .filter((degree) => degree >= degreeTarget)))]
    .sort((a, b) => Math.abs(a - degreeTarget) - Math.abs(b - degreeTarget) || a - b);

  // Try a single exact degree across every requested category first. A
  // degree-four water province should not lock the atlas to four if a
  // degree-five assignment is the only way for all categories to match.
  let selected: ProvinceRef[] = [];
  for (const degree of candidateDegrees) {
    const attempt: ProvinceRef[] = [];
    for (const type of placementOrder) {
      for (let slot = 0; slot < requested[type]; slot += 1) {
        const candidate = chooseDistributedStart(
          project,
          type,
          attempt,
          adjacency,
          `${project.seed}:distributed:degree-${degree}:${type}:${slot}`,
          degree,
        );
        if (!candidate) break;
        attempt.push(candidate);
      }
    }
    if (attempt.length === project.settings.players) {
      selected = attempt;
      break;
    }
  }

  // If the requested biome split cannot share one degree, retain the former
  // deterministic best-fit behavior instead of dropping a capital.
  if (!selected.length) {
    for (const type of placementOrder) {
      for (let slot = 0; slot < requested[type]; slot += 1) {
        const candidate = chooseDistributedStart(project, type, selected, adjacency, `${project.seed}:distributed:${type}:${slot}`);
        if (!candidate) break;
        selected.push(candidate);
      }
    }
  }

  // A malformed or physically infeasible split must not silently reduce the
  // total number of capitals. Fill remaining slots from safe provinces and
  // record their real category so startAllocation exposes the shortfall.
  while (selected.length < project.settings.players) {
    const candidate = chooseDistributedStart(project, undefined, selected, adjacency, `${project.seed}:distributed:fallback:${selected.length}`);
    if (!candidate) break;
    selected.push(candidate);
  }
  for (const candidate of selected) {
    const actualType = classifyStartType(candidate, adjacency.get(candidate.plane.id)!);
    markStart(candidate.province, actualType);
  }
  for (const plane of project.planes) {
    repairStartBorders(plane);
    clearStartZoneGuardians(plane, project.specificStarts.filter((start) => start.planeId === plane.id).map((start) => start.provinceId));
  }
}

function clearStartZoneGuardians(plane: Plane, extraStartIds: string[] = []) {
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const protectedProvinceIds = new Set<string>();
  const startIds = new Set(plane.provinces.filter((province) => province.start || province.teamStart !== undefined).map((province) => province.id));
  for (const id of extraStartIds) if (adjacency.has(id)) startIds.add(id);
  const startDistanceMaps: Map<string, number>[] = [];
  for (const startId of startIds) {
    const distances = shortestDistances(adjacency, startId);
    startDistanceMaps.push(distances);
    for (const province of plane.provinces) if ((distances.get(province.id) ?? 99) <= 2) protectedProvinceIds.add(province.id);
  }
  for (const province of plane.provinces) if (protectedProvinceIds.has(province.id)) province.defenders = [];
  if (!plane.provinces.some((province) => province.defenders.length > 0)) {
    const candidates = plane.provinces.filter((province) => !protectedProvinceIds.has(province.id)
      && !isBlockedProvince(province)
      && !province.start);
    const distance = (item: Province) => startDistanceMaps.length
      ? Math.min(...startDistanceMaps.map((distances) => distances.get(item.id) ?? 0))
      : 99;
    const province = candidates.sort((a, b) => {
      return distance(b) - distance(a) || a.index - b.index;
    })[0];
    if (province) {
      const rng = new SeededRandom(`${plane.id}:guardian-fallback:${province.id}`);
      province.defenders = [guardianFor(plane.kind, province, rng, `${plane.id}:${province.id}:fallback`)];
    }
  }
}

function chooseDistributedStart(
  project: MapProject,
  requestedType: StartType | undefined,
  selected: ProvinceRef[],
  adjacencyByPlane: Map<string, Map<string, string[]>>,
  seed: string,
  forcedDegree?: number,
): ProvinceRef | undefined {
  const target = project.settings.startDegreeTarget ?? 4;
  const selectedDegrees = selected.map((item) => adjacencyByPlane.get(item.plane.id)?.get(item.province.id)?.length ?? 0);
  const preferredDegree = forcedDegree ?? (selectedDegrees.length ? modalInteger(selectedDegrees) : undefined);
  const selectedKeys = new Set(selected.map((item) => globalProvinceKey(item.plane.id, item.province.id)));
  const startsByPlane = new Map(project.planes.map((plane) => [plane.id, selected.filter((item) => item.plane.id === plane.id).map((item) => item.province)]));
  const distanceMaps = new Map(project.planes.map((plane) => {
    const adjacency = adjacencyByPlane.get(plane.id)!;
    return [plane.id, (startsByPlane.get(plane.id) ?? []).map((start) => shortestDistances(adjacency, start.id))];
  }));
  const candidateFacts = (plane: Plane, planeIndex: number, province: Province) => {
    const adjacency = adjacencyByPlane.get(plane.id)!;
    const ref = { plane, planeIndex, province };
    if (!isEligibleStartProvince(province)
      || selectedKeys.has(globalProvinceKey(plane.id, province.id))
      || (requestedType && !matchesStartType(ref, requestedType, adjacency))) return undefined;
    const planeStarts = startsByPlane.get(plane.id) ?? [];
    const maps = distanceMaps.get(plane.id) ?? [];
    const distance = maps.length
      ? Math.min(...maps.map((distances) => distances.get(province.id) ?? 0))
      : 6;
    return { ref, adjacency, planeStarts, distance, degree: adjacency.get(province.id)?.length ?? 0 };
  };
  const hasSafePreferredDegree = preferredDegree !== undefined && project.planes.some((plane, planeIndex) => plane.provinces.some((province) => {
    const facts = candidateFacts(plane, planeIndex, province);
    return facts?.degree === preferredDegree && facts.distance >= 3;
  }));
  let best: ProvinceRef | undefined;
  let bestScore = -Infinity;
  for (let planeIndex = 0; planeIndex < project.planes.length; planeIndex += 1) {
    const plane = project.planes[planeIndex]!;
    for (const province of plane.provinces) {
      const facts = candidateFacts(plane, planeIndex, province);
      if (!facts) continue;
      const { ref, planeStarts, distance, degree } = facts;
      if (forcedDegree !== undefined && degree !== forcedDegree) continue;
      if (hasSafePreferredDegree && (degree !== preferredDegree || distance < 3)) continue;
      const load = planeStarts.length / Math.max(1, plane.provinces.length);
      const blockingEdges = plane.edges.filter((edge) => (edge.a === province.id || edge.b === province.id) && blocksReliableStartEdge(edge)).length;
      const targetScore = degree >= target ? 36 - Math.abs(degree - target) * 4 : -80 - (target - degree) * 25;
      const parityScore = preferredDegree === undefined ? 0 : degree === preferredDegree ? 64 : -Math.abs(degree - preferredDegree) * 24;
      const flags = effectiveProvinceTerrainFlags(province);
      const terrainBonus = flags.has("farm") ? 4 : flags.has("cave") || flags.size === 0 ? 2 : 0;
      const score = distance * 28 + targetScore + parityScore + terrainBonus - load * 520 - blockingEdges * 120
        + (hashString(`${seed}:${plane.id}:${province.id}`) % 1000) / 10000;
      if (score > bestScore || (score === bestScore && (planeIndex < (best?.planeIndex ?? Infinity)
        || (planeIndex === best?.planeIndex && province.index < (best?.province.index ?? Infinity))))) {
        best = ref;
        bestScore = score;
      }
    }
  }
  return best;
}

function chooseStartCandidate(
  plane: Plane,
  candidates: Province[],
  starts: Province[],
  adjacency: Map<string, string[]>,
  degreeTarget: number,
  seed: string,
): Province | undefined {
  let best: Province | undefined;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (starts.some((start) => start.id === candidate.id)) continue;
    const degree = adjacency.get(candidate.id)?.length ?? 0;
    const distances = shortestDistances(adjacency, candidate.id);
    const separation = starts.length ? Math.min(...starts.map((start) => distances.get(start.id) ?? 0)) : 6;
    const blocking = plane.edges.filter((edge) => (edge.a === candidate.id || edge.b === candidate.id) && blocksReliableStartEdge(edge)).length;
    const score = separation * 28 + (degree >= degreeTarget ? 36 - Math.abs(degree - degreeTarget) * 4 : -80 - (degreeTarget - degree) * 25)
      - blocking * 120 + (hashString(`${seed}:${candidate.id}`) % 1000) / 10000;
    if (score > bestScore || (score === bestScore && candidate.index < (best?.index ?? Infinity))) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function matchesStartType(ref: ProvinceRef, type: StartType, adjacency: Map<string, string[]>): boolean {
  const { plane, planeIndex, province } = ref;
  if (type === "water") return isWaterProvince(province);
  if (type === "coastal") {
    if (isWaterProvince(province) || ARCHETYPE_PROFILES[plane.kind].caveFamily) return false;
    const byId = new Map(plane.provinces.map((item) => [item.id, item]));
    return (adjacency.get(province.id) ?? []).some((id) => {
      const neighbour = byId.get(id);
      return neighbour ? isWaterProvince(neighbour) : false;
    });
  }
  if (type === "cave") return ARCHETYPE_PROFILES[plane.kind].caveFamily || isCaveProvince(province);
  if (type === "other") return planeIndex > 0 && !ARCHETYPE_PROFILES[plane.kind].caveFamily && !isWaterProvince(province);
  if ((planeIndex !== 0 && plane.kind !== "surface") || isWaterProvince(province) || isCaveProvince(province)) return false;
  const byId = new Map(plane.provinces.map((item) => [item.id, item]));
  return !(adjacency.get(province.id) ?? []).some((id) => {
    const neighbour = byId.get(id);
    return neighbour ? isWaterProvince(neighbour) : false;
  });
}

function classifyStartType(ref: ProvinceRef, adjacency: Map<string, string[]>): StartType {
  for (const type of ["water", "coastal", "cave", "other", "land"] as StartType[]) {
    if (matchesStartType(ref, type, adjacency)) return type;
  }
  return "other";
}

function isEligibleStartProvince(province: Province): boolean {
  return !province.start && !province.noStart && !isBlockedProvince(province);
}

function markStart(province: Province, type: StartType) {
  province.start = true;
  province.startType = type;
  province.noStart = false;
  province.throne = "avoid";
  province.manySites = false;
  province.defenders = [];
}

function repairStartBorders(plane: Plane) {
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  for (const edge of plane.edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b || (!a.start && !b.start) || !blocksReliableStartEdge(edge)) continue;
    const blockedNeighbour = a.start ? b : a;
    if (isBlockedProvince(blockedNeighbour)) {
      blockedNeighbour.terrain = ARCHETYPE_PROFILES[plane.kind].caveFamily ? "cave" : "highland";
      blockedNeighbour.terrainFlags = blockedNeighbour.terrainFlags?.filter((flag) => flag !== "cavewall");
      blockedNeighbour.biome = biomeForTerrain(blockedNeighbour.terrain);
      blockedNeighbour.noStart = false;
      blockedNeighbour.population = Math.round(TERRAIN_POPULATION[blockedNeighbour.terrain] * ARCHETYPE_PROFILES[plane.kind].populationScale);
      assignArchetypeDetails([blockedNeighbour], plane.kind, `${plane.id}:start-repair`);
    }
    edge.kind = "standard";
    edge.special = undefined;
  }
}

function blocksReliableStartEdge(edge: Edge): boolean {
  if (edge.kind === "mountain_pass" || edge.kind === "river" || edge.kind === "impassable") return true;
  return edge.kind === "custom" && ((edge.special ?? 0) & 0b111) !== 0;
}

function distributeThrones(project: MapProject) {
  const requested = Math.min(
    project.settings.throneCount,
    project.planes.reduce((sum, plane) => sum + plane.provinces.filter((province) => !province.start && !isBlockedProvince(province)).length, 0),
  );
  if (requested <= 0) return;
  const weights = project.planes.map((plane) => Math.max(1, plane.provinces.length + plane.provinces.filter((province) => province.start).length * 12));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => requested * weight / weightTotal);
  const counts = raw.map(Math.floor);
  let remaining = requested - counts.reduce((sum, count) => sum + count, 0);
  const remainderOrder = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; remaining > 0; index = (index + 1) % remainderOrder.length) {
    counts[remainderOrder[index]!.index]! += 1;
    remaining -= 1;
  }
  project.planes.forEach((plane, index) => {
    const protectedIds = new Set(plane.provinces.filter((province) => province.start || province.teamStart !== undefined).map((province) => province.id));
    for (const start of project.specificStarts.filter((item) => item.planeId === plane.id)) protectedIds.add(start.provinceId);
    placeThrones(plane, counts[index] ?? 0, `${project.seed}:thrones:${index}`, protectedIds);
  });
}

function placeThrones(plane: Plane, count: number, seed: string, protectedStartIds?: Set<string>) {
  if (count <= 0) return;
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const protectedIds = protectedStartIds ?? new Set(plane.provinces.filter((province) => province.start || province.teamStart !== undefined).map((province) => province.id));
  const starts = plane.provinces.filter((province) => protectedIds.has(province.id));
  const candidates = plane.provinces.filter((province) => !protectedIds.has(province.id) && !isBlockedProvince(province));
  const chosen: Province[] = [];
  const distanceCache = new Map<string, Map<string, number>>();
  const distancesFrom = (provinceId: string) => {
    let distances = distanceCache.get(provinceId);
    if (!distances) {
      distances = shortestDistances(adjacency, provinceId);
      distanceCache.set(provinceId, distances);
    }
    return distances;
  };
  const targetThroneDistance = [3, 2].find((target) => starts.every((start) => candidates.some((candidate) =>
    distancesFrom(start.id).get(candidate.id) === target
    && starts.every((other) => (distancesFrom(other.id).get(candidate.id) ?? 99) >= target),
  ))) ?? 2;

  // Give every player an equally distant contested slot before adding extras.
  // This sharply reduces nearest-throne variance without making the map symmetric.
  for (const start of [...starts].sort((a, b) => a.index - b.index)) {
    if (chosen.length >= count) break;
    const fromStart = distancesFrom(start.id);
    let best: Province | undefined;
    for (const strict of [true, false]) {
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        if (chosen.some((item) => item.id === candidate.id)) continue;
        const startDistance = fromStart.get(candidate.id) ?? 99;
        if (startDistance < 2 || startDistance > 4) continue;
        const nearestOtherStart = starts
          .filter((item) => item.id !== start.id)
          .map((item) => distancesFrom(item.id).get(candidate.id) ?? 99)
          .reduce((minimum, value) => Math.min(minimum, value), 99);
        if (strict && (startDistance !== targetThroneDistance || nearestOtherStart < targetThroneDistance)) continue;
        const chosenDistance = chosen.length
          ? Math.min(...chosen.map((item) => distancesFrom(item.id).get(candidate.id) ?? 99))
          : 4;
        const score = -Math.abs(startDistance - targetThroneDistance) * 8 + Math.min(nearestOtherStart, 5) + Math.min(chosenDistance, 4) * 0.8
          + (hashString(`${seed}:throne-ring:${start.id}:${candidate.id}`) % 100) / 1000;
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      if (best) break;
    }
    if (best) {
      best.throne = "preferred";
      best.manySites = true;
      chosen.push(best);
    }
  }

  while (chosen.length < Math.min(count, candidates.length)) {
    let best: Province | undefined;
    let bestScore = -Infinity;
    const hasSafeAlternative = candidates.some((item) => !chosen.some((chosenItem) => chosenItem.id === item.id)
      && starts.every((start) => (distancesFrom(start.id).get(item.id) ?? 99) >= targetThroneDistance));
    for (const candidate of candidates) {
      if (chosen.some((item) => item.id === candidate.id)) continue;
      const distances = distancesFrom(candidate.id);
      const startDistance = starts.length ? Math.min(...starts.map((start) => distances.get(start.id) ?? 0)) : 3;
      if (hasSafeAlternative && startDistance < targetThroneDistance) continue;
      const throneDistance = chosen.length ? Math.min(...chosen.map((item) => distances.get(item.id) ?? 0)) : 4;
      const contested = starts.length > 1
        ? standardDeviation(starts.map((start) => distances.get(start.id) ?? 99))
        : 0;
      const terrainFlags = effectiveProvinceTerrainFlags(candidate);
      const terrainInterest = terrainFlags.size === 0 || (terrainFlags.size === 1 && terrainFlags.has("farm")) ? 0 : 0.75;
      const score = Math.min(startDistance, 6) * 2 + Math.min(throneDistance, 5) * 1.5 - contested * 0.45 + terrainInterest + (hashString(`${seed}:${candidate.id}`) % 100) / 1000;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) break;
    best.throne = "preferred";
    best.manySites = true;
    chosen.push(best);
  }
}

function balanceStartRegions(plane: Plane) {
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const starts = plane.provinces.filter((province) => province.start).sort((a, b) => a.index - b.index);
  if (starts.length < 2) return;
  const rings = starts.map((start) => {
    const distances = shortestDistances(adjacency, start.id);
    return plane.provinces.filter((province) => (distances.get(province.id) ?? 99) <= 2);
  });
  const value = (ring: Province[]) => ring.reduce(
    (sum, province) => sum + (province.population ?? 0) / 1000 + (effectiveProvinceTerrainFlags(province).has("farm") ? 2 : 0),
    0,
  );
  const membership = new Map<string, number>();
  for (const ring of rings) for (const province of ring) membership.set(province.id, (membership.get(province.id) ?? 0) + 1);

  // Scale only exclusive two-ring provinces, preserving terrain and biome while
  // bringing each player's early economy within a tight, reproducible band.
  for (let pass = 0; pass < 5; pass += 1) {
    const values = rings.map(value);
    const target = mean(values);
    rings.forEach((ring, index) => {
      const factor = clamp(target / Math.max(1, values[index]!), 0.72, 1.38);
      for (const province of ring) {
        if ((membership.get(province.id) ?? 0) !== 1 || province.population === undefined) continue;
        province.population = clamp(Math.round((province.population * factor) / 10) * 10, 100, 30000);
      }
    });
    const correctedValues = rings.map(value);
    starts.forEach((start, index) => {
      const deltaPopulation = Math.round((target - correctedValues[index]!) * 1000 / 10) * 10;
      const current = start.population ?? 8000;
      start.population = clamp(current + deltaPopulation, 4000, 30000);
    });
  }
}

function balanceGlobalStartRegions(project: MapProject) {
  const rings: Array<{ start: Province; provinces: Province[]; planeId: string }> = [];
  for (const plane of project.planes) {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    for (const start of plane.provinces.filter((province) => province.start)) {
      const distances = shortestDistances(adjacency, start.id);
      rings.push({
        start,
        planeId: plane.id,
        provinces: plane.provinces.filter((province) => (distances.get(province.id) ?? 99) <= 2),
      });
    }
  }
  if (rings.length < 2) return;
  const membership = new Map<string, number>();
  for (const ring of rings) {
    for (const province of ring.provinces) {
      const key = globalProvinceKey(ring.planeId, province.id);
      membership.set(key, (membership.get(key) ?? 0) + 1);
    }
  }
  const value = (provinces: Province[]) => provinces.reduce(
    (sum, province) => sum + (province.population ?? 0) / 1000 + (effectiveProvinceTerrainFlags(province).has("farm") ? 2 : 0),
    0,
  );
  for (let pass = 0; pass < 6; pass += 1) {
    const values = rings.map((ring) => value(ring.provinces));
    const target = mean(values);
    rings.forEach((ring, index) => {
      const factor = clamp(target / Math.max(1, values[index]!), 0.72, 1.38);
      for (const province of ring.provinces) {
        if ((membership.get(globalProvinceKey(ring.planeId, province.id)) ?? 0) !== 1 || province.population === undefined) continue;
        province.population = clamp(Math.round(province.population * factor / 10) * 10, 100, 50000);
      }
    });
    const corrected = rings.map((ring) => value(ring.provinces));
    rings.forEach((ring, index) => {
      const delta = Math.round((target - corrected[index]!) * 1000 / 10) * 10;
      ring.start.population = clamp((ring.start.population ?? 8000) + delta, 1000, 50000);
    });
  }
}

function markProvinceSizes(plane: Plane) {
  const adjacency = adjacencyFor(plane);
  const sorted = [...plane.provinces].sort((a, b) => (adjacency.get(a.id)?.length ?? 0) - (adjacency.get(b.id)?.length ?? 0));
  const smallCount = Math.floor(sorted.length * 0.06);
  const largeCount = Math.floor(sorted.length * 0.06);
  for (const province of sorted.slice(0, smallCount)) province.small = true;
  for (const province of sorted.slice(-largeCount)) province.large = true;
}

export function generateGates(project: MapProject): GateLink[] {
  if (project.planes.length < 2) return [];
  const gates: GateLink[] = [];
  let gateNumber = 1;
  const used = new Set<string>();
  const direction = normalizeGateDirection(project.settings.gateDirection);
  const layout = normalizeGateLayout(project.settings.gateLayout);
  const byPlaneId = new Map(project.planes.map((plane, index) => [plane.id, index]));
  const connections: Array<{ sourceIndex: number; targetIndex: number; pairs?: number }> = project.settings.planeConnections !== undefined
    ? normalizePlaneConnections(project.settings.planeConnections, project.planes)
      .filter((rule) => rule.enabled !== false)
      .map((rule) => ({ sourceIndex: byPlaneId.get(rule.a)!, targetIndex: byPlaneId.get(rule.b)!, pairs: rule.pairs }))
    : gateConnections(project.planes, layout).map(([sourceIndex, targetIndex]) => ({ sourceIndex, targetIndex }));
  const protectedStarts = new Map(project.planes.map((plane) => [plane.id, new Set(plane.provinces.filter((province) => province.start
    || province.teamStart !== undefined
    || project.specificStarts.some((start) => start.planeId === plane.id && start.provinceId === province.id)).map((province) => province.id))]));
  const startNeighbours = new Map(project.planes.map((plane) => {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const ids = new Set<string>();
    for (const startId of protectedStarts.get(plane.id) ?? []) {
      ids.add(startId);
      for (const id of adjacency.get(startId) ?? []) ids.add(id);
    }
    return [plane.id, ids];
  }));
  const eligible = (plane: Plane, avoidStartRing: boolean) => plane.provinces.filter((province) => !protectedStarts.get(plane.id)?.has(province.id)
    && province.throne === "none"
    && !isBlockedProvince(province)
    && !used.has(`${plane.id}:${province.id}`)
    && (!avoidStartRing || !startNeighbours.get(plane.id)?.has(province.id)));

  for (const connection of connections) {
    const { sourceIndex, targetIndex } = connection;
    const sourcePlane = project.planes[sourceIndex]!;
    const targetPlane = project.planes[targetIndex]!;
    const defaultPairs = Math.min(2, Math.floor(Math.min(sourcePlane.provinces.length, targetPlane.provinces.length) / 12) || 1);
    const pairs = connection.pairs ?? project.settings.gatePairsPerConnection ?? defaultPairs;
    for (let pair = 0; pair < pairs; pair += 1) {
      const ranked = (plane: Plane, otherPlane: Plane, salt: number) => {
        const safe = eligible(plane, true);
        const usedFallback = safe.length === 0;
        const candidates = usedFallback ? eligible(plane, false) : safe;
        const adjacency = adjacencyFor(plane, { traversableOnly: true });
        const startIds = [...(protectedStarts.get(plane.id) ?? [])];
        const distanceFromStarts = (province: Province) => startIds.length
          ? Math.min(...startIds.map((startId) => shortestDistances(adjacency, startId).get(province.id) ?? 0))
          : 99;
        candidates.sort((a, b) => {
          const distanceA = distanceFromStarts(a);
          const distanceB = distanceFromStarts(b);
          const scoreA = gateEndpointThemeScore(a, plane, otherPlane) * 3 + field(a.x, a.y, salt);
          const scoreB = gateEndpointThemeScore(b, plane, otherPlane) * 3 + field(b.x, b.y, salt);
          return (usedFallback ? distanceB - distanceA : 0) || scoreB - scoreA || a.index - b.index;
        });
        return { candidates, usedFallback };
      };
      const sourceRanked = ranked(sourcePlane, targetPlane, gateNumber + 19);
      const targetRanked = ranked(targetPlane, sourcePlane, gateNumber + 37);
      const source = sourceRanked.candidates[0];
      const destination = targetRanked.candidates[0];
      if (!source || !destination) break;
      used.add(`${sourcePlane.id}:${source.id}`);
      used.add(`${targetPlane.id}:${destination.id}`);
      gates.push({
        id: idFor(project.seed, "gate", gateNumber),
        gateNumber,
        direction,
        adjacentStartFallback: sourceRanked.usedFallback || targetRanked.usedFallback || undefined,
        endpoints: [
          { planeId: sourcePlane.id, provinceId: source.id },
          { planeId: targetPlane.id, provinceId: destination.id },
        ],
      });
      gateNumber += 1;
    }
  }
  return gates;
}

function gateEndpointThemeScore(province: Province, plane: Plane, otherPlane: Plane): number {
  const flags = effectiveProvinceTerrainFlags(province);
  const rugged = flags.has("highland") || flags.has("mountains");
  const cave = isCaveProvince(province) && !isBlockedProvince(province);
  const thisCave = ARCHETYPE_PROFILES[plane.kind].caveFamily;
  const otherCave = ARCHETYPE_PROFILES[otherPlane.kind].caveFamily;
  const thisAir = plane.kind === "cloud" || plane.kind === "air";
  const otherAir = otherPlane.kind === "cloud" || otherPlane.kind === "air";
  if (thisCave && (otherCave || otherPlane.kind === "surface" || otherPlane.kind === "custom")) return cave ? 3 : 0;
  if ((plane.kind === "surface" || plane.kind === "custom") && (otherCave || otherAir)) return rugged ? 3 : 0;
  if (thisAir && (otherPlane.kind === "surface" || otherPlane.kind === "custom")) return rugged ? 3 : 0;
  return rugged || cave ? 1 : 0;
}

export function createDefaultPlaneConnections(
  planes: Plane[],
  layout: GateLayout = "compatible",
  pairs = 1,
): PlaneConnectionRule[] {
  const active = new Set(gateConnections(planes, normalizeGateLayout(layout)).map(([a, b]) => connectionKey(planes[a]!.id, planes[b]!.id)));
  const rules: PlaneConnectionRule[] = [];
  for (let a = 0; a < planes.length; a += 1) {
    for (let b = a + 1; b < planes.length; b += 1) {
      rules.push({
        a: planes[a]!.id,
        b: planes[b]!.id,
        pairs: clamp(Math.round(pairs), 1, 3),
        enabled: active.has(connectionKey(planes[a]!.id, planes[b]!.id)),
      });
    }
  }
  return rules;
}

function gateConnections(planes: Plane[], layout: GateLayout): Array<[number, number]> {
  if (planes.length < 2) return [];
  if (layout === "hub") return planes.slice(1).map((_, index) => [0, index + 1]);
  if (layout === "chain") return planes.slice(1).map((_, index) => [index, index + 1]);
  if (layout === "ring") {
    const chain: Array<[number, number]> = planes.slice(1).map((_, index) => [index, index + 1]);
    if (planes.length > 2) chain.push([planes.length - 1, 0]);
    return chain;
  }

  // Prim's algorithm produces a deterministic maximum-compatibility spanning
  // tree: every plane is reachable without connecting every pair of layers.
  const connected = new Set<number>([0]);
  const result: Array<[number, number]> = [];
  while (connected.size < planes.length) {
    let best: { a: number; b: number; score: number } | undefined;
    for (const a of [...connected].sort((left, right) => left - right)) {
      for (let b = 0; b < planes.length; b += 1) {
        if (connected.has(b)) continue;
        const score = gateCompatibility(planes[a]!.kind, planes[b]!.kind);
        if (!best || score > best.score || (score === best.score && (a < best.a || (a === best.a && b < best.b)))) best = { a, b, score };
      }
    }
    if (!best) break;
    result.push([best.a, best.b]);
    connected.add(best.b);
  }
  return result;
}

export function gateCompatibility(a: PlaneKind, b: PlaneKind): number {
  if (a === b) return 100;
  const pair = new Set([a, b]);
  const has = (...kinds: PlaneKind[]) => kinds.every((kind) => pair.has(kind));
  if ((pair.has("surface") || pair.has("custom")) && [...pair].some((kind) => ["cave", "cavern", "underworld"].includes(kind))) return 94;
  if ((pair.has("surface") || pair.has("custom")) && (pair.has("cloud") || pair.has("air"))) return 91;
  if ([...pair].every((kind) => ["cave", "cavern", "underworld", "hell", "abyss"].includes(kind))) return 88;
  if (has("cloud", "air")) return 96;
  if (pair.has("dream") || pair.has("elemental")) return 74;
  if (pair.has("custom")) return 68;
  if ((pair.has("hell") || pair.has("abyss")) && (pair.has("surface") || pair.has("cloud") || pair.has("air"))) return 28;
  return 52;
}

export function adjacencyFor(
  plane: Pick<Plane, "provinces" | "edges">,
  options: { traversableOnly?: boolean } = {},
): Map<string, string[]> {
  const adjacency = new Map(plane.provinces.map((province) => [province.id, [] as string[]]));
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  for (const edge of plane.edges) {
    if (options.traversableOnly && (edge.kind === "impassable"
      || (byId.get(edge.a) ? isBlockedProvince(byId.get(edge.a)!) : true)
      || (byId.get(edge.b) ? isBlockedProvince(byId.get(edge.b)!) : true))) continue;
    adjacency.get(edge.a)?.push(edge.b);
    adjacency.get(edge.b)?.push(edge.a);
  }
  for (const neighbours of adjacency.values()) neighbours.sort();
  return adjacency;
}

export function shortestDistances(adjacency: Map<string, string[]>, start: string): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const distance = distances.get(current)!;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (distances.has(neighbour)) continue;
      distances.set(neighbour, distance + 1);
      queue.push(neighbour);
    }
  }
  return distances;
}

export function calculateFairness(project: MapProject): FairnessMetrics {
  const refs = project.planes.flatMap((plane, planeIndex) => plane.provinces.map((province) => ({ plane, planeIndex, province })));
  if (!refs.length) {
    return { overall: 0, startSeparation: 0, expansionParity: 0, throneAccess: 0, terrainVariety: 0, connectivity: 0, startDegree: 0, startAllocation: 0, notes: ["Generate a map to score it."] };
  }
  const adjacency = globalMovementAdjacency(project);
  const starts = refs.filter((ref) => ref.province.start);
  const thrones = refs.filter((ref) => ref.province.throne === "preferred" || ref.province.throne === "fixed");
  const notes: string[] = [];
  const distancesFrom = (ref: ProvinceRef) => shortestDistances(adjacency, globalProvinceKey(ref.plane.id, ref.province.id));

  const nearestStarts = starts.map((start) => {
    const distances = distancesFrom(start);
    const others = starts.filter((other) => other !== start).map((other) => distances.get(globalProvinceKey(other.plane.id, other.province.id)) ?? 0);
    return others.length ? Math.min(...others) : 0;
  });
  const separationMean = mean(nearestStarts);
  const separationCv = coefficientOfVariation(nearestStarts);
  const startSeparation = clamp(Math.round(100 - Math.max(0, 5 - separationMean) * 13 - separationCv * 90), 0, 100);
  if (separationMean < 4) notes.push("Some starts are closer than four moves.");

  const expansionValues = starts.map((start) => {
    const distances = distancesFrom(start);
    return refs
      .filter((ref) => (distances.get(globalProvinceKey(ref.plane.id, ref.province.id)) ?? 99) <= 2)
      .reduce((sum, ref) => sum + (ref.province.population ?? 0) / 1000 + (effectiveProvinceTerrainFlags(ref.province).has("farm") ? 2 : 0), 0);
  });
  const expansionParity = clamp(Math.round(100 - coefficientOfVariation(expansionValues) * 260), 0, 100);
  if (expansionParity < 80) notes.push("Two-ring expansion value varies noticeably between starts.");

  const throneDistances = starts.map((start) => {
    const distances = distancesFrom(start);
    return thrones.length ? Math.min(...thrones.map((throne) => distances.get(globalProvinceKey(throne.plane.id, throne.province.id)) ?? 99)) : 0;
  });
  const throneAccess = thrones.length
    ? clamp(Math.round(100 - coefficientOfVariation(throneDistances) * 220 - Math.max(0, max(throneDistances) - min(throneDistances) - 1) * 10), 0, 100)
    : 100;
  if (throneAccess < 80) notes.push("Nearest-throne access is uneven.");

  const terrainSignature = (province: Province) => [...effectiveProvinceTerrainFlags(province)].sort().join("+") || "plains";
  const counts = new Map<string, number>();
  for (const { province } of refs) {
    const signature = terrainSignature(province);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  const probabilities = [...counts.values()].map((count) => count / refs.length);
  const entropy = -probabilities.reduce((sum, probability) => sum + probability * Math.log(probability), 0);
  const normalizedEntropy = counts.size > 1 ? entropy / Math.log(counts.size) : 0;
  let sameEdges = 0;
  let edgeCount = 0;
  for (const plane of project.planes) {
    const byId = new Map(plane.provinces.map((province) => [province.id, province]));
    edgeCount += plane.edges.length;
    sameEdges += plane.edges.filter((edge) => {
      const a = byId.get(edge.a);
      const b = byId.get(edge.b);
      return a && b ? terrainSignature(a) === terrainSignature(b) : false;
    }).length;
  }
  const joinRatio = edgeCount ? sameEdges / edgeCount : 0;
  const terrainVariety = clamp(Math.round(normalizedEntropy * 78 + Math.min(joinRatio, 0.45) * 49), 0, 100);
  if (counts.size < 6) notes.push("The map uses fewer than six terrain categories.");

  const movementRefs = refs.filter((ref) => !isBlockedProvince(ref.province));
  const reachable = movementRefs.length ? shortestDistances(adjacency, globalProvinceKey(movementRefs[0]!.plane.id, movementRefs[0]!.province.id)).size : 0;
  const degreeValues = movementRefs.map((ref) => adjacency.get(globalProvinceKey(ref.plane.id, ref.province.id))?.length ?? 0);
  const connectivity = reachable === movementRefs.length
    ? clamp(Math.round(100 - Math.max(0, 3 - min(degreeValues)) * 15 - coefficientOfVariation(degreeValues) * 28), 0, 100)
    : Math.round((reachable / Math.max(1, movementRefs.length)) * 60);
  if (reachable !== movementRefs.length) notes.push("At least one traversable province or plane is disconnected.");

  const targetDegree = project.settings.startDegreeTarget ?? 4;
  const localAdjacency = new Map(project.planes.map((plane) => [plane.id, adjacencyFor(plane, { traversableOnly: true })]));
  const startDegrees = starts.map((start) => localAdjacency.get(start.plane.id)?.get(start.province.id)?.length ?? 0);
  const degreeDeficit = startDegrees.length ? mean(startDegrees.map((degree) => Math.max(0, targetDegree - degree))) : targetDegree;
  const degreeSpread = startDegrees.length ? max(startDegrees) - min(startDegrees) : targetDegree;
  const startDegree = clamp(Math.round(100 - degreeDeficit * 22 - Math.max(0, degreeSpread - 1) * 10 - coefficientOfVariation(startDegrees) * 55), 0, 100);
  if (startDegrees.some((degree) => degree < targetDegree)) notes.push(`Some starts have fewer than ${targetDegree} traversable connections.`);
  if (degreeSpread > 2) notes.push("Start connection counts vary by more than two.");

  const requested = normalizeStartDistribution(project.settings.startDistribution, project.settings.players);
  const actual: StartDistribution = { land: 0, coastal: 0, water: 0, cave: 0, other: 0 };
  for (const start of starts) {
    const local = localAdjacency.get(start.plane.id)!;
    const type = start.province.startType && matchesStartType(start, start.province.startType, local)
      ? start.province.startType
      : classifyStartType(start, local);
    actual[type] += 1;
  }
  const allocationError = START_TYPES.reduce((sum, type) => sum + Math.abs(requested[type] - actual[type]), 0);
  const startAllocation = clamp(Math.round(100 - allocationError * 50 / Math.max(1, project.settings.players)), 0, 100);
  if (startAllocation < 100) notes.push("Requested start categories could not be matched exactly.");

  const overall = Math.round(startSeparation * 0.2 + expansionParity * 0.22 + throneAccess * 0.14 + terrainVariety * 0.1
    + connectivity * 0.1 + startDegree * 0.14 + startAllocation * 0.1);
  if (!notes.length) notes.push("All headline multiplayer checks are within the target range.");
  return { overall, startSeparation, expansionParity, throneAccess, terrainVariety, connectivity, startDegree, startAllocation, notes };
}

function globalProvinceKey(planeId: string, provinceId: string): string {
  return `${planeId}:${provinceId}`;
}

function globalMovementAdjacency(project: MapProject): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const addNode = (key: string) => { if (!result.has(key)) result.set(key, []); };
  const link = (a: string, b: string) => {
    addNode(a);
    addNode(b);
    if (!result.get(a)!.includes(b)) result.get(a)!.push(b);
    if (!result.get(b)!.includes(a)) result.get(b)!.push(a);
  };
  for (const plane of project.planes) {
    for (const province of plane.provinces) if (!isBlockedProvince(province)) addNode(globalProvinceKey(plane.id, province.id));
    const byId = new Map(plane.provinces.map((province) => [province.id, province]));
    for (const edge of plane.edges) {
      const a = byId.get(edge.a);
      const b = byId.get(edge.b);
      if (edge.kind === "impassable" || !a || !b || isBlockedProvince(a) || isBlockedProvince(b)) continue;
      link(globalProvinceKey(plane.id, edge.a), globalProvinceKey(plane.id, edge.b));
    }
  }
  for (const gate of project.gates) {
    const endpoints = gate.endpoints.filter((endpoint) => result.has(globalProvinceKey(endpoint.planeId, endpoint.provinceId)));
    for (let a = 0; a < endpoints.length; a += 1) {
      for (let b = a + 1; b < endpoints.length; b += 1) {
        link(globalProvinceKey(endpoints[a]!.planeId, endpoints[a]!.provinceId), globalProvinceKey(endpoints[b]!.planeId, endpoints[b]!.provinceId));
      }
    }
  }
  for (const neighbours of result.values()) neighbours.sort();
  return result;
}

export function provinceGlobalNumber(project: MapProject, planeId: string, provinceId: string): number | undefined {
  let offset = 0;
  for (const plane of project.planes) {
    const province = plane.provinces.find((item) => item.id === provinceId);
    if (plane.id === planeId && province) return offset + province.index;
    offset += plane.provinces.length;
  }
  return undefined;
}

export function describeBiome(biome: BiomeKey): string {
  return BIOME_LABELS[biome];
}

function normalizePlaneKind(kind: PlaneKind): PlaneKind {
  return Object.prototype.hasOwnProperty.call(ARCHETYPE_PROFILES, kind) ? kind : "custom";
}

function normalizeGateLayout(layout: GateLayout | undefined): GateLayout {
  return layout === "chain" || layout === "ring" || layout === "compatible" ? layout : "hub";
}

function normalizeGateDirection(direction: GateDirection | undefined): GateDirection {
  return direction === "forward" || direction === "reverse" ? direction : "bidirectional";
}

function normalizeStartDistribution(distribution: StartDistribution | undefined, players: number): StartDistribution {
  if (!distribution) return { land: players, coastal: 0, water: 0, cave: 0, other: 0 };
  const raw = Object.fromEntries(START_TYPES.map((type) => [type, clamp(Math.round(distribution[type] ?? 0), 0, players)])) as unknown as StartDistribution;
  const sum = START_TYPES.reduce((total, type) => total + raw[type], 0);
  if (sum <= 0) return { land: players, coastal: 0, water: 0, cave: 0, other: 0 };
  if (sum < players) {
    raw.land += players - sum;
    return raw;
  }
  if (sum === players) return raw;

  const scaled = START_TYPES.map((type) => ({ type, exact: raw[type] * players / sum }));
  const normalized = Object.fromEntries(scaled.map(({ type, exact }) => [type, Math.floor(exact)])) as unknown as StartDistribution;
  let remaining = players - START_TYPES.reduce((total, type) => total + normalized[type], 0);
  scaled.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || START_TYPES.indexOf(a.type) - START_TYPES.indexOf(b.type));
  for (let index = 0; remaining > 0; index += 1) {
    normalized[scaled[index]!.type] += 1;
    remaining -= 1;
  }
  return normalized;
}

function normalizePlaneConnections(rules: PlaneConnectionRule[], planes: Plane[]): PlaneConnectionRule[] {
  const ids = new Set(planes.map((plane) => plane.id));
  const seen = new Set<string>();
  const normalized: PlaneConnectionRule[] = [];
  for (const rule of rules) {
    if (!ids.has(rule.a) || !ids.has(rule.b) || rule.a === rule.b) continue;
    const key = connectionKey(rule.a, rule.b);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      a: rule.a,
      b: rule.b,
      pairs: clamp(Math.round(rule.pairs || 1), 1, 3),
      enabled: rule.enabled !== false,
    });
  }
  return normalized;
}

function mergePaths(primary: MagicPath[], secondary: MagicPath[], limit: number): MagicPath[] {
  return [...new Set([...primary, ...secondary])].slice(0, limit);
}

function modalInteger(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function coefficientOfVariation(values: number[]): number {
  const average = mean(values);
  return average ? standardDeviation(values) / average : 0;
}

function min(values: number[]): number {
  return values.length ? Math.min(...values) : 0;
}

function max(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
