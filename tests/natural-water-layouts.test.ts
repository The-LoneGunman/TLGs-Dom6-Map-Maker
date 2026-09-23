import assert from "node:assert/strict";
import test from "node:test";
import { isWaterProvince, type OceanLayout, type Plane, type Province } from "../src/domain";
import { edgeSpecial, validateProject } from "../src/dom6";
import { applyResolution, classifyCurrentStart, createDefaultProject, generatePlane, generateProject, hashString, ISLAND_CHAIN_MIN_WATER_PERCENT } from "../src/generator";
import { computeProvinceTopology } from "../src/geometry";

function fixture(mode: OceanLayout, seed: string, wrapX = false, wrapY = false, count = 120, waterPercent = 40): Plane {
  const base = createDefaultProject(seed, { generate: false });
  return generatePlane({ ...base.planes[0]!, landformStyle: "natural-v1", autoSize: false,
    provinceTarget: count, wrapX, wrapY }, { ...base.settings, waterPercent, oceanLayout: mode, continentCount: 3 },
  seed, 0, { deferStrategicFeatures: true });
}

/** Independent geometric adjacency, without reusing a water-selector graph. */
function components(plane: Plane, predicate: (province: Province) => boolean): Province[][] {
  const eligible = new Map(plane.provinces.filter(predicate).map(province => [province.id, province]));
  const adjacency = new Map([...eligible.keys()].map(id => [id, [] as string[]]));
  for (const pair of computeProvinceTopology(plane).pairs) if (eligible.has(pair.a) && eligible.has(pair.b)) {
    adjacency.get(pair.a)!.push(pair.b); adjacency.get(pair.b)!.push(pair.a);
  }
  const unseen = new Set(eligible.keys()), result: Province[][] = [];
  while (unseen.size) {
    const first = unseen.values().next().value!, queue = [first]; unseen.delete(first);
    for (let cursor = 0; cursor < queue.length; cursor++) for (const next of adjacency.get(queue[cursor]!)!) {
      if (unseen.delete(next)) queue.push(next);
    }
    result.push(queue.map(id => eligible.get(id)!));
  }
  return result.sort((a, b) => b.length - a.length);
}

test("natural-style water presets preserve quotas and promised land/water components on every wrap configuration", () => {
  for (const mode of ["natural", "single_continent", "multiple_continents", "island_chains", "inland_sea"] as const) {
    for (const [wrapX, wrapY] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const label = `${mode}-${wrapX}-${wrapY}`, plane = fixture(mode, `natural-water-${label}`, wrapX, wrapY);
      const water = components(plane, isWaterProvince), land = components(plane, province => !isWaterProvince(province));
      assert.equal(plane.landformStyle, "natural-v1");
      assert.equal(plane.provinces.length, 120);
      assert.equal(water.flat().length, Math.round(120 * (mode === "island_chains" ? ISLAND_CHAIN_MIN_WATER_PERCENT : 40) / 100), label);
      if (mode === "single_continent" || mode === "inland_sea") {
        assert.equal(land.length, 1, `${label}: dry provinces remain one usable landmass`);
        assert.equal(water.length, 1, `${label}: the ocean/basin is contiguous`);
      }
      if (mode === "multiple_continents") {
        assert.equal(land.length, 3, `${label}: feasible three-continent request`);
        assert.ok(land.every(component => component.length >= Math.ceil(72 / 3 * .62)), `${label}: no token continents`);
      }
      if (mode === "island_chains") {
        assert.equal(water.length, 1, `${label}: island chains share a connected ocean`);
        assert.ok(land.length >= 3, `${label}: at least three separate islands/chains`);
        assert.ok(land.every(component => component.length >= 3), `${label}: no new one-province scraps`);
      }
    }
  }
});

test("inland seas have asymmetric coherent basin outlines instead of repeating nearest-radius disks", () => {
  let differentFromRadial = 0;
  for (let index = 0; index < 4; index++) {
    const seed = `natural-basin-shape-${index}`, plane = fixture("inland_sea", seed);
    const water = plane.provinces.filter(isWaterProvince);
    const centerX = .5 + ((hashString(`${seed}:inland-x`) % 17) - 8) / 400;
    const centerY = .5 + ((hashString(`${seed}:inland-y`) % 17) - 8) / 400;
    const radial = new Set([...plane.provinces]
      .sort((a, b) => Math.hypot(a.x - centerX, a.y - centerY) - Math.hypot(b.x - centerX, b.y - centerY) || a.index - b.index)
      .slice(0, water.length).map(province => province.id));
    const differences = plane.provinces.filter(province => radial.has(province.id) !== isWaterProvince(province)).length;
    differentFromRadial += differences;
    assert.ok(differences >= 4, `${seed}: shape scoring must make a visible classification change`);
    assert.ok(water.every(province => Math.min(province.x, 1 - province.x, province.y, 1 - province.y) > .08),
      `${seed}: ordinary inland-sea quotas stay enclosed by land`);
    assert.equal(components(plane, isWaterProvince).length, 1);
    assert.equal(components(plane, province => !isWaterProvince(province)).length, 1);
    assert.deepEqual(fixture("inland_sea", seed), plane, "shape variation remains seed-reproducible");
  }
  assert.ok(differentFromRadial >= 24, "the corpus differs materially from circular province selection");
});

test("natural water profiles respect zero and high quotas without collapsing small worlds", () => {
  for (const mode of ["natural", "single_continent", "multiple_continents", "inland_sea"] as const) {
    for (const percent of [0, 60]) {
      const plane = fixture(mode, `natural-tiny-${mode}-${percent}`, true, true, 8, percent);
      assert.equal(plane.provinces.filter(isWaterProvince).length, Math.round(8 * percent / 100));
      assert.equal(plane.provinces.length, 8);
      assert.ok(plane.provinces.every(province => Number.isFinite(province.x) && Number.isFinite(province.y)));
    }
  }
});

test("new water outlines remain compatible with full start placement and capital-safe river routing", () => {
  for (const mode of ["single_continent", "multiple_continents", "island_chains", "inland_sea"] as const) {
    const project = createDefaultProject(`natural-water-starts-${mode}`, { generate: false });
    project.planes[0]!.landformStyle = "natural-v1";
    Object.assign(project.settings, { players: 4, provincesPerPlayer: 24, throneCount: 4,
      waterPercent: 40, oceanLayout: mode, continentCount: 3,
      startDistribution: { land: 2, coastal: 1, water: 1, cave: 0, other: 0 } });
    const generated = generateProject(project), plane = generated.planes[0]!;
    const starts = plane.provinces.filter(province => province.start);
    assert.equal(starts.length, 4, mode);
    assert.equal(starts.filter(isWaterProvince).length, 1, `${mode}: requested aquatic start remains available`);
    const startIds = new Set(starts.map(province => province.id));
    for (const edge of plane.edges) if (startIds.has(edge.a) || startIds.has(edge.b)) {
      assert.equal(edgeSpecial(edge) & 2, 0, `${mode}: no river restriction on a capital exit`);
    }
    const byId = new Map(plane.provinces.map(province => [province.id, province]));
    for (const edge of plane.edges) if (startIds.has(edge.a)) assert.equal(startIds.has(edge.b), false, `${mode}: no adjacent capitals`);
    for (const start of starts) {
      assert.equal(start.defenders.length, 0);
      assert.ok(start.throne === "none" || start.throne === "avoid", `${mode}: capitals cannot hold a throne`);
      if (start.startType === "coastal") assert.ok(plane.edges.some(edge =>
        edge.a === start.id && isWaterProvince(byId.get(edge.b)!) || edge.b === start.id && isWaterProvince(byId.get(edge.a)!)),
      `${mode}: coastal starts retain sea access`);
    }
  }
});

test("ocean presets keep water topology while island starts may reshape undersized interiors", () => {
  for (const mode of ["single_continent", "multiple_continents", "island_chains", "inland_sea"] as const) {
    let project = createDefaultProject("realm-92x5xo-1xlomu9", { generate: false });
    project.seed = "natural-coasts-qa";
    project = applyResolution(project, "2k");
    Object.assign(project.planes[0]!, { wrapX: false, wrapY: false });
    Object.assign(project.settings, { waterPercent: 40, oceanLayout: mode, biomeCohesion: 58 });
    const effectiveWater = mode === "island_chains" ? ISLAND_CHAIN_MIN_WATER_PERCENT : 40;
    const deferred = generatePlane(project.planes[0]!, { ...project.settings, waterPercent: effectiveWater },
      `${project.seed}:plane:0:v1`, 0, { deferStrategicFeatures: true, waterPercent: effectiveWater });
    const generated = generateProject(project), final = generated.planes[0]!;
    const waterIds = (plane: Plane) => plane.provinces.filter(isWaterProvince).map(province => province.id).sort();
    if (mode === "island_chains") {
      // Six inland capitals need wider islands than the coast-heavy initial
      // mask provides. The repair changes membership, never quota or topology.
      assert.equal(waterIds(final).length, waterIds(deferred).length);
      assert.equal(components(final, isWaterProvince).length, 1);
      assert.ok(components(final, province => !isWaterProvince(province)).length >= 3);
      assert.equal(final.provinces.filter(province => province.start).length, 6);
      assert.ok(final.provinces.filter(province => province.start).every(province => classifyCurrentStart(final, province) === "land"));
      assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), []);
      continue;
    }
    assert.deepEqual(waterIds(final), waterIds(deferred), `${mode}: start-category repair must not repaint the selected geography`);
    assert.deepEqual(components(final, isWaterProvince).map(group => group.map(province => province.id).sort()),
      components(deferred, isWaterProvince).map(group => group.map(province => province.id).sort()), mode);
    assert.deepEqual(components(final, province => !isWaterProvince(province)).map(group => group.map(province => province.id).sort()),
      components(deferred, province => !isWaterProvince(province)).map(group => group.map(province => province.id).sort()), mode);
    assert.equal(final.provinces.filter(province => province.start).length, 6);
    if (mode === "single_continent" || mode === "multiple_continents") {
      assert.ok(final.provinces.filter(province => province.start).every(province => classifyCurrentStart(final, province) === "land"));
      assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), [], `${mode}: this exact layout has six viable noncoastal starts`);
    } else {
      // A narrow inland-sea land ring cannot support six
      // noncoastal, degree-four, distance-three capitals in this fixture.
      // Keep the requested coastline and expose the real constraint instead
      // of manufacturing room by scattering new seas through the map.
      assert.ok(validateProject(generated).some(issue => issue.severity === "error"
        && /connections|movement connection/.test(issue.message)), `${mode}: constrained starts must remain visible in validation`);
    }
  }
});

test("all explicit ocean presets offer viable mixed land, coastal and water starts without changing their geography", () => {
  for (const mode of ["single_continent", "multiple_continents", "island_chains", "inland_sea"] as const) {
    let project = createDefaultProject("realm-92x5xo-1xlomu9", { generate: false });
    project.seed = "natural-coasts-qa";
    project = applyResolution(project, "2k");
    // The 96-province island fixture has only one degree-four inland site.
    // A 120-province map makes the requested second inland capital viable.
    Object.assign(project.planes[0]!, { provinceTarget: 120, wrapX: false, wrapY: false });
    Object.assign(project.settings, { players: 4, provincesPerPlayer: 30, waterPercent: 40,
      oceanLayout: mode, biomeCohesion: 58, startDistribution: { land: 2, coastal: 1, water: 1, cave: 0, other: 0 } });
    const effectiveWater = mode === "island_chains" ? ISLAND_CHAIN_MIN_WATER_PERCENT : 40;
    const deferred = generatePlane(project.planes[0]!, { ...project.settings, waterPercent: effectiveWater },
      `${project.seed}:plane:0:v1`, 0, { deferStrategicFeatures: true, waterPercent: effectiveWater });
    const generated = generateProject(project), final = generated.planes[0]!;
    assert.deepEqual(final.provinces.filter(isWaterProvince).map(province => province.id),
      deferred.provinces.filter(isWaterProvince).map(province => province.id), mode);
    assert.deepEqual(final.provinces.filter(province => province.start).map(province => classifyCurrentStart(final, province)).sort(),
      ["coastal", "land", "land", "water"], mode);
    assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), [], mode);
  }
});
