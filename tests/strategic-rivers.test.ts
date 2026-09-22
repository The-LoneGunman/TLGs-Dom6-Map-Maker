import assert from "node:assert/strict";
import test from "node:test";
import { generateBorderRivers } from "../src/borderRivers";
import { validateProject } from "../src/dom6";
import { effectiveProvinceTerrainFlags, isBlockedProvince, isWaterProvince, type Edge, type MapProject, type Plane, type Province } from "../src/domain";
import {
  applyGeneratedOverlandTopology,
  createDefaultProject,
  finalizeGeneratedRivers,
  generatePlane,
  generateProject,
} from "../src/generator";
import { computeProvinceTopology, connectionKey, type Point } from "../src/geometry";

// Strategic topology marks wet chokepoints as rivers. The connected-river pass
// used to reset them with every provisional river roll, so they vanished. They
// must now be routed as part of continuous watercourses (or, where no border
// river can exist, keep the strategic pass's dry barrier).

function grid(columns = 7, rows = 6, coast = true): Plane {
  const provinces: Province[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const terrain = coast && row === rows - 1 ? "sea" : row === 0 ? "mountains" : row === 1 ? "highland" : "swamp";
    provinces.push({ id: `sr-${column}-${row}`, index: provinces.length + 1,
      x: (column + .5) / columns, y: (row + .5) / rows, gridX: column, gridY: row,
      name: `Strategic river ${column} ${row}`, biome: "heartland", terrain, terrainFlags: [], freshwater: false,
      small: false, large: false, noStart: false, manySites: false, warmer: false, colder: false,
      siteBias: [], start: false, throne: "none", sites: [], killRandomSites: false,
      temple: false, lab: false, defenders: [], battle: {}, rawDirectives: "" });
  }
  const plane: Plane = { id: "strategic-river-fixture", name: "Strategic river fixture", kind: "surface", variant: "temperate",
    ownershipMode: "solid", provinceTarget: provinces.length, width: 512, height: 384,
    wrapX: false, wrapY: false, provinces, edges: [], rawDirectives: "" };
  plane.edges = computeProvinceTopology(plane).pairs.map((pair, index) => ({ id: `sr-e-${index}`, a: pair.a, b: pair.b, kind: "standard" }));
  return plane;
}

const key = (a: string, b: string) => connectionKey(a, b);
const at = (column: number, row: number) => `sr-${column}-${row}`;
const isChannel = (edge: Edge) => edge.kind === "river" || edge.kind === "bridge";
function edgeFor(plane: Plane, pair: string): Edge {
  const edge = plane.edges.find(candidate => key(candidate.a, candidate.b) === pair);
  assert.ok(edge, `expected border ${pair}`);
  return edge;
}

/** Independent geometric oracle: groups river/bridge borders by shared physical endpoints. */
function channelNetworks(plane: Plane): Map<string, { pairs: number; tree: boolean }> {
  const pointKey = (point: Point) => {
    const axis = (value: number, wrapped: boolean) => {
      const rounded = Math.round(value * 1e8);
      return wrapped && (rounded === 0 || rounded === 1e8) ? 0 : rounded;
    };
    return `${axis(point.x, plane.wrapX)}:${axis(point.y, plane.wrapY)}`;
  };
  const selected = new Set(plane.edges.filter(isChannel).map(edge => key(edge.a, edge.b)));
  const pieces = new Map<string, { pair: string; from: string; to: string }>(), incident = new Map<string, Set<string>>();
  for (const [pair, segments] of computeProvinceTopology(plane).sharedBorders) {
    if (!selected.has(pair)) continue;
    for (const segment of segments) {
      const from = pointKey(segment.from), to = pointKey(segment.to), piece = `${pair}:${[from, to].sort().join("/")}`;
      if (pieces.has(piece)) continue;
      pieces.set(piece, { pair, from, to });
      for (const node of [from, to]) incident.set(node, (incident.get(node) ?? new Set()).add(piece));
    }
  }
  const networks = new Map<string, { pairs: number; tree: boolean }>(), visited = new Set<string>();
  for (const first of pieces.keys()) {
    if (visited.has(first)) continue;
    const pairs = new Set<string>(), nodes = new Set<string>(), queue = [first];
    let count = 0;
    while (queue.length) {
      const piece = queue.pop()!;
      if (visited.has(piece)) continue;
      visited.add(piece); count++;
      const { pair, from, to } = pieces.get(piece)!;
      pairs.add(pair);
      for (const node of [from, to]) {
        nodes.add(node);
        for (const next of incident.get(node) ?? []) if (!visited.has(next)) queue.push(next);
      }
    }
    const network = { pairs: pairs.size, tree: count === nodes.size - 1 };
    for (const pair of pairs) networks.set(pair, network);
  }
  assert.deepEqual(new Set(networks.keys()), selected, "every river/bridge border has a visible physical border");
  for (const network of networks.values()) {
    assert.ok(network.pairs >= 2, "no standalone single-border river");
    assert.ok(network.tree, "drainage networks stay acyclic");
  }
  return networks;
}

test("required borders join connected rivers even when the free share alone would not reach them", () => {
  const plane = grid();
  // Spread across the swampy lowlands; a 1% share alone asks for two borders.
  const required = [key(at(1, 2), at(1, 3)), key(at(3, 3), at(4, 3)), key(at(5, 2), at(6, 2))];
  const result = generateBorderRivers(plane, "strategic-required", { riverPercent: 1, requiredBorders: required });
  assert.deepEqual(result.unroutedRequired, []);
  const networks = channelNetworks(plane);
  for (const pair of required) {
    assert.equal(edgeFor(plane, pair).kind, "river", `${pair} stays a real river chokepoint`);
    assert.ok(networks.get(pair)!.pairs >= 2, `${pair} belongs to a connected watercourse`);
  }
  assert.equal(result.riverBorders, plane.edges.filter(isChannel).length);
  assert.ok(result.riverBorders > result.requestedBorders, "the strategic requirement explicitly extends a tiny share");
  assert.equal(result.limited, false);

  const again = grid();
  assert.deepEqual(generateBorderRivers(again, "strategic-required", { riverPercent: 1, requiredBorders: required }), result);
  assert.deepEqual(again, plane, "required routing is deterministic");
});

test("required routes keep the router's capital bridges and share its downstream channels", () => {
  const plane = grid();
  const first = key(at(2, 2), at(2, 3)), second = key(at(2, 3), at(3, 3));
  for (const province of plane.provinces) if (province.gridY === 4) province.start = true;
  const result = generateBorderRivers(plane, "strategic-capitals", { riverPercent: 1, requiredBorders: [first, second, first] });
  assert.deepEqual(result.unroutedRequired, []);
  const networks = channelNetworks(plane);
  for (const pair of [first, second]) assert.equal(edgeFor(plane, pair).kind, "river");
  assert.equal(networks.get(first), networks.get(second), "a neighbouring chokepoint joins the same network");
  const starts = new Set(plane.provinces.filter(province => province.start).map(province => province.id));
  const capitalCrossings = plane.edges.filter(edge => isChannel(edge) && (starts.has(edge.a) || starts.has(edge.b)));
  assert.ok(capitalCrossings.length > 0, "the fixture routes through capital borders on the way to the sea");
  assert.ok(capitalCrossings.every(edge => edge.kind === "bridge"), "capital exits stay bridged");
});

test("required borders with no continuous route are reported instead of becoming single-border rivers", () => {
  const plane = grid();
  const coast = key(at(3, 4), at(3, 5));
  const result = generateBorderRivers(plane, "strategic-coast", { requiredBorders: [coast, "missing|border"] });
  assert.deepEqual(result.unroutedRequired, [coast, "missing|border"], "coastlines are never border rivers");
  assert.equal(edgeFor(plane, coast).kind, "standard");
  channelNetworks(plane);

  // A land border whose only neighbours are coastlines forms a one-arc
  // component; the land block across the strait keeps ordinary routing alive.
  const islet = grid(5, 3, false);
  for (const province of islet.provinces) if (province.gridX === 2 || (province.gridX < 2 && province.gridY > 0)) province.terrain = "sea";
  const isolated = key(at(0, 0), at(1, 0));
  const lonely = generateBorderRivers(islet, "strategic-islet", { riverPercent: 100, requiredBorders: [isolated] });
  assert.ok(lonely.requestedBorders >= 2 && lonely.riverBorders >= 2, "rivers remain enabled elsewhere");
  assert.deepEqual(lonely.unroutedRequired, [isolated]);
  assert.equal(edgeFor(islet, isolated).kind, "standard");
  channelNetworks(islet);

  const disabled = grid();
  const off = generateBorderRivers(disabled, "strategic-off", { riverPercent: 0, requiredBorders: [key(at(1, 2), at(1, 3))] });
  assert.deepEqual(off.unroutedRequired, [key(at(1, 2), at(1, 3))], "a zero share disables required rivers too");
  assert.equal(disabled.edges.filter(isChannel).length, 0);

  const sparse = grid();
  sparse.ownershipMode = "sparse";
  sparse.edges[3]!.kind = "river";
  const before = structuredClone(sparse);
  assert.deepEqual(generateBorderRivers(sparse, "strategic-sparse", { requiredBorders: [key(sparse.edges[3]!.a, sparse.edges[3]!.b)] }).unroutedRequired, []);
  assert.deepEqual(sparse, before, "unmanaged planes are untouched and report nothing to replace");
});

/** The generator's own stages: provisional borders, the strategic pass, then river finalization. */
function strategicStage(seed: string, overrides: Plane["generationOverrides"]) {
  const project = createDefaultProject(seed, { generate: false });
  const source = structuredClone(project.planes[0]!);
  source.generationOverrides = overrides;
  const settings = { ...project.settings, overlandTopology: "strategic" as const };
  const plane = generatePlane(source, settings, `${seed}:stage`, 0, { deferStrategicFeatures: true });
  const before = new Map(plane.edges.map(edge => [edge.id, edge.kind]));
  applyGeneratedOverlandTopology(plane, "strategic", `${seed}:topology`);
  const wet = plane.edges.filter(edge => edge.kind === "river" && before.get(edge.id) !== "river").map(edge => edge.id);
  const warnings: string[] = [];
  finalizeGeneratedRivers(plane, settings, `${seed}:rivers`, [], warnings);
  const byId = new Map(plane.provinces.map(province => [province.id, province]));
  return { plane, warnings, chokepoints: wet.map(id => {
    const edge = plane.edges.find(candidate => candidate.id === id)!;
    const ends = [byId.get(edge.a)!, byId.get(edge.b)!];
    assert.ok(ends.some(province => effectiveProvinceTerrainFlags(province).has("swamp") || effectiveProvinceTerrainFlags(province).has("freshwater")));
    return { edge, land: ends.every(province => !isWaterProvince(province) && !isBlockedProvince(province)) };
  }) };
}

const SWAMPY = { terrainWeights: { swamp: 5 } };

test("strategic wet chokepoints survive river finalization as connected rivers or a dry strategic barrier", () => {
  let land = 0, routed = 0;
  for (const [seed, overrides] of [["strategic-stage-a", SWAMPY], ["strategic-stage-b", SWAMPY], ["strategic-stage-c", SWAMPY], ["strategic-stage-d", undefined]] as const) {
    const { plane, chokepoints } = strategicStage(seed, overrides);
    const networks = channelNetworks(plane);
    for (const { edge, land: onLand } of chokepoints) {
      assert.ok(edge.kind === "river" || edge.kind === "mountain_pass", `${seed}: chokepoint ${edge.id} must not vanish (now ${edge.kind})`);
      if (!onLand) {
        assert.equal(edge.kind, "mountain_pass", `${seed}: coastlines never become border rivers`);
        continue;
      }
      land++;
      if (edge.kind !== "river") continue;
      routed++;
      assert.ok(networks.get(key(edge.a, edge.b))!.pairs >= 2, `${seed}: ${edge.id} is part of a connected river`);
    }
  }
  assert.ok(land >= 3, `the fixtures exercise wet land chokepoints (${land})`);
  // Only a border with no valid continuous route (such as a lone arc between
  // coastlines, or one closing a loop) may keep the dry fallback instead.
  assert.ok(routed * 4 >= land * 3, `wet land chokepoints are routed as rivers (${routed} of ${land})`);
});

test("strategic wet chokepoints fall back to mountain passes when watercourses are disabled", () => {
  const { plane, chokepoints, warnings } = strategicStage("strategic-stage-a", { ...SWAMPY, riverPercent: 0 });
  assert.ok(chokepoints.length > 0);
  for (const { edge } of chokepoints) assert.equal(edge.kind, "mountain_pass", `${edge.id} keeps a strategic barrier`);
  assert.equal(plane.edges.filter(isChannel).length, 0, "an explicit zero share still removes every river");
  assert.deepEqual(warnings, []);
});

function strategicProject(seed: string, swampy: boolean): MapProject {
  const project = createDefaultProject(seed, { generate: false });
  project.settings.overlandTopology = "strategic";
  if (swampy) project.planes[0]!.generationOverrides = { terrainWeights: { swamp: 5 } };
  return generateProject(project);
}

test("full strategic generation routes its chokepoints and keeps rivers continuous, capital-safe, valid and deterministic", () => {
  let steered = 0;
  for (const [seed, swampy] of [["strategic-river-swamp-1", true], ["strategic-river-swamp-6", true], ["strategic-river-default-1", false]] as const) {
    const project = strategicProject(seed, swampy);
    const plane = project.planes[0]!;
    channelNetworks(plane);
    const nationStarts = project.specificStarts.filter(start => start.planeId === plane.id).map(start => start.provinceId);
    const starts = new Set([
      ...plane.provinces.filter(province => province.start || province.teamStart !== undefined).map(province => province.id),
      ...nationStarts,
    ]);
    assert.ok(starts.size > 0);
    // Re-running only the free share on the final borders reproduces the old
    // result exactly, because the old pass discarded every strategic river.
    const freeOnly = structuredClone(plane);
    for (const edge of freeOnly.edges) if (isChannel(edge)) { edge.kind = "standard"; delete edge.special; }
    generateBorderRivers(freeOnly, `${project.seed}:river-network:${plane.id}`, { protectedStartIds: nationStarts });
    const freeChannels = new Set(freeOnly.edges.filter(isChannel).map(edge => key(edge.a, edge.b)));
    if (plane.edges.some(edge => isChannel(edge) && !freeChannels.has(key(edge.a, edge.b)))) steered++;
    for (const edge of plane.edges) if (starts.has(edge.a) || starts.has(edge.b)) {
      assert.ok(!["river", "mountain_pass", "mountain_border", "impassable"].includes(edge.kind), `${seed}: capital exit ${edge.id} stays reliable`);
    }
    assert.deepEqual(validateProject(project).filter(issue => issue.severity === "error"), [], seed);
    const again = strategicProject(seed, swampy);
    const stable = (value: MapProject) => JSON.stringify({ ...value, createdAt: "", updatedAt: "" });
    assert.equal(stable(again), stable(project), `${seed}: deterministic`);
  }
  assert.ok(steered > 0, "full generation routes strategic chokepoints into the final watercourses");
});
