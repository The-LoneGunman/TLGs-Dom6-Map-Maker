import assert from "node:assert/strict";
import test from "node:test";
import { compileMapText, validateProject } from "../src/dom6";
import type { EconomyBalanceMode, Edge, MapProject, OverlandTopologyMode, Plane } from "../src/domain";
import {
  addPlane,
  adjacencyFor,
  createDefaultProject,
  generatePlane,
  generateProject,
  normalizeEconomyBalanceMode,
  normalizeOverlandTopologyMode,
  shortestDistances,
} from "../src/generator";
import { resolvePlaneOwnershipMode } from "../src/geometry";
import { effectiveProvinceTerrainFlags, isBlockedProvince } from "../src/domain";

const SEEDS = ["policy-profile-a", "policy-profile-b", "policy-profile-c"];

function configuredProject(
  seed: string,
  economyBalance: EconomyBalanceMode,
  overlandTopology: OverlandTopologyMode,
): MapProject {
  const project = createDefaultProject(seed);
  Object.assign(project.settings, {
    players: 4,
    provincesPerPlayer: 12,
    waterPercent: 20,
    biomeCohesion: 58,
    throneCount: 6,
    startDistribution: { land: 2, coastal: 1, water: 1, cave: 0, other: 0 },
    economyBalance,
    overlandTopology,
  });
  return project;
}

function stableGeneration(project: MapProject): string {
  return JSON.stringify({
    settings: project.settings,
    planes: project.planes,
    gates: project.gates,
    specificStarts: project.specificStarts,
  });
}

function isStrategicBorder(edge: Edge): boolean {
  return edge.kind === "mountain_border"
    || edge.kind === "mountain_pass"
    || edge.kind === "river"
    || edge.kind === "impassable"
    || edge.kind === "custom" && ((edge.special ?? 0) & 0b111) !== 0;
}

function connected(plane: Plane): boolean {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  if (!active.length) return true;
  const distances = shortestDistances(adjacencyFor(plane, { traversableOnly: true }), active[0]!.id);
  return active.every((province) => distances.has(province.id));
}

function endpointSignature(plane: Plane): string {
  return plane.edges.map((edge) => [edge.a, edge.b].sort().join(":" )).sort().join("|");
}

function terrainSignature(plane: Plane): string {
  return plane.provinces.map((province) => `${province.id}:${province.terrain}:${province.x}:${province.y}`).join("|");
}

function startEconomies(plane: Plane): number[] {
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  return plane.provinces.filter((province) => province.start).map((start) => {
    const distances = shortestDistances(adjacency, start.id);
    return plane.provinces
      .filter((province) => (distances.get(province.id) ?? 99) <= 2)
      .reduce((sum, province) => sum
        + (province.population ?? 0) / 1000
        + (effectiveProvinceTerrainFlags(province).has("farm") ? 2 : 0), 0);
  });
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function populationDelta(baseline: Plane, candidate: Plane): number {
  const byId = new Map(baseline.provinces.map((province) => [province.id, province.population]));
  return candidate.provinces.reduce((sum, province) =>
    sum + Math.abs((province.population ?? 0) - (byId.get(province.id) ?? 0)), 0);
}

function assertExportReady(project: MapProject) {
  assert.deepEqual(validateProject(project).filter((issue) => issue.severity === "error"), []);
  for (let index = 0; index < project.planes.length; index += 1) {
    const text = compileMapText(project, index);
    assert.doesNotMatch(text, /\b(?:NaN|undefined|Infinity)\b/);
    assert.match(text, /#neighbour\s+\d+\s+\d+/);
  }
}

test("generation policy defaults and invalid values normalize to current hard/competitive behavior", () => {
  const defaults = createDefaultProject("policy-defaults");
  assert.equal(defaults.settings.economyBalance, "hard");
  assert.equal(defaults.settings.overlandTopology, "competitive");
  assert.equal(normalizeEconomyBalanceMode(undefined), "hard");
  assert.equal(normalizeEconomyBalanceMode("invalid" as EconomyBalanceMode), "hard");
  assert.equal(normalizeOverlandTopologyMode(undefined), "competitive");
  assert.equal(normalizeOverlandTopologyMode("invalid" as OverlandTopologyMode), "competitive");

  defaults.settings.economyBalance = "invalid" as EconomyBalanceMode;
  defaults.settings.overlandTopology = "invalid" as OverlandTopologyMode;
  const normalized = generateProject(defaults);
  assert.equal(normalized.settings.economyBalance, "hard");
  assert.equal(normalized.settings.overlandTopology, "competitive");
});

test("economy modes are deterministic and order none < soft < hard correction strength", () => {
  for (const seed of SEEDS) {
    const none = generateProject(configuredProject(seed, "none", "competitive"));
    const soft = generateProject(configuredProject(seed, "soft", "competitive"));
    const hard = generateProject(configuredProject(seed, "hard", "competitive"));
    const softAgain = generateProject(configuredProject(seed, "soft", "competitive"));
    assert.equal(stableGeneration(soft), stableGeneration(softAgain), `${seed}: soft generation must be deterministic`);

    const nonePlane = none.planes[0]!;
    const softPlane = soft.planes[0]!;
    const hardPlane = hard.planes[0]!;
    assert.equal(endpointSignature(nonePlane), endpointSignature(softPlane));
    assert.equal(endpointSignature(nonePlane), endpointSignature(hardPlane));
    const softDelta = populationDelta(nonePlane, softPlane);
    const hardDelta = populationDelta(nonePlane, hardPlane);
    assert.ok(softDelta > 0, `${seed}: soft mode should make a real correction`);
    assert.ok(hardDelta > softDelta, `${seed}: hard correction ${hardDelta} should exceed soft ${softDelta}`);

    const nonePop = new Map(nonePlane.provinces.map((province) => [province.id, province.population ?? 0]));
    const hardPop = new Map(hardPlane.provinces.map((province) => [province.id, province.population ?? 0]));
    for (const province of softPlane.provinces) {
      const raw = nonePop.get(province.id)!;
      const full = hardPop.get(province.id)!;
      const light = province.population ?? 0;
      assert.ok(Math.abs(light - raw) <= Math.abs(full - raw) + 10, `${seed}:${province.index} bounded correction`);
      assert.ok((light - raw) * (full - raw) >= 0, `${seed}:${province.index} correction direction`);
    }
    assert.ok(spread(startEconomies(hardPlane)) <= spread(startEconomies(softPlane)) + 0.02, `${seed}: hard economy spread`);
    assert.ok(spread(startEconomies(softPlane)) <= spread(startEconomies(nonePlane)) + 0.02, `${seed}: soft economy spread`);
    assertExportReady(none);
    assertExportReady(soft);
    assertExportReady(hard);
  }
});

test("overland topology modes retain geometry but produce open, competitive, and strategic profiles", () => {
  for (const seed of SEEDS) {
    const open = generateProject(configuredProject(seed, "hard", "open"));
    const competitive = generateProject(configuredProject(seed, "hard", "competitive"));
    const strategic = generateProject(configuredProject(seed, "hard", "strategic"));
    const strategicAgain = generateProject(configuredProject(seed, "hard", "strategic"));
    assert.equal(stableGeneration(strategic), stableGeneration(strategicAgain), `${seed}: strategic generation must be deterministic`);

    const openPlane = open.planes[0]!;
    const competitivePlane = competitive.planes[0]!;
    const strategicPlane = strategic.planes[0]!;
    assert.equal(endpointSignature(openPlane), endpointSignature(competitivePlane), `${seed}: open keeps visible borders`);
    assert.equal(endpointSignature(openPlane), endpointSignature(strategicPlane), `${seed}: strategic keeps visible borders`);
    assert.equal(terrainSignature(openPlane), terrainSignature(competitivePlane), `${seed}: terrain unchanged`);
    assert.equal(terrainSignature(openPlane), terrainSignature(strategicPlane), `${seed}: terrain unchanged`);

    const openCount = openPlane.edges.filter(isStrategicBorder).length;
    const competitiveCount = competitivePlane.edges.filter(isStrategicBorder).length;
    const strategicCount = strategicPlane.edges.filter(isStrategicBorder).length;
    assert.equal(openCount, 0, `${seed}: open removes generated movement blockers`);
    assert.ok(competitiveCount > openCount, `${seed}: competitive retains terrain borders`);
    assert.ok(strategicCount > competitiveCount, `${seed}: strategic adds regional blockers`);
    assert.ok(strategicPlane.edges.filter((edge) => edge.kind === "impassable").length
      > competitivePlane.edges.filter((edge) => edge.kind === "impassable").length, `${seed}: strategic hard chokepoints`);
    for (const plane of [openPlane, competitivePlane, strategicPlane]) {
      assert.ok(connected(plane), `${seed}:${plane.id} remains connected`);
      const starts = new Set(plane.provinces.filter((province) => province.start).map((province) => province.id));
      assert.equal(plane.edges.some((edge) => (starts.has(edge.a) || starts.has(edge.b)) && isStrategicBorder(edge)), false, `${seed}: capital border safety`);
    }
    assertExportReady(open);
    assertExportReady(competitive);
    assertExportReady(strategic);
  }
});

test("overland topology policies apply to solid surface-like Custom but not sparse or cave planes", () => {
  const base = createDefaultProject("policy-custom");
  Object.assign(base.settings, {
    players: 4,
    provincesPerPlayer: 12,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 0, other: 0 },
  });
  const custom = { ...base.planes[0]!, kind: "custom" as const, variant: "temperate" as const, ownershipMode: "solid" as const, provinceTarget: 48 };
  const customOpen = generatePlane(custom, { ...base.settings, overlandTopology: "open" }, "policy-custom-stage", 0);
  const customStrategic = generatePlane(custom, { ...base.settings, overlandTopology: "strategic" }, "policy-custom-stage", 0);
  assert.equal(resolvePlaneOwnershipMode(customStrategic), "solid");
  assert.equal(customOpen.edges.filter(isStrategicBorder).length, 0);
  assert.ok(customStrategic.edges.filter(isStrategicBorder).length > 0);
  assert.ok(connected(customStrategic));

  const cave = { ...custom, kind: "cave" as const, variant: "fungal" as const, ownershipMode: "sparse" as const };
  const caveOpen = generatePlane(cave, { ...base.settings, overlandTopology: "open" }, "policy-cave-stage", 0);
  const caveStrategic = generatePlane(cave, { ...base.settings, overlandTopology: "strategic" }, "policy-cave-stage", 0);
  assert.equal(stableGeneration({ ...base, planes: [caveOpen] }), stableGeneration({ ...base, planes: [caveStrategic] }));
});

test("start-heavy special planes retain neutral two-ring capacity for themed guardians", () => {
  let project = createDefaultProject("audit-start-3-8");
  Object.assign(project.settings, {
    players: 6,
    provincesPerPlayer: 16,
    startDistribution: { land: 0, coastal: 0, water: 0, cave: 3, other: 3 },
    startDegreeTarget: 8,
    throneCount: 8,
    waterPercent: 30,
  });
  project = addPlane(project, "cave", { generate: false, autoSize: true });
  project = addPlane(project, "air", { generate: false, autoSize: true });
  const generated = generateProject(project);
  const air = generated.planes.find((plane) => plane.kind === "air")!;
  const adjacency = adjacencyFor(air, { traversableOnly: true });
  const starts = air.provinces.filter((province) => province.start);
  const safe = air.provinces.filter((province) => !province.start && starts.every((start) =>
    (shortestDistances(adjacency, start.id).get(province.id) ?? 99) >= 3));
  const guarded = safe.filter((province) => province.defenders.length > 0);

  assert.equal(starts.length, 3);
  assert.ok(air.provinces.length >= 84, "degree-eight start capacity scales the auto-sized special plane");
  assert.ok(safe.length >= 12, `expected material neutral reserve, received ${safe.length}`);
  assert.ok(guarded.length >= 3, `expected material themed guardian presence, received ${guarded.length}`);
  assert.equal(generated.generationWarnings?.some((warning) => warning.includes(air.name)), false);
  assertExportReady(generated);

  let constrained = createDefaultProject("guardian-capacity-warning");
  Object.assign(constrained.settings, {
    players: 3,
    provincesPerPlayer: 8,
    startDistribution: { land: 0, coastal: 0, water: 0, cave: 0, other: 3 },
    startDegreeTarget: 8,
  });
  constrained = addPlane(constrained, "air", { generate: false, autoSize: false, provinceTarget: 24 });
  const constrainedResult = generateProject(constrained);
  assert.ok(constrainedResult.generationWarnings?.some((warning) =>
    warning.includes("protected two-rings") && warning.includes("Increase the bonus-plane size")));
});
