# Adversarial repairs and verification — September 20, 2026

Branch: `codex/adversarial-repairs-sep20`, based on `c0ab14ac5da4d52f552872885b493b640b1d123d`. These repairs address the [preceding review](ADVERSARIAL_REVIEW_2026-09-20.md). This report records verification before commit and push; merging and public app/installer publication are separate steps.

## Implemented corrections

| Finding | Correction | Verification |
| --- | --- | --- |
| R1: recovery could overwrite newer edits | Shared request/revision guard, serialized local saves, obsolete queued saves discarded, displaced project retained in Undo | Deferred production-callback tests for edits, reversed reads, imports, cancellation, and failures; real two-tab browser recovery followed by Undo |
| R2: catalog import races | Selection-order import queue, reset/unmount invalidation, persistence before activating a new catalog | Reversed completion, reset, queued import, and quota-failure tests |
| R3: export report catalog mismatch | Active catalog passed to ZIP and direct-install report generation, with explicit metadata/version caveats | Custom-catalog package and direct-install tests; native map/D6M bytes unchanged by report context |
| R4: uneditable custom border | Bounded 0–255 input; switching to Custom preserves the preset's effective value | Inspector render, validation, and browser editing checks |
| R5: custom borders drawn as standard | Shared effective-bitmask styles for solid and sparse borders, including combined rules | Preset/custom equivalence and combined-style regressions |
| R6: contradictory transformed terrain | One effective preview mask replaces incompatible cover while preserving physical geography; cave walls remain blocked | Negative feature assertions and shared PNG-painter checks; submerged Underworld browser inspection |
| R7: universal winter wash | Documented illustrative policy excludes water, caves, and outer realms; eligible land responds to Warmer/Colder | Policy tests, PNG drawing-trace checks, Underworld and Cloud browser inspection |
| R8: distorted map proportions | Aspect-preserving framing with the same inverse transform for pointer selection | Landscape/square/portrait tests at multiple viewport sizes, zoom and pan; desktop and narrow-browser checks |
| R9: clipped labels and tiny markers | Semantic labels/badges drawn outside terrain masks, collision-aware placement, bounded screen-size text/markers, full hover/selection details | Placement tests and zoomed/narrow-browser inspection including gateway details and keyboard selection |

The additional population-analysis hardening gap is also corrected: invalid or out-of-range populations count as unknown instead of overflowing the known-population total. Export validation still rejects them.

The [user guide](USER_GUIDE.md) now explains custom border editing, preview limitations, map framing, catalog import behavior, and recovery Undo.

## Completed checks

- `npm test`: production build and **368 passing tests** (14 JavaScript, 354 TypeScript), no failures or skips.
- `npm run typecheck`, `npm run lint`, `npm run licenses:check`, and whitespace checks passed.
- Local production-server smoke passed: loopback binding, page, manifest, icon, and traversal rejection.
- Browser playtest used a disposable local project: three planes, 154 provinces, generation, custom-border editing, condition changes, zoom, plane switching, keyboard selection, autosave and recovery. At a 390×844 viewport, document content did not overflow horizontally; the map remained aspect-correct.
- A two-tab conflict kept unsaved local work intact. Loading the newer copy changed the project to the remote version; Undo restored the exact local project name used to identify the displaced snapshot.
- No browser console warnings or errors were captured in either playtest tab. Temporary tabs were closed and the local test server was stopped afterward.
- An isolated eight-plane native package contained 232 provinces, 21 files, and 28 gateway endpoints. All eight D6M files passed binary inspection, and project validation found no errors.

Build output retains the existing large-chunk and Vinext route-classification warnings. Automated drawing assertions and browser inspection are complementary checks, not a claim of perfect visuals for every seed or resolution.

## In-engine boundary

The installed game reports Dominions 6.37. A scripted isolated new-game attempt exited without producing a saved game; that is **not a successful in-engine playtest**. A hidden-window attempt was not inspectable and was stopped. A visible-window test is awaiting user approval. Existing saves and the user's maps folder were not replaced.

Consequently, actual game loading, seasonal rendering, guardian combat/leadership, post-capture PD, recruitment, and multiplayer balance remain unconfirmed on that patch. The bundled catalog remains pinned to 6.35; no speculative IDs or nation-specific balance adjustments were added. Release-channel synchronization is a separate action and was not performed here.
