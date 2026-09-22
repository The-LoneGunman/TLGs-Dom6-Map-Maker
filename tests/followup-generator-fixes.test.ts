import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  effectiveProvinceTerrainFlags,
  isBlockedProvince,
  isWaterProvince,
  isWaterTerrain,
  setNationSpecificStart,
  type MapProject,
  type Plane,
  type Province,
} from "../src/domain";
import {
  addPlane,
  adjacencyFor,
  createDefaultProject,
  generateGates,
  generateProject,
  preflightAuthoredStartNotices,
  rerollPlaneDetails,
  shortestDistances,
} from "../src/generator";
import { buildHostTopologyReport } from "../src/hostReport";
import { previewBatchEdit, previewContentReroll, protectedProvinceKeys } from "../src/iteration";

const waterCount = (plane: Plane) => plane.provinces.filter(isWaterProvince).length;
const startCounts = (project: MapProject) => {
  const counts: Record<string, number> = {};
  for (const plane of project.planes) for (const province of plane.provinces) {
    if (province.start) counts[province.startType ?? "land"] = (counts[province.startType ?? "land"] ?? 0) + 1;
  }
  return counts;
};

test("a plane that cannot host water or coastal starts keeps its water preference", () => {
  let project = createDefaultProject("dream-water-1", { generate: false });
  project.settings.players = 6;
  project.settings.waterPercent = 18;
  project.settings.startDistribution = { land: 0, coastal: 6, water: 0, cave: 0, other: 0 };
  project = addPlane(project, "dream", { generate: false, autoSize: true, noGeneratedStarts: true });
  project.planes[1]!.generationOverrides = { waterPercent: 0 };
  const generated = generateProject(project);
  const [surface, dream] = generated.planes;
  assert.equal(waterCount(dream!), 0, "the reserved Dream plane's 0% water preference is honored");
  assert.ok(!dream!.provinces.some((province) => province.start), "the reserved plane hosts no starts");
  assert.deepEqual(startCounts(generated), { coastal: 6 }, "every coastal start is still placed on the surface");
  assert.ok(waterCount(surface!) >= 2);
});

test("a water-capable plane without planned water starts is not raised by the start-driven minimum", () => {
  // Elemental planes host only "other" starts. Before, a 4% preference was
  // raised to the whole map's coastal/water requirement (about 14%).
  let project = createDefaultProject("id-g", { generate: false });
  project.settings.players = 6;
  project.settings.waterPercent = 4;
  project.settings.startDistribution = { land: 0, coastal: 4, water: 2, cave: 0, other: 0 };
  project = addPlane(project, "elemental", { generate: false });
  const generated = generateProject(project);
  const elemental = generated.planes[1]!;
  assert.ok(waterCount(elemental) <= Math.ceil(elemental.provinces.length * 0.06),
    `elemental water stays near its 4% preference (${waterCount(elemental)} of ${elemental.provinces.length})`);
  assert.deepEqual(startCounts(generated), { coastal: 4, water: 2 });
});

function caveProject() {
  let project = createDefaultProject("cavepop-2", { generate: false });
  project.settings.players = 4;
  project.settings.startDistribution = { land: 3, coastal: 0, water: 0, cave: 1, other: 0 };
  project = addPlane(project, "cave", { generate: false, autoSize: true });
  return generateProject(project);
}

const populations = (project: MapProject, planeId: string, ids: readonly string[]) => {
  const plane = project.planes.find((item) => item.id === planeId)!;
  return ids.map((id) => plane.provinces.find((province) => province.id === id)!.population);
};

test("rerolled population follows the effective terrain of batch flag edits", () => {
  const project = caveProject();
  const cave = project.planes.find((plane) => plane.kind === "cave")!;
  const protectedKeys = protectedProvinceKeys(project, 1);
  const pick = (terrain: Province["terrain"]) => cave.provinces.filter((province) => province.terrain === terrain
    && !province.terrainFlags?.length && !protectedKeys.has(`${cave.id}:${province.id}`)).map((province) => province.id);
  const caves = pick("cave"), caveForests = pick("caveforest");
  assert.ok(caves.length && caveForests.length, "fixture has unprotected Cave and Cave forest provinces");

  // Cave + forest stored as plains + [cave, forest] rerolls like the Cave forest preset.
  const flagged = previewBatchEdit(project, cave.id, caves, { kind: "flag", flag: "forest", enabled: true }).project;
  const flaggedProvince = flagged.planes.find((plane) => plane.id === cave.id)!.provinces.find((province) => province.id === caves[0])!;
  assert.equal(flaggedProvince.terrain, "plains", "fixture: batch flag edits materialize the mask on plains");
  const preset = previewBatchEdit(project, cave.id, caves, { kind: "terrain", terrain: "caveforest" }).project;
  assert.deepEqual(
    populations(previewContentReroll(flagged, cave.id, caves, "economy", "seed-1").project, cave.id, caves),
    populations(previewContentReroll(preset, cave.id, caves, "economy", "seed-1").project, cave.id, caves),
  );

  // Removing an inherent flag (Cave forest without forest) rerolls like plain Cave.
  const unforested = previewBatchEdit(project, cave.id, caveForests, { kind: "flag", flag: "forest", enabled: false }).project;
  const plainCave = previewBatchEdit(project, cave.id, caveForests, { kind: "terrain", terrain: "cave" }).project;
  assert.deepEqual(
    populations(previewContentReroll(unforested, cave.id, caveForests, "economy", "seed-1").project, cave.id, caveForests),
    populations(previewContentReroll(plainCave, cave.id, caveForests, "economy", "seed-1").project, cave.id, caveForests),
  );
});

test("a reroll does not depend on whether a terrain is stored as a preset or as plains + flags", () => {
  const project = caveProject();
  for (const plane of project.planes) {
    const materialized = structuredClone(plane);
    for (const province of materialized.provinces) {
      if (isWaterProvince(province) || isBlockedProvince(province)) continue;
      const flags = [...effectiveProvinceTerrainFlags(province)];
      province.terrain = "plains";
      province.terrainFlags = flags;
      province.freshwater = false;
    }
    const expected = rerollPlaneDetails(plane, "representation", project).provinces.map((province) => province.population);
    const actual = rerollPlaneDetails(materialized, "representation", project).provinces.map((province) => province.population);
    assert.deepEqual(actual, expected, `${plane.kind}: unedited provinces keep their preset's population base`);
  }
});

function nearestStartDistance(plane: Plane, provinceId: string): number {
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  return Math.min(...plane.provinces.filter((province) => province.start)
    .map((start) => shortestDistances(adjacency, start.id).get(provinceId) ?? Infinity));
}

test("the adjacent-start gate flag is set only for an endpoint inside a start's one-ring", () => {
  let project = createDefaultProject("gate-fallback-two-ring");
  project = addPlane(project, "cave");
  project.settings.planeConnections = [{ a: project.planes[0]!.id, b: project.planes[1]!.id, pairs: 1 }];
  for (const plane of project.planes) {
    const start = plane.provinces.find((province) => !isWaterTerrain(province.terrain) && !province.noStart)!;
    const distances = shortestDistances(adjacencyFor(plane, { traversableOnly: true }), start.id);
    // The only throne-free non-start province is two moves out (and dry, as a
    // surface/cave pair requires), so the spaced pool is empty and the
    // fallback must choose it.
    const twoRing = plane.provinces.find((province) => distances.get(province.id) === 2
      && !isBlockedProvince(province) && !isWaterProvince(province))!;
    assert.ok(twoRing, "fixture needs a two-ring province");
    for (const province of plane.provinces) {
      province.start = province.id === start.id;
      province.teamStart = undefined;
      province.throne = province.id === start.id ? "avoid" : province.id === twoRing.id ? "none" : "preferred";
    }
  }
  project.specificStarts = [];
  const gates = generateGates(project);
  assert.equal(gates.length, 1);
  for (const endpoint of gates[0]!.endpoints) {
    assert.equal(nearestStartDistance(project.planes.find((plane) => plane.id === endpoint.planeId)!, endpoint.provinceId), 2);
  }
  assert.equal(gates[0]!.adjacentStartFallback, undefined, "a two-ring endpoint is not an adjacent-start fallback");
  project.gates = gates;
  assert.doesNotMatch(buildHostTopologyReport(project), /adjacent-start fallback used/);
});

test("a generated constrained map flags exactly the gates that touch a start's one-ring", () => {
  let project = createDefaultProject("gate-cave-100-12-g1", { generate: false });
  project.settings.players = 3;
  project.settings.startDistribution = { land: 2, coastal: 0, water: 0, cave: 1, other: 0 };
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 100;
  project = addPlane(project, "cave", { generate: false, provinceTarget: 12 });
  project.settings.planeConnections = [{ a: project.planes[0]!.id, b: project.planes[1]!.id, pairs: 3 }];
  const generated = generateProject(project);
  assert.equal(generated.gates.length, 3);
  let spacedFallbacks = 0;
  for (const gate of generated.gates) {
    const distances = gate.endpoints.map((endpoint) =>
      nearestStartDistance(generated.planes.find((plane) => plane.id === endpoint.planeId)!, endpoint.provinceId));
    assert.equal(gate.adjacentStartFallback ?? false, distances.includes(1), `gate #${gate.gateNumber}: ${distances.join(", ")}`);
    if (distances.every((distance) => distance >= 2)) spacedFallbacks += 1;
  }
  assert.ok(spacedFallbacks > 0, "fixture: the cramped cave forces fallback endpoints two moves from its start");
  assert.doesNotMatch(buildHostTopologyReport(generated), /adjacent-start fallback used/);
});

function crowdedNationStart(nation: number) {
  let project = createDefaultProject("edge-tiny", { generate: false });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 26;
  Object.assign(project.settings, { players: 4, provincesPerPlayer: 8, startDistribution: { land: 4, coastal: 0, water: 0, cave: 0, other: 0 } });
  project = generateProject(project);
  const plane = project.planes[0]!;
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const hub = [...plane.provinces].filter((province) => !province.noStart)
    .sort((a, b) => adjacency.get(b.id)!.length - adjacency.get(a.id)!.length)[0]!;
  assert.equal(setNationSpecificStart(project, plane.id, hub.id, nation), true);
  return generateProject(project);
}

test("authored-start notices and warnings name the nation with its ID", () => {
  const named = crowdedNationStart(33);
  assert.ok(named.generationWarnings?.some((warning) => warning.includes("authored start for Niefelheim (#33) at")));
  const [notice] = preflightAuthoredStartNotices(named);
  assert.equal(notice?.nationLabel, "Niefelheim (#33)");
  assert.match(notice!.message, /^The authored start for Niefelheim \(#33\) at /);

  const custom = crowdedNationStart(150);
  assert.ok(custom.generationWarnings?.some((warning) => warning.includes("authored start for nation 150 at")),
    "a nation outside the built-in catalog falls back to its ID");
  assert.equal(preflightAuthoredStartNotices(custom)[0]?.nationLabel, "nation 150");
  const withCatalog = preflightAuthoredStartNotices(custom, [{ id: 150, name: "Custom Realm", provenanceId: "user" }]);
  assert.equal(withCatalog[0]?.nationLabel, "Custom Realm (#150)", "the active catalog names custom nations");
  assert.match(withCatalog[0]!.message, /The authored start for Custom Realm \(#150\) at /);
});

test("the Generate panel names the nation on its remove button using the active catalog", () => {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  assert.match(source, /preflightAuthoredStartNotices\(project, catalog\.nations\)/);
  assert.match(source, />Remove \{notice\.nationLabel\} start<\/button>/);
  assert.match(source, /nations=\{catalog\.nations\}/);
});
