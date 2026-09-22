import assert from "node:assert/strict";
import test from "node:test";
import { cloneProject, isBlockedProvince, isCaveProvince, isWaterProvince, type GenerationSettings, type Plane } from "../src/domain";
import { createDefaultProject, generatePlane, generateProject } from "../src/generator";
import { parseProject, serializeProject } from "../src/export";
import { applySettingsRecipe, createSettingsRecipe } from "../src/recipes";
import { previewContentReroll } from "../src/iteration";
import { computeProvinceTopology } from "../src/geometry";

const SCALES = [48, 96, 192] as const;
const SEEDS = 24;

function fixture(count: number, index: number, cohesion: number, planeOverrides: Partial<Plane> = {}, settingsOverrides: Partial<GenerationSettings> = {}): Plane {
  const seed = `biome-cohesion-corpus-${index}`, base = createDefaultProject(seed, { generate: false });
  return generatePlane({ ...base.planes[0]!, width: 1024, height: 768, provinceTarget: count,
    wrapX: true, wrapY: true, ...planeOverrides },
  { ...base.settings, biomeCohesion: cohesion, waterPercent: 18, throneCount: 0, ...settingsOverrides },
  `${seed}:scale:${count}`, 0, { deferStrategicFeatures: true });
}

/** Terrain components follow visible adjacency, independent of movement blockers. */
function metrics(plane: Plane) {
  const dry = plane.provinces.filter(province => !isWaterProvince(province) && !isBlockedProvince(province));
  const byId = new Map(dry.map(province => [province.id, province]));
  const adjacency = new Map(dry.map(province => [province.id, [] as string[]]));
  let same = 0, borders = 0;
  for (const pair of computeProvinceTopology(plane).pairs) {
    const a = byId.get(pair.a), b = byId.get(pair.b);
    if (!a || !b) continue;
    borders++;
    if (a.terrain !== b.terrain) continue;
    same++; adjacency.get(a.id)!.push(b.id); adjacency.get(b.id)!.push(a.id);
  }
  const unseen = new Set(byId.keys()), sizes: number[] = [];
  while (unseen.size) {
    const first = unseen.values().next().value!, queue = [first]; unseen.delete(first);
    for (let cursor = 0; cursor < queue.length; cursor++) for (const next of adjacency.get(queue[cursor]!)!) {
      if (unseen.delete(next)) queue.push(next);
    }
    sizes.push(queue.length);
  }
  const terrain = new Map<string, number>();
  for (const province of dry) terrain.set(province.terrain, (terrain.get(province.terrain) ?? 0) + 1);
  return { dry: dry.length, sameness: same / borders, meanPatch: dry.length / sizes.length,
    provinceWeightedPatch: sizes.reduce((sum, size) => sum + size * size, 0) / dry.length,
    largestShare: Math.max(...sizes) / dry.length, singletonShare: sizes.filter(size => size === 1).length / dry.length,
    terrain };
}

function cohort(count: number, cohesion: number) {
  const values = Array.from({ length: SEEDS }, (_, index) => metrics(fixture(count, index, cohesion)));
  const average = (key: "sameness" | "meanPatch" | "provinceWeightedPatch" | "largestShare" | "singletonShare") =>
    values.reduce((sum, value) => sum + value[key], 0) / SEEDS;
  const dry = values.reduce((sum, value) => sum + value.dry, 0);
  const terrain = new Map<string, number>();
  for (const value of values) for (const [key, count] of value.terrain) terrain.set(key, (terrain.get(key) ?? 0) + count);
  return { dry, sameness: average("sameness"), meanPatch: average("meanPatch"),
    provinceWeightedPatch: average("provinceWeightedPatch"), largestShare: average("largestShare"),
    singletonShare: average("singletonShare"), shares: Object.fromEntries([...terrain].map(([key, count]) => [key, count / dry])) };
}

// Recorded before the 2026-09-22 biome adjustment: same 24 seeds, exact fixture
// dimensions/wrapping/water settings above, old sampler at its 68% default.
const PREVIOUS_DEFAULT = {
  48: { sameness: .3998, meanPatch: 3.1024, provinceWeightedPatch: 10.1111, largestShare: .4476 },
  96: { sameness: .5493, meanPatch: 4.8684, provinceWeightedPatch: 29.8650, largestShare: .5849 },
  192: { sameness: .5727, meanPatch: 6.2176, provinceWeightedPatch: 49.0642, largestShare: .5191 },
};
const PREVIOUS_HIGH_COHESION = {
  48: { sameness: .4168, meanPatch: 3.4214 },
  96: { sameness: .5443, meanPatch: 5.1574 },
  192: { sameness: .5956, meanPatch: 7.1052 },
};

test("the new default makes modestly smaller, varied terrain regions over 24 seeds at three map scales", context => {
  assert.equal(createDefaultProject("biome-default", { generate: false }).settings.biomeCohesion, 58);
  for (const count of SCALES) {
    const current = cohort(count, 58), previous = PREVIOUS_DEFAULT[count];
    assert.equal(current.dry, SEEDS * (count - Math.round(count * .18)), `${count}: ocean quotas are unchanged`);
    assert.ok(current.meanPatch < previous.meanPatch, `${count}: average contiguous dry patches should be smaller`);
    assert.ok(current.provinceWeightedPatch < previous.provinceWeightedPatch, `${count}: avoid hiding a larger dominant patch behind isolated scraps`);
    assert.ok(current.largestShare < previous.largestShare, `${count}: largest patches should not expand`);
    assert.ok(current.sameness < previous.sameness - .015, `${count}: adjacent terrain should be measurably more varied`);
    assert.ok(current.shares.plains! >= .45 && current.shares.plains! <= .67);
    assert.ok(current.shares.forest! >= .13 && current.shares.forest! <= .28);
    assert.ok(1 - current.shares.plains! - current.shares.forest! >= .20, `${count}: meaningful room for farms, swamps, waste and high ground`);
    const independentSameness = Object.values(current.shares).reduce((sum, share) => sum + share * share, 0);
    assert.ok(current.sameness > independentSameness + .025, `${count}: terrain must remain clustered, not a random checkerboard`);
    assert.ok(current.singletonShare < .30, `${count}: most land must remain in multi-province terrain regions`);
    context.diagnostic(JSON.stringify({ count, seeds: SEEDS, cohesion: 58, previous, current }));
  }
});

test("explicit high cohesion retains the previous sampler and materially larger terrain groups", () => {
  for (const count of SCALES) {
    const high = cohort(count, 85), previous = PREVIOUS_HIGH_COHESION[count];
    assert.ok(Math.abs(high.sameness - previous.sameness) < .00005, `${count}: retain the deliberate high-cohesion profile`);
    assert.ok(Math.abs(high.meanPatch - previous.meanPatch) < .00005, `${count}: no hidden regional-detail boost at high cohesion`);
    assert.ok(high.meanPatch > PREVIOUS_DEFAULT[count].meanPatch);
  }
});

test("existing project settings and terrain survive loading, cloning, recipes and content-only rerolls", () => {
  const saved = createDefaultProject("biome-saved-preservation");
  saved.settings.biomeCohesion = 68;
  delete saved.planes[0]!.landformStyle;
  delete saved.planes[0]!.landformWater;
  const terrainSignature = (plane: Plane) => JSON.stringify([plane.landformStyle,
    plane.provinces.map(province => [province.id, province.x, province.y, province.terrain, province.biome, province.terrainFlags]), plane.edges]);
  const original = terrainSignature(saved.planes[0]!);
  const variants = [cloneProject(saved), parseProject(serializeProject(saved)), applySettingsRecipe(saved, createSettingsRecipe(saved))];
  for (const kind of ["name", "economy", "sites", "guardians"] as const) variants.push(previewContentReroll(saved,
    saved.planes[0]!.id, saved.planes[0]!.provinces.map(province => province.id), kind, "biome-preservation").project);
  for (const next of variants) {
    assert.equal(next.settings.biomeCohesion, 68, "new defaults never migrate a saved explicit setting");
    assert.equal(terrainSignature(next.planes[0]!), original, "terrain changes require Generate or an explicit terrain edit");
  }
  assert.equal(terrainSignature(saved.planes[0]!), original);
  for (const cohesion of [0, 85, 100]) {
    const next = createDefaultProject(`biome-explicit-${cohesion}`, { generate: false });
    Object.assign(next.settings, { players: 2, provincesPerPlayer: 16, biomeCohesion: cohesion,
      throneCount: 0, startDistribution: { land: 2, coastal: 0, water: 0, cave: 0, other: 0 } });
    assert.equal(generateProject(next).settings.biomeCohesion, cohesion);
  }
});

test("regional plans and exclusive terrain weights retain priority over the new temperate detail", () => {
  for (const cohesion of [0, 58, 85, 100]) {
    const forest = fixture(96, 2, cohesion, { generationOverrides: { regions: [
      { name: "Authored forest", x0: 0, y0: 0, x1: 1, y1: 1, terrain: "forest" },
    ] } }, { waterPercent: 0 });
    const farm = fixture(96, 2, cohesion, { generationOverrides: { terrainWeights:
      { plains: 0, forest: 0, farm: 5, swamp: 0, waste: 0, highland: 0, mountains: 0 } } }, { waterPercent: 0 });
    // The established minimum-variety safeguard can reserve two provinces for
    // the other ordinary terrains; this change must not weaken author control.
    assert.ok(forest.provinces.filter(province => province.terrain === "forest").length >= 86);
    assert.ok(farm.provinces.filter(province => province.terrain === "farm").length >= 86);
    assert.equal(forest.provinces.some(isWaterProvince), false);
    assert.equal(farm.provinces.some(isWaterProvince), false);
  }
});

test("frozen, arid and cave-family constraints remain distinct under the revised default", () => {
  const frozen = fixture(96, 3, 58, { variant: "frozen" }, { waterPercent: 0 });
  assert.ok(frozen.provinces.filter(province => province.biome === "tundra").length >= 80);
  const arid = fixture(96, 3, 58, { variant: "arid" }, { waterPercent: 0 });
  assert.ok(arid.provinces.filter(province => province.terrain === "forest").length <= 12);
  for (const kind of ["cave", "cavern", "underworld", "hell", "abyss"] as const) {
    const plane = fixture(32, 3, 58, { kind, variant: kind === "hell" ? "infernal" : "fungal",
      width: 384, height: 256, wrapX: false, wrapY: false });
    assert.ok(plane.provinces.every(isCaveProvince), `${kind}: varied ground must not lose cave identity`);
    assert.equal(plane.provinces.some(province => ["plains", "forest", "farm", "swamp", "waste", "highland"].includes(province.terrain)), false);
  }
});
