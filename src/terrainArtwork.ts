import { planProvinceArtwork, type ArtworkPlacement, type ProvinceArtworkMetrics } from "./adaptiveArtwork";
import type { TerrainMarkKind } from "./terrainVisuals";

export interface TerrainMarkPlacement extends ArtworkPlacement { kind: TerrainMarkKind }

/** Give every terrain feature a slot, even when the usual detail budget is one. */
export function planTerrainMarks(
  metrics: ProvinceArtworkMetrics,
  kinds: readonly TerrainMarkKind[],
  seed: string,
  density = 1,
): TerrainMarkPlacement[] {
  const features = [...new Set(kinds)];
  if (!features.length) return [];
  const plan = planProvinceArtwork(metrics, {
    id: "terrain-features",
    minAreaReferencePx2: 120,
    minInscribedRadiusReferencePx: 3.5,
    maxAspectRatio: 3.8,
    nominalSizeReferencePx: 16,
    density,
    fallback: "micro",
  }, seed);
  const first = plan.placements[0];
  if (!first) return [];
  const count = Math.max(features.length, Math.min(9, plan.placements.length));
  const safeRadius = metrics.inscribedRadiusPx * 0.8;
  const orbit = safeRadius * 0.65;
  const separation = count > 1 ? 2 * orbit * Math.sin(Math.PI / count) : safeRadius;
  const size = Math.min(first.width * 1.4, separation * 0.72, (safeRadius - orbit) * Math.SQRT2);
  // At sub-pixel sizes, the mixed terrain fill is the legible fallback.
  if (size < 1) return [];
  const phase = Math.atan2(first.y - metrics.anchorY, first.x - metrics.anchorX);
  return Array.from({ length: count }, (_, index) => ({
    kind: features[index % features.length]!,
    x: metrics.anchorX + Math.cos(phase + index * Math.PI * 2 / count) * orbit,
    y: metrics.anchorY + Math.sin(phase + index * Math.PI * 2 / count) * orbit,
    width: size,
    height: size,
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 0.78,
  }));
}
