import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { compileMapText, encodeD6m, inspectD6m, terrainMask, TERRAIN_BITS, validateProject } from "../src/dom6";
import { cloneProject, effectiveProvinceTerrainFlags, isBlockedProvince, isWaterProvince, setNationSpecificStart, type MapProject, type Plane, type Province } from "../src/domain";
import { ARCHETYPE_PROFILES, createDefaultProject, generateProject } from "../src/generator";
import { computeProvinceTopology, connectionKey, createProvinceOwnershipModel } from "../src/geometry";
import { protectedProvinceKeys } from "../src/iteration";
import { provinceAtOwnershipPoint, samplePlaneOwnership } from "../src/MapCanvas";
import { provinceTerrainVisuals, winterPreviewStrength } from "../src/terrainVisuals";

const UNDERGROUND_KINDS = ["cave", "cavern", "underworld", "hell", "abyss"] as const;
const CASES = [
  { name: "square", width: 256, height: 256, wrapX: false, wrapY: false },
  { name: "landscape-wrap-x", width: 384, height: 256, wrapX: true, wrapY: false },
  { name: "portrait-wrap-y", width: 256, height: 384, wrapX: false, wrapY: true },
  { name: "landscape-wrap-both", width: 384, height: 256, wrapX: true, wrapY: true },
] as const;

function fixture(kind: typeof UNDERGROUND_KINDS[number], size: typeof CASES[number]): MapProject {
  let project = createDefaultProject(`underground-native-regression:${kind}:${size.name}`, { generate: false });
  project.name = `Underground ${kind} ${size.name}`;
  project.targetVersion = 637;
  Object.assign(project.settings, {
    players: 2, provincesPerPlayer: 24, throneCount: 0, resolution: "custom",
    startDistribution: { land: 0, coastal: 0, water: 0, cave: 2, other: 0 },
    caveStartNations: [], planeConnections: [],
  });
  const plane = project.planes[0]!;
  Object.assign(plane, {
    kind, variant: ARCHETYPE_PROFILES[kind].defaultVariant,
    autoSize: false, provinceTarget: 48, ownershipMode: "sparse", ...size,
  });
  // A toroidal Styx cannot divide the world into two banks. Keep its flow axis
  // nonwrapped, while still exercising a perpendicular wrapped seam.
  if (kind === "underworld") {
    plane.wrapX = size.height > size.width && size.name !== "square";
    plane.wrapY = size.width > size.height && size.name !== "landscape-wrap-both";
  }
  project = generateProject(project);
  const generated = project.planes[0]!;
  const starts = generated.provinces.filter(p => p.start);
  assert.equal(starts.length, 2, `${kind}/${size.name}: expected two generated cave starts`);
  assert.ok(setNationSpecificStart(project, generated.id, starts[0]!.id, 15));
  starts[1]!.teamStart = 1;

  const protectedKeys = protectedProvinceKeys(project, 2);
  const eligible = generated.provinces.filter(p => !isBlockedProvince(p) && !protectedKeys.has(`${generated.id}:${p.id}`));
  const dry = eligible.filter(p => !isWaterProvince(p));
  assert.ok(dry.length >= 3, `${kind}/${size.name}: keep explicit edits outside the protected start buffers`);
  const mixed = dry[0]!;
  mixed.terrain = "cave";
  mixed.terrainFlags = ["forest", "farm", "freshwater"];
  mixed.warmer = true;
  mixed.colder = false;
  const water = generated.provinces.find(p => isWaterProvince(p) && !p.start) ?? dry[1]!;
  water.terrain = "cave";
  water.terrainFlags = ["sea", "deep", "forest"];
  water.defenders = [];
  water.poptype = 95;
  water.warmer = false;
  water.colder = true;

  project.gates = [{
    id: "native-regression-gate", gateNumber: 700, direction: "bidirectional",
    endpoints: [{ planeId: generated.id, provinceId: dry[0]!.id }, { planeId: generated.id, provinceId: dry.at(-1)!.id }],
  }];
  return cloneProject(project);
}

const FIXTURES = UNDERGROUND_KINDS.flatMap(kind => CASES.map(size => ({ label: `${kind}/${size.name}`, project: fixture(kind, size) })));

function componentCount(plane: Plane, accepts: (province: Province) => boolean, omitBridges = false): number {
  const nodes = new Set(plane.provinces.filter(accepts).map(p => p.id));
  const graph = new Map([...nodes].map(id => [id, [] as string[]]));
  for (const edge of plane.edges) {
    if (!nodes.has(edge.a) || !nodes.has(edge.b) || edge.kind === "impassable" || (omitBridges && edge.kind === "bridge")) continue;
    graph.get(edge.a)!.push(edge.b); graph.get(edge.b)!.push(edge.a);
  }
  let count = 0;
  while (nodes.size) {
    count++;
    const queue = [nodes.values().next().value!]; nodes.delete(queue[0]!);
    for (let i = 0; i < queue.length; i++) for (const neighbor of graph.get(queue[i]!) ?? []) if (nodes.delete(neighbor)) queue.push(neighbor);
  }
  return count;
}

function assertStyx(plane: Plane, owners: Int16Array, label: string): void {
  assert.equal(componentCount(plane, p => isWaterProvince(p) && !isBlockedProvince(p)), 1, `${label}: connected Styx water graph`);
  assert.equal(componentCount(plane, p => !isWaterProvince(p) && !isBlockedProvince(p), true), 2, `${label}: exactly two dry banks without designated bridges`);
  assert.ok(plane.edges.filter(e => e.kind === "bridge").length >= 1, `${label}: keep a designated crossing`);
  const waterOwners = new Set(plane.provinces.flatMap((p, i) => isWaterProvince(p) ? [i] : []));
  const horizontal = plane.width >= plane.height;
  for (const high of [false, true]) {
    const edge: number[] = [];
    for (let i = 0; i < (horizontal ? plane.height : plane.width); i++) {
      const pixel = horizontal ? i * plane.width + (high ? plane.width - 1 : 0) : (high ? plane.height - 1 : 0) * plane.width + i;
      edge.push(owners[pixel]!);
    }
    assert.ok(edge.some(owner => waterOwners.has(owner)), `${label}: Styx reaches the ${high ? "high" : "low"} flow boundary`);
    assert.ok(edge.every(owner => owner < 0 || waterOwners.has(owner)), `${label}: no dry land leaks onto a Styx flow boundary`);
  }
}

test("underground artwork leaves frozen native map directives unchanged", () => {
  const digest = createHash("sha256");
  for (const { label, project } of FIXTURES) digest.update(label).update("\n").update(compileMapText(project, 0)).update("\n");
  // Only ownership/relief art is being revised. Province content and all map
  // commands must remain the same across that implementation change.
  assert.equal(digest.digest("hex"), "fe141a1206f7371a0a6bae0ee1861647742716500473e7931933236fc5ac4631", "native .map semantics changed during an artwork-only update");
});

for (const { label, project: source } of FIXTURES) test(`native underground owner/terrain/gameplay invariants: ${label}`, async () => {
  const project = cloneProject(source);
  const plane = project.planes[0]!;
  const original = JSON.stringify(project);
  const nativeText = compileMapText(project, 0);
  assert.deepEqual(validateProject(project).filter(i => i.severity === "error"), [], `${label}: exportable fixture`);
  const ownership = createProvinceOwnershipModel(plane);
  const preview = samplePlaneOwnership(plane, plane.width, plane.height, ownership);
  const bytes = await encodeD6m(plane, `${project.seed}:native-art`);
  const inspected = inspectD6m(bytes);
  assert.equal(inspected.valid, true, label);
  assert.ok(inspected.noneOwnerPixels > 0, `${label}: retain genuine negative space`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixels = plane.width * plane.height;
  const heightsOffset = 34 + plane.provinces.length * 12;
  const ownersOffset = heightsOffset + pixels * 2;
  const exported = new Int16Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const owner = view.getInt16(ownersOffset + pixel * 2, true);
    exported[pixel] = owner - 1;
    if (preview[pixel] !== owner - 1) assert.fail(`${label}: native/preview ownership differs at pixel ${pixel}`);
    if (owner === 0 && view.getInt16(heightsOffset + pixel * 2, true) !== 0) assert.fail(`${label}: non-neutral owner-zero height at pixel ${pixel}`);
  }
  for (const [i, province] of plane.provinces.entries()) {
    const x = Math.round(province.x * (plane.width - 1)), y = Math.round(province.y * (plane.height - 1));
    assert.equal(exported[y * plane.width + x], i, `${label}: quantized province ${province.index} center`);
    assert.equal(provinceAtOwnershipPoint(plane, ownership, province.x, province.y)?.id, province.id, `${label}: editable province ${province.index} center`);
    assert.equal(view.getInt16(34 + i * 12, true), x);
    assert.equal(view.getInt16(34 + i * 12 + 2, true), y);
    const flags = effectiveProvinceTerrainFlags(province);
    const expectedSpec = flags.has("sea") ? TERRAIN_BITS.sea | (flags.has("deep") ? TERRAIN_BITS.deep : 0n) : 0n;
    assert.equal(view.getBigInt64(34 + i * 12 + 4, true), expectedSpec, `${label}: Sea/Deep-only native province specification`);
    assert.ok(nativeText.includes(`#terrain ${province.index} ${terrainMask(province)}\r\n`), `${label}: preserve complete current terrain mask`);
    assert.equal(winterPreviewStrength(plane, province), 0, `${label}: no cave/realm winter snow`);
    assert.deepEqual(provinceTerrainVisuals(province, "winter"), provinceTerrainVisuals(province, "normal"));
    if (province.start || province.teamStart !== undefined) {
      assert.equal(province.defenders.length, 0, `${label}: no authored guardian at a start`);
      assert.ok(!nativeText.includes(`\n#land ${province.index}\r\n`), `${label}: native start army must not be erased`);
    }
  }
  assert.ok(nativeText.includes("#specstart 15 "), `${label}: preserve forced nation start`);
  assert.ok(nativeText.includes("#teamstart "), `${label}: preserve team annotation`);
  for (const endpoint of project.gates[0]!.endpoints) {
    const province = plane.provinces.find(p => p.id === endpoint.provinceId)!;
    assert.ok(nativeText.includes(`#gate ${province.index} 700\r\n`), `${label}: preserve exact gateway endpoint`);
    assert.equal(provinceAtOwnershipPoint(plane, ownership, province.x, province.y)?.id, province.id);
  }
  assert.deepEqual([...computeProvinceTopology(plane).pairKeys].sort(), plane.edges.map(e => connectionKey(e.a, e.b)).sort(), `${label}: only authored graph links`);
  if (plane.kind === "underworld") assertStyx(plane, exported, label);
  assert.equal(JSON.stringify(project), original, `${label}: rendering must not mutate source content, coordinates, starts or connections`);
  assert.equal(compileMapText(project, 0), nativeText, `${label}: native map commands remain stable after preview/export`);
});
