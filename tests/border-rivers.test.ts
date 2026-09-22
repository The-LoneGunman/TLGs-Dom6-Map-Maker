import assert from "node:assert/strict";
import test from "node:test";
import { buildBorderRiverGraph, generateBorderRivers } from "../src/borderRivers";
import { cloneProject, isBlockedProvince, isWaterProvince, type Edge, type OceanLayout, type OverlandTopologyMode, type Plane, type Province } from "../src/domain";
import { compileMapText, edgeSpecial, encodeD6m } from "../src/dom6";
import { borderStyles } from "../src/edgeVisuals";
import { computeProvinceTopology, connectionKey, type Point } from "../src/geometry";
import { createDefaultProject, generateProject, synchronizePlaneEdges } from "../src/generator";

function grid(columns = 7, rows = 6, coast = true): Plane {
  const provinces: Province[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const terrain = coast && row === rows - 1 ? "sea" : row === 0 ? "mountains" : row === 1 ? "highland" : "plains";
    provinces.push({ id: `river-p-${column}-${row}`, index: provinces.length + 1,
      x: (column + .5) / columns, y: (row + .5) / rows, gridX: column, gridY: row,
      name: `River fixture ${column} ${row}`, biome: "heartland", terrain, terrainFlags: [], freshwater: false,
      small: false, large: false, noStart: false, manySites: false, warmer: false, colder: false,
      siteBias: [], start: false, throne: "none", sites: [], killRandomSites: false,
      temple: false, lab: false, defenders: [], battle: {}, rawDirectives: "" });
  }
  const plane: Plane = { id: "river-fixture", name: "River fixture", kind: "surface", variant: "temperate",
    ownershipMode: "solid", provinceTarget: provinces.length, width: 512, height: 384,
    wrapX: false, wrapY: false, provinces, edges: [], rawDirectives: "" };
  refreshEdges(plane);
  return plane;
}

function refreshEdges(plane: Plane): void {
  plane.edges = computeProvinceTopology(plane).pairs.map((pair, index) => ({
    id: `river-e-${index}`, a: pair.a, b: pair.b, kind: "standard",
  }));
}

function river(edge: Edge): boolean { return edge.kind === "river" || edge.kind === "bridge"; }
function edgeAt(plane: Plane, a: string, b: string): Edge {
  const edge = plane.edges.find(candidate => connectionKey(candidate.a, candidate.b) === connectionKey(a, b));
  assert.ok(edge, `Expected physical border ${a}/${b}`);
  return edge;
}

/** Separate geometric oracle: no graph produced by borderRivers is consumed here. */
function pointKey(plane: Plane, point: Point): string {
  const axis = (value: number, wrapped: boolean) => {
    const rounded = Math.round(value * 1e8);
    return wrapped && (rounded === 0 || rounded === 1e8) ? 0 : rounded;
  };
  return `${axis(point.x, plane.wrapX)}:${axis(point.y, plane.wrapY)}`;
}

function visibleNetworks(plane: Plane) {
  const topology = computeProvinceTopology(plane);
  const selected = new Set(plane.edges.filter(river).map(edge => connectionKey(edge.a, edge.b)));
  const pieces = new Map<string, { pair: string; from: string; to: string }>();
  const incident = new Map<string, Set<string>>();
  const points = new Map<string, Point>();
  const shore = new Set<string>();
  const provinceIdsAt = new Map<string, Set<string>>();
  const byId = new Map(plane.provinces.map(province => [province.id, province]));
  for (const [pair, segments] of topology.sharedBorders) {
    const ids = pair.split("|");
    const coastal = ids.some(id => isWaterProvince(byId.get(id)!)) && ids.some(id => !isWaterProvince(byId.get(id)!));
    for (const segment of segments) {
      const from = pointKey(plane, segment.from), to = pointKey(plane, segment.to);
      for (const [key, point] of [[from, segment.from], [to, segment.to]] as const) {
        points.set(key, point);
        const adjacent = provinceIdsAt.get(key) ?? new Set<string>();
        for (const id of ids) adjacent.add(id);
        provinceIdsAt.set(key, adjacent);
        if (coastal) shore.add(key);
      }
      if (!selected.has(pair)) continue;
      assert.ok(Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9);
      const key = `${pair}:${[from, to].sort().join("/")}`;
      if (pieces.has(key)) continue; // Seam copies describe the same physical piece.
      pieces.set(key, { pair, from, to });
      for (const node of [from, to]) {
        const edges = incident.get(node) ?? new Set<string>(); edges.add(key); incident.set(node, edges);
      }
    }
  }
  const visited = new Set<string>();
  const networks: { pairs: Set<string>; nodes: Set<string>; pieces: Set<string>; leaves: string[] }[] = [];
  for (const first of pieces.keys()) {
    if (visited.has(first)) continue;
    const component = { pairs: new Set<string>(), nodes: new Set<string>(), pieces: new Set<string>(), leaves: [] as string[] };
    const queue = [first];
    while (queue.length) {
      const key = queue.pop()!;
      if (visited.has(key)) continue;
      visited.add(key); component.pieces.add(key);
      const piece = pieces.get(key)!; component.pairs.add(piece.pair);
      for (const node of [piece.from, piece.to]) {
        component.nodes.add(node);
        for (const next of incident.get(node) ?? []) if (!visited.has(next)) queue.push(next);
      }
    }
    component.leaves = [...component.nodes].filter(node => (incident.get(node)?.size ?? 0) === 1);
    networks.push(component);
  }
  return { networks, shore, points, provinceIdsAt, selected };
}

function assertContinuous(plane: Plane, context = ""): ReturnType<typeof visibleNetworks> {
  const visible = visibleNetworks(plane);
  const represented = new Set(visible.networks.flatMap(network => [...network.pairs]));
  assert.deepEqual(represented, visible.selected, `${context}: every generated river/bridge has a real visible border`);
  for (const network of visible.networks) {
    assert.ok(network.pairs.size >= 2, `${context}: a river must physically join at least two province borders`);
    assert.equal(network.pieces.size, network.nodes.size - 1, `${context}: drainage must not form closed visible loops`);
  }
  return visible;
}

test("border river graph connects physical corners, not provinces that merely share a neighbor", () => {
  const plane = grid(3, 3, false);
  const before = structuredClone(plane);
  const graph = buildBorderRiverGraph(plane);
  const north = graph.arcs.get(connectionKey("river-p-1-1", "river-p-1-0"))!;
  const south = graph.arcs.get(connectionKey("river-p-1-1", "river-p-1-2"))!;
  const east = graph.arcs.get(connectionKey("river-p-1-1", "river-p-2-1"))!;
  assert.ok(north && south && east);
  const endpoints = (arc: typeof north) => new Set([arc.from, arc.to]);
  assert.equal([...endpoints(north)].filter(node => endpoints(south).has(node)).length, 0);
  assert.equal([...endpoints(north)].filter(node => endpoints(east).has(node)).length, 1);
  assert.deepEqual(plane, before, "graph inspection is read-only");

  const fourWay = grid(2, 2, false), crossroads = buildBorderRiverGraph(fourWay);
  const upper = crossroads.arcs.get(connectionKey("river-p-0-0", "river-p-1-0"))!;
  const lower = crossroads.arcs.get(connectionKey("river-p-0-1", "river-p-1-1"))!;
  assert.ok(upper && lower);
  assert.equal([upper.from, upper.to].filter(node => node === lower.from || node === lower.to).length, 1,
    "borders with disjoint province pairs can still meet at the same physical junction");
});

test("wrapped seam endpoints join only on enabled axes and never become map-edge outlets", () => {
  for (const axis of ["x", "y"] as const) {
    const plane = grid(4, 4, false);
    const pairA = axis === "x" ? ["river-p-0-0", "river-p-0-1"] : ["river-p-0-0", "river-p-1-0"];
    const pairB = axis === "x" ? ["river-p-3-0", "river-p-3-1"] : ["river-p-0-3", "river-p-1-3"];
    const unwrapped = buildBorderRiverGraph(plane);
    const a0 = unwrapped.arcs.get(connectionKey(pairA[0]!, pairA[1]!))!;
    const b0 = unwrapped.arcs.get(connectionKey(pairB[0]!, pairB[1]!))!;
    assert.ok(a0 && b0);
    assert.equal([a0.from, a0.to].filter(node => node === b0.from || node === b0.to).length, 0);
    plane.wrapX = axis === "x"; plane.wrapY = axis === "y"; refreshEdges(plane);
    const wrapped = buildBorderRiverGraph(plane);
    const a = wrapped.arcs.get(connectionKey(pairA[0]!, pairA[1]!))!;
    const b = wrapped.arcs.get(connectionKey(pairB[0]!, pairB[1]!))!;
    assert.ok(a && b);
    const shared = [a.from, a.to].filter(node => node === b.from || node === b.to);
    assert.equal(shared.length, 1);
    assert.equal(wrapped.nodes.get(shared[0]!)!.boundary, false, "a wrapped seam is not an ocean or world boundary");
  }
});

test("a pair with disconnected physical border arcs cannot activate stray river fragments", () => {
  const plane = grid(2, 4, false);
  plane.wrapX = true; refreshEdges(plane);
  const pair = connectionKey("river-p-0-1", "river-p-1-1");
  const segments = computeProvinceTopology(plane).sharedBorders.get(pair)!;
  assert.ok(segments.length > 1, "fixture has an interior arc plus a disjoint wrapped arc");
  assert.equal(buildBorderRiverGraph(plane).arcs.has(pair), false);
  generateBorderRivers(plane, "ambiguous-pair", { riverPercent: 100 });
  assert.equal(river(edgeAt(plane, "river-p-0-1", "river-p-1-1")), false);
  assertContinuous(plane);
});

test("terrain-aware routes reach real coastal mouths and favor upland headwaters", () => {
  const plane = grid();
  const result = generateBorderRivers(plane, "upland-to-sea", { riverPercent: 22 });
  assert.ok(result.riverBorders >= 2);
  const visible = assertContinuous(plane);
  assert.ok(visible.networks.length > 0);
  for (const network of visible.networks) assert.ok([...network.nodes].some(node => visible.shore.has(node)),
    "an unobstructed coastal drainage component must actually meet a shore vertex");
  const byId = new Map(plane.provinces.map(province => [province.id, province]));
  assert.ok(visible.networks.some(network => network.leaves.some(node => !visible.shore.has(node)
    && [...visible.provinceIdsAt.get(node)!].some(id => ["mountains", "highland"].includes(byId.get(id)!.terrain)))),
  "at least one headwater should start on the uplands rather than arbitrarily beside the sea");
  assert.equal(result.riverBorders, plane.edges.filter(river).length);
  assert.equal(result.networkCount, visible.networks.length);
});

test("river shares are deterministic, bounded and never leave budget-truncated one-border fragments", () => {
  for (const percent of [0, 1, 15, 55, 100]) {
    const a = grid(), b = structuredClone(a);
    const result = generateBorderRivers(a, "stable-river-share", { riverPercent: percent });
    assert.deepEqual(generateBorderRivers(b, "stable-river-share", { riverPercent: percent }), result);
    assert.deepEqual(a, b);
    assert.ok(result.riverBorders <= result.eligibleBorders);
    assert.ok(Number.isInteger(result.requestedBorders) && result.requestedBorders >= 0);
    assert.ok(Number.isInteger(result.networkCount) && result.networkCount >= 0);
    assert.equal(result.riverBorders, a.edges.filter(river).length);
    if (percent === 0) assert.equal(result.riverBorders, 0);
    assertContinuous(a);
  }
});

test("selected rivers remain physically continuous on toroidal and single-axis wrapped worlds", () => {
  for (const [wrapX, wrapY] of [[true, false], [false, true], [true, true]] as const) {
    for (const coast of [false, true]) {
      const plane = grid(7, 6, coast);
      plane.wrapX = wrapX; plane.wrapY = wrapY; refreshEdges(plane);
      const result = generateBorderRivers(plane, `wrap-${wrapX}-${wrapY}-${coast}`, { riverPercent: 65 });
      assert.ok(result.riverBorders >= 2);
      assertContinuous(plane);
      if (wrapX && wrapY) assert.ok([...buildBorderRiverGraph(plane).nodes.values()].every(node => !node.boundary));
    }
  }
});

test("tiny, empty and entirely submerged worlds degrade safely without solitary river edges", () => {
  for (const count of [0, 1, 2, 3]) {
    const plane = grid(3, 1, false);
    plane.provinces = plane.provinces.slice(0, count); plane.provinceTarget = count; refreshEdges(plane);
    for (const percent of [0, 100]) {
      const copy = structuredClone(plane);
      assert.doesNotThrow(() => generateBorderRivers(copy, "tiny-world", { riverPercent: percent }));
      assertContinuous(copy);
    }
  }
  const water = grid();
  for (const province of water.provinces) province.terrain = "sea";
  const result = generateBorderRivers(water, "all-sea", { riverPercent: 100 });
  assert.equal(result.eligibleBorders, 0); assert.equal(result.riverBorders, 0);
  assertContinuous(water);
});

test("river routing only changes eligible edge kinds, never terrain, ownership, sites or topology", () => {
  const plane = grid(), before = structuredClone(plane);
  plane.provinces[3]!.editorLocks = ["terrain", "name", "economy", "sites", "guardians"];
  before.provinces[3]!.editorLocks = [...plane.provinces[3]!.editorLocks!];
  const pairKeys = [...computeProvinceTopology(plane).pairKeys].sort();
  generateBorderRivers(plane, "data-preservation", { riverPercent: 80 });
  assert.deepEqual(plane.provinces, before.provinces);
  assert.deepEqual(plane.edges.map(({ id, a, b }) => ({ id, a, b })), before.edges.map(({ id, a, b }) => ({ id, a, b })));
  assert.deepEqual([...computeProvinceTopology(plane).pairKeys].sort(), pairKeys);
  assert.deepEqual({ ...plane, edges: [] }, { ...before, edges: [] });
});

test("custom borders and mountain/impassable barriers are preserved and excluded from routing", () => {
  const plane = grid();
  const kinds = ["custom", "impassable", "mountain_pass", "mountain_border"] as const;
  const barriers = kinds.map((kind, index) => {
    const edge = plane.edges[index + 9]!; edge.kind = kind;
    if (kind === "custom") edge.special = 10;
    return structuredClone(edge);
  });
  const blocked = plane.provinces.find(province => province.gridX === 3 && province.gridY === 3)!;
  blocked.terrain = "cavewall";
  const touchingBlocked = plane.edges.filter(edge => edge.a === blocked.id || edge.b === blocked.id).map(edge => structuredClone(edge));
  const graph = buildBorderRiverGraph(plane);
  for (const edge of [...barriers, ...touchingBlocked]) assert.equal(graph.arcs.has(connectionKey(edge.a, edge.b)), false);
  generateBorderRivers(plane, "preserve-barriers", { riverPercent: 100 });
  for (const edge of [...barriers, ...touchingBlocked]) assert.deepEqual(plane.edges.find(candidate => candidate.id === edge.id), edge);
});

test("road crossings become bridges without native river movement restrictions", () => {
  const plane = grid();
  for (const edge of plane.edges) edge.kind = "road";
  const result = generateBorderRivers(plane, "road-crossing", { riverPercent: 50 });
  assert.ok(result.riverBorders >= 2);
  for (const edge of plane.edges.filter(river)) {
    assert.equal(edge.kind, "bridge"); assert.equal(edgeSpecial(edge), 16); assert.equal(edgeSpecial(edge) & 2, 0);
  }
  assertContinuous(plane);
});

test("generic, team and explicitly protected nation starts retain river artwork through safe bridges", () => {
  for (const category of ["generic", "team", "nation"] as const) {
    const plane = grid();
    const dry = plane.provinces.filter(province => !isWaterProvince(province));
    if (category === "generic") dry.forEach(province => province.start = true);
    if (category === "team") dry.forEach(province => province.teamStart = 0);
    const before = structuredClone(plane.provinces);
    const result = generateBorderRivers(plane, `capital-crossing-${category}`, { riverPercent: 50,
      ...(category === "nation" ? { protectedStartIds: dry.map(province => province.id) } : {}) });
    assert.ok(result.riverBorders >= 2);
    assert.ok(plane.edges.filter(river).every(edge => edge.kind === "bridge" && edgeSpecial(edge) === 16), category);
    assert.deepEqual(plane.provinces, before);
    assertContinuous(plane);
  }
});

test("bridge-all preserves river geometry while exporting permanently passable crossings", () => {
  const plane = grid();
  const result = generateBorderRivers(plane, "open-routes", { riverPercent: 60, bridgeAll: true });
  assert.ok(result.riverBorders >= 2);
  assert.ok(plane.edges.filter(river).every(edge => edge.kind === "bridge"));
  assertContinuous(plane);
  for (const edge of plane.edges.filter(river)) {
    const bridge = borderStyles(edge), ordinaryRiver = borderStyles({ kind: "river" });
    assert.ok(bridge.some(style => ordinaryRiver.some(base => base.color === style.color && base.dash.length === 0)),
      "bridge styling retains the continuous blue river underlay");
    assert.ok(bridge.some(style => style.dash.length > 0), "the crossing remains visibly distinguished");
  }
});

test("native export uses river bit2 or bridge bit16 without changing any D6M geography", async () => {
  const project = createDefaultProject("river-export", { generate: false }), plane = grid();
  plane.width = plane.height = 256; project.planes = [plane];
  const before = await encodeD6m(plane, "river-export-geography");
  generateBorderRivers(plane, "river-export", { riverPercent: 50 });
  const first = plane.edges.find(edge => edge.kind === "river"); assert.ok(first);
  first.kind = "bridge";
  const text = compileMapText(project, 0);
  for (const edge of plane.edges.filter(river)) {
    const a = plane.provinces.find(province => province.id === edge.a)!.index;
    const b = plane.provinces.find(province => province.id === edge.b)!.index;
    assert.ok(text.includes(`#neighbourspec ${a} ${b} ${edge.kind === "bridge" ? 16 : 2}\r\n`));
  }
  assert.deepEqual(await encodeD6m(plane, "river-export-geography"), before);
});

test("sparse realms and province-water Styx are never rewritten by border-river generation", () => {
  for (const kind of ["surface", "custom", "cave", "cavern", "underworld", "hell", "abyss", "dream", "elemental", "cloud", "air"] as const) {
    const plane = grid(); plane.kind = kind; plane.ownershipMode = "sparse";
    plane.edges[1]!.kind = "bridge"; plane.edges[2]!.kind = "river";
    const before = structuredClone(plane);
    const result = generateBorderRivers(plane, "sparse-untouched", { riverPercent: 100 });
    assert.deepEqual(plane, before, kind);
    assert.equal(result.riverBorders, 0, "report counts newly managed channels, not existing sparse Styx bridges");
  }
});

test("solid surface-like Custom realms support rivers but other solid realm themes remain untouched", () => {
  const custom = grid(); custom.kind = "custom"; custom.variant = "temperate";
  assert.ok(generateBorderRivers(custom, "custom-rivers", { riverPercent: 55 }).riverBorders >= 2);
  assertContinuous(custom);
  for (const kind of ["cave", "underworld", "hell", "dream", "cloud", "elemental"] as const) {
    const plane = grid(); plane.kind = kind;
    const before = structuredClone(plane);
    generateBorderRivers(plane, "other-solid-realm", { riverPercent: 100 });
    assert.deepEqual(plane, before);
  }
});

test("ordinary topology synchronization keeps authored rivers, bridges and custom river bits intact", () => {
  const plane = grid();
  plane.edges[0]!.kind = "river";
  plane.edges[1]!.kind = "bridge";
  plane.edges[2]!.kind = "custom"; plane.edges[2]!.special = 10;
  const before = structuredClone(plane.edges);
  const repaired = synchronizePlaneEdges(plane, "synchronize-authored-rivers", true);
  assert.deepEqual(repaired.edges, before);
  const project = createDefaultProject("saved-river-project", { generate: false }); project.planes = [plane];
  assert.deepEqual(cloneProject(project).planes[0]!.edges, before);
  assert.equal(plane.provinces.some(isBlockedProvince), false);
});

test("real generation corpus keeps physical river networks continuous and capital-safe across geography and policy choices", () => {
  const cases: {
    name: string; oceanLayout: OceanLayout; policy: OverlandTopologyMode;
    wrapX: boolean; wrapY: boolean; waterPercent: number; riverPercent?: number;
  }[] = [
    { name: "natural-flat", oceanLayout: "natural", policy: "competitive", wrapX: false, wrapY: false, waterPercent: 18 },
    { name: "natural-torus", oceanLayout: "natural", policy: "competitive", wrapX: true, wrapY: true, waterPercent: 18 },
    { name: "continent-open", oceanLayout: "single_continent", policy: "open", wrapX: true, wrapY: false, waterPercent: 30 },
    { name: "continents-strategic", oceanLayout: "multiple_continents", policy: "strategic", wrapX: false, wrapY: true, waterPercent: 35 },
    { name: "islands-open", oceanLayout: "island_chains", policy: "open", wrapX: true, wrapY: true, waterPercent: 50 },
    { name: "inland-competitive", oceanLayout: "inland_sea", policy: "competitive", wrapX: false, wrapY: false, waterPercent: 25 },
    { name: "dry-inland-basin", oceanLayout: "natural", policy: "competitive", wrapX: true, wrapY: true, waterPercent: 0 },
    { name: "strategic-off", oceanLayout: "natural", policy: "strategic", wrapX: true, wrapY: true, waterPercent: 18, riverPercent: 0 },
    { name: "inland-open-off", oceanLayout: "inland_sea", policy: "open", wrapX: false, wrapY: true, waterPercent: 30, riverPercent: 0 },
    { name: "continent-open-30", oceanLayout: "single_continent", policy: "open", wrapX: true, wrapY: false, waterPercent: 30, riverPercent: 30 },
    { name: "islands-strategic-30", oceanLayout: "island_chains", policy: "strategic", wrapX: true, wrapY: true, waterPercent: 50, riverPercent: 30 },
    { name: "natural-maximum", oceanLayout: "natural", policy: "competitive", wrapX: false, wrapY: true, waterPercent: 22, riverPercent: 100 },
  ];
  for (const scenario of cases) {
    const project = createDefaultProject(`river-corpus-${scenario.name}`, { generate: false });
    Object.assign(project.settings, {
      players: 4, provincesPerPlayer: 18, throneCount: 4,
      oceanLayout: scenario.oceanLayout, continentCount: 3, waterPercent: scenario.waterPercent,
      overlandTopology: scenario.policy,
      startDistribution: { land: 4, coastal: 0, water: 0, cave: 0, other: 0 },
    });
    Object.assign(project.planes[0]!, { wrapX: scenario.wrapX, wrapY: scenario.wrapY });
    if (scenario.riverPercent !== undefined) project.planes[0]!.generationOverrides = { riverPercent: scenario.riverPercent };
    const generated = generateProject(project), plane = generated.planes[0]!;
    assert.equal(plane.provinces.length, 72, `${scenario.name}: ordinary-sized corpus fixture`);
    assert.equal(plane.wrapX, scenario.wrapX); assert.equal(plane.wrapY, scenario.wrapY);
    const visible = assertContinuous(plane, scenario.name);
    const channels = plane.edges.filter(river);
    if (scenario.riverPercent === 0) {
      assert.equal(channels.length, 0, `${scenario.name}: explicit zero removes both river and bridge artwork`);
      assert.equal(visible.networks.length, 0);
    } else {
      assert.ok(channels.length >= 2, `${scenario.name}: feasible nonzero settings produce real joined river borders`);
    }
    if (scenario.policy === "open" && scenario.riverPercent === undefined) {
      assert.ok(channels.every(edge => edge.kind === "bridge"), `${scenario.name}: default open rivers stay permanently crossable`);
    }
    if (scenario.waterPercent === 0) assert.equal(plane.provinces.some(isWaterProvince), false, "the dry torus exercises the inland-basin fallback");
    const protectedStarts = new Set([
      ...plane.provinces.filter(province => province.start || province.teamStart !== undefined).map(province => province.id),
      ...generated.specificStarts.filter(start => start.planeId === plane.id).map(start => start.provinceId),
    ]);
    assert.equal(protectedStarts.size, 4, `${scenario.name}: all requested starts were placed`);
    for (const edge of plane.edges) if (protectedStarts.has(edge.a) || protectedStarts.has(edge.b)) {
      assert.equal(edgeSpecial(edge) & 2, 0, `${scenario.name}: capital exit ${edge.id} must not acquire the native river movement restriction`);
    }
  }
});
