import { cloneProject, landformWaterError, sanitizeMapName, type MapProject, type Plane } from "./domain";
import { assertPlaneGenerationOverrides } from "./generationControls";

/**
 * Editable-project files: the import shape checks, serialization used by
 * autosave and recipes, and the project JSON download. Kept apart from the
 * package exporter in `./export` (which re-exports all of this) so the editor
 * can load that exporter only when a package is built.
 */

export function downloadProject(project: MapProject) {
  const name = `${sanitizeMapName(project.name)}.atlas.json`;
  downloadBlob(new Blob([serializeProject(project, true)], { type: "application/json" }), name);
}

/** Parser-side ceiling. The file picker should also reject larger files before calling File.text(). */
export const MAX_PROJECT_IMPORT_BYTES = 16 * 1024 * 1024;
export const MAX_IMPORTED_PLANES = 8;
export const MAX_IMPORTED_PROVINCES_PER_PLANE = 800;
export const MAX_IMPORTED_EDGES_PER_PLANE = 6_400;
export const MAX_IMPORTED_GATES = 2_048;
export const MAX_IMPORTED_ID_LENGTH = 128;
export const MAX_IMPORTED_STRING_LENGTH = 4_096;
export const MAX_IMPORTED_DIRECTIVE_LENGTH = 256 * 1024;

const MAX_GENERIC_ARRAY_ENTRIES = 10_000;
const MAX_PLAYER_ENTRIES = 512;
const MAX_SPECIFIC_STARTS = 512;
const MAX_PLANE_CONNECTION_RULES = 64;
const MAX_GATE_ENDPOINTS = 64;
const MAX_GENERATION_WARNINGS = 256;
const MAX_SITES_PER_PROVINCE = 64;
const MAX_DEFENSE_GROUPS_PER_PROVINCE = 32;
const MAX_SQUADS_PER_DEFENSE_GROUP = 64;
const MAX_ITEMS_PER_DEFENSE_GROUP = 64;
const SAFE_IMPORTED_ID = /^[A-Za-z0-9_-]+$/;

export function parseProject(text: string): MapProject {
  assertProjectTextSize(text);
  const parsed: unknown = JSON.parse(text);
  const root = recordAt(parsed, "project", "This is not a Pantokrator Atlas project.");
  if (root.schemaVersion !== 1) throw new Error(`Unsupported project schema ${String(root.schemaVersion)}.`);
  assertProjectShape(root);
  return cloneProject(root as unknown as MapProject);
}

/** Save only project states the importer can restore, without parsing/cloning a second atlas. */
export function serializeProject(project: MapProject, pretty = false): string {
  const root = recordAt(project, "project");
  if (root.schemaVersion !== 1) throw new Error(`Unsupported project schema ${String(root.schemaVersion)}.`);
  assertProjectShape(root);
  const compact = JSON.stringify(project);
  assertProjectTextSize(compact);
  if (!pretty) return compact;
  const formatted = JSON.stringify(project, null, 2);
  try {
    assertProjectTextSize(formatted);
    return formatted;
  } catch {
    return compact;
  }
}

const PLANE_KINDS = new Set([
  "surface", "cave", "cavern", "cloud", "air", "underworld", "hell", "abyss", "dream", "elemental", "custom",
]);
const PLANE_VARIANTS = new Set([
  "temperate", "wild", "frozen", "arid", "oceanic", "fungal", "crystal", "volcanic", "storm", "infernal", "void",
]);
const OWNERSHIP_MODES = new Set(["solid", "sparse"]);
const SPARSE_LAYOUTS = new Set(["chambers", "regions"]);
const TERRAIN_KEYS = new Set([
  "plains", "forest", "farm", "swamp", "waste", "highland", "mountains", "freshwater", "sea", "deepsea", "kelp",
  "cave", "caveforest", "caveswamp", "cavewaste", "cavehighland", "cavewall",
]);
const TERRAIN_FLAGS = new Set([
  "sea", "freshwater", "highland", "swamp", "waste", "forest", "farm", "deep", "cave", "mountains", "cavewall",
]);
const BIOME_KEYS = new Set([
  "heartland", "wildwood", "marshlands", "sunscorched", "high_country", "tundra", "archipelago", "deep_ocean",
  "living_caves", "crystal_deeps", "ashen_deeps", "void_reaches",
]);
const MAGIC_PATHS = new Set([
  "fire", "air", "water", "earth", "astral", "death", "nature", "glamour", "blood", "holy",
]);
const START_TYPES = new Set(["land", "coastal", "water", "cave", "other"]);
const THRONE_MODES = new Set(["none", "preferred", "avoid", "fixed"]);
const EDGE_KINDS = new Set([
  "standard", "mountain_border", "mountain_pass", "river", "bridge", "impassable", "road", "custom",
]);
const GATE_DIRECTIONS = new Set(["bidirectional", "forward", "reverse"]);
const GATE_LAYOUTS = new Set(["hub", "chain", "ring", "compatible"]);
const OCEAN_LAYOUTS = new Set(["natural", "single_continent", "multiple_continents", "island_chains", "inland_sea"]);
const ECONOMY_BALANCE_MODES = new Set(["none", "soft", "hard"]);
const OVERLAND_TOPOLOGY_MODES = new Set(["open", "competitive", "strategic"]);
const RESOLUTIONS = new Set(["compact", "2k", "4k", "square-max", "custom"]);

const PROJECT_FIELDS = new Set([
  "schemaVersion", "name", "description", "seed", "targetVersion", "settings", "generationWarnings", "mapNoHide",
  "noDeepCaves", "noDeepChoice", "noHomelandNames", "noNameFilter", "sailDistance", "victoryPoints", "allowedPlayers",
  "computerPlayers", "cannotWin", "specificStarts", "planes", "gates", "rawDirectives", "createdAt", "updatedAt",
  "analysisContext", "generationInputs", "authoring", "populationDefense",
]);
const GENERATION_SETTING_FIELDS = new Set([
  "players", "provincesPerPlayer", "waterPercent", "oceanLayout", "continentCount", "specialPlaneSizePercent",
  "provinceNameSeed", "randomizeNamesOnLoad", "biomeCohesion", "throneCount", "siteFrequency", "economyBalance", "overlandTopology",
  "startDistribution", "startDegreeTarget", "caveStartNations", "gateLayout", "gateDirection", "gatePairsPerConnection",
  "planeConnections", "resolution",
]);
const START_DISTRIBUTION_FIELDS = new Set(["land", "coastal", "water", "cave", "other"]);
const COMPUTER_PLAYER_FIELDS = new Set(["nation", "difficulty"]);
const SPECIFIC_START_FIELDS = new Set(["nation", "planeId", "provinceId", "source"]);
const PLANE_CONNECTION_FIELDS = new Set(["a", "b", "pairs", "enabled"]);
const PLANE_FIELDS = new Set([
  "id", "name", "kind", "variant", "autoSize", "noGeneratedStarts", "provinceTarget", "width", "height", "wrapX",
  "wrapY", "ownershipMode", "mapNoHide", "noDeepCaves", "mapTextColor", "mapDominionColor", "provinces", "edges",
  "rawDirectives", "generationOverrides", "sparseLayout", "landformStyle", "landformWater", "generationKey",
]);
const EDGE_FIELDS = new Set(["id", "a", "b", "kind", "special"]);
const PROVINCE_FIELDS = new Set([
  "id", "index", "x", "y", "gridX", "gridY", "name", "nameSource", "editorLocks", "biome", "terrain", "terrainFlags",
  "freshwater", "small", "large", "noStart", "manySites", "warmer", "colder", "siteBias", "start", "startType",
  "teamStart", "throne", "fixedThrone", "sites", "killRandomSites", "owner", "poptype", "population", "unrest", "fort",
  "temple", "lab", "provinceDefense", "defenders", "battle", "rawDirectives",
]);
const MAGIC_SITE_FIELDS = new Set(["id", "value", "known"]);
const DEFENSE_FIELDS = new Set([
  "commander", "clearMagic", "commanderName", "bodyguard", "bodyguardCount", "squads", "experience", "randomEquipment",
  "items", "magic",
]);
const DEFENSE_SQUAD_FIELDS = new Set(["id", "unit", "count"]);
const BATTLE_FIELDS = new Set(["skybox", "battleMap", "groundColor", "rockColor", "fogColor"]);
const GATE_FIELDS = new Set(["id", "gateNumber", "direction", "adjacentStartFallback", "endpoints"]);
const GATE_ENDPOINT_FIELDS = new Set(["planeId", "provinceId"]);

function assertProjectShape(project: Record<string, unknown>): void {
  assertKnownFields(project, "project", PROJECT_FIELDS);
  stringAt(project.name, "project.name");
  stringAt(project.description, "project.description");
  stringAt(project.seed, "project.seed");
  numberAt(project.targetVersion, "project.targetVersion");
  assertGenerationSettings(recordAt(project.settings, "project.settings"));
  if (project.populationDefense !== undefined) {
    const policy = recordAt(project.populationDefense, "project.populationDefense");
    assertKnownFields(policy, "project.populationDefense", new Set(["enabled", "profileRevision"]));
    booleanAt(policy.enabled, "project.populationDefense.enabled");
    stringAt(policy.profileRevision, "project.populationDefense.profileRevision");
    const revision = policy.profileRevision as string;
    if (!revision.trim() || revision.length > 120 || revision !== revision.trim()
      || [...revision].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new Error("project.populationDefense.profileRevision must be a nonblank, whitespace-trimmed revision of at most 120 characters.");
    }
  }
  if (project.authoring !== undefined) {
    const options = recordAt(project.authoring, "project.authoring");
    assertKnownFields(options, "project.authoring", new Set(["lockLayout", "lockStarts", "regions"]));
    optionalBooleanAt(options.lockLayout, "project.authoring.lockLayout");
    optionalBooleanAt(options.lockStarts, "project.authoring.lockStarts");
    if (options.regions !== undefined) {
      const seen = new Set<string>();
      boundedArrayAt(options.regions, "project.authoring.regions", 64).forEach((value, index) => {
        const path = `project.authoring.regions[${index}]`;
        const region = recordAt(value, path);
        assertKnownFields(region, path, new Set(["id", "name", "planeId", "provinceIds"]));
        idAt(region.id, `${path}.id`); idAt(region.planeId, `${path}.planeId`); stringAt(region.name, `${path}.name`);
        if (seen.has(region.id as string)) throw new Error("Authored region IDs must be unique.");
        seen.add(region.id as string);
        const ids = boundedArrayAt(region.provinceIds, `${path}.provinceIds`, MAX_IMPORTED_PROVINCES_PER_PLANE);
        ids.forEach((id, i) => idAt(id, `${path}.provinceIds[${i}]`));
        if (new Set(ids).size !== ids.length) throw new Error("A region cannot contain duplicate provinces.");
      });
    }
  }
  if (project.analysisContext !== undefined) {
    const context = recordAt(project.analysisContext, "project.analysisContext");
    assertKnownFields(context, "project.analysisContext", new Set(["gameVersion", "era", "mods", "requirements"]));
    optionalStringAt(context.gameVersion, "project.analysisContext.gameVersion");
    if (context.era !== undefined && context.era !== 1 && context.era !== 2 && context.era !== 3) {
      throw new Error("project.analysisContext.era must be 1 (Early Age), 2 (Middle Age), or 3 (Late Age), or omitted when unknown.");
    }
    optionalStringAt(context.mods, "project.analysisContext.mods");
    if (context.requirements !== undefined) boundedArrayAt(context.requirements, "project.analysisContext.requirements", 64).forEach((value,index)=>{
      const path=`project.analysisContext.requirements[${index}]`;const r=recordAt(value,path);
      assertKnownFields(r,path,new Set(["nation","label","gameVersion","mods","terrain","minimum","radius"]));
      for(const k of ["label","gameVersion","mods"])stringAt(r[k],`${path}.${k}`);
      if(!(r.label as string).trim()||(r.label as string).length>120||!(r.gameVersion as string).trim()||(r.gameVersion as string).length>64)throw new Error("Requirements need a short label and explicit patch snapshot.");
      enumAt(r.terrain,TERRAIN_FLAGS,`${path}.terrain`);
      for(const [key,min,max] of [["nation",5,1000000],["minimum",1,20],["radius",1,3]] as const){numberAt(r[key],`${path}.${key}`);if(!Number.isInteger(r[key])||(r[key] as number)<min||(r[key] as number)>max)throw new Error(`${path}.${key} is outside the supported range.`);}
    });
  }
  if (project.generationInputs !== undefined) {
    const inputs = recordAt(project.generationInputs, "project.generationInputs");
    assertKnownFields(inputs, "project.generationInputs", new Set(["version", "seed", "starts", "terrain", "planes", "links"]));
    if (inputs.version !== 1) throw new Error("project.generationInputs.version must be 1.");
    for (const key of ["seed", "starts", "terrain", "planes", "links"]) {
      if (typeof inputs[key] !== "string" || inputs[key].length > 65_536) {
        throw new Error(`project.generationInputs.${key} must be a string of at most 65536 characters.`);
      }
    }
  }
  booleanAt(project.mapNoHide, "project.mapNoHide");
  booleanAt(project.noDeepCaves, "project.noDeepCaves");
  booleanAt(project.noDeepChoice, "project.noDeepChoice");
  booleanAt(project.noHomelandNames, "project.noHomelandNames");
  booleanAt(project.noNameFilter, "project.noNameFilter");
  numberAt(project.sailDistance, "project.sailDistance");
  optionalNumberAt(project.victoryPoints, "project.victoryPoints");
  numberArrayAt(project.allowedPlayers, "project.allowedPlayers", MAX_PLAYER_ENTRIES);
  boundedArrayAt(project.computerPlayers, "project.computerPlayers", MAX_PLAYER_ENTRIES).forEach((value, index) => {
    const player = recordAt(value, `project.computerPlayers[${index}]`);
    assertKnownFields(player, `project.computerPlayers[${index}]`, COMPUTER_PLAYER_FIELDS);
    numberAt(player.nation, `project.computerPlayers[${index}].nation`);
    numberAt(player.difficulty, `project.computerPlayers[${index}].difficulty`);
  });
  numberArrayAt(project.cannotWin, "project.cannotWin", MAX_PLAYER_ENTRIES);
  boundedArrayAt(project.specificStarts, "project.specificStarts", MAX_SPECIFIC_STARTS).forEach((value, index) => {
    const start = recordAt(value, `project.specificStarts[${index}]`);
    assertKnownFields(start, `project.specificStarts[${index}]`, SPECIFIC_START_FIELDS);
    numberAt(start.nation, `project.specificStarts[${index}].nation`);
    idAt(start.planeId, `project.specificStarts[${index}].planeId`);
    idAt(start.provinceId, `project.specificStarts[${index}].provinceId`);
    optionalEnumAt(start.source, new Set(["generated-cave"]), `project.specificStarts[${index}].source`);
  });

  const planes = boundedArrayAt(project.planes, "project.planes", MAX_IMPORTED_PLANES);
  if (planes.length === 0) throw new Error("project.planes must contain at least one plane.");
  planes.forEach((value, index) => assertPlane(recordAt(value, `project.planes[${index}]`), index));
  const regions=(project.authoring as {regions?: {planeId:string;provinceIds:string[]}[]}|undefined)?.regions;
  for(const r of regions??[]){
    const plane=planes.find(v=>(v as Record<string,unknown>).id===r.planeId) as {provinces:{id:string}[]}|undefined;
    if(!plane||r.provinceIds.some(id=>!plane.provinces.some(p=>p.id===id)))throw new Error("An authored region references a missing plane or province.");
  }

  boundedArrayAt(project.gates, "project.gates", MAX_IMPORTED_GATES).forEach((value, index) => {
    const gate = recordAt(value, `project.gates[${index}]`);
    assertKnownFields(gate, `project.gates[${index}]`, GATE_FIELDS);
    idAt(gate.id, `project.gates[${index}].id`);
    numberAt(gate.gateNumber, `project.gates[${index}].gateNumber`);
    optionalEnumAt(gate.direction, GATE_DIRECTIONS, `project.gates[${index}].direction`);
    optionalBooleanAt(gate.adjacentStartFallback, `project.gates[${index}].adjacentStartFallback`);
    const endpoints = boundedArrayAt(gate.endpoints, `project.gates[${index}].endpoints`, MAX_GATE_ENDPOINTS);
    if (endpoints.length < 2) throw new Error(`project.gates[${index}].endpoints must contain at least two endpoints.`);
    endpoints.forEach((endpointValue, endpointIndex) => {
      const endpoint = recordAt(endpointValue, `project.gates[${index}].endpoints[${endpointIndex}]`);
      assertKnownFields(endpoint, `project.gates[${index}].endpoints[${endpointIndex}]`, GATE_ENDPOINT_FIELDS);
      idAt(endpoint.planeId, `project.gates[${index}].endpoints[${endpointIndex}].planeId`);
      idAt(endpoint.provinceId, `project.gates[${index}].endpoints[${endpointIndex}].provinceId`);
    });
  });
  directiveAt(project.rawDirectives, "project.rawDirectives");
  if (project.generationWarnings !== undefined) stringArrayAt(project.generationWarnings, "project.generationWarnings", MAX_GENERATION_WARNINGS);
  stringAt(project.createdAt, "project.createdAt");
  stringAt(project.updatedAt, "project.updatedAt");
}

function assertGenerationSettings(settings: Record<string, unknown>): void {
  assertKnownFields(settings, "project.settings", GENERATION_SETTING_FIELDS);
  for (const key of ["players", "provincesPerPlayer", "waterPercent", "biomeCohesion", "throneCount"] as const) {
    numberAt(settings[key], `project.settings.${key}`);
  }
  optionalNumberAt(settings.siteFrequency, "project.settings.siteFrequency");
  optionalEnumAt(settings.oceanLayout, OCEAN_LAYOUTS, "project.settings.oceanLayout");
  optionalNumberAt(settings.continentCount, "project.settings.continentCount");
  optionalNumberAt(settings.specialPlaneSizePercent, "project.settings.specialPlaneSizePercent");
  optionalNumberAt(settings.provinceNameSeed, "project.settings.provinceNameSeed");
  optionalBooleanAt(settings.randomizeNamesOnLoad, "project.settings.randomizeNamesOnLoad");
  optionalEnumAt(settings.economyBalance, ECONOMY_BALANCE_MODES, "project.settings.economyBalance");
  optionalEnumAt(settings.overlandTopology, OVERLAND_TOPOLOGY_MODES, "project.settings.overlandTopology");
  if (settings.startDistribution !== undefined) {
    const distribution = recordAt(settings.startDistribution, "project.settings.startDistribution");
    assertKnownFields(distribution, "project.settings.startDistribution", START_DISTRIBUTION_FIELDS);
    for (const key of ["land", "coastal", "water", "cave", "other"] as const) {
      numberAt(distribution[key], `project.settings.startDistribution.${key}`);
    }
  }
  optionalNumberAt(settings.startDegreeTarget, "project.settings.startDegreeTarget");
  if (settings.caveStartNations !== undefined) numberArrayAt(settings.caveStartNations, "project.settings.caveStartNations", MAX_PLAYER_ENTRIES);
  optionalEnumAt(settings.gateLayout, GATE_LAYOUTS, "project.settings.gateLayout");
  optionalEnumAt(settings.gateDirection, GATE_DIRECTIONS, "project.settings.gateDirection");
  optionalNumberAt(settings.gatePairsPerConnection, "project.settings.gatePairsPerConnection");
  if (settings.planeConnections !== undefined) {
    boundedArrayAt(settings.planeConnections, "project.settings.planeConnections", MAX_PLANE_CONNECTION_RULES).forEach((value, index) => {
      const rule = recordAt(value, `project.settings.planeConnections[${index}]`);
      assertKnownFields(rule, `project.settings.planeConnections[${index}]`, PLANE_CONNECTION_FIELDS);
      idAt(rule.a, `project.settings.planeConnections[${index}].a`);
      idAt(rule.b, `project.settings.planeConnections[${index}].b`);
      numberAt(rule.pairs, `project.settings.planeConnections[${index}].pairs`);
      optionalBooleanAt(rule.enabled, `project.settings.planeConnections[${index}].enabled`);
    });
  }
  enumAt(settings.resolution, RESOLUTIONS, "project.settings.resolution");
}

function assertPlane(plane: Record<string, unknown>, index: number): void {
  const path = `project.planes[${index}]`;
  assertKnownFields(plane, path, PLANE_FIELDS);
  idAt(plane.id, `${path}.id`);
  stringAt(plane.name, `${path}.name`);
  enumAt(plane.kind, PLANE_KINDS, `${path}.kind`);
  optionalEnumAt(plane.variant, PLANE_VARIANTS, `${path}.variant`);
  optionalBooleanAt(plane.autoSize, `${path}.autoSize`);
  optionalBooleanAt(plane.noGeneratedStarts, `${path}.noGeneratedStarts`);
  if (plane.generationOverrides !== undefined) assertPlaneGenerationOverrides(plane.generationOverrides);
  numberAt(plane.provinceTarget, `${path}.provinceTarget`);
  numberAt(plane.width, `${path}.width`);
  numberAt(plane.height, `${path}.height`);
  booleanAt(plane.wrapX, `${path}.wrapX`);
  booleanAt(plane.wrapY, `${path}.wrapY`);
  optionalEnumAt(plane.ownershipMode, OWNERSHIP_MODES, `${path}.ownershipMode`);
  optionalEnumAt(plane.landformStyle, new Set(["natural-v1"]), `${path}.landformStyle`);
  if (plane.generationKey !== undefined) idAt(plane.generationKey, `${path}.generationKey`);
  optionalEnumAt(plane.sparseLayout, SPARSE_LAYOUTS, `${path}.sparseLayout`);
  optionalBooleanAt(plane.mapNoHide, `${path}.mapNoHide`);
  optionalBooleanAt(plane.noDeepCaves, `${path}.noDeepCaves`);
  optionalStringAt(plane.mapTextColor, `${path}.mapTextColor`);
  optionalStringAt(plane.mapDominionColor, `${path}.mapDominionColor`);
  const provinces = boundedArrayAt(plane.provinces, `${path}.provinces`, MAX_IMPORTED_PROVINCES_PER_PLANE);
  provinces.forEach((value, provinceIndex) => assertProvince(recordAt(value, `${path}.provinces[${provinceIndex}]`), `${path}.provinces[${provinceIndex}]`));
  provinces.forEach((value, provinceIndex) => {
    const province = value as Record<string, unknown>;
    if (province.index !== provinceIndex + 1) {
      throw new Error(`${path}.provinces must be stored in local province-number order; expected index ${provinceIndex + 1} at array position ${provinceIndex}.`);
    }
  });
  const waterProvenanceError = landformWaterError(plane as unknown as Plane);
  if (waterProvenanceError) throw new Error(`${path}.${waterProvenanceError}`);
  boundedArrayAt(plane.edges, `${path}.edges`, MAX_IMPORTED_EDGES_PER_PLANE).forEach((value, edgeIndex) => {
    const edgePath = `${path}.edges[${edgeIndex}]`;
    const edge = recordAt(value, edgePath);
    assertKnownFields(edge, edgePath, EDGE_FIELDS);
    idAt(edge.id, `${edgePath}.id`);
    idAt(edge.a, `${edgePath}.a`);
    idAt(edge.b, `${edgePath}.b`);
    enumAt(edge.kind, EDGE_KINDS, `${edgePath}.kind`);
    optionalNumberAt(edge.special, `${edgePath}.special`);
  });
  directiveAt(plane.rawDirectives, `${path}.rawDirectives`);
}

function assertProvince(province: Record<string, unknown>, path: string): void {
  assertKnownFields(province, path, PROVINCE_FIELDS);
  idAt(province.id, `${path}.id`);
  numberAt(province.index, `${path}.index`);
  for (const key of ["x", "y", "gridX", "gridY"] as const) numberAt(province[key], `${path}.${key}`);
  stringAt(province.name, `${path}.name`);
  optionalEnumAt(province.nameSource, new Set(["generated", "authored"]), `${path}.nameSource`);
  if (province.editorLocks !== undefined) {
    const locks = boundedArrayAt(province.editorLocks, `${path}.editorLocks`, 5);
    locks.forEach(lock => enumAt(lock, new Set(["name", "terrain", "economy", "sites", "guardians"]), `${path}.editorLocks`));
    if (new Set(locks).size !== locks.length) throw new Error(`${path}.editorLocks contains duplicates.`);
  }
  enumAt(province.biome, BIOME_KEYS, `${path}.biome`);
  enumAt(province.terrain, TERRAIN_KEYS, `${path}.terrain`);
  if (province.terrainFlags !== undefined) enumArrayAt(province.terrainFlags, TERRAIN_FLAGS, `${path}.terrainFlags`);
  optionalBooleanAt(province.freshwater, `${path}.freshwater`);
  for (const key of ["small", "large", "noStart", "manySites", "warmer", "colder", "start"] as const) {
    booleanAt(province[key], `${path}.${key}`);
  }
  enumArrayAt(province.siteBias, MAGIC_PATHS, `${path}.siteBias`);
  optionalEnumAt(province.startType, START_TYPES, `${path}.startType`);
  optionalNumberAt(province.teamStart, `${path}.teamStart`);
  enumAt(province.throne, THRONE_MODES, `${path}.throne`);
  optionalStringAt(province.fixedThrone, `${path}.fixedThrone`);
  boundedArrayAt(province.sites, `${path}.sites`, MAX_SITES_PER_PROVINCE).forEach((value, siteIndex) => {
    const sitePath = `${path}.sites[${siteIndex}]`;
    const site = recordAt(value, sitePath);
    assertKnownFields(site, sitePath, MAGIC_SITE_FIELDS);
    idAt(site.id, `${sitePath}.id`);
    stringAt(site.value, `${sitePath}.value`);
    booleanAt(site.known, `${sitePath}.known`);
  });
  booleanAt(province.killRandomSites, `${path}.killRandomSites`);
  optionalNumberAt(province.owner, `${path}.owner`);
  optionalNumberAt(province.poptype, `${path}.poptype`);
  optionalNumberAt(province.population, `${path}.population`);
  optionalNumberAt(province.unrest, `${path}.unrest`);
  optionalNumberAt(province.fort, `${path}.fort`);
  booleanAt(province.temple, `${path}.temple`);
  booleanAt(province.lab, `${path}.lab`);
  optionalNumberAt(province.provinceDefense, `${path}.provinceDefense`);
  boundedArrayAt(province.defenders, `${path}.defenders`, MAX_DEFENSE_GROUPS_PER_PROVINCE).forEach((value, defenderIndex) => {
    assertDefense(recordAt(value, `${path}.defenders[${defenderIndex}]`), `${path}.defenders[${defenderIndex}]`);
  });
  const battle = recordAt(province.battle, `${path}.battle`);
  assertKnownFields(battle, `${path}.battle`, BATTLE_FIELDS);
  for (const key of ["skybox", "battleMap", "groundColor", "rockColor", "fogColor"] as const) {
    optionalStringAt(battle[key], `${path}.battle.${key}`);
  }
  directiveAt(province.rawDirectives, `${path}.rawDirectives`);
}

function assertDefense(defense: Record<string, unknown>, path: string): void {
  assertKnownFields(defense, path, DEFENSE_FIELDS);
  stringAt(defense.commander, `${path}.commander`);
  optionalBooleanAt(defense.clearMagic, `${path}.clearMagic`);
  optionalStringAt(defense.commanderName, `${path}.commanderName`);
  optionalStringAt(defense.bodyguard, `${path}.bodyguard`);
  optionalNumberAt(defense.bodyguardCount, `${path}.bodyguardCount`);
  boundedArrayAt(defense.squads, `${path}.squads`, MAX_SQUADS_PER_DEFENSE_GROUP).forEach((value, squadIndex) => {
    const squadPath = `${path}.squads[${squadIndex}]`;
    const squad = recordAt(value, squadPath);
    assertKnownFields(squad, squadPath, DEFENSE_SQUAD_FIELDS);
    idAt(squad.id, `${squadPath}.id`);
    stringAt(squad.unit, `${squadPath}.unit`);
    numberAt(squad.count, `${squadPath}.count`);
  });
  optionalNumberAt(defense.experience, `${path}.experience`);
  optionalNumberAt(defense.randomEquipment, `${path}.randomEquipment`);
  if (defense.items !== undefined) stringArrayAt(defense.items, `${path}.items`, MAX_ITEMS_PER_DEFENSE_GROUP);
  if (defense.magic !== undefined) {
    const magic = recordAt(defense.magic, `${path}.magic`);
    for (const [key, value] of Object.entries(magic)) {
      if (!MAGIC_PATHS.has(key)) throw new Error(`${path}.magic.${key} is not a supported magic path.`);
      numberAt(value, `${path}.magic.${key}`);
    }
  }
}

function recordAt(value: unknown, path: string, message?: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message ?? `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertKnownFields(record: Record<string, unknown>, path: string, fields: ReadonlySet<string>): void {
  for (const key of Object.keys(record)) {
    if (!fields.has(key)) throw new Error(`${path}.${key} is not supported by project schema version 1.`);
  }
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > MAX_GENERIC_ARRAY_ENTRIES) throw new Error(`${path} must contain at most ${MAX_GENERIC_ARRAY_ENTRIES} entries.`);
  return value;
}

function boundedArrayAt(value: unknown, path: string, maximum: number): unknown[] {
  const array = arrayAt(value, path);
  if (array.length > maximum) throw new Error(`${path} must contain at most ${maximum} entries.`);
  return array;
}

function numberAt(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
}

function optionalNumberAt(value: unknown, path: string): void {
  if (value !== undefined) numberAt(value, path);
}

function booleanAt(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
}

function optionalBooleanAt(value: unknown, path: string): void {
  if (value !== undefined) booleanAt(value, path);
}

function stringAt(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  if (value.length > MAX_IMPORTED_STRING_LENGTH) {
    throw new Error(`${path} must contain at most ${MAX_IMPORTED_STRING_LENGTH} characters.`);
  }
}

function idAt(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  if (!value.length) throw new Error(`${path} must not be empty.`);
  if (value.length > MAX_IMPORTED_ID_LENGTH) throw new Error(`${path} must contain at most ${MAX_IMPORTED_ID_LENGTH} characters.`);
  if (!SAFE_IMPORTED_ID.test(value)) throw new Error(`${path} may contain only letters, digits, underscores, and hyphens.`);
}

function directiveAt(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  if (value.length > MAX_IMPORTED_DIRECTIVE_LENGTH) {
    throw new Error(`${path} must contain at most ${MAX_IMPORTED_DIRECTIVE_LENGTH} characters.`);
  }
}

function optionalStringAt(value: unknown, path: string): void {
  if (value !== undefined) stringAt(value, path);
}

function enumAt(value: unknown, allowed: ReadonlySet<string>, path: string): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) throw new Error(`${path} has an unsupported value.`);
}

function optionalEnumAt(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  if (value !== undefined) enumAt(value, allowed, path);
}

function numberArrayAt(value: unknown, path: string, maximum = MAX_GENERIC_ARRAY_ENTRIES): void {
  boundedArrayAt(value, path, maximum).forEach((entry, index) => numberAt(entry, `${path}[${index}]`));
}

function stringArrayAt(value: unknown, path: string, maximum = MAX_GENERIC_ARRAY_ENTRIES): void {
  boundedArrayAt(value, path, maximum).forEach((entry, index) => stringAt(entry, `${path}[${index}]`));
}

function enumArrayAt(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  arrayAt(value, path).forEach((entry, index) => enumAt(entry, allowed, `${path}[${index}]`));
}

function assertProjectTextSize(text: string): void {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > MAX_PROJECT_IMPORT_BYTES) {
      throw new Error(`Project files must be at most ${MAX_PROJECT_IMPORT_BYTES} UTF-8 bytes.`);
    }
  }
}

/** Save a Blob through a temporary download link. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
