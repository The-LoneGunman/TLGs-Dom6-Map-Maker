import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setNationSpecificStart, type MapProject, type Plane, type Province } from "../src/domain";
import { validateProject } from "../src/dom6";
import {
  addPlane,
  adjacencyFor,
  createDefaultProject,
  generateProject,
  globalMovementAdjacency,
  preflightAuthoredStartNotices,
  previewProvinceBudget,
  shortestDistances,
} from "../src/generator";
import { GenerationPlanSummary } from "../src/WorkbenchPanels";

const SPACING_ERROR = /distinct multiplayer starts require at least 3/;

/** Movement distance from an authored start to the nearest generated capital, as export validation measures it. */
function nearestGeneratedStart(project: MapProject, planeId: string, provinceId: string): number {
  const distances = shortestDistances(globalMovementAdjacency(project), `${planeId}:${provinceId}`);
  let nearest = Infinity;
  for (const plane of project.planes) for (const province of plane.provinces) {
    if (!province.start || (plane.id === planeId && province.id === provinceId)) continue;
    nearest = Math.min(nearest, distances.get(`${plane.id}:${province.id}`) ?? Infinity);
  }
  return nearest;
}

function authorSafeNationStart(project: MapProject, nation: number) {
  const plane = project.planes[0]!;
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const starts = plane.provinces.filter((province) => province.start).map((start) => shortestDistances(adjacency, start.id));
  const target = plane.provinces.find((province) => !province.start && !["sea", "deepsea", "kelp"].includes(province.terrain)
    && starts.every((distances) => (distances.get(province.id) ?? 0) >= 3))!;
  assert.ok(target, "fixture needs a province at least three moves from every generic start");
  assert.equal(setNationSpecificStart(project, plane.id, target.id, nation), true);
  return { planeId: plane.id, provinceId: target.id };
}

test("regenerated generic starts keep the three-move floor from an authored nation start", () => {
  // Both seeds previously put a generic capital two moves from the preserved nation start.
  for (const seed of ["sp-1", "sp-7"]) {
    const project = createDefaultProject(seed);
    const authored = authorSafeNationStart(project, 10);
    project.settings.players = 7;
    project.settings.startDistribution = { land: 7, coastal: 0, water: 0, cave: 0, other: 0 };

    const generated = generateProject(project);
    const plane = generated.planes[0]!;
    assert.deepEqual(generated.specificStarts, [{ nation: 10, ...authored }], `${seed}: the authored start is preserved`);
    assert.equal(plane.provinces.filter((province) => province.start).length, 7, `${seed}: every generic capital is placed`);
    assert.equal(plane.provinces.find((province) => province.id === authored.provinceId)!.start, false,
      `${seed}: a generic capital never reuses the authored province`);
    assert.ok(nearestGeneratedStart(generated, authored.planeId, authored.provinceId) >= 3, `${seed}: authored start is crowded`);
    assert.deepEqual(validateProject(generated).filter((issue) => issue.severity === "error" && SPACING_ERROR.test(issue.message)), []);
    assert.deepEqual(generated.generationWarnings?.filter((warning) => warning.includes("authored start")), []);
    assert.deepEqual(preflightAuthoredStartNotices(generated), []);
  }
});

test("authored starts on a cave realm are avoided by generated cave capitals", () => {
  let project = createDefaultProject("edge-cave", { generate: false });
  Object.assign(project.settings, { players: 5, provincesPerPlayer: 12, startDistribution: { land: 3, coastal: 0, water: 0, cave: 2, other: 0 } });
  project = generateProject(addPlane(project, "cave", { generate: false, autoSize: true }));
  const cave = project.planes[1]!;
  const caveStart = cave.provinces.find((province) => province.start)!;
  const neighbourId = adjacencyFor(cave, { traversableOnly: true }).get(caveStart.id)!
    .find((id) => !cave.provinces.find((province) => province.id === id)!.noStart)!;
  // Deliberately author the nation start beside the previous generated capital.
  assert.equal(setNationSpecificStart(project, cave.id, neighbourId, 20), true);

  const generated = generateProject(project);
  assert.ok(nearestGeneratedStart(generated, cave.id, neighbourId) >= 3);
  assert.deepEqual(validateProject(generated).filter((issue) => issue.severity === "error"), []);
});

test("manual assignments for configured cave nations still share a generated cave start", () => {
  let project = createDefaultProject("edge-cfg", { generate: false });
  Object.assign(project.settings, {
    players: 4,
    provincesPerPlayer: 10,
    startDistribution: { land: 2, coastal: 0, water: 0, cave: 2, other: 0 },
    caveStartNations: [15, 59],
  });
  project = generateProject(addPlane(project, "cave", { generate: false, autoSize: true }));
  const generated15 = project.specificStarts.find((start) => start.nation === 15)!;
  // Re-authoring the generated assignment makes it manual; validation requires it to stay on a cave start.
  setNationSpecificStart(project, generated15.planeId, generated15.provinceId, 15);

  const regenerated = generateProject(project);
  const manual = regenerated.specificStarts.find((start) => start.nation === 15)!;
  assert.equal(manual.source, undefined);
  const province = regenerated.planes.find((plane) => plane.id === manual.planeId)!.provinces.find((item) => item.id === manual.provinceId)!;
  assert.equal(province.start, true);
  assert.equal(province.startType, "cave");
  assert.ok(regenerated.specificStarts.some((start) => start.nation === 59 && start.source === "generated-cave"));
  assert.deepEqual(validateProject(regenerated).filter((issue) => issue.severity === "error"), []);
});

test("an authored start that cannot keep its spacing is named before and after Generate", () => {
  let project = createDefaultProject("edge-tiny", { generate: false });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 26;
  Object.assign(project.settings, { players: 4, provincesPerPlayer: 8, startDistribution: { land: 4, coastal: 0, water: 0, cave: 0, other: 0 } });
  project = generateProject(project);
  const plane = project.planes[0]!;
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const hub = [...plane.provinces].filter((province) => !province.noStart)
    .sort((a, b) => adjacency.get(b.id)!.length - adjacency.get(a.id)!.length)[0]!;
  assert.equal(setNationSpecificStart(project, plane.id, hub.id, 33), true);

  const generated = generateProject(project);
  const achieved = nearestGeneratedStart(generated, plane.id, hub.id);
  assert.ok(achieved < 3, "fixture: 26 provinces cannot separate four generated capitals and a central nation start");
  const hubName = generated.planes[0]!.provinces.find((province) => province.id === hub.id)!.name;
  const warning = generated.generationWarnings?.find((item) => item.includes("authored start for nation 33"));
  assert.ok(warning, "Generate records a specific warning");
  assert.ok(warning.includes(hubName));
  assert.ok(warning.includes(`only ${achieved} connection`));
  assert.ok(validateProject(generated).some((issue) => issue.severity === "error" && SPACING_ERROR.test(issue.message)),
    "validation still blocks export");

  const notices = preflightAuthoredStartNotices(generated);
  assert.equal(notices.length, 1);
  assert.deepEqual({ nation: notices[0]!.nation, planeId: notices[0]!.planeId, provinceId: notices[0]!.provinceId },
    { nation: 33, planeId: plane.id, provinceId: hub.id });
  assert.match(notices[0]!.message, new RegExp(`only ${achieved} movement connection`));
  setNationSpecificStart(generated, plane.id, hub.id, undefined);
  assert.deepEqual(preflightAuthoredStartNotices(generated), [], "removing the nation start clears the notice");
});

test("the Generate panel and confirmation surface authored-start notices with a remove action", () => {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  assert.match(source, /id="authored-start-notices"[^>]*role="status"/);
  assert.match(source, /setNationSpecificStart\(draft, notice\.planeId, notice\.provinceId, undefined\)/);
  assert.match(source, /confirmLabel: "Generate and replace"/);
  assert.match(source, /\.\.\.preflightAuthoredStartNotices\(project\)\.map\(\(notice\) => notice\.message\)/);
});

function scenario(options: { staleManual?: boolean; manualTarget?: number; players?: number; ppp?: number; seed?: string } = {}): MapProject {
  const players = options.players ?? 6;
  let project = createDefaultProject(options.seed ?? "stale-budget-1", { generate: false });
  project.settings.players = players;
  project.settings.provincesPerPlayer = options.ppp ?? 16;
  project.settings.startDistribution = { land: players, coastal: 0, water: 0, cave: 0, other: 0 };
  const manualTarget = options.manualTarget ?? 40;
  project = addPlane(project, "surface", { generate: options.staleManual ?? false, autoSize: false,
    provinceTarget: options.staleManual ? 300 : manualTarget });
  // Scenario B: an edited "Next generation" target leaves the current 300-province map stale.
  if (options.staleManual) project.planes[1]!.provinceTarget = manualTarget;
  return project;
}

function assertGenerationMatchesBudget(project: MapProject, label: string) {
  const budget = previewProvinceBudget(project);
  const generated = generateProject(project);
  assert.deepEqual(generated.planes.map((plane) => plane.provinces.length), budget.planes.map((row) => row.target), `${label}: sizes`);
  assert.deepEqual(generated.planes.map((plane) => plane.provinces.filter((province) => province.start).length),
    budget.planes.map((row) => row.allocatedStarts), `${label}: starts per plane`);
  return budget;
}

test("budget preview and generation use one start split for auto and manual planes", () => {
  const fresh = assertGenerationMatchesBudget(scenario(), "fresh manual plane");
  assert.deepEqual(fresh.planes.map((row) => [row.target, row.allocatedStarts]), [[48, 3], [40, 3]],
    "the auto plane is sized for the starts it actually receives");
  const stale = assertGenerationMatchesBudget(scenario({ staleManual: true }), "stale manual plane");
  assert.equal(stale.planes[1]!.current, 300);
  assert.deepEqual(stale.planes.map((row) => [row.target, row.allocatedStarts]), [[48, 3], [40, 3]],
    "a stale current map never changes the next-generation plan");
  assert.equal(stale.total, 88);
  // Configurations whose preview and generated split previously disagreed.
  assertGenerationMatchesBudget(scenario({ players: 8, ppp: 16, manualTarget: 32, seed: "split-a" }), "8 players / manual 32");
  assertGenerationMatchesBudget(scenario({ players: 7, ppp: 28, manualTarget: 64, seed: "split-b" }), "7 players / manual 64");
  let bonus = createDefaultProject("split-bonus", { generate: false });
  Object.assign(bonus.settings, { players: 7, provincesPerPlayer: 16, specialPlaneSizePercent: 10, startDegreeTarget: 3,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 0, other: 3 } });
  bonus = addPlane(bonus, "dream", { generate: false, autoSize: true });
  bonus = addPlane(bonus, "dream", { generate: false, autoSize: false, provinceTarget: 8 });
  assertGenerationMatchesBudget(bonus, "auto + manual bonus planes");
});

/** The generator's capacity-weighted greedy over one plane family. */
function greedySplit(sizes: number[], starts: number): number[] {
  const assigned = sizes.map(() => 0);
  for (let slot = 0; slot < starts; slot += 1) {
    const order = sizes.map((_, index) => index)
      .sort((a, b) => sizes[b]! / (assigned[b]! + 1) - sizes[a]! / (assigned[a]! + 1) || a - b);
    assigned[order[0]!]! += 1;
  }
  return assigned;
}

/** The budget only reads plane settings and province counts from a generated project. */
function asGenerated(project: MapProject, targets: number[], sample: Province): MapProject {
  return { ...project, planes: project.planes.map((plane, index): Plane => ({ ...plane,
    provinceTarget: targets[index]!,
    provinces: Array.from({ length: targets[index]! }, (_, cursor) => ({ ...sample, id: `${plane.id}-${cursor}` })),
  })) };
}

test("planned splits are fixed points of the generated sizes across an auto/manual grid", () => {
  const template = createDefaultProject("split-grid");
  let divergences = 0;
  let cases = 0;
  for (let players = 2; players <= 16; players += 2) for (const ppp of [8, 12, 16, 22, 30]) for (let manual = 8; manual <= 200; manual += 12) {
    let project = createDefaultProject("split-grid", { generate: false });
    project.settings.players = players;
    project.settings.provincesPerPlayer = ppp;
    project.settings.startDistribution = { land: players, coastal: 0, water: 0, cave: 0, other: 0 };
    project = addPlane(project, "surface", { generate: false, autoSize: false, provinceTarget: manual });
    // A stale current map on the manual plane must not change its next-generation plan.
    project.planes[1]!.provinces = template.planes[0]!.provinces;
    const budget = previewProvinceBudget(project);
    const targets = budget.planes.map((row) => row.target);
    const planned = budget.planes.map((row) => row.allocatedStarts);
    const replanned = previewProvinceBudget(asGenerated(project, targets, template.planes[0]!.provinces[0]!)).planes
      .map((row) => [row.target, row.allocatedStarts]);
    cases += 1;
    if (greedySplit(targets, players).join() !== planned.join()
      || JSON.stringify(replanned) !== JSON.stringify(budget.planes.map((row) => [row.target, row.allocatedStarts]))
      || planned.reduce((sum, value) => sum + value, 0) !== players) divergences += 1;
  }
  assert.equal(divergences, 0, `${divergences} of ${cases} planned splits disagree with their generated sizes`);

  let bonusDivergences = 0;
  for (const percent of [10, 30, 100]) for (const degree of [3, 6]) for (let starts = 1; starts <= 8; starts += 1) for (let manual = 8; manual <= 200; manual += 16) {
    let project = createDefaultProject("split-bonus-grid", { generate: false });
    Object.assign(project.settings, { players: starts + 4, provincesPerPlayer: 16, specialPlaneSizePercent: percent, startDegreeTarget: degree,
      startDistribution: { land: 4, coastal: 0, water: 0, cave: 0, other: starts } });
    project = addPlane(project, "dream", { generate: false, autoSize: true });
    project = addPlane(project, "dream", { generate: false, autoSize: false, provinceTarget: manual });
    const budget = previewProvinceBudget(project);
    const planned = [1, 2].map((index) => budget.planes[index]!.allocatedStarts);
    if (greedySplit([1, 2].map((index) => budget.planes[index]!.target), starts).join() !== planned.join()) bonusDivergences += 1;
  }
  assert.equal(bonusDivergences, 0);
});

test("the budget preview lists the per-plane generated start split", () => {
  const markup = renderToStaticMarkup(createElement(GenerationPlanSummary, { project: scenario({ staleManual: true }), onReview: () => undefined }));
  assert.match(markup, /Pantokrator(?:&#x27;|')s Realm: 0 → 48/);
  assert.match(markup, /Plane 2: 300 → 40/);
  assert.equal(markup.match(/· 3 generated starts/g)?.length, 2);
});
