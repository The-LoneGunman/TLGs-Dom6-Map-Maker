export const MAX_PLANES = 8;
export const SCHEMA_VERSION = 1;

export type PlaneKind =
  | "surface"
  | "underworld"
  | "abyss"
  | "dream"
  | "elemental"
  | "custom";

export type TerrainKey =
  | "plains"
  | "forest"
  | "farm"
  | "swamp"
  | "waste"
  | "highland"
  | "mountains"
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
  biome: BiomeKey;
  terrain: TerrainKey;
  small: boolean;
  large: boolean;
  noStart: boolean;
  manySites: boolean;
  warmer: boolean;
  colder: boolean;
  siteBias: MagicPath[];
  start: boolean;
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
  provinceTarget: number;
  width: number;
  height: number;
  wrapX: boolean;
  wrapY: boolean;
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
  endpoints: GateEndpoint[];
}

export interface SpecificStart {
  nation: number;
  planeId: string;
  provinceId: string;
}

export interface ComputerPlayer {
  nation: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface GenerationSettings {
  players: number;
  provincesPerPlayer: number;
  waterPercent: number;
  biomeCohesion: number;
  throneCount: number;
  siteFrequency?: number;
  resolution: "compact" | "2k" | "4k" | "square-max" | "custom";
}

export interface MapProject {
  schemaVersion: number;
  name: string;
  description: string;
  seed: string;
  targetVersion: number;
  settings: GenerationSettings;
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
}

export interface FairnessMetrics {
  overall: number;
  startSeparation: number;
  expansionParity: number;
  throneAccess: number;
  terrainVariety: number;
  connectivity: number;
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
  freshwater: "Fresh water",
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
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 64);
  return cleaned || "pantokrator_atlas";
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

export function cloneProject(project: MapProject): MapProject {
  return JSON.parse(JSON.stringify(project)) as MapProject;
}
