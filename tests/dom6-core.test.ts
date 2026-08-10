import assert from "node:assert/strict";
import test from "node:test";
import { addPlane, adjacencyFor, calculateFairness, createDefaultProject, generateProject, shortestDistances } from "../src/generator";
import { cloneProject } from "../src/domain";
import {
  D6M_MAGIC,
  D6M_TRAILER,
  D6M_VERSION,
  TERRAIN_BITS,
  compileMapText,
  encodeD6m,
  inspectD6m,
  terrainMask,
  terrainPreviewKey,
  validateProject,
} from "../src/dom6";

function canonical(project: ReturnType<typeof createDefaultProject>) {
  const copy = cloneProject(project);
  copy.createdAt = "";
  copy.updatedAt = "";
  return copy;
}

test("generation is deterministic, connected, varied, and multiplayer-scored", () => {
  const source = createDefaultProject("golden-seed-6p");
  const first = generateProject(source);
  const second = generateProject(source);
  assert.deepEqual(canonical(first), canonical(second));
  const plane = first.planes[0]!;
  const reachable = shortestDistances(adjacencyFor(plane), plane.provinces[0]!.id);
  assert.equal(reachable.size, plane.provinces.length);
  assert.equal(plane.provinces.filter((province) => province.start).length, first.settings.players);
  assert.ok(new Set(plane.provinces.map((province) => province.terrain)).size >= 6);
  const fairness = calculateFairness(first);
  assert.ok(fairness.overall >= 0 && fairness.overall <= 100);
  assert.equal(validateProject(first).filter((issue) => issue.severity === "error").length, 0);
});

test("terrain masks preserve Dominions 6 high bits and transformations", () => {
  const project = createDefaultProject("terrain-mask");
  const province = project.planes[0]!.provinces[0]!;
  province.terrain = "cavewall";
  province.colder = true;
  province.manySites = true;
  province.siteBias = ["glamour", "holy"];
  const mask = terrainMask(province);
  assert.ok((mask & TERRAIN_BITS.caveWall) !== 0n);
  assert.ok((mask & TERRAIN_BITS.colder) !== 0n);
  assert.ok((mask & TERRAIN_BITS.glamourSites) !== 0n);
  assert.equal(terrainPreviewKey("plains", "forested"), "forest");
  assert.equal(terrainPreviewKey("sea", "forested"), "kelp");
  assert.equal(terrainPreviewKey("cave", "flooded"), "caveswamp");
});

test("map compilation covers starts, thrones, sites, guardians, and correct wrap flags", () => {
  const project = createDefaultProject("compiler-coverage");
  const plane = project.planes[0]!;
  plane.wrapX = true;
  plane.wrapY = false;
  const province = plane.provinces.find((item) => !item.start)!;
  province.throne = "fixed";
  province.fixedThrone = "The Throne of Gaia";
  province.sites.push({ id: "site-test", value: "The Enchanted Forest", known: false });
  province.defenders.push({ commander: "Druid", magic: { nature: 2, holy: 1 }, squads: [{ id: "squad-test", unit: "Fir Bolg", count: 12 }] });
  const text = compileMapText(project, 0);
  const firstCommand = text.split(/\r?\n/).find((line) => line.startsWith("#"));
  assert.equal(firstCommand?.startsWith("#dom2title "), true);
  assert.match(text, /#hwraparound/);
  assert.doesNotMatch(text, /^#wraparound$/m);
  assert.match(text, /#feature "The Throne of Gaia"/);
  assert.match(text, /#feature "The Enchanted Forest"/);
  assert.match(text, /#commander "Druid"/);
  assert.match(text, /#units 12 "Fir Bolg"/);
  assert.match(text, /#mag_nature 2/);
  assert.match(text, /#mag_priest 1/);
});

test("D6M encoder writes the official header, exact length, row-major owners, and trailer", async () => {
  const project = createDefaultProject("binary-fixture");
  const plane = project.planes[0]!;
  plane.width = 256;
  plane.height = 256;
  const bytes = await encodeD6m(plane, "binary-fixture");
  const inspection = inspectD6m(bytes);
  assert.deepEqual(
    { magic: inspection.magic, version: inspection.version, trailer: inspection.trailer, validLength: inspection.validLength },
    { magic: D6M_MAGIC, version: D6M_VERSION, trailer: D6M_TRAILER, validLength: true },
  );
  assert.equal(inspection.width, 256);
  assert.equal(inspection.height, 256);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ownerOffset = 34 + plane.provinces.length * 12 + plane.width * plane.height * 2;
  for (const province of plane.provinces) {
    const x = Math.round(province.x * (plane.width - 1));
    const y = Math.round(province.y * (plane.height - 1));
    assert.equal(view.getInt16(ownerOffset + (y * plane.width + x) * 2, true), province.index);
  }
});

test("all eight planes are generated, named contiguously, and gate-connected", () => {
  let project = createDefaultProject("eight-realms");
  while (project.planes.length < 8) project = addPlane(project, project.planes.length % 2 ? "underworld" : "dream");
  assert.equal(project.planes.length, 8);
  assert.ok(project.gates.length >= 7);
  const issues = validateProject(project).filter((issue) => issue.severity === "error");
  assert.deepEqual(issues, []);
  for (let index = 0; index < project.planes.length; index += 1) {
    const text = compileMapText(project, index);
    assert.match(text, new RegExp(`#imagefile [^\\r\\n]+${index ? `_plane${index + 1}` : ""}\\.d6m`));
  }
});
