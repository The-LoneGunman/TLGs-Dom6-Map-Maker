import { cloneProject, type GenerationSettings, type MapProject, type Plane } from "./domain";
import { addPlane, createDefaultProject, preflightStartPlan, synchronizePlaneEdges } from "./generator";
import { parseProject, serializeProject } from "./export";
import { assertProjectLocks } from "./authoringLocks";

export const MAX_RECIPE_BYTES = 256 * 1024;
export const SETTINGS_GENERATOR_REVISION = "atlas-generation-2026-09-22-natural-v1";
const PLANE_KEYS = ["id", "name", "kind", "variant", "autoSize", "noGeneratedStarts", "provinceTarget", "width", "height", "wrapX", "wrapY", "ownershipMode", "generationOverrides", "sparseLayout"] as const;
export type RecipePlane = Pick<Plane, typeof PLANE_KEYS[number]>;
export interface SettingsRecipe {
  kind: "pantokrator-settings";
  version: 1;
  name: string;
  generator: "atlas-generation-2026-09-20" | typeof SETTINGS_GENERATOR_REVISION;
  seed?: string;
  settings: GenerationSettings;
  planes: RecipePlane[];
  assumptions?: MapProject["analysisContext"];
  populationDefense?: MapProject["populationDefense"];
}

export function createSettingsRecipe(project: MapProject, name = project.name, includeSeed = false): SettingsRecipe {
  return {
    kind: "pantokrator-settings", version: 1, name: name.trim().slice(0,120) || "Atlas recipe", generator: SETTINGS_GENERATOR_REVISION,
    ...(includeSeed ? { seed: project.seed } : {}),
    settings: structuredClone(project.settings),
    planes: project.planes.map(p => Object.fromEntries(PLANE_KEYS.filter(k => p[k] !== undefined).map(k => [k, structuredClone(p[k])]))) as unknown as RecipePlane[],
    ...(project.analysisContext ? { assumptions: structuredClone(project.analysisContext) } : {}),
    ...(project.populationDefense ? { populationDefense: structuredClone(project.populationDefense) } : {}),
  };
}

function bounded(value: number | undefined, min: number, max: number, label: string) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < min || value > max)) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
}

export function parseSettingsRecipe(text: string): SettingsRecipe {
  if (new TextEncoder().encode(text).byteLength > MAX_RECIPE_BYTES) throw new Error("Settings recipes are limited to 256 KiB.");
  const value = JSON.parse(text) as SettingsRecipe;
  if (!value || value.kind !== "pantokrator-settings" || value.version !== 1
    || !["atlas-generation-2026-09-20", SETTINGS_GENERATOR_REVISION].includes(value.generator)) throw new Error("This is not a supported Atlas settings recipe.");
  if (Object.keys(value).some(k => !["kind", "version", "name", "generator", "seed", "settings", "planes", "assumptions", "populationDefense"].includes(k))) throw new Error("The settings recipe contains unknown fields.");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 120) throw new Error("Recipe names require 1–120 characters.");
  if (value.seed !== undefined && (typeof value.seed !== "string" || value.seed.length > 4096)) throw new Error("Invalid recipe seed.");
  if (!Array.isArray(value.planes) || value.planes.length < 1 || value.planes.length > 8) throw new Error("Recipes require 1–8 plane configurations.");
  const base = createDefaultProject("settings-recipe-validation", {generate:false});
  base.settings = value.settings;
  base.analysisContext = value.assumptions;
  base.populationDefense = value.populationDefense;
  base.planes = value.planes.map(p => {
    if (!p || typeof p !== "object" || Object.keys(p).some(k => !(PLANE_KEYS as readonly string[]).includes(k))) throw new Error("A recipe plane contains map content or unknown configuration fields.");
    if (["id","name","kind","provinceTarget","width","height","wrapX","wrapY"].some(key => !(key in p))) throw new Error("A recipe plane is missing required configuration fields.");
    return { ...structuredClone(base.planes[0]!), ...p, provinces: [], edges: [], rawDirectives: "" };
  });
  base.gates = []; base.specificStarts = [];
  parseProject(serializeProject(base)); // Reuse strict project enum, field, string and collection validation.
  if (new Set(value.planes.map(p => p.id)).size !== value.planes.length) throw new Error("Recipe plane IDs must be unique.");
  const s = value.settings;
  bounded(s.players, 2, 32, "Players"); bounded(s.provincesPerPlayer, 8, 30, "Provinces/player");
  bounded(s.waterPercent, 0, 60, "Water"); bounded(s.biomeCohesion, 0, 100, "Cohesion"); bounded(s.throneCount, 0, 64, "Thrones");
  bounded(s.continentCount, 2, 6, "Continents"); bounded(s.specialPlaneSizePercent, 1, 500, "Bonus size");
  bounded(s.startDegreeTarget, 1, 8, "Start exits"); bounded(s.siteFrequency, 0, 100, "Site frequency");
  bounded(s.gatePairsPerConnection, 1, 3, "Gate pairs");
  bounded(s.provinceNameSeed, 0, Number.MAX_SAFE_INTEGER, "Name shuffle seed");
  for (const nation of s.caveStartNations ?? []) bounded(nation, 5, 1000000, "Cave-start nation ID");
  if (new Set(s.caveStartNations ?? []).size !== (s.caveStartNations?.length ?? 0)) throw new Error("Recipe cave-start nation IDs must be unique.");
  if (s.startDistribution) {
    for (const count of Object.values(s.startDistribution)) bounded(count, 0, 32, "Start allocation");
    if (Object.values(s.startDistribution).reduce((a,b) => a + b, 0) !== s.players) throw new Error("Recipe start allocation must equal Players.");
  }
  for (const p of value.planes) {
    bounded(p.provinceTarget, 8, 800, "Plane target"); bounded(p.width, 256, 3840, "Width"); bounded(p.height, 256, 3840, "Height");
    if (p.width * p.height > 8294400) throw new Error("Recipe resolution exceeds the supported pixel budget.");
  }
  const connections = new Set<string>();
  for (const link of s.planeConnections ?? []) {
    bounded(link.pairs, 1, 3, "Gate pairs");
    if (link.a === link.b || !value.planes.some(p => p.id === link.a) || !value.planes.some(p => p.id === link.b)) throw new Error("A recipe gateway references an unknown or repeated plane.");
    const pair = JSON.stringify([link.a, link.b].sort());
    if (connections.has(pair)) throw new Error("Recipe plane connections must be unique; a reversed pair describes the same gateway plan.");
    connections.add(pair);
  }
  const errors = preflightStartPlan(base);
  if (errors.length) throw new Error(`Recipe cannot allocate its starts: ${errors[0]}`);
  return value;
}

/** Never deletes an existing plane or province. Extra current planes require an explicit user decision. */
export function applySettingsRecipe(project: MapProject, recipe: SettingsRecipe): MapProject {
  const verified = parseSettingsRecipe(JSON.stringify(recipe));
  if (project.planes.length > verified.planes.length) throw new Error("This atlas has more planes than the recipe. Remove extra planes explicitly, or apply the recipe to a fresh atlas.");
  let next = cloneProject(project);
  while (next.planes.length < verified.planes.length) next = addPlane(next, verified.planes[next.planes.length]!.kind, { generate: false });
  const idMap = new Map(verified.planes.map((p,i) => [p.id, next.planes[i]!.id]));
  next.settings = structuredClone(verified.settings);
  if (next.settings.planeConnections) next.settings.planeConnections = next.settings.planeConnections.map(c => ({ ...c, a:idMap.get(c.a)!, b:idMap.get(c.b)! }));
  // Older recipes omit host assumptions. Omission is not an instruction to
  // erase the current patch/mod declaration or silently suspend a pinned policy.
  if (verified.assumptions !== undefined) next.analysisContext = structuredClone(verified.assumptions);
  // Old recipes do not express a defense-policy choice; do not silently turn
  // off an explicitly selected policy when applying one of those recipes.
  if (verified.populationDefense !== undefined) next.populationDefense = structuredClone(verified.populationDefense);
  if (verified.seed !== undefined) next.seed = verified.seed;
  next.planes.forEach((p,i) => {
    const settings = verified.planes[i]!;
    // Deprecated sparseLayout metadata remains round-trippable but has no
    // geometry effect. Real geometry changes still synchronize the graph.
    const beforeGeometry = JSON.stringify([p.kind,p.ownershipMode,p.width,p.height,p.wrapX,p.wrapY]);
    for (const key of PLANE_KEYS) if (key !== "id" && key !== "name") {
      if (settings[key] === undefined) delete p[key]; else Object.assign(p, { [key]: settings[key] });
    }
    if (beforeGeometry !== JSON.stringify([p.kind,p.ownershipMode,p.width,p.height,p.wrapX,p.wrapY])) {
      p.edges = synchronizePlaneEdges(p, `${next.seed}:recipe:${p.id}`).edges;
    }
  });
  assertProjectLocks(project, next);
  serializeProject(next);
  return next;
}

export const BUILTIN_RECIPES = [
  { id: "ffa", name: "Balanced FFA", note: "Neutral start allocation with the existing hard economy and competitive-route defaults.", settings: { waterPercent:18, oceanLayout:"natural", economyBalance:"hard", overlandTopology:"competitive", biomeCohesion:58 } },
  { id: "continents", name: "Continental rivalry", note: "Three major landmasses requested; feasibility depends on starts, wrapping and water.", settings: { waterPercent:40, oceanLayout:"multiple_continents", continentCount:3, economyBalance:"hard", overlandTopology:"strategic" } },
  { id: "naval", name: "Naval geography", note: "Island chains and open routes. Configure water/coastal starts separately; this does not choose nations.", settings: { waterPercent:52, oceanLayout:"island_chains", economyBalance:"soft", overlandTopology:"open" } },
  { id: "frontiers", name: "Strategic frontiers", note: "More overland chokepoints with soft economy correction; existing team/start annotations are not moved.", settings: { waterPercent:25, oceanLayout:"natural", economyBalance:"soft", overlandTopology:"strategic", biomeCohesion:82 } },
] as const;

export function applyBuiltinRecipe(project: MapProject, id: string): MapProject {
  const recipe = BUILTIN_RECIPES.find(r => r.id === id);
  if (!recipe) throw new Error("Unknown recipe.");
  const next = cloneProject(project);
  Object.assign(next.settings, recipe.settings);
  serializeProject(next);
  return next;
}
