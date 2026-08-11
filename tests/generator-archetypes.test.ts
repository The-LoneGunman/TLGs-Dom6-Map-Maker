import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlane,
  adjacencyFor,
  calculateFairness,
  createDefaultPlaneConnections,
  createDefaultProject,
  generateGates,
  generatePlane,
  generateProject,
  shortestDistances,
} from "../src/generator";
import {
  cloneProject,
  effectiveProvinceTerrainFlags,
  isBlockedProvince,
  isCaveProvince,
  isWaterProvince,
  isWaterTerrain,
  sanitizeMapName,
  type MapProject,
  type PlaneKind,
  type PlaneVariant,
  type StartDistribution,
} from "../src/domain";
import { connectionKey } from "../src/geometry";
import { edgeSpecial, validateProject } from "../src/dom6";

const WATER_POPTYPES = new Set([31, 45, 63, 64, 65, 72, 73, 90, 91, 92, 95, 97, 105]);

function canonical(project: MapProject): MapProject {
  const copy = cloneProject(project);
  copy.createdAt = "";
  copy.updatedAt = "";
  return copy;
}

function splitFixture(seed = "split-fixture"): MapProject {
  let project = createDefaultProject(seed);
  Object.assign(project.settings, {
    players: 10,
    provincesPerPlayer: 12,
    waterPercent: 24,
    throneCount: 10,
    startDistribution: { land: 2, coastal: 2, water: 2, cave: 2, other: 2 },
    startDegreeTarget: 4,
    gateLayout: "compatible",
    gatePairsPerConnection: 1,
  });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 100;
  project = addPlane(project, "cave", { generate: false, provinceTarget: 60, variant: "fungal", name: "Moss Below" });
  project = addPlane(project, "air", { generate: false, provinceTarget: 60, variant: "storm", name: "High Tempest" });
  return generateProject(project);
}

test("distributed starts are deterministic, exact, safe, and degree-balanced", () => {
  const first = splitFixture();
  const second = splitFixture();
  assert.deepEqual(canonical(first), canonical(second));

  const actual: StartDistribution = { land: 0, coastal: 0, water: 0, cave: 0, other: 0 };
  const degrees: number[] = [];
  for (const plane of first.planes) {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const starts = plane.provinces.filter((item) => item.start);
    for (const province of starts) {
      assert.ok(province.startType);
      actual[province.startType!] += 1;
      const degree = adjacency.get(province.id)?.length ?? 0;
      degrees.push(degree);
      assert.ok(degree >= 4, `${province.name} has only ${degree} traversable connections`);
      assert.equal(province.defenders.length, 0);
      assert.equal(
        plane.edges.some((edge) => (edge.a === province.id || edge.b === province.id) && (edgeSpecial(edge) & 0b111) !== 0),
        false,
      );
      if (province.startType === "water") {
        assert.equal(isWaterTerrain(province.terrain), true);
        assert.equal(WATER_POPTYPES.has(province.poptype!), true);
      } else {
        assert.equal(WATER_POPTYPES.has(province.poptype!), false);
      }
    }
    for (const guarded of plane.provinces.filter((province) => province.defenders.length > 0)) {
      for (const start of starts) assert.ok((shortestDistances(adjacency, start.id).get(guarded.id) ?? 0) >= 3);
    }
  }
  assert.deepEqual(actual, first.settings.startDistribution);
  assert.equal(degrees.length, first.settings.players);
  assert.equal(Math.max(...degrees), Math.min(...degrees), "all feasible mixed-category starts should share one exact degree");
  assert.equal(first.planes[1]!.name, "Moss Below");
  assert.equal(first.planes[1]!.variant, "fungal");
  assert.equal(first.planes[1]!.provinceTarget, 60);
  assert.ok(first.planes.every((plane) => plane.provinces.some((province) => province.defenders.length > 0)));

  const fairness = calculateFairness(first);
  assert.equal(fairness.startAllocation, 100);
  assert.ok(fairness.startDegree >= 85);
  assert.ok(fairness.expansionParity >= 90);
  assert.deepEqual(validateProject(first).filter((issue) => issue.severity === "error"), []);
});

test("sixteen-player mixed-plane generation preserves every requested capital", () => {
  let project = createDefaultProject("sixteen-player-fixture");
  Object.assign(project.settings, {
    players: 16,
    provincesPerPlayer: 8,
    waterPercent: 20,
    startDistribution: { land: 8, coastal: 2, water: 2, cave: 2, other: 2 },
    throneCount: 12,
    startDegreeTarget: 4,
  });
  project = addPlane(project, "cave", { generate: false, provinceTarget: 64 });
  project = addPlane(project, "air", { generate: false, provinceTarget: 64 });
  project = generateProject(project);
  const starts = project.planes.flatMap((plane) => plane.provinces.filter((province) => province.start).map((province) => ({ plane, province })));
  assert.equal(starts.length, 16);
  assert.ok(starts.every(({ plane, province }) => (adjacencyFor(plane, { traversableOnly: true }).get(province.id)?.length ?? 0) >= 4));
  assert.equal(calculateFairness(project).startAllocation, 100);
  assert.deepEqual(validateProject(project).filter((issue) => issue.severity === "error"), []);
});

test("all plane archetypes generate coherent terrain, native populations, sites, and guardians", () => {
  const kinds: PlaneKind[] = ["surface", "cave", "cavern", "cloud", "air", "underworld", "hell", "abyss", "dream", "elemental", "custom"];
  const variants: Record<PlaneKind, PlaneVariant> = {
    surface: "temperate",
    cave: "fungal",
    cavern: "crystal",
    cloud: "storm",
    air: "storm",
    underworld: "fungal",
    hell: "infernal",
    abyss: "void",
    dream: "wild",
    elemental: "volcanic",
    custom: "arid",
  };
  const base = createDefaultProject("archetype-base");
  const caveKinds = new Set<PlaneKind>(["cave", "cavern", "underworld", "hell", "abyss"]);

  for (const kind of kinds) {
    const source = cloneProject(base).planes[0]!;
    source.kind = kind;
    source.variant = variants[kind];
    source.autoSize = false;
    source.provinceTarget = 48;
    const first = generatePlane(source, base.settings, `archetype:${kind}`, 1);
    const second = generatePlane(source, base.settings, `archetype:${kind}`, 1);
    assert.deepEqual(first, second);
    assert.ok(new Set(first.provinces.map((province) => province.terrain)).size >= (caveKinds.has(kind) ? 5 : 4));
    if (caveKinds.has(kind)) assert.ok(first.provinces.every((province) => province.terrain.startsWith("cave")));
    if (kind === "cloud" || kind === "air") {
      assert.ok(first.provinces.every((province) => ["plains", "forest", "highland", "mountains"].includes(province.terrain)));
      assert.ok(first.provinces.some((province) => province.siteBias.includes("air")));
    }
    if (kind === "hell") assert.ok(first.provinces.some((province) => province.siteBias.includes("blood")));
    for (const province of first.provinces.filter((item) => item.poptype !== undefined)) {
      assert.equal(WATER_POPTYPES.has(province.poptype!), isWaterTerrain(province.terrain));
    }
    const guardians = first.provinces.flatMap((province) => province.defenders);
    assert.ok(guardians.length > 0);
    assert.ok(guardians.every((guardian) => /^\d+$/.test(guardian.commander)
      && guardian.squads.every((squad) => /^\d+$/.test(squad.unit))));
  }

  const frozen = cloneProject(base).planes[0]!;
  frozen.variant = "frozen";
  frozen.provinceTarget = 48;
  const frozenPlane = generatePlane(frozen, base.settings, "variant:frozen", 1);
  assert.ok(frozenPlane.provinces.filter((province) => province.colder).length > frozenPlane.provinces.length / 2);
  const oceanic = cloneProject(base).planes[0]!;
  oceanic.variant = "oceanic";
  oceanic.provinceTarget = 48;
  const oceanicPlane = generatePlane(oceanic, base.settings, "variant:oceanic", 1);
  assert.ok(oceanicPlane.provinces.filter((province) => isWaterTerrain(province.terrain)).length >= 20);
});

test("freshwater is a composable land marker and legacy exclusive values migrate safely", () => {
  const legacy = createDefaultProject("legacy-freshwater");
  const legacyProvince = legacy.planes[0]!.provinces[0]!;
  legacyProvince.terrain = "freshwater";
  legacyProvince.biome = "archipelago";
  legacyProvince.startType = "water";
  legacyProvince.poptype = 31;
  legacyProvince.population = undefined;
  legacyProvince.defenders = [{ commander: "1067", squads: [{ id: "legacy-water", unit: "1046", count: 10 }] }];
  const migrated = cloneProject(legacy).planes[0]!.provinces[0]!;
  assert.equal(migrated.terrain, "plains");
  assert.equal(migrated.freshwater, true);
  assert.equal(migrated.biome, "heartland");
  assert.equal(migrated.startType, "land");
  assert.equal(migrated.poptype, undefined);
  assert.deepEqual(migrated.defenders, []);
  assert.equal(migrated.population, 8200);
  assert.equal(isWaterTerrain("freshwater"), false);

  const generated = createDefaultProject("freshwater-marker");
  assert.equal(generated.planes.some((plane) => plane.provinces.some((province) => province.terrain === "freshwater")), false);
  const markedLand = generated.planes[0]!.provinces.filter((province) => province.freshwater && !isWaterTerrain(province.terrain));
  assert.ok(markedLand.length > 0);
  assert.ok(markedLand.every((province) => !WATER_POPTYPES.has(province.poptype!)));
});

test("additive terrain flags drive water, cave, blocking, and fairness semantics", () => {
  const project = createDefaultProject("terrain-flags");
  const plane = project.planes[0]!;
  const waterStart = plane.provinces.find((province) => province.start)!;
  waterStart.terrain = "plains";
  waterStart.terrainFlags = ["sea", "forest"];
  waterStart.startType = "land"; // stale authored metadata must not override effective sea terrain
  const waterFlags = effectiveProvinceTerrainFlags(waterStart);
  assert.equal(waterFlags.has("sea"), true);
  assert.equal(waterFlags.has("forest"), true);
  assert.equal(isWaterProvince(waterStart), true);
  assert.equal(isCaveProvince(waterStart), false);

  const mixedLand = plane.provinces.find((province) => !province.start && province.id !== waterStart.id)!;
  mixedLand.terrain = "swamp";
  mixedLand.terrainFlags = ["highland"];
  const mixedFlags = effectiveProvinceTerrainFlags(mixedLand);
  assert.equal(mixedFlags.has("swamp"), true);
  assert.equal(mixedFlags.has("highland"), true);
  assert.equal(isWaterProvince(mixedLand), false);

  const wall = plane.provinces.find((province) => !province.start && province.id !== mixedLand.id)!;
  wall.terrain = "plains";
  wall.terrainFlags = ["cave", "cavewall"];
  assert.equal(isCaveProvince(wall), true);
  assert.equal(isBlockedProvince(wall), true);
  const movement = adjacencyFor(plane, { traversableOnly: true });
  assert.deepEqual(movement.get(wall.id), []);
  assert.ok([...movement.values()].every((neighbours) => !neighbours.includes(wall.id)));

  project.settings.startDistribution = { land: project.settings.players - 1, coastal: 0, water: 1, cave: 0, other: 0 };
  assert.equal(calculateFairness(project).startAllocation, 100);
});

test("explicit compatible plane graph controls gate pairs and keeps endpoints out of start rings", () => {
  let project = createDefaultProject("gate-graph-fixture");
  Object.assign(project.settings, {
    players: 8,
    provincesPerPlayer: 12,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 2, other: 2 },
    startDegreeTarget: 4,
    throneCount: 8,
    gateLayout: "compatible",
    gatePairsPerConnection: 2,
  });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 96;
  project = addPlane(project, "cave", { generate: false, provinceTarget: 60 });
  project = addPlane(project, "air", { generate: false, provinceTarget: 60 });
  project = addPlane(project, "hell", { generate: false, provinceTarget: 60 });
  project.settings.planeConnections = createDefaultPlaneConnections(project.planes, "compatible", 2);
  const enabledRules = project.settings.planeConnections.filter((rule) => rule.enabled !== false);
  assert.equal(enabledRules.length, project.planes.length - 1);

  project = generateProject(project);
  assert.equal(project.gates.length, enabledRules.reduce((sum, rule) => sum + rule.pairs, 0));
  const expectedPairs = new Set(enabledRules.map((rule) => connectionKey(rule.a, rule.b)));
  const actualPairs = new Set(project.gates.map((gate) => connectionKey(gate.endpoints[0]!.planeId, gate.endpoints[1]!.planeId)));
  assert.deepEqual(actualPairs, expectedPairs);
  assert.ok(project.gates.every((gate) => gate.direction === "bidirectional" && !gate.adjacentStartFallback));

  for (const gate of project.gates) {
    for (const endpoint of gate.endpoints) {
      const plane = project.planes.find((item) => item.id === endpoint.planeId)!;
      const province = plane.provinces.find((item) => item.id === endpoint.provinceId)!;
      const adjacency = adjacencyFor(plane, { traversableOnly: true });
      const distances = plane.provinces.filter((item) => item.start).map((start) => shortestDistances(adjacency, start.id).get(province.id) ?? 0);
      assert.equal(province.start, false);
      assert.equal(province.throne, "none");
      assert.ok(distances.length === 0 || Math.min(...distances) >= 2);
    }
  }
  const surfaceCaveGates = project.gates.filter((gate) => {
    const kinds = gate.endpoints.map((endpoint) => project.planes.find((plane) => plane.id === endpoint.planeId)!.kind);
    return kinds.includes("surface") && kinds.includes("cave");
  });
  assert.ok(surfaceCaveGates.some((gate) => gate.endpoints.some((endpoint) => {
    const plane = project.planes.find((item) => item.id === endpoint.planeId)!;
    const province = plane.provinces.find((item) => item.id === endpoint.provinceId)!;
    return plane.kind === "surface" && (province.terrain === "highland" || province.terrain === "mountains");
  })));
});

test("gate fallback is explicit, deterministic, and never consumes a start", () => {
  let project = createDefaultProject("gate-fallback-fixture");
  project = addPlane(project, "cave");
  project.settings.planeConnections = [{ a: project.planes[0]!.id, b: project.planes[1]!.id, pairs: 1 }];
  for (const plane of project.planes) {
    const start = plane.provinces.find((province) => !isWaterTerrain(province.terrain) && !province.noStart)!;
    for (const province of plane.provinces) {
      province.start = province.id === start.id;
      province.throne = province.id === start.id ? "avoid" : "preferred";
    }
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const fallbackId = (adjacency.get(start.id) ?? []).find((id) => {
      const province = plane.provinces.find((item) => item.id === id)!;
      return !province.noStart;
    })!;
    plane.provinces.find((province) => province.id === fallbackId)!.throne = "none";
  }
  const first = generateGates(project);
  const second = generateGates(project);
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0]!.adjacentStartFallback, true);
  for (const endpoint of first[0]!.endpoints) {
    const plane = project.planes.find((item) => item.id === endpoint.planeId)!;
    assert.equal(plane.provinces.find((province) => province.id === endpoint.provinceId)!.start, false);
  }
});

test("generated thrones and gates honor generic and specific start exclusion zones", () => {
  let project = createDefaultProject("specific-zone-fixture");
  const specific = project.planes[0]!.provinces.find((province) => !province.start && province.throne === "none")!;
  project.specificStarts = [{ nation: 5, planeId: project.planes[0]!.id, provinceId: specific.id }];
  project = addPlane(project, "cave", { generate: false, provinceTarget: 48 });
  project = generateProject(project);

  for (const plane of project.planes) {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const protectedIds = new Set(plane.provinces.filter((province) => province.start || province.teamStart !== undefined).map((province) => province.id));
    for (const start of project.specificStarts.filter((item) => item.planeId === plane.id)) protectedIds.add(start.provinceId);
    for (const protectedId of protectedIds) {
      const distances = shortestDistances(adjacency, protectedId);
      for (const throne of plane.provinces.filter((province) => province.throne === "preferred")) {
        assert.ok((distances.get(throne.id) ?? 0) >= 2);
      }
      for (const gate of project.gates) {
        for (const endpoint of gate.endpoints.filter((item) => item.planeId === plane.id)) {
          assert.ok((distances.get(endpoint.provinceId) ?? 0) >= 2);
        }
      }
    }
  }
});

test("multiplayer map file stems contain only manual-safe letters and underscores", () => {
  assert.equal(createDefaultProject("catalog-version").targetVersion, 635);
  assert.equal(sanitizeMapName("Map 6 - King's-Road"), "Map_King_s_Road");
  assert.match(sanitizeMapName("123 ---"), /^[A-Za-z_]+$/);
});
