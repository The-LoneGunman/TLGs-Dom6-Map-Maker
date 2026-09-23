import assert from "node:assert/strict";
import test from "node:test";
import { cloneProject, isWaterProvince, type MapProject, type Plane } from "../src/domain";
import { validateProject } from "../src/dom6";
import { adjacencyFor, classifyCurrentStart, createDefaultProject, generateProject, shortestDistances } from "../src/generator";
import { planIslandStarts } from "../src/islandStartPlanning";
import { parseProject, serializeProject } from "../src/projectFile";

function corpusIsland(index: number): MapProject {
  const project = createDefaultProject("evaluation-template", { generate: false });
  project.seed = `atlas-evaluation-v1:fixed:${index}`;
  Object.assign(project.settings, {
    players: index % 3 === 0 ? 4 : 6, provincesPerPlayer: 16, throneCount: 4,
    waterPercent: 52, oceanLayout: "island_chains",
    economyBalance: index % 3 === 0 ? "none" : index % 3 === 1 ? "soft" : "hard",
    overlandTopology: index % 3 === 0 ? "open" : index % 3 === 1 ? "competitive" : "strategic",
  });
  project.settings.startDistribution = { land: project.settings.players - 2, coastal: 1, water: 1, cave: 0, other: 0 };
  project.planes[0]!.wrapX = index % 4 === 0;
  project.planes[0]!.wrapY = index % 11 === 0;
  if (Math.floor(index / 8) % 2 === 1) project.planes[0]!.generationOverrides = {
    terrainWeights: { forest: 3, waste: 2 }, guardianCoveragePercent: 30, manySitesPercent: 45,
    roadPercent: 20, riverPercent: 5, passPercent: 5,
  };
  return project;
}

function components(plane: Plane, water: boolean): string[][] {
  const remaining = new Set(plane.provinces.filter(province => isWaterProvince(province) === water).map(province => province.id));
  const adjacency = adjacencyFor(plane), result: string[][] = [];
  while (remaining.size) {
    const queue = [remaining.values().next().value!]; remaining.delete(queue[0]!);
    for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]!) ?? []) {
      if (remaining.delete(next)) queue.push(next);
    }
    result.push(queue);
  }
  return result;
}

function assertSafeIslands(project: MapProject, expectedWater: number) {
  const plane = project.planes[0]!, starts = plane.provinces.filter(province => province.start);
  assert.equal(starts.length, project.settings.players);
  const actual = { land: 0, coastal: 0, water: 0, cave: 0, other: 0 };
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  for (const start of starts) {
    actual[classifyCurrentStart(plane, start, adjacency)]++;
    assert.ok((adjacency.get(start.id)?.length ?? 0) >= Math.min(4, project.settings.startDegreeTarget ?? 4));
    const distance = shortestDistances(adjacency, start.id);
    for (const other of starts) if (other.id !== start.id) assert.ok((distance.get(other.id) ?? 0) >= 3);
    assert.equal(start.defenders.length, 0);
    for (const neighbour of adjacency.get(start.id) ?? []) {
      const province = plane.provinces.find(item => item.id === neighbour)!;
      assert.equal(province.defenders.length, 0);
      assert.ok(province.throne !== "preferred" && province.throne !== "fixed");
    }
  }
  assert.deepEqual(actual, project.settings.startDistribution);
  assert.equal(plane.provinces.filter(isWaterProvince).length, expectedWater);
  assert.equal(components(plane, true).length, 1, "all sea provinces must form one connected ocean");
  assert.ok(components(plane, false).length >= 3, "start repair must retain separated islands");
  assert.deepEqual(validateProject(project).filter(issue => issue.severity === "error"), []);
}

for (const index of [2, 10, 18, 26, 34, 42, 50, 58, 66, 74, 82, 90, 98, 106, 114, 122]) {
  test(`island corpus ${index} fits inland, coastal and water capitals without changing its quota`, () => {
    const input = corpusIsland(index), before = serializeProject(input);
    const generated = generateProject(input);
    assertSafeIslands(generated, Math.round(input.settings.players * 16 * .52));
    assert.equal(serializeProject(input), before, "the input atlas stays untouched");
    assert.equal(generated.planes[0]!.provinces.length, input.settings.players * 16);
  });
}

test("island repairs are deterministic after JSON reopening and retain manual names", () => {
  const input = corpusIsland(2), initial = generateProject(input);
  initial.planes[0]!.provinces[0]!.name = "Authored island";
  initial.planes[0]!.provinces[0]!.nameSource = "authored";
  const reopened = parseProject(serializeProject(initial));
  const first = generateProject(initial), second = generateProject(reopened);
  assert.deepEqual({ ...first, updatedAt: undefined }, { ...second, updatedAt: undefined });
  assert.equal(first.planes[0]!.provinces[0]!.name, "Authored island");
  assertSafeIslands(second, 50);
});

test("a feasible island layout is kept byte-for-byte by the pure planning step", () => {
  const project = generateProject(corpusIsland(34)), plane = cloneProject(project).planes[0]!;
  const before = JSON.stringify(plane), water = new Set(plane.provinces.filter(isWaterProvince).map(province => province.id));
  const plan = planIslandStarts(plane, adjacencyFor(plane), { land: 4, coastal: 1, water: 1 }, {
    minimumDegree: 4, preferredSeparation: 4, rank: key => key.length,
  });
  assert.ok(plan);
  assert.deepEqual(plan.water, water);
  assert.equal(JSON.stringify(plane), before);
});

test("impossible island start budgets warn and remain export-blocked instead of relaxing safety", () => {
  const input = corpusIsland(2);
  input.settings.players = 6; input.settings.provincesPerPlayer = 8; input.settings.waterPercent = 60;
  input.settings.startDistribution = { land: 6, coastal: 0, water: 0, cave: 0, other: 0 };
  const generated = generateProject(input);
  assert.equal(generated.planes[0]!.provinces.length, 48);
  assert.equal(generated.planes[0]!.provinces.filter(isWaterProvince).length, 29);
  assert.ok(generated.generationWarnings?.some(message => message.includes("island geography could not fit")));
  assert.ok(validateProject(generated).some(issue => issue.severity === "error"));
});
