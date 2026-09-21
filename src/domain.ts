export const MAX_PLANES = 8;
export const SCHEMA_VERSION = 1;

export const GAME_ERA_LABELS = { 1: "Early Age", 2: "Middle Age", 3: "Late Age" } as const;
export type GameEra = keyof typeof GAME_ERA_LABELS;

export type PlaneArchetype =
  | "surface"
  | "cave"
  | "cavern"
  | "cloud"
  | "air"
  | "underworld"
  | "hell"
  | "abyss"
  | "dream"
  | "elemental"
  | "custom";

/** Kept as an alias so schema-v1 projects and existing callers stay valid. */
export type PlaneKind = PlaneArchetype;

export type PlaneVariant =
  | "temperate"
  | "wild"
  | "frozen"
  | "arid"
  | "oceanic"
  | "fungal"
  | "crystal"
  | "volcanic"
  | "storm"
  | "infernal"
  | "void";

/**
 * Controls whether every D6M pixel belongs to a province or whether the plane
 * can contain native owner-0 negative space between authored regions.
 */
export type PlaneOwnershipMode = "solid" | "sparse";

export type StartType = "land" | "coastal" | "water" | "cave" | "other";

export interface StartDistribution {
  land: number;
  coastal: number;
  water: number;
  cave: number;
  other: number;
}

export interface PlaneConnectionRule {
  /** Stable Plane.id values, not mutable display names or array indexes. */
  a: string;
  b: string;
  pairs: number;
  /** Missing means enabled for backward-compatible compact rule lists. */
  enabled?: boolean;
}

export type GateDirection = "bidirectional" | "forward" | "reverse";
export type GateLayout = "hub" | "chain" | "ring" | "compatible";
export type EconomyBalanceMode = "none" | "soft" | "hard";
export type OverlandTopologyMode = "open" | "competitive" | "strategic";

/** Large-scale overland land/sea arrangement. Missing means natural. */
export type OceanLayout =
  | "natural"
  | "single_continent"
  | "multiple_continents"
  | "island_chains"
  | "inland_sea";

export type TerrainKey =
  | "plains"
  | "forest"
  | "farm"
  | "swamp"
  | "waste"
  | "highland"
  | "mountains"
  /** @deprecated Serialized schema-v1 value; cloneProject migrates it to plains + freshwater. */
  | "freshwater"
  | "sea"
  | "deepsea"
  | "kelp"
  | "cave"
  | "caveforest"
  | "caveswamp"
  | "cavewaste"
  | "cavehighland"
  | "cavewall";

/** Additive Dominions terrain bits layered over a province's visual primary. */
export type TerrainFlag =
  | "sea"
  | "freshwater"
  | "highland"
  | "swamp"
  | "waste"
  | "forest"
  | "farm"
  | "deep"
  | "cave"
  | "mountains"
  | "cavewall";

export type BiomeKey =
  | "heartland"
  | "wildwood"
  | "marshlands"
  | "sunscorched"
  | "high_country"
  | "tundra"
  | "archipelago"
  | "deep_ocean"
  | "living_caves"
  | "crystal_deeps"
  | "ashen_deeps"
  | "void_reaches";

export type PreviewCondition =
  | "normal"
  | "winter"
  | "forested"
  | "flooded"
  | "wasted"
  | "farmland";

export type MagicPath =
  | "fire"
  | "air"
  | "water"
  | "earth"
  | "astral"
  | "death"
  | "nature"
  | "glamour"
  | "blood"
  | "holy";

export type EdgeKind =
  | "standard"
  | "mountain_border"
  | "mountain_pass"
  | "river"
  | "bridge"
  | "impassable"
  | "road"
  | "custom";

export interface Edge {
  id: string;
  a: string;
  b: string;
  kind: EdgeKind;
  special?: number;
}

export interface MagicSite {
  id: string;
  value: string;
  known: boolean;
}

export interface DefenseSquad {
  id: string;
  unit: string;
  count: number;
}

export interface ProvinceDefense {
  commander: string;
  clearMagic?: boolean;
  commanderName?: string;
  bodyguard?: string;
  bodyguardCount?: number;
  squads: DefenseSquad[];
  experience?: number;
  randomEquipment?: number;
  items?: string[];
  magic?: Partial<Record<MagicPath, number>>;
}

export interface BattleSettings {
  skybox?: string;
  battleMap?: string;
  groundColor?: string;
  rockColor?: string;
  fogColor?: string;
}

export interface Province {
  id: string;
  index: number;
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  name: string;
  /** Missing on schema-v1 imports is conservatively treated as user-authored. */
  nameSource?: "generated" | "authored";
  /** Protect these fields from generation, scoped rerolls and batch edits, not direct inspector edits. */
  editorLocks?: ProvinceLockGroup[];
  biome: BiomeKey;
  /** Base terrain preset; its flags combine with terrainFlags for art and export. */
  terrain: TerrainKey;
  terrainFlags?: TerrainFlag[];
  /** Auxiliary Dominions freshwater bit; does not make a province aquatic. */
  freshwater?: boolean;
  small: boolean;
  large: boolean;
  noStart: boolean;
  manySites: boolean;
  warmer: boolean;
  colder: boolean;
  siteBias: MagicPath[];
  start: boolean;
  startType?: StartType;
  teamStart?: number;
  throne: "none" | "preferred" | "avoid" | "fixed";
  fixedThrone?: string;
  sites: MagicSite[];
  killRandomSites: boolean;
  owner?: number;
  poptype?: number;
  population?: number;
  unrest?: number;
  fort?: number;
  temple: boolean;
  lab: boolean;
  provinceDefense?: number;
  defenders: ProvinceDefense[];
  battle: BattleSettings;
  rawDirectives: string;
}

export interface Plane {
  id: string;
  name: string;
  kind: PlaneKind;
  variant?: PlaneVariant;
  /** Whether provinceTarget follows players * provincesPerPlayer on generation. */
  autoSize?: boolean;
  /** Missing/false allows generated starts; true reserves this plane for neutral expansion. */
  noGeneratedStarts?: boolean;
  /** Optional preferences for the next generation; absent preserves the original generator. */
  generationOverrides?: PlaneGenerationOverrides;
  provinceTarget: number;
  width: number;
  height: number;
  wrapX: boolean;
  wrapY: boolean;
  /** Missing defaults to solid for surface/custom planes and sparse otherwise. */
  ownershipMode?: PlaneOwnershipMode;
  /** Optional per-plane overrides; missing inherits the project-level flag. */
  mapNoHide?: boolean;
  noDeepCaves?: boolean;
  /** Dominions #maptextcol and #mapdomcol payloads, stored verbatim for export. */
  mapTextColor?: string;
  mapDominionColor?: string;
  provinces: Province[];
  edges: Edge[];
  rawDirectives: string;
}

export interface GateEndpoint {
  planeId: string;
  provinceId: string;
}

export interface GateLink {
  id: string;
  gateNumber: number;
  /**
   * Editor layout orientation only. Dominions matching #gate identifiers are
   * bidirectional, so exporters must not interpret this as one-way movement.
   * Missing in schema-v1 projects means bidirectional.
   */
  direction?: GateDirection;
  /** True only when a cramped plane forced an endpoint into a start's one-ring. */
  adjacentStartFallback?: boolean;
  endpoints: GateEndpoint[];
}

export interface SpecificStart {
  nation: number;
  planeId: string;
  provinceId: string;
  /** Absent means imported or deliberately authored by the user. */
  source?: "generated-cave";
}

export interface ComputerPlayer {
  nation: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface GenerationSettings {
  players: number;
  provincesPerPlayer: number;
  waterPercent: number;
  /** Missing in schema-v1 projects preserves the original natural generator. */
  oceanLayout?: OceanLayout;
  /** Desired major landmasses for multiple_continents; ignored by other modes. */
  continentCount?: number;
  /** Per auto-sized bonus plane, as a percentage of the combined core realm total. */
  specialPlaneSizePercent?: number;
  /** Deterministic reroll counter for generated province names. */
  provinceNameSeed?: number;
  /** Opt-in editor behavior; reopening only rerolls names marked generated. */
  randomizeNamesOnLoad?: boolean;
  biomeCohesion: number;
  throneCount: number;
  siteFrequency?: number;
  /** Missing preserves the current strict early-economy correction. */
  economyBalance?: EconomyBalanceMode;
  /** Missing preserves the current generated overland border profile. */
  overlandTopology?: OverlandTopologyMode;
  /** Missing in schema-v1 projects means every requested start is surface land. */
  startDistribution?: StartDistribution;
  /** Preferred traversable connection count at starts; defaults to four. */
  startDegreeTarget?: number;
  /**
   * Ordered playable nation IDs to bind to generated cave-category starts.
   * The catalog does not carry an authoritative cave-capability flag, so the
   * user explicitly configures vanilla or mod nations here.
   */
  caveStartNations?: number[];
  gateLayout?: GateLayout;
  gateDirection?: GateDirection;
  gatePairsPerConnection?: number;
  /** Explicit pre-generation plane-pair graph; missing uses gateLayout. */
  planeConnections?: PlaneConnectionRule[];
  resolution: "compact" | "2k" | "4k" | "square-max" | "custom";
}

export interface MapProject {
  schemaVersion: number;
  name: string;
  description: string;
  seed: string;
  targetVersion: number;
  settings: GenerationSettings;
  /** Non-blocking deterministic generation constraints for the editor to surface. */
  generationWarnings?: string[];
  mapNoHide: boolean;
  noDeepCaves: boolean;
  noDeepChoice: boolean;
  noHomelandNames: boolean;
  noNameFilter: boolean;
  sailDistance: number;
  victoryPoints?: number;
  allowedPlayers: number[];
  computerPlayers: ComputerPlayer[];
  cannotWin: number[];
  specificStarts: SpecificStart[];
  planes: Plane[];
  gates: GateLink[];
  rawDirectives: string;
  createdAt: string;
  updatedAt: string;
  /** Optional host declarations and notes; never a certificate of nation or mod balance. */
  analysisContext?: { gameVersion?: string; era?: GameEra; mods?: string; requirements?: NationTerrainRequirement[] };
  /** Inputs recorded by the editor after a successful generation, not map-edit provenance. */
  generationInputs?: GenerationInputSnapshot;
  /** Optional authored editing safeguards and named selections; not native game commands. */
  authoring?: AuthoringOptions;
  /** Opt-in, revision-pinned initial armies from independently verified recruitment profiles. */
  populationDefense?: PopulationDefensePolicy;
}

export interface PopulationDefensePolicy {
  enabled: boolean;
  /** Never silently upgraded: an unknown revision must preserve native independent armies. */
  profileRevision: string;
}

export type ProvinceLockGroup = "name" | "terrain" | "economy" | "sites" | "guardians";
export interface AuthoredRegion {
  id: string;
  name: string;
  planeId: string;
  provinceIds: string[];
}
export interface AuthoringOptions {
  lockLayout?: boolean;
  lockStarts?: boolean;
  regions?: AuthoredRegion[];
}

export type DryTerrainPreference = "plains" | "forest" | "farm" | "swamp" | "waste" | "highland" | "mountains";
export interface RegionalTerrainPlan {
  name: string;
  x0: number; y0: number; x1: number; y1: number;
  terrain: DryTerrainPreference;
}
export interface PlaneGenerationOverrides {
  waterPercent?: number;
  caveWaterPercent?: number;
  terrainWeights?: Partial<Record<DryTerrainPreference, number>>;
  roadPercent?: number;
  riverPercent?: number;
  passPercent?: number;
  guardianCoveragePercent?: number;
  guardianRosterScale?: number;
  manySitesPercent?: number;
  regions?: RegionalTerrainPlan[];
}

/** Host-authored requirements, never bundled metagame tiers or automatic bonuses. */
export interface NationTerrainRequirement {
  nation: number;
  label: string;
  gameVersion: string;
  mods: string;
  terrain: TerrainFlag;
  minimum: number;
  radius: number;
}

export interface GenerationInputSnapshot {
  version: 1;
  seed: string;
  starts: string;
  terrain: string;
  planes: string;
  links: string;
}

export interface FairnessMetrics {
  overall: number;
  startSeparation: number;
  expansionParity: number;
  throneAccess: number;
  terrainVariety: number;
  connectivity: number;
  startDegree: number;
  startAllocation: number;
  notes: string[];
}

export interface ValidationIssue {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  planeId?: string;
  provinceId?: string;
}

export const TERRAIN_LABELS: Record<TerrainKey, string> = {
  plains: "Plains",
  forest: "Forest",
  farm: "Farmland",
  swamp: "Swamp",
  waste: "Waste",
  highland: "Highlands",
  mountains: "Mountains",
  freshwater: "Fresh water (legacy marker)",
  sea: "Sea",
  deepsea: "Deep sea",
  kelp: "Kelp forest",
  cave: "Caves",
  caveforest: "Cave forest",
  caveswamp: "Cave swamp",
  cavewaste: "Cave waste",
  cavehighland: "Cave highlands",
  cavewall: "Cave wall",
};

export const BIOME_LABELS: Record<BiomeKey, string> = {
  heartland: "Heartland",
  wildwood: "Wildwood",
  marshlands: "Marshlands",
  sunscorched: "Sunscorched",
  high_country: "High country",
  tundra: "Tundra",
  archipelago: "Archipelago",
  deep_ocean: "Deep ocean",
  living_caves: "Living caves",
  crystal_deeps: "Crystal deeps",
  ashen_deeps: "Ashen deeps",
  void_reaches: "Void reaches",
};

export const MAGIC_PATH_LABELS: Record<MagicPath, string> = {
  fire: "Fire",
  air: "Air",
  water: "Water",
  earth: "Earth",
  astral: "Astral",
  death: "Death",
  nature: "Nature",
  glamour: "Glamour",
  blood: "Blood",
  holy: "Holy",
};

export const RESOLUTION_PRESETS = {
  compact: { width: 1536, height: 1024, label: "Compact · 1536×1024" },
  "2k": { width: 2048, height: 1152, label: "2K · 2048×1152" },
  "4k": { width: 3840, height: 2160, label: "ChatGPT max · 3840×2160" },
  "square-max": { width: 2880, height: 2880, label: "Square max · 2880×2880" },
} as const;

export function planeFileSuffix(index: number): string {
  return index === 0 ? "" : `_plane${index + 1}`;
}

export function sanitizeMapName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  const fallback = cleaned || "pantokrator_atlas";
  return /^(?:CON|PRN|AUX|NUL|CLOCK|CONIN|CONOUT|COM[1-9]|LPT[1-9])$/i.test(fallback) ? `${fallback}_map` : fallback;
}

export function isWaterTerrain(terrain: TerrainKey): boolean {
  return terrain === "sea" || terrain === "deepsea" || terrain === "kelp";
}

export function isCaveTerrain(terrain: TerrainKey): boolean {
  return terrain.startsWith("cave");
}

export function isBlockedTerrain(terrain: TerrainKey): boolean {
  return terrain === "cavewall";
}

export const TERRAIN_FLAGS: readonly TerrainFlag[] = [
  "sea",
  "freshwater",
  "highland",
  "swamp",
  "waste",
  "forest",
  "farm",
  "deep",
  "cave",
  "mountains",
  "cavewall",
];

const TERRAIN_FLAG_SET = new Set<TerrainFlag>(TERRAIN_FLAGS);

export function effectiveProvinceTerrainFlags(
  province: Pick<Province, "terrain" | "terrainFlags" | "freshwater">,
): ReadonlySet<TerrainFlag> {
  const flags = new Set<TerrainFlag>();
  switch (province.terrain) {
    case "forest": flags.add("forest"); break;
    case "farm": flags.add("farm"); break;
    case "swamp": flags.add("swamp"); break;
    case "waste": flags.add("waste"); break;
    case "highland": flags.add("highland"); break;
    case "mountains": flags.add("mountains"); break;
    case "freshwater": flags.add("freshwater"); break;
    case "sea": flags.add("sea"); break;
    case "deepsea": flags.add("sea").add("deep"); break;
    case "kelp": flags.add("sea").add("forest"); break;
    case "cave": flags.add("cave"); break;
    case "caveforest": flags.add("cave").add("forest"); break;
    case "caveswamp": flags.add("cave").add("swamp"); break;
    case "cavewaste": flags.add("cave").add("waste"); break;
    case "cavehighland": flags.add("cave").add("highland"); break;
    case "cavewall": flags.add("cavewall"); break;
    default: break;
  }
  if (province.freshwater) flags.add("freshwater");
  for (const flag of province.terrainFlags ?? []) if (TERRAIN_FLAG_SET.has(flag)) flags.add(flag);
  return flags;
}

export function isWaterProvince(province: Pick<Province, "terrain" | "terrainFlags" | "freshwater">): boolean {
  return effectiveProvinceTerrainFlags(province).has("sea");
}

export function isCaveProvince(province: Pick<Province, "terrain" | "terrainFlags" | "freshwater">): boolean {
  const flags = effectiveProvinceTerrainFlags(province);
  return flags.has("cave") || flags.has("cavewall");
}

export function isBlockedProvince(province: Pick<Province, "terrain" | "terrainFlags" | "freshwater">): boolean {
  return effectiveProvinceTerrainFlags(province).has("cavewall");
}

/**
 * Return province-authored setup that is unsafe or misleading on a forced
 * nation capital. Terrain, geography, climate, names, and the generic start
 * marker are deliberately not included: those describe the map rather than
 * an independent province setup that could carry into the capital.
 */
export function nationSpecificStartFeatureConflicts(province: Province): string[] {
  const conflicts: string[] = [];
  if (province.teamStart !== undefined) conflicts.push("team start");
  if (province.manySites) conflicts.push("many-sites marker");
  if (province.throne === "preferred" || province.throne === "fixed" || province.fixedThrone) conflicts.push("throne setup");
  if (province.sites.length) conflicts.push("placed magic sites");
  if (province.killRandomSites) conflicts.push("random-site removal");
  if (province.owner !== undefined) conflicts.push("owner");
  if (province.poptype !== undefined) conflicts.push("population type");
  if (province.population !== undefined) conflicts.push("population override");
  if (province.unrest !== undefined) conflicts.push("unrest override");
  if (province.fort !== undefined) conflicts.push("fortification");
  if (province.temple) conflicts.push("temple");
  if (province.lab) conflicts.push("laboratory");
  if (province.provinceDefense !== undefined) conflicts.push("owned province defense");
  if (province.defenders.length) conflicts.push("guardian groups");
  if (Object.values(province.battle ?? {}).some((value) => value !== undefined && value !== "")) conflicts.push("battle-scene overrides");
  if (province.rawDirectives.trim()) conflicts.push("raw province directives");
  return conflicts;
}

/** Clear independent-province setup before a province becomes a #specstart. */
export function clearProvinceForNationSpecificStart(province: Province): void {
  province.noStart = false;
  province.manySites = false;
  province.teamStart = undefined;
  province.throne = "avoid";
  province.fixedThrone = undefined;
  province.sites = [];
  province.killRandomSites = false;
  province.owner = undefined;
  province.poptype = undefined;
  province.population = undefined;
  province.unrest = undefined;
  province.fort = undefined;
  province.temple = false;
  province.lab = false;
  province.provinceDefense = undefined;
  province.defenders = [];
  province.battle = {};
  province.rawDirectives = "";
}

/**
 * Make an authored generic or team start safe without erasing deliberate
 * capital economy, sites, or buildings. Independent guardian groups are not
 * valid capital content, while no-start and throne markers directly conflict
 * with a player start.
 */
export function prepareProvinceForPlayerStart(province: Province): void {
  province.noStart = false;
  province.throne = "avoid";
  province.fixedThrone = undefined;
  province.defenders = [];
}

/**
 * Atomically add, replace, or remove a forced nation start. Adding an
 * assignment also removes any older assignment for that nation and scrubs
 * independent-province features from the destination capital.
 */
export function setNationSpecificStart(
  project: MapProject,
  planeId: string,
  provinceId: string,
  nation?: number,
  source?: SpecificStart["source"],
): boolean {
  if (nation === undefined) {
    project.specificStarts = project.specificStarts.filter((start) => !(start.planeId === planeId && start.provinceId === provinceId));
    return true;
  }
  if (!Number.isSafeInteger(nation) || nation < 5) return false;
  const province = project.planes.find((plane) => plane.id === planeId)?.provinces.find((item) => item.id === provinceId);
  if (!province) return false;

  project.specificStarts = project.specificStarts.filter((start) => (
    start.nation !== nation && !(start.planeId === planeId && start.provinceId === provinceId)
  ));
  clearProvinceForNationSpecificStart(province);
  const assignment: SpecificStart = { nation, planeId, provinceId };
  if (source) assignment.source = source;
  project.specificStarts.push(assignment);
  return true;
}

/** Reapply capital cleanup after generation-time balancing mutates provinces. */
export function clearAllNationSpecificStartFeatures(project: MapProject): void {
  for (const start of project.specificStarts) {
    const province = project.planes.find((plane) => plane.id === start.planeId)?.provinces.find((item) => item.id === start.provinceId);
    if (province) clearProvinceForNationSpecificStart(province);
  }
}

/** Reapply the clean-capital invariant to the deduplicated authored union. */
export function clearAllPlayerStartFeatures(project: MapProject): void {
  for (const plane of project.planes) {
    for (const province of plane.provinces) {
      if (province.start || province.teamStart !== undefined) prepareProvinceForPlayerStart(province);
    }
  }
  clearAllNationSpecificStartFeatures(project);
}

export function cloneProject(project: MapProject): MapProject {
  const clone = JSON.parse(JSON.stringify(project)) as MapProject;
  for (const plane of clone.planes ?? []) {
    for (const province of plane.provinces ?? []) {
      province.terrainFlags = [...new Set((province.terrainFlags ?? []).filter((flag): flag is TerrainFlag => TERRAIN_FLAG_SET.has(flag as TerrainFlag)))];
      if (!province.terrainFlags.length) province.terrainFlags = undefined;
      if (province.terrain !== "freshwater") continue;
      province.terrain = "plains";
      province.freshwater = true;
      if (province.biome === "archipelago" || province.biome === "deep_ocean") province.biome = "heartland";
      province.poptype = undefined;
      province.defenders = [];
      if (province.startType === "water") province.startType = "land";
      if (province.population === undefined) province.population = 8200;
    }
  }
  return clone;
}
