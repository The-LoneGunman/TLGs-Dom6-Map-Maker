import assert from "node:assert/strict";
import test from "node:test";
import { isPlayerNationId, updateCaveStartNations } from "../src/MapMakerApp";
import { compileMapText, validateProject } from "../src/dom6";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import type { MapProject } from "../src/domain";

function caveProject(nations: number[] = [15, 59], seed = "cave-lifecycle"): MapProject {
  let project = createDefaultProject(seed);
  Object.assign(project.settings, {
    players: 4,
    provincesPerPlayer: 10,
    startDistribution: { land: 2, coastal: 0, water: 0, cave: 2, other: 0 },
    caveStartNations: nations,
  });
  project = addPlane(project, "cave", { generate: false, autoSize: true });
  return generateProject(project);
}

test("generated cave assignments follow clear and replacement selection lifecycles", () => {
  let project = caveProject();
  assert.deepEqual(project.specificStarts.map((start) => [start.nation, start.source]), [
    [15, "generated-cave"],
    [59, "generated-cave"],
  ]);

  updateCaveStartNations(project, []);
  assert.deepEqual(project.specificStarts, [], "clearing the UI selection immediately removes generated assignments");
  assert.doesNotMatch(compileMapText(project, 0), /#specstart (?:15|59)\b/);
  project = generateProject(project);
  assert.deepEqual(project.specificStarts, [], "cleared assignments do not return on regeneration");

  updateCaveStartNations(project, [102]);
  assert.deepEqual(project.specificStarts, []);
  assert.ok(validateProject(project).some((issue) => issue.severity === "error"
    && issue.message.includes("Configured cave-start nation 102")
    && issue.message.includes("Choose Generate")));

  project = generateProject(project);
  assert.deepEqual(project.specificStarts.map((start) => ({ nation: start.nation, source: start.source })), [
    { nation: 102, source: "generated-cave" },
  ]);
  assert.match(compileMapText(project, 0), /#specstart 102\b/);
  assert.doesNotMatch(compileMapText(project, 0), /#specstart (?:15|59)\b/);
  assert.equal(validateProject(project).some((issue) => issue.message.includes("Configured cave-start nation 102") && issue.severity === "error"), false);
});

test("manual cave-start conflicts survive generation and are exposed", () => {
  let project = caveProject();
  const surface = project.planes[0]!;
  const manualProvince = surface.provinces.find((province) => province.start && province.startType === "land")!;
  project.specificStarts = project.specificStarts.filter((start) => start.nation !== 15);
  project.specificStarts.push({ nation: 15, planeId: surface.id, provinceId: manualProvince.id });

  project = generateProject(project);
  const manual = project.specificStarts.find((start) => start.nation === 15)!;
  assert.deepEqual(manual, { nation: 15, planeId: surface.id, provinceId: manualProvince.id });
  assert.equal(project.specificStarts.some((start) => start.nation === 15 && start.source === "generated-cave"), false);
  assert.ok(project.specificStarts.some((start) => start.nation === 59 && start.source === "generated-cave"));
  assert.ok(validateProject(project).some((issue) => issue.severity === "error"
    && issue.message.includes("Manual #specstart for configured cave-start nation 15 is preserved")
    && issue.message.includes("not an actual generated cave start")));

  updateCaveStartNations(project, []);
  assert.deepEqual(project.specificStarts, [manual], "clearing generated selections preserves deliberate manual #specstart");
  assert.match(compileMapText(project, 0), /#specstart 15\b/);
});

test("all player-nation selectors and directives reserve IDs zero through four", () => {
  assert.equal(isPlayerNationId(1), false);
  assert.equal(isPlayerNationId(3), false);
  assert.equal(isPlayerNationId(5), true);

  const project = createDefaultProject("reserved-player-ids");
  project.allowedPlayers = [1, 3, 5];
  project.computerPlayers = [
    { nation: 1, difficulty: 3 },
    { nation: 3, difficulty: 3 },
    { nation: 5, difficulty: 3 },
  ];
  project.cannotWin = [1, 3, 5];
  project.specificStarts = project.planes[0]!.provinces.slice(0, 3).map((province, index) => ({
    nation: [1, 3, 5][index]!,
    planeId: project.planes[0]!.id,
    provinceId: province.id,
  }));

  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("Allowed-player and cannot-win entries require player nation IDs of 5 or greater")));
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("Forced AI entries require a player nation ID of 5 or greater")));
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("nation-specific start requires a player nation ID of 5 or greater")));

  const text = compileMapText(project, 0);
  for (const reserved of [1, 3]) {
    assert.doesNotMatch(text, new RegExp(`#allowedplayer ${reserved}\\b`));
    assert.doesNotMatch(text, new RegExp(`#computerplayer ${reserved}\\b`));
    assert.doesNotMatch(text, new RegExp(`#cannotwin ${reserved}\\b`));
    assert.doesNotMatch(text, new RegExp(`#specstart ${reserved}\\b`));
  }
  assert.match(text, /#allowedplayer 5\b/);
  assert.match(text, /#computerplayer 5 3\b/);
  assert.match(text, /#cannotwin 5\b/);
  assert.match(text, /#specstart 5\b/);
});
