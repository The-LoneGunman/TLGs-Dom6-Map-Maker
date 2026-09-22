import assert from "node:assert/strict";
import test from "node:test";
import { validateProject } from "../src/dom6";
import { isBlockedProvince, isWaterProvince, type MapProject, type Plane, type Province } from "../src/domain";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import { auditSparseRasterTopology, connectionKey, createProvinceOwnershipModel } from "../src/geometry";
import { samplePlaneOwnership } from "../src/MapCanvas";

interface Fixture {
  seed: string;
  width?: number;
  height?: number;
  provinceTarget?: number;
  wrapX?: boolean;
  caveStarts?: number;
}

function generatedUnderworld({ seed, width, height, provinceTarget, wrapX, caveStarts }: Fixture): { project: MapProject; plane: Plane } {
  let project = createDefaultProject(seed, { generate: false });
  if (caveStarts) {
    project.settings = { ...project.settings, startDistribution: { land: 6 - caveStarts, coastal: 0, water: 0, cave: caveStarts, other: 0 } };
  }
  project = addPlane(project, "underworld", { generate: false, ...(provinceTarget ? { autoSize: false, provinceTarget } : {}) });
  const source = project.planes[1]!;
  if (width && height) Object.assign(source, { width, height });
  if (wrapX !== undefined) source.wrapX = wrapX;
  project = generateProject(project);
  return { project, plane: project.planes[1]! };
}

/** An independent full reading of the exported native raster. */
function nativeContacts(plane: Plane) {
  const { width, height } = plane;
  const owners = samplePlaneOwnership(plane, width, height, createProvinceOwnershipModel(plane));
  const at = (x: number, y: number) => {
    if (x < 0 || x >= width) { if (!plane.wrapX) return -1; x = (x + width) % width; }
    if (y < 0 || y >= height) { if (!plane.wrapY) return -1; y = (y + height) % height; }
    return owners[y * width + x]!;
  };
  const touching = new Set<string>(), bordering = new Set<string>();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const a = owners[y * width + x]!;
    if (a < 0) continue;
    for (const [dx, dy, orthogonal] of [[1, 0, true], [0, 1, true], [1, 1, false], [-1, 1, false]] as const) {
      const b = at(x + dx, y + dy);
      if (b < 0 || b === a) continue;
      const key = connectionKey(plane.provinces[a]!.id, plane.provinces[b]!.id);
      touching.add(key);
      if (orthogonal) bordering.add(key);
    }
  }
  return { touching, bordering };
}

function label(plane: Plane, key: string): string {
  return key.split("|").map((id) => {
    const province = plane.provinces.find((candidate) => candidate.id === id)!;
    return `#${province.index}${isWaterProvince(province) ? "w" : ""}`;
  }).join("-");
}

/** Dominions draws a border wherever owners change: that set must be exactly the links. */
function assertBordersMatchLinks(plane: Plane, name: string) {
  const links = new Set(plane.edges.map((edge) => connectionKey(edge.a, edge.b)));
  const { touching, bordering } = nativeContacts(plane);
  assert.deepEqual([...touching].filter((key) => !links.has(key)).map((key) => label(plane, key)), [],
    `${name}: exported pixels touch (8-connected) between provinces without a connection`);
  assert.deepEqual([...links].filter((key) => !bordering.has(key)).map((key) => label(plane, key)), [],
    `${name}: a connection has no shared (4-connected) border in the exported pixels`);
}

function components(plane: Plane, include: (province: Province) => boolean, withoutBridges = false): number {
  const ids = new Set(plane.provinces.filter(include).map((province) => province.id));
  const adjacency = new Map([...ids].map((id) => [id, [] as string[]]));
  for (const edge of plane.edges) {
    if ((withoutBridges && edge.kind === "bridge") || !ids.has(edge.a) || !ids.has(edge.b)) continue;
    adjacency.get(edge.a)!.push(edge.b);
    adjacency.get(edge.b)!.push(edge.a);
  }
  let count = 0;
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    count += 1;
    const queue = [id];
    seen.add(id);
    while (queue.length) for (const next of adjacency.get(queue.pop()!)!) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return count;
}

function assertStyxContract(plane: Plane, name: string) {
  const bridges = plane.edges.filter((edge) => edge.kind === "bridge").length;
  assert.equal(components(plane, isWaterProvince), 1, `${name}: the Styx stays one connected river`);
  assert.equal(components(plane, (province) => !isWaterProvince(province) && !isBlockedProvince(province), true), 2,
    `${name}: without its crossings the river still separates exactly two banks`);
  assert.equal(components(plane, (province) => !isBlockedProvince(province)), 1, `${name}: the plane stays connected`);
  assert.ok(bridges >= 1 && bridges <= 2, `${name}: one or two controlled crossings`);
}

test("the reviewed Styx seed draws exactly its connections at native 3840x2160", () => {
  // Seed s-a previously drew its Styx link #9-#27 straight through dry #18 and
  // cut its only crossing with the water it spans.
  const { project, plane } = generatedUnderworld({ seed: "s-a" });
  assert.equal(plane.width, 3840);
  assert.equal(plane.height, 2160);
  assertBordersMatchLinks(plane, "s-a");
  assertStyxContract(plane, "s-a");
  assert.deepEqual(auditSparseRasterTopology(plane), { missing: [], extra: [] });
  assert.deepEqual(validateProject(project).filter((issue) => issue.planeId === plane.id && /drawn border|draws \d+ border/.test(issue.message)), []);
});

test("generated Underworld borders equal their connections across sizes, wraps, densities and cave starts", () => {
  const fixtures: Array<[string, Fixture]> = [
    ["square", { seed: "uw-border-square", width: 1024, height: 1024, provinceTarget: 64 }],
    ["wrapped", { seed: "uw-border-wrapped", width: 1536, height: 1024, wrapX: true }],
    ["portrait", { seed: "uw-border-portrait", width: 768, height: 1024, provinceTarget: 48 }],
    ["minimum", { seed: "uw-border-minimum", width: 256, height: 256, provinceTarget: 24 }],
    ["broad river", { seed: "uw-border-broad", width: 1536, height: 1024, provinceTarget: 300 }],
    ["cave starts", { seed: "uw-border-starts", width: 1536, height: 1024, caveStarts: 2 }],
  ];
  for (const [name, fixture] of fixtures) {
    const { plane } = generatedUnderworld(fixture);
    assertBordersMatchLinks(plane, name);
    assertStyxContract(plane, name);
  }
});

test("Underworld border-consistent generation is deterministic", () => {
  const fixture = { seed: "uw-border-determinism", width: 1024, height: 768, provinceTarget: 80 };
  const first = generatedUnderworld(fixture).plane, second = generatedUnderworld(fixture).plane;
  assert.deepEqual(second.edges, first.edges);
  assert.deepEqual(second.provinces, first.provinces);
});

test("the sampled raster audit matches a full native reading and flags an authored crossing link", () => {
  const { project, plane } = generatedUnderworld({ seed: "uw-border-audit", width: 1024, height: 1024, provinceTarget: 64 });
  assert.deepEqual(auditSparseRasterTopology(plane), { missing: [], extra: [] });
  assert.equal(validateProject(project).filter((issue) => issue.planeId === plane.id && issue.severity === "warning"
    && /drawn border|draws \d+ border/.test(issue.message)).length, 0);

  // A long authored link runs straight through other chambers.
  const edited = structuredClone(project);
  const target = edited.planes[1]!;
  const byIndex = (index: number) => target.provinces.find((province) => province.index === index)!;
  const [first, last] = [byIndex(1), byIndex(target.provinces.length)];
  target.edges.push({ id: "authored-long-link", a: first.id, b: last.id, kind: "standard" });
  const audit = auditSparseRasterTopology(target)!;
  const { touching, bordering } = nativeContacts(target);
  const links = new Set(target.edges.map((edge) => connectionKey(edge.a, edge.b)));
  assert.deepEqual(audit.missing.map((pair) => pair.key).sort(), [...touching].filter((key) => !links.has(key)).sort());
  assert.deepEqual(audit.extra.map((pair) => pair.key).sort(), [...links].filter((key) => !bordering.has(key)).sort());
  assert.ok(audit.missing.length > 0, "the crossing link must touch unrelated chambers");
  const warnings = validateProject(edited).filter((issue) => issue.planeId === target.id && issue.severity === "warning");
  assert.ok(warnings.some((issue) => /draws \d+ borders? in the exported map/.test(issue.message)));
});

test("an explicit Styx crossing stays whole over the water it crosses", () => {
  const source = createDefaultProject("uw-border-crossing").planes[0]!;
  const province = (index: number, x: number, y: number, water: boolean): Province => ({
    ...structuredClone(source.provinces[index % source.provinces.length]!),
    id: `crossing-${index}`, index: index + 1, x, y, terrain: "cave", freshwater: false, small: false, large: false,
    terrainFlags: water ? ["sea", "cave"] : undefined,
  });
  // Two banks (0, 1) and a river (2-3) whose water link the crossing passes beside.
  const plane: Plane = {
    ...structuredClone(source), id: "crossing-plane", kind: "underworld", ownershipMode: "sparse",
    width: 768, height: 768, wrapX: false, wrapY: false,
    provinces: [province(0, 0.5, 0.2, false), province(1, 0.5, 0.8, false), province(2, 0.36, 0.5, true), province(3, 0.8, 0.5, true)],
    edges: [],
  };
  const [bankA, bankB, water, farWater] = plane.provinces as [Province, Province, Province, Province];
  plane.provinceTarget = plane.provinces.length;
  plane.edges = [
    { id: "crossing", a: bankA.id, b: bankB.id, kind: "bridge" },
    { id: "river", a: water.id, b: farWater.id, kind: "standard" },
    { id: "ford-a", a: bankA.id, b: water.id, kind: "standard" },
    { id: "ford-b", a: bankB.id, b: water.id, kind: "standard" },
  ];
  const model = createProvinceOwnershipModel(plane);
  for (let step = 0; step <= 60; step += 1) {
    const owner = model.ownerAt(0.5, 0.2 + 0.6 * step / 60);
    assert.ok(owner === 0 || owner === 1, `the crossing centreline belongs to its banks, not province ${owner}`);
  }
  assertBordersMatchLinks(plane, "hand-built crossing");
});
