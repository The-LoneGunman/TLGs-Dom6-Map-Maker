import { sanitizeMapName, type MapProject, type Plane } from "./domain";
import { isRealmArtworkKind } from "./realmArt";
import { SKY_ART_VARIANTS } from "./skyArt";

/**
 * Illustrated-export planning that the editor needs without rendering:
 * artwork availability, file names, image province numbering, the export
 * preflight error and the package-size estimate. The encoders and package
 * assembly live in `./illustratedMap`, which is loaded only when exporting
 * and re-exports everything here.
 */

export type ExportArtwork = "native" | "illustrated";
export const IMAGE_SUFFIXES = SKY_ART_VARIANTS.map(variant => variant === "default" ? "" : `_${variant}`);
export type ImageNumbering = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** Avoid _planeN in image names: native mixed-format lookup strips that suffix. */
export function imageFileStem(project: Pick<MapProject, "name">, index: number): string {
  return `${sanitizeMapName(project.name)}_realm${index + 1}`;
}

/** A TGA-first atlas also needs independent names for later native recipes. */
export function nativeFileStem(project: MapProject, index: number, artwork: ExportArtwork): string {
  return artwork === "illustrated" && index > 0 && hasIllustratedArtwork(project.planes[0]!)
    ? imageFileStem(project, index)
    : `${sanitizeMapName(project.name)}${index ? `_plane${index + 1}` : ""}`;
}

export function hasIllustratedArtwork(plane: Pick<Plane, "kind">): boolean {
  return plane.kind === "cloud" || plane.kind === "air" || isRealmArtworkKind(plane.kind);
}

function assertDimensions(plane: Pick<Plane, "width" | "height">): void {
  if (!Number.isSafeInteger(plane.width) || !Number.isSafeInteger(plane.height)
    || plane.width < 256 || plane.height < 256 || plane.width > 3840 || plane.height > 3840
    || plane.width * plane.height > 8_294_400) {
    throw new RangeError("Illustrated maps require whole-pixel dimensions from 256×256 to 8.29 megapixels (maximum 3840 per axis).");
  }
}

/** Top-down editor coordinates; TGA and #pb serialization convert to bottom origin. */
export function imageCenters(plane: Plane) {
  assertDimensions(plane);
  if (!plane.provinces.length || plane.provinces.length > 800
    || new Set(plane.provinces.map(p => p.id)).size !== plane.provinces.length
    || plane.provinces.some((p, index) => p.index !== index + 1)) {
    throw new Error(`${plane.name}: illustrated export requires unique provinces in ascending editor-number order (1–800 provinces).`);
  }
  const occupied = new Set<number>();
  return plane.provinces.map((province, owner) => {
    const x = Math.round(province.x * (plane.width - 1));
    const y = Math.round(province.y * (plane.height - 1));
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= plane.width || y >= plane.height) {
      throw new Error(`${plane.name}: province ${province.index} has an invalid image center.`);
    }
    const pixel = y * plane.width + x;
    if (occupied.has(pixel)) throw new Error(`${plane.name}: two province centers occupy the same image pixel. Increase resolution or move a center.`);
    occupied.add(pixel);
    return { id: province.id, owner, x, y, pixel };
  });
}

/** Dominions scans white pixels left-to-right, starting at the bottom row. */
export function imageProvinceNumbers(plane: Plane): ReadonlyMap<string, number> {
  return new Map(imageCenters(plane).sort((a, b) => b.y - a.y || a.x - b.x).map((center, index) => [center.id, index + 1]));
}

export function illustratedExportError(project: MapProject): string | undefined {
  // Raw directives may contain local/global province references or replace the
  // image itself. Never guess a remapping for arbitrary map-language input.
  if ([project.rawDirectives, ...project.planes.flatMap(plane => [plane.rawDirectives, ...plane.provinces.map(p => p.rawDirectives)])]
    .some(raw => raw.split(/\r\n?|\n/).some(line => /^\s*#/.test(line)))) {
    return "Illustrated export cannot safely renumber advanced raw directives. Use Native scenery, or move those commands into the supported editor fields.";
  }
  try {
    for (const plane of project.planes) if (hasIllustratedArtwork(plane)) imageCenters(plane);
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  return undefined;
}

/** Conservative image + ownership estimate; never depends on expected compression. */
export function illustratedPackageBytes(project: MapProject): number {
  return project.planes.reduce((total, plane) => total + (hasIllustratedArtwork(plane)
    ? IMAGE_SUFFIXES.length * (18 + plane.width * plane.height * 4) + plane.width * plane.height * 32
    : 38 + plane.provinces.length * 12 + plane.width * plane.height * 4), 0);
}
