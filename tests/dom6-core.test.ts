import assert from "node:assert/strict";
import test from "node:test";
import { addPlane, adjacencyFor, calculateFairness, createDefaultProject, generateProject, shortestDistances, synchronizePlaneEdges } from "../src/generator";
import { cloneProject } from "../src/domain";
import { auditPlaneTopology, computeProvinceTopology, connectionKey } from "../src/geometry";
import {
  D6M_MAGIC,
  D6M_TRAILER,
  D6M_VERSION,
  TERRAIN_BITS,
  compileMapText,
  encodeD6m,
  inspectD6m,
  terrainMask,
  terrainPreviewKey,
  validateProject,
} from "../src/dom6";

function canonical(project: ReturnType<typeof createDefaultProject>) {
  const copy = cloneProject(project);
  copy.createdAt = "";
  copy.updatedAt = "";
  return copy;
}

test("generation is deterministic, connected, varied, and multiplayer-scored", () => {
  const source = createDefaultProject("golden-seed-6p");
  const first = generateProject(source);
  const second = generateProject(source);
  assert.deepEqual(canonical(first), canonical(second));
  const plane = first.planes[0]!;
  const reachable = shortestDistances(adjacencyFor(plane), plane.provinces[0]!.id);
  assert.equal(reachable.size, plane.provinces.length);
  assert.equal(plane.provinces.filter((province) => province.start).length, first.settings.players);
  assert.ok(new Set(plane.provinces.map((province) => province.terrain)).size >= 6);
  const fairness = calculateFairness(first);
  assert.ok(fairness.overall >= 0 && fairness.overall <= 100);
  assert.equal(validateProject(first).filter((issue) => issue.severity === "error").length, 0);
  const topology = computeProvinceTopology(plane);
  assert.deepEqual(
    plane.edges.map((edge) => connectionKey(edge.a, edge.b)).sort(),
    [...topology.pairKeys].sort(),
  );
});

test("province topology excludes corner contacts and includes wrapped seam borders", () => {
  const project = createDefaultProject("topology-fixture");
  const plane = project.planes[0]!;
  plane.width = 1000;
  plane.height = 1000;
  plane.wrapX = false;
  plane.wrapY = false;
  plane.provinces = plane.provinces.slice(0, 4).map((province, index) => ({
    ...province,
    id: `square-${index + 1}`,
    index: index + 1,
    x: index % 2 ? 0.75 : 0.25,
    y: index > 1 ? 0.75 : 0.25,
  }));
  plane.edges = [];
  const square = computeProvinceTopology(plane);
  assert.equal(square.pairs.length, 4);
  assert.equal(square.pairKeys.has(connectionKey("square-1", "square-4")), false);
  assert.equal(square.pairKeys.has(connectionKey("square-2", "square-3")), false);

  plane.provinces = plane.provinces.slice(0, 3).map((province, index) => ({
    ...province,
    id: `seam-${index + 1}`,
    index: index + 1,
    x: [0.05, 0.5, 0.95][index]!,
    y: 0.5,
  }));
  const withoutWrap = computeProvinceTopology(plane);
  assert.equal(withoutWrap.pairKeys.has(connectionKey("seam-1", "seam-3")), false);
  plane.wrapX = true;
  const withWrap = computeProvinceTopology(plane);
  assert.equal(withWrap.pairKeys.has(connectionKey("seam-1", "seam-3")), true);
  assert.ok(withWrap.sharedBorders.get(connectionKey("seam-1", "seam-3"))?.some((segment) => segment.from.x === 0 || segment.from.x === 1));
});

test("topology repair preserves special borders and removes stale links", () => {
  const project = createDefaultProject("topology-repair");
  const plane = project.planes[0]!;
  const topology = computeProvinceTopology(plane);
  const preserved = plane.edges[0]!;
  preserved.kind = "road";
  const missing = plane.edges[1]!;
  plane.edges = plane.edges.filter((edge) => edge.id !== missing.id);
  let stalePair: [string, string] | undefined;
  for (let left = 0; left < plane.provinces.length && !stalePair; left += 1) {
    for (let right = left + 1; right < plane.provinces.length; right += 1) {
      const a = plane.provinces[left]!.id;
      const b = plane.provinces[right]!.id;
      if (!topology.pairKeys.has(connectionKey(a, b))) {
        stalePair = [a, b];
        break;
      }
    }
  }
  assert.ok(stalePair);
  plane.edges.push({ id: "stale-cross-map-edge", a: stalePair![0], b: stalePair![1], kind: "standard" });
  assert.deepEqual(
    { missing: auditPlaneTopology(plane).missing.length, extra: auditPlaneTopology(plane).extra.length },
    { missing: 1, extra: 1 },
  );
  assert.ok(validateProject(project).some((issue) => issue.severity === "error" && issue.message.includes("do not share a border")));

  const repaired = synchronizePlaneEdges(plane, "topology-repair:sync");
  assert.deepEqual(auditPlaneTopology(repaired), { missing: [], extra: [] });
  const preservedAfter = repaired.edges.find((edge) => connectionKey(edge.a, edge.b) === connectionKey(preserved.a, preserved.b));
  assert.equal(preservedAfter?.id, preserved.id);
  assert.equal(preservedAfter?.kind, "road");
});

test("terrain masks preserve Dominions 6 high bits and transformations", () => {
  const project = createDefaultProject("terrain-mask");
  const province = project.planes[0]!.provinces[0]!;
  province.terrain = "cavewall";
  province.colder = true;
  province.manySites = true;
  province.siteBias = ["glamour", "holy"];
  const mask = terrainMask(province);
  assert.ok((mask & TERRAIN_BITS.caveWall) !== 0n);
  assert.ok((mask & TERRAIN_BITS.colder) !== 0n);
  assert.ok((mask & TERRAIN_BITS.glamourSites) !== 0n);
  assert.equal(terrainPreviewKey("plains", "forested"), "forest");
  assert.equal(terrainPreviewKey("sea", "forested"), "kelp");
  assert.equal(terrainPreviewKey("cave", "flooded"), "caveswamp");

  province.terrain = "forest";
  province.terrainFlags = ["swamp", "freshwater"];
  const combined = terrainMask(province);
  assert.ok((combined & TERRAIN_BITS.forest) !== 0n);
  assert.ok((combined & TERRAIN_BITS.swamp) !== 0n);
  assert.ok((combined & TERRAIN_BITS.freshwater) !== 0n);
  assert.equal((combined & TERRAIN_BITS.sea) !== 0n, false, "fresh water alone must remain land");
});

test("map compilation covers starts, thrones, sites, guardians, and correct wrap flags", () => {
  const project = createDefaultProject("compiler-coverage");
  const plane = project.planes[0]!;
  plane.wrapX = true;
  plane.wrapY = false;
  const province = plane.provinces.find((item) => !item.start)!;
  province.throne = "fixed";
  province.fixedThrone = "1361"; // The Throne of Gaia in the pinned 6.35 catalog.
  province.sites.push({ id: "site-test", value: "1", known: false }); // The Smouldercone.
  province.defenders.push({ commander: "2468", magic: { nature: 2, holy: 1 }, squads: [{ id: "squad-test", unit: "1756", count: 12 }] });
  const text = compileMapText(project, 0);
  const firstCommand = text.split(/\r?\n/).find((line) => line.startsWith("#"));
  assert.equal(firstCommand?.startsWith("#dom2title "), true);
  assert.match(text, /#hwraparound/);
  assert.doesNotMatch(text, /^#wraparound$/m);
  assert.match(text, /#feature 1361/);
  assert.match(text, /#feature 1/);
  assert.match(text, /#commander 2468/);
  assert.match(text, /#units 12 1756/);
  assert.match(text, /#mag_nature 2/);
  assert.match(text, /#mag_priest 1/);
});

test("D6M encoder writes the official header, exact length, row-major owners, and trailer", async () => {
  const project = createDefaultProject("binary-fixture");
  const plane = project.planes[0]!;
  plane.width = 256;
  plane.height = 256;
  const underwaterMountain = plane.provinces.find((province) => !province.start)!;
  underwaterMountain.terrain = "mountains";
  underwaterMountain.terrainFlags = ["sea"];
  const bytes = await encodeD6m(plane, "binary-fixture");
  const inspection = inspectD6m(bytes);
  assert.deepEqual(
    { magic: inspection.magic, version: inspection.version, trailer: inspection.trailer, validLength: inspection.validLength, valid: inspection.valid },
    { magic: D6M_MAGIC, version: D6M_VERSION, trailer: D6M_TRAILER, validLength: true, valid: true },
  );
  assert.equal(inspection.width, 256);
  assert.equal(inspection.height, 256);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const underwaterSpec = view.getBigInt64(34 + (underwaterMountain.index - 1) * 12 + 4, true);
  assert.ok((underwaterSpec & TERRAIN_BITS.sea) !== 0n, "combined sea terrain must be present in the native D6M province spec");
  assert.equal((underwaterSpec & TERRAIN_BITS.deep) !== 0n, false);
  const ownerOffset = 34 + plane.provinces.length * 12 + plane.width * plane.height * 2;
  for (const province of plane.provinces) {
    const x = Math.round(province.x * (plane.width - 1));
    const y = Math.round(province.y * (plane.height - 1));
    assert.equal(view.getInt16(ownerOffset + (y * plane.width + x) * 2, true), province.index);
  }
  const topology = computeProvinceTopology(plane);
  const ownerAt = (x: number, y: number) => view.getInt16(ownerOffset + (y * plane.width + x) * 2, true) - 1;
  const transitionCounts = new Map<string, number>();
  const recordTransition = (left: number, right: number) => {
    if (left === right) return;
    const a = plane.provinces[left]!.id;
    const b = plane.provinces[right]!.id;
    const key = connectionKey(a, b);
    transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1);
  };
  for (let y = 0; y < plane.height; y += 1) {
    for (let x = 0; x < plane.width - 1; x += 1) recordTransition(ownerAt(x, y), ownerAt(x + 1, y));
    if (plane.wrapX) recordTransition(ownerAt(plane.width - 1, y), ownerAt(0, y));
  }
  for (let y = 0; y < plane.height - 1; y += 1) {
    for (let x = 0; x < plane.width; x += 1) recordTransition(ownerAt(x, y), ownerAt(x, y + 1));
  }
  if (plane.wrapY) {
    for (let x = 0; x < plane.width; x += 1) recordTransition(ownerAt(x, plane.height - 1), ownerAt(x, 0));
  }
  for (const [key, count] of transitionCounts) {
    if (!topology.pairKeys.has(key)) {
      assert.equal(count, 1, `Only a one-pixel Voronoi-vertex alias may lack a positive-length geometric border (${key})`);
    }
  }

  const corrupted = bytes.slice();
  const corruptedView = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength);
  corruptedView.setBigInt64(16, 1n, true);
  corruptedView.setInt16(ownerOffset, plane.provinces.length + 1, true);
  const corruptedInspection = inspectD6m(corrupted);
  assert.equal(corruptedInspection.validHeader, false);
  assert.equal(corruptedInspection.validOwners, false);
  assert.equal(corruptedInspection.valid, false);
});

test("D6M minimum-capital distance uses exact stored pixels and enabled wrap seams", async () => {
  const project = createDefaultProject("binary-mindist");
  const plane = project.planes[0]!;
  plane.width = 384;
  plane.height = 256;
  plane.wrapX = false;
  plane.wrapY = false;
  plane.provinces = plane.provinces.slice(0, 2).map((province, index) => ({
    ...province,
    id: `mindist-${index + 1}`,
    index: index + 1,
    x: index ? 0.2 : 0.1,
    y: 0.5,
  }));
  plane.edges = [{ id: "mindist-edge", a: plane.provinces[0]!.id, b: plane.provinces[1]!.id, kind: "standard" }];

  const inspectDistance = async () => {
    const bytes = await encodeD6m(plane, "binary-mindist");
    const inspection = inspectD6m(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const first = { x: view.getInt16(34, true), y: view.getInt16(36, true) };
    const second = { x: view.getInt16(46, true), y: view.getInt16(48, true) };
    let dx = Math.abs(first.x - second.x);
    let dy = Math.abs(first.y - second.y);
    if (plane.wrapX) dx = Math.min(dx, plane.width - dx);
    if (plane.wrapY) dy = Math.min(dy, plane.height - dy);
    return {
      encoded: inspection.minimumDistanceInteger + inspection.minimumDistanceFraction / 65535,
      expected: Math.hypot(dx, dy),
    };
  };

  const nonWrapped = await inspectDistance();
  assert.ok(Math.abs(nonWrapped.encoded - nonWrapped.expected) < 1 / 65535);

  plane.provinces[0]!.x = 0.01;
  plane.provinces[1]!.x = 0.99;
  plane.wrapX = true;
  const wrapped = await inspectDistance();
  assert.ok(Math.abs(wrapped.encoded - wrapped.expected) < 1 / 65535);
  assert.ok(wrapped.expected < nonWrapped.expected, "the seam is the shortest enabled periodic path");
});

test("all eight planes are generated, named contiguously, and gate-connected", () => {
  let project = createDefaultProject("eight-realms");
  while (project.planes.length < 8) project = addPlane(project, project.planes.length % 2 ? "underworld" : "dream");
  assert.equal(project.planes.length, 8);
  assert.ok(project.gates.length >= 7);
  const issues = validateProject(project).filter((issue) => issue.severity === "error");
  assert.deepEqual(issues, []);
  for (let index = 0; index < project.planes.length; index += 1) {
    const text = compileMapText(project, index);
    assert.match(text, new RegExp(`#imagefile [^\\r\\n]+${index ? `_plane${index + 1}` : ""}\\.d6m`));
  }
});
