import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogTemplate, type Dom6CatalogBundle } from "../src/catalog";
import { cloneProject, type MapProject, type Province } from "../src/domain";
import { compileMapText } from "../src/dom6";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import {
  buildInitialDefensePlan, POPULATION_DEFENSE_LIMITS,
  type InitialDefenseReason, type PopulationDefenseIdentity, type PopulationDefensePolicy,
  type VerifiedPopulationDefenseProfile,
} from "../src/populationDefenders";

// Deliberately fictional test catalog and rosters. These are NOT vanilla poptype mappings.
const identity = (id: number, name: string): PopulationDefenseIdentity => ({ id, name, provenanceId: "fixture-only" });
const populationA = identity(25, "Fixture population A");
const populationB = identity(26, "Fixture population B");
const commanderA = identity(501, "Fixture commander A");
const commanderB = identity(502, "Fixture commander B");
const troopA = identity(601, "Fixture troop A");
const troopB = identity(602, "Fixture troop B");
const enabled: PopulationDefensePolicy = { enabled: true, profileRevision: "fixture-rosters-v1" };

function catalog(): Dom6CatalogBundle {
  const result = createCatalogTemplate("6.35");
  result.catalogVersion = "test-only";
  result.provenance = [{ id: "fixture-only", title: "Synthetic test records", authority: "user" }];
  result.poptypes = [populationA, populationB].map(value => ({ ...value }));
  result.units = [commanderA, commanderB, troopA, troopB].map(value => ({ ...value }));
  result.sites = [
    { ...identity(701, "Fixture throne"), aliases: ["Fixture throne alias"], tags: ["throne"] },
    identity(702, "Fixture ordinary site"),
  ];
  return result;
}

function profile(second = false): VerifiedPopulationDefenseProfile {
  return {
    revision: enabled.profileRevision,
    poptype: { ...(second ? populationB : populationA) },
    gameVersion: "6.37", mods: "", allowedMedia: ["dry"], caveRule: "any",
    source: {
      title: "Synthetic regression fixture only", reference: "test://population-defenders",
      revision: "test-data-v1", verification: "Not game evidence; synthetic identities exercise resolver safety only.",
    },
    groups: [{ commander: { ...(second ? commanderB : commanderA) }, squads: [
      { unit: { ...(second ? troopB : troopA) }, count: second ? 13 : 18 },
    ] }],
  };
}

function province(index: number): Province {
  return {
    id: `p${index}`, index, x: index / 10, y: 0.5, gridX: index, gridY: 0,
    name: `Province ${index}`, biome: "heartland", terrain: "plains", small: false, large: false,
    noStart: false, manySites: false, warmer: false, colder: false, siteBias: [], start: false,
    throne: "none", sites: [], killRandomSites: false, temple: false, lab: false,
    defenders: [], battle: {}, rawDirectives: "", poptype: populationA.id,
  };
}

function project(): MapProject {
  const result = createDefaultProject("population-defenders-unit-fixture", { generate: false });
  result.analysisContext = { gameVersion: "6.37", mods: "" };
  result.planes[0]!.id = "plane1";
  result.planes[0]!.width = result.planes[0]!.height = 256;
  result.planes[0]!.provinces = [province(1), province(2), province(3)];
  result.planes[0]!.edges = [];
  return result;
}

function first(result = project(), rows = [profile()], activeCatalog = catalog(), policy: PopulationDefensePolicy | undefined = enabled) {
  return buildInitialDefensePlan(result, activeCatalog, policy, rows).entries.get("plane1:p1")!;
}

test("an absent/disabled policy preserves original groups and native source bytes without any registry", () => {
  const source = project();
  const before = JSON.stringify(source), native = compileMapText(source, 0);
  for (const policy of [undefined, { ...enabled, enabled: false }]) {
    const plan = buildInitialDefensePlan(source, catalog(), policy);
    assert.deepEqual(plan.counts, { custom: 0, derived: 0, excluded: 3, unsupported: 0 });
    assert.ok([...plan.entries.values()].every(row => row.reason === "disabled" && row.groups.length === 0));
  }
  assert.equal(JSON.stringify(source), before);
  assert.equal(compileMapText(source, 0), native);
  assert.equal(buildInitialDefensePlan(source, catalog(), enabled).entries.get("plane1:p1")!.reason, "missing-profile");
});

test("disabled policies do not inspect catalogs, profile collections or raw-directive contents", () => {
  const source = project();
  Object.defineProperty(source, "rawDirectives", { get: () => { throw new Error("unnecessary raw scan"); } });
  Object.defineProperty(source, "analysisContext", { get: () => { throw new Error("unnecessary host-era scan"); } });
  const unusedCatalog = new Proxy({} as Dom6CatalogBundle, { get: () => { throw new Error("unnecessary catalog scan"); } });
  const unusedProfiles = new Proxy([] as VerifiedPopulationDefenseProfile[], { get: () => { throw new Error("unnecessary profile scan"); } });
  for (const policy of [undefined, { ...enabled, enabled: false }]) {
    const plan = buildInitialDefensePlan(source, unusedCatalog, policy, unusedProfiles);
    assert.equal(plan.counts.excluded, 3);
  }
});

test("derived fixed templates are deterministic numeric-only groups and carry their evidence snapshot", () => {
  const source = project(), data = profile(), active = catalog();
  const before = JSON.stringify([source, active, enabled, data]);
  const result = first(source, [data], active);
  assert.equal(result.status, "derived");
  assert.equal(result.reason, "verified-template");
  assert.deepEqual(result.groups, [{ commander: "501", squads: [{ id: "poptype-25-0-0", unit: "601", count: 18 }] }]);
  assert.equal(result.profile!.revision, enabled.profileRevision);
  assert.equal(result.profile!.source.verification, data.source.verification);
  assert.match(result.message, /not calibrated/);
  assert.deepEqual(first(source, [data], active), result);
  assert.equal(JSON.stringify([source, active, enabled, data]), before);
  assert.deepEqual(buildInitialDefensePlan(source, active, enabled, [data]).counts, { custom: 0, derived: 3, excluded: 0, unsupported: 0 });
});

test("manual poptype edits immediately select the matching pinned template without modifying source guardians", () => {
  const source = project(), rows = [profile(), profile(true)], current = source.planes[0]!.provinces[0]!;
  assert.equal(first(source, rows).groups[0]!.commander, "501");
  current.poptype = populationB.id;
  assert.equal(first(source, rows).groups[0]!.commander, "502");
  assert.equal(first(source, rows).groups[0]!.squads[0]!.count, 13);
  assert.deepEqual(current.defenders, []);
  delete current.poptype;
  assert.equal(first(source, rows).reason, "no-poptype");
  current.poptype = 27;
  assert.equal(first(source, rows).reason, "missing-profile");
});

test("every field of a custom force is retained even when automatic derivation would be excluded", () => {
  const source = project(), current = source.planes[0]!.provinces[0]!;
  current.start = true; current.owner = 5; current.editorLocks = ["guardians"]; current.throne = "preferred";
  source.rawDirectives = "#setland 1";
  current.defenders = [{
    commander: "Unlisted custom commander", commanderName: "Authored leader", clearMagic: true,
    squads: [{ id: "authored-squad", unit: "Unlisted custom unit", count: 33 }],
    bodyguard: "Custom guard", bodyguardCount: 3, experience: 4, randomEquipment: 2,
    items: ["Custom item"], magic: { fire: 2, holy: 1 },
  }];
  const before = JSON.stringify(source), native = compileMapText(source, 0), groups = JSON.stringify(current.defenders);
  for (const policy of [enabled, undefined, { ...enabled, enabled: false }]) {
    const result = buildInitialDefensePlan(source, catalog(), policy, []).entries.get("plane1:p1")!;
    assert.equal(result.status, "custom");
    assert.equal(result.reason, "custom-preserved");
    assert.equal(JSON.stringify(result.groups), groups);
    result.groups[0]!.squads[0]!.count = 999;
    result.groups[0]!.items!.push("not a source edit");
  }
  assert.equal(JSON.stringify(source), before);
  assert.equal(compileMapText(source, 0), native);
});

test("actual generated guardian records receive the same custom-preservation rule", () => {
  let input = createDefaultProject("generated-population-guardian-preservation", { generate: false });
  input.settings.players = 2; input.settings.provincesPerPlayer = 12; input.settings.throneCount = 0;
  input.settings.startDistribution = { land: 2, coastal: 0, water: 0, cave: 0, other: 0 };
  input = addPlane(input, "hell", { generate: false });
  const source = generateProject(input), before = JSON.stringify(source), native = compileMapText(source, 0);
  const guards = source.planes.flatMap(plane => plane.provinces.filter(p => p.defenders.length).map(p => ({ plane, p })));
  assert.ok(guards.length > 0, "fixture must exercise generated guardians");
  const plan = buildInitialDefensePlan(source, catalog(), enabled, []);
  for (const { plane, p } of guards) {
    const result = plan.entries.get(`${plane.id}:${p.id}`)!;
    assert.equal(result.status, "custom");
    assert.equal(JSON.stringify(result.groups), JSON.stringify(p.defenders));
  }
  assert.equal(JSON.stringify(source), before);
  assert.equal(compileMapText(source, 0), native);
});

test("generic, team-zero, and nation-specific starts protect exactly the direct one-ring", () => {
  for (const startKind of ["generic", "team", "specific"] as const) {
    const source = project(), plane = source.planes[0]!;
    if (startKind === "generic") plane.provinces[0]!.start = true;
    if (startKind === "team") plane.provinces[0]!.teamStart = 0;
    if (startKind === "specific") source.specificStarts = [{ nation: 5, planeId: plane.id, provinceId: "p1" }];
    plane.edges = [{ id: "e1", a: "p1", b: "p2", kind: "impassable" }, { id: "e2", a: "p2", b: "p3", kind: "standard" }];
    const plan = buildInitialDefensePlan(source, catalog(), enabled, [profile()]);
    assert.equal(plan.entries.get("plane1:p1")!.reason, "protected-start", startKind);
    assert.equal(plan.entries.get("plane1:p2")!.reason, "protected-start", startKind);
    assert.equal(plan.entries.get("plane1:p3")!.status, "derived", startKind);
  }
});

test("gateway one-ring protection crosses planes bidirectionally but does not spread an extra hop", () => {
  const source = project(), plane = source.planes[0]!;
  plane.provinces[0]!.teamStart = 0;
  const other = structuredClone(plane); other.id = "plane2"; other.provinces.forEach(p => { delete p.teamStart; });
  other.edges = [{ id: "other-e1", a: "p1", b: "p2", kind: "standard" }];
  source.planes.push(other);
  source.gates = [{ id: "gate", gateNumber: 1, direction: "reverse", endpoints: [
    { planeId: "plane1", provinceId: "p1" }, { planeId: "plane2", provinceId: "p1" },
  ] }];
  const plan = buildInitialDefensePlan(source, catalog(), enabled, [profile()]);
  assert.equal(plan.entries.get("plane1:p1")!.reason, "protected-start");
  assert.equal(plan.entries.get("plane2:p1")!.reason, "protected-start");
  assert.equal(plan.entries.get("plane2:p2")!.status, "derived");
});

test("locked, owned, blocked, throne and raw-directive scopes never receive automatic armies", () => {
  const cases: [InitialDefenseReason, (source: MapProject, current: Province) => void][] = [
    ["guardian-lock", (_s, p) => { p.editorLocks = ["guardians"]; }],
    ...[0, 2, 4, 5].map(owner => ["owned", (_s: MapProject, p: Province) => { p.owner = owner; }] as typeof cases[number]),
    ["blocked", (_s, p) => { p.terrain = "cavewall"; }],
    ["blocked", (_s, p) => { p.terrainFlags = ["cavewall"]; }],
    ["throne", (_s, p) => { p.throne = "preferred"; }],
    ["throne", (_s, p) => { p.throne = "fixed"; p.fixedThrone = "unknown throne"; }],
    ["throne", (_s, p) => { p.sites = [{ id: "site", value: "701", known: false }]; }],
    ["throne", (_s, p) => { p.sites = [{ id: "site", value: "Fixture throne alias", known: true }]; }],
    ["project-raw", s => { s.rawDirectives = "#setland 2\n#commander 501"; }],
    ["plane-raw", s => { s.planes[0]!.rawDirectives = "-- conservative even for comments"; }],
    ["province-raw", (_s, p) => { p.rawDirectives = "#units 10 601"; }],
  ];
  for (const [expected, change] of cases) {
    const source = project(); change(source, source.planes[0]!.provinces[0]!);
    const before = JSON.stringify(source), result = first(source);
    assert.equal(result.status, "excluded", expected); assert.equal(result.reason, expected);
    assert.deepEqual(result.groups, []); assert.equal(JSON.stringify(source), before);
  }
  const allowed = project(), current = allowed.planes[0]!.provinces[0]!;
  current.editorLocks = ["economy", "terrain"]; current.throne = "avoid";
  current.sites = [{ id: "site", value: "702", known: true }]; current.rawDirectives = " \n ";
  assert.equal(first(allowed).status, "derived");
});

test("raw commands in a different province or plane suppress every automatic army without touching custom guardians", () => {
  for (const scope of ["province", "plane", "project"] as const) {
    const source = project(), other = structuredClone(source.planes[0]!);
    other.id = "plane2"; source.planes.push(other);
    const guarded = source.planes[0]!.provinces[2]!;
    guarded.defenders = [{ commander: "Authored commander", squads: [{ id: "authored", unit: "Authored troop", count: 4 }] }];
    if (scope === "province") other.provinces[2]!.rawDirectives = "#setland 1\n#commander 502";
    if (scope === "plane") other.rawDirectives = "#setland 1\n#commander 502";
    if (scope === "project") source.rawDirectives = "#setland 1\n#commander 502";
    const before = JSON.stringify(source), native = source.planes.map((_, i) => compileMapText(source, i));
    const plan = buildInitialDefensePlan(source, catalog(), enabled, [profile()]);
    assert.deepEqual(plan.counts, { custom: 1, derived: 0, excluded: 5, unsupported: 0 });
    assert.equal(plan.entries.get("plane1:p1")!.reason, `${scope}-raw`);
    assert.match(plan.entries.get("plane1:p1")!.message, /anywhere in the atlas/);
    assert.deepEqual(plan.entries.get("plane1:p3")!.groups, guarded.defenders);
    assert.equal(JSON.stringify(source), before);
    assert.deepEqual(source.planes.map((_, i) => compileMapText(source, i)), native);
  }
});

test("effective Sea and Cave flags, rather than plane labels or primary terrain alone, constrain templates", () => {
  const cases: [Partial<Province>, VerifiedPopulationDefenseProfile["allowedMedia"], VerifiedPopulationDefenseProfile["caveRule"], boolean][] = [
    [{ terrain: "plains" }, ["dry"], "any", true],
    [{ terrain: "freshwater" }, ["dry"], "forbidden", true],
    [{ terrain: "plains", terrainFlags: ["deep"] }, ["dry"], "any", true],
    [{ terrain: "plains", terrainFlags: ["sea"] }, ["dry"], "any", false],
    [{ terrain: "forest", terrainFlags: ["sea"] }, ["water"], "any", true],
    [{ terrain: "sea" }, ["water"], "forbidden", true],
    [{ terrain: "deepsea" }, ["dry"], "any", false],
    [{ terrain: "caveforest" }, ["dry"], "required", true],
    [{ terrain: "plains", terrainFlags: ["cave"] }, ["dry"], "forbidden", false],
    [{ terrain: "plains" }, ["dry"], "required", false],
    [{ terrain: "sea", terrainFlags: ["cave"] }, ["water"], "required", true],
    [{ terrain: "cave", terrainFlags: ["sea"] }, ["dry"], "required", false],
    [{ terrain: "cave", terrainFlags: ["sea"] }, ["water"], "forbidden", false],
    [{ terrain: "cave", terrainFlags: ["sea"] }, ["dry", "water"], "any", true],
  ];
  for (const [terrain, allowedMedia, caveRule, compatible] of cases) {
    const source = project(), data = profile();
    Object.assign(source.planes[0]!.provinces[0]!, terrain); data.allowedMedia = allowedMedia; data.caveRule = caveRule;
    assert.equal(first(source, [data]).reason, compatible ? "verified-template" : "terrain-mismatch", JSON.stringify([terrain, allowedMedia, caveRule]));
  }
});

test("profiles require an explicit matching host patch and mod declaration, not map or catalog versions", () => {
  const source = project(), data = profile();
  delete source.analysisContext;
  assert.equal(first(source, [data]).reason, "unknown-game-version");
  source.targetVersion = 637; const currentCatalog = catalog(); currentCatalog.gameVersion = "6.37";
  assert.equal(first(source, [data], currentCatalog).reason, "unknown-game-version");
  source.analysisContext = { gameVersion: "6.38", mods: "" };
  assert.equal(first(source, [data]).reason, "game-version-mismatch");
  source.analysisContext = { gameVersion: "6.37", mods: "Host Mod v2" };
  assert.equal(first(source, [data]).reason, "mods-mismatch");
  data.mods = "Host Mod v2";
  assert.equal(first(source, [data]).status, "derived");
  source.analysisContext.gameVersion = " 6.37 "; source.analysisContext.mods = " Host Mod v2 ";
  assert.equal(first(source, [data]).status, "derived");
});

test("era-restricted profiles require an explicit matching host era without inferring it from nations", () => {
  const source = project(), data = profile();
  data.allowedEras = [2];
  source.allowedPlayers = [50, 60]; // MA nations are not a host-era declaration.
  assert.equal(first(source, [data]).reason, "unknown-era");
  assert.equal(source.analysisContext!.era, undefined);
  for (const era of [1, 3] as const) {
    source.analysisContext!.era = era;
    const result = first(source, [data]);
    assert.equal(result.status, "unsupported");
    assert.equal(result.reason, "era-mismatch");
    assert.match(result.message, /native armies are retained/);
    assert.deepEqual(result.groups, []);
  }
  for (const era of [null, "2", 0, 4, 1.5]) {
    Object.assign(source.analysisContext!, { era });
    assert.equal(first(source, [data]).reason, "unknown-era", JSON.stringify(era));
  }
  source.analysisContext!.era = 2;
  const before = JSON.stringify([source, data]), result = first(source, [data]);
  assert.equal(result.status, "derived");
  assert.deepEqual(result.profile!.allowedEras, [2]);
  assert.notEqual(result.profile!.allowedEras, data.allowedEras);
  (result.profile!.allowedEras as number[])[0] = 1;
  assert.deepEqual(first(source, [data]).profile!.allowedEras, [2]);
  assert.equal(JSON.stringify([source, data]), before);
});

test("omitted era restrictions retain compatibility and declared multi-era scopes match exactly", () => {
  const source = project(), data = profile();
  assert.equal(first(source, [data]).status, "derived");
  for (const era of [1, 2, 3] as const) {
    source.analysisContext!.era = era;
    assert.equal(first(source, [data]).status, "derived");
  }
  data.allowedEras = [1, 3];
  for (const era of [1, 2, 3] as const) {
    source.analysisContext!.era = era;
    assert.equal(first(source, [data]).reason, era === 2 ? "era-mismatch" : "verified-template");
  }
  delete source.analysisContext!.era;
  source.planes[0]!.provinces[0]!.defenders = [{ commander: "Custom", squads: [{ id: "custom", unit: "Custom troop", count: 2 }] }];
  const before = JSON.stringify(source);
  assert.equal(first(source, [data]).reason, "custom-preserved");
  assert.equal(JSON.stringify(source), before);
});

test("malformed, empty, duplicate or sparse profile era scopes fail closed", () => {
  const sparseEras = Object.assign(new Array<number>(3), { 0: 1, 2: 3 });
  for (const allowedEras of [null, "2", [], [2, 2], [0], [4], [1.5], ["2"], [1, 2, 3, 2], sparseEras]) {
    const data = profile();
    Object.assign(data, { allowedEras });
    const result = first(project(), [data]);
    assert.equal(result.reason, "invalid-profile", JSON.stringify(allowedEras));
    assert.match(result.message, /era scope/);
    assert.deepEqual(result.groups, []);
  }
});

test("active catalog identities must match exactly, including provenance, without disabling unrelated additions", () => {
  const changes: ((active: Dom6CatalogBundle) => void)[] = [
    c => { c.poptypes[0]!.name = "Different population"; },
    c => { c.poptypes[0]!.provenanceId = "another-source"; },
    c => { c.poptypes = []; },
    c => { c.units[0]!.name = "Different commander"; },
    c => { c.units[0]!.provenanceId = "same-name-custom-replacement"; },
    c => { c.units[2]!.name = "Different troop"; },
    c => { c.units[2]!.provenanceId = "another-source"; },
    c => { c.units = c.units.filter(unit => unit.id !== troopA.id); },
    c => { c.units.push({ ...c.units[0]! }); },
    c => { c.poptypes.push({ ...c.poptypes[0]! }); },
    c => { c.units[0]!.aliases = [commanderA.name]; c.units[0]!.name = "An alias is not an exact identity"; },
  ];
  for (const change of changes) {
    const active = catalog(); change(active);
    assert.equal(first(project(), [profile()], active).reason, "catalog-mismatch");
  }
  const extended = catalog(); extended.units.push(identity(603, "Unrelated addition")); extended.catalogVersion += " + addon";
  assert.equal(first(project(), [profile()], extended).status, "derived");
});

test("invalid numeric references, missing evidence, unknown fields and unsafe template sizes fail closed", () => {
  const changes: ((data: VerifiedPopulationDefenseProfile) => void)[] = [
    p => { p.poptype.name = ""; }, p => { p.poptype.provenanceId = ""; },
    p => { p.groups[0]!.commander.id = 0; }, p => { p.groups[0]!.commander.id = NaN; },
    p => { p.groups[0]!.commander.id = 1.5; }, p => { p.groups[0]!.commander.id = 1_000_001; },
    p => { p.groups[0]!.squads[0]!.unit.id = Infinity; },
    p => { p.groups[0]!.squads[0]!.count = 0; }, p => { p.groups[0]!.squads[0]!.count = -1; },
    p => { p.groups[0]!.squads[0]!.count = 1.5; }, p => { p.groups[0]!.squads[0]!.count = NaN; },
    p => { p.groups[0]!.squads[0]!.count = 1001; },
    p => { Object.assign(p.groups[0]!.squads[0]!, { count: "10" }); },
    p => { p.groups = []; }, p => { p.groups[0]!.squads = []; },
    p => { p.source.verification = ""; }, p => { p.source.reference = ""; },
    p => { p.gameVersion = ""; }, p => { p.mods = " Mod with trailing whitespace "; },
    p => { p.allowedMedia = []; }, p => { p.allowedMedia = ["dry", "dry"]; },
    p => { Object.assign(p, { caveRule: null }); },
    p => { p.source.title = "Injected\n#commander 1"; },
    p => { Object.assign(p.groups[0]!, { experience: 900 }); },
    p => { Object.assign(p.groups[0]!.commander, { id: "501" }); },
    p => { p.groups = Array.from({ length: POPULATION_DEFENSE_LIMITS.groups + 1 }, () => structuredClone(p.groups[0]!)); },
    p => { p.groups[0]!.squads = Array.from({ length: POPULATION_DEFENSE_LIMITS.squadsPerGroup + 1 }, () => structuredClone(p.groups[0]!.squads[0]!)); },
    p => { p.groups[0]!.squads = [{ unit: troopA, count: 1000 }, { unit: troopB, count: 1000 }]; },
  ];
  for (const [index, change] of changes.entries()) {
    const data = profile(); change(data);
    const result = first(project(), [data]);
    assert.equal(result.status, "unsupported", `invalid case ${index}`);
    assert.equal(result.reason, "invalid-profile", `invalid case ${index}`);
    assert.deepEqual(result.groups, []);
  }
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    const source = project(); source.planes[0]!.provinces[0]!.poptype = id;
    assert.equal(first(source).reason, "invalid-poptype");
  }
});

test("ambiguous revisions and oversized profile collections never select a convenient first match", () => {
  const data = profile();
  assert.equal(first(project(), [data, structuredClone(data)]).reason, "ambiguous-profile");
  data.revision = "fixture-rosters-v2";
  assert.equal(first(project(), [data]).reason, "missing-profile");
  const rows = Array.from({ length: POPULATION_DEFENSE_LIMITS.profiles + 1 }, () => profile());
  assert.equal(first(project(), rows).reason, "invalid-profiles");
  assert.equal(first(project(), [profile()], catalog(), { ...enabled, profileRevision: "" }).reason, "invalid-policy");
  assert.equal(first(project(), [profile()], catalog(), { ...enabled, enabled: "yes" } as unknown as PopulationDefensePolicy).reason, "invalid-policy");
});

test("template limits include commanders and returned plans do not share mutable arrays with sources or one another", () => {
  const source = project(), data = profile(), active = catalog();
  data.groups[0]!.squads = [{ unit: troopA, count: 1000 }, { unit: troopB, count: 999 }];
  const before = JSON.stringify([source, data, active]);
  freeze(source); freeze(data); freeze(active); freeze(enabled);
  const plan = buildInitialDefensePlan(source, active, enabled, [data]);
  const one = plan.entries.get("plane1:p1")!, two = plan.entries.get("plane1:p2")!;
  assert.equal(one.status, "derived");
  one.groups[0]!.squads[0]!.count = 1;
  one.profile!.source.verification = "changed result only";
  assert.equal(two.groups[0]!.squads[0]!.count, 1000);
  assert.equal(two.profile!.source.verification, data.source.verification);
  assert.equal(JSON.stringify([source, data, active]), before);
  assert.equal(JSON.stringify(cloneProject(source)), JSON.stringify(source));
});

function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}
