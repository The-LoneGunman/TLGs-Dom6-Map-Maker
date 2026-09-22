import assert from "node:assert/strict";
import test from "node:test";
import { addPlane, adjacencyFor, createDefaultProject, generateProject, synchronizePlaneEdges } from "../src/generator";
import { isWaterProvince } from "../src/domain";
import { compileMapText, validateProject } from "../src/dom6";
import { inspectNativeMap } from "../src/nativeInspection";
import { hasRawIndependentDefenderDirectives } from "../src/terrainSafety";
import { provinceSiteLocationMask, siteCompatibility } from "../src/catalog/compatibility";
import type { CatalogEntry } from "../src/catalog/types";

function generatedWithStart(seed: string) {
  const project = generateProject(createDefaultProject(seed));
  const plane = project.planes[0]!;
  const start = plane.provinces.find((province) => province.start)!;
  return { project, plane, start };
}

test("a start whose declared neighbours are Cave Walls fails the traversable-exit minimum", () => {
  const { project, plane, start } = generatedWithStart("review-cavewall-start");
  const neighbours = adjacencyFor(plane).get(start.id)!;
  assert.ok(neighbours.length >= 4);
  for (const id of neighbours.slice(1)) plane.provinces.find((province) => province.id === id)!.terrain = "cavewall";

  const errors = validateProject(project).filter((issue) => issue.severity === "error" && issue.provinceId === start.id);
  assert.ok(errors.some((issue) => /is a start with 1 traversable connections; at least 4 are required/.test(issue.message)), errors.map((issue) => issue.message).join("\n"));
});

test("named mountain borders on a start are reported like the generator's start-edge rule", () => {
  const { project, plane, start } = generatedWithStart("review-mountain-start");
  for (const edge of plane.edges) if (edge.a === start.id || edge.b === start.id) edge.kind = "mountain_border";

  const errors = validateProject(project).filter((issue) => issue.severity === "error" && issue.provinceId === start.id);
  assert.ok(errors.some((issue) => /blocking or condition-dependent start border/.test(issue.message)));
});

test("bare title and plane names cannot leave comment markers or quotes in native text", () => {
  const project = generateProject(createDefaultProject("review-safe-bare"));
  project.name = "North---South // \"Six\" Map";
  project.planes[0]!.name = "Realm ---- Two";
  const text = compileMapText(project, 0);
  const title = text.split(/\r?\n/).find((line) => line.startsWith("#dom2title "))!;
  const planeName = text.split(/\r?\n/).find((line) => line.startsWith("#planename "))!;
  assert.equal(title, "#dom2title North-South / 'Six' Map");
  assert.equal(planeName, "#planename Realm - Two");
  assert.doesNotThrow(() => inspectNativeMap(text));
});

test("raw directives separated by a bare carriage return are split into lines", () => {
  const raw = "-- note\r#commander 1463\r#units 15 1465";
  assert.equal(hasRawIndependentDefenderDirectives(raw), true);

  const project = generateProject(createDefaultProject("review-cr-raw"));
  project.planes[0]!.rawDirectives = "#nodeepcaves\r#mapnohide";
  const lines = compileMapText(project, 0).split(/\r?\n/);
  assert.ok(lines.includes("#nodeepcaves"));
  assert.ok(lines.includes("#mapnohide"));
});

test("the inspector recognizes the winter image directive that illustrated export writes", () => {
  const inspection = inspectNativeMap("#dom2title Test\n#imagefile test.tga\n#winterimagefile test_winter.tga\n#mapsize 100 100\n");
  assert.deepEqual(inspection.unrecognized, []);
});

test("dry-land site bits do not match kelp or underwater highland provinces", () => {
  const project = generateProject(createDefaultProject("review-site-bits"));
  const plane = project.planes[0]!;
  const province = plane.provinces[0]!;
  const forestSite = { id: 1, name: "Test Forest Site", terrainMask: 2 } as CatalogEntry;
  const kelpSite = { id: 2, name: "Test Kelp Site", terrainMask: 65_536 } as CatalogEntry;

  province.terrain = "kelp";
  province.terrainFlags = [];
  assert.equal(provinceSiteLocationMask(province, plane) & 2, 0);
  assert.equal(siteCompatibility(forestSite, province, plane).compatible, false);
  assert.equal(siteCompatibility(kelpSite, province, plane).compatible, true);

  province.terrain = "forest";
  assert.equal(siteCompatibility(forestSite, province, plane).compatible, true);
});

test("a province used by two gate groups is reported", () => {
  const project = generateProject(createDefaultProject("review-multi-gate"));
  const plane = project.planes[0]!;
  const [a, b, c] = plane.provinces.filter((province) => !province.start).map((province) => province.id);
  project.gates = [
    { id: "g1", gateNumber: 1, endpoints: [{ planeId: plane.id, provinceId: a! }, { planeId: plane.id, provinceId: b! }] },
    { id: "g2", gateNumber: 2, endpoints: [{ planeId: plane.id, provinceId: a! }, { planeId: plane.id, provinceId: c! }] },
  ];
  const issues = validateProject(project).filter((issue) => issue.provinceId === a && /endpoint of gates 1, 2/.test(issue.message));
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.severity, "warning");
});

test("regenerating an Underworld keeps authored names on River Styx provinces", () => {
  const first = generateProject(addPlane(createDefaultProject("review-styx-names"), "underworld"));
  const underworld = first.planes.find((plane) => plane.kind === "underworld")!;
  const styx = underworld.provinces.filter((province) => isWaterProvince(province));
  assert.ok(styx.length > 0);
  for (const province of underworld.provinces) {
    province.name = `Authored ${province.index}`;
    province.nameSource = "authored";
  }

  const regenerated = generateProject(first).planes.find((plane) => plane.kind === "underworld")!;
  for (const province of regenerated.provinces) {
    assert.equal(province.name, `Authored ${province.index}`);
    assert.equal(province.nameSource, "authored");
  }
});

test("border synchronization never leaves two borders with the same ID", () => {
  const project = generateProject(createDefaultProject("beta"));
  let plane = project.planes[0]!;
  const seed = `${project.seed}:plane:0:wrap-sync`;
  plane = synchronizePlaneEdges({ ...plane, wrapX: false, wrapY: false }, seed);
  plane = synchronizePlaneEdges({ ...plane, wrapX: true, wrapY: true }, seed);
  assert.equal(new Set(plane.edges.map((edge) => edge.id)).size, plane.edges.length);

  const duplicated = { ...plane, edges: plane.edges.map((edge, index) => index === 1 ? { ...edge, id: plane.edges[0]!.id } : edge) };
  project.planes[0] = duplicated;
  assert.ok(validateProject(project).some((issue) => issue.severity === "warning" && /sharing another border's ID/.test(issue.message)));
  const repaired = synchronizePlaneEdges(duplicated, seed);
  assert.equal(new Set(repaired.edges.map((edge) => edge.id)).size, repaired.edges.length);
  assert.equal(repaired.edges[0]!.id, plane.edges[0]!.id);
});

test("re-synchronized borders around a start stay open for movement", () => {
  for (const seed of ["review-wrap-6", "review-wrap-0"]) {
    const project = generateProject(createDefaultProject(seed));
    let plane = project.planes[0]!;
    const syncSeed = `${project.seed}:plane:0:wrap-sync`;
    plane = synchronizePlaneEdges({ ...plane, wrapX: false }, syncSeed);
    plane = synchronizePlaneEdges({ ...plane, wrapX: true }, syncSeed);
    const starts = new Set(plane.provinces.filter((province) => province.start).map((province) => province.id));
    const blocked = plane.edges.filter((edge) => (starts.has(edge.a) || starts.has(edge.b))
      && ["river", "mountain_pass", "mountain_border"].includes(edge.kind));
    assert.deepEqual(blocked, [], seed);
  }
});
