import assert from "node:assert/strict";
import test from "node:test";
import { addPlane, adjacencyFor, createDefaultProject, generatePlane, generateProject, shortestDistances, synchronizePlaneEdges } from "../src/generator";
import { isWaterProvince, type Plane } from "../src/domain";
import { auditPlaneTopology } from "../src/geometry";
import { resetGeneratorDefaults, updatePlaneArchetype } from "../src/MapMakerApp";

test("append after deleting a middle plane retains unique deterministic IDs and references", () => {
  let project = addPlane(addPlane(createDefaultProject("audit-id-reuse"), "cave", { generate: false }), "air", { generate: false });
  project.planes.splice(1, 1);
  const surviving = structuredClone(project);
  project = addPlane(project, "dream", { generate: false });
  assert.equal(new Set(project.planes.map(plane => plane.id)).size, 3);
  assert.deepEqual(project.planes.slice(0, 2), surviving.planes);
  assert.deepEqual(project.gates, surviving.gates);
  assert.deepEqual(project.planes.map(p => p.id), addPlane(surviving, "dream", { generate: false }).planes.map(p => p.id));
});

function assertSizes(plane: Plane) {
  const adjacency = adjacencyFor(plane);
  const sorted = [...plane.provinces].sort((a, b) => adjacency.get(a.id)!.length - adjacency.get(b.id)!.length);
  const count = Math.floor(sorted.length * 0.06);
  const ids = (items: typeof sorted) => items.map(p => p.id).sort();
  assert.deepEqual(ids(plane.provinces.filter(p => p.small)), ids(sorted.slice(0, count)));
  assert.deepEqual(ids(plane.provinces.filter(p => p.large)), ids(sorted.slice(sorted.length - count)));
  assert.equal(plane.provinces.some(p => p.small && p.large), false);
}

test("small layers and repaired start basins have exact disjoint size classifications", () => {
  for (const provinceTarget of [8, 16, 17]) {
    const project = addPlane(createDefaultProject("audit-small-layer"), "dream", { provinceTarget });
    assertSizes(project.planes[1]!);
  }
  let project = createDefaultProject("audit-double-size-9");
  project.settings.players = 2;
  project.settings.startDistribution = { land: 0, coastal: 0, water: 0, cave: 2, other: 0 };
  project.settings.startDegreeTarget = 8;
  project.planes[0]!.noGeneratedStarts = true;
  project = addPlane(project, "underworld", { generate: false, provinceTarget: 24 });
  const generated = generateProject(project);
  for (const plane of generated.planes) assertSizes(plane);
  assert.deepEqual(generated.planes, generateProject(project).planes);
});

function dryBanks(plane: Plane) {
  const ids = new Set(plane.provinces.filter(p => !isWaterProvince(p)).map(p => p.id));
  const graph = new Map([...ids].map(id => [id, [] as string[]]));
  for (const edge of plane.edges) {
    if (edge.kind === "bridge" || !ids.has(edge.a) || !ids.has(edge.b)) continue;
    graph.get(edge.a)!.push(edge.b); graph.get(edge.b)!.push(edge.a);
  }
  const groups: string[][] = [];
  while (ids.size) {
    const component = [...shortestDistances(graph, ids.values().next().value!).keys()].sort();
    groups.push(component);
    for (const id of component) ids.delete(id);
  }
  return groups.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

test("start-basin repair retains the Styx banks and original designated crossings", () => {
  let project = createDefaultProject("audit-styx-standard-24-2-0");
  project.settings.players = 2;
  project.settings.startDistribution = { land: 0, coastal: 0, water: 0, cave: 2, other: 0 };
  project.planes[0]!.noGeneratedStarts = true;
  project = addPlane(project, "underworld", { generate: false, provinceTarget: 24 });
  const before = generatePlane(project.planes[1]!, project.settings, `${project.seed}:plane:1:v1`, 1, { deferStrategicFeatures: true, waterPercent: 18 });
  const after = generateProject(project).planes[1]!;
  assert.equal(dryBanks(before).length, 2);
  assert.deepEqual(dryBanks(after), dryBanks(before));
  assert.deepEqual(after.edges.filter(e => e.kind === "bridge"), before.edges.filter(e => e.kind === "bridge"));
});

test("reset and archetype changes synchronize current borders without regenerating province content", () => {
  const project = addPlane(createDefaultProject("audit-reset-wrap"), "cave");
  const plane = project.planes[0]!;
  plane.wrapX = plane.wrapY = false;
  plane.edges = synchronizePlaneEdges(plane, project.seed).edges;
  const provinces = structuredClone(plane.provinces);
  resetGeneratorDefaults(project, plane.id);
  assert.equal(auditPlaneTopology(plane).missing.length, 0);
  assert.equal(auditPlaneTopology(plane).extra.length, 0);
  assert.deepEqual(plane.provinces, provinces);
  const cave = project.planes[1]!;
  const before = structuredClone(cave.provinces);
  const gates = structuredClone(project.gates);
  updatePlaneArchetype(project, cave.id, "surface");
  assert.equal(auditPlaneTopology(cave).missing.length, 0);
  assert.equal(auditPlaneTopology(cave).extra.length, 0);
  assert.deepEqual(cave.provinces, before);
  assert.deepEqual(project.gates, gates);
});
