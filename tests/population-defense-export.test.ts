import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "../src/catalog";
import { cloneProject, type MapProject, type Province } from "../src/domain";
import { compileMapText, compileTextFiles, validateProject } from "../src/dom6";
import { buildPackageFiles, estimatedPackageBytes, estimatedTextPackageBytes, parseProject, serializeProject } from "../src/export";
import { createDefaultProject, generateProject } from "../src/generator";
import { protectedProvinceKeys } from "../src/iteration";
import { IterationPanel } from "../src/IterationPanel";
import { applySettingsRecipe, createSettingsRecipe, parseSettingsRecipe } from "../src/recipes";
import type { PopulationDefenseIdentity, VerifiedPopulationDefenseProfile } from "../src/populationDefenders";

// Fictional, explicitly injected records exercise wiring only. They are never
// included in the trusted registry and are not claims about native game rosters.
const revision = "synthetic-export-regression-v1";
const identity = (id: number, name: string): PopulationDefenseIdentity => ({ id, name, provenanceId: "synthetic-export-only" });
const populationA = identity(900001, "Test-only population A"), populationB = identity(900002, "Test-only population B");
const commanderA = identity(999971, "Test-only commander A"), commanderB = identity(999972, "Test-only commander B");
const troopA = identity(999981, "Test-only troop A"), troopB = identity(999982, "Test-only troop B");
const baseline = createDefaultProject("population-defense-export-integration");
function activeCatalog(): Dom6CatalogBundle {
  const catalog = structuredClone(BUILTIN_DOM6_CATALOG);
  catalog.provenance.push({ id: "synthetic-export-only", title: "Fictional export regression fixtures", authority: "user" });
  catalog.poptypes.push(...structuredClone([populationA, populationB]));
  catalog.units.push(...structuredClone([commanderA, commanderB, troopA, troopB]));
  return catalog;
}
function profiles(): VerifiedPopulationDefenseProfile[] {
  return [false, true].map(second => ({ revision, poptype: second ? populationB : populationA, gameVersion: "6.37", mods: "",
    allowedMedia: ["dry"], caveRule: "forbidden",
    source: { title: "Fictional test-only evidence", reference: "test://population-defense-export", revision: "test-v1", verification: "Synthetic identities verify integration; not native roster evidence." },
    groups: [{ commander: second ? commanderB : commanderA, squads: [{ unit: second ? troopB : troopA, count: second ? 13 : 17 }] }],
  }));
}
function fixture() {
  const project = cloneProject(baseline);
  project.planes[0]!.width = project.planes[0]!.height = 256;
  project.analysisContext = { gameVersion: "6.37", mods: "" };
  project.populationDefense = { enabled: true, profileRevision: revision };
  const plane = project.planes[0]!;
  for (const p of plane.provinces) { p.defenders = []; delete p.poptype; p.throne = "none"; p.sites = []; }
  const protectedKeys = protectedProvinceKeys(project, 1);
  const target = plane.provinces.find(p => !protectedKeys.has(`${plane.id}:${p.id}`))!;
  target.terrain = "plains";
  target.terrainFlags = undefined;
  target.poptype = populationA.id;
  return { project, plane, target, catalog: activeCatalog() };
}
function provinceBlocks(text: string) {
  const blocks = new Map<number, { selector: string; lines: string[] }>();
  let current: { selector: string; lines: string[] } | undefined;
  for (const line of text.split(/\r?\n/)) {
    const selector = /^#(land|setland) (\d+)$/.exec(line);
    if (selector) { current = { selector: selector[1]!, lines: [] }; blocks.set(Number(selector[2]), current); }
    else current?.lines.push(line);
  }
  return blocks;
}

test("population defense is optional, strictly persisted, and not silently enabled or repinned", () => {
  const old = parseProject(serializeProject(baseline));
  assert.equal(old.populationDefense, undefined);
  const { project } = fixture();
  project.populationDefense!.profileRevision = "historical-unknown-revision";
  assert.deepEqual(parseProject(serializeProject(project)).populationDefense, project.populationDefense);
  assert.deepEqual(generateProject(project).populationDefense, project.populationDefense);
  project.populationDefense!.enabled = false;
  assert.deepEqual(parseProject(serializeProject(project)).populationDefense, project.populationDefense);
});

test("project and recipe imports cannot smuggle malformed policy fields or trusted profile records", () => {
  const badPolicies = [null, [], "enabled", {}, { enabled: "false", profileRevision: revision }, { enabled: true },
    { enabled: true, profileRevision: "" }, { enabled: true, profileRevision: "  current" },
    { enabled: true, profileRevision: "x".repeat(121) }, { enabled: true, profileRevision: "x\u0001y" },
    { enabled: true, profileRevision: revision, profiles: profiles() }];
  for (const policy of badPolicies) {
    assert.throws(() => parseProject(JSON.stringify({ ...baseline, populationDefense: policy })), /populationDefense|must be|unknown/i);
    assert.throws(() => parseSettingsRecipe(JSON.stringify({ ...createSettingsRecipe(baseline), populationDefense: policy })), /populationDefense|must be|unknown/i);
  }
});

test("host eras strictly round-trip through projects and recipes without auto-filling older maps", () => {
  assert.equal(parseProject(serializeProject(baseline)).analysisContext?.era, undefined);
  for (const era of [1, 2, 3] as const) {
    const { project, catalog } = fixture();
    project.populationDefense!.enabled = false;
    const before = compileMapText(project, 0, catalog, profiles());
    project.analysisContext!.era = era;
    assert.equal(parseProject(serializeProject(project)).analysisContext?.era, era);
    const recipe = parseSettingsRecipe(JSON.stringify(createSettingsRecipe(project)));
    assert.equal(recipe.assumptions?.era, era);
    assert.equal(applySettingsRecipe(project, recipe).analysisContext?.era, era);
    assert.equal(generateProject(project).analysisContext?.era, era);
    assert.equal(compileMapText(project, 0, catalog, profiles()), before, "host declarations must not change armies while disabled");
  }
  for (const era of [null, "2", 0, 4, -1, 2.5, true, [], {}]) {
    const context = { gameVersion: "6.37", era };
    assert.throws(() => parseProject(JSON.stringify({ ...baseline, analysisContext: context })), /analysisContext\.era/);
    assert.throws(() => parseSettingsRecipe(JSON.stringify({ ...createSettingsRecipe(baseline), assumptions: context })), /analysisContext\.era/);
  }
  assert.throws(() => parseProject(JSON.stringify({ ...baseline, analysisContext: { era: 2, guessedEra: true } })), /analysisContext\.guessedEra is not supported/);
});

test("recipes preserve an explicit policy and omitted legacy host assumptions without changing derived armies", () => {
  const { project, catalog } = fixture();
  project.analysisContext!.era = 2;
  const before = compileMapText(project, 0, catalog, profiles());
  const saved = parseSettingsRecipe(JSON.stringify(createSettingsRecipe(project, "Verified policy recipe")));
  assert.deepEqual(saved.populationDefense, project.populationDefense);
  assert.deepEqual(saved.assumptions, project.analysisContext);
  const restored = applySettingsRecipe(baseline, saved);
  assert.deepEqual(restored.populationDefense, project.populationDefense);
  const legacy = createSettingsRecipe(project);
  delete legacy.populationDefense;
  delete legacy.assumptions;
  const applied = applySettingsRecipe(project, legacy);
  assert.deepEqual(applied.populationDefense, project.populationDefense);
  assert.deepEqual(applied.analysisContext, project.analysisContext);
  assert.equal(compileMapText(applied, 0, catalog, profiles()), before);
  const disabled = { ...saved, populationDefense: { enabled: false, profileRevision: revision } };
  assert.equal(applySettingsRecipe(project, disabled).populationDefense?.enabled, false);
});

test("absent and disabled policies preserve native bytes with any internal registry supplied", () => {
  const { project, catalog } = fixture();
  delete project.populationDefense;
  const unchanged = compileMapText(project, 0, catalog);
  const defaultFiles = compileTextFiles(project, catalog);
  assert.equal(compileMapText(project, 0, catalog, profiles()), unchanged);
  project.populationDefense = { enabled: false, profileRevision: revision };
  assert.equal(compileMapText(project, 0, catalog, profiles()), unchanged);
  assert.deepEqual(compileTextFiles(project, catalog, profiles()), defaultFiles);
  assert.ok(!validateProject(project, catalog, profiles()).some(issue => /Population-matched/.test(issue.message)));
});

test("supported exports derive detached initial groups using existing native syntax only", () => {
  const { project, target, catalog } = fixture();
  const before = serializeProject(project);
  const text = compileMapText(project, 0, catalog, profiles());
  const block = provinceBlocks(text).get(target.index)!;
  assert.equal(block.selector, "land");
  assert.ok(block.lines.includes(`#poptype ${populationA.id}`));
  assert.ok(block.lines.includes(`#commander ${commanderA.id}`));
  assert.ok(block.lines.includes(`#units 17 ${troopA.id}`));
  assert.match(text, /Population-matched initial defenders: poptype 900001/);
  assert.equal(compileMapText(project, 0, catalog, profiles()), text);
  assert.equal(serializeProject(project), before);
  assert.deepEqual(target.defenders, []);
  assert.equal(new TextDecoder().decode(compileTextFiles(project, catalog, profiles())[0]!.data), text);
});

test("manual population edits immediately select a new supported profile or retain native fallback", () => {
  const { project, target, catalog } = fixture();
  target.poptype = populationB.id;
  let block = provinceBlocks(compileMapText(project, 0, catalog, profiles())).get(target.index)!;
  assert.ok(block.lines.includes(`#commander ${commanderB.id}`));
  assert.ok(block.lines.includes(`#units 13 ${troopB.id}`));
  assert.ok(!block.lines.includes(`#commander ${commanderA.id}`));
  target.poptype = 25; // A real population, but deliberately unsupported by this injected registry.
  const unsupported = compileMapText(project, 0, catalog, profiles());
  block = provinceBlocks(unsupported).get(target.index)!;
  assert.equal(block.selector, "setland");
  assert.ok(!block.lines.some(line => /^#(?:commander|units) /.test(line)));
  const disabled = cloneProject(project); disabled.populationDefense!.enabled = false;
  assert.equal(unsupported, compileMapText(disabled, 0, catalog, profiles()));
});

const exclusionCases: Array<[string, (project: MapProject, target: Province) => void]> = [
  ["generic start", (_p, target) => { target.start = true; }],
  ["team start", (_p, target) => { target.teamStart = 0; }],
  ["specific start", (p, target) => { p.specificStarts.push({ nation: 50, planeId: p.planes[0]!.id, provinceId: target.id }); }],
  ["gateway-linked start ring", (p, target) => { const plane = p.planes[0]!; p.gates.push({ id: "test-gate", gateNumber: 1, endpoints: [{ planeId: plane.id, provinceId: plane.provinces.find(v => v.start)!.id }, { planeId: plane.id, provinceId: target.id }] }); }],
  ["explicit owner", (_p, target) => { target.owner = 50; }],
  ["blocked terrain", (_p, target) => { target.terrain = "cavewall"; }],
  ["throne", (_p, target) => { target.throne = "preferred"; }],
  ["empty guardian lock", (_p, target) => { target.editorLocks = ["guardians"]; }],
];
for (const [name, change] of exclusionCases) test(`export does not replace native defenders in an excluded ${name}`, () => {
  const { project, target, catalog } = fixture();
  change(project, target);
  const enabled = compileMapText(project, 0, catalog, profiles());
  const disabled = cloneProject(project); disabled.populationDefense!.enabled = false;
  assert.equal(enabled, compileMapText(disabled, 0, catalog, profiles()));
  assert.equal(provinceBlocks(enabled).get(target.index)!.selector, "setland");
});

test("an existing authored guardian group is preserved exactly, even if its draft is on a start", () => {
  const { project, target, catalog } = fixture();
  target.defenders = [{ commander: String(commanderB.id), commanderName: "Authored guardian", experience: 3,
    squads: [{ id: "authored", unit: String(troopB.id), count: 23 }] }];
  const defendersBefore = structuredClone(target.defenders);
  for (const onStart of [false, true]) {
    target.start = onStart;
    const native = compileMapText(project, 0, catalog, profiles());
    const disabled = cloneProject(project); disabled.populationDefense!.enabled = false;
    assert.equal(native, compileMapText(disabled, 0, catalog, profiles()));
    const block = provinceBlocks(native).get(target.index)!;
    assert.equal(block.selector, onStart ? "setland" : "land");
    assert.ok(block.lines.includes(`#units 23 ${troopB.id}`));
  }
  assert.deepEqual(target.defenders, defendersBefore);
});

test("patch/mod/catalog mismatches never fall back to a guessed profile", () => {
  for (const mismatch of ["patch", "mods", "catalog"] as const) {
    const { project, target, catalog } = fixture();
    if (mismatch === "patch") project.analysisContext!.gameVersion = "6.38";
    if (mismatch === "mods") project.analysisContext!.mods = "changed-mod-set";
    if (mismatch === "catalog") catalog.units.find(unit => unit.id === troopA.id)!.provenanceId = "another-source";
    assert.equal(provinceBlocks(compileMapText(project, 0, catalog, profiles())).get(target.index)!.selector, "setland");
    assert.equal(validateProject(project, catalog, profiles()).filter(issue => issue.severity === "warning" && /Population-matched/.test(issue.message)).length, 1);
  }
});

test("era-restricted exports retain native armies for unknown or mismatched eras and derive only a declared match", () => {
  const { project, target, catalog } = fixture();
  const rows = profiles();
  rows[0]!.allowedEras = [2];
  for (const era of [undefined, 1, 3] as const) {
    project.analysisContext!.era = era;
    const native = compileMapText(project, 0, catalog, rows);
    const disabled = cloneProject(project); disabled.populationDefense!.enabled = false;
    assert.equal(native, compileMapText(disabled, 0, catalog, rows));
    assert.equal(provinceBlocks(native).get(target.index)!.selector, "setland");
    assert.equal(validateProject(project, catalog, rows).filter(issue => /Population-matched/.test(issue.message)).length, 1);
  }
  project.analysisContext!.era = 2;
  assert.equal(provinceBlocks(compileMapText(project, 0, catalog, rows)).get(target.index)!.selector, "land");
  assert.deepEqual(target.defenders, [], "era edits must not materialize derived groups in editable source");
});

test("unsupported populations produce one aggregated warning, never an empty #land replacement", () => {
  const { project, plane, catalog } = fixture();
  for (const p of plane.provinces) p.poptype = 25;
  const warnings = validateProject(project, catalog, profiles()).filter(issue => issue.severity === "warning" && /Population-matched/.test(issue.message));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /retain normal engine-generated armies/);
  assert.match(warnings[0]!.message, /No empty replacement army/);
  assert.doesNotMatch(compileMapText(project, 0, catalog, profiles()), /^#land \d+/m);
});

test("raw directives anywhere suspend all derivation and remain visible in aggregated export warnings", () => {
  for (const scope of ["project", "plane", "other-province"] as const) {
    const { project, plane, target, catalog } = fixture();
    if (scope === "project") project.rawDirectives = "-- authored project context";
    if (scope === "plane") plane.rawDirectives = "-- authored plane context";
    if (scope === "other-province") plane.provinces.find(p => p.id !== target.id)!.rawDirectives = "#setland 1\n#population 11000";
    const native = compileMapText(project, 0, catalog, profiles());
    const disabled = cloneProject(project); disabled.populationDefense!.enabled = false;
    assert.equal(native, compileMapText(disabled, 0, catalog, profiles()));
    const warnings = validateProject(project, catalog, profiles()).filter(issue => /suspended across this atlas/.test(issue.message));
    assert.equal(warnings.length, 1);
    assert.ok(!warnings[0]!.provinceId, "suspension is an atlas-wide condition, not duplicated for every province");
  }
});

test("host/player packages and size budgets use the same active catalog and derived map bytes", async () => {
  const { project, target, catalog } = fixture();
  project.analysisContext!.era = 2;
  const rows = profiles();
  const before = serializeProject(project);
  const host = await buildPackageFiles(project, undefined, catalog, "host", rows);
  const player = await buildPackageFiles(project, undefined, catalog, "player", rows);
  const map = host.find(file => file.name.endsWith(".map"))!;
  assert.equal(provinceBlocks(new TextDecoder().decode(map.data)).get(target.index)!.selector, "land");
  for (const native of player.filter(file => /\.(map|d6m)$/.test(file.name))) assert.deepEqual(native.data, host.find(file => file.name === native.name)!.data);
  assert.ok(!player.some(file => /json|host_|balance_report/.test(file.name)));
  assert.match(new TextDecoder().decode(host.find(file => file.name === "host_settings.txt")!.data), /pinned profile revision/);
  assert.match(new TextDecoder().decode(host.find(file => file.name === "host_settings.txt")!.data), /Declared host era: "Middle Age \(2\)"/);
  assert.match(new TextDecoder().decode(host.find(file => file.name === "balance_report.txt")!.data), /Declared host era: "Middle Age \(2\)"/);
  assert.match(new TextDecoder().decode(host.find(file => file.name === "host_topology.txt")!.data), /derived|Derived/);
  assert.equal(serializeProject(project), before);
  const absent = cloneProject(project); delete absent.populationDefense;
  const unchanged = await buildPackageFiles(absent, undefined, catalog, "host", rows);
  const disabled = cloneProject(absent); disabled.populationDefense = { enabled: false, profileRevision: revision };
  const disabledPackage = await buildPackageFiles(disabled, undefined, catalog, "host", rows);
  for (const file of unchanged.filter(file => file.name !== "atlas_project.json")) assert.deepEqual(disabledPackage.find(other => other.name === file.name)!.data, file.data, file.name);
  assert.deepEqual(host.find(file => file.name.endsWith(".d6m"))!.data, unchanged.find(file => file.name.endsWith(".d6m"))!.data);
  assert.ok(estimatedPackageBytes(project, catalog, rows) >= host.reduce((sum, file) => sum + file.data.byteLength, 0));
  assert.ok(estimatedTextPackageBytes(project, catalog, rows) > estimatedTextPackageBytes(project, catalog, []), "derived groups require their own native text budget");
});

test("native inspection forwards catalog and recipe copy states the current-export effect", () => {
  const { project, plane, catalog } = fixture();
  const source = readFileSync(new URL("../src/NativeInspectionPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /compileMapText\(project,project\.planes\.findIndex\(p=>p\.id===planeId\),catalog\)/);
  const html = renderToStaticMarkup(createElement(IterationPanel, { project, planeId: plane.id, catalog, busy: false, onCommit: () => true, onHighlight: () => undefined }));
  assert.match(html, /Defender policies and host patch\/mod declarations affect current exports immediately/);
});
