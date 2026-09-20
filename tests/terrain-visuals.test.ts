import assert from "node:assert/strict";
import test from "node:test";
import { TERRAIN_FLAGS, type PreviewCondition, type TerrainFlag, type TerrainKey } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import { compileMapText, encodeD6m, terrainMask, terrainPreviewKey, TERRAIN_BITS } from "../src/dom6";
import { planeMaterialAssets, renderPlanePng, UNIVERSAL_MATERIAL_ASSETS } from "../src/MapCanvas";
import { measurePolygonProvinceArtwork, periodicArtworkCopies } from "../src/adaptiveArtwork";
import { planTerrainMarks } from "../src/terrainArtwork";
import { provinceTerrainVisuals, terrainElevation, type TerrainMarkKind } from "../src/terrainVisuals";

test("every effective physical flag contributes a visible feature", () => {
  const marks: Partial<Record<TerrainFlag, TerrainMarkKind>> = {
    farm: "farm", forest: "forest", cave: "cave", mountains: "mountain", highland: "highland",
    swamp: "swamp", waste: "waste", sea: "water", freshwater: "freshwater", cavewall: "cavewall",
  };
  for (const [flag, mark] of Object.entries(marks)) {
    const visuals = provinceTerrainVisuals({ terrain: "plains", terrainFlags: [flag as TerrainFlag] });
    assert.ok(visuals.marks.includes(mark), `${flag} must be represented`);
  }
  const combined = provinceTerrainVisuals({ terrain: "forest", terrainFlags: ["farm", "cave"] });
  assert.deepEqual(combined.marks, ["forest", "farm", "cave"]);
  assert.deepEqual(combined.layers, ["caveforest", "farm", "cave"]);
  const wet = provinceTerrainVisuals({ terrain: "plains", terrainFlags: ["sea", "deep", "forest", "cave"] });
  assert.deepEqual(wet.marks, ["kelp", "water", "deep", "cave"]);
  assert.equal(wet.base, "deepsea");
  assert.deepEqual(provinceTerrainVisuals({ terrain: "plains", terrainFlags: ["deep"] }).marks, []);
  assert.deepEqual(provinceTerrainVisuals({ terrain: "plains", freshwater: true }).layers, ["plains"]);
});

test("equivalent presets and added flags resolve identically, including relief", () => {
  const cases: Array<[TerrainKey, TerrainFlag[]]> = [
    ["forest", ["forest"]], ["farm", ["farm"]], ["swamp", ["swamp"]],
    ["waste", ["waste"]], ["mountains", ["mountains"]], ["highland", ["highland"]],
    ["sea", ["sea"]], ["deepsea", ["sea", "deep"]], ["kelp", ["sea", "forest"]],
    ["cave", ["cave"]], ["caveforest", ["cave", "forest"]], ["caveswamp", ["cave", "swamp"]],
    ["cavewaste", ["cave", "waste"]], ["cavehighland", ["cave", "highland"]], ["cavewall", ["cavewall"]],
  ];
  for (const [terrain, terrainFlags] of cases) {
    const preset = { terrain };
    const additive = { terrain: "plains" as const, terrainFlags };
    assert.deepEqual(provinceTerrainVisuals(additive), provinceTerrainVisuals(preset), terrain);
    assert.equal(terrainElevation(additive), terrainElevation(preset), terrain);
  }
  assert.deepEqual(provinceTerrainVisuals({ terrain: "farm", terrainFlags: ["forest", "cave"] }), provinceTerrainVisuals({ terrain: "caveforest", terrainFlags: ["farm"] }));
  assert.equal(terrainElevation({ terrain: "forest", terrainFlags: ["mountains"] }), 900);
  assert.equal(terrainElevation({ terrain: "forest", terrainFlags: ["cave", "highland"] }), 640);
  assert.equal(terrainElevation({ terrain: "mountains", terrainFlags: ["sea"] }), -220);
});

test("flag order, duplicates, removal, and preview conditions cannot leave stale artwork", () => {
  const province = { terrain: "plains" as const, terrainFlags: ["farm", "forest", "cave"] as TerrainFlag[] };
  const expected = provinceTerrainVisuals(province);
  province.terrainFlags.reverse();
  province.terrainFlags.push("forest");
  assert.deepEqual(provinceTerrainVisuals(province), expected);
  province.terrainFlags = [];
  assert.deepEqual(provinceTerrainVisuals(province), { base: "plains", layers: ["plains"], marks: [] });
  for (const condition of ["forested", "flooded", "wasted", "farmland", "winter"] as const) {
    const preview = provinceTerrainVisuals(province, condition);
    assert.equal(preview.base, terrainPreviewKey("plains", condition));
    assert.deepEqual(province.terrainFlags, []);
  }
});

test("mixed terrain loads every needed material, but fresh water never paints land as sea", () => {
  const plane = createDefaultProject("terrain-materials").planes[0]!;
  plane.provinces = plane.provinces.slice(0, 1);
  const province = plane.provinces[0]!;
  province.terrain = "forest";
  province.terrainFlags = ["farm", "cave"];
  province.freshwater = false;
  assert.deepEqual(planeMaterialAssets(plane), [UNIVERSAL_MATERIAL_ASSETS.earth, UNIVERSAL_MATERIAL_ASSETS.foliage, UNIVERSAL_MATERIAL_ASSETS.stone]);
  province.terrain = "plains";
  province.terrainFlags = ["freshwater"];
  assert.deepEqual(planeMaterialAssets(plane), [UNIVERSAL_MATERIAL_ASSETS.earth]);
});

test("terrain feature slots cover every flag and fit tiny, narrow, large, and wrapped provinces", () => {
  const kinds = provinceTerrainVisuals({ terrain: "plains", terrainFlags: [...TERRAIN_FLAGS] }).marks;
  for (const size of [256, 1024, 2880]) {
    for (const halfWidth of [0.015, 0.05, 0.3]) {
      const polygons = [[{ x: 0.5 - halfWidth, y: 0.2 }, { x: 0.5 + halfWidth, y: 0.2 }, { x: 0.5 + halfWidth, y: 0.8 }, { x: 0.5 - halfWidth, y: 0.8 }]];
      const metrics = measurePolygonProvinceArtwork(polygons, { x: 0.5, y: 0.5 }, { wrapX: false, wrapY: false }, size, size);
      const placements = planTerrainMarks(metrics, kinds, "fit-features", 0.35);
      if (placements.length) assert.deepEqual(new Set(placements.map(item => item.kind)), new Set(kinds));
      assert.deepEqual(placements, planTerrainMarks(metrics, kinds, "fit-features", 0.35));
      for (const placement of placements) {
        assert.ok(Math.hypot(placement.x - metrics.anchorX, placement.y - metrics.anchorY) + Math.hypot(placement.width, placement.height) / 2 <= metrics.inscribedRadiusPx);
      }
    }
  }
  const seam = { kind: "farm" as const, x: 1, y: 1, width: 10, height: 10, rotation: 0, flipX: false, flipY: false, opacity: 0.78 };
  const copies = periodicArtworkCopies(seam, 100, 100, true, true);
  assert.equal(copies.length, 4);
  for (const copy of copies) {
    assert.ok("kind" in copy);
    assert.equal(copy.kind, "farm", "a wrapped copy must not advance to the next terrain symbol");
  }
});

test("native exports update all terrain bits and relief, without putting unsupported bits in D6M specs", async () => {
  const project = createDefaultProject("terrain-native-update");
  project.planes = project.planes.slice(0, 1);
  const plane = project.planes[0]!;
  plane.width = plane.height = 256;
  plane.wrapX = plane.wrapY = false;
  const flags: TerrainFlag[][] = [["farm"], ["forest"], ["cave"], ["mountains"], ["highland"], ["swamp"], ["sea", "forest"], ["sea", "deep", "cave"]];
  plane.provinces.slice(0, flags.length).forEach((province, index) => {
    province.terrain = "plains";
    province.terrainFlags = flags[index];
    province.freshwater = false;
  });
  const bytes = await encodeD6m(plane, "updated-terrain");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = compileMapText(project, 0);
  for (const province of plane.provinces.slice(0, flags.length)) {
    const x = Math.round(province.x * (plane.width - 1));
    const y = Math.round(province.y * (plane.height - 1));
    const offset = 34 + plane.provinces.length * 12 + (y * plane.width + x) * 2;
    assert.equal(view.getInt16(offset, true), terrainElevation(province));
    const expectedSpec = province.terrainFlags!.includes("sea") ? TERRAIN_BITS.sea | (province.terrainFlags!.includes("deep") ? TERRAIN_BITS.deep : 0n) : 0n;
    assert.equal(view.getBigInt64(34 + (province.index - 1) * 12 + 4, true), expectedSpec);
    assert.ok(text.includes(`#terrain ${province.index} ${terrainMask(province)}`));
    for (const flag of province.terrainFlags!) assert.ok((terrainMask(province) & TERRAIN_BITS[flag as Exclude<TerrainFlag, "cavewall">]) !== 0n);
  }
  const first = plane.provinces[0]!;
  first.terrainFlags = [];
  const reset = await encodeD6m(plane, "updated-terrain");
  assert.notDeepEqual(reset, bytes, "removing Farm must remove its exported relief too");
  assert.equal(terrainMask(first) & TERRAIN_BITS.farm, 0n);
});

test("the shared PNG painter changes for each added flag and restores the original after removal", async () => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const calls: unknown[][] = [];
  class Context {
    fillStyle: unknown;
    strokeStyle: unknown;
    save() {} restore() {} clearRect() {} setLineDash() {} clip() { calls.push(["clip"]); }
    beginPath() { calls.push(["begin"]); } closePath() { calls.push(["close"]); }
    moveTo(...args: number[]) { calls.push(["move", ...args]); }
    lineTo(...args: number[]) { calls.push(["line", ...args]); }
    quadraticCurveTo(...args: number[]) { calls.push(["curve", ...args]); }
    arc(...args: number[]) { calls.push(["arc", ...args]); }
    fill() { calls.push(["fill", this.fillStyle]); }
    stroke() { calls.push(["stroke", this.strokeStyle]); }
    fillRect(...args: number[]) { calls.push(["rect", this.fillStyle, ...args]); }
    fillText() {} strokeText() {} drawImage() {}
    createLinearGradient() { return { addColorStop: (...args: unknown[]) => calls.push(["color", ...args]) }; }
  }
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({
    width: 0, height: 0, getContext: () => new Context(),
    toBlob: (callback: BlobCallback) => callback(new Blob([JSON.stringify(calls)], { type: "image/png" })),
  }) } });
  try {
    const plane = createDefaultProject("painted-terrain-edits").planes[0]!;
    plane.provinces = plane.provinces.slice(0, 1);
    plane.edges = [];
    plane.width = plane.height = 512;
    plane.wrapX = plane.wrapY = false;
    const province = plane.provinces[0]!;
    Object.assign(province, { x: 0.5, y: 0.5, terrain: "plains", terrainFlags: [], freshwater: false });
    const trace = async (condition: PreviewCondition = "normal") => { calls.length = 0; return (await renderPlanePng(plane, condition)).text(); };
    const plain = await trace();
    for (const flag of ["farm", "forest", "cave", "freshwater"] as const) {
      province.terrainFlags = [flag];
      assert.notEqual(await trace(), plain, flag);
    }
    province.terrainFlags = ["forest", "farm", "cave"];
    const combined = await trace();
    assert.ok(combined.includes("#dab568"), "field blocks are painted");
    assert.ok(combined.includes("#211c1b"), "cave arches are painted");
    assert.equal(await trace("winter"), combined, "cave terrain receives no winter snow, including its feature glyphs");
    province.terrainFlags = ["forest"];
    assert.notEqual(await trace("winter"), await trace(), "eligible surface land receives winter cover");
    plane.kind = "hell";
    plane.ownershipMode = "solid";
    assert.equal(await trace("winter"), await trace(), "outer realms retain their normal palette and feature colors");
    plane.kind = "surface";
    province.terrainFlags = [];
    assert.equal(await trace(), plain);
    for (const [wrapX, wrapY] of [[true, false], [false, true], [true, true]]) {
      Object.assign(plane, { wrapX, wrapY });
      province.terrainFlags = ["forest", "farm", "cave"];
      await trace();
      const colors = calls.filter(call => call[0] === "color").map(call => call[2]);
      assert.equal(new Set(colors).size, 1, "wrapped province fragments share one mixed tint without a seam jump");
    }
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
