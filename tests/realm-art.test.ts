import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Plane, PlaneKind, PlaneVariant, Province, TerrainFlag, TerrainKey } from "../src/domain";
import { isRealmArtworkKind, renderRealmRgb } from "../src/realmArt";
import { previewProvinceTerrain } from "../src/terrainVisuals";

const KINDS = ["cave", "cavern", "underworld", "hell", "abyss", "dream", "elemental"] as const;
const VARIANTS: PlaneVariant[] = ["temperate", "wild", "frozen", "arid", "oceanic", "fungal", "crystal", "volcanic", "storm", "infernal", "void"];
const PHYSICAL_FLAGS: TerrainFlag[] = ["forest", "farm", "cave", "mountains", "highland", "sea", "swamp", "waste", "freshwater"];

function fixture(width = 256, height = 256): { plane: Plane; owners: Int16Array } {
  const terrains: TerrainKey[] = ["caveforest", "farm", "mountains", "cave", "sea", "swamp", "waste", "plains"];
  const provinces: Province[] = terrains.map((terrain, i) => ({
    id: `realm-art-${i}`, index: i + 1, name: `Realm ${i + 1}`, x: (i % 4 + .5) / 4, y: (Math.floor(i / 4) + .5) / 2,
    gridX: i % 4, gridY: Math.floor(i / 4), biome: "high_country", terrain,
    small: false, large: false, noStart: true, manySites: false, warmer: false, colder: false,
    siteBias: [], start: false, throne: "none", sites: [], killRandomSites: false,
    temple: false, lab: false, defenders: [], battle: {}, rawDirectives: "",
  }));
  const plane: Plane = { id: "realm-art", name: "Realm", kind: "cave", variant: "fungal", provinceTarget: 8,
    width, height, wrapX: false, wrapY: false, ownershipMode: "sparse", provinces, edges: [], rawDirectives: "" };
  const owners = new Int16Array(width * height).fill(-1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.floor(x * 4 / width), row = Math.floor(y * 2 / height);
    const dx = (x / width * 4 - column - .5) / .43, dy = (y / height * 2 - row - .5) / .4;
    if (dx * dx + dy * dy < 1 + Math.sin(x / width * 50) * .09) owners[y * width + x] = row * 4 + column;
  }
  return { plane, owners };
}
function digest(rgb: Uint8Array): string { return createHash("sha256").update(rgb).digest("hex"); }
function maskDigest(owners: Int16Array): string {
  return digest(new Uint8Array(owners.buffer, owners.byteOffset, owners.byteLength));
}
function differentPixels(a: Uint8Array, b: Uint8Array, owners: Int16Array, owner: number): number {
  let changed = 0;
  for (let p = 0; p < owners.length; p++) if (owners[p] === owner &&
    (a[p * 3] !== b[p * 3] || a[p * 3 + 1] !== b[p * 3 + 1] || a[p * 3 + 2] !== b[p * 3 + 2])) changed++;
  return changed;
}
function average(rgb: Uint8Array, owners: Int16Array, owner: number): number[] {
  const total = [0, 0, 0];
  let count = 0;
  for (let p = 0; p < owners.length; p++) if (owners[p] === owner) {
    count++;
    for (let channel = 0; channel < 3; channel++) total[channel]! += rgb[p * 3 + channel]!;
  }
  return total.map(channel => channel / count);
}

test("realm artwork explicitly handles existing seven realm kinds, not surface, custom or sky", () => {
  for (const kind of KINDS) assert.equal(isRealmArtworkKind(kind), true, kind);
  for (const kind of ["surface", "custom", "cloud", "air"] as PlaneKind[]) assert.equal(isRealmArtworkKind(kind), false, kind);
  assert.equal(isRealmArtworkKind("constructor" as PlaneKind), false, "prototype properties are not realm profiles");
});

test("all realm profiles are distinct, deterministic, bounded RGB without changing geography or gameplay", () => {
  const { plane, owners } = fixture();
  const mask = maskDigest(owners), hashes = new Set<string>();
  for (const kind of KINDS) {
    const displayed = { ...plane, kind }, before = JSON.stringify(displayed);
    const rgb = renderRealmRgb(displayed, owners, "realm-proof");
    assert.equal(rgb.length, plane.width * plane.height * 3, kind);
    assert.ok(rgb.every(channel => channel <= 252), `${kind}: reserve pure-white pixels for native protocols`);
    assert.equal(digest(renderRealmRgb(structuredClone(displayed), owners.slice(), "realm-proof")), digest(rgb), kind);
    assert.notEqual(digest(renderRealmRgb(displayed, owners, "another-seed")), digest(rgb), `${kind}: stable seed changes artwork`);
    assert.equal(JSON.stringify(displayed), before);
    hashes.add(digest(rgb));
  }
  assert.equal(hashes.size, KINDS.length, "different realms must not merely reuse one material profile");
  assert.equal(maskDigest(owners), mask);
});

test("realm variants and undefined defaults remain distinct and refresh the prepared cache", () => {
  const { plane, owners } = fixture();
  for (const kind of ["cave", "cavern", "elemental"] as const) {
    const hashes = new Set<string>();
    for (const variant of [undefined, ...VARIANTS]) {
      const displayed = { ...plane, kind, variant };
      const rgb = renderRealmRgb(displayed, owners, "variant-cache");
      hashes.add(digest(rgb));
      assert.equal(digest(rgb), digest(renderRealmRgb(displayed, owners.slice(), "variant-cache")));
    }
    assert.equal(hashes.size, VARIANTS.length + 1, `${kind}: every variant has an intentional visual response`);
  }
});

test("every additive physical terrain flag visibly changes only its owner", () => {
  const { plane, owners } = fixture();
  const normal = renderRealmRgb(plane, owners, "mixed-flags");
  for (const flag of PHYSICAL_FLAGS) {
    const changed = structuredClone(plane);
    changed.provinces[7]!.terrainFlags = [flag];
    const rgb = renderRealmRgb(changed, owners, "mixed-flags");
    assert.ok(differentPixels(normal, rgb, owners, 7) > 10, flag);
    for (let owner = -1; owner < 7; owner++) assert.equal(differentPixels(normal, rgb, owners, owner), 0, `${flag}: clipped to owner 7, including background`);
  }
  const mixed = structuredClone(plane);
  mixed.provinces[7]!.terrainFlags = PHYSICAL_FLAGS.filter(flag => flag !== "sea");
  const reordered = structuredClone(mixed);
  reordered.provinces[7]!.terrainFlags!.reverse();
  assert.equal(digest(renderRealmRgb(mixed, owners, "mixed-flags")), digest(renderRealmRgb(reordered, owners, "mixed-flags")), "flag insertion order is not visual precedence");
});

test("equivalent preset and additive flags produce the same effective artwork", () => {
  const { plane, owners } = fixture();
  for (const [terrain, terrainFlags] of [
    ["caveforest", ["cave", "forest"]], ["caveswamp", ["cave", "swamp"]],
    ["cavewaste", ["cave", "waste"]], ["cavehighland", ["cave", "highland"]],
    ["deepsea", ["sea", "deep"]], ["kelp", ["sea", "forest"]],
  ] as Array<[TerrainKey, TerrainFlag[]]>) {
    const preset = structuredClone(plane), additive = structuredClone(plane);
    preset.provinces[7]!.terrain = terrain;
    additive.provinces[7]!.terrainFlags = terrainFlags;
    assert.equal(digest(renderRealmRgb(preset, owners, "effective-mask")), digest(renderRealmRgb(additive, owners, "effective-mask")), terrain);
  }
});

test("cave walls stay sealed rock despite every conflicting terrain flag", () => {
  const { plane, owners } = fixture();
  for (const kind of KINDS) {
    const wall = structuredClone(plane);
    wall.kind = kind;
    wall.provinces[7]!.terrain = "cavewall";
    const reference = renderRealmRgb(wall, owners, "sealed-wall");
    const mixed = structuredClone(wall);
    mixed.provinces[7]!.terrain = "sea";
    mixed.provinces[7]!.terrainFlags = ["cavewall", "deep", ...PHYSICAL_FLAGS];
    mixed.provinces[7]!.warmer = mixed.provinces[7]!.colder = true;
    assert.equal(digest(renderRealmRgb(mixed, owners, "sealed-wall")), digest(reference), kind);
    const cave = structuredClone(wall);
    cave.provinces[7]!.terrain = "cave";
    assert.ok(differentPixels(reference, renderRealmRgb(cave, owners, "sealed-wall"), owners, 7) > 500, `${kind}: sealed walls cannot look like entrances`);
  }
});

test("actual water stays blue even in infernal realms, while additive water terrain remains visible", () => {
  const { plane, owners } = fixture();
  for (const kind of KINDS) {
    const watery = structuredClone(plane);
    watery.kind = kind;
    watery.variant = "volcanic";
    watery.provinces[7]!.terrain = "sea";
    const sea = renderRealmRgb(watery, owners, "aquatic");
    const shallow = average(sea, owners, 7);
    assert.ok(shallow[2]! > shallow[0]! + 50, `${kind}: water cannot look like lava`);
    watery.provinces[7]!.terrainFlags = ["deep", "cave"];
    const deep = renderRealmRgb(watery, owners, "aquatic");
    const mean = average(deep, owners, 7);
    assert.ok(mean[2]! > mean[0]! + 60 && mean[0]! < shallow[0]!, `${kind}: deep cave water remains aquatic and darker`);
    for (const flag of PHYSICAL_FLAGS.filter(flag => flag !== "sea")) {
      watery.provinces[7]!.terrainFlags = [flag];
      const changed = renderRealmRgb(watery, owners, "aquatic");
      assert.ok(differentPixels(sea, changed, owners, 7) > 0, `${kind}: Sea + ${flag} retains its additive mark`);
      assert.ok(average(changed, owners, 7)[2]! > average(changed, owners, 7)[0]! + 40, `${kind}/${flag}: aquatic material retained`);
      assert.equal(differentPixels(sea, changed, owners, -1), 0);
    }
  }
});

test("freshwater stays a land pond marker and Deep without Sea does not change terrain", () => {
  const { plane, owners } = fixture();
  const dry = renderRealmRgb(plane, owners, "freshwater");
  const fresh = structuredClone(plane);
  fresh.provinces[7]!.freshwater = true;
  const pond = renderRealmRgb(fresh, owners, "freshwater");
  const dryAverage = average(dry, owners, 7), pondAverage = average(pond, owners, 7);
  for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(dryAverage[channel]! - pondAverage[channel]!) < 12, "pond marker must not recolor the whole province as sea");
  assert.ok(differentPixels(dry, pond, owners, 7) > 0);
  const equivalent = structuredClone(plane);
  equivalent.provinces[7]!.terrainFlags = ["freshwater"];
  assert.equal(digest(pond), digest(renderRealmRgb(equivalent, owners, "freshwater")));
  equivalent.provinces[7]!.terrainFlags = ["deep"];
  assert.equal(digest(dry), digest(renderRealmRgb(equivalent, owners, "freshwater")));
});

test("caller-applied cover transformations are honored without inventing outer-realm seasons", () => {
  const { plane, owners } = fixture();
  const before = JSON.stringify(plane);
  for (const kind of KINDS) {
    const realm = { ...plane, kind };
    const normal = renderRealmRgb(realm, owners, "preview-policy");
    for (const condition of ["normal", "winter", "forested", "flooded", "wasted", "farmland"] as const) {
      const displayed = { ...realm, provinces: realm.provinces.map(province => ({ ...province, ...previewProvinceTerrain(province, condition) })) };
      const rgb = renderRealmRgb(displayed, owners, "preview-policy");
      assert.equal(differentPixels(normal, rgb, owners, -1), 0, `${kind}/${condition}: non-terrain background is unchanged`);
      if (condition === "normal" || condition === "winter") assert.equal(digest(rgb), digest(normal), `${kind}: no seasonal snow introduced`);
      else assert.notEqual(digest(rgb), digest(normal), `${kind}/${condition}: transformed terrain is visible`);
      if (condition === "farmland") for (const owner of [0, 3, 4]) assert.equal(differentPixels(normal, rgb, owners, owner), 0, "farmland cannot convert caves or seas");
    }
    const temperatureOnly = structuredClone(realm);
    for (const province of temperatureOnly.provinces) province.warmer = province.colder = true;
    assert.equal(digest(renderRealmRgb(temperatureOnly, owners, "preview-policy")), digest(normal));
  }
  assert.equal(JSON.stringify(plane), before);
});

test("unowned wall relief is darker than traversable terrain and stays fixed when terrain changes", () => {
  const { plane, owners } = fixture();
  for (const kind of KINDS) {
    const rgb = renderRealmRgb({ ...plane, kind }, owners, "floor-contrast");
    const brightness = (owner: number) => average(rgb, owners, owner).reduce((sum, channel) => sum + channel, 0) / 3;
    for (let owner = 0; owner < plane.provinces.length; owner++) assert.ok(brightness(owner) > brightness(-1) + 35, `${kind}/${owner}: decorative walls must not resemble another playable province`);
  }
});

test("one-pixel passages suppress unsuitable glyphs and never illuminate outside canonical ownership", () => {
  const { plane, owners } = fixture();
  owners.fill(-1);
  for (let y = 8; y < plane.height - 8; y++) owners[y * plane.width + 128] = 7;
  owners[32 * plane.width + 64] = 6;
  const normal = renderRealmRgb(plane, owners, "thin-passages");
  const changed = structuredClone(plane);
  changed.provinces[7]!.terrainFlags = ["cave", "forest", "farm", "mountains", "freshwater"];
  const rgb = renderRealmRgb(changed, owners, "thin-passages");
  assert.equal(differentPixels(normal, rgb, owners, -1), 0);
  assert.equal(differentPixels(normal, rgb, owners, 6), 0);
  assert.ok(differentPixels(normal, rgb, owners, 7) > 0, "tiny passages retain the material response when a motif cannot fit");
  assert.equal(maskDigest(owners), maskDigest(owners.slice()));
});

test("wrapped background fields match both seams exactly and empty planes render safely", () => {
  const { plane, owners } = fixture();
  plane.wrapX = plane.wrapY = true;
  plane.provinces = [];
  owners.fill(-1);
  for (const kind of KINDS) {
    const rgb = renderRealmRgb({ ...plane, kind }, owners, "periodic-field");
    for (let y = 0; y < plane.height; y++) for (let c = 0; c < 3; c++) assert.equal(rgb[(y * plane.width) * 3 + c], rgb[(y * plane.width + plane.width - 1) * 3 + c], `${kind}: horizontal seam`);
    for (let x = 0; x < plane.width; x++) for (let c = 0; c < 3; c++) assert.equal(rgb[x * 3 + c], rgb[((plane.height - 1) * plane.width + x) * 3 + c], `${kind}: vertical seam`);
  }
});

test("wrapping motifs stay owner-clipped across map edges without nonperiodic coast shadows", () => {
  const { plane, owners } = fixture();
  plane.wrapX = plane.wrapY = true;
  owners.fill(-1);
  for (let y = 0; y < plane.height; y++) for (let x = 0; x < plane.width; x++) if (x < 45 || x >= plane.width - 45) owners[y * plane.width + x] = 7;
  const before = maskDigest(owners), normal = renderRealmRgb(plane, owners, "periodic-land");
  const changed = structuredClone(plane);
  changed.provinces[7]!.terrainFlags = ["cave", "farm", "forest", "mountains"];
  const rgb = renderRealmRgb(changed, owners, "periodic-land");
  assert.equal(differentPixels(normal, rgb, owners, -1), 0);
  assert.ok(differentPixels(normal, rgb, owners, 7) > 1000);
  assert.equal(maskDigest(owners), before);
  const nonperiodic = { ...plane, wrapX: false, wrapY: false };
  renderRealmRgb(nonperiodic, owners, "periodic-land");
  assert.equal(digest(renderRealmRgb(changed, owners, "periodic-land")), digest(renderRealmRgb(changed, owners.slice(), "periodic-land")), "wrapping metadata is part of cache identity");
});

test("mutable ownership caches compare exact masks, including colliding old fingerprints", () => {
  const { plane, owners } = fixture();
  renderRealmRgb(plane, owners, "mutable-mask");
  for (let y = 20; y < 70; y++) for (let x = 20; x < 70; x++) owners[y * plane.width + x] = 7;
  assert.equal(digest(renderRealmRgb(plane, owners, "mutable-mask")), digest(renderRealmRgb(plane, owners.slice(), "mutable-mask")));
  owners.fill(0);
  // Equal FNV-1a fingerprints are not proof that two mutable masks are equal.
  owners.set([4, 3, 7, 5, 2, 5, 4, 4, -1, 6, 4, 7]);
  renderRealmRgb(plane, owners, "mutable-mask");
  owners.set([7, 2, 6, 4, 7, 2, 6, 2, 4, 6, 1, -1]);
  assert.equal(digest(renderRealmRgb(plane, owners, "mutable-mask")), digest(renderRealmRgb(plane, owners.slice(), "mutable-mask")));
});

test("cache keys disambiguate seed and province-ID delimiters, and output mutation is harmless", () => {
  for (const collision of ["ids", "seed"] as const) {
    const { plane, owners } = fixture(), changed = structuredClone(plane);
    let seed = "cache", nextSeed = seed;
    if (collision === "ids") {
      plane.provinces[0]!.id = "a|b"; plane.provinces[1]!.id = "c";
      changed.provinces[0]!.id = "a"; changed.provinces[1]!.id = "b|c";
    } else {
      seed = "cache:a"; nextSeed = "cache";
      plane.provinces[0]!.id = "b"; changed.provinces[0]!.id = "a:b";
    }
    renderRealmRgb(plane, owners, seed);
    const cached = renderRealmRgb(changed, owners, nextSeed), expected = digest(cached);
    assert.equal(expected, digest(renderRealmRgb(changed, owners.slice(), nextSeed)), collision);
    cached.fill(0);
    assert.equal(digest(renderRealmRgb(changed, owners, nextSeed)), expected, "callers own returned RGB buffers");
  }
});

test("realm artwork rejects invalid dimensions, plane kinds and ownership before allocating art", () => {
  const { plane, owners } = fixture();
  for (const dimension of [255, 3841, NaN, Infinity, 256.5]) assert.throws(() => renderRealmRgb({ ...plane, width: dimension }, owners, "bad"), /dimensions/);
  assert.throws(() => renderRealmRgb({ ...plane, width: 3840, height: 3840 }, owners, "bad"), /dimensions/);
  assert.throws(() => renderRealmRgb({ ...plane, kind: "surface" }, owners, "bad"), /Unsupported realm/);
  assert.throws(() => renderRealmRgb(plane, new Int16Array(1), "bad"), /ownership/);
  for (const owner of [-2, 8, 32767]) {
    owners[0] = owner;
    assert.throws(() => renderRealmRgb(plane, owners, "bad"), /invalid province owner/);
  }
});

test("extreme wide, portrait and 4K realms stay within bounded buffers", context => {
  for (const [width, height] of [[3840, 256], [256, 3840], [3840, 2160]] as const) {
    const { plane, owners } = fixture(width, height);
    const mask = maskDigest(owners), started = performance.now();
    const first = renderRealmRgb(plane, owners, "realm-performance");
    const firstMs = performance.now() - started, secondStart = performance.now();
    const second = renderRealmRgb({ ...plane, provinces: plane.provinces.map(province => ({ ...province, ...previewProvinceTerrain(province, "flooded") })) }, owners, "realm-performance");
    const secondMs = performance.now() - secondStart;
    assert.equal(first.length, width * height * 3);
    assert.equal(second.length, first.length);
    assert.notEqual(digest(second), digest(first));
    assert.equal(maskDigest(owners), mask);
    assert.ok(first.every(channel => channel <= 252));
    context.diagnostic(`${width}×${height}: first ${Math.round(firstMs)}ms, cached terrain edit ${Math.round(secondMs)}ms; RGB ${(first.byteLength / 1048576).toFixed(1)} MiB, retained exact mask + rim ${(owners.length * 3 / 1048576).toFixed(1)} MiB plus coarse fields/placements`);
  }
});
