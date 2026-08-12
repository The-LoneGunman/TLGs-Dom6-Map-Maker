import type { Plane, Province } from "./domain";
import type { Point, ProvinceOwnershipModel } from "./geometry";

/**
 * Asset rules are evaluated in a stable 1152px-short-axis design space. This
 * keeps a province in the same scale bucket at 2K and 4K instead of adding a
 * different number of landmarks merely because the PNG has more pixels.
 */
export const ART_REFERENCE_SHORT_AXIS = 1152;

export type ArtworkScaleBucket = "suppressed" | "micro" | "small" | "medium" | "large" | "hero";
export type ArtworkFallback = "suppress" | "micro" | "procedural";
export type ArtworkRotation = "fixed" | "quarter-turns" | "free";
export type ArtworkMirroring = "none" | "horizontal" | "both";

export interface ArtworkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Pixel-space geometry plus its resolution-independent design-space values. */
export interface ProvinceArtworkMetrics {
  source: "polygon" | "sparse";
  anchorX: number;
  anchorY: number;
  bounds: ArtworkBounds;
  areaPx2: number;
  perimeterPx: number;
  inscribedRadiusPx: number;
  shortAxisPx: number;
  aspectRatio: number;
  compactness: number;
  pixelsPerReferencePixel: number;
  areaReferencePx2: number;
  inscribedRadiusReferencePx: number;
  shortAxisReferencePx: number;
}

/**
 * A deliberately small structural contract shared by procedural marks and
 * future bitmap manifests. It assigns assets only to geometry they can fit.
 */
export interface AdaptiveArtworkProfile {
  id: string;
  minAreaReferencePx2?: number;
  maxAreaReferencePx2?: number;
  minInscribedRadiusReferencePx?: number;
  maxAspectRatio?: number;
  allowedScaleBuckets?: readonly ArtworkScaleBucket[];
  safeInsetRatio?: number;
  nominalSizeReferencePx?: number;
  sourceAspectRatio?: number;
  density?: number;
  rotation?: ArtworkRotation;
  mirroring?: ArtworkMirroring;
  fallback?: ArtworkFallback;
}

export interface ArtworkEligibility {
  disposition: "place" | "fallback" | "suppress";
  bucket: ArtworkScaleBucket;
  reasons: string[];
  fallback: ArtworkFallback;
}

export interface ArtworkPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
}

export interface PeriodicArtworkPlacement extends ArtworkPlacement {
  periodicOffsetX: -1 | 0 | 1;
  periodicOffsetY: -1 | 0 | 1;
}

export interface ArtworkPlan {
  eligibility: ArtworkEligibility;
  placements: ArtworkPlacement[];
}

export interface SeamlessTile {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  flipX: boolean;
  flipY: boolean;
}

export interface SeamlessTileLayout {
  columns: number;
  rows: number;
  tiles: SeamlessTile[];
}

const BUCKET_COUNT: Record<ArtworkScaleBucket, number> = {
  suppressed: 0,
  micro: 1,
  small: 2,
  medium: 4,
  large: 6,
  hero: 9,
};

const BUCKET_SCALE: Record<ArtworkScaleBucket, number> = {
  suppressed: 0,
  micro: 0.64,
  small: 0.8,
  medium: 1,
  large: 1.18,
  hero: 1.38,
};

/** Measure a solid province, unwrapping seam fragments around its capital. */
export function measurePolygonProvinceArtwork(
  polygons: readonly (readonly Point[])[],
  province: Pick<Province, "x" | "y">,
  plane: Pick<Plane, "wrapX" | "wrapY">,
  width: number,
  height: number,
): ProvinceArtworkMetrics {
  const scale = referenceScale(width, height);
  const unwrapped = polygons.map((polygon) => polygon.map((point) => ({
    x: unwrapCoordinate(point.x, province.x, plane.wrapX),
    y: unwrapCoordinate(point.y, province.y, plane.wrapY),
  })));
  let areaPx2 = 0;
  let perimeterPx = 0;
  let inscribedRadiusPx = Number.POSITIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const anchorX = province.x * width;
  const anchorY = province.y * height;

  unwrapped.forEach((polygon, polygonIndex) => {
    if (polygon.length < 3) return;
    areaPx2 += Math.abs(pixelPolygonArea(polygon, width, height));
    polygon.forEach((point, pointIndex) => {
      const x = point.x * width;
      const y = point.y * height;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const next = polygon[(pointIndex + 1) % polygon.length]!;
      const original = polygons[polygonIndex]![pointIndex]!;
      const originalNext = polygons[polygonIndex]![(pointIndex + 1) % polygon.length]!;
      // Unit-square clipping creates a false border where a wrapped province
      // continues on the other side. It must not make a seam cell look tiny.
      if (isArtificialWrapEdge(original, originalNext, plane.wrapX, plane.wrapY)) return;
      const nextX = next.x * width;
      const nextY = next.y * height;
      const length = Math.hypot(nextX - x, nextY - y);
      perimeterPx += length;
      inscribedRadiusPx = Math.min(
        inscribedRadiusPx,
        pointSegmentDistance(anchorX, anchorY, x, y, nextX, nextY),
      );
    });
  });

  if (!Number.isFinite(minX)) {
    minX = maxX = anchorX;
    minY = maxY = anchorY;
  }
  const bounds = createBounds(minX, minY, maxX, maxY);
  if (!Number.isFinite(inscribedRadiusPx)) inscribedRadiusPx = Math.min(bounds.width, bounds.height) / 2;
  return finalizeMetrics("polygon", anchorX, anchorY, bounds, areaPx2, perimeterPx, inscribedRadiusPx, scale);
}

/**
 * Measure the analytic chamber at a sparse province capital. Corridors may
 * add space, but never inflate asset eligibility: a decal must fit in the
 * province's own chamber before it is admitted.
 */
export function measureSparseProvinceArtwork(
  owner: number,
  province: Pick<Province, "x" | "y">,
  ownership: ProvinceOwnershipModel,
  width: number,
  height: number,
): ProvinceArtworkMetrics {
  const scale = referenceScale(width, height);
  const shortPixelAxis = Math.min(width, height);
  const chamber = ownership.primitives.find((primitive) => primitive.kind === "chamber" && primitive.owner === owner);
  const anchorX = province.x * width;
  const anchorY = province.y * height;
  if (!chamber || chamber.kind !== "chamber") {
    const estimatedRadius = Math.max(1, shortPixelAxis / Math.max(12, Math.sqrt(Math.max(1, ownership.columns * ownership.rows)) * 5));
    const bounds = createBounds(anchorX - estimatedRadius, anchorY - estimatedRadius, anchorX + estimatedRadius, anchorY + estimatedRadius);
    return finalizeMetrics(
      "sparse",
      anchorX,
      anchorY,
      bounds,
      Math.PI * estimatedRadius * estimatedRadius,
      Math.PI * estimatedRadius * 2,
      estimatedRadius,
      scale,
    );
  }

  const radiusX = Math.max(1, chamber.radiusX * shortPixelAxis);
  const radiusY = Math.max(1, chamber.radiusY * shortPixelAxis);
  const cosine = chamber.rotationCos;
  const sine = chamber.rotationSin;
  const halfWidth = Math.sqrt((radiusX * cosine) ** 2 + (radiusY * sine) ** 2);
  const halfHeight = Math.sqrt((radiusX * sine) ** 2 + (radiusY * cosine) ** 2);
  const areaFactor = chamber.contourPower === 1 ? 2 : chamber.contourPower === 4 ? 3.708 : Math.PI;
  const lobeFactor = chamber.lobeScale > 0 ? 1 + chamber.lobeScale ** 2 * 0.42 : 1;
  const area = areaFactor * radiusX * radiusY * lobeFactor;
  const h = ((radiusX - radiusY) / (radiusX + radiusY)) ** 2;
  const perimeter = Math.PI * (radiusX + radiusY) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const bounds = createBounds(anchorX - halfWidth, anchorY - halfHeight, anchorX + halfWidth, anchorY + halfHeight);
  return finalizeMetrics("sparse", anchorX, anchorY, bounds, area, perimeter, Math.min(radiusX, radiusY), scale);
}

export function classifyArtworkScale(metrics: ProvinceArtworkMetrics): ArtworkScaleBucket {
  const areaRank = thresholdRank(metrics.areaReferencePx2, [120, 650, 2_600, 9_000, 42_000]);
  const radiusRank = thresholdRank(metrics.inscribedRadiusReferencePx, [3.5, 7, 14, 27, 58]);
  const shortAxisRank = thresholdRank(metrics.shortAxisReferencePx, [8, 16, 30, 58, 120]);
  const rank = Math.min(areaRank, radiusRank, shortAxisRank);
  return (["suppressed", "micro", "small", "medium", "large", "hero"] as const)[rank]!;
}

export function assessArtworkEligibility(
  metrics: ProvinceArtworkMetrics,
  profile: AdaptiveArtworkProfile,
): ArtworkEligibility {
  const bucket = classifyArtworkScale(metrics);
  const reasons: string[] = [];
  if (bucket === "suppressed") reasons.push("province is below the minimum safe artwork footprint");
  if (metrics.areaReferencePx2 < (profile.minAreaReferencePx2 ?? 0)) reasons.push("province area is too small");
  if (metrics.areaReferencePx2 > (profile.maxAreaReferencePx2 ?? Number.POSITIVE_INFINITY)) reasons.push("province area exceeds the asset envelope");
  if (metrics.inscribedRadiusReferencePx < (profile.minInscribedRadiusReferencePx ?? 0)) reasons.push("province has insufficient edge clearance");
  if (metrics.aspectRatio > (profile.maxAspectRatio ?? Number.POSITIVE_INFINITY)) reasons.push("province is too narrow for this asset");
  if (profile.allowedScaleBuckets && !profile.allowedScaleBuckets.includes(bucket)) reasons.push(`asset has no ${bucket} scale variant`);
  const fallback = profile.fallback ?? "suppress";
  if (!reasons.length) return { disposition: "place", bucket, reasons, fallback };
  if (fallback === "suppress" || bucket === "suppressed") return { disposition: "suppress", bucket, reasons, fallback };
  return { disposition: "fallback", bucket, reasons, fallback };
}

/** Produce stable, edge-safe placements for an asset or procedural stamp. */
export function planProvinceArtwork(
  metrics: ProvinceArtworkMetrics,
  profile: AdaptiveArtworkProfile,
  seed: string,
): ArtworkPlan {
  const eligibility = assessArtworkEligibility(metrics, profile);
  if (eligibility.disposition === "suppress" || eligibility.fallback === "procedural") {
    return { eligibility, placements: [] };
  }
  const fallbackMicro = eligibility.disposition === "fallback" && eligibility.fallback === "micro";
  const bucket = fallbackMicro ? "micro" : eligibility.bucket;
  const desiredCount = fallbackMicro
    ? 1
    : Math.max(1, Math.round(BUCKET_COUNT[bucket] * clamp(profile.density ?? 1, 0.1, 2)));
  const nominalReferenceSize = (profile.nominalSizeReferencePx ?? 12) * BUCKET_SCALE[bucket];
  const aspect = clamp(profile.sourceAspectRatio ?? 1, 0.2, 5);
  let placementWidth = nominalReferenceSize * metrics.pixelsPerReferencePixel * Math.sqrt(aspect);
  let placementHeight = nominalReferenceSize * metrics.pixelsPerReferencePixel / Math.sqrt(aspect);
  const inset = clamp(profile.safeInsetRatio ?? 0.18, 0, 0.8);
  const safeRadius = metrics.inscribedRadiusPx * (1 - inset);
  const halfDiagonal = Math.hypot(placementWidth, placementHeight) / 2;
  if (halfDiagonal > safeRadius && halfDiagonal > 0) {
    const fitScale = safeRadius / halfDiagonal;
    placementWidth *= fitScale;
    placementHeight *= fitScale;
  }
  if (Math.min(placementWidth, placementHeight) < 1 || safeRadius < 1) {
    return {
      eligibility: { ...eligibility, disposition: "suppress", reasons: [...eligibility.reasons, "scaled fallback would be sub-pixel"] },
      placements: [],
    };
  }

  const fittedHalfDiagonal = Math.hypot(placementWidth, placementHeight) / 2;
  const travelRadius = Math.max(0, safeRadius - fittedHalfDiagonal);
  const seedAngle = (stableHash(`${seed}:${profile.id}:phase`) / 0xffff_ffff) * Math.PI * 2;
  const placements: ArtworkPlacement[] = [];
  for (let index = 0; index < desiredCount; index += 1) {
    const unitDistance = desiredCount === 1 ? 0.28 : 0.18 + 0.72 * Math.sqrt((index + 0.5) / desiredCount);
    const angle = seedAngle + index * 2.399963229728653 + signedNoise(`${seed}:${profile.id}:${index}:angle`) * 0.22;
    const distance = travelRadius * unitDistance;
    const rotation = artworkRotation(profile.rotation ?? "free", `${seed}:${profile.id}:${index}:rotation`);
    const mirroring = profile.mirroring ?? "both";
    placements.push({
      x: metrics.anchorX + Math.cos(angle) * distance,
      y: metrics.anchorY + Math.sin(angle) * distance,
      width: placementWidth,
      height: placementHeight,
      rotation,
      flipX: mirroring !== "none" && (stableHash(`${seed}:${profile.id}:${index}:flip-x`) & 1) === 1,
      flipY: mirroring === "both" && (stableHash(`${seed}:${profile.id}:${index}:flip-y`) & 1) === 1,
      opacity: 0.19 + (stableHash(`${seed}:${profile.id}:${index}:opacity`) % 7) / 100,
    });
  }
  return { eligibility, placements };
}

/**
 * Duplicate a stamp across only the enabled periodic seams it overlaps. The
 * original plus copies are then clipped by every visible province fragment.
 */
export function periodicArtworkCopies(
  placement: ArtworkPlacement,
  width: number,
  height: number,
  wrapX: boolean,
  wrapY: boolean,
): PeriodicArtworkPlacement[] {
  const radiusX = (Math.abs(placement.width * Math.cos(placement.rotation)) + Math.abs(placement.height * Math.sin(placement.rotation))) / 2;
  const radiusY = (Math.abs(placement.width * Math.sin(placement.rotation)) + Math.abs(placement.height * Math.cos(placement.rotation))) / 2;
  const xOffsets: Array<-1 | 0 | 1> = [0];
  const yOffsets: Array<-1 | 0 | 1> = [0];
  if (wrapX && placement.x - radiusX < 0) xOffsets.push(1);
  if (wrapX && placement.x + radiusX > width) xOffsets.push(-1);
  if (wrapY && placement.y - radiusY < 0) yOffsets.push(1);
  if (wrapY && placement.y + radiusY > height) yOffsets.push(-1);
  const copies: PeriodicArtworkPlacement[] = [];
  for (const periodicOffsetY of yOffsets) {
    for (const periodicOffsetX of xOffsets) {
      copies.push({
        ...placement,
        x: placement.x + periodicOffsetX * width,
        y: placement.y + periodicOffsetY * height,
        periodicOffsetX,
        periodicOffsetY,
      });
    }
  }
  return copies;
}

/** Apply clipping before any raster decal is transformed or drawn. */
export function paintArtworkClippedToProvince(
  context: CanvasRenderingContext2D,
  clip: { polygons: readonly (readonly Point[])[]; width: number; height: number } | { path: Path2D },
  paint: () => void,
): void {
  context.save();
  if ("path" in clip) {
    context.clip(clip.path);
  } else {
    context.beginPath();
    for (const polygon of clip.polygons) {
      polygon.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x * clip.width, point.y * clip.height);
        else context.lineTo(point.x * clip.width, point.y * clip.height);
      });
      context.closePath();
    }
    context.clip();
  }
  paint();
  context.restore();
}

/** Draw a bitmap placement without allowing its intrinsic dimensions to leak into layout. */
export function paintAdaptiveBitmap(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  placement: ArtworkPlacement,
): void {
  context.save();
  context.globalAlpha *= placement.opacity;
  context.translate(placement.x, placement.y);
  context.rotate(placement.rotation);
  context.scale(placement.flipX ? -1 : 1, placement.flipY ? -1 : 1);
  context.drawImage(image, -placement.width / 2, -placement.height / 2, placement.width, placement.height);
  context.restore();
}

/**
 * Cover an arbitrary canvas with mirrored, center-cropped tiles. Mirroring
 * makes opposite pixels at every tile boundary identical even when the source
 * artwork was not authored as a seamless texture. Wrapped axes use an even
 * number of tiles so the map's outer edges also meet with the same phase.
 */
export function planSeamlessTiles(
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  wrapX: boolean,
  wrapY: boolean,
): SeamlessTileLayout {
  if (![width, height, sourceWidth, sourceHeight].every((value) => Number.isFinite(value) && value > 0)) {
    return { columns: 0, rows: 0, tiles: [] };
  }
  const targetShortAxis = Math.min(width, height) / 2;
  let columns = Math.max(1, Math.ceil(width / (targetShortAxis * (sourceWidth / sourceHeight))));
  let rows = Math.max(1, Math.ceil(height / targetShortAxis));
  if (wrapX && columns % 2 !== 0) columns += 1;
  if (wrapY && rows % 2 !== 0) rows += 1;
  const tileWidth = width / columns;
  const tileHeight = height / rows;
  const crop = coverCrop(sourceWidth, sourceHeight, tileWidth / tileHeight);
  const tiles: SeamlessTile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push({
        x: column * tileWidth,
        y: row * tileHeight,
        width: tileWidth,
        height: tileHeight,
        ...crop,
        flipX: column % 2 === 1,
        flipY: row % 2 === 1,
      });
    }
  }
  return { columns, rows, tiles };
}

function finalizeMetrics(
  source: ProvinceArtworkMetrics["source"],
  anchorX: number,
  anchorY: number,
  bounds: ArtworkBounds,
  areaPx2: number,
  perimeterPx: number,
  inscribedRadiusPx: number,
  pixelsPerReferencePixel: number,
): ProvinceArtworkMetrics {
  const shortAxisPx = Math.min(bounds.width, bounds.height);
  const aspectRatio = shortAxisPx > 0 ? Math.max(bounds.width, bounds.height) / shortAxisPx : Number.POSITIVE_INFINITY;
  const compactness = perimeterPx > 0 ? clamp((Math.PI * 4 * areaPx2) / (perimeterPx * perimeterPx), 0, 1) : 0;
  return {
    source,
    anchorX,
    anchorY,
    bounds,
    areaPx2: Math.max(0, areaPx2),
    perimeterPx: Math.max(0, perimeterPx),
    inscribedRadiusPx: Math.max(0, inscribedRadiusPx),
    shortAxisPx: Math.max(0, shortAxisPx),
    aspectRatio,
    compactness,
    pixelsPerReferencePixel,
    areaReferencePx2: areaPx2 / (pixelsPerReferencePixel * pixelsPerReferencePixel),
    inscribedRadiusReferencePx: inscribedRadiusPx / pixelsPerReferencePixel,
    shortAxisReferencePx: shortAxisPx / pixelsPerReferencePixel,
  };
}

function referenceScale(width: number, height: number): number {
  return Math.max(1 / ART_REFERENCE_SHORT_AXIS, Math.min(width, height) / ART_REFERENCE_SHORT_AXIS);
}

function createBounds(minX: number, minY: number, maxX: number, maxY: number): ArtworkBounds {
  return { minX, minY, maxX, maxY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function unwrapCoordinate(value: number, anchor: number, wraps: boolean): number {
  if (!wraps) return value;
  let result = value;
  while (result - anchor > 0.5) result -= 1;
  while (result - anchor < -0.5) result += 1;
  return result;
}

function isArtificialWrapEdge(first: Point, second: Point, wrapX: boolean, wrapY: boolean): boolean {
  const epsilon = 1e-8;
  const onSameXBoundary = (Math.abs(first.x) < epsilon && Math.abs(second.x) < epsilon)
    || (Math.abs(first.x - 1) < epsilon && Math.abs(second.x - 1) < epsilon);
  const onSameYBoundary = (Math.abs(first.y) < epsilon && Math.abs(second.y) < epsilon)
    || (Math.abs(first.y - 1) < epsilon && Math.abs(second.y - 1) < epsilon);
  return (wrapX && onSameXBoundary) || (wrapY && onSameYBoundary);
}

function pixelPolygonArea(points: readonly Point[], width: number, height: number): number {
  let result = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    result += current.x * width * next.y * height - next.x * width * current.y * height;
  }
  return result / 2;
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function thresholdRank(value: number, thresholds: readonly number[]): number {
  let rank = 0;
  while (rank < thresholds.length && value >= thresholds[rank]!) rank += 1;
  return rank;
}

function artworkRotation(mode: ArtworkRotation, seed: string): number {
  if (mode === "fixed") return 0;
  if (mode === "quarter-turns") return (stableHash(seed) % 4) * Math.PI / 2;
  return (stableHash(seed) / 0xffff_ffff) * Math.PI * 2;
}

function signedNoise(seed: string): number {
  return (stableHash(seed) / 0xffff_ffff) * 2 - 1;
}

function stableHash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function coverCrop(sourceWidth: number, sourceHeight: number, targetAspect: number) {
  const sourceAspect = sourceWidth / sourceHeight;
  let sourceX = 0;
  let sourceY = 0;
  let croppedWidth = sourceWidth;
  let croppedHeight = sourceHeight;
  if (targetAspect > sourceAspect) {
    croppedHeight = sourceWidth / targetAspect;
    sourceY = (sourceHeight - croppedHeight) / 2;
  } else {
    croppedWidth = sourceHeight * targetAspect;
    sourceX = (sourceWidth - croppedWidth) / 2;
  }
  return { sourceX, sourceY, sourceWidth: croppedWidth, sourceHeight: croppedHeight };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
