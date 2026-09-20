# Adaptive illustrated asset specification

This document separates the shipped artwork from the authoring contract for future asset packs. Reusable art must accommodate randomly generated provinces without assuming they are square, large, or compact.

## Current source implementation

Reviewed September 20, 2026. The v0.1.4 release already includes the four materials, but renderer fixes below are newer than that installer and the September 19 hosted build. See [Versions and documentation](../README.md#versions-and-documentation).

The editor and high-resolution PNG preview use four bundled grayscale materials, seven realm backdrops, and procedural terrain marks. The renderer selects and combines materials from the effective terrain flags in code, repeats them in map-relative coordinates, and clips them to canonical province ownership. Missing images leave the underlying terrain or realm color intact. Optional procedural marks use safe interior footprints and can be reduced or omitted on constrained shapes.

The `earth.png`, `foliage.png`, `stone.png`, and `water.png` materials are opaque, periodic 1024 x 1024 tiles in `public/map-art/materials/`. They repeat rather than stretching to match a province. See [artwork provenance](ASSET_PROVENANCE.md) for the inventory and source history.

The TypeScript contract and validator live in [`src/artAssetManifest.ts`](../src/artAssetManifest.ts); [`public/map-art/manifest.json`](../public/map-art/manifest.json) describes the four shipped materials. Tests validate this inventory, but the runtime does not consume it as a general asset-pack engine. Multi-resolution selection, bitmap decals, line brushes, adjacency/family avoidance, and ordered asset fallback chains are **future implementation requirements**, not shipped features.

Artwork appears automatically in the editor and PNG previews; there is no separate illustrated-pack export mode. Native `.map`/`.d6m` packages contain gameplay geometry and terrain data, not these raster illustrations. Dominions renders its own native scenery.

The editor fits the plane's aspect ratio and uses the inverse drawing transform for pointer selection. Terrain artwork remains clipped to canonical ownership, but province names and strategic badges are separate overlays so narrow chambers do not crop them. Names appear from 135% zoom, use collision-aware placement, and can be omitted when they do not fit; hover/selection text retains the complete name and marker details. Border artwork derives from the effective native bitmask, including custom combinations, in both solid and sparse ownership modes.

Condition previews resolve a separate, non-mutating terrain mask. Submerged preserves cave identity while adding water; transformed cover removes incompatible vegetation, and cave walls remain unchanged. Winter cover is an illustrative policy, not a temperature simulation: water, caves, and outer realms are excluded, and eligible land responds to Warmer/Colder. Neither editor nor PNG appearance certifies the game's exact seasonal rendering.

## Future pack requirements

The remaining sections define the intended authoring and rendering contract, not completed runtime behavior or a committed release roadmap. A future pack engine must select artwork only when its declared realm, terrain, geometry, adjacency, and resolution constraints pass. A failed match must use a compatible fallback instead of distorting an image to fit.

## Asset classes

| Class | Purpose | Adaptation rule | Safe terminal fallback |
| --- | --- | --- | --- |
| `texture_tile` | Ground, water, cloud, cavern floor, snow, ash | Seamless two-axis repeat, then clip to the canonical province-owner mask. Never stretch to a polygon. | Existing terrain gradient |
| `decal` | Forest cluster, town, ruin, reef, crystal, lava vent, landmark | Uniformly scale and place at the interior pole. Reject when the interior clearance, aspect, marker clearance, or source resolution fails. | Procedural marks or omit |
| `line_brush` | River, road, ridge, coast foam, infernal crack | Repeat a seamless strip along the actual shared-border or feature path, using authored caps/joins or procedural caps. Never non-uniformly stretch a strip. | Existing procedural edge |
| `backdrop` | Owner-zero cloud, void, cavern, infernal, dream, elemental space | Center-cover crop with a protected central focal region. Backdrops never determine province ownership. | Realm base color |

Complete painted province plates are deliberately excluded from the universal pack. A fixed plate cannot reliably match arbitrary generated polygons. If plates are added later, each must target a named shape template and be rejected for all other shapes.

## Geometry normalization

Manifest eligibility must use normalized geometry so the same pack can work at every output resolution:

- **Area ratio** is polygon area divided by the median province area on its plane.
- **Aspect ratio** is the major bounding-box dimension divided by the minor dimension, so it is always at least 1.
- **Equivalent radius** is `sqrt(area / pi)`.
- **Interior radius** is the distance from the selected interior pole to the nearest canonical border.
- **Manifest inradius ratio** (`minInscribedToEquivalentRadius`) is interior radius divided by equivalent radius. This differs from the current procedural renderer's `compactness` metric, `4*pi*area/perimeter²`.
- **Shape class** is a deterministic bucket (`tiny`, `compact`, `broad`, `elongated`, `corridor`, or `coastal`). The class is descriptive; all numeric envelope checks still apply.

A future decal renderer must accept a decal only when the target bounds remain inside the polygon after `safeInsetRatio` is applied. Uniform downscaling may be tried down to `render.scale.min`; below that, use the next fallback. `maxCoverageRatio` must prevent a technically fitting decal from visually overwhelming a small province. Long ornaments need dedicated `elongated` or `corridor` records rather than squashed compact art.

For wrapped planes, candidate positions are evaluated in canonical coordinates and repeated only in the visible seam copies. The selection hash uses the canonical province and edge IDs, so opposite edges cannot choose different variants.

## Resolution and sampling

- Author at two or more source resolutions when an asset can appear from 4K exports down to the editor viewport. Resolution variants must have the same aspect ratio within 1%.
- A pack renderer must choose the smallest source that meets the target pixel size, subject to the manifest's hard `renderedPixels` limits.
- Upscaling is capped at 1.5x by validation; production packs should normally use 1.25x or less. If no source qualifies, use a fallback.
- Downsampling should use browser high-quality interpolation. Pixel-art assets, if ever introduced, require a separate asset class rather than silently changing sampling.
- Text, province numbers, starts, thrones, gates, sites, and selection markers remain renderer-native overlays and are never baked into art.

### Alpha and color

All files are authored in sRGB. Pantokrator Atlas does not use chroma keys or color-key transparency.

- Texture tiles are opaque. This avoids hairline leaks between polygon clipping and the base terrain fill.
- Decals and line brushes use straight RGBA alpha. Their transparent padding is declared in source pixels.
- RGB beneath translucent edge pixels must be dilated from the nearest visible artwork, not filled with black or white. `edgeBleedPx` records that guard band and prevents matte halos during filtering.
- Fully transparent pixels may still carry dilated edge color. The alpha channel, not RGB, controls visibility.
- Atlas packing, if introduced later, must add duplicated edge bleed and must never sample a neighboring sprite.

## Placement and adjacency rules

Every semantic asset placement must be checked against generated map data, not inferred from pixel color. These requirements concern future bitmap decorations; the shipped procedural cave mark indicates Cave terrain, not a gateway:

- Ports require a land/coastal province with a real water neighbor. Reefs and kelp require aquatic terrain.
- Bridges and rivers require the corresponding effective native border bits, whether stored as a preset or Custom value. Mountain ridges require an appropriate mountain-border/pass bit or explicitly tagged mountain feature; an impassable flag alone is not evidence of mountains.
- Gate art is anchored to a real gate endpoint. Cave-opening art additionally requires a cave-family connection. Throne art requires a preferred or fixed throne.
- A province-local decal cannot cross its owner boundary. Only a line brush whose manifest explicitly allows border crossing may span a shared border.
- Starts, thrones, gates, sites, province markers, and labels have exclusion geometry. Strategic information always wins; optional decoration is shifted, reduced within its envelope, or omitted.
- `minSeparationRatio`, family avoidance, and graph-hop separation keep identical landmarks from forming visible rows or repeating in every neighboring province.
- Neighbor constraints prevent contradictory transitions, such as shoreline foam away from water or a lush tree cluster in infernal waste.

Future texture transitions should use clipping and an inset blend band, not two stretched edge sprites. Where no compatible transition exists, retain the ordinary province border.

## Deterministic variety

Asset selection must be independent of array order. Candidates are sorted by stable asset ID, then weighted with a local hash of:

`project seed | manifest selectionSalt | plane ID | province/edge ID | layer | family`

The same hash must select resolution-independent rotation, mirroring, offset, and variant. Failed candidates must be tried in a stable order. Asset calls must not consume the generator's global gameplay random stream or change starts, terrain, thrones, gates, or guardians.

Mirroring and rotation are opt-in per asset. Text, asymmetric heraldry, directional shadows, waterfalls, and similar features normally disable mirroring. Path brushes follow path direction but use canonical edge endpoint ordering so regeneration cannot reverse them unexpectedly.

## Fallback sequence

A future pack renderer must follow this non-destructive order:

1. Select an exact-compatible family member whose shape and source resolution both pass.
2. Try the record's ordered fallback IDs; each fallback must independently pass compatibility and geometry.
3. Use the declared raster-free terminal fallback: existing procedural marks/edge, terrain gradient, realm color, or omission.

The manifest validator checks fallback graphs for missing IDs, self-references, and cycles. Runtime handling of missing or undecodable files must follow the same chain. A pack implementation must demonstrate that asset failures do not leave blank provinces, corrupt ownership, change connectivity, or block map export.

## Recommended source envelopes

These are authoring targets, not permission to bypass each record's manifest limits:

| Asset | Typical sources | Transparent padding | Edge bleed | Notes |
| --- | --- | ---: | ---: | --- |
| Texture tile | 256, 512, 1024 px square | 0 | 4–8 px repeat-safe content | Pixel-identical opposite seams |
| Compact decal | 256 and 512 px short edge | 8–12% of short edge | 4 px | Visible bounds centered around anchor |
| Broad landmark | 512 and 1024 px short edge | 8–12% | 4–8 px | Use only in broad/compact shapes with large inradius |
| Corridor decal | 512×128 and 1024×256 families | 6–10% | 4 px | Dedicated long composition; no compact-image squashing |
| Line brush | 512×64 and 1024×128 strips | Cap-dependent | 4–8 px | Long axis seamless; caps and joins separate where needed |
| Backdrop | 2048 and 4096 px square | 0 | 0 | Important content inside central 50%; cover-crop safe |

## Acceptance requirements for future packs

This is an acceptance checklist for new pack implementations, not a record that every listed visual test has been performed:

1. Validate the manifest before allocating images.
2. Render each asset at its minimum, preferred, and maximum scale in every allowed shape class.
3. Exercise 1:1, 4:3, 16:9, ultrawide, portrait, and wrapped maps at editor and maximum export resolutions.
4. Test smallest, median, and largest generated provinces plus deliberately narrow corridors and concave chambers.
5. Check winter and every other compatible condition; an unavailable condition must fall back rather than tinting an incompatible baked appearance.
6. Force every image load to fail and verify that maps remain readable and exportable.
7. Compare repeated generations byte-for-byte at the placement-plan level, and verify that enabling art does not alter map/project data.
8. Inspect alpha edges over light snow, dark void, water, and high-contrast neighboring terrain for halos or one-pixel seams.

A shipped pack should remain automatic: users should not need to download, resize, place, or repair its artwork. Any future playable illustrated-map export would need its own format support and documentation; the current native D6M export does not embed the preview artwork.
