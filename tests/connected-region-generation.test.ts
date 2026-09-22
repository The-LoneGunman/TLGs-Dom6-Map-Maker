import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { protectedStartProvinceKeys } from "../src/authoringLocks";
import { buildConnectedRegionPlan, connectedRegionLayoutNotice } from "../src/connectedRegions";
import { isBlockedProvince, isWaterProvince, nationSpecificStartFeatureConflicts, type Plane, type PlaneKind, type Province } from "../src/domain";
import { compileMapText, validateProject } from "../src/dom6";
import { addPlane, adjacencyFor, createDefaultProject, generatePlane, generateProject, graphBridgeKeys, isImpassableEdge, shortestDistances } from "../src/generator";
import { connectionKey, usesConnectedRegions } from "../src/geometry";

const regionalKinds: readonly PlaneKind[] = ["cave", "cavern", "cloud", "air", "hell", "abyss", "dream", "elemental", "surface", "custom"];

function legacySource(kind: PlaneKind) {
  const project = createDefaultProject("connected-regions-legacy-baseline", { generate: false });
  project.settings.throneCount = 0;
  const source: Plane = { ...project.planes[0]!, id: `legacy-${kind}`, kind, ownershipMode: "sparse",
    autoSize: false, noGeneratedStarts: true, provinceTarget: 48, width: 512, height: 384, wrapX: true, wrapY: false };
  return { project, source, seed: `connected-regions-legacy:${kind}` };
}

function withoutLayout(plane: Plane) {
  const copy = structuredClone(plane);
  delete copy.sparseLayout;
  return copy;
}

function edgeKeys(plane: Plane) {
  return plane.edges.map(edge => connectionKey(edge.a, edge.b)).sort();
}

function expectedRegionKeys(plane: Plane) {
  const plan = buildConnectedRegionPlan(plane);
  return [...new Set([
    ...plan.treePairs.map(pair => connectionKey(plane.provinces[pair.a]!.id, plane.provinces[pair.b]!.id)),
    ...plan.regionPairs.map(pair => pair.key),
  ])].sort();
}

test("all non-Underworld sparse archetypes generate connected regions regardless of legacy layout markers", () => {
  for (const kind of regionalKinds) {
    const { project, source, seed } = legacySource(kind);
    const before = JSON.stringify([source, project.settings]);
    const absent = generatePlane(source, project.settings, seed, 1, { deferStrategicFeatures: true });
    const explicit = generatePlane({ ...source, sparseLayout: "chambers" }, project.settings, seed, 1, { deferStrategicFeatures: true });
    const regions = generatePlane({ ...source, sparseLayout: "regions" }, project.settings, seed, 1, { deferStrategicFeatures: true });
    assert.deepEqual(withoutLayout(explicit), withoutLayout(absent), `${kind}: retired chambers setting must not generate a classic layout`);
    assert.deepEqual(withoutLayout(regions), withoutLayout(absent), `${kind}: regions must be the sole new-generation default`);
    assert.ok(usesConnectedRegions(absent), kind);
    assert.deepEqual(edgeKeys(absent), expectedRegionKeys(absent), kind);
    assert.equal(connectedRegionLayoutNotice(absent), undefined, `${kind}: new generation must not need compatibility rendering`);
    assert.equal(JSON.stringify([source, project.settings]), before, `${kind}: generation must not mutate its source`);
  }
});

test("Underworld regions settings leave Styx generation and native commands unchanged", () => {
  const { project, source, seed } = legacySource("underworld");
  project.settings.biomeCohesion = 68; // Historical fixture's explicit setting, not the evolving new-map default.
  const oldPlane = generatePlane(source, project.settings, seed, 1, { deferStrategicFeatures: true });
  const opted = generatePlane({ ...source, sparseLayout: "regions" }, project.settings, seed, 1, { deferStrategicFeatures: true });
  // Ignore applied provenance when comparing the historical gameplay records.
  assert.equal(createHash("sha256").update(JSON.stringify(oldPlane, (key, value) => key === "landformStyle" || key === "generationKey" ? undefined : value)).digest("hex"), "9a1132ae0e2f4cec4408ce543e35ae1f9698e390058d8b42a7d0dad7e11d9ef0");
  assert.equal(usesConnectedRegions(oldPlane), false);
  assert.deepEqual(withoutLayout(opted), oldPlane);
  assert.ok(oldPlane.provinces.some(isWaterProvince));
  const oldMap = { ...project, planes: [oldPlane] }, optedMap = { ...project, planes: [opted] };
  assert.equal(compileMapText(optedMap, 0), compileMapText(oldMap, 0));
});

test("solid ownership ignores the sparse layout choice and retains its complete generated state", () => {
  const { project, source, seed } = legacySource("surface");
  source.ownershipMode = "solid";
  const oldPlane = generatePlane(source, project.settings, seed, 1, { deferStrategicFeatures: true });
  const opted = generatePlane({ ...source, sparseLayout: "regions" }, project.settings, seed, 1, { deferStrategicFeatures: true });
  assert.deepEqual(withoutLayout(opted), oldPlane);
});

for (const kind of ["cave", "cavern", "cloud", "air", "hell", "abyss", "dream", "elemental", "custom"] as const) {
  test(`${kind}: regions generation uses exactly the new spatial tree and intra-region contacts`, () => {
    const { project, source } = legacySource(kind);
    source.provinceTarget = 64;
    source.generationOverrides = { caveWaterPercent: 0 };
    const seed = `connected-region-contract:${kind}`;
    const before = JSON.stringify([source, project.settings]);
    const first = generatePlane(source, project.settings, seed, 1, { deferStrategicFeatures: true });
    const second = generatePlane(source, project.settings, seed, 1, { deferStrategicFeatures: true });
    assert.deepEqual(first, second, "seed-identical generation must reproduce every field");
    assert.equal(first.provinces.length, 64, "passage roles must not add or remove provinces");
    assert.equal(first.provinces.filter(province => !isBlockedProvince(province)).length, 64);
    assert.equal(new Set(first.provinces.map(province => province.id)).size, 64);
    assert.deepEqual(first.provinces.map(province => province.index), Array.from({ length: 64 }, (_, index) => index + 1));
    assert.deepEqual(edgeKeys(first), expectedRegionKeys(first));
    const contacts = new Set(buildConnectedRegionPlan(first).voronoiPairs.map(pair => pair.key));
    assert.ok(edgeKeys(first).every(key => contacts.has(key)), "every regional movement edge needs a true metric-Voronoi contact");
    assert.equal(new Set(edgeKeys(first)).size, first.edges.length, "overlapping tree/region pairs must be deduplicated");
    assert.ok(first.edges.every(edge => edge.kind === "standard" && edge.special === undefined));
    const adjacency = adjacencyFor(first, { traversableOnly: true });
    assert.equal(shortestDistances(adjacency, first.provinces[0]!.id).size, first.provinces.length);
    assert.equal(JSON.stringify([source, project.settings]), before);
  });
}

test("regions planning consumes the newly generated provinces rather than stale source positions or IDs", () => {
  const { project, source } = legacySource("cavern");
  source.sparseLayout = "regions";
  source.provinceTarget = 48;
  const stale = generatePlane({ ...source, sparseLayout: "chambers", provinceTarget: 16 }, project.settings, "obsolete-region-layout", 1, { deferStrategicFeatures: true });
  const reused: Plane = { ...source, provinces: stale.provinces.map((province, index) => ({
    ...province, id: `obsolete-${index}`, name: `Old generated name ${index}`, nameSource: "generated", x: .01, y: .01,
  })), edges: [] };
  const before = JSON.stringify(reused);
  const fresh = generatePlane(source, project.settings, "current-region-layout", 1, { deferStrategicFeatures: true });
  const regenerated = generatePlane(reused, project.settings, "current-region-layout", 1, { deferStrategicFeatures: true });
  assert.deepEqual(regenerated, fresh);
  assert.equal(regenerated.provinces.length, 48);
  assert.ok(regenerated.provinces.every(province => !province.id.startsWith("obsolete-")));
  assert.deepEqual(edgeKeys(regenerated), expectedRegionKeys(regenerated));
  assert.equal(JSON.stringify(reused), before);
});

test("initial regional start-hub requests only add true metric-Voronoi contacts", () => {
  const { project, source } = legacySource("cloud");
  source.sparseLayout = "regions";
  source.provinceTarget = 64;
  const output = generatePlane(source, project.settings, "region-initial-start-hubs", 1, { deferStrategicFeatures: true, startCapacity: 2 });
  const contacts = new Set(buildConnectedRegionPlan(output).voronoiPairs.map(pair => pair.key));
  assert.ok(edgeKeys(output).every(key => contacts.has(key)));
  assert.equal(shortestDistances(adjacencyFor(output, { traversableOnly: true }), output.provinces[0]!.id).size, 64);
});

test("regions count/connectivity remains stable across small, portrait, wide and wrapped generations", () => {
  const { project, source } = legacySource("cave");
  for (const [count, width, height, wrapX, wrapY] of [
    [8, 256, 256, false, false], [24, 256, 768, false, true],
    [64, 1536, 256, true, false], [128, 768, 768, true, true],
  ] as const) {
    const configured: Plane = { ...source, sparseLayout: "regions", provinceTarget: count, width, height, wrapX, wrapY };
    const output = generatePlane(configured, project.settings, `region-envelope:${count}:${width}:${height}`, 1, { deferStrategicFeatures: true });
    assert.equal(output.provinces.length, count);
    assert.deepEqual(edgeKeys(output), expectedRegionKeys(output));
    assert.equal(shortestDistances(adjacencyFor(output, { traversableOnly: true }), output.provinces[0]!.id).size, count);
    assert.ok(output.provinces.every(province => Number.isFinite(province.x) && Number.isFinite(province.y)));
  }
});

test("retired layout markers cannot reroll dry province content or identities", () => {
  for (const kind of ["cave", "cavern", "cloud", "air"] as const) {
    const { project, source } = legacySource(kind);
    source.provinceTarget = 64;
    source.generationOverrides = { caveWaterPercent: 0 };
    const seed = `region-content-parity:${kind}`;
    const oldPlane = generatePlane({ ...source, sparseLayout: "chambers" }, project.settings, seed, 1, { deferStrategicFeatures: true });
    const regional = generatePlane({ ...source, sparseLayout: "regions" }, project.settings, seed, 1, { deferStrategicFeatures: true });
    // Legacy marker metadata is inert; content and identities use the same RNG.
    const content = (province: Province) => ({ ...province, small: false, large: false });
    assert.deepEqual(regional.provinces.map(content), oldPlane.provinces.map(content), kind);
  }
});

test("mixed regional caves and sky preserve safe starts, protected rings and assigned nation cleanup", () => {
  let project = createDefaultProject("connected-region-capital-safety", { generate: false });
  Object.assign(project.settings, {
    players: 8, provincesPerPlayer: 12, throneCount: 8, startDegreeTarget: 4,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 2, other: 2 }, caveStartNations: [60, 63],
  });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 96;
  project = addPlane(project, "cave", { generate: false, autoSize: false, provinceTarget: 64 });
  project = addPlane(project, "air", { generate: false, autoSize: false, provinceTarget: 64 });
  const before = JSON.stringify(project);
  const generated = generateProject(project);
  const repeat = generateProject(project);
  assert.deepEqual(generated.planes, repeat.planes);
  assert.deepEqual(generated.gates, repeat.gates);
  assert.deepEqual(generated.specificStarts, repeat.specificStarts);
  assert.deepEqual(generated.planes.map(plane => plane.provinces.length), [96, 64, 64]);
  assert.equal(generated.planes[0]!.sparseLayout, undefined);
  const protectedOneRing = protectedStartProvinceKeys(generated, 1);
  const degrees: number[] = [];
  for (const plane of generated.planes) {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const bridges = graphBridgeKeys(plane);
    const starts = plane.provinces.filter(province => province.start);
    if (usesConnectedRegions(plane)) {
      const contacts = new Set(buildConnectedRegionPlan(plane).voronoiPairs.map(pair => pair.key));
      assert.ok(edgeKeys(plane).every(key => contacts.has(key)), `${plane.kind}: late start-basin repairs must remain local contacts`);
    }
    for (const start of starts) {
      const degree = adjacency.get(start.id)?.length ?? 0;
      degrees.push(degree);
      assert.ok(degree >= 4, `${plane.kind}: at least four reliable start exits`);
      assert.ok(!plane.edges.some(edge => (edge.a === start.id || edge.b === start.id) && isImpassableEdge(edge)));
      if (usesConnectedRegions(plane)) assert.ok(!plane.edges.some(edge => (edge.a === start.id || edge.b === start.id)
        && bridges.has(connectionKey(edge.a, edge.b))), `${plane.kind}: no graph bridge on a generated capital`);
      const distances = shortestDistances(adjacency, start.id);
      for (const other of starts.filter(other => other !== start)) assert.ok((distances.get(other.id) ?? 0) >= 3);
      for (const province of plane.provinces) if ((distances.get(province.id) ?? Infinity) <= 2) {
        assert.deepEqual(province.defenders, [], `${plane.kind}: two-ring guardian protection at ${province.index}`);
      }
    }
    for (const province of plane.provinces) if (protectedOneRing.has(`${plane.id}:${province.id}`)) {
      assert.deepEqual(province.defenders, []);
      assert.ok(province.throne !== "fixed" && province.throne !== "preferred");
    }
  }
  assert.equal(degrees.length, 8);
  assert.equal(new Set(degrees).size, 1, "start-basin repairs preserve equal exits across core and regional planes");
  assert.equal(generated.planes[1]!.provinces.filter(province => province.startType === "cave").length, 2);
  assert.equal(generated.planes[2]!.provinces.filter(province => province.startType === "other").length, 2);
  assert.equal(generated.specificStarts.length, 2);
  for (const start of generated.specificStarts) {
    const province = generated.planes.find(plane => plane.id === start.planeId)!.provinces.find(province => province.id === start.provinceId)!;
    assert.deepEqual(nationSpecificStartFeatureConflicts(province), []);
  }
  assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), []);
  assert.equal(JSON.stringify(project), before);
});

test("reserved regional layers remain additional neutral provinces with no accidental starts", () => {
  let project = createDefaultProject("connected-regions-reserved", { generate: false });
  Object.assign(project.settings, { players: 4, provincesPerPlayer: 12, throneCount: 4,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 0, other: 0 } });
  for (const kind of ["cave", "cloud"] as const) {
    project = addPlane(project, kind, { generate: false, autoSize: false, provinceTarget: 48, noGeneratedStarts: true });
  }
  const generated = generateProject(project);
  assert.equal(generated.planes[0]!.provinces.length, 48);
  for (const plane of generated.planes.slice(1)) {
    assert.equal(plane.provinces.length, 48);
    assert.equal(plane.provinces.some(province => province.start || province.teamStart !== undefined), false);
    assert.ok(!generated.specificStarts.some(start => start.planeId === plane.id));
    assert.equal(shortestDistances(adjacencyFor(plane, { traversableOnly: true }), plane.provinces[0]!.id).size, 48);
  }
  assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), []);
});

test("regional start-hub repair skips locally impossible sky hubs and continues preparing comparable expansion basins", () => {
  let project = createDefaultProject("sparse-capital-safety");
  Object.assign(project.settings, { players: 8, provincesPerPlayer: 12, startDegreeTarget: 4,
    startDistribution: { land: 4, coastal: 0, water: 0, cave: 2, other: 2 } });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 96;
  project = addPlane(project, "cave", { generate: false, autoSize: false, provinceTarget: 64 });
  project = addPlane(project, "air", { generate: false, autoSize: false, provinceTarget: 64 });
  const generated = generateProject(project);
  const degrees: number[] = [];
  const capacities = generated.planes.map(plane => {
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const starts = plane.provinces.filter(province => province.start);
    if (usesConnectedRegions(plane)) {
      const contacts = new Set(buildConnectedRegionPlan(plane).voronoiPairs.map(pair => pair.key));
      assert.ok(edgeKeys(plane).every(key => contacts.has(key)), "basin repair must never invent a nonlocal sky doorway");
    }
    return starts.map(start => {
      degrees.push(adjacency.get(start.id)!.length);
      return [...shortestDistances(adjacency, start.id).values()].filter(distance => distance <= 2).length;
    });
  });
  assert.equal(new Set(degrees).size, 1, "an impossible early hub must not leave sky capitals below the common degree");
  assert.ok(degrees.every(degree => degree >= 4));
  const overlandMean = capacities[0]!.reduce((sum, value) => sum + value, 0) / capacities[0]!.length;
  assert.equal(capacities[2]!.length, 2);
  for (const capacity of capacities[2]!) assert.ok(Math.abs(capacity - overlandMean) <= Math.max(2, overlandMean * .2),
    "later feasible sky hubs must receive comparable local expansion capacity after an earlier one proves impossible");
});

test("eight regional archetypes retain local contacts and bridge-safe starts across a 24-map generation corpus", () => {
  for (const kind of ["cave", "cavern", "cloud", "air", "hell", "abyss", "dream", "elemental"] as const) {
    for (let seed = 0; seed < 3; seed++) {
      const label = `${kind}:${seed}`;
      let project = createDefaultProject(`region-corpus-${kind}-${seed}`, { generate: false });
      const cave = (["cave", "cavern", "hell", "abyss"] as readonly string[]).includes(kind);
      Object.assign(project.settings, { players: 4, provincesPerPlayer: 16, throneCount: 4, startDegreeTarget: 4,
        startDistribution: { land: 2, coastal: 0, water: 0, cave: cave ? 2 : 0, other: cave ? 0 : 2 } });
      project.planes[0]!.autoSize = false;
      project.planes[0]!.provinceTarget = 64;
      project = addPlane(project, kind, { generate: false, autoSize: false, provinceTarget: 64 });
      const source = project.planes[1]!;
      source.width = seed === 1 ? 384 : 768;
      source.height = seed === 1 ? 768 : 512;
      source.wrapX = seed !== 1;
      source.wrapY = seed === 2;
      const generated = generateProject(project), plane = generated.planes[1]!;
      const spatial = buildConnectedRegionPlan(plane);
      const contacts = new Set(spatial.voronoiPairs.map(pair => pair.key));
      assert.ok(spatial.treePairs.every(pair => contacts.has(connectionKey(plane.provinces[pair.a]!.id, plane.provinces[pair.b]!.id))),
        `${label}: every spanning-tree edge needs a usable regional contact`);
      assert.ok(edgeKeys(plane).every(key => contacts.has(key)), `${label}: generated and repaired edges must remain local contacts`);
      assert.equal(connectedRegionLayoutNotice(plane), undefined, `${label}: no hidden legacy-footprint fallback`);
      assert.equal(plane.provinces.length, 64);
      const adjacency = adjacencyFor(plane, { traversableOnly: true }), bridges = graphBridgeKeys(plane);
      assert.equal(shortestDistances(adjacency, plane.provinces[0]!.id).size, 64, label);
      const starts = plane.provinces.filter(province => province.start);
      assert.equal(starts.length, 2, label);
      assert.equal(new Set(starts.map(start => adjacency.get(start.id)?.length)).size, 1, label);
      for (const start of starts) {
        assert.ok((adjacency.get(start.id)?.length ?? 0) >= 4, label);
        assert.ok(!plane.edges.some(edge => (edge.a === start.id || edge.b === start.id) && bridges.has(connectionKey(edge.a, edge.b))),
          `${label}: no bridge-adjacent regional capital at ${start.index}`);
        const distances = shortestDistances(adjacency, start.id);
        for (const other of starts.filter(other => other !== start)) assert.ok((distances.get(other.id) ?? 0) >= 3, label);
        for (const province of plane.provinces) if ((distances.get(province.id) ?? Infinity) <= 2) assert.deepEqual(province.defenders, [], label);
      }
      assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), [], label);
    }
  }
});
