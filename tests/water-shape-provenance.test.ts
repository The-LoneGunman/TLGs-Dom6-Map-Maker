import assert from "node:assert/strict";
import test from "node:test";
import { cloneProject, isWaterProvince, landformWaterError, type MapProject, type Plane, type Province } from "../src/domain";
import { assertProjectLocks } from "../src/authoringLocks";
import { edgeSpecial, validateProject } from "../src/dom6";
import { parseProject, serializeProject } from "../src/export";
import { applyResolution, captureGeneratedWaterProvenance, classifyCurrentStart, createDefaultProject, generatePlane, generateProject } from "../src/generator";
import { computeProvinceTopology, createProvinceOwnershipModel } from "../src/geometry";
import { previewContentReroll } from "../src/iteration";
import { applySettingsRecipe, createSettingsRecipe } from "../src/recipes";

function grid(columns = 5, rows = 5): Plane {
  const provinces: Province[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    provinces.push({ id: `water-${column}-${row}`, index: provinces.length + 1,
      x: (column + .5) / columns, y: (row + .5) / rows, gridX: column, gridY: row,
      name: `Water fixture ${column} ${row}`, nameSource: "generated", biome: "heartland", terrain: "plains",
      terrainFlags: [], freshwater: false, small: false, large: false, noStart: false, manySites: false,
      warmer: false, colder: false, siteBias: [], start: false, throne: "none", sites: [], killRandomSites: false,
      temple: false, lab: false, defenders: [], battle: {}, rawDirectives: "" });
  }
  const plane: Plane = { id: "water-provenance", name: "Water provenance", kind: "surface", variant: "temperate",
    landformStyle: "natural-v1", ownershipMode: "solid", provinceTarget: provinces.length,
    width: 384, height: 256, wrapX: false, wrapY: false, provinces, edges: [], rawDirectives: "" };
  plane.edges = computeProvinceTopology(plane).pairs.map((pair, index) => ({ id: `edge-${index}`, a: pair.a, b: pair.b, kind: "standard" }));
  return plane;
}

function flood(plane: Plane, ids: readonly string[]) {
  for (const province of plane.provinces) province.terrain = ids.includes(province.id) ? "sea" : "plains";
}

function projectFor(plane: Plane): MapProject {
  const project = createDefaultProject("water-provenance", { generate: false });
  Object.assign(project.settings, { players: 2, provincesPerPlayer: 12, throneCount: 0,
    startDistribution: { land: 2, coastal: 0, water: 0, cave: 0, other: 0 } });
  project.planes = [plane];
  return project;
}

function ownerSample(plane: Plane): number[] {
  const model = createProvinceOwnershipModel(plane);
  return Array.from({ length: 4096 }, (_, index) => model.ownerAt((index % 64 + .317) / 64, (Math.floor(index / 64) + .713) / 64));
}

test("water-body provenance follows physical borders, not rivers, impassable edges or missing authored links", () => {
  const plane = grid();
  flood(plane, ["water-0-0", "water-0-1", "water-2-2", "water-2-3"]);
  // Movement restrictions never split a physically continuous body of water.
  plane.edges = plane.edges.filter(edge => !(edge.a === "water-2-2" && edge.b === "water-2-3"));
  for (const edge of plane.edges) edge.kind = "impassable";
  const content = structuredClone(plane.provinces), edges = structuredClone(plane.edges);
  captureGeneratedWaterProvenance(plane);
  assert.deepEqual(plane.landformWater, [
    { provinceIds: ["water-0-0", "water-0-1"], enclosed: false },
    { provinceIds: ["water-2-2", "water-2-3"], enclosed: true },
  ]);
  assert.deepEqual(plane.provinces, content);
  assert.deepEqual(plane.edges, edges);
  const first = structuredClone(plane.landformWater);
  captureGeneratedWaterProvenance(plane);
  assert.deepEqual(plane.landformWater, first, "recapture is deterministic and ignores the previous shoreline treatment");
});

test("periodic water bodies join across a seam but are not classified as enclosed lakes", () => {
  const plane = grid(); plane.wrapX = true;
  flood(plane, ["water-0-2", "water-4-2"]);
  captureGeneratedWaterProvenance(plane);
  assert.deepEqual(plane.landformWater, [{ provinceIds: ["water-0-2", "water-4-2"], enclosed: false }]);
  const vertical = grid(); vertical.wrapY = true;
  flood(vertical, ["water-2-0", "water-2-4"]);
  captureGeneratedWaterProvenance(vertical);
  assert.deepEqual(vertical.landformWater, [{ provinceIds: ["water-2-0", "water-2-4"], enclosed: false }]);
});

test("only explicitly generated natural solid planes receive water-shape provenance", () => {
  const dry = grid(); captureGeneratedWaterProvenance(dry); assert.deepEqual(dry.landformWater, []);
  const legacy = grid(); delete legacy.landformStyle; captureGeneratedWaterProvenance(legacy);
  assert.equal(legacy.landformWater, undefined);
  for (const kind of ["surface", "custom", "cave", "underworld", "cloud"] as const) {
    const plane = grid(); plane.kind = kind; plane.ownershipMode = "sparse";
    plane.landformWater = [{ provinceIds: [plane.provinces[0]!.id], enclosed: false }];
    captureGeneratedWaterProvenance(plane);
    assert.equal(plane.landformWater, undefined, kind);
  }
  const custom = grid(); custom.kind = "custom"; flood(custom, ["water-2-2"]);
  captureGeneratedWaterProvenance(custom);
  assert.deepEqual(custom.landformWater, [{ provinceIds: ["water-2-2"], enclosed: true }]);
});

test("water-shape provenance round-trips and stays fixed during manual terrain, recipe and content edits", () => {
  const plane = grid(); flood(plane, ["water-2-2", "water-2-3"]); captureGeneratedWaterProvenance(plane);
  const project = projectFor(plane), snapshot = structuredClone(plane.landformWater), owners = ownerSample(plane);
  const saved = parseProject(serializeProject(project));
  assert.deepEqual(saved.planes[0]!.landformWater, snapshot);
  assert.equal("landformWater" in createSettingsRecipe(project).planes[0]!, false, "recipes store settings, not applied ownership provenance");
  const variants = [saved, cloneProject(project), applySettingsRecipe(project, createSettingsRecipe(project))];
  for (const kind of ["name", "economy", "sites", "guardians"] as const) variants.push(previewContentReroll(project,
    plane.id, plane.provinces.map(province => province.id), kind, "fixed-water-shape").project);
  const manuallyEdited = cloneProject(project); flood(manuallyEdited.planes[0]!, ["water-0-0", "water-4-4"]);
  variants.push(manuallyEdited);
  for (const next of variants) {
    assert.deepEqual(next.planes[0]!.landformWater, snapshot);
    assert.deepEqual(ownerSample(next.planes[0]!), owners);
  }
  const legacy = cloneProject(project); delete legacy.planes[0]!.landformWater; delete legacy.planes[0]!.landformStyle;
  assert.equal(parseProject(serializeProject(legacy)).planes[0]!.landformWater, undefined);
  assert.equal(applySettingsRecipe(legacy, createSettingsRecipe(project)).planes[0]!.landformWater, undefined);
});

test("water-shape metadata is strictly bounded and rejects malformed, duplicate or missing province references", () => {
  const valid = projectFor(grid()), id = valid.planes[0]!.provinces[0]!.id;
  valid.planes[0]!.landformWater = [{ provinceIds: [id], enclosed: true }];
  const malformed: unknown[] = [null, {}, [{}], [{ provinceIds: [], enclosed: true }],
    [{ provinceIds: [id], enclosed: 1 }], [{ provinceIds: [id], enclosed: true, extra: 0 }],
    [{ provinceIds: ["missing"], enclosed: true }], [{ provinceIds: [id, id], enclosed: true }],
    [{ provinceIds: [id], enclosed: true }, { provinceIds: [id], enclosed: false }],
    [{ provinceIds: Array.from({ length: 801 }, () => id), enclosed: true }],
    Array.from({ length: 801 }, () => ({ provinceIds: [id], enclosed: true })),
  ];
  for (const snapshot of malformed) {
    const project = cloneProject(valid); Object.assign(project.planes[0]!, { landformWater: snapshot });
    assert.match(landformWaterError(project.planes[0]!) ?? "", /landformWater/);
    assert.throws(() => serializeProject(project), /landformWater/);
    assert.throws(() => parseProject(JSON.stringify(project)), /landformWater/);
    assert.ok(validateProject(project).some(issue => issue.severity === "error" && issue.message.includes("landformWater")));
  }
  delete valid.planes[0]!.landformStyle;
  assert.throws(() => serializeProject(valid), /requires landformStyle/);
  const locked = projectFor(grid()); captureGeneratedWaterProvenance(locked.planes[0]!); locked.authoring = { lockLayout: true };
  const changed = cloneProject(locked); changed.planes[0]!.landformWater = [{ provinceIds: [id], enclosed: true }];
  assert.throws(() => assertProjectLocks(locked, changed), /Layout is locked/);
});

test("regeneration replaces old province references and records final start-safe water terrain", () => {
  const source = createDefaultProject("water-provenance-old");
  const sourceSnapshot = JSON.stringify(source.planes[0]!.landformWater);
  const draft = cloneProject(source); draft.seed = "water-provenance-new";
  Object.assign(draft.settings, { players: 4, provincesPerPlayer: 20, throneCount: 4, waterPercent: 35,
    oceanLayout: "single_continent", startDistribution: { land: 2, coastal: 1, water: 1, cave: 0, other: 0 } });
  const generated = generateProject(draft), plane = generated.planes[0]!;
  const water = plane.provinces.filter(isWaterProvince).map(province => province.id).sort();
  assert.deepEqual(plane.landformWater!.flatMap(group => group.provinceIds).sort(), water);
  assert.ok(plane.landformWater!.every(group => group.provinceIds.every(id => plane.provinces.some(province => province.id === id))));
  const starts = new Set(plane.provinces.filter(province => province.start).map(province => province.id));
  assert.equal(starts.size, 4);
  for (const edge of plane.edges) if (starts.has(edge.a) || starts.has(edge.b)) assert.equal(edgeSpecial(edge) & 2, 0);
  for (const province of plane.provinces.filter(province => starts.has(province.id))) {
    assert.equal(province.defenders.length, 0);
    assert.ok(province.throne === "none" || province.throne === "avoid");
  }
  assert.equal(JSON.stringify(source.planes[0]!.landformWater), sourceSnapshot, "generation cannot mutate the saved source atlas");
  const staged = generatePlane(draft.planes[0]!, draft.settings, "water-provenance-stage", 0, { deferStrategicFeatures: true });
  assert.equal(staged.landformWater, undefined, "deferred project generation captures only after starts and restored locks");
  const standalone = generatePlane(draft.planes[0]!, draft.settings, "water-provenance-standalone", 0);
  assert.deepEqual(standalone.landformWater!.flatMap(group => group.provinceIds).sort(),
    standalone.provinces.filter(isWaterProvince).map(province => province.id).sort());
});

test("the full-generation inland-sea browser fixture records an enclosed basin after start placement", () => {
  const project = createDefaultProject("realm-92x5xo-1xlomu9", { generate: false });
  project.seed = "natural-coasts-qa";
  Object.assign(project.settings, { players: 6, provincesPerPlayer: 16, waterPercent: 40, oceanLayout: "inland_sea",
    startDistribution: { land: 6, coastal: 0, water: 0, cave: 0, other: 0 }, resolution: "custom" });
  Object.assign(project.planes[0]!, { width: 2048, height: 1152, wrapX: false, wrapY: false });
  const generated = generateProject(project), plane = generated.planes[0]!;
  assert.equal(plane.provinces.filter(isWaterProvince).length, 38);
  assert.equal(plane.landformWater!.length, 1);
  assert.equal(plane.landformWater![0]!.enclosed, true);
  const water = new Set(plane.landformWater![0]!.provinceIds);
  assert.ok(computeProvinceTopology(plane).cells.filter(cell => water.has(cell.provinceId))
    .every(cell => cell.polygons.every(polygon => polygon.every(point => Math.min(point.x, 1 - point.x, point.y, 1 - point.y) > 1e-8))));
  assert.equal(plane.provinces.filter(province => province.start).length, 6);
});

test("the real single-continent browser fixture retains one ocean rather than four seas after start placement", () => {
  let project = createDefaultProject("realm-92x5xo-1xlomu9", { generate: false });
  project.seed = "natural-coasts-qa";
  project = applyResolution(project, "2k");
  Object.assign(project.planes[0]!, { wrapX: false, wrapY: false });
  Object.assign(project.settings, { waterPercent: 40, oceanLayout: "single_continent", biomeCohesion: 58 });
  const generated = generateProject(project), plane = generated.planes[0]!;
  assert.equal(plane.provinces.filter(isWaterProvince).length, 38);
  assert.equal(plane.provinces.filter(province => !isWaterProvince(province)).length, 58);
  assert.equal(plane.landformWater!.length, 1);
  assert.equal(plane.landformWater![0]!.provinceIds.length, 38);
  assert.equal(plane.landformWater![0]!.enclosed, false);
  assert.equal(plane.provinces.filter(province => province.start && classifyCurrentStart(plane, province) === "land").length, 6);
  assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), []);
});

test("crowded solid rasters show an advisory rather than a shape-generation blocker", () => {
  const crowded = grid(16, 16); crowded.width = crowded.height = 256;
  const warnings = validateProject(projectFor(crowded)).filter(issue => issue.message.includes("512 native pixels"));
  assert.equal(warnings.length, 1); assert.equal(warnings[0]!.severity, "warning");
  assert.match(warnings[0]!.message, /Increase the output resolution or reduce the province count/);
  assert.match(warnings[0]!.message, /not a shape-generation failure/);
  const threshold = grid(16, 8); threshold.width = threshold.height = 256;
  assert.equal(validateProject(projectFor(threshold)).some(issue => issue.message.includes("512 native pixels")), false);
  crowded.width = crowded.height = 512;
  assert.equal(validateProject(projectFor(crowded)).some(issue => issue.message.includes("512 native pixels")), false);
  const sparse = grid(16, 16); sparse.ownershipMode = "sparse"; sparse.width = sparse.height = 256;
  assert.equal(validateProject(projectFor(sparse)).some(issue => issue.message.includes("512 native pixels")), false);
});
