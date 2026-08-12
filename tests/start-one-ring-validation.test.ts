import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { compileMapText, validateProject } from "../src/dom6";
import { adjacencyFor, createDefaultProject } from "../src/generator";
import type { MapProject, Province } from "../src/domain";

type StartAnnotation = "generic" | "team" | "specific";

function isolatedStartProject(annotation: StartAnnotation): {
  project: MapProject;
  start: Province;
  adjacent: Province;
} {
  const project = createDefaultProject(`one-ring-${annotation}`);
  project.settings.players = 2;
  project.settings.startDistribution = undefined;
  project.specificStarts = [];
  const plane = project.planes[0]!;
  const originalStarts = plane.provinces.filter((province) => province.start);
  const start = originalStarts[0]!;
  assert.ok(start);
  for (const province of plane.provinces) {
    province.start = false;
    province.startType = undefined;
    province.teamStart = undefined;
  }
  if (annotation === "generic") start.start = true;
  else if (annotation === "team") start.teamStart = 0;
  else project.specificStarts = [{ nation: 5, planeId: plane.id, provinceId: start.id }];

  const adjacentId = adjacencyFor(plane).get(start.id)![0]!;
  const adjacent = plane.provinces.find((province) => province.id === adjacentId)!;
  assert.ok(adjacent);
  adjacent.defenders = [];
  adjacent.throne = "none";
  adjacent.fixedThrone = undefined;
  return { project, start, adjacent };
}

for (const annotation of ["generic", "team", "specific"] as const) {
  test(`${annotation} starts reject even small independent defenders throughout their one-ring`, () => {
    const { project, adjacent } = isolatedStartProject(annotation);
    adjacent.defenders = [{ commander: "34", squads: [] }];

    const issue = validateProject(project).find((entry) => entry.provinceId === adjacent.id
      && entry.message.includes("start one-ring")
      && entry.message.includes("independent defenders"));
    assert.equal(issue?.severity, "error");
  });

  test(`${annotation} starts reject recommended thrones throughout their one-ring`, () => {
    const { project, adjacent } = isolatedStartProject(annotation);
    adjacent.throne = "preferred";

    const issue = validateProject(project).find((entry) => entry.provinceId === adjacent.id
      && entry.message.includes("start one-ring")
      && entry.message.includes("thrones"));
    assert.equal(issue?.severity, "error");
  });
}

test("capital provinces reject both independent defenders and throne markers", () => {
  const { project, start } = isolatedStartProject("team");
  start.defenders = [{ commander: "34", squads: [] }];
  start.throne = "preferred";

  const issues = validateProject(project).filter((entry) => entry.provinceId === start.id);
  assert.ok(issues.some((entry) => entry.severity === "error" && entry.message.includes("guardian groups")));
  assert.ok(issues.some((entry) => entry.severity === "error" && entry.message.includes("free of thrones")));
});

test("validation is non-destructive and the compiler remains lossless for blocked authored one-ring content", () => {
  const { project, adjacent } = isolatedStartProject("generic");
  const throne = BUILTIN_DOM6_CATALOG.sites.find((site) => site.tags?.includes("throne"));
  assert.ok(throne);
  adjacent.defenders = [{ commander: "34", squads: [{ id: "authored-squad", unit: "18", count: 7 }] }];
  adjacent.throne = "fixed";
  adjacent.fixedThrone = String(throne.id);
  const before = structuredClone(project);

  const issues = validateProject(project);
  const text = compileMapText(project, 0);

  assert.ok(issues.some((entry) => entry.provinceId === adjacent.id && entry.severity === "error"
    && entry.message.includes("independent defenders")));
  assert.ok(issues.some((entry) => entry.provinceId === adjacent.id && entry.severity === "error"
    && entry.message.includes("thrones")));
  assert.match(text, new RegExp(`#feature ${throne.id}\\b`));
  assert.match(text, /#commander 34\r?\n#units 7 18/);
  assert.deepEqual(project, before, "validation and compilation must not silently erase authored content");
});

test("placed throne sites and raw special-unit commands cannot bypass one-ring validation", () => {
  const { project, adjacent } = isolatedStartProject("specific");
  const throne = BUILTIN_DOM6_CATALOG.sites.find((site) => site.tags?.includes("throne"));
  assert.ok(throne);
  adjacent.sites = [{ id: "authored-throne-site", value: String(throne.id), known: true }];
  adjacent.rawDirectives = "#commander 34\n#units 5 18";
  const before = structuredClone(project);

  const issues = validateProject(project);
  const text = compileMapText(project, 0);

  assert.ok(issues.some((entry) => entry.provinceId === adjacent.id && entry.severity === "error"
    && entry.message.includes(`throne site ${throne.name}`)));
  assert.ok(issues.some((entry) => entry.provinceId === adjacent.id && entry.severity === "error"
    && entry.message.includes("raw independent-defender directives")));
  assert.match(text, new RegExp(`#knownfeature ${throne.id}\\b`));
  assert.match(text, /#commander 34\r?\n#units 5 18/);
  assert.deepEqual(project, before, "advanced authored directives remain available for correction instead of being silently removed");
});

function manualCustomStartProject(variant: "temperate" | "storm", ownershipMode: "solid" | "sparse"): MapProject {
  const project = createDefaultProject(`manual-custom-${variant}-${ownershipMode}`);
  const plane = project.planes[0]!;
  const originalStarts = plane.provinces.filter((province) => province.start && province.startType === "land").slice(0, 2);
  assert.equal(originalStarts.length, 2);
  for (const province of plane.provinces) {
    province.start = false;
    province.startType = undefined;
  }
  for (const province of originalStarts) province.start = true;
  plane.kind = "custom";
  plane.variant = variant;
  plane.ownershipMode = ownershipMode;
  project.settings.players = 2;
  project.settings.startDistribution = variant === "temperate" && ownershipMode === "solid"
    ? { land: 2, coastal: 0, water: 0, cave: 0, other: 0 }
    : { land: 0, coastal: 0, water: 0, cave: 0, other: 2 };
  return project;
}

test("manual starts on a surface-like solid Custom plane classify as overland", () => {
  const project = manualCustomStartProject("temperate", "solid");
  const allocationErrors = validateProject(project).filter((issue) => issue.severity === "error"
    && (issue.message.includes("land starts") || issue.message.includes("other starts")));
  assert.deepEqual(allocationErrors, []);
});

test("manual starts on special or sparse Custom planes classify as Other", () => {
  for (const project of [
    manualCustomStartProject("storm", "solid"),
    manualCustomStartProject("temperate", "sparse"),
  ]) {
    const allocationErrors = validateProject(project).filter((issue) => issue.severity === "error"
      && (issue.message.includes("land starts") || issue.message.includes("other starts")));
    assert.deepEqual(allocationErrors, [], `${project.seed}: ${allocationErrors.map((issue) => issue.message).join("; ")}`);
  }
});
