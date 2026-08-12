import assert from "node:assert/strict";
import test from "node:test";
import { parseProject } from "../src/export";
import { addPlane, createDefaultProject } from "../src/generator";

interface MutableProvince extends Record<string, unknown> {
  battle: unknown;
  sites: unknown;
}

interface MutablePlane extends Record<string, unknown> {
  provinces: MutableProvince[];
  edges: Array<Record<string, unknown>>;
}

interface MutableSettings extends Record<string, unknown> {
  startDistribution: Record<string, unknown>;
}

interface MutableProject extends Record<string, unknown> {
  settings: MutableSettings;
  planes: MutablePlane[];
}

function serializedMutation(recipe: (draft: MutableProject) => void): string {
  const draft = JSON.parse(JSON.stringify(createDefaultProject("import-shape"))) as MutableProject;
  recipe(draft);
  return JSON.stringify(draft);
}

test("project import preserves a complete schema-v1 project and optional-field migrations", () => {
  const project = createDefaultProject("import-valid-v1");
  const province = project.planes[0]!.provinces.find((entry) => !entry.start)!;
  province.terrain = "freshwater";
  province.startType = "water";
  delete project.settings.startDistribution;
  delete project.settings.startDegreeTarget;
  delete project.settings.caveStartNations;
  delete project.settings.gateLayout;
  delete project.settings.gateDirection;
  delete project.planes[0]!.ownershipMode;

  const restored = parseProject(JSON.stringify(project));

  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.seed, project.seed);
  const migrated = restored.planes[0]!.provinces.find((entry) => entry.id === province.id)!;
  assert.equal(migrated.terrain, "plains");
  assert.equal(migrated.freshwater, true);
  assert.equal(migrated.startType, "land");
});

test("project import rejects a missing atlas but round-trips intentionally staged empty planes", () => {
  assert.throws(
    () => parseProject(serializedMutation((draft) => { delete (draft as Record<string, unknown>).planes; })),
    /project\.planes must be an array/,
  );
  assert.throws(
    () => parseProject(serializedMutation((draft) => { draft.planes = []; })),
    /project\.planes must contain at least one plane/,
  );
  const staged = addPlane(createDefaultProject("import-staged-plane"), "underworld", { generate: false });
  const restored = parseProject(JSON.stringify(staged));
  assert.equal(restored.planes.length, 2);
  assert.equal(restored.planes[1]!.provinces.length, 0);
  assert.equal(restored.planes[1]!.kind, "underworld");
});

test("project import rejects province arrays that do not match local province-number order", () => {
  assert.throws(() => parseProject(serializedMutation((draft) => {
    const first = draft.planes[0]!.provinces[0]!;
    draft.planes[0]!.provinces[0] = draft.planes[0]!.provinces[1]!;
    draft.planes[0]!.provinces[1] = first;
  })), /must be stored in local province-number order/);
});

test("project import rejects malformed required top-level and settings fields", () => {
  const cases: Array<[(draft: MutableProject) => void, RegExp]> = [
    [(draft) => { draft.name = 42; }, /project\.name must be a string/],
    [(draft) => { (draft as Record<string, unknown>).settings = null; }, /project\.settings must be an object/],
    [(draft) => { draft.settings.players = "six"; }, /project\.settings\.players must be a finite number/],
    [(draft) => { draft.settings.waterPercent = Number.NaN; }, /project\.settings\.waterPercent must be a finite number/],
    [(draft) => { draft.settings.resolution = "poster"; }, /project\.settings\.resolution has an unsupported value/],
    [(draft) => { draft.settings.oceanLayout = "square_ocean"; }, /project\.settings\.oceanLayout has an unsupported value/],
    [(draft) => { draft.settings.specialPlaneSizePercent = "thirty"; }, /specialPlaneSizePercent must be a finite number/],
    [(draft) => { draft.settings.startDistribution.land = false; }, /startDistribution\.land must be a finite number/],
    [(draft) => { draft.gates = {}; }, /project\.gates must be an array/],
  ];

  for (const [mutation, pattern] of cases) {
    assert.throws(() => parseProject(serializedMutation(mutation)), pattern);
  }
});

test("project import rejects malformed required plane and province fields with a useful path", () => {
  const cases: Array<[(draft: MutableProject) => void, RegExp]> = [
    [(draft) => { draft.planes[0].id = ""; }, /project\.planes\[0\]\.id must not be empty/],
    [(draft) => { draft.planes[0].kind = "moon"; }, /project\.planes\[0\]\.kind has an unsupported value/],
    [(draft) => { draft.planes[0].width = "3840"; }, /project\.planes\[0\]\.width must be a finite number/],
    [(draft) => { draft.planes[0].wrapX = 1; }, /project\.planes\[0\]\.wrapX must be a boolean/],
    [(draft) => { (draft.planes[0]!.provinces as unknown[])[0] = null; }, /project\.planes\[0\]\.provinces\[0\] must be an object/],
    [(draft) => { draft.planes[0].provinces[0].x = null; }, /provinces\[0\]\.x must be a finite number/],
    [(draft) => { draft.planes[0].provinces[0].terrain = "lava"; }, /provinces\[0\]\.terrain has an unsupported value/],
    [(draft) => { draft.planes[0].provinces[0].sites = "site"; }, /provinces\[0\]\.sites must be an array/],
    [(draft) => { draft.planes[0].provinces[0].battle = []; }, /provinces\[0\]\.battle must be an object/],
    [(draft) => { draft.planes[0].edges[0].kind = "portal"; }, /edges\[0\]\.kind has an unsupported value/],
  ];

  for (const [mutation, pattern] of cases) {
    assert.throws(() => parseProject(serializedMutation(mutation)), pattern);
  }
});

test("project import rejects unsupported schemas and non-project JSON without crashing", () => {
  assert.throws(() => parseProject("null"), /not a Pantokrator Atlas project/);
  assert.throws(() => parseProject("[]"), /not a Pantokrator Atlas project/);
  assert.throws(() => parseProject(JSON.stringify({ schemaVersion: 99 })), /Unsupported project schema 99/);
  assert.throws(() => parseProject("{oops"), SyntaxError);
});

test("project import preserves valid generation policies and rejects unknown values", () => {
  const project = createDefaultProject("policy-import");
  project.settings.economyBalance = "soft";
  project.settings.overlandTopology = "strategic";
  project.planes[0]!.noGeneratedStarts = true;
  project.generationWarnings = ["A constrained manual realm retained fewer guardians than requested."];

  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.settings.economyBalance, "soft");
  assert.equal(parsed.settings.overlandTopology, "strategic");
  assert.equal(parsed.planes[0]!.noGeneratedStarts, true);
  assert.deepEqual(parsed.generationWarnings, project.generationWarnings);

  assert.throws(() => parseProject(serializedMutation((draft) => {
    draft.settings.economyBalance = "maximum";
  })), /project\.settings\.economyBalance has an unsupported value/);
  assert.throws(() => parseProject(serializedMutation((draft) => {
    draft.settings.overlandTopology = "maze";
  })), /project\.settings\.overlandTopology has an unsupported value/);
  assert.throws(() => parseProject(serializedMutation((draft) => {
    draft.generationWarnings = [42];
  })), /project\.generationWarnings\[0\] must be a string/);
  assert.throws(() => parseProject(serializedMutation((draft) => {
    draft.planes[0]!.noGeneratedStarts = "yes";
  })), /project\.planes\[0\]\.noGeneratedStarts must be a boolean/);
});
