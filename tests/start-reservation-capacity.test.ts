import assert from "node:assert/strict";
import test from "node:test";

import { validateProject } from "../src/dom6";
import {
  addPlane,
  adjacencyFor,
  calculateFairness,
  createDefaultProject,
  generateProject,
  preflightStartPlan,
  shortestDistances,
} from "../src/generator";

test("reserved auto-sized core planes do not consume the eligible planes' start capacity", { timeout: 120_000 }, () => {
  let project = createDefaultProject("postmerge-reserved-fallback-p12");
  Object.assign(project.settings, {
    players: 12,
    provincesPerPlayer: 8,
    throneCount: 14,
    startDistribution: { land: 8, coastal: 0, water: 0, cave: 2, other: 2 },
  });
  project.planes[0]!.autoSize = true;
  project.planes[0]!.noGeneratedStarts = true;
  project = addPlane(project, "surface", { generate: false, autoSize: true });
  project = addPlane(project, "cave", { generate: false, autoSize: true, noGeneratedStarts: true });
  project = addPlane(project, "underworld", { generate: false, autoSize: true });
  project = addPlane(project, "dream", { generate: false, autoSize: true, noGeneratedStarts: true });
  project = addPlane(project, "air", { generate: false, autoSize: true });

  assert.deepEqual(preflightStartPlan(project), []);
  const generated = generateProject(project);
  const [reservedSurface, eligibleSurface, reservedCave, underworld, reservedDream, air] = generated.planes;
  assert.equal(reservedSurface!.provinceTarget, 18);
  assert.equal(eligibleSurface!.provinceTarget, 64);
  assert.equal(reservedCave!.provinceTarget, 18);
  assert.equal(reservedSurface!.provinces.some((province) => province.start), false);
  assert.equal(reservedCave!.provinces.some((province) => province.start), false);
  assert.equal(reservedDream!.provinces.some((province) => province.start), false);
  assert.equal(eligibleSurface!.provinces.filter((province) => province.startType === "land").length, 8);
  assert.equal(underworld!.provinces.filter((province) => province.startType === "cave").length, 2);
  assert.equal(air!.provinces.filter((province) => province.startType === "other").length, 2);
  assert.equal(calculateFairness(generated).startAllocation, 100);

  for (const plane of generated.planes) {
    const starts = plane.provinces.filter((province) => province.start);
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    for (let left = 0; left < starts.length; left += 1) {
      const distances = shortestDistances(adjacency, starts[left]!.id);
      for (let right = left + 1; right < starts.length; right += 1) {
        assert.ok((distances.get(starts[right]!.id) ?? 0) >= 3);
      }
    }
  }
  assert.deepEqual(validateProject(generated).filter((issue) => issue.severity === "error"), []);
});

test("the first plane can be a special-realm target for generated Other starts", { timeout: 120_000 }, () => {
  const project = createDefaultProject("postmerge-first-dream");
  Object.assign(project.settings, {
    players: 4,
    provincesPerPlayer: 8,
    startDistribution: { land: 0, coastal: 0, water: 0, cave: 0, other: 4 },
  });
  project.planes[0]!.kind = "dream";
  project.planes[0]!.variant = "wild";
  project.planes[0]!.autoSize = true;

  assert.deepEqual(preflightStartPlan(project), []);
  const generated = generateProject(project);
  assert.equal(generated.planes[0]!.provinces.filter((province) => province.startType === "other").length, 4);
  assert.equal(calculateFairness(generated).startAllocation, 100);
  assert.deepEqual(validateProject(generated).filter((issue) => issue.severity === "error"), []);
});
