import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BUILTIN_DOM6_CATALOG, findCatalogEntry, type Dom6CatalogBundle } from "../src/catalog";
import recruitment from "../src/catalog/data/population-recruitment-6.37.json";
import { cloneProject, effectiveProvinceTerrainFlags, type MapProject, type Province, type ProvinceDefense, type TerrainFlag } from "../src/domain";
import { compileMapText, compileTextFiles, validateProject } from "../src/dom6";
import { buildPackageFiles, parseProject, serializeProject } from "../src/export";
import { createDefaultProject } from "../src/generator";
import { buildInitialDefensePlan, type InitialDefenseReason, type PopulationDefenseIdentity, type VerifiedPopulationDefenseProfile } from "../src/populationDefenders";
import { POPULATION_DEFENSE_PROFILE_REVISION, VERIFIED_POPULATION_DEFENSE_PROFILES } from "../src/populationDefenseProfiles";

// These tests check the bundled registry's static consistency and application
// behavior. They cannot establish native recruitment, leadership, survival,
// combat difficulty or persistent PD; those require separately reviewed evidence.
const revision = "dom6-6.37-native-2026-09-21-v3";
const oldRevision = "dom6-6.37-native-2026-09-21-v2";
const emptyRevision = "dom6-6.37-native-2026-09-21-v1";
const currentRows = VERIFIED_POPULATION_DEFENSE_PROFILES.filter(profile => profile.revision === revision);
const unsupportedPopulations = [43, 44, 72, 88, 105, 106];
const membership = new Map(recruitment.populations.map(population => [population.poptype, population]));
const extractedNames = new Map(recruitment.identities.map(identity => [identity.id, identity.name]));
type Scope = { medium: "dry" | "water"; cave: boolean };

function scopes(profile: VerifiedPopulationDefenseProfile): Scope[] {
  const caves = profile.caveRule === "required" ? [true] : profile.caveRule === "forbidden" ? [false] : [false, true];
  return profile.allowedMedia.flatMap(medium => caves.map(cave => ({ medium, cave })));
}

function expectedGroups(profile: VerifiedPopulationDefenseProfile): ProvinceDefense[] {
  return profile.groups.map((group, groupIndex) => ({
    commander: String(group.commander.id),
    squads: group.squads.map((squad, squadIndex) => ({
      id: `poptype-${profile.poptype.id}-${groupIndex}-${squadIndex}`, unit: String(squad.unit.id), count: squad.count,
    })),
  }));
}

function fixture(profile: VerifiedPopulationDefenseProfile = currentRows[0]!, scope = profile && scopes(profile)[0]!) {
  assert.ok(profile && scope, "The integrated v3 registry must contain accepted profiles before running this suite.");
  const project = createDefaultProject("population-defense-v3-regression", { generate: false });
  project.settings.players = 2;
  project.settings.provincesPerPlayer = 12;
  project.settings.startDistribution = { land: 2, coastal: 0, water: 0, cave: 0, other: 0 };
  project.settings.startDegreeTarget = 2;
  project.settings.throneCount = 0;
  project.settings.waterPercent = 0;
  project.settings.siteFrequency = 0;
  project.targetVersion = 637;
  project.analysisContext = { gameVersion: "6.37", era: 2, mods: "" };
  project.populationDefense = { enabled: true, profileRevision: revision };
  const plane = project.planes[0]!;
  plane.id = "v3-plane";
  plane.autoSize = false;
  plane.provinceTarget = 24;
  plane.width = plane.height = 256;
  plane.wrapX = plane.wrapY = false;
  plane.provinces = Array.from({ length: 24 }, (_, offset): Province => ({
    id: `v3-province-${offset + 1}`, index: offset + 1,
    x: ((offset % 6) + 0.5) / 6, y: (Math.floor(offset / 6) + 0.5) / 4,
    gridX: offset % 6, gridY: Math.floor(offset / 6), name: `Regression province ${offset + 1}`,
    biome: "heartland", terrain: "plains", terrainFlags: [], freshwater: false,
    small: false, large: false, noStart: offset !== 0 && offset !== 23,
    manySites: false, warmer: false, colder: false, siteBias: [], start: offset === 0 || offset === 23,
    throne: "none", sites: [], killRandomSites: false, temple: false, lab: false,
    defenders: [], battle: {}, rawDirectives: "",
  }));
  plane.edges = plane.provinces.flatMap((province, offset) => [
    ...(offset % 6 < 5 ? [{ id: `east-${offset}`, a: province.id, b: plane.provinces[offset + 1]!.id, kind: "standard" as const }] : []),
    ...(offset < 18 ? [{ id: `south-${offset}`, a: province.id, b: plane.provinces[offset + 6]!.id, kind: "standard" as const }] : []),
  ]);
  const target = plane.provinces[8]!;
  target.poptype = profile.poptype.id;
  // Additive flags must work even when the visual primary remains plains.
  target.terrainFlags = [...(scope.medium === "water" ? ["sea" as const] : []), ...(scope.cave ? ["cave" as const] : [])];
  return { project, plane, target, key: `${plane.id}:${target.id}` };
}

function plan(project: MapProject, catalog = BUILTIN_DOM6_CATALOG) {
  return buildInitialDefensePlan(project, catalog, project.populationDefense, VERIFIED_POPULATION_DEFENSE_PROFILES);
}

function disabled(project: MapProject) {
  const result = cloneProject(project);
  result.populationDefense!.enabled = false;
  return result;
}

function nativeBlocks(text: string) {
  const header: string[] = [], blocks = new Map<number, string[]>();
  let current = header;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("-- Population-matched initial defenders:")) continue;
    const selector = /^#(?:land|setland) (\d+)$/.exec(line);
    if (selector) { current = []; blocks.set(Number(selector[1]), current); }
    current.push(line);
  }
  return { header, blocks };
}

function assertIdentity(collection: "units" | "poptypes", identity: PopulationDefenseIdentity) {
  const actual = findCatalogEntry(BUILTIN_DOM6_CATALOG[collection], identity.id);
  assert.ok(actual, `${collection} identity ${identity.id} is missing`);
  assert.deepEqual({ id: actual.id, name: actual.name, provenanceId: actual.provenanceId }, identity);
  if (collection === "units") assert.equal(extractedNames.get(identity.id), identity.name);
}

test("v3 is the current revision without adding armies to historical v1 or changing the immutable v2 roster", () => {
  assert.equal(POPULATION_DEFENSE_PROFILE_REVISION, revision);
  assert.equal(currentRows.length, 76, "the immutable accepted v3 revision must not silently gain or lose army templates");
  assert.equal(new Set(currentRows.map(profile => profile.poptype.id)).size, currentRows.length);
  assert.equal(VERIFIED_POPULATION_DEFENSE_PROFILES.filter(profile => profile.revision === emptyRevision).length, 0);
  assert.deepEqual(VERIFIED_POPULATION_DEFENSE_PROFILES.filter(profile => profile.revision === oldRevision), [{
    revision: oldRevision,
    poptype: { id: 81, name: "Pale Ones", provenanceId: "illwinter-map-manual-6.26" },
    gameVersion: "6.37", mods: "", allowedEras: [2], allowedMedia: ["dry"], caveRule: "required",
    source: {
      title: "Native 6.37 Middle Age recruitment and initial-army check",
      reference: "docs/research/POPULATION_RECRUITMENT_EVIDENCE_2026-09-21.md",
      revision: "native-6.37-r21-pop81 + Inspector c30c6c14e18ab284415d599b81579af9b3070112",
      verification: "Recruitment observed under MA Ulm in an unmodded dry Cave with poptype 81. Native export created commander 1463 and a squad of 15 troop 1465; a scripted turn completed leadership validation. Fixed counts, not calibrated combat difficulty. Other eras, non-cave terrain and underwater recruitment are not verified.",
    },
    groups: [{
      commander: { id: 1463, name: "Pale One Commander", provenanceId: "dom6inspector-6.37-c30c6c14" },
      squads: [{ unit: { id: 1465, name: "Pale One", provenanceId: "dom6inspector-6.37-c30c6c14" }, count: 15 }],
    }],
  }]);
});

test("the complete accepted v3 snapshot is immutable, including army counts, scope and evidence", () => {
  // Saved maps pin this entire reviewed snapshot, not just the population count.
  // A later correction or expansion must introduce a new revision and preserve
  // these v3 rows; updating this digest in place would hide a compatibility change.
  const orderedRows = [...currentRows].sort((left, right) => left.poptype.id - right.poptype.id);
  const digest = createHash("sha256").update(JSON.stringify(orderedRows)).digest("hex");
  assert.equal(digest, "57cd092efc947ef018088f64bf7e933eef3d919e92f9d0f52ef44b392cc538f3",
    "The bundled v3 snapshot changed. Introduce a new profile revision instead of silently altering saved v3 policies.");
});

test("every accepted v3 army joins exact catalog identities and static recruitment categories with bounded fixed troops", () => {
  assert.equal(recruitment.gameVersion, "6.37");
  assert.ok(currentRows.length > 0);
  for (const profile of currentRows) {
    const roster = membership.get(profile.poptype.id);
    assert.ok(roster, `No static membership row for population ${profile.poptype.id}`);
    assert.equal(profile.gameVersion, "6.37");
    assert.equal(profile.mods, "");
    assert.deepEqual(profile.allowedEras, [2], `population ${profile.poptype.id} must retain its verified era scope`);
    assertIdentity("poptypes", profile.poptype);
    assert.ok(profile.groups.length > 0);
    let troopCount = 0;
    for (const group of profile.groups) {
      assertIdentity("units", group.commander);
      assert.ok(roster.commanderIds.includes(group.commander.id), `population ${profile.poptype.id} cannot recruit commander ${group.commander.id}`);
      assert.ok(group.squads.length > 0);
      for (const squad of group.squads) {
        assertIdentity("units", squad.unit);
        assert.ok(roster.troopIds.includes(squad.unit.id), `population ${profile.poptype.id} cannot recruit troop ${squad.unit.id}`);
        assert.ok(Number.isSafeInteger(squad.count) && squad.count > 0);
        troopCount += squad.count;
      }
    }
    assert.ok(troopCount <= 15, `population ${profile.poptype.id} exceeds the accepted fixed troop-count cap`);
    assert.ok(profile.source.title && profile.source.reference && profile.source.revision && profile.source.verification);
    assert.ok(!unsupportedPopulations.includes(profile.poptype.id), `population ${profile.poptype.id} is not release-accepted`);
  }
});

for (const profile of currentRows) for (const scope of scopes(profile)) {
  test(`v3 population ${profile.poptype.id} derives exact groups in ${scope.medium} ${scope.cave ? "Cave" : "non-Cave"} without source edits`, () => {
    const { project, plane, target, key } = fixture(profile, scope);
    const before = serializeProject(project), registryBefore = JSON.stringify(VERIFIED_POPULATION_DEFENSE_PROFILES);
    const resolved = plan(project), row = resolved.entries.get(key)!;
    assert.deepEqual(resolved.counts, { derived: 1, custom: 0, excluded: plane.provinces.length - 1, unsupported: 0 });
    assert.equal(row.reason, "verified-template");
    assert.deepEqual(row.groups, expectedGroups(profile));
    assert.equal(row.profile?.revision, revision);
    assert.deepEqual(row.profile?.allowedEras, [2]);
    const flags: TerrainFlag[] = [...(scope.medium === "water" ? ["sea" as const] : []), ...(scope.cave ? ["cave" as const] : [])];
    assert.deepEqual([...effectiveProvinceTerrainFlags(target)].sort(), flags.sort());
    assert.deepEqual(validateProject(project).filter(issue => issue.severity === "error"), []);
    const native = nativeBlocks(compileMapText(project, 0));
    const original = nativeBlocks(compileMapText(disabled(project), 0));
    assert.deepEqual(native.header, original.header);
    const block = native.blocks.get(target.index)!;
    assert.equal(block[0], `#land ${target.index}`);
    assert.deepEqual(block.filter(line => /^#(?:poptype|commander|units)\b/.test(line)), [
      `#poptype ${profile.poptype.id}`,
      ...profile.groups.flatMap(group => [`#commander ${group.commander.id}`, ...group.squads.map(squad => `#units ${squad.count} ${squad.unit.id}`)]),
    ]);
    for (const province of plane.provinces.filter(province => province !== target)) {
      assert.deepEqual(native.blocks.get(province.index), original.blocks.get(province.index), `unrelated province ${province.index}`);
    }
    row.groups[0]!.squads[0]!.count = 999;
    assert.deepEqual(target.defenders, []);
    assert.equal(serializeProject(project), before);
    assert.equal(JSON.stringify(VERIFIED_POPULATION_DEFENSE_PROFILES), registryBefore);
    assert.deepEqual(plan(project).entries.get(key)!.groups, expectedGroups(profile), "derived groups must be detached copies");
  });
}

test("unclaimed medium/Cave combinations retain native armies for every accepted population", () => {
  for (const profile of currentRows) for (const medium of ["dry", "water"] as const) for (const cave of [false, true]) {
    if (scopes(profile).some(scope => scope.medium === medium && scope.cave === cave)) continue;
    const { project, target, key } = fixture(profile, { medium, cave });
    const row = plan(project).entries.get(key)!;
    assert.equal(row.status, "unsupported");
    assert.equal(row.reason, "terrain-mismatch");
    assert.deepEqual(row.groups, []);
    assert.equal(compileMapText(project, 0), compileMapText(disabled(project), 0));
    assert.deepEqual(target.defenders, []);
  }
});

test("commander-less, empty and held mount/transformation populations never receive automatic armies", () => {
  for (const poptype of unsupportedPopulations) {
    assert.ok(!currentRows.some(profile => profile.poptype.id === poptype), `unexpected accepted profile ${poptype}`);
    for (const medium of ["dry", "water"] as const) for (const cave of [false, true]) {
      const { project, target, key } = fixture(undefined, { medium, cave });
      target.poptype = poptype;
      const row = plan(project).entries.get(key)!;
      assert.equal(row.reason, "missing-profile", `population ${poptype}, ${medium}, Cave=${cave}`);
      assert.deepEqual(row.groups, []);
      assert.equal(compileMapText(project, 0), compileMapText(disabled(project), 0));
    }
  }
});

test("manual population changes immediately select a different accepted army and never persist derived custom groups", () => {
  const pair = currentRows.flatMap(first => scopes(first).flatMap(scope => {
    const second = currentRows.find(candidate => candidate.poptype.id !== first.poptype.id
      && JSON.stringify(candidate.groups) !== JSON.stringify(first.groups)
      && scopes(candidate).some(other => other.medium === scope.medium && other.cave === scope.cave));
    return second ? [{ first, second, scope }] : [];
  }))[0];
  assert.ok(pair, "the accepted subset must include two distinct armies in a shared terrain scope");
  const { project, target, key } = fixture(pair.first, pair.scope);
  assert.deepEqual(plan(project).entries.get(key)!.groups, expectedGroups(pair.first));
  const initialText = compileMapText(project, 0);
  target.poptype = pair.second.poptype.id;
  const beforeSecond = serializeProject(project);
  assert.deepEqual(plan(project).entries.get(key)!.groups, expectedGroups(pair.second));
  assert.notEqual(compileMapText(project, 0), initialText);
  assert.equal(serializeProject(project), beforeSecond);
  target.poptype = 44;
  assert.equal(plan(project).entries.get(key)!.reason, "missing-profile");
  assert.equal(compileMapText(project, 0), compileMapText(disabled(project), 0));
  delete target.poptype;
  assert.equal(plan(project).entries.get(key)!.reason, "no-poptype");
  target.poptype = pair.first.poptype.id;
  assert.equal(compileMapText(project, 0), initialText);
  assert.deepEqual(target.defenders, []);
});

test("old saved policies do not adopt the new v3 rows or scope automatically", () => {
  const { project, target, key } = fixture();
  for (const previous of [emptyRevision, oldRevision]) {
    project.populationDefense!.profileRevision = previous;
    target.poptype = 25;
    const restored = parseProject(serializeProject(project));
    assert.equal(restored.populationDefense!.profileRevision, previous);
    assert.equal(plan(restored).entries.get(key)!.reason, "missing-profile");
    assert.equal(compileMapText(restored, 0), compileMapText(disabled(restored), 0));
  }
  project.populationDefense!.profileRevision = oldRevision;
  target.poptype = 81;
  target.terrainFlags = ["cave"];
  const preserved = plan(parseProject(serializeProject(project))).entries.get(key)!;
  assert.equal(preserved.status, "derived");
  assert.deepEqual(preserved.groups, [{ commander: "1463", squads: [{ id: "poptype-81-0-0", unit: "1465", count: 15 }] }]);
  target.terrainFlags = ["cave", "sea"];
  assert.equal(plan(project).entries.get(key)!.reason, "terrain-mismatch");
});

const exclusions: Array<[string, InitialDefenseReason, (project: MapProject, province: Province) => void]> = [
  ["generic start", "protected-start", (_project, province) => { province.start = true; }],
  ["team-zero start", "protected-start", (_project, province) => { province.teamStart = 0; }],
  ["specific start", "protected-start", (project, province) => {
    project.specificStarts.push({ nation: 60, planeId: project.planes[0]!.id, provinceId: province.id });
  }],
  ["direct start neighbor", "protected-start", (project, province) => {
    const plane = project.planes[0]!;
    plane.edges.push({ id: "direct-capital-neighbor", a: plane.provinces[0]!.id, b: province.id, kind: "impassable" });
  }],
  ["gateway start neighbor", "protected-start", (project, province) => {
    const plane = project.planes[0]!, other = structuredClone(plane);
    other.id = "v3-gateway-plane";
    other.provinces.forEach(value => { delete value.poptype; });
    project.planes.push(other);
    project.gates.push({ id: "v3-start-gate", gateNumber: 1, direction: "reverse", endpoints: [
      { planeId: other.id, provinceId: other.provinces[0]!.id }, { planeId: plane.id, provinceId: province.id },
    ] });
  }],
  ...[0, 2, 4, 60].map(owner => [`owner ${owner}`, "owned", (_project: MapProject, province: Province) => { province.owner = owner; }] as typeof exclusions[number]),
  ["guardian lock", "guardian-lock", (_project, province) => { province.editorLocks = ["guardians"]; }],
  ["blocked terrain", "blocked", (_project, province) => { province.terrainFlags = ["cavewall"]; }],
  ["preferred throne", "throne", (_project, province) => { province.throne = "preferred"; }],
  ["fixed throne", "throne", (_project, province) => { province.throne = "fixed"; province.fixedThrone = "Test-only throne label"; }],
  ["catalog throne site", "throne", (_project, province) => {
    const throne = BUILTIN_DOM6_CATALOG.sites.find(site => site.tags?.includes("throne"));
    assert.ok(throne);
    province.sites.push({ id: "v3-throne-site", value: String(throne.id), known: true });
  }],
];
for (const [label, reason, change] of exclusions) test(`v3 preserves the existing exclusion for ${label}`, () => {
  const { project, target, key } = fixture();
  change(project, target);
  const before = serializeProject(project), row = plan(project).entries.get(key)!;
  assert.equal(row.status, "excluded");
  assert.equal(row.reason, reason);
  assert.deepEqual(row.groups, []);
  for (let index = 0; index < project.planes.length; index++) assert.equal(compileMapText(project, index), compileMapText(disabled(project), index));
  assert.equal(serializeProject(project), before);
});

test("custom guardians remain authoritative even with v3, raw directives, protected starts and invalid host declarations", () => {
  const { project, target, key } = fixture();
  target.defenders = [{ commander: "1463", commanderName: "Unchanged authored guardian", clearMagic: true, experience: 4,
    squads: [{ id: "authored-v3-regression", unit: "1465", count: 7 }],
    bodyguard: "1465", bodyguardCount: 2, randomEquipment: 1, items: ["Skull Staff"], magic: { death: 1 } }];
  target.start = true;
  target.editorLocks = ["guardians"];
  target.owner = 60;
  project.rawDirectives = "-- custom guardian preservation regression";
  project.analysisContext = { gameVersion: "unknown", era: 1, mods: "Changed host content" };
  const before = serializeProject(project), expected = structuredClone(target.defenders);
  const row = plan(project).entries.get(key)!;
  assert.equal(row.status, "custom");
  assert.equal(row.reason, "custom-preserved");
  assert.deepEqual(row.groups, expected);
  assert.equal(compileMapText(project, 0), compileMapText(disabled(project), 0));
  row.groups[0]!.squads[0]!.count = 999;
  row.groups[0]!.items!.push("not a source item");
  assert.deepEqual(target.defenders, expected);
  assert.equal(serializeProject(project), before);
});

test("raw directives anywhere suppress all v3 automatic armies while retaining authored armies", () => {
  for (const scope of ["project", "plane", "province"] as const) {
    const { project, plane, target, key } = fixture(), other = structuredClone(plane);
    other.id = "v3-raw-other-plane";
    other.provinces.forEach(province => { delete province.poptype; });
    project.planes.push(other);
    const custom = plane.provinces[12]!;
    custom.defenders = [{ commander: "1463", squads: [{ id: "kept-custom", unit: "1465", count: 7 }] }];
    if (scope === "project") project.rawDirectives = "#setland 9";
    if (scope === "plane") other.rawDirectives = "#setland 9";
    if (scope === "province") other.provinces[10]!.rawDirectives = "#setland 9";
    const before = serializeProject(project), result = plan(project);
    assert.equal(result.counts.derived, 0);
    assert.equal(result.entries.get(key)!.reason, `${scope}-raw`);
    assert.deepEqual(result.entries.get(`${plane.id}:${custom.id}`)!.groups, custom.defenders);
    assert.deepEqual(target.defenders, []);
    for (let index = 0; index < project.planes.length; index++) assert.equal(compileMapText(project, index), compileMapText(disabled(project), index));
    assert.equal(serializeProject(project), before);
  }
});

const mismatches: Array<[string, InitialDefenseReason, (project: MapProject, catalog: Dom6CatalogBundle) => void]> = [
  ["absent host context", "unknown-game-version", project => { delete project.analysisContext; }],
  ["unknown patch", "unknown-game-version", project => { delete project.analysisContext!.gameVersion; }],
  ["future patch", "game-version-mismatch", project => { project.analysisContext!.gameVersion = "6.38"; }],
  ["older patch", "game-version-mismatch", project => { project.analysisContext!.gameVersion = "6.36"; }],
  ["unknown era", "unknown-era", project => { delete project.analysisContext!.era; }],
  ["Early Age", "era-mismatch", project => { project.analysisContext!.era = 1; }],
  ["Late Age", "era-mismatch", project => { project.analysisContext!.era = 3; }],
  ["declared mod mismatch", "mods-mismatch", project => { project.analysisContext!.mods = "Population-changing mod"; }],
  ["changed commander name", "catalog-mismatch", (_project, catalog) => { catalog.units.find(unit => unit.id === currentRows[0]!.groups[0]!.commander.id)!.name = "Reassigned commander ID"; }],
  ["stale troop provenance", "catalog-mismatch", (_project, catalog) => { catalog.units.find(unit => unit.id === currentRows[0]!.groups[0]!.squads[0]!.unit.id)!.provenanceId = "dom6inspector-6.35-cfac4311"; }],
  ["changed population name", "catalog-mismatch", (_project, catalog) => { catalog.poptypes.find(population => population.id === currentRows[0]!.poptype.id)!.name = "Reassigned population ID"; }],
];
for (const [label, reason, change] of mismatches) test(`v3 fails closed for ${label} without substituting map/catalog patch metadata`, () => {
  const { project, target, key } = fixture(), catalog = structuredClone(BUILTIN_DOM6_CATALOG);
  change(project, catalog);
  const before = serializeProject(project), row = plan(project, catalog).entries.get(key)!;
  assert.equal(row.status, "unsupported");
  assert.equal(row.reason, reason);
  assert.deepEqual(row.groups, []);
  assert.equal(compileMapText(project, 0, catalog), compileMapText(disabled(project), 0, catalog));
  assert.deepEqual(target.defenders, []);
  assert.equal(serializeProject(project), before);
});

test("absent and disabled v3 policies produce identical native and host support files regardless of bundled registry coverage", async () => {
  const { project, plane } = fixture();
  const custom = plane.provinces[12]!;
  custom.defenders = [{ commander: "1463", squads: [{ id: "unchanged-authored", unit: "1465", count: 7 }] }];
  const baseline = cloneProject(project);
  delete baseline.populationDefense;
  const off = disabled(project);
  const before = serializeProject(off);
  assert.deepEqual(compileTextFiles(off), compileTextFiles(baseline));
  assert.deepEqual(compileTextFiles(off, BUILTIN_DOM6_CATALOG, []), compileTextFiles(baseline));
  const withoutPolicy = await buildPackageFiles(baseline);
  const disabledPolicy = await buildPackageFiles(off);
  assert.deepEqual(disabledPolicy.map(file => file.name), withoutPolicy.map(file => file.name));
  for (const file of withoutPolicy.filter(file => file.name !== "atlas_project.json")) {
    assert.deepEqual(disabledPolicy.find(other => other.name === file.name)!.data, file.data, file.name);
  }
  assert.equal(serializeProject(off), before);
  assert.deepEqual(plan(off).counts, { custom: 1, derived: 0, excluded: plane.provinces.length - 1, unsupported: 0 });
});
