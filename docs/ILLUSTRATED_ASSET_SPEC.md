# Adaptive illustrated asset specification

This contract lets Pantokrator Atlas add reusable artwork without assuming that a randomly generated province is square, large, or even compact. Artwork is selected only when its declared realm, terrain, geometry, adjacency, and resolution constraints all pass. A failed match is normal: the renderer follows the asset's deterministic fallback chain and never distorts an image to make it fit.

The machine-readable TypeScript contract and validator live in `src/artAssetManifest.ts`. The first production inventory is `public/map-art/manifest.json`, with periodic grayscale materials below `public/map-art/materials/`. These rules also apply to generated assets before they are accepted into that inventory.

## Asset classes

| Class | Purpose | Adaptation rule | Safe terminal fallback |
| --- | --- | --- | --- |
| `texture_tile` | Ground, water, cloud, cavern floor, snow, ash | Seamless two-axis repeat, then clip to the canonical province-owner mask. Never stretch to a polygon. | Existing terrain gradient |
| `decal` | Forest cluster, town, ruin, reef, crystal, lava vent, landmark | Uniformly scale and place at the interior pole. Reject when the interior clearance, aspect, marker clearance, or source resolution fails. | Procedural marks or omit |
| `line_brush` | River, road, ridge, coast foam, infernal crack | Repeat a seamless strip along the actual shared-border or feature path, using authored caps/joins or procedural caps. Never non-uniformly stretch a strip. | Existing procedural edge |
| `backdrop` | Owner-zero cloud, void, cavern, infernal, dream, elemental space | Center-cover crop with a protected central focal region. Backdrops never determine province ownership. | Realm base color |

Complete painted province plates are deliberately excluded from the universal pack. A fixed plate cannot reliably match arbitrary generated polygons. If plates are added later, each must target a named shape template and be rejected for all other shapes.

## Geometry normalization

Eligibility uses normalized geometry so the same manifest works at every output resolution:

- **Area ratio** is polygon area divided by the median province area on its plane.
- **Aspect ratio** is the major bounding-box dimension divided by the minor dimension, so it is always at least 1.
- **Equivalent radius** is `sqrt(area / pi)`.
- **Interior radius** is the distance from the selected interior pole to the nearest canonical border.
- **Compactness** is interior radius divided by equivalent radius.
- **Shape class** is a deterministic bucket (`tiny`, `compact`, `broad`, `elongated`, `corridor`, or `coastal`). The class is descriptive; all numeric envelope checks still apply.

A decal is eligible only when the target bounds remain inside the polygon after `safeInsetRatio` is applied. Uniform downscaling may be tried down to `render.scale.min`; below that, the next fallback is used. `maxCoverageRatio` prevents a technically fitting decal from visually overwhelming a small province. Long ornaments use dedicated `elongated` or `corridor` records rather than squashing compact art.

For wrapped planes, candidate positions are evaluated in canonical coordinates and repeated only in the visible seam copies. The selection hash uses the canonical province and edge IDs, so opposite edges cannot choose different variants.

## Resolution and sampling

- Author at two or more source resolutions when an asset can appear from 4K exports down to the editor viewport. Resolution variants must have the same aspect ratio within 1%.
- The renderer chooses the smallest source that meets the target pixel size, subject to the manifest's hard `renderedPixels` limits.
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

Every placement is checked against actual generated map semantics, not inferred from pixel color:

- Ports require a land/coastal province with a real water neighbor. Reefs and kelp require aquatic terrain.
- Bridges require a `bridge` edge; river art requires a `river` edge. Mountain ridges require a mountain-border, impassable, mountain-pass, or explicitly tagged mountain feature.
- Gate art is anchored to a real gate endpoint. Cave-opening art additionally requires a cave-family connection. Throne art requires a preferred or fixed throne.
- A province-local decal cannot cross its owner boundary. Only a line brush whose manifest explicitly allows border crossing may span a shared border.
- Starts, thrones, gates, sites, province markers, and labels have exclusion geometry. Strategic information always wins; optional decoration is shifted, reduced within its envelope, or omitted.
- `minSeparationRatio`, family avoidance, and graph-hop separation keep identical landmarks from forming visible rows or repeating in every neighboring province.
- Neighbor constraints prevent contradictory transitions, such as shoreline foam away from water or a lush tree cluster in infernal waste.

Texture transitions use clipping and an inset blend band, not two stretched edge sprites. Where no compatible transition exists, the ordinary province border hides the seam.

## Deterministic variety

Asset selection must be independent of array order. Candidates are sorted by stable asset ID, then weighted with a local hash of:

`project seed | manifest selectionSalt | plane ID | province/edge ID | layer | family`

The same hash selects resolution-independent rotation, mirroring, offset, and variant. Failed candidates are tried in a stable order. No asset call consumes the generator's global gameplay random stream, so adding artwork cannot change starts, terrain, thrones, gates, or guardians.

Mirroring and rotation are opt-in per asset. Text, asymmetric heraldry, directional shadows, waterfalls, and similar features normally disable mirroring. Path brushes follow path direction but use canonical edge endpoint ordering so regeneration cannot reverse them unexpectedly.

## Fallback sequence

The renderer follows this non-destructive order:

1. Select an exact-compatible family member whose shape and source resolution both pass.
2. Try the record's ordered fallback IDs; each fallback must independently pass compatibility and geometry.
3. Use the declared raster-free terminal fallback: existing procedural marks/edge, terrain gradient, realm color, or omission.

Fallback graphs are validated for missing IDs, self-references, and cycles. A missing or undecodable file follows exactly the same path. Asset failures therefore cannot leave a blank province, corrupt owner colors, change connectivity, or block map export.

## Recommended source envelopes

These are authoring targets, not permission to bypass each record's manifest limits:

| Asset | Typical sources | Transparent padding | Edge bleed | Notes |
| --- | --- | ---: | ---: | --- |
| Texture tile | 256, 512, 1024 px square | 0 | 4â€“8 px repeat-safe content | Pixel-identical opposite seams |
| Compact decal | 256 and 512 px short edge | 8â€“12% of short edge | 4 px | Visible bounds centered around anchor |
| Broad landmark | 512 and 1024 px short edge | 8â€“12% | 4â€“8 px | Use only in broad/compact shapes with large inradius |
| Corridor decal | 512Ã—128 and 1024Ã—256 families | 6â€“10% | 4 px | Dedicated long composition; no compact-image squashing |
| Line brush | 512Ã—64 and 1024Ã—128 strips | Cap-dependent | 4â€“8 px | Long axis seamless; caps and joins separate where needed |
| Backdrop | 2048 and 4096 px square | 0 | 0 | Important content inside central 50%; cover-crop safe |

The current `earth.png`, `foliage.png`, `stone.png`, and `water.png` source materials are 1024-pixel square, opaque, mathematically periodic tiles. Their manifest compatibility maps them to terrain families, while grayscale luminance lets the renderer apply realm-, terrain-, and condition-specific color without baking a contradictory palette into the source. Because they repeat and are clipped to canonical ownership, they are safe for every province aspect ratio and area; they never rely on a province-shaped plate.

## Acceptance checks for every shipped pack

1. Validate the manifest before allocating images.
2. Render each asset at its minimum, preferred, and maximum scale in every allowed shape class.
3. Exercise 1:1, 4:3, 16:9, ultrawide, portrait, and wrapped maps at editor and maximum export resolutions.
4. Test smallest, median, and largest generated provinces plus deliberately narrow corridors and concave chambers.
5. Check winter and every other compatible condition; an unavailable condition must fall back rather than tinting an incompatible baked appearance.
6. Force every image load to fail and verify that maps remain readable and exportable.
7. Compare repeated generations byte-for-byte at the placement-plan level, and verify that enabling art does not alter map/project data.
8. Inspect alpha edges over light snow, dark void, water, and high-contrast neighboring terrain for halos or one-pixel seams.

The illustrated mode can remain a one-click export option: the application ships the validated pack, selects compatible assets automatically, and packages every generated file. Users never need to download, resize, place, or repair artwork.
