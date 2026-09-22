import assert from "node:assert/strict";
import test from "node:test";
import type { Plane } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import {
  computeProvinceTopology,
  connectionKey,
  createProvinceOwnershipModel,
  type ProvinceChamberPrimitive,
  type ProvinceCorridorPrimitive,
} from "../src/geometry";
import { samplePlaneOwnership } from "../src/MapCanvas";
import { connectedRegionLayoutNotice } from "../src/connectedRegions";
import { provinceTerrainVisuals } from "../src/terrainVisuals";

const SPARSE_KINDS = [
  "cave",
  "cavern",
  "cloud",
  "air",
  "underworld",
  "hell",
  "abyss",
  "dream",
  "elemental",
] as const satisfies readonly Plane["kind"][];

function silhouetteFixture(kind: Plane["kind"]): Plane {
  const plane = createDefaultProject(`silhouette-${kind}`).planes[0]!;
  plane.id = `silhouette-${kind}`;
  plane.kind = kind;
  plane.ownershipMode = "sparse";
  plane.width = 1024;
  plane.height = 576;
  plane.wrapX = false;
  plane.wrapY = false;
  const positions: Array<readonly [number, number]> = [[0.5, 0.5]];
  for (let index = 0; index < 12; index += 1) {
    const angle = index / 12 * Math.PI * 2;
    positions.push([0.5 + Math.cos(angle) * 0.19, 0.5 + Math.sin(angle) * 0.34]);
  }
  plane.provinces = plane.provinces.slice(0, positions.length).map((province, owner) => ({
    ...province,
    id: `${kind}-shape-${owner}`,
    index: owner + 1,
    x: positions[owner]![0],
    y: positions[owner]![1],
    gridX: owner,
    gridY: 0,
    terrain: kind === "cave" || kind === "cavern" ? "cave" : "plains",
    terrainFlags: kind === "cave" || kind === "cavern" ? ["cave"] : undefined,
    freshwater: false,
    small: false,
    large: false,
  }));
  plane.provinceTarget = plane.provinces.length;
  plane.edges = [];
  for (let index = 1; index <= 12; index += 1) {
    const next = index === 12 ? 1 : index + 1;
    plane.edges.push({
      id: `${kind}-ring-${index}-${next}`,
      a: plane.provinces[index]!.id,
      b: plane.provinces[next]!.id,
      kind: "standard",
    });
  }
  for (const spoke of [1, 4, 7, 10]) {
    plane.edges.push({
      id: `${kind}-spoke-${spoke}`,
      a: plane.provinces[0]!.id,
      b: plane.provinces[spoke]!.id,
      kind: "standard",
    });
  }
  return plane;
}

function chambers(plane: Plane): ProvinceChamberPrimitive[] {
  return createProvinceOwnershipModel(plane).primitives
    .filter((primitive): primitive is ProvinceChamberPrimitive => primitive.kind === "chamber");
}

function corridors(plane: Plane): ProvinceCorridorPrimitive[] {
  return createProvinceOwnershipModel(plane).primitives
    .filter((primitive): primitive is ProvinceCorridorPrimitive => primitive.kind === "corridor");
}

function aspect(chamber: ProvinceChamberPrimitive): number {
  return Math.max(chamber.radiusX, chamber.radiusY) / Math.min(chamber.radiusX, chamber.radiusY);
}

test("every sparse archetype has a deterministic, internally varied silhouette grammar", () => {
  const byKind = new Map(SPARSE_KINDS.map((kind) => {
    const plane = silhouetteFixture(kind);
    const first = createProvinceOwnershipModel(plane);
    const clone = structuredClone(plane);
    clone.name = `${plane.name} renamed without geometric effect`;
    const second = createProvinceOwnershipModel(clone);
    assert.deepEqual(second.primitives, first.primitives, `${kind} primitives must be stable across equivalent projects`);
    const kindChambers = chambers(plane);
    assert.equal(kindChambers.length, plane.provinces.length);
    assert.ok(new Set(kindChambers.map((chamber) => [
      chamber.radiusX.toFixed(7),
      chamber.radiusY.toFixed(7),
      chamber.rotation.toFixed(7),
      chamber.contourPower,
      chamber.lobeScale.toFixed(7),
    ].join(":"))).size >= 10, `${kind} provinces should not repeat one stamped silhouette`);
    plane.provinces.forEach((province, owner) => assert.equal(first.ownerAt(province.x, province.y), owner));
    return [kind, kindChambers] as const;
  }));

  assert.equal(new Set([...byKind.values()].map((items) => items[0]!.silhouette)).size, SPARSE_KINDS.length);
  assert.ok(byKind.get("underworld")!.filter((item) => item.contourPower === 4).length >= 9, "Underworld rooms should skew boxy/tomb-like");
  for (const kind of SPARSE_KINDS.filter(kind => kind !== "underworld")) {
    const plane = silhouetteFixture(kind);
    const model = createProvinceOwnershipModel(plane);
    assert.equal(connectedRegionLayoutNotice(plane), undefined, `${kind}: compatible layouts use adjoining regions automatically`);
    assert.ok(model.regionBorders?.size, `${kind}: region silhouettes must expose real shared floors`);
    assert.ok(corridors(plane).every(corridor => corridor.halfWidth > 4 / plane.height), `${kind}: passages must be wider than a hairline`);
  }
});

test("flooding connected cave regions preserves their footprint, connections and exact ownership", () => {
  const dry = silhouetteFixture("cave");
  const targetOwner = 2;
  const dryModel = createProvinceOwnershipModel(dry);
  const original = structuredClone(dry);

  const flooded = structuredClone(dry);
  flooded.provinces[targetOwner]!.terrain = "cave";
  flooded.provinces[targetOwner]!.terrainFlags = ["cave", "sea"];
  const floodedModel = createProvinceOwnershipModel(flooded);
  const floodedChamber = floodedModel.primitives[targetOwner] as ProvinceChamberPrimitive;

  assert.notDeepEqual(provinceTerrainVisuals(flooded.provinces[targetOwner]!, "normal"), provinceTerrainVisuals(dry.provinces[targetOwner]!, "normal"), "flooding changes terrain artwork even though ownership stays fixed");
  assert.equal(floodedChamber.silhouette, "cave-chamber");
  assert.equal(floodedChamber.contourPower, 2);
  assert.deepEqual(floodedModel.primitives, dryModel.primitives, "terrain artwork changes must not redraw regional movement geometry");
  assert.deepEqual(floodedModel.regionBorders, dryModel.regionBorders);
  assert.deepEqual(flooded.edges, dry.edges);
  for (let y = 0; y < 83; y++) for (let x = 0; x < 137; x++) {
    assert.equal(floodedModel.ownerAt((x + .5) / 137, (y + .5) / 83), dryModel.ownerAt((x + .5) / 137, (y + .5) / 83));
  }
  assert.deepEqual(dry, original);
  assert.equal(floodedModel.ownerAt(flooded.provinces[targetOwner]!.x, flooded.provinces[targetOwner]!.y), targetOwner);
});

test("Sea+Cave Underworld owners form a smooth Styx band while dry banks remain tomb-like", () => {
  const dry = silhouetteFixture("underworld");
  const dryModel = createProvinceOwnershipModel(dry);
  const waterOwners = [1, 2, 3];
  const pairKey = connectionKey(dry.provinces[1]!.id, dry.provinces[2]!.id);
  const dryWaterLink = corridors(dry).find((item) => item.key === pairKey)!;

  const styx = structuredClone(dry);
  for (const owner of waterOwners) {
    styx.provinces[owner]!.terrain = "cave";
    styx.provinces[owner]!.terrainFlags = ["cave", "sea"];
  }
  const styxModel = createProvinceOwnershipModel(styx);
  const styxChambers = chambers(styx);
  const waterBasin = styxChambers[2]!;
  const dryBank = styxChambers[4]!;
  const styxLink = corridors(styx).find((item) => item.key === pairKey)!;

  assert.notStrictEqual(styxModel, dryModel);
  assert.equal(waterBasin.silhouette, "underworld-styx");
  assert.equal(waterBasin.contourPower, 2);
  assert.equal(waterBasin.lobeScale, 0);
  assert.ok(aspect(waterBasin) >= 1.9, "Styx basins should stretch along their adjacent water links");
  assert.equal(dryBank.silhouette, "underworld-tomb");
  assert.equal(dryBank.contourPower, 4);
  assert.ok(styxLink.halfWidth > dryWaterLink.halfWidth * 1.3);
  for (const owner of waterOwners) {
    const province = styx.provinces[owner]!;
    assert.equal(styxModel.ownerAt(province.x, province.y), owner);
  }
  const from = styx.provinces[1]!;
  const to = styx.provinces[2]!;
  assert.ok(styxModel.ownerAt((from.x + to.x) / 2, (from.y + to.y) / 2) >= 0);
  assert.equal(styxModel.ownerAt(0.02, 0.02), -1);
});

test("adjoining regions retain gaps at unauthored contacts and expose only authored borders", () => {
  for (const kind of SPARSE_KINDS) {
    const plane = silhouetteFixture(kind);
    const ownership = createProvinceOwnershipModel(plane);
    assert.equal(ownership.ownerAt(0.02, 0.02), -1);
    const topology = computeProvinceTopology(plane);
    assert.deepEqual(
      [...topology.pairKeys].sort(),
      plane.edges.map((edge) => connectionKey(edge.a, edge.b)).sort(),
      `${kind} visual variation must not invent movement borders`,
    );
    const edited = structuredClone(plane);
    edited.edges = [];
    const isolated = createProvinceOwnershipModel(edited);
    assert.equal(computeProvinceTopology(edited).pairKeys.size, 0);
    for (const [owner, province] of edited.provinces.entries()) assert.equal(isolated.ownerAt(province.x, province.y), owner);
    // A sampled owner-to-owner adjacency must have an explicit authored link;
    // broad regional floors are allowed to touch only at those links.
    const width = 384, height = 216;
    const raster = samplePlaneOwnership(plane, width, height, ownership);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const owner = raster[y * width + x]!;
      if (owner < 0) continue;
      for (const next of [x + 1 < width ? y * width + x + 1 : -1, y + 1 < height ? (y + 1) * width + x : -1]) {
        if (next < 0 || raster[next]! < 0 || raster[next] === owner) continue;
        assert.ok(topology.pairKeys.has(connectionKey(plane.provinces[owner]!.id, plane.provinces[raster[next]!]!.id)), `${kind}: no unauthored raster contact`);
      }
    }
  }
});

test("elongated chamber ownership follows enabled wrap seams", () => {
  const plane = silhouetteFixture("air");
  plane.wrapX = true;
  plane.provinces = plane.provinces.slice(0, 2).map((province, owner) => ({
    ...province,
    x: owner === 0 ? 0.02 : 0.64,
    y: owner === 0 ? 0.5 : 0.76,
  }));
  plane.edges = [];
  const ownership = createProvinceOwnershipModel(plane);
  assert.equal(ownership.ownerAt(0.999, 0.5), 0);
  assert.equal(ownership.ownerAt(0.02, 0.5), 0);
  assert.equal(ownership.ownerAt(0.5, 0.12), -1);
});

test("3840x2160 sparse sampling uses the varied canonical owner and preserves capital pixels", () => {
  const plane = silhouetteFixture("dream");
  plane.width = 3840;
  plane.height = 2160;
  const ownership = createProvinceOwnershipModel(plane);
  const owners = samplePlaneOwnership(plane, plane.width, plane.height, ownership);
  assert.equal(owners.length, 3840 * 2160);
  let blanks = 0;
  for (const owner of owners) if (owner < 0) blanks += 1;
  assert.ok(blanks > owners.length * 0.55, "high-resolution sparse output should preserve meaningful owner-0 space");
  plane.provinces.forEach((province, owner) => {
    const x = Math.round(province.x * (plane.width - 1));
    const y = Math.round(province.y * (plane.height - 1));
    assert.equal(owners[y * plane.width + x], owner);
  });
});
