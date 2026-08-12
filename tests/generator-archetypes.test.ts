import assert from "node:assert/strict";
import test from "node:test";
import {
  AQUATIC_POPTYPE_POOL,
  ARCHETYPE_POPTYPE_POOLS,
  GUARDIAN_CATALOG_POOLS,
  addPlane,
  adjacencyFor,
  calculateFairness,
  createDefaultPlaneConnections,
  createDefaultProject,
  generateGates,
  generatePlane,
  generateProject,
  globalMovementAdjacency,
  preflightStartPlan,
  scaledStartSeparationTarget,
  shortestDistances,
} from "../src/generator";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
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
  type Province,
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

function minimumGeneratedStartDistance(project: MapProject): number {
  let minimum = Infinity;
  for (const plane of project.planes) {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const starts = plane.provinces.filter((province) => province.start);
    for (let left = 0; left < starts.length; left += 1) {
      const distances = shortestDistances(adjacency, starts[left]!.id);
      for (let right = left + 1; right < starts.length; right += 1) {
        minimum = Math.min(minimum, distances.get(starts[right]!.id) ?? Infinity);
      }
    }
  }
  return minimum;
}

function caveNationFixture(seed = "cave-nation-fixture", autoSize = true): MapProject {
  let project = createDefaultProject(seed);
  Object.assign(project.settings, {
    players: 6,
    provincesPerPlayer: 12,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 2, other: 0 },
    startDegreeTarget: 4,
    caveStartNations: [15, 59, 15, 102, 2, -1],
    throneCount: 6,
  });
  project = addPlane(project, "cave", { generate: false, autoSize, provinceTarget: autoSize ? 48 : 8 });
  return generateProject(project);
}

function throneParityFixture(throneIndexes: number[]): MapProject {
  const project = createDefaultProject("throne-parity-fixture");
  const plane = project.planes[0]!;
  plane.provinces = plane.provinces.slice(0, 13).map((province, index) => ({
    ...province,
    index: index + 1,
    terrain: "plains",
    terrainFlags: undefined,
    freshwater: undefined,
    noStart: false,
    start: index === 0 || index === 12,
    startType: index === 0 || index === 12 ? "land" : undefined,
    throne: throneIndexes.includes(index) ? "preferred" : index === 0 || index === 12 ? "avoid" : "none",
    defenders: [],
    population: 8000,
  }));
  plane.provinceTarget = plane.provinces.length;
  plane.edges = plane.provinces.slice(1).map((province, index) => ({
    id: `parity-edge-${index}`,
    a: plane.provinces[index]!.id,
    b: province.id,
    kind: "standard",
  }));
  project.planes = [plane];
  project.gates = [];
  project.specificStarts = [];
  project.settings.players = 2;
  project.settings.startDistribution = { land: 2, coastal: 0, water: 0, cave: 0, other: 0 };
  return project;
}

function authoredStartThroneFixture(throneIndexes: number[]): MapProject {
  const project = throneParityFixture(throneIndexes);
  const plane = project.planes[0]!;
  const first = plane.provinces[0]!;
  const second = plane.provinces[12]!;
  first.start = true;
  first.teamStart = 0;
  second.start = false;
  second.teamStart = undefined;
  project.specificStarts = [
    { nation: 5, planeId: plane.id, provinceId: first.id },
    { nation: 6, planeId: plane.id, provinceId: first.id },
    { nation: 7, planeId: plane.id, provinceId: second.id },
  ];
  project.settings.players = 1;
  project.settings.startDistribution = { land: 1, coastal: 0, water: 0, cave: 0, other: 0 };
  return project;
}

function teamStartThroneFixture(throneIndexes: number[]): MapProject {
  const project = throneParityFixture(throneIndexes);
  const second = project.planes[0]!.provinces[12]!;
  second.start = false;
  second.startType = undefined;
  second.teamStart = 1;
  project.settings.players = 1;
  project.settings.startDistribution = { land: 1, coastal: 0, water: 0, cave: 0, other: 0 };
  return project;
}

function crossPlaneThroneFixture(gateSourceIndex: number): MapProject {
  const project = throneParityFixture([]);
  const source = project.planes[0]!;
  const provincesFor = (offset: number): Province[] => source.provinces.slice(offset, offset + 5).map((province, index) => ({
    ...province,
    index: index + 1,
    start: false,
    startType: undefined,
    teamStart: undefined,
    throne: "none" as const,
  }));
  const edgesFor = (planeId: string, provinces: Province[]) => provinces.slice(1).map((province, index) => ({
    id: `${planeId}-edge-${index}`,
    a: provinces[index]!.id,
    b: province.id,
    kind: "standard" as const,
  }));
  const planeA = { ...source, id: "cross-plane-a", provinces: provincesFor(0) };
  planeA.edges = edgesFor(planeA.id, planeA.provinces);
  const planeB = { ...source, id: "cross-plane-b", provinces: provincesFor(5) };
  planeB.edges = edgesFor(planeB.id, planeB.provinces);
  planeA.provinces[0]!.start = true;
  planeA.provinces[0]!.startType = "land";
  planeA.provinces[0]!.throne = "avoid";
  planeB.provinces[4]!.throne = "preferred";
  project.planes = [planeA, planeB];
  project.specificStarts = [{ nation: 5, planeId: planeB.id, provinceId: planeB.provinces[0]!.id }];
  project.gates = [{
    id: "cross-plane-gate",
    gateNumber: 1,
    endpoints: [
      { planeId: planeA.id, provinceId: planeA.provinces[gateSourceIndex]!.id },
      { planeId: planeB.id, provinceId: planeB.provinces[4]!.id },
    ],
  }];
  return project;
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

  const movement = globalMovementAdjacency(first);
  const allStarts = first.planes.flatMap((plane) => plane.provinces.filter((province) => province.start)
    .map((province) => ({ plane, province })));
  let hasScaleShortfall = false;
  for (const start of allStarts) {
    const globalDistances = shortestDistances(movement, `${start.plane.id}:${start.province.id}`);
    const globalNearest = Math.min(...allStarts.filter((other) => other.plane.id !== start.plane.id || other.province.id !== start.province.id)
      .map((other) => globalDistances.get(`${other.plane.id}:${other.province.id}`) ?? 99));
    const local = adjacencyFor(start.plane, { traversableOnly: true });
    const localDistances = shortestDistances(local, start.province.id);
    const localPeers = allStarts.filter((other) => other.plane.id === start.plane.id && other.province.id !== start.province.id);
    const localNearest = localPeers.length
      ? Math.min(...localPeers.map((other) => localDistances.get(other.province.id) ?? 99))
      : 99;
    const target = scaledStartSeparationTarget(start.plane.provinces.filter((province) => !isBlockedProvince(province)).length, localPeers.length + 1);
    assert.ok(globalNearest >= Math.min(localNearest, target), "generated gates must not create a closer-than-achieved scale shortcut");
    if (globalNearest >= 3 && globalNearest < target) hasScaleShortfall = true;
  }

  const fairness = calculateFairness(first);
  assert.equal(fairness.startAllocation, 100);
  assert.ok(fairness.startDegree >= 85);
  assert.ok(fairness.expansionParity >= 85);
  assert.deepEqual(validateProject(first).filter((issue) => issue.severity === "error"), []);
  assert.equal(validateProject(first).some((issue) => issue.severity === "warning"
    && issue.message.includes("Scale-aware start spacing")), hasScaleShortfall,
  "mixed sparse planes disclose an infeasible preferred spacing without blocking export");
  assert.equal(fairness.notes.some((note) => note.includes("Scale-aware start spacing")), hasScaleShortfall);
});

test("default multiplayer starts keep a hard three-move separation across a seed corpus", () => {
  const seeds = [
    "qa-default-2",
    "qa-default-3",
    "qa-default-9",
    ...Array.from({ length: 30 }, (_, index) => `default-separation-${index}`),
  ];
  for (const seed of seeds) {
    const project = generateProject(createDefaultProject(seed));
    assert.ok(minimumGeneratedStartDistance(project) >= 3, `${seed} placed capitals fewer than three moves apart`);
    assert.equal(calculateFairness(project).startAllocation, 100);
    const degrees = project.planes.flatMap((plane) => {
      const adjacency = adjacencyFor(plane, { traversableOnly: true });
      return plane.provinces.filter((province) => province.start).map((province) => adjacency.get(province.id)?.length ?? 0);
    });
    assert.equal(Math.max(...degrees), Math.min(...degrees), `${seed} lost exact start-degree parity`);
    assert.deepEqual(validateProject(project).filter((issue) => issue.severity === "error"), [], `${seed} should be export-ready`);
  }
});

test("validation catches hostile start shortcuts through the global gate graph", () => {
  let project = createDefaultProject("global-start-spacing-validator");
  Object.assign(project.settings, {
    players: 2,
    provincesPerPlayer: 12,
    startDistribution: { land: 1, coastal: 0, water: 0, cave: 1, other: 0 },
    throneCount: 2,
  });
  project = addPlane(project, "cave", { generate: false });
  project = generateProject(project);
  const surfaceStart = project.planes[0]!.provinces.find((province) => province.start)!;
  const caveStart = project.planes[1]!.provinces.find((province) => province.start)!;
  project.gates = [{
    id: "hostile-start-shortcut",
    gateNumber: 1,
    direction: "bidirectional",
    endpoints: [
      { planeId: project.planes[0]!.id, provinceId: surfaceStart.id },
      { planeId: project.planes[1]!.id, provinceId: caveStart.id },
    ],
  }];
  const spacingErrors = validateProject(project).filter((issue) => issue.severity === "error"
    && issue.message.includes("distinct multiplayer starts require at least 3"));
  assert.equal(spacingErrors.length, 1);
  assert.match(spacingErrors[0]!.message, /only 1 movement connection apart/);
});

test("preferred start spacing scales from compact to normal and large multiplayer maps", () => {
  const expectedTargets = new Map([[8, 3], [16, 4], [30, 5]]);
  for (const seed of ["scale-a", "scale-b", "scale-c"]) {
    let previousMinimum = 0;
    for (const provincesPerPlayer of [8, 16, 30]) {
      const configured = createDefaultProject(seed);
      configured.settings.provincesPerPlayer = provincesPerPlayer;
      const project = generateProject(configured);
      const plane = project.planes[0]!;
      const adjacency = adjacencyFor(plane, { traversableOnly: true });
      const starts = plane.provinces.filter((province) => province.start);
      const nearest = starts.map((start) => {
        const distances = shortestDistances(adjacency, start.id);
        return Math.min(...starts.filter((other) => other.id !== start.id).map((other) => distances.get(other.id) ?? 99));
      });
      const target = scaledStartSeparationTarget(plane.provinces.filter((province) => !isBlockedProvince(province)).length, starts.length);
      assert.equal(target, expectedTargets.get(provincesPerPlayer), `${seed} ppp${provincesPerPlayer} scale target`);
      assert.ok(Math.min(...nearest) >= 3, `${seed} ppp${provincesPerPlayer} violated the hard floor`);
      assert.ok(Math.min(...nearest) >= previousMinimum, `${seed} spacing should not shrink as the map grows`);
      assert.ok(Math.max(...nearest) - Math.min(...nearest) <= 1, `${seed} nearest-hostile distances lost equilibrium`);
      previousMinimum = Math.min(...nearest);

      for (let left = 0; left < starts.length; left += 1) {
        const leftRing = new Set(adjacency.get(starts[left]!.id) ?? []);
        for (let right = left + 1; right < starts.length; right += 1) {
          assert.equal((adjacency.get(starts[right]!.id) ?? []).some((id) => leftRing.has(id)), false,
            `${seed} ppp${provincesPerPlayer} capitals share a one-ring province`);
        }
      }
      const degrees = starts.map((start) => adjacency.get(start.id)?.length ?? 0);
      assert.ok(degrees.every((degree) => degree >= 4));
      if (provincesPerPlayer >= 16) assert.equal(new Set(degrees).size, 1, `${seed} lost feasible common-degree placement`);
      assert.equal(calculateFairness(project).startAllocation, 100);
      const scaleWarnings = validateProject(project).filter((issue) => issue.severity === "warning"
        && issue.message.includes("Scale-aware start spacing"));
      assert.equal(scaleWarnings.length > 0, Math.min(...nearest) < target,
        `${seed} ppp${provincesPerPlayer} requested/achieved spacing disclosure`);
    }
  }
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

test("high-player generation keeps the hard spacing floor across mixed and single-plane fallbacks", () => {
  let mixed = createDefaultProject("qa-fuzz:mixed-4-p16");
  Object.assign(mixed.settings, {
    players: 16,
    provincesPerPlayer: 8,
    waterPercent: 40,
    biomeCohesion: 50,
    throneCount: 16,
    startDegreeTarget: 6,
    startDistribution: { land: 4, coastal: 3, water: 3, cave: 3, other: 3 },
    gateLayout: "hub",
    gatePairsPerConnection: 2,
  });
  mixed = addPlane(mixed, "cavern", { generate: false, autoSize: true });
  mixed = addPlane(mixed, "dream", { generate: false, autoSize: true });
  mixed = generateProject(mixed);
  assert.ok(minimumGeneratedStartDistance(mixed) >= 3);
  assert.deepEqual(validateProject(mixed).filter((issue) => issue.severity === "error"), []);

  const landCases = [
    { seed: "qa-fuzz:land-5-p24-d6-ppp12-w60", players: 24, ppp: 12, water: 60, cohesion: 84, thrones: 26, degree: 6, wrapX: true, wrapY: false },
    { seed: "qa-fuzz:land-12-p24-d5-ppp8-w0", players: 24, ppp: 8, water: 0, cohesion: 40, thrones: 0, degree: 5, wrapX: false, wrapY: false },
    { seed: "qa-fuzz:land-13-p32-d6-ppp12-w18", players: 32, ppp: 12, water: 18, cohesion: 77, thrones: 34, degree: 6, wrapX: true, wrapY: false },
  ];
  for (const fixture of landCases) {
    let project = createDefaultProject(fixture.seed);
    Object.assign(project.settings, {
      players: fixture.players,
      provincesPerPlayer: fixture.ppp,
      waterPercent: fixture.water,
      biomeCohesion: fixture.cohesion,
      throneCount: fixture.thrones,
      startDegreeTarget: fixture.degree,
      startDistribution: { land: fixture.players, coastal: 0, water: 0, cave: 0, other: 0 },
    });
    project.planes[0]!.wrapX = fixture.wrapX;
    project.planes[0]!.wrapY = fixture.wrapY;
    project = generateProject(project);
    assert.ok(minimumGeneratedStartDistance(project) >= 3, fixture.seed);
    assert.deepEqual(validateProject(project).filter((issue) => issue.severity === "error"), [], fixture.seed);
  }
});

test("configured cave nations receive deterministic unique cave capitals with comparable access", () => {
  const first = caveNationFixture();
  const second = caveNationFixture();
  assert.deepEqual(canonical(first), canonical(second));
  assert.deepEqual(first.settings.caveStartNations, [15, 59, 102]);

  const caveStarts = first.planes.flatMap((plane) => plane.provinces
    .filter((province) => province.start && province.startType === "cave")
    .map((province) => ({ plane, province })));
  const overlandStarts = first.planes.flatMap((plane) => plane.provinces
    .filter((province) => province.start && (province.startType === "land" || province.startType === "coastal"))
    .map((province) => ({ plane, province })));
  assert.equal(caveStarts.length, 2);
  assert.equal(overlandStarts.length, 4);
  assert.equal(first.planes[0]!.provinceTarget, 48, "auto-sized overland capacity follows overland player count");
  assert.equal(first.planes[1]!.provinceTarget, 24, "auto-sized cave capacity follows cave player count");

  const caveAssignments = first.specificStarts.filter((start) => [15, 59, 102].includes(start.nation));
  assert.deepEqual(caveAssignments.map((start) => start.nation), [15, 59]);
  assert.equal(new Set(caveAssignments.map((start) => `${start.planeId}:${start.provinceId}`)).size, caveAssignments.length);
  assert.equal(new Set(first.specificStarts.map((start) => start.nation)).size, first.specificStarts.length);
  for (const assignment of caveAssignments) {
    const province = first.planes.find((plane) => plane.id === assignment.planeId)?.provinces.find((item) => item.id === assignment.provinceId);
    assert.equal(province?.start, true);
    assert.equal(province?.startType, "cave");
  }

  const access = (entry: { plane: MapProject["planes"][number]; province: Province }) => {
    const adjacency = adjacencyFor(entry.plane, { traversableOnly: true });
    return [...shortestDistances(adjacency, entry.province.id).values()].filter((distance) => distance <= 2).length;
  };
  const caveAccess = caveStarts.map(access);
  const overlandAccess = overlandStarts.map(access);
  const caveMean = caveAccess.reduce((sum, value) => sum + value, 0) / caveAccess.length;
  const overlandMean = overlandAccess.reduce((sum, value) => sum + value, 0) / overlandAccess.length;
  assert.ok(Math.abs(caveMean - overlandMean) <= Math.max(2, overlandMean * 0.2));
  const degrees = [...caveStarts, ...overlandStarts].map(({ plane, province }) => adjacencyFor(plane, { traversableOnly: true }).get(province.id)?.length ?? 0);
  assert.equal(Math.max(...degrees), Math.min(...degrees), "cave and overland starts share the same feasible degree");

  const unconfigured = cloneProject(first);
  unconfigured.settings.caveStartNations = [];
  unconfigured.specificStarts = [];
  const genericOnly = generateProject(unconfigured);
  assert.equal(genericOnly.planes.flatMap((plane) => plane.provinces.filter((province) => province.startType === "cave")).length, 2);
  assert.deepEqual(genericOnly.specificStarts, [], "generic native cave placement never guesses a nation ID");
});

test("cave nation assignment preserves explicit starts and reports undersized manual caves", () => {
  let project = caveNationFixture("manual-cave-capacity", false);
  const landStart = project.planes[0]!.provinces.find((province) => province.start && province.startType === "land")!;
  const caveStart = project.planes[1]!.provinces.find((province) => province.start && province.startType === "cave")!;
  project.specificStarts = [
    { nation: 15, planeId: project.planes[0]!.id, provinceId: landStart.id },
    { nation: 5, planeId: project.planes[1]!.id, provinceId: caveStart.id },
  ];
  project = generateProject(project);

  assert.equal(project.planes[1]!.provinceTarget, 8, "manual cave size is preserved");
  assert.equal(project.specificStarts.filter((start) => start.nation === 15).length, 1);
  assert.equal(new Set(project.specificStarts.map((start) => `${start.planeId}:${start.provinceId}`)).size, project.specificStarts.length);
  assert.ok(project.specificStarts.some((start) => start.nation === 59 && start.planeId === project.planes[1]!.id));
  assert.ok(project.specificStarts.some((start) => start.nation === 59 && start.source === "generated-cave"));
  assert.ok(calculateFairness(project).notes.some((note) => note.includes("Cave-plane traversable capacity per start is materially below overland")));
});

test("nearby-throne parity scores equal access at 100 and penalizes one-sided extras", () => {
  const remote = calculateFairness(throneParityFixture([6]));
  assert.equal(remote.throneAccess, 100, "a throne beyond four moves of both starts is equally remote");

  const equalNearby = calculateFairness(throneParityFixture([3, 9]));
  assert.equal(equalNearby.throneAccess, 100, "each start has exactly one throne within four moves");

  const oneSidedExtra = calculateFairness(throneParityFixture([3, 4, 9]));
  assert.equal(oneSidedExtra.throneAccess, 55);
  assert.ok(oneSidedExtra.throneAccess < equalNearby.throneAccess);
  assert.ok(oneSidedExtra.notes.some((note) => note.includes("Nearby-throne counts are uneven (1-2 within 4 moves)")));
});

test("fairness explains uneven hostile-start distances even when no capitals are too close", () => {
  const project = throneParityFixture([]);
  const middle = project.planes[0]!.provinces[4]!;
  middle.start = true;
  middle.startType = "land";
  middle.throne = "avoid";
  project.settings.players = 3;
  project.settings.startDistribution = { land: 3, coastal: 0, water: 0, cave: 0, other: 0 };

  const fairness = calculateFairness(project);
  assert.ok(fairness.startSeparation < 80);
  assert.ok(fairness.notes.some((note) => note.includes("Nearest-hostile-start distances vary considerably")));
  assert.equal(fairness.notes.includes("All headline multiplayer checks are within the target range."), false);
});

test("fairness deduplicates generic, team, and specific authored starts", () => {
  const equalNearby = calculateFairness(authoredStartThroneFixture([3, 9]));
  assert.equal(equalNearby.throneAccess, 100);
  assert.equal(equalNearby.startAllocation, 100, "specific and team annotations do not change generated-start allocation");

  const oneSidedExtra = calculateFairness(authoredStartThroneFixture([3, 4, 9]));
  assert.equal(oneSidedExtra.throneAccess, 55);
  assert.equal(oneSidedExtra.startAllocation, 100);
  assert.ok(oneSidedExtra.notes.some((note) => note.includes("1-2 within 4 moves")));
});

test("fairness includes a team-only start in geometric metrics", () => {
  const equalNearby = calculateFairness(teamStartThroneFixture([3, 9]));
  assert.equal(equalNearby.throneAccess, 100);
  assert.equal(equalNearby.startAllocation, 100, "team starts remain outside generated-start allocation");

  const oneSidedExtra = calculateFairness(teamStartThroneFixture([3, 4, 9]));
  assert.equal(oneSidedExtra.throneAccess, 55);
  assert.ok(oneSidedExtra.notes.some((note) => note.includes("1-2 within 4 moves")));
});

test("cross-plane throne proximity uses actual movement distance through gates", () => {
  const withinFour = calculateFairness(crossPlaneThroneFixture(3));
  assert.equal(withinFour.throneAccess, 100, "both starts reach the throne in exactly four moves");

  const beyondFour = calculateFairness(crossPlaneThroneFixture(4));
  assert.equal(beyondFour.throneAccess, 55, "the extra gate approach move keeps one start outside the radius");
  assert.ok(beyondFour.notes.some((note) => note.includes("0-1 within 4 moves")));
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
  const archetypeSettings = { ...base.settings, players: 2, throneCount: 4 };
  const caveKinds = new Set<PlaneKind>(["cave", "cavern", "underworld", "hell", "abyss"]);

  for (const kind of kinds) {
    const source = cloneProject(base).planes[0]!;
    source.kind = kind;
    source.variant = variants[kind];
    source.autoSize = false;
    source.provinceTarget = 48;
    const first = generatePlane(source, archetypeSettings, `archetype:${kind}`, 0);
    const second = generatePlane(source, archetypeSettings, `archetype:${kind}`, 0);
    assert.deepEqual(first, second);
    assert.ok(new Set(first.provinces.map((province) => province.terrain)).size >= (caveKinds.has(kind) ? 5 : 4));
    if (caveKinds.has(kind)) assert.ok(first.provinces.every((province) => province.terrain.startsWith("cave")));
    if (kind === "cloud" || kind === "air") {
      assert.ok(first.provinces.every((province) => ["plains", "forest", "highland", "mountains"].includes(province.terrain)));
      assert.ok(first.provinces.some((province) => province.siteBias.includes("air")));
    }
    if (kind === "hell") assert.ok(first.provinces.some((province) => province.siteBias.includes("blood")));
    const expectedLandPoptypes = kind === "elemental" && variants[kind] === "volcanic"
      ? [94]
      : ARCHETYPE_POPTYPE_POOLS[kind];
    for (const province of first.provinces.filter((item) => item.poptype !== undefined)) {
      const expected = isWaterProvince(province) ? AQUATIC_POPTYPE_POOL : expectedLandPoptypes;
      assert.ok(expected.includes(province.poptype!), `${kind} emitted off-theme poptype ${province.poptype}`);
    }
    const guardedProvinces = first.provinces.filter((province) => province.defenders.length > 0);
    assert.ok(guardedProvinces.length > 0, `${kind} must retain a themed neutral guardian away from starts`);
    const adjacency = adjacencyFor(first, { traversableOnly: true });
    const starts = first.provinces.filter((province) => province.start);
    for (const province of guardedProvinces) {
      for (const start of starts) {
        assert.ok((shortestDistances(adjacency, start.id).get(province.id) ?? 99) >= 3, `${kind} guardian entered a start two-ring`);
      }
      const theme = isWaterProvince(province)
        ? kind === "cave" || kind === "cavern" ? "cave_water"
          : kind === "underworld" ? "underworld"
            : kind === "dream" ? "dream_water"
              : kind === "elemental" ? "elemental_water"
                : "water"
        : kind;
      const pool = GUARDIAN_CATALOG_POOLS[theme];
      for (const guardian of province.defenders) {
        assert.ok(pool.commanders.includes(guardian.commander as never), `${kind} used off-theme commander ${guardian.commander}`);
        assert.ok(guardian.squads.every((squad) => pool.units.includes(squad.unit as never)), `${kind} used an off-theme troop`);
        const totalTroops = guardian.squads.reduce((sum, squad) => sum + squad.count, 0);
        if (["surface", "cave", "cavern", "custom"].includes(kind)) {
          assert.equal(guardian.squads.length, 1);
          assert.ok(totalTroops >= 8 && totalTroops <= 18);
        } else {
          assert.equal(guardian.squads.length, 2, `${kind} should be a hard special-plane expansion`);
          assert.ok(totalTroops >= 28 && totalTroops <= 48, `${kind} guardian strength left its 28-48 troop band`);
          assert.ok((guardian.experience ?? 0) >= 1);
        }
      }
    }
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

test("guardian commander and troop pools are pinned to bundled Dominions 6.35 IDs", () => {
  const catalog = new Map(BUILTIN_DOM6_CATALOG.units.map((unit) => [String(unit.id), unit.name]));
  const expectedCommanders = new Map<string, string>([
    ["34", "Commander"], ["2483", "Troglodyte Trainer"], ["614", "Harpy Queen"], ["92", "Cloud Mage"],
    ["2844", "Spectral Commander"], ["87", "Demonbred"], ["1314", "Demon General"],
    ["1609", "Demon Priest"],
    ["364", "Faydream Enchantress"], ["98", "Pyromancer"], ["103", "Hydromancer"],
    ["1893", "Imperial Geomancer"], ["1067", "Merman Captain"],
    ["1463", "Pale One Commander"], ["1471", "Pale One Captain"],
    ["651", "Eater of Dreams"], ["1572", "Merman Dreamer"],
    ["3730", "Water Elemental"], ["3374", "Marid"], ["1662", "Disease Demon"],
    ["652", "Void Lord"], ["3853", "Void Herald"],
  ]);
  for (const [theme, pool] of Object.entries(GUARDIAN_CATALOG_POOLS)) {
    for (const id of pool.commanders) {
      assert.equal(catalog.get(id), expectedCommanders.get(id), `${theme} commander ${id} is not the pinned 6.35 unit`);
      assert.equal(pool.units.includes(id as never), false, `${theme} commander ${id} leaked into its troop pool`);
    }
    for (const id of pool.units) assert.ok(catalog.has(id), `${theme} troop ${id} is absent from the bundled 6.35 catalog`);
  }
  assert.deepEqual(ARCHETYPE_POPTYPE_POOLS.cloud, [34]);
  assert.deepEqual(ARCHETYPE_POPTYPE_POOLS.air, [34]);
  assert.deepEqual(ARCHETYPE_POPTYPE_POOLS.underworld, [96]);
  assert.deepEqual(ARCHETYPE_POPTYPE_POOLS.hell, [94]);
  assert.deepEqual(ARCHETYPE_POPTYPE_POOLS.abyss, [106]);
  assert.deepEqual(ARCHETYPE_POPTYPE_POOLS.dream, [89, 106]);
  const poptypes = new Map(BUILTIN_DOM6_CATALOG.poptypes.map((entry) => [entry.id, entry.name]));
  assert.equal(poptypes.get(34), "Raptors");
  assert.equal(poptypes.get(89), "Fir Bolg");
  assert.equal(poptypes.get(94), "Lava-born");
  assert.equal(poptypes.get(96), "Bone Tribe");
  assert.equal(poptypes.get(106), "Nexus");
  for (const ids of Object.values(ARCHETYPE_POPTYPE_POOLS)) {
    for (const id of ids) assert.ok(poptypes.has(id), `poptype ${id} is absent from the bundled manual catalog`);
  }
});

test("special custom variants align poptypes, magic paths, and hard neutral guardians", () => {
  const expected: Record<"infernal" | "void" | "storm" | "wild" | "volcanic" | "oceanic", {
    theme: keyof typeof GUARDIAN_CATALOG_POOLS;
    waterTheme: keyof typeof GUARDIAN_CATALOG_POOLS;
    poptypes: readonly number[];
    path: "fire" | "death" | "air" | "glamour" | "water";
  }> = {
    infernal: { theme: "hell", waterTheme: "hell_water", poptypes: [94], path: "fire" },
    void: { theme: "abyss", waterTheme: "abyss_water", poptypes: [106], path: "death" },
    storm: { theme: "air", waterTheme: "storm_water", poptypes: [34], path: "air" },
    wild: { theme: "dream", waterTheme: "dream_water", poptypes: [37, 89], path: "glamour" },
    volcanic: { theme: "elemental", waterTheme: "elemental_water", poptypes: [94], path: "fire" },
    oceanic: { theme: "custom", waterTheme: "water", poptypes: ARCHETYPE_POPTYPE_POOLS.custom, path: "water" },
  };
  const base = createDefaultProject("custom-special-guardians");
  const settings = { ...base.settings, players: 2, throneCount: 4 };
  for (const [variant, spec] of Object.entries(expected) as Array<[keyof typeof expected, (typeof expected)[keyof typeof expected]]>) {
    const source = cloneProject(base).planes[0]!;
    source.kind = "custom";
    source.variant = variant;
    source.autoSize = false;
    source.provinceTarget = 48;
    const plane = generatePlane(source, settings, `custom-special:${variant}`, 0);
    const land = plane.provinces.filter((province) => !isWaterProvince(province) && province.poptype !== undefined);
    assert.ok(land.every((province) => spec.poptypes.includes(province.poptype!)), `${variant} custom poptypes drifted off theme`);
    assert.ok(plane.provinces.some((province) => province.siteBias.includes(spec.path)), `${variant} custom sites lost ${spec.path}`);
    const guardians = plane.provinces.flatMap((province) => province.defenders.map((guardian) => ({ province, guardian })));
    assert.ok(guardians.length > 0);
    for (const { province, guardian } of guardians) {
      const pool = GUARDIAN_CATALOG_POOLS[isWaterProvince(province) ? spec.waterTheme : spec.theme];
      assert.ok(pool.commanders.includes(guardian.commander as never));
      assert.ok(guardian.squads.every((squad) => pool.units.includes(squad.unit as never)));
      assert.equal(guardian.squads.length, 2);
      assert.ok(guardian.squads.reduce((sum, squad) => sum + squad.count, 0) >= 28);
      assert.equal(province.owner, undefined, "independent guardian generation must not emit playable-owner #defence semantics");
    }
  }
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
  for (const reserved of ["CON", "con", "PRN", "AUX", "NUL"]) {
    assert.equal(sanitizeMapName(reserved), `${reserved}_map`);
  }
});

test("start-plan preflight rejects impossible plane-family allocations before generation", () => {
  const project = createDefaultProject("start-plan-preflight");
  project.settings.players = 6;
  project.settings.startDistribution = { land: 5, coastal: 0, water: 0, cave: 0, other: 1 };
  assert.deepEqual(preflightStartPlan(project), ["1 other-plane start needs a Cloud, Air, Dream, or Elemental plane."]);

  const withDream = addPlane(project, "dream", { generate: false, autoSize: true });
  assert.deepEqual(preflightStartPlan(withDream), []);

  withDream.settings.startDistribution = { land: 4, coastal: 0, water: 0, cave: 2, other: 0 };
  assert.ok(preflightStartPlan(withDream).some((message) => message.includes("need a Cave")));
});
