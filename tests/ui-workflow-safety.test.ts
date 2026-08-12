import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addPlane, createDefaultProject } from "../src/generator";
import {
  appendHistorySnapshot,
  applyPrimaryTerrain,
  armedEndpointCopy,
  atlasReplacementImpact,
  atlasReplacementNeedsConfirmation,
  planeRemovalImpact,
} from "../src/uiWorkflow";

test("populated atlases require replacement confirmation even when edit provenance is incomplete", () => {
  const project = createDefaultProject("replacement-impact");
  const impact = atlasReplacementImpact(project);
  assert.equal(impact.planeCount, 1);
  assert.equal(impact.provinceCount, project.planes[0]!.provinces.length);
  assert.equal(impact.gatewayCount, 0);
  assert.equal(atlasReplacementNeedsConfirmation(impact), true);

  project.planes[0]!.provinces = [];
  assert.equal(atlasReplacementNeedsConfirmation(atlasReplacementImpact(project)), false);
  project.gates.push({ id: "manual", gateNumber: 1, endpoints: [] });
  assert.equal(atlasReplacementNeedsConfirmation(atlasReplacementImpact(project)), true, "a gateway alone is authored content");
});

test("plane removal impact reports every associated recovery concern", () => {
  const project = addPlane(createDefaultProject("remove-impact"), "cave", { generate: false });
  const surface = project.planes[0]!;
  const cave = project.planes[1]!;
  project.gates.push({
    id: "touching-gate",
    gateNumber: 3,
    endpoints: [
      { planeId: surface.id, provinceId: surface.provinces[0]!.id },
      { planeId: cave.id, provinceId: "planned-cave-province" },
    ],
  });
  project.specificStarts.push({ nation: 15, planeId: cave.id, provinceId: "planned-cave-province" });

  assert.deepEqual(planeRemovalImpact(project, cave.id), {
    planeName: cave.name,
    provinceCount: 0,
    gatewayCount: 1,
    specificStartCount: 1,
  });
  assert.equal(planeRemovalImpact(project, "missing-plane"), undefined);
});

test("coalesced slider history keeps a bounded starting snapshot", () => {
  assert.deepEqual(appendHistorySnapshot([1, 2, 3], 4, 3), [2, 3, 4]);
  assert.deepEqual(appendHistorySnapshot([], "before"), ["before"]);
});

test("armed endpoint copy names the exact source and explains same-plane and cross-plane choices", () => {
  const project = addPlane(createDefaultProject("armed-copy"), "cave", { generate: false });
  const surface = project.planes[0]!;
  const endpoint = { planeId: surface.id, provinceId: surface.provinces[0]!.id };

  assert.match(armedEndpointCopy(project, "link", endpoint, surface.id), /Link source: Plane 1 .* province #1/);
  assert.match(armedEndpointCopy(project, "link", endpoint, project.planes[1]!.id), /click a province on this plane to replace the source/);
  assert.match(armedEndpointCopy(project, "gate", endpoint, surface.id), /on this plane or another plane/);
});

test("choosing primary Cave wall atomically removes every unsafe start, throne, and guardian marker", () => {
  const project = createDefaultProject("primary-cave-wall");
  const plane = project.planes[0]!;
  const province = plane.provinces[0]!;
  province.terrainFlags = ["forest", "cavewall"];
  province.start = true;
  province.startType = "coastal";
  province.teamStart = 2;
  province.noStart = false;
  province.throne = "fixed";
  province.fixedThrone = "1361";
  province.defenders = [{ commander: "34", squads: [] }];
  project.specificStarts.push({ nation: 15, planeId: plane.id, provinceId: province.id });

  assert.equal(applyPrimaryTerrain(project, plane.id, province.id, "cavewall"), true);
  assert.equal(province.terrain, "cavewall");
  assert.deepEqual(province.terrainFlags, ["forest"], "the newly inherent Cave-wall flag is not duplicated");
  assert.equal(province.noStart, true);
  assert.equal(province.start, false);
  assert.equal(province.startType, undefined);
  assert.equal(province.teamStart, undefined);
  assert.equal(province.throne, "none");
  assert.equal(province.fixedThrone, undefined);
  assert.deepEqual(province.defenders, []);
  assert.equal(project.specificStarts.some((start) => start.planeId === plane.id && start.provinceId === province.id), false);
  assert.equal(applyPrimaryTerrain(project, plane.id, "missing", "plains"), false);
});

test("MapMaker exposes confirmations, backup recovery, armed-state detail, and slider gesture boundaries", () => {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  assert.match(source, />New atlas</);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, />Download backup</);
  assert.match(source, /setDestructiveConfirmation\(\{ kind: "generate", impact \}\)/);
  assert.match(source, /requestRemovePlane\(activePlane\.id\)/);
  assert.match(source, /onInteractionStart=\{beginRangeEdit\}/);
  assert.match(source, /onInteractionEnd=\{finishRangeEdit\}/);
  assert.match(source, /setRedoStack\(\[\]\)/);
  assert.match(source, /Same-plane gateway linked\./);
  assert.match(source, /Cancel endpoint/);
});
