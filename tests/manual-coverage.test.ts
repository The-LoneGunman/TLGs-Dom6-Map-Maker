import assert from "node:assert/strict";
import test from "node:test";
import { addPlane, adjacencyFor, createDefaultProject } from "../src/generator";
import { compileMapText, validateProject } from "../src/dom6";
import { parseProject } from "../src/export";

test("every plane map starts with the manual-required dom2title command", () => {
  const project = addPlane(createDefaultProject("manual-plane-title"), "underworld");
  for (let index = 0; index < project.planes.length; index += 1) {
    const firstCommand = compileMapText(project, index)
      .split(/\r?\n/)
      .find((line) => line.startsWith("#"));
    assert.equal(firstCommand, `#dom2title ${project.name}`);
  }
});

test("land never clears generic, team, or nation-specific starts", () => {
  const project = createDefaultProject("manual-protected-starts");
  const plane = project.planes[0]!;
  const available = plane.provinces.filter((province) => !province.start).slice(0, 2);
  const [teamStart, specificStart] = available;
  assert.ok(teamStart && specificStart);

  teamStart.teamStart = 0;
  teamStart.defenders.push({ commander: "1", squads: [{ id: "team-squad", unit: "2", count: 5 }] });
  project.specificStarts.push({ nation: 5, planeId: plane.id, provinceId: specificStart.id });
  specificStart.defenders.push({ commander: "1", squads: [{ id: "specific-squad", unit: "2", count: 5 }] });

  const text = compileMapText(project, 0);
  assert.match(text, new RegExp(`#setland ${teamStart.index}\\r?\\n`));
  assert.match(text, new RegExp(`#setland ${specificStart.index}\\r?\\n`));
  assert.doesNotMatch(text, new RegExp(`#land ${teamStart.index}\\r?\\n`));
  assert.doesNotMatch(text, new RegExp(`#land ${specificStart.index}\\r?\\n`));
});

test("legacy normalized battle colors compile to manual integer RGB channels", () => {
  const project = createDefaultProject("manual-battle-rgb");
  const province = project.planes[0]!.provinces[0]!;
  province.battle.groundColor = "0.4 0.5 1";
  province.battle.rockColor = "12 34 56";
  const text = compileMapText(project, 0);
  assert.match(text, /#groundcol 102 128 255/);
  assert.match(text, /#rockcol 12 34 56/);
});

test("per-plane switches, colors, and commander clear-magic compile in command order", () => {
  const project = addPlane(createDefaultProject("manual-plane-overrides"), "cave");
  project.mapNoHide = false;
  project.noDeepCaves = true;
  const plane = project.planes[1]!;
  plane.mapNoHide = true;
  plane.noDeepCaves = false;
  plane.mapTextColor = "0.1 0.2 0.3 1";
  plane.mapDominionColor = "1 2 3 4";
  const province = plane.provinces.find((item) => !item.start)!;
  province.defenders = [{ commander: "2468", clearMagic: true, magic: { nature: 2 }, squads: [] }];
  const text = compileMapText(project, 1);
  assert.match(text, /#mapnohide/);
  assert.doesNotMatch(text, /#nodeepcaves/);
  assert.match(text, /#maptextcol 0\.1 0\.2 0\.3 1/);
  assert.match(text, /#mapdomcol 1 2 3 4/);
  assert.match(text, /#commander 2468\r?\n#clearmagic\r?\n#mag_nature 2/);
  assert.equal(validateProject(project).some((issue) => issue.severity === "error"), false);
});

test("team starts are not confused with the editor's 0-7 keyboard shortcuts", () => {
  const project = createDefaultProject("manual-team-start");
  const province = project.planes[0]!.provinces.find((item) => !item.start)!;
  province.teamStart = 12;
  assert.match(compileMapText(project, 0), new RegExp(`#teamstart ${province.index} 12`));
  assert.equal(validateProject(project).some((issue) => issue.message.includes("team-start group")), false);
});

test("province defence is never emitted for independent owner IDs", () => {
  const project = createDefaultProject("manual-independent-defence");
  const province = project.planes[0]!.provinces.find((item) => !item.start)!;
  province.owner = 2;
  province.provinceDefense = 50;
  assert.doesNotMatch(compileMapText(project, 0), /#defence 50/);
  assert.ok(validateProject(project).some((issue) => issue.message.includes("#defence only works")));
});

test("custom D6M dimensions cannot exceed the supported raster envelope", () => {
  const project = createDefaultProject("manual-raster-envelope");
  project.planes[0]!.width = 5000;
  project.planes[0]!.height = 5000;
  assert.ok(validateProject(project).some((issue) => issue.severity === "error" && issue.message.includes("8.29-megapixel")));
});

test("validation exposes gates and thrones placed in a start exclusion zone", () => {
  const project = createDefaultProject("manual-gate-exclusion");
  const plane = project.planes[0]!;
  const start = plane.provinces.find((province) => province.start)!;
  const adjacentId = adjacencyFor(plane).get(start.id)?.[0];
  const adjacent = plane.provinces.find((province) => province.id === adjacentId);
  assert.ok(adjacent);
  project.gates = [{
    id: "gate-near-start",
    gateNumber: 1,
    endpoints: [
      { planeId: plane.id, provinceId: adjacent!.id },
      { planeId: plane.id, provinceId: plane.provinces.find((province) => province.id !== adjacent!.id && province.id !== start.id)!.id },
    ],
  }];
  adjacent!.throne = "preferred";
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.message.includes("Gate 1") && issue.message.includes("adjacent to start province")));
  assert.ok(issues.some((issue) => issue.message.includes("throne location adjacent to start province")));
});

test("validation reports when protected zones prevent the requested throne count", () => {
  const project = createDefaultProject("manual-throne-shortfall");
  const placed = project.planes.flatMap((plane) => plane.provinces)
    .filter((province) => province.throne === "preferred" || province.throne === "fixed").length;
  project.settings.throneCount = placed + 1;

  assert.ok(validateProject(project).some((issue) => issue.severity === "warning"
    && issue.message.includes(`Requested ${placed + 1} recommended throne locations, but only ${placed} fit`)));
});

test("project import migrates legacy exclusive freshwater safely", () => {
  const project = createDefaultProject("manual-freshwater-import");
  const province = project.planes[0]!.provinces.find((item) => !item.start)!;
  province.terrain = "freshwater";
  province.startType = "water";
  const parsed = parseProject(JSON.stringify(project));
  const migrated = parsed.planes[0]!.provinces.find((item) => item.id === province.id)!;
  assert.equal(migrated.terrain, "plains");
  assert.equal(migrated.freshwater, true);
  assert.equal(migrated.startType, "land");
});

test("validation counts distinct generic, team, and nation-specific start locations", () => {
  const project = createDefaultProject("manual-start-union");
  project.settings.players = 2;
  project.settings.startDistribution = undefined;
  for (const plane of project.planes) {
    for (const province of plane.provinces) {
      province.start = false;
      province.startType = undefined;
    }
  }
  const candidates = project.planes[0]!.provinces.filter((province) => !province.noStart).slice(0, 2);
  assert.equal(candidates.length, 2);
  candidates[0]!.teamStart = 0;
  project.specificStarts = [{ nation: 5, planeId: project.planes[0]!.id, provinceId: candidates[1]!.id }];
  assert.equal(validateProject(project).some((issue) => issue.message.includes("distinct start locations")), false);

  project.specificStarts.push({ nation: 6, planeId: project.planes[0]!.id, provinceId: candidates[1]!.id });
  assert.ok(validateProject(project).some((issue) => issue.severity === "error" && issue.message.includes("more than one nation-specific start")));
});

test("validation rejects blocked gates and ignores them for plane connectivity", () => {
  const project = addPlane(createDefaultProject("manual-blocked-gate"), "cave");
  const main = project.planes[0]!;
  const other = project.planes[1]!;
  const blocked = main.provinces.find((province) => !province.start && province.throne === "none")!;
  const destination = other.provinces.find((province) => !province.start && province.throne === "none" && province.terrain !== "cavewall")!;
  blocked.terrain = "cavewall";
  blocked.noStart = true;
  project.gates = [{
    id: "blocked-gate",
    gateNumber: 77,
    endpoints: [
      { planeId: main.id, provinceId: blocked.id },
      { planeId: other.id, provinceId: destination.id },
    ],
  }];
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("endpoint") && issue.message.includes("blocked terrain")));
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes(`${other.name} is not linked`)));
});

test("validation hardens imported runtime IDs, enums, coordinates, owners, and allowed-player capacity", () => {
  const project = addPlane(createDefaultProject("manual-import-hardening"), "cave");
  project.settings.players = 3;
  project.allowedPlayers = [5, 5];
  project.planes[1]!.id = project.planes[0]!.id;
  project.planes[0]!.provinces[0]!.x = 2;
  project.planes[0]!.provinces[0]!.terrain = "bogus" as never;
  project.planes[0]!.provinces[0]!.owner = 3;
  project.planes[0]!.edges[0]!.kind = "bogus" as never;
  const messages = validateProject(project).filter((issue) => issue.severity === "error").map((issue) => issue.message);
  assert.ok(messages.some((message) => message.includes("distinct allowed nation")));
  assert.ok(messages.some((message) => message.includes("Plane ID") && message.includes("duplicated")));
  assert.ok(messages.some((message) => message.includes("province-center coordinates")));
  assert.ok(messages.some((message) => message.includes("unknown terrain")));
  assert.ok(messages.some((message) => message.includes("owner must be independent")));
  assert.ok(messages.some((message) => message.includes("unknown edge kind")));
});

test("start degrees above four are best-effort while four remains the hard floor", () => {
  const project = createDefaultProject("manual-start-degree-preference");
  project.settings.startDegreeTarget = 8;
  const start = project.planes[0]!.provinces.find((province) => province.start)!;
  const degree = adjacencyFor(project.planes[0]!).get(start.id)!.length;
  assert.ok(degree >= 4 && degree < 8);
  const issues = validateProject(project);
  assert.equal(issues.some((issue) => issue.severity === "error" && issue.provinceId === start.id && issue.message.includes("connections")), false);
  assert.ok(issues.some((issue) => issue.severity === "warning" && issue.provinceId === start.id && issue.message.includes("best-effort")));

  const plane = project.planes[0]!;
  plane.edges = plane.edges.filter((edge) => edge.a !== start.id && edge.b !== start.id).slice();
  for (const neighbour of plane.provinces.filter((province) => province.id !== start.id).slice(0, 3)) {
    plane.edges.push({ id: `low-degree-${neighbour.id}`, a: start.id, b: neighbour.id, kind: "standard" });
  }
  assert.ok(validateProject(project).some((issue) => issue.severity === "error" && issue.provinceId === start.id && issue.message.includes("at least 4")));
});

test("custom neighbourspec bit 4 is impassable for connectivity validation", () => {
  const project = createDefaultProject("manual-custom-impassable");
  project.settings.players = 2;
  project.settings.startDegreeTarget = 2;
  project.settings.startDistribution = { land: 0, coastal: 0, water: 0, cave: 2, other: 0 };
  const plane = project.planes[0]!;
  plane.kind = "cave";
  plane.ownershipMode = "sparse";
  plane.provinces = plane.provinces.slice(0, 8).map((province, index) => ({
    ...province,
    id: `custom-impassable-province-${index}`,
    index: index + 1,
    x: 0.08 + index * 0.12,
    y: 0.5,
    terrain: "cave",
    start: index === 2 || index === 6,
    startType: index === 2 || index === 6 ? "cave" : undefined,
    noStart: false,
    defenders: [],
  }));
  plane.edges = plane.provinces.slice(1).map((province, index) => ({
    id: `custom-impassable-edge-${index}`,
    a: plane.provinces[index]!.id,
    b: province.id,
    kind: index === 0 ? "custom" : "standard",
    special: index === 0 ? 4 : undefined,
  }));

  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("disconnected for normal movement")));
  assert.equal(adjacencyFor(plane, { traversableOnly: true }).get(plane.provinces[0]!.id)!.length, 0);
});
