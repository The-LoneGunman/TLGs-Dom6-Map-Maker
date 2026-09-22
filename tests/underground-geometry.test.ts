import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Plane } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import { computeProvinceTopology, connectionKey, createProvinceOwnershipModel, type ProvinceChamberPrimitive, type ProvinceCorridorPrimitive } from "../src/geometry";
import { connectedRegionLayoutNotice } from "../src/connectedRegions";
import savedOwnershipPlane from "./fixtures/legacy-ownership-plane.json";

const undergroundKinds = ["cave", "cavern", "underworld", "hell", "abyss"] as const;
const source = createDefaultProject("organic-underground-regression").planes[0]!;
function fixture(kind: Plane["kind"], width = 1024, height = 768, side = 4): Plane {
  const plane = structuredClone(source);
  plane.id = `organic-${kind}-${side}`;
  plane.kind = kind;
  plane.ownershipMode = "sparse";
  plane.width = width;
  plane.height = height;
  plane.wrapX = false;
  plane.wrapY = false;
  plane.provinces = Array.from({ length: side * side }, (_, owner) => ({
    ...structuredClone(source.provinces[owner % source.provinces.length]!),
    id: `organic-${owner}`, index: owner + 1,
    x: (owner % side + 0.6) / (side + 0.2), y: (Math.floor(owner / side) + 0.6) / (side + 0.2),
    terrain: "cave", terrainFlags: undefined, freshwater: false,
    small: false, large: false,
  }));
  plane.provinceTarget = plane.provinces.length;
  plane.edges = [];
  for (let owner = 0; owner < plane.provinces.length; owner++) {
    if (owner % side < side - 1) plane.edges.push({ id: `horizontal-${owner}`, a: plane.provinces[owner]!.id, b: plane.provinces[owner + 1]!.id, kind: "standard" });
    if (owner % side === 0 && owner + side < plane.provinces.length) plane.edges.push({ id: `vertical-${owner}`, a: plane.provinces[owner]!.id, b: plane.provinces[owner + side]!.id, kind: "standard" });
  }
  return plane;
}

for (const kind of undergroundKinds) test(`${kind}: organic geometry is deterministic and preserves every authored gameplay field`, () => {
  const plane = fixture(kind);
  const before = JSON.stringify(plane);
  const model = createProvinceOwnershipModel(plane);
  const chambers = model.primitives.filter((p): p is ProvinceChamberPrimitive => p.kind === "chamber");
  const corridors = model.primitives.filter((p): p is ProvinceCorridorPrimitive => p.kind === "corridor");
  assert.equal(chambers.length, plane.provinces.length);
  assert.equal(corridors.length, plane.edges.length);
  if (kind === "underworld") {
    assert.ok(chambers.every(p => p.organicPower !== undefined && p.outlineWaves));
    assert.ok(new Set(chambers.map(p => p.organicPower!.toFixed(5))).size > chambers.length * .8);
  } else {
    assert.equal(connectedRegionLayoutNotice(plane), undefined);
    assert.equal(model.regionBorders?.size, plane.edges.length, "every compatible authored edge has a broad regional frontier");
    assert.ok(new Set(chambers.map(p => p.radius.toFixed(5))).size > chambers.length * .8, "regional floors vary in size");
  }
  assert.ok(corridors.filter(p => p.path).length >= corridors.length * .8, "passages retain explicit routes between their floors");
  const copy = structuredClone(plane);
  copy.edges.reverse();
  assert.deepEqual(createProvinceOwnershipModel(copy).primitives, model.primitives);
  assert.equal(JSON.stringify(plane), before);
  assert.deepEqual([...computeProvinceTopology(plane).pairKeys].sort(), plane.edges.map(e => connectionKey(e.a, e.b)).sort());
  for (const [owner, province] of plane.provinces.entries()) assert.equal(model.ownerAt(province.x, province.y), owner);
  assert.equal(model.ownerAt(.01, .01), -1);
});

test("regional passages keep exact endpoints and a continuous route through a broad shared frontier", () => {
  const plane = fixture("hell");
  const model = createProvinceOwnershipModel(plane);
  const topology = computeProvinceTopology(plane);
  for (const corridor of model.primitives) {
    if (corridor.kind !== "corridor" || !corridor.path) continue;
    assert.deepEqual(corridor.path[0], corridor.from);
    assert.deepEqual(corridor.path.at(-1), corridor.to);
    assert.ok(corridor.path.length >= 3, "the route includes an interior shared-frontier point");
    assert.ok(corridor.halfWidth > 4 / plane.height, "a passage must have a substantial traversable width");
    assert.ok(corridor.halfWidths!.every(width => Number.isFinite(width) && width > 0));
    for (let segment = 0; segment < corridor.path.length - 1; segment++) {
      const a = corridor.path[segment]!, b = corridor.path[segment + 1]!;
      for (let step = 0; step <= 24; step++) {
        const t = step / 24;
        assert.ok(corridor.owners.includes(model.ownerAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)), "path samples must belong to an endpoint owner");
      }
    }
    for (const border of topology.sharedBorders.get(corridor.key) ?? []) {
      for (let step = 1; step < 10; step++) {
        const t = step / 10;
        assert.ok(corridor.owners.includes(model.ownerAt(border.from.x + (border.to.x - border.from.x) * t, border.from.y + (border.to.y - border.from.y) * t)), "special-border marks must stay inside the canonical passage");
      }
    }
  }
});

test("close unrelated passages retain a visible gap instead of acquiring a false junction", () => {
  const plane = fixture("hell");
  const positions = [[.18, .48], [.82, .48], [.18, .52], [.82, .52]] as const;
  plane.provinces = plane.provinces.slice(0, 4).map((p, i) => ({ ...p, x: positions[i]![0], y: positions[i]![1] }));
  plane.edges = [{ id: "upper", a: plane.provinces[0]!.id, b: plane.provinces[1]!.id, kind: "standard" },
    { id: "lower", a: plane.provinces[2]!.id, b: plane.provinces[3]!.id, kind: "standard" }];
  const model = createProvinceOwnershipModel(plane);
  for (let step = 0; step <= 100; step++) assert.equal(model.ownerAt(.2 + .6 * step / 100, .5), -1);
  assert.equal(computeProvinceTopology(plane).pairs.length, 2);
});

test("high-density and extreme-aspect underground chambers remain bounded with owned capitals", () => {
  for (const [width, height, side] of [[256, 256, 12], [256, 256, 28], [2048, 256, 8], [256, 2048, 8], [3840, 2160, 6]] as const) {
    const plane = fixture("cavern", width, height, side);
    const model = createProvinceOwnershipModel(plane);
    const chambersOnly = createProvinceOwnershipModel({ ...plane, edges: [] });
    for (const [owner, province] of plane.provinces.entries()) assert.equal(model.ownerAt(province.x, province.y), owner);
    for (const chamber of model.primitives) {
      if (chamber.kind !== "chamber") continue;
      assert.ok(chamber.radius > 0 && Number.isFinite(chamber.radius));
      for (let step = 0; step < 32; step++) {
        const angle = step / 32 * Math.PI * 2;
        const x = chamber.center.x + Math.cos(angle) * chamber.radius * 1.01 / model.metricAspect;
        const y = chamber.center.y + Math.sin(angle) * chamber.radius * 1.01;
        // Removing corridors cannot enlarge these rooms: all degree-based hubs
        // either remain the same size or shrink, while local spacing is retained.
        assert.notEqual(chambersOnly.ownerAt(x, y), chamber.owner, "organic outline must remain inside its conservative bound");
      }
    }
    let voidPixels = 0;
    for (let y = 0; y < 37; y++) for (let x = 0; x < 71; x++) if (model.ownerAt((x + .5) / 71, (y + .5) / 37) < 0) voidPixels++;
    assert.ok(voidPixels > 71 * 37 * .2);
  }
});

test("organic wrap passages use the shortest image and remain continuous across both seam axes", () => {
  for (const axis of ["x", "y"] as const) {
    const plane = fixture("abyss", 512, 512);
    plane.wrapX = axis === "x";
    plane.wrapY = axis === "y";
    plane.provinces = plane.provinces.slice(0, 2).map((p, i) => ({ ...p, x: axis === "x" ? i ? .97 : .03 : .5, y: axis === "y" ? i ? .97 : .03 : .5 }));
    plane.edges = [{ id: "seam", a: plane.provinces[0]!.id, b: plane.provinces[1]!.id, kind: "standard" }];
    const model = createProvinceOwnershipModel(plane);
    assert.ok(model.ownerAt(axis === "x" ? .001 : .5, axis === "y" ? .001 : .5) >= 0);
    assert.ok(model.ownerAt(axis === "x" ? .999 : .5, axis === "y" ? .999 : .5) >= 0);
    assert.equal(model.ownerAt(.5, .1), -1);
    assert.ok([...computeProvinceTopology(plane).sharedBorders.values()].flat().length > 0);
  }
});

test("Styx water tubes and explicit dry bridge crossings retain their original straight grammar", () => {
  const plane = fixture("underworld");
  plane.provinces[0]!.terrainFlags = ["sea", "cave"];
  plane.provinces[1]!.terrainFlags = ["sea", "cave"];
  const bridge = plane.edges.find(e => e.a === plane.provinces[4]!.id && e.b === plane.provinces[5]!.id)!;
  bridge.kind = "bridge";
  const model = createProvinceOwnershipModel(plane);
  for (const corridor of model.primitives) {
    if (corridor.kind !== "corridor") continue;
    if (corridor.owners.includes(0) || corridor.owners.includes(1) || corridor.key === connectionKey(bridge.a, bridge.b)) {
      assert.equal(corridor.path, undefined);
      assert.equal(corridor.halfWidths, undefined);
    }
  }
  const waterChamber = model.primitives.find(p => p.kind === "chamber" && p.owner === 0)!;
  assert.ok(waterChamber.kind === "chamber" && waterChamber.organicPower === undefined && waterChamber.outlineWaves === undefined);
});

test("authoring an Underworld bridge invalidates cached curves, including combined special masks", () => {
  const plane = fixture("underworld");
  const first = createProvinceOwnershipModel(plane);
  const passage = first.primitives.find((p): p is ProvinceCorridorPrimitive => p.kind === "corridor" && !!p.path)!;
  assert.ok(passage);
  const edge = plane.edges.find(e => connectionKey(e.a, e.b) === passage.key)!;
  for (const kind of ["bridge", "custom"] as const) {
    edge.kind = kind;
    edge.special = kind === "custom" ? 16 | 32 : undefined;
    const next = createProvinceOwnershipModel(plane);
    assert.notEqual(next, first);
    const protectedCrossing = next.primitives.find(p => p.kind === "corridor" && p.key === passage.key)!;
    assert.ok(protectedCrossing.kind === "corridor" && protectedCrossing.path === undefined);
  }
});

const unaffectedDigests: Partial<Record<Plane["kind"], string>> = {
  surface: "dea643edc7552f7002ca8d20ccd49c3fe1193263b181f025d18cc93cf1b8b161",
  custom: "dea643edc7552f7002ca8d20ccd49c3fe1193263b181f025d18cc93cf1b8b161",
  cloud: "b2bf51903c15ab0b5e260dbb20e2a4affdffc2cd0294b17528661a119b5a0e25",
  air: "f1904eeb67bc6b3f04f8240e25272c21f01e5d37b420fe78e0cff5343e792b79",
  dream: "caa5a4a2db57f9ee796a820807040a7abe9b3894251b11c2d6a393232cbac2bd",
  elemental: "2865e2bcde4180aa3c291eb0bbbf8ceb5b7c6e8f08b00f9508795fc75191a326",
};
test("solid and incompatible authored-map compatibility geometry retain their frozen digests", () => {
  for (const [kind, expected] of Object.entries(unaffectedDigests)) {
    // Frozen pre-natural input, not regenerated through the newer biome sampler.
    // Its original ownership hashes below must remain unchanged.
    const plane = structuredClone(savedOwnershipPlane) as Plane;
    plane.kind = kind as Plane["kind"];
    plane.id = `unaffected-${kind}`;
    if (kind !== "surface" && kind !== "custom") {
      plane.ownershipMode = "sparse";
      assert.match(connectedRegionLayoutNotice(plane) ?? "", /nonlocal authored links/, "old overland graph intentionally exercises the warned compatibility path");
    }
    const model = createProvinceOwnershipModel(plane), owners: number[] = [];
    for (let y = 0; y < 47; y++) for (let x = 0; x < 83; x++) owners.push(model.ownerAt((x + .5) / 83, (y + .5) / 47));
    assert.equal(createHash("sha256").update(JSON.stringify([model.primitives, owners])).digest("hex"), expected, kind);
  }
});
