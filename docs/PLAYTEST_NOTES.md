# Pantokrator Atlas playtest and release notes

This checklist records requirements and findings from the final manual audit, option-matrix run, and interactive browser playtest. A checked item has an implementation and regression coverage; unchecked items remain in the active release pass.

## Plane identity and presentation

- [x] Support one through eight planes and editable bidirectional `#gate` groups.
- [x] Generate ownerless space and authored corridors on non-overland planes.
- [x] Use cave-family chamber/tunnel graphs and sparse route/branch graphs for other special planes.
- [x] Add subdued illustrated backgrounds behind ownerless space in the editor and high-resolution PNG preview: cloud/storm, cavern, underworld, infernal, abyssal, dream/glamour, and elemental.
- [x] Make newly staged plane names collision-free and show plane numbers anywhere duplicate imported names could be ambiguous.

## Plane-specific forces and content

- [x] Audit every generated guardian commander and troop against verified Dominions 6.35 numeric IDs.
- [x] Hell and Abyss: demon-themed commanders and troops.
- [x] Underworld: undead, ghosts, and spirits.
- [x] Dreamlands: fay, glamour, and other magical beings.
- [x] Cave, cavern, cloud, air, elemental, and oceanic variants: matching themed pools.
- [x] Give Cloud/Air, Underworld, Hell, Abyss, Dream, Elemental, and other special planes materially stronger neutral guardian packages than surface and ordinary cave expansion.
- [x] Keep plane-specific `#poptype` recruitment pools; use map-native guardian armies for neutral conquest difficulty and reserve `#defence` for playable-owned provinces.
- [x] Keep generated guardians outside generic, team, and nation-specific start two-rings.
- [x] Use plane-appropriate population types and magic-site path biases.

## Multiplayer generation quality

- [x] Exact land/coastal/water/cave/other start allocations for covered matrices.
- [x] Common feasible start degree, with four as the recommended baseline and higher targets best-effort.
- [x] Comparable cave and overland two-ring access.
- [x] Gate and throne exclusion zones around all authored starts.
- [x] Global post-gate four-move throne-access balancing for default maps.
- [x] Enforce a global three-move start floor, including gate shortcuts, so capitals never share a one-ring province.
- [x] Scale preferred separation with traversable provinces per start: three moves at 8 provinces/player, four at 16, and five at 30 in the final corpus.
- [x] Show persistent, accessible best-effort warnings when compact or high-load settings prevent the preferred spacing or equal start degrees.
- [x] Re-run mixed-plane throne parity after the separation repair.
- [x] Biome cohesion produces a material, correctly directed clustering change across a seed corpus.
- [x] Warn when an extreme requested throne count cannot fit outside protected start zones.

## UI, persistence, and import safety

- [x] Reset generator defaults with Undo/Redo.
- [x] Full non-capital magic-site pool and complete unit search with factual role filters.
- [x] Existing gateway number/endpoint editor and whole-group deletion.
- [x] Replace quota-limited project localStorage with IndexedDB-backed autosave and visible failure state.
- [x] Reject malformed or zero-plane project files before they can reach the editor.
- [x] Clear armed Link/Gate sources after history, import, or plane removal.
- [x] Fix false-red per-plane status indicators and active-plane preview/zoom copy.
- [x] Finish keyboard canvas, combobox, and modal focus/escape accessibility checks.

## Export and engine compatibility

- [x] Manual command coverage, additive terrain flags, condition-reactive D6M export, and eight-plane naming.
- [x] Exact D6M pixel-owner validation, owner-zero space, quantized capital distance, and wrap seams.
- [x] Keep illustrated realm backdrops editor/PNG-only; native D6M v3 has no user-raster underlay behind owner-zero pixels.
- [x] Direct-install stale-plane cleanup and explicit replace-folder instructions for ZIP updates.
- [x] Start, throne, gate, site, defender, PD, terrain, owner, and catalog validation.
- [x] Reserved nation/owner IDs and blocked/impassable movement semantics.

## Final evidence

- Production build, lint, TypeScript, and 154 automated checks pass (2 rendered-HTML checks plus 152 TypeScript tests).
- A deterministic 34-case settings fuzz matrix passed for 2–32 players, 1–3 planes, 8–30 provinces per player, start-degree targets 1–8, water 0–60%, and every resolution/wrap mode exercised by the suite. All requested start categories, graphs, compiled maps, and validation contracts were clean.
- All 121 plane-kind × terrain-variant combinations generated deterministically. The export audit covered 8,712 provinces and 1,784 guardian groups with no invalid catalog IDs, off-theme poptypes, independent `#defence`, or guardian incursions into start two-rings.
- The final Abyss audit covered all 11 variants and 83 guardian groups: every commander was Demon General #1314 or Demon Priest #1609, with only Lesser Horror #307, Horror #308, Demon Knight #489, and Disease Demon #1662 squads.
- A fully staged eight-plane compact atlas produced eight `.map` files, eight structurally valid `.d6m` files, exact requested start categories, nine gate groups, and no validation errors.
- Scale-aware spacing passed 60/60 single-plane and 10/10 mixed cases: 8 provinces/player reached three moves in 20/20 seeds, 16 reached four in 20/20, and 30 reached five in 20/20. A separate 100-seed default corpus plus ten mixed maps never fell below the hard three-move floor.
- Twenty fairness maps were valid and scored 84–92 overall. Mixed-plane nearby-throne access averaged 71/100 where a real 2-versus-3 nearby-throne imbalance remained; the score now penalizes only those genuine count differences.
- Interactive playtesting regenerated a 397-province eight-plane 4K atlas in about 1.6 seconds, inspected plane-specific recruitment and guardian squads, exercised validation/export dialogs, keyboard-only province actions, autosave, contextual naming, realm backgrounds, planned links, and the existing-gateway editor. A live constrained map displayed its achieved three-move spacing versus the preferred four as an accessible non-blocking warning.
- The extreme 64-throne/96-province stress seed safely placed 60 outside protected zones and now reports the shortfall instead of silently underdelivering.
- The maximum 32-player mixed stress map retained all exact start categories, a three-move floor, and at least four exits per capital. It placed 61/64 requested thrones and used degree 4–8 starts with explicit best-effort warnings rather than weakening protected zones.
- Ocean/Styx/gate tests passed 15/15, an independent Styx corpus passed 100/100, 6,400 generated names were unique and reserved-name-safe, and a 3840×2160 package produced a structurally valid 33,178,790-byte D6M.

## Inspiration-derived follow-ups

These are useful future options rather than release blockers:

- Nation/age-aware capital-circle weighting and valuable-province balance modes, inspired by [Cartographic Revision](https://corbeau.itch.io/cartographic-revision).
- Per-stage rerolls, regional inspection lenses, disciples/team presets, and explicit soft/hard population-balance modes, inspired by [DreamAtlas](https://tlaloca.itch.io/dreamatlas).
- Water-body clustering controls, reusable layout presets, alternate labeled-preview styles, and deeper manual layout editing, inspired by [MapNuke 2](https://nuke-haus.itch.io/mapnuke-2).
