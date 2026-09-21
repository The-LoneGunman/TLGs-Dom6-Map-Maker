import { GAME_ERA_LABELS, isBlockedProvince, isWaterProvince, type GenerationInputSnapshot, type MapProject, type Province } from "./domain";
import { globalMovementAdjacency, isImpassableEdge, shortestDistances } from "./generator";
import { requirementReportLines } from "./nationRequirements";

export const ANALYSIS_MODEL_VERSION = "structural-inspector-2";
export const MAX_ANALYSIS_STARTS = 64;
export type AnalysisMode = "structural" | "conservative";
export type GenerationInputGroup = Exclude<keyof GenerationInputSnapshot, "version">;
export const GENERATION_INPUT_LABELS: Record<GenerationInputGroup, string> = {
  seed: "Seed", starts: "Players and starts", terrain: "Terrain and balance policies", planes: "Plane plan and geometry", links: "Planned gateways",
};

/** Explicit input groups keep names, host options, and manual province edits out of the pending-generation banner. */
export function captureGenerationInputs(project: MapProject): GenerationInputSnapshot {
  const s = project.settings;
  return {
    version: 1,
    seed: JSON.stringify(project.seed),
    starts: JSON.stringify([s.players, s.provincesPerPlayer, s.startDegreeTarget ?? 4,
      s.startDistribution ?? { land: s.players, coastal: 0, water: 0, cave: 0, other: 0 }, s.caveStartNations ?? []]),
    terrain: JSON.stringify([s.waterPercent, s.oceanLayout ?? "natural", s.continentCount ?? 3, s.biomeCohesion,
      s.economyBalance ?? "hard", s.overlandTopology ?? "competitive", s.specialPlaneSizePercent ?? 30, s.throneCount]),
    planes: JSON.stringify(project.planes.map((p, i) => [p.id, p.kind, p.variant, p.autoSize ?? (i === 0),
      (p.autoSize ?? (i === 0)) ? null : p.provinceTarget, p.noGeneratedStarts ?? false, p.ownershipMode, p.width, p.height, p.wrapX, p.wrapY,
      ...(p.generationOverrides ? [p.generationOverrides] : [])])),
    links: JSON.stringify([s.gateLayout ?? "hub", s.gatePairsPerConnection ?? 1, s.planeConnections ?? null]),
  };
}

export function recordGenerationInputs(project: MapProject): MapProject {
  project.generationInputs = captureGenerationInputs(project);
  return project;
}

export function pendingGenerationGroups(project: MapProject): GenerationInputGroup[] | undefined {
  if (project.generationInputs?.version !== 1) return undefined;
  const current = captureGenerationInputs(project);
  return (Object.keys(GENERATION_INPUT_LABELS) as GenerationInputGroup[]).filter(key => current[key] !== project.generationInputs![key]);
}

export interface ProvinceReference {
  key: string;
  planeId: string;
  planeName: string;
  planeNumber: number;
  provinceId: string;
  globalNumber: number;
  province: Province;
}

export function provinceReferences(project: MapProject): ProvinceReference[] {
  let offset = 0;
  return project.planes.flatMap((plane, index) => {
    const rows = plane.provinces.map(province => ({ key: `${plane.id}:${province.id}`, planeId: plane.id,
      planeName: plane.name, planeNumber: index + 1, provinceId: province.id, globalNumber: offset + province.index, province }));
    offset += plane.provinces.length;
    return rows;
  });
}

export function searchProvinces(project: MapProject, query: string, limit = 30): { total: number; results: ProvinceReference[] } {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { total: 0, results: [] };
  const matches = provinceReferences(project).filter(ref => words.every(word => {
    const number = word.replace(/^#/, "");
    if (/^\d+$/.test(number)) return ref.globalNumber === Number(number) || ref.province.index === Number(number);
    return `${ref.province.name} ${ref.planeName}`.toLocaleLowerCase().includes(word);
  }));
  return { total: matches.length, results: matches.slice(0, Math.max(0, limit)) };
}

export interface StartAnalysis extends ProvinceReference {
  nations: number[];
  team?: number;
  blocked: boolean;
  exits: number;
  twoStepKeys: string[];
  threeStepCount: number;
  exclusive?: number;
  contested?: number;
  knownPopulation: number;
  unknownPopulationCount: number;
  guardianProvinceCount: number;
  preferredThrones: number;
  fixedThrones: number;
  nearestRival?: number;
  nearestThrone?: number;
  nearestRealmEntrance?: number;
  nearestAlly?: number;
  sharedCapitalNeighbours?: number;
  fractionalOpportunity?: number;
  rivalRegionsAtFrontier?: number;
  nearestFixedThrone?: number;
  nearestPreferredThrone?: number;
}

export interface StartAnalysisReport {
  mode: AnalysisMode;
  modelVersion: string;
  totalStarts: number;
  truncated: boolean;
  starts: StartAnalysis[];
  twoStepCv?: number;
}

/** These are graph filters, deliberately not a nation movement, seasonal, economic, or combat simulator. */
export function analyzeStarts(project: MapProject, mode: AnalysisMode = "structural"): StartAnalysisReport {
  const refs = provinceReferences(project);
  const byKey = new Map(refs.map(ref => [ref.key, ref]));
  const nationsByKey = new Map<string, number[]>();
  for (const start of project.specificStarts) {
    const key = `${start.planeId}:${start.provinceId}`;
    const nations = nationsByKey.get(key) ?? [];
    if (!nations.includes(start.nation)) nations.push(start.nation);
    nationsByKey.set(key, nations);
  }
  const allStarts = refs.filter(ref => ref.province.start || ref.province.teamStart !== undefined || nationsByKey.has(ref.key));
  const startKeys = new Set(allStarts.map(ref => ref.key));
  const selectedStarts = allStarts.slice(0, MAX_ANALYSIS_STARTS);
  const graphs = new Map<string, Map<string, string[]>>();
  const structural = globalMovementAdjacency(project);
  // Invalid repeated gate endpoints can otherwise manufacture a self-exit.
  // Validation still reports the malformed record; diagnostics must not count it.
  for (const [key, neighbours] of structural) structural.set(key, neighbours.filter(neighbour => neighbour !== key));
  const graphFor = (ref: ProvinceReference) => {
    if (mode === "structural") return structural;
    const medium = isWaterProvince(ref.province) ? "water" : "dry";
    if (!graphs.has(medium)) graphs.set(medium, conservativeGraph(project, refs, medium === "water"));
    return graphs.get(medium)!;
  };
  const distanceMaps = selectedStarts.map(ref => {
    const graph = graphFor(ref);
    return graph.has(ref.key) ? shortestDistances(graph, ref.key) : new Map<string, number>();
  });
  const crossPlaneEntrances = new Set<string>();
  for (const gate of project.gates) {
    const valid = gate.endpoints.map(e => byKey.get(`${e.planeId}:${e.provinceId}`)).filter((r): r is ProvinceReference => !!r && !isBlockedProvince(r.province));
    if (new Set(valid.map(r => r.planeId)).size > 1) for (const r of valid) crossPlaneEntrances.add(r.key);
  }
  const thrones = refs.filter(r => r.province.throne === "preferred" || r.province.throne === "fixed");
  const starts = selectedStarts.map((ref, i): StartAnalysis => {
    const distances = distanceMaps[i]!;
    const region = refs.filter(r => !startKeys.has(r.key) && (distances.get(r.key) ?? Infinity) <= 2);
    const rivals = allStarts.filter(r => r.key !== ref.key && !sameTeam(ref.province, r.province));
    const rivalIndexes = selectedStarts.flatMap((r, j) => r.key !== ref.key && !sameTeam(ref.province, r.province) ? [j] : []);
    const exclusive = region.filter(r => rivalIndexes.every(j => (distanceMaps[j]!.get(r.key) ?? Infinity) > (distances.get(r.key) ?? Infinity))).length;
    const fractionalOpportunity = region.reduce((sum, r) => {
      const own = distances.get(r.key) ?? Infinity;
      const competitors = rivalIndexes.map(j => distanceMaps[j]!.get(r.key) ?? Infinity);
      if (competitors.some(d => d < own)) return sum;
      return sum + 1 / (1 + competitors.filter(d => d === own).length);
    }, 0);
    const direct = new Set((graphFor(ref).get(ref.key) ?? []).filter(key => !startKeys.has(key)));
    const otherDirect = new Set(selectedStarts.filter(r => r.key !== ref.key).flatMap(r => graphFor(r).get(r.key) ?? []));
    const frontier = new Set(region.flatMap(r => graphFor(ref).get(r.key) ?? []));
    const rivalGroups = new Set<string>();
    // Count distinct hostile regions, not individual portal-clique edges or allied capitals.
    for (const j of rivalIndexes) if ([...frontier].some(key => {
      const theirs = distanceMaps[j]!.get(key) ?? Infinity;
      return theirs <= 2 && theirs <= (distances.get(key) ?? Infinity);
    })) rivalGroups.add(selectedStarts[j]!.province.teamStart === undefined ? selectedStarts[j]!.key : `team:${selectedStarts[j]!.province.teamStart}`);
    const nearby = thrones.filter(r => (distances.get(r.key) ?? Infinity) <= 4);
    return {
      ...ref, nations: nationsByKey.get(ref.key) ?? [], team: ref.province.teamStart, blocked: !graphFor(ref).has(ref.key),
      exits: graphFor(ref).get(ref.key)?.length ?? 0,
      twoStepKeys: region.map(r => r.key),
      threeStepCount: refs.filter(r => !startKeys.has(r.key) && (distances.get(r.key) ?? Infinity) <= 3).length,
      exclusive: allStarts.length <= MAX_ANALYSIS_STARTS ? exclusive : undefined,
      contested: allStarts.length <= MAX_ANALYSIS_STARTS ? region.length - exclusive : undefined,
      knownPopulation: region.reduce((sum, r) => sum + (validPopulation(r.province) ?? 0), 0),
      unknownPopulationCount: region.filter(r => validPopulation(r.province) === undefined).length,
      guardianProvinceCount: region.filter(r => r.province.defenders.length > 0).length,
      preferredThrones: nearby.filter(r => r.province.throne === "preferred").length,
      fixedThrones: nearby.filter(r => r.province.throne === "fixed").length,
      nearestRival: nearest(rivals.map(r => distances.get(r.key))),
      nearestThrone: nearest(thrones.map(r => distances.get(r.key))),
      nearestRealmEntrance: nearest([...crossPlaneEntrances].map(key => distances.get(key))),
      nearestAlly: nearest(allStarts.filter(r => r.key !== ref.key && sameTeam(ref.province, r.province)).map(r => distances.get(r.key))),
      sharedCapitalNeighbours: allStarts.length <= MAX_ANALYSIS_STARTS ? [...direct].filter(key => otherDirect.has(key)).length : undefined,
      fractionalOpportunity: allStarts.length <= MAX_ANALYSIS_STARTS ? fractionalOpportunity : undefined,
      rivalRegionsAtFrontier: allStarts.length <= MAX_ANALYSIS_STARTS ? rivalGroups.size : undefined,
      nearestFixedThrone: nearest(thrones.filter(r => r.province.throne === "fixed").map(r => distances.get(r.key))),
      nearestPreferredThrone: nearest(thrones.filter(r => r.province.throne === "preferred").map(r => distances.get(r.key))),
    };
  });
  return { mode, modelVersion: ANALYSIS_MODEL_VERSION, totalStarts: allStarts.length, truncated: allStarts.length > MAX_ANALYSIS_STARTS,
    starts, twoStepCv: allStarts.length <= MAX_ANALYSIS_STARTS && !starts.some(s => s.blocked)
      && (mode === "structural" || new Set(starts.map(s => isWaterProvince(s.province))).size <= 1)
      ? coefficientOfVariation(starts.map(s => s.twoStepKeys.length)) : undefined };
}

function sameTeam(a: Province, b: Province): boolean {
  return a.teamStart !== undefined && b.teamStart !== undefined && a.teamStart === b.teamStart;
}

function validPopulation(province: Province): number | undefined {
  const value = province.population;
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= 50000 ? value : undefined;
}

function nearest(values: (number | undefined)[]): number | undefined {
  const finite = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  return finite.length ? Math.min(...finite) : undefined;
}

export function coefficientOfVariation(values: number[]): number | undefined {
  if (values.length < 2 || values.some(v => !Number.isFinite(v))) return undefined;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return undefined;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean;
}

function conservativeGraph(project: MapProject, refs: ProvinceReference[], water: boolean): Map<string, string[]> {
  const graph = new Map(refs.filter(r => !isBlockedProvince(r.province) && isWaterProvince(r.province) === water).map(r => [r.key, [] as string[]]));
  const link = (a: string, b: string) => {
    if (!graph.has(a) || !graph.has(b) || a === b) return;
    if (!graph.get(a)!.includes(b)) graph.get(a)!.push(b);
    if (!graph.get(b)!.includes(a)) graph.get(b)!.push(a);
  };
  for (const plane of project.planes) for (const edge of plane.edges) {
    if (isImpassableEdge(edge) || ["river", "mountain_pass", "mountain_border"].includes(edge.kind)
      || edge.kind === "custom" && ((edge.special ?? 0) & 35) !== 0) continue;
    link(`${plane.id}:${edge.a}`, `${plane.id}:${edge.b}`);
  }
  for (const gate of project.gates) {
    const endpoints = [...new Set(gate.endpoints.map(e => `${e.planeId}:${e.provinceId}`))];
    for (let i = 0; i < endpoints.length; i++) for (let j = i + 1; j < endpoints.length; j++) link(endpoints[i]!, endpoints[j]!);
  }
  return graph;
}

export function rulesetNotice(project: MapProject, catalogVersion: string): string {
  const version = project.analysisContext?.gameVersion?.trim();
  if (project.analysisContext?.mods?.trim()) return "Mods are user-declared and unverified. Only structural diagnostics are available; no nation accommodations are applied.";
  if (!version) return `Game patch not declared. The selector catalog is pinned to ${catalogVersion}; no nation-specific balance is verified.`;
  if (version !== catalogVersion) return `Declared patch ${version} differs from catalog ${catalogVersion}. Nation-specific assumptions are unverified; structural diagnostics remain available.`;
  return `Declared patch matches catalog ${catalogVersion}. This verifies neither movement nor combat balance; no nation accommodations are applied.`;
}

/** Encode user notes as single-line quoted values so a newline cannot impersonate a report section. */
export function analysisContextLines(project: MapProject, catalogVersion: string): string[] {
  const era = project.analysisContext?.era;
  return [
    `Analysis model: ${ANALYSIS_MODEL_VERSION} (neutral structural diagnostics)`,
    `Selector catalog snapshot: ${catalogVersion} (not a balance ruleset)`,
    `Declared game patch: ${JSON.stringify(project.analysisContext?.gameVersion?.trim() || "unknown")}`,
    `Declared host era: ${JSON.stringify(era === 1 || era === 2 || era === 3 ? `${GAME_ERA_LABELS[era]} (${era})` : "unknown")}`,
    `Declared mods: ${JSON.stringify(project.analysisContext?.mods?.trim() || "none declared; not verified")}`,
    rulesetNotice(project, catalogVersion).replace(/[\r\n]/g, " "),
    "Patches and mods can change nation strength. No nation compensation is applied; no patch is certified balanced.",
  ];
}

export function buildStartAnalysisText(project: MapProject, catalogVersion: string): string {
  const lines = ["START-REGION ANALYSIS — HOST ONLY", ...analysisContextLines(project, catalogVersion),
    "Distances are graph hops, not turns. Gates count as one step. Capitals are excluded from expansion counts.",
    "Team-start annotations are treated as allies; configure actual teams in the host setup.",
    "No sailing, flight, seasons, movement costs, ownership, conquest, or combat simulation.",
    "Population is not income/resources. Unset population and random independent strength remain unknown.",
    "Throne markers are planned locations, not proof of final engine placement. No reachable target is shown as unknown."];
  for (const mode of ["structural", "conservative"] as const) {
    const report = analyzeStarts(project, mode);
    lines.push("", mode === "structural" ? "POTENTIAL CONNECTIONS — all terrain and traversable border types"
      : "CONSERVATIVE CONNECTIONS — same dry/water medium; no rivers, passes, or mountain borders",
    `Starts: ${report.totalStarts}; analyzed: ${report.starts.length}${report.truncated ? "; INCOMPLETE (64-start safety limit); competition unavailable" : ""}`);
    if (!report.starts.length) lines.push("No authored starts to compare.");
    for (const s of report.starts) {
      const distance = (n?: number) => n === undefined ? "unknown" : `${n} hops`;
      lines.push(`  Global #${s.globalNumber} / plane ${s.planeNumber} / local #${s.province.index}: ${JSON.stringify(s.province.name)}`,
        `    Team group: ${s.team ?? "unassigned"}; nations: ${s.nations.join(", ") || "unassigned"}${s.blocked ? "; BLOCKED START" : ""}`,
        `    Exits: ${s.exits}; within 2/3 steps: ${s.twoStepKeys.length}/${s.threeStepCount}; exclusive/contested: ${s.exclusive ?? "unknown"}/${s.contested ?? "unknown"}`,
        `    Two-step population: ${s.knownPopulation} known + ${s.unknownPopulationCount} unknown provinces; authored guardian provinces: ${s.guardianProvinceCount} (difficulty unknown)`,
        `    Thrones within 4 hops: ${s.preferredThrones} preferred / ${s.fixedThrones} fixed`,
        `    Nearest rival: ${distance(s.nearestRival)}; throne: ${distance(s.nearestThrone)}; cross-plane entrance: ${distance(s.nearestRealmEntrance)}`,
        `    Fractional two-step opportunity: ${s.fractionalOpportunity?.toFixed(2) ?? "unknown"}; hostile frontier groups: ${s.rivalRegionsAtFrontier ?? "unknown"}; shared direct surroundings: ${s.sharedCapitalNeighbours}`,
        `    Nearest ally: ${distance(s.nearestAlly)}; fixed throne: ${distance(s.nearestFixedThrone)}; preferred throne: ${distance(s.nearestPreferredThrone)}`);
    }
  }
  lines.push("", "Exclusive = closer than every rival; contested = tied or a rival is closer. Neither predicts ownership.");
  lines.push("Fractional opportunity awards one share for a distance lead, divides ties between rival starts, and awards zero if a rival is closer. Allies do not compete; shares are not an additive team economy or conquest forecast.");
  lines.push(...requirementReportLines(project));
  return lines.join("\r\n");
}
