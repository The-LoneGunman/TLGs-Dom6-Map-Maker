import type { EdgeKind, PlaneKind, PlaneVariant, PreviewCondition, TerrainKey } from "./domain";

/**
 * Versioned contract for artwork shipped with Pantokrator Atlas. Asset packs are
 * data, not project state: a project remains loadable when a pack is upgraded or
 * unavailable because every record declares a non-raster final fallback.
 */
export const ART_ASSET_MANIFEST_VERSION = 1 as const;

export const ART_ASSET_KINDS = ["texture_tile", "decal", "line_brush", "backdrop"] as const;
export type ArtAssetKind = typeof ART_ASSET_KINDS[number];

export const ART_SHAPE_CLASSES = ["tiny", "compact", "broad", "elongated", "corridor", "coastal", "any"] as const;
export type ArtShapeClass = typeof ART_SHAPE_CLASSES[number];

export const ART_AVOIDANCE_TAGS = ["province_border", "label", "marker", "start", "throne", "gate", "site"] as const;
export type ArtAvoidanceTag = typeof ART_AVOIDANCE_TAGS[number];

export interface ArtAssetFile {
  /** App-root-relative URL. Shipped packs use PNG for reproducible browser decoding. */
  source: string;
  width: number;
  height: number;
  format: "png" | "webp";
  colorSpace: "srgb";
  /** No chroma keying: decals and brushes use straight (unpremultiplied) alpha. */
  alpha: "opaque" | "straight";
  /** Transparent breathing room around a decal/brush, measured in source pixels. */
  transparentPaddingPx: number;
  /** RGB edge dilation beyond visible pixels or a repeat seam guard. */
  edgeBleedPx: number;
}

export interface ArtCompatibility {
  /** Omitted arrays mean universal within the remaining constraints. */
  planeKinds?: PlaneKind[];
  planeVariants?: PlaneVariant[];
  terrains?: TerrainKey[];
  previewConditions?: PreviewCondition[];
  edgeKinds?: EdgeKind[];
  /** All tags must be present in the placement context. */
  requiredTags?: string[];
  /** Any matching tag makes the asset ineligible. */
  excludedTags?: string[];
}

export interface ArtShapeEnvelope {
  classes: ArtShapeClass[];
  /** Bounding-box major/minor ratio; always at least 1. */
  aspectRatio: { min: number; max: number };
  /** Province area divided by the plane's median province area. */
  areaToMedian: { min: number; max: number };
  /** Rejects narrow shapes whose interior cannot hold the art without clipping. */
  minInscribedToEquivalentRadius: number;
  /** Border clearance as a fraction of the province equivalent radius. */
  safeInsetRatio: number;
  /** Maximum fraction of province area that non-tiled visible artwork may occupy. */
  maxCoverageRatio: number;
}

export interface ArtRenderPolicy {
  fit: "tile_clip" | "contain" | "cover" | "repeat_path";
  relativeTo: "province_equivalent_diameter" | "province_inradius" | "path_width" | "canvas_short_edge";
  /** Target-size multipliers relative to `relativeTo`; the preferred value is tried first. */
  scale: { min: number; preferred: number; max: number };
  /** Hard raster limits after scaling. No file may be enlarged beyond maxUpscale. */
  renderedPixels: { min: number; max: number; maxUpscale: number };
  rotation: "none" | "right_angles" | "continuous" | "follow_path";
  mirrorX: boolean;
  mirrorY: boolean;
  opacity: number;
  /** Tile axes must be explicitly declared rather than inferred from the image. */
  seamlessX: boolean;
  seamlessY: boolean;
}

export interface ArtPlacementPolicy {
  anchor: "centroid" | "interior_pole" | "border_midpoint" | "path" | "canvas_center";
  weight: number;
  maxPerProvince: number;
  /** Center-to-center distance as a fraction of province equivalent diameter. */
  minSeparationRatio: number;
  avoid: ArtAvoidanceTag[];
  /** Optional spatial rules evaluated against the actual province graph. */
  adjacency?: {
    requireTerrainNeighbor?: TerrainKey[];
    forbidTerrainNeighbor?: TerrainKey[];
    avoidFamilies?: string[];
    minProvinceHopsFromSameFamily?: number;
    mayCrossProvinceBorder: boolean;
  };
}

export interface ArtFallbackPolicy {
  /** Ordered, compatible asset IDs to try. Cycles are invalid. */
  assetIds: string[];
  /** Guaranteed terminal behavior. It must not depend on raster loading. */
  final: "procedural_marks" | "procedural_edge" | "terrain_gradient" | "realm_color" | "omit";
}

export interface ArtAssetRecord {
  /** Stable across pack versions; selection hashes use this rather than array order. */
  id: string;
  family: string;
  kind: ArtAssetKind;
  files: ArtAssetFile[];
  compatibility: ArtCompatibility;
  shape: ArtShapeEnvelope;
  render: ArtRenderPolicy;
  placement: ArtPlacementPolicy;
  fallback: ArtFallbackPolicy;
}

export interface ArtAssetPackManifest {
  schemaVersion: typeof ART_ASSET_MANIFEST_VERSION;
  id: string;
  version: string;
  /** Selection salt changes only when an intentional global reroll is desired. */
  selectionSalt: string;
  assets: ArtAssetRecord[];
}

export interface ArtAssetManifestIssue {
  path: string;
  message: string;
}

const PLANE_KINDS = new Set<PlaneKind>([
  "surface", "cave", "cavern", "cloud", "air", "underworld", "hell", "abyss", "dream", "elemental", "custom",
]);
const PLANE_VARIANTS = new Set<PlaneVariant>([
  "temperate", "wild", "frozen", "arid", "oceanic", "fungal", "crystal", "volcanic", "storm", "infernal", "void",
]);
const TERRAINS = new Set<TerrainKey>([
  "plains", "forest", "farm", "swamp", "waste", "highland", "mountains", "freshwater", "sea", "deepsea", "kelp",
  "cave", "caveforest", "caveswamp", "cavewaste", "cavehighland", "cavewall",
]);
const CONDITIONS = new Set<PreviewCondition>(["normal", "winter", "forested", "flooded", "wasted", "farmland"]);
const EDGE_KINDS = new Set<EdgeKind>([
  "standard", "mountain_border", "mountain_pass", "river", "bridge", "impassable", "road", "custom",
]);

/** Strict validation used at build/import boundaries before any image allocation. */
export function validateArtAssetManifest(input: unknown): ArtAssetManifestIssue[] {
  const issues: ArtAssetManifestIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(input)) return [{ path: "$", message: "Manifest must be an object." }];
  if (input.schemaVersion !== ART_ASSET_MANIFEST_VERSION) issue("$.schemaVersion", `Expected ${ART_ASSET_MANIFEST_VERSION}.`);
  validateId(input.id, "$.id", issue);
  if (typeof input.version !== "string" || !input.version.trim()) issue("$.version", "Version must be a non-empty string.");
  if (typeof input.selectionSalt !== "string" || !input.selectionSalt.trim()) issue("$.selectionSalt", "Selection salt must be a non-empty string.");
  if (!Array.isArray(input.assets) || !input.assets.length) {
    issue("$.assets", "At least one asset is required.");
    return issues;
  }

  const ids = new Set<string>();
  const assets = input.assets;
  assets.forEach((asset, index) => {
    const path = `$.assets[${index}]`;
    if (!isRecord(asset)) { issue(path, "Asset must be an object."); return; }
    validateId(asset.id, `${path}.id`, issue);
    if (typeof asset.id === "string") {
      if (ids.has(asset.id)) issue(`${path}.id`, "Asset ID must be unique.");
      ids.add(asset.id);
    }
    validateId(asset.family, `${path}.family`, issue);
    if (!isOneOf(asset.kind, ART_ASSET_KINDS)) issue(`${path}.kind`, "Unknown asset kind.");
    validateFiles(asset.files, asset.kind, `${path}.files`, issue);
    validateCompatibility(asset.compatibility, `${path}.compatibility`, issue);
    validateShape(asset.shape, `${path}.shape`, issue);
    validateRender(asset.render, asset.kind, `${path}.render`, issue);
    validatePlacement(asset.placement, `${path}.placement`, issue);
    validateFallback(asset.fallback, `${path}.fallback`, issue);
  });

  const assetById = new Map<string, Record<string, unknown>>();
  for (const asset of assets) if (isRecord(asset) && typeof asset.id === "string") assetById.set(asset.id, asset);
  for (const [id, asset] of assetById) {
    if (!isRecord(asset.fallback) || !Array.isArray(asset.fallback.assetIds)) continue;
    for (const fallbackId of asset.fallback.assetIds) {
      if (typeof fallbackId !== "string" || !assetById.has(fallbackId)) issue(`$.assets.${id}.fallback.assetIds`, `Unknown fallback asset '${String(fallbackId)}'.`);
      else if (fallbackId === id) issue(`$.assets.${id}.fallback.assetIds`, "An asset cannot fall back to itself.");
    }
  }
  detectFallbackCycles(assetById, issue);
  return issues;
}

function validateFiles(value: unknown, kind: unknown, path: string, issue: IssueFn) {
  if (!Array.isArray(value) || !value.length) { issue(path, "At least one source resolution is required."); return; }
  let firstAspect: number | undefined;
  value.forEach((file, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(file)) { issue(itemPath, "File must be an object."); return; }
    if (typeof file.source !== "string" || !/^\/[a-z0-9][a-z0-9/_@.-]+$/i.test(file.source)) issue(`${itemPath}.source`, "Source must be an app-root-relative asset URL.");
    positiveInteger(file.width, `${itemPath}.width`, issue);
    positiveInteger(file.height, `${itemPath}.height`, issue);
    if (file.format !== "png" && file.format !== "webp") issue(`${itemPath}.format`, "Format must be png or webp.");
    if (file.colorSpace !== "srgb") issue(`${itemPath}.colorSpace`, "Only sRGB assets are supported.");
    if (file.alpha !== "opaque" && file.alpha !== "straight") issue(`${itemPath}.alpha`, "Alpha must be opaque or straight.");
    nonnegativeInteger(file.transparentPaddingPx, `${itemPath}.transparentPaddingPx`, issue);
    nonnegativeInteger(file.edgeBleedPx, `${itemPath}.edgeBleedPx`, issue);
    if ((kind === "decal" || kind === "line_brush") && file.alpha !== "straight") issue(`${itemPath}.alpha`, "Decals and line brushes require straight alpha.");
    if (kind === "texture_tile" && file.alpha !== "opaque") issue(`${itemPath}.alpha`, "Texture tiles must be opaque to prevent province-color leaks.");
    if (typeof file.width === "number" && typeof file.height === "number" && file.width > 0 && file.height > 0) {
      const aspect = file.width / file.height;
      if (firstAspect === undefined) firstAspect = aspect;
      else if (Math.abs(aspect / firstAspect - 1) > 0.01) issue(itemPath, "Resolution variants must keep the same aspect ratio within 1%.");
      const paddingLimit = Math.floor(Math.min(file.width, file.height) * 0.25);
      if (typeof file.transparentPaddingPx === "number" && file.transparentPaddingPx > paddingLimit) issue(`${itemPath}.transparentPaddingPx`, "Transparent padding may not exceed 25% of the short edge.");
    }
  });
}

function validateCompatibility(value: unknown, path: string, issue: IssueFn) {
  if (!isRecord(value)) { issue(path, "Compatibility must be an object."); return; }
  enumArray(value.planeKinds, PLANE_KINDS, `${path}.planeKinds`, issue);
  enumArray(value.planeVariants, PLANE_VARIANTS, `${path}.planeVariants`, issue);
  enumArray(value.terrains, TERRAINS, `${path}.terrains`, issue);
  enumArray(value.previewConditions, CONDITIONS, `${path}.previewConditions`, issue);
  enumArray(value.edgeKinds, EDGE_KINDS, `${path}.edgeKinds`, issue);
  stringArray(value.requiredTags, `${path}.requiredTags`, issue);
  stringArray(value.excludedTags, `${path}.excludedTags`, issue);
}

function validateShape(value: unknown, path: string, issue: IssueFn) {
  if (!isRecord(value)) { issue(path, "Shape envelope must be an object."); return; }
  enumArray(value.classes, new Set(ART_SHAPE_CLASSES), `${path}.classes`, issue, true);
  orderedRange(value.aspectRatio, 1, Number.POSITIVE_INFINITY, `${path}.aspectRatio`, issue);
  orderedRange(value.areaToMedian, 0, Number.POSITIVE_INFINITY, `${path}.areaToMedian`, issue);
  unitInterval(value.minInscribedToEquivalentRadius, `${path}.minInscribedToEquivalentRadius`, issue);
  boundedNumber(value.safeInsetRatio, 0, 0.45, `${path}.safeInsetRatio`, issue);
  boundedNumber(value.maxCoverageRatio, 0.01, 1, `${path}.maxCoverageRatio`, issue);
}

function validateRender(value: unknown, kind: unknown, path: string, issue: IssueFn) {
  if (!isRecord(value)) { issue(path, "Render policy must be an object."); return; }
  const fits = ["tile_clip", "contain", "cover", "repeat_path"] as const;
  const relatives = ["province_equivalent_diameter", "province_inradius", "path_width", "canvas_short_edge"] as const;
  const rotations = ["none", "right_angles", "continuous", "follow_path"] as const;
  if (!isOneOf(value.fit, fits)) issue(`${path}.fit`, "Unknown fit mode.");
  if (!isOneOf(value.relativeTo, relatives)) issue(`${path}.relativeTo`, "Unknown relative scale.");
  orderedTriple(value.scale, 0, Number.POSITIVE_INFINITY, `${path}.scale`, issue);
  if (!isRecord(value.renderedPixels)) issue(`${path}.renderedPixels`, "Rendered-pixel limits are required.");
  else {
    positiveNumber(value.renderedPixels.min, `${path}.renderedPixels.min`, issue);
    positiveNumber(value.renderedPixels.max, `${path}.renderedPixels.max`, issue);
    positiveNumber(value.renderedPixels.maxUpscale, `${path}.renderedPixels.maxUpscale`, issue);
    if (typeof value.renderedPixels.min === "number" && typeof value.renderedPixels.max === "number" && value.renderedPixels.min > value.renderedPixels.max) issue(`${path}.renderedPixels`, "Minimum may not exceed maximum.");
    if (typeof value.renderedPixels.maxUpscale === "number" && value.renderedPixels.maxUpscale > 1.5) issue(`${path}.renderedPixels.maxUpscale`, "Upscaling above 1.5x is not allowed.");
  }
  if (!isOneOf(value.rotation, rotations)) issue(`${path}.rotation`, "Unknown rotation mode.");
  if (typeof value.mirrorX !== "boolean" || typeof value.mirrorY !== "boolean") issue(path, "Mirror flags must be booleans.");
  boundedNumber(value.opacity, 0, 1, `${path}.opacity`, issue);
  if (typeof value.seamlessX !== "boolean" || typeof value.seamlessY !== "boolean") issue(path, "Seamless-axis flags must be booleans.");
  if (kind === "texture_tile" && (value.fit !== "tile_clip" || value.seamlessX !== true || value.seamlessY !== true)) issue(path, "Texture tiles must tile-clip and be seamless on both axes.");
  if (kind === "line_brush" && (value.fit !== "repeat_path" || value.rotation !== "follow_path" || value.seamlessX !== true)) issue(path, "Line brushes must repeat and follow a path with a seamless long axis.");
  if (kind === "backdrop" && value.fit !== "cover") issue(`${path}.fit`, "Backdrops must use cover cropping.");
}

function validatePlacement(value: unknown, path: string, issue: IssueFn) {
  if (!isRecord(value)) { issue(path, "Placement policy must be an object."); return; }
  const anchors = ["centroid", "interior_pole", "border_midpoint", "path", "canvas_center"] as const;
  if (!isOneOf(value.anchor, anchors)) issue(`${path}.anchor`, "Unknown anchor.");
  positiveNumber(value.weight, `${path}.weight`, issue);
  nonnegativeInteger(value.maxPerProvince, `${path}.maxPerProvince`, issue);
  boundedNumber(value.minSeparationRatio, 0, 4, `${path}.minSeparationRatio`, issue);
  enumArray(value.avoid, new Set(ART_AVOIDANCE_TAGS), `${path}.avoid`, issue);
  if (value.adjacency !== undefined) {
    if (!isRecord(value.adjacency)) issue(`${path}.adjacency`, "Adjacency must be an object.");
    else {
      enumArray(value.adjacency.requireTerrainNeighbor, TERRAINS, `${path}.adjacency.requireTerrainNeighbor`, issue);
      enumArray(value.adjacency.forbidTerrainNeighbor, TERRAINS, `${path}.adjacency.forbidTerrainNeighbor`, issue);
      stringArray(value.adjacency.avoidFamilies, `${path}.adjacency.avoidFamilies`, issue);
      if (value.adjacency.minProvinceHopsFromSameFamily !== undefined) nonnegativeInteger(value.adjacency.minProvinceHopsFromSameFamily, `${path}.adjacency.minProvinceHopsFromSameFamily`, issue);
      if (typeof value.adjacency.mayCrossProvinceBorder !== "boolean") issue(`${path}.adjacency.mayCrossProvinceBorder`, "Border-crossing policy is required.");
    }
  }
}

function validateFallback(value: unknown, path: string, issue: IssueFn) {
  if (!isRecord(value)) { issue(path, "Fallback policy must be an object."); return; }
  if (value.assetIds === undefined) issue(`${path}.assetIds`, "Ordered fallback IDs are required; use an empty array when none are needed.");
  else stringArray(value.assetIds, `${path}.assetIds`, issue);
  const finals = ["procedural_marks", "procedural_edge", "terrain_gradient", "realm_color", "omit"] as const;
  if (!isOneOf(value.final, finals)) issue(`${path}.final`, "Unknown terminal fallback.");
}

function detectFallbackCycles(assets: Map<string, Record<string, unknown>>, issue: IssueFn) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const asset = assets.get(id);
    const fallbacks = isRecord(asset?.fallback) && Array.isArray(asset.fallback.assetIds) ? asset.fallback.assetIds : [];
    for (const next of fallbacks) if (typeof next === "string" && assets.has(next) && visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of assets.keys()) {
    visiting.clear();
    if (visit(id)) { issue(`$.assets.${id}.fallback.assetIds`, "Fallback graph contains a cycle."); break; }
  }
}

type IssueFn = (path: string, message: string) => void;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isOneOf<T extends readonly unknown[]>(value: unknown, choices: T): value is T[number] { return choices.includes(value); }
function validateId(value: unknown, path: string, issue: IssueFn) { if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(value)) issue(path, "Use a stable lowercase ID containing letters, numbers, dots, underscores, or hyphens."); }
function positiveInteger(value: unknown, path: string, issue: IssueFn) { if (!Number.isSafeInteger(value) || (value as number) <= 0) issue(path, "Must be a positive whole number."); }
function nonnegativeInteger(value: unknown, path: string, issue: IssueFn) { if (!Number.isSafeInteger(value) || (value as number) < 0) issue(path, "Must be a non-negative whole number."); }
function positiveNumber(value: unknown, path: string, issue: IssueFn) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) issue(path, "Must be a positive finite number."); }
function boundedNumber(value: unknown, min: number, max: number, path: string, issue: IssueFn) { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) issue(path, `Must be between ${min} and ${max}.`); }
function unitInterval(value: unknown, path: string, issue: IssueFn) { boundedNumber(value, 0, 1, path, issue); }
function stringArray(value: unknown, path: string, issue: IssueFn, required = false) { if (value === undefined && !required) return; if (!Array.isArray(value) || (required && !value.length) || value.some((item) => typeof item !== "string" || !item.trim())) issue(path, required ? "Must be a non-empty string array." : "Must be a string array."); }
function enumArray<T>(value: unknown, allowed: Set<T>, path: string, issue: IssueFn, required = false) { if (value === undefined && !required) return; if (!Array.isArray(value) || (required && !value.length) || value.some((item) => !allowed.has(item as T))) issue(path, required ? "Must contain at least one supported value." : "Contains an unsupported value."); }
function orderedRange(value: unknown, lower: number, upper: number, path: string, issue: IssueFn) { if (!isRecord(value)) { issue(path, "Range is required."); return; } boundedNumber(value.min, lower, upper, `${path}.min`, issue); boundedNumber(value.max, lower, upper, `${path}.max`, issue); if (typeof value.min === "number" && typeof value.max === "number" && value.min > value.max) issue(path, "Minimum may not exceed maximum."); }
function orderedTriple(value: unknown, lower: number, upper: number, path: string, issue: IssueFn) { if (!isRecord(value)) { issue(path, "Scale triple is required."); return; } boundedNumber(value.min, lower, upper, `${path}.min`, issue); boundedNumber(value.preferred, lower, upper, `${path}.preferred`, issue); boundedNumber(value.max, lower, upper, `${path}.max`, issue); if (typeof value.min === "number" && typeof value.preferred === "number" && typeof value.max === "number" && !(value.min <= value.preferred && value.preferred <= value.max)) issue(path, "Scale must satisfy min <= preferred <= max."); }
