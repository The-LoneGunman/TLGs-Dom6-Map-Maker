import assert from "node:assert/strict";
import test from "node:test";
import { calculateFairness, createDefaultProject, distancesToSources, nearestSourceDistances, shortestDistances } from "../src/generator";
import { validateProject } from "../src/dom6";
import { parseProject, serializeProject } from "../src/export";

test("multi-source walks exactly match individual BFS on connected, disconnected and blocked starts", () => {
  let state = 173;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let trial = 0; trial < 200; trial += 1) {
    const nodes = Array.from({ length: 2 + Math.floor(random() * 35) }, (_, i) => String(i));
    const graph = new Map(nodes.map(id => [id, [] as string[]]));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      if (random() < 0.12) { graph.get(nodes[i]!)!.push(nodes[j]!); graph.get(nodes[j]!)!.push(nodes[i]!); }
    }
    const sources = [...nodes.filter(() => random() < 0.35), "blocked"];
    const nearest = nearestSourceDistances(graph, sources);
    const distanceToAny = distancesToSources(graph, sources, 2);
    for (const source of sources) {
      const distances = shortestDistances(graph, source);
      const expected = Math.min(...sources.filter(other => other !== source).map(other => distances.get(other) ?? Infinity));
      assert.equal(nearest.get(source), expected);
    }
    for (const id of nodes) {
      const expected = Math.min(...sources.filter(source => graph.has(source)).map(source => shortestDistances(graph, source).get(id) ?? Infinity));
      assert.equal(distanceToAny.get(id), expected <= 2 ? expected : undefined);
    }
  }
});

function manyStartsProject() {
  const project = createDefaultProject("many-starts-import");
  const template = project.planes[0]!;
  const province = template.provinces[0]!;
  project.settings.startDistribution = undefined;
  project.specificStarts = [];
  project.planes = Array.from({ length: 8 }, (_, pi) => ({
    ...structuredClone(template), id: `p${pi}`, kind: "custom" as const, ownershipMode: "sparse" as const,
    name: `Plane ${pi}`, width: 1024, height: 1024, wrapX: false, wrapY: false,
    provinces: Array.from({ length: 800 }, (_, i) => ({
      ...structuredClone(province), id: `n${i}`, index: i + 1, name: `Province ${pi}-${i}`,
      x: ((i % 40) + 0.5) / 40, y: (Math.floor(i / 40) + 0.5) / 20,
      start: true, teamStart: undefined, startType: undefined, noStart: false, terrain: "plains" as const,
      terrainFlags: [], sites: [], defenders: [], throne: "avoid" as const, fixedThrone: undefined,
    })),
    edges: Array.from({ length: 799 }, (_, i) => ({ id: `e${i}`, a: `n${i}`, b: `n${i + 1}`, kind: "standard" as const })),
  }));
  project.gates = [{ id: "all-planes", gateNumber: 1, endpoints: project.planes.map(plane => ({ planeId: plane.id, provinceId: "n0" })) }];
  return project;
}

test("maximum-size imported start annotations remain bounded and still block unsafe spacing", { timeout: 30000 }, () => {
  const project = parseProject(serializeProject(manyStartsProject()));
  const issues = validateProject(project);
  assert.ok(issues.some(issue => issue.severity === "error" && issue.message.includes("6400 of 6400") && issue.message.includes("at least 3")));
  const fairness = calculateFairness(project);
  assert.equal(fairness.startSeparation, 0);
  assert.ok(Number.isFinite(fairness.overall));
});

test("spacing beyond the first 64 starts is checked without truncated safety claims", () => {
  const project = manyStartsProject();
  project.planes = project.planes.slice(0, 1);
  project.gates = [];
  project.planes[0]!.provinces.forEach((province, i) => { province.start = i % 5 === 0 && i <= 320 || i === 321; });
  const issues = validateProject(project);
  assert.ok(issues.some(issue => issue.severity === "error" && issue.message.includes("2 of 66") && issue.message.includes("at least 3")));
});

test("repairable duplicate-ID imports report validation errors without NaN fairness", () => {
  const project = createDefaultProject("duplicate-start-id");
  for (const province of project.planes[0]!.provinces) { province.start = false; province.teamStart = undefined; }
  const [a, b] = project.planes[0]!.provinces;
  a!.start = b!.start = true;
  b!.id = a!.id;
  const imported = parseProject(serializeProject(project));
  assert.ok(validateProject(imported).some(issue => issue.severity === "error" && issue.message.includes("duplicate")));
  const fairness = calculateFairness(imported);
  assert.ok(Number.isFinite(fairness.overall));
  assert.ok(Number.isFinite(fairness.startSeparation));
});
