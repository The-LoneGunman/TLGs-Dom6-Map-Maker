import assert from "node:assert/strict";
import test from "node:test";
import { isBlockedProvince, type Plane, type PlaneKind } from "../src/domain";
import {
  addPlane,
  adjacencyFor,
  calculateFairness,
  createDefaultProject,
  generatePlane,
  generateProject,
  graphBridgeKeys,
  isImpassableEdge,
  shortestDistances,
} from "../src/generator";
import { computeProvinceTopology, connectionKey, createProvinceOwnershipModel } from "../src/geometry";
import { validateProject } from "../src/dom6";

interface TopologyMetrics {
  connected: boolean;
  meanDegree: number;
  cycleRatio: number;
  degreeOneTwoShare: number;
  degreeTwoShare: number;
  leafShare: number;
  maxDegree: number;
  p95SpacingRatio: number;
}

function periodicDistance(a: Plane["provinces"][number], b: Plane["provinces"][number], plane: Plane): number {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (plane.wrapX) dx = Math.min(dx, 1 - dx);
  if (plane.wrapY) dy = Math.min(dy, 1 - dy);
  return Math.hypot(dx * plane.width / plane.height, dy);
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function topologyMetrics(plane: Plane): TopologyMetrics {
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const degrees = active.map((province) => adjacency.get(province.id)?.length ?? 0);
  const reachable = active.length ? shortestDistances(adjacency, active[0]!.id).size : 0;
  const nearest = active.map((province) => Math.min(...active
    .filter((other) => other !== province)
    .map((other) => periodicDistance(province, other, plane))));
  const spacing = percentile(nearest, 0.5);
  const byId = new Map(active.map((province) => [province.id, province]));
  const edgeRatios = plane.edges.flatMap((edge) => {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    return a && b ? [periodicDistance(a, b, plane) / spacing] : [];
  });
  const cycleRank = plane.edges.length - active.length + (active.length ? 1 : 0);
  return {
    connected: reachable === active.length,
    meanDegree: degrees.reduce((sum, degree) => sum + degree, 0) / Math.max(1, active.length),
    cycleRatio: cycleRank / Math.max(1, active.length),
    degreeOneTwoShare: degrees.filter((degree) => degree === 1 || degree === 2).length / Math.max(1, active.length),
    degreeTwoShare: degrees.filter((degree) => degree === 2).length / Math.max(1, active.length),
    leafShare: degrees.filter((degree) => degree === 1).length / Math.max(1, active.length),
    maxDegree: Math.max(0, ...degrees),
    p95SpacingRatio: percentile(edgeRatios, 0.95),
  };
}

function routeStructureEvidence(plane: Plane) {
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const active = plane.provinces.filter((province) => !isBlockedProvince(province));
  const degrees = active.map((province) => adjacency.get(province.id)?.length ?? 0);
  const histogram = Object.fromEntries([...new Set(degrees)].sort((a, b) => a - b)
    .map((degree) => [degree, degrees.filter((value) => value === degree).length])) as Record<number, number>;
  let diameter = 0;
  for (const province of active) {
    for (const distance of shortestDistances(adjacency, province.id).values()) diameter = Math.max(diameter, distance);
  }
  let shortCycleEdges = 0;
  for (const edge of plane.edges) {
    const withoutEdge = new Map([...adjacency].map(([id, neighbours]) => [id, neighbours.filter((neighbour) => {
      return !((id === edge.a && neighbour === edge.b) || (id === edge.b && neighbour === edge.a));
    })]));
    if ((shortestDistances(withoutEdge, edge.a).get(edge.b) ?? Infinity) <= 7) shortCycleEdges += 1;
  }
  return {
    histogram,
    diameter,
    shortCycleEdges,
    cycleRank: plane.edges.length - active.length + (active.length ? 1 : 0),
    degreeOneTwoShare: degrees.filter((degree) => degree <= 2).length / Math.max(1, active.length),
  };
}

function generatedSpecialPlane(kind: PlaneKind, seed: string, provinceTarget = 64): Plane {
  let project = createDefaultProject(`sparse-${seed}`);
  project = addPlane(project, kind, { generate: false, autoSize: false, provinceTarget });
  const source = project.planes[1]!;
  return generatePlane(source, project.settings, `${project.seed}:${kind}:profile`, 1);
}

test("fixed-seed sparse plane graphs match their chamber and route profiles", () => {
  const kinds: PlaneKind[] = ["cave", "cavern", "underworld", "cloud", "air", "hell", "abyss", "dream", "elemental"];
  const metrics = new Map<PlaneKind, TopologyMetrics>();
  for (const kind of kinds) {
    const first = generatedSpecialPlane(kind, "profile");
    const second = generatedSpecialPlane(kind, "profile");
    assert.deepEqual(first.edges, second.edges, `${kind} topology must be deterministic`);
    assert.equal(first.provinces.filter((province) => !isBlockedProvince(province)).length, first.provinceTarget,
      `${kind} owner-0 void must not consume requested playable provinces`);
    assert.equal(first.provinces.some(isBlockedProvince), false, `${kind} must not generate isolated cave-wall islands`);
    const value = topologyMetrics(first);
    metrics.set(kind, value);
    assert.equal(value.connected, true, `${kind} movement graph must be connected`);
    assert.ok(value.p95SpacingRatio <= 2.45, `${kind} p95 edge length should remain a local route (${value.p95SpacingRatio})`);
    const topology = computeProvinceTopology(first);
    assert.deepEqual([...topology.pairKeys].sort(), first.edges.map((edge) => connectionKey(edge.a, edge.b)).sort());
    assert.ok(createProvinceOwnershipModel(first).primitives.filter((primitive) => primitive.kind === "corridor").length === first.edges.length);
  }

  const cave = metrics.get("cave")!;
  assert.ok(cave.meanDegree >= 2.5 && cave.meanDegree <= 3.2);
  assert.ok(cave.cycleRatio >= 0.2 && cave.cycleRatio <= 0.36);
  assert.ok(cave.degreeTwoShare >= 0.2 && cave.degreeTwoShare <= 0.5);
  assert.ok(cave.leafShare <= 0.1);
  const cavern = metrics.get("cavern")!;
  assert.ok(cavern.meanDegree >= 2.8 && cavern.meanDegree <= 3.5);
  assert.ok(cavern.cycleRatio >= 0.3 && cavern.cycleRatio <= 0.47);
  assert.ok(cavern.degreeTwoShare >= 0.15 && cavern.degreeTwoShare <= 0.4);
  assert.ok(cavern.leafShare <= 0.08);
  const underworld = metrics.get("underworld")!;
  assert.ok(underworld.meanDegree >= 2.4 && underworld.meanDegree <= 3.1);
  assert.ok(underworld.cycleRatio >= 0.15 && underworld.cycleRatio <= 0.32);
  assert.ok(underworld.degreeTwoShare >= 0.25 && underworld.degreeTwoShare <= 0.55);
  assert.ok(underworld.leafShare <= 0.12);

  const routeBands: Partial<Record<PlaneKind, [number, number, number, number, number]>> = {
    cloud: [0.82, 0.92, 3, 0.03, 0.08], air: [0.8, 0.9, 3, 0.04, 0.1],
    hell: [0.78, 0.88, 3, 0.04, 0.1], abyss: [0.84, 0.9, 4, 0.08, 0.11],
    dream: [0.7, 0.82, 4, 0.1, 0.18], elemental: [0.7, 0.82, 4, 0.1, 0.2],
  };
  for (const [kind, [minimum, maximum, maxDegree, minimumCycles, maximumCycles]]
    of Object.entries(routeBands) as Array<[PlaneKind, [number, number, number, number, number]]>) {
    const value = metrics.get(kind)!;
    assert.ok(value.degreeOneTwoShare >= minimum && value.degreeOneTwoShare <= maximum,
      `${kind} degree-one/two share ${value.degreeOneTwoShare} must be in ${minimum}-${maximum}`);
    assert.ok(value.maxDegree <= maxDegree, `${kind} ordinary nodes must cap at degree ${maxDegree}`);
    assert.ok(value.cycleRatio >= minimumCycles && value.cycleRatio <= maximumCycles,
      `${kind} cycle ratio ${value.cycleRatio} must be in ${minimumCycles}-${maximumCycles}`);
  }
  for (const kind of ["cave", "cavern", "underworld"] as PlaneKind[]) {
    assert.ok(graphBridgeKeys(generatedSpecialPlane(kind, "profile")).size > 0, `${kind} should retain deliberate chamber bottlenecks`);
  }
});

test("abyss routes contain restrained junctions and short loops without losing long owner-zero corridors", () => {
  const canonical = generatedSpecialPlane("abyss", "profile");
  const repeat = generatedSpecialPlane("abyss", "profile");
  assert.deepEqual(canonical.edges, repeat.edges);
  const canonicalEvidence = routeStructureEvidence(canonical);
  assert.deepEqual(canonicalEvidence.histogram, { 1: 2, 2: 54, 3: 4, 4: 4 });
  assert.equal(canonicalEvidence.cycleRank, 6);
  assert.ok(canonicalEvidence.shortCycleEdges >= 8, `${canonicalEvidence.shortCycleEdges} edges participate in short alternate loops`);
  assert.ok(canonicalEvidence.diameter >= 24, `diameter ${canonicalEvidence.diameter} no longer reads as a long sparse corridor`);
  assert.ok(canonicalEvidence.degreeOneTwoShare >= 0.84, "junctions must remain restrained rather than turning the Abyss into a mesh");

  const base = createDefaultProject("abyss-junction-variants");
  const abyssSource = addPlane(base, "abyss", { generate: false, autoSize: false, provinceTarget: 64 }).planes[1]!;
  const customVoidSource: Plane = {
    ...base.planes[0]!,
    kind: "custom",
    variant: "void",
    ownershipMode: "sparse",
    autoSize: false,
    provinceTarget: 64,
  };
  const variants = [
    generatePlane({ ...abyssSource, variant: "void" }, base.settings, "abyss-junction:void", 1),
    generatePlane({ ...abyssSource, variant: "frozen" }, base.settings, "abyss-junction:frozen", 1),
    generatePlane(customVoidSource, base.settings, "abyss-junction:custom-void", 1),
  ];
  for (const plane of variants) {
    const evidence = routeStructureEvidence(plane);
    assert.equal(evidence.cycleRank, 6);
    assert.ok((evidence.histogram[3] ?? 0) + (evidence.histogram[4] ?? 0) >= 8);
    assert.ok((evidence.histogram[4] ?? 0) >= 2, "Abyss-like planes need visible four-way junctions");
    assert.ok(evidence.shortCycleEdges >= 8);
    assert.ok(evidence.diameter >= 24);
    assert.ok(evidence.degreeOneTwoShare >= 0.84);
    const topology = computeProvinceTopology(plane);
    assert.deepEqual([...topology.pairKeys].sort(), plane.edges.map((edge) => connectionKey(edge.a, edge.b)).sort());
    const ownership = createProvinceOwnershipModel(plane);
    assert.equal(ownership.primitives.filter((primitive) => primitive.kind === "corridor").length, plane.edges.length);
    let blankSamples = 0;
    const sampleCount = 48 * 30;
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 48; x += 1) {
        if (ownership.ownerAt((x + 0.5) / 48, (y + 0.5) / 30) < 0) blankSamples += 1;
      }
    }
    assert.ok(blankSamples / sampleCount >= 0.5, "Abyss junctions must preserve true owner-zero void");
  }
});

test("abyss junctions preserve bridge-safe equal-degree cave starts", () => {
  let project = createDefaultProject("abyss-junction-starts");
  Object.assign(project.settings, {
    players: 6,
    provincesPerPlayer: 12,
    startDegreeTarget: 4,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 2, other: 0 },
  });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 96;
  project = addPlane(project, "abyss", { generate: false, autoSize: false, provinceTarget: 64 });
  project = generateProject(project);
  const allDegrees: number[] = [];
  for (const plane of project.planes) {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const bridges = graphBridgeKeys(plane);
    const starts = plane.provinces.filter((province) => province.start);
    for (const start of starts) {
      const degree = adjacency.get(start.id)?.length ?? 0;
      allDegrees.push(degree);
      assert.ok(degree >= 4);
      assert.equal(plane.edges.some((edge) => (edge.a === start.id || edge.b === start.id)
        && bridges.has(connectionKey(edge.a, edge.b))), false);
      assert.equal(plane.edges.some((edge) => (edge.a === start.id || edge.b === start.id) && isImpassableEdge(edge)), false);
    }
    for (let left = 0; left < starts.length; left += 1) {
      const distances = shortestDistances(adjacency, starts[left]!.id);
      for (let right = left + 1; right < starts.length; right += 1) {
        assert.ok((distances.get(starts[right]!.id) ?? 0) >= 3);
      }
    }
  }
  assert.equal(new Set(allDegrees).size, 1);
  const abyss = project.planes.find((plane) => plane.kind === "abyss")!;
  assert.equal(abyss.provinces.filter((province) => province.startType === "cave").length, 2);
  assert.deepEqual(validateProject(project).filter((issue) => issue.severity === "error"), []);
});

test("generated sparse starts use equal bridge-safe exits and comparable two-ring access", () => {
  let project = createDefaultProject("sparse-capital-safety");
  Object.assign(project.settings, {
    players: 8,
    provincesPerPlayer: 12,
    startDegreeTarget: 4,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 2, other: 2 },
  });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 96;
  project = addPlane(project, "cave", { generate: false, autoSize: false, provinceTarget: 64 });
  project = addPlane(project, "air", { generate: false, autoSize: false, provinceTarget: 64 });
  project = generateProject(project);

  const capacities: Record<"surface" | "cave", number[]> = { surface: [], cave: [] };
  const degrees: number[] = [];
  for (const plane of project.planes) {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const bridges = graphBridgeKeys(plane);
    for (const start of plane.provinces.filter((province) => province.start)) {
      const degree = adjacency.get(start.id)?.length ?? 0;
      degrees.push(degree);
      if (plane.kind !== "surface") {
        assert.ok(degree >= 4);
        assert.equal(plane.edges.some((edge) => (edge.a === start.id || edge.b === start.id)
          && bridges.has(connectionKey(edge.a, edge.b))), false, `${plane.kind} start must not touch a graph bridge`);
      }
      assert.equal(plane.edges.some((edge) => (edge.a === start.id || edge.b === start.id)
        && (edge.kind === "impassable" || edge.kind === "mountain_border")), false);
      const capacity = [...shortestDistances(adjacency, start.id).values()].filter((distance) => distance <= 2).length;
      if (start.startType === "cave") capacities.cave.push(capacity);
      else if (start.startType === "land" || start.startType === "coastal") capacities.surface.push(capacity);
    }
  }
  assert.equal(new Set(degrees).size, 1, "every generated start should share one exact connection count");
  assert.ok(degrees[0]! >= 4);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const surfaceMean = mean(capacities.surface);
  const caveMean = mean(capacities.cave);
  assert.ok(Math.abs(caveMean - surfaceMean) <= Math.max(2, surfaceMean * 0.2),
    `cave two-ring access ${caveMean} must stay comparable to surface ${surfaceMean}`);
});

test("all sparse kind and variant combinations retain meaningful terrain variety", () => {
  const kinds: PlaneKind[] = ["cave", "cavern", "underworld", "cloud", "air", "hell", "abyss", "dream", "elemental"];
  const variants = ["temperate", "wild", "frozen", "arid", "oceanic", "fungal", "crystal", "volcanic", "storm", "infernal", "void"] as const;
  const base = createDefaultProject("variant-corpus");
  for (const kind of kinds) {
    const configured = addPlane(base, kind, { generate: false, autoSize: false, provinceTarget: 24 }).planes[1]!;
    for (const variant of variants) {
      const plane = generatePlane({ ...configured, variant }, base.settings, `qa:${kind}:${variant}`, 1);
      const terrains = new Set(plane.provinces.map((province) => province.terrain));
      assert.ok(terrains.size >= 4, `${kind}+${variant} collapsed to ${terrains.size} terrain types`);
    }
  }
});

test("large best-effort degree targets preserve categories and hard spacing before degree parity", () => {
  for (const seed of ["qa-large-degree-eight", "qa-hi-2", "qa-32-player-mixed"]) {
    let project = createDefaultProject(seed);
    Object.assign(project.settings, {
      players: 32,
      provincesPerPlayer: 8,
      waterPercent: 60,
      ...(seed === "qa-32-player-mixed" ? {
        biomeCohesion: 100,
        throneCount: 64,
        siteFrequency: 100,
        caveStartNations: [15, 59, 102, 5, 6, 7],
      } : {}),
      startDegreeTarget: 8,
      startDistribution: { land: 8, coastal: 6, water: 6, cave: 6, other: 6 },
    });
    const planeOptions = seed === "qa-32-player-mixed"
      ? { generate: false, autoSize: true }
      : { generate: false, autoSize: true, provinceTarget: 48 };
    project = addPlane(project, "cave", planeOptions);
    project = addPlane(project, "dream", planeOptions);
    project = generateProject(project);
    const actual = { land: 0, coastal: 0, water: 0, cave: 0, other: 0 };
    const degrees: number[] = [];
    for (const plane of project.planes) {
      const adjacency = adjacencyFor(plane, { traversableOnly: true });
      const starts = plane.provinces.filter((candidate) => candidate.start);
      for (const province of starts) {
        actual[province.startType!] += 1;
        degrees.push(adjacency.get(province.id)?.length ?? 0);
      }
      for (let left = 0; left < starts.length; left += 1) {
        const distances = shortestDistances(adjacency, starts[left]!.id);
        for (let right = left + 1; right < starts.length; right += 1) {
          assert.ok((distances.get(starts[right]!.id) ?? 0) >= 3,
            `${seed} placed starts ${starts[left]!.index} and ${starts[right]!.index} too close on ${plane.name}`);
        }
      }
    }
    assert.deepEqual(actual, project.settings.startDistribution, seed);
    assert.ok(degrees.every((degree) => degree >= 4 && degree <= 8));
    const issues = validateProject(project);
    assert.deepEqual(issues.filter((issue) => issue.severity === "error"), [], seed);
    assert.equal(issues.some((issue) => issue.severity === "warning" && issue.message.includes("connection counts")),
      new Set(degrees).size > 1, `${seed} must disclose any safe unequal-degree fallback`);
  }
});

test("custom neighbourspec bit 4 alone is movement-impassable", () => {
  const plane = generatedSpecialPlane("cave", "custom-special", 8);
  plane.edges = [
    { id: "custom-pass", a: plane.provinces[0]!.id, b: plane.provinces[1]!.id, kind: "custom", special: 1 },
    { id: "custom-river", a: plane.provinces[1]!.id, b: plane.provinces[2]!.id, kind: "custom", special: 2 },
    { id: "custom-wall", a: plane.provinces[2]!.id, b: plane.provinces[3]!.id, kind: "custom", special: 4 },
  ];
  const movement = adjacencyFor(plane, { traversableOnly: true });
  assert.deepEqual(movement.get(plane.provinces[0]!.id), [plane.provinces[1]!.id]);
  assert.ok(movement.get(plane.provinces[1]!.id)!.includes(plane.provinces[2]!.id));
  assert.equal(movement.get(plane.provinces[2]!.id)!.includes(plane.provinces[3]!.id), false);
  assert.equal(isImpassableEdge(plane.edges[0]!), false);
  assert.equal(isImpassableEdge(plane.edges[1]!), false);
  assert.equal(isImpassableEdge(plane.edges[2]!), true);
  assert.deepEqual(graphBridgeKeys(plane), new Set([
    connectionKey(plane.provinces[0]!.id, plane.provinces[1]!.id),
    connectionKey(plane.provinces[1]!.id, plane.provinces[2]!.id),
  ]));
});

test("small valid all-land input keeps its requested category ahead of spacing fallback", () => {
  const project = createDefaultProject("qd-2-4");
  Object.assign(project.settings, {
    players: 2,
    provincesPerPlayer: 8,
    waterPercent: 18,
    startDegreeTarget: 4,
    startDistribution: { land: 2, coastal: 0, water: 0, cave: 0, other: 0 },
  });
  const generated = generateProject(project);
  const starts = generated.planes.flatMap((plane) => plane.provinces.filter((province) => province.start));
  assert.equal(starts.length, 2);
  assert.ok(starts.every((province) => province.startType === "land"));
  assert.deepEqual(validateProject(generated).filter((issue) => issue.severity === "error"), []);
});

test("biome cohesion materially controls terrain patchiness across a seed corpus", () => {
  const base = createDefaultProject("cohesion-corpus");
  const source = { ...base.planes[0]!, provinceTarget: 96 };
  const sameTerrainShare = (plane: Plane) => {
    const byId = new Map(plane.provinces.map((province) => [province.id, province]));
    return plane.edges.filter((edge) => byId.get(edge.a)?.terrain === byId.get(edge.b)?.terrain).length / plane.edges.length;
  };
  const differences: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    const low = generatePlane(source, { ...base.settings, biomeCohesion: 0 }, `cohesion:${index}`, 1);
    const high = generatePlane(source, { ...base.settings, biomeCohesion: 100 }, `cohesion:${index}`, 1);
    differences.push(sameTerrainShare(high) - sameTerrainShare(low));
  }
  const averageDifference = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  assert.ok(averageDifference >= 0.08, `cohesion only changed same-terrain adjacency by ${averageDifference}`);
  assert.ok(differences.filter((difference) => difference > 0).length >= 9,
    `high cohesion was more clustered on only ${differences.filter((difference) => difference > 0).length}/12 seeds`);
});

test("multi-seed throne placement keeps radius-four access balanced", () => {
  const defaultRows: Array<{ seed: string; range: number; throne: number; overall: number }> = [];
  for (let index = 0; index < 6; index += 1) {
    const seed = `throne-quality-default-${index}`;
    const project = createDefaultProject(seed);
    const plane = project.planes[0]!;
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const starts = plane.provinces.filter((province) => province.start);
    const thrones = plane.provinces.filter((province) => province.throne === "preferred" || province.throne === "fixed");
    const counts = starts.map((start) => {
      const distances = shortestDistances(adjacency, start.id);
      return thrones.filter((throne) => (distances.get(throne.id) ?? 99) <= 4).length;
    });
    const fairness = calculateFairness(project);
    defaultRows.push({ seed, range: Math.max(...counts) - Math.min(...counts), throne: fairness.throneAccess, overall: fairness.overall });
  }
  assert.ok(defaultRows.every((row) => row.range <= 1), JSON.stringify(defaultRows));
  assert.ok(defaultRows.every((row) => row.throne >= 60 && row.overall >= 75), JSON.stringify(defaultRows));

  const mixedRows: Array<{ seed: string; throne: number; overall: number; connectivity: number }> = [];
  for (let index = 0; index < 10; index += 1) {
    let project = createDefaultProject(`qa-mixed-${index}`);
    Object.assign(project.settings, {
      players: 10,
      provincesPerPlayer: 12,
      waterPercent: 24,
      throneCount: 10,
      startDegreeTarget: 4,
      startDistribution: { land: 2, coastal: 2, water: 2, cave: 2, other: 2 },
    });
    project.planes[0]!.autoSize = false;
    project.planes[0]!.provinceTarget = 100;
    project = addPlane(project, "cave", { generate: false, autoSize: false, provinceTarget: 60 });
    project = addPlane(project, "air", { generate: false, autoSize: false, provinceTarget: 60 });
    project = generateProject(project);
    const fairness = calculateFairness(project);
    mixedRows.push({ seed: project.seed, throne: fairness.throneAccess, overall: fairness.overall, connectivity: fairness.connectivity });
  }
  assert.ok(mixedRows.every((row) => row.throne >= 60 && row.overall >= 70 && row.connectivity >= 85), JSON.stringify(mixedRows));
});
