import assert from "node:assert/strict";
import test from "node:test";
import type { EdgeKind, MapProject, Plane } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import { buildHostTopologyReport } from "../src/hostReport";

const EDGE_KINDS: EdgeKind[] = [
  "standard",
  "mountain_border",
  "mountain_pass",
  "river",
  "bridge",
  "impassable",
  "road",
  "custom",
];

function reportFixture(): MapProject {
  const project = createDefaultProject("host-report-fixture");
  project.name = "Host's Atlas";
  project.rawDirectives = "#private_project alpha\n\n#private_project beta";

  const surface = project.planes[0]!;
  surface.id = "surface-plane";
  surface.name = "The Surface";
  surface.rawDirectives = "#private_plane surface-secret";
  surface.provinces = surface.provinces.slice(0, 2).map((province, index) => ({
    ...province,
    id: `surface-${index + 1}`,
    index: index + 1,
    name: index ? "Team Coast" : "Open March",
    terrain: index ? "sea" : "forest",
    terrainFlags: index ? ["cave"] : ["freshwater"],
    start: index === 0,
    startType: index === 0 ? "land" : undefined,
    teamStart: index === 1 ? 3 : undefined,
    throne: index === 1 ? "avoid" : "none",
    rawDirectives: index === 0 ? "#private_province one\n#private_province two" : "",
  }));
  surface.edges = EDGE_KINDS.map((kind, index) => ({
    id: `surface-edge-${index}`,
    a: "surface-1",
    b: "surface-2",
    kind,
    special: kind === "custom" ? 77 : undefined,
  }));

  const cave: Plane = {
    ...surface,
    id: "cave-plane",
    name: "Deep Realm",
    kind: "cave",
    wrapX: false,
    wrapY: false,
    rawDirectives: "",
    provinces: surface.provinces.map((province, index) => ({
      ...province,
      id: `cave-${index + 1}`,
      index: index + 1,
      name: index ? "Throne Vault" : "Agarthan Descent",
      terrain: index ? "cavehighland" : "cave",
      terrainFlags: index ? ["waste"] : undefined,
      start: false,
      startType: undefined,
      teamStart: undefined,
      noStart: false,
      throne: index ? "fixed" : "none",
      fixedThrone: index ? "1361" : undefined,
      rawDirectives: "",
    })),
    edges: [{ id: "cave-river", a: "cave-1", b: "cave-2", kind: "river" }],
  };
  project.planes = [surface, cave];
  project.specificStarts = [
    { nation: 17, planeId: cave.id, provinceId: "cave-1" },
    { nation: 99, planeId: cave.id, provinceId: "missing-cave-province" },
  ];
  project.gates = [{
    id: "three-way-gate",
    gateNumber: 42,
    adjacentStartFallback: true,
    endpoints: [
      { planeId: surface.id, provinceId: "surface-2" },
      { planeId: cave.id, provinceId: "cave-1" },
      { planeId: cave.id, provinceId: "cave-2" },
    ],
  }];
  return project;
}

test("host dossier reports all-plane numbering, markers, edges, and multi-endpoint gates", () => {
  const report = buildHostTopologyReport(reportFixture());

  assert.match(report, /HOST ONLY — DO NOT DISTRIBUTE TO PLAYERS/);
  assert.match(report, /## Spoiler-aware summary/);
  assert.match(report, /Plane 1: "The Surface" \(surface\)/);
  assert.match(report, /Plane 2: "Deep Realm" \(cave\)/);
  assert.match(report, /L#1 \/ G#1 \| "Open March"/);
  assert.match(report, /L#2 \/ G#2 \| "Team Coast"/);
  assert.match(report, /L#1 \/ G#3 \| "Agarthan Descent"/);
  assert.match(report, /L#2 \/ G#4 \| "Throne Vault"/);
  assert.match(report, /terrain=Sea \[effective: Sea \+ Cave\]/);
  assert.match(report, /generic start \(land\)/);
  assert.match(report, /team start=3/);
  assert.match(report, /specific start=nation 17/);
  assert.match(report, /throne=avoid/);
  assert.match(report, /throne=fixed \(1361\)/);

  for (const kind of EDGE_KINDS) assert.match(report, new RegExp(`border=${kind}`));
  assert.match(report, /border=custom \(special 77\)/);
  assert.match(report, /### Gate #42 \| group="three-way-gate" \| endpoints=3 \| adjacent-start fallback used/);
  assert.match(report, /Plane 1 "The Surface" \/ L#2 \/ G#2 \/ "Team Coast"/);
  assert.match(report, /Plane 2 "Deep Realm" \/ L#1 \/ G#3 \/ "Agarthan Descent"/);
  assert.match(report, /Plane 2 "Deep Realm" \/ L#2 \/ G#4 \/ "Throne Vault"/);
  assert.match(report, /Nation 99 -> plane id "cave-plane" \/ province id "missing-cave-province"/);
});

test("host dossier redacts all raw directive contents while reporting only presence and counts", () => {
  const report = buildHostTopologyReport(reportFixture());

  assert.doesNotMatch(report, /private_project|private_plane|private_province|surface-secret|alpha|beta/);
  assert.match(report, /Advanced raw directives: 3 populated scopes \| 5 nonblank lines \(contents redacted\)/);
  assert.match(report, /Raw directives: 1 line \(contents redacted\)/);
  assert.match(report, /raw directives=2 lines \(redacted\)/);
});

test("host dossier is deterministic, does not mutate the project, and records missing topology endpoints", () => {
  const project = reportFixture();
  project.planes[0]!.edges.push({ id: "missing-edge", a: "surface-1", b: "absent", kind: "impassable" });
  project.gates[0]!.endpoints.push({ planeId: "missing-plane", provinceId: "missing-province" });
  const before = structuredClone(project);

  const first = buildHostTopologyReport(project);
  const second = buildHostTopologyReport(project);

  assert.equal(first, second);
  assert.deepEqual(project, before);
  assert.match(first, /\[missing province id "absent"\]/);
  assert.match(first, /\[missing plane id "missing-plane"\] \/ \[province id "missing-province"\]/);
});

test("host dossier reports opt-in defender coverage without exposing raw directives or implying matched rosters", () => {
  const project = reportFixture();
  const disabledReport = buildHostTopologyReport(project);
  project.populationDefense = { enabled: false, profileRevision: "no-verified-data" };
  assert.equal(buildHostTopologyReport(project), disabledReport);
  project.populationDefense.enabled = true;
  const before = JSON.stringify(project);
  const report = buildHostTopologyReport(project);
  assert.match(report, /Population-matched initial defenders: revision "no-verified-data"/);
  assert.match(report, /Defense coverage: 0 matched/);
  assert.match(report, /not persistent provincial defense/);
  assert.match(report, /initial defenders=(?:custom|excluded|unsupported)/);
  assert.doesNotMatch(report, /private_project|private_plane|private_province|surface-secret|alpha|beta/);
  assert.equal(JSON.stringify(project), before);
});
