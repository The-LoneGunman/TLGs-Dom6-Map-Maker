import assert from "node:assert/strict";
import test from "node:test";
import { cloneProject, type Plane } from "../src/domain";
import { assertProjectLocks } from "../src/authoringLocks";
import { createDefaultProject, generateProject } from "../src/generator";
import { computeProvinceTopology, createProvinceOwnershipModel, type Point } from "../src/geometry";
import { createNaturalLandformWarp } from "../src/naturalLandforms";
import { applySettingsRecipe, createSettingsRecipe, parseSettingsRecipe, SETTINGS_GENERATOR_REVISION } from "../src/recipes";
import { parseProject, serializeProject } from "../src/export";
import { encodeD6m, validateProject } from "../src/dom6";

function fixture(wrapX = false, wrapY = false, width = 384, height = 256): Plane {
  const project = createDefaultProject("natural-landform-qa", { generate: false });
  Object.assign(project.settings, { players: 2, provincesPerPlayer: 12, throneCount: 0,
    startDistribution: { land: 2, coastal: 0, water: 0, cave: 0, other: 0 } });
  Object.assign(project.planes[0]!, { width, height, wrapX, wrapY });
  return generateProject(project).planes[0]!;
}
function legacy(plane: Plane): Plane { const next = structuredClone(plane); delete next.landformStyle; delete next.landformWater; return next; }
function inside(point: Point, polygon: Point[]): boolean {
  let contains = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) contains = !contains;
  }
  return contains;
}

for (const [label, wrapX, wrapY, width, height] of [
  ["flat", false, false, 384, 256], ["wrap-x", true, false, 384, 256],
  ["portrait-wrap-y", false, true, 256, 384], ["torus", true, true, 384, 256],
  ["ultrawide", true, false, 2048, 256],
] as const) {
  test(`${label}: natural border curves preserve topology, capitals and exact inverse ownership`, () => {
    const plane = fixture(wrapX, wrapY, width, height), original = legacy(plane);
    const before = JSON.stringify(plane), warp = createNaturalLandformWarp(plane)!;
    assert.ok(warp);
    const topology = computeProvinceTopology(plane), oldTopology = computeProvinceTopology(original);
    const owner = createProvinceOwnershipModel(plane), oldOwner = createProvinceOwnershipModel(original);
    assert.deepEqual(topology.pairs, oldTopology.pairs);
    assert.deepEqual(topology.pairKeys, oldTopology.pairKeys);
    assert.ok(topology.cells.reduce((sum, c) => sum + c.polygons.reduce((n, p) => n + p.length, 0), 0)
      > oldTopology.cells.reduce((sum, c) => sum + c.polygons.reduce((n, p) => n + p.length, 0), 0) * 2);
    plane.provinces.forEach((p, i) => assert.equal(owner.ownerAt(p.x, p.y), i));
    let moved = 0;
    for (let y = 0; y < 41; y++) for (let x = 0; x < 61; x++) {
      const source = { x: (x + .273) / 61, y: (y + .631) / 41 }, target = warp.forward(source);
      const restored = warp.inverse(target.x, target.y);
      assert.ok(Math.hypot(restored.x - source.x, restored.y - source.y) < 1e-9);
      assert.equal(owner.ownerAt(target.x, target.y), oldOwner.ownerAt(source.x, source.y));
      if (Math.hypot(target.x - source.x, target.y - source.y) > .0001) moved++;
      const index = owner.ownerAt(target.x, target.y);
      assert.ok(topology.cells[index]!.polygons.some(polygon => inside(target, polygon)), "visible polygon and native owner must agree");
    }
    assert.ok(moved > 600, "the style materially curves ordinary borders");
    for (let i = 0; i <= 50; i++) {
      const value = i / 50;
      const left = warp.forward({ x: 0, y: value }), right = warp.forward({ x: 1, y: value });
      assert.equal(left.x, 0); assert.equal(right.x, 1);
      if (wrapX) assert.ok(Math.abs(left.y - right.y) < 1e-12);
      const top = warp.forward({ x: value, y: 0 }), bottom = warp.forward({ x: value, y: 1 });
      assert.equal(top.y, 0); assert.equal(bottom.y, 1);
      if (wrapY) assert.ok(Math.abs(top.x - bottom.x) < 1e-12);
      if (wrapX) assert.equal(owner.ownerAt(0, value), owner.ownerAt(1, value));
      if (wrapY) assert.equal(owner.ownerAt(value, 0), owner.ownerAt(value, 1));
    }
    assert.equal(JSON.stringify(plane), before);
  });
}

test("every curved shared border follows the same two ownership cells on either side", () => {
  const plane = fixture(true, true), topology = computeProvinceTopology(plane), owner = createProvinceOwnershipModel(plane);
  const ids = plane.provinces.map(p => p.id);
  for (const [key, segments] of topology.sharedBorders) for (const segment of segments) {
    const dx = segment.to.x - segment.from.x, dy = segment.to.y - segment.from.y, length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const x = (segment.from.x + segment.to.x) / 2, y = (segment.from.y + segment.to.y) / 2;
    const epsilon = Math.min(1e-7, length / 100);
    const a = ids[owner.ownerAt(x - dy / length * epsilon, y + dx / length * epsilon)]!;
    const b = ids[owner.ownerAt(x + dy / length * epsilon, y - dx / length * epsilon)]!;
    assert.equal([a, b].sort().join("|"), key);
  }
});

test("natural ownership is cached by applied style and never changes after a content edit", () => {
  const plane = fixture(), saved = legacy(plane), oldTopology = computeProvinceTopology(saved), oldOwner = createProvinceOwnershipModel(saved);
  const styled = computeProvinceTopology(plane), styledOwner = createProvinceOwnershipModel(plane);
  assert.notDeepEqual(styled.cells, oldTopology.cells);
  assert.equal(createNaturalLandformWarp(saved), undefined);
  const shape = JSON.stringify(styled.cells);
  const sample = Array.from({length:200}, (_, i) => styledOwner.ownerAt((i % 20 + .2) / 20, (Math.floor(i / 20) + .3) / 10));
  for (const p of plane.provinces) { p.name = "Edited"; p.terrain = "sea"; p.terrainFlags = ["forest"]; p.freshwater = true; }
  for (const edge of plane.edges) edge.kind = "river";
  assert.equal(JSON.stringify(computeProvinceTopology(plane).cells), shape);
  assert.deepEqual(Array.from({length:200}, (_, i) => createProvinceOwnershipModel(plane).ownerAt((i % 20 + .2) / 20, (Math.floor(i / 20) + .3) / 10)), sample);
  assert.equal(computeProvinceTopology(saved), oldTopology); assert.equal(createProvinceOwnershipModel(saved), oldOwner);
});

test("legacy imports retain their outlines; style persists strictly and settings recipes do not reshape the current map", () => {
  const project = createDefaultProject("landform-persistence"), before = cloneProject(project);
  assert.ok(project.planes.every(plane => plane.landformStyle === "natural-v1"));
  assert.equal(serializeProject(parseProject(serializeProject(project))), serializeProject(project));
  delete before.planes[0]!.landformStyle;
  delete before.planes[0]!.landformWater;
  assert.equal(parseProject(serializeProject(before)).planes[0]!.landformStyle, undefined);
  const invalid = cloneProject(project);
  Object.assign(invalid.planes[0]!, {landformStyle:"future-unknown"});
  assert.throws(() => serializeProject(invalid), /landformStyle/);
  assert.ok(validateProject(invalid).some(issue => issue.severity === "error" && /landform style/.test(issue.message)));
  const recipe = createSettingsRecipe(before), applied = applySettingsRecipe(project, recipe);
  assert.equal(recipe.generator, SETTINGS_GENERATOR_REVISION);
  assert.ok(recipe.planes.every(plane => !("landformStyle" in plane)), "recipes contain preferences, not applied geometry");
  const oldRecipe = {...recipe, generator:"atlas-generation-2026-09-20" as const};
  assert.equal(parseSettingsRecipe(JSON.stringify(oldRecipe)).generator, oldRecipe.generator);
  assert.equal(applySettingsRecipe(before, oldRecipe).planes[0]!.landformStyle, undefined);
  assert.equal(applied.planes[0]!.landformStyle, "natural-v1");
  assert.deepEqual(computeProvinceTopology(applied.planes[0]!), computeProvinceTopology(project.planes[0]!));
  project.authoring = {lockLayout:true}; before.authoring = {lockLayout:true};
  assert.throws(() => assertProjectLocks(project, before), /Layout is locked/);
});

test("D6M exports the natural ownership while missing style keeps the legacy raster", async () => {
  const plane = fixture(false, false, 256, 256), old = legacy(plane);
  const natural = await encodeD6m(plane, "natural-shore"), classic = await encodeD6m(old, "natural-shore");
  assert.notDeepEqual(natural, classic);
  const view = new DataView(natural.buffer, natural.byteOffset, natural.byteLength);
  const owner = createProvinceOwnershipModel(plane);
  const offset = 34 + plane.provinces.length * 12 + plane.width * plane.height * 2;
  for (let y = 7; y < plane.height; y += 13) for (let x = 9; x < plane.width; x += 17) {
    const pointOwner = owner.ownerAt((x + .5) / plane.width, (y + .5) / plane.height) + 1;
    assert.equal(view.getUint16(offset + (y * plane.width + x) * 2, true), pointOwner);
  }
  assert.deepEqual(await encodeD6m(old, "natural-shore"), classic, "new-style export never mutates an old saved plane");
});
