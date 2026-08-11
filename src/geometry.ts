import type { Plane, Province } from "./domain";

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
  ownerAt: (x: number, y: number) => number;
}

interface TaggedPoint extends Point {
  /** The province whose bisector owns the segment from the prior vertex. */
  incoming?: string;
}

const EPSILON = 1e-9;
const topologyCache = new Map<string, ProvinceTopology>();

export function connectionKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function computeVoronoiCells(plane: Plane): Cell[] {
  return computeProvinceTopology(plane).cells;
}

/**
 * Computes periodic Voronoi cells and their positive-length shared boundaries
 * from one tagged clipping pass. The same result drives generation, preview,
 * validation, repair, and special-border rendering.
 */
export function computeProvinceTopology(plane: Plane): ProvinceTopology {
  const signature = geometrySignature(plane);
  const cached = topologyCache.get(signature);
  if (cached) return cached;
  if (!plane.provinces.length) {
    return cacheTopology(signature, { cells: [], pairs: [], pairKeys: new Set(), sharedBorders: new Map() });
  }

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

  return cacheTopology(signature, { cells, pairs, pairKeys, sharedBorders });
}

function clippingCandidates(province: Province, plane: Plane): Province[] {
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
  const selected = new Map<string, Province>();
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

/** Uses the same deterministic nearest-province rule for preview topology and D6M ownership. */
export function createProvinceOwnerResolver(plane: Plane): ProvinceOwnerResolver {
  const aspect = Number.isFinite(plane.width / plane.height) && plane.height > 0
    ? Math.max(0.08, Math.min(12, plane.width / plane.height))
    : 1;
  const columns = Math.max(3, Math.ceil(Math.sqrt(Math.max(1, plane.provinces.length) * aspect)));
  const rows = Math.max(2, Math.ceil(Math.max(1, plane.provinces.length) / columns));
  const buckets = buildCandidateBuckets(plane, columns, rows);
  return {
    columns,
    rows,
    ownerAt: (x, y) => {
      const bucketX = Math.max(0, Math.min(columns - 1, Math.floor(x * columns)));
      const bucketY = Math.max(0, Math.min(rows - 1, Math.floor(y * rows)));
      return nearestOwner(x, y, buckets[bucketY * columns + bucketX]!, plane);
    },
  };
}

function initialPeriodicFrame(province: Province, plane: Pick<Plane, "wrapX" | "wrapY">): TaggedPoint[] {
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
      buckets[y * columns + x] = [...found];
    }
  }
  return buckets;
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

function geometrySignature(plane: Plane): string {
  return `${plane.wrapX ? 1 : 0}${plane.wrapY ? 1 : 0}:${plane.provinces
    .map((province) => `${province.id}:${province.index}:${province.x}:${province.y}`)
    .join(";")}`;
}

function cacheTopology(signature: string, topology: ProvinceTopology): ProvinceTopology {
  if (topologyCache.size >= 24) topologyCache.delete(topologyCache.keys().next().value!);
  topologyCache.set(signature, topology);
  return topology;
}
