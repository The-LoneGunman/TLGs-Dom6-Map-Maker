import { effectiveProvinceTerrainFlags, planeGenerationKey, sanitizeMapName, type MapProject, type Plane, type Province, type TerrainFlag } from "./domain";
import { createProvinceOwnerResolver } from "./geometry";
import { compileMapText } from "./dom6";
import { type Dom6CatalogBundle } from "./catalog";
import { type VerifiedPopulationDefenseProfile } from "./populationDefenders";
import { isRealmArtworkKind, renderRealmRgb } from "./realmArt";
import { renderSkyRgb, SKY_ART_VARIANTS, type SkyArtVariant } from "./skyArt";

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

/** Canonical owner mask, including D6M's quantized-center ownership guarantee. */
export async function sampleIllustratedOwnership(plane: Plane): Promise<Int16Array> {
  const centers = imageCenters(plane);
  const owners = new Int16Array(plane.width * plane.height);
  const resolver = createProvinceOwnerResolver(plane);
  for (let y = 0; y < plane.height; y++) {
    for (let x = 0; x < plane.width; x++) owners[y * plane.width + x] = resolver.ownerAt((x + .5) / plane.width, (y + .5) / plane.height);
    if (y % 64 === 63) await yieldFrame();
  }
  for (const center of centers) owners[center.pixel] = center.owner;
  return owners;
}

/** Horizontal ownership runs; omit unowned space so cloud/rock gaps stay unowned. */
export function compileImageOwnership(plane: Plane, owners: Int16Array, numbers = imageProvinceNumbers(plane)): string {
  if (owners.length !== plane.width * plane.height) throw new RangeError("Image ownership size does not match its plane.");
  const mapped = plane.provinces.map(province => numbers.get(province.id)!);
  const rows: string[] = [];
  for (let y = plane.height - 1; y >= 0; y--) {
    const runs: string[] = [];
    for (let x = 0; x < plane.width;) {
      const owner = owners[y * plane.width + x]!;
      if (owner < -1 || owner >= mapped.length) throw new RangeError("Invalid image province owner.");
      const start = x++;
      while (x < plane.width && owners[y * plane.width + x] === owner) x++;
      if (owner >= 0) runs.push(`#pb ${start} ${plane.height - 1 - y} ${x - start} ${mapped[owner]}`);
    }
    if (runs.length) rows.push(runs.join("\r\n"));
  }
  return `${rows.join("\r\n")}\r\n`;
}

/**
 * Lossless 24-bit RLE Targa. Input is top-down RGB; disk rows are bottom-up BGR.
 * `scratch` optionally supplies reusable worst-case working storage; the result
 * is always a fresh, exactly sized copy, so the scratch buffer never escapes.
 */
export function encodeTga24(width: number, height: number, rgb: Uint8Array, scratch?: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > 65535 || height > 65535 || rgb.length !== width * height * 3) throw new RangeError("Invalid RGB image dimensions.");
  // Each row's RLE packet stream is bounded by four bytes per pixel.
  const capacity = tgaScratchBytes(width, height);
  const output = scratch && scratch.length >= capacity ? scratch : new Uint8Array(capacity);
  output.fill(0, 0, 18);
  const view = new DataView(output.buffer, output.byteOffset, 18);
  output[2] = 10;
  view.setUint16(12, width, true); view.setUint16(14, height, true);
  output[16] = 24; output[17] = 0;
  let offset = 18;
  const equal = (a: number, b: number) => rgb[a * 3] === rgb[b * 3] && rgb[a * 3 + 1] === rgb[b * 3 + 1] && rgb[a * 3 + 2] === rgb[b * 3 + 2];
  const writePixel = (pixel: number) => {
    output[offset++] = rgb[pixel * 3 + 2]!;
    output[offset++] = rgb[pixel * 3 + 1]!;
    output[offset++] = rgb[pixel * 3]!;
  };
  for (let y = height - 1; y >= 0; y--) {
    const end = (y + 1) * width;
    let pixel = y * width;
    while (pixel < end) {
      let run = 1;
      while (run < 128 && pixel + run < end && equal(pixel, pixel + run)) run++;
      if (run >= 2) {
        output[offset++] = 0x80 | (run - 1); writePixel(pixel); pixel += run;
      } else {
        const start = pixel++;
        while (pixel < end && pixel - start < 128) {
          if (pixel + 1 < end && equal(pixel, pixel + 1)) break;
          pixel++;
        }
        output[offset++] = pixel - start - 1;
        for (let raw = start; raw < pixel; raw++) writePixel(raw);
      }
    }
  }
  return output.slice(0, offset);
}

/** Worst-case encodeTga24 working storage for one image. */
export function tgaScratchBytes(width: number, height: number): number {
  return 18 + width * height * 4;
}

/** Native sheets replace cover but keep cave walls, water, relief and climate. */
export function imageTerrain(province: Province, variant: SkyArtVariant): Province {
  if (variant === "default" || variant === "winter") return province;
  const flags = new Set(effectiveProvinceTerrainFlags(province));
  if (flags.has("cavewall")) return province;
  const cover = variant.replace(/w$/, "");
  if (flags.has("sea") && cover !== "kelp" && cover !== "water") return province;
  for (const flag of ["forest", "farm", "swamp", "waste", "highland"] as const) flags.delete(flag);
  if (cover === "water" || cover === "kelp") { flags.add("sea"); flags.delete("freshwater"); }
  if (cover === "kelp") flags.add("forest");
  if (["forest", "farm", "swamp", "waste", "highland"].includes(cover)) flags.add(cover as TerrainFlag);
  return { ...province, terrain: "plains", terrainFlags: [...flags], freshwater: false };
}

export async function* encodeIllustratedImages(plane: Plane, owners?: Int16Array): AsyncGenerator<{ suffix: string; data: Uint8Array }> {
  const mask = owners ?? await sampleIllustratedOwnership(plane);
  const centers = imageCenters(plane);
  // One worst-case RLE buffer serves all variants; each yielded image is its own copy.
  const scratch = new Uint8Array(tgaScratchBytes(plane.width, plane.height));
  for (let i = 0; i < SKY_ART_VARIANTS.length; i++) {
    const variant = SKY_ART_VARIANTS[i]!;
    const displayed = { ...plane, provinces: plane.provinces.map(province => imageTerrain(province, variant)) };
    const winter = variant === "winter" || variant.endsWith("w");
    const rgb = plane.kind === "cloud" || plane.kind === "air"
      ? renderSkyRgb(displayed, mask, winter ? "winter" : "default", `${planeGenerationKey(plane)}:sky-art`)
      : renderRealmRgb(displayed, mask, `${planeGenerationKey(plane)}:realm-art`);
    // Renderers reserve pure white; enforce the format invariant at the boundary.
    for (let at = 0; at < rgb.length; at += 3) {
      if (rgb[at] === 255 && rgb[at + 1] === 255 && rgb[at + 2] === 255) rgb[at] = 254;
    }
    for (const center of centers) rgb.fill(255, center.pixel * 3, center.pixel * 3 + 3);
    yield { suffix: IMAGE_SUFFIXES[i]!, data: encodeTga24(plane.width, plane.height, rgb, scratch) };
    await yieldFrame();
  }
}

/** Conservative image + ownership estimate; never depends on expected compression. */
export function illustratedPackageBytes(project: MapProject): number {
  return project.planes.reduce((total, plane) => total + (hasIllustratedArtwork(plane)
    ? IMAGE_SUFFIXES.length * (18 + plane.width * plane.height * 4) + plane.width * plane.height * 32
    : 38 + plane.provinces.length * 12 + plane.width * plane.height * 4), 0);
}

export function createIllustratedExport(project: MapProject) {
  const error = illustratedExportError(project);
  if (error) throw new Error(error);
  const numbering: ImageNumbering = new Map(project.planes.filter(hasIllustratedArtwork).map(plane => [plane.id, imageProvinceNumbers(plane)]));
  // One plane at a time. A fresh mask is released once its map and images are
  // consumed; never retain all atlas rasters in a package/compiler object.
  const isIllustrated = (index: number) => hasIllustratedArtwork(project.planes[index]!);
  /** Map directives without an illustrated plane's #pb ownership runs. */
  const baseMapText = (index: number, catalog: Dom6CatalogBundle, profiles: readonly VerifiedPopulationDefenseProfile[]): string => {
    const stem = imageFileStem(project, index);
    return compileMapText(project, index, catalog, profiles, { numbering,
      ...(isIllustrated(index) ? { imageFile: `${stem}.tga`, winterImageFile: `${stem}_winter.tga` }
        : { imageFile: `${nativeFileStem(project, index, "illustrated")}.d6m` }) });
  };
  return {
    numbering, isIllustrated, baseMapText,
    async mapText(index: number, catalog: Dom6CatalogBundle, profiles: readonly VerifiedPopulationDefenseProfile[]): Promise<string> {
      const plane = project.planes[index]!;
      const text = baseMapText(index, catalog, profiles);
      return isIllustrated(index) ? text + compileImageOwnership(plane, await sampleIllustratedOwnership(plane), numbering.get(plane.id)) : text;
    },
    images(index: number) { return encodeIllustratedImages(project.planes[index]!); },
    /**
     * Sample an illustrated plane's native ownership once for both its #pb runs
     * (baseMapText + ownershipText is exactly mapText) and every image variant.
     * The mask is released once the returned images have been consumed.
     */
    async artwork(index: number): Promise<{ ownershipText: string; images: AsyncGenerator<{ suffix: string; data: Uint8Array }> }> {
      const plane = project.planes[index]!;
      const owners = await sampleIllustratedOwnership(plane);
      return { ownershipText: compileImageOwnership(plane, owners, numbering.get(plane.id)), images: encodeIllustratedImages(plane, owners) };
    },
  };
}

/** Host reports retain editor IDs; this explicit table bridges native image IDs. */
export function illustratedNumberingReport(project: MapProject): string {
  const lines = ["ILLUSTRATED PROVINCE NUMBERING", "The editable project and balance/topology reports use editor numbers. In-game image provinces use the numbers below.",
    "Do not replace a running game's map with a differently numbered export. Generate a new game when changing artwork modes."];
  let offset = 0;
  for (const plane of project.planes) {
    const numbers = hasIllustratedArtwork(plane) ? imageProvinceNumbers(plane) : undefined;
    lines.push("", `${plane.name}: editor local/global -> in-game local/global | province name`);
    for (const province of plane.provinces) {
      const number = numbers?.get(province.id) ?? province.index;
      lines.push(`${province.index}/${offset + province.index} -> ${number}/${offset + number} | ${JSON.stringify(province.name)}`);
    }
    offset += plane.provinces.length;
  }
  return lines.join("\r\n");
}

async function yieldFrame() { await new Promise<void>(resolve => setTimeout(resolve, 0)); }
