import {
  BIOME_LABELS,
  MAX_PLANES,
  RESOLUTION_PRESETS,
  SCHEMA_VERSION,
  cloneProject,
  isBlockedTerrain,
  isWaterTerrain,
  type BiomeKey,
  type Edge,
  type EdgeKind,
  type FairnessMetrics,
  type GateLink,
  type GenerationSettings,
  type MagicPath,
  type MapProject,
  type Plane,
  type PlaneKind,
  type Province,
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
  freshwater: 0,
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
    name: index === 0 ? "Pantokrator's Realm" : index === 1 ? "The Underworld" : `Plane ${index + 1}`,
    kind,
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

export function createDefaultProject(seed = "pantokrator-001"): MapProject {
  const now = new Date().toISOString();
  const settings: GenerationSettings = {
    players: 6,
    provincesPerPlayer: 16,
    waterPercent: 18,
    biomeCohesion: 68,
    throneCount: 8,
    resolution: "4k",
  };
  const project: MapProject = {
    schemaVersion: SCHEMA_VERSION,
    name: "Pantokrator Atlas",
    description: "A varied, multiplayer-balanced realm generated for Dominions 6.",
    seed,
    targetVersion: 600,
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

export function addPlane(project: MapProject, kind: PlaneKind = "underworld"): MapProject {
  if (project.planes.length >= MAX_PLANES) return project;
  const next = cloneProject(project);
  const plane = defaultPlane(project.seed, next.planes.length, kind);
  if (next.settings.resolution !== "custom") {
    const preset = RESOLUTION_PRESETS[next.settings.resolution];
    plane.width = preset.width;
    plane.height = preset.height;
  }
  plane.provinceTarget = Math.max(18, Math.round(next.settings.players * next.settings.provincesPerPlayer * 0.45));
  next.planes.push(generatePlane(plane, next.settings, `${project.seed}:plane:${next.planes.length}`, next.planes.length));
  next.gates = generateGates(next);
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
  if (!next.planes.length) next.planes = [defaultPlane(next.seed, 0)];
  next.planes = next.planes.slice(0, MAX_PLANES);
  next.planes[0]!.provinceTarget = next.settings.players * next.settings.provincesPerPlayer;

  next.planes = next.planes.map((plane, index) => {
    const normalized = cloneProject({ ...next, planes: [plane] } as MapProject).planes[0]!;
    normalized.provinceTarget = clamp(Math.round(normalized.provinceTarget), 8, 800);
    return generatePlane(normalized, next.settings, `${next.seed}:plane:${index}:v1`, index);
  });
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
    const terrainBiome = chooseTerrain(source.kind, climate, rng, settings, x, y);
    const populationBase = TERRAIN_POPULATION[terrainBiome.terrain];
    const population = populationBase
      ? Math.max(100, Math.round((populationBase * (0.83 + rng.next() * 0.34)) / 10) * 10)
      : undefined;
    const siteBias = siteBiasFor(terrainBiome.terrain, climate);
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
      small: false,
      large: false,
      noStart: isBlockedTerrain(terrainBiome.terrain),
      manySites: rng.chance(0.09),
      warmer: climate.temperature > 0.89 && rng.chance(0.35),
      colder: climate.temperature < 0.12 && rng.chance(0.35),
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

  enforceWaterQuota(provinces, source.kind, settings.waterPercent, stageSeed);
  enforceTerrainVariety(provinces, source.kind, stageSeed);
  const edges = buildEdges(provinces, source, stageSeed);
  const generated: Plane = { ...source, provinces, edges };

  if (planeIndex === 0) {
    placeStarts(generated, settings.players, stageSeed);
  }
  placeThrones(generated, planeIndex === 0 ? settings.throneCount : Math.max(1, Math.round(settings.throneCount * 0.35)), stageSeed);
  if (planeIndex === 0) balanceStartRegions(generated);
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
  climate: ReturnType<typeof climateAt>,
  rng: SeededRandom,
  settings: GenerationSettings,
  x: number,
  y: number,
): { terrain: TerrainKey; biome: BiomeKey } {
  const cohesion = settings.biomeCohesion / 100;
  const local = (field(x, y, 53) - 0.5) * (1 - cohesion) * 0.8;
  if (kind === "underworld" || kind === "abyss") {
    if (kind === "abyss" && climate.water < 0.1) return { terrain: "cavewall", biome: "void_reaches" };
    if (climate.moisture + local > 0.72) return { terrain: "caveforest", biome: "living_caves" };
    if (climate.moisture + local > 0.58 && climate.elevation < 0.48) return { terrain: "caveswamp", biome: "living_caves" };
    if (climate.temperature + local > 0.72) return { terrain: "cavewaste", biome: "ashen_deeps" };
    if (climate.elevation + local > 0.67) return { terrain: "cavehighland", biome: "crystal_deeps" };
    return { terrain: "cave", biome: rng.chance(0.42) ? "crystal_deeps" : "living_caves" };
  }
  if (kind === "dream") {
    if (climate.moisture > 0.68) return { terrain: "forest", biome: "void_reaches" };
    if (climate.elevation > 0.66) return { terrain: "highland", biome: "void_reaches" };
    return { terrain: "plains", biome: "void_reaches" };
  }
  if (climate.temperature < 0.2) {
    return climate.elevation > 0.59
      ? { terrain: "highland", biome: "tundra" }
      : { terrain: rng.chance(0.44) ? "forest" : "plains", biome: "tundra" };
  }
  if (climate.elevation + local > 0.73) return { terrain: rng.chance(0.22) ? "mountains" : "highland", biome: "high_country" };
  if (climate.moisture + local > 0.74 && climate.elevation < 0.5) return { terrain: "swamp", biome: "marshlands" };
  if (climate.moisture + local > 0.61) return { terrain: "forest", biome: "wildwood" };
  if (climate.temperature + local > 0.72 && climate.moisture < 0.44) return { terrain: "waste", biome: "sunscorched" };
  if (climate.moisture > 0.43 && climate.elevation < 0.52 && rng.chance(0.42)) return { terrain: "farm", biome: "heartland" };
  return { terrain: "plains", biome: "heartland" };
}

function enforceWaterQuota(provinces: Province[], kind: PlaneKind, percent: number, seed: string) {
  if (kind === "underworld" || kind === "abyss") return;
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
    province.population = Math.round(TERRAIN_POPULATION[province.terrain] * (0.86 + field(province.x, province.y, 73) * 0.28));
    province.siteBias = siteBiasFor(province.terrain, climateAt(province.x, province.y, salt));
  }
}

function enforceTerrainVariety(provinces: Province[], kind: PlaneKind, seed: string) {
  const surface: TerrainKey[] = ["plains", "forest", "farm", "swamp", "waste", "highland"];
  const caves: TerrainKey[] = ["cave", "caveforest", "caveswamp", "cavewaste", "cavehighland"];
  const wanted = kind === "underworld" || kind === "abyss" ? caves : surface;
  const minimum = provinces.length >= 72 ? 2 : 1;
  const rng = new SeededRandom(`${seed}:variety`);
  for (const terrain of wanted) {
    const current = provinces.filter((province) => province.terrain === terrain).length;
    for (let missing = current; missing < minimum; missing += 1) {
      const candidates = provinces.filter((province) => {
        if (isWaterTerrain(province.terrain) || isBlockedTerrain(province.terrain)) return false;
        return wanted.includes(province.terrain);
      });
      if (!candidates.length) break;
      const province = candidates[rng.int(0, candidates.length - 1)]!;
      province.terrain = terrain;
      province.biome = biomeForTerrain(terrain);
      province.population = TERRAIN_POPULATION[terrain];
      province.siteBias = siteBiasFor(terrain, climateAt(province.x, province.y, hashString(seed)));
    }
  }
}

function biomeForTerrain(terrain: TerrainKey): BiomeKey {
  if (terrain === "forest") return "wildwood";
  if (terrain === "swamp") return "marshlands";
  if (terrain === "waste") return "sunscorched";
  if (terrain === "highland" || terrain === "mountains") return "high_country";
  if (terrain === "sea" || terrain === "kelp" || terrain === "freshwater") return "archipelago";
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
  if (isWaterTerrain(terrain) || terrain === "freshwater") return ["water"];
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
  if (isBlockedTerrain(a.terrain) || isBlockedTerrain(b.terrain)) return "impassable";
  const rugged = ["highland", "mountains", "cavehighland"].includes(a.terrain) || ["highland", "mountains", "cavehighland"].includes(b.terrain);
  if (rugged && rng.chance(0.28)) return rng.chance(0.62) ? "mountain_pass" : "mountain_border";
  const wet = ["swamp", "freshwater", "caveswamp"].includes(a.terrain) || ["swamp", "freshwater", "caveswamp"].includes(b.terrain);
  if (wet && rng.chance(0.23)) return rng.chance(0.2) ? "bridge" : "river";
  if (!isWaterTerrain(a.terrain) && !isWaterTerrain(b.terrain) && rng.chance(0.055)) return "road";
  return "standard";
}

function placeStarts(plane: Plane, count: number, seed: string) {
  const candidates = plane.provinces.filter((province) => !isWaterTerrain(province.terrain) && !isBlockedTerrain(province.terrain) && !province.noStart);
  if (!candidates.length) return;
  const adjacency = adjacencyFor(plane);
  const ringSizes = new Map(candidates.map((candidate) => {
    const distances = shortestDistances(adjacency, candidate.id);
    return [candidate.id, plane.provinces.filter((province) => (distances.get(province.id) ?? 99) <= 2).length];
  }));
  const sortedRingSizes = [...ringSizes.values()].sort((a, b) => a - b);
  const targetRingSize = sortedRingSizes[Math.floor(sortedRingSizes.length / 2)] ?? 12;
  const starts: Province[] = [];
  const first = [...candidates].sort((a, b) => {
    const scoreA = (adjacency.get(a.id)?.length ?? 0) + (a.terrain === "plains" || a.terrain === "farm" ? 1.5 : 0) - Math.abs((ringSizes.get(a.id) ?? targetRingSize) - targetRingSize) * 1.8 + (hashString(`${seed}:start:${a.id}`) % 1000) / 100000;
    const scoreB = (adjacency.get(b.id)?.length ?? 0) + (b.terrain === "plains" || b.terrain === "farm" ? 1.5 : 0) - Math.abs((ringSizes.get(b.id) ?? targetRingSize) - targetRingSize) * 1.8 + (hashString(`${seed}:start:${b.id}`) % 1000) / 100000;
    return scoreB - scoreA || a.index - b.index;
  })[0]!;
  starts.push(first);

  while (starts.length < Math.min(count, candidates.length)) {
    let best: Province | undefined;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (starts.some((start) => start.id === candidate.id)) continue;
      const distances = shortestDistances(adjacency, candidate.id);
      const minimum = Math.min(...starts.map((start) => distances.get(start.id) ?? 0));
      const degree = adjacency.get(candidate.id)?.length ?? 0;
      const waterNeighbours = (adjacency.get(candidate.id) ?? []).filter((id) => {
        const province = plane.provinces.find((item) => item.id === id);
        return province ? isWaterTerrain(province.terrain) : false;
      }).length;
      const terrainBonus = candidate.terrain === "farm" ? 0.8 : candidate.terrain === "plains" ? 0.55 : 0;
      const ringPenalty = Math.abs((ringSizes.get(candidate.id) ?? targetRingSize) - targetRingSize) * 1.5;
      const score = minimum * 25 + Math.min(degree, 5) + terrainBonus - waterNeighbours * 0.35 - ringPenalty;
      if (score > bestScore || (score === bestScore && candidate.index < (best?.index ?? Infinity))) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) break;
    starts.push(best);
  }
  for (const province of starts) {
    province.start = true;
    province.noStart = false;
    province.throne = "avoid";
    province.manySites = false;
  }
}

function placeThrones(plane: Plane, count: number, seed: string) {
  if (count <= 0) return;
  const adjacency = adjacencyFor(plane);
  const starts = plane.provinces.filter((province) => province.start);
  const candidates = plane.provinces.filter((province) => !province.start && !isBlockedTerrain(province.terrain));
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
      const terrainInterest = candidate.terrain === "plains" || candidate.terrain === "farm" ? 0 : 0.75;
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
  const adjacency = adjacencyFor(plane);
  const starts = plane.provinces.filter((province) => province.start).sort((a, b) => a.index - b.index);
  if (starts.length < 2) return;
  const rings = starts.map((start) => {
    const distances = shortestDistances(adjacency, start.id);
    return plane.provinces.filter((province) => (distances.get(province.id) ?? 99) <= 2);
  });
  const value = (ring: Province[]) => ring.reduce(
    (sum, province) => sum + (province.population ?? 0) / 1000 + (province.terrain === "farm" ? 2 : 0),
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

function markProvinceSizes(plane: Plane) {
  const adjacency = adjacencyFor(plane);
  const sorted = [...plane.provinces].sort((a, b) => (adjacency.get(a.id)?.length ?? 0) - (adjacency.get(b.id)?.length ?? 0));
  const smallCount = Math.floor(sorted.length * 0.06);
  const largeCount = Math.floor(sorted.length * 0.06);
  for (const province of sorted.slice(0, smallCount)) province.small = true;
  for (const province of sorted.slice(-largeCount)) province.large = true;
}

function generateGates(project: MapProject): GateLink[] {
  if (project.planes.length < 2) return [];
  const gates: GateLink[] = [];
  let gateNumber = 1;
  const main = project.planes[0]!;
  const used = new Set<string>();
  const eligible = (plane: Plane) => plane.provinces.filter((province) => !province.start && province.throne === "none" && !isBlockedTerrain(province.terrain) && !used.has(`${plane.id}:${province.id}`));
  for (let planeIndex = 1; planeIndex < project.planes.length; planeIndex += 1) {
    const target = project.planes[planeIndex]!;
    const pairs = Math.min(2, Math.floor(Math.min(main.provinces.length, target.provinces.length) / 12) || 1);
    for (let pair = 0; pair < pairs; pair += 1) {
      const sourceCandidates = eligible(main).sort((a, b) => field(b.x, b.y, gateNumber + 19) - field(a.x, a.y, gateNumber + 19));
      const targetCandidates = eligible(target).sort((a, b) => field(b.x, b.y, gateNumber + 37) - field(a.x, a.y, gateNumber + 37));
      const source = sourceCandidates[0];
      const destination = targetCandidates[0];
      if (!source || !destination) break;
      used.add(`${main.id}:${source.id}`);
      used.add(`${target.id}:${destination.id}`);
      gates.push({
        id: idFor(project.seed, "gate", gateNumber),
        gateNumber,
        endpoints: [
          { planeId: main.id, provinceId: source.id },
          { planeId: target.id, provinceId: destination.id },
        ],
      });
      gateNumber += 1;
    }
  }
  return gates;
}

export function adjacencyFor(plane: Pick<Plane, "provinces" | "edges">): Map<string, string[]> {
  const adjacency = new Map(plane.provinces.map((province) => [province.id, [] as string[]]));
  for (const edge of plane.edges) {
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
  const plane = project.planes[0];
  if (!plane || !plane.provinces.length) {
    return { overall: 0, startSeparation: 0, expansionParity: 0, throneAccess: 0, terrainVariety: 0, connectivity: 0, notes: ["Generate a map to score it."] };
  }
  const adjacency = adjacencyFor(plane);
  const starts = plane.provinces.filter((province) => province.start);
  const thrones = plane.provinces.filter((province) => province.throne === "preferred" || province.throne === "fixed");
  const notes: string[] = [];

  const nearestStarts = starts.map((start) => {
    const distances = shortestDistances(adjacency, start.id);
    const others = starts.filter((other) => other.id !== start.id).map((other) => distances.get(other.id) ?? 0);
    return others.length ? Math.min(...others) : 0;
  });
  const separationMean = mean(nearestStarts);
  const separationCv = coefficientOfVariation(nearestStarts);
  const startSeparation = clamp(Math.round(100 - Math.max(0, 5 - separationMean) * 13 - separationCv * 90), 0, 100);
  if (separationMean < 4) notes.push("Some starts are closer than four moves.");

  const expansionValues = starts.map((start) => {
    const distances = shortestDistances(adjacency, start.id);
    return plane.provinces
      .filter((province) => (distances.get(province.id) ?? 99) <= 2)
      .reduce((sum, province) => sum + (province.population ?? 0) / 1000 + (province.terrain === "farm" ? 2 : 0), 0);
  });
  const expansionParity = clamp(Math.round(100 - coefficientOfVariation(expansionValues) * 260), 0, 100);
  if (expansionParity < 80) notes.push("Two-ring expansion value varies noticeably between starts.");

  const throneDistances = starts.map((start) => {
    const distances = shortestDistances(adjacency, start.id);
    return thrones.length ? Math.min(...thrones.map((throne) => distances.get(throne.id) ?? 99)) : 0;
  });
  const throneAccess = thrones.length
    ? clamp(Math.round(100 - coefficientOfVariation(throneDistances) * 220 - Math.max(0, max(throneDistances) - min(throneDistances) - 1) * 10), 0, 100)
    : 100;
  if (throneAccess < 80) notes.push("Nearest-throne access is uneven.");

  const counts = new Map<TerrainKey, number>();
  for (const province of plane.provinces) counts.set(province.terrain, (counts.get(province.terrain) ?? 0) + 1);
  const probabilities = [...counts.values()].map((count) => count / plane.provinces.length);
  const entropy = -probabilities.reduce((sum, probability) => sum + probability * Math.log(probability), 0);
  const normalizedEntropy = counts.size > 1 ? entropy / Math.log(counts.size) : 0;
  const sameEdges = plane.edges.filter((edge) => {
    const a = plane.provinces.find((province) => province.id === edge.a);
    const b = plane.provinces.find((province) => province.id === edge.b);
    return a?.terrain === b?.terrain;
  }).length;
  const joinRatio = plane.edges.length ? sameEdges / plane.edges.length : 0;
  const terrainVariety = clamp(Math.round(normalizedEntropy * 78 + Math.min(joinRatio, 0.45) * 49), 0, 100);
  if (counts.size < 6) notes.push("The surface uses fewer than six terrain categories.");

  const reachable = shortestDistances(adjacency, plane.provinces[0]!.id).size;
  const degreeValues = plane.provinces.map((province) => adjacency.get(province.id)?.length ?? 0);
  const connectivity = reachable === plane.provinces.length
    ? clamp(Math.round(100 - Math.max(0, 3 - min(degreeValues)) * 15 - coefficientOfVariation(degreeValues) * 28), 0, 100)
    : Math.round((reachable / plane.provinces.length) * 60);
  if (reachable !== plane.provinces.length) notes.push("At least one province is disconnected.");

  const overall = Math.round(startSeparation * 0.28 + expansionParity * 0.27 + throneAccess * 0.18 + terrainVariety * 0.14 + connectivity * 0.13);
  if (!notes.length) notes.push("All headline multiplayer checks are within the target range.");
  return { overall, startSeparation, expansionParity, throneAccess, terrainVariety, connectivity, notes };
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
