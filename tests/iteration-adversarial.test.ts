import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProject, generateProject } from "../src/generator";
import { cloneProject, effectiveProvinceTerrainFlags, type MapProject, type Plane, type Province, type ProvinceDefense, type ProvinceLockGroup } from "../src/domain";
import { protectedStartProvinceKeys, restoreGenerationLocks, snapshotWithLocks } from "../src/authoringLocks";
import { newBlockingIssues, previewBatchEdit, previewContentReroll, protectedProvinceKeys } from "../src/iteration";
import { applyPlaneContentPreferences, applyPlaneRoutePreferences, assertPlaneGenerationOverrides, preferredDryTerrain } from "../src/generationControls";
import { serializeProject } from "../src/export";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";

const baseline = createDefaultProject("iteration-adversarial-sep20");
const defense = (): ProvinceDefense => ({ commander: "34", squads: [{ id: "squad-audit", unit: "38", count: 20 }] });
function neutralProject() {
  const project = cloneProject(baseline);
  const plane = project.planes[0]!;
  const protectedKeys = protectedProvinceKeys(project, 2);
  const province = plane.provinces.find(p => !protectedKeys.has(`${plane.id}:${p.id}`))!;
  assert.ok(province);
  province.start = false;
  province.defenders = [defense()];
  province.throne = "preferred";
  return { project, plane, province };
}

/** Small structural fixture; its graph is intentional and is not exported as a map. */
function gatewayFixture(): MapProject {
  const project = cloneProject(baseline);
  const template = project.planes[0]!;
  const makePlane = (id: string, count: number): Plane => {
    const provinces: Province[] = Array.from({ length: count }, (_, index) => ({
      ...structuredClone(template.provinces[index]!), id: `${id}-${index}`, index: index + 1,
      start: false, teamStart: undefined, noStart: false, startType: undefined,
      terrain: "plains", terrainFlags: undefined, freshwater: false, defenders: [],
      throne: "none", fixedThrone: undefined, manySites: false, editorLocks: undefined,
    }));
    return { ...structuredClone(template), id, name: id, provinces,
      edges: provinces.slice(1).map((p, index) => ({ id: `${id}-edge-${index}`, a: provinces[index]!.id, b: p.id, kind: "standard" })) };
  };
  project.planes = [makePlane("alpha", 2), makePlane("beta", 3)];
  project.planes[0]!.provinces[0]!.start = true;
  project.specificStarts = [];
  project.gates = [{ id: "cross-plane", gateNumber: 1, direction: "forward", endpoints: [
    { planeId: "alpha", provinceId: "alpha-0" }, { planeId: "beta", provinceId: "beta-0" },
  ] }];
  return project;
}

test("field-lock snapshots reject stale or malformed selections without mutating the source", () => {
  const { project, plane, province } = neutralProject();
  const before = serializeProject(project);
  for (const ids of [[], [province.id, province.id], ["missing"]]) {
    assert.throws(() => snapshotWithLocks(project, plane.id, ids, ["terrain"], true), /selected provinces/i);
  }
  for (const groups of [[], ["terrain", "terrain"], ["not-a-lock"]]) {
    assert.throws(() => snapshotWithLocks(project, plane.id, [province.id], groups as ProvinceLockGroup[], true), /field-lock groups/i);
  }
  assert.equal(serializeProject(project), before);
});

for (const lock of ["guardians", "sites"] as const) for (const mode of ["primary", "flag"] as const) {
  test(`${mode} cave-wall conversion cannot bypass the ${lock} field lock`, () => {
    const { project, plane, province } = neutralProject();
    province.editorLocks = [lock];
    const before = serializeProject(project);
    const preview = previewBatchEdit(project, plane.id, [province.id], mode === "primary"
      ? { kind: "terrain", terrain: "cavewall" }
      : { kind: "flag", flag: "cavewall", enabled: true });
    assert.equal(preview.changed, 0);
    assert.equal(preview.locked, 1);
    assert.equal(serializeProject(preview.project), before);
    assert.equal(serializeProject(project), before);
  });
}

test("batch flag materialization preserves unrelated effective terrain and authored content", () => {
  const { project, plane, province } = neutralProject();
  province.terrain = "farm";
  province.terrainFlags = ["cave"];
  province.freshwater = true;
  const preview = previewBatchEdit(project, plane.id, [province.id], { kind: "flag", flag: "forest", enabled: true });
  const next = preview.project.planes[0]!.provinces.find(p => p.id === province.id)!;
  assert.deepEqual([...effectiveProvinceTerrainFlags(next)].sort(), ["cave", "farm", "forest", "freshwater"]);
  assert.deepEqual(next.defenders, province.defenders);
  assert.equal(next.throne, province.throne);
  assert.equal(preview.changed, 1);
});

test("start protection follows bidirectional gateways and all authored start types at bounded depth", () => {
  const project = gatewayFixture();
  assert.deepEqual([...protectedStartProvinceKeys(project, 0)], ["alpha:alpha-0"]);
  assert.deepEqual([...protectedProvinceKeys(project, 1)].sort(), ["alpha:alpha-0", "alpha:alpha-1", "beta:beta-0"]);
  assert.ok(protectedProvinceKeys(project, 2).has("beta:beta-1"));
  assert.ok(!protectedProvinceKeys(project, 2).has("beta:beta-2"));
  project.planes[0]!.provinces[0]!.start = false;
  project.planes[1]!.provinces[0]!.teamStart = 0;
  assert.ok(protectedProvinceKeys(project, 1).has("alpha:alpha-0"));
  delete project.planes[1]!.provinces[0]!.teamStart;
  project.specificStarts.push({ nation: 5, planeId: "beta", provinceId: "beta-0" });
  assert.ok(protectedProvinceKeys(project, 1).has("alpha:alpha-0"));
});

test("explicit guardian and reward preferences exclude start rings across gateways", () => {
  const project = gatewayFixture(), plane = project.planes[1]!;
  // Baseline archetype details can already exist when generated gateways are linked.
  for (const p of plane.provinces) { p.defenders = [defense()]; p.manySites = true; }
  plane.generationOverrides = { guardianCoveragePercent: 80, manySitesPercent: 100 };
  applyPlaneContentPreferences(project, plane, () => defense());
  assert.equal(plane.provinces[0]!.defenders.length, 0, "gateway exit is one move from the capital");
  assert.equal(plane.provinces[1]!.defenders.length, 0, "gateway neighbor is two moves from the capital");
  assert.equal(plane.provinces[2]!.defenders.length, 1);
  assert.equal(plane.provinces[0]!.manySites, false);
  assert.equal(plane.provinces[1]!.manySites, true);
});

test("route preferences leave blocked terrain and existing special masks intact", () => {
  const project = gatewayFixture(), plane = project.planes[1]!;
  plane.generationOverrides = { roadPercent: 100 };
  plane.provinces[0]!.terrain = "cavewall";
  plane.edges[1]!.kind = "custom";
  plane.edges[1]!.special = 33;
  const before = structuredClone(plane.edges);
  applyPlaneRoutePreferences(project, plane);
  assert.deepEqual(plane.edges, before);
});

test("restoring locked guardians fails safely if a new start reaches them through a gateway", () => {
  const previous = gatewayFixture();
  previous.planes[0]!.provinces[0]!.start = false;
  previous.planes[1]!.provinces[1]!.defenders = [defense()];
  previous.planes[1]!.provinces[1]!.editorLocks = ["guardians"];
  const next = cloneProject(previous);
  next.planes[0]!.provinces[0]!.start = true;
  next.planes[1]!.provinces[1]!.defenders = [];
  assert.throws(() => restoreGenerationLocks(previous, next), /protected start zone/);
});

test("locked raw guardians and throne sites cannot bypass gateway-linked start protection", () => {
  const throne = BUILTIN_DOM6_CATALOG.sites.find(site => site.tags?.includes("throne"))!;
  assert.ok(throne);
  for (const group of ["guardians", "sites"] as const) {
    const previous = gatewayFixture();
    previous.planes[0]!.provinces[0]!.start = false;
    const target = previous.planes[1]!.provinces[0]!;
    target.editorLocks = [group];
    if (group === "guardians") target.rawDirectives = "#commander 34\n#units 20 38";
    else target.sites = [{ id: "hidden-throne", known: true, value: String(throne.id) }];
    const next = cloneProject(previous);
    next.planes[0]!.provinces[0]!.start = true;
    next.planes[1]!.provinces[0]!.rawDirectives = "";
    next.planes[1]!.provinces[0]!.sites = [];
    assert.throws(() => restoreGenerationLocks(previous, next), /protected start zone/);
  }
});

test("field locks explicitly reject seed changes that replace province identities", () => {
  const project = cloneProject(baseline);
  project.planes[0]!.provinces[0]!.editorLocks = ["name"];
  project.seed = "a-new-geography-seed";
  assert.throws(() => generateProject(project), /seed.*content-only reroll/);
});

test("renaming cannot turn an unchanged validation error into a new blocker", () => {
  const { project, plane, province } = neutralProject();
  province.fort = 999999;
  const renamed = cloneProject(project);
  renamed.planes[0]!.name = "Renamed realm";
  renamed.planes[0]!.provinces.find(p => p.id === province.id)!.name = "Renamed province";
  assert.deepEqual(newBlockingIssues(project, renamed), []);
  const other = renamed.planes[0]!.provinces.find(p => p.id !== province.id)!;
  other.fort = 999999;
  assert.ok(newBlockingIssues(project, renamed).some(issue => issue.planeId === plane.id && issue.provinceId === other.id));
});

test("additional copies of an existing blocker are still new blockers", () => {
  const { project, province } = neutralProject();
  province.defenders = [{ commander: "", squads: [] }];
  const worse = cloneProject(project);
  worse.planes[0]!.provinces.find(p => p.id === province.id)!.defenders.push({ commander: "", squads: [] });
  const added = newBlockingIssues(project, worse).filter(issue => /without a commander/.test(issue.message));
  assert.equal(added.length, 1);
});

test("scoped content rerolls honor explicit zero guardian and reward preferences", () => {
  const { project, plane } = neutralProject();
  plane.generationOverrides = { guardianCoveragePercent: 0, manySitesPercent: 0 };
  const safe = protectedProvinceKeys(project, 2);
  const ids = plane.provinces.filter(p => !safe.has(`${plane.id}:${p.id}`)).map(p => p.id);
  const guardians = previewContentReroll(project, plane.id, ids, "guardians", "zero-pools");
  assert.ok(guardians.project.planes[0]!.provinces.filter(p => ids.includes(p.id)).every(p => p.defenders.length === 0));
  const sites = previewContentReroll(project, plane.id, ids, "sites", "zero-rewards");
  assert.ok(sites.project.planes[0]!.provinces.filter(p => ids.includes(p.id)).every(p => !p.manySites));
});

test("scoped guardian multipliers change counts, not unit identity or unrelated fields", () => {
  const { project, plane } = neutralProject();
  const safe = protectedProvinceKeys(project, 2);
  const ids = plane.provinces.filter(p => !safe.has(`${plane.id}:${p.id}`)).map(p => p.id);
  plane.generationOverrides = { guardianCoveragePercent: 80, guardianRosterScale: 1 };
  const normal = previewContentReroll(project, plane.id, ids, "guardians", "fixed-guardians").project;
  plane.generationOverrides.guardianRosterScale = 2;
  const doubled = previewContentReroll(project, plane.id, ids, "guardians", "fixed-guardians").project;
  let compared = 0;
  for (const first of normal.planes[0]!.provinces.filter(p => ids.includes(p.id))) {
    const second = doubled.planes[0]!.provinces.find(p => p.id === first.id)!;
    assert.equal(first.population, second.population);
    assert.equal(first.terrain, second.terrain);
    for (let group = 0; group < first.defenders.length; group++) {
      assert.equal(second.defenders[group]!.commander, first.defenders[group]!.commander);
      for (let squad = 0; squad < first.defenders[group]!.squads.length; squad++) {
        const a = first.defenders[group]!.squads[squad]!, b = second.defenders[group]!.squads[squad]!;
        assert.equal(a.unit, b.unit);
        assert.equal(b.count, Math.min(1000, a.count * 2));
        compared++;
      }
    }
  }
  assert.ok(compared > 0);
});

test("inherited terrain preferences do not alter results and impossible cave weights fail explicitly", () => {
  const plane = structuredClone(baseline.planes[0]!);
  for (const controls of [undefined, {}, { terrainWeights: { plains: 1, forest: 1, farm: 1 } }]) {
    plane.generationOverrides = controls;
    for (const terrain of ["plains", "forest", "cave", "caveforest", "sea", "cavewall"] as const) {
      assert.equal(preferredDryTerrain(plane, terrain, .2, .3, "fixed"), terrain);
    }
  }
  plane.generationOverrides = { terrainWeights: { plains: 0, forest: 0, farm: 1, swamp: 0, waste: 0, highland: 0, mountains: 0 } };
  assert.doesNotThrow(() => assertPlaneGenerationOverrides(plane.generationOverrides));
  assert.throws(() => preferredDryTerrain(plane, "cave", .2, .3, "fixed"), /compatible with cave terrain/);
});
