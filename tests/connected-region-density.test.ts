import assert from "node:assert/strict";
import test from "node:test";
import type { Plane, PlaneKind } from "../src/domain";
import { createDefaultProject, generatePlane } from "../src/generator";
import { computeProvinceTopology, connectionKey, createProvinceOwnershipModel } from "../src/geometry";
import { samplePlaneOwnership } from "../src/MapCanvas";
import { connectedRegionLayoutNotice, createConnectedRegionOwnership } from "../src/connectedRegions";
import { encodeD6m } from "../src/dom6";

function fixture(kind: PlaneKind, count: number, seedNumber: number, wrapX = false): Plane {
  const seed = `independent-region-${seedNumber}`;
  const project = createDefaultProject(seed, { generate: false });
  const source: Plane = {
    ...project.planes[0]!, id: `${seed}-${kind}`, kind,
    ownershipMode: "sparse", sparseLayout: "regions", provinceTarget: count,
    width: 256, height: 256, wrapX, wrapY: false, noGeneratedStarts: true,
  };
  return generatePlane(source, project.settings, `${seed}-${kind}`, 1, { deferStrategicFeatures: true });
}

/** Inspect the actual preview/native-resolution raster, including capital pixels. */
function audit(plane: Plane) {
  const width = plane.width, height = plane.height;
  const owners = samplePlaneOwnership(plane, width, height);
  const seen = new Uint8Array(owners.length), queue = new Uint32Array(owners.length);
  const contacts = new Set<string>();
  const components = Array.from({ length: plane.provinces.length }, () => [] as number[]);
  const neighbours = (pixel: number) => {
    const x = pixel % width, y = Math.floor(pixel / width);
    return [
      x > 0 ? pixel - 1 : plane.wrapX ? pixel + width - 1 : -1,
      x < width - 1 ? pixel + 1 : plane.wrapX ? pixel - width + 1 : -1,
      y > 0 ? pixel - width : plane.wrapY ? pixel + (height - 1) * width : -1,
      y < height - 1 ? pixel + width : plane.wrapY ? x : -1,
    ];
  };
  for (let pixel = 0; pixel < owners.length; pixel++) {
    const owner = owners[pixel]!;
    if (owner < 0) continue;
    for (const next of neighbours(pixel)) {
      if (next < 0) continue;
      const other = owners[next]!;
      if (other >= 0 && other !== owner) {
        contacts.add(connectionKey(plane.provinces[owner]!.id, plane.provinces[other]!.id));
      }
    }
    if (seen[pixel]) continue;
    seen[pixel] = 1; queue[0] = pixel;
    let length = 1;
    for (let cursor = 0; cursor < length; cursor++) {
      for (const next of neighbours(queue[cursor]!)) {
        if (next >= 0 && !seen[next] && owners[next] === owner) {
          seen[next] = 1; queue[length++] = next;
        }
      }
    }
    components[owner]!.push(length);
  }
  return { contacts, components };
}

function assertConnected(plane: Plane, components: number[][]) {
  for (const [owner, sizes] of components.entries()) {
    assert.equal(sizes.length, 1, `Province ${plane.provinces[owner]!.index} has disconnected raster components: ${sizes}`);
  }
}

test("regional cloud islands remain four-connected at 80 provinces and minimum resolution", () => {
  const plane = fixture("cloud", 80, 9, true);
  assert.equal(connectedRegionLayoutNotice(plane), undefined, "A detached pixel alone should not discard the regional style");
  assert.ok(createConnectedRegionOwnership(plane));
  assertConnected(plane, audit(plane).components);
});

test("regional cave rooms do not leave detached pixels at 240 provinces and minimum resolution", () => {
  const plane = fixture("cave", 240, 0);
  assert.equal(connectedRegionLayoutNotice(plane), undefined, "Keep the regional style and remove only unconnected native-pixel fragments");
  assert.ok(createConnectedRegionOwnership(plane));
  assertConnected(plane, audit(plane).components);
});

for (const wrapX of [false, true]) {
  test(`dense regional cave contacts agree with movement at 800 provinces (wrap X: ${wrapX})`, () => {
    const plane = fixture("cave", 800, 0, wrapX);
    const before = JSON.stringify(plane);
    assert.match(connectedRegionLayoutNotice(plane)!, /Compatibility geometry is retained.*256×256/);
    assert.match(connectedRegionLayoutNotice(plane)!, /Increase this plane's resolution or reduce province density/);
    assert.equal(createConnectedRegionOwnership(plane), undefined, "Unsafe raster contacts need explicit fallback, not a hidden graph rewrite");
    assert.deepEqual(samplePlaneOwnership(plane, plane.width, plane.height),
      samplePlaneOwnership({ ...plane, sparseLayout: undefined }, plane.width, plane.height),
      "Obsolete layout metadata cannot bypass the safety fallback");
    const { contacts } = audit(plane);
    const expected = new Set(plane.edges.map(edge => connectionKey(edge.a, edge.b)));
    assert.deepEqual({
      missing: [...expected].filter(key => !contacts.has(key)),
      extra: [...contacts].filter(key => !expected.has(key)),
    }, { missing: [], extra: [] }, "Pixel quantization must not remove doorways or invent unlinked neighbours");
    // Classic remains byte-frozen, including any pre-existing isolated edge
    // pixels; fallback safety here promises faithful movement contacts.
    assert.equal(JSON.stringify(plane), before, "Drawing ownership cannot rewrite gameplay or province content");
  });
}

test("regional raster-safety cache follows geometry edits but ignores gameplay-only edits", () => {
  const plane = fixture("cloud", 80, 9, true);
  const first = createConnectedRegionOwnership(plane);
  assert.ok(first);
  plane.provinces[0]!.population = 12345;
  plane.provinces[0]!.terrainFlags = ["forest"];
  assert.equal(createConnectedRegionOwnership(plane), first, "Content editing must not pay another native-resolution scan");
  plane.provinces[0]!.small = !plane.provinces[0]!.small;
  const resized = createConnectedRegionOwnership(plane);
  assert.notEqual(resized, first, "Province size changes affect the contour and must invalidate safety");
  plane.edges.pop();
  assert.notEqual(createConnectedRegionOwnership(plane), resized, "A changed movement graph cannot retain old walls or cached safety");
  const highDensity = fixture("cave", 800, 0);
  assert.match(connectedRegionLayoutNotice(highDensity)!, /256×256/);
  highDensity.width = 1024;
  highDensity.height = 1024;
  assert.equal(connectedRegionLayoutNotice(highDensity), undefined, "Increasing resolution rechecks and can restore the selected style without regeneration");
  assert.ok(createConnectedRegionOwnership(highDensity));
});

test("stabilized regional ownership remains exact in native export and border drawing", async () => {
  const plane = fixture("cloud", 80, 9, true);
  const before = JSON.stringify(plane), model = createProvinceOwnershipModel(plane);
  const preview = samplePlaneOwnership(plane, plane.width, plane.height, model);
  const bytes = await encodeD6m(plane, "stabilized-regions");
  const offset = 34 + plane.provinces.length * 12 + plane.width * plane.height * 2;
  const native = new Int16Array(bytes.buffer, bytes.byteOffset + offset, preview.length);
  for (let pixel = 0; pixel < preview.length; pixel++) assert.equal(native[pixel]! - 1, preview[pixel]);
  for (const [owner, province] of plane.provinces.entries()) assert.equal(model.ownerAt(province.x, province.y), owner);
  const topology = computeProvinceTopology(plane);
  for (const edge of plane.edges) {
    const a = plane.provinces.findIndex(p => p.id === edge.a), b = plane.provinces.findIndex(p => p.id === edge.b);
    const borders = topology.sharedBorders.get(connectionKey(edge.a, edge.b));
    assert.ok(borders?.length);
    for (const border of borders!) {
      const dx = (border.to.x - border.from.x) * model.metricAspect, dy = border.to.y - border.from.y;
      const length = Math.hypot(dx, dy);
      for (const t of [.2, .5, .8]) {
        const x = border.from.x + (border.to.x - border.from.x) * t, y = border.from.y + (border.to.y - border.from.y) * t;
        const epsilon = 1e-6;
        assert.deepEqual([
          model.ownerAt(x - dy / length * epsilon / model.metricAspect, y + dx / length * epsilon),
          model.ownerAt(x + dy / length * epsilon / model.metricAspect, y - dx / length * epsilon),
        ].sort((x, y) => x - y), [a, b].sort((x, y) => x - y));
      }
    }
  }
  assert.equal(JSON.stringify(plane), before);
});

test("an empty regional draft has no native raster to allocate or stabilize", () => {
  const project = createDefaultProject("empty-regional-draft", { generate: false });
  const plane: Plane = { ...project.planes[0]!, kind: "cave", ownershipMode: "sparse", sparseLayout: "regions",
    width: 3840, height: 2160, provinces: [], edges: [] };
  assert.equal(connectedRegionLayoutNotice(plane), undefined);
  const model = createConnectedRegionOwnership(plane);
  assert.ok(model);
  assert.equal(model.ownerAt(.5, .5), -1);
  assert.equal(model.primitives.length, 0);
  assert.equal(model.regionBorders?.size, 0);
});
