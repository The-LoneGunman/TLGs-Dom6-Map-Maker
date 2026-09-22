import assert from "node:assert/strict";
import test from "node:test";
import type { Plane } from "../src/domain";
import { createDefaultProject, generatePlane } from "../src/generator";
import { createConnectedRegionOwnership, connectedRegionLayoutNotice } from "../src/connectedRegions";
import { createProvinceOwnershipModel, type ProvinceOwnershipModel } from "../src/geometry";

function fixture(seed: string): Plane {
  const project = createDefaultProject(seed, { generate: false });
  return generatePlane({ ...project.planes[0]!, id: seed, kind: "cloud", ownershipMode: "sparse",
    width: 256, height: 256, wrapX: true, wrapY: false, provinceTarget: 40, noGeneratedStarts: true },
  project.settings, seed, 1, { deferStrategicFeatures: true });
}

function samples(model: ProvinceOwnershipModel): Int16Array {
  const result = new Int16Array(256 * 256 + 24);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    result[y * 256 + x] = model.ownerAt((x + .5) / 256, (y + .5) / 256);
  }
  let next = 256 * 256;
  for (const x of [-.15, .1, .5, .85, 1, 1.15]) for (const y of [-.1, .3, .8, 1.1]) {
    result[next++] = model.ownerAt(x, y);
  }
  return result;
}

function assertRasterUnchanged(actual: Int16Array, expected: Int16Array, context: string) {
  let different = 0;
  for (let index = 0; index < expected.length; index++) if (actual[index] !== expected[index]) different++;
  assert.equal(different, 0, `${context}: cached ownership changed at ${different} samples`);
}

for (const mutation of ["coordinates", "dimensions-and-wrapping", "membership-and-order"] as const) {
  test(`regional cached ownership isolates ${mutation} edits from earlier geometry snapshots`, () => {
    const plane = fixture(`regional-cache-snapshot-${mutation}`);
    const original = structuredClone(plane);
    const model = createProvinceOwnershipModel(plane);
    assert.ok(model.regionBorders?.size, "test must exercise connected-region ownership");
    assert.equal(createConnectedRegionOwnership(plane), model);
    assert.equal(connectedRegionLayoutNotice(plane), undefined);
    const before = samples(model);
    if (mutation === "coordinates") {
      plane.provinces[0]!.x = .93;
      plane.provinces[0]!.y = .87;
      plane.provinces[0]!.index += 1000;
    } else if (mutation === "dimensions-and-wrapping") {
      plane.width = 1024;
      plane.height = 512;
      plane.wrapX = false;
      plane.wrapY = true;
    } else {
      plane.provinces.reverse();
      plane.provinces.pop();
      plane.edges.length = 0;
    }
    assertRasterUnchanged(samples(model), before, "previously returned model");
    const restored = createProvinceOwnershipModel(original);
    assert.equal(restored, model, "an unchanged geometry key may safely reuse its cached model");
    assert.equal(createConnectedRegionOwnership(original), model);
    assertRasterUnchanged(samples(restored), before, "restored geometry cache lookup");
    for (const [owner, province] of original.provinces.entries()) assert.equal(restored.ownerAt(province.x, province.y), owner);
  });
}
