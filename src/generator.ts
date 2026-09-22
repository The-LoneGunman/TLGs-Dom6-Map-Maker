import {
  BIOME_LABELS,
  MAX_PLANES,
  RESOLUTION_PRESETS,
  SCHEMA_VERSION,
  clearAllPlayerStartFeatures,
  cloneProject,
  effectiveProvinceTerrainFlags,
  isBlockedProvince,
  isBlockedTerrain,
  isCaveProvince,
  isWaterProvince,
  isWaterTerrain,
  prepareProvinceForPlayerStart,
  setNationSpecificStart,
  type BiomeKey,
  type EconomyBalanceMode,
  type Edge,
  type EdgeKind,
  type FairnessMetrics,
  type GateDirection,
  type GateLink,
  type GateLayout,
  type GenerationSettings,
  type MagicPath,
  type MapProject,
  type OceanLayout,
  type OverlandTopologyMode,
  type Plane,
  type PlaneConnectionRule,
  type PlaneKind,
  type PlaneVariant,
  type Province,
  type StartDistribution,
  type StartType,
  type TerrainKey,
} from "./domain";
import {
  computeProvinceTopology,
  connectionKey,
  createSparsePassagePlanner,
  resolvePlaneOwnershipMode,
  usesConnectedRegions,
  type SparsePassage,
  type SparsePassagePlanner,
} from "./geometry";
import { buildConnectedRegionPlan } from "./connectedRegions";
import { regenerateGeneratedProvinceNames } from "./naming";
import { assertCanRebuildLayout, pruneAuthoringRegions, restoreGenerationLocks } from "./authoringLocks";
import { applyPlaneContentPreferences, applyPlaneRoutePreferences, assertPlaneGenerationOverrides, preferredDryTerrain } from "./generationControls";
import { generateBorderRivers } from "./borderRivers";

const TAU = Math.PI * 2;

/** Island-chain geography needs enough sea to separate and surround its land routes. */
export const ISLAND_CHAIN_MIN_WATER_PERCENT = 48;

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
  poptypes: readonly number[];
  populationScale: number;
  waterCapable: boolean;
  caveFamily: boolean;
  manySitesChance: number;
}

/**
 * Verified Dominions 6.35 independent-population IDs. These control native
 * post-capture recruitment only; explicit guardian groups below control the
 * initial neutral army.
 */
export const ARCHETYPE_POPTYPE_POOLS: Record<PlaneKind, readonly number[]> = {
  surface: [25, 26, 27, 28, 29, 30, 37, 39, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60],
  cave: [44, 81, 84, 93],
  cavern: [40, 44, 81, 84],
  cloud: [34],
  air: [34],
  underworld: [96],
  hell: [94],
  abyss: [106],
  dream: [89, 106],
  elemental: [34, 94, 106],
  custom: [25, 26, 27, 28, 29, 30, 37, 39, 48],
};

export const AQUATIC_POPTYPE_POOL: readonly number[] = [31, 45, 63, 64, 65, 72, 73, 90, 91, 92, 95, 97, 105];

const VARIANT_POPTYPE_POOLS: Partial<Record<PlaneVariant, readonly number[]>> = {
  wild: [37, 89],
  fungal: [44, 84],
  crystal: [40, 44],
  volcanic: [94],
  storm: [34],
  infernal: [94],
  void: [106],
};

const CUSTOM_VARIANT_SITE_PATHS: Partial<Record<PlaneVariant, readonly MagicPath[]>> = {
  wild: ["nature", "glamour", "astral"],
  oceanic: ["water", "nature", "glamour"],
  fungal: ["earth", "nature", "glamour"],
  crystal: ["earth", "astral", "glamour"],
  volcanic: ["fire", "earth", "air"],
  storm: ["air", "astral", "glamour"],
  infernal: ["fire", "death", "blood"],
  void: ["death", "astral", "glamour"],
};

export const GUARDIAN_CATALOG_POOLS = {
  surface: { commanders: ["34"], units: ["18", "17", "28"] },
  cave: { commanders: ["2483"], units: ["447", "1615", "1616"] },
  cavern: { commanders: ["2483"], units: ["447", "1615", "1616"] },
  cloud: { commanders: ["614"], units: ["205", "239", "1278"] },
  air: { commanders: ["92"], units: ["205", "239", "1278"] },
  underworld: { commanders: ["2844"], units: ["566", "672", "673", "674", "676", "677"] },
  hell: { commanders: ["87"], units: ["303", "304", "632"] },
  abyss: { commanders: ["1314", "1609"], units: ["307", "308", "489", "1662"] },
  dream: { commanders: ["364"], units: ["463", "592", "851", "3624"] },
  elemental: { commanders: ["98", "92", "103", "1893"], units: ["3719", "3727", "3735", "3743"] },
  custom: { commanders: ["34"], units: ["18", "17", "28"] },
  water: { commanders: ["1067"], units: ["1046", "545", "565"] },
  cave_water: { commanders: ["1463", "1471"], units: ["1452", "1453", "1462", "1464", "1465", "1489"] },
  dream_water: { commanders: ["651", "1572"], units: ["3626", "3913", "3983", "3984", "3985", "3986"] },
  elemental_water: { commanders: ["3730"], units: ["3731", "3733", "3735", "3743"] },
  storm_water: { commanders: ["3374"], units: ["1054", "1055", "3735"] },
  hell_water: { commanders: ["1662"], units: ["904"] },
  abyss_water: { commanders: ["652", "3853"], units: ["307", "308", "2210", "2211", "2213", "3852"] },
} as const;

/**
 * Pinned Dom6 Inspector BaseU.csv revision cfac4311…: every listed unit is
 * Aquatic, Amphibian, or Poor Amphibian and is therefore legal in a Sea land.
 */
export const VERIFIED_WATER_CAPABLE_GUARDIAN_IDS = [
  "1067", "1046", "545", "565",
  "1463", "1471", "1452", "1453", "1462", "1464", "1465", "1489",
  "2844", "566", "672", "673", "674", "676", "677",
  "651", "1572", "3626", "3913", "3983", "3984", "3985", "3986",
  "3730", "3731", "3733", "3735", "3743",
  "3374", "1054", "1055",
  "1662", "904",
  "652", "3853", "307", "308", "2210", "2211", "2213", "3852",
] as const;

type GuardianTheme = keyof typeof GUARDIAN_CATALOG_POOLS;

/**
 * Vanilla has no custom poptype command for a wholly new planar population.
 * These curated native aquatic subsets keep recruitment water-legal while
 * making flooded special realms visibly distinct from an ordinary sea.
 */
export const THEMED_AQUATIC_POPTYPE_POOLS: Partial<Record<GuardianTheme, readonly number[]>> = {
  cave_water: [65, 95, 105],
  underworld: [65, 95, 105],
  dream_water: [72, 97],
  elemental_water: [31, 63, 64, 73],
  storm_water: [72, 97],
  hell_water: [65, 98, 105],
  abyss_water: [65, 95, 98],
};

/**
 * Poptypes are Dominions' native independent-population templates. The manual
 * guarantees their recruitable effect; PD implications come from game data,
 * and they do not change the initial independent army. Selected non-start
 * provinces therefore receive explicit guardian squads below.
 */
export const ARCHETYPE_PROFILES: Readonly<Record<PlaneKind, ArchetypeProfile>> = {
  surface: { defaultVariant: "temperate", sitePaths: ["nature", "earth"], poptypes: ARCHETYPE_POPTYPE_POOLS.surface, populationScale: 1, waterCapable: true, caveFamily: false, manySitesChance: 0.09 },
  cave: { defaultVariant: "fungal", sitePaths: ["earth", "death", "glamour"], poptypes: ARCHETYPE_POPTYPE_POOLS.cave, populationScale: 0.78, waterCapable: false, caveFamily: true, manySitesChance: 0.13 },
  cavern: { defaultVariant: "crystal", sitePaths: ["earth", "astral", "glamour"], poptypes: ARCHETYPE_POPTYPE_POOLS.cavern, populationScale: 0.9, waterCapable: false, caveFamily: true, manySitesChance: 0.15 },
  cloud: { defaultVariant: "storm", sitePaths: ["air", "glamour"], poptypes: ARCHETYPE_POPTYPE_POOLS.cloud, populationScale: 0.72, waterCapable: false, caveFamily: false, manySitesChance: 0.15 },
  air: { defaultVariant: "storm", sitePaths: ["air", "astral", "glamour"], poptypes: ARCHETYPE_POPTYPE_POOLS.air, populationScale: 0.68, waterCapable: false, caveFamily: false, manySitesChance: 0.17 },
  underworld: { defaultVariant: "fungal", sitePaths: ["earth", "death", "glamour"], poptypes: ARCHETYPE_POPTYPE_POOLS.underworld, populationScale: 0.8, waterCapable: false, caveFamily: true, manySitesChance: 0.14 },
  hell: { defaultVariant: "infernal", sitePaths: ["fire", "death", "blood"], poptypes: ARCHETYPE_POPTYPE_POOLS.hell, populationScale: 0.62, waterCapable: false, caveFamily: true, manySitesChance: 0.18 },
  abyss: { defaultVariant: "void", sitePaths: ["death", "astral", "glamour"], poptypes: ARCHETYPE_POPTYPE_POOLS.abyss, populationScale: 0.5, waterCapable: false, caveFamily: true, manySitesChance: 0.2 },
  dream: { defaultVariant: "wild", sitePaths: ["astral", "glamour", "nature"], poptypes: ARCHETYPE_POPTYPE_POOLS.dream, populationScale: 0.84, waterCapable: true, caveFamily: false, manySitesChance: 0.18 },
  elemental: { defaultVariant: "volcanic", sitePaths: ["fire", "air", "water", "earth"], poptypes: ARCHETYPE_POPTYPE_POOLS.elemental, populationScale: 0.7, waterCapable: true, caveFamily: false, manySitesChance: 0.18 },
  custom: { defaultVariant: "temperate", sitePaths: ["astral"], poptypes: ARCHETYPE_POPTYPE_POOLS.custom, populationScale: 1, waterCapable: true, caveFamily: false, manySitesChance: 0.09 },
};

const START_TYPES: StartType[] = ["land", "coastal", "water", "cave", "other"];

export interface AddPlaneOptions {
  /** Generate immediately for compatibility; set false to configure all planes first. */
  generate?: boolean;
  variant?: PlaneVariant;
  provinceTarget?: number;
  name?: string;
  autoSize?: boolean;
  /** Reserve this plane from automatic generic and configured cave-nation starts. */
  noGeneratedStarts?: boolean;
}

interface GeneratePlaneOptions {
  /** Project generation supplies its seed-and-slot identity; standalone generation derives its own. */
  generationKey?: string;
  deferStrategicFeatures?: boolean;
  waterPercent?: number;
  /** Number of degree-equalized, bridge-safe start candidates this plane needs. */
  startCapacity?: number;
}

interface SparseGraphProfile {
  ordinaryMaxDegree: number;
}

const SPARSE_GRAPH_PROFILES: Partial<Record<PlaneKind, SparseGraphProfile>> = {
  cave: { ordinaryMaxDegree: 5 },
  cavern: { ordinaryMaxDegree: 5 },
  underworld: { ordinaryMaxDegree: 5 },
  cloud: { ordinaryMaxDegree: 3 },
  air: { ordinaryMaxDegree: 3 },
  hell: { ordinaryMaxDegree: 3 },
  abyss: { ordinaryMaxDegree: 4 },
  dream: { ordinaryMaxDegree: 4 },
  elemental: { ordinaryMaxDegree: 4 },
};

const DEFAULT_SPARSE_GRAPH_PROFILE: SparseGraphProfile = { ordinaryMaxDegree: 3 };

/** The Styx plane keeps its dedicated topology and water-barrier construction. */
const UNDERWORLD_GRAPH_PROFILE = {
  cycleRatio: 0.28, ordinaryMaxDegree: 5, clusterSize: 15, degreeTwoTarget: 0.4, leafMaximum: 0.1,
};

function sparseGraphProfileFor(plane: Pick<Plane, "kind" | "variant">): SparseGraphProfile {
  // A custom sparse Void plane is the exact user-authored analogue of the
  // Abyss and uses its same start-hub repair degree bound.
  if (plane.kind === "custom" && plane.variant === "void") return SPARSE_GRAPH_PROFILES.abyss!;
  return SPARSE_GRAPH_PROFILES[plane.kind] ?? DEFAULT_SPARSE_GRAPH_PROFILE;
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
    noGeneratedStarts: false,
    provinceTarget: index === 0 ? 96 : 48,
    width: preset.width,
    height: preset.height,
    wrapX: kind === "underworld" ? false : true,
    wrapY: kind === "underworld" ? false : true,
    provinces: [],
    edges: [],
    rawDirectives: "",
  };
}

export function defaultPlaneName(kind: PlaneKind, index: number): string {
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

export function createDefaultProject(seed = "pantokrator-001", options: { generate?: boolean } = {}): MapProject {
  const now = new Date().toISOString();
  const settings: GenerationSettings = {
    players: 6,
    provincesPerPlayer: 16,
    waterPercent: 18,
    oceanLayout: "natural",
    continentCount: 3,
    specialPlaneSizePercent: 30,
    provinceNameSeed: 0,
    biomeCohesion: 58,
    throneCount: 8,
    economyBalance: "hard",
    overlandTopology: "competitive",
    startDistribution: { land: 6, coastal: 0, water: 0, cave: 0, other: 0 },
    startDegreeTarget: 4,
    caveStartNations: [],
    gateLayout: "compatible",
    gateDirection: "bidirectional",
    gatePairsPerConnection: 2,
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
  return options.generate === false ? project : generateProject(project);
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
  // Removing a middle plane must not let the next append reuse a surviving ID.
  const existingIds = new Set(next.planes.map((item) => item.id));
  for (let candidate = next.planes.length; existingIds.has(plane.id); candidate += 1) {
    plane.id = idFor(project.seed, "plane", candidate + 1);
  }
  if (next.settings.resolution !== "custom") {
    const preset = RESOLUTION_PRESETS[next.settings.resolution];
    plane.width = preset.width;
    plane.height = preset.height;
  }
  plane.variant = options.variant ?? plane.variant;
  plane.autoSize = options.autoSize ?? false;
  plane.noGeneratedStarts = options.noGeneratedStarts ?? false;
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
  if (options.generate !== false) {
    regenerateGeneratedProvinceNames(next.planes, next.seed, next.settings.provinceNameSeed ?? 0);
  }
  if (options.generate !== false) next.gates = generateGates(next);
  next.updatedAt = new Date().toISOString();
  return next;
}

export interface ProvinceBudgetRow {
  planeId: string;
  name: string;
  core: boolean;
  autoSize: boolean;
  reserved: boolean;
  current: number;
  target: number;
  requested: number;
  allocatedStarts: number;
  reason: string;
}

type StartPlaneTargets = Map<StartType, Map<string, number>>;

/** Start families a plane can host; the families never share a plane. */
function plannedStartTypesForPlane(plane: Pick<Plane, "kind" | "variant" | "ownershipMode">): StartType[] {
  if (!isCorePlaneForSizing(plane)) return ["cave", "other"];
  return isTrueCaveCorePlane(plane) ? ["cave"] : ["land", "coastal", "water"];
}

function plannedStartsOnPlane(targets: StartPlaneTargets, plane: Pick<Plane, "id" | "kind" | "variant" | "ownershipMode">): number {
  return plannedStartTypesForPlane(plane).reduce((sum, type) => sum + (targets.get(type)?.get(plane.id) ?? 0), 0);
}

/**
 * Auto-sized planes grow with the starts they receive, while the capacity
 * greedy split depends on those sizes. Iterate from the historical stand-in
 * split until the greedy reproduces the split on the sizes it implies, so the
 * preview, the generated plane sizes and start placement share one plan. If
 * the iteration ever revisits a split, the split reached before the repeat is
 * kept; placement uses that frozen split rather than re-deriving another.
 */
function settleStartSplit(
  planes: PlanningPlane[],
  requested: StartDistribution,
  initialSizes: readonly number[],
  resize: (plane: PlanningPlane, allocatedStarts: number) => number | undefined,
): StartPlaneTargets {
  const project = { planes };
  let targets = allocateGeneratedStartsBySize(project, initialSizes, requested);
  const signature = (split: StartPlaneTargets) => planes.map((plane) => plannedStartsOnPlane(split, plane)).join(":");
  const sizesFor = (split: StartPlaneTargets) => planes.map((plane, index) =>
    resize(plane, plannedStartsOnPlane(split, plane)) ?? initialSizes[index]!);
  const seen = new Set<string>([signature(targets)]);
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const next = allocateGeneratedStartsBySize(project, sizesFor(targets), requested);
    const nextSignature = signature(next);
    if (nextSignature === signature(targets) || seen.has(nextSignature)) break;
    seen.add(nextSignature);
    targets = next;
  }
  return targets;
}

type PlanningPlane = Plane & { autoSize: boolean };

interface GeneratedStartPlan {
  rows: ProvinceBudgetRow[];
  /** The one per-plane start split used by the budget and by placement. */
  targets: StartPlaneTargets;
  actualCore: number;
  referenceCore: number;
}

function planGeneratedStarts(project: Pick<MapProject, "planes" | "settings">, requestedOverride?: StartDistribution): GeneratedStartPlan {
  const settings = { ...project.settings,
    players: clamp(Math.round(project.settings.players), 2, 32),
    provincesPerPlayer: clamp(Math.round(project.settings.provincesPerPlayer), 8, 30),
    specialPlaneSizePercent: clamp(Math.round(project.settings.specialPlaneSizePercent ?? 30), 1, 500),
    startDegreeTarget: clamp(Math.round(project.settings.startDegreeTarget ?? 4), 1, 8),
  };
  const planes: PlanningPlane[] = project.planes.map((plane, index) => ({ ...plane,
    kind: normalizePlaneKind(plane.kind),
    variant: plane.variant ?? ARCHETYPE_PROFILES[normalizePlaneKind(plane.kind)].defaultVariant,
    autoSize: plane.autoSize ?? index === 0,
    provinceTarget: clamp(Math.round(plane.provinceTarget), 8, 800),
  }));
  const requestedStarts = requestedOverride ?? normalizeStartDistribution(settings.startDistribution, settings.players);
  // Manual planes are measured by their next-generation target. Their current
  // province count may be stale (an edited target is applied only by Generate).
  const autoCore = (plane: PlanningPlane) => plane.autoSize && isCorePlaneForSizing(plane);
  const autoCoreTarget = (allocated: number) => Math.max(18, Math.round(allocated * settings.provincesPerPlayer));
  const coreStartTargets = settleStartSplit(
    planes,
    requestedStarts,
    planes.map((plane) => autoCore(plane) ? settings.provincesPerPlayer : plane.provinceTarget),
    (plane, allocated) => autoCore(plane) ? clamp(autoCoreTarget(allocated), 8, 800) : undefined,
  );
  const coreTargets = new Map<number, number>();
  planes.forEach((plane, index) => {
    if (!isCorePlaneForSizing(plane)) return;
    coreTargets.set(index, plane.autoSize ? autoCoreTarget(plannedStartsOnPlane(coreStartTargets, plane)) : plane.provinceTarget);
  });
  const actualCore = [...coreTargets.values()].reduce((sum, value) => sum + clamp(value, 8, 800), 0);
  const referenceCore = actualCore || settings.players * settings.provincesPerPlayer;
  const percentageTarget = Math.round(referenceCore * settings.specialPlaneSizePercent / 100);
  const autoBonus = (plane: PlanningPlane) => plane.autoSize && !isCorePlaneForSizing(plane);
  const bonusStartTargets = settleStartSplit(
    planes,
    requestedStarts,
    planes.map((plane, index) => plane.autoSize
      ? isCorePlaneForSizing(plane) ? coreTargets.get(index) ?? plane.provinceTarget : Math.max(18, percentageTarget)
      : plane.provinceTarget),
    (plane, allocated) => autoBonus(plane)
      ? clamp(Math.max(18, allocated ? allocated * (12 + 2 * settings.startDegreeTarget) : 18, percentageTarget), 8, 800)
      : undefined,
  );
  const targets: StartPlaneTargets = new Map(START_TYPES.map((type) => [type, new Map<string, number>()]));
  for (const plane of planes) {
    const source = isCorePlaneForSizing(plane) ? coreStartTargets : bonusStartTargets;
    for (const type of plannedStartTypesForPlane(plane)) {
      const count = source.get(type)?.get(plane.id) ?? 0;
      if (count) targets.get(type)!.set(plane.id, count);
    }
  }
  const rows: ProvinceBudgetRow[] = planes.map((plane, index) => {
    const core = isCorePlaneForSizing(plane);
    const allocatedStarts = plannedStartsOnPlane(targets, plane);
    const minimumForStarts = allocatedStarts ? allocatedStarts * (12 + 2 * settings.startDegreeTarget) : 18;
    const requested = !plane.autoSize ? plane.provinceTarget : core ? coreTargets.get(index) ?? plane.provinceTarget
      : Math.max(18, minimumForStarts, percentageTarget);
    const target = clamp(Math.round(requested), 8, 800);
    const reason = !plane.autoSize ? "Manual size preserved" : requested > 800 ? "Limited to 800 provinces"
      : core ? allocatedStarts ? `${allocatedStarts} starts × ${settings.provincesPerPlayer} provinces/player${requested === 18 && allocatedStarts * settings.provincesPerPlayer < 18 ? "; 18 minimum" : ""}` : "18-province minimum; no allocated starts"
        : minimumForStarts > Math.max(18, percentageTarget) ? `${settings.specialPlaneSizePercent}% of core enlarged for start/guardian buffers`
          : percentageTarget < 18 ? "18-province minimum" : `${settings.specialPlaneSizePercent}% of ${referenceCore} core provinces`;
    return { planeId: plane.id, name: plane.name, core, autoSize: plane.autoSize, reserved: plane.noGeneratedStarts ?? false,
      current: plane.provinces.length, target, requested, allocatedStarts, reason };
  });
  return { rows, targets, actualCore, referenceCore };
}

/** The same planning calculation feeds generation and its read-only budget preview. */
export function previewProvinceBudget(project: MapProject) {
  const { rows, actualCore, referenceCore } = planGeneratedStarts(project);
  return { planes: rows, core: actualCore, bonus: rows.filter(r => !r.core).reduce((sum, r) => sum + r.target, 0),
    total: rows.reduce((sum, r) => sum + r.target, 0), referenceCore, usesFallbackCore: actualCore === 0 };
}

/** Explicit-generation provenance only; content/terrain edits must never call this. */
export function captureGeneratedWaterProvenance(plane: Plane): void {
  // Recompute against the common base partition, never a previous body's
  // coast treatment. Frame contact is preserved by the bounded shape warp.
  delete plane.landformWater;
  if (plane.landformStyle !== "natural-v1" || resolvePlaneOwnershipMode(plane) !== "solid") return;
  const topology = computeProvinceTopology(plane);
  const water = new Map(plane.provinces.filter(isWaterProvince).map(province => [province.id, [] as string[]]));
  for (const pair of topology.pairs) if (water.has(pair.a) && water.has(pair.b)) {
    water.get(pair.a)!.push(pair.b); water.get(pair.b)!.push(pair.a);
  }
  const frame = new Set(topology.cells.filter(cell => water.has(cell.provinceId)
    && cell.polygons.some(polygon => polygon.some(point => Math.min(point.x, 1 - point.x, point.y, 1 - point.y) <= 1e-8)))
    .map(cell => cell.provinceId));
  const order = new Map(plane.provinces.map((province, index) => [province.id, index]));
  const unseen = new Set(water.keys()), groups: NonNullable<Plane["landformWater"]> = [];
  while (unseen.size) {
    const first = unseen.values().next().value!, queue = [first]; unseen.delete(first);
    for (let cursor = 0; cursor < queue.length; cursor++) for (const next of water.get(queue[cursor]!)!) {
      if (unseen.delete(next)) queue.push(next);
    }
    groups.push({ provinceIds: queue.sort((a, b) => order.get(a)! - order.get(b)!),
      enclosed: !queue.some(id => frame.has(id)) });
  }
  plane.landformWater = groups;
}

/** Rebind typed references in a generation-only clone; saved/editor identities never change. */
function remapGenerationPlaneIds(project: MapProject, ids: ReadonlyMap<string, string>): void {
  const mapped = (id: string) => ids.get(id) ?? id;
  for (const plane of project.planes) plane.id = mapped(plane.id);
  for (const start of project.specificStarts) start.planeId = mapped(start.planeId);
  for (const gate of project.gates) for (const endpoint of gate.endpoints) endpoint.planeId = mapped(endpoint.planeId);
  for (const link of project.settings.planeConnections ?? []) { link.a = mapped(link.a); link.b = mapped(link.b); }
  for (const region of project.authoring?.regions ?? []) region.planeId = mapped(region.planeId);
}

export function generateProject(project: MapProject): MapProject {
  // All generation stages (including ID-based tie breaks) see seed/slot IDs,
  // not the random seed that happened to create the editor's original planes.
  // Keep the applied identity for rendering after restoring reference IDs.
  const working = cloneProject(project);
  const ids = new Map(project.planes.map((plane, index) => [plane.id, idFor(project.seed, "plane", index)]));
  // Keep dangling references outside the temporary plane-ID namespace. A
  // missing saved plane may happen to have a canonical seed/slot ID; allowing
  // that alias would silently assign its starts or bookmarks to a real plane.
  const references = [
    ...project.specificStarts.map(start => start.planeId),
    ...project.gates.flatMap(gate => gate.endpoints.map(endpoint => endpoint.planeId)),
    ...(project.settings.planeConnections ?? []).flatMap(link => [link.a, link.b]),
    ...(project.authoring?.regions ?? []).map(region => region.planeId),
  ];
  for (const id of references) if (!ids.has(id)) ids.set(id, `unresolved-generation-plane-${ids.size}`);
  remapGenerationPlaneIds(working, ids);
  const generated = generateProjectWithIdentities(working);
  remapGenerationPlaneIds(generated, new Map([...ids].map(([from, to]) => [to, from])));
  // After gateways and final names, so the notice matches export validation.
  appendAuthoredStartSpacingWarnings(generated);
  return generated;
}

function generateProjectWithIdentities(project: MapProject): MapProject {
  assertCanRebuildLayout(project);
  for (const plane of project.planes) if (plane.generationOverrides) assertPlaneGenerationOverrides(plane.generationOverrides);
  const next = cloneProject(project);
  removeGeneratedCaveSpecificStarts(next);
  next.generationWarnings = [];
  next.schemaVersion = SCHEMA_VERSION;
  next.settings.players = clamp(Math.round(next.settings.players), 2, 32);
  next.settings.provincesPerPlayer = clamp(Math.round(next.settings.provincesPerPlayer), 8, 30);
  next.settings.waterPercent = clamp(Math.round(next.settings.waterPercent), 0, 60);
  next.settings.oceanLayout = normalizeOceanLayout(next.settings.oceanLayout);
  if (next.settings.oceanLayout === "island_chains") {
    // Persist the effective quota so the project never claims a low-water
    // island layout that the generator deliberately cannot produce.
    next.settings.waterPercent = Math.max(next.settings.waterPercent, ISLAND_CHAIN_MIN_WATER_PERCENT);
  }
  next.settings.continentCount = clamp(Math.round(next.settings.continentCount ?? 3), 2, 6);
  next.settings.specialPlaneSizePercent = clamp(Math.round(next.settings.specialPlaneSizePercent ?? 30), 1, 500);
  next.settings.provinceNameSeed = Math.max(0, Math.round(next.settings.provinceNameSeed ?? 0));
  next.settings.biomeCohesion = clamp(Math.round(next.settings.biomeCohesion), 0, 100);
  next.settings.throneCount = clamp(Math.round(next.settings.throneCount), 0, 64);
  next.settings.economyBalance = normalizeEconomyBalanceMode(next.settings.economyBalance);
  next.settings.overlandTopology = normalizeOverlandTopologyMode(next.settings.overlandTopology);
  next.settings.startDegreeTarget = clamp(Math.round(next.settings.startDegreeTarget ?? 4), 1, 8);
  next.settings.caveStartNations = normalizeCaveStartNations(next.settings.caveStartNations);
  next.settings.gateLayout = normalizeGateLayout(next.settings.gateLayout);
  next.settings.gateDirection = normalizeGateDirection(next.settings.gateDirection);
  if (next.settings.gatePairsPerConnection !== undefined) {
    next.settings.gatePairsPerConnection = clamp(Math.round(next.settings.gatePairsPerConnection), 1, 3);
  }
  next.settings.startDistribution = normalizeStartDistribution(next.settings.startDistribution, next.settings.players);
  if (!next.planes.length) next.planes = [defaultPlane(next.seed, 0)];
  next.planes = next.planes.slice(0, MAX_PLANES);
  const requestedStarts = next.settings.startDistribution;
  next.planes = next.planes.map((plane, index) => {
    const normalized = cloneProject({ ...next, planes: [plane] } as MapProject).planes[0]!;
    normalized.kind = normalizePlaneKind(normalized.kind);
    normalized.variant = normalized.variant ?? ARCHETYPE_PROFILES[normalized.kind].defaultVariant;
    if (normalized.kind === "underworld" && normalized.ownershipMode === "solid") {
      normalized.ownershipMode = "sparse";
      next.generationWarnings!.push(`${normalized.name} now uses chamber-and-corridor ownership so its River Styx and authored crossings match the exported map.`);
    }
    normalized.autoSize = normalized.autoSize ?? index === 0;
    normalized.provinceTarget = clamp(Math.round(normalized.provinceTarget), 8, 800);
    return normalized;
  });
  const budget = previewProvinceBudget(next);
  next.planes = next.planes.map((normalized, index) => {
    normalized.provinceTarget = budget.planes[index]!.target;
    const requestedWater = next.settings.startDistribution!.water + (next.settings.startDistribution!.coastal ? Math.max(2, next.settings.startDistribution!.coastal) : 0);
    const waterPercent = ARCHETYPE_PROFILES[normalized.kind].waterCapable
      ? Math.max(normalized.generationOverrides?.waterPercent ?? next.settings.waterPercent, Math.ceil((requestedWater * 100) / normalized.provinceTarget))
      : 0;
    return generatePlane(normalized, next.settings, `${next.seed}:plane:${index}:v1`, index, {
      generationKey: normalized.id,
      deferStrategicFeatures: true,
      waterPercent,
    });
  });
  const preparedStartAnchors = prepareSparseStartBasins(next, requestedStarts);
  if (next.settings.planeConnections !== undefined) {
    next.settings.planeConnections = normalizePlaneConnections(next.settings.planeConnections, next.planes);
  }
  placeDistributedStarts(next, preparedStartAnchors);
  assignConfiguredCaveStarts(next);
  for (const plane of next.planes) {
    applyGeneratedOverlandTopology(
      plane,
      next.settings.overlandTopology,
      `${next.seed}:overland-topology:${plane.id}`,
      next.specificStarts.filter((start) => start.planeId === plane.id).map((start) => start.provinceId),
    );
    applyPlaneRoutePreferences(next, plane);
  }
  // Gates are movement edges for throne-access balance, so establish them
  // before globally distributing thrones. Throne candidates then exclude the
  // chosen endpoints instead of forcing a second gate roll afterward.
  next.gates = generateGates(next);
  distributeThrones(next);
  // Throne placement is deliberately after the first guardian cleanup. Run
  // the same authored-start union once more so a newly assigned/manual start
  // can never retain generated defenders or a throne in its direct one-ring.
  for (const plane of next.planes) {
    const specificStartIds = next.specificStarts
      .filter((start) => start.planeId === plane.id)
      .map((start) => start.provinceId);
    clearStartZoneGuardians(plane, specificStartIds);
    clearStartZoneThrones(plane, specificStartIds);
  }
  const economyMode = normalizeEconomyBalanceMode(next.settings.economyBalance);
  const softPopulationBaseline = economyMode === "soft" ? capturePopulations(next.planes) : undefined;
  for (const plane of next.planes) {
    if (economyMode !== "none" && plane.provinces.some((province) => province.start)) balanceStartRegions(plane);
    markProvinceSizes(plane);
  }
  if (economyMode !== "none") balanceGlobalStartRegions(next);
  if (softPopulationBaseline) softenPopulationCorrections(softPopulationBaseline);
  // Start balancing can write population/economy values after #specstart
  // assignment. Reapply the clean-capital invariant as the final strategic
  // mutation so generated and preserved authored starts behave alike.
  clearAllPlayerStartFeatures(next);
  for (const plane of next.planes) applyPlaneContentPreferences(next, plane, (province, seed) =>
    guardianFor(plane.kind, plane.variant ?? ARCHETYPE_PROFILES[plane.kind].defaultVariant, province, new SeededRandom(seed), seed));
  appendGuardianCapacityWarnings(next);
  restoreGenerationLocks(project, next);
  for (const plane of next.planes) {
    captureGeneratedWaterProvenance(plane);
    finalizeGeneratedRivers(plane, next.settings, `${next.seed}:river-network:${plane.id}`,
      next.specificStarts.filter(start => start.planeId === plane.id).map(start => start.provinceId), next.generationWarnings);
  }
  pruneAuthoringRegions(next);
  regenerateGeneratedProvinceNames(next.planes, next.seed, next.settings.provinceNameSeed);
  next.updatedAt = new Date().toISOString();
  return next;
}

function normalizeCaveStartNations(nations: number[] | undefined): number[] {
  const seen = new Set<number>();
  const normalized: number[] = [];
  for (const nation of nations ?? []) {
    if (!Number.isInteger(nation) || nation < 5 || seen.has(nation)) continue;
    seen.add(nation);
    normalized.push(nation);
  }
  return normalized;
}

export function removeGeneratedCaveSpecificStarts(project: MapProject): void {
  project.specificStarts = project.specificStarts.filter((start) => start.source !== "generated-cave");
}

function assignConfiguredCaveStarts(project: MapProject) {
  const nations = normalizeCaveStartNations(project.settings.caveStartNations);
  project.settings.caveStartNations = nations;
  if (!nations.length) return;

  const usedNations = new Set(project.specificStarts.map((start) => start.nation));
  const usedProvinces = new Set(project.specificStarts.map((start) => globalProvinceKey(start.planeId, start.provinceId)));
  const caveStarts = project.planes.flatMap((plane, planeIndex) => plane.provinces
    .filter((province) => province.start && province.startType === "cave")
    .map((province) => ({ plane, planeIndex, province })))
    // A configured cave nation belongs in a true Cave/Cavern whenever one of
    // those generated capitals exists. Underworld-style cave-family realms
    // remain a deterministic fallback rather than stealing the first slot.
    .sort((a, b) => Number(!isTrueCaveCorePlane(a.plane)) - Number(!isTrueCaveCorePlane(b.plane))
      || a.planeIndex - b.planeIndex || a.province.index - b.province.index);

  let caveCursor = 0;
  for (const nation of nations) {
    if (usedNations.has(nation)) continue;
    while (caveCursor < caveStarts.length) {
      const candidate = caveStarts[caveCursor++]!;
      const key = globalProvinceKey(candidate.plane.id, candidate.province.id);
      if (usedProvinces.has(key)) continue;
      setNationSpecificStart(project, candidate.plane.id, candidate.province.id, nation, "generated-cave");
      usedNations.add(nation);
      usedProvinces.add(key);
      break;
    }
    if (caveCursor >= caveStarts.length) break;
  }
}

function prepareSparseStartBasins(
  project: MapProject,
  requested: StartDistribution,
): PreparedStartAnchor[] {
  let basinPlan = feasibleDenseStartPlan(project, requested);
  const separatedOverlandPlan = feasibleDenseStartPlan(project, requested, 3);
  const naturalOverland = normalizeOceanLayout(project.settings.oceanLayout) === "natural";
  const scaleAwareNatural = naturalOverland && project.settings.players <= 12;
  const highLoadAtlas = naturalOverland && project.settings.players > 12;
  // Explicit ocean presets promise a particular land/water topology. Their
  // real terrain must constrain starts, not be repainted into scattered seas
  // by the generic category repair. The downstream allocator reports limits.
  const preparedStartAnchors = naturalOverland && (scaleAwareNatural || highLoadAtlas || !basinPlan.feasible || !separatedOverlandPlan.feasible)
    ? ensureOverlandStartCategories(project, requested)
    : undefined;
  if (preparedStartAnchors) {
    basinPlan = feasibleDenseStartPlan(project, requested);
    const preparedCapacities = preparedStartAnchors.flatMap((anchor) => {
      const plane = project.planes.find((candidate) => candidate.id === anchor.planeId);
      if (!plane || resolvePlaneOwnershipMode(plane) !== "solid") return [];
      const local = adjacencyFor(plane, { traversableOnly: true });
      return local.has(anchor.provinceId) ? [reachableWithin(local, anchor.provinceId, 2)] : [];
    });
    if (preparedCapacities.length) basinPlan.twoRingCapacity = Math.round(mean(preparedCapacities));
  }
  const anchors = [...(preparedStartAnchors ?? [])];
  for (let planeIndex = 0; planeIndex < project.planes.length; planeIndex += 1) {
    const plane = project.planes[planeIndex]!;
    if (plane.noGeneratedStarts || resolvePlaneOwnershipMode(plane) !== "sparse") continue;
    const caveCount = plannedGeneratedStartsOnPlane(project, requested, "cave", planeIndex);
    const otherCount = plannedGeneratedStartsOnPlane(project, requested, "other", planeIndex);
    const requestedCount = caveCount + otherCount;
    if (!requestedCount) continue;
    const activeCount = plane.provinces.filter((province) => !isBlockedProvince(province)).length;
    const minimumUsefulDegree = Math.min(project.settings.startDegreeTarget ?? 4, 4);
    // Distance-three starts cannot share a direct neighbour. Reserve roughly
    // half of each sparse player's province budget for the two-ring basin and
    // inter-basin routes instead of consuming it all with a high-degree hub.
    const packingDegreeCap = Math.max(minimumUsefulDegree, Math.floor(activeCount / Math.max(1, requestedCount * 2)));
    const sparseAnchors = repairSparseStartBasins(
      plane,
      requestedCount,
      Math.min(basinPlan.degree, packingDegreeCap),
      basinPlan.twoRingCapacity,
      caveCount > 0 ? "cave" : "other",
      `${project.seed}:plane:${planeIndex}:start-basins`,
    );
    const type = caveCount > 0 ? "cave" as const : "other" as const;
    anchors.push(...sparseAnchors.map((provinceId) => ({ planeId: plane.id, provinceId, type })));
  }
  return anchors;
}

function feasibleDenseStartPlan(
  project: MapProject,
  requested: StartDistribution,
  minimumSeparation = 0,
): { degree: number; twoRingCapacity: number; feasible: boolean } {
  const target = project.settings.startDegreeTarget ?? 4;
  const minimumUsefulDegree = Math.min(target, 4);
  const densePlanes = project.planes.filter((plane) => !plane.noGeneratedStarts && resolvePlaneOwnershipMode(plane) === "solid");
  const constrainedTypes = (["water", "coastal", "land"] as StartType[]).filter((type) => requested[type] > 0);
  if (!constrainedTypes.length || !densePlanes.length) return { degree: target, twoRingCapacity: target * 3 + 1, feasible: true };
  const planningProject = { ...project, planes: densePlanes };
  const adjacency = new Map(densePlanes.map((plane) => [plane.id, adjacencyFor(plane, { traversableOnly: true })]));
  const twoRingCapacity = new Map(densePlanes.map((plane) => {
    const local = adjacency.get(plane.id)!;
    return [plane.id, new Map(plane.provinces.map((province) => [province.id, reachableWithin(local, province.id, 2)]))];
  }));
  const bridgeEndpoints = new Map(densePlanes.map((plane) => {
    const bridgeKeys = graphBridgeKeys(plane);
    const endpoints = new Set<string>();
    for (const edge of plane.edges) {
      if (!bridgeKeys.has(connectionKey(edge.a, edge.b))) continue;
      endpoints.add(edge.a);
      endpoints.add(edge.b);
    }
    return [plane.id, endpoints];
  }));
  const degrees = [...new Set(densePlanes.flatMap((plane) => plane.provinces
    .filter(isEligibleStartProvince)
    .map((province) => adjacency.get(plane.id)?.get(province.id)?.length ?? 0))
    .filter((degree) => degree >= minimumUsefulDegree && degree <= 8))];
  const preferredDegree = target === 4 ? 5 : target;
  degrees.sort((a, b) => Math.abs(a - preferredDegree) - Math.abs(b - preferredDegree) || a - b);
  const searchMemo = createStartSearchMemo();
  for (const degree of degrees) {
    const selected: ProvinceRef[] = [];
    let feasible = true;
    for (const type of constrainedTypes) {
      for (let slot = 0; slot < requested[type]; slot += 1) {
        const candidate = chooseDistributedStart(
          planningProject,
          type,
          selected,
          adjacency,
          twoRingCapacity,
          bridgeEndpoints,
          `${project.seed}:distributed:degree-${degree}:${type}:${slot}`,
          degree,
          minimumSeparation,
          undefined,
          undefined,
          undefined,
          searchMemo,
        );
        if (!candidate) {
          feasible = false;
          break;
        }
        selected.push(candidate);
      }
      if (!feasible) break;
    }
    if (!feasible) continue;
    const capacities = selected.map((candidate) => twoRingCapacity.get(candidate.plane.id)?.get(candidate.province.id) ?? 0);
    return { degree, twoRingCapacity: Math.max(degree + 1, Math.round(mean(capacities))), feasible: true };
  }
  return { degree: target, twoRingCapacity: target * 3 + 1, feasible: false };
}

interface PreparedStartAnchor {
  planeId: string;
  provinceId: string;
  type: StartType;
}

function ensureOverlandStartCategories(project: MapProject, requested: StartDistribution): PreparedStartAnchor[] | undefined {
  const total = requested.land + requested.coastal + requested.water;
  if (!total) return undefined;
  const eligibleIndexes = eligibleGeneratedStartPlaneIndexes(project, "land");
  if (!eligibleIndexes.length) return undefined;
  const anchors: PreparedStartAnchor[] = [];
  for (const planeIndex of eligibleIndexes) {
    const planeRequest: StartDistribution = {
      land: plannedGeneratedStartsOnPlane(project, requested, "land", planeIndex),
      coastal: plannedGeneratedStartsOnPlane(project, requested, "coastal", planeIndex),
      water: plannedGeneratedStartsOnPlane(project, requested, "water", planeIndex),
      cave: 0,
      other: 0,
    };
    if (planeRequest.land + planeRequest.coastal + planeRequest.water === 0) continue;
    const planeAnchors = ensureOverlandStartCategoriesOnPlane(project, planeRequest, planeIndex);
    if (!planeAnchors) return undefined;
    anchors.push(...planeAnchors);
  }
  return anchors.length === total ? anchors : undefined;
}

function ensureOverlandStartCategoriesOnPlane(
  project: MapProject,
  requested: StartDistribution,
  planeIndex: number,
): PreparedStartAnchor[] | undefined {
  const total = requested.land + requested.coastal + requested.water;
  if (!total) return [];
  const plane = project.planes[planeIndex]!;
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  // Start-border repair opens every incident authored border. Use the full
  // graph for anchor spacing so an apparently distant pair cannot become
  // adjacent after those capital exits are normalized.
  const spacingAdjacency = adjacencyFor(plane);
  const minimumUsefulDegree = Math.min(project.settings.startDegreeTarget ?? 4, 4);
  const preferredDegree = project.settings.startDegreeTarget ?? 4;
  const degrees = [...new Set(plane.provinces.map((province) => adjacency.get(province.id)?.length ?? 0)
    .filter((degree) => degree >= minimumUsefulDegree && degree <= 8))]
    .sort((a, b) => Math.abs(a - preferredDegree) - Math.abs(b - preferredDegree) || a - b);
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));

  const preferredAnchorSeparation = scaledStartSeparationTarget(
    plane.provinces.filter((province) => !isBlockedProvince(province)).length,
    total,
  );
  // Anchor spacing only asks whether a pair is closer than a separation of
  // at most preferredAnchorSeparation, so each BFS stops one move short of
  // it. A pair missing from that bounded map is either at least that far
  // apart or unreachable; the connected-component label tells them apart
  // (the graph is undirected between provinces).
  const spacingRadius = Math.max(0, preferredAnchorSeparation - 1);
  const spacingComponent = new Map<string, number>();
  for (const province of plane.provinces) {
    if (spacingComponent.has(province.id)) continue;
    const label = spacingComponent.size;
    for (const id of shortestDistances(spacingAdjacency, province.id).keys()) spacingComponent.set(id, label);
  }
  const distanceCache = new Map<string, Map<string, number>>();
  const nearbyDistancesFrom = (id: string) => {
    let distances = distanceCache.get(id);
    if (!distances) {
      distances = shortestDistances(spacingAdjacency, id, spacingRadius);
      distanceCache.set(id, distances);
    }
    return distances;
  };
  /** Exactly `(fullDistance(from, to) ?? 0) < separation` for separation <= preferredAnchorSeparation. */
  const closerThan = (from: string, to: string, separation: number) => {
    const distance = nearbyDistancesFrom(from).get(to);
    if (distance !== undefined) return distance < separation;
    return spacingComponent.get(from) === spacingComponent.get(to) ? false : 0 < separation;
  };
  const anchorSeparations = Array.from(
    { length: preferredAnchorSeparation - 2 },
    (_, index) => preferredAnchorSeparation - index,
  );
  const repairAttempts = [
    ...anchorSeparations.flatMap((minimumStartSeparation) => degrees.map((degree) => ({ degree, minimumStartSeparation }))),
    ...anchorSeparations.map((minimumStartSeparation) => ({ degree: undefined, minimumStartSeparation })),
  ];
  for (const { degree, minimumStartSeparation } of repairAttempts) {
    const candidates = plane.provinces.filter((province) => isEligibleStartProvince(province)
      && (adjacency.get(province.id)?.length ?? 0) >= minimumUsefulDegree
      && (degree === undefined || (adjacency.get(province.id)?.length ?? 0) === degree));
    if (candidates.length < total) continue;
    const degreeLabel = `${degree === undefined ? "mixed" : String(degree)}:separation-${minimumStartSeparation}`;
    let land: Province[];
    let coastal: Province[];
    let water: Province[];
    const dry = new Set<string>();
    // Candidates are addressed by their position in `candidates`.
    // close[a * candidateCount + b] marks candidate b closer than the
    // separation measured from candidate a (unreachable counts as close);
    // conflictCounts[a] counts the other candidates close to a.
    const candidateCount = candidates.length;
    const close = new Uint8Array(candidateCount * candidateCount);
    const conflictCounts = new Int32Array(candidateCount);
    for (let from = 0; from < candidateCount; from += 1) {
      const fromId = candidates[from]!.id;
      for (let to = 0; to < candidateCount; to += 1) {
        if (!closerThan(fromId, candidates[to]!.id, minimumStartSeparation)) continue;
        close[from * candidateCount + to] = 1;
        if (to !== from) conflictCounts[from] += 1;
      }
    }
    if (total < 18) {
      const jitter = candidates.map((candidate) =>
        hashString(`${project.seed}:category-anchor:${degreeLabel}:${candidate.id}`) % 100000);
      // Rank positions with precomputed keys; the stable sort yields the same
      // order as ranking the candidates with the equivalent comparator.
      const ranked = candidates.map((_, index) => index).sort((a, b) => conflictCounts[a]! - conflictCounts[b]!
        || jitter[a]! - jitter[b]!
        || candidates[a]!.index - candidates[b]!.index);
      const selected: Province[] = [];
      let visitedNodes = 0;
      const nodeBudget = Math.max(250_000, total * 20_000);
      const findSeparatedAnchors = (available: readonly number[]): Province[] | undefined => {
        const needed = total - selected.length;
        if (needed === 0) return [...selected];
        if (available.length < needed || visitedNodes >= nodeBudget) return undefined;
        for (let cursor = 0; cursor <= available.length - needed && visitedNodes < nodeBudget; cursor += 1) {
          visitedNodes += 1;
          const candidate = available[cursor]!;
          // Every entry of `available` is already separated from the current
          // selection, so only the newly added anchor needs checking.
          selected.push(candidates[candidate]!);
          const row = candidate * candidateCount;
          const remaining: number[] = [];
          for (let next = cursor + 1; next < available.length; next += 1) {
            if (!close[row + available[next]!]) remaining.push(available[next]!);
          }
          const result = findSeparatedAnchors(remaining);
          if (result) return result;
          selected.pop();
        }
        return undefined;
      };
      const anchors = findSeparatedAnchors(ranked);
      if (!anchors) continue;
      land = anchors.slice(0, requested.land);
      coastal = anchors.slice(requested.land, requested.land + requested.coastal);
      water = anchors.slice(requested.land + requested.coastal);
    } else {
      // Greedy minimum-conflict packing. conflicts[slot] lists the other
      // candidates close to that candidate and conflictedBy is its reverse,
      // so each removal updates the live conflict counts instead of
      // recounting them.
      const conflicts: number[][] = Array.from({ length: candidateCount }, () => []);
      const conflictedBy: number[][] = Array.from({ length: candidateCount }, () => []);
      for (let slot = 0; slot < candidateCount; slot += 1) {
        for (let other = 0; other < candidateCount; other += 1) {
          if (other === slot || !close[slot * candidateCount + other]) continue;
          conflicts[slot]!.push(other);
          conflictedBy[other]!.push(slot);
        }
      }
      let anchors: Province[] | undefined;
      for (let variant = 0; variant < 24 && !anchors; variant += 1) {
        const jitter = candidates.map((candidate) =>
          hashString(`${project.seed}:large-anchor:${degreeLabel}:${variant}:${candidate.id}`) % 100000);
        const available = new Uint8Array(candidateCount).fill(1);
        const liveConflicts = Int32Array.from(conflictCounts);
        let availableCount = candidateCount;
        const remove = (slot: number) => {
          if (!available[slot]) return;
          available[slot] = 0;
          availableCount -= 1;
          for (const other of conflictedBy[slot]!) liveConflicts[other] -= 1;
        };
        const chosen: Province[] = [];
        while (availableCount && chosen.length < total) {
          // The first available candidate, in candidate order, that is least
          // conflicted, then lowest jitter, then lowest index: exactly the
          // head of a stable sort by that comparator.
          let best = -1;
          for (let slot = 0; slot < candidateCount; slot += 1) {
            if (!available[slot]) continue;
            if (best < 0) {
              best = slot;
              continue;
            }
            const order = liveConflicts[slot]! - liveConflicts[best]!
              || jitter[slot]! - jitter[best]!
              || candidates[slot]!.index - candidates[best]!.index;
            if (order < 0) best = slot;
          }
          chosen.push(candidates[best]!);
          remove(best);
          for (const other of conflicts[best]!) remove(other);
        }
        if (chosen.length === total) anchors = chosen;
      }
      if (!anchors) continue;
      land = anchors.slice(0, requested.land);
      coastal = anchors.slice(requested.land, requested.land + requested.coastal);
      water = anchors.slice(requested.land + requested.coastal);
    }
    for (const anchor of land) {
      dry.add(anchor.id);
      for (const neighbour of adjacency.get(anchor.id) ?? []) dry.add(neighbour);
    }
    for (const anchor of coastal) dry.add(anchor.id);
    const coastalWater = new Set<string>();
    let coastFeasible = true;
    for (const anchor of coastal) {
      const neighbour = (adjacency.get(anchor.id) ?? [])
        .map((id) => byId.get(id))
        .filter((province): province is Province => Boolean(province)
          && !dry.has(province!.id)
          && !coastalWater.has(province!.id))
        // Reuse generated water that already borders the coastal capital
        // before converting a dry neighbour.
        .sort((a, b) => Number(isWaterProvince(b)) - Number(isWaterProvince(a)) || a.index - b.index)[0];
      if (!neighbour) {
        coastFeasible = false;
        break;
      }
      coastalWater.add(neighbour.id);
    }
    if (!coastFeasible) continue;
    const forcedWater = new Set([...coastalWater, ...water.map((province) => province.id)]);
    // This plane was generated moments ago, so its water count is exactly the
    // effective quota enforceWaterQuota applied: the start-driven increase,
    // the Oceanic floor and the 60% clamp are already included. Re-deriving
    // the target from settings would silently discard those adjustments.
    const generatedWater = plane.provinces.filter(isWaterProvince).length;
    const waterTarget = Math.max(forcedWater.size, generatedWater);
    const waterRank = plane.provinces.filter((province) => !dry.has(province.id))
      .sort((a, b) => Number(isWaterProvince(b)) - Number(isWaterProvince(a))
        || field(a.x * 2.1, a.y * 2.3, hashString(`${project.seed}:category-water`) % 97)
          - field(b.x * 2.1, b.y * 2.3, hashString(`${project.seed}:category-water`) % 97)
        || a.index - b.index);
    const waterIds = new Set([...forcedWater, ...waterRank
      .filter((province) => !forcedWater.has(province.id))
      .slice(0, Math.max(0, waterTarget - forcedWater.size))
      .map((province) => province.id)]);
    // Only provinces whose land/water status must change are rewritten. Water
    // that stays water keeps its generated Sea/Deep Sea/Kelp terrain, biome,
    // population and site bias. Conversions in either direction use the same
    // terrain rules as the other ocean layouts, applied to the changed subset.
    const converted = plane.provinces.filter((province) => waterIds.has(province.id) !== isWaterProvince(province));
    const repairSeed = `${project.seed}:category-repair:${planeIndex}`;
    applyOverlandWaterSelection({ ...plane, provinces: converted }, waterIds, repairSeed);
    assignArchetypeDetails(converted, plane.kind, plane.variant, repairSeed);
    return [
      ...land.map((province) => ({ planeId: plane.id, provinceId: province.id, type: "land" as const })),
      ...coastal.map((province) => ({ planeId: plane.id, provinceId: province.id, type: "coastal" as const })),
      ...water.map((province) => ({ planeId: plane.id, provinceId: province.id, type: "water" as const })),
    ];
  }
  return undefined;
}

function repairSparseStartBasins(
  plane: Plane,
  requestedCount: number,
  targetDegree: number,
  twoRingCapacity: number,
  startType: "cave" | "other",
  seed: string,
) {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province)).sort((a, b) => a.index - b.index);
  if (active.length < 2) return [];
  const { pairs: allPairs, spacing } = spatialPairs(active, plane);
  const regionContacts = usesConnectedRegions(plane)
    ? new Set(buildConnectedRegionPlan(plane).voronoiPairs.map(pair => pair.key)) : undefined;
  // The Styx remains a water barrier even when a start needs more exits.
  // Constrain new corridors only; existing designated bridges are preserved.
  const dryBanks = new Map<string, string>();
  if (plane.kind === "underworld") {
    const dryAdjacency = new Map(active.filter((province) => !isWaterProvince(province))
      .map((province) => [province.id, [] as string[]]));
    for (const edge of plane.edges) {
      if (edge.kind === "bridge" || !dryAdjacency.has(edge.a) || !dryAdjacency.has(edge.b)) continue;
      dryAdjacency.get(edge.a)!.push(edge.b);
      dryAdjacency.get(edge.b)!.push(edge.a);
    }
    for (const id of dryAdjacency.keys()) {
      if (dryBanks.has(id)) continue;
      for (const member of shortestDistances(dryAdjacency, id).keys()) dryBanks.set(member, id);
    }
  }
  const pairs = allPairs.filter((pair) => (!regionContacts || regionContacts.has(pair.key))
    && (!dryBanks.has(pair.a.id) || !dryBanks.has(pair.b.id)
      || dryBanks.get(pair.a.id) === dryBanks.get(pair.b.id)));
  const localPairs = pairs.filter((pair) => pair.distance <= spacing * 2.4 + 1e-9);
  const pairByKey = new Map(allPairs.map((pair) => [pair.key, pair]));
  const selected = new Map<string, SpatialPair>();
  const degrees = new Map(active.map((province) => [province.id, 0]));
  for (const edge of plane.edges) {
    const pair = pairByKey.get(connectionKey(edge.a, edge.b));
    if (!pair || selected.has(pair.key)) continue;
    selected.set(pair.key, pair);
    degrees.set(pair.a.id, (degrees.get(pair.a.id) ?? 0) + 1);
    degrees.set(pair.b.id, (degrees.get(pair.b.id) ?? 0) + 1);
  }
  const addPair = (pair: SpatialPair | undefined) => {
    if (!pair || selected.has(pair.key)) return false;
    selected.set(pair.key, pair);
    degrees.set(pair.a.id, (degrees.get(pair.a.id) ?? 0) + 1);
    degrees.set(pair.b.id, (degrees.get(pair.b.id) ?? 0) + 1);
    return true;
  };
  const profile = sparseGraphProfileFor(plane);
  const hubs = addSparseStartHubs(
    active,
    pairs,
    localPairs,
    selected,
    degrees,
    addPair,
    plane,
    requestedCount,
    clamp(targetDegree, 1, active.length - 1),
    profile.ordinaryMaxDegree,
    spacing,
    twoRingCapacity,
    (province) => startType === "cave" ? isCaveProvince(province) && !isWaterProvince(province) : !isWaterProvince(province),
    seed,
    createPassageGuard(plane),
  );
  const existing = new Map(plane.edges.map((edge) => [connectionKey(edge.a, edge.b), edge]));
  plane.edges = [...selected.values()]
    .sort((left, right) => left.a.index - right.a.index || left.b.index - right.b.index)
    .map((pair, index) => existing.get(pair.key) ?? {
      id: idFor(seed, "start-edge", index),
      a: pair.a.id,
      b: pair.b.id,
      kind: "standard",
    });
  return hubs.map((province) => province.id);
}

export function generatePlane(
  source: Plane,
  settings: GenerationSettings,
  stageSeed: string,
  planeIndex: number,
  options: GeneratePlaneOptions = {},
): Plane {
  // Applied geometry provenance is written only by explicit generation. Old
  // imports and settings-only recipes retain their existing saved outlines.
  const referenceId = source.id;
  const generationKey = options.generationKey ?? idFor(stageSeed, "plane", planeIndex);
  source = { ...source, id: generationKey, generationKey, landformStyle: "natural-v1" };
  delete source.landformWater;
  if (source.generationOverrides) assertPlaneGenerationOverrides(source.generationOverrides);
  const rng = new SeededRandom(stageSeed);
  const authoredNames = new Map(source.provinces
    .filter((province) => province.nameSource !== "generated")
    .map((province) => [province.id, { name: province.name, source: province.nameSource ?? "authored" as const }]));
  const authoredNamesByIndex = new Map(source.provinces
    .filter((province) => province.nameSource !== "generated")
    .map((province) => [province.index, { name: province.name, source: province.nameSource ?? "authored" as const }]));
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
    const preferred = preferredDryTerrain(source, terrainBiome.terrain, x, y, `${stageSeed}:terrain-preference:${index}`);
    if (preferred !== terrainBiome.terrain) {
      terrainBiome.terrain = preferred;
      terrainBiome.biome = biomeForTerrain(preferred);
    }
    const profile = ARCHETYPE_PROFILES[source.kind];
    const populationBase = TERRAIN_POPULATION[terrainBiome.terrain];
    const population = populationBase
      ? Math.max(100, Math.round((populationBase * profile.populationScale * (0.83 + rng.next() * 0.34)) / 10) * 10)
      : undefined;
    const siteBias = mergePaths(siteBiasFor(terrainBiome.terrain, climate), profile.sitePaths, 3);
    const id = idFor(stageSeed, "province", index);
    const authored = authoredNames.get(id) ?? authoredNamesByIndex.get(index + 1);
    const warmer = source.variant === "volcanic" || source.variant === "infernal"
      ? rng.chance(0.62)
      : climate.temperature > 0.89 && rng.chance(0.35);
    const colder = !warmer && (source.variant === "frozen"
      ? rng.chance(0.68)
      : climate.temperature < 0.12 && rng.chance(0.35));
    provinces.push({
      id,
      index: index + 1,
      x,
      y,
      gridX,
      gridY,
      name: authored?.name ?? "",
      nameSource: authored?.source ?? "generated",
      biome: terrainBiome.biome,
      terrain: terrainBiome.terrain,
      freshwater: !isBlockedTerrain(terrainBiome.terrain) && climate.moisture > 0.64 && rng.chance(0.22) || undefined,
      small: false,
      large: false,
      noStart: isBlockedTerrain(terrainBiome.terrain),
      manySites: rng.chance(profile.manySitesChance),
      warmer,
      colder,
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

  // Sparse ownership already expresses impassable void as owner 0. Turning a
  // requested playable province into an isolated cave-wall island would make
  // provinceTarget and per-player capacity dishonest, so generated sparse
  // planes keep every requested province traversable. Authors may still mark
  // explicit cave-wall provinces after generation.
  if (resolvePlaneOwnershipMode(source) === "sparse") {
    for (const province of provinces) {
      if (!isBlockedProvince(province)) continue;
      province.terrain = "cave";
      province.terrainFlags = province.terrainFlags?.filter((flag) => flag !== "cavewall");
      province.biome = source.kind === "abyss" ? "void_reaches" : "crystal_deeps";
      province.noStart = false;
      province.population = Math.round(TERRAIN_POPULATION.cave * ARCHETYPE_PROFILES[source.kind].populationScale);
      province.siteBias = mergePaths(["earth", "glamour"], ARCHETYPE_PROFILES[source.kind].sitePaths, 3);
    }
  }

  enforceWaterQuota(
    provinces,
    source,
    options.waterPercent ?? source.generationOverrides?.waterPercent ?? settings.waterPercent,
    stageSeed,
    settings.biomeCohesion,
    normalizeOceanLayout(settings.oceanLayout),
    clamp(Math.round(settings.continentCount ?? 3), 2, 6),
  );
  const edges = buildEdges(provinces, source, stageSeed, settings, options.startCapacity ?? 0);
  const generated: Plane = { ...source, provinces, edges };
  repairOverlandOceanTopology(
    generated,
    normalizeOceanLayout(settings.oceanLayout),
    clamp(Math.round(settings.continentCount ?? 3), 2, 6),
    stageSeed,
  );
  enforceTerrainVariety(provinces, source.kind, source.variant, stageSeed);
  if (resolvePlaneOwnershipMode(generated) === "solid") refreshGeneratedBorderKinds(generated, stageSeed);
  applySubterraneanWaters(generated, stageSeed);
  assignArchetypeDetails(provinces, source.kind, source.variant, stageSeed);

  if (!options.deferStrategicFeatures) {
    if (planeIndex === 0 && !generated.noGeneratedStarts) {
      placeStarts(generated, settings.players, stageSeed, settings.startDegreeTarget ?? 4, "land");
      repairStartBorders(generated);
      clearStartZoneGuardians(generated);
    }
    applyGeneratedOverlandTopology(generated, settings.overlandTopology, `${stageSeed}:overland-topology`);
    placeThrones(generated, planeIndex === 0 ? settings.throneCount : Math.max(1, Math.round(settings.throneCount * 0.35)), stageSeed);
    if (planeIndex === 0) {
      const economyMode = normalizeEconomyBalanceMode(settings.economyBalance);
      const softPopulationBaseline = economyMode === "soft" ? capturePopulations([generated]) : undefined;
      if (economyMode !== "none") balanceStartRegions(generated);
      if (softPopulationBaseline) softenPopulationCorrections(softPopulationBaseline);
    }
  } else if (normalizeOverlandTopologyMode(settings.overlandTopology) === "open") {
    // Open borders do not depend on capital placement and are idempotent when
    // a deferred project generation applies the policy again later.
    applyGeneratedOverlandTopology(generated, "open", `${stageSeed}:overland-topology`);
  }
  markProvinceSizes(generated);
  if (!options.deferStrategicFeatures) {
    captureGeneratedWaterProvenance(generated);
    finalizeGeneratedRivers(generated, settings, `${stageSeed}:river-network`);
  }
  regenerateGeneratedProvinceNames([generated], stageSeed, settings.provinceNameSeed ?? 0);
  generated.id = referenceId;
  return generated;
}

function climateAt(x: number, y: number, salt: number) {
  return {
    elevation: clamp(field(x, y, salt % 17) * 0.72 + field(x, y, (salt % 23) + 7) * 0.28, 0, 1),
    moisture: clamp(field(x, y, (salt % 29) + 11) * 0.65 + field(x, y, (salt % 31) + 3) * 0.35, 0, 1),
    biomeElevation: clamp(field(x * 1.8 + 0.17, y * 1.8 - 0.11, salt % 17) * 0.72
      + field(x * 1.8 - 0.13, y * 1.8 + 0.19, (salt % 23) + 7) * 0.28, 0, 1),
    biomeMoisture: clamp(field(x * 1.8 + 0.17, y * 1.8 - 0.11, (salt % 29) + 11) * 0.65
      + field(x * 1.8 - 0.13, y * 1.8 + 0.19, (salt % 31) + 3) * 0.35, 0, 1),
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
  // A restrained regional scale supplies nearby alternatives without equal
  // terrain quotas or per-province checkerboarding. Deliberately cohesive and
  // themed worlds retain their original climate rules.
  const regionalBlend = (kind === "surface" || kind === "custom") && activeVariant === "temperate"
    ? clamp((0.8 - cohesion) * 1.2, 0, 0.38) : 0;
  if (regionalBlend > 0) {
    // Preserve climate contrast: a plain average would erase wetter forest
    // regions and high ground by squeezing both fields toward 0.5.
    const contrast = Math.hypot(1 - regionalBlend, regionalBlend);
    const mix = (broad: number, regional: number) => clamp(0.5
      + ((broad - 0.5) * (1 - regionalBlend) + (regional - 0.5) * regionalBlend) / contrast, 0, 1);
    climate = { ...climate, elevation: mix(climate.elevation, climate.biomeElevation),
      moisture: mix(climate.moisture, climate.biomeMoisture) };
  }
  const fine = field(x * 6.7 + 0.13, y * 5.9 - 0.17, 53) * 0.62
    + field(x * 11.3 - 0.29, y * 9.7 + 0.23, 79) * 0.38;
  const local = (fine - 0.5) * (1 - cohesion) * 1.2;
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

type WaterShapePlane = Pick<Plane, "kind" | "ownershipMode" | "landformStyle" | "wrapX" | "wrapY" | "width" | "height">;

function usesNaturalWaterShapes(plane: WaterShapePlane): boolean {
  return plane.landformStyle === "natural-v1" && resolvePlaneOwnershipMode(plane) === "solid"
    && !ARCHETYPE_PROFILES[plane.kind].caveFamily;
}

/** Broad, periodic bends alter a water body's outline without scattering its cells. */
function waterShapePoint(point: Pick<Province, "x" | "y">, seed: string, strength = 1) {
  const phase = hashString(`${seed}:coast-phase`) / 4_294_967_296 * TAU;
  const phase2 = hashString(`${seed}:coast-phase-2`) / 4_294_967_296 * TAU;
  const amplitude = 0.065 * strength;
  return {
    x: point.x + Math.sin(point.x * TAU) * amplitude
      * (Math.sin(point.y * TAU + phase) * 0.72 + Math.sin(point.y * TAU * 2 + phase2) * 0.28),
    y: point.y + Math.sin(point.y * TAU) * amplitude
      * (Math.sin(point.x * TAU + phase2) * 0.72 + Math.sin(point.x * TAU * 2 + phase) * 0.28),
  };
}

/** One coherent basin with asymmetric bays, rather than radius-sorted circles. */
function naturalBasinScore(plane: WaterShapePlane, seed: string, centerX: number, centerY: number, inland: boolean) {
  const phase = hashString(`${seed}:basin-phase`) / 4_294_967_296 * TAU;
  const rotation = hashString(`${seed}:basin-angle`) / 4_294_967_296 * TAU;
  const stretch = 1.06 + (hashString(`${seed}:basin-stretch`) % 101) / 1000;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return (province: Pick<Province, "x" | "y">) => {
    const point = waterShapePoint(province, seed);
    let dx = point.x - centerX, dy = point.y - centerY;
    if (plane.wrapX) dx -= Math.round(dx);
    if (plane.wrapY) dy -= Math.round(dy);
    const x = (dx * cos + dy * sin) / stretch, y = (-dx * sin + dy * cos) * stretch;
    const angle = Math.atan2(y, x);
    const lobes = 1 + Math.sin(angle * 2 + phase) * 0.09 + Math.sin(angle * 3 - phase * 0.7) * 0.055;
    // Keep ordinary inland-sea quotas enclosed. Extreme quotas may still use
    // the margin when there are too few interior provinces to meet the quota.
    const margin = Math.min(plane.wrapX ? 1 : Math.min(province.x, 1 - province.x),
      plane.wrapY ? 1 : Math.min(province.y, 1 - province.y));
    return Math.hypot(x, y) / lobes + (inland ? Math.max(0, 0.12 - margin) * 8 : 0);
  };
}

function enforceWaterQuota(
  provinces: Province[],
  plane: WaterShapePlane & Pick<Plane, "variant">,
  percent: number,
  seed: string,
  biomeCohesion: number,
  oceanLayout: OceanLayout,
  continentCount: number,
) {
  const { kind, variant } = plane;
  if (!ARCHETYPE_PROFILES[kind].waterCapable) return;
  if (variant === "oceanic") percent = Math.max(percent, 42);
  if (oceanLayout === "island_chains") percent = Math.max(percent, ISLAND_CHAIN_MIN_WATER_PERCENT);
  const target = Math.round((provinces.length * clamp(percent, 0, 60)) / 100);
  if (!target) return;
  const salt = hashString(`${seed}:water`);
  const cohesion = clamp(biomeCohesion / 100, 0, 1);
  const ranked = [...provinces].sort((a, b) => {
    const scoreA = oceanLayoutWaterScore(a, plane, oceanLayout, continentCount, salt, cohesion);
    const scoreB = oceanLayoutWaterScore(b, plane, oceanLayout, continentCount, salt, cohesion);
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

function oceanLayoutWaterScore(
  province: Pick<Province, "x" | "y">,
  plane: WaterShapePlane,
  layout: OceanLayout,
  continentCount: number,
  salt: number,
  cohesion: number,
): number {
  const natural = () => {
    const coarse = field(province.x, province.y, (salt % 43) + 3) * 0.78
      + field(province.x, province.y, (salt % 31) + 11) * 0.22;
    const fine = field(province.x * 7.1 + 0.19, province.y * 8.3 - 0.11, (salt % 47) + 17);
    return coarse * cohesion + fine * (1 - cohesion);
  };
  if (layout === "natural") return natural();

  if (usesNaturalWaterShapes(plane) && layout === "inland_sea") {
    return naturalBasinScore(plane, `${salt}:inland`, 0.5 + ((salt % 17) - 8) / 250,
      0.5 + ((salt % 23) - 11) / 280, true)(province);
  }

  const aspect = plane.height > 0 ? clamp(plane.width / plane.height, 0.35, 3) : 1;
  const distance = (x: number, y: number) => periodicProvinceDistance(province, { x, y }, plane, aspect);
  const jitter = (natural() - 0.5) * (0.1 + (1 - cohesion) * 0.16);
  if (layout === "inland_sea") {
    const centerX = 0.5 + ((salt % 17) - 8) / 250;
    const centerY = 0.5 + ((salt % 23) - 11) / 280;
    let dx = Math.abs(province.x - centerX);
    let dy = Math.abs(province.y - centerY);
    if (plane.wrapX) dx = Math.min(dx, 1 - dx);
    if (plane.wrapY) dy = Math.min(dy, 1 - dy);
    return Math.hypot(dx, dy) + jitter;
  }
  if (layout === "single_continent") {
    if (!plane.wrapX || !plane.wrapY) {
      const edgeX = plane.wrapX ? 0.5 : Math.min(province.x, 1 - province.x);
      const edgeY = plane.wrapY ? 0.5 : Math.min(province.y, 1 - province.y);
      return Math.min(edgeX * aspect, edgeY) + jitter;
    }
    return 1.1 - distance(0.5, 0.5) + jitter;
  }
  if (layout === "multiple_continents") {
    const count = clamp(Math.round(continentCount), 2, 6);
    const along = aspect >= 1
      ? province.x + Math.sin((province.y * 1.7 + (salt % 71) / 71) * TAU) * 0.035
      : province.y + Math.sin((province.x * 1.7 + (salt % 71) / 71) * TAU) * 0.035;
    const withinSector = ((along * count) % 1 + 1) % 1;
    const affinity = 1 - Math.abs(withinSector - 0.5) * 2;
    return affinity + jitter * 0.45;
  }

  // Several sinuous ribbons give island chains substantially more coast than
  // compact continent presets while retaining long, recognizable land routes.
  let chainAffinity = -Infinity;
  const chains = clamp(Math.round(continentCount), 3, 6);
  for (let index = 0; index < chains; index += 1) {
    const phase = (salt % 101) / 101 + index * 0.37;
    const baseline = (index + 0.55) / chains;
    const ribbonY = baseline + Math.sin((province.x * (1.4 + index * 0.11) + phase) * TAU) * (0.035 + 0.01 * (index % 2));
    let dy = Math.abs(province.y - ribbonY);
    if (plane.wrapY) dy = Math.min(dy, 1 - dy);
    const segmented = 0.08 * Math.cos((province.x * (chains + 1) + phase * 1.7) * TAU);
    chainAffinity = Math.max(chainAffinity, 1 - dy * 5 + segmented);
  }
  return chainAffinity + jitter * 0.85;
}

function repairOverlandOceanTopology(
  plane: Plane,
  layout: OceanLayout,
  continentCount: number,
  seed: string,
) {
  if (layout === "natural") return;
  if (!ARCHETYPE_PROFILES[plane.kind].waterCapable || resolvePlaneOwnershipMode(plane) !== "solid") return;
  const target = plane.provinces.filter(isWaterProvince).length;
  if (!target || target >= plane.provinces.length) return;
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const selected = layout === "single_continent"
    ? selectSingleContinentWater(plane, adjacency, target, seed)
    : layout === "multiple_continents"
      ? selectMultipleContinentWater(plane, adjacency, target, continentCount, seed)
      : layout === "island_chains"
        ? selectIslandChainWater(plane, adjacency, target, seed)
        : selectInlandSeaWater(plane, adjacency, target, seed);
  if (!selected || selected.size !== target) return;
  applyOverlandWaterSelection(plane, selected, seed);
}

function selectSingleContinentWater(
  plane: Plane,
  adjacency: Map<string, string[]>,
  target: number,
  seed: string,
): Set<string> | undefined {
  const water = new Set<string>();
  const centerX = 0.5 + ((hashString(`${seed}:single-x`) % 17) - 8) / 500;
  const centerY = 0.5 + ((hashString(`${seed}:single-y`) % 17) - 8) / 500;
  const organic = usesNaturalWaterShapes(plane);
  const basin = organic ? naturalBasinScore(plane, `${seed}:continent`, centerX, centerY, false) : undefined;
  const peripheralScore = (province: Province) => {
    if (basin) return basin(province);
    if (!plane.wrapX || !plane.wrapY) {
      const edgeX = plane.wrapX ? 1 : Math.min(province.x, 1 - province.x);
      const edgeY = plane.wrapY ? 1 : Math.min(province.y, 1 - province.y);
      return -Math.min(edgeX, edgeY);
    }
    return Math.hypot(province.x - centerX, province.y - centerY);
  };
  while (water.size < target) {
    const dry = plane.provinces.filter((province) => !water.has(province.id));
    const frontier = water.size
      ? dry.filter((province) => (adjacency.get(province.id) ?? []).some((id) => water.has(id)))
      : dry;
    const ranked = (organic ? frontier : [...frontier, ...dry.filter((province) => !frontier.includes(province))])
      .sort((a, b) => peripheralScore(b) - peripheralScore(a)
        || (hashString(`${seed}:single-grow:${a.id}`) % 1000) - (hashString(`${seed}:single-grow:${b.id}`) % 1000)
        || a.index - b.index);
    const candidate = ranked.find((province) => provinceComponents(adjacency, plane.provinces, new Set(water).add(province.id)).length === 1);
    if (!candidate) return undefined;
    water.add(candidate.id);
  }
  return water;
}

function gridAxisGroups(plane: Plane, axis: "x" | "y"): Province[][] {
  const groups = new Map<number, Province[]>();
  for (const province of plane.provinces) {
    const key = axis === "x"
      ? province.gridX ?? Math.round(province.x * Math.max(2, Math.sqrt(plane.provinces.length)))
      : province.gridY ?? Math.round(province.y * Math.max(2, Math.sqrt(plane.provinces.length)));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(province);
  }
  return [...groups].sort((left, right) => left[0] - right[0]).map(([, provinces]) => provinces
    .sort((a, b) => (axis === "x" ? a.y - b.y : a.x - b.x) || a.index - b.index));
}

function separatorPatterns(groupCount: number, componentCount: number, wrap: boolean): number[][] {
  const separatorCount = wrap ? componentCount : componentCount - 1;
  if (separatorCount < 1 || groupCount < componentCount * 2 - Number(!wrap)) return [];
  const patterns: number[][] = [];
  const seen = new Set<string>();
  const shifts = wrap
    ? Array.from({ length: groupCount }, (_, index) => index)
    : Array.from({ length: Math.min(groupCount, 7) }, (_, index) => index - Math.floor(Math.min(groupCount, 7) / 2));
  for (const shift of shifts) {
    const positions = Array.from({ length: separatorCount }, (_, index) => {
      if (wrap) return (Math.floor(index * groupCount / componentCount) + shift + groupCount) % groupCount;
      return clamp(Math.round((index + 1) * groupCount / componentCount) + shift, 1, groupCount - 2);
    }).sort((a, b) => a - b);
    if (new Set(positions).size !== positions.length) continue;
    const key = positions.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    patterns.push(positions);
  }
  return patterns;
}

function provinceComponents(
  adjacency: Map<string, string[]>,
  provinces: readonly Province[],
  excluded: ReadonlySet<string>,
): string[][] {
  return graphComponents(adjacency, new Set(provinces.filter((province) => !excluded.has(province.id)).map((province) => province.id)));
}

function fillWaterPreservingContinents(
  plane: Plane,
  adjacency: Map<string, string[]>,
  initial: ReadonlySet<string>,
  target: number,
  componentCount: number,
  seed: string,
): Set<string> | undefined {
  const water = new Set(initial);
  const finalAverage = (plane.provinces.length - target) / componentCount;
  // Coordinate sectors are balanced up front. Keep enough slack for the
  // jagged Voronoi boundary of five- and six-continent layouts while still
  // rejecting token one-province "continents".
  const preferredMinimum = Math.max(3, Math.ceil(finalAverage * 0.62));
  while (water.size < target) {
    const current = provinceComponents(adjacency, plane.provinces, water);
    if (current.length !== componentCount) return undefined;
    const componentById = new Map<string, number>();
    current.forEach((component, index) => component.forEach((id) => componentById.set(id, index)));
    const candidates = plane.provinces.filter((province) => !water.has(province.id)
      && current[componentById.get(province.id)!]!.length > preferredMinimum)
      .sort((a, b) => {
        const componentA = current[componentById.get(a.id)!]!.length;
        const componentB = current[componentById.get(b.id)!]!.length;
        const contactsA = (adjacency.get(a.id) ?? []).filter((id) => water.has(id)).length;
        const contactsB = (adjacency.get(b.id) ?? []).filter((id) => water.has(id)).length;
        const edgeA = (!plane.wrapX ? Math.min(a.x, 1 - a.x) : 1) + (!plane.wrapY ? Math.min(a.y, 1 - a.y) : 1);
        const edgeB = (!plane.wrapX ? Math.min(b.x, 1 - b.x) : 1) + (!plane.wrapY ? Math.min(b.y, 1 - b.y) : 1);
        return componentB - componentA || contactsB - contactsA || edgeA - edgeB
          || (hashString(`${seed}:continent-fill:${a.id}`) % 1000) - (hashString(`${seed}:continent-fill:${b.id}`) % 1000)
          || a.index - b.index;
      });
    let accepted: Province | undefined;
    for (const candidate of candidates) {
      const trial = new Set(water).add(candidate.id);
      const components = provinceComponents(adjacency, plane.provinces, trial);
      if (components.length !== componentCount || components.some((component) => component.length < preferredMinimum)) continue;
      accepted = candidate;
      break;
    }
    if (!accepted) return undefined;
    water.add(accepted.id);
  }
  return water;
}

function selectMultipleContinentWater(
  plane: Plane,
  adjacency: Map<string, string[]>,
  target: number,
  requested: number,
  seed: string,
): Set<string> | undefined {
  const axes: Array<"x" | "y"> = plane.width >= plane.height ? ["x", "y"] : ["y", "x"];
  for (let achieved = Math.min(requested, plane.provinces.length - target); achieved >= 2; achieved -= 1) {
    if (usesNaturalWaterShapes(plane)) {
      const shaped = selectShapedContinentWater(plane, adjacency, target, achieved, seed);
      if (shaped) return shaped;
    }
    if (achieved === 6) {
      for (const [columns, rows] of [[2, 3], [3, 2]] as const) {
        for (const offsetX of [-0.04, 0, 0.04]) {
          for (const offsetY of [-0.04, 0, 0.04]) {
            const initial = topologyGridSectorWater(
              plane,
              adjacency,
              columns,
              rows,
              offsetX,
              offsetY,
              `${seed}:grid-${columns}x${rows}:${offsetX}:${offsetY}`,
            );
            if (!initial || initial.size > target) continue;
            const filled = fillWaterPreservingContinents(
              plane,
              adjacency,
              initial,
              target,
              achieved,
              `${seed}:grid-fill-${columns}x${rows}:${offsetX}:${offsetY}`,
            );
            if (filled) return filled;
          }
        }
      }
    }
    for (const axis of axes) {
      const groups = gridAxisGroups(plane, axis);
      const wrap = axis === "x" ? plane.wrapX : plane.wrapY;
      const offsets = wrap
        ? Array.from({ length: groups.length }, (_, index) => index / groups.length)
        : [-0.08, -0.04, 0, 0.04, 0.08];
      for (const offset of offsets) {
        const initial = topologySectorWater(plane, adjacency, axis, achieved, offset, seed);
        if (!initial || initial.size > target) continue;
        const filled = fillWaterPreservingContinents(plane, adjacency, initial, target, achieved, `${seed}:${axis}:sector:${offset}`);
        if (filled) return filled;
      }
      for (const pattern of separatorPatterns(groups.length, achieved, wrap)) {
        const initial = new Set(pattern.flatMap((index) => groups[index]!.map((province) => province.id)));
        if (initial.size > target) continue;
        const components = provinceComponents(adjacency, plane.provinces, initial);
        if (components.length !== achieved) continue;
        const filled = fillWaterPreservingContinents(plane, adjacency, initial, target, achieved, `${seed}:${axis}:${pattern.join("-")}`);
        if (filled) return filled;
      }
    }
  }
  return undefined;
}

/** Try broad sinuous separators before the unchanged capacity-safe layouts. */
function selectShapedContinentWater(
  plane: Plane,
  adjacency: Map<string, string[]>,
  target: number,
  componentCount: number,
  seed: string,
): Set<string> | undefined {
  const accept = (initial: Set<string> | undefined, suffix: string) => initial && initial.size <= target
    ? fillWaterPreservingContinents(plane, adjacency, initial, target, componentCount, `${seed}:shaped:${suffix}`)
    : undefined;
  if (componentCount === 6) {
    for (const [columns, rows] of [[2, 3], [3, 2]] as const) {
      for (const offset of [0, 0.04, -0.04]) {
        const filled = accept(topologyGridSectorWater(plane, adjacency, columns, rows, offset, -offset,
          `${seed}:shaped-grid`, 0.8), `grid-${columns}-${rows}-${offset}`);
        if (filled) return filled;
      }
    }
  }
  const axes: Array<"x" | "y"> = plane.width >= plane.height ? ["x", "y"] : ["y", "x"];
  for (const axis of axes) {
    for (const offset of [0, 0.04, -0.04, 0.08, -0.08]) {
      const filled = accept(topologySectorWater(plane, adjacency, axis, componentCount, offset,
        `${seed}:shaped-sectors`, 1), `${axis}-${offset}`);
      if (filled) return filled;
    }
  }
  return undefined;
}

function topologySectorWater(
  plane: Plane,
  adjacency: Map<string, string[]>,
  axis: "x" | "y",
  componentCount: number,
  offset: number,
  seed: string,
  shapeStrength = 0,
): Set<string> | undefined {
  const wrap = axis === "x" ? plane.wrapX : plane.wrapY;
  const sectorById = new Map(plane.provinces.map((province) => {
    const point = shapeStrength ? waterShapePoint(province, seed, shapeStrength) : province;
    const raw = (axis === "x" ? point.x : point.y) + offset;
    const coordinate = wrap ? ((raw % 1) + 1) % 1 : clamp(raw, 0, 1 - Number.EPSILON);
    return [province.id, Math.min(componentCount - 1, Math.floor(coordinate * componentCount))];
  }));
  return coverSectorBoundaries(plane, adjacency, sectorById, componentCount, seed);
}

function coverSectorBoundaries(
  plane: Plane,
  adjacency: Map<string, string[]>,
  sectorById: ReadonlyMap<string, number>,
  componentCount: number,
  seed: string,
): Set<string> | undefined {
  const crossEdges: Array<[string, string]> = [];
  for (const [a, neighbours] of adjacency) {
    for (const b of neighbours) {
      if (a >= b || sectorById.get(a) === sectorById.get(b)) continue;
      crossEdges.push([a, b]);
    }
  }
  const uncovered = new Set(crossEdges.map((_, index) => index));
  const water = new Set<string>();
  while (uncovered.size) {
    const coverage = new Map<string, number>();
    for (const index of uncovered) {
      const [a, b] = crossEdges[index]!;
      coverage.set(a, (coverage.get(a) ?? 0) + 1);
      coverage.set(b, (coverage.get(b) ?? 0) + 1);
    }
    const chosen = [...coverage].sort((left, right) => right[1] - left[1]
      || (hashString(`${seed}:sector-cover:${left[0]}`) % 1000) - (hashString(`${seed}:sector-cover:${right[0]}`) % 1000)
      || left[0].localeCompare(right[0]))[0]?.[0];
    if (!chosen) return undefined;
    water.add(chosen);
    for (const index of [...uncovered]) {
      const [a, b] = crossEdges[index]!;
      if (a === chosen || b === chosen) uncovered.delete(index);
    }
  }
  // Greedy maximum-coverage choices can become redundant after a later hub is
  // selected. Remove every such vertex before spending the fixed water quota.
  for (const chosen of [...water].reverse()) {
    const stillCovered = crossEdges.every(([a, b]) => a !== chosen && b !== chosen
      || water.has(a === chosen ? b : a));
    if (stillCovered) water.delete(chosen);
  }

  // A jagged Voronoi boundary can leave a tiny pocket inside one coordinate
  // sector. Absorb every non-major pocket into the separator so each retained
  // sector is one authoritative movement component.
  const components = provinceComponents(adjacency, plane.provinces, water);
  const bySector = new Map<number, string[][]>();
  for (const component of components) {
    const sector = sectorById.get(component[0]!)!;
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push(component);
  }
  if (bySector.size !== componentCount) return undefined;
  for (const sectorComponents of bySector.values()) {
    sectorComponents.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
    for (const pocket of sectorComponents.slice(1)) for (const id of pocket) water.add(id);
  }
  return provinceComponents(adjacency, plane.provinces, water).length === componentCount ? water : undefined;
}

function topologyGridSectorWater(
  plane: Plane,
  adjacency: Map<string, string[]>,
  columns: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  seed: string,
  shapeStrength = 0,
): Set<string> | undefined {
  const normalized = (value: number, wrap: boolean) => wrap
    ? ((value % 1) + 1) % 1
    : clamp(value, 0, 1 - Number.EPSILON);
  const sectorById = new Map(plane.provinces.map((province) => {
    const point = shapeStrength ? waterShapePoint(province, seed, shapeStrength) : province;
    const x = Math.min(columns - 1, Math.floor(normalized(point.x + offsetX, plane.wrapX) * columns));
    const y = Math.min(rows - 1, Math.floor(normalized(point.y + offsetY, plane.wrapY) * rows));
    return [province.id, y * columns + x];
  }));
  return coverSectorBoundaries(plane, adjacency, sectorById, columns * rows, seed);
}

function connectedSelection(
  adjacency: Map<string, string[]>,
  selection: ReadonlySet<string>,
): boolean {
  if (!selection.size) return true;
  const first = selection.values().next().value as string;
  const queue = [first];
  const reached = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbour of adjacency.get(queue[cursor]!) ?? []) {
      if (!selection.has(neighbour) || reached.has(neighbour)) continue;
      reached.add(neighbour);
      queue.push(neighbour);
    }
  }
  return reached.size === selection.size;
}

function selectIslandChainWater(
  plane: Plane,
  adjacency: Map<string, string[]>,
  target: number,
  seed: string,
): Set<string> | undefined {
  const axis: "x" | "y" = plane.width >= plane.height ? "x" : "y";
  if (usesNaturalWaterShapes(plane)) {
    for (const chains of [4, 3]) {
      for (const offset of [0, 0.04, -0.04]) {
        const initial = topologyGridSectorWater(plane, adjacency, axis === "x" ? chains : 2,
          axis === "x" ? 2 : chains, offset, -offset, `${seed}:island-bends`, 1);
        if (!initial || initial.size > target || !connectedSelection(adjacency, initial)) continue;
        const filled = fillIslandChainWater(plane, adjacency, initial, target, seed, true);
        if (filled) return filled;
      }
    }
  }
  const groups = gridAxisGroups(plane, axis);
  const crossGroups = gridAxisGroups(plane, axis === "x" ? "y" : "x");
  const wrap = axis === "x" ? plane.wrapX : plane.wrapY;
  for (let chains = Math.min(4, Math.floor((plane.provinces.length - target) / 3)); chains >= 3; chains -= 1) {
    for (const pattern of separatorPatterns(groups.length, chains, wrap)) {
      for (const crossIndex of [...crossGroups.keys()].sort((a, b) => Math.abs(a - (crossGroups.length - 1) / 2)
        - Math.abs(b - (crossGroups.length - 1) / 2) || a - b)) {
        const initial = new Set([
          ...pattern.flatMap((index) => groups[index]!.map((province) => province.id)),
          ...crossGroups[crossIndex]!.map((province) => province.id),
        ]);
        if (initial.size > target || !connectedSelection(adjacency, initial)) continue;
        const filled = fillIslandChainWater(plane, adjacency, initial, target, seed);
        if (filled) return filled;
      }
    }
  }
  return undefined;
}

function fillIslandChainWater(
  plane: Plane,
  adjacency: Map<string, string[]>,
  initial: ReadonlySet<string>,
  target: number,
  seed: string,
  requireSubstantialIslands = false,
): Set<string> | undefined {
  const initialLand = provinceComponents(adjacency, plane.provinces, initial);
  const initialLandComponents = initialLand.length;
  if (initialLandComponents < 3 || requireSubstantialIslands && initialLand.some(component => component.length < 3)) return undefined;
  const water = new Set(initial);
  while (water.size < target) {
    const land = provinceComponents(adjacency, plane.provinces, water);
    const componentById = new Map<string, number>();
    land.forEach((component, index) => component.forEach((id) => componentById.set(id, index)));
    const candidate = plane.provinces.filter((province) => !water.has(province.id)
      && (adjacency.get(province.id) ?? []).some((id) => water.has(id))
      && land[componentById.get(province.id)!]!.length > 3)
      .sort((a, b) => {
        const sizeA = land[componentById.get(a.id)!]!.length;
        const sizeB = land[componentById.get(b.id)!]!.length;
        const contactsA = (adjacency.get(a.id) ?? []).filter((id) => water.has(id)).length;
        const contactsB = (adjacency.get(b.id) ?? []).filter((id) => water.has(id)).length;
        return sizeB - sizeA || contactsB - contactsA
          || (hashString(`${seed}:island-fill:${a.id}`) % 1000) - (hashString(`${seed}:island-fill:${b.id}`) % 1000)
          || a.index - b.index;
      }).find((province) => {
        const trial = new Set(water).add(province.id);
        const components = provinceComponents(adjacency, plane.provinces, trial);
        return components.length >= initialLandComponents
          && (!requireSubstantialIslands || components.every(component => component.length >= 3));
      });
    if (!candidate) break;
    water.add(candidate.id);
  }
  return water.size === target && connectedSelection(adjacency, water) ? water : undefined;
}

function selectInlandSeaWater(
  plane: Plane,
  adjacency: Map<string, string[]>,
  target: number,
  seed: string,
): Set<string> | undefined {
  const centerX = 0.5 + ((hashString(`${seed}:inland-x`) % 17) - 8) / 400;
  const centerY = 0.5 + ((hashString(`${seed}:inland-y`) % 17) - 8) / 400;
  const distance = usesNaturalWaterShapes(plane)
    ? naturalBasinScore(plane, `${seed}:inland`, centerX, centerY, true)
    : (province: Province) => Math.hypot(province.x - centerX, province.y - centerY);
  const start = [...plane.provinces].sort((a, b) => distance(a) - distance(b) || a.index - b.index)[0];
  if (!start) return undefined;
  const water = new Set<string>([start.id]);
  while (water.size < target) {
    const candidate = plane.provinces.filter((province) => !water.has(province.id)
      && (adjacency.get(province.id) ?? []).some((id) => water.has(id)))
      .sort((a, b) => distance(a) - distance(b)
        || (hashString(`${seed}:inland-grow:${a.id}`) % 1000) - (hashString(`${seed}:inland-grow:${b.id}`) % 1000)
        || a.index - b.index)
      .find((province) => provinceComponents(adjacency, plane.provinces, new Set(water).add(province.id)).length === 1);
    if (!candidate) return undefined;
    water.add(candidate.id);
  }
  return water;
}

function applyOverlandWaterSelection(plane: Plane, selected: ReadonlySet<string>, seed: string) {
  const salt = hashString(`${seed}:topology-water`);
  for (const province of plane.provinces) {
    if (selected.has(province.id)) {
      const depth = field(province.x, province.y, (salt % 17) + 29);
      const kelp = field(province.x, province.y, (salt % 19) + 47);
      province.terrain = depth < 0.23 ? "deepsea" : kelp > 0.69 ? "kelp" : "sea";
      province.terrainFlags = province.terrainFlags?.filter((flag) => flag !== "deep" && flag !== "sea");
      province.biome = province.terrain === "deepsea" ? "deep_ocean" : "archipelago";
      province.noStart = false;
      province.population = Math.round(TERRAIN_POPULATION[province.terrain] * ARCHETYPE_PROFILES[plane.kind].populationScale
        * (0.86 + field(province.x, province.y, 73) * 0.28));
      province.siteBias = siteBiasFor(province.terrain, climateAt(province.x, province.y, salt));
      continue;
    }
    if (!isWaterProvince(province)) continue;
    const dryRoll = field(province.x * 3.7, province.y * 3.1, (salt % 41) + 7);
    province.terrain = dryRoll > 0.78 ? "forest" : dryRoll < 0.16 ? "highland" : dryRoll > 0.62 ? "farm" : "plains";
    province.terrainFlags = province.terrainFlags?.filter((flag) => flag !== "deep" && flag !== "sea");
    province.biome = biomeForTerrain(province.terrain);
    province.noStart = false;
    province.population = Math.round(TERRAIN_POPULATION[province.terrain] * ARCHETYPE_PROFILES[plane.kind].populationScale);
    province.siteBias = siteBiasFor(province.terrain, climateAt(province.x, province.y, salt));
  }
}

function refreshGeneratedBorderKinds(plane: Plane, seed: string) {
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  const rng = new SeededRandom(`${seed}:borders`);
  for (const edge of plane.edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b) continue;
    edge.kind = borderKind(a, b, rng);
    edge.special = undefined;
  }
}

function enforceTerrainVariety(provinces: Province[], kind: PlaneKind, variant: PlaneVariant | undefined, seed: string) {
  const surface: TerrainKey[] = ["plains", "forest", "farm", "swamp", "waste", "highland"];
  const caves: TerrainKey[] = ["cave", "caveforest", "caveswamp", "cavewaste", "cavehighland"];
  const air: TerrainKey[] = ["plains", "forest", "highland", "mountains"];
  const wanted = ARCHETYPE_PROFILES[kind].caveFamily ? caves : kind === "cloud" || kind === "air" ? air : surface;
  if (variant === "oceanic" && !ARCHETYPE_PROFILES[kind].caveFamily) {
    wanted.splice(0, wanted.length, "plains", "forest", "swamp", "highland");
  }
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

const STYX_NAMES = [
  "Styx Reach",
  "Styx Ford",
  "Black Ferry",
  "Memory Shoals",
  "Deadwater Bend",
  "Styx Narrows",
  "The Black Current",
] as const;

function applySubterraneanWaters(plane: Plane, seed: string) {
  if (plane.kind === "underworld") {
    applyRiverStyx(plane, seed);
    return;
  }
  if (plane.kind !== "cave" && plane.kind !== "cavern") return;
  const caveKind = plane.kind;
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  if (active.length < 8) return;
  const waterPreference = plane.generationOverrides?.caveWaterPercent;
  const target = waterPreference === undefined ? clamp(
    Math.round(active.length * (plane.kind === "cavern" ? 0.18 : 0.16)),
    Math.min(2, active.length),
    Math.max(2, active.length - 8),
  ) : clamp(Math.round(active.length * waterPreference / 100), 0, Math.max(0, active.length - 8));
  if (!target) return;
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const byId = new Map(active.map((province) => [province.id, province]));
  const selected = new Set<string>();
  const start = [...active].sort((a, b) => {
    const scoreA = field(a.x, a.y, hashString(`${seed}:cave-water`) % 101);
    const scoreB = field(b.x, b.y, hashString(`${seed}:cave-water`) % 101);
    return scoreA - scoreB || a.index - b.index;
  })[0];
  if (!start) return;
  selected.add(start.id);
  while (selected.size < target) {
    const frontier = new Map<string, Province>();
    for (const id of selected) {
      for (const neighbourId of adjacency.get(id) ?? []) {
        const neighbour = byId.get(neighbourId);
        if (neighbour && !selected.has(neighbourId)) frontier.set(neighbourId, neighbour);
      }
    }
    const next = [...frontier.values()].sort((a, b) => {
      const contactsA = (adjacency.get(a.id) ?? []).filter((id) => selected.has(id)).length;
      const contactsB = (adjacency.get(b.id) ?? []).filter((id) => selected.has(id)).length;
      const scoreA = field(a.x, a.y, hashString(`${seed}:cave-water-grow`) % 103);
      const scoreB = field(b.x, b.y, hashString(`${seed}:cave-water-grow`) % 103);
      return contactsB - contactsA || scoreA - scoreB || a.index - b.index;
    })[0];
    if (!next) break;
    selected.add(next.id);
  }
  [...selected].sort().forEach((id, index) => {
    const province = byId.get(id);
    if (province) floodCaveProvince(province, caveKind, index % 5 === 0);
  });
}

function applyRiverStyx(plane: Plane, seed: string) {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  if (active.length < 8) return;
  const byId = new Map(active.map((province) => [province.id, province]));
  const provisional = plane.edges.map((edge) => ({ ...edge }));
  let styx: ReturnType<typeof planRiverStyx>;
  // Prefer two candidate necks per crossing; fewer necks can leave the banks
  // larger on small planes.
  for (const necksPerCrossing of [2, 1, 0]) {
    const guard = createPassageGuard(plane, new Set());
    if (!guard) break;
    plane.edges = provisional.map((edge) => ({ ...edge }));
    const planned = planRiverStyx(plane, seed, guard, necksPerCrossing);
    if (planned && styxLayoutHolds(plane, planned.water, planned.bankMinimum)) {
      styx = planned;
      break;
    }
  }
  // Very small planes may leave no drawable river with two connected banks.
  // The movement invariants win: keep the original construction there.
  if (!styx) {
    plane.edges = provisional;
    styx = planRiverStyx(plane, seed);
  }
  if (!styx) return;
  [...styx.water].sort((a, b) => byId.get(a)!.index - byId.get(b)!.index).forEach((id, index) => {
    const province = byId.get(id)!;
    floodCaveProvince(province, "underworld", index % 4 === 1);
    // Authored (and legacy unmarked) names survive regeneration.
    if (province.nameSource === "generated") province.name = `${STYX_NAMES[index % STYX_NAMES.length]} ${index + 1}`;
  });
}

function planRiverStyx(
  plane: Plane,
  seed: string,
  guard?: PassageGuard,
  necksPerCrossing = 0,
): { water: Set<string>; bankMinimum: number } | undefined {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const horizontal = plane.width >= plane.height;
  const target = clamp(Math.round(active.length * 0.23), 2, active.length - 4);
  const dryTarget = active.length - target;
  const bankMinimum = Math.max(2, Math.min(Math.floor(dryTarget / 2), Math.floor(dryTarget * 0.34)));
  const along = (province: Province) => horizontal ? province.x : province.y;
  // A drawn river enters and leaves beside its course in the outermost
  // generated column, rather than at whichever corner lies furthest out.
  const column = (province: Province) => horizontal ? province.gridX : province.gridY;
  const outward = guard && active.every((province) => Number.isInteger(column(province))) ? column : along;
  const low = [...active].sort((a, b) => outward(a) - outward(b) || Math.abs(styxSignedDistance(a, horizontal, seed))
    - Math.abs(styxSignedDistance(b, horizontal, seed)) || a.index - b.index)[0];
  const high = [...active].filter((province) => province.id !== low?.id)
    .sort((a, b) => outward(b) - outward(a) || Math.abs(styxSignedDistance(a, horizontal, seed))
      - Math.abs(styxSignedDistance(b, horizontal, seed)) || a.index - b.index)[0];
  if (!low || !high) return undefined;
  const endpointIds = new Set([low.id, high.id]);
  const bySignedDistance = active.filter((province) => !endpointIds.has(province.id)).sort((a, b) => styxSignedDistance(a, horizontal, seed)
    - styxSignedDistance(b, horizontal, seed) || a.index - b.index);
  const reserved = new Set<string>();
  for (const province of bySignedDistance.slice(0, bankMinimum)) reserved.add(province.id);
  for (const province of bySignedDistance.slice(-bankMinimum)) reserved.add(province.id);
  const candidates = active.filter((province) => !reserved.has(province.id));
  const selected = new Set<string>([low.id, high.id]);
  for (const province of [...candidates].sort((a, b) => Math.abs(styxSignedDistance(a, horizontal, seed))
    - Math.abs(styxSignedDistance(b, horizontal, seed))
    || (hashString(`${seed}:styx-band:${a.id}`) % 1000) - (hashString(`${seed}:styx-band:${b.id}`) % 1000)
    || a.index - b.index)) {
    if (selected.size >= target) break;
    selected.add(province.id);
  }
  // Several candidate necks per crossing leave the crossing search a choice.
  if (guard) carveStyxNecks(active, selected, reserved, endpointIds, horizontal, seed, (dryTarget >= 70 ? 2 : 1) * necksPerCrossing);
  enforceStyxBanks(plane, selected, horizontal, seed, guard, reserved);
  return { water: selected, bankMinimum };
}

/**
 * A straight crossing can only be drawn where the river is one province
 * wide. Where the band is thicker, keep just the course province in each
 * evenly spaced crossing column; its former water joins the nearer bank.
 */
function carveStyxNecks(
  active: readonly Province[],
  selected: Set<string>,
  reserved: Set<string>,
  endpointIds: ReadonlySet<string>,
  horizontal: boolean,
  seed: string,
  count: number,
) {
  const column = (province: Province) => horizontal ? province.gridX : province.gridY;
  if (!active.every((province) => Number.isInteger(column(province)))) return;
  const columns = [...new Set(active.map(column))].sort((a, b) => a - b);
  if (columns.length < 5) return;
  const interior = columns.slice(1, -1);
  // Necks narrow the band; they never shrink the river below a fifth of the plane.
  const floor = Math.ceil(active.length * 0.2);
  for (let neck = 0; neck < count; neck += 1) {
    const ideal = columns[0]! + (columns.at(-1)! - columns[0]!) * (neck + 1) / (count + 1);
    const chosen = [...interior].sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b)[0]!;
    const water = active.filter((province) => column(province) === chosen && selected.has(province.id))
      .sort((a, b) => Math.abs(styxSignedDistance(a, horizontal, seed)) - Math.abs(styxSignedDistance(b, horizontal, seed))
        || a.index - b.index);
    for (const province of water.slice(1)) {
      if (endpointIds.has(province.id) || selected.size <= floor) continue;
      selected.delete(province.id);
      reserved.add(province.id);
    }
  }
}

/** The Styx movement contract: one connected river, two dry banks joined only by 1-2 crossings. */
function styxLayoutHolds(plane: Plane, styx: ReadonlySet<string>, bankMinimum: number): boolean {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const connected = (ids: ReadonlySet<string>, include: (edge: Edge) => boolean) => {
    const adjacency = new Map([...ids].map((id) => [id, [] as string[]]));
    for (const edge of plane.edges) {
      if (!include(edge) || isImpassableEdge(edge) || !ids.has(edge.a) || !ids.has(edge.b)) continue;
      adjacency.get(edge.a)!.push(edge.b);
      adjacency.get(edge.b)!.push(edge.a);
    }
    return graphComponents(adjacency, new Set(ids));
  };
  const bridges = plane.edges.filter((edge) => edge.kind === "bridge").length;
  const dry = new Set(active.filter((province) => !styx.has(province.id)).map((province) => province.id));
  const banks = connected(dry, (edge) => edge.kind !== "bridge");
  return bridges >= 1 && bridges <= 2
    && connected(new Set(active.map((province) => province.id)), () => true).length === 1
    && connected(new Set([...styx]), () => true).length === 1
    && banks.length === 2 && banks.every((bank) => bank.length >= bankMinimum);
}

function styxSignedDistance(province: Pick<Province, "x" | "y">, horizontal: boolean, seed: string): number {
  const along = horizontal ? province.x : province.y;
  const orthogonal = horizontal ? province.y : province.x;
  const phase = (hashString(`${seed}:styx-course`) % 997) / 997;
  const center = 0.5 + Math.sin((along * 1.35 + phase) * TAU) * 0.075;
  return orthogonal - center;
}

/** The first unused ID in a scope; generated links may be displaced and re-added during a pass. */
function nextEdgeId(plane: Plane, seed: string, scope: string): string {
  const used = new Set(plane.edges.map((edge) => edge.id));
  for (let index = plane.edges.length; ; index += 1) {
    const id = idFor(seed, scope, index);
    if (!used.has(id)) return id;
  }
}

function enforceStyxBanks(
  plane: Plane,
  styx: Set<string>,
  horizontal: boolean,
  seed: string,
  guard?: PassageGuard,
  reserved: ReadonlySet<string> = new Set(),
) {
  const banks = new Map(plane.provinces.map((province) => [province.id, styxSignedDistance(province, horizontal, seed) < 0 ? 0 : 1]));
  const bank = (province: Province) => banks.get(province.id) ?? 0;
  const dryProvinces = () => plane.provinces.filter((province) => !styx.has(province.id) && !isBlockedProvince(province));
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  const crossBank: Edge[] = [];
  plane.edges = plane.edges.filter((edge) => {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b || styx.has(a.id) || styx.has(b.id) || bank(a) === bank(b)) return true;
    crossBank.push(edge);
    return false;
  });
  // A drawn Styx is continuous before either bank is joined around it.
  if (guard) connectDrawableStyx(plane, styx, reserved, guard, horizontal, seed);

  const joinGroups = () => {
    const dry = dryProvinces();
    for (const group of [
      { nodes: plane.provinces.filter((province) => styx.has(province.id)), scope: "styx-water" },
      { nodes: dry.filter((province) => bank(province) === 0), scope: "styx-bank-0" },
      { nodes: dry.filter((province) => bank(province) === 1), scope: "styx-bank-1" },
    ]) {
      const nodes = group.nodes;
      if (nodes.length < 2) continue;
      const { pairs } = spatialPairs(nodes, plane);
      const position = new Map(nodes.map((province, index) => [province.id, index]));
      const parent = nodes.map((_, index) => index);
      const find = (value: number): number => parent[value] === value ? value : (parent[value] = find(parent[value]!));
      const union = (a: string, b: string) => {
        const left = find(position.get(a)!);
        const right = find(position.get(b)!);
        if (left === right) return false;
        parent[right] = left;
        return true;
      };
      for (const edge of plane.edges) {
        if (position.has(edge.a) && position.has(edge.b)) union(edge.a, edge.b);
      }
      for (const pair of pairs) {
        if (find(position.get(pair.a.id)!) === find(position.get(pair.b.id)!)) continue;
        if (guard && !pairDrawable(guard, pair, plane.edges)) continue;
        union(pair.a.id, pair.b.id);
        plane.edges.push({
          id: nextEdgeId(plane, seed, group.scope),
          a: pair.a.id,
          b: pair.b.id,
          kind: "standard",
        });
      }
    }
  };
  joinGroups();
  if (guard) {
    for (let attempt = 0; attempt < 4 && settleStyxStragglers(plane, styx, banks, guard); attempt += 1) {
      refreshStyxStubs(plane, styx, reserved, guard);
      joinGroups();
    }
  }

  const dry = dryProvinces();
  const crossingLimit = dry.length >= 70 ? 2 : 1;
  // The water set is final from here on, so passages use their exact widths.
  if (guard) guard.planner = createSparsePassagePlanner(plane, (id) => styx.has(id));
  const placed = guard ? placeDrawableStyxCrossings(plane, styx, bank, crossBank, crossingLimit, guard, seed) : 0;
  if (!placed) {
    const stillCrossing = crossBank.filter((edge) => {
      const a = byId.get(edge.a), b = byId.get(edge.b);
      return !!a && !!b && !styx.has(a.id) && !styx.has(b.id) && bank(a) !== bank(b);
    });
    if (!stillCrossing.length) {
      const { pairs } = spatialPairs(dry, plane);
      const fallback = pairs.find((pair) => bank(pair.a) !== bank(pair.b));
      if (fallback) stillCrossing.push({
        id: idFor(seed, "styx-ford", 0),
        a: fallback.a.id,
        b: fallback.b.id,
        kind: "bridge",
      });
    }
    const candidates = stillCrossing.sort((left, right) => {
      const aLeft = byId.get(left.a)!;
      const bLeft = byId.get(left.b)!;
      const aRight = byId.get(right.a)!;
      const bRight = byId.get(right.b)!;
      return periodicProvinceDistance(aLeft, bLeft, plane, plane.width / Math.max(1, plane.height))
        - periodicProvinceDistance(aRight, bRight, plane, plane.width / Math.max(1, plane.height))
        || aLeft.index - aRight.index || bLeft.index - bRight.index;
    });
    for (const edge of candidates.slice(0, crossingLimit)) {
      plane.edges.push({ ...edge, kind: "bridge", special: undefined });
    }
  }
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const allAdjacency = adjacencyFor(plane, { traversableOnly: true });
  if (active.length && shortestDistances(allAdjacency, active[0]!.id).size !== active.length) {
    const { pairs } = spatialPairs(active, plane);
    for (const pair of pairs) {
      if (plane.edges.some((edge) => connectionKey(edge.a, edge.b) === pair.key)) continue;
      if (!styx.has(pair.a.id) && !styx.has(pair.b.id)) continue;
      if (guard && !pairDrawable(guard, pair, plane.edges)) continue;
      plane.edges.push({ id: nextEdgeId(plane, seed, "styx-bank-link"), a: pair.a.id, b: pair.b.id, kind: "standard" });
      const repaired = adjacencyFor(plane, { traversableOnly: true });
      if (shortestDistances(repaired, active[0]!.id).size === active.length) break;
    }
  }
  pruneStyxCycles(plane, styx, horizontal, seed, 0.28, bank, guard?.protectedKeys);
  repairStyxLeaves(plane, styx, horizontal, seed, bank, guard);
  plane.edges.sort((left, right) => {
    const aLeft = byId.get(left.a)?.index ?? Infinity;
    const aRight = byId.get(right.a)?.index ?? Infinity;
    const bLeft = byId.get(left.b)?.index ?? Infinity;
    const bRight = byId.get(right.b)?.index ?? Infinity;
    return Math.min(aLeft, bLeft) - Math.min(aRight, bRight) || Math.max(aLeft, bLeft) - Math.max(aRight, bRight);
  });
}

/**
 * Connects the planned Styx with drawable water links. A water link takes
 * precedence over provisional dry links it would touch; the banks are joined
 * around it afterwards. Water that cannot be reached without passing an
 * unrelated chamber floods the cheapest drawable path near the course.
 */
function connectDrawableStyx(
  plane: Plane,
  styx: Set<string>,
  reserved: ReadonlySet<string>,
  guard: PassageGuard,
  horizontal: boolean,
  seed: string,
) {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const { pairs: activePairs, spacing } = spatialPairs(active, plane);
  const nearPairs = activePairs.filter((pair) => pair.distance <= spacing * 2.4 + 1e-9);
  const isWaterLink = (edge: Edge) => styx.has(edge.a) && styx.has(edge.b);
  for (let round = 0; round < active.length; round += 1) {
    refreshStyxStubs(plane, styx, reserved, guard);
    const water = active.filter((province) => styx.has(province.id));
    if (water.length < 2) return;
    const position = new Map(water.map((province, index) => [province.id, index]));
    const parent = water.map((_, index) => index);
    const find = (value: number): number => parent[value] === value ? value : (parent[value] = find(parent[value]!));
    for (const edge of plane.edges) {
      if (position.has(edge.a) && position.has(edge.b)) parent[find(position.get(edge.b)!)] = find(position.get(edge.a)!);
    }
    for (const pair of spatialPairs(water, plane).pairs) {
      const left = find(position.get(pair.a.id)!), right = find(position.get(pair.b.id)!);
      if (left === right || !passageDrawable(guard, pair.a.id, pair.b.id, plane.edges.filter(isWaterLink))) continue;
      const passage = { a: pair.a.id, b: pair.b.id };
      plane.edges = plane.edges.filter((edge) => isWaterLink(edge) || guard.planner.compatible(passage, edge));
      plane.edges.push({ id: nextEdgeId(plane, seed, "styx-water"), a: pair.a.id, b: pair.b.id, kind: "standard" });
      parent[right] = left;
    }
    const components = new Map<number, string[]>();
    for (const province of water) {
      const root = find(position.get(province.id)!);
      components.set(root, [...(components.get(root) ?? []), province.id]);
    }
    if (components.size <= 1) return;
    const source = new Set([...components.values()].sort((a, b) => b.length - a.length
      || Math.min(...a.map((id) => position.get(id)!)) - Math.min(...b.map((id) => position.get(id)!)))[0]);
    const preferred = styxFloodPath(plane, styx, reserved, guard, nearPairs, source, spacing, horizontal, seed);
    // Reserved bank provinces are a last resort; the layout check still keeps each bank large enough.
    const path = preferred.length ? preferred
      : styxFloodPath(plane, styx, new Set(), guard, nearPairs, source, spacing, horizontal, seed);
    if (!path.length) return;
    for (const id of path) styx.add(id);
  }
}

/** Dry provinces on the cheapest drawable route from one water body to another, preferring the course. */
function styxFloodPath(
  plane: Plane,
  styx: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
  guard: PassageGuard,
  nearPairs: readonly SpatialPair[],
  source: ReadonlySet<string>,
  spacing: number,
  horizontal: boolean,
  seed: string,
): string[] {
  const waterLinks = plane.edges.filter((edge) => styx.has(edge.a) && styx.has(edge.b));
  const neighbours = new Map<string, Array<{ id: string; distance: number }>>();
  for (const pair of nearPairs) {
    for (const [from, to] of [[pair.a, pair.b], [pair.b, pair.a]] as const) {
      const list = neighbours.get(from.id) ?? [];
      list.push({ id: to.id, distance: pair.distance });
      neighbours.set(from.id, list);
    }
  }
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  const distance = new Map<string, number>([...source].map((id) => [id, 0]));
  const previous = new Map<string, string>();
  const settled = new Set<string>();
  while (true) {
    let current: string | undefined;
    for (const [id, value] of distance) {
      if (settled.has(id)) continue;
      if (current === undefined || value < distance.get(current)! - 1e-12
        || (Math.abs(value - distance.get(current)!) <= 1e-12 && byId.get(id)!.index < byId.get(current)!.index)) current = id;
    }
    if (current === undefined) return [];
    settled.add(current);
    // Other water is a destination, never a stepping stone.
    if (styx.has(current) && !source.has(current)) {
      const path: string[] = [];
      for (let step = previous.get(current); step !== undefined && !source.has(step); step = previous.get(step)) path.push(step);
      return path;
    }
    for (const next of neighbours.get(current) ?? []) {
      if (settled.has(next.id) || source.has(next.id) || reserved.has(next.id)) continue;
      const province = byId.get(next.id)!;
      if (isBlockedProvince(province) || !passageDrawable(guard, current, next.id, waterLinks)) continue;
      const floodCost = styx.has(next.id) ? 0 : spacing * (1 + 6 * Math.abs(styxSignedDistance(province, horizontal, seed)));
      const value = distance.get(current)! + next.distance + floodCost;
      if (value < (distance.get(next.id) ?? Infinity) - 1e-12) {
        distance.set(next.id, value);
        previous.set(next.id, current);
      }
    }
  }
}

/**
 * Stubs carry the Styx from its outermost water to the map edges. A dry
 * chamber in a stub's way joins the river; dry links across a stub yield.
 */
function refreshStyxStubs(plane: Plane, styx: Set<string>, reserved: ReadonlySet<string>, guard: PassageGuard) {
  for (let round = 0; round < plane.provinces.length; round += 1) {
    guard.stubs = styxStubPassages(plane, styx);
    const blocked = guard.stubs.flatMap((stub) => guard.planner.blockers(stub))
      .filter((id) => !styx.has(id) && !reserved.has(id));
    if (!blocked.length) break;
    for (const id of blocked) styx.add(id);
  }
  plane.edges = plane.edges.filter((edge) => (styx.has(edge.a) && styx.has(edge.b))
    || guard.stubs.every((stub) => guard.planner.compatible(edge, stub)));
}

/**
 * A dry group that cannot reach the rest of its bank without crossing the
 * drawn river lies on the other side of it: it joins that bank, or, when
 * enclosed by water, becomes part of the river. The final layout check
 * still enforces the minimum bank sizes.
 */
function settleStyxStragglers(
  plane: Plane,
  styx: Set<string>,
  banks: Map<string, number>,
  guard: PassageGuard,
): boolean {
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  const dry = plane.provinces.filter((province) => !styx.has(province.id) && !isBlockedProvince(province));
  // Decide from one snapshot, so a group moved this round is joined before it is reconsidered.
  const initial = new Map(banks);
  let changed = false;
  for (const side of [0, 1]) {
    const nodes = dry.filter((province) => initial.get(province.id) === side);
    const ids = new Set(nodes.map((province) => province.id));
    const adjacency = new Map(nodes.map((province) => [province.id, [] as string[]]));
    for (const edge of plane.edges) {
      if (edge.kind === "bridge" || !ids.has(edge.a) || !ids.has(edge.b)) continue;
      adjacency.get(edge.a)!.push(edge.b);
      adjacency.get(edge.b)!.push(edge.a);
    }
    const components = graphComponents(adjacency, ids);
    for (const component of components.slice(1)) {
      const members = new Set(component);
      const reaches = (targets: readonly Province[]) => spatialPairs([...component.map((id) => byId.get(id)!), ...targets], plane).pairs
        .some((pair) => members.has(pair.a.id) !== members.has(pair.b.id) && pairDrawable(guard, pair, plane.edges));
      const opposite = dry.filter((province) => initial.get(province.id) === 1 - side);
      if (reaches(opposite)) {
        for (const id of component) banks.set(id, 1 - side);
        changed = true;
      } else if (reaches(plane.provinces.filter((province) => styx.has(province.id)))) {
        for (const id of component) styx.add(id);
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Explicit Styx crossings are drawn over the river, so each one touches the
 * water it crosses. A crossing is accepted only when it touches nothing but
 * Styx water, and each touched water province is linked to the bank it meets
 * (a ford link that keeps its own contact with that bank).
 */
function placeDrawableStyxCrossings(
  plane: Plane,
  styx: ReadonlySet<string>,
  bank: (province: Province) => number,
  crossBank: readonly Edge[],
  limit: number,
  guard: PassageGuard,
  seed: string,
): number {
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  const aspect = plane.width / Math.max(1, plane.height);
  const dry = plane.provinces.filter((province) => !styx.has(province.id) && !isBlockedProvince(province));
  const crossing = (a: Province | undefined, b: Province | undefined): a is Province => !!a && !!b
    && !styx.has(a.id) && !styx.has(b.id) && !isBlockedProvince(a) && !isBlockedProvince(b) && bank(a) !== bank(b);
  const { pairs, spacing } = spatialPairs(dry, plane);
  const candidates: Array<{ a: Province; b: Province; source?: Edge }> = [
    ...crossBank.flatMap((edge) => {
      const a = byId.get(edge.a), b = byId.get(edge.b);
      return crossing(a, b) ? [{ a, b: b!, source: edge }] : [];
    }).sort((left, right) => periodicProvinceDistance(left.a, left.b, plane, aspect) - periodicProvinceDistance(right.a, right.b, plane, aspect)
      || left.a.index - right.a.index || left.b.index - right.b.index),
    ...pairs.filter((pair) => crossing(pair.a, pair.b) && pair.distance <= spacing * 4 + 1e-9)
      .map((pair) => ({ a: pair.a, b: pair.b })),
  ];
  let placed = 0;
  // Very small planes may offer no crossing that clears every Styx centre.
  // Only then may a crossing pass over one; that province's chamber is split
  // across the crossing and meets both banks, so both get a ford link.
  for (const coverCentres of [false, true]) {
    if (placed) break;
    const tried = new Set<string>();
    for (const candidate of candidates) {
      if (placed >= limit) break;
      const key = connectionKey(candidate.a.id, candidate.b.id);
      if (tried.has(key)) continue;
      tried.add(key);
      const contacts = guard.planner.bridgeContacts(candidate.a.id, candidate.b.id, [...plane.edges, ...guard.stubs], { coverCentres });
      if (!contacts || contacts.some((contact) => !styx.has(contact.owner))) continue;
      const existing = new Set(plane.edges.map((edge) => connectionKey(edge.a, edge.b)));
      const contactKeys = contacts.map((contact) => connectionKey(contact.endpoint, contact.owner));
      const exempt = new Set([key, ...contactKeys]);
      const planned: LinkLike[] = [...plane.edges, { a: candidate.a.id, b: candidate.b.id }];
      const fords = contacts.filter((contact) => !existing.has(connectionKey(contact.endpoint, contact.owner)));
      const drawable = fords.every((ford) => {
        if ((!ford.covered && !guard.planner.fordMeetsBank(ford.endpoint, ford.owner, [candidate.a.id, candidate.b.id]))
          || !passageDrawable(guard, ford.endpoint, ford.owner, planned, exempt)) return false;
        planned.push({ a: ford.endpoint, b: ford.owner });
        return true;
      });
      if (!drawable) continue;
      plane.edges.push(candidate.source
        ? { ...candidate.source, kind: "bridge", special: undefined }
        : { id: nextEdgeId(plane, seed, "styx-ford"), a: candidate.a.id, b: candidate.b.id, kind: "bridge" });
      for (const ford of fords) {
        plane.edges.push({ id: nextEdgeId(plane, seed, "styx-ford-bank"), a: ford.endpoint, b: ford.owner, kind: "standard" });
      }
      for (const protectedKey of exempt) guard.protectedKeys.add(protectedKey);
      placed += 1;
    }
  }
  return placed;
}

function repairStyxLeaves(
  plane: Plane,
  styx: ReadonlySet<string>,
  horizontal: boolean,
  seed: string,
  bank: (province: Province) => number = (province) => styxSignedDistance(province, horizontal, seed) < 0 ? 0 : 1,
  guard?: PassageGuard,
) {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const limit = active.length < 24 ? 2 : Math.floor(active.length * 0.12);
  const group = (province: Province) => styx.has(province.id) ? 2 : bank(province);
  const { pairs } = spatialPairs(active, plane);
  while (true) {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const leaves = active.filter((province) => (adjacency.get(province.id)?.length ?? 0) <= 1);
    if (leaves.length <= limit) return;
    const leafIds = new Set(leaves.map((province) => province.id));
    const existing = new Set(plane.edges.map((edge) => connectionKey(edge.a, edge.b)));
    const candidate = pairs.find((pair) => !existing.has(pair.key)
      && group(pair.a) === group(pair.b)
      && (leafIds.has(pair.a.id) || leafIds.has(pair.b.id))
      && (adjacency.get(pair.a.id)?.length ?? 0) < 5
      && (adjacency.get(pair.b.id)?.length ?? 0) < 5
      && (!guard || pairDrawable(guard, pair, plane.edges)));
    if (!candidate) return;
    plane.edges.push({
      id: nextEdgeId(plane, seed, "styx-leaf-loop"),
      a: candidate.a.id,
      b: candidate.b.id,
      kind: "standard",
    });
  }
}

function pruneStyxCycles(
  plane: Plane,
  styx: ReadonlySet<string>,
  horizontal: boolean,
  seed: string,
  targetRatio: number,
  bank: (province: Province) => number = (province) => styxSignedDistance(province, horizontal, seed) < 0 ? 0 : 1,
  protectedKeys: ReadonlySet<string> = new Set(),
) {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const maximumEdges = Math.max(active.length - 1, active.length - 1 + Math.floor(active.length * targetRatio));
  const connected = (ids: Set<string>, edges: readonly Edge[]) => {
    if (ids.size < 2) return true;
    const adjacency = new Map([...ids].map((id) => [id, [] as string[]]));
    for (const edge of edges) {
      if (!ids.has(edge.a) || !ids.has(edge.b) || isImpassableEdge(edge)) continue;
      adjacency.get(edge.a)!.push(edge.b);
      adjacency.get(edge.b)!.push(edge.a);
    }
    return shortestDistances(adjacency, ids.values().next().value as string).size === ids.size;
  };
  const allIds = new Set(active.map((province) => province.id));
  const waterIds = new Set([...styx]);
  const bankIds = [0, 1].map((index) => new Set(active
    .filter((province) => !styx.has(province.id) && bank(province) === index)
    .map((province) => province.id)));
  while (plane.edges.length > maximumEdges) {
    let removed = false;
    // Crossings and the links they rely on for their drawn contacts stay.
    const order = plane.edges.map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.kind !== "bridge" && !protectedKeys.has(connectionKey(edge.a, edge.b)))
      .sort((left, right) => {
        const leftMixed = Number(styx.has(left.edge.a) !== styx.has(left.edge.b));
        const rightMixed = Number(styx.has(right.edge.a) !== styx.has(right.edge.b));
        return rightMixed - leftMixed || right.index - left.index;
      });
    for (const { index } of order) {
      const trial = plane.edges.filter((_, edgeIndex) => edgeIndex !== index);
      if (!connected(allIds, trial) || !connected(waterIds, trial)) continue;
      if (!bankIds.every((ids) => connected(ids, trial.filter((edge) => edge.kind !== "bridge")))) continue;
      plane.edges = trial;
      removed = true;
      break;
    }
    if (!removed) break;
  }
}
function graphComponents(adjacency: Map<string, string[]>, allowed: Set<string>): string[][] {
  const components: string[][] = [];
  const unseen = new Set(allowed);
  while (unseen.size) {
    const first = unseen.values().next().value as string;
    const component = [first];
    unseen.delete(first);
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      for (const neighbour of adjacency.get(component[cursor]!) ?? []) {
        if (!unseen.has(neighbour)) continue;
        unseen.delete(neighbour);
        component.push(neighbour);
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.length - a.length);
}

function floodCaveProvince(province: Province, kind: "cave" | "cavern" | "underworld", deep: boolean) {
  const flags = new Set(province.terrainFlags ?? []);
  flags.add("sea");
  if (deep) flags.add("deep");
  else flags.delete("deep");
  province.terrainFlags = [...flags];
  province.noStart = false;
  province.biome = deep ? "deep_ocean" : kind === "underworld" ? "void_reaches" : "living_caves";
  province.population = Math.round((deep ? TERRAIN_POPULATION.deepsea : TERRAIN_POPULATION.sea) * ARCHETYPE_PROFILES[kind].populationScale);
  province.siteBias = kind === "underworld" ? ["death", "water", "earth"] : ["water", "earth", "glamour"];
}

/** Generate only thematic content for existing geography; callers choose which fields to copy. */
export function rerollPlaneDetails(plane: Plane, seed: string, sourceProject?: MapProject): Plane {
  const next = structuredClone(plane);
  const profile = ARCHETYPE_PROFILES[plane.kind];
  for (const province of next.provinces) {
    if (isBlockedProvince(province)) continue;
    const rng = new SeededRandom(`${seed}:content:${province.id}`);
    const base = isWaterProvince(province) ? TERRAIN_POPULATION.sea : TERRAIN_POPULATION[province.terrain];
    province.population = Math.min(50000, Math.max(100, Math.round(base * profile.populationScale * (0.83 + rng.next() * 0.34) / 10) * 10));
    province.manySites = rng.chance(profile.manySitesChance);
  }
  assignArchetypeDetails(next.provinces, next.kind, next.variant, seed);
  if (sourceProject) applyPlaneContentPreferences({ ...sourceProject, seed }, next, (province, guardianSeed) =>
    guardianFor(next.kind, next.variant ?? profile.defaultVariant, province, new SeededRandom(guardianSeed), guardianSeed));
  return next;
}

function assignArchetypeDetails(provinces: Province[], kind: PlaneKind, variant: PlaneVariant | undefined, seed: string) {
  const profile = ARCHETYPE_PROFILES[kind];
  const activeVariant = variant ?? profile.defaultVariant;
  const thematicSitePaths = kind === "custom" ? CUSTOM_VARIANT_SITE_PATHS[activeVariant] ?? profile.sitePaths : profile.sitePaths;
  for (const province of provinces) {
    if (isBlockedProvince(province) || province.population === undefined) {
      province.poptype = undefined;
      province.defenders = [];
      continue;
    }
    const rng = new SeededRandom(`${seed}:details:${province.id}`);
    const poptypes = poptypesForProvince(province, kind, activeVariant, profile);
    province.poptype = rng.pick(poptypes);
    province.siteBias = mergePaths(province.siteBias, [...thematicSitePaths], 3);
    if (province.freshwater && !province.siteBias.includes("water")) {
      province.siteBias = [...province.siteBias.slice(0, 2), "water"];
    }
    const guardianChance = usesHardSpecialGuardians(kind, activeVariant)
      ? 0.26
      : 0.045 + profile.manySitesChance * 0.28;
    province.defenders = rng.chance(guardianChance)
      ? [guardianFor(kind, activeVariant, province, rng, `${seed}:${province.id}`)]
      : [];
  }
}

function poptypesForProvince(
  province: Province,
  kind: PlaneKind,
  variant: PlaneVariant,
  profile: ArchetypeProfile,
): readonly number[] {
  if (isWaterProvince(province)) {
    const theme = guardianThemeFor(kind, variant, province);
    return THEMED_AQUATIC_POPTYPE_POOLS[theme] ?? AQUATIC_POPTYPE_POOL;
  }
  if (kind === "custom") return VARIANT_POPTYPE_POOLS[variant] ?? profile.poptypes;
  if (kind === "elemental") return VARIANT_POPTYPE_POOLS[variant] ?? profile.poptypes;
  return profile.poptypes;
}

function guardianThemeFor(kind: PlaneKind, variant: PlaneVariant, province: Province): GuardianTheme {
  if (isWaterProvince(province)) {
    if (kind === "underworld") return "underworld";
    if (kind === "cave" || kind === "cavern") return "cave_water";
    if (kind === "dream") return "dream_water";
    if (kind === "elemental") return "elemental_water";
    if (kind === "hell") return "hell_water";
    if (kind === "abyss") return "abyss_water";
    if (kind === "custom") {
      if (variant === "wild") return "dream_water";
      if (variant === "volcanic" || variant === "frozen") return "elemental_water";
      if (variant === "storm") return "storm_water";
      if (variant === "infernal") return "hell_water";
      if (variant === "void") return "abyss_water";
      if (variant === "fungal" || variant === "crystal") return "cave_water";
    }
    return "water";
  }
  if (kind !== "custom") return kind;
  if (variant === "infernal") return "hell";
  if (variant === "void") return "abyss";
  if (variant === "storm") return "air";
  if (variant === "wild") return "dream";
  if (variant === "volcanic") return "elemental";
  if (variant === "fungal" || variant === "crystal") return "cavern";
  return "custom";
}

function usesHardSpecialGuardians(kind: PlaneKind, variant: PlaneVariant): boolean {
  if (["cloud", "air", "underworld", "hell", "abyss", "dream", "elemental"].includes(kind)) return true;
  if (kind === "custom") return variant !== "temperate" && variant !== "frozen" && variant !== "arid";
  return kind === "surface" && variant === "oceanic";
}

function guardianFor(
  kind: PlaneKind,
  variant: PlaneVariant,
  province: Province,
  rng: SeededRandom,
  seed: string,
): Province["defenders"][number] {
  const theme = guardianThemeFor(kind, variant, province);
  const pool = GUARDIAN_CATALOG_POOLS[theme];
  const elementalTemplates = [
    { commander: "98", units: ["3719"] as readonly string[] },
    { commander: "92", units: ["3727"] as readonly string[] },
    { commander: "103", units: ["3735"] as readonly string[] },
    { commander: "1893", units: ["3743"] as readonly string[] },
  ];
  const templates: ReadonlyArray<{ commander: string; units: readonly string[] }> = theme === "elemental"
    ? elementalTemplates
    : pool.commanders.map((commander) => ({ commander, units: pool.units }));
  const template = rng.pick(templates);
  const hard = usesHardSpecialGuardians(kind, variant);
  const squadCount = hard ? 2 : 1;
  return {
    commander: template.commander,
    squads: Array.from({ length: squadCount }, (_, index) => ({
      id: idFor(seed, "guardian", index),
      unit: rng.pick(template.units),
      count: hard ? rng.int(14, 24) : rng.int(8, 18),
    })),
    experience: hard ? rng.int(1, 3) : rng.chance(0.18) ? rng.int(1, 2) : undefined,
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

interface SpatialPair {
  a: Province;
  b: Province;
  key: string;
  distance: number;
}

function buildEdges(
  provinces: Province[],
  plane: Plane,
  seed: string,
  settings: GenerationSettings,
  startCapacity: number,
): Edge[] {
  const generated = { ...plane, provinces, edges: [] };
  if (resolvePlaneOwnershipMode(generated) === "solid") {
    return synchronizePlaneEdges(generated, seed, false).edges;
  }
  return buildSparseEdges(provinces, generated, seed, settings, startCapacity);
}

function buildSparseEdges(
  provinces: Province[],
  plane: Plane,
  seed: string,
  settings: GenerationSettings,
  startCapacity: number,
): Edge[] {
  const active = provinces.filter((province) => !isBlockedProvince(province)).sort((a, b) => a.index - b.index);
  if (active.length < 2) return [];
  const regions = usesConnectedRegions(plane)
    ? buildConnectedRegionPlan({ ...plane, provinces }) : undefined;
  const regionContacts = regions ? new Set(regions.voronoiPairs.map(pair => pair.key)) : undefined;
  const { pairs: allPairs, spacing } = spatialPairs(active, plane);
  const pairs = regionContacts ? allPairs.filter(pair => regionContacts.has(pair.key)) : allPairs;
  const localPairs = pairs.filter((pair) => pair.distance <= spacing * 2.4 + 1e-9);
  const guard = regions ? undefined : createPassageGuard(plane, new Set());
  const selected = new Map<string, SpatialPair>();
  const degrees = new Map(active.map((province) => [province.id, 0]));
  const addPair = (pair: SpatialPair | undefined) => {
    if (!pair || selected.has(pair.key)) return false;
    selected.set(pair.key, pair);
    degrees.set(pair.a.id, (degrees.get(pair.a.id) ?? 0) + 1);
    degrees.set(pair.b.id, (degrees.get(pair.b.id) ?? 0) + 1);
    return true;
  };
  const profile = sparseGraphProfileFor(plane);
  const requestedDegree = Math.round(settings.startDegreeTarget ?? 4);
  // Regional provinces can only join genuine local contacts. Do not consume
  // a tightly packed start field trying to create eight-way hubs that the
  // later distance-three basin pass must immediately undo.
  const packedDegree = regions && startCapacity > 0
    ? Math.max(Math.min(requestedDegree, 4), Math.floor(active.length / (startCapacity * 2)))
    : requestedDegree;
  const commonStartDegree = clamp(Math.min(requestedDegree, packedDegree), 1, Math.max(1, active.length - 1));

  if (regions) {
    // The region silhouette tiles neighboring members into a shared
    // mass. Declare those actual local contacts in the generated movement
    // graph; preview/export must never invent connections for saved maps.
    // Use this generation's province array, not any previous source layout.
    const pairByKey = new Map(pairs.map(pair => [pair.key, pair]));
    for (const pair of regions.treePairs) {
      const a = provinces[pair.a], b = provinces[pair.b];
      if (a && b) addPair(pairByKey.get(connectionKey(a.id, b.id)));
    }
    for (const pair of regions.regionPairs) addPair(pairByKey.get(pair.key));
  } else {
    buildChamberGraph(active, pairs, localPairs, selected, degrees, addPair, UNDERWORLD_GRAPH_PROFILE, spacing, guard);
  }

  addSparseStartHubs(
    active,
    pairs,
    localPairs,
    selected,
    degrees,
    addPair,
    plane,
    Math.max(0, Math.round(startCapacity)),
    commonStartDegree,
    profile.ordinaryMaxDegree,
    spacing,
    undefined,
    undefined,
    seed,
    guard,
  );

  return [...selected.values()]
    .sort((left, right) => left.a.index - right.a.index || left.b.index - right.b.index)
    .map((pair, index) => ({
      id: idFor(seed, "edge", index),
      a: pair.a.id,
      b: pair.b.id,
      // Sparse movement corridors are deliberately reliable. Terrain-specific
      // blocking borders can still be authored after generation, but the
      // generated route itself must remain connected and capital-safe.
      kind: "standard",
    }));
}

function spatialPairs(active: readonly Province[], plane: Pick<Plane, "width" | "height" | "wrapX" | "wrapY">) {
  const aspect = plane.height > 0 && Number.isFinite(plane.width / plane.height)
    ? clamp(plane.width / plane.height, 0.08, 12)
    : 1;
  const nearest = new Map(active.map((province) => [province.id, Infinity]));
  const pairs: SpatialPair[] = [];
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      const a = active[left]!;
      const b = active[right]!;
      const distance = periodicProvinceDistance(a, b, plane, aspect);
      pairs.push({ a, b, key: connectionKey(a.id, b.id), distance });
      nearest.set(a.id, Math.min(nearest.get(a.id)!, distance));
      nearest.set(b.id, Math.min(nearest.get(b.id)!, distance));
    }
  }
  pairs.sort((left, right) => left.distance - right.distance
    || left.a.index - right.a.index || left.b.index - right.b.index);
  const nearestValues = [...nearest.values()].filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(nearestValues.length / 2);
  const spacing = nearestValues.length % 2
    ? nearestValues[middle]!
    : ((nearestValues[middle - 1] ?? nearestValues[middle] ?? 1) + (nearestValues[middle] ?? 1)) / 2;
  return { pairs, spacing: Math.max(1e-6, spacing), aspect };
}

function periodicProvinceDistance(
  a: Pick<Province, "x" | "y">,
  b: Pick<Province, "x" | "y">,
  plane: Pick<Plane, "wrapX" | "wrapY">,
  aspect: number,
): number {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (plane.wrapX) dx = Math.min(dx, 1 - dx);
  if (plane.wrapY) dy = Math.min(dy, 1 - dy);
  return Math.hypot(dx * aspect, dy);
}

/**
 * Generated Underworld links are drawn as straight chamber-to-chamber
 * corridors. Accepting only drawable pairs keeps the native raster's shared
 * borders identical to the movement graph: a passage never runs through an
 * unrelated chamber, and two passages never meet as an unlinked pair.
 */
interface PassageGuard {
  planner: SparsePassagePlanner;
  /** Styx stubs of the current water set, each owned by one province. */
  stubs: SparsePassage[];
  /** Links that exempt a neighbouring pair's far ends; never pruned. */
  readonly protectedKeys: Set<string>;
}

type LinkLike = { a: string | Province; b: string | Province };

function createPassageGuard(plane: Plane, plannedWater?: ReadonlySet<string>): PassageGuard | undefined {
  if (plane.kind !== "underworld" || resolvePlaneOwnershipMode(plane) !== "sparse") return undefined;
  // Planned water can still grow, so every corridor keeps the widest Styx
  // width until the river is final; a finished plane uses exact widths.
  const water = plannedWater ?? new Set(plane.provinces.filter(isWaterProvince).map((province) => province.id));
  return {
    planner: createSparsePassagePlanner(plane, plannedWater ? undefined : (id) => water.has(id)),
    stubs: styxStubPassages(plane, water),
    protectedKeys: new Set(),
  };
}

/** Conservative mirror of the ownership model's Styx edge stubs for a planned water set. */
function styxStubPassages(plane: Plane, water: ReadonlySet<string>): SparsePassage[] {
  const axis = plane.width >= plane.height ? "x" : "y";
  if ((axis === "x" && plane.wrapX) || (axis === "y" && plane.wrapY)) return [];
  const nodes = plane.provinces.filter((province) => water.has(province.id));
  if (nodes.length < 2) return [];
  const coordinate = (province: Province) => axis === "x" ? province.x : province.y;
  const low = [...nodes].sort((a, b) => coordinate(a) - coordinate(b) || a.index - b.index)[0]!;
  const high = [...nodes].sort((a, b) => coordinate(b) - coordinate(a) || a.index - b.index)[0]!;
  if (low.id === high.id) return [];
  return [{ a: low.id, boundary: { axis, side: "low" } }, { a: high.id, boundary: { axis, side: "high" } }];
}

function linkIds(link: LinkLike): [string, string] {
  return [typeof link.a === "string" ? link.a : link.a.id, typeof link.b === "string" ? link.b : link.b.id];
}

function passageDrawable(
  guard: PassageGuard,
  a: string,
  b: string,
  links: Iterable<LinkLike>,
  extraProtected?: ReadonlySet<string>,
): boolean {
  if (!guard.planner.clear({ a, b })) return false;
  const key = connectionKey(a, b);
  const linked = (p: string, q: string) => guard.protectedKeys.has(connectionKey(p, q))
    || !!extraProtected?.has(connectionKey(p, q));
  for (const link of links) {
    const [la, lb] = linkIds(link);
    if (connectionKey(la, lb) === key) continue;
    if (!guard.planner.compatible({ a, b }, { a: la, b: lb }, linked)) return false;
  }
  return guard.stubs.every((stub) => guard.planner.compatible({ a, b }, stub));
}

function pairDrawable(guard: PassageGuard, pair: SpatialPair, links: Iterable<LinkLike>): boolean {
  return passageDrawable(guard, pair.a.id, pair.b.id, links);
}

function minimumSpanningPairs(
  active: readonly Province[],
  pairs: readonly SpatialPair[],
  drawable?: (pair: SpatialPair, tree: readonly SpatialPair[]) => boolean,
): SpatialPair[] {
  const position = new Map(active.map((province, index) => [province.id, index]));
  const parent = active.map((_, index) => index);
  const rank = active.map(() => 0);
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[value] !== value) {
      const next = parent[value]!;
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    let a = find(left);
    let b = find(right);
    if (a === b) return false;
    if (rank[a]! < rank[b]!) [a, b] = [b, a];
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a] = rank[a]! + 1;
    return true;
  };
  const tree: SpatialPair[] = [];
  for (const pair of pairs) {
    const a = position.get(pair.a.id)!, b = position.get(pair.b.id)!;
    if (find(a) === find(b) || (drawable && !drawable(pair, tree))) continue;
    union(a, b);
    tree.push(pair);
    if (tree.length === active.length - 1) break;
  }
  // A drawable forest that cannot span falls back to the nearest remaining
  // joins; generation reports connectivity rather than isolating provinces.
  if (drawable && tree.length < active.length - 1) {
    for (const pair of pairs) {
      if (!union(position.get(pair.a.id)!, position.get(pair.b.id)!)) continue;
      tree.push(pair);
      if (tree.length === active.length - 1) break;
    }
  }
  return tree;
}

function buildChamberGraph(
  active: readonly Province[],
  pairs: readonly SpatialPair[],
  localPairs: readonly SpatialPair[],
  selected: Map<string, SpatialPair>,
  degrees: Map<string, number>,
  addPair: (pair: SpatialPair | undefined) => boolean,
  profile: typeof UNDERWORLD_GRAPH_PROFILE,
  spacing: number,
  guard?: PassageGuard,
) {
  const drawable = guard ? (pair: SpatialPair) => pairDrawable(guard, pair, selected.values()) : undefined;
  const tree = minimumSpanningPairs(active, pairs, guard
    ? (pair, partial) => pairDrawable(guard, pair, [...selected.values(), ...partial])
    : undefined);
  for (const pair of tree) addPair(pair);
  const desiredClusters = active.length < 12
    ? 1
    : clamp(Math.round(active.length / (profile.clusterSize ?? 18)), 2, Math.max(2, Math.floor(active.length / 6)));
  const { labels } = partitionSpatialTree(active, tree, desiredClusters);
  const sameChamber = (pair: SpatialPair) => labels.get(pair.a.id) === labels.get(pair.b.id);
  const targetRank = Math.max(1, Math.round(active.length * profile.cycleRatio));
  const maximumLeaves = Math.ceil(active.length * (profile.leafMaximum ?? 0.08));

  while (selected.size - active.length + 1 < targetRank
    && active.filter((province) => (degrees.get(province.id) ?? 0) <= 1).length > maximumLeaves) {
    const chooseLeafRepair = (pool: readonly SpatialPair[]) => chooseSparseChord(pool, selected, (pair) => {
      const aDegree = degrees.get(pair.a.id) ?? 0;
      const bDegree = degrees.get(pair.b.id) ?? 0;
      return sameChamber(pair)
        && aDegree < profile.ordinaryMaxDegree
        && bDegree < profile.ordinaryMaxDegree
        && (aDegree <= 1 || bDegree <= 1);
    }, (pair) => {
      const leafEnds = Number((degrees.get(pair.a.id) ?? 0) <= 1) + Number((degrees.get(pair.b.id) ?? 0) <= 1);
      return leafEnds * 1000 - pair.distance / spacing;
    }, drawable);
    const pair = chooseLeafRepair(localPairs) ?? chooseLeafRepair(pairs);
    if (!addPair(pair)) break;
  }

  while (selected.size - active.length + 1 < targetRank) {
    const degreeTwoShare = active.filter((province) => degrees.get(province.id) === 2).length / active.length;
    const targetShare = profile.degreeTwoTarget ?? 0.35;
    const chooseLoop = (pool: readonly SpatialPair[]) => chooseSparseChord(pool, selected, (pair) => {
      return sameChamber(pair)
        && (degrees.get(pair.a.id) ?? 0) < profile.ordinaryMaxDegree
        && (degrees.get(pair.b.id) ?? 0) < profile.ordinaryMaxDegree;
    }, (pair) => {
      const converts = Number(degrees.get(pair.a.id) === 2) + Number(degrees.get(pair.b.id) === 2);
      const existingHubs = Number((degrees.get(pair.a.id) ?? 0) >= 3) + Number((degrees.get(pair.b.id) ?? 0) >= 3);
      return degreeTwoShare > targetShare
        ? converts * 120 + existingHubs * 8 - pair.distance / spacing
        : existingHubs * 90 - converts * 50 - pair.distance / spacing;
    }, drawable);
    const pair = chooseLoop(localPairs) ?? chooseLoop(pairs);
    if (!addPair(pair)) break;
  }
}

function partitionSpatialTree(active: readonly Province[], tree: readonly SpatialPair[], desiredClusters: number) {
  const cuts = new Set<string>();
  const longest = [...tree].sort((left, right) => right.distance - left.distance
    || left.a.index - right.a.index || left.b.index - right.b.index);
  while (cuts.size < desiredClusters - 1) {
    const labels = treeComponentLabels(active, tree, cuts);
    const sizes = new Map<number, number>();
    for (const label of labels.values()) sizes.set(label, (sizes.get(label) ?? 0) + 1);
    let cut: SpatialPair | undefined;
    for (const candidate of longest) {
      if (cuts.has(candidate.key) || labels.get(candidate.a.id) !== labels.get(candidate.b.id)) continue;
      const componentSize = sizes.get(labels.get(candidate.a.id)!) ?? 0;
      if (componentSize < 8) continue;
      const sideSize = treeSideSize(candidate.a.id, candidate.key, tree, cuts, labels.get(candidate.a.id)! , labels);
      if (sideSize >= 4 && componentSize - sideSize >= 4) {
        cut = candidate;
        break;
      }
    }
    if (!cut) break;
    cuts.add(cut.key);
  }
  return { labels: treeComponentLabels(active, tree, cuts), cuts };
}

function treeComponentLabels(active: readonly Province[], tree: readonly SpatialPair[], cuts: ReadonlySet<string>) {
  const adjacency = new Map(active.map((province) => [province.id, [] as string[]]));
  for (const pair of tree) {
    if (cuts.has(pair.key)) continue;
    adjacency.get(pair.a.id)!.push(pair.b.id);
    adjacency.get(pair.b.id)!.push(pair.a.id);
  }
  const labels = new Map<string, number>();
  let label = 0;
  for (const province of active) {
    if (labels.has(province.id)) continue;
    const queue = [province.id];
    labels.set(province.id, label);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbour of adjacency.get(queue[cursor]!) ?? []) {
        if (labels.has(neighbour)) continue;
        labels.set(neighbour, label);
        queue.push(neighbour);
      }
    }
    label += 1;
  }
  return labels;
}

function treeSideSize(
  start: string,
  candidateCut: string,
  tree: readonly SpatialPair[],
  existingCuts: ReadonlySet<string>,
  componentLabel: number,
  labels: ReadonlyMap<string, number>,
): number {
  const adjacency = new Map<string, string[]>();
  for (const pair of tree) {
    if (pair.key === candidateCut || existingCuts.has(pair.key)) continue;
    if (labels.get(pair.a.id) !== componentLabel || labels.get(pair.b.id) !== componentLabel) continue;
    if (!adjacency.has(pair.a.id)) adjacency.set(pair.a.id, []);
    if (!adjacency.has(pair.b.id)) adjacency.set(pair.b.id, []);
    adjacency.get(pair.a.id)!.push(pair.b.id);
    adjacency.get(pair.b.id)!.push(pair.a.id);
  }
  const seen = new Set([start]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbour of adjacency.get(queue[cursor]!) ?? []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return seen.size;
}

function chooseSparseChord(
  pool: readonly SpatialPair[],
  selected: ReadonlyMap<string, SpatialPair>,
  eligible: (pair: SpatialPair) => boolean,
  score: (pair: SpatialPair) => number,
  drawable?: (pair: SpatialPair) => boolean,
): SpatialPair | undefined {
  let best: SpatialPair | undefined;
  let bestScore = -Infinity;
  for (const pair of pool) {
    if (selected.has(pair.key) || !eligible(pair)) continue;
    const value = score(pair);
    // Geometry is only consulted for a pair that would otherwise win.
    if (value > bestScore && (!drawable || drawable(pair))) {
      best = pair;
      bestScore = value;
    }
  }
  return best;
}

function addSparseStartHubs(
  active: readonly Province[],
  pairs: readonly SpatialPair[],
  localPairs: readonly SpatialPair[],
  selected: Map<string, SpatialPair>,
  degrees: Map<string, number>,
  addPair: (pair: SpatialPair | undefined) => boolean,
  plane: Plane,
  requestedCount: number,
  targetDegree: number,
  ordinaryMaxDegree: number,
  spacing: number,
  desiredTwoRingCapacity: number | undefined,
  eligibleHub: ((province: Province) => boolean) | undefined,
  seed: string,
  guard?: PassageGuard,
) {
  const desired = Math.min(requestedCount, active.length);
  if (!desired) return [];
  const drawable = guard ? (pair: SpatialPair) => pairDrawable(guard, pair, selected.values()) : undefined;
  const preferredHubSeparation = scaledStartSeparationTarget(active.length, desired);
  const hubs = new Set<string>();
  const regional = usesConnectedRegions(plane);
  const potentialDegrees = new Map(active.map(province => [province.id, 0]));
  for (const pair of pairs) {
    potentialDegrees.set(pair.a.id, (potentialDegrees.get(pair.a.id) ?? 0) + 1);
    potentialDegrees.set(pair.b.id, (potentialDegrees.get(pair.b.id) ?? 0) + 1);
  }
  const canReachTarget = (province: Province) => !regional || (potentialDegrees.get(province.id) ?? 0) >= targetDegree;
  const exhaustedRegionalHubs = new Set<string>();
  const aspect = plane.height > 0 ? clamp(plane.width / plane.height, 0.08, 12) : 1;
  const initialAdjacency = adjacencyFromPairs(active, selected.values());
  const initialBridges = bridgeKeysFromPairs(active, selected.values());
  const initialBridgeEnds = new Set<string>();
  for (const key of initialBridges) {
    const pair = selected.get(key);
    if (!pair) continue;
    initialBridgeEnds.add(pair.a.id);
    initialBridgeEnds.add(pair.b.id);
  }
  const initialCandidates = active.filter((province) => isEligibleStartProvince(province)
    && canReachTarget(province)
    && (!eligibleHub || eligibleHub(province))
    && (degrees.get(province.id) ?? 0) <= targetDegree);
  const distanceCache = new Map<string, Map<string, number>>();
  const distancesFrom = (id: string) => {
    let distances = distanceCache.get(id);
    if (!distances) {
      distances = shortestDistances(initialAdjacency, id);
      distanceCache.set(id, distances);
    }
    return distances;
  };
  const planSeparatedHubs = (pool: readonly Province[]): Province[] | undefined => {
    if (pool.length < desired) return undefined;
    const conflictCounts = new Map(pool.map((candidate) => [candidate.id, pool.reduce((count, other) =>
      count + Number(other.id !== candidate.id
        && (distancesFrom(candidate.id).get(other.id) ?? 0) < preferredHubSeparation), 0)]));
    const ranked = [...pool].sort((a, b) => (conflictCounts.get(a.id) ?? 0) - (conflictCounts.get(b.id) ?? 0)
      || (hashString(`${seed}:planned-hub:${a.id}`) % 100000) - (hashString(`${seed}:planned-hub:${b.id}`) % 100000)
      || a.index - b.index);
    const planned: Province[] = [];
    let visitedNodes = 0;
    const nodeBudget = Math.max(100_000, desired * 20_000);
    const search = (available: readonly Province[]): Province[] | undefined => {
      const needed = desired - planned.length;
      if (!needed) return [...planned];
      if (available.length < needed || visitedNodes >= nodeBudget) return undefined;
      for (let cursor = 0; cursor <= available.length - needed && visitedNodes < nodeBudget; cursor += 1) {
        visitedNodes += 1;
        const candidate = available[cursor]!;
        planned.push(candidate);
        const remaining = available.slice(cursor + 1).filter((other) =>
          (distancesFrom(candidate.id).get(other.id) ?? 0) >= preferredHubSeparation);
        const result = search(remaining);
        if (result) return result;
        planned.pop();
      }
      return undefined;
    };
    return search(ranked);
  };
  const bridgeSafeCandidates = initialCandidates.filter((province) => !initialBridgeEnds.has(province.id));
  const plannedHubs = planSeparatedHubs(bridgeSafeCandidates) ?? planSeparatedHubs(initialCandidates) ?? [];
  const plannedHubIds = new Set(plannedHubs.map((province) => province.id));
  let attempts = 0;
  while (hubs.size < desired && attempts < desired * 4 + 4) {
    attempts += 1;
    const bridges = bridgeKeysFromPairs(active, selected.values());
    const bridgeEnds = new Set<string>();
    for (const key of bridges) {
      const pair = selected.get(key);
      if (pair) {
        bridgeEnds.add(pair.a.id);
        bridgeEnds.add(pair.b.id);
      }
    }
    const adjacency = adjacencyFromPairs(active, selected.values());
    const candidates = active.filter((province) => !hubs.has(province.id)
      && !exhaustedRegionalHubs.has(province.id)
      && canReachTarget(province)
      && isEligibleStartProvince(province)
      && (!eligibleHub || eligibleHub(province))
      && !bridgeEnds.has(province.id)
      && (degrees.get(province.id) ?? 0) <= targetDegree);
    if (!candidates.length) {
      const pair = chooseSparseChord(localPairs, selected, (candidate) => {
        return (degrees.get(candidate.a.id) ?? 0) < Math.max(targetDegree, ordinaryMaxDegree)
          && (degrees.get(candidate.b.id) ?? 0) < Math.max(targetDegree, ordinaryMaxDegree);
      }, (candidate) => -candidate.distance / spacing, drawable)
        ?? chooseSparseChord(pairs, selected, () => true, (candidate) => -candidate.distance / spacing, drawable);
      if (!addPair(pair)) break;
      continue;
    }
    const separatedCandidates = hubs.size
      ? candidates.filter((province) => [...hubs].every((id) =>
        (shortestDistances(adjacency, id).get(province.id) ?? 0) >= preferredHubSeparation))
      : candidates;
    const plannedHub = plannedHubs.find(province => !hubs.has(province.id) && !exhaustedRegionalHubs.has(province.id));
    // Adding movement edges can only shorten graph distance. If the current
    // topology has no safe next hub, accepting an adjacent fallback would
    // bake an invalid capital layout into the sparse graph.
    if (hubs.size && !separatedCandidates.length && !plannedHub) break;
    const usableCandidates = plannedHub ? [plannedHub] : separatedCandidates;
    let hub: Province | undefined;
    let bestScore = -Infinity;
    for (const candidate of usableCandidates) {
      const separation = hubs.size
        ? Math.min(...[...hubs].map((id) => periodicProvinceDistance(candidate, active.find((province) => province.id === id)!, plane, aspect)))
        : 6 * spacing;
      const capacity = reachableWithin(adjacency, candidate.id, 2);
      const score = separation / spacing * 30 + capacity * 12
        - Math.abs((degrees.get(candidate.id) ?? 0) - targetDegree) * 8
        + (hashString(`${seed}:hub:${candidate.id}`) % 1000) / 10000;
      if (score > bestScore || (score === bestScore && candidate.index < (hub?.index ?? Infinity))) {
        hub = candidate;
        bestScore = score;
      }
    }
    if (!hub) break;
    while ((degrees.get(hub.id) ?? 0) < targetDegree) {
      const currentAdjacency = adjacencyFromPairs(active, selected.values());
      const currentTwoRing = new Set([...shortestDistances(currentAdjacency, hub.id).entries()]
        .filter(([, distance]) => distance <= 2)
        .map(([id]) => id));
      const raiseHub = (pool: readonly SpatialPair[]) => chooseSparseChord(pool, selected, (pair) => {
        if (pair.a.id !== hub!.id && pair.b.id !== hub!.id) return false;
        const other = pair.a.id === hub!.id ? pair.b : pair.a;
        return !hubs.has(other.id)
          && !plannedHubIds.has(other.id)
          && !(currentAdjacency.get(other.id) ?? []).some((id) => id !== hub!.id && plannedHubIds.has(id))
          && [...plannedHubIds].every((id) => id === hub!.id
            || (shortestDistances(currentAdjacency, id).get(other.id) ?? Infinity) >= preferredHubSeparation - 1)
          && (degrees.get(other.id) ?? 0) < Math.max(3, targetDegree + 2, ordinaryMaxDegree);
      }, (pair) => {
        const other = pair.a.id === hub!.id ? pair.b : pair.a;
        const gained = [other.id, ...(currentAdjacency.get(other.id) ?? [])]
          .filter((id) => !currentTwoRing.has(id)).length;
        return gained * 120 + (degrees.get(other.id) ?? 0) * 12 - pair.distance / spacing;
      }, drawable);
      const pair = raiseHub(localPairs) ?? raiseHub(pairs);
      if (!addPair(pair)) break;
    }
    if ((degrees.get(hub.id) ?? 0) < targetDegree) {
      if (!regional) break;
      exhaustedRegionalHubs.add(hub.id);
      plannedHubIds.delete(hub.id);
      continue;
    }

    const desiredTwoRing = Math.min(active.length, Math.max(desiredTwoRingCapacity ?? 0, targetDegree * 3 + 1));
    while (reachableWithin(adjacencyFromPairs(active, selected.values()), hub.id, 2) < desiredTwoRing) {
      const basinAdjacency = adjacencyFromPairs(active, selected.values());
      const oneRing = new Set(basinAdjacency.get(hub.id) ?? []);
      const twoRing = new Set([...shortestDistances(basinAdjacency, hub.id).entries()]
        .filter(([, distance]) => distance <= 2)
        .map(([id]) => id));
      const chooseBasinPair = (pool: readonly SpatialPair[]) => chooseSparseChord(pool, selected, (pair) => {
        const aNear = oneRing.has(pair.a.id);
        const bNear = oneRing.has(pair.b.id);
        if (aNear === bNear) return false;
        const near = aNear ? pair.a : pair.b;
        const far = aNear ? pair.b : pair.a;
        return !hubs.has(near.id) && !hubs.has(far.id)
          && !plannedHubIds.has(near.id) && !plannedHubIds.has(far.id)
          && !twoRing.has(far.id)
          && [...plannedHubIds].every((id) => id === hub!.id
            || (shortestDistances(basinAdjacency, id).get(far.id) ?? Infinity) >= preferredHubSeparation - 2)
          && (degrees.get(near.id) ?? 0) < Math.max(3, targetDegree + 2)
          && (degrees.get(far.id) ?? 0) < Math.max(targetDegree, ordinaryMaxDegree);
      }, (pair) => {
        const far = oneRing.has(pair.a.id) ? pair.b : pair.a;
        return (degrees.get(far.id) ?? 0) * 10 - pair.distance / spacing;
      }, drawable);
      const basinPair = chooseBasinPair(localPairs) ?? chooseBasinPair(pairs);
      if (!addPair(basinPair)) break;
    }
    hubs.add(hub.id);
  }
  const balancedTwoRingTarget = Math.min(active.length, Math.max(desiredTwoRingCapacity ?? 0, targetDegree * 3 + 1));
  const exhaustedHubs = new Set<string>();
  let balanceAttempts = 0;
  while (balanceAttempts < Math.max(16, hubs.size * balancedTwoRingTarget)) {
    const adjacency = adjacencyFromPairs(active, selected.values());
    const hub = active.filter((province) => hubs.has(province.id) && !exhaustedHubs.has(province.id))
      .sort((a, b) => reachableWithin(adjacency, a.id, 2) - reachableWithin(adjacency, b.id, 2)
        || a.index - b.index)[0];
    if (!hub || reachableWithin(adjacency, hub.id, 2) >= balancedTwoRingTarget) break;
    balanceAttempts += 1;
    const oneRing = new Set(adjacency.get(hub.id) ?? []);
    const twoRing = new Set([...shortestDistances(adjacency, hub.id).entries()]
      .filter(([, distance]) => distance <= 2)
      .map(([id]) => id));
    const basinDegreeCap = Math.max(targetDegree + 5, ordinaryMaxDegree + 3);
    const chooseBalancedBranch = (pool: readonly SpatialPair[]) => chooseSparseChord(pool, selected, (pair) => {
      const aNear = oneRing.has(pair.a.id);
      const bNear = oneRing.has(pair.b.id);
      if (aNear === bNear) return false;
      const near = aNear ? pair.a : pair.b;
      const far = aNear ? pair.b : pair.a;
      return !plannedHubIds.has(near.id) && !plannedHubIds.has(far.id)
        && !twoRing.has(far.id)
        && [...plannedHubIds].every((id) => id === hub.id
          || (shortestDistances(adjacency, id).get(far.id) ?? Infinity) >= preferredHubSeparation - 2)
        && (degrees.get(near.id) ?? 0) < basinDegreeCap
        && (degrees.get(far.id) ?? 0) < basinDegreeCap;
    }, (pair) => {
      const far = oneRing.has(pair.a.id) ? pair.b : pair.a;
      const gained = [far.id, ...(adjacency.get(far.id) ?? [])].filter((id) => !twoRing.has(id)).length;
      return gained * 120 - pair.distance / spacing;
    }, drawable);
    const branch = chooseBalancedBranch(localPairs) ?? chooseBalancedBranch(pairs);
    if (!addPair(branch)) exhaustedHubs.add(hub.id);
  }
  return active.filter((province) => hubs.has(province.id));
}

function adjacencyFromPairs(active: readonly Province[], pairs: Iterable<SpatialPair>) {
  const adjacency = new Map(active.map((province) => [province.id, [] as string[]]));
  for (const pair of pairs) {
    adjacency.get(pair.a.id)?.push(pair.b.id);
    adjacency.get(pair.b.id)?.push(pair.a.id);
  }
  for (const neighbours of adjacency.values()) neighbours.sort();
  return adjacency;
}

function bridgeKeysFromPairs(active: readonly Province[], pairs: Iterable<SpatialPair>): Set<string> {
  const adjacency = new Map(active.map((province) => [province.id, [] as Array<{ id: string; key: string }>]));
  for (const pair of pairs) {
    adjacency.get(pair.a.id)?.push({ id: pair.b.id, key: pair.key });
    adjacency.get(pair.b.id)?.push({ id: pair.a.id, key: pair.key });
  }
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const bridges = new Set<string>();
  let time = 0;
  const visit = (id: string, parentKey?: string) => {
    discovery.set(id, ++time);
    low.set(id, time);
    for (const edge of adjacency.get(id) ?? []) {
      if (edge.key === parentKey) continue;
      if (!discovery.has(edge.id)) {
        visit(edge.id, edge.key);
        low.set(id, Math.min(low.get(id)!, low.get(edge.id)!));
        if (low.get(edge.id)! > discovery.get(id)!) bridges.add(edge.key);
      } else {
        low.set(id, Math.min(low.get(id)!, discovery.get(edge.id)!));
      }
    }
  };
  for (const province of active) if (!discovery.has(province.id)) visit(province.id);
  return bridges;
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
  // Editors find borders by ID, so IDs must stay unique. Kept borders reserve
  // theirs first (a repeated one is suffixed); new borders avoid all of them,
  // since a reused seed can reproduce an ID already on the plane.
  const usedIds = new Set<string>();
  const uniqueId = (candidate: string) => {
    let id = candidate;
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${candidate}-${suffix}`;
    usedIds.add(id);
    return id;
  };
  const kept = topology.pairs.map((pair) => existing.get(pair.key));
  const keptIds = kept.map((edge) => edge && uniqueId(edge.id));
  const edges = topology.pairs.map((pair, index) => {
    const current = kept[index];
    if (current) return { ...current, id: keptIds[index]!, a: pair.a, b: pair.b };
    const a = provinceById.get(pair.a)!;
    const b = provinceById.get(pair.b)!;
    // Roll first so the random sequence for later borders is unchanged, then
    // keep new start borders open as generation does; a random river, pass or
    // mountain border there would make the capital fail export validation.
    const rolled = borderKind(a, b, rng);
    const startBorder = [a, b].some((province) => province.start || province.teamStart !== undefined);
    return {
      id: uniqueId(idFor(seed, "edge", index)),
      a: pair.a,
      b: pair.b,
      kind: startBorder && (rolled === "river" || rolled === "mountain_pass" || rolled === "mountain_border") ? "standard" : rolled,
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

/** Final generated edge-kind pass: connected rivers, including strategic river chokepoints. */
export function finalizeGeneratedRivers(plane: Plane, settings: GenerationSettings, seed: string, protectedStartIds: readonly string[] = [], warnings?: string[]) {
  const controls = plane.generationOverrides;
  const hasRouteMix = controls && [controls.roadPercent, controls.riverPercent, controls.passPercent].some(value => value !== undefined);
  const result = generateBorderRivers(plane, seed, {
    riverPercent: hasRouteMix ? controls.riverPercent ?? 0 : undefined,
    bridgeAll: normalizeOverlandTopologyMode(settings.overlandTopology) === "open" && !hasRouteMix,
    protectedStartIds,
    requiredBorders: takeStrategicRiverChokepoints(plane),
  });
  restoreUnroutedStrategicChokepoints(plane, result.unroutedRequired, protectedStartIds, warnings);
  if (result.limited && hasRouteMix && (controls.riverPercent ?? 0) > 0) {
    warnings?.push(`${plane.name}: connected river routes used ${result.riverBorders} of approximately ${result.requestedBorders} requested borders. Complete outlet paths and existing barriers take priority over an exact river share.`);
  }
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

export function scaledStartSeparationTarget(traversableProvinceCount: number, startCount: number): number {
  if (startCount <= 0) return 3;
  return clamp(Math.round(Math.sqrt(Math.max(1, traversableProvinceCount) / startCount)), 3, 8);
}

/**
 * Report start allocations that cannot be represented by the currently
 * planned plane families. This is intentionally geometry-independent: it
 * catches impossible plans before an expensive generation run, while the
 * normal validator remains responsible for cramped-but-possible layouts.
 */
export function preflightStartPlan(project: MapProject): string[] {
  const requested = normalizeStartDistribution(project.settings.startDistribution, project.settings.players);
  const hasOverland = eligibleGeneratedStartPlaneIndexes(project, "land").length > 0;
  const hasCaveRealm = eligibleGeneratedStartPlaneIndexes(project, "cave").length > 0;
  const hasOtherRealm = eligibleGeneratedStartPlaneIndexes(project, "other").length > 0;
  const hasAnyOverland = project.planes.some(isSurfaceCorePlaneForSizing);
  const hasAnyCaveRealm = project.planes.some((plane) => ARCHETYPE_PROFILES[plane.kind].caveFamily);
  const hasAnyOtherRealm = project.planes.some((plane) =>
    !isSurfaceCorePlaneForSizing(plane) && !ARCHETYPE_PROFILES[plane.kind].caveFamily);
  const issues: string[] = [];

  if (!hasOverland && requested.land > 0) issues.push(hasAnyOverland
    ? `${requested.land} land start${requested.land === 1 ? " needs" : "s need"} at least one Surface or surface-like solid Custom plane enabled for generated starts.`
    : `${requested.land} land start${requested.land === 1 ? " needs" : "s need"} a Surface or solid Custom plane.`);
  if (!hasOverland && requested.coastal > 0) issues.push(hasAnyOverland
    ? `${requested.coastal} coastal start${requested.coastal === 1 ? " needs" : "s need"} at least one Surface or surface-like solid Custom plane enabled for generated starts.`
    : `${requested.coastal} coastal start${requested.coastal === 1 ? " needs" : "s need"} a Surface or solid Custom plane.`);
  if (!hasOverland && requested.water > 0) issues.push(hasAnyOverland
    ? `${requested.water} water start${requested.water === 1 ? " needs" : "s need"} at least one Surface or surface-like solid Custom plane enabled for generated starts.`
    : `${requested.water} water start${requested.water === 1 ? " needs" : "s need"} a Surface or solid Custom plane with generated seas.`);
  if (!hasCaveRealm && requested.cave > 0) issues.push(hasAnyCaveRealm
    ? `${requested.cave} cave start${requested.cave === 1 ? " needs" : "s need"} at least one cave-family plane enabled for generated starts.`
    : `${requested.cave} cave start${requested.cave === 1 ? " needs" : "s need"} a Cave, Cavern, Underworld, Hell, or Abyss plane.`);
  if (!hasOtherRealm && requested.other > 0) issues.push(hasAnyOtherRealm
    ? `${requested.other} other-plane start${requested.other === 1 ? " needs" : "s need"} at least one non-core special plane enabled for generated starts.`
    : `${requested.other} other-plane start${requested.other === 1 ? " needs" : "s need"} a Cloud, Air, Dream, or Elemental plane.`);
  const configuredCaveNations = normalizeCaveStartNations(project.settings.caveStartNations).length;
  if (configuredCaveNations > requested.cave) {
    issues.push(`${configuredCaveNations} configured cave nation${configuredCaveNations === 1 ? " needs" : "s need"} at least ${configuredCaveNations} generated cave start${configuredCaveNations === 1 ? "" : "s"}, but the current allocation requests ${requested.cave}.`);
  }
  return issues;
}

function generatedStartSeparationTargets(project: MapProject, requested: StartDistribution): Map<string, number> {
  const activeCounts = new Map(project.planes.map((plane) => [
    plane.id,
    plane.provinces.filter((province) => !isBlockedProvince(province)).length,
  ]));
  const planeTargets = generatedStartPlaneTargets(project, requested);
  const assigned = new Map(project.planes.map((plane) => [plane.id, START_TYPES.reduce(
    (sum, type) => sum + (planeTargets.get(type)?.get(plane.id) ?? 0),
    0,
  )]));
  return new Map(project.planes.map((plane) => [
    plane.id,
    scaledStartSeparationTarget(activeCounts.get(plane.id) ?? 0, assigned.get(plane.id) ?? 0),
  ]));
}

function separationForPlane(plan: number | ReadonlyMap<string, number>, planeId: string): number {
  return typeof plan === "number" ? plan : plan.get(planeId) ?? 3;
}

interface AuthoredStartObstacle {
  provinceId: string;
  /**
   * Movement distance from this start once start-border repair has opened
   * both this capital's borders and a generated capital's own borders.
   */
  distances: Map<string, number>;
}

type AuthoredStartsByPlane = ReadonlyMap<string, readonly AuthoredStartObstacle[]>;

const NO_AUTHORED_STARTS: AuthoredStartsByPlane = new Map();

/**
 * Nation-specific starts the author placed (and any team starts) survive
 * generation and are validated as distinct multiplayer starts. Generated
 * cave assignments are rebuilt after placement, and a manual assignment for
 * a configured cave nation is required to share a generated cave start, so
 * neither is something generated capitals must avoid.
 */
function protectedAuthoredStarts(project: MapProject): { nation?: number; plane: Plane; province: Province }[] {
  const caveNations = new Set(normalizeCaveStartNations(project.settings.caveStartNations));
  const seen = new Set<string>();
  const result: { nation?: number; plane: Plane; province: Province }[] = [];
  for (const start of project.specificStarts) {
    if (start.source === "generated-cave" || caveNations.has(start.nation)) continue;
    const plane = project.planes.find((item) => item.id === start.planeId);
    const province = plane?.provinces.find((item) => item.id === start.provinceId);
    const key = globalProvinceKey(start.planeId, start.provinceId);
    if (!plane || !province || seen.has(key)) continue;
    seen.add(key);
    result.push({ nation: start.nation, plane, province });
  }
  for (const plane of project.planes) for (const province of plane.provinces) {
    const key = globalProvinceKey(plane.id, province.id);
    if (province.teamStart === undefined || seen.has(key)) continue;
    seen.add(key);
    result.push({ plane, province });
  }
  return result;
}

function authoredStartObstacles(
  project: MapProject,
  traversableByPlane: ReadonlyMap<string, Map<string, string[]>>,
): AuthoredStartsByPlane {
  const authored = protectedAuthoredStarts(project);
  if (!authored.length) return NO_AUTHORED_STARTS;
  const result = new Map<string, AuthoredStartObstacle[]>();
  const fullByPlane = new Map<string, Map<string, string[]>>();
  for (const { plane, province } of authored) {
    const traversable = traversableByPlane.get(plane.id) ?? adjacencyFor(plane, { traversableOnly: true });
    let full = fullByPlane.get(plane.id);
    if (!full) {
      full = adjacencyFor(plane);
      fullByPlane.set(plane.id, full);
    }
    // repairStartBorders opens every border of a protected capital, so its
    // first step may cross any authored border.
    const reached = new Map([[province.id, 0]]);
    const queue = [province.id];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor]!;
      for (const neighbour of (cursor === 0 ? full : traversable).get(id) ?? []) {
        if (reached.has(neighbour)) continue;
        reached.set(neighbour, reached.get(id)! + 1);
        queue.push(neighbour);
      }
    }
    // A generated capital's own borders are opened as well.
    const distances = new Map<string, number>();
    for (const candidate of plane.provinces) {
      let distance = reached.get(candidate.id) ?? Infinity;
      for (const neighbour of full.get(candidate.id) ?? []) distance = Math.min(distance, (reached.get(neighbour) ?? Infinity) + 1);
      if (Number.isFinite(distance)) distances.set(candidate.id, distance);
    }
    const list = result.get(plane.id) ?? [];
    list.push({ provinceId: province.id, distances });
    result.set(plane.id, list);
  }
  return result;
}

function authoredStartDistance(authoredStarts: AuthoredStartsByPlane, planeId: string, provinceId: string): number {
  let distance = Infinity;
  for (const start of authoredStarts.get(planeId) ?? []) distance = Math.min(distance, start.distances.get(provinceId) ?? Infinity);
  return distance;
}

/**
 * Explain, after generation, any authored nation start that generated
 * capitals could not keep distinct. Validation still blocks export; this
 * names the start and the spacing achieved so the author can decide.
 */
function appendAuthoredStartSpacingWarnings(project: MapProject): void {
  const authored = protectedAuthoredStarts(project).filter((item) => item.nation !== undefined);
  if (!authored.length) return;
  const conflicts = authoredStartSpacingConflicts(project, authored);
  if (!conflicts.length) return;
  project.generationWarnings ??= [];
  for (const conflict of conflicts) {
    const { nation, plane, province, nearest, nearestPlane, distance } = conflict;
    project.generationWarnings.push(`${plane.name}: generated starts could not keep 3 movement connections from the authored start for nation ${nation} at ${province.name}; generated start ${nearest.name}${nearestPlane.id === plane.id ? "" : ` (${nearestPlane.name})`} is only ${distance} connection${distance === 1 ? "" : "s"} away. Export stays blocked until you move or remove that nation start, or change players, provinces per player or plane sizes and Generate again.`);
  }
}

interface AuthoredStartSpacingConflict {
  nation: number;
  plane: Plane;
  province: Province;
  nearest: Province;
  nearestPlane: Plane;
  distance: number;
}

function authoredStartSpacingConflicts(
  project: MapProject,
  authored: readonly { nation?: number; plane: Plane; province: Province }[],
): AuthoredStartSpacingConflict[] {
  const generated = new Map(project.planes.flatMap((plane) => plane.provinces
    .filter((province) => province.start)
    .map((province) => [globalProvinceKey(plane.id, province.id), { plane, province }] as const)));
  if (!generated.size) return [];
  const movement = globalMovementAdjacency(project);
  const conflicts: AuthoredStartSpacingConflict[] = [];
  for (const { nation, plane, province } of authored) {
    if (nation === undefined) continue;
    for (const [key, distance] of shortestDistances(movement, globalProvinceKey(plane.id, province.id), 2)) {
      const hit = distance > 0 ? generated.get(key) : undefined;
      if (!hit) continue;
      conflicts.push({ nation, plane, province, nearest: hit.province, nearestPlane: hit.plane, distance });
      break;
    }
  }
  return conflicts;
}

export interface AuthoredStartNotice {
  nation: number;
  planeId: string;
  provinceId: string;
  message: string;
}

/**
 * Non-blocking pre-generation notice for authored nation starts that the
 * current map already crowds. Generate keeps generated capitals at least 3
 * movement connections away whenever the new geometry allows; the author can
 * proceed, or move/remove the nation start first.
 */
export function preflightAuthoredStartNotices(project: MapProject): AuthoredStartNotice[] {
  const authored = protectedAuthoredStarts(project).filter((item) => item.nation !== undefined);
  if (!authored.length) return [];
  return authoredStartSpacingConflicts(project, authored).map(({ nation, plane, province, nearest, nearestPlane, distance }) => ({
    nation,
    planeId: plane.id,
    provinceId: province.id,
    message: `Nation ${nation}'s authored start at ${province.name} (${plane.name}) is only ${distance} movement connection${distance === 1 ? "" : "s"} from generated start ${nearest.name}${nearestPlane.id === plane.id ? "" : ` (${nearestPlane.name})`}. Generate places generated starts at least 3 connections from it when the new geometry allows; if it cannot, it records a warning and export stays blocked until the nation start is moved or removed.`,
  }));
}

function placeDistributedStarts(project: MapProject, preparedStartAnchors: readonly PreparedStartAnchor[] = []) {
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
  // Every start search below measures on these fixed graphs and terrain;
  // share their BFS maps and start-type checks for the whole pass instead of
  // rebuilding them per candidate.
  const searchMemo = createStartSearchMemo();
  const distancesFrom = searchMemo.distancesFrom;
  const planeTargets = generatedStartPlaneTargets(project, requested);
  // Authored nation starts are fixed capitals: never reuse their province and
  // keep every generated capital at least three moves away (the export floor).
  const authoredStarts = authoredStartObstacles(project, adjacency);
  const authoredKeys = new Set([...authoredStarts].flatMap(([planeId, starts]) =>
    starts.map((start) => globalProvinceKey(planeId, start.provinceId))));
  const bridgeEndpoints = new Map(project.planes.map((plane) => {
    const bridgeKeys = graphBridgeKeys(plane);
    const endpoints = new Set<string>();
    for (const edge of plane.edges) {
      if (!bridgeKeys.has(connectionKey(edge.a, edge.b))) continue;
      endpoints.add(edge.a);
      endpoints.add(edge.b);
    }
    return [plane.id, endpoints];
  }));
  const twoRingCapacity = new Map(project.planes.map((plane) => {
    const local = adjacency.get(plane.id)!;
    return [plane.id, new Map(plane.provinces.map((province) => [province.id, reachableWithin(local, province.id, 2)]))];
  }));
  const placementOrders: StartType[][] = [
    ["water", "coastal", "cave", "other", "land"],
    ["cave", "other", "water", "coastal", "land"],
    ["land", "coastal", "water", "cave", "other"],
    ["coastal", "water", "cave", "land", "other"],
  ];
  const placementOrder = placementOrders[0]!;
  const effectivePlacementOrders = placementOrders.filter((order, index) => {
    const signature = order.filter((type) => requested[type] > 0).join(":");
    return placementOrders.findIndex((candidate) => candidate.filter((type) => requested[type] > 0).join(":") === signature) === index;
  });
  const degreeTarget = project.settings.startDegreeTarget ?? 4;
  const minimumUsefulDegree = Math.min(degreeTarget, 4);
  const preferredGeneratedDegree = degreeTarget === 4 ? 5 : degreeTarget;
  const candidateDegrees = [...new Set(project.planes.flatMap((plane) => plane.noGeneratedStarts ? [] : plane.provinces
    .filter((province) => isEligibleStartProvince(province))
    .map((province) => adjacency.get(plane.id)?.get(province.id)?.length ?? 0)
    .filter((degree) => degree >= minimumUsefulDegree)))]
    .sort((a, b) => Math.abs(a - preferredGeneratedDegree) - Math.abs(b - preferredGeneratedDegree) || a - b);

  const exactPlacementAttempt = (
    degree: number,
    separationPlan: number | ReadonlyMap<string, number>,
    order: readonly StartType[],
    variant: number,
  ): ProvinceRef[] => {
    const attempt: ProvinceRef[] = [];
    for (const type of order) {
      for (let slot = 0; slot < requested[type]; slot += 1) {
        const candidate = chooseDistributedStart(
          project,
          type,
          attempt,
          adjacency,
          twoRingCapacity,
          bridgeEndpoints,
          `${project.seed}:distributed:scaled-separation:degree-${degree}:variant-${variant}:${type}:${slot}`,
          degree,
          separationPlan,
          planeTargets,
          adjacency,
          authoredStarts,
          searchMemo,
        );
        if (!candidate) return [];
        attempt.push(candidate);
      }
    }
    if (attempt.length !== project.settings.players) return [];
    // A locally exhausted regional choice must not end the full placement
    // search while another order, degree or smaller safe separation can avoid
    // a passage bottleneck. Only the existing final relaxed fallback may
    // accept such a constrained start instead of silently dropping a player.
    if (separationPlan !== 0 && attempt.some(ref => usesConnectedRegions(ref.plane)
      && bridgeEndpoints.get(ref.plane.id)?.has(ref.province.id))) return [];
    return attempt;
  };

  const backtrackingPlacementAttempt = (
    degree: number | undefined,
    separationPlan: number | ReadonlyMap<string, number>,
    order: readonly StartType[],
    variant: number,
  ): ProvinceRef[] => {
    const slots = order.flatMap((type) => Array.from({ length: requested[type] }, () => type));
    const refs = project.planes.flatMap((plane, planeIndex) => plane.noGeneratedStarts
      ? []
      : plane.provinces.map((province) => ({ plane, planeIndex, province })));
    const pools = new Map<StartType, ProvinceRef[]>();
    for (const type of [...new Set(slots)]) {
      const eligiblePlaneIds = new Set(eligibleGeneratedStartPlaneIndexes(project, type).map((index) => project.planes[index]!.id));
      let candidates = refs.filter((ref) => eligiblePlaneIds.has(ref.plane.id)
        && isEligibleStartProvince(ref.province)
        && !authoredKeys.has(globalProvinceKey(ref.plane.id, ref.province.id))
        && matchesStartType(ref, type, adjacency.get(ref.plane.id)!)
        && (degree === undefined
          ? (adjacency.get(ref.plane.id)?.get(ref.province.id)?.length ?? 0) >= minimumUsefulDegree
          : (adjacency.get(ref.plane.id)?.get(ref.province.id)?.length ?? 0) === degree));
      if (type === "water") {
        const overland = candidates.filter((ref) => ref.plane.kind === "surface" || ref.plane.kind === "custom");
        if (overland.length >= requested.water) candidates = overland;
      }
      const bridgeSafe = candidates.filter((ref) => !bridgeEndpoints.get(ref.plane.id)?.has(ref.province.id));
      if (bridgeSafe.length >= requested[type]) candidates = bridgeSafe;
      // Regional exact/backtracking attempts must try another degree before
      // accepting a bridge endpoint merely to preserve the current degree.
      candidates = candidates.filter(ref => !usesConnectedRegions(ref.plane)
        || !bridgeEndpoints.get(ref.plane.id)?.has(ref.province.id));
      pools.set(type, candidates.sort((a, b) => a.planeIndex - b.planeIndex || a.province.index - b.province.index));
    }
    const attempt: ProvinceRef[] = [];
    const used = new Set<string>();
    const separationFromAttempt = (candidate: ProvinceRef) => {
      const samePlane = attempt.filter((item) => item.plane.id === candidate.plane.id);
      if (!samePlane.length) return 8;
      const distances = distancesFrom(adjacency.get(candidate.plane.id)!, candidate.province.id);
      return Math.min(...samePlane.map((item) => distances.get(item.province.id) ?? 0));
    };
    const authoredSeparation = (candidate: ProvinceRef) =>
      authoredStartDistance(authoredStarts, candidate.plane.id, candidate.province.id);
    let visitedNodes = 0;
    const nodeBudget = 12_000;
    const search = (slotIndex: number): ProvinceRef[] | undefined => {
      if (slotIndex === slots.length) return [...attempt];
      if (visitedNodes >= nodeBudget) return undefined;
      const type = slots[slotIndex]!;
      const selectedCapacities = attempt.map((item) => twoRingCapacity.get(item.plane.id)?.get(item.province.id) ?? 0);
      const preferredCapacity = selectedCapacities.length ? mean(selectedCapacities) : undefined;
      const capacityTolerance = preferredCapacity === undefined ? Infinity : Math.max(2, preferredCapacity * 0.2);
      let candidates = (pools.get(type) ?? []).filter((candidate) => {
        const key = globalProvinceKey(candidate.plane.id, candidate.province.id);
        const planeQuota = planeTargets.get(type)?.get(candidate.plane.id) ?? 0;
        const planeLoad = attempt.filter((item) => item.plane.id === candidate.plane.id
          && matchesStartType(item, type, adjacency.get(item.plane.id)!)).length;
        return planeLoad < planeQuota
          && !used.has(key)
          && separationFromAttempt(candidate) >= separationForPlane(separationPlan, candidate.plane.id)
          && authoredSeparation(candidate) >= 3;
      });
      if (preferredCapacity !== undefined) {
        const comparable = candidates.filter((candidate) => Math.abs(
          (twoRingCapacity.get(candidate.plane.id)?.get(candidate.province.id) ?? 0) - preferredCapacity,
        ) <= capacityTolerance);
        if (comparable.length) candidates = comparable;
      }
      const loadByPlane = new Map(project.planes.map((plane) => [plane.id, attempt.filter((item) => item.plane.id === plane.id).length]));
      const commonDegree = attempt.length
        ? adjacency.get(attempt[0]!.plane.id)?.get(attempt[0]!.province.id)?.length ?? preferredGeneratedDegree
        : preferredGeneratedDegree;
      candidates.sort((a, b) => {
        const separationA = Math.min(separationFromAttempt(a), authoredSeparation(a));
        const separationB = Math.min(separationFromAttempt(b), authoredSeparation(b));
        const degreeA = adjacency.get(a.plane.id)?.get(a.province.id)?.length ?? 0;
        const degreeB = adjacency.get(b.plane.id)?.get(b.province.id)?.length ?? 0;
        const capacityA = twoRingCapacity.get(a.plane.id)?.get(a.province.id) ?? 0;
        const capacityB = twoRingCapacity.get(b.plane.id)?.get(b.province.id) ?? 0;
        const capacityDeltaA = preferredCapacity === undefined ? 0 : Math.abs(capacityA - preferredCapacity);
        const capacityDeltaB = preferredCapacity === undefined ? 0 : Math.abs(capacityB - preferredCapacity);
        const loadA = (loadByPlane.get(a.plane.id) ?? 0) / Math.max(1, a.plane.provinces.length);
        const loadB = (loadByPlane.get(b.plane.id) ?? 0) / Math.max(1, b.plane.provinces.length);
        const jitterA = hashString(`${project.seed}:start-backtrack:${variant}:${slotIndex}:${a.plane.id}:${a.province.id}`) % 1000;
        const jitterB = hashString(`${project.seed}:start-backtrack:${variant}:${slotIndex}:${b.plane.id}:${b.province.id}`) % 1000;
        return separationB - separationA
          || (degree === undefined ? Math.abs(degreeA - commonDegree) - Math.abs(degreeB - commonDegree) : 0)
          || capacityDeltaA - capacityDeltaB || loadA - loadB || jitterB - jitterA
          || a.planeIndex - b.planeIndex || a.province.index - b.province.index;
      });
      const alternativeLimit = Math.min(candidates.length, slotIndex < 2 ? 18 : 12);
      for (let alternative = 0; alternative < alternativeLimit && visitedNodes < nodeBudget; alternative += 1) {
        visitedNodes += 1;
        const candidate = candidates[alternative]!;
        const key = globalProvinceKey(candidate.plane.id, candidate.province.id);
        used.add(key);
        attempt.push(candidate);
        const result = search(slotIndex + 1);
        if (result) return result;
        attempt.pop();
        used.delete(key);
      }
      return undefined;
    };
    return search(0) ?? [];
  };

  // Scale the preferred spacing to traversable provinces per anticipated
  // start on each plane. Each retry relaxes every plane by one move, never
  // below the hard three-move floor.
  const preferredSeparation = generatedStartSeparationTargets(project, requested);
  const maximumRelaxation = Math.max(0, ...[...preferredSeparation.values()].map((target) => target - 3));
  const separationPlans: ReadonlyMap<string, number>[] = [];
  const separationSignatures = new Set<string>();
  for (let relaxation = 0; relaxation <= maximumRelaxation; relaxation += 1) {
    const plan = new Map(project.planes.map((plane) => [
      plane.id,
      Math.max(3, (preferredSeparation.get(plane.id) ?? 3) - relaxation),
    ]));
    const signature = project.planes.map((plane) => plan.get(plane.id)).join(":");
    if (separationSignatures.has(signature)) continue;
    separationSignatures.add(signature);
    separationPlans.push(plan);
  }

  // Search complete, exact-degree assignments in descending scale-aware
  // separation quality. Trying several deterministic category orders and
  // tie-break variants avoids a locally good early capital trapping the
  // final slot. Physically tiny/manual layouts retain the relaxed
  // compatibility path below rather than silently dropping a capital.
  const preparedPlacement = preparedStartAnchors.flatMap((anchor) => {
    const planeIndex = project.planes.findIndex((plane) => plane.id === anchor.planeId);
    const plane = project.planes[planeIndex];
    const province = plane?.provinces.find((candidate) => candidate.id === anchor.provinceId);
    return plane && province ? [{ plane, planeIndex, province, type: anchor.type }] : [];
  });
  const preparedCounts = new Map<StartType, number>();
  for (const item of preparedPlacement) preparedCounts.set(item.type, (preparedCounts.get(item.type) ?? 0) + 1);
  const preparedKeys = new Set(preparedPlacement.map((item) => globalProvinceKey(item.plane.id, item.province.id)));
  const preparedPlanSafe = project.settings.players > 16
    && preparedPlacement.length === project.settings.players
    && preparedKeys.size === preparedPlacement.length
    && (Object.keys(requested) as StartType[]).every((type) => (preparedCounts.get(type) ?? 0) === requested[type])
    && preparedPlacement.every((item) => isEligibleStartProvince(item.province)
      && matchesStartType(item, item.type, adjacency.get(item.plane.id)!)
      && (adjacency.get(item.plane.id)?.get(item.province.id)?.length ?? 0) >= minimumUsefulDegree
      && (!usesConnectedRegions(item.plane) || !bridgeEndpoints.get(item.plane.id)?.has(item.province.id)))
    && preparedPlacement.every((item, index) => preparedPlacement.slice(index + 1).every((other) => {
      if (item.plane.id !== other.plane.id) return true;
      return (distancesFrom(adjacency.get(item.plane.id)!, item.province.id).get(other.province.id) ?? 0)
        >= (preferredSeparation.get(item.plane.id) ?? 3);
    }));
  // Category anchors are planned before authored starts are considered.
  const clearOfAuthoredStarts = (item: ProvinceRef) => !authoredKeys.has(globalProvinceKey(item.plane.id, item.province.id))
    && authoredStartDistance(authoredStarts, item.plane.id, item.province.id) >= 3;
  let selected: ProvinceRef[] = preparedPlanSafe && preparedPlacement.every(clearOfAuthoredStarts)
    ? preparedPlacement.map(({ plane, planeIndex, province }) => ({ plane, planeIndex, province }))
    : [];
  let preparedSubstituted = false;
  if (!selected.length && preparedPlanSafe) {
    // Only authored starts crowd the large prepared plan: keep its other
    // anchors and re-choose just the crowded ones, preferring the kept degree.
    const kept = preparedPlacement.filter(clearOfAuthoredStarts);
    const crowded = preparedPlacement.filter((item) => !clearOfAuthoredStarts(item));
    const keptDegrees = new Set(kept.map((item) => adjacency.get(item.plane.id)?.get(item.province.id)?.length ?? 0));
    const degreeChoices = keptDegrees.size === 1 ? [[...keptDegrees][0]!, undefined] : [undefined];
    substitution:
    for (const separationPlan of separationPlans) {
      for (const forcedDegree of degreeChoices) {
        const attempt: ProvinceRef[] = kept.map(({ plane, planeIndex, province }) => ({ plane, planeIndex, province }));
        for (const [slot, item] of crowded.entries()) {
          const candidate = chooseDistributedStart(project, item.type, attempt, adjacency, twoRingCapacity, bridgeEndpoints,
            `${project.seed}:distributed:prepared-substitute:${slot}`, forcedDegree, separationPlan, planeTargets, adjacency, authoredStarts,
            searchMemo);
          if (!candidate) break;
          attempt.push(candidate);
        }
        if (attempt.length !== project.settings.players) continue;
        selected = attempt;
        preparedSubstituted = true;
        break substitution;
      }
    }
  }
  const separationVariantCount = project.settings.players <= 12 ? 12 : 3;
  for (const separationPlan of selected.length ? [] : separationPlans) {
    for (const degree of candidateDegrees) {
      let bestAttempt: ProvinceRef[] = [];
      let bestNearestSpread = Infinity;
      let bestCapacityCv = Infinity;
      for (let orderIndex = 0; orderIndex < effectivePlacementOrders.length; orderIndex += 1) {
        for (let variant = 0; variant < separationVariantCount; variant += 1) {
          const attempt = exactPlacementAttempt(
            degree,
            separationPlan,
            effectivePlacementOrders[orderIndex]!,
            orderIndex * separationVariantCount + variant,
          );
          if (!attempt.length) continue;
          const nearestDistances = attempt.flatMap((item) => {
            const peers = attempt.filter((other) => other.plane.id === item.plane.id && other.province.id !== item.province.id);
            if (!peers.length) return [];
            const distances = distancesFrom(adjacency.get(item.plane.id)!, item.province.id);
            return [Math.min(...peers.map((other) => distances.get(other.province.id) ?? 99))];
          });
          const nearestSpread = nearestDistances.length ? max(nearestDistances) - min(nearestDistances) : 0;
          const capacities = attempt.map((item) => twoRingCapacity.get(item.plane.id)?.get(item.province.id) ?? 0);
          const capacityCv = coefficientOfVariation(capacities);
          if (nearestSpread < bestNearestSpread
            || (nearestSpread === bestNearestSpread && capacityCv < bestCapacityCv - 1e-9)) {
            bestAttempt = attempt;
            bestNearestSpread = nearestSpread;
            bestCapacityCv = capacityCv;
          }
        }
      }
      if (bestAttempt.length) {
        selected = bestAttempt;
        break;
      }
    }
    if (selected.length) break;
  }

  // A narrow beam of deterministic backtracking handles the common case in
  // which all locally farthest choices leave the final capital boxed out.
  // Large-player atlases use the cheaper greedy search above; their much
  // denser constraint matrix is already repaired by the category basin pass.
  if (!selected.length && project.settings.players <= 12) {
    backtrackingSearch:
    for (const separationPlan of separationPlans) {
      for (const degree of candidateDegrees) {
        for (let orderIndex = 0; orderIndex < effectivePlacementOrders.length; orderIndex += 1) {
          const attempt = backtrackingPlacementAttempt(degree, separationPlan, effectivePlacementOrders[orderIndex]!, orderIndex);
          if (!attempt.length) continue;
          selected = attempt;
          break backtrackingSearch;
        }
      }
    }
  }

  // Some intentionally small or tightly split scenarios cannot satisfy the
  // separation floor. Preserve their exact-degree/category contract when a
  // relaxed exact assignment still exists.
  if (!selected.length) {
    for (const degree of candidateDegrees) {
      const attempt = exactPlacementAttempt(degree, 0, placementOrder, 0);
      if (!attempt.length) continue;
      selected = attempt;
      break;
    }
  }

  // If the requested biome split cannot share one degree, retain the former
  // deterministic best-fit behavior instead of dropping a capital.
  if (!selected.length) {
    for (const type of placementOrder) {
      for (let slot = 0; slot < requested[type]; slot += 1) {
        const candidate = chooseDistributedStart(project, type, selected, adjacency, twoRingCapacity, bridgeEndpoints, `${project.seed}:distributed:${type}:${slot}`, undefined, 0, planeTargets, adjacency, authoredStarts, searchMemo);
        if (!candidate) break;
        selected.push(candidate);
      }
    }
  }

  // A malformed or physically infeasible split must not silently reduce the
  // total number of capitals. Fill remaining slots from safe provinces and
  // record their real category so startAllocation exposes the shortfall.
  while (selected.length < project.settings.players) {
    const candidate = chooseDistributedStart(project, undefined, selected, adjacency, twoRingCapacity, bridgeEndpoints, `${project.seed}:distributed:fallback:${selected.length}`, undefined, 0, planeTargets, adjacency, authoredStarts, searchMemo);
    if (!candidate) break;
    selected.push(candidate);
  }

  // An equal-degree fallback can still be too tightly packed on a heavily
  // split atlas. Repair each affected plane as a category-constrained
  // distance-two independent set, retaining a common degree when one is
  // feasible and relaxing degree parity only before relaxing start safety.
  const repairPlaneSelection = (plane: Plane, planeIndex: number, current: ProvinceRef[]): ProvinceRef[] | undefined => {
    // A lone generated capital still needs repair when it crowds an authored start.
    if (current.length < ((authoredStarts.get(plane.id)?.length ?? 0) ? 1 : 2)) return current;
    const local = adjacency.get(plane.id)!;
    const planeDistancesFrom = (id: string) => distancesFrom(local, id);
    const preferredPlaneSeparation = preferredSeparation.get(plane.id) ?? 3;
    const authoredDistance = (id: string) => authoredStartDistance(authoredStarts, plane.id, id);
    const isAuthored = (id: string) => authoredKeys.has(globalProvinceKey(plane.id, id));
    const clearOfAuthored = (items: readonly ProvinceRef[]) => items.every((item) => authoredDistance(item.province.id) >= 3);
    const minimumPairDistance = (items: readonly ProvinceRef[]) => items.reduce((minimum, item, left) =>
      Math.min(minimum, ...items.slice(left + 1).map((other) =>
        planeDistancesFrom(item.province.id).get(other.province.id) ?? Infinity)), Infinity);
    // Incident-edge counts are fixed during repair: count them once rather
    // than scanning every edge per ranking comparison.
    const incidentEdgeCounts = new Map<string, number>();
    for (const edge of plane.edges) {
      incidentEdgeCounts.set(edge.a, (incidentEdgeCounts.get(edge.a) ?? 0) + 1);
      if (edge.b !== edge.a) incidentEdgeCounts.set(edge.b, (incidentEdgeCounts.get(edge.b) ?? 0) + 1);
    }
    const degreeAfterBorderRepair = (province: Province) => incidentEdgeCounts.get(province.id) ?? 0;
    const regional = usesConnectedRegions(plane);
    const currentMeets = (separation: number) => minimumPairDistance(current) >= separation
      && clearOfAuthored(current)
      && (!regional || current.every(item => !bridgeEndpoints.get(plane.id)?.has(item.province.id)));
    // Like the >20-capital prepared plan below, a substituted prepared plan
    // that already meets spacing keeps degree parity as a best-effort warning
    // rather than re-running the exponential exact-degree search.
    if (currentMeets(preferredPlaneSeparation)
      && (preparedSubstituted || new Set(current.map((item) => degreeAfterBorderRepair(item.province))).size === 1)) return current;
    // Every separation plan was already searched with the authored floor, so
    // an authored start's plane re-searches with a bounded budget and keeps a
    // current common-degree selection at the best spacing it already meets.
    const authoredOnPlane = (authoredStarts.get(plane.id)?.length ?? 0) > 0;

    const counts = new Map<StartType, number>();
    for (const item of current) {
      const type = classifyStartType(item, local);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const prepared = preparedStartAnchors.filter((anchor) => anchor.planeId === plane.id).flatMap((anchor) => {
      const province = plane.provinces.find((item) => item.id === anchor.provinceId);
      return province ? [{ plane, planeIndex, province, type: anchor.type }] : [];
    });
    const preparedCounts = new Map<StartType, number>();
    for (const item of prepared) preparedCounts.set(item.type, (preparedCounts.get(item.type) ?? 0) + 1);
    const preparedMatches = prepared.length === current.length
      && [...counts].every(([type, count]) => preparedCounts.get(type) === count)
      && clearOfAuthored(prepared)
      && prepared.every((item) => matchesStartType(item, item.type, local)
        && !isAuthored(item.province.id)
        && (local.get(item.province.id)?.length ?? 0) >= minimumUsefulDegree
        && (!regional || !bridgeEndpoints.get(plane.id)?.has(item.province.id)));
    const preparedRefs = prepared.map((item) => ({
      plane: item.plane,
      planeIndex: item.planeIndex,
      province: item.province,
    }));
    const preparedMinimumDistance = preparedMatches ? minimumPairDistance(preparedRefs) : -Infinity;
    // Large single-plane fields use a bounded farthest-point anchor plan.
    // Re-running exponential exact-degree search over 24–32 capitals adds no
    // safety value once that prepared plan already meets the scaled spacing;
    // degree parity remains an explicit best-effort warning.
    if (current.length > 20 && preparedMatches && preparedMinimumDistance >= preferredPlaneSeparation) return preparedRefs;
    const currentDegrees = current.map((item) => degreeAfterBorderRepair(item.province));
    const commonDegree = new Set(currentDegrees).size === 1 ? currentDegrees[0] : undefined;
    const commonDegreeCandidates = [...new Set(plane.provinces.filter(isEligibleStartProvince)
      .map(degreeAfterBorderRepair)
      .filter((degree) => degree >= minimumUsefulDegree))]
      .sort((a, b) => (a === commonDegree ? -1 : b === commonDegree ? 1 : 0)
        || Math.abs(a - preferredGeneratedDegree) - Math.abs(b - preferredGeneratedDegree) || a - b);
    const solve = (forcedDegree: number | undefined, requiredSeparation: number): ProvinceRef[] | undefined => {
      const pools = new Map<StartType, ProvinceRef[]>();
      for (const [type, count] of counts) {
        let pool = plane.provinces.filter((province) => isEligibleStartProvince(province)
          && !isAuthored(province.id)
          && matchesStartType({ plane, province }, type, local)
          && (local.get(province.id)?.length ?? 0) >= minimumUsefulDegree
          && (forcedDegree === undefined || degreeAfterBorderRepair(province) === forcedDegree))
          .map((province) => ({ plane, planeIndex, province }));
        const bridgeSafe = pool.filter((item) => !bridgeEndpoints.get(plane.id)?.has(item.province.id));
        if (regional || bridgeSafe.length >= count) pool = bridgeSafe;
        pools.set(type, pool);
      }
      const remaining = new Map(counts);
      const working: ProvinceRef[] = [];
      let visitedNodes = 0;
      const nodeBudget = authoredOnPlane ? 12_000 : 250_000;
      // Index every pooled province once. conflictsFrom[from] lists each `to`
      // closer than the required separation measured from `from` (unreachable
      // never conflicts) and blockers[to] lists every such `from`. blockedBy
      // counts each candidate's conflicts with the working set, so a node
      // filters its pools with typed lookups instead of distance queries.
      const slotById = new Map<string, number>();
      for (const pool of pools.values()) for (const item of pool) if (!slotById.has(item.province.id)) slotById.set(item.province.id, slotById.size);
      const slotCount = slotById.size;
      const slotIds = [...slotById.keys()];
      const poolSlots = new Map([...pools].map(([type, pool]) => [type, pool.map((item) => slotById.get(item.province.id)!)]));
      const conflictsFrom: number[][] = [];
      const blockers: number[][] = Array.from({ length: slotCount }, () => []);
      for (let from = 0; from < slotCount; from += 1) {
        const distances = planeDistancesFrom(slotIds[from]!);
        const row: number[] = [];
        for (let to = 0; to < slotCount; to += 1) {
          if ((distances.get(slotIds[to]!) ?? Infinity) >= requiredSeparation) continue;
          row.push(to);
          blockers[to]!.push(from);
        }
        conflictsFrom.push(row);
      }
      // Marks the current node's candidate slots while their conflicts are counted.
      const nextMark = new Int32Array(slotCount);
      let nextGeneration = 0;
      const authoredClear = new Uint8Array(slotCount);
      const degreeDelta = new Int32Array(slotCount);
      for (let slot = 0; slot < slotCount; slot += 1) {
        authoredClear[slot] = authoredDistance(slotIds[slot]!) >= 3 ? 1 : 0;
        degreeDelta[slot] = Math.abs((incidentEdgeCounts.get(slotIds[slot]!) ?? 0) - preferredGeneratedDegree);
      }
      // Deterministic per-type tie-break jitter, hashed on first use (-1 = unset).
      const jitterByType = new Map<StartType, Int32Array>();
      const blockedBy = new Int32Array(slotCount);
      const inWorking = new Uint8Array(slotCount);
      const search = (): ProvinceRef[] | undefined => {
        if (working.length === current.length) return [...working];
        if (visitedNodes >= nodeBudget) return undefined;
        let nextType: StartType | undefined;
        let nextCandidates: ProvinceRef[] = [];
        let nextSlots: number[] = [];
        let tightness = Infinity;
        for (const [type, needed] of remaining) {
          if (needed <= 0) continue;
          const pool = pools.get(type) ?? [];
          const slots = poolSlots.get(type) ?? [];
          const available: ProvinceRef[] = [];
          const availableSlots: number[] = [];
          for (let index = 0; index < pool.length; index += 1) {
            const slot = slots[index]!;
            if (authoredClear[slot] !== 1 || blockedBy[slot] !== 0 || inWorking[slot] !== 0) continue;
            available.push(pool[index]!);
            availableSlots.push(slot);
          }
          if (available.length < needed) return undefined;
          const candidateTightness = available.length / needed;
          if (candidateTightness < tightness) {
            nextType = type;
            nextCandidates = available;
            nextSlots = availableSlots;
            tightness = candidateTightness;
          }
        }
        if (!nextType) return undefined;
        let jitter = jitterByType.get(nextType);
        if (!jitter) {
          jitter = new Int32Array(slotCount).fill(-1);
          jitterByType.set(nextType, jitter);
        }
        // Each candidate's conflicts with the other candidates of this node.
        // Slots map one-to-one onto province ids, so skipping the candidate's
        // own slot excludes it exactly as comparing ids would.
        nextGeneration += 1;
        for (const slot of nextSlots) nextMark[slot] = nextGeneration;
        const conflictCounts = new Int32Array(nextCandidates.length);
        for (let index = 0; index < nextCandidates.length; index += 1) {
          const slot = nextSlots[index]!;
          let count = 0;
          for (const other of conflictsFrom[slot]!) if (other !== slot && nextMark[other] === nextGeneration) count += 1;
          conflictCounts[index] = count;
          if (jitter[slot]! < 0) {
            jitter[slot] = hashString(`${project.seed}:plane-start-repair:${plane.id}:${nextType}:${slotIds[slot]!}`) % 100000;
          }
        }
        // Rank by position with precomputed keys; the stable sort yields the
        // same order as ranking the candidates with the equivalent comparator.
        const typeJitter = jitter;
        const order = nextCandidates.map((_, index) => index).sort((a, b) =>
          conflictCounts[a]! - conflictCounts[b]!
          || degreeDelta[nextSlots[a]!]! - degreeDelta[nextSlots[b]!]!
          || typeJitter[nextSlots[a]!]! - typeJitter[nextSlots[b]!]!
          || nextCandidates[a]!.province.index - nextCandidates[b]!.province.index);
        for (const index of order) {
          if (visitedNodes >= nodeBudget) break;
          visitedNodes += 1;
          const slot = nextSlots[index]!;
          working.push(nextCandidates[index]!);
          inWorking[slot] += 1;
          for (const candidate of blockers[slot]!) blockedBy[candidate] += 1;
          remaining.set(nextType, remaining.get(nextType)! - 1);
          const result = search();
          if (result) return result;
          remaining.set(nextType, remaining.get(nextType)! + 1);
          working.pop();
          inWorking[slot] -= 1;
          for (const candidate of blockers[slot]!) blockedBy[candidate] -= 1;
        }
        return undefined;
      };
      return search();
    };
    const preparedDegrees = new Set(preparedRefs.map((item) => degreeAfterBorderRepair(item.province)));
    if (resolvePlaneOwnershipMode(plane) === "sparse"
      && preparedMatches && preparedDegrees.size === 1 && preparedMinimumDistance >= preferredPlaneSeparation) {
      return preparedRefs;
    }
    if (commonDegree !== undefined) {
      for (let separation = preferredPlaneSeparation; separation >= 3; separation -= 1) {
        if (authoredOnPlane && currentMeets(separation)) return current;
        const common = solve(commonDegree, separation);
        if (common) return common;
        if (preparedMatches && preparedDegrees.size === 1 && preparedDegrees.has(commonDegree)
          && preparedMinimumDistance >= separation) return preparedRefs;
      }
    }
    for (let separation = preferredPlaneSeparation; separation >= 3; separation -= 1) {
      for (const degree of commonDegreeCandidates.filter((candidate) => candidate !== commonDegree)) {
        const common = solve(degree, separation);
        if (common) return common;
      }
      if (preparedMatches && preparedDegrees.size === 1 && preparedMinimumDistance >= separation) return preparedRefs;
    }
    if (preparedMatches && preparedMinimumDistance >= 3) return preparedRefs;
    return solve(undefined, 3);
  };
  for (let planeIndex = 0; planeIndex < project.planes.length; planeIndex += 1) {
    const plane = project.planes[planeIndex]!;
    const current = selected.filter((item) => item.plane.id === plane.id);
    const repaired = repairPlaneSelection(plane, planeIndex, current);
    if (!repaired || repaired === current) continue;
    selected = selected.filter((item) => item.plane.id !== plane.id).concat(repaired);
  }
  for (const candidate of selected) {
    const actualType = classifyStartType(candidate, adjacency.get(candidate.plane.id)!);
    markStart(candidate.province, actualType);
  }
  for (const plane of project.planes) {
    const specificStartIds = project.specificStarts
      .filter((start) => start.planeId === plane.id)
      .map((start) => start.provinceId);
    repairStartBorders(plane, specificStartIds);
    clearStartZoneGuardians(plane, specificStartIds);
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
  const candidates = plane.provinces.filter((province) => !protectedProvinceIds.has(province.id)
      && !isBlockedProvince(province)
      && !province.start);
  const distance = (item: Province) => startDistanceMaps.length
    ? Math.min(...startDistanceMaps.map((distances) => distances.get(item.id) ?? 0))
    : 99;
  const addGuardian = (province: Province, suffix: string) => {
    const rng = new SeededRandom(`${plane.id}:guardian-${suffix}:${province.id}`);
    province.defenders = [guardianFor(
      plane.kind,
      plane.variant ?? ARCHETYPE_PROFILES[plane.kind].defaultVariant,
      province,
      rng,
      `${plane.id}:${province.id}:${suffix}`,
    )];
  };
  const activeVariant = plane.variant ?? ARCHETYPE_PROFILES[plane.kind].defaultVariant;
  if (usesHardSpecialGuardians(plane.kind, activeVariant)) {
    const target = Math.round(candidates.length * 0.25);
    const guarded = candidates.filter((province) => province.defenders.length > 0)
      .sort((a, b) => (hashString(`${plane.id}:guardian-trim:${a.id}`) % 100000)
        - (hashString(`${plane.id}:guardian-trim:${b.id}`) % 100000) || a.index - b.index);
    for (const province of guarded.slice(target)) province.defenders = [];
    const current = Math.min(target, guarded.length);
    const fill = candidates.filter((province) => !province.defenders.length)
      .sort((a, b) => (hashString(`${plane.id}:guardian-coverage:${a.id}`) % 100000)
        - (hashString(`${plane.id}:guardian-coverage:${b.id}`) % 100000) || a.index - b.index);
    for (const province of fill.slice(0, Math.max(0, target - current))) addGuardian(province, "coverage");
  }
  if (!plane.provinces.some((province) => province.defenders.length > 0)) {
    const province = candidates.sort((a, b) => {
      return distance(b) - distance(a) || a.index - b.index;
    })[0];
    if (province) addGuardian(province, "fallback");
  }
  if (["cave", "cavern", "underworld"].includes(plane.kind)
    && !plane.provinces.some((province) => isWaterProvince(province) && province.defenders.length > 0)) {
    let flooded = candidates.filter(isWaterProvince).sort((a, b) => distance(b) - distance(a) || a.index - b.index)[0];
    // On a compact flooded cave, every original water chamber can land inside
    // a capital's protected two-ring. Extend that same connected cave sea to
    // the farthest legal dry province instead of placing guardians in an
    // expansion zone or leaving the aquatic realm unrepresented.
    if (!flooded && (plane.kind === "cave" || plane.kind === "cavern")) {
      const byId = new Map(plane.provinces.map((province) => [province.id, province]));
      const waterSources = plane.provinces.filter(isWaterProvince).sort((a, b) => a.index - b.index);
      const queue = waterSources.map((province) => province.id);
      const previous = new Map<string, string | undefined>(queue.map((id) => [id, undefined]));
      const pathDistance = new Map(queue.map((id) => [id, 0]));
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const id = queue[cursor]!;
        for (const neighbour of adjacency.get(id) ?? []) {
          const province = byId.get(neighbour);
          if (!province || previous.has(neighbour) || startIds.has(neighbour) || isBlockedProvince(province)) continue;
          previous.set(neighbour, id);
          pathDistance.set(neighbour, (pathDistance.get(id) ?? 0) + 1);
          queue.push(neighbour);
        }
      }
      const target = candidates.filter((province) => !isWaterProvince(province) && previous.has(province.id))
        .sort((a, b) => distance(b) - distance(a)
          || (pathDistance.get(a.id) ?? Infinity) - (pathDistance.get(b.id) ?? Infinity)
          || a.index - b.index)[0];
      if (target) {
        const route: Province[] = [];
        let cursor: string | undefined = target.id;
        while (cursor !== undefined) {
          const province = byId.get(cursor);
          if (province) route.push(province);
          cursor = previous.get(cursor);
        }
        const newlyFlooded = route.filter((province) => !isWaterProvince(province));
        for (const province of newlyFlooded) floodCaveProvince(province, plane.kind, false);
        assignArchetypeDetails(newlyFlooded, plane.kind, plane.variant, `${plane.id}:protected-flood-route`);
        for (const province of newlyFlooded) if (protectedProvinceIds.has(province.id)) province.defenders = [];
        flooded = target;
      }
    }
    if (flooded) addGuardian(flooded, "flooded");
  }
}

function clearStartZoneThrones(plane: Plane, extraStartIds: string[] = []) {
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const startIds = new Set(plane.provinces
    .filter((province) => province.start || province.teamStart !== undefined)
    .map((province) => province.id));
  for (const id of extraStartIds) if (adjacency.has(id)) startIds.add(id);
  const protectedIds = new Set(startIds);
  for (const startId of startIds) {
    for (const neighbour of adjacency.get(startId) ?? []) protectedIds.add(neighbour);
  }
  for (const province of plane.provinces) {
    if (!protectedIds.has(province.id)) continue;
    province.throne = "avoid";
    province.fixedThrone = undefined;
    province.manySites = false;
  }
}

function appendGuardianCapacityWarnings(project: MapProject) {
  for (const plane of project.planes) {
    const variant = plane.variant ?? ARCHETYPE_PROFILES[plane.kind].defaultVariant;
    if (isCorePlaneForSizing(plane) || !usesHardSpecialGuardians(plane.kind, variant)) continue;
    const startIds = new Set(plane.provinces
      .filter((province) => province.start || province.teamStart !== undefined)
      .map((province) => province.id));
    for (const start of project.specificStarts) if (start.planeId === plane.id) startIds.add(start.provinceId);
    if (!startIds.size) continue;
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const protectedIds = new Set<string>();
    for (const startId of startIds) {
      const distances = shortestDistances(adjacency, startId);
      for (const province of plane.provinces) if ((distances.get(province.id) ?? 99) <= 2) protectedIds.add(province.id);
    }
    const eligible = plane.provinces.filter((province) => !protectedIds.has(province.id) && !isBlockedProvince(province));
    const guarded = eligible.filter((province) => province.defenders.length > 0).length;
    if (guarded >= 3) continue;
    project.generationWarnings!.push(
      `${plane.name} retained only ${guarded} themed guardian province${guarded === 1 ? "" : "s"}: ${startIds.size} start${startIds.size === 1 ? "" : "s"} and their protected two-rings leave ${eligible.length} eligible neutral province${eligible.length === 1 ? "" : "s"}. Increase the bonus-plane size or reduce starts/connection degree.`,
    );
  }
}

/** Unbounded movement distances from one start province on one adjacency graph. */
type StartDistanceLookup = (adjacency: Map<string, string[]>, start: string) => ReadonlyMap<string, number>;

/**
 * Memoize `shortestDistances(adjacency, start)` per adjacency graph object for
 * one start-placement pass. Start searches ask for the same capitals'
 * distance maps on every candidate evaluation; callers must not mutate the
 * adjacency graphs while the cache is in use.
 */
function createStartDistanceCache(): StartDistanceLookup {
  const byGraph = new WeakMap<Map<string, string[]>, Map<string, ReadonlyMap<string, number>>>();
  return (adjacency, start) => {
    let graphCache = byGraph.get(adjacency);
    if (!graphCache) {
      graphCache = new Map();
      byGraph.set(adjacency, graphCache);
    }
    let distances = graphCache.get(start);
    if (!distances) {
      distances = shortestDistances(adjacency, start);
      graphCache.set(start, distances);
    }
    return distances;
  };
}

/**
 * Memo shared by the start searches of one placement pass. Terrain, edges,
 * province order and adjacency graphs must stay fixed while it is in use.
 */
interface StartSearchMemo {
  distancesFrom: StartDistanceLookup;
  /**
   * `distancesFrom(adjacency, start)` laid out by position in
   * `plane.provinces`, with -1 where the map has no entry.
   */
  distancesByPosition(plane: Plane, adjacency: Map<string, string[]>, start: string): Int32Array;
  /** `matchesStartType` for `plane.provinces[position]` measured on `adjacency`. */
  matchesTypeAt(plane: Plane, position: number, type: StartType, adjacency: Map<string, string[]>): boolean;
}

interface PositionalGraph {
  positionById: Map<string, number>;
  neighbours: Int32Array[];
}

/**
 * `adjacency` re-indexed by position in `plane.provinces`, or undefined when
 * that is not a faithful copy: duplicate province ids, or graph nodes that
 * are not provinces. Neighbour ids that are not provinces are dropped; a BFS
 * reaches them but they have no neighbours of their own to continue from.
 */
function positionalGraph(plane: Plane, adjacency: Map<string, string[]>): PositionalGraph | undefined {
  const positionById = new Map<string, number>();
  for (let position = 0; position < plane.provinces.length; position += 1) {
    const id = plane.provinces[position]!.id;
    if (positionById.has(id)) return undefined;
    positionById.set(id, position);
  }
  if (adjacency.size !== positionById.size) return undefined;
  for (const id of adjacency.keys()) if (!positionById.has(id)) return undefined;
  const neighbours = plane.provinces.map((province) => {
    const positions: number[] = [];
    for (const id of adjacency.get(province.id) ?? []) {
      const position = positionById.get(id);
      if (position !== undefined) positions.push(position);
    }
    return Int32Array.from(positions);
  });
  return { positionById, neighbours };
}

function createStartSearchMemo(): StartSearchMemo {
  const distancesFrom = createStartDistanceCache();
  const layouts = new Map<Map<string, string[]>, {
    plane: Plane;
    graph: PositionalGraph | undefined;
    byStart: Map<string, Int32Array>;
  }>();
  const typeMatches = new Map<Plane, { adjacency: Map<string, string[]>; byType: Map<StartType, Uint8Array> }>();
  const layOut = (plane: Plane, distances: ReadonlyMap<string, number>) => {
    const layout = new Int32Array(plane.provinces.length);
    for (let position = 0; position < layout.length; position += 1) layout[position] = distances.get(plane.provinces[position]!.id) ?? -1;
    return layout;
  };
  // The same unbounded BFS as shortestDistances, over positions: every
  // province's distance is identical, and it never builds a string-keyed map.
  const positionalDistances = (graph: PositionalGraph, start: number) => {
    const layout = new Int32Array(graph.neighbours.length).fill(-1);
    const queue = new Int32Array(graph.neighbours.length);
    layout[start] = 0;
    queue[0] = start;
    let tail = 1;
    for (let head = 0; head < tail; head += 1) {
      const current = queue[head]!;
      const distance = layout[current]! + 1;
      for (const next of graph.neighbours[current]!) {
        if (layout[next]! >= 0) continue;
        layout[next] = distance;
        queue[tail] = next;
        tail += 1;
      }
    }
    return layout;
  };
  return {
    distancesFrom,
    distancesByPosition(plane, adjacency, start) {
      let entry = layouts.get(adjacency);
      if (!entry) {
        entry = { plane, graph: positionalGraph(plane, adjacency), byStart: new Map() };
        layouts.set(adjacency, entry);
      }
      if (entry.plane !== plane) return layOut(plane, distancesFrom(adjacency, start));
      let layout = entry.byStart.get(start);
      if (!layout) {
        const startPosition = entry.graph?.positionById.get(start);
        layout = entry.graph && startPosition !== undefined
          ? positionalDistances(entry.graph, startPosition)
          : layOut(plane, distancesFrom(adjacency, start));
        entry.byStart.set(start, layout);
      }
      return layout;
    },
    matchesTypeAt(plane, position, type, adjacency) {
      const province = plane.provinces[position]!;
      let entry = typeMatches.get(plane);
      if (!entry) {
        entry = { adjacency, byType: new Map() };
        typeMatches.set(plane, entry);
      }
      if (entry.adjacency !== adjacency) return matchesStartType({ plane, province }, type, adjacency);
      let states = entry.byType.get(type);
      if (!states) {
        states = new Uint8Array(plane.provinces.length);
        entry.byType.set(type, states);
      }
      // 0 = not yet evaluated, 1 = no, 2 = yes.
      if (states[position] === 0) states[position] = matchesStartType({ plane, province }, type, adjacency) ? 2 : 1;
      return states[position] === 2;
    },
  };
}

function chooseDistributedStart(
  project: MapProject,
  requestedType: StartType | undefined,
  selected: ProvinceRef[],
  adjacencyByPlane: Map<string, Map<string, string[]>>,
  twoRingCapacityByPlane: Map<string, Map<string, number>>,
  bridgeEndpointsByPlane: Map<string, Set<string>>,
  seed: string,
  forcedDegree?: number,
  minimumSeparation: number | ReadonlyMap<string, number> = 0,
  planeTargets: ReadonlyMap<StartType, ReadonlyMap<string, number>> = generatedStartPlaneTargets(
    project,
    normalizeStartDistribution(project.settings.startDistribution, project.settings.players),
  ),
  separationAdjacencyByPlane: Map<string, Map<string, string[]>> = adjacencyByPlane,
  authoredStarts: AuthoredStartsByPlane = NO_AUTHORED_STARTS,
  memo: StartSearchMemo = createStartSearchMemo(),
): ProvinceRef | undefined {
  const target = project.settings.startDegreeTarget ?? 4;
  const selectedDegrees = selected.map((item) => adjacencyByPlane.get(item.plane.id)?.get(item.province.id)?.length ?? 0);
  const preferredDegree = forcedDegree ?? (selectedDegrees.length ? modalInteger(selectedDegrees) : undefined);
  const selectedCapacities = selected.map((item) => twoRingCapacityByPlane.get(item.plane.id)?.get(item.province.id) ?? 0);
  const preferredCapacity = selectedCapacities.length ? mean(selectedCapacities) : undefined;
  const capacityTolerance = preferredCapacity === undefined ? 0 : Math.max(2, Math.round(preferredCapacity * 0.2));
  const eligiblePlaneIds = requestedType === undefined
    ? new Set(project.planes.filter((plane) => !plane.noGeneratedStarts).map((plane) => plane.id))
    : new Set(eligibleGeneratedStartPlaneIndexes(project, requestedType).map((index) => project.planes[index]!.id));
  const selectedKeys = new Set(selected.map((item) => globalProvinceKey(item.plane.id, item.province.id)));
  for (const [planeId, starts] of authoredStarts) for (const start of starts) selectedKeys.add(globalProvinceKey(planeId, start.provinceId));
  const authoredRequired = minimumSeparation === 0 ? 0 : 3;
  const startsByPlane = new Map(project.planes.map((plane) => [plane.id, selected.filter((item) => item.plane.id === plane.id).map((item) => item.province)]));
  // Each selected capital's distances on its plane, by province position.
  const distanceLayouts = project.planes.map((plane) => {
    const adjacency = separationAdjacencyByPlane.get(plane.id)!;
    return (startsByPlane.get(plane.id) ?? []).map((start) => memo.distancesByPosition(plane, adjacency, start.id));
  });
  // The selected set is fixed for this call, so each plane's typed load is too.
  const planeTypeLoads = new Map(project.planes.map((plane) => [plane.id, requestedType === undefined ? 0 : selected.filter((item) => item.plane.id === plane.id
    && matchesStartType(item, requestedType, adjacencyByPlane.get(item.plane.id)!)).length]));
  const computeCandidateFacts = (plane: Plane, planeIndex: number, position: number) => {
    const province = plane.provinces[position]!;
    const adjacency = adjacencyByPlane.get(plane.id)!;
    const ref = { plane, planeIndex, province };
    const planeQuota = requestedType === undefined ? Infinity : planeTargets.get(requestedType)?.get(plane.id) ?? 0;
    const planeTypeLoad = planeTypeLoads.get(plane.id) ?? 0;
    if (!eligiblePlaneIds.has(plane.id)
      || planeTypeLoad >= planeQuota
      || !isEligibleStartProvince(province)
      || selectedKeys.has(globalProvinceKey(plane.id, province.id))
      || (requestedType && !memo.matchesTypeAt(plane, position, requestedType, adjacency))) return undefined;
    const planeStarts = startsByPlane.get(plane.id) ?? [];
    const layouts = distanceLayouts[planeIndex]!;
    const requiredSeparation = separationForPlane(minimumSeparation, plane.id);
    // The nearest selected capital; one that cannot reach this province counts as 0.
    let generatedDistance = layouts.length ? Infinity : 6;
    for (const layout of layouts) generatedDistance = Math.min(generatedDistance, Math.max(0, layout[position]!));
    // Authored starts hold the hard three-move floor in every spaced search,
    // so they never cost generated capitals their scaled mutual spacing.
    const authoredDistance = authoredStartDistance(authoredStarts, plane.id, province.id);
    return {
      ref,
      adjacency,
      planeStarts,
      distance: Math.min(generatedDistance, authoredDistance),
      spaced: (!selected.length || generatedDistance >= requiredSeparation) && authoredDistance >= authoredRequired,
      safe: generatedDistance >= Math.max(3, requiredSeparation) && authoredDistance >= 3,
      degree: adjacency.get(province.id)?.length ?? 0,
      capacity: twoRingCapacityByPlane.get(plane.id)?.get(province.id) ?? 0,
      incidentBridge: bridgeEndpointsByPlane.get(plane.id)?.has(province.id) ?? false,
      requiredSeparation,
    };
  };
  // Every input above is fixed for this call, so each province's facts are
  // computed once (by plane and position) rather than once per ranking pass.
  const factsByPlane = project.planes.map((plane) =>
    new Array<ReturnType<typeof computeCandidateFacts> | null | undefined>(plane.provinces.length));
  const rawCandidateFacts = (plane: Plane, planeIndex: number, position: number) => {
    const row = factsByPlane[planeIndex]!;
    let facts = row[position];
    if (facts === undefined) {
      facts = computeCandidateFacts(plane, planeIndex, position) ?? null;
      row[position] = facts;
    }
    return facts ?? undefined;
  };
  // A regional passage endpoint can have the closest two-ring capacity while
  // still sitting on a graph bridge. Prefer genuinely safe regional capital
  // candidates before capacity matching narrows the pool. Keep Underworld's
  // ranking and physically constrained fallback behavior unchanged.
  const regionalBridgeSafePlanes = new Set(project.planes.flatMap((plane, planeIndex) => {
    if (!usesConnectedRegions(plane)) return [];
    const safe = plane.provinces.some((_, position) => {
      const facts = rawCandidateFacts(plane, planeIndex, position);
      if (!facts || facts.incidentBridge || !facts.safe) return false;
      if (forcedDegree !== undefined) return facts.degree === forcedDegree;
      if (preferredDegree !== undefined) return facts.degree === preferredDegree;
      return facts.degree >= Math.min(target, 4);
    });
    return safe ? [plane.id] : [];
  }));
  const candidateFacts = (plane: Plane, planeIndex: number, position: number) => {
    const facts = rawCandidateFacts(plane, planeIndex, position);
    return facts?.incidentBridge && regionalBridgeSafePlanes.has(plane.id) ? undefined : facts;
  };
  // Blocking start-edge counts per province, built once per plane on demand
  // (an edge counts once for each distinct endpoint, as an incident filter would).
  const blockingEdgeCounts = new Map<Plane, Map<string, number>>();
  const blockingEdgesAt = (plane: Plane, provinceId: string) => {
    let counts = blockingEdgeCounts.get(plane);
    if (!counts) {
      counts = new Map();
      for (const edge of plane.edges) {
        if (!blocksReliableStartEdge(edge)) continue;
        counts.set(edge.a, (counts.get(edge.a) ?? 0) + 1);
        if (edge.b !== edge.a) counts.set(edge.b, (counts.get(edge.b) ?? 0) + 1);
      }
      blockingEdgeCounts.set(plane, counts);
    }
    return counts.get(provinceId) ?? 0;
  };
  const hasSafePreferredDegree = preferredDegree !== undefined && project.planes.some((plane, planeIndex) => plane.provinces.some((_, position) => {
    const facts = candidateFacts(plane, planeIndex, position);
    return facts?.degree === preferredDegree && facts.safe;
  }));
  let closestCapacityDifference = Infinity;
  if (preferredCapacity !== undefined) {
    for (let planeIndex = 0; planeIndex < project.planes.length; planeIndex += 1) {
      for (let position = 0; position < project.planes[planeIndex]!.provinces.length; position += 1) {
        const facts = candidateFacts(project.planes[planeIndex]!, planeIndex, position);
        if (!facts || !facts.safe || (forcedDegree !== undefined && facts.degree !== forcedDegree)) continue;
        if (hasSafePreferredDegree && facts.degree !== preferredDegree) continue;
        closestCapacityDifference = Math.min(closestCapacityDifference, Math.abs(facts.capacity - preferredCapacity));
      }
    }
  }
  const hasComparableCapacity = closestCapacityDifference <= capacityTolerance;
  const hasBridgeSafeCandidate = project.planes.some((plane, planeIndex) => plane.provinces.some((_, position) => {
    const facts = candidateFacts(plane, planeIndex, position);
    if (!facts || facts.incidentBridge || !facts.safe) return false;
    if (forcedDegree !== undefined && facts.degree !== forcedDegree) return false;
    if (hasSafePreferredDegree && facts.degree !== preferredDegree) return false;
    if (hasComparableCapacity && preferredCapacity !== undefined
      && Math.abs(facts.capacity - preferredCapacity) > closestCapacityDifference) return false;
    return true;
  }));
  let best: ProvinceRef | undefined;
  let bestScore = -Infinity;
  for (let planeIndex = 0; planeIndex < project.planes.length; planeIndex += 1) {
    const plane = project.planes[planeIndex]!;
    for (let position = 0; position < plane.provinces.length; position += 1) {
      const facts = candidateFacts(plane, planeIndex, position);
      if (!facts) continue;
      const province = plane.provinces[position]!;
      const { ref, planeStarts, distance, spaced, safe, degree, capacity, incidentBridge, requiredSeparation } = facts;
      if (forcedDegree !== undefined && degree !== forcedDegree) continue;
      if (!spaced) continue;
      if (hasSafePreferredDegree && (degree !== preferredDegree || !safe)) continue;
      if (hasComparableCapacity && preferredCapacity !== undefined
        && Math.abs(capacity - preferredCapacity) > closestCapacityDifference) continue;
      if (hasBridgeSafeCandidate && incidentBridge) continue;
      const load = planeStarts.length / Math.max(1, plane.provinces.length);
      const blockingEdges = blockingEdgesAt(plane, province.id);
      const targetScore = degree >= target ? 36 - Math.abs(degree - target) * 4 : -80 - (target - degree) * 25;
      const parityScore = preferredDegree === undefined ? 0 : degree === preferredDegree ? 64 : -Math.abs(degree - preferredDegree) * 24;
      const capacityScore = preferredCapacity === undefined ? 0 : -Math.abs(capacity - preferredCapacity) * 14;
      const sparseBasinScore = preferredCapacity === undefined && resolvePlaneOwnershipMode(plane) === "sparse"
        ? capacity * 14
        : 0;
      const flags = effectiveProvinceTerrainFlags(province);
      const terrainBonus = flags.has("farm") ? 4 : flags.has("cave") || flags.size === 0 ? 2 : 0;
      const searchJitter = requiredSeparation > 0
        ? (hashString(`${seed}:separation-search:${plane.id}:${province.id}`) % 1000) / 80
        : (hashString(`${seed}:${plane.id}:${province.id}`) % 1000) / 10000;
      const score = distance * 28 + targetScore + parityScore + capacityScore + sparseBasinScore + terrainBonus - load * 520 - blockingEdges * 120
        - (incidentBridge ? 160 : 0)
        + searchJitter;
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
  const bridgeKeys = graphBridgeKeys(plane);
  const bridgeEndpoints = new Set<string>();
  for (const edge of plane.edges) {
    if (!bridgeKeys.has(connectionKey(edge.a, edge.b))) continue;
    bridgeEndpoints.add(edge.a);
    bridgeEndpoints.add(edge.b);
  }
  const hasBridgeSafeCandidate = candidates.some((candidate) => !bridgeEndpoints.has(candidate.id)
    && (adjacency.get(candidate.id)?.length ?? 0) >= degreeTarget);
  let best: Province | undefined;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (starts.some((start) => start.id === candidate.id)) continue;
    const degree = adjacency.get(candidate.id)?.length ?? 0;
    const distances = shortestDistances(adjacency, candidate.id);
    const separation = starts.length ? Math.min(...starts.map((start) => distances.get(start.id) ?? 0)) : 6;
    const blocking = plane.edges.filter((edge) => (edge.a === candidate.id || edge.b === candidate.id) && blocksReliableStartEdge(edge)).length;
    const score = separation * 28 + (degree >= degreeTarget ? 36 - Math.abs(degree - degreeTarget) * 4 : -80 - (degreeTarget - degree) * 25)
      - blocking * 120 - (hasBridgeSafeCandidate && bridgeEndpoints.has(candidate.id) ? 160 : 0)
      + (hashString(`${seed}:${candidate.id}`) % 1000) / 10000;
    if (score > bestScore || (score === bestScore && candidate.index < (best?.index ?? Infinity))) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

// Start scoring asks this for every candidate many times per pass; rebuilding
// the lookup on each call dominated generation time on large atlases.
const provinceLookupCache = new WeakMap<readonly Province[], Map<string, Province>>();

function provinceLookup(plane: Pick<Plane, "provinces">): Map<string, Province> {
  let lookup = provinceLookupCache.get(plane.provinces);
  if (!lookup || lookup.size !== plane.provinces.length) {
    lookup = new Map(plane.provinces.map((item) => [item.id, item]));
    provinceLookupCache.set(plane.provinces, lookup);
  }
  return lookup;
}

function matchesStartType(ref: Pick<ProvinceRef, "plane" | "province">, type: StartType, adjacency: Map<string, string[]>): boolean {
  const { plane, province } = ref;
  const overland = isSurfaceCorePlaneForSizing(plane);
  if (type === "water") return overland && isWaterProvince(province);
  if (type === "coastal") {
    if (!overland || isWaterProvince(province)) return false;
    const byId = provinceLookup(plane);
    return (adjacency.get(province.id) ?? []).some((id) => {
      const neighbour = byId.get(id);
      return neighbour ? isWaterProvince(neighbour) : false;
    });
  }
  if (type === "cave") return !isWaterProvince(province)
    && (ARCHETYPE_PROFILES[plane.kind].caveFamily || (overland && isCaveProvince(province)));
  if (type === "other") return !overland && !ARCHETYPE_PROFILES[plane.kind].caveFamily && !isWaterProvince(province);
  if (!overland || isWaterProvince(province) || isCaveProvince(province)) return false;
  const byId = provinceLookup(plane);
  return !(adjacency.get(province.id) ?? []).some((id) => {
    const neighbour = byId.get(id);
    return neighbour ? isWaterProvince(neighbour) : false;
  });
}

function classifyStartType(ref: ProvinceRef, adjacency: Map<string, string[]>): StartType {
  return classifyCurrentStart(ref.plane, ref.province, adjacency);
}

/** Derived from the present map, including edits made after generation. */
export function classifyCurrentStart(plane: Plane, province: Province, adjacency = adjacencyFor(plane, { traversableOnly: true })): StartType {
  if (isWaterProvince(province)) return "water";
  if (isCaveProvince(province) || ARCHETYPE_PROFILES[plane.kind].caveFamily) return "cave";
  if (!isSurfaceCorePlaneForSizing(plane)) return "other";
  const neighbours = new Set(adjacency.get(province.id) ?? []);
  return plane.provinces.some((item) => neighbours.has(item.id) && isWaterProvince(item)) ? "coastal" : "land";
}

function isEligibleStartProvince(province: Province): boolean {
  return !province.start && !province.noStart && !isBlockedProvince(province);
}

function markStart(province: Province, type: StartType) {
  province.start = true;
  province.startType = type;
  prepareProvinceForPlayerStart(province);
  province.manySites = false;
}

function repairStartBorders(plane: Plane, extraStartIds: readonly string[] = []) {
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  const protectedStarts = new Set(plane.provinces
    .filter((province) => province.start || province.teamStart !== undefined)
    .map((province) => province.id));
  for (const id of extraStartIds) if (byId.has(id)) protectedStarts.add(id);
  for (const edge of plane.edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b || (!protectedStarts.has(a.id) && !protectedStarts.has(b.id)) || !blocksReliableStartEdge(edge)) continue;
    const blockedNeighbour = protectedStarts.has(a.id) ? b : a;
    if (isBlockedProvince(blockedNeighbour)) {
      blockedNeighbour.terrain = ARCHETYPE_PROFILES[plane.kind].caveFamily ? "cave" : "highland";
      blockedNeighbour.terrainFlags = blockedNeighbour.terrainFlags?.filter((flag) => flag !== "cavewall");
      blockedNeighbour.biome = biomeForTerrain(blockedNeighbour.terrain);
      blockedNeighbour.noStart = false;
      blockedNeighbour.population = Math.round(TERRAIN_POPULATION[blockedNeighbour.terrain] * ARCHETYPE_PROFILES[plane.kind].populationScale);
      assignArchetypeDetails([blockedNeighbour], plane.kind, plane.variant, `${plane.id}:start-repair`);
    }
    edge.kind = "standard";
    edge.special = undefined;
  }
}

/** Generation stage; strategic river chokepoints take effect in finalizeGeneratedRivers. */
export function applyGeneratedOverlandTopology(
  plane: Plane,
  requestedMode: OverlandTopologyMode | undefined,
  seed: string,
  extraStartIds: readonly string[] = [],
) {
  const mode = normalizeOverlandTopologyMode(requestedMode);
  if (mode === "competitive" || !isSurfaceCorePlaneForSizing(plane)) return;

  if (mode === "open") {
    for (const edge of plane.edges) {
      if (!blocksReliableStartEdge(edge)) continue;
      // Keep the same visible province border and terrain silhouette, but make
      // generated travel reliable. A bridge retains the visible river cue.
      edge.kind = edge.kind === "river" ? "bridge" : "standard";
      edge.special = undefined;
    }
    return;
  }

  const protectedStarts = new Set(plane.provinces
    .filter((province) => province.start || province.teamStart !== undefined)
    .map((province) => province.id));
  for (const id of extraStartIds) protectedStarts.add(id);
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const startDistances = [...protectedStarts].flatMap((id) => adjacency.has(id) ? [shortestDistances(adjacency, id)] : []);
  const byId = new Map(plane.provinces.map((province) => [province.id, province]));
  const isAwayFromStarts = (id: string) => startDistances.every((distances) => (distances.get(id) ?? Infinity) >= 2);
  const candidates = plane.edges.filter((edge) => {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    return a && b
      && !isBlockedProvince(a)
      && !isBlockedProvince(b)
      && edge.kind !== "bridge"
      && !blocksReliableStartEdge(edge)
      && isAwayFromStarts(a.id)
      && isAwayFromStarts(b.id);
  });
  const target = Math.min(candidates.length, Math.max(1, Math.round(plane.provinces.length / 10)));
  const selected = new Set<string>();
  const regionLoads = new Map<string, number>();
  const riverChokepoints = new Set<string>();
  strategicRiverChokepoints.set(plane, riverChokepoints);

  while (selected.size < target) {
    const graphBridges = graphBridgeKeysExcluding(plane, selected);
    const available = candidates.filter((edge) => {
      const key = connectionKey(edge.a, edge.b);
      return !selected.has(key) && !graphBridges.has(key);
    });
    if (!available.length) break;
    available.sort((left, right) => {
      const leftRegion = overlandEdgeRegion(left, byId);
      const rightRegion = overlandEdgeRegion(right, byId);
      const loadDifference = (regionLoads.get(leftRegion) ?? 0) - (regionLoads.get(rightRegion) ?? 0);
      if (loadDifference) return loadDifference;
      const leftRank = hashString(`${seed}:${connectionKey(left.a, left.b)}`);
      const rightRank = hashString(`${seed}:${connectionKey(right.a, right.b)}`);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    const edge = available[0]!;
    const key = connectionKey(edge.a, edge.b);
    const region = overlandEdgeRegion(edge, byId);
    edge.kind = strategicBorderKind(edge, byId, selected.size);
    edge.special = undefined;
    if (edge.kind === "river") riverChokepoints.add(key);
    selected.add(key);
    regionLoads.set(region, (regionLoads.get(region) ?? 0) + 1);
  }
}

/**
 * Wet strategic chokepoints are provisional "river" kinds until the final
 * connected-river pass, which resets every provisional river. This transient
 * handoff (never serialized) lets that pass route a continuous watercourse
 * through each chokepoint instead of erasing it.
 */
const strategicRiverChokepoints = new WeakMap<Plane, ReadonlySet<string>>();
const STRATEGIC_DRY_CHOKEPOINT: EdgeKind = "mountain_pass";

/** Chokepoints still marked as rivers; an explicit route mix may have replaced others, as it does passes. */
function takeStrategicRiverChokepoints(plane: Plane): string[] {
  const keys = strategicRiverChokepoints.get(plane);
  strategicRiverChokepoints.delete(plane);
  if (!keys?.size) return [];
  const kinds = new Map(plane.edges.map((edge) => [connectionKey(edge.a, edge.b), edge.kind]));
  return [...keys].filter((key) => kinds.get(key) === "river");
}

/** A chokepoint no continuous river can pass through keeps the strategic dry barrier instead of vanishing. */
function restoreUnroutedStrategicChokepoints(
  plane: Plane,
  keys: readonly string[],
  protectedStartIds: readonly string[],
  warnings?: string[],
) {
  if (!keys.length) return;
  const starts = new Set(protectedStartIds);
  for (const province of plane.provinces) if (province.start || province.teamStart !== undefined) starts.add(province.id);
  const edges = new Map(plane.edges.map((edge) => [connectionKey(edge.a, edge.b), edge]));
  for (const key of keys) {
    const edge = edges.get(key);
    if (!edge || edge.kind !== "standard") continue;
    if (starts.has(edge.a) || starts.has(edge.b)) {
      warnings?.push(`${plane.name}: a strategic river chokepoint beside a start could not join a connected river and was left open to keep the capital exit reliable.`);
      continue;
    }
    edge.kind = STRATEGIC_DRY_CHOKEPOINT;
    edge.special = undefined;
  }
}

function graphBridgeKeysExcluding(plane: Plane, excluded: ReadonlySet<string>): Set<string> {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const byId = new Map(active.map((province) => [province.id, province]));
  const pairs = new Map<string, SpatialPair>();
  for (const edge of plane.edges) {
    const key = connectionKey(edge.a, edge.b);
    if (excluded.has(key) || isImpassableEdge(edge)) continue;
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b || a.id === b.id || pairs.has(key)) continue;
    pairs.set(key, { a, b, key, distance: 0 });
  }
  return bridgeKeysFromPairs(active, pairs.values());
}

function overlandEdgeRegion(edge: Pick<Edge, "a" | "b">, byId: ReadonlyMap<string, Province>): string {
  const a = byId.get(edge.a)!;
  const b = byId.get(edge.b)!;
  const x = Math.min(2, Math.floor(clamp((a.x + b.x) / 2, 0, 0.999999) * 3));
  const y = Math.min(2, Math.floor(clamp((a.y + b.y) / 2, 0, 0.999999) * 3));
  return `${x}:${y}`;
}

/** Wet "river" picks are routed later as part of connected watercourses. */
function strategicBorderKind(
  edge: Pick<Edge, "a" | "b">,
  byId: ReadonlyMap<string, Province>,
  selectionIndex: number,
): EdgeKind {
  if (selectionIndex % 3 === 0) return "impassable";
  const a = byId.get(edge.a)!;
  const b = byId.get(edge.b)!;
  const flagsA = effectiveProvinceTerrainFlags(a);
  const flagsB = effectiveProvinceTerrainFlags(b);
  const wet = flagsA.has("freshwater") || flagsB.has("freshwater") || flagsA.has("swamp") || flagsB.has("swamp");
  return wet ? "river" : STRATEGIC_DRY_CHOKEPOINT;
}

function blocksReliableStartEdge(edge: Edge): boolean {
  if (edge.kind === "mountain_pass" || edge.kind === "mountain_border" || edge.kind === "river" || isImpassableEdge(edge)) return true;
  return edge.kind === "custom" && ((edge.special ?? 0) & 0b111) !== 0;
}

/** Dominions neighbourspec bit 4 blocks movement; bits 1 and 2 do not. */
export function isImpassableEdge(edge: Pick<Edge, "kind" | "special">): boolean {
  return edge.kind === "impassable" || (edge.kind === "custom" && ((edge.special ?? 0) & 4) !== 0);
}

function distributeThrones(project: MapProject) {
  const refs = project.planes.flatMap((plane, planeIndex) => plane.provinces
    .map((province) => ({ plane, planeIndex, province })));
  const requested = Math.min(
    project.settings.throneCount,
    project.planes.reduce((sum, plane) => sum + plane.provinces.filter((province) => !province.start && !isBlockedProvince(province)).length, 0),
  );
  if (requested <= 0) return;
  const provinceKeys = new Set(refs.map((ref) => globalProvinceKey(ref.plane.id, ref.province.id)));
  const startKeys = new Set<string>();
  for (const ref of refs) {
    if (ref.province.start || ref.province.teamStart !== undefined) {
      startKeys.add(globalProvinceKey(ref.plane.id, ref.province.id));
    }
  }
  for (const start of project.specificStarts) {
    const key = globalProvinceKey(start.planeId, start.provinceId);
    if (provinceKeys.has(key)) startKeys.add(key);
  }
  const starts = refs.filter((ref) => startKeys.has(globalProvinceKey(ref.plane.id, ref.province.id)));
  const movement = globalMovementAdjacency(project);
  const startDistances = starts.map((start) => shortestDistances(movement, globalProvinceKey(start.plane.id, start.province.id)));
  const gateKeys = new Set(project.gates.flatMap((gate) => gate.endpoints
    .map((endpoint) => globalProvinceKey(endpoint.planeId, endpoint.provinceId))));
  const gateDistances = [...gateKeys].map((key) => shortestDistances(movement, key));

  const weights = project.planes.map((plane) => Math.max(1, plane.provinces.length + plane.provinces.filter((province) => province.start).length * 12));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => requested * weight / weightTotal);
  const planeTargets = raw.map(Math.floor);
  let remaining = requested - planeTargets.reduce((sum, count) => sum + count, 0);
  const remainderOrder = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; remaining > 0; index = (index + 1) % remainderOrder.length) {
    planeTargets[remainderOrder[index]!.index]! += 1;
    remaining -= 1;
  }

  interface ThroneCandidate {
    ref: ProvinceRef;
    key: string;
    nearStarts: number[];
    fixed: boolean;
  }
  const throneCandidate = (ref: ProvinceRef, fixed: boolean): ThroneCandidate => {
    const key = globalProvinceKey(ref.plane.id, ref.province.id);
    return {
      ref,
      key,
      nearStarts: startDistances.flatMap((distances, index) => (distances.get(key) ?? 99) <= 4 ? [index] : []),
      fixed,
    };
  };
  const fixed = refs.filter((ref) => ref.province.throne === "fixed").map((ref) => throneCandidate(ref, true));
  for (const ref of refs) if (ref.province.throne === "preferred") ref.province.throne = "none";
  const candidates = refs.filter((ref) => {
    const key = globalProvinceKey(ref.plane.id, ref.province.id);
    if (startKeys.has(key) || gateKeys.has(key) || isBlockedProvince(ref.province) || ref.province.throne === "fixed") return false;
    if (!gateDistances.every((distances) => (distances.get(key) ?? 99) >= 2)) return false;
    return startDistances.every((distances) => (distances.get(key) ?? 99) >= 2);
  }).map((ref) => throneCandidate(ref, false));
  const chosen = [...fixed];
  const chosenKeys = new Set(chosen.map((candidate) => candidate.key));
  const chosenByPlane = project.planes.map((_, planeIndex) => chosen.filter((candidate) => candidate.ref.planeIndex === planeIndex).length);
  const nearbyCounts = starts.map(() => 0);
  const applyEffect = (candidate: ThroneCandidate, delta: 1 | -1) => {
    for (const index of candidate.nearStarts) nearbyCounts[index] = nearbyCounts[index]! + delta;
  };
  for (const candidate of chosen) applyEffect(candidate, 1);
  const parityObjective = (values: readonly number[]) => {
    if (!values.length) return 0;
    const range = Math.max(...values) - Math.min(...values);
    return range * 260 + standardDeviation([...values]) * 110
      + values.filter((value) => value === 0).length * 45 - mean([...values]) * 90;
  };
  const projectedObjective = (remove: ThroneCandidate | undefined, add: ThroneCandidate) => {
    const projected = [...nearbyCounts];
    for (const index of remove?.nearStarts ?? []) projected[index] = projected[index]! - 1;
    for (const index of add.nearStarts) projected[index] = projected[index]! + 1;
    return parityObjective(projected);
  };
  const throneSpacing = (candidate: ThroneCandidate, without?: ThroneCandidate) => {
    const samePlane = chosen.filter((item) => item !== without && item.ref.plane.id === candidate.ref.plane.id);
    if (!samePlane.length) return 5;
    const aspect = candidate.ref.plane.height > 0 ? clamp(candidate.ref.plane.width / candidate.ref.plane.height, 0.08, 12) : 1;
    return Math.min(...samePlane.map((item) => periodicProvinceDistance(
      candidate.ref.province,
      item.ref.province,
      candidate.ref.plane,
      aspect,
    ))) / Math.max(1e-6, Math.sqrt(1 / Math.max(1, candidate.ref.plane.provinces.length)));
  };

  while (chosen.length < requested) {
    let pool = candidates.filter((candidate) => !chosenKeys.has(candidate.key)
      && chosenByPlane[candidate.ref.planeIndex]! < planeTargets[candidate.ref.planeIndex]!);
    if (!pool.length) pool = candidates.filter((candidate) => !chosenKeys.has(candidate.key));
    const accessible = pool.filter((candidate) => candidate.nearStarts.length > 0);
    if (accessible.length) pool = accessible;
    let best: ThroneCandidate | undefined;
    let bestScore = -Infinity;
    const minimumNearby = nearbyCounts.length ? Math.min(...nearbyCounts) : 0;
    for (const candidate of pool) {
      const helpsMinimum = candidate.nearStarts.filter((index) => nearbyCounts[index] === minimumNearby).length;
      const helpsAhead = candidate.nearStarts.length - helpsMinimum;
      const terrainFlags = effectiveProvinceTerrainFlags(candidate.ref.province);
      const terrainInterest = terrainFlags.size === 0 || (terrainFlags.size === 1 && terrainFlags.has("farm")) ? 0 : 0.6;
      const score = -projectedObjective(undefined, candidate) + helpsMinimum * 85 - helpsAhead * 15
        + Math.min(throneSpacing(candidate), 5) * 2 + terrainInterest
        + (hashString(`${project.seed}:global-throne:${candidate.key}`) % 1000) / 10000;
      if (score > bestScore || (score === bestScore && candidate.ref.planeIndex < (best?.ref.planeIndex ?? Infinity))) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) break;
    chosen.push(best);
    chosenKeys.add(best.key);
    chosenByPlane[best.ref.planeIndex]! += 1;
    applyEffect(best, 1);
  }

  const planeQuotaDeviation = (counts: readonly number[]) => counts.reduce(
    (sum, count, planeIndex) => sum + Math.abs(count - planeTargets[planeIndex]!),
    0,
  );

  // Deterministic global swaps repair the final radius-four count vector.
  // Plane targets remain a soft geography preference: a throne may cross a
  // plane boundary when that is the only way to remove a multiplayer access
  // disparity created by sparse layers and their small number of gates.
  for (let pass = 0; pass < 6; pass += 1) {
    let improved = false;
    for (let slot = 0; slot < chosen.length; slot += 1) {
      const current = chosen[slot]!;
      if (current.fixed) continue;
      let replacement: ThroneCandidate | undefined;
      let replacementObjective = parityObjective(nearbyCounts) + planeQuotaDeviation(chosenByPlane) * 12;
      let replacementSpacing = throneSpacing(current, current);
      for (const candidate of candidates) {
        if (chosenKeys.has(candidate.key)) continue;
        const projectedPlaneCounts = [...chosenByPlane];
        projectedPlaneCounts[current.ref.planeIndex]! -= 1;
        projectedPlaneCounts[candidate.ref.planeIndex]! += 1;
        const objective = projectedObjective(current, candidate) + planeQuotaDeviation(projectedPlaneCounts) * 12;
        const spacing = throneSpacing(candidate, current);
        if (objective < replacementObjective - 1e-9
          || (Math.abs(objective - replacementObjective) <= 1e-9 && spacing > replacementSpacing + 1e-9)) {
          replacement = candidate;
          replacementObjective = objective;
          replacementSpacing = spacing;
        }
      }
      if (!replacement) continue;
      applyEffect(current, -1);
      chosenKeys.delete(current.key);
      chosenByPlane[current.ref.planeIndex]! -= 1;
      chosen[slot] = replacement;
      chosenKeys.add(replacement.key);
      chosenByPlane[replacement.ref.planeIndex]! += 1;
      applyEffect(replacement, 1);
      improved = true;
    }
    if (!improved) break;
  }

  for (const candidate of chosen) {
    if (candidate.fixed) continue;
    candidate.ref.province.throne = "preferred";
    candidate.ref.province.manySites = true;
  }
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

type PopulationSnapshot = Map<Province, number | undefined>;

function capturePopulations(planes: readonly Plane[]): PopulationSnapshot {
  return new Map(planes.flatMap((plane) => plane.provinces.map((province) => [province, province.population] as const)));
}

/**
 * Soft economy balance follows the exact hard-balance target but applies less
 * than half of each correction and caps it to a narrow relative band. This
 * keeps the ordering none < soft < hard deterministic province by province.
 */
function softenPopulationCorrections(baseline: PopulationSnapshot) {
  for (const [province, original] of baseline) {
    if (original === undefined) {
      province.population = undefined;
      continue;
    }
    const hardBalanced = province.population ?? original;
    const relativeLimit = Math.max(100, Math.round(original * 0.12 / 10) * 10);
    const lighterDelta = Math.round((hardBalanced - original) * 0.45 / 10) * 10;
    province.population = original + clamp(lighterDelta, -relativeLimit, relativeLimit);
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
  for (const province of plane.provinces) {
    province.small = false;
    province.large = false;
  }
  const adjacency = adjacencyFor(plane);
  const sorted = [...plane.provinces].sort((a, b) => (adjacency.get(a.id)?.length ?? 0) - (adjacency.get(b.id)?.length ?? 0));
  const smallCount = Math.floor(sorted.length * 0.06);
  const largeCount = Math.floor(sorted.length * 0.06);
  for (const province of sorted.slice(0, smallCount)) province.small = true;
  for (const province of sorted.slice(sorted.length - largeCount)) province.large = true;
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
  const startDistanceMaps = new Map(project.planes.map((plane) => {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    return [plane.id, [...(protectedStarts.get(plane.id) ?? [])].map((startId) => shortestDistances(adjacency, startId))];
  }));
  const startSpacingTargets = new Map(project.planes.map((plane) => [
    plane.id,
    scaledStartSeparationTarget(
      plane.provinces.filter((province) => !isBlockedProvince(province)).length,
      protectedStarts.get(plane.id)?.size ?? 0,
    ),
  ]));
  const throneNeighbours = new Map(project.planes.map((plane) => {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const ids = new Set<string>();
    for (const throne of plane.provinces.filter((province) => province.throne === "fixed" || province.throne === "preferred")) {
      ids.add(throne.id);
      for (const id of adjacency.get(throne.id) ?? []) ids.add(id);
    }
    return [plane.id, ids];
  }));
  const eligible = (plane: Plane, avoidStartRing: boolean, connectionSpacingTarget = 3) => {
    const requiredEndpointDistance = Math.max(2, Math.ceil((connectionSpacingTarget - 1) / 2));
    return plane.provinces.filter((province) => !protectedStarts.get(plane.id)?.has(province.id)
      && province.throne === "none"
      && !isBlockedProvince(province)
      && !used.has(`${plane.id}:${province.id}`)
      && (!avoidStartRing || (!throneNeighbours.get(plane.id)?.has(province.id)
        && (startDistanceMaps.get(plane.id) ?? []).every((distances) =>
          (distances.get(province.id) ?? 0) >= requiredEndpointDistance))));
  };

  for (const connection of connections) {
    const { sourceIndex, targetIndex } = connection;
    const sourcePlane = project.planes[sourceIndex]!;
    const targetPlane = project.planes[targetIndex]!;
    const defaultPairs = Math.min(2, Math.floor(Math.min(sourcePlane.provinces.length, targetPlane.provinces.length) / 12) || 1);
    const pairs = connection.pairs ?? project.settings.gatePairsPerConnection ?? defaultPairs;
    const connectionSpacingTarget = Math.max(
      startSpacingTargets.get(sourcePlane.id) ?? 3,
      startSpacingTargets.get(targetPlane.id) ?? 3,
    );
    const surfaceCavePair = isSurfaceGatePlane(sourcePlane) && isFloodedCaveGatePlane(targetPlane)
      || isSurfaceGatePlane(targetPlane) && isFloodedCaveGatePlane(sourcePlane);
    const safeWaterCount = (plane: Plane) => eligible(plane, true, connectionSpacingTarget).filter(isWaterProvince).length;
    const aquaticPairs = surfaceCavePair && pairs >= 2
      && safeWaterCount(sourcePlane) >= 3 && safeWaterCount(targetPlane) >= 3
      ? Math.min(pairs - 1, Math.max(1, Math.ceil(pairs / 3)))
      : 0;
    for (let pair = 0; pair < pairs; pair += 1) {
      const aquatic = pair >= pairs - aquaticPairs;
      const desiredWater = surfaceCavePair ? aquatic : undefined;
      const ranked = (plane: Plane, otherPlane: Plane, salt: number) => {
        const safe = eligible(plane, true, connectionSpacingTarget);
        const safeTyped = desiredWater === undefined
          ? safe
          : safe.filter((province) => isWaterProvince(province) === desiredWater);
        const fallbackTyped = desiredWater === undefined
          ? eligible(plane, false)
          : eligible(plane, false).filter((province) => isWaterProvince(province) === desiredWater);
        const usedFallback = safeTyped.length === 0 && fallbackTyped.length > 0;
        // A surface/subterranean pair is either jointly dry or jointly
        // aquatic. Never repair a scarce endpoint by silently crossing types;
        // omitting that pair is safer than exporting a misleading entrance.
        const candidates = safeTyped.length ? safeTyped : fallbackTyped;
        // Compute each candidate's sort key once. Start distances matter only
        // for the fallback pool, and one BFS per start replaces a BFS per
        // comparison.
        let distanceFromStarts: ((province: Province) => number) | undefined;
        if (usedFallback) {
          const adjacency = adjacencyFor(plane, { traversableOnly: true });
          const startDistances = [...(protectedStarts.get(plane.id) ?? [])].map((startId) => shortestDistances(adjacency, startId));
          distanceFromStarts = (province) => startDistances.length
            ? Math.min(...startDistances.map((distances) => distances.get(province.id) ?? 0))
            : 99;
        }
        const sortKeys = new Map(candidates.map((province) => [province, {
          distance: distanceFromStarts?.(province) ?? 0,
          score: gateEndpointThemeScore(province, plane, otherPlane, desiredWater) * 3 + field(province.x, province.y, salt),
        }]));
        candidates.sort((a, b) => {
          const keyA = sortKeys.get(a)!;
          const keyB = sortKeys.get(b)!;
          return keyB.distance - keyA.distance || keyB.score - keyA.score || a.index - b.index;
        });
        return { candidates, usedFallback };
      };
      const sourceRanked = ranked(sourcePlane, targetPlane, gateNumber + 19);
      const targetRanked = ranked(targetPlane, sourcePlane, gateNumber + 37);
      const source = sourceRanked.candidates[0];
      const destination = targetRanked.candidates[0];
      if (!source || !destination) continue;
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

function isSurfaceGatePlane(plane: Plane): boolean {
  return plane.kind === "surface" || (plane.kind === "custom" && resolvePlaneOwnershipMode(plane) === "solid");
}

function isFloodedCaveGatePlane(plane: Plane): boolean {
  return plane.kind === "cave" || plane.kind === "cavern" || plane.kind === "underworld";
}

function gateEndpointThemeScore(province: Province, plane: Plane, otherPlane: Plane, desiredWater?: boolean): number {
  const flags = effectiveProvinceTerrainFlags(province);
  const rugged = flags.has("highland") || flags.has("mountains");
  const cave = isCaveProvince(province) && !isBlockedProvince(province);
  const thisCave = ARCHETYPE_PROFILES[plane.kind].caveFamily;
  const otherCave = ARCHETYPE_PROFILES[otherPlane.kind].caveFamily;
  const thisAir = plane.kind === "cloud" || plane.kind === "air";
  const otherAir = otherPlane.kind === "cloud" || otherPlane.kind === "air";
  if (desiredWater) {
    const boundary = Math.min(province.x, 1 - province.x, province.y, 1 - province.y);
    return plane.kind === "underworld" ? 5 - boundary * 4 : 4;
  }
  if (thisCave && (otherCave || otherPlane.kind === "surface" || otherPlane.kind === "custom")) return cave ? 3 : 0;
  if ((plane.kind === "surface" || plane.kind === "custom") && (otherCave || otherAir)) return rugged ? 3 : 0;
  if (thisAir && (otherPlane.kind === "surface" || otherPlane.kind === "custom")) return rugged ? 3 : 0;
  return rugged || cave ? 1 : 0;
}

export function createDefaultPlaneConnections(
  planes: Plane[],
  layout: GateLayout = "compatible",
  pairs = 2,
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
    if (options.traversableOnly && (isImpassableEdge(edge)
      || (byId.get(edge.a) ? isBlockedProvince(byId.get(edge.a)!) : true)
      || (byId.get(edge.b) ? isBlockedProvince(byId.get(edge.b)!) : true))) continue;
    adjacency.get(edge.a)?.push(edge.b);
    adjacency.get(edge.b)?.push(edge.a);
  }
  for (const neighbours of adjacency.values()) neighbours.sort();
  return adjacency;
}

/** Tarjan bridge audit over the traversable authored movement graph. */
export function graphBridgeKeys(plane: Plane): Set<string> {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const byId = new Map(active.map((province) => [province.id, province]));
  const unique = new Map<string, SpatialPair>();
  for (const edge of plane.edges) {
    if (isImpassableEdge(edge)) continue;
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b || a.id === b.id) continue;
    const key = connectionKey(a.id, b.id);
    if (!unique.has(key)) unique.set(key, { a, b, key, distance: 0 });
  }
  return bridgeKeysFromPairs(active, unique.values());
}

export function shortestDistances(adjacency: Map<string, string[]>, start: string, maxDistance = Infinity): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const distance = distances.get(current)!;
    if (distance >= maxDistance) continue;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (distances.has(neighbour)) continue;
      distances.set(neighbour, distance + 1);
      queue.push(neighbour);
    }
  }
  return distances;
}

/** Exact distance to any source, with bounded storage rather than one BFS map per source. */
export function distancesToSources(adjacency: Map<string, string[]>, sources: Iterable<string>, maxDistance = Infinity): Map<string, number> {
  const distances = new Map([...sources].filter((id) => adjacency.has(id)).map((id) => [id, 0]));
  const queue = [...distances.keys()];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const distance = distances.get(current)!;
    if (distance >= maxDistance) continue;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (distances.has(neighbour)) continue;
      distances.set(neighbour, distance + 1);
      queue.push(neighbour);
    }
  }
  return distances;
}

/** Exact nearest OTHER source on an undirected graph, including disconnected sources. */
export function nearestSourceDistances(adjacency: Map<string, string[]>, sources: Iterable<string>): Map<string, number> {
  const nearest = new Map([...sources].map((id) => [id, Infinity]));
  const owner = new Map([...nearest.keys()].filter((id) => adjacency.has(id)).map((id) => [id, id]));
  const distance = new Map([...owner.keys()].map((id) => [id, 0]));
  const queue = [...owner.keys()];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const source = owner.get(current)!;
    for (const neighbour of adjacency.get(current) ?? []) {
      const other = owner.get(neighbour);
      if (other === undefined) {
        owner.set(neighbour, source);
        distance.set(neighbour, distance.get(current)! + 1);
        queue.push(neighbour);
      } else if (other !== source) {
        const candidate = distance.get(current)! + distance.get(neighbour)! + 1;
        nearest.set(source, Math.min(nearest.get(source)!, candidate));
        nearest.set(other, Math.min(nearest.get(other)!, candidate));
      }
    }
  }
  return nearest;
}

function reachableWithin(adjacency: Map<string, string[]>, start: string, radius: number): number {
  // A radius-bounded BFS discovers exactly the provinces within `radius`
  // (at their true distances) without walking the rest of the plane.
  if (!(radius >= 0)) return 0;
  return shortestDistances(adjacency, start, Math.floor(radius)).size;
}

export function calculateFairness(project: MapProject): FairnessMetrics {
  const refs = project.planes.flatMap((plane, planeIndex) => plane.provinces.map((province) => ({ plane, planeIndex, province })));
  if (!refs.length) {
    return { overall: 0, startSeparation: 0, expansionParity: 0, throneAccess: 0, terrainVariety: 0, connectivity: 0, startDegree: 0, startAllocation: 0, notes: ["Generate a map to score it."] };
  }
  const adjacency = sharedGlobalMovementAdjacency(project);
  const provinceKeys = new Set(refs.map((ref) => globalProvinceKey(ref.plane.id, ref.province.id)));
  const startKeys = new Set<string>();
  for (const ref of refs) {
    if (ref.province.start || ref.province.teamStart !== undefined) {
      startKeys.add(globalProvinceKey(ref.plane.id, ref.province.id));
    }
  }
  for (const start of project.specificStarts) {
    const key = globalProvinceKey(start.planeId, start.provinceId);
    if (provinceKeys.has(key)) startKeys.add(key);
  }
  const starts = refs.filter((ref) => startKeys.has(globalProvinceKey(ref.plane.id, ref.province.id)));
  const generatedStarts = refs.filter((ref) => ref.province.start);
  const thrones = refs.filter((ref) => ref.province.throne === "preferred" || ref.province.throne === "fixed");
  const notes: string[] = [];
  const nearest = nearestSourceDistances(adjacency, startKeys);
  const reachableFromFirst = starts.length ? shortestDistances(adjacency, globalProvinceKey(starts[0]!.plane.id, starts[0]!.province.id)) : new Map();
  // Preserve the existing disconnected-start penalty in the legacy score.
  const allStartsConnected = [...startKeys].every((key) => reachableFromFirst.has(key));
  const nearestStarts = starts.map((start) => {
    const distance = nearest.get(globalProvinceKey(start.plane.id, start.province.id)) ?? Infinity;
    return allStartsConnected && startKeys.size > 1 && Number.isFinite(distance) ? distance : 0;
  });
  const startCountByPlane = new Map(project.planes.map((plane) => [plane.id, starts.filter((start) => start.plane.id === plane.id).length]));
  const scaledTargets = starts.map((start) => scaledStartSeparationTarget(
    start.plane.provinces.filter((province) => !isBlockedProvince(province)).length,
    startCountByPlane.get(start.plane.id) ?? 0,
  ));
  const separationDeficit = starts.length > 1
    ? mean(nearestStarts.map((distance, index) => Math.max(0, scaledTargets[index]! - distance)))
    : 0;
  const nearestSpread = nearestStarts.length > 1 ? max(nearestStarts) - min(nearestStarts) : 0;
  const separationCv = coefficientOfVariation(nearestStarts);
  const hardFloorDeficit = starts.length > 1 ? mean(nearestStarts.map((distance) => Math.max(0, 3 - distance))) : 0;
  const startSeparation = clamp(Math.round(100 - separationDeficit * 22 - hardFloorDeficit * 45
    - Math.max(0, nearestSpread - 1) * 12 - separationCv * 28), 0, 100);
  if (hardFloorDeficit > 0) notes.push("Some starts are closer than the hard three-move multiplayer floor.");
  else if (separationDeficit > 0) {
    notes.push(`Scale-aware start spacing is below its preferred ${min(scaledTargets)}-${max(scaledTargets)} move target on at least one plane.`);
  }
  if (nearestSpread > 1) notes.push("Nearest-hostile-start distances vary considerably (by more than one move).");

  const refsByKey = new Map(refs.map((ref) => [globalProvinceKey(ref.plane.id, ref.province.id), ref]));
  const nearbyThroneRadius = 4;
  const expansionValues: number[] = [];
  const localCapacityValues: number[] = [];
  const nearbyThroneCounts: number[] = [];
  for (const start of starts) {
    const distances = shortestDistances(adjacency, globalProvinceKey(start.plane.id, start.province.id), thrones.length ? nearbyThroneRadius : 2);
    let expansion = 0;
    let capacity = 0;
    let nearbyThrones = 0;
    for (const [key, distance] of distances) {
      const province = refsByKey.get(key)?.province;
      if (!province) continue;
      if (distance <= 2) {
        expansion += (province.population ?? 0) / 1000 + (effectiveProvinceTerrainFlags(province).has("farm") ? 2 : 0);
        if (!isBlockedProvince(province)) capacity += 1;
      }
      if (province.throne === "preferred" || province.throne === "fixed") nearbyThrones += 1;
    }
    expansionValues.push(expansion);
    localCapacityValues.push(capacity);
    nearbyThroneCounts.push(nearbyThrones);
  }
  const expansionParity = clamp(Math.round(100 - Math.max(
    coefficientOfVariation(expansionValues) * 260,
    coefficientOfVariation(localCapacityValues) * 150,
  )), 0, 100);
  if (expansionParity < 80) notes.push("Two-ring expansion value varies noticeably between starts.");

  const caveCapacities = starts.flatMap((start, index) => start.province.startType === "cave" ? [localCapacityValues[index]!] : []);
  const overlandCapacities = starts.flatMap((start, index) => start.province.startType === "land" || start.province.startType === "coastal"
    ? [localCapacityValues[index]!]
    : []);
  if (caveCapacities.length && overlandCapacities.length) {
    const caveMean = mean(caveCapacities);
    const overlandMean = mean(overlandCapacities);
    const tolerance = Math.max(2, overlandMean * 0.2);
    if (Math.abs(caveMean - overlandMean) > tolerance) {
      notes.push(`Cave starts average ${caveMean.toFixed(1)} traversable provinces within two moves versus ${overlandMean.toFixed(1)} overland.`);
    }
  }

  const generatedStartsByPlane = new Map(project.planes.map((plane) => [plane.id, plane.provinces.filter((province) => province.start).length]));
  const cavePlaneShares: number[] = [];
  const overlandPlaneShares: number[] = [];
  for (const plane of project.planes) {
    const startCount = generatedStartsByPlane.get(plane.id) ?? 0;
    if (!startCount) continue;
    const share = plane.provinces.filter((province) => !isBlockedProvince(province)).length / startCount;
    if (ARCHETYPE_PROFILES[plane.kind].caveFamily) cavePlaneShares.push(share);
    else if (plane.kind === "surface") overlandPlaneShares.push(share);
  }
  if (cavePlaneShares.length && overlandPlaneShares.length && mean(cavePlaneShares) < mean(overlandPlaneShares) * 0.8) {
    notes.push(`Cave-plane traversable capacity per start is materially below overland (${mean(cavePlaneShares).toFixed(1)} versus ${mean(overlandPlaneShares).toFixed(1)} provinces).`);
  }

  const nearbyCountRange = nearbyThroneCounts.length ? max(nearbyThroneCounts) - min(nearbyThroneCounts) : 0;
  let pairDifferenceSum = 0;
  let prefixSum = 0;
  [...nearbyThroneCounts].sort((a, b) => a - b).forEach((count, index) => {
    pairDifferenceSum += count * index - prefixSum;
    prefixSum += count;
  });
  const pairCount = nearbyThroneCounts.length * (nearbyThroneCounts.length - 1) / 2;
  const meanPairDifference = pairCount ? pairDifferenceSum / pairCount : 0;
  const throneAccess = thrones.length && starts.length
    ? clamp(Math.round(100 - nearbyCountRange * 25 - meanPairDifference * 20), 0, 100)
    : 100;
  if (throneAccess < 80) notes.push(`Nearby-throne counts are uneven (${min(nearbyThroneCounts)}-${max(nearbyThroneCounts)} within ${nearbyThroneRadius} moves).`);

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

  let connectivityWeight = 0;
  let connectivityTotal = 0;
  let disconnectedPlane = false;
  // Each plane's traversable graph is built once and shared by the checks below.
  const traversableByPlane = new Map<Plane, Map<string, string[]>>();
  const traversableAdjacency = (plane: Plane) => {
    let local = traversableByPlane.get(plane);
    if (!local) traversableByPlane.set(plane, local = adjacencyFor(plane, { traversableOnly: true }));
    return local;
  };
  for (const plane of project.planes) {
    const active = plane.provinces.filter((province) => !isBlockedProvince(province));
    if (!active.length) continue;
    const local = traversableAdjacency(plane);
    const reachable = shortestDistances(local, active[0]!.id).size;
    const degrees = active.map((province) => local.get(province.id)?.length ?? 0);
    const coverage = reachable / active.length;
    let score: number;
    if (resolvePlaneOwnershipMode(plane) === "sparse") {
      // Leaves and bridges are intentional geography between sparse regions;
      // only actual isolated pockets or disconnected authored corridors lower
      // their connectivity score.
      const isolatedShare = degrees.filter((degree) => degree === 0).length / active.length;
      score = coverage === 1
        ? 100 - isolatedShare * 100
        : coverage * 72 - isolatedShare * 45;
    } else {
      score = coverage === 1
        ? 100 - Math.max(0, 3 - min(degrees)) * 15 - coefficientOfVariation(degrees) * 28
        : coverage * 60;
    }
    if (coverage < 1) disconnectedPlane = true;
    connectivityTotal += clamp(score, 0, 100) * active.length;
    connectivityWeight += active.length;
  }
  const connectivity = Math.round(connectivityTotal / Math.max(1, connectivityWeight));
  if (disconnectedPlane) notes.push("At least one plane has a disconnected traversable province pocket.");

  const targetDegree = project.settings.startDegreeTarget ?? 4;
  const localAdjacency = new Map(project.planes.map((plane) => [plane.id, traversableAdjacency(plane)]));
  const startDegrees = starts.map((start) => localAdjacency.get(start.plane.id)?.get(start.province.id)?.length ?? 0);
  const degreeDeficit = startDegrees.length ? mean(startDegrees.map((degree) => Math.max(0, targetDegree - degree))) : targetDegree;
  const degreeSpread = startDegrees.length ? max(startDegrees) - min(startDegrees) : targetDegree;
  const startDegree = clamp(Math.round(100 - degreeDeficit * 22 - Math.max(0, degreeSpread - 1) * 10 - coefficientOfVariation(startDegrees) * 55), 0, 100);
  if (startDegrees.some((degree) => degree < targetDegree)) notes.push(`Some starts have fewer than ${targetDegree} traversable connections.`);
  if (degreeSpread > 2) notes.push("Start connection counts vary by more than two.");

  const requested = normalizeStartDistribution(project.settings.startDistribution, project.settings.players);
  const actual: StartDistribution = { land: 0, coastal: 0, water: 0, cave: 0, other: 0 };
  for (const start of generatedStarts) {
    const local = localAdjacency.get(start.plane.id)!;
    const type = classifyStartType(start, local);
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

export function globalMovementAdjacency(project: MapProject): Map<string, string[]> {
  // Set-backed de-duplication; every list is sorted at the end, so the
  // result is identical to the former Array.includes construction.
  const neighbourSets = new Map<string, Set<string>>();
  const addNode = (key: string) => {
    let neighbours = neighbourSets.get(key);
    if (!neighbours) neighbourSets.set(key, neighbours = new Set());
    return neighbours;
  };
  const link = (a: string, b: string) => {
    const fromA = addNode(a);
    const fromB = addNode(b);
    fromA.add(b);
    fromB.add(a);
  };
  for (const plane of project.planes) {
    const blocked = new Set<Province>();
    for (const province of plane.provinces) {
      if (isBlockedProvince(province)) blocked.add(province);
      else addNode(globalProvinceKey(plane.id, province.id));
    }
    const byId = new Map(plane.provinces.map((province) => [province.id, province]));
    for (const edge of plane.edges) {
      const a = byId.get(edge.a);
      const b = byId.get(edge.b);
      if (isImpassableEdge(edge) || !a || !b || blocked.has(a) || blocked.has(b)) continue;
      link(globalProvinceKey(plane.id, edge.a), globalProvinceKey(plane.id, edge.b));
    }
  }
  for (const gate of project.gates) {
    const endpoints = gate.endpoints.filter((endpoint) => neighbourSets.has(globalProvinceKey(endpoint.planeId, endpoint.provinceId)));
    for (let a = 0; a < endpoints.length; a += 1) {
      for (let b = a + 1; b < endpoints.length; b += 1) {
        link(globalProvinceKey(endpoints[a]!.planeId, endpoints[a]!.provinceId), globalProvinceKey(endpoints[b]!.planeId, endpoints[b]!.provinceId));
      }
    }
  }
  const result = new Map<string, string[]>();
  for (const [key, neighbours] of neighbourSets) result.set(key, [...neighbours].sort());
  return result;
}

const immutableAnalysisProjects = new WeakSet<MapProject>();
let sharedMovementGraph: { project: MapProject; adjacency: Map<string, string[]> } | undefined;

/**
 * Declares that `project` will never be mutated again (the editor replaces
 * committed projects instead of editing them). Read-only analyses of such a
 * project may then share derived results instead of rebuilding them.
 */
export function markProjectImmutable<T extends MapProject>(project: T): T {
  immutableAnalysisProjects.add(project);
  return project;
}

export function isProjectMarkedImmutable(project: MapProject): boolean {
  return immutableAnalysisProjects.has(project);
}

/**
 * `globalMovementAdjacency` for read-only callers. The most recent project
 * marked immutable shares one graph between validation, fairness and start
 * analysis; any other project gets a fresh graph. Never mutate the result.
 */
export function sharedGlobalMovementAdjacency(project: MapProject): Map<string, string[]> {
  if (!immutableAnalysisProjects.has(project)) return globalMovementAdjacency(project);
  if (sharedMovementGraph?.project !== project) sharedMovementGraph = { project, adjacency: globalMovementAdjacency(project) };
  return sharedMovementGraph.adjacency;
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

export function normalizeOceanLayout(layout: OceanLayout | undefined): OceanLayout {
  return layout === "single_continent" || layout === "multiple_continents" || layout === "island_chains" || layout === "inland_sea"
    ? layout
    : "natural";
}

export function normalizeEconomyBalanceMode(mode: EconomyBalanceMode | undefined): EconomyBalanceMode {
  return mode === "none" || mode === "soft" ? mode : "hard";
}

export function normalizeOverlandTopologyMode(mode: OverlandTopologyMode | undefined): OverlandTopologyMode {
  return mode === "open" || mode === "strategic" ? mode : "competitive";
}

function isTrueCaveCorePlane(plane: Pick<Plane, "kind">): boolean {
  return plane.kind === "cave" || plane.kind === "cavern";
}

function isSurfaceCorePlaneForSizing(plane: Pick<Plane, "kind" | "variant" | "ownershipMode">): boolean {
  if (plane.kind === "surface") return true;
  if (plane.kind !== "custom" || resolvePlaneOwnershipMode(plane) !== "solid") return false;
  return !["fungal", "crystal", "volcanic", "storm", "infernal", "void"].includes(plane.variant ?? "temperate");
}

/** Core realms alone consume the players × provinces-per-player budget. */
export function isCorePlaneForSizing(plane: Pick<Plane, "kind" | "variant" | "ownershipMode">): boolean {
  return isTrueCaveCorePlane(plane) || isSurfaceCorePlaneForSizing(plane);
}

/** Plane families eligible for automatic starts after per-plane reservations. */
function eligibleGeneratedStartPlaneIndexes(project: Pick<MapProject, "planes">, type: StartType): number[] {
  const available = project.planes.flatMap((plane, index) => plane.noGeneratedStarts ? [] : [index]);
  if (type === "land" || type === "coastal" || type === "water") {
    return available.filter((index) => isSurfaceCorePlaneForSizing(project.planes[index]!));
  }
  if (type === "cave") {
    const trueCaves = available.filter((index) => isTrueCaveCorePlane(project.planes[index]!));
    return trueCaves.length
      ? trueCaves
      : available.filter((index) => ARCHETYPE_PROFILES[project.planes[index]!.kind].caveFamily);
  }
  return available.filter((index) => !isSurfaceCorePlaneForSizing(project.planes[index]!)
    && !ARCHETYPE_PROFILES[project.planes[index]!.kind].caveFamily);
}

/**
 * Capacity-weighted, deterministic quotas keep equally sized planes within
 * one start of each other while still giving larger authored realms a fair
 * share. Overland categories share one load counter, preventing independent
 * land/coast/water allocations from stacking onto the same plane.
 */
function allocateGeneratedStartsBySize(
  project: Pick<MapProject, "planes">,
  sizes: readonly number[],
  requested: StartDistribution,
): StartPlaneTargets {
  const targets = new Map(START_TYPES.map((type) => [type, new Map<string, number>()]));
  const assignedByPlane = new Map(project.planes.map((plane) => [plane.id, 0]));
  for (const type of ["water", "coastal", "land", "cave", "other"] as StartType[]) {
    const indexes = eligibleGeneratedStartPlaneIndexes(project, type);
    for (let slot = 0; slot < requested[type] && indexes.length; slot += 1) {
      const planeIndex = [...indexes].sort((a, b) => {
        const planeA = project.planes[a]!;
        const planeB = project.planes[b]!;
        const capacityA = sizes[a]! / ((assignedByPlane.get(planeA.id) ?? 0) + 1);
        const capacityB = sizes[b]! / ((assignedByPlane.get(planeB.id) ?? 0) + 1);
        return capacityB - capacityA || a - b;
      })[0]!;
      const plane = project.planes[planeIndex]!;
      assignedByPlane.set(plane.id, (assignedByPlane.get(plane.id) ?? 0) + 1);
      const byPlane = targets.get(type)!;
      byPlane.set(plane.id, (byPlane.get(plane.id) ?? 0) + 1);
    }
  }
  return targets;
}

/**
 * Per-plane generated-start quotas frozen by the province budget. Placement
 * never re-derives a split from the generated sizes: the budget sized the
 * auto planes for exactly this split, and its preview promises it.
 */
function generatedStartPlaneTargets(
  project: Pick<MapProject, "planes" | "settings">,
  requested: StartDistribution,
): StartPlaneTargets {
  return planGeneratedStarts(project, requested).targets;
}

function plannedGeneratedStartsOnPlane(
  project: Pick<MapProject, "planes" | "settings">,
  requested: StartDistribution,
  type: StartType,
  planeIndex: number,
): number {
  const plane = project.planes[planeIndex];
  if (!plane) return 0;
  return generatedStartPlaneTargets(project, requested).get(type)?.get(plane.id) ?? 0;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
