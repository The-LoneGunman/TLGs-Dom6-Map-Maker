import assert from "node:assert/strict";
import test from "node:test";
import {
  nationSpecificStartFeatureConflicts,
  setNationSpecificStart,
  type Province,
} from "../src/domain";
import { validateProject } from "../src/dom6";
import { addPlane, calculateFairness, createDefaultProject, generateProject } from "../src/generator";

function populateIndependentFeatures(province: Province): void {
  province.noStart = true;
  province.manySites = true;
  province.teamStart = 2;
  province.throne = "fixed";
  province.fixedThrone = "1361";
  province.sites = [{ id: "specific-site", value: "1", known: true }];
  province.killRandomSites = true;
  province.owner = 5;
  province.poptype = 40;
  province.population = 12_345;
  province.unrest = 45;
  province.fort = 1;
  province.temple = true;
  province.lab = true;
  province.provinceDefense = 25;
  province.defenders = [{
    commander: "34",
    squads: [{ id: "specific-squad", unit: "18", count: 20 }],
  }];
  province.battle = {
    skybox: "test_skybox",
    battleMap: "test_battlemap",
    groundColor: "1 2 3",
    rockColor: "4 5 6",
    fogColor: "7 8 9",
  };
  province.rawDirectives = "#commander 34";
}

test("assigning a nation-specific start clears every independent province feature", () => {
  const project = createDefaultProject("specific-start-clear");
  const plane = project.planes[0]!;
  const province = plane.provinces.find((item) => item.start)!;
  const other = plane.provinces.find((item) => item.id !== province.id)!;
  const preserved = {
    id: province.id,
    name: province.name,
    terrain: province.terrain,
    terrainFlags: province.terrainFlags,
    x: province.x,
    y: province.y,
    start: province.start,
    startType: province.startType,
    warmer: province.warmer,
    colder: province.colder,
    siteBias: [...province.siteBias],
  };
  populateIndependentFeatures(province);
  project.specificStarts.push({ nation: 5, planeId: plane.id, provinceId: other.id });

  assert.equal(setNationSpecificStart(project, plane.id, province.id, 5), true);
  assert.deepEqual(project.specificStarts, [{ nation: 5, planeId: plane.id, provinceId: province.id }]);
  assert.deepEqual(nationSpecificStartFeatureConflicts(province), []);
  assert.equal(province.noStart, false);
  assert.equal(province.manySites, false);
  assert.equal(province.teamStart, undefined);
  assert.equal(province.throne, "avoid");
  assert.equal(province.fixedThrone, undefined);
  assert.deepEqual(province.sites, []);
  assert.equal(province.killRandomSites, false);
  assert.equal(province.owner, undefined);
  assert.equal(province.poptype, undefined);
  assert.equal(province.population, undefined);
  assert.equal(province.unrest, undefined);
  assert.equal(province.fort, undefined);
  assert.equal(province.temple, false);
  assert.equal(province.lab, false);
  assert.equal(province.provinceDefense, undefined);
  assert.deepEqual(province.defenders, []);
  assert.deepEqual(province.battle, {});
  assert.equal(province.rawDirectives, "");
  assert.deepEqual({
    id: province.id,
    name: province.name,
    terrain: province.terrain,
    terrainFlags: province.terrainFlags,
    x: province.x,
    y: province.y,
    start: province.start,
    startType: province.startType,
    warmer: province.warmer,
    colder: province.colder,
    siteBias: province.siteBias,
  }, preserved, "terrain, geography, climate, name, and the generic-start marker remain intact");
  assert.equal(validateProject(project).some((issue) => issue.severity === "error" && issue.message.includes("still contains province setup")), false);
});

test("stale imported nation-specific capital features are export blockers", () => {
  const project = createDefaultProject("specific-start-stale");
  const plane = project.planes[0]!;
  const province = plane.provinces.find((item) => !item.start)!;
  project.specificStarts.push({ nation: 5, planeId: plane.id, provinceId: province.id });
  province.sites = [{ id: "stale-site", value: "1", known: false }];
  province.defenders = [{ commander: "34", squads: [] }];
  province.rawDirectives = "#land 1";

  const issue = validateProject(project).find((entry) => entry.severity === "error" && entry.message.includes("still contains province setup"));
  assert.ok(issue);
  assert.match(issue.message, /placed magic sites/);
  assert.match(issue.message, /guardian groups/);
  assert.match(issue.message, /raw province directives/);
});

test("generated cave nation starts use the same clean-capital lifecycle", () => {
  let project = createDefaultProject("specific-start-generated-cave");
  Object.assign(project.settings, {
    players: 4,
    provincesPerPlayer: 10,
    startDistribution: { land: 2, coastal: 0, water: 0, cave: 2, other: 0 },
    caveStartNations: [15, 59],
  });
  project = addPlane(project, "cave", { generate: false, autoSize: true });
  project = generateProject(project);

  const assignments = project.specificStarts.filter((start) => start.source === "generated-cave");
  assert.equal(assignments.length, 2);
  for (const assignment of assignments) {
    const province = project.planes.find((plane) => plane.id === assignment.planeId)!.provinces.find((item) => item.id === assignment.provinceId)!;
    assert.deepEqual(nationSpecificStartFeatureConflicts(province), []);
    assert.deepEqual(province.defenders, []);
    assert.deepEqual(province.sites, []);
  }
  assert.equal(validateProject(project).some((issue) => issue.severity === "error"), false);
});

test("manual nation-specific starts immediately participate in every geometric fairness pass", () => {
  const project = createDefaultProject("specific-start-fairness");
  const plane = project.planes[0]!;
  const originalStart = plane.provinces.find((province) => province.start)!;
  const incident = plane.edges.find((edge) => edge.a === originalStart.id || edge.b === originalStart.id)!;
  const adjacentId = incident.a === originalStart.id ? incident.b : incident.a;
  const before = calculateFairness(project);

  assert.equal(setNationSpecificStart(project, plane.id, adjacentId, 5), true);
  const after = calculateFairness(project);

  assert.ok(after.startSeparation < before.startSeparation, "the newly forced adjacent capital must lower spacing fairness");
  assert.ok(after.notes.some((note) => note.includes("hard three-move")));
  assert.equal(after.startAllocation, before.startAllocation, "a forced nation annotation must not rewrite the generated category allocation");
});
