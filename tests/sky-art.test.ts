import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Plane, Province, TerrainFlag, TerrainKey } from "../src/domain";
import { renderSkyRgb, SKY_ART_VARIANTS, skyVariantForPreview } from "../src/skyArt";
import { previewProvinceTerrain } from "../src/terrainVisuals";

function fixture(width = 512, height = 384): { plane: Plane; owners: Int16Array } {
  const terrains: TerrainKey[] = ["forest", "farm", "mountains", "cave", "sea", "swamp", "waste", "plains"];
  const provinces: Province[] = terrains.map((terrain, i) => ({
    id: `sky-art-${i}`, index: i + 1, name: `Sky ${i + 1}`, x: (i % 4 + .5) / 4, y: (Math.floor(i / 4) + .5) / 2,
    gridX: i % 4, gridY: Math.floor(i / 4), biome: "high_country", terrain,
    terrainFlags: i === 0 ? ["farm", "freshwater"] : undefined,
    small: false, large: false, noStart: true, manySites: false, warmer: false, colder: false,
    siteBias: [], start: false, throne: "none", sites: [], killRandomSites: false,
    temple: false, lab: false, defenders: [], battle: {}, rawDirectives: "",
  }));
  const plane: Plane = { id: "sky-art", name: "Sky", kind: "cloud", variant: "temperate", provinceTarget: 8,
    width, height, wrapX: false, wrapY: false, ownershipMode: "sparse", provinces, edges: [], rawDirectives: "" };
  const owners = new Int16Array(width * height).fill(-1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.floor(x * 4 / width), row = Math.floor(y * 2 / height);
    const dx = (x / width * 4 - column - .5) / .43, dy = (y / height * 2 - row - .5) / .36;
    if (dx * dx + dy * dy < 1 + Math.sin(x / width * 50) * .09) owners[y * width + x] = row * 4 + column;
  }
  return { plane, owners };
}
function digest(rgb: Uint8Array): string { return createHash("sha256").update(rgb).digest("hex"); }
function differentPixels(a: Uint8Array, b: Uint8Array, owners: Int16Array, owner: number): number {
  let changed = 0;
  for (let pixel = 0; pixel < owners.length; pixel++) if (owners[pixel] === owner &&
    (a[pixel * 3] !== b[pixel * 3] || a[pixel * 3 + 1] !== b[pixel * 3 + 1] || a[pixel * 3 + 2] !== b[pixel * 3 + 2])) changed++;
  return changed;
}

test("all eighteen sky-art variants are deterministic, non-white RGB and preserve source geography/content", () => {
  const { plane, owners } = fixture();
  const before = JSON.stringify(plane), mask = digest(new Uint8Array(owners.buffer));
  const hashes = new Set<string>();
  assert.equal(SKY_ART_VARIANTS.length, 18);
  const normal = renderSkyRgb(plane, owners, "default", "art-proof");
  for (const variant of SKY_ART_VARIANTS) {
    const rgb = renderSkyRgb(plane, owners, variant, "art-proof");
    assert.equal(rgb.length, plane.width * plane.height * 3, variant);
    assert.ok(rgb.every(channel => channel <= 252), `${variant}: only the native protocol may add pure-white markers`);
    assert.equal(digest(renderSkyRgb(structuredClone(plane), owners, variant, "art-proof")), digest(rgb), variant);
    assert.equal(differentPixels(normal, rgb, owners, -1), 0, `${variant}: clouds, cliff faces and shadows are geometry-only`);
    hashes.add(digest(rgb));
  }
  assert.ok(hashes.size >= 16, "terrain and seasonal sheets need visibly distinct artwork");
  assert.equal(JSON.stringify(plane), before);
  assert.equal(digest(new Uint8Array(owners.buffer)), mask);
  assert.notEqual(digest(renderSkyRgb(plane, owners, "default", "other-seed")), digest(normal), "seed changes art without changing geometry");
});

test("sky winters change dry surface islands while cave and sea pixels stay unchanged", () => {
  const { plane, owners } = fixture();
  const normal = renderSkyRgb(plane, owners, "default", "snow-proof");
  const winter = renderSkyRgb(plane, owners, "winter", "snow-proof");
  for (const owner of [3, 4, -1]) assert.equal(differentPixels(normal, winter, owners, owner), 0, `owner ${owner}: no snow in cave/water/cloud background`);
  for (const owner of [0, 1, 2, 5, 6, 7]) assert.ok(differentPixels(normal, winter, owners, owner) > 500, `owner ${owner}: visible sky winter`);
});

test("sky snow strength honors warmer, colder and neutral province flags without changing cave or sea art", () => {
  const { plane, owners } = fixture();
  const normal = renderSkyRgb(plane, owners, "default", "temperature-snow");
  const brightness = (rgb: Uint8Array, owner: number) => {
    let total = 0, count = 0;
    for (let p = 0; p < owners.length; p++) if (owners[p] === owner) { total += rgb[p * 3]! + rgb[p * 3 + 1]! + rgb[p * 3 + 2]!; count += 3; }
    return total / count;
  };
  const changes: number[] = [];
  for (const [warmer, colder] of [[true, false], [false, false], [false, true], [true, true]]) {
    const changed = structuredClone(plane);
    for (const province of changed.provinces) Object.assign(province, { warmer, colder });
    const rgb = renderSkyRgb(changed, owners, "winter", "temperature-snow");
    changes.push(brightness(rgb, 7) - brightness(normal, 7));
    for (const owner of [3, 4, -1]) assert.equal(differentPixels(normal, rgb, owners, owner), 0);
  }
  assert.ok(changes[0]! > changes[1]! * .35 && changes[0]! < changes[1]! * .55, "warm provinces use 0.35 cover rather than neutral 0.8");
  assert.ok(changes[2]! > changes[1]! * 1.15 && changes[2]! < changes[1]! * 1.4, "cold provinces use full 1.0 cover");
  assert.equal(changes[3], changes[1], "both temperature flags use the neutral preview strength");
});

test("preview mapping applies existing terrain transformation rules before selecting its sky sheet", () => {
  const { plane, owners } = fixture();
  const normal = renderSkyRgb(plane, owners, "default", "preview-semantics");
  for (const condition of ["normal", "winter", "forested", "flooded", "wasted", "farmland"] as const) {
    assert.equal(skyVariantForPreview(condition), condition === "winter" ? "winter" : "default");
    const displayed = { ...plane, provinces: plane.provinces.map(province => ({ ...province, ...previewProvinceTerrain(province, condition) })) };
    const rgb = renderSkyRgb(displayed, owners, skyVariantForPreview(condition), "preview-semantics");
    if (condition === "farmland") {
      assert.equal(differentPixels(normal, rgb, owners, 3), 0, "farmland preview cannot convert caves");
      assert.equal(differentPixels(normal, rgb, owners, 4), 0, "farmland preview cannot convert seas");
    }
    if (condition === "normal") assert.equal(digest(rgb), digest(normal));
  }
});

test("manual mixed terrain flags visibly affect only the edited province", () => {
  const { plane, owners } = fixture();
  const base = renderSkyRgb(plane, owners, "default", "terrain-flags");
  for (const flag of ["forest", "farm", "cave", "mountains", "sea", "swamp", "waste", "freshwater"] as TerrainFlag[]) {
    const changed = structuredClone(plane);
    changed.provinces[7]!.terrainFlags = [flag];
    const rgb = renderSkyRgb(changed, owners, "default", "terrain-flags");
    assert.ok(differentPixels(base, rgb, owners, 7) > 0, `${flag}: flag must be graphically represented`);
    for (let owner = -1; owner < 7; owner++) assert.equal(differentPixels(base, rgb, owners, owner), 0, `${flag}: artwork cannot leak into owner ${owner}`);
  }
});

test("cave walls stay sealed rock regardless of sea, forest, cover transformation or winter flags", () => {
  const { plane, owners } = fixture();
  const wall = structuredClone(plane);
  wall.provinces[7]!.terrain = "cavewall";
  const reference = renderSkyRgb(wall, owners, "default", "sealed-wall");
  const cave = structuredClone(plane);
  cave.provinces[7]!.terrain = "cave";
  assert.ok(differentPixels(reference, renderSkyRgb(cave, owners, "default", "sealed-wall"), owners, 7) > 500, "sealed rock must not look like an ordinary cave entrance");
  for (const terrain of ["plains", "sea", "forest", "cavewall"] as const) {
    const mixed = structuredClone(plane);
    Object.assign(mixed.provinces[7]!, { terrain, terrainFlags: ["cavewall", "sea", "forest", "farm", "cave"], colder: true });
    for (const variant of SKY_ART_VARIANTS) {
      const rgb = renderSkyRgb(mixed, owners, variant, "sealed-wall");
      assert.equal(differentPixels(reference, rgb, owners, 7), 0, `${terrain}/${variant}: blocked cave wall overrides other terrain and snow`);
      assert.equal(differentPixels(reference, rgb, owners, -1), 0);
    }
  }
});

test("ownership-buffer edits invalidate preparation without retaining stale cliff edges or motifs", () => {
  const { plane, owners } = fixture(256, 256);
  renderSkyRgb(plane, owners, "default", "mask-mutation");
  for (let y = 20; y < 70; y++) for (let x = 20; x < 70; x++) owners[y * plane.width + x] = 7;
  const reused = renderSkyRgb(plane, owners, "default", "mask-mutation");
  const fresh = renderSkyRgb(plane, owners.slice(), "default", "mask-mutation");
  assert.equal(digest(reused), digest(fresh));
});

test("cache identity does not alias delimiter-bearing province IDs or seed boundaries", () => {
  for (const collision of ["province-ids", "seed-boundary"] as const) {
    const { plane, owners } = fixture(256, 256);
    const changed = structuredClone(plane);
    let firstSeed = "cache-proof", secondSeed = firstSeed;
    if (collision === "province-ids") {
      plane.provinces[0]!.id = "a|b";
      plane.provinces[1]!.id = "c";
      changed.provinces[0]!.id = "a";
      changed.provinces[1]!.id = "b|c";
    } else {
      firstSeed = "cache:a"; secondSeed = "cache";
      plane.provinces[0]!.id = "b";
      changed.provinces[0]!.id = "a:b";
    }
    renderSkyRgb(plane, owners, "default", firstSeed);
    const reused = renderSkyRgb(changed, owners, "default", secondSeed);
    const fresh = renderSkyRgb(changed, owners.slice(), "default", secondSeed);
    assert.equal(digest(reused), digest(fresh), `${collision}: mutable inputs must not reuse another preparation`);
  }
});

test("mutable ownership cache compares exact pixels even when old 32-bit fingerprints collide", () => {
  const { plane, owners } = fixture(256, 256);
  owners.fill(0);
  // These valid owner sequences have the same former FNV-1a fingerprint.
  // Appending the same raster suffix preserves that collision.
  const first = [4, 3, 7, 5, 2, 5, 4, 4, -1, 6, 4, 7];
  const second = [7, 2, 6, 4, 7, 2, 6, 2, 4, 6, 1, -1];
  owners.set(first);
  renderSkyRgb(plane, owners, "default", "mask-collision");
  owners.set(second);
  const reused = renderSkyRgb(plane, owners, "default", "mask-collision");
  const fresh = renderSkyRgb(plane, owners.slice(), "default", "mask-collision");
  assert.equal(digest(reused), digest(fresh), "changed holes must refresh the adjacent cliff rims despite a hash collision");
});

test("cleanup retains established normal and winter artwork pixels", () => {
  const { plane, owners } = fixture();
  assert.deepEqual({
    default: digest(renderSkyRgb(plane, owners, "default", "cleanup-art-baseline")),
    winter: digest(renderSkyRgb(plane, owners, "winter", "cleanup-art-baseline")),
  }, {
    default: "58f38f07fcdccdf98b69a2319afe0faae928a9425cdd8dfa37d740edd328ea17",
    winter: "bd4af857f752689167cb571f165f4be3c571d721491f91fb386cfe422c378daf",
  });
});

test("returned RGB buffers and the variant catalog cannot corrupt later renders", () => {
  const { plane, owners } = fixture(256, 256);
  assert.equal(Object.isFrozen(SKY_ART_VARIANTS), true);
  const first = renderSkyRgb(plane, owners, "default", "mutable-output");
  const expected = digest(first);
  first.fill(0);
  assert.equal(digest(renderSkyRgb(plane, owners, "default", "mutable-output")), expected);
});

test("wrapped background fields have no contrasting seam and all-void maps render safely", () => {
  const { plane, owners } = fixture();
  plane.wrapX = plane.wrapY = true;
  owners.fill(-1);
  const rgb = renderSkyRgb(plane, owners, "winter", "tiled-clouds");
  for (let y = 0; y < plane.height; y++) for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(rgb[(y * plane.width) * 3 + channel]! - rgb[(y * plane.width + plane.width - 1) * 3 + channel]!) <= 9, "horizontal cloud seam must remain subtle");
  }
  for (let x = 0; x < plane.width; x++) for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(rgb[x * 3 + channel]! - rgb[((plane.height - 1) * plane.width + x) * 3 + channel]!) <= 9, "vertical cloud seam must remain subtle");
  }
});

test("sky artwork rejects invalid dimensions, ownership, and variant before rendering", () => {
  const { plane, owners } = fixture(256, 256);
  assert.throws(() => renderSkyRgb({ ...plane, width: 255 }, owners, "default", "bad"), /dimensions/);
  assert.throws(() => renderSkyRgb({ ...plane, width: 3840, height: 3840 }, owners, "default", "bad"), /dimensions/);
  assert.throws(() => renderSkyRgb(plane, new Int16Array(1), "default", "bad"), /ownership/);
  owners[0] = 500;
  assert.throws(() => renderSkyRgb(plane, owners, "default", "bad"), /invalid province owner/);
  owners[0] = -2;
  assert.throws(() => renderSkyRgb(plane, owners, "default", "bad"), /invalid province owner/);
  owners[0] = -1;
  assert.throws(() => renderSkyRgb(plane, owners, "unknown" as "default", "bad"), /variant/);
});

// Exact 24-bit RLE packet sizing without retaining another full image buffer.
function rleBytes(rgb: Uint8Array, width: number, height: number): number {
  const same = (a: number, b: number) => rgb[a * 3] === rgb[b * 3] && rgb[a * 3 + 1] === rgb[b * 3 + 1] && rgb[a * 3 + 2] === rgb[b * 3 + 2];
  let bytes = 18;
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      const start = y * width + x;
      let run = 1;
      while (run < 128 && x + run < width && same(start, start + run)) run++;
      if (run > 1) { bytes += 4; x += run; continue; }
      let raw = 1;
      while (raw < 128 && x + raw < width) {
        if (x + raw + 1 < width && same(start + raw, start + raw + 1)) break;
        raw++;
      }
      bytes += 1 + raw * 3; x += raw;
    }
  }
  return bytes;
}

test("wide, portrait and 4K artwork remains finite with RLE-friendly horizontal runs", context => {
  for (const [width, height] of [[3840, 256], [256, 3840], [3840, 2160]] as const) {
    const { plane, owners } = fixture(width, height);
    const started = performance.now();
    const first = renderSkyRgb(plane, owners, "default", "sky-performance");
    const firstMs = performance.now() - started;
    const secondStart = performance.now();
    const second = renderSkyRgb(plane, owners, "forestw", "sky-performance");
    const secondMs = performance.now() - secondStart;
    const packed = Math.max(rleBytes(first, width, height), rleBytes(second, width, height));
    assert.equal(first.length, width * height * 3);
    assert.ok(packed < first.length * .45, `${width}×${height}: preserve useful 24-bit RLE runs`);
    context.diagnostic(`${width}×${height}: first ${Math.round(firstMs)}ms, cached sheet ${Math.round(secondMs)}ms; largest sampled TGA ${packed} bytes (${(packed / first.length * 100).toFixed(1)}% of RGB); 18-sheet sampled-size extrapolation ${(packed * 18 / 1048576).toFixed(1)} MiB`);
  }
});
