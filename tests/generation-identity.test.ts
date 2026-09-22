import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { cloneProject, planeGenerationKey, setNationSpecificStart, type MapProject, type PlaneKind } from "../src/domain";
import { addPlane, createDefaultProject, generatePlane, generateProject, rerollPlaneDetails } from "../src/generator";
import { applySettingsRecipe, createSettingsRecipe, parseSettingsRecipe } from "../src/recipes";
import { parseProject, serializeProject } from "../src/export";
import { compileMapText, encodeD6m, validateProject } from "../src/dom6";
import { computeProvinceTopology, createProvinceOwnershipModel } from "../src/geometry";
import { encodeIllustratedImages, hasIllustratedArtwork } from "../src/illustratedMap";
import { assertProjectLocks } from "../src/authoringLocks";

const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function configured(initial: string, kind: PlaneKind = "surface"): MapProject {
  let project = createDefaultProject(initial, { generate: false });
  if (kind !== "surface") project = addPlane(project, kind, { generate: false });
  project.seed = `portable-${kind}`;
  Object.assign(project.settings, { players: 2, provincesPerPlayer: 12, throneCount: 2,
    resolution: "custom", startDistribution: { land: 2, coastal: 0, water: 0, cave: 0, other: 0 } });
  for (const plane of project.planes) Object.assign(plane, { width: 384, height: 256 });
  if (kind !== "surface") project.settings.planeConnections = [{ a: project.planes[0]!.id, b: project.planes[1]!.id, pairs: 1 }];
  return project;
}
function content(project: MapProject) {
  const index = (id: string) => project.planes.findIndex(p => p.id === id);
  return JSON.parse(JSON.stringify({
    planes: project.planes.map(plane => ({ ...plane, id: "reference-only" })),
    starts: project.specificStarts.map(s => ({ ...s, planeId: index(s.planeId) })),
    gates: project.gates.map(g => ({ ...g, endpoints: g.endpoints.map(e => ({ ...e, planeId: index(e.planeId) })) })),
    warnings: project.generationWarnings,
  }));
}
function owners(project: MapProject) {
  return project.planes.map(plane => {
    const model = createProvinceOwnershipModel(plane);
    return Array.from({ length: 64 * 48 }, (_, i) => model.ownerAt((i % 64 + .3) / 64, (Math.floor(i / 64) + .7) / 48));
  });
}

for (const kind of ["surface", "cave", "cavern", "cloud", "air", "underworld", "hell", "abyss", "dream", "elemental", "custom"] as const) {
  test(`${kind}: matching settings/seed and seeded recipes reproduce across independent atlas IDs`, async () => {
    const a = configured("first-original-atlas", kind), b = configured("second-original-atlas", kind);
    const untouched = JSON.stringify(a), referenceIds = a.planes.map(p => p.id);
    assert.notDeepEqual(referenceIds, b.planes.map(p => p.id));
    const recipe = parseSettingsRecipe(JSON.stringify(createSettingsRecipe(a, "Portable", true)));
    const viaRecipe = applySettingsRecipe(b, recipe);
    const first = generateProject(a), second = generateProject(b), third = generateProject(viaRecipe);
    assert.equal(JSON.stringify(a), untouched, "generation must not mutate its input");
    assert.deepEqual(first.planes.map(p => p.id), referenceIds, "editor reference IDs survive generation");
    assert.deepEqual(content(second), content(first));
    assert.deepEqual(content(third), content(first));
    assert.deepEqual(owners(second), owners(first));
    for (let i = 0; i < first.planes.length; i++) {
      assert.equal(compileMapText(second, i), compileMapText(first, i));
      const seed = `${first.seed}:d6m:${i}`;
      assert.equal(digest(await encodeD6m(second.planes[i]!, seed)), digest(await encodeD6m(first.planes[i]!, seed)));
    }
    if (hasIllustratedArtwork(first.planes.at(-1)!)) {
      const images = async (project: MapProject) => {
        const hashes = [];
        for await (const image of encodeIllustratedImages(project.planes.at(-1)!)) hashes.push([image.suffix, digest(image.data)]);
        return hashes;
      };
      assert.deepEqual(await images(second), await images(first), "all 18 artwork sheets are portable");
    }
    assert.deepEqual(content(parseProject(serializeProject(first))), content(first));
  });
}

test("generation retains authored references, named selections, field locks and unchanged snapshots", () => {
  let project = generateProject(configured("reference-preservation", "cave"));
  const surface = project.planes[0]!, cave = project.planes[1]!, province = surface.provinces[0]!;
  province.name = "Authored Local Name"; province.nameSource = "authored"; province.editorLocks = ["name"];
  project.authoring = { regions: [{ id: "region-a", name: "Bookmark", planeId: surface.id, provinceIds: [province.id] }] };
  project.generationInputs = { version: 1, seed: "unchanged", starts: "unchanged", terrain: "unchanged", planes: JSON.stringify([surface.id, cave.id]), links: "unchanged" };
  const before = cloneProject(project);
  project = generateProject(project);
  assert.deepEqual(project.authoring, before.authoring);
  assert.deepEqual(project.settings.planeConnections, before.settings.planeConnections);
  assert.deepEqual(project.generationInputs, before.generationInputs);
  assert.equal(project.planes[0]!.provinces[0]!.name, "Authored Local Name");
  assert.deepEqual(project.planes[0]!.provinces[0]!.editorLocks, ["name"]);
  assert.ok(project.gates.every(g => g.endpoints.every(e => before.planes.some(p => p.id === e.planeId))));
});

test("authored nation starts keep their plane references, protected features and start locks", () => {
  const project = generateProject(configured("specific-start-reference"));
  const plane = project.planes[0]!, capital = plane.provinces.find(p => p.start)!;
  setNationSpecificStart(project, plane.id, capital.id, 15);
  const next = generateProject(project);
  assert.deepEqual(next.specificStarts, project.specificStarts);
  assert.equal(next.specificStarts[0]!.planeId, plane.id);
  const regenerated = next.planes[0]!.provinces.find(p => p.id === capital.id)!;
  assert.equal(regenerated.defenders.length, 0);
  assert.ok(regenerated.throne !== "preferred" && regenerated.throne !== "fixed");
  project.authoring = { lockStarts: true };
  project.seed = "locked-starts-must-not-disappear";
  assert.throws(() => generateProject(project), /locked/i);
});

test("applied identity survives seed edits, recipe preview, reload and content-only rerolls", () => {
  const project = generateProject(configured("persisted-art", "cave"));
  const geometry = project.planes.map(p => computeProvinceTopology(p).cells), sampled = owners(project);
  const key = project.planes.map(planeGenerationKey);
  project.seed = "a-next-generation-setting-only";
  const recipe = createSettingsRecipe(project, "Pending", true);
  assert.ok(recipe.planes.every(p => !("generationKey" in p)), "recipes omit applied map provenance");
  const next = applySettingsRecipe(parseProject(serializeProject(project)), recipe);
  next.planes[1] = rerollPlaneDetails(next.planes[1]!, "content-only-seed", next);
  assert.deepEqual(next.planes.map(planeGenerationKey), key);
  assert.deepEqual(next.planes.map(p => computeProvinceTopology(p).cells), geometry);
  assert.deepEqual(owners(next), sampled);
});

test("legacy maps use stable IDs; explicit generation alone upgrades provenance; layout lock protects it", () => {
  const project = generateProject(configured("legacy-identity", "cloud"));
  for (const plane of project.planes) delete plane.generationKey;
  const saved = parseProject(serializeProject(project));
  assert.ok(saved.planes.every(p => p.generationKey === undefined && planeGenerationKey(p) === p.id));
  assert.deepEqual(owners(saved), owners(project));
  saved.authoring = { lockLayout: true };
  const changed = cloneProject(saved); changed.planes[0]!.generationKey = "different";
  assert.throws(() => assertProjectLocks(saved, changed), /Layout is locked/);
  assert.throws(() => generateProject(saved), /Layout is locked/);
  for (const bad of ["", "x".repeat(129), "spaces are invalid", 42]) {
    const malformed = cloneProject(project);
    Object.assign(malformed.planes[0]!, { generationKey: bad });
    assert.throws(() => parseProject(JSON.stringify(malformed)), /generationKey/);
    assert.ok(validateProject(malformed).some(i => i.severity === "error" && i.message.includes("generation key")));
  }
});

test("standalone plane generation also separates reference identity from randomness", () => {
  const a = configured("standalone-first", "cave"), b = configured("standalone-second", "cave");
  const first = generatePlane(a.planes[1]!, a.settings, "standalone-stage", 1);
  const second = generatePlane(b.planes[1]!, b.settings, "standalone-stage", 1);
  assert.equal(first.id, a.planes[1]!.id); assert.equal(second.id, b.planes[1]!.id);
  assert.deepEqual({ ...first, id: "same" }, { ...second, id: "same" });
});

test("eight-plane seeded recipes reproduce distributed cave/other starts and custom gate plans", () => {
  const build = (initial: string) => {
    let project = configured(initial);
    project.seed = initial;
    for (const kind of ["cave", "cloud", "underworld", "hell", "abyss", "dream", "elemental"] as const) {
      project = addPlane(project, kind, { generate: false, autoSize: true });
    }
    Object.assign(project.settings, { players: 4, provincesPerPlayer: 24,
      startDistribution: { land: 2, coastal: 0, water: 0, cave: 1, other: 1 }, caveStartNations: [15] });
    for (const plane of project.planes) Object.assign(plane, { width: 512, height: 384 });
    project.settings.planeConnections = project.planes.slice(1).map(p => ({ a: project.planes[0]!.id, b: p.id, pairs: 1, enabled: true }));
    project.seed = "portable-eight-shared";
    return project;
  };
  const first = build("eight-original-a"), second = build("eight-original-b");
  const a = generateProject(first), b = generateProject(applySettingsRecipe(second, createSettingsRecipe(first, "Eight", true)));
  assert.deepEqual(content(a), content(b));
  assert.deepEqual(a.settings.planeConnections, first.settings.planeConnections);
  assert.deepEqual(b.settings.planeConnections, second.settings.planeConnections);
  assert.ok(a.specificStarts.some(s => s.nation === 15 && s.planeId === a.planes[1]!.id));
  assert.deepEqual(validateProject(a).filter(i => i.severity === "error"), []);
  assert.deepEqual(validateProject(b).filter(i => i.severity === "error"), []);
});
