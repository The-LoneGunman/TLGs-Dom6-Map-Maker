# Connected regions and passages — September 21, 2026

## Delivery status

Implemented and tested on `codex/natural-realm-regions-sep21`, based on `aebee99`, then merged to `main` at **`25a7586`** through [PR #7](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/pull/7). This remains an **unreleased feature**; the hosted app and Windows v0.1.5 are unchanged. The later [natural-landform pass](NATURAL_LANDFORMS_2026-09-22.md) refines contours while preserving the connected-region model. No third-party map artwork was copied or bundled. See the [layout references](research/NATURAL_CAVERN_REFERENCES_2026-09-21.md) for primary sources and edition distinctions.

## Behavior

Sparse realms automatically use **Connected regions & passages**: adjoining province floors inside irregular multi-province groups, with substantial passage provinces between groups. Great Cavern uses larger floors; Cloud and Air use smaller groups. The procedural shape, preview ownership, movement frontiers and native D6M raster share one ownership model. The classic selector and its old route-generation path have been removed at the user's request.

- Missing, `chambers` and `regions` compatibility metadata now have the same effective layout. Old JSON and recipes still round-trip; obsolete metadata cannot opt back into classic generation.
- Opening a saved map does not regenerate IDs, terrain, armies, starts, thrones, gates or movement links. Regeneration is a separate confirmed action that creates the new clustered graph.
- A regenerated regional graph connects each group internally and joins the groups with local passages. Start allocation still applies capital protection, useful-exit balancing and spacing checks; it avoids passage bottlenecks where feasible.
- The Underworld retains its dedicated River Styx layout. Obsolete layout metadata is ignored there, while actual Styx geometry remains validated. Solid ownership also stays unchanged.
- Nonlocal authored links or unusably short shared frontiers retain compatibility geometry with an explicit notice. No links are silently deleted. This safeguard is not a selectable generation mode.
- Native-resolution auditing removes disconnected raster fragments from regional floors. If quantization would invent or omit movement contacts, Atlas warns and retains compatibility geometry. Higher resolution can restore regional rendering without regeneration. The preservation renderer retains pre-existing edge-pixel artifacts; it is not a rewrite of authored maps.
- Layout locks and pending-generation diagnostics follow effective topology, not obsolete option metadata. Older sparse-generation snapshots become pending. Guardian fixtures follow the same automatic layout rule.
- Wrapped links open the nearest actual shared frontier rather than duplicating a distant passage through the map's center.

The automatic-default review found and repaired start-hub planning problems: hubs must have enough actual local contacts, failed candidates no longer stop the remaining search, and the packing bound applies before dense high-degree hub placement. The existing hard-spacing, equal-exit, two-ring capacity and throne-access thresholds were retained. The ten-seed mixed-plane corpus subsequently scored 82–91 overall and 66–100 for throne access; these are structural diagnostics, not a combat-balance certification.

## Automated verification

Two dated implementation checkpoints passed: the opt-in revision ran **819 tests** (14 build/integration and 805 TypeScript), and the automatic-default revision ran **818 tests** (14 build/integration and 804 TypeScript), both without failures or skips. The count changed because selector and old-graph tests were replaced by migration, default-behavior, start-hub, and ownership coverage. Type checking, lint, license checks, and `git diff --check` also passed at the automatic-default checkpoint. These are historical feature checkpoints, not the final aggregate result after later sky-renderer integration.

**Final combined verification:** `npm test` passed **842 tests** (14 build/integration + 828 TypeScript), with no failures or skips. Type checking, repository lint, license checks and `git diff --check` passed. The final five-plane fixture re-encode retained all ten native files byte for byte.

The commit-preparation review also fixed mutable draft aliasing in cached regional ownership: each model now retains its own geometry snapshot, so moving a province, changing dimensions/wrapping, or reordering the source array cannot corrupt a previously returned or restored model. Three focused regressions cover these edits; 24 additional extreme-aspect/wrap connectivity cases passed. The final browser check retained the connected layout, readable narrow-screen information card and no horizontal document overflow.

New coverage includes:

- Eight realm kinds across square, portrait, single-axis wrap and toroidal fixtures: actual raster contacts equal the authored graph, each regional province is four-connected, centers remain owned, and drawn frontiers have the expected owner on both sides.
- Broad occupied area and shared borders, real passage provinces, graph-edit rock seams, native/preview parity, large and extreme-aspect layouts up to 800 provinces, and byte-identical compatibility fallback.
- Regions-only generation, exact province totals, connected movement, safe/equal-degree starts, guardian exclusion rings and frozen legacy generation snapshots.
- Strict schema validation, current-map information, inert legacy metadata, recipes, locks, content preservation, Underworld handling and native validation notices.
- Independent stress-review reproductions at 80, 240 and 800 provinces on 256×256 maps. Detached cloud/cave pixels are removed without abandoning regions; unsafe 800-province frontiers explicitly fall back. Raising resolution rechecks the cached decision. An empty 4K draft does not allocate an audit raster.

The independent post-fix 192-map corpus had no movement-contact mismatches and no disconnected footprints in retained regional layouts. Eighteen extreme-density cases explicitly fell back; twelve retained legacy classic one-pixel specks. These are reported compatibility behavior, not silently treated as repaired regional rendering.

An 800-province 3840×2160 toroidal case took approximately 1.27 seconds for its first safety/model audit and 0.46 ms per cached notice. These are local observations, not performance guarantees. Geometry-sensitive caching avoids repeating the raster scan for content-only edits; temporary raster buffers are not retained.

## Browser acceptance

Used the local production build, not the public app:

- Generated 96 Surface + 48 connected Cave provinces, then added 43 connected Cloud provinces, with no export blockers.
- Inspected broad cave floors, underground water, wide connecting provinces and cloud-island groups with themed background artwork.
- The earlier opt-in checkpoint exercised style switching and Undo. The final pass verified that no selector remains, Cave reports Connected regions, and an Underworld draft reports River Styx layout.
- Reloaded the saved project and verified that its content and province counts persisted.
- Repeated restore and rendering on the final build; clicking a broad cave floor away from its center marker correctly selected province 29 in the inspector.
- At a 390×844 viewport, the layout select was approximately 347 pixels wide and the document had no horizontal overflow. Temporary viewport overrides were reset.
- No browser console warnings or errors were captured during the workflows.

The final browser workflow also restored the pre-removal saved project, added an Air plane with no layout choice, and generated 230 provinces across Surface/Cave/Cloud/Air with no export blockers. At 390 pixels wide, the layout-information card fit without horizontal overflow; no console warnings or errors were captured. See the [sky-rendering research](research/SKY_RENDERING_OPTIONS_2026-09-21.md) for the separate editor-art and native-export boundaries.

## Native Dominions 6.37 acceptance

Created a separate Middle Age test game with the installed executable and isolated configuration/maps/saves. Existing player games were not targets. The game successfully created its fatherland and turn files. Its Surface, Cave, Great Cavern, Cloud and Air planes were visually inspected through the in-game plane selector. The test process was closed afterward.

The package contained 228 provinces at 1024×768 per plane:

| Plane | Provinces | Movement edges | Native observation |
| --- | ---: | ---: | --- |
| Surface | 48 | 117 | Existing overland rendering loaded normally. |
| Cave | 48 | 71 | Adjoining cave floors, branching passages, fungal scenery and underground water rendered. |
| Great Cavern | 48 | 73 | Larger continuous basins, narrower inter-basin provinces, crystalline/fungal scenery and water rendered. |
| Cloud | 40 | 47 | Broad island groups and connecting provinces rendered with native terrain. |
| Air | 40 | 53 | Substantial regional masses and passages rendered with native terrain. |

Ulm and Abysia occupied the two surface starts. One otherwise guardian-free observation province on each extra layer was assigned to Ulm solely to expose its plane tab. These fixture-only ownership changes were not applied to the application defaults.

All five `.map` files and all five `.d6m` files used for native inspection were re-encoded from the saved fixture with the final source and compared **byte for byte: identical**. Thus the later raster-safety correction did not invalidate this visual acceptance package.

Dominions supplies its own terrain scenery and still displays black ownerless space in these native views. Atlas's cloud and cave backdrops are editor/PNG artwork, not a newly added native background raster. This round verifies geometry and loading; it does not establish a full multiplayer game's strategic balance or every seasonal visual.
