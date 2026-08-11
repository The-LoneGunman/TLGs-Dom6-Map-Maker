import assert from "node:assert/strict";
import test from "node:test";
import type { Plane } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import {
  canAuthorPlaneEdge,
  computeProvinceTopology,
  connectionKey,
  createProvinceOwnershipModel,
  resolvePlaneOwnershipMode,
} from "../src/geometry";
import { encodeD6m, inspectD6m, validateProject } from "../src/dom6";

function sparseFixture(): Plane {
  const plane = createDefaultProject("sparse-owner-fixture").planes[0]!;
  plane.kind = "cave";
  plane.ownershipMode = "sparse";
  plane.width = 256;
  plane.height = 256;
  plane.wrapX = false;
  plane.wrapY = false;
  const positions = [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ] as const;
  plane.provinces = plane.provinces.slice(0, 4).map((province, index) => ({
    ...province,
    id: `sparse-${index + 1}`,
    index: index + 1,
    x: positions[index]![0],
    y: positions[index]![1],
    gridX: index % 2,
    gridY: Math.floor(index / 2),
  }));
  plane.provinceTarget = plane.provinces.length;
  plane.edges = [
    { id: "sparse-ab", a: "sparse-1", b: "sparse-2", kind: "standard" },
    { id: "sparse-bc", a: "sparse-2", b: "sparse-3", kind: "standard" },
    { id: "sparse-cd", a: "sparse-3", b: "sparse-4", kind: "standard" },
    { id: "sparse-da", a: "sparse-4", b: "sparse-1", kind: "standard" },
  ];
  return plane;
}

test("surface ownership stays solid while non-overland ownership defaults to sparse", () => {
  const plane = createDefaultProject("ownership-defaults").planes[0]!;
  assert.equal(resolvePlaneOwnershipMode(plane), "solid");
  const solid = createProvinceOwnershipModel(plane);
  for (let y = 0; y < 17; y += 1) {
    for (let x = 0; x < 29; x += 1) assert.ok(solid.ownerAt((x + 0.5) / 29, (y + 0.5) / 17) >= 0);
  }

  plane.kind = "cave";
  plane.ownershipMode = undefined;
  const sparse = createProvinceOwnershipModel(plane);
  let blanks = 0;
  const samples = 128 * 72;
  for (let y = 0; y < 72; y += 1) {
    for (let x = 0; x < 128; x += 1) if (sparse.ownerAt((x + 0.5) / 128, (y + 0.5) / 72) < 0) blanks += 1;
  }
  assert.equal(resolvePlaneOwnershipMode(plane), "sparse");
  assert.ok(blanks / samples > 0.15, "a sparse non-overland plane must retain meaningful owner-0 space");
  assert.ok(sparse.primitives.some((primitive) => primitive.kind === "chamber"));
  assert.ok(sparse.primitives.some((primitive) => primitive.kind === "corridor"));
  assert.ok(plane.provinces.every((province, index) => sparse.ownerAt(province.x, province.y) === index));
});

test("sparse D6M writes owner 0 with neutral height and preserves capital ownership", async () => {
  const plane = sparseFixture();
  const bytes = await encodeD6m(plane, "sparse-binary");
  const inspection = inspectD6m(bytes);
  assert.equal(inspection.valid, true);
  assert.ok(inspection.noneOwnerPixels > plane.width * plane.height * 0.2);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelCount = plane.width * plane.height;
  const heightOffset = 34 + plane.provinces.length * 12;
  const ownerOffset = heightOffset + pixelCount * 2;
  let sawBlank = false;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (view.getInt16(ownerOffset + pixel * 2, true) !== 0) continue;
    sawBlank = true;
    assert.equal(view.getInt16(heightOffset + pixel * 2, true), 0);
  }
  assert.equal(sawBlank, true);
  plane.provinces.forEach((province, index) => {
    const x = Math.round(province.x * (plane.width - 1));
    const y = Math.round(province.y * (plane.height - 1));
    assert.equal(view.getInt16(ownerOffset + (y * plane.width + x) * 2, true), index + 1);
  });
});

test("sparse chambers connect only along intentional corridors without diagonal shortcuts", () => {
  const plane = sparseFixture();
  const model = createProvinceOwnershipModel(plane);
  const topology = computeProvinceTopology(plane);
  assert.ok(model.ownerAt(0.5, 0.2) >= 0, "the authored top corridor must be owned");
  assert.equal(model.ownerAt(0.5, 0.5), -1, "the chamber interior gap must remain true negative space");
  assert.deepEqual(
    [...topology.pairKeys].sort(),
    plane.edges.map((edge) => connectionKey(edge.a, edge.b)).sort(),
  );
  assert.equal(topology.pairKeys.has(connectionKey("sparse-1", "sparse-3")), false);
  assert.equal(topology.pairKeys.has(connectionKey("sparse-2", "sparse-4")), false);
});

test("an empty sparse authored graph stays empty instead of inheriting Voronoi neighbours", () => {
  const plane = sparseFixture();
  plane.edges = [];
  const topology = computeProvinceTopology(plane);
  const ownership = createProvinceOwnershipModel(plane);
  assert.deepEqual(topology.pairs, []);
  assert.equal(topology.pairKeys.size, 0);
  assert.equal(ownership.primitives.filter((primitive) => primitive.kind === "corridor").length, 0);
  assert.equal(ownership.primitives.filter((primitive) => primitive.kind === "chamber").length, plane.provinces.length);
  assert.ok(plane.provinces.every((province, index) => ownership.ownerAt(province.x, province.y) === index));
});

test("a new sparse manual edge is authorable and creates its canonical corridor", () => {
  const plane = sparseFixture();
  const a = "sparse-1";
  const b = "sparse-3";
  const key = connectionKey(a, b);
  const beforeTopology = computeProvinceTopology(plane);
  assert.equal(createProvinceOwnershipModel(plane).ownerAt(0.5, 0.5), -1);
  assert.equal(canAuthorPlaneEdge(plane, a, b), true);

  plane.edges.push({ id: "manual-diagonal", a, b, kind: "standard" });
  const afterTopology = computeProvinceTopology(plane);
  const addedPairs = [...afterTopology.pairKeys].filter((pair) => !beforeTopology.pairKeys.has(pair));
  assert.deepEqual(addedPairs, [key]);
  assert.ok(createProvinceOwnershipModel(plane).ownerAt(0.5, 0.5) >= 0, "the new edge must own its center corridor");
  assert.equal(canAuthorPlaneEdge(plane, a, b), false, "an existing edge cannot be authored twice");
});

test("solid manual edges require a true shared border and reject invalid endpoints", () => {
  const plane = sparseFixture();
  plane.ownershipMode = "solid";
  assert.equal(canAuthorPlaneEdge(plane, "sparse-1", "sparse-3"), false, "corner-only diagonal provinces are not neighbours");
  assert.equal(canAuthorPlaneEdge(plane, "sparse-1", "sparse-2"), false, "existing edges are rejected");
  assert.equal(canAuthorPlaneEdge(plane, "sparse-1", "sparse-1"), false, "self edges are rejected");
  assert.equal(canAuthorPlaneEdge(plane, "sparse-1", "missing"), false, "missing endpoints are rejected");
});

test("crossing sparse capsules do not invent movement edges", () => {
  const plane = sparseFixture();
  plane.edges = [
    { id: "diagonal-ac", a: "sparse-1", b: "sparse-3", kind: "standard" },
    { id: "diagonal-bd", a: "sparse-2", b: "sparse-4", kind: "standard" },
  ];
  const model = createProvinceOwnershipModel(plane);
  const topology = computeProvinceTopology(plane);
  assert.ok(model.ownerAt(0.5, 0.5) >= 0, "crossing intentional capsules should remain drawable ownership");
  assert.deepEqual([...topology.pairKeys].sort(), [
    connectionKey("sparse-1", "sparse-3"),
    connectionKey("sparse-2", "sparse-4"),
  ].sort());
  assert.equal(topology.pairKeys.has(connectionKey("sparse-1", "sparse-2")), false);
  assert.equal(topology.pairKeys.has(connectionKey("sparse-3", "sparse-4")), false);
});

test("sparse wrap corridors use the shortest periodic image and meet across the seam", () => {
  const plane = sparseFixture();
  plane.wrapX = true;
  plane.provinces = plane.provinces.slice(0, 2).map((province, index) => ({
    ...province,
    id: `wrap-${index + 1}`,
    index: index + 1,
    x: index === 0 ? 0.04 : 0.96,
    y: 0.5,
  }));
  plane.edges = [{ id: "wrap-edge", a: "wrap-1", b: "wrap-2", kind: "standard" }];
  const model = createProvinceOwnershipModel(plane);
  const corridor = model.primitives.find((primitive) => primitive.kind === "corridor");
  assert.ok(corridor && Math.abs(corridor.to.x - corridor.from.x) < 0.2);
  assert.ok(model.ownerAt(0.001, 0.5) >= 0);
  assert.ok(model.ownerAt(0.999, 0.5) >= 0);
  assert.equal(model.ownerAt(0.5, 0.5), -1);
  const seamSegments = computeProvinceTopology(plane).sharedBorders.get(connectionKey("wrap-1", "wrap-2"));
  assert.ok(seamSegments?.some((segment) => segment.from.x === 0 || segment.from.x === 1));
});

test("cave-start nation validation rejects owner IDs and exposes assignment shortages", () => {
  const project = createDefaultProject("cave-start-validation");
  project.settings.caveStartNations = [0, 5, 5, 999_999];
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("IDs of 5 or greater")));
  assert.ok(issues.some((issue) => issue.severity === "warning" && issue.message.includes("duplicated")));
  assert.ok(issues.some((issue) => issue.severity === "warning" && issue.message.includes("vanilla 6.35 catalog")));
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("choose Generate")));
});
