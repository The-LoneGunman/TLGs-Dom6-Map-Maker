# Multiplayer workbench implementation

Source status reviewed September 20, 2026. The first workbench stage is implemented, along with subsequent naming and safety corrections. The hosted app and Windows installer are separate releases; see [Versions and documentation](../README.md#versions-and-documentation). Remaining roadmap items below are not implemented or scheduled merely because they were approved.

This tracks the approved [comparative-research roadmap](MULTIPLAYER_MAPMAKER_RESEARCH_2026-09-06.md). Approval is not evidence that every stage has shipped. Nation-specific compensation remains disabled; selector catalogs are not balance rulesets.

## Implemented in current source

- Stage 1: scope labels for shared controls and mixed-behavior exceptions; pending generation inputs; current/planned province budgets; clearer descriptive-biome and initial-guardian wording.
- Stage 1: per-start structural breakdown, all seven legacy subscores, explicit validity/confidence distinctions, unknown economy and combat data, versioned analysis assumptions, saved user-declared patch/mod notes.
- Early Stage 2: cross-plane province search and editor-only two-step region overlays. Navigation cancels armed editing tools; stale overlays disappear after project edits.
- Early Stage 3: conservative dry/water graph filtering, team-label-aware competition, and per-start throne/realm-entrance distances. These are graph diagnostics, not validated game-movement or combat models.
- Host reports include both structural access views and quoted patch/mod assumptions. Playable map directives and native artwork formats are unchanged.
- Safe iteration already includes generation cancellation, replacement confirmations/backups, bounded Undo/Redo, guarded project/recovery loading, ordered catalog imports, and conflict-aware direct installation. This does not provide batch editing, authored-field locks, or scoped regeneration.
- Fresh atlases use random seeds; optional generated-name shuffling on reopen preserves manual names. The naming pool includes 528 additional original realm/terrain-aware places.
- The September 19–20 repairs preserve Styx crossings during start repair, synchronize changed topology, align package reports with the active catalog, expose custom border values, and correct map proportions, condition previews, and label readability.

## Remaining approved work

- Safer iteration: batch edits, authored-field locks, constrained rerolls, candidate comparison, and settings-only recipes.
- Opportunity analysis: calibrated movement profiles, separate income/resources/recruitment estimates, richer team exposure and objective comparisons.
- Richer generation: regional planning; granular terrain, route and ocean controls; guardian/reward profiles; explicitly optional and patch-validated nation accommodations.
- Interoperability: external-map inspection/import, differentiated player handoffs, and isolated guardian test scenarios.
- Release evaluation: held-out seed corpus, the proposed 1,000-seed quality evaluation, in-engine checks, multiplayer playtests, and measured user-task studies. The research targets are not achieved performance claims.

## Current verification boundary

The [September 20 repair pass](REPAIR_VERIFICATION_2026-09-20.md) passed 368 automated tests, type checking, lint, license checks, local-server smoke, and desktop/narrow-browser checks. [GitHub CI for repair commit `bc5fe0a`](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/actions/runs/35515033664) also passed. This includes generation and export regressions, not a calibrated movement/combat model or proof of multiplayer balance.

The installed Dominions 6.37 engine did not produce a saved game in the latest scripted attempt, so fresh in-engine acceptance remains incomplete. The 1,000-seed evaluation and measured user studies proposed in the research have not been completed. The bundled selectors remain pinned to 6.35; no nation-strength tier or automatic compensation has been introduced.

## Historical first-stage verification (September 6)

The first workbench implementation left generation policies and random sequences unchanged. Four pre-change fixtures (default, mixed core/bonus, island-chain mixed starts, and manual/automatic sizing) retained identical generated-map digests. This was a check of that first stage, not a claim that later generation repairs preserve every old map. Regression tests covered budget/generation agreement, input provenance, metadata import safety, terrain/media filters, teams, unknown values, large/empty start sets, navigation wiring, and accessible server-rendered panels.

That regression run passed 319 tests (14 build/integration checks and 305 TypeScript tests). Type checking, lint, license verification, and whitespace checks also passed. The build retained its large-client-chunk warning; no bundle-performance claim was implied.

Interactive local browser checks covered the default desktop and a 390×844 viewport: switching access models; start-region navigation; search with the Start tool armed; future-patch warnings and Undo; budget changes without regeneration; draft-plane handling; keyboard focus into native disclosure controls; and horizontal table scrolling. No browser errors were logged. Testing found and fixed toolbar overlap and a header disappearing after switching from a scrolled mobile layout back to desktop. The new label scopes use explicit props instead of shared React context to avoid a development-renderer warning. The original map/settings were restored, and the temporary viewport override was reset.

These checks do not substitute for Dominions playtests, full movement calibration, or user studies. No nation has been assigned a strength tier or silently compensated. New project metadata is optional for current imports, but older releases may reject it; retain older backups when testing upgrades.
