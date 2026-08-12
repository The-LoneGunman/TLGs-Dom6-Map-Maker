import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ART_ASSET_MANIFEST_VERSION,
  type ArtAssetKind,
  type ArtAssetPackManifest,
  type ArtAssetRecord,
  validateArtAssetManifest,
} from "../src/artAssetManifest";

function asset(id: string, kind: ArtAssetKind): ArtAssetRecord {
  const transparent = kind === "decal" || kind === "line_brush";
  const fit = kind === "texture_tile" ? "tile_clip" : kind === "line_brush" ? "repeat_path" : kind === "backdrop" ? "cover" : "contain";
  const anchor = kind === "line_brush" ? "path" : kind === "backdrop" ? "canvas_center" : "interior_pole";
  return {
    id,
    family: `${kind}.fixture`,
    kind,
    files: [{
      source: `/art-assets/${id}.png`,
      width: kind === "line_brush" ? 512 : 256,
      height: kind === "line_brush" ? 64 : 256,
      format: "png",
      colorSpace: "srgb",
      alpha: transparent ? "straight" : "opaque",
      transparentPaddingPx: transparent ? 8 : 0,
      edgeBleedPx: 4,
    }],
    compatibility: {},
    shape: {
      classes: [kind === "line_brush" ? "corridor" : "any"],
      aspectRatio: { min: 1, max: 8 },
      areaToMedian: { min: 0.1, max: 8 },
      minInscribedToEquivalentRadius: 0.1,
      safeInsetRatio: 0.08,
      maxCoverageRatio: 0.6,
    },
    render: {
      fit,
      relativeTo: kind === "line_brush" ? "path_width" : kind === "backdrop" ? "canvas_short_edge" : "province_equivalent_diameter",
      scale: { min: 0.1, preferred: 0.4, max: 1 },
      renderedPixels: { min: 16, max: 1024, maxUpscale: 1.25 },
      rotation: kind === "line_brush" ? "follow_path" : "right_angles",
      mirrorX: kind !== "backdrop",
      mirrorY: false,
      opacity: 1,
      seamlessX: kind === "texture_tile" || kind === "line_brush",
      seamlessY: kind === "texture_tile",
    },
    placement: {
      anchor,
      weight: 1,
      maxPerProvince: 1,
      minSeparationRatio: 0.25,
      avoid: ["label", "marker"],
      adjacency: { mayCrossProvinceBorder: kind === "line_brush" },
    },
    fallback: {
      assetIds: [],
      final: kind === "texture_tile" ? "terrain_gradient" : kind === "line_brush" ? "procedural_edge" : kind === "backdrop" ? "realm_color" : "procedural_marks",
    },
  };
}

function fixture(): ArtAssetPackManifest {
  return {
    schemaVersion: ART_ASSET_MANIFEST_VERSION,
    id: "adaptive-atlas-fixture",
    version: "1.0.0",
    selectionSalt: "fixture-v1",
    assets: [
      asset("temperate-ground", "texture_tile"),
      asset("oak-cluster", "decal"),
      asset("river-stroke", "line_brush"),
      asset("cloud-void", "backdrop"),
    ],
  };
}

test("adaptive art manifest accepts all universal asset classes", () => {
  assert.deepEqual(validateArtAssetManifest(fixture()), []);
});

test("shipped universal material manifest satisfies the adaptive contract", () => {
  const shipped = JSON.parse(readFileSync(new URL("../public/map-art/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(validateArtAssetManifest(shipped), []);
  assert.deepEqual(shipped.assets.map((entry: { id: string }) => entry.id), [
    "material-earth",
    "material-foliage",
    "material-stone",
    "material-water",
  ]);
  for (const asset of shipped.assets as Array<{ files: Array<{ source: string; width: number; height: number }> }>) {
    for (const file of asset.files) {
      const bytes = readFileSync(new URL(`../public/${file.source.replace(/^\//, "")}`, import.meta.url));
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${file.source} must be a PNG`);
      assert.equal(bytes.readUInt32BE(16), file.width, `${file.source} width must match its manifest`);
      assert.equal(bytes.readUInt32BE(20), file.height, `${file.source} height must match its manifest`);
    }
  }
});

test("manifest rejects unsafe stretching, alpha, and upscale policies", () => {
  const manifest = fixture() as unknown as {
    assets: Array<{
      files: Array<{ alpha: string }>;
      render: { fit: string; rotation: string; renderedPixels: { maxUpscale: number } };
    }>;
  };
  const tile = manifest.assets[0]!;
  tile.render.fit = "contain";
  tile.files[0].alpha = "straight";
  const brush = manifest.assets[2]!;
  brush.render.rotation = "none";
  brush.render.renderedPixels.maxUpscale = 2;
  const messages = validateArtAssetManifest(manifest).map((entry) => entry.message);
  assert.ok(messages.includes("Texture tiles must be opaque to prevent province-color leaks."));
  assert.ok(messages.includes("Texture tiles must tile-clip and be seamless on both axes."));
  assert.ok(messages.includes("Line brushes must repeat and follow a path with a seamless long axis."));
  assert.ok(messages.includes("Upscaling above 1.5x is not allowed."));
});

test("manifest rejects fallback cycles and missing records", () => {
  const manifest = fixture();
  manifest.assets[0]!.fallback.assetIds = [manifest.assets[1]!.id];
  manifest.assets[1]!.fallback.assetIds = [manifest.assets[0]!.id, "does-not-exist"];
  const messages = validateArtAssetManifest(manifest).map((entry) => entry.message);
  assert.ok(messages.includes("Unknown fallback asset 'does-not-exist'."));
  assert.ok(messages.includes("Fallback graph contains a cycle."));
});

test("manifest requires resolution variants to preserve composition", () => {
  const manifest = fixture();
  manifest.assets[1]!.files.push({
    ...manifest.assets[1]!.files[0]!,
    source: "/art-assets/oak-cluster@2x.png",
    width: 512,
    height: 384,
  });
  const messages = validateArtAssetManifest(manifest).map((entry) => entry.message);
  assert.ok(messages.includes("Resolution variants must keep the same aspect ratio within 1%."));
});
