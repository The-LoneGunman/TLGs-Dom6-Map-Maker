import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Plane, PlaneKind } from "../src/domain";
import { buildConnectedRegionPlan, connectedRegionLayoutNotice, createConnectedRegionOwnership } from "../src/connectedRegions";
import { encodeD6m, inspectD6m } from "../src/dom6";
import { addPlane, adjacencyFor, createDefaultProject, generatePlane, generateProject, shortestDistances } from "../src/generator";
import { computeProvinceTopology, connectionKey, createProvinceOwnershipModel } from "../src/geometry";
import { compileImageOwnership, imageProvinceNumbers, sampleIllustratedOwnership } from "../src/illustratedMap";
import { samplePlaneOwnership } from "../src/MapCanvas";

function fixture(kind: PlaneKind, seed = "cloud-landforms-0", count = 64, width = 512, height = 384,
  wrapX = false, wrapY = false): Plane {
  const project = createDefaultProject(seed, { generate: false });
  const source: Plane = { ...project.planes[0]!, id: `${seed}${kind}`, kind, ownershipMode: "sparse",
    provinceTarget: count, width, height, wrapX, wrapY, noGeneratedStarts: true };
  return generatePlane(source, project.settings, `${seed}${kind}`, 1, { deferStrategicFeatures: true });
}

function neighbours(plane: Plane, pixel: number): readonly number[] {
  const x = pixel % plane.width, y = Math.floor(pixel / plane.width);
  return [
    x > 0 ? pixel - 1 : plane.wrapX ? pixel + plane.width - 1 : -1,
    x < plane.width - 1 ? pixel + 1 : plane.wrapX ? pixel - plane.width + 1 : -1,
    y > 0 ? pixel - plane.width : plane.wrapY ? pixel + (plane.height - 1) * plane.width : -1,
    y < plane.height - 1 ? pixel + plane.width : plane.wrapY ? x : -1,
  ];
}

/** Inspect actual native-resolution pixels, not the declared topology alone. */
function auditMask(plane: Plane, owners = samplePlaneOwnership(plane, plane.width, plane.height)) {
  const contacts = new Set<string>(), seen = new Uint8Array(owners.length), queue = new Uint32Array(owners.length);
  const components = Array.from({ length: plane.provinces.length }, () => [] as number[]);
  const floorDepth = new Uint16Array(owners.length);
  let occupied = 0, boundaryCount = 0;
  for (let pixel = 0; pixel < owners.length; pixel++) {
    const owner = owners[pixel]!;
    if (owner < 0) continue;
    occupied++;
    let boundary = false;
    for (const next of neighbours(plane, pixel)) {
      const other = next < 0 ? -1 : owners[next]!;
      if (other !== owner) boundary = true;
      if (other >= 0 && other !== owner) contacts.add(connectionKey(plane.provinces[owner]!.id, plane.provinces[other]!.id));
    }
    if (boundary) { floorDepth[pixel] = 1; queue[boundaryCount++] = pixel; }
  }
  // Distance in four-connected owned pixels to the closest footprint boundary.
  for (let cursor = 0; cursor < boundaryCount; cursor++) {
    const pixel = queue[cursor]!, owner = owners[pixel]!;
    for (const next of neighbours(plane, pixel)) if (next >= 0 && owners[next] === owner && floorDepth[next] === 0) {
      floorDepth[next] = floorDepth[pixel]! + 1;
      queue[boundaryCount++] = next;
    }
  }
  for (let pixel = 0; pixel < owners.length; pixel++) {
    const owner = owners[pixel]!;
    if (owner < 0 || seen[pixel]) continue;
    seen[pixel] = 1; queue[0] = pixel;
    let length = 1;
    for (let cursor = 0; cursor < length; cursor++) {
      for (const next of neighbours(plane, queue[cursor]!)) if (next >= 0 && !seen[next] && owners[next] === owner) {
        seen[next] = 1; queue[length++] = next;
      }
    }
    components[owner]!.push(length);
  }
  return { owners, contacts, components, floorDepth, occupied };
}

function assertFaithfulMask(plane: Plane, audit: ReturnType<typeof auditMask>, requireConnected = true) {
  const expected = new Set(plane.edges.map(edge => connectionKey(edge.a, edge.b)));
  assert.deepEqual([...audit.contacts].sort(), [...expected].sort(), "visible contacts must exactly match movement links");
  for (const [owner, province] of plane.provinces.entries()) {
    const pixel = Math.round(province.y * (plane.height - 1)) * plane.width + Math.round(province.x * (plane.width - 1));
    assert.equal(audit.owners[pixel], owner, `${province.index}: center ownership must survive quantization`);
    if (requireConnected) assert.equal(audit.components[owner]!.length, 1,
      `${province.index}: detached footprint components ${audit.components[owner]}`);
  }
}

for (const kind of ["cloud", "air"] as const) for (let seed = 0; seed < 2; seed++) {
  test(`${kind}/${seed}: broad adjoining island groups retain usable passage provinces and visible sky`, () => {
    const plane = fixture(kind, `cloud-landforms-${seed}`), before = JSON.stringify(plane);
    const plan = buildConnectedRegionPlan(plane), topology = computeProvinceTopology(plane), audit = auditMask(plane);
    assert.equal(connectedRegionLayoutNotice(plane), undefined, "normal sky landforms should not need compatibility shapes");
    assert.ok(createConnectedRegionOwnership(plane));
    assertFaithfulMask(plane, audit);
    assert.ok(plan.groups.length >= 3 && plan.groups.every(group => group.length >= 3), "islands group several neighboring provinces");
    assert.ok(plan.passageOwners.size >= 2, "representative skies should include real passage provinces between groups");
    const fill = audit.occupied / audit.owners.length;
    // Broad aesthetic guardrails, not exact pixels or a mandated island outline.
    assert.ok(fill > .55 && fill < .90, `retain substantial landforms and open sky; occupied fraction ${fill}`);
    const frontiers = plan.regionPairs.map(pair => (topology.sharedBorders.get(pair.key) ?? [])
      .reduce((sum, segment) => sum + Math.hypot((segment.to.x - segment.from.x) * plan.aspect, segment.to.y - segment.from.y), 0))
      .sort((a, b) => a - b);
    const medianFrontier = frontiers[Math.floor(frontiers.length / 2)]!;
    assert.ok(medianFrontier > plan.spacing * .4, "typical grouped provinces must meet along a broad frontier, not a thin tunnel");
    const adjacency = adjacencyFor(plane, { traversableOnly: true });
    assert.equal(shortestDistances(adjacency, plane.provinces[0]!.id).size, plane.provinces.length);
    let interGroupPassages = 0;
    for (const owner of plan.passageOwners) {
      const province = plane.provinces[owner]!, linked = adjacency.get(province.id)!;
      const pixel = Math.round(province.y * (plane.height - 1)) * plane.width + Math.round(province.x * (plane.width - 1));
      assert.ok(audit.floorDepth[pixel]! >= Math.max(2, Math.floor(plan.localSpacings[owner]! * plane.height * .1)),
        `${province.index}: a passage must have usable owned floor around its center, not a one-pixel channel`);
      assert.ok(linked.length >= 2, "passage provinces must link onward rather than becoming decorative dead ends");
      const linkedGroups = new Set(linked.map(id => plan.groupByOwner[plane.provinces.findIndex(p => p.id === id)]!).filter(group => group >= 0));
      if (linkedGroups.size >= 2) interGroupPassages++;
    }
    assert.ok(interGroupPassages > 0, "some real passage provinces directly connect distinct neighboring island groups");
    assert.equal(JSON.stringify(plane), before, "sampling landforms cannot mutate geography, content, or links");
  });
}

for (const kind of ["cloud", "air"] as const) {
  test(`${kind}: sky-specific contours vary their axes and use flared, curved passage paths`, () => {
    const plane = fixture(kind), model = createProvinceOwnershipModel(plane);
    const chambers = model.primitives.filter(primitive => primitive.kind === "chamber");
    assert.equal(chambers.length, plane.provinces.length);
    assert.ok(chambers.some(chamber => chamber.radiusX / chamber.radiusY > 1.1), "sky landforms must not all retain circular chamber profiles");
    assert.ok(new Set(chambers.map(chamber => Math.round(chamber.rotation * 100))).size > 3, "several island orientations provide shape variation");
    const passages = model.primitives.filter(primitive => primitive.kind === "corridor");
    assert.ok(passages.some(passage => (passage.path?.length ?? 0) > 3), "sky routes carry an actual sweep rather than a straight tube");
    assert.ok(passages.some(passage => {
      const widths = passage.halfWidths ?? [passage.halfWidth];
      return Math.max(...widths) > Math.min(...widths) * 1.04;
    }), "passage widths vary smoothly along their route");
    assert.ok(passages.some(passage => {
      const points = passage.path ?? [], first = points[0], last = points.at(-1);
      return first && last && points.some(point => Math.abs((point.x - first.x) * (last.y - first.y)
        - (point.y - first.y) * (last.x - first.x)) > 1e-9);
    }), "at least one route must visibly bend, not merely split a straight line into more segments");
  });
}

for (const [kind, label, count, width, height, wrapX, wrapY] of [
  ["cloud", "minimum-eight", 8, 256, 256, false, false],
  ["cloud", "dense-minimum-wrap-x", 80, 256, 256, true, false],
  ["air", "portrait-wrap-y", 64, 256, 512, false, true],
  ["cloud", "torus", 96, 512, 384, true, true],
  ["air", "wide", 80, 1024, 256, true, false],
  ["cloud", "tall", 80, 256, 1024, false, true],
] as const) {
  test(`${kind}/${label}: sky footprints stay connected with exact contacts across density and wrapping`, () => {
    const plane = fixture(kind, `cloud-landforms-${label}`, count, width, height, wrapX, wrapY);
    const before = JSON.stringify(plane);
    assert.equal(connectedRegionLayoutNotice(plane), undefined);
    assertFaithfulMask(plane, auditMask(plane));
    assert.equal(JSON.stringify(plane), before);
    assert.equal(plane.provinces.length, count);
  });
}

for (const kind of ["cloud", "air"] as const) {
  test(`${kind}: editor, native D6M, illustrated owners and serialized click areas agree pixel-for-pixel`, async () => {
    const plane = fixture(kind, "cloud-landforms-exports", 40, 384, 256, true, true), before = JSON.stringify(plane);
    const editor = samplePlaneOwnership(plane, plane.width, plane.height);
    const images = await sampleIllustratedOwnership(plane);
    assert.deepEqual(images, editor);
    const d6m = await encodeD6m(plane, "cloud-landforms-native"), header = inspectD6m(d6m);
    assert.equal(header.provinceCount, plane.provinces.length);
    const offset = 34 + plane.provinces.length * 12 + plane.width * plane.height * 2;
    const binary = new DataView(d6m.buffer, d6m.byteOffset, d6m.byteLength);
    for (let pixel = 0; pixel < editor.length; pixel++) {
      assert.equal(binary.getInt16(offset + pixel * 2, true) - 1, editor[pixel], `D6M owner mismatch at pixel ${pixel}`);
    }
    const numbers = imageProvinceNumbers(plane), ownerByNumber = new Map(plane.provinces.map((province, owner) => [numbers.get(province.id)!, owner]));
    const reconstructed = new Int16Array(editor.length).fill(-1);
    for (const line of compileImageOwnership(plane, images, numbers).trim().split(/\r?\n/)) {
      const match = /^#pb (\d+) (\d+) (\d+) (\d+)$/.exec(line);
      assert.ok(match, `invalid ownership run ${line}`);
      const [x, y, length, number] = match.slice(1).map(Number) as [number, number, number, number];
      assert.ok(x >= 0 && y >= 0 && y < plane.height && length > 0 && x + length <= plane.width);
      assert.ok(ownerByNumber.has(number));
      const start = (plane.height - 1 - y) * plane.width + x;
      reconstructed.fill(ownerByNumber.get(number)!, start, start + length);
    }
    assert.deepEqual(reconstructed, editor, "exported click areas must preserve both landforms and unowned sky gaps");
    assertFaithfulMask(plane, auditMask(plane, reconstructed));
    assert.equal(JSON.stringify(plane), before);
  });
}

test("sky contour caches ignore content edits, while removing a link removes its visible frontier", () => {
  const plane = fixture("cloud", "cloud-landforms-edits"), plan = buildConnectedRegionPlan(plane);
  const first = createProvinceOwnershipModel(plane), original = samplePlaneOwnership(plane, plane.width, plane.height, first);
  plane.provinces[0]!.population = 4321;
  plane.provinces[0]!.terrain = "forest";
  plane.provinces[0]!.terrainFlags = ["cave", "sea"];
  plane.provinces[0]!.start = true;
  plane.provinces[0]!.defenders = [{ commander: "614", squads: [{ id: "sky-test-squad", unit: "205", count: 5 }] }];
  assert.equal(createProvinceOwnershipModel(plane), first);
  assert.equal(buildConnectedRegionPlan(plane), plan);
  assert.deepEqual(samplePlaneOwnership(plane, plane.width, plane.height), original);
  const removed = plane.edges.pop()!, snapshot = JSON.stringify(plane);
  assert.equal(buildConnectedRegionPlan(plane), plan, "the group plan is geometry-only, not recalculated from gameplay links");
  assert.equal(connectedRegionLayoutNotice(plane), undefined);
  const changed = auditMask(plane);
  assert.equal(changed.contacts.has(connectionKey(removed.a, removed.b)), false);
  assertFaithfulMask(plane, changed);
  assert.equal(JSON.stringify(plane), snapshot);
});

test("wrapped Air start-basin doorways near wall junctions retain their native-pixel frontiers", () => {
  let project = createDefaultProject("region-corpus-air-2", { generate: false });
  Object.assign(project.settings, { players: 4, provincesPerPlayer: 16, throneCount: 4, startDegreeTarget: 4,
    startDistribution: { land: 2, coastal: 0, water: 0, cave: 0, other: 2 } });
  project.planes[0]!.autoSize = false;
  project.planes[0]!.provinceTarget = 64;
  project = addPlane(project, "air", { generate: false, autoSize: false, provinceTarget: 64 });
  Object.assign(project.planes[1]!, { width: 768, height: 512, wrapX: true, wrapY: true });
  const generated = generateProject(project), plane = generated.planes[1]!, before = JSON.stringify(generated);
  // The first sky refinement closed one short frontier in this real repaired
  // start layout. A fallback would hide the loss of the new shape style.
  assert.equal(connectedRegionLayoutNotice(plane), undefined, "coastal setbacks must not swallow usable doorways beside wall junctions");
  assertFaithfulMask(plane, auditMask(plane));
  const adjacency = adjacencyFor(plane, { traversableOnly: true });
  const starts = plane.provinces.filter(province => province.start);
  assert.equal(starts.length, 2);
  for (const start of starts) assert.ok((adjacency.get(start.id)?.length ?? 0) >= 4);
  assert.equal(JSON.stringify(generated), before);
});

test("over-dense cloud maps retain the exact movement graph or explicitly disclose compatibility geometry", () => {
  const plane = fixture("cloud", "cloud-landforms-overdense", 800, 256, 256, true, true), before = JSON.stringify(plane);
  const notice = connectedRegionLayoutNotice(plane), audit = auditMask(plane);
  if (notice) {
    assert.match(notice, /Compatibility geometry is retained/);
    assert.match(notice, /resolution|density|centres/);
    assert.equal(createConnectedRegionOwnership(plane), undefined);
  }
  assertFaithfulMask(plane, audit, notice === undefined);
  assert.equal(JSON.stringify(plane), before, "a rendering fallback cannot silently rewrite the user's map");
});

for (const [kind, digest] of [
  ["cave", "58ab6f394f071d4d072cbf41af1924e3b49927c75cf17d1444a21a869239241e"],
  ["underworld", "010c6a1e63dd4fe488e5456784baffe10ef99454184015d3ea9fffcbdcdf600e"],
] as const) {
  test(`${kind}: saved pre-natural-style maps retain the pre-change ownership snapshot`, () => {
    const plane = fixture(kind, "cloud-landforms-nonsky", 40, 256, 256);
    delete plane.landformStyle;
    delete plane.generationKey; // A saved historical map predates portable art provenance too.
    const owners = samplePlaneOwnership(plane, plane.width, plane.height);
    // Captured before the cloud-specific refinement; text avoids host endianness.
    assert.equal(createHash("sha256").update(owners.join(",")).digest("hex"), digest);
  });
}
