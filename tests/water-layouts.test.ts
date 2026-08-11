import assert from "node:assert/strict";
import test from "node:test";
import {
  AQUATIC_POPTYPE_POOL,
  GUARDIAN_CATALOG_POOLS,
  ISLAND_CHAIN_MIN_WATER_PERCENT,
  VERIFIED_WATER_CAPABLE_GUARDIAN_IDS,
  addPlane,
  adjacencyFor,
  createDefaultProject,
  generatePlane,
  generateProject,
  shortestDistances,
} from "../src/generator";
import {
  cloneProject,
  effectiveProvinceTerrainFlags,
  isBlockedProvince,
  isWaterProvince,
  type OceanLayout,
  type Plane,
  type Province,
} from "../src/domain";
import { TERRAIN_BITS, terrainMask, validateProject } from "../src/dom6";
import { provinceNameContext } from "../src/naming";

function components(plane: Plane, predicate: (province: Province) => boolean, ignoreBridges = false): Province[][] {
  const eligible = new Map(plane.provinces.filter(predicate).map((province) => [province.id, province]));
  const adjacency = new Map([...eligible.keys()].map((id) => [id, [] as string[]]));
  for (const edge of plane.edges) {
    if (ignoreBridges && edge.kind === "bridge") continue;
    if (!eligible.has(edge.a) || !eligible.has(edge.b) || edge.kind === "impassable") continue;
    adjacency.get(edge.a)!.push(edge.b);
    adjacency.get(edge.b)!.push(edge.a);
  }
  const unseen = new Set(eligible.keys());
  const result: Province[][] = [];
  while (unseen.size) {
    const queue = [unseen.values().next().value as string];
    unseen.delete(queue[0]!);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbour of adjacency.get(queue[cursor]!) ?? []) {
        if (!unseen.delete(neighbour)) continue;
        queue.push(neighbour);
      }
    }
    result.push(queue.map((id) => eligible.get(id)!));
  }
  return result.sort((a, b) => b.length - a.length);
}

function structuralOcean(mode: OceanLayout, seed = `ocean-structure-${mode}`): Plane {
  const base = createDefaultProject(seed);
  return generatePlane(
    { ...base.planes[0]!, autoSize: false, provinceTarget: 120, wrapX: false, wrapY: false },
    { ...base.settings, waterPercent: 40, oceanLayout: mode, continentCount: 3 },
    seed,
    0,
    { deferStrategicFeatures: true },
  );
}

test("overland ocean layouts preserve requested quotas except the documented island-chain minimum", () => {
  const modes: OceanLayout[] = ["natural", "single_continent", "multiple_continents", "island_chains", "inland_sea"];
  for (const mode of modes) {
    for (const wraps of [false, true]) {
      const base = createDefaultProject(`quota-${mode}-${wraps}`);
      const source = { ...base.planes[0]!, autoSize: false, provinceTarget: 80, wrapX: wraps, wrapY: wraps };
      const settings = { ...base.settings, waterPercent: 35, oceanLayout: mode, continentCount: 4 };
      const first = generatePlane(source, settings, `quota-${mode}-${wraps}`, 0, { deferStrategicFeatures: true });
      const second = generatePlane(source, settings, `quota-${mode}-${wraps}`, 0, { deferStrategicFeatures: true });
      const expected = mode === "island_chains"
        ? Math.round(80 * ISLAND_CHAIN_MIN_WATER_PERCENT / 100)
        : 28;
      assert.equal(first.provinces.filter(isWaterProvince).length, expected, `${mode} used the wrong effective water quota`);
      assert.deepEqual(first, second, `${mode} must be deterministic`);
    }
  }
});

test("ocean layout presets produce distinct measurable continent structures", () => {
  const single = structuralOcean("single_continent");
  const multiple = structuralOcean("multiple_continents");
  const islands = structuralOcean("island_chains");
  const inland = structuralOcean("inland_sea");
  const land = (plane: Plane) => plane.provinces.filter((province) => !isWaterProvince(province));
  const coastRatio = (plane: Plane) => {
    const adjacency = adjacencyFor(plane);
    const byId = new Map(plane.provinces.map((province) => [province.id, province]));
    const dry = land(plane);
    return dry.filter((province) => (adjacency.get(province.id) ?? []).some((id) => isWaterProvince(byId.get(id)!))).length / dry.length;
  };

  assert.equal(components(single, (province) => !isWaterProvince(province)).length, 1, "single-continent land should be one dominant mass");
  const multipleLand = components(multiple, (province) => !isWaterProvince(province));
  assert.equal(multipleLand.length, 3, "three requested continents should form three major land components at a viable quota");
  assert.ok(multipleLand.every((component) => component.length >= 20));
  assert.ok(coastRatio(islands) >= coastRatio(single) + 0.2, "island chains should create materially more coastline");

  const inlandWater = components(inland, isWaterProvince);
  assert.equal(inlandWater.length, 1, "the inland sea should be one connected water body");
  assert.equal(components(inland, (province) => !isWaterProvince(province)).length, 1, "land should enclose the inland sea");
  assert.ok(inlandWater[0]!.every((province) => Math.min(province.x, 1 - province.x, province.y, 1 - province.y) > 0.08));
});

test("ocean presets retain their topology at the ordinary 96-province, 18% wrapped defaults", () => {
  for (let index = 0; index < 5; index += 1) {
    for (const mode of ["multiple_continents", "island_chains", "inland_sea"] as OceanLayout[]) {
      const seed = `release-${mode}-${index}`;
      const base = createDefaultProject(seed);
      const plane = generatePlane(
        { ...base.planes[0]!, autoSize: false, provinceTarget: 96, wrapX: true, wrapY: true },
        { ...base.settings, waterPercent: 18, oceanLayout: mode, continentCount: 3 },
        seed,
        0,
        { deferStrategicFeatures: true },
      );
      const land = components(plane, (province) => !isWaterProvince(province));
      const water = components(plane, isWaterProvince);
      if (mode === "multiple_continents") {
        assert.equal(plane.provinces.filter(isWaterProvince).length, 17);
        assert.equal(land.length, 2, "18% water on a wrapped atlas honestly normalizes three requested continents to two");
        assert.ok(land.every((component) => component.length >= 32));
      } else if (mode === "island_chains") {
        assert.equal(plane.provinces.filter(isWaterProvince).length, 46);
        assert.equal(water.length, 1);
        assert.ok(land.length >= 3, "island chains must remain visibly separated at default project size");
      } else {
        assert.equal(plane.provinces.filter(isWaterProvince).length, 17);
        assert.equal(water.length, 1);
        assert.equal(land.length, 1);
      }
    }
  }

  const pendingIslands = createDefaultProject("island-minimum-warning");
  pendingIslands.settings.oceanLayout = "island_chains";
  pendingIslands.settings.waterPercent = 18;
  assert.ok(validateProject(pendingIslands).some((issue) => issue.message.includes("require at least 48%")));
  const generatedIslands = generateProject(pendingIslands);
  assert.equal(generatedIslands.settings.waterPercent, ISLAND_CHAIN_MIN_WATER_PERCENT);

  const pendingMultiple = createDefaultProject("multiple-achieved-warning");
  pendingMultiple.settings.oceanLayout = "multiple_continents";
  pendingMultiple.settings.continentCount = 3;
  pendingMultiple.settings.waterPercent = 18;
  const generatedMultiple = generateProject(pendingMultiple);
  assert.equal(components(generatedMultiple.planes[0]!, (province) => !isWaterProvince(province)).length, 2);
  assert.ok(validateProject(generatedMultiple).some((issue) => issue.message.includes("sustain 2")));
});

test("feasible two-through-six continent plans create the requested authoritative movement components", () => {
  for (const wraps of [false, true]) {
    for (let requested = 2; requested <= 6; requested += 1) {
      const seed = `feasible-multi-${requested}-40-${wraps}-1`;
      const base = createDefaultProject(seed);
      const plane = generatePlane(
        { ...base.planes[0]!, autoSize: false, provinceTarget: 120, wrapX: wraps, wrapY: wraps },
        { ...base.settings, waterPercent: 40, oceanLayout: "multiple_continents", continentCount: requested },
        seed,
        0,
        { deferStrategicFeatures: true },
      );
      assert.equal(components(plane, (province) => !isWaterProvince(province)).length, requested);
      assert.equal(plane.provinces.filter(isWaterProvince).length, 48);
    }
  }

  const seed = "audit-single_continent-64-60-false-1";
  const base = createDefaultProject(seed);
  const single = generatePlane(
    { ...base.planes[0]!, autoSize: false, provinceTarget: 64, wrapX: false, wrapY: false },
    { ...base.settings, waterPercent: 60, oceanLayout: "single_continent" },
    seed,
    0,
    { deferStrategicFeatures: true },
  );
  assert.equal(single.provinces.filter(isWaterProvince).length, 38);
  assert.equal(components(single, (province) => !isWaterProvince(province)).length, 1);
});

test("Cave and Cavern flooding stays additive Sea+Cave with aquatic recruitment and guardians", () => {
  let project = createDefaultProject("flooded-cave-sea");
  project.settings = {
    ...project.settings,
    players: 6,
    provincesPerPlayer: 12,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 2, other: 0 },
    throneCount: 0,
  };
  project = addPlane(project, "cave", { generate: false, autoSize: false, provinceTarget: 48 });
  project = generateProject(project);
  const cave = project.planes[1]!;
  const flooded = cave.provinces.filter(isWaterProvince);
  assert.ok(flooded.length >= 2);
  assert.equal(components(cave, isWaterProvince).length, 1, "flooded cave provinces should form one connected chamber system");
  for (const province of flooded) {
    const flags = effectiveProvinceTerrainFlags(province);
    assert.equal(flags.has("sea"), true);
    assert.equal(flags.has("cave"), true);
    assert.equal(province.terrain.startsWith("cave"), true, "water must not erase the cave visual primary");
    assert.ok(AQUATIC_POPTYPE_POOL.includes(province.poptype!));
    assert.ok(province.siteBias.includes("water"));
    const mask = terrainMask(province);
    assert.notEqual(mask & TERRAIN_BITS.sea, 0n);
    assert.notEqual(mask & TERRAIN_BITS.cave, 0n);
  }
  assert.ok(cave.provinces.filter((province) => province.startType === "cave").every((province) => !isWaterProvince(province)));
  const floodedGuardians = flooded.flatMap((province) => province.defenders);
  assert.ok(floodedGuardians.length >= 1);
  assert.ok(floodedGuardians.every((guardian) => GUARDIAN_CATALOG_POOLS.cave_water.commanders.includes(guardian.commander as never)
    && guardian.squads.every((squad) => GUARDIAN_CATALOG_POOLS.cave_water.units.includes(squad.unit as never))));
});

test("all flooded-cave and Styx guardian IDs are pinned water-capable units", () => {
  const verified = new Set<string>(VERIFIED_WATER_CAPABLE_GUARDIAN_IDS);
  for (const theme of [GUARDIAN_CATALOG_POOLS.water, GUARDIAN_CATALOG_POOLS.cave_water, GUARDIAN_CATALOG_POOLS.underworld]) {
    for (const id of [...theme.commanders, ...theme.units]) assert.ok(verified.has(id), `${id} lacks a pinned aquatic/amphibious capability`);
  }
});

test("the River Styx spans the Underworld and leaves exactly two connected banks with controlled bridges", () => {
  let project = createDefaultProject("river-styx-bisection");
  project.settings = { ...project.settings, throneCount: 0 };
  project = addPlane(project, "underworld", { generate: false, autoSize: false, provinceTarget: 64 });
  assert.equal(project.planes[1]!.wrapX, false);
  assert.equal(project.planes[1]!.wrapY, false);
  project = generateProject(project);
  const underworld = project.planes[1]!;
  const styx = underworld.provinces.filter(isWaterProvince);
  assert.ok(styx.length >= Math.floor(underworld.provinces.length * 0.18));
  assert.equal(components(underworld, isWaterProvince).length, 1, "the Styx water movement network must be connected");
  const spansX = Math.min(...styx.map((province) => province.x)) <= 0.2 && Math.max(...styx.map((province) => province.x)) >= 0.8;
  const spansY = Math.min(...styx.map((province) => province.y)) <= 0.2 && Math.max(...styx.map((province) => province.y)) >= 0.8;
  assert.equal(spansX || spansY, true, "the Styx must reach opposite sides of the plane");
  const banks = components(underworld, (province) => !isWaterProvince(province), true);
  assert.equal(banks.length, 2, "removing Styx water and designated bridges must reveal exactly two dry banks");
  assert.ok(banks.every((bank) => bank.length >= underworld.provinces.length * 0.18));
  const crossings = underworld.edges.filter((edge) => edge.kind === "bridge");
  assert.ok(crossings.length >= 1 && crossings.length <= 2);
  assert.ok(styx.every((province) => effectiveProvinceTerrainFlags(province).has("cave") && province.siteBias.includes("water") && province.siteBias.includes("death")));
  assert.ok(styx.every((province) => province.name.trim().length > 0
    && provinceNameContext(underworld, province).terrainThemes.includes("styx")));
  const guarded = styx.flatMap((province) => province.defenders);
  assert.ok(guarded.length >= 1);
  assert.ok(guarded.every((guardian) => GUARDIAN_CATALOG_POOLS.underworld.commanders.includes(guardian.commander as never)
    && guardian.squads.every((squad) => GUARDIAN_CATALOG_POOLS.underworld.units.includes(squad.unit as never))));

  const wrapped = cloneProject(project);
  wrapped.planes[1]!.wrapX = true;
  wrapped.planes[1]!.wrapY = true;
  assert.ok(validateProject(wrapped).some((issue) => issue.planeId === wrapped.planes[1]!.id && issue.message.includes("River Styx") && issue.message.includes("torus")));
});

test("the River Styx bisection invariant survives every supported small-plane band", () => {
  for (const size of [8, 18, 24, 64]) {
    for (let index = 0; index < 3; index += 1) {
      const seed = `styx-audit-${size}-${index}`;
      const base = createDefaultProject(seed);
      const source = addPlane(base, "underworld", { generate: false, autoSize: false, provinceTarget: size }).planes[1]!;
      const first = generatePlane(source, base.settings, seed, 1, { deferStrategicFeatures: true });
      const second = generatePlane(source, base.settings, seed, 1, { deferStrategicFeatures: true });
      assert.deepEqual(first, second);
      const styx = first.provinces.filter(isWaterProvince);
      assert.equal(components(first, isWaterProvince).length, 1);
      assert.equal(components(first, (province) => !isWaterProvince(province) && !isBlockedProvince(province), true).length, 2);
      assert.equal(components(first, (province) => !isBlockedProvince(province)).length, 1);
      assert.ok(first.edges.filter((edge) => edge.kind === "bridge").length >= 1
        && first.edges.filter((edge) => edge.kind === "bridge").length <= 2);
      const coordinate = (province: Province) => first.width >= first.height ? province.x : province.y;
      assert.ok(Math.min(...styx.map(coordinate)) <= 0.2 && Math.max(...styx.map(coordinate)) >= 0.8);
    }
  }
});

test("surface-to-subterranean gate plans retain dry entrances and add bounded aquatic pairs only when viable", () => {
  const fixture = (seed: string, caveSize: number) => {
    let project = createDefaultProject(seed);
    project.settings = {
      ...project.settings,
      players: 4,
      provincesPerPlayer: 16,
      waterPercent: 35,
      startDistribution: { land: 4, coastal: 0, water: 0, cave: 0, other: 0 },
      throneCount: 0,
      gatePairsPerConnection: 2,
    };
    project.planes[0]!.autoSize = false;
    project.planes[0]!.provinceTarget = 80;
    project = addPlane(project, "cave", { generate: false, autoSize: false, provinceTarget: caveSize });
    project.settings.planeConnections = [{ a: project.planes[0]!.id, b: project.planes[1]!.id, pairs: 2, enabled: true }];
    return generateProject(project);
  };
  const viable = fixture("aquatic-gates-viable", 48);
  const endpointWater = viable.gates.map((gate) => gate.endpoints.map((endpoint) => {
    const plane = viable.planes.find((item) => item.id === endpoint.planeId)!;
    return isWaterProvince(plane.provinces.find((province) => province.id === endpoint.provinceId)!);
  }));
  assert.deepEqual(endpointWater.sort(), [[false, false], [true, true]].sort());
  for (const gate of viable.gates) {
    for (const endpoint of gate.endpoints) {
      const plane = viable.planes.find((item) => item.id === endpoint.planeId)!;
      const adjacency = adjacencyFor(plane, { traversableOnly: true });
      const startIds = plane.provinces.filter((province) => province.start).map((province) => province.id);
      assert.ok(startIds.every((startId) => (shortestDistances(adjacency, startId).get(endpoint.provinceId) ?? 99) >= 2));
    }
  }
  const repeated = fixture("aquatic-gates-viable", 48);
  repeated.createdAt = viable.createdAt;
  repeated.updatedAt = viable.updatedAt;
  assert.deepEqual(repeated, viable, "aquatic gate choice must be deterministic");

  const cramped = fixture("aquatic-gates-cramped", 8);
  assert.equal(cramped.planes[1]!.provinces.filter(isWaterProvince).length, 2, "the cave side stays below the three-province viability threshold");
  assert.ok(cramped.gates.every((gate) => gate.endpoints.every((endpoint) => {
    const plane = cramped.planes.find((item) => item.id === endpoint.planeId)!;
    return !isWaterProvince(plane.provinces.find((province) => province.id === endpoint.provinceId)!);
  })));

  for (const [seed, size] of [["gate-audit-8-2-3", 8], ["gate-audit-18-2-3", 18], ["gate-audit-48-2-3", 48]] as const) {
    const project = fixture(seed, size);
    for (const gate of project.gates) {
      const statuses = gate.endpoints.map((endpoint) => {
        const plane = project.planes.find((item) => item.id === endpoint.planeId)!;
        return isWaterProvince(plane.provinces.find((province) => province.id === endpoint.provinceId)!);
      });
      assert.equal(new Set(statuses).size, 1, `${seed} exported a mixed dry/aquatic gate`);
    }
  }

  const invalid = cloneProject(viable);
  const gate = invalid.gates[0]!;
  const subterraneanEndpoint = gate.endpoints.find((endpoint) => invalid.planes.find((plane) => plane.id === endpoint.planeId)!.kind === "cave")!;
  const subterraneanPlane = invalid.planes.find((plane) => plane.id === subterraneanEndpoint.planeId)!;
  subterraneanEndpoint.provinceId = subterraneanPlane.provinces.find((province) => isWaterProvince(province)
    !== isWaterProvince(invalid.planes[0]!.provinces.find((province) => province.id === gate.endpoints.find((endpoint) => endpoint.planeId === invalid.planes[0]!.id)!.provinceId)!))!.id;
  assert.ok(validateProject(invalid).some((issue) => issue.severity === "error" && issue.message.includes("mixes a dry endpoint")));
});

test("bonus plane auto-sizing uses the final combined core total without compounding", () => {
  const build = (order: Array<"cave" | "air" | "dream">, percent: number) => {
    let project = createDefaultProject(`bonus-size-${order.join("-")}-${percent}`);
    project.settings = {
      ...project.settings,
      players: 6,
      provincesPerPlayer: 12,
      startDistribution: { land: 4, coastal: 0, water: 0, cave: 2, other: 0 },
      specialPlaneSizePercent: percent,
      throneCount: 0,
    };
    for (const kind of order) project = addPlane(project, kind, { generate: false, autoSize: true });
    return generateProject(project);
  };
  const first = build(["cave", "air", "dream"], 30);
  assert.deepEqual(first.planes.map((plane) => [plane.kind, plane.provinceTarget]), [
    ["surface", 48], ["cave", 24], ["air", 22], ["dream", 22],
  ]);
  const reordered = build(["dream", "cave", "air"], 30);
  assert.equal(reordered.planes.find((plane) => plane.kind === "air")!.provinceTarget, 22);
  assert.equal(reordered.planes.find((plane) => plane.kind === "dream")!.provinceTarget, 22);
  assert.equal(build(["cave", "air"], 150).planes.find((plane) => plane.kind === "air")!.provinceTarget, 108);

  let capped = createDefaultProject("bonus-size-cap");
  capped.settings = { ...capped.settings, specialPlaneSizePercent: 500, throneCount: 0 };
  capped.planes[0]!.autoSize = false;
  capped.planes[0]!.provinceTarget = 200;
  capped = addPlane(capped, "air", { generate: false, autoSize: true });
  capped = generateProject(capped);
  assert.equal(capped.planes[1]!.provinceTarget, 800);

  let manual = createDefaultProject("bonus-size-manual");
  manual.settings = { ...manual.settings, specialPlaneSizePercent: 500, throneCount: 0 };
  manual = addPlane(manual, "air", { generate: false, autoSize: false, provinceTarget: 37 });
  manual = generateProject(manual);
  assert.equal(manual.planes[1]!.provinceTarget, 37);
});

test("bonus realms fill a material 22-30% of safe expansion provinces with strong themed guardians", () => {
  const profiles = [
    ["cloud", "storm"], ["air", "storm"], ["underworld", "fungal"], ["hell", "infernal"],
    ["abyss", "void"], ["dream", "wild"], ["elemental", "volcanic"], ["custom", "infernal"],
  ] as const;
  for (const [kind, variant] of profiles) {
    const base = createDefaultProject(`guardian-coverage-${kind}`);
    const plane = generatePlane({
      ...base.planes[0]!,
      kind,
      variant,
      autoSize: false,
      provinceTarget: 64,
      wrapX: kind === "underworld" ? false : true,
      wrapY: kind === "underworld" ? false : true,
    }, { ...base.settings, players: 2, throneCount: 0 }, `guardian-coverage-${kind}`, 0);
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const starts = plane.provinces.filter((province) => province.start);
    const safe = plane.provinces.filter((province) => starts.every((start) =>
      (shortestDistances(adjacency, start.id).get(province.id) ?? 99) > 2));
    const guarded = safe.filter((province) => province.defenders.length > 0);
    const share = guarded.length / safe.length;
    assert.ok(share >= 0.22 && share <= 0.3, `${kind} guardian coverage ${share} left the 22-30% band`);
    for (const province of guarded) {
      for (const guardian of province.defenders) {
        assert.equal(guardian.squads.length, 2);
        assert.ok(guardian.squads.reduce((sum, squad) => sum + squad.count, 0) >= 28);
        assert.ok((guardian.experience ?? 0) >= 1);
      }
    }
  }
});

test("flooded terrain and aquatic gates remain valid in a deterministic eight-plane atlas", () => {
  const build = () => {
    let project = createDefaultProject("eight-plane-flooded-regression");
    project.settings = {
      ...project.settings,
      players: 2,
      provincesPerPlayer: 8,
      waterPercent: 35,
      startDistribution: { land: 2, coastal: 0, water: 0, cave: 0, other: 0 },
      throneCount: 0,
      gatePairsPerConnection: 2,
    };
    project.planes[0]!.autoSize = false;
    project.planes[0]!.provinceTarget = 32;
    for (const kind of ["cave", "cavern", "cloud", "underworld", "hell", "abyss", "dream"] as const) {
      project = addPlane(project, kind, { generate: false, autoSize: false, provinceTarget: 24 });
    }
    return generateProject(project);
  };
  const first = build();
  const second = build();
  second.createdAt = first.createdAt;
  second.updatedAt = first.updatedAt;
  assert.deepEqual(second, first);
  assert.equal(first.planes.length, 8);
  assert.ok(first.planes.filter((plane) => plane.kind === "cave" || plane.kind === "cavern" || plane.kind === "underworld")
    .every((plane) => plane.provinces.some((province) => {
      const flags = effectiveProvinceTerrainFlags(province);
      return flags.has("sea") && flags.has("cave");
    })));
  assert.deepEqual(validateProject(first).filter((issue) => issue.severity === "error"), []);
});
