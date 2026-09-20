# Adversarial review — September 20, 2026

Reviewed revision: `c0ab14ac5da4d52f552872885b493b640b1d123d` on `codex/audit-fixes-sep19`.

Historical review: the findings below describe that revision, not the subsequent repairs. See [repair verification](REPAIR_VERIFICATION_2026-09-20.md) for implementation status, regression results, and remaining in-engine verification limits.

## Verdict

The regression baseline is healthy, but this is **not a clean release sign-off**. Nine actionable findings remain: one high-priority data-loss race, seven medium-priority functional or preview-accuracy issues, and one lower-priority readability issue.

This review changes no application code and publishes nothing. The only repository addition is this report. Browser experiments used disposable local projects on an isolated loopback port, not the user's public-app project or Dominions maps folder.

## Confirmed findings

### R1 — P1: A delayed recovery load can erase newer work and Undo history

Location: `src/MapMakerApp.tsx:1139`, especially the assignment and history reset after `await loadProjectAutosave(...)`.

Normal project imports have a request/revision guard; **Load newer copy / Inspect other copy** does not. The editor remains editable during that asynchronous read. When it finishes, the callback unconditionally replaces the current project and clears both history stacks, even if another edit or project-opening action occurred in the meantime.

Reproduction: execute the actual recovery callback body with a deferred storage read; edit the current project while the read is pending; resolve the read with an older snapshot. The resulting project was `older recovered copy`, Undo contained zero entries, and the message said `Loaded the newer device autosave.` This was a deterministic callback-level reproduction, not an artificially delayed browser test.

Repair: apply a shared request/revision guard to every project-replacement path, invalidate pending replacements on edits/Undo/Redo/New/import, and preserve or explicitly back up the displaced local work. Regression tests should include reversed recovery completions and recovery versus normal imports.

### R2 — P2: Concurrent catalog imports can discard entries

Location: `src/MapMakerApp.tsx:873` and `src/MapMakerApp.tsx:891`.

`importCatalog` merges against the `userCatalog` captured before its file read. Two imports begun before either finishes both merge against that old value. A reset also does not invalidate a pending import.

Reproduction: invoke the actual import callback twice with deferred reads and distinct valid test catalogs. After resolving A and then B, both active state and stored JSON contained only B's unit ID (`60002`), losing A's ID (`60001`) instead of merging them. These are synthetic test IDs, not proposed game content.

A related failure-path inconsistency was reproduced: when storage throws, the new catalog has already become active, although the action reports import failure. A reload can therefore change the catalog again without a clear session-only warning.

Repair: serialize imports or merge against the latest catalog at completion, invalidate pending work on reset, and make persistence failure behavior explicit and transactional.

### R3 — P2: Exported validation ignores the active custom catalog

Location: `src/export.ts:902`, particularly `validateProject(project)` at line 905; compare the UI's `validateProject(project, catalog)` in `src/MapMakerApp.tsx`.

The UI validates against the merged catalog, but package support files validate against the bundled default. Thus a package approved in the editor can contain a contradictory error report.

Reproduction: add a synthetic fort ID to a custom catalog, reference it in a non-start province, and build a small package. UI-equivalent validation with the active catalog returned no errors; the exported report declared that the same fort was not listed in the map manual.

Repair: pass the active catalog context through ZIP/direct-install report generation and identify the catalog assumptions in the report. This must not imply that catalog entries install game content or prove that custom IDs exist in the player's game.

### R4 — P2: The Custom border option creates an unresolvable-in-place export blocker

Location: `src/MapMakerApp.tsx:1864`, especially the border select at line 1873.

The Advanced inspector offers **Custom value** but has no input for `edge.special`. Selecting it on an ordinary generated border only changes `kind`, leaving the required bitmask undefined.

Reproduction in the production-build browser: select province 1, open Advanced, change a Standard border to Custom value. The UI immediately reports one export blocker: `A custom connection requires a safe whole-number bitmask from 0 to 255.` No control appears to enter that value. Undo restores the original border and clears the error.

Repair: add a bounded, explained bitmask editor with an intentional default, or remove the selectable option until it is editable. Existing imported custom values must remain visible and editable.

### R5 — P2: Valid custom border rules are painted as ordinary connections

Locations: `src/MapCanvas.tsx:532`, `src/MapCanvas.tsx:697`, and `src/MapCanvas.tsx:997`.

Both solid and sparse border painters choose their style from `edge.kind` alone. `custom` falls through to the ordinary border style; its `special` bits are not consulted.

Reproduction: a custom border with bitmask 4 and the built-in Impassable preset both compile to special value 4. The actual style function returns a thin, solid dark border for the former and a thicker red dashed border for the latter. Native movement and graph analysis can therefore disagree with what the editor/PNG suggests visually.

Repair: derive visual semantics from the same effective bitmask used by export and movement analysis, including combined river/pass/road/impassable values. Cover both ownership modes.

### R6 — P2: Transformation previews retain contradictory terrain features

Locations: `src/dom6.ts:1134` and `src/terrainVisuals.ts:36`.

The preview chooses a replacement base, then unions its flags with the original province flags. This preserves features that should be replaced by the depicted transformation. Fresh probes returned:

| Original terrain | Preview | Actual visual result |
| --- | --- | --- |
| Cave | Submerged | Cave swamp, with swamp/cave marks but no water mark |
| Forest | Wasted | Waste plus retained forest layers and tree marks |
| Sea | Farmland | Farm and sea layers, with fields and water together |
| Cave wall | Forested | Cave forest plus retained cave-wall markings |

These are editor/PNG inconsistencies; the preview does not change the stored native terrain mask. The existing tests even encode the cave-to-swamp mapping, illustrating why a green suite is not sufficient evidence of visual accuracy.

Repair: distinguish physical additive flags from transformation state, define compatible transformed masks explicitly, and add negative assertions for features that must disappear. Keep blocked-space and aquatic behavior consistent.

### R7 — P2: Winter is a universal color filter, not a realm-aware seasonal preview

Location: `src/MapCanvas.tsx:1007` and its callers.

The winter function receives only colors and the preview condition. It applies the same pale wash without considering plane type, cave/deep-water status, or Warmer/Colder flags. This includes cave and outer-plane palettes. This behavior was visually identified in the preceding terrain review and its unconditional implementation was reconfirmed here.

Repair: either clearly label this as a stylistic frozen-color preview, or implement a documented, realm-aware seasonal appearance policy. Do not present it as verification of the game's actual seasonal rendering. An in-engine comparison remains necessary.

### R8 — P2: Editor map proportions do not match export proportions

Location: `src/MapCanvas.tsx:173` and the matching screen-to-world conversion.

The renderer fills the canvas independently in X and Y instead of fitting the plane's aspect ratio. A 3840×2160 project (1.778:1) was drawn into a 588×489 desktop canvas (1.202:1). At the narrow viewport it used 374×520 (0.719:1). This visibly changes province and realm shapes relative to the exported map.

Repair: use an aspect-preserving fit transform with matching hit testing, pan, zoom, overlays, and ownership sampling. Verify landscape, square, portrait, wrapped, and sparse maps.

### R9 — P3: Sparse labels and small markers remain difficult to read

Locations: `src/MapCanvas.tsx:718`, `src/MapCanvas.tsx:773`, and the combined sparse mask at line 644.

Province labels/badges are clipped to individual ownership paths, then the sparse layer is clipped again to the combined ownership mask. Long names can be cut off in narrow chambers. Small gateway/guardian badges are also difficult to distinguish at normal desktop zoom. The current desktop screenshot reconfirmed the tiny-marker problem; chamber-label clipping is carried forward from the preceding terrain review and remains present in the source.

Repair: separate semantic labels from terrain clipping, use collision-aware placement or tooltips, and provide a useful screen-space minimum for markers. Removing only the per-province clip will not overcome the combined sparse mask. Preserve keyboard and accessible province descriptions.

## Verification completed

- `npm test`: production build plus **354 passing tests** (14 JavaScript and 340 TypeScript); no failing or skipped tests.
- `npm run typecheck`, `npm run lint`, `npm run licenses:check`, and whitespace checks passed.
- Current `npm audit --audit-level=high`: **zero reported vulnerabilities**. This is dependency-advisory coverage, not proof of overall security.
- Launcher self-test and local production-server smoke test passed, including the existing traversal rejection check.
- **17 additional generation/round-trip cases** passed: all five ocean layouts across three economy policies, paired with varied topology/wrap settings, plus two eight-plane atlases. All had zero validation errors and exact serialize/parse round trips. These were sampled combinations, not an exhaustive Cartesian product.
- An additional eight-plane package at 448×256 produced 21 files; all eight D6M binaries passed header, length, owner, height, capital, and trailer inspection. All **28 expected gateway endpoints** appeared in compiled map files.
- Production-build browser checks covered keyboard province selection, editing, autosave, custom-border validation, Undo, narrow-screen containment, export-dialog focus wrapping and Escape, and conflicting writes from two tabs. Ordinary cross-tab conflict detection correctly preserved the stale tab's unsaved project and presented a conflict.
- No console warnings/errors were captured during the initial production-browser rendering and interaction checks. The build still reports the known large-chunk and Vinext route-classification warnings.
- Eight malformed-but-shape-valid import probes remained diagnosable instead of crashing the tested analysis/validation functions. One low-priority hardening gap remains: enormous finite populations can overflow `knownPopulation` to Infinity (`src/workbench.ts:147`). Validation already blocks those populations from playable export.

The suite covers important guardian, start-protection, cave-water, Styx, ownership, cancellation, and install-rollback cases. Its passing status does not negate the callback/UI/rendering gaps above. Several UI tests assert source text or rendered markup rather than exercising asynchronous behavior, and some visual tests assert drawing calls rather than actual perceptual correctness.

## Release consistency and remaining verification boundaries

The public GitHub `main` was read during this review and remains at `96557221256a6025453ff6d2936c444cb1c33663`, **three commits behind the reviewed local HEAD**. Its latest listed CI runs succeeded for that older revision. The latest downloadable release remains [v0.1.4, published September 6](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/tag/v0.1.4). Do not assume a GitHub source download or installer contains every change in the reviewed build. This review did not merge, tag, push, or deploy anything.

Not certified by this review:

- Actual Dominions 6 map loading, combat/guardian leadership, post-capture PD, recruitment, seasonal visuals, or multiplayer balance on the current game patch.
- Every seed, setting permutation, browser, touch device, screen reader, or maximum-size eight-plane raster export.
- Real-disk crash recovery while installing into a user's maps folder. Failure simulations use the existing in-memory filesystem harness.
- Atomic multi-file installation across external applications or different origins/browser profiles. Same-origin Web Locks and fingerprints reduce risk but cannot provide a filesystem transaction.
- Full equivalence of the pinned 6.35 catalog with later game patches. No guessed IDs or nation-strength compensation were introduced.
- General raw-command correctness. The guide explicitly says advanced directives are not fully syntax-checked or reconciled with structured controls; such commands can change game behavior outside structural diagnostics.

## Recommended repair order

1. Guard recovery loads and catalog state transitions; add deterministic concurrency regressions.
2. Complete custom-border editing and bitmask-aware rendering; make exported catalog validation consistent with the UI.
3. Correct transformation/seasonal preview semantics and map aspect ratio; improve sparse labels and markers.
4. Repeat production-browser checks and native-package inspection, then conduct an in-engine multiplayer/seasonal acceptance pass before synchronizing release channels.
