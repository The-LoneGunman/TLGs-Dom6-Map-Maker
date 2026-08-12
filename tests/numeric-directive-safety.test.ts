import assert from "node:assert/strict";
import test from "node:test";
import { compileMapText, validateProject } from "../src/dom6";
import { adjacencyFor, createDefaultProject } from "../src/generator";
import type { MapProject, Province } from "../src/domain";

function editableProvince(project: MapProject): Province {
  const plane = project.planes[0]!;
  const startIds = new Set(plane.provinces.filter((province) => province.start || province.teamStart !== undefined)
    .map((province) => province.id));
  const adjacency = adjacencyFor(plane);
  return plane.provinces.find((province) => !startIds.has(province.id)
    && (adjacency.get(province.id) ?? []).every((id) => !startIds.has(id)))
    ?? plane.provinces.find((province) => !startIds.has(province.id))!;
}

function errorMessages(project: MapProject): string[] {
  return validateProject(project).filter((issue) => issue.severity === "error").map((issue) => issue.message);
}

test("numeric-looking site and unit references must use positive safe integer ID syntax", () => {
  const project = createDefaultProject("numeric-reference-safety");
  const province = editableProvince(project);
  province.sites = [
    { id: "zero-site", value: "0", known: false },
    { id: "decimal-site", value: "1.5", known: true },
    { id: "exponent-site", value: "1e3", known: false },
    { id: "unsafe-site", value: String(Number.MAX_SAFE_INTEGER + 1), known: false },
  ];
  province.throne = "fixed";
  province.fixedThrone = "#-1";
  province.defenders = [{
    commander: "+34",
    bodyguard: "#0",
    bodyguardCount: 4,
    squads: [{ id: "fractional-unit", unit: ".5", count: 6 }],
  }];

  const messages = errorMessages(project);
  assert.ok(messages.some((message) => message.includes("numeric throne-site ID")));
  assert.equal(messages.filter((message) => message.includes("numeric magic-site ID")).length, 4);
  assert.ok(messages.some((message) => message.includes("numeric commander ID")));
  assert.ok(messages.some((message) => message.includes("numeric bodyguard ID")));
  assert.ok(messages.some((message) => message.includes("numeric squad-unit ID")));
});

test("unknown nonnumeric mod names remain valid structured references", () => {
  const project = createDefaultProject("named-mod-references");
  const province = editableProvince(project);
  province.sites = [{ id: "mod-site", value: "Mod Site 1.5", known: true }];
  province.defenders = [{
    commander: "Mod Commander 0",
    bodyguard: "Mod Guard -2",
    bodyguardCount: 3,
    squads: [{ id: "mod-squad", unit: "Mod Unit .5", count: 4 }],
  }];

  const messages = errorMessages(project);
  assert.equal(messages.some((message) => message.includes("numeric magic-site ID")), false);
  assert.equal(messages.some((message) => message.includes("numeric commander ID")), false);
  assert.equal(messages.some((message) => message.includes("numeric bodyguard ID")), false);
  assert.equal(messages.some((message) => message.includes("numeric squad-unit ID")), false);

  const text = compileMapText(project, 0);
  assert.match(text, /#knownfeature "Mod Site 1\.5"/);
  assert.match(text, /#commander "Mod Commander 0"/);
  assert.match(text, /#bodyguards 3 "Mod Guard -2"/);
  assert.match(text, /#units 4 "Mod Unit \.5"/);
});

test("catalog-search ID prefixes compile to canonical positive integer arguments", () => {
  const project = createDefaultProject("canonical-catalog-references");
  const province = editableProvince(project);
  province.sites = [{ id: "prefixed-site", value: "#001", known: false }];
  province.defenders = [{
    commander: "#034",
    bodyguard: "#018",
    bodyguardCount: 2,
    squads: [{ id: "prefixed-squad", unit: "#017", count: 3 }],
  }];

  const messages = errorMessages(project);
  assert.equal(messages.some((message) => message.includes("numeric magic-site ID")), false);
  assert.equal(messages.some((message) => message.includes("numeric commander ID")), false);
  assert.equal(messages.some((message) => message.includes("numeric bodyguard ID")), false);
  assert.equal(messages.some((message) => message.includes("numeric squad-unit ID")), false);

  const text = compileMapText(project, 0);
  assert.match(text, /#feature 1\b/);
  assert.match(text, /#commander 34\b/);
  assert.match(text, /#bodyguards 2 18\b/);
  assert.match(text, /#units 3 17\b/);
});

test("custom connection bitmasks require an explicit safe integer from 0 through 255", () => {
  const baseline = createDefaultProject("custom-special-integer-safety");
  for (const special of [undefined, -1, 1.5, 256, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
    const project = structuredClone(baseline);
    const edge = project.planes[0]!.edges[0]!;
    edge.kind = "custom";
    edge.special = special;
    assert.ok(errorMessages(project).some((message) => message.includes("custom connection")
      && message.includes("safe whole-number bitmask")), String(special));
  }

  for (const special of [0, 255]) {
    const project = structuredClone(baseline);
    const edge = project.planes[0]!.edges[0]!;
    edge.kind = "custom";
    edge.special = special;
    assert.equal(errorMessages(project).some((message) => message.includes("custom connection")
      && message.includes("bitmask")), false, String(special));
  }
});

test("team, gate, and defender command numbers enforce integer safety and existing bounds", () => {
  const project = createDefaultProject("structured-integer-safety");
  const plane = project.planes[0]!;
  const province = editableProvince(project);
  province.teamStart = 1.5;
  province.owner = 5;
  province.population = 100.5;
  province.unrest = Number.NaN;
  province.provinceDefense = Number.POSITIVE_INFINITY;
  province.defenders = [{
    commander: "34",
    bodyguard: "18",
    bodyguardCount: 1.5,
    experience: 2.5,
    randomEquipment: 4.5,
    magic: { fire: 1.5 },
    squads: [{ id: "decimal-count", unit: "17", count: 3.5 }],
  }];
  project.gates = [{
    id: "decimal-gate",
    gateNumber: 1.5,
    endpoints: [
      { planeId: plane.id, provinceId: plane.provinces[0]!.id },
      { planeId: plane.id, provinceId: plane.provinces[1]!.id },
    ],
  }];

  const messages = errorMessages(project);
  for (const fragment of [
    "team-start group",
    "Gate numbers",
    "population must be between 0 and 50000",
    "unrest must be between 0 and 500",
    "owned province defence must be between 0 and 125",
    "commander experience must be between 0 and 900",
    "random equipment richness must be between 0 and 4",
    "whole-number count from 1 to 1000",
    "counts must be whole numbers from 1 to 1000",
    "fire magic must be a whole number from 0 to 10",
  ]) assert.ok(messages.some((message) => message.includes(fragment)), fragment);
});
