import assert from "node:assert/strict";
import test from "node:test";
import { addPlane, adjacencyFor, createDefaultProject } from "../src/generator";
import { compileMapText, validateProject } from "../src/dom6";
import { parseProject } from "../src/export";

test("every plane map starts with the manual-required dom2title command", () => {
  const project = addPlane(createDefaultProject("manual-plane-title"), "underworld");
  for (let index = 0; index < project.planes.length; index += 1) {
    const firstCommand = compileMapText(project, index)
      .split(/\r?\n/)
      .find((line) => line.startsWith("#"));
    assert.equal(firstCommand, `#dom2title ${project.name}`);
  }
});

test("land never clears generic, team, or nation-specific starts", () => {
  const project = createDefaultProject("manual-protected-starts");
  const plane = project.planes[0]!;
  const available = plane.provinces.filter((province) => !province.start).slice(0, 2);
  const [teamStart, specificStart] = available;
  assert.ok(teamStart && specificStart);

  teamStart.teamStart = 0;
  teamStart.defenders.push({ commander: "1", squads: [{ id: "team-squad", unit: "2", count: 5 }] });
  project.specificStarts.push({ nation: 5, planeId: plane.id, provinceId: specificStart.id });
  specificStart.defenders.push({ commander: "1", squads: [{ id: "specific-squad", unit: "2", count: 5 }] });

  const text = compileMapText(project, 0);
  assert.match(text, new RegExp(`#setland ${teamStart.index}\\r?\\n`));
  assert.match(text, new RegExp(`#setland ${specificStart.index}\\r?\\n`));
  assert.doesNotMatch(text, new RegExp(`#land ${teamStart.index}\\r?\\n`));
  assert.doesNotMatch(text, new RegExp(`#land ${specificStart.index}\\r?\\n`));
});

test("legacy normalized battle colors compile to manual integer RGB channels", () => {
  const project = createDefaultProject("manual-battle-rgb");
  const province = project.planes[0]!.provinces[0]!;
  province.battle.groundColor = "0.4 0.5 1";
  province.battle.rockColor = "12 34 56";
  const text = compileMapText(project, 0);
  assert.match(text, /#groundcol 102 128 255/);
  assert.match(text, /#rockcol 12 34 56/);
});

test("per-plane switches, colors, and commander clear-magic compile in command order", () => {
  const project = addPlane(createDefaultProject("manual-plane-overrides"), "cave");
  project.mapNoHide = false;
  project.noDeepCaves = true;
  const plane = project.planes[1]!;
  plane.mapNoHide = true;
  plane.noDeepCaves = false;
  plane.mapTextColor = "0.1 0.2 0.3 1";
  plane.mapDominionColor = "1 2 3 4";
  const province = plane.provinces.find((item) => !item.start)!;
  province.defenders = [{ commander: "2468", clearMagic: true, magic: { nature: 2 }, squads: [] }];
  const text = compileMapText(project, 1);
  assert.match(text, /#mapnohide/);
  assert.doesNotMatch(text, /#nodeepcaves/);
  assert.match(text, /#maptextcol 0\.1 0\.2 0\.3 1/);
  assert.match(text, /#mapdomcol 1 2 3 4/);
  assert.match(text, /#commander 2468\r?\n#clearmagic\r?\n#mag_nature 2/);
  assert.equal(validateProject(project).some((issue) => issue.severity === "error"), false);
});

test("team starts are not confused with the editor's 0-7 keyboard shortcuts", () => {
  const project = createDefaultProject("manual-team-start");
  const province = project.planes[0]!.provinces.find((item) => !item.start)!;
  province.teamStart = 12;
  assert.match(compileMapText(project, 0), new RegExp(`#teamstart ${province.index} 12`));
  assert.equal(validateProject(project).some((issue) => issue.message.includes("team-start group")), false);
});

test("province defence is never emitted for independent owner IDs", () => {
  const project = createDefaultProject("manual-independent-defence");
  const province = project.planes[0]!.provinces.find((item) => !item.start)!;
  province.owner = 2;
  province.provinceDefense = 50;
  assert.doesNotMatch(compileMapText(project, 0), /#defence 50/);
  assert.ok(validateProject(project).some((issue) => issue.message.includes("#defence only works")));
});

test("custom D6M dimensions cannot exceed the supported raster envelope", () => {
  const project = createDefaultProject("manual-raster-envelope");
  project.planes[0]!.width = 5000;
  project.planes[0]!.height = 5000;
  assert.ok(validateProject(project).some((issue) => issue.severity === "error" && issue.message.includes("8.29-megapixel")));
});

test("validation exposes gates and thrones placed in a start exclusion zone", () => {
  const project = createDefaultProject("manual-gate-exclusion");
  const plane = project.planes[0]!;
  const start = plane.provinces.find((province) => province.start)!;
  const adjacentId = adjacencyFor(plane).get(start.id)?.[0];
  const adjacent = plane.provinces.find((province) => province.id === adjacentId);
  assert.ok(adjacent);
  project.gates = [{
    id: "gate-near-start",
    gateNumber: 1,
    endpoints: [
      { planeId: plane.id, provinceId: adjacent!.id },
      { planeId: plane.id, provinceId: plane.provinces.find((province) => province.id !== adjacent!.id && province.id !== start.id)!.id },
    ],
  }];
  adjacent!.throne = "preferred";
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.message.includes("Gate 1") && issue.message.includes("adjacent to start province")));
  assert.ok(issues.some((issue) => issue.message.includes("throne location adjacent to start province")));
});

test("project import migrates legacy exclusive freshwater safely", () => {
  const project = createDefaultProject("manual-freshwater-import");
  const province = project.planes[0]!.provinces.find((item) => !item.start)!;
  province.terrain = "freshwater";
  province.startType = "water";
  const parsed = parseProject(JSON.stringify(project));
  const migrated = parsed.planes[0]!.provinces.find((item) => item.id === province.id)!;
  assert.equal(migrated.terrain, "plains");
  assert.equal(migrated.freshwater, true);
  assert.equal(migrated.startType, "land");
});
