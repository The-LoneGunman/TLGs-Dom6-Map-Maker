import assert from "node:assert/strict";
import test from "node:test";
import { validateProject } from "../src/dom6";
import { isBlockedProvince, isWaterProvince, type MapProject, type Plane, type Province } from "../src/domain";
import { addPlane, adjacencyFor, createDefaultProject, generateProject, previewProvinceBudget } from "../src/generator";
import { auditSparseRasterTopology, connectionKey, createProvinceOwnershipModel } from "../src/geometry";
import { samplePlaneOwnership } from "../src/MapCanvas";

interface Fixture {
  seed: string;
  width?: number;
  height?: number;
  provinceTarget?: number;
  wrapX?: boolean;
  wrapY?: boolean;
  caveStarts?: number;
}

function stagedUnderworld({ seed, width, height, provinceTarget, wrapX, wrapY, caveStarts }: Fixture): MapProject {
  let project = createDefaultProject(seed, { generate: false });
  if (caveStarts) {
    project.settings = { ...project.settings, startDistribution: { land: 6 - caveStarts, coastal: 0, water: 0, cave: caveStarts, other: 0 } };
  }
  project = addPlane(project, "underworld", { generate: false, ...(provinceTarget ? { autoSize: false, provinceTarget } : {}) });
  const source = project.planes[1]!;
  if (width && height) Object.assign(source, { width, height });
  if (wrapX !== undefined) source.wrapX = wrapX;
  if (wrapY !== undefined) source.wrapY = wrapY;
  return project;
}

function generatedUnderworld(fixture: Fixture): { project: MapProject; plane: Plane } {
  const project = generateProject(stagedUnderworld(fixture));
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

test("small and seam-wrapped Underworlds draw exactly their connections with an intact Styx", () => {
  // All but the 256x256 plane shipped 1-7 drawn borders without connections,
  // or connections without borders, on 1968d4b. Most grids left no drawable
  // river (on seam-wrapped planes every short crossing ran around it), so the
  // original construction was kept; one plan ended with an undrawable
  // last-resort crossing, and one crossing covered a river chamber's centre.
  const fixtures: Array<[string, Fixture]> = [
    ["eight at 3840x2160", { seed: "tiny4k-0", width: 3840, height: 2160, provinceTarget: 8 }],
    ["eight at 2048x1152", { seed: "uws-2048-8-0", width: 2048, height: 1152, provinceTarget: 8 }],
    ["flooded ten", { seed: "uws-2048-10-0", width: 2048, height: 1152, provinceTarget: 10 }],
    ["twelve", { seed: "uws-1536-12-0", width: 1536, height: 1024, provinceTarget: 12 }],
    ["portrait eight", { seed: "uws-1152-8-0", width: 1152, height: 2048, provinceTarget: 8 }],
    ["nine wrapped north-south", { seed: "uws-1536-9-1", width: 1536, height: 1024, provinceTarget: 9, wrapY: true }],
    ["twenty wrapped north-south", { seed: "uwm-1536-20", width: 1536, height: 1024, provinceTarget: 20, wrapY: true }],
    ["portrait nine wrapped east-west with a cave start", { seed: "uwst-1152-9-1", width: 1152, height: 2048, provinceTarget: 9, wrapX: true, caveStarts: 1 }],
    ["eight whose crossing covered a river centre", { seed: "uwst-1024-8-1", width: 1024, height: 1024, provinceTarget: 8, caveStarts: 1 }],
    ["eight at 256x256", { seed: "uws-256-8-0", width: 256, height: 256, provinceTarget: 8 }],
  ];
  for (const [name, fixture] of fixtures) {
    const staged = stagedUnderworld(fixture);
    const planned = previewProvinceBudget(staged).planes[1]!.target;
    const project = generateProject(staged);
    const plane = project.planes[1]!;
    assert.equal(plane.provinces.length, planned, `${name}: the planned province count is kept`);
    assertBordersMatchLinks(plane, name);
    assertStyxContract(plane, name);
    assert.deepEqual(validateProject(project).filter((issue) => issue.planeId === plane.id
      && /drawn border|draws \d+ border/.test(issue.message)), [], `${name}: no border warning`);
  }
});

test("a small Underworld that supplies a cave start gives it four drawable exits", () => {
  // On 1968d4b each of these starts kept three connections: its first hub
  // candidate could not reach four drawable passages and no other was tried.
  const fixtures: Array<[string, Fixture]> = [
    ["nine at 256x256", { seed: "uwst-256-9-1", width: 256, height: 256, provinceTarget: 9, caveStarts: 1 }],
    ["ten wrapped north-south", { seed: "uwst-256-10-1", width: 256, height: 256, provinceTarget: 10, wrapY: true, caveStarts: 1 }],
    ["eight wrapped east-west", { seed: "uwst-1536-8-1", width: 1536, height: 1024, provinceTarget: 8, wrapX: true, caveStarts: 1 }],
    ["nine at 1024x1024", { seed: "uwst-1024-9-1", width: 1024, height: 1024, provinceTarget: 9, wrapY: true, caveStarts: 1 }],
  ];
  for (const [name, fixture] of fixtures) {
    const { project, plane } = generatedUnderworld(fixture);
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    const starts = plane.provinces.filter((province) => province.start);
    assert.equal(starts.length, 1, `${name}: the Underworld supplies the cave start`);
    for (const start of starts) assert.ok((adjacency.get(start.id)?.length ?? 0) >= 4, `${name}: #${start.index} has four exits`);
    assert.deepEqual(validateProject(project).filter((issue) => issue.severity === "error").map((issue) => issue.message), [], name);
    assertBordersMatchLinks(plane, name);
    assertStyxContract(plane, name);
  }
});

test("Underworld border-consistent generation is deterministic", () => {
  const fixture = { seed: "uw-border-determinism", width: 1024, height: 768, provinceTarget: 80 };
  const first = generatedUnderworld(fixture).plane, second = generatedUnderworld(fixture).plane;
  assert.deepEqual(second.edges, first.edges);
  assert.deepEqual(second.provinces, first.provinces);
  // A small plane laid out again around its river is just as repeatable.
  const small = { seed: "uws-2048-8-0", width: 2048, height: 1152, provinceTarget: 8 };
  assert.deepEqual(generatedUnderworld(small).plane, generatedUnderworld(small).plane);
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
