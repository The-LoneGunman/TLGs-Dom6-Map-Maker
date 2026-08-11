import assert from "node:assert/strict";
import test from "node:test";
import { encodeD6m } from "../src/dom6";
import { isWaterProvince, type Plane } from "../src/domain";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import {
  computeProvinceTopology,
  connectionKey,
  createProvinceOwnershipModel,
  type ProvinceBoundaryPrimitive,
} from "../src/geometry";
import { samplePlaneOwnership } from "../src/MapCanvas";

interface RasterEdges {
  left: number[];
  right: number[];
  top: number[];
  bottom: number[];
}

function generatedStyxPlane(width: number, height: number): Plane {
  let project = createDefaultProject("styx-raster-edge");
  project.settings = { ...project.settings, throneCount: 0 };
  project = addPlane(project, "underworld", { generate: false, autoSize: false, provinceTarget: 64 });
  const underworld = project.planes[1]!;
  underworld.width = width;
  underworld.height = height;
  return generateProject(project).planes[1]!;
}

function boundaryPrimitives(plane: Plane): ProvinceBoundaryPrimitive[] {
  return createProvinceOwnershipModel(plane).primitives.filter(
    (primitive): primitive is ProvinceBoundaryPrimitive => primitive.kind === "boundary",
  );
}

function rasterEdges(owners: Int16Array, width: number, height: number): RasterEdges {
  const left: number[] = [];
  const right: number[] = [];
  const top: number[] = [];
  const bottom: number[] = [];
  for (let y = 0; y < height; y += 1) {
    left.push(owners[y * width]!);
    right.push(owners[y * width + width - 1]!);
  }
  for (let x = 0; x < width; x += 1) {
    top.push(owners[x]!);
    bottom.push(owners[(height - 1) * width + x]!);
  }
  return { left, right, top, bottom };
}

function d6mOwners(bytes: Uint8Array, plane: Plane): Int16Array {
  const pixelCount = plane.width * plane.height;
  const heightOffset = 34 + plane.provinces.length * 12;
  const ownerOffset = heightOffset + pixelCount * 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const owners = new Int16Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    owners[pixel] = view.getInt16(ownerOffset + pixel * 2, true) - 1;
  }
  return owners;
}

function assertSameRaster(actual: Int16Array, expected: Int16Array): void {
  assert.equal(actual.length, expected.length);
  let firstDifference = -1;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      firstDifference = index;
      break;
    }
  }
  assert.equal(firstDifference, -1, `ownership rasters first differ at pixel ${firstDifference}`);
}

function assertStyxEndsOnly(
  edges: RasterEdges,
  axis: "x" | "y",
  waterOwners: ReadonlySet<number>,
): void {
  const ends = axis === "x" ? [edges.left, edges.right] : [edges.top, edges.bottom];
  const unrelated = axis === "x" ? [edges.top, edges.bottom] : [edges.left, edges.right];
  for (const edge of ends) {
    const waterPixels = edge.filter((owner) => waterOwners.has(owner)).length;
    assert.ok(waterPixels > 0, "each opposite Styx boundary must contain water-owned pixels");
    assert.ok(waterPixels < edge.length / 3, "the endpoint must remain a narrow band, not flood its map edge");
    assert.ok(edge.every((owner) => owner < 0 || waterOwners.has(owner)), "only Styx water may own its selected boundary");
  }
  for (const edge of unrelated) {
    assert.ok(edge.every((owner) => owner === -1), "perpendicular nonwrapped boundaries must remain owner 0");
  }
  assert.equal(edges.top[0], -1);
  assert.equal(edges.top.at(-1), -1);
  assert.equal(edges.bottom[0], -1);
  assert.equal(edges.bottom.at(-1), -1);
}

test("compact Styx D6M and preview ownership reach only the two horizontal boundaries", async () => {
  const plane = generatedStyxPlane(256, 256);
  const model = createProvinceOwnershipModel(plane);
  const waterOwners = new Set(plane.provinces.flatMap((province, owner) => isWaterProvince(province) ? [owner] : []));
  const boundaries = boundaryPrimitives(plane);
  assert.deepEqual(boundaries.map(({ axis, side }) => ({ axis, side })), [
    { axis: "x", side: "low" },
    { axis: "x", side: "high" },
  ]);

  const water = plane.provinces
    .map((province, owner) => ({ province, owner }))
    .filter(({ province }) => isWaterProvince(province));
  const low = [...water].sort((a, b) => a.province.x - b.province.x || a.province.index - b.province.index)[0]!;
  const high = [...water].sort((a, b) => b.province.x - a.province.x || a.province.index - b.province.index)[0]!;
  assert.equal(boundaries[0]!.owner, low.owner);
  assert.equal(boundaries[1]!.owner, high.owner);
  assert.equal(model.ownerAt(0, boundaries[0]!.from.y), low.owner);
  assert.equal(model.ownerAt(1, boundaries[1]!.from.y), high.owner);

  const previewOwners = samplePlaneOwnership(plane, plane.width, plane.height, model);
  assertStyxEndsOnly(rasterEdges(previewOwners, plane.width, plane.height), "x", waterOwners);
  const firstD6m = await encodeD6m(plane, "styx-raster-edge:d6m");
  assertSameRaster(d6mOwners(firstD6m, plane), previewOwners);
  const secondD6m = await encodeD6m(structuredClone(plane), "styx-raster-edge:d6m");
  assert.deepEqual(secondD6m, firstD6m, "equivalent Styx projects must export byte-identical ownership");
});

test("non-square high-resolution Styx reaches only the two vertical boundaries", async () => {
  const plane = generatedStyxPlane(768, 1152);
  const model = createProvinceOwnershipModel(plane);
  const waterOwners = new Set(plane.provinces.flatMap((province, owner) => isWaterProvince(province) ? [owner] : []));
  const boundaries = boundaryPrimitives(plane);
  assert.deepEqual(boundaries.map(({ axis, side }) => ({ axis, side })), [
    { axis: "y", side: "low" },
    { axis: "y", side: "high" },
  ]);
  assert.equal(model.ownerAt(boundaries[0]!.from.x, 0), boundaries[0]!.owner);
  assert.equal(model.ownerAt(boundaries[1]!.from.x, 1), boundaries[1]!.owner);

  const previewOwners = samplePlaneOwnership(plane, plane.width, plane.height, model);
  assertStyxEndsOnly(rasterEdges(previewOwners, plane.width, plane.height), "y", waterOwners);
  const d6m = await encodeD6m(plane, "styx-raster-edge:portrait:d6m");
  const exportedOwners = d6mOwners(d6m, plane);
  assertSameRaster(exportedOwners, previewOwners);
  assertStyxEndsOnly(rasterEdges(exportedOwners, plane.width, plane.height), "y", waterOwners);
});

test("Styx edge stubs require nonwrapped connected water and never add movement topology", () => {
  const plane = generatedStyxPlane(256, 256);
  const topology = computeProvinceTopology(plane);
  assert.deepEqual(
    [...topology.pairKeys].sort(),
    plane.edges.map((edge) => connectionKey(edge.a, edge.b)).sort(),
  );
  assert.equal(boundaryPrimitives(plane).length, 2);

  const wrapped = structuredClone(plane);
  wrapped.wrapX = true;
  assert.equal(boundaryPrimitives(wrapped).length, 0, "the selected Styx axis must end at nonwrapped boundaries");

  const disconnected = structuredClone(plane);
  const waterIds = new Set(disconnected.provinces.filter(isWaterProvince).map((province) => province.id));
  disconnected.edges = disconnected.edges.filter((edge) => !(waterIds.has(edge.a) && waterIds.has(edge.b)));
  assert.equal(boundaryPrimitives(disconnected).length, 0, "edge paint must not repair a disconnected water graph");
  assert.deepEqual(
    [...computeProvinceTopology(disconnected).pairKeys].sort(),
    disconnected.edges.map((edge) => connectionKey(edge.a, edge.b)).sort(),
  );
});
