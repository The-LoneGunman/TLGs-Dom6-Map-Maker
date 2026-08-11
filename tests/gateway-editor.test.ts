import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GateLink } from "../src/domain";
import {
  gateEndpointIsUsed,
  gateNumberIsAvailable,
  gatesTouchingPlane,
  provinceAtLocalIndex,
  withoutPlaneGateEndpoints,
} from "../src/gatewayEditor";
import { ExistingGatewaysEditor } from "../src/MapMakerApp";
import { addPlane, createDefaultProject } from "../src/generator";

test("existing gateway editor lists only links touching the selected plane", () => {
  const gates: GateLink[] = [
    {
      id: "surface-cave",
      gateNumber: 7,
      endpoints: [
        { planeId: "surface", provinceId: "surface-1" },
        { planeId: "cave", provinceId: "cave-2" },
      ],
    },
    {
      id: "cloud-dream",
      gateNumber: 8,
      endpoints: [
        { planeId: "cloud", provinceId: "cloud-1" },
        { planeId: "dream", provinceId: "dream-2" },
      ],
    },
  ];

  assert.deepEqual(gatesTouchingPlane(gates, "surface").map((gate) => gate.id), ["surface-cave"]);
  assert.deepEqual(gatesTouchingPlane(gates, "cave").map((gate) => gate.id), ["surface-cave"]);
  assert.deepEqual(gatesTouchingPlane(gates, "underworld"), []);
});

test("gateway endpoint edits resolve a local province index to the stable province ID", () => {
  const project = createDefaultProject("gateway-editor-index");
  const plane = project.planes[0]!;
  const target = plane.provinces.at(-1)!;

  assert.equal(provinceAtLocalIndex(plane, target.index)?.id, target.id);
  assert.equal(provinceAtLocalIndex(plane, target.index)?.name, target.name);
  assert.equal(provinceAtLocalIndex(plane, 0), undefined);
  assert.equal(provinceAtLocalIndex(plane, 1.5), undefined);
  assert.equal(provinceAtLocalIndex(plane, 999_999), undefined);
});

test("gateway edits reject duplicate numbers and repeated endpoints", () => {
  const gate: GateLink = {
    id: "first",
    gateNumber: 7,
    endpoints: [
      { planeId: "surface", provinceId: "surface-1" },
      { planeId: "surface", provinceId: "surface-2" },
      { planeId: "cave", provinceId: "cave-1" },
    ],
  };
  const gates: GateLink[] = [
    gate,
    { id: "second", gateNumber: 8, endpoints: [] },
  ];

  assert.equal(gateNumberIsAvailable(gates, gate.id, 9), true);
  assert.equal(gateNumberIsAvailable(gates, gate.id, Number.MAX_SAFE_INTEGER), true);
  assert.equal(gateNumberIsAvailable(gates, gate.id, 8), false);
  assert.equal(gateNumberIsAvailable(gates, gate.id, 0), false);
  assert.equal(gateNumberIsAvailable(gates, gate.id, 1.5), false);
  assert.equal(gateNumberIsAvailable(gates, gate.id, Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(gateEndpointIsUsed(gate, "surface", "surface-2", 0), true);
  assert.equal(gateEndpointIsUsed(gate, "surface", "surface-1", 0), false);
  assert.equal(gateEndpointIsUsed(gate, "cave", "surface-2", 0), false);
});

test("plane removal preserves multi-endpoint gateway groups with two endpoints left", () => {
  const gates: GateLink[] = [
    {
      id: "three-way",
      gateNumber: 10,
      endpoints: [
        { planeId: "surface", provinceId: "surface-1" },
        { planeId: "cave", provinceId: "cave-1" },
        { planeId: "cloud", provinceId: "cloud-1" },
      ],
    },
    {
      id: "two-way",
      gateNumber: 11,
      endpoints: [
        { planeId: "surface", provinceId: "surface-2" },
        { planeId: "cave", provinceId: "cave-2" },
      ],
    },
  ];

  const remaining = withoutPlaneGateEndpoints(gates, "cave");
  assert.deepEqual(remaining.map((gate) => gate.id), ["three-way"]);
  assert.deepEqual(remaining[0]!.endpoints.map((endpoint) => endpoint.planeId), ["surface", "cloud"]);
  assert.equal(gates[0]!.endpoints.length, 3, "the helper does not mutate autosaved history objects");
});

test("existing gateway cards server-render shared numbers and every resolved endpoint", () => {
  const project = addPlane(createDefaultProject("gateway-editor-render"), "cave");
  const activePlane = project.planes[0]!;
  const otherPlane = project.planes[1]!;
  activePlane.name = "Surface Test Plane";
  otherPlane.name = "Cave Test Plane";
  const activeProvince = activePlane.provinces[0]!;
  const otherProvince = otherPlane.provinces[1]!;
  const gate: GateLink = {
    id: "rendered-gateway",
    gateNumber: 42,
    endpoints: [
      { planeId: activePlane.id, provinceId: activeProvince.id },
      { planeId: otherPlane.id, provinceId: otherProvince.id },
    ],
  };
  project.gates = [gate];

  const html = renderToStaticMarkup(createElement(ExistingGatewaysEditor, {
    project,
    activePlane,
    gates: [gate],
    mutateProject() {},
    onNotice() {},
  }));

  assert.match(html, /Gateway <code>#gate 42<\/code>/);
  assert.match(html, /Shared gate number/);
  assert.match(html, /Delete gateway/);
  assert.ok(html.includes(activePlane.name));
  assert.ok(html.includes(otherPlane.name));
  assert.ok(html.includes(`Local #${activeProvince.index}`));
  assert.ok(html.includes(activeProvince.id));
  assert.ok(html.includes(`Local #${otherProvince.index}`));
  assert.ok(html.includes(otherProvince.id));
  assert.match(html, /aria-label="Endpoint 1 local province index/);
  assert.match(html, /aria-label="Endpoint 2 local province index/);
});
