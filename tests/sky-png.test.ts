import assert from "node:assert/strict";
import test from "node:test";
import { planeGenerationKey, type Plane, type PreviewCondition } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import { renderPlanePng, samplePlaneOwnership } from "../src/MapCanvas";
import { renderSkyRgb, skyVariantForPreview } from "../src/skyArt";
import { renderRealmRgb } from "../src/realmArt";
import { previewProvinceTerrain } from "../src/terrainVisuals";

function skyFixture(seed: string): Plane {
  const plane = createDefaultProject(seed).planes[0]!;
  plane.id = seed;
  plane.kind = "cloud";
  plane.ownershipMode = "sparse";
  plane.width = 320;
  plane.height = 256;
  plane.wrapX = false;
  plane.wrapY = false;
  plane.provinceTarget = 4;
  plane.provinces = plane.provinces.slice(0, 4).map((province, index) => ({
    ...province, id: `${seed}-${index}`, index: index + 1, name: `Sky ${index + 1}`,
    x: index % 2 ? .75 : .25, y: index < 2 ? .25 : .75,
    terrain: "plains", terrainFlags: [], freshwater: false,
    warmer: false, colder: false, start: false, sites: [], defenders: [],
  }));
  plane.edges = [[0, 1], [0, 2], [1, 3], [2, 3]].map(([a, b], index) => ({
    id: `${seed}-edge-${index}`, a: plane.provinces[a!]!.id, b: plane.provinces[b!]!.id, kind: "standard",
  }));
  return plane;
}

class FakePath2D {
  rectangles = 0;
  rect() { this.rectangles += 1; }
}

class FakeContext {
  clipped = false;
  stack: boolean[] = [];
  drawImages: FakeCanvas[] = [];
  text: { value: string; clipped: boolean }[] = [];
  imageData?: ImageData;
  compositeModes: string[] = [];
  set globalCompositeOperation(value: string) { this.compositeModes.push(value); }
  save() { this.stack.push(this.clipped); }
  restore() { this.clipped = this.stack.pop() ?? false; }
  scale() {}
  clearRect() {}
  fillRect() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  arc() {}
  fill() {}
  stroke() {}
  clip() { this.clipped = true; }
  setLineDash() {}
  strokeText() {}
  fillText(value: string) { this.text.push({ value, clipped: this.clipped }); }
  drawImage(image: FakeCanvas) { this.drawImages.push(image); }
  createLinearGradient() { return { addColorStop() {} }; }
  createImageData(width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }
  putImageData(data: ImageData) { this.imageData = data; }
}

class FakeCanvas {
  width = 0;
  height = 0;
  context = new FakeContext();
  getContext() { return this.context as unknown as CanvasRenderingContext2D; }
  toBlob(callback: BlobCallback) { callback(new Blob(["png"], { type: "image/png" })); }
}

function installCanvasFixture() {
  const originals = new Map(["document", "Path2D", "Image"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const canvases: FakeCanvas[] = [];
  const imageRequests: string[] = [];
  class UnavailableImage {
    onerror?: () => void;
    set src(source: string) { imageRequests.push(source); this.onerror?.(); }
  }
  Object.defineProperty(globalThis, "Path2D", { configurable: true, value: FakePath2D });
  Object.defineProperty(globalThis, "Image", { configurable: true, value: UnavailableImage });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => { const canvas = new FakeCanvas(); canvases.push(canvas); return canvas; },
  } });
  return {
    canvases, imageRequests,
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
    async render(plane: Plane, condition: PreviewCondition = "normal") {
      const next = canvases.length;
      const blob = await renderPlanePng(plane, condition, new Map([[plane.provinces[0]!.id, { gateNumbers: [7] }]]));
      assert.equal(blob.type, "image/png");
      const output = canvases[next]!;
      return { output, raster: output.context.drawImages[0]! };
    },
  };
}

test("Cloud and Air PNGs use canonical opaque sky artwork with unclipped semantic markers", async () => {
  const fixture = installCanvasFixture();
  try {
    for (const kind of ["cloud", "air"] as const) {
      const plane = skyFixture(`sky-png-${kind}`);
      plane.kind = kind;
      plane.provinces[0]!.defenders = [{ commander: "5", squads: [] }];
      const before = structuredClone(plane);
      for (const condition of ["normal", "winter", "forested", "flooded", "wasted", "farmland"] as const) {
        const { output, raster } = await fixture.render(plane, condition);
        assert.deepEqual([output.width, output.height, raster.width, raster.height], [320, 256, 320, 256]);
        const rgba = raster.context.imageData!.data;
        const displayed = { ...plane, provinces: plane.provinces.map(province => ({ ...province, ...previewProvinceTerrain(province, condition) })) };
        const expected = renderSkyRgb(displayed, samplePlaneOwnership(plane, plane.width, plane.height), skyVariantForPreview(condition), `${planeGenerationKey(plane)}:sky-art`);
        for (let pixel = 0; pixel < plane.width * plane.height; pixel++) {
          assert.equal(rgba[pixel * 4], expected[pixel * 3]);
          assert.equal(rgba[pixel * 4 + 1], expected[pixel * 3 + 1]);
          assert.equal(rgba[pixel * 4 + 2], expected[pixel * 3 + 2]);
          assert.equal(rgba[pixel * 4 + 3], 255);
        }
        assert.ok(output.context.text.some(text => text.value === "G"), "guardian badge survives");
        assert.ok(output.context.text.some(text => text.value === "◎"), "gateway badge survives");
        assert.ok(output.context.text.some(text => text.value === "Sky 1"), "province label survives");
        assert.ok(output.context.text.every(text => !text.clipped), "ownership masks must not crop text");
        assert.equal(raster.context.text.length, 0, "semantic text is separate from the cached artwork");
      }
      assert.deepEqual(plane, before, "preview conditions never mutate playable terrain or guardians");
    }
    assert.deepEqual(fixture.imageRequests, [], "self-contained sky art requires no external raster loads");
  } finally { fixture.restore(); }
});

test("sky PNG cache responds to in-place terrain, climate, geometry and seed edits but reuses unchanged artwork", async () => {
  const fixture = installCanvasFixture();
  try {
    const plane = skyFixture("sky-png-cache");
    const normal = await fixture.render(plane);
    assert.equal((await fixture.render(plane)).raster, normal.raster);
    plane.provinces[0]!.name = "Renamed Isle";
    const renamed = await fixture.render(plane);
    assert.equal(renamed.raster, normal.raster, "metadata-only edits reuse the raster");
    assert.ok(renamed.output.context.text.some(text => text.value === "Renamed Isle"));
    plane.provinces[0]!.terrainFlags = ["forest", "farm"];
    const edited = await fixture.render(plane);
    assert.notDeepEqual(edited.raster.context.imageData!.data, normal.raster.context.imageData!.data);
    const winter = await fixture.render(plane, "winter");
    assert.notDeepEqual(winter.raster.context.imageData!.data, edited.raster.context.imageData!.data);
    plane.provinces[0]!.warmer = true;
    const warmWinter = await fixture.render(plane, "winter");
    assert.notDeepEqual(warmWinter.raster.context.imageData!.data, winter.raster.context.imageData!.data);
    plane.provinces[0]!.x += .04;
    const moved = await fixture.render(plane, "winter");
    assert.notDeepEqual(moved.raster.context.imageData!.data, warmWinter.raster.context.imageData!.data);
    plane.id += "-reference-only";
    assert.equal((await fixture.render(plane, "winter")).raster, moved.raster, "reference IDs no longer repaint generated artwork");
    plane.generationKey += "-new-applied-seed";
    assert.notDeepEqual((await fixture.render(plane, "winter")).raster.context.imageData!.data, moved.raster.context.imageData!.data);
    delete plane.generationKey;
    const legacy = await fixture.render(plane, "winter");
    plane.id += "-legacy-salt";
    assert.notDeepEqual((await fixture.render(plane, "winter")).raster.context.imageData!.data, legacy.raster.context.imageData!.data, "old saves still use their original reference ID as the art salt");
  } finally { fixture.restore(); }
});

test("small imported sky drafts retain the existing masked-renderer fallback", async () => {
  const fixture = installCanvasFixture();
  try {
    const plane = skyFixture("sky-png-small-draft");
    plane.width = 96;
    plane.height = 64;
    const { output, raster } = await fixture.render(plane);
    assert.deepEqual([output.width, output.height], [96, 64]);
    assert.equal(raster.context.imageData, undefined);
    assert.ok(raster.context.compositeModes.includes("destination-in"));
    assert.ok(fixture.imageRequests.includes("/plane-backgrounds/cloud-air.png"), "fallback still loads themed artwork");
  } finally { fixture.restore(); }
});

test("all new realm PNGs preserve exact procedural pixels, terrain conditions and unmasked semantic labels", async () => {
  const fixture = installCanvasFixture();
  try {
    for (const kind of ["cave", "cavern", "underworld", "hell", "abyss", "dream", "elemental"] as const) {
      const plane = skyFixture(`realm-png-${kind}`);
      plane.kind = kind;
      plane.provinces[0]!.defenders = [{ commander: "5", squads: [] }];
      plane.provinces[1]!.terrainFlags = ["sea", "cave"];
      plane.provinces[2]!.terrainFlags = ["forest", "highland"];
      plane.provinces[3]!.terrainFlags = ["cavewall", "sea", "forest"];
      const before = structuredClone(plane);
      let normal: Uint8ClampedArray | undefined;
      for (const condition of ["normal", "winter", "forested", "flooded", "wasted", "farmland"] as const) {
        const { output, raster } = await fixture.render(plane, condition);
        assert.deepEqual([output.width, output.height, raster.width, raster.height], [320, 256, 320, 256]);
        const rgba = raster.context.imageData!.data;
        const displayed = { ...plane, provinces: plane.provinces.map(province => ({ ...province, ...previewProvinceTerrain(province, condition) })) };
        const expected = renderRealmRgb(displayed, samplePlaneOwnership(plane, plane.width, plane.height), `${planeGenerationKey(plane)}:realm-art`);
        for (let pixel = 0; pixel < plane.width * plane.height; pixel++) {
          assert.equal(rgba[pixel * 4], expected[pixel * 3]);
          assert.equal(rgba[pixel * 4 + 1], expected[pixel * 3 + 1]);
          assert.equal(rgba[pixel * 4 + 2], expected[pixel * 3 + 2]);
          assert.equal(rgba[pixel * 4 + 3], 255);
        }
        if (condition === "normal") normal = rgba;
        if (condition === "winter") assert.deepEqual(rgba, normal, `${kind}: established special-realm winter policy is unchanged`);
        assert.ok(output.context.text.some(text => text.value === "G"));
        assert.ok(output.context.text.some(text => text.value === "◎"));
        assert.ok(output.context.text.some(text => text.value === "Sky 1"));
        assert.ok(output.context.text.every(text => !text.clipped));
        assert.equal(raster.context.text.length, 0);
      }
      assert.deepEqual(plane, before, `${kind}: no gameplay mutation`);
    }
    assert.deepEqual(fixture.imageRequests, [], "all supported realms are self-contained");
  } finally { fixture.restore(); }
});

test("realm PNG caching follows variant changes, restores old artwork, and retains terrain edit responses", async () => {
  const fixture = installCanvasFixture();
  try {
    const plane = skyFixture("realm-png-cache");
    plane.kind = "cave";
    plane.variant = "fungal";
    plane.provinces.forEach(province => { province.terrainFlags = ["cave", "forest"]; });
    const fungal = await fixture.render(plane);
    assert.equal((await fixture.render(plane)).raster, fungal.raster);
    plane.variant = "crystal";
    const crystal = await fixture.render(plane);
    assert.notDeepEqual(crystal.raster.context.imageData!.data, fungal.raster.context.imageData!.data);
    plane.variant = "fungal";
    assert.deepEqual((await fixture.render(plane)).raster.context.imageData!.data, fungal.raster.context.imageData!.data);
    plane.provinces[0]!.terrainFlags = ["sea", "cave"];
    assert.notDeepEqual((await fixture.render(plane)).raster.context.imageData!.data, fungal.raster.context.imageData!.data);
  } finally { fixture.restore(); }
});

test("surface and Custom planes keep the established painter and materials", async () => {
  const fixture = installCanvasFixture();
  try {
    for (const kind of ["surface", "custom"] as const) {
      const plane = skyFixture(`realm-png-exclusion-${kind}`);
      plane.kind = kind;
      plane.variant = "infernal";
      plane.ownershipMode = "solid";
      const { output } = await fixture.render(plane);
      assert.equal(output.context.imageData, undefined);
      assert.equal(output.context.drawImages.length, 0, "solid vector path paints directly");
      assert.ok(output.context.text.length > 0);
    }
    assert.ok(fixture.imageRequests.includes("/map-art/materials/earth.png"));
  } finally { fixture.restore(); }
});
