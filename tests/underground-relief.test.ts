import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Plane, Province, TerrainKey } from "../src/domain";
import { encodeD6m, inspectD6m } from "../src/dom6";
import { terrainElevation } from "../src/terrainVisuals";

const UNDERGROUND_KINDS = ["cave", "cavern", "underworld", "hell", "abyss"] as const;

function reliefFixture(kind: Plane["kind"], width = 256, height = 256): Plane {
  const positions = [[0.22, 0.23], [0.78, 0.23], [0.78, 0.77], [0.22, 0.77]] as const;
  const terrains: TerrainKey[] = ["cave", "caveswamp", "sea", "deepsea"];
  const provinces: Province[] = positions.map(([x, y], index) => ({
    id: `relief-${index + 1}`, index: index + 1, x, y, gridX: index % 2, gridY: index >> 1,
    name: `Relief ${index + 1}`, biome: "living_caves", terrain: terrains[index]!,
    small: false, large: false, noStart: false, manySites: false, warmer: false, colder: false,
    siteBias: [], start: false, throne: "none", sites: [], killRandomSites: false,
    temple: false, lab: false, defenders: [], battle: {}, rawDirectives: "",
  }));
  return {
    id: "relief-plane", name: "Relief", kind, variant: "temperate", provinceTarget: provinces.length,
    width, height, wrapX: true, wrapY: true, ownershipMode: "sparse", provinces,
    edges: provinces.map((province, index) => ({
      id: `relief-edge-${index}`, a: province.id, b: provinces[(index + 1) % provinces.length]!.id, kind: "standard",
    })), rawDirectives: "",
  };
}

function raster(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(8, true);
  const height = view.getInt32(12, true);
  const heightOffset = 34 + view.getInt32(30, true) * 12;
  const ownerOffset = heightOffset + width * height * 2;
  return {
    width, height,
    elevation: (x: number, y: number) => view.getInt16(heightOffset + (y * width + x) * 2, true),
    owner: (x: number, y: number) => view.getInt16(ownerOffset + (y * width + x) * 2, true),
  };
}

test("non-underground and solid native bytes retain their pre-polish snapshots", async () => {
  const solidSnapshot = "4bcdaa19624af3d9f9780b4bda2cc2c63ece28ce47c11232e18f006abfb62bce";
  const fixtures: Array<readonly [Plane["kind"], Plane["ownershipMode"], string]> = [
    ["surface", "solid", solidSnapshot], ["custom", "solid", solidSnapshot],
    ...UNDERGROUND_KINDS.map((kind) => [kind, "solid", solidSnapshot] as const),
    ["cloud", "sparse", "be6a10dc8999052f487aa23a4e50da1d149f92f7e5371be2a42c6c3793d640ba"],
    ["air", "sparse", "8fa485e7ca27ae91ae4ae0c010f02a84e2a2a8d14aa97779750a5d50598afba9"],
    ["dream", "sparse", "4c92064c3b99c047077d53df2120d177856b60119291d2f05cc90510faa76f24"],
    ["elemental", "sparse", "d166a7255c8c554ec5d4291c3286598835c469615a68e916a5868732b42c2bef"],
    ["custom", "sparse", "2957fb5ff24e0e20f34d4cf900107fd2193975ade3ad3839f890102fb5dc0cd5"],
    ["surface", "sparse", "053a5d1cfbf544f3acb487cbb5776fa4d43822ae5e660e4c9dd4d0f29ebffd05"],
  ];
  for (const [kind, ownershipMode, expected] of fixtures) {
    const plane = reliefFixture(kind);
    plane.ownershipMode = ownershipMode;
    const bytes = await encodeD6m(plane, "underground-relief-snapshot");
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected, `${kind}/${ownershipMode}`);
  }
});

test("sparse underground relief is deterministic, terrain-aware and limited to low amplitudes", async () => {
  for (const kind of UNDERGROUND_KINDS) {
    const plane = reliefFixture(kind);
    const original = structuredClone(plane);
    const bytes = await encodeD6m(plane, "underground-relief-signs");
    assert.equal(inspectD6m(bytes).valid, true, kind);
    assert.deepEqual(await encodeD6m(structuredClone(plane), "underground-relief-signs"), bytes, kind);
    assert.notDeepEqual(await encodeD6m(plane, "another-relief-seed"), bytes, kind);
    assert.deepEqual(plane, original, `${kind}: encoding cannot mutate gameplay`);
    const data = raster(bytes);
    const seenOwners = new Set<number>();
    for (let y = 0; y < plane.height; y += 1) {
      for (let x = 0; x < plane.width; x += 1) {
        const owner = data.owner(x, y);
        const elevation = data.elevation(x, y);
        seenOwners.add(owner);
        if (!owner) { assert.equal(elevation, 0); continue; }
        const base = terrainElevation(plane.provinces[owner - 1]!);
        assert.equal(Math.sign(elevation), Math.sign(base), `${kind}: ${owner} must retain its land/water sign`);
        assert.ok(Math.abs(elevation - base) <= 24, `${kind}: relief cannot recreate high block terraces`);
      }
    }
    assert.deepEqual([...seenOwners].sort(), [0, 1, 2, 3, 4]);
    for (const province of plane.provinces) {
      const x = Math.round(province.x * (plane.width - 1));
      const y = Math.round(province.y * (plane.height - 1));
      assert.equal(data.elevation(x, y), terrainElevation(province), `${kind}: native center heights stay exact`);
      if (data.owner(x + 1, y) === province.index) {
        assert.ok(Math.abs(data.elevation(x + 1, y) - data.elevation(x, y)) <= 1, "center anchoring cannot leave a one-pixel spike");
      }
    }
  }
});

test("very low swamps and combined underwater flags retain dry, sea and deep relief semantics", async () => {
  const plane = reliefFixture("underworld");
  plane.provinces[0]!.terrain = "swamp";
  plane.provinces[1]!.terrain = "mountains";
  plane.provinces[1]!.terrainFlags = ["sea", "cave"];
  plane.provinces[2]!.terrain = "forest";
  plane.provinces[2]!.terrainFlags = ["sea"];
  plane.provinces[3]!.terrain = "cavehighland";
  plane.provinces[3]!.terrainFlags = ["sea", "deep"];
  const bytes = await encodeD6m(plane, "underground-low-and-combined");
  const data = raster(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.deepEqual(plane.provinces.map((_, index) => view.getBigInt64(34 + index * 12 + 4, true)), [0n, 4n, 4n, 2052n]);
  for (let y = 0; y < plane.height; y += 1) {
    for (let x = 0; x < plane.width; x += 1) {
      const owner = data.owner(x, y);
      if (!owner) continue;
      const elevation = data.elevation(x, y);
      if (owner === 1) assert.ok(elevation >= 10 && elevation <= 26, "low dry swamp cannot dip into native water");
      else if (owner === 4) assert.ok(elevation < -1100, "Deep remains deeper than ordinary sea");
      else assert.ok(elevation < -190 && elevation > -330, "additional flags cannot lift sea above zero");
    }
  }
});

test("enabled wrap seams join smoothly on each axis without flattening nonwrapped maps", async () => {
  for (const [wrapX, wrapY] of [[true, false], [false, true], [true, true]] as const) {
    const plane = reliefFixture("cavern");
    plane.wrapX = wrapX;
    plane.wrapY = wrapY;
    plane.provinces.forEach((province) => { province.terrain = "cave"; });
    const data = raster(await encodeD6m(plane, "underground-periodic-relief"));
    let horizontalSamples = 0;
    let verticalSamples = 0;
    for (let pixel = 0; pixel < 256; pixel += 1) {
      if (wrapX && data.owner(0, pixel) && data.owner(255, pixel)) {
        assert.ok(Math.abs(data.elevation(0, pixel) - data.elevation(255, pixel)) <= 1, "horizontal seam must not add a relief cliff");
        horizontalSamples += 1;
      }
      if (wrapY && data.owner(pixel, 0) && data.owner(pixel, 255)) {
        assert.ok(Math.abs(data.elevation(pixel, 0) - data.elevation(pixel, 255)) <= 1, "vertical seam must not add a relief cliff");
        verticalSamples += 1;
      }
    }
    if (wrapX) assert.ok(horizontalSamples > 0, "fixture must exercise horizontal wrapped ownership");
    if (wrapY) assert.ok(verticalSamples > 0, "fixture must exercise vertical wrapped ownership");
  }
  const nonwrapped = reliefFixture("cave");
  nonwrapped.wrapX = nonwrapped.wrapY = false;
  nonwrapped.provinces.forEach((province) => { province.terrain = "cave"; });
  const data = raster(await encodeD6m(nonwrapped, "underground-periodic-relief"));
  const elevations = new Set<number>();
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) if (data.owner(x, y)) elevations.add(data.elevation(x, y));
  }
  assert.ok(elevations.size >= 20, "nonwrapped relief keeps its continuous variation");
});

test("changing export resolution does not rescale the underground relief pattern", async () => {
  const small = reliefFixture("abyss");
  small.provinces.forEach((province) => { province.terrain = "cave"; });
  const large = { ...structuredClone(small), width: 768, height: 768 };
  const low = raster(await encodeD6m(small, "underground-resolution-invariance"));
  const high = raster(await encodeD6m(large, "underground-resolution-invariance"));
  let compared = 0;
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const owner = low.owner(x, y);
      if (!owner || high.owner(x * 3 + 1, y * 3 + 1) !== owner) continue;
      const province = small.provinces[owner - 1]!;
      // Quantized native center anchors may shift by a subpixel between
      // resolutions; away from that tiny local patch the field is identical.
      let dx = Math.abs(x - Math.round(province.x * 255));
      let dy = Math.abs(y - Math.round(province.y * 255));
      dx = Math.min(dx, 256 - dx);
      dy = Math.min(dy, 256 - dy);
      if (dx < 10 && dy < 10) continue;
      assert.equal(low.elevation(x, y), high.elevation(x * 3 + 1, y * 3 + 1), "matched pixel centers must sample the same map-relative field");
      compared += 1;
    }
  }
  assert.ok(compared > 5000, "the fixture must compare meaningful owned regions");
});

test("underground relief is smoothly interpolated across small, portrait, ultrawide and 4K rasters", async (context) => {
  for (const [width, height] of [[256, 256], [3840, 256], [256, 3840], [3840, 2160]] as const) {
    const plane = reliefFixture("cave", width, height);
    plane.provinces.forEach((province) => { province.terrain = "cave"; });
    const started = performance.now();
    const data = raster(await encodeD6m(plane, "underground-relief-smooth"));
    context.diagnostic(`${width}x${height} native encode: ${Math.round(performance.now() - started)}ms`);
    let maximumStep = 0;
    let horizontalVariation = 0;
    let verticalVariation = 0;
    let horizontalPairs = 0;
    let verticalPairs = 0;
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const owner = data.owner(x, y);
        if (!owner) continue;
        const value = data.elevation(x, y);
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
        const nextX = (x + 1) % width;
        const nextY = (y + 1) % height;
        if (data.owner(nextX, y) === owner) {
          const step = Math.abs(value - data.elevation(nextX, y));
          maximumStep = Math.max(maximumStep, step);
          horizontalVariation += step;
          horizontalPairs += 1;
        }
        if (data.owner(x, nextY) === owner) {
          const step = Math.abs(value - data.elevation(x, nextY));
          maximumStep = Math.max(maximumStep, step);
          verticalVariation += step;
          verticalPairs += 1;
        }
      }
    }
    assert.ok(maximumStep <= 9, `${width}x${height}: unexpected hard relief step of ${maximumStep}`);
    assert.ok(maximum - minimum >= 20, `${width}x${height}: smoothing must retain visible relief`);
    const variationRatio = (horizontalVariation / horizontalPairs) / (verticalVariation / verticalPairs);
    assert.ok(variationRatio > 0.35 && variationRatio < 2.85, `${width}x${height}: relief is stretched along one map axis (${variationRatio})`);
  }
});
