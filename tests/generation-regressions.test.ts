import assert from "node:assert/strict";
import test from "node:test";

import { validateProject } from "../src/dom6";
import { cloneProject, isBlockedProvince, isWaterProvince, type MapProject, type PlaneKind } from "../src/domain";
import { parseProject } from "../src/export";
import {
  addPlane,
  adjacencyFor,
  calculateFairness,
  classifyCurrentStart,
  createDefaultProject,
  generateProject,
  preflightStartPlan,
  shortestDistances,
} from "../src/generator";
import { auditPlaneTopology, resolvePlaneOwnershipMode } from "../src/geometry";

function stableGeneration(project: MapProject) {
  return {
    settings: project.settings,
    planes: project.planes,
    gates: project.gates,
    specificStarts: project.specificStarts,
    generationWarnings: project.generationWarnings,
  };
}

function assertNoErrors(project: MapProject) {
  assert.deepEqual(validateProject(project).filter((issue) => issue.severity === "error"), []);
}

test("auto-sized bonus starts use a frozen plan independent of repeated and historical generation", { timeout: 120_000 }, () => {
  const cases: Array<{ kinds: PlaneKind[]; players: number; type: "cave" | "other"; expectedTargets: number[] }> = [
    { kinds: ["air", "dream"], players: 4, type: "other", expectedTargets: [40, 40] },
    { kinds: ["underworld", "hell"], players: 6, type: "cave", expectedTargets: [60, 60] },
    { kinds: ["air", "dream", "elemental"], players: 8, type: "other", expectedTargets: [60, 60, 40] },
  ];
  for (const { kinds, players, type, expectedTargets } of cases) {
    let project = createDefaultProject(`september-bonus-plan-${kinds.join("-")}`);
    Object.assign(project.settings, {
      players,
      provincesPerPlayer: 12,
      specialPlaneSizePercent: 30,
      startDegreeTarget: 4,
      startDistribution: { land: 0, coastal: 0, water: 0, cave: 0, other: 0, [type]: players },
    });
    project.planes[0]!.noGeneratedStarts = true;
    for (const kind of kinds) project = addPlane(project, kind, { generate: false, autoSize: true });
    assert.deepEqual(preflightStartPlan(project), []);

    const first = generateProject(project);
    const repeated = generateProject(first);
    const stale = cloneProject(project);
    stale.planes.slice(1).forEach((plane, index) => {
      plane.provinceTarget = index % 2 === 0 ? 400 : 8;
      plane.provinces = structuredClone(project.planes[0]!.provinces.slice(0, index % 2 === 0 ? 80 : 6));
      plane.edges = [];
    });
    const afterStaleGeneration = generateProject(stale);

    assert.deepEqual(first.planes.slice(1).map((plane) => plane.provinceTarget), expectedTargets);
    assert.deepEqual(first.planes.slice(1).map((plane) => plane.provinces.filter((province) => province.start).length),
      expectedTargets.map((target) => target / 20));
    assert.equal(first.planes[0]!.provinces.some((province) => province.start), false);
    assert.deepEqual(stableGeneration(repeated), stableGeneration(first), "unchanged Generate must be repeatable");
    assert.deepEqual(stableGeneration(afterStaleGeneration), stableGeneration(first), "old generated capacities are not settings");
    assert.equal(calculateFairness(first).startAllocation, 100);
    assertNoErrors(first);
    for (const plane of first.planes) {
      const starts = plane.provinces.filter((province) => province.start);
      const adjacency = adjacencyFor(plane, { traversableOnly: true });
      for (let left = 0; left < starts.length; left += 1) {
        const distances = shortestDistances(adjacency, starts[left]!.id);
        for (let right = left + 1; right < starts.length; right += 1) {
          assert.ok((distances.get(starts[right]!.id) ?? 0) >= 3);
        }
      }
    }
  }
});

test("terrain edits cannot hide a newly coastal capital behind a cached Land label", () => {
  const project = createDefaultProject("sept-stale-start-label");
  const plane = project.planes[0]!;
  const capital = plane.provinces.find((province) => province.start && province.startType === "land")!;
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const neighbour = plane.provinces.find((province) => province.id === adjacency.get(capital.id)![0])!;
  neighbour.terrain = "sea";

  assert.equal(capital.startType, "land", "this reproduction deliberately leaves the cached label unchanged");
  assert.equal(classifyCurrentStart(plane, capital), "coastal");
  const errors = validateProject(project).filter((issue) => issue.severity === "error");
  assert.ok(errors.some((issue) => issue.message === "Requested 6 land starts, but generated 5."));
  assert.ok(errors.some((issue) => issue.message === "Requested 0 coastal starts, but generated 1."));
  assert.equal(calculateFairness(project).startAllocation, 83);
});

test("Cave terrain on a special Custom capital has the same current category in validation and fairness", () => {
  const source = createDefaultProject("sept-special-custom-cave");
  source.planes[0]!.kind = "custom";
  source.planes[0]!.variant = "fungal";
  source.settings.startDistribution = { land: 0, coastal: 0, water: 0, cave: 0, other: 6 };
  const project = generateProject(source);
  assertNoErrors(project);
  const plane = project.planes[0]!;
  const capital = plane.provinces.find((province) => province.start)!;
  capital.terrain = "cave";

  assert.equal(capital.startType, "other", "this reproduction deliberately leaves the cached label unchanged");
  assert.equal(classifyCurrentStart(plane, capital), "cave");
  const errors = validateProject(project).filter((issue) => issue.severity === "error");
  assert.ok(errors.some((issue) => issue.message === "Requested 0 cave starts, but generated 1."));
  assert.ok(errors.some((issue) => issue.message === "Requested 6 other starts, but generated 5."));
  assert.equal(calculateFairness(project).startAllocation, 83);
});

test("generating an explicit solid Underworld warns and normalizes safely without mutating the imported input", () => {
  let source = createDefaultProject("sept-solid-underworld");
  Object.assign(source.settings, {
    players: 4,
    provincesPerPlayer: 12,
    throneCount: 6,
    startDistribution: { land: 0, coastal: 0, water: 0, cave: 4, other: 0 },
  });
  source.planes[0]!.noGeneratedStarts = true;
  source = addPlane(source, "underworld", { generate: false, autoSize: false, provinceTarget: 64 });
  source.planes[1]!.ownershipMode = "solid";
  const imported = parseProject(JSON.stringify(source));
  const before = structuredClone(imported);
  assert.equal(resolvePlaneOwnershipMode(imported.planes[1]!), "solid", "import alone must preserve authored ownership");
  assert.deepEqual(preflightStartPlan(imported), []);

  const generated = generateProject(imported);
  const underworld = generated.planes[1]!;
  assert.deepEqual(imported, before, "normalization belongs only to the generated copy");
  assert.equal(resolvePlaneOwnershipMode(underworld), "sparse");
  assert.equal(underworld.provinceTarget, 64);
  assert.equal(underworld.provinces.length, 64);
  assert.equal(underworld.provinces.filter((province) => province.start && province.startType === "cave").length, 4);
  assert.ok(generated.generationWarnings?.some((warning) => warning.includes(underworld.name)
    && warning.includes("chamber-and-corridor") && warning.includes("River Styx")));
  assert.deepEqual(auditPlaneTopology(underworld), { missing: [], extra: [] });
  const active = underworld.provinces.filter((province) => !isBlockedProvince(province));
  const movement = adjacencyFor(underworld, { traversableOnly: true });
  assert.equal(shortestDistances(movement, active[0]!.id).size, active.length);
  const water = active.filter(isWaterProvince);
  assert.ok(water.length > 0, "normalization must retain the Styx rather than omit it");
  const waterIds = new Set(water.map((province) => province.id));
  const waterAdjacency = new Map(water.map((province) => [province.id,
    (movement.get(province.id) ?? []).filter((id) => waterIds.has(id))]));
  assert.equal(shortestDistances(waterAdjacency, water[0]!.id).size, water.length, "the Styx remains connected");
  assertNoErrors(generated);
  const repeated = generateProject(generated);
  assert.deepEqual(repeated.planes, generated.planes);
  assert.deepEqual(repeated.gates, generated.gates);
  assert.equal(repeated.generationWarnings?.some((warning) => warning.includes("now uses chamber-and-corridor")), false,
    "the normalization warning should not recur once the stored mode is sparse");
});
