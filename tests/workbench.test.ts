import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cloneProject, type MapProject } from "../src/domain";
import { addPlane, calculateFairness, createDefaultProject, generateProject, previewProvinceBudget } from "../src/generator";
import { buildPackageFiles, estimatedPackageBytes, parseProject, serializeProject } from "../src/export";
import { compileMapText } from "../src/dom6";
import { BalanceDialog, MapMakerApp } from "../src/MapMakerApp";
import { GenerationPlanSummary, ProvinceExplorer, StartBalancePanel } from "../src/WorkbenchPanels";
import { ANALYSIS_MODEL_VERSION, MAX_ANALYSIS_STARTS, analysisContextLines, analyzeStarts, buildStartAnalysisText,
  captureGenerationInputs, coefficientOfVariation, pendingGenerationGroups, provinceReferences, recordGenerationInputs,
  rulesetNotice, searchProvinces } from "../src/workbench";

const baseline = createDefaultProject("workbench-tests");
const noop = () => undefined;
function fixture(count = 8): MapProject {
  const p = cloneProject(baseline);
  p.gates = [];
  p.specificStarts = [];
  const plane = p.planes[0]!;
  plane.id = "land";
  plane.name = "First Realm";
  plane.provinces = Array.from({ length: count }, (_, i) => ({ ...plane.provinces[0]!, id: `p${i + 1}`, index: i + 1,
    name: `Place ${i + 1}`, terrain: "plains", terrainFlags: [], start: false, startType: undefined, teamStart: undefined,
    throne: "none", fixedThrone: undefined, population: undefined, defenders: [], sites: [], noStart: false }));
  plane.edges = plane.provinces.slice(1).map((province, i) => ({ id: `e${i}`, a: `p${i + 1}`, b: province.id, kind: "standard" }));
  return p;
}

test("legacy imports retain unknown provenance; new generation snapshots and patch notes round-trip", () => {
  assert.equal(pendingGenerationGroups(parseProject(serializeProject(baseline))), undefined);
  const p = recordGenerationInputs(cloneProject(baseline));
  p.analysisContext = { gameVersion: "6.99", mods: "User mod v2\nUnverified" };
  const restored = parseProject(serializeProject(p));
  assert.deepEqual(restored.analysisContext, p.analysisContext);
  assert.deepEqual(restored.generationInputs, p.generationInputs);
  assert.deepEqual(pendingGenerationGroups(restored), []);
  assert.equal(compileMapText(p, 0), compileMapText(baseline, 0), "notes and baselines must not add game directives");
});

test("import rejects malformed, future, extra, or oversized analysis metadata", () => {
  for (const input of [null, [], { version: 2 }, { ...captureGenerationInputs(baseline), extra: true },
    { ...captureGenerationInputs(baseline), seed: "a".repeat(65_537) }, { ...captureGenerationInputs(baseline), planes: 2 }]) {
    assert.throws(() => parseProject(JSON.stringify({ ...baseline, generationInputs: input })));
  }
  for (const context of [null, [], { gameVersion: 635 }, { mods: "x".repeat(4097) }, { verified: true }]) {
    assert.throws(() => parseProject(JSON.stringify({ ...baseline, analysisContext: context })));
  }
  const p = cloneProject(baseline);
  p.seed = "\u0001".repeat(4096);
  recordGenerationInputs(p);
  assert.deepEqual(parseProject(serializeProject(p)).generationInputs, p.generationInputs, "escaped maximum seed remains restorable");
});

test("pending inputs distinguish regeneration from manual edits, host settings and descriptive notes", () => {
  const p = recordGenerationInputs(cloneProject(baseline));
  p.name = "Renamed";
  p.planes[0]!.name = "Renamed plane";
  p.planes[0]!.provinceTarget += 10; // auto-sized output is not an input
  p.planes[0]!.provinces[0]!.terrainFlags = ["forest"];
  p.planes[0]!.provinces[0]!.name = "Manual name";
  p.settings.siteFrequency = 70;
  p.settings.provinceNameSeed = 4;
  p.sailDistance = 10;
  p.targetVersion = 999;
  p.analysisContext = { gameVersion: "6.99" };
  assert.deepEqual(pendingGenerationGroups(p), []);
  p.seed = "changed";
  p.settings.players++;
  p.settings.waterPercent++;
  p.planes[0]!.noGeneratedStarts = true;
  p.settings.gatePairsPerConnection = (p.settings.gatePairsPerConnection ?? 1) + 1;
  assert.deepEqual(pendingGenerationGroups(p), ["seed", "starts", "terrain", "planes", "links"]);
  recordGenerationInputs(p);
  assert.deepEqual(pendingGenerationGroups(p), []);
  p.planes[0]!.autoSize = false;
  recordGenerationInputs(p);
  p.planes[0]!.provinceTarget++;
  assert.deepEqual(pendingGenerationGroups(p), ["planes"]);
});

test("budget previews equal actual generated counts and never mutate the plan", () => {
  const cases: MapProject[] = [cloneProject(baseline)];
  let multi = addPlane(cloneProject(baseline), "cave", { autoSize: true, generate: false });
  multi = addPlane(multi, "dream", { autoSize: true, generate: false });
  multi.settings.startDistribution = { land: 3, coastal: 0, water: 0, cave: 2, other: 1 };
  cases.push(multi);
  const manual = addPlane(cloneProject(baseline), "abyss", { autoSize: false, provinceTarget: 45, generate: false });
  manual.planes[0]!.autoSize = false;
  manual.planes[0]!.provinceTarget = 73;
  manual.planes[1]!.noGeneratedStarts = true;
  cases.push(manual);
  for (const p of cases) {
    const before = JSON.stringify(p);
    const budget = previewProvinceBudget(p);
    assert.equal(JSON.stringify(p), before);
    const generated = generateProject(p);
    assert.deepEqual(budget.planes.map(r => r.target), generated.planes.map(plane => plane.provinces.length));
    assert.equal(budget.total, budget.core + budget.bonus);
  }
});

test("budget explains no-core references, reserved layers, minimums and the per-plane cap", () => {
  const p = cloneProject(baseline);
  p.planes[0]!.kind = "dream";
  p.settings.startDistribution = { land: 0, coastal: 0, water: 0, cave: 0, other: 6 };
  p.settings.specialPlaneSizePercent = 1;
  let budget = previewProvinceBudget(p);
  assert.equal(budget.core, 0);
  assert.equal(budget.usesFallbackCore, true);
  assert.equal(budget.referenceCore, 96);
  assert.match(budget.planes[0]!.reason, /buffers/);
  p.settings.players = 32;
  p.settings.provincesPerPlayer = 30;
  p.settings.specialPlaneSizePercent = 500;
  p.planes[0]!.noGeneratedStarts = true;
  budget = previewProvinceBudget(p);
  assert.equal(budget.planes[0]!.target, 800);
  assert.equal(budget.planes[0]!.reserved, true);
  assert.match(budget.planes[0]!.reason, /Limited to 800/);
});

test("per-start analysis deduplicates all start types, excludes all capitals and exposes ties", () => {
  const p = fixture();
  const provinces = p.planes[0]!.provinces;
  provinces[0]!.start = true;
  provinces[0]!.teamStart = 0;
  p.specificStarts = [{ nation: 5, planeId: "land", provinceId: "p1" }, { nation: 15, planeId: "land", provinceId: "p5" }];
  const before = JSON.stringify(p);
  const report = analyzeStarts(p);
  assert.equal(report.totalStarts, 2);
  const first = report.starts[0]!;
  assert.deepEqual(first.nations, [5]);
  assert.equal(first.team, 0);
  assert.deepEqual(first.twoStepKeys, ["land:p2", "land:p3"]);
  assert.equal(first.threeStepCount, 3);
  assert.equal(first.exclusive, 1);
  assert.equal(first.contested, 1);
  assert.equal(first.nearestRival, 4);
  assert.equal(first.fractionalOpportunity, 1.5);
  assert.equal(first.rivalRegionsAtFrontier, 1);
  assert.equal(first.sharedCapitalNeighbours, 0);
  assert.equal(JSON.stringify(p), before);
  assert.equal(report.modelVersion, ANALYSIS_MODEL_VERSION);
});

test("team zero is an alliance label, not falsy or a nearest rival", () => {
  const p = fixture();
  p.planes[0]!.provinces[0]!.teamStart = 0;
  p.planes[0]!.provinces[4]!.teamStart = 0;
  const first = analyzeStarts(p).starts[0]!;
  assert.equal(first.nearestRival, undefined);
  assert.equal(first.exclusive, first.twoStepKeys.length);
  assert.equal(first.contested, 0);
  assert.equal(first.nearestAlly, 4);
  assert.equal(first.fractionalOpportunity, first.twoStepKeys.length);
  assert.equal(first.rivalRegionsAtFrontier, 0);
});

test("conservative model separates water/dry access and seasonal border assumptions", () => {
  const p = fixture();
  const plane = p.planes[0]!;
  plane.provinces[0]!.start = true;
  plane.provinces[2]!.terrainFlags = ["sea"];
  plane.provinces[3]!.terrain = "deepsea";
  assert.equal(analyzeStarts(p).starts[0]!.twoStepKeys.length, 2);
  assert.deepEqual(analyzeStarts(p, "conservative").starts[0]!.twoStepKeys, ["land:p2"]);
  for (const kind of ["river", "mountain_pass", "mountain_border"] as const) {
    plane.edges[0]!.kind = kind;
    assert.equal(analyzeStarts(p, "conservative").starts[0]!.exits, 0);
    assert.equal(analyzeStarts(p).starts[0]!.exits, 1);
  }
  for (const special of [1, 2, 32, 35]) {
    plane.edges[0]!.kind = "custom";
    plane.edges[0]!.special = special;
    assert.equal(analyzeStarts(p, "conservative").starts[0]!.exits, 0);
  }
  plane.edges[0]!.kind = "road";
  delete plane.edges[0]!.special;
  assert.equal(analyzeStarts(p, "conservative").starts[0]!.exits, 1);
  plane.provinces[2]!.start = true;
  assert.equal(analyzeStarts(p, "conservative").twoStepCv, undefined, "unlike media do not produce a spread statistic");
});

test("unknown population, powerful guardians and throne semantics stay separate", () => {
  const p = fixture();
  const provinces = p.planes[0]!.provinces;
  provinces[0]!.start = true;
  provinces[1]!.population = 0;
  provinces[1]!.defenders = [{ commander: "1314", squads: [{ id: "demons", unit: "489", count: 200 }] }];
  provinces[1]!.throne = "preferred";
  provinces[3]!.throne = "fixed";
  let start = analyzeStarts(p).starts[0]!;
  assert.equal(start.knownPopulation, 0);
  assert.equal(start.unknownPopulationCount, 1);
  assert.equal(start.guardianProvinceCount, 1);
  assert.equal(start.preferredThrones, 1);
  assert.equal(start.fixedThrones, 1);
  assert.equal(start.nearestThrone, 1);
  provinces[2]!.population = 12500;
  start = analyzeStarts(p).starts[0]!;
  assert.equal(start.knownPopulation, 12500);
  assert.equal(start.unknownPopulationCount, 0);
  assert.doesNotMatch(JSON.stringify(start), /combatScore|incomeEstimate|resourceEstimate/);
});

test("actual cross-plane gates are counted, draft plans and stale endpoints are not", () => {
  const p = fixture();
  p.planes[0]!.provinces[0]!.start = true;
  const second = cloneProject(p).planes[0]!;
  second.id = "caves";
  second.name = "Second Realm";
  second.provinces.forEach(province => { province.start = false; province.terrain = "cave"; });
  p.planes.push(second);
  p.settings.planeConnections = [{ a: "land", b: "caves", pairs: 1 }];
  assert.equal(analyzeStarts(p).starts[0]!.nearestRealmEntrance, undefined);
  p.gates = [{ id: "g", gateNumber: 1, endpoints: [
    { planeId: "land", provinceId: "p2" }, { planeId: "caves", provinceId: "p1" }, { planeId: "missing", provinceId: "missing" },
  ] }];
  const first = analyzeStarts(p, "conservative").starts[0]!;
  assert.equal(first.nearestRealmEntrance, 1);
  assert.ok(first.twoStepKeys.includes("caves:p1"));
  second.provinces[0]!.terrain = "sea";
  assert.ok(!analyzeStarts(p, "conservative").starts[0]!.twoStepKeys.includes("caves:p1"));
  assert.ok(analyzeStarts(p).starts[0]!.twoStepKeys.includes("caves:p1"));
});

test("empty, blocked, disconnected and oversized start sets never imply complete parity", () => {
  const empty = fixture();
  assert.equal(analyzeStarts(empty).starts.length, 0);
  empty.planes[0]!.provinces[0]!.start = true;
  empty.planes[0]!.provinces[0]!.terrainFlags = ["cavewall"];
  const blocked = analyzeStarts(empty);
  assert.equal(blocked.starts[0]!.blocked, true);
  assert.equal(blocked.starts[0]!.twoStepKeys.length, 0);
  assert.equal(blocked.twoStepCv, undefined);
  const many = fixture(MAX_ANALYSIS_STARTS + 1);
  many.planes[0]!.provinces.forEach(province => { province.start = true; });
  const report = analyzeStarts(many);
  assert.equal(report.starts.length, MAX_ANALYSIS_STARTS);
  assert.equal(report.totalStarts, MAX_ANALYSIS_STARTS + 1);
  assert.equal(report.truncated, true);
  assert.equal(report.twoStepCv, undefined);
  assert.equal(report.starts[0]!.exclusive, undefined);
  assert.equal(report.starts[0]!.contested, undefined);
  assert.equal(coefficientOfVariation([]), undefined);
  assert.equal(coefficientOfVariation([0, 0]), undefined);
  assert.equal(coefficientOfVariation([2, 2]), 0);
});

test("malformed duplicate gate endpoints cannot fabricate an exit", () => {
  const p = fixture();
  p.planes[0]!.provinces[0]!.start = true;
  p.planes[0]!.edges = [];
  p.gates = [{ id: "duplicate", gateNumber: 1, endpoints: [
    { planeId: "land", provinceId: "p1" }, { planeId: "land", provinceId: "p1" },
  ] }];
  assert.equal(analyzeStarts(p).starts[0]!.exits, 0);
  assert.equal(analyzeStarts(p, "conservative").starts[0]!.exits, 0);
});

test("province search uses all planes, exact global/local numbering and bounded results", () => {
  const p = fixture();
  const second = cloneProject(p).planes[0]!;
  second.id = "second";
  second.name = "Dreamlands";
  second.provinces[0]!.name = "Misty Shore";
  p.planes.push(second);
  assert.deepEqual(searchProvinces(p, "   "), { total: 0, results: [] });
  assert.equal(searchProvinces(p, "misty DREAMLANDS").results[0]!.globalNumber, 9);
  assert.equal(searchProvinces(p, "#9").results[0]!.province.index, 1);
  assert.equal(searchProvinces(p, "#1").total, 2);
  assert.equal(searchProvinces(p, "Dreamlands #1").total, 1);
  assert.equal(searchProvinces(p, "Place", 2).results.length, 2);
  assert.equal(searchProvinces(p, "Place", 2).total, 15);
  assert.equal(provinceReferences(p).at(-1)!.globalNumber, 16);
});

test("patch notes never certify nation strength or silently enable accommodations", () => {
  const p = fixture();
  assert.ok(analysisContextLines(p, "6.35").includes('Declared host era: "unknown"'));
  assert.match(rulesetNotice(p, "6.35"), /not declared/);
  p.analysisContext = { gameVersion: "6.99" };
  assert.match(rulesetNotice(p, "6.35"), /differs/);
  p.analysisContext = { gameVersion: "6.35" };
  assert.match(rulesetNotice(p, "6.35"), /verifies neither/);
  p.analysisContext.mods = "Test v1\nFAKE REPORT HEADER";
  assert.match(rulesetNotice(p, "6.35"), /unverified/);
  assert.ok(analysisContextLines(p, "6.35").every(line => !/[\r\n]/.test(line)));
  const text = buildStartAnalysisText(p, "6.35");
  assert.match(text, /HOST ONLY/);
  assert.match(text, /not turns/);
  assert.match(text, /random independent strength remain unknown/);
  assert.doesNotMatch(text, /\r\nFAKE REPORT HEADER/);
});

test("shared assumptions expose explicit host era and safely report only known enum values", () => {
  const p = fixture();
  const props = { project: p, fairness: calculateFairness(p), errors: 0, catalogVersion: "6.35", onContextChange: noop, onInspect: noop };
  const before = JSON.stringify(p);
  const unknown = renderToStaticMarkup(createElement(StartBalancePanel, props));
  assert.match(unknown, /Game patch, era and mod assumptions/);
  assert.match(unknown, /Declared host game era/);
  assert.match(unknown, /aria-describedby="analysis-era-help"/);
  assert.match(unknown, /<option value="" selected="">Unknown \/ not declared/);
  assert.equal(JSON.stringify(p), before);
  p.analysisContext = { era: 2 };
  assert.match(renderToStaticMarkup(createElement(StartBalancePanel, props)), /<option value="2" selected="">Middle Age/);
  assert.ok(analysisContextLines(p, "6.35").includes('Declared host era: "Middle Age (2)"'));
  Object.assign(p.analysisContext, { era: "2\nFAKE REPORT HEADER" });
  assert.ok(analysisContextLines(p, "6.35").includes('Declared host era: "unknown"'));
  assert.ok(analysisContextLines(p, "6.35").every(line => !/[\r\n]/.test(line)));
});

test("exported host reports carry declared assumptions and both models without changing playable directives", async () => {
  const p = cloneProject(baseline);
  p.planes[0]!.width = 256;
  p.planes[0]!.height = 256;
  const mapBefore = compileMapText(p, 0);
  p.analysisContext = { gameVersion: "6.99", mods: "Example balance mod v1\nUnverified" };
  recordGenerationInputs(p);
  const files = await buildPackageFiles(p);
  const read = (name: string) => new TextDecoder().decode(files.find(file => file.name === name)!.data);
  assert.match(read("balance_report.txt"), /POTENTIAL CONNECTIONS/);
  assert.match(read("balance_report.txt"), /CONSERVATIVE CONNECTIONS/);
  assert.match(read("balance_report.txt"), /generic, team, and specific; deduplicated/);
  assert.match(read("host_settings.txt"), /Declared game patch: "6.99"/);
  assert.match(read("host_settings.txt"), /No nation compensation/);
  assert.deepEqual(parseProject(read("atlas_project.json")).analysisContext, p.analysisContext);
  assert.equal(new TextDecoder().decode(files.find(file => file.name.endsWith(".map"))!.data), mapBefore);
  assert.ok(estimatedPackageBytes(p) >= files.reduce((sum, file) => sum + file.data.length, 0));
});

test("rendered workbench exposes scope, plan provenance, budgets, search and neutral diagnostics", () => {
  const p = fixture();
  p.planes[0]!.provinces[0]!.start = true;
  let markup = renderToStaticMarkup(createElement(GenerationPlanSummary, { project: p, onReview: noop }));
  assert.match(markup, /No generation baseline/);
  assert.match(markup, /Province budget by plane/);
  assert.match(markup, /aria-haspopup="dialog">Start analysis…<\/button>/);
  recordGenerationInputs(p);
  p.settings.waterPercent++;
  markup = renderToStaticMarkup(createElement(GenerationPlanSummary, { project: p, onReview: noop }));
  assert.match(markup, /Pending: Terrain/);
  const props = { project: p, fairness: calculateFairness(p), errors: 2, catalogVersion: "6.35", onContextChange: noop, onInspect: noop };
  markup = renderToStaticMarkup(createElement(StartBalancePanel, props));
  for (const label of ["2 export blockers", "Structural score", "Limited / assumptions shown", "2 unknown provinces", "difficulty unknown", "not turns", "Potential connections", "Conservative dry"]) {
    assert.ok(markup.includes(label), label);
  }
  assert.match(markup, /<table/);
  assert.match(markup, /role="region"/);
  assert.match(markup, /tabindex="0"/);
  markup = renderToStaticMarkup(createElement(BalanceDialog, { ...props, onClose: noop }));
  assert.match(markup, /aria-modal="true" role="dialog"|role="dialog" aria-modal="true"/);
  assert.match(markup, /Close start-region analysis/);
  markup = renderToStaticMarkup(createElement(ProvinceExplorer, { project: p, onSelect: noop }));
  assert.match(markup, /type="search"/);
  assert.match(markup, /Navigate only/);
  markup = renderToStaticMarkup(createElement(MapMakerApp));
  assert.match(markup, /Map \+ next generation/);
  assert.match(markup, /Next generation/);
  assert.match(markup, /Inspect starts/);
});

test("analysis overlays are source-bound, navigation-safe and not passed to PNG export", () => {
  const app = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  assert.match(app, /analysisSelection\?\.project === project/);
  const navigate = app.slice(app.indexOf("const inspectProvince ="), app.indexOf("const totalProvinces"));
  assert.match(navigate, /setTool\("select"\)/);
  assert.match(navigate, /setLinkSource\(undefined\)/);
  assert.match(navigate, /setGateSource\(undefined\)/);
  const canvas = readFileSync(new URL("../src/MapCanvas.tsx", import.meta.url), "utf8");
  const png = canvas.slice(canvas.indexOf("export async function renderPlanePng"), canvas.indexOf("export async function renderPlanePng") + 2300);
  assert.doesNotMatch(png, /analysisProvinceIds/);
  assert.equal((canvas.match(/options\.analysisProvinceIds\?\.has\(province.id\)/g) ?? []).length, 3, "solid, sparse and procedural renderers retain analysis overlays");
  const procedural = canvas.slice(canvas.indexOf("function paintProceduralPlane("), canvas.indexOf("const sparsePaintMaskCache"));
  assert.match(procedural, /const path = mask\.ownerPaths\[index\]/);
  assert.match(procedural, /options\.analysisProvinceIds\?\.has\(province\.id\)[^\n]+context\.fill\(path\)/, "realm analysis is filled only inside the selected owner's raster path");
});
