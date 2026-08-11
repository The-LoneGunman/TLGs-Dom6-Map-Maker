import assert from "node:assert/strict";
import test from "node:test";
import type { Plane } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import { createProvinceOwnershipModel } from "../src/geometry";
import { planeBackgroundAsset, provinceAtOwnershipPoint, renderPlanePng, samplePlaneOwnership } from "../src/MapCanvas";

function sparsePreviewFixture(): Plane {
  const plane = createDefaultProject("sparse-preview-fixture").planes[0]!;
  plane.kind = "cave";
  plane.ownershipMode = "sparse";
  plane.width = 96;
  plane.height = 64;
  plane.wrapX = false;
  plane.wrapY = false;
  const positions = [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ] as const;
  plane.provinces = plane.provinces.slice(0, 4).map((province, index) => ({
    ...province,
    id: `preview-${index + 1}`,
    index: index + 1,
    x: positions[index]![0],
    y: positions[index]![1],
  }));
  plane.provinceTarget = 4;
  plane.edges = [
    { id: "preview-ab", a: "preview-1", b: "preview-2", kind: "standard" },
    { id: "preview-bc", a: "preview-2", b: "preview-3", kind: "standard" },
    { id: "preview-cd", a: "preview-3", b: "preview-4", kind: "standard" },
    { id: "preview-da", a: "preview-4", b: "preview-1", kind: "standard" },
  ];
  return plane;
}

test("preview ownership samples canonical sparse owner-0 pixels", () => {
  const plane = sparsePreviewFixture();
  const ownership = createProvinceOwnershipModel(plane);
  const owners = samplePlaneOwnership(plane, plane.width, plane.height, ownership);
  const capitalPixels = new Set(plane.provinces.map((province) => {
    const x = Math.round(province.x * (plane.width - 1));
    const y = Math.round(province.y * (plane.height - 1));
    return y * plane.width + x;
  }));
  let blankPixels = 0;
  for (let y = 0; y < plane.height; y += 1) {
    for (let x = 0; x < plane.width; x += 1) {
      const pixel = y * plane.width + x;
      if (!capitalPixels.has(pixel)) {
        assert.equal(owners[pixel], ownership.ownerAt((x + 0.5) / plane.width, (y + 0.5) / plane.height));
      }
      if (owners[pixel] === -1) blankPixels += 1;
    }
  }
  assert.ok(blankPixels > plane.width * plane.height * 0.2);
});

test("blank sparse clicks select nothing while owned corridors resolve a province", () => {
  const plane = sparsePreviewFixture();
  const ownership = createProvinceOwnershipModel(plane);
  assert.equal(ownership.ownerAt(0.5, 0.5), -1);
  assert.equal(provinceAtOwnershipPoint(plane, ownership, 0.5, 0.5), undefined);

  const corridorOwner = ownership.ownerAt(0.5, 0.2);
  assert.ok(corridorOwner >= 0);
  assert.equal(provinceAtOwnershipPoint(plane, ownership, 0.5, 0.2)?.id, plane.provinces[corridorOwner]!.id);
  plane.provinces.forEach((province) => assert.equal(
    provinceAtOwnershipPoint(plane, ownership, province.x, province.y)?.id,
    province.id,
  ));
});

test("surface preview ownership remains solid", () => {
  const plane = createDefaultProject("solid-preview-fixture").planes[0]!;
  plane.ownershipMode = "solid";
  const ownership = createProvinceOwnershipModel(plane);
  const owners = samplePlaneOwnership(plane, 48, 30, ownership);
  assert.equal(owners.some((owner) => owner < 0), false);
  assert.ok(provinceAtOwnershipPoint(plane, ownership, 0.5, 0.5));
});

test("sparse plane archetypes select their themed owner-0 artwork", () => {
  const plane = sparsePreviewFixture();
  const expected = new Map<Plane["kind"], string>([
    ["cave", "/plane-backgrounds/cavern.png"],
    ["cavern", "/plane-backgrounds/cavern.png"],
    ["cloud", "/plane-backgrounds/cloud-air.png"],
    ["air", "/plane-backgrounds/cloud-air.png"],
    ["underworld", "/plane-backgrounds/underworld.png"],
    ["hell", "/plane-backgrounds/infernal.png"],
    ["abyss", "/plane-backgrounds/abyss.png"],
    ["dream", "/plane-backgrounds/dream.png"],
    ["elemental", "/plane-backgrounds/elemental.png"],
  ]);
  for (const [kind, asset] of expected) {
    plane.kind = kind;
    assert.equal(planeBackgroundAsset(plane), asset);
  }
  plane.kind = "surface";
  assert.equal(planeBackgroundAsset(plane), undefined);
  plane.kind = "cave";
  plane.ownershipMode = "solid";
  assert.equal(planeBackgroundAsset(plane), undefined, "solid planes have no owner-0 background region");
});

test("PNG rendering masks sparse overlays while leaving solid rendering on its vector path", async () => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const priorPath2D = Object.getOwnPropertyDescriptor(globalThis, "Path2D");
  const canvases: FakeCanvas[] = [];
  const paths: FakePath2D[] = [];

  class FakePath2D {
    rectCount = 0;
    constructor() { paths.push(this); }
    rect() { this.rectCount += 1; }
  }
  class FakeGradient { addColorStop() {} }
  class FakeContext {
    compositeModes: string[] = [];
    drawImageCount = 0;
    set globalCompositeOperation(value: string) { this.compositeModes.push(value); }
    get globalCompositeOperation() { return this.compositeModes.at(-1) ?? "source-over"; }
    save() {}
    restore() {}
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
    clip() {}
    setLineDash() {}
    fillText() {}
    strokeText() {}
    drawImage() { this.drawImageCount += 1; }
    createLinearGradient() { return new FakeGradient(); }
  }
  class FakeCanvas {
    width = 0;
    height = 0;
    context = new FakeContext();
    getContext() { return this.context as unknown as CanvasRenderingContext2D; }
    toBlob(callback: BlobCallback) { callback(new Blob(["png"], { type: "image/png" })); }
  }

  Object.defineProperty(globalThis, "Path2D", { configurable: true, value: FakePath2D });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => { const canvas = new FakeCanvas(); canvases.push(canvas); return canvas; } },
  });
  try {
    const sparse = sparsePreviewFixture();
    const sparseBlob = await renderPlanePng(sparse, "normal");
    assert.equal(sparseBlob.type, "image/png");
    assert.equal(canvases.length, 2, "sparse output uses a clipped offscreen terrain layer");
    assert.ok(canvases[1]!.context.compositeModes.includes("destination-in"));
    assert.equal(canvases[0]!.context.drawImageCount, 1);
    assert.ok(paths.some((path) => path.rectCount > 0), "canonical owned scanlines populate the clipping paths");

    canvases.length = 0;
    paths.length = 0;
    const solid = createDefaultProject("solid-png-preview").planes[0]!;
    solid.width = 96;
    solid.height = 64;
    await renderPlanePng(solid, "normal");
    assert.equal(canvases.length, 1, "solid surface output keeps the existing direct vector renderer");
    assert.equal(canvases[0]!.context.compositeModes.includes("destination-in"), false);
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (priorPath2D) Object.defineProperty(globalThis, "Path2D", priorPath2D);
    else Reflect.deleteProperty(globalThis, "Path2D");
  }
});
