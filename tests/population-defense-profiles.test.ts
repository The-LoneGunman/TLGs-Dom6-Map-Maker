import assert from "node:assert/strict";
import test from "node:test";
import { protectedStartProvinceKeys } from "../src/authoringLocks";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "../src/catalog";
import { cloneProject, isBlockedProvince, isCaveProvince, isWaterProvince, type MapProject, type Province } from "../src/domain";
import { compileMapText, validateProject } from "../src/dom6";
import { parseProject, serializeProject } from "../src/export";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import { buildInitialDefensePlan, type InitialDefenseReason } from "../src/populationDefenders";
import { POPULATION_DEFENSE_PROFILE_REVISION, VERIFIED_POPULATION_DEFENSE_PROFILES } from "../src/populationDefenseProfiles";

// Real bundled data: native unmodded 6.37 recruitment inspection and an actual
// hosted initial-army trial verified this roster. These are not combat ratings.
const revision = "dom6-6.37-native-2026-09-21-v2";
const previousEmptyRevision = "dom6-6.37-native-2026-09-21-v1";
let input = createDefaultProject("verified-pop81-profile-regression", { generate: false });
input.settings.players = 2;
input.settings.provincesPerPlayer = 24;
input.settings.throneCount = 0;
input.settings.startDistribution = { land: 2, coastal: 0, water: 0, cave: 0, other: 0 };
input = addPlane(input, "cave", { generate: false, provinceTarget: 64, noGeneratedStarts: true });
input = addPlane(input, "hell", { generate: false, provinceTarget: 24, noGeneratedStarts: true });
const generated = generateProject(input);

function fixture() {
  const project = cloneProject(generated);
  project.populationDefense = { enabled: true, profileRevision: revision };
  project.analysisContext = { gameVersion: "6.37", era: 2, mods: "" };
  const protectedKeys = protectedStartProvinceKeys(project, 1);
  const plane = project.planes.find(p => p.kind === "cave")!;
  const target = plane.provinces.find(p => p.poptype === 81 && isCaveProvince(p) && !isWaterProvince(p)
    && !isBlockedProvince(p) && p.owner === undefined && !p.defenders.length && p.throne === "none"
    && !protectedKeys.has(`${plane.id}:${p.id}`));
  assert.ok(target, "the real generator must supply an eligible pop81; never inject a population to make this assertion pass");
  return { project, plane, target };
}

function plan(project: MapProject, catalog = BUILTIN_DOM6_CATALOG) {
  return buildInitialDefensePlan(project, catalog, project.populationDefense, VERIFIED_POPULATION_DEFENSE_PROFILES);
}

function nativeBlocks(text: string) {
  const header: string[] = [], blocks = new Map<number, string[]>();
  let current = header;
  for (const line of text.split(/\r?\n/)) {
    // This evidence comment describes the following block, not the previous one.
    if (line.startsWith("-- Population-matched initial defenders:")) continue;
    const selector = /^#(?:land|setland) (\d+)$/.exec(line);
    if (selector) { current = []; blocks.set(Number(selector[1]), current); }
    current.push(line);
  }
  return { header, blocks };
}

function disabled(project: MapProject) {
  const result = cloneProject(project);
  result.populationDefense!.enabled = false;
  return result;
}

test("the first real v2 profile pins the observed MA dry-cave roster and exact catalog identities", () => {
  assert.equal(POPULATION_DEFENSE_PROFILE_REVISION, revision);
  const rows = VERIFIED_POPULATION_DEFENSE_PROFILES.filter(p => p.revision === revision);
  assert.equal(rows.length, 1, "an immutable revision must not silently acquire additional army templates");
  const profile = rows[0]!;
  assert.deepEqual(profile.poptype, { id: 81, name: "Pale Ones", provenanceId: "illwinter-map-manual-6.26" });
  assert.equal(profile.gameVersion, "6.37");
  assert.equal(profile.mods, "");
  assert.deepEqual(profile.allowedEras, [2]);
  assert.deepEqual(profile.allowedMedia, ["dry"]);
  assert.equal(profile.caveRule, "required");
  assert.deepEqual(profile.groups, [{
    commander: { id: 1463, name: "Pale One Commander", provenanceId: "dom6inspector-6.37-c30c6c14" },
    squads: [{ unit: { id: 1465, name: "Pale One", provenanceId: "dom6inspector-6.37-c30c6c14" }, count: 15 }],
  }]);
  assert.ok(profile.source.title && profile.source.reference && profile.source.revision && profile.source.verification);
  assert.equal(VERIFIED_POPULATION_DEFENSE_PROFILES.filter(p => p.revision === previousEmptyRevision).length, 0);
});

test("naturally generated eligible Pale Ones derive the native-tested army without changing other province exports", () => {
  const { project, plane, target } = fixture();
  const sourceBefore = serializeProject(project), registryBefore = JSON.stringify(VERIFIED_POPULATION_DEFENSE_PROFILES);
  const resolved = plan(project), row = resolved.entries.get(`${plane.id}:${target.id}`)!;
  assert.equal(row.status, "derived");
  assert.deepEqual(row.groups, [{ commander: "1463", squads: [{ id: "poptype-81-0-0", unit: "1465", count: 15 }] }]);
  assert.deepEqual(row.profile!.allowedEras, [2]);
  assert.ok(resolved.counts.derived > 0);
  assert.ok(resolved.counts.custom > 0, "also exercise generated special-plane guardians");
  assert.ok(resolved.counts.unsupported > 0, "other generated populations retain native armies");
  assert.deepEqual(validateProject(project).filter(issue => issue.severity === "error"), []);
  const withoutPolicy = disabled(project);
  for (const [index, currentPlane] of project.planes.entries()) {
    const enabledMap = nativeBlocks(compileMapText(project, index));
    const disabledMap = nativeBlocks(compileMapText(withoutPolicy, index));
    assert.deepEqual(enabledMap.header, disabledMap.header);
    for (const province of currentPlane.provinces) {
      const resolution = resolved.entries.get(`${currentPlane.id}:${province.id}`)!;
      const actual = enabledMap.blocks.get(province.index);
      if (resolution.status === "derived") {
        assert.equal(province.poptype, 81);
        assert.ok(isCaveProvince(province) && !isWaterProvince(province));
        assert.equal(actual?.[0], `#land ${province.index}`);
        assert.equal(actual.filter(line => line === "#commander 1463").length, 1);
        assert.equal(actual.filter(line => line === "#units 15 1465").length, 1);
        assert.deepEqual(province.defenders, [], "ordinary derived armies are never persisted as custom guardians");
      } else {
        assert.deepEqual(actual, disabledMap.blocks.get(province.index), `${currentPlane.name} #${province.index}`);
        if (resolution.status === "custom") assert.deepEqual(resolution.groups, province.defenders);
      }
    }
  }
  row.groups[0]!.squads[0]!.count = 1;
  assert.equal(serializeProject(project), sourceBefore);
  assert.equal(JSON.stringify(VERIFIED_POPULATION_DEFENSE_PROFILES), registryBefore);
  assert.equal(plan(project).entries.get(`${plane.id}:${target.id}`)!.groups[0]!.squads[0]!.count, 15);
});

test("manual population edits immediately drop unsupported automatic armies and restore pop81 without stale guardians", () => {
  const { project, plane, target } = fixture(), key = `${plane.id}:${target.id}`;
  target.poptype = 25;
  assert.equal(plan(project).entries.get(key)!.reason, "missing-profile");
  const index = project.planes.indexOf(plane);
  const actual = nativeBlocks(compileMapText(project, index)).blocks.get(target.index)!;
  assert.deepEqual(actual, nativeBlocks(compileMapText(disabled(project), index)).blocks.get(target.index));
  assert.equal(actual[0], `#setland ${target.index}`);
  assert.ok(!actual.some(line => /^#(?:commander|units) /.test(line)));
  delete target.poptype;
  assert.equal(plan(project).entries.get(key)!.reason, "no-poptype");
  target.poptype = 81;
  assert.equal(plan(project).entries.get(key)!.status, "derived");
  assert.deepEqual(target.defenders, []);
});

test("saved empty v1 policies remain unsupported instead of silently adopting the real v2 roster", () => {
  const { project, plane, target } = fixture();
  project.populationDefense!.profileRevision = previousEmptyRevision;
  const imported = parseProject(serializeProject(project));
  assert.equal(imported.populationDefense!.profileRevision, previousEmptyRevision);
  assert.equal(plan(imported).entries.get(`${plane.id}:${target.id}`)!.reason, "missing-profile");
  assert.equal(plan(imported).counts.derived, 0);
  for (let index = 0; index < imported.planes.length; index++) {
    assert.equal(compileMapText(imported, index), compileMapText(disabled(imported), index));
  }
});

const mismatches: Array<[string, InitialDefenseReason, (p: MapProject, c: Dom6CatalogBundle) => void]> = [
  ["unknown patch", "unknown-game-version", p => { delete p.analysisContext!.gameVersion; }],
  ["future patch", "game-version-mismatch", p => { p.analysisContext!.gameVersion = "6.38"; }],
  ["declared mods", "mods-mismatch", p => { p.analysisContext!.mods = "Modified populations v1"; }],
  ["unknown era", "unknown-era", p => { delete p.analysisContext!.era; }],
  ["Early Age", "era-mismatch", p => { p.analysisContext!.era = 1; }],
  ["Late Age", "era-mismatch", p => { p.analysisContext!.era = 3; }],
  ["changed unit identity", "catalog-mismatch", (_p, c) => { c.units.find(u => u.id === 1465)!.name = "Changed Pale One"; }],
  ["old catalog provenance", "catalog-mismatch", (_p, c) => { c.units.find(u => u.id === 1463)!.provenanceId = "dom6inspector-6.35-cfac4311"; }],
  ["changed population identity", "catalog-mismatch", (_p, c) => { c.poptypes.find(p => p.id === 81)!.name = "Changed population"; }],
];
for (const [label, reason, change] of mismatches) test(`the real roster fails closed for ${label}`, () => {
  const { project, plane, target } = fixture(), catalog = structuredClone(BUILTIN_DOM6_CATALOG);
  change(project, catalog);
  const row = plan(project, catalog).entries.get(`${plane.id}:${target.id}`)!;
  assert.equal(row.status, "unsupported");
  assert.equal(row.reason, reason);
  assert.deepEqual(row.groups, []);
  const withoutPolicy = disabled(project);
  for (let index = 0; index < project.planes.length; index++) {
    assert.equal(compileMapText(project, index, catalog), compileMapText(withoutPolicy, index, catalog));
  }
  assert.equal(validateProject(project, catalog).filter(issue => issue.severity === "warning" && /Population-matched initial defenders:/.test(issue.message)).length, 1);
});

test("the real profile follows effective cave and water flags rather than the underground plane label", () => {
  const cases: Array<[string, (p: Province) => void, InitialDefenseReason]> = [
    ["dry ordinary terrain", p => { p.terrain = "plains"; p.terrainFlags = []; }, "terrain-mismatch"],
    ["cave with added sea", p => { p.terrain = "cave"; p.terrainFlags = ["sea"]; }, "terrain-mismatch"],
    ["sea with added cave", p => { p.terrain = "sea"; p.terrainFlags = ["cave"]; }, "terrain-mismatch"],
    ["deep sea with added cave", p => { p.terrain = "deepsea"; p.terrainFlags = ["cave"]; }, "terrain-mismatch"],
    ["solid cave wall", p => { p.terrain = "cavewall"; p.terrainFlags = []; }, "blocked"],
  ];
  for (const [label, change, reason] of cases) {
    const { project, plane, target } = fixture();
    change(target);
    const row = plan(project).entries.get(`${plane.id}:${target.id}`)!;
    assert.equal(row.reason, reason, label);
    assert.deepEqual(row.groups, []);
    const index = project.planes.indexOf(plane);
    assert.deepEqual(nativeBlocks(compileMapText(project, index)).blocks.get(target.index),
      nativeBlocks(compileMapText(disabled(project), index)).blocks.get(target.index), label);
  }
  const { project, plane, target } = fixture();
  target.terrain = "plains"; target.terrainFlags = ["cave"];
  assert.equal(plan(project).entries.get(`${plane.id}:${target.id}`)!.status, "derived", "manual cave flags are effective terrain");
});

test("real-profile derivation preserves authored groups and never adds troops at starts or gateway start neighbors", () => {
  const { project, plane, target } = fixture(), key = `${plane.id}:${target.id}`;
  target.defenders = [{ commander: "1463", commanderName: "Authored Pale One", experience: 4,
    squads: [{ id: "authored-squad", unit: "1465", count: 7 }] }];
  const customBefore = structuredClone(target.defenders), index = project.planes.indexOf(plane);
  assert.equal(plan(project).entries.get(key)!.status, "custom");
  assert.deepEqual(plan(project).entries.get(key)!.groups, customBefore);
  assert.deepEqual(nativeBlocks(compileMapText(project, index)).blocks.get(target.index),
    nativeBlocks(compileMapText(disabled(project), index)).blocks.get(target.index));
  assert.deepEqual(target.defenders, customBefore);
  for (const startKind of ["generic", "team", "specific", "gateway"] as const) {
    const { project: p, plane: layer, target: province } = fixture();
    if (startKind === "generic") province.start = true;
    if (startKind === "team") province.teamStart = 0;
    if (startKind === "specific") p.specificStarts.push({ nation: 60, planeId: layer.id, provinceId: province.id });
    if (startKind === "gateway") {
      const surface = p.planes[0]!, start = surface.provinces.find(v => v.start)!;
      p.gates.push({ id: "real-profile-start-gate", gateNumber: Math.max(0, ...p.gates.map(g => g.gateNumber)) + 1,
        endpoints: [{ planeId: surface.id, provinceId: start.id }, { planeId: layer.id, provinceId: province.id }] });
    }
    const row = plan(p).entries.get(`${layer.id}:${province.id}`)!;
    assert.equal(row.reason, "protected-start", startKind);
    assert.deepEqual(row.groups, []);
    const planeIndex = p.planes.indexOf(layer);
    assert.deepEqual(nativeBlocks(compileMapText(p, planeIndex)).blocks.get(province.index),
      nativeBlocks(compileMapText(disabled(p), planeIndex)).blocks.get(province.index), startKind);
  }
});
