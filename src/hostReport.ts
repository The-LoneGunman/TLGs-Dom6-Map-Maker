import {
  TERRAIN_LABELS,
  effectiveProvinceTerrainFlags,
  type Edge,
  type MapProject,
  type Plane,
  type Province,
  type TerrainFlag,
} from "./domain";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "./catalog";
import { buildInitialDefensePlan, type VerifiedPopulationDefenseProfile } from "./populationDefenders";
import { VERIFIED_POPULATION_DEFENSE_PROFILES } from "./populationDefenseProfiles";

interface ProvinceRecord {
  plane: Plane;
  planeNumber: number;
  province: Province;
  globalNumber: number;
}

interface RawDirectiveStats {
  scopes: number;
  lines: number;
}

const TERRAIN_FLAG_LABELS: Record<TerrainFlag, string> = {
  sea: "Sea",
  freshwater: "Fresh water",
  highland: "Highlands",
  swamp: "Swamp",
  waste: "Waste",
  forest: "Forest",
  farm: "Farmland",
  deep: "Deep sea",
  cave: "Cave",
  mountains: "Mountains",
  cavewall: "Cave wall",
};

/**
 * Build a host-only, plain-text directory of the complete atlas topology.
 *
 * The report deliberately never includes raw directive text. It only reports
 * the number of populated directive scopes and nonblank lines so a host knows
 * that advanced content exists without copying potentially private text into a
 * shareable diagnostic artifact.
 */
export function buildHostTopologyReport(
  project: MapProject,
  catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
  profiles: readonly VerifiedPopulationDefenseProfile[] = VERIFIED_POPULATION_DEFENSE_PROFILES,
): string {
  const defensePlan = project.populationDefense?.enabled
    ? buildInitialDefensePlan(project, catalog, project.populationDefense, profiles) : undefined;
  const records = provinceRecords(project);
  const recordByKey = new Map(records.map((record) => [provinceKey(record.plane.id, record.province.id), record]));
  const planeNumberById = new Map(project.planes.map((plane, index) => [plane.id, index + 1]));
  const specificStartsByProvince = new Map<string, number[]>();
  for (const start of project.specificStarts) {
    const key = provinceKey(start.planeId, start.provinceId);
    const nations = specificStartsByProvince.get(key) ?? [];
    nations.push(start.nation);
    specificStartsByProvince.set(key, nations);
  }

  const rawStats = rawDirectiveStats(project);
  const genericStarts = records.filter(({ province }) => province.start).length;
  const teamStarts = records.filter(({ province }) => province.teamStart !== undefined).length;
  const resolvedSpecificStarts = project.specificStarts.filter((start) => recordByKey.has(provinceKey(start.planeId, start.provinceId))).length;
  const throneCounts = {
    preferred: records.filter(({ province }) => province.throne === "preferred").length,
    fixed: records.filter(({ province }) => province.throne === "fixed").length,
    avoid: records.filter(({ province }) => province.throne === "avoid").length,
  };
  const edgeCount = project.planes.reduce((total, plane) => total + plane.edges.length, 0);
  const gateEndpointCount = project.gates.reduce((total, gate) => total + gate.endpoints.length, 0);

  const lines: string[] = [
    "PANTOKRATOR ATLAS — HOST TOPOLOGY DOSSIER",
    "HOST ONLY — DO NOT DISTRIBUTE TO PLAYERS",
    "This file reveals exact starts, throne preferences, borders, and cross-plane gateways.",
    "Raw directive contents are always redacted.",
    "",
    "## Spoiler-aware summary",
    "Counts only; exact spoiler locations appear in the detailed host sections below.",
    `Atlas: ${quoted(project.name)} | Planes: ${project.planes.length} | Provinces: ${records.length}`,
    `Starts: ${genericStarts} generic | ${teamStarts} team-marked provinces | ${project.specificStarts.length} nation-specific assignments (${resolvedSpecificStarts} resolved)`,
    `Throne markers: ${throneCounts.preferred} preferred | ${throneCounts.fixed} fixed | ${throneCounts.avoid} avoided`,
    `Topology: ${edgeCount} ordinary edges | ${project.gates.length} gate groups | ${gateEndpointCount} gate endpoints`,
    `Advanced raw directives: ${rawStats.scopes} populated ${plural(rawStats.scopes, "scope")} | ${rawStats.lines} nonblank ${plural(rawStats.lines, "line")} (contents redacted)`,
  ];

  if (defensePlan) lines.push(
    `Population-matched initial defenders: revision ${quoted(project.populationDefense!.profileRevision)}`,
    `Defense coverage: ${defensePlan.counts.derived} matched | ${defensePlan.counts.custom} custom armies preserved | ${defensePlan.counts.excluded} excluded | ${defensePlan.counts.unsupported} unsupported (engine armies unchanged)`,
    "These are fixed-count initial army templates, not persistent provincial defense or a guarantee of balanced combat. Starts and their directly connected neighbors are excluded from automatic matching.",
  );

  for (const [planeIndex, plane] of project.planes.entries()) {
    const planeNumber = planeIndex + 1;
    const planeRecords = records
      .filter((record) => record.plane.id === plane.id)
      .sort((left, right) => left.province.index - right.province.index || left.province.id.localeCompare(right.province.id));
    const planeRawLines = directiveLineCount(plane.rawDirectives);
    lines.push(
      "",
      `## Plane ${planeNumber}: ${quoted(plane.name)} (${plane.kind})`,
      `Provinces: ${plane.provinces.length} | Edges: ${plane.edges.length} | Wrap: ${wrapDescription(plane)}`
        + (planeRawLines ? ` | Raw directives: ${planeRawLines} ${plural(planeRawLines, "line")} (contents redacted)` : ""),
      "",
      "### Provinces",
    );

    if (!planeRecords.length) lines.push("- None.");
    for (const record of planeRecords) {
      const rawLines = directiveLineCount(record.province.rawDirectives);
      const markers = provinceMarkers(record, specificStartsByProvince.get(provinceKey(plane.id, record.province.id)) ?? []);
      const defense = defensePlan?.entries.get(`${plane.id}:${record.province.id}`);
      if (defense) markers.push(`initial defenders=${defense.status} (${defense.reason})`);
      if (rawLines) markers.push(`raw directives=${rawLines} ${plural(rawLines, "line")} (redacted)`);
      lines.push(
        `- L#${record.province.index} / G#${record.globalNumber} | ${quoted(record.province.name)}`
          + ` | terrain=${terrainDescription(record.province)}`
          + ` | markers=${markers.length ? markers.join("; ") : "none"}`,
      );
    }

    lines.push("", "### Ordinary edges and border kinds");
    const sortedEdges = [...plane.edges].sort((left, right) => compareEdges(left, right, plane, recordByKey));
    if (!sortedEdges.length) lines.push("- None.");
    for (const edge of sortedEdges) {
      const left = edgeEndpointDescription(plane, edge.a, recordByKey);
      const right = edgeEndpointDescription(plane, edge.b, recordByKey);
      const custom = edge.kind === "custom" && edge.special !== undefined ? ` (special ${edge.special})` : "";
      lines.push(`- ${left} <-> ${right} | border=${edge.kind}${custom}`);
    }
  }

  lines.push("", "## Cross-plane and remote gateway groups");
  const sortedGates = [...project.gates].sort((left, right) => left.gateNumber - right.gateNumber || left.id.localeCompare(right.id));
  if (!sortedGates.length) lines.push("- None.");
  for (const gate of sortedGates) {
    const fallback = gate.adjacentStartFallback ? " | adjacent-start fallback used" : "";
    lines.push(
      "",
      `### Gate #${gate.gateNumber} | group=${quoted(gate.id)} | endpoints=${gate.endpoints.length}${fallback}`,
      "Dominions connects every endpoint in this group bidirectionally.",
    );
    if (!gate.endpoints.length) lines.push("- None.");
    const endpoints = [...gate.endpoints].sort((left, right) => {
      const leftRecord = recordByKey.get(provinceKey(left.planeId, left.provinceId));
      const rightRecord = recordByKey.get(provinceKey(right.planeId, right.provinceId));
      const leftPlane = planeNumberById.get(left.planeId) ?? Number.MAX_SAFE_INTEGER;
      const rightPlane = planeNumberById.get(right.planeId) ?? Number.MAX_SAFE_INTEGER;
      return leftPlane - rightPlane
        || (leftRecord?.province.index ?? Number.MAX_SAFE_INTEGER) - (rightRecord?.province.index ?? Number.MAX_SAFE_INTEGER)
        || left.planeId.localeCompare(right.planeId)
        || left.provinceId.localeCompare(right.provinceId);
    });
    for (const endpoint of endpoints) lines.push(`- ${gateEndpointDescription(endpoint.planeId, endpoint.provinceId, project, recordByKey)}`);
  }

  const unresolvedStarts = project.specificStarts.filter((start) => !recordByKey.has(provinceKey(start.planeId, start.provinceId)));
  if (unresolvedStarts.length) {
    lines.push("", "## Unresolved nation-specific start references");
    for (const start of unresolvedStarts) {
      lines.push(`- Nation ${start.nation} -> plane id ${quoted(start.planeId)} / province id ${quoted(start.provinceId)}`);
    }
  }

  lines.push("", "END OF HOST-ONLY DOSSIER", "");
  return lines.join("\n");
}

function provinceRecords(project: MapProject): ProvinceRecord[] {
  const result: ProvinceRecord[] = [];
  let offset = 0;
  for (const [planeIndex, plane] of project.planes.entries()) {
    for (const province of plane.provinces) {
      result.push({ plane, planeNumber: planeIndex + 1, province, globalNumber: offset + province.index });
    }
    offset += plane.provinces.length;
  }
  return result;
}

function provinceMarkers(record: ProvinceRecord, specificStartNations: number[]): string[] {
  const { province } = record;
  const markers: string[] = [];
  if (province.start) markers.push(`generic start${province.startType ? ` (${province.startType})` : ""}`);
  if (province.teamStart !== undefined) markers.push(`team start=${province.teamStart}`);
  for (const nation of [...specificStartNations].sort((left, right) => left - right)) markers.push(`specific start=nation ${nation}`);
  if (province.noStart) markers.push("no random start");
  if (province.throne === "preferred") markers.push("throne=preferred");
  if (province.throne === "avoid") markers.push("throne=avoid");
  if (province.throne === "fixed") {
    markers.push(`throne=fixed${province.fixedThrone ? ` (${singleLine(province.fixedThrone)})` : ""}`);
  }
  return markers;
}

function terrainDescription(province: Province): string {
  const primary = TERRAIN_LABELS[province.terrain];
  const flags = [...effectiveProvinceTerrainFlags(province)].map((flag) => TERRAIN_FLAG_LABELS[flag]);
  return `${primary} [effective: ${flags.length ? flags.join(" + ") : "plain land"}]`;
}

function edgeEndpointDescription(plane: Plane, provinceId: string, records: Map<string, ProvinceRecord>): string {
  const record = records.get(provinceKey(plane.id, provinceId));
  return record
    ? `L#${record.province.index}/G#${record.globalNumber} ${quoted(record.province.name)}`
    : `[missing province id ${quoted(provinceId)}]`;
}

function gateEndpointDescription(
  planeId: string,
  provinceId: string,
  project: MapProject,
  records: Map<string, ProvinceRecord>,
): string {
  const planeIndex = project.planes.findIndex((plane) => plane.id === planeId);
  if (planeIndex < 0) return `[missing plane id ${quoted(planeId)}] / [province id ${quoted(provinceId)}]`;
  const plane = project.planes[planeIndex]!;
  const record = records.get(provinceKey(planeId, provinceId));
  return record
    ? `Plane ${planeIndex + 1} ${quoted(plane.name)} / L#${record.province.index} / G#${record.globalNumber} / ${quoted(record.province.name)}`
    : `Plane ${planeIndex + 1} ${quoted(plane.name)} / [missing province id ${quoted(provinceId)}]`;
}

function compareEdges(left: Edge, right: Edge, plane: Plane, records: Map<string, ProvinceRecord>): number {
  const leftA = records.get(provinceKey(plane.id, left.a))?.province.index ?? Number.MAX_SAFE_INTEGER;
  const leftB = records.get(provinceKey(plane.id, left.b))?.province.index ?? Number.MAX_SAFE_INTEGER;
  const rightA = records.get(provinceKey(plane.id, right.a))?.province.index ?? Number.MAX_SAFE_INTEGER;
  const rightB = records.get(provinceKey(plane.id, right.b))?.province.index ?? Number.MAX_SAFE_INTEGER;
  return Math.min(leftA, leftB) - Math.min(rightA, rightB)
    || Math.max(leftA, leftB) - Math.max(rightA, rightB)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function rawDirectiveStats(project: MapProject): RawDirectiveStats {
  const values = [
    project.rawDirectives,
    ...project.planes.flatMap((plane) => [plane.rawDirectives, ...plane.provinces.map((province) => province.rawDirectives)]),
  ];
  return values.reduce<RawDirectiveStats>((stats, value) => {
    const lines = directiveLineCount(value);
    if (lines) stats.scopes += 1;
    stats.lines += lines;
    return stats;
  }, { scopes: 0, lines: 0 });
}

function directiveLineCount(value: string): number {
  return value.split(/\r\n?|\n/).filter((line) => line.trim().length > 0).length;
}

function wrapDescription(plane: Plane): string {
  if (plane.wrapX && plane.wrapY) return "east/west + north/south";
  if (plane.wrapX) return "east/west";
  if (plane.wrapY) return "north/south";
  return "none";
}

function provinceKey(planeId: string, provinceId: string): string {
  return `${planeId}\u0000${provinceId}`;
}

function quoted(value: string): string {
  return JSON.stringify(singleLine(value));
}

function singleLine(value: string): string {
  const printable = [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");
  return printable.replace(/\s+/g, " ").trim();
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
