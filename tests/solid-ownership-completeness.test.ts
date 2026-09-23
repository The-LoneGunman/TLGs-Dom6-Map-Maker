import assert from "node:assert/strict";
import test from "node:test";
import type { Plane } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import { createProvinceOwnershipModel } from "../src/geometry";

function random(seed: number) {
  return () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9) | 0;
    let value = Math.imul(seed ^ (seed >>> 13), 3266489917);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967296;
  };
}

const template = createDefaultProject("solid-ownership-completeness").planes[0]!;

/** Plain solid plane (no natural-landform warp) with the given province centres. */
function syntheticPlane(points: ReadonlyArray<readonly [number, number]>, wrap: boolean): Plane {
  const province = template.provinces[0]!;
  return {
    ...structuredClone(template),
    kind: "surface",
    ownershipMode: "solid",
    landformStyle: undefined,
    landformWater: undefined,
    width: 1600,
    height: 900,
    wrapX: wrap,
    wrapY: wrap,
    edges: [],
    provinces: points.map(([x, y], index) => ({
      ...structuredClone(province),
      id: `p${index}`,
      index: index + 1,
      x,
      y,
      start: false,
      defenders: [],
      sites: [],
    })),
  };
}

function nonNearestOwners(plane: Plane, width: number, height: number): number {
  const model = createProvinceOwnershipModel(plane);
  const distance = (x: number, y: number, owner: number) => {
    const province = plane.provinces[owner]!;
    let dx = Math.abs(x - province.x);
    let dy = Math.abs(y - province.y);
    if (plane.wrapX) dx = Math.min(dx, 1 - dx);
    if (plane.wrapY) dy = Math.min(dy, 1 - dy);
    return dx * dx + dy * dy;
  };
  let mismatches = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const x = (column + 0.5) / width;
      const y = (row + 0.5) / height;
      let nearest = Infinity;
      for (let owner = 0; owner < plane.provinces.length; owner += 1) nearest = Math.min(nearest, distance(x, y, owner));
      if (distance(x, y, model.ownerAt(x, y)) - nearest > 1e-9) mismatches += 1;
    }
  }
  return mismatches;
}

test("solid ownership picks a nearest province even for clustered coordinates", () => {
  // Before candidate buckets were completed, these layouts gave hundreds of
  // samples to a province that was not the nearest (for example 209 of 90,000
  // for the 300-province layout), because each cell kept only its first dozen
  // ring candidates.
  const layouts: Array<{ count: number; wrap: boolean; point: (next: () => number, index: number) => [number, number] }> = [
    { count: 300, wrap: false, point: (next, index) => index % 3 === 0 ? [0.1 + next() * 0.1, 0.1 + next() * 0.1] : [next(), next()] },
    { count: 500, wrap: true, point: (next, index) => index % 3 === 0 ? [0.1 + next() * 0.1, 0.1 + next() * 0.1] : [next(), next()] },
    { count: 400, wrap: false, point: (next, index) => index % 2 === 0 ? [0.45 + next() * 0.04, 0.45 + next() * 0.04] : [next(), next()] },
    {
      count: 650,
      wrap: true,
      point: (next, index) => {
        if (index % 9 === 0) return [next(), next()];
        const cluster = index % 4;
        return [[0.05, 0.9, 0.3, 0.7][cluster]! + next() * 0.03, [0.1, 0.2, 0.85, 0.5][cluster]! + next() * 0.03];
      },
    },
    { count: 200, wrap: true, point: (next) => [next(), next()] },
  ];
  for (const [layoutIndex, layout] of layouts.entries()) {
    const next = random(layout.count * 7 + (layout.wrap ? 1 : 0) + layoutIndex * 1013);
    const plane = syntheticPlane(Array.from({ length: layout.count }, (_, index) => {
      const [x, y] = layout.point(next, index);
      return [x, y] as const;
    }), layout.wrap);
    assert.equal(nonNearestOwners(plane, 200, 113), 0, `layout ${layoutIndex} (${layout.count} provinces, wrap ${layout.wrap})`);
  }
});

test("solid ownership of a generated plane stays nearest-owner exact", () => {
  const plane = { ...createDefaultProject("solid-ownership-generated").planes[0]!, landformStyle: undefined, landformWater: undefined };
  assert.ok(plane.provinces.length > 64, "the bucketed candidate path needs more than 64 provinces");
  assert.equal(nonNearestOwners(plane, 192, 108), 0);
});
