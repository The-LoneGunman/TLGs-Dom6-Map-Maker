import assert from "node:assert/strict";
import test from "node:test";
import { isWaterProvince, type MapProject, type OceanLayout, type Plane, type StartDistribution } from "../src/domain";
import { validateProject } from "../src/dom6";
import { classifyCurrentStart, createDefaultProject, generatePlane, generateProject } from "../src/generator";

function project(seed: string, layout: OceanLayout, waterPercent: number, startDistribution?: StartDistribution): MapProject {
  const result = createDefaultProject(seed, { generate: false });
  Object.assign(result.settings, { oceanLayout: layout, waterPercent });
  if (startDistribution) result.settings.startDistribution = { ...startDistribution };
  return result;
}

function waterCount(plane: Plane): number {
  return plane.provinces.filter(isWaterProvince).length;
}

function startCategories(plane: Plane): string[] {
  return plane.provinces.filter(province => province.start).map(province => classifyCurrentStart(plane, province)).sort();
}

function requestedCategories(distribution: StartDistribution): string[] {
  return (["land", "coastal", "water"] as const).flatMap(type => Array.from({ length: distribution[type] }, () => type)).sort();
}

function stable(value: MapProject): unknown {
  return { ...value, updatedAt: undefined };
}

test("natural-layout start repair keeps generated Sea, Deep Sea and Kelp instead of flattening every sea", () => {
  const terrains = new Map<string, number>();
  const cases: Array<{ seed: string; distribution?: StartDistribution }> = [
    { seed: "wv-alpha" },
    { seed: "wv-beta" },
    { seed: "wv-zeta", distribution: { land: 2, coastal: 2, water: 2, cave: 0, other: 0 } },
  ];
  for (const { seed, distribution } of cases) {
    const source = project(seed, "natural", 30, distribution);
    const generated = generateProject(source), final = generated.planes[0]!;
    // The same deferred plane the project pipeline generates before its
    // natural-layout start-category repair runs.
    const deferred = generatePlane({ ...source.planes[0]!, provinceTarget: final.provinces.length }, source.settings,
      `${source.seed}:plane:0:v1`, 0, { deferStrategicFeatures: true, waterPercent: 30 });
    const before = new Map(deferred.provinces.map(province => [province.id, province]));
    const water = final.provinces.filter(isWaterProvince);
    let kept = 0;
    for (const province of water) {
      terrains.set(province.terrain, (terrains.get(province.terrain) ?? 0) + 1);
      const original = before.get(province.id);
      if (!original || !isWaterProvince(original)) continue;
      kept += 1;
      assert.equal(province.terrain, original.terrain, `${seed}: ${province.id} kept water must keep its generated terrain`);
      assert.equal(province.biome, original.biome, `${seed}: ${province.id} kept water must keep its generated biome`);
      assert.deepEqual(province.terrainFlags, original.terrainFlags, `${seed}: ${province.id} kept water must keep its flags`);
    }
    assert.ok(kept >= water.length / 2, `${seed}: most generated water should survive the start repair (${kept}/${water.length})`);
    // Every generated water province has its own position-scaled population,
    // so a flat repair value collapses these to a handful of distinct values.
    const populations = new Set(water.map(province => province.population));
    assert.ok(populations.size >= Math.ceil(water.length * 0.75),
      `${seed}: ${populations.size} distinct populations across ${water.length} water provinces`);
    assert.equal(water.length, waterCount(deferred), `${seed}: the repair keeps the generated water quota`);
    assert.deepEqual(startCategories(final), requestedCategories(generated.settings.startDistribution!), seed);
    assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), [], seed);
  }
  assert.ok((terrains.get("deepsea") ?? 0) > 0, `natural layouts must produce Deep Sea: ${JSON.stringify([...terrains])}`);
  assert.ok((terrains.get("kelp") ?? 0) > 0, `natural layouts must produce Kelp: ${JSON.stringify([...terrains])}`);
  assert.ok((terrains.get("sea") ?? 0) > 0);

  const repeat = project("wv-zeta", "natural", 30, cases[2]!.distribution);
  assert.deepEqual(stable(generateProject(repeat)), stable(generateProject(repeat)), "natural water repair must stay deterministic");
});

test("natural-layout start repair keeps the Oceanic variant's water floor", () => {
  for (const seed of ["oceanic-o1", "oceanic-o2"]) {
    const counts = new Map<OceanLayout, number>();
    for (const layout of ["natural", "single_continent"] as const) {
      const source = project(seed, layout, 18);
      source.planes[0]!.variant = "oceanic";
      const generated = generateProject(source), final = generated.planes[0]!;
      counts.set(layout, waterCount(final));
      assert.ok(waterCount(final) >= Math.round(final.provinces.length * 0.42),
        `${seed}/${layout}: ${waterCount(final)}/${final.provinces.length} water is below the Oceanic 42% floor`);
      if (layout === "natural") {
        assert.deepEqual(startCategories(final), requestedCategories(generated.settings.startDistribution!), seed);
        assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), [], seed);
      }
    }
    assert.equal(counts.get("natural"), counts.get("single_continent"), `${seed}: Oceanic water must not depend on the ocean layout`);
  }
});

test("natural-layout start repair keeps the start-driven water increase", () => {
  // No requested water, but three water and three coastal capitals: the
  // project raises this plane's quota to fit them. The natural repair must
  // not fall back to the raw 0% setting.
  const distribution: StartDistribution = { land: 0, coastal: 3, water: 3, cave: 0, other: 0 };
  const counts = new Map<OceanLayout, number>();
  for (const layout of ["natural", "single_continent"] as const) {
    const generated = generateProject(project("sw-alpha", layout, 0, distribution));
    counts.set(layout, waterCount(generated.planes[0]!));
    if (layout === "natural") {
      assert.deepEqual(startCategories(generated.planes[0]!), requestedCategories(distribution));
      assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), []);
    }
  }
  assert.ok((counts.get("single_continent") ?? 0) > distribution.water + distribution.coastal,
    "fixture must exercise a quota above the forced start water");
  assert.equal(counts.get("natural"), counts.get("single_continent"));
});
