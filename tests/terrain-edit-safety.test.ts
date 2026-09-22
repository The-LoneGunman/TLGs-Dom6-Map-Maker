import assert from "node:assert/strict";
import test from "node:test";
import { assertProjectLocks } from "../src/authoringLocks";
import { BUILTIN_DOM6_CATALOG, createCatalogTemplate, mergeCatalogBundles } from "../src/catalog";
import { cloneProject, effectiveProvinceTerrainFlags, isBlockedProvince, sanitizeMapName, type MapProject, type Province, type TerrainFlag, type TerrainKey } from "../src/domain";
import { compileMapText, encodeD6m, terrainMask, TERRAIN_BITS, validateProject } from "../src/dom6";
import { buildPackageFiles, installPackage, parseProject } from "../src/export";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import { imageProvinceNumbers, sampleIllustratedOwnership } from "../src/illustratedMap";
import { previewBatchEdit } from "../src/iteration";
import { provinceTerrainVisuals, terrainElevation } from "../src/terrainVisuals";
import { appendHistorySnapshot, applyAdditionalTerrainFlag, applyPrimaryTerrain } from "../src/uiWorkflow";

function baseline() {
  let project = createDefaultProject("terrain-edit-safety", { generate: false });
  Object.assign(project.settings, { players: 2, provincesPerPlayer: 12, throneCount: 0,
    startDistribution: { land: 2, coastal: 0, water: 0, cave: 0, other: 0 } });
  Object.assign(project.planes[0]!, { autoSize: false, provinceTarget: 24, width: 256, height: 256 });
  project = addPlane(project, "dream", { generate: false, autoSize: false, provinceTarget: 16, noGeneratedStarts: true });
  Object.assign(project.planes[1]!, { width: 256, height: 256, wrapX: false, wrapY: false });
  return generateProject(project);
}

const template = baseline();
const throne = BUILTIN_DOM6_CATALOG.sites.find(site => site.tags?.includes("throne"))!;
const ordinarySite = BUILTIN_DOM6_CATALOG.sites.find(site => site.id > 0 && !site.tags?.includes("throne"))!;

function fixture() {
  const project = cloneProject(template), plane = project.planes[1]!;
  const gateways = new Set(project.gates.flatMap(gate => gate.endpoints.filter(endpoint => endpoint.planeId === plane.id).map(endpoint => endpoint.provinceId)));
  const province = plane.provinces.find(province => !gateways.has(province.id))!;
  Object.assign(province, { terrain: "plains", terrainFlags: ["forest"], freshwater: true,
    start: false, startType: undefined, teamStart: undefined, noStart: false, throne: "none", fixedThrone: undefined,
    defenders: [], editorLocks: undefined, population: 12345, poptype: 27, unrest: 12, owner: 0, provinceDefense: 17,
    fort: BUILTIN_DOM6_CATALOG.forts.find(fort => fort.id > 0)!.id, temple: true, lab: true,
    sites: [{ id: "ordinary-site", value: String(ordinarySite.id), known: true },
      { id: "custom-site", value: "Uncatalogued Cartographer Shrine", known: false }],
    battle: { groundColor: "120 100 80" }, rawDirectives: "-- Keep this authored note", siteBias: ["air"], manySites: true });
  return { project, plane, province };
}

function addUnsafeContent(project: MapProject, planeId: string, province: Province) {
  Object.assign(province, { start: true, startType: "other", teamStart: 0, noStart: false,
    throne: "fixed", fixedThrone: String(throne.id),
    defenders: [{ commander: "614", squads: [{ id: "dangerous-guardian", unit: "205", count: 17 }] }] });
  province.sites.push({ id: "visible-throne", value: String(throne.id), known: true },
    { id: "hidden-throne", value: throne.name, known: false });
  project.specificStarts.push({ nation: 62, planeId, provinceId: province.id });
  project.specificStarts.push({ nation: 63, planeId: project.planes[0]!.id, provinceId: project.planes[0]!.provinces.find(p => p.start)!.id });
}

function preservedFields(province: Province) {
  const { id, index, x, y, gridX, gridY, name, nameSource, biome, small, large, warmer, colder, population, poptype,
    unrest, owner, provinceDefense, fort, temple, lab, battle, rawDirectives, siteBias, manySites, killRandomSites, freshwater } = province;
  return { id, index, x, y, gridX, gridY, name, nameSource, biome, small, large, warmer, colder, population, poptype,
    unrest, owner, provinceDefense, fort, temple, lab, battle, rawDirectives, siteBias, manySites, killRandomSites, freshwater };
}

function assertWallCleanup(project: MapProject, planeId: string, province: Province) {
  assert.ok(isBlockedProvince(province));
  assert.equal(province.noStart, true);
  assert.equal(province.start, false);
  assert.equal(province.startType, undefined);
  assert.equal(province.teamStart, undefined);
  assert.equal(province.throne, "none");
  assert.equal(province.fixedThrone, undefined);
  assert.deepEqual(province.defenders, []);
  assert.deepEqual(province.sites.map(site => site.id), ["ordinary-site", "custom-site"]);
  assert.equal(project.specificStarts.some(start => start.planeId === planeId && start.provinceId === province.id), false);
}

function applyWall(mode: "primary" | "additional", project: MapProject, planeId: string, provinceId: string) {
  return mode === "primary" ? applyPrimaryTerrain(project, planeId, provinceId, "cavewall")
    : applyAdditionalTerrainFlag(project, planeId, provinceId, "cavewall", true);
}

for (const mode of ["primary", "additional"] as const) {
  test(`${mode} Cave Wall atomically clears all starts, throne markers/sites and guardians without unrelated loss`, () => {
    const { project, plane, province } = fixture();
    addUnsafeContent(project, plane.id, province);
    const preserved = structuredClone(preservedFields(province));
    const otherStarts = structuredClone(project.specificStarts.filter(start => start.provinceId !== province.id));
    const surrounding = JSON.stringify(project.planes.map(p => ({ ...p, provinces: p.provinces.filter(v => v.id !== province.id) })));
    const gates = JSON.stringify(project.gates);
    assert.equal(applyWall(mode, project, plane.id, province.id), true);
    assertWallCleanup(project, plane.id, province);
    assert.deepEqual(preservedFields(province), preserved);
    assert.deepEqual(project.specificStarts, otherStarts);
    assert.equal(JSON.stringify(project.planes.map(p => ({ ...p, provinces: p.provinces.filter(v => v.id !== province.id) }))), surrounding);
    assert.equal(JSON.stringify(project.gates), gates);
    assert.ok(effectiveProvinceTerrainFlags(province).has("forest"), "an unrelated terrain flag survives either edit route");
  });

  test(`${mode} direct inspector edits retain the documented intentional field-lock override`, () => {
    const { project, plane, province } = fixture();
    addUnsafeContent(project, plane.id, province);
    province.editorLocks = ["terrain", "sites", "guardians"];
    assert.equal(applyWall(mode, project, plane.id, province.id), true);
    assertWallCleanup(project, plane.id, province);
    assert.deepEqual(province.editorLocks, ["terrain", "sites", "guardians"], "manual editing does not silently remove locks from future generation/batch edits");
  });

  test(`${mode} blocked-terrain cleanup and global start locks preserve the original and Undo snapshot on refusal`, () => {
    const { project, plane, province } = fixture();
    addUnsafeContent(project, plane.id, province);
    project.authoring = { lockStarts: true };
    const before = JSON.stringify(project), history = appendHistorySnapshot<MapProject>([], cloneProject(project));
    const draft = cloneProject(project);
    assert.equal(applyWall(mode, draft, plane.id, province.id), true);
    assert.throws(() => assertProjectLocks(project, draft), /Starts are locked/);
    assert.equal(JSON.stringify(project), before, "the failed UI commit must not mutate the live original");
    assert.equal(JSON.stringify(history[0]), before, "Undo retains the full pre-edit feature/start state");
  });

  for (const lock of ["terrain", "sites", "guardians"] as const) {
    test(`${mode} batch conversion respects the ${lock} lock without partially clearing content`, () => {
      const { project, plane, province } = fixture();
      province.throne = "fixed"; province.fixedThrone = String(throne.id);
      province.sites.push({ id: "locked-throne", value: String(throne.id), known: true });
      province.defenders = [{ commander: "614", squads: [{ id: "locked-guardian", unit: "205", count: 17 }] }];
      province.editorLocks = [lock];
      const before = JSON.stringify(project);
      const preview = previewBatchEdit(project, plane.id, [province.id], mode === "primary"
        ? { kind: "terrain", terrain: "cavewall" } : { kind: "flag", flag: "cavewall", enabled: true });
      assert.equal(preview.changed, 0);
      assert.equal(preview.locked, 1);
      assert.equal(JSON.stringify(preview.project), before);
      assert.equal(JSON.stringify(project), before);
    });
  }
}

test("a primary edit retaining an added Cave Wall flag still performs complete safety cleanup", () => {
  const { project, plane, province } = fixture();
  addUnsafeContent(project, plane.id, province);
  province.terrainFlags = ["cavewall"];
  assert.equal(applyPrimaryTerrain(project, plane.id, province.id, "forest"), true);
  assertWallCleanup(project, plane.id, province);
  assert.equal(province.terrain, "forest");
});

test("the shared additional-flag helper preserves normal edits and handles stale selections safely", () => {
  const { project, plane, province } = fixture();
  const before = JSON.stringify(project);
  assert.equal(applyAdditionalTerrainFlag(project, "missing-plane", province.id, "farm", true), false);
  assert.equal(applyAdditionalTerrainFlag(project, plane.id, "missing-province", "farm", true), false);
  assert.equal(applyPrimaryTerrain(project, plane.id, "missing-province", "cavewall"), false);
  assert.equal(JSON.stringify(project), before);
  assert.equal(applyAdditionalTerrainFlag(project, plane.id, province.id, "farm", true), true);
  assert.equal(applyAdditionalTerrainFlag(project, plane.id, province.id, "farm", true), true);
  assert.equal(province.terrainFlags!.filter(flag => flag === "farm").length, 1);
  assert.ok(effectiveProvinceTerrainFlags(province).has("forest"));
  assert.equal(applyAdditionalTerrainFlag(project, plane.id, province.id, "farm", false), true);
  assert.equal(JSON.stringify(project), before, "removing a temporary ordinary flag restores every unrelated field");
});

test("active custom-catalog throne sites are cleaned without guessing that an unknown site is a throne", () => {
  const custom = createCatalogTemplate("6.37");
  custom.sites = [{ id: 900001, name: "Test Constellation Throne", tags: ["throne"], provenanceId: custom.provenance[0]!.id }];
  const catalog = mergeCatalogBundles(BUILTIN_DOM6_CATALOG, custom);
  for (const mode of ["primary", "additional"] as const) {
    const { project, plane, province } = fixture();
    province.sites.push({ id: "custom-throne-id", value: "900001", known: true },
      { id: "custom-throne-name", value: "Test Constellation Throne", known: false },
      { id: "unknown-throne-sounding", value: "Unknown Throne-Shaped Arch", known: false });
    if (mode === "primary") applyPrimaryTerrain(project, plane.id, province.id, "cavewall", catalog);
    else applyAdditionalTerrainFlag(project, plane.id, province.id, "cavewall", true, catalog);
    assert.deepEqual(province.sites.map(site => site.id), ["ordinary-site", "custom-site", "unknown-throne-sounding"]);
  }
});

test("wall conversion preserves raw authored commands for explicit review instead of silently deleting them", () => {
  for (const mode of ["primary", "additional"] as const) {
    const { project, plane, province } = fixture();
    const raw = `-- Authored scenario\n#commander 614\n#units 17 205\n#feature ${throne.id}`;
    province.rawDirectives = raw;
    assert.equal(applyWall(mode, project, plane.id, province.id), true);
    assert.equal(province.rawDirectives, raw);
    assert.ok(validateProject(project).some(issue => issue.severity === "error" && issue.provinceId === province.id
      && /guardian|defender|throne/i.test(issue.message)), "preserved unsafe raw commands must remain visibly blocked");
  }
});

test("batch removal of an inherent flag preserves the complete remaining cave/swamp mask", () => {
  const { project, plane, province } = fixture();
  province.terrain = "caveforest";
  province.terrainFlags = ["swamp"];
  const before = JSON.stringify(project);
  const preview = previewBatchEdit(project, plane.id, [province.id], { kind: "flag", flag: "forest", enabled: false });
  const edited = preview.project.planes[1]!.provinces.find(p => p.id === province.id)!;
  assert.equal(preview.changed, 1);
  assert.deepEqual([...effectiveProvinceTerrainFlags(edited)].sort(), ["cave", "freshwater", "swamp"]);
  assert.equal(terrainElevation(edited), 35);
  assert.deepEqual(edited.sites, province.sites);
  assert.equal(JSON.stringify(project), before);
});

for (const [label, configure] of [
  ["preferred throne", (p: Province) => { p.throne = "preferred"; }],
  ["fixed throne", (p: Province) => { p.throne = "fixed"; p.fixedThrone = String(throne.id); }],
  ["known throne site", (p: Province) => { p.sites.push({ id: "imported-throne", value: String(throne.id), known: true }); }],
  ["hidden named throne site", (p: Province) => { p.sites.push({ id: "imported-throne", value: throne.name, known: false }); }],
  ["guardian army", (p: Province) => { p.defenders = [{ commander: "614", squads: [{ id: "imported-guardian", unit: "205", count: 17 }] }]; }],
] as const) {
  test(`validation blocks imported Cave Wall with ${label} without silently modifying the import`, () => {
    for (const primary of [false, true]) {
      const { project, plane, province } = fixture();
      province.terrain = primary ? "cavewall" : "plains";
      province.terrainFlags = primary ? [] : ["cavewall"];
      province.noStart = true;
      configure(province);
      const imported = parseProject(JSON.stringify(project)), before = JSON.stringify(imported);
      const errors = validateProject(imported).filter(issue => issue.severity === "error" && issue.planeId === plane.id && issue.provinceId === province.id);
      assert.ok(errors.some(issue => /blocked|cave.?wall/i.test(issue.message)
        && /throne|guardian|defender/i.test(issue.message)), `${label}: expected a scoped blocked-content error, received ${errors.map(issue => issue.message).join("; ")}`);
      assert.equal(JSON.stringify(imported), before);
    }
  });
}

test("removing an added Cave Wall does not resurrect cleared armies, thrones or starts", () => {
  const { project, plane, province } = fixture();
  addUnsafeContent(project, plane.id, province);
  applyAdditionalTerrainFlag(project, plane.id, province.id, "cavewall", true);
  applyAdditionalTerrainFlag(project, plane.id, province.id, "cavewall", false);
  assert.equal(isBlockedProvince(province), false);
  assert.equal(province.noStart, true, "reopening terrain must not silently create an eligible start");
  assert.equal(province.start, false);
  assert.equal(province.throne, "none");
  assert.deepEqual(province.defenders, []);
  assert.deepEqual(province.sites.map(site => site.id), ["ordinary-site", "custom-site"]);
  assert.equal(project.specificStarts.some(start => start.provinceId === province.id), false);
});

test("Swamp plus Forest resolves to low relief independently of primary preset and flag order", async () => {
  const { plane } = fixture();
  const cases: Array<{ terrain: TerrainKey; terrainFlags: TerrainFlag[]; elevation: number }> = [
    { terrain: "swamp", terrainFlags: ["forest"], elevation: 18 },
    { terrain: "forest", terrainFlags: ["swamp"], elevation: 18 },
    { terrain: "plains", terrainFlags: ["swamp", "forest"], elevation: 18 },
    { terrain: "plains", terrainFlags: ["forest", "swamp"], elevation: 18 },
    { terrain: "caveswamp", terrainFlags: ["forest"], elevation: 35 },
    { terrain: "caveforest", terrainFlags: ["swamp"], elevation: 35 },
    { terrain: "plains", terrainFlags: ["cave", "swamp", "forest"], elevation: 35 },
    { terrain: "plains", terrainFlags: ["forest", "swamp", "cave"], elevation: 35 },
  ];
  cases.forEach((entry, index) => {
    const province = plane.provinces[index]!;
    Object.assign(province, { terrain: entry.terrain, terrainFlags: entry.terrainFlags, freshwater: false });
    assert.equal(terrainElevation(province), entry.elevation);
    assert.ok(provinceTerrainVisuals(province).marks.includes("swamp"));
    assert.ok(provinceTerrainVisuals(province).marks.includes("forest"));
  });
  const bytes = await encodeD6m(plane, "swamp-forest-regression"), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  cases.forEach((entry, index) => {
    const province = plane.provinces[index]!, x = Math.round(province.x * (plane.width - 1)), y = Math.round(province.y * (plane.height - 1));
    assert.equal(view.getInt16(34 + plane.provinces.length * 12 + (y * plane.width + x) * 2, true), entry.elevation);
    assert.equal(view.getBigInt64(34 + index * 12 + 4, true), 0n, "low marsh relief does not set a sea recipe bit");
  });
  assert.equal(terrainElevation({ terrain: "swamp", terrainFlags: ["forest", "mountains"] }), 900);
  assert.equal(terrainElevation({ terrain: "caveswamp", terrainFlags: ["forest", "highland"] }), 640);
});

test("Sea plus Cave Wall preserves flags and blocked status but uses aquatic D6M relief with a warning", async () => {
  const { project, plane } = fixture();
  const cases: Array<{ flags: TerrainFlag[]; height: number; spec: bigint }> = [
    { flags: ["sea", "cavewall"], height: -380, spec: TERRAIN_BITS.sea },
    { flags: ["cavewall", "sea", "deep"], height: -1180, spec: TERRAIN_BITS.sea | TERRAIN_BITS.deep },
    { flags: ["sea", "mountains", "cavewall"], height: -220, spec: TERRAIN_BITS.sea },
    { flags: ["cavewall", "highland", "sea"], height: -220, spec: TERRAIN_BITS.sea },
    { flags: ["sea", "cavewall", "forest"], height: -290, spec: TERRAIN_BITS.sea },
  ];
  for (const [index, entry] of cases.entries()) {
    const province = plane.provinces[index]!;
    Object.assign(province, { terrain: "plains", terrainFlags: entry.flags, defenders: [], throne: "none", sites: [], start: false, noStart: true });
    assert.equal(terrainElevation(province), entry.height);
    assert.equal(isBlockedProvince(province), true);
    assert.notEqual(terrainMask(province) & TERRAIN_BITS.caveWall, 0n);
    assert.notEqual(terrainMask(province) & TERRAIN_BITS.sea, 0n);
  }
  const before = JSON.stringify(project), issues = validateProject(project);
  for (const province of plane.provinces.slice(0, cases.length)) {
    assert.ok(issues.some(issue => issue.severity === "warning" && issue.provinceId === province.id
      && /sea|water/i.test(issue.message) && /wall|blocked/i.test(issue.message)), "undocumented combined appearance needs a warning, not silent normalization");
  }
  const bytes = await encodeD6m(plane, "sea-wall-regression"), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const [index, entry] of cases.entries()) {
    const province = plane.provinces[index]!, x = Math.round(province.x * (plane.width - 1)), y = Math.round(province.y * (plane.height - 1));
    assert.equal(view.getBigInt64(34 + index * 12 + 4, true), entry.spec);
    assert.equal(view.getInt16(34 + plane.provinces.length * 12 + (y * plane.width + x) * 2, true), entry.height);
  }
  assert.equal(JSON.stringify(project), before);
});

test("equivalent primary/additive wall repairs produce identical native and illustrated playable packages", async () => {
  const left = fixture();
  addUnsafeContent(left.project, left.plane.id, left.province);
  const rightProject = cloneProject(left.project), rightPlane = rightProject.planes[1]!, rightProvince = rightPlane.provinces.find(p => p.id === left.province.id)!;
  const ownershipBefore = await sampleIllustratedOwnership(left.plane);
  applyPrimaryTerrain(left.project, left.plane.id, left.province.id, "cavewall");
  applyAdditionalTerrainFlag(rightProject, rightPlane.id, rightProvince.id, "cavewall", true);
  assertWallCleanup(left.project, left.plane.id, left.province);
  assertWallCleanup(rightProject, rightPlane.id, rightProvince);
  assert.deepEqual(await sampleIllustratedOwnership(left.plane), ownershipBefore, "content cleanup cannot move geometry or click areas");
  assert.deepEqual(await sampleIllustratedOwnership(rightPlane), ownershipBefore);
  const leftBefore = JSON.stringify(left.project), rightBefore = JSON.stringify(rightProject);
  for (const artwork of ["native", "illustrated"] as const) {
    const native = await buildPackageFiles(left.project, undefined, undefined, "host", undefined, artwork);
    const additive = await buildPackageFiles(rightProject, undefined, undefined, "host", undefined, artwork);
    const playable = (files: typeof native) => files.filter(file => /\.(map|d6m|tga)$/.test(file.name));
    assert.deepEqual(playable(native), playable(additive), `${artwork}: equivalent effective flags and cleaned content must be exported identically`);
    const name = `${sanitizeMapName(left.project.name)}_plane2.map`, text = new TextDecoder().decode(native.find(file => file.name === name)!.data);
    const number = artwork === "native" ? left.province.index : imageProvinceNumbers(left.plane).get(left.province.id)!;
    assert.ok(text.includes(`#terrain ${number} ${terrainMask(left.province)}`));
    assert.doesNotMatch(text, new RegExp(`^#start ${number}$`, "m"));
    assert.doesNotMatch(text, new RegExp(`^#teamstart ${number} `, "m"));
    assert.doesNotMatch(text, /#commander 614\b/);
    assert.doesNotMatch(text, new RegExp(`#(?:knownfeature|feature) ${throne.id}\\b`));
  }
  assert.equal(JSON.stringify(left.project), leftBefore);
  assert.equal(JSON.stringify(rightProject), rightBefore);
  assert.equal(compileMapText(left.project, 1), compileMapText(rightProject, 1));
});

for (const [label, configure, expected] of [
  ["preferred throne", (province: Province) => { province.throne = "preferred"; }, /throne/i],
  ["fixed throne", (province: Province) => { province.throne = "fixed"; province.fixedThrone = String(throne.id); }, /throne/i],
  ["placed throne site", (province: Province) => { province.sites.push({ id: "boundary-throne", value: String(throne.id), known: true }); }, /throne/i],
  ["guardian groups", (province: Province) => { province.defenders = [{ commander: "614", squads: [{ id: "boundary-guardian", unit: "205", count: 17 }] }]; }, /guardian|defender/i],
  ["raw independent army", (province: Province) => { province.rawDirectives = "#commander 614\n#units 17 205"; }, /guardian|defender/i],
  ["raw numeric throne site", (province: Province) => { province.rawDirectives = `#feature ${throne.id}`; }, /throne/i],
  ["raw explicitly positive throne ID", (province: Province) => { province.rawDirectives = `#feature +${throne.id}`; }, /throne/i],
  ["raw named known throne", (province: Province) => { province.rawDirectives = `#knownfeature "${throne.name}"`; }, /throne/i],
] as const) {
  test(`playable package boundaries reject blocked Cave Wall with ${label} before any work or folder picker`, async () => {
    const { project, plane, province } = fixture();
    province.terrainFlags = ["cavewall"];
    configure(province);
    const before = JSON.stringify(project);
    const issues = validateProject(project).filter(issue => issue.severity === "error" && issue.provinceId === province.id);
    assert.ok(issues.some(issue => /blocked|cave.?wall/i.test(issue.message) && expected.test(issue.message)));
    // Saving and diagnostic text inspection remain available for repair.
    assert.doesNotThrow(() => parseProject(JSON.stringify(project)));
    assert.doesNotThrow(() => compileMapText(project, 1));
    let progressCalls = 0, pickerCalls = 0;
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      showDirectoryPicker: async () => { pickerCalls++; throw new Error("The picker must not be opened for invalid content."); },
    } });
    const rejected = (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /blocked Cave Wall/i);
      assert.match(error.message, expected);
      return true;
    };
    try {
      for (const artwork of ["native", "illustrated"] as const) {
        await assert.rejects(buildPackageFiles(project, () => { progressCalls++; }, undefined, "host", undefined, artwork), rejected);
        await assert.rejects(installPackage(project, () => { progressCalls++; }, undefined, artwork), rejected);
      }
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
    assert.equal(progressCalls, 0);
    assert.equal(pickerCalls, 0);
    assert.equal(JSON.stringify(project), before);
    assert.equal(plane.provinces.find(p => p.id === province.id), province);
  });
}
