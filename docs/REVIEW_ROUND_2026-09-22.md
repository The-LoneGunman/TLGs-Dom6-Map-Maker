# Review round: defects, generation fixes, usability and performance (September 22, 2026)

This record covers [PR #12](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/pull/12). It started as a whole-codebase bug and blocker review. `main` was green at the start (`29c2edb`), and the review found no crashes, path traversal or data-destroying bugs. The confirmed defects were repaired, and four follow-up rounds were added: generation fixes, a usability pass, and a performance and memory pass. The package version remains **0.1.5**. None of this is in the hosted GUI or the Windows v0.1.5 release until a separate deployment or release.

## Defect repairs

**Export validation**
- A start's connection minimum counts only traversable exits, so a capital ringed by Cave Walls is reported.
- Named mountain borders on a start are blocking, matching the generator's start-edge rule.
- `#dom2title` and `#planename` collapse `--` runs, `//` and `"`, so a map name cannot open a native comment or string.
- Raw directives split on a bare CR as well as LF in every check.
- `#winterimagefile` is recognized by the native inspector.
- Dry-land site bits no longer match kelp or underwater-highland provinces.
- A province used by several gate groups is warned about.

**Borders**
- Border re-synchronization keeps border IDs unique. Before, reused seeds could make an inspector edit change a different border.
- Re-synchronization never rolls a river, pass or mountain border onto a start border.
- Repeated IDs in older saves are counted by **Synchronize borders** and repaired.

**Editor**
- Opening a project no longer fails when both atlases are locked.
- Manual gateway IDs stay unique after renumbering.
- Rejected edits no longer show success messages.
- Typing in **Players** keeps the coastal, water and cave start allocation.
- Guardian squad counts can be cleared and retyped.
- Wheel zoom no longer scrolls or pinch-zooms the page.
- Plane size text is locale-stable, which avoids a hydration mismatch.
- Portrait sparse artwork is scaled correctly.
- Typing in one field is a single Undo step until the field loses focus.

**Autosave**
- Browsers without Web Locks no longer report a false conflict from another tab.

**Launcher and release**
- The installer payload includes a `{"type":"module"}` package file, so a CommonJS `package.json` above the install folder cannot break startup.
- Readiness checks tolerate slow first renders.
- Cancelled downloads release their file handles.
- Request targets cannot change the host the app sees.
- Only the release publish job receives write permission.

## Generation fixes

- **Natural ocean layout.** Generated Sea, Deep Sea and Kelp are kept, and new water uses the same terrain rules as other layouts. Across six seeds, water went from plain Sea only to 71 Sea / 21 Deep Sea / 10 Kelp. The Oceanic variant now reaches its 42% floor (40/96 instead of 17/96). Other layouts are unchanged.
- **Authored starts.** Generated starts stay at least three moves from manual nation-specific and team starts. In the reported scenario (players 6→7), spacing violations went from 7 of 8 seeds to 0. A pre-generation notice offers **Remove nation N start**, and a generation notice explains any case that cannot be met.
- **Province budget.** The budget and generation use one frozen per-plane start split, and manual planes are measured by their target. Across a replication grid of about 22,500 plane pairs, budget-vs-generation disagreements went from about 5,200 to 0.
- **Strategic topology.** Wet chokepoints are routed as required borders through the connected river router. Across 24 seeds, lost picks went from 31 of 35 to 0. Chokepoints that no river can pass become mountain passes. Open and Competitive output is byte-identical.
- **Underworld borders.** Passages stay clear of unrelated chambers and bridges are drawn over the river, so exported borders equal connections. Across the main 24-plane batch, mismatches went from 77 to 0, with 180 further sampled planes also at 0. When a plane's grid leaves no drawable river (mostly 8–12 provinces, or a wrap across the river), it is laid out again in bands around the Styx. In a follow-up sweep of 278 Underworlds (8–800 provinces, six sizes, all wrap settings, 84 supplying cave starts), mismatches went from 113 on 43 planes to 0, and planes with validation errors went from 51 to 30.

## Usability

The changes regroup and relabel controls without removing any.

**Setup panel**
- Collapsible sections with one-line help and **More…**.
- A pinned Generate bar.
- One scope badge per section.
- Generate went from 3,183 to 1,918 px of scrolling and from 619 to 231 visible words. Scenario went from 2,819 to 843 px.

**Header and map**
- A **File** menu replaces the floating Open project button.
- **Find a province** sits in the map toolbar and opens with `/`.
- Link/Gate status appears as a banner over the map.
- Draft planes show an overlay.
- An empty inspector shows a Getting started checklist.

**Inspector**
- Size and Climate selectors.
- Filter chips.
- Folded explanations.

**Validate**
- Problems come first; the structural score is folded.

**Narrow screens**
- The map comes first, at y≈289 px instead of about y≈3,400 px on a 420 px screen.
- A Map / Province / Setup bar jumps between sections.

**Iterate**
- Sections are reordered.
- Previews appear, focused and highlighted, under the section that made them.

**Keyboard**
- Tab leaves catalog fields correctly.

**Consistent names**
- **Start analysis…** is the single name for the start-region dialog.

## Performance and memory

Output is identical unless stated: generated projects, validation results, exports and drawn pixels were compared against the pre-optimization trees.

| Area | Before | After |
|---|---|---|
| Generate 32 players × 25 provinces | ~15–18 min (review), 174 s (after first fix) | 3.5–4.5 s |
| Generate 16 players, 3 planes | 20–27 s | 1.6–2.7 s |
| Per-edit pipeline, 792-province atlas | 162–190 ms | 67–90 ms |
| Autosave per save | 38–125 ms | 2–6 ms |
| Terrain-edit validation, air plane | 112 ms | 18 ms |
| Main-thread freeze after restore / Generate (792 provinces) | ~6.5–7 s | ~1 s (region scan runs in a worker) |
| Panning a sparse plane at 2560×1440 (20 moves) | 47–89 s of blocking | 0–1.2 s |
| Sky art preparation at 4K | ~7 s | ~0.3 s |
| Illustrated build / install (large atlases) | 95–239 s | 51–119 s |
| ZIP packaging extra memory | 3× package size | 1× |
| Undo memory per province edit (792 provinces) | 0.75 MB | 0.31–0.33 MB |
| JavaScript loaded on first visit | 1,322 KB | 1,202 KB (export code and defender data load on demand) |

Notes:
- **Generate on regional planes.** Generate now waits a few seconds longer in its progress phase while the worker prepares regional borders. The time is similar overall, but it no longer freezes the editor afterwards.
- **Deferred panels.** Validation counts and the structural score refresh one render after an edit. Export dialog gating always uses the current project.

## Verification

- Every repair and generation fix added regression tests that fail on the earlier code.
- The full CI-equivalent pipeline passes on the final head: dependency audit, launcher self-test, license check, typecheck, `npm test` (build plus all tests), lint and local-server smoke.
- Browser checks with Chromium covered wheel zoom, grouped Undo, and the redesigned panels at 1600, 1024, 900 and 420 px.

## Remaining limits

- **Not yet checked in Dominions 6:** the new Underworld crossings (ford links, narrowed river columns) and the strategic river routes still need an in-game playtest.
- **Tiny Underworlds:** borders now equal connections on 8–12 province planes too. Two cave starts on an Underworld of about 8–12 provinces usually cannot keep three moves apart with four exits each; validation reports it.
- **Not measured on low-end hardware:** timings come from a shared 4-core machine and are relative. Browser timings came from headless Chromium without a GPU.
