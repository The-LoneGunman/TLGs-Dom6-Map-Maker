# Sky artwork investigation — September 21, 2026

Development evidence only. This is not a release announcement or certification of an image-based exporter.

## Confirmed native boundaries

Dominions 6.37 was tested with isolated workspace-local games using the existing native smoke harness. No existing game saves, installed maps or user preferences were replaced. A 1024×768, 24-bit top-origin TGA with a magenta background and known white markers made the image source identifiable.

| Configuration | Verified | Not established |
| --- | --- | --- |
| D6M atlas with one conventionally named TGA plane | Failure in the native log: missing map recipe, zero-province plane and incorrect offsets despite exit code 0. | This conventional `_planeN` packaging method is unsafe and must not be emitted. |
| D6M main image with matching TGA companion | D6M center loading; visible native ground/water rendering rather than magenta artwork. | No supported companion-art override. |
| TGA main image with matching D6M companion | TGA decoding and 48 white-marker centers loaded from the image. | Original D6M center numbering and geometry are not retained by this combination. Exact marker coordinates and hit areas require their own checks. |
| D6M atlas with a separately registered `Atlas_Sky.map`/`Atlas_Sky.tga` plane | Headless game creation loaded the custom image at provinces 145–184 and retained the following D6M plane at 185–224. | The helper appeared as an unwanted selectable map; `#pb`, reference remapping, variants, and successful in-game GUI inspection were not established. |

The registered-image result supersedes any inference that the engine universally prohibits mixed formats. It proves loading feasibility only. The production exporter remains native `.map`/`.d6m`; see the [protocol note](research/SKY_RENDERING_OPTIONS_2026-09-21.md) and [custom-map comparison](research/ILLUSTRATED_MAP_PARITY_2026-09-21.md).

## Numbering assumptions under test

Pinned MapNuke source provides a primary implementation precedent for bottom-to-top, left-to-right province numbering and bottom-up ownership rows. This is not a substitute for native acceptance of Atlas's own serializer. A top-down canvas would therefore need integer-coordinate ordering and Y inversion; marker collisions, all province references, global nation starts, gates and raw directives must be handled explicitly.

For the TGA-first diagnostic fixture, expected top-down canvas marker positions are:

| Native province | Expected pixel |
| --- | --- |
| 1 | `(32, 736)` |
| 8 | `(992, 736)` |
| 9 | `(32, 595)` |
| 48 | `(992, 32)` |

The native GUI displayed the magenta image, and Goto province 1 selected its bottom-left marker, as expected. The other three positions and same-row tie ordering were not individually checked in the GUI. No `#pb` ownership runs were added to this diagnostic image, so it cannot certify exact province hit areas or dominion overlays.

## Implemented editor/PNG artwork

- Cloud/Air now use locally generated cloud banks, floating cliff edges/shadows, mixed terrain motifs and winter variants. No external images or new dependencies are required.
- Province terrain and owner masks are not mutated. Cave and water remain unsnowed; Warmer/Colder changes eligible dry-island snow strength. Cave Wall overrides other flags and stays sealed rock in every variant.
- Interactive rasters are bounded to display density and one cached canvas. High-resolution PNGs retain the configured pixel dimensions. Invalid draft dimensions fall through to the established painter.
- Browser use at `127.0.0.1:3022` covered Cloud/Air, normal/winter/forest/submerged previews, additive Forest+Cave edits, preserved guardian/gateway markers, Undo of test edits, and the actual 1536×1024 PNG export action. The rebuilt final source was reloaded and visually checked with refined cloud banks and winter coverage.
- Native regression evidence: re-exported all five `.map` and five `.d6m` files from the prior isolated Surface/Cave/Cavern/Cloud/Air fixture. All ten SHA-256 digests and byte arrays were identical. No gameplay export changes were adopted.
- Renderer tests cover all 18 candidate art variants, mixed flags, cave-wall precedence, wrap continuity, deterministic cache invalidation and extreme portrait/landscape/4K sizes. These variants are renderer capability, **not a playable TGA exporter**.

## Pending acceptance

- Full native confirmation of image marker ordering and orientation beyond the bottom-left first marker.
- A clean registered-image package without the helper-map entry, plus exact `#pb` ownership, province-reference remapping, terrain/winter variants, gates, cave behavior, overlays, and actual GUI/gameplay acceptance.
- If pursued, a separate all-image mode must satisfy the same semantic and visual checks; it is an alternative, not a demonstrated requirement.

An all-image exporter is not built or approved as a replacement for native D6M export by this investigation. Missing native terrain transitions must not be silently replaced with static artwork.

## Development checks

- Sky-renderer checkpoint: `npm test` passed **832 tests** (14 integration + 818 TypeScript), with no failures or skips, and the production build passed. An earlier in-progress run caught a cloud-wrap issue and an obsolete two-painter overlay assertion; the checkpoint source fixes the seam and checks the new sky overlay's owner path.
- `npm run typecheck`, `npm run lint`, `npm run licenses:check`, and `git diff --check`: passed.
- All ten playable files in the existing five-plane native acceptance fixture remain byte-identical.
- A representative 3840×2160 pure sky raster rendered in about 2.55 seconds initially and 0.44 seconds with prepared geometry. This is a local synthetic measurement, not a performance guarantee for arbitrary atlases.
- The unsupported TGA package integration was removed. Experimental protocol helpers remain only in ignored `tmp/`, not in production exports. No commits, merge, deployment, or installer publication occurred in this round.

**Final combined verification:** `npm test` passed **842 tests** (14 build/integration + 828 TypeScript), with no failures or skips. Type checking, repository lint, license checks and `git diff --check` passed.

Commit-preparation fixes add exact cache invalidation for mutable owner masks, collision-safe seed/ID keys, and terrain/climate edits. Metadata-only changes reuse the sky raster; labels and semantic markers repaint independently. Ownership clips now share the display scaling used by selection overlays. Procedural sky previews no longer load redundant background/material images.

The rebuilt local app was checked at desktop and 390×844 browser sizes: Cave/Cloud/Air rendering, winter and submerged previews, additive Forest+Farm edits and Undo, and the read-only layout explanation. There was no document-width overflow or captured console warning/error. The actual Air preview download was opened and verified as a **1536×1024 PNG** with readable labels and guardian/gateway badges. Test terrain edits were undone and the temporary viewport override was reset. This is editor/PNG acceptance, not a new native illustrated-map acceptance.

## Reproduction evidence

The [research note](research/SKY_RENDERING_OPTIONS_2026-09-21.md) links the official documentation and pinned MapNuke implementation, and lists local fixture/log paths. Those temporary files are ignored developer artifacts, not release dependencies. Successful process completion alone is insufficient: check each plane's province range and offset before accepting a native smoke result.
