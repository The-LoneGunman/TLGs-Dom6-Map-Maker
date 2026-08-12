import assert from "node:assert/strict";
import test from "node:test";
import {
  assessArtworkEligibility,
  classifyArtworkScale,
  measurePolygonProvinceArtwork,
  measureSparseProvinceArtwork,
  paintArtworkClippedToProvince,
  periodicArtworkCopies,
  planProvinceArtwork,
  planSeamlessTiles,
} from "../src/adaptiveArtwork";
import { UNIVERSAL_MATERIAL_ASSETS, planeMaterialAssets } from "../src/MapCanvas";
import { createDefaultProject } from "../src/generator";
import { createProvinceOwnershipModel, type Point } from "../src/geometry";

const square = (minX: number, minY: number, maxX: number, maxY: number): Point[][] => [[
  { x: minX, y: minY },
  { x: maxX, y: minY },
  { x: maxX, y: maxY },
  { x: minX, y: maxY },
]];

const planeShape = { wrapX: false, wrapY: false };

test("geometry buckets suppress tiny cells, micro-fit narrow cells, and enrich large cells", () => {
  const tiny = measurePolygonProvinceArtwork(square(0.498, 0.498, 0.502, 0.502), { x: 0.5, y: 0.5 }, planeShape, 1536, 1024);
  assert.equal(classifyArtworkScale(tiny), "suppressed");
  const tinyEligibility = assessArtworkEligibility(tiny, { id: "landmark", fallback: "micro" });
  assert.equal(tinyEligibility.disposition, "suppress", "sub-safe cells omit decoration instead of forcing it");

  const narrow = measurePolygonProvinceArtwork(square(0.25, 0.495, 0.75, 0.505), { x: 0.5, y: 0.5 }, planeShape, 1536, 1024);
  assert.ok(narrow.aspectRatio > 30);
  const narrowPlan = planProvinceArtwork(narrow, {
    id: "compact-ruin",
    maxAspectRatio: 3,
    minInscribedRadiusReferencePx: 3,
    nominalSizeReferencePx: 9,
    fallback: "micro",
  }, "narrow-seed");
  assert.equal(narrowPlan.eligibility.disposition, "fallback");
  assert.equal(narrowPlan.placements.length, 1, "a narrow connector receives one fitted glyph, never a squashed plate");
  assert.ok(narrowPlan.placements[0]!.height <= narrow.inscribedRadiusPx * 2);

  const large = measurePolygonProvinceArtwork(square(0.25, 0.25, 0.75, 0.75), { x: 0.5, y: 0.5 }, planeShape, 1536, 1024);
  assert.equal(classifyArtworkScale(large), "hero");
  const largePlan = planProvinceArtwork(large, { id: "forest-cluster", nominalSizeReferencePx: 12, fallback: "suppress" }, "large-seed");
  assert.equal(largePlan.placements.length, 9);
});

test("placement is deterministic and stable across proportional supported resolutions", () => {
  const polygon = square(0.35, 0.3, 0.65, 0.7);
  const low = measurePolygonProvinceArtwork(polygon, { x: 0.5, y: 0.5 }, planeShape, 2048, 1152);
  const high = measurePolygonProvinceArtwork(polygon, { x: 0.5, y: 0.5 }, planeShape, 3840, 2160);
  assert.equal(classifyArtworkScale(low), classifyArtworkScale(high));
  assert.ok(Math.abs(low.areaReferencePx2 - high.areaReferencePx2) < 1e-6);

  const profile = { id: "resolution-stable", nominalSizeReferencePx: 14, density: 0.8, fallback: "suppress" } as const;
  const first = planProvinceArtwork(low, profile, "same-seed");
  const repeated = planProvinceArtwork(low, profile, "same-seed");
  assert.deepEqual(first, repeated);
  const scaled = planProvinceArtwork(high, profile, "same-seed");
  const ratio = 3840 / 2048;
  assert.equal(first.placements.length, scaled.placements.length);
  first.placements.forEach((placement, index) => {
    assert.ok(Math.abs(scaled.placements[index]!.width / placement.width - ratio) < 1e-10);
    assert.equal(scaled.placements[index]!.rotation, placement.rotation);
    assert.equal(scaled.placements[index]!.flipX, placement.flipX);
    assert.equal(scaled.placements[index]!.flipY, placement.flipY);
  });
});

test("wrapped seam fragments are measured as one province and artwork receives visible seam copies", () => {
  const seamPolygons: Point[][] = [
    [{ x: 0.94, y: 0.4 }, { x: 1, y: 0.4 }, { x: 1, y: 0.6 }, { x: 0.94, y: 0.6 }],
    [{ x: 0, y: 0.4 }, { x: 0.04, y: 0.4 }, { x: 0.04, y: 0.6 }, { x: 0, y: 0.6 }],
  ];
  const metrics = measurePolygonProvinceArtwork(seamPolygons, { x: 0.98, y: 0.5 }, { wrapX: true, wrapY: false }, 1536, 1024);
  assert.ok(metrics.bounds.width < 200, `periodic bounds should be local, got ${metrics.bounds.width}`);
  assert.ok(metrics.inscribedRadiusPx > 20);

  const placement = { x: 5, y: 200, width: 24, height: 18, rotation: Math.PI / 4, flipX: false, flipY: false, opacity: 1 };
  const wrapped = periodicArtworkCopies(placement, 1536, 1024, true, false);
  assert.deepEqual(wrapped.map((copy) => copy.periodicOffsetX), [0, 1]);
  assert.equal(periodicArtworkCopies(placement, 1536, 1024, false, false).length, 1);

  const corner = { ...placement, x: 3, y: 3 };
  assert.equal(periodicArtworkCopies(corner, 1536, 1024, true, true).length, 4);
});

test("mirrored tile plans cover arbitrary sizes and close enabled wrap seams", () => {
  const fixtures = [
    [1536, 1024, true, false],
    [2048, 1152, true, true],
    [3840, 2160, false, true],
    [2880, 2880, true, true],
    [777, 2333, true, true],
  ] as const;
  for (const [width, height, wrapX, wrapY] of fixtures) {
    const layout = planSeamlessTiles(width, height, 1024, 1024, wrapX, wrapY);
    assert.ok(layout.tiles.length > 0);
    assert.equal(layout.tiles.length, layout.columns * layout.rows);
    assert.ok(Math.abs(layout.tiles.reduce((sum, tile) => sum + (tile.y === 0 ? tile.width : 0), 0) - width) < 1e-6);
    if (wrapX) {
      assert.equal(layout.columns % 2, 0);
      const left = layout.tiles.find((tile) => tile.x === 0 && tile.y === 0)!;
      const right = layout.tiles.find((tile) => Math.abs(tile.x + tile.width - width) < 1e-6 && tile.y === 0)!;
      assert.equal(left.flipX, false);
      assert.equal(right.flipX, true, "opposite boundaries sample the same source edge");
    }
    if (wrapY) assert.equal(layout.rows % 2, 0);
  }
  assert.deepEqual(planSeamlessTiles(0, 100, 1024, 1024, true, true), { columns: 0, rows: 0, tiles: [] });
});

test("sparse provinces use conservative chamber geometry rather than corridor area", () => {
  const plane = createDefaultProject("sparse-art-metrics").planes[0]!;
  plane.kind = "abyss";
  plane.ownershipMode = "sparse";
  plane.provinces = plane.provinces.slice(0, 5);
  plane.provinceTarget = plane.provinces.length;
  plane.provinces.forEach((province, index) => {
    province.id = `sparse-art-${index}`;
    province.x = 0.12 + index * 0.18;
    province.y = index % 2 ? 0.6 : 0.4;
  });
  plane.edges = plane.provinces.slice(1).map((province, index) => ({
    id: `sparse-edge-${index}`,
    a: plane.provinces[index]!.id,
    b: province.id,
    kind: "standard" as const,
  }));
  const ownership = createProvinceOwnershipModel(plane);
  const metrics = measureSparseProvinceArtwork(0, plane.provinces[0]!, ownership, 2048, 1152);
  assert.equal(metrics.source, "sparse");
  assert.ok(metrics.areaPx2 > 0);
  assert.ok(Number.isFinite(metrics.aspectRatio));
  const plan = planProvinceArtwork(metrics, { id: "abyss-mark", nominalSizeReferencePx: 10, maxAspectRatio: 4, fallback: "micro" }, "abyss-seed");
  assert.ok(plan.placements.length <= 9);
  for (const placement of plan.placements) assert.ok(Math.hypot(placement.width, placement.height) / 2 <= metrics.inscribedRadiusPx + 1e-6);
});

test("canonical clipping wraps every painter invocation and universal materials route by terrain", () => {
  const calls: string[] = [];
  const fake = {
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("begin"),
    moveTo: () => calls.push("move"),
    lineTo: () => calls.push("line"),
    closePath: () => calls.push("close"),
    clip: () => calls.push("clip"),
  } as unknown as CanvasRenderingContext2D;
  paintArtworkClippedToProvince(fake, { polygons: square(0, 0, 1, 1), width: 100, height: 100 }, () => calls.push("paint"));
  assert.ok(calls.indexOf("clip") < calls.indexOf("paint"));
  assert.equal(calls.at(0), "save");
  assert.equal(calls.at(-1), "restore");

  const plane = createDefaultProject("material-routing").planes[0]!;
  plane.provinces = plane.provinces.slice(0, 4);
  ["plains", "forest", "mountains", "sea"].forEach((terrain, index) => { plane.provinces[index]!.terrain = terrain as never; });
  assert.deepEqual(planeMaterialAssets(plane), Object.values(UNIVERSAL_MATERIAL_ASSETS).sort());
  plane.provinces = plane.provinces.slice(0, 1);
  plane.provinces[0]!.terrain = "plains";
  assert.deepEqual(planeMaterialAssets(plane, "forested"), [UNIVERSAL_MATERIAL_ASSETS.foliage]);
  assert.deepEqual(planeMaterialAssets(plane, "flooded"), [UNIVERSAL_MATERIAL_ASSETS.water]);
});
