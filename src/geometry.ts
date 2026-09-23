import { isCaveProvince, isWaterProvince, planeGenerationKey, type Plane, type PlaneOwnershipMode, type Province } from "./domain";
import { createConnectedRegionOwnership } from "./connectedRegions";
import { createNaturalLandformWarp } from "./naturalLandforms";

export interface Point {
  x: number;
  y: number;
}

export interface Cell {
  provinceId: string;
  polygons: Point[][];
}

export interface BorderSegment {
  from: Point;
  to: Point;
}

export interface TopologyPair {
  a: string;
  b: string;
  key: string;
}

export interface ProvinceTopology {
  cells: Cell[];
  pairs: TopologyPair[];
  pairKeys: Set<string>;
  sharedBorders: Map<string, BorderSegment[]>;
}

export interface TopologyAudit {
  missing: TopologyPair[];
  extra: Array<{ a: string; b: string; key: string }>;
}

export interface ProvinceOwnerResolver {
  columns: number;
  rows: number;
  /** Province array index, or -1 for native D6M owner-0 negative space. */
  ownerAt: (x: number, y: number) => number;
}

export interface ProvinceChamberPrimitive {
  kind: "chamber";
  owner: number;
  center: Point;
  /** Conservative outer radius in metric units: (dx * width / height, dy), i.e. plane-height pixels. */
  radius: number;
  /** Oriented contour radii in the same metric; their product controls chamber area. */
  radiusX: number;
  radiusY: number;
  /** Rotation in metric (pixel-square) space. */
  rotation: number;
  rotationCos: number;
  rotationSin: number;
  /** 1 = fractured/diamond, 2 = organic/elliptic, 4 = tomb-like/boxy. */
  contourPower: 1 | 2 | 4;
  /** Rounded underground interpretation of the nominal contour grammar. */
  organicPower?: number;
  /** Smooth third/fifth angular harmonics; absent preserves the legacy contour. */
  outlineWaves?: readonly [number, number, number, number];
  /** Low-cost directional contour biases that make the analytic shape asymmetric. */
  warpX: number;
  warpY: number;
  /** Optional overlapping inner lobe, expressed in normalized local coordinates. */
  lobeX: number;
  lobeY: number;
  lobeScale: number;
  /** High-degree or deterministically selected focal province. */
  hub: boolean;
  /** Plane-specific visual grammar; ownership semantics remain identical. */
  silhouette: SparseSilhouette;
}

export interface ProvinceCorridorPrimitive {
  kind: "corridor";
  owners: readonly [number, number];
  key: string;
  /** The endpoint image that follows the shortest enabled wrap path. */
  from: Point;
  to: Point;
  /** Half-width in units of the plane's shorter pixel axis. */
  halfWidth: number;
  /** Optional gently curved centerline, with exact original endpoints and midpoint. */
  path?: readonly Point[];
  /** Per-path-point half-widths; linearly tapered between the samples. */
  halfWidths?: readonly number[];
}

export interface ProvinceBoundaryPrimitive {
  kind: "boundary";
  owner: number;
  axis: "x" | "y";
  side: "low" | "high";
  /** Endpoint chamber center. */
  from: Point;
  /** Exact nonwrapped unit-square boundary reached by the Styx. */
  to: Point;
  /** Half-width in units of the plane's shorter pixel axis. */
  halfWidth: number;
}

export type ProvinceOwnershipPrimitive = ProvinceChamberPrimitive | ProvinceCorridorPrimitive | ProvinceBoundaryPrimitive;

export type SparseSilhouette =
  | "cave-chamber"
  | "cavern-vault"
  | "cloud-island"
  | "air-stream"
  | "underworld-tomb"
  | "underworld-styx"
  | "infernal-fracture"
  | "abyss-pocket"
  | "dream-lobe"
  | "elemental-shard"
  | "custom-pocket";

export interface ProvinceOwnershipModel extends ProvinceOwnerResolver {
  mode: PlaneOwnershipMode;
  metricAspect: number;
  /** Declarative analytic shapes used by both owner sampling and future preview clipping. */
  primitives: readonly ProvinceOwnershipPrimitive[];
  /** Actual two-sided clipped regional frontiers, rather than tube midpoints. */
  regionBorders?: Map<string, BorderSegment[]>;
}

interface TaggedPoint extends Point {
  /** The province whose bisector owns the segment from the prior vertex. */
  incoming?: string;
}

/** The only province fields the periodic Voronoi partition reads. */
type VoronoiSite = Pick<Province, "id" | "index" | "x" | "y">;
interface VoronoiInput extends Pick<Plane, "wrapX" | "wrapY"> {
  provinces: readonly VoronoiSite[];
}

const EPSILON = 1e-9;
const topologyCache = new Map<string, ProvinceTopology>();
/**
 * PERF: the base Voronoi partition keyed only by what it reads (site order,
 * identity, position and wrapping). Terrain, flags, edges and landform
 * provenance change the full topology signature but never this partition, so
 * content edits reuse it instead of re-clipping every cell.
 */
const voronoiCache = new Map<string, ProvinceTopology>();
const ownershipCache = new Map<string, ProvinceOwnershipModel>();
const rasterAuditCache = new Map<string, TopologyAudit | undefined>();

export function connectionKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function computeVoronoiCells(plane: Plane): Cell[] {
  return computeProvinceTopology(plane).cells;
}

/**
 * Solid planes derive topology from periodic Voronoi borders. Sparse planes
 * use their authored graph as the topology source and only use Voronoi cells
 * as a legacy vector preview until the preview consumes the ownership model.
 */
export function computeProvinceTopology(plane: Plane): ProvinceTopology {
  const signature = geometrySignature(plane);
  const cached = topologyCache.get(signature);
  if (cached) return cached;
  if (!plane.provinces.length) {
    return cacheTopology(signature, { cells: [], pairs: [], pairKeys: new Set(), sharedBorders: new Map() });
  }

  if (resolvePlaneOwnershipMode(plane) === "solid") {
    const solid = baseVoronoiTopology(plane);
    const warp = createNaturalLandformWarp(plane);
    if (!warp) return cacheTopology(signature, solid);
    return cacheTopology(signature, {
      ...solid,
      cells: solid.cells.map(cell => ({ ...cell, polygons: cell.polygons.map(polygon => polygon.flatMap((from, index) =>
        warp.border(from, polygon[(index + 1) % polygon.length]!).map(segment => segment.from))) })),
      sharedBorders: new Map([...solid.sharedBorders].map(([key, segments]) => [key, segments.flatMap(segment => warp.border(segment.from, segment.to))])),
    });
  }

  const pairs = intentionalPairs(plane);
  const pairKeys = new Set(pairs.map((pair) => pair.key));
  const ownership = createProvinceOwnershipModel(plane, pairs);
  const sharedBorders = ownership.regionBorders ?? sparseSharedBorders(plane, ownership, pairKeys);
  // Sparse previews, exports and topology never read these legacy Voronoi
  // cells, so build them on first access. The snapshot pins the geometry this
  // topology was cached for; the enumerable getter keeps `.cells`, spreads,
  // JSON and deep equality returning the same polygons as an eager field.
  const sites: VoronoiInput = {
    wrapX: plane.wrapX,
    wrapY: plane.wrapY,
    provinces: plane.provinces.map(({ id, index, x, y }) => ({ id, index, x, y })),
  };
  let cells: Cell[] | undefined;
  return cacheTopology(signature, {
    get cells() { return cells ??= baseVoronoiTopology(sites).cells; },
    pairs,
    pairKeys,
    sharedBorders,
  });
}

function baseVoronoiTopology(plane: VoronoiInput): ProvinceTopology {
  const signature = voronoiSignature(plane);
  const cached = voronoiCache.get(signature);
  if (cached) return cached;
  const topology = computeSolidProvinceTopology(plane);
  if (voronoiCache.size >= 12) voronoiCache.delete(voronoiCache.keys().next().value!);
  voronoiCache.set(signature, topology);
  return topology;
}

function voronoiSignature(plane: VoronoiInput): string {
  // Quoted IDs and exact number spellings (including -0) keep the key unambiguous.
  const number = (value: number) => Object.is(value, -0) ? "-0" : String(value);
  return `${plane.wrapX ? 1 : 0}${plane.wrapY ? 1 : 0}|${plane.provinces
    .map((province) => `${JSON.stringify(province.id)}:${number(province.index)}:${number(province.x)}:${number(province.y)}`)
    .join(";")}`;
}

function computeSolidProvinceTopology(plane: VoronoiInput): ProvinceTopology {
  const xImages = plane.wrapX ? [-1, 0, 1] : [0];
  const yImages = plane.wrapY ? [-1, 0, 1] : [0];
  const provinceIndex = new Map(plane.provinces.map((province, index) => [province.id, index]));
  const cells: Cell[] = [];
  const pairKeys = new Set<string>();
  const sharedBorders = new Map<string, BorderSegment[]>();
  const segmentKeys = new Map<string, Set<string>>();

  for (const province of plane.provinces) {
    let polygon: TaggedPoint[] = initialPeriodicFrame(province, plane);
    for (const other of clippingCandidates(province, plane)) {
      for (const offsetY of yImages) {
        for (const offsetX of xImages) {
          const qx = other.x + offsetX;
          const qy = other.y + offsetY;
          const a = 2 * (qx - province.x);
          const b = 2 * (qy - province.y);
          const c = qx * qx + qy * qy - province.x * province.x - province.y * province.y;
          polygon = clipTaggedPolygon(polygon, a, b, c, other.id);
          if (!polygon.length) break;
        }
        if (!polygon.length) break;
      }
      if (!polygon.length) break;
    }

    const polygons: Point[][] = [];
    for (const offsetY of yImages) {
      for (const offsetX of xImages) {
        const translated = polygon.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
        const clipped = clipToUnitSquare(translated);
        if (clipped.length >= 3 && Math.abs(polygonArea(clipped)) > EPSILON) polygons.push(clipped);
      }
    }
    cells.push({ provinceId: province.id, polygons });

    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index]!;
      const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
      const neighbourId = current.incoming;
      if (!neighbourId || neighbourId === province.id) continue;
      if (Math.hypot(current.x - previous.x, current.y - previous.y) <= EPSILON) continue;
      const key = connectionKey(province.id, neighbourId);
      pairKeys.add(key);
      for (const offsetY of yImages) {
        for (const offsetX of xImages) {
          const segment = clipSegmentToUnitSquare(
            { x: previous.x + offsetX, y: previous.y + offsetY },
            { x: current.x + offsetX, y: current.y + offsetY },
          );
          if (segment) appendUniqueSegment(sharedBorders, segmentKeys, key, segment);
        }
      }
    }
  }

  const pairs = [...pairKeys].map((key) => {
    const [first, second] = key.split("|") as [string, string];
    const [a, b] = (provinceIndex.get(first) ?? 0) <= (provinceIndex.get(second) ?? 0)
      ? [first, second]
      : [second, first];
    return { a, b, key };
  });
  pairs.sort((left, right) =>
    (provinceIndex.get(left.a) ?? 0) - (provinceIndex.get(right.a) ?? 0)
    || (provinceIndex.get(left.b) ?? 0) - (provinceIndex.get(right.b) ?? 0));

  return { cells, pairs, pairKeys, sharedBorders };
}

function clippingCandidates(province: VoronoiSite, plane: VoronoiInput): VoronoiSite[] {
  const others = plane.provinces.filter((other) => other.id !== province.id);
  if (others.length <= 128) return others;
  const ranked = others.map((other) => {
    let dx = other.x - province.x;
    let dy = other.y - province.y;
    if (plane.wrapX) {
      if (dx > 0.5) dx -= 1;
      else if (dx < -0.5) dx += 1;
    }
    if (plane.wrapY) {
      if (dy > 0.5) dy -= 1;
      else if (dy < -0.5) dy += 1;
    }
    const angle = Math.atan2(dy, dx);
    const sector = Math.min(15, Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 16));
    return { province: other, distance: dx * dx + dy * dy, sector };
  }).sort((left, right) => left.distance - right.distance || left.province.index - right.province.index);
  const selected = new Map<string, VoronoiSite>();
  for (const item of ranked.slice(0, 64)) selected.set(item.province.id, item.province);
  const sectorCounts = new Array<number>(16).fill(0);
  for (const item of ranked) {
    if (sectorCounts[item.sector]! >= 4) continue;
    sectorCounts[item.sector] += 1;
    selected.set(item.province.id, item.province);
  }
  return [...selected.values()];
}

export function auditPlaneTopology(plane: Plane, topology = computeProvinceTopology(plane)): TopologyAudit {
  const edgeByKey = new Map<string, { a: string; b: string; key: string }>();
  for (const edge of plane.edges) {
    if (edge.a === edge.b) continue;
    const key = connectionKey(edge.a, edge.b);
    if (!edgeByKey.has(key)) edgeByKey.set(key, { a: edge.a, b: edge.b, key });
  }
  return {
    missing: topology.pairs.filter((pair) => !edgeByKey.has(pair.key)),
    extra: [...edgeByKey.values()].filter((pair) => !topology.pairKeys.has(pair.key)),
  };
}

/**
 * Native-resolution audit of a chamber-and-corridor plane, in the same terms
 * as auditPlaneTopology: `missing` lists provinces whose exported pixels touch
 * (8-connected) without a connection, `extra` lists connections without a
 * 4-connected shared border. Only windows where two unlinked shapes come
 * within reach, plus each link's frontier, are sampled; a consistent plane
 * costs a small fraction of rasterizing it. Connected-region and solid planes
 * derive their borders differently and return undefined.
 */
export function auditSparseRasterTopology(plane: Plane): TopologyAudit | undefined {
  if (resolvePlaneOwnershipMode(plane) !== "sparse" || usesConnectedRegions(plane) || !plane.provinces.length) return undefined;
  const width = plane.width, height = plane.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return undefined;
  if (plane.provinces.some((province) => !Number.isFinite(province.x) || !Number.isFinite(province.y))) return undefined;
  // Validation reruns on every edit; the raster only changes with the ownership signature.
  const signature = ownershipSignature(plane);
  if (rasterAuditCache.has(signature)) return rasterAuditCache.get(signature);
  const result = sparseRasterAudit(plane, width, height);
  if (rasterAuditCache.size >= 8) rasterAuditCache.delete(rasterAuditCache.keys().next().value!);
  rasterAuditCache.set(signature, result);
  return result;
}

function sparseRasterAudit(plane: Plane, width: number, height: number): TopologyAudit {
  const model = createProvinceOwnershipModel(plane);
  const aspect = model.metricAspect;
  const pixelX = aspect / width, pixelY = 1 / height, pixel = Math.max(pixelX, pixelY);
  const reach = pixel * 2;
  const indexById = new Map(plane.provinces.map((province, index) => [province.id, index]));
  const linked = new Set<string>();
  for (const edge of plane.edges) if (edge.a !== edge.b) linked.add(connectionKey(edge.a, edge.b));
  const isLinked = (a: number, b: number) => linked.has(connectionKey(plane.provinces[a]!.id, plane.provinces[b]!.id));
  // Mirrors samplePlaneOwnership and the D6M encoder, including forced capital pixels.
  const capitals = new Map<number, number>();
  plane.provinces.forEach((province, owner) => {
    const x = clampNumber(Math.round(province.x * (width - 1)), 0, width - 1);
    const y = clampNumber(Math.round(province.y * (height - 1)), 0, height - 1);
    capitals.set(y * width + x, owner);
  });
  // Owners + 2, so 0 marks a pixel not sampled yet (D6M owners fit 16 bits).
  const sampled = new Uint16Array(width * height);
  const ownerAt = (x: number, y: number): number => {
    if (plane.wrapX) x = ((x % width) + width) % width; else if (x < 0 || x >= width) return -1;
    if (plane.wrapY) y = ((y % height) + height) % height; else if (y < 0 || y >= height) return -1;
    const pixelIndex = y * width + x;
    const cached = sampled[pixelIndex]!;
    if (cached) return cached - 2;
    let owner = capitals.get(pixelIndex) ?? model.ownerAt((x + 0.5) / width, (y + 0.5) / height);
    if (owner >= plane.provinces.length) owner = -1;
    sampled[pixelIndex] = owner + 2;
    return owner;
  };
  const steps = [[1, 0, true], [0, 1, true], [1, 1, false], [-1, 1, false]] as const;
  /** Visits each contact in a metric window; stops when `visit` returns true. */
  const scan = (minX: number, minY: number, maxX: number, maxY: number, visit: (a: number, b: number, orthogonal: boolean) => boolean) => {
    const x0 = Math.floor(minX / aspect * width) - 1, x1 = Math.ceil(maxX / aspect * width) + 1;
    const y0 = Math.floor(minY * height) - 1, y1 = Math.ceil(maxY * height) + 1;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const a = ownerAt(x, y);
      if (a < 0) continue;
      for (const [dx, dy, orthogonal] of steps) {
        const b = ownerAt(x + dx, y + dy);
        if (b >= 0 && b !== a && visit(a, b, orthogonal)) return true;
      }
    }
    return false;
  };

  // Every owned pixel lies inside one of its owner's pieces: a chamber, one
  // half of a passage (split at the owners' bisector), a stub or its capital.
  interface Piece { owner: number; ax: number; ay: number; bx: number; by: number; radius: number }
  const pieces: Piece[] = [];
  const tolerance = pixel * 2;
  for (const primitive of model.primitives) {
    if (primitive.kind === "chamber") {
      const x = primitive.center.x * aspect, y = primitive.center.y;
      pieces.push({ owner: primitive.owner, ax: x, ay: y, bx: x, by: y, radius: Math.max(primitive.radius, pixel * 2) });
    } else if (primitive.kind === "boundary") {
      pieces.push({ owner: primitive.owner, ax: primitive.from.x * aspect, ay: primitive.from.y,
        bx: primitive.to.x * aspect, by: primitive.to.y, radius: primitive.halfWidth + tolerance });
    } else {
      const path = primitive.path ?? [primitive.from,
        { x: (primitive.from.x + primitive.to.x) / 2, y: (primitive.from.y + primitive.to.y) / 2 }, primitive.to];
      const middle = (path.length - 1) / 2;
      for (let segment = 0; segment < path.length - 1; segment += 1) {
        const from = path[segment]!, to = path[segment + 1]!;
        const radius = primitive.halfWidths
          ? Math.max(primitive.halfWidths[segment]!, primitive.halfWidths[segment + 1]!) : primitive.halfWidth;
        pieces.push({ owner: primitive.owners[segment < middle ? 0 : 1], ax: from.x * aspect, ay: from.y,
          bx: to.x * aspect, by: to.y, radius: radius + tolerance });
      }
    }
  }
  const offsetsX = plane.wrapX ? [-aspect, 0, aspect] : [0];
  const offsetsY = plane.wrapY ? [-1, 0, 1] : [0];
  // Bucket pieces on a province-spaced grid so only neighbouring pieces are compared.
  const cellSize = Math.max(pixel, medianSpacing(nearestProvinceSpacings(plane, aspect)));
  const columns = Math.max(1, Math.ceil(aspect / cellSize)), rows = Math.max(1, Math.ceil(1 / cellSize));
  const span = (low: number, high: number, count: number, extent: number, wrap: boolean): [number, number] => {
    const first = Math.floor(low / extent * count), last = Math.floor(high / extent * count);
    return wrap ? [first, last] : [clampNumber(first, 0, count - 1), clampNumber(last, 0, count - 1)];
  };
  const wrapCell = (cell: number, count: number) => ((cell % count) + count) % count;
  const cells = new Map<number, number[]>();
  pieces.forEach((piece, index) => {
    const pad = piece.radius + reach;
    const [left, right] = span(Math.min(piece.ax, piece.bx) - pad, Math.max(piece.ax, piece.bx) + pad, columns, aspect, plane.wrapX);
    const [top, bottom] = span(Math.min(piece.ay, piece.by) - pad, Math.max(piece.ay, piece.by) + pad, rows, 1, plane.wrapY);
    for (let row = top; row <= bottom; row += 1) for (let column = left; column <= right; column += 1) {
      const key = wrapCell(row, rows) * columns + wrapCell(column, columns);
      const list = cells.get(key) ?? [];
      if (list.at(-1) !== index) list.push(index);
      cells.set(key, list);
    }
  });
  const unlinked = new Map<string, TopologyPair>();
  const compared = new Set<string>();
  const record = (a: number, b: number) => {
    if (isLinked(a, b)) return false;
    const [first, second] = plane.provinces[a]!.index <= plane.provinces[b]!.index ? [a, b] : [b, a];
    const key = connectionKey(plane.provinces[first]!.id, plane.provinces[second]!.id);
    unlinked.set(key, { a: plane.provinces[first]!.id, b: plane.provinces[second]!.id, key });
    return false;
  };
  for (const list of cells.values()) {
    for (let left = 0; left < list.length; left += 1) for (let right = left + 1; right < list.length; right += 1) {
      const p = pieces[list[left]!]!, q = pieces[list[right]!]!;
      if (p.owner === q.owner || isLinked(p.owner, q.owner)) continue;
      const pairKey = `${Math.min(list[left]!, list[right]!)}:${Math.max(list[left]!, list[right]!)}`;
      if (compared.has(pairKey)) continue;
      compared.add(pairKey);
      for (const oy of offsetsY) for (const ox of offsetsX) {
        const gap = Math.sqrt(segmentDistanceSquared(p.ax, p.ay, p.bx, p.by, q.ax + ox, q.ay + oy, q.bx + ox, q.by + oy));
        if (gap >= p.radius + q.radius + reach) continue;
        // Sample where the two dilated pieces overlap.
        const minX = Math.max(Math.min(p.ax, p.bx) - p.radius, Math.min(q.ax, q.bx) + ox - q.radius) - reach;
        const maxX = Math.min(Math.max(p.ax, p.bx) + p.radius, Math.max(q.ax, q.bx) + ox + q.radius) + reach;
        const minY = Math.max(Math.min(p.ay, p.by) - p.radius, Math.min(q.ay, q.by) + oy - q.radius) - reach;
        const maxY = Math.min(Math.max(p.ay, p.by) + p.radius, Math.max(q.ay, q.by) + oy + q.radius) + reach;
        if (minX <= maxX && minY <= maxY) scan(minX, minY, maxX, maxY, record);
      }
    }
  }

  const edgesWithoutBorder: TopologyPair[] = [];
  const corridors = new Map(model.primitives.flatMap((primitive) =>
    primitive.kind === "corridor" ? [[primitive.key, primitive] as const] : []));
  for (const pair of intentionalPairs(plane)) {
    const a = indexById.get(pair.a)!, b = indexById.get(pair.b)!;
    const corridor = corridors.get(pair.key);
    const meets = (left: number, right: number, orthogonal: boolean) => orthogonal
      && ((left === a && right === b) || (left === b && right === a));
    let found = false;
    if (corridor) {
      const radius = Math.max(corridor.halfWidth, ...(corridor.halfWidths ?? [])) + tolerance;
      const middleX = (corridor.from.x + corridor.to.x) / 2 * aspect, middleY = (corridor.from.y + corridor.to.y) / 2;
      // The two owners meet on their bisector: probe along it first.
      const dx = (corridor.to.x - corridor.from.x) * aspect, dy = corridor.to.y - corridor.from.y;
      const length = Math.hypot(dx, dy);
      if (length > EPSILON) {
        const nx = -dy / length, ny = dx / length;
        for (let offset = -radius; offset <= radius && !found; offset += pixel / 2) {
          const x = Math.floor((middleX + nx * offset) / aspect * width), y = Math.floor((middleY + ny * offset) * height);
          const owner = ownerAt(x, y);
          if (owner !== a && owner !== b) continue;
          const other = owner === a ? b : a;
          found = ownerAt(x + 1, y) === other || ownerAt(x - 1, y) === other
            || ownerAt(x, y + 1) === other || ownerAt(x, y - 1) === other;
        }
      }
      if (!found) {
        const points = corridor.path ?? [corridor.from, corridor.to];
        found = scan(Math.min(...points.map((point) => point.x)) * aspect - radius, Math.min(...points.map((point) => point.y)) - radius,
          Math.max(...points.map((point) => point.x)) * aspect + radius, Math.max(...points.map((point) => point.y)) + radius, meets);
      }
    }
    if (!found) edgesWithoutBorder.push(pair);
  }
  return { missing: [...unlinked.values()], extra: edgesWithoutBorder };
}

export function resolvePlaneOwnershipMode(plane: Pick<Plane, "kind" | "ownershipMode">): PlaneOwnershipMode {
  if (plane.ownershipMode === "solid" || plane.ownershipMode === "sparse") return plane.ownershipMode;
  return plane.kind === "surface" || plane.kind === "custom" ? "solid" : "sparse";
}

/** Sparse realms use adjoining regions; the Styx retains its dedicated layout. */
export function usesConnectedRegions(plane: Pick<Plane, "kind" | "ownershipMode">): boolean {
  return resolvePlaneOwnershipMode(plane) === "sparse" && plane.kind !== "underworld";
}

/**
 * Whether the editor may author a new same-plane movement edge. Solid planes
 * must already have a positive-length shared Voronoi border. On sparse planes
 * the authored edge is itself the declaration that creates the visible/D6M
 * corridor, so any distinct pair of existing, currently unlinked provinces is
 * valid.
 */
export function canAuthorPlaneEdge(plane: Plane, aId: string, bId: string): boolean {
  if (aId === bId) return false;
  const provinceIds = new Set(plane.provinces.map((province) => province.id));
  if (!provinceIds.has(aId) || !provinceIds.has(bId)) return false;
  const key = connectionKey(aId, bId);
  if (plane.edges.some((edge) => connectionKey(edge.a, edge.b) === key)) return false;
  if (resolvePlaneOwnershipMode(plane) === "sparse") return true;
  return computeProvinceTopology(plane).pairKeys.has(key);
}

/** Canonical deterministic ownership used by D6M export and reusable by previews. */
export function createProvinceOwnershipModel(
  plane: Plane,
  knownPairs?: readonly TopologyPair[],
): ProvinceOwnershipModel {
  const signature = ownershipSignature(plane);
  const cached = ownershipCache.get(signature);
  if (cached) return cached;
  const mode = resolvePlaneOwnershipMode(plane);
  const metricAspect = plane.height > 0 && Number.isFinite(plane.width / plane.height)
    ? Math.max(0.08, Math.min(12, plane.width / plane.height))
    : 1;
  const columns = Math.max(3, Math.ceil(Math.sqrt(Math.max(1, plane.provinces.length) * metricAspect)));
  const rows = Math.max(2, Math.ceil(Math.max(1, plane.provinces.length) / columns));

  if (mode === "solid" || !plane.provinces.length) {
    const snapshot = { ...plane, provinces: plane.provinces.map(province => ({ ...province })) };
    const buckets = buildCandidateBuckets(snapshot, columns, rows);
    const warp = mode === "solid" ? createNaturalLandformWarp(snapshot) : undefined;
    return cacheOwnership(signature, {
      mode,
      metricAspect,
      columns,
      rows,
      primitives: [],
      ownerAt: (x, y) => {
        if (!snapshot.provinces.length) return -1;
        const normalizedX = normalizeCoordinate(x, snapshot.wrapX);
        const normalizedY = normalizeCoordinate(y, snapshot.wrapY);
        const original = warp?.inverse(normalizedX, normalizedY);
        const nx = original?.x ?? normalizedX, ny = original?.y ?? normalizedY;
        const bucketX = Math.max(0, Math.min(columns - 1, Math.floor(nx * columns)));
        const bucketY = Math.max(0, Math.min(rows - 1, Math.floor(ny * rows)));
        return nearestOwner(nx, ny, buckets[bucketY * columns + bucketX]!, snapshot);
      },
    });
  }

  if (usesConnectedRegions(plane)) {
    const regions = createConnectedRegionOwnership(plane);
    if (regions) return cacheOwnership(signature, regions);
  }
  const solidPairs = knownPairs ?? intentionalPairs(plane);
  const nearestSpacings = nearestProvinceSpacings(plane, metricAspect);
  const spacing = medianSpacing(nearestSpacings);
  const profile = sparseProfile(plane.kind);
  const pixelFloor = 2 / Math.max(1, Math.min(plane.width, plane.height));
  const degreeById = new Map(plane.provinces.map((province) => [province.id, 0]));
  for (const pair of solidPairs) {
    degreeById.set(pair.a, (degreeById.get(pair.a) ?? 0) + 1);
    degreeById.set(pair.b, (degreeById.get(pair.b) ?? 0) + 1);
  }
  const provinceById = new Map(plane.provinces.map((province, index) => [province.id, { province, index }]));
  const styxBoundary = styxBoundaryEndpoints(plane, solidPairs, provinceById);
  const styxFlowAngles = plane.kind === "underworld"
    ? underworldWaterFlowAngles(plane, solidPairs, metricAspect, provinceById)
    : new Map<string, number>();
  const primitives: ProvinceOwnershipPrimitive[] = plane.provinces.map((province, owner) => createChamberPrimitive(
    plane,
    province,
    owner,
    degreeById.get(province.id) ?? 0,
    nearestSpacings[owner] ?? spacing,
    spacing,
    pixelFloor,
    profile,
    styxFlowAngles.get(province.id),
  ));
  const styxWidthsByOwner = new Map<number, number[]>();
  for (const pair of solidPairs) {
    const a = provinceById.get(pair.a);
    const b = provinceById.get(pair.b);
    if (!a || !b || a.index === b.index) continue;
    const to = shortestPeriodicEndpoint(a.province, b.province, plane);
    const styxConnector = plane.kind === "underworld"
      && isWaterProvince(a.province)
      && isWaterProvince(b.province);
    const halfWidth = sparseCorridorHalfWidth(plane, profile, spacing, pixelFloor, pair.key,
      isWaterProvince(a.province), isWaterProvince(b.province));
    primitives.push({
      kind: "corridor",
      owners: [a.index, b.index],
      key: pair.key,
      from: { x: a.province.x, y: a.province.y },
      to,
      halfWidth,
    });
    if (styxConnector) {
      for (const owner of [a.index, b.index]) {
        const widths = styxWidthsByOwner.get(owner) ?? [];
        widths.push(halfWidth);
        styxWidthsByOwner.set(owner, widths);
      }
    }
  }
  if (styxBoundary) {
    for (const endpoint of [styxBoundary.low, styxBoundary.high]) {
      const widths = styxWidthsByOwner.get(endpoint.index) ?? [];
      const halfWidth = widths.length
        ? widths.reduce((sum, width) => sum + width, 0) / widths.length
        : Math.max(pixelFloor * 0.72, spacing * profile.corridorScale * 1.34);
      primitives.push({
        kind: "boundary",
        owner: endpoint.index,
        axis: styxBoundary.axis,
        side: endpoint === styxBoundary.low ? "low" : "high",
        from: { x: endpoint.province.x, y: endpoint.province.y },
        to: styxBoundary.axis === "x"
          ? { x: endpoint === styxBoundary.low ? 0 : 1, y: endpoint.province.y }
          : { x: endpoint.province.x, y: endpoint === styxBoundary.low ? 0 : 1 },
        halfWidth,
      });
    }
  }

  if (isOrganicUndergroundKind(plane.kind)) {
    shapeUndergroundCorridors(primitives, plane, spacing, pixelFloor, metricAspect);
  }

  const primitiveCopies = buildSparsePrimitiveCopies(primitives, plane, metricAspect);
  const copies = packSparsePrimitiveCopies(primitiveCopies, metricAspect);
  const lookup = refineSparseBuckets(bucketSparsePrimitiveCopies(primitiveCopies, columns, rows), copies, columns, rows);
  const { fineColumns, fineRows, offsets: lookupOffsets, entries: lookupEntries } = lookup;
  const styxEdgeInsetX = 1 / Math.max(1, Math.round(plane.width));
  const styxEdgeInsetY = 1 / Math.max(1, Math.round(plane.height));
  // An explicit Styx crossing is drawn over the river it crosses: its straight
  // tube stays with its two banks, so the crossing remains a shared border and
  // the water it cuts meets it only as the ford links the generator declares.
  const crossingKeys = plane.kind === "underworld"
    ? new Set(plane.edges.filter(isExplicitBridge).map((edge) => connectionKey(edge.a, edge.b)))
    : new Set<string>();
  const crossings = new Uint8Array(primitives.length);
  primitives.forEach((primitive, index) => {
    if (primitive.kind === "corridor" && !primitive.path && crossingKeys.has(primitive.key)) crossings[index] = 1;
  });
  // PERF: per-sample scratch, reused instead of two Sets per call. Linear
  // de-duplication keeps the Sets' first-insertion order, which the nearest
  // owner's EPSILON tie scan depends on. A bucket copy adds at most two owners.
  const scratchSize = 2 * Math.max(1, lookup.longest);
  const candidates = new Int32Array(scratchSize);
  const crossingOwners = new Int32Array(scratchSize);
  const addOwner = (list: Int32Array, count: number, owner: number): number => {
    for (let index = 0; index < count; index += 1) if (list[index] === owner) return count;
    list[count] = owner;
    return count + 1;
  };
  return cacheOwnership(signature, {
    mode,
    metricAspect,
    columns,
    rows,
    primitives,
    ownerAt: (x, y) => {
      const nx = normalizeCoordinate(x, plane.wrapX);
      const ny = normalizeCoordinate(y, plane.wrapY);
      if ((!plane.wrapX && (x < 0 || x > 1)) || (!plane.wrapY && (y < 0 || y > 1))) return -1;
      let restrictedStyxSide: "low" | "high" | undefined;
      if (styxBoundary) {
        const xSide = plane.wrapX ? undefined : outerEdgeSide(nx, styxEdgeInsetX);
        const ySide = plane.wrapY ? undefined : outerEdgeSide(ny, styxEdgeInsetY);
        if (styxBoundary.axis === "x" ? ySide : xSide) return -1;
        restrictedStyxSide = styxBoundary.axis === "x" ? xSide : ySide;
      }
      // Scaling by a power of two is exact, so this fine cell lies inside the
      // coarse bucket floor(n * columns/rows) the lookup has always used.
      const bucketX = Math.max(0, Math.min(fineColumns - 1, Math.floor(nx * fineColumns)));
      const bucketY = Math.max(0, Math.min(fineRows - 1, Math.floor(ny * fineRows)));
      const bucket = bucketY * fineColumns + bucketX;
      // A non-finite coordinate has no bucket; keep the former lookup failure.
      if (Number.isNaN(bucket)) throw new TypeError("Sparse ownership cannot sample a non-finite coordinate.");
      let candidateCount = 0;
      let crossingCount = 0;
      for (let slot = lookupOffsets[bucket]!, end = lookupOffsets[bucket + 1]!; slot < end; slot += 1) {
        const copy = lookupEntries[slot]!;
        // PERF: every shape test below is false outside its copy's padded
        // bounding box, so skipping those copies cannot change the owner.
        if (nx < copies.minX[copy]! || nx > copies.maxX[copy]! || ny < copies.minY[copy]! || ny > copies.maxY[copy]!) continue;
        const primitiveIndex = copies.primitiveIndex[copy]!;
        const offsetX = copies.offsetX[copy]!, offsetY = copies.offsetY[copy]!;
        const primitive = primitives[primitiveIndex]!;
        if (restrictedStyxSide
          && (primitive.kind !== "boundary"
            || primitive.axis !== styxBoundary?.axis
            || primitive.side !== restrictedStyxSide)) continue;
        if (primitive.kind === "chamber") {
          const dx = (nx - (primitive.center.x + offsetX)) * metricAspect;
          const dy = ny - (primitive.center.y + offsetY);
          if (pointInsideChamber(dx, dy, primitive)) candidateCount = addOwner(candidates, candidateCount, primitive.owner);
          continue;
        }
        const segmentIndex = copies.segmentIndex[copy]!;
        if (primitive.kind === "corridor" && primitive.path && segmentIndex >= 0) {
          if (pointInsideCorridorSegment(nx - offsetX, ny - offsetY, primitive, segmentIndex, metricAspect)) {
            candidateCount = addOwner(candidates, candidateCount, primitive.owners[0]);
            candidateCount = addOwner(candidates, candidateCount, primitive.owners[1]);
          }
          continue;
        }
        const distance = pointSegmentDistanceSquared(
          nx * metricAspect,
          ny,
          (primitive.from.x + offsetX) * metricAspect,
          primitive.from.y + offsetY,
          (primitive.to.x + offsetX) * metricAspect,
          primitive.to.y + offsetY,
        );
        if (distance <= primitive.halfWidth * primitive.halfWidth + EPSILON) {
          if (primitive.kind === "boundary") candidateCount = addOwner(candidates, candidateCount, primitive.owner);
          else {
            candidateCount = addOwner(candidates, candidateCount, primitive.owners[0]);
            candidateCount = addOwner(candidates, candidateCount, primitive.owners[1]);
            if (crossings[primitiveIndex]) {
              crossingCount = addOwner(crossingOwners, crossingCount, primitive.owners[0]);
              crossingCount = addOwner(crossingOwners, crossingCount, primitive.owners[1]);
            }
          }
        }
      }
      if (crossingCount) return nearestMetricOwner(nx, ny, crossingOwners, crossingCount, plane, metricAspect);
      return candidateCount ? nearestMetricOwner(nx, ny, candidates, candidateCount, plane, metricAspect) : -1;
    },
  });
}

/** Backward-compatible resolver name; sparse models can now return -1. */
export function createProvinceOwnerResolver(plane: Plane): ProvinceOwnerResolver {
  return createProvinceOwnershipModel(plane);
}

/** A planned straight passage: a movement pair, or a Styx stub from one owner to a nonwrapped map edge. */
export interface SparsePassage {
  a: string;
  b?: string;
  boundary?: { axis: "x" | "y"; side: "low" | "high" };
}

/**
 * Conservative analytic clearance for generated chamber-and-corridor planes.
 * Every chamber is bounded by the same outer radius cap the ownership model
 * applies. Passages use their exact corridor width once the water that
 * widens Styx corridors is known (`water`), or the widest possible width
 * before then. A graph accepted here cannot acquire a native raster contact
 * between two provinces that are not linked, nor lose a declared link's contact.
 */
export interface SparsePassagePlanner {
  /** A passage keeps a drawable gap from every chamber except its own endpoints'. */
  clear(passage: SparsePassage): boolean;
  /** Provinces whose chambers a passage would reach. */
  blockers(passage: SparsePassage): string[];
  /**
   * Two passages cannot create a contact that is not one of their own links.
   * Passages sharing one endpoint only interact through their far halves;
   * `linked` may exempt a far-end pair that is itself a protected link.
   */
  compatible(first: SparsePassage, second: SparsePassage, linked?: (a: string, b: string) => boolean): boolean;
  /**
   * Contacts a straight explicit bridge creates when it crosses other shapes,
   * as bridge endpoint plus touched owner. Undefined when the bridge would cut
   * the shared frontier of another link, or cover another province's centre
   * unless `coverCentres` accepts that (the covered province then touches both
   * halves, and its contacts are marked `covered`).
   */
  bridgeContacts(
    a: string,
    b: string,
    passages: Iterable<SparsePassage>,
    options?: { coverCentres?: boolean },
  ): Array<{ endpoint: string; owner: string; covered?: boolean }> | undefined;
  /**
   * Whether a ford from a bridge endpoint keeps its own contact with that
   * endpoint: its shared frontier lies outside the straight bridge, or it
   * leaves the bridge beside the endpoint's own half of the crossing.
   */
  fordMeetsBank(endpoint: string, water: string, bridge: readonly [string, string]): boolean;
}

interface MetricSegment { ax: number; ay: number; bx: number; by: number }
interface MetricPassage {
  owners: readonly number[];
  segment: MetricSegment;
  halfWidth: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Native pixels kept between unrelated sparse shapes; above the √2 reach of an 8-connected pixel. */
const SPARSE_RASTER_MARGIN_PIXELS = 2;

export function createSparsePassagePlanner(plane: Plane, water?: (provinceId: string) => boolean): SparsePassagePlanner {
  const aspect = plane.height > 0 && Number.isFinite(plane.width / plane.height)
    ? Math.max(0.08, Math.min(12, plane.width / plane.height))
    : 1;
  const pixel = Math.max(aspect / Math.max(1, plane.width), 1 / Math.max(1, plane.height));
  const margin = pixel * SPARSE_RASTER_MARGIN_PIXELS;
  const pixelFloor = 2 / Math.max(1, Math.min(plane.width, plane.height));
  const nearest = nearestProvinceSpacings(plane, aspect);
  const spacing = medianSpacing(nearest);
  const profile = sparseProfile(plane.kind);
  // Mirrors createChamberPrimitive's safe outer radius and the widest
  // (flooded/Styx) corridor roll in createProvinceOwnershipModel. Styx edge
  // stubs average their owner's water corridors, so they use that bound too.
  const chamberBound = nearest.map((local) => Math.max(pixelFloor * 1.25, local * 0.43));
  const maximumChamber = Math.max(0, ...chamberBound);
  const halfWidth = Math.max(pixelFloor * 0.72, spacing * profile.corridorScale * profile.corridorWidthRange[1]
    * (isCaveFamilyKind(plane.kind) ? 1.12 : 1) * (plane.kind === "underworld" ? 1.34 : 1));
  const corridorHalfWidth = (a: number, b: number) => water
    ? sparseCorridorHalfWidth(plane, profile, spacing, pixelFloor, connectionKey(idOf(a), idOf(b)), water(idOf(a)), water(idOf(b)))
    : halfWidth;
  const indexById = new Map(plane.provinces.map((province, index) => [province.id, index]));
  const idOf = (index: number) => plane.provinces[index]!.id;
  const offsetsX = plane.wrapX ? [-aspect, 0, aspect] : [0];
  const offsetsY = plane.wrapY ? [-1, 0, 1] : [0];
  const resolved = new Map<string, MetricPassage | null>();
  const blockerCache = new Map<string, string[]>();
  const keyOf = (passage: SparsePassage) => passage.boundary
    ? `${passage.a}>${passage.boundary.axis}:${passage.boundary.side}`
    : passage.b === undefined ? passage.a : connectionKey(passage.a, passage.b);
  const metric = (owners: readonly number[], ax: number, ay: number, bx: number, by: number): MetricPassage => ({
    owners, halfWidth: owners.length === 2 ? corridorHalfWidth(owners[0]!, owners[1]!) : halfWidth, segment: { ax, ay, bx, by },
    minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minY: Math.min(ay, by), maxY: Math.max(ay, by),
  });

  const resolve = (passage: SparsePassage): MetricPassage | undefined => {
    const key = keyOf(passage);
    const cached = resolved.get(key);
    if (cached !== undefined) return cached ?? undefined;
    let result: MetricPassage | undefined;
    const a = indexById.get(passage.a);
    if (a !== undefined) {
      const from = plane.provinces[a]!;
      if (passage.boundary) {
        const to = passage.boundary.axis === "x"
          ? { x: passage.boundary.side === "low" ? 0 : 1, y: from.y }
          : { x: from.x, y: passage.boundary.side === "low" ? 0 : 1 };
        result = metric([a], from.x * aspect, from.y, to.x * aspect, to.y);
      } else {
        const b = passage.b === undefined ? undefined : indexById.get(passage.b);
        if (b !== undefined && b !== a) {
          const to = shortestPeriodicEndpoint(from, plane.provinces[b]!, plane);
          result = metric([a, b], from.x * aspect, from.y, to.x * aspect, to.y);
        }
      }
    }
    resolved.set(key, result ?? null);
    return result;
  };
  const half = (passage: MetricPassage, owner: number): MetricSegment => {
    const { ax, ay, bx, by } = passage.segment;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    return passage.owners[0] === owner ? { ax, ay, bx: mx, by: my } : { ax: mx, ay: my, bx, by };
  };
  const boxesNear = (left: MetricPassage, right: MetricPassage, reach: number): boolean => {
    for (const oy of offsetsY) for (const ox of offsetsX) {
      const dx = Math.max(0, right.minX + ox - left.maxX, left.minX - right.maxX - ox);
      const dy = Math.max(0, right.minY + oy - left.maxY, left.minY - right.maxY - oy);
      if (dx * dx + dy * dy < reach * reach) return true;
    }
    return false;
  };
  const segmentGap = (left: MetricSegment, right: MetricSegment): number => {
    let best = Infinity;
    for (const oy of offsetsY) for (const ox of offsetsX) {
      best = Math.min(best, segmentDistanceSquared(left.ax, left.ay, left.bx, left.by,
        right.ax + ox, right.ay + oy, right.bx + ox, right.by + oy));
    }
    return Math.sqrt(best);
  };
  const pointGap = (x: number, y: number, segment: MetricSegment): number => {
    let best = Infinity;
    for (const oy of offsetsY) for (const ox of offsetsX) {
      best = Math.min(best, pointSegmentDistanceSquared(x + ox, y + oy, segment.ax, segment.ay, segment.bx, segment.by));
    }
    return Math.sqrt(best);
  };
  const nearbyChambers = (passage: MetricPassage, reach: number): number[] => {
    const extent = reach + maximumChamber;
    const found: number[] = [];
    plane.provinces.forEach((province, index) => {
      for (const oy of offsetsY) for (const ox of offsetsX) {
        const x = province.x * aspect + ox, y = province.y + oy;
        if (x >= passage.minX - extent && x <= passage.maxX + extent && y >= passage.minY - extent && y <= passage.maxY + extent) {
          found.push(index);
          return;
        }
      }
    });
    return found;
  };
  /**
   * A passage leaving a straight bridge endpoint keeps its own contact with
   * that endpoint when its frontier lies outside the crossing, or when it
   * leaves the crossing beside the endpoint's own half.
   */
  const meetsBank = (passage: MetricPassage, endpoint: number, crossing: MetricPassage): boolean => {
    // Both passages start at the endpoint; compare them in its frame.
    const s = crossing.segment, f = passage.segment;
    const ux = crossing.owners[0] === endpoint ? s.bx - s.ax : s.ax - s.bx;
    const uy = crossing.owners[0] === endpoint ? s.by - s.ay : s.ay - s.by;
    const vx = passage.owners[0] === endpoint ? f.bx - f.ax : f.ax - f.bx;
    const vy = passage.owners[0] === endpoint ? f.by - f.ay : f.ay - f.by;
    const length = Math.hypot(ux, uy), passageLength = Math.hypot(vx, vy);
    if (length <= EPSILON || passageLength <= EPSILON) return false;
    const reach = passage.halfWidth + crossing.halfWidth + margin;
    // Distance from the crossing grows monotonically along the passage.
    for (let step = 1; step <= 64; step += 1) {
      const t = step / 64, x = vx * t, y = vy * t;
      if (Math.sqrt(pointSegmentDistanceSquared(x, y, 0, 0, ux, uy)) < reach) continue;
      if (t * passageLength <= passageLength / 2 - margin) return true;
      return (x * ux + y * uy) / length + passage.halfWidth <= length / 2 - margin;
    }
    return false;
  };
  const blockers = (passage: SparsePassage): string[] => {
    const key = keyOf(passage);
    const cached = blockerCache.get(key);
    if (cached) return cached;
    const metricPassage = resolve(passage);
    const result: string[] = [];
    if (metricPassage) {
      for (const index of nearbyChambers(metricPassage, metricPassage.halfWidth + margin)) {
        if (metricPassage.owners.includes(index)) continue;
        const province = plane.provinces[index]!;
        if (pointGap(province.x * aspect, province.y, metricPassage.segment)
          < chamberBound[index]! + metricPassage.halfWidth + margin) result.push(province.id);
      }
    }
    blockerCache.set(key, result);
    return result;
  };

  return {
    clear: (passage) => !!resolve(passage) && !blockers(passage).length,
    blockers,
    compatible(first, second, linked) {
      const left = resolve(first), right = resolve(second);
      if (!left || !right) return false;
      const reach = left.halfWidth + right.halfWidth + margin;
      if (!boxesNear(left, right, reach)) return true;
      const shared = left.owners.filter((owner) => right.owners.includes(owner));
      const leftOnly = left.owners.filter((owner) => !shared.includes(owner));
      const rightOnly = right.owners.filter((owner) => !shared.includes(owner));
      // The same link, or a stub and a passage of its own owner: any contact is linked.
      if (!leftOnly.length || !rightOnly.length) return true;
      if (!shared.length) return segmentGap(left.segment, right.segment) >= reach;
      const p = leftOnly[0]!, q = rightOnly[0]!;
      if (linked?.(idOf(p), idOf(q))) return true;
      // Pixels on the shared owner's half belong to it and may touch either
      // neighbour; only the two far halves could meet as an unlinked pair.
      return segmentGap(half(left, p), half(right, q)) >= reach;
    },
    bridgeContacts(a, b, passages, options) {
      const bridge = resolve({ a, b });
      if (!bridge) return undefined;
      const [ai, bi] = bridge.owners as [number, number];
      const halves = [{ owner: ai, segment: half(bridge, ai) }, { owner: bi, segment: half(bridge, bi) }];
      const contacts = new Map<string, { endpoint: string; owner: string; covered?: boolean }>();
      const covered = new Set<number>();
      const add = (endpoint: number, owner: number) => {
        if (endpoint === owner || bridge.owners.includes(owner)) return;
        contacts.set(`${endpoint}:${owner}`, {
          endpoint: idOf(endpoint), owner: idOf(owner), ...(covered.has(owner) ? { covered: true } : {}),
        });
      };
      for (const index of nearbyChambers(bridge, bridge.halfWidth + margin)) {
        if (bridge.owners.includes(index)) continue;
        const province = plane.provinces[index]!;
        // A covered centre strands that province's forced capital pixel inside
        // the crossing and splits its chamber across both halves.
        if (pointGap(province.x * aspect, province.y, bridge.segment) < bridge.halfWidth + margin) {
          if (!options?.coverCentres) return undefined;
          covered.add(index);
          add(ai, index);
          add(bi, index);
          continue;
        }
        for (const bridgeHalf of halves) {
          if (pointGap(province.x * aspect, province.y, bridgeHalf.segment) < chamberBound[index]! + bridge.halfWidth + margin) {
            add(bridgeHalf.owner, index);
          }
        }
      }
      for (const passage of passages) {
        const other = resolve(passage);
        if (!other) continue;
        if (other.owners.length === 2 && other.owners.every((owner) => bridge.owners.includes(owner))) continue;
        const reach = bridge.halfWidth + other.halfWidth + margin;
        if (!boxesNear(bridge, other, reach)) continue;
        if (other.owners.length === 2) {
          // The crossing may not sever another link at its shared frontier;
          // a passage from a bridge endpoint may instead leave the crossing
          // beside that endpoint's own half, or end at a covered centre whose
          // split chamber meets both halves.
          const shared = other.owners.find((owner) => bridge.owners.includes(owner));
          const far = other.owners.find((owner) => owner !== shared);
          const { ax, ay, bx, by } = other.segment;
          if (shared === undefined ? pointGap((ax + bx) / 2, (ay + by) / 2, bridge.segment) < reach
            : !covered.has(far!) && !meetsBank(other, shared, bridge)) return undefined;
        }
        for (const owner of other.owners) {
          const segment = other.owners.length === 2 ? half(other, owner) : other.segment;
          for (const bridgeHalf of halves) {
            if (segmentGap(bridgeHalf.segment, segment) < reach) add(bridgeHalf.owner, owner);
          }
        }
      }
      return [...contacts.values()];
    },
    fordMeetsBank(endpoint, waterId, bridge) {
      const ford = resolve({ a: endpoint, b: waterId });
      const crossing = resolve({ a: bridge[0], b: bridge[1] });
      const endpointIndex = indexById.get(endpoint);
      return !!ford && !!crossing && endpointIndex !== undefined && crossing.owners.includes(endpointIndex)
        && meetsBank(ford, endpointIndex, crossing);
    },
  };
}

interface SparsePrimitiveCopy {
  primitiveIndex: number;
  segmentIndex?: number;
  offsetX: number;
  offsetY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function intentionalPairs(plane: Plane): TopologyPair[] {
  // On a sparse plane the authored movement graph is authoritative. Falling
  // back to Voronoi neighbours here silently fills owner-0 space with a dense
  // degree-six mesh and creates movement shortcuts that have no corridor.
  if (!plane.edges.length) return [];
  const provinceIndex = new Map(plane.provinces.map((province, index) => [province.id, index]));
  const pairs = new Map<string, TopologyPair>();
  for (const edge of plane.edges) {
    if (edge.a === edge.b || !provinceIndex.has(edge.a) || !provinceIndex.has(edge.b)) continue;
    const key = connectionKey(edge.a, edge.b);
    const [a, b] = provinceIndex.get(edge.a)! <= provinceIndex.get(edge.b)!
      ? [edge.a, edge.b]
      : [edge.b, edge.a];
    if (!pairs.has(key)) pairs.set(key, { a, b, key });
  }
  return [...pairs.values()].sort((left, right) =>
    provinceIndex.get(left.a)! - provinceIndex.get(right.a)!
    || provinceIndex.get(left.b)! - provinceIndex.get(right.b)!);
}

interface StyxBoundaryEndpoints {
  axis: "x" | "y";
  low: { province: Province; index: number };
  high: { province: Province; index: number };
}

function styxBoundaryEndpoints(
  plane: Plane,
  pairs: readonly TopologyPair[],
  provinceById: ReadonlyMap<string, { province: Province; index: number }>,
): StyxBoundaryEndpoints | undefined {
  if (plane.kind !== "underworld") return undefined;
  const axis = plane.width >= plane.height ? "x" : "y";
  if ((axis === "x" && plane.wrapX) || (axis === "y" && plane.wrapY)) return undefined;
  const water = [...provinceById.values()].filter(({ province }) => isWaterProvince(province) && isCaveProvince(province));
  if (water.length < 2) return undefined;
  const coordinate = ({ province }: { province: Province }) => axis === "x" ? province.x : province.y;
  const low = [...water].sort((a, b) => coordinate(a) - coordinate(b) || a.province.index - b.province.index)[0]!;
  const high = [...water].sort((a, b) => coordinate(b) - coordinate(a) || a.province.index - b.province.index)[0]!;
  if (low.index === high.index) return undefined;

  // A boundary paint is valid only when authored water-water movement already
  // connects the two endpoint owners. The stubs finish that visible band at
  // the raster edges; they never repair or invent movement topology.
  const waterIds = new Set(water.map(({ province }) => province.id));
  const adjacency = new Map([...waterIds].map((id) => [id, [] as string[]]));
  for (const pair of pairs) {
    if (!waterIds.has(pair.a) || !waterIds.has(pair.b)) continue;
    adjacency.get(pair.a)!.push(pair.b);
    adjacency.get(pair.b)!.push(pair.a);
  }
  const reached = new Set<string>([low.province.id]);
  const queue = [low.province.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const neighbour of adjacency.get(id) ?? []) {
      if (reached.has(neighbour)) continue;
      reached.add(neighbour);
      queue.push(neighbour);
    }
  }
  if (!reached.has(high.province.id)) return undefined;
  return { axis, low, high };
}

interface SparseShapeProfile {
  silhouette: SparseSilhouette;
  chamberScale: number;
  corridorScale: number;
  chamberScaleRange: readonly [number, number];
  corridorWidthRange: readonly [number, number];
  aspectRange: readonly [number, number];
  rotationMode: "free" | "horizontal" | "orthogonal";
  rotationJitter: number;
  contourPowers: readonly (1 | 2 | 4)[];
  warp: number;
  lobeChance: number;
  lobeScaleRange: readonly [number, number];
  hubDegree: number;
  incidentalHubChance: number;
  hubBoost: number;
}

function isCaveFamilyKind(kind: Plane["kind"]): boolean {
  return kind === "cave" || kind === "cavern";
}

function isOrganicUndergroundKind(kind: Plane["kind"]): boolean {
  return isCaveFamilyKind(kind) || kind === "underworld" || kind === "hell" || kind === "abyss";
}

/**
 * These are visual design profiles, not claimed game rules. They translate
 * the unequal organic polygons visible in official maps and the separated
 * realm masses in the locally installed authored atlas into analytic sparse
 * silhouettes while leaving movement topology entirely edge-authored.
 */
function sparseProfile(kind: Plane["kind"]): SparseShapeProfile {
  switch (kind) {
    case "cave": return {
      silhouette: "cave-chamber",
      chamberScale: 0.285,
      corridorScale: 0.066,
      chamberScaleRange: [0.88, 1.1],
      corridorWidthRange: [0.78, 1.12],
      aspectRange: [1.05, 1.55],
      rotationMode: "free",
      rotationJitter: 0,
      contourPowers: [2, 2, 2, 4],
      warp: 0.1,
      lobeChance: 0.42,
      lobeScaleRange: [0.4, 0.56],
      hubDegree: 4,
      incidentalHubChance: 0.035,
      hubBoost: 0.28,
    };
    case "cavern": return {
      silhouette: "cavern-vault",
      chamberScale: 0.305,
      corridorScale: 0.071,
      chamberScaleRange: [0.9, 1.14],
      corridorWidthRange: [0.82, 1.18],
      aspectRange: [1.12, 1.85],
      rotationMode: "free",
      rotationJitter: 0,
      contourPowers: [2, 2, 4],
      warp: 0.13,
      lobeChance: 0.62,
      lobeScaleRange: [0.43, 0.6],
      hubDegree: 3,
      incidentalHubChance: 0.045,
      hubBoost: 0.34,
    };
    case "cloud": return {
      silhouette: "cloud-island",
      chamberScale: 0.255,
      corridorScale: 0.046,
      chamberScaleRange: [0.82, 1.08],
      corridorWidthRange: [0.7, 1.06],
      aspectRange: [1.65, 2.55],
      rotationMode: "horizontal",
      rotationJitter: 0.42,
      contourPowers: [2, 2, 4],
      warp: 0.085,
      lobeChance: 0.58,
      lobeScaleRange: [0.4, 0.58],
      hubDegree: 4,
      incidentalHubChance: 0.03,
      hubBoost: 0.24,
    };
    case "air": return {
      silhouette: "air-stream",
      chamberScale: 0.225,
      corridorScale: 0.037,
      chamberScaleRange: [0.78, 1.03],
      corridorWidthRange: [0.66, 1.0],
      aspectRange: [2.15, 3.15],
      rotationMode: "horizontal",
      rotationJitter: 0.26,
      contourPowers: [2, 2, 2, 4],
      warp: 0.055,
      lobeChance: 0.36,
      lobeScaleRange: [0.36, 0.52],
      hubDegree: 5,
      incidentalHubChance: 0.02,
      hubBoost: 0.2,
    };
    case "underworld": return {
      silhouette: "underworld-tomb",
      chamberScale: 0.285,
      corridorScale: 0.059,
      chamberScaleRange: [0.88, 1.1],
      corridorWidthRange: [0.76, 1.08],
      aspectRange: [1.16, 1.72],
      rotationMode: "orthogonal",
      rotationJitter: 0.08,
      contourPowers: [4, 4, 4, 2],
      warp: 0.035,
      lobeChance: 0.08,
      lobeScaleRange: [0.35, 0.45],
      hubDegree: 3,
      incidentalHubChance: 0.035,
      hubBoost: 0.3,
    };
    case "hell": return {
      silhouette: "infernal-fracture",
      chamberScale: 0.26,
      corridorScale: 0.052,
      chamberScaleRange: [0.82, 1.12],
      corridorWidthRange: [0.7, 1.08],
      aspectRange: [1.18, 1.9],
      rotationMode: "free",
      rotationJitter: 0,
      contourPowers: [1, 1, 1, 2],
      warp: 0.12,
      lobeChance: 0.16,
      lobeScaleRange: [0.34, 0.48],
      hubDegree: 4,
      incidentalHubChance: 0.035,
      hubBoost: 0.3,
    };
    case "abyss": return {
      silhouette: "abyss-pocket",
      chamberScale: 0.205,
      corridorScale: 0.03,
      chamberScaleRange: [0.7, 1.0],
      corridorWidthRange: [0.62, 0.94],
      aspectRange: [1.04, 1.5],
      rotationMode: "free",
      rotationJitter: 0,
      contourPowers: [2, 2, 1],
      warp: 0.075,
      lobeChance: 0.14,
      lobeScaleRange: [0.34, 0.48],
      hubDegree: 3,
      incidentalHubChance: 0.07,
      hubBoost: 0.78,
    };
    case "dream": return {
      silhouette: "dream-lobe",
      chamberScale: 0.255,
      corridorScale: 0.047,
      chamberScaleRange: [0.84, 1.12],
      corridorWidthRange: [0.7, 1.08],
      aspectRange: [1.16, 2.08],
      rotationMode: "free",
      rotationJitter: 0,
      contourPowers: [2, 2, 4],
      warp: 0.18,
      lobeChance: 0.92,
      lobeScaleRange: [0.48, 0.7],
      hubDegree: 3,
      incidentalHubChance: 0.055,
      hubBoost: 0.36,
    };
    case "elemental": return {
      silhouette: "elemental-shard",
      chamberScale: 0.265,
      corridorScale: 0.054,
      chamberScaleRange: [0.8, 1.15],
      corridorWidthRange: [0.7, 1.12],
      aspectRange: [1.08, 2.0],
      rotationMode: "free",
      rotationJitter: 0,
      contourPowers: [1, 2, 4],
      warp: 0.14,
      lobeChance: 0.42,
      lobeScaleRange: [0.38, 0.58],
      hubDegree: 4,
      incidentalHubChance: 0.04,
      hubBoost: 0.3,
    };
    default:
      return {
        silhouette: "custom-pocket",
        chamberScale: 0.28,
        corridorScale: 0.06,
        chamberScaleRange: [0.86, 1.1],
        corridorWidthRange: [0.76, 1.12],
        aspectRange: [1.04, 1.65],
        rotationMode: "free",
        rotationJitter: 0,
        contourPowers: [2, 2, 4],
        warp: 0.09,
        lobeChance: 0.34,
        lobeScaleRange: [0.38, 0.54],
        hubDegree: 4,
        incidentalHubChance: 0.035,
        hubBoost: 0.28,
      };
  }
}

function createChamberPrimitive(
  plane: Plane,
  province: Province,
  owner: number,
  degree: number,
  localSpacing: number,
  spacing: number,
  pixelFloor: number,
  profile: SparseShapeProfile,
  styxFlowAngle?: number,
): ProvinceChamberPrimitive {
  const key = `${planeGenerationKey(plane)}:${plane.kind}:${province.id}:${province.index}`;
  const scaleRoll = deterministicUnit(`${key}:scale`);
  const aspectRoll = deterministicUnit(`${key}:aspect`);
  const hubRoll = deterministicUnit(`${key}:hub`);
  const hub = degree >= profile.hubDegree || hubRoll < profile.incidentalHubChance;
  const floodedCave = isCaveFamilyKind(plane.kind) && isWaterProvince(province);
  const styxWater = plane.kind === "underworld" && isWaterProvince(province);
  let chamberScale = interpolate(profile.chamberScaleRange[0], profile.chamberScaleRange[1], scaleRoll);
  if (province.small) chamberScale *= 0.82;
  if (province.large) chamberScale *= 1.18;
  if (hub) chamberScale *= 1 + profile.hubBoost * (0.78 + hubRoll * 0.22);
  if (floodedCave) chamberScale *= 1.12;
  if (styxWater) chamberScale *= 1.14;
  const localityScale = Math.sqrt(clampNumber(localSpacing / Math.max(EPSILON, spacing), 0.72, 1.35));
  const baseRadius = Math.max(pixelFloor, spacing * profile.chamberScale * chamberScale * localityScale);
  let aspect = interpolate(profile.aspectRange[0], profile.aspectRange[1], aspectRoll);
  if (floodedCave) aspect = 1 + (aspect - 1) * 0.68;
  if (styxWater) aspect = interpolate(1.9, 2.7, aspectRoll);
  const aspectRoot = Math.sqrt(aspect);
  let radiusX = baseRadius * aspectRoot;
  let radiusY = baseRadius / aspectRoot;
  const rotation = chamberRotation(profile, key, styxWater ? styxFlowAngle : undefined);
  const rotationCos = Math.cos(rotation);
  const rotationSin = Math.sin(rotation);
  const contourPower = floodedCave || styxWater
    ? 2
    : (profile.contourPowers[Math.abs(province.index) % profile.contourPowers.length] ?? 2);
  const organicPower = isOrganicUndergroundKind(plane.kind) && !styxWater
    ? contourPower === 1 ? interpolate(1.6, 1.95, deterministicUnit(`${key}:organic-power`))
      : contourPower === 4 ? interpolate(2.45, 3.15, deterministicUnit(`${key}:organic-power`))
        : interpolate(1.9, 2.3, deterministicUnit(`${key}:organic-power`))
    : undefined;
  const outlineWaves = organicPower === undefined ? undefined : chamberOutlineWaves(key, floodedCave);
  const warpScale = floodedCave ? 0.48 : styxWater ? 0.3 : 1;
  const warpX = (deterministicUnit(`${key}:warp-x`) * 2 - 1) * profile.warp * warpScale;
  const warpY = (deterministicUnit(`${key}:warp-y`) * 2 - 1) * profile.warp * warpScale;
  const lobeChanceScale = styxWater ? 0 : floodedCave ? 0.35 : 1;
  const hasLobe = deterministicUnit(`${key}:lobe`) < profile.lobeChance * lobeChanceScale;
  const lobeAngle = deterministicUnit(`${key}:lobe-angle`) * Math.PI * 2;
  const lobeDistance = hasLobe ? interpolate(0.46, 0.58, deterministicUnit(`${key}:lobe-distance`)) : 0;
  const lobeX = Math.cos(lobeAngle) * lobeDistance;
  const lobeY = Math.sin(lobeAngle) * lobeDistance;
  const lobeScale = hasLobe
    ? interpolate(profile.lobeScaleRange[0], profile.lobeScaleRange[1], deterministicUnit(`${key}:lobe-scale`))
    : 0;
  const contourLimit = 1 + Math.abs(warpX) + Math.abs(warpY)
    + (outlineWaves?.reduce((sum, wave) => sum + Math.abs(wave), 0) ?? 0);
  const contourOuterFactor = organicPower !== undefined
    ? Math.pow(contourLimit, 1 / organicPower) * (organicPower > 2 ? Math.pow(2, 0.5 - 1 / organicPower) : 1)
    : contourPower === 1
    ? contourLimit
    : contourPower === 2
      ? Math.sqrt(contourLimit)
      : Math.pow(2, 0.25) * Math.pow(contourLimit, 0.25);
  const outerFactor = Math.max(
    contourOuterFactor,
    lobeScale > 0 ? lobeDistance + lobeScale : 1,
  );
  const safeOuterRadius = Math.max(pixelFloor * 1.25, localSpacing * 0.43);
  const rawOuterRadius = Math.max(radiusX, radiusY) * outerFactor;
  if (rawOuterRadius > safeOuterRadius) {
    const shrink = safeOuterRadius / rawOuterRadius;
    radiusX *= shrink;
    radiusY *= shrink;
  }
  radiusX = Math.max(pixelFloor * 0.82, radiusX);
  radiusY = Math.max(pixelFloor * 0.82, radiusY);
  return {
    kind: "chamber",
    owner,
    center: { x: province.x, y: province.y },
    radius: Math.max(radiusX, radiusY) * outerFactor,
    radiusX,
    radiusY,
    rotation,
    rotationCos,
    rotationSin,
    contourPower,
    ...(organicPower !== undefined ? { organicPower, outlineWaves } : {}),
    warpX,
    warpY,
    lobeX,
    lobeY,
    lobeScale,
    hub,
    silhouette: styxWater ? "underworld-styx" : profile.silhouette,
  };
}

function chamberRotation(profile: SparseShapeProfile, key: string, preferredAxis?: number): number {
  const roll = deterministicUnit(`${key}:rotation`);
  if (preferredAxis !== undefined) return preferredAxis + (roll * 2 - 1) * 0.08;
  if (profile.rotationMode === "horizontal") return (roll * 2 - 1) * profile.rotationJitter;
  if (profile.rotationMode === "orthogonal") {
    const axis = deterministicUnit(`${key}:axis`) < 0.5 ? 0 : Math.PI / 2;
    return axis + (roll * 2 - 1) * profile.rotationJitter;
  }
  return roll * Math.PI * 2;
}

function pointInsideChamber(dx: number, dy: number, chamber: ProvinceChamberPrimitive): boolean {
  if (chamber.organicPower !== undefined && dx * dx + dy * dy > chamber.radius * chamber.radius + EPSILON) return false;
  const localX = (dx * chamber.rotationCos + dy * chamber.rotationSin) / chamber.radiusX;
  const localY = (-dx * chamber.rotationSin + dy * chamber.rotationCos) / chamber.radiusY;
  const contourBias = chamber.warpX * localX / (1 + Math.abs(localX))
    + chamber.warpY * localY / (1 + Math.abs(localY));
  const measure = chamber.organicPower === undefined
    ? contourMeasure(localX, localY, chamber.contourPower)
    : Math.pow(Math.abs(localX), chamber.organicPower) + Math.pow(Math.abs(localY), chamber.organicPower);
  const wave = chamber.outlineWaves ? angularContourWave(localX, localY, chamber.outlineWaves) : 0;
  if (measure <= 1 + contourBias + wave + EPSILON) return true;
  if (chamber.lobeScale <= 0) return false;
  const lobeX = (localX - chamber.lobeX) / chamber.lobeScale;
  const lobeY = (localY - chamber.lobeY) / chamber.lobeScale;
  return lobeX * lobeX + lobeY * lobeY <= 1 + EPSILON;
}

function chamberOutlineWaves(key: string, flooded: boolean): readonly [number, number, number, number] {
  const phase = deterministicUnit(`${key}:outline-phase`) * Math.PI * 2;
  const secondary = deterministicUnit(`${key}:outline-secondary`) * Math.PI * 2;
  const amplitude = interpolate(0.15, 0.22, deterministicUnit(`${key}:outline-amplitude`)) * (flooded ? 0.55 : 1);
  return [Math.cos(phase) * amplitude, Math.sin(phase) * amplitude,
    Math.cos(secondary) * amplitude * 0.36, Math.sin(secondary) * amplitude * 0.36];
}

/** Polynomial angular harmonics avoid expensive trigonometry in every ownership sample. */
function angularContourWave(x: number, y: number, waves: readonly [number, number, number, number]): number {
  const length = Math.hypot(x, y);
  if (length <= EPSILON) return 0;
  const ux = x / length, uy = y / length, x2 = ux * ux, y2 = uy * uy;
  return waves[0] * ux * (4 * x2 - 3) + waves[1] * uy * (3 - 4 * y2)
    + waves[2] * ux * (16 * x2 * x2 - 20 * x2 + 5)
    + waves[3] * uy * (16 * y2 * y2 - 20 * y2 + 5);
}

function contourMeasure(x: number, y: number, power: 1 | 2 | 4): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (power === 1) return ax + ay;
  const x2 = ax * ax;
  const y2 = ay * ay;
  return power === 2 ? x2 + y2 : x2 * x2 + y2 * y2;
}

function nearestProvinceSpacings(plane: Plane, metricAspect: number): number[] {
  if (plane.provinces.length < 2) return plane.provinces.map(() => 0.32);
  const nearest = new Array<number>(plane.provinces.length).fill(Infinity);
  for (let left = 0; left < plane.provinces.length; left += 1) {
    for (let right = left + 1; right < plane.provinces.length; right += 1) {
      const distance = Math.sqrt(metricDistanceSquared(
        plane.provinces[left]!.x,
        plane.provinces[left]!.y,
        plane.provinces[right]!.x,
        plane.provinces[right]!.y,
        plane,
        metricAspect,
      ));
      nearest[left] = Math.min(nearest[left]!, distance);
      nearest[right] = Math.min(nearest[right]!, distance);
    }
  }
  return nearest.map((distance) => Number.isFinite(distance) && distance > EPSILON ? distance : 0.32);
}

function medianSpacing(values: readonly number[]): number {
  if (!values.length) return 0.32;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : ((sorted[middle - 1] ?? sorted[middle] ?? 0.32) + (sorted[middle] ?? 0.32)) / 2;
}

function underworldWaterFlowAngles(
  plane: Plane,
  pairs: readonly TopologyPair[],
  metricAspect: number,
  provinceById: ReadonlyMap<string, { province: Province; index: number }>,
): Map<string, number> {
  const axialSums = new Map<string, { x: number; y: number }>();
  for (const pair of pairs) {
    const a = provinceById.get(pair.a)?.province;
    const b = provinceById.get(pair.b)?.province;
    if (!a || !b || !isWaterProvince(a) || !isWaterProvince(b)) continue;
    const to = shortestPeriodicEndpoint(a, b, plane);
    const angle = Math.atan2(to.y - a.y, (to.x - a.x) * metricAspect);
    const x = Math.cos(angle * 2);
    const y = Math.sin(angle * 2);
    for (const province of [a, b]) {
      const current = axialSums.get(province.id) ?? { x: 0, y: 0 };
      current.x += x;
      current.y += y;
      axialSums.set(province.id, current);
    }
  }
  return new Map([...axialSums].map(([provinceId, sum]) => [
    provinceId,
    Math.abs(sum.x) + Math.abs(sum.y) <= EPSILON ? 0 : Math.atan2(sum.y, sum.x) / 2,
  ]));
}

function shortestPeriodicEndpoint(a: Pick<Province, "x" | "y">, b: Pick<Province, "x" | "y">, plane: Pick<Plane, "wrapX" | "wrapY">): Point {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (plane.wrapX) {
    if (dx > 0.5) dx -= 1;
    else if (dx < -0.5) dx += 1;
  }
  if (plane.wrapY) {
    if (dy > 0.5) dy -= 1;
    else if (dy < -0.5) dy += 1;
  }
  return { x: a.x + dx, y: a.y + dy };
}

/**
 * Add a restrained meander and smooth mouth flare only where negative-space
 * clearance permits it. Original straight envelopes are used for every check,
 * so the result does not depend on primitive order or create a new near-touch
 * with an unrelated room/passage. Existing authored crossings remain unchanged.
 */
function shapeUndergroundCorridors(
  primitives: ProvinceOwnershipPrimitive[],
  plane: Plane,
  spacing: number,
  pixelFloor: number,
  aspect: number,
): void {
  const bridgeKeys = new Set(plane.edges.filter(isExplicitBridge).map(edge => connectionKey(edge.a, edge.b)));
  const offsetsX = plane.wrapX ? [-1, 0, 1] : [0];
  const offsetsY = plane.wrapY ? [-1, 0, 1] : [0];
  const nativeGap = 2.5 * Math.max(aspect / Math.max(1, plane.width), 1 / Math.max(1, plane.height));
  for (const corridor of primitives) {
    if (corridor.kind !== "corridor") continue;
    // Never introduce a dry detour around the Styx or bend an explicit crossing.
    if (plane.kind === "underworld" && (bridgeKeys.has(corridor.key)
      || corridor.owners.some(owner => isWaterProvince(plane.provinces[owner]!)))) continue;
    const ax = corridor.from.x * aspect, ay = corridor.from.y;
    const bx = corridor.to.x * aspect, by = corridor.to.y;
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    if (length <= pixelFloor * 4) continue;
    const seed = `${planeGenerationKey(plane)}:${plane.kind}:${corridor.key}:organic-corridor`;
    const bend = Math.min(spacing * 0.06, length * 0.075, corridor.halfWidth * 1.05);
    const flare = corridor.halfWidth * 0.72;
    const desiredGrowth = bend * 1.15 + flare;
    let growth = desiredGrowth;
    // The Styx plane keeps an 8-connected native-pixel gap after both
    // neighbouring passages have spent their share of it.
    const gap = plane.kind === "underworld" ? nativeGap : pixelFloor * 0.25;
    for (const other of primitives) {
      if (other === corridor) continue;
      const shared = other.kind === "chamber" || other.kind === "boundary"
        ? corridor.owners.filter(owner => owner === other.owner)
        : other.owners.filter(owner => corridor.owners.includes(owner));
      // Elsewhere any shared owner exempts the pair. On the Underworld two
      // passages from one chamber can still meet as an unlinked pair through
      // their far halves, so only those halves are kept apart.
      const sibling = plane.kind === "underworld" && other.kind === "corridor" && shared.length === 1;
      if (shared.length && !sibling) continue;
      const own = sibling ? farHalf(corridor, shared[0]!, aspect) : { ax, ay, bx, by };
      const far = sibling && other.kind === "corridor" ? farHalf(other, shared[0]!, aspect) : undefined;
      for (const oy of offsetsY) for (const ox of offsetsX) {
        const separation = other.kind === "chamber"
          ? Math.sqrt(pointSegmentDistanceSquared((other.center.x + ox) * aspect, other.center.y + oy, ax, ay, bx, by)) - other.radius
          : far ? Math.sqrt(segmentDistanceSquared(own.ax, own.ay, own.bx, own.by,
            far.ax + ox * aspect, far.ay + oy, far.bx + ox * aspect, far.by + oy)) - other.halfWidth
          : Math.sqrt(segmentDistanceSquared(ax, ay, bx, by,
            (other.from.x + ox) * aspect, other.from.y + oy,
            (other.to.x + ox) * aspect, other.to.y + oy)) - other.halfWidth;
        // Each of two unrelated passages may spend at most 40% of the gap.
        growth = Math.min(growth, Math.max(0, separation - corridor.halfWidth - gap) * 0.4);
      }
      if (growth <= EPSILON) break;
    }
    if (growth <= EPSILON || desiredGrowth <= EPSILON) continue;
    const strength = growth / desiredGrowth;
    const direction = deterministicUnit(`${seed}:side`) < 0.5 ? -1 : 1;
    const secondary = (deterministicUnit(`${seed}:secondary`) * 2 - 1) * 0.15;
    const widthPhase = deterministicUnit(`${seed}:width`) * Math.PI * 2;
    const path: Point[] = [], halfWidths: number[] = [];
    for (let step = 0; step <= 8; step++) {
      const t = step / 8;
      // Explicit zeros retain the original endpoints and owner bisector, including wrap seams.
      const wave = step === 0 || step === 4 || step === 8 ? 0
        : Math.sin(Math.PI * 2 * t) + secondary * Math.sin(Math.PI * 4 * t);
      const displacement = wave * bend * strength * direction;
      path.push(step === 0 ? { ...corridor.from } : step === 8 ? { ...corridor.to }
        : step === 4 ? { x: (corridor.from.x + corridor.to.x) / 2, y: (corridor.from.y + corridor.to.y) / 2 }
          : { x: corridor.from.x + (corridor.to.x - corridor.from.x) * t - dy / length * displacement / aspect,
            y: corridor.from.y + (corridor.to.y - corridor.from.y) * t + dx / length * displacement });
      const mouth = 1 - smoothStep(Math.min(t, 1 - t) / 0.44);
      const variation = Math.sin(Math.PI * 2 * t + widthPhase) * Math.sin(Math.PI * t) ** 2 * 0.075;
      halfWidths.push(corridor.halfWidth + strength * (flare * mouth + corridor.halfWidth * variation));
    }
    corridor.path = path;
    corridor.halfWidths = halfWidths;
  }
}

/** One passage's half-width; shared by the ownership model and the passage planner. */
function sparseCorridorHalfWidth(
  plane: Plane,
  profile: SparseShapeProfile,
  spacing: number,
  pixelFloor: number,
  key: string,
  aWater: boolean,
  bWater: boolean,
): number {
  const widthRoll = deterministicUnit(`${planeGenerationKey(plane)}:${plane.kind}:${key}:corridor-width`);
  const floodedCaveConnector = isCaveFamilyKind(plane.kind) && (aWater || bWater);
  const styxConnector = plane.kind === "underworld" && aWater && bWater;
  const widthScale = interpolate(profile.corridorWidthRange[0], profile.corridorWidthRange[1], widthRoll)
    * (floodedCaveConnector ? 1.12 : 1)
    * (styxConnector ? 1.34 : 1);
  return Math.max(pixelFloor * 0.72, spacing * profile.corridorScale * widthScale);
}

/** The half of a straight corridor envelope owned by the endpoint that is not `shared`. */
function farHalf(corridor: ProvinceCorridorPrimitive, shared: number, aspect: number): MetricSegment {
  const ax = corridor.from.x * aspect, ay = corridor.from.y, bx = corridor.to.x * aspect, by = corridor.to.y;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  return corridor.owners[0] === shared ? { ax: mx, ay: my, bx, by } : { ax, ay, bx: mx, by: my };
}

function isExplicitBridge(edge: Plane["edges"][number]): boolean {
  return edge.kind === "bridge" || (edge.kind === "custom" && ((edge.special ?? 0) & 16) !== 0);
}

function smoothStep(value: number): number {
  const t = clampNumber(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function segmentDistanceSquared(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const ux = bx - ax, uy = by - ay, vx = dx - cx, vy = dy - cy;
  const determinant = ux * vy - uy * vx;
  if (Math.abs(determinant) > EPSILON) {
    const wx = cx - ax, wy = cy - ay;
    const t = (wx * vy - wy * vx) / determinant, u = (wx * uy - wy * ux) / determinant;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(pointSegmentDistanceSquared(ax, ay, cx, cy, dx, dy), pointSegmentDistanceSquared(bx, by, cx, cy, dx, dy),
    pointSegmentDistanceSquared(cx, cy, ax, ay, bx, by), pointSegmentDistanceSquared(dx, dy, ax, ay, bx, by));
}

function pointInsideCorridorSegment(x: number, y: number, corridor: ProvinceCorridorPrimitive, segment: number, aspect: number): boolean {
  const a = corridor.path![segment]!, b = corridor.path![segment + 1]!;
  const dx = (b.x - a.x) * aspect, dy = b.y - a.y;
  const px = (x - a.x) * aspect, py = y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= EPSILON ? 0 : clampNumber((px * dx + py * dy) / lengthSquared, 0, 1);
  const width = interpolate(corridor.halfWidths![segment]!, corridor.halfWidths![segment + 1]!, t);
  return (px - dx * t) ** 2 + (py - dy * t) ** 2 <= width * width + EPSILON;
}

function buildSparsePrimitiveCopies(
  primitives: readonly ProvinceOwnershipPrimitive[],
  plane: Pick<Plane, "wrapX" | "wrapY">,
  metricAspect: number,
): SparsePrimitiveCopy[] {
  const offsetsX = plane.wrapX ? [-1, 0, 1] : [0];
  const offsetsY = plane.wrapY ? [-1, 0, 1] : [0];
  const copies: SparsePrimitiveCopy[] = [];
  primitives.forEach((primitive, primitiveIndex) => {
    if (primitive.kind === "corridor" && primitive.path) {
      for (let segmentIndex = 0; segmentIndex < primitive.path.length - 1; segmentIndex++) {
        const from = primitive.path[segmentIndex]!, to = primitive.path[segmentIndex + 1]!;
        const radius = Math.max(primitive.halfWidths![segmentIndex]!, primitive.halfWidths![segmentIndex + 1]!);
        for (const offsetY of offsetsY) for (const offsetX of offsetsX) {
          const minX = Math.min(from.x, to.x) + offsetX - radius / metricAspect;
          const maxX = Math.max(from.x, to.x) + offsetX + radius / metricAspect;
          const minY = Math.min(from.y, to.y) + offsetY - radius;
          const maxY = Math.max(from.y, to.y) + offsetY + radius;
          if (maxX < 0 || minX > 1 || maxY < 0 || minY > 1) continue;
          copies.push({ primitiveIndex, segmentIndex, offsetX, offsetY, minX, maxX, minY, maxY });
        }
      }
      return;
    }
    for (const offsetY of offsetsY) {
      for (const offsetX of offsetsX) {
        const radiusX = (primitive.kind === "chamber" ? primitive.radius : primitive.halfWidth) / metricAspect;
        const radiusY = primitive.kind === "chamber" ? primitive.radius : primitive.halfWidth;
        const minX = (primitive.kind === "chamber" ? primitive.center.x : Math.min(primitive.from.x, primitive.to.x)) + offsetX - radiusX;
        const maxX = (primitive.kind === "chamber" ? primitive.center.x : Math.max(primitive.from.x, primitive.to.x)) + offsetX + radiusX;
        const minY = (primitive.kind === "chamber" ? primitive.center.y : Math.min(primitive.from.y, primitive.to.y)) + offsetY - radiusY;
        const maxY = (primitive.kind === "chamber" ? primitive.center.y : Math.max(primitive.from.y, primitive.to.y)) + offsetY + radiusY;
        if (maxX < 0 || minX > 1 || maxY < 0 || minY > 1) continue;
        copies.push({ primitiveIndex, offsetX, offsetY, minX, maxX, minY, maxY });
      }
    }
  });
  return copies;
}

/** Copy indexes per bucket, each list in ascending copy order. */
function bucketSparsePrimitiveCopies(copies: readonly SparsePrimitiveCopy[], columns: number, rows: number): Int32Array[] {
  const buckets = Array.from({ length: columns * rows }, () => [] as number[]);
  copies.forEach((copy, index) => {
    const left = Math.max(0, Math.min(columns - 1, Math.floor(copy.minX * columns)));
    const right = Math.max(0, Math.min(columns - 1, Math.floor(Math.min(1 - Number.EPSILON, copy.maxX) * columns)));
    const top = Math.max(0, Math.min(rows - 1, Math.floor(copy.minY * rows)));
    const bottom = Math.max(0, Math.min(rows - 1, Math.floor(Math.min(1 - Number.EPSILON, copy.maxY) * rows)));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) buckets[y * columns + x]!.push(index);
    }
  });
  return buckets.map((bucket) => Int32Array.from(bucket));
}

/**
 * Metric slack added around each copy's bounding box for the ownerAt
 * early-out. Every sparse shape test accepts a point at most
 * sqrt(r² + EPSILON) <= r + sqrt(EPSILON) ~ r + 3.2e-5 from its core (chamber
 * contours are bounded by their conservative outer radius), so 1e-4 keeps the
 * skip exact with ample floating-point margin; it is under a quarter of a
 * native pixel.
 */
const SPARSE_COPY_BOUND_SLACK = 1e-4;

/** Fine lookup cells per coarse sparse bucket axis; a power of two. */
const SPARSE_BUCKET_REFINEMENT = 4;

interface SparseBucketLookup {
  fineColumns: number;
  fineRows: number;
  /** Flat per-fine-cell copy lists: entries[offsets[cell] .. offsets[cell + 1]). */
  offsets: Int32Array;
  entries: Int32Array;
  longest: number;
}

/**
 * PERF: split each coarse bucket into 4x4 finer lookup cells. A fine cell
 * keeps, in the same ascending order, every copy of its enclosing coarse
 * bucket whose padded bounds reach the cell (with rounding slack). The copies
 * it drops are exactly those ownerAt's bounding-box test would skip for every
 * point in the cell, so owners and their insertion order are unchanged.
 */
function refineSparseBuckets(
  buckets: readonly Int32Array[],
  copies: PackedSparsePrimitiveCopies,
  columns: number,
  rows: number,
): SparseBucketLookup {
  const fineColumns = columns * SPARSE_BUCKET_REFINEMENT, fineRows = rows * SPARSE_BUCKET_REFINEMENT;
  const slack = 1e-12;
  const offsets = new Int32Array(fineColumns * fineRows + 1);
  const entries: number[] = [];
  let longest = 0;
  for (let row = 0; row < fineRows; row += 1) {
    const top = row / fineRows - slack, bottom = (row + 1) / fineRows + slack;
    const parentRow = Math.floor(row / SPARSE_BUCKET_REFINEMENT) * columns;
    for (let column = 0; column < fineColumns; column += 1) {
      const left = column / fineColumns - slack, right = (column + 1) / fineColumns + slack;
      const start = entries.length;
      for (const copy of buckets[parentRow + Math.floor(column / SPARSE_BUCKET_REFINEMENT)]!) {
        if (copies.maxX[copy]! < left || copies.minX[copy]! > right || copies.maxY[copy]! < top || copies.minY[copy]! > bottom) continue;
        entries.push(copy);
      }
      longest = Math.max(longest, entries.length - start);
      offsets[row * fineColumns + column + 1] = entries.length;
    }
  }
  return { fineColumns, fineRows, offsets, entries: Int32Array.from(entries), longest };
}

interface PackedSparsePrimitiveCopies {
  primitiveIndex: Int32Array;
  /** Curved-corridor segment index, or -1. */
  segmentIndex: Int32Array;
  offsetX: Float64Array;
  offsetY: Float64Array;
  /** Padded normalized bounds; a point outside cannot be inside the copy. */
  minX: Float64Array;
  maxX: Float64Array;
  minY: Float64Array;
  maxY: Float64Array;
}

function packSparsePrimitiveCopies(copies: readonly SparsePrimitiveCopy[], metricAspect: number): PackedSparsePrimitiveCopies {
  const count = copies.length;
  const packed: PackedSparsePrimitiveCopies = {
    primitiveIndex: new Int32Array(count),
    segmentIndex: new Int32Array(count),
    offsetX: new Float64Array(count),
    offsetY: new Float64Array(count),
    minX: new Float64Array(count),
    maxX: new Float64Array(count),
    minY: new Float64Array(count),
    maxY: new Float64Array(count),
  };
  const slackX = SPARSE_COPY_BOUND_SLACK / metricAspect;
  copies.forEach((copy, index) => {
    packed.primitiveIndex[index] = copy.primitiveIndex;
    packed.segmentIndex[index] = copy.segmentIndex ?? -1;
    packed.offsetX[index] = copy.offsetX;
    packed.offsetY[index] = copy.offsetY;
    packed.minX[index] = copy.minX - slackX;
    packed.maxX[index] = copy.maxX + slackX;
    packed.minY[index] = copy.minY - SPARSE_COPY_BOUND_SLACK;
    packed.maxY[index] = copy.maxY + SPARSE_COPY_BOUND_SLACK;
  });
  return packed;
}

function pointSegmentDistanceSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return (px - qx) ** 2 + (py - qy) ** 2;
}

function nearestMetricOwner(
  x: number,
  y: number,
  candidates: Int32Array,
  count: number,
  plane: Plane,
  metricAspect: number,
): number {
  let best = count ? candidates[0]! : -1;
  let bestDistance = Infinity;
  for (let slot = 0; slot < count; slot += 1) {
    const index = candidates[slot]!;
    const province = plane.provinces[index];
    if (!province) continue;
    const distance = metricDistanceSquared(x, y, province.x, province.y, plane, metricAspect);
    if (distance < bestDistance - EPSILON
      || (Math.abs(distance - bestDistance) <= EPSILON && (best < 0 || province.index < plane.provinces[best]!.index))) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function metricDistanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  plane: Pick<Plane, "wrapX" | "wrapY">,
  metricAspect: number,
): number {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (plane.wrapX) dx = Math.min(dx, 1 - dx);
  if (plane.wrapY) dy = Math.min(dy, 1 - dy);
  return (dx * metricAspect) ** 2 + dy ** 2;
}

function normalizeCoordinate(value: number, wrap: boolean): number {
  if (wrap) return ((value % 1) + 1) % 1;
  return Math.max(0, Math.min(1 - Number.EPSILON, value));
}

function outerEdgeSide(value: number, inset: number): "low" | "high" | undefined {
  if (value < inset) return "low";
  if (value >= 1 - inset) return "high";
  return undefined;
}

function sparseSharedBorders(
  plane: Plane,
  ownership: ProvinceOwnershipModel,
  pairKeys: ReadonlySet<string>,
): Map<string, BorderSegment[]> {
  const borders = new Map<string, BorderSegment[]>();
  const segmentKeys = new Map<string, Set<string>>();
  for (const primitive of ownership.primitives) {
    if (primitive.kind !== "corridor" || !pairKeys.has(primitive.key)) continue;
    const dx = (primitive.to.x - primitive.from.x) * ownership.metricAspect;
    const dy = primitive.to.y - primitive.from.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) continue;
    const midpoint = { x: (primitive.from.x + primitive.to.x) / 2, y: (primitive.from.y + primitive.to.y) / 2 };
    const normal = { x: (-dy / length) / ownership.metricAspect, y: dx / length };
    const halfExtent = (direction: number): number => {
      if (!primitive.path) return primitive.halfWidth;
      let low = 0, high = Math.max(...primitive.halfWidths!) * 3;
      // Ownership between these endpoint owners still changes on their metric
      // bisector. Trace its intersection with the curved/tapered tube, rather
      // than drawing a straight-capsule border outside the new passage.
      for (let iteration = 0; iteration < 14; iteration++) {
        const distance = (low + high) / 2;
        const x = midpoint.x + normal.x * distance * direction;
        const y = midpoint.y + normal.y * distance * direction;
        const inside = primitive.path.slice(1).some((_, segment) => pointInsideCorridorSegment(x, y, primitive, segment, ownership.metricAspect));
        if (inside) low = distance; else high = distance;
      }
      return low;
    };
    const left = halfExtent(-1), right = halfExtent(1);
    const offset = {
      x: (-dy / length) * primitive.halfWidth / ownership.metricAspect,
      y: (dx / length) * primitive.halfWidth,
    };
    const from = primitive.path ? { x: midpoint.x - normal.x * left, y: midpoint.y - normal.y * left }
      : { x: midpoint.x - offset.x, y: midpoint.y - offset.y };
    const to = primitive.path ? { x: midpoint.x + normal.x * right, y: midpoint.y + normal.y * right }
      : { x: midpoint.x + offset.x, y: midpoint.y + offset.y };
    for (const offsetY of plane.wrapY ? [-1, 0, 1] : [0]) {
      for (const offsetX of plane.wrapX ? [-1, 0, 1] : [0]) {
        const segment = clipSegmentToUnitSquare(
          { x: from.x + offsetX, y: from.y + offsetY },
          { x: to.x + offsetX, y: to.y + offsetY },
        );
        if (segment) appendUniqueSegment(borders, segmentKeys, primitive.key, segment);
      }
    }
  }
  return borders;
}

function initialPeriodicFrame(province: VoronoiSite, plane: Pick<Plane, "wrapX" | "wrapY">): TaggedPoint[] {
  const left = plane.wrapX ? province.x - 0.5 : 0;
  const right = plane.wrapX ? province.x + 0.5 : 1;
  const top = plane.wrapY ? province.y - 0.5 : 0;
  const bottom = plane.wrapY ? province.y + 0.5 : 1;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function clipTaggedPolygon(
  polygon: TaggedPoint[],
  a: number,
  b: number,
  c: number,
  boundaryId: string,
): TaggedPoint[] {
  const result: TaggedPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    const currentInside = a * current.x + b * current.y <= c + EPSILON;
    const previousInside = a * previous.x + b * previous.y <= c + EPSILON;
    if (previousInside && currentInside) {
      result.push({ ...current });
      continue;
    }
    if (previousInside !== currentInside) {
      const intersection = lineIntersection(previous, current, a, b, c);
      if (intersection) {
        result.push({
          ...intersection,
          incoming: previousInside ? current.incoming : boundaryId,
        });
      }
    }
    if (!previousInside && currentInside) result.push({ ...current });
  }
  return deduplicateVertices(result);
}

function lineIntersection(from: Point, to: Point, a: number, b: number, c: number): Point | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const denominator = a * dx + b * dy;
  if (Math.abs(denominator) <= 1e-14) return undefined;
  const t = (c - a * from.x - b * from.y) / denominator;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

function clipToUnitSquare(polygon: Point[]): Point[] {
  let result = polygon;
  result = clipPolygon(result, 1, 0, 1);
  result = clipPolygon(result, -1, 0, 0);
  result = clipPolygon(result, 0, 1, 1);
  result = clipPolygon(result, 0, -1, 0);
  return deduplicateVertices(result);
}

function clipPolygon<T extends Point>(polygon: T[], a: number, b: number, c: number): T[] {
  const result: T[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    const currentInside = a * current.x + b * current.y <= c + EPSILON;
    const previousInside = a * previous.x + b * previous.y <= c + EPSILON;
    if (currentInside !== previousInside) {
      const intersection = lineIntersection(previous, current, a, b, c);
      if (intersection) result.push(intersection as T);
    }
    if (currentInside) result.push(current);
  }
  return result;
}

function clipSegmentToUnitSquare(from: Point, to: Point): BorderSegment | undefined {
  let start = 0;
  let end = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const tests: Array<[number, number]> = [
    [-dx, from.x],
    [dx, 1 - from.x],
    [-dy, from.y],
    [dy, 1 - from.y],
  ];
  for (const [p, q] of tests) {
    if (Math.abs(p) <= 1e-14) {
      if (q < -EPSILON) return undefined;
      continue;
    }
    const ratio = q / p;
    if (p < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end + EPSILON) return undefined;
  }
  const segment = {
    from: { x: from.x + dx * start, y: from.y + dy * start },
    to: { x: from.x + dx * end, y: from.y + dy * end },
  };
  return Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > EPSILON
    ? segment
    : undefined;
}

function appendUniqueSegment(
  borders: Map<string, BorderSegment[]>,
  keys: Map<string, Set<string>>,
  pairKey: string,
  segment: BorderSegment,
) {
  const segmentKey = canonicalSegmentKey(segment);
  const known = keys.get(pairKey) ?? new Set<string>();
  if (known.has(segmentKey)) return;
  known.add(segmentKey);
  keys.set(pairKey, known);
  const segments = borders.get(pairKey) ?? [];
  segments.push(segment);
  borders.set(pairKey, segments);
}

function canonicalSegmentKey(segment: BorderSegment): string {
  const first = `${rounded(segment.from.x)},${rounded(segment.from.y)}`;
  const second = `${rounded(segment.to.x)},${rounded(segment.to.y)}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function rounded(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function deduplicateVertices<T extends Point>(points: T[]): T[] {
  const result: T[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > EPSILON) result.push(point);
  }
  if (result.length > 1) {
    const first = result[0]!;
    const last = result.at(-1)!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON) result.pop();
  }
  return result;
}

function buildCandidateBuckets(plane: Plane, columns: number, rows: number): number[][] {
  if (plane.provinces.length <= 64) {
    const all = plane.provinces.map((_, index) => index);
    return Array.from({ length: columns * rows }, () => all);
  }
  const raw = Array.from({ length: columns * rows }, () => [] as number[]);
  plane.provinces.forEach((province, index) => {
    const x = Math.max(0, Math.min(columns - 1, Math.floor(province.x * columns)));
    const y = Math.max(0, Math.min(rows - 1, Math.floor(province.y * rows)));
    raw[y * columns + x]!.push(index);
  });
  const buckets = Array.from({ length: columns * rows }, () => [] as number[]);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const found = new Set<number>();
      for (let radius = 0; radius <= 4 && found.size < 12; radius += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            let bx = x + dx;
            let by = y + dy;
            if (plane.wrapX) bx = (bx + columns) % columns;
            if (plane.wrapY) by = (by + rows) % rows;
            if (bx < 0 || bx >= columns || by < 0 || by >= rows) continue;
            for (const index of raw[by * columns + bx]!) found.add(index);
          }
        }
      }
      if (!found.size) plane.provinces.forEach((_, index) => found.add(index));
      else completeCandidateBucket(plane, raw, columns, rows, x, y, found);
      buckets[y * columns + x] = [...found];
    }
  }
  return buckets;
}

/**
 * The ring search above stops after a dozen candidates, which on clustered
 * coordinates can omit the province that is actually nearest to part of the
 * cell. Every point of the cell is at most `bound` (squared) from some found
 * candidate, so its nearest province, and any province within nearestOwner's
 * EPSILON tie of it, lies within that bound of the cell. Appending exactly
 * those provinces keeps the found candidates' order first (and with it every
 * tie-break) while making the list complete. Distances use nearestOwner's
 * unscaled, optionally periodic metric; query points lie inside the closed
 * cell because ownerAt clamps them into [0, 1] before choosing the bucket.
 */
function completeCandidateBucket(
  plane: Plane,
  raw: readonly (readonly number[])[],
  columns: number,
  rows: number,
  x: number,
  y: number,
  found: Set<number>,
): void {
  const x0 = x / columns, x1 = (x + 1) / columns;
  const y0 = y / rows, y1 = (y + 1) / rows;
  let bound = Infinity;
  for (const index of found) {
    const province = plane.provinces[index]!;
    const far = farthestAxisDistance(province.x, x0, x1, plane.wrapX) ** 2
      + farthestAxisDistance(province.y, y0, y1, plane.wrapY) ** 2;
    if (far < bound) bound = far;
  }
  const limit = bound + 4 * EPSILON;
  // A cell more than `reach` cells away along an axis is already farther than
  // the limit along that axis alone, so only this window can qualify.
  const reach = Math.sqrt(limit);
  const windowColumns = axisWindow(x, Math.floor(reach * columns) + 1, columns, plane.wrapX);
  const windowRows = axisWindow(y, Math.floor(reach * rows) + 1, rows, plane.wrapY);
  for (const by of windowRows) {
    for (const bx of windowColumns) {
      for (const index of raw[by * columns + bx]!) {
        if (found.has(index)) continue;
        const province = plane.provinces[index]!;
        const near = nearestAxisDistance(province.x, x0, x1, plane.wrapX) ** 2
          + nearestAxisDistance(province.y, y0, y1, plane.wrapY) ** 2;
        if (near <= limit) found.add(index);
      }
    }
  }
}

/** Distinct bucket indexes within `reach` of `center`, wrapping periodic axes. */
function axisWindow(center: number, reach: number, count: number, wrap: boolean): number[] {
  if (wrap && 2 * reach + 1 >= count) return Array.from({ length: count }, (_, index) => index);
  const window: number[] = [];
  for (let offset = -reach; offset <= reach; offset += 1) {
    const index = wrap ? (center + offset + count) % count : center + offset;
    if (index >= 0 && index < count) window.push(index);
  }
  return window;
}

/** Smallest nearestOwner axis distance from `value` to any point of [low, high]. */
function nearestAxisDistance(value: number, low: number, high: number, wrap: boolean): number {
  if (value >= low && value <= high) return 0;
  const near = value < low ? low - value : value - high;
  if (!wrap) return near;
  const far = Math.max(Math.abs(value - low), Math.abs(value - high));
  return Math.max(0, Math.min(near, 1 - far));
}

/** Largest nearestOwner axis distance from `value` to any point of [low, high]. */
function farthestAxisDistance(value: number, low: number, high: number, wrap: boolean): number {
  const far = Math.max(Math.abs(value - low), Math.abs(value - high));
  if (!wrap) return far;
  const near = value >= low && value <= high ? 0 : value < low ? low - value : value - high;
  if (far <= 0.5) return far;
  if (near >= 0.5) return 1 - near;
  return 0.5;
}

function nearestOwner(x: number, y: number, candidates: number[], plane: Plane): number {
  let best = candidates[0] ?? 0;
  let bestDistance = Infinity;
  for (const index of candidates) {
    const province = plane.provinces[index]!;
    let dx = Math.abs(x - province.x);
    let dy = Math.abs(y - province.y);
    if (plane.wrapX) dx = Math.min(dx, 1 - dx);
    if (plane.wrapY) dy = Math.min(dy, 1 - dy);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance - EPSILON
      || (Math.abs(distance - bestDistance) <= EPSILON && province.index < plane.provinces[best]!.index)) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function deterministicUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

function interpolate(minimum: number, maximum: number, amount: number): number {
  return minimum + (maximum - minimum) * amount;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function geometrySignature(plane: Plane): string {
  const ownership = resolvePlaneOwnershipMode(plane);
  const edgePart = ownership === "sparse"
    ? plane.edges.map((edge) => `${connectionKey(edge.a, edge.b)}${plane.kind === "underworld" && isExplicitBridge(edge) ? ":bridge" : ""}`).sort().join(",")
    : "";
  return `${ownership}${usesConnectedRegions(plane) ? ":regions" : ""}:${plane.landformStyle ?? "legacy"}:${planeGenerationKey(plane)}:${plane.kind}:${plane.width}x${plane.height}:${plane.wrapX ? 1 : 0}${plane.wrapY ? 1 : 0}:${plane.provinces
    .map((province) => `${province.id}:${province.index}:${province.x}:${province.y}:${province.small ? 1 : 0}${province.large ? 1 : 0}:${province.terrain}:${province.freshwater ? 1 : 0}:${[...(province.terrainFlags ?? [])].sort().join("+")}`)
    .join(";")}:${edgePart}:${JSON.stringify(plane.landformWater ?? null)}`;
}

function ownershipSignature(plane: Plane): string {
  return `owner:${geometrySignature(plane)}`;
}

function cacheTopology(signature: string, topology: ProvinceTopology): ProvinceTopology {
  if (topologyCache.size >= 24) topologyCache.delete(topologyCache.keys().next().value!);
  topologyCache.set(signature, topology);
  return topology;
}

function cacheOwnership(signature: string, ownership: ProvinceOwnershipModel): ProvinceOwnershipModel {
  if (ownershipCache.size >= 16) ownershipCache.delete(ownershipCache.keys().next().value!);
  ownershipCache.set(signature, ownership);
  return ownership;
}
