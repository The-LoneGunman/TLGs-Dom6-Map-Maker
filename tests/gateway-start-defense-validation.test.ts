import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { cloneProject, isWaterProvince, setNationSpecificStart } from "../src/domain";
import { compileMapText, validateProject } from "../src/dom6";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import { protectedProvinceKeys } from "../src/iteration";

let input = createDefaultProject("gateway-custom-review", { generate: false });
input.settings.players = 2;
input.settings.provincesPerPlayer = 24;
input.settings.throneCount = 0;
input.settings.startDistribution = { land: 2, coastal: 0, water: 0, cave: 0, other: 0 };
input = addPlane(input, "cave", { generate: false });
const baseline = generateProject(input);

function fixture(startType: "generic" | "team" | "specific", samePlane: boolean) {
  const project = cloneProject(baseline), surface = project.planes[0]!;
  const start = surface.provinces.find(p => p.start)!;
  if (startType !== "generic") start.start = false;
  if (startType === "team") start.teamStart = 0;
  if (startType === "specific") assert.ok(setNationSpecificStart(project, surface.id, start.id, 60));
  const protectedKeys = protectedProvinceKeys(project, 1);
  const plane = samePlane ? surface : project.planes[1]!;
  const eligible = plane.provinces.filter(p => !isWaterProvince(p) && !protectedKeys.has(`${plane.id}:${p.id}`));
  assert.ok(eligible.length >= 2);
  const target = eligible[0]!, second = eligible[1]!;
  for (const p of [target, second]) { p.defenders = []; p.throne = "none"; p.sites = []; p.rawDirectives = ""; }
  project.gates.push({ id: "review-gate", gateNumber: Math.max(0, ...project.gates.map(g => g.gateNumber)) + 1,
    direction: "reverse", endpoints: [{ planeId: plane.id, provinceId: target.id },
      { planeId: plane.id, provinceId: second.id }, { planeId: surface.id, provinceId: start.id }] });
  return { project, plane, start, target, second };
}

for (const startType of ["generic", "team", "specific"] as const) for (const samePlane of [false, true]) {
  test(`${startType}: ${samePlane ? "same-plane" : "cross-plane"} multi-endpoint gateways protect all direct neighbors`, () => {
    const { project, plane, target, second } = fixture(startType, samePlane);
    for (const p of [target, second]) p.defenders = [{ commander: "1463", squads: [{ id: "authored-pale-ones", unit: "1465", count: 15 }] }];
    const before = JSON.stringify(project);
    const issues = validateProject(project);
    for (const p of [target, second]) assert.ok(issues.some(issue => issue.planeId === plane.id && issue.provinceId === p.id
      && issue.severity === "error" && /start one-ring.*independent defenders/.test(issue.message) && /gateway/.test(issue.message)));
    assert.equal(JSON.stringify(project), before, "invalid authored armies are preserved for correction, not erased");
    assert.match(compileMapText(project, project.planes.indexOf(plane)), /#commander 1463\r?\n#units 15 1465/);
  });
}

test("gateway start neighbors reject throne markers, known throne sites and raw special-unit commands", () => {
  const throne = BUILTIN_DOM6_CATALOG.sites.find(site => site.tags?.includes("throne"))!;
  for (const content of ["preferred", "site", "raw"] as const) {
    const { project, plane, target } = fixture("specific", false);
    if (content === "preferred") target.throne = "preferred";
    if (content === "site") target.sites = [{ id: "authored-throne", value: String(throne.id), known: true }];
    if (content === "raw") target.rawDirectives = "#commander 1463\n#units 15 1465";
    const before = JSON.stringify(project);
    const issue = validateProject(project).find(issue => issue.planeId === plane.id && issue.provinceId === target.id
      && issue.severity === "error" && /start one-ring/.test(issue.message));
    assert.ok(issue, content);
    assert.match(issue.message, /gateway/);
    assert.equal(JSON.stringify(project), before);
  }
});

test("gateway protection remains a one-ring rather than spreading recursively to remote neighbors", () => {
  const { project, plane, target, second } = fixture("generic", false);
  const gate = project.gates.at(-1)!;
  gate.endpoints = gate.endpoints.filter(endpoint => endpoint.provinceId !== second.id);
  const protectedKeys = protectedProvinceKeys(project, 1);
  const remoteNeighborId = plane.edges.flatMap(edge => edge.a === target.id ? [edge.b] : edge.b === target.id ? [edge.a] : [])
    .find(id => !protectedKeys.has(`${plane.id}:${id}`));
  assert.ok(remoteNeighborId);
  const neighbor = plane.provinces.find(p => p.id === remoteNeighborId)!;
  neighbor.defenders = [{ commander: "1463", squads: [{ id: "two-steps", unit: "1465", count: 15 }] }];
  assert.ok(!validateProject(project).some(issue => issue.planeId === plane.id && issue.provinceId === neighbor.id
    && issue.severity === "error" && /start one-ring/.test(issue.message)));
});

test("representative regenerated cave and bonus-plane maps remain free of export blockers", () => {
  for (let seed = 0; seed < 8; seed++) {
    let p = createDefaultProject(`gateway-safety-generation-${seed}`, { generate: false });
    p.settings.players = seed % 2 ? 4 : 2;
    p.settings.provincesPerPlayer = 24;
    p.settings.startDistribution = { land: p.settings.players, coastal: 0, water: 0, cave: 0, other: 0 };
    p.settings.throneCount = 2;
    for (const kind of ["cave", "underworld", "hell", "abyss"] as const) p = addPlane(p, kind, { generate: false });
    const generated = generateProject(p);
    assert.deepEqual(validateProject(generated).filter(issue => issue.severity === "error"), [], `seed ${seed}`);
  }
});
