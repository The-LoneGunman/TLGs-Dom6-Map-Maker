import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProject } from "../src/generator";
import type { Plane, PlaneKind } from "../src/domain";
import { compileMapText, encodeD6m } from "../src/dom6";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { VERIFIED_POPULATION_DEFENSE_PROFILES } from "../src/populationDefenseProfiles";
import { compileImageOwnership, createIllustratedExport, encodeIllustratedImages, encodeTga24, imageCenters, imageProvinceNumbers,
  imageTerrain, illustratedExportError, sampleIllustratedOwnership, IMAGE_SUFFIXES } from "../src/illustratedMap";

/** Independent decoder returns top-down RGB, never trusting encoder row order. */
function decodeTga(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes[2], 10); assert.equal(bytes[16], 24); assert.equal(bytes[17], 0);
  const width = view.getUint16(12, true), height = view.getUint16(14, true);
  const rgb = new Uint8Array(width * height * 3);
  let offset = 18, pixel = 0;
  while (offset < bytes.length) {
    const packet = bytes[offset++]!, length = (packet & 127) + 1;
    for (let i = 0; i < length; i++) {
      const at = ((height - 1 - Math.floor(pixel / width)) * width + pixel % width) * 3;
      rgb[at] = bytes[offset + 2]!; rgb[at + 1] = bytes[offset + 1]!; rgb[at + 2] = bytes[offset]!;
      pixel++;
      if (!(packet & 128)) offset += 3;
    }
    if (packet & 128) offset += 3;
  }
  assert.equal(pixel, width * height); assert.equal(offset, bytes.length);
  return { width, height, rgb };
}

function fixture(kind: PlaneKind = "cloud") {
  const project = createDefaultProject("image-map-verification");
  const plane = project.planes[0]!;
  project.planes = [plane]; project.gates = []; project.specificStarts = [];
  plane.kind = kind; plane.width = 256; plane.height = 256; plane.wrapX = false; plane.wrapY = false;
  plane.ownershipMode = "sparse"; plane.sparseLayout = "regions";
  plane.provinces = plane.provinces.slice(0, 4).map((p, i) => ({ ...p, id: `image-p${i}`, index: i + 1,
    x: i % 2 ? .75 : .25, y: i < 2 ? .25 : .75, name: `Identity ${i}`, terrain: "plains", terrainFlags: [],
    freshwater: false, colder: false, warmer: false, start: false, noStart: false,
    sites: [], defenders: [], rawDirectives: "", throne: "none", poptype: undefined, population: undefined }));
  plane.edges = [[0, 1], [0, 2], [1, 3], [2, 3]].map(([a, b], i) => ({ id: `image-e${i}`, a: plane.provinces[a!]!.id, b: plane.provinces[b!]!.id, kind: "standard" }));
  plane.rawDirectives = ""; project.rawDirectives = "";
  return project;
}

test("TGA encoding preserves top-down RGB through bottom-origin RLE including packet and row boundaries", () => {
  for (const width of [1, 2, 127, 128, 129, 257]) {
    const height = 3, rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = i < width ? 10 : i < 2 * width ? 91 : (i * 17) % 255;
      rgb[i * 3 + 1] = i < 2 * width ? 42 : i % 255; rgb[i * 3 + 2] = 189;
    }
    assert.deepEqual(decodeTga(encodeTga24(width, height, rgb)).rgb, rgb);
  }
  assert.throws(() => encodeTga24(2, 2, new Uint8Array(3)), /dimensions/);
});

test("image marker numbering is bottom-up, with left-to-right ties and collision rejection", () => {
  const plane = fixture().planes[0]!;
  assert.deepEqual([...imageProvinceNumbers(plane)], [["image-p2", 1], ["image-p3", 2], ["image-p0", 3], ["image-p1", 4]]);
  plane.provinces[1]!.x = plane.provinces[0]!.x;
  assert.throws(() => imageProvinceNumbers(plane), /same image pixel/);
  plane.provinces[1]!.x = NaN;
  assert.throws(() => imageProvinceNumbers(plane), /invalid image center/);
});

test("ownership runs preserve every canonical native pixel and leave negative space unowned", async () => {
  const plane = fixture().planes[0]!;
  const owners = await sampleIllustratedOwnership(plane), numbers = imageProvinceNumbers(plane);
  const d6m = await encodeD6m(plane, "ownership");
  const native = new Int16Array(d6m.buffer, 34 + plane.provinces.length * 12 + plane.width * plane.height * 2, owners.length);
  const restored = new Int16Array(owners.length); restored.fill(-1);
  for (const line of compileImageOwnership(plane, owners, numbers).trim().split(/\r?\n/)) {
    const [, x, y, length, number] = line.split(" ").map(Number);
    const original = plane.provinces.findIndex(p => numbers.get(p.id) === number);
    for (let i = 0; i < length!; i++) {
      const pixel = (plane.height - 1 - y!) * plane.width + x! + i;
      assert.equal(restored[pixel], -1, "runs do not overlap"); restored[pixel] = original;
    }
  }
  assert.deepEqual(restored, owners);
  for (let i = 0; i < owners.length; i++) assert.equal(native[i], owners[i]! + 1);
  assert.ok(owners.includes(-1));
});

test("all 18 image variants have exactly the same unique centers and dimensions", async () => {
  const plane = fixture().planes[0]!;
  const before = structuredClone(plane), expected = imageCenters(plane).map(c => c.pixel).sort((a, b) => a - b);
  const images = [];
  for await (const image of encodeIllustratedImages(plane)) {
    const decoded = decodeTga(image.data), whites = [];
    for (let at = 0; at < decoded.rgb.length; at += 3) if (decoded.rgb[at] === 255 && decoded.rgb[at + 1] === 255 && decoded.rgb[at + 2] === 255) whites.push(at / 3);
    assert.deepEqual(whites, expected); assert.equal(decoded.width, 256); assert.equal(decoded.height, 256);
    images.push(image);
  }
  assert.deepEqual(images.map(i => i.suffix), IMAGE_SUFFIXES);
  assert.notDeepEqual(images[0]!.data, images[1]!.data, "sky winter is actual changed art");
  for (const suffix of ["_forest", "_farm", "_swamp", "_water", "_highland", "_kelp", "_waste"]) {
    assert.notDeepEqual(images.find(i => i.suffix === suffix)!.data, images[0]!.data, suffix);
  }
  assert.deepEqual(plane, before);
});

test("all realm kinds export opaque bounded RGB and seasonless realms remain unchanged in winter", async () => {
  for (const kind of ["cave", "cavern", "underworld", "hell", "abyss", "dream", "elemental", "air"] as const) {
    const plane = fixture(kind).planes[0]!;
    if (kind !== "air") for (const province of plane.provinces) province.terrainFlags = ["cave"];
    const output = encodeIllustratedImages(plane);
    const normal = (await output.next()).value!, winter = (await output.next()).value!;
    await output.return(undefined);
    assert.equal(decodeTga(normal.data).width, plane.width);
    if (kind !== "air") assert.deepEqual(normal.data, winter.data, kind);
  }
});

test("terrain sheets preserve cave walls and aquatic identity while supporting kelp removal", () => {
  const province = fixture().planes[0]!.provinces[0]!;
  province.terrainFlags = ["cavewall", "forest", "sea"];
  for (const variant of ["forest", "farm", "water", "kelp", "plain"] as const) assert.equal(imageTerrain(province, variant), province);
  province.terrainFlags = ["sea", "forest", "cave", "deep"];
  assert.deepEqual(new Set(imageTerrain(province, "water").terrainFlags), new Set(["sea", "cave", "deep"]));
  assert.equal(imageTerrain(province, "farm"), province);
  assert.ok(imageTerrain(province, "kelp").terrainFlags?.includes("forest"));
});

test("illustrated compilation remaps local/global references without changing source or native output", async () => {
  const project = fixture("surface");
  const surface = project.planes[0]!, realm = structuredClone(surface);
  realm.id = "realm"; realm.kind = "cloud";
  realm.provinces[0]!.start = true;
  realm.provinces[1]!.teamStart = 2;
  realm.provinces[2]!.poptype = 23;
  realm.provinces[2]!.defenders = [{ commander: "32", squads: [{ id: "army", unit: "33", count: 9 }] }];
  realm.provinces[3]!.sites = [{ id: "site", value: "100", known: true }];
  realm.edges[0]!.kind = "river";
  project.planes.push(realm);
  project.specificStarts = [{ nation: 62, planeId: realm.id, provinceId: realm.provinces[0]!.id }];
  project.gates = [{ id: "gate", gateNumber: 10, direction: "bidirectional", endpoints: [
    { planeId: surface.id, provinceId: surface.provinces[0]!.id }, { planeId: realm.id, provinceId: realm.provinces[3]!.id } ] }];
  const before = structuredClone(project), native = project.planes.map((_, i) => compileMapText(project, i));
  const renderer = createIllustratedExport(project);
  const mainText = await renderer.mapText(0, BUILTIN_DOM6_CATALOG, VERIFIED_POPULATION_DEFENSE_PROFILES);
  const realmText = await renderer.mapText(1, BUILTIN_DOM6_CATALOG, VERIFIED_POPULATION_DEFENSE_PROFILES);
  assert.match(mainText, /#imagefile .*\.d6m/); assert.match(mainText, /#specstart 62 7\r/);
  assert.match(realmText, /#imagefile .*_realm2\.tga/); assert.match(realmText, /#winterimagefile .*_realm2_winter\.tga/);
  assert.match(realmText, /#landname 3 "Identity 0"/);
  assert.match(realmText, /#start 3\r/); assert.match(realmText, /#teamstart 4 2\r/); assert.match(realmText, /#gate 2 10\r/);
  assert.match(realmText, /#land 1\r\n#poptype 23\r\n#commander 32\r\n#units 9 33/);
  assert.match(realmText, /#setland 2\r\n#knownfeature 100/);
  assert.match(realmText, /#neighbourspec 3 4 2\r/);
  assert.deepEqual(project, before);
  assert.deepEqual(project.planes.map((_, i) => compileMapText(project, i)), native);
});

test("unsupported raw map commands fail closed, while comments and native compilation remain available", () => {
  const project = fixture(); project.planes[0]!.rawDirectives = "-- notes\n#land 1";
  assert.match(illustratedExportError(project)!, /raw directives/);
  assert.throws(() => createIllustratedExport(project), /raw directives/);
  assert.match(compileMapText(project, 0), /#land 1/);
  project.planes[0]!.rawDirectives = "-- comments only";
  assert.equal(illustratedExportError(project), undefined);
});

test("wide/portrait and wrapped ownership retain centers and run coordinates", async () => {
  for (const [width, height, wrapX, wrapY] of [[512, 256, true, false], [256, 512, false, true], [320, 320, true, true]] as const) {
    const plane: Plane = fixture("cave").planes[0]!;
    Object.assign(plane, { width, height, wrapX, wrapY });
    const owners = await sampleIllustratedOwnership(plane);
    for (const center of imageCenters(plane)) assert.equal(owners[center.pixel], center.owner);
    assert.ok(compileImageOwnership(plane, owners).includes("#pb"));
  }
});
