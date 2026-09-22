import { effectiveProvinceTerrainFlags, isBlockedProvince, isWaterProvince, type Edge, type Plane } from "./domain";
import { computeProvinceTopology, connectionKey, resolvePlaneOwnershipMode, type Point } from "./geometry";
import { terrainElevation } from "./terrainVisuals";

export interface BorderRiverNode {
  id: string;
  point: Point;
  provinceIds: Set<string>;
  elevation: number;
  waterBodies: Set<number>;
  boundary: boolean;
  headwater: number;
}
export interface BorderRiverArc { key: string; from: string; to: string; length: number; edge: Edge }
export interface BorderRiverGraph {
  nodes: Map<string, BorderRiverNode>;
  arcs: Map<string, BorderRiverArc>;
  primaryWaterBodies: Set<number>;
}
export interface BorderRiverOptions {
  riverPercent?: number;
  bridgeAll?: boolean;
  protectedStartIds?: readonly string[];
  /**
   * Border connection keys that must lie on a connected watercourse, such as
   * strategic wet chokepoints. Each is routed before the free river share,
   * down the drainage forest to a valid outlet or an existing channel, and
   * may extend that share. It is never activated as a standalone river.
   */
  requiredBorders?: readonly string[];
}
export interface BorderRiverReport {
  eligibleBorders: number;
  requestedBorders: number;
  riverBorders: number;
  networkCount: number;
  limited: boolean;
  /**
   * Required borders with no valid continuous route. They were reset like
   * every provisional river, so the caller chooses their replacement barrier.
   * Empty on planes this pass does not manage, where nothing is reset.
   */
  unroutedRequired: string[];
}

function rank(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) { hash ^= seed.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}

function supportsBorderRivers(plane: Plane): boolean {
  return resolvePlaneOwnershipMode(plane) === "solid"
    && (plane.kind === "surface" || (plane.kind === "custom"
      && ["temperate", "wild", "frozen", "arid", "oceanic"].includes(plane.variant ?? "temperate")));
}

/** Quantize clipping roundoff; only enabled wrap seams are the same physical node. */
function cornerKey(point: Point, plane: Plane): string {
  const coordinate = (value: number, wrap: boolean) => {
    const rounded = Math.round(value * 1e6);
    return wrap && (rounded === 0 || rounded === 1e6) ? 0 : rounded;
  };
  return `${coordinate(point.x, plane.wrapX)}:${coordinate(point.y, plane.wrapY)}`;
}

/** The dual province graph is not a river graph: routes join actual border endpoints. */
export function buildBorderRiverGraph(plane: Plane): BorderRiverGraph {
  const nodes = new Map<string, BorderRiverNode>(), arcs = new Map<string, BorderRiverArc>();
  const graph: BorderRiverGraph = { nodes, arcs, primaryWaterBodies: new Set() };
  if (!supportsBorderRivers(plane)) return graph;
  const topology = computeProvinceTopology(plane);
  const provinces = new Map(plane.provinces.map(province => [province.id, province]));
  const edges = new Map(plane.edges.map(edge => [connectionKey(edge.a, edge.b), edge]));
  const water = new Map(plane.provinces.filter(p => isWaterProvince(p) && !isBlockedProvince(p)).map(p => [p.id, [] as string[]]));
  for (const pair of topology.pairs) if (water.has(pair.a) && water.has(pair.b)) {
    water.get(pair.a)!.push(pair.b); water.get(pair.b)!.push(pair.a);
  }
  const waterBody = new Map<string, number>(), bodySizes: number[] = [];
  for (const id of water.keys()) if (!waterBody.has(id)) {
    const body = bodySizes.length, queue = [id];
    waterBody.set(id, body);
    for (let i = 0; i < queue.length; i++) for (const next of water.get(queue[i]!)!) {
      if (waterBody.has(next)) continue;
      waterBody.set(next, body); queue.push(next);
    }
    bodySizes.push(queue.length);
  }
  if (bodySizes.length) graph.primaryWaterBodies.add(bodySizes.indexOf(Math.max(...bodySizes)));
  const touch = (point: Point, ids: readonly string[]) => {
    const id = cornerKey(point, plane);
    let node = nodes.get(id);
    if (!node) {
      node = { id, point, provinceIds: new Set(), elevation: 0, waterBodies: new Set(), headwater: 0,
        boundary: (!plane.wrapX && (point.x < 1e-6 || point.x > 1 - 1e-6))
          || (!plane.wrapY && (point.y < 1e-6 || point.y > 1 - 1e-6)) };
      nodes.set(id, node);
    }
    for (const provinceId of ids) {
      node.provinceIds.add(provinceId);
      const body = waterBody.get(provinceId);
      if (body !== undefined) {
        node.waterBodies.add(body);
        if (node.boundary) graph.primaryWaterBodies.add(body);
      }
    }
    return id;
  };
  const aspect = plane.width / plane.height;
  for (const pair of topology.pairs) {
    const segments = topology.sharedBorders.get(pair.key) ?? [];
    const links = new Map<string, Set<string>>(), unique = new Map<string, string>();
    let length = 0, closedFragment = false;
    for (const segment of segments) {
      const from = touch(segment.from, [pair.a, pair.b]), to = touch(segment.to, [pair.a, pair.b]);
      if (from === to) { closedFragment = true; continue; }
      const key = connectionKey(from, to);
      const middle = cornerKey({ x: (segment.from.x + segment.to.x) / 2, y: (segment.from.y + segment.to.y) / 2 }, plane);
      if (unique.has(key)) {
        if (unique.get(key) !== middle) closedFragment = true;
        continue;
      }
      unique.set(key, middle);
      if (!links.has(from)) links.set(from, new Set());
      if (!links.has(to)) links.set(to, new Set());
      links.get(from)!.add(to); links.get(to)!.add(from);
      length += Math.hypot((segment.to.x - segment.from.x) * aspect, segment.to.y - segment.from.y);
    }
    const edge = edges.get(pair.key), a = provinces.get(pair.a), b = provinces.get(pair.b);
    if (!edge || !a || !b || isWaterProvince(a) || isWaterProvince(b) || isBlockedProvince(a) || isBlockedProvince(b)
      || !["standard", "road", "river", "bridge"].includes(edge.kind) || closedFragment) continue;
    const ends = [...links].filter(([, neighbors]) => neighbors.size === 1).map(([id]) => id);
    if (ends.length !== 2 || [...links.values()].some(neighbors => neighbors.size > 2)) continue;
    const visited = new Set([ends[0]!]), queue = [ends[0]!];
    for (let i = 0; i < queue.length; i++) for (const next of links.get(queue[i]!)!) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    // One native neighborspec paints every fragment of the pair. Never activate
    // an unrelated second arc just because it has the same province pair.
    if (visited.size !== links.size) continue;
    arcs.set(pair.key, { key: pair.key, from: ends[0]!, to: ends[1]!, length, edge });
  }
  for (const node of nodes.values()) {
    const adjacent = [...node.provinceIds].map(id => provinces.get(id)!).filter(Boolean);
    const heights = adjacent.map(p => Math.max(0, terrainElevation(p)) / 900);
    // Valley floors dominate junction elevation; ridges still impose a cost.
    node.elevation = heights.length ? Math.min(...heights) * 0.65 + heights.reduce((a, b) => a + b, 0) / heights.length * 0.35 : 0;
    node.headwater = adjacent.reduce((score, p) => {
      const flags = effectiveProvinceTerrainFlags(p);
      return Math.max(score, flags.has("mountains") ? 2.2 : flags.has("highland") ? 1.4
        : flags.has("freshwater") ? 0.8 : flags.has("swamp") ? 0.35 : 0);
    }, 0);
    if ([...node.waterBodies].some(body => !graph.primaryWaterBodies.has(body))) node.headwater += 2.4;
  }
  return graph;
}

/** Fresh-generation pass only. It never changes provinces, geometry, or native terrain bits. */
export function generateBorderRivers(plane: Plane, seed: string, options: BorderRiverOptions = {}): BorderRiverReport {
  const report: BorderRiverReport = { eligibleBorders: 0, requestedBorders: 0, riverBorders: 0, networkCount: 0, limited: false, unroutedRequired: [] };
  if (!supportsBorderRivers(plane)) return report;
  const graph = buildBorderRiverGraph(plane);
  // Remove provisional independent rolls, including pairs unsuitable for a
  // continuous physical arc. Authored maps never call this generation pass.
  for (const edge of plane.edges) if (edge.kind === "river" || edge.kind === "bridge") {
    edge.kind = "standard"; delete edge.special;
  }
  const { nodes, arcs } = graph;
  const required = [...new Set(options.requiredBorders ?? [])];
  report.eligibleBorders = arcs.size;
  const share = Math.max(0, Math.min(100, options.riverPercent ?? 8));
  report.requestedBorders = share > 0 && arcs.size >= 2 ? Math.max(2, Math.round(arcs.size * share / 100)) : 0;
  // A zero share disables watercourses outright, required borders included.
  if (!report.requestedBorders) { report.unroutedRequired = required; return report; }
  const adjacency = new Map<string, BorderRiverArc[]>();
  for (const arc of arcs.values()) for (const id of [arc.from, arc.to]) {
    if (!adjacency.has(id)) adjacency.set(id, []);
    adjacency.get(id)!.push(arc);
  }
  const componentOf = new Map<string, number>(), roots = new Set<string>();
  for (const id of adjacency.keys()) if (!componentOf.has(id)) {
    const component = componentOf.size, queue = [id];
    componentOf.set(id, component);
    for (let i = 0; i < queue.length; i++) for (const arc of adjacency.get(queue[i]!)!) {
      const other = arc.from === queue[i] ? arc.to : arc.from;
      if (!componentOf.has(other)) { componentOf.set(other, component); queue.push(other); }
    }
    const candidates = queue.map(key => nodes.get(key)!);
    const ocean = candidates.filter(node => [...node.waterBodies].some(body => graph.primaryWaterBodies.has(body)));
    const water = candidates.filter(node => node.waterBodies.size);
    const boundary = candidates.filter(node => node.boundary);
    const outlets = ocean.length ? ocean : water.length ? water : boundary;
    if (outlets.length) for (const node of outlets) roots.add(node.id);
    else {
      // Fully wrapped/waterless land needs an inland drainage basin, not a
      // fictitious sea, a seam discontinuity, or a cycle around the torus.
      candidates.sort((a, b) => a.elevation - b.elevation || rank(`${seed}:basin:${a.id}`) - rank(`${seed}:basin:${b.id}`));
      roots.add(candidates[0]!.id);
    }
  }
  const distance = new Map([...adjacency.keys()].map(id => [id, roots.has(id) ? 0 : Infinity]));
  const parent = new Map<string, { node: string; arc: BorderRiverArc }>(), visited = new Set<string>();
  // Reverse drainage search: every parent is closer to an outlet. Positive
  // costs make the resulting network acyclic, with shared downstream trunks.
  while (visited.size < adjacency.size) {
    let current: string | undefined, best = Infinity;
    for (const [id, value] of distance) if (!visited.has(id) && value < best) { current = id; best = value; }
    if (current === undefined) break;
    visited.add(current);
    for (const arc of adjacency.get(current)!) {
      const upstream = arc.from === current ? arc.to : arc.from;
      if (visited.has(upstream)) continue;
      const low = nodes.get(current)!, high = nodes.get(upstream)!;
      const uphill = Math.max(0, low.elevation - high.elevation);
      const cost = Math.max(1e-6, arc.length) * (1 + uphill * 12 + (low.elevation + high.elevation) * 0.4)
        * (0.9 + rank(`${seed}:flow:${arc.key}`) * 0.2);
      if (best + cost < distance.get(upstream)!) {
        distance.set(upstream, best + cost); parent.set(upstream, { node: current, arc });
      }
    }
  }
  const selected = new Set<string>(), riverNodes = new Set<string>(), outletIds = new Set<string>();
  type Route = { arcs: BorderRiverArc[]; nodes: string[]; outlet: string };
  /** Follow the drainage forest down to an outlet or an existing channel. */
  const descend = (source: string) => {
    const path: BorderRiverArc[] = [], pathNodes = [source];
    let at = source;
    while (parent.has(at) && !riverNodes.has(at)) {
      const next = parent.get(at)!;
      path.push(next.arc); at = next.node; pathNodes.push(at);
    }
    return { path, pathNodes, at };
  };
  const sourceScore = (source: string, length: number) => {
    const node = nodes.get(source)!;
    return node.headwater + node.elevation * 0.5 + Math.min(12, length) * 0.12
      + rank(`${seed}:source:${source}`) * 0.25;
  };
  const commit = (route: Route) => {
    for (const arc of route.arcs) selected.add(arc.key);
    for (const id of route.nodes) riverNodes.add(id);
    if (roots.has(route.outlet)) outletIds.add(route.outlet);
  };
  // Required borders seed networks before the free share, each with the
  // shortest complete channel through it: the border, then the drainage path
  // from its lower end to an outlet or an existing channel. A border that
  // would reach a new outlet alone gains one head border above it. Only new
  // nodes join the forest, so channels stay acyclic; later free headwaters
  // may extend these channels upstream like any other network.
  for (const key of required) {
    if (selected.has(key)) continue;
    const arc = arcs.get(key);
    let chosen: Route | undefined, bestLength = Infinity, bestScore = -Infinity;
    if (arc) for (const [up, down] of [[arc.from, arc.to], [arc.to, arc.from]] as const) {
      if (riverNodes.has(up) || roots.has(up)) continue;
      const tail = descend(down);
      if ((!roots.has(tail.at) && !riverNodes.has(tail.at)) || tail.pathNodes.includes(up)) continue;
      const minimum = riverNodes.has(tail.at) ? 1 : 2;
      const heads = [{ source: up, path: [] as BorderRiverArc[] }, ...adjacency.get(up)!.flatMap(link => link === arc ? []
        : [{ source: link.from === up ? link.to : link.from, path: [link] }])];
      for (const head of heads) {
        if (head.path.length && (riverNodes.has(head.source) || roots.has(head.source) || tail.pathNodes.includes(head.source))) continue;
        const length = head.path.length + 1 + tail.path.length;
        if (length < minimum) continue;
        const score = sourceScore(head.source, length);
        if (length < bestLength || (length === bestLength && score > bestScore)) {
          chosen = { arcs: [...head.path, arc, ...tail.path], outlet: tail.at,
            nodes: [...head.path.length ? [head.source] : [], up, ...tail.pathNodes] };
          bestLength = length; bestScore = score;
        }
      }
    }
    if (chosen) commit(chosen);
    else report.unroutedRequired.push(key);
  }
  while (selected.size < report.requestedBorders) {
    let chosen: Route | undefined, bestScore = -Infinity;
    for (const source of adjacency.keys()) {
      if (riverNodes.has(source) || roots.has(source)) continue;
      const { path, pathNodes, at } = descend(source);
      if (!roots.has(at) && !riverNodes.has(at)) continue;
      if (path.length < (riverNodes.has(at) ? 1 : 2) || path.length > report.requestedBorders - selected.size) continue;
      const score = sourceScore(source, path.length);
      if (score > bestScore) { chosen = { arcs: path, nodes: pathNodes, outlet: at }; bestScore = score; }
    }
    if (!chosen) break;
    commit(chosen);
  }
  const starts = new Set(options.protectedStartIds ?? []);
  for (const province of plane.provinces) if (province.start || province.teamStart !== undefined) starts.add(province.id);
  for (const key of selected) {
    const edge = arcs.get(key)!.edge;
    edge.kind = options.bridgeAll || starts.has(edge.a) || starts.has(edge.b) || edge.kind === "road" ? "bridge" : "river";
    delete edge.special;
  }
  report.riverBorders = selected.size;
  report.networkCount = outletIds.size;
  report.limited = selected.size < report.requestedBorders;
  return report;
}
