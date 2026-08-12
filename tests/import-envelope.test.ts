import assert from "node:assert/strict";
import test from "node:test";
import type { MapProject } from "../src/domain";
import {
  MAX_IMPORTED_DIRECTIVE_LENGTH,
  MAX_IMPORTED_EDGES_PER_PLANE,
  MAX_IMPORTED_GATES,
  MAX_IMPORTED_ID_LENGTH,
  MAX_IMPORTED_PLANES,
  MAX_IMPORTED_PROVINCES_PER_PLANE,
  MAX_IMPORTED_STRING_LENGTH,
  MAX_PROJECT_IMPORT_BYTES,
  parseProject,
} from "../src/export";
import { createDefaultProject } from "../src/generator";

function serializedMutation(recipe: (draft: MapProject) => void): string {
  const draft = structuredClone(createDefaultProject("import-envelope"));
  recipe(draft);
  return JSON.stringify(draft);
}

test("project import accepts only bounded delimiter-safe stable IDs and references", () => {
  const cases: Array<[(draft: MapProject) => void, RegExp]> = [
    [(draft) => { draft.planes[0]!.id = "plane:one"; }, /planes\[0\]\.id may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.planes[0]!.provinces[0]!.id = "province\0one"; }, /provinces\[0\]\.id may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.planes[0]!.edges[0]!.id = "edge/one"; }, /edges\[0\]\.id may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.planes[0]!.edges[0]!.a = "province:one"; }, /edges\[0\]\.a may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.gates.push({ id: "gate.one", gateNumber: 1, endpoints: [
      { planeId: draft.planes[0]!.id, provinceId: draft.planes[0]!.provinces[0]!.id },
      { planeId: draft.planes[0]!.id, provinceId: draft.planes[0]!.provinces[1]!.id },
    ] }); }, /gates\[0\]\.id may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.gates.push({ id: "safe-gate", gateNumber: 1, endpoints: [
      { planeId: "plane:one", provinceId: draft.planes[0]!.provinces[0]!.id },
      { planeId: draft.planes[0]!.id, provinceId: draft.planes[0]!.provinces[1]!.id },
    ] }); }, /endpoints\[0\]\.planeId may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.specificStarts.push({ nation: 5, planeId: draft.planes[0]!.id, provinceId: "province:one" }); }, /specificStarts\[0\]\.provinceId may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.settings.planeConnections = [{ a: draft.planes[0]!.id, b: "plane:two", pairs: 1 }]; }, /planeConnections\[0\]\.b may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.planes[0]!.provinces[0]!.sites.push({ id: "site:one", value: "1", known: false }); }, /sites\[0\]\.id may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.planes[0]!.provinces[0]!.defenders.push({ commander: "1", squads: [{ id: "squad:one", unit: "1", count: 1 }] }); }, /squads\[0\]\.id may contain only letters, digits, underscores, and hyphens/],
    [(draft) => { draft.planes[0]!.id = "x".repeat(MAX_IMPORTED_ID_LENGTH + 1); }, /planes\[0\]\.id must contain at most 128 characters/],
  ];

  for (const [mutation, expected] of cases) {
    assert.throws(() => parseProject(serializedMutation(mutation)), expected);
  }
});

test("project import bounds plane, province, edge, and gate collections", () => {
  assert.throws(() => parseProject(serializedMutation((draft) => {
    const template = draft.planes[0]!;
    draft.planes = Array.from({ length: MAX_IMPORTED_PLANES + 1 }, (_, index) => ({
      ...structuredClone(template),
      id: `plane-${index + 1}`,
    }));
  })), /project\.planes must contain at most 8 entries/);

  assert.throws(() => parseProject(serializedMutation((draft) => {
    const plane = draft.planes[0]!;
    const template = plane.provinces[0]!;
    plane.provinces = Array.from({ length: MAX_IMPORTED_PROVINCES_PER_PLANE + 1 }, (_, index) => ({
      ...structuredClone(template),
      id: `province-${index + 1}`,
      index: index + 1,
    }));
  })), /provinces must contain at most 800 entries/);

  assert.throws(() => parseProject(serializedMutation((draft) => {
    const plane = draft.planes[0]!;
    plane.edges = Array.from({ length: MAX_IMPORTED_EDGES_PER_PLANE + 1 }, (_, index) => ({
      id: `edge-${index + 1}`,
      a: plane.provinces[0]!.id,
      b: plane.provinces[1]!.id,
      kind: "standard",
    }));
  })), /edges must contain at most 6400 entries/);

  assert.throws(() => parseProject(serializedMutation((draft) => {
    const plane = draft.planes[0]!;
    draft.gates = Array.from({ length: MAX_IMPORTED_GATES + 1 }, (_, index) => ({
      id: `gate-${index + 1}`,
      gateNumber: index + 1,
      endpoints: [
        { planeId: plane.id, provinceId: plane.provinces[0]!.id },
        { planeId: plane.id, provinceId: plane.provinces[1]!.id },
      ],
    }));
  })), /project\.gates must contain at most 2048 entries/);
});

test("project import bounds ordinary strings, directive blocks, and UTF-8 file size before JSON parsing", () => {
  assert.throws(() => parseProject(serializedMutation((draft) => {
    draft.description = "x".repeat(MAX_IMPORTED_STRING_LENGTH + 1);
  })), /project\.description must contain at most 4096 characters/);

  for (const mutation of [
    (draft: MapProject) => { draft.rawDirectives = "#".repeat(MAX_IMPORTED_DIRECTIVE_LENGTH + 1); },
    (draft: MapProject) => { draft.planes[0]!.rawDirectives = "#".repeat(MAX_IMPORTED_DIRECTIVE_LENGTH + 1); },
    (draft: MapProject) => { draft.planes[0]!.provinces[0]!.rawDirectives = "#".repeat(MAX_IMPORTED_DIRECTIVE_LENGTH + 1); },
  ]) {
    assert.throws(() => parseProject(serializedMutation(mutation)), /must contain at most 262144 characters/);
  }

  assert.throws(
    () => parseProject(" ".repeat(MAX_PROJECT_IMPORT_BYTES + 1)),
    /Project files must be at most 16777216 UTF-8 bytes/,
  );
});
