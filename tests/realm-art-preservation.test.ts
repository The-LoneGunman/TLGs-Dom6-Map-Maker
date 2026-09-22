import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { compileMapText, encodeD6m, inspectD6m, terrainMask } from "../src/dom6";
import { isBlockedProvince, isWaterProvince, type MapProject, type Plane, type Province } from "../src/domain";
import { ARCHETYPE_PROFILES, createDefaultProject, generatePlane } from "../src/generator";
import { createProvinceOwnershipModel } from "../src/geometry";
import { samplePlaneOwnership } from "../src/MapCanvas";
import { renderRealmRgb } from "../src/realmArt";
import { previewProvinceTerrain, provinceTerrainVisuals } from "../src/terrainVisuals";

const KINDS = ["cave", "cavern", "underworld", "hell", "abyss", "dream", "elemental"] as const;
const CONDITIONS = ["normal", "winter", "forested", "flooded", "wasted", "farmland"] as const;

function digest(bytes: Uint8Array | Int16Array): string {
  return createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");
}

function fixture(kind: typeof KINDS[number], portrait = false): MapProject {
  const seed = `realm-art-preservation:${kind}:${portrait ? "portrait" : "landscape"}`;
  const project = createDefaultProject(seed, { generate: false });
  project.settings.throneCount = 0;
  project.settings.players = 2;
  const template: Plane = { ...project.planes[0]!, id: seed, kind,
    variant: ARCHETYPE_PROFILES[kind].defaultVariant, provinceTarget: 32,
    width: portrait ? 256 : 320, height: portrait ? 320 : 256,
    ownershipMode: "sparse", noGeneratedStarts: true,
    wrapX: kind === "underworld" ? portrait : true,
    wrapY: kind === "underworld" ? !portrait : kind !== "cave",
  };
  project.planes = [generatePlane(template, project.settings, seed, 1, { deferStrategicFeatures: true })];
  project.gates = [];
  return project;
}

function displayedPlane(plane: Plane, condition: typeof CONDITIONS[number]): Plane {
  return { ...plane, provinces: plane.provinces.map(province => ({ ...province, ...previewProvinceTerrain(province, condition) })) };
}

function assertNativeOwners(bytes: Uint8Array, plane: Plane, owners: Int16Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = 34 + plane.provinces.length * 12 + plane.width * plane.height * 2;
  let different = 0;
  for (let pixel = 0; pixel < owners.length; pixel++) {
    if (owners[pixel] !== view.getInt16(offset + pixel * 2, true) - 1) different++;
  }
  assert.equal(different, 0, "art input ownership must match every native D6M ownership pixel");
}

for (const kind of KINDS) test(`${kind}: every art preview leaves native bytes, terrain, guardians, starts and gates intact`, async () => {
  const project = fixture(kind);
  const plane = project.planes[0]!;
  const [mixed, flooded, wall, guarded, start, throne] = plane.provinces;
  Object.assign(mixed!, { terrain: "cave", terrainFlags: ["forest", "farm", "freshwater"], freshwater: true });
  Object.assign(flooded!, { terrain: "cave", terrainFlags: ["sea", "deep", "forest", "highland"] });
  Object.assign(wall!, { terrain: "cavewall", terrainFlags: ["sea", "deep", "forest", "farm", "cave"] });
  Object.assign(guarded!, { defenders: [{ commander: "2844", squads: [{ id: "realm-guard-squad", unit: "566", count: 12 }] }], poptype: 95 });
  Object.assign(start!, { start: true, noStart: false });
  Object.assign(throne!, { throne: "fixed", fixedThrone: "Throne of Earth" });
  project.gates = [{ id: `${kind}-gate`, gateNumber: 713, direction: "bidirectional", endpoints: [
    { planeId: plane.id, provinceId: mixed!.id }, { planeId: plane.id, provinceId: guarded!.id },
  ] }];
  const original = JSON.stringify(project);
  const masks = plane.provinces.map(province => terrainMask(province).toString());
  const mapBefore = compileMapText(project, 0);
  assert.ok(mapBefore.includes(`#start ${start!.index}\r\n`));
  assert.ok(mapBefore.includes(`#gate ${mixed!.index} 713\r\n`));
  assert.ok(mapBefore.includes("#commander 2844\r\n"));
  assert.ok(mapBefore.includes("#units 12 566\r\n"));
  assert.ok(mapBefore.includes('#feature "Throne of Earth"\r\n'));
  const bytesBefore = await encodeD6m(plane, `${project.seed}:native-proof`);
  assert.equal(inspectD6m(bytesBefore).valid, true);
  const ownership = createProvinceOwnershipModel(plane);
  const owners = samplePlaneOwnership(plane, plane.width, plane.height, ownership);
  const ownersBefore = digest(owners);
  assertNativeOwners(bytesBefore, plane, owners);
  assert.ok(owners.includes(-1), "fixture retains unowned space between regions");
  const hashes = new Map<string, string>();
  for (const condition of CONDITIONS) {
    const displayed = displayedPlane(plane, condition);
    const displayedBefore = JSON.stringify(displayed);
    const rgb = renderRealmRgb(displayed, owners, `${project.seed}:paint`);
    assert.equal(rgb.length, plane.width * plane.height * 3);
    hashes.set(condition, digest(rgb));
    assert.equal(JSON.stringify(displayed), displayedBefore, `${condition}: renderer must not rewrite transformed input`);
    assert.equal(digest(owners), ownersBefore, `${condition}: artwork never changes playable footprints`);
    assert.equal(JSON.stringify(project), original, `${condition}: source gameplay content remains intact`);
    assert.equal(provinceTerrainVisuals(displayed.provinces[2]!).base, "cavewall", `${condition}: CaveWall stays blocked`);
  }
  assert.equal(hashes.get("normal"), hashes.get("winter"), "outer-realm winter previews must not invent snow");
  assert.equal(compileMapText(project, 0), mapBefore, "preview leaves every native directive unchanged");
  assert.deepEqual(await encodeD6m(plane, `${project.seed}:native-proof`), bytesBefore, "preview leaves D6M bytes unchanged");
  assert.deepEqual(plane.provinces.map(province => terrainMask(province).toString()), masks);
  assert.equal(JSON.stringify(project), original);
});

function componentCount(plane: Plane, accepts: (province: Province) => boolean, omitBridges = false): number {
  const remaining = new Set(plane.provinces.filter(accepts).map(province => province.id));
  const adjacency = new Map([...remaining].map(id => [id, [] as string[]]));
  for (const edge of plane.edges) {
    if (edge.kind === "impassable" || (omitBridges && edge.kind === "bridge") || !adjacency.has(edge.a) || !adjacency.has(edge.b)) continue;
    adjacency.get(edge.a)!.push(edge.b);
    adjacency.get(edge.b)!.push(edge.a);
  }
  let components = 0;
  while (remaining.size) {
    const queue = [remaining.values().next().value!];
    remaining.delete(queue[0]!);
    components++;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const neighbor of adjacency.get(queue[cursor]!)!) if (remaining.delete(neighbor)) queue.push(neighbor);
    }
  }
  return components;
}

for (const portrait of [false, true]) test(`Underworld art preserves the ${portrait ? "north/south" : "east/west"} Styx and both banks`, async () => {
  const project = fixture("underworld", portrait);
  const plane = project.planes[0]!;
  const owners = samplePlaneOwnership(plane, plane.width, plane.height);
  const before = owners.slice();
  const graphBefore = JSON.stringify(plane.edges);
  const nativeBefore = await encodeD6m(plane, project.seed);
  const waterOwners = new Set(plane.provinces.flatMap((province, owner) => isWaterProvince(province) ? [owner] : []));
  assert.equal(componentCount(plane, province => isWaterProvince(province) && !isBlockedProvince(province)), 1);
  assert.equal(componentCount(plane, province => !isWaterProvince(province) && !isBlockedProvince(province), true), 2);
  assert.ok(plane.edges.some(edge => edge.kind === "bridge"), "retain an explicit crossing without merging dry banks");
  for (const high of [false, true]) {
    const edge = Array.from({ length: portrait ? plane.width : plane.height }, (_, coordinate) =>
      owners[portrait ? (high ? plane.height - 1 : 0) * plane.width + coordinate
        : coordinate * plane.width + (high ? plane.width - 1 : 0)]!);
    assert.ok(edge.some(owner => waterOwners.has(owner)), "Styx water reaches both opposite map boundaries");
    assert.ok(edge.every(owner => owner < 0 || waterOwners.has(owner)), "dry geometry cannot go around either end of the Styx");
  }
  for (const condition of CONDITIONS) renderRealmRgb(displayedPlane(plane, condition), owners, "styx-preservation");
  assert.deepEqual(owners, before);
  assert.equal(JSON.stringify(plane.edges), graphBefore);
  assert.deepEqual(await encodeD6m(plane, project.seed), nativeBefore);
});

test("CaveWall art wins conflicting Sea/Cave/cover flags on every realm; flooded caves remain water-colored", () => {
  for (const kind of KINDS) {
    const plane = fixture(kind).planes[0]!;
    plane.width = plane.height = 256;
    plane.provinces = [plane.provinces[0]!];
    plane.edges = [];
    const province = plane.provinces[0]!;
    const owners = new Int16Array(256 * 256);
    Object.assign(province, { terrain: "cavewall", terrainFlags: [], freshwater: false });
    const wall = digest(renderRealmRgb(plane, owners, "precedence"));
    Object.assign(province, { terrain: "sea", terrainFlags: ["cavewall", "cave", "forest", "farm", "waste", "swamp", "mountains", "deep"], freshwater: true });
    for (const condition of CONDITIONS) {
      assert.equal(digest(renderRealmRgb(displayedPlane(plane, condition), owners, "precedence")), wall, `${kind}/${condition}: sealed rock overrides conflicting flags`);
    }
    Object.assign(province, { terrain: "cave", terrainFlags: ["sea", "deep", "forest"], freshwater: false });
    const flooded = renderRealmRgb(plane, owners, "precedence");
    let red = 0, blue = 0;
    for (let pixel = 0; pixel < owners.length; pixel++) { red += flooded[pixel * 3]!; blue += flooded[pixel * 3 + 2]!; }
    assert.ok(blue > red * 1.15, `${kind}: Sea+Deep+Cave must remain visibly aquatic, including infernal realms`);
    assert.equal(digest(renderRealmRgb(displayedPlane(plane, "farmland"), owners, "precedence")), digest(flooded), `${kind}: farmland preview does not replace cave/sea cover`);
  }
});

test("additive water terrain indicators remain visible, aquatic, owner-clipped and native-byte neutral", async () => {
  const flags = ["forest", "deep", "cave", "mountains", "highland", "farm", "swamp", "waste", "freshwater"] as const;
  for (const kind of KINDS) {
    const plane = fixture(kind).planes[0]!;
    const province = plane.provinces[0]!;
    Object.assign(province, { terrain: "sea", terrainFlags: [], freshwater: false });
    const owners = samplePlaneOwnership(plane, plane.width, plane.height);
    const ownerSnapshot = digest(owners);
    const baseline = renderRealmRgb(plane, owners, "additive-water-indicators");
    for (const flag of flags) {
      province.terrainFlags = [flag];
      const source = JSON.stringify(plane);
      const nativeBefore = await encodeD6m(plane, "additive-water-native");
      const actual = renderRealmRgb(plane, owners, "additive-water-indicators");
      let changed = 0, leaked = 0, red = 0, blue = 0;
      for (let pixel = 0; pixel < owners.length; pixel++) {
        const at = pixel * 3;
        const differs = actual[at] !== baseline[at] || actual[at + 1] !== baseline[at + 1] || actual[at + 2] !== baseline[at + 2];
        if (owners[pixel] === 0) {
          if (differs) changed++;
          red += actual[at]!;
          blue += actual[at + 2]!;
        } else if (differs) leaked++;
      }
      assert.ok(changed > 0, `${kind}/Sea+${flag}: retain a visible indicator for the additive terrain flag`);
      assert.equal(leaked, 0, `${kind}/Sea+${flag}: the indicator must not leak into other owners or unowned space`);
      assert.ok(blue > red * 1.15, `${kind}/Sea+${flag}: the province must remain visibly aquatic`);
      assert.equal(digest(owners), ownerSnapshot);
      assert.equal(JSON.stringify(plane), source);
      assert.deepEqual(await encodeD6m(plane, "additive-water-native"), nativeBefore, `${kind}/Sea+${flag}: painting cannot alter current native bytes`);
    }
  }
});
