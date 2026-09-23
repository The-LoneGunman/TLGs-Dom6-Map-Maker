import assert from "node:assert/strict";
import test from "node:test";
import type { MapProject } from "../src/domain";
import {
  MAX_IMPORTED_DIRECTIVE_LENGTH,
  MAX_IMPORTED_EDGES_PER_PLANE,
  MAX_IMPORTED_GATE_ENDPOINTS,
  MAX_IMPORTED_GATES,
  MAX_IMPORTED_GUARDIAN_SQUADS,
  MAX_IMPORTED_ID_LENGTH,
  MAX_IMPORTED_PLANES,
  MAX_IMPORTED_PROVINCES_PER_PLANE,
  MAX_IMPORTED_STRING_LENGTH,
  MAX_PROJECT_IMPORT_BYTES,
  parseProject,
  serializeProject,
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

/** `count` gates of `size` endpoints each, cycling over the first plane's provinces. */
function gatesWithEndpoints(draft: MapProject, count: number, size: number): MapProject["gates"] {
  const plane = draft.planes[0]!;
  return Array.from({ length: count }, (_, gate) => ({
    id: `gate-${gate + 1}`,
    gateNumber: gate + 1,
    endpoints: Array.from({ length: size }, (_, endpoint) => ({
      planeId: plane.id,
      provinceId: plane.provinces[(gate * size + endpoint) % plane.provinces.length]!.id,
    })),
  }));
}

/** Only `provinces` provinces keep guardians: 32 groups of 64 squads (2,048 squads) each. */
function maximalGuardians(draft: MapProject, provinces: number, extraSquads = 0): void {
  for (const plane of draft.planes) for (const province of plane.provinces) province.defenders = [];
  const targets = draft.planes[0]!.provinces.slice(0, provinces + (extraSquads > 0 ? 1 : 0));
  targets.forEach((province, provinceIndex) => {
    const extra = provinceIndex === provinces;
    province.defenders = Array.from({ length: extra ? 1 : 32 }, (_, group) => ({
      commander: "Commander",
      squads: Array.from({ length: extra ? extraSquads : 64 }, (_, squad) => ({ id: `squad-${group}-${squad}`, unit: "Unit", count: 1 })),
    }));
  });
}

test("project import bounds project-wide gateway endpoints and guardian squads", () => {
  // Every individually permitted gate count still fits as two-endpoint gateways.
  assert.equal(MAX_IMPORTED_GATE_ENDPOINTS, 2 * MAX_IMPORTED_GATES);
  const pairs = parseProject(serializedMutation((draft) => { draft.gates = gatesWithEndpoints(draft, MAX_IMPORTED_GATES, 2); }));
  assert.equal(pairs.gates.length, MAX_IMPORTED_GATES);
  const wide = parseProject(serializedMutation((draft) => { draft.gates = gatesWithEndpoints(draft, MAX_IMPORTED_GATE_ENDPOINTS / 64, 64); }));
  assert.equal(wide.gates.reduce((sum, gate) => sum + gate.endpoints.length, 0), MAX_IMPORTED_GATE_ENDPOINTS);

  // 64 endpoints per gate and 2,048 gates are each allowed, but not together.
  const overEndpoints = [
    (draft: MapProject) => { draft.gates = gatesWithEndpoints(draft, MAX_IMPORTED_GATES, 64); },
    (draft: MapProject) => {
      draft.gates = gatesWithEndpoints(draft, MAX_IMPORTED_GATES, 2);
      draft.gates[0]!.endpoints.push({ planeId: draft.planes[0]!.id, provinceId: draft.planes[0]!.provinces.at(-1)!.id });
    },
  ];
  for (const mutation of overEndpoints) {
    assert.throws(() => parseProject(serializedMutation(mutation)), /project\.gates must contain at most 4096 gateway endpoints in total/);
  }

  const squadsPerProvince = 32 * 64;
  const fullProvinces = MAX_IMPORTED_GUARDIAN_SQUADS / squadsPerProvince;
  const atLimit = parseProject(serializedMutation((draft) => maximalGuardians(draft, fullProvinces)));
  assert.equal(atLimit.planes.flatMap((plane) => plane.provinces).reduce((sum, province) =>
    sum + province.defenders.reduce((groups, group) => groups + group.squads.length, 0), 0), MAX_IMPORTED_GUARDIAN_SQUADS);
  assert.throws(
    () => parseProject(serializedMutation((draft) => maximalGuardians(draft, fullProvinces, 1))),
    /Guardian groups across the project must contain at most 16384 squads in total/,
  );

  // Editor edits, autosave and project downloads share the same ceiling.
  const draft = structuredClone(createDefaultProject("import-envelope-serialize"));
  draft.gates = gatesWithEndpoints(draft, MAX_IMPORTED_GATES, 64);
  assert.throws(() => serializeProject(draft), /at most 4096 gateway endpoints in total/);
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

test("project import rejects unknown state instead of retaining an unbounded hidden payload", () => {
  assert.throws(() => parseProject(serializedMutation((draft) => {
    (draft as MapProject & { hiddenPayload: unknown }).hiddenPayload = { retained: true };
  })), /project\.hiddenPayload is not supported by project schema version 1/);

  assert.throws(() => parseProject(serializedMutation((draft) => {
    const battle = draft.planes[0]!.provinces[0]!.battle as typeof draft.planes[0]["provinces"][number]["battle"] & {
      nestedPayload: unknown;
    };
    battle.nestedPayload = { retained: true };
  })), /\.battle\.nestedPayload is not supported by project schema version 1/);

  // JSON.parse itself can handle nesting well beyond JSON.stringify's call
  // stack. Reject the unknown root field before cloneProject or package-size
  // estimation recursively traverses attacker-controlled data.
  const valid = JSON.stringify(createDefaultProject("deep-unknown-import"));
  const nested = `${"[".repeat(8_000)}0${"]".repeat(8_000)}`;
  const adversarial = `${valid.slice(0, -1)},"hiddenPayload":${nested}}`;
  assert.throws(
    () => parseProject(adversarial),
    /project\.hiddenPayload is not supported by project schema version 1/,
  );
});
